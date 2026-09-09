/* test/wardsynq-emergency-mode.test.mjs — TASK 4.15: hospital-wide emergency mode. Pure half.
 *
 * node --test test/wardsynq-emergency-mode.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCOPE_LEVELS, DEFAULT_MINUTES, MAX_MINUTES, EmergencyActivation, activationIdFor, isActive,
  isRelaxed, minutesFor,
} from "../functions/_wardsynq/emergency-mode.js";

const T0 = Date.parse("2026-09-09T09:00:00.000Z");
const activation = (over) => EmergencyActivation({
  id: "a1", scope: { level: "org", units: [] }, kind: "mass-casualty", reason: "Multi-vehicle collision, 12 casualties inbound.",
  relaxations: ["triage-priority-override"], declaredBy: "cfa:admin",
  declaredAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 240 * 60000).toISOString(), ...(over || {}),
});

test("EXPIRY IS COMPUTED, never stored: an activation lapses on its own", () => {
  const a = activation();
  assert.equal(isActive(a, T0 + 60000), true);
  assert.equal(isActive(a, T0 + 239 * 60000), true, "a minute before it lapses");
  assert.equal(isActive(a, T0 + 240 * 60000), false, "exactly at expiry it is over");
  assert.equal("active" in a, false, "no stored active flag - the same discipline break-glass.js's own grant uses");
});

test("a revoked activation is dead immediately, whatever its expiry says", () => {
  const revoked = activation({ revokedAt: new Date(T0 + 5 * 60000).toISOString(), revokedBy: "cfa:admin", revokedReason: "false alarm" });
  assert.equal(isActive(revoked, T0 + 6 * 60000), false);
  assert.equal(isActive(revoked, T0 + 60000), false, "revocation is not retroactively negotiable");
  assert.equal(isActive(activation({ expiresAt: null }), T0), false, "no expiry is never active - absence of a limit is not an unlimited licence");
  assert.equal(isActive(null, T0), false);
});

test("TIME-BOXED: a working-shift default, capped at a day - a longer emergency is a re-declaration", () => {
  assert.equal(DEFAULT_MINUTES, 240);
  assert.equal(minutesFor(60), 60);
  assert.equal(minutesFor(MAX_MINUTES + 1000), MAX_MINUTES, "clamped, not refused: the emergency is real");
  for (const bad of [0, -5, "abc", null, undefined, NaN, Infinity]) assert.equal(minutesFor(bad), DEFAULT_MINUTES, String(bad));
  assert.ok(MAX_MINUTES <= 1440, "capped at one day");
});

test("one activation per tenant and declaration instant", () => {
  const a = activationIdFor("org-1", "2026-09-09T09:00:00.000Z");
  assert.equal(a, activationIdFor("org-1", "2026-09-09T09:00:00.000Z"));
  assert.notEqual(a, activationIdFor("org-2", "2026-09-09T09:00:00.000Z"), "a different hospital declares its own");
  assert.notEqual(a, activationIdFor("org-1", "2026-09-09T10:00:00.000Z"), "a second emergency later is a second declaration");
  assert.equal(activationIdFor("", "t"), null);
});

test("scope defaults to org-level, and an unrecognised level falls back rather than being trusted verbatim", () => {
  assert.equal(EmergencyActivation({ id: "x", declaredBy: "y" }).scope.level, "org");
  assert.equal(EmergencyActivation({ id: "x", declaredBy: "y", scope: { level: "planet" } }).scope.level, "org");
  assert.deepEqual(EmergencyActivation({ id: "x", declaredBy: "y", scope: { level: "ward", units: ["Medical A", "ICU"] } }).scope, { level: "ward", units: ["Medical A", "ICU"] });
  assert.ok(SCOPE_LEVELS.includes("dept"));
});

test("isRelaxed: true only under an ACTIVE activation that names this exact relaxation", () => {
  const active = activation();
  const expired = activation({ id: "a2", expiresAt: new Date(T0 - 60000).toISOString() });
  assert.equal(isRelaxed([active], "triage-priority-override", T0 + 60000), true);
  assert.equal(isRelaxed([active], "some-other-thing", T0 + 60000), false, "a relaxation not named is not in force");
  assert.equal(isRelaxed([expired], "triage-priority-override", T0), false, "an expired activation relaxes nothing");
  assert.equal(isRelaxed([], "triage-priority-override", T0), false);
  assert.equal(isRelaxed([active], "", T0), false, "no relaxation named is never true");
});

test("relaxations are a plain hospital-supplied list - structure only, never invented content", () => {
  assert.deepEqual(EmergencyActivation({ id: "x", declaredBy: "y" }).relaxations, [], "no relaxation is claimed unless the hospital names one");
  assert.deepEqual(EmergencyActivation({ id: "x", declaredBy: "y", relaxations: ["a", "b", ""] }).relaxations, ["a", "b"], "blanks are dropped, not counted as a relaxation");
});
