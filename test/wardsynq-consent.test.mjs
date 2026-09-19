/* test/wardsynq-consent.test.mjs — what the patient agreed to, and what they refused. Pure half.
 *
 * node --test test/wardsynq-consent.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISIONS, SCOPES, GIVERS, PatientConsent, consentIdFor, statusOf, permits } from "../functions/_wardsynq/consent.js";

const T0 = Date.parse("2026-09-07T09:00:00.000Z");
const c = (over) => PatientConsent({
  id: "c1", patientId: "pat", scope: "share-registry", decision: "granted",
  recordedBy: "cfa:rn", recordedAt: new Date(T0).toISOString(), validFrom: new Date(T0).toISOString(),
  ...(over || {}),
});

test("A REFUSAL IS A CLINICAL FACT, NOT AN ABSENT CONSENT", () => {
  /* "No consent recorded" and "the patient said no" are completely different states, and a system
   * that stores only the yeses cannot tell them apart - so the next person asks again. */
  assert.equal(statusOf(c({ decision: "refused" }), T0), "refused");
  assert.equal(statusOf(null, T0), "not-recorded");
  assert.notEqual(statusOf(c({ decision: "refused" }), T0), statusOf(null, T0));

  // And `permits` never returns a bare boolean: a caller handed `false` cannot tell a refusal from
  // an expiry from a record nobody ever made, and those need different things to happen next.
  const refused = permits([c({ decision: "refused" })], "share-registry", T0);
  assert.equal(refused.permitted, false);
  assert.equal(refused.status, "refused");
  const never = permits([], "share-registry", T0);
  assert.equal(never.permitted, false);
  assert.equal(never.status, "not-recorded");
  assert.equal(never.consent, null);
});

test("CONSENT EXPIRES; IT NEVER LAPSES INTO YES", () => {
  const until = c({ validUntil: new Date(T0 + 3600000).toISOString() });
  assert.equal(statusOf(until, T0 + 60000), "granted");
  // The one direction this never drifts is towards permission.
  assert.equal(statusOf(until, T0 + 3600000), "expired");
  assert.equal(statusOf(until, T0 + 99999999), "expired");
  assert.equal(permits([until], "share-registry", T0 + 3600001).permitted, false);
  // A consent that has not started yet is not a refusal either - it is its own answer.
  assert.equal(statusOf(c({ validFrom: new Date(T0 + 3600000).toISOString() }), T0), "not-yet-valid");
  // No end date means it does not expire, which is a different thing from expiring quietly.
  assert.equal(statusOf(c({ validUntil: null }), T0 + 99999999), "granted");
});

test("withdrawal is immediate, and the original grant survives it", () => {
  const w = c({ decision: "withdrawn", withdrawnAt: new Date(T0 + 60000).toISOString(), withdrawalReason: "Patient changed their mind." });
  assert.equal(statusOf(w, T0 + 120000), "withdrawn");
  // Even at a moment when the grant would still have been live.
  assert.equal(statusOf(w, T0 + 1000), "withdrawn");
  // A record still carrying `granted` but with a withdrawal stamp is withdrawn: the stamp wins.
  assert.equal(statusOf(c({ withdrawnAt: new Date(T0).toISOString() }), T0 + 1000), "withdrawn");
  assert.deepEqual(DECISIONS, ["granted", "refused", "withdrawn"]);
});

test("the most recent decision about a scope is the one that stands", () => {
  const rows = [
    c({ id: "old", decision: "refused", recordedAt: "2026-09-01T09:00:00.000Z" }),
    c({ id: "new", decision: "granted", recordedAt: "2026-09-07T09:00:00.000Z" }),
  ];
  const p = permits(rows, "share-registry", T0);
  assert.equal(p.status, "granted");
  assert.equal(p.consent.consentId, "new");
  // Reversed order in the array must not change the answer.
  assert.equal(permits([...rows].reverse(), "share-registry", T0).consent.consentId, "new");
  // A decision about a DIFFERENT scope never answers this one.
  assert.equal(permits(rows, "research", T0).status, "not-recorded");
});

test("who gave it and whether they had capacity are recorded, never inferred", () => {
  const byGuardian = c({ givenBy: "legal-guardian", giverName: "A Parent", capacity: null });
  assert.equal(byGuardian.givenBy, "legal-guardian");
  assert.equal(byGuardian.giverName, "A Parent");
  /* Capacity is a clinical judgement somebody made. Defaulting it to true because a patient signed
   * something would be asserting a finding nobody recorded, so an unstated capacity stays null. */
  assert.equal(byGuardian.capacity, null);
  assert.equal(PatientConsent({ id: "x", patientId: "p", capacity: true }).capacity, true);
  assert.equal(PatientConsent({ id: "x", patientId: "p", capacity: false }).capacity, false);
  assert.equal(PatientConsent({ id: "x", patientId: "p", capacity: "yes" }).capacity, null, "a non-boolean is not a judgement");
  // An unknown giver falls back to the patient rather than being invented.
  assert.equal(PatientConsent({ id: "x", patientId: "p", givenBy: "the internet" }).givenBy, "patient");
  assert.ok(GIVERS.includes("clinician-emergency"));
});

test("a procedure consent is per procedure, so a second operation cannot overwrite the first", () => {
  const a = consentIdFor("pat", "procedure", "Right total hip replacement");
  const b = consentIdFor("pat", "procedure", "Left total knee replacement");
  assert.notEqual(a, b, "without this the second operation would silently reuse the first's consent");
  assert.equal(a, consentIdFor("pat", "procedure", "  right TOTAL hip replacement "));
  // A general scope is one per patient.
  assert.equal(consentIdFor("pat", "treatment", ""), "wsq-consent-pat-treatment");
  assert.equal(consentIdFor("", "treatment", ""), null);
  assert.equal(consentIdFor("pat", "", ""), null);
});

test("the scope list is closed, so a question can actually be answered later", () => {
  // A free-text scope cannot be queried, and "did this patient consent to research use" would then
  // depend on how somebody typed it. `other` exists so nothing is unrecordable.
  assert.ok(SCOPES["share-registry"] && SCOPES.research && SCOPES["blood-products"] && SCOPES.other);
  assert.equal(PatientConsent({ id: "x", patientId: "p", scope: "whatever" }).scope, "other");
  assert.equal(PatientConsent({ id: "x", patientId: "p", scope: "research" }).scope, "research");
});
