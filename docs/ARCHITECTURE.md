# Architecture & Design Trade-offs / 架構與設計取捨

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

This document explains **why `dsh-vapt` is designed the way it is**, and what each architectural decision trades off.
For usage instructions, see [README.md](../README.md); for competitor benchmark data, see [bench/COMPETITORS.md](../bench/COMPETITORS.md).

### 1. Four-plane architecture

```
┌── host plane ──────────── src/index.js
│    Creates data dir · Installs presets · Registers with agentPresets (zero host patching)
├── agent plane ─────────── src/tools-entry.js
│    19 tools; role presets trim the tool surface via config.only
├── tool plane ──────────── src/pentest/{registry,adapters,parsers,exec}.js
│    145 external tools · Scope validation · Argument allowlist · Artifact persistence
└── data plane ──────────── src/pentest/{store,spray,report,slots}.js
     Pure JSON store · Evidence SHA-256 · Bilingual reports · Concurrency leases
```

Each layer depends only on the layer directly beneath it. A host upgrade cannot corrupt the data layer, and because the data layer has zero native dependencies, engagements can be moved across machines by copying a directory.

### 2. Why plain JSON instead of SQLite

| Dimension | Plain JSON (current) | SQLite |
|---|---|---|
| Dependencies | Zero (Node built-ins only) | `better-sqlite3` requires native compilation; if a DSH profile cannot resolve the native binary, the entire plugin fails to load |
| Concurrency | Per-table `<file>.lock` directories. Writers install a directory with a unique owner token via atomic `rename`, then atomically rename the data file. | WAL supports concurrent reads/writes |
| Auditability | Directly human-readable and diffable. Engagement directories may contain client identifiers, raw HTTP evidence, and plaintext credentials. | Requires CLI/library export |
| Scale | Handles thousands of records per engagement effortlessly | Better suited for millions of rows |

**Measured**: 10 processes × 30 concurrent writes = **zero lost writes** (`node scripts/stress.mjs`).
If million-row scale is ever needed, only the `store` interface needs to be swapped—the tool and report layers remain untouched.

### 3. Why zero host patching and no prompt-injection tricks

`cordis.patch.yml` only **inserts** its own rows and never modifies existing host rows; nor does it inject prompts telling the model to ignore safety rules.

The plugin registers capabilities through documented host interfaces. Tools validate supported target parameters against the recorded scope, while file and network access by DSH or external programs remains governed by host OS permissions. When an engagement requires strict network isolation, enforce it at the host or network layer.

### 4. Evidence chain: why every record has a SHA-256 digest

`store.deliverable()` selects findings whose status is `confirmed` or `exploited` and whose confidence is other than `claimed`. Evidence attachments are optional, but when evidence is attached, the report lists its SHA-256 digest so reviewers can verify integrity against the raw inputs. Verify that every finding is backed by sufficient evidence before delivery.

### 5. Multi-agent isolation: tool allowlists instead of prompt rules

DSH registers only **VAPT mode** by default. Three optional role presets can be enabled individually and restrict the available DSH tools at the capability layer via `config.only`:

| Preset | What is withheld | Why |
|---|---|---|
| `vapt-recon` | `vapt_finding_add`, `vapt_crack`, `vapt_password_spray` | Reconnaissance should map assets and clues, not declare confirmed vulnerabilities or run attacks |
| `vapt-verify` | `vapt_password_spray` | Verification should reproduce leads and crack collected hashes without expanding online spray surface |
| `vapt-report` | `vapt_tool_run`, `vapt_finding_add` | Reporting is read-only over the store and must never launch new scans |

`vapt_slot` tracks active execution leases per engagement (default cap: 3, lease TTL: 30 minutes), using short-lived exclusive lock files managed separately from table lock directories.

### 6. Benchmark: why ground truth is frozen

See [bench/METHODOLOGY.md](../bench/METHODOLOGY.md) for full details. Three core rules:

1. **Pre-registration + SHA-256 hash**: Any change to the vulnerability catalogue requires a version bump, and published scores must cite the catalogue version.
2. **Negative controls**: Public-by-design endpoints flagged as vulnerabilities count as false positives (`FP`), preventing "flag everything" gaming.
3. **Human adjudication for out-of-catalogue hits**: Real vulnerabilities outside the frozen catalogue are recorded as `extra-tp` (counted in precision numerator, excluded from recall denominator) so tools are not penalized for having a broader scope than our catalogue.

Measured results (catalogue v1.6.2 — 20 items on Juice Shop, 10 on DVWA):

| Tool | Juice Shop Recall | DVWA Recall | Cost & Time (Juice Shop) |
|---|---|---|---|
| **dsh-vapt** | **20/20 (100%)** | **10/10 (100%)** | **0 tokens · 3.4 s** |
| dsh-redteam-mode | 17/20 (85%) | 10/10 (100%) | DeepSeek API · ~5 min |
| strix | 12/20 (60%) | 9/10 (90%) | 23.78M tokens · ~35 min · $2.00 |

### 6b. Dock panel: why `shell.overlay`

Inspecting the slots enumerated in DSH `0.2.2-rc.5` (`app.asar`): `shell.overlay` (148 refs), `conversation.input.right` (12 refs), `conversation.chat.node` (100 refs), `settings.section` (143 refs)—there is **no** dedicated `shell.dock` / `shell.panel` / `shell.right` slot.

Therefore, the floating dock panel mounts in `shell.overlay` (the same slot used by `dsh-purge-dock`) and adds a toggle button in `conversation.input.right`. If either slot is absent on a future host build, it logs a `console.warn` and degrades gracefully without blocking host startup (tested in `node scripts/client-smoke.mjs`).

Host client-module loading rules (verified against `@deepseek-ai/dsh-client-modules`):

| Requirement | Our value |
|---|---|
| `package.json` → `dsh.client.platform` must be a string | `"web"` ✓ |
| `dsh.client.inject` must be a string array | `[]` (uses host-provided `react` only; zero client service dependencies) ✓ |
| `exports["./client"]` must resolve to the entry file | `"./client.js"` ✓ |
| Package must be listed in `dsh.profile.bundles` | Added by installer ✓ |

`inject` is intentionally empty: listing a package not present in the profile causes resolution failure at startup.

### 7. What we deliberately do not do

| Non-goal | Reason |
|---|---|
| No built-in LLM loop | Model behavior is non-deterministic; this plugin provides the deterministic, reproducible plumbing layer |
| No host patching / system-prompt overrides | Breaks on host upgrades and cannot be audited |
| No "fully autonomous unguarded attack" | Requires human-in-the-loop authorization boundaries (scope, spray budget, stop-on-lockout) |
| Omit `secret` from exported credential tables | Raw evidence, commands, and free-text notes may still contain secrets; always review exports before sharing |

### 8. Extension points

- **Add a tool**: Add an entry to `src/pentest/registry.js` (`bin` / `mk` / `parser` / `allowed`), or add a parser in `src/pentest/parsers.js`.
- **Add a role preset**: Copy `presets/vapt-recon`, customize the persona and `config.only`, and run `python3 scripts/gen-preset-definition.py`.
- **Add a benchmark target**: Add a starter in `bench/targets/` and entries in `bench/ground-truth.json` (with a version bump).
- **MCP clients**: Connect via `mcp/server.mjs` to access 14 local record and report tools over stdio.

---

<a id="中文"></a>

## 中文

這份文檔解釋 **為什麼這樣設計**，以及每個決定換到了什麼、放棄了什麼。
如果你只想知道怎麼用，看 [README.zh.md](../README.zh.md)；想看實測數據，看 [bench/COMPETITORS.md](../bench/COMPETITORS.md)。

### 1. 四層結構 / Four planes

```
┌── host plane ──────────── src/index.js
│    建資料目錄 · 安裝 preset · 向 agentPresets 註冊（不做任何宿主 patch）
├── agent plane ─────────── src/tools-entry.js
│    19 個工具；preset 可用 config.only 裁剪工具面
├── tool plane ──────────── src/pentest/{registry,adapters,parsers,exec}.js
│    145 個外部工具 · 範圍校驗 · 參數白名單 · 產物落盤
└── data plane ──────────── src/pentest/{store,spray,report,slots}.js
     JSON 事實庫 · 證據 SHA-256 · 雙語報告 · 併發租約
```

每一層只依賴下一層，宿主升級不會弄壞資料層；資料層沒有原生依賴，換機器直接搬。

### 2. 為什麼是 JSON，不是 SQLite

| | JSON（現況） | SQLite |
|---|---|---|
| 依賴 | 零（Node 內建） | `better-sqlite3` 需編譯，DSH profile 解析不到原生模組就整條掛 |
| 併發 | 資料表更新使用各自的 `<file>.lock` 目錄。寫入者把含有唯一持有者標記的目錄以原子 rename 安裝到鎖定位置，再以原子 rename 更新資料檔。 | WAL 支援併發讀寫 |
| 審計 | 可直接閱讀與比對。專案資料可能含有客戶識別資訊、原始 HTTP 證據及明文憑據。 | 需工具匯出 |
| 規模 | 單靶幾千條沒問題 | 更適合百萬級 |

實測：10 進程 × 30 條併發寫入，**零丟失**（`node scripts/stress.mjs`）。
如果哪天需要百萬級，換 store 介面即可——工具層與報告層不用改。

### 3. 為什麼不 patch 宿主、不改提示詞

`cordis.patch.yml` 只 **insert** 自己的行，從不修改宿主既有行；也不注入任何「讓你忽略規則」的提示詞。

插件透過宿主介面註冊功能。工具會檢查支援的目標參數，DSH 或其他程式的檔案及網路存取仍取決於宿主權限。授權範圍需要網路隔離時，應在主機或網路層執行限制。

### 4. 證據鏈：為什麼每條都要 SHA-256

`store.deliverable()` 選出狀態為 `confirmed` 或 `exploited`，且信心標記不等於 `claimed` 的發現。附件是選填欄位。若已附上證據，報告會列出 SHA-256，供審閱者核對內容。交付前應確認每條發現有足夠的證據支持。

### 5. 多代理：工具白名單而不是提示詞約束

DSH 預設只註冊 **VAPT mode**。另外三個模式可個別選用，並透過 `config.only` 限定可使用的 DSH 工具。

| preset | 拿不到什麼 | 為什麼 |
|---|---|---|
| recon | 拿不到 `vapt_finding_add`、`vapt_crack` | 偵察不該下結論或破解 |
| verify | 拿不到在線噴霧 | 驗證不該擴大在線攻擊面 |
| report | 拿不到 `vapt_tool_run` | 出報告不該再掃 |

`vapt_slot` 另外用租約記錄專案內的執行席位。預設上限是 3，租約 30 分鐘後到期。更新席位時會以獨佔方式建立短期鎖檔，和資料表的鎖目錄分開管理。

### 6. 基準：為什麼要凍結 ground truth

見 [bench/METHODOLOGY.md](../bench/METHODOLOGY.md)。三個要點：

1. **預註冊 + hash**：目錄改了必須升版，結果必須標註版本。
2. **負向對照**：公開端點被報出來就算誤報，防止「全部報一遍」刷分。
3. **裁決制**：不在目錄裡的真洞記 `extra-tp`，不自動算誤報——目錄小不是工具的錯。

實測（v1.6.2，Juice Shop 20 項 + DVWA 10 項）：

| tool | Juice Shop recall | DVWA recall | 成本（Juice Shop） |
|---|---|---|---|
| dsh-vapt | **20/20（100%）** | **10/10（100%）** | 0 token · 3.4 秒 |
| dsh-redteam-mode | 17/20（85%） | 10/10（100%） | DeepSeek · ~5 分鐘 |
| strix | 12/20（60%） | 9/10（90%） | 2378 萬 token · 35 分鐘 · $2 |

### 6b. Dock 面板：為什麼是 `shell.overlay`

在 DSH 0.2.2-rc.5 的 `app.asar` 裡枚举过的 slot 名：`shell.overlay`（148 处）、
`conversation.input.right`（12 处）、`conversation.chat.node`（100 处）、`settings.section`（143 处）——
**没有** `shell.dock` / `shell.panel` / `shell.right` 这类专用 dock slot。

所以面板挂在 `shell.overlay`（与 dsh-purge 的 `dsh-purge-dock` 同一个位置），
另挂 `conversation.input.right` 一个按钮。两者任一不存在都会 `console.warn` 并跳过，不影响宿主启动
（`node scripts/client-smoke.mjs` 覆盖了这个降级路径）。

宿主侧加载规则（从 `@deepseek-ai/dsh-client-modules` 实现读出来的）：

| 要求 | 我们的值 |
|---|---|
| `package.json` → `dsh.client.platform` 必须是字符串 | `"web"` ✓ |
| `dsh.client.inject` 必须是字符串数组 | `[]`（组件只用宿主提供的 `react`，**不依赖任何 client 服务**） |
| `exports["./client"]` 必须能解析到入口 | `"./client.js"` ✓ |
| 包必须在 `dsh.profile.bundles` 里 | 已加入 ✓ |

`inject` 刻意留空：列了 profile 里不存在的包会导致解析失败——这是启动期最容易踩的坑。

### 7. 我們刻意不做的事

| 不做 | 原因 |
|---|---|
| 不內建 LLM 代理 | 模型行為不可復現；本項目做「可復現的那一層」 |
| 不 patch 宿主 / 不改系統提示 | 升級即碎，且不可審計 |
| 不做「全自動攻擊」 | 需要人在環的授權邊界（scope、預算、鎖定即停） |
| 憑據表省略 `secret` 欄位 | 原始證據、指令和其他文字仍可能含有密碼，分享前須審閱。 |

### 8. 擴展點

- **加工具**：`registry.js` 加一條（bin/mk/parser/allowed），或 `src/pentest/parsers.js` 加解析器。
- **加角色**：複製 `presets/vapt-recon`，改 persona 與 `config.only`，跑 `gen-preset-definition.py`。
- **加靶場**：`bench/targets/` 加一個 starter，`ground-truth.json` 加條目（記得升版）。
- **MCP 客戶端**可透過 `mcp/server.mjs` 存取 14 個本機記錄與報告工具。
