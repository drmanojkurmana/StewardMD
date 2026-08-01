import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserLimit, setUserLimit, checkModuleQuota, recordAiUsage, buildUsageRecord } from "../functions/_ai_usage.js";
import { deviceCheck } from "../functions/_usage.js";

const NOW = 1800000000000;

function mockKv() {
  const m = new Map();
  return {
    _m: m,
    async get(k, type) { const v = m.get(k); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list(opts) { const p = (opts && opts.prefix) || ""; return { keys: [...m.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; },
  };
}

test("setUserLimit/getUserLimit: round-trip, clear, and key deletion", async () => {
  const kv = mockKv();
  assert.equal(await getUserLimit(kv, "dr.x@gmail.com"), null);                 // none yet
  await setUserLimit(kv, "Dr.X@Gmail.com", "ocr", 100);                         // email lowercased on write
  assert.deepEqual(await getUserLimit(kv, "dr.x@gmail.com"), { ocr: 100 });
  await setUserLimit(kv, "dr.x@gmail.com", "maik", 500);
  assert.deepEqual(await getUserLimit(kv, "dr.x@gmail.com"), { ocr: 100, maik: 500 });
  await setUserLimit(kv, "dr.x@gmail.com", "ocr", null);                        // clear one
  assert.deepEqual(await getUserLimit(kv, "dr.x@gmail.com"), { maik: 500 });
  await setUserLimit(kv, "dr.x@gmail.com", "maik", null);                       // clear last → key removed
  assert.equal(kv._m.has("ai:ulimit:dr.x@gmail.com"), false);
});

test("setUserLimit: floors to a non-negative integer; ignores unknown modules", async () => {
  const kv = mockKv();
  await setUserLimit(kv, "a@b.com", "ocr", "7.9");
  assert.deepEqual(await getUserLimit(kv, "a@b.com"), { ocr: 7 });
  const r = await setUserLimit(kv, "a@b.com", "not-a-module", 5);
  assert.equal(r, null);                                                        // unknown module → no-op
});

test("checkModuleQuota: per-user cap enforces regardless of MAIK_ENFORCE_CAPS", async () => {
  const kv = mockKv(), env = {}, key = "em:dr.x@gmail.com";                     // NOTE: caps globally OFF (no MAIK_ENFORCE_CAPS)
  await setUserLimit(kv, "dr.x@gmail.com", "ocr", 2);
  const rec = () => buildUsageRecord({ doctorId: key, module: "ocr", ts: NOW });
  for (let i = 0; i < 2; i++) {
    assert.equal((await checkModuleQuota(env, kv, "ocr", key, NOW)).ok, true, "call " + i);
    await recordAiUsage(env, kv, rec(), NOW);
  }
  const blocked = await checkModuleQuota(env, kv, "ocr", key, NOW);
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, "user-limit");
  assert.equal(blocked.used, 2); assert.equal(blocked.limit, 2);
  // a DIFFERENT module for the same user is NOT capped (falls to launch default = unlimited)
  assert.equal((await checkModuleQuota(env, kv, "maik", key, NOW)).ok, true);
  // a DIFFERENT user is unaffected
  assert.equal((await checkModuleQuota(env, kv, "ocr", "em:other@x.com", NOW)).ok, true);
});

test("checkModuleQuota: per-user cap of 0 means explicit unlimited", async () => {
  const kv = mockKv(), key = "em:z@z.com";
  await setUserLimit(kv, "z@z.com", "ocr", 0);
  const q = await checkModuleQuota({}, kv, "ocr", key, NOW);
  assert.equal(q.ok, true); assert.equal(q.unlimited, true);
});

const reqWithDevice = (id) => ({ headers: { get: (k) => (String(k).toLowerCase() === "x-smd-device" ? id : null) } });

test("deviceCheck: counts per device and hard-blocks at the cap", async () => {
  const kv = mockKv(), env = { MAIK_DEVICE_DAILY_CAP: "2" }, req = reqWithDevice("dev-abc");
  assert.equal((await deviceCheck(env, kv, req, NOW)).ok, true);   // 1
  assert.equal((await deviceCheck(env, kv, req, NOW)).ok, true);   // 2
  const blocked = await deviceCheck(env, kv, req, NOW);            // 3 → over
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, "device-cap"); assert.equal(blocked.cap, 2);
  // a different device is independent
  assert.equal((await deviceCheck(env, kv, reqWithDevice("dev-xyz"), NOW)).ok, true);
});

test("deviceCheck: fail-open when disabled, no header, or no store", async () => {
  const kv = mockKv();
  assert.equal((await deviceCheck({ MAIK_DEVICE_DAILY_CAP: "0" }, kv, reqWithDevice("d"), NOW)).ok, true); // disabled
  assert.equal((await deviceCheck({ MAIK_DEVICE_DAILY_CAP: "2" }, kv, reqWithDevice(null), NOW)).ok, true); // no header
  assert.equal((await deviceCheck({ MAIK_DEVICE_DAILY_CAP: "2" }, null, reqWithDevice("d"), NOW)).ok, true); // no store
});
