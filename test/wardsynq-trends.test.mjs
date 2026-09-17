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
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime, createTime: d.createTime });
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
  const occ = T.computeTrend({ metric: "bed-occupancy", buckets: days.buckets, clock: days.clock, nowMs: Date.parse("2026-09-03T12:00:00Z"), bedHistory: [{ ward: "A", since: Date.parse("2026-01-01T00:00:00Z"), active: true }],
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

/* ---------------------------------------------------------------- G7: ward-by-ward stays, occupancy from history */

const H = (t) => Date.parse(t);
const version = (v, over) => ({ resourceType: "Encounter", id: "s1", patientId: "p1", class: "IPD", version: v, periodStart: "2026-09-01T00:00:00Z", status: "in-progress", location: { ward: "A", bed: "1" }, ...over });

test("G7 staySegments: a transfer splits the stay; a discharge version is not a move; a move with no time cannot be placed", () => {
  const vs = [version(1), version(2, { location: { ward: "B", bed: "4" }, movedAt: "2026-09-03T12:00:00Z" }), version(3, { location: { ward: "B", bed: "4" }, status: "finished", periodEnd: "2026-09-04T12:00:00Z" })];
  assert.deepEqual(T.staySegments(vs), [
    { ward: "A", bed: "1", start: H("2026-09-01T00:00:00Z"), end: H("2026-09-03T12:00:00Z") },
    { ward: "B", bed: "4", start: H("2026-09-03T12:00:00Z"), end: H("2026-09-04T12:00:00Z") },
  ]);
  assert.equal(T.staySegments([version(1), version(2, { location: { ward: "B" } })]), null);
  assert.equal(T.staySegments([version(1), version(2, { status: "finished" })]), null, "finished with no end time");
  const open = T.staySegments([version(1), version(2, { location: { ward: "C" }, movedAt: "2026-09-02T00:00:00Z" })]);
  assert.equal(open[1].end, null, "the current ward is still running");
});

test("G7 bedDaysIn: counted from when the bed was added, through turn-offs; no history is unknown, never a guess", () => {
  const a = H("2026-09-02T00:00:00Z"), b = H("2026-09-03T00:00:00Z");
  assert.deepEqual(T.bedDaysIn({ since: H("2026-01-01T00:00:00Z"), active: true }, a, b), { days: 1 });
  assert.deepEqual(T.bedDaysIn({ since: H("2026-09-02T12:00:00Z"), active: true }, a, b), { days: 0.5 }, "added at noon");
  assert.deepEqual(T.bedDaysIn({ since: H("2026-09-05T00:00:00Z"), active: true }, a, b), { days: 0 }, "not added yet is a known zero");
  assert.deepEqual(T.bedDaysIn({ since: H("2026-01-01T00:00:00Z"), active: true, changes: [{ active: false, at: H("2026-09-02T06:00:00Z") }, { active: true, at: H("2026-09-02T18:00:00Z") }] }, a, b), { days: 0.5 }, "off 06:00 to 18:00");
  assert.deepEqual(T.bedDaysIn({ since: H("2026-01-01T00:00:00Z"), active: false, changes: [{ active: false, at: H("2026-09-02T12:00:00Z") }] }, a, b), { days: 0.5 }, "turned off today, and on before that");
  assert.deepEqual(T.bedDaysIn({ since: null, active: true }, a, b), { unknown: true }, "a settings-only bed has no history");
  assert.deepEqual(T.bedDaysIn({ since: H("2026-01-01T00:00:00Z"), active: false, legacy: true }, a, b), { unknown: true }, "a legacy bed turned off at an unrecorded time");
});

test("G7 bed occupancy per day: past days use the stay's wards and the beds of that day; unknown is null with a reason, not 0", () => {
  const days = T.bucketsFor({ from: "2026-09-01", to: "2026-09-04", bucket: "day", utcOffsetMinutes: 0 });
  const nowMs = H("2026-09-10T00:00:00Z");
  const cur = version(3, { location: { ward: "B", bed: "4" }, status: "finished", periodEnd: "2026-09-04T00:00:00Z" });
  const hist = [version(1), version(2, { location: { ward: "B", bed: "4" }, movedAt: "2026-09-03T00:00:00Z" }), cur];
  const beds = [{ ward: "A", since: H("2026-01-01T00:00:00Z"), active: true }, { ward: "A", since: H("2026-09-02T00:00:00Z"), active: true },
    { ward: "B", since: H("2026-01-01T00:00:00Z"), active: true }];
  const run = (over) => T.computeTrend({ metric: "bed-occupancy", buckets: days.buckets, clock: days.clock, nowMs, rows: { Encounter: [cur] }, bedHistory: beds, histories: { s1: hist }, ...over });

  const byWard = run({ groupBy: "ward" });
  const pts = (g) => byWard.series.find((s) => s.group === g).points.map((p) => [p.numerator, p.denominator, p.value]);
  assert.deepEqual(pts("A"), [[1, 1, 1], [1, 2, 0.5], [0, 2, 0], [0, 2, 0]], "ward A held the stay on days 1-2; its second bed was added on day 2");
  assert.deepEqual(pts("B"), [[0, 1, 0], [0, 1, 0], [1, 1, 1], [0, 1, 0]], "ward B from the transfer, not the whole stay");
  assert.deepEqual(run({}).series[0].points.map((p) => p.numerator), [1, 1, 1, 0], "hospital-wide bed-days");

  const unread = run({ groupBy: "ward", histories: {} });
  const a = unread.series.find((s) => s.group === "A").points;
  assert.equal(a[0].value, null);
  assert.match(a[0].reason, /which ward 1 stay was on in this bucket is not known/);
  assert.equal(a[3].value, 0, "a day the unplaced stay did not touch still has its number");
  assert.deepEqual(run({ histories: {} }).series[0].points.map((p) => p.numerator), [1, 1, 1, 0], "hospital-wide does not need the ward");

  const noHistory = run({ bedHistory: [...beds, { ward: "B", since: null }] }).series[0].points;
  assert.ok(noHistory.every((p) => p.value === null && /bed count in this bucket is not known: 1 bed has no history/.test(p.reason)), JSON.stringify(noHistory[0]));
  assert.ok(noHistory.every((p) => p.value !== 0));
});

test("G7 length of stay by ward: each ward piece that ended counts on its ward; the records list the stay ward by ward", () => {
  const days = T.bucketsFor({ from: "2026-09-01", to: "2026-09-04", bucket: "day", utcOffsetMinutes: 0 });
  const cur = version(3, { location: { ward: "B", bed: "4" }, status: "finished", periodEnd: "2026-09-04T12:00:00Z" });
  const hist = [version(1), version(2, { location: { ward: "B", bed: "4" }, movedAt: "2026-09-03T12:00:00Z" }), cur];
  const stay2 = { resourceType: "Encounter", id: "s2", patientId: "p2", class: "IPD", version: 1, status: "finished", periodStart: "2026-09-02T00:00:00Z", periodEnd: "2026-09-03T00:00:00Z", location: { ward: "A", bed: "2" } };
  const input = { metric: "ward-los", buckets: days.buckets, clock: days.clock, nowMs: H("2026-09-10T00:00:00Z"), rows: { Encounter: [cur, stay2] }, histories: { s1: hist } };
  const byWard = T.computeTrend({ ...input, groupBy: "ward" });
  const A = byWard.series.find((s) => s.group === "A").points, B = byWard.series.find((s) => s.group === "B").points;
  assert.deepEqual([A[2].value, A[2].denominator], [1.8, 2], "day 3: stay2 left A (1 day) and s1 left A (2.5 days)");
  assert.deepEqual([B[3].value, B[3].denominator], [1, 1]);
  assert.equal(A[0].value, null, "no ward stay ended: no mean, never 0");

  const ev = T.computeTrend({ ...input, groupBy: "ward", eventsFor: { key: "2026-09-03", group: "A" } }).events;
  const s1 = ev.items.find((x) => x.id === "s1");
  assert.equal(s1.transferred, true);
  assert.deepEqual(s1.segments.map((g) => [g.ward, g.days]), [["A", 2.5], ["B", 1]]);
  assert.equal(ev.items.find((x) => x.id === "s2").transferred, false);

  const unknown = T.computeTrend({ ...input, histories: {} }).series[0].points;
  assert.equal(unknown[3].value, null);
  assert.match(unknown[3].reason, /ward history of 1 stay could not be read/);
});

test("G7 GET /api/queue/ward/trends and trend-events for ward-los and bed-occupancy: history through the router, audited once; 401, 403, out of scope", async () => {
  await seed();
  docs.set("q_wards/w-surg", { fields: { orgId: ORG, name: "Surgical B", departmentId: "dept-surg" }, updateTime: "t1" });
  docs.set("q_beds/b1", { fields: { orgId: ORG, wardId: "w-med", name: "1", since: D0 - 30 * DAY }, updateTime: "t1" });
  docs.set("q_beds/b2", { fields: { orgId: ORG, wardId: "w-med", name: "2", since: D0 - 30 * DAY }, updateTime: "t1" });
  docs.set("q_beds/b3", { fields: { orgId: ORG, wardId: "w-surg", name: "3", since: D0 + DAY }, updateTime: "t1" });
  const base = { resourceType: "Encounter", id: "enc-9", patientId: "pat-9", class: "IPD", periodStart: iso(D0), status: "in-progress" };
  await RECORD.append(TENANT, [{ ...base, version: 1, location: { ward: "Medical A", bed: "2" } }], {});
  await RECORD.append(TENANT, [{ ...base, version: 2, location: { ward: "Surgical B", bed: "3" }, movedAt: iso(D0 + 2 * DAY) }], {});
  await RECORD.append(TENANT, [{ ...base, version: 3, location: { ward: "Surgical B", bed: "3" }, status: "finished", periodEnd: iso(D0 + 3 * DAY) }], {});

  const auditBefore = RECORD.audit.length;
  const occ = await as(DOCTOR, `/ward/trends?orgId=${ORG}&metric=bed-occupancy${range}&groupBy=ward`);
  assert.equal(occ.__status, 200, JSON.stringify(occ));
  const surg = occ.series.find((s) => s.group === "Surgical B").points;
  assert.deepEqual(surg.map((p) => [p.numerator, p.denominator]), [[0, 0], [0, 1], [1, 1], [0, 1]], "Surgical B's bed exists from day 2 and holds enc-9 on day 3 only");
  assert.equal(surg[0].value, null);
  assert.match(surg[0].reason, /no bed was in service/);
  assert.equal(RECORD.audit.slice(auditBefore).filter((a) => a.action === "record.list" && a.scope && a.scope.history).length, 1, "the histories are one audited read");
  assert.match(occ.definition.wardAttribution, /counted on each ward for the time spent there/);

  const los = await as(DOCTOR, `/ward/trends?orgId=${ORG}&metric=ward-los${range}&groupBy=ward`);
  assert.equal(los.__status, 200, JSON.stringify(los));
  assert.equal(los.series.find((s) => s.group === "Medical A").points[2].value, 2);

  const path = `/ward/trend-events?orgId=${ORG}&metric=ward-los${range}&key=${dateOf(D0 + 2 * DAY)}&ward=Medical%20A`;
  assert.equal((await as(null, path)).__status, 401);
  assert.equal((await as(OTHER, path)).__status, 403);
  const nurse = await as(NURSE, path);
  assert.equal(nurse.__status, 403);
  assert.ok(!JSON.stringify(nurse).includes("enc-9"));
  const doc = await as(DOCTOR, path);
  assert.equal(doc.__status, 200, JSON.stringify(doc));
  const item = doc.events.items.find((x) => x.id === "enc-9");
  assert.deepEqual(item.segments.map((g) => [g.ward, g.bed, g.days]), [["Medical A", "2", 2], ["Surgical B", "3", 1]]);
  assert.ok(!JSON.stringify(doc).includes("pat-9"), "record ids and wards, not patients");
  // The nurse limited to Surgery may see Surgical B's records.
  assert.equal((await as(NURSE, `/ward/trend-events?orgId=${ORG}&metric=ward-los${range}&key=${dateOf(D0 + 3 * DAY)}&ward=Surgical%20B`)).__status, 200);
});

test("G7 bed registry keeps its own history: added time on create, each turn off or on appended, never set by a patch", async () => {
  await seed();
  const S = await import("../functions/_opd_org_store.js");
  const bed = await S.createBed(ENV, ORG, { wardId: "w-med", name: "9", since: 1, activeHistory: [{ active: false, at: 5 }] }, "admin");
  assert.ok(bed.since > Date.now() - 60000, "since is the server's time, not the caller's");
  assert.deepEqual(bed.activeHistory, []);
  const off = await S.updateBed(ENV, bed.id, { active: false, since: 2, activeHistory: [] }, "admin");
  assert.equal(off.since, bed.since);
  assert.equal(off.activeHistory.length, 1);
  assert.equal(off.activeHistory[0].active, false);
  const renamed = await S.updateBed(ENV, bed.id, { name: "9A" }, "admin");
  assert.equal(renamed.activeHistory.length, 1, "a change that is not a turn off or on adds nothing");
  const on = await S.updateBed(ENV, bed.id, { active: true }, "admin");
  assert.deepEqual(on.activeHistory.map((c) => c.active), [false, true]);
  // A bed registered before bed history was kept: its document's creation time, marked legacy.
  docs.set("q_beds/old", { fields: { orgId: ORG, wardId: "w-med", name: "7", active: false }, updateTime: "t1", createTime: "2026-01-01T00:00:00Z" });
  const old = (await S.listBeds(ENV, ORG)).find((b) => b.id === "old");
  assert.equal(old.since, Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(old.legacy, true);
  assert.equal((await S.listBeds(ENV, ORG)).find((b) => b.id === bed.id).legacy, undefined);
});

test("G7 screen: the records of a ward stay show the stay ward by ward, and a running piece says so", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "trends", trends: { metric: "ward-los", bucket: "day", from: "2026-09-01", to: "2026-09-04",
    data: { ok: true, definition: { title: "Length of stay by ward", unit: "days" }, range: {}, series: [{ group: null, points: [{ key: "k", label: "k", value: null, numerator: null, denominator: null, coverage: "full", reason: "the ward history of 1 stay could not be read, so this is not known" }] }] },
    events: { ward: "Medical A", data: { ok: true, events: { total: 1, truncated: false, items: [{ resourceType: "Encounter", id: "enc-9", transferred: true,
      segments: [{ ward: "Medical A", bed: "2", days: 2 }, { ward: "Surgical B", bed: "3", days: 1.5, running: true }] }] } } } } });
  assert.match(html, /Transferred: Medical A bed 2 2 days, then Surgical B bed 3 1\.5 days so far \(still there\)/);
  assert.match(html, /no value: the ward history of 1 stay could not be read/);
  assert.ok(!/[—–]/.test(html));
});
