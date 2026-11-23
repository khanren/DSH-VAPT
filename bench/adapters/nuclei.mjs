// bench/adapters/nuclei.mjs — 把 nuclei JSONL 转成评分器的 observation schema。
// 用法：node bench/adapters/nuclei.mjs out.jsonl > observations.json
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node bench/adapters/nuclei.mjs <out.jsonl>'); process.exit(2); }
const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
const observations = [];
for (const line of lines) {
  let h; try { h = JSON.parse(line); } catch { continue; }
  const url = h['matched-at'] || h.host || '';
  let path = '/';
  try { path = new URL(url).pathname + (new URL(url).search || ''); } catch { /* relative */ }
  observations.push({
    app: 'juice-shop',
    path,
    title: `${h['template-id'] || '?'} — ${h.info?.name || ''}`.trim(),
    severity: h.info?.severity || 'info',
    evidence: { request: url, response: JSON.stringify(h.extracted-results || []).slice(0, 500), sha256: 'nuclei' },
  });
}
process.stdout.write(`${JSON.stringify({ tool: 'nuclei', appsRun: ['juice-shop'], observations }, null, 2)}\n`);
