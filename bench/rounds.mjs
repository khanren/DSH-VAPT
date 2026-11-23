// bench/rounds.mjs — 把「多次运行的原始输出」逐条映射到目录并算 mean ± σ。
// 用途：论文里的「重复运行方差」一栏。判定词集中在这里，任何人不认同可以改这里重算。
//
//   node bench/rounds.mjs --app juice-shop --tool redteam --dir /tmp/juicerounds --glob 'rt-r*.log'
//   node bench/rounds.mjs --app dvwa        --tool strix   --dir ./example-runs --sarif
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const app = arg('--app', 'juice-shop');
const tool = arg('--tool', 'unknown');
const dir = arg('--dir', '.');
const glob = arg('--glob', '');
const useSarif = argv.includes('--sarif');

const truth = JSON.parse(readFileSync(new URL('./ground-truth.json', import.meta.url), 'utf8'));
const items = truth.items.filter((i) => i.app === app && i.expected === 'vulnerable');

const RULES = {
  'JS-01': /(products\/search|搜索.{0,6}SQL|UNION.{0,12}search)/i,
  'JS-02': /(application-configuration|管理配置.{0,6}未授权)/i,
  'JS-03': /(\/rest\/memories|memories)/i,
  'JS-04': /(\/ftp\s*目录|目录(浏览|列表)|directory listing)/i,
  'JS-05': /(安全头|CSP|HSTS|security headers)/i,
  'JS-06': /(user\/login|登录.{0,6}SQL|SQL.{0,6}登录)/i,
  'JS-07': /(PUT \/api\/Products|product.{0,20}(modif|writ)|未授权.{0,8}(修改|改).{0,8}商品)/i,
  'JS-08': /(mass assignment|批量赋值|role.{0,6}admin)/i,
  'JS-09': /(alg.?none|JWT.{0,12}(绕过|伪造|none))/i,
  'JS-10': /(null.?byte|空字节|%2500)/i,
  'JS-11': /(\/api\/Users|users? (collection|list)|用户枚举|enumerate)/i,
  'JS-12': /(\/metrics|prometheus)/i,
  'JS-13': /(support\/logs|日志(泄露|披露))/i,
  'JS-14': /(错误堆栈|stack trace)/i,
  'JS-15': /(JWT.{0,14}密码|密码哈希)/i,
  'JS-16': /(basket|购物(车|篮))/i,
  'JS-17': /(客户.{0,8}(建|创建).{0,6}商品|create.{0,10}product)/i,
  'JS-18': /(deluxe|paymentMode)/i,
  'JS-19': /(security.?question|密保|安全问答)/i,
  'JS-20': /(负数量|negative.{0,10}quantity)/i,
  'DV-01': /(sqli|SQL 注入|UNION)/i,
  'DV-02': /(xss_r|反射型|reflected)/i,
  'DV-03': /(exec|命令注入|command injection)/i,
  'DV-04': /(fi\/|文件包含|LFI)/i,
  'DV-05': /(setup\.php)/i,
  'DV-06': /(xss_s|存储型|stored)/i,
  'DV-07': /(upload|文件上传)/i,
  'DV-08': /CSRF/i,
  'DV-09': /(sqli_blind|盲注|blind)/i,
  'DV-10': /(xss_d|DOM)/i,
};

function textOf(file) {
  if (!file.endsWith('.sarif')) return readFileSync(file, 'utf8');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const parts = [];
  for (const run of doc.runs || []) {
    for (const r of run.results || []) {
      const id = String(r.ruleId || '');
      if (id.startsWith('strix-coverage/')) continue;
      parts.push(`${id} ${(r.message && r.message.text) || ''}`);
    }
  }
  return parts.join('\n');
}

// 取文件：支持 (a) 顶层 log/sarif，(b) strix 风格「每次运行一个子目录，内含 findings.sarif」
const entries = readdirSync(dir);
const wantSarif = useSarif;
const globRe = glob ? new RegExp(`^${glob.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`) : null;
const files = [];
for (const e of entries) {
  const full = join(dir, e);
  const matches = (name) => (globRe ? globRe.test(name) : true);
  if (e.includes('.')) {
    // 顶层文件：按 glob 与类型过滤
    if (!matches(e)) continue;
    if (wantSarif ? e.endsWith('.sarif') : e.endsWith('.log')) files.push(full);
    continue;
  }
  // 子目录（strix 每次运行一个目录）：目录名按 glob 过滤，取里面的产物
  if (globRe && !globRe.test(e) && !globRe.test(`${e}/findings.sarif`)) continue;
  const inner = join(full, wantSarif ? 'findings.sarif' : 'run.log');
  if (existsSync(inner)) files.push(inner);
}

const rows = [];
for (const f of files.sort()) {
  if (!existsSync(f)) continue;
  let text = '';
  try { text = textOf(f); } catch { continue; }
  if (!text.trim()) continue;
  const hit = items.filter((i) => RULES[i.id] && RULES[i.id].test(text)).map((i) => i.id);
  rows.push({ file: f.split('/').pop(), tp: hit.length, recall: hit.length / items.length, hit });
}

console.log(`app=${app} tool=${tool} items=${items.length} runs=${rows.length}\n`);
for (const r of rows) console.log(`${r.file.padEnd(16)} ${String(r.tp).padStart(2)}/${items.length}  ${(r.recall * 100).toFixed(1)}%  ${r.hit.join(',')}`);
if (rows.length) {
  const rs = rows.map((r) => r.recall);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  console.log(`\nmean=${(mean * 100).toFixed(1)}%  sd=${(sd * 100).toFixed(1)}%  min=${(Math.min(...rs) * 100).toFixed(1)}%  max=${(Math.max(...rs) * 100).toFixed(1)}%`);
}
