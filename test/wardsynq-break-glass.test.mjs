/* test/wardsynq-break-glass.test.mjs — emergency access, on the record. Pure half.
 *
 * node --test test/wardsynq-break-glass.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MINUTES, MAX_MINUTES, EMERGENCY_SCOPE, BreakGlassGrant, grantIdFor, isActive, minutesFor,
} from "../functions/_wardsynq/break-glass.js";

const T0 = Date.parse("2026-09-07T09:00:00.000Z");
const grant = (over) => BreakGlassGrant({
  id: "g1", patientId: "p1", actorId: "cfa:doc", reason: "Unresponsive in resus, no notes available.",
  grantedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 60 * 60000).toISOString(), ...(over || {}),
});

test("EXPIRY IS COMPUTED, never stored: a grant lapses on its own", () => {
  const g = grant();
  assert.equal(isActive(g, T0 + 60000), true, "a minute in");
  assert.equal(isActive(g, T0 + 59 * 60000), true, "a minute before it lapses");
  assert.equal(isActive(g, T0 + 60 * 60000), false, "exactly at expiry it is over");
  assert.equal(isActive(g, T0 + 10 * 3600000), false, "and hours later, certainly");
  // A stored "active: true" would be a lie the moment the clock passed it, which is why the record
  // carries only the timestamps.
  assert.equal("active" in g, false);
});

test("a revoked grant is dead immediately, whatever its expiry says", () => {
  const revoked = grant({ revokedAt: new Date(T0 + 5 * 60000).toISOString(), revokedBy: "cfa:admin" });
  assert.equal(isActive(revoked, T0 + 6 * 60000), false);
  assert.equal(isActive(revoked, T0 + 60000), false, "revocation is not retroactively negotiable");
  // A grant with no expiry at all is never active: absence of a limit is not an unlimited licence.
  assert.equal(isActive(grant({ expiresAt: null }), T0), false);
  assert.equal(isActive(grant({ expiresAt: "not a date" }), T0), false);
  assert.equal(isActive(null, T0), false);
});

test("TIME-BOXED AND SHORT: a caller cannot ask for a week", () => {
  assert.equal(minutesFor(30), 30);
  assert.equal(minutesFor(MAX_MINUTES + 1), MAX_MINUTES, "clamped, not refused: the emergency is real");
  assert.equal(minutesFor(60 * 24 * 7), MAX_MINUTES);
  // Nonsense falls back to the default rather than to something unbounded.
  for (const bad of [0, -5, "abc", null, undefined, NaN, Infinity]) assert.equal(minutesFor(bad), DEFAULT_MINUTES, String(bad));
  assert.ok(MAX_MINUTES <= 240, "an 'emergency' measured in days is a privilege grant");
});

test("one grant per actor, patient and declaration instant", () => {
  const a = grantIdFor("cfa:doc", "p1", "2026-09-07T09:00:00.000Z");
  assert.equal(a, grantIdFor("cfa:doc", "p1", "2026-09-07T09:00:00.000Z"));
  assert.notEqual(a, grantIdFor("cfa:other", "p1", "2026-09-07T09:00:00.000Z"), "a second clinician declares their own");
  assert.notEqual(a, grantIdFor("cfa:doc", "p2", "2026-09-07T09:00:00.000Z"), "and one patient at a time");
  // A second emergency later is a SECOND declaration with its own reason, never an extension.
  assert.notEqual(a, grantIdFor("cfa:doc", "p1", "2026-09-07T10:00:00.000Z"));
  assert.equal(grantIdFor("", "p1", "t"), null);
  assert.equal(grantIdFor("cfa:doc", "", "t"), null);
});

test("the emergency scope is enumerated, and it is not everything", () => {
  // What a clinician needs to treat someone in front of them.
  for (const t of ["Patient", "AllergyIntolerance", "MedicationOrder", "Condition", "Observation", "CriticalResultLoop"]) {
    assert.ok(EMERGENCY_SCOPE.includes(t), `${t} must be readable in an emergency`);
  }
  // And what it deliberately is not: the workflow records of other people's shifts, and the audit
  // of who else broke glass. Neither helps the patient in front of you.
  for (const t of ["ShiftHandover", "BreakGlassGrant", "MedicationVerification"]) {
    assert.ok(!EMERGENCY_SCOPE.includes(t), `${t} is not emergency clinical information`);
  }
});

test("the grant counts its own use, so declared-and-never-used is visibly different", () => {
  assert.equal(grant().reads, 0);
  assert.equal(grant({ reads: 40 }).reads, 40);
  assert.equal(BreakGlassGrant({ id: "x", reads: "many" }).reads, 0, "a non-number is not a count");
  // The reason travels on the record itself, not only in a log line somewhere else.
  assert.match(grant().reason, /Unresponsive in resus/);
});
