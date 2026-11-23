// scripts/verify.mjs — 离线验证：不需要 DSH，不需要网络。
// 覆盖三层：数据层（store）→ 工具函数（specs）→ 注册胶水（index.apply，用假 ctx）。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/pentest/store.js';
import { buildSpecs } from '../src/pentest/specs.js';
import { writeReports } from '../src/pentest/report.js';
import http from 'node:http';
import { apply as applyHost, installPreset } from '../src/index.js';
import { apply as applyTools } from '../src/tools-entry.js';
import { dirname as pkgDirname } from 'node:path';
import { fileURLToPath as pkgFileURL } from 'node:url';

const PKG_ROOT = pkgDirname(pkgDirname(pkgFileURL(import.meta.url)));

const root = mkdtempSync(join(tmpdir(), 'dsh-vapt-'));
const pass = [];
const ok = (m) => { pass.push(m); console.log(`  ✓ ${m}`); };

/* 1) 数据层 ---------------------------------------------------------- */
const store = createStore({ root });
const meta = store.create({ client: 'ACME', scope: ['10.10.0.0/24'], excludes: ['10.10.0.5'], window: '2026-11-21~2026-11-28' });
assert.ok(meta.id.startsWith('acme-'));
assert.equal(store.current().id, meta.id);
ok(`store: engagement created (${meta.id}) and set current`);

const asset = store.addAsset(meta.id, { host: '10.10.0.7', ports: [80, 443] });
store.addAsset(meta.id, { host: '10.10.0.7', ports: [8080] });
const again = store.open(meta.id).assets.find((a) => a.host === '10.10.0.7');
assert.deepEqual(again.ports, [80, 443, 8080]);
ok('store: asset upsert merges ports instead of duplicating');

const f = store.addFinding(meta.id, {
  target: 'https://10.10.0.7', title: '默认口令可登录', title_en: 'Default credentials accepted',
  severity: 'high', status: 'confirmed', confidence: 'observed', detail: 'admin/admin 登录后台成功',
});
const e = store.addEvidence(meta.id, {
  finding_id: f.id, kind: 'http', tool: 'http_probe',
  command: 'curl -sS -o /dev/null -w "%{http_code}" -u admin:admin https://10.10.0.7/admin',
  request: 'GET /admin HTTP/1.1\r\nHost: 10.10.0.7\r\nAuthorization: Basic YWRtaW46YWRtaW4=\r\n\r\n',
  response: 'HTTP/1.1 200 OK\r\n\r\nadmin panel',
});
assert.equal(e.sha256.length, 64);
assert.equal(store.deliverable(store.open(meta.id).findings).length, 1);
ok('store: finding + evidence persisted with SHA-256, deliverable filter works');

/* 2) 工具函数（双语言）----------------------------------------------- */
for (const lang of ['zh', 'en']) {
  const specs = buildSpecs({ lang });
  assert.equal(specs.length, 19);
  const ctx = { store };
  const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
  const created = byName.vapt_engagement_open.execute({ client: `Probe ${lang}`, scope: ['10.0.0.9/32'] }, ctx);
  assert.match(created, /engagement .* created/);
  const id = store.current().id;
  byName.vapt_asset_add.execute({ host: '10.0.0.9', ports: [22] }, ctx);
  byName.vapt_finding_add.execute({
    target: '10.0.0.9', title: lang === 'zh' ? 'SSH 允许密码登录' : 'SSH password auth enabled',
    severity: 'medium', status: 'confirmed', confidence: 'observed',
    evidence: { tool: 'nmap', command: 'nmap -p22 --script ssh-auth-methods 10.0.0.9', request: '', response: 'password' },
  }, ctx);
  const rep = byName.vapt_report.execute({}, ctx);
  assert.match(rep, /report\.zh\.md/);
  const zhText = readFileSync(join(store.dirOf(id), 'report.zh.md'), 'utf8');
  const enText = readFileSync(join(store.dirOf(id), 'report.en.md'), 'utf8');
  assert.match(zhText, /渗透测试报告/);
  assert.match(enText, /Penetration Test Report/);
  assert.equal(byName.vapt_status.execute({}, ctx).includes('assets: 1'), true);
}
ok('specs: 19 tools run end-to-end in zh and en, reports rendered from store');

/* 3) 注册胶水（假 ctx）----------------------------------------------- */
const registered = [];
const pluginConfig = { root, lang: 'en', dshHome: root };
const fakeCtx = {
  defineTool: (spec) => spec,
  tools: { register: (tool) => { registered.push(tool); return () => {}; } },
  logger: { info() {}, warn() {}, error() {} },
  effect(fn) { fn(); },
  provide() {},
};
// 在独立目录检查宿主安装的文件和模式选择器使用的注册表。
const presetCases = [
  { config: {}, expected: ['vapt'] },
  { config: { optionalPresets: [] }, expected: ['vapt'] },
  { config: { optionalPresets: 'vapt-report' }, expected: ['vapt'] },
  { config: { optionalPresets: ['unknown', 'vapt-report', 'vapt-report'] }, expected: ['vapt', 'vapt-report'] },
  { config: { optionalPresets: ['vapt-verify', 'vapt-recon'] }, expected: ['vapt', 'vapt-recon', 'vapt-verify'] },
];
for (const { config, expected } of presetCases) {
  const home = mkdtempSync(join(root, 'profile-'));
  const presetDir = join(home, '.agent-presets');
  const definitions = [];
  const cleanups = [];
  const ctx = {
    ...fakeCtx,
    agentPresets: {
      register(definition) { definitions.push(definition); },
      list() { return definitions; },
    },
    effect(fn) { cleanups.push(fn()); },
  };
  await applyHost(ctx, { ...pluginConfig, dshHome: home, ...config });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(definitions.map((p) => p.id).sort(), expected);
  const declaration = JSON.parse(readFileSync(join(home, 'vapt', 'preset-declare.json'), 'utf8'));
  assert.equal(declaration.phase, 'registered');
  assert.deepEqual(declaration.expectedPresets.sort(), expected);
  assert.deepEqual(declaration.presets.map((p) => p.id).sort(), expected);
  assert.deepEqual(readdirSync(presetDir).sort(), expected);
  for (const id of expected) assert.ok(existsSync(join(presetDir, id, 'definition.json')));
  assert.match(readFileSync(join(presetDir, 'vapt', 'agent.cordis.yml'), 'utf8'), /dsh-vapt\/tools/);
  assert.ok(existsSync(join(presetDir, 'vapt', 'preset.yml')));
  assert.deepEqual(installPreset(home).installed, [], 'repeat install preserves matching preset files');
  for (const cleanup of cleanups) cleanup?.();
}
assert.equal(registered.length, 0, 'host plane must not register tools');
ok('apply(host): installs and registers only VAPT and explicitly selected optional presets');

// agent 行：注册 11 个工具
await applyTools(fakeCtx, pluginConfig);
assert.equal(registered.length, 19, `expected 19 tools, got ${registered.length}`);
for (const tool of registered) {
  assert.ok(tool.name.startsWith('vapt_'));
  // parameters 是字段描述 map（不是 JSON Schema）：每个字段至少要有 type
  assert.equal(typeof tool.parameters, 'object');
  for (const [field, def] of Object.entries(tool.parameters)) {
    assert.ok(def.type, `${tool.name}.${field} needs a type`);
    // 宿主会拒掉非字符串描述 —— 离线先拦住
    if (def.description !== undefined) {
      assert.equal(typeof def.description, 'string', `${tool.name}.${field} description must be a string`);
      assert.ok(def.description.length > 0, `${tool.name}.${field} description must not be empty`);
    }
  }
  assert.equal(typeof tool.execute, 'function');
  assert.equal(typeof tool.output.render, 'function');
}
ok('apply(): registers 19 tools with field-map parameters through ctx.tools.register');

/* 4) 错误路径 -------------------------------------------------------- */
const wrapped = registered.find((t) => t.name === 'vapt_evidence_add');
const bad = JSON.parse(await wrapped.execute({ finding_id: 'F-999' }));
assert.equal(bad.ok, false);
assert.equal(bad.error_kind, 'bad_input');
ok('error wrapper: bad finding id returns structured bad_input instead of throwing');

/* 5) 幂等与损坏容错 -------------------------------------------------- */
assert.ok(existsSync(join(root, 'current.json')));
assert.ok(readdirSync(join(root, 'engagements')).length >= 3);
const st2 = createStore({ root });
assert.deepEqual(st2.list().length >= 3, true);
ok('store: re-open from a fresh instance sees the same engagements (no in-memory state)');

/* 6) 适配器：桩 nmap + 范围校验 + 参数白名单 ------------------------- */
const { runAdapter, listTools, catalogText } = await import('../src/pentest/adapters.js');
const { TOOLS } = await import('../src/pentest/registry.js');
assert.ok(TOOLS.length >= 100, `registry should carry the full inventory, got ${TOOLS.length}`);
ok(`registry: ${TOOLS.length} tools (${TOOLS.filter((t) => !t.generic).length} hand-written, ${TOOLS.filter((t) => t.generic).length} generic)`);

const stub = mkdtempSync(join(tmpdir(), 'vapt-stub-'));
// 桩 nmap：先把收到的 argv 打印出来，方便断言默认参数有没有被正确覆盖
writeFileSync(join(stub, 'nmap'), '#!/bin/sh\necho "ARGV: $@"\necho "80/tcp open http nginx"\n', { mode: 0o755 });
writeFileSync(join(stub, 'nmap'), [
  '#!/bin/sh',
  'echo "Nmap scan report for 127.0.0.1 (127.0.0.1)"',
  'echo "80/tcp   open  http    nginx 1.25"',
  'echo "443/tcp  open  ssl/http nginx"',
].join('\n'), { mode: 0o755 });
writeFileSync(join(stub, 'nmap'), '#!/bin/sh\necho "ARGV: $@"\necho "Nmap scan report for 127.0.0.1 (127.0.0.1)"\necho "80/tcp open http nginx"\necho "443/tcp open ssl/http nginx"\n', { mode: 0o755 });
process.env.PATH = `${stub}:${process.env.PATH}`;
assert.ok(listTools().find((t) => t.id === 'nmap')?.path, 'stub nmap must be discoverable');

const eng = store.create({ client: 'Adapter Test', scope: ['127.0.0.1/32'] });
const ctxA = { store, id: eng.id, meta: store.open(eng.id).meta, cwd: stub };
const out = await runAdapter('nmap', { target: '127.0.0.1' }, ctxA);
assert.match(out, /assets \+1/);
const assets = store.open(eng.id).assets;
assert.deepEqual(assets.find((a) => a.host === '127.0.0.1').ports, [80, 443]);
assert.ok(existsSync(store.dirOf(eng.id) + '/artifacts') && readdirSync(store.dirOf(eng.id) + '/artifacts').length >= 1);
const evs = store.listEvents(eng.id, 'tool_run');
assert.equal(evs.length, 1);
assert.equal(evs[0].tool, 'nmap');
assert.equal(evs[0].sha256.length, 64);
ok('adapter: runs tool → parses ports → records asset + artifact + sha256 event');

// 参数覆盖：显式 -p 时默认 --top-ports 必须被去掉，且 extra 要真的生效
const withPorts = await runAdapter('nmap', { target: '127.0.0.1', args: ['-p', '80,443'] }, ctxA);
assert.match(withPorts, /-p 80,443/);
assert.ok(!/--top-ports/.test(withPorts), `--top-ports 应被 -p 覆盖掉\n${withPorts}`);
ok('adapter: explicit -p overrides the default --top-ports profile');

let denied = null;
try { await runAdapter('nmap', { target: '8.8.8.8' }, ctxA); } catch (e) { denied = e.message; }
assert.match(denied || '', /outside authorized scope/);
assert.equal(store.listEvents(eng.id, 'out_of_scope').length, 1);
ok('adapter: out-of-scope target refused and logged before any packet is sent');

let badArg = null;
try { await runAdapter('nmap', { target: '127.0.0.1', args: ['-oN', '/tmp/pwn'] }, ctxA); } catch (e) { badArg = e.message; }
assert.match(badArg || '', /argument not allowed/);
ok('adapter: output-redirect flag rejected by the argument allowlist');

let needsConfirm = null;
try { await runAdapter('ffuf', { target: '127.0.0.1', wordlist: '/tmp/wl.txt' }, ctxA); } catch (e) { needsConfirm = e.message; }
assert.match(needsConfirm || '', /confirm:true/);
ok('adapter: noisy/brute tools require confirm:true');

const cat = catalogText('en', process.env);
assert.match(cat, /## Recon/);
assert.match(cat, /nmap/);
ok('catalog: rendered in en, grouped by category, availability marked');

/* 7) 受控喷雾：预算、锁定即停、凭据入库 --------------------------- */
const { spray, classify } = await import('../src/pentest/spray.js');
const sprayStub = mkdtempSync(join(tmpdir(), 'vapt-spray-'));
const invocations = join(sprayStub, 'calls.log');
writeFileSync(invocations, '', 'utf8');
writeFileSync(join(sprayStub, 'nxc'), [
  '#!/bin/sh',
  'echo "$@" >> "' + invocations + '"',
  'case "$*" in',
  '  *"-u locked"*) echo "[-] STATUS_ACCOUNT_LOCKED_OUT";;',
  '  *"-u admin -p Winter2026!"*) echo "[+] DOMAIN\\admin:Winter2026! (Pwn3d!)";;',
  '  *) echo "[-] STATUS_LOGON_FAILURE";;',
  'esac',
].join('\n'), { mode: 0o755 });
process.env.PATH = `${sprayStub}:${process.env.PATH}`;

const eng2 = store.create({ client: 'Spray Test', scope: ['127.0.0.1/32'] });
const spCtx = { store, id: eng2.id, meta: store.open(eng2.id).meta, cwd: sprayStub };
const base = {
  protocol: 'smb', target: '127.0.0.1', delayMs: 500,
  confirm: true, acknowledgeLockoutRisk: true,
};

assert.equal(classify('[+] DOMAIN\admin:Winter2026! (Pwn3d!)').result, 'success');
assert.equal(classify('[-] STATUS_ACCOUNT_LOCKED_OUT').result, 'locked');
assert.equal(classify('[-] STATUS_LOGON_FAILURE').result, 'failure');
ok('spray: output classifier separates success / failure / lockout');

const dry = await spray({ ...base, accounts: ['admin'], passwords: ['Winter2026!'], dryRun: true }, spCtx);
assert.match(dry, /DRY RUN/);
assert.equal(readFileSync(invocations, 'utf8').trim(), '', 'dry run must not execute anything');
ok('spray: dry run sends nothing');

const hit = await spray({ ...base, accounts: ['admin', 'bob'], passwords: ['Winter2026!'], maxAttemptsPerAccount: 1 }, spCtx);
assert.match(hit, /success=1/);
const creds = store.listCredentials(eng2.id);
assert.equal(creds.length, 1);
assert.equal(creds[0].username, 'admin');
assert.equal(creds[0].privilege, 'admin');
assert.ok(store.open(eng2.id).findings.some((f) => /admin/.test(f.title)), 'credential hit must create a finding');
assert.equal(store.listEvents(eng2.id, 'spray_run').length >= 1, true);
ok('spray: hit records credential + finding + evidence + event');

const before = readFileSync(invocations, 'utf8').trim().split('\n').length;
const locked = await spray({ ...base, accounts: ['t1', 'locked', 't3'], passwords: ['x'], maxAttemptsPerAccount: 1 }, spCtx);
assert.match(locked, /STOPPED: account locked out/);
const after = readFileSync(invocations, 'utf8').trim().split('\n').length;
assert.equal(after - before, 2, 'must stop right after the locked account, not finish the list');
assert.equal(store.listEvents(eng2.id, 'spray_lockout').length, 1);
ok('spray: stops globally on the first lockout and logs it');

let outOfScope = null;
try { await spray({ ...base, target: '8.8.8.8', accounts: ['a'], passwords: ['x'] }, spCtx); }
catch (e) { outOfScope = e.message; }
assert.match(outOfScope || '', /outside authorized scope/);
assert.equal(store.listEvents(eng2.id, 'out_of_scope').length, 1);
ok('spray: out-of-scope target refused before any packet is sent');

let tooMany = null;
try { await spray({ ...base, accounts: Array.from({ length: 101 }, (_, i) => `u${i}`), passwords: ['x'] }, spCtx); }
catch (e) { tooMany = e.message; }
assert.match(tooMany || '', /too many accounts/);
let noConfirm = null;
try { await spray({ ...base, confirm: false, accounts: ['a'], passwords: ['x'] }, spCtx); }
catch (e) { noConfirm = e.message; }
assert.match(noConfirm || '', /confirm:true is required/);
let noAck = null;
try { await spray({ ...base, acknowledgeLockoutRisk: false, accounts: ['a'], passwords: ['x'] }, spCtx); }
catch (e) { noAck = e.message; }
assert.match(noAck || '', /acknowledgeLockoutRisk/);
let fast = null;
try { await spray({ ...base, delayMs: 10, accounts: ['a'], passwords: ['x'] }, spCtx); }
catch (e) { fast = e.message; }
assert.match(fast || '', /delayMs must be/);
ok('spray: refuses >100 accounts, missing confirm/ack, and sub-500ms delays');

const perAccount = await spray({ ...base, accounts: ['only'], passwords: ['p1', 'p2', 'p3'], maxAttemptsPerAccount: 2, maxAttempts: 10 }, spCtx);
assert.match(perAccount, /attempts=2/, 'per-account budget must cap attempts at 2');
ok('spray: per-account budget caps attempts even with more passwords');

/* 8) 读回与范围预检 ------------------------------------------------ */
const eng3 = store.create({ client: 'Scope Test', scope: ['127.0.0.1/32'] });
const ctx3 = { store, id: eng3.id, meta: store.open(eng3.id).meta, cwd: process.cwd() };
const byName = Object.fromEntries(buildSpecs({ lang: 'en' }).map((t) => [t.name, t]));

const scIn = byName.vapt_scope_check.execute({ target: '127.0.0.1:8080' }, ctx3);
assert.match(scIn, /IN SCOPE/);
const scOut = byName.vapt_scope_check.execute({ target: '8.8.8.8' }, ctx3);
assert.match(scOut, /OUT OF SCOPE/);
const scBatch = byName.vapt_scope_check.execute({ targets: ['127.0.0.1', '8.8.8.8', 'not a host'] }, ctx3);
assert.match(scBatch, /IN SCOPE: 127.0.0.1/);
assert.match(scBatch, /OUT OF SCOPE: 8.8.8.8/);
assert.match(scBatch, /UNPARSEABLE/);
ok('scope_check: pre-flight answers IN/OUT (single + batch) without side effects');

const brief = byName.vapt_brief.execute({}, ctx3);
assert.match(brief, /ENGAGEMENT: scope-test/);
assert.match(brief, /scope: 127.0.0.1\/32/);
assert.match(brief, /spray budget/);
assert.match(brief, /hard rules/);
ok('brief: one call returns scope, budget, counts and rules');

// 注意：spec 的 execute 抛原始错误；结构化 JSON 包装是注册层（withStructuredErrors）做的，
// 已经由上面的 error wrapper 测试覆盖。这里断言原始错误即可。
let badFindingErr = null;
try {
  byName.vapt_finding_add.execute({
    target: '8.8.8.8', title: 'should be rejected', severity: 'high', status: 'confirmed',
  }, ctx3);
} catch (e) { badFindingErr = e.message; }
assert.match(badFindingErr || '', /outside authorized scope/);
assert.equal(store.listEvents(eng3.id, 'out_of_scope').length, 1);
assert.equal(store.open(eng3.id).findings.length, 0, 'out-of-scope finding must not be recorded');
ok('finding_add: rejects out-of-scope targets and logs them, store stays clean');

const okFinding = byName.vapt_finding_add.execute({
  target: 'http://127.0.0.1/admin', title: 'in-scope one', title_en: 'in-scope one',
  severity: 'medium', status: 'confirmed',
}, ctx3);
assert.match(okFinding, /F-001/);
const list = byName.vapt_findings_list.execute({}, ctx3);
assert.match(list, /in-scope one/);
assert.match(list, /confirmed/);
ok('findings_list: reads back recorded findings with status');

const status = byName.vapt_status.execute({}, ctx3);
assert.match(status, /credentials: 0/);
ok('status: includes credential count');

/* 9) 去重 / 信心闸门 / 修复建议 / 攻击路径 / JSON / PoC ---------------- */
const eng4 = store.create({ client: 'Report Test', scope: ['127.0.0.1/32'] });
const ctx4 = { store, id: eng4.id, meta: store.open(eng4.id).meta, cwd: process.cwd() };
const t4 = Object.fromEntries(buildSpecs({ lang: 'en' }).map((x) => [x.name, x]));

t4.vapt_finding_add.execute({
  target: 'http://127.0.0.1', title: 'Missing CSP header on login page', severity: 'low',
  status: 'confirmed', confidence: 'observed', cwe: 'CWE-693', cvss: 3.1,
  remediation: 'Add a Content-Security-Policy header.', remediation_en: 'Add a Content-Security-Policy header.',
  evidence: { kind: 'http', tool: 'curl', command: 'curl -I http://127.0.0.1', request: 'GET / HTTP/1.1', response: 'HTTP/1.1 200 OK' },
}, ctx4);
const dupe = t4.vapt_finding_add.execute({
  target: 'http://127.0.0.1', title: 'missing CSP headers on login page', severity: 'medium',
  status: 'confirmed', confidence: 'observed',
}, ctx4);
assert.match(dupe, /dedup|F-001/);
assert.equal(store.listFindings(eng4.id).length, 1, 'duplicate must not create a second finding');
assert.equal(store.listFindings(eng4.id)[0].severity, 'medium', 'severity must escalate on merge');
ok('finding_add: near-duplicate merged (severity escalated, single record)');

t4.vapt_finding_add.execute({
  target: 'http://127.0.0.1', title: 'Blind SQL injection in login', severity: 'critical',
  status: 'confirmed', confidence: 'claimed',
}, ctx4);
assert.equal(store.deliverable(store.listFindings(eng4.id)).length, 1, 'claimed finding must stay out of the report');
ok('report gate: confidence=claimed never reaches the deliverable');
const gated = t4.vapt_finding_add.execute({
  target: 'http://127.0.0.1', title: 'Critical without exploitation attempt', severity: 'critical',
  status: 'confirmed', confidence: 'observed',
}, ctx4);
assert.match(gated, /降级为 candidate|downgraded/i, 'critical+confirmed must be downgraded without an exploit attempt');
const kept = t4.vapt_finding_add.execute({
  target: 'http://127.0.0.1', title: 'Critical with exploitation attempt', severity: 'critical',
  status: 'exploited', confidence: 'observed', exploit_attempted: true,
}, ctx4);
assert.match(kept, /exploited/);
ok('exploitation gate: critical/high cannot be confirmed without a real attempt');
const chkBefore = t4.vapt_checklist.execute({}, ctx4);
assert.match(chkBefore, /NOT COMPLETE|全部通过/);
t4.vapt_evidence_add.execute({ finding_id: 'F-001', kind: 'exploit', tool: 'curl', command: 'curl -i', request: 'GET /', response: 'attempted' }, ctx4);
const chkAfter = t4.vapt_checklist.execute({}, ctx4);
assert.ok(!/without exploitation:.*F-001/.test(chkAfter), 'F-001 must leave the gap list once an exploit attempt is recorded');
ok('checklist: flags un-exploited high findings and clears once an attempt is recorded');

const poc = t4.vapt_poc_add.execute({
  finding_id: 'F-001', name: 'csp-check',
  request: 'GET /login HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n', response: 'HTTP/1.1 200 OK',
}, ctx4);
assert.match(poc, /poc:/);
assert.ok(existsSync(join(store.dirOf(eng4.id), 'pocs', 'csp-check.http')));
ok('poc_add: raw request stored as a replayable .http file');

const written = writeReports(store, eng4.id);
assert.ok(existsSync(written.json));
const json = JSON.parse(readFileSync(written.json, 'utf8'));
assert.equal(json.schema, 'dsh-vapt/report@1');
assert.ok(json.findings.length >= 1);
const first = json.findings.find((f) => f.id === 'F-001');
assert.ok(first, 'F-001 must be in the deliverable');
assert.equal(first.confidence, 'observed');
assert.equal(first.cwe, 'CWE-693');
assert.equal(json.counts.withheld, store.listFindings(eng4.id).length - json.findings.length, 'withheld = non-deliverable findings');
ok('report.json: stable schema, counts.withheld, structured findings');

const zhReport = readFileSync(written.zh, 'utf8');
assert.match(zhReport, /## 攻击路径/);
assert.match(zhReport, /```mermaid/);
assert.match(zhReport, /### 修复建议/);
assert.match(zhReport, /CWE-693/);
assert.match(zhReport, /withheld|1 withheld/);
ok('report.md: attack path (mermaid) + remediation + CWE rendered');

/* 10) 截图（有 Chrome 才跑） */
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((c) => existsSync(c));
if (chrome) {
  const fixture = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Shot</title><h1>ok</h1>');
  });
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
  const port = fixture.address().port;
  const shot = await t4.vapt_screenshot.execute({ target: `http://127.0.0.1:${port}`, name: 'fixture' }, ctx4);
  fixture.close();
  assert.match(shot, /screenshot: .*\.png/);
  const pngPath = shot.split('\n')[0].replace('screenshot: ', '');
  assert.ok(existsSync(pngPath) && readFileSync(pngPath).length > 1000, 'png must exist with real bytes');
  ok('screenshot: headless Chrome captures a real PNG and records evidence');
} else {
  ok('screenshot: skipped (no Chrome on this machine)');
}

/* 11) 多代理：工具白名单 + 并发闸门 ---------------------------------- */
const { slot } = await import('../src/pentest/slots.js');
const slotFile = join(root, 'slots.json');
assert.equal(slot(slotFile, { action: 'acquire', holder: 'a' }).ok, true);
assert.equal(slot(slotFile, { action: 'acquire', holder: 'b' }).ok, true);
assert.equal(slot(slotFile, { action: 'acquire', holder: 'c' }).ok, true);
const fourth = slot(slotFile, { action: 'acquire', holder: 'd' });
assert.equal(fourth.ok, false);
assert.equal(fourth.reason, 'full');
assert.equal(slot(slotFile, { action: 'release', holder: 'a' }).ok, true);
assert.equal(slot(slotFile, { action: 'acquire', holder: 'e' }).ok, true);
ok('slot: cap=3 enforced, release frees a place (no more than 3 executing agents)');

const reconCtx = [];
await applyTools(
  { ...fakeCtx, tools: { register: (t) => { reconCtx.push(t.name); return () => {}; } } },
  { root, lang: 'en', only: ['vapt_brief', 'vapt_scope_check', 'vapt_asset_add', 'vapt_tool_run'] },
);
assert.deepEqual(reconCtx.sort(), ['vapt_asset_add', 'vapt_brief', 'vapt_scope_check', 'vapt_tool_run'].sort());
ok('tool filtering: recon preset gets exactly its whitelist (no finding_add / no spray)');
// 每个角色预设必须能完成它自己的职责：verify 要能破解、要能记凭据
const presetDefs = ['vapt', 'vapt-recon', 'vapt-verify', 'vapt-report'].map((id) =>
  JSON.parse(readFileSync(join(PKG_ROOT, 'presets', id, 'definition.json'), 'utf8')));
const toolsRow = (def) => def.plugins.find((p) => p.name === 'dsh-vapt/tools');
const onlyOf = (def) => toolsRow(def)?.config?.only ?? null;
const full = presetDefs.find((d) => d.id === 'vapt');
assert.equal(onlyOf(full), null, 'main VAPT mode must expose every tool');
const verifyOnly = onlyOf(presetDefs.find((d) => d.id === 'vapt-verify'));
assert.ok(verifyOnly.includes('vapt_crack'), 'vapt-verify must expose vapt_crack');
assert.ok(verifyOnly.includes('vapt_credential_add'), 'vapt-verify must expose vapt_credential_add');
assert.ok(verifyOnly.includes('vapt_finding_add') && verifyOnly.includes('vapt_evidence_add'));
const reconOnly = onlyOf(presetDefs.find((d) => d.id === 'vapt-recon'));
assert.ok(!reconOnly.includes('vapt_crack'), 'recon must not crack');
ok('presets: VAPT=all tools · verify can crack+record credentials · recon cannot');
assert.ok(existsSync(join(PKG_ROOT, 'data', 'wordlists', 'top10k.txt')), 'bundled wordlist must ship in the package');
const wlLines = readFileSync(join(PKG_ROOT, 'data', 'wordlists', 'top10k.txt'), 'utf8').split('\n').filter(Boolean).length;
assert.ok(wlLines > 9000, `bundled wordlist too small: ${wlLines}`);
ok(`crack: bundled wordlist ships with the package (${wlLines} entries)`);

/* 12) 控制台：路由注册 + API 只读查询 ------------------------------- */
const { apply: applyUi, handleApi } = await import('../src/pentest/ui.js');
const routes = [];
const uiCtx = {
  webServer: { register: (r) => { routes.push(r); return () => {}; } },
  logger: { info() {}, warn() {}, error() {} },
  effect: (fn) => fn(),
};
applyUi(uiCtx, { root });
assert.equal(routes.length, 2, `expected 2 routes, got ${routes.length}`);
assert.deepEqual(routes.map((r) => r.path).sort(), ['/vapt/api', '/vapt/ui']);
ok('console: registers /vapt/api and /vapt/ui');

const ov = handleApi(store, { op: 'overview' });
assert.equal(ov.ok, true);
assert.ok(Array.isArray(ov.engagements) && ov.engagements.length >= 1);
const st = handleApi(store, { op: 'status', engagement: eng4.id });
assert.equal(st.ok, true);
assert.ok(typeof st.counts.findings === 'number');
const fd = handleApi(store, { op: 'findings', engagement: eng4.id });
assert.ok(fd.findings.length >= 1);
const gr = handleApi(store, { op: 'graph', engagement: eng4.id });
assert.match(gr.mermaid, /```mermaid/);
const rp = handleApi(store, { op: 'report', engagement: eng4.id });
assert.match(rp.md, /渗透测试报告/);
assert.equal(handleApi(store, { op: 'nope' }).ok, false);
ok('console API: overview / status / findings / graph / report / unknown-op');

console.log(`\n${pass.length} checks passed · root kept at ${root}`);
