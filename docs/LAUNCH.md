# Launch Checklist / 发布清单

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

Shipping a plugin that people actually adopt relies on making it **immediately verifiable out of the box**. Follow this checklist in order.

### 1. Repository setup (10 minutes)

- [ ] Set `repository.url` in `package.json` to your actual GitHub repository URL.
- [ ] Verify tool counts in the project description: DSH registers 19 tools (or 17 core + 2 exploitation/checklist helpers), adds `VAPT mode` by default plus three optional role presets, and exposes 14 local record and report tools over MCP.
- [ ] GitHub Topics: `deepseek-harness` `dsh-plugin` `pentest` `security-testing` `benchmark` `mcp` `agent`
- [ ] Include the benchmark comparison tables and diagrams from `bench/PAPER.md` in `README.md` and `README.zh.md` (data is more persuasive than adjectives).

### 2. Publishing (5 minutes)

```bash
npm login
npm publish --access public
git tag v1.0.0 && git push --tags
```

- [ ] Check whether `dsh-vapt` is available on npm (`npm view dsh-vapt version`).
- [ ] After publishing, run `npm view dsh-vapt` to verify the file count and README rendering.

### 3. Sample reports

- [ ] Open the sample report links in the README and verify that all clients, hosts, and evidence use fictional data: [English report](example-report.en.md) · [Chinese report](example-report.zh.md)

### 4. Community distribution (ordered by ROI)

1. **DSH plugin directory repositories**: Open a PR to `awesome-dsh-plugin` / `awesome-deepseek-harness` (one-line link + one-sentence value proposition).
2. **Hacker News / r/netsec**: Lead with data, not adjectives—e.g., *"We benchmarked 4 pentest agents on Juice Shop + DVWA — the deterministic one won on cost and variance"*.
3. **Chinese security communities**: V2EX / Jike / security groups—highlight *"0 tokens, 3 seconds, 100% reproducible, bilingual reports"*.
4. **Academic / technical paper**: `bench/PAPER.md` is structured for direct citation (experimental setup, main table, run-to-run variance, limitations, and LaTeX snippet).

### 5. Pre-release self-check (run all)

```bash
node scripts/verify.mjs       # Functional checks
npm run test:privacy          # Local store & report privacy tests
node scripts/stress.mjs       # Concurrency & zero lost writes
node scripts/mcp-smoke.mjs    # 14 local record & report MCP tools
node scripts/client-smoke.mjs # Console dock button & report preview
node scripts/host-compat.mjs  # 4 checks against real host validation rules
node scripts/e2e.mjs          # 5 end-to-end checks (with real nmap/httpx if installed)
node bench/run.mjs            # Synthetic target benchmark (6/6)
npm pack --dry-run
npm run check:install         # Clean install into a fresh profile and boot check
```

`check:install` packs the current source, creates a new profile in a private temporary `DSH_HOME`, and verifies that only `vapt` is registered by default, all tool definitions are loaded, and `/vapt/ui` and `/vapt/api` return HTTP 200. It shuts down the test process and cleans up the temporary directory on exit. Pass `npm run check:install -- --keep` to inspect the directory locally (note that startup logs inside contain a local access token).

### 6. First-week post-release monitoring

- npm downloads vs. GitHub stars (measures actual usage vs. bookmarking).
- Any installation issues across different host OS/DSH versions.
- Whether `host-compat.mjs` stays green against newer DSH releases (earliest indicator of host contract changes).

### Known limitations (documented upfront in the README)

- Deterministic probes cover known vulnerability classes in the catalogue; open-ended out-of-catalogue business logic exploration still benefits from an LLM agent.
- DVWA benchmarking requires `docker compose` (for the MySQL sidecar).
- Frontend dock panel changes require restarting the desktop app to take effect.

---

<a id="中文"></a>

## 中文

发布一次就被人用上，靠的不是功能多，而是**打开就能验证**。这份清单按顺序做。

### 1. 仓库（10 分钟）

- [ ] `package.json` 的 `repository.url` 改成你的真实仓库地址
- [ ] 核对项目简介中的数量。DSH 默认只添加 VAPT mode，另有三个选配模式。MCP 提供 14 个本地记录和报告工具。
- [ ] Topics：`deepseek-harness` `dsh-plugin` `pentest` `security-testing` `benchmark` `mcp` `agent`
- [ ] 把 `bench/PAPER.md` 的表格与图表放进 README（数据比形容词有用）

### 2. 发版（5 分钟）

```bash
npm login
npm publish --access public
git tag v1.0.0 && git push --tags
```

- [ ] `dsh-vapt` 这个名字在 npm 是否仍可用（`npm view dsh-vapt version`）
- [ ] 发布后 `npm view dsh-vapt` 确认 files 数量与 README 渲染

### 3. 报告示例

- [ ] 打开 README 中的报告链接，核对示例中的客户、主机和证据均为虚构数据：[英文报告](example-report.en.md) · [中文报告](example-report.zh.md)

### 4. 社区扩散（按性价比排序）

1. **DSH 插件清单仓库**：给 `awesome-dsh-plugin` / `awesome-deepseek-harness` 提 PR（一行链接 + 一句价值）
2. **Hacker News / r/netsec**：标题用「We benchmarked 4 pentest agents on Juice Shop + DVWA — the deterministic one won on cost and variance」——**用数据，不用形容词**
3. **中文社区**：V2EX / 即刻 / 安全圈社群，重点讲「0 token、3 秒、可复现」
4. **论文**：`bench/PAPER.md` 已经按 paper 结构写好（实验设置 / 主表 / 方差 / 局限 / LaTeX）

### 5. 发布前自检（都跑一遍）

```bash
node scripts/verify.mjs       # 功能测试
npm run test:privacy          # 本地资料与报告的隐私测试
node scripts/stress.mjs       # 并发零丢失
node scripts/mcp-smoke.mjs    # 14 个本地记录和报告工具
node scripts/client-smoke.mjs # 控制台按钮与报告预览
node scripts/host-compat.mjs  # 4（对照宿主真实校验规则）
node scripts/e2e.mjs          # 5（真 nmap/httpx）
node bench/run.mjs            # 合成靶 6/6
npm pack --dry-run
npm run check:install         # 从零装进新 profile 并启动验证（干净环境）
```

`check:install` 会将当前源码打包，在私有临时 `DSH_HOME` 中新建 profile，并检查默认只注册 `vapt`、工具定义存在、`/vapt/ui` 与 `/vapt/api` 返回 200。结束后关闭测试进程并清理临时目录。使用 `npm run check:install -- --keep` 可保留该目录以便本机排查，里面的启动日志含本机访问令牌。

### 6. 发布后第一周要盯的

- npm 下载量 vs GitHub star（判断是「被收藏」还是「被使用」）
- 有没有人提「装不上」的 issue（宿主版本兼容）
- `host-compat.mjs` 在 DSH 新版本上是否还绿（这是最早的破坏信号）

### 已知限制（主动写在 README，别等人问）

- 只覆盖目录内的已知漏洞类型；目录外探索仍需要 LLM 代理
- DVWA 需要 docker compose（MySQL sidecar）
- 前端面板需要重启桌面 App 才生效
