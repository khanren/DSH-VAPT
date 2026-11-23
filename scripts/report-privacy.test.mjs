import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { attackPathMermaid, writeReports } from '../src/pentest/report.js';
import { createStore } from '../src/pentest/store.js';
import { apply, handleApi } from '../src/pentest/ui.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vapt-report-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createStore({ root });
  const { id } = store.create({ client: 'Fictional archive' });
  const finding = store.addFinding(id, {
    target: 'catalogue.example.invalid/alpha', title: 'Owner "contact" missing',
    status: 'confirmed', confidence: 'observed',
  });
  const evidence = store.addEvidence(id, {
    finding_id: finding.id, kind: 'inventory', tool: 'fixture',
    command: 'fixture-command-marker', request: 'fixture-request-marker',
    response: 'fixture-response-marker\n```\nend of inventory', note: 'fixture-note-marker',
  });
  store.addCredential(id, { host: 'catalogue.example.invalid', username: 'fixture', secret: 'fixture-secret-marker' });
  return { root, store, id, evidence };
}

test('dashboard shows evidence metadata and report checksums', t => {
  const { store, id, evidence } = fixture(t);
  const metadata = handleApi(store, { op: 'evidence', engagement: id }).evidence;
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].sha256, evidence.sha256);
  assert.equal(metadata[0].finding_id, evidence.finding_id);
  for (const op of ['overview', 'status', 'assets', 'findings', 'graph', 'evidence', 'report']) {
    const result = handleApi(store, { op, engagement: id });
    assert.equal(result.ok, true);
    assert.doesNotMatch(JSON.stringify(result), /fixture-(?:command|request|response|note|secret)-marker/, op);
    if (op === 'report') {
      assert.ok(result.md.includes(evidence.sha256));
      assert.equal(result.json.findings[0].evidence[0].sha256, evidence.sha256);
    }
  }
});

test('file exports retain recorded evidence, protect Markdown fences, and use private permissions', t => {
  const { store, id } = fixture(t);
  const dir = store.dirOf(id);
  writeFileSync(join(dir, 'report.en.md'), 'previous export', { mode: 0o644 });
  const paths = writeReports(store, id);
  for (const [format, path] of Object.entries(paths)) {
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    const output = readFileSync(path, 'utf8');
    assert.doesNotMatch(output, /fixture-(?:secret|note)-marker/);
    if (format === 'json') {
      assert.equal(JSON.parse(output).findings[0].evidence[0].command, 'fixture-command-marker');
    } else {
      assert.match(output, /````http\nfixture-response-marker\n```\nend of inventory\n````/);
    }
  }
});

test('diagram keeps findings on distinct inventory records and escapes quoted labels', t => {
  const { store, id } = fixture(t);
  store.addFinding(id, {
    target: 'catalogue.example.invalid/beta', title: 'Missing retention field',
    status: 'confirmed', confidence: 'observed',
  });
  const diagram = attackPathMermaid(store, id, 'en');
  assert.match(diagram, /t1\["catalogue\.example\.invalid\/alpha"\]/);
  assert.match(diagram, /t2\["catalogue\.example\.invalid\/beta"\]/);
  assert.match(diagram, /t1 --> F-001\["\[medium\] Owner #34;contact#34; missing"\]/);
  assert.match(diagram, /t2 --> F-002/);
});

test('a long evidence record keeps the digest of the original fields in every export', t => {
  const { store, id, evidence } = fixture(t);
  const request = `Inventory\n${'清单'.repeat(10_000)}END-OF-REQUEST`;
  const response = `Catalog📚\n${'.'.repeat(20_000)}END-OF-RESPONSE`;
  const row = store.addEvidence(id, {
    finding_id: evidence.finding_id, tool: 'inventory', command: 'read catalogue', request, response,
  });
  const digest = createHash('sha256').update(['inventory', 'read catalogue', request, response].join('\n'), 'utf8').digest('hex');
  assert.equal(row.sha256, digest);
  const saved = store.listEvidence(id).find(e => e.id === row.id);
  assert.equal(saved.request, request.slice(0, 20_000));
  assert.equal(saved.response, response.slice(0, 20_000));
  const paths = writeReports(store, id);
  for (const lang of ['zh', 'en']) {
    const markdown = readFileSync(paths[lang], 'utf8');
    assert.ok(markdown.includes(digest));
    assert.ok(markdown.includes(request.slice(0, 20_000)));
    assert.ok(markdown.includes(response.slice(0, 2_000)));
    assert.ok(!markdown.includes(response.slice(0, 2_001)));
  }
  const json = JSON.parse(readFileSync(paths.json, 'utf8'));
  assert.equal(json.findings[0].evidence.find(e => e.id === row.id).sha256, digest);
});

test('record text cannot insert images, headings or table columns into either Markdown report', t => {
  const { store } = fixture(t);
  const badge = '![Archive badge](https://assets.example.invalid/badge.svg)';
  const client = `Archive <b>North</b>\n\n# Client section ${badge}`;
  const { id } = store.create({ client });
  const host = 'Records | North\n\n## Inventory section';
  store.addAsset(id, { host });
  const finding = store.addFinding(id, {
    target: 'catalogue.example.invalid', title: `中文 ${badge}`, title_en: `English ${badge}`,
    detail: 'First paragraph.\n\n# Detail section\n\nLast paragraph.',
    remediation: `Review <b>catalogue</b> and ${badge}`,
    status: 'confirmed', confidence: 'observed',
  });
  store.addCredential(id, { host, username: 'Alice | Bob', secret: 'do-not-export', source: badge });
  store.logEvent(id, 'out_of_scope', { tool: 'inventory', target: host, reason: 'Archived\n\n## Event section' });

  const paths = writeReports(store, id);
  for (const lang of ['zh', 'en']) {
    const markdown = readFileSync(paths[lang], 'utf8');
    // Mermaid has its own quoted-label grammar and is tested separately.
    const prose = markdown.replace(/^```mermaid\n[\s\S]*?^```$/gm, '');
    assert.ok(prose.includes(lang === 'en' ? 'English' : '中文'));
    assert.ok(!prose.includes(badge), lang);
    assert.doesNotMatch(prose, /<\/?b>|^#{1,6} (?:Client|Detail|Inventory|Event) section|do-not-export/m);
    assert.match(prose, /First paragraph\.\n\n[^\n]+\n\nLast paragraph\./);
    const rows = prose.split('\n').filter(line => line.startsWith('| '));
    assert.equal(rows.length, 4, 'two one-record tables with headers');
    for (const [index, row] of rows.entries()) {
      assert.equal(row.match(/(?<!\\)\|/g)?.length, index < 2 ? 3 : 7, row);
    }
  }
  const json = JSON.parse(readFileSync(paths.json, 'utf8'));
  assert.equal(json.engagement.client, client);
  assert.equal(json.findings[0].title, finding.title);
  assert.equal(json.findings[0].remediation, finding.remediation);
  assert.equal(json.assets[0].host, host);
  assert.equal(json.credentials[0].username, 'Alice | Bob');
  assert.doesNotMatch(JSON.stringify(json), /do-not-export/);
});

test('dashboard API checks the local connection, host and browser origin', async t => {
  const { root, store } = fixture(t);
  const routes = new Map();
  apply({ effect: effect => effect(), webServer: { register: route => routes.set(route.path, route) } }, { root });
  const { handler } = routes.get('/vapt/api');
  async function call(remoteAddress, headers, chunks = ['{"op":"overview"}']) {
    const req = Object.assign(Readable.from(chunks), { method: 'POST', socket: { remoteAddress }, headers });
    let status;
    let body;
    const res = { writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); } };
    await handler(req, res);
    return { status, body };
  }
  assert.equal((await call('127.0.0.1', { host: 'localhost:3100', origin: 'http://localhost:3100' })).status, 200);
  assert.equal((await call('::1', { host: '[::1]:3100' })).status, 200);
  assert.equal((await call('192.0.2.1', { host: 'localhost:3100' })).status, 403);
  assert.equal((await call('127.0.0.1', { host: 'catalogue.example.invalid' })).status, 403);
  assert.equal((await call('127.0.0.1', { host: 'localhost', origin: 'http://catalogue.example.invalid' })).status, 403);
  assert.equal((await call('127.0.0.1', { host: 'localhost:99999' })).status, 403);
  assert.equal((await call('::1', { host: 'localhost' }, [' '.repeat(17 * 1024)])).status, 413);

  const { id } = store.create({ client: '虚构档案' });
  const query = Buffer.from(JSON.stringify({ op: 'status', engagement: id }));
  const split = query.indexOf('虚') + 1;
  const response = await call('::1', { host: 'localhost' }, [query.subarray(0, split), query.subarray(split)]);
  assert.equal(response.body.engagement.id, id);
});
