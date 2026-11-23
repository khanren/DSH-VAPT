#!/usr/bin/env bash
# Install the current checkout in a disposable DSH home and inspect the local host.
set -euo pipefail

case "${1:-}" in
  '') keep=false ;;
  --keep) keep=true ;;
  *) echo 'Usage: clean-install-check.sh [--keep]' >&2; exit 2 ;;
esac

project_dir=$(cd "$(dirname "$0")/.." && pwd)
dsh_bin=${DSH_BIN:-$(command -v dsh || true)}
dsh_bin=${dsh_bin:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}
if [[ ! -x "$dsh_bin" ]]; then
  echo 'DSH CLI missing. Set DSH_BIN to its executable path.' >&2
  exit 1
fi
export DSH_BIN="$(cd "$(dirname "$dsh_bin")" && pwd)/$(basename "$dsh_bin")"
profile=${PROFILE:-vapt-clean-check}
case "$profile" in
  .|..|*[!A-Za-z0-9_.-]*) echo 'Invalid DSH profile name.' >&2; exit 2 ;;
esac

umask 077
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/dsh-vapt-check.XXXXXXXX")
host_pid=
cleanup() {
  if [[ -n "$host_pid" && "$(jobs -pr)" == "$host_pid" ]]; then
    kill "$host_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      [[ "$(jobs -pr)" == "$host_pid" ]] || break
      sleep 1
    done
    if [[ "$(jobs -pr)" == "$host_pid" ]]; then
      kill -KILL "$host_pid" 2>/dev/null || true
    fi
  fi
  if [[ -n "$host_pid" ]]; then
    wait "$host_pid" 2>/dev/null || true
  fi
  if [[ "$keep" == true ]]; then
    echo "Test files kept in $test_dir"
  else
    rm -rf -- "$test_dir"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export DSH_HOME="$test_dir/dsh"
export VAPT_HOME="$DSH_HOME/vapt"
export npm_config_cache="$test_dir/npm-cache"
cd "$project_dir"
archive=$(npm pack --silent --pack-destination "$test_dir")
cd "$test_dir"
node "$project_dir/bin/dsh-vapt.mjs" install --profile "$profile" --package "$test_dir/$archive"

"$DSH_BIN" --profile "$profile" --no-open --host 127.0.0.1 --port "${PORT:-0}" >host.log 2>&1 &
host_pid=$!

node --input-type=module - "$host_pid" "$profile" <<'NODE'
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const [pid, profile] = process.argv.slice(2);
const marker = join(process.env.VAPT_HOME, 'preset-declare.json');
const deadline = Date.now() + 60_000;
const logHint = 'Use npm run check:install -- --keep to retain host.log in the temporary test directory.';
let address, declaration;
while (Date.now() < deadline) {
  try {
    process.kill(Number(pid), 0);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    console.error(`DSH exited before the web host and VAPT preset were ready. ${logHint}`);
    process.exit(1);
  }
  address = readFileSync('host.log', 'utf8').match(/^dsh web: (\S+)/m)?.[1];
  if (existsSync(marker)) {
    try { declaration = JSON.parse(readFileSync(marker, 'utf8')); } catch { /* being written */ }
    if (declaration?.ok && address) break;
    if (['registered-broken', 'register-failed', 'registry-unavailable'].includes(declaration?.phase)) {
      throw new Error(`DSH preset registration failed (${declaration.phase})`);
    }
  }
  await sleep(250);
}
assert.ok(address && declaration?.ok, `Timed out waiting for the DSH web host and preset registration. ${logHint}`);
assert.deepEqual(declaration.presets.map(p => p.id), ['vapt']);
assert.ok(declaration.presets.every(p => !p.broken));
console.log('Default VAPT preset: vapt');

const specs = join(process.env.DSH_HOME, 'profiles', profile, 'node_modules/dsh-vapt/src/pentest/specs.js');
const { buildSpecs } = await import(pathToFileURL(specs));
assert.equal(buildSpecs({ lang: 'zh' }).length, 17);
console.log('17 tool definitions present');

const url = new URL(address);
assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.searchParams.has('token'),
  'Expected an authenticated loopback URL from the DSH host');
for (const path of ['/vapt/ui', '/vapt/api']) {
  url.pathname = path;
  const options = path === '/vapt/api'
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"overview"}' }
    : {};
  const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `Unexpected HTTP status at ${path}`);
  if (path === '/vapt/api') {
    const overview = await response.json();
    assert.equal(overview.ok, true);
    assert.deepEqual(overview.engagements, []);
  }
  console.log(`${path} returned 200`);
}
NODE
installed_package="$DSH_HOME/profiles/$profile/node_modules/dsh-vapt"
node "$installed_package/bin/dsh-vapt.mjs" doctor
node "$installed_package/scripts/mcp-smoke.mjs"
echo 'Clean installation check passed.'
