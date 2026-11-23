#!/usr/bin/env node
// dsh-vapt CLI — 零依赖安装/自检工具，降低"装上"的门槛。
//
//   npx dsh-vapt install --profile pentest        # 装进指定 profile 并注册 bundle
//   npx dsh-vapt doctor                           # 检查环境、安装状态、preset、控制台
//   npx dsh-vapt demo                             # 跑真实靶场基准（需要 Docker）
//
// 设计原则：只做「用户已经决定要做的事」，不猜、不改宿主其它配置。
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writePrivateFile } from '../src/pentest/atomic-file.js';

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE_DIR = join(HOME, 'profiles');
const VAPT_HOME = join(HOME, 'vapt');

const CANDIDATE_DSH = [
  process.env.DSH_BIN,
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
  '/usr/local/bin/dsh',
  '/opt/homebrew/bin/dsh',
].filter(Boolean);

function findDsh() {
  for (const p of CANDIDATE_DSH) if (existsSync(p)) return p;
  try {
    const out = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch { /* not on PATH */ }
  return null;
}

function profiles() {
  if (!existsSync(PROFILE_DIR)) return [];
  return readdirSync(PROFILE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROFILE_DIR, d.name, 'package.json')))
    .map((d) => d.name);
}

function profilePkg(name) {
  const p = join(PROFILE_DIR, name, 'package.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function installedVersion(profile) {
  const p = join(PROFILE_DIR, profile, 'node_modules', 'dsh-vapt', 'package.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')).version; } catch { return null; }
}

function presetDeclare() {
  const p = join(VAPT_HOME, 'preset-declare.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

function cmdDoctor() {
  console.log('dsh-vapt doctor\n');
  let problems = 0;

  const dsh = findDsh();
  if (dsh) ok(`DSH CLI: ${dsh}`);
  else { bad('DSH CLI not found (set DSH_BIN=/path/to/dsh) / 找不到 DSH CLI（设 DSH_BIN=/path/to/dsh）'); problems += 1; }

  const list = profiles();
  if (list.length) { ok(`profiles: ${list.join(', ')}`); }
  else { bad(`No profiles found (${PROFILE_DIR} is empty) / 没有 profile（${PROFILE_DIR} 为空）`); problems += 1; }

  const withVapt = list.filter((p) => installedVersion(p));
  if (withVapt.length) {
    for (const p of withVapt) {
      const v = installedVersion(p);
      const bundles = profilePkg(p)?.dsh?.profile?.bundles || [];
      const registered = Array.isArray(bundles) && bundles.includes('dsh-vapt');
      ok(`profile "${p}" has dsh-vapt@${v} installed / 已安装 dsh-vapt@${v}`);
      if (registered) ok(`  bundle registered / bundle 已注册`);
      else { bad(`  bundle not registered (missing dsh.profile.bundles entry) → run install / bundle 未注册 → 运行 install`); problems += 1; }
    }
  } else {
    bad('No profile has dsh-vapt installed → run npx dsh-vapt install --profile <name> / 没有任何 profile 安装 dsh-vapt');
    problems += 1;
  }

  const decl = presetDeclare();
  if (Array.isArray(decl?.presets) && decl.presets.length &&
      decl.presets.every(p => typeof p?.id === 'string') &&
      (decl.expectedPresets === undefined || Array.isArray(decl.expectedPresets))) {
    const ids = decl.presets.map((p) => p.id);
    const need = decl.expectedPresets ?? ['vapt'];
    const missing = need.filter((x) => !ids.includes(x));
    const broken = decl.presets.filter((p) => p.broken);
    info(`Last registered presets in this DSH_HOME / 最近一次模式注册记录: ${ids.join(', ')}`);
    if (decl.ok === false) { bad(`Preset registration failed (${decl.phase ?? 'unknown'}) / 模式注册未成功（${decl.phase ?? 'unknown'}）`); problems += 1; }
    if (missing.length) { bad(`Missing preset(s) / 缺少 preset: ${missing.join(', ')}`); problems += 1; }
    if (Array.isArray(decl.expectedPresets) && ids.some((id) => !need.includes(id))) {
      bad('Unexpected preset(s) found in registration record / 注册记录中出现了配置以外的 preset'); problems += 1;
    }
    if (broken.length) { bad(`Broken preset(s) / preset 损坏: ${broken.map((b) => b.id).join(', ')}`); problems += 1; }
  } else {
    bad('Presets not registered yet (launch a profile with dsh-vapt once) / preset 尚未注册（启动一次带 dsh-vapt 的 profile 即可）');
    problems += 1;
  }

  const dataDir = join(process.env.VAPT_HOME || VAPT_HOME, 'engagements');
  if (existsSync(dataDir)) {
    const n = readdirSync(dataDir).length;
    ok(`Store directory readable / 事实库目录可读: ${dataDir} (${n} engagement(s))`);
  } else {
    info(`Store not created yet (created on first engagement) / 事实库尚未创建: ${dataDir}`);
  }

  console.log(problems ? `\nFound ${problems} issue(s) / 发现 ${problems} 个问题` : '\nAll checks passed / 一切正常');
  process.exitCode = problems ? 1 : 0;
}

function checkProfilePaths(profile) {
  const parent = lstatSync(PROFILE_DIR, { throwIfNoEntry: false });
  if (parent && !parent.isDirectory()) throw new Error('Expected a directory at DSH_HOME/profiles.');
  const dir = join(PROFILE_DIR, profile);
  const folder = lstatSync(dir, { throwIfNoEntry: false });
  if (folder && !folder.isDirectory()) throw new Error('Profile must be a directory inside DSH_HOME/profiles.');
  const manifest = lstatSync(join(dir, 'package.json'), { throwIfNoEntry: false });
  if (manifest && (!manifest.isFile() || manifest.nlink > 1)) {
    throw new Error('Profile package.json must be a regular, unlinked file.');
  }
  if (!manifest) return null;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Invalid profile package.json.');
  for (const field of [pkg.dsh, pkg.dsh?.profile]) {
    if (field != null && (typeof field !== 'object' || Array.isArray(field))) {
      throw new Error('Expected an object in the profile manifest.');
    }
  }
  if (pkg.dsh?.profile?.bundles != null && !Array.isArray(pkg.dsh.profile.bundles)) {
    throw new Error('Expected an array at dsh.profile.bundles.');
  }
  return pkg;
}

function cmdInstall(argv) {
  let profile, pkg;
  try {
    const { values } = parseArgs({ args: argv, options: {
      profile: { type: 'string', default: 'pentest' },
      package: { type: 'string', default: 'dsh-vapt' },
    } });
    profile = values.profile;
    pkg = values.package;
    if (!profile.trim() || profile === '.' || profile === '..' || /^-|[/\\\x00-\x1f\x7f]/u.test(profile)) {
      throw new Error('Invalid DSH profile name. Use a single directory name.');
    }
    if (!pkg.trim() || pkg.startsWith('-')) throw new Error('Expected a package name or tarball path.');
    checkProfilePaths(profile);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
    return;
  }
  const dsh = findDsh();
  if (!dsh) { bad('DSH CLI not found (set DSH_BIN) / 找不到 DSH CLI（设 DSH_BIN）'); process.exitCode = 1; return; }

  console.log(`Installing / 安装 ${pkg} → profile "${profile}"\n`);
  if (!existsSync(join(PROFILE_DIR, profile))) {
    console.log(`  Profile does not exist; creating from web template / profile 不存在，先从 web 模板创建…`);
    execFileSync(dsh, ['--profile', profile, '--from-default-profile', 'web', '--dump-config'], { stdio: 'ignore' });
    ok(`profile "${profile}" created / 已创建`);
  }
  execFileSync(dsh, ['plugin', '--profile', profile, 'add', pkg], { stdio: 'inherit' });

  const j = checkProfilePaths(profile);
  const p = join(PROFILE_DIR, profile, 'package.json');
  if (!j) throw new Error('DSH did not create the profile manifest.');
  j.dsh ??= {}; j.dsh.profile ??= {}; j.dsh.profile.bundles ??= [];
  if (!j.dsh.profile.bundles.includes('dsh-vapt')) {
    j.dsh.profile.bundles.push('dsh-vapt');
    writePrivateFile(p, `${JSON.stringify(j, null, 2)}\n`);
    ok('bundle registered / bundle 已注册');
  } else {
    info('bundle already registered, skipping / bundle 已存在，跳过');
  }

  console.log(`\nNext steps / 下一步：\n  dsh --profile ${profile}          # Launch DSH (adds VAPT mode by default / 启动后模式菜单默认新增 VAPT mode)`);
  console.log(`  npx dsh-vapt doctor               # Verify installation / 复查安装状态`);
}

function cmdDemo() {
  const demo = fileURLToPath(new URL('../bench/demo.mjs', import.meta.url));
  if (!existsSync(demo)) { bad(`Cannot find ${demo} (demo is only available in a source checkout) / 找不到 ${demo}`); process.exitCode = 1; return; }
  execFileSync(process.execPath, [demo, ...process.argv.slice(3)], { stdio: 'inherit' });
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'install': cmdInstall(rest); break;
  case 'doctor': cmdDoctor(); break;
  case 'demo': cmdDemo(); break;
  case '-v': case '--version': {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    console.log(JSON.parse(readFileSync(pkgPath, 'utf8')).version);
    break;
  }
  default:
    console.log(`dsh-vapt — install / doctor / demo

Usage / 用法:
  dsh-vapt install [--profile <name>] [--package <tgz|npm-name>]   Install into profile & register bundle / 装进 profile 并注册 bundle
  dsh-vapt doctor                                                  Check environment & installation status / 检查环境与安装状态
  dsh-vapt demo [--dvwa] [--keep]                                  Run live target benchmark (requires Docker) / 跑真实靶场基准（需 Docker）
  dsh-vapt --version
`);
}
