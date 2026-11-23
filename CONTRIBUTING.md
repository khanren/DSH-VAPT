# Contributing / 貢獻指南

在專案根目錄執行功能及隱私測試。若有本機 DSH CLI，可用 `npm run check:install` 將目前的程式碼裝進臨時 profile，確認插件預設只註冊一個 VAPT 模式。

## Dev loop

改 `presets/vapt/*.yml` 之后必须重生成登记定义（模式下拉读的是它）：
After changing `presets/vapt/*.yml`, regenerate the registry definition (the mode
dropdown reads it):

```bash
python3 scripts/gen-preset-definition.py
```


Run the functional and privacy checks from the project root.

```bash
node scripts/verify.mjs
npm run test:privacy
```

## Trying it in a real host

With a local DSH CLI installed, run `npm run check:install`. It packs the current checkout, starts DSH in a temporary profile and checks that the plugin registers only `vapt` by default. For the manual installation steps, see the [README](README.md#安装--install-from-source).

## Ground rules

- **No host patching.** Only register rows/tools; never rewrite approval, sandbox or
  prompt handling. PRs that patch the host will be rejected — the whole point of this
  plugin is that a DSH upgrade cannot break it.
- Tools must never throw: return structured `{ok:false, error_kind}` instead.
- Every new tool needs: bilingual description, field-map `parameters`, and a line in
  `scripts/verify.mjs`.
- Keep the store dependency-free (Node built-ins only).
