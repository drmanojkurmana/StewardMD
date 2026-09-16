/* test/org-blood-centre-settings.test.mjs - the per-hospital blood centre settings (legal opinion 2026-09-17, section G):
 * NAT required, shorter component shelf lives, longer sample and record retention. Never looser than the Drugs and
 * Cosmetics Rules; the rules themselves are in test/wardsynq-blood-centre.test.mjs.
 *
 * Routes: GET /api/queue/org/blood-centre-settings, POST /api/queue/org/blood-centre-settings.
 * Pinned: no session 401; a member without staff.admin 403 and nothing written; another hospital's admin refused; a value
 * looser than the Rules 422 by name with nothing written; the admin's save is audited (settings named, not values), the
 * response is the server's read-back, other config is untouched, and blank goes back to the Rules.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/org-blood-centre-settings.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs } = H;

const cfg = () => docs.get("q_orgs/org-a").fields.wardsynq || {};
const events = () => [...docs.values()].map((d) => d.fields).filter((f) => f.action === "org:blood_centre_settings");
function seedWsq() {
  H.seed();
  Object.assign(docs.get("q_orgs/org-a").fields, { mode: "wardsynq", wardsynq: { lactationWindowDays: 42, retention: { years: { "clinical-opd": 12 }, minorYearsAfter18: 4 } } });
}
const STRICTER = { natRequired: true, sampleRetentionDays: 10, recordRetentionYears: 8, shelfHours: { platelets: 72, prbc: "" } };

test("GET /api/queue/org/blood-centre-settings: 401, 403 without staff.admin, another hospital refused; the admin reads the Rules' values with their sources", async () => {
  seedWsq();
  assert.equal((await api("/org/blood-centre-settings?orgId=org-a")).__status, 401);
  assert.equal((await api("/org/blood-centre-settings?orgId=org-a", "GET", null, H.NURSE_A)).__status, 403);
  const other = await api("/org/blood-centre-settings?orgId=org-a", "GET", null, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const r = await api("/org/blood-centre-settings?orgId=org-a", "GET", null, H.HR_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.centre.natRequired, false);
  assert.equal(r.centre.sampleRetentionDays, 7);
  assert.equal(r.centre.recordRetentionYears, 5);
  assert.match(r.centre.recordRetention.ref, /heading L NOTE; rule 122-P\(i\)\(c\)/);
  assert.equal(r.centre.components.find((c) => c.component === "platelets").longestHours, 120);
  assert.deepEqual(r.centre.saved, {});
});

test("POST /api/queue/org/blood-centre-settings: 401, nurse 403, another hospital refused, a looser value 422 by name, all with nothing written", async () => {
  seedWsq();
  const before = JSON.stringify(docs.get("q_orgs/org-a").fields);
  const body = { orgId: "org-a", settings: STRICTER };
  assert.equal((await api("/org/blood-centre-settings", "POST", body)).__status, 401);
  assert.equal((await api("/org/blood-centre-settings", "POST", body, H.NURSE_A)).__status, 403);
  const other = await api("/org/blood-centre-settings", "POST", body, H.HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const loose = await api("/org/blood-centre-settings", "POST", { orgId: "org-a", settings: { sampleRetentionDays: 5, recordRetentionYears: 3, shelfHours: { ffp: 9000, blood: 1 } } }, H.HR_A);
  assert.equal(loose.__status, 422, JSON.stringify(loose));
  assert.match(loose.errors.sampleRetentionDays, /only be longer than the Rules/);
  assert.match(loose.errors.recordRetentionYears, /from 5 to 100/);
  assert.match(loose.errors["shelfHours.ffp"], /only be shorter than the Rules: a whole number of hours from 1 to 8760/);
  assert.match(loose.errors["shelfHours.blood"], /not a component/);
  assert.match(loose.message, /Nothing was saved/);
  assert.equal(JSON.stringify(docs.get("q_orgs/org-a").fields), before);
  assert.equal(events().length, 0);
});

test("POST /api/queue/org/blood-centre-settings: the admin saves stricter settings; read-back; audited by name only; blank returns to the Rules", async () => {
  seedWsq();
  const r = await api("/org/blood-centre-settings", "POST", { orgId: "org-a", settings: STRICTER }, H.HR_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const names = ["natRequired", "recordRetentionYears", "sampleRetentionDays", "shelfHours.platelets"];
  assert.deepEqual(r.changed.sort(), names);
  assert.deepEqual([r.centre.natRequired, r.centre.sampleRetentionDays, r.centre.recordRetentionYears], [true, 10, 8]);
  assert.equal(r.centre.components.find((c) => c.component === "platelets").variants[0].hours, 72);
  assert.deepEqual(cfg().bloodCentre, { natRequired: true, sampleRetentionDays: 10, shelfHours: { platelets: 72 } });
  // The record period is retention.js's blood-centre class (merge 2026-09-17), not a second setting in bloodCentre.
  assert.deepEqual(cfg().retention, { years: { "clinical-opd": 12, "blood-centre": 8 }, minorYearsAfter18: 4 }, "saved into the class; other classes kept");
  assert.equal(cfg().lactationWindowDays, 42, "other hospital config untouched");
  const ev = events();
  assert.equal(ev.length, 1);
  assert.deepEqual(JSON.parse(ev[0].meta).changed.sort(), names);
  assert.doesNotMatch(ev[0].meta, /72|10|true/, "the audit row names settings, not values");
  assert.deepEqual((await api("/org/blood-centre-settings", "POST", { orgId: "org-a", settings: STRICTER }, H.HR_A)).changed, []);
  assert.equal(events().length, 1, "a save that changes nothing writes no audit row");
  const back = await api("/org/blood-centre-settings", "POST", { orgId: "org-a", settings: {} }, H.HR_A);
  assert.deepEqual([back.centre.natRequired, back.centre.sampleRetentionDays, back.centre.recordRetentionYears], [false, 7, 5]);
  assert.deepEqual(cfg().bloodCentre, {});
  assert.deepEqual(cfg().retention, { years: { "clinical-opd": 12 }, minorYearsAfter18: 4 }, "blank returns the class to its floor");
});

test("GET /api/queue/org/blood-centre-settings: the record period is the retention class, never below five years", async () => {
  seedWsq();
  docs.get("q_orgs/org-a").fields.wardsynq.retention = { years: { "blood-centre": 3 } };
  const low = await api("/org/blood-centre-settings?orgId=org-a", "GET", null, H.HR_A);
  assert.deepEqual([low.centre.recordRetentionYears, low.centre.saved.recordRetentionYears], [5, undefined]);
  docs.get("q_orgs/org-a").fields.wardsynq.retention = { years: { "blood-centre": 9 } };
  const long = await api("/org/blood-centre-settings?orgId=org-a", "GET", null, H.HR_A);
  assert.deepEqual([long.centre.recordRetentionYears, long.centre.saved.recordRetentionYears], [9, 9]);
});
