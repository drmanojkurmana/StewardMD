/* test/wardsynq-trends.test.mjs — P2.10 hospital intelligence: trends with drill-down.
 *
 * Pure: bucketing in the hospital's clock (fixed offset and a DST zone), the 30-day readmission
 * definition, and an unreadable source being null (never 0). Through the real router:
 * GET /api/queue/ward/trends and GET /api/queue/ward/trend-events - no session 401, a role without
 * emr.view 403, another hospital 403, the finance gate (billing.view), and a nurse limited to another
 * department refused a ward's record ids while a doctor gets them. Screen: the Trends view's loading,
 * failed, gap and drill states.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-trends.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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
const TENANT = "tenant-wsq";
const TENANT_ROW = { id: TENANT, name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
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
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const T = await import("../functions/_wardsynq/trends.js");

const ORG = "org-wsq", ORG2 = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const OWNER = "owner@example.test", DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", CASHIER = "cashier@example.test", OTHER = "other@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1" };
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();
const dateOf = (t) => iso(t).slice(0, 10);
// Everything is placed relative to today (UTC midnight), so the fixture never ages out of the range.
const D0 = Math.floor(Date.now() / DAY) * DAY - 10 * DAY;

const member = (email, role, extra) => docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true, ...(extra || {}) }, updateTime: "t1" });
async function seed() {
  docs.clear(); clock = 1; RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT, ownerUid: idFor(OWNER), createdAt: 1, wardsynq: { utcOffsetMinutes: 0 } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "someone-else", createdAt: 1 }, updateTime: "t1" });
  member(DOCTOR, "doctor");
  member(CASHIER, "cashier");
  // A nurse whose access the hospital limited to Surgery.
  member(NURSE, "nurse", { scope: { departments: ["dept-surg"] } });
  docs.set(`q_members/${sanitize(ORG2)}__${sanitize(idFor(OTHER))}`, { fields: { orgId: ORG2, identity: idFor(OTHER), role: "doctor", active: true }, updateTime: "t1" });
  docs.set("q_departments/dept-med", { fields: { orgId: ORG, name: "Medicine" }, updateTime: "t1" });
  docs.set("q_departments/dept-surg", { fields: { orgId: ORG, name: "Surgery" }, updateTime: "t1" });
  docs.set("q_wards/w-med", { fields: { orgId: ORG, name: "Medical A", departmentId: "dept-med" }, updateTime: "t1" });
  docs.set("q_beds/b1", { fields: { orgId: ORG, wardId: "w-med", name: "1" }, updateTime: "t1" });
  docs.set("q_beds/b2", { fields: { orgId: ORG, wardId: "w-med", name: "2" }, updateTime: "t1" });
  const stay = (id, patientId, start, end) => ({ resourceType: "Encounter", id, version: 1, patientId, class: "IPD", status: end ? "finished" : "in-progress", periodStart: iso(start), periodEnd: end ? iso(end) : null, location: { ward: "Medical A", bed: "1" } });
  await RECORD.append(TENANT, [
    stay("enc-1", "pat-1", D0 + 2 * 3600000, D0 + 2 * DAY),
    stay("enc-2", "pat-2", D0 + 5 * 3600000, null),
    { resourceType: "Invoice", id: "inv-1", version: 1, patientId: "pat-1", encounterId: "enc-1", currency: "INR", lines: [], events: [{ type: "raised", at: iso(D0 + DAY) }] },
  ], {});
}
async function as(email, path) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: "GET", headers }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const range = `&from=${dateOf(D0)}&to=${dateOf(D0 + 3 * DAY)}&bucket=day`;

/* ---------------------------------------------------------------- pure */

test("bucketing: day edges follow the hospital's offset, a DST day is 23 hours, weeks start Monday, months on the 1st", () => {
  const ist = T.bucketsFor({ from: "2026-09-01", to: "2026-09-02", bucket: "day", utcOffsetMinutes: 330 });
  assert.equal(ist.buckets[0].startMs, Date.parse("2026-08-31T18:30:00Z"));
  const enc = (id, start) => ({ id, patientId: id, class: "IPD", status: "in-progress", periodStart: start, location: { ward: "A" } });
  const r = T.computeTrend({ metric: "admissions", buckets: ist.buckets, clock: ist.clock, nowMs: Date.parse("2026-09-05T00:00:00Z"),
    rows: { Encounter: [enc("e1", "2026-09-01T18:29:59Z"), enc("e2", "2026-09-01T18:30:00Z"), enc("e3", "2026-08-31T18:29:59Z")] } });
  assert.deepEqual(r.series[0].points.map((p) => [p.key, p.value]), [["2026-09-01", 1], ["2026-09-02", 1]], "18:29:59Z is still 1 Sep in IST; 18:30Z is 2 Sep; the day before is out of range");

  // A stay crossing bucket edges is split into the bed-days each bucket holds, and an open one runs to now.
  const days = T.bucketsFor({ from: "2026-09-01", to: "2026-09-04", bucket: "day", utcOffsetMinutes: 0 });
  const occ = T.computeTrend({ metric: "bed-occupancy", buckets: days.buckets, clock: days.clock, nowMs: Date.parse("2026-09-03T12:00:00Z"), bedsByWard: { A: 1 },
    rows: { Encounter: [{ id: "s1", patientId: "p", class: "IPD", status: "finished", periodStart: "2026-08-31T12:00:00Z", periodEnd: "2026-09-02T06:00:00Z", location: { ward: "A" } },
      { id: "s2", patientId: "q", class: "IPD", status: "in-progress", periodStart: "2026-09-02T18:00:00Z", location: { ward: "A" } }] } });
  assert.deepEqual(occ.series[0].points.map((p) => [p.numerator, p.denominator, p.coverage]), [[1, 1, "full"], [0.5, 1, "full"], [0.5, 0.5, "partial"], [null, null, "none"]]);

  const ny = T.bucketsFor({ from: "2026-03-07", to: "2026-03-09", bucket: "day", timeZone: "America/New_York", utcOffsetMinutes: -300 });
  assert.deepEqual(ny.buckets.map((b) => (b.endMs - b.startMs) / 3600000), [24, 23, 24], "the zone, not the fixed offset, sets the spring-forward day");
  assert.equal(ny.buckets[2].startMs, Date.parse("2026-03-09T04:00:00Z"), "after the change local midnight is 04:00Z");

  assert.deepEqual(T.bucketsFor({ from: "2026-09-03", to: "2026-09-14", bucket: "week", utcOffsetMinutes: 0 }).buckets.map((b) => b.key), ["2026-08-31", "2026-09-07", "2026-09-14"]);
  assert.deepEqual(T.bucketsFor({ from: "2026-01-31", to: "2026-03-01", bucket: "month", utcOffsetMinutes: 0 }).buckets.map((b) => b.label), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(T.bucketsFor({ from: "2026-01-01", to: "2027-12-31", bucket: "day" }).error, "range_too_long");
  assert.equal(T.bucketsFor({ from: "2026-02-01", to: "2026-01-01", bucket: "day" }).error, "range_invalid");
});

test("30-day readmission: a return within 30 days counts, day 31 does not, a death is excluded, an open window is pending", () => {
  const b = T.bucketsFor({ from: "2026-07-01", to: "2026-07-31", bucket: "month", utcOffsetMinutes: 0 });
  const s = (id, patientId, start, end, extra) => ({ id, patientId, class: "IPD", status: end ? "finished" : "in-progress", periodStart: start, periodEnd: end, location: { ward: "A" }, ...extra });
  const r = T.computeTrend({ metric: "readmission-30d", buckets: b.buckets, clock: b.clock, nowMs: Date.parse("2026-08-20T00:00:00Z"), rows: {
    Encounter: [
      s("i1", "p1", "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z"), s("r1", "p1", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"),     // back 29 days later
      s("i2", "p2", "2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z"), s("r2", "p2", "2026-08-01T12:00:00Z", "2026-08-03T00:00:00Z"),     // 30.5 days: not
      s("i3", "p3", "2026-07-05T00:00:00Z", "2026-07-06T00:00:00Z", { disposition: "Died" }),
      s("i4", "p4", "2026-07-25T00:00:00Z", "2026-07-28T00:00:00Z"),                                                                    // window ends 27 Aug
    ],
    Patient: [],
  } });
  const p = r.series[0].points[0];
  assert.equal(p.numerator, 1);
  assert.equal(p.denominator, 2, "i1 and i2; the death and the pending discharge are not in the rate");
  assert.equal(p.excludedDied, 1);
  assert.equal(p.pending, 1);
  assert.equal(p.value, 0.5);
});

test("an unreadable source is null with its reason, never 0; a capped read is partial; an unconfigured list is null", () => {
  const b = T.bucketsFor({ from: "2026-09-01", to: "2026-09-02", bucket: "day", utcOffsetMinutes: 0 });
  const now = Date.parse("2026-09-10T00:00:00Z");
  const unread = T.computeTrend({ metric: "incidents", buckets: b.buckets, clock: b.clock, nowMs: now, rows: { Encounter: [] }, unreadable: { IncidentReport: "not readable with this role" } });
  for (const p of unread.series[0].points) {
    assert.equal(p.value, null);
    assert.equal(p.numerator, null);
    assert.equal(p.coverage, "none");
    assert.match(p.reason, /IncidentReport records could not be read/);
  }
  const zero = T.computeTrend({ metric: "incidents", buckets: b.buckets, clock: b.clock, nowMs: now, rows: { Encounter: [], IncidentReport: [] } });
  assert.equal(zero.series[0].points[0].value, 0, "read in full with nothing in it is a real zero");
  assert.equal(zero.series[0].points[0].coverage, "full");
  const capped = T.computeTrend({ metric: "incidents", buckets: b.buckets, clock: b.clock, nowMs: now, rows: { Encounter: [], IncidentReport: [] }, capped: ["IncidentReport"] });
  assert.equal(capped.series[0].points[0].coverage, "partial");
  const abx = T.computeTrend({ metric: "antibiotic-dot", buckets: b.buckets, clock: b.clock, nowMs: now, rows: { Encounter: [], MedicationAdministration: [] } });
  assert.equal(abx.series[0].points[0].value, null);
  assert.match(abx.series[0].points[0].reason, /antibiotic list not configured/);
  const occ = T.computeTrend({ metric: "bed-occupancy", buckets: b.buckets, clock: b.clock, nowMs: now, rows: { Encounter: [] } });
  assert.equal(occ.series[0].points[0].value, null, "no beds registered: no rate");
  for (const d of Object.values(T.DEFINITIONS)) for (const k of ["numerator", "denominator", "inclusion", "exclusion"]) assert.ok(d[k], `${d.id} defines ${k}`);
});

/* ---------------------------------------------------------------- router */

test("GET /api/queue/ward/trends: 401 with no session, 403 for a role without emr.view and for another hospital; a doctor gets the series", async () => {
  await seed();
  assert.equal((await as(null, `/ward/trends?orgId=${ORG}&metric=admissions${range}`)).__status, 401);
  assert.equal((await as(CASHIER, `/ward/trends?orgId=${ORG}&metric=admissions${range}`)).__status, 403);
  assert.equal((await as(OTHER, `/ward/trends?orgId=${ORG}&metric=admissions${range}`)).__status, 403);

  const r = await as(DOCTOR, `/ward/trends?orgId=${ORG}&metric=admissions${range}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.series[0].points.map((p) => p.value), [2, 0, 0, 0]);
  assert.ok(r.definition.inclusion && r.metrics.some((m) => m.id === "billed-charges" && m.finance));
  assert.equal(r.truncated, false);

  const occ = await as(DOCTOR, `/ward/trends?orgId=${ORG}&metric=bed-occupancy${range}&groupBy=department`);
  assert.equal(occ.__status, 200, JSON.stringify(occ));
  assert.equal(occ.series[0].group, "Medicine", "the ward registry places Medical A in Medicine");
  assert.equal(occ.series[0].points[0].beds, 2);
});

test("finance gate: billed-charges needs billing.view on both routes", async () => {
  await seed();
  const refused = await as(DOCTOR, `/ward/trends?orgId=${ORG}&metric=billed-charges${range}`);
  assert.equal(refused.__status, 403);
  assert.equal(refused.detail, "billing_view_required");
  assert.equal((await as(DOCTOR, `/ward/trend-events?orgId=${ORG}&metric=billed-charges${range}&key=${dateOf(D0 + DAY)}&ward=Medical%20A`)).__status, 403);
  const ok = await as(OWNER, `/ward/trends?orgId=${ORG}&metric=billed-charges${range}`);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.series[0].points[1].denominator, 1, "one invoice raised on day 2");
});

test("GET /api/queue/ward/trend-events: a nurse limited to another department gets 403 on the ward's records; a doctor gets record ids only", async () => {
  await seed();
  const path = `/ward/trend-events?orgId=${ORG}&metric=admissions${range}&key=${dateOf(D0)}&ward=Medical%20A`;
  assert.equal((await as(null, path)).__status, 401);
  assert.equal((await as(OTHER, path)).__status, 403);
  const nurse = await as(NURSE, path);
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  assert.equal(nurse.error, "out_of_scope");
  assert.ok(!JSON.stringify(nurse).includes("enc-1"));
  // The same nurse may still see the hospital-wide aggregate, which names no record.
  assert.equal((await as(NURSE, `/ward/trends?orgId=${ORG}&metric=admissions${range}`)).__status, 200);
  // A ward the registry puts in no department is outside every department limit.
  assert.equal((await as(NURSE, path.replace("Medical%20A", "(no%20ward)"))).__status, 403);

  const doc = await as(DOCTOR, path);
  assert.equal(doc.__status, 200, JSON.stringify(doc));
  assert.deepEqual(doc.events.items, [{ resourceType: "Encounter", id: "enc-1" }, { resourceType: "Encounter", id: "enc-2" }]);
  assert.ok(!JSON.stringify(doc).includes("pat-1"), "record ids, not patients");
  assert.equal((await as(DOCTOR, `/ward/trend-events?orgId=${ORG}&metric=admissions${range}`)).__status, 422, "a ward and bucket are required");
});

/* ---------------------------------------------------------------- screen */

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}

test("Trends screen: reachable from the twin; loading, failed and empty are distinct; a null bucket is a gap, not zero", () => {
  const W = loadWard();
  assert.ok(W._render({ ...W._st, view: "twin", twin: { loaded: true, err: "x" } }).includes('data-w-act="trends"'));
  const view = (trends) => W._render({ ...W._st, view: "trends", trends: { metric: "admissions", bucket: "day", from: "2026-09-01", to: "2026-09-04", ...trends } });
  assert.match(view({ data: null }), /Loading the trend/);
  const failed = view({ data: false, err: "record_read_failed" });
  assert.match(failed, /could not be loaded: record_read_failed\. Do not read this as zero/);
  assert.ok(!/<svg class="w-trend"/.test(failed));
  assert.match(view({ data: false, status: "billing_view_required" }), /billing series and your role has no billing rights/);

  const pt = (key, value, extra) => ({ key, label: key, value, numerator: value, denominator: null, coverage: "full", ...extra });
  const data = { ok: true, definition: { title: "Incidents by category", unit: "incidents", numerator: "N", denominator: "D", inclusion: "I", exclusion: "E", wardAttribution: "W" }, range: { utcOffsetMinutes: 330 },
    series: [{ group: null, points: [pt("2026-09-01", 2), pt("2026-09-02", 3), pt("2026-09-03", null, { numerator: null, coverage: "none", reason: "IncidentReport records could not be read" }), pt("2026-09-04", 1)] }] };
  const html = view({ data, metrics: [{ id: "admissions", title: "Admissions" }] });
  assert.equal((html.match(/<polyline/g) || []).length, 1, "the two buckets before the gap are one line; the lone bucket after it is a dot, not joined across the gap");
  assert.equal((html.match(/<circle/g) || []).length, 3, "no dot is drawn for the null bucket");
  assert.match(html, /no value: IncidentReport records could not be read/);
  assert.match(html, /How this is counted/);
  assert.ok(html.includes('data-w-act="trendbucket:1"'));
  assert.ok(!html.includes('data-w-act="trendbucket:2"'), "a gap has nothing behind it to drill into");
  assert.match(view({ data: { ...data, series: [{ group: null, points: [] }] } }), /No buckets in this range/);

  const drill = view({ data, ward: { key: "2026-09-01", label: "2026-09-01", data: { ok: true, series: [{ group: "Medical A", points: [pt("2026-09-01", 2)] }] } },
    events: { ward: "Medical A", data: { ok: true, events: { total: 1, truncated: false, items: [{ resourceType: "IncidentReport", id: "inc-1" }] } } } });
  assert.ok(drill.includes('data-w-act="trendevents:0"'));
  assert.ok(drill.includes('data-w-act="timelinedetail:IncidentReport~inc-1"'));
  assert.match(view({ data, ward: { key: "k", label: "k", data: null } }), /Loading the wards/);
  assert.match(view({ data, ward: { key: "k", label: "k", data: { ok: true, series: [] } } }), /No ward had anything in this bucket/);
  assert.match(view({ data, events: { ward: "Medical A", data: false, status: 403 } }), /do not have access to this ward's records/);
});
