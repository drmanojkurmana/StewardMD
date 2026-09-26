/* SEC-10 (audit A16): the clinical-record identity path (resolveClinicalActor: /api/wardsynq, SMART
 * authorize, /api/connect) accepted a staff session the queue router refuses: one killed by a PIN reset,
 * and one that still owes the hospital's two-step setup. Both now go through the same live-session
 * check (_opd_org_store.js liveStaffSession).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec10-clinical-staff-session.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { actorDeps, clinicalStaffSession } = await import("../functions/_wardsynq/deps.js");
const { resolveClinicalActor } = await import("../functions/_wardsynq/actor.js");

const tenantDb = { prepare: () => ({ bind: () => ({ first: async () => ({ id: "tenant-a", settings: "{}" }), all: async () => ({ results: [] }) }) }) };
const deps = () => actorDeps(H.ENV, { db: tenantDb, orgForTenant: async () => H.ORG.getOrg(H.ENV, "org-a"), identifyFn: async () => ({ guest: true, id: "ip:x" }) });
const asStaff = (tok) => new Request("https://x/api/wardsynq/tenant-a/record", { headers: { "X-Staff-Token": tok } });
const resolve = (tok) => resolveClinicalActor(asStaff(tok), H.ENV, "tenant-a", "record:read", deps());

test("a staff session killed by a PIN reset no longer opens the clinical record", async () => {
  H.seed();
  const { staff } = await H.staffToken("org-a", "nurse-s10@example.test", "nurse");
  const ok = await resolve(staff);
  assert.equal(ok.role, "nurse");
  await new Promise((r) => setTimeout(r, 5));
  const reset = await H.ORG.setMemberPin(H.ENV, "org-a", "nurse-s10@example.test", "8052", "hr");
  assert.ok(reset.ok, JSON.stringify(reset));
  assert.equal(await clinicalStaffSession(H.ENV, staff, Date.now()), null);
  await assert.rejects(resolve(staff), /authenticated actor required/);
  // The queue router refuses the same token, as it always did.
  const r = await H.api("/whoami?orgId=org-a", "GET", null, { staff });
  assert.equal(r.__status, 401);
});

test("a member who owes two-step setup cannot act on the clinical record with one factor", async () => {
  H.seed();
  const o = H.docs.get("q_orgs/org-a"); o.fields = { ...o.fields, security: { requireTwoStepRoles: ["nurse"] } };
  const { staff } = await H.staffToken("org-a", "nurse-mfa@example.test", "nurse");
  const live = await H.ORG.liveStaffSession(H.ENV, staff, Date.now());
  assert.equal(live.mfaSetupOnly, true, "the queue router still lets them set it up");
  assert.equal(await clinicalStaffSession(H.ENV, staff, Date.now()), null);
  await assert.rejects(resolve(staff), /authenticated actor required/);
});
