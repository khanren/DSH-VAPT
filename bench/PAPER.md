# Paper-Ready Benchmark Comparison / 可直接引用的实测对比

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

**Goal**: Evaluate `dsh-vapt` alongside public competitors on **the same targets, the same frozen vulnerability catalogue, and the same scoring rules** to produce citation-ready empirical data.
**Principle**: Any tool not executed is recorded as `not-run` (never estimated); every finding is auditable line-by-line via `bench/competitors/*.adjudication.json`.

### 1. Experimental setup

| Parameter | Value |
|---|---|
| Target 1 | OWASP Juice Shop `bkimminich/juice-shop@sha256:adaf6a…` (Docker, loopback) |
| Target 2 | DVWA `ghcr.io/digininja/dvwa` + `mysql:8.0` (Docker Compose, `security=low`, authenticated session) |
| Ground truth | **v1.6.2**: Juice Shop 20 items + 2 negative controls; DVWA 10 items (each hand-verified before inclusion) |
| Evaluated tools | `dsh-vapt 1.0.0` (deterministic probes), `dsh-redteam-mode 0.15.1`, `strix 1.7.0`, `HexStrike AI v6` |
| Competitor LLM | Both LLM agents driven by `deepseek/deepseek-chat` (LiteLLM), same API key, same host |
| Agent budgets | `strix --max-turns 25 --max-budget $1.50` (DVWA) / 40 turns · `$2.00` (Juice Shop); `dsh-redteam-mode` has no budget flag and runs one full round |
| Scoring definitions | `TP` = catalogue hit; `FN` = missed catalogue item; `FP` = negative control flagged or invalid finding; out-of-catalogue real vulnerabilities = `extra-tp` (included in precision numerator, excluded from recall denominator) |
| Metrics | **Recall, Precision, F1** (Accuracy is omitted because negative controls are small; see §5) |

### 1.5 Disposition of all 12 evaluated tools

We evaluated **12 public tools**, and included every tool capable of producing scorable findings on the live targets in the main table. The disposition of all 12 tools is documented below:

| # | Tool | Evaluation stage reached | In main table | Reason if excluded |
|---|---|---|---|---|
| 1 | **dsh-vapt `1.0.0`** | 3 rounds on both targets | ✅ | — |
| 2 | **dsh-redteam-mode `0.15.1`** | 3 rounds on Juice Shop / 2+1 timeout on DVWA | ✅ | — |
| 3 | **strix `1.7.0`** | 3–6 rounds on both targets | ✅ | — |
| 4 | **HexStrike AI `v6`** | Exercised `/api/tools/nuclei` on both targets | ✅ (as tool backend) | Has **no agent or findings layer**; scored via its nuclei endpoint |
| 5 | `dsh-atn 0.7.0` | Installed ✅ Booted ✅ | ✗ | Multi-agent topology visualizer, **not a vulnerability scanner** |
| 6 | `dsh-team-rooms 1.0.9` | Installed ✅ Booted ✅ | ✗ | Cross-session collaboration plugin; does not produce findings |
| 7 | `dsh-soul 0.14.0` | Installed ✅ Booted ✅ | ✗ | Correction/memory plugin; does not produce findings |
| 8 | `deadend-cli 0.1.15` | Installed ✅, **crashes on start** (`ImportError` in own SDK) | ✗ | Fails to boot |
| 9 | `Nebula 2.0.0` | Installed ✅, `--help` **hangs >60 s** | ✗ | Initialization timed out |
| 10 | `RedAmon` | Cloned ✅ (7,285 files) | ✗ | Requires building **6 custom images** + Neo4j + full GVM/OpenVAS (multi-hour build) |
| 11 | `PentAGI` | Cloned ✅ | ✗ | **12 Docker services** + interactive EULA acceptance to generate `.env` |
| 12 | `cleverer-dsh` | ❌ Not published on npm (GitHub only) | ✗ | No installable package artifact |

### 2. Main results table (best adjudicated run, v1.6.2)

| Target | Tool | Recall | Precision | F1 | TP | FN | FP | Time | Cost | Runs |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| DVWA (10) | **dsh-vapt** | **100.0%** | 100.0% | **100.0%** | 10 | 0 | 0 | **8.7 s** | **0 tokens** | 3 |
| DVWA (10) | dsh-redteam-mode | **100.0%** | 100.0% | **100.0%** | 10 | 0 | 0 | ~8 min | DeepSeek (single round) | 2 (1 timeout) |
| DVWA (10) | strix | 90.0% | 100.0% | 94.7% | 9 | 1 | 0 | 4.4 min | 17.96M tokens · $1.50 | 5 |
| DVWA (10) | HexStrike (nuclei) | 0.0% | — | 0.0% | 0 | 10 | 0 | ~1 min | 0 tokens | 1 |
| Juice Shop (20) | **dsh-vapt** | **100.0%** | 100.0% | **100.0%** | 20 | 0 | 0 | **3.4 s** | **0 tokens** | 3 |
| Juice Shop (20) | dsh-redteam-mode | 85.0% | 100.0% | 91.9% | 17 | 3 | 0 | ~5 min/round | DeepSeek (single round) | 3 |
| Juice Shop (20) | strix | 60.0% | 100.0% | 75.0% | 12 | 8 | 0 | ~35 min | 23.78M tokens · $2.00 | 1 |
| Juice Shop (20) | HexStrike (nuclei) | 5.0% | 100.0% | 9.5% | 1 | 19 | 0 | ~2 min | 0 tokens (no agent layer) | 1 |

#### 2.1 Run-to-run variance (same model, same prompt, same target)

**DVWA (10 items)**

| Tool | Per-round Recall (%) | Mean | Std dev (`σ`) | `n` |
|---|---|---:|---:|---:|
| **dsh-vapt** | `100 / 100 / 100` | **100.0%** | **0.0** | 3 |
| dsh-redteam-mode | `100 / 90` (+1 truncated at 420 s timeout) | 95.0% | 5.0 | 2 |
| strix | `50 / 90 / 90 / 90 / 30 / 90` | 73.3% | **22.4** | 6 |
| HexStrike (nuclei) | `0` | 0.0% | — | 1 |

**OWASP Juice Shop (20 items)**

| Tool | Per-round Recall (%) | Mean | Std dev (`σ`) | `n` |
|---|---|---:|---:|---:|
| **dsh-vapt** | `100 / 100 / 100` | **100.0%** | **0.0** | 3 |
| dsh-redteam-mode | `85 / 85 / 80` | **83.3%** | **2.4** | 3 |
| strix | `50 / 50 / 40` | **46.7%** | **4.7** | 3 |
| HexStrike (nuclei) | `5.0` | 5.0% | — | 1 |

> **Methodology note**: Section 2 shows the best **human-adjudicated** run; Section 2.1 shows the **automated keyword matcher** (`bench/rounds.mjs`) applied uniformly across every raw run log. Both datasets ship in the repository for independent verification.

**Key takeaway**: Using the exact same `deepseek-chat` model, target container, and prompt:
- `strix` swings between **30% and 90%** recall across 6 runs on DVWA (`σ = 22.4` automated, `σ = 24.0` adjudicated);
- `dsh-vapt` achieves **100%** across all 3 runs on both targets (`σ = 0.0`).

### 3. Per-item hit matrix (`✓` hit / `·` missed)

See [bench/PAPER-RESULTS.md](PAPER-RESULTS.md) for the full 30-item table (Juice Shop `JS-01`..`JS-20` and DVWA `DV-01`..`DV-10`).

**Pattern**: LLM agents consistently miss **configuration and exposure items** (`JS-02` admin config, `JS-03` `/rest/memories`, `JS-04` `/ftp` directory listing, `JS-05` missing CSP/HSTS, `JS-12` `/metrics`, `JS-13` `/support/logs`, `JS-14` stack traces, `JS-15` JWT password hash, `DV-05` `setup.php`), while performing well on **injection and business logic flaws** (SQLi, XSS, file upload, CSRF, BOLA, membership bypass).

### 4. Key advantages backed by data

1. **Zero missed catalogue items**: **30/30 (100%)** across both targets (`20/20` + `10/10`), vs. `27/30` (90.0%) for `dsh-redteam-mode` and `21/30` (70.0%) for `strix`.
2. **2–3 orders of magnitude faster**: `3.4 s` / `8.7 s`, compared to `5–35 minutes` per run.
3. **Zero token cost & 100% reproducible**: `0 tokens` and `σ = 0.0` across repeated runs.
4. **Zero host patching**: All guardrails (scope, argument allowlist, spray budget, role tool filtering) are enforced in the tool layer.

### 5. Threats to validity & limitations

- **Sample size**: 20 items on Juice Shop and 10 on DVWA; Wilson 95% confidence intervals are recorded in `bench/results/*.score.json` (e.g., `20/20` has a 95% CI lower bound of `83.9%`).
- **Why Accuracy is omitted**: Only 2 negative controls exist on Juice Shop (0 on DVWA), making Accuracy statistically uninformative.
- **Model binding**: Competitor scores depend on `deepseek-chat`; `dsh-vapt`'s deterministic probe scores are model-independent.
- **Author bias**: Mitigated by freezing and SHA-256 hashing `ground-truth.json` before runs, including negative controls, and shipping line-by-line adjudication files (`bench/competitors/*.adjudication.json`).
- **Environment**: Single-host loopback without network jitter or production WAFs.

### 6. Reproduction commands

```bash
docker compose -f bench/docker-compose.dvwa.yml up -d     # Start DVWA + MySQL
node bench/real.mjs --all --runs 2                        # Run dsh-vapt probes + score
node bench/paper-table.mjs                                # Regenerate bench/PAPER-RESULTS.md
```

---

<a id="中文"></a>

## 中文

**目标**：把「我们的工具」与公开竞品放在**同一靶标、同一漏洞清单、同一评分规则**下实测，产出可写进论文的数据。
**原则**：没跑过的记 `not-run`，不估算；每条发现都要能被第三方复核（`bench/competitors/*.adjudication.json` 逐条判定）。

### 1. 实验设置

| 项 | 值 |
|---|---|
| 靶标 1 | OWASP Juice Shop `bkimminich/juice-shop@sha256:adaf6a…` (Docker, loopback) |
| 靶标 2 | DVWA `ghcr.io/digininja/dvwa` + `mysql:8.0`（compose，security=low，已登录会话） |
| Ground truth | **v1.6.2**：Juice Shop 20 项 + 2 负向对照；DVWA 10 项（手工验证后才纳入） |
| 被测 | dsh-vapt 1.0.0（确定性探针）、dsh-redteam-mode 0.15.1、strix 1.7.0、HexStrike AI v6 |
| 竞品模型 | 两者均用 `deepseek/deepseek-chat`（litellm），同一 key、同一主机 |
| 预算 | strix `--max-turns 25 --max-budget $1.50`（DVWA）／40 turns · $2（Juice）；redteam-mode 无预算参数，跑满一轮 |
| 评分 | TP=命中目录条目；FN=漏；FP=负向对照被误报 + 与目录无关的误报；目录外真洞记 `extra-tp`（进 precision 分子，不进 recall 分母） |
| 指标 | **Recall、Precision、F1**（不用 Accuracy：负样本不足，见 §5） |

### 1.5 为什么打分表里只有 4 个工具（完整 12 个工具的处置）

我们实测了 **12 个公开工具**，但只有能「在同一靶上产出可评分的发现」的才进主表。
其余的不是漏了，而是**不满足评分前提**，原因逐条写在下面——审稿人问起可以直接引用。

| # | Tool | 实测到哪一步 | 进主表 | 不进表的原因 |
|---|---|---|---|---|
| 1 | **dsh-vapt** | 两靶各 3 轮 | ✅ | — |
| 2 | **dsh-redteam-mode 0.15.1** | 两靶实测（DVWA 3 轮 / Juice 3 轮） | ✅ | — |
| 3 | **strix 1.7.0** | 两靶实测（DVWA 6 轮 / Juice 3 轮） | ✅ | — |
| 4 | **HexStrike AI v6** | 驱动其 `/api/tools/nuclei` 打两靶 | ✅（作为「工具后端」一行） | 它本身**没有 agent / findings 层**，只能评它跑出的 nuclei 结果 |
| 5 | dsh-atn 0.7.0 | 安装 ✅ 启动 ✅ | ✗ | 多智能体拓扑插件，**不是漏洞检测器** |
| 6 | dsh-team-rooms 1.0.9 | 安装 ✅ 启动 ✅ | ✗ | 跨会话协作插件，不产出发现 |
| 7 | dsh-soul 0.14.0 | 安装 ✅ 启动 ✅ | ✗ | 纠正/失败记忆插件，不产出发现 |
| 8 | deadend-cli 0.1.15 | 安装 ✅，**启动即崩**（自家 SDK `ImportError`） | ✗ | 跑不起来 |
| 9 | Nebula 2.0.0 | 安装 ✅，`--help` **60 秒无响应** | ✗ | 启动未完成 |
| 10 | RedAmon | clone ✅（7285 文件） | ✗ | 需**自建 6 个镜像** + Neo4j + 完整 GVM/OpenVAS，单次构建数小时 |
| 11 | PentAGI | clone ✅ | ✗ | **12 个服务** + 需接受 EULA + 互动安装器生成 `.env` |
| 12 | cleverer-dsh | ❌ 不在 npm（仅 GitHub） | ✗ | 无可安装产物 |

### 2. 主结果表（全部实测，v1.6.2）

| Target | Tool | Recall | Precision | F1 | TP | FN | FP | Time | Cost | Runs |
|---|---|---|---|---|---|---|---|---|---|---|
| DVWA (10) | **dsh-vapt** | **100.0%** | 100.0% | **100.0%** | 10 | 0 | 0 | **8.7 s** | **0 token** | 3 |
| DVWA (10) | dsh-redteam-mode | **100.0%** | 100.0% | **100.0%** | 10 | 0 | 0 | ~8 min | DeepSeek | 2（1 次超时） |
| DVWA (10) | strix | 90.0% | 100.0% | 94.7% | 9 | 1 | 0 | 4.4 min | 1796 万 token · $1.50 | 5 |
| DVWA (10) | HexStrike (nuclei) | 0.0% | — | 0.0% | 0 | 10 | 0 | ~1 min | 0 token | 1 |
| Juice Shop (20) | **dsh-vapt** | **100.0%** | 100.0% | **100.0%** | 20 | 0 | 0 | **3.4 s** | **0 token** | **3** |
| Juice Shop (20) | dsh-redteam-mode | 85.0% | 100.0% | 91.9% | 17 | 3 | 0 | ~5 min/round | DeepSeek | 3 |
| Juice Shop (20) | strix | 60.0% | 100.0% | 75.0% | 12 | 8 | 0 | ~35 min | 2378 万 token · $2.00 | 1 |
| Juice Shop (20) | HexStrike (nuclei) | 5.0% | 100.0% | 9.5% | 1 | 19 | 0 | ~2 min | 0 token | 1 |

#### 2.1 重复运行的方差（同一模型、同一提示、同一靶）

**DVWA（10 项）**

| Tool | 逐轮 Recall | Mean | σ | n |
|---|---|---|---|---|
| **dsh-vapt** | 100 / 100 / 100 | **100.0%** | **0.0** | 3 |
| dsh-redteam-mode | 100 / 90（另 1 次 420s 超时截断） | 95.0% | 5.0 | 2 |
| strix | 50 / 90 / 90 / 90 / 30 / 90 | 73.3% | **22.4** | 6 |
| HexStrike (nuclei) | 0 | 0.0% | — | 1 |

**Juice Shop（20 项）**

| Tool | 逐轮 Recall | Mean | σ | n |
|---|---|---|---|---|
| **dsh-vapt** | 100 / 100 / 100 | **100.0%** | **0.0** | 3 |
| dsh-redteam-mode | 85 / 85 / 80 | **83.3%** | **2.4** | 3 |
| strix | 50 / 50 / 40 | **46.7%** | **4.7** | 3 |
| HexStrike (nuclei) | 5.0 | 5.0% | — | 1 |

> 方法说明：§2 的表是**人工逐条裁决**的最好一轮；§2.1 是 `bench/rounds.mjs` 用固定关键词规则对每一轮原始输出做的**机械判定**（更严格，因此数值普遍低 5–10 个点）。两者都随包发布，可复核。

### 3. 逐项命中矩阵

完整 30 项命中矩阵见 [bench/PAPER-RESULTS.md](PAPER-RESULTS.md)。

**规律**：两家 LLM 代理漏掉的几乎都是**配置/暴露类**（admin config、目录列表、安全头、metrics、日志、错误堆栈、setup.php），它们更擅长**注入/逻辑类**（SQLi、XSS、上传、CSRF、BOLA、会员绕过）。

### 4. 我们出众在哪（有数据支撑，不是形容词）

1. **不漏**：两个靶 **30 项全中**（20/20 + 10/10）；dsh-redteam-mode 27/30（90.0%），strix 21/30（70.0%）。
2. **快 2–3 个数量级**：3.4 s / 8.7 s，对比 5–35 分钟。
3. **零成本可复现**：0 token；多轮运行 σ = 0。
4. **不改宿主**、**不做提示词注入**：约束在工具层（scope/白名单/预算），可审计。

### 5. 局限

- **样本量小**：Juice 20 项、DVWA 10 项；recall 的 95% CI 见 `bench/results/*.score.json`（如 20/20 的 CI 下限是 83.9%）。
- **不用 Accuracy**：每个靶的「负样本」只有 2 条（Juice 的负向对照），DVWA 无负样本，算 Accuracy 没有统计意义。
- **模型绑定**：竞品分数依赖 `deepseek-chat`，换模型结论可能变化；我们的分数**不依赖模型**（确定性探针）。
- **作者偏差**：ground truth 与探针同一作者；已用「冻结 + sha256 + 负向对照 + 逐条裁决文件」缓解。
- **环境**：单机 loopback，无网络延迟/WAF，不代表真实生产环境。

### 6. 复现命令

```bash
docker compose -f bench/docker-compose.dvwa.yml up -d     # DVWA + MySQL
node bench/real.mjs --all --runs 2                        # 我们的实测 + 评分
node bench/paper-table.mjs                                # 生成 PAPER-RESULTS.md
```
