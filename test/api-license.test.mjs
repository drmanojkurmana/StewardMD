// test/api-license.test.mjs — the native-only license endpoint (Phase 2a): Pro-gated key + 2h grace, owner=Pro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/license.js";

const call = (env, headers, method) => {
  const m = method || "POST";
  const init = { method: m, headers: Object.assign({ "content-type": "application/json" }, headers || {}) };
  if (m === "POST") init.body = "{}";   // a GET/HEAD Request cannot carry a body
  return onRequest({ request: new Request("https://x/api/license", init), env: env || {} });
};
const OWNER = { "Cf-Access-Authenticated-User-Email": "drmanojkurmana@gmail.com" };
const NON = { "Cf-Access-Authenticated-User-Email": "random@doc.test" };

test("guest / unauthenticated -> 401 (no entitlement)", async () => {
  const r = await call({});
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "auth");
});

test("owner -> 200 Pro with a 2-hour grace", async () => {
  const r = await call({}, OWNER);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.pro, true);
  assert.equal(b.graceSeconds, 7200);
  assert.ok(b.expiresAt > b.issuedAt);
});

test("authenticated non-owner with no subscription -> 402 not_pro", async () => {
  const r = await call({}, NON);
  assert.equal(r.status, 402);
  assert.equal((await r.json()).pro, false);
});

test("env LICENSE_PRO_EMAILS allowlist entitles a user (Phase-3 IAP stand-in)", async () => {
  const r = await call({ LICENSE_PRO_EMAILS: "random@doc.test, x@y.z" }, NON);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).pro, true);
});

test("the decrypt key is delivered ONLY to a Pro user", async () => {
  assert.equal((await (await call({ APP_KB_KEY: "K123" }, OWNER)).json()).key, "K123");
  const nonPro = await call({ APP_KB_KEY: "K123" }, NON);
  assert.equal(nonPro.status, 402);   // non-Pro never receives the key
});

test("non-POST -> 405", async () => {
  assert.equal((await call({}, OWNER, "GET")).status, 405);
});
