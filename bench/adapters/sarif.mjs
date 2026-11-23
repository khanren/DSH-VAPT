// bench/adapters/sarif.mjs — 把任意 SARIF 2.1.0 报告转成评分器的 observation schema。
// 用法：node bench/adapters/sarif.mjs <findings.sarif> [app] [tool] > observations.json
import { readFileSync } from 'node:fs';

const [file, app = 'juice-shop', tool = 'strix'] = process.argv.slice(2);
if (!file) { console.error('usage: node bench/adapters/sarif.mjs <findings.sarif> [app] [tool]'); process.exit(2); }
const doc = JSON.parse(readFileSync(file, 'utf8'));
const observations = [];
for (const run of doc.runs || []) {
  const rules = new Map((run.tool?.driver?.rules || []).map((r) => [r.id, r]));
  for (const res of run.results || []) {
    const loc = (res.locations || [])[0]?.physicalLocation || {};
    const uri = loc.artifactLocation?.uri || '';
    let path = '/';
    try { const u = new URL(uri); path = u.pathname + (u.search || ''); } catch { path = uri || '/'; }
    const rule = rules.get(res.ruleId);
    const title = (res.message?.text || rule?.shortDescription?.text || res.ruleId || 'finding').slice(0, 200);
    const sev = String(res.level || rule?.properties?.severity || 'medium').toLowerCase();
    observations.push({
      app, path, title,
      severity: sev === 'error' ? 'high' : sev === 'warning' ? 'medium' : sev,
      evidence: { request: uri || path, response: (res.message?.text || '').slice(0, 300), sha256: 'sarif' },
    });
  }
}
process.stdout.write(`${JSON.stringify({ tool, appsRun: [app], observations }, null, 2)}\n`);
