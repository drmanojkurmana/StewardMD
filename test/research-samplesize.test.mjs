import "./helpers/json-import-attr.mjs";
/* ResearchMD Sample Size unit tests.
 * Cross-checks against published textbook formulas and values:
 * 1. Two proportions: Fleiss formula without continuity correction, plus continuity correction.
 * 2. Two means: Normal approximation for two independent groups.
 * 3. Single proportion: Cochran 1977 formula, with Krejcie-Morgan finite population correction.
 * 4. Single mean: Normal approximation for a single mean.
 * 5. Correlation: Fisher z transformation formula (Hulley / Cohen).
 * Checks dropout, invalid inputs, and guarantees zero em or en dashes.
 *
 * Hand-computed cross-checks:
 *
 * Case 1: Two proportions
 * Inputs: p1 = 0.30, p2 = 0.15, alpha = 0.05 (two-sided), power = 0.80, ratio = 1, dropout = 0.10.
 * Calculation:
 *   zAlpha = Phi^(-1)(1 - 0.05/2) = 1.959964
 *   zBeta = Phi^(-1)(0.80) = 0.841621
 *   diff = |0.30 - 0.15| = 0.15
 *   p1*q1 + p2*q2 = 0.30*0.70 + 0.15*0.85 = 0.21 + 0.1275 = 0.3375
 *   n1Raw = (1.959964 + 0.841621)^2 * 0.3375 / 0.15^2
 *         = 7.84888 * 0.3375 / 0.0225 = 7.84888 * 15 = 117.733
 *   Superseded: the pooled Fleiss formula gives 120.47 (R power.prop.test) -> 121; see the test below
 *   With 10% dropout: ceil(117.733 / (1 - 0.10)) = ceil(130.814) = 131 per group
 *   Total with dropout: 131 * 2 = 262
 *   Continuity correction:
 *     term = 2 * (1 + 1) / (117.733 * 1 * 0.15) = 4 / 17.65995 = 0.22650
 *     n1CcRaw = (117.733 / 4) * (1 + sqrt(1 + 0.22650))^2 = 29.433 * 4.4414 = 130.726
 *     ceil(130.726) = 131 per group
 *
 * Case 2: Two means
 * Inputs: sd = 10, diff = 5, alpha = 0.05 (two-sided), power = 0.80, ratio = 1, dropout = 0.10.
 * Calculation:
 *   zAlpha = 1.959964, zBeta = 0.841621
 *   (zAlpha + zBeta)^2 = 7.84888
 *   n1Raw = (1 + 1/1) * 10^2 * 7.84888 / 5^2
 *         = 2 * 100 * 7.84888 / 25 = 8 * 7.84888 = 62.791
 *   Round up: nPerGroup = ceil(62.791) = 63
 *   With 10% dropout: ceil(62.791 / 0.90) = ceil(69.768) = 70 per group
 *   Total with dropout: 70 * 2 = 140
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sampleSize from "../research-samplesize.js";

const { twoProportions, twoMeans, singleProportion, singleMean, correlation } = sampleSize;

function assertNoDashes(str, label) {
  assert.ok(typeof str === "string", label + " must be a string");
  const emDash = "\u2014";
  const enDash = "\u2013";
  assert.equal(str.includes(emDash), false, label + " must not contain em-dash");
  assert.equal(str.includes(enDash), false, label + " must not contain en-dash");
}

describe("research-samplesize: twoProportions", () => {
  test("computes exact prompt example: 30% vs 15%, 80% power -> 121 per group (R power.prop.test 120.47), 134 with 10% dropout (268 total)", () => {
    const res = twoProportions({
      p1: 0.30,
      p2: 0.15,
      alpha: 0.05,
      power: 0.80,
      ratio: 1,
      dropout: 0.10,
      outcome: "a complication rate",
      group1: "Drug A",
      group2: "Drug B"
    });

    assert.equal(res.nPerGroup, 121);
    assert.equal(res.total, 242);
    assert.equal(res.withDropout, 134);
    assert.equal(res.totalWithDropout, 268);
    assert.equal(res.nContinuityCorrected, 134);
    assert.equal(res.continuityCorrected.nPerGroup, 134);
    assert.equal(res.formula, "Fleiss formula without continuity correction");

    assert.equal(
      res.paragraph,
      "Assuming a complication rate of 30% with Drug A and 15% with Drug B, with 5% significance (alpha) and 80% power (chance of detecting a real difference), 121 patients per group are needed; allowing for 10% loss to follow-up, 134 per group (268 in total) will be enrolled."
    );
    assertNoDashes(res.paragraph, "twoProportions paragraph");
  });

  test("computes unequal allocation ratio (2:1)", () => {
    const res = twoProportions({
      p1: 0.40,
      p2: 0.20,
      alpha: 0.05,
      power: 0.80,
      ratio: 2,
      dropout: 0
    });
    // With ratio = 2, group 2 has twice as many as group 1
    assert.ok(res.nPerGroup > 0);
    assert.ok(res.total > res.nPerGroup);
    assert.equal(res.total, res.nPerGroup + Math.ceil(res.nPerGroup * 2));
    assertNoDashes(res.paragraph, "twoProportions unequal ratio paragraph");
  });

  test("throws research: on invalid inputs", () => {
    assert.throws(() => twoProportions(null), /research:/);
    assert.throws(() => twoProportions({ p1: 0.3, p2: 0.3 }), /research: proportions must not be equal/);
    assert.throws(() => twoProportions({ p1: -0.1, p2: 0.2 }), /research: p1 must be between 0 and 1/);
    assert.throws(() => twoProportions({ p1: 0.2, p2: 1.5 }), /research: p2 must be between 0 and 1/);
    assert.throws(() => twoProportions({ p1: 0.2, p2: 0.4, alpha: 0 }), /research: alpha must be between 0 and 1/);
    assert.throws(() => twoProportions({ p1: 0.2, p2: 0.4, power: 1.2 }), /research: power must be between 0 and 1/);
    assert.throws(() => twoProportions({ p1: 0.2, p2: 0.4, ratio: -1 }), /research: ratio must be positive/);
    assert.throws(() => twoProportions({ p1: 0.2, p2: 0.4, dropout: -0.1 }), /research: dropout must be between 0 and 1/);
  });
});

describe("research-samplesize: twoMeans", () => {
  test("computes hand-checked case: sd = 10, diff = 5, 80% power -> 64 per group (R power.t.test 63.77), 71 with 10% dropout (142 total)", () => {
    const res = twoMeans({
      sd: 10,
      diff: 5,
      alpha: 0.05,
      power: 0.80,
      ratio: 1,
      dropout: 0.10
    });

    assert.equal(res.nPerGroup, 64); /* R power.t.test(delta=5, sd=10, power=.8): 63.77 */
    assert.equal(res.total, 128);
    assert.equal(res.withDropout, 71);
    assert.equal(res.totalWithDropout, 142);
    assert.equal(res.formula, "Normal approximation for two means (with Guenther small-sample term)");
    assertNoDashes(res.paragraph, "twoMeans paragraph");
    assert.ok(res.paragraph.includes("64 patients per group are needed"));
    assert.ok(res.paragraph.includes("71 per group (142 in total) will be enrolled"));
  });

  test("computes twoMeans with sd1 and sd2 pooled", () => {
    const res = twoMeans({
      sd1: 8,
      sd2: 12, // pooled sd = sqrt((64 + 144)/2) = sqrt(104) = 10.198
      diff: 5,
      alpha: 0.05,
      power: 0.90,
      dropout: 0
    });
    assert.ok(res.nPerGroup > 0);
    assertNoDashes(res.paragraph, "twoMeans pooled sd paragraph");
  });

  test("throws research: on invalid inputs", () => {
    assert.throws(() => twoMeans({ sd: 0, diff: 5 }), /research: standard deviation must be positive/);
    assert.throws(() => twoMeans({ sd: 10, diff: 0 }), /research: difference must not be 0/);
    assert.throws(() => twoMeans({ sd: -5, diff: 5 }), /research: standard deviation must be positive/);
  });
});

describe("research-samplesize: singleProportion", () => {
  test("computes Cochran 1977 textbook value: p = 0.5, precision = 0.05 -> 385", () => {
    const res = singleProportion({
      p: 0.50,
      precision: 0.05,
      alpha: 0.05,
      dropout: 0
    });
    // n0 = 1.95996^2 * 0.25 / 0.0025 = 384.15 -> ceil = 385
    assert.equal(res.n, 385);
    assert.equal(res.total, 385);
    assert.equal(res.withDropout, 385);
    assert.equal(res.formula, "Single proportion (normal approximation)");
    assertNoDashes(res.paragraph, "singleProportion paragraph");
  });

  test("computes finite population correction (Krejcie & Morgan): N = 1000 -> 278", () => {
    const res = singleProportion({
      p: 0.50,
      precision: 0.05,
      alpha: 0.05,
      dropout: 0,
      population: 1000
    });
    // n = 384.15 / (1 + 383.15 / 1000) = 277.73 -> ceil = 278
    assert.equal(res.n, 278);
    assert.equal(res.total, 278);
    assert.equal(res.formula, "Single proportion with finite population correction");
    assertNoDashes(res.paragraph, "singleProportion finite paragraph");
    assert.ok(res.paragraph.includes("in a finite population of 1000"));
  });

  test("computes singleProportion with dropout", () => {
    const res = singleProportion({
      p: 0.30,
      precision: 0.05,
      alpha: 0.05,
      dropout: 0.15
    });
    assert.ok(res.withDropout > res.n);
    assertNoDashes(res.paragraph, "singleProportion dropout paragraph");
  });

  test("throws research: on invalid inputs", () => {
    assert.throws(() => singleProportion({ p: 1.5, precision: 0.05 }), /research: p must be between 0 and 1/);
    assert.throws(() => singleProportion({ p: 0.5, precision: 0 }), /research: precision must be between 0 and 1/);
    assert.throws(() => singleProportion({ p: 0.5, precision: 0.05, population: 0 }), /research: population must be greater than 1/);
  });
});

describe("research-samplesize: singleMean", () => {
  test("computes textbook value: sd = 15, precision = 2 -> 217", () => {
    const res = singleMean({
      sd: 15,
      precision: 2,
      alpha: 0.05,
      dropout: 0.10
    });
    // n0 = 1.95996^2 * 225 / 4 = 216.08 -> ceil = 217
    assert.equal(res.n, 217);
    assert.equal(res.total, 217);
    // with 10% dropout: ceil(216.08 / 0.90) = ceil(240.09) = 241
    assert.equal(res.withDropout, 241);
    assert.equal(res.formula, "Single mean (normal approximation)");
    assertNoDashes(res.paragraph, "singleMean paragraph");
  });

  test("throws research: on invalid inputs", () => {
    assert.throws(() => singleMean({ sd: -1, precision: 1 }), /research: standard deviation must be positive/);
    assert.throws(() => singleMean({ sd: 10, precision: 0 }), /research: precision must be positive/);
  });
});

describe("research-samplesize: correlation", () => {
  test("computes Hulley / Cohen textbook value: r = 0.3, alpha = 0.05, power = 0.80 -> 85", () => {
    const res = correlation({
      r: 0.30,
      alpha: 0.05,
      power: 0.80,
      dropout: 0.10
    });
    // Fisher z for r = 0.30 is 0.30952
    // (1.95996 + 0.84162)^2 / 0.30952^2 + 3 = 81.93 + 3 = 84.93 -> ceil = 85
    assert.equal(res.n, 85);
    assert.equal(res.total, 85);
    // with 10% dropout: ceil(84.93 / 0.90) = ceil(94.36) = 95
    assert.equal(res.withDropout, 95);
    assert.equal(res.formula, "Fisher z transformation for correlation");
    assertNoDashes(res.paragraph, "correlation paragraph");
  });

  test("throws research: on invalid inputs", () => {
    assert.throws(() => correlation({ r: 0 }), /research: correlation r must be between -1 and 1 and non-zero/);
    assert.throws(() => correlation({ r: 1 }), /research: correlation r must be between -1 and 1 and non-zero/);
    assert.throws(() => correlation({ r: -1.2 }), /research: correlation r must be between -1 and 1 and non-zero/);
  });
});

describe("research-samplesize: strict syntax and ES5 check", () => {
  test("does not contain any em or en dashes across all output paragraphs", () => {
    const p1 = twoProportions({ p1: 0.2, p2: 0.1, dropout: 0.1 }).paragraph;
    const p2 = twoMeans({ sd: 5, diff: 2, dropout: 0.1 }).paragraph;
    const p3 = singleProportion({ p: 0.2, precision: 0.04, dropout: 0.1 }).paragraph;
    const p4 = singleMean({ sd: 12, precision: 3, dropout: 0.1 }).paragraph;
    const p5 = correlation({ r: 0.4, dropout: 0.1 }).paragraph;

    [p1, p2, p3, p4, p5].forEach((p, idx) => {
      assertNoDashes(p, "formula " + idx);
    });
  });
});
