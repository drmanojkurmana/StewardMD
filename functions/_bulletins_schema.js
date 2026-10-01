/* StewardMD - Clinical Bulletins: tables created on first use (CREATE ... IF NOT EXISTS, once per isolate),
 * the same pattern as functions/_counters.js on this database, so going live needs no manual migration.
 * functions/db/migrate_bulletins.sql stays as the readable, hand-runnable copy; test/bulletins.test.mjs
 * proves these statements build exactly the same tables and indexes as that file.
 */
export const BULLETIN_DDL = [
  "CREATE TABLE IF NOT EXISTS bulletins ( id TEXT PRIMARY KEY, update_id TEXT NOT NULL, source_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', kind TEXT NOT NULL, headline TEXT NOT NULL, what_changed TEXT NOT NULL, applies_to TEXT NOT NULL DEFAULT '', evidence_type TEXT NOT NULL, evidence_note TEXT NOT NULL DEFAULT '', regulator TEXT NOT NULL DEFAULT '', india_status TEXT NOT NULL, source_label TEXT NOT NULL, source_url TEXT NOT NULL, source_date TEXT NOT NULL, doi TEXT NOT NULL DEFAULT '', pmid TEXT NOT NULL DEFAULT '', review_months INTEGER NOT NULL, review_due_ts INTEGER NOT NULL DEFAULT 0, body_hash TEXT NOT NULL, signed_hash TEXT NOT NULL DEFAULT '', signed_uid TEXT NOT NULL DEFAULT '', signed_name TEXT NOT NULL DEFAULT '', signed_reg TEXT NOT NULL DEFAULT '', signed_council TEXT NOT NULL DEFAULT '', signed_ts INTEGER NOT NULL DEFAULT 0, retract_reason TEXT NOT NULL DEFAULT '', created_uid TEXT NOT NULL DEFAULT '', created_ts INTEGER NOT NULL DEFAULT 0, updated_ts INTEGER NOT NULL DEFAULT 0, second_required INTEGER NOT NULL DEFAULT 0, cosigned_hash TEXT NOT NULL DEFAULT '', cosigned_uid TEXT NOT NULL DEFAULT '', cosigned_name TEXT NOT NULL DEFAULT '', cosigned_reg TEXT NOT NULL DEFAULT '', cosigned_council TEXT NOT NULL DEFAULT '', cosigned_ts INTEGER NOT NULL DEFAULT 0, returned_note TEXT NOT NULL DEFAULT '', returned_uid TEXT NOT NULL DEFAULT '', returned_ts INTEGER NOT NULL DEFAULT 0 )",
  "CREATE INDEX IF NOT EXISTS idx_bulletins_update ON bulletins(update_id)",
  "CREATE INDEX IF NOT EXISTS idx_bulletins_status ON bulletins(status, updated_ts DESC)",
  "CREATE TABLE IF NOT EXISTS bulletin_diseases ( bulletin_id TEXT NOT NULL, disease_id TEXT NOT NULL, PRIMARY KEY (bulletin_id, disease_id) )",
  "CREATE INDEX IF NOT EXISTS idx_bd_disease ON bulletin_diseases(disease_id)",
  "CREATE TABLE IF NOT EXISTS bulletin_audit ( id TEXT PRIMARY KEY, bulletin_id TEXT NOT NULL, ts INTEGER NOT NULL, actor_uid TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, body_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '' )",
  "CREATE INDEX IF NOT EXISTS idx_audit_bulletin ON bulletin_audit(bulletin_id, ts DESC)",
  "CREATE TABLE IF NOT EXISTS bulletin_signers ( uid TEXT PRIMARY KEY, name TEXT NOT NULL, reg_no TEXT NOT NULL, council TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, added_by TEXT NOT NULL, added_ts INTEGER NOT NULL, specialties TEXT NOT NULL DEFAULT '' )",
  "CREATE TABLE IF NOT EXISTS bulletin_settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_ts INTEGER NOT NULL DEFAULT 0 )",
  "CREATE TABLE IF NOT EXISTS cdsco_lists ( year INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, release TEXT NOT NULL DEFAULT '', fetched_ts INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL DEFAULT '' )",
  "CREATE TABLE IF NOT EXISTS bulletin_skips ( update_id TEXT PRIMARY KEY, uid TEXT NOT NULL, ts INTEGER NOT NULL )",
];

// Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves an existing table as it was, so each
// is added with ALTER TABLE when missing (ADD COLUMN appends, the same order as the CREATE TABLE above).
// functions/db/migrate_bulletins_v2.sql is the hand-runnable copy.
export const BULLETIN_COLUMNS = [
  ["bulletins", "second_required", "INTEGER NOT NULL DEFAULT 0"],
  ["bulletins", "cosigned_hash", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "cosigned_uid", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "cosigned_name", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "cosigned_reg", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "cosigned_council", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "cosigned_ts", "INTEGER NOT NULL DEFAULT 0"],
  ["bulletins", "returned_note", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "returned_uid", "TEXT NOT NULL DEFAULT ''"],
  ["bulletins", "returned_ts", "INTEGER NOT NULL DEFAULT 0"],
  ["bulletin_signers", "specialties", "TEXT NOT NULL DEFAULT ''"],
];

async function addMissingColumns(db) {
  const tables = Array.from(new Set(BULLETIN_COLUMNS.map((c) => c[0])));
  const alters = [];
  for (const t of tables) {
    const rs = await db.prepare("PRAGMA table_info(" + t + ")").all();
    const have = new Set((rs.results || []).map((r) => r.name));
    for (const c of BULLETIN_COLUMNS) if (c[0] === t && !have.has(c[1])) alters.push(db.prepare("ALTER TABLE " + t + " ADD COLUMN " + c[1] + " " + c[2]));
  }
  if (alters.length) await db.batch(alters);
}

const _ready = new WeakMap();
export function ensureBulletinSchema(db) {
  let p = _ready.get(db);
  if (!p) {
    p = db.batch(BULLETIN_DDL.map((s) => db.prepare(s))).then(() => addMissingColumns(db)).catch((e) => { _ready.delete(db); throw e; });
    _ready.set(db, p);
  }
  return p;
}
