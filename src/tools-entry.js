// tools-entry.js — agent 平面入口：只往 tools 服务注册 vapt_* 工具。
// 为什么和 host 行分开：
//   · host 行（dsh-vapt）负责数据层、预设安装、诊断标记；
//   · 工具行（dsh-vapt/tools）只在「VAPT 模式」的 preset 里挂载，
//     这样标准模式不会被 8 个渗透工具污染，也不会出现重复注册。
import { createStore } from './pentest/store.js';
import { buildSpecs } from './pentest/specs.js';
import { resolveRoot } from './pentest/paths.js';
import { loadDefineTool, sealObjectSchemas, withStructuredErrors, text } from './pentest/host-api.js';

export const name = 'dsh-vapt-tools';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const safe = (read, fallback = undefined) => { try { return read(); } catch { return fallback; } };
  const logger = safe(() => ctx.logger, null);
  const tools = safe(() => ctx.tools, null);

  // 优先复用 host 行发布的 store（同一个数据根），拿不到就自己建一个
  let store = safe(() => ctx.pentest, null);
  if (!store) store = createStore({ root: resolveRoot(config.root) });

  let defineTool = safe(() => ctx.defineTool, null);
  if (!defineTool) {
    try { defineTool = loadDefineTool(); }
    catch (err) { logger?.error?.(`dsh-vapt/tools: ${err.message}`); return; }
  }
  if (!tools || typeof tools.register !== 'function') {
    logger?.error?.('dsh-vapt/tools: ctx.tools unavailable');
    return;
  }

  const lang = config.lang === 'en' ? 'en' : 'zh';
  // 角色 preset 用 only/except 裁剪工具面：recon 不给自己 finding_add，
  // report 不给扫描工具——这样「多代理」才不是一句口号。
  const only = Array.isArray(config.only) && config.only.length ? new Set(config.only) : null;
  const except = Array.isArray(config.except) && config.except.length ? new Set(config.except) : null;
  const specs = buildSpecs({ lang }).filter((s) => (!only || only.has(s.name)) && (!except || !except.has(s.name)));
  const disposers = [];
  for (const spec of specs) {
    try {
      const tool = defineTool({
        name: spec.name,
        description: spec.description,
        parameters: sealObjectSchemas(spec.parameters),
        output: { schema: { type: 'string' }, render: (_a, v) => text(v) },
        execute: (args) => spec.execute(args || {}, { store, lang }),
      });
      disposers.push(tools.register(withStructuredErrors(tool)));
    } catch (err) {
      logger?.warn?.(`dsh-vapt/tools: register ${spec.name} failed: ${err?.message || err}`);
    }
  }
  try { ctx.effect(() => () => disposers.forEach((d) => { try { d?.(); } catch { /* ignore */ } })); } catch { /* ignore */ }
  logger?.info?.(`dsh-vapt/tools: ${disposers.length}/${buildSpecs({ lang }).length} tool(s) registered (agent plane${only ? ', filtered' : ''})`);
}
