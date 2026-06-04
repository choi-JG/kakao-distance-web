import os
import json
import time
import requests
import pandas as pd
from io import BytesIO
from http.server import BaseHTTPRequestHandler

KAKAO_REST_API_KEY = os.environ.get("KAKAO_REST_API_KEY", "")

GEOCODE_URL   = "https://dapi.kakao.com/v2/local/search/address.json"
KEYWORD_URL   = "https://dapi.kakao.com/v2/local/search/keyword.json"
DIRECTION_URL = "https://apis-navi.kakaomobility.com/v1/directions"
DELAY         = 0.2

ROUTE_OPTIONS = [
    {"label": "내비추천",     "priority": "RECOMMEND", "avoid": None},
    {"label": "최소시간",     "priority": "TIME",      "avoid": None},
    {"label": "거리우선",     "priority": "DISTANCE",  "avoid": None},
    {"label": "큰길우선",     "priority": "RECOMMEND", "avoid": "toll"},
    {"label": "고속도로우선", "priority": "RECOMMEND", "avoid": "motorway"},
]


def geocode(address):
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    try:
        res  = requests.get(GEOCODE_URL, headers=headers, params={"query": address}, timeout=10)
        docs = res.json().get("documents", [])
        if docs:
            return float(docs[0]["x"]), float(docs[0]["y"])
    except:
        pass
    time.sleep(DELAY)
    try:
        res  = requests.get(KEYWORD_URL, headers=headers, params={"query": address}, timeout=10)
        docs = res.json().get("documents", [])
        if docs:
            return float(docs[0]["x"]), float(docs[0]["y"])
    except:
        pass
    return None


def call_direction(origin, dest, priority, avoid):
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    params  = {
        "origin":      f"{origin[0]},{origin[1]}",
        "destination": f"{dest[0]},{dest[1]}",
        "priority":    priority,
    }
    if avoid:
        params["avoid"] = avoid
    try:
        res    = requests.get(DIRECTION_URL, headers=headers, params=params, timeout=10)
        routes = res.json().get("routes", [])
        if routes and routes[0].get("result_code") == 0:
            return routes[0]["summary"]
    except:
        pass
    return None


def process_row(origin_addr, dest_addr):
    result = {
        "출발지":         origin_addr,
        "도착지":         dest_addr,
        "거리(km)":      None,
        "택시비_최대(원)": None,
        "택시비_최소(원)": None,
        "상태":           "",
    }

    origin = geocode(origin_addr)
    time.sleep(DELAY)
    dest   = geocode(dest_addr)
    time.sleep(DELAY)

    if not origin:
        result["상태"] = f"출발지 좌표 변환 실패"
        return result
    if not dest:
        result["상태"] = f"도착지 좌표 변환 실패"
        return result

    dist_summary = call_direction(origin, dest, "DISTANCE", None)
    time.sleep(DELAY)

    if dist_summary:
        result["거리(km)"] = round(dist_summary["distance"] / 1000, 2)
    else:
        result["상태"] = "거리 경로 탐색 실패"
        return result

    fares = []
    for opt in ROUTE_OPTIONS:
        summary = call_direction(origin, dest, opt["priority"], opt["avoid"])
        time.sleep(DELAY)
        if summary:
            fare = summary.get("fare", {}).get("taxi")
            if fare is not None:
                fares.append(fare)

    if fares:
        result["택시비_최대(원)"] = max(fares)
        result["택시비_최소(원)"] = min(fares)
        result["상태"] = "성공"
    else:
        result["상태"] = "택시비 데이터 없음"

    return result


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if not KAKAO_REST_API_KEY:
            self._error(500, "KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.")
            return

        length      = int(self.headers.get("Content-Length", 0))
        body        = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")

        try:
            if "application/json" in content_type:
                data    = json.loads(body)
                rows    = data.get("rows", [])
                results = []
                for row in rows:
                    r = process_row(row.get("출발지",""), row.get("도착지",""))
                    for k, v in row.items():
                        if k not in ["출발지","도착지"]:
                            r[k] = v
                    results.append(r)

                df  = pd.DataFrame(results)
                buf = BytesIO()
                df.to_excel(buf, index=False, engine="openpyxl")
                buf.seek(0)

                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                self.send_header("Content-Disposition", "attachment; filename=result.xlsx")
                self.end_headers()
                self.wfile.write(buf.read())

            else:
                self._error(400, "Content-Type은 application/json 이어야 합니다.")

        except Exception as e:
            self._error(500, str(e))

    def _error(self, code, msg):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg}).encode())

    def log_message(self, format, *args):
        pass
