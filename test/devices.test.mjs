/* test/devices.test.mjs — device-lock + clinic/device limit resolvers. Fake KV, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceLimit, clinicLimit } from "../functions/_entitlements.js";
import { registerDevice, listDevices, deviceAuthorized, removeDevice } from "../functions/_devices.js";

function fakeKv() {
  const m = new Map();
  return { m,
    async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

// Owner 2026-09-26 (vault/Role-Tiers.md section 3, D1, D6): two devices (phone + iPad) for every plan,
// Free included; Co-Resident is two logins with ONE device each. Keyed on the purchased tier when a
// record is passed, on the role for older string callers.
test("deviceLimit: 2 for everyone, 1 for Co-Resident, tier first, env override", () => {
  assert.equal(deviceLimit({}, "physician"), 2);
  assert.equal(deviceLimit({}, "student"), 2);
  assert.equal(deviceLimit({}, null), 2);
  assert.equal(deviceLimit({}, "co_resident"), 1);
  assert.equal(deviceLimit({}, { tier: "coresident", tierExp: null }), 1);
  assert.equal(deviceLimit({}, { tier: "physicianpro", tierExp: null, role: "co_resident" }), 2);   // tier wins
  assert.equal(deviceLimit({}, { tier: "coresident", tierExp: 1 }), 2);                             // expired tier -> role/free
  assert.equal(deviceLimit({ DEVICE_LIMIT_PHYSICIAN: "3" }, "physician"), 3);
});

test("clinicLimit: practice plans only (Clinician 4, Clinician Pro 6, Ultimate 10) + live add-on slots", () => {
  const far = Date.now() + 86400000;
  assert.equal(clinicLimit({}, null), 0);
  assert.equal(clinicLimit({}, "student"), 0);
  assert.equal(clinicLimit({}, "co_resident"), 0);
  assert.equal(clinicLimit({}, "pro"), 0);                                   // Resident Pro: no private practice
  assert.equal(clinicLimit({}, "physician"), 4);
  assert.equal(clinicLimit({}, "physician_pro"), 6);
  assert.equal(clinicLimit({}, { tier: "physician", tierExp: null }), 4);
  assert.equal(clinicLimit({}, { tier: "physicianpro", tierExp: null }), 6);
  assert.equal(clinicLimit({}, { tier: "ultimate", tierExp: null }), 10);
  assert.equal(clinicLimit({}, { tier: "physician", tierExp: null, clinicAddonSlots: 2, clinicAddonExp: far }), 6);
  assert.equal(clinicLimit({}, { tier: "physician", tierExp: null, clinicAddonSlots: 2, clinicAddonExp: 5 }), 4);   // add-on lapsed
  assert.equal(clinicLimit({ CLINIC_LIMIT_PRO: "5" }, "pro"), 5);
});

test("registerDevice: over the limit evicts the oldest (newest wins)", async () => {
  const kv = fakeKv();
  const r1 = await registerDevice({}, kv, "u1", "devA", "co_resident", 1000);
  assert.equal(r1.limit, 1); assert.deepEqual(r1.evicted, []);
  const r2 = await registerDevice({}, kv, "u1", "devB", "co_resident", 2000);
  assert.deepEqual(r2.evicted, ["devA"]);                 // over 1 -> oldest out
  assert.deepEqual(r2.devices.map((d) => d.id), ["devB"]);
  assert.equal(await deviceAuthorized(kv, "u1", "devB"), true);
  assert.equal(await deviceAuthorized(kv, "u1", "devA"), false);  // evicted device signs out
});

test("registerDevice: refresh existing device does not duplicate or evict", async () => {
  const kv = fakeKv();
  await registerDevice({}, kv, "u2", "devX", "physician", 1000);
  const r = await registerDevice({}, kv, "u2", "devX", "physician", 5000);
  assert.deepEqual(r.evicted, []);
  assert.equal(r.devices.length, 1);
  assert.equal(r.devices[0].at, 5000);                    // refreshed timestamp
});

test("everyone else keeps 2 devices (phone + iPad)", async () => {
  const kv = fakeKv();
  await registerDevice({}, kv, "cr", "d1", "physician", 1000);
  const r = await registerDevice({}, kv, "cr", "d2", "physician", 2000);
  assert.deepEqual(r.evicted, []);                        // both fit under limit 2
  const r3 = await registerDevice({}, kv, "cr", "d3", "physician", 3000);
  assert.deepEqual(r3.evicted, ["d1"]);                   // 3rd evicts oldest
});

test("limitOverride (lock OFF) never evicts", async () => {
  const kv = fakeKv();
  await registerDevice({}, kv, "u3", "a", "physician", 1000, 9999);
  const r = await registerDevice({}, kv, "u3", "b", "physician", 2000, 9999);
  assert.deepEqual(r.evicted, []);
  assert.equal(r.devices.length, 2);
});

test("removeDevice signs a device out", async () => {
  const kv = fakeKv();
  await registerDevice({}, kv, "u4", "p", "physician_pro", 1000);
  await registerDevice({}, kv, "u4", "q", "physician_pro", 2000);
  const r = await removeDevice(kv, "u4", "p");
  assert.deepEqual(r.devices.map((d) => d.id), ["q"]);
});
