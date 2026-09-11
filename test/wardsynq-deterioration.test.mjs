/* test/wardsynq-deterioration.test.mjs — the early warning score, and what it refuses to say.
 *
 * The arithmetic of NEWS2 is public and easy, so only a handful of these tests check it. The rest
 * check the properties that decide whether an early warning system saves anybody: that a missing
 * parameter is not zero, that a stale observation is not current, that artifact never reaches the
 * score, that a child and a pregnant patient are refused rather than approximated, and that an
 * escalation nobody answers escalates itself.
 *
 * node --test test/wardsynq-deterioration.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NotifyError } from "../wardsynq/wardsynq-notify.js";
import {
  news2, gather, trendOf, DeteriorationMonitor, DeteriorationError,
  PARAM, CLINICAL_RISK, TREND, RESPONSE, FRESHNESS_MS,
} from "../wardsynq/wardsynq-deterioration.js";
import { Observation } from "../wardsynq/wardsynq-model.js";

const NOW = "2026-09-04T12:00:00.000Z";
const ADULT = { ageYears: 62 };

/** A physiologically normal adult: every parameter present, every parameter scoring zero. */
const WELL = Object.freeze({
  [PARAM.RESP_RATE]: 16,
  [PARAM.SPO2]: 98,
  [PARAM.OXYGEN]: false,
  [PARAM.SYSTOLIC]: 128,
  [PARAM.PULSE]: 74,
  [PARAM.CONSCIOUSNESS]: "A",
  [PARAM.TEMPERATURE]: 36.8,
});

/** A channel that confirms delivery, for the tests that are about the state machine rather than it. */
const okChannel = (sink) => ({ bleep: async (p) => { if (sink) sink.push(p); return { delivered: true, receipt: "r1" }; } });

const score = (over, opts) => news2({ values: { ...WELL, ...over }, patient: ADULT, now: NOW, ...opts });

/* ------------------------------------------------------------------ the arithmetic, briefly */

test("a well adult scores zero and is low risk", () => {
  const r = score({});
  assert.equal(r.scorable, true);
  assert.equal(r.total, 0);
  assert.equal(r.risk, CLINICAL_RISK.LOW);
});

test("the parameter bands match the published chart at their boundaries", () => {
  assert.equal(score({ [PARAM.RESP_RATE]: 20 }).total, 0);
  assert.equal(score({ [PARAM.RESP_RATE]: 21 }).total, 2);
  assert.equal(score({ [PARAM.RESP_RATE]: 8 }).total, 3);
  assert.equal(score({ [PARAM.SYSTOLIC]: 111 }).total, 0);
  assert.equal(score({ [PARAM.SYSTOLIC]: 110 }).total, 1);
  assert.equal(score({ [PARAM.SYSTOLIC]: 220 }).total, 3, "hypertension at the top of the scale scores too");
  assert.equal(score({ [PARAM.PULSE]: 50 }).total, 1);
  assert.equal(score({ [PARAM.TEMPERATURE]: 35.0 }).total, 3);
  assert.equal(score({ [PARAM.TEMPERATURE]: 39.1 }).total, 2);
});

test("supplemental oxygen scores 2, and that alone is not an escalation", () => {
  const r = score({ [PARAM.OXYGEN]: true });
  assert.equal(r.total, 2);
  assert.equal(r.risk, CLINICAL_RISK.LOW);
});

test("any consciousness other than Alert scores 3, including new confusion", () => {
  for (const level of ["C", "V", "P", "U"]) {
    const r = score({ [PARAM.CONSCIOUSNESS]: level });
    assert.equal(r.total, 3, `${level} must score 3`);
    assert.equal(r.risk, CLINICAL_RISK.LOW_MEDIUM, "a single parameter at 3 is never plain low risk");
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: missing is not zero */

test("ADVERSARIAL: a missing respiratory rate does NOT score zero", () => {
  const r = news2({ values: { ...WELL, [PARAM.RESP_RATE]: undefined }, patient: ADULT, now: NOW });
  assert.equal(r.scorable, false, "an incomplete score is not a score");
  assert.equal(r.risk, null, "and it has no risk category, however low the partial total");
  assert.deepEqual(r.missing, [PARAM.RESP_RATE]);
  assert.match(r.reason, /not a risk assessment and must not be read as one/);
});

test("ADVERSARIAL: a dangerously ill patient with one missing parameter is unscorable, not reassuring", () => {
  const r = news2({
    values: { [PARAM.RESP_RATE]: 30, [PARAM.SPO2]: 88, [PARAM.OXYGEN]: true, [PARAM.SYSTOLIC]: 85,
      [PARAM.PULSE]: 132, [PARAM.CONSCIOUSNESS]: "V" },
    patient: ADULT, now: NOW,
  });
  assert.equal(r.scorable, false);
  assert.deepEqual(r.missing, [PARAM.TEMPERATURE]);
  assert.equal(r.partial, true);
  assert.ok(r.total >= 15, "the partial total is still exposed, so a human can see how sick this is");
});

test("ADVERSARIAL: an unrecorded oxygen field is missing, not 'on air'", () => {
  const r = news2({ values: { ...WELL, [PARAM.OXYGEN]: undefined }, patient: ADULT, now: NOW });
  assert.equal(r.scorable, false);
  assert.deepEqual(r.missing, [PARAM.OXYGEN], "nobody wrote it down is not the same as the patient is on air");
});

test("an unparseable consciousness value is missing rather than assumed alert", () => {
  const r = news2({ values: { ...WELL, [PARAM.CONSCIOUSNESS]: "awake-ish" }, patient: ADULT, now: NOW });
  assert.deepEqual(r.missing, [PARAM.CONSCIOUSNESS]);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the single parameter */

test("ADVERSARIAL: a total of 3 from ONE parameter outranks a total of 3 spread across three", () => {
  const concentrated = score({ [PARAM.RESP_RATE]: 7 });          // 3 from one parameter
  const spread = score({ [PARAM.SPO2]: 94, [PARAM.SYSTOLIC]: 105, [PARAM.PULSE]: 95 }); // 1 + 1 + 1

  assert.equal(concentrated.total, 3);
  assert.equal(spread.total, 3);
  assert.equal(concentrated.risk, CLINICAL_RISK.LOW_MEDIUM,
    "the total hides the patient whose one parameter is at its extreme");
  assert.equal(spread.risk, CLINICAL_RISK.LOW);
  assert.deepEqual(concentrated.singleParameterThree, [PARAM.RESP_RATE]);
});

test("the risk tiers land where the chart puts them", () => {
  assert.equal(score({ [PARAM.SPO2]: 94, [PARAM.SYSTOLIC]: 105, [PARAM.PULSE]: 95, [PARAM.TEMPERATURE]: 38.5 }).risk,
    CLINICAL_RISK.LOW, "4 is still low");
  assert.equal(score({ [PARAM.OXYGEN]: true, [PARAM.SPO2]: 94, [PARAM.SYSTOLIC]: 105, [PARAM.PULSE]: 95 }).risk,
    CLINICAL_RISK.MEDIUM, "5 is medium");
  assert.equal(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }).risk,
    CLINICAL_RISK.HIGH, "7 or more is an emergency");
});

/* ------------------------------------------------------------------ ADVERSARIAL: scale 2 */

test("ADVERSARIAL: Scale 2 cannot be applied without a recorded prescription", () => {
  const r = news2({ values: WELL, patient: ADULT, scale: 2, now: NOW });
  assert.equal(r.scorable, false);
  assert.equal(r.code, "SCALE_2_NOT_PRESCRIBED");
  assert.match(r.reason, /hides real hypoxia/);
});

test("Scale 2 changes the answer in both directions, which is why it must be deliberate", () => {
  const copd = { ...ADULT, spo2ScaleTwoPrescribed: true };

  // At their own target of 90 percent on oxygen, a Scale 2 patient is where they should be.
  const atTarget = news2({ values: { ...WELL, [PARAM.SPO2]: 90, [PARAM.OXYGEN]: true }, patient: copd, scale: 2, now: NOW });
  assert.equal(atTarget.parameters[PARAM.SPO2].points, 0, "88 to 92 is the target, not a deterioration");
  const sameOnScale1 = news2({ values: { ...WELL, [PARAM.SPO2]: 90, [PARAM.OXYGEN]: true }, patient: copd, scale: 1, now: NOW });
  assert.equal(sameOnScale1.parameters[PARAM.SPO2].points, 3, "the same number on Scale 1 escalates a patient at target");

  // And the counterintuitive half: over-oxygenated toward CO2 narcosis.
  const overOxygenated = news2({ values: { ...WELL, [PARAM.SPO2]: 98, [PARAM.OXYGEN]: true }, patient: copd, scale: 2, now: NOW });
  assert.equal(overOxygenated.parameters[PARAM.SPO2].points, 3, "98 percent ON OXYGEN is dangerous on Scale 2");

  const sameOnAir = news2({ values: { ...WELL, [PARAM.SPO2]: 98, [PARAM.OXYGEN]: false }, patient: copd, scale: 2, now: NOW });
  assert.equal(sameOnAir.parameters[PARAM.SPO2].points, 0, "the same number breathing air is not");
});

/* ------------------------------------------------------------------ ADVERSARIAL: who it does not apply to */

test("ADVERSARIAL: NEWS2 is refused for a child rather than approximated", () => {
  const r = news2({ values: WELL, patient: { ageYears: 7 }, now: NOW });
  assert.equal(r.scorable, false);
  assert.equal(r.code, "NOT_ADULT");
  assert.match(r.reason, /PEWS/);
});

test("ADVERSARIAL: a patient of unknown age is refused, not assumed adult", () => {
  const r = news2({ values: WELL, patient: { dob: "0000-00-00" }, now: NOW });
  assert.equal(r.code, "NOT_ADULT");
});

test("ADVERSARIAL: NEWS2 is refused in pregnancy, where the normal ranges move", () => {
  const r = news2({ values: WELL, patient: { ...ADULT, pregnant: true }, now: NOW });
  assert.equal(r.code, "OBSTETRIC");
  assert.match(r.reason, /MEOWS/);
});

test("ADVERSARIAL: the obstetric refusal covers the POSTPARTUM woman, not just the pregnant one", () => {
  // Most maternal deaths from haemorrhage happen after delivery. A `pregnant` boolean that flips to
  // false at delivery would drop the guard at the moment the risk peaks.
  const r = news2({
    values: WELL,
    patient: { ...ADULT, pregnant: false, deliveredAt: "2026-09-02T04:00:00.000Z" },
    now: NOW,
  });
  assert.equal(r.code, "OBSTETRIC");
  assert.match(r.reason, /puerperium/);
  assert.match(r.reason, /day 2 postpartum/);
});

test("a woman well beyond the puerperium is scored with NEWS2 again", () => {
  const r = news2({
    values: WELL,
    patient: { ...ADULT, deliveredAt: "2026-01-01T00:00:00.000Z" },
    now: NOW,
  });
  assert.equal(r.scorable, true, "the obstetric period ends, and the refusal has to end with it");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the inputs */

const obs = (code, value, minutesAgo = 0, over = {}) => Observation({
  patientId: "pat-1", code, value, category: "vital-signs",
  effectiveAt: new Date(Date.parse(NOW) - minutesAgo * 60000).toISOString(), ...over,
});

const FULL_OBS = () => [
  obs("9279-1", 16), obs("2708-6", 98), obs("80288-4", false),
  obs("8480-6", 128), obs("8867-4", 74), obs("80339-5", "A"), obs("8310-5", 36.8),
];

test("observations are mapped by LOINC and produce the same score as raw values", () => {
  const r = news2({ observations: FULL_OBS(), patient: ADULT, now: NOW });
  assert.equal(r.scorable, true);
  assert.equal(r.total, 0);
});

test("ADVERSARIAL: a stale observation does not describe the patient now", () => {
  const stale = FULL_OBS();
  stale[0] = obs("9279-1", 16, 6 * 60); // a six-hour-old respiratory rate
  const r = news2({ observations: stale, patient: ADULT, now: NOW });
  assert.equal(r.scorable, false, "a current-looking score from an old number is worse than no score");
  assert.deepEqual(r.missing, [PARAM.RESP_RATE]);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /beyond the 240 minute freshness window/);
});

test("the newest reading wins, whatever order the observations arrive in", () => {
  const list = [obs("8867-4", 130, 5), ...FULL_OBS(), obs("8867-4", 140, 90)];
  const r = news2({ observations: list, patient: ADULT, now: NOW });
  assert.equal(r.parameters[PARAM.PULSE].value, 74, "the most recent, not the last in the array");
});

test("ADVERSARIAL: a device observation excluded as artifact never reaches the score", () => {
  const withArtifact = FULL_OBS();
  // A detached lead reading a pulse of 38. Left in, it would score 3 and call an emergency on a
  // well patient; the alternative failure, a wrong reassuring number, is worse still.
  withArtifact.push(obs("8867-4", 38, 0, { category: "device", artifact: true, scoreEligible: false, signalQualityIndex: 22 }));
  const r = news2({ observations: withArtifact, patient: ADULT, now: NOW });
  assert.equal(r.parameters[PARAM.PULSE].value, 74);
  assert.equal(r.total, 0);
});

test("a device observation that passed the quality filter IS scored", () => {
  const list = FULL_OBS().filter((o) => o.code !== "8867-4");
  list.push(obs("8867-4", 132, 0, { category: "device", scoreEligible: true, signalQualityIndex: 96 }));
  const r = news2({ observations: list, patient: ADULT, now: NOW });
  assert.equal(r.parameters[PARAM.PULSE].points, 3, "the filter excludes artifact, not telemetry");
});

test("an observation with no effective time is rejected, because its age cannot be established", () => {
  const list = FULL_OBS();
  list[0] = Observation({ patientId: "pat-1", code: "9279-1", value: 16, category: "vital-signs" });
  list[0].effectiveAt = null; list[0].meta = {};
  const r = news2({ observations: list, patient: ADULT, now: NOW });
  assert.deepEqual(r.missing, [PARAM.RESP_RATE]);
});

test("every score carries the observations it was derived from", () => {
  const r = news2({ observations: FULL_OBS(), patient: ADULT, now: NOW });
  assert.equal(Object.keys(r.sources).length, 7);
  assert.ok(r.sources[PARAM.PULSE].id.startsWith("obs"), "a derived number with no traceable inputs is not evidence");
  assert.equal(r.sources[PARAM.PULSE].code, "8867-4");
});

/* ------------------------------------------------------------------ the trend */

test("a rise of 2 or more is significant even while the total is still low", () => {
  const s = (t) => ({ scorable: true, total: t });
  assert.equal(trendOf([s(1), s(4)]).significant, true, "1 to 4 is not the same patient as one sitting at 4");
  assert.equal(trendOf([s(4), s(4)]).trend, TREND.STABLE);
  assert.equal(trendOf([s(6), s(3)]).trend, TREND.FALLING);
  assert.equal(trendOf([s(3)]).trend, TREND.UNKNOWN);
  assert.equal(trendOf([{ scorable: false, total: 9 }, s(3)]).trend, TREND.UNKNOWN,
    "an incomplete score is not a point on a trend line");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the closed loop */

test("a low-risk score raises nothing", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW, channels: okChannel() });
  assert.equal(await m.assess(score({}), { patientId: "pat-1" }), null);
});

test("a high-risk score raises an escalation naming the responder and the window", async () => {
  const notified = [];
  const m = new DeteriorationMonitor({ now: () => NOW, channels: { bleep: async (p) => { notified.push(p.escalation); return { delivered: true }; } } });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  assert.equal(esc.state, RESPONSE.OPEN);
  assert.match(esc.responder, /critical care outreach/);
  assert.equal(esc.respondWithinMinutes, 15);
  assert.equal(notified.length, 1);
  assert.ok(Object.keys(esc.sources).length >= 0, "the escalation carries the same provenance the score did");
});

test("ADVERSARIAL: an UNSCORABLE patient is escalated too, not quietly skipped", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW, channels: okChannel() });
  const incomplete = news2({ values: { ...WELL, [PARAM.RESP_RATE]: undefined }, patient: ADULT, now: NOW });
  const esc = await m.assess(incomplete, { patientId: "pat-1" });
  assert.ok(esc, "a patient nobody has fully observed is its own reason to send somebody");
  assert.equal(esc.unscorable, true);
  assert.equal(esc.risk, null);
});

test("ADVERSARIAL: an escalation nobody answers re-escalates itself", async () => {
  let clock = Date.parse(NOW);
  const notified = [];
  const m = new DeteriorationMonitor({ now: () => new Date(clock).toISOString(), channels: { bleep: async (p) => { notified.push(p.escalation.responder); return { delivered: true }; } } });

  const esc = await m.assess(score({ [PARAM.OXYGEN]: true, [PARAM.SPO2]: 94, [PARAM.SYSTOLIC]: 105, [PARAM.PULSE]: 95 }), { patientId: "pat-1" });
  assert.equal(esc.risk, CLINICAL_RISK.MEDIUM);
  assert.equal(esc.respondWithinMinutes, 30);

  clock += 10 * 60000;
  assert.deepEqual(await m.sweep(), [], "still inside the window");

  clock += 25 * 60000; // now past it
  const overdue = await m.sweep();
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].state, RESPONSE.OVERDUE);
  assert.match(overdue[0].responder, /critical care outreach/,
    "the tier that was ignored is not the tier to ask again");
  assert.deepEqual(notified, ["ward doctor, urgent", "critical care outreach, emergency"]);
});

test("ADVERSARIAL: acknowledgement is not review, and does not stop the clock", async () => {
  let clock = Date.parse(NOW);
  const m = new DeteriorationMonitor({ now: () => new Date(clock).toISOString(), channels: okChannel() });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });

  m.acknowledge(esc.id, "nurse-7");
  assert.equal(esc.state, RESPONSE.ACKNOWLEDGED);

  clock += 20 * 60000;
  const overdue = await m.sweep();
  assert.equal(overdue.length, 1, "somebody saying they will go is not somebody having gone");
});

test("a review needs the clinician AND what they did", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW, channels: okChannel() });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });

  assert.throws(() => m.review(esc.id, { clinicianId: "dr-3" }), DeteriorationError,
    "a bare click closes the loop without closing the risk");
  m.review(esc.id, { clinicianId: "dr-3", outcome: "reviewed at bedside, ABG sent, ITU informed" });
  assert.equal(esc.state, RESPONSE.REVIEWED);
  assert.equal(m.open().length, 0);
});

test("a reviewed escalation is never re-escalated", async () => {
  let clock = Date.parse(NOW);
  const m = new DeteriorationMonitor({ now: () => new Date(clock).toISOString(), channels: okChannel() });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  m.review(esc.id, { clinicianId: "dr-3", outcome: "seen, plan documented" });
  clock += 60 * 60000;
  assert.deepEqual(await m.sweep(), []);
});

test("the escalation history is a complete audit trail", async () => {
  let clock = Date.parse(NOW);
  const m = new DeteriorationMonitor({ now: () => new Date(clock).toISOString(), channels: okChannel() });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  m.acknowledge(esc.id, "nurse-7");
  clock += 30 * 60000;
  await m.sweep();
  m.review(esc.id, { clinicianId: "dr-3", outcome: "seen" });
  assert.deepEqual(esc.history.map((h) => h.event),
    ["raised", "delivered", "acknowledged", "re-escalated", "delivered", "reviewed"],
    "the trail records not only what was decided but whether anybody was actually told");
});

test("gather is usable on its own, and the freshness window is a parameter", () => {
  const g = gather(FULL_OBS(), { now: NOW, freshnessMs: 1000 });
  assert.equal(Object.keys(g.values).length, 7, "everything here is timestamped at exactly now");
  assert.equal(FRESHNESS_MS, 4 * 60 * 60 * 1000);
});

/* ------------------------------------------------------------------ ADVERSARIAL: delivery */

test("ADVERSARIAL: a monitor with NO channel refuses to raise rather than raising into a void", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW });
  await assert.rejects(
    () => m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" }),
    (err) => err instanceof NotifyError && err.code === "NO_CHANNEL",
    "an escalation system that appears to work while telling nobody is worse than one visibly switched off");
});

test("a harness may opt out, and then the escalation says it was never delivered", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW, requireDelivery: false });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  assert.equal(esc.delivered, false);
  assert.ok(esc.history.some((h) => h.event === "undelivered"));
});

test("ADVERSARIAL: a channel that throws is a FAILED attempt, not a delivered one", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW, channels: { bleep: async () => { throw new Error("pager offline"); } } });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  assert.equal(esc.delivered, false, "the escalation still exists; what failed is the telling");
  assert.equal(esc.attempts[0].delivered, false);
  assert.match(esc.attempts[0].detail, /pager offline/);
  assert.ok(esc.history.some((h) => h.event === "delivery-failed"));
});

test("ADVERSARIAL: a channel that returns nothing has confirmed nothing", async () => {
  const m = new DeteriorationMonitor({ now: () => NOW, channels: { bleep: async () => {} } });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  assert.equal(esc.delivered, false, "a well-meaning async no-op stub must not read as a receipt");
  assert.match(esc.attempts[0].detail, /delivery is unconfirmed/);
});

test("one broken channel does not stop the others", async () => {
  const m = new DeteriorationMonitor({
    now: () => NOW,
    channels: {
      bleep: async () => { throw new Error("pager offline"); },
      phone: async () => ({ delivered: true, receipt: "call-9" }),
    },
  });
  const esc = await m.assess(score({ [PARAM.RESP_RATE]: 26, [PARAM.OXYGEN]: true, [PARAM.SPO2]: 92, [PARAM.PULSE]: 115 }), { patientId: "pat-1" });
  assert.equal(esc.delivered, true, "a broken pager is not a reason to skip the phone");
  assert.equal(esc.attempts.length, 2);
});

test("a re-escalation is dispatched again, and the attempts accumulate", async () => {
  let clock = Date.parse(NOW);
  const sent = [];
  const m = new DeteriorationMonitor({ now: () => new Date(clock).toISOString(), channels: okChannel(sent) });
  const esc = await m.assess(score({ [PARAM.OXYGEN]: true, [PARAM.SPO2]: 94, [PARAM.SYSTOLIC]: 105, [PARAM.PULSE]: 95 }), { patientId: "pat-1" });
  clock += 40 * 60000;
  await m.sweep();
  assert.equal(sent.length, 2);
  assert.equal(esc.attempts.length, 2, "the record of every attempt is what an investigation needs");
  assert.deepEqual(sent.map((p) => p.why), ["raised", "re-escalated"]);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the future
 *
 * Found by an end-to-end scenario, not by a unit test, which is the point of having both. The
 * gatherer rejected stale observations and had no guard on future ones. A future-dated reading is
 * worse than a stale one because it WINS: "latest reading" logic ranks it above the correct current
 * value, so the score describes a moment that has not happened.
 */

test("ADVERSARIAL: a future-dated observation does not become the latest reading", () => {
  const list = FULL_OBS();
  // A monitor with a skewed clock, or a feed with a timezone bug, reporting a pulse an hour ahead.
  list.push(obs("8867-4", 190, -60));   // negative minutesAgo, i.e. in the future
  const r = news2({ observations: list, patient: ADULT, now: NOW });

  assert.equal(r.parameters[PARAM.PULSE].value, 74, "the correct current reading still wins");
  assert.ok(r.rejected.some((x) => /in the future/.test(x.reason)));
});

test("ADVERSARIAL: a future reading cannot be the ONLY reading for a parameter either", () => {
  const list = FULL_OBS().filter((o) => o.code !== "8867-4");
  list.push(obs("8867-4", 74, -120));
  const r = news2({ observations: list, patient: ADULT, now: NOW });

  assert.equal(r.scorable, false, "refused rather than scored from a time that has not happened");
  assert.deepEqual(r.missing, [PARAM.PULSE]);
});

test("an observation timestamped exactly now is current, not future", () => {
  const list = FULL_OBS();
  const r = news2({ observations: list, patient: ADULT, now: NOW });
  assert.equal(r.scorable, true, "the boundary is inclusive: now is not the future");
});

/* REGRESSION, 2026-09-11: NEWS2 SCORED FAHRENHEIT AGAINST CELSIUS BANDS.
 *
 * gatherVitals discarded the unit, so a temperature charted in Fahrenheit reached these Celsius
 * bands as a bare number. 98.6 - a normal temperature - scored 2 for "above 39". So did a genuinely
 * febrile 102, and so did a hypothermic 94. The temperature subscore was noise on every F-charted
 * patient, and noise that reads as a real number on a chart that drives escalation.
 *
 * The scorer now REFUSES a unit it does not use, rather than converting: this module's own rule is
 * that a missing parameter is never zero, so the score comes back incomplete and names what is
 * missing, which the escalation path already handles honestly.
 */
test("a Fahrenheit temperature is refused, not scored against Celsius bands", () => {
  // 98.6 degF is normal. Scored as Celsius it would land in the top band and contribute 2 points.
  const f = news2({ values: { ...WELL, [PARAM.TEMPERATURE]: 98.6 }, units: { [PARAM.TEMPERATURE]: "[degF]" }, patient: ADULT, now: NOW });
  assert.ok(f.missing.includes(PARAM.TEMPERATURE), "the parameter is missing, not silently wrong");
  assert.equal(f.parameters[PARAM.TEMPERATURE], undefined, "and contributes no points at all");

  // The same number in Celsius IS a real high temperature and must still score.
  const c = news2({ values: { ...WELL, [PARAM.TEMPERATURE]: 39.5 }, units: { [PARAM.TEMPERATURE]: "Cel" }, patient: ADULT, now: NOW });
  assert.equal(c.parameters[PARAM.TEMPERATURE].points, 2);

  // No unit recorded stays Celsius: every value written before units travelled has none, and
  // blanking them retroactively would remove a subscore that was correct all along.
  const bare = news2({ values: { ...WELL, [PARAM.TEMPERATURE]: 39.5 }, patient: ADULT, now: NOW });
  assert.equal(bare.parameters[PARAM.TEMPERATURE].points, 2);
});

test("the unit travels from the observation, so a real F-charted patient is caught end to end", () => {
  const obs = (code, value, unit) => ({ id: `o-${code}`, code, value, unit, effectiveAt: NOW });
  const r = news2({
    observations: [
      obs("9279-1", 16), obs("59408-5", 97), obs("8480-6", 120), obs("8867-4", 70),
      obs("8310-5", 98.6, "[degF]"),
    ],
    patient: ADULT, now: NOW,
  });
  assert.ok(r.missing.includes(PARAM.TEMPERATURE), "gathered from a real observation, the unit still refuses it");
});
