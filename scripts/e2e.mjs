// scripts/e2e.mjs — 端到端：真二进制 + 本地 fixture，跑完整链路到双语报告。
// 没有安装某工具时该步跳过（CI 上没有 homebrew 也不会红）。
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/pentest/store.js';
import { runAdapter, listTools } from '../src/pentest/adapters.js';
import { writeReports } from '../src/pentest/report.js';

const skipped = [];
const done = [];
const ok = (m) => { done.push(m); console.log(`  ✓ ${m}`); };
const skip = (m) => { skipped.push(m); console.log(`  – ${m} (skipped)`); };

/* fixture：假装一个 web 服务 */
const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', server: 'Fixture/1.0', 'x-powered-by': 'Demo 2.3' });
  res.end('<!doctype html><title>Demo Admin</title><body>login</body>');
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const port = fixture.address().port;
const base = `http://127.0.0.1:${port}`;

const root = mkdtempSync(join(tmpdir(), 'vapt-e2e-'));
const store = createStore({ root });
const eng = store.create({ client: 'E2E Co', scope: ['127.0.0.1/32'], window: '2026-11-21~2026-11-22' });
const ctx = { store, id: eng.id, meta: store.open(eng.id).meta, cwd: process.cwd() };
const tools = Object.fromEntries(listTools().map((t) => [t.id, t]));
console.log(`engagement ${eng.id} · fixture ${base}\n`);

/* 1) 真 nmap（快扫本地端口，必然含 fixture 端口） */
if (tools.nmap?.path) {
  const out = await runAdapter('nmap', { target: '127.0.0.1', args: ['-p', String(port)], timeout_ms: 120000 }, ctx);
  const assets = store.open(eng.id).assets;
  const host = assets.find((a) => a.host === '127.0.0.1' || a.host === 'localhost');
  if (!host || !host.ports.includes(port)) throw new Error(`nmap 未记录端口 ${port}（assets=${JSON.stringify(assets)}）`);
  ok(`nmap：记录 ${host.host} 端口 [${host.ports.join(',')}] · ${out.split('\n')[0]}`);
} else skip('nmap 未安装');

/* 2) 真 httpx（针对 fixture） */
if (tools.httpx?.path) {
  const out = await runAdapter('httpx', { target: base, args: ['-mc', '200'], timeout_ms: 60000 }, ctx);
  if (!/200/.test(out)) throw new Error('httpx 未返回 200 摘要');
  ok('httpx：拿到 200 + 标题摘要');
} else skip('httpx 未安装');

/* 3) 手工记一条发现 + 证据（模拟人工验证） */
const f = store.addFinding(eng.id, {
  target: base, title: '首页未授权可访问', title_en: 'Homepage reachable without authentication',
  severity: 'low', status: 'confirmed', confidence: 'observed',
  detail: '未经认证直接返回 200，并泄露 X-Powered-By。',
  detail_en: 'Returns 200 without authentication and discloses X-Powered-By.',
});
store.addEvidence(eng.id, {
  finding_id: f.id, kind: 'http', tool: 'curl',
  command: `curl -sS -i ${base}/`,
  request: `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
  response: 'HTTP/1.1 200 OK\r\nX-Powered-By: Demo 2.3\r\n\r\n<title>Demo Admin</title>',
});
ok(`发现 ${f.id} + 证据已记录（sha256 已算）`);

/* 4) 报告 */
const out = writeReports(store, eng.id);
const zh = readFileSync(out.zh, 'utf8');
const en = readFileSync(out.en, 'utf8');
if (!zh.includes('渗透测试报告')) throw new Error('zh 报告缺少标题');
if (!en.includes('Penetration Test Report')) throw new Error('en 报告缺少标题');
if (!zh.includes('首页未授权可访问')) throw new Error('zh 报告缺少发现');
if (!en.includes('Homepage reachable without authentication')) throw new Error('en 报告缺少英文标题');
if (!en.includes('HTTP/1.1 200 OK')) throw new Error('en 报告缺少原始响应');
ok('报告：zh/en 双份，发现 + 原始请求都在');

/* 5) 事件与产物 */
const runs = store.listEvents(eng.id, 'tool_run');
const artifactsDir = join(store.dirOf(eng.id), 'artifacts');
const artifacts = readdirSync(artifactsDir, { withFileTypes: true }).map((d) => d.name);
if (tools.nmap?.path || tools.httpx?.path) {
  if (runs.length < 1) throw new Error('没有 tool_run 事件');
  if (artifacts.length < 1) throw new Error('没有 artifact');
  for (const r of runs) if (!r.sha256 || r.sha256.length !== 64) throw new Error('事件缺 sha256');
  ok(`审计：${runs.length} 条 tool_run 事件，${artifacts.length} 个 artifact`);
} else {
  skip('审计：本机未安装 nmap/httpx，跳过 tool_run 与 artifact 断言');
}

fixture.close();
console.log(`\n${done.length} passed · ${skipped.length} skipped`);
