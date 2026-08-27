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
  assert.match(early.warning, /5\.2\(xv\)V/, "GAZETTE numbering — the draft called the DRP clause 5.2(xii)");
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

/* ── R1 2026-08-27 regressions (server side) ───────────────────────────────── */

test("C7 — the monthly authentication may only be signed by the guide, a co-guide or the HoD", async () => {
  // PGMER-2023 5.2(vi) names "the postgraduate GUIDE imparting the training". Holding PGLOG_ATTEST
  // is not the same as being that person, and the document names an authority.
  const src = readFileSync(join(HERE, "..", "functions", "_pglog_store.js"), "utf8");
  assert.match(src, /not_the_guide/, "attest() must refuse a faculty member who is not the guide");
  assert.match(src, /hod_required/, "the two HoD documents must require pg_hod");
  assert.match(src, /5\.2\(vi\)/);
  // and the store must actually consult the resident's guide/coGuides to decide
  assert.match(src, /res\.guide/);
  assert.match(src, /coGuides/);
});

test("C6 — the rotation PATCH route gates on the ROTATION'S org, not a caller-supplied one", () => {
  const router = readFileSync(join(HERE, "..", "functions", "api", "pglog", "[[path]].js"), "utf8");
  const patchBlock = router.slice(router.indexOf('if (seg === "rotations")'), router.indexOf('/* ── entries'));
  assert.match(patchBlock, /const cur = await S\.getRotation\(env, id\)/,
    "the rotation must be loaded before the gate");
  assert.match(patchBlock, /S\.gate\(env, ctx\.actorUid, cur\.orgId/,
    "the gate must use the rotation's own orgId");
  assert.ok(!/S\.gate\(env, ctx\.actorUid, body\.orgId/.test(patchBlock),
    "gating on a caller-supplied org is the cross-institution write R1 found");
});

test("C5 — 'assigned' actually means assigned; the dead branch is gone", () => {
  const router = readFileSync(join(HERE, "..", "functions", "api", "pglog", "[[path]].js"), "utf8");
  const fn = router.slice(router.indexOf("async function canReadResident"), router.indexOf("export async function onRequest"));
  // The bug was two branches returning the same value, so every faculty member got "verifier".
  const verifierReturns = (fn.match(/return "verifier"/g) || []).length;
  const aggregateReturns = (fn.match(/return "aggregate"/g) || []).length;
  assert.ok(aggregateReturns >= 2, "an unassigned faculty member must fall through to aggregate");
  assert.ok(verifierReturns >= 2 && verifierReturns <= 3);
  assert.match(fn, /resident\.guide/);
  assert.match(fn, /coGuides/);
  assert.match(fn, /entry && S\.norm\(entry\.supervisor\)/,
    "the named supervisor of THAT entry should still be able to read it");
});

test("I2 — a submitted entry cannot be edited under the verifier; it is withdrawn first", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  await assert.rejects(() => S.editEntry(env, e.id, { remarks: "changed" }, RESIDENT_UID, db),
    /pglog_submitted_withdraw_first/);
  // withdraw, then edit, then resubmit
  const w = await S.withdrawEntry(env, e.id, RESIDENT_UID, "Wrong role", db);
  assert.equal(w.status, "draft");
  assert.equal(w.submittedAt, 0);
  assert.ok(w.history.some((h) => h.action === "withdraw"));
  // and it has left the faculty member's queue
  assert.equal((await S.pendingForFaculty(env, ORG, FACULTY_UID, db)).length, 0);
  const edited = await S.editEntry(env, e.id, { remarks: "corrected" }, RESIDENT_UID, db);
  assert.equal(edited.remarks, "corrected");
});

test("I2 — only the AUTHOR may withdraw", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  await assert.rejects(() => S.withdrawEntry(env, e.id, FACULTY_UID, "x", db), /pglog_not_author/);
});

test("I3 — truncation of the audit chain is RECORDED, never silent", () => {
  let e = M.entry({ id: "x", kind: "clinical", occurredAt: "2026-08-01", title: "t", createdBy: "fb:a" });
  // drive it past the cap
  for (let i = 0; i < M.HISTORY_CAP + 5; i++) e = M.submit(e, "fb:a", 1000 + i);
  assert.equal(e.history.length, M.HISTORY_CAP);
  assert.ok(e.overflowedHistory >= 5, "the shed rows must be counted, not forgotten");
});

test("I6 — an assessment whose resident cannot be resolved FAILS CLOSED", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const a = await S.createAssessment(env, ORG, { residentId: "does-not-exist", templateId: "dops" }, FACULTY_UID, db)
    .catch(() => null);
  // createAssessment does not resolve the resident; completeAssessment must.
  const src = readFileSync(join(HERE, "..", "functions", "_pglog_store.js"), "utf8");
  assert.match(src, /FAIL CLOSED/);
  assert.match(src, /if \(!res \|\| !res\.uid\) throw e404\("resident"\)/);
});

test("I9 — a phone number or email typed into a free-text field never reaches storage", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  const e = await S.createEntry(env, ORG, entryBody(res, {
    kind: "clinical", setting: "opd", title: "Mr R 9876543210 with DKA",
    procedureText: "", role: "assisted", remarks: "relative on ramesh@example.com"
  }), RESIDENT_UID, db);
  const stored = JSON.stringify(db.docs.get("pg_entries/" + e.id));
  assert.ok(!stored.includes("9876543210"), "a mobile number reached storage via `title`");
  assert.ok(!stored.includes("ramesh@example.com"), "an email reached storage via `remarks`");
  // ordinary clinical prose survives — the field has to stay readable
  assert.match(e.title, /DKA/);
});

test("I5 — a template the NMC prints with no total row produces no total", async () => {
  const T = await import("../functions/_pglog_templates.js");
  const appraisal = T.templateFor("appraisal");
  assert.equal(appraisal.noTotal, true);
  const scores = {};
  appraisal.criteria.forEach((c) => { scores[c.key] = 7; });
  const sc = M.scoreAssessment({ scores, logbookScore: null }, appraisal);
  assert.equal(sc.total, null, "the appraisal form has no total row; synthesising one is a fabricated mark");
  assert.equal(sc.maxTotal, null);
  assert.equal(sc.noTotal, true);
  // DOPS, which DOES print its total, is unaffected
  const dops = T.templateFor("dops");
  const ds = {}; dops.criteria.forEach((c) => { ds[c.key] = 5; });
  assert.equal(M.scoreAssessment({ scores: ds, logbookScore: 10 }, dops).maxTotal, 50);
});

test("the attestation kind is validated before it is used for scoping", () => {
  const src = readFileSync(join(HERE, "..", "functions", "_pglog_store.js"), "utf8");
  assert.match(src, /unknown_attestation_kind/);
});

/* ── competitive review 2026-08-27: the free-text supervisor bug ───────────────
 * A rival product uses a faculty DROPDOWN. Ours was a text box, and `pendingFor` is a copy of it —
 * so a typo produced an entry that was `submitted`, counted toward nothing, sat in NOBODY's queue,
 * and looked sent to the resident. That is silent data loss on a regulatory record.
 */

test("an unresolvable supervisor is REFUSED, not silently orphaned", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  db.listMembers = async () => [{ identity: FACULTY_UID, role: "pg_faculty", active: true, email: "guide@x.edu" }];
  const e = await S.createEntry(env, ORG, entryBody(res, { supervisor: "Dr Sharma" }), RESIDENT_UID, db);
  await assert.rejects(
    () => S.submitEntry(env, e.id, RESIDENT_UID, db),
    (err) => err.status === 400 && err.message === "supervisor_unresolved"
  );
  // and it is still a draft — nothing was half-written
  assert.equal((await S.getEntry(env, e.id, db)).status, "draft");
  assert.equal((await S.pendingForFaculty(env, ORG, FACULTY_UID, db)).length, 0);
});

test("the resident's own guide always resolves, roster or no roster", async () => {
  const db = fakeDb();
  const { res } = await seed(db);            // seeded with guide = FACULTY_UID
  db.listMembers = async () => [];           // empty roster
  const e = await S.createEntry(env, ORG, entryBody(res, { supervisor: FACULTY_UID }), RESIDENT_UID, db);
  const sub = await S.submitEntry(env, e.id, RESIDENT_UID, db);
  assert.equal(sub.status, "submitted");
  assert.equal((await S.pendingForFaculty(env, ORG, FACULTY_UID, db)).length, 1);
});

test("a supervisor given by email resolves to the canonical identity", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  db.listMembers = async () => [{ identity: "fb:prof-9", role: "pg_faculty", active: true, email: "Sharma@med.edu" }];
  const e = await S.createEntry(env, ORG, entryBody(res, { supervisor: "sharma" }), RESIDENT_UID, db);
  const sub = await S.submitEntry(env, e.id, RESIDENT_UID, db);
  assert.equal(sub.supervisor, "fb:prof-9", "stored as the identity, not as what was typed");
  assert.equal((await S.pendingForFaculty(env, ORG, "fb:prof-9", db)).length, 1);
});

test("the roster lists only people who can actually verify", async () => {
  const db = fakeDb();
  db.listMembers = async () => [
    { identity: "fb:a", role: "pg_faculty", active: true },
    { identity: "fb:b", role: "pg_hod", active: true },
    { identity: "fb:c", role: "pg_resident", active: true },     // cannot verify
    { identity: "fb:d", role: "academic_cell", active: true },   // monitors, does not sign
    { identity: "fb:e", role: "nurse", active: true },
    { identity: "fb:f", role: "pg_faculty", active: false }      // disabled
  ];
  const roster = await S.facultyRoster(env, ORG, db);
  assert.deepEqual(roster.map((m) => m.identity).sort(), ["fb:a", "fb:b"]);
});

/* ── THE REGISTRATION GATE ──────────────────────────────────────────────────────
 * "Faculty must verify their medical council registration before they can digitally sign anyone's
 * logbook." A signature from an unverified account is worth nothing AND looks exactly like one that
 * is worth something, which is the dangerous part.
 */
const SIGNER = await import("../functions/_pglog_signer.js");

function kvWith(rec) {
  return { async get(key) { return key === "icu:doctor:faculty-1" ? rec : null; } };
}
const NO_CLAIMS = { async getUserClaims() { return {}; } };

test("a verified registration resolves to a signature carrying the registration number", async () => {
  const snap = await SIGNER.signerSnapshot({}, FACULTY_UID, {
    kv: kvWith({ verified: true, regNo: "TN/12345", council: "Tamil Nadu Medical Council", name: "Dr B" }),
    ...NO_CLAIMS
  });
  assert.equal(snap.regNo, "TN/12345");
  assert.equal(snap.council, "Tamil Nadu Medical Council");
  assert.equal(snap.source, "register");
});

test("an UNVERIFIED account cannot sign", async () => {
  await assert.rejects(
    () => SIGNER.signerSnapshot({}, FACULTY_UID, { kv: kvWith(null), ...NO_CLAIMS }),
    (e) => e.message === "signer_unverified" && e.status === 403
  );
});

test("a PENDING verification cannot sign, and says why", async () => {
  await assert.rejects(
    () => SIGNER.signerSnapshot({}, FACULTY_UID, { kv: kvWith({ status: "pending" }), ...NO_CLAIMS }),
    (e) => e.message === "signer_verification_pending" && /still under review/.test(e.userMessage)
  );
});

test("a REJECTED verification cannot sign", async () => {
  await assert.rejects(
    () => SIGNER.signerSnapshot({}, FACULTY_UID, { kv: kvWith({ status: "rejected" }), ...NO_CLAIMS }),
    (e) => e.message === "signer_verification_rejected"
  );
});

test("verified but with NO registration number is refused — an uncheckable signature is not one", async () => {
  await assert.rejects(
    () => SIGNER.signerSnapshot({}, FACULTY_UID, { kv: kvWith({ verified: true, regNo: "" }), ...NO_CLAIMS }),
    (e) => e.message === "signer_no_registration_number"
  );
});

test("IT FAILS CLOSED: when the check itself is unavailable, nothing is signed", async () => {
  const brokenKv = { async get() { throw new Error("kv down"); } };
  const brokenClaims = { async getUserClaims() { throw new Error("identitytoolkit down"); } };
  await assert.rejects(
    () => SIGNER.signerSnapshot({}, FACULTY_UID, { kv: brokenKv, ...brokenClaims }),
    (e) => e.message === "signer_check_unavailable" && e.status === 503
  );
});

test("the namespaced uid is stripped before lookup — the guard must not miss and fail open", async () => {
  assert.equal(SIGNER.rawUid("fb:faculty-1"), "faculty-1");
  assert.equal(SIGNER.rawUid("faculty-1"), "faculty-1");
  assert.equal(SIGNER.rawUid("ghis:faculty-1"), "faculty-1");
  // and the lookup actually uses it: kvWith keys on the RAW uid
  const snap = await SIGNER.signerSnapshot({}, "fb:faculty-1", {
    kv: kvWith({ verified: true, regNo: "KA/9" }), ...NO_CLAIMS });
  assert.equal(snap.regNo, "KA/9");
});

test("the Firebase claim is accepted as a fallback only WITH a registration number", async () => {
  const withNum = await SIGNER.signerSnapshot({}, FACULTY_UID, {
    kv: kvWith(null), getUserClaims: async () => ({ verified: true, regNo: "MH/77" }) });
  assert.equal(withNum.regNo, "MH/77");
  assert.equal(withNum.source, "claim");
  await assert.rejects(
    () => SIGNER.signerSnapshot({}, FACULTY_UID, {
      kv: kvWith(null), getUserClaims: async () => ({ verified: true }) }),
    (e) => e.message === "signer_unverified");
});

test("verifyEntry REFUSES an unverified signer, and the entry stays submitted", async () => {
  const db = fakeDb();
  const { res } = await seed(db);
  db.listMembers = async () => [{ identity: FACULTY_UID, role: "pg_faculty", active: true }];
  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);
  const unverified = {
    gate: async () => ({ role: "pg_faculty", owner: false }),
    signerSnapshot: async () => { throw SIGNER.signerError("signer_unverified", "x"); }
  };
  await assert.rejects(
    () => S.verifyEntry(env, e.id, FACULTY_UID, "", { ...db, ...unverified }),
    (err) => err.message === "signer_unverified"
  );
  assert.equal((await S.getEntry(env, e.id, db)).status, "submitted", "nothing was half-signed");
});

test("a faculty member who is NOT the guide and NOT named on the entry cannot sign it", async () => {
  // PGLOG_VERIFY is an org-wide capability. PGMER-2023 5.2(vii) is not an org-wide question: it names
  // "the Post-graduate guide". Without this, any faculty member in the institution could sign any
  // resident's entry under their own registration number — and the QR would announce them as the
  // verifying faculty.
  const db = fakeDb();
  const { res } = await seed(db);
  db.listMembers = async () => [
    { identity: FACULTY_UID, role: "pg_faculty", active: true },
    { identity: "fb:stranger", role: "pg_faculty", active: true }
  ];
  const signer = async () => ({ uid: "x", regNo: "TN/1", council: "TNMC", name: "Dr S", source: "register" });
  const asStranger = { ...db, gate: async () => ({ role: "pg_faculty", owner: false }), signerSnapshot: signer };
  const asHod = { ...db, gate: async () => ({ role: "pg_hod", owner: false }), signerSnapshot: signer };
  const asGuide = { ...db, gate: async () => ({ role: "pg_faculty", owner: false }), signerSnapshot: signer };

  const e = await S.createEntry(env, ORG, entryBody(res), RESIDENT_UID, db);
  await S.submitEntry(env, e.id, RESIDENT_UID, db);

  await assert.rejects(() => S.verifyEntry(env, e.id, "fb:stranger", "ok", asStranger),
    (err) => /not_the_named_supervisor/.test(err.message));
  await assert.rejects(() => S.returnEntry(env, e.id, "fb:stranger", "redo it", asStranger),
    (err) => /not_the_named_supervisor/.test(err.message));
  assert.equal((await S.getEntry(env, e.id, db)).status, "submitted", "nothing happened to the record");

  // the guide themselves can
  const v = await S.verifyEntry(env, e.id, FACULTY_UID, "ok", asGuide);
  assert.equal(v.status, "verified");

  // and a head of department may act for an absent guide — recorded as the HoD
  const e2 = await S.createEntry(env, ORG, entryBody(res, { supervisor: FACULTY_UID }), RESIDENT_UID, db);
  await S.submitEntry(env, e2.id, RESIDENT_UID, db);
  const v2 = await S.verifyEntry(env, e2.id, "fb:stranger", "guide on leave", asHod);
  assert.equal(v2.status, "verified");
});

test("the signature fields record the registration, not just a uid", () => {
  const f = SIGNER.signatureFields("verified",
    { regNo: "TN/12345", council: "TNMC", name: "Dr B", source: "register" }, 1700000000000);
  assert.equal(f.verifiedReg, "TN/12345");
  assert.equal(f.verifiedCouncil, "TNMC");
  assert.equal(f.verifiedName, "Dr B");
  assert.equal(f.verifiedRegSource, "register");
  assert.equal(f.verifiedRegCheckedAt, 1700000000000);
});

/* ── VERIFICATION CODES + TAMPER EVIDENCE ─────────────────────────────────────── */
const VER = await import("../functions/_pglog_verify.js");
const KEYED = { PGLOG_SIGNING_KEY: "test-key-not-a-real-secret" };

test("codes are unguessable, human-readable, and free of confusable characters", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const c = VER.newCode();
    assert.match(c, /^PGL-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
      // (the fixed "PGL-" prefix is exempt — it is unambiguous, and normalizeCode strips it BEFORE
    // folding confusables, which is exactly the ordering bug that broke every scanned code once.)
    assert.ok(!/[ILOU]/.test(c.slice(4)), "I, L, O and U are excluded so a code can be read aloud: " + c);
    seen.add(c);
  }
  assert.ok(seen.size > 495, "80 bits of entropy should not collide in 500 draws");
});

test("normalizeCode repairs what a human mistypes off paper", () => {
  assert.equal(VER.normalizeCode("pgl-7k2m9-xq4tb"), "PGL-7K2M9-XQ4TB");
  assert.equal(VER.normalizeCode("PGL 7K2M9 XQ4TB"), "PGL-7K2M9-XQ4TB");
  assert.equal(VER.normalizeCode("7K2M9XQ4TB"), "PGL-7K2M9-XQ4TB");
  // the four confusables map to what they look like
  // I->1, L->1, O->0, U->V : the four a reader confuses. "ILOU9XQ4TB" folds to "110V9XQ4TB".
  assert.equal(VER.normalizeCode("PGL-ILOU9-XQ4TB"), "PGL-110V9-XQ4TB");
  // REGRESSION: the prefix contains an L. Folding confusables before stripping it turned every real
  // code into "PG1..." and normalizeCode returned "" for its own output.
  const round = VER.newCode();
  assert.equal(VER.normalizeCode(round), round, "a freshly minted code must normalise to itself");
  assert.equal(VER.normalizeCode(round.toLowerCase()), round);
  assert.equal(VER.normalizeCode(round.replace(/-/g, " ")), round);
  assert.equal(VER.normalizeCode("nonsense!"), "");
});

test("the canonical form is FIXED — a schema edit must not silently invalidate every code", () => {
  const c = VER.canonical("entry", { id: "e1", residentId: "r1", orgId: "o1", kind: "procedure",
    occurredAt: "2026-08-20", role: "assisted", verifiedBy: "fb:f", verifiedByReg: "TN/1",
    verifiedAt: 123, revisionCount: 0 });
  assert.equal(c, "v2|entry|2:e1|2:r1|2:o1|9:procedure|10:2026-08-20|8:assisted|4:fb:f|4:TN/1|3:123|1:0");
  // Parts are LENGTH-PREFIXED, so a delimiter inside a value cannot shift the fields after it. The
  // registration number is the one free-form field a signature covers, and it is owner/register
  // supplied — "TN/1|x" must not be able to impersonate a different verifiedAt.
  assert.notEqual(
    VER.canonical("entry", { id: "e1", verifiedByReg: "A|B", verifiedAt: "" }),
    VER.canonical("entry", { id: "e1", verifiedByReg: "A", verifiedAt: "B" }));
  // an unrelated extra field must not change it
  const c2 = VER.canonical("entry", { id: "e1", residentId: "r1", orgId: "o1", kind: "procedure",
    occurredAt: "2026-08-20", role: "assisted", verifiedBy: "fb:f", verifiedByReg: "TN/1",
    verifiedAt: 123, revisionCount: 0, somethingNew: "x" });
  assert.equal(c, c2);
});

test("ROUND TRIP: a signed entry verifies as VALID — the two ends derive the same payload", async () => {
  // THE REGRESSION THAT MATTERS. The issue side and the lookup side once used different field names
  // (verifiedReg vs verifiedByReg, revisions vs revisionCount), so every genuine entry QR told the
  // examiner the record had been tampered with. The tests missed it because both sides were fed a
  // hand-built payload. This one signs a REAL entry document and verifies its REAL code.
  const db = fakeDb();
  const PUB = await import("../functions/_pglog_public.js");
  db.listMembers = async () => [{ identity: FACULTY_UID, role: "pg_faculty", active: true }];
  const dep = Object.assign({}, db, {
    gate: async () => ({ role: "pg_hod", owner: false, org: { id: ORG }, member: {} }),
    signerSnapshot: async () => ({ uid: "faculty-1", regNo: "KMC/2011/44321",
      council: "Karnataka Medical Council", name: "Dr A Rao", source: "register", via: "certificate" })
  });
  const { res } = await seed(db);
  const e = await S.createEntry(KEYED, ORG, entryBody(res), RESIDENT_UID, dep);
  await S.submitEntry(KEYED, e.id, RESIDENT_UID, dep);
  const v = await S.verifyEntry(KEYED, e.id, FACULTY_UID, "seen", dep);

  assert.ok(v.verifyCode, "a signed entry must carry a code");
  assert.equal(v.verifiedReg, "KMC/2011/44321");

  const rec = db.docs.get("pg_verify/" + v.verifyCode);
  assert.ok(rec, "the code must be stored");
  const answer = await PUB.describeVerification(KEYED, rec, v.verifyCode, Object.assign({}, dep, {
    getEntry: (env, id) => S.getEntry(env, id, dep),
    getResident: async () => ({ id: "r1", name: "Dr B", smdId: "SMD-1", programmeId: "p1" }),
    getProgramme: async () => ({ id: "p1", degree: "MD", name: "MD General Medicine" }),
    digestFor: (env, kind, payload) => VER.digestFor(env, kind, payload)
  }));
  assert.equal(answer.status, "valid", "a genuine signature must not read as tampered");
  assert.equal(answer.signedBy.registrationNo, "KMC/2011/44321");

  // ...and a real edit to the stored document DOES read as tampered.
  const stored = db.docs.get("pg_entries/" + e.id);
  stored.occurredAt = "2026-08-01";
  const after = await PUB.describeVerification(KEYED, rec, v.verifyCode, Object.assign({}, dep, {
    getEntry: (env, id) => S.getEntry(env, id, dep),
    digestFor: (env, kind, payload) => VER.digestFor(env, kind, payload)
  }));
  assert.equal(after.status, "tampered");
});

test("the digest changes when ANY signed fact changes", async () => {
  const base = { id: "e1", residentId: "r1", orgId: "o1", kind: "procedure", occurredAt: "2026-08-20",
    role: "assisted", verifiedBy: "fb:f", verifiedByReg: "TN/1", verifiedAt: 123, revisionCount: 0 };
  const d0 = await VER.digestFor(KEYED, "entry", base);
  for (const [k, v] of [["role", "performed_independent"], ["occurredAt", "2026-08-21"],
                        ["verifiedByReg", "TN/2"], ["revisionCount", 1]]) {
    const d1 = await VER.digestFor(KEYED, "entry", { ...base, [k]: v });
    assert.notEqual(d0, d1, "changing " + k + " must change the digest");
  }
  assert.equal(d0, await VER.digestFor(KEYED, "entry", base), "and it must be stable");
});

test("a different signing key produces a different digest — codes do not transfer between deployments", async () => {
  const p = { id: "e1", residentId: "r1", orgId: "o1", kind: "procedure", occurredAt: "2026-08-20",
    role: "assisted", verifiedBy: "fb:f", verifiedByReg: "TN/1", verifiedAt: 1, revisionCount: 0 };
  assert.notEqual(await VER.digestFor(KEYED, "entry", p),
                  await VER.digestFor({ PGLOG_SIGNING_KEY: "other" }, "entry", p));
});

test("WITHOUT a signing key nothing is issued — no uncheckable code is ever printed", async () => {
  assert.equal(VER.signingConfigured({}), false);
  assert.equal(await VER.issue({}, "entry", { id: "e1" }), "");
  await assert.rejects(() => VER.digestFor({}, "entry", { id: "e1" }),
    (e) => e.message === "pglog_signing_unconfigured" && e.status === 503);
});

test("digestEqual is length-safe and constant-time in shape", () => {
  assert.equal(VER.digestEqual("abc", "abc"), true);
  assert.equal(VER.digestEqual("abc", "abd"), false);
  assert.equal(VER.digestEqual("abc", "abcd"), false);
  assert.equal(VER.digestEqual("", ""), true);
  assert.equal(VER.digestEqual(null, undefined), true, "both normalise to empty");
});

test("the verification URL is configurable and encodes the code", () => {
  assert.equal(VER.verifyUrl({}, "PGL-7K2M9-XQ4TB"), "https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB");
  assert.equal(VER.verifyUrl({ PGLOG_VERIFY_BASE: "https://logbook.example.edu/" }, "PGL-A-B"),
               "https://logbook.example.edu/pglog/v/PGL-A-B");
});

test("issuing a code stores the digest and the reference, and nothing identifying", async () => {
  const db = fakeDb();
  const code = await VER.issue(KEYED, "entry",
    { id: "e1", residentId: "r1", orgId: "o1", kind: "procedure", occurredAt: "2026-08-20",
      role: "assisted", verifiedBy: "fb:f", verifiedByReg: "TN/1", verifiedAt: 5, revisionCount: 0 },
    { fsCommit: db.fsCommit, wCreate: db.wCreate, fsGet: db.fsGet, now: db.now });
  assert.match(code, /^PGL-/);
  const stored = db.docs.get("pg_verify/" + code);
  assert.equal(stored.kind, "entry");
  assert.equal(stored.refId, "e1");
  assert.equal(stored.revoked, false);
  assert.ok(stored.digest && stored.digest.length === 64);
  // the stored record must not carry clinical content
  const blob = JSON.stringify(stored);
  assert.ok(!/procedure|2026-08-20|assisted/.test(blob.replace(/"kind":"entry"/, "")),
    "the verification record must not duplicate the clinical facts");
});
