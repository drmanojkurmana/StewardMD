/* Owner, 2026-10-09: User control said "Failed: not-found" for an account whose Firebase record has no
 * email (phone / Apple private-relay sign-in). /api/ai/admin/user-action now takes the account id.
 * node --test test/admin-user-action-uid.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
const R = await import("../functions/api/ai/[[path]].js");
const post = (body) => R.onRequest({ request: new Request("https://stewardmd.in/api/ai/admin/user-action", { method: "POST", headers: { "X-Admin-Token": "t", "Content-Type": "application/json", Origin: "https://stewardmd.in" }, body: JSON.stringify(body) }),
  env: { UPDATES_ADMIN_TOKEN: "t" }, params: { path: ["admin", "user-action"] }, waitUntil() {} });

test("an account id is enough: no email lookup, no not-found", async () => {
  const r = await post({ uid: "u-phone-only", action: "enable" });
  const j = await r.json();
  assert.notEqual(r.status, 404); assert.notEqual(j.error, "not-found");
  assert.notEqual(r.status, 400, "an id without an email is a valid request"); assert.equal(j.user.uid, "u-phone-only");
});
test("neither id nor email is a bad request", async () => {
  const r = await post({ action: "enable" });
  assert.equal(r.status, 400);
});
