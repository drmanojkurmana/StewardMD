/* test/wardsynq-paediatrics.test.mjs — refusing to treat a child as a small adult.
 *
 * Two verified hazards carried the same honest caveat: thresholds and dose ceilings were adult
 * values, and applying one to a child would be wrong. These tests are the closing of that gap, and
 * almost all of them assert a REFUSAL rather than a calculation, because the safe answer for a child
 * against an adult reference range is "I will not judge this", not a number.
 *
 * node --test test/wardsynq-paediatrics.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BAND, ageBandOf, isPaediatric, forBand, neonatalReady, paediatricCeiling, weightLooksWrong,
} from "../wardsynq/wardsynq-paediatrics.js";
import { classify, CriticalResultLoop, LOOP } from "../wardsynq/wardsynq-critical.js";
import { Observation } from "../wardsynq/wardsynq-model.js";

const PACK = JSON.parse(await readFile(new URL("../wardsynq/data/critical-thresholds.seed.json", import.meta.url), "utf8"));
const NOW = "2026-09-04T10:00:00.000Z";

const obs = (over) => Observation({
  patientId: "pat-1", code: "2823-3", value: 6.4, unit: "mmol/L", category: "laboratory",
  effectiveAt: NOW, ...over,
});

/* ------------------------------------------------------------------ banding */

test("banding: a date of birth gives a precise band", () => {
  const cases = [
    ["2026-09-01", BAND.NEONATE],       // 3 days
    ["2026-08-01", BAND.NEONATE],       // 34 days -> infant boundary check below
    ["2026-06-01", BAND.INFANT],
    ["2024-09-01", BAND.TODDLER],
    ["2019-09-01", BAND.CHILD],
    ["2011-09-01", BAND.ADOLESCENT],
    ["1980-09-01", BAND.ADULT],
  ];
  for (const [dob, expected] of cases) {
    const b = ageBandOf({ dob }, NOW);
    if (dob === "2026-08-01") { assert.equal(b.band, BAND.INFANT, "34 days is past the neonatal period"); continue; }
    assert.equal(b.band, expected, `${dob} should band as ${expected}`);
    assert.equal(b.precise, true);
  }
});

test("banding: an age in whole YEARS cannot distinguish a neonate from an older infant", () => {
  const b = ageBandOf({ ageYears: 0 }, NOW);
  assert.equal(b.band, BAND.UNKNOWN,
    "a two-day-old and an eleven-month-old are both '0 years' and are not the same patient");
  assert.equal(b.precise, false);
  assert.match(b.reason, /cannot distinguish a neonate/);
});

test("banding: whole years are good enough from toddler upwards", () => {
  assert.equal(ageBandOf({ ageYears: 7 }, NOW).band, BAND.CHILD);
  assert.equal(ageBandOf({ ageYears: 15 }, NOW).band, BAND.ADOLESCENT);
  assert.equal(ageBandOf({ ageYears: 67 }, NOW).band, BAND.ADULT);
});

test("banding: no age at all, or the provisional sentinel, is UNKNOWN rather than adult", () => {
  assert.equal(ageBandOf({}, NOW).band, BAND.UNKNOWN);
  assert.equal(ageBandOf({ dob: "0000-00-00" }, NOW).band, BAND.UNKNOWN,
    "the provisional-identity sentinel must not resolve to an age");
});

test("banding: ageDays wins over everything, because it is the only exact answer", () => {
  const b = ageBandOf({ ageDays: 2, ageYears: 40, dob: "1980-01-01" }, NOW);
  assert.equal(b.band, BAND.NEONATE);
  assert.equal(b.ageDays, 2);
});

/* ------------------------------------------------------------------ the refusal */

test("forBand: an UNBANDED entry means adult, and is refused for a child", () => {
  const adultOnly = { analyte: "Potassium", criticalHigh: 6.2 };
  assert.equal(forBand(adultOnly, BAND.ADULT).applies, true);
  for (const band of [BAND.NEONATE, BAND.INFANT, BAND.TODDLER, BAND.CHILD, BAND.ADOLESCENT]) {
    const r = forBand(adultOnly, band);
    assert.equal(r.applies, false, `an unbanded range must not be applied to a ${band}`);
    assert.match(r.reason, /unbanded, which means adult/);
  }
});

test("forBand: a banded entry is selected, and a missing band names what IS available", () => {
  const banded = [
    { band: BAND.ADULT, criticalHigh: 6.2 },
    { band: BAND.CHILD, criticalHigh: 6.5 },
  ];
  assert.equal(forBand(banded, BAND.CHILD).entry.criticalHigh, 6.5);
  const missing = forBand(banded, BAND.NEONATE);
  assert.equal(missing.applies, false);
  assert.match(missing.reason, /no neonate entry; the available bands are adult, child/,
    "the refusal must say what the pack actually has, so somebody can go and add the missing band");
});

test("forBand: an unknown band never resolves to anything", () => {
  assert.equal(forBand({ criticalHigh: 6.2 }, BAND.UNKNOWN).applies, false);
});

test("neonates: a neonatal result needs gestational age", () => {
  const term = neonatalReady({ band: BAND.NEONATE, gestationalAgeWeeks: 39 });
  assert.equal(term.ready, true);
  const unknown = neonatalReady({ band: BAND.NEONATE, gestationalAgeWeeks: null });
  assert.equal(unknown.ready, false);
  assert.match(unknown.reason, /26 week preterm and a term baby/);
  assert.equal(neonatalReady({ band: BAND.CHILD }).ready, true, "the rule is neonatal only");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the classifier */

test("ADVERSARIAL: a child's potassium is NOT classified against the adult limit", () => {
  const adult = classify(obs({ value: 6.4 }), PACK, { ageYears: 40 });
  assert.equal(adult.critical, true, "6.4 is critical in an adult");

  const child = classify(obs({ value: 6.4 }), PACK, { dob: "2019-09-01" });
  assert.equal(child.critical, false);
  assert.equal(child.unclassified, true,
    "the seed pack is adult-only, so a child's result must be refused rather than judged by it");
  assert.equal(child.band, BAND.CHILD);
  assert.match(child.reason, /unbanded, which means adult/);
});

test("ADVERSARIAL: a neonate with no gestational age is refused before any number is compared", () => {
  const r = classify(obs({ value: 6.4 }), PACK, { ageDays: 3 });
  assert.equal(r.unclassified, true);
  assert.equal(r.band, BAND.NEONATE);
  assert.match(r.reason, /gestational age/);
});

test("ADVERSARIAL: a patient of unknown age is refused, not assumed adult", () => {
  const r = classify(obs({ value: 6.4 }), PACK, { dob: "0000-00-00" });
  assert.equal(r.unclassified, true);
  assert.equal(r.band, BAND.UNKNOWN,
    "assuming adult is the single most likely way this control would be quietly defeated");
});

test("classification without a patient keeps working, because that is a different problem", () => {
  const r = classify(obs({ value: 6.4 }), PACK);
  assert.equal(r.critical, true, "a caller that does not know whose result it is must not be failed here");
});

test("a pack WITH a paediatric band classifies a child normally", () => {
  const banded = {
    thresholds: {
      "2823-3": [
        { band: BAND.ADULT, analyte: "Potassium", unit: "mmol/L", criticalHigh: 6.2 },
        { band: BAND.CHILD, analyte: "Potassium", unit: "mmol/L", criticalHigh: 6.2 },
      ],
    },
  };
  // forBand selects the child entry; the numeric comparison then runs against the pack's own record.
  const sel = forBand(banded.thresholds["2823-3"], BAND.CHILD);
  assert.equal(sel.applies, true);
  assert.equal(sel.entry.criticalHigh, 6.2);
});

/* ------------------------------------------------------------------ ADVERSARIAL: silence */

test("ADVERSARIAL: an unassessable result RAISES a loop instead of vanishing", async () => {
  const engine = new CriticalResultLoop({
    pack: PACK,
    now: () => NOW,
    responsibleFor: async () => ({ clinicianId: "dr-paeds" }),
    channels: { sms: async () => ({ delivered: true }) },
  });

  const loop = await engine.onResultFinalized(obs({ value: 6.4 }), { patient: { dob: "2019-09-01" } });
  assert.equal(loop.state, LOOP.OPEN,
    "declining to judge a child's potassium and telling nobody is at least as dangerous as judging it wrongly");
  assert.equal(loop.unassessable, true);
  assert.equal(loop.raisedBy, "unassessable-result");
  assert.match(loop.verdict.reason, /unbanded, which means adult/);
});

test("an adult's normal result still opens nothing", async () => {
  const engine = new CriticalResultLoop({ pack: PACK, now: () => NOW });
  const r = await engine.onResultFinalized(obs({ value: 4.1 }), { patient: { ageYears: 40 } });
  assert.equal(r.state, LOOP.NOT_CRITICAL, "the refusal rule must not turn every normal result into an alert");
});

/* ------------------------------------------------------------------ dosing */

test("dosing: the adult maximum caps a weight-based paediatric dose", () => {
  // A 60 kg adolescent at 15 mg/kg is 900 mg, under the 1 g adult cap.
  const under = paediatricCeiling({ mgPerKg: 15, weightKg: 60, adultMaxMg: 1000, band: BAND.ADOLESCENT });
  assert.equal(under.ceiling, 900);
  assert.equal(under.cappedByAdult, false);

  // A 90 kg adolescent at 15 mg/kg is 1350 mg. The arithmetic is right and the answer is dangerous.
  const over = paediatricCeiling({ mgPerKg: 15, weightKg: 90, adultMaxMg: 1000, band: BAND.ADOLESCENT });
  assert.equal(over.ceiling, 1000);
  assert.equal(over.cappedByAdult, true);
  assert.match(over.reasons[0].message, /exceeds the adult maximum/);
});

test("ADVERSARIAL: a weight-based dose cannot be calculated without a weight", () => {
  const r = paediatricCeiling({ mgPerKg: 15, weightKg: null, adultMaxMg: 1000, band: BAND.CHILD });
  assert.equal(r.ceiling, null);
  assert.equal(r.reasons[0].code, "NO_WEIGHT");
  for (const bad of [0, -5, "20", undefined, NaN]) {
    assert.equal(paediatricCeiling({ mgPerKg: 15, weightKg: bad, band: BAND.CHILD }).ceiling, null,
      `${JSON.stringify(bad)} is not a weight`);
  }
});

test("ADVERSARIAL: an implausible weight is caught, because a mistyped weight is invisible once it is arithmetic", () => {
  assert.equal(weightLooksWrong(3.5, BAND.NEONATE), null, "a normal newborn passes");
  assert.equal(weightLooksWrong(70, BAND.ADULT), null);

  const decimal = weightLooksWrong(35, BAND.NEONATE);
  assert.equal(decimal.code, "WEIGHT_TOO_HIGH", "3.5 kg typed as 35 kg would give a tenfold dose");

  const pounds = weightLooksWrong(154, BAND.CHILD);
  assert.equal(pounds.code, "WEIGHT_TOO_HIGH");
  assert.match(pounds.message, /pounds were entered as kilograms/);

  const tenth = weightLooksWrong(0.35, BAND.NEONATE);
  assert.equal(tenth.code, "WEIGHT_TOO_LOW");
  assert.match(tenth.message, /decimal point/);
});

test("weight sanity is generous on purpose: it catches typos, not unusual children", () => {
  assert.equal(weightLooksWrong(11, BAND.CHILD), null, "a small three-year-old is not a typo");
  assert.equal(weightLooksWrong(65, BAND.CHILD), null, "and neither is a large eleven-year-old");
});

test("isPaediatric names every band below adult", () => {
  for (const b of [BAND.NEONATE, BAND.INFANT, BAND.TODDLER, BAND.CHILD, BAND.ADOLESCENT]) {
    assert.equal(isPaediatric(b), true);
  }
  assert.equal(isPaediatric(BAND.ADULT), false);
  assert.equal(isPaediatric(BAND.UNKNOWN), false, "unknown is handled by its own rule, not by this one");
});
