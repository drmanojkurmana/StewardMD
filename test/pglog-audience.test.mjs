/* test/pglog-audience.test.mjs — WHO SEES WHAT.
 * ===========================================================================
 * `canReadResident` decides how much of a trainee's logbook each caller receives, and it has been
 * wrong twice: once returning "verifier" for every faculty member in the institution (R1, C5), and
 * once letting the Academic Cell and the technical admin ride the department branch into full
 * clinical detail because they happen to hold the department capability too.
 *
 * Both times the code read plausibly. So this file does not read it — it enumerates every role
 * against every relationship and asserts the audience, then asserts what each audience actually
 * discloses. A privacy boundary with no table is a privacy boundary nobody can check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = require("../pglog-model.js");
const S = await import("../functions/_pglog_store.js");
const { canReadResident } = await import("../functions/api/pglog/[[path]].js");

const RESIDENT = { id: "r1", uid: "fb:resident-1", orgId: "org1", departmentId: "dept-med",
                   guide: "fb:guide-1", coGuides: ["fb:coguide-1"], name: "Dr A", smdId: "SMD-1" };
const ctxFor = (role, uid, scope) => ({ role, actorUid: uid,
  member: scope ? { scope: { departments: scope } } : { scope: {} } });

async function audience(role, uid, opts = {}) {
  try {
    return await canReadResident({}, ctxFor(role, uid, opts.scope), opts.resident || RESIDENT, opts.entry);
  } catch (e) { return "DENIED"; }
}

test("the audience matrix — every role, every relationship", async () => {
  const cases = [
    // [role, actor, expected, note]
    ["pg_resident",   "fb:resident-1", "self",      "their own logbook"],
    ["pg_resident",   "fb:resident-2", "DENIED",    "another trainee's logbook is not theirs to read"],
    ["pg_faculty",    "fb:guide-1",    "verifier",  "the named guide"],
    ["pg_faculty",    "fb:coguide-1",  "verifier",  "a co-guide"],
    ["pg_faculty",    "fb:stranger",   "aggregate", "a faculty member with no relationship to this trainee"],
    ["pg_hod",        "fb:stranger",   "hod",       "the head of the trainee's department"],
    ["academic_cell", "fb:cell",       "aggregate", "institution-wide oversight is a completeness question"],
    ["admin",         "fb:admin",      "aggregate", "a technical admin is not a clinical supervisor"],
    ["viewer",        "fb:nobody",     "DENIED",    "no logbook capability at all"],
    ["doctor",        "fb:doc",        "DENIED",    "a clinician outside the programme"]
  ];
  for (const [role, uid, want, note] of cases) {
    assert.equal(await audience(role, uid), want, role + " / " + note);
  }
});

test("REGRESSION: the Academic Cell and the admin also hold the DEPARTMENT cap", async () => {
  // Which is exactly why ordering the guard by capability breadth failed: they entered the HoD
  // branch and the institution branch below it was dead code. If either of these ever returns "hod",
  // every trainee's case references, diagnoses, remarks and reflections are readable institution-wide.
  const ROLES = await import("../functions/_queue_roles.js");
  assert.ok(ROLES.can("academic_cell", ROLES.CAPS.PGLOG_VIEW_DEPT), "premise: the cell holds VIEW_DEPT");
  assert.ok(ROLES.can("admin", ROLES.CAPS.PGLOG_VIEW_DEPT), "premise: admin holds VIEW_DEPT");
  assert.equal(await audience("academic_cell", "fb:cell"), "aggregate");
  assert.equal(await audience("admin", "fb:admin"), "aggregate");
});

test("a supervisor named on THIS entry is upgraded, for THIS entry only", async () => {
  const entry = { id: "e1", supervisor: "fb:stranger" };
  assert.equal(await audience("pg_faculty", "fb:stranger", { entry }), "verifier");
  assert.equal(await audience("pg_faculty", "fb:stranger"), "aggregate", "and not for the rest of the logbook");
});

test("an HoD scoped to another department gets aggregate, not clinical detail", async () => {
  assert.equal(await audience("pg_hod", "fb:hod", { scope: ["dept-surg"] }), "aggregate");
  assert.equal(await audience("pg_hod", "fb:hod", { scope: ["dept-med"] }), "hod");
  // A resident in no department is not "in every department".
  const noDept = Object.assign({}, RESIDENT, { departmentId: "" });
  assert.equal(await audience("pg_hod", "fb:hod", { resident: noDept, scope: ["dept-med"] }), "aggregate");
});

/* ── what each audience actually discloses ─────────────────────────────────── */

// The signature block and the verification code are written onto the stored document by the server
// and are not part of M.entry()'s schema, so the fixture mirrors the shape publicEntry() really sees.
const ENTRY = Object.assign(M.entry({ id: "e1", kind: "clinical", residentId: "r1", orgId: "org1",
  occurredAt: "2026-08-20", title: "Diabetic ketoacidosis", caseRef: "MRN-4482",
  diagnosis: "DKA", remarks: "Missed the anion gap initially", role: "assisted", status: "verified" }),
  { verifiedReg: "TN/1", verifiedCouncil: "TNMC", verifiedName: "Dr G", verifyCode: "PGL-AAAAA-BBBBB" });
const ASSESS = M.assessment({ id: "a1", residentId: "r1", orgId: "org1", templateId: "dops",
  outcome: "remediation", total: 12, maxTotal: 30, feedback: "Struggled with consent",
  strengths: "Gentle with the patient", improvements: "Anatomy revision",
  actionPlan: "Repeat under supervision in two weeks", scores: { c1: 2 },
  assessor: "fb:guide-1", assessedAt: 1 });
ASSESS.verifyCode = "PGL-CCCCC-DDDDD";
const ATTEST = M.attestation({ id: "t1", residentId: "r1", orgId: "org1", kind: "monthly",
  period: "2026-08", note: "Trainee counselled about punctuality", entryIds: ["e1"],
  counts: { total: 1, verified: 1 }, attestedBy: "fb:guide-1", attestedAt: 1 });
ATTEST.verifyCode = "PGL-EEEEE-FFFFF";

test("AGGREGATE sees that it happened, never what it said", () => {
  const e = S.publicEntry(ENTRY, "aggregate");
  for (const k of ["caseRef", "diagnosis", "remarks", "procedureText", "ageBand", "sex"]) {
    assert.ok(!e[k], "entry." + k + " must not reach an aggregate audience");
  }
  assert.equal(e.title, "");
  assert.equal(e.kind, "clinical", "but the CATEGORY and the fact of it remain — that is the oversight");
  assert.equal(e.status, "verified");

  const a = S.publicAssessment(ASSESS, "aggregate");
  for (const k of ["feedback", "strengths", "improvements", "actionPlan", "scores", "caseSummary"]) {
    assert.ok(!a[k], "assessment." + k + " must not reach an aggregate audience");
  }
  assert.equal(a.outcome, "remediation", "that remediation was needed is a training fact");
  assert.equal(a.templateId, "dops");

  const t = S.publicAttestation(ATTEST, "aggregate");
  assert.equal(t.note, "", "an attestation note is written about a named trainee");
  assert.equal(t.period, "2026-08");
  assert.equal(t.counts.verified, 1);
});

test("the VERIFICATION CODE is a capability, not a fact about the record", () => {
  // Anyone holding a code can query the unauthenticated endpoint for the resident's name, programme
  // and the signer's registration. It goes only to people who can already read the record.
  assert.equal(S.publicEntry(ENTRY, "aggregate").verifyCode, "");
  assert.equal(S.publicAssessment(ASSESS, "aggregate").verifyCode, "");
  assert.equal(S.publicAttestation(ATTEST, "aggregate").verifyCode, "");
  assert.equal(S.publicEntry(ENTRY, "self").verifyCode, "PGL-AAAAA-BBBBB");
  assert.equal(S.publicEntry(ENTRY, "hod").verifyCode, "PGL-AAAAA-BBBBB");
});

test("the signature stays visible at every audience — it is what makes the record mean anything", () => {
  assert.equal(S.publicEntry(ENTRY, "aggregate").verifiedReg, "TN/1");
});

test("the resident's Firebase uid leaves the server only for the resident", () => {
  assert.equal(S.publicResident(RESIDENT, "self").uid, "fb:resident-1");
  for (const aud of ["verifier", "hod", "aggregate", "roster"]) {
    assert.equal(S.publicResident(RESIDENT, aud).uid, undefined, aud + " must not receive the uid");
    assert.equal(S.publicResident(RESIDENT, aud).name, "Dr A", "but the roster still works");
  }
});
