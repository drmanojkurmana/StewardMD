-- ResearchMD Phase 5 migration 0007.
-- Contracts: docs/research/contracts/phase-5/auto-studies.md and
-- docs/research/contracts/phase-5/ai-draft.md.
--
-- Decisions recorded here:
-- 1. research_paper_numbers is a shared cache. The key is
--    sha256(pmid + "||" + doi + "|" + normalised outcome + "|" + measure).
--    It has no project_id, so a hit serves every user and charges nothing.
-- 2. research_ai_drafts stores Ask MaiK output as unverified. The CHECK
--    allows only that status. Nothing in this migration writes a protocol,
--    risk of bias row, checklist answer or manuscript section.
-- 3. CREATE IF NOT EXISTS, so applying 0007 over the schema mirror is a
--    no-op. Run once on a live database that already has 0001 through 0006.
-- 4. research_paper_cards is a shared study-card cache. The key is
--    "pmid:<digits>" or "doi:<lowercased doi>". card_json is the card.
--    It has no project_id. A hit serves every user and charges nothing.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_paper_numbers (
  cache_key TEXT PRIMARY KEY,
  pmid TEXT NOT NULL DEFAULT '',
  doi TEXT NOT NULL DEFAULT '',
  outcome_norm TEXT NOT NULL DEFAULT '',
  measure TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_paper_numbers_ids
  ON research_paper_numbers(pmid, doi);

CREATE TABLE IF NOT EXISTS research_ai_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('unverified')),
  draft_json TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  cost_inr REAL NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_ai_drafts_project
  ON research_ai_drafts(project_id, created_ts DESC);

CREATE TABLE IF NOT EXISTS research_paper_cards (
  cache_key TEXT PRIMARY KEY,
  card_json TEXT NOT NULL,
  created_ts INTEGER NOT NULL
);
