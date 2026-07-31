/* functions/_ai_usage_email.test.mjs — the AI-console email resolution.
 * gateAndCount records an account email -> the owner report resolves opaque doctor ids to emails,
 * while a doctor's OWN usage summary never carries the email (owner-console-only de-anonymisation). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateAndCount, globalUsageReport, doctorUsageSummary, buildUsageRecord } from "./_ai_usage.js";

function mockKv() {
  const kv = new Map();
  return { get: async (k, t) => { const v = kv.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, put: async (k, v) => { kv.set(k, String(v)); } };
}

test("buildUsageRecord carries a string email, drops non-strings", () => {
  assert.equal(buildUsageRecord({ doctorId: "fb:x", module: "maik", email: "a@b.com" }).email, "a@b.com");
  assert.equal(buildUsageRecord({ doctorId: "fb:x", module: "maik" }).email, null);
  assert.equal(buildUsageRecord({ doctorId: "fb:x", module: "maik", email: 123 }).email, null);
});

test("owner report resolves doctor ids to emails; guests keep the id", async () => {
  const store = mockKv(), env = {}, now = Date.now();
  await gateAndCount(env, store, "maik", "fb:uid_A", "unknown", now, "dr.manoj@gimsr.edu");
  await gateAndCount(env, store, "research", "fb:uid_A", "unknown", now, "dr.manoj@gimsr.edu");
  await gateAndCount(env, store, "maik", "fb:uid_B", "unknown", now, "dr.priya@gimsr.edu");
  await gateAndCount(env, store, "maik", "ip:guest9", "guest", now, null);   // no email
  const rep = await globalUsageReport(env, store, now);
  const byId = Object.fromEntries(rep.topDoctors.map((d) => [d.doctor, d.email]));
  assert.equal(byId["fb:uid_A"], "dr.manoj@gimsr.edu");
  assert.equal(byId["fb:uid_B"], "dr.priya@gimsr.edu");
  assert.equal(byId["ip:guest9"], null);                                     // guest -> no email, UI shows the id
  assert.equal(await store.get("aiu:email:fb:uid_A"), "dr.manoj@gimsr.edu"); // reverse map written
});

test("a doctor's OWN summary never carries the email (privacy)", async () => {
  const store = mockKv(), env = {}, now = Date.now();
  await gateAndCount(env, store, "maik", "fb:uid_A", "unknown", now, "dr.manoj@gimsr.edu");
  const self = await doctorUsageSummary(env, store, "fb:uid_A", now);
  assert.equal("email" in self, false);
  assert.equal(self.byModule.maik, 1);
});
