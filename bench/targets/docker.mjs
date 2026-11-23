// bench/targets/docker.mjs — 用 Docker 起真实靶场（Juice Shop / DVWA）。
// 只绑定 127.0.0.1，跑完自动 stop+rm；镜像不存在时给出明确错误。
import { spawnSync } from 'node:child_process';

const RUN = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', timeout: 180000, ...opts });

function sh(args) {
  const r = RUN(args);
  if (r.status !== 0) throw new Error(`docker ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return (r.stdout || '').trim();
}

export function dockerAvailable() {
  try { return RUN(['info', '--format', '{{.ServerVersion}}']).status === 0; } catch { return false; }
}

/** 起一個容器；已存在同名则先删。 */
function startContainer({ name, image, port, containerPort }) {
  try { sh(['rm', '-f', name]); } catch { /* ignore */ }
  sh(['run', '-d', '--name', name, '-p', `127.0.0.1:${port}:${containerPort}`, image]);
  return `http://127.0.0.1:${port}`;
}

export function stopContainer(name) {
  try { sh(['rm', '-f', name]); } catch { /* ignore */ }
}

async function waitFor(url, { tries = 60, delayMs = 2000, accept = (r) => r.status < 500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (accept(r)) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/** OWASP Juice Shop —— 现代 SPA，REST API 丰富。 */
export async function startJuiceShop({ port = 3000 } = {}) {
  const url = startContainer({ name: 'bench-juice', image: 'bkimminich/juice-shop:latest', port, containerPort: 3000 });
  const ok = await waitFor(`${url}/rest/admin/application-version`, { tries: 60 });
  if (!ok) { stopContainer('bench-juice'); throw new Error('juice-shop did not become ready'); }
  return { name: 'juice-shop', url, close: () => stopContainer('bench-juice') };
}

/** 从 fetch 响应里收集 cookie（Node 20+ 的 getSetCookie）。 */
function cookiesOf(res, prev = '') {
  const jar = new Map();
  for (const part of String(prev || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [k, ...v] = part.split('=');
    jar.set(k, v.join('='));
  }
  const list = res.headers.getSetCookie?.() || [];
  for (const c of list) {
    const [pair] = c.split(';');
    const [k, ...v] = pair.split('=');
    jar.set(k.trim(), v.join('='));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function tokenOf(html) {
  const m = /user_token' value='([a-f0-9]+)'/i.exec(String(html || '')) || /name="user_token" value="([a-f0-9]+)"/i.exec(String(html || ''));
  return m ? m[1] : '';
}

/** 起 DVWA（compose，含 MySQL sidecar）并完成 setup → login → security=low。 */
export async function startDvwa({ port = 4281, composeFile = 'bench/docker-compose.dvwa.yml' } = {}) {
  const url = `http://127.0.0.1:${port}`;
  const reuse = process.env.VAPT_REUSE_DVWA === '1';
  // compose 起来（幂等）；DVWA 需要独立 MySQL sidecar。复用模式用于多轮评测，避免反复拆栈。
  if (!reuse) {
    const up = RUN(['compose', '-f', composeFile, 'up', '-d'], { timeout: 300000 });
    if (up.status !== 0) throw new Error(`docker compose up failed: ${(up.stderr || up.stdout || '').slice(0, 400)}`);
  }

  const ready = await waitFor(`${url}/login.php`, { tries: 90, accept: (r) => r.status === 200 });
  if (!ready) throw new Error('dvwa did not become ready');

  let cookie = '';
  // 1) setup.php 需要 CSRF token（新版 DVWA）；先取 token 再提交
  const setupPage = await fetch(`${url}/setup.php`);
  cookie = cookiesOf(setupPage, cookie);
  const setupHtml = await setupPage.text();
  const t1 = tokenOf(setupHtml);
  const setupPost = await fetch(`${url}/setup.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ create_db: 'Create / Reset Database', user_token: t1 }).toString(),
  });
  cookie = cookiesOf(setupPost, cookie);
  await new Promise((r) => setTimeout(r, 2000));

  // 2) 登录（同样要 token）
  const loginPage = await fetch(`${url}/login.php`, { headers: { cookie } });
  cookie = cookiesOf(loginPage, cookie);
  const t2 = tokenOf(await loginPage.text());
  const loginPost = await fetch(`${url}/login.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ username: 'admin', password: 'password', Login: 'Login', user_token: t2 }).toString(),
  });
  cookie = cookiesOf(loginPost, cookie);
  let authed = await fetch(`${url}/index.php`, { redirect: 'manual', headers: { cookie } });
  if (authed.status !== 200) {
    // 首次 `compose up` 后数据库是空的：先初始化再登录一次（自愈，避免"随机登录失败"）
    const s2 = await fetch(`${url}/setup.php`, { headers: { cookie } });
    cookie = cookiesOf(s2, cookie);
    const t = tokenOf(await s2.text());
    const post = await fetch(`${url}/setup.php`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ create_db: 'Create / Reset Database', user_token: t }).toString(),
    });
    cookie = cookiesOf(post, cookie);
    await new Promise((r) => setTimeout(r, 2500));
    const lp = await fetch(`${url}/login.php`, { headers: { cookie } });
    cookie = cookiesOf(lp, cookie);
    const lt = tokenOf(await lp.text());
    const lpost = await fetch(`${url}/login.php`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ username: 'admin', password: 'password', Login: 'Login', user_token: lt }).toString(),
    });
    cookie = cookiesOf(lpost, cookie);
    authed = await fetch(`${url}/index.php`, { redirect: 'manual', headers: { cookie } });
    if (authed.status !== 200) throw new Error(`dvwa login failed after setup (index ${authed.status})`);
  }

  // 3) 安全级别 must be low，否则漏洞页面是 impossible
  const secPage = await fetch(`${url}/security.php`, { headers: { cookie } });
  cookie = cookiesOf(secPage, cookie);
  const t3 = tokenOf(await secPage.text());
  const secPost = await fetch(`${url}/security.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ security: 'low', seclev_submit: 'Submit', user_token: t3 }).toString(),
  });
  cookie = cookiesOf(secPost, cookie);

  return {
    name: 'dvwa',
    url,
    cookie,
    close: () => {
      if (reuse) return; // 复用模式交给调用方决定何时拆
      try { RUN(['compose', '-f', composeFile, 'down', '-v'], { timeout: 180000 }); } catch { /* ignore */ }
    },
  };
}
