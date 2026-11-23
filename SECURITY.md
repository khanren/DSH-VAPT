# Security Policy / 安全策略

目前維護的版本是 **1.0.0**。請透過 GitHub 的 **Report a vulnerability** 私下通報。
若看不到按鈕，請只在 issue 中詢問如何私下聯絡，將漏洞細節及證據留待私下提供。

## Supported versions

Version **1.0.0** receives security fixes. Versions 0.1.0 through 0.4.0 were internal builds. [Release history](CHANGELOG.md)

## Reporting a vulnerability

Sign in to GitHub and choose **Report a vulnerability** on the repository's security page. If the button is unavailable, open an issue asking the maintainer for a private contact. Keep vulnerability details, logs and attachments private until you have that contact. [GitHub private reporting form](https://github.com/khanren/dsh-vapt/security/advisories/new)

In the private report, include the affected version, the impact and steps to reproduce using synthetic data. I aim to acknowledge reports within 72 hours and to ship a fix or mitigation note within 14 days for high-severity issues.

## Sharing reports / 分享報告

Markdown 和 JSON 匯出時，憑據表會省略 `secret` 欄位。使用者名稱、主機名稱和證據中的指令仍可能識別客戶。Markdown 也可能包含原始請求或回應片段。分享前請檢查標頭、Cookie、權杖及客戶資料。

The Markdown and JSON credential tables omit the stored `secret` field. Usernames, hostnames and recorded commands can still appear in exports. Markdown can also include raw request and response excerpts. Review exports and attachments for tokens, cookies and client data before sharing them. The local `credentials.json` stores secrets in plaintext. Newly written credential files and report exports use mode `0600` on POSIX systems. Check permissions on existing files and protect backups separately.

## Access and network activity / 存取與網路活動

DSH 註冊 17 個工具，預設新增一個 VAPT 模式，另有三個選配模式。MCP 透過標準輸入輸出提供 14 個本機記錄與報告工具。能存取這個 MCP 服務的客戶端可以讀寫其資料，包括報告及使用者提供的文字。

DSH registers 17 tools. Some actions launch external programs that can read files and make network connections with the host account’s permissions. The plugin checks supported target inputs against the recorded scope and exclusions. Enforce network and filesystem isolation at the host when an engagement requires it.

The stdio MCP server exposes 14 local record and report tools. A connected client can read and change records in the selected store. Check the client’s own data handling before giving it access to client records.

## Protecting the store / 保護專案資料

DSH uses the plugin’s `root` setting and MCP uses `VAPT_ROOT` as its explicit store location. Each falls back to `VAPT_HOME`, then `$DSH_HOME/vapt` or `~/.dsh/vapt`. Keep that directory on a private volume. It may contain client identifiers, HTTP evidence, plaintext credentials and report exports.

The dashboard’s evidence view shows metadata and digests. Before sharing a report, review its findings, recorded commands and evidence for sensitive values. [Storage and privacy](README.md#storage-and-privacy)
