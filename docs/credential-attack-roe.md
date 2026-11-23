# 憑據攻擊的 RoE 條款（可直接貼進 External-Pentest-Process.md）

**為什麼要有這份**：多數 EPT runbook 直接寫「禁止爆破」，結果報告永遠缺這一塊。
正確做法不是解禁字典爆破，而是**定義一個有預算的噴射窗口**——可量化、可停止、可交付。

---

## 1. 允許的技術（Allow）

| 技術 | 定義 | 允許條件 |
|---|---|---|
| **單口令噴射**（password spray） | 同一個口令嘗試多個帳號，每帳號 ≤ 2 次 | 必須先確認鎖定策略；必須 `delay ≥ 1500ms` |
| **預設憑證檢查** | admin/admin、guest/guest 這類產品預設值 | 每帳號 1 次，不列入噴射預算 |
| **已洩漏憑據驗證** | 客戶提供的、來自其自身洩漏事件的帳號密碼 | 需書面授權，且僅限清單內帳號 |
| **離線破解** | 拿到 hash 後在本地跑 hashcat/john | 不受在線預算限制，但不得回放到生產環境 |

## 2. 禁止的技術（Prohibit）

- **字典爆破**（一帳號 × N 密碼）：會觸發鎖定，等同對客戶做 DoS。
- **憑據填充**（credential stuffing）使用第三方外洩庫：涉及他人資料，且必然大量失敗。
- **MFA 疲勞轟炸**（推送轟炸）、**OTP 攔截**：超出 EPT 範圍，需另立授權。
- **密碼重置流程濫用**、**會話重放真實使用者**：屬於可用性/隱私風險。
- **對鎖定策略未知的系統噴射**：先量測，再決定預算；不確定就不做。

## 3. 硬性預算（Budget）

| 項目 | 上限 | 說明 |
|---|---|---|
| 帳號數 / 輪 | 100 | 超過請拆分批次並重新確認 |
| 口令數 / 輪 | 5 | 一輪一密碼，禁止並行多密碼 |
| 每帳號嘗試 | **2**（硬上限 3） | 必須 ≤ 鎖定閾值 − 1 |
| 全局嘗試 | **20**（硬上限 200） | 超過即停，回報並重新協商 |
| 嘗試間隔 | **≥ 1500ms** | 低於 500ms 直接拒絕執行 |
| 測試窗口 | 由客戶指定 | 避開上班高峰與批次作業 |

> 這些數字不是建議，是 `vapt_password_spray` 的程式碼級上限（`SPRAY_CAPS`）。工具會直接拒絕超限請求。

## 4. 鎖定保護（Lockout guard）

1. **測試前**：向客戶索取或實測帳號鎖定策略（幾次失敗鎖多久）。
2. **預算公式**：`每帳號嘗試次數 = 鎖定閾值 − 1`，且不得超過 3。
3. **執行中**：任一次回應出現 `STATUS_ACCOUNT_LOCKED_OUT` → **全局立即停止**，不再嘗試其他帳號。
4. **通報**：發現鎖定 → 30 分鐘內通知客戶聯絡人，並提供解鎖清單。
5. **收尾**：交付時列出「被觸及的帳號」與「是否遺留鎖定」，供客戶核對。

## 5. 證據要求（Evidence）

- 每次嘗試記一行：`時間 / 目標 / 協定 / 帳號 / 結果`（口令以 `***` 呈現）。
- 命中即建 finding，附命令原文 + 原始輸出 artifact + SHA-256。
- 報告中的憑據**一律脫敏**（前三碼 + `***`），完整值只放加密附件或客戶指定渠道。
- 鎖定事件單獨一節，不與「弱口令」混寫。

## 6. 停止條件（Stop conditions）

出現任一條即停止本輪並回報：

- 帳號鎖定（任何一個）
- WAF/IDS 阻擋、連線被限速或封鎖
- 服務延遲明顯上升（> 2× 基線）
- 客戶聯絡人要求暫停
- 達到全局嘗試預算

## 7. 適用工具（本 harness 內建）

```
vapt_password_spray                     # 受控噴射（本檔第 3 節的預算由程式碼強制）
vapt_credential_add / vapt_credential_list
vapt_tool_run tool:"hydra" …            # 需 confirm:true；建議僅在離線/lab 使用
vapt_tool_run tool:"kerbrute" …         # Kerberos 使用者列舉 / 單口令噴射
```

---

## English summary (for the client-facing annex)

**Allowed**: single-password spraying (≤2 attempts/account, ≥1.5 s apart, ≤20 attempts total),
default-credential checks, pre-approved leaked credentials, offline cracking.
**Prohibited**: dictionary brute force, credential stuffing, MFA fatigue, OTP interception,
session replay, spraying where the lockout policy is unknown.
**Guard**: attempt budget = lockout threshold − 1; stop globally on the first lockout; notify
the client within 30 minutes; list every account touched in the deliverable.
**Evidence**: one line per attempt (password masked), finding + raw artifact + SHA-256 on hit,
credentials masked in the report, lockout events reported in a separate section.
