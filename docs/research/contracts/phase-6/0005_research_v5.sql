-- ResearchMD Phase 6 migration 0005 (packages 5B.3, 5B.5, 5C.2, 5C.3, 5D.1,
-- 6.1, 6.3, 6.5). Contracts: docs/research/contracts/phase-6/*.md.
--
-- Decisions recorded here:
-- 1. NOT idempotent: the four ALTER TABLE ADD COLUMN statements run once on a
--    live v4 database. The schema mirror (functions/db/research_schema.sql)
--    already carries the final column set; applying 0005 over the mirror is
--    NOT a no-op (unlike the CREATE-only 0003/0004). Fresh test databases run
--    0001 -> 0002 -> 0003 -> 0004 -> 0005 in order.
-- 2. IPD snapshots live in research_ipd_datasets, NOT research_data_imports:
--    the study-level import path (_data.js) keeps its 422 ipd_gate refusal
--    untouched. Envelope encryption metadata (wrapped per-snapshot data key +
--    GCM iv) is stored in envelope_json; the R2 object holds ciphertext only.
--    The KEK is derived from env.RESEARCH_IPD_KEK (HKDF-SHA256), never stored.
-- 3. stats_model jobs live in research_stats_jobs, NOT research_job_runs:
--    the 0003 kind CHECK ('pdf_extract') cannot be altered in place and
--    _callback.js is out of this package's edit scope. The router dispatches
--    /v1/jobs/{id}/callback to the stats handler when the id is a stats job
--    (same HMAC verification order as callback.md). Stats jobs are T0
--    deterministic work: no credit reserve/settle (worker compute metering
--    for stats is a Phase 5D decision).
-- 4. Institution roles: research_institution_members gains role
--    ('admin'|'member', default 'member'). Phase 3 INSERT OR IGNORE rows keep
--    the default. Seats cap lives on research_institutions.seats (default 10).
-- 5. data_region on research_projects is the 5C.1 residency pin, locked when
--    the IPD config is saved. institution_id is nullable; personal projects
--    keep NULL.
-- 6. Journal seed values are a knowledge snapshot (2026-11-24), NOT
--    live-verified: checked_ts is NULL and any uncertain field is NULL.
--    See journals.seed.json and journals.md.
-- 7. Reviewer responses link to a Phase 5A manuscript version by id pointer
--    (manuscript_version_id TEXT). The 5A manuscript store is not in D1 yet;
--    referential enforcement lands with it (responses.md).

PRAGMA foreign_keys = ON;

ALTER TABLE research_projects ADD COLUMN institution_id TEXT
  REFERENCES research_institutions(id) ON DELETE SET NULL;
ALTER TABLE research_projects ADD COLUMN data_region TEXT NOT NULL DEFAULT 'GLOBAL_DEID'
  CHECK(data_region IN ('IN','EU','US','GLOBAL_DEID'));
ALTER TABLE research_institutions ADD COLUMN seats INTEGER NOT NULL DEFAULT 10 CHECK(seats >= 1);
ALTER TABLE research_institution_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK(role IN ('admin','member'));
CREATE INDEX IF NOT EXISTS idx_research_projects_institution
  ON research_projects(institution_id, updated_ts DESC);

-- 5C.2/5C.3: per-project IPD compliance configuration (residency pin mirror,
-- jurisdictions, identifiability tier, legal bases, signed attestations).
CREATE TABLE IF NOT EXISTS research_ipd_config (
  project_id TEXT PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  data_region TEXT NOT NULL CHECK(data_region IN ('IN','EU','US','GLOBAL_DEID')),
  jurisdictions_json TEXT NOT NULL DEFAULT '[]',
  identifiability_tier TEXT NOT NULL
    CHECK(identifiability_tier IN ('anonymised_deid','hipaa_lds','coded_pseudonymised')),
  legal_basis_json TEXT NOT NULL DEFAULT '{}',
  attestation_json TEXT NOT NULL DEFAULT '{}',
  agreements_json TEXT NOT NULL DEFAULT '{}',
  locked_ts INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_ts INTEGER NOT NULL
);

-- 5C.1 evidence artefacts (IRB/IEC approval, consent basis, DUA, BAA, DPA,
-- de-identification attestations). Bytes in private R2; owner approval is the
-- gate. HIPAA compliance documents: 6-year retention floor (US projects).
CREATE TABLE IF NOT EXISTS research_ipd_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('irb_approval','exemption_waiver','consent_basis',
    'dua','baa','dpa','safe_harbor','expert_determination','authorization','other')),
  jurisdiction TEXT NOT NULL DEFAULT '' CHECK(jurisdiction IN ('','IN','EU','US')),
  title TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  content_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  uploaded_by TEXT NOT NULL,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_ts INTEGER,
  expires_ts INTEGER,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_ipd_evidence_project
  ON research_ipd_evidence(project_id, kind, status, created_ts DESC);

-- 5C.2 encrypted IPD snapshots. envelope_json = {alg:"AES-256-GCM",
-- wrap:"AES-KW", iv:<b64>, wrappedKey:<b64>}; storage_key holds ciphertext.
-- sha256/bytes describe the PLAINTEXT (audit/dedupe); row_count is the CSV
-- data row count. contains_ipd is always 1 here (plan 3 rule 10).
CREATE TABLE IF NOT EXISTS research_ipd_datasets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count >= 0),
  identifiability_tier TEXT NOT NULL
    CHECK(identifiability_tier IN ('anonymised_deid','hipaa_lds','coded_pseudonymised')),
  jurisdictions_json TEXT NOT NULL DEFAULT '[]',
  data_region TEXT NOT NULL CHECK(data_region IN ('IN','EU','US','GLOBAL_DEID')),
  evidence_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  contains_ipd INTEGER NOT NULL DEFAULT 1 CHECK(contains_ipd IN (0,1)),
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_research_ipd_datasets_project
  ON research_ipd_datasets(project_id, version DESC);

-- 5C.2 append-only IPD access/export audit (DPDP Rule 6(1)(c), HIPAA
-- 164.312(b)). The API only INSERTs; no update/delete route exists.
-- ip_hash is a truncated SHA-256 of the client IP, never the raw address.
-- India projects: 1-year minimum retention floor (Rule 6(1)(e), Rule 8(3)).
CREATE TABLE IF NOT EXISTS research_ipd_access_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('upload','read','analysis','delete','key_rotation')),
  result TEXT NOT NULL CHECK(result IN ('ok','denied','error')),
  ip_hash TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_ipd_access_log_project
  ON research_ipd_access_log(project_id, ts DESC);

-- 5C.2 breach incident log with jurisdiction SLA timers (admin only).
CREATE TABLE IF NOT EXISTS research_security_incidents (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  jurisdictions_json TEXT NOT NULL DEFAULT '[]',
  affected_projects_json TEXT NOT NULL DEFAULT '[]',
  encrypted_flag INTEGER NOT NULL DEFAULT 0 CHECK(encrypted_flag IN (0,1)),
  discovered_ts INTEGER NOT NULL,
  sla_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','contained','closed')),
  status_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
);

-- 6.1 institution invoicing: an issued invoice grants ledger credits exactly
-- once when marked paid (research_credit_ledger reason 'grant').
CREATE TABLE IF NOT EXISTS research_invoices (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES research_institutions(id) ON DELETE CASCADE,
  amount_micro_usd INTEGER NOT NULL CHECK(amount_micro_usd > 0),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','void')),
  issued_by TEXT NOT NULL,
  paid_ts INTEGER,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_invoices_institution
  ON research_invoices(institution_id, created_ts DESC);

-- 6.5 pilot onboarding: manual checklist flags only; computed steps are
-- derived live from members/ledger/projects/runs (institutions.md).
CREATE TABLE IF NOT EXISTS research_institution_onboarding (
  institution_id TEXT PRIMARY KEY REFERENCES research_institutions(id) ON DELETE CASCADE,
  items_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_ts INTEGER NOT NULL
);

-- 5B.3 journal records, seeded read-only from journals.seed.json.
-- NULL = uncertain / not live-verified (checked_ts NULL for the whole seed).
CREATE TABLE IF NOT EXISTS research_journals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issn TEXT NOT NULL DEFAULT '',
  scope_json TEXT NOT NULL DEFAULT '[]',
  designs_json TEXT NOT NULL DEFAULT '[]',
  author_instructions_url TEXT,
  word_limit_abstract INTEGER,
  word_limit_main INTEGER,
  reference_style TEXT,
  checked_ts INTEGER,
  created_ts INTEGER NOT NULL
);

-- 5B.5 reviewer-response workspace. Comments are immutable reviewer input;
-- responses carry the mandatory manuscript-version + section-change link and
-- optimistic-concurrency version (house 409 pattern).
CREATE TABLE IF NOT EXISTS research_reviewer_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  round INTEGER NOT NULL DEFAULT 1 CHECK(round >= 1),
  reviewer_label TEXT NOT NULL,
  text TEXT NOT NULL,
  section_ref TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_reviewer_comments_project
  ON research_reviewer_comments(project_id, round, created_ts);

CREATE TABLE IF NOT EXISTS research_reviewer_responses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES research_reviewer_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  change_note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_reviewer_responses_comment
  ON research_reviewer_responses(comment_id, created_ts);
CREATE INDEX IF NOT EXISTS idx_research_reviewer_responses_project
  ON research_reviewer_responses(project_id, created_ts DESC);

-- 5C.3 / 5D stats_model jobs (backend/research/stats/job.py contract).
-- compliance_json carries {ipdApproved:true, evidenceId} ONLY when the IPD
-- gate passed at creation; the worker re-checks it on every model call.
CREATE TABLE IF NOT EXISTS research_stats_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'stats_model' CHECK(kind IN ('stats_model')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  dataset_id TEXT NOT NULL DEFAULT '',
  input_r2_key TEXT NOT NULL,
  result_r2_key TEXT NOT NULL DEFAULT '',
  model_json TEXT NOT NULL DEFAULT '{}',
  compliance_json TEXT NOT NULL DEFAULT '{}',
  contains_ipd INTEGER NOT NULL DEFAULT 1 CHECK(contains_ipd IN (0,1)),
  evidence_id TEXT NOT NULL DEFAULT '',
  ceilings_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  started_ts INTEGER,
  completed_ts INTEGER,
  cancel_requested_ts INTEGER,
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_research_stats_jobs_project
  ON research_stats_jobs(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_stats_jobs_queue
  ON research_stats_jobs(status, created_ts);
