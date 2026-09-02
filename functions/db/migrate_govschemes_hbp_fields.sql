-- StewardMD — Government Health Schemes: additive migration for HBP-family package masters.
-- Apply: wrangler d1 execute stewardmd-govschemes --remote --file functions/db/migrate_govschemes_hbp_fields.sql
--
-- NOT idempotent (SQLite has no ADD COLUMN IF NOT EXISTS) - errors if a column already exists.
-- Same convention as functions/db/migrate_branches.sql / migrate_litapi.sql.
--
-- Why: the first dataset (AP, Dr. NTR Vaidya Seva) is a flat speciality->treatment sheet, so
-- the original packages table modelled exactly that. Every OTHER verified state master is an
-- NHA "HBP" workbook (Bihar HBP 2022, Kerala KASP HBP 2.0, Nagaland CMHIS, Mizoram, Odisha,
-- Punjab, UP, Haryana, HP, Ladakh...) which carries a two-level hierarchy the flat table cannot
-- hold: a PACKAGE (e.g. BM001 "Thermal burns") containing several PROCEDURES (BM001A/B/C, each
-- its own price and criteria). Storing only the procedure loses the package grouping the
-- government actually bills against.
--
-- rate_tier is the safety-critical one. HBP masters publish DIFFERENT prices for the same
-- procedure by hospital tier / ward class (Bihar ships a "Tier 2" workbook, Nagaland's EP file
-- is semi-private-ward only, CGHS lists NABH vs non-NABH, Karnataka General/Semi-Private/
-- Private). Without recording WHICH tier a package_amount came from, cross-state comparison
-- silently compares different things - a wrong number in front of a clinician. Every importer
-- MUST set rate_tier verbatim from its source.

ALTER TABLE packages ADD COLUMN package_code TEXT DEFAULT '';
ALTER TABLE packages ADD COLUMN package_name TEXT DEFAULT '';
ALTER TABLE packages ADD COLUMN rate_tier TEXT DEFAULT '';
ALTER TABLE packages ADD COLUMN los_days INTEGER DEFAULT 0;
ALTER TABLE packages ADD COLUMN implant_criteria TEXT DEFAULT '';
ALTER TABLE packages ADD COLUMN stratification_criteria TEXT DEFAULT '';
ALTER TABLE packages ADD COLUMN icd_code TEXT DEFAULT '';
ALTER TABLE packages ADD COLUMN ichi_code TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gs_packages_pkgcode ON packages(package_code);
