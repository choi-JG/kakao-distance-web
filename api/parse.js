import { IncomingForm } from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const form = new IncomingForm({ keepExtensions: true });

  form.parse(req, (err, fields, files) => {
    if (err) return res.status(500).json({ error: err.message });

    try {
      const file     = Array.isArray(files.file) ? files.file[0] : files.file;
      const filePath = file.filepath;
      const buf      = fs.readFileSync(filePath);
      const wb       = XLSX.read(buf, { type: 'buffer' });
      const ws       = wb.Sheets[wb.SheetNames[0]];
      const rows     = XLSX.utils.sheet_to_json(ws, { defval: '' });

      return res.status(200).json({ rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });
}
