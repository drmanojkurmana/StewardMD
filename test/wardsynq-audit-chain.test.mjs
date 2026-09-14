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
const { runTick } = await import("../functions/_wardsynq/ops-tick.js");
const { systemHealthReport, ANCHOR_TAMPER_CONSEQUENCE } = await import("../functions/_wardsynq/system-health.js");
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
  /* G12: the route now always has the Firestore anchor store, so nothing anchored reads degraded, not up. */
  let health = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  assert.equal(health.dependencies.find((d) => d.id === "audit-chain").status, "degraded");
  const { firestoreAnchorStore } = await import("../functions/_q_audit_chain.js");
  await AC.anchorHead(RECORD, TENANT_ROW.id, firestoreAnchorStore({}), new Date().toISOString());
  health = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
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

/* ---- 11: outside anchors --------------------------------------------------------------------------------
 *
 * The head copied outside the database (KV in production, a Map here), then compared row by row.
 * The store is KV-shaped {get, put} on strings under `wsq:auditanchor:<tenantId>`, so the domain
 * logic is exercised here with no platform in the room.
 */

const memAnchorStore = () => {
  const m = new Map();
  return { map: m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
};

test("anchors: anchor then check is ok, on memory and on real SQL; the log is bounded and keyed per hospital", async () => {
  assert.equal(AC.anchorKey(T), "wsq:auditanchor:tenant-chain");
  assert.notEqual(AC.anchorKey(T), AC.anchorKey("another-tenant"), "each hospital anchors under its own key");

  const mem = new MemoryRepository();
  const store = memAnchorStore();
  assert.equal((await AC.checkAnchors(mem, T, store)).status, "no-anchors");
  assert.equal((await AC.anchorHead(mem, T, store, "2026-09-14T09:00:00.000Z")).status, "empty", "nothing chained yet anchors nothing");
  assert.equal(store.map.size, 0, "an empty chain writes nothing");

  for (let i = 1; i <= 3; i++) await mem.auditOnly(T, ev("record.read", i));
  const a = await AC.anchorHead(mem, T, store, "2026-09-14T10:00:00.000Z");
  assert.equal(a.status, "ok", JSON.stringify(a));
  assert.equal(a.seq, 3);
  assert.equal(a.anchored, true);
  assert.deepEqual(JSON.parse(store.map.get(AC.anchorKey(T))), [{ seq: 3, hash: a.hash, at: "2026-09-14T10:00:00.000Z" }]);
  const again = await AC.anchorHead(mem, T, store, "2026-09-14T11:00:00.000Z");
  assert.equal(again.anchored, false, "the same head is not written twice");
  assert.equal(JSON.parse(store.map.get(AC.anchorKey(T))).length, 1);
  assert.equal((await AC.checkAnchors(mem, T, store)).status, "ok");

  await mem.auditOnly(T, ev("record.read", 4));
  assert.equal((await AC.checkAnchors(mem, T, store)).status, "ok", "older anchors still match after the chain grows");
  assert.equal((await AC.anchorHead(mem, T, store, "2026-09-14T12:00:00.000Z")).seq, 4);
  assert.equal(JSON.parse(store.map.get(AC.anchorKey(T))).length, 2);

  const folded = Array.from({ length: 250 }, (_, i) => ({ seq: i + 1, hash: "h" + (i + 1), at: "t" }))
    .reduce((l, e) => AC.appendAnchorEntry(l, e).log, []);
  assert.equal(folded.length, 200, "only the last 200 anchors are kept");
  assert.equal(folded[0].seq, 51);
  assert.equal(folded[199].seq, 250);

  if (SQL_SKIP) return;
  const { repo } = sqlRepo();
  const sstore = memAnchorStore();
  for (let i = 1; i <= 3; i++) await repo.auditOnly(T, ev("record.read", i));
  assert.equal((await AC.anchorHead(repo, T, sstore)).status, "ok");
  assert.equal((await AC.checkAnchors(repo, T, sstore)).status, "ok");
});

test("anchors: a rebuilt chain with different hashes reads rewritten at that seq, and the old anchor is kept", async () => {
  const mem = new MemoryRepository();
  const store = memAnchorStore();
  for (let i = 1; i <= 3; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T10:00:00.000Z");
  for (let i = 4; i <= 5; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T10:30:00.000Z");
  /* Rebuild: change row 3 and recompute every hash from it forward, so the chain verifies but the
   * anchor does not. Indexes align because every row here belongs to the one hospital in order. */
  mem.audit[2].action = "record.list";
  for (let i = 2; i < mem._chain.length; i++) {
    const prev = mem._chain[i - 1].rowHash;
    mem._chain[i].prevHash = prev;
    mem._chain[i].rowHash = await AC.chainHash(prev, mem.audit[i]);
  }
  assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok", "the rebuild is self-consistent, which is exactly what anchors are for");
  const c = await AC.checkAnchors(mem, T, store);
  assert.equal(c.status, "rewritten", JSON.stringify(c));
  assert.equal(c.atSeq, 3);
  assert.match(c.message, /Rewritten at chained row 3/);
  const re = await AC.anchorHead(mem, T, store, "2026-09-14T11:00:00.000Z");
  assert.equal(re.status, "conflict", "the new hash does not overwrite the old anchor");
  assert.equal((await AC.checkAnchors(mem, T, store)).atSeq, 3, "the evidence survives the next tick");

  if (SQL_SKIP) return;
  const { db, repo } = sqlRepo();
  const sstore = memAnchorStore();
  for (let i = 1; i <= 3; i++) await repo.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(repo, T, sstore);
  for (let i = 4; i <= 5; i++) await repo.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(repo, T, sstore);
  db.exec("DROP TRIGGER connect_audit_event_no_update");       // what a console, a script or a restore can do
  db.exec("DROP TRIGGER wardsynq_audit_chain_no_update");
  const ids = db.prepare("SELECT audit_id FROM wardsynq_audit_chain WHERE tenant_id=? ORDER BY chain_seq").all(T).map((r) => r.audit_id);
  db.prepare("UPDATE connect_audit_event SET actor='cfa:someone-else' WHERE id=?").run(ids[2]);
  const COLS = "id, tenant_id, ts, actor, connector_id, action, resource_counts, scope, patient_ref_hash, latency_ms, outcome, consent_id, transaction_id, care_context_hash";
  for (let seq = 3; seq <= 5; seq++) {
    const row = db.prepare(`SELECT ${COLS} FROM connect_audit_event WHERE id=?`).get(ids[seq - 1]);
    const prev = db.prepare("SELECT row_hash FROM wardsynq_audit_chain WHERE tenant_id=? AND chain_seq=?").get(T, seq - 1).row_hash;
    db.prepare("UPDATE wardsynq_audit_chain SET prev_hash=?, row_hash=? WHERE tenant_id=? AND chain_seq=?").run(prev, await AC.chainHash(prev, row), T, seq);
  }
  assert.equal((await AC.verifyAuditChain(repo, T)).status, "ok", "the rebuilt SQL chain verifies");
  const s = await AC.checkAnchors(repo, T, sstore);
  assert.equal(s.status, "rewritten", JSON.stringify(s));
  assert.equal(s.atSeq, 3);
});

test("anchors: deleting the newest links reads truncated, while the chain itself still verifies", async () => {
  const mem = new MemoryRepository();
  const store = memAnchorStore();
  for (let i = 1; i <= 3; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T10:00:00.000Z");
  for (let i = 4; i <= 5; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T11:00:00.000Z");
  mem._chain.splice(3);                                        // the newest two links are gone below the app
  assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok", "the remaining chain verifies: a tail cut is invisible without anchors");
  const c = await AC.checkAnchors(mem, T, store);
  assert.equal(c.status, "truncated", JSON.stringify(c));
  assert.equal(c.atSeq, 5);
  assert.equal(c.headSeq, 3);
  assert.match(c.message, /Truncated/);

  if (SQL_SKIP) return;
  const { db, repo } = sqlRepo();
  const sstore = memAnchorStore();
  for (let i = 1; i <= 3; i++) await repo.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(repo, T, sstore);
  for (let i = 4; i <= 5; i++) await repo.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(repo, T, sstore);
  db.exec("DROP TRIGGER wardsynq_audit_chain_no_delete");      // what a console, a script or a restore can do
  db.prepare("DELETE FROM wardsynq_audit_chain WHERE tenant_id=? AND chain_seq>?").run(T, 3);
  assert.equal((await AC.verifyAuditChain(repo, T)).status, "ok", "the cut SQL chain verifies");
  const s = await AC.checkAnchors(repo, T, sstore);
  assert.equal(s.status, "truncated", JSON.stringify(s));
  assert.equal(s.atSeq, 5);
  assert.equal(s.headSeq, 3);
});

test("anchors: no anchors reads no-anchors, an unreadable or corrupt store reads not-verified and never ok", async () => {
  const mem = new MemoryRepository();
  for (let i = 1; i <= 2; i++) await mem.auditOnly(T, ev("record.read", i));
  const none = await AC.checkAnchors(mem, T, memAnchorStore());
  assert.equal(none.status, "no-anchors");
  assert.match(none.message, /nothing outside the database to compare/);
  const down = await AC.checkAnchors(mem, T, { get: async () => { throw new Error("KV_ERROR: down"); } });
  assert.equal(down.status, "not-verified", JSON.stringify(down));
  assert.match(down.message, /Not verified/);
  assert.ok(!/KV_ERROR/.test(down.message), "no driver text");
  assert.equal((await AC.checkAnchors({ auditOnly() {} }, T, memAnchorStore())).status, "not-verified", "a store without the chain methods");
  const corrupt = memAnchorStore();
  corrupt.map.set(AC.anchorKey(T), "{not json");
  assert.equal((await AC.checkAnchors(mem, T, corrupt)).status, "not-verified", "a corrupt log is not nothing");
});

/* ---- 12: the tick anchors without ever risking the tick ------------------------------------------------ */

test("anchors: a failed anchor write never fails the tick; the failure is recorded on the tick result", async () => {
  const mem = new MemoryRepository();
  for (let i = 1; i <= 2; i++) await mem.auditOnly(T, ev("record.read", i));
  const failing = { get: async () => null, put: async () => { throw new Error("KV down"); } };
  const t = await runTick(mem, T, { anchorStore: failing, nowMs: Date.parse("2026-09-14T10:00:00.000Z") });
  assert.ok(t.anchor && t.anchor.error, "the failure is recorded: " + JSON.stringify(t.anchor));
  assert.ok(t.criticals && t.outbox, "the clinical halves still report: " + JSON.stringify({ criticals: t.criticals, outbox: t.outbox }));
  assert.equal((await AC.checkAnchors(mem, T, memAnchorStore())).status, "no-anchors", "a failed write anchored nothing");

  const store = memAnchorStore();
  const ok = await runTick(mem, T, { anchorStore: store, nowMs: Date.parse("2026-09-14T11:00:00.000Z") });
  assert.equal(ok.anchor.status, "ok", JSON.stringify(ok.anchor));
  assert.equal((await AC.checkAnchors(mem, T, store)).status, "ok");

  const skipped = await runTick(mem, T, {});
  assert.equal(skipped.anchor.status, "skipped", "no store handed in anchors nothing");
});

/* ---- 13: the probe maps every anchor state --------------------------------------------------------------- */

test("anchors: the system-health probe maps every anchor state", async () => {
  const NOW = Date.parse("2026-09-14T12:00:00.000Z");
  const depsFor = (repository, anchorStore) => ({
    repository, tenantId: T, env: {}, maik: { enabled: false }, rpoMinutes: null, anchorStore,
    orgProbe: async () => ({ id: "org" }),
    documentProbe: async () => ({ state: "not_configured" }),
    lastTick: async () => ({ at: new Date(NOW - 60000).toISOString() }),
    timeoutMs: 1000, now: () => NOW,
  });
  const probe = async (repository, anchorStore) =>
    (await systemHealthReport(depsFor(repository, anchorStore))).dependencies.find((d) => d.id === "audit-chain");
  const chained = async () => {
    const mem = new MemoryRepository();
    for (let i = 1; i <= 3; i++) await mem.auditOnly(T, ev("record.read", i));
    const store = memAnchorStore();
    await AC.anchorHead(mem, T, store, new Date(NOW - 3600000).toISOString());
    return { mem, store };
  };

  { const { mem, store } = await chained();
    const p = await probe(mem, store);
    assert.equal(p.status, "up", JSON.stringify(p));
    assert.equal(p.consequence, null);
    assert.match(p.reason, /Outside copy matches/); }

  /* Rewritten so the chain still verifies: only the anchor can see it. */
  { const { mem, store } = await chained();
    mem.audit[2].action = "record.list";
    mem._chain[2].rowHash = await AC.chainHash(mem._chain[2].prevHash, mem.audit[2]);
    assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok");
    const p = await probe(mem, store);
    assert.equal(p.status, "down", JSON.stringify(p));
    assert.equal(p.consequence, ANCHOR_TAMPER_CONSEQUENCE);
    assert.match(p.reason, /Rewritten at chained row 3/); }

  { const { mem, store } = await chained();
    mem._chain.splice(2);
    assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok");
    const p = await probe(mem, store);
    assert.equal(p.status, "down", JSON.stringify(p));
    assert.equal(p.consequence, ANCHOR_TAMPER_CONSEQUENCE);
    assert.match(p.reason, /Truncated/); }

  { const mem = new MemoryRepository();
    for (let i = 1; i <= 2; i++) await mem.auditOnly(T, ev("record.read", i));
    const p = await probe(mem, memAnchorStore());
    assert.equal(p.status, "degraded", JSON.stringify(p));
    assert.match(p.reason, /No outside copy/); }

  { const { mem } = await chained();
    const p = await probe(mem, { get: async () => { throw new Error("KV down"); } });
    assert.equal(p.status, "degraded", JSON.stringify(p));
    assert.match(p.reason, /Not verified/); }

  { const { mem } = await chained();
    const p = await probe(mem, null);
    assert.equal(p.status, "up", "without a store the probe keeps the old chain-only behaviour"); }

  /* A hospital with no chained rows has nothing to anchor: up, not a permanent degraded that trains people to ignore it. */
  { const p = await probe(new MemoryRepository(), memAnchorStore());
    assert.equal(p.status, "up", JSON.stringify(p));
    assert.match(p.reason, /Nothing to anchor yet/); }
});

/* ---- 14: the screen shows one line per anchor state ------------------------------------------------------- */

test("screen: the tamper-evidence block shows one line per anchor state", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const line = win.WSQ._anchorHtml;
  const ok = line(c, { status: "ok", message: "Outside copy matches: all 1 anchored rows still match." });
  const rewritten = line(c, { status: "rewritten", atSeq: 3, message: "Rewritten at chained row 3: it no longer matches the outside copy." });
  const truncated = line(c, { status: "truncated", atSeq: 5, headSeq: 3, message: "Truncated: the chain now ends at row 3, below anchored row 5." });
  const noAnchors = line(c, { status: "no-anchors", message: "No outside copy has been recorded yet." });
  const notVerified = line(c, { status: "not-verified", message: "Not verified: the outside copy could not be read." });
  assert.match(ok, /msg ok/);
  assert.match(ok, /Outside copy matches/);
  assert.match(rewritten, /msg err/);
  assert.match(rewritten, /Outside copy differs/);
  assert.match(rewritten, /information governance lead/);
  assert.match(rewritten, /Do not restore or re-import/);
  assert.match(truncated, /Newest rows removed/);
  assert.match(truncated, /information governance lead/);
  assert.match(noAnchors, /msg note/);
  assert.match(noAnchors, /No outside copy yet/);
  assert.match(notVerified, /msg err/);
  assert.match(notVerified, /Outside copy not verified/);
  assert.equal(line(c, null), "", "a missing anchor result adds no line");
  assert.ok(!/Intact/.test(rewritten + truncated + noAnchors + notVerified), "no tamper state reads as intact");

  const ig = { status: "ok", message: "Intact: all 3 chained rows checked." };
  const combined = win.WSQ._auditIntegrityHtml(c, ig, { status: "rewritten", atSeq: 3, message: "Rewritten at chained row 3." });
  assert.match(combined, /Intact/);
  assert.match(combined, /Outside copy differs/);
  const without = win.WSQ._auditIntegrityHtml(c, ig);
  assert.ok(!/Outside copy/.test(without), "older callers without anchors render as before");
  assert.ok(!/[—–]/.test(ok + rewritten + truncated + noAnchors + notVerified + combined), "no em or en dash on screen");
});

test("route: the security review carries the anchor comparison, plainly empty before any anchor exists", async () => {
  seedHospital();
  for (let i = 1; i <= 2; i++) await RECORD.auditOnly(TENANT_ROW.id, ev("record.read", i));
  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(rep.__status, 200, JSON.stringify(rep).slice(0, 300));
  assert.equal(rep.auditRetention.anchors.status, "no-anchors", JSON.stringify(rep.auditRetention.anchors));
  assert.match(rep.auditRetention.anchors.message, /nothing outside the database to compare/);
});

/* ---- 15: acknowledging a legitimate restore --------------------------------------------------------
 *
 * After a Time Travel restore the anchor comparison correctly stays down: nothing may clear it
 * except the hospital owner saying "we restored on purpose". The old log moves UNCHANGED to an
 * archive key, a fresh one-entry log restarts at the head with the acknowledgement attached, the
 * acknowledgement itself is chained, and checkAnchors reads ok while still naming who, when and
 * under which incident.
 */

const ACK_BY = "admin@example.test";
const ACK_REASON = "Planned point in time restore after the failed migration rehearsal";
const ACK_INCIDENT = "INC-2026-0914";
const ACK_AT = "2026-09-14T12:00:00.000Z";

async function truncatedRepo() {
  const mem = new MemoryRepository();
  const store = memAnchorStore();
  for (let i = 1; i <= 3; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T10:00:00.000Z");
  for (let i = 4; i <= 5; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T11:00:00.000Z");
  const before = JSON.parse(await store.get(AC.anchorKey(T)));
  mem._chain.splice(3);                                     // the restore discarded the newest rows below the app
  assert.equal((await AC.checkAnchors(mem, T, store)).status, "truncated");
  return { mem, store, before };
}

test("acknowledge: a truncated chain acknowledged by the owner archives the old log and restarts at the head", async () => {
  const { mem, store, before } = await truncatedRepo();
  const auditsBefore = mem.audit.length;
  const r = await AC.acknowledgeAnchorBreak(mem, T, store, { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, nowIso: ACK_AT });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.status, "acknowledged");
  assert.equal(r.previousStatus, "truncated");
  assert.equal(r.previousAtSeq, 5);
  assert.equal(r.archived, AC.anchorArchiveKey(T, ACK_AT));
  assert.match(r.archived, /^wsq:auditanchor:tenant-chain:archived:/);
  assert.deepEqual(JSON.parse(await store.get(r.archived)), before, "the archive holds the old log unchanged");

  // The fresh log starts at the head: the acknowledgement row itself was chained first.
  const head = await mem.auditChainHead(T);
  const fresh = JSON.parse(await store.get(AC.anchorKey(T)));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].seq, head.seq);
  assert.equal(fresh[0].hash, head.hash);
  assert.deepEqual(fresh[0].acknowledged, { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, previousStatus: "truncated", previousAtSeq: 5 });

  // checkAnchors is ok and names the acknowledgement: who, when, incident. Never silently green.
  const c = await AC.checkAnchors(mem, T, store);
  assert.equal(c.status, "ok", JSON.stringify(c));
  assert.match(c.message, /Acknowledged restore by admin@example\.test/);
  assert.match(c.message, /2026-09-14T12:00:00/);
  assert.match(c.message, /INC-2026-0914/);
  assert.deepEqual(c.acknowledgement, { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, previousStatus: "truncated", previousAtSeq: 5, at: ACK_AT });

  // An audit event was written for the acknowledgement, and it is chained.
  assert.equal(mem.audit.length, auditsBefore + 1);
  const wrote = mem.audit[mem.audit.length - 1];
  assert.equal(wrote.action, AC.ANCHOR_ACK_ACTION);
  assert.equal(wrote.actor, ACK_BY);
  assert.equal(wrote.outcome, "ok");
  assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok", "the chained acknowledgement verifies");
});

test("acknowledge: refused when nothing is broken, and the log is untouched", async () => {
  const mem = new MemoryRepository();
  const store = memAnchorStore();
  for (let i = 1; i <= 2; i++) await mem.auditOnly(T, ev("record.read", i));
  await AC.anchorHead(mem, T, store, "2026-09-14T10:00:00.000Z");
  const auditsBefore = mem.audit.length;
  const logBefore = await store.get(AC.anchorKey(T));
  const r = await AC.acknowledgeAnchorBreak(mem, T, store, { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, nowIso: ACK_AT });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error, "nothing_to_acknowledge");
  assert.equal(await store.get(AC.anchorKey(T)), logBefore, "the log is untouched");
  assert.equal(mem.audit.length, auditsBefore, "a refused acknowledgement chains nothing");
  assert.equal(store.map.size, 1, "no archive key was written");

  const r2 = await AC.acknowledgeAnchorBreak(mem, T, memAnchorStore(), { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, nowIso: ACK_AT });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "nothing_to_acknowledge", "no anchors at all is also nothing to acknowledge");
});

test("acknowledge: a failing replace keeps the archive and reports the failure", async () => {
  const { mem, store, before } = await truncatedRepo();
  const realPut = store.put;
  let puts = 0;
  store.put = async (k, v) => { puts += 1; if (puts === 2) throw new Error("KV down"); return realPut(k, v); };
  const r = await AC.acknowledgeAnchorBreak(mem, T, store, { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, nowIso: ACK_AT });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error, "replace_failed");
  assert.equal(r.archived, AC.anchorArchiveKey(T, ACK_AT));
  assert.deepEqual(JSON.parse(await store.get(r.archived)), before, "the archive was kept");
  assert.deepEqual(JSON.parse(await store.get(AC.anchorKey(T))), before, "the old log is still in place: never a half move");
  assert.equal((await AC.checkAnchors(mem, T, store)).status, "truncated", "the break is still reported, so acknowledging again is safe");
});

/* ---- 16: the acknowledgement route ------------------------------------------------------------------ */

const DEPUTY = "deputy@example.test";
function seedHospitalWithDeputy(wardsynq) {
  seedHospital(wardsynq);
  docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(DEPUTY))}`, { fields: { orgId: ORG_ID, identity: idFor(DEPUTY), role: "admin", active: true }, updateTime: "t1" });
}
async function postAs(email, path, body, env) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: "POST", headers, body: JSON.stringify(body || {}) }), env: env || ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function getAs(email, path, env) {
  const headers = email ? { "Cf-Access-Authenticated-User-Email": email } : {};
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers }), env: env || ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
/* The route writes anchors through env.MAIK_KV, so the test drives the domain through the same map. */
function sharedKv() {
  const m = new Map();
  const kv = { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); } };
  return { map: m, kv };
}
const GOOD_ACK = { orgId: ORG_ID, reason: ACK_REASON, incidentRef: ACK_INCIDENT };

test("route: POST /ward/audit-anchor-acknowledge is owner-only, needs a real reason, and restarts the log", async () => {
  seedHospitalWithDeputy();
  for (let i = 1; i <= 3; i++) await RECORD.auditOnly(TENANT_ROW.id, ev("record.read", i));
  const { map, kv } = sharedKv();
  const env = { ...ENV, MAIK_KV: kv };
  await AC.anchorHead(RECORD, TENANT_ROW.id, kv, "2026-09-14T10:00:00.000Z");
  for (let i = 4; i <= 5; i++) await RECORD.auditOnly(TENANT_ROW.id, ev("record.read", i));
  await AC.anchorHead(RECORD, TENANT_ROW.id, kv, "2026-09-14T11:00:00.000Z");
  RECORD._chain.splice(3);                                  // the restore, below the application
  assert.equal((await AC.checkAnchors(RECORD, TENANT_ROW.id, kv)).status, "truncated");
  const PATH = "/ward/audit-anchor-acknowledge";
  const logBefore = map.get(AC.anchorKey(TENANT_ROW.id));

  assert.equal((await postAs(null, PATH, GOOD_ACK, env)).__status, 401);
  for (const who of [DOCTOR, HR, DEPUTY]) {
    const r = await postAs(who, PATH, GOOD_ACK, env);
    assert.equal(r.__status, 403, who + " " + JSON.stringify(r));
    assert.equal(r.ok, false);
  }
  const cross = await postAs(OTHER_ADMIN, PATH, GOOD_ACK, env);
  assert.ok(cross.__status === 403 || cross.__status === 404, "another hospital's owner: " + JSON.stringify(cross));
  assert.equal((await postAs(ADMIN, PATH, { orgId: ORG_ID, reason: "too short", incidentRef: ACK_INCIDENT }, env)).__status, 422);
  assert.equal((await postAs(ADMIN, PATH, { orgId: ORG_ID, reason: ACK_REASON, incidentRef: "" }, env)).__status, 422);
  assert.equal(map.get(AC.anchorKey(TENANT_ROW.id)), logBefore, "every refused call moved nothing");

  /* Every report read below is itself an audited read, so the chain keeps growing past the fresh
   * anchor: remember which row the acknowledgement chained at, for the new-tamper step. */
  const ackIdx = RECORD.audit.length;
  const ok = await postAs(ADMIN, PATH, GOOD_ACK, env);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.ok, true);
  assert.equal(ok.previousStatus, "truncated");
  assert.ok(ok.archived && map.has(ok.archived), "the archive key holds the old log");
  assert.deepEqual(JSON.parse(map.get(ok.archived)), JSON.parse(logBefore));

  const rep = await getAs(ADMIN, `/ward/security-report?orgId=${ORG_ID}`, env);
  assert.equal(rep.__status, 200, JSON.stringify(rep).slice(0, 300));
  assert.equal(rep.auditRetention.anchors.status, "ok", JSON.stringify(rep.auditRetention.anchors));
  assert.match(rep.auditRetention.anchors.message, /Acknowledged restore by admin@example\.test/);
  assert.match(rep.auditRetention.anchors.message, /INC-2026-0914/);
  assert.equal(rep.auditRetention.anchors.canAcknowledge, true, "the owner sees the form");
  const dep = await getAs(DEPUTY, `/ward/security-report?orgId=${ORG_ID}`, env);
  assert.equal(dep.auditRetention.anchors.canAcknowledge, false, "an admin member does not");
  const health = await getAs(ADMIN, `/ward/system-health?orgId=${ORG_ID}`, env);
  const chain = health.dependencies.find((d) => d.id === "audit-chain");
  assert.equal(chain.status, "up", JSON.stringify(chain));
  assert.match(chain.reason, /Acknowledged restore/);
  assert.match(chain.reason, /INC-2026-0914/);

  // After acknowledgement, a NEW tamper (a row rewritten after the fresh anchor, with its link
  // rebuilt so the chain verifies on its own, exactly what anchors are for) is detected again.
  RECORD.audit[ackIdx].action = "record.list";
  const freshLink = RECORD._chain.find((l) => l.tenantId === TENANT_ROW.id && l.chainSeq === ok.seq);
  freshLink.rowHash = await AC.chainHash(freshLink.prevHash, RECORD.audit[ackIdx]);
  const again = await getAs(ADMIN, `/ward/security-report?orgId=${ORG_ID}`, env);
  assert.equal(again.auditRetention.anchors.status, "rewritten", JSON.stringify(again.auditRetention.anchors));
  const health2 = await getAs(ADMIN, `/ward/system-health?orgId=${ORG_ID}`, env);
  assert.equal(health2.dependencies.find((d) => d.id === "audit-chain").status, "down");
});

/* ---- 17: the screen names the acknowledgement and gates the form ------------------------------------- */

test("screen: the acknowledgement line names who, when, reason and incident; the form is the owner's alone", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const ack = { by: ACK_BY, reason: ACK_REASON, incidentRef: ACK_INCIDENT, previousStatus: "truncated", previousAtSeq: 5, at: ACK_AT };

  const line = win.WSQ._anchorAckLineHtml(c, ack);
  assert.match(line, /Acknowledged restore/);
  assert.match(line, /admin@example\.test/);
  assert.match(line, /2026-09-14T12:00:00/);
  assert.match(line, /INC-2026-0914/);
  assert.match(line, /Planned point in time restore/);
  assert.match(line, /kept as an archive and is never deleted/);
  const viaAnchor = win.WSQ._anchorHtml(c, { status: "ok", acknowledgement: ack, message: "Outside copy matches. Acknowledged restore by admin@example.test." });
  assert.match(viaAnchor, /Acknowledged restore/);

  // Everyone sees what happened and that only the hospital owner may acknowledge.
  const pub = win.WSQ._anchorHtml(c, { status: "truncated", atSeq: 5, headSeq: 3, message: "Truncated: the chain now ends at row 3, below anchored row 5." });
  assert.match(pub, /Newest rows removed/);
  assert.match(pub, /Only the owner of this hospital can acknowledge/);
  assert.ok(!/secAckReason/.test(pub), "no form for a viewer who is not the owner");

  // The owner gets the form: reason and incident reference fields, and a confirm step.
  const own = win.WSQ._anchorHtml(c, { status: "truncated", atSeq: 5, headSeq: 3, message: "Truncated: the chain now ends at row 3, below anchored row 5.", canAcknowledge: true });
  assert.match(own, /secAckReason/);
  assert.match(own, /secAckIncident/);
  assert.match(own, /secAckReview/);
  assert.match(own, /Review acknowledgement/);
  const confirm = win.WSQ._anchorAckConfirmHtml(c, ACK_REASON, ACK_INCIDENT);
  assert.match(confirm, /Confirm acknowledgement/);
  assert.match(confirm, /INC-2026-0914/);
  assert.match(confirm, /Planned point in time restore/);
  assert.ok(!/[—–]/.test(line + viaAnchor + pub + own + confirm), "no em or en dash on screen");
});
