/* test/bug-report-admin.test.mjs - the developer's side of a bug report, through the real admin route.
 * Reply -> push to the reporter's phone (no ticket text on the lock screen); resolve -> screenshot
 * deleted; screenshot route owner-only. node --test --experimental-test-module-mocks test/bug-report-admin.test.mjs */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const PUSHES = [];
const realPush = await import("../functions/_nativepush.js");
mock.module("../functions/_nativepush.js", { namedExports: { ...realPush, sendNativeToAll: async (env, msg, opts) => { PUSHES.push({ msg, opts }); return { sent: 1 }; } } });
const S = await import("../functions/_support.js");
const { onRequest } = await import("../functions/api/ai/[[path]].js");

function memKV() {
  const m = new Map();
  return { _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
}
const store = memKV();
const env = { MAIK_KV: store, UPDATES_ADMIN_TOKEN: "owner-token-123" };
async function call(seg, opts) {
  const req = new Request("https://stewardmd.in/api/ai/" + seg, { method: (opts && opts.method) || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || { "X-Admin-Token": "owner-token-123" }), body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
  return onRequest({ request: req, env, params: { path: seg.split("?")[0].split("/") }, waitUntil: (p) => p });
}

test("reply pushes to the reporter, with the id only; resolve deletes the screenshot; the screenshot is owner-only", async () => {
  const t = await S.createTicket(store, { id: "fb:doc-uid-9", email: "d@x.in" }, { kind: "bug", subject: "Bug: blank chart", text: "Patient Ramesh chart is blank", hasShot: true }, [7, 9], Date.now());
  await store.put(S.shotKey(t.id), "jpeg:" + Buffer.from("img").toString("base64"));

  assert.equal((await call("admin/support-shot?id=" + t.id, { headers: {} })).status, 403, "no owner, no screenshot");
  const img = await call("admin/support-shot?id=" + t.id);
  assert.equal(img.status, 200); assert.equal(img.headers.get("Content-Type"), "image/jpeg");

  const r = await call("admin/support-reply", { method: "POST", body: { id: t.id, text: "Fixed in 1.3" } });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(PUSHES.length, 1);
  assert.deepEqual(PUSHES[0].opts, { uid: "doc-uid-9" });
  assert.equal(PUSHES[0].msg.title, "Reply to your bug report");
  assert.equal(JSON.stringify(PUSHES[0].msg).includes("Ramesh"), false, "no ticket text on a lock screen");
  assert.equal(JSON.stringify(PUSHES[0].msg).includes("Fixed in 1.3"), false);
  assert.ok(store._m.has(S.shotKey(t.id)), "an open bug keeps its screenshot");

  const w = await call("admin/support-reply", { method: "POST", body: { id: t.id, status: "in_progress" } });
  assert.equal(w.status, 200); assert.equal((await S.getTicket(store, t.id)).status, "in_progress");
  assert.equal(PUSHES.length, 1, "a bare status change sends no push");
  const r2 = await call("admin/support-reply", { method: "POST", body: { id: t.id, text: "Closing", resolve: true } });
  assert.equal(r2.status, 200);
  assert.equal(store._m.has(S.shotKey(t.id)), false, "resolved: screenshot deleted");
  assert.equal(PUSHES[1].msg.title, "Your bug report is fixed");
  const back = await S.getTicket(store, t.id);
  assert.equal(back.userUnread, true); assert.equal(back.status, "resolved");
});
