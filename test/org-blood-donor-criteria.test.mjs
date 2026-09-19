/* test/org-blood-donor-criteria.test.mjs - the per-hospital blood donor selection criteria (owner decision 2026-09-17,
 * corrected by the legal review the same day): the stricter of WHO 2012 and the law of the hospital's region is in
 * force, and a hospital may only make a criterion stricter still.
 *
 * Routes: GET /api/queue/org/blood-donor-criteria, POST /api/queue/org/blood-donor-criteria.
 * Pinned: no session 401; a member without staff.admin 403 and nothing written; another hospital's admin refused; a value
 * looser than WHO or Indian law is refused 422 by name with nothing written; the admin's stricter save is audited in the
 * same commit (criteria named, not values), the response is the server's read-back with each value's source, other
 * config is untouched, and blank goes back to the standard. The rules themselves are in test/wardsynq-blood-bank.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/org-blood-donor-criteria.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;

const cfg = () => docs.get("q_orgs/org-a").fields.wardsynq || {};
const events = () => [...docs.values()].map((d) => d.fields).filter((f) => f.action === "org:blood_donor_criteria");
function seedWsq() {
  H.seed();
  Object.assign(docs.get("q_orgs/org-a").fields, { mode: "wardsynq", wardsynq: { lactationWindowDays: 42 } });
}
const STRICTER = { minHbFemale: 13, intervalDaysFemale: 150, systolicMax: 130, deferrals: { tattoo: 400 }, maxAge: "" };

test("GET /api/queue/org/blood-donor-criteria: 401, 403 without staff.admin, another hospital refused; the admin reads the values in force with their sources", async () => {
  seedWsq();
  assert.equal((await api("/org/blood-donor-criteria?orgId=org-a")).__status, 401);
  assert.equal((await api("/org/blood-donor-criteria?orgId=org-a", "GET", null, H.NURSE_A)).__status, 403);
  const other = await api("/org/blood-donor-criteria?orgId=org-a", "GET", null, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const r = await api("/org/blood-donor-criteria?orgId=org-a", "GET", null, H.HR_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.criteria.jurisdiction, "IN");
  assert.equal(r.criteria.values.minHbFemale, 12.5);
  assert.equal(r.criteria.sources.minHbFemale.source, "law");
  assert.equal(r.criteria.sources.minHbFemale.law.item, "9");
  assert.equal(r.criteria.values.minHbMale, 13);
  assert.equal(r.criteria.sources.minHbMale.who.ref, "4.6.1");
  assert.deepEqual(r.criteria.limits.minWeightKg450, { value: 55, exclusive: true });
  assert.deepEqual(r.saved, {});
  H.org("org-n", H.OWNER_A);
  assert.equal((await api("/org/blood-donor-criteria?orgId=org-n", "GET", null, H.OWNER_A)).__status, 409);
});

test("POST /api/queue/org/blood-donor-criteria: 401, nurse 403, another hospital refused, a value looser than WHO or the law 422 by name, all with nothing written", async () => {
  seedWsq();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  const body = { orgId: "org-a", criteria: STRICTER };
  assert.equal((await api("/org/blood-donor-criteria", "POST", body)).__status, 401);
  assert.equal((await api("/org/blood-donor-criteria", "POST", body, H.NURSE_A)).__status, 403);
  const other = await api("/org/blood-donor-criteria", "POST", body, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const loose = await api("/org/blood-donor-criteria", "POST", { orgId: "org-a", criteria: { ...STRICTER, minHbFemale: 12, minHbMale: 12.5, minWeightKg450: 55, deferrals: { malaria: 90 }, bogus: 1 } }, H.HR_A);
  assert.equal(loose.__status, 422, JSON.stringify(loose));
  assert.match(loose.errors.minHbFemale, /stricter than the law: at least 12.5/);
  assert.match(loose.errors.minHbMale, /stricter than the standard: at least 13/);
  assert.match(loose.errors.minWeightKg450, /more than 55/);
  assert.match(loose.errors["deferrals.malaria"], /at least 183/);
  assert.match(loose.errors.bogus, /not a donor criterion/);
  assert.match(loose.message, /Nothing was saved/);
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
  assert.equal(events().length, 0);
});

test("POST /api/queue/org/blood-donor-criteria: the admin saves stricter values; read-back names this hospital as the source; audited by name; blank returns to the standard", async () => {
  seedWsq();
  const r = await api("/org/blood-donor-criteria", "POST", { orgId: "org-a", criteria: STRICTER }, H.HR_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const names = ["deferrals.tattoo", "intervalDaysFemale", "minHbFemale", "systolicMax"];
  assert.deepEqual(r.changed.sort(), names);
  assert.equal(r.criteria.values.minHbFemale, 13);
  assert.equal(r.criteria.sources.minHbFemale.source, "hospital");
  assert.equal(r.criteria.deferrals.tattoo.days, 400);
  assert.equal(r.criteria.values.maxAge, 65, "blank keeps the standard");
  assert.deepEqual(cfg().bloodDonorCriteria, { minHbFemale: 13, intervalDaysFemale: 150, systolicMax: 130, deferrals: { tattoo: 400 } });
  assert.equal(cfg().lactationWindowDays, 42, "other hospital config untouched");
  const ev = events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, H.uidFor(H.HR_A));
  assert.deepEqual(JSON.parse(ev[0].meta).changed.sort(), names);
  assert.doesNotMatch(ev[0].meta, /400|150/, "the audit row names criteria, not values");
  const again = await api("/org/blood-donor-criteria", "POST", { orgId: "org-a", criteria: STRICTER }, H.HR_A);
  assert.deepEqual(again.changed, []);
  assert.equal(events().length, 1, "a save that changes nothing writes no audit row");
  const back = await api("/org/blood-donor-criteria", "POST", { orgId: "org-a", criteria: { minHbFemale: null } }, H.HR_A);
  assert.equal(back.criteria.values.minHbFemale, 12.5);
  assert.equal(back.criteria.sources.minHbFemale.source, "law");
  assert.deepEqual(cfg().bloodDonorCriteria, {});
});

test("a save whose commit fails reports failure and leaves the criteria and the audit trail unchanged", async () => {
  seedWsq();
  H.fail.commits = true;
  const r = await api("/org/blood-donor-criteria", "POST", { orgId: "org-a", criteria: STRICTER }, H.HR_A);
  H.fail.commits = false;
  assert.equal(r.ok, false);
  assert.equal(cfg().bloodDonorCriteria, undefined);
  assert.equal(events().length, 0);
});
