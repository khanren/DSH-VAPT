// bench/compare.mjs — 汇总 bench/results/*.score.json，输出可引用的对比表。
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = join(HERE, 'results');
let files = [];
try { files = readdirSync(dir).filter((f) => f.endsWith('.score.json')); } catch { /* none */ }

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const rows = files.map((f) => {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const m = r.metrics;
  return {
    tool: `${r.tool} (${r.app})`,
    gt: r.groundTruth.version,
    recall: `${pct(m.recall)} [${pct(m.recallCi95[0])}–${pct(m.recallCi95[1])}]`,
    precision: pct(m.precision),
    evidence: pct(m.evidenceCoverage),
    repro: m.reproducibility === null ? '—' : pct(m.reproducibility),
    composite: m.composite === null ? 'n/a (components only)' : m.composite,
    runs: r.runs ?? '—',
  };
});

if (!rows.length) {
  console.log('no result files yet — run: node bench/real.mjs --juice --runs 2');
  process.exit(0);
}

const cols = ['tool', 'gt', 'recall (95% CI)', 'precision', 'evidence', 'repro', 'composite', 'runs'];
console.log(`| ${cols.join(' | ')} |`);
console.log(`|${cols.map(() => '---').join('|')}|`);
for (const r of rows) {
  console.log(`| ${r.tool} | ${r.gt} | ${r.recall} | ${r.precision} | ${r.evidence} | ${r.repro} | ${r.composite} | ${r.runs} |`);
}
console.log('\n未运行的工具请记作 not-run，不要估算——这是本方法论的硬规则。');
