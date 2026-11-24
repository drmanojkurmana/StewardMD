-- ResearchMD Phase 3 migration 0004 (3.4 extraction, 3.5 suggestions,
-- 3.6 risk of bias, 3.8 study-level data import) plus the Phase 4.3 GRADE
-- assessment store. Applies cleanly on top of LIVE 0001 + 0002 + 0003.
-- Forward-only; rollback: 0004_rollback.sql. Times are epoch milliseconds.
--
-- Scope decisions (documented per the builder brief):
-- * Extraction values live in research_extractions.fields_json (one row per
--   project+study). Every value keeps a locator AND a verbatim quote; field
--   status is unverified|verified|corrected. Only verified/corrected may
--   promote to a research_studies row (the engine reads verified studies only).
-- * T1 suggestions (3.5) are stored UNVERIFIED in their own tables and are
--   never auto-applied: extraction suggestions surface in the extraction
--   resource's suggestions[] and move into a field still unverified on Accept;
--   screening suggestions never write a research_screening_decisions row.
-- * The extraction.md artifact resource (PDF + its pdf_extract job) is backed
--   by research_extraction_artifacts, linking research_pdfs (0003) to
--   research_job_runs (0003). The pilot research_artifacts table is untouched.
-- * RoB mirrors the screening blinding pattern (blinding.md B1-B7): one
--   immutable row per assessor per study+tool (latest counts), one conflict
--   row per study+tool, consensus stored on the conflict.
-- * Data import is STUDY-LEVEL only; the IPD gate (5C) is enforced in the API.
--   Every import writes a frozen R2 snapshot; versions are monotonic per
--   project. Dictionaries are versioned the same way.
-- * GRADE assessments (4.3) persist the human judgment per saved run; the
--   certainty arithmetic stays in research-grade.js (pure). The API stores the
--   input and the assessOutcome result and recomputes Summary of Findings from
--   stored runs. No LLM is involved in GRADE.

PRAGMA foreign_keys = ON;

-- PDF artifacts for the extraction contract (3.2/3.3): one per uploaded PDF
-- per project, linked to its pdf_extract job. status mirrors the job.
CREATE TABLE IF NOT EXISTS research_extraction_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  pdf_id TEXT NOT NULL REFERENCES research_pdfs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  pages INTEGER,
  job_id TEXT REFERENCES research_job_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, pdf_id)
);
CREATE INDEX IF NOT EXISTS idx_research_extraction_artifacts_project
  ON research_extraction_artifacts(project_id, created_ts DESC);

-- Extraction resource (3.4), keyed by (project, study). fields_json is the map
-- of field key -> {value, locator, quote, status, source, verifier, verifiedAt}.
CREATE TABLE IF NOT EXISTS research_extractions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES research_studies(id) ON DELETE CASCADE,
  artifact_id TEXT,
  template TEXT NOT NULL
    CHECK(template IN ('rct_binary','rct_continuous','generic_effect')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','verified')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  UNIQUE(project_id, study_id)
);
CREATE INDEX IF NOT EXISTS idx_research_extractions_project
  ON research_extractions(project_id, updated_ts DESC);

-- Pending T1 extraction suggestions (3.5). Always unverified until a human
-- Accepts (moves into a field, still unverified) then Verifies. Accepted and
-- rejected rows stay for audit; only unverified rows surface in suggestions[].
CREATE TABLE IF NOT EXISTS research_extraction_suggestions (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL REFERENCES research_extractions(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  locator_json TEXT,
  quote TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(status IN ('unverified','accepted','rejected')),
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_extraction_suggestions_extraction
  ON research_extraction_suggestions(extraction_id, status, created_ts);

-- Extraction audit trail (3.4): append-only. Corrections carry old/new/reason.
CREATE TABLE IF NOT EXISTS research_extraction_audit (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL REFERENCES research_extractions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK(kind IN ('field_saved','verified','corrected','suggestion_accepted','promoted')),
  field_key TEXT NOT NULL DEFAULT '',
  old_json TEXT,
  new_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  by_uid TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_extraction_audit_extraction
  ON research_extraction_audit(extraction_id, ts DESC);

-- Risk-of-bias assessments (3.6): one immutable row per assessor per
-- study+tool. The latest row per assessor counts (B2); earlier rows stay for
-- audit. domains_json is [{key, judgment, quote, locator, signallingAnswers?,
-- applicability?, stars?}]. overall is recomputed by the tool's overallRule.
CREATE TABLE IF NOT EXISTS research_rob_assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES research_studies(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK(tool IN ('rob2','robins_i','quadas2','nos')),
  assessor_uid TEXT NOT NULL,
  domains_json TEXT NOT NULL DEFAULT '[]',
  overall TEXT NOT NULL DEFAULT '',
  stars INTEGER,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_rob_assessments_latest
  ON research_rob_assessments(project_id, study_id, tool, assessor_uid, created_ts DESC);

-- One RoB conflict per study+tool (B3). Consensus domains replace the
-- conflicted judgments on resolve; overall is recomputed by the tool rule.
CREATE TABLE IF NOT EXISTS research_rob_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  study_id TEXT NOT NULL REFERENCES research_studies(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK(tool IN ('rob2','robins_i','quadas2','nos')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  consensus_json TEXT,
  note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  resolved_ts INTEGER,
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, study_id, tool)
);
CREATE INDEX IF NOT EXISTS idx_research_rob_conflicts_project
  ON research_rob_conflicts(project_id, status, created_ts DESC);

-- Study-level data dictionaries (3.8), versioned per project. columns_json is
-- [{column, label, type, unit, required, range:{min,max}, allowed:[...]}].
CREATE TABLE IF NOT EXISTS research_data_dictionaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  columns_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_research_data_dictionaries_project
  ON research_data_dictionaries(project_id, version DESC);

-- Study-level data imports (3.8), versioned per project. A frozen R2 snapshot
-- is ALWAYS written (snapshot_key), even when checks fail. rows_imported counts
-- only rows that passed blocking checks. frozen locks the analysis dataset.
CREATE TABLE IF NOT EXISTS research_data_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  storage_key TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count >= 0),
  rows_imported INTEGER NOT NULL DEFAULT 0 CHECK(rows_imported >= 0),
  status TEXT NOT NULL CHECK(status IN ('ok','warnings','errors')),
  checks_json TEXT NOT NULL DEFAULT '[]',
  dictionary_version INTEGER NOT NULL CHECK(dictionary_version >= 1),
  frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN (0, 1)),
  frozen_ts INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_research_data_imports_project
  ON research_data_imports(project_id, version DESC);

-- T1 screening suggestions (3.5). Never write a screening decision; a reviewer
-- who accepts one submits their own vote through the decisions route (B6).
CREATE TABLE IF NOT EXISTS research_screening_suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(status IN ('unverified','accepted','rejected')),
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_screening_suggestions_record
  ON research_screening_suggestions(project_id, record_id, created_ts DESC);

-- GRADE assessments (4.3), one per saved run per project. input_json carries
-- the human domain judgments and upgrades; result_json the assessOutcome
-- output (certainty, downgrades, upgrades, symbols, footnotes). The certainty
-- arithmetic lives in research-grade.js; this table only persists judgments.
CREATE TABLE IF NOT EXISTS research_grade_assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  design TEXT NOT NULL CHECK(design IN ('rct','observational')),
  input_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  baseline_risk REAL,
  mid REAL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  UNIQUE(project_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_research_grade_assessments_project
  ON research_grade_assessments(project_id, updated_ts DESC);
