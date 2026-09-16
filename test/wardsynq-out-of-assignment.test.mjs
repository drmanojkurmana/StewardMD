/* test/wardsynq-out-of-assignment.test.mjs - P2.17: chart reads outside a staff member's assignment.
 * The pure rule first, then GET /api/queue/ward/security-report with real nurse assignments, admissions
 * and a rota, then the Admin screen's not-evaluated state.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-out-of-assignment.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async (id) => "ref-" + id }),
  },
});

const SR = await import("../functions/_wardsynq/security-review.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

// ---------------------------------------------------------------------------------------------
// PURE RULE
// ---------------------------------------------------------------------------------------------
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const H = 3600000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const PERIOD = { from: iso(NOW - 7 * D), to: iso(NOW) };
const read = (actor, ms, patient, extra) => ({ id: `r-${actor}-${ms}-${patient}`, ts: iso(ms), actor, action: "record.read", patientRefHash: patient, scope: { resourceType: "Observation", id: "obs-" + patient }, outcome: "ok", ...(extra || {}) });
const STAYS = [
  { patientRef: "p1", ward: "Ward A", attendingId: "dr-att", from: iso(NOW - 5 * D), to: null },
  { patientRef: "p2", ward: "Ward B", attendingId: null, from: iso(NOW - 5 * D), to: null },
];
const ASSIGN = [
  { staffId: "nurse", patientRef: "p1", from: iso(NOW - 3 * D), to: null, source: "nurse-assignment" },
  { staffId: "doc", ward: "ward b", from: iso(NOW - 2 * H), to: iso(NOW - 1 * H + 30 * 60000), source: "roster" },
];
const OPTS = { period: PERIOD, tenantId: "t1", roles: { nurse: "nurse", doc: "doctor", labtech: "lab", "dr-att": "doctor", newbie: "nurse" }, stays: STAYS, breakGlass: [] };

test("an assigned read gives no flag; an unassigned read gives a flag with the audit row as evidence", () => {
  const r = SR.outOfAssignmentFindings([
    read("nurse", NOW - H, "p1"),              // assigned by nurse assignment
    read("doc", NOW - H, "p2"),                // rostered on Ward B (case ignored) at the time
    read("nurse", NOW - H, "p2"),              // not assigned to p2 or Ward B
  ], ASSIGN, OPTS);
  assert.equal(r.status, "ok");
  assert.equal(r.assignedReads, 2);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.type, "out-of-assignment");
  assert.equal(f.actor, "nurse");
  assert.equal(f.evidence[0].id, `r-nurse-${NOW - H}-p2`, "evidence names the read's audit row");
  assert.equal(f.evidence[0].recordId, "obs-p2");
  assert.equal(r.counts["out-of-assignment"], 1);
});

test("a rota shift only covers its own hours", () => {
  const r = SR.outOfAssignmentFindings([read("doc", NOW - 5 * H, "p2"), read("doc", NOW - 20 * 60000, "p2")], ASSIGN, OPTS);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].evidenceTotal, 2, "before the shift and after it both flag");
});

test("no assignment data for the person, or for anyone in the period, is NOT EVALUATED with a reason, never no findings", () => {
  const r = SR.outOfAssignmentFindings([read("newbie", NOW - H, "p2")], ASSIGN, OPTS);
  assert.equal(r.findings.length, 0);
  assert.equal(r.notEvaluated.length, 1);
  assert.equal(r.notEvaluated[0].actor, "newbie");
  assert.match(r.notEvaluated[0].reason, /No nurse assignment or rota shift/);
  assert.equal(r.notEvaluated[0].evidence[0].id, `r-newbie-${NOW - H}-p2`);

  const none = SR.outOfAssignmentFindings([read("nurse", NOW - H, "p2")], [], OPTS);
  assert.equal(none.status, "not_evaluated");
  assert.equal(none.findings, undefined, "no findings list at all, so it cannot be read as clean");
  assert.match(none.reason, /cannot be compared/);

  const oldOnly = SR.outOfAssignmentFindings([read("nurse", NOW - H, "p2")], [{ staffId: "nurse", patientRef: "p1", from: iso(NOW - 30 * D), to: iso(NOW - 20 * D) }], OPTS);
  assert.equal(oldOnly.status, "not_evaluated", "assignments only outside the period do not count");

  const unmatched = SR.outOfAssignmentFindings([read("nurse", NOW - H, "p2")], [{ staffId: "nurse", ward: "Nights", from: iso(NOW - D), to: null }], OPTS);
  assert.equal(unmatched.status, "not_evaluated", "a rota unit that names no ward is not assignment data");

  const noRoles = SR.outOfAssignmentFindings([read("nurse", NOW - H, "p2")], ASSIGN, { ...OPTS, roles: null });
  assert.equal(noRoles.findings.length, 0);
  assert.match(noRoles.notEvaluated[0].reason, /roles could not be read/);

  const partial = SR.outOfAssignmentFindings([read("nurse", NOW - H, "p2")], ASSIGN, { ...OPTS, incomplete: ["the rota could not be read"] });
  assert.equal(partial.findings.length, 0, "an incomplete source never produces a flag it might have covered");
  assert.match(partial.notEvaluated[0].reason, /rota could not be read/);
});

test("exemptions: break-glass, roles not assigned to wards, and the treating clinician, each listed", () => {
  const bg = [{ actorId: "nurse", patientRef: "p2", from: iso(NOW - 2 * H), to: iso(NOW - 30 * 60000) }];
  const r = SR.outOfAssignmentFindings([
    read("nurse", NOW - H, "p2"),        // under her own live break-glass grant
    read("nurse", NOW - 10 * 60000, "p2"), // after the grant expired: flagged
    read("labtech", NOW - H, "p2"),      // lab: exempt role
    read("dr-att", NOW - H, "p1"),       // attending on the admission
  ], ASSIGN, { ...OPTS, breakGlass: bg });
  assert.deepEqual(r.exempt.map((x) => x.actor + ":" + x.exemption).sort(), ["dr-att:treating-clinician", "labtech:role-not-ward-assigned", "nurse:break-glass"]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].evidenceTotal, 1);
  assert.deepEqual(r.exemptions.map((x) => x.id), ["break-glass", "role-not-ward-assigned", "treating-clinician"]);
  assert.ok(SR.EXEMPT_ROLES.includes("pharmacy") && SR.EXEMPT_ROLES.includes("billing") && !SR.EXEMPT_ROLES.includes("nurse"));
});

test("reads from another hospital are never included", () => {
  const r = SR.outOfAssignmentFindings([
    read("nurse", NOW - H, "p2", { tenantId: "t2" }),
    read("nurse", NOW - H, "p9", { tenantId: "t1" }),
  ], [...ASSIGN, { staffId: "nurse", patientRef: "p9", from: iso(NOW - D), to: null, tenantId: "t2" }], { ...OPTS, stays: [...STAYS, { patientRef: "p9", ward: "Ward A", from: iso(NOW - D), tenantId: "t1" }] });
  assert.equal(r.readsInPeriod, 1, "the other hospital's read is not counted at all");
  assert.equal(r.findings.length, 1, "and the other hospital's assignment covers nothing here");
  assert.equal(r.findings[0].evidence[0].patientRef, "p9");
});

test("nurse assignment history and rota rows become intervals", () => {
  const iv = SR.nurseAssignmentIntervals({ history: [
    { action: "assign", nurseId: "n1", at: "2026-09-10T08:00:00.000Z" },
    { action: "assign", nurseId: "n2", at: "2026-09-10T20:00:00.000Z" },
    { action: "unassign", nurseId: "n2", at: "2026-09-11T08:00:00.000Z" },
  ] }, "p1");
  assert.deepEqual(iv.map((x) => [x.staffId, x.from, x.to]), [["n1", "2026-09-10T08:00:00.000Z", "2026-09-10T20:00:00.000Z"], ["n2", "2026-09-10T20:00:00.000Z", "2026-09-11T08:00:00.000Z"]]);
  const rv = SR.rosterIntervals({ shifts: { night: { unit: "Ward A", start: "20:00", end: "08:00" } }, assignments: [{ identity: "n3", date: "2026-09-10", shiftId: "night", status: "active" }, { identity: "n4", date: "2026-09-10", shiftId: "night", status: "cancelled" }] }, 330);
  assert.equal(rv.length, 1);
  assert.equal(rv[0].from, "2026-09-10T14:30:00.000Z", "20:00 IST is 14:30 UTC");
  assert.equal(rv[0].to, "2026-09-11T02:30:00.000Z", "an overnight shift ends the next morning");
});

// ---------------------------------------------------------------------------------------------
// REAL ROUTE: GET /api/queue/ward/security-report
// ---------------------------------------------------------------------------------------------
const ORG_ID = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", LAB = "lab@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"], [NURSE, "nurse"], [LAB, "lab"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const rec = (resourceType, id, fields) => ({ resourceType, id, version: 1, writtenBy: { id: "seed", kind: "service", at: new Date(Date.now() - 6 * D).toISOString() }, ...fields });

test("route: assigned read clean, unassigned read flagged with evidence, lab exempt, rota covers the doctor, another hospital's reads excluded", async () => {
  seedHospital();
  const now = Date.now();
  const T = TENANT_ROW.id;
  await RECORD.append(T, [
    rec("Encounter", "enc-1", { patientId: "pat-1", location: { ward: "Ward A", bed: "1" }, periodStart: iso(now - 5 * D), class: "inpatient", status: "in-progress" }),
    rec("Encounter", "enc-2", { patientId: "pat-2", location: { ward: "Ward B", bed: "2" }, periodStart: iso(now - 5 * D), class: "inpatient", status: "in-progress" }),
    rec("NurseAssignment", "wsq-nassign-enc-1", { patientId: "pat-1", encounterId: "enc-1", nurseId: idFor(NURSE), history: [{ action: "assign", nurseId: idFor(NURSE), at: iso(now - 3 * D), by: "seed" }] }),
  ], {});
  // The doctor is on a full-day Ward B shift today (hospital local day, +330 minutes).
  const localDay = new Date(now - H + 330 * 60000).toISOString().slice(0, 10);
  docs.set(`q_roster_shifts/${ORG_ID}__day`, { fields: { orgId: ORG_ID, shiftId: "day", name: "Day", unit: "Ward B", start: "00:00", end: "00:00", active: true }, updateTime: "t1" });
  docs.set("q_roster_assign/a1", { fields: { orgId: ORG_ID, orgMonth: ORG_ID + "|" + localDay.slice(0, 7), identity: idFor(DOCTOR), date: localDay, shiftId: "day", status: "active" }, updateTime: "t1" });

  const audit = (tenant, who, patient) => RECORD.auditOnly(tenant, { ts: iso(now - H), actor: idFor(who), action: "record.read", patientRefHash: "ref-" + patient, scope: { resourceType: "Observation", id: "o-" + patient }, outcome: "ok" });
  await audit(T, NURSE, "pat-1");
  await audit(T, NURSE, "pat-2");
  await audit(T, LAB, "pat-2");
  await audit(T, DOCTOR, "pat-2");
  await audit("tenant-other", NURSE, "pat-2");
  await audit("tenant-other", NURSE, "pat-2");

  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}&days=7`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  const a = rep.assignmentAccess;
  assert.equal(a.status, "ok", JSON.stringify(a));
  assert.equal(a.findings.length, 1, JSON.stringify(a.findings));
  assert.equal(a.findings[0].actor, idFor(NURSE));
  assert.equal(a.findings[0].evidenceTotal, 1, "the other hospital's two reads of the same patient are not included");
  assert.ok(a.findings[0].evidence[0].id, "evidence names the audit row");
  assert.equal(a.findings[0].evidence[0].recordId, "o-pat-2");
  assert.ok(a.assignedReads >= 2, "the assigned nurse read and the rostered doctor read are clean");
  assert.ok(a.exempt.some((x) => x.actor === idFor(LAB) && x.exemption === "role-not-ward-assigned"));
  assert.equal(rep.counts["out-of-assignment"], 1);
  assert.ok(rep.methods["out-of-assignment"]);
});

test("route NEGATIVE: the report stays STAFF_ADMIN; a nurse gets 403 and no report is audited", async () => {
  seedHospital();
  const r = await as(NURSE, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(r.__status, 403);
  assert.equal(r.assignmentAccess, undefined);
  assert.ok(!RECORD.audit.some((x) => x.action === "security.report"));
});

// ---------------------------------------------------------------------------------------------
// ADMIN SCREEN
// ---------------------------------------------------------------------------------------------
test("screen: not evaluated reads as not evaluated, never as no findings", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const html = win.WSQ._securityReviewHtml;
  const c = { esc: win.WSQ.esc };
  const emptyOk = { status: "ok", findings: [], counts: {} };
  const base = { days: 7, note: "Advisory.", counts: {}, notDetected: [], chartAccess: emptyOk, exports: emptyOk, logins: emptyOk,
    reviewQueue: { status: "ok", items: [], awaiting: 0, missing: [] }, dataProtection: { status: "red", reasons: [] }, auditRetention: { status: "ok" } };
  const notEval = html(c, { ...base, assignmentAccess: { status: "not_evaluated", reason: "No nurse assignment is recorded.", exemptions: SR.EXEMPTIONS } });
  assert.match(notEval, /Not evaluated: No nurse assignment is recorded/);
  assert.match(notEval, /not the same as no findings/);
  assert.ok(!/No reads outside an assignment/.test(notEval));
  const flagged = html(c, { ...base, assignmentAccess: { status: "ok", readsInPeriod: 3, assignedReads: 1, incomplete: [], exemptions: SR.EXEMPTIONS,
    findings: [{ type: "out-of-assignment", actor: "n1", summary: "1 read of 1 patient.", method: "m", evidence: [{ id: "audit-77", ts: "t", action: "record.read", recordId: "obs-1" }], evidenceTotal: 1 }],
    notEvaluated: [{ actor: "x", reason: "No data.", reads: 1, evidence: [{ id: "audit-78" }] }], exempt: [] } });
  assert.match(flagged, /audit-77/);
  assert.match(flagged, /audit-78/);
  assert.match(flagged, /Read outside an assignment/);
  const failed = html(c, { ...base, assignmentAccess: { status: "unavailable", detail: "Admissions could not be read" } });
  assert.match(failed, /Could not be checked: Admissions could not be read/);
  assert.ok(!/[—–]/.test(notEval + flagged + failed), "no em or en dash on screen");
});

// ---------------------------------------------------------------------------------------------
// G11: WARD HISTORY, ONE READER ACROSS SIGN-INS, CLICKABLE EVIDENCE
// ---------------------------------------------------------------------------------------------
test("G11 ward history: a read before a transfer compares against the ward the patient was on THEN, and the flag names both wards", () => {
  const versions = [
    { version: 1, patientId: "p", location: { ward: "Ward A" }, periodStart: iso(NOW - 5 * D), attendingId: null },
    { version: 2, patientId: "p", location: { ward: "Ward A", bed: "3" }, periodStart: iso(NOW - 5 * D) },
    { version: 3, patientId: "p", location: { ward: "Ward B" }, periodStart: iso(NOW - 5 * D), movedAt: iso(NOW - 2 * D) },
  ];
  const stays = SR.wardHistoryStays(versions, "p9");
  assert.deepEqual(stays.map((s) => [s.ward, s.from, s.to]), [["Ward A", iso(NOW - 5 * D), iso(NOW - 2 * D)], ["Ward B", iso(NOW - 2 * D), null]]);

  const rota = [{ staffId: "doc", ward: "Ward A", from: iso(NOW - 4 * D), to: iso(NOW - 1 * D), source: "roster" }];
  const opts = { period: PERIOD, tenantId: "t1", roles: { doc: "doctor" }, stays, breakGlass: [] };
  const before = SR.outOfAssignmentFindings([read("doc", NOW - 3 * D, "p9")], rota, opts);
  assert.equal(before.findings.length, 0, "on Ward A then, rostered on Ward A then: within the assignment");
  assert.equal(before.assignedReads, 1);
  const after = SR.outOfAssignmentFindings([read("doc", NOW - 1.5 * D, "p9")], rota, opts);
  assert.equal(after.findings.length, 1, JSON.stringify(after));
  const row = after.findings[0].evidence[0];
  assert.equal(row.wardAtRead, "Ward B", "the patient had moved to Ward B");
  assert.deepEqual(row.readerWardsAtRead, ["Ward A"], "the reader was rostered on Ward A at that moment");
});

test("G11 one reader: Google, email access and staff sign-in ids linked by email are one person, for assignments and findings", () => {
  const aliases = SR.readerAliases([["fb:u1", "nurse@x.test"], ["nurse@x.test", "cfa:n1"], ["staff-n1", "nurse@x.test"]], ["staff-n1"]);
  assert.deepEqual([aliases["fb:u1"], aliases["cfa:n1"], aliases["nurse@x.test"]], ["staff-n1", "staff-n1", "staff-n1"], "named by the membership identity");
  const assign = [{ staffId: "staff-n1", patientRef: "p1", from: iso(NOW - 3 * D), to: null, source: "nurse-assignment" }];
  const opts = { ...OPTS, roles: { "staff-n1": "nurse" }, aliases };
  const r = SR.outOfAssignmentFindings([read("fb:u1", NOW - H, "p1"), read("cfa:n1", NOW - H, "p2"), read("cfa:n1", NOW - 2 * H, "p2")], assign, opts);
  assert.equal(r.assignedReads, 1, "the Google sign-in read is covered by the assignment made to the staff identity");
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].actor, "staff-n1");
  assert.deepEqual(r.findings[0].signIns, ["cfa:n1"], "the finding names which sign-in made the reads");
  const without = SR.outOfAssignmentFindings([read("fb:u1", NOW - H, "p1")], assign, { ...OPTS, roles: { "staff-n1": "nurse", "fb:u1": "nurse" } });
  assert.equal(without.assignedReads, 0, "without matching, the same person would not be recognised");
});

const OTHER_ADMIN = "boss@other.test";
function seedOther() {
  docs.set("q_orgs/org-other", { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: "org-other", identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function bare(path) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("G11 route: GET /api/queue/ward/security-report uses the ward history and matches a Google sign-in to the assigned nurse by email", async () => {
  seedHospital();
  const now = Date.now();
  const T = TENANT_ROW.id;
  await RECORD.append(T, [rec("Encounter", "enc-t", { patientId: "pat-t", location: { ward: "Ward A", bed: "1" }, periodStart: iso(now - 5 * D), class: "inpatient", status: "in-progress" })], {});
  await RECORD.append(T, [rec("Encounter", "enc-t", { version: 2, patientId: "pat-t", location: { ward: "Ward B", bed: "4" }, periodStart: iso(now - 5 * D), movedAt: iso(now - 2 * D), class: "inpatient", status: "in-progress" }),
    rec("NurseAssignment", "wsq-nassign-x", { patientId: "pat-other", encounterId: "enc-x", nurseId: idFor(NURSE), history: [{ action: "assign", nurseId: idFor(NURSE), at: iso(now - 4 * D), by: "seed" }] })], {});
  docs.set("q_users/fb-uid-nurse", { fields: { smdId: "SMD-U-1", email: NURSE }, updateTime: "t1" });
  // The doctor is rostered on Ward A three days ago, when the patient was still there.
  const day = new Date(now - 3 * D + 6 * H + 330 * 60000).toISOString().slice(0, 10);
  docs.set(`q_roster_shifts/${ORG_ID}__day`, { fields: { orgId: ORG_ID, shiftId: "day", name: "Day", unit: "Ward A", start: "00:00", end: "00:00", active: true }, updateTime: "t1" });
  docs.set("q_roster_assign/a1", { fields: { orgId: ORG_ID, orgMonth: ORG_ID + "|" + day.slice(0, 7), identity: idFor(DOCTOR), date: day, shiftId: "day", status: "active" }, updateTime: "t1" });
  const readAt = (who, ms) => RECORD.auditOnly(T, { ts: iso(ms), actor: who, action: "record.read", patientRefHash: "ref-pat-t", scope: { resourceType: "Observation", id: "o-t" }, outcome: "ok" });
  await readAt(idFor(DOCTOR), now - 3 * D + 6 * H);
  await readAt("fb:uid-nurse", now - H);

  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}&days=7`);
  assert.equal(rep.__status, 200, JSON.stringify(rep).slice(0, 300));
  const a = rep.assignmentAccess;
  assert.equal(a.status, "ok", JSON.stringify(a));
  assert.ok(a.assignedReads >= 1, "the doctor's read before the transfer is within the Ward A shift: " + JSON.stringify(a));
  assert.ok(!a.findings.some((f) => f.actor === idFor(DOCTOR)), JSON.stringify(a.findings));
  const nurse = a.findings.find((f) => f.actor === idFor(NURSE));
  assert.ok(nurse, "the Google sign-in's read is attributed to the nurse's membership: " + JSON.stringify(a));
  assert.deepEqual(nurse.signIns, ["fb:uid-nurse"]);
  assert.equal(nurse.evidence[0].wardAtRead, "Ward B");
});

test("G11 route NEGATIVE: GET /api/queue/ward/audit-rows refuses no session (401), a nurse (403), another hospital's admin, and bad ids (422); nothing is audited", async () => {
  seedHospital();
  seedOther();
  await RECORD.auditOnly(TENANT_ROW.id, { ts: iso(Date.now() - H), actor: idFor(NURSE), action: "record.read", patientRefHash: "ref-p", scope: { resourceType: "Observation", id: "o1" }, outcome: "ok" });
  const id = (await RECORD.auditTrail(TENANT_ROW.id, {})).events[0].id;
  const path = `/ward/audit-rows?orgId=${ORG_ID}&ids=${id}`;
  const audits = RECORD.audit.length;
  assert.equal((await bare(path)).__status, 401);
  const nurse = await as(NURSE, path);
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  assert.equal(nurse.rows, undefined);
  const other = await as(OTHER_ADMIN, path);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  assert.equal(other.rows, undefined);
  assert.equal((await as(ADMIN, `/ward/audit-rows?orgId=${ORG_ID}&ids=`)).__status, 422);
  assert.equal((await as(ADMIN, `/ward/audit-rows?orgId=${ORG_ID}&ids=${encodeURIComponent("bad id;drop")}`)).__status, 422);
  assert.equal(RECORD.audit.length, audits, "no refused call wrote an audit row");
});

test("G11 route POSITIVE: the admin opens the audit rows behind a flag, with the chained row number; unknown ids are named; the read is audited", async () => {
  seedHospital();
  await RECORD.auditOnly(TENANT_ROW.id, { ts: iso(Date.now() - H), actor: idFor(NURSE), action: "record.read", patientRefHash: "ref-p", scope: { resourceType: "Observation", id: "o1" }, outcome: "ok" });
  await RECORD.auditOnly("tenant-other", { ts: iso(Date.now() - H), actor: "x", action: "record.read", outcome: "ok" });
  const mine = (await RECORD.auditTrail(TENANT_ROW.id, {})).events[0].id;
  const theirs = (await RECORD.auditTrail("tenant-other", {})).events[0].id;
  const r = await as(ADMIN, `/ward/audit-rows?orgId=${ORG_ID}&ids=${mine},${theirs},nope-1`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.rows.length, 1, "another hospital's row is never returned");
  assert.equal(r.rows[0].id, mine);
  assert.equal(r.rows[0].recordId, "o1");
  assert.equal(r.rows[0].chainSeq, 1);
  assert.deepEqual(r.missing.sort(), [theirs, "nope-1"].sort());
  assert.ok(RECORD.audit.some((e) => e.action === "security.audit_rows"), "opening the rows is itself in the audit trail");
});

test("G11 D1 repository: auditRowsById reads this hospital's rows by id with their chain link number, on real SQLite", async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { t.skip("node:sqlite unavailable"); return; }
  const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
  const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
  const readSchema = (name) => readFileSync(new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
  const { binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  const repo = new D1Repository(binding);
  await repo.auditOnly("t-a", { ts: iso(NOW), actor: "n", action: "record.read", patientRefHash: "ref", scope: { resourceType: "Observation", id: "o1" }, outcome: "ok" });
  await repo.auditOnly("t-b", { ts: iso(NOW), actor: "m", action: "record.read", outcome: "ok" });
  const a = (await repo.auditTrail("t-a", {})).events[0].id, b = (await repo.auditTrail("t-b", {})).events[0].id;
  const rows = await repo.auditRowsById("t-a", [a, b, "nope"]);
  assert.equal(rows.length, 1, "another hospital's row is not returned");
  assert.equal(rows[0].id, a);
  assert.equal(rows[0].chainSeq, 1);
  assert.equal(rows[0].scope.id, "o1");
});

test("G11 screen: ward columns and sign-ins on a flag, a button to open its rows; loading, failed and not-found read differently", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const emptyOk = { status: "ok", findings: [], counts: {} };
  const page = win.WSQ._securityReviewHtml(c, { days: 7, note: "n", counts: {}, notDetected: [], chartAccess: emptyOk, exports: emptyOk, logins: emptyOk,
    reviewQueue: { status: "ok", items: [], awaiting: 0, missing: [] }, dataProtection: { status: "red", reasons: [] }, auditRetention: { status: "ok" },
    assignmentAccess: { status: "ok", readsInPeriod: 2, assignedReads: 0, incomplete: [], matching: ["1 Google sign-in account could not be matched to an email, so it counts as a separate reader."], exemptions: [],
      findings: [{ type: "out-of-assignment", actor: "n1", signIns: ["fb:u9"], summary: "1 read.", method: "m", evidence: [{ id: "aud-5", ts: "t", action: "record.read", wardAtRead: "Ward B", readerWardsAtRead: ["Ward A"] }], evidenceTotal: 1 }],
      notEvaluated: [{ actor: "x", reason: "No data.", reads: 1, evidence: [{ id: "aud-6" }] }], exempt: [] } });
  assert.match(page, /Patient's ward then/);
  assert.match(page, /Ward B/);
  assert.match(page, /Reader rostered on then/);
  assert.ok(!page.includes("fb:u9"), "LT-35: a sign-in is the staff member, never the account id"); assert.match(page, /these sign-ins: Staff account, name not set/);
  assert.match(page, /data-sec-rows="aud-5"/);
  assert.match(page, /data-sec-rows="aud-6"/);
  assert.match(page, /could not be matched to an email/);
  const rows = win.WSQ._auditRowsHtml;
  assert.match(rows(c, null), /Reading the audit rows/);
  const failed = rows(c, { failed: true, message: "Forbidden" });
  assert.match(failed, /could not be loaded: Forbidden/);
  assert.match(failed, /not the same as there being none/);
  const part = rows(c, { rows: [{ id: "aud-5", ts: "t", action: "record.read", chainSeq: 7 }, { id: "aud-8", ts: "t", chainSeq: null }], missing: ["aud-6"] });
  assert.match(part, /1 of the audit rows named were not found/);
  assert.match(part, /aud-6/);
  assert.match(part, />7</);
  assert.match(part, /Not linked/);
  assert.ok(!/[—–]/.test(page + failed + part), "no em or en dash on screen");
});
