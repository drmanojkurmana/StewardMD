/* ResearchMD Phase 4.3 GRADE module tests: hand-checked values.
 *
 * node --test test/research-grade.test.mjs
 *
 * Covers start levels, downgrade/upgrade arithmetic and clamping, the
 * missing-reason refusal, suggestions that never mutate input, Summary of
 * Findings absolute effects per 1000 (RR, OR, RD) with hand arithmetic in
 * comments, and the ES5 source guard for both new files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const GRADE = require("../research-grade.js");
const ENGINE = require("../research-engine.js");
const bcg = JSON.parse(readFileSync(new URL("./fixtures/research/dat_bcg.json", import.meta.url), "utf8"));

const TOL = 1e-6;
function close(actual, expected, label, tol) {
  const t = tol === undefined ? TOL : tol;
  assert.ok(Math.abs(actual - expected) <= t,
    label + ": got " + actual + ", want " + expected + " (tol " + t + ")");
}

/* Deep freeze so any mutation by the module throws in strict mode. */
function deepFreeze(o) {
  if (o && typeof o === "object") {
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    Object.freeze(o);
  }
  return o;
}

function noDomains(by) {
  const d = {};
  ["riskOfBias", "inconsistency", "indirectness", "imprecision", "publicationBias"].forEach(function (k) {
    d[k] = { level: "no", reason: "", by: by || "" };
  });
  return d;
}

/* Minimal hand-built run result (analysis scale). */
function mkRun(measure, effect, lo, hi, extra) {
  const run = {
    manifest: { measure: measure, level: 0.95, inputs: [] },
    pooled: { effect: effect, ciLower: lo, ciUpper: hi, se: (hi - lo) / 3.92 },
    heterogeneity: { i2: 0, tau2: 0, q: 0, df: 1, p: 1 },
    predictionInterval: null,
    weights: [50, 50],
    excluded: []
  };
  if (extra) Object.keys(extra).forEach(function (k) { run[k] = extra[k]; });
  return run;
}

function baseInput(overrides) {
  const input = Object.assign({
    outcome: "Tuberculosis incidence",
    design: "rct",
    run: mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9))
  }, noDomains("rev1"));
  if (overrides) Object.keys(overrides).forEach(function (k) { input[k] = overrides[k]; });
  return input;
}

function bcgProject() {
  return {
    measure: "RR", model: "random_dl", level: 0.95, createdAt: "2026-11-23T00:00:00.000Z",
    studies: bcg.studies.map(function (s) {
      return {
        id: "bcg-" + s.trial, verified: true,
        events1: s.tpos, n1: s.tpos + s.tneg,
        events2: s.cpos, n2: s.cpos + s.cneg
      };
    })
  };
}

/* ---- exports ----------------------------------------------------------- */

test("grade exports exist and the browser global carries them", function () {
  ["assessOutcome", "suggestImprecision", "suggestInconsistency",
    "summaryOfFindings", "summaryOfFindingsText"].forEach(function (k) {
    assert.equal(typeof GRADE[k], "function", k + " must be a function");
  });
  const src = readFileSync(new URL("../research-grade.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(typeof fakeWindow.SMD_RESEARCH_GRADE.assessOutcome, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_GRADE.version, "rmd1");
});

/* ---- start levels ------------------------------------------------------ */

test("start levels: RCT High, observational Low, with GRADE symbols", function () {
  const rct = GRADE.assessOutcome(baseInput());
  assert.equal(rct.certainty, "High");
  assert.equal(rct.startedAt, "High");
  assert.equal(rct.symbols, "⊕⊕⊕⊕");
  assert.deepEqual(rct.downgrades, []);
  assert.deepEqual(rct.upgrades, []);

  const obs = GRADE.assessOutcome(baseInput({ design: "observational" }));
  assert.equal(obs.certainty, "Low");
  assert.equal(obs.startedAt, "Low");
  assert.equal(obs.symbols, "⊕⊕◯◯");
});

/* ---- downgrade arithmetic and clamping --------------------------------- */

test("downgrades: one serious drops one level, very serious drops two", function () {
  /* RCT starts at index 3 (High). One serious -> 2 (Moderate). */
  const one = GRADE.assessOutcome(baseInput({
    riskOfBias: { level: "serious", reason: "No allocation concealment in 4 trials.", by: "rev1" }
  }));
  assert.equal(one.certainty, "Moderate");
  assert.equal(one.symbols, "⊕⊕⊕◯");
  assert.equal(one.downgrades.length, 1);
  assert.equal(one.downgrades[0].domain, "riskOfBias");
  assert.equal(one.downgrades[0].levels, 1);
  assert.equal(one.downgrades[0].reason, "No allocation concealment in 4 trials.");
  assert.ok(one.footnotes[0].indexOf("Downgraded one level for risk of bias") === 0);

  /* One very serious -> 3 - 2 = 1 (Low). */
  const two = GRADE.assessOutcome(baseInput({
    imprecision: { level: "very_serious", reason: "CI spans benefit and harm.", by: "rev1" }
  }));
  assert.equal(two.certainty, "Low");
  assert.equal(two.downgrades[0].levels, 2);
});

test("downgrades sum across domains and clamp at Very low", function () {
  /* 3 - 1 - 1 - 2 = -1 -> clamped to index 0 (Very low). */
  const input = baseInput({
    riskOfBias: { level: "serious", reason: "Open label.", by: "rev1" },
    inconsistency: { level: "serious", reason: "I2 92%.", by: "rev1" },
    imprecision: { level: "very_serious", reason: "Wide CI.", by: "rev1" }
  });
  const res = GRADE.assessOutcome(input);
  assert.equal(res.certainty, "Very low");
  assert.equal(res.symbols, "⊕◯◯◯");
  assert.equal(res.downgrades.length, 3);
  assert.ok(res.footnotes.some(function (f) { return f.indexOf("clamped at Very low") !== -1; }));

  /* Observational starts Low (1); one serious -> 0 (Very low). */
  const obs = GRADE.assessOutcome(baseInput({
    design: "observational",
    riskOfBias: { level: "serious", reason: "Confounding by indication.", by: "rev1" }
  }));
  assert.equal(obs.certainty, "Very low");

  /* Observational, two very serious -> 1 - 4 = -3 -> clamp Very low. */
  const obs2 = GRADE.assessOutcome(baseInput({
    design: "observational",
    riskOfBias: { level: "very_serious", reason: "No adjustment.", by: "rev1" },
    imprecision: { level: "very_serious", reason: "Few events.", by: "rev1" }
  }));
  assert.equal(obs2.certainty, "Very low");
});

/* ---- upgrades ---------------------------------------------------------- */

test("upgrades: observational only, only when nothing was downgraded", function () {
  /* Low (1) + large effect 1 -> 2 (Moderate). */
  const up1 = GRADE.assessOutcome(baseInput({
    design: "observational",
    upgrades: { largeEffect: { levels: 1, reason: "RR 0.2, large magnitude.", by: "rev1" } }
  }));
  assert.equal(up1.certainty, "Moderate");
  assert.equal(up1.upgrades.length, 1);
  assert.equal(up1.upgrades[0].domain, "largeEffect");
  assert.ok(up1.footnotes.some(function (f) { return f.indexOf("Upgraded one level for large effect") === 0; }));

  /* Low (1) + large effect 2 -> 3 (High). */
  const up2 = GRADE.assessOutcome(baseInput({
    design: "observational",
    upgrades: { largeEffect: { levels: 2, reason: "RR 0.1 with consistent gradient.", by: "rev1" } }
  }));
  assert.equal(up2.certainty, "High");

  /* Low (1) + 2 + 2 + 2 = 7 -> clamped at High (3). */
  const upClamp = GRADE.assessOutcome(baseInput({
    design: "observational",
    upgrades: {
      largeEffect: { levels: 2, reason: "Very large RR.", by: "rev1" },
      doseResponse: { levels: 2, reason: "Clear gradient.", by: "rev1" },
      plausibleConfounding: { levels: 2, reason: "Confounding would reduce the effect.", by: "rev1" }
    }
  }));
  assert.equal(upClamp.certainty, "High");
  assert.ok(upClamp.footnotes.some(function (f) { return f.indexOf("clamped at High") !== -1; }));

  /* Observational with a downgrade: upgrades are suppressed, not applied. */
  const suppressed = GRADE.assessOutcome(baseInput({
    design: "observational",
    riskOfBias: { level: "serious", reason: "Selection bias.", by: "rev1" },
    upgrades: { largeEffect: { levels: 2, reason: "Large RR.", by: "rev1" } }
  }));
  assert.equal(suppressed.certainty, "Very low"); /* 1 - 1 = 0 */
  assert.deepEqual(suppressed.upgrades, []);
  assert.ok(suppressed.footnotes.some(function (f) { return f.indexOf("Upgrades were not applied") === 0; }));
});

test("upgrades on an RCT throw", function () {
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({
      upgrades: { largeEffect: { levels: 1, reason: "Large effect.", by: "rev1" } }
    }));
  }, /research: GRADE upgrades apply to observational designs only/);
});

/* ---- missing-reason refusal -------------------------------------------- */

test("every downgrade needs a non-empty reason and reviewer id", function () {
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({ riskOfBias: { level: "serious", reason: "", by: "rev1" } }));
  }, /research: GRADE domain riskOfBias needs a reason/);
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({ imprecision: { level: "very_serious", reason: "   ", by: "rev1" } }));
  }, /research: GRADE domain imprecision needs a reason/);
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({ inconsistency: { level: "serious", reason: "I2 high.", by: "" } }));
  }, /research: GRADE domain inconsistency needs a reviewer id/);
});

test("every upgrade needs a reason; bare positive numbers are refused", function () {
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({
      design: "observational",
      upgrades: { largeEffect: { levels: 1, reason: "", by: "rev1" } }
    }));
  }, /research: GRADE upgrade largeEffect needs a reason/);
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({ design: "observational", upgrades: { doseResponse: 1 } }));
  }, /research: GRADE upgrade doseResponse needs a reason/);
  /* Zero needs no reason, in either shape. */
  const ok = GRADE.assessOutcome(baseInput({ design: "observational", upgrades: { largeEffect: 0 } }));
  assert.equal(ok.certainty, "Low");
});

test("input validation: design, levels, domains, outcome, run", function () {
  assert.throws(function () { GRADE.assessOutcome(baseInput({ design: "case-control" })); }, /research: /);
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({ riskOfBias: { level: "bad", reason: "x", by: "rev1" } }));
  }, /research: /);
  const missing = baseInput();
  delete missing.indirectness;
  assert.throws(function () { GRADE.assessOutcome(missing); }, /research: GRADE domain indirectness is required/);
  assert.throws(function () { GRADE.assessOutcome(baseInput({ outcome: "  " })); }, /research: /);
  assert.throws(function () { GRADE.assessOutcome(baseInput({ run: null })); }, /research: /);
  assert.throws(function () {
    GRADE.assessOutcome(baseInput({ design: "observational", upgrades: { largeEffect: { levels: 3, reason: "x", by: "r" } } }));
  }, /research: GRADE upgrade largeEffect levels must be 0, 1 or 2/);
});

/* ---- purity ------------------------------------------------------------ */

test("assessOutcome never mutates its input", function () {
  const input = deepFreeze(baseInput({
    design: "observational",
    riskOfBias: { level: "serious", reason: "Confounding.", by: "rev1" },
    upgrades: { largeEffect: { levels: 2, reason: "Large effect.", by: "rev1" } }
  }));
  const before = JSON.stringify(input);
  GRADE.assessOutcome(input);
  assert.equal(JSON.stringify(input), before);
});

/* ---- suggestImprecision ------------------------------------------------ */

test("suggestImprecision: null crossing, MID crossing, both, neither", function () {
  /* RR, analysis scale. Null is 0 (log 1). MID 0.9 -> log(0.9) = -0.10536.
   * CI [log 0.6, log 1.05] = [-0.5108, 0.0488] contains 0 AND -0.10536
   * -> very_serious. */
  const both = mkRun("RR", Math.log(0.8), Math.log(0.6), Math.log(1.05));
  const r1 = GRADE.suggestImprecision(both, 0.9);
  assert.equal(r1.suggested, "very_serious");
  assert.ok(r1.why.indexOf("crosses both the null (1) and the minimal important difference (0.90)") !== -1);

  /* CI [log 0.95, log 1.2] = [-0.0513, 0.1823] contains 0, not -0.10536
   * -> serious (null only). */
  const nullOnly = mkRun("RR", Math.log(1.07), Math.log(0.95), Math.log(1.2));
  assert.equal(GRADE.suggestImprecision(nullOnly, 0.9).suggested, "serious");

  /* CI [log 0.8, log 0.95] = [-0.2231, -0.0513] contains -0.10536, not 0
   * -> serious (MID only). */
  const midOnly = mkRun("RR", Math.log(0.87), Math.log(0.8), Math.log(0.95));
  assert.equal(GRADE.suggestImprecision(midOnly, 0.9).suggested, "serious");

  /* CI [log 0.6, log 0.85] = [-0.5108, -0.1625] contains neither -> no. */
  const neither = mkRun("RR", Math.log(0.72), Math.log(0.6), Math.log(0.85));
  assert.equal(GRADE.suggestImprecision(neither, 0.9).suggested, "no");
  assert.equal(GRADE.suggestImprecision(neither).suggested, "no");
});

test("suggestImprecision: natural-scale measures and MID equal to null", function () {
  /* MD null is 0. CI [-5, 1] with MID -2 crosses both -> very_serious. */
  const md = mkRun("MD", -2, -5, 1);
  assert.equal(GRADE.suggestImprecision(md, -2).suggested, "very_serious");
  /* CI [-5, -1] crosses MID -2 only -> serious. */
  assert.equal(GRADE.suggestImprecision(mkRun("MD", -3, -5, -1), -2).suggested, "serious");
  /* CI [1, 3] crosses MID 2 only -> serious. */
  assert.equal(GRADE.suggestImprecision(mkRun("MD", 2, 1, 3), 2).suggested, "serious");
  /* MID equal to the null counts once: CI [-1, 1], MID 0 -> serious. */
  assert.equal(GRADE.suggestImprecision(mkRun("MD", 0, -1, 1), 0).suggested, "serious");
});

test("suggestImprecision always flags that OIS was not computed", function () {
  const run = mkRun("RR", Math.log(0.7), Math.log(0.6), Math.log(0.8));
  const res = GRADE.suggestImprecision(run);
  assert.ok(res.why.indexOf("Optimal information size was not computed") !== -1);
});

test("suggestImprecision validates inputs and never mutates the run", function () {
  assert.throws(function () { GRADE.suggestImprecision(null); }, /research: /);
  assert.throws(function () { GRADE.suggestImprecision(mkRun("RR", 0, -1, 1), "x"); }, /research: /);
  assert.throws(function () { GRADE.suggestImprecision(mkRun("RR", 0, -1, 1), -0.5); }, /research: /);
  const run = deepFreeze(mkRun("RR", Math.log(0.8), Math.log(0.6), Math.log(1.05)));
  const before = JSON.stringify(run);
  GRADE.suggestImprecision(run, 0.9);
  assert.equal(JSON.stringify(run), before);
});

/* ---- suggestInconsistency ---------------------------------------------- */

test("suggestInconsistency: I2 >= 75 or PI crossing the null", function () {
  /* I2 92.1 >= 75 -> serious; k < 3 so PI is null and noted. */
  const highI2 = mkRun("RR", Math.log(0.7), Math.log(0.5), Math.log(0.9), {
    heterogeneity: { i2: 92.1, tau2: 0.3, q: 150, df: 12, p: 0.0001 }
  });
  const r1 = GRADE.suggestInconsistency(highI2);
  assert.equal(r1.suggested, "serious");
  assert.ok(r1.why.indexOf("I2 = 92.1%") !== -1);
  assert.ok(r1.why.indexOf("fewer than 3") !== -1);

  /* I2 10 but PI [log 0.5, log 1.3] crosses 0 -> serious. */
  const piCross = mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9), {
    heterogeneity: { i2: 10, tau2: 0.05, q: 12, df: 4, p: 0.02 },
    predictionInterval: { lower: Math.log(0.5), upper: Math.log(1.3), level: 0.95, df: null }
  });
  const r2 = GRADE.suggestInconsistency(piCross);
  assert.equal(r2.suggested, "serious");
  assert.ok(r2.why.indexOf("prediction interval (0.50 to 1.30) crosses the null (1)") !== -1);

  /* I2 10, PI [log 0.6, log 0.9] excludes 0 -> no. */
  const clean = mkRun("RR", Math.log(0.75), Math.log(0.65), Math.log(0.85), {
    heterogeneity: { i2: 10, tau2: 0.01, q: 5, df: 4, p: 0.3 },
    predictionInterval: { lower: Math.log(0.6), upper: Math.log(0.9), level: 0.95, df: null }
  });
  assert.equal(GRADE.suggestInconsistency(clean).suggested, "no");

  /* Boundary: I2 exactly 75 -> serious. */
  const boundary = mkRun("RR", 0, -1, 1, { heterogeneity: { i2: 75, tau2: 0.1, q: 10, df: 3, p: 0.02 } });
  assert.equal(GRADE.suggestInconsistency(boundary).suggested, "serious");

  /* MD PI [-1, 2] crosses 0 -> serious. */
  const mdPi = mkRun("MD", 0.5, -0.2, 1.2, {
    heterogeneity: { i2: 20, tau2: 0.1, q: 6, df: 3, p: 0.1 },
    predictionInterval: { lower: -1, upper: 2, level: 0.95, df: null }
  });
  assert.equal(GRADE.suggestInconsistency(mdPi).suggested, "serious");
});

test("suggestInconsistency never mutates the run", function () {
  const run = deepFreeze(mkRun("RR", 0, -1, 1, {
    heterogeneity: { i2: 80, tau2: 0.2, q: 20, df: 4, p: 0.001 },
    predictionInterval: { lower: -0.5, upper: 0.5, level: 0.95, df: null }
  }));
  const before = JSON.stringify(run);
  GRADE.suggestInconsistency(run);
  assert.equal(JSON.stringify(run), before);
});

/* ---- engine integration (BCG) ------------------------------------------ */

test("suggestions on the real BCG engine run", function () {
  const run = ENGINE.run(bcgProject());
  /* Published DL I2 is 92.12 -> inconsistency suggestion serious. */
  const inc = GRADE.suggestInconsistency(run);
  assert.equal(inc.suggested, "serious");
  /* DL Wald CI is about 0.345 to 0.695, excludes 1 -> no imprecision
   * downgrade without a MID; MID 0.5 lies inside the CI -> serious. */
  assert.equal(GRADE.suggestImprecision(run).suggested, "no");
  assert.equal(GRADE.suggestImprecision(run, 0.5).suggested, "serious");
});

/* ---- Summary of Findings: absolute effects, hand arithmetic ------------- */

test("SoF absolute effect for RR: baseline 100 per 1000, RR 0.75 (0.60 to 0.90)", function () {
  /* ACR = 100/1000 = 0.1.
   * Intervention risk = 0.1 * 0.75 = 0.075 -> 75 per 1000.
   * Difference = 100 * (0.75 - 1) = -25 per 1000.
   * CI: 100 * (0.60 - 1) = -40; 100 * (0.90 - 1) = -10.
   * Text: "25 fewer per 1000 (40 fewer to 10 fewer)". */
  const run = mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9));
  const grade = GRADE.assessOutcome(baseInput({ run: run }));
  const table = GRADE.summaryOfFindings([{ outcome: "TB incidence", run: run, grade: grade, baselineRisk: 100 }]);
  const abs = table.rows[0].absolute;
  close(abs.per1000, -25, "RR diff");
  close(abs.ciLower, -40, "RR diff lower");
  close(abs.ciUpper, -10, "RR diff upper");
  close(abs.controlPer1000, 100, "control risk");
  close(abs.interventionPer1000, 75, "intervention risk");
  assert.equal(abs.text, "25 fewer per 1000 (40 fewer to 10 fewer)");
  assert.equal(table.rows[0].relative.text, "RR 0.75 (0.60 to 0.90)");
  assert.ok(table.rows[0].footnotes.some(function (f) { return f.indexOf("assume a control risk of 100 per 1000") !== -1; }));
});

test("SoF absolute effect for OR: baseline 200 per 1000, OR 0.5 (0.3 to 0.8)", function () {
  /* ACR = 200/1000 = 0.2. GRADE handbook OR conversion:
   * risk = OR * ACR / (1 - ACR + OR * ACR).
   * Point: 0.5 * 0.2 / (0.8 + 0.1) = 0.1 / 0.9 = 0.111111 -> 111.111 per 1000.
   *   diff = 1000 * (0.111111 - 0.2) = -88.889 -> rounds to 89 fewer.
   * Lower OR 0.3: 0.06 / (0.8 + 0.06) = 0.06 / 0.86 = 0.0697674.
   *   diff = 1000 * (0.0697674 - 0.2) = -130.233 -> 130 fewer.
   * Upper OR 0.8: 0.16 / (0.8 + 0.16) = 0.16 / 0.96 = 0.1666667.
   *   diff = 1000 * (0.1666667 - 0.2) = -33.333 -> 33 fewer.
   * Text: "89 fewer per 1000 (130 fewer to 33 fewer)". */
  const run = mkRun("OR", Math.log(0.5), Math.log(0.3), Math.log(0.8));
  const grade = GRADE.assessOutcome(baseInput({ run: run }));
  const table = GRADE.summaryOfFindings([{ outcome: "Mortality", run: run, grade: grade, baselineRisk: 200 }]);
  const abs = table.rows[0].absolute;
  close(abs.per1000, -88.888889, "OR diff", 1e-3);
  close(abs.ciLower, -130.232558, "OR diff lower", 1e-3);
  close(abs.ciUpper, -33.333333, "OR diff upper", 1e-3);
  close(abs.interventionPer1000, 111.111111, "OR intervention risk", 1e-3);
  assert.equal(abs.text, "89 fewer per 1000 (130 fewer to 33 fewer)");
  assert.ok(abs.method.indexOf("OR converted to risks") === 0);
});

test("SoF absolute effect for RD needs no baseline risk", function () {
  /* RD -0.05 (-0.08 to -0.02) is already absolute:
   * -0.05 * 1000 = -50; CI -80 to -20.
   * Text: "50 fewer per 1000 (80 fewer to 20 fewer)". */
  const run = mkRun("RD", -0.05, -0.08, -0.02);
  const grade = GRADE.assessOutcome(baseInput({ run: run }));
  const table = GRADE.summaryOfFindings([{ outcome: "TB incidence", run: run, grade: grade }]);
  const abs = table.rows[0].absolute;
  close(abs.per1000, -50, "RD diff");
  close(abs.ciLower, -80, "RD lower");
  close(abs.ciUpper, -20, "RD upper");
  assert.equal(abs.text, "50 fewer per 1000 (80 fewer to 20 fewer)");
});

test("SoF absolute text handles CI spanning the null and zero effects", function () {
  /* RR 0.95 (0.80 to 1.10), baseline 100: diff -5, CI -20 to +10. */
  const span = mkRun("RR", Math.log(0.95), Math.log(0.8), Math.log(1.1));
  const g1 = GRADE.assessOutcome(baseInput({ run: span }));
  const t1 = GRADE.summaryOfFindings([{ outcome: "Outcome", run: span, grade: g1, baselineRisk: 100 }]);
  assert.equal(t1.rows[0].absolute.text, "5 fewer per 1000 (20 fewer to 10 more)");

  /* RR 1.00 (0.90 to 1.10), baseline 100: diff 0, CI -10 to +10. */
  const zero = mkRun("RR", 0, Math.log(0.9), Math.log(1.1));
  const g2 = GRADE.assessOutcome(baseInput({ run: zero }));
  const t2 = GRADE.summaryOfFindings([{ outcome: "Outcome", run: zero, grade: g2, baselineRisk: 100 }]);
  assert.equal(t2.rows[0].absolute.text, "no difference per 1000 (10 fewer to 10 more)");
});

test("SoF: MD/SMD/HR have no per-1000 absolute; OR/RR need a baseline risk", function () {
  const md = mkRun("MD", -3, -5, -1);
  const g = GRADE.assessOutcome(baseInput({ run: md }));
  const t = GRADE.summaryOfFindings([
    { outcome: "Pain score", run: md, grade: g },
    { outcome: "TB incidence", run: mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9)), grade: GRADE.assessOutcome(baseInput()) }
  ]);
  assert.equal(t.rows[0].absolute, null);
  assert.equal(t.rows[1].absolute, null);
  assert.throws(function () {
    GRADE.summaryOfFindings([{ outcome: "X", run: mkRun("RR", 0, -1, 1), grade: g, baselineRisk: 1001 }]);
  }, /research: baselineRisk must be between 0 and 1000/);
});

/* ---- SoF structure ------------------------------------------------------ */

test("SoF participants and studies count included studies only", function () {
  /* Inputs: a 100+100, b 50+50, c 10+10; c is double-zero excluded.
   * Participants = 200 + 100 = 300; studies = 2 (weights length). */
  const run = mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9), {
    manifest: {
      measure: "RR", level: 0.95,
      inputs: [
        { id: "a", values: { events1: 10, n1: 100, events2: 20, n2: 100 } },
        { id: "b", values: { events1: 5, n1: 50, events2: 10, n2: 50 } },
        { id: "c", values: { events1: 0, n1: 10, events2: 0, n2: 10 } }
      ]
    },
    excluded: [{ id: "c", reason: "double-zero" }]
  });
  const grade = GRADE.assessOutcome(baseInput({ run: run }));
  const table = GRADE.summaryOfFindings([{ outcome: "TB incidence", run: run, grade: grade }]);
  assert.equal(table.rows[0].participants, 300);
  assert.equal(table.rows[0].studies, 2);
  assert.equal(table.columns.length, 7);
  assert.equal(table.rows[0].certainty, "High");
  assert.equal(table.rows[0].symbols, "⊕⊕⊕⊕");
});

test("SoF on the BCG run: 13 studies, all participants counted", function () {
  const run = ENGINE.run(bcgProject());
  const grade = GRADE.assessOutcome(baseInput({ run: run }));
  const table = GRADE.summaryOfFindings([{ outcome: "TB incidence", run: run, grade: grade, baselineRisk: 50 }]);
  let expectedN = 0;
  bcg.studies.forEach(function (s) { expectedN += s.tpos + s.tneg + s.cpos + s.cneg; });
  assert.equal(table.rows[0].participants, expectedN);
  assert.equal(table.rows[0].studies, 13);
  /* RR about 0.49 (DL); absolute diff = 50 * (RR - 1), negative. */
  assert.ok(table.rows[0].absolute.per1000 < 0);
  assert.ok(table.rows[0].relative.text.indexOf("RR 0.") === 0);
});

test("SoF validates rows and never mutates inputs", function () {
  assert.deepEqual(GRADE.summaryOfFindings([]).rows, []);
  assert.throws(function () { GRADE.summaryOfFindings(null); }, /research: /);
  assert.throws(function () { GRADE.summaryOfFindings([{ outcome: "X" }]); }, /research: /);
  assert.throws(function () {
    GRADE.summaryOfFindings([{ outcome: "X", run: mkRun("RR", 0, -1, 1), grade: {} }]);
  }, /research: /);
  const run = deepFreeze(mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9)));
  const grade = deepFreeze(GRADE.assessOutcome(baseInput({ run: mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9)) })));
  const rows = deepFreeze([{ outcome: "TB", run: run, grade: grade, baselineRisk: 100 }]);
  const before = JSON.stringify(rows);
  GRADE.summaryOfFindings(rows);
  assert.equal(JSON.stringify(rows), before);
});

test("SoF text export is plain text with no em-dashes", function () {
  const run = mkRun("RR", Math.log(0.75), Math.log(0.6), Math.log(0.9));
  const grade = GRADE.assessOutcome(baseInput({
    run: run,
    riskOfBias: { level: "serious", reason: "Open label trials.", by: "rev1" }
  }));
  const table = GRADE.summaryOfFindings([{ outcome: "TB incidence", run: run, grade: grade, baselineRisk: 100 }]);
  const text = GRADE.summaryOfFindingsText(table);
  assert.ok(text.indexOf("Summary of Findings") === 0);
  assert.ok(text.indexOf("TB incidence") !== -1);
  assert.ok(text.indexOf("25 fewer per 1000 (40 fewer to 10 fewer)") !== -1);
  assert.ok(text.indexOf("⊕⊕⊕◯ Moderate") !== -1);
  assert.ok(text.indexOf("Open label trials.") !== -1);
  assert.ok(text.indexOf("—") === -1, "no em-dash in the text export");
  assert.ok(text.indexOf("–") === -1, "no en-dash in the text export");
  const empty = GRADE.summaryOfFindingsText(GRADE.summaryOfFindings([]));
  assert.ok(empty.indexOf("No graded outcomes yet.") !== -1);
});

test("no em-dash in any generated certainty or suggestion text", function () {
  const run = mkRun("RR", Math.log(0.8), Math.log(0.6), Math.log(1.05));
  const strings = [
    GRADE.suggestImprecision(run, 0.9).why,
    GRADE.suggestInconsistency(run).why,
    GRADE.assessOutcome(baseInput({ run: run })).certainty
  ];
  strings.forEach(function (s) {
    assert.ok(s.indexOf("—") === -1);
    assert.ok(s.indexOf("–") === -1);
  });
});

/* ---- ES5 source guard --------------------------------------------------- */

test("grade module and screen sources stay ES5", function () {
  ["../research-grade.js", "../research-screen-grade.js"].forEach(function (rel) {
    /* Strip comments first: backticks and prose words are fine in comments. */
    const src = readFileSync(new URL(rel, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.ok(src.indexOf("=>") === -1, rel + ": no arrow functions");
    assert.ok(!/\b(let|const)\s/.test(src), rel + ": no let/const declarations");
    assert.ok(src.indexOf("`") === -1, rel + ": no template strings");
    assert.ok(!/\bclass\s+[A-Za-z]/.test(src), rel + ": no classes");
  });
});
