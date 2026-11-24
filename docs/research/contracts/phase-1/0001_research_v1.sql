-- ResearchMD Phase 1 contract migration 0001: projects, members, studies, runs, audit.
-- Database: stewardmd-research (D1, not yet provisioned; Phase 1.8). Times are
-- epoch milliseconds. JSON columns are validated by the API before persistence.
-- Forward-only; the tested rollback is 0001_rollback.sql.
--
-- Relationship to functions/db/research_schema.sql (pilot schema): the
-- research_projects, research_members and research_audit_events definitions
-- below are IDENTICAL to the pilot file, so applying this migration over it is
-- a no-op for those tables (IF NOT EXISTS). This migration ADDS the two
-- Phase 1 tables the pilot schema lacks: research_studies (study rows with an
-- optimistic-concurrency version, evidence locator JSON, and human
-- verification) and research_runs (saved runs computed server-side by
-- importing research-engine.js, with the manifest and engine version).
-- The pilot tables research_jobs, research_meta_analyses and
-- research_artifacts (async queue workflow) are untouched and stay live for
-- the Phase 3 worker; Phase 1.3 reads/writes studies and runs only.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  discipline TEXT NOT NULL DEFAULT 'medicine',
  specialty TEXT NOT NULL DEFAULT '',
  study_type TEXT NOT NULL DEFAULT '',
  research_question TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','deleted')),
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_projects_owner ON research_projects(owner_uid, updated_ts DESC);

CREATE TABLE IF NOT EXISTS research_members (
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','analyst','reviewer','viewer')),
  created_ts INTEGER NOT NULL,
  PRIMARY KEY(project_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_research_members_uid ON research_members(uid, project_id);

CREATE TABLE IF NOT EXISTS research_studies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  measure TEXT NOT NULL CHECK(measure IN ('OR','RR','HR','RD','MD','SMD')),
  inputs_json TEXT NOT NULL DEFAULT '{}',
  locator_json TEXT NOT NULL DEFAULT '{}',
  quote TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0, 1)),
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_studies_project ON research_studies(project_id, updated_ts DESC);

CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  measure TEXT NOT NULL CHECK(measure IN ('OR','RR','HR','RD','MD','SMD')),
  model TEXT NOT NULL DEFAULT 'random_dl' CHECK(model IN ('fixed','random_dl','random_reml')),
  test TEXT NOT NULL DEFAULT 'wald' CHECK(test IN ('wald','knha')),
  level REAL NOT NULL DEFAULT 0.95 CHECK(level > 0 AND level < 1),
  study_versions_json TEXT NOT NULL DEFAULT '[]',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  engine TEXT NOT NULL DEFAULT 'research-engine',
  engine_version TEXT NOT NULL DEFAULT 'rmd1',
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_runs_project ON research_runs(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_audit_project ON research_audit_events(project_id, created_ts DESC);
