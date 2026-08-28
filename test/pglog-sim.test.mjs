/* test/pglog-sim.test.mjs — a whole simulated medical college, run end to end.
 *
 * Built because the owner asked for a real institution exercised for real: one institute, three
 * departments, twelve residents (four per department), and scenarios at three difficulties.
 *
 * It runs against the same in-memory Firestore that test/pglog-server.test.mjs uses rather than the
 * live API, and that is the STRONGER choice here, not a fallback: the flows that matter need several
 * identities at once (resident, guide, non-guide faculty, HOD, Academic Cell) and the live path can
 * only ever hold the one account that happens to be signed in on the phone. It is also repeatable
 * and writes nothing to production.
 *
 * Scenarios: 2 easy, 2 moderate, 2 hard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = require("../pglog-model.js");
const S = await import("../functions/_pglog_store.js");

/* ── in-memory Firestore, same shape as _fbfirestore.js ─────────────────────── */
function fakeDb() {
  const docs = new Map();
  const audits = [];
  return {
    docs, audits,
    now: () => Date.UTC(2026, 7, 28),
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
      for (const w of writes || []) {
        if (w.delete) continue;
        if (w.__exists === false && docs.has(w.__path)) throw Object.assign(new Error("fs_precondition"), { code: "precondition" });
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
    async sendNativePush() { return { sent: 0 }; },
    // gate() calls the REAL getOrg/getMembership against Firestore. The suite convention is to
    // stub it in deps and assert the store's OWN guards, which is what these scenarios exercise.
    async gate() { return { role: "pg_faculty", owner: false }; },
    async signerSnapshot() {
      return { identity: "fb:sim-guide", name: "Dr Guide", council: "NMC", regNo: "SIM-1", verifiedAt: 1 };
    },
  };
}

const env = {};
const ORG = "sim-college";

const DEPTS = [
  { id: "dept-medicine",    name: "Sim General Medicine", specialtyId: "md-general-medicine", degree: "MD" },
  { id: "dept-surgery",     name: "Sim General Surgery",  specialtyId: "ms-general-surgery",  degree: "MS" },
  { id: "dept-paediatrics", name: "Sim Paediatrics",      specialtyId: "md-paediatrics",      degree: "MD" },
];
const NAMES = ["Aarav Sharma", "Diya Nair", "Kabir Reddy", "Meera Iyer",
               "Rohan Bose", "Isha Menon", "Vikram Rao", "Ananya Kulkarni",
               "Arjun Verma", "Neha Pillai", "Siddharth Joshi", "Priya Das"];

const guideOf  = (d) => `fb:sim-guide-${d}`;
const ACADEMIC = "fb:sim-academic-cell";

/** One institute, three departments, three programmes, twelve residents (four each). */
async function buildCollege(db) {
  const progs = [];
  for (const d of DEPTS) {
    progs.push(await S.createProgramme(env, ORG, {
      name: d.name, degree: d.degree, specialtyId: d.specialtyId,
      curriculumId: d.specialtyId, departmentId: d.id, durationMonths: 36,
    }, ACADEMIC, db));
  }
  const residents = [];
  let n = 0;
  for (let di = 0; di < DEPTS.length; di++) {
    for (let i = 0; i < 4; i++) {
      const idx = n++;
      residents.push(await S.enrolResident(env, ORG, {
        programmeId: progs[di].id,
        uid: `fb:sim-res-${String(idx + 1).padStart(2, "0")}`,
        name: NAMES[idx],
        email: `sim.resident${String(idx + 1).padStart(2, "0")}@example.com`,
        departmentId: DEPTS[di].id,
        trainingYear: (i % 3) + 1,
        startDate: `${2023 + (i % 3)}-05-01`,
        guide: guideOf(DEPTS[di].id),
        unit: `Unit ${String.fromCharCode(65 + (i % 2))}`,
      }, ACADEMIC, db));
    }
  }
  return { progs, residents };
}

const entryBody = (res, over = {}) => Object.assign({
  residentId: res.id, kind: "procedure", occurredAt: "2026-08-20",
  procedureText: "Central venous access", role: "performed_supervised",
  supervisor: res.guide, caseRef: "MRN 44821",
  departmentId: res.departmentId,
}, over);

// diagnosis is a kind:"clinical" field - M.entry drops it from a procedure entry entirely.
const clinicalBody = (res, over = {}) => Object.assign({
  residentId: res.id, kind: "clinical", occurredAt: "2026-08-20",
  setting: "ipd", supervisor: res.guide, title: "Septic shock, day 1 ward round",
  caseRef: "MRN 44821", diagnosis: "Septic shock",
  departmentId: res.departmentId,
}, over);

/* ══ EASY 1 ══ the college builds, and every resident lands where they were put ══ */
test("EASY 1 · a college of 3 departments and 12 residents builds correctly", async () => {
  const db = fakeDb();
  const { progs, residents } = await buildCollege(db);

  assert.equal(progs.length, 3, "three programmes");
  assert.equal(residents.length, 12, "twelve residents");

  for (const d of DEPTS) {
    const inDept = await S.listResidents(env, ORG, { departmentId: d.id }, db);
    assert.equal(inDept.length, 4, `${d.name} has exactly 4 residents`);
    for (const r of inDept) assert.equal(r.departmentId, d.id);
  }
  // Every resident is on the programme of their own department, not another's.
  const byId = new Map(progs.map((p) => [p.id, p]));
  for (const r of residents) {
    assert.equal(byId.get(r.programmeId).departmentId, r.departmentId,
      `${r.name} is on their own department's programme`);
  }
  for (const r of residents) assert.ok(r.trainingYear >= 1 && r.trainingYear <= 6);
});

/* ══ EASY 2 ══ a resident logs a procedure and submits it ══ */
test("EASY 2 · a resident logs a procedure and submits it for verification", async () => {
  const db = fakeDb();
  const { residents } = await buildCollege(db);
  const res = residents[0];

  const e = await S.createEntry(env, ORG, entryBody(res), res.uid, db);
  assert.equal(e.status, "draft");
  assert.equal(e.residentId, res.id);
  assert.equal(e.createdBy, res.uid);

  const sub = await S.submitEntry(env, e.id, res.uid, db);
  assert.equal(sub.status, "submitted");
  assert.ok(sub.submittedAt > 0, "submittedAt is stamped");

  const listed = await S.listEntries(env, res.id, {}, db);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "submitted");
});

/* ══ MODERATE 1 ══ the logbook is the STUDENT's: nobody may author it for them ══ */
test("MODERATE 1 · faculty cannot author, and a resident cannot self-verify", async () => {
  const db = fakeDb();
  const { residents } = await buildCollege(db);
  const res = residents[1];
  const guide = guideOf(res.departmentId);

  // PGMER-2023 5.2(vi): the student maintains the logbook.
  await assert.rejects(
    () => S.createEntry(env, ORG, entryBody(res), guide, db),
    (err) => /not_own_record/.test(String((err && (err.detail || err.message)) || "")),
    "a guide must not be able to write into a resident's logbook");

  const e = await S.createEntry(env, ORG, entryBody(res), res.uid, db);
  await S.submitEntry(env, e.id, res.uid, db);
  await assert.rejects(() => S.verifyEntry(env, e.id, res.uid, "", db),
    "self-verification must be refused");

  const ok = await S.verifyEntry(env, e.id, guide, "Seen and correct", db);
  assert.equal(ok.status, "verified");
  assert.equal(ok.verifiedBy, guide);
});

/* ══ MODERATE 2 ══ rotations are per resident and never leak across them ══ */
test("MODERATE 2 · rotations are recorded per resident and stay scoped", async () => {
  const db = fakeDb();
  const { residents } = await buildCollege(db);
  const a = residents[0], b = residents[5];

  await S.createRotation(env, ORG, {
    residentId: a.id, programmeId: a.programmeId, name: "Medical ICU",
    kind: "department", departmentId: a.departmentId, unit: "Unit A",
    startDate: "2026-01-01", endDate: "2026-03-31", faculty: guideOf(a.departmentId),
  }, ACADEMIC, db);
  await S.createRotation(env, ORG, {
    residentId: b.id, programmeId: b.programmeId, name: "Casualty",
    kind: "department", departmentId: b.departmentId,
    startDate: "2026-02-01", endDate: "2026-04-30",
  }, ACADEMIC, db);

  const ra = await S.listRotations(env, a.id, db);
  const rb = await S.listRotations(env, b.id, db);
  assert.equal(ra.length, 1);
  assert.equal(rb.length, 1);
  assert.equal(ra[0].name, "Medical ICU");
  assert.equal(rb[0].name, "Casualty");
  assert.ok(!ra.some((r) => r.residentId === b.id), "no cross-resident rotation leak");
});

/* ══ HARD 1 ══ a verified record is evidence: amend, never overwrite ══ */
test("HARD 1 · a verified entry cannot be silently rewritten", async () => {
  const db = fakeDb();
  const { residents } = await buildCollege(db);
  const res = residents[2];
  const guide = guideOf(res.departmentId);

  const e = await S.createEntry(env, ORG, entryBody(res), res.uid, db);
  await S.submitEntry(env, e.id, res.uid, db);
  const v = await S.verifyEntry(env, e.id, guide, "ok", db);
  assert.equal(v.status, "verified");

  await assert.rejects(() => S.editEntry(env, e.id, { diagnosis: "Something else" }, res.uid, db),
    "a verified entry must not be editable in place");

  const am = await S.amendEntry(env, e.id, { diagnosis: "Septic shock, source urinary" },
                                res.uid, "Source identified on culture", db);
  assert.ok(Array.isArray(am.revisions) && am.revisions.length >= 1,
    "an amendment keeps a revision trail");
  const after = await S.getEntry(env, e.id, db);
  assert.ok(after.revisions.length >= 1, "the trail is persisted, not just returned");
});

/* ══ SECURITY ══ an assessment records ONE person's judgement, under their registration ══
 * Found by audit: completeAssessment/signAssessment scoped on `cur.departmentId`, a field
 * M.assessment() never produces, so withinScope() short-circuited to true and department scope was
 * never evaluated. Neither checked who the assessor was, so a second faculty member could take over
 * another's form - M.assess sets out.assessor = actor - or sign it under their own council number. */
test("SECURITY · a second faculty member cannot take over or sign another's assessment", async () => {
  const db = fakeDb();
  const { residents } = await buildCollege(db);
  const res = residents[4];
  const guide = guideOf(res.departmentId);
  const other = "fb:sim-other-faculty";

  const a = await S.createAssessment(env, ORG, { residentId: res.id, templateId: "mini-cex" }, guide, db);
  assert.equal(a.assessor, guide, "the creator is recorded as the assessor");

  await assert.rejects(
    () => S.completeAssessment(env, a.id, { scores: {} }, null, other, db),
    (e) => /not_the_assessor/.test(String((e && e.message) || "")),
    "another faculty member must not complete someone else's assessment");

  await assert.rejects(
    () => S.signAssessment(env, a.id, other, db),
    (e) => /not_the_assessor/.test(String((e && e.message) || "")),
    "another faculty member must not sign it under their own registration");
});

/* ══ INTEGRITY ══ attendance is an examination pre-requisite, so it cannot be pre-dated ══
 * occurredAt was future-bounded; endDate was not. Attendance is the one kind that EXPANDS into
 * per-day rows, so a single "present" range ending twelve months out added up to 366 attended days
 * to the count an eligibility check reads. */
test("INTEGRITY · attendance cannot be recorded for days that have not happened", () => {
  const today = "2026-08-28";
  const e = M.entry({
    id: "att-1", residentId: "r1", orgId: ORG, kind: "attendance",
    occurredAt: "2026-08-01", endDate: "2027-06-30", state: "present",
  });

  const v = M.validateEntry(e, { today });
  assert.equal(v.ok, false, "a future end date must be refused");
  assert.ok(v.errors.some((x) => x.field === "endDate"), "and the end date is the field named");

  // Defence in depth: rows written before the rule existed must still not be counted forward.
  const rows = M.expandAttendance([e], today);
  assert.ok(rows.length > 0, "the days up to today still count");
  assert.ok(rows.every((r) => r.date <= today), "no attended day may fall in the future");
});

/* ══ INTEGRITY ══ a gap in the weekly strip must sit on the week it happened ══
 * weeklyCadence returned a COUNT and a set of missed keys but not the ordered week list, so the
 * strip had no way to place a gap and marked the first N cells instead. A resident who logged
 * steadily for a year and then stopped saw the gap drawn at the start of their training. */
test("INTEGRITY · weekly cadence exposes the ordered weeks a gap can be placed on", () => {
  const entries = [
    { id: "w-first", kind: "procedure", occurredAt: "2026-06-03", deleted: false },
    { id: "w-last",  kind: "procedure", occurredAt: "2026-08-26", deleted: false },
  ];
  const wk = M.weeklyCadence(entries, "2026-06-01", "2026-08-28");

  assert.ok(Array.isArray(wk.order), "the ordered week list is returned");
  assert.equal(wk.order.length, wk.weeks, "one entry per counted week");
  assert.deepEqual(wk.order.slice().sort(), wk.order, "and it is in chronological order");

  const missed = new Set(wk.missed);
  assert.ok(!missed.has(wk.order[0]), "the first week was logged, so it is not a gap");
  assert.ok(!missed.has(wk.order[wk.order.length - 1]), "nor is the last");
  assert.ok(missed.size > 0, "the middle weeks are gaps");
  for (const w of missed) assert.ok(wk.order.indexOf(w) > -1, `${w} is one of the ordered weeks`);
});

/* ══ INTEGRITY ══ a printed report must not carry a column it never fills ══
 * The Clinical Activity report always emitted a "Diagnosis" header while filling the cell only when
 * case references were shown, and that toggle is offered on two other reports but not this one - so
 * it printed a column of blanks with no way to populate it. Emitting a column conditionally is also
 * the easiest way to desynchronise headers from rows, so the arity is asserted in both modes. */
test("INTEGRITY · the clinical report's columns and rows stay in step", () => {
  const R = require("../pglog-reports.js");
  const ctx = {
    resident: { id: "r1", name: "Aarav Sharma", trainingYear: 2 },
    programme: { name: "General Medicine", degree: "MD" },
    entries: [{
      id: "e1", kind: "clinical", setting: "ipd", occurredAt: "2026-08-20",
      title: "Sepsis", category: "infection", diagnosis: "Septic shock",
      caseRef: "MRN 44821", outcome: "improved", supervisor: "fb:guide-1", status: "verified",
    }],
    today: "2026-08-28", orgName: "Sim Medical College",
  };

  for (const includeCaseRef of [false, true]) {
    const rep = R.clinicalReport(ctx, { includeCaseRef });
    for (const s of rep.sections || []) {
      if (!s.columns) continue;
      for (const row of s.rows || []) {
        assert.equal(row.length, s.columns.length,
          `every row matches the header count (includeCaseRef=${includeCaseRef}, ${s.heading})`);
      }
    }
    const clinical = (rep.sections || []).find((s) => s.columns && (s.rows || []).length === 1);
    const hasDiagnosis = !!(clinical && clinical.columns.indexOf("Diagnosis") > -1);
    assert.equal(hasDiagnosis, includeCaseRef,
      "the Diagnosis column appears only when it will actually be filled");
  }
});

/* ══ HARD 2 ══ cross-resident reads must never carry clinical identifiers ══ */
test("HARD 2 · an institution-wide viewer never receives case refs or diagnoses", async () => {
  const db = fakeDb();
  const { residents } = await buildCollege(db);
  const res = residents[3];

  const e = await S.createEntry(env, ORG, clinicalBody(res), res.uid, db);

  const self = S.publicEntry(e, "self");
  assert.equal(self.caseRef, "MRN 44821", "the resident sees their own case reference");
  assert.equal(self.diagnosis, "Septic shock");

  for (const audience of ["aggregate", "roster"]) {
    const view = S.publicEntry(e, audience);
    assert.ok(!view.caseRef, `${audience} must not receive a case reference`);
    assert.ok(!view.diagnosis, `${audience} must not receive a diagnosis`);
  }

  const roster = (await S.listResidents(env, ORG, { departmentId: res.departmentId }, db))
    .map((r) => S.publicResident(r, "roster"));
  for (const r of roster) assert.ok(!r.uid, "a roster row must not expose the Firebase uid");
});
