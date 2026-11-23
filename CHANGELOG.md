# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: SemVer.
This is the first public release; earlier internal build numbers (0.1.0–0.4.0)
were never published and are folded into this entry.

## [1.0.0] - 2026-11-21

> 1.0.0 在 DSH 中提供 17 个工具，在 MCP 中提供 14 个本地记录和报告工具，支持双语报告。
> 新 profile 默认只注册 VAPT mode，另外三个模式可按需启用。

### Added

- **17 DSH tools**: `vapt_engagement_open`, `vapt_status`, `vapt_brief`,
  `vapt_scope_check` (single + batch), `vapt_asset_add`, `vapt_finding_add`,
  `vapt_evidence_add`, `vapt_findings_list`, `vapt_password_spray`,
  `vapt_credential_add`, `vapt_credential_list`, `vapt_poc_add`, `vapt_screenshot`,
  `vapt_slot`, `vapt_tool_list`, `vapt_tool_run`, `vapt_report`.
- **Mission orientation** (`vapt_brief`): scope, excludes, window, spray budget,
  counts and hard rules in one call; the preset persona leads with
  open → brief → pre-check → act.
- **Engagement store**: plain JSON with atomic writes (tmp → rename), per-table file
  locks (10×30 concurrent writes, zero loss), corrupt-file tolerance, stale-lock
  recovery, artifact retention (newest 400), data dir 0700, credentials file 0600.
- **VAPT mode preset**: `presets/vapt/` (persona + `dsh-vapt/tools` + stock rows)
  installed to `$DSH_HOME/.agent-presets/vapt/` idempotently and registered with the
  host's `agentPresets.register()` (polled, since the service is not ready at apply).
  `scripts/gen-preset-definition.py` regenerates `definition.json` from the YAML.
- **External tool registry — 145 tools**: 25 hand-written adapters with dedicated
  parsers (nmap, masscan, naabu, httpx, nuclei, ffuf, subfinder, katana, whatweb,
  nikto, sqlmap, testssl, wpscan, hydra, nxc, certipy, hashcat, …) + 120 generic
  entries generated from a personal inventory (`scripts/gen-registry.mjs`).
- The plugin checks supported target inputs against scope and exclusions. Artifacts and
  audit events record tool activity. Network and filesystem restrictions depend on the
  host and the permissions of the process running the plugin.
- **Controlled credential spray**: one password across N accounts with hard caps
  (≤100 accounts, ≤5 passwords, ≤200 attempts, ≤3/account, ≥500 ms delay), stop on
  first lockout, credential store, automatic finding + evidence on hits; bilingual
  RoE template in `docs/credential-attack-roe.md`.
- Reports include findings marked `confirmed` or `exploited` with a confidence other
  than `claimed`. Evidence is optional. Credential tables omit the stored secret field.
  Evidence excerpts and other user-entered text can still contain sensitive values.
- **Bilingual throughout**: zh/en locale files (116 keys, parity enforced by tests),
  bilingual tool descriptions, bilingual reports (`report.zh.md` + `report.en.md`),
  bilingual persona language policy and docs.
- **Diagnostics on disk**: `.applied.json` (version, plane, preset, toolsInstalled,
  failures), `preset-declare.json` (registration outcome), `.error.json` (early
  failures), `events.jsonl` (audit trail).

### Multi-agent + console (parity with dsh-redteam-mode)

- **Four available agent presets**. Fresh profiles register only `VAPT mode` by default.
  Optional presets include `VAPT recon mode` (assets/fingerprints only),
  `VAPT verify mode` (reproduction + evidence), `VAPT report mode` (read-only). Each preset
  carries its own persona and a **tool whitelist** (`dsh-vapt/tools` row `config.only`), so a
  recon subagent physically cannot record findings and a report subagent cannot scan.
- **Concurrency gate** (`vapt_slot`): at most 3 executing subagents per engagement
  (`VAPT_MAX_AGENTS`, hard max 6), file-backed leases with 30-min TTL and a lock so a killed
  agent cannot occupy a slot forever.
- **Console** (`dsh-vapt/ui`): read-only `POST /vapt/api` (overview / status / assets /
  findings / evidence / graph / report) plus a self-contained page at `GET /vapt/ui`
  (assets, findings, attack path, rendered report). Loopback-only, no write operations.

### Test-suite hardening

- New `scripts/bench-tests.mjs`: regression tests for the scoring code itself
  (metric formulas, byte-identical `rounds.mjs` output, probe scope wrapper). 3 checks.
- The clean-install check builds a fresh profile, installs the tarball and starts DSH.
  It checks that the plugin registers only `vapt` by default, counts 17 tool definitions
  and verifies that `/vapt/ui` and `/vapt/api` return HTTP 200.
- `bench/rounds.mjs` now handles strix-style run directories and filters correctly by glob.
- Documented why a second-model comparison is `not-run` (strix's model map lacks the two
  models this key actually serves).

### Ground truth v1.6.2 — 30-item catalogue + repeated-run variance

- Added DV-09 blind SQLi (boolean differential) and DV-10 DOM XSS; removed DV-11 (the
  `authbypass` endpoint returned 200 on one build and 404 on a clean rebuild → fails the
  "deterministically reachable" criterion; kept as `extra-tp`).
- **Fixed a real flakiness bug**: the CSRF probe changed the admin password and never restored
  it, so every later round failed to log in. It now restores the password.
- DVWA startup hardened: if login fails after `compose up` (empty database), the launcher runs
  `setup.php` and retries; `VAPT_REUSE_DVWA=1` keeps the stack alive for repeated rounds.
- **Repeated-run data** (DVWA, same model/prompt): dsh-vapt 100/100/100 (σ=0),
  dsh-redteam-mode 100/90 (σ=5), strix 30/90/90/90/90 → mean 78 % (σ=24), HexStrike 0.
  See `bench/PAPER.md` §2.1.

### Ground truth v1.5.0 — 30-item catalogue

DVWA expanded from 5 to 8 items: stored XSS, arbitrary file upload **with verified PHP
execution** (`GET /hackable/uploads/bench.php` → `BENCH`), and CSRF password change.
Measured: **DVWA 8/8 · precision 100 % · composite 100**.

### Ground truth v1.4.0 — 20-item catalogue

The last three competitor-reported items are now probed deterministically: free deluxe
membership (`paymentMode=none`), security-question email enumeration, negative basket
quantity. Result: **dsh-vapt 20/20, dsh-redteam-mode 14/20, strix 12/20** on the same frozen
catalogue, and neither competitor has any out-of-catalogue finding left.

### Ground truth v1.3.0 — 17-item catalogue

Competitor runs exposed gaps in our own probe pack; v1.3.0 closes them with six more
hand-verified items: `/metrics` exposure, `/support/logs` listing, error-stack disclosure,
JWT carrying the password hash, basket BOLA and customer-created products. Both competitors
are re-adjudicated on the same 17 items (strix 9/17, dsh-redteam-mode 13/17, dsh-vapt 17/17).

### Competitor measurements

- `bench/COMPETITORS.md` + `bench/competitors/results.json`: 12 public tools measured for
  install/boot on DSH 0.2.2-rc.5 — **7 actually exercised**: `dsh-redteam-mode 0.15.1`,
  `dsh-atn 0.7.0`, `dsh-team-rooms 1.0.9`, `dsh-soul 0.14.0` install and boot cleanly;
  `strix 1.7.0` requires Python ≥3.12 and pulls a Docker sandbox image on first run;
  `deadend-cli 0.1.15` installs but crashes on start (`ImportError` in its own SDK).
  Everything else (HexStrike, Nebula, RedAmon, PentAGI, cleverer-dsh) is recorded as
  `not-run` with the reason — no estimates.

### Dock button + DVWA benchmark

- **Dock panel fix**: the two buttons looked dead because `refresh` re-fetched identical data
  (no visible change) and `full` used `window.open`, which Electron blocks. The panel now shows
  a **status line with a timestamp**, `refresh` returns a promise (tested), and `full` became
  **`expand`** — it loads the report *inside* the panel. Handlers return promises so the click
  paths are unit-tested.
- `client.js` registers a **`vapt` button** in `conversation.input.right` that opens the
  console (`/vapt/ui`). Same module shell and slot API as other DSH client plugins; if the
  host does not expose that slot the button is skipped and the console URL still works.
- `bench/real.mjs --dvwa` now boots DVWA through `bench/docker-compose.dvwa.yml` (MySQL
  sidecar), performs the CSRF-token setup → login → `security=low` bootstrap and scores five
  known vulnerabilities. **Measured: 5/5, precision 100 %, evidence 100 %, composite 100**
  (~18 s). Juice Shop re-measured with the same runner: **6/6, composite 100**.

### Structured parsers (5 more)

- `dalfox` (jsonl → XSS findings), `arjun` (JSON → hidden-parameter finding),
  `gau` (URL archive → assets), `kerbrute` (valid usernames / successful spray),
  `trivy` (filesystem/image vulns + misconfigs).
- Non-host targets (e.g. `trivy fs <path>`) no longer fail the scope check.

### Competitive features (parity with public AI-pentest frameworks)

- **Finding pipeline**: near-duplicate detection (token Jaccard + plural stemming ≥ 0.7,
  severity escalation on merge, `hits` counter), **confidence gate** — `claimed` findings
  never reach the report, and a `withheld` counter explains what was filtered.
- **Report quality**: per-finding remediation (explicit or severity-based default), CWE /
  CVSS fields, and an auto-generated **mermaid attack-path graph**
  (target → finding → evidence).
- **`report.json`**: stable `dsh-vapt/report@1` schema for CI/pipeline consumption.
- **PoC capture** (`vapt_poc_add`): raw requests saved as replayable `pocs/<name>.http`
  and linked as evidence.
- **Screenshot evidence** (`vapt_screenshot`): headless Chrome capture to `artifacts/*.png`
  with evidence row (async spawn so local fixtures still answer).
- **Real-target benchmark with a published methodology**: `bench/ground-truth.json`
  (pre-registered, versioned, hashed; 6 vulnerable items + 2 negative controls for Juice Shop,
  5 pending for DVWA), `bench/score.mjs` (TP/FN/FP, recall with **Wilson 95% CI**, precision
  against negative controls, evidence coverage, run-to-run Jaccard, weighted composite),
  `bench/METHODOLOGY.md` (inclusion criteria, execution protocol, threats to validity,
  reproduction steps, competitor ingestion rules), `bench/compare.mjs` +
  `bench/adapters/nuclei.mjs`.
  **Measured result** (Juice Shop `@sha256:adaf6a…`, ground truth v1.1.0, 2 runs):
  recall **100 % (95% CI 61–100 %)**, precision **100 %**, evidence **100 %**, composite **100**.
  Probes were validated against the live image — the product-search SQLi only triggers with
  `q='))`, and `/rest/user/login` is bypassable with `' OR 1=1--` (added as JS-06).
- **Synthetic benchmark** (`bench/run.mjs` + `bench/fixture.mjs`): deliberately
  vulnerable local app, six deterministic probes, scores detection / evidence coverage /
  dedup stability / report completeness. Current run: **6/6 · 6/6 · dedup stable · 36 ms**.
- The `dsh-vapt-mcp` stdio server exposes 14 tools for local records and reports.
  It can use the same engagement store as DSH.

### Changed

- Tools live in the **agent-plane preset** (`dsh-vapt/tools`), so standard sessions
  stay clean and nothing registers twice.

### Fixed

- Binary lookup under a minimal `PATH` (Finder-launched harness): searches
  `VAPT_BIN_DIRS` → `PATH` → common prefixes (`/opt/homebrew/bin`, `~/go/bin`, …),
  Windows `.exe/.cmd/.bat` and `;` separators.
- Lost writes under concurrency: read-modify-write replaced by per-table `<file>.lock`.
- `args` silently dropped by hand-written adapters; extra args now spliced before the
  target.
- `nmap --top-ports 100` overriding an explicit `-p`; the default is dropped.
- Preset files on disk never appearing in the mode selector: registry declaration
  with polling, `{ __jsExpr }` shape for `!!js`, field-map `parameters`,
  `additionalProperties` sealing, string-only descriptions, `apply(ctx, config)` and
  `safe()` reads of optional ctx properties (three 0.2.2 host gotchas documented).

### Security

- DSH and MCP run with their host process's filesystem permissions. DSH actions can
  start external programs that use the network. [Security policy](SECURITY.md)

### Docs / Packaging

- README (bilingual), `SECURITY.md`, `PUBLISHING.md`, `CONTRIBUTING.md`,
  `docs/credential-attack-roe.md`, issue templates, and an npm `files` allowlist.
  The CI test matrix covers Ubuntu and macOS with Node.js 20 and 22.

### Tests

- `scripts/verify.mjs` runs functional checks with local fixtures.
- `scripts/stress.mjs` — 6 stability checks (concurrency, corrupt files, stale locks,
  timeouts, PATH).
- `scripts/e2e.mjs` — 5 end-to-end checks with real nmap/httpx against a local fixture.
