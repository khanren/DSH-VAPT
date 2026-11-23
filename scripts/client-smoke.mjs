// scripts/client-smoke.mjs — 在 Node 里模拟宿主前端环境，单测 client.js。
// 覆盖：模块壳契约 / slot 注册 / 组件渲染 / 点击行为（refresh、expand）/ 降级。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'client.js'), 'utf8');

/* 极简 react：支持 state + 手动重渲染，足以验证点击行为 */
function createReact() {
  const states = [];
  let cursor = 0;
  let rerender = () => {};
  return {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (v) => {
        states[i] = typeof v === 'function' ? v(states[i]) : v;
        rerender();
      }];
    },
    useEffect(fn) { cursor++; void fn; },
    useCallback(fn) { cursor++; return fn; },
    _bind(fn) { rerender = fn; },
    _tick() { cursor = 0; },
  };
}

function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join('');
}

function loadClient({ failSlots = false } = {}) {
  const react = createReact();
  const registered = [];
  const warnings = [];
  const calls = [];
  const fetchMock = async (url, opts) => {
    const body = JSON.parse(opts?.body || '{}');
    calls.push({ url, op: body.op, engagement: body.engagement });
    const payload = (() => {
      switch (body.op) {
        case 'overview': return { ok: true, current: 'eng-1', engagements: [{ id: 'eng-1', client: 'x', assets: 1, findings: 1, deliverable: 1 }] };
        case 'status': return { ok: true, engagement: { id: 'eng-1' }, counts: { assets: 1, findings: 2, deliverable: 1, evidence: 3, credentials: 0 } };
        case 'findings': return { ok: true, findings: [{ id: 'F-001', severity: 'high', status: 'confirmed', confidence: 'observed', title: 'SQLi' }] };
        case 'graph': return { ok: true, mermaid: '```mermaid\ngraph LR\n```' };
        case 'report': return { ok: true, md: '# report body' };
        default: return { ok: false, error: `unknown op ${body.op}` };
      }
    })();
    return { status: 200, text: async () => JSON.stringify(payload) };
  };

  const moduleLoader = {
    load({ id, factory }) {
      const mod = factory((n) => {
        if (n === 'react') return react;
        throw new Error(`unexpected require: ${n}`);
      });
      assert.equal(id, 'dsh-vapt');
      assert.equal(mod.name, 'dsh-vapt');
      assert.deepEqual([...mod.inject], ['slots']);
      assert.equal(typeof mod.apply, 'function');
      const ctx = {
        slots: {
          inject(name, cb) { if (failSlots) throw new Error(`unknown slot ${name}`); return cb(); },
          register(meta, component) { registered.push({ meta, component }); return () => {}; },
        },
      };
      mod.apply(ctx);
      return { mod, registered };
    },
  };
  const sandbox = {
    window: { __ModuleLoader__: moduleLoader, location: { origin: 'http://127.0.0.1:1' }, dispatchEvent() {} },
    console: { warn: (m) => warnings.push(String(m)), log() {}, error() {} },
    fetch: fetchMock, URL, Date, JSON, Promise, setTimeout, CustomEvent: class {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'client.js' });
  return { react, registered, warnings, calls };
}

const pass = [];
const ok = (m) => { pass.push(m); console.log(`  ✓ ${m}`); };

const { react, registered, warnings, calls } = loadClient();
assert.equal(registered.length, 2, `expected 2 registrations, got ${registered.length}`);
assert.deepEqual(registered.map((r) => r.meta.name).sort(), ['conversation.input.right', 'shell.overlay']);
ok('client.js: registers shell.overlay + conversation.input.right');

const dock = registered.find((r) => r.meta.name === 'shell.overlay').component;
let tree = null;
react._bind(() => { react._tick(); tree = dock({}); });
react._tick();
tree = dock({});

const fab = walk(tree).find((n) => n.type === 'button' && textOf(n) === 'vapt');
assert.ok(fab, 'floating vapt button must render');
ok('client.js: overlay renders the vapt button');

fab.props.onClick();
tree = (react._tick(), dock({}));
const buttons = walk(tree).filter((n) => n.type === 'button');
const byText = (t) => buttons.find((b) => textOf(b) === t);
const refresh = byText('refresh');
const expand = byText('expand');
assert.ok(refresh, 'refresh button must appear once the panel opens');
assert.ok(expand, 'expand button must appear once the panel opens');
ok('client.js: panel exposes refresh + expand buttons');

await Promise.resolve(refresh.props.onClick());
await new Promise((r) => setTimeout(r, 0));
assert.ok(calls.some((c) => c.op === 'overview'), 'refresh must call /vapt/api overview');
assert.ok(calls.some((c) => c.op === 'findings'), 'refresh must re-read findings');
ok('client.js: refresh actually re-fetches the store (overview + findings)');

const before = calls.length;
await Promise.resolve(expand.props.onClick());
await new Promise((r) => setTimeout(r, 0));
assert.ok(calls.slice(before).some((c) => c.op === 'report'), 'expand must fetch the report');
tree = (react._tick(), dock({}));
react._tick();
assert.match(textOf(dock({})), /Report \(zh\)/, 'expanded panel shows the report section');
ok('client.js: expand loads the report inside the panel (no window.open)');

const degraded = loadClient({ failSlots: true });
assert.equal(degraded.registered.length, 0);
assert.ok(degraded.warnings.length >= 1);
ok('client.js: unknown slot degrades with a warning');

console.log(`\n${pass.length} client checks passed`);
