-- ResearchMD 0007 rollback. Drops the shared paper-number cache and the
-- unverified Ask MaiK draft table. Phase 1-6 rows, including manuscript
-- versions, survive. Run once.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS research_ai_drafts;
DROP TABLE IF EXISTS research_paper_numbers;

PRAGMA foreign_keys = ON;
