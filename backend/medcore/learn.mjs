/* backend/medcore/learn.mjs — a regularised logistic regression and an isotonic calibrator.
 *
 * WHY THIS AND NOT A LIBRARY. There is no numpy or scikit-learn in this environment, and writing
 * the baseline by hand has a second advantage the plan wanted anyway: the SCORER is the same tiny
 * function the phone will run, so there is no cross-language skew to test for. The artifact is
 * coefficients and a monotone lookup, both plain JSON.
 *
 * WHAT IT DELIBERATELY IS. A baseline. Standardised inputs, L2, full-batch gradient descent. When
 * real data and a real Python stack exist, a gradient-boosted model belongs here too and the
 * feature matrix is already written in a format it can read; the plan requires the GBM to BEAT this
 * on the same split before it replaces it.
 *
 * THREE RULES IT KEEPS.
 *  1. MISSING IS NOT ZERO. Every feature is paired with its own _present indicator by the feature
 *     builder; here a missing value is filled with the TRAINING median and the imputation constants
 *     are frozen into the artifact, so serve-time filling cannot drift from train-time filling.
 *  2. ZERO-VARIANCE FEATURES ARE DROPPED AND REPORTED. A feature that is constant inside the risk
 *     set is not a feature, and silently keeping it hides why (here: vaso_active is always false,
 *     because a patient already on a pressor was excluded from the risk set).
 *  3. CALIBRATION IS FITTED ON VALIDATION, NEVER ON TRAIN OR TEST. Fitting it on train reports the
 *     model's own optimism back to itself; fitting it on test is cheating.
 *
 * node --test test/medcore-learn.test.mjs
 */

export function median(xs) {
  const v = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * @param {Array<{values:object,label:number}>} rows
 * @param {{featureIds:string[], l2?:number, iters?:number, lr?:number}} opts
 */
export function fitLogistic(rows, opts) {
  const l2 = opts.l2 === undefined ? 1.0 : opts.l2;
  const iters = opts.iters || 3000;
  const lr = opts.lr || 0.1;

  // Imputation + standardisation constants, from TRAIN only.
  const imputations = {}, means = {}, sds = {};
  const kept = [], dropped = [];
  for (const id of opts.featureIds) {
    const col = rows.map((r) => r.values[id]);
    imputations[id] = median(col);
    const filled = col.map((x) => (typeof x === "number" && isFinite(x) ? x : imputations[id]));
    const mu = filled.reduce((a, b) => a + b, 0) / filled.length;
    const sd = Math.sqrt(filled.reduce((a, b) => a + (b - mu) * (b - mu), 0) / filled.length);
    if (!(sd > 1e-9)) { dropped.push(id); continue; }       // rule 2
    kept.push(id); means[id] = mu; sds[id] = sd;
  }

  const X = rows.map((r) => kept.map((id) => {
    const raw = r.values[id];
    const v = (typeof raw === "number" && isFinite(raw)) ? raw : imputations[id];
    return (v - means[id]) / sds[id];
  }));
  const y = rows.map((r) => r.label);

  const w = new Array(kept.length).fill(0);
  let b = Math.log((y.filter((v) => v === 1).length + 0.5) / (y.filter((v) => v === 0).length + 0.5));
  for (let it = 0; it < iters; it++) {
    const gw = new Array(kept.length).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const z = b + dot(w, X[i]);
      const p = 1 / (1 + Math.exp(-z));
      const e = p - y[i];
      gb += e;
      for (let j = 0; j < w.length; j++) gw[j] += e * X[i][j];
    }
    const n = X.length;
    b -= lr * gb / n;
    for (let j = 0; j < w.length; j++) w[j] -= lr * (gw[j] / n + l2 * w[j] / n);
  }

  return {
    kind: "logistic",
    featureIds: kept, droppedFeatures: dropped,
    coefficients: w.map(r6), intercept: r6(b),
    imputations: mapVals(imputations, r6), means: mapVals(means, r6), sds: mapVals(sds, r6),
    hyper: { l2, iters, lr }
  };
}

/** The scorer. Deliberately tiny, and the ONLY place a model turns features into a probability. */
export function scoreLogistic(model, values) {
  let z = model.intercept;
  for (let i = 0; i < model.featureIds.length; i++) {
    const id = model.featureIds[i];
    const raw = values[id];
    const v = (typeof raw === "number" && isFinite(raw)) ? raw : model.imputations[id];
    z += model.coefficients[i] * ((v - model.means[id]) / model.sds[id]);
  }
  return 1 / (1 + Math.exp(-z));
}

/**
 * Isotonic regression by pool-adjacent-violators, returned as a monotone lookup table.
 * Fitted on VALIDATION only (rule 3).
 */
export function fitIsotonic(pairs) {
  const rows = pairs.slice().sort((a, b) => a.p - b.p);
  if (!rows.length) return { kind: "isotonic", points: [] };
  const blocks = rows.map((r) => ({ sum: r.y, n: 1, x: r.p }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].sum / blocks[i].n <= blocks[i + 1].sum / blocks[i + 1].n) { i++; continue; }
    blocks[i].sum += blocks[i + 1].sum; blocks[i].n += blocks[i + 1].n;
    blocks[i].x = Math.max(blocks[i].x, blocks[i + 1].x);
    blocks.splice(i + 1, 1);
    if (i > 0) i--;
  }
  // Thin to at most 64 points: an artifact a human can read beats one they cannot.
  const pts = blocks.map((bk) => ({ x: r6(bk.x), y: r6(bk.sum / bk.n) }));
  const step = Math.max(1, Math.ceil(pts.length / 64));
  const thinned = pts.filter((_, k) => k % step === 0);
  if (thinned[thinned.length - 1] !== pts[pts.length - 1]) thinned.push(pts[pts.length - 1]);
  return { kind: "isotonic", points: thinned };
}

/** Applies the calibration map, interpolating linearly between its points. */
export function applyCalibration(cal, p) {
  if (!cal || !cal.points || !cal.points.length) return p;
  const pts = cal.points;
  if (p <= pts[0].x) return pts[0].y;
  if (p >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i].x) {
      const a = pts[i - 1], b = pts[i];
      const t = b.x === a.x ? 0 : (p - a.x) / (b.x - a.x);
      return r6(a.y + t * (b.y - a.y));
    }
  }
  return p;
}

/** Mahalanobis-lite out-of-distribution distance: standardised squared distance on the diagonal.
 *  Stated to be simple, as wardsynq-mlops.js states of its own drift tests. */
export function fitOod(model, rows) {
  const d = rows.map((r) => oodDistance(model, r.values));
  const sorted = d.slice().sort((a, b) => a - b);
  return { kind: "diag-mahalanobis", threshold: r6(sorted[Math.floor(sorted.length * 0.99)] || 0) };
}
export function oodDistance(model, values) {
  let s = 0;
  for (const id of model.featureIds) {
    const raw = values[id];
    const v = (typeof raw === "number" && isFinite(raw)) ? raw : model.imputations[id];
    const z = (v - model.means[id]) / model.sds[id];
    s += z * z;
  }
  return r6(Math.sqrt(s / Math.max(1, model.featureIds.length)));
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function r6(n) { return Math.round(n * 1e6) / 1e6; }
function mapVals(o, f) { const out = {}; for (const k of Object.keys(o)) out[k] = f(o[k]); return out; }
