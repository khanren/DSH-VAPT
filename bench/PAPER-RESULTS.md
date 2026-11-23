# Benchmark results (paper-ready)

Ground truth: **v1.6.2** · 30 vulnerable items + 2 negative controls.

| Target | Tool | Recall | Precision | F1 | TP | FN | FP | Time | Cost | Runs |
|---|---|---|---|---|---|---|---|---|---|---|
| dvwa | dsh-redteam-mode | **100.0%** | 100.0% | **100.0%** | 10 | 0 | 0 | ~8 min | DeepSeek · 单轮 | 2 |
| dvwa | dsh-vapt | **100.0%** | 100.0% | **100.0%** | 10 | 0 | 0 | 8.7 s | 0 token | 1 |
| dvwa | strix | **90.0%** | 100.0% | **94.7%** | 9 | 1 | 0 | 4.4 min | 1796 万 token · $1.50 | 2 |
| dvwa | HexStrike AI (nuclei backend) | **0.0%** | 0.0% | **0.0%** | 0 | 10 | 0 | ~1 min | 0 token | 1 |
| juice-shop | dsh-vapt | **100.0%** | 100.0% | **100.0%** | 20 | 0 | 0 | 3.4 s | 0 token | 3 |
| juice-shop | dsh-redteam-mode | **85.0%** | 100.0% | **91.9%** | 17 | 3 | 0 | ~5 min/round | DeepSeek · 单轮 | 3 |
| juice-shop | strix | **60.0%** | 100.0% | **75.0%** | 12 | 8 | 0 | ~35 min | 2378 万 token · $2.00 | 1 |
| juice-shop | HexStrike AI (nuclei backend) | **5.0%** | 100.0% | **9.5%** | 1 | 19 | 0 | ~2 min | 0 token（无 agent 层，直接调 nuclei） | 1 |

#### Per-item hit matrix — dvwa

| Item | dsh-redteam-mode | dsh-vapt | strix | HexStrike AI (nuclei backend) |
|---|---|---|---|---|
| DV-01 SQL injection on /vulnerabilities/sqli (id) | ✓ | ✓ | ✓ | · |
| DV-02 Reflected XSS on /vulnerabilities/xss_r (name) | ✓ | ✓ | ✓ | · |
| DV-03 OS command injection on /vulnerabilities/exec (ip) | ✓ | ✓ | ✓ | · |
| DV-04 Local file inclusion on /vulnerabilities/fi (page) | ✓ | ✓ | ✓ | · |
| DV-05 Installer /setup.php reachable after install | ✓ | ✓ | · | · |
| DV-06 Stored XSS via guestbook (xss_s) | ✓ | ✓ | ✓ | · |
| DV-07 Unrestricted file upload leads to PHP execution | ✓ | ✓ | ✓ | · |
| DV-08 CSRF: password change without any token | ✓ | ✓ | ✓ | · |
| DV-09 Blind SQL injection (boolean differential) on /vulnerabilities/sqli_blind | ✓ | ✓ | ✓ | · |
| DV-10 DOM XSS on /vulnerabilities/xss_d (default param reaches document.write) | ✓ | ✓ | ✓ | · |

#### Per-item hit matrix — juice-shop

| Item | dsh-vapt | dsh-redteam-mode | strix | HexStrike AI (nuclei backend) |
|---|---|---|---|---|
| JS-01 SQL injection in /rest/products/search (q=')) ) | ✓ | ✓ | ✓ | · |
| JS-02 Admin configuration readable without authentication | ✓ | ✓ | · | · |
| JS-03 /rest/memories leaks user photos and emails | ✓ | ✓ | · | · |
| JS-04 Directory listing on /ftp | ✓ | ✓ | · | · |
| JS-05 Missing CSP and HSTS headers | ✓ | ✓ | · | · |
| JS-06 Authentication bypass via SQL injection on /rest/user/login | ✓ | ✓ | ✓ | · |
| JS-07 Unauthenticated product modification via PUT /api/Products/{id} | ✓ | · | ✓ | · |
| JS-08 Mass assignment: self-registration with role=admin | ✓ | ✓ | ✓ | · |
| JS-09 JWT alg=none accepted by /api/Users | ✓ | ✓ | ✓ | · |
| JS-10 Null-byte extension bypass on /ftp exposes package.json.bak | ✓ | ✓ | ✓ | · |
| JS-11 Any customer token can enumerate all users via /api/Users | ✓ | ✓ | ✓ | · |
| JS-12 Prometheus /metrics exposed without authentication | ✓ | ✓ | · | ✓ |
| JS-13 Directory listing on /support/logs exposes access logs | ✓ | ✓ | · | · |
| JS-14 Error stack disclosure on /api/Products/{id}/reviews | ✓ | ✓ | · | · |
| JS-15 JWT payload carries the password hash | ✓ | ✓ | · | · |
| JS-16 Basket BOLA: any customer token reads other baskets | ✓ | ✓ | ✓ | · |
| JS-17 Customer token can create products | ✓ | · | ✓ | · |
| JS-18 Free deluxe membership via paymentMode "none" | ✓ | ✓ | ✓ | · |
| JS-19 Security-question endpoint enumerates registered emails | ✓ | ✓ | ✓ | · |
| JS-20 Negative basket quantity accepted | ✓ | · | ✓ | · |
