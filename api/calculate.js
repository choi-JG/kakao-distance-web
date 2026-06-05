const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY || "";

const GEOCODE_URL   = "https://dapi.kakao.com/v2/local/search/address.json";
const KEYWORD_URL   = "https://dapi.kakao.com/v2/local/search/keyword.json";
const DIRECTION_URL = "https://apis-navi.kakaomobility.com/v1/directions";

const ROUTE_OPTIONS = [
  { label: "내비추천",     priority: "RECOMMEND", avoid: null },
  { label: "최소시간",     priority: "TIME",      avoid: null },
  { label: "거리우선",     priority: "DISTANCE",  avoid: null },
  { label: "큰길우선",     priority: "RECOMMEND", avoid: "toll" },
  { label: "고속도로우선", priority: "RECOMMEND", avoid: "motorway" },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function geocode(address) {
  const headers = { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` };
  try {
    const res  = await fetch(`${GEOCODE_URL}?query=${encodeURIComponent(address)}`, { headers });
    const data = await res.json();
    if (data.documents?.length) {
      return [parseFloat(data.documents[0].x), parseFloat(data.documents[0].y)];
    }
  } catch {}
  await sleep(200);
  try {
    const res  = await fetch(`${KEYWORD_URL}?query=${encodeURIComponent(address)}`, { headers });
    const data = await res.json();
    if (data.documents?.length) {
      return [parseFloat(data.documents[0].x), parseFloat(data.documents[0].y)];
    }
  } catch {}
  return null;
}

async function callDirection(origin, dest, priority, avoid) {
  const headers = { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` };
  let url = `${DIRECTION_URL}?origin=${origin[0]},${origin[1]}&destination=${dest[0]},${dest[1]}&priority=${priority}`;
  if (avoid) url += `&avoid=${avoid}`;
  try {
    const res    = await fetch(url, { headers });
    const data   = await res.json();
    const routes = data.routes || [];
    if (routes.length && routes[0].result_code === 0) return routes[0].summary;
  } catch {}
  return null;
}

async function processRow(row) {
  const originAddr = row["출발지"] || "";
  const destAddr   = row["도착지"] || "";

  const result = {
    출발지: originAddr,
    도착지: destAddr,
    "거리(km)": null,
    "택시비_최대(원)": null,
    "택시비_최소(원)": null,
    상태: "",
  };

  const origin = await geocode(originAddr); await sleep(200);
  const dest   = await geocode(destAddr);   await sleep(200);

  if (!origin) { result.상태 = "출발지 좌표 변환 실패"; return { ...row, ...result }; }
  if (!dest)   { result.상태 = "도착지 좌표 변환 실패"; return { ...row, ...result }; }

  const distSummary = await callDirection(origin, dest, "DISTANCE", null);
  await sleep(200);

  if (!distSummary) { result.상태 = "거리 경로 탐색 실패"; return { ...row, ...result }; }
  result["거리(km)"] = Math.round(distSummary.distance / 100) / 10;

  const fares = [];
  for (const opt of ROUTE_OPTIONS) {
    const summary = await callDirection(origin, dest, opt.priority, opt.avoid);
    await sleep(200);
    if (summary?.fare?.taxi != null) fares.push(summary.fare.taxi);
  }

  if (fares.length) {
    result["택시비_최대(원)"] = Math.max(...fares);
    result["택시비_최소(원)"] = Math.min(...fares);
    result.상태 = "성공";
  } else {
    result.상태 = "택시비 데이터 없음";
  }

  // 원본 컬럼 유지 (출발지/도착지 제외)
  const extra = Object.fromEntries(
    Object.entries(row).filter(([k]) => k !== "출발지" && k !== "도착지")
  );
  return { ...result, ...extra };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  if (!KAKAO_REST_API_KEY) {
    return res.status(500).json({ error: "KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다." });
  }

  const { rows } = req.body;
  if (!rows?.length) return res.status(400).json({ error: "rows가 비어있습니다." });

  try {
    const results = [];
    for (const row of rows) {
      const r = await processRow(row);
      results.push(r);
    }
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
