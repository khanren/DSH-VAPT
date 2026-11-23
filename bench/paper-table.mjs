// bench/paper-table.mjs — 由各工具的裁决文件生成论文用对比表。
// 指标按“漏洞检出”任务定义：Recall / Precision / F1 / FP / FN / 耗时 / 成本。
// （不使用 Accuracy——没有足够负样本，写进 Limitations。）
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(readFileSync(join(HERE, 'ground-truth.json'), 'utf8'));
const dir = join(HERE, 'competitors');

function itemsFor(app) {
  return truth.items.filter((i) => i.app === app && i.expected === 'vulnerable');
}

const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.adjudication.json')).sort()) {
  const adj = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const app = adj.app;
  const items = itemsFor(app);
  const hit = new Set(adj.items.filter((i) => i.verdict === 'catalogue').map((i) => i.itemId));
  const extra = adj.items.filter((i) => i.verdict === 'extra-tp').length;
  const fp = adj.items.filter((i) => i.verdict === 'fp').length;
  const tp = items.filter((i) => hit.has(i.id)).length;
  const fn = items.length - tp;
  const recall = items.length ? tp / items.length : 0;
  const precision = tp + fp + extra === 0 ? 0 : (tp + extra) / (tp + extra + fp);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  rows.push({
    tool: adj.tool, app, gt: adj.groundTruth, tp, fn, fp, extra,
    recall, precision, f1,
    time: adj.time ?? '—', cost: adj.cost ?? '—', runs: adj.runs ?? 1,
    missed: items.filter((i) => !hit.has(i.id)).map((i) => i.id),
    hits: items.filter((i) => hit.has(i.id)).map((i) => i.id),
  });
}

// 本作的数据来自 results/*.score.json（真实运行）
for (const f of readdirSync(join(HERE, 'results')).filter((x) => x.endsWith('.score.json')).sort()) {
  const s = JSON.parse(readFileSync(join(HERE, 'results', f), 'utf8'));
  if (s.tool !== 'dsh-vapt') continue;
  const items = itemsFor(s.app);
  rows.push({
    tool: 'dsh-vapt', app: s.app, gt: s.groundTruth.version,
    tp: s.counts.tp, fn: s.counts.fn, fp: s.counts.fp, extra: s.counts.extraTp ?? 0,
    recall: s.metrics.recall, precision: s.metrics.precision,
    f1: (2 * s.metrics.precision * s.metrics.recall) / (s.metrics.precision + s.metrics.recall || 1),
    time: `${(s.durationMs / 1000).toFixed(1)} s`, cost: '0 token', runs: s.runs ?? 1,
    missed: items.filter((i) => !(s.perItem || []).some((p) => p.id === i.id && p.status === 'TP')).map((i) => i.id),
    hits: (s.perItem || []).filter((p) => p.status === 'TP').map((p) => p.id),
  });
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const sortByAppThenF1 = (a, b) => (a.app === b.app ? b.f1 - a.f1 : a.app.localeCompare(b.app));

const lines = [];
lines.push('| Target | Tool | Recall | Precision | F1 | TP | FN | FP | Time | Cost | Runs |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows.sort(sortByAppThenF1)) {
  lines.push(`| ${r.app} | ${r.tool} | **${pct(r.recall)}** | ${pct(r.precision)} | **${pct(r.f1)}** | ${r.tp} | ${r.fn} | ${r.fp} | ${r.time} | ${r.cost} | ${r.runs} |`);
}

// 逐项命中矩阵
const apps = [...new Set(rows.map((r) => r.app))].sort();
for (const app of apps) {
  const items = itemsFor(app);
  const tools = [...new Set(rows.filter((r) => r.app === app).map((r) => r.tool))];
  lines.push('', `#### Per-item hit matrix — ${app}`, '');
  lines.push(`| Item | ${tools.join(' | ')} |`);
  lines.push(`|---|${tools.map(() => '---').join('|')}|`);
  for (const it of items) {
    const cells = tools.map((t) => {
      const row = rows.find((r) => r.app === app && r.tool === t);
      return (row?.hits || []).includes(it.id) ? '✓' : '·';
    });
    lines.push(`| ${it.id} ${it.title} | ${cells.join(' | ')} |`);
  }
}

const md = `# Benchmark results (paper-ready)\n\nGround truth: **v${truth.version}** · ${truth.items.filter((i) => i.expected === 'vulnerable').length} vulnerable items + ${truth.items.filter((i) => i.expected === 'secure').length} negative controls.\n\n${lines.join('\n')}\n`;
writeFileSync(join(HERE, 'PAPER-RESULTS.md'), md, 'utf8');
writeFileSync(join(HERE, 'paper-results.json'), `${JSON.stringify({ groundTruth: truth.version, rows }, null, 2)}\n`, 'utf8');
console.log(lines.join('\n'));
