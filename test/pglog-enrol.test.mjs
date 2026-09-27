/* test/pglog-enrol.test.mjs — getting residents INTO the logbook, without weakening who may sign it.
 *
 * The usability audit: residents called the NMC eLogbook "a very hard, strict framework". Server
 * side, that was four dead ends: no guide could be assigned (so the monthly authentication of
 * PGMER-2023 5.2(vii) was unreachable), a blank supervisor was refused although NMC names none per
 * entry, an email not yet signed in could not be enrolled, and a resident could not ask to join.
 * Each is fixed in functions/_pglog_enrol.js / _pglog_store.js; each fix is pinned here together
 * with the invariant it must NOT break (vault/modules/NMC Logbook.md):
 *   - the role is never self-declared (it comes from q_members, written by someone else)
 *   - nobody assigns themselves a role or makes themselves a guide
 *   - no self-verification; only the guide / named supervisor / HoD may sign
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = require("../pglog-model.js");
const S = await import("../functions/_pglog_store.js");
const E = await import("../functions/_pglog_enrol.js");
const { CAPS, can } = await import("../functions/_queue_roles.js");

const ORG = "org1";
const ORG_CODE = "SMD-ABC123";
const env = {};
const CELL = "fb:Cell-1";
const HOD = "fb:Hod-1";
const GUIDE = "fb:Guide-1";
const OTHER_FAC = "fb:Fac-2";          // faculty in another department
const RES_UID = "Res-1";               // Firebase uid (case-sensitive), identity "fb:Res-1"

/* An in-memory Firestore + org/membership layer that behaves like _fbfirestore.js and
 * _opd_org_store.js closely enough for the enrol path. */
function world() {
  const docs = new Map();
  const mems = new Map();              // orgId|lower(identity) -> membership
  const notes = [];
  const orgs = new Map([[ORG, { id: ORG, code: ORG_CODE, name: "Govt Medical College" }]]);
  const accounts = new Map([["res@x.edu", { uid: RES_UID, email: "res@x.edu", name: "Dr Resident" }],
                            ["cell@x.edu", { uid: "Cell-1", email: "cell@x.edu", name: "Cell" }]]);
  const k = (o, id) => o + "|" + String(id).toLowerCase();
  const db = {
    docs, mems, notes, orgs, accounts,
    now: () => Date.UTC(2026, 7, 27),
    async fsGet(env, path) {
      const f = docs.get(String(path));
      return f ? { id: String(path).split("/").pop(), fields: JSON.parse(JSON.stringify(f)) } : null;
    },
    async fsQuery(env, col, opts) {
      const w = (opts && opts.where) || null;
      const out = [];
      for (const [path, f] of docs) {
        if (!path.startsWith(col + "/") || path.slice(col.length + 1).includes("/")) continue;
        if (w && String(f[w.field] == null ? "" : f[w.field]) !== String(w.value)) continue;
        out.push({ id: path.split("/").pop(), fields: JSON.parse(JSON.stringify(f)) });
      }
      return out.slice(0, (opts && opts.limit) || 1000);
    },
    async fsCommit(env, writes) {
      for (const w of writes || []) if (w.__exists === false && docs.has(w.__path)) throw Object.assign(new Error("fs_precondition"), { code: "precondition" });
      for (const w of writes || []) {
        const cur = docs.get(w.__path) || {};
        docs.set(w.__path, Object.assign({}, w.__mask ? cur : {}, JSON.parse(JSON.stringify(w.__fields))));
      }
    },
    wCreate: (env, path, fields) => ({ __path: path, __fields: fields, __exists: false }),
    wUpdate: (env, path, fields) => ({ __path: path, __fields: fields, __mask: true }),
    async qAudit() {},
    async sendNativePush() { return { sent: 1 }; },
    async getOrg(env, id) { return orgs.get(id) || null; },
    async resolveOrgId(env, code) {
      for (const o of orgs.values()) if (o.code === String(code).toUpperCase() || o.id === code) return o.id;
      return String(code).replace(/[^A-Za-z0-9_-]/g, "-");
    },
    async getMembership(env, orgId, identity) { return mems.get(k(orgId, identity)) || null; },
    async setMembership(env, orgId, identity, body, actor) {
      const prev = mems.get(k(orgId, identity));
      const role = body.role || (prev && prev.role);
      const m = { identity: String(identity).toLowerCase(), orgId, role,
                  scope: body.scope !== undefined ? body.scope : (prev ? prev.scope : { departments: [] }),
                  displayName: body.displayName !== undefined ? body.displayName : (prev && prev.displayName) || "",
                  active: true, setBy: actor };
      mems.set(k(orgId, identity), m);
      return m;
    },
    async listMembers(env, orgId) { return Array.from(mems.values()).filter((m) => m.orgId === orgId); },
    async lookupUidByEmail(env, email) { return accounts.get(String(email).toLowerCase()) || null; },
    // The real gate() reads q_orgs + q_members; this is the same decision over the fake.
    async gate(env, actorUid, orgId, cap) {
      const m = mems.get(k(orgId, actorUid));
      if (!m || m.active === false) throw Object.assign(new Error("forbidden"), { status: 403 });
      if (cap && !can(m.role, cap)) throw Object.assign(new Error("forbidden"), { status: 403 });
      return { role: m.role, member: m };
    }
  };
  // notify() writes an inbox row; capture them by reading pg_notifs later.
  db.inbox = () => Array.from(docs.entries()).filter(([p]) => p.startsWith("pg_notifs/")).map(([, f]) => f);
  return db;
}

async function seed(db, opts = {}) {
  db.mems.set(ORG + "|" + CELL.toLowerCase(), { identity: CELL.toLowerCase(), orgId: ORG, role: "academic_cell", scope: { departments: [] }, active: true });
  db.mems.set(ORG + "|" + HOD.toLowerCase(), { identity: HOD.toLowerCase(), orgId: ORG, role: "pg_hod", scope: { departments: ["dept-med"] }, active: true, displayName: "Dr Head" });
  db.mems.set(ORG + "|" + GUIDE.toLowerCase(), { identity: GUIDE.toLowerCase(), orgId: ORG, role: "pg_faculty", scope: { departments: ["dept-med"] }, active: true });
  db.mems.set(ORG + "|" + OTHER_FAC.toLowerCase(), { identity: OTHER_FAC.toLowerCase(), orgId: ORG, role: "pg_faculty", scope: { departments: ["dept-surg"] }, active: true });
  const prog = await S.createProgramme(env, ORG, {
    name: "MD General Medicine", degree: opts.degree || "MD", specialtyId: "general-medicine",
    curriculumId: "general-medicine", departmentId: "dept-med", durationMonths: 36
  }, CELL, db);
  return { prog };
}

/* ── 1. guides can be assigned ─────────────────────────────────────────────── */

test("enrol accepts a guide who is faculty of the same department", async () => {
  const db = world();
  const { prog } = await seed(db);
  const r = await E.enrolOne(env, { orgId: ORG, actorUid: CELL,
    row: { email: "res@x.edu", role: "pg_resident", programmeId: prog.id, guide: GUIDE, trainingYear: 2, startDate: "2025-07-01" } }, db);
  assert.equal(r.ok, true);
  assert.ok(M.sameActor(r.resident.guide, GUIDE), "the guide is recorded on the training record");
  assert.equal(r.resident.trainingYear, 2, "the year is what was chosen, not hard-coded 1");
  assert.equal(r.resident.uid, "fb:" + RES_UID, "the uid keeps its case, so /me finds the resident");
  // the ROLE came from the Academic Cell's call into q_members, not from the resident
  const m = await db.getMembership(env, ORG, "fb:" + RES_UID);
  assert.equal(m.role, "pg_resident");
  assert.equal(m.setBy, CELL);
});

test("a guide must be pg_faculty / pg_hod of THIS org, in scope, and not the resident", async () => {
  const db = world();
  const { prog } = await seed(db);
  const row = (guide) => ({ email: "res@x.edu", role: "pg_resident", programmeId: prog.id, guide });
  await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL, row: row("fb:nobody") }, db), /guide_not_faculty/);
  await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL, row: row(CELL) }, db), /cannot_assign_self_as_guide/,
    "the Academic Cell cannot name itself (it is not faculty either)");
  await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL, row: row(OTHER_FAC) }, db), /guide_out_of_scope/,
    "a surgeon scoped to surgery could not verify a medicine resident's entries");
  await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL, row: row("fb:" + RES_UID) }, db), /guide_is_resident/);
});

test("trainingYear accepts 1..3 and refuses anything else", async () => {
  const db = world();
  const { prog } = await seed(db);
  for (const bad of [0, 4, 2.5, "x"]) {
    await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL,
      row: { email: "res@x.edu", role: "pg_resident", programmeId: prog.id, trainingYear: bad } }, db), /training_year_invalid/);
  }
  assert.deepEqual(E.parseTrainingYear(3), { ok: true, value: 3 });
  assert.deepEqual(E.parseTrainingYear(""), { ok: true, value: undefined });
});

test("nobody re-roles themselves through enrol", async () => {
  const db = world();
  const { prog } = await seed(db);
  await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL,
    row: { email: "cell@x.edu", role: "pg_hod", programmeId: prog.id } }, db), /cannot_assign_self/);
  assert.equal((await db.getMembership(env, ORG, CELL)).role, "academic_cell", "the membership was not overwritten");
});

test("re-enrolling (e.g. a bulk re-upload) never wipes a guide that was set since", async () => {
  const db = world();
  const { prog } = await seed(db);
  await E.enrolOne(env, { orgId: ORG, actorUid: CELL, row: { email: "res@x.edu", role: "pg_resident", programmeId: prog.id, guide: GUIDE, trainingYear: 2 } }, db);
  const again = await E.enrolOne(env, { orgId: ORG, actorUid: CELL, row: { email: "res@x.edu", role: "pg_resident", programmeId: prog.id } }, db);
  assert.ok(M.sameActor(again.resident.guide, GUIDE));
  assert.equal(again.resident.trainingYear, 2);
});

test("updateResident assigning a guide moves unassigned submitted entries into their queue", async () => {
  const db = world();
  const { prog } = await seed(db);
  const { resident } = await E.enrolOne(env, { orgId: ORG, actorUid: CELL,
    row: { email: "res@x.edu", role: "pg_resident", programmeId: prog.id, startDate: "2025-07-01" } }, db);
  const e = await S.createEntry(env, ORG, { residentId: resident.id, kind: "clinical", occurredAt: "2026-08-20",
    title: "Febrile illness", role: "performed_supervised", setting: "opd" }, resident.uid, db);
  const sub = await S.submitEntry(env, e.id, resident.uid, db);
  assert.equal(sub.routing, "unassigned");
  assert.equal((await S.pendingForFaculty(env, ORG, GUIDE, db)).length, 0);
  await S.updateResident(env, resident.id, { guide: GUIDE }, HOD, db);
  const q = await S.pendingForFaculty(env, ORG, GUIDE, db);
  assert.equal(q.length, 1, "the guide now has it");
  assert.equal(q[0].supervisor, "", "the record still truthfully names no supervisor");
  assert.equal((await S.pendingUnassigned(env, ORG, [], db)).length, 0, "and it left the unassigned pool");
});

/* ── 2. supervisor defaults to the guide ──────────────────────────────────── */

async function enrolled(db, over = {}) {
  const { prog } = await seed(db, over);
  const { resident } = await E.enrolOne(env, { orgId: ORG, actorUid: CELL,
    row: Object.assign({ email: "res@x.edu", role: "pg_resident", programmeId: prog.id, startDate: "2025-07-01" }, over.row || {}) }, db);
  return resident;
}
const clinical = (res, over = {}) => Object.assign({ residentId: res.id, kind: "clinical", occurredAt: "2026-08-20",
  title: "Febrile illness", role: "performed_supervised", setting: "opd", departmentId: "dept-med" }, over);

test("a blank supervisor defaults to the resident's guide", async () => {
  const db = world();
  const res = await enrolled(db, { row: { guide: GUIDE } });
  const e = await S.createEntry(env, ORG, clinical(res), res.uid, db);
  const sub = await S.submitEntry(env, e.id, res.uid, db);
  assert.equal(sub.status, "submitted");
  assert.equal(sub.routing, "guide");
  assert.ok(M.sameActor(sub.supervisor, GUIDE));
  assert.equal((await S.pendingForFaculty(env, ORG, GUIDE, db)).length, 1);
});

test("no guide either: accepted with no supervisor, queued for the HoD, and only guide/HoD may sign", async () => {
  const db = world();
  const res = await enrolled(db);
  const e = await S.createEntry(env, ORG, clinical(res), res.uid, db);
  const sub = await S.submitEntry(env, e.id, res.uid, db);
  assert.equal(sub.status, "submitted");
  assert.equal(sub.supervisor, "");
  assert.equal(sub.routing, "unassigned");
  const pool = await S.pendingUnassigned(env, ORG, ["dept-med"], db);
  assert.equal(pool.length, 1, "an HoD of the department sees it");
  assert.equal((await S.pendingUnassigned(env, ORG, ["dept-surg"], db)).length, 0, "an HoD of another department does not");
  assert.ok(db.inbox().some((n) => n.kind === "verify_pending_unassigned" && n.to === HOD.toLowerCase().replace(/^fb:/, "")),
    "the HoD was told");

  const signer = { uid: "x", regNo: "KMC-1", council: "KMC", name: "Dr", source: "register" };
  // an unrelated faculty member cannot sign it
  await assert.rejects(() => S.verifyEntry(env, e.id, OTHER_FAC, "", Object.assign({}, db, {
    gate: async () => ({ role: "pg_faculty" }), signerSnapshot: async () => signer })), /not_the_named_supervisor/);
  // the resident cannot either (no self-verification)
  await assert.rejects(() => S.verifyEntry(env, e.id, res.uid, "", Object.assign({}, db, {
    gate: async () => ({ role: "pg_hod" }), signerSnapshot: async () => signer })), /pglog_self_verify_forbidden/);
  // the HoD can
  const v = await S.verifyEntry(env, e.id, HOD, "", Object.assign({}, db, {
    gate: async () => ({ role: "pg_hod" }), signerSnapshot: async () => signer, issueCode: async () => "" }));
  assert.equal(v.status, "verified");
});

test("PGLOG_SUPERVISOR_FALLBACK=0 restores the refusal", async () => {
  const db = world();
  const res = await enrolled(db, { row: { guide: GUIDE } });
  const e = await S.createEntry(env, ORG, clinical(res), res.uid, db);
  await assert.rejects(() => S.submitEntry({ PGLOG_SUPERVISOR_FALLBACK: "0" }, e.id, res.uid, db),
    (err) => err.message === "supervisor_unresolved" && err.status === 400);
  assert.equal((await S.getEntry(env, e.id, db)).status, "draft");
});

test("a TYPED supervisor that does not resolve is still refused, not re-routed to the guide", async () => {
  const db = world();
  const res = await enrolled(db, { row: { guide: GUIDE } });
  const e = await S.createEntry(env, ORG, clinical(res, { supervisor: "Dr Nobody" }), res.uid, db);
  await assert.rejects(() => S.submitEntry(env, e.id, res.uid, db), /supervisor_unresolved/);
});

test("MS / M.Ch procedure entries still require a NAMED supervisor; the guide is not assumed", async () => {
  const db = world();
  const res = await enrolled(db, { degree: "MS", row: { guide: GUIDE } });
  await assert.rejects(() => S.createEntry(env, ORG, { residentId: res.id, kind: "procedure", occurredAt: "2026-08-20",
    procedureText: "Appendicectomy", role: "performed_supervised", departmentId: "dept-med" }, res.uid, db), /validation/);
});

/* ── 3. names on the roster and in the queue ─────────────────────────────── */

test("the roster carries display names and never an email or phone", async () => {
  const db = world();
  await seed(db);
  db.mems.get(ORG + "|" + GUIDE.toLowerCase()).email = "guide@x.edu";
  await S.rememberName(env, GUIDE, "Dr Guide Kumar", db);
  await S.rememberName(env, OTHER_FAC, "someone@x.edu", db);     // an email is not a name
  const roster = await S.facultyRosterNamed(env, ORG, db);
  const byId = Object.fromEntries(roster.map((r) => [r.identity, r]));
  assert.equal(byId[GUIDE.toLowerCase()].name, "Dr Guide Kumar");
  assert.equal(byId[HOD.toLowerCase()].name, "Dr Head", "the org's own registry name wins");
  assert.equal(byId[OTHER_FAC.toLowerCase()].name, "");
  assert.ok(!(CELL.toLowerCase() in byId), "the Academic Cell does not verify, so it is not on the roster");
  assert.ok(!JSON.stringify(roster).includes("@"), "no email anywhere in the payload");
});

test("residentNames resolves the enrolled name for a verification queue", async () => {
  const db = world();
  const res = await enrolled(db, { row: { name: "Dr Asha" } });
  assert.deepEqual(await S.residentNames(env, [res.id, res.id], db), { [res.id]: "Dr Asha" });
});

/* ── 7. join requests ────────────────────────────────────────────────────── */

test("a join request records a wish and grants NOTHING until approved", async () => {
  const db = world();
  await seed(db);
  const r = await E.createJoinRequest(env, { actorUid: "fb:" + RES_UID, email: "res@x.edu", name: "Dr R",
    orgCode: "smd-abc123", programmeHint: "MD Medicine", note: "Joined July" }, db);
  assert.equal(r.joinRequest.status, "pending");
  assert.equal(await db.getMembership(env, ORG, "fb:" + RES_UID), null, "no membership, no role");
  const self = E.publicJoinRequestForSelf(await E.myJoinRequest(env, "fb:" + RES_UID, db));
  assert.equal(self.status, "pending");
  assert.equal(self.orgName, "Govt Medical College");
  // asking again is idempotent, not a second request
  const again = await E.createJoinRequest(env, { actorUid: "fb:" + RES_UID, orgCode: ORG_CODE }, db);
  assert.equal(again.existing, true);
  assert.equal((await E.listJoinRequests(env, ORG, "pending", db)).length, 1);
  assert.ok(db.inbox().some((n) => n.kind === "join_request"), "the Academic Cell / HoD were told");
});

test("an unknown code, an existing member and too many pending requests are refused", async () => {
  const db = world();
  await seed(db);
  await assert.rejects(() => E.createJoinRequest(env, { actorUid: "fb:x", orgCode: "SMD-ZZZZZZ" }, db), /org_not_found/);
  await assert.rejects(() => E.createJoinRequest(env, { actorUid: GUIDE, orgCode: ORG_CODE }, db), /already_member/);
  for (let i = 0; i < E.MAX_PENDING_JOIN; i++) {
    db.orgs.set("o" + i, { id: "o" + i, code: "SMD-00000" + i, name: "C" + i });
    await E.createJoinRequest(env, { actorUid: "fb:spam", orgCode: "SMD-00000" + i }, db);
  }
  await assert.rejects(() => E.createJoinRequest(env, { actorUid: "fb:spam", orgCode: ORG_CODE }, db), /too_many_pending/);
});

test("approval enrols through the SAME path as /enrol, as pg_resident only", async () => {
  const db = world();
  const { prog } = await seed(db);
  const { joinRequest } = await E.createJoinRequest(env, { actorUid: "fb:" + RES_UID, orgCode: ORG_CODE, name: "Dr R" }, db);
  const r = await E.approveJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: HOD, deptScope: ["dept-med"],
    body: { programmeId: prog.id, guide: GUIDE, trainingYear: 3, startDate: "2024-07-01" } }, db);
  assert.equal(r.role, "pg_resident");
  assert.equal((await db.getMembership(env, ORG, "fb:" + RES_UID)).role, "pg_resident");
  assert.equal((await db.getMembership(env, ORG, "fb:" + RES_UID)).setBy, HOD, "written by the approver");
  assert.equal(r.resident.trainingYear, 3);
  assert.ok(M.sameActor(r.resident.guide, GUIDE));
  assert.equal(r.joinRequest.status, "approved");
  assert.equal((await E.myJoinRequest(env, "fb:" + RES_UID, db)).status, "approved");
  await assert.rejects(() => E.approveJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: HOD, body: { programmeId: prog.id } }, db),
    /join_request_not_pending/, "an answered request cannot be approved twice");
});

test("an HoD cannot approve into a programme outside their department, and nobody approves themselves", async () => {
  const db = world();
  const { prog } = await seed(db);
  const { joinRequest } = await E.createJoinRequest(env, { actorUid: "fb:" + RES_UID, orgCode: ORG_CODE }, db);
  await assert.rejects(() => E.approveJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: HOD, deptScope: ["dept-surg"],
    body: { programmeId: prog.id } }, db), /out_of_scope/);
  await assert.rejects(() => E.approveJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: "fb:" + RES_UID,
    body: { programmeId: prog.id } }, db), /cannot_assign_self/);
  await assert.rejects(() => E.approveJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: HOD,
    body: {} }, db), /programme_required/);
});

test("a join request cannot re-role an existing faculty member into a resident", async () => {
  const db = world();
  const { prog } = await seed(db);
  // (created before they were made faculty, say)
  db.docs.set("pg_join_requests/" + ORG + "__fb-guide-1", { id: ORG + "__fb-guide-1", orgId: ORG, requester: GUIDE,
    requesterKey: "guide-1", status: "pending", createdAt: 1 });
  await assert.rejects(() => E.approveJoinRequest(env, { id: ORG + "__fb-guide-1", orgId: ORG, actorUid: CELL,
    body: { programmeId: prog.id } }, db), /already_member/);
  assert.equal((await db.getMembership(env, ORG, GUIDE)).role, "pg_faculty");
});

test("reject needs a reason, which the resident sees", async () => {
  const db = world();
  await seed(db);
  const { joinRequest } = await E.createJoinRequest(env, { actorUid: "fb:" + RES_UID, orgCode: ORG_CODE }, db);
  await assert.rejects(() => E.rejectJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: CELL, reason: "" }, db), /reason_required/);
  await E.rejectJoinRequest(env, { id: joinRequest.id, orgId: ORG, actorUid: CELL, reason: "Not in our 2025 batch" }, db);
  const self = E.publicJoinRequestForSelf(await E.myJoinRequest(env, "fb:" + RES_UID, db));
  assert.equal(self.status, "rejected");
  assert.equal(self.reason, "Not in our 2025 batch");
});

/* ── 7b. pending invites ─────────────────────────────────────────────────── */

test("an email with no account becomes a pending invite, resolved on that user's first /me", async () => {
  const db = world();
  const { prog } = await seed(db);
  const r = await E.enrolOne(env, { orgId: ORG, actorUid: CELL, allowInvite: true,
    row: { email: "new@x.edu", role: "pg_resident", programmeId: prog.id, guide: GUIDE, trainingYear: 1, startDate: "2026-07-01" } }, db);
  assert.equal(r.pending, true);
  assert.equal(r.invite.email, "new@x.edu");
  assert.equal((await E.listInvites(env, ORG, db)).length, 1);
  // without allowInvite the old answer stands
  await assert.rejects(() => E.enrolOne(env, { orgId: ORG, actorUid: CELL,
    row: { email: "new2@x.edu", role: "pg_resident", programmeId: prog.id } }, db), /no_such_account/);

  // The person signs in for the first time. Their VERIFIED email matches.
  const resolved = await E.resolveInvites(env, "fb:New-9", "new@x.edu", db);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].orgId, ORG);
  const m = await db.getMembership(env, ORG, "fb:New-9");
  assert.equal(m.role, "pg_resident");
  assert.equal(m.setBy, CELL, "the role is the inviter's, not self-declared");
  const res = await S.residentForUid(env, ORG, "fb:New-9", db);
  assert.ok(res && M.sameActor(res.guide, GUIDE));
  assert.equal((await E.listInvites(env, ORG, db)).length, 0, "accepted, no longer pending");
  assert.deepEqual(await E.resolveInvites(env, "fb:New-9", "new@x.edu", db), [], "resolved exactly once");
});

test("an invite lapses when the inviter has since lost the authority to enrol", async () => {
  const db = world();
  const { prog } = await seed(db);
  await E.enrolOne(env, { orgId: ORG, actorUid: CELL, allowInvite: true,
    row: { email: "new@x.edu", role: "pg_hod", programmeId: prog.id } }, db);
  db.mems.get(ORG + "|" + CELL.toLowerCase()).active = false;
  assert.deepEqual(await E.resolveInvites(env, "fb:New-9", "new@x.edu", db), []);
  assert.equal(await db.getMembership(env, ORG, "fb:New-9"), null, "no role was granted");
});

test("an invite never resolves without an email (unverified emails are never passed in)", async () => {
  const db = world();
  await seed(db);
  assert.deepEqual(await E.resolveInvites(env, "fb:New-9", "", db), []);
});

/* ── 8. bulk ─────────────────────────────────────────────────────────────── */

test("bulk enrol: per-row results, duplicates flagged, max 100", async () => {
  const db = world();
  const { prog } = await seed(db);
  const out = await E.enrolBulk({}, { orgId: ORG, actorUid: CELL, programmeId: prog.id, rows: [
    { email: "res@x.edu", guide: GUIDE, trainingYear: 2 },
    { email: "fresh@x.edu" },
    { email: "res@x.edu" },
    { email: "bad-email" },
    { email: "x@x.edu", trainingYear: 7 }
  ] }, db);
  assert.deepEqual(out.results.map((r) => r.status), ["enrolled", "invited", "error", "error", "error"]);
  assert.deepEqual(out.results.slice(2).map((r) => r.error), ["duplicate_row", "email_invalid", "training_year_invalid"]);
  assert.equal(out.enrolled, 1); assert.equal(out.invited, 1); assert.equal(out.failed, 3);
  assert.ok(out.results.every((r) => !r.message || !/[—–]/.test(r.message)), "no em-dash in app-facing text");
  await assert.rejects(() => E.enrolBulk({}, { orgId: ORG, actorUid: CELL, programmeId: prog.id,
    rows: Array.from({ length: 101 }, (_, i) => ({ email: i + "@x.edu" })) }, db), /too_many_rows/);
  // PGLOG_INVITES=0 turns the invite back into an error row
  const off = await E.enrolBulk({ PGLOG_INVITES: "0" }, { orgId: ORG, actorUid: CELL, programmeId: prog.id, rows: [{ email: "zz@x.edu" }] }, db);
  assert.equal(off.results[0].error, "no_such_account");
});

/* ── the router wiring (it imports Firestore directly, so these pin the source like
 *    test/pglog-rbac-guards.test.mjs does) ────────────────────────────────── */
const ROUTER = readFileSync(new URL("../functions/api/pglog/[[path]].js", import.meta.url), "utf8");

test("router: an HoD may assign a guide in their department and change nothing else in that call", () => {
  assert.match(ROUTER, /const hodAssigns = ctx\.role === "pg_hod" && onlyGuideKeys/);
  assert.match(ROUTER, /Object\.keys\(body\)\.every\(\(k\) => k === "guide" \|\| k === "coGuides"\)/);
  assert.match(ROUTER, /cannot_assign_self_as_guide/, "the self-appointment refusal stays");
  assert.match(ROUTER, /E\.validateGuide\(env, cur\.orgId, patch\.guide/);
});

test("router: the HoD faculty dashboard lists the department, faculty still see only their own", () => {
  const i = ROUTER.indexOf('id === "faculty" && method === "GET"');
  const body = ROUTER.slice(i, i + 3000);
  assert.match(body, /S\.listResidents\(env, orgId, \{\}\)\)\.filter/);
  assert.match(body, /S\.listResidents\(env, orgId, \{ guide: ctx\.actorUid \}\)/);
});

test("router: the roster sends names and no email; queues carry residentName", () => {
  const line = ROUTER.split("\n").find((l) => l.includes("faculty: roster.map("));
  assert.ok(line, "the roster response line exists");
  assert.match(line, /name: m\.name/);
  assert.doesNotMatch(line, /email|phone|mobile/);
  assert.match(ROUTER, /S\.facultyRosterNamed\(env, ctx\.orgId\)/);
  assert.match(ROUTER, /residentName: names\[e\.residentId\]/);
  assert.match(ROUTER, /residentName: S\.cleanName\(res && res\.name\)/);
});

test("router: join-request approval is gated to Academic Cell / HoD, and join requests are flag-guarded", () => {
  assert.match(ROUTER, /function mayDecideJoin\(ctx\) \{ return can\(ctx\.role, CAPS\.PGLOG_CONFIGURE\) \|\| ctx\.role === "pg_hod"; \}/);
  assert.match(ROUTER, /if \(!E\.joinRequestsOn\(env\)\) return json\(\{ error: "disabled" \}, 404\)/);
  assert.match(ROUTER, /P\.rateLimit\(env, request, "join:" \+ who\.uid/);
});

test("the demo flag has no server path", () => {
  const ENROL = readFileSync(new URL("../functions/_pglog_enrol.js", import.meta.url), "utf8");
  assert.doesNotMatch(ENROL + ROUTER, /smd_pglog_demo/);
});
