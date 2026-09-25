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
 *  4. THE CALIBRATOR IS CHOSEN, NOT DECREED, AND IT NEVER EMITS CERTAINTY. Isotonic is flexible and
 *     at small sample sizes it degenerates: fitted on ~50 positives it collapsed to a step function
 *     where 61 of 64 points mapped to EXACTLY 0 and two to EXACTLY 1, and 21 test points predicted
 *     at 0.99 had an observed event rate of 0.19. So both isotonic and Platt are fitted and the
 *     winner is picked by cross-validated log loss INSIDE the validation split (picking on the data
 *     a calibrator was fitted to would always choose the more flexible one), and every probability
 *     is clamped away from 0 and 1. A model is never entitled to say impossible or certain.
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

/** Applies the calibration map (isotonic points or Platt parameters), clamped away from 0 and 1. */
export function applyCalibration(cal, p, eps) {
  const e = typeof eps === "number" ? eps : (cal && typeof cal.eps === "number" ? cal.eps : 1e-4);
  if (!cal) return clampP(p, e);
  if (cal.kind === "platt") {
    const z = cal.a + cal.b * logit(clampP(p, 1e-6));
    return clampP(r6(1 / (1 + Math.exp(-z))), e);
  }
  if (!cal.points || !cal.points.length) return clampP(p, e);
  const pts = cal.points;
  if (p <= pts[0].x) return clampP(pts[0].y, e);
  if (p >= pts[pts.length - 1].x) return clampP(pts[pts.length - 1].y, e);
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i].x) {
      const a = pts[i - 1], b = pts[i];
      const t = b.x === a.x ? 0 : (p - a.x) / (b.x - a.x);
      return clampP(r6(a.y + t * (b.y - a.y)), e);
    }
  }
  return clampP(p, e);
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


/* ------------------------------------------------------------------ calibration, chosen not decreed */

/** Platt scaling: a two-parameter logistic on the logit. Rigid, which is the point at small n. */
export function fitPlatt(pairs, opts) {
  const rows = pairs.filter((r) => isFinite(r.p));
  if (rows.length < 10) return { kind: "platt", a: 0, b: 1 };
  const lr = (opts && opts.lr) || 0.1;
  const iters = (opts && opts.iters) || 4000;
  const x = rows.map((r) => logit(clampP(r.p, 1e-6)));
  const y = rows.map((r) => r.y);
  let a = 0, b = 1;
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < x.length; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * x[i]))), e = p - y[i];
      ga += e; gb += e * x[i];
    }
    a -= lr * ga / x.length; b -= lr * gb / x.length;
  }
  return { kind: "platt", a: r6(a), b: r6(b) };
}

/**
 * Fits isotonic and Platt on `pairs`, picks by k-fold cross-validated log loss WITHIN pairs, then
 * refits the winner on all of them. Returns the calibration map plus the comparison, because the
 * loser's score is how the next person knows the choice was real.
 */
export function fitCalibrator(pairs, opts) {
  const o = opts || {};
  const folds = o.folds || 5;
  const eps = calibrationEps(pairs.length, o.eps);
  const rows = pairs.slice();
  // Deterministic interleave rather than a shuffle: same input, same folds, same winner.
  const foldOf = (i) => i % folds;

  const score = { isotonic: 0, platt: 0 };
  const counted = { isotonic: 0, platt: 0 };
  for (let f = 0; f < folds; f++) {
    const fit = rows.filter((_, i) => foldOf(i) !== f);
    const held = rows.filter((_, i) => foldOf(i) === f);
    if (!held.length || !fit.length) continue;
    const iso = fitIsotonic(fit), pl = fitPlatt(fit);
    for (const r of held) {
      score.isotonic += logLoss(r.y, applyCalibration(iso, r.p, eps));
      score.platt += logLoss(r.y, applyCalibration(pl, r.p, eps));
      counted.isotonic++; counted.platt++;
    }
  }
  const mean = (k) => (counted[k] ? score[k] / counted[k] : Infinity);
  const chosen = mean("platt") <= mean("isotonic") ? "platt" : "isotonic";
  const cal = chosen === "platt" ? fitPlatt(rows) : fitIsotonic(rows);
  cal.eps = eps;
  cal.selection = {
    chosen, folds,
    logLoss: { platt: r6(mean("platt")), isotonic: r6(mean("isotonic")) },
    n: rows.length
  };
  return cal;
}

/** The smallest probability the validation set can justify. With n points, a rate below about 1/n
 *  is not measured, it is asserted, so nothing is emitted outside [eps, 1-eps]. */
export function calibrationEps(nVal, override) {
  if (typeof override === "number") return override;
  return Math.min(0.01, Math.max(1e-4, 1 / (2 * Math.max(1, nVal))));
}

function logLoss(y, p) {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}
function logit(p) { return Math.log(p / (1 - p)); }
function clampP(p, e) { return Math.min(1 - e, Math.max(e, p)); }

/* ------------------------------------------------------------------ feature count vs events */

/**
 * Keeps only as many features as the positives can support. Ten events per variable is the usual
 * floor; below it a model memorises the training set and reports that memory back as confidence,
 * which is exactly the overconfidence the calibration gate catches after the fact.
 *
 * Ranking is univariate |point-biserial correlation| computed on TRAIN ONLY. Crude, stated to be,
 * and vastly better than keeping 55 features for 132 events.
 */
export function selectFeatures(rows, featureIds, opts) {
  const o = opts || {};
  const targetEpv = o.targetEpv || 10;
  const minFeatures = o.minFeatures || 5;
  const positives = rows.filter((r) => r.label === 1).length;
  const budget = Math.max(minFeatures, Math.floor(positives / targetEpv));
  if (featureIds.length <= budget) {
    return { featureIds: featureIds.slice(), budget, positives, dropped: [], ranked: null };
  }
  const scored = featureIds.map((id) => ({ id, r: Math.abs(pointBiserial(rows, id)) }))
    .sort((a, b) => (isFinite(b.r) ? b.r : -1) - (isFinite(a.r) ? a.r : -1));
  const kept = scored.slice(0, budget).map((s) => s.id);
  return {
    featureIds: kept, budget, positives,
    dropped: scored.slice(budget).map((s) => s.id),
    ranked: scored.slice(0, budget).map((s) => ({ id: s.id, r: r6(s.r) }))
  };
}

function pointBiserial(rows, id) {
  const xs = [], ys = [];
  for (const r of rows) {
    const v = r.values[id];
    if (typeof v !== "number" || !isFinite(v)) continue;
    xs.push(v); ys.push(r.label);
  }
  if (xs.length < 10) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) * (xs[i] - mx);
    dy += (ys[i] - my) * (ys[i] - my);
  }
  const den = Math.sqrt(dx * dy);
  return den > 1e-12 ? num / den : 0;
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }


/**
 * Picks the L2 strength by held-out log loss INSIDE train, so validation stays untouched for
 * calibration. Stronger regularisation shrinks the coefficients, which makes the logits less
 * extreme, which is the direct lever on an overconfident calibration slope - the failure this
 * pipeline kept reporting while L2 sat at a hardcoded 3 that nobody had justified.
 *
 * The sweep is deliberately coarse and short (fewer iterations), then the winner is refit properly:
 * choosing between orders of magnitude does not need a converged fit, and pretending otherwise
 * would make the sweep cost more than the model.
 */
export function tuneL2(rows, featureIds, opts) {
  const o = opts || {};
  const grid = o.grid || [0.3, 1, 3, 10, 30, 100, 300];
  const sweepIters = o.sweepIters || 800;
  const holdout = o.holdout || 0.25;
  const cut = Math.floor(rows.length * (1 - holdout));
  // Deterministic interleave, not a shuffle: same rows in, same split, same winner.
  const fit = rows.filter((_, i) => i % 4 !== 3);
  const held = rows.filter((_, i) => i % 4 === 3);
  if (held.length < 50 || fit.filter((r) => r.label === 1).length < 10) {
    return { l2: o.fallback === undefined ? 3 : o.fallback, tried: [], reason: "TOO_FEW_ROWS_TO_TUNE" };
  }
  const tried = [];
  let best = null;
  for (const l2 of grid) {
    const m = fitLogistic(fit, { featureIds, l2, iters: sweepIters });
    let ll = 0;
    for (const r of held) {
      const p = Math.min(1 - 1e-12, Math.max(1e-12, scoreLogistic(m, r.values)));
      ll += -(r.label * Math.log(p) + (1 - r.label) * Math.log(1 - p));
    }
    const mean = ll / held.length;
    tried.push({ l2, logLoss: Math.round(mean * 1e6) / 1e6 });
    if (!best || mean < best.logLoss) best = { l2, logLoss: mean };
  }
  return { l2: best.l2, tried, heldOut: held.length, reason: null, cut };
}
