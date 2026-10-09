/* Owner, 2026-10-09: User control showed "Failed: 500" with no reason. An entitlement admin write that
 * throws (a Firestore commit, a claims write) now answers JSON with the cause, owner-only.
 * node --test test/entitlements-admin-errors.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
const R = await import("../functions/api/entitlements/[[path]].js");

test("a failing admin write answers JSON with the reason, not a bare 500", async () => {
  // No service account in env: the Firestore write cannot get a token and throws.
  const env = { UPDATES_ADMIN_TOKEN: "t" };
  const req = new Request("https://x/api/entitlements/admin/set-budget", { method: "POST", headers: { "X-Admin-Token": "t", "Content-Type": "application/json" }, body: JSON.stringify({ uid: "u1", tokens: 5000 }) });
  const r = await R.onRequestPost({ request: req, env, params: { path: ["admin", "set-budget"] } });
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.ok(j.error && j.error !== "", "names the error");
  assert.ok(typeof j.detail === "string", "carries the detail");
});

test("still owner-only", async () => {
  const req = new Request("https://x/api/entitlements/admin/set-budget", { method: "POST", body: "{}" });
  const r = await R.onRequestPost({ request: req, env: { UPDATES_ADMIN_TOKEN: "t" }, params: { path: ["admin", "set-budget"] } });
  assert.equal(r.status, 403);
});
