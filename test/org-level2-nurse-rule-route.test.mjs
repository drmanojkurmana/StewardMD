/* test/org-level2-nurse-rule-route.test.mjs - owner decision 2026-09-14, the save side of
 * wardsynq.criticalEscalation.level2NurseRule through the real router.
 *
 * Route: POST /api/queue/org/update with { wardsynq: { criticalEscalation: { level2NurseRule } } } (what the
 * Critical result alerts card saves, carrying the rule it read). Pinned: no session 401; a member without
 * staff.admin 403; another hospital's admin refused; any rule but "all-on-duty-nurses-in-ward" 422 with the
 * Nurse-in-Charge sentence; all with nothing written; the admin's save of the one rule survives the whitelist.
 * The group recommendation route (POST /group/policy) is pinned in wardsynq-hospital-group.test.mjs; resolution
 * in wardsynq-alert-recipients.test.mjs and wardsynq-alert-dispatch.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/org-level2-nurse-rule-route.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;

function seedWsq() {
  H.seed();
  Object.assign(docs.get("q_orgs/org-a").fields, { mode: "wardsynq", wardsynq: { alerts: { push: { enabled: true } }, rpoMinutes: 60 } });
}
const body = (rule) => ({ orgId: "org-a", wardsynq: { criticalEscalation: { acknowledgeWithinMinutes: 20, level2NurseRule: rule, levels: { overdue: { orderer: true, roles: ["supervisor", "nurse"], contacts: [] } } } } });

test("POST /api/queue/org/update criticalEscalation.level2NurseRule: 401, nurse 403, other hospital refused, unbuilt rule 422, nothing written", async () => {
  seedWsq();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  assert.equal((await api("/org/update", "POST", body("all-on-duty-nurses-in-ward"))).__status, 401);
  assert.equal((await api("/org/update", "POST", body("all-on-duty-nurses-in-ward"), H.NURSE_A)).__status, 403);
  const other = await api("/org/update", "POST", body("all-on-duty-nurses-in-ward"), H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  for (const rule of ["nurse-in-charge", "all-nurses", 2]) {
    const bad = await api("/org/update", "POST", body(rule), H.HR_A);
    assert.equal(bad.__status, 422, JSON.stringify(bad));
    assert.equal(bad.error, "level2_nurse_rule_not_built");
    assert.match(bad.message, /was not saved\. The only rule built is "all-on-duty-nurses-in-ward".*until a Nurse-in-Charge role or assignment is implemented/);
  }
  assert.equal((await api("/org/update", "POST", body("nurse-in-charge"), H.NURSE_A)).__status, 403, "authorization is decided before the value is judged");
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
});

test("POST /api/queue/org/update: the admin saves the rule with the ladder; it survives the whitelist and the rest of the config is kept", async () => {
  seedWsq();
  const ok = await api("/org/update", "POST", body("all-on-duty-nurses-in-ward"), H.HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.org.wardsynq.criticalEscalation.level2NurseRule, "all-on-duty-nurses-in-ward");
  assert.equal(ok.org.wardsynq.alerts.push.enabled, true);
  assert.equal(docs.get("q_orgs/org-a").fields.wardsynq.criticalEscalation.level2NurseRule, "all-on-duty-nurses-in-ward");
  const clear = await api("/org/update", "POST", { orgId: "org-a", wardsynq: { criticalEscalation: { acknowledgeWithinMinutes: 20 } } }, H.HR_A);
  assert.equal(clear.__status, 200, "a ladder saved without the key is the default rule, not a refusal");
});
