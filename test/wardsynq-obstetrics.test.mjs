/* test/wardsynq-obstetrics.test.mjs — the patient who looks well until she does not.
 *
 * Two things are being tested here that a scoring test would not reach: that this is a TRIGGER chart
 * and not a sum, because summing is what lets a woman with one catastrophic parameter read as low
 * risk; and that a guess about blood loss can never become a measurement, because visual estimation
 * is wrong by roughly half at exactly the volumes where the decision changes.
 *
 * node --test test/wardsynq-obstetrics.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PREG, PUERPERIUM_DAYS, LOSS_METHOD, PPH_ML, OBSTETRIC_BUNDLES, ObstetricError,
  obstetricState, isObstetric, meows, meowsFromObservations,
  recordBloodLoss, pphThresholdReached, assessObstetricRecognition,
} from "../wardsynq/wardsynq-obstetrics.js";
import { Observation } from "../wardsynq/wardsynq-model.js";
import { EmergencyBundle, EmergencyError } from "../wardsynq/wardsynq-emergency.js";

const NOW = "2026-09-04T12:00:00.000Z";
const daysAgo = (d) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

/** A complete, entirely normal obstetric observation set. */
const WELL = Object.freeze({
  respiratoryRate: 16, oxygenSaturation: 99, systolicBloodPressure: 112,
  diastolicBloodPressure: 68, pulse: 88, temperature: 36.9, consciousness: "A",
  urineOutputMlPerHour: 60, proteinuria: "nil",
});

const ANTENATAL = { ageYears: 29, gestationWeeks: 34 };

/* ------------------------------------------------------------------ pregnancy is not a boolean */

test("gestation, labour and delivery each give a precise state", () => {
  assert.equal(obstetricState({ gestationWeeks: 32 }, NOW).state, PREG.ANTENATAL);
  assert.equal(obstetricState({ inLabour: true }, NOW).state, PREG.INTRAPARTUM);
  assert.equal(obstetricState({ deliveredAt: daysAgo(1) }, NOW).state, PREG.POSTPARTUM);
});

test("ADVERSARIAL: risk does not end at delivery, it peaks there", () => {
  const day1 = obstetricState({ deliveredAt: daysAgo(1) }, NOW);
  assert.equal(day1.state, PREG.POSTPARTUM);
  assert.equal(day1.postpartumDay, 1);
  assert.match(day1.reason, /haemorrhage risk is highest now/);

  const day40 = obstetricState({ deliveredAt: daysAgo(40) }, NOW);
  assert.equal(day40.state, PREG.POSTPARTUM, `the puerperium runs to ${PUERPERIUM_DAYS} days`);

  const later = obstetricState({ deliveredAt: daysAgo(60) }, NOW);
  assert.equal(later.state, PREG.NOT_PREGNANT, "and it does end, so the refusal ends with it");
});

test("a bare pregnant boolean is accepted but reported as imprecise", () => {
  const s = obstetricState({ pregnant: true }, NOW);
  assert.equal(s.state, PREG.ANTENATAL);
  assert.equal(s.precise, false);
  assert.match(s.reason, /cannot say whether she has delivered/);
});

test("an unrecorded pregnancy status is UNKNOWN, never assumed not pregnant", () => {
  assert.equal(obstetricState({}, NOW).state, PREG.UNKNOWN);
  assert.equal(obstetricState({ pregnant: false }, NOW).state, PREG.NOT_PREGNANT);
});

test("an unparseable delivery time does not silently become a postpartum day", () => {
  assert.equal(obstetricState({ deliveredAt: "not a date" }, NOW).state, PREG.UNKNOWN);
});

/* ------------------------------------------------------------------ MEOWS is triggers, not a sum */

test("a normal obstetric observation set raises no trigger", () => {
  const r = meows(WELL, ANTENATAL, NOW);
  assert.equal(r.applicable, true);
  assert.equal(r.alert, false);
  assert.equal(r.red.length, 0);
  assert.equal(r.incomplete, false);
});

test("ADVERSARIAL: there is no total anywhere in the result to be read as reassuring", () => {
  const r = meows(WELL, ANTENATAL, NOW);
  assert.equal(r.total, undefined);
  assert.equal(r.score, undefined,
    "a sum lets one catastrophic parameter hide behind six normal ones, which is the presentation that kills");
});

test("ADVERSARIAL: ONE red trigger is an alert, however normal everything else is", () => {
  const r = meows({ ...WELL, systolicBloodPressure: 85 }, ANTENATAL, NOW);
  assert.equal(r.alert, true);
  assert.equal(r.red.length, 1);
  assert.equal(r.red[0].parameter, "systolicBloodPressure");
  assert.match(r.escalation, /Immediate obstetric and anaesthetic review/);
});

test("two concurrent yellows are an alert; one is not", () => {
  const one = meows({ ...WELL, pulse: 108 }, ANTENATAL, NOW);
  assert.equal(one.yellow.length, 1);
  assert.equal(one.alert, false);

  const two = meows({ ...WELL, pulse: 108, temperature: 37.8 }, ANTENATAL, NOW);
  assert.equal(two.alert, true);
  assert.match(two.reason, /2 concurrent yellow triggers/);
  assert.match(two.escalation, /Urgent obstetric review/);
});

test("ADVERSARIAL: the compensation warning is attached to EVERY result, including the calm ones", () => {
  for (const values of [WELL, { ...WELL, systolicBloodPressure: 85 }]) {
    const r = meows(values, ANTENATAL, NOW);
    assert.match(r.advice, /compensates well and decompensates late/);
    assert.match(r.advice, /1\.5 litres with a normal blood pressure/);
    assert.match(r.advice, /Absence of triggers is not evidence that she is well/);
  }
});

test("ADVERSARIAL: a missing parameter does NOT suppress a red trigger", () => {
  const partial = { systolicBloodPressure: 85, pulse: 96 };
  const r = meows(partial, ANTENATAL, NOW);
  assert.equal(r.alert, true, "a red trigger is a red trigger whether or not the urine output was charted");
  assert.equal(r.incomplete, true);
  assert.ok(r.missing.includes("temperature"));
});

test("hypertension and proteinuria both trigger, because pre-eclampsia is why they are charted", () => {
  const r = meows({ ...WELL, systolicBloodPressure: 158, diastolicBloodPressure: 96, proteinuria: "2+" }, ANTENATAL, NOW);
  assert.equal(r.alert, true, "three concurrent yellows");
  assert.equal(r.yellow.length, 3);

  const severe = meows({ ...WELL, diastolicBloodPressure: 115, proteinuria: "3+" }, ANTENATAL, NOW);
  assert.equal(severe.red.length, 2);
});

test("oliguria triggers, because it is early and is the field most often left blank", () => {
  assert.equal(meows({ ...WELL, urineOutputMlPerHour: 15 }, ANTENATAL, NOW).red.length, 1);
  assert.equal(meows({ ...WELL, urineOutputMlPerHour: 25 }, ANTENATAL, NOW).yellow.length, 1);
});

test("MEOWS refuses a patient who is not obstetric, and says which chart applies", () => {
  const notPregnant = meows(WELL, { ageYears: 40, pregnant: false }, NOW);
  assert.equal(notPregnant.applicable, false);
  assert.match(notPregnant.advice, /Use NEWS2/);

  const unknown = meows(WELL, {}, NOW);
  assert.equal(unknown.applicable, false);
  assert.match(unknown.reason, /neither MEOWS nor NEWS2 can be selected/);
  assert.match(unknown.advice, /Establish pregnancy status/);
});

test("a pregnant adolescent is flagged rather than silently scored or silently refused", () => {
  const r = meows(WELL, { ageYears: 15, gestationWeeks: 30 }, NOW);
  assert.equal(r.applicable, true, "refusing her outright would leave the highest-risk patient with nothing");
  assert.match(r.ageCaution, /senior obstetric review is indicated regardless/);
});

test("MEOWS applies postpartum, which is where it matters most", () => {
  const r = meows({ ...WELL, pulse: 122 }, { ageYears: 31, deliveredAt: daysAgo(1) }, NOW);
  assert.equal(r.applicable, true);
  assert.equal(r.state, PREG.POSTPARTUM);
  assert.equal(r.alert, true);
});

/* ------------------------------------------------------------------ ADVERSARIAL: a guess is not a measurement */

test("ADVERSARIAL: a visual estimate is an observation and never a measurement", () => {
  const visual = recordBloodLoss({ ml: 600, method: LOSS_METHOD.VISUAL, at: NOW, by: "mw-1" });
  assert.equal(visual.quantitative, false);
  assert.match(visual.caution, /underestimates obstetric blood loss by roughly half/);
  assert.equal(visual.plausibleActualMl, 1200);

  const weighed = recordBloodLoss({ ml: 600, method: LOSS_METHOD.WEIGHED, at: NOW, by: "mw-1" });
  assert.equal(weighed.quantitative, true);
  assert.equal(weighed.caution, null);
  assert.equal(weighed.plausibleActualMl, null, "a measurement is not doubled");
});

test("ADVERSARIAL: a threshold cannot be decided on a visual estimate", () => {
  const visual = recordBloodLoss({ ml: 900, method: LOSS_METHOD.VISUAL, at: NOW, by: "mw-1" });
  const r = pphThresholdReached(visual, PPH_ML.MAJOR);
  assert.equal(r.reached, null, "not false: unknown");
  assert.match(r.reason, /may represent roughly 1800 ml/);
  assert.match(r.reason, /treat on clinical state meanwhile/);
});

test("a measured loss answers the threshold plainly", () => {
  const weighed = recordBloodLoss({ ml: 1100, method: LOSS_METHOD.WEIGHED, at: NOW, by: "mw-1" });
  const r = pphThresholdReached(weighed, PPH_ML.MAJOR);
  assert.equal(r.reached, true);
  assert.equal(r.category, "major");
  assert.equal(recordBloodLoss({ ml: 2400, method: LOSS_METHOD.WEIGHED, at: NOW, by: "mw-1" }).category, "massive");
});

test("how the loss was established is mandatory", () => {
  assert.throws(() => recordBloodLoss({ ml: 700, at: NOW, by: "mw-1" }), (e) => e.code === "NO_METHOD");
  assert.throws(() => recordBloodLoss({ ml: 700, method: "guess", at: NOW, by: "mw-1" }), (e) => e.code === "NO_METHOD");
  assert.throws(() => recordBloodLoss({ method: LOSS_METHOD.WEIGHED, at: NOW, by: "mw-1" }), (e) => e.code === "NO_VOLUME");
  assert.throws(() => recordBloodLoss({ ml: 700, method: LOSS_METHOD.WEIGHED }), ObstetricError);
});

/* ------------------------------------------------------------------ recognition */

test("ADVERSARIAL: an untrustworthy visual estimate PROMPTS rather than waiting for certainty", () => {
  const visual = recordBloodLoss({ ml: 600, method: LOSS_METHOD.VISUAL, at: NOW, by: "mw-1" });
  const a = assessObstetricRecognition({ loss: visual, at: NOW });
  assert.equal(a.prompt, true);
  assert.equal(a.strength, "high", "600 ml eyeballed is plausibly 1200 ml, and waiting to be sure is the error");
  assert.equal(a.code, "code-pph");
  assert.match(a.reasons[0], /plausibly 1200 ml/);
});

test("a hypertensive MEOWS alert prompts the eclampsia bundle, not the haemorrhage one", () => {
  const m = meows({ ...WELL, diastolicBloodPressure: 118, proteinuria: "3+" }, ANTENATAL, NOW);
  const a = assessObstetricRecognition({ meowsResult: m, at: NOW });
  assert.equal(a.prompt, true);
  assert.equal(a.code, "code-eclampsia");
  assert.equal(a.strength, "high");
});

test("a normal picture prompts nothing", () => {
  const a = assessObstetricRecognition({ meowsResult: meows(WELL, ANTENATAL, NOW), at: NOW });
  assert.equal(a.prompt, false);
});

/* ------------------------------------------------------------------ the bundles reuse the one clock */

test("the obstetric bundles inherit every timing guarantee rather than growing a second clock", () => {
  const b = new EmergencyBundle({
    code: "code-pph", definition: OBSTETRIC_BUNDLES["code-pph"],
    patientId: "pat-1", startedBy: "dr-obs", timeZero: NOW, now: NOW,
  });
  assert.throws(() => { b.timeZero = daysAgo(-1); }, TypeError);
  assert.throws(
    () => b.complete("uterotonic", { event: "ordered", at: NOW, by: "mw-1" }),
    (e) => e instanceof EmergencyError && e.code === "WRONG_EVENT");

  b.complete("uterotonic", { event: "administered", at: new Date(Date.parse(NOW) + 20 * 60000).toISOString(), by: "mw-1" });
  const s = b.status(new Date(Date.parse(NOW) + 25 * 60000).toISOString());
  assert.equal(s.state, "breached", "a uterotonic at 20 minutes against a 10 minute target");
});

test("ADVERSARIAL: no bundle element carries a magnesium dose", () => {
  const magnesium = OBSTETRIC_BUNDLES["code-eclampsia"].elements.find((e) => e.key === "magnesium");
  assert.match(magnesium.label, /this system does not prescribe it/);
  assert.equal(/\d+\s*(mg|g|ml|mmol)/i.test(magnesium.label), false,
    "magnesium has a narrow window between anticonvulsant and respiratory arrest; an unapproved number here is a route to a maternal death");

  for (const def of Object.values(OBSTETRIC_BUNDLES)) {
    for (const el of def.elements) {
      assert.equal(/\d+\s*(mg|mcg|g|units)\b/i.test(el.label), false, `${el.key} must not carry a dose`);
    }
  }
});

test("the PPH bundle requires blood loss to be QUANTIFIED, which is its own element", () => {
  const q = OBSTETRIC_BUNDLES["code-pph"].elements.find((e) => e.key === "quantify");
  assert.equal(q.doneOn, "measured");
  assert.match(q.label, /not estimated/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the same gatherer
 *
 * MEOWS originally took a plain values object while NEWS2 gathered from observations with a
 * freshness window and the IoMT artefact filter. That asymmetry meant a chart could be built over a
 * six-hour-old blood pressure or a detached lead with nothing to stop it. Both now go through
 * wardsynq-vitals.js, and these hold it there.
 */

const obs = (code, value, minutesAgo = 0, over = {}) => Observation({
  patientId: "pat-1", code, value, category: "vital-signs",
  effectiveAt: new Date(Date.parse(NOW) - minutesAgo * 60000).toISOString(), ...over,
});

const FULL_OBS = () => [
  obs("9279-1", 16), obs("2708-6", 99), obs("8480-6", 112), obs("8462-4", 68),
  obs("8867-4", 88), obs("8310-5", 36.9), obs("80339-5", "A"),
  obs("9187-6", 60), obs("2888-6", "nil"),
];

test("MEOWS can be built from observations, and matches the hand-filled chart", () => {
  const r = meowsFromObservations(FULL_OBS(), ANTENATAL, { now: NOW });
  assert.equal(r.applicable, true);
  assert.equal(r.alert, false);
  assert.equal(r.incomplete, false);
  assert.equal(Object.keys(r.sources).length, 9, "and it carries the observations it was built from");
});

test("ADVERSARIAL: a stale blood pressure does not become a current MEOWS parameter", () => {
  const stale = FULL_OBS();
  stale[2] = obs("8480-6", 112, 6 * 60); // a six-hour-old systolic
  const r = meowsFromObservations(stale, ANTENATAL, { now: NOW });
  assert.ok(r.missing.includes("systolicBloodPressure"));
  assert.equal(r.incomplete, true);
  assert.match(r.rejected[0].reason, /beyond the 240 minute freshness window/);
});

test("ADVERSARIAL: a detached lead never reaches the obstetric chart either", () => {
  const withArtifact = FULL_OBS();
  // A lead artefact reading a pulse of 132 would raise a red trigger on a well woman.
  withArtifact.push(obs("8867-4", 132, 0, { category: "device", artifact: true, scoreEligible: false, signalQualityIndex: 20 }));
  const r = meowsFromObservations(withArtifact, ANTENATAL, { now: NOW });
  assert.equal(r.alert, false);
  assert.equal(r.red.length, 0);
});

test("a real tachycardia from a vetted device DOES trigger", () => {
  const list = FULL_OBS().filter((o) => o.code !== "8867-4");
  list.push(obs("8867-4", 132, 0, { category: "device", scoreEligible: true, signalQualityIndex: 97 }));
  const r = meowsFromObservations(list, ANTENATAL, { now: NOW });
  assert.equal(r.alert, true);
  assert.equal(r.red[0].parameter, "pulse");
});
