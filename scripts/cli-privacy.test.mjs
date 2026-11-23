import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { apply, installPreset } from '../src/index.js';

const cli = fileURLToPath(new URL('../bin/dsh-vapt.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vapt-profile-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'dsh');
  const profiles = join(home, 'profiles');
  mkdirSync(profiles, { recursive: true });
  return { root, home, profiles };
}

test('invalid installer input cannot start DSH or modify adjacent files', { skip: process.platform === 'win32' }, t => {
  const { root, home, profiles } = fixture(t);
  const outside = join(home, 'other');
  mkdirSync(outside);
  const manifest = join(outside, 'package.json');
  const contents = '{"name":"fixture"}\n';
  writeFileSync(manifest, contents);
  symlinkSync(outside, join(profiles, 'linked'));
  for (const name of ['manifest-link', 'hard-link']) mkdirSync(join(profiles, name));
  symlinkSync(manifest, join(profiles, 'manifest-link', 'package.json'));
  linkSync(manifest, join(profiles, 'hard-link', 'package.json'));
  const malformed = join(profiles, 'malformed');
  mkdirSync(malformed);
  const malformedContents = '{"dsh":{"profile":{"bundles":"dsh-vapt"}}}';
  writeFileSync(join(malformed, 'package.json'), malformedContents);
  const stub = join(root, 'dsh-stub');
  writeFileSync(stub, '#!/bin/sh\ntouch "$VAPT_TEST_MARKER"\n', { mode: 0o700 });
  const marker = join(root, 'called');
  const env = { ...process.env, DSH_HOME: home, DSH_BIN: stub, VAPT_TEST_MARKER: marker };
  for (const args of [
    ['--profile', '../other'], ['--profile', 'one/two'], ['--profile', 'one\\two'],
    ['--profile', '..'], ['--profile'], ['--profile', '--package'], ['--package'],
    ['--profile=-x'], ['--package=-x'], ['--profile', 'linked'],
    ['--profile', 'manifest-link'], ['--profile', 'hard-link'], ['--profile', 'malformed'],
  ]) {
    const result = spawnSync(process.execPath, [cli, 'install', ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 2, JSON.stringify(args));
  }
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(manifest, 'utf8'), contents);
  assert.equal(readFileSync(join(malformed, 'package.json'), 'utf8'), malformedContents);
  symlinkSync(profiles, join(root, 'profiles'));
  const parentLink = spawnSync(process.execPath, [cli, 'install', '--profile', 'fresh'], {
    env: { ...env, DSH_HOME: root }, encoding: 'utf8',
  });
  assert.equal(parentLink.status, 2);
  assert.equal(existsSync(marker), false);
});

test('doctor detects failed or unexpected registrations and respects the custom data root', t => {
  const { root, home, profiles } = fixture(t);
  const pkg = join(profiles, 'test', 'node_modules', 'dsh-vapt');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"version":"1.0.0"}');
  writeFileSync(join(profiles, 'test', 'package.json'), '{"dsh":{"profile":{"bundles":["dsh-vapt"]}}}');
  const diagnostics = join(home, 'vapt');
  mkdirSync(diagnostics);
  const data = join(root, 'test-data');
  mkdirSync(join(data, 'engagements'), { recursive: true });
  const env = { ...process.env, DSH_HOME: home, DSH_BIN: process.execPath, VAPT_HOME: data };
  for (const [ok, ids, expected] of [[true, ['vapt'], 0], [false, ['vapt'], 1], [true, ['vapt', 'extra'], 1]]) {
    writeFileSync(join(diagnostics, 'preset-declare.json'), JSON.stringify({
      ok, expectedPresets: ['vapt'], presets: ids.map(id => ({ id })),
    }));
    const result = spawnSync(process.execPath, [cli, 'doctor'], { env, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stdout);
    assert.ok(result.stdout.includes(join(data, 'engagements')));
  }
});

test('loading a profile preserves custom directory permissions and local preset edits', async t => {
  const { root, home } = fixture(t);
  const data = join(root, 'existing-directory');
  mkdirSync(data);
  chmodSync(data, 0o750);
  const cleanups = [];
  const ctx = {
    agentPresets: { register: () => () => {}, list: () => [] },
    effect: fn => cleanups.push(fn()),
  };
  await apply(ctx, { root: data, dshHome: home });
  for (const cleanup of cleanups) cleanup();
  if (process.platform !== 'win32') assert.equal(statSync(data).mode & 0o777, 0o750);
  assert.throws(() => installPreset(home, '../other'), /preset ID/);
  const dir = join(home, '.agent-presets', 'vapt');
  writeFileSync(join(dir, '.installed.json'), 'null');
  writeFileSync(join(dir, 'preset.yml'), '# local customization\n');
  assert.ok(installPreset(home).skipped.includes('preset.yml'));
  assert.equal(readFileSync(join(dir, 'preset.yml'), 'utf8'), '# local customization\n');
});
