/* test/wardsynq-incidents.test.mjs — the reports you never receive.
 *
 * The tests worth reading are the refusals: naming a person as a root cause, closing an incident on
 * retraining alone, and a CAPA with no owner. Those three are how an incident system becomes a
 * filing cabinet that changes nothing while producing excellent statistics about itself.
 *
 * node --test test/wardsynq-incidents.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEVERITY, LIKELIHOOD, STATE, CONTROL_STRENGTH, IncidentError,
  CATEGORY, CONFIRM_OUTCOME,
  sacScore, report, triage, confirm, stageOf, recordRCA, addCAPA, completeCAPA, close, reportingHealth,
} from "../wardsynq/wardsynq-incidents.js";

const NOW = "2026-09-04T09:00:00.000Z";
const later = (h) => new Date(Date.parse(NOW) + h * 3600000).toISOString();

// A CONFIRMED incident: RCA, actions and close all need the signal decided first.
const aSignal = (over) => report({
  what: "Wrong-strength potassium ampoule selected from the resuscitation trolley",
  severity: SEVERITY.NEAR_MISS, reportedBy: "nurse-7", now: NOW, ...over,
});
const anIncident = (over) => confirm(aSignal(over), { outcome: CONFIRM_OUTCOME.CONFIRMED, reason: "reviewed, a real event", category: CATEGORY.MEDICATION_ERROR, by: "safety-lead", now: NOW });

/* ------------------------------------------------------------------ signal -> confirm */

test("a report starts as a SIGNAL, and RCA, actions and close all refuse until it is confirmed", () => {
  const s = aSignal({ source: { resourceType: "SafetyOverride", id: "ovr-1" } });
  assert.equal(stageOf(s), "signal");
  assert.deepEqual(s.source, { resourceType: "SafetyOverride", id: "ovr-1" });
  const cause = "identical ampoules stocked together with no barcode check";
  assert.throws(() => recordRCA(s, { rootCause: cause, conductedBy: "lead", now: NOW }), (e) => e.code === "NOT_CONFIRMED");
  assert.throws(() => addCAPA(s, { action: "Separate stock", owner: "p", dueBy: later(1), now: NOW }), (e) => e.code === "NOT_CONFIRMED");
  assert.throws(() => close(s, { by: "lead", now: NOW }), (e) => e.code === "NOT_CONFIRMED");
  assert.throws(() => aSignal({ source: { resourceType: "Patient", id: "p1" } }), (e) => e.code === "BAD_SOURCE");
  assert.throws(() => aSignal({ category: "bad luck" }), (e) => e.code === "BAD_CATEGORY");
});

test("confirmation: a category is required to confirm, a reason always, a duplicate names the other, and it is decided once", () => {
  assert.throws(() => confirm(aSignal(), { outcome: "confirmed", reason: "real", by: "lead" }), (e) => e.code === "NO_CATEGORY");
  assert.throws(() => confirm(aSignal(), { outcome: "confirmed", category: "fall", by: "lead" }), (e) => e.code === "NO_REASON");
  assert.throws(() => confirm(aSignal(), { outcome: "maybe", reason: "x y z", by: "lead" }), (e) => e.code === "BAD_OUTCOME");
  assert.throws(() => confirm(aSignal(), { outcome: "duplicate", reason: "same event", by: "lead" }), (e) => e.code === "NO_DUPLICATE_OF");
  assert.throws(() => confirm(aSignal(), { outcome: "confirmed", reason: "real", category: "fall" }), (e) => e.code === "NO_ACTOR");

  const dup = confirm(aSignal(), { outcome: "duplicate", duplicateOf: "inc-other", reason: "same fall, second reporter", by: "lead", now: NOW });
  assert.equal(stageOf(dup), "rejected");
  assert.equal(dup.confirmation.duplicateOf, "inc-other");
  assert.throws(() => triage(dup, { likelihood: LIKELIHOOD.RARE, triagedBy: "lead" }), (e) => e.code === "REJECTED");
  assert.throws(() => confirm(dup, { outcome: "confirmed", reason: "changed mind", category: "fall", by: "lead" }), (e) => e.code === "ALREADY_DECIDED");

  const ok = anIncident();
  assert.equal(stageOf(ok), "confirmed");
  assert.equal(ok.category, "medication-error");
  recordRCA(ok, { rootCause: "identical ampoules stocked together with no barcode check", conductedBy: "lead", now: NOW });
  assert.equal(stageOf(ok), "under-investigation");
});

test("the ledger keeps signals, confirmed, root-caused and completed actions apart", () => {
  const withRca = anIncident();
  recordRCA(withRca, { rootCause: "identical ampoules stocked together with no barcode check", conductedBy: "lead", now: NOW });
  const c = addCAPA(withRca, { action: "Separate the stock", owner: "p", dueBy: later(1), strength: "SIMPLIFICATION", now: NOW });
  addCAPA(withRca, { action: "Barcode check at selection", owner: "p", dueBy: later(1), strength: "AUTOMATION", now: NOW });
  completeCAPA(withRca, c.id, { by: "p", evidence: "photo", now: NOW });
  const rejected = confirm(aSignal(), { outcome: "not-an-incident", reason: "expected side effect", by: "lead", now: NOW });
  const h = reportingHealth([aSignal(), aSignal(), anIncident(), withRca, rejected], NOW);
  assert.equal(h.signals, 2);
  assert.equal(h.confirmed, 2);
  assert.equal(h.rejected, 1);
  assert.equal(h.withRootCause, 1);
  assert.equal(h.openCapas, 1);
  assert.equal(h.completedCapas, 1);
});

/* ------------------------------------------------------------------ reporting is made easy */

test("a near miss can be filed with almost nothing, on purpose", () => {
  const i = report({ what: "Nearly gave the wrong patient's insulin", severity: SEVERITY.NEAR_MISS, anonymous: true, now: NOW });
  assert.equal(i.state, STATE.REPORTED);
  assert.equal(i.anonymous, true);
  assert.equal(i.likelihood, null, "asking a reporter at 3am to estimate recurrence is a triage question");
  assert.equal(i.sac, null);
});

test("ADVERSARIAL: an anonymous report is first-class, not degraded", () => {
  const i = report({ what: "Consultant overrode the allergy warning without documenting a reason", severity: SEVERITY.NO_HARM, anonymous: true, now: NOW });
  assert.equal(i.reportedBy, null);
  assert.equal(i.history[0].by, "anonymous");
  // It goes through the entire lifecycle exactly like a named one.
  triage(i, { likelihood: LIKELIHOOD.LIKELY, triagedBy: "safety-lead", now: NOW });
  assert.equal(i.sac.sac, 2);
});

test("a named report needs a reporter; anonymity must be chosen, not defaulted", () => {
  assert.throws(() => report({ what: "something happened", severity: SEVERITY.MINOR }),
    (e) => e instanceof IncidentError && e.code === "NO_REPORTER");
});

test("what happened and how bad it was are both required", () => {
  assert.throws(() => report({ severity: SEVERITY.MINOR, anonymous: true }), (e) => e.code === "NO_DESCRIPTION");
  assert.throws(() => report({ what: "a thing", anonymous: true }), (e) => e.code === "NO_SEVERITY");
  assert.throws(() => report({ what: "a thing", severity: "very bad", anonymous: true }), (e) => e.code === "NO_SEVERITY");
});

/* ------------------------------------------------------------------ ADVERSARIAL: severity is not culpability */

test("ADVERSARIAL: the same error scores differently ONLY on outcome, and carries no blame either way", () => {
  // One nurse's syringe swap is caught by the second check. Another's is not, and the patient dies.
  // Identical system failure, identical human, wildly different luck.
  const caught = sacScore(SEVERITY.NEAR_MISS, LIKELIHOOD.LIKELY);
  const notCaught = sacScore(SEVERITY.CATASTROPHIC, LIKELIHOOD.LIKELY);

  assert.ok(notCaught.sac < caught.sac, "the worse outcome warrants more investigation");
  for (const r of [caught, notCaught]) {
    assert.match(r.response, /analysis|investigation|review/i);
    assert.equal(/blame|fault|disciplin|sanction|culpab/i.test(r.response), false,
      "SAC decides how much investigation an event warrants, never how much blame anybody deserves");
  }
});

test("the SAC matrix bands as expected at its corners", () => {
  assert.equal(sacScore(SEVERITY.CATASTROPHIC, LIKELIHOOD.FREQUENT).sac, 1);
  assert.equal(sacScore(SEVERITY.NEAR_MISS, LIKELIHOOD.RARE).sac, 4);
  assert.equal(sacScore(SEVERITY.MAJOR, LIKELIHOOD.POSSIBLE).sac, 1);
  assert.equal(sacScore(SEVERITY.CATASTROPHIC, LIKELIHOOD.RARE).rcaRequired, true);
  assert.throws(() => sacScore("catastrophic-ish", LIKELIHOOD.RARE), (e) => e.code === "BAD_SAC_INPUT");
});

/* ------------------------------------------------------------------ ADVERSARIAL: root cause */

test("ADVERSARIAL: a person is never a root cause", () => {
  const i = anIncident();
  for (const cause of [
    "Human error",
    "human error by the nurse",
    "Nurse failed to check the label",
    "The doctor forgot to sign the chart",
    "Non-compliance by the staff",
  ]) {
    assert.throws(
      () => recordRCA(i, { rootCause: cause, conductedBy: "safety-lead", now: NOW }),
      (e) => e instanceof IncidentError && e.code === "PERSON_AS_ROOT_CAUSE",
      `"${cause}" must be refused`);
  }
});

test("the refusal says what to do instead, because a bare rejection just gets worked around", () => {
  const i = anIncident();
  try {
    recordRCA(i, { rootCause: "human error", conductedBy: "safety-lead", now: NOW });
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /where an investigation starts, not where it finishes/);
    assert.match(e.message, /Describe the system condition instead/);
  }
});

test("a system condition IS accepted", () => {
  const i = anIncident();
  recordRCA(i, {
    rootCause: "Two concentrations of potassium are stocked in identical ampoules in the same trolley drawer, with no physical separation and no barcode check at the point of selection",
    method: "five whys", conductedBy: "safety-lead", now: NOW,
  });
  assert.equal(i.state, STATE.INVESTIGATING);
  assert.match(i.rca.rootCause, /identical ampoules/);
  assert.equal(i.rca.conductedBy, "safety-lead");
});

test("an RCA is never anonymous, even when the report was", () => {
  const i = report({ what: "wrong ampoule selected", severity: SEVERITY.NO_HARM, anonymous: true, now: NOW });
  assert.throws(() => recordRCA(i, { rootCause: "identical ampoules stocked together with no barcode check" }),
    (e) => e.code === "NO_ACTOR");
});

/* ------------------------------------------------------------------ ADVERSARIAL: actions */

test("ADVERSARIAL: a CAPA with no owner or no date is refused as a wish", () => {
  const i = anIncident();
  assert.throws(() => addCAPA(i, { action: "Separate the ampoule stock" }), (e) => e.code === "NO_OWNER_OR_DATE");
  assert.throws(() => addCAPA(i, { action: "Separate the ampoule stock", owner: "pharmacy-lead" }), (e) => e.code === "NO_OWNER_OR_DATE");
});

test("retraining is DETECTED as weak without being banned", () => {
  const i = anIncident();
  const weak = addCAPA(i, { action: "Retrain all ward nurses on ampoule checking", owner: "ward-manager", dueBy: later(720), now: NOW });
  assert.equal(weak.weak, true);
  assert.equal(weak.strength, "EDUCATION");
  assert.match(weak.strengthLabel, /Education, training, reminders or policy/);

  const strong = addCAPA(i, { action: "Remove concentrated potassium from ward stock entirely", owner: "pharmacy-lead", dueBy: later(720), strength: "FORCING_FUNCTION", now: NOW });
  assert.equal(strong.weak, false);
  assert.match(strong.strengthLabel, /the error becomes impossible/);
});

test("ADVERSARIAL: an incident cannot be CLOSED on retraining alone", () => {
  const i = anIncident();
  triage(i, { likelihood: LIKELIHOOD.POSSIBLE, triagedBy: "safety-lead", now: NOW });
  recordRCA(i, { rootCause: "identical ampoules stocked together with no barcode check at selection", conductedBy: "safety-lead", now: NOW });

  const c1 = addCAPA(i, { action: "Retrain the nursing team", owner: "ward-manager", dueBy: later(1), now: NOW });
  const c2 = addCAPA(i, { action: "Send a reminder email about ampoule checking", owner: "ward-manager", dueBy: later(1), now: NOW });
  completeCAPA(i, c1.id, { by: "ward-manager", evidence: "training log, 24 of 26 staff", now: NOW });
  completeCAPA(i, c2.id, { by: "ward-manager", evidence: "email sent 2026-09-04", now: NOW });

  assert.throws(() => close(i, { by: "safety-lead", now: NOW }),
    (e) => e instanceof IncidentError && e.code === "ALL_ACTIONS_WEAK");

  // Add something that changes the place rather than the person, and it closes.
  const c3 = addCAPA(i, { action: "Remove concentrated potassium from ward stock", owner: "pharmacy-lead", dueBy: later(2), strength: "FORCING_FUNCTION", now: NOW });
  completeCAPA(i, c3.id, { by: "pharmacy-lead", evidence: "stock list and photograph of the trolley", now: NOW });
  close(i, { by: "safety-lead", now: NOW });
  assert.equal(i.state, STATE.CLOSED);
});

test("ADVERSARIAL: an incident cannot be closed with actions still open", () => {
  const i = anIncident();
  triage(i, { likelihood: LIKELIHOOD.RARE, triagedBy: "lead", now: NOW });
  addCAPA(i, { action: "Redesign the trolley layout", owner: "pharmacy-lead", dueBy: later(24), now: NOW });
  assert.throws(() => close(i, { by: "lead", now: NOW }), (e) => e.code === "OPEN_CAPAS");
});

test("ADVERSARIAL: 'done' with no evidence is the same as not done", () => {
  const i = anIncident();
  const c = addCAPA(i, { action: "Redesign the trolley layout", owner: "pharmacy-lead", dueBy: later(24), now: NOW });
  assert.throws(() => completeCAPA(i, c.id, { by: "pharmacy-lead" }), (e) => e.code === "NO_EVIDENCE");
  assert.throws(() => completeCAPA(i, "capa-nope", { by: "x", evidence: "y" }), (e) => e.code === "NO_CAPA");
});

test("a serious incident cannot be closed without an RCA", () => {
  const i = anIncident({ severity: SEVERITY.CATASTROPHIC });
  triage(i, { likelihood: LIKELIHOOD.POSSIBLE, triagedBy: "lead", now: NOW });
  assert.equal(i.sac.rcaRequired, true);
  assert.throws(() => close(i, { by: "lead", now: NOW }), (e) => e.code === "NO_RCA");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the ledger */

test("ADVERSARIAL: a unit reporting only harm is reported as a FAILING reporting system", () => {
  const harmOnly = [
    anIncident({ severity: SEVERITY.MODERATE }),
    anIncident({ severity: SEVERITY.MAJOR }),
    anIncident({ severity: SEVERITY.MINOR }),
  ];
  const h = reportingHealth(harmOnly, NOW);
  assert.equal(h.nearMiss, 0);
  assert.match(h.reading, /That is not a sign of safety/);
  assert.match(h.reading, /reporting system should be treated as failing/);
});

test("a healthy ledger reports the near-miss ratio plainly", () => {
  const mixed = [
    ...Array.from({ length: 12 }, () => anIncident({ severity: SEVERITY.NEAR_MISS })),
    anIncident({ severity: SEVERITY.MINOR }),
    anIncident({ severity: SEVERITY.MODERATE }),
  ];
  const h = reportingHealth(mixed, NOW);
  assert.equal(h.nearMiss, 12);
  assert.equal(h.harm, 2);
  assert.equal(h.nearMissRatio, 6);
  assert.match(h.reading, /12 near misses against 2 events reaching harm/);
});

test("the ledger surfaces overdue actions with their owners", () => {
  const i = anIncident();
  addCAPA(i, { action: "Redesign the trolley", owner: "pharmacy-lead", dueBy: later(1), now: NOW });
  const h = reportingHealth([i], later(48));
  assert.equal(h.overdueCapas.length, 1);
  assert.equal(h.overdueCapas[0].owner, "pharmacy-lead");
  assert.equal(h.openCapas, 1);
});

test("ADVERSARIAL: the ledger reports what proportion of all actions are merely education", () => {
  const i = anIncident();
  addCAPA(i, { action: "Retrain the team", owner: "m", dueBy: later(1), now: NOW });
  addCAPA(i, { action: "Circulate a reminder", owner: "m", dueBy: later(1), now: NOW });
  addCAPA(i, { action: "Awareness session at handover", owner: "m", dueBy: later(1), now: NOW });
  addCAPA(i, { action: "Fit a physical lock to the drawer", owner: "estates", dueBy: later(1), strength: "FORCING_FUNCTION", now: NOW });

  const h = reportingHealth([i], NOW);
  assert.equal(h.weakActionPercent, 75);
  assert.match(h.actionReading, /75 percent of actions are education, retraining or reminders/);
});

test("an empty ledger says nothing rather than something flattering", () => {
  const h = reportingHealth([], NOW);
  assert.equal(h.total, 0);
  assert.equal(h.nearMissRatio, null);
  assert.equal(h.actionReading, null);
});
