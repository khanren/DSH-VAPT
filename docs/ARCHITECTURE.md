# 架構與設計取捨 / Architecture & trade-offs

這份文檔解釋 **為什麼這樣設計**，以及每個決定換到了什麼、放棄了什麼。
如果你只想知道怎麼用，看 [README](../README.md)；想看實測數據，看 [bench/COMPETITORS.md](../bench/COMPETITORS.md)。

---

## 1. 四層結構 / Four planes

```
┌── host plane ──────────── src/index.js
│    建資料目錄 · 安裝 preset · 向 agentPresets 註冊（不做任何宿主 patch）
├── agent plane ─────────── src/tools-entry.js
│    17 個工具；preset 可用 config.only 裁剪工具面
├── tool plane ──────────── src/pentest/{registry,adapters,parsers,exec}.js
│    145 個外部工具 · 範圍校驗 · 參數白名單 · 產物落盤
└── data plane ──────────── src/pentest/{store,spray,report,slots}.js
     JSON 事實庫 · 證據 SHA-256 · 雙語報告 · 併發租約
```

每一層只依賴下一層，宿主升級不會弄壞資料層；資料層沒有原生依賴，換機器直接搬。

## 2. 為什麼是 JSON，不是 SQLite

| | JSON（現況） | SQLite |
|---|---|---|
| 依賴 | 零（Node 內建） | `better-sqlite3` 需編譯，DSH profile 解析不到原生模組就整條掛 |
| 併發 | 資料表更新使用各自的 `<file>.lock` 目錄。寫入者把含有唯一持有者標記的目錄以原子 rename 安裝到鎖定位置，再以原子 rename 更新資料檔。 | WAL 支援併發讀寫 |
| 審計 | 可直接閱讀與比對。專案資料可能含有客戶識別資訊、原始 HTTP 證據及明文憑據。 | 需工具匯出 |
| 規模 | 單靶幾千條沒問題 | 更適合百萬級 |

實測：10 進程 × 30 條併發寫入，**零丟失**（`node scripts/stress.mjs`）。
如果哪天需要百萬級，換 store 介面即可——工具層與報告層不用改。

## 3. 為什麼不 patch 宿主、不改提示詞

`cordis.patch.yml` 只 **insert** 自己的行，從不修改宿主既有行；也不注入任何「讓你忽略規則」的提示詞。

插件透過宿主介面註冊功能。工具會檢查支援的目標參數，DSH 或其他程式的檔案及網路存取仍取決於宿主權限。授權範圍需要網路隔離時，應在主機或網路層執行限制。

## 4. 證據鏈：為什麼每條都要 SHA-256

`store.deliverable()` 選出狀態為 `confirmed` 或 `exploited`，且信心標記不等於 `claimed` 的發現。附件是選填欄位。若已附上證據，報告會列出 SHA-256，供審閱者核對內容。交付前應確認每條發現有足夠的證據支持。

## 5. 多代理：工具白名單而不是提示詞約束

DSH 預設只註冊 **VAPT mode**。另外三個模式可個別選用，並透過 `config.only` 限定可使用的 DSH 工具。

| preset | 拿不到什麼 | 為什麼 |
|---|---|---|
| recon | 拿不到 `vapt_finding_add` | 偵察不該下結論 |
| verify | 拿不到噴霧/爆破 | 驗證不該擴大攻擊面 |
| report | 拿不到 `vapt_tool_run` | 出報告不該再掃 |

`vapt_slot` 另外用租約記錄專案內的執行席位。預設上限是 3，租約 30 分鐘後到期。更新席位時會以獨佔方式建立短期鎖檔，和資料表的鎖目錄分開管理。

## 6. 基準：為什麼要凍結 ground truth

見 [bench/METHODOLOGY.md](../bench/METHODOLOGY.md)。三個要點：

1. **預註冊 + hash**：目錄改了必須升版，結果必須標註版本。
2. **負向對照**：公開端點被報出來就算誤報，防止「全部報一遍」刷分。
3. **裁決制**：不在目錄裡的真洞記 `extra-tp`，不自動算誤報——目錄小不是工具的錯。

實測（v1.4.0，20 項，Juice Shop）：

| tool | recall | 成本 |
|---|---|---|
| dsh-vapt | **20/20（100%）** | 0 token · 3 秒 |
| dsh-redteam-mode | 14/20（70%） | DeepSeek · 5 分鐘 |
| strix | 12/20（60%） | 2378 萬 token · 35 分鐘 · $2 |

## 6b. Dock 面板：為什麼是 `shell.overlay`

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

## 7. 我們刻意不做的事

| 不做 | 原因 |
|---|---|
| 不內建 LLM 代理 | 模型行為不可復現；本項目做「可復現的那一層」 |
| 不 patch 宿主 / 不改系統提示 | 升級即碎，且不可審計 |
| 不做「全自動攻擊」 | 需要人在環的授權邊界（scope、預算、鎖定即停） |
| 憑據表省略 `secret` 欄位 | 原始證據、指令和其他文字仍可能含有密碼，分享前須審閱。 |

## 8. 擴展點

- **加工具**：`registry.js` 加一條（bin/mk/parser/allowed），或 `src/pentest/parsers.js` 加解析器。
- **加角色**：複製 `presets/vapt-recon`，改 persona 與 `config.only`，跑 `gen-preset-definition.py`。
- **加靶場**：`bench/targets/` 加一個 starter，`ground-truth.json` 加條目（記得升版）。
- **MCP 客戶端**可透過 `mcp/server.mjs` 存取 14 個本機記錄與報告工具。DSH 註冊的工具共 17 個。
