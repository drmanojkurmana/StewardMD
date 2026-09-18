/* Role x tier feature matrix. WHY: the ladder only means something if the server can say which of
 * role (verification-derived) and tier (purchase-derived) a feature needs — PG Logbook is a trainee
 * ROLE thing, Scribe is an attending TIER thing, Ward Sync is both. All inert unless ROLE_GATES_ON. */
import assert from "node:assert";
import test from "node:test";
import { matrixAllows, imagingCapFor, oncoTrialState, oncoAiAllowed, featureAllowed, roleGatesOn, requireFeature } from "../functions/_features.js";

const DAY = 86400000, NOW = 1750000000000;
const paid = ["trainee", "coresident", "pro", "physician", "physicianpro"];

test("clinix_all / case_sync / local_ai: any paid tier, free refused", () => {
  ["clinix_all", "case_sync", "local_ai"].forEach((k) => {
    paid.forEach((t) => assert.equal(matrixAllows(k, t, null), true, k + " " + t));
    assert.equal(matrixAllows(k, "free", "physician"), false, k + " free");
  });
});

test("pglog: trainee/coresident tier AND intern|resident role", () => {
  assert.equal(matrixAllows("pglog", "trainee", "resident"), true);
  assert.equal(matrixAllows("pglog", "trainee", "intern"), true);
  assert.equal(matrixAllows("pglog", "coresident", "resident"), true);
  assert.equal(matrixAllows("pglog", "trainee", "student"), false);   // role gate
  assert.equal(matrixAllows("pglog", "physician", "resident"), false); // attending tier
  assert.equal(matrixAllows("pglog", "free", "resident"), false);
});

test("ward_sync: coresident+ , plus trainee only when role=resident", () => {
  ["coresident", "pro", "physician", "physicianpro"].forEach((t) => assert.equal(matrixAllows("ward_sync", t, null), true, t));
  assert.equal(matrixAllows("ward_sync", "trainee", "resident"), true);
  assert.equal(matrixAllows("ward_sync", "trainee", "intern"), false);
  assert.equal(matrixAllows("ward_sync", "free", "resident"), false);
});

test("lab_watch / scribe / followcare / opd_clinic / clinic_hosted", () => {
  assert.equal(matrixAllows("lab_watch", "pro", null), true);
  assert.equal(matrixAllows("lab_watch", "coresident", null), false);
  ["scribe", "followcare", "opd_clinic"].forEach((k) => {
    assert.equal(matrixAllows(k, "physician", null), true, k);
    assert.equal(matrixAllows(k, "physicianpro", null), true, k);
    assert.equal(matrixAllows(k, "pro", null), false, k);
  });
  assert.equal(matrixAllows("clinic_hosted", "physicianpro", null), true);
  assert.equal(matrixAllows("clinic_hosted", "physician", null), false);
});

test("imaging_ai: allowed for all, capped per day by tier, env-overridable", () => {
  assert.equal(matrixAllows("imaging_ai", "free", null), true);
  assert.equal(imagingCapFor({}, { tier: "free" }, NOW), 2);
  assert.equal(imagingCapFor({}, null, NOW), 2);
  assert.equal(imagingCapFor({}, { tier: "trainee", tierExp: NOW + DAY }, NOW), 4);
  assert.equal(imagingCapFor({}, { tier: "coresident", tierExp: NOW + DAY }, NOW), 4);
  assert.ok(imagingCapFor({}, { tier: "pro", tierExp: NOW + DAY }, NOW) > 4);
  assert.equal(imagingCapFor({ IMAGING_CAP_FREE: "7" }, { tier: "free" }, NOW), 7);
  assert.equal(imagingCapFor({}, { tier: "physicianpro", tierExp: NOW - 1 }, NOW), 2);   // expired -> free cap
});

test("onco trial: 3 days from first use, then needs the add-on", () => {
  const fresh = oncoTrialState(null, NOW);
  assert.equal(fresh.active, true);
  assert.equal(fresh.needsStart, true);
  assert.equal(fresh.endsAt, NOW + 3 * DAY);

  const started = oncoTrialState({ oncoTrialStart: NOW - DAY }, NOW);
  assert.equal(started.active, true);
  assert.equal(started.needsStart, false);
  assert.equal(started.endsAt, NOW - DAY + 3 * DAY);

  assert.equal(oncoTrialState({ oncoTrialStart: NOW - 4 * DAY }, NOW).active, false);
});

test("onco_ai: trial OR active add-on", () => {
  assert.equal(oncoAiAllowed({ oncoTrialStart: NOW - DAY }, NOW), true);
  assert.equal(oncoAiAllowed({ oncoTrialStart: NOW - 4 * DAY }, NOW), false);
  assert.equal(oncoAiAllowed({ oncoTrialStart: NOW - 4 * DAY, oncoAddonExp: NOW + DAY }, NOW), true);
  assert.equal(oncoAiAllowed({ oncoTrialStart: NOW - 4 * DAY, oncoAddonExp: NOW - 1 }, NOW), false);
});

test("ROLE_GATES_ON off -> matrix inert, legacy behaviour kept", () => {
  assert.equal(roleGatesOn({}), false);
  assert.equal(roleGatesOn({ ROLE_GATES_ON: "1" }), true);
  // case_sync is defaultOn in the legacy registry: allowed for a free account while the gate is off
  assert.equal(featureAllowed({}, { tier: "free" }, "case_sync", "physician"), true);
  assert.equal(featureAllowed({ ROLE_GATES_ON: "1" }, { tier: "free" }, "case_sync", "physician"), false);
  assert.equal(featureAllowed({ ROLE_GATES_ON: "1" }, { tier: "pro", tierExp: Date.now() + DAY }, "case_sync", "physician"), true);
});

test("per-user featureFlags override still wins over the matrix", () => {
  const env = { ROLE_GATES_ON: "1" };
  assert.equal(featureAllowed(env, { tier: "free", featureFlags: { scribe: true } }, "scribe", null), true);
  assert.equal(featureAllowed(env, { tier: "physicianpro", tierExp: Date.now() + DAY, featureFlags: { scribe: false } }, "scribe", null), false);
});

test("requireFeature: matrix denial only when both flags are on", async () => {
  const req = { headers: { get: () => "Bearer x" } };
  const deps = { uid: "u1", getEntitlement: async () => ({ role: "student", tier: "free" }) };
  assert.equal((await requireFeature({ FEATURES_ON: "1" }, req, "case_sync", deps)).allowed, true);
  assert.equal((await requireFeature({ FEATURES_ON: "1", ROLE_GATES_ON: "1" }, req, "case_sync", deps)).allowed, false);
});
