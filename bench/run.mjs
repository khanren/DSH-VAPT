// bench/run.mjs — 可重现的 harness 基准：本地靶场 → 探测 → 记发现/证据 → 出报告 → 打分。
// 不调用任何 LLM：它衡量的是「工具层 + 事实库 + 报告」这条流水线是否真的能把活干完。
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { createStore } from '../src/pentest/store.js';
import { buildSpecs } from '../src/pentest/specs.js';
import { writeReports } from '../src/pentest/report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const fixture = await startFixture();
const base = fixture.url;
const root = mkdtempSync(join(tmpdir(), 'vapt-bench-'));
const store = createStore({ root });
const tools = Object.fromEntries(buildSpecs({ lang: 'en' }).map((t) => [t.name, t]));
const ctx = { store, id: null, meta: null, cwd: root };

const eng = tools.vapt_engagement_open.execute(
  { client: 'Bench App', scope: ['127.0.0.1/32'], window: 'bench' }, ctx);
const id = store.current().id;
ctx.id = id; ctx.meta = store.open(id).meta;

/* ── 探测器：每个都走真实的 HTTP，再通过工具层记录 ────────────── */
const probes = [];
const add = (name, fn) => probes.push({ name, fn });

add('admin without auth', async () => {
  const r = await fetch(`${base}/admin`);
  if (r.status === 200) {
    tools.vapt_finding_add.execute({
      target: `${base}/admin`, title: 'Admin panel reachable without authentication',
      severity: 'critical', status: 'confirmed', confidence: 'observed', cwe: 'CWE-306', cvss: 9.8,
      detail: '/admin returned 200 with no session.',
      evidence: { kind: 'http', tool: 'fetch', command: `curl -i ${base}/admin`, request: 'GET /admin HTTP/1.1', response: `HTTP/1.1 200 OK\n\n<h1>Admin panel</h1>` },
    }, ctx);
    return true;
  }
  return false;
});

add('idor on /api/user', async () => {
  const r = await fetch(`${base}/api/user?id=2`);
  const body = await r.text();
  if (r.status === 200 && body.includes('victim@example.test')) {
    tools.vapt_finding_add.execute({
      target: `${base}/api/user`, title: 'IDOR exposes other users on /api/user',
      severity: 'high', status: 'confirmed', confidence: 'observed', cwe: 'CWE-639', cvss: 7.5,
      detail: 'id=2 returned another user record.',
      evidence: { kind: 'http', tool: 'fetch', command: `curl ${base}/api/user?id=2`, request: 'GET /api/user?id=2 HTTP/1.1', response: body.slice(0, 300) },
    }, ctx);
    return true;
  }
  return false;
});

add('error-based SQLi on /search', async () => {
  const r = await fetch(`${base}/search?q='`);
  const body = await r.text();
  if (r.status === 500 && /SQL syntax error/i.test(body)) {
    tools.vapt_finding_add.execute({
      target: `${base}/search`, title: 'Error-based SQL injection on /search (q)',
      severity: 'critical', status: 'confirmed', confidence: 'observed', cwe: 'CWE-89', cvss: 9.1,
      detail: "Single quote returns a raw SQL error.",
      evidence: { kind: 'http', tool: 'fetch', command: `curl '${base}/search?q=%27'`, request: "GET /search?q=' HTTP/1.1", response: body.slice(0, 300) },
    }, ctx);
    return true;
  }
  return false;
});

add('open redirect on /redirect', async () => {
  const r = await fetch(`${base}/redirect?url=https://evil.example`, { redirect: 'manual' });
  if (r.status >= 300 && r.status < 400 && /evil\.example/.test(r.headers.get('location') || '')) {
    tools.vapt_finding_add.execute({
      target: `${base}/redirect`, title: 'Open redirect on /redirect',
      severity: 'medium', status: 'confirmed', confidence: 'observed', cwe: 'CWE-601', cvss: 6.1,
      detail: 'Location header mirrors the url parameter.',
      evidence: { kind: 'http', tool: 'fetch', command: `curl -i '${base}/redirect?url=https://evil.example'`, request: 'GET /redirect?url=https://evil.example HTTP/1.1', response: `HTTP/1.1 ${r.status}\nLocation: ${r.headers.get('location')}` },
    }, ctx);
    return true;
  }
  return false;
});

add('info leak on /health', async () => {
  const r = await fetch(`${base}/health`);
  const body = await r.text();
  if (body.includes('postgres://')) {
    tools.vapt_finding_add.execute({
      target: `${base}/health`, title: 'Health endpoint leaks version and database credentials',
      severity: 'high', status: 'confirmed', confidence: 'observed', cwe: 'CWE-200', cvss: 7.5,
      detail: 'Response contains runtime version and a DB connection string.',
      evidence: { kind: 'http', tool: 'fetch', command: `curl ${base}/health`, request: 'GET /health HTTP/1.1', response: body.slice(0, 300) },
    }, ctx);
    return true;
  }
  return false;
});

add('missing security headers', async () => {
  const r = await fetch(`${base}/`);
  const missing = ['content-security-policy', 'x-frame-options', 'strict-transport-security']
    .filter((h) => !r.headers.get(h));
  if (missing.length === 3) {
    tools.vapt_finding_add.execute({
      target: base, title: 'Missing security headers (CSP, X-Frame-Options, HSTS)',
      severity: 'low', status: 'confirmed', confidence: 'observed', cwe: 'CWE-693', cvss: 3.1,
      detail: `Missing: ${missing.join(', ')}`,
      evidence: { kind: 'http', tool: 'fetch', command: `curl -I ${base}/`, request: 'HEAD / HTTP/1.1', response: 'no CSP / X-Frame-Options / HSTS' },
    }, ctx);
    return true;
  }
  return false;
});

/* ── 跑基准 ────────────────────────────────────────────────── */
let detected = 0;
const rows = [];
for (const p of probes) {
  const ok = await p.fn();
  if (ok) detected += 1;
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${p.name}`);
}
const findings = store.listFindings(id);
const deliverable = store.deliverable(findings);
const evidence = store.listEvidence(id);
const withEvidence = deliverable.filter((f) => evidence.some((e) => e.finding_id === f.id)).length;
const missingEvidence = deliverable.length - withEvidence;

// 去重复测：把同一个探测再跑一遍，确认事实库不会翻倍
const before = store.listFindings(id).length;
await probes[0].fn();
const after = store.listFindings(id).length;

const out = writeReports(store, id);
const report = readFileSync(out.zh, 'utf8');
const reportOk = {
  mermaid: /```mermaid/.test(report),
  remediation: /### 修复建议/.test(report),
  cwe: /CWE-306/.test(report),
};
fixture.close();

const score = {
  schema: 'dsh-vapt/bench@1',
  fixture: 'bench/fixture.mjs',
  probes: probes.length,
  detected,
  detection_rate: `${detected}/${probes.length}`,
  deliverable: deliverable.length,
  evidence_coverage: `${withEvidence}/${deliverable.length}`,
  dedup_stable: before === after,
  report: reportOk,
  elapsed_ms: Date.now() - t0,
  rows,
};
writeFileSync(join(HERE, 'last-run.json'), `${JSON.stringify(score, null, 2)}\n`, 'utf8');

console.log(rows.join('\n'));
console.log('');
console.log(`detection      ${score.detection_rate}`);
console.log(`evidence       ${score.evidence_coverage} (missing ${missingEvidence})`);
console.log(`dedup stable   ${score.dedup_stable}`);
console.log(`report         mermaid=${reportOk.mermaid} remediation=${reportOk.remediation} cwe=${reportOk.cwe}`);
console.log(`elapsed        ${score.elapsed_ms}ms`);
process.exitCode = detected === probes.length && missingEvidence === 0 && score.dedup_stable ? 0 : 1;
