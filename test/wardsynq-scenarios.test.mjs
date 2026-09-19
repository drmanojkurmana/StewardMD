/* test/wardsynq-scenarios.test.mjs — one patient, all the way through.
 *
 * (The spec calls this test/clinical-scenarios/*. It lives here so the repository's single
 * `node --test test/wardsynq-*.test.mjs` glob picks it up rather than silently not running.)
 *
 * Thirty-two unit suites each prove one module correct in isolation. That is exactly the shape of
 * testing that misses integration defects, because every module is tested against the interface its
 * own author imagined. These scenarios run one patient through the whole stack in order, and the
 * assertions are deliberately placed at the SEAMS: the point where the deterioration engine hands to
 * recognition, where recognition pins the bundle clock, where the eMAR completes a bundle element,
 * where the lineage graph explains a number the UI would show.
 *
 * The multi-morbidity part matters. A single-problem patient exercises one path. A patient who is
 * 71, diabetic, on warfarin, deteriorating and postpartum is where modules disagree with each other,
 * and disagreement between two correct modules is the defect class unit tests cannot see.
 *
 * node --test test/wardsynq-scenarios.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Patient, Observation, MedicationOrder } from "../wardsynq/wardsynq-model.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { news2, DeteriorationMonitor, PARAM, CLINICAL_RISK } from "../wardsynq/wardsynq-deterioration.js";
import { RecognitionQueue, assessSepsisRecognition } from "../wardsynq/wardsynq-recognition.js";
import { screenSepsis, EmergencyBundle, EmergencyError, CODE } from "../wardsynq/wardsynq-emergency.js";
import { BundleBinder, provenanceSummary, PROVENANCE } from "../wardsynq/wardsynq-bundle-binding.js";
import { MedicationAdministrationRecord } from "../wardsynq/wardsynq-meds.js";
import { LineageGraph, fromNews2 } from "../wardsynq/wardsynq-lineage.js";
import { meows, obstetricState, recordBloodLoss, pphThresholdReached, LOSS_METHOD, PREG } from "../wardsynq/wardsynq-obstetrics.js";
import { ageBandOf, BAND } from "../wardsynq/wardsynq-paediatrics.js";
import { KIND, TIER, authoriseWrite } from "../wardsynq/wardsynq-actors.js";

const T0 = "2026-09-04T02:10:00.000Z";
const at = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();
const okChannel = (sink) => ({ bleep: async (p) => { if (sink) sink.push(p); return { delivered: true }; } });

const vital = (code, value, minutesAfterT0 = 0, over = {}) => Observation({
  patientId: "pat-1", code, value, category: "vital-signs", effectiveAt: at(minutesAfterT0), ...over,
});

/* ==================================================================
 * SCENARIO 1: the deteriorating septic patient, end to end.
 *
 * 02:10 observations are taken. Nobody looks at them until 03:45.
 * ================================================================== */

test("SCENARIO: deterioration to recognition to a bundle whose clock cannot be moved", async () => {
  const clock = { t: Date.parse(T0) };
  const now = () => new Date(clock.t).toISOString();

  /* --- 1. The observations exist. A machine scores them. ------------------------------------- */
  const observations = [
    vital("9279-1", 26), vital("2708-6", 92), vital("80288-4", true),
    vital("8480-6", 96), vital("8867-4", 118), vital("80339-5", "V"), vital("8310-5", 38.7),
  ];
  const patient = { ageYears: 71 };
  const score = news2({ observations, patient, now: now() });

  assert.equal(score.scorable, true);
  assert.equal(score.risk, CLINICAL_RISK.HIGH);
  assert.ok(score.singleParameterThree.length >= 1, "consciousness alone is a red flag here");

  /* --- 2. A prompt is raised. It is NOT a diagnosis and NOT a bundle. ------------------------ */
  const prompts = [];
  const queue = new RecognitionQueue({ now, channels: okChannel(prompts) });
  const screen = screenSepsis({ respiratoryRate: 26, consciousness: "V", systolicBloodPressure: 96, patient });
  const assessment = assessSepsisRecognition({ screen, news2Score: score, at: score.computedAt });

  const raised = await queue.raise({ patientId: "pat-1", assessment });
  assert.equal(raised.raised, true);
  assert.equal(raised.prompt.evidenceAt, score.computedAt, "the clock anchors to when the machine knew");

  /* --- 3. Nobody answers for 95 minutes. It escalates on its own. ---------------------------- */
  clock.t += 20 * 60000;
  const overdue = await queue.sweep();
  assert.equal(overdue.length, 1, "a prompt nobody answered is the dangerous state");

  clock.t += 75 * 60000;   // now 03:45
  const { bundleInput, prompt: answered } = queue.accept(raised.prompt.id, { clinicianId: "dr-1", outcome: "agreed" });
  assert.equal(Math.round(answered.recognitionDelayMinutes), 95,
    "the interval between a machine noticing and a human deciding is now a number, which it is nowhere else");

  /* --- 4. The bundle cannot be started at a flattering time, in either direction. ------------ */
  assert.throws(
    () => new EmergencyBundle({ ...bundleInput, timeZero: at(90), now: at(95) }),
    (e) => e instanceof EmergencyError && e.code === "TIME_ZERO_AFTER_EVIDENCE",
    "moving time zero forward is what turns a two-hour wait into a compliant one-hour bundle");

  const bundle = new EmergencyBundle({ ...bundleInput, timeZero: T0, now: at(95) });
  assert.equal(bundle.status(at(95)).state, "breached",
    "the honest bundle is already breached before the first antibiotic is drawn up");

  /* --- 5. The antibiotic is completed by a BEDSIDE SCAN, not by a claim. --------------------- */
  const bus = new ClinicalEventBus();
  const binder = new BundleBinder({
    bus, now: () => at(100),
    bindings: [
      { code: CODE.SEPSIS, element: "antibiotics", drugCodes: ["PIPTAZ"] },
      { code: CODE.SEPSIS, element: "lactate", observationCodes: ["2524-7"] },
    ],
  });
  binder.watch(bundle);
  binder.start();

  const emar = new MedicationAdministrationRecord({ bus, safetyCheck: async () => ({ allowed: true, reasons: [] }) });
  const bedsidePatient = Patient({ id: "pat-1", mrn: "MRN-1", name: "Test Patient", dob: "1955-02-11", wristbandBarcode: "WB-1" });
  const order = MedicationOrder({
    patientId: "pat-1", drug: "piperacillin-tazobactam", drugCode: "PIPTAZ", drugBarcode: "DB-1",
    dose: { value: 4.5, unit: "g" }, route: "IV", prescriberId: "dr-1",
  });

  let record = emar.open(order);
  record = await emar.verify(record, "pharm-1");
  record = await emar.dispense(record, "pharm-1");
  assert.equal(bundle.element("antibiotics").done, false, "dispensing is not administering");

  record = await emar.scan(record, {
    order, patient: bedsidePatient, nurseId: "nurse-7",
    scan: { patientBarcode: "WB-1", drugBarcode: "DB-1", dose: { value: 4.5, unit: "g" }, route: "IV" },
  });
  record = await emar.administer(record, { order, nurseId: "nurse-7" });

  const abx = bundle.element("antibiotics");
  assert.equal(abx.done, true);
  assert.equal(abx.provenance, PROVENANCE.DERIVED, "anchored to a wristband and a product barcode");

  /* --- 6. The lab results a lactate. A NORMAL one still completes the element. --------------- */
  await bus.emit("result.finalized", {
    observation: Observation({ patientId: "pat-1", code: "2524-7", value: 1.1, unit: "mmol/L", category: "laboratory", effectiveAt: at(50) }),
  });
  assert.equal(bundle.element("lactate").provenance, PROVENANCE.DERIVED,
    "the element is 'measure lactate', not 'measure a high lactate'");

  /* --- 7. What the compliance report actually says about this bundle. ------------------------ */
  bundle.notApplicable("fluids", { by: "dr-1", reason: "normotensive after the first litre" });
  bundle.notApplicable("vasopressors", { by: "dr-1", reason: "not hypotensive" });
  bundle.complete("cultures", { event: "collected", at: at(40), by: "nurse-7" });

  const prov = provenanceSummary(bundle, at(200));
  assert.equal(prov.state, "breached", "and it stays breached: the patient waited 95 minutes to be looked at");
  assert.equal(prov.derived, 2);
  assert.equal(prov.attested, 1, "cultures is a human act no system observes");

  binder.stop();
});

/* ==================================================================
 * SCENARIO 2: the seams where two correct modules could disagree.
 * ================================================================== */

test("SCENARIO: a postpartum woman is routed to MEOWS and REFUSED by NEWS2, consistently", () => {
  const postpartum = { ageYears: 31, deliveredAt: at(-2 * 24 * 60) };

  // NEWS2 refuses her.
  const score = news2({
    values: { [PARAM.RESP_RATE]: 22, [PARAM.SPO2]: 97, [PARAM.OXYGEN]: false, [PARAM.SYSTOLIC]: 104,
      [PARAM.PULSE]: 112, [PARAM.CONSCIOUSNESS]: "A", [PARAM.TEMPERATURE]: 37.9 },
    patient: postpartum, now: T0,
  });
  assert.equal(score.scorable, false);
  assert.equal(score.code, "OBSTETRIC");

  // And MEOWS accepts her. The two must not both refuse, or she gets nothing at all.
  const chart = meows({
    respiratoryRate: 22, oxygenSaturation: 97, systolicBloodPressure: 104, diastolicBloodPressure: 68,
    pulse: 112, temperature: 37.9, consciousness: "A", urineOutputMlPerHour: 45, proteinuria: "nil",
  }, postpartum, T0);

  assert.equal(chart.applicable, true, "a patient both charts refuse is a patient nothing is watching");
  assert.equal(chart.state, PREG.POSTPARTUM);
  assert.equal(chart.alert, true, "three concurrent yellows");
  assert.match(chart.advice, /compensates well and decompensates late/);

  // And the routing agrees with itself.
  assert.equal(obstetricState(postpartum, T0).state, PREG.POSTPARTUM);
});

test("SCENARIO: a child is refused by NEWS2 and by qSOFA, and the refusals AGREE", () => {
  const child = { ageYears: 6 };
  assert.equal(ageBandOf(child, T0).band, BAND.CHILD);

  const score = news2({ values: { [PARAM.RESP_RATE]: 30 }, patient: child, now: T0 });
  assert.equal(score.code, "NOT_ADULT");
  assert.match(score.reason, /PEWS/);

  const screen = screenSepsis({ respiratoryRate: 30, consciousness: "V", systolicBloodPressure: 80, patient: child });
  assert.equal(screen.result, "unscreenable");
  assert.equal(screen.excludesSepsis, false, "and neither refusal is allowed to read as reassurance");
});

test("SCENARIO: an unscorable patient escalates for being unobserved but does NOT become suspected sepsis", async () => {
  // A seam worth pinning: two modules see the same incomplete observation set and must respond
  // differently. Double-counting one patient as two alerts trains people to ignore both.
  const incomplete = news2({
    values: { [PARAM.RESP_RATE]: 28, [PARAM.SPO2]: 91, [PARAM.OXYGEN]: true, [PARAM.SYSTOLIC]: 92, [PARAM.PULSE]: 124 },
    patient: { ageYears: 68 }, now: T0,
  });
  assert.equal(incomplete.scorable, false);

  const monitor = new DeteriorationMonitor({ now: () => T0, channels: okChannel() });
  const esc = await monitor.assess(incomplete, { patientId: "pat-1" });
  assert.ok(esc, "a patient nobody has fully observed is its own reason to send somebody");
  assert.equal(esc.unscorable, true);

  const recognition = assessSepsisRecognition({ news2Score: incomplete, at: T0 });
  assert.equal(recognition.prompt, false, "and is not ALSO raised as suspected sepsis");
});

/* ==================================================================
 * SCENARIO 3: obstetric haemorrhage, where the measurement is the control.
 * ================================================================== */

test("SCENARIO: postpartum haemorrhage judged by eye cannot cross a threshold, and still prompts", () => {
  const visual = recordBloodLoss({ ml: 700, method: LOSS_METHOD.VISUAL, at: T0, by: "mw-1" });
  const threshold = pphThresholdReached(visual, 1000);
  assert.equal(threshold.reached, null, "unknown, not false");
  assert.match(threshold.reason, /may represent roughly 1400 ml/);
  assert.match(threshold.reason, /treat on clinical state meanwhile/);

  // It still prompts, because waiting for certainty is the error.
  const weighed = recordBloodLoss({ ml: 1400, method: LOSS_METHOD.WEIGHED, at: at(20), by: "mw-1" });
  assert.equal(pphThresholdReached(weighed, 1000).reached, true);
  assert.equal(weighed.category, "major");
  assert.equal(weighed.caution, null, "a measurement carries no doubling caution");
});

/* ==================================================================
 * SCENARIO 4: the AI reads this patient's chart, and the ceiling holds.
 * ================================================================== */

test("SCENARIO: an AI drafts on the deteriorating patient and cannot commit anything", () => {
  const ai = { id: "ai-summariser", kind: KIND.AI, tier: TIER.EXECUTE };  // a forged actor record

  const draft = { resourceType: "ClinicalNote", patientId: "pat-1", status: "draft", text: "Deteriorating; NEWS2 9." };
  assert.equal(authoriseWrite(ai, draft, {}).allowed, true, "drafting is what an AI is for");

  const order = { resourceType: "MedicationOrder", patientId: "pat-1", status: "active", signedBy: "dr-1" };
  const verdict = authoriseWrite(ai, order, {});
  assert.equal(verdict.allowed, false);
  const codes = verdict.reasons.map((r) => r.code);
  assert.ok(codes.includes("EXECUTE_DENIED"));
  assert.ok(codes.includes("NON_HUMAN_SIGNATURE"));

  // And it cannot write to a different chart than the one open, whatever it drafts.
  const wrongChart = { resourceType: "ClinicalNote", patientId: "pat-9", status: "draft" };
  assert.ok(authoriseWrite(ai, wrongChart, { activePatientId: "pat-1" })
    .reasons.some((r) => r.code === "WRONG_CHART"));
});

/* ==================================================================
 * SCENARIO 5: the clinician clicks the number.
 * ================================================================== */

test("SCENARIO: the score on the screen explains itself, including what it refused to use", () => {
  const observations = [
    vital("9279-1", 26, 5), vital("2708-6", 92, 5), vital("80288-4", true, 5),
    vital("8480-6", 96, 200), vital("8867-4", 118, 5), vital("80339-5", "V", 5), vital("8310-5", 38.7, 5),
    vital("8867-4", 40, 5, { category: "device", artifact: true, scoreEligible: false, signalQualityIndex: 18 }),
    vital("8480-6", 130, 400),
  ];
  const now = at(210);
  const score = news2({ observations, patient: { ageYears: 71 }, now });
  assert.equal(score.scorable, true);

  const graph = new LineageGraph({ now: () => now });
  const node = fromNews2(graph, score, { patientId: "pat-1" });
  const explanation = graph.explain(node.id, now);

  assert.equal(explanation.complete, true, "a partial explanation shown as a complete one is worse than none");
  assert.equal(explanation.rawInputs.length, 7);

  // The property a clinician needs and no dashboard shows: this score is as old as its oldest input.
  // The OLDEST input governs. Most of these observations were taken 205 minutes ago, so the score
  // is 205 minutes old even though the newest reading in it is ten minutes old and the arithmetic
  // ran just now. A dashboard showing "updated a moment ago" would be lying about this patient.
  assert.equal(explanation.effectiveAgeMinutes, 205);
  assert.match(explanation.explanation, /this assessment is 205 minutes old/);
  assert.equal(explanation.ownAgeMinutes, 0, "and the calculation itself is brand new");

  // And what was considered and refused is on the record. The future-dated blood pressure is the
  // interesting one: this scenario is what found that the gatherer had no future-time guard, so a
  // reading with a skewed clock became "the latest" and outranked the correct current value.
  assert.ok(explanation.rejected.length >= 1);
  assert.match(explanation.rejected.map((r) => r.reason).join(" "), /in the future/);

  // The artifact reading never appears at all, because scoreable() removed it upstream of gathering.
  assert.equal(score.parameters[PARAM.PULSE].value, 118, "the detached lead reading 40 did not reach the score");

  // If the blood pressure turns out to have been the wrong patient's, this finds what it fed.
  const bpId = score.sources[PARAM.SYSTOLIC].id;
  const impact = graph.impactOf(bpId);
  assert.deepEqual(impact.allAffected, [node.id]);
  assert.match(impact.reading, /anyone who acted on it needs telling/);
});
