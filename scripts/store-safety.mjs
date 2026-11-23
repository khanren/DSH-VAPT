import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createStore } from '../src/pentest/store.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vapt-store-safety-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createStore({ root }) };
}

function assertPrivate(file) {
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600, file);
}

test('new store data and replacement files are private even under a permissive umask', (t) => {
  const { root, store } = fixture(t);
  const previous = process.umask(0);
  try {
    const { id } = store.create({ client: 'Paper Library' });
    const dir = store.dirOf(id);
    for (const file of ['assets.json', 'credentials.json', 'engagement.json', 'evidence.json', 'events.jsonl', 'findings.json']) {
      assertPrivate(join(dir, file));
    }
    assertPrivate(join(root, 'current.json'));
    const record = { host: 'catalog.example', username: 'sample', secret: 'fictional' };
    const file = join(dir, 'credentials.json');
    for (let i = 0; i < 2; i += 1) {
      chmodSync(file, 0o644);
      store.addCredential(id, record);
      assertPrivate(file);
    }
    assert.equal(store.listCredentials(id).length, 1);
  } finally {
    process.umask(previous);
  }
});

test('opening missing and older engagements is read-only', (t) => {
  const { root, store } = fixture(t);
  assert.equal(store.open('unknown'), null);
  assert.deepEqual(readdirSync(root), []);
  const id = '紙舟-20260101-120f';
  const dir = store.dirOf(id);
  mkdirSync(dir, { recursive: true });
  const meta = { id, client: 'Paper Library', schema_version: 1 };
  writeFileSync(join(dir, 'engagement.json'), JSON.stringify(meta));
  assert.deepEqual(store.open(id), { meta, findings: [], evidence: [], assets: [], credentials: [] });
  assert.deepEqual(readdirSync(dir), ['engagement.json']);
});

test('selection accepts one directory name and refuses linked store entries', (t) => {
  const { root, store } = fixture(t);
  for (const id of ['', '.', '..', 'one/two', 'one\\two', 'drive:name']) {
    assert.throws(() => store.open(id), /invalid engagement ID/);
    assert.throws(() => store.setCurrent(id), /invalid engagement ID/);
  }
  assert.equal(existsSync(join(root, 'current.json')), false);
  if (process.platform !== 'win32') {
    const { id } = store.create({ client: 'Paper Library' });
    symlinkSync(store.dirOf(id), join(root, 'engagements', 'alias'));
    assert.throws(() => store.open('alias'), /symbolic link/);
    const evidence = join(store.dirOf(id), 'evidence.json');
    rmSync(evidence);
    symlinkSync(join(store.dirOf(id), 'assets.json'), evidence);
    assert.throws(() => store.listEvidence(id), /symbolic link/);
  }
});

test('reads leave damaged tables alone and recovery keeps a private byte-for-byte copy', (t) => {
  const { store } = fixture(t);
  const { id } = store.create({ client: 'Paper Library' });
  const dir = store.dirOf(id);
  const file = join(dir, 'evidence.json');
  const damaged = Buffer.from('[{"note":"sample"}');
  writeFileSync(file, damaged);
  assert.deepEqual(store.listEvidence(id), []);
  assert.deepEqual(readFileSync(file), damaged);
  assert.equal(readdirSync(dir).filter((name) => name.endsWith('.corrupt')).length, 0);
  store.addEvidence(id, { kind: 'note', note: 'restored' });
  store.addEvidence(id, { kind: 'note', note: 'checked' });
  const backups = readdirSync(dir).filter((name) => name.endsWith('.corrupt'));
  assert.equal(backups.length, 1);
  const backup = join(dir, backups[0]);
  assert.deepEqual(readFileSync(backup), damaged);
  assertPrivate(backup);
  assert.deepEqual(store.listEvidence(id).map((e) => e.note), ['restored', 'checked']);
});

test('separate sessions retain all notes and unique record IDs', async (t) => {
  const { root, store } = fixture(t);
  const { id } = store.create({ client: 'Paper Library' });
  const moduleUrl = new URL('../src/pentest/store.js', import.meta.url).href;
  const worker = `
    import { createStore } from ${JSON.stringify(moduleUrl)};
    const [root, id, worker] = process.argv.slice(1);
    const store = createStore({ root });
    for (let i = 0; i < 15; i += 1) {
      store.addEvidence(id, { kind: 'note', note: worker + '-' + i });
    }
  `;
  const run = promisify(execFile);
  await Promise.all(Array.from({ length: 4 }, (_, i) =>
    run(process.execPath, ['--input-type=module', '-e', worker, root, id, String(i)])));
  const evidence = store.listEvidence(id);
  assert.equal(evidence.length, 60);
  assert.equal(new Set(evidence.map((e) => e.note)).size, 60);
  assert.equal(new Set(evidence.map((e) => e.id)).size, 60);
});

test('simultaneous stale-lock recovery preserves ownership and every write', async (t) => {
  const { root, store } = fixture(t);
  const moduleUrl = new URL('../src/pentest/store.js', import.meta.url).href;
  const run = promisify(execFile);
  const { id } = store.create({ client: 'Paper Library' });
  const lock = join(store.dirOf(id), 'evidence.json.lock');
  const old = new Date(Date.now() - 30_000);
  const workerCount = 6;
  const worker = `
    import { existsSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { createStore } from ${JSON.stringify(moduleUrl)};
    const [root, id, round, number] = process.argv.slice(1);
    const store = createStore({ root });
    const addEvidence = store._addEvidence;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    store._addEvidence = function (file, row) {
      // This sentinel must stay exclusive throughout the entire write.
      const sentinel = join(root, 'writer-active');
      writeFileSync(sentinel, number, { flag: 'wx' });
      try {
        const old = new Date(Date.now() - 30_000);
        utimesSync(file + '.lock', old, old);
        Atomics.wait(pause, 0, 0, 5);
        return addEvidence.call(this, file, row);
      } finally {
        unlinkSync(sentinel);
      }
    };
    writeFileSync(join(root, round + '-ready-' + number), '');
    while (!existsSync(join(root, round + '-go'))) Atomics.wait(pause, 0, 0, 2);
    for (let i = 0; i < 5; ++i) {
      store.addEvidence(id, { kind: 'note', note: [round, number, i].join('-') });
    }
  `;
  for (const round of ['legacy', 'abandoned']) {
    if (round === 'legacy') {
      writeFileSync(lock, '');
    } else {
      // Leave the real owner's marker in place by exiting while holding its lock.
      const stopDuringWrite = `
        import { createStore } from ${JSON.stringify(moduleUrl)};
        const [root, id] = process.argv.slice(1);
        const store = createStore({ root });
        store._addEvidence = () => process.exit(0);
        store.addEvidence(id, { kind: 'note' });
      `;
      await run(process.execPath, ['--input-type=module', '-e', stopDuringWrite, root, id]);
      assert.ok(statSync(lock).isDirectory());
    }
    utimesSync(lock, old, old);
    const jobs = Array.from({ length: workerCount }, (_, n) =>
      run(process.execPath, ['--input-type=module', '-e', worker, root, id, round, String(n)], { timeout: 15000 }));
    const releaseTogether = async () => {
      const deadline = Date.now() + 8000;
      while (readdirSync(root).filter((f) => f.startsWith(round + '-ready-')).length < workerCount) {
        assert.ok(Date.now() < deadline, 'all workers must reach the start barrier');
        await delay(5);
      }
      writeFileSync(join(root, round + '-go'), '');
    };
    await Promise.all([...jobs, releaseTogether()]);
    assert.equal(existsSync(lock), false);
  }
  const rows = store.listEvidence(id);
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map((row) => row.id)).size, 60);
  assert.equal(new Set(rows.map((row) => row.note)).size, 60);
});
