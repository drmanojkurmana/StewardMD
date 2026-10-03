/* test/clinical-params.test.mjs — shared patient-parameter parser with evidence records.
 * Covers vault/plans/Edge-Master-Plan.md section 2.1 (evidence record), Appendix C (label check)
 * and the danger cases from the reviews: wrong-field numbers, past vs current, family history,
 * missing-is-not-negative, unit ambiguity.
 * node --test test/clinical-params.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../clinical-params.js");

const vals = (text, opts) => {
  const out = {};
  const u = P.parse(text, opts).usable;
  Object.keys(u).forEach((k) => { out[k] = u[k].value; });
  return out;
};

test("compact CrCl request", () => {
  assert.deepEqual(vals("crcl 72F 58kg cr 1.4"), { age_years: 72, sex: "female", weight_kg: 58, scr_mg_dl: 1.4 });
  assert.deepEqual(vals("crcl for 72 yo female 58 kg creat 1.4"), { age_years: 72, weight_kg: 58, scr_mg_dl: 1.4, sex: "female" });
});

test("CURB-65 sentence", () => {
  const v = vals("CURB 65: 78 year old, confused, RR 32, BP 88/50, urea 9");
  assert.equal(v.age_years, 78); assert.equal(v.rr, 32); assert.equal(v.sbp, 88); assert.equal(v.dbp, 50);
  assert.equal(v.urea_mmol_l, 9); assert.equal(v.confusion, true);
});

test("MELD and anion gap labs", () => {
  assert.deepEqual(vals("MELD bili 3.2 inr 1.8 creat 2.1 na 128 alb 2.9"),
    { bilirubin_mg_dl: 3.2, inr: 1.8, scr_mg_dl: 2.1, sodium: 128, albumin_g_dl: 2.9 });
  assert.deepEqual(vals("anion gap na 138 cl 100 hco3 12"), { sodium: 138, chloride: 100, bicarbonate: 12 });
});

test("evidence record shape", () => {
  const r = P.parse("wt 58 kg", { patient_session_id: "pt-1", request_id: "rq-9" }).usable.weight_kg;
  assert.equal(r.value, 58); assert.equal(r.unit, "kg");
  assert.equal(r.source_text, "wt 58 kg"); assert.deepEqual(r.span, [0, 8]);
  assert.equal(r.assertion, "present"); assert.equal(r.time_context, "current");
  assert.equal(r.extractor, "rules"); assert.equal(r.schema_version, P.SCHEMA_VERSION);
  assert.equal(r.patient_session_id, "pt-1"); assert.equal(r.request_id, "rq-9");
});

// ---- Appendix C danger cases: a real number in the wrong field ---------------------------------
test("label check: neighbour's label is not borrowed", () => {
  assert.equal(P.validateSlot("age 72 wt 58", "age_years", 58), false);
  assert.equal(P.validateSlot("age 72 wt 58", "weight_kg", 58), true);
  assert.equal(P.validateSlot("bp 150/90 age 50", "age_years", 150), false);
  assert.equal(P.validateSlot("sugar 342 weight 80", "weight_kg", 342), false);
  assert.equal(P.validateSlot("65M, cr 2.1", "weight_kg", 2.1), false);
});
test("label check: repeated values, substrings, formats", () => {
  assert.equal(P.validateSlot("wt 70 age 70", "age_years", 70), true);
  assert.equal(P.validateSlot("wt 70 age 70", "weight_kg", 70), true);
  assert.equal(P.validateSlot("crcl 11.4", "scr_mg_dl", 1.4), false);
  assert.equal(P.validateSlot("72 yo", "age_years", "72.0"), true);
  assert.equal(P.validateSlot("pulse one ten", "hr", 110), true);
});
test("unlabelled numbers are not guessed", () => {
  const v = vals("pen allergic lady, 34, 52 kg");
  assert.equal(v.age_years, undefined, "a bare 34 has no label");
  assert.equal(v.weight_kg, 52);
  assert.deepEqual(vals("crcl 11.4"), {});
});

// ---- clinical meaning: time, assertion, person -------------------------------------------------
test("past value is context, current value fills", () => {
  const r = P.parse("creatinine was 1.4 last month, now 2.1");
  assert.equal(r.usable.scr_mg_dl.value, 2.1);
  const past = r.records.find((x) => x.value === 1.4);
  assert.equal(past.time_context, "past"); assert.equal(past.assertion, "historical");
});
test("BP before fluids vs now", () => {
  const v = vals("BP was 80/50 before fluids, now BP 110/70");
  assert.equal(v.sbp, 110); assert.equal(v.dbp, 70);
});
test("patient's home reading is not current", () => {
  const v = vals("My BP was 150/90 at home. BP 128/82");
  assert.equal(v.sbp, 128);
  assert.equal(vals("my sugar was 300 yesterday").glucose_mg_dl, undefined);
});
test("third-person exam dictation is current", () => {
  assert.equal(vals("His BP is 130/80").sbp, 130);
});
test("family history value is never the patient's", () => {
  const r = P.parse("father had creatinine 3.1");
  assert.equal(r.usable.scr_mg_dl, undefined);
  assert.equal(r.records[0].assertion, "family");
});

// ---- booleans: missing is not negative ----------------------------------------------------------
test("explicit absence, explicit presence, silence", () => {
  assert.equal(vals("no penicillin allergy, not confused").confusion, false);
  assert.equal(vals("no penicillin allergy, not confused").penicillin_allergy, false);
  assert.equal(vals("confused, RR 32").confusion, true);
  assert.equal(vals("RR 32").confusion, undefined, "silence stays unknown");
});

// ---- units ---------------------------------------------------------------------------------------
test("unit conversions", () => {
  assert.equal(vals("creat 130 umol/l").scr_mg_dl, 1.47);
  assert.equal(vals("sugar 12 mmol").glucose_mg_dl, 216);
  assert.equal(vals("temp 101f").temp_c, 38.3);
  assert.equal(vals("temp 38.5 c, hr 110").temp_c, 38.5);
});
test("ambiguous units are rejected, not guessed", () => {
  const r = P.parse("creatinine 130");
  assert.equal(r.usable.scr_mg_dl, undefined);
  assert.ok(r.rejected.some((x) => x.field === "scr_mg_dl"));
  const g = P.parse("sugar 12");
  assert.equal(g.usable.glucose_mg_dl, undefined);
  assert.equal(vals("12 mmol").urea_mmol_l, undefined, "a shared unit alone never picks a field");
});
test("out-of-range values are rejected", () => {
  assert.equal(vals("spo2 140").spo2, undefined);
  assert.equal(vals("bp 80/120").sbp, undefined, "systolic must exceed diastolic");
});

// ---- ambiguity and isolation --------------------------------------------------------------------
test("two different current values for one field: nothing filled", () => {
  const r = P.parse("wt 58 kg, weight 62 kg");
  assert.equal(r.usable.weight_kg, undefined);
  assert.deepEqual(r.ambiguous, ["weight_kg"]);
});
test("no state carries between calls", () => {
  P.parse("confused, wt 70");
  assert.deepEqual(vals("RR 20"), { rr: 20 });
});
test("compact age-sex vs temperature", () => {
  assert.equal(vals("temp 101f").age_years, undefined);
  const r = P.parse("101f");
  assert.equal(r.usable.age_years, undefined);
  assert.ok(r.rejected.some((x) => x.field === "age_years"));
});
test("GCS components", () => {
  const r = P.parse("GCS E2 V3 M5");
  assert.equal(r.usable.gcs.value, 10);
  assert.deepEqual(r.usable.gcs.components, { eye: 2, verbal: 3, motor: 5 });
});
// Found by the extraction gold set (vault/plans/edge-data/gold/cparams-gold.jsonl, scripts/edge/score.mjs --extraction).
test("a pronoun carries the relative into the next clause: her sugar is the mother's", () => {
  const r = P.parse("mother has diabetes, her sugar 300");
  assert.equal(r.usable.glucose_mg_dl, undefined);
  assert.equal(r.records.find((x) => x.field === "glucose_mg_dl").assertion, "family");
  assert.equal(P.parse("72M, his creatinine 2.1").usable.scr_mg_dl.value, 2.1, "the patient's own pronoun is not family");
});
test("alternatives are ambiguous, never the first value", () => {
  const r = P.parse("cr 1.4 or 1.8, not sure");
  assert.equal(r.usable.scr_mg_dl, undefined); assert.ok(r.ambiguous.includes("scr_mg_dl"));
  assert.equal(P.parse("cr maybe 1.4").usable.scr_mg_dl, undefined, "doubt is not a usable value");
  assert.equal(P.parse("weight approx 60 kg").usable.weight_kg.value, 60, "an approximate weight still is");
});
test("Hinglish and Tenglish time words: the old value is past, the current one is used", () => {
  assert.equal(P.parse("sugar 300 tha kal, aaj 180").usable.glucose_mg_dl.value, 180);
  const t = P.parse("bp 140/90 ki mundu, ippudu 100/70");
  assert.equal(t.usable.sbp.value, 100); assert.equal(t.usable.dbp.value, 70);
  assert.equal(P.parse("creatinine 1.6 undi").usable.scr_mg_dl.value, 1.6);
});
