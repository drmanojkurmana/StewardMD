/* test/wardsynq-source-order-close.test.mjs - closing the orders the SENDING system has finished
 * (functions/_wardsynq/source-order-close.js).
 *
 * An order that arrives from a laboratory information system lands as `draft`, because the ingest
 * door writes as an adapter actor and the adapter ceiling caps it there. That is correct and is not
 * changed here. What it leaves behind is an order that NOTHING can ever close if the result is
 * filed upstream: it sits in the open census for ever and walks the hospital towards the 5,000
 * ceiling at which the laboratory, specimen and imaging boards refuse.
 *
 * So: the sender's own word for the order travels beside it (`externalStatus`, set by the adapter),
 * and a LOCAL governed pass - never the adapter - closes the ones the sender has finished with. The
 * ones the sender still calls active stay exactly where they are, on the board, for a human.
 *
 * Routes: POST /api/queue/ward/source-order-scan, POST /api/queue/ward/source-order-close.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-source-order-close.test.mjs
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
const { BATCH_DEFAULT, verdictFor, sourceSaysFinished } = await import("../functions/_wardsynq/source-order-close.js");
const { SOURCE_TERMINAL_STATUSES } = await import("../functions/_wardsynq/service.js");
const { CLOSED_ORDER_STATUSES, OPEN_ORDER_STATUSES, closeOrderOnResult } = await import("../functions/_wardsynq/ward-order.js");
const { sccmAdapter } = await import("../wardsynq/adapters/wardsynq-sccm-adapter.js");
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
const scan = (who, body, org) => as(who, "/ward/source-order-scan", "POST", { orgId: org || ORG, ...(body || {}) });
const close = (who, body, org) => as(who, "/ward/source-order-close", "POST", { orgId: org || ORG, ...(body || {}) });
const collections = (who) => as(who, `/ward/collections?orgId=${ORG}&scope=hospital`);

const AT = "2026-09-01T08:00:00.000Z";
const LIS = "ghis-lis";
const meta = (system) => ({ recordedAt: AT, effectiveAt: AT, amendedAt: null, source: { system: system || "wardsynq-native", sourceId: null, importedAt: AT }, derivedFrom: [] });
const writtenBy = { id: "seed", kind: "human", at: AT };
const patient = (id) => ({ resourceType: "Patient", id, version: 1, mrn: "GH-" + id, name: "Patient " + id, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta(), writtenBy });
/** An order as the INGEST door leaves it: draft, owned by the sender, the sender's word beside it. */
const ingested = (id, externalStatus, over) => ({ resourceType: "ServiceRequest", id, version: 1, patientId: "pat-0", encounterId: null,
  code: "2823-3", display: "Potassium", category: "laboratory", priority: "routine", requesterId: `external:${LIS}`,
  status: "draft", externalStatus, meta: meta(LIS), writtenBy, ...(over || {}) });
/** This hospital's own order, which this pass must never touch: order-backfill.js closes those. */
const native = (id, over) => ({ resourceType: "ServiceRequest", id, version: 1, patientId: "pat-0", encounterId: null,
  code: "2823-3", display: "Potassium", category: "laboratory", priority: "routine", requesterId: "fb:doc", status: "active", meta: meta(), writtenBy, ...(over || {}) });

const PATIENTS = 6;
const FINISHED = BATCH_DEFAULT * 2 + 17;   // 217: three batches, the last one short
function seedArchive(repo) {
  const records = [];
  for (let i = 0; i < PATIENTS; i += 1) records.push(patient(`pat-${i}`));
  for (let i = 0; i < FINISHED; i += 1) {
    records.push(ingested(`sr-lis-done-${i}`, i % 3 === 0 ? "revoked" : "completed", { patientId: `pat-${i % PATIENTS}` }));
  }
  // The ones it must NOT touch, each for its own reason.
  records.push(ingested("sr-lis-open-1", "active", { patientId: "pat-1" }));       // the sender still owes it
  records.push(ingested("sr-lis-open-2", "unknown", { patientId: "pat-1" }));      // a word this system does not know
  records.push(ingested("sr-lis-open-3", null, { patientId: "pat-2" }));           // the sender said nothing
  records.push(native("sr-native-1", { patientId: "pat-3" }));                     // this hospital's own
  return repo.append(T, records, {});
}

async function runBatch(cursor, limit) {
  const s = await scan(ADMIN, { cursor, ...(limit ? { limit } : {}) });
  assert.equal(s.__status, 200, JSON.stringify(s));
  const c = s.orderIds.length ? await close(ADMIN, { orderIds: s.orderIds }) : { closed: 0, __status: 200 };
  assert.equal(c.__status, 200, JSON.stringify(c));
  return { s, c };
}

/* ---- 1: ingest keeps the sender's word, and keeps it non-authoritative -------------------------- */

test("an ingested order the sender calls completed lands as draft with the sender's word beside it", async () => {
  const mapped = await sccmAdapter().normalise({
    sccmVersion: "1.1",
    meta: { sourceConnector: LIS, tenantId: T, generatedAt: AT },
    patient: { id: "p1", mrn: "GH-1", name: "A Patient", birthDate: "1959-02-14", gender: "female" },
    serviceRequests: [
      { id: "ORD-1", code: { coding: [{ code: "2823-3", display: "Potassium", system: "http://loinc.org" }] }, category: { coding: [{ code: "laboratory" }] }, status: "completed", priority: "routine" },
      { id: "ORD-2", code: { coding: [{ code: "2823-3", display: "Potassium", system: "http://loinc.org" }] }, category: { coding: [{ code: "laboratory" }] }, status: "active", priority: "routine" },
    ],
  });
  const orders = (mapped.entities || []).filter((e) => e.resourceType === "ServiceRequest");
  assert.equal(orders.length, 2);
  for (const o of orders) {
    assert.equal(o.status, "draft", "the adapter ceiling is untouched: an adapter never asserts a clinical status");
    assert.equal(o.meta.source.system, LIS, "the record says which system sent it");
  }
  assert.equal(orders[0].externalStatus, "completed", "the sender's own word is preserved beside the order");
  assert.equal(orders[1].externalStatus, "active");
  // And that word is what this pass reads - never the record's own status.
  assert.equal(sourceSaysFinished(orders[0]), true);
  assert.equal(sourceSaysFinished(orders[1]), false);
  // One vocabulary for "finished", spelled in two files that cannot import each other.
  assert.deepEqual([...SOURCE_TERMINAL_STATUSES], [...CLOSED_ORDER_STATUSES]);
});

/* ---- 2: the pass closes them, across several runs, and they leave the boards -------------------- */

test("orders the sending system has finished are closed across several runs and leave the boards", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);

  /* The symptom, as the CODE has it rather than as the audit described it: an ingested order is
   * filtered off the ward's own boards (specimen.js and lab-result.js both drop isExternalRecord,
   * so a phlebotomist is never sent to bleed for another system's order), but it is `draft`, which
   * is an OPEN status, so it counts against the open census for ever. That census is what refuses
   * (OPEN_CENSUS_MAX, 5,000) and takes the boards down with it. */
  const census = async () => (await repo.pageByType(T, "ServiceRequest", { afterSeq: 0, limit: 2000, statuses: OPEN_ORDER_STATUSES })).records.length;
  assert.equal(await census(), FINISHED + 4, "every ingested order is still open, finished or not");
  const before = await collections(LAB);
  assert.equal(before.__status, 200, JSON.stringify(before));
  assert.deepEqual(before.requests.map((r) => r.serviceRequestId), ["sr-native-1"], "an ingested order was never on this ward's collection board");

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
  assert.equal(closed, FINISHED, "every order the sender has finished was closed, and none of the others");
  assert.equal(scanned, FINISHED + 4, "every open order was looked at exactly once");
  assert.equal(stayed.source_active, 3, "active, unknown and unsaid all stay open");
  assert.equal(stayed.native_order, 1, "this hospital's own order belongs to the result path, not to this one");

  // Append-only, and the audit trail says the assertion came from outside.
  const one = await repo.latest(T, "ServiceRequest", "sr-lis-done-1");
  assert.equal(one.status, "completed");
  assert.equal(one.version, 2);
  assert.equal(one.completedOn, "source-terminal");
  assert.equal(one.completedBy, idFor(ADMIN), "the person who ran it is on the record");
  assert.equal(one.externalStatus, "completed", "the sender's word is still there, still beside the order");
  assert.equal(one.meta.source.system, LIS, "the record still says which system owns it");

  // The census is now the work still owed, and the ward's own board is exactly as it was.
  assert.equal(await census(), 4, "only the orders somebody still owes are open");
  const after = await collections(LAB);
  assert.equal(after.__status, 200, JSON.stringify(after));
  assert.deepEqual(after.requests.map((r) => r.serviceRequestId), ["sr-native-1"], "closing another system's finished orders changed nothing clinical on this ward");
});

/* ---- 3: an order the sender still calls active is never touched --------------------------------- */

test("an order whose sender says it is still active is not closed, even when it is named directly", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);

  const c = await close(ADMIN, { orderIds: ["sr-lis-open-1", "sr-lis-open-2", "sr-lis-open-3", "sr-native-1"] });
  assert.equal(c.__status, 200, JSON.stringify(c));
  assert.equal(c.closed, 0);
  assert.equal(c.written, 0);
  assert.equal(c.reasons.source_active, 3);
  assert.equal(c.reasons.native_order, 1);
  for (const id of ["sr-lis-open-1", "sr-lis-open-2", "sr-lis-open-3", "sr-native-1"]) {
    assert.equal((await repo.latest(T, "ServiceRequest", id)).version, 1, `${id} was written to`);
  }

  // The dry run writes nothing at all, and says so.
  const s = await scan(ADMIN, { cursor: 0, limit: 10 });
  assert.equal(s.run, "dry-run");
  assert.equal(s.written, 0);
  assert.equal(s.orders.length, s.wouldClose);
  assert.ok(s.orders.every((o) => o.system === LIS && ["completed", "revoked"].includes(o.sourceStatus)), "the screen is told whose word it is acting on");
  assert.equal((await repo.latest(T, "ServiceRequest", "sr-lis-done-0")).version, 1);
});

/* ---- 4: a second run writes nothing ------------------------------------------------------------- */

test("a second run of the same job finds nothing to do and rewrites nothing", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);

  let cursor = 0, done = false, guard = 0;
  const firstIds = [];
  while (!done && guard++ < 20) { const { s } = await runBatch(cursor); firstIds.push(...s.orderIds); cursor = s.nextCursor; done = s.done; }
  const versionAfterFirst = (await repo.latest(T, "ServiceRequest", "sr-lis-done-5")).version;
  assert.equal(versionAfterFirst, 2);

  cursor = 0; done = false; guard = 0;
  let wouldClose = 0, scanned = 0;
  while (!done && guard++ < 20) {
    const s = await scan(ADMIN, { cursor });
    assert.equal(s.__status, 200, JSON.stringify(s));
    wouldClose += s.wouldClose; scanned += s.scanned; cursor = s.nextCursor; done = s.done;
  }
  assert.equal(wouldClose, 0, "nothing is left to close");
  assert.equal(scanned, 4, "only the orders that stay open are still met");

  const again = await close(ADMIN, { orderIds: firstIds.slice(0, 40) });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal(again.closed, 0);
  assert.equal(again.written, 0);
  assert.equal(again.reasons.already_closed, 40, "an order already closed is skipped by name, never rewritten");
  assert.equal((await repo.latest(T, "ServiceRequest", "sr-lis-done-5")).version, versionAfterFirst, "no second version was appended");
});

/* ---- 5: a failed read is a failure, never "nothing left" ---------------------------------------- */

test("a page that could not be read is reported as a failure and never as the end of the job", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  repo.pageByType = async () => { throw new Error("the record store is unreachable"); };

  const s = await scan(ADMIN, { cursor: 0 });
  assert.equal(s.__status, 502, JSON.stringify(s));
  assert.equal(s.error, "record_read_failed");
  assert.notEqual(s.done, true, "a failed read must never read as 'there is nothing left'");
  assert.deepEqual(s.orderIds, []);
});

/* ---- 6: the authority exception is exactly one write, by exactly one role ----------------------- */

test("only the source-terminal closure gets past external authority, and only for a terminal sender", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  const deps = { repository: repo, pseudonym: async () => null, tenant: { id: T }, actorId: idFor(ADMIN) };
  const read = (id) => repo.latest(T, "ServiceRequest", id);

  // The result path (roleSource wardsynq-result-filed) may not close another system's order.
  const viaResult = await closeOrderOnResult({ ...deps, on: "result" }, await read("sr-lis-done-2"));
  assert.equal(viaResult.closed, false, "the ordinary closure is still refused on an externally owned order");
  assert.equal((await read("sr-lis-done-2")).version, 1);

  // The backfill path is refused for the same reason: it closes on a filed result, not on a claim.
  const viaBackfill = await closeOrderOnResult({ ...deps, on: "backfill" }, await read("sr-lis-done-2"));
  assert.equal(viaBackfill.closed, false);
  assert.equal((await read("sr-lis-done-2")).version, 1);

  // The source-terminal path closes it, and nothing else on the record moves.
  const before = await read("sr-lis-done-2");
  const ok = await closeOrderOnResult({ ...deps, on: "source-terminal" }, before);
  assert.equal(ok.closed, true, ok.reason || "");
  const after = await read("sr-lis-done-2");
  assert.equal(after.status, "completed");
  for (const k of ["code", "display", "category", "priority", "patientId", "requesterId", "externalStatus"]) {
    assert.deepEqual(after[k], before[k], `${k} changed on a closure that may only change the status`);
  }

  // And an order whose sender has NOT finished is refused even down that path.
  const stillOpen = await read("sr-lis-open-1");
  const refused = await closeOrderOnResult({ ...deps, on: "source-terminal" }, stillOpen);
  assert.equal(refused.closed, false, "the sender still calls it active; no local pass may close it");
  assert.equal((await read("sr-lis-open-1")).version, 1);
  assert.equal(verdictFor(stillOpen), "source_active");
});

/* ---- 7: authorisation on both new routes -------------------------------------------------------- */

test("no session, the wrong role and another hospital are all refused on both source-closure routes", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await seedArchive(repo);
  const untouched = async () => assert.equal((await repo.latest(T, "ServiceRequest", "sr-lis-done-0")).version, 1, "nothing was written by a refused call");

  for (const [what, call] of [["source-order-scan", scan], ["source-order-close", close]]) {
    const anon = await call(null, { orderIds: ["sr-lis-done-0"], cursor: 0 });
    assert.equal(anon.__status, 401, `${what} with no session: ${anon.__status}`);
    await untouched();

    for (const who of [CASHIER, LAB]) {
      const wrong = await call(who, { orderIds: ["sr-lis-done-0"], cursor: 0 });
      assert.ok(wrong.__status === 403 || wrong.__status === 404, `${what} as ${who}: ${wrong.__status}`);
      assert.ok(!wrong.closed, `${what} as ${who} closed something`);
      await untouched();
    }

    const other = await call(OUTSIDER_ADMIN, { orderIds: ["sr-lis-done-0"], cursor: 0 });
    assert.ok(other.__status === 403 || other.__status === 404, `${what} from another hospital: ${other.__status}`);
    assert.deepEqual(other.orderIds || [], [], `${what} handed another hospital order ids`);
    await untouched();
  }

  const ok = await scan(ADMIN, { cursor: 0, limit: 5 });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.wouldClose, 5);
});
