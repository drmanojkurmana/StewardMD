/* backend/medcore/gbm.mjs — histogram gradient boosting, Phase 4 stage 3.
 *
 * The plan's order is deterministic baseline, then logistic regression, then a calibrated GBM, and
 * each must BEAT the previous on the same split to replace it. This is the third stage. It exists
 * because logistic regression is additive and physiology is not: a lactate of 4 means something
 * different at a MAP of 55 than at 85, and a linear model can only say "lactate is worth w points"
 * in both. Trees get that interaction for free.
 *
 * THREE PROPERTIES THAT MATTER MORE HERE THAN ACCURACY.
 *
 *  1. MISSING IS ITS OWN BRANCH, NOT AN IMPUTED NUMBER. Every feature reserves bin 0 for "not
 *     recorded", and each split learns which side missing belongs on. The logistic baseline had to
 *     fill a median and hope; a tree can say "no lactate has been sent" and route on that, which is
 *     what a clinician does with the same fact. Missingness in a ward is not random and pretending
 *     it is has been a documented failure of this repo's own scoring (`a missing parameter is not
 *     zero`, wardsynq-deterioration.js).
 *  2. CLINICAL DIRECTION IS ENFORCED, NOT LEARNED. Monotone constraints: a rising lactate may never
 *     lower predicted risk, a falling MAP may never raise it. Without this a tree will happily fit
 *     a fold where the sickest patients were rescued and produce a model that reads "lactate 8 is
 *     reassuring" - defensible as statistics and indefensible at a bedside. The constraint is a
 *     split-rejection rule, which is the simple form: it guarantees direction WITHIN each split and
 *     does not propagate bounds across an entire path the way a full implementation would. Stated
 *     rather than implied.
 *  3. IT STOPS WHEN VALIDATION STOPS IMPROVING. Early stopping on the validation split, with the
 *     best iteration kept, because a boosted ensemble will fit the training set perfectly and
 *     report that as confidence - the exact overconfidence the calibration gate already caught once.
 *
 * The artifact is a plain JSON tree list, scored by a tiny function that medcore/medcore-models.js
 * implements identically. Parity vectors are how that claim is checked rather than asserted.
 *
 * node --test test/medcore-gbm.test.mjs
 */

const MISSING_BIN = 0;

/** Quantile bin edges per feature, from TRAIN only. Bin 0 is reserved for missing. */
export function fitBinner(rows, featureIds, maxBins) {
  const bins = maxBins || 32;
  const edges = {};
  for (const id of featureIds) {
    const vals = [];
    for (const r of rows) {
      const v = r.values[id];
      if (typeof v === "number" && isFinite(v)) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    const e = [];
    if (vals.length) {
      for (let q = 1; q < bins; q++) {
        const v = vals[Math.min(vals.length - 1, Math.floor((q / bins) * vals.length))];
        if (!e.length || v > e[e.length - 1]) e.push(v);
      }
    }
    edges[id] = e;                                   // bin = 1 + count of edges below the value
  }
  return { maxBins: bins, edges };
}

export function binValue(binner, id, v) {
  if (typeof v !== "number" || !isFinite(v)) return MISSING_BIN;
  const e = binner.edges[id] || [];
  let lo = 0, hi = e.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (v > e[m]) lo = m + 1; else hi = m; }
  return 1 + lo;
}

function binMatrix(rows, featureIds, binner) {
  const n = rows.length, f = featureIds.length;
  const X = new Uint8Array(n * f);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < f; j++) X[i * f + j] = binValue(binner, featureIds[j], rows[i].values[featureIds[j]]);
  }
  return X;
}

/**
 * @param {Array<{values:object,label:number}>} train
 * @param {{featureIds:string[], valid?:Array, monotone?:object, rounds?:number, lr?:number,
 *          depth?:number, minChildWeight?:number, lambda?:number, maxBins?:number,
 *          earlyStopping?:number}} opts
 */
export function fitGbm(train, opts) {
  const featureIds = opts.featureIds;
  const F = featureIds.length;
  const lr = opts.lr === undefined ? 0.06 : opts.lr;
  const depth = opts.depth || 3;
  const lambda = opts.lambda === undefined ? 5 : opts.lambda;
  const minChildWeight = opts.minChildWeight === undefined ? 20 : opts.minChildWeight;
  const rounds = opts.rounds || 400;
  const patience = opts.earlyStopping || 30;
  const monotone = opts.monotone || {};
  const binner = fitBinner(train, featureIds, opts.maxBins || 32);
  const nBins = binner.maxBins + 1;

  const X = binMatrix(train, featureIds, binner);
  const y = Float64Array.from(train.map((r) => r.label));
  const n = train.length;
  const pos = y.reduce((a, b) => a + b, 0);
  const base = Math.log((pos + 0.5) / (n - pos + 0.5));

  const valid = opts.valid && opts.valid.length ? opts.valid : null;
  const XV = valid ? binMatrix(valid, featureIds, binner) : null;
  const yV = valid ? Float64Array.from(valid.map((r) => r.label)) : null;

  const scores = new Float64Array(n).fill(base);
  const scoresV = valid ? new Float64Array(valid.length).fill(base) : null;
  const trees = [];
  let best = { round: 0, logLoss: Infinity, trees: 0 };

  for (let t = 0; t < rounds; t++) {
    const g = new Float64Array(n), h = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-scores[i]));
      g[i] = p - y[i];
      h[i] = Math.max(1e-6, p * (1 - p));
    }
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const tree = buildTree(X, F, featureIds, g, h, idx, depth, nBins, lambda, minChildWeight, monotone);
    trees.push(tree);
    for (let i = 0; i < n; i++) scores[i] += lr * predictTree(tree, X, i, F);
    if (valid) {
      for (let i = 0; i < valid.length; i++) scoresV[i] += lr * predictTree(tree, XV, i, F);
      let ll = 0;
      for (let i = 0; i < valid.length; i++) {
        const p = Math.min(1 - 1e-12, Math.max(1e-12, 1 / (1 + Math.exp(-scoresV[i]))));
        ll += -(yV[i] * Math.log(p) + (1 - yV[i]) * Math.log(1 - p));
      }
      ll /= valid.length;
      if (ll < best.logLoss - 1e-7) best = { round: t, logLoss: ll, trees: trees.length };
      else if (t - best.round >= patience) break;      // property 3
    }
  }

  const kept = valid ? trees.slice(0, best.trees) : trees;
  return {
    kind: "gbm",
    featureIds, base, lr, depth, lambda, minChildWeight,
    binner: { maxBins: binner.maxBins, edges: binner.edges },
    trees: kept,
    monotone,
    stopped: valid ? { bestRound: best.round, keptTrees: kept.length, validLogLoss: round6(best.logLoss) } : null
  };
}

/* One depth-limited tree over the gradient statistics. Leaf value is the Newton step. */
function buildTree(X, F, featureIds, g, h, idx, depth, nBins, lambda, minChildWeight, monotone) {
  function leaf(rows) {
    let sg = 0, sh = 0;
    for (const i of rows) { sg += g[i]; sh += h[i]; }
    return { leaf: round6(-sg / (sh + lambda)) };
  }
  function grow(rows, d) {
    if (d === 0 || rows.length < 2 * minChildWeight) return leaf(rows);
    let sg = 0, sh = 0;
    for (const i of rows) { sg += g[i]; sh += h[i]; }
    const parentGain = (sg * sg) / (sh + lambda);
    let bestSplit = null;

    for (let j = 0; j < F; j++) {
      const hg = new Float64Array(nBins), hh = new Float64Array(nBins);
      for (const i of rows) { const b = X[i * F + j]; hg[b] += g[i]; hh[b] += h[i]; }
      const dir = monotone[featureIds[j]] || 0;
      // Missing (bin 0) is offered to BOTH sides: the split learns where "not recorded" belongs.
      for (const missingLeft of [true, false]) {
        let cg = missingLeft ? hg[MISSING_BIN] : 0, ch = missingLeft ? hh[MISSING_BIN] : 0;
        for (let b = 1; b < nBins - 1; b++) {
          cg += hg[b]; ch += hh[b];
          const rg = sg - cg, rh = sh - ch;
          if (ch < minChildWeight || rh < minChildWeight) continue;
          const gain = (cg * cg) / (ch + lambda) + (rg * rg) / (rh + lambda) - parentGain;
          if (gain <= 1e-9) continue;
          if (dir !== 0) {
            // Property 2: reject a split whose direction contradicts physiology.
            const lv = -cg / (ch + lambda), rv = -rg / (rh + lambda);
            if (dir > 0 && lv > rv) continue;
            if (dir < 0 && lv < rv) continue;
          }
          if (!bestSplit || gain > bestSplit.gain) {
            bestSplit = { gain, feature: j, bin: b, missingLeft };
          }
        }
      }
    }
    if (!bestSplit) return leaf(rows);
    const left = [], right = [];
    for (const i of rows) {
      const b = X[i * F + bestSplit.feature];
      const goLeft = (b === MISSING_BIN) ? bestSplit.missingLeft : b <= bestSplit.bin;
      (goLeft ? left : right).push(i);
    }
    if (!left.length || !right.length) return leaf(rows);
    return {
      f: bestSplit.feature, bin: bestSplit.bin, missingLeft: bestSplit.missingLeft,
      l: grow(left, d - 1), r: grow(right, d - 1)
    };
  }
  return grow(Array.from(idx), depth);
}

function predictTree(node, X, i, F) {
  while (node.leaf === undefined) {
    const b = X[i * F + node.f];
    const goLeft = (b === MISSING_BIN) ? node.missingLeft : b <= node.bin;
    node = goLeft ? node.l : node.r;
  }
  return node.leaf;
}

/** The scorer. medcore/medcore-models.js implements this identically; parity vectors check it. */
export function scoreGbm(model, values) {
  let z = model.base;
  for (const tree of model.trees) {
    let node = tree;
    while (node.leaf === undefined) {
      const id = model.featureIds[node.f];
      const b = binValue(model.binner, id, values[id]);
      const goLeft = (b === MISSING_BIN) ? node.missingLeft : b <= node.bin;
      node = goLeft ? node.l : node.r;
    }
    z += model.lr * node.leaf;
  }
  return 1 / (1 + Math.exp(-z));
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }
