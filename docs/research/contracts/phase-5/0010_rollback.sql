-- ResearchMD 0010 rollback. Drops the monthly cloud fallback tracking table.

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_research_cloud_fallbacks_job;
DROP INDEX IF EXISTS idx_research_cloud_fallbacks_uid_month;
DROP TABLE IF EXISTS research_cloud_fallbacks;

PRAGMA foreign_keys = ON;
