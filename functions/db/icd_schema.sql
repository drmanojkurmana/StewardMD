-- StewardMD — ICD Search: D1 schema (database `stewardmd-icd`, binding `ICD_DB`).
--
-- Public, non-PHI reference data: WHO disease classification codes and titles, both systems
-- clinicians actually use side by side in India today - ICD-10 (WHO ICD-10-CM release, the
-- de-facto billing/coding standard most Indian hospitals and insurers still run on) and ICD-11
-- (WHO's current MMS linearization, the one WHO itself now maintains). Sourced from public WHO/
-- CMS releases (see scripts/icd/README.md for provenance + license notes), not scraped or
-- fabricated - every row traces to a real WHO/CMS publication.
--
-- One flat table, not a hierarchy walk: clinicians search by name or code, they don't browse a
-- chapter tree the way Scheme Search's Browse mode does for 29 jurisdictions' worth of packages -
-- so `chapter` is kept as a display label only, not a foreign key into a separate chapters table.

CREATE TABLE IF NOT EXISTS icd_codes (
  id          TEXT PRIMARY KEY,             -- "icd10:<code>" or "icd11:<code>" - stable, sourced from the code itself
  system      TEXT NOT NULL,                -- 'ICD-10' | 'ICD-11'
  code        TEXT NOT NULL,                -- native code, dotted (e.g. "A00.0", "1A03.0")
  title       TEXT NOT NULL,                -- clinical title/description
  chapter     TEXT NOT NULL DEFAULT '',     -- ICD-10: 3-char category; ICD-11: chapter number - display only
  is_leaf     INTEGER NOT NULL DEFAULT 1    -- 1 = billable/assignable code, 0 = a grouping/chapter/block row (ICD-11 only)
);

CREATE INDEX IF NOT EXISTS idx_icd_system_code ON icd_codes(system, code);
CREATE INDEX IF NOT EXISTS idx_icd_code ON icd_codes(code);

-- FTS5 prefix search over title (+ code, so a partial code like "A00" also surfaces via MATCH,
-- mirroring functions/db/govschemes_schema.sql's packages_fts / ftsQuery() contract exactly).
CREATE VIRTUAL TABLE IF NOT EXISTS icd_fts USING fts5(title, code, content='icd_codes', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS icd_codes_ai AFTER INSERT ON icd_codes BEGIN
  INSERT INTO icd_fts(rowid, title, code) VALUES (new.rowid, new.title, new.code);
END;
CREATE TRIGGER IF NOT EXISTS icd_codes_ad AFTER DELETE ON icd_codes BEGIN
  INSERT INTO icd_fts(icd_fts, rowid, title, code) VALUES ('delete', old.rowid, old.title, old.code);
END;
CREATE TRIGGER IF NOT EXISTS icd_codes_au AFTER UPDATE ON icd_codes BEGIN
  INSERT INTO icd_fts(icd_fts, rowid, title, code) VALUES ('delete', old.rowid, old.title, old.code);
  INSERT INTO icd_fts(rowid, title, code) VALUES (new.rowid, new.title, new.code);
END;
