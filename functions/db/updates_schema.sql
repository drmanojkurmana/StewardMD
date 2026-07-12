-- StewardMD — Medical Updates module schema (Cloudflare D1 / SQLite)
-- Database: stewardmd-updates   Pages binding: UPDATES_DB
--
-- Apply:   wrangler d1 execute stewardmd-updates --remote --file functions/db/updates_schema.sql
-- Seed:    wrangler d1 execute stewardmd-updates --remote --file functions/db/seed_sources.sql
--
-- Design notes:
--   • Store ONLY metadata + original AI summaries + links. Never PDFs, figures,
--     tables, or verbatim guideline text (copyright).
--   • Timestamps are INTEGER epoch milliseconds. Booleans are INTEGER 0/1.
--   • summary_json / whats_changed_json hold the full structured AI output as TEXT
--     (JSON). The scalar columns are denormalised copies used for fast list queries.

-- ---- Source registry (admin-editable; replaces the hardcoded DEFAULT_FEEDS) ----
CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,          -- slug, e.g. "fda-press"
  name           TEXT NOT NULL,             -- display name, e.g. "FDA Press Releases"
  workspace      TEXT NOT NULL DEFAULT 'internal_medicine',  -- one of the 8 workspaces
  branch         TEXT DEFAULT '',           -- sub-specialty within internal_medicine (cardiology, …); '' = general
  type           TEXT NOT NULL DEFAULT 'guideline',          -- guideline|drug_approval|safety_alert|trial
  homepage       TEXT DEFAULT '',           -- org homepage (shown as a reference link)
  guideline_page TEXT DEFAULT '',           -- page to HEAD-poll when parser_type='head'
  rss_url        TEXT DEFAULT '',           -- RSS/Atom feed when parser_type='rss'
  parser_type    TEXT NOT NULL DEFAULT 'rss',                -- rss|head
  priority       INTEGER NOT NULL DEFAULT 100,               -- lower = crawled first
  enabled        INTEGER NOT NULL DEFAULT 1,
  -- conditional-request state for parser_type='head' (metadata comparison before download)
  etag           TEXT DEFAULT '',
  last_modified  TEXT DEFAULT '',
  content_length TEXT DEFAULT '',
  last_crawl_ts  INTEGER DEFAULT 0,
  created_ts     INTEGER NOT NULL DEFAULT 0
);

-- ---- One row per distinct medical update (guideline / approval / alert / trial) ----
CREATE TABLE IF NOT EXISTS updates (
  id              TEXT PRIMARY KEY,         -- "u<base36ts><rand>"
  doc_key         TEXT NOT NULL,            -- canonical dedup key (official_url or guid)
  source_id       TEXT DEFAULT '',
  type            TEXT NOT NULL DEFAULT 'guideline',
  organization    TEXT DEFAULT '',
  workspace       TEXT NOT NULL DEFAULT 'internal_medicine',
  branch          TEXT DEFAULT '',          -- sub-specialty within internal_medicine
  title           TEXT NOT NULL,
  body            TEXT DEFAULT '',          -- short preview (back-compat with old feed card)
  category        TEXT DEFAULT 'general',   -- legacy category (back-compat: approval|safety|...)
  published_ts    INTEGER NOT NULL DEFAULT 0,
  importance      TEXT NOT NULL DEFAULT 'normal',  -- normal|high|critical
  est_read_min    INTEGER DEFAULT 0,
  summary         TEXT DEFAULT '',          -- original AI prose, <= 700 words
  summary_json    TEXT DEFAULT '',          -- full structured AI fields (JSON)
  official_url    TEXT DEFAULT '',
  official_pdf_url TEXT DEFAULT '',
  doi             TEXT DEFAULT '',
  pmid            TEXT DEFAULT '',
  keywords        TEXT DEFAULT '',
  version         TEXT DEFAULT '',
  content_hash    TEXT DEFAULT '',          -- SHA-256 of the metadata used for dedup
  auto            INTEGER NOT NULL DEFAULT 1,      -- 1=pipeline, 0=manual publish
  pinned          INTEGER NOT NULL DEFAULT 0,
  created_ts      INTEGER NOT NULL DEFAULT 0,
  updated_ts      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_updates_dockey ON updates(doc_key);
CREATE INDEX IF NOT EXISTS idx_updates_feed  ON updates(published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_type  ON updates(type, published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_ws    ON updates(workspace, published_ts DESC);
CREATE INDEX IF NOT EXISTS idx_updates_branch ON updates(branch, published_ts DESC);

-- ---- Version history (What's-Changed lives here; diff populated in Phase 3) ----
CREATE TABLE IF NOT EXISTS update_versions (
  id                TEXT PRIMARY KEY,
  update_id         TEXT NOT NULL,
  version           TEXT DEFAULT '',
  published_ts      INTEGER NOT NULL DEFAULT 0,
  summary_json      TEXT DEFAULT '',
  whats_changed_json TEXT DEFAULT '',       -- [{topic, previous, current, impact}]
  content_hash      TEXT DEFAULT '',
  created_ts        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_versions_update ON update_versions(update_id, created_ts DESC);

-- ---- Crawl logs (observability; pruned to recent N) ----
CREATE TABLE IF NOT EXISTS crawl_logs (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL DEFAULT 0,
  source_id   TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ok',   -- unchanged|new|updated|error|skipped
  detail      TEXT DEFAULT '',
  ai_used     INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_crawl_ts ON crawl_logs(ts DESC);

-- ---- Per-user notification preferences (used by Phase 2 targeted push) ----
CREATE TABLE IF NOT EXISTS user_prefs (
  uid          TEXT PRIMARY KEY,            -- "fb:<uid>" server-derived identity
  workspaces   TEXT NOT NULL DEFAULT '["internal_medicine"]',  -- JSON array
  branches     TEXT DEFAULT '[]',           -- JSON array of IM sub-specialties (filter pref)
  push_enabled INTEGER NOT NULL DEFAULT 1,
  updated_ts   INTEGER NOT NULL DEFAULT 0
);

-- ---- Cross-device bookmarks (Phase 2; Phase 1 uses localStorage) ----
CREATE TABLE IF NOT EXISTS bookmarks (
  uid        TEXT NOT NULL,
  update_id  TEXT NOT NULL,
  created_ts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, update_id)
);

-- ---- Weekly digest (Phase 4) ----
CREATE TABLE IF NOT EXISTS digests (
  week_key    TEXT PRIMARY KEY,             -- ISO year-week, e.g. "2026-W28"
  summary_json TEXT DEFAULT '',
  created_ts  INTEGER NOT NULL DEFAULT 0
);
