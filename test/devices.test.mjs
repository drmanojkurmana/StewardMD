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

test("deviceLimit: 1 default, 2 for co_resident + physician_pro, env override", () => {
  assert.equal(deviceLimit({}, "physician"), 1);
  assert.equal(deviceLimit({}, "student"), 1);
  assert.equal(deviceLimit({}, "co_resident"), 2);
  assert.equal(deviceLimit({}, "physician_pro"), 2);
  assert.equal(deviceLimit({ DEVICE_LIMIT_PHYSICIAN: "3" }, "physician"), 3);
});

test("clinicLimit: none for free/trainee, Pro 2, Physician 4, Physician Pro 6, env override", () => {
  assert.equal(clinicLimit({}, null), 0);
  assert.equal(clinicLimit({}, "student"), 0);
  assert.equal(clinicLimit({}, "co_resident"), 0);
  assert.equal(clinicLimit({}, "pro"), 2);
  assert.equal(clinicLimit({}, "physician"), 4);
  assert.equal(clinicLimit({}, "physician_pro"), 6);
  assert.equal(clinicLimit({ CLINIC_LIMIT_PRO: "5" }, "pro"), 5);
});

test("registerDevice: 1-device role evicts the oldest (newest wins)", async () => {
  const kv = fakeKv();
  const r1 = await registerDevice({}, kv, "u1", "devA", "physician", 1000);
  assert.equal(r1.limit, 1); assert.deepEqual(r1.evicted, []);
  const r2 = await registerDevice({}, kv, "u1", "devB", "physician", 2000);
  assert.deepEqual(r2.evicted, ["devA"]);                 // over 1 → oldest out
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

test("co_resident/physician_pro keep 2 devices", async () => {
  const kv = fakeKv();
  await registerDevice({}, kv, "cr", "d1", "co_resident", 1000);
  const r = await registerDevice({}, kv, "cr", "d2", "co_resident", 2000);
  assert.deepEqual(r.evicted, []);                        // both fit under limit 2
  const r3 = await registerDevice({}, kv, "cr", "d3", "co_resident", 3000);
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
