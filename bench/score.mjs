// bench/score.mjs — 评分引擎（纯函数 + CLI）。
// 输入：预注册的 ground truth + 观测到的 findings（本工具或竞品，统一 schema）。
// 输出：TP/FN/FP、recall + Wilson 95% CI、precision、evidence coverage、
//       分类/难度分档、可复现性（多轮 Jaccard）、加权综合分。
//
// 设计原则（对应 METHODOLOGY.md）：
//   1. ground truth 冻结并带 hash，改条目必须升版本；
//   2. 负向对照（expected=secure）参与 precision，防「乱报得分」；
//   3. 单一综合分之外**必须**同时输出各分项，禁止只报一个好看的数字。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const WEIGHTS = { recall: 0.45, precision: 0.25, evidence: 0.15, reproducibility: 0.15 };

/** Wilson score interval for a proportion (95%). */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

const norm = (p) => String(p || '').toLowerCase().replace(/\/+$/, '') || '/';

/** 把一条观测匹配到 ground-truth 条目：优先 itemId，其次 path + param。 */
export function matchItem(item, obs) {
  if (obs.itemId && obs.itemId === item.id) return true;
  if (obs.itemId) return false;
  const m = item.match || {};
  if (m.path) {
    const p = norm(obs.path);
    const mp = norm(m.path);
    // 路径必须**段边界**匹配："/" 不能匹配所有路径，"/ftp" 不能匹配 "/ftpfoo"
    if (mp === '/') { if (p !== '/' && obs.kind !== 'headers') return false; }
    else if (!(p === mp || p.startsWith(`${mp}/`))) return false;
  }
  if (m.param && obs.param && obs.param !== m.param) return false;
  if (m.kind && obs.kind && obs.kind !== m.kind) return false;
  return Boolean(m.path);
}

/**
 * @param {object} truth ground-truth.json
 * @param {object} obsSet { tool, app, observations: [{itemId?, app, path, param?, kind?, title, evidence?}] }
 * @param {object} opts { appsRun: string[], extraRuns?: obsSets 用于可复现性 }
 */
export function score(truth, obsSet, opts = {}) {
  const appsRun = opts.appsRun || [...new Set(obsSet.observations.map((o) => o.app))];
  const items = truth.items.filter((i) => appsRun.includes(i.app) && i.expected === 'vulnerable');
  const controls = truth.items.filter((i) => appsRun.includes(i.app) && i.expected === 'secure');
  const obs = obsSet.observations || [];

  const used = new Set();
  const perItem = [];
  for (const item of items) {
    const idx = obs.findIndex((o, i) => !used.has(i) && matchItem(item, o));
    const hit = idx >= 0 ? obs[idx] : null;
    if (idx >= 0) used.add(idx);
    const evidenceOk = Boolean(hit && hit.evidence && hit.evidence.request && hit.evidence.response && (hit.evidence.sha256 || hit.evidence.command));
    perItem.push({ id: item.id, category: item.category, tier: item.tier, cwe: item.cwe, status: hit ? 'TP' : 'FN', evidence: evidenceOk, title: item.title });
  }

  // 负向对照：匹配到即 FP
  const controlHits = [];
  for (const c of controls) {
    const idx = obs.findIndex((o, i) => !used.has(i) && matchItem(c, o));
    if (idx >= 0) { used.add(idx); controlHits.push(c.id); }
  }
  // 未匹配任何条目的观测也算 FP（乱报）
  const unmapped = obs.filter((_, idx) => !used.has(idx));

  const tp = perItem.filter((i) => i.status === 'TP').length;
  const fn = perItem.length - tp;
  const fp = controlHits.length + unmapped.length;
  const recall = items.length ? tp / items.length : 0;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const evidenceCov = tp === 0 ? 0 : perItem.filter((i) => i.status === 'TP' && i.evidence).length / tp;

  // 可复现性：多轮观测集合的 Jaccard（无多轮则记 null，不计入综合分）
  let reproducibility = null;
  const runs = opts.extraRuns || [];
  if (runs.length) {
    const itemsOf = (set) => (Array.isArray(set) ? set : set.observations || []);
    const key = (set) => new Set(itemsOf(set).filter((o) => o.itemId).map((o) => o.itemId));
    const base = key(obsSet);
    const scores = runs.map((r) => {
      const other = key(r);
      const inter = [...base].filter((x) => other.has(x)).length;
      const union = new Set([...base, ...other]).size;
      return union ? inter / union : 1;
    });
    reproducibility = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // 只有一轮时无法评估可复现性：把它的权重按比例分给其它三项并标注，
  // 否则「完美命中」会因为缺一项而永远拿不到满分（对单轮结果不公平）。
  const hasRepro = reproducibility !== null;
  const w = hasRepro
    ? WEIGHTS
    : (() => {
      const rest = WEIGHTS.recall + WEIGHTS.precision + WEIGHTS.evidence;
      return {
        recall: WEIGHTS.recall / rest,
        precision: WEIGHTS.precision / rest,
        evidence: WEIGHTS.evidence / rest,
        reproducibility: 0,
      };
    })();
  const composite = 100 * (
    w.recall * recall + w.precision * precision + w.evidence * evidenceCov + w.reproducibility * (reproducibility ?? 0)
  );

  const byCategory = {};
  for (const i of perItem) {
    byCategory[i.category] ??= { tp: 0, n: 0 };
    byCategory[i.category].n += 1;
    if (i.status === 'TP') byCategory[i.category].tp += 1;
  }
  const byTier = {};
  for (const i of perItem) {
    byTier[i.tier] ??= { tp: 0, n: 0 };
    byTier[i.tier].n += 1;
    if (i.status === 'TP') byTier[i.tier].tp += 1;
  }

  const [lo, hi] = wilson(tp, items.length);
  return {
    schema: 'dsh-vapt/score@1',
    tool: obsSet.tool || 'unknown',
    app: [...new Set(appsRun)].join(','),
    groundTruth: { version: truth.version, items: truth.items.length, scored: items.length, controls: controls.length },
    counts: { tp, fn, fp },
    metrics: {
      recall, recallCi95: [lo, hi],
      precision, evidenceCoverage: evidenceCov,
      reproducibility,
      composite: Number(composite.toFixed(2)),
    },
    weights: { ...w, reproducibilityEvaluated: hasRepro },
    byCategory, byTier, perItem,
    falsePositives: [...controlHits.map((id) => ({ item: id, why: 'negative-control matched' })),
      ...unmapped.map((o) => ({ item: null, why: 'unmapped finding', title: o.title, path: o.path }))],
  };
}

/* ── CLI ─────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith('score.mjs')) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const truthPath = get('--truth', fileURLToPath(new URL('./ground-truth.json', import.meta.url)));
  const obsPath = get('--obs');
  if (!obsPath) { console.error('usage: node bench/score.mjs --obs <observations.json> [--truth ...] [--out ...]'); process.exit(2); }

  const truthRaw = readFileSync(truthPath);
  const truth = JSON.parse(truthRaw.toString('utf8'));
  const truthHash = createHash('sha256').update(truthRaw).digest('hex');
  const obsSet = JSON.parse(readFileSync(obsPath, 'utf8'));
  const result = score(truth, obsSet, { appsRun: obsSet.appsRun });

  result.groundTruth.sha256 = truthHash;
  result.measuredAt = new Date().toISOString();
  const out = get('--out');
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`tool        ${result.tool}`);
  console.log(`ground-truth v${truth.version} · ${result.groundTruth.scored} vulnerable items + ${result.groundTruth.controls} controls · sha256 ${truthHash.slice(0, 12)}…`);
  console.log(`recall      ${pct(result.metrics.recall)} (95% CI ${pct(result.metrics.recallCi95[0])}–${pct(result.metrics.recallCi95[1])})  ${result.counts.tp} TP / ${result.counts.fn} FN`);
  console.log(`precision   ${pct(result.metrics.precision)}  (${result.counts.fp} FP)`);
  console.log(`evidence    ${pct(result.metrics.evidenceCoverage)}`);
  console.log(`composite   ${result.metrics.composite}/100`);
  if (out) console.log(`written     ${out}`);
}
