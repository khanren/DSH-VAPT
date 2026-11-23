# Benchmark methodology / 評測方法論

**Version 1.0 · applies to `bench/ground-truth.json` ≥ 1.1.0**

This document defines *what* the benchmark measures, *how* it is scored, and *what it cannot
conclude*. It is written so that a third party can reproduce the numbers or attack the method.

本文件定義基準「量什麼、怎麼算、不能得出什麼結論」，目標是任何人都能複現或反駁。

---

## 1. Object of measurement

| 被測 | 不被測 |
|---|---|
| 工具層：範圍校驗、參數白名單、執行、輸出解析 | 模型推理能力（本基準**不調用任何 LLM**） |
| 事實庫：發現/證據寫入、去重、信心閘門 | 網絡環境差異（單機、loopback） |
| 報告層：雙語渲染、攻擊路徑、修復建議、JSON 匯出 | 客戶環境的 WAF / 速率限制 |

**Why no LLM**: an LLM-driven run is non-deterministic; two runs of the same agent can differ.
This benchmark isolates the *plumbing* so the score is reproducible. Agent-level evaluation
(detection by an autonomous model) is a separate, future benchmark and must never be mixed
with these numbers.

---

## 2. Ground truth (`bench/ground-truth.json`)

**Inclusion criteria** — an item enters the ground truth only if all hold:

1. **Documented** in the target's own challenge list / CVE / CWE;
2. **Deterministically detectable over HTTP** (no timing races, no stateful multi-step chain);
3. **Stable on a pinned image** (Docker digest recorded in `apps`);
4. **Mappable** to one CWE and one severity.

**Pre-registration.** Items are frozen before a run and hashed:

```bash
shasum -a 256 bench/ground-truth.json   # printed in every result
```

Adding, removing or changing an item **requires a version bump**, and a result is only
comparable to another result scored against the **same version**.

**Negative controls.** Items with `"expected": "secure"` describe endpoints that are public
*by design* (e.g. Juice Shop's `/rest/admin/application-version`). Reporting them is a
**false positive**. This is what stops a tool from scoring high by flagging everything.

**Current catalogue (v1.5.0)** — 20 vulnerable + 2 negative controls (Juice Shop) and 8 vulnerable (DVWA).

| Version | Change |
|---|---|
| 1.0.0 | initial catalogue |
| 1.1.0 | probes validated against the pinned image: product-search SQLi only triggers with `q='))`; `/rest/user/login` auth-bypass added as JS-06; JS-05 narrowed to missing CSP+HSTS (X-Frame-Options is present) |
| 1.5.0 | DVWA catalogue expanded 5 → 8: DV-06 stored XSS (guestbook), DV-07 arbitrary file upload with **verified PHP execution**, DV-08 CSRF password change. Total 30 items (20 Juice Shop + 2 controls + 8 DVWA). |
| 1.4.0 | final three competitor-reported items added: JS-18 free deluxe membership (`paymentMode=none`), JS-19 security-question email enumeration, JS-20 negative basket quantity. 20 items + 2 controls on Juice Shop — the catalogue now covers every deterministic issue either competitor reported. |
| 1.3.0 | closes the gaps that **both** competitor runs exposed: JS-12 `/metrics`, JS-13 `/support/logs`, JS-14 error stack, JS-15 JWT password hash, JS-16 basket BOLA, JS-17 customer-created products. 17 items + 2 controls on Juice Shop. |
| 1.2.0 | closes gaps a competitor run exposed (strix + DeepSeek found 10 issues we did not probe). Added JS-07 unauth `PUT /api/Products/{id}`, JS-08 mass-assignment admin registration, JS-09 JWT `alg:none`, JS-10 `/ftp` null-byte bypass, JS-11 customer-token user enumeration. Each was hand-verified against the pinned image before inclusion; both tools are then scored on the same 11-item catalogue. |

---

## 3. Execution protocol

1. **Pinned targets** — image digest recorded in ground truth; never `:latest` in a published run.
2. **Clean state** — containers are removed and recreated per run (`docker rm -f` then `run`).
3. **Fixed topology** — loopback only, one host, no parallel runs, no external network calls.
4. **N runs** — `--runs N` repeats the probe set; reproducibility is computed across runs.
5. **No manual pruning** — every reported finding is kept; corrections go into a ground-truth
   version bump, never into a post-hoc filter.

---

## 4. Metrics

For one target and one ground-truth version:

```
TP  = vulnerable items matched by a reported finding
FN  = vulnerable items not matched
FP  = negative-control items matched + reported findings matching no item
```

| Metric | Formula | Meaning |
|---|---|---|
| Recall | `TP / (TP + FN)` | coverage of known issues |
| Precision | `TP / (TP + FP)` | how much of what you report is real |
| Evidence coverage | `TP_with_evidence / TP` | findings carrying request + response + hash |
| Reproducibility | mean Jaccard of item sets across runs | run-to-run stability (needs N ≥ 2) |
| Composite | weighted sum (§5) | headline number, **never reported alone** |

**Uncertainty.** Recall is a proportion over a small sample, so we report the **Wilson 95 %
interval**. With 6 items, 6/6 is `100 % [61 %, 100 %]` — i.e. the sample cannot exclude a
materially lower true recall. Any comparison must state both the point estimate and the interval.

**Matching rule.** A finding maps to an item by explicit `itemId`, else by path with **segment
boundary** matching (`/ftp` matches `/ftp/…`, not `/ftpfoo`) plus optional `param`/`kind`.

**Adjudication of out-of-catalogue findings (v1.1).** The catalogue is deliberately small, so a
finding that matches nothing is **not** automatically an FP — that would punish a tool for
covering more than we froze. Such findings are adjudicated by a human into one of:

| verdict | meaning | counted as |
|---|---|---|
| `extra-tp` | real issue, not in the catalogue | precision numerator; **not** in the recall denominator |
| `fp` | not a real issue | precision denominator |
| `review` | needs more evidence | excluded from precision |

Coverage bookkeeping entries (e.g. `strix-coverage/*` "ruled out / no issue") are **not**
findings and are dropped before scoring. Adjudication files are shipped next to the results
(`bench/competitors/*.adjudication.json`) so anyone can disagree line by line.

---

## 5. Composite score

```
composite = 100 × (0.45·recall + 0.25·precision + 0.15·evidence + 0.15·reproducibility)
```

* Weights favour *coverage*, then *correctness*, then *evidence*, then *stability*.
* If only one run exists, reproducibility is not measurable: its weight is redistributed to the
  other three (and the result records `reproducibilityEvaluated: false`). A single-run score is
  therefore **not** comparable with a multi-run score on that component.
* The composite is a summary, not a verdict. Papers/reports must show all four components.

---

## 6. Threats to validity

| Threat | Mitigation / status |
|---|---|
| **Small n** (6 items) | Wilson CI reported; DVWA items pending; expand catalogue in later versions |
| **Author bias** (same author wrote ground truth and probes) | Ground truth frozen + hashed before runs; probes shipped in-repo for audit; negative controls limit self-serving bias |
| **Not an agent benchmark** | Stated explicitly: measures plumbing, not model reasoning |
| **Target drift** | Image digest pinned; upgrading the image requires a ground-truth version bump |
| **Host noise** | Loopback, single host, containers recreated per run |
| **Tuning to the benchmark** | A tool specialised to these six items would score 100 % and generalise poorly; the catalogue must grow before strong claims |
| **DVWA not executed** | compose file provided; marked `not-run-in-this-revision` in results |

---

## 7. Reproduce

```bash
docker pull bkimminich/juice-shop        # digest must match ground-truth.json
node bench/real.mjs --juice --runs 2     # runs, scores, writes bench/results/*.json
node bench/score.mjs --obs bench/results/juice-shop-dsh-vapt.json
node bench/compare.mjs                   # table across all result files
```

**Current result** (2026-11-21, ground truth v1.1.0, image `bkimminich/juice-shop@sha256:adaf6a…`):

```
recall      100.0% (95% CI 61.0%–100.0%)  6 TP / 0 FN
precision   100.0%  (0 FP)
evidence    100.0%
composite   100/100   (2 runs, ~2.5 s)
```

---

## 8. Comparing other tools

A competitor result is admissible only if it comes from the **same ground-truth version**, the
**same pinned image** and the same **negative controls**. Convert its output to the observation
schema and let `bench/score.mjs` compute the metrics — do not accept a vendor's own numbers.

```json
{ "tool": "strix", "appsRun": ["juice-shop"],
  "observations": [
    { "itemId": "JS-01", "app": "juice-shop", "path": "/rest/products/search",
      "evidence": { "request": "...", "response": "...", "sha256": "..." } }
  ] }
```

`bench/adapters/` provides converters for nuclei JSONL and SARIF; anything else is a 20-line
mapper. **A tool that has not been run is recorded as `not-run`, never estimated.**
