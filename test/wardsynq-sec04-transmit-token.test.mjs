/* SEC-04 (audit A8): the pharmacy/lab transmit credential (wardsynq.transmitEndpoints[*].token) came
 * back to every member on GET /org and GET /orgs, reception PIN sessions included. It is now reported
 * as tokenSet:true, still stored, and still what transmit-send presents.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec04-transmit-token.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const KEY = "LIVE-PHARMACY-KEY-456";
const ERX = { url: "https://pharmacy-hub.example/rx", headerName: "X-Api-Key" };

test("no member reads the transmit token back; the stored token survives a round trip of the redacted form", async () => {
  H.seed();
  H.org("org-a", H.OWNER_A, { mode: "wardsynq" });
  const up = await H.api("/org/update", "POST", { orgId: "org-a", wardsynq: { transmitEndpoints: { erx: { ...ERX, token: KEY } } } }, H.OWNER_A);
  assert.equal(up.__status, 200, JSON.stringify(up));
  assert.ok(!JSON.stringify(up).includes(KEY), "not even in the admin's own save response");

  const reception = await H.staffToken("org-a", "desk1", "reception");
  for (const [who, path] of [[H.VIEWER_A, "/org?orgId=org-a"], [H.VIEWER_A, "/orgs"], [reception, "/org?orgId=org-a"], [reception, "/orgs"], [H.OWNER_A, "/orgs"]]) {
    const r = await H.api(path, "GET", null, who);
    assert.equal(r.__status, 200, JSON.stringify(r));
    assert.ok(!JSON.stringify(r).includes(KEY), `${path} leaks the key`);
  }
  const v = await H.api("/org?orgId=org-a", "GET", null, H.VIEWER_A);
  assert.deepEqual(v.org.wardsynq.transmitEndpoints.erx, { ...ERX, tokenSet: true });

  // An admin screen that sends the redacted object back does not wipe the credential.
  await H.api("/org/update", "POST", { orgId: "org-a", wardsynq: { transmitEndpoints: v.org.wardsynq.transmitEndpoints } }, H.OWNER_A);
  assert.equal((await H.ORG.getOrg(H.ENV, "org-a")).wardsynq.transmitEndpoints.erx.token, KEY, "still stored for transmit-send");
});
