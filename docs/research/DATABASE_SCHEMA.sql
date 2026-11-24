-- StewardMD Research — initial metadata schema (Cloudflare D1 / SQLite).
-- Apply only after creating a dedicated research D1 database and binding RESEARCH_DB.
-- Raw patient-level data and document binaries MUST NOT be stored in D1.
-- Timestamps: INTEGER epoch milliseconds. JSON columns are validated by the service.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  discipline TEXT NOT NULL DEFAULT 'medicine',
  specialty TEXT DEFAULT '',
  study_type TEXT DEFAULT '',
  research_question TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','deleted')),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_projects_owner ON research_projects(owner_uid, updated_ts DESC);

CREATE TABLE IF NOT EXISTS research_members (
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  uid TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','analyst','reviewer','viewer')),
  invited_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  PRIMARY KEY(project_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_research_members_uid ON research_members(uid, project_id);

CREATE TABLE IF NOT EXISTS research_datasets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  row_count INTEGER,
  column_count INTEGER,
  deidentification_status TEXT NOT NULL DEFAULT 'not_assessed'
    CHECK(deidentification_status IN ('not_assessed','passed','needs_review','failed')),
  data_dictionary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_datasets_project ON research_datasets(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_dataset_versions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES research_datasets(id),
  version_no INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES research_dataset_versions(id),
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  row_count INTEGER,
  schema_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  transform_manifest_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  UNIQUE(dataset_id, version_no)
);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  journal TEXT DEFAULT '',
  year INTEGER,
  doi TEXT DEFAULT '',
  pmid TEXT DEFAULT '',
  url TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT DEFAULT '',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(verification_status IN ('unverified','machine_checked','human_verified','rejected')),
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_sources_project ON research_sources(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_sources_doi ON research_sources(doi);
CREATE INDEX IF NOT EXISTS idx_research_sources_pmid ON research_sources(pmid);

CREATE TABLE IF NOT EXISTS research_evidence_claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  source_id TEXT NOT NULL REFERENCES research_sources(id),
  claim_text TEXT NOT NULL,
  evidence_span TEXT DEFAULT '',
  locator_json TEXT NOT NULL DEFAULT '{}',
  extraction_json TEXT NOT NULL DEFAULT '{}',
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(verification_status IN ('unverified','human_verified','rejected')),
  verified_by TEXT DEFAULT '',
  verified_ts INTEGER,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_claims_project ON research_evidence_claims(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  progress_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT DEFAULT '',
  error_message_safe TEXT DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT DEFAULT '',
  lease_expires_ts INTEGER,
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  started_ts INTEGER,
  completed_ts INTEGER,
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_research_jobs_project ON research_jobs(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_jobs_queue ON research_jobs(status, created_ts);

CREATE TABLE IF NOT EXISTS research_job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES research_jobs(id),
  step_key TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','skipped','waiting_approval')),
  input_hash TEXT DEFAULT '',
  output_object_key TEXT DEFAULT '',
  output_json TEXT NOT NULL DEFAULT '{}',
  provider_run_id TEXT DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 0,
  started_ts INTEGER,
  completed_ts INTEGER,
  UNIQUE(job_id, step_key)
);

CREATE TABLE IF NOT EXISTS research_analysis_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  dataset_version_id TEXT REFERENCES research_dataset_versions(id),
  job_id TEXT REFERENCES research_jobs(id),
  analysis_type TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  code_object_key TEXT NOT NULL,
  result_object_key TEXT NOT NULL,
  figures_json TEXT NOT NULL DEFAULT '[]',
  tables_json TEXT NOT NULL DEFAULT '[]',
  environment_json TEXT NOT NULL DEFAULT '{}',
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_manuscripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  title TEXT NOT NULL,
  target_journal TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','in_review','approved','exported','rejected')),
  current_version_id TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_manuscripts_project ON research_manuscripts(project_id, updated_ts DESC);

CREATE TABLE IF NOT EXISTS research_manuscript_versions (
  id TEXT PRIMARY KEY,
  manuscript_id TEXT NOT NULL REFERENCES research_manuscripts(id),
  version_no INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  structured_content_json TEXT NOT NULL DEFAULT '{}',
  citation_map_json TEXT NOT NULL DEFAULT '{}',
  result_map_json TEXT NOT NULL DEFAULT '{}',
  integrity_report_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  UNIQUE(manuscript_id, version_no)
);

CREATE TABLE IF NOT EXISTS research_approvals (
  id TEXT PRIMARY KEY,
  manuscript_id TEXT NOT NULL REFERENCES research_manuscripts(id),
  manuscript_version_id TEXT NOT NULL REFERENCES research_manuscript_versions(id),
  approver_uid TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','changes_requested','rejected')),
  comment TEXT DEFAULT '',
  content_hash TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_approvals_version ON research_approvals(manuscript_version_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_model_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  job_id TEXT REFERENCES research_jobs(id),
  step_key TEXT DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  routing_tier TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_model_runs_project ON research_model_runs(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_credit_holds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  job_id TEXT REFERENCES research_jobs(id),
  uid TEXT NOT NULL,
  quoted_credits INTEGER NOT NULL,
  settled_credits INTEGER,
  status TEXT NOT NULL CHECK(status IN ('reserved','settled','released','disputed')),
  wallet_reference TEXT DEFAULT '',
  created_ts INTEGER NOT NULL,
  settled_ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_research_credit_holds_uid ON research_credit_holds(uid, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id),
  actor_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_audit_project ON research_audit_events(project_id, created_ts DESC);
