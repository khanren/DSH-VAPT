# Publishing checklist / 發佈清單

> **zh**：發佈前：① 確認 `package.json` 的 repository/bugs/homepage/author（目前指向 khanren）；
> ② 核對套件名稱；
> ③ 跑功能、隱私、穩定性與端對端測試，並檢查 `npm pack --dry-run`；④ 用 tarball 裝進一個乾淨 profile 實測（看 `.applied.json` 與
> `preset-declare.json`）。目前 CI 回應 `main` 分支的推送、pull request 及手動觸發事件。
> 資料目錄可自訂。檢查待提交的檔案及套件內容，排除真實憑據與專案資料。

Before the first public release:

1. **Set your identity** — `package.json`: `repository`, `bugs`, `homepage`, `author`.
   The defaults point at `github.com/khanren/dsh-vapt`; change them if that is not you.
   Once the repository is public, enable private vulnerability reporting and verify that a signed-in reader can open the form linked from `SECURITY.md`. [GitHub private reporting settings](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
2. **Package name** — Verify the current registry status for the name in `package.json`.
3. **Verify everything**:
   ```bash
   node scripts/verify.mjs     # functional checks (no DSH needed)
   npm run test:privacy        # local data and report privacy
   node scripts/stress.mjs     # 6 stability checks
   node scripts/e2e.mjs        # 5 end-to-end checks (skips missing binaries)
   npm pack --dry-run          # inspect what actually ships
   ```
4. **Test a clean installation** with the local DSH CLI and a temporary profile:
   ```bash
   npm run check:install
   ```
5. **Publish**:
   ```bash
   npm login
   npm publish --access public
   ```
6. **CI triggers** — The workflow runs on pushes to `main`, pull requests and manual
   dispatches. A tag push alone does not start it.
7. **After publishing**: bump `version`, add a `CHANGELOG.md` entry, and keep the
   `dshTargets` list current with the DSH versions actually tested.

## What must not ship

- Keep local assessment runs under `/strix_runs/` out of the public repository. Review the staged file list before committing. `git ls-files --cached -- strix_runs/` should print nothing.

- Exclude `node_modules/`, `*.tgz`, `.DS_Store`, logs and engagement data. Check the configured store location when reviewing files for publication.
- Any real credential. `scripts/` and `docs/` contain only placeholders and synthetic examples.
