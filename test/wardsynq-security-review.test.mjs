/* test/wardsynq-security-review.test.mjs - P2.17 security review and P2.15 restore visibility.
 * Pure rules first, then the REAL routes (same seeding style as wardsynq-emergency-mode-bridge),
 * then the Admin screen's loading/failed/unavailable/empty states.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-security-review.test.mjs
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
// PURE RULES
// ---------------------------------------------------------------------------------------------
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const H = 3600000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const PERIOD = { from: iso(NOW - 7 * D), to: iso(NOW) };
const read = (actor, ms, patient, extra) => ({ id: `r-${actor}-${ms}-${patient}`, ts: iso(ms), actor, action: "record.read", patientRefHash: patient, scope: { resourceType: "Observation" }, outcome: "ok", ...(extra || {}) });

test("chart access: many distinct patients against the user's OWN baseline, with the rows behind it", () => {
  const ev = [];
  // 10 baseline days, ~5 patients a day at 09:00-10:00 UTC.
  for (let d = 10; d < 20; d++) for (let p = 0; p < 5; p++) ev.push(read("nurse", NOW - d * D + 9 * H + p * 60000, `p${p}`));
  // In period: 40 distinct patients in one day, same hours.
  for (let p = 0; p < 40; p++) ev.push(read("nurse", NOW - 2 * D + 9 * H + p * 1000, `q${p}`));
  // A colleague with the same baseline and a normal day: no finding.
  for (let d = 10; d < 20; d++) for (let p = 0; p < 5; p++) ev.push(read("doc", NOW - d * D + 9 * H + p * 60000, `p${p}`));
  for (let p = 0; p < 6; p++) ev.push(read("doc", NOW - 2 * D + 9 * H + p * 1000, `p${p}`));

  const f = SR.chartAccessFindings(ev, PERIOD);
  const vol = f.filter((x) => x.type === "chart-access-volume");
  assert.equal(vol.length, 1, JSON.stringify(f.map((x) => x.summary)));
  assert.equal(vol[0].actor, "nurse");
  assert.equal(vol[0].distinctPatients, 40);
  assert.equal(vol[0].baselineMedian, 5);
  assert.equal(vol[0].evidence.length, 40);
  assert.equal(vol[0].evidenceTotal, 40);
  assert.ok(vol[0].evidence.every((e) => e.id && e.patientRef), "each evidence row names the audit row");
  assert.match(vol[0].method, /median/);
  assert.ok(!f.some((x) => x.type === "chart-access-off-hours"), "same hours as usual is not off-hours");
});

test("chart access: 3x the median but fewer than 20 extra patients is NOT flagged; no baseline needs 50", () => {
  const ev = [];
  for (let d = 10; d < 20; d++) for (let p = 0; p < 2; p++) ev.push(read("a", NOW - d * D + 9 * H, `p${p}`));
  for (let p = 0; p < 15; p++) ev.push(read("a", NOW - D + 9 * H, `x${p}`));
  assert.equal(SR.chartAccessFindings(ev, PERIOD).length, 0);

  const fresh = [];
  for (let p = 0; p < 49; p++) fresh.push(read("new", NOW - D, `y${p}`));
  assert.equal(SR.chartAccessFindings(fresh, PERIOD).length, 0);
  fresh.push(read("new", NOW - D, "y49"));
  const f = SR.chartAccessFindings(fresh, PERIOD);
  assert.equal(f.length, 1);
  assert.equal(f[0].baselineMedian, null);
});

test("chart access: off-hours and repeated denials", () => {
  const ev = [];
  for (let d = 10; d < 20; d++) for (let p = 0; p < 3; p++) ev.push(read("a", NOW - d * D + 10 * H, `p${p}`));
  ev.push(read("a", NOW - D - 9 * H, "p1"));                          // 03:00 UTC, never seen before
  for (let i = 0; i < 5; i++) ev.push({ id: "d" + i, ts: iso(NOW - D + i), actor: "b", action: "record.denied", outcome: "denied", scope: { resourceType: "MedicationOrder" } });
  for (let i = 0; i < 4; i++) ev.push({ id: "e" + i, ts: iso(NOW - D + i), actor: "c", action: "record.denied", outcome: "denied" });
  const f = SR.chartAccessFindings(ev, PERIOD);
  const off = f.find((x) => x.type === "chart-access-off-hours");
  assert.ok(off, JSON.stringify(f));
  assert.deepEqual(off.hoursUtc, [3]);
  const den = f.filter((x) => x.type === "repeated-denied");
  assert.equal(den.length, 1);
  assert.equal(den[0].actor, "b");
});

test("exports: volume against the person's own history, per channel, with a floor", () => {
  const ev = [];
  // Baseline: admin takes a 100-row backup page every day.
  for (let d = 8; d < 36; d++) ev.push({ id: "b" + d, ts: iso(NOW - d * D), actor: "admin", action: "record.export", resourceCounts: { records: 100 } });
  // Period: the same habit (not flagged) ...
  for (let d = 1; d < 8; d++) ev.push({ id: "p" + d, ts: iso(NOW - d * D), actor: "admin", action: "record.export", resourceCounts: { records: 100 } });
  // ... and a clerk with no history printing 12 patient copies, and an old-format export row.
  for (let i = 0; i < 12; i++) ev.push({ id: "c" + i, ts: iso(NOW - D + i), actor: "clerk", action: "record.write", scope: { resourceType: "PatientRecordRelease" } });
  ev.push({ id: "old", ts: iso(NOW - D), actorId: "legacy", action: "record.export", detail: "backup export page: 600 rows, seq 1..600" });
  const f = SR.exportFindings(ev, PERIOD);
  assert.deepEqual(f.map((x) => x.actor + ":" + x.channel).sort(), ["clerk:release", "legacy:backup"]);
  assert.equal(f.find((x) => x.actor === "clerk").evidenceTotal, 12);
  assert.equal(SR.exportChannel({ action: "record.read" }), null);
});

test("sign-ins: failed attempts, a new device, many devices in an hour", () => {
  const ev = [];
  const e = (id, ms, actor, action, meta) => ev.push({ id, ts: ms, actor, action, meta });
  for (let i = 0; i < 5; i++) e("f" + i, NOW - D + i, "nurse1", "login:pin_failed", "attempt " + (i + 1) + " · iPhone Safari");
  e("o1", NOW - 20 * D, "doc1", "login:pin_ok", "Mac Chrome");
  e("o2", NOW - 2 * D, "doc1", "login:pin_ok", "Mac Chrome");
  e("o3", NOW - D, "doc1", "login:pin_ok", "Android Chrome");           // new
  e("o4", NOW - D + 10 * 60000, "doc1", "login:pin_ok", "Windows Edge"); // new, 3 devices within 60 minutes of o2? no: o2 is a day earlier
  e("o5", NOW - D + 20 * 60000, "doc1", "login:pin_ok", "Mac Chrome");
  e("first", NOW - D, "newbie", "login:pin_ok", "iPhone Safari");       // first ever sign-in is not "new device"
  const f = SR.loginFindings(ev, PERIOD);
  assert.equal(f.filter((x) => x.type === "failed-sign-ins").length, 1);
  const nd = f.find((x) => x.type === "new-device");
  assert.equal(nd.actor, "doc1");
  assert.equal(nd.evidenceTotal, 2);
  assert.ok(!f.some((x) => x.actor === "newbie"));
  const many = f.find((x) => x.type === "many-devices");
  assert.ok(many, JSON.stringify(f.map((x) => x.type)));
  assert.equal(many.devices.length, 3);
  assert.equal(SR.deviceOf({ action: "login:pin_failed", meta: "attempt 2" }), "", "a failure with no device recorded has no device");
});

test("review queue: decisions attach, awaiting first, and nobody reviews their own action", () => {
  const items = SR.reviewItems(
    [{ id: "bg-1", actorId: "doc", reason: "arrest in corridor", grantedAt: iso(NOW - D), patientId: "p1" }],
    [{ id: "ev1", ts: NOW - D, actor: "admin", action: "member:set", meta: "nurse1:doctor" }, { id: "ev2", ts: NOW - D, actor: "admin", action: "login:pin_ok" }],
    PERIOD);
  assert.deepEqual(items.map((i) => i.kind), ["break-glass", "privileged-action"], "sign-ins are not privileged actions");
  const q = SR.reviewQueue(items, [{ subjectKind: "break-glass", subjectId: "bg-1", decision: "appropriate", reviewedBy: "admin", at: iso(NOW) }], ["admin"]);
  assert.equal(q[0].status, "awaiting");
  assert.equal(q[0].ownAction, true);
  assert.equal(q[1].status, "appropriate");

  assert.equal(SR.reviewProblem(items[1], "appropriate", "", ["admin"]).error, "self_review");
  assert.equal(SR.reviewProblem(items[0], "follow-up", "", ["admin"]).error, "note_required");
  assert.equal(SR.reviewProblem(items[0], "ok", "", ["admin"]).error, "decision_invalid");
  assert.equal(SR.reviewProblem(null, "appropriate", "", ["admin"]).error, "subject_not_found");
  assert.equal(SR.reviewProblem(items[0], "follow-up", "Ask why no consultant was called", ["admin"]), null);
});

test("NO FALSE GREEN: data protection is green only with a backup inside its objective AND a successful restore test", () => {
  const now = iso(NOW);
  const run = { at: iso(NOW - 30 * 60000), throughSeq: 9, rows: 9, location: "s3://x" };
  const ok = { at: iso(NOW - D), restoredWhat: "last night's backup into staging", outcome: "success", performedBy: "ops" };
  assert.equal(SR.dataProtection([], [], 60, now).status, "red");
  assert.equal(SR.dataProtection([run], [], 60, now).status, "red");
  assert.match(SR.dataProtection([run], [], 60, now).reasons.join(" "), /No restore test has ever been recorded/);
  assert.equal(SR.dataProtection([], [ok], 60, now).status, "red");
  assert.equal(SR.dataProtection([run], [ok], null, now).status, "amber", "no objective configured is not green");
  assert.equal(SR.dataProtection([run], [{ ...ok, outcome: "partial" }], 60, now).status, "amber");
  assert.equal(SR.dataProtection([run], [{ ...ok, outcome: "failed" }], 60, now).status, "red");
  const green = SR.dataProtection([run], [ok], 60, now);
  assert.equal(green.status, "green");
  assert.deepEqual(green.reasons, []);
});

test("audit retention: an absent span is said, not implied", () => {
  assert.equal(SR.auditRetention("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").gap, null);
  assert.match(SR.auditRetention("2026-03-01T00:00:00Z", "2026-01-01T00:00:00Z").gap, /absent/);
  assert.match(SR.auditRetention(null, "2026-01-01T00:00:00Z").gap, /no audit rows were found/);
  assert.equal(SR.auditRetention(null, null).configuredRetention, null);
});

// ---------------------------------------------------------------------------------------------
// REAL ROUTES
// ---------------------------------------------------------------------------------------------
const ORG_ID = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", ADMIN2 = "admin2@example.test", DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", HR = "hr@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [ADMIN2, "admin"], [DOCTOR, "doctor"], [NURSE, "nurse"], [HR, "hr"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("NEGATIVE: doctor and nurse get 403 on every security route; nothing is written", async () => {
  seedHospital();
  for (const who of [DOCTOR, NURSE]) {
    const r1 = await as(who, `/ward/security-report?orgId=${ORG_ID}`);
    assert.equal(r1.__status, 403, who + " " + JSON.stringify(r1));
    const r2 = await as(who, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "break-glass", subjectId: "x", decision: "appropriate" });
    assert.equal(r2.__status, 403);
    const r3 = await as(who, "/ward/restore-test", "POST", { orgId: ORG_ID, restoredWhat: "whole backup into staging", outcome: "success" });
    assert.equal(r3.__status, 403);
  }
  assert.equal((await RECORD.latestByType(TENANT_ROW.id, "RestoreTest", 10)).length, 0);
});

test("report -> self-review refused -> another admin reviews -> restore test -> still not green without a backup", async () => {
  seedHospital();
  const now = Date.now();
  // The hospital's event log: 6 failed PINs for one nurse, one role change by ADMIN, one reset by HR.
  for (let i = 0; i < 6; i++) docs.set(`q_events/f${i}`, { fields: { ts: now - H + i, hospitalId: ORG_ID, ticketId: "", actor: "nurse1", action: "login:pin_failed", meta: "attempt " + (i + 1) + " · iPhone Safari" }, updateTime: "t1" });
  docs.set("q_events/role1", { fields: { ts: now - H, hospitalId: ORG_ID, ticketId: "", actor: idFor(ADMIN), action: "member:set", meta: "nurse1:doctor" }, updateTime: "t1" });
  // Audit rows: a user reading 60 distinct patients today with no baseline.
  for (let p = 0; p < 60; p++) await RECORD.auditOnly(TENANT_ROW.id, { ts: new Date(now - H + p).toISOString(), actor: "cfa:snoop", action: "record.read", patientRefHash: "ref-" + p, scope: { resourceType: "Patient" }, outcome: "ok" });

  // A doctor declares break-glass, so there is a grant to review.
  const bg = await as(DOCTOR, "/ward/break-glass", "POST", { orgId: ORG_ID, patientId: "pat-1", reason: "Collapsed in the corridor, unknown medications, needs the chart now." });
  assert.equal(bg.__status, 200, JSON.stringify(bg));

  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}&days=7`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  assert.equal(rep.advisory, true);
  assert.equal(rep.chartAccess.status, "ok");
  assert.equal(rep.counts["chart-access-volume"], 1);
  assert.equal(rep.counts["failed-sign-ins"], 1);
  assert.equal(rep.logins.findings[0].evidence[0].id.startsWith("f"), true, "sign-in evidence names the event rows");
  assert.equal(rep.dataProtection.status, "red");
  assert.match(rep.dataProtection.reasons.join(" "), /No backup run has ever been recorded/);
  assert.match(rep.dataProtection.reasons.join(" "), /No restore test has ever been recorded/);
  assert.equal(rep.auditRetention.status, "ok");
  assert.ok(rep.auditRetention.oldestAuditAt);
  assert.equal(rep.notDetected.length, 2, "reads outside an assignment are now checked, not listed as undetected");
  assert.equal(rep.assignmentAccess.status, "not_evaluated", "no assignments recorded is not evaluated, never clean");
  assert.equal(rep.assignmentAccess.findings, undefined);
  const kinds = rep.reviewQueue.items.map((i) => i.kind + ":" + i.status).sort();
  assert.deepEqual(kinds, ["break-glass:awaiting", "privileged-action:awaiting"]);
  assert.equal(rep.reviewQueue.items.find((i) => i.kind === "privileged-action").ownAction, true);
  assert.ok(RECORD.audit.some((a) => a.action === "security.report" && a.actor === idFor(ADMIN)), "reading the report is itself audited");

  // Self-review refused, on the server's own record of who acted.
  const self = await as(ADMIN, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "privileged-action", subjectId: "role1", decision: "appropriate" });
  assert.equal(self.__status, 403, JSON.stringify(self));
  assert.equal(self.error, "self_review");
  const missing = await as(ADMIN, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "privileged-action", subjectId: "nope", decision: "appropriate" });
  assert.equal(missing.__status, 404);
  const noNote = await as(ADMIN2, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "break-glass", subjectId: bg.grantId, decision: "follow-up" });
  assert.equal(noNote.__status, 422);

  const okRev = await as(ADMIN2, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "privileged-action", subjectId: "role1", decision: "appropriate" });
  assert.equal(okRev.__status, 200, JSON.stringify(okRev));
  const bgRev = await as(ADMIN, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "break-glass", subjectId: bg.grantId, decision: "follow-up", note: "Check whether the consultant was paged." });
  assert.equal(bgRev.__status, 200, JSON.stringify(bgRev));

  /* HR holds staff.admin but deliberately has NO clinical actor (wardsynq-rbac-4-13 pins that), so
   * the route admits it and the record store refuses it. That refusal must be a clean 403, not a
   * crash and not a silent success. */
  docs.set("q_events/reset1", { fields: { ts: now - H, hospitalId: ORG_ID, ticketId: "", actor: idFor(HR), action: "member:reset_access", meta: "nurse1" }, updateTime: "t1" });
  const hrRev = await as(HR, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "privileged-action", subjectId: "role1", decision: "follow-up", note: "Confirm the promotion was requested in writing." });
  assert.equal(hrRev.__status, 403, JSON.stringify(hrRev));
  const hrRep = await as(HR, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(hrRep.__status, 403, JSON.stringify(hrRep));
  const selfRev = await as(ADMIN2, "/ward/security-review", "POST", { orgId: ORG_ID, subjectKind: "privileged-action", subjectId: "reset1", decision: "follow-up", note: "Confirm the reset was requested by the nurse." });
  assert.equal(selfRev.__status, 200, JSON.stringify(selfRev));

  const badRt = await as(ADMIN, "/ward/restore-test", "POST", { orgId: ORG_ID, restoredWhat: "x", outcome: "success" });
  assert.equal(badRt.__status, 422);
  const rt = await as(ADMIN, "/ward/restore-test", "POST", { orgId: ORG_ID, restoredWhat: "12 Sep backup into a staging database", outcome: "success", performedBy: "IT on-call" });
  assert.equal(rt.__status, 200, JSON.stringify(rt));

  const rep2 = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  const role1 = rep2.reviewQueue.items.find((i) => i.subjectId === "role1");
  assert.equal(role1.reviews.length, 1);
  assert.equal(role1.status, "appropriate");
  assert.equal(rep2.reviewQueue.items.find((i) => i.subjectId === "reset1").status, "follow-up");
  assert.equal(rep2.reviewQueue.items.find((i) => i.kind === "break-glass").status, "follow-up");
  assert.equal(rep2.dataProtection.lastRestoreTest.performedBy, "IT on-call");
  assert.equal(rep2.dataProtection.status, "red", "a restore test without a recorded backup is not green");

  // Operational health carries the same data-protection verdict (P2.15).
  const health = await as(ADMIN, `/ward/operational-health?orgId=${ORG_ID}`);
  assert.equal(health.__status, 200, JSON.stringify(health));
  assert.equal(health.health.dataProtection.status, "red");
  assert.ok(health.health.dataProtection.lastRestoreTest);
});

test("a storage port that cannot read the audit trail reports UNAVAILABLE, never an empty clean list", async () => {
  seedHospital();
  RECORD.auditTrail = undefined;
  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  assert.equal(rep.chartAccess.status, "unavailable");
  assert.equal(rep.exports.status, "unavailable");
  assert.equal(rep.auditRetention.status, "unavailable");
  assert.equal(rep.chartAccess.findings, undefined);
});

// ---------------------------------------------------------------------------------------------
// ADMIN SCREEN
// ---------------------------------------------------------------------------------------------
test("screen: loading, failed, unavailable and empty read differently; own actions have no review button", () => {
  const win = { addEventListener() {} };
  const els = {};
  const doc = { readyState: "complete", getElementById: (id) => (els[id] = els[id] || { innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const html = win.WSQ._securityReviewHtml;
  const c = { esc: win.WSQ.esc };

  const loading = html(c, null);
  const failed = html(c, { failed: true, message: "forbidden" });
  assert.match(loading, /Loading/);
  assert.match(failed, /could not be loaded: forbidden/);
  assert.match(failed, /not the same as there being nothing/);
  assert.notEqual(loading, failed);

  const emptyOk = { status: "ok", findings: [], counts: {} };
  const base = { days: 7, note: "Findings are advisory.", counts: {}, notDetected: [], exports: emptyOk, logins: emptyOk,
    reviewQueue: { status: "ok", items: [], awaiting: 0, missing: [] },
    dataProtection: { status: "red", reasons: ["No restore test has ever been recorded."], lastBackup: null, lastRestoreTest: null },
    auditRetention: { status: "ok", configuredNote: "No audit retention period is configured.", oldestAuditAt: null, oldestRecordAt: "2026-01-01", gap: "Audit rows for the earlier span are absent." } };
  const empty = html(c, { ...base, chartAccess: emptyOk });
  assert.match(empty, /No findings in the last 7 days/);
  assert.match(empty, /No break-glass grants or admin actions to review/);
  assert.match(empty, /Not protected/);
  assert.ok(!/Protected: recent backup/.test(empty), "red never renders the green sentence");
  assert.match(empty, /never recorded/);
  assert.match(empty, /absent/);

  const unavailable = html(c, { ...base, chartAccess: { status: "unavailable", detail: "storage cannot read the audit trail" } });
  assert.match(unavailable, /Could not be checked: storage cannot read the audit trail/);

  const withQueue = html(c, { ...base, chartAccess: emptyOk, reviewQueue: { status: "ok", awaiting: 2, missing: [], items: [
    { kind: "privileged-action", subjectId: "e1", actor: "me", action: "member:set", at: "t", detail: "x", status: "awaiting", reviews: [], ownAction: true },
    { kind: "break-glass", subjectId: "g1", actor: "doc", action: "break-glass", at: "t", detail: "arrest", status: "awaiting", reviews: [], ownAction: false },
  ] } });
  assert.match(withQueue, /Your own action: another administrator must review it/);
  assert.equal((withQueue.match(/data-sec-review="/g) || []).length, 2, "two buttons for the one reviewable item only");
  assert.ok(!/[—–]/.test(loading + failed + empty + unavailable + withQueue), "no em or en dash on screen");
});
