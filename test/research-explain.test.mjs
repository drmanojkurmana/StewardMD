/* ResearchMD "What this means" explain helper tests.
 *
 * Covers:
 *  - Browser global and CommonJS exports
 *  - BCG sample RR 0.49 (0.34 to 0.70) text exact match
 *  - CI crossing 1 (ratios) and crossing 0 (MD/SMD)
 *  - harmful: false direction flip
 *  - MD formatting and group naming
 *  - SMD Cohen size words: trivial, small, moderate, large
 *  - pValue band edges: < 0.001, 0.001, 0.01, 0.05
 *  - heterogeneity band edges: < 25, 25, 50, 75
 *  - nnt rounding up (ceil) and null cases (missing baseline, rr == 1)
 *  - nnh wording for harm (rr > 1)
 *  - every GRADE level (high, moderate, low, very low)
 *  - model selection (fixed, random)
 *  - forestCaption exact string
 *  - throws on NaN and non-finite numbers
 *  - no em or en dash in any generated string
 *  - ES5 source guard
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const EXPLAIN = require("../research-explain.js");

/* ---- exports ----------------------------------------------------------- */

test("explain exports exist and browser global carries them", function () {
  ["effect", "pValue", "heterogeneity", "nnt", "grade", "model", "forestCaption"].forEach(function (k) {
    assert.equal(typeof EXPLAIN[k], "function", k + " must be a function");
  });
  const src = readFileSync(new URL("../research-explain.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(typeof fakeWindow.SMD_RESEARCH_EXPLAIN.effect, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_EXPLAIN.version, "rmd1");
});

/* ---- BCG sample RR ----------------------------------------------------- */

test("BCG sample RR 0.49 (0.34 to 0.70) matches exact text", function () {
  const res = EXPLAIN.effect({
    measure: "RR",
    estimate: 0.49,
    ciLower: 0.34,
    ciUpper: 0.70
  });
  const expected = "Risk ratio (RR) 0.49, 95% CI 0.34 to 0.70 (people who got the treatment had about half the risk; 51% lower. We are fairly sure the real effect is somewhere between 30% and 66% lower.)";
  assert.equal(res, expected);
});

/* ---- CI crossing 1 (ratios) and 0 (MD/SMD) ----------------------------- */

test("CI crossing 1 for ratio measures says result could go either way", function () {
  const res = EXPLAIN.effect({
    measure: "RR",
    estimate: 0.95,
    ciLower: 0.80,
    ciUpper: 1.15
  });
  assert.equal(res, "Risk ratio (RR) 0.95, 95% CI 0.80 to 1.15 (the result could go either way; these studies cannot tell if it helps or harms)");

  const resOR = EXPLAIN.effect({
    measure: "OR",
    estimate: 1.05,
    ciLower: 0.90,
    ciUpper: 1.25
  });
  assert.equal(resOR, "Odds ratio (OR) 1.05, 95% CI 0.90 to 1.25 (the result could go either way; these studies cannot tell if it helps or harms)");

  const resHR = EXPLAIN.effect({
    measure: "HR",
    estimate: 1.00,
    ciLower: 0.85,
    ciUpper: 1.20
  });
  assert.equal(resHR, "Hazard ratio (HR) 1.00, 95% CI 0.85 to 1.20 (the result could go either way; these studies cannot tell if it helps or harms)");
});

test("CI crossing 0 for MD and SMD says result could go either way", function () {
  const resMD = EXPLAIN.effect({
    measure: "MD",
    estimate: -0.5,
    ciLower: -2.0,
    ciUpper: 1.0,
    units: "mmHg"
  });
  assert.equal(resMD, "Mean difference (MD) -0.5 mmHg, 95% CI -2.0 to 1.0 mmHg (the result could go either way; these studies cannot tell if it helps or harms)");

  const resSMD = EXPLAIN.effect({
    measure: "SMD",
    estimate: 0.10,
    ciLower: -0.15,
    ciUpper: 0.35
  });
  assert.equal(resSMD, "Standardised mean difference (SMD) 0.10, 95% CI -0.15 to 0.35 (the result could go either way; these studies cannot tell if it helps or harms)");
});

/* ---- harmful: false direction flip ------------------------------------- */

test("harmful: false flips direction words so ratio > 1 is the benefit", function () {
  const good = EXPLAIN.effect({
    measure: "RR",
    estimate: 1.50,
    ciLower: 1.20,
    ciUpper: 1.80,
    harmful: false
  });
  assert.ok(good.indexOf("higher risk of benefit; 50% higher") !== -1);
  assert.ok(good.indexOf("somewhere between 20% and 80% higher") !== -1);

  /* Contrast with harmful: true (default) where ratio > 1 is harm / higher risk */
  const bad = EXPLAIN.effect({
    measure: "RR",
    estimate: 1.50,
    ciLower: 1.20,
    ciUpper: 1.80,
    harmful: true
  });
  assert.ok(bad.indexOf("higher risk; 50% higher") !== -1);
  assert.ok(bad.indexOf("somewhere between 20% and 80% higher") !== -1);

  /* Good outcome with estimate < 1 means lower risk of benefit */
  const goodWorse = EXPLAIN.effect({
    measure: "RR",
    estimate: 0.70,
    ciLower: 0.55,
    ciUpper: 0.85,
    harmful: false
  });
  assert.ok(goodWorse.indexOf("lower risk of benefit; 30% lower") !== -1);
});

/* ---- MD and SMD size words --------------------------------------------- */

test("MD formats numbers, units, and group name correctly", function () {
  const res = EXPLAIN.effect({
    measure: "MD",
    estimate: -5.2,
    ciLower: -8.1,
    ciUpper: -2.3,
    units: "mmHg",
    group: "BCG"
  });
  assert.equal(res, "Mean difference (MD) -5.2 mmHg, 95% CI -8.1 to -2.3 mmHg (on average 5.2 mmHg lower in the BCG group)");

  const resHigher = EXPLAIN.effect({
    measure: "MD",
    estimate: 3.5,
    ciLower: 1.2,
    ciUpper: 5.8,
    units: "g/dL"
  });
  assert.equal(resHigher, "Mean difference (MD) 3.5 g/dL, 95% CI 1.2 to 5.8 g/dL (on average 3.5 g/dL higher in the treatment group)");
});

test("SMD includes Cohen size words: trivial, small, moderate, large", function () {
  const trivial = EXPLAIN.effect({ measure: "SMD", estimate: -0.15, ciLower: -0.19, ciUpper: -0.11 });
  assert.ok(trivial.indexOf("a trivial effect") !== -1);
  assert.ok(trivial.indexOf("lower in the treatment group") !== -1);

  const small = EXPLAIN.effect({ measure: "SMD", estimate: -0.35, ciLower: -0.45, ciUpper: -0.25 });
  assert.ok(small.indexOf("a small effect") !== -1);

  const moderate = EXPLAIN.effect({ measure: "SMD", estimate: 0.65, ciLower: 0.50, ciUpper: 0.80 });
  assert.ok(moderate.indexOf("a moderate effect") !== -1);
  assert.ok(moderate.indexOf("higher in the treatment group") !== -1);

  const large = EXPLAIN.effect({ measure: "SMD", estimate: -1.10, ciLower: -1.35, ciUpper: -0.85 });
  assert.ok(large.indexOf("a large effect") !== -1);
});

/* ---- pValue band edges ------------------------------------------------- */

test("pValue band edges: < 0.001, 0.001, 0.01, 0.05", function () {
  /* < 0.001 */
  assert.equal(EXPLAIN.pValue(0.0005), "p < .001 (very unlikely to be chance)");

  /* Band edge 0.001 -> 0.001..0.01 */
  assert.equal(EXPLAIN.pValue(0.001), "p = 0.001 (unlikely to be chance)");
  assert.equal(EXPLAIN.pValue(0.008), "p = 0.008 (unlikely to be chance)");

  /* Band edge 0.01 -> 0.01..0.05 */
  assert.equal(EXPLAIN.pValue(0.01), "p = 0.01 (probably not chance, but only just)");
  assert.equal(EXPLAIN.pValue(0.04), "p = 0.04 (probably not chance, but only just)");

  /* Band edge 0.05 -> >= 0.05 */
  assert.equal(EXPLAIN.pValue(0.05), "p = 0.05 (could easily be chance)");
  assert.equal(EXPLAIN.pValue(0.20), "p = 0.20 (could easily be chance)");
});

/* ---- heterogeneity band edges ------------------------------------------ */

test("heterogeneity band edges: < 25, 25, 50, 75", function () {
  /* < 25 low */
  assert.equal(EXPLAIN.heterogeneity(0), "I2 = 0.0% (the studies mostly agree)");
  assert.equal(EXPLAIN.heterogeneity(24.9), "I2 = 24.9% (the studies mostly agree)");

  /* Band edge 25 -> 25 to < 50 some */
  assert.equal(EXPLAIN.heterogeneity(25), "I2 = 25.0% (the studies show some disagreement)");
  assert.equal(EXPLAIN.heterogeneity(49.9), "I2 = 49.9% (the studies show some disagreement)");

  /* Band edge 50 -> 50 to < 75 a lot */
  assert.equal(EXPLAIN.heterogeneity(50), "I2 = 50.0% (the studies disagree a lot, so treat the combined answer with care)");
  assert.equal(EXPLAIN.heterogeneity(72.8), "I2 = 72.8% (the studies disagree a lot, so treat the combined answer with care)");

  /* Band edge 75 -> >= 75 very high */
  assert.equal(EXPLAIN.heterogeneity(75), "I2 = 75.0% (the studies disagree very strongly, so treat the combined answer with great care)");
  assert.equal(EXPLAIN.heterogeneity(92.1), "I2 = 92.1% (the studies disagree very strongly, so treat the combined answer with great care)");

  /* With tau2 */
  assert.equal(EXPLAIN.heterogeneity(72.8, 0.15), "I2 = 72.8%, tau2 = 0.15 (the studies disagree a lot, so treat the combined answer with care)");
});

/* ---- NNT / NNH --------------------------------------------------------- */

test("nnt: rounding up (ceil), harm wording, and null cases", function () {
  /* Prompt example: NNT 9 */
  const res9 = EXPLAIN.nnt(0.55, 0.25);
  assert.equal(res9, "Number needed to treat (NNT) 9 (treat about 9 people to prevent one case)");

  /* Harm wording (rr > 1) */
  const harm = EXPLAIN.nnt(1.50, 0.20);
  assert.equal(harm, "Number needed to harm (NNH) 10 (treat about 10 people to cause one additional case)");

  /* Null when baselineRisk missing */
  assert.equal(EXPLAIN.nnt(0.70, null), null);
  assert.equal(EXPLAIN.nnt(0.70, undefined), null);

  /* Null when rr == 1 */
  assert.equal(EXPLAIN.nnt(1.0, 0.15), null);
});

/* ---- GRADE levels ------------------------------------------------------ */

test("every GRADE level returns standard statistic and plain explanation", function () {
  assert.equal(EXPLAIN.grade("high"), "GRADE certainty: High (we are very sure)");
  assert.equal(EXPLAIN.grade("moderate"), "GRADE certainty: Moderate (probably close to the truth)");
  assert.equal(EXPLAIN.grade("low"), "GRADE certainty: Low (the real effect could be quite different)");
  assert.equal(EXPLAIN.grade("very low"), "GRADE certainty: Very low (we are very unsure)");
  assert.equal(EXPLAIN.grade("very_low"), "GRADE certainty: Very low (we are very unsure)");
  assert.throws(function () { EXPLAIN.grade("unknown"); }, /research: /);
});

/* ---- model and forestCaption ------------------------------------------- */

test("model kind returns appropriate plain description", function () {
  assert.equal(EXPLAIN.model("fixed"), "Fixed-effect model (assumes every study measures the same true effect)");
  assert.equal(EXPLAIN.model("random"), "Random-effects model (assumes each study measures a slightly different true effect)");
  assert.throws(function () { EXPLAIN.model("other"); }, /research: /);
});

test("forestCaption returns exact static description", function () {
  assert.equal(EXPLAIN.forestCaption(), "Forest plot (each line is one study; the diamond is the combined answer; left of the line means fewer events with the treatment)");
});

/* ---- throws on NaN and non-finite numbers -------------------------------- */

test("throws on NaN and non-finite numbers", function () {
  assert.throws(function () { EXPLAIN.effect({ measure: "RR", estimate: NaN, ciLower: 0.5, ciUpper: 1.5 }); }, /research: /);
  assert.throws(function () { EXPLAIN.effect({ measure: "RR", estimate: 0.8, ciLower: -Infinity, ciUpper: 1.5 }); }, /research: /);
  assert.throws(function () { EXPLAIN.effect({ measure: "RR", estimate: 0.8, ciLower: 0.5, ciUpper: NaN }); }, /research: /);
  assert.throws(function () { EXPLAIN.effect({ measure: "RR", estimate: 0.8, ciLower: 0.5, ciUpper: 1.5, p: NaN }); }, /research: /);
  assert.throws(function () { EXPLAIN.pValue(NaN); }, /research: /);
  assert.throws(function () { EXPLAIN.pValue(Infinity); }, /research: /);
  assert.throws(function () { EXPLAIN.heterogeneity(NaN); }, /research: /);
  assert.throws(function () { EXPLAIN.heterogeneity(50, NaN); }, /research: /);
  assert.throws(function () { EXPLAIN.nnt(NaN, 0.1); }, /research: /);
  assert.throws(function () { EXPLAIN.nnt(0.8, NaN); }, /research: /);
});

/* ---- no em or en dash in any output ------------------------------------ */

test("no em or en dash in any output", function () {
  const outputs = [
    EXPLAIN.effect({ measure: "RR", estimate: 0.49, ciLower: 0.34, ciUpper: 0.70 }),
    EXPLAIN.effect({ measure: "RR", estimate: 1.05, ciLower: 0.85, ciUpper: 1.30 }),
    EXPLAIN.effect({ measure: "MD", estimate: -5.2, ciLower: -8.1, ciUpper: -2.3, units: "mmHg" }),
    EXPLAIN.effect({ measure: "SMD", estimate: -0.35, ciLower: -0.55, ciUpper: -0.15 }),
    EXPLAIN.pValue(0.0005),
    EXPLAIN.pValue(0.005),
    EXPLAIN.pValue(0.03),
    EXPLAIN.pValue(0.12),
    EXPLAIN.heterogeneity(72.8, 0.15),
    EXPLAIN.nnt(0.55, 0.25),
    EXPLAIN.nnt(1.50, 0.20),
    EXPLAIN.grade("high"),
    EXPLAIN.grade("moderate"),
    EXPLAIN.grade("low"),
    EXPLAIN.grade("very low"),
    EXPLAIN.model("fixed"),
    EXPLAIN.model("random"),
    EXPLAIN.forestCaption()
  ];
  outputs.forEach(function (s) {
    assert.ok(s.indexOf("\u2014") === -1, "must not contain em-dash: " + s);
    assert.ok(s.indexOf("\u2013") === -1, "must not contain en-dash: " + s);
  });
});

/* ---- ES5 source guard --------------------------------------------------- */

test("research-explain.js source stays ES5 with no em or en dashes", function () {
  const raw = readFileSync(new URL("../research-explain.js", import.meta.url), "utf8");
  assert.ok(raw.indexOf("\u2014") === -1, "no em-dash in source");
  assert.ok(raw.indexOf("\u2013") === -1, "no en-dash in source");
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(src.indexOf("=>") === -1, "no arrow functions");
  assert.ok(!/\b(let|const)\s/.test(src), "no let/const declarations");
  assert.ok(src.indexOf("`") === -1, "no template strings");
  assert.ok(!/\bclass\s+[A-Za-z]/.test(src), "no classes");
});

test("OR sentences say odds, never chance or risk", () => {
  const s = EXPLAIN.effect({ measure: "OR", estimate: 1.8, ciLower: 1.2, ciUpper: 2.6, harmful: false });
  assert.ok(s.indexOf("higher odds of benefit") !== -1);
  assert.ok(s.indexOf("chance") === -1);
  const b = EXPLAIN.effect({ measure: "RR", estimate: 0.49, ciLower: 0.34, ciUpper: 0.70, group: "BCG" });
  assert.ok(b.indexOf("people who got BCG had") !== -1);
});
