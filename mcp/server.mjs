#!/usr/bin/env node
// MCP clients share the engagement store through the tools listed below.
//
// 环境变量：
//   VAPT_HOME    数据根目录（默认 $DSH_HOME/vapt 或 ~/.dsh/vapt）
//   VAPT_SCOPE   首次使用时自动开靶的授权范围，逗号分隔（例：127.0.0.1/32,app.example）
//   VAPT_CLIENT  首次使用时自动开靶的客户名（默认 "MCP session"）
//   VAPT_ENGAGEMENT  指定已有靶 id（优先于自动开靶）
import readline from 'node:readline';
import { createStore } from '../src/pentest/store.js';
import { buildSpecs } from '../src/pentest/specs.js';
import { resolveRoot } from '../src/pentest/paths.js';

const VERSION = '1.0.0';
const mcpTools = new Set([
  'vapt_engagement_open', 'vapt_status', 'vapt_brief', 'vapt_scope_check',
  'vapt_asset_add', 'vapt_finding_add', 'vapt_findings_list', 'vapt_evidence_add',
  'vapt_credential_add', 'vapt_credential_list', 'vapt_poc_add', 'vapt_report',
  'vapt_slot', 'vapt_tool_list',
]);

function toJsonSchema(paramsMap = {}) {
  const properties = {};
  const required = [];
  for (const [key, def] of Object.entries(paramsMap)) {
    const { required: mandatory, ...schema } = def;
    properties[key] = schema;
    if (mandatory) required.push(key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function validateInput(schema, value, field = 'arguments') {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (type !== schema.type) throw new Error(`${field} must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`invalid choice for ${field}`);
  if (schema.items) value.forEach((item, i) => validateInput(schema.items, item, `${field}[${i}]`));
  if (!schema.properties) return;
  for (const key of schema.required || []) {
    if (!Object.hasOwn(value, key)) throw new Error(`missing required field: ${field}.${key}`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (Object.hasOwn(schema.properties, key)) validateInput(schema.properties[key], entry, `${field}.${key}`);
    else if (schema.additionalProperties === false) throw new Error(`unexpected field: ${field}.${key}`);
  }
}

const store = createStore({ root: resolveRoot(process.env.VAPT_ROOT) });
const lang = process.env.VAPT_LANG === 'en' ? 'en' : 'zh';
const specs = buildSpecs({ lang }).filter((spec) => mcpTools.has(spec.name))
  .map((spec) => ({ ...spec, inputSchema: toJsonSchema(spec.parameters) }));
const byName = new Map(specs.map((spec) => [spec.name, spec]));

function ensureEngagement(explicit) {
  const wanted = explicit || process.env.VAPT_ENGAGEMENT;
  if (wanted) {
    const s = store.open(wanted);
    if (!s) throw new Error(`engagement not found: ${wanted}`);
    return s.meta;
  }
  const current = store.current();
  const selected = current && store.open(current.id);
  if (selected) return selected.meta;
  const scope = String(process.env.VAPT_SCOPE || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!scope.length) {
    throw new Error('no engagement: set VAPT_SCOPE (e.g. VAPT_SCOPE=127.0.0.1/32) or VAPT_ENGAGEMENT=<id>');
  }
  return store.create({ client: process.env.VAPT_CLIENT || 'MCP session', scope, window: 'mcp' });
}

function callTool(name, args = {}) {
  const spec = byName.get(name);
  if (!spec) return { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] };
  try {
    validateInput(spec.inputSchema, args);
    const meta = name === 'vapt_engagement_open' ? null : ensureEngagement(args.engagement);
    const out = spec.execute(meta ? { ...args, engagement: meta.id } : args, { store, lang });
    return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] };
  }
}

function handle(msg) {
  const { id, method, params } = msg || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (msg?.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'invalid request');
  if (id === undefined) return null;

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dsh-vapt', version: VERSION },
      });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: specs.map((s) => ({
          name: s.name,
          description: s.description,
          inputSchema: s.inputSchema,
        })),
      });
    case 'tools/call': {
      if (typeof params?.name !== 'string') return fail(-32602, 'expected a tool name');
      const result = callTool(params?.name, params?.arguments);
      return reply(result);
    }
    default:
      return fail(-32601, `method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`); return; }
  const out = handle(msg);
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
});
