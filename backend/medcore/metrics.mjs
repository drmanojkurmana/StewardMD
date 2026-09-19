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

/**
 * Calibration slope and intercept: logistic recalibration of the logit. Slope 1, intercept 0 is
 * perfect. Slope below 1 means overconfident, which is the failure that matters clinically.
 *
 * IT REFUSES A BIASED ESTIMATE. A probability of exactly 0 or 1 has no logit, so such rows cannot
 * enter the fit - and an earlier version simply dropped them and reported the slope anyway. On a
 * saturating isotonic calibrator that silently threw away 60% of the test set and returned a number
 * computed on the surviving 40%, which is how the saturation stayed hidden while the slope looked
 * merely disappointing. Dropping a few ties is fine; dropping a third of the data is a different
 * measurement, so beyond a stated tolerance this returns null plus the reason.
 */
export function calibrationCurve(pairs, opts) {
  const o = opts || {};
  const tolerance = typeof o.maxExcludedFraction === "number" ? o.maxExcludedFraction : 0.05;
  const rows = pairs.filter((r) => r.p > 1e-6 && r.p < 1 - 1e-6);
  const excluded = pairs.length - rows.length;
  const excludedFraction = pairs.length ? excluded / pairs.length : 0;
  const base = { nTotal: pairs.length, n: rows.length, excluded, excludedFraction: round4(excludedFraction) };
  if (excludedFraction > tolerance) {
    return Object.assign({
      slope: null, intercept: null, usable: false,
      refusal: "TOO_MANY_SATURATED_PROBABILITIES",
      detail: "a calibrator emitting exactly 0 or 1 removed " + Math.round(excludedFraction * 100) +
        "% of the rows; the slope over the remainder would be a different measurement"
    }, base);
  }
  if (rows.length < 20) return Object.assign({ slope: null, intercept: null, usable: false, refusal: "TOO_FEW_ROWS" }, base);
  const fit = irlsSlope(rows);
  const a = fit.a, b = fit.b;
  const out = Object.assign({ slope: round4(b), intercept: round4(a), usable: true, refusal: null }, base);
  if (o.bootstrap) out.slopeCI = bootstrapSlopeCI(rows, o.bootstrap, o.seed || 1);
  return out;
}

/**
 * A percentile bootstrap interval for the slope. It changes no gate - the gate stays on the point
 * estimate, which is the conservative choice - but a slope of 0.8992 against a floor of 0.9 is a
 * distinction of 0.0008 on an estimate whose interval is typically two orders of magnitude wider,
 * and a reader who cannot see that will draw a conclusion the data does not support.
 */
export function bootstrapSlopeCI(rows, draws, seed) {
  let a = (seed >>> 0) || 1;
  const rnd = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) % 1000000) / 1000000; };
  const slopes = [];
  for (let d = 0; d < draws; d++) {
    const sample = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) sample[i] = rows[Math.floor(rnd() * rows.length)];
    if (!sample.some((r) => r.y === 1) || !sample.some((r) => r.y === 0)) continue;
    const fit = fitSlope(sample);
    if (fit !== null) slopes.push(fit);
  }
  if (slopes.length < Math.max(10, draws / 4)) return null;
  slopes.sort((x, y) => x - y);
  return {
    lo: round4(slopes[Math.floor(slopes.length * 0.025)]),
    hi: round4(slopes[Math.floor(slopes.length * 0.975)]),
    draws: slopes.length
  };
}

/**
 * Two-parameter logistic recalibration by Newton-Raphson (IRLS). Exact 2x2 Hessian, so it converges
 * in a handful of steps rather than thousands of gradient steps.
 *
 * IT REPLACED A GRADIENT DESCENT THAT WAS NOT CONVERGED, and the symptom was unmissable once
 * printed: the bootstrap interval (600 steps per draw) did not contain the point estimate (4000
 * steps). A confidence interval that excludes its own estimate is not a measurement, and this one
 * was about to inform a decision on where a clinical gate should sit. Both now use this function,
 * so the interval and the estimate cannot disagree by construction.
 */
export function irlsSlope(rows) {
  const x = rows.map((r) => Math.log(r.p / (1 - r.p)));
  const y = rows.map((r) => r.y);
  let a = 0, b = 1;
  for (let it = 0; it < 50; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < x.length; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * x[i])));
      const w = Math.max(1e-10, p * (1 - p));
      const e = p - y[i];
      g0 += e; g1 += e * x[i];
      h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!isFinite(det) || Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a -= da; b -= db;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) break;    // converged
    if (!isFinite(a) || !isFinite(b)) return { a: 0, b: NaN, converged: false };
  }
  return { a, b, converged: isFinite(b) };
}

function fitSlope(rows) {
  const f = irlsSlope(rows);
  return f.converged ? f.b : null;
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
