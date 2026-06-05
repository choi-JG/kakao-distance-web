const XLSX = require('xlsx');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { fileData } = req.body;
    if (!fileData) return res.status(400).json({ error: 'fileData가 없습니다.' });

    // base64 → Buffer
    const buf = Buffer.from(fileData, 'base64');

    // XLSX 파싱 - dense 모드로 읽기
    const wb = XLSX.read(buf, {
      type: 'buffer',
      dense: true,
      raw: false,
    });

    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];

    // dense 모드에서는 ws['!data'] 배열로 접근
    const data = ws['!data'];
    if (!data || data.length === 0) {
      return res.status(200).json({ rows: [] });
    }

    // 첫 행을 헤더로, 나머지를 데이터로 변환
    const headers = data[0].map(cell => (cell ? String(cell.v || '').trim() : ''));
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const row = {};
      headers.forEach((h, j) => {
        const cell = data[i][j];
        row[h] = cell ? String(cell.v ?? '') : '';
      });
      // 빈 행 제외
      if (Object.values(row).some(v => v !== '')) {
        rows.push(row);
      }
    }

    return res.status(200).json({ rows });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
