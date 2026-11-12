/* POST /api/account/delete - self-service account deletion (App Store 5.1.1(v)).
 *
 * The in-app "Delete account & data" used the web SDK's user.delete(), which fails with
 * requires-recent-login and cannot re-authenticate by popup inside the native WebView, so the account
 * survived on the phone. What must hold here: only the uid in the VERIFIED token is deleted, the data
 * goes before the sign-in, an explicit confirm is required, and a failed delete is reported as one.
 *
 * node --test --experimental-test-module-mocks test/account-delete.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realAuth = await import("../functions/_fbauth.js");
const realAdmin = await import("../functions/_fbadmin.js");
const realLc = await import("../functions/_lifecycle.js");
const order = [];
let failDelete = false;
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifiedClaimsFor: async (req) => {
    const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    return t === "good-token" ? { sub: "uid-A" } : null;
  } },
});
mock.module("../functions/_fbadmin.js", {
  namedExports: { ...realAdmin, deleteUser: async (_e, uid) => { order.push("auth:" + uid); return !failDelete; } },
});
mock.module("../functions/_lifecycle.js", {
  namedExports: { ...realLc,
    purgeUserData: async (_e, uid) => { order.push("data:" + uid); return { cases: 2 }; },
    deleteLifecycle: async (_e, uid) => { order.push("lifecycle:" + uid); return true; } },
});
const { onRequest } = await import("../functions/api/account/delete.js");

async function call(method, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const init = { method, headers };
  if (method !== "GET") init.body = JSON.stringify(body || {});
  const res = await onRequest({ request: new Request("https://x/api/account/delete", init), env: {} });
  return { status: res.status, body: await res.json() };
}

test("rejects anything but POST", async () => {
  assert.equal((await call("GET", "good-token")).status, 405);
});

test("an unsigned or bad token deletes nothing", async () => {
  order.length = 0;
  assert.equal((await call("POST", null, { confirm: "DELETE" })).status, 401);
  assert.equal((await call("POST", "forged", { confirm: "DELETE" })).status, 401);
  assert.deepEqual(order, []);
});

test("requires the explicit confirm", async () => {
  order.length = 0;
  assert.equal((await call("POST", "good-token", {})).status, 400);
  assert.deepEqual(order, []);
});

test("deletes the token's uid: data first, then the sign-in", async () => {
  order.length = 0; failDelete = false;
  const r = await call("POST", "good-token", { confirm: "DELETE", uid: "uid-B" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(order, ["data:uid-A", "lifecycle:uid-A", "auth:uid-A"]);
});

test("a failed Firebase delete is reported, never a success", async () => {
  order.length = 0; failDelete = true;
  const r = await call("POST", "good-token", { confirm: "DELETE" });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
});
