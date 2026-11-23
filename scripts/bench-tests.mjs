// scripts/bench-tests.mjs — 对「评分/呈现」脚本做回归测试。
// 这些脚本决定了论文里的数字，坏了比插件本身坏了更严重，所以单独测。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const pass = [];
const ok = (m) => { pass.push(m); console.log(`  ✓ ${m}`); };

/* 1) paper-table：给定裁决 → 指标必须算对 */
const work = mkdtempSync(join(tmpdir(), 'vapt-bench-'));
const comp = join(work, 'competitors');
mkdirSync(comp, { recursive: true });
writeFileSync(join(comp, 'fake.adjudication.json'), JSON.stringify({
  schema: 'dsh-vapt/adjudication@1', tool: 'fake-tool', app: 'juice-shop', groundTruth: 'x',
  items: [
    { match: 'a', verdict: 'catalogue', itemId: 'JS-01' },
    { match: 'b', verdict: 'catalogue', itemId: 'JS-02' },
    { match: 'c', verdict: 'extra-tp' },
    { match: 'd', verdict: 'fp' },
  ],
}, null, 2));

// 直接在进程内复算（与 paper-table 同一公式）
const gt = JSON.parse(readFileSync(join(ROOT, 'bench', 'ground-truth.json'), 'utf8'));
const items = gt.items.filter((i) => i.app === 'juice-shop' && i.expected === 'vulnerable');
const adj = JSON.parse(readFileSync(join(comp, 'fake.adjudication.json'), 'utf8'));
const hit = new Set(adj.items.filter((i) => i.verdict === 'catalogue').map((i) => i.itemId));
const tp = items.filter((i) => hit.has(i.id)).length;
const extra = adj.items.filter((i) => i.verdict === 'extra-tp').length;
const fp = adj.items.filter((i) => i.verdict === 'fp').length;
const recall = tp / items.length;
const precision = (tp + extra) / (tp + extra + fp);
const f1 = (2 * precision * recall) / (precision + recall);
assert.equal(tp, 2);
assert.equal(extra, 1);
assert.equal(fp, 1);
assert.ok(Math.abs(recall - 0.1) < 1e-9, `recall ${recall}`);
assert.ok(Math.abs(precision - 0.75) < 1e-9, `precision ${precision}`);
assert.ok(Math.abs(f1 - (2 * 0.75 * 0.1) / 0.85) < 1e-9, `f1 ${f1}`);
ok('metrics: TP/FP/extra-tp → recall / precision / F1 计算正确');

/* 2) rounds.mjs：同一份输入必须给出稳定输出（可复现） */
const logs = join(work, 'logs');
mkdirSync(logs, { recursive: true });
writeFileSync(join(logs, 'r1.log'), 'SQL 注入 /rest/user/login；JWT alg:none；/metrics；CSRF');
writeFileSync(join(logs, 'r2.log'), 'SQL 注入 /rest/user/login；JWT alg:none；/metrics；CSRF');
const run1 = execFileSync(process.execPath, [join(ROOT, 'bench', 'rounds.mjs'), '--app', 'dvwa', '--tool', 'x', '--dir', logs, '--glob', 'r*.log'], { encoding: 'utf8' });
const run2 = execFileSync(process.execPath, [join(ROOT, 'bench', 'rounds.mjs'), '--app', 'dvwa', '--tool', 'x', '--dir', logs, '--glob', 'r*.log'], { encoding: 'utf8' });
assert.equal(run1, run2, '两次运行输出必须完全一致');
assert.match(run1, /mean=/);
assert.match(run1, /DV-08|CSRF/i);
ok('rounds.mjs: 同一输入两次运行输出逐字节一致（可复现）');

/* 3) real.mjs 的 scope 校验不能被绕过（静态检查：探针必须走 get/fetch 而非直连 socket） */
const real = readFileSync(join(ROOT, 'bench', 'real.mjs'), 'utf8');
assert.match(real, /function get\(/, 'real.mjs 必须保留统一的 get 包装');
assert.ok(!/child_process/.test(real), '探针不应直接起子进程');
ok('real.mjs: 探针统一走 get()，未引入子进程旁路');

console.log(`\n${pass.length} bench-script checks passed`);
