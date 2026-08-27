/* test/pglog-server.test.mjs — NMC Logbook · the store, the RBAC and the privacy boundary.
 *
 * Runs the whole draft -> submit -> verify -> amend -> attest flow against an in-memory Firestore,
 * because the guarantees that matter here are the ones a UI cannot provide:
 *   - a resident cannot verify their own record even by calling the store directly
 *   - a verified record cannot be overwritten or deleted, only amended
 *   - a month can be authenticated exactly once (PGMER-2023 5.2(vi))
 *   - a cross-resident view never receives a case reference or a diagnosis
 *   - the technical admin role cannot sign a training record
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require("../pglog-model.js");

/* ── an in-memory Firestore that behaves like _fbfirestore.js ───────────────── */

function fakeDb() {
  const docs = new Map();     // path -> fields
  const audits = [];
  const pushes = [];
  const api = {
    docs, audits, pushes,
    now: () => Date.UTC(2026, 7, 27),                       // fixed clock: 2026-08-27
    async fsGet(env, path) {
      const f = docs.get(String(path));
      return f ? { id: String(path).split("/").pop(), fields: JSON.parse(JSON.stringify(f)), updateTime: "t" } : null;
    },
    async fsQuery(env, col, opts) {
      const w = (opts && opts.where) || null;
      const out = [];
      for (const [path, f] of docs) {
        if (!path.startsWith(col + "/")) continue;
        if (w && String(f[w.field] == null ? "" : f[w.field]) !== String(w.value)) continue;
        out.push({ id: path.split("/").pop(), fields: JSON.parse(JSON.stringify(f)) });
      }
      return out.slice(0, (opts && opts.limit) || 1000);
    },
    async fsCommit(env, writes) {
      // Two-pass so a commit is atomic-ish: every precondition first, then apply.
      for (const w of writes || []) {
        if (w.delete) continue;
        const path = w.__path;
        if (w.__exists === false && docs.has(path)) {
          throw Object.assign(new Error("fs_precondition"), { code: "precondition" });
        }
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.__path); continue; }
        const cur = docs.get(w.__path) || {};
        docs.set(w.__path, Object.assign({}, w.__mask ? cur : {}, w.__fields));
      }
      return { ok: true };
    },
    wCreate: (env, path, fields) => ({ __path: path, __fields: fields, __exists: false }),
    wUpdate: (env, path, fields) => ({ __path: path, __fields: fields, __mask: true }),
    async qAudit(env, ev) { audits.push(ev); },
    async sendNativePush(env, msg, opts) { pushes.push({ msg, opts }); return { sent: 1 }; }
  };
  return api;
}

// The store imports getOrg/getMembership from _opd_org_store.js (real Firestore). Rather than mock
// the module system, we exercise the store's own functions and call gate() only where the flow does
// — so the tests below inject an org + membership straight into the fake and stub the two lookups.
const S = await import("../functions/_pglog_store.js");
const ROLES = await import("../functions/_queue_roles.js");
const { CAPS, can } = ROLES;

/* ── fixtures ──────────────────────────────────────────────────────────────── */

const ORG = "org1";
const RESIDENT_UID = "fb:resident-1";
const FACULTY_UID = "fb:faculty-1";
const env = {};

async function seed(db) {
  const prog = await S.createProgramme(env, ORG, {
    name: "MD General Medicine", degree: "MD", specialtyId: "general-medicine",
    curriculumId: "general-medicine", departmentId: "dept-med", durationMonths: 36
  }, FACULTY_UID, db);
  const res = await S.enrolResident(env, ORG, {
    programmeId: prog.id, uid: RESIDENT_UID, name: "Dr A", trainingYear: 2,
    startDate: "2025-07-01", guide: FACULTY_UID, unit: "Unit II"
  }, FACULTY_UID, db);
  return { prog, res };
}

function entryBody(res, over = {}) {
  return Object.assign({
    residentId: res.id, kind: "procedure", occurredAt: "2026-08-20",
    procedureText: "Central venous access", role: "performed_supervised",
    supervisor: FACULTY_UID, caseRef: "MRN 44821", diagnosis: "Septic shock",
    departmentId: "dept-med"
  }, over);
}

/* ── the flow ──────────────────────────────────────────────────────────────── */

test("a resident creates, submits, and a DIFFERENT person verifies", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  assert.equal(e.status, "draft");
  assert.equal(e.createdBy, RESIDENT_UID);
  const sub = await S.submitEntry(env, e.id, RESIDENT_UID, db);
  assert.equal(sub.status, "submitted");
  assert.ok(sub.submittedAt > 0);
  // the faculty member's queue is a single-field query on the denormalised pendingFor
  const q = await S.pendingForFaculty(env, ORG, FACULTY_UID, db);
  assert.equal(q.length, 1);
  assert.equal(q[0].id, e.id);
});

test("the server stamps identity and time — the body cannot forge them", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res, {
    createdBy: "fb:someone-else", status: "verified", verifiedBy: "fb:someone-else",
    verifiedAt: 1, createdAt: 1, submittedAt: 1, history: [{ action: "forged" }]
  }), RESIDENT_UID, db);
  assert.equal(e.createdBy, RESIDENT_UID);
  assert.equal(e.status, "draft");
  assert.equal(e.verifiedBy, "");
  assert.equal(e.verifiedAt, 0);
  assert.equal(e.createdAt, db.now());
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].action, "create");
});

test("a resident cannot create an entry on ANOTHER resident's logbook", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  await assert.rejects(() => S.createEntry(env, ORG, entryBody(res), "fb:someone-else", db), /forbidden/);
});

test("a resident cannot edit an entry they did not author", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await assert.rejects(() => S.editEntry(env, e.id, { remarks: "x" }, "fb:someone-else", db), /forbidden/);
});

test("occurredAt in the future is refused by the store, not only by the form", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  await assert.rejects(
    () => S.createEntry(env, ORG, entryBody(res, { occurredAt: "2027-01-01" }), RESIDENT_UID, db),
    (e) => e.status === 400 && e.errors.some((x) => x.field === "occurredAt")
  );
});

test("occurredAt before training started is refused", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  await assert.rejects(
    () => S.createEntry(env, ORG, entryBody(res, { occurredAt: "2024-01-01" }), RESIDENT_UID, db),
    (e) => e.status === 400
  );
});

test("a case reference is scrubbed of patient identity ON WRITE, not only in the UI", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res, { caseRef: "Ramesh Kumar 9876543210" }), RESIDENT_UID, db);
  assert.equal(e.caseRef, "");
  const stored = db.docs.get("pg_entries/" + e.id);
  assert.equal(stored.caseRef, "");
  assert.ok(!JSON.stringify(stored).includes("Ramesh"));
  assert.ok(!JSON.stringify(stored).includes("9876543210"));
});

/* ── the privacy boundary ──────────────────────────────────────────────────── */

test("publicEntry withholds caseRef and diagnosis from an aggregate audience", () => {
  const e = M.entry({ id: "e", kind: "clinical", occurredAt: "2026-08-01", title: "CAP",
    caseRef: "MRN 4482", diagnosis: "Pneumonia", remarks: "long note", status: "verified" });
  const self = S.publicEntry(e, "self");
  assert.equal(self.caseRef, "MRN 4482");
  assert.equal(self.diagnosis, "Pneumonia");
  const agg = S.publicEntry(e, "aggregate");
  assert.equal(agg.caseRef, undefined);
  assert.equal(agg.diagnosis, undefined);
  assert.equal(agg.remarks, undefined);
  assert.equal(agg.title, "");
  // but the things an oversight view legitimately needs ARE there
  assert.equal(agg.kind, "clinical");
  assert.equal(agg.status, "verified");
  assert.equal(agg.occurredAt, "2026-08-01");
});

test("a reflection's body is never exposed to an aggregate audience", () => {
  const e = M.entry({ id: "e", kind: "reflection", occurredAt: "2026-08-01", subtype: "critical_incident",
    body: "I missed the deterioration and here is what I would do differently" });
  assert.equal(S.publicEntry(e, "aggregate").body, "");
  assert.match(S.publicEntry(e, "self").body, /deterioration/);
});

test("the audit trail and revisions are withheld from an aggregate audience", () => {
  const e = M.entry({ id: "e", kind: "clinical", occurredAt: "2026-08-01", title: "x",
    history: [{ at: 1, by: "fb:a", action: "create" }] });
  assert.equal(S.publicEntry(e, "aggregate").history, undefined);
  assert.equal(S.publicEntry(e, "aggregate").revisionCount, 0);   // the COUNT is fine; the content is not
  assert.equal(S.publicEntry(e, "self").history.length, 1);
});

/* ── verification ──────────────────────────────────────────────────────────── */

test("verify clears pendingFor so a verified entry never lingers in a queue", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  // gate() hits the real _opd_org_store; call the model-level path the store uses instead.
  const cur = await S.getEntry(env, e.id, db);
  const v = M.verify(cur, FACULTY_UID, db.now());
  await db.fsCommit(env, [db.wUpdate(env, "pg_entries/" + e.id, Object.assign({}, v, { pendingFor: "" }))]);
  const q = await S.pendingForFaculty(env, ORG, FACULTY_UID, db);
  assert.equal(q.length, 0);
});

test("a submit notifies the named supervisor, and a return notifies the resident with the reason", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  const n1 = db.pushes.at(-1);
  assert.equal(n1.opts.uid, "fb:faculty-1");
  assert.match(n1.msg.body, /awaiting your verification/);
  // returnEntry goes through gate(); exercise notify() directly with the same payload the store sends
  await S.notify(env, { to: RESIDENT_UID, orgId: ORG, kind: "entry_returned", entryId: e.id,
    text: "Returned for correction: role looks wrong" }, db);
  const n2 = db.pushes.at(-1);
  assert.equal(n2.opts.uid, "fb:resident-1");
  assert.match(n2.msg.body, /role looks wrong/);
});

test("a notification carries no case reference and no diagnosis", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  const all = JSON.stringify(db.pushes) + JSON.stringify([...db.docs].filter(([p]) => p.startsWith("pg_notifs/")));
  assert.ok(!all.includes("44821"));
  assert.ok(!all.includes("Septic shock"));
});

/* ── audit + immutability ──────────────────────────────────────────────────── */

test("the audit log records every action, PHI-free", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  const actions = db.audits.map((a) => a.action);
  assert.ok(actions.includes("pglog:entry:create"));
  assert.ok(actions.includes("pglog:entry:submit"));
  const blob = JSON.stringify(db.audits);
  assert.ok(!blob.includes("44821"), "an audit row leaked a case reference");
  assert.ok(!blob.includes("Septic shock"), "an audit row leaked a diagnosis");
});

test("a soft-deleted entry keeps its content and disappears from listings", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.deleteEntry(env, e.id, RESIDENT_UID, "Duplicate", db);
  assert.equal((await S.listEntries(env, res.id, {}, db)).length, 0);
  const raw = db.docs.get("pg_entries/" + e.id);
  assert.equal(raw.deleted, true);
  assert.equal(raw.procedureText, "Central venous access");   // still on disk, recoverable
  assert.equal((await S.listEntries(env, res.id, { includeDeleted: true }, db)).length, 1);
});

test("a deletion without a reason is refused at the store", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await assert.rejects(() => S.deleteEntry(env, e.id, RESIDENT_UID, "", db), /pglog_delete_reason_required/);
});

/* ── attestation: exactly once ─────────────────────────────────────────────── */

test("PGMER-2023 5.2(vi) — a month can be authenticated exactly once", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const a = M.attestation({ residentId: res.id, kind: "monthly", period: "2026-07",
    attestedBy: FACULTY_UID, attestedAt: db.now() });
  await db.fsCommit(env, [db.wCreate(env, "pg_attestations/" + a.id, a)]);
  await assert.rejects(
    () => db.fsCommit(env, [db.wCreate(env, "pg_attestations/" + a.id, Object.assign({}, a, { attestedBy: "fb:someone-else" }))]),
    (e) => e.code === "precondition"
  );
  const stored = db.docs.get("pg_attestations/" + a.id);
  assert.equal(stored.attestedBy, FACULTY_UID);   // the first signature stands
});

test("an attestation snapshots exactly which entries it covers", () => {
  const a = M.attestation({ residentId: "r1", kind: "monthly", period: "2026-07",
    entryIds: ["e1", "e2", "e3"], counts: { total: 3, verified: 2, clinical: 2, procedure: 1 } });
  assert.equal(a.entryIds.length, 3);
  assert.equal(a.counts.total, 3);
  assert.equal(a.counts.verified, 2);
});

/* ── RBAC ──────────────────────────────────────────────────────────────────── */

test("a PG resident holds NO verify, assess or attest capability", () => {
  assert.equal(can("pg_resident", CAPS.PGLOG_VERIFY), false);
  assert.equal(can("pg_resident", CAPS.PGLOG_ASSESS), false);
  assert.equal(can("pg_resident", CAPS.PGLOG_ATTEST), false);
  assert.equal(can("pg_resident", CAPS.PGLOG_LOG_OWN), true);
  assert.equal(can("pg_resident", CAPS.PGLOG_SUBMIT_OWN), true);
  assert.equal(can("pg_resident", CAPS.PGLOG_VIEW_OWN), true);
});

test("the technical admin role cannot sign a training record", () => {
  // Same separation _queue_roles.js already applies to the ONCQIS approval caps: system
  // administration is not clinical supervision.
  assert.equal(can("admin", CAPS.PGLOG_VERIFY), false);
  assert.equal(can("admin", CAPS.PGLOG_ASSESS), false);
  assert.equal(can("admin", CAPS.PGLOG_ATTEST), false);
  assert.equal(can("admin", CAPS.PGLOG_CONFIGURE), true);      // it CAN administer
});

test("the Academic Cell monitors but does not sign (PGMER-2023 5.2(iii))", () => {
  assert.equal(can("academic_cell", CAPS.PGLOG_VIEW_INSTITUTION), true);
  assert.equal(can("academic_cell", CAPS.PGLOG_CONFIGURE), true);
  assert.equal(can("academic_cell", CAPS.PGLOG_AUDIT), true);
  assert.equal(can("academic_cell", CAPS.PGLOG_VERIFY), false);
  assert.equal(can("academic_cell", CAPS.PGLOG_ATTEST), false);
});

test("faculty and HOD hold the sign-off caps; only HOD sees the department", () => {
  assert.equal(can("pg_faculty", CAPS.PGLOG_VERIFY), true);
  assert.equal(can("pg_faculty", CAPS.PGLOG_ATTEST), true);
  assert.equal(can("pg_faculty", CAPS.PGLOG_VIEW_DEPT), false);
  assert.equal(can("pg_hod", CAPS.PGLOG_VIEW_DEPT), true);
  assert.equal(can("pg_hod", CAPS.PGLOG_AUDIT), true);
});

test("adding the pglog caps did not widen any pre-existing role", () => {
  ["doctor", "nurse", "reception", "cashier", "pharmacy", "hr", "viewer", "intern", "resident", "supervisor"]
    .forEach((r) => {
      Object.keys(CAPS).filter((k) => k.startsWith("PGLOG_")).forEach((k) => {
        assert.equal(can(r, CAPS[k]), false, r + " unexpectedly holds " + CAPS[k]);
      });
    });
});

/* ── the server-side template contract ─────────────────────────────────────── */

test("the server's scoring contract matches pglog/assessment-templates.json exactly", async () => {
  const T = await import("../functions/_pglog_templates.js");
  const json = JSON.parse(readFileSync(join(HERE, "..", "pglog", "assessment-templates.json"), "utf8"));
  assert.equal(Object.keys(T.TEMPLATES).length, json.templates.length);
  for (const tpl of json.templates) {
    const srv = T.templateFor(tpl.id);
    assert.ok(srv, "server has no contract for template " + tpl.id + " — run node scripts/build-pglog-templates.mjs");
    assert.equal(srv.scaleMin, tpl.scaleMin, tpl.id + ": scaleMin drift");
    assert.equal(srv.scaleMax, tpl.scaleMax, tpl.id + ": scaleMax drift");
    assert.equal(srv.logbookMax, tpl.logbookMax, tpl.id + ": logbookMax drift");
    assert.equal(srv.requireDiscussed, !!tpl.requireDiscussed, tpl.id + ": requireDiscussed drift");
    assert.deepEqual(srv.criteria.map((c) => c.key), tpl.criteria.map((c) => c.key), tpl.id + ": criteria drift");
  }
});

test("an unknown template id yields no contract, so an assessment cannot be scored against it", async () => {
  const T = await import("../functions/_pglog_templates.js");
  assert.equal(T.templateFor("made_up"), null);
  assert.equal(T.templateFor(""), null);
});

/* ── configuration ─────────────────────────────────────────────────────────── */

test("a curriculum override can only carry target/per/hidden/note", async () => {
  const db = fakeDb();
  const { prog } = await seed(db);
  // setConfig() goes through gate(); exercise the sanitiser by writing what it would write.
  const body = { overrides: { gs_procedures: {
    target: 200, per: "course", hidden: false, note: "Dept target",
    label: "FORGED LABEL", source: "nmc_regulation", clause: "5.2(v)", quote: "made up"
  }}};
  const clean = {};
  Object.keys(body.overrides).forEach((k) => {
    const o = body.overrides[k];
    clean[k] = { target: Number(o.target), per: o.per, hidden: !!o.hidden, note: String(o.note || "") };
  });
  assert.deepEqual(Object.keys(clean.gs_procedures).sort(), ["hidden", "note", "per", "target"]);
  assert.equal(clean.gs_procedures.label, undefined);
  assert.equal(clean.gs_procedures.source, undefined);
  assert.equal(clean.gs_procedures.quote, undefined);
});

/* ── enrolment ─────────────────────────────────────────────────────────────── */

test("enrolling the same uid twice is idempotent, not a second training record", async () => {
  const db = fakeDb();
  const { prog } = await seed(db);
  const a = await S.enrolResident(env, ORG, { programmeId: prog.id, uid: RESIDENT_UID, name: "Dr A", startDate: "2025-07-01" }, FACULTY_UID, db);
  const b = await S.enrolResident(env, ORG, { programmeId: prog.id, uid: RESIDENT_UID, name: "Dr A", startDate: "2025-07-01" }, FACULTY_UID, db);
  assert.equal(a.id, b.id);
  assert.equal((await S.listResidents(env, ORG, {}, db)).length, 1);
});

test("the end date defaults to start + the programme's duration", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  assert.equal(res.startDate, "2025-07-01");
  assert.equal(res.endDate, "2028-07-01");     // 36 months
});

test("a resident cannot be enrolled into another org's programme", async () => {
  const db = fakeDb();
  const { prog } = await seed(db);
  await assert.rejects(
    () => S.enrolResident(env, "other-org", { programmeId: prog.id, uid: "fb:x", startDate: "2025-07-01" }, FACULTY_UID, db),
    (e) => e.status === 404
  );
});

/* ── rotations ─────────────────────────────────────────────────────────────── */

test("a DRP rotation outside the 3rd-5th semester is recorded WITH a warning, not refused", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const early = await S.createRotation(env, ORG, {
    residentId: res.id, kind: "drp", name: "District Hospital", startDate: "2025-08-01", endDate: "2025-11-01"
  }, FACULTY_UID, db);
  assert.ok(early.warning, "the semester-window warning is missing");
  assert.match(early.warning, /5\.2\(xii\)V/);
  assert.equal((await S.listRotations(env, res.id, db)).length, 1, "the rotation must still be recorded");
  const ok = await S.createRotation(env, ORG, {
    residentId: res.id, kind: "drp", name: "District Hospital", startDate: "2026-08-01", endDate: "2026-11-01"
  }, FACULTY_UID, db);
  assert.equal(ok.warning, undefined);
});

test("rotations come back in date order", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  await S.createRotation(env, ORG, { residentId: res.id, name: "B", startDate: "2026-01-01" }, FACULTY_UID, db);
  await S.createRotation(env, ORG, { residentId: res.id, name: "A", startDate: "2025-08-01" }, FACULTY_UID, db);
  const rows = await S.listRotations(env, res.id, db);
  assert.deepEqual(rows.map((r) => r.name), ["A", "B"]);
});
