/* test/wardsynq-repository-window.test.mjs - R5-3 period-scoped reports.
 *
 * Every NABH / HMIS / trend / quality report read the hospital's WHOLE history of each source type to answer a
 * question about one month: on a 200-bed hospital that is tens of thousands of parsed bodies in one Worker isolate
 * within weeks, and the screen dies of memory or time long before the designed 50,000 refusal ever fires.
 *
 * This proves the port can walk back from the newest record (pageByType newest/beforeSeq, memory and on-premise SQL),
 * that service.listSince stops once it is past the caller's window, that a record amended inside the window is met
 * even though it was created before it, and that a month's NABH table over a tenant holding far more out-of-period
 * records than in-period gives the same figures while reading a bounded number of pages.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-repository-window.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let DatabaseSync = null, why = "";
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { why = String((e && e.message) || e); }
const NO_SQLITE = DatabaseSync ? false : `node:sqlite unavailable (${why})`;

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
const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
const { RecordService, ListCeilingError } = await import("../functions/_wardsynq/service.js");
const { makeActor, KIND, TIER, GovernanceError } = await import("../wardsynq/wardsynq-actors.js");
const { latestStampMs, outsideWindow, periodScoped, readWindowed, LOOKBACK_MS } = await import("../functions/_wardsynq/read-window.js");
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
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const T = TENANT_ROW.id;
const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const OWNER = "owner@example.test", ADMIN = "admin@example.test", NURSE = "nurse@example.test", OUTSIDER = "outsider@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const sqliteRepo = () => new D1Repository(openSqlite({ DatabaseSync, readSchema: (n) => readFileSync(new URL(n === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8") }, { path: ":memory:" }).binding);
const ADAPTERS = [["memory", () => new MemoryRepository(), false], ["sqlite", sqliteRepo, NO_SQLITE]];

function service(repo, actorSpec) {
  return new RecordService({ repository: repo, pseudonym: async () => null, tenant: { id: T, name: "Test", mode: "live" },
    actor: makeActor({ id: "fb:dr-a", kind: KIND.HUMAN, tier: TIER.EXECUTE, display: "Dr A", credential: "held-by-server", ...(actorSpec || {}) }), role: "doctor", roleSource: "opd" });
}
/** Counts the pages a read asks the port for: the whole point of a period read is how few there are. */
function counting(repo) {
  const inner = repo.pageByType.bind(repo);
  const calls = [];
  repo.pageByType = async (tenantId, type, opts) => { calls.push({ type, ...(opts || {}) }); return inner(tenantId, type, opts); };
  return calls;
}
const iso = (msv) => new Date(msv).toISOString();
const report = (id, atMs, status) => ({ resourceType: "DiagnosticReport", id, version: 1, patientId: `pat-${id}`, category: "laboratory",
  status: status || "final", display: "Sodium", reportedAt: iso(atMs), meta: { recordedAt: iso(atMs), effectiveAt: iso(atMs) }, writtenBy: { id: "seed", kind: "human", at: iso(atMs) } });
async function seedRows(repo, rows) {
  for (let i = 0; i < rows.length; i += 500) await repo.append(T, rows.slice(i, i + 500), {});
}

/* ---- the window test itself --------------------------------------------------------------------- */

test("latestStampMs / outsideWindow: the latest instant anywhere in the record decides, and no instant never decides", () => {
  const base = Date.parse("2026-09-10T00:00:00Z");
  assert.equal(latestStampMs({ a: "2026-01-01T00:00:00Z", b: { c: "2026-09-09T10:00:00Z" } }, 0), Date.parse("2026-09-09T10:00:00Z"));
  assert.equal(latestStampMs({ id: "x", n: 4, ok: true }, 0), null);
  assert.equal(latestStampMs({ list: [{ at: "2026-09-11T00:00:00Z" }] }, 0), Date.parse("2026-09-11T00:00:00Z"));
  assert.equal(outsideWindow({ at: "2026-09-09T00:00:00Z" }, base), true);
  assert.equal(outsideWindow({ at: "2026-09-09T00:00:00Z", meta: { recordedAt: "2026-09-12T00:00:00Z" } }, base), false, "written inside the window, so still read");
  assert.equal(outsideWindow({ id: "no-dates" }, base), false, "a record that names no instant is never judged behind the window");
  assert.equal(outsideWindow({ at: "2026-01-01T00:00:00Z" }, NaN), false, "no window, no stop");
  // A stay, a booking or a master record can belong to a month it holds no timestamp in: read whole.
  assert.equal(periodScoped("Encounter"), false);
  assert.equal(periodScoped("Appointment"), false);
  assert.equal(periodScoped("Patient"), false);
  assert.equal(periodScoped("DiagnosticReport"), true);
  assert.equal(LOOKBACK_MS, 90 * 86400000);
});

for (const [name, make, skip] of ADAPTERS) {
  test(`${name}: pageByType walks back from the newest record and the descending cursor terminates`, { skip }, async () => {
    const repo = make();
    const now = Date.parse("2026-09-20T00:00:00Z");
    await seedRows(repo, Array.from({ length: 2345 }, (_, i) => report(`r-${i}`, now - (2345 - i) * 3600000)));

    const first = await repo.pageByType(T, "DiagnosticReport", { newest: true, limit: 1000 });
    assert.equal(first.records.length, 1000);
    assert.equal(first.records[0].id, "r-2344", "newest first");
    assert.ok(first.next != null);

    const seen = new Set();
    let before = null, pages = 0;
    for (;;) {
      const page = await repo.pageByType(T, "DiagnosticReport", { newest: true, limit: 1000, ...(before == null ? {} : { beforeSeq: before }) });
      pages += 1;
      for (const r of page.records) seen.add(r.id);
      if (page.next == null) break;
      before = page.next;
      assert.ok(pages < 10, "the descending cursor terminates");
    }
    assert.equal(pages, 3);
    assert.equal(seen.size, 2345, "paging back reaches every record exactly once");
    // The oldest-first cursor is untouched by the new option.
    const asc = await repo.pageByType(T, "DiagnosticReport", { afterSeq: 0, limit: 10 });
    assert.equal(asc.records[0].id, "r-0");
  });

  test(`${name}: listSince reads the window, not the history, and keeps listAll's answer`, { skip }, async () => {
    const repo = make();
    const now = Date.parse("2026-09-20T00:00:00Z"), DAY = 86400000;
    const monthStart = Date.parse("2026-09-01T00:00:00Z");
    // 4,700 reports from two years ago, then 300 in the month asked for.
    await seedRows(repo, Array.from({ length: 4700 }, (_, i) => report(`old-${i}`, now - 730 * DAY + i * 1000)));
    await seedRows(repo, Array.from({ length: 300 }, (_, i) => report(`new-${i}`, monthStart + i * 3600000)));
    // A report first written last year and CORRECTED inside the month: its latest version is in the window.
    await seedRows(repo, [report("amended", now - 400 * DAY)]);
    await seedRows(repo, [{ ...report("amended", monthStart + 10 * 3600000, "corrected"), version: 2 }]);

    const svc = service(repo);
    const calls = counting(repo);
    const got = await svc.listSince("DiagnosticReport", { stopWhen: (r) => outsideWindow(r, monthStart) });
    assert.equal(got.truncated, false);
    assert.ok(calls.length <= 3 && calls.every((c) => c.newest === true), `walked back in ${calls.length} pages, not the whole type`);
    const ids = new Set(got.rows.map((r) => r.id));
    for (let i = 0; i < 300; i++) assert.ok(ids.has(`new-${i}`), `new-${i} is in the window`);
    assert.ok(ids.has("amended"), "created before the window, amended inside it: the later copy wins");
    assert.equal(got.rows.find((r) => r.id === "amended").status, "corrected");
    assert.equal(got.rows.find((r) => r.id === "amended").version, 2);
    assert.ok(ids.size < 5001, "the two-year-old history was not all read");
    assert.deepEqual(got.rows.map((r) => r.id).slice(-2), ["new-299", "amended"], "oldest first by latest write, exactly as listAll hands them over");

    // The same read through the module helper, which decides per type.
    const windowed = await readWindowed(svc, "DiagnosticReport", { sinceMs: now });
    assert.ok(windowed.rows.length < 5001);
    const whole = await readWindowed(svc, "Encounter", { sinceMs: now });
    assert.deepEqual(whole, { rows: [], truncated: false }, "a spanning type is still read whole");

    // Truncation keeps the END of the window, not its start, and still says so.
    const capped = await svc.listSince("DiagnosticReport", { max: 100, stopWhen: (r) => outsideWindow(r, monthStart) });
    assert.equal(capped.truncated, true);
    assert.equal(capped.rows.length, 100);
    assert.equal(capped.rows[capped.rows.length - 1].id, "amended", "the newest written are the ones kept");
    await assert.rejects(svc.listSince("DiagnosticReport", { max: 100, throwOnTruncate: true, stopWhen: (r) => outsideWindow(r, monthStart) }),
      (e) => e instanceof ListCeilingError && e.code === "too_many_records");

    // Governed exactly as listAll: no read scope on the type is a GovernanceError and nothing is read.
    const denied = service(repo, { scope: { read: ["Patient"] } });
    await assert.rejects(denied.listSince("DiagnosticReport", { stopWhen: () => false }), (e) => e instanceof GovernanceError);
  });
}

test("a store without pageByType refuses a period read rather than falling back to a capped roster", async () => {
  const repo = new MemoryRepository();
  repo.pageByType = undefined;
  await assert.rejects(service(repo).listSince("DiagnosticReport", { stopWhen: () => false }), /cannot page/);
});

/* ---- the report on a hospital with far more out-of-period records than in-period ------------------ */

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  const org = (id) => ({ fields: { id, code: "SMD-" + id, name: "Hospital " + id, kind: "clinic", mode: "wardsynq", connectTenantId: T, ownerUid: idFor(OWNER), createdAt: 1, wardsynq: { utcOffsetMinutes: 330 } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG}`, org(ORG));
  docs.set(`q_orgs/org-other`, { ...org("org-other"), fields: { ...org("org-other").fields, connectTenantId: "tenant-other", ownerUid: "someone-else" } });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize("org-other")}__${sanitize(idFor(OUTSIDER))}`, { fields: { orgId: "org-other", identity: idFor(OUTSIDER), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("GET /api/queue/ward/nabh-indicators: a month's table over 3,000 out-of-period reports gives the month's figures and reads a bounded number of pages", async () => {
  seedHospital();
  const DAY = 86400000, now = Date.now();
  const off = 330 * 60000, local = new Date(now + off);
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - off;
  // Three years of released reports, every one of them outside the month asked for.
  await seedRows(RECORD, Array.from({ length: 3000 }, (_, i) => report(`old-${i}`, monthStart - 1000 * DAY + i * 6 * 3600000)));
  // This month: four released reports, one of them corrected after release (NABH indicator 2).
  const inMonth = Math.min(now, monthStart + 2 * 3600000);
  await seedRows(RECORD, [report("m-1", inMonth), report("m-2", inMonth), report("m-3", inMonth), report("m-4", inMonth, "corrected")]);

  const calls = counting(RECORD);
  const r = await as(ADMIN, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
  assert.equal(r.__status, 200, JSON.stringify(r).slice(0, 300));
  const two = r.indicators.find((i) => i.no === 2);
  assert.equal(two.computable, true);
  assert.deepEqual([two.months[0].numerator, two.months[0].denominator], [1, 4], "this month's reports only, the three thousand behind them not counted");
  assert.equal(two.months[0].value, 250);
  assert.equal(r.truncated, false);

  const dx = calls.filter((c) => c.newest === true && c.type === "DiagnosticReport");
  assert.ok(dx.length > 0, "the reports were read newest first");
  assert.ok(dx.length <= 3, `a month's table asked for ${dx.length} pages of the biggest type, not the four thousand records behind it`);
  assert.equal(calls.filter((c) => c.newest !== true && c.type === "DiagnosticReport").length, 0, "no whole-history read of it is left");

  // Negative authorization on the route, unchanged.
  assert.equal((await as(null, `/ward/nabh-indicators?orgId=${ORG}&months=1`)).__status, 401);
  assert.equal((await as(NURSE, `/ward/nabh-indicators?orgId=${ORG}&months=1`)).__status, 403);
  assert.equal((await as(OUTSIDER, `/ward/nabh-indicators?orgId=${ORG}&months=1`)).__status, 403);
});
