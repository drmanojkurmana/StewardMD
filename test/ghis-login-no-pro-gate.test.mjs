/* test/ghis-login-no-pro-gate.test.mjs - owner decision O1 (2026-09-14): hospital staff never meet the
 * personal Pro paywall inside their hospital workplace. Ward Sync login (POST /api/ghis/login) must not
 * answer 402 once the launch promo has ended; the hospital's own credentials are the entitlement.
 *
 * node --test test/ghis-login-no-pro-gate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { onRequest } = await import("../functions/api/ghis/[[path]].js");

test("Ward Sync login after the promo ends, with no Pro and no account: not 402, reaches the credential check", async () => {
  const env = { GHIS_KV: { get: async () => null, put: async () => {} }, PRO_FREE_UNTIL: "2020-01-01T00:00:00Z" };
  const request = new Request("https://x/api/ghis/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const res = await onRequest({ request, env, params: { path: ["login"] } });
  assert.notEqual(res.status, 402);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "missing_credentials");
});
