/* test/wardsynq-audit-chain.test.mjs - P2.17 immutable audit retention: the hash chain over the
 * clinical audit trail, the database triggers, verification, the retention setting, and where they
 * surface (GET /api/queue/ward/security-report, GET /api/queue/ward/system-health, the Admin screen).
 *
 * The chain is exercised on MemoryRepository AND on the real D1Repository over a real SQLite database
 * with the shipped schema files, because a trigger or a primary key that is only described is not one.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-audit-chain.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let DatabaseSync = null, why = "";
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { why = String(e && e.message); }
const SQL_SKIP = DatabaseSync ? false : `node:sqlite unavailable (${why})`;

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

const { MemoryRepository, VersionConflictError } = await import("../functions/_wardsynq/repository.js");
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

const AC = await import("../functions/_wardsynq/audit-chain.js");
const { D1Repository } = await import("../functions/_wardsynq/repository-d1.js");
const { openSqlite } = await import("../functions/_wardsynq/repository-sqlite.js");
const SR = await import("../functions/_wardsynq/security-review.js");
const { wardsynqConfig } = await import("../functions/_opd_org.js").then((m) => ({ wardsynqConfig: m.wardsynqConfig || null }), () => ({ wardsynqConfig: null }));
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const T = "tenant-chain";
const rec = (id, version, over) => ({ resourceType: "Observation", id, version, patientId: "pat-1", meta: { recordedAt: "2026-09-14T08:00:00.000Z" }, writtenBy: { id: "cfa:dr", kind: "human" }, ...(over || {}) });
const ev = (action, i) => ({ ts: `2026-09-14T08:00:${String(i).padStart(2, "0")}.000Z`, actor: "cfa:dr", connectorId: "wardsynq", action, scope: { resourceType: "Observation", n: i }, outcome: "ok" });

const readSchema = (name) => readFileSync(new URL(name === "connect" ? "../db/connect_schema.sql" : "../functions/db/wardsynq_schema.sql", import.meta.url), "utf8");
function sqlRepo() {
  const { db, binding } = openSqlite({ DatabaseSync, readSchema }, { path: ":memory:" });
  return { db, binding, repo: new D1Repository(binding) };
}

/* ---- 1: append then verify ------------------------------------------------------------------------ */

test("append then verify is ok, on memory and on real SQL, and every link follows the one before", async () => {
  const mem = new MemoryRepository();
  await mem.append(T, [rec("o1", 1)], { audit: ev("record.write", 1) });
  await mem.append(T, [rec("o1", 2)], { audits: [ev("record.write", 2), ev("record.write", 3)] });
  await mem.auditOnly(T, ev("record.read", 4));
  await mem.auditOnly("another-tenant", ev("record.read", 5));
  const v = await AC.verifyAuditChain(mem, T);
  assert.equal(v.status, "ok", JSON.stringify(v));
  assert.equal(v.checked, 4);
  assert.equal(v.headSeq, 4);
  assert.match(v.message, /Intact: all 4 chained rows checked/);
  assert.equal((await AC.verifyAuditChain(mem, "another-tenant")).headSeq, 1, "each hospital has its own chain");
  assert.equal((await AC.verifyAuditChain(mem, "nobody")).status, "empty");

  const bounded = await AC.verifyAuditChain(mem, T, { limit: 2 });
  assert.equal(bounded.status, "ok");
  assert.deepEqual([bounded.fromSeq, bounded.toSeq, bounded.checked], [3, 4, 2], "a bounded window is the newest rows, and says so");
  assert.match(bounded.message, /rows 3 to 4 of 4/);

  if (SQL_SKIP) return;
  const { db, repo } = sqlRepo();
  await repo.append(T, [rec("o1", 1)], { audit: ev("record.write", 1) });
  await repo.append(T, [rec("o1", 2)], { audits: [ev("record.write", 2), ev("record.write", 3)] });
  await repo.auditOnly(T, { ...ev("record.read", 4), latencyMs: 12, patientRefHash: "ref-x" });
  const s = await AC.verifyAuditChain(repo, T);
  assert.equal(s.status, "ok", JSON.stringify(s));
  assert.equal(s.checked, 4);
  const links = db.prepare("SELECT chain_seq, prev_hash, row_hash FROM wardsynq_audit_chain WHERE tenant_id=? ORDER BY chain_seq").all(T);
  assert.deepEqual(links.map((l) => l.chain_seq), [1, 2, 3, 4]);
  for (let i = 1; i < links.length; i++) assert.equal(links[i].prev_hash, links[i - 1].row_hash);
  assert.equal(links[0].prev_hash, AC.genesisHash(null), "link 1 of an empty trail follows the genesis with no legacy boundary");
});

/* ---- 2: a mutated row is found at that row --------------------------------------------------------- */

test("a changed audit row is detected at that row (memory), and on real SQL once the trigger is bypassed", async () => {
  const mem = new MemoryRepository();
  for (let i = 1; i <= 5; i++) await mem.auditOnly(T, ev("record.read", i));
  mem.audit[2].action = "record.list";                        // the third row, chain_seq 3
  const v = await AC.verifyAuditChain(mem, T);
  assert.equal(v.status, "broken", JSON.stringify(v));
  assert.equal(v.atSeq, 3);
  assert.ok(v.expected && v.found && v.expected !== v.found, "expected vs found hashes are reported");
  assert.match(v.message, /Broken at chained row 3/);

  if (SQL_SKIP) return;
  const { db, repo } = sqlRepo();
  for (let i = 1; i <= 5; i++) await repo.auditOnly(T, ev("record.read", i));
  const ids = db.prepare("SELECT audit_id FROM wardsynq_audit_chain WHERE tenant_id=? ORDER BY chain_seq").all(T).map((r) => r.audit_id);
  assert.throws(() => db.prepare("UPDATE connect_audit_event SET actor='cfa:someone-else' WHERE id=?").run(ids[3]), /audit rows are immutable/);
  assert.equal((await AC.verifyAuditChain(repo, T)).status, "ok", "the refused UPDATE changed nothing");
  db.exec("DROP TRIGGER connect_audit_event_no_update");        // what a console, a script or a restore can do
  db.prepare("UPDATE connect_audit_event SET actor='cfa:someone-else' WHERE id=?").run(ids[3]);
  const s = await AC.verifyAuditChain(repo, T);
  assert.equal(s.status, "broken", JSON.stringify(s));
  assert.equal(s.atSeq, 4);
  assert.equal(s.auditId, ids[3]);
});

/* ---- 3: a deleted row is a gap -------------------------------------------------------------------- */

test("a deleted audit row, or a deleted link, is detected as a gap", async () => {
  const mem = new MemoryRepository();
  for (let i = 1; i <= 4; i++) await mem.auditOnly(T, ev("record.read", i));
  mem.audit.splice(1, 1);
  const v = await AC.verifyAuditChain(mem, T);
  assert.equal(v.status, "gap", JSON.stringify(v));
  assert.equal(v.atSeq, 2);
  assert.match(v.message, /missing/);

  const mem2 = new MemoryRepository();
  for (let i = 1; i <= 4; i++) await mem2.auditOnly(T, ev("record.read", i));
  mem2._chain.splice(2, 1);
  const v2 = await AC.verifyAuditChain(mem2, T);
  assert.equal(v2.status, "gap");
  assert.equal(v2.atSeq, 3, "a missing sequence number");

  if (SQL_SKIP) return;
  const { db, repo } = sqlRepo();
  for (let i = 1; i <= 4; i++) await repo.auditOnly(T, ev("record.read", i));
  assert.throws(() => db.exec("DELETE FROM connect_audit_event"), /audit rows are immutable/);
  assert.throws(() => db.exec("DELETE FROM wardsynq_audit_chain"), /audit rows are immutable/);
  assert.throws(() => db.exec("UPDATE wardsynq_audit_chain SET row_hash='x'"), /audit rows are immutable/);
  db.exec("DROP TRIGGER connect_audit_event_no_delete");
  const second = db.prepare("SELECT audit_id FROM wardsynq_audit_chain WHERE tenant_id=? AND chain_seq=2").get(T).audit_id;
  db.prepare("DELETE FROM connect_audit_event WHERE id=?").run(second);
  const s = await AC.verifyAuditChain(repo, T);
  assert.equal(s.status, "gap", JSON.stringify(s));
  assert.equal(s.atSeq, 2);
  assert.equal(s.auditId, second);
});

/* ---- 4: concurrent appends do not fork -------------------------------------------------------------- */

test("concurrent appends in one process never fork the chain (memory and SQL)", async () => {
  const mem = new MemoryRepository();
  await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? mem.auditOnly(T, ev("record.read", i)) : mem.append(T, [rec("c" + i, 1)], { audit: ev("record.write", i) }))));
  const v = await AC.verifyAuditChain(mem, T);
  assert.equal(v.status, "ok", JSON.stringify(v));
  assert.equal(v.headSeq, 30);

  if (SQL_SKIP) return;
  const { repo } = sqlRepo();
  await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? repo.auditOnly(T, ev("record.read", i)) : repo.append(T, [rec("c" + i, 1)], { audit: ev("record.write", i) }))));
  const s = await AC.verifyAuditChain(repo, T);
  assert.equal(s.status, "ok", JSON.stringify(s));
  assert.equal(s.headSeq, 30);
});

test("RACE, forced: two writers that both read the same head (two isolates on one database) - the primary key refuses one, it retries, the chain stays whole", { skip: SQL_SKIP }, async () => {
  const { db, binding } = sqlRepo();
  /* Two bindings over ONE database, as two Workers isolates would be: the in-process lock cannot see
   * across them, so only the primary key decides. Same rendezvous style as the claimBed race test. */
  const isolate = () => ({ prepare: binding.prepare, batch: binding.batch });
  const a = new D1Repository(isolate()), b = new D1Repository(isolate());
  let arrived = 0, release, chainRefusals = 0;
  const gate = new Promise((r) => { release = r; });
  for (const repo of [a, b]) {
    const realHead = repo.auditChainHead.bind(repo);
    let first = true;
    repo.auditChainHead = async (t) => {
      const h = await realHead(t);
      if (first) { first = false; arrived += 1; if (arrived === 2) release(); await gate; }
      return h;
    };
    const realBatch = repo.db.batch;
    repo.db.batch = async (stmts) => {
      try { return await realBatch(stmts); }
      catch (e) { if (/wardsynq_audit_chain/.test(String(e && e.message))) chainRefusals += 1; throw e; }
    };
  }
  const [ra, rb] = await Promise.all([
    a.append(T, [rec("race-a", 1)], { audit: ev("record.write", 1) }),
    b.append(T, [rec("race-b", 1)], { audit: ev("record.write", 2) }),
  ]);
  assert.equal(arrived, 2, "both writers read the head before either wrote - the race was real");
  assert.equal(chainRefusals, 1, "exactly one batch was refused by the chain's primary key");
  assert.ok(ra.seq && rb.seq, "and both writes landed after the retry");
  const s = await AC.verifyAuditChain(a, T);
  assert.equal(s.status, "ok", JSON.stringify(s));
  assert.equal(s.headSeq, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM connect_audit_event").get().n, 2, "the refused attempt left no audit row behind");

  // A real version conflict is still a VersionConflictError, and still writes nothing, chain included.
  await assert.rejects(() => a.append(T, [rec("race-a", 1)], { audit: ev("record.write", 3) }), VersionConflictError);
  assert.equal((await AC.verifyAuditChain(a, T)).headSeq, 2);
});

/* ---- 5: a failed read is not verified --------------------------------------------------------------- */

test("a failed or impossible read gives NOT VERIFIED, never ok", async () => {
  const mem = new MemoryRepository();
  for (let i = 1; i <= 3; i++) await mem.auditOnly(T, ev("record.read", i));
  const rowsFail = Object.assign(Object.create(mem), { auditChainRows: async () => { throw new Error("D1_ERROR: network"); } });
  const headFail = Object.assign(Object.create(mem), { auditChainHead: async () => { throw new Error("D1_ERROR: network"); } });
  const garbage = Object.assign(Object.create(mem), { auditChainRows: async () => undefined });
  for (const repo of [rowsFail, headFail, garbage]) {
    const v = await AC.verifyAuditChain(repo, T);
    assert.equal(v.status, "not_verified", JSON.stringify(v));
    assert.match(v.message, /Not verified/);
    assert.ok(!/D1_ERROR/.test(v.message), "no driver text");
  }
  assert.equal((await AC.verifyAuditChain({ auditOnly() {} }, T)).status, "not_verified", "a store without the chain methods");
  assert.equal((await AC.verifyAuditChain(mem, T, { fromSeq: 9 })).status, "not_verified", "a window past the head");
  const short = Object.assign(Object.create(mem), { auditChainRows: async (t, f, to) => (await mem.auditChainRows(t, f, to)).slice(0, 1) });
  assert.equal((await AC.verifyAuditChain(short, T)).status, "gap", "a read that came back short is a gap, never ok");
});

/* ---- 6: the legacy boundary ------------------------------------------------------------------------- */

test("rows written before the chain are the unchained genesis era: link 1 names the newest of them, and moving the boundary breaks link 1", { skip: SQL_SKIP }, async () => {
  const { db, repo } = sqlRepo();
  const legacy = db.prepare("INSERT INTO connect_audit_event (id,tenant_id,ts,actor,connector_id,action,outcome) VALUES (?,?,?,?,?,?,?)");
  legacy.run("legacy-1", T, "2026-09-01T00:00:00.000Z", "cfa:dr", "wardsynq", "record.read", "ok");
  legacy.run("legacy-2", T, "2026-09-02T00:00:00.000Z", "cfa:dr", "wardsynq", "record.read", "ok");
  legacy.run("legacy-other", "other-tenant", "2026-09-03T00:00:00.000Z", "cfa:dr", "wardsynq", "record.read", "ok");
  await repo.auditOnly(T, ev("record.read", 1));
  await repo.auditOnly(T, ev("record.read", 2));
  const link1 = db.prepare("SELECT legacy_boundary, prev_hash FROM wardsynq_audit_chain WHERE tenant_id=? AND chain_seq=1").get(T);
  assert.equal(link1.legacy_boundary, "legacy-2", "the newest legacy row of THIS hospital");
  assert.equal(link1.prev_hash, AC.genesisHash("legacy-2"));
  assert.equal(db.prepare("SELECT legacy_boundary FROM wardsynq_audit_chain WHERE tenant_id=? AND chain_seq=2").get(T).legacy_boundary, null);
  assert.equal((await AC.verifyAuditChain(repo, T)).status, "ok", "legacy rows are outside the chain, not failures of it");

  db.exec("DROP TRIGGER wardsynq_audit_chain_no_update");
  db.prepare("UPDATE wardsynq_audit_chain SET legacy_boundary='legacy-1' WHERE tenant_id=? AND chain_seq=1").run(T);
  const v = await AC.verifyAuditChain(repo, T);
  assert.equal(v.status, "broken", JSON.stringify(v));
  assert.equal(v.atSeq, 1);

  const mem = new MemoryRepository();
  mem.audit.push({ tenantId: T, id: "old-row", action: "record.read" });
  await mem.auditOnly(T, ev("record.read", 1));
  assert.equal(mem._chain[0].legacyBoundary, "old-row");
  assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok");
});

/* ---- 7: the migration ------------------------------------------------------------------------------- */

test("the migration SQL carries both triggers on the table the repository actually writes, and the chain table", async () => {
  const written = [];
  const stub = {
    prepare(q) { const s = { bind: () => s, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }; written.push(q); return s; },
    batch: async (stmts) => stmts.map(() => ({ meta: { last_row_id: 1 } })),
  };
  await new D1Repository(stub).auditOnly(T, ev("record.read", 1));
  const auditTable = written.map((q) => /^INSERT INTO (\w+) \(id,tenant_id,ts,actor/.exec(q)).find(Boolean)[1];
  const chainTable = written.map((q) => /^INSERT INTO (\w+) \(tenant_id,chain_seq/.exec(q)).find(Boolean)[1];
  const connect = readSchema("connect"), wsq = readSchema("wardsynq");
  for (const [sql, table] of [[connect, auditTable], [wsq, chainTable]]) {
    for (const op of ["UPDATE", "DELETE"]) {
      const re = new RegExp(`CREATE TRIGGER IF NOT EXISTS \\w+ BEFORE ${op} ON ${table}\\s+BEGIN SELECT RAISE\\(ABORT, 'audit rows are immutable'\\); END;`);
      assert.match(sql, re, `${op} trigger on ${table}`);
    }
  }
  assert.equal(auditTable, "connect_audit_event");
  assert.match(connect, new RegExp(`CREATE TABLE IF NOT EXISTS ${auditTable} `));
  assert.match(wsq, new RegExp(`CREATE TABLE IF NOT EXISTS ${chainTable} \\(`));
  assert.match(wsq, /PRIMARY KEY \(tenant_id, chain_seq\)/, "the primary key is the concurrency control");

  if (SQL_SKIP) return;
  const { db } = sqlRepo();
  db.exec(connect); db.exec(wsq);                                   // re-applying is safe
  const triggers = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map((t) => `${t.tbl_name}:${t.name}`);
  assert.deepEqual(triggers, ["connect_audit_event:connect_audit_event_no_delete", "connect_audit_event:connect_audit_event_no_update",
    "wardsynq_audit_chain:wardsynq_audit_chain_no_delete", "wardsynq_audit_chain:wardsynq_audit_chain_no_update"]);
});

/* ---- 8: retention setting --------------------------------------------------------------------------- */

test("retention: configured wins, India defaults to the cited three years, elsewhere is not configured, nothing deletes", () => {
  assert.deepEqual(AC.auditRetentionSetting(8, "IN"), { years: 8, source: "configured" });
  const india = AC.auditRetentionSetting(null, "IN");
  assert.equal(india.years, 3);
  assert.match(india.citation, /Indian Medical Council regulation 1\.3\.1/);
  assert.equal(AC.auditRetentionSetting(undefined, "US").years, null);
  assert.equal(AC.auditRetentionSetting("forever", "US").source, "invalid");

  const r = SR.auditRetention("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", india);
  assert.equal(r.configuredRetention, 3);
  assert.match(r.configuredNote, /3 years, the default for this region/);
  assert.match(r.configuredNote, /informational only: this application never deletes audit rows/);
  assert.match(SR.auditRetention(null, null, AC.auditRetentionSetting(null, "US")).configuredNote, /kept indefinitely/);
  assert.equal(SR.auditRetention(null, null).configuredRetention, null);
  if (wardsynqConfig) assert.equal(wardsynqConfig({ auditRetentionYears: 7 }).auditRetentionYears, 7, "whitelisted in _opd_org.js");
  else assert.match(readFileSync(new URL("../functions/_opd_org.js", import.meta.url), "utf8"), /"auditRetentionYears"\]\) \{/, "whitelisted in _opd_org.js");
});

/* ---- 9: the real routes ----------------------------------------------------------------------------- */

const ORG_ID = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", HR = "hr@example.test", OTHER_ADMIN = "boss@other.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital(wardsynq) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: wardsynq || {} }, updateTime: "t1" });
  docs.set("q_orgs/org-other", { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"], [HR, "hr"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/org-other__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: "org-other", identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path) {
  const headers = email ? { "Cf-Access-Authenticated-User-Email": email } : {};
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const writesNow = () => RECORD._rows.length + RECORD.audit.length + RECORD._chain.length + docs.size;

test("route NEGATIVE: authorization on GET /api/queue/ward/security-report and /ward/system-health is unchanged; nothing written", async () => {
  seedHospital();
  const before = writesNow();
  for (const path of [`/ward/security-report?orgId=${ORG_ID}`, `/ward/system-health?orgId=${ORG_ID}`]) {
    assert.equal((await as(null, path)).__status, 401, path);
    const doc = await as(DOCTOR, path);
    assert.equal(doc.__status, 403, path + " " + JSON.stringify(doc));
    assert.equal(doc.auditRetention, undefined);
    assert.equal(doc.dependencies, undefined);
    const other = await as(OTHER_ADMIN, path);
    assert.ok(other.__status === 403 || other.__status === 404, path + " " + JSON.stringify(other));
  }
  /* HR holds staff.admin with no clinical actor: the security report refuses it in the record service
   * (403, as wardsynq-security-review pins), while system health never opens the record service. */
  const hrRep = await as(HR, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(hrRep.__status, 403, JSON.stringify(hrRep));
  assert.equal(hrRep.auditRetention, undefined);
  assert.equal(writesNow(), before, "no record, audit row, chain link or org document was written by a refused call");
  const hrHealth = await as(HR, `/ward/system-health?orgId=${ORG_ID}`);
  assert.equal(hrHealth.__status, HR_HEALTH_STATUS, JSON.stringify(hrHealth).slice(0, 300));
});
/* What HR got from system health BEFORE P2.17 (origin/wardsynq-product): pinned so this change cannot move it. */
const HR_HEALTH_STATUS = 200;

test("route POSITIVE: the admin sees integrity and retention in the security review and in system health; a tampered row is named in both", async () => {
  seedHospital();
  for (let i = 1; i <= 3; i++) await RECORD.auditOnly(TENANT_ROW.id, { ...ev("record.read", i), ts: new Date(Date.now() - 3600000 + i).toISOString() });

  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  assert.equal(rep.auditRetention.integrity.status, "ok", JSON.stringify(rep.auditRetention));
  assert.equal(rep.auditRetention.configuredRetention, 3, "an Indian hospital with nothing set gets the cited default");
  assert.equal(rep.auditRetention.retentionSource, "region-default");
  let health = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  let chain = health.dependencies.find((d) => d.id === "audit-chain");
  assert.equal(chain.status, "up", JSON.stringify(chain));
  assert.equal(chain.consequence, null);

  RECORD.audit[1].actor = "cfa:someone-else";
  const bad = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(bad.__status, 200);
  assert.equal(bad.auditRetention.integrity.status, "broken");
  assert.equal(bad.auditRetention.integrity.atSeq, 2);
  health = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  chain = health.dependencies.find((d) => d.id === "audit-chain");
  assert.equal(chain.status, "down");
  assert.match(chain.reason, /Broken at chained row 2/);
  assert.match(chain.consequence, /Charting continues and nothing is blocked/);

  seedHospital({ auditRetentionYears: 10 });
  const set = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(set.auditRetention.configuredRetention, 10, "the whitelisted setting reaches the report");
  assert.equal(set.auditRetention.retentionSource, "configured");
});

/* ---- 10: the screen --------------------------------------------------------------------------------- */

test("screen: broken names the row, not verified and a missing result never read as intact", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const html = win.WSQ._auditIntegrityHtml;
  const broken = html(c, { status: "broken", atSeq: 42, auditId: "aud-42", expected: "aaa", found: "bbb", message: "Broken at chained row 42 (aud-42): its contents no longer match what was written." });
  assert.match(broken, /Altered/);
  assert.match(broken, /42/);
  assert.match(broken, /aud-42/);
  assert.match(broken, /aaa/);
  const unknown = html(c, { status: "not_verified", message: "Not verified: the audit chain could not be read." }) + html(c, null);
  assert.ok(!/Intact/.test(unknown), unknown);
  assert.match(html(c, null), /not the same as the audit trail being intact/);
  assert.match(html(c, { status: "ok", message: "Intact: all 3 chained rows checked." }), /msg ok/);

  const page = win.WSQ._securityReviewHtml({ ...c, esc: win.WSQ.esc }, { days: 7, note: "n", counts: {}, notDetected: [], reviewQueue: { status: "ok", items: [], missing: [] }, dataProtection: { status: "unavailable" },
    auditRetention: { status: "ok", configuredNote: "Audit retention period: 3 years.", integrity: { status: "gap", atSeq: 5, message: "Gap: chained row 5 is missing." } } });
  assert.match(page, /Tamper evidence/);
  assert.match(page, /Rows missing/);
  assert.ok(!/[—–]/.test(broken + unknown + page), "no em or en dash on screen");
});
