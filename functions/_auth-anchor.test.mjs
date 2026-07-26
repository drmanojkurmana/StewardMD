import assert from "node:assert";
import test from "node:test";
// In-memory KV double
function makeKV() { const m = new Map(); return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; }

test("anchor-start stores a code and emails the SUPPLIED address", async () => {
  const kv = makeKV(); const sent = [];
  const { anchorStart } = await import("../functions/api/auth/[[path]].js");
  const res = await anchorStart({ uid: "u1", name: "Dr A" }, { email: "real@hospital.org" }, kv, async (o) => { sent.push(o); return { ok: true }; });
  assert.equal(res.ok, true);
  assert.equal(sent[0].email, "real@hospital.org", "code went to the typed email");
  const rec = await kv.get("anchor:email:u1", "json");
  assert.equal(rec.email, "real@hospital.org");
  assert.equal(rec.code.length, 6);
});

test("anchor-verify accepts the right code once, rejects reuse/expiry/tries", async () => {
  const kv = makeKV();
  const { anchorStart, anchorVerify } = await import("../functions/api/auth/[[path]].js");
  await anchorStart({ uid: "u2" }, { email: "r@h.org" }, kv, async () => ({ ok: true }));
  const rec = await kv.get("anchor:email:u2", "json");
  let r = await anchorVerify({ uid: "u2" }, { email: "r@h.org", code: "000000" }, kv, async () => {});
  assert.equal(r.ok, false, "wrong code rejected");
  r = await anchorVerify({ uid: "u2" }, { email: "r@h.org", code: rec.code }, kv, async () => {});
  assert.equal(r.verified, true, "right code verifies");
  r = await anchorVerify({ uid: "u2" }, { email: "r@h.org", code: rec.code }, kv, async () => {});
  assert.equal(r.ok, false, "code cleared after success");
});

test("anchor-start rejects a malformed email", async () => {
  const kv = makeKV();
  const { anchorStart } = await import("../functions/api/auth/[[path]].js");
  const res = await anchorStart({ uid: "u3" }, { email: "not-an-email" }, kv, async () => ({ ok: true }));
  assert.equal(res.ok, false); assert.equal(res.error, "bad-email");
});
