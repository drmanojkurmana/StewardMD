/* Pure ICU logic in functions/_wardsynq/icu-care.js, pinned against the StewardMD calculator it was
 * ported from (icu-autoscores.js), so the two cannot drift apart silently.
 *
 * node --test test/wardsynq-icu-care-logic.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  interpretAbg, abgFrom, vasopressorDose, sofaScore, sepsisScreen, sedationFrom, sedationStatus, roundFrom, isVasoactive, fio2Fraction,
} from "../functions/_wardsynq/icu-care.js";

function autoscores() {
  const sb = {}; sb.window = sb;
  vm.createContext(sb); vm.runInContext(readFileSync(new URL("../icu-autoscores.js", import.meta.url), "utf8"), sb);
  return sb.window.ICU_AUTOSCORES;
}

test("SOFA parity: every component equals icu-autoscores.js's SOFA adapter on the same inputs", () => {
  const def = autoscores().DEFS.find((d) => d.id === "sofa");
  const cases = [
    { plt: 90, bili: 2.5, creat: 3.6, gcs: 12, map: 64, pao2: 70, fio2: 0.5, peep: 8, infusions: [] },
    { plt: 160, bili: 0.8, creat: 0.9, gcs: 15, map: 80, pao2: 400, fio2: 0.21, peep: 0, infusions: [] },
    { plt: 15, bili: 13, creat: 5.2, gcs: 5, map: 55, pao2: 50, fio2: 1.0, peep: 10, infusions: [{ name: "Noradrenaline", dose: 0.2, unit: "mcg/kg/min", rateMlHr: 12 }] },
    { plt: 120, bili: 1.5, creat: 1.5, gcs: 14, map: 72, pao2: 90, fio2: 0.4, peep: 5, infusions: [{ name: "Dopamine", dose: 7, unit: "mcg/kg/min", rateMlHr: 10 }] },
  ];
  for (const c of cases) {
    const want = def.adapt({ labs: { recent: { plt: c.plt, bili: c.bili, creat: c.creat } }, vitals: [{ ts: 1, gcs: c.gcs, map: c.map }], abg: { pao2: c.pao2, fio2: c.fio2 }, ventilator: { peep: c.peep }, infusions: c.infusions });
    const got = sofaScore({
      platelets: { value: c.plt, unit: "10*3/uL" }, bilirubin: { value: c.bili, unit: "mg/dL" }, creatinine: { value: c.creat, unit: "mg/dL" },
      gcs: c.gcs, map: c.map, abg: { sampleType: "arterial", po2: c.pao2, fio2: c.fio2 }, vent: { peep: c.peep },
      pressors: c.infusions.map((i) => ({ drug: i.name, running: true, ratePerHour: i.rateMlHr, dose: { value: i.dose } })),
    });
    const by = Object.fromEntries(got.components.map((x) => [x.key, x.score]));
    assert.deepEqual(by, { resp: want.resp, coag: want.coag, liver: want.liver, cardio: want.cardio, cns: want.cns, renal: want.renal }, JSON.stringify(c));
    assert.equal(got.partial, false);
    assert.equal(got.total, Object.values(by).reduce((a, b) => a + b, 0));
  }
});

test("SOFA: a result in a unit the bands are not written in is not scored (never converted), and a pressor with no worked-out dose floors its tier", () => {
  const s = sofaScore({ bilirubin: { value: 34, unit: "umol/L" }, pressors: [{ drug: "Noradrenaline", running: true, ratePerHour: 5, dose: { value: null } }] });
  const liver = s.components.find((c) => c.key === "liver");
  assert.equal(liver.score, null); assert.match(liver.reason, /umol\/L, not mg\/dL; it is not converted/);
  const cardio = s.components.find((c) => c.key === "cardio");
  assert.equal(cardio.score, 3); assert.match(cardio.caution, /may be higher/);
  assert.equal(s.partial, true); assert.equal(s.total, 3);
  const none = sofaScore({});
  assert.equal(none.total, null, "nothing to score is null, never 0");
});

test("ABG: ported analyzeABG outcomes; missing values are not interpretable; FiO2 as fraction or percent", () => {
  assert.equal(interpretAbg({ sampleType: "arterial", ph: 7.5, pco2: 48, hco3: 36 }).primary, "Metabolic alkalosis");
  assert.equal(interpretAbg({ sampleType: "arterial", ph: 7.28, pco2: 60, hco3: 26 }).primary, "Respiratory acidosis");
  assert.equal(interpretAbg({ sampleType: "arterial", ph: 7.4, pco2: 40, hco3: 24 }).primary, "Normal acid-base");
  assert.equal(interpretAbg({ sampleType: "arterial", ph: 7.1, pco2: 55, hco3: 16 }).primary, "Mixed metabolic and respiratory acidosis");
  const pf = interpretAbg({ sampleType: "arterial", ph: 7.4, pco2: 40, hco3: 24, po2: 90, fio2: 0.6 });
  assert.equal(pf.pf, 150); assert.equal(pf.pfBand, "moderate hypoxaemia");
  const miss = interpretAbg({ sampleType: "arterial", ph: 7.4 });
  assert.equal(miss.interpretable, false); assert.deepEqual(miss.missing, ["pCO2", "HCO3"]); assert.equal(miss.primary, null);
  assert.equal(fio2Fraction(40), 0.4); assert.equal(fio2Fraction("0.35"), 0.35); assert.equal(fio2Fraction(15), null); assert.equal(fio2Fraction("40%"), null);
  assert.ok(abgFrom({ ph: 7.3 }).problems.some((p) => p.field === "sampleType"), "arterial or venous must be said");
  assert.ok(abgFrom({ sampleType: "arterial", ph: "7,3" }).problems.some((p) => p.field === "ph"), "a comma decimal is refused, not guessed");
});

test("VASOPRESSOR dose refuses rather than assumes: no weight, no concentration, a unit that does not convert, no rate", () => {
  const c = { amount: 4, unit: "mg", volumeMl: 50 };
  assert.equal(vasopressorDose({ ratePerHour: 6, concentration: c, weightKg: 80 }).value, 0.1);
  assert.equal(vasopressorDose({ ratePerHour: 15, concentration: { amount: 400, unit: "mcg", volumeMl: 100 }, weightKg: 50 }).value, 0.02);
  assert.match(vasopressorDose({ ratePerHour: 6, concentration: c, weightKg: null }).reason, /No body weight/);
  assert.match(vasopressorDose({ ratePerHour: 6, concentration: null, weightKg: 80 }).reason, /never assumed/);
  assert.match(vasopressorDose({ ratePerHour: 6, concentration: { amount: 20, unit: "units", volumeMl: 50 }, weightKg: 80 }).reason, /does not convert/);
  assert.match(vasopressorDose({ ratePerHour: null, concentration: c, weightKg: 80 }).reason, /No pump rate/);
  for (const bad of [{ ratePerHour: 6, concentration: c, weightKg: null }, { ratePerHour: 6, concentration: null, weightKg: 80 }]) assert.equal(vasopressorDose(bad).value, null, "null, never 0");
  assert.equal(isVasoactive("Norfloxacin 400mg"), false, "icu.js's bare 'nor' fragment is not carried over");
  assert.equal(isVasoactive("Noradrenaline"), true);
});

const obs = (code, value, minsAgo, unit) => ({ category: "vital-signs", code, value, unit: unit || null, effectiveAt: new Date(Date.now() - minsAgo * 60000).toISOString() });
const ADULT = { ageYears: 50 };

test("SEPSIS screen: positive on qSOFA 2; qSOFA 1 plus lactate above 2 or fever is positive; exactly 2 is not raised; never called negative; missing and child refusals", () => {
  const pos = sepsisScreen({ observations: [obs("9279-1", 24, 5), obs("80339-5", "C", 5), obs("8480-6", 120, 5)], patient: ADULT });
  assert.equal(pos.result, "screen-positive"); assert.equal(pos.excludesSepsis, false);

  const base = [obs("9279-1", 24, 5), obs("80339-5", "A", 5), obs("8480-6", 120, 5)];
  assert.equal(sepsisScreen({ observations: base, patient: ADULT, lactate: { value: 2.5, at: "x", from: "blood gas" } }).result, "screen-positive");
  assert.equal(sepsisScreen({ observations: base, patient: ADULT, lactate: { value: 2, at: "x", from: "blood gas" } }).result, "not-screen-positive", "icu.js uses lactate > 2, so exactly 2 does not upgrade");
  assert.equal(sepsisScreen({ observations: [...base, obs("8310-5", 38.4, 5, "Cel")], patient: ADULT }).result, "screen-positive");
  const neg = sepsisScreen({ observations: base, patient: ADULT });
  assert.equal(neg.result, "not-screen-positive"); assert.match(neg.say, /does not exclude sepsis/); assert.ok(!/negative/i.test(neg.say));

  const miss = sepsisScreen({ observations: [obs("9279-1", 18, 5)], patient: ADULT });
  assert.equal(miss.result, "cannot-screen"); assert.equal(miss.missing.length, 2); assert.match(miss.say, /systolic blood pressure/);
  const stale = sepsisScreen({ observations: [obs("9279-1", 18, 400), obs("80339-5", "A", 400), obs("8480-6", 120, 400)], patient: ADULT });
  assert.equal(stale.result, "cannot-screen", "vitals older than the freshness window do not describe the patient now");
  const child = sepsisScreen({ observations: base, patient: { ageYears: 6 }, lactate: { value: 5 } });
  assert.equal(child.result, "cannot-screen"); assert.match(child.say, /adult screen/);
  assert.match(pos.advisory, /Advisory only/);
});

test("SEDATION and ROUND: target is a range, no target is not on target; unanswered round items are not assessed", () => {
  assert.equal(sedationStatus(sedationFrom({ rass: 0, targetLow: -2, targetHigh: 0 }).values).onTarget, true);
  assert.equal(sedationStatus(sedationFrom({ rass: 2, targetLow: -2, targetHigh: 0 }).values).say.includes("lighter than target"), true);
  assert.equal(sedationStatus(sedationFrom({ rass: -1 }).values).onTarget, null);
  assert.ok(sedationFrom({ rass: -1, targetLow: -2 }).problems.length, "half a target is refused");
  assert.ok(sedationFrom({ rass: 1.5 }).problems.length);
  const r = roundFrom({ items: { feeding: "yes" } });
  assert.equal(r.values.items.find((i) => i.key === "glucose").answer, "not-assessed");
  assert.equal(r.values.assessed, 1);
  assert.ok(roundFrom({ items: {} }).problems.length, "an empty round is not recorded");
  assert.ok(roundFrom({ items: { feeding: "maybe" } }).problems.length);
});
