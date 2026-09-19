-- StewardMD — Government Health Schemes module schema (Cloudflare D1 / SQLite)
-- Database: stewardmd-govschemes   Pages binding: GOVSCHEMES_DB
--
-- Apply:   wrangler d1 execute stewardmd-govschemes --remote --file functions/db/govschemes_schema.sql
--
-- Design notes:
--   • Native government codes/names are stored EXACTLY as published - never normalized,
--     reformatted, or "corrected" in place. A correction is a NEW scheme_version; the old
--     one stays queryable and is never overwritten (see scheme_versions.status).
--   • A full published package master (one government XLSX/PDF/portal export) = ONE
--     scheme_version. Packages version at that granularity, not row-by-row - it matches how
--     these documents are actually issued (whole replacements, not incremental diffs) and
--     keeps "what did the AP scheme look like in 2024 vs 2025" a single join, not a temporal
--     query per row.
--   • package_amount / rider_amount are INTEGER whole rupees, matching source precision seen
--     in the first real dataset (Dr. NTR Vaidya Seva Trust workbook: values like "25000", no
--     decimals). If a future source publishes paise or decimal rupees, convert at import time
--     and note the conversion in that scheme_version's crawl_logs.detail - never guess silently.
--   • Timestamps are INTEGER epoch milliseconds. Booleans are INTEGER 0/1.
--   • jurisdictions is the top of the tree: 28 states + 8 UTs + 1 "central" row (Phase 1 seeds
--     the registry; population happens across Phase 1-2 per vault/decisions/Decisions.md).
--   • Mirrors the shape of functions/db/updates_schema.sql (Medical Updates module) - the
--     closest existing precedent for versioned reference data with source/provenance
--     tracking - rather than inventing a new pattern. See vault/decisions/Decisions.md.

-- ---- Jurisdictions: 28 states + 8 UTs + Central ----
CREATE TABLE IF NOT EXISTS jurisdictions (
  id   TEXT PRIMARY KEY,             -- slug, e.g. "andhra-pradesh", "central"
  name TEXT NOT NULL,                -- "Andhra Pradesh"
  type TEXT NOT NULL,                -- state|ut|central
  code TEXT DEFAULT ''               -- ISO 3166-2:IN code where applicable, e.g. "AP"
);

-- ---- Source registry (admin-editable; one row per govt document/portal watched) ----
CREATE TABLE IF NOT EXISTS sources (
  id                   TEXT PRIMARY KEY,   -- slug, e.g. "ap-ntr-vaidya-seva-2026"
  jurisdiction_id      TEXT NOT NULL,
  authority            TEXT NOT NULL DEFAULT '',  -- "Dr. NTR Vaidya Seva Trust"
  url                  TEXT DEFAULT '',            -- source document URL
  homepage             TEXT DEFAULT '',            -- scheme portal
  document_type        TEXT NOT NULL DEFAULT 'xlsx',  -- xlsx|xls|csv|pdf|html
  document_date        TEXT DEFAULT '',            -- as published, e.g. "2026-04-01" (partial dates ok)
  retrieved_ts         INTEGER NOT NULL DEFAULT 0,
  verification_status  TEXT NOT NULL DEFAULT 'unverified',  -- unverified|verified|stale
  enabled              INTEGER NOT NULL DEFAULT 1,
  created_ts           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gs_sources_jur ON sources(jurisdiction_id);

-- ---- Schemes: one row per named government scheme ----
CREATE TABLE IF NOT EXISTS schemes (
  id              TEXT PRIMARY KEY,   -- slug, e.g. "ap-ntr-vaidya-seva"
  jurisdiction_id TEXT NOT NULL,
  name            TEXT NOT NULL,      -- "Dr. NTR Vaidya Seva"
  authority       TEXT DEFAULT '',    -- responsible trust/department
  status          TEXT NOT NULL DEFAULT 'active'  -- active|discontinued|superseded
);
CREATE INDEX IF NOT EXISTS idx_gs_schemes_jur ON schemes(jurisdiction_id);

-- ---- Scheme versions: one row per published package-master document ----
CREATE TABLE IF NOT EXISTS scheme_versions (
  id             TEXT PRIMARY KEY,    -- "sv<base36ts><rand>"
  scheme_id      TEXT NOT NULL,
  version_label  TEXT NOT NULL,       -- "2026", "2026-04" - whatever the source itself calls it
  source_id      TEXT DEFAULT '',
  effective_date TEXT DEFAULT '',
  content_hash   TEXT DEFAULT '',     -- SHA-256 over the normalized package rows, for change detection
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft|active|superseded
  published_ts   INTEGER DEFAULT 0,
  created_ts     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gs_sv_scheme ON scheme_versions(scheme_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_gs_sv_status ON scheme_versions(scheme_id, status);

-- ---- Packages: one row per (speciality, treatment code) within a scheme_version ----
-- Native codes stored EXACTLY as published - see design notes above.
CREATE TABLE IF NOT EXISTS packages (
  id                 TEXT PRIMARY KEY,
  scheme_version_id  TEXT NOT NULL,
  speciality_code    TEXT NOT NULL DEFAULT '',   -- native, e.g. "S7"
  speciality_name    TEXT NOT NULL DEFAULT '',   -- native, e.g. "CARDIAC AND CARDIOTHORACIC SURGERY"
  treatment_code     TEXT NOT NULL DEFAULT '',   -- native, e.g. "S7.1.5.1" - NEVER altered
  treatment_name     TEXT NOT NULL DEFAULT '',
  treatment_type     TEXT DEFAULT '',            -- native, e.g. IP|OP|DC|ST
  package_amount     INTEGER DEFAULT 0,
  rider_amount       INTEGER DEFAULT 0,          -- scheme-specific top-up (AP source calls it "Aasara")
  pre_investigation  TEXT DEFAULT '',
  post_investigation TEXT DEFAULT '',
  eligibility        TEXT DEFAULT '',
  documentation      TEXT DEFAULT '',
  preauth_required   INTEGER DEFAULT 0
);
-- Natural key confirmed against the first real dataset (Dr. NTR Vaidya Seva, 3713 rows): a
-- treatment_code alone is NOT unique (332 codes are legitimately reused across specialities,
-- e.g. S11.36.3 appears under Cardiothoracic, ENT, and General Surgery with different amounts) -
-- (scheme_version_id, speciality_code, treatment_code) is the real natural key, zero collisions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_packages_natkey ON packages(scheme_version_id, speciality_code, treatment_code);
CREATE INDEX IF NOT EXISTS idx_gs_packages_sv ON packages(scheme_version_id);
CREATE INDEX IF NOT EXISTS idx_gs_packages_code ON packages(treatment_code);

-- ---- Full-text search over packages (mirrors drugs_fts, worker/schema.sql) ----
CREATE VIRTUAL TABLE IF NOT EXISTS packages_fts USING fts5(
  treatment_name, speciality_name, treatment_code,
  content='packages', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS packages_ai AFTER INSERT ON packages BEGIN
  INSERT INTO packages_fts(rowid, treatment_name, speciality_name, treatment_code)
  VALUES (new.rowid, new.treatment_name, new.speciality_name, new.treatment_code);
END;
CREATE TRIGGER IF NOT EXISTS packages_ad AFTER DELETE ON packages BEGIN
  INSERT INTO packages_fts(packages_fts, rowid, treatment_name, speciality_name, treatment_code)
  VALUES ('delete', old.rowid, old.treatment_name, old.speciality_name, old.treatment_code);
END;
CREATE TRIGGER IF NOT EXISTS packages_au AFTER UPDATE ON packages BEGIN
  INSERT INTO packages_fts(packages_fts, rowid, treatment_name, speciality_name, treatment_code)
  VALUES ('delete', old.rowid, old.treatment_name, old.speciality_name, old.treatment_code);
  INSERT INTO packages_fts(rowid, treatment_name, speciality_name, treatment_code)
  VALUES (new.rowid, new.treatment_name, new.speciality_name, new.treatment_code);
END;

-- ---- Import/crawl logs (observability; mirrors updates_schema crawl_logs) ----
CREATE TABLE IF NOT EXISTS crawl_logs (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL DEFAULT 0,
  source_id   TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ok',   -- unchanged|new|updated|error|skipped
  detail      TEXT DEFAULT '',
  rows_in     INTEGER DEFAULT 0,
  rows_out    INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gs_crawl_ts ON crawl_logs(ts DESC);

-- ---- Clinical crosswalk (Phase 2 shape, reserved now so packages needs no migration later) ----
CREATE TABLE IF NOT EXISTS clinical_concepts (
  id     TEXT PRIMARY KEY,           -- slug, e.g. "breast-cancer-mrm"
  name   TEXT NOT NULL,              -- canonical display name
  icd10  TEXT DEFAULT '',
  icd11  TEXT DEFAULT '',
  snomed TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS clinical_synonyms (
  concept_id TEXT NOT NULL,
  synonym    TEXT NOT NULL,          -- "CA breast", "MRM", "carcinoma breast"
  PRIMARY KEY (concept_id, synonym)
);
CREATE TABLE IF NOT EXISTS concept_package_map (
  concept_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  confidence TEXT DEFAULT 'reviewed', -- reviewed|ai_suggested
  PRIMARY KEY (concept_id, package_id)
);
