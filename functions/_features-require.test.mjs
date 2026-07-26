import assert from "node:assert";
import test from "node:test";
import { requireFeature } from "../functions/_features.js";

const req = { headers: { get: () => "Bearer x" } };
test("flag off -> allowed (inert)", async () => {
  assert.deepEqual(await requireFeature({}, req, "thorex_llm", { uid: "u1" }), { allowed: true, reason: "flag_off" });
});
test("no uid -> signin_required", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { verifyFirebaseToken: async () => null });
  assert.equal(r.allowed, false); assert.equal(r.reason, "signin_required");
});
test("featureAllowed true -> granted", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { uid: "u1", getEntitlement: async () => ({ role: "physician" }) });
  assert.equal(r.allowed, true); assert.equal(r.reason, "granted");
});
test("per-user disabled -> feature_off", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { uid: "u1", getEntitlement: async () => ({ role: "physician", featureFlags: { thorex_llm: false } }) });
  assert.equal(r.allowed, false); assert.equal(r.reason, "feature_off");
});
test("experimental + valid xaToken -> code (admin OR code)", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "fundx", { uid: "u1", getEntitlement: async () => ({ role: null }), xaToken: "tok", checkActive: async () => ({ active: true }) });
  assert.equal(r.allowed, true); assert.equal(r.reason, "code");
});
test("Firestore error -> fail-open to registry default (defaultOn allows)", async () => {
  const r = await requireFeature({ FEATURES_ON: "1" }, req, "thorex_llm", { uid: "u1", getEntitlement: async () => { throw new Error("fs"); } });
  assert.equal(r.allowed, true);   // thorex_llm defaultOn
});
