import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserLimit, setUserLimit } from "../functions/_ai_usage.js";

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
