/* test/wardsynq-repository-paging.test.mjs - R4-1 census-by-status.
 *
 * Every roster read was capped at 1,000 records, OLDEST first, silently: past that the newest admission was
 * the one missing from the ward list and the one a bed check did not see. This proves the open census reads
 * every open stay however much closed history exists, a double booking is still refused, the whole-type read
 * pages to the end or says it did not, and a refusal is still a refusal. Memory and on-premise SQL adapters.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-repository-paging.test.mjs
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

const ORG = "org-wsq", OTHER_ORG = "org-other";
const DOCTOR = "doctor@example.test", PHARM = "pharmacy@example.test", OUTSIDER = "outsider@example.test", ADMIN = "admin@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
const T = TENANT_ROW.id;

const sqliteRepo = () => new D1Repository(openSqlite({ DatabaseSync, readSchema: (n) => readFileSync(new URL(n === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8") }, { path: ":memory:" }).binding);
const ADAPTERS = [["memory", () => new MemoryRepository(), false], ["sqlite", sqliteRepo, NO_SQLITE]];

function seedHospital(repo) {
  docs.clear(); clock = 1;
  RECORD = repo;
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: T, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OUTSIDER), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role, org] of [[DOCTOR, "doctor", ORG], [ADMIN, "admin", ORG], [PHARM, "pharmacy", ORG], [OUTSIDER, "doctor", OTHER_ORG]]) {
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
const AT = "2026-09-01T08:00:00.000Z";
const enc = (id, status, bed, over) => ({ resourceType: "Encounter", id, version: 1, patientId: `pat-${id}`, class: "IPD", status, location: { ward: "Medical A", bed },
  periodStart: AT, meta: { recordedAt: AT }, writtenBy: { id: "seed", kind: "human", at: AT }, ...(over || {}) });
/* Closed history written straight to the store, in batches of 500 so the SQL batch stays small. */
async function seedClosed(repo, count, prefix) {
  const rows = Array.from({ length: count }, (_, i) => enc(`${prefix}-${i}`, "finished", String(100 + (i % 50))));
  for (let i = 0; i < rows.length; i += 500) await repo.append(T, rows.slice(i, i + 500), {});
}
let n = 0;
async function register(name) {
  n += 1;
  return as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name, mobile: "98765" + String(10000 + n).slice(-5), gender: "female", ageYears: 40 });
}

function service(repo, actorSpec) {
  return new RecordService({ repository: repo, pseudonym: async () => null, tenant: { id: T, name: "Test", mode: "live" },
    actor: makeActor({ id: "fb:dr-a", kind: KIND.HUMAN, tier: TIER.EXECUTE, display: "Dr A", credential: "held-by-server", ...(actorSpec || {}) }), role: "doctor", roleSource: "opd" });
}

/* ---- the port and the service --------------------------------------------------------------------- */

for (const [name, make, skip] of ADAPTERS) {
  test(`${name}: listAll reads 2,345 records across 3 pages; past max it flags truncated or throws as asked`, { skip }, async () => {
    const repo = make();
    const rows = Array.from({ length: 2345 }, (_, i) => enc(`all-${i}`, i % 2 ? "finished" : "in-progress", "1"));
    for (let i = 0; i < rows.length; i += 500) await repo.append(T, rows.slice(i, i + 500), {});
    // One record amended after it was first written: met once, at its latest version.
    await repo.append(T, [{ ...rows[3], version: 2, status: "finished" }], {});

    const p1 = await repo.pageByType(T, "Encounter", { afterSeq: 0, limit: 1000 });
    assert.equal(p1.records.length, 1000);
    assert.ok(p1.next != null, "a full page names the cursor for the next");

    const svc = service(repo);
    const all = await svc.listAll("Encounter");
    assert.equal(all.truncated, false);
    assert.equal(all.rows.length, 2345);
    assert.equal(new Set(all.rows.map((r) => r.id)).size, 2345, "no record twice");
    assert.equal(all.rows.find((r) => r.id === "all-3").version, 2);
    assert.equal(all.rows[all.rows.length - 1].id, "all-3", "oldest first by latest write, so the amended one is last");

    const capped = await svc.listAll("Encounter", { max: 2000 });
    assert.equal(capped.truncated, true);
    assert.equal(capped.rows.length, 2000);
    await assert.rejects(svc.listAll("Encounter", { max: 2000, throwOnTruncate: true }), (e) => e instanceof ListCeilingError && e.code === "too_many_records");
  });

  test(`${name}: listByStatus returns every open record behind 1,500 closed ones, and refuses past its ceiling`, { skip }, async () => {
    const repo = make();
    await seedClosed(repo, 1500, "old");
    await repo.append(T, [enc("open-1", "in-progress", "1"), enc("open-2", "in-progress", "2"), enc("plan-1", "planned", "3")], {});
    const svc = service(repo);
    const open = await svc.listByStatus("Encounter", ["in-progress"]);
    assert.deepEqual(open.map((e) => e.id).sort(), ["open-1", "open-2"]);
    assert.equal((await svc.listByStatus("Encounter", ["in-progress", "planned"])).length, 3);
    // A record closed after it was read open is no longer in the census.
    await repo.append(T, [{ ...enc("open-2", "finished", "2"), version: 2 }], {});
    assert.deepEqual((await svc.listByStatus("Encounter", ["in-progress"])).map((e) => e.id), ["open-1"]);
    // Past the ceiling it throws, never a short census.
    await assert.rejects(svc.listByStatus("Encounter", ["in-progress", "planned"], 1), (e) => e instanceof ListCeilingError && e.code === "too_many_open");
    // Governed exactly as list(): no read scope on the type is a GovernanceError, and nothing is read.
    const denied = service(repo, { scope: { read: ["Patient"] } });
    await assert.rejects(denied.listByStatus("Encounter", ["in-progress"]), (e) => e instanceof GovernanceError);
    await assert.rejects(denied.listAll("Encounter"), (e) => e instanceof GovernanceError);
  });
}

test("a store without pageByType refuses the census rather than falling back to a capped roster", async () => {
  const repo = new MemoryRepository();
  repo.pageByType = undefined;
  await assert.rejects(service(repo).listByStatus("Encounter", ["in-progress"]), /cannot page/);
});

/* ---- the routes ------------------------------------------------------------------------------------ */

for (const [name, make, skip] of ADAPTERS) {
  test(`${name}: GET /api/queue/ward/list shows an admission made after 1,500 discharged stays, named`, { skip }, async () => {
    seedHospital(make());
    const reg = await register("Census Newest");
    // The admitted patient is older than the newest 1,000 patients, so the name comes from a read by id.
    const filler = Array.from({ length: 1005 }, (_, i) => ({ resourceType: "Patient", id: `filler-${i}`, version: 1, name: `Filler ${i}`, meta: { recordedAt: AT }, writtenBy: { id: "seed", kind: "human", at: AT } }));
    for (let i = 0; i < filler.length; i += 500) await RECORD.append(T, filler.slice(i, i + 500), {});
    await seedClosed(RECORD, 1500, "hist");
    const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical B", bed: "4" });
    assert.equal(adm.__status, 200, JSON.stringify(adm));

    const list = await as(DOCTOR, `/ward/list?orgId=${ORG}`);
    assert.equal(list.__status, 200, JSON.stringify(list).slice(0, 300));
    const row = list.patients.find((p) => p.encounterId === adm.encounterId);
    assert.ok(row, "the newest admission is on the ward list");
    assert.equal(row.name, "Census Newest");
    assert.equal(list.patients.length, 1, "discharged stays are not");
    assert.equal(list.partial, undefined);

    // Negative authorization on the changed route.
    assert.equal((await as(null, `/ward/list?orgId=${ORG}`)).__status, 401);
    const pharm = await as(PHARM, `/ward/list?orgId=${ORG}`);
    assert.equal(pharm.__status, 403);
    assert.deepEqual(pharm.reasons, ["READ_SCOPE_DENIED"]);
    assert.equal((await as(OUTSIDER, `/ward/list?orgId=${ORG}`)).__status, 403);
  });

  test(`${name}: POST /api/queue/ward/admit and /ward/transfer refuse a bed held by the open stay written after 1,200 closed ones`, { skip }, async () => {
    seedHospital(make());
    await seedClosed(RECORD, 1200, "hist");
    // Stay number 1,201: open in Medical A bed 7, written with no bed claim (a migrated or imported stay),
    // so only the census can see it.
    await RECORD.append(T, [enc("legacy-1201", "in-progress", "7")], {});

    const regA = await register("Census Double A");
    const refused = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "Medical A", bed: "7" });
    assert.equal(refused.__status, 409, JSON.stringify(refused));
    assert.equal(refused.error, "bed_occupied");
    assert.equal(refused.written, 0);

    const regB = await register("Census Double B");
    const admB = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "Medical A", bed: "8" });
    assert.equal(admB.__status, 200, JSON.stringify(admB));
    const moved = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: admB.encounterId, ward: "Medical A", bed: "7" });
    assert.equal(moved.__status, 409, JSON.stringify(moved));
    assert.equal(moved.error, "bed_occupied");
    assert.equal(moved.occupiedBy.encounterId, "legacy-1201");
    assert.equal((await RECORD.latest(T, "Encounter", admB.encounterId)).location.bed, "8", "nothing moved");

    // Negative authorization: no session, a role that may not write the record, another hospital.
    assert.equal((await as(null, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "Medical A", bed: "9" })).__status, 401);
    assert.equal((await as(PHARM, "/ward/transfer", "POST", { orgId: ORG, encounterId: admB.encounterId, ward: "Medical A", bed: "9" })).__status, 403);
    assert.equal((await as(OUTSIDER, "/ward/transfer", "POST", { orgId: ORG, encounterId: admB.encounterId, ward: "Medical A", bed: "9" })).__status, 403);
    assert.equal((await RECORD.latest(T, "Encounter", admB.encounterId)).location.bed, "8", "and still nothing moved");
  });
}

test("a census past the service ceiling refuses the admission (503 too_many_open), it does not admit on a short read", async () => {
  seedHospital(new MemoryRepository());
  const reg = await register("Census Ceiling");
  const real = RECORD.pageByType.bind(RECORD);
  // 5,001 open stays, answered as six pages without writing them all.
  RECORD.pageByType = async (t, type, opts) => {
    if (type !== "Encounter" || !opts.statuses) return real(t, type, opts);
    const from = Number(opts.afterSeq) || 0, size = Math.min(1000, 5001 - from);
    return { records: Array.from({ length: size }, (_, i) => enc(`many-${from + i}`, "in-progress", String(1000 + from + i))), next: from + size < 5001 ? from + size : null };
  };
  const r = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "1" });
  assert.equal(r.__status, 503, JSON.stringify(r));
  assert.equal(r.error, "too_many_open");
  assert.equal(r.written, 0);
  const list = await as(DOCTOR, `/ward/list?orgId=${ORG}`);
  assert.equal(list.__status, 503);
  assert.equal(list.error, "too_many_open");
});
