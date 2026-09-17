/* test/wardsynq-status-scoped-worklists.test.mjs - R5-2: a worklist reads what is OPEN.
 *
 * The laboratory, specimen and imaging boards each read EVERY ServiceRequest the hospital had ever
 * held (and, on two of them, every DiagnosticReport or every specimen beside it) and threw the
 * finished ones away in JavaScript. That is a cost that grows with the archive rather than with the
 * work: a hospital placing hundreds of orders a day reached tens of thousands of parsed records in
 * one Worker within weeks, and the screen then failed with a 500 or a hang - before the designed
 * 50,000 ceiling and so without the designed message.
 *
 * So these tests seed MORE finished orders than that old ceiling and prove the boards still show
 * today's work. They would not have passed before: at 60,000 the old read threw ListCeilingError and
 * every one of these screens answered 503.
 *
 * The other half is that NOTHING MAY VANISH. An open-status read is only safe if the open vocabulary
 * is complete, so there is a test per status word, and the two ceiling tests prove a backlog past the
 * open census is still refused out loud rather than shown short.
 *
 * Both adapters. The memory adapter carries a smaller archive only because seeding it is quadratic
 * (37s for 60,000, 0.4s for 6,000); 6,000 is already past the 5,000 open-census ceiling, which is the
 * thing being proven - finished orders do not count against it.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-status-scoped-worklists.test.mjs
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
const { OPEN_ORDER_STATUSES, CLOSED_ORDER_STATUSES } = await import("../functions/_wardsynq/ward-order.js");
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
      claimsFn: async (request) => (String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase() === DOCTOR ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq", OTHER_ORG = "org-other", T = TENANT_ROW.id;
const DOCTOR = "doctor@example.test", LAB = "lab@example.test", CASHIER = "cashier@example.test", OUTSIDER = "outsider@example.test", ADMIN = "admin@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const sqliteRepo = () => new D1Repository(openSqlite({ DatabaseSync, readSchema: (n) => readFileSync(new URL(n === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8") }, { path: ":memory:" }).binding);
/* [name, factory, skip, archive]: how many FINISHED orders sit behind today's work. */
const ADAPTERS = [["memory", () => new MemoryRepository(), false, 6000], ["sqlite", sqliteRepo, NO_SQLITE, 60000]];

function seedHospital(repo) {
  docs.clear(); clock = 1;
  RECORD = repo;
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: T, ownerUid: idFor(ADMIN), createdAt: 1,
    wardsynq: { dicom: { modalityMap: { "CT-ABDO": "CT" } } } }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OUTSIDER), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role, org] of [[DOCTOR, "doctor", ORG], [ADMIN, "admin", ORG], [LAB, "lab", ORG], [CASHIER, "cashier", ORG], [OUTSIDER, "doctor", OTHER_ORG]]) {
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
const pendingTests = (who, org) => as(who, `/ward/pending-tests?orgId=${org || ORG}&scope=hospital`);
const collections = (who, org) => as(who, `/ward/collections?orgId=${org || ORG}&scope=hospital`);
const imaging = (who, org) => as(who, `/ward/imaging-worklist?orgId=${org || ORG}`);

const AT = "2026-09-01T08:00:00.000Z";
const meta = () => ({ recordedAt: AT, effectiveAt: AT, amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: AT }, derivedFrom: [] });
const writtenBy = { id: "seed", kind: "human", at: AT };
const order = (id, status, over) => ({ resourceType: "ServiceRequest", id, version: 1, patientId: "pat-1", encounterId: null,
  code: "2823-3", display: "Potassium", category: "laboratory", priority: "routine", requesterId: "fb:doc", status, meta: meta(), writtenBy, ...(over || {}) });
const patient = (id, mrn, name) => ({ resourceType: "Patient", id, version: 1, mrn, name, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta(), writtenBy });

/** The archive: finished orders written straight to the store, in batches so the SQL batch stays small. */
async function seedFinished(repo, count) {
  for (let i = 0; i < count; i += 500) {
    const n = Math.min(500, count - i);
    await repo.append(T, Array.from({ length: n }, (_, k) => order(`sr-done-${i + k}`, "completed", { patientId: `pat-old-${(i + k) % 40}` })), {});
  }
}

/* ---- 1: the boards still show today's work behind an archive past the old ceiling ---------------- */

for (const [name, make, skip, archive] of ADAPTERS) {
  test(`${name}: ${archive} finished orders behind it, and the lab, specimen and imaging boards still show today's work`, { skip }, async () => {
    const repo = make();
    seedHospital(repo);
    await seedFinished(repo, archive);
    await repo.append(T, [
      patient("pat-1", "GH-1", "Anjali Menon"),
      order("sr-live-1", "active"),
      order("sr-live-2", "active", { code: "2951-2", display: "Sodium" }),
      order("sr-scan-1", "active", { category: "imaging", code: "CT-ABDO", display: "CT abdomen" }),
    ], {});

    const lab = await pendingTests(LAB);
    assert.equal(lab.__status, 200, JSON.stringify(lab));
    assert.deepEqual(lab.pending.map((p) => p.serviceRequestId).sort(), ["sr-live-1", "sr-live-2", "sr-scan-1"],
      "every order still owed is on the bench list, and not one of the finished ones");

    const coll = await collections(LAB);
    assert.equal(coll.__status, 200, JSON.stringify(coll));
    assert.deepEqual(coll.requests.map((r) => r.serviceRequestId).sort(), ["sr-live-1", "sr-live-2", "sr-scan-1"]);
    assert.equal(coll.awaitingCollection, 3, "nobody has been to any of them yet, and the board says so");

    const scan = await imaging(DOCTOR);
    assert.equal(scan.__status, 200, JSON.stringify(scan));
    assert.equal(scan.count, 1);
    assert.equal(scan.worklist[0]["00080050"].Value[0], "sr-scan-1");
  });

  /* ---- 2: NOTHING VANISHES - a status the read did not ask for is an order off every board -------- */

  test(`${name}: every open status is still on the board, and only the closed words take an order off it`, { skip }, async () => {
    const repo = make();
    seedHospital(repo);
    await repo.append(T, [patient("pat-1", "GH-1", "Anjali Menon"),
      ...OPEN_ORDER_STATUSES.map((s, i) => order(`sr-open-${i}`, s)),
      ...CLOSED_ORDER_STATUSES.map((s, i) => order(`sr-shut-${i}`, s))], {});

    const lab = await pendingTests(LAB);
    assert.equal(lab.__status, 200, JSON.stringify(lab));
    assert.deepEqual(lab.pending.map((p) => p.serviceRequestId).sort(), OPEN_ORDER_STATUSES.map((_, i) => `sr-open-${i}`).sort(),
      "an order in a status nobody enumerated would disappear off the bench silently; none did");
    const coll = await collections(LAB);
    assert.equal(coll.requests.length, OPEN_ORDER_STATUSES.length);
  });

  /* ---- 3: past the open census it REFUSES, out loud, rather than showing a short board ------------ */

  test(`${name}: a backlog past the open census is a visible refusal, never a short worklist`, { skip }, async () => {
    const repo = make();
    seedHospital(repo);
    await repo.append(T, [patient("pat-1", "GH-1", "Anjali Menon")], {});
    for (let i = 0; i < 5001; i += 500) {
      const n = Math.min(500, 5001 - i);
      await repo.append(T, Array.from({ length: n }, (_, k) => order(`sr-stale-${i + k}`, "active")), {});
    }
    for (const r of [await pendingTests(LAB), await collections(LAB)]) {
      assert.equal(r.__status, 503, JSON.stringify(r));
      assert.equal(r.error, "too_many_open");
      assert.match(String(r.detail), /refused rather than shortened/);
      assert.deepEqual(r.pending || r.requests, [], "a refusal answers with nothing, never with a partial board");
    }
  });
}

/* ---- 4: the order closes when its result is filed, which is what keeps the board bounded ---------- */

test("releasing a result closes the order it answers, and the order leaves both boards", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  // A procedure carries no sample, so this exercises the closure without a collection step first.
  await repo.append(T, [patient("pat-1", "GH-1", "Anjali Menon"), order("sr-proc-1", "active", { category: "procedure", code: "ECG", display: "ECG" })], {});
  assert.equal((await pendingTests(LAB)).pending.length, 1, "it is owed before the result");

  const rel = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: "sr-proc-1", status: "final", tests: [{ test: "Potassium", value: 4.1, unit: "mmol/L" }] });
  assert.equal(rel.__status, 200, JSON.stringify(rel));
  assert.equal(rel.orderClosed, true, "the response says what happened to the order, rather than leaving it to be guessed");
  assert.equal(rel.orderCloseFailed, undefined);

  const closed = await repo.latest(T, "ServiceRequest", "sr-proc-1");
  assert.equal(closed.status, "completed");
  assert.equal(closed.version, 2, "append-only: the order is a new version, not an overwrite");
  assert.equal(closed.completedOn, "result");
  assert.deepEqual((await pendingTests(LAB)).pending, []);
  assert.deepEqual((await collections(LAB)).requests, []);
});

/* ---- 5: authorisation on every read that changed ------------------------------------------------- */

test("no session, the wrong role and another hospital are all refused on the reads that changed", async () => {
  const repo = new MemoryRepository();
  seedHospital(repo);
  await repo.append(T, [patient("pat-1", "GH-1", "Anjali Menon"), order("sr-live-1", "active"),
    order("sr-scan-1", "active", { category: "imaging", code: "CT-ABDO", display: "CT abdomen" })], {});

  for (const [what, call] of [["pending-tests", pendingTests], ["collections", collections], ["imaging-worklist", imaging]]) {
    const anon = await call(null);
    assert.ok(anon.__status === 401 || anon.__status === 403, `${what} with no session: ${anon.__status}`);
    const wrong = await call(CASHIER);
    assert.ok(wrong.__status === 403 || wrong.__status === 404, `${what} as a cashier: ${wrong.__status}`);
    // The one that matters: a doctor of ANOTHER hospital asking for THIS hospital's board.
    const other = await call(OUTSIDER, ORG);
    assert.ok(other.__status === 403 || other.__status === 404, `${what} from another hospital: ${other.__status}`);
    assert.equal((other.pending || other.requests || other.worklist || []).length, 0, `${what} handed another hospital nothing`);
  }
});
