// index.js — host 平面：数据层 + 预设安装 + 诊断标记。不注册模型工具（那在 dsh-vapt/tools）。
// 这样「标准模式」不会被 8 个渗透工具污染；只有选中 VAPT 模式（preset）时才挂上工具。
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './pentest/store.js';
import { resolveRoot, dshHome } from './pentest/paths.js';
import { writePrivateFile } from './pentest/atomic-file.js';

export const name = 'dsh-vapt';
export const inject = [];

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OPTIONAL_PRESETS = ['vapt-recon', 'vapt-verify', 'vapt-report'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * 把包内 presets/vapt 装到 $DSH_HOME/.agent-presets/vapt。
 * 幂等：manifest 记录我们写过的 sha256；文件被用户改过就不覆盖（只记日志）。
 */
export function installPreset(home = dshHome(), id = 'vapt') {
  if (id !== 'vapt' && !OPTIONAL_PRESETS.includes(id)) throw new Error('Unknown VAPT preset ID');
  const src = join(PKG_ROOT, 'presets', id);
  const parent = join(home, '.agent-presets');
  const dest = join(parent, id);
  if ([parent, dest].some(path => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())) {
    throw new Error('Refusing to write presets through a symbolic link');
  }
  const manifestPath = join(dest, '.installed.json');
  if (!existsSync(src)) return { id, dir: dest, installed: [], skipped: [], reason: 'no presets in package' };

  let manifest = { files: {} };
  try {
    const saved = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (saved?.files && typeof saved.files === 'object' && !Array.isArray(saved.files)) manifest = saved;
  } catch { /* first run */ }

  mkdirSync(dest, { recursive: true });
  const installed = [];
  const skipped = [];
  for (const f of readdirSync(src)) {
    const from = join(src, f);
    const to = join(dest, f);
    if (lstatSync(to, { throwIfNoEntry: false })?.isSymbolicLink()) { skipped.push(f); continue; }
    const next = readFileSync(from);
    const nextSha = sha256(next);
    if (existsSync(to)) {
      const currentSha = sha256(readFileSync(to));
      const ours = manifest.files?.[f];
      if (currentSha !== nextSha && currentSha !== ours) { skipped.push(f); continue; }
      if (currentSha === nextSha) { manifest.files[f] = nextSha; continue; }
    }
    writePrivateFile(to, next);
    manifest.files[f] = nextSha;
    installed.push(f);
  }
  writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { id, dir: dest, installed, skipped };
}

/** 安装主模式及当前 profile 选配的模式。 */
export function installPresets(home = dshHome(), optionalPresets = []) {
  const selected = Array.isArray(optionalPresets) ? optionalPresets : [];
  const ids = ['vapt', ...OPTIONAL_PRESETS.filter((id) => selected.includes(id))];
  return ids.map((id) => {
    try { return installPreset(home, id); }
    catch (err) { return { id, error: err?.message || String(err), installed: [], skipped: [] }; }
  });
}

export async function apply(ctx, config = {}) {
  // cordis 硬规则：读没 inject 的属性会抛，所以全部走 safe()
  const safe = (read, fallback = undefined) => { try { return read(); } catch { return fallback; } };
  const logger = safe(() => ctx.logger, null);

  const store = createStore({ root: resolveRoot(config.root) });
  try {
    mkdirSync(store.root, { recursive: true, mode: 0o700 });
    // Only migrate permissions on the plugin's own default directory.
    if (!config.root && !process.env.VAPT_HOME && lstatSync(store.root).isDirectory()) chmodSync(store.root, 0o700);
  } catch { /* ignore */ }
  try { ctx.provide?.('pentest', store); } catch { /* 同名服务已存在 */ }
  try { ctx.set?.('pentest', store); } catch { /* ignore */ }

  const home = config.dshHome || dshHome();
  const presets = installPresets(home, config.optionalPresets);
  const expectedPresets = presets.map((p) => p.id);
  const preset = { dirs: presets.map((p) => p.dir), installed: presets.reduce((n, p) => n + (p.installed?.length || 0), 0) };

  // 技能目录（VAPT 模式 preset 里已指向它；现在留空，后续放 skill）
  try { mkdirSync(join(home, 'vapt', 'skills'), { recursive: true }); } catch { /* ignore */ }

  // 关键：preset 只「落到目录」不会出现在模式下拉里，必须通过宿主的 agentPresets
  // 注册表声明。而这个服务在 apply 阶段往往还没就绪（dsh-purge 也是轮询等它的），
  // 所以这里做「限时轮询 + 登记状态」，状态写进 $DSH_HOME/vapt/preset-declare.json。
  const declareFile = join(home, 'vapt', 'preset-declare.json');
  const writeDeclare = (patch) => {
    try {
      mkdirSync(join(home, 'vapt'), { recursive: true, mode: 0o700 });
      let prev = {};
      if (patch.phase !== 'apply-start') {
        try { prev = JSON.parse(readFileSync(declareFile, 'utf8')); } catch { /* first */ }
      }
      writePrivateFile(declareFile, `${JSON.stringify({ ...prev, ...patch, at: new Date().toISOString() }, null, 2)}\n`);
    } catch { /* ignore */ }
  };
  const softRegistry = () => {
    try { if (ctx.agentPresets?.register) return ctx.agentPresets; } catch { /* without inject */ }
    try { const r = ctx.get('agentPresets'); if (r?.register) return r; } catch { /* missing */ }
    return null;
  };

  writeDeclare({ ok: false, phase: 'apply-start', expectedPresets, presets: [] });

  let stopped = false;
  const disposers = [];
  const disposePresets = () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* ignore */ }
    }
  };
  const registerOnce = async (registry) => {
    try {
      const done = [];
      for (const id of expectedPresets) {
        if (stopped) return;
        const definition = JSON.parse(readFileSync(join(PKG_ROOT, 'presets', id, 'definition.json'), 'utf8'));
        writeDeclare({ ok: false, phase: 'registering', id, name: definition.name, plugins: definition.plugins.length });
        const dispose = await registry.register(definition);
        if (stopped) { dispose?.(); return; }
        disposers.push(dispose);
        let broken = null;
        try { broken = (await registry.list()).find((row) => row.id === definition.id)?.broken || null; } catch { /* list 可选 */ }
        done.push({ id, name: definition.name, order: definition.order, plugins: definition.plugins.length, broken });
        if (broken) logger?.warn?.(`dsh-vapt: preset "${definition.id}" declared but broken: ${broken}`);
      }
      if (stopped) return;
      const ok = done.every((p) => !p.broken);
      writeDeclare({ ok, phase: ok ? 'registered' : 'registered-broken', presets: done });
      logger?.info?.(`dsh-vapt: ${done.length} preset(s) declared for the mode dropdown`);
    } catch (err) {
      if (stopped) return;
      disposePresets();
      writeDeclare({ ok: false, phase: 'register-failed', error: err?.message || String(err) });
      logger?.warn?.(`dsh-vapt: preset register failed: ${err?.message || err}`);
    }
  };

  const startedAt = Date.now();
  let timer = null;
  const tick = () => {
    if (stopped) return true;
    const registry = softRegistry();
    if (!registry) {
      if (Date.now() - startedAt > 30000) {
        writeDeclare({ ok: false, phase: 'registry-unavailable', waitedMs: Date.now() - startedAt });
        return true;
      }
      writeDeclare({ ok: false, phase: 'waiting-registry', waitedMs: Date.now() - startedAt });
      return false;
    }
    registerOnce(registry);
    return true;
  };
  if (!tick()) timer = setInterval(() => { if (tick()) { clearInterval(timer); timer = null; } }, 250);
  try {
    ctx.effect(() => () => {
      stopped = true;
      if (timer) clearInterval(timer);
      disposePresets();
    });
  } catch { /* 没有 effect 的宿主：注册仍然发生，只是不回收 */ }

  let version = 'unknown';
  let toolsInstalled = null;
  try {
    version = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
    const { listTools } = await import('./pentest/adapters.js');
    toolsInstalled = listTools().filter((t) => t.path).length;
  } catch { /* 诊断字段拿不到不影响功能 */ }

  try {
    mkdirSync(store.root, { recursive: true, mode: 0o700 });
    writePrivateFile(join(store.root, '.applied.json'), `${JSON.stringify({
      at: new Date().toISOString(),
      version,
      plane: 'host',
      preset,
      toolsInstalled,
      lang: config.lang === 'en' ? 'en' : 'zh',
      root: store.root,
      dsh: process.versions?.electron ? `electron ${process.versions.electron}` : `node ${process.versions.node}`,
    }, null, 2)}\n`);
  } catch { /* ignore */ }

  logger?.info?.(`dsh-vapt: store=${store.root} · presets=${expectedPresets.join(', ')} (installed ${preset.installed} files)`);
}
