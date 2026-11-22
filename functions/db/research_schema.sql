-- StewardMD Research — dedicated D1 metadata store.
-- Database: stewardmd-research | Pages binding: RESEARCH_DB
-- Binary files live in private R2; do not store raw patient-level rows here.
-- Times are epoch milliseconds. JSON is validated by the API before persistence.
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

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  started_ts INTEGER,
  completed_ts INTEGER,
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_research_jobs_queue ON research_jobs(status, created_ts);

CREATE TABLE IF NOT EXISTS research_meta_analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL UNIQUE REFERENCES research_jobs(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK(model IN ('fixed','random_dl')),
  effect_measure TEXT NOT NULL CHECK(effect_measure IN ('OR','RR','HR','MD','SMD')),
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  completed_ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_research_meta_project ON research_meta_analyses(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES research_jobs(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_project ON research_artifacts(project_id, created_ts DESC);

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
