/* SEC-07 (audit A3): every signed-in StewardMD account carries the global role "doctor". The routes that
 * used requireOrgOrGlobal took that as enough for ANY hospital, so an outsider opened a queue session
 * under another hospital, registered patients into it, and read its medication catalogue and stock.
 * A real org now needs ownership or membership; a doctor's own practice ("manual") is unchanged.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec07-global-doctor.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const OUTSIDER = "outsider@example.test";

test("an outsider cannot open a queue session under another hospital or read its catalogue", async () => {
  H.seed();
  const s = await H.api("/session?hospitalId=org-a&date=" + H.DAY, "GET", null, OUTSIDER);
  assert.equal(s.__status, 403, JSON.stringify(s));
  assert.ok(!s.session);
  const inv = await H.api("/inv-catalog?orgId=org-a&kind=medication", "GET", null, OUTSIDER);
  assert.equal(inv.__status, 403, JSON.stringify(inv));
  const board = await H.api("/board?hospitalId=org-a&date=" + H.DAY, "GET", null, H.OWNER_A);
  assert.equal((board.board || []).length, 0, "nothing of the outsider's appeared on org-a's board");
});

test("members, the owner and a doctor's own practice keep working", async () => {
  H.seed();
  const own = await H.api("/session?hospitalId=manual&date=" + H.DAY, "GET", null, OUTSIDER);
  assert.equal(own.__status, 200, JSON.stringify(own));
  const owner = await H.api("/session?hospitalId=org-a&date=" + H.DAY, "GET", null, H.OWNER_A);
  assert.equal(owner.__status, 200, JSON.stringify(owner));
  H.member("org-a", "doc-a@example.test", "doctor");
  const doc = await H.api("/inv-catalog?orgId=org-a&kind=medication", "GET", null, "doc-a@example.test");
  assert.equal(doc.__status, 200, JSON.stringify(doc));
});
