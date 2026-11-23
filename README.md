# dsh-vapt

`dsh-vapt` 是 DeepSeek Harness（DSH）的本地渗透测试记录插件。每个授权项目独立保存范围、资产、发现和证据，同一份记录可以生成中英文 Markdown 报告和 JSON 交付件。

`dsh-vapt` keeps a local record of an authorized security assessment in DeepSeek Harness (DSH). Each engagement has its own scope, assets, findings, and evidence. The plugin renders Chinese and English Markdown reports and a JSON export from those records.

## 报告示例 / Sample report

这份中文报告用虚构的「纸舟档案馆」资产清单生成。下面是一条发现从证据到修复建议的摘录。

| 发现 / Finding | 证据摘录 / Evidence excerpt | 修复建议 / Remediation |
|---|---|---|
| 资产清单缺少维护负责人（低风险） | `{"asset":"archive.example.invalid","owner":null}` | 填写负责团队和联系渠道，由值班人员验证能否联系到该团队。 |

The fictional archive’s inventory has no owner for its catalogue service. The Chinese Markdown export links the finding to its evidence and includes a concrete fix. [查看完整报告 / Read the sample report](docs/example-report.zh.md)

## 安装 / Install from source

使用 Node.js 22、npm 和本机 DSH CLI，在项目根目录执行以下命令。安装程序会按需从 web 模板创建 `pentest` 配置并注册插件。若 `dsh` 不在 PATH 中，请将 `DSH_BIN` 设为 CLI 的绝对路径。

From the project root, use Node.js 22 and npm to pack the checkout and install it into the `pentest` profile. The installer creates the profile from DSH’s web template if needed. Set `DSH_BIN` to the CLI’s absolute path if `dsh` is unavailable on your PATH. The package declares Node.js 20 or later and lists DSH `0.2.2-rc.3` and `0.2.2-rc.5` as host targets.

```sh
npm pack
node bin/dsh-vapt.mjs install --profile pentest --package "$PWD/dsh-vapt-1.0.0.tgz"
"${DSH_BIN:-dsh}" --profile pentest
```

首次启动后，打开新会话的模式菜单。插件默认只添加 **VAPT mode**，建档、整理证据和导出报告都可在这里完成。在另一个终端，从项目根目录运行以下命令可检查注册状态。

On first launch, open the mode picker in a new session. The plugin adds one entry by default, **VAPT mode**, which covers the engagement from record creation through reporting. To check registration, run the following from the project root in a second terminal.

```sh
node bin/dsh-vapt.mjs doctor
```

### 选配模式 / Optional modes

| 配置 ID / Preset ID | 菜单名称 / Menu label |
|---|---|
| `vapt-recon` | VAPT recon mode |
| `vapt-verify` | VAPT verify mode |
| `vapt-report` | VAPT report mode |

在 `pentest` profile 的 `cordis.patch.yml` 中，把需要的 ID 加入 `dsh-vapt` 的 `optionalPresets` 列表。文件默认位于 `~/.dsh/profiles/pentest/cordis.patch.yml`。下例只选配报告模式，重启该 profile 后，菜单会显示 **VAPT mode** 和 **VAPT report mode**。

Edit `profiles/pentest/cordis.patch.yml` under `DSH_HOME` (default `~/.dsh`). Add the following entry to its YAML list, or update the existing `dsh-vapt` entry. Restart the profile to apply the change. This example enables the report mode alongside the default.

```yaml
- id: dsh-vapt
  name: dsh-vapt
  config:
    optionalPresets: [vapt-report]
```

每个 ID 都可单独选用，也可组合。设为 `optionalPresets: []` 并重启即可恢复默认。List any combination of the three IDs. Set `optionalPresets: []` and restart to return to one VAPT entry.

## 从记录到报告 / From records to reports

| 操作 / Task | 工具 / Tool | 结果 / Result |
|---|---|---|
| 建立项目 / Start a record | `vapt_engagement_open` | 创建项目并返回 ID，保存客户名、范围、排除项和测试窗口。Creates the engagement, saves its scope, exclusions, and test window, and returns its ID. |
| 整理记录 / Record observations | `vapt_asset_add`, `vapt_finding_add`, `vapt_evidence_add` | 记录资产和发现，通过 finding ID 关联证据。Links evidence to a finding by ID and records a SHA-256 digest for the evidence. |
| 核对发现 / Review findings | `vapt_status`, `vapt_findings_list` | 对照发现总数与可交付数量，查看每条记录的状态。Shows finding statuses and how many findings qualify for delivery. |
| 导出报告 / Export reports | `vapt_report` | 在项目目录中生成 `report.zh.md`、`report.en.md` 和 `report.json`。Writes all three files in the engagement directory. |

在 **VAPT mode** 中使用 `vapt_engagement_open` 建档。对已有项目，先用 `vapt_status` 核对 ID，再用 `vapt_report` 导出。多个会话共用一个当前项目指针，同时处理不同项目时请显式传入 `engagement` ID。

In **VAPT mode**, open a new engagement or check an existing engagement’s ID with `vapt_status`, then generate the files with `vapt_report`. Pass the `engagement` ID explicitly when sessions share a store and work on different assessments.

**哪些发现会进入报告？ / Which findings appear?** 发现的 `status` 必须是 `confirmed` 或 `exploited`，且 `confidence` 不能是 `claimed`。证据附件是可选项，交付前应核对关联证据。

A finding qualifies when its status is `confirmed` or `exploited` and its confidence is other than `claimed`. A qualifying finding can have no attached evidence. In `report.json` (schema `dsh-vapt/report@1`), `counts.findings` is the number included and `counts.withheld` is the number left out.

**如何核对证据摘要？ / How do I verify an evidence digest?** 按顺序将原始 `tool`、`command`、`request`、`response` 用一个换行符（LF）连接，再对 UTF-8 字节计算 SHA-256。较长的请求和响应会被截短，核对时需要完整原文。

The digest covers the four original fields in that order, joined with LF and encoded as UTF-8. The store retains the first 20,000 UTF-16 code units of each request and response. Markdown shows up to 2,000 of the response. Keep the original inputs if you need to verify a longer record.

## 控制台与接口 / Console and integrations

- **DSH** · 插件提供 17 个 DSH 工具。新 profile 的模式菜单默认只添加 **VAPT mode**。点击输入框旁的 `vapt` 按钮可查看项目和报告。DSH registers 17 plugin tools and adds one mode by default. Open the `vapt` panel or the local `/vapt/ui` page to review findings and preview a report.
- **MCP** · `dsh-vapt-mcp` 通过标准输入输出提供 14 个本地记录和报告工具，可整理项目、资产、发现和证据，并导出报告。The stdio MCP server exposes 14 tools for working with local records and reports. Set `VAPT_ENGAGEMENT` to select an existing record by ID.
- **外部工具 / External tools** · 注册表有 145 个条目，对应程序需另行安装。The registry describes 145 external tools. Recording findings and generating reports only require the local store.

## 数据位置与隐私 / Storage and privacy

DSH 优先使用插件配置中的 `root`，MCP 优先使用环境变量 `VAPT_ROOT`。缺省时，两者依次使用 `VAPT_HOME`、`$DSH_HOME/vapt` 或 `~/.dsh/vapt`。两个客户端都可以读写所选目录中的项目。

The DSH plugin’s `root` setting and the MCP server’s `VAPT_ROOT` environment variable each override the shared `VAPT_HOME` setting. With no override, the store lives under `$DSH_HOME/vapt`, or `~/.dsh/vapt` if `DSH_HOME` is unset. Point both clients at the same directory to share records.

```text
<data-root>/
  current.json
  engagements/<engagement-id>/
    engagement.json
    assets.json        findings.json      evidence.json
    credentials.json   events.jsonl       artifacts/
    report.zh.md       report.en.md       report.json
```

`credentials.json` 在本地以明文保存。新建或重写的凭据和导出报告在 macOS/Linux 上使用文件权限 `0600`。控制台的证据预览只显示元数据和 SHA-256。本地 Markdown 导出会包含原始证据，分享前请检查其中的敏感信息。

The store keeps credential secrets in plaintext. New and rewritten credential files and report exports use mode `0600` on POSIX systems. The dashboard shows evidence metadata and SHA-256 digests. Disk exports omit the credential secret field, but can contain recorded commands and, in Markdown, raw requests and responses. Review exports before sharing them. [安全策略 / Security policy](SECURITY.md)

## 本地检查 / Local checks

以下检查可在源码目录运行，无需启动 DSH 或 Docker。Run these checks from the project root. They use local fixtures, temporary stores, or package metadata.

| 命令 / Command | 检查内容 / Coverage |
|---|---|
| `npm run mcp:test` | 核对 14 个 MCP 工具，用虚构资产验证从建档到交付的流程 / 14-tool inventory, stdio handshake, findings, evidence digests, credential masking, project isolation and all three exports |
| `npm run test:privacy` | 文件权限、目录边界、故障恢复、预览脱敏与报告格式 / private files, path boundaries, damaged tables, scope exclusions, dashboard redaction and Markdown rendering |
| `npm run client:test` | 控制台按钮、刷新和报告预览 / dock registration, refresh, and report preview |
| `npm run host:check` | DSH 客户端声明及入口 / client manifest and loader entry point |
| `npm run stress` | 并发写入和故障恢复 / concurrent store writes, stale locks, and recovery |
| `npm run bench:test` | 评分与结果一致性 / scoring arithmetic and repeatable summaries |

已安装 DSH CLI 时，可运行 `npm run check:install`。它会重新打包当前源码，在独立的临时 `DSH_HOME` 中创建 profile，并检查默认只注册 `VAPT mode`。With the local DSH CLI installed, this check packs the current source and verifies the default VAPT registration in a fresh profile.

完整测试入口为 `npm test`，另含功能测试及本地合成靶场基准。The full `npm test` suite also runs functional checks and a benchmark against a local fixture. [脚本定义 / Package scripts](package.json)

## 基准结果 / Benchmark results

仓库保存了固定目录 **v1.6.2** 的评分结果。项目自带的确定性探针在 OWASP Juice Shop 中命中 20/20 项，在 DVWA 中命中 10/10 项。下表为归档结果，衡量范围仅限该目录与对应环境。

The recorded scores measure the project’s deterministic probes against a predefined catalogue. The run counts matter when interpreting repeatability, particularly for DVWA. [评分结果 / Recorded results](bench/paper-results.json) · [评测方法 / Methodology](bench/METHODOLOGY.md)

| 靶场 / Target | 目录命中 / Catalogue hits | 误报 / False positives | 轮数 / Runs |
|---|---:|---:|---:|
| OWASP Juice Shop | 20 / 20 | 0 | 3 |
| DVWA | 10 / 10 | 0 | 1 |

[架构 / Architecture](docs/ARCHITECTURE.md) · [变更记录 / Changelog](CHANGELOG.md) · [Apache-2.0 license](LICENSE)
