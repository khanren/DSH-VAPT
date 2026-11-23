// bench/fixture.mjs — 故意有洞的本地靶场（纯 Node，无依赖、无 docker）。
// 每次启动随机端口；只监听 127.0.0.1，绝不外扩。
import http from 'node:http';

export async function startFixture() {
  const hits = { admin: 0, idor: 0, xss: 0, redirect: 0, traversal: 0, leak: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, type, body, extra = {}) => {
      // 故意缺安全头（CSP / X-Frame-Options / HSTS 全无）
      res.writeHead(code, { 'content-type': type, 'x-powered-by': 'BenchApp/0.9', ...extra });
      res.end(body);
    };
    if (url.pathname === '/admin') { hits.admin += 1; return send(200, 'text/html', '<h1>Admin panel</h1>'); }
    if (url.pathname === '/api/user') { hits.idor += 1; return send(200, 'application/json', JSON.stringify({ id: url.searchParams.get('id'), email: 'victim@example.test', role: 'user' })); }
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      if (q.includes("'")) return send(500, 'text/html', `SQL syntax error near '${q}'`);
      return send(200, 'text/html', `<h1>Results for ${q}</h1>`);
    }
    if (url.pathname === '/redirect') { hits.redirect += 1; return send(302, 'text/plain', '', { location: url.searchParams.get('url') || '/' }); }
    if (url.pathname === '/health') { hits.leak += 1; return send(200, 'application/json', JSON.stringify({ version: '0.9.1', node: process.version, env: 'prod', db: 'postgres://bench:bench@db:5432/app' })); }
    if (url.pathname === '/download') { hits.traversal += 1; return send(200, 'text/plain', 'root:x:0:0:root:/root:/bin/sh\n'); }
    return send(200, 'text/html', '<title>Bench App</title><h1>home</h1>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, port, hits, close: () => new Promise((r) => server.close(r)) };
}
