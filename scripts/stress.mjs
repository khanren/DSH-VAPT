// scripts/stress.mjs — 稳定性压测：损坏文件、并发写、超时、PATH。
// 这些不是功能测试，是「长期用下去会不会坏」的测试。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/pentest/store.js';
import { runTool, which } from '../src/pentest/exec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fail = [];
const ok = (m) => console.log(`  ✓ ${m}`);

const root = mkdtempSync(join(tmpdir(), 'vapt-stress-'));
const store = createStore({ root });
const e = store.create({ client: 'Probe', scope: ['127.0.0.1/32'] });

/* A) 损坏文件容错 */
writeFileSync(join(store.dirOf(e.id), 'evidence.json'), '{not json', 'utf8');
const afterCorrupt = store.listEvidence(e.id);
if (!Array.isArray(afterCorrupt)) fail.push('A: 损坏文件应降级为空数组');
const added = store.addEvidence(e.id, { finding_id: '', kind: 'x', tool: 't', command: 'c' });
let reparsed = false;
try { JSON.parse(readFileSync(join(store.dirOf(e.id), 'evidence.json'), 'utf8')); reparsed = true; } catch { /* ignore */ }
if (!reparsed) fail.push('A: 写入后文件不可解析');
else ok(`损坏文件：读取降级为 []，写入后可再解析（${added.id}）`);

/* B) 并发写（两个强度） */
const childSrc = `
import { createStore } from ${JSON.stringify(join(HERE, '..', 'src', 'pentest', 'store.js'))};
const [root, id, tag, n] = process.argv.slice(2);
const s = createStore({ root });
for (let i = 0; i < Number(n); i += 1) s.addFinding(id, { target: 'x', title: tag + i, severity: 'low' });
`;
const script = join(root, 'child.mjs');
writeFileSync(script, childSrc, 'utf8');
for (const [procs, each] of [[5, 20], [10, 30]]) {
  const tag = `c${procs}-`;
  await Promise.all([...Array(procs).keys()].map((n) => new Promise((res) => {
    spawn(process.execPath, [script, root, e.id, `${tag}${n}-`, String(each)], { stdio: 'ignore' }).on('close', res);
  })));
  const expected = procs * each;
  const got = store.open(e.id).findings.filter((f) => String(f.title).startsWith(tag)).length;
  if (got !== expected) fail.push(`B: ${procs}×${each} 并发丢失 ${expected - got} 条（${got}/${expected}）`);
  else ok(`并发写 ${procs}×${each}：全部落盘（${got}/${expected}）`);
}

/* B2) 陈旧锁：进程被杀留下的 .lock 不应永久卡住写入 */
const findingsFile = join(store.dirOf(e.id), 'findings.json');
const staleLock = `${findingsFile}.lock`;
writeFileSync(staleLock, '', 'utf8');
const past = new Date(Date.now() - 30_000);
writeFileSync(staleLock, '', { encoding: 'utf8' });
import('node:fs').then(({ utimesSync }) => utimesSync(staleLock, past, past));
await new Promise((r) => setTimeout(r, 50));
const before = store.open(e.id).findings.length;
store.addFinding(e.id, { target: 'x', title: 'after-stale-lock', severity: 'low' });
if (store.open(e.id).findings.length !== before + 1) fail.push('B2: 陈旧锁导致写入失败');
else ok('陈旧锁：自动回收后仍可写入');

/* C) 超时 */
const slow = join(root, 'slow.sh');
writeFileSync(slow, '#!/bin/sh\nsleep 5\necho done\n', { mode: 0o755 });
const t0 = Date.now();
const r = await runTool(slow, [], { timeoutMs: 500 });
const ms = Date.now() - t0;
if (ms > 3000) fail.push(`C: 超时未生效（${ms}ms）`);
else ok(`超时：${ms}ms 内结束（exit=${r.code}）`);

/* D) 极简 PATH 下能否找到 homebrew 工具 */
const saved = process.env.PATH;
const known = which('nmap');
process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const found = which('nmap');
process.env.PATH = saved;
if (!known) ok('极简 PATH：本机未安装 nmap，跳过（CI 环境）');
else if (!found) fail.push('D: 极简 PATH 下找不到已安装的 nmap（GUI 启动的宿主就是这种情况）');
else ok(`极简 PATH 下仍能找到 nmap（${found}）`);

console.log(fail.length ? `\nFAIL (${fail.length})\n- ${fail.join('\n- ')}` : '\nstress: all good');
process.exitCode = fail.length ? 1 : 0;
