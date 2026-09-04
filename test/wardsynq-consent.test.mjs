/* test/wardsynq-consent.test.mjs — a signature is not consent.
 *
 * The tests that matter are the ones about power: that refusing treatment cannot be turned into
 * evidence of incapacity, that a relative cannot override a patient's own recorded decision, and
 * that emergency treatment can never be filed as though the patient had agreed to it.
 *
 * node --test test/wardsynq-consent.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABILITY, BASIS, CONSENT_VALID_DAYS, ConsentError,
  assessCapacity, recordRefusal, giveConsent, isValidFor, withdraw,
  recordEmergencyTreatment, consentContext,
} from "../wardsynq/wardsynq-consent.js";

const NOW = "2026-09-04T10:00:00.000Z";
const daysOn = (d) => new Date(Date.parse(NOW) + d * 86_400_000).toISOString();

const ALL_ABILITIES = { understand: true, retain: true, weigh: true, communicate: true };

const fullDisclosure = {
  risksDiscussed: ["bleeding", "infection", "damage to the bile duct"],
  benefitsDiscussed: "resolution of biliary colic",
  alternativesDiscussed: ["medical management", "ERCP"],
  doingNothingDiscussed: true,
  questionsInvited: true,
};

const aConsent = (over) => giveConsent({
  patientId: "pat-1", procedure: "laparoscopic cholecystectomy",
  basis: BASIS.CAPABLE_PATIENT, givenBy: "pat-1", takenBy: "dr-surg",
  ...fullDisclosure, now: NOW, ...over,
});

/* ------------------------------------------------------------------ ADVERSARIAL: capacity and power */

test("ADVERSARIAL: a refusal is NEVER evidence of incapacity", () => {
  const r = recordRefusal({
    patientId: "pat-1", decision: "amputation of the left leg",
    refusedBy: "pat-1", reason: "would rather die with both legs", now: NOW,
  });
  assert.equal(r.binding, true, "an unwise decision is a right that capable people have");
  assert.equal(r.capacityAssessment, null, "a refusal does not trigger, and is not accompanied by, a capacity finding");
  assert.match(r.note, /A refusal is not evidence of incapacity/);
  assert.match(r.note, /reasons others consider unwise/);
});

test("a refusal stays binding when an INDEPENDENT assessment found capacity", () => {
  const cap = assessCapacity({
    patientId: "pat-1", decision: "amputation of the left leg", assessedBy: "dr-psych",
    abilities: ALL_ABILITIES, supportProvided: ["quiet room", "family present"], now: NOW,
  });
  const r = recordRefusal({ patientId: "pat-1", decision: "amputation of the left leg", refusedBy: "pat-1", capacityAssessment: cap, now: NOW });
  assert.equal(r.binding, true);
});

test("ADVERSARIAL: a blanket 'lacks capacity' flag is refused; an assessment names its decision", () => {
  assert.throws(
    () => assessCapacity({ patientId: "pat-1", assessedBy: "dr-1", abilities: ALL_ABILITIES, now: NOW }),
    (e) => e instanceof ConsentError && e.code === "NO_DECISION");
  try {
    assessCapacity({ patientId: "pat-1", assessedBy: "dr-1", abilities: ALL_ABILITIES });
  } catch (e) {
    assert.match(e.message, /may lack it for cardiac surgery and retain it for a blood test/);
  }
});

test("all four functional abilities must be answered, not just the convenient ones", () => {
  assert.throws(
    () => assessCapacity({ patientId: "p", decision: "d", assessedBy: "dr-1", abilities: { understand: true }, now: NOW }),
    (e) => e.code === "INCOMPLETE_ABILITIES");
});

test("ADVERSARIAL: a finding of INCAPACITY cannot stand on a checkbox alone", () => {
  assert.throws(
    () => assessCapacity({
      patientId: "p", decision: "cardiac surgery", assessedBy: "dr-1",
      abilities: { ...ALL_ABILITIES, [ABILITY.WEIGH]: false }, now: NOW,
    }),
    (e) => e.code === "NO_REASON");

  const ok = assessCapacity({
    patientId: "p", decision: "cardiac surgery", assessedBy: "dr-1",
    abilities: { ...ALL_ABILITIES, [ABILITY.WEIGH]: false },
    reason: "acute delirium; unable to relate the proposed operation to her own situation or retain the alternatives across the conversation",
    supportProvided: ["assessed at her best time of day", "hearing aid fitted"], now: NOW,
  });
  assert.equal(ok.hasCapacity, false);
  assert.deepEqual(ok.failedAbilities, [ABILITY.WEIGH]);
});

test("an assessment with no support offered is flagged as incomplete", () => {
  const a = assessCapacity({ patientId: "p", decision: "d", assessedBy: "dr-1", abilities: ALL_ABILITIES, now: NOW });
  assert.match(a.supportNote, /assessed AFTER all practicable support has been offered/);
  const b = assessCapacity({ patientId: "p", decision: "d", assessedBy: "dr-1", abilities: ALL_ABILITIES, supportProvided: ["interpreter"], now: NOW });
  assert.equal(b.supportNote, null);
});

test("the module says plainly that it does not assess capacity", () => {
  const a = assessCapacity({ patientId: "p", decision: "d", assessedBy: "dr-1", abilities: ALL_ABILITIES, now: NOW });
  assert.match(a.note, /Nothing in this system assesses capacity/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the conversation */

test("ADVERSARIAL: consent cannot be recorded without recording what was discussed", () => {
  for (const [omit, expected] of [
    ["risksDiscussed", /risks/],
    ["alternativesDiscussed", /alternatives/],
    ["doingNothingDiscussed", /the option of no treatment/],
  ]) {
    assert.throws(
      () => aConsent({ [omit]: omit === "doingNothingDiscussed" ? false : [] }),
      (e) => e.code === "INCOMPLETE_DISCLOSURE" && expected.test(e.message),
      `omitting ${omit} must be refused`);
  }
});

test("the option of doing nothing is required, because it is the one most often omitted", () => {
  try {
    aConsent({ doingNothingDiscussed: false });
  } catch (e) {
    assert.match(e.message, /evidence of paperwork, not of consent/);
  }
});

test("a complete consent records the conversation, not just the signature", () => {
  const c = aConsent();
  assert.equal(c.basis, BASIS.CAPABLE_PATIENT);
  assert.equal(c.doingNothingDiscussed, true);
  assert.equal(c.questionsInvited, true);
  assert.equal(c.withdrawn, false);
});

/* ------------------------------------------------------------------ ADVERSARIAL: proxies */

const lacksCapacity = assessCapacity({
  patientId: "pat-1", decision: "laparoscopic cholecystectomy", assessedBy: "dr-1",
  abilities: { ...ALL_ABILITIES, understand: false },
  reason: "advanced dementia; unable to retain the nature of the operation", now: NOW,
});

test("a proxy may consent only where capacity was assessed and found lacking FOR THIS DECISION", () => {
  assert.throws(
    () => aConsent({ basis: BASIS.PROXY, proxy: { name: "daughter", relationship: "daughter", authority: "next of kin", actingOnPatientsWishes: true } }),
    (e) => e.code === "NO_CAPACITY_FINDING");
});

test("ADVERSARIAL: a proxy's own preference is not the standard", () => {
  assert.throws(
    () => aConsent({
      basis: BASIS.PROXY, patientCapacity: lacksCapacity,
      proxy: { name: "daughter", relationship: "daughter", authority: "next of kin" },
    }),
    (e) => e.code === "PROXY_SUBSTITUTING_OWN_VIEW");
});

test("ADVERSARIAL: an advance directive OUTRANKS a relative who disagrees with it", () => {
  assert.throws(
    () => aConsent({
      basis: BASIS.PROXY, patientCapacity: lacksCapacity,
      proxy: { name: "son", relationship: "son", authority: "next of kin", actingOnPatientsWishes: true },
      advanceDirective: { appliesTo: "laparoscopic cholecystectomy", valid: true },
    }),
    (e) => e.code === "DIRECTIVE_OUTRANKS_PROXY");
});

test("a properly grounded proxy consent is accepted", () => {
  const c = aConsent({
    basis: BASIS.PROXY, givenBy: null, patientCapacity: lacksCapacity,
    proxy: { name: "daughter", relationship: "daughter", authority: "lasting power of attorney for health and welfare", actingOnPatientsWishes: true },
  });
  assert.equal(c.basis, BASIS.PROXY);
  assert.equal(c.givenBy, "daughter");
  assert.equal(c.proxy.authority, "lasting power of attorney for health and welfare");
});

test("a patient assessed as lacking capacity cannot be the basis for their own consent", () => {
  assert.throws(() => aConsent({ patientCapacity: lacksCapacity }), (e) => e.code === "PATIENT_LACKS_CAPACITY");
});

/* ------------------------------------------------------------------ ADVERSARIAL: validity */

test("ADVERSARIAL: consent does not generalise to a different procedure", () => {
  const c = aConsent();
  const v = isValidFor(c, { procedure: "open cholecystectomy with bile duct exploration", now: NOW });
  assert.equal(v.valid, false);
  assert.match(v.reason, /Consent does not generalise/);
  assert.match(v.reason, /finding something unexpected does not authorise treating it/);
});

test("consent goes stale", () => {
  const c = aConsent();
  assert.equal(isValidFor(c, { procedure: c.procedure, now: daysOn(30) }).valid, true);
  const stale = isValidFor(c, { procedure: c.procedure, now: daysOn(CONSENT_VALID_DAYS + 1) });
  assert.equal(stale.valid, false);
  assert.match(stale.reason, /wishes may have changed/);
});

test("ADVERSARIAL: withdrawal is immediate, needs no reason, and is not a request", () => {
  const c = aConsent();
  withdraw(c, { by: "pat-1", now: daysOn(1) });
  assert.equal(c.withdrawn, true);
  assert.equal(c.withdrawalReason, null, "requiring a reason would make withdrawal something to justify");
  const v = isValidFor(c, { procedure: c.procedure, now: daysOn(1) });
  assert.equal(v.valid, false);
  assert.match(v.reason, /including after the patient is on the table/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: necessity */

test("ADVERSARIAL: emergency treatment can NEVER be recorded as consent", () => {
  assert.throws(
    () => aConsent({ basis: BASIS.NECESSITY }),
    (e) => e instanceof ConsentError && e.code === "NECESSITY_IS_NOT_CONSENT");
});

test("necessity requires BOTH why they could not consent and why it could not wait", () => {
  assert.throws(
    () => recordEmergencyTreatment({ patientId: "p", treatment: "laparotomy", decidedBy: "dr-1", whyCouldNotConsent: "unconscious" }),
    (e) => e.code === "INCOMPLETE_JUSTIFICATION");

  const r = recordEmergencyTreatment({
    patientId: "p", treatment: "laparotomy for control of haemorrhage", decidedBy: "dr-1",
    whyCouldNotConsent: "unconscious on arrival, no proxy contactable",
    whyCannotWait: "actively exsanguinating; delay to locate next of kin would be fatal", now: NOW,
  });
  assert.equal(r.isConsent, false);
  assert.equal(r.basis, BASIS.NECESSITY);
  assert.match(r.note, /This is NOT consent/);
  assert.match(r.note, /limited to what could not wait/);
});

/* ------------------------------------------------------------------ age */

test("an adolescent raises the competence question rather than being answered by age", () => {
  const c = consentContext({ ageYears: 15 }, NOW);
  assert.equal(c.adult, false);
  assert.ok(c.flags.some((f) => /assessed competence rather than age alone/.test(f)));
  assert.ok(c.flags.some((f) => /encodes no jurisdiction's law/.test(f)));
});

test("a young child routes to parental responsibility, named and recorded", () => {
  const c = consentContext({ ageYears: 4 }, NOW);
  assert.ok(c.flags.some((f) => /parental responsibility/.test(f)));
});

test("an unknown age is not assumed to be an adult", () => {
  const c = consentContext({}, NOW);
  assert.equal(c.adult, null);
  assert.match(c.flags[0], /not established/);
});

test("an adult raises nothing", () => {
  assert.deepEqual(consentContext({ ageYears: 44 }, NOW), { adult: true, flags: [] });
});
