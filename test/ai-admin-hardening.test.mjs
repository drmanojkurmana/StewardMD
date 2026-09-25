/* ai-admin-hardening.test.mjs - audit T50.
 * Admin token: X-Admin-Token header only (never ?token=). ?diag=1 and figures?debug=1: owner/admin
 * only. /figures: a small daily cap per caller. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import(new URL("../functions/api/ai/[[path]].js", import.meta.url));
const TOK = "admin-token-for-tests";
function fakeKv() {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
const call = (path, init, env) => {
  const seg = path.split("?")[0];
  return onRequest({ request: new Request("https://stewardmd.in/api/ai/" + path, init || {}), env: Object.assign({ UPDATES_ADMIN_TOKEN: TOK }, env || {}), params: { path: seg.split("/") }, waitUntil: () => {} });
};

test("the admin token in a query param is refused; the header works", async () => {
  const kv = fakeKv();
  assert.equal((await call("admin/audit?token=" + TOK, {}, { MAIK_KV: kv })).status, 403);
  assert.equal((await call("admin?token=" + TOK, {}, { MAIK_KV: kv })).status, 403);
  assert.equal((await call("admin/audit", { headers: { "X-Admin-Token": TOK } }, { MAIK_KV: kv })).status, 200);
  assert.equal((await call("admin/audit", { headers: { "X-Admin-Token": TOK + "x" } }, { MAIK_KV: kv })).status, 403);
});

async function explain(query, headers) {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).indexOf("generateContent") >= 0
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5 } }), { status: 200 })
    : new Response("{}", { status: 200 });
  try {
    const r = await call("explain" + query, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: JSON.stringify({ question: "dose of amiodarone in af", grounding: [{ text: "x" }] }) }, { AI_PROVIDER: "developer", GEMINI_API_KEY: "k" });
    return await r.json();
  } finally { globalThis.fetch = real; }
}

test("?diag=1 is ignored for an ordinary caller and honoured for an admin", async () => {
  assert.equal((await explain("?diag=1"))._diag, undefined, "diagnostics leaked to a non-admin");
  const a = await explain("?diag=1", { "X-Admin-Token": TOK });
  assert.ok(a._diag && typeof a._diag.promptTok === "number");
});

test("figures?debug=1 is owner/admin only, and /figures has a daily cap", async () => {
  const kv = fakeKv();
  const env = { MAIK_KV: kv, MAIK_FIGURES_DAILY_CAP: "2", GEMINI_API_KEY: "k" };
  const plain = await (await call("figures?q=atrial+fibrillation+ecg&debug=1", { headers: { "X-SMD-Device": "d1" } }, env)).json();
  assert.equal(plain.debug, undefined);
  await call("figures?q=atrial+fibrillation+ecg", { headers: { "X-SMD-Device": "d1" } }, env);
  const third = await (await call("figures?q=atrial+fibrillation+ecg", { headers: { "X-SMD-Device": "d1" } }, env)).json();
  assert.equal(third.limited, true, "the 3rd call on a cap of 2 is refused");
  assert.deepEqual(third.figures, []);
  const other = await (await call("figures?q=atrial+fibrillation+ecg", { headers: { "X-SMD-Device": "d2" } }, env)).json();
  assert.notEqual(other.limited, true, "another device is unaffected");
  const admin = await (await call("figures?q=atrial+fibrillation+ecg&debug=1", { headers: { "X-Admin-Token": TOK } }, env)).json();
  assert.ok(Array.isArray(admin.debug), "an admin still gets the trace");
});
