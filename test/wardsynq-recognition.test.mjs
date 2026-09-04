/* test/wardsynq-recognition.test.mjs — the interval nobody measures.
 *
 * The point of these tests is the end-to-end one near the bottom: a prompt raised at 02:10 must make
 * it impossible to open a bundle at 03:45 that claims time zero of 03:40. Everything above it is the
 * machinery that has to hold for that to be true.
 *
 * node --test test/wardsynq-recognition.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROMPT, RecognitionError, RecognitionQueue, assessSepsisRecognition,
} from "../wardsynq/wardsynq-recognition.js";
import { screenSepsis, EmergencyBundle, EmergencyError, CODE } from "../wardsynq/wardsynq-emergency.js";
import { NotifyError } from "../wardsynq/wardsynq-notify.js";
import { CLINICAL_RISK } from "../wardsynq/wardsynq-deterioration.js";

const T0 = "2026-09-04T02:10:00.000Z";
const at = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();

const ok = () => ({ bleep: async () => ({ delivered: true }) });
const queue = (over) => {
  const state = { clock: Date.parse(T0) };
  const q = new RecognitionQueue({ now: () => new Date(state.clock).toISOString(), channels: ok(), ...over });
  q.advance = (m) => { state.clock += m * 60000; };
  return q;
};

const POSITIVE = { screen: screenSepsis({ respiratoryRate: 24, consciousness: "V", systolicBloodPressure: 96 }) };
const HIGH_NEWS = { news2Score: { scorable: true, total: 8, risk: CLINICAL_RISK.HIGH, computedAt: T0 } };

/* ------------------------------------------------------------------ what warrants a prompt */

test("a positive qSOFA warrants a prompt", () => {
  const a = assessSepsisRecognition({ ...POSITIVE, at: T0 });
  assert.equal(a.prompt, true);
  assert.equal(a.strength, "screen-positive");
});

test("a high NEWS2 warrants a prompt on its own, because qSOFA is insensitive", () => {
  const a = assessSepsisRecognition({ ...HIGH_NEWS });
  assert.equal(a.prompt, true);
  assert.equal(a.strength, "high");
  assert.equal(a.evidenceAt, T0, "the evidence time is the score's, not the prompt's");
});

test("a well patient warrants nothing", () => {
  const a = assessSepsisRecognition({
    screen: screenSepsis({ respiratoryRate: 14, consciousness: "A", systolicBloodPressure: 124 }),
    news2Score: { scorable: true, total: 0, risk: CLINICAL_RISK.LOW, computedAt: T0 },
  });
  assert.equal(a.prompt, false);
});

test("ADVERSARIAL: an UNSCORABLE patient is not turned into suspected sepsis", () => {
  const a = assessSepsisRecognition({ news2Score: { scorable: false, total: 9, risk: null } });
  assert.equal(a.prompt, false,
    "the deterioration monitor already escalates them for being unobserved; double-counting trains people to ignore both");
});

/* ------------------------------------------------------------------ the prompt */

test("a prompt is raised, delivered, and records why", async () => {
  const q = queue();
  const r = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  assert.equal(r.raised, true);
  assert.equal(r.prompt.state, PROMPT.OPEN);
  assert.equal(r.prompt.delivered, true);
  assert.match(r.prompt.reasons[0], /qSOFA 3 of 3/);
});

test("ADVERSARIAL: raisedAt and evidenceAt cannot be reassigned", async () => {
  const q = queue();
  const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  assert.throws(() => { prompt.raisedAt = at(90); }, TypeError);
  assert.throws(() => { prompt.evidenceAt = at(90); }, TypeError);
});

test("ADVERSARIAL: a queue with no channel refuses to raise", async () => {
  const q = new RecognitionQueue({ now: () => T0 });
  await assert.rejects(
    () => q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) }),
    (e) => e instanceof NotifyError && e.code === "NO_CHANNEL");
});

test("a second prompt for a patient who already has one open does NOT stack", async () => {
  const q = queue();
  await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  q.advance(5);
  const second = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: at(5) }) });
  assert.equal(second.raised, false);
  assert.match(second.reason, /already open and unanswered/);
  assert.equal(q.prompts.length, 1, "two open prompts for one patient is how a queue becomes noise");
});

test("a STRONGER signal supersedes the open prompt rather than stacking beside it", async () => {
  const q = queue();
  const first = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  q.advance(5);
  const second = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...HIGH_NEWS }) });
  assert.equal(second.raised, true);
  assert.equal(first.prompt.state, PROMPT.SUPERSEDED);
  assert.equal(q.unanswered().length, 1);
});

test("an answered prompt suppresses a repeat inside the refractory period", async () => {
  const q = queue({ refractoryMinutes: 120 });
  const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  q.decline(prompt.id, { clinicianId: "dr-1", reason: "post-operative fever, source identified, not septic" });

  q.advance(30);
  const again = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: at(30) }) });
  assert.equal(again.raised, false, "asking again within the hour trains clinicians to stop reading prompts");

  q.advance(150);
  const later = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: at(180) }) });
  assert.equal(later.raised, true, "but the patient is still deteriorating hours later, so it asks again");
});

/* ------------------------------------------------------------------ answering */

test("ADVERSARIAL: declining requires a clinical reason", async () => {
  const q = queue();
  const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  assert.throws(() => q.decline(prompt.id, { clinicianId: "dr-1" }),
    (e) => e instanceof RecognitionError && e.code === "NO_REASON");
  assert.throws(() => q.decline(prompt.id, { reason: "not septic" }), (e) => e.code === "NO_CLINICIAN");
});

test("declining is a legitimate answer and is kept with its author and reason", async () => {
  const q = queue();
  const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  q.advance(4);
  const p = q.decline(prompt.id, { clinicianId: "dr-1", reason: "known AF with rapid ventricular response, no infective source" });
  assert.equal(p.state, PROMPT.DECLINED);
  assert.equal(p.answeredBy, "dr-1");
  assert.match(p.declineReason, /no infective source/);
  assert.ok(p.history.some((h) => h.event === "declined"));
});

test("a prompt can only be answered once", async () => {
  const q = queue();
  const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  q.decline(prompt.id, { clinicianId: "dr-1", reason: "not septic" });
  assert.throws(() => q.accept(prompt.id, { clinicianId: "dr-2" }), (e) => e.code === "NOT_OPEN");
});

/* ------------------------------------------------------------------ the unanswered queue */

test("an unanswered prompt goes overdue and escalates, once", async () => {
  const q = queue({ answerWithinMinutes: 15 });
  await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });

  q.advance(10);
  assert.deepEqual(await q.sweep(), []);
  assert.equal(q.unanswered()[0].overdue, false);

  q.advance(10);
  const fired = await q.sweep();
  assert.equal(fired.length, 1);
  assert.ok(fired[0].history.some((h) => h.event === "escalated"));
  assert.deepEqual(await q.sweep(), [], "escalated once, not turned into a stream");
});

test("the stats report the unanswered ones too, because the flattering number is the wrong one", async () => {
  const q = queue();
  const a = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  await q.raise({ patientId: "pat-2", assessment: assessSepsisRecognition({ ...POSITIVE, at: T0 }) });
  q.advance(6);
  q.decline(a.prompt.id, { clinicianId: "dr-1", reason: "not septic" });
  q.advance(54);

  const s = q.recognitionStats();
  assert.equal(s.raised, 2);
  assert.equal(s.declined, 1);
  assert.equal(s.stillOpen, 1);
  assert.equal(s.medianAnswerMinutes, 6);
  assert.equal(Math.round(s.longestUnansweredMinutes), 60,
    "a patient a machine flagged an hour ago and no human has looked at");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the whole point */

test("ADVERSARIAL: accepting a prompt makes it impossible to back-date the bundle past it", () => {
  const state = { clock: Date.parse(T0) };
  const q = new RecognitionQueue({ now: () => new Date(state.clock).toISOString(), channels: ok() });

  return (async () => {
    // 02:10. The machine notices.
    const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...HIGH_NEWS }) });
    assert.equal(prompt.evidenceAt, T0);

    // 03:45. A human finally answers.
    state.clock += 95 * 60000;
    const { bundleInput, prompt: answered } = q.accept(prompt.id, { clinicianId: "dr-1", outcome: "agreed, starting Code Sepsis" });
    assert.equal(Math.round(answered.recognitionDelayMinutes), 95,
      "the interval between a machine noticing and a human deciding is now a number");

    // The attempt: open the bundle claiming recognition five minutes ago, which would make a
    // one-hour antibiotic target comfortably achievable and the record say the hospital did well.
    assert.throws(
      () => new EmergencyBundle({ ...bundleInput, timeZero: at(90), now: at(95) }),
      (e) => e instanceof EmergencyError && e.code === "TIME_ZERO_AFTER_EVIDENCE",
      "the prompt is what makes the emergency module's refusal bite");
    // And the other direction is still refused, so there is no way out on either side.
    assert.throws(
      () => new EmergencyBundle({ ...bundleInput, timeZero: at(-30), now: at(95) }),
      (e) => e.code === "TIME_ZERO_BEFORE_EVIDENCE");

    // The honest bundle: time zero is when the patient was deteriorating, and it is already late.
    const b = new EmergencyBundle({ ...bundleInput, timeZero: T0, now: at(95) });
    assert.equal(b.timeZero, T0);
    const s = b.status(at(95));
    assert.equal(s.state, "breached", "and it is breached before the first antibiotic is even drawn up");
    assert.ok(s.breaches.includes("antibiotics"));
  })();
});

test("a bundle opened from an accepted prompt carries the prompt id, so the chain is traceable", async () => {
  const q = queue();
  const { prompt } = await q.raise({ patientId: "pat-1", assessment: assessSepsisRecognition({ ...HIGH_NEWS }) });
  q.advance(3);
  const { bundleInput } = q.accept(prompt.id, { clinicianId: "dr-1" });
  const b = new EmergencyBundle({ ...bundleInput, timeZero: T0, now: at(3) });
  assert.equal(b.evidence.promptId, prompt.id);
  assert.equal(b.startedBy, "dr-1");
  assert.equal(b.code, CODE.SEPSIS);
});
