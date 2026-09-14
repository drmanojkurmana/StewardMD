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
