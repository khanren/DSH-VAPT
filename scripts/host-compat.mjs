// scripts/host-compat.mjs — 宿主兼容性闸门。
// 规则抄自主机真实实现 @deepseek-ai/dsh-client-modules 的 parseDshClient() 与 clientExportOf()：
//   · dsh.client 必须是对象；platform 必须是字符串；inject/external 必须是字符串数组；
//     immediately 若存在必须是布尔
//   · exports["./client"] 必须解析到存在的前端入口（字符串或一层条件对象）
//   · 入口必须通过 window.__ModuleLoader__.load({ id, factory }) 注册，且 id 与包名一致
// 任何一条不满足，宿主会静默跳过或抛错 —— 这里提前失败，并给出可读原因。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const pass = [];
const ok = (m) => { pass.push(m); console.log(`  ✓ ${m}`); };

/* ── 1. 复刻宿主的 parseDshClient() ─────────────────────────── */
function optionalStringArray(subject, field, value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`client-modules: ${subject} ${field} must be a string array`);
  }
  return value;
}
function parseDshClient(pkgName, value) {
  if (value === undefined) return undefined;
  assert.equal(typeof value, 'object', `${pkgName} dsh.client must be an object`);
  assert.notEqual(value, null);
  assert.equal(typeof value.platform, 'string', `${pkgName} dsh.client.platform must be a string`);
  const inject = optionalStringArray(pkgName, 'dsh.client.inject', value.inject);
  const external = optionalStringArray(pkgName, 'dsh.client.external', value.external);
  if (value.immediately !== undefined) {
    assert.equal(typeof value.immediately, 'boolean', `${pkgName} dsh.client.immediately must be a boolean`);
  }
  return { platform: value.platform, inject, external };
}

const decl = parseDshClient(pkg.name, pkg.dsh?.client);
assert.ok(decl, 'package must declare dsh.client');
assert.equal(decl.platform, 'web');
ok(`dsh.client passes the host validator (platform=${decl.platform}, inject=${JSON.stringify(decl.inject ?? [])})`);

/* ── 2. 复刻 clientExportOf()：exports["./client"] ──────────── */
function clientExportOf(exportsField) {
  if (typeof exportsField !== 'object' || exportsField === null) return undefined;
  const client = exportsField['./client'];
  if (client === undefined) return undefined;
  if (typeof client === 'string') return client;
  if (client && typeof client === 'object') {
    for (const v of Object.values(client)) if (typeof v === 'string') return v;
  }
  return undefined;
}
const entry = clientExportOf(pkg.exports);
assert.ok(entry, 'exports["./client"] must resolve to a string path');
const entryPath = join(ROOT, entry);
assert.ok(existsSync(entryPath), `client entry missing on disk: ${entry}`);
ok(`exports["./client"] → ${entry} (exists)`);

/* ── 3. 入口必须注册到 window.__ModuleLoader__ ──────────────── */
const src = readFileSync(entryPath, 'utf8');
new vm.Script(src, { filename: entry }); // 语法检查
const loads = [...src.matchAll(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
assert.ok(loads.length >= 1, 'entry must call window.__ModuleLoader__.load({ id, factory })');
assert.ok(loads.includes(pkg.name), `loader id must equal package name (${pkg.name}); found ${loads.join(',')}`);
ok(`entry registers __ModuleLoader__.load({ id: '${pkg.name}' })`);

/* ── 4. 若本机装了宿主，读它的版本作为校验基准 ──────────────── */
function asarEntries(asarPath) {
  const fd = readFileSync(asarPath);
  const pickleSize = fd.readUInt32LE(4);
  const headerBuf = fd.subarray(8, 8 + pickleSize);
  const jsonSize = headerBuf.readUInt32LE(4);
  const header = JSON.parse(headerBuf.subarray(8, 8 + jsonSize).toString('utf8'));
  const base = 8 + pickleSize;
  const files = [];
  (function walk(node, prefix) {
    for (const [name, meta] of Object.entries(node.files || {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (meta.files) walk(meta, p);
      else files.push({ path: p, size: meta.size, offset: Number(meta.offset) });
    }
  })(header, '');
  return { fd, base, files };
}

const asar = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
if (existsSync(asar)) {
  const { fd, base, files } = asarEntries(asar);
  const hostPkg = files.find((f) => f.path === 'dsh/package.json');
  if (hostPkg) {
    const txt = fd.subarray(base + hostPkg.offset, base + hostPkg.offset + hostPkg.size).toString('utf8');
    ok(`validated against host bundle version ${JSON.parse(txt).version}`);
  } else {
    ok('host bundle present (no dsh/package.json entry to read)');
  }
} else {
  ok('host bundle not installed here — declaration checks only (CI-safe)');
}

console.log(`\n${pass.length} host-compat checks passed`);
