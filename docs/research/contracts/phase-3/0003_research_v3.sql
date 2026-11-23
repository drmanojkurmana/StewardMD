-- ResearchMD Phase 3 migration 0003 (server side: jobs v2, PDFs, AI usage,
-- credits, institutions). Applies cleanly on top of LIVE 0001 + 0002.
-- Forward-only; rollback: 0003_rollback.sql. Times are epoch milliseconds.
--
-- TABLE NAME DECISION (documented per the 3.0 brief): the new jobs table is
-- research_job_runs, NOT research_jobs. The pilot research_jobs shape
-- (job_type, waiting_approval, research_meta_analyses FK) is mirrored in
-- functions/db/research_schema.sql and read/written by the live pilot router
-- (uploadPaper / meta-analyses / internal input-start-complete). Reusing the
-- name would collide with that mirror and break the pilot routes, which must
-- stay untouched. callback.md and retention.md say "research_jobs"; for
-- Phase 3 jobs read research_job_runs. The pilot tables are NOT live, so on
-- the live DB (0001 + 0002 only) this migration creates research_job_runs
-- with no conflict either way.
--
-- STATUS DECISION: stored statuses follow callback.md's transition table
-- (queued|running|succeeded|failed|cancelled). The callback BODY status
-- "done" maps to stored "succeeded"; "done" is never a stored value.
--
-- CREDIT UNIT: research_credit_ledger.delta and research_ai_usage.cost_micro_usd
-- are integer micro-USD (1e-6 USD). The MaiK wallet (functions/_credits.js)
-- stays in INR; conversion at settle uses RESEARCH_USD_INR (default 96, the
-- rate _ai_usage.js documents). The wallet has no reserve/settle primitive,
-- so reserve/settle live on this ledger and the wallet is debited ONCE at
-- settle (see functions/api/research/_credits.js and gateway.md).

PRAGMA foreign_keys = ON;

-- Jobs v2: one row per (project, idempotency_key). input/result are R2
-- pointers (retention.md layout); ceilings_json carries the quoted ceilings
-- plus quoteMicroUsd; usage_json the callback usage; output_json the
-- callback.md settle payload ({resultKey, usage} or {usage}).
CREATE TABLE IF NOT EXISTS research_job_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('pdf_extract')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  input_r2_key TEXT NOT NULL DEFAULT '',
  result_r2_key TEXT NOT NULL DEFAULT '',
  ceilings_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  started_ts INTEGER,
  completed_ts INTEGER,
  cancel_requested_ts INTEGER,
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_queue
  ON research_job_runs(status, created_ts);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_project
  ON research_job_runs(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_job_runs_creator
  ON research_job_runs(created_by, created_ts);

-- Uploaded PDFs, content-addressed per project (retention.md). pages is NULL
-- until a pdf_extract callback reports usage.pages. report_id optionally
-- links the full-text report the PDF was retrieved for.
CREATE TABLE IF NOT EXISTS research_pdfs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES research_reports(id) ON DELETE SET NULL,
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  pages INTEGER,
  uploaded_by TEXT NOT NULL,
  ts INTEGER NOT NULL,
  UNIQUE(project_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_research_pdfs_project
  ON research_pdfs(project_id, ts DESC);

-- One row per gateway LLM call (plan section 6 logging). Metadata only:
-- never prompt text, output text or matched PHI. cost_micro_usd is the
-- settled actual cost, priced from _ai_usage.MODEL_RATES at RESEARCH_USD_INR.
CREATE TABLE IF NOT EXISTS research_ai_usage (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL CHECK(tier IN ('T1','T2','T3')),
  model TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0 CHECK(tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK(tokens_out >= 0),
  cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK(cost_micro_usd >= 0),
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_ai_usage_project
  ON research_ai_usage(project_id, ts);
CREATE INDEX IF NOT EXISTS idx_research_ai_usage_user
  ON research_ai_usage(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_research_ai_usage_job
  ON research_ai_usage(job_id);

-- Credit lifecycle ledger (plan section 7). delta is signed micro-USD.
-- reasons: grant (admin/institution top-up), reserve (-quote hold),
-- release (+quote full hold refund), settle (-actual charge).
-- owner_type user: owner_id is the MaiK WALLET KEY (em:<email> or fb:<uid>,
-- the _usage.js usageKeyFor scheme), pinned at reserve time so the callback
-- debits the exact reserved account; the MaiK wallet is the balance store
-- and settle debits it once in INR (ledger rows are audit).
-- owner_type institution: owner_id is research_institutions.id; the ledger
-- IS the balance store (balance = SUM(delta)).
CREATE TABLE IF NOT EXISTS research_credit_ledger (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('user','institution')),
  owner_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('grant','reserve','release','settle')),
  job_id TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_credit_ledger_owner
  ON research_credit_ledger(owner_type, owner_id, ts);
CREATE INDEX IF NOT EXISTS idx_research_credit_ledger_job
  ON research_credit_ledger(job_id);

-- Institution invoicing (D-4): admin-granted credit pools. Membership lets
-- a researcher draw from the pool before their own MaiK wallet.
CREATE TABLE IF NOT EXISTS research_institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_institution_members (
  institution_id TEXT NOT NULL REFERENCES research_institutions(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  PRIMARY KEY(institution_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_research_institution_members_uid
  ON research_institution_members(uid, institution_id);
