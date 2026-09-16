/* Owner 2026-09-16: who gave the drug and who asked for it, named on the chart by name and employee id.
 *
 *   functions/_wardsynq/staff-identity.js     membersForIds, staffIdentity (unit)
 *   functions/_opd_org.js                     membership displayName / employeeId, notAName (unit)
 *   GET  /api/queue/ward/staff-identities     name, employee id and role of THIS hospital's staff, audited
 *   POST /api/queue/member                    the admin records the name and employee id (Admin Center, Staff)
 *
 * The screen half is test/ward-staff-identity-view.test.mjs.
 * node --test --experimental-test-module-mocks test/wardsynq-staff-identity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { H, docs, seedHospital, as, sanitize, idFor, ORG, NURSE, ADMIN, OTHER_DOCTOR, DOCTOR } from "./_wardsynq-alert-harness.mjs";
import { membersForIds, staffIdentity } from "../functions/_wardsynq/staff-identity.js";
import { membership, notAName } from "../functions/_opd_org.js";

const PATH = "/ward/staff-identities?orgId=" + ORG + "&ids=";
const member = (identity, fields) => docs.set(`q_members/${sanitize(ORG)}__${sanitize(identity)}`, { fields: { orgId: ORG, identity, active: true, ...fields }, updateTime: "t1" });
const identityReads = () => H.RECORD.audit.filter((e) => e.action === "staff.identity.read");

test("notAName and membership: a mobile number, an email or an account id is never kept as a name; an employee id is what the hospital typed", () => {
  for (const v of ["9876543210", "+91 98765 43210", "anitha@h.test", "cfa:abc", "fb:UID", "ghis:1042"]) assert.equal(notAName(v), true, v);
  for (const v of ["Sister Anitha R", "Dr. K. Rao", "nurse1", "EMP-1042"]) assert.equal(notAName(v), false, v);
  const m = membership({ id: "x", orgId: "o", identity: "nurse1", role: "nurse", displayName: "  Sister Anitha R ", employeeId: "1042567" });
  assert.equal(m.displayName, "Sister Anitha R");
  assert.equal(m.employeeId, "1042567", "numeric employee ids are normal");
  assert.equal(membership({ id: "x", identity: "n", role: "nurse", displayName: "9876543210", employeeId: "cfa:abc" }).displayName, "");
  assert.equal(membership({ id: "x", identity: "n", role: "nurse", employeeId: "cfa:abc" }).employeeId, "");
});

test("staffIdentity: name, employee id and role only; the chosen staff sign-in ID stands in for a missing employee id, never an email or number", () => {
  assert.deepEqual(staffIdentity({ identity: "cfa:x", email: "a@h.test", displayName: "Sister Anitha R", employeeId: "EMP-1042", role: "nurse", alertMobile: "9876500002", regNo: "R1" }),
    { name: "Sister Anitha R", employeeId: "EMP-1042", role: "nurse" });
  assert.deepEqual(staffIdentity({ identity: "nurse1", role: "nurse" }), { name: null, employeeId: "nurse1", role: "nurse" });
  assert.deepEqual(staffIdentity({ identity: "8897298117", role: "doctor" }), { name: null, employeeId: null, role: "doctor" });
  assert.deepEqual(staffIdentity({ identity: "doc@h.test", role: "doctor" }), { name: null, employeeId: null, role: "doctor" });
  assert.equal(staffIdentity(null), null);
});

test("membersForIds: matched in this hospital's members by identity, sign-in email, account email and Access hash; beyond the listing by a direct read", async () => {
  const members = [{ identity: "nurse1", role: "nurse" }, { identity: "EMP9", email: "doc@h.test", role: "doctor" }];
  const extra = { identity: "late-joiner", role: "nurse" };
  const dir = {
    accountEmail: async (id) => (id === "fb:G1" ? "doc@h.test" : null),
    accessIdOf: async (email) => "cfa:" + email,
    getMember: async (identity) => (identity === "late-joiner" ? extra : null),
  };
  const found = await membersForIds(members, ["NURSE1", "fb:G1", "cfa:doc@h.test", "late-joiner", "stranger"], dir);
  assert.equal(found.get("NURSE1").identity, "nurse1");
  assert.equal(found.get("fb:G1").identity, "EMP9");
  assert.equal(found.get("cfa:doc@h.test").identity, "EMP9");
  assert.equal(found.get("late-joiner"), extra);
  assert.equal(found.get("stranger"), null);
});

test("GET /api/queue/ward/staff-identities: no session 401; another hospital's member 403; a role that reads no chart, order or sample 403; nothing resolved, nothing audited", async () => {
  seedHospital();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor("hr1@h.test"))}`, { fields: { orgId: ORG, identity: idFor("hr1@h.test"), role: "hr", active: true }, updateTime: "t1" });
  const q = PATH + encodeURIComponent(idFor(NURSE));
  const none = await as(null, q);
  assert.equal(none.__status, 401);
  const other = await as(OTHER_DOCTOR, q);
  assert.equal(other.__status, 403, JSON.stringify(other));
  assert.equal(other.identities, undefined);
  const hr = await as("hr1@h.test", q);
  assert.equal(hr.__status, 403, "hr holds staff.admin but reads no chart");
  assert.equal(hr.identities, undefined);
  assert.equal(identityReads().length, 0, "a refusal reads and audits nothing");
});

test("GET /api/queue/ward/staff-identities: a nurse gets name, employee id and role of this hospital's staff, in one audited read; another hospital's staff and a stranger stay unresolved", async () => {
  seedHospital();
  member(idFor(NURSE), { role: "nurse", displayName: "Sister Anitha R", employeeId: "EMP-1042", alertMobile: "9876500002", email: NURSE });
  member("8897298117", { role: "doctor" });
  const ids = [idFor(NURSE), "nurse1", idFor(DOCTOR), "8897298117", "nurse9", "fb:NOBODY", "system:bed-claim"];
  const r = await as(NURSE, PATH + encodeURIComponent(ids.join(",")));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.identities[idFor(NURSE)], { name: "Sister Anitha R", employeeId: "EMP-1042", role: "nurse" });
  assert.deepEqual(r.identities.nurse1, { name: null, employeeId: "nurse1", role: "nurse" }, "the staff ID the hospital chose");
  assert.deepEqual(r.identities[idFor(DOCTOR)], { name: null, employeeId: null, role: "doctor" }, "no account id as an employee id");
  assert.deepEqual(r.identities["8897298117"], { name: null, employeeId: null, role: "doctor" }, "a mobile number is neither");
  assert.equal(r.identities.nurse9, null, "a nurse of ANOTHER hospital is never resolved here");
  assert.equal(r.identities["fb:NOBODY"], null);
  assert.deepEqual(r.identities["system:bed-claim"], { system: true });
  const body = JSON.stringify(r);
  for (const leak of ["9876500002", NURSE, "alertMobile", "email", "regNo"]) assert.ok(!body.includes(leak), "never returned: " + leak);
  const rows = identityReads();
  assert.equal(rows.length, 1, "one audit row for the whole batch");
  assert.equal(rows[0].actor, idFor(NURSE));
  assert.deepEqual(rows[0].scope, { purpose: "chart-actor-names", asked: ids.length, resolved: 4 });
});

test("GET /api/queue/ward/staff-identities: a pharmacist (orders, no emr.view) may read who prescribed and verified", async () => {
  seedHospital();
  member(idFor("pharm@h.test"), { role: "pharmacy" });
  const r = await as("pharm@h.test", PATH + "nurse1");
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.identities.nurse1, { name: null, employeeId: "nurse1", role: "nurse" });
});

test("POST /api/queue/member: the admin records a name and employee id; a mobile number as a name is refused and nothing is written", async () => {
  seedHospital();
  const bad = await as(ADMIN, "/member", "POST", { orgId: ORG, identity: "nurse1", role: "nurse", displayName: "9876543210" });
  assert.equal(bad.__status, 422, JSON.stringify(bad));
  assert.equal(docs.get(`q_members/${sanitize(ORG)}__nurse1`).fields.displayName, undefined);
  const ok = await as(ADMIN, "/member", "POST", { orgId: ORG, identity: "nurse1", role: "nurse", displayName: "Sister Anitha R", employeeId: "EMP-1042" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const again = await as(ADMIN, "/member", "POST", { orgId: ORG, identity: "nurse1", role: "nurse", regNo: "" });
  assert.equal(again.__status, 200);
  const r = await as(NURSE, PATH + "nurse1");
  assert.deepEqual(r.identities.nurse1, { name: "Sister Anitha R", employeeId: "EMP-1042", role: "nurse" }, "an edit about something else keeps the name");
  const nurse = await as(NURSE, "/member", "POST", { orgId: ORG, identity: "nurse1", role: "nurse", displayName: "Someone Else" });
  assert.equal(nurse.__status, 403, "only staff.admin records it");
});
