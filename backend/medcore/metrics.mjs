/* backend/medcore/metrics.mjs — the numbers the Phase 4 gate is written in.
 *
 * Pure functions over (label, probability) pairs. No model, no I/O, no randomness. They are here
 * rather than inside the trainer so the gate can be computed by anything, including a test.
 *
 * DISCRIMINATION IS THE EASY HALF AND IS NOT THE GATE. A model can rank patients well and still be
 * systematically overconfident, and a probability nobody can act on is not a decision support tool.
 * So calibration (Brier, ECE, slope and intercept) sits beside AUROC, and selective risk answers
 * the only question abstention is for: does the model get more reliable as it declines to answer?
 *
 * node --test test/medcore-metrics.test.mjs
 */

/** Area under the ROC curve, by rank (ties averaged). Undefined without both classes. */
export function auroc(pairs) {
  const pos = pairs.filter((p) => p.y === 1).length, neg = pairs.length - pos;
  if (!pos || !neg) return null;
  const sorted = pairs.slice().sort((a, b) => a.p - b.p);
  let i = 0, rankSum = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
    const avgRank = (i + j + 2) / 2;                       // ranks are 1-based
    for (let k = i; k <= j; k++) if (sorted[k].y === 1) rankSum += avgRank;
    i = j + 1;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Area under the precision-recall curve (step interpolation). The honest one at low prevalence. */
export function auprc(pairs) {
  const pos = pairs.filter((p) => p.y === 1).length;
  if (!pos) return null;
  const sorted = pairs.slice().sort((a, b) => b.p - a.p);
  let tp = 0, fp = 0, prev = 0, area = 0;
  for (const r of sorted) {
    if (r.y === 1) tp++; else fp++;
    const recall = tp / pos, precision = tp / (tp + fp);
    if (recall > prev) { area += (recall - prev) * precision; prev = recall; }
  }
  return area;
}

export function brier(pairs) {
  if (!pairs.length) return null;
  return pairs.reduce((a, r) => a + (r.p - r.y) * (r.p - r.y), 0) / pairs.length;
}

/** Expected Calibration Error over equal-width bins, plus the reliability table it came from. */
export function ece(pairs, bins) {
  const B = bins || 10;
  if (!pairs.length) return { ece: null, table: [] };
  const table = [];
  let total = 0;
  for (let b = 0; b < B; b++) {
    const lo = b / B, hi = (b + 1) / B;
    const inBin = pairs.filter((r) => (b === B - 1 ? r.p >= lo && r.p <= hi : r.p >= lo && r.p < hi));
    if (!inBin.length) { table.push({ lo, hi, n: 0, meanP: null, observed: null }); continue; }
    const meanP = inBin.reduce((a, r) => a + r.p, 0) / inBin.length;
    const observed = inBin.filter((r) => r.y === 1).length / inBin.length;
    total += (inBin.length / pairs.length) * Math.abs(meanP - observed);
    table.push({ lo, hi, n: inBin.length, meanP: round4(meanP), observed: round4(observed) });
  }
  return { ece: round4(total), table };
}

/** Calibration slope and intercept: logistic recalibration of the logit. Slope 1, intercept 0 is
 *  perfect. Slope below 1 means overconfident, which is the failure that matters clinically. */
export function calibrationCurve(pairs, opts) {
  const rows = pairs.filter((r) => r.p > 1e-6 && r.p < 1 - 1e-6);
  if (rows.length < 20) return { slope: null, intercept: null, n: rows.length };
  const x = rows.map((r) => Math.log(r.p / (1 - r.p)));
  const y = rows.map((r) => r.y);
  let a = 0, b = 1;                                        // intercept, slope
  const lr = (opts && opts.lr) || 0.05;
  for (let it = 0; it < 4000; it++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < x.length; i++) {
      const z = a + b * x[i], p = 1 / (1 + Math.exp(-z)), e = p - y[i];
      ga += e; gb += e * x[i];
    }
    a -= lr * ga / x.length; b -= lr * gb / x.length;
  }
  return { slope: round4(b), intercept: round4(a), n: rows.length };
}

/** Coverage versus error: keep the most confident fraction and measure the error there. Abstention
 *  is only worth anything if error falls as coverage falls. */
export function selectiveRisk(pairs, coverages) {
  const cov = coverages || [1, 0.9, 0.8, 0.7, 0.6, 0.5];
  // Confidence is distance from the decision boundary of the operating point, which the caller has
  // already folded into p; the least confident are those nearest 0.5.
  const byConfidence = pairs.slice().sort((a, b) => Math.abs(b.p - 0.5) - Math.abs(a.p - 0.5));
  return cov.map((c) => {
    const keep = byConfidence.slice(0, Math.max(1, Math.round(byConfidence.length * c)));
    const err = keep.filter((r) => (r.p >= 0.5 ? 1 : 0) !== r.y).length / keep.length;
    return { coverage: c, n: keep.length, error: round4(err) };
  });
}

/** Sensitivity, specificity, PPV, NPV and alert count at a threshold. */
export function atThreshold(pairs, thr) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of pairs) {
    const pred = r.p >= thr ? 1 : 0;
    if (pred === 1 && r.y === 1) tp++;
    else if (pred === 1 && r.y === 0) fp++;
    else if (pred === 0 && r.y === 0) tn++;
    else fn++;
  }
  return {
    threshold: round4(thr), tp, fp, tn, fn,
    alerts: tp + fp,
    sensitivity: tp + fn ? round4(tp / (tp + fn)) : null,
    specificity: tn + fp ? round4(tn / (tn + fp)) : null,
    ppv: tp + fp ? round4(tp / (tp + fp)) : null,
    npv: tn + fn ? round4(tn / (tn + fn)) : null,
    missed: fn
  };
}

/** The threshold whose alert count matches a budget - how a model is compared to an incumbent at
 *  EQUAL alert burden rather than at its own most flattering operating point. */
export function thresholdForAlertBudget(pairs, budget) {
  const sorted = pairs.slice().sort((a, b) => b.p - a.p);
  if (budget <= 0) return 1.1;
  if (budget >= sorted.length) return -0.1;
  const cut = sorted[Math.min(budget, sorted.length) - 1].p;
  return cut;
}

function round4(n) { return n === null || n === undefined ? null : Math.round(n * 10000) / 10000; }
export { round4 };
