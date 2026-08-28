/* test/insulin-extract.test.mjs - Ask MaiK insulin extraction: the validator and the server sanitizer.
 *
 * These tests exist to pin ONE property above all others: a required input the doctor did not state
 * never becomes a default. Silent defaulting is the danger here, not the arithmetic
 * (vault/decisions/Decisions.md 2026-08-28). The dose itself is not tested here - it cannot be,
 * because nothing in this path produces one. That is the point.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import E from "../insulin-extract.js";
import { sanitizeInsulinExtract, insulinExtractPrompt } from "../functions/api/ai/_insulin-extract.js";

const F = (key, value, from = "said so") => ({ key, value, from });

/* ---------------- the owner's headline example ---------------- */

test("'16 units regular, sugar 320' fills glucose and ASKS for what is missing", () => {
  // A faithful extraction of the ambiguous example: glucose is stated, the ISF route is the usual
  // total daily dose, and the model correctly refuses to resolve "on 16 units regular".
  const p = E.validate({
    mode: "correction", corrSource: "tdd",
    rationale: "Correction only, no carbohydrate mentioned.",
    fields: [F("glucose", 320, "sugar 320 now")],
    questions: ["Is the 16 units of regular insulin a standing dose, or was it just given?"]
  });
  assert.equal(p.ok, true);
  assert.equal(p.mode, "correction");
  assert.equal(p.corrSource, "tdd");
  assert.deepEqual(p.set.map(s => s.key), ["glucose"]);
  // The usual total daily dose was NOT stated unambiguously, so it must be asked for, not assumed.
  assert.ok(p.missing.includes("fdTdd"), "an unresolved usual TDD must be asked for");
  assert.equal(p.questions.length, 1);
});

test("the phrase a value came from is carried through for the doctor to audit", () => {
  const p = E.validate({ mode: "meal", fields: [F("carbs", 60, "about 60 g of rice"), F("icr", 12, "ratio 1 to 12")] });
  assert.equal(p.set.find(s => s.key === "carbs").from, "about 60 g of rice");
  assert.equal(p.missing.length, 0);
});

/* ---------------- never default a missing input ---------------- */

test("a correction with no ISF stated leaves ISF missing, never filled", () => {
  const p = E.validate({ mode: "correction", corrSource: "isf", fields: [F("glucose", 300)] });
  assert.ok(p.missing.includes("isf"));
  assert.ok(p.missing.includes("iob"));
  assert.equal(p.set.find(s => s.key === "isf"), undefined, "ISF must not be invented");
});

test("silence about recent insulin is NOT zero IOB on the known-ISF route", () => {
  const p = E.validate({ mode: "correction", corrSource: "isf", fields: [F("glucose", 300), F("isf", 50)] });
  assert.ok(p.missing.includes("iob"), "time since the last dose must be asked for");
});

test("IOB is not demanded on the routes whose engine call ignores it", () => {
  // firstDoseCorrection() resolves IOB from a prior dose + timing and IGNORES a plain iob argument,
  // so demanding one here would have MaiK fill a box that changes nothing.
  const p = E.validate({ mode: "correction", corrSource: "tdd", fields: [F("glucose", 300), F("fdTdd", 40)] });
  assert.equal(p.missing.length, 0);
});

test("'already using insulin' on the estimate route must state the last dose and its timing", () => {
  const p = E.validate({
    mode: "correction", corrSource: "estimate",
    fields: [F("glucose", 300), F("weightKg", 70), F("fdNaive", false)]
  });
  assert.ok(p.missing.includes("fdPriorUnits"));
  assert.ok(p.missing.includes("fdPriorMins"), "time since the last dose is the named must-ask");
});

test("an insulin-naive estimate does not demand a prior dose", () => {
  const p = E.validate({
    mode: "correction", corrSource: "estimate",
    fields: [F("glucose", 300), F("weightKg", 70), F("fdNaive", true)]
  });
  assert.equal(p.missing.length, 0);
});

test("paediatric stage is required, because the engine silently defaults it", () => {
  // pediatricInit() falls back to stageFactor[stage] || 0.5, which would quietly make every child
  // prepubertal and change the whole day's insulin.
  const p = E.validate({ mode: "pediatric", fields: [F("weightKg", 24)] });
  assert.ok(p.missing.includes("pedStage"));
});

test("renal impairment without an eGFR is asked for", () => {
  const p = E.validate({ mode: "meal", fields: [F("carbs", 40), F("icr", 10), F("renal", true)] });
  assert.ok(p.missing.includes("egfr"));
});

test("pregnancy without a trimester is asked for", () => {
  const p = E.validate({ mode: "meal", fields: [F("carbs", 40), F("icr", 10), F("pregnancy", true)] });
  assert.ok(p.missing.includes("trimester"));
});

/* ---------------- untrusted output is dropped, not passed on ---------------- */

test("an implausible value is dropped AND becomes a question", () => {
  const p = E.validate({ mode: "basal", fields: [F("weightKg", 700, "70 kg")] });
  assert.equal(p.set.length, 0, "700 kg must never reach the engine");
  assert.ok(p.missing.includes("weightKg"), "and must be asked for rather than silently omitted");
});

test("a field the mode does not use is ignored", () => {
  const p = E.validate({ mode: "meal", fields: [F("carbs", 40), F("icr", 10), F("dkaRate", 0.1)] });
  assert.equal(p.set.find(s => s.key === "dkaRate"), undefined);
});

test("an unknown field name is ignored", () => {
  const p = E.validate({ mode: "meal", fields: [F("carbs", 40), F("icr", 10), F("recommendedDose", 6)] });
  assert.equal(p.set.length, 2);
  assert.equal(JSON.stringify(p).includes("recommendedDose"), false);
});

test("an unknown mode is refused outright", () => {
  const p = E.validate({ mode: "freestyle", fields: [F("glucose", 300)] });
  assert.equal(p.ok, false);
  assert.ok(p.error);
});

test("a gated mode is refused rather than silently opened", () => {
  const p = E.validate({ mode: "dka", fields: [F("weightKg", 70)] },
    { allowedModes: ["combined", "meal", "correction", "basal"] });
  assert.equal(p.ok, false);
  assert.ok(p.error);
});

test("a non-boolean for a boolean field is rejected", () => {
  const p = E.validate({ mode: "meal", fields: [F("carbs", 40), F("icr", 10), F("pregnancy", "yes")] });
  assert.equal(p.set.find(s => s.key === "pregnancy"), undefined);
});

test("a string, null or NaN numeric is rejected and asked for", () => {
  for (const bad of ["", null, "lots", NaN, undefined]) {
    const p = E.validate({ mode: "meal", fields: [F("carbs", bad), F("icr", 10)] });
    assert.equal(p.set.find(s => s.key === "carbs"), undefined, `rejected: ${String(bad)}`);
    assert.ok(p.missing.includes("carbs"));
  }
});

test("garbage input never throws and never yields a usable plan", () => {
  for (const bad of [null, undefined, 42, "text", [], { fields: "no" }]) {
    const p = E.validate(bad);
    assert.equal(p.ok, false);
  }
});

test("an unstated corrSource falls back to the known-ISF route, which then demands an ISF", () => {
  const p = E.validate({ mode: "correction", fields: [F("glucose", 300)] });
  assert.equal(p.corrSource, "isf");
  assert.ok(p.missing.includes("isf"));
});

test("requiredFor reflects the correction sub-route", () => {
  assert.deepEqual(E.requiredFor("correction", "isf"), ["glucose", "isf", "iob"]);
  assert.deepEqual(E.requiredFor("correction", "tdd"), ["glucose", "fdTdd"]);
  assert.deepEqual(E.requiredFor("meal"), ["carbs", "icr"]);
  assert.deepEqual(E.requiredFor("nonsense"), []);
});

test("every required key has a plain-English question and a label", () => {
  for (const mode of Object.keys(E.MODES)) {
    for (const key of E.requiredFor(mode, "isf")) {
      assert.ok(E.askFor(key).length > 5, `${key} needs a question`);
      assert.ok(typeof E.labelFor(key) === "string" && E.labelFor(key).length > 0, `${key} needs a label`);
    }
  }
});

/* ---------------- the plan() wrapper never rejects ---------------- */

test("a provider that throws yields a failed plan, not a rejection", async () => {
  const prev = E.getProvider();
  E.setProvider({ extract() { throw new Error("boom"); } });
  const p = await E.plan("anything");
  assert.equal(p.ok, false);
  assert.ok(p.error);
  E.setProvider(prev);
});

test("a provider returning nothing yields a failed plan", async () => {
  const prev = E.getProvider();
  E.setProvider({ extract() { return null; } });
  const p = await E.plan("anything");
  assert.equal(p.ok, false);
  E.setProvider(prev);
});

test("empty text is refused without calling the provider", async () => {
  const prev = E.getProvider();
  let called = false;
  E.setProvider({ extract() { called = true; return {}; } });
  const p = await E.plan("   ");
  assert.equal(p.ok, false);
  assert.equal(called, false);
  E.setProvider(prev);
});

test("a mocked provider round-trips into a usable plan", async () => {
  const prev = E.getProvider();
  E.setProvider({ extract: () => Promise.resolve({ mode: "meal", fields: [F("carbs", 45), F("icr", 10)], rationale: "Carbohydrate cover only." }) });
  const p = await E.plan("60 g rice, ratio 1:10");
  assert.equal(p.ok, true);
  assert.equal(p.mode, "meal");
  assert.equal(p.missing.length, 0);
  E.setProvider(prev);
});

/* ---------------- server sanitizer ---------------- */

test("server sanitizer whitelists modes and field keys", () => {
  const out = sanitizeInsulinExtract({
    mode: "correction", corrSource: "tdd",
    fields: [{ key: "glucose", value: 320, from: "sugar 320" }, { key: "evil", value: 1 }, { key: "dose", value: 6 }],
    questions: ["How long since the last dose?"]
  });
  assert.equal(out.mode, "correction");
  assert.deepEqual(out.fields.map(f => f.key), ["glucose"]);
  assert.equal(out.questions.length, 1);
});

test("server sanitizer refuses an unknown mode", () => {
  assert.equal(sanitizeInsulinExtract({ mode: "hack", fields: [{ key: "glucose", value: 1 }] }).mode, "");
});

test("server sanitizer strips a rationale that recommends a dose", () => {
  assert.equal(sanitizeInsulinExtract({ mode: "meal", rationale: "Give 6 units now." }).rationale, "");
  assert.equal(sanitizeInsulinExtract({ mode: "meal", rationale: "I suggest 4 u before the meal." }).rationale, "");
});

test("server sanitizer keeps a rationale that merely quotes an input", () => {
  const out = sanitizeInsulinExtract({ mode: "correction", rationale: "Usual total daily dose 16 units was stated, so the ISF is derived from it." });
  assert.ok(out.rationale.length > 0, "quoting an INPUT is not recommending a dose");
});

test("server sanitizer keeps a clarifying question that quotes units", () => {
  // The owner's own example depends on this question surviving.
  const out = sanitizeInsulinExtract({ mode: "correction", questions: ["Was the 16 units of regular just given, or is it a standing dose?"] });
  assert.equal(out.questions.length, 1);
});

test("server sanitizer replaces em dashes (no em dash in app-facing text)", () => {
  const out = sanitizeInsulinExtract({ mode: "meal", rationale: "Carbohydrate cover only — no correction needed." });
  assert.equal(out.rationale.includes("—"), false);
});

test("server sanitizer never throws on garbage", () => {
  for (const bad of [null, undefined, 5, "x", [], { fields: 3, questions: 4 }]) {
    assert.equal(typeof sanitizeInsulinExtract(bad), "object");
  }
});

test("the prompt forbids emitting a dose and forbids inventing an input", () => {
  const p = insulinExtractPrompt({ allowedModes: ["meal"] }, "60 g rice");
  assert.ok(/NEVER INVENT AN INPUT/.test(p));
  assert.ok(/not state a dose/i.test(p));
  assert.ok(p.includes("60 g rice"));
  assert.ok(p.includes('["meal"]'), "the enabled-mode list reaches the model");
});

/* ---------------- the whole point, stated as a test ---------------- */

test("no validated plan can ever carry a dose", () => {
  const p = E.validate({
    mode: "correction", corrSource: "isf",
    fields: [F("glucose", 320), F("isf", 50), F("iob", 0), F("dose", 6), F("rounded", 6), F("units", 6)]
  });
  const keys = p.set.map(s => s.key);
  for (const forbidden of ["dose", "rounded", "units", "result"]) assert.ok(!keys.includes(forbidden));
  assert.equal(p.set.length, 3);
});
