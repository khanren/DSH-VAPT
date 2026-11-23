// scripts/mcp-smoke.mjs — 不依赖 DSH，直接以 stdio JSON-RPC 驱动 mcp/server.mjs。
// Exercise the published MCP interface using only local, fictional records.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'mcp', 'server.mjs');
assert.ok(existsSync(SERVER), 'mcp/server.mjs missing');

const home = mkdtempSync(join(tmpdir(), 'vapt-mcp-'));
const env = { ...process.env, DSH_HOME: join(home, 'dsh'), VAPT_HOME: home, VAPT_ROOT: home,
  VAPT_LANG: 'en', VAPT_ENGAGEMENT: '', VAPT_SCOPE: '' };
const child = spawn(process.execPath, [SERVER], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
process.on('exit', () => {
  child.kill();
  rmSync(home, { recursive: true, force: true });
});

let buf = '';
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000).unref();
  });
}

const pass = [];
const ok = (m) => { pass.push(m); console.log(`  ✓ ${m}`); };

const init = await rpc('initialize', {});
assert.equal(init.result.serverInfo.name, 'dsh-vapt');
ok('initialize: serverInfo.name = dsh-vapt');

const list = await rpc('tools/list', {});
const expected = [
  'vapt_asset_add', 'vapt_brief', 'vapt_credential_add', 'vapt_credential_list',
  'vapt_engagement_open', 'vapt_evidence_add', 'vapt_finding_add', 'vapt_findings_list',
  'vapt_poc_add', 'vapt_report', 'vapt_scope_check', 'vapt_slot', 'vapt_status', 'vapt_tool_list',
];
assert.deepEqual(list.result.tools.map((tool) => tool.name).sort(), expected);
assert.ok(list.result.tools.every((t) => t.inputSchema?.type === 'object'));
ok(`tools/list: ${list.result.tools.length} tools with object input schemas`);

const malformed = await rpc('tools/call', { name: 'vapt_engagement_open', arguments: {} });
assert.equal(malformed.result.isError, true);
assert.match(malformed.result.content[0].text, /required field: arguments.client/);
const invalidName = await rpc('tools/call', { name: {} });
assert.equal(invalidName.error.code, -32602);
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: {
  name: 'vapt_engagement_open', arguments: { client: 'Unrequested record' },
} }) + '\n');
await rpc('ping', {});
assert.equal(existsSync(join(home, 'current.json')), false);
ok('invalid parameters and notifications leave the empty store untouched');

const open = await rpc('tools/call', {
  name: 'vapt_engagement_open',
  arguments: { client: 'MCP smoke', scope: ['127.0.0.1/32'] },
});
assert.match(open.result.content[0].text, /created/);
ok('tools/call: engagement_create');

const denied = await rpc('tools/call', { name: 'vapt_scope_check', arguments: { target: '8.8.8.8' } });
assert.match(denied.result.content[0].text, /OUT OF SCOPE/);
ok('tools/call: out-of-scope target refused by the tool layer');

const status = await rpc('tools/call', { name: 'vapt_status', arguments: {} });
assert.match(status.result.content[0].text, /engagement:/i);
ok('tools/call: status reads back the store');

for (const name of ['vapt_tool_run', 'vapt_password_spray', 'vapt_screenshot', 'constructor', 'nope']) {
  const rejected = await rpc('tools/call', { name, arguments: {} });
  assert.equal(rejected.result.isError, true);
  assert.equal(rejected.result.content[0].text, `unknown tool: ${name}`);
}
ok('direct calls to the three DSH-only tools and to unknown names are rejected');

async function call(name, args = {}) {
  const reply = await rpc('tools/call', { name, arguments: args });
  assert.ok(!reply.result.isError, reply.result.content[0].text);
  return reply.result.content[0].text;
}

const engagement = /^engagement (\S+) created/m.exec(open.result.content[0].text)[1];
assert.match(await call('vapt_brief'), /client: MCP smoke/);
const slots = JSON.parse(await call('vapt_slot', { action: 'status' }));
assert.equal(slots.ok, true);
assert.equal(slots.used, 0);
assert.deepEqual(slots.holders, []);
assert.ok((await call('vapt_tool_list', { all: true })).includes('## '));
ok('brief, empty slot status and the tool directory can be read');
const target = '127.0.0.1';
for (const [name, args] of [
  ['vapt_asset_add', { host: target, ports: ['bad type'] }],
  ['vapt_finding_add', { target, title: 'Fixture', severity: 'unknown' }],
  ['vapt_finding_add', { target, title: 'Fixture', severity: 'low', evidence: { command: 42 } }],
]) {
  const invalid = await rpc('tools/call', { name, arguments: args });
  assert.equal(invalid.result.isError, true);
}
assert.match(await call('vapt_status'), /assets: 0 · findings: 0/);
ok('schema checks reject malformed record fields before writing');
await call('vapt_asset_add', { host: target, ports: [] });
const finding = await call('vapt_finding_add', {
  target, title: '缺少維護人', title_en: 'Missing inventory owner', severity: 'low',
  status: 'confirmed', confidence: 'observed',
});
const findingId = /^(F-\d+)/.exec(finding)[1];
await call('vapt_finding_add', { target, title: 'Unreviewed inventory note', severity: 'info' });
const response = '{"owner":null}';
const digest = createHash('sha256').update(`inventory\n\n\n${response}`).digest('hex');
const evidence = await call('vapt_evidence_add', {
  finding_id: findingId, kind: 'inventory', tool: 'inventory', response,
});
assert.ok(evidence.includes(digest));
assert.match(await call('vapt_findings_list'), /Unreviewed inventory note/);
ok('asset and finding recorded, candidate retained, evidence linked by SHA-256');

await call('vapt_credential_add', { host: target, username: 'fixture-user', secret: '9!Z', source: 'fixture' });
const credentials = await call('vapt_credential_list');
assert.match(credentials, /fixture-user/);
assert.ok(!credentials.includes('9!Z'));
ok('short credential is fully masked in tool output');

const second = await call('vapt_engagement_open', { client: 'Independent fixture', scope: [] });
const secondId = /^engagement (\S+) created/m.exec(second)[1];
assert.match(await call('vapt_status'), /assets: 0 · findings: 0/);
assert.match(await call('vapt_status', { engagement }), /assets: 1 · findings: 2 \(deliverable 1\) · evidence: 1 · credentials: 1/);
const exported = await call('vapt_report', { engagement });
const dir = join(home, 'engagements', engagement);
const read = (name) => {
  const path = join(dir, name);
  assert.ok(exported.includes(path));
  return readFileSync(path, 'utf8');
};
const zh = read('report.zh.md'), en = read('report.en.md'), json = read('report.json');
assert.match(zh, /缺少維護人/);
assert.match(en, /Missing inventory owner/);
for (const content of [zh, en, json]) {
  assert.ok(content.includes(digest));
  assert.ok(!content.includes('Unreviewed inventory note'));
  assert.ok(!content.includes('9!Z'));
}
const report = JSON.parse(json);
assert.equal(report.engagement.id, engagement);
assert.equal(report.findings[0].evidence[0].sha256, digest);
assert.deepEqual(report.counts, { findings: 1, withheld: 1, assets: 1, evidence: 1, credentials: 1 });
ok('explicit engagement selection stays isolated and exports both languages and matching JSON');

const pinnedReply = spawnSync(process.execPath, [SERVER], {
  env: { ...env, VAPT_ENGAGEMENT: engagement },
  encoding: 'utf8', timeout: 15000,
  input: [{}, { engagement: secondId }].map((args, index) => JSON.stringify({
    jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'vapt_status', arguments: args },
  })).join('\n') + '\n',
});
assert.equal(pinnedReply.status, 0, pinnedReply.stderr);
const pinnedResults = pinnedReply.stdout.trim().split('\n').map((line) => JSON.parse(line).result);
assert.equal(pinnedResults.length, 2);
assert.match(pinnedResults[0].content[0].text, /client: MCP smoke/);
assert.match(pinnedResults[1].content[0].text, /client: Independent fixture/);
assert.match(await call('vapt_status'), /client: Independent fixture/);
ok('a pinned client and an explicit selection leave the shared current engagement intact');

const request = 'GET /catalogue HTTP/1.1\nHost: archive.example.invalid';
const recorded = await call('vapt_poc_add', { name: 'catalogue', request });
const archive = /^poc: (.+)$/m.exec(recorded)[1];
assert.ok(archive.startsWith(join(home, 'engagements', secondId) + sep));
assert.equal(readFileSync(archive, 'utf8'), request + '\n');
if (process.platform !== 'win32') assert.equal(statSync(archive).mode & 0o777, 0o600);
assert.match(await call('vapt_status'), /evidence: 1/);
ok('a fictional request is archived locally with private permissions and an evidence record');

child.kill();
console.log(`\n${pass.length} MCP checks passed`);
