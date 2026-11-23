# Competitor Evaluation Notes / 竞品实测记录

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

**Evaluation date**: 2026-11-22 · **Host**: macOS (Apple Silicon) · **DSH**: `0.2.2-rc.5` · **Docker**: `29.8.0`
**Method**: Each tool was installed into an isolated profile or virtualenv and booted individually. Failures are recorded verbatim. Raw data: [`competitors/results.json`](competitors/results.json).

> **Hard rule (METHODOLOGY §8)**: Any tool not executed is recorded as `not-run`—never estimated, and never copied from vendor marketing claims.

### 1. Deployability (12 tools evaluated)

| Tool | Form | Version | Install | Boot | Requirements |
|---|---|---|---|---|---|
| **dsh-vapt** (this project) | DSH plugin | `1.0.0` | ✅ | ✅ 1 default + 3 optional presets (`broken: null`) | None (tool layer needs no LLM key) |
| **dsh-redteam-mode** | DSH plugin | `0.15.1` | ✅ npm | ✅ Clean boot | Requires LLM key to drive actions |
| **dsh-atn** | DSH plugin | `0.7.0` | ✅ npm | ✅ Clean boot | LLM key |
| **dsh-team-rooms** | DSH plugin | `1.0.9` | ✅ npm | ✅ Clean boot | Rooms work without key |
| **dsh-soul** | DSH plugin | `0.14.0` | ✅ npm | ✅ Clean boot | LLM key |
| **strix** | CLI agent | `1.7.0` | ✅ Python 3.12 (**fails on 3.9: requires ≥3.12**) | ⚠️ Pulls `ghcr.io/usestrix/strix-sandbox:1.3.0` on first run | Docker + LLM key |
| **deadend-cli** | CLI agent | `0.1.15` | ✅ Python 3.12 | ❌ **Crashes on start**: `ImportError: deadend_sdk.agents.webapp_recon_agent.RequesterOutput` | LLM key (never reached) |
| **cleverer-dsh** | DSH plugin | — | ❌ Not on npm (GitHub only) | Not attempted | — |
| **HexStrike AI** | MCP/HTTP backend | GitHub HEAD | ⚠️ `requirements.txt` **fails** (`unicorn` build fails); requires manually installing `aiohttp`, `selenium`, `mitmproxy` | ✅ Flask `:8888` | External LLM client |
| **Nebula** | Local workbench | `nebula-ai 2.0.0` (PyPI) | ✅ Python 3.12 | ⚠️ `nebula --help` **hangs >60 s** (ChromaDB / local vector init) | LLM key + local vector DB |
| **RedAmon** | Platform (Neo4j+GVM+40 tools) | GitHub | ⚠️ Cloned, requires **building 6 custom images** + Neo4j + Postgres + full GVM/OpenVAS | `not-run` | Multi-hour image build + LLM key |
| **PentAGI** | Platform (12 services) | GitHub | ⚠️ Cloned; Docker Compose has 12 services and requires an interactive installer to accept EULA and generate `.env` | `not-run` | **EULA acceptance + 12-service `.env` + LLM key** |

### 2. Capability & guardrail comparison

| Tool | Exposed tools | Role presets | Code-enforced guardrails (scope / budget / allowlist) | Findings store | Report exports |
|---|---|---|---|---|---|
| **dsh-vapt** | **19** (+145 external tool registry) | ✅ 1 default + 3 role presets with tool allowlists | ✅ Hard scope check, argument allowlist, spray caps + lockout stop, `confirm:true` gate | Pure JSON + SHA-256 digests | Bilingual Markdown + Mermaid attack path + remediation + `report.json` |
| **dsh-redteam-mode** | 59 | ✅ `agent-presets` | Not enforced at tool layer | SQLite store | Yes |
| **dsh-atn** | 23 | ✅ `presetId` | Not evaluated | Not evaluated | Topology visualization |
| **dsh-team-rooms** | 10 | — | Not evaluated | Cross-session rooms | — |
| **dsh-soul** | 7 | ✅ `agent-presets` | Not evaluated | Correction / failure memory | — |
| **strix** | Varies | `quick` / `standard` / `deep` CLI modes | `--max-budget` / `--max-turns` | Per-run directory | Yes |
| **HexStrike AI** | 90 `/api/tools/*` + `/api/command` | — | **None**: no auth, no scope validation, `/api/command` executes arbitrary out-of-scope shell commands | **None** (no findings store) | **None** |

### 3. Live target comparison: Juice Shop (20 items) & DVWA (10 items)

All tools were evaluated against frozen ground truth **v1.6.2** (`dsh-redteam-mode` and `strix` driven by `deepseek/deepseek-chat`):

| Target | Tool | Recall | Missed items | Out-of-catalogue hits (`extra-tp`) | Precision | Cost & time |
|---|---|---:|---|---:|---:|---|
| **Juice Shop (20)** | **dsh-vapt** | **20/20 (100%)** | None | 0 | 100% | **0 tokens · 3.4 s** |
| **Juice Shop (20)** | **dsh-redteam-mode** | **17/20 (85%)** | `JS-07`, `JS-17`, `JS-20` | 1 (`robots.txt`) | 100% | DeepSeek · ~5 min/round |
| **Juice Shop (20)** | **strix** | **12/20 (60%)** | `JS-02..05`, `JS-12..15` | 0 | 100% | 23.78M tokens · ~35 min · $2.00 |
| **Juice Shop (20)** | **HexStrike (nuclei)** | **1/20 (5%)** | 19 items | 0 | 100% | 0 tokens · ~2 min |
| **DVWA (10)** | **dsh-vapt** | **10/10 (100%)** | None | 0 | 100% | **0 tokens · 8.7 s** |
| **DVWA (10)** | **dsh-redteam-mode** | **10/10 (100%)** | None | 1 | 100% | DeepSeek · ~8 min |
| **DVWA (10)** | **strix** | **9/10 (90%)** | `DV-05` (`setup.php`) | 4 | 100% | 17.96M tokens · 4.4 min · $1.50 |
| **DVWA (10)** | **HexStrike (nuclei)** | **0/10 (0%)** | All 10 items | 0 | — | 0 tokens · ~1 min |

Adjudication details are stored in [`competitors/strix-juice-shop.adjudication.json`](competitors/strix-juice-shop.adjudication.json) and sibling `*.adjudication.json` files.

### 4. HexStrike AI architectural comparison

- **Broken dependency chain**: `pip install -r requirements.txt` fails on macOS due to `unicorn` compilation errors, and runtime imports fail without manually installing `aiohttp`, `selenium`, and `mitmproxy`.
- **Zero guardrails**: No authentication and no scope checks. Passing an out-of-scope target (`10.255.255.1:81`) to `/api/command` executes the command directly.
- **No findings or reporting layer**: It acts purely as an unguarded HTTP wrapper around CLI binaries.
- **In contrast**, `dsh-vapt` validates every tool invocation against the engagement scope and argument allowlist, persists output artifacts with SHA-256 digests, and blocks and logs out-of-scope targets before any packet is sent.

---

<a id="中文"></a>

## 中文

**测量日期**：2026-11-22 · 主机 macOS (Apple Silicon) · DSH 0.2.2-rc.5 · Docker 29.8.0
**方法**：每个工具装进独立 profile / venv，逐个启动；失败原样记录。原始数据：[`competitors/results.json`](competitors/results.json)。

> 硬规则（同 METHODOLOGY §8）：**没跑过的记 not-run，不估算、不引用厂商自述。**

### 1. 可部署性（已实测）

| 工具 | 形态 | 版本 | 安装 | 启动 | 需要什么 |
|---|---|---|---|---|---|
| **dsh-vapt**（本作） | DSH 插件 | 1.0.0 | ✅ | ✅ 1 默认 + 3 选配 preset 注册 / broken:null | 无（工具层不需要 key） |
| **dsh-redteam-mode** | DSH 插件 | 0.15.1 | ✅ npm | ✅ 无错误 | LLM 驱动才有产出 |
| **dsh-atn** | DSH 插件 | 0.7.0 | ✅ npm | ✅ 无错误 | LLM |
| **dsh-team-rooms** | DSH 插件 | 1.0.9 | ✅ npm | ✅ 无错误 | 房间本身不需要 key |
| **dsh-soul** | DSH 插件 | 0.14.0 | ✅ npm | ✅ 无错误 | LLM |
| **strix** | CLI 代理 | 1.7.0 | ✅ py3.12（**py3.9 装不上：requires ≥3.12**） | ⚠️ 首次运行要拉 `ghcr.io/usestrix/strix-sandbox:1.3.0` | Docker + LLM key |
| **deadend-cli** | CLI 代理 | 0.1.15 | ✅ py3.12 | ❌ **启动即崩**：`ImportError: deadend_sdk.agents.webapp_recon_agent.RequesterOutput` | LLM key（未走到） |
| cleverer-dsh | DSH 插件 | — | ❌ 不在 npm（仅 GitHub） | 未尝试 | — |
| **HexStrike AI** | MCP/HTTP 工具后端 | GitHub HEAD | ⚠️ `requirements.txt` **装不上**（`unicorn` 编译失败）；补装 `aiohttp`/`selenium`/`mitmproxy` 后才能起 | ✅ Flask :8888 | 外部 LLM 客户端 |
| **Nebula** | 本地优先工作台 | nebula-ai 2.0.0 (PyPI) | ✅ py3.12 | ⚠️ `nebula --help` **60 秒未返回**（chromadb/本地初始化），终止 | LLM key + 本地向量库 |
| **RedAmon** | 平台（Neo4j+GVM+40 工具） | GitHub | ⚠️ clone 成功，但需**自建 6 个镜像** + neo4j + postgres + 完整 GVM/OpenVAS | 未运行 | 数小时镜像构建 + LLM key |
| **PentAGI** | 平台（12 服务） | GitHub | ⚠️ clone 成功；compose 12 个服务，需互动式安装器生成 `.env` | 未运行 | **EULA 接受 + 12 服务 .env + LLM key** |

### 2. 能力面（从已安装代码/官方文档读取）

| 工具 | 暴露工具数 | 是否有「模式/preset」 | 护栏（scope/预算/审批） | 事实库 | 报告 |
|---|---|---|---|---|---|
| **dsh-vapt** | **19**（+145 外部工具注册表） | ✅ 4 个角色 preset + 工具白名单 | ✅ scope 代码强制、参数白名单、喷雾上限+锁定即停、confirm 门 | 纯 JSON + 证据 SHA-256 | 双语 + 攻击路径 + 修复建议 + JSON |
| dsh-redteam-mode | 59 | ✅ agent-presets | 工具层未强制 | SQLite 事实库 | 有 |
| dsh-atn | 23 | ✅ presetId | 未实测 | 未实测 | 有（拓扑可视化） |
| dsh-team-rooms | 10 | — | 未实测 | 跨会话房间 | — |
| dsh-soul | 7 | ✅ agent-presets | 未实测 | 修正/失败记忆 | — |
| strix | 未统计 | —（有 quick/standard/deep 模式） | 有 `--max-budget` / `--max-turns` | 运行目录 | 有 |
| **HexStrike** | **90 个 `/api/tools/*` + `/api/command`** | — | **无**：无鉴权、无范围校验、`/api/command` 可执行任意 shell | **无**（无 findings 库） | **无** |

### 3. 同目录实跑对比（v1.6.2：Juice Shop 20 项 + DVWA 10 项）

| 靶场 | 工具 | recall | 漏掉的 | 目录外真洞 | 精确率 | 成本与耗时 |
|---|---|---:|---|---:|---:|---|
| **Juice Shop (20)** | **dsh-vapt** | **20/20 (100%)** | 无 | 0 | 100% | **0 token · 3.4 s** |
| **Juice Shop (20)** | **dsh-redteam-mode** | **17/20 (85%)** | JS-07、JS-17、JS-20 | 1（robots.txt） | 100% | DeepSeek · ~5 min/轮 |
| **Juice Shop (20)** | **strix** | **12/20 (60%)** | JS-02..05、JS-12..15 | 0 | 100% | 2378 万 token · 35 min · $2.00 |
| **Juice Shop (20)** | **HexStrike (nuclei)** | **1/20 (5%)** | 19 项 | 0 | 100% | 0 token · ~2 min |
| **DVWA (10)** | **dsh-vapt** | **10/10 (100%)** | 无 | 0 | 100% | **0 token · 8.7 s** |
| **DVWA (10)** | **dsh-redteam-mode** | **10/10 (100%)** | 无 | 1 | 100% | DeepSeek · ~8 min |
| **DVWA (10)** | **strix** | **9/10 (90%)** | DV-05 (setup.php) | 4 | 100% | 1796 万 token · 4.4 min · $1.50 |
| **DVWA (10)** | **HexStrike (nuclei)** | **0/10 (0%)** | 10 项 | 0 | — | 0 token · ~1 min |

### 4. HexStrike 实测细节（v6, GitHub HEAD）

- **依赖链破碎**：`pip install -r requirements.txt` 在 macOS 因 `unicorn` 构建失败整条失败；服务启动后又依次缺 `aiohttp`、`selenium`、`mitmproxy`。
- **零护栏**：没有鉴权、没有 scope 校验。实测把 `10.255.255.1:81`（范围外）交给 `/api/command` → 命令照常执行。
- **无 findings / 无报告**：它只是工具执行层，得分/报告完全靠客户端 LLM 自己组织。
- **对照**：dsh-vapt 的外部工具层**每个调用都过 scope + 参数白名单 + 产物落盘 + SHA-256**，并且未授权目标会在执行前被拒绝并记事件——这是架构性差异，不是配置差异。
