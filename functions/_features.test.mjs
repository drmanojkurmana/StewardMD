import assert from "node:assert";
import test from "node:test";
import { featureAllowed, featuresOn, featureKeys, registryEntry } from "../functions/_features.js";

test("featuresOn default off", () => {
  assert.equal(featuresOn({}), false);
  assert.equal(featuresOn({ FEATURES_ON: "1" }), true);
});
test("registry has the seed keys", () => {
  const keys = featureKeys();
  ["thorex_llm", "kardiox_ecg19", "scribe_dictation", "lab_watch", "case_sync", "ward_sync", "fundx", "kardiox", "thorex"].forEach((k) => assert.ok(keys.indexOf(k) >= 0, "missing " + k));
  assert.ok(registryEntry("fundx").experimental, "fundx is experimental");
});
test("explicit per-user flag wins (true and false)", () => {
  assert.equal(featureAllowed({}, { featureFlags: { thorex_llm: false } }, "thorex_llm", "physician"), false);
  assert.equal(featureAllowed({}, { featureFlags: { kardiox_ecg19: true } }, "kardiox_ecg19", "student"), true);
});
test("legacy premiumModels honored", () => {
  assert.equal(featureAllowed({}, { premiumModels: { kardiox_ecg19: true } }, "kardiox_ecg19", "student"), true);
});
test("defaultOn feature on for everyone incl no-role", () => {
  assert.equal(featureAllowed({}, {}, "thorex_llm", null), true);
  assert.equal(featureAllowed({}, {}, "case_sync", null), true);
});
test("defaultRoles gates by role", () => {
  assert.equal(featureAllowed({}, {}, "scribe_dictation", "physician"), true);
  assert.equal(featureAllowed({}, {}, "scribe_dictation", "student"), false);
  assert.equal(featureAllowed({}, {}, "kardiox_ecg19", "physician"), false);   // admin-only, no default role
});
test("env overrides: FEATURE_<KEY>_ROLES and _DEFAULT_ON", () => {
  assert.equal(featureAllowed({ FEATURE_SCRIBE_DICTATION_ROLES: "student" }, {}, "scribe_dictation", "student"), true);
  assert.equal(featureAllowed({ FEATURE_KARDIOX_ECG19_DEFAULT_ON: "1" }, {}, "kardiox_ecg19", null), true);
});
test("unknown key -> false", () => {
  assert.equal(featureAllowed({}, {}, "nope", "physician"), false);
});
