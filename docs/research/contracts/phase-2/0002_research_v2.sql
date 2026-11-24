-- ResearchMD Phase 2 contract migration 0002: systematic-review workflow.
-- Database: stewardmd-research (D1, provisioned in Phase 1.8). Times are
-- epoch milliseconds. JSON columns are validated by the API before persistence.
-- Forward-only; the tested rollback is 0002_rollback.sql.
--
-- Relationship to 0001: research_projects, research_members (roles
-- owner/editor/analyst/reviewer/viewer) and research_audit_events are reused
-- unchanged. Phase 2 adds protocols, invitations, search runs, records,
-- reports (+ the link to Phase 1 research_studies rows), dedup groups,
-- screening decisions, conflicts, exclusion reasons, and the PRISMA 2020
-- counts view. Audit continues in research_audit_events with new event types:
-- protocol_created/versioned/locked, invitation_created/accepted/declined/
-- expired, search_run_created, records_imported, dedup_run, decision_recorded,
-- conflict_opened/resolved, prisma_viewed.
--
-- Roles (plan modules A/B): enforced server-side from research_members; no new
-- role table. Owner/editor manage protocol + invitations + conflicts; analyst
-- runs searches/imports/dedup and writes studies; reviewer votes and reads
-- blinded views; viewer reads only. Invitation accept writes the membership row.
--
-- Blinding is API-enforced (see blinding.md), not DDL: decisions store one row
-- per reviewer per item per stage, and the API redacts the peer vote until
-- both reviewers have decided.
PRAGMA foreign_keys = ON;

-- Versioned protocols. Each edit is a new row (UNIQUE project/version);
-- a locked row is immutable (API rejects writes; the CHECK below pins the
-- lock evidence). lock_hash covers the canonical content_json bytes.
CREATE TABLE IF NOT EXISTS research_protocols (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  status TEXT NOT NULL CHECK(status IN ('draft','locked')),
  content_json TEXT NOT NULL DEFAULT '{}',
  lock_hash TEXT,
  locked_at INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, version),
  CHECK(status = 'draft' OR (lock_hash IS NOT NULL AND locked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_research_protocols_project
  ON research_protocols(project_id, version DESC);

-- Invitations carry a token hash only; the raw token is shown once at create
-- and never stored. Accept writes research_members and marks accepted.
CREATE TABLE IF NOT EXISTS research_invitations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','analyst','reviewer','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
    CHECK(status IN ('pending','accepted','declined','expired','revoked')),
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  expires_ts INTEGER NOT NULL,
  decided_ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_research_invitations_project
  ON research_invitations(project_id, created_ts DESC);

-- One row per database search (2.3). date_to is the replayable upper bound
-- (YYYY-MM-DD, NULL only when the database has no date filter; 2.0b may make
-- it mandatory). r2_key points at the private-R2 object holding the FULL
-- returned ID list, so replaying from the archive reproduces 100%.
CREATE TABLE IF NOT EXISTS research_search_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  database TEXT NOT NULL
    CHECK(database IN ('pubmed','europe_pmc','crossref','semantic_scholar','import')),
  query TEXT NOT NULL DEFAULT '',
  filters_json TEXT NOT NULL DEFAULT '{}',
  date_to TEXT,
  api_version TEXT NOT NULL DEFAULT '',
  result_count INTEGER NOT NULL DEFAULT 0 CHECK(result_count >= 0),
  r2_key TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_search_runs_project
  ON research_search_runs(project_id, created_ts DESC);

-- Deduplicated-by-contract records: one row per (project, source, external
-- ID). Imports (RIS/BibTeX/CSV) arrive via database='import' runs; source then
-- holds 'import:ris' | 'import:bibtex' | 'import:csv'.
CREATE TABLE IF NOT EXISTS research_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  search_run_id TEXT REFERENCES research_search_runs(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  authors_json TEXT NOT NULL DEFAULT '[]',
  year INTEGER,
  doi TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_research_records_project
  ON research_records(project_id, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_research_records_run
  ON research_records(search_run_id);

-- Reports: full-text-stage items, one per record. status 'sought' means the
-- full text was requested; 'not_retrieved' is terminal and explicit (PRISMA
-- counts it). study_id links an included report to its Phase 1 analysis row.
CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK(status IN ('sought','not_retrieved','retrieved','excluded','included')),
  retrieval_source TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  study_id TEXT REFERENCES research_studies(id) ON DELETE SET NULL,
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  UNIQUE(record_id)
);
CREATE INDEX IF NOT EXISTS idx_research_reports_project
  ON research_reports(project_id, created_ts DESC);

-- Deterministic dedup (T0 code, no LLM): groups of duplicate records with one
-- canonical member. Duplicates-removed counts use non-canonical members.
CREATE TABLE IF NOT EXISTS research_dedup_groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  canonical_record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL DEFAULT 'deterministic-v1',
  created_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_dedup_members (
  group_id TEXT NOT NULL REFERENCES research_dedup_groups(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
  PRIMARY KEY(group_id, record_id)
);
CREATE INDEX IF NOT EXISTS idx_research_dedup_groups_project
  ON research_dedup_groups(project_id, created_ts DESC);

-- Exclusion reasons, project-scoped plus shared global rows
-- (project_id = 'global', seeded by the 2.5 builder from prisma2020.md codes).
CREATE TABLE IF NOT EXISTS research_exclusion_reasons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  UNIQUE(project_id, code)
);

-- Blinded screening votes (see blinding.md): one immutable row per reviewer
-- per item per stage. A reviewer re-voting before unblinding inserts a new row;
-- the latest row per reviewer counts, earlier rows stay for audit. Exactly one
-- of record_id (title_abstract) / report_id (full_text) is set.
CREATE TABLE IF NOT EXISTS research_screening_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  record_id TEXT REFERENCES research_records(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES research_reports(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('title_abstract','full_text')),
  reviewer_uid TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('include','exclude','uncertain')),
  reason_code TEXT,
  created_ts INTEGER NOT NULL,
  CHECK((record_id IS NULL) != (report_id IS NULL)),
  CHECK((stage = 'title_abstract' AND record_id IS NOT NULL)
     OR (stage = 'full_text' AND report_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_research_decisions_record
  ON research_screening_decisions(stage, record_id, reviewer_uid, created_ts DESC)
  WHERE record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_decisions_report
  ON research_screening_decisions(stage, report_id, reviewer_uid, created_ts DESC)
  WHERE report_id IS NOT NULL;

-- Conflicts: opened by the API when both reviewers have decided an item and
-- the votes disagree or either is uncertain (see blinding.md). One row per
-- item per stage; resolution is owner/editor only.
CREATE TABLE IF NOT EXISTS research_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  record_id TEXT REFERENCES research_records(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES research_reports(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('title_abstract','full_text')),
  status TEXT NOT NULL CHECK(status IN ('open','resolved')),
  resolution TEXT CHECK(resolution IN ('include','exclude')),
  resolution_reason TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  resolved_ts INTEGER,
  created_ts INTEGER NOT NULL,
  CHECK((record_id IS NULL) != (report_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_conflicts_record
  ON research_conflicts(stage, record_id) WHERE record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_conflicts_report
  ON research_conflicts(stage, report_id) WHERE report_id IS NOT NULL;

-- PRISMA 2020 counts, derived from stored decisions only (never stored
-- separately, so the counts gate "counts equal stored decisions, 100%" holds
-- by construction). Item outcomes: an open conflict or a split/uncertain vote
-- without a resolution is 'pending'; no votes is 'unscreened'; unanimous votes
-- decide; a resolved conflict follows the resolution. Duplicates are
-- non-canonical dedup members. See prisma2020.md for box-by-box mapping.
CREATE VIEW IF NOT EXISTS research_prisma_counts AS
WITH ta AS (
  SELECT r.project_id AS project_id, r.id AS record_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM research_conflicts c
                   WHERE c.project_id = r.project_id AND c.record_id = r.id
                     AND c.stage = 'title_abstract' AND c.status = 'open')
        THEN 'pending'
      WHEN EXISTS (SELECT 1 FROM research_conflicts c
                   WHERE c.project_id = r.project_id AND c.record_id = r.id
                     AND c.stage = 'title_abstract' AND c.status = 'resolved')
        THEN (SELECT c2.resolution FROM research_conflicts c2
              WHERE c2.project_id = r.project_id AND c2.record_id = r.id
                AND c2.stage = 'title_abstract' AND c2.status = 'resolved'
              ORDER BY c2.resolved_ts DESC LIMIT 1)
      WHEN NOT EXISTS (SELECT 1 FROM research_screening_decisions d
                       WHERE d.project_id = r.project_id AND d.record_id = r.id
                         AND d.stage = 'title_abstract')
        THEN 'unscreened'
      WHEN NOT EXISTS (SELECT 1 FROM research_screening_decisions d
                       WHERE d.project_id = r.project_id AND d.record_id = r.id
                         AND d.stage = 'title_abstract' AND d.decision != 'include')
        THEN 'include'
      WHEN NOT EXISTS (SELECT 1 FROM research_screening_decisions d
                       WHERE d.project_id = r.project_id AND d.record_id = r.id
                         AND d.stage = 'title_abstract' AND d.decision != 'exclude')
        THEN 'exclude'
      ELSE 'pending'
    END AS outcome
  FROM research_records r
),
ft AS (
  SELECT rep.project_id AS project_id, rep.id AS report_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM research_conflicts c
                   WHERE c.project_id = rep.project_id AND c.report_id = rep.id
                     AND c.stage = 'full_text' AND c.status = 'open')
        THEN 'pending'
      WHEN EXISTS (SELECT 1 FROM research_conflicts c
                   WHERE c.project_id = rep.project_id AND c.report_id = rep.id
                     AND c.stage = 'full_text' AND c.status = 'resolved')
        THEN (SELECT c2.resolution FROM research_conflicts c2
              WHERE c2.project_id = rep.project_id AND c2.report_id = rep.id
                AND c2.stage = 'full_text' AND c2.status = 'resolved'
              ORDER BY c2.resolved_ts DESC LIMIT 1)
      WHEN NOT EXISTS (SELECT 1 FROM research_screening_decisions d
                       WHERE d.project_id = rep.project_id AND d.report_id = rep.id
                         AND d.stage = 'full_text')
        THEN 'unscreened'
      WHEN NOT EXISTS (SELECT 1 FROM research_screening_decisions d
                       WHERE d.project_id = rep.project_id AND d.report_id = rep.id
                         AND d.stage = 'full_text' AND d.decision != 'include')
        THEN 'include'
      WHEN NOT EXISTS (SELECT 1 FROM research_screening_decisions d
                       WHERE d.project_id = rep.project_id AND d.report_id = rep.id
                         AND d.stage = 'full_text' AND d.decision != 'exclude')
        THEN 'exclude'
      ELSE 'pending'
    END AS outcome
  FROM research_reports rep
)
SELECT
  p.id AS project_id,
  (SELECT COUNT(*) FROM research_records r WHERE r.project_id = p.id)
    AS records_identified,
  (SELECT COUNT(*) FROM research_records r WHERE r.project_id = p.id
     AND r.source IN ('pubmed','europe_pmc','crossref','semantic_scholar'))
    AS records_from_databases,
  (SELECT COUNT(*) FROM research_records r WHERE r.project_id = p.id
     AND r.source NOT IN ('pubmed','europe_pmc','crossref','semantic_scholar'))
    AS records_from_other_sources,
  (SELECT COUNT(DISTINCT m.record_id) FROM research_dedup_members m
     JOIN research_dedup_groups g ON g.id = m.group_id
     JOIN research_records r ON r.id = m.record_id
   WHERE r.project_id = p.id AND m.record_id != g.canonical_record_id)
    AS records_duplicates_removed,
  (SELECT COUNT(*) FROM ta WHERE ta.project_id = p.id AND ta.outcome != 'unscreened')
    AS records_screened,
  (SELECT COUNT(*) FROM ta WHERE ta.project_id = p.id AND ta.outcome = 'exclude')
    AS records_excluded,
  (SELECT COUNT(*) FROM research_reports rep WHERE rep.project_id = p.id)
    AS reports_sought,
  (SELECT COUNT(*) FROM research_reports rep WHERE rep.project_id = p.id
     AND rep.status = 'not_retrieved')
    AS reports_not_retrieved,
  (SELECT COUNT(*) FROM ft WHERE ft.project_id = p.id AND ft.outcome != 'unscreened')
    AS reports_assessed,
  (SELECT COUNT(*) FROM ft WHERE ft.project_id = p.id AND ft.outcome = 'exclude')
    AS reports_excluded,
  (SELECT COUNT(*) FROM ft WHERE ft.project_id = p.id AND ft.outcome = 'include')
    AS studies_included,
  (SELECT COUNT(*) FROM research_conflicts c WHERE c.project_id = p.id
     AND c.status = 'open')
    AS conflicts_open
FROM research_projects p;
