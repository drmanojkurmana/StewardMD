/* test/admin-users.test.mjs - the owner's User control (functions/_admin_users.js).
 * node --test test/admin-users.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listRecentSignups, userDetail, accountRow } from "../functions/_admin_users.js";

const NOW = Date.parse("2026-10-08T12:00:00Z"), DAY = 86400000;
function kvWith(entries) {
  const m = new Map(entries.map(([k, v, md]) => [k, { v, md }]));
  return {
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).md })), list_complete: true }; },
    async get(k, t) { const e = m.get(k); if (!e) return null; return t === "json" ? JSON.parse(e.v) : e.v; },
  };
}
const lc = (uid, daysAgo, extra) => ["lifecycle:u:" + uid, JSON.stringify({ email: uid + "@x.in", name: "Dr " + uid, firstSeen: NOW - daysAgo * DAY, ...(extra || {}) }), { firstSeen: NOW - daysAgo * DAY }];
const fb = (uid, claims, extra) => ({ localId: uid, email: uid + "@x.in", displayName: "Dr " + uid, createdAt: String(NOW - DAY), lastLoginAt: String(NOW), customAttributes: JSON.stringify(claims || {}), providerUserInfo: [{ providerId: "google.com" }], ...(extra || {}) });

const ACCTS = new Map([
  ["new1", fb("new1", {})],
  ["pend", fb("pend", { provUntil: NOW + 5 * DAY })],
  ["doc", fb("doc", { verified: true, pro: true, proExp: NOW + 30 * DAY })],
  ["off", fb("off", {}, { disabled: true })],
]);
const deps = {
  lcKv: kvWith([lc("new1", 0.1), lc("pend", 1.2, { phone: "+919121974928", phoneVerifiedAt: NOW - DAY }), lc("doc", 3), lc("off", 5), lc("old", 90)]),
  verifyKv: kvWith([["icu:doctor:pend", JSON.stringify({ status: "pending", reason: "no_nmc_match", role: "doctor", extractedName: "SIVA NAGA SRAVANI YARRARAPU", extractedRegNo: "100286", council: "Delhi Medical Council", confidence: 0.95, photoKey: "verify/pend" })]]),
  lookupAccounts: async (env, uids) => new Map(uids.filter((u) => ACCTS.has(u)).map((u) => [u, ACCTS.get(u)])),
};

test("newest sign-ups first, only inside the window, with counts", async () => {
  const r = await listRecentSignups({}, { now: NOW, days: 30 }, deps);
  assert.deepEqual(r.users.map((u) => u.uid), ["new1", "pend", "doc", "off"], "newest first; the 90-day-old account is outside 30 days");
  assert.deepEqual(r.counts, { total: 4, today: 1, week: 4 });
});

test("each row says what the owner needs at a glance", async () => {
  const r = await listRecentSignups({}, { now: NOW }, deps);
  const by = Object.fromEntries(r.users.map((u) => [u.uid, u]));
  assert.equal(by.pend.status, "pending"); assert.equal(by.pend.reviewReason, "no_nmc_match");
  assert.equal(by.pend.phone, "+919121974928"); assert.equal(by.pend.phoneVerified, true);
  assert.ok(by.pend.freeWeekUntil > NOW, "the free week while under review is visible");
  assert.equal(by.doc.status, "verified"); assert.equal(by.doc.pro, true);
  assert.equal(by.off.disabled, true);
  assert.equal(by.new1.status, "unverified"); assert.equal(by.new1.provider, "google.com");
});

test("filters and search", async () => {
  const f = async (o) => (await listRecentSignups({}, { now: NOW, ...o }, deps)).users.map((u) => u.uid);
  assert.deepEqual(await f({ filter: "pending" }), ["pend"]);
  assert.deepEqual(await f({ filter: "pro" }), ["doc"]);
  assert.deepEqual(await f({ filter: "disabled" }), ["off"]);
  assert.deepEqual(await f({ filter: "verified" }), ["doc"]);
  assert.deepEqual(await f({ q: "9121974928" }), ["pend"], "search by phone");
  assert.deepEqual(await f({ q: "DOC@X" }), ["doc"], "search by email, any case");
});

test("an expired Pro is not shown as Pro", () => {
  const r = accountRow("u", {}, fb("u", { pro: true, proExp: NOW - 1 }), null, NOW);
  assert.equal(r.pro, false);
});

test("one account in full: profile, verification, plan, features, limits, 7 days of usage", async () => {
  const d = await userDetail({}, "pend", { ...deps, now: NOW, usageStore: {},
    fsGet: async () => ({ fields: { name: "Sravani Yarrarapu", hospital: "Gandhi MC", phone: "+919121974928", smdId: "SMD-MAVWWX", junk: "x" } }),
    adminLookup: async () => ({ ok: true, tier: "free", tierExp: null, role: "physician", smdId: "SMD-MAVWWX", aiCapTokens: null, usage: { used: 10, cap: 100 },
      features: [{ key: "scribe_dictation", label: "MaiK Scribe", allowed: true, explicit: null }] }),
    getUserLimit: async () => ({ maik: 25 }),
    doctorUsageSummary: async (env, store, key, t) => { assert.equal(key, "em:pend@x.in"); return { day: new Date(t).toISOString().slice(0, 10), req: 3, tokens: 900, estCostInr: 0.4, byModule: { maik: 3 } }; },
  });
  assert.equal(d.ok, true);
  assert.equal(d.profile.hospital, "Gandhi MC"); assert.equal(d.profile.junk, undefined, "only known profile fields");
  assert.equal(d.verification.nameRead, "SIVA NAGA SRAVANI YARRARAPU"); assert.equal(d.verification.hasPhoto, true);
  assert.equal(d.verification.photoKey, undefined, "storage keys are not exposed");
  assert.equal(d.plan.role, "physician");
  assert.equal(d.features[0].key, "scribe_dictation");
  assert.equal(d.limits.find((m) => m.id === "maik").limit, 25, "the per-account MaiK limit");
  assert.equal(d.usage.length, 7); assert.equal(d.usage[0].req, 3);
});

test("an unknown uid is not found", async () => {
  const d = await userDetail({}, "ghost", { ...deps, fsGet: async () => null, adminLookup: async () => null });
  assert.equal(d.ok, false); assert.equal(d.error, "not_found");
});
