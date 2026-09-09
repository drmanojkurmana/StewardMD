/* test/wardsynq-d1-sql.test.mjs — the record's SQL, executed.
 *
 * WHY THIS EXISTS. The existing D1 coverage ("D1 repository speaks the schema", in
 * wardsynq-record-service.test.mjs) drives D1Repository against a STUB whose prepare() records the
 * query text and returns nothing. It proves the repository ISSUES the right shape of statement; it
 * cannot prove those statements RUN, because no SQL engine ever sees them. Everything else in the
 * suite runs on MemoryRepository, which is a Map.
 *
 * So until this file, nothing in CI had ever executed functions/db/wardsynq_schema.sql, and nothing
 * had ever run a real query against the tables it declares. On 2026-09-07 that gap cost a night: the
 * schema had never been applied to the production D1 at all, every real write failed on the first
 * read with `record_read_failed` (a "no such table" surfacing to the device as a 502), and the code
 * was correct the whole time. A missing table is a deployment fact this file cannot check — but the
 * whole CLASS of "the SQL and the schema disagree" (a renamed column, a dropped index, a constraint
 * that does not behave as the repository assumes) was equally invisible, and that is what this
 * closes: real schema, real SQLite, real constraint violations, real rows back.
 *
 * node:sqlite is Node's own (no dependency). It needed --experimental-sqlite on Node 22 below
 * 22.13 and is unflagged from 22.13 / 23.4 onward. If it is ever unavailable the test SKIPS with a
 * reason rather than failing, so this can never become a red build for an engine-availability reason.
 * `npm test` passes the flag and so does .github/workflows/ci.yml.
 *
 * A CORRECTION LIVES HERE, because a wrong claim was briefly written into this exact comment. For one
 * merge it stated that ci.yml did not pass the flag and that this suite, wardsynq-restore and
 * wardsynq-onprem had therefore skipped on every CI run while reporting green. That was false: CI
 * resolves `node-version: '22'` to 22.23.2, where node:sqlite needs no flag, and the CI log for
 * f49ece3e (run 34401383280, before any flag was added) shows this file's tenancy test and the
 * restore rehearsal executing as `ok`. The claim was inferred from the flag's absence plus the skip
 * guard's existence, and the actual CI outcome was never checked - which is precisely the kind of
 * inference this file's own header warns against. test/check-dr-suites-ran.mjs remains as a forward
 * guard against a future Node pin or flag change; it is not evidence that anything was ever broken.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { VersionConflictError } from "../functions/_wardsynq/repository.js";
import { RecordService } from "../functions/_wardsynq/service.js";
import { makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { Patient, Observation } from "../wardsynq/wardsynq-model.js";

let DatabaseSync = null;
let sqliteWhy = "";
try { ({ DatabaseSync } = await import("node:sqlite")); }
catch (e) { sqliteWhy = String((e && e.message) || e); }
const SKIP = `node:sqlite unavailable (${sqliteWhy}) - run with --experimental-sqlite (Node 22) or Node >=23.4. `
  + `NOTE: .github/workflows/ci.yml does NOT pass that flag, so these tests SKIP in CI until its `
  + `"Run unit tests" step becomes: node --test --experimental-test-module-mocks --experimental-sqlite test/*.test.mjs`;

/* The D1 binding surface, over node:sqlite. Only what D1Repository actually calls:
 * prepare().bind().first()/.all()/.run() and db.batch(). D1's batch is atomic, so this one is a
 * transaction — a test that did not roll back would report a half-written batch as success. */
function d1(db) {
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = norm(a); return s; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      _exec() { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return s;
  }
  return {
    prepare: stmt,
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = stmts.map((s) => s._exec()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  // Both schemas, exactly as they ship. This is the assertion that they are valid SQL at all.
  db.exec(readFileSync(new URL("../db/connect_schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../functions/db/wardsynq_schema.sql", import.meta.url), "utf8"));
  return db;
}

const rec = (over = {}) => ({
  resourceType: "Patient", id: "pat-1", version: 1, patientId: null,
  meta: { recordedAt: "2026-09-07T00:00:00.000Z", effectiveAt: null },
  writtenBy: { id: "fb:dr-a", kind: "human" }, ...over,
});

test("the shipped schema is valid SQL and declares what the repository queries", { skip: DatabaseSync ? false : `node:sqlite unavailable: ${sqliteWhy}` }, () => {
  const db = freshDb();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["wardsynq_record", "wardsynq_idempotency", "connect_audit_event", "connect_tenant"]) {
    assert.ok(names.includes(t), `${t} must exist after applying the shipped schema`);
  }
  const cols = db.prepare("PRAGMA table_info(wardsynq_record)").all().map((c) => c.name);
  // Exactly the columns the INSERT in repository-d1.js names, plus the autoincrement cursor.
  for (const c of ["seq", "tenant_id", "resource_type", "id", "version", "patient_id", "recorded_at", "effective_at", "actor_id", "actor_kind", "body"]) {
    assert.ok(cols.includes(c), `wardsynq_record.${c} is written by repository-d1.js and must exist`);
  }
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
  assert.ok(idx.includes("idx_wardsynq_record_patient"), "the patient-compartment index the chart read depends on");
  assert.ok(idx.includes("idx_wardsynq_record_tenant_seq"), "the change-feed cursor index");
});

/* The 2026-09-07 production failure, pinned. The code was correct; wardsynq_schema.sql had simply
 * never been applied to the production D1, so the FIRST read of every write threw here and the route
 * reported `record_read_failed` (which reached the device as a 502). This asserts what that looks
 * like from the repository, so the next person who sees `record_read_failed` in a log has the
 * one-line answer: apply the schema (the command is in the .sql file's own header). */
test("a database without the schema fails loudly on read - the shape of the 2026-09-07 production outage", { skip: DatabaseSync ? false : SKIP }, async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../db/connect_schema.sql", import.meta.url), "utf8"));   // tenancy present, record schema NOT applied
  const repo = new D1Repository(d1(db));
  await assert.rejects(() => repo.latest("t1", "Patient", "pat-1"), /no such table: wardsynq_record/,
    "an unapplied schema must surface as a plain missing-table error, never as an empty chart");
});

test("every D1Repository read and write runs against real SQL and returns real rows", { skip: DatabaseSync ? false : SKIP }, async () => {
  const db = freshDb();
  const repo = new D1Repository(d1(db));

  const p1 = rec({ patientId: "pat-1" });
  const out = await repo.append("t1", [p1], { idempotencyKey: "key-1", audit: { action: "record.write", actor: "fb:dr-a" } });
  assert.equal(typeof out.seq, "number", "append returns the real autoincrement seq");

  assert.deepEqual(await repo.latest("t1", "Patient", "pat-1"), p1);
  assert.equal(await repo.latest("t1", "Patient", "nope"), null, "a miss is null, not a throw");

  const p2 = rec({ version: 2, patientId: "pat-1", meta: { recordedAt: "2026-09-07T01:00:00.000Z", effectiveAt: null } });
  await repo.append("t1", [p2]);
  assert.equal((await repo.latest("t1", "Patient", "pat-1")).version, 2, "latest really means highest version");
  assert.deepEqual((await repo.history("t1", "Patient", "pat-1")).map((r) => r.version), [1, 2], "history is ascending and complete");

  // byPatient must return the LATEST version per id — the GROUP BY/JOIN, actually executed.
  const o1 = { resourceType: "Observation", id: "obs-1", version: 1, patientId: "pat-1", meta: { recordedAt: "2026-09-07T02:00:00.000Z", effectiveAt: null }, writtenBy: { id: "fb:nurse", kind: "human" }, value: 120 };
  const o1v2 = { ...o1, version: 2, value: 130 };
  const o2 = { ...o1, id: "obs-2", version: 1, value: 80 };
  await repo.append("t1", [o1]); await repo.append("t1", [o1v2]); await repo.append("t1", [o2]);
  const byPat = await repo.byPatient("t1", "Observation", "pat-1");
  assert.deepEqual(byPat.map((r) => [r.id, r.version]), [["obs-1", 2], ["obs-2", 1]], "one row per id, each at its latest version");
  assert.equal(byPat.find((r) => r.id === "obs-1").value, 130, "the latest version's body, not the first");

  const roster = await repo.latestByType("t1", "Observation", 10);
  assert.deepEqual(roster.map((r) => r.id), ["obs-1", "obs-2"]);

  // The change feed and its cursor.
  const page1 = await repo.changes("t1", 0, 2);
  assert.equal(page1.records.length, 2);
  assert.ok(page1.cursor > 0);
  const page2 = await repo.changes("t1", page1.cursor, 100);
  assert.ok(page2.records.every((r) => r.seq > page1.cursor), "paging never repeats a row");

  assert.deepEqual(await repo.recall("t1", "key-1"), { resourceType: "Patient", id: "pat-1", version: 1 });
  assert.equal(await repo.recall("t1", "no-such-key"), null);

  await repo.auditOnly("t1", { action: "record.read", actor: "fb:dr-a" });
  const audits = db.prepare("SELECT action FROM connect_audit_event WHERE tenant_id=?").all("t1");
  assert.ok(audits.length >= 2, "the write's audit event and the read's both landed");
});

test("the UNIQUE constraint is the concurrency control: a real violation is a VersionConflictError and the batch rolls back", { skip: DatabaseSync ? false : SKIP }, async () => {
  const db = freshDb();
  const repo = new D1Repository(d1(db));
  await repo.append("t1", [rec()], { audit: { action: "record.write", actor: "a" } });

  // A second client derived the same version from the same parent. The DB itself refuses it.
  await assert.rejects(() => repo.append("t1", [rec()]), VersionConflictError, "a lost race is a conflict, never an overwrite");

  const rows = db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record WHERE id='pat-1'").get();
  assert.equal(rows.n, 1, "the loser wrote nothing");

  // Atomicity: a batch whose LAST statement violates must leave none of the earlier ones behind.
  const good = rec({ id: "pat-9", version: 1 });
  const dup = rec({ id: "pat-1", version: 1 });
  await assert.rejects(() => repo.append("t1", [good, dup]), VersionConflictError);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record WHERE id='pat-9'").get().n, 0, "the batch is all-or-nothing");
});

test("tenancy is enforced in SQL: one hospital's rows are invisible to another", { skip: DatabaseSync ? false : SKIP }, async () => {
  const db = freshDb();
  const repo = new D1Repository(d1(db));
  await repo.append("t1", [rec({ patientId: "pat-1" })]);
  // The SAME record id in a different tenant is a different record, and neither can see the other.
  await repo.append("t2", [rec({ patientId: "pat-1", writtenBy: { id: "fb:other", kind: "human" } })]);

  assert.equal((await repo.latest("t1", "Patient", "pat-1")).writtenBy.id, "fb:dr-a");
  assert.equal((await repo.latest("t2", "Patient", "pat-1")).writtenBy.id, "fb:other");
  assert.equal((await repo.byPatient("t2", "Observation", "pat-1")).length, 0);
  assert.equal((await repo.changes("t2", 0, 100)).records.length, 1, "the feed is per tenant, not global");
});

test("the whole record service runs on real SQL: governed writes, versioning and the chart read", { skip: DatabaseSync ? false : SKIP }, async () => {
  const db = freshDb();
  const repo = new D1Repository(d1(db));
  const svc = new RecordService({
    repository: repo, pseudonym: async () => null,
    tenant: { id: "t1", name: "Test", mode: "live" },
    actor: makeActor({ id: "fb:dr-a", kind: KIND.HUMAN, tier: TIER.EXECUTE, display: "Dr A", credential: "held-by-server" }),
    role: "doctor", roleSource: "opd",
  });

  const patient = Patient({ id: "opd-pat-x1", mrn: "X1", name: "Demo Testcase", dob: "1990-01-01", sex: "female",
    source: { system: "wardsynq-native", sourceId: "opd-registration:opd-pat-x1" } });
  const w1 = await svc.put(patient);
  assert.equal(w1.record.version, 1);
  assert.equal((await svc.get("Patient", "opd-pat-x1")).name, "Demo Testcase");

  // A second write of the same identity is a new VERSION, never a second entity.
  const w2 = await svc.put({ ...patient, name: "Demo Testcase Renamed" }, { expectedVersion: 1 });
  assert.equal(w2.record.version, 2);
  assert.equal(db.prepare("SELECT COUNT(DISTINCT id) AS n FROM wardsynq_record WHERE resource_type='Patient'").get().n, 1);

  // A stale expectedVersion loses, in real SQL.
  await assert.rejects(() => svc.put({ ...patient, name: "Third" }, { expectedVersion: 1 }));

  const obs = Observation({ id: "obs-x1", patientId: "opd-pat-x1", category: "vital-signs", code: "8867-4",
    codeSystem: "http://loinc.org", value: 78, unit: "/min", effectiveAt: "2026-09-07T03:00:00.000Z",
    source: { system: "wardsynq-native", sourceId: "opd-ticket:t" } });
  await svc.put(obs);

  const chart = await svc.chart("opd-pat-x1");
  assert.equal(chart.Patient.length, 1);
  assert.equal(chart.Observation.length, 1);
  assert.equal(chart.Patient[0].version, 2, "the chart shows the current version");

  // Append-only: the store has grown, and nothing was ever mutated in place.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM wardsynq_record").get().n, 3);
  assert.deepEqual((await svc.history("Patient", "opd-pat-x1")).map((r) => r.version), [1, 2]);
});
