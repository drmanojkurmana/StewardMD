// functions/_connect/abdm/migrate.js — the ABDM schema migration, as code rather than as a comment.
//
// THE PROBLEM THIS SOLVES. db/connect_abdm_schema.sql is all `CREATE TABLE IF NOT EXISTS`, which is
// perfect for a fresh D1 and does NOTHING for a provisioned one: SQLite has no
// ADD-COLUMN-IF-NOT-EXISTS, so every column added after the first deploy sat behind a comment saying
// "a provisioned D1 needs `ALTER TABLE ... ADD COLUMN ...`". Five such comments had accumulated. A
// migration that lives in a comment is a migration somebody forgets, and the failure mode is a query
// referencing a column that is not there - at runtime, in production, on a patient's record.
//
// SO THE SHAPE IS DECLARATIVE. Below is what the schema MUST look like. The runner introspects what is
// actually there and applies only the difference, which makes it:
//   - idempotent      running it twice changes nothing the second time
//   - order-free      it does not matter which deploy you are coming from
//   - safe            it only ever ADDs; it never drops, renames or rewrites a column
//
// ADDITIVE ONLY, and that is the rollback story. A new nullable column is invisible to code that does
// not select it, so the previous release keeps working against a migrated database. There is nothing to
// roll back: redeploying the old Worker is sufficient, and no data is lost either way. That property is
// worth more than a down-migration, and it is why nothing here is destructive.

export class MigrationError extends Error {}

/** Columns that must exist, per table. Everything here is nullable - see the additive-only note above. */
export const REQUIRED_COLUMNS = Object.freeze({
  connect_abdm_consent_req: Object.freeze({
    // Stage-6 T2: the patient-level erasure deadline, distinct from consent validity.
    data_erase_at: "TEXT",
    // M3: the CM's own consent-REQUEST id. NOT consent_id, which is the artefact id and only exists once
    // the patient grants - without this a grant cannot be matched to the request that asked for it.
    consent_request_id: "TEXT",
    // M3: when we last fetched under this consent, for the 14-day re-consent window.
    last_fetched_at: "TEXT",
  }),
  connect_abdm_txn: Object.freeze({
    // Stage-6 T3: the computed transfer outcome, persisted before the hiNotify so a crash is recoverable.
    session_status: "TEXT",
    // Stage-6 T3: the receipt-delivery marker reconcileNotify keys off.
    notify_confirmed: "TEXT",
  }),
});

/** Tables that must exist. Each entry is the full CREATE, run only when the table is absent. */
export const REQUIRED_TABLES = Object.freeze({
  connect_abdm_consented_record:
    `CREATE TABLE connect_abdm_consented_record (
       tenant_id TEXT NOT NULL, patient_abha_hash TEXT NOT NULL, ref_hash TEXT NOT NULL,
       care_context_ref TEXT NOT NULL, hi_type TEXT, r2_key TEXT NOT NULL, bytes INTEGER,
       source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, ref_hash))`,
  connect_abdm_enrol_consent:
    `CREATE TABLE connect_abdm_enrol_consent (
       id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL, patient_ref TEXT,
       version TEXT NOT NULL, agreed TEXT NOT NULL, flow TEXT, created_at TEXT NOT NULL, used_at TEXT)`,
  connect_abdm_demographic:
    `CREATE TABLE connect_abdm_demographic (
       tenant_id TEXT NOT NULL, patient_ref TEXT NOT NULL, mobile_hash TEXT, mrn_hash TEXT,
       name_hash TEXT, gender TEXT, year_of_birth INTEGER,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, patient_ref))`,
});

/** Indexes that must exist. CREATE INDEX IF NOT EXISTS is already idempotent, so these run unconditionally. */
export const REQUIRED_INDEXES = Object.freeze([
  "CREATE INDEX IF NOT EXISTS idx_consented_patient ON connect_abdm_consented_record (tenant_id, patient_abha_hash)",
  "CREATE INDEX IF NOT EXISTS idx_enrol_consent_tenant ON connect_abdm_enrol_consent (tenant_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_demographic_mobile ON connect_abdm_demographic (tenant_id, mobile_hash)",
  "CREATE INDEX IF NOT EXISTS idx_demographic_mrn ON connect_abdm_demographic (tenant_id, mrn_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_req_cid ON connect_abdm_consent_req(consent_id) WHERE consent_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_abdm_txn_txid ON connect_abdm_txn(transaction_id) WHERE transaction_id IS NOT NULL",
]);

// A column or table name reaching DDL cannot be parameterised, so it is validated instead. Everything
// here is a compile-time constant from the maps above; this guard exists so that stays true.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ident = (s) => {
  if (!SAFE_IDENT.test(String(s))) throw new MigrationError("unsafe identifier: " + s);
  return s;
};

/**
 * Apply the migration.
 *
 * @param io.all   async (sql) => rows      - for PRAGMA introspection
 * @param io.exec  async (sql) => void      - for DDL
 * @param opts.dryRun  report what WOULD change without touching anything
 * @returns { applied:[...], skipped:[...], tablesCreated:[...], columnsAdded:[...] }
 */
export async function migrateAbdm(io, opts = {}) {
  if (!io || typeof io.all !== "function" || typeof io.exec !== "function") {
    throw new MigrationError("migrate needs { all, exec }");
  }
  const dryRun = opts.dryRun === true;
  const out = { applied: [], skipped: [], tablesCreated: [], columnsAdded: [] };

  const existingTables = new Set((await io.all(
    "SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name));

  // 1. Tables. Only created when absent, so an existing table with data is never touched.
  for (const [table, ddl] of Object.entries(REQUIRED_TABLES)) {
    if (existingTables.has(table)) { out.skipped.push("table:" + table); continue; }
    if (!dryRun) await io.exec(ddl);
    out.tablesCreated.push(table);
    out.applied.push("table:" + table);
    existingTables.add(table);
  }

  // 2. Columns. PRAGMA table_info is the only honest answer to "is this column there?".
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existingTables.has(table)) {
      // The base schema has never been applied. Adding columns to a table that does not exist would
      // fail, and inventing the table here would duplicate db/connect_abdm_schema.sql - which is the
      // single source of truth for the base shape. Report it rather than guess.
      out.skipped.push("missing-base-table:" + table);
      continue;
    }
    const have = new Set((await io.all("PRAGMA table_info(" + ident(table) + ")")).map((r) => r.name));
    for (const [col, type] of Object.entries(columns)) {
      if (have.has(col)) { out.skipped.push("column:" + table + "." + col); continue; }
      if (!dryRun) await io.exec("ALTER TABLE " + ident(table) + " ADD COLUMN " + ident(col) + " " + type);
      out.columnsAdded.push(table + "." + col);
      out.applied.push("column:" + table + "." + col);
    }
  }

  // 3. Indexes are already IF NOT EXISTS, so they are safe to re-run every time.
  for (const ddl of REQUIRED_INDEXES) {
    const onTable = /\bON\s+(\w+)/i.exec(ddl);
    if (onTable && !existingTables.has(onTable[1])) { out.skipped.push("index-table-missing:" + onTable[1]); continue; }
    if (!dryRun) await io.exec(ddl);
    out.applied.push("index");
  }

  return out;
}

/** Is the schema already where it needs to be? A dry run that changes nothing. */
export async function abdmSchemaCurrent(io) {
  const plan = await migrateAbdm(io, { dryRun: true });
  return { current: plan.tablesCreated.length === 0 && plan.columnsAdded.length === 0, plan };
}
