/* test/wardsynq-compliance.test.mjs - NABH indicators, the HMIS monthly return, the DHS self-assessment and the report
 * builder: the pure calculations, and the routes through the real /api/queue handler with their authorization.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-compliance.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
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
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
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
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async () => ({}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});


const { onRequest } = await import("../functions/api/queue/[[path]].js");
const C = await import("../functions/_wardsynq/compliance.js");
const RB = await import("../functions/_wardsynq/report-builder.js");
const { NABH_KPIS } = await import("../functions/_wardsynq/nabh-kpi-defs.js");
const { HMIS_ITEMS } = await import("../functions/_wardsynq/hmis-items.js");
const { DHS_ELEMENTS } = await import("../functions/_wardsynq/dhs-elements.js");

const ORG = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const OWNER = "owner@example.test", ADMIN2 = "admin2@example.test", NURSE = "nurse@example.test", HR = "hr@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
const T = TENANT_ROW.id;
let seq = 0;
const seed = (rec) => RECORD.append(T, [{ version: 1, meta: { recordedAt: new Date().toISOString(), effectiveAt: new Date().toISOString(), source: { system: "wardsynq-native", sourceId: null } }, ...rec }], { idempotencyKey: "seed-" + (++seq) });
function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  const org = (id) => ({ fields: { id, code: "SMD-" + id, name: "Hospital " + id, kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(OWNER), createdAt: 1, wardsynq: { utcOffsetMinutes: 330 } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG}`, org(ORG));
  docs.set(`q_orgs/${OTHER}`, { ...org(OTHER), fields: { ...org(OTHER).fields, ownerUid: "someone-else" } });
  for (const [email, role] of [[ADMIN2, "admin"], [NURSE, "nurse"], [HR, "hr"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  const type = res.headers.get("Content-Type") || "";
  if (type.startsWith("text/csv")) return { __status: res.status, __csv: await res.text(), __type: type };
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const count = async (type) => (await RECORD.latestByType(T, type, 100)).length;
const W = C.monthWindows(Date.parse("2026-09-20T00:00:00Z"), 1, 330)[0];
const at = (day, hh) => new Date(Date.UTC(2026, 8, day, hh || 6) - 330 * 60000).toISOString(); // local time hh:00 on 2026-09-day

test("data: 32 NABH indicators, 182 DHS elements with unique codes, HMIS items with unique codes", () => {
  assert.equal(NABH_KPIS.length, 32);
  assert.deepEqual(NABH_KPIS.map((k) => k.no), Array.from({ length: 32 }, (_, i) => i + 1));
  assert.equal(DHS_ELEMENTS.length, 182);
  assert.equal(new Set(DHS_ELEMENTS.map((e) => e.code)).size, 182);
  assert.equal(new Set(HMIS_ITEMS.map((i) => i.code)).size, HMIS_ITEMS.length);
  for (const code of Object.keys(C.HMIS_FILL)) assert.ok(HMIS_ITEMS.some((i) => i.code === code), code);
});

test("monthWindows: calendar months in hospital local time", () => {
  assert.equal(W.month, "2026-09");
  assert.equal(new Date(W.fromMs).toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(new Date(W.toMs + 1).toISOString(), "2026-09-30T18:30:00.000Z");
});

test("NABH: every indicator is either computed per month or not computable naming the missing data", () => {
  const rows = {
    SurgicalCase: [{ id: "s1", incisionAt: at(3), signIn: {}, timeOut: {}, signOut: {} }, { id: "s2", incisionAt: at(4), signIn: {}, timeOut: {} }],
    IncidentReport: [{ id: "i1", reportedAt: at(2), severity: "near-miss" }, { id: "i2", reportedAt: at(5), severity: "minor" }],
    Encounter: [
      { id: "icu1", patientId: "p1", class: "ICU", status: "finished", periodStart: at(1), periodEnd: at(3) },
      { id: "icu2", patientId: "p1", class: "ICU", status: "finished", periodStart: at(4), periodEnd: at(6) },
    ],
    TransfusionEpisode: [{ id: "t1", startedAt: at(2), reaction: { at: at(2) }, ledger: [{ event: "requested", at: at(2, 6) }, { event: "issued", at: new Date(Date.parse(at(2, 6)) + 45 * 60000).toISOString() }] }],
  };
  const out = C.computeNabhIndicators({ rows, unreadable: {}, windows: [W] });
  assert.equal(out.length, 32);
  const by = Object.fromEntries(out.map((i) => [i.no, i]));
  for (const i of out) if (!i.computable) assert.match(i.reason, /^Not computable from WardSynQ data\. Missing: /, String(i.no));
  assert.deepEqual([by[7].months[0].numerator, by[7].months[0].denominator, by[7].months[0].value], [1, 2, 50]);
  assert.equal(by[29].months[0].value, 50);
  assert.equal(by[10].months[0].numerator, 1, "icu1 ended on the 3rd and icu2 started within 48 hours");
  assert.equal(by[8].months[0].value, 100);
  assert.equal(by[20].months[0].value, 45);
  assert.equal(by[28].months[0].value, 0, "falls: a real zero over the ICU bed-days");
  assert.ok(by[28].months[0].denominator > 0);
  assert.equal(C.computeNabhIndicators({ rows: {}, unreadable: {}, windows: [W] }).find((i) => i.no === 28).months[0].value, null, "no bed-days: no rate rather than zero");
  assert.equal(by[9].computable, false);
  const blocked = C.computeNabhIndicators({ rows: {}, unreadable: { SurgicalCase: "not readable with this role" }, windows: [W] });
  assert.equal(blocked.find((i) => i.no === 7).computable, false);
  assert.match(blocked.find((i) => i.no === 7).reason, /could not be read/);
});

test("CSV: the format note leads, and a formula-looking cell is defused", () => {
  assert.equal(C.csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(C.csvCell("-3"), "-3");
  assert.equal(C.csvCell('a,"b"'), '"a,""b"""');
  const csv = C.nabhCsv({ months: ["2026-09"], formatNote: C.NABH_FORMAT_NOTE, indicators: C.computeNabhIndicators({ rows: {}, unreadable: {}, windows: [W] }) });
  assert.match(csv.split("\r\n")[0], /NABH publishes no monthly submission format/);
  assert.equal(csv.trim().split("\r\n").length, 34);
});

test("HMIS: supported items are counted with their bands; everything else is marked not available", () => {
  const rows = {
    DeliveryRecord: [{ id: "d1", deliveredAt: at(3, 23), mode: "Normal vaginal" }, { id: "d2", deliveredAt: at(4, 10), mode: "Emergency LSCS" }, { id: "d3", deliveredAt: at(5, 2), mode: "Caesarean section" }],
    Patient: [{ id: "p1", sex: "male", dob: "2015-01-01" }, { id: "p2", sex: "female", dob: "1950-01-01" }, { id: "p3", dob: "1990-01-01" }],
    Encounter: [
      { id: "e1", patientId: "p1", class: "IPD", status: "finished", periodStart: at(2), periodEnd: at(5), disposition: "LAMA" },
      { id: "e2", patientId: "p2", class: "IPD", status: "finished", periodStart: at(6), periodEnd: at(9), disposition: "Died" },
      { id: "e3", patientId: "p3", class: "IPD", status: "in-progress", periodStart: at(7) },
      { id: "e4", patientId: "p2", class: "ICU", status: "finished", periodStart: at(7), periodEnd: at(8) },
      { id: "o1", patientId: "p3", class: "OPD", status: "finished", periodStart: at(1) },
      { id: "o2", patientId: "p3", class: "VIRTUAL", status: "finished", periodStart: at(1) },
    ],
    Immunization: [], DiagnosticReport: [{ id: "r1", category: "imaging", status: "final", reportedAt: at(3), display: "CT head" }, { id: "r2", category: "laboratory", status: "final", reportedAt: at(3), display: "Sodium" }],
  };
  const items = Object.fromEntries(C.computeHmis({ rows, unreadable: {}, window: W }).map((i) => [i.code, i]));
  assert.equal(items["2.2."].value, 3);
  assert.equal(items["2.2.2"].value, 1, "one vaginal delivery at night");
  assert.equal(items["3.1."].value, 2);
  assert.equal(items["3.1.1."].value, 1);
  assert.equal(items["14.2.1."].value, 1, "virtual visits are not outpatient attendance");
  assert.equal(items["14.3.1."].available, null, "a heading row in the format carries no value");
  assert.equal(items["14.3.1.a"].value, 1, "the boy");
  assert.equal(items["14.3.1.e"].value, 1, "the woman over 60 once: her ICU stay inside that admission is not a second admission");
  assert.equal(items["14.3.1.d"].value, 0, "the patient with no recorded sex is in no band");
  assert.equal(items["14.3.2.a"].value + items["14.3.2.e"].value, 2);
  assert.equal(items["14.3.4.e"].value, 1);
  assert.equal(items["14.3.7.a"].value, 1);
  assert.equal(items["15.1.1."].value, 1);
  assert.equal(items["15.6.1.c.i"].value, 1);
  assert.equal(items["14.8.1.a"].available, false);
  assert.match(items["14.8.1.a"].reason, /Not available from WardSynQ data/);
  const blocked = Object.fromEntries(C.computeHmis({ rows: {}, unreadable: { DeliveryRecord: "read failed" }, window: W }).map((i) => [i.code, i]));
  assert.equal(blocked["2.2."].available, false);
});

test("report builder: only named columns, patient columns need emr.view, grouping and sums", () => {
  assert.equal(RB.validateSpec({ dataset: "encounters", columns: ["status", "name"] }).error, "unknown_column");
  assert.equal(RB.validateSpec({ dataset: "sql", columns: ["x"] }).error, "unknown_dataset");
  assert.deepEqual(RB.validateSpec({ dataset: "invoices", columns: ["currency"] }).needs, ["billing.view"]);
  assert.deepEqual(RB.validateSpec({ dataset: "invoices", columns: ["currency"], filters: [{ column: "patientId", op: "eq", value: "p1" }] }).needs, ["billing.view", "emr.view"]);
  const v = RB.validateSpec({ dataset: "encounters", columns: [], groupBy: "class", aggregate: { fn: "sum", column: "lengthOfStayDays" } });
  const r = RB.runSpec(v.dataset, v.spec, [
    { class: "IPD", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-03T00:00:00Z" },
    { class: "IPD", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-02T00:00:00Z" },
    { class: "OPD", periodStart: "2026-09-01T00:00:00Z" },
  ]);
  assert.deepEqual(r.rows, [["IPD", 3], ["OPD", 0]]);
});

test("no session: 401 on /ward/nabh-indicators, /ward/hmis-monthly, /ward/dhs-checklist and /ward/report-run", async () => {
  seedHospital();
  for (const p of ["/ward/nabh-indicators?orgId=" + ORG, "/ward/hmis-monthly?orgId=" + ORG, "/ward/dhs-checklist?orgId=" + ORG]) assert.equal((await as(null, p)).__status, 401, p);
  assert.equal((await as(null, "/ward/report-run", "POST", { orgId: ORG, spec: { dataset: "encounters", columns: ["class"] } })).__status, 401);
});

test("wrong role: a nurse is refused every return and the builder; hr cannot pull a dataset it has no capability for; nothing written", async () => {
  seedHospital();
  for (const p of ["/ward/nabh-indicators?orgId=" + ORG, "/ward/hmis-monthly?orgId=" + ORG, "/ward/dhs-checklist?orgId=" + ORG, "/ward/reports-saved?orgId=" + ORG, "/ward/report-csv?orgId=" + ORG + "&reportId=x"]) {
    assert.equal((await as(NURSE, p)).__status, 403, p);
  }
  assert.equal((await as(NURSE, "/ward/dhs-checklist-save", "POST", { orgId: ORG, entries: [{ code: "AAC.1.a", status: "met", evidence: "x" }], expectedVersion: 0 })).__status, 403);
  assert.equal((await as(NURSE, "/ward/report-save", "POST", { orgId: ORG, name: "Mine", spec: { dataset: "encounters", columns: ["class"] } })).__status, 403);
  const hrRun = await as(HR, "/ward/report-run", "POST", { orgId: ORG, spec: { dataset: "incidents", columns: ["category"] } });
  assert.equal(hrRun.__status, 403, JSON.stringify(hrRun));
  assert.equal(hrRun.cap, "incident.investigate");
  const hrPii = await as(HR, "/ward/report-save", "POST", { orgId: ORG, name: "Patients", spec: { dataset: "encounters", columns: ["patientId"] } });
  assert.equal(hrPii.__status, 403);
  assert.equal(await count("DhsAssessment"), 0);
  assert.equal(await count("SavedReport"), 0);
});

test("another hospital: an administrator of one hospital is refused in another", async () => {
  seedHospital();
  for (const p of ["/ward/nabh-indicators?orgId=" + OTHER, "/ward/dhs-checklist?orgId=" + OTHER]) {
    const r = await as(ADMIN2, p);
    assert.ok(r.__status === 403 || r.__status === 404, p + " " + r.__status);
  }
  const s = await as(ADMIN2, "/ward/report-save", "POST", { orgId: OTHER, name: "X", spec: { dataset: "encounters", columns: ["class"] } });
  assert.ok(s.__status === 403 || s.__status === 404);
  assert.equal(await count("SavedReport"), 0);
});

test("positive: the returns compute, export CSV, the DHS self-assessment saves with a version check, reports save, share and export", async () => {
  seedHospital();
  await seed({ resourceType: "Encounter", id: "e1", patientId: "p1", class: "OPD", status: "finished", periodStart: new Date().toISOString() });
  await seed({ resourceType: "Encounter", id: "e2", patientId: "p2", class: "OPD", status: "finished", periodStart: new Date().toISOString() });

  const n = await as(OWNER, "/ward/nabh-indicators?orgId=" + ORG + "&months=3");
  assert.equal(n.__status, 200, JSON.stringify(n).slice(0, 300));
  assert.equal(n.indicators.length, 32);
  assert.equal(n.months.length, 3);
  const ncsv = await as(OWNER, "/ward/nabh-indicators?orgId=" + ORG + "&months=3&format=csv");
  assert.equal(ncsv.__status, 200);
  assert.match(ncsv.__type, /text\/csv/);

  const h = await as(OWNER, "/ward/hmis-monthly?orgId=" + ORG);
  assert.equal(h.__status, 200, JSON.stringify(h).slice(0, 300));
  assert.equal(h.items.find((i) => i.code === "14.2.1.").value, 2);
  assert.equal((await as(OWNER, "/ward/hmis-monthly?orgId=" + ORG + "&month=2026-13")).__status, 422);
  const hcsv = await as(OWNER, "/ward/hmis-monthly?orgId=" + ORG + "&format=csv");
  assert.match(hcsv.__csv, /14\.2\.1\.,Allopathic- Outpatient attendance,2,yes/);

  const d0 = await as(OWNER, "/ward/dhs-checklist?orgId=" + ORG);
  assert.equal(d0.__status, 200);
  assert.equal(d0.selfAssessment, true);
  assert.match(d0.note, /not an assessment by NABH/);
  assert.equal(d0.counts["not-assessed"], 182);
  assert.equal((await as(OWNER, "/ward/dhs-checklist-save", "POST", { orgId: ORG, entries: [{ code: "DIS.1.a", status: "met" }], expectedVersion: 0 })).error, "evidence_required");
  const d1 = await as(OWNER, "/ward/dhs-checklist-save", "POST", { orgId: ORG, entries: [{ code: "DIS.1.a", status: "met", evidence: "Record service audit trail" }], expectedVersion: 0 });
  assert.equal(d1.__status, 200, JSON.stringify(d1).slice(0, 300));
  assert.equal(d1.counts.met, 1);
  const stale = await as(ADMIN2, "/ward/dhs-checklist-save", "POST", { orgId: ORG, entries: [{ code: "DIS.1.b", status: "not-met" }], expectedVersion: 0 });
  assert.equal(stale.__status, 409, "a save from a stale copy is refused, not merged over");

  const spec = { dataset: "encounters", columns: [], groupBy: "class" };
  const run = await as(OWNER, "/ward/report-run", "POST", { orgId: ORG, spec });
  assert.equal(run.__status, 200, JSON.stringify(run));
  assert.deepEqual(run.rows, [["OPD", 2]]);
  const mine = await as(OWNER, "/ward/report-save", "POST", { orgId: ORG, name: "Visits by type", spec, shared: false });
  assert.equal(mine.__status, 200, JSON.stringify(mine));
  const shared = await as(OWNER, "/ward/report-save", "POST", { orgId: ORG, name: "Shared visits", spec, shared: true });
  assert.equal((await as(ADMIN2, "/ward/reports-saved?orgId=" + ORG)).reports.map((r) => r.name).join(), "Shared visits", "an unshared report stays its author's");
  assert.equal((await as(ADMIN2, "/ward/report-save", "POST", { orgId: ORG, reportId: shared.report.id, name: "Mine now", spec })).__status, 403, "only the author changes a report");
  const csv = await as(ADMIN2, "/ward/report-csv?orgId=" + ORG + "&reportId=" + encodeURIComponent(shared.report.id));
  assert.equal(csv.__status, 200);
  assert.equal(csv.__csv, "Type of visit,Count\r\nOPD,2\r\n");
  assert.equal((await as(ADMIN2, "/ward/report-csv?orgId=" + ORG + "&reportId=" + encodeURIComponent(mine.report.id))).__status, 404);
});
