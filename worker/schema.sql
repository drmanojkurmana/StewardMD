-- StewardMD drug catalogue — D1 (SQLite) schema
-- ===========================================================================
-- APPLIED IN PHASE 3 (import). This file is NOT yet executed against
-- stewardmd-prod. It documents the schema the Worker queries against so the
-- API contract is fixed now. Built & validated locally first (Phase 2).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS drugs (
  id            INTEGER PRIMARY KEY,
  brand         TEXT NOT NULL,   -- Brand
  composition   TEXT,            -- Composition (generic)
  class         TEXT,            -- Therapeutic Class
  chem_class    TEXT,            -- Chemical Class
  action_class  TEXT,            -- Action Class
  manufacturer  TEXT,            -- Manufacturer
  form          TEXT,            -- Dosage Form
  pack          TEXT,            -- Pack
  mrp           REAL,            -- MRP_INR
  uses          TEXT,            -- Uses
  side_effects  TEXT,            -- Side Effects
  substitutes   TEXT,            -- Substitute Brands
  habit_forming TEXT,            -- Habit Forming
  discontinued  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_drugs_brand ON drugs(brand);
CREATE INDEX IF NOT EXISTS idx_drugs_comp  ON drugs(composition);
-- Browse-by-class (/classes, /class): without this the class pages full-scan the table.
-- Apply to an already-imported DB with:
--   wrangler d1 execute stewardmd-prod --remote \
--     --command "CREATE INDEX IF NOT EXISTS idx_drugs_action ON drugs(action_class);"
CREATE INDEX IF NOT EXISTS idx_drugs_action ON drugs(action_class);

-- Full-text search over the searchable columns (external-content FTS5),
-- so search reads only matching rows (cost- and latency-minimal).
CREATE VIRTUAL TABLE IF NOT EXISTS drugs_fts USING fts5(
  brand, composition, class,
  content='drugs', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Keep the FTS index in sync with the base table.
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
