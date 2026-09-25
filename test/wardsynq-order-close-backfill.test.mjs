import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-order-close-backfill.test.mjs - closing the orders a hospital resulted before
 * anything closed an order (functions/_wardsynq/order-backfill.js).
 *
 * R5-2 closed an order when its result was filed and pointed the laboratory, specimen and imaging
 * boards at the OPEN orders. The archive is the part neither reached: every order an existing
 * hospital ever resulted is still `active`, counts against the 5,000 open census, and makes those
 * three boards answer 503 until something closes it.
 *
 * So the tenant here is seeded with FAR MORE resulted-but-open orders than one batch holds, and the
 * job has to finish them across several runs, off its own cursor, without ever being handed the whole
 * set. Beside them sit the orders it must NOT touch - no report at all, an imaging study read only
 * preliminarily, and one another system owns - because a backfill that closes a genuinely owed test
 * is a missed result, which is worse than the ceiling it was built to clear.
 *
 * Routes: POST /api/queue/ward/order-backfill-scan, POST /api/queue/ward/order-backfill-close.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-order-close-backfill.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test } from "node:test";
import { mock } from "node:test";
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
const { BATCH_DEFAULT } = await import("../functions/_wardsynq/order-backfill.js");
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

const ORG = "org-wsq", OTHER_ORG = "org-other", T = TENANT_ROW.id;
const ADMIN = "admin@example.test", LAB = "lab@example.test", CASHIER = "cashier@example.test", OUTSIDER_ADMIN = "outsider@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital(repo) {
  docs.clear(); clock = 1;
  RECORD = repo;
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: T, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OUTSIDER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role, org] of [[ADMIN, "admin", ORG], [LAB, "lab", ORG], [CASHIER, "cashier", ORG], [OUTSIDER_ADMIN, "admin", OTHER_ORG]]) {
    docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const scan = (who, body, org) => as(who, "/ward/order-backfill-scan", "POST", { orgId: org || ORG, ...(body || {}) });
const close = (who, body, org) => as(who, "/ward/order-backfill-close", "POST", { orgId: org || ORG, ...(body || {}) });
const pendingTests = (who) => as(who, `/ward/pending-tests?orgId=${ORG}&scope=hospital`);
const collections = (who) => as(who, `/ward/collections?orgId=${ORG}&scope=hospital`);

const AT = "2026-09-01T08:00:00.000Z";
const meta = (system) => ({ recordedAt: AT, effectiveAt: AT, amendedAt: null, source: { system: system || "wardsynq-native", sourceId: null, importedAt: AT }, derivedFrom: [] });
const writtenBy = { id: "seed", kind: "human", at: AT };
const patient = (id) => ({ resourceType: "Patient", id, version: 1, mrn: "GH-" + id, name: "Patient " + id, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta(), writtenBy });
const order = (id, over) => ({ resourceType: "ServiceRequest", id, version: 1, patientId: "pat-0", encounterId: null,
  code: "2823-3", display: "Potassium", category: "laboratory", priority: "routine", requesterId: "fb:doc", status: "active", meta: meta(), writtenBy, ...(over || {}) });
const report = (id, serviceRequestId, over) => ({ resourceType: "DiagnosticReport", id, version: 1, patientId: "pat-0", encounterId: null,
  serviceRequestId, status: "final", category: "laboratory", reportedAt: AT, observationIds: [], meta: meta(), writtenBy, ...(over || {}) });

/* The archive this job exists for: RESULTED orders that nobody ever closed, far more than one batch,
 * spread over a handful of patients as a real ward is. */
const PATIENTS = 10;
const RESULTED = BATCH_DEFAULT * 2 + 37;   // 237: three batches, the last one short
function seedArchive(repo) {
  const records = [];
  for (let i = 0; i < PATIENTS; i += 1) records.push(patient(`pat-${i}`));
  for (let i = 0; i < RESULTED; i += 1) {
    const pid = `pat-${i % PATIENTS}`;
    records.push(order(`sr-done-${i}`, { patientId: pid }));
    records.push(report(`wsq-dr-sr-done-${i}`, `sr-done-${i}`, { patientId: pid }));
  }
  // The four it must NOT close, each for its own reason.
  records.push(order("sr-owed-1", { patientId: "pat-0" }));                                                   // no report at all
  records.push(order("sr-owed-2", { patientId: "pat-1", code: "CT-ABDO", display: "CT abdomen", category: "imaging" }));
  records.push(report("wsq-rad-sr-owed-2", "sr-owed-2", { patientId: "pat-1", status: "preliminary", category: "imaging" }));
  records.push(order("sr-ext-1", { patientId: "pat-2", meta: meta("ghis"), status: "draft" }));                // another system's
  records.push(report("wsq-dr-sr-ext-1", "sr-ext-1", { patientId: "pat-2", meta: meta("ghis") }));
  return repo.append(T, records, {});
}

/** Scan a batch, close exactly what that scan said, and move to the next page. One "run" of the job. */
async function runBatch(cursor, limit) {
  const s = await scan(ADMIN, { cursor, ...(limit ? { limit } : {}) });
  assert.equal(s.__status, 200, JSON.stringify(s));
  const c = s.orderIds.length ? await close(ADMIN, { orderIds: s.orderIds }) : { closed: 0, __status: 200 };
  assert.equal(c.__status, 200, JSON.stringify(c));
  return { s, c };
}

/* ---- 1: it closes the whole archive across several runs, off its own cursor --------------------- */

test("a hospital with far more resulted-but-open orders than one batch is finished across several runs", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);

  /* The symptom, before anything is closed: the collection board still lists every order this
   * hospital ever placed, because "open" and "ever placed" are the same set until this job runs. */
  const before = await collections(LAB);
  assert.equal(before.__status, 200, JSON.stringify(before));
  assert.equal(before.requests.length, RESULTED + 2, "every resulted order is still on the bench, beside the two genuinely open ones");

  let cursor = 0, runs = 0, closed = 0, scanned = 0, done = false;
  const stayed = {};
  while (!done) {
    const { s, c } = await runBatch(cursor);
    runs += 1; closed += c.closed; scanned += s.scanned;
    for (const [k, v] of Object.entries(s.stayOpen)) stayed[k] = (stayed[k] || 0) + v;
    assert.ok(s.scanned <= BATCH_DEFAULT, "a batch never reads more than it said it would");
    cursor = s.nextCursor; done = s.done;
    assert.ok(runs < 20, "the cursor is not advancing; the job would never finish");
  }

  assert.ok(runs >= 3, `the archive took more than one batch (${runs} runs)`);
  assert.equal(closed, RESULTED, "every resulted order was closed, and none of the others");
  assert.equal(scanned, RESULTED + 3, "every open order was looked at exactly once");
  assert.equal(stayed.no_report, 1);
  assert.equal(stayed.report_preliminary, 1, "the imaging study read only preliminarily still owes its final report");
  assert.equal(stayed.external_order, 1, "an order another system owns is left where it stands");
  assert.equal(stayed.report_read_failed, 0);

  // Append-only: a closed order is a NEW version of it, at the closure's own vocabulary.
  const one = await repo.latest(T, "ServiceRequest", "sr-done-0");
  assert.equal(one.status, "completed");
  assert.equal(one.version, 2);
  assert.equal(one.completedOn, "backfill", "an auditor can tell a retrospective tidy-up from a result being filed");
  assert.equal(one.completedBy, idFor(ADMIN), "the person who ran it is on the record");

  // And the boards now show the work that is actually in front of the hospital.
  const afterColl = await collections(LAB);
  assert.equal(afterColl.__status, 200, JSON.stringify(afterColl));
  assert.deepEqual(afterColl.requests.map((r) => r.serviceRequestId).sort(), ["sr-owed-1", "sr-owed-2"],
    "only the test nobody has resulted and the study nobody has finally reported are left");
  const afterLab = await pendingTests(LAB);
  assert.deepEqual(afterLab.pending.map((p) => p.serviceRequestId), ["sr-owed-1"], "the bench list is the one test still owed");
});

/* ---- 2: running it again writes nothing --------------------------------------------------------- */

test("a second run of the same job finds nothing to do and rewrites nothing", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);

  let cursor = 0, done = false, guard = 0;
  const firstIds = [];
  while (!done && guard++ < 20) { const { s } = await runBatch(cursor); firstIds.push(...s.orderIds); cursor = s.nextCursor; done = s.done; }
  const versionAfterFirst = (await repo.latest(T, "ServiceRequest", "sr-done-5")).version;
  assert.equal(versionAfterFirst, 2);

  // The scan no longer sees them at all: the store filters on the open statuses.
  cursor = 0; done = false; guard = 0;
  let wouldClose = 0, scanned = 0;
  while (!done && guard++ < 20) {
    const s = await scan(ADMIN, { cursor });
    assert.equal(s.__status, 200, JSON.stringify(s));
    wouldClose += s.wouldClose; scanned += s.scanned; cursor = s.nextCursor; done = s.done;
  }
  assert.equal(wouldClose, 0, "nothing is left to close");
  assert.equal(scanned, 3, "only the orders that stay open are still met");

  // And a stale list from the first run closes nothing rather than writing a second closed version.
  const again = await close(ADMIN, { orderIds: firstIds.slice(0, 50) });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal(again.closed, 0);
  assert.equal(again.written, 0);
  assert.equal(again.reasons.already_closed, 50, "an order already closed is skipped by name, never rewritten");
  assert.equal((await repo.latest(T, "ServiceRequest", "sr-done-5")).version, versionAfterFirst, "no second version was appended");
});

/* ---- 3: a dry run writes NOTHING, and says what it would do ------------------------------------- */

test("the dry run writes nothing at all, and reports what would close and why the rest would not", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  const rowsBefore = (await repo.pageByType(T, "ServiceRequest", { afterSeq: 0, limit: 1000 })).records.length;

  const s = await scan(ADMIN, { cursor: 0, limit: 25 });
  assert.equal(s.__status, 200, JSON.stringify(s));
  assert.equal(s.run, "dry-run");
  assert.equal(s.written, 0);
  assert.equal(s.scanned, 25);
  assert.equal(s.wouldClose, 25);
  assert.equal(s.orderIds.length, 25);
  assert.equal(s.done, false, "there is more to scan, and it says so");
  assert.ok(s.nextCursor > 0);

  assert.equal((await repo.latest(T, "ServiceRequest", "sr-done-0")).version, 1, "a dry run leaves every version exactly as it was");
  assert.equal((await repo.pageByType(T, "ServiceRequest", { afterSeq: 0, limit: 1000 })).records.length, rowsBefore);

  // A commit with no list is refused: the close exists to apply a scan, not to enumerate the archive itself.
  const bare = await close(ADMIN, {});
  assert.equal(bare.__status, 422);
  assert.equal(bare.error, "order_ids_required");
  assert.equal((await repo.latest(T, "ServiceRequest", "sr-done-0")).version, 1);
});

/* ---- 4: a failed read is a failure, never "nothing left" ---------------------------------------- */

test("a page that could not be read is reported as a failure and never as the end of the job", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  // The one read the job walks on. A store that cannot answer it must not look like an empty archive.
  repo.pageByType = async () => { throw new Error("the record store is unreachable"); };

  const s = await scan(ADMIN, { cursor: 0 });
  assert.equal(s.__status, 502, JSON.stringify(s));
  assert.equal(s.error, "record_read_failed");
  assert.notEqual(s.done, true, "a failed read must never read as 'there is nothing left'");
  assert.deepEqual(s.orderIds, []);
});

test("reports that could not be read leave the order open, counted as a failure and not as 'no report'", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  const realByPatient = repo.byPatient.bind(repo);
  repo.byPatient = async (tenantId, type, pid) => {
    if (type === "DiagnosticReport") throw new Error("the reports are unreachable");
    return realByPatient(tenantId, type, pid);
  };

  const s = await scan(ADMIN, { cursor: 0, limit: 10 });
  assert.equal(s.__status, 200, JSON.stringify(s));
  assert.equal(s.wouldClose, 0, "nothing is closed on a read that failed");
  assert.equal(s.stayOpen.report_read_failed, 10);
  assert.equal(s.stayOpen.no_report, 0, "an unreadable report is not the same fact as no report");
  assert.equal(s.partial, true, "the batch says it was not fully scanned");

  // And the commit refuses to close one on the same failed read.
  const c = await close(ADMIN, { orderIds: ["sr-done-0"] });
  assert.equal(c.__status, 200, JSON.stringify(c));
  assert.equal(c.closed, 0);
  assert.equal(c.reasons.report_read_failed, 1);
  assert.equal((await repo.latest(T, "ServiceRequest", "sr-done-0")).version, 1, "nothing was written");
});

/* ---- 5: authorisation on both new routes -------------------------------------------------------- */

test("no session, the wrong role and another hospital are all refused on both backfill routes", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  const untouched = async () => assert.equal((await repo.latest(T, "ServiceRequest", "sr-done-0")).version, 1, "nothing was written by a refused call");

  for (const [what, call] of [["order-backfill-scan", scan], ["order-backfill-close", close]]) {
    const anon = await call(null, { orderIds: ["sr-done-0"], cursor: 0 });
    assert.equal(anon.__status, 401, `${what} with no session: ${anon.__status}`);
    await untouched();

    // A cashier and the laboratory both hold a real session here and neither holds staff.admin.
    for (const who of [CASHIER, LAB]) {
      const wrong = await call(who, { orderIds: ["sr-done-0"], cursor: 0 });
      assert.ok(wrong.__status === 403 || wrong.__status === 404, `${what} as ${who}: ${wrong.__status}`);
      assert.ok(!wrong.closed, `${what} as ${who} closed something`);
      await untouched();
    }

    // The one that matters: ANOTHER hospital's admin asking for THIS hospital's archive.
    const other = await call(OUTSIDER_ADMIN, { orderIds: ["sr-done-0"], cursor: 0 });
    assert.ok(other.__status === 403 || other.__status === 404, `${what} from another hospital: ${other.__status}`);
    assert.deepEqual(other.orderIds || [], [], `${what} handed another hospital order ids`);
    await untouched();
  }

  // The positive case, so the refusals above are about authority and not about the route being broken.
  const ok = await scan(ADMIN, { cursor: 0, limit: 5 });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.wouldClose, 5);
});
