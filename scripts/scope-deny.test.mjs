import assert from 'node:assert/strict';
import test from 'node:test';
import { checkScope, ipInCidr } from '../src/pentest/scope.js';

test('IPv4 scope requires a valid address and one decimal mask length', () => {
  for (const range of [
    '192.0.2.1/', '192.0.2.1/ ', '192.0.2.1/24/16', '192.0.2.1/24/',
    '192.0.2.1/+1', '192.0.2.1/1e1', '192.0.2.1/33', '192.0.2.1/00',
    '192.0..1/24', '192.0.256.1/24', '192.0.2.01/24',
  ]) {
    assert.equal(ipInCidr('192.0.2.1', range), false, range);
    assert.equal(checkScope('192.0.2.1', { scope: [range] }).ok, false, range);
    assert.equal(checkScope('192.0.2.1', { scope: ['192.0.2.0/24'], excludes: [range] }).ok, false, range);
  }
  assert.equal(ipInCidr('192.0..1', '0.0.0.0/0'), false);
  assert.equal(ipInCidr('192.0.2.1', '192.0.2.1'), true);
  assert.equal(ipInCidr('192.0.2.1', '192.0.2.1/32'), true);
  assert.equal(ipInCidr('192.0.2.1', '192.0.2.128/25'), false);
  assert.equal(ipInCidr('192.0.2.1', '0.0.0.0/0'), true);
});

test('domain and wildcard exclusions cover the named branch including one DNS root dot', () => {
  for (const excluded of ['archive.example.invalid', 'ARCHIVE.example.invalid.', '*.archive.example.invalid.']) {
    const meta = { scope: ['example.invalid', 'example.invalid.'], excludes: [excluded] };
    for (const target of ['archive.example.invalid', 'archive.example.invalid.', 'index.archive.example.invalid', 'index.archive.example.invalid.']) {
      assert.equal(checkScope(target, meta).reason, 'excluded', `${target} with ${excluded}`);
    }
    assert.equal(checkScope('publicarchive.example.invalid', meta).ok, true);
  }
});

test('root-dot handling preserves a narrow allow list and built-in denials', () => {
  assert.equal(checkScope('index.example.invalid.', { scope: ['example.invalid'] }).ok, false);
  assert.equal(checkScope('metadata.google.internal.', { scope: ['google.internal.'] }).reason, 'metadata');
  assert.equal(checkScope('192.0.2.1.', { scope: ['192.0.2.1.'], excludes: ['192.0.2.0/24'] }).reason, 'excluded');
});
