// bench/demo.mjs — 一条命令跑完整基准：起真靶 → 探测 → 写事实库 → 出报告 → 打分 → 销毁。
//   node bench/demo.mjs              # Juice Shop
//   node bench/demo.mjs --dvwa       # DVWA（自动 docker compose）
//   node bench/demo.mjs --keep       # 保留容器，便于手动查看
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', timeout: 120000, ...opts });
  return r.status === 0;
}

function haveDocker() {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20000 });
  return r.status === 0;
}

if (!haveDocker()) {
  console.error('Docker 未运行。基准需要真靶：请先启动 Docker Desktop。');
  process.exit(2);
}

console.log('┌─ dsh-vapt benchmark demo ─────────────────────────────┐');
console.log('│ 真靶 → 真请求 → 事实库 → 报告 → 打分（不调用 LLM）    │');
console.log('└───────────────────────────────────────────────────────┘\n');

const target = argv.includes('--dvwa') ? '--dvwa' : '--juice';
const keep = argv.includes('--keep');
console.log(`[1/3] 准备靶场（${target.slice(2)}）…`);
console.log('      首次运行需要拉镜像（Juice Shop ~700MB / DVWA ~600MB）\n');

const runArgs = [join(HERE, 'real.mjs'), target, '--runs', '2'];
if (keep) runArgs.push('--keep');

console.log('[2/3] 跑探针并评分…\n');
const started = Date.now();
const ok = sh(process.execPath, runArgs);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n[3/3] 完成（${elapsed}s）`);
console.log(`      结果：bench/results/*.score.json`);
console.log(`      报告：bench/results 对应的 engagement 目录（report.zh.md / report.en.md / report.json）`);
if (!keep) console.log('      容器已销毁（--keep 可保留）');
process.exit(ok ? 0 : 1);
