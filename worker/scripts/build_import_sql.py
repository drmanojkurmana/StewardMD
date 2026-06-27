#!/usr/bin/env python3
"""
StewardMD — Phase 3 import-SQL generator (LOCAL ONLY).

Reads the validated local SQLite (Phase 2) and emits D1-ready SQL:
  00_schema.sql   drugs table + indexes + FTS5 vtable + sync triggers
  10_drugs.sql    idempotent multi-row INSERT OR IGNORE (250 rows/statement)

FTS is populated by the AFTER INSERT trigger as rows load (no giant server-side
rebuild). INSERT OR IGNORE + explicit ids => safe to re-run / resume.

Writes NOTHING to Cloudflare D1. Output under worker/data/import/ (gitignored).
The actual import is a separate, approval-gated step:
  wrangler d1 execute stewardmd-prod --remote --file=worker/data/import/00_schema.sql
  wrangler d1 execute stewardmd-prod --remote --file=worker/data/import/10_drugs.sql
"""
import os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORKER, "data", "stewardmd-drugs.sqlite")
OUTDIR = os.path.join(WORKER, "data", "import")
ROWS_PER_STMT = 80          # secondary cap
MAX_STMT_BYTES = 40000      # primary guard — keep each statement well under D1's ~100 KB limit

COLS = ["id","brand","composition","class","chem_class","action_class","manufacturer",
        "form","pack","mrp","uses","side_effects","substitutes","habit_forming","discontinued"]

SCHEMA = """-- StewardMD D1 import — schema (FTS + triggers BEFORE data so the index
-- populates incrementally as rows insert). Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS drugs (
  id INTEGER PRIMARY KEY, brand TEXT NOT NULL, composition TEXT, class TEXT,
  chem_class TEXT, action_class TEXT, manufacturer TEXT, form TEXT, pack TEXT,
  mrp REAL, uses TEXT, side_effects TEXT, substitutes TEXT, habit_forming TEXT,
  discontinued INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_drugs_brand ON drugs(brand);
CREATE INDEX IF NOT EXISTS idx_drugs_comp  ON drugs(composition);
CREATE VIRTUAL TABLE IF NOT EXISTS drugs_fts USING fts5(
  brand, composition, class, content='drugs', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS drugs_ai AFTER INSERT ON drugs BEGIN
  INSERT INTO drugs_fts(rowid, brand, composition, class)
  VALUES (new.id, new.brand, new.composition, new.class);
END;
CREATE TRIGGER IF NOT EXISTS drugs_ad AFTER DELETE ON drugs BEGIN
  INSERT INTO drugs_fts(drugs_fts, rowid, brand, composition, class)
  VALUES ('delete', old.id, old.brand, old.composition, old.class);
END;
CREATE TRIGGER IF NOT EXISTS drugs_au AFTER UPDATE ON drugs BEGIN
  INSERT INTO drugs_fts(drugs_fts, rowid, brand, composition, class)
  VALUES ('delete', old.id, old.brand, old.composition, old.class);
  INSERT INTO drugs_fts(rowid, brand, composition, class)
  VALUES (new.id, new.brand, new.composition, new.class);
END;
"""

def lit(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

def main():
    if not os.path.exists(SRC):
        sys.exit(f"ERROR: {SRC} not found (run clean_drugs.py first).")
    os.makedirs(OUTDIR, exist_ok=True)
    with open(os.path.join(OUTDIR, "00_schema.sql"), "w", encoding="utf-8") as f:
        f.write(SCHEMA)

    db = sqlite3.connect(SRC)
    cur = db.execute(f"SELECT {','.join(COLS)} FROM drugs ORDER BY id")
    collist = ",".join(COLS)
    n = 0; stmts = 0
    out = os.path.join(OUTDIR, "10_drugs.sql")

    def flush(f, batch):
        f.write(f"INSERT OR IGNORE INTO drugs ({collist}) VALUES\n" + ",\n".join(batch) + ";\n")

    with open(out, "w", encoding="utf-8") as f:
        f.write("PRAGMA defer_foreign_keys=on;\n")
        # Keep each INSERT statement well under D1's per-statement SQL limit
        # (~100 KB). Flush on a 40 KB byte budget OR a row cap, whichever first.
        batch = []; blen = 0
        for row in cur:
            tup = "(" + ",".join(lit(v) for v in row) + ")"
            if batch and (blen + len(tup) + 2 > MAX_STMT_BYTES or len(batch) >= ROWS_PER_STMT):
                flush(f, batch); n += len(batch); stmts += 1; batch = []; blen = 0
            batch.append(tup); blen += len(tup) + 2
        if batch:
            flush(f, batch); n += len(batch); stmts += 1
    db.close()
    size = os.path.getsize(out) / 1e6
    print(f"rows emitted : {n:,}")
    print(f"00_schema.sql: {os.path.getsize(os.path.join(OUTDIR,'00_schema.sql'))} bytes")
    print(f"10_drugs.sql : {size:.1f} MB  ({stmts:,} INSERT statements, <= {MAX_STMT_BYTES//1000} KB each)")
    print(f"out dir      : {OUTDIR}")

if __name__ == "__main__":
    main()
