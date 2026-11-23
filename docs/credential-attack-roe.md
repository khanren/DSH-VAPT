# Rules of Engagement (RoE) for Credential Attacks / 憑據攻擊的 RoE 條款

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

**Why this document exists**: Most external penetration test (EPT) runbooks simply state "no brute force," which leaves credential resilience completely untested in the final report. The right approach is not to enable dictionary brute-forcing, but to **define a strictly budgeted password-spraying window**—quantifiable, stoppable, and auditable.

### 1. Allowed techniques

| Technique | Definition | Conditions |
|---|---|---|
| **Single-password spraying** | Try one password across multiple accounts, ≤ 2 attempts per account | Lockout policy must be confirmed first; `delay ≥ 1500ms` required |
| **Default credential check** | Product default pairs such as `admin/admin` or `guest/guest` | 1 attempt per account; excluded from spray budget |
| **Leaked credential verification** | Client-provided credentials from the client's own breach records | Requires written authorization and applies only to listed accounts |
| **Offline cracking** | Local `hashcat` / `john` runs against collected password hashes | Not subject to online attempt budgets; cracked passwords must not be replayed against production without authorization |

### 2. Prohibited techniques

- **Dictionary brute force** (1 account × N passwords): Triggers account lockouts and causes a denial of service against the client.
- **Credential stuffing** using third-party breach dumps: Involves third-party data and generates massive authentication failures.
- **MFA fatigue / push bombing** and **OTP interception**: Outside standard EPT scope; requires separate authorization.
- **Password reset flow abuse** or **replaying active sessions of real users**: Poses availability and privacy risks.
- **Spraying systems with an unknown lockout policy**: Measure or confirm the lockout policy first; if unknown, do not spray.

### 3. Hard budgets (`SPRAY_CAPS`)

| Parameter | Hard cap | Notes |
|---|---|---|
| Accounts per run | 100 | Split larger lists into batches and re-confirm before proceeding |
| Passwords per run | 5 | One password per round; parallel multi-password spraying is prohibited |
| Attempts per account | **2** (hard cap: 3) | Must be ≤ `lockout_threshold − 1` |
| Total attempts per run | **20** (hard cap: 200) | Stop immediately when reached; report and re-negotiate if needed |
| Delay between attempts | **≥ 1500 ms** | Requests below `500 ms` are rejected by code |
| Test window | Client-specified | Avoid peak business hours and batch-processing windows |

> These numbers are not mere guidelines—they are code-level hard caps (`SPRAY_CAPS`) enforced by `vapt_password_spray`. Requests exceeding them are rejected before any packet is sent.

### 4. Lockout guard

1. **Pre-test**: Obtain or verify the account lockout policy (threshold and lockout duration) with the client.
2. **Budget formula**: `maxAttemptsPerAccount = lockout_threshold − 1` (never exceeding 3).
3. **During execution**: If any response indicates `STATUS_ACCOUNT_LOCKED_OUT`, **stop globally immediately**—do not attempt remaining accounts.
4. **Notification**: If a lockout occurs, notify the client contact within 30 minutes with the list of affected accounts.
5. **Delivery**: List all accounts touched and whether any lockout occurred so the client can audit their logs.

### 5. Evidence requirements

- Log one audit event per spray run: timestamp, target, protocol, attempt count, hits, and lockout count (passwords masked as `***`).
- Every hit automatically creates a finding and attaches the command, raw output artifact, and SHA-256 digest.
- Credentials in reports are **masked by default** (`secret` field omitted from report tables); full plaintext secrets remain only in the local `0600`-protected `credentials.json` or encrypted client deliverables.
- Lockout events appear in a dedicated report section separate from weak-password findings.

### 6. Stop conditions

Abort the current round and report immediately if any of the following occurs:

- Any account lockout is detected
- WAF / IDS blocking, rate limiting, or IP ban is triggered
- Service latency increases noticeably (> 2× baseline)
- The client contact requests a pause
- The global attempt budget is reached

### 7. Built-in harness tools

```text
vapt_password_spray                     # Controlled spray (Section 3 budgets enforced in code)
vapt_credential_add / vapt_credential_list
vapt_crack                              # Offline hashcat cracking with bundled top10k wordlist
vapt_tool_run tool:"hydra" …            # Requires confirm:true; recommended for offline/lab use only
vapt_tool_run tool:"kerbrute" …         # Kerberos user enumeration / single-password spray
```

---

<a id="中文"></a>

## 中文

**為什麼要有這份**：多數 EPT runbook 直接寫「禁止爆破」，結果報告永遠缺這一塊。
正確做法不是解禁字典爆破，而是**定義一個有預算的噴射窗口**——可量化、可停止、可交付。

### 1. 允許的技術（Allow）

| 技術 | 定義 | 允許條件 |
|---|---|---|
| **單口令噴射**（password spray） | 同一個口令嘗試多個帳號，每帳號 ≤ 2 次 | 必須先確認鎖定策略；必須 `delay ≥ 1500ms` |
| **預設憑證檢查** | admin/admin、guest/guest 這類產品預設值 | 每帳號 1 次，不列入噴射預算 |
| **已洩漏憑據驗證** | 客戶提供的、來自其自身洩漏事件的帳號密碼 | 需書面授權，且僅限清單內帳號 |
| **離線破解** | 拿到 hash 後在本地跑 hashcat/john | 不受在線預算限制，但不得回放到生產環境 |

### 2. 禁止的技術（Prohibit）

- **字典爆破**（一帳號 × N 密碼）：會觸發鎖定，等同對客戶做 DoS。
- **憑據填充**（credential stuffing）使用第三方外洩庫：涉及他人資料，且必然大量失敗。
- **MFA 疲勞轟炸**（推送轟炸）、**OTP 攔截**：超出 EPT 範圍，需另立授權。
- **密碼重置流程濫用**、**會話重放真實使用者**：屬於可用性/隱私風險。
- **對鎖定策略未知的系統噴射**：先量測，再決定預算；不確定就不做。

### 3. 硬性預算（Budget）

| 項目 | 上限 | 說明 |
|---|---|---|
| 帳號數 / 輪 | 100 | 超過請拆分批次並重新確認 |
| 口令數 / 輪 | 5 | 一輪一密碼，禁止並行多密碼 |
| 每帳號嘗試 | **2**（硬上限 3） | 必須 ≤ 鎖定閾值 − 1 |
| 全局嘗試 | **20**（硬上限 200） | 超過即停，回報並重新協商 |
| 嘗試間隔 | **≥ 1500ms** | 低於 500ms 直接拒絕執行 |
| 測試窗口 | 由客戶指定 | 避開上班高峰與批次作業 |

> 這些數字不是建議，是 `vapt_password_spray` 的程式碼級上限（`SPRAY_CAPS`）。工具會直接拒絕超限請求。

### 4. 鎖定保護（Lockout guard）

1. **測試前**：向客戶索取或實測帳號鎖定策略（幾次失敗鎖多久）。
2. **預算公式**：`每帳號嘗試次數 = 鎖定閾值 − 1`，且不得超過 3。
3. **執行中**：任一次回應出現 `STATUS_ACCOUNT_LOCKED_OUT` → **全局立即停止**，不再嘗試其他帳號。
4. **通報**：發現鎖定 → 30 分鐘內通知客戶聯絡人，並提供解鎖清單。
5. **收尾**：交付時列出「被觸及的帳號」與「是否遺留鎖定」，供客戶核對。

### 5. 證據要求（Evidence）

- 每次嘗試記一行：`時間 / 目標 / 協定 / 帳號 / 結果`（口令以 `***` 呈現）。
- 命中即建 finding，附命令原文 + 原始輸出 artifact + SHA-256。
- 報告中的憑據**一律脫敏**（省略 `secret` 欄位），完整值只放本地 `0600` 權限檔案或加密附件。
- 鎖定事件單獨一節，不與「弱口令」混寫。

### 6. 停止條件（Stop conditions）

出現任一條即停止本輪並回報：

- 帳號鎖定（任何一個）
- WAF/IDS 阻擋、連線被限速或封鎖
- 服務延遲明顯上升（> 2× 基線）
- 客戶聯絡人要求暫停
- 達到全局嘗試預算

### 7. 適用工具（本 harness 內建）

```text
vapt_password_spray                     # 受控噴射（本檔第 3 節的預算由程式碼強制）
vapt_credential_add / vapt_credential_list
vapt_crack                              # 離線哈希破解（內建 top10k 字典）
vapt_tool_run tool:"hydra" …            # 需 confirm:true；建議僅在離線/lab 使用
vapt_tool_run tool:"kerbrute" …         # Kerberos 使用者列舉 / 單口令噴射
```
