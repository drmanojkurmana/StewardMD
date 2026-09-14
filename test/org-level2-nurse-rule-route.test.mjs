/* test/org-level2-nurse-rule-route.test.mjs - owner decisions 2026-09-14 and 2026-09-15, the save side of the level-2
 * ward rule through the real router: wardsynq.criticalEscalation.level2WardRule, and the earlier key level2NurseRule.
 *
 * Route: POST /api/queue/org/update with { wardsynq: { criticalEscalation: { level2WardRule } } } (what the Critical
 * result alerts card saves, carrying the rule it read). Pinned: no session 401; a member without staff.admin 403;
 * another hospital's admin refused; any rule but "all-on-duty-ward-team" / "all-on-duty-nurses-in-ward", under either
 * key, 422 naming both rules; all with nothing written; the admin's save of a built rule survives the whitelist.
 * The group recommendation route (POST /group/policy) is pinned in wardsynq-hospital-group.test.mjs; resolution
 * in wardsynq-alert-recipients.test.mjs, wardsynq-alert-dispatch.test.mjs and wardsynq-ward-duty-team.test.mjs.
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
const body = (rule, key) => ({ orgId: "org-a", wardsynq: { criticalEscalation: { acknowledgeWithinMinutes: 20, [key || "level2WardRule"]: rule, levels: { overdue: { orderer: true, roles: ["supervisor", "nurse"], contacts: [] } } } } });

test("POST /api/queue/org/update criticalEscalation.level2WardRule: 401, nurse 403, other hospital refused, unbuilt rule 422 under either key, nothing written", async () => {
  seedWsq();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  assert.equal((await api("/org/update", "POST", body("all-on-duty-ward-team"))).__status, 401);
  assert.equal((await api("/org/update", "POST", body("all-on-duty-ward-team"), H.NURSE_A)).__status, 403);
  const other = await api("/org/update", "POST", body("all-on-duty-ward-team"), H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  for (const [rule, key] of [["nurse-in-charge"], ["all-nurses"], [2], ["everyone", "level2NurseRule"]]) {
    const bad = await api("/org/update", "POST", body(rule, key), H.HR_A);
    assert.equal(bad.__status, 422, JSON.stringify(bad));
    assert.equal(bad.error, "level2_ward_rule_not_built");
    assert.match(bad.message, /was not saved\. The rules built are "all-on-duty-ward-team" \(the default.*"all-on-duty-nurses-in-ward" \(nurses only\)/);
  }
  assert.equal((await api("/org/update", "POST", body("nurse-in-charge"), H.NURSE_A)).__status, 403, "authorization is decided before the value is judged");
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
});

test("POST /api/queue/org/update: the admin saves a built rule with the ladder, under the new key or the old one; it survives the whitelist", async () => {
  seedWsq();
  const ok = await api("/org/update", "POST", body("all-on-duty-ward-team"), H.HR_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.org.wardsynq.criticalEscalation.level2WardRule, "all-on-duty-ward-team");
  assert.equal(ok.org.wardsynq.alerts.push.enabled, true);
  const old = await api("/org/update", "POST", body("all-on-duty-nurses-in-ward", "level2NurseRule"), H.HR_A);
  assert.equal(old.__status, 200, "the nurse-only rule is still accepted under the old key");
  assert.equal(docs.get("q_orgs/org-a").fields.wardsynq.criticalEscalation.level2NurseRule, "all-on-duty-nurses-in-ward");
  const clear = await api("/org/update", "POST", { orgId: "org-a", wardsynq: { criticalEscalation: { acknowledgeWithinMinutes: 20 } } }, H.HR_A);
  assert.equal(clear.__status, 200, "a ladder saved without the key is the default rule, not a refusal");
});
