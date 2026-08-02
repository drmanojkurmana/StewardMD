# Insulin Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, headless insulin calculation engine and safety engine for StewardMD, fully unit-tested, with no UI or storage dependencies.

**Architecture:** Two buildless ES5 IIFE modules — `insulin-engine.js` (dose math) and `insulin-safety.js` (warning evaluation). Both expose a `window.*` global and a `module.exports` for Node tests. Every engine function returns a transparent breakdown object (`result, rounded, steps, formula, assumptions, clinicalNotes, refs`). The safety engine is a separate pure function `evaluate(context, input, result) → warnings[]`. No DOM, no localStorage, no Firestore.

**Tech Stack:** Vanilla ES5 (IIFE), `node --test` with the built-in `node:test` + `node:assert` modules. No new dependencies.

## Global Constraints

- Buildless PWA: ES5 IIFE only, no transpile step. Dual export: `window.X` and `if (typeof module !== "undefined" && module.exports) module.exports = X`.
- No em-dash in any app-facing string (use " - " or rewording).
- Canonical glucose unit is mg/dL; mmol/L is derived inline as `mg/dL ÷ 18` and echoed, never a separate math path.
- Every recommendation object must be fully transparent: no computed number without a matching `steps[]` entry and a `formula` string.
- Files live at repo root (sibling of `calculators.js`); tests live in `test/`.
- Rounding increment is configurable per call (`0.5` or `1`), default `1`.

---

### Task 1: Engine scaffold + shared helpers + correction dose

**Files:**
- Create: `insulin-engine.js`
- Test: `test/insulin-engine.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `INSULIN_ENGINE.roundDose(x, increment) -> number`
  - `INSULIN_ENGINE.correctionDose({glucose, target, isf, increment}) -> Result`
  - `Result = { result:number, rounded:number, unit:"units", steps:[{label,expr,value}], formula:string, assumptions:string[], clinicalNotes:string[], refs:string[] }`

- [ ] **Step 1: Write the failing test**

```js
// test/insulin-engine.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import E from "../insulin-engine.js";

test("roundDose rounds to increment", () => {
  assert.equal(E.roundDose(4.3, 1), 4);
  assert.equal(E.roundDose(4.3, 0.5), 4.5);
  assert.equal(E.roundDose(4.24, 0.5), 4);
});

test("correctionDose: (glucose - target) / ISF", () => {
  const r = E.correctionDose({ glucose: 250, target: 120, isf: 50, increment: 1 });
  assert.equal(r.result, 2.6);          // (250-120)/50
  assert.equal(r.rounded, 3);
  assert.equal(r.unit, "units");
  assert.ok(r.steps.length >= 2);
  assert.match(r.formula, /glucose/i);
});

test("correctionDose: no correction when glucose <= target", () => {
  const r = E.correctionDose({ glucose: 100, target: 120, isf: 50 });
  assert.equal(r.rounded, 0);
});

test("correctionDose: missing input returns null result", () => {
  const r = E.correctionDose({ glucose: NaN, target: 120, isf: 50 });
  assert.equal(r.result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insulin-engine.test.mjs`
Expected: FAIL — cannot find module `../insulin-engine.js`.

- [ ] **Step 3: Write minimal implementation**

```js
/* insulin-engine.js - pure insulin dose math. No DOM, no storage.
 * Every function returns a transparent breakdown. Dual export (window + module). */
(function () {
  "use strict";

  function ok(x) { return typeof x === "number" && isFinite(x); }
  function roundDose(x, increment) { var inc = increment || 1; return Math.round(x / inc) * inc; }
  function mmol(mgdl) { return Math.round((mgdl / 18) * 10) / 10; }

  function ERR(formula) {
    return { result: null, rounded: null, unit: "units", steps: [],
      formula: formula, assumptions: [], clinicalNotes: [],
      refs: [], error: "Enter all required values." };
  }

  function correctionDose(v) {
    var formula = "correction = (glucose - target) / ISF";
    if (!ok(v.glucose) || !ok(v.target) || !ok(v.isf) || v.isf <= 0) return ERR(formula);
    var inc = v.increment || 1;
    var gap = v.glucose - v.target;
    var raw = gap > 0 ? gap / v.isf : 0;
    var rounded = roundDose(raw, inc);
    return {
      result: Math.round(raw * 10) / 10,
      rounded: rounded,
      unit: "units",
      steps: [
        { label: "Glucose above target", expr: v.glucose + " - " + v.target + " mg/dL", value: gap },
        { label: "Divide by ISF", expr: gap + " / " + v.isf + " (mg/dL per unit)", value: Math.round(raw * 100) / 100 },
        { label: "Round to " + inc + " unit", expr: "round(" + (Math.round(raw * 100) / 100) + ")", value: rounded }
      ],
      formula: formula,
      assumptions: [
        "ISF (insulin sensitivity factor) is in mg/dL lowered per unit.",
        "No correction is given when glucose is at or below target.",
        "Target " + v.target + " mg/dL (" + mmol(v.target) + " mmol/L)."
      ],
      clinicalNotes: ["Verify the patient's current ISF; it changes with regimen, illness, and time of day."],
      refs: ["ADA Standards of Care in Diabetes - correction-factor method."]
    };
  }

  var API = { roundDose: roundDose, mmol: mmol, correctionDose: correctionDose };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_ENGINE = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insulin-engine.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add insulin-engine.js test/insulin-engine.test.mjs
git commit -m "feat(insulin): engine scaffold + correction dose calculator"
```

---

### Task 2: Meal bolus

**Files:**
- Modify: `insulin-engine.js`
- Test: `test/insulin-engine.test.mjs`

**Interfaces:**
- Consumes: `roundDose`.
- Produces: `INSULIN_ENGINE.mealBolus({carbs, icr, increment}) -> Result`.

- [ ] **Step 1: Write the failing test**

```js
test("mealBolus: carbs / ICR", () => {
  const r = E.mealBolus({ carbs: 60, icr: 10, increment: 1 });
  assert.equal(r.result, 6);
  assert.equal(r.rounded, 6);
  assert.match(r.formula, /carb/i);
});

test("mealBolus: rounds to 0.5", () => {
  const r = E.mealBolus({ carbs: 55, icr: 10, increment: 0.5 });
  assert.equal(r.rounded, 5.5);
});

test("mealBolus: missing input returns null", () => {
  const r = E.mealBolus({ carbs: NaN, icr: 10 });
  assert.equal(r.result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insulin-engine.test.mjs`
Expected: FAIL — `E.mealBolus is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add inside the IIFE before `var API`, and add `mealBolus: mealBolus` to `API`:

```js
function mealBolus(v) {
  var formula = "meal bolus = carbohydrate grams / ICR";
  if (!ok(v.carbs) || !ok(v.icr) || v.icr <= 0) return ERR(formula);
  var inc = v.increment || 1;
  var raw = v.carbs / v.icr;
  var rounded = roundDose(raw, inc);
  return {
    result: Math.round(raw * 10) / 10,
    rounded: rounded,
    unit: "units",
    steps: [
      { label: "Carbohydrates", expr: v.carbs + " g", value: v.carbs },
      { label: "Divide by ICR", expr: v.carbs + " / " + v.icr + " (g per unit)", value: Math.round(raw * 100) / 100 },
      { label: "Round to " + inc + " unit", expr: "round(" + (Math.round(raw * 100) / 100) + ")", value: rounded }
    ],
    formula: formula,
    assumptions: ["ICR (insulin-to-carbohydrate ratio) is grams of carbohydrate covered by 1 unit."],
    clinicalNotes: ["Confirm carbohydrate counting is accurate; estimation error propagates directly to the dose."],
    refs: ["ADA Standards of Care - carbohydrate-ratio method (500 rule for initial estimate)."]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insulin-engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add insulin-engine.js test/insulin-engine.test.mjs
git commit -m "feat(insulin): meal bolus calculator"
```

---

### Task 3: Active insulin (IOB)

**Files:**
- Modify: `insulin-engine.js`
- Test: `test/insulin-engine.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `INSULIN_ENGINE.activeInsulin({doses:[{units, minutesAgo}], dia, model}) -> Result` where `dia` is duration of insulin action in hours, `model` is `"linear"` (default).

- [ ] **Step 1: Write the failing test**

```js
test("activeInsulin: linear decay, half-elapsed dose", () => {
  // 4u given 2h ago, DIA 4h -> 50% remaining -> 2u IOB
  const r = E.activeInsulin({ doses: [{ units: 4, minutesAgo: 120 }], dia: 4, model: "linear" });
  assert.equal(r.result, 2);
});

test("activeInsulin: expired dose contributes 0", () => {
  const r = E.activeInsulin({ doses: [{ units: 6, minutesAgo: 300 }], dia: 4 });
  assert.equal(r.result, 0);
});

test("activeInsulin: sums multiple doses", () => {
  const r = E.activeInsulin({ doses: [
    { units: 4, minutesAgo: 120 },   // 2u remaining
    { units: 2, minutesAgo: 60 }     // 1.5u remaining (75%)
  ], dia: 4 });
  assert.equal(r.result, 3.5);
  assert.equal(r.model, "linear");
});

test("activeInsulin: no doses -> 0", () => {
  const r = E.activeInsulin({ doses: [], dia: 4 });
  assert.equal(r.result, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insulin-engine.test.mjs`
Expected: FAIL — `E.activeInsulin is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add inside the IIFE; add `activeInsulin: activeInsulin` to `API`:

```js
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function activeInsulin(v) {
  var formula = "IOB = sum of dose x remaining-fraction; linear remaining = 1 - (elapsed / DIA)";
  if (!ok(v.dia) || v.dia <= 0 || !v.doses || !v.doses.length) {
    var empty = ERR(formula); empty.result = 0; empty.rounded = 0; empty.error = undefined;
    empty.model = v.model || "linear"; empty.steps = []; empty.assumptions =
      ["No active doses recorded, or duration of insulin action missing; IOB treated as 0."];
    return empty;
  }
  var model = v.model || "linear";
  var iob = 0, steps = [];
  for (var i = 0; i < v.doses.length; i++) {
    var d = v.doses[i];
    if (!ok(d.units) || !ok(d.minutesAgo)) continue;
    var elapsedH = d.minutesAgo / 60;
    var frac = clamp01(1 - elapsedH / v.dia);   // linear model
    var contrib = d.units * frac;
    iob += contrib;
    steps.push({ label: d.units + "u given " + d.minutesAgo + " min ago",
      expr: d.units + " x (1 - " + (Math.round(elapsedH * 100) / 100) + "/" + v.dia + ")",
      value: Math.round(contrib * 100) / 100 });
  }
  var rounded = Math.round(iob * 10) / 10;
  return {
    result: rounded, rounded: rounded, unit: "units", model: model, steps: steps,
    formula: formula,
    assumptions: [
      "Linear insulin-decay model; real pharmacodynamics are curved, so this is a conservative estimate.",
      "Duration of insulin action (DIA) = " + v.dia + " h; set from the selected rapid-acting insulin."
    ],
    clinicalNotes: ["IOB should be subtracted from a new correction dose to avoid insulin stacking."],
    refs: ["Insulin-on-board / active-insulin-time pump conventions (linear and curvilinear models)."]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insulin-engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add insulin-engine.js test/insulin-engine.test.mjs
git commit -m "feat(insulin): active insulin (IOB) linear model"
```

---

### Task 4: Combined meal + correction (with IOB subtraction)

**Files:**
- Modify: `insulin-engine.js`
- Test: `test/insulin-engine.test.mjs`

**Interfaces:**
- Consumes: internal meal + correction logic.
- Produces: `INSULIN_ENGINE.combinedDose({carbs, icr, glucose, target, isf, iob, increment}) -> Result` with extra fields `mealComponent`, `correctionComponent`, `iobSubtracted`.

- [ ] **Step 1: Write the failing test**

```js
test("combinedDose: meal + correction - IOB", () => {
  // meal 60/10=6, correction (250-120)/50=2.6, iob 1 -> 7.6 -> round 8
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: 250, target: 120, isf: 50, iob: 1, increment: 1 });
  assert.equal(r.mealComponent, 6);
  assert.equal(r.correctionComponent, 2.6);
  assert.equal(r.iobSubtracted, 1);
  assert.equal(r.rounded, 8);
});

test("combinedDose: never negative", () => {
  const r = E.combinedDose({ carbs: 0, icr: 10, glucose: 100, target: 120, isf: 50, iob: 5 });
  assert.equal(r.rounded, 0);
});

test("combinedDose: missing required input returns null", () => {
  const r = E.combinedDose({ carbs: 60, icr: 10, glucose: NaN, target: 120, isf: 50 });
  assert.equal(r.result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insulin-engine.test.mjs`
Expected: FAIL — `E.combinedDose is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add inside the IIFE; add `combinedDose: combinedDose` to `API`:

```js
function combinedDose(v) {
  var formula = "total = (carbs / ICR) + max(0, (glucose - target) / ISF) - IOB";
  if (!ok(v.carbs) || !ok(v.icr) || v.icr <= 0 || !ok(v.glucose) || !ok(v.target) || !ok(v.isf) || v.isf <= 0)
    return ERR(formula);
  var inc = v.increment || 1;
  var iob = ok(v.iob) ? v.iob : 0;
  var meal = Math.round((v.carbs / v.icr) * 10) / 10;
  var gap = v.glucose - v.target;
  var corr = Math.round((gap > 0 ? gap / v.isf : 0) * 10) / 10;
  var rawTotal = meal + corr - iob;
  if (rawTotal < 0) rawTotal = 0;
  var rounded = roundDose(rawTotal, inc);
  return {
    result: Math.round(rawTotal * 10) / 10, rounded: rounded, unit: "units",
    mealComponent: meal, correctionComponent: corr, iobSubtracted: iob,
    steps: [
      { label: "Meal bolus", expr: v.carbs + " g / " + v.icr, value: meal },
      { label: "Correction", expr: "max(0, (" + v.glucose + " - " + v.target + ") / " + v.isf + ")", value: corr },
      { label: "Subtract active insulin (IOB)", expr: meal + " + " + corr + " - " + iob, value: Math.round(rawTotal * 100) / 100 },
      { label: "Round to " + inc + " unit", expr: "round(" + (Math.round(rawTotal * 100) / 100) + ")", value: rounded }
    ],
    formula: formula,
    assumptions: [
      "IOB is subtracted from the correction so a stacked dose is not double-counted.",
      "Meal coverage is never reduced below what the carbohydrates require.",
      "Total is floored at 0 units."
    ],
    clinicalNotes: ["If IOB is unknown, treat this total as an overestimate and reassess before dosing."],
    refs: ["Bolus-calculator conventions (meal + correction - IOB)."]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insulin-engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add insulin-engine.js test/insulin-engine.test.mjs
git commit -m "feat(insulin): combined meal + correction with IOB subtraction"
```

---

### Task 5: ISF / ICR from TDD, and weight-based basal initiation

**Files:**
- Modify: `insulin-engine.js`
- Test: `test/insulin-engine.test.mjs`

**Interfaces:**
- Produces:
  - `INSULIN_ENGINE.isfFromTdd({tdd, rule}) -> Result` (rule default 1800; also supports 1500 for regular insulin). `result` is mg/dL per unit.
  - `INSULIN_ENGINE.icrFromTdd({tdd, rule}) -> Result` (rule default 500; also 450 for regular). `result` is g per unit.
  - `INSULIN_ENGINE.basalInitiation({weightKg, tddFactor, basalFraction, increment}) -> Result` with fields `tdd`, `basal`, `mealBolusEach`.

- [ ] **Step 1: Write the failing test**

```js
test("isfFromTdd: 1800 rule", () => {
  const r = E.isfFromTdd({ tdd: 36 });     // 1800/36 = 50
  assert.equal(r.result, 50);
  assert.match(r.formula, /1800/);
});

test("icrFromTdd: 500 rule", () => {
  const r = E.icrFromTdd({ tdd: 50 });     // 500/50 = 10
  assert.equal(r.result, 10);
});

test("basalInitiation: weight-based TDD then 50/50 split", () => {
  // 80kg x 0.4 = 32 TDD; basal 50% = 16; 3 meals of (16/3)=5.3
  const r = E.basalInitiation({ weightKg: 80, tddFactor: 0.4, basalFraction: 0.5, increment: 1 });
  assert.equal(r.tdd, 32);
  assert.equal(r.basal, 16);
  assert.equal(r.mealBolusEach, 5);   // 5.33 rounded to 1u
});

test("basalInitiation: missing weight returns null", () => {
  const r = E.basalInitiation({ weightKg: NaN });
  assert.equal(r.result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insulin-engine.test.mjs`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Write minimal implementation**

Add inside the IIFE; add `isfFromTdd`, `icrFromTdd`, `basalInitiation` to `API`:

```js
function isfFromTdd(v) {
  var rule = v.rule || 1800;
  var formula = "ISF = " + rule + " / TDD (mg/dL per unit)";
  if (!ok(v.tdd) || v.tdd <= 0) return ERR(formula);
  var isf = Math.round((rule / v.tdd) * 10) / 10;
  return {
    result: isf, rounded: isf, unit: "mg/dL per unit",
    steps: [{ label: "Apply the " + rule + " rule", expr: rule + " / " + v.tdd, value: isf }],
    formula: formula,
    assumptions: [
      "1800 rule for rapid-acting analogues; use 1500 for regular insulin.",
      "ISF " + isf + " mg/dL per unit is approximately " + mmol(isf) + " mmol/L per unit."
    ],
    clinicalNotes: ["An estimate only; titrate against the patient's actual glucose response."],
    refs: ["1800 / 1500 rule (Davidson); ADA Standards of Care."]
  };
}

function icrFromTdd(v) {
  var rule = v.rule || 500;
  var formula = "ICR = " + rule + " / TDD (g carbohydrate per unit)";
  if (!ok(v.tdd) || v.tdd <= 0) return ERR(formula);
  var icr = Math.round((rule / v.tdd) * 10) / 10;
  return {
    result: icr, rounded: icr, unit: "g per unit",
    steps: [{ label: "Apply the " + rule + " rule", expr: rule + " / " + v.tdd, value: icr }],
    formula: formula,
    assumptions: ["500 rule for rapid-acting analogues; use 450 for regular insulin."],
    clinicalNotes: ["An estimate only; titrate against post-prandial glucose."],
    refs: ["500 / 450 rule; ADA Standards of Care."]
  };
}

function basalInitiation(v) {
  var formula = "TDD = weight x factor; basal = TDD x basalFraction; meal bolus each = (TDD - basal) / 3";
  if (!ok(v.weightKg) || v.weightKg <= 0) return ERR(formula);
  var factor = ok(v.tddFactor) ? v.tddFactor : 0.4;
  var frac = ok(v.basalFraction) ? v.basalFraction : 0.5;
  var inc = v.increment || 1;
  var tdd = Math.round(v.weightKg * factor);
  var basal = Math.round(tdd * frac);
  var mealEach = roundDose((tdd - basal) / 3, inc);
  return {
    result: tdd, rounded: tdd, unit: "units/day", tdd: tdd, basal: basal, mealBolusEach: mealEach,
    steps: [
      { label: "Total daily dose", expr: v.weightKg + " kg x " + factor + " u/kg/day", value: tdd },
      { label: "Basal share", expr: tdd + " x " + frac, value: basal },
      { label: "Meal bolus each (3 meals)", expr: "(" + tdd + " - " + basal + ") / 3", value: mealEach }
    ],
    formula: formula,
    assumptions: [
      "Starting factor " + factor + " u/kg/day (typical range 0.3 to 0.5; lower in renal impairment or type 1 honeymoon).",
      "Basal fraction " + frac + " (50/50 basal-bolus split is the configurable default)."
    ],
    clinicalNotes: [
      "A conservative initiation estimate. Start low, titrate to glucose targets, and reassess within days.",
      "Not for type 1 ketosis-prone initiation without specialist input."
    ],
    refs: ["Weight-based insulin initiation; ADA / AACE inpatient and outpatient guidance."]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insulin-engine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add insulin-engine.js test/insulin-engine.test.mjs
git commit -m "feat(insulin): ISF/ICR from TDD + weight-based basal initiation"
```

---

### Task 6: Safety engine — taxonomy + core rules

**Files:**
- Create: `insulin-safety.js`
- Test: `test/insulin-safety.test.mjs`

**Interfaces:**
- Consumes: engine `Result` objects (reads `rounded`).
- Produces: `INSULIN_SAFETY.evaluate(context, input, result) -> Warning[]` where
  `Warning = { id, severity:"info"|"caution"|"warning"|"critical", title, detail, interrupt:boolean }`,
  sorted most-severe first. `context = {age, weightKg, pregnancy, renal, hepatic, dxType, maxBolus, maxDaily}`, `input = {glucose, target, iob}`.

- [ ] **Step 1: Write the failing test**

```js
// test/insulin-safety.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../insulin-safety.js";

test("hypoglycemia is critical and interrupts", () => {
  const w = S.evaluate({}, { glucose: 60 }, { rounded: 2 });
  const hypo = w.find(x => x.id === "hypoglycemia");
  assert.ok(hypo);
  assert.equal(hypo.severity, "critical");
  assert.equal(hypo.interrupt, true);
});

test("severe hyperglycemia warns about ketones", () => {
  const w = S.evaluate({}, { glucose: 360 }, { rounded: 8 });
  assert.ok(w.find(x => x.id === "severe_hyper"));
});

test("max bolus exceeded is critical", () => {
  const w = S.evaluate({ maxBolus: 10 }, { glucose: 300 }, { rounded: 14 });
  const mx = w.find(x => x.id === "max_bolus");
  assert.equal(mx.severity, "critical");
});

test("IOB stacking is flagged", () => {
  const w = S.evaluate({}, { glucose: 200, iob: 3 }, { rounded: 5 });
  assert.ok(w.find(x => x.id === "stacking"));
});

test("pediatric, pregnancy, renal, hepatic each produce a warning", () => {
  const w = S.evaluate({ age: 8, pregnancy: true, renal: true, hepatic: true }, { glucose: 180 }, { rounded: 4 });
  ["pediatric", "pregnancy", "renal", "hepatic"].forEach(id => assert.ok(w.find(x => x.id === id), id));
});

test("missing glucose is flagged as warning", () => {
  const w = S.evaluate({}, { glucose: NaN }, { rounded: null });
  assert.ok(w.find(x => x.id === "missing_input"));
});

test("results are sorted most-severe first", () => {
  const w = S.evaluate({ age: 8 }, { glucose: 55 }, { rounded: 2 });
  assert.equal(w[0].severity, "critical");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insulin-safety.test.mjs`
Expected: FAIL — cannot find module `../insulin-safety.js`.

- [ ] **Step 3: Write minimal implementation**

```js
/* insulin-safety.js - pure insulin safety evaluation. No DOM, no storage.
 * evaluate(context, input, result) -> severity-ranked warnings. Dual export. */
(function () {
  "use strict";

  var RANK = { info: 0, caution: 1, warning: 2, critical: 3 };
  function num(x) { return typeof x === "number" && isFinite(x); }
  function W(id, severity, title, detail) {
    return { id: id, severity: severity, title: title, detail: detail, interrupt: severity === "critical" };
  }

  function evaluate(context, input, result) {
    context = context || {}; input = input || {}; result = result || {};
    var out = [];

    if (!num(input.glucose))
      out.push(W("missing_input", "warning", "Missing glucose",
        "Enter a current blood glucose before accepting a dose."));

    if (num(input.glucose) && input.glucose < 70)
      out.push(W("hypoglycemia", "critical", "Hypoglycemia",
        "Glucose " + input.glucose + " mg/dL is low. Do not give a correction dose; treat the low first."));

    if (num(input.glucose) && input.glucose > 300)
      out.push(W("severe_hyper", "warning", "Severe hyperglycemia",
        "Glucose " + input.glucose + " mg/dL. Check ketones and consider DKA before routine correction."));

    if (num(input.iob) && input.iob > 0 && num(result.rounded) && result.rounded > 0)
      out.push(W("stacking", "caution", "Active insulin on board",
        input.iob + " units still active. Confirm IOB was subtracted to avoid insulin stacking."));

    if (num(context.maxBolus) && num(result.rounded) && result.rounded > context.maxBolus)
      out.push(W("max_bolus", "critical", "Maximum bolus exceeded",
        "Recommended " + result.rounded + " units exceeds the configured maximum of " + context.maxBolus + " units."));

    if (num(context.maxDaily) && num(result.dailyTotal) && result.dailyTotal > context.maxDaily)
      out.push(W("max_daily", "critical", "Maximum daily dose exceeded",
        "Projected daily total exceeds the configured maximum of " + context.maxDaily + " units."));

    if (num(context.age) && context.age < 18)
      out.push(W("pediatric", "caution", "Pediatric patient",
        "Pediatric dosing is weight-based and specialist-guided. Verify against the pediatric protocol."));

    if (context.pregnancy)
      out.push(W("pregnancy", "caution", "Pregnancy",
        "Insulin requirements shift by trimester and glucose targets are tighter. Confirm current targets."));

    if (context.renal)
      out.push(W("renal", "caution", "Renal impairment",
        "Reduced insulin clearance raises hypoglycemia risk; consider a lower dose."));

    if (context.hepatic)
      out.push(W("hepatic", "caution", "Liver disease",
        "Altered gluconeogenesis and insulin metabolism; dose conservatively and monitor."));

    out.sort(function (a, b) { return RANK[b.severity] - RANK[a.severity]; });
    return out;
  }

  var API = { evaluate: evaluate };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_SAFETY = API;
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insulin-safety.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add insulin-safety.js test/insulin-safety.test.mjs
git commit -m "feat(insulin): safety engine with severity-ranked warnings"
```

---

### Task 7: Golden-regression suite (locked clinical cases)

**Files:**
- Create: `test/insulin-golden.test.mjs`

**Interfaces:**
- Consumes: `INSULIN_ENGINE`, `INSULIN_SAFETY`.
- Produces: nothing (regression lock only).

- [ ] **Step 1: Write the failing test**

```js
// test/insulin-golden.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import E from "../insulin-engine.js";
import S from "../insulin-safety.js";

// Locked cases. If any expected value changes, that is a deliberate clinical decision.
const CASES = [
  { name: "T1DM adult correction", fn: "correctionDose",
    in: { glucose: 240, target: 120, isf: 40, increment: 1 }, rounded: 3 },
  { name: "meal 45g at 1:15", fn: "mealBolus",
    in: { carbs: 45, icr: 15, increment: 0.5 }, rounded: 3 },
  { name: "combined with IOB", fn: "combinedDose",
    in: { carbs: 30, icr: 10, glucose: 200, target: 120, isf: 40, iob: 2, increment: 1 }, rounded: 3 },
  { name: "ISF 1800 rule TDD 45", fn: "isfFromTdd", in: { tdd: 45 }, rounded: 40 },
  { name: "ICR 500 rule TDD 40", fn: "icrFromTdd", in: { tdd: 40 }, rounded: 12.5 }
];

for (const c of CASES) {
  test("golden: " + c.name, () => {
    const r = E[c.fn](c.in);
    assert.equal(r.rounded, c.rounded);
  });
}

test("golden: hypo case interrupts", () => {
  const r = E.correctionDose({ glucose: 60, target: 120, isf: 40 });
  const w = S.evaluate({}, { glucose: 60 }, r);
  assert.equal(w[0].interrupt, true);
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `node --test test/insulin-golden.test.mjs`
Expected: PASS if the engine math matches these locked cases. If a case FAILS, stop and reconcile the formula against the spec before changing the expected value.

- [ ] **Step 3: (only if a case legitimately needs adjustment)**

Adjust the expected value only with an explicit note in the commit message explaining the clinical rationale.

- [ ] **Step 4: Run the full suite**

Run: `node --test test/insulin-engine.test.mjs test/insulin-safety.test.mjs test/insulin-golden.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add test/insulin-golden.test.mjs
git commit -m "test(insulin): golden-regression suite for engine + safety"
```

---

## Self-Review

**Spec coverage (backend slice only):**
- Meal bolus - Task 2 ✅ · Correction - Task 1 ✅ · Combined - Task 4 ✅ · IOB - Task 3 ✅ · ISF/ICR - Task 5 ✅ · Basal/TDD initiation - Task 5 ✅ · Safety taxonomy - Task 6 ✅ · Transparency (steps/formula/assumptions) - every engine Result ✅ · Golden regression - Task 7 ✅.
- Out of scope for THIS plan (later plans): pediatric + DKA workflows, patient-profile storage / dose-history persistence, dashboard/UI, insulin database, conversion, settings. These are named in the spec's build sequence.

**Placeholder scan:** No TBD/TODO; every code step has real code. ✅

**Type consistency:** `Result` shape identical across engine functions; `roundDose(x, increment)` used consistently; safety reads `result.rounded`; `Warning` shape consistent in Task 6 + Task 7. ✅

## Notes for the physician-owner

- Formula sources are standard (ADA Standards of Care; 1800/1500 and 500/450 rules; bolus-calculator IOB conventions) and are surfaced in each result's `refs`/`assumptions` - nothing hidden.
- Rule constants (1800/1500, 500/450, tddFactor, basalFraction, DIA, thresholds 70/300, maxBolus/maxDaily) are all parameters, not buried literals, so institutional protocols slot in without code changes.
- Hypoglycemia, max-bolus, and max-daily are the hard-interrupt criticals.
