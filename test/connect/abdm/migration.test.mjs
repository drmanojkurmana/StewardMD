// test/connect/abdm/migration.test.mjs — the ABDM schema migration, against a REAL SQLite engine.
//
// This suite deliberately does NOT use the D1 mock. The thing under test is whether actual DDL applies
// cleanly to an actual database, so it runs on node:sqlite: the schema file is parsed for real, ALTER
// TABLE behaves for real, and PRAGMA table_info answers for real. A mock that accepts any SQL would prove
// nothing about a migration.
//
// Three starting points, because those are the three that exist in the world:
//   CLEAN     nothing provisioned yet
//   OLD       provisioned before the columns were added (the case the comments were supposed to cover)
//   CURRENT   already migrated (the idempotency case)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  migrateAbdm, abdmSchemaCurrent, REQUIRED_COLUMNS, REQUIRED_TABLES, MigrationError,
} from "../../../functions/_connect/abdm/migrate.js";

const SCHEMA = readFileSync(new URL("../../../db/connect_abdm_schema.sql", import.meta.url), "utf8");

/** The { all, exec } pair migrateAbdm needs, over a real SQLite handle. */
const ioFor = (db) => ({
  all: async (sql) => db.prepare(sql).all(),
  exec: async (sql) => { db.exec(sql); },
});
const columns = (db, t) => new Set(db.prepare("PRAGMA table_info(" + t + ")").all().map((r) => r.name));
const tables = (db) => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));

/** A database provisioned BEFORE the additive columns existed - the real "old deploy" shape. */
function oldSchemaDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE connect_abdm_consent_req (
    request_id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, patient_abha_hash TEXT,
    status TEXT, consent_id TEXT, hi_types TEXT,
    care_contexts TEXT, purpose TEXT, date_range TEXT,
    created_at TEXT, updated_at TEXT, expires_at TEXT)`);
  db.exec(`CREATE TABLE connect_abdm_txn (
    request_id TEXT PRIMARY KEY, transaction_id TEXT, tenant_id TEXT, consent_id TEXT,
    eph_privkey_sealed TEXT, eph_pub_raw TEXT, our_nonce TEXT,
    ack_claimed INTEGER NOT NULL DEFAULT 0,
    status TEXT, expires_at TEXT, created_at TEXT, updated_at TEXT)`);
  db.exec(`CREATE TABLE connect_abdm_carecontext (
    id TEXT PRIMARY KEY, tenant_id TEXT, patient_abha_hash TEXT, source TEXT,
    ref TEXT, hi_type TEXT, display TEXT, linked_at TEXT)`);
  db.exec(`CREATE TABLE connect_abha_link (
    tenant_id TEXT NOT NULL, patient_abha_hash TEXT NOT NULL, abha_last4 TEXT,
    abha_address_sealed TEXT, patient_ref TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, patient_abha_hash))`);
  return db;
}

// ── the schema file itself ──────────────────────────────────────────────────────────────────────────
test("db/connect_abdm_schema.sql applies to a CLEAN database without error", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);                                  // a syntax error anywhere in the file fails here
  const t = tables(db);
  for (const name of ["connect_abdm_consent_req", "connect_abdm_txn", "connect_abdm_carecontext",
                      "connect_abha_link", ...Object.keys(REQUIRED_TABLES)]) {
    assert.ok(t.has(name), "missing table: " + name);
  }
});

test("the schema file is itself re-runnable (every statement is IF NOT EXISTS)", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(SCHEMA);                                  // a bare CREATE anywhere would throw here
});

test("a CLEAN database gets every additive column from the schema file alone", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const have = columns(db, table);
    for (const col of Object.keys(cols)) assert.ok(have.has(col), table + "." + col + " missing on a fresh DB");
  }
});

// ── CLEAN ───────────────────────────────────────────────────────────────────────────────────────────
test("CLEAN: the migration is a no-op after the schema file has run", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const { current, plan } = await abdmSchemaCurrent(ioFor(db));
  assert.equal(current, true, "nothing should be left to do: " + JSON.stringify(plan));
  assert.deepEqual(plan.tablesCreated, []);
  assert.deepEqual(plan.columnsAdded, []);
});

// ── OLD ─────────────────────────────────────────────────────────────────────────────────────────────
test("OLD: a database provisioned before the columns existed is brought up to date", async () => {
  const db = oldSchemaDb();
  // Prove the starting point really is missing them.
  assert.ok(!columns(db, "connect_abdm_consent_req").has("consent_request_id"));
  assert.ok(!columns(db, "connect_abdm_txn").has("session_status"));

  const out = await migrateAbdm(ioFor(db));

  assert.deepEqual(out.columnsAdded.sort(), [
    "connect_abdm_consent_req.consent_request_id",
    "connect_abdm_consent_req.data_erase_at",
    "connect_abdm_consent_req.last_fetched_at",
    "connect_abdm_txn.notify_confirmed",
    "connect_abdm_txn.session_status",
  ]);
  assert.deepEqual(out.tablesCreated.sort(), Object.keys(REQUIRED_TABLES).sort());
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const have = columns(db, table);
    for (const col of Object.keys(cols)) assert.ok(have.has(col), table + "." + col);
  }
});

test("OLD: existing ROWS survive the migration untouched, with the new columns NULL", async () => {
  const db = oldSchemaDb();
  db.prepare(`INSERT INTO connect_abdm_consent_req
    (request_id,tenant_id,status,consent_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run("rq-1", "t1", "GRANTED", "cid-1", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");

  await migrateAbdm(ioFor(db));

  const row = db.prepare("SELECT * FROM connect_abdm_consent_req WHERE request_id='rq-1'").get();
  assert.equal(row.status, "GRANTED", "an additive migration must not disturb existing data");
  assert.equal(row.consent_id, "cid-1");
  assert.equal(row.consent_request_id, null, "a new column reads NULL for pre-existing rows");
  assert.equal(row.last_fetched_at, null);
});

test("OLD: the new columns are USABLE immediately after migrating", async () => {
  const db = oldSchemaDb();
  await migrateAbdm(ioFor(db));
  db.prepare(`INSERT INTO connect_abdm_consent_req
    (request_id,tenant_id,status,consent_request_id,last_fetched_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run("rq-2", "t1", "INITIATED", "cm-req-99", "2026-08-19T00:00:00Z", "x", "y");
  const row = db.prepare("SELECT * FROM connect_abdm_consent_req WHERE request_id='rq-2'").get();
  assert.equal(row.consent_request_id, "cm-req-99");
  assert.equal(row.last_fetched_at, "2026-08-19T00:00:00Z");
});

// ── CURRENT / idempotency ───────────────────────────────────────────────────────────────────────────
test("CURRENT: re-running the migration changes nothing and does not throw", async () => {
  const db = oldSchemaDb();
  const first = await migrateAbdm(ioFor(db));
  assert.ok(first.columnsAdded.length > 0);

  const second = await migrateAbdm(ioFor(db));
  assert.deepEqual(second.columnsAdded, [], "SQLite has no ADD-COLUMN-IF-NOT-EXISTS, so this is the real risk");
  assert.deepEqual(second.tablesCreated, []);

  const third = await migrateAbdm(ioFor(db));
  assert.deepEqual(third.columnsAdded, []);
});

test("CURRENT: a dry run reports the plan and touches NOTHING", async () => {
  const db = oldSchemaDb();
  const plan = await migrateAbdm(ioFor(db), { dryRun: true });
  assert.ok(plan.columnsAdded.length === 5, "the plan is reported");
  assert.ok(!columns(db, "connect_abdm_consent_req").has("consent_request_id"), "but nothing was applied");
  assert.ok(!tables(db).has("connect_abdm_demographic"));
});

// ── partially-migrated, which is what an interrupted run leaves ──────────────────────────────────────
test("a HALF-migrated database is completed, not restarted", async () => {
  const db = oldSchemaDb();
  db.exec("ALTER TABLE connect_abdm_consent_req ADD COLUMN data_erase_at TEXT");   // one ALTER already ran
  db.exec(REQUIRED_TABLES.connect_abdm_demographic);                               // one table already there
  const out = await migrateAbdm(ioFor(db));
  assert.ok(!out.columnsAdded.includes("connect_abdm_consent_req.data_erase_at"), "already present, skipped");
  assert.ok(out.columnsAdded.includes("connect_abdm_consent_req.consent_request_id"), "the rest still applied");
  assert.ok(!out.tablesCreated.includes("connect_abdm_demographic"));
  assert.ok(out.tablesCreated.includes("connect_abdm_enrol_consent"));
});

// ── refusals ────────────────────────────────────────────────────────────────────────────────────────
test("a database with NO base tables is reported, not invented", async () => {
  const db = new DatabaseSync(":memory:");
  const out = await migrateAbdm(ioFor(db));
  // The new tables are self-contained so they land; the ALTERs cannot, and say so rather than guessing a
  // base shape that db/connect_abdm_schema.sql owns.
  assert.deepEqual(out.tablesCreated.sort(), Object.keys(REQUIRED_TABLES).sort());
  assert.ok(out.skipped.includes("missing-base-table:connect_abdm_consent_req"));
  assert.ok(out.skipped.includes("missing-base-table:connect_abdm_txn"));
  assert.deepEqual(out.columnsAdded, []);
});

test("the migration refuses an io pair it cannot use", async () => {
  await assert.rejects(() => migrateAbdm(null), MigrationError);
  await assert.rejects(() => migrateAbdm({ all: async () => [] }), MigrationError);
});

test("nothing in the migration is destructive - no DROP, DELETE, TRUNCATE or UPDATE", () => {
  // The rollback story IS additive-only: a nullable column is invisible to code that does not select it,
  // so the previous release keeps working against a migrated database and there is nothing to undo.
  const src = readFileSync(new URL("../../../functions/_connect/abdm/migrate.js", import.meta.url), "utf8");
  const ddl = [...Object.values(REQUIRED_TABLES), ...src.matchAll(/"ALTER TABLE[^"]*"/g)].join(" ");
  for (const bad of ["DROP ", "DELETE ", "TRUNCATE", "UPDATE "]) {
    assert.ok(!ddl.toUpperCase().includes(bad), "migration must never " + bad.trim());
  }
});

// ── the whole schema is reachable from the migration ────────────────────────────────────────────────
test("migrating an OLD database lands the SAME shape as a clean schema-file install", async () => {
  const fresh = new DatabaseSync(":memory:");
  fresh.exec(SCHEMA);
  const old = oldSchemaDb();
  await migrateAbdm(ioFor(old));

  // Compare the tables the migration is responsible for, column-set to column-set.
  for (const t of [...Object.keys(REQUIRED_COLUMNS), ...Object.keys(REQUIRED_TABLES)]) {
    const a = [...columns(fresh, t)].sort();
    const b = [...columns(old, t)].sort();
    // The old base tables legitimately lack columns the migration does not own, so assert containment of
    // everything the migration DOES own rather than strict equality.
    const owned = new Set([...Object.keys(REQUIRED_COLUMNS[t] || {}),
                           ...(REQUIRED_TABLES[t] ? a : [])]);
    for (const c of owned) assert.ok(b.includes(c), t + "." + c + " missing after migration");
  }
});
