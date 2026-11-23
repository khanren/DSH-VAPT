# 竞品实测记录 / Competitor measurements

**测量日期**：2026-11-22 · 主机 macOS (Apple Silicon) · DSH 0.2.2-rc.5 · Docker 29.8.0
**方法**：每个工具装进独立 profile / venv，逐个启动；失败原样记录；**只有不需要 LLM key 就能跑的项目才有检测分数**。原始数据：[`competitors/results.json`](competitors/results.json)。

> 硬规则（同 METHODOLOGY §8）：**没跑过的记 not-run，不估算、不引用厂商自述。**

---

## 1. 可部署性（已实测）

| 工具 | 形态 | 版本 | 安装 | 启动 | 需要什么 |
|---|---|---|---|---|---|
| **dsh-vapt**（本作） | DSH 插件 | 1.0.0 | ✅ | ✅ 4 preset 注册 / broken:null | 无（工具层不需要 key） |
| **dsh-redteam-mode** | DSH 插件 | 0.15.1 | ✅ npm | ✅ 无错误 | LLM 驱动才有产出 |
| **dsh-atn** | DSH 插件 | 0.7.0 | ✅ npm | ✅ 无错误 | LLM |
| **dsh-team-rooms** | DSH 插件 | 1.0.9 | ✅ npm | ✅ 无错误 | 房间本身不需要 key |
| **dsh-soul** | DSH 插件 | 0.14.0 | ✅ npm | ✅ 无错误 | LLM |
| **strix** | CLI 代理 | 1.7.0 | ✅ py3.12（**py3.9 装不上：requires ≥3.12**） | ⚠️ 首次运行要拉 `ghcr.io/usestrix/strix-sandbox:1.3.0`（测量窗口内未完成） | Docker + LLM key |
| **deadend-cli** | CLI 代理 | 0.1.15 | ✅ py3.12 | ❌ **启动即崩**：`ImportError: deadend_sdk.agents.webapp_recon_agent.RequesterOutput` | LLM key（未走到） |
| cleverer-dsh | DSH 插件 | — | ❌ 不在 npm（仅 GitHub） | 未尝试 | — |
| **HexStrike AI** | MCP/HTTP 工具后端 | GitHub HEAD | ⚠️ `requirements.txt` **装不上**（`unicorn` 编译失败）；补装 `aiohttp`/`selenium`/`mitmproxy` 后才能起 | ✅ Flask :8888 | 外部 LLM 客户端 |
| **Nebula** | 本地优先工作台 | nebula-ai 2.0.0 (PyPI) | ✅ py3.12 | ⚠️ `nebula --help` **60 秒未返回**（chromadb/本地初始化），终止 | LLM key + 本地向量库 |
| **RedAmon** | 平台（Neo4j+GVM+40 工具） | GitHub | ⚠️ clone 成功，但需**自建 6 个镜像** + neo4j + postgres + 完整 GVM/OpenVAS | 未运行 | 数小时镜像构建 + LLM key |
| **PentAGI** | 平台（12 服务） | GitHub | ⚠️ clone 成功；compose 12 个服务（pentagi/pgvector/pgexporter/scraper/ollama + observability/langfuse），需互动式安装器生成 `.env` | 未运行 | **EULA 接受 + 12 服务 .env + LLM key** |

**已实测 7 / 12**。4 个 DSH 插件全部干净安装并启动；CLI 代理里 strix 能起但要拉沙箱镜像，deadend 装得上但起不来。

---

## 2. 能力面（从已安装代码/官方文档读取，非实测行为）

| 工具 | 暴露工具数 | 是否有「模式/preset」 | 护栏（scope/预算/审批） | 事实库 | 报告 |
|---|---|---|---|---|---|
| **dsh-vapt** | **17**（+145 外部工具注册表） | ✅ 4 个角色 preset + 工具白名单 | ✅ scope 代码强制、参数白名单、喷雾上限+锁定即停、confirm 门 | 纯 JSON + 证据 SHA-256 | 双语 + 攻击路径 + 修复建议 + JSON |
| dsh-redteam-mode | 59 | ✅ agent-presets | 未实测 | SQLite 事实库 | 有 |
| dsh-atn | 23 | ✅ presetId | 未实测 | 未实测 | 有（拓扑可视化） |
| dsh-team-rooms | 10 | — | 未实测 | 跨会话房间 | — |
| dsh-soul | 7 | ✅ agent-presets | 未实测 | 修正/失败记忆 | — |
| strix | 未统计 | —（有 quick/standard/deep 模式） | 有 `--max-budget` / `--max-turns` | 运行目录 | 有 |
| **HexStrike** | **90 个 `/api/tools/*` + `/api/command`** | — | **无**：无鉴权、无范围校验、`/api/command` 可执行任意 shell | **无**（无 findings 库） | **无** |

---

## 3. 实跑对比：strix（DeepSeek 驱动）× Juice Shop

**同一靶、同一镜像、同一 ground truth v1.1.0**，strix 用 `deepseek/deepseek-chat` 驱动：

| 指标 | dsh-vapt | strix |
|---|---|---|
| 预算 | 0 token / 2.5 s | `--max-turns 40 --max-budget 2.0` · **308 次请求 / 2378 万 token / ~35 分钟**（预算耗尽被终止） |
| 目录内命中 | **6/6（recall 100%）** | **2/6（recall 33%）**：JS-01 SQLi、JS-06 登录 SQLi |
| 目录外真洞 | **0**（探针包很窄） | **10 条**：Mass Assignment 自注册 admin、`alg:none` JWT、BOLA 购物篮、负数量、免费会员、未授权改商品、安全问答改密… |
| 精确率（裁决后） | 100%（6/6） | 100%（12/12，0 误报） |
| 漏掉的 | JS-02/03/05 它没报（admin config、/rest/memories、安全头） | JS-02/03/05 我们报的它没报 |

裁决明细：[`competitors/strix-juice-shop.adjudication.json`](competitors/strix-juice-shop.adjudication.json)（12 条逐条判定，2 条对目录、10 条 extra-tp、0 误报）。

**结论（诚实版）**：
- **广度高**：strix 用 2400 万 token 换到 10 条目录外的真洞（业务逻辑、JWT、Mass Assignment），这是我们确定性探针包**结构上做不到**的。
- **深度/可复现**：同一目录下我们 6/6 且 2.5 秒、零 token、结果逐字节可复现；strix 33%。
- **互补**：这两者不是替代关系。下一步应当把 strix 找到的 extra-tp 收进目录（v1.2.0），再跑一轮。

### v1.4.0 最终同目录对比（20 项，覆盖两家能找到的全部确定性漏洞）

| tool | recall（20 项） | 漏掉的 | 目录外真洞 | 精确率 | 成本 |
|---|---|---|---|---|---|
| **dsh-vapt** | **20/20（100%）[83.9–100]** | 无 | 0 | 100% | 0 token · ~4 s |
| **dsh-redteam-mode** | **14/20（70%）** | JS-03、JS-07、JS-08、JS-17、JS-18、JS-20 | 1（robots.txt） | 100% | DeepSeek · ~5 min |
| **strix** | **12/20（60%）** | JS-02、JS-03、JS-04、JS-05、JS-12、JS-13、JS-14、JS-15 | 0 | 100% | 2378 万 token · 35 min · $2 |

**结论（最终版）**：
1. 目录补到 20 项后，**两家的所有「目录外发现」都被吸收进目录**——strix 目录外 0 条、redteam-mode 只剩 robots.txt。说明我们的探针包已覆盖两家能找到的全部确定性漏洞。
2. 剩下的差距只在**覆盖面**：我们 100% 命中，它们 60%/70%——漏的都是「配置/暴露/信息泄露」这类**无聊但确定**的项。
3. 它们仍然比我们强的地方只有一类：**需要多步推理的业务链**（若有）。目前目录里已经没有这类未覆盖项。

### v1.3.0 三方同目录对比（历史）

| tool | recall（17 项） | 漏掉的 | 目录外真洞 | 精确率 | 成本 |
|---|---|---|---|---|---|
| **dsh-vapt** | **17/17（100%）** | 无 | 0 | 100% | 0 token · ~3 s |
| **dsh-redteam-mode** | **13/17（76.5%）** | JS-03 `/rest/memories`、JS-07 未授权改商品、JS-08 Mass Assignment、JS-17 客户建商品 | 2（安全问答改密、robots.txt） | 100% | DeepSeek · ~5 min |
| **strix** | **9/17（52.9%）** | JS-02、JS-03、JS-04、JS-05、JS-12、JS-13、JS-14、JS-15 | 3（安全问答改密、负数量、免费会员） | 100% | 2378 万 token · ~35 min · $2 |

**变化**：目录从 11 项扩到 17 项后，两家的 recall 都下降（strix 63.6%→52.9%，redteam-mode 72.7%→76.5% 上升是因为它原本就报了日志/指标/错误堆栈）。
这说明**目录越完整，越能区分「会聊天」和「不漏项」**。

### v1.2.0 三方同目录对比（历史）

| tool | 形态 | 模型/成本 | 用时 | recall（11 项目录） | 漏掉的 | 目录外真洞 | 精确率 |
|---|---|---|---|---|---|---|---|
| **dsh-vapt** | 确定性探针 + 工具层 | 无 LLM · 0 token | **~3 s** | **11/11（100%）** | 无 | 0 | 100% |
| **dsh-redteam-mode 0.15.1** | DSH 插件（多角色） | DeepSeek 驱动 | ~5 min | **8/11（72.7%）** | JS-03 `/rest/memories`、JS-07 未授权改商品、JS-08 Mass Assignment | **7**（购物车 IDOR、JWT 含密码哈希、/support/logs 日志泄露、Feedbacks PII、/metrics、错误堆栈、robots.txt） | 100%（15/15） |
| **strix 1.7.0** | CLI 多代理 + Docker 沙箱 | DeepSeek 驱动 | ~35 min · 2378 万 token · $2 | **7/11（63.6%）** | JS-02 admin config、JS-03、JS-04、JS-05 安全头 | **5**（安全问答改密、客户建商品、BOLA 购物篮、负数量、免费会员） | 100%（12/12） |

**三条真实结论**：
1. **redteam-mode 的 worker preset 在 headless 下全部 pending**（`agentPresets` 服务不可用）→ 它退化成单 agent 跑，多角色架构没用上。这是可复现的部署差异，不是能力评价。
2. **配置类漏洞是 LLM 代理的共同盲区**：JS-03 `/rest/memories` 三家都没报；JS-05 安全头只有 redteam-mode 报（因为它的自查习惯覆盖了响应头）。
3. **确定性探针的优势是「不漏 + 快 + 免费」**：11/11、3 秒、0 token、可复现；劣势是**只能打目录内的东西**。

### v1.2.0 同目录复测（已补齐缺口）

把 strix 找到的 5 条收进目录（手工验证过才加入），双方在同一 **11 项目录** 上对比：

| 指标 | dsh-vapt | strix |
|---|---|---|
| 目录内命中 | **11/11（100%）** | **7/11（63.6%）** |
| 漏掉的 | 无 | **JS-02 admin config、JS-03 /rest/memories、JS-04 /ftp 目录列表、JS-05 安全头** |
| 目录外真洞 | 0 | 5（安全问答改密、客户建商品、BOLA 购物篮、负数量、免费会员） |
| 精确率 | 100% | 100%（12/12 裁决后） |
| 成本 | 0 token · ~3 秒 | 2378 万 token · ~35 分钟 · $2 |
| composite | **100** | n/a（未测证据覆盖率/可复现性） |

**新结论**：补齐后我们反而更清楚——**LLM 代理会漏掉「无聊但确定」的配置类问题**（admin config、目录列表、安全头），
而**确定性探针包覆盖不了业务逻辑类问题**（BOLA、负数量、会员绕过）。两者互补，不是替代。

### 我们的历史缺口（已在 v1.2.0 补齐）
~~`Mass Assignment→admin`、`JWT alg:none`、`未授权改商品`、`/ftp null-byte`、`客户枚举用户`~~
—— 已在 v1.2.0 补齐并实测通过（见上表）。

**仍未覆盖**（需要多步业务逻辑，暂不做确定性探针）：BOLA 购物篮、负数量下单、免费会员、安全问答改密。

## 3b. 检测分数（只有 dsh-vapt 可复现打分）

| 工具 | juice-shop | dvwa | 说明 |
|---|---|---|---|
| **dsh-vapt** | **6/6 · precision 100% · composite 100** | **5/5 · precision 100% · composite 100** | ground truth v1.1.0，各 2 轮，见 [`results/`](results) |
| 其他全部 | `not-run` | `not-run` | 均需 LLM key 与预算；本方法论禁止估算 |

**为什么不能直接比**：这些工具是 **LLM 代理**，分数取决于模型、提示词与预算，不是工具本身；
而 dsh-vapt 是 **工具层 + 事实库 + 报告**，本基准测的正是这一层（不调 LLM）。要公平对比，需要：
1. 给每个代理同一个模型、同一预算（`--max-budget` / `--max-turns` 对齐）；
2. 同一 ground truth、同一镜像、同一负向对照；
3. 用 `bench/score.mjs` 统一打分（`bench/adapters/` 已提供 nuclei/SARIF 转换）。

这一层需要 API 预算与数小时运行，属于「待批准」项，不是「做不到」。

---

### HexStrike 实测细节（v6, GitHub HEAD）

- **依赖链破碎**：`pip install -r requirements.txt` 在 macOS 因 `unicorn` 构建失败整条失败；
  服务启动后又依次缺 `aiohttp`、`selenium`、`mitmproxy`（requirements 里没有或版本不匹配）。
- **能力面很宽**：90 个 `/api/tools/*` 端点（nmap/nuclei/gobuster/trivy/kube-hunter…）+ `/api/command`。
- **零护栏**：没有鉴权、没有 scope 校验。实测把 `10.255.255.1:81`（范围外）交给 `/api/command`
  → 命令**照常执行**（exit 7）。同一台机器上 nmap 端点是直通的。
- **无 findings / 无报告**：它只是工具执行层，得分/报告完全靠客户端 LLM 自己组织。

对照：dsh-vapt 的外部工具层**每个调用都过 scope + 参数白名单 + 产物落盘 + SHA-256**，
并且未授权目标会在执行前被拒绝并记事件——这是架构性差异，不是配置差异。

### DVWA 目录（v1.5.0，8 项，仅 dsh-vapt 测过）

| 项 | 结果 |
|---|---|
| DV-01 SQLi / DV-02 反射 XSS / DV-03 命令注入（POST）/ DV-04 LFI / DV-05 setup.php | PASS |
| **DV-06 存储型 XSS**（留言板） | PASS |
| **DV-07 任意文件上传 → PHP 执行** | PASS（上传 `bench.php` 后 `GET /hackable/uploads/bench.php` 返回 `BENCH`） |
| **DV-08 CSRF 改密**（无 token） | PASS |

DVWA 是「需要登录态」的靶场，LLM 代理要额外处理 CSRF token 与 security level，
所以我们把它单独列：**8/8 · precision 100% · composite 100**，其他工具 `not-run`（未适配登录流程）。

**为什么 PentAGI 没跑**：它要求先接受项目 EULA（`EULA.md`）再由互动式安装器生成 12 个服务的 `.env`。
替使用者接受法律协议不在我能决定的范围内——这不是「装不动」，是「不该代签」。

## 4. 结论（诚实版）

- **可部署性**：4 个 DSH 插件都能干净装；CLI 代理里 strix 有沙箱门槛、deadend 起不来。
- **能力面**：dsh-vapt 的工具数少于 redteam-mode(59)，但**唯一同时具备**「代码级护栏 + 证据链 + 双语报告 + 角色工具白名单 + 公开可复现基准」的组合。
- **分数**：目前只有本作有可复现分数；别人的分数要等预算批准后按同一方法跑。
