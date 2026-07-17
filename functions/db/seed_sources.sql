-- StewardMD — Medical Updates: seed the source registry.
-- Apply after updates_schema.sql:
--   wrangler d1 execute stewardmd-updates --remote --file functions/db/seed_sources.sql
--
-- Idempotent (INSERT OR IGNORE keyed on id). Edit/enable/disable any of these
-- later from Admin ▸ Medical Sources — no code change needed.
--
-- enabled=1 rows have a VERIFIED feed URL (proven in production). The society/
-- regulator rows are seeded DISABLED (enabled=0) with best-effort landing pages:
-- verify the exact RSS/guideline URL in the admin panel, then enable. This avoids
-- crawling guessed URLs (which would just log errors) until confirmed.
--
-- Workspace uses the app's 8 clinical workspaces. Most medical-society content
-- maps to internal_medicine (the taxonomy has no medical subspecialties).

-- ===== Verified RSS sources (enabled) =====
INSERT OR IGNORE INTO sources (id, name, workspace, type, homepage, rss_url, parser_type, priority, enabled, created_ts) VALUES
  ('fda-press',    'FDA Press Releases (approvals)', 'internal_medicine', 'drug_approval', 'https://www.fda.gov', 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml', 'rss', 10, 1, strftime('%s','now')*1000),
  ('fda-medwatch', 'FDA MedWatch (safety alerts)',   'internal_medicine', 'safety_alert',  'https://www.fda.gov/safety/medwatch', 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml', 'rss', 20, 1, strftime('%s','now')*1000);

-- ===== Society / regulator sources (seeded DISABLED — verify URL, then enable) =====
INSERT OR IGNORE INTO sources (id, name, workspace, type, homepage, guideline_page, rss_url, parser_type, priority, enabled, created_ts) VALUES
  ('acc',   'American College of Cardiology',        'internal_medicine', 'guideline',    'https://www.acc.org', 'https://www.acc.org/guidelines', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('aha',   'American Heart Association',             'internal_medicine', 'guideline',    'https://professional.heart.org', 'https://professional.heart.org/en/guidelines-and-statements', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('esc',   'European Society of Cardiology',         'internal_medicine', 'guideline',    'https://www.escardio.org', 'https://www.escardio.org/Guidelines', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('kdigo', 'KDIGO (nephrology)',                     'internal_medicine', 'guideline',    'https://kdigo.org', 'https://kdigo.org/guidelines/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('ada',   'American Diabetes Association',          'internal_medicine', 'guideline',    'https://diabetes.org', 'https://diabetesjournals.org/care/issue', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('idsa',  'Infectious Diseases Society of America', 'internal_medicine', 'guideline',    'https://www.idsociety.org', 'https://www.idsociety.org/practice-guideline/practice-guidelines/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('cdc',   'CDC',                                    'internal_medicine', 'safety_alert', 'https://www.cdc.gov', 'https://www.cdc.gov/media/index.html', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('who',   'World Health Organization',              'internal_medicine', 'safety_alert', 'https://www.who.int', 'https://www.who.int/news', 'https://www.who.int/rss-feeds/news-english.xml', 'rss', 100, 0, strftime('%s','now')*1000),
  ('ema',   'European Medicines Agency',              'internal_medicine', 'drug_approval','https://www.ema.europa.eu', 'https://www.ema.europa.eu/en/news', '', 'head', 100, 1, strftime('%s','now')*1000),
  ('cdsco', 'CDSCO (India)',                          'internal_medicine', 'drug_approval','https://cdsco.gov.in', 'https://cdsco.gov.in/opencms/opencms/en/Notifications/Public-Notices/', '', 'head', 100, 1, strftime('%s','now')*1000),
  ('ats',   'American Thoracic Society',              'internal_medicine', 'guideline',    'https://www.thoracic.org', 'https://www.thoracic.org/statements/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('chest', 'CHEST (pulmonology)',                    'internal_medicine', 'guideline',    'https://www.chestnet.org', 'https://www.chestnet.org/Guidelines-and-Resources', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('gold',  'GOLD (COPD)',                            'internal_medicine', 'guideline',    'https://goldcopd.org', 'https://goldcopd.org/2024-gold-report/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('gina',  'GINA (asthma)',                          'internal_medicine', 'guideline',    'https://ginasthma.org', 'https://ginasthma.org/reports/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('acg',   'American College of Gastroenterology',   'internal_medicine', 'guideline',    'https://gi.org', 'https://gi.org/guidelines/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('aasld', 'AASLD (hepatology)',                     'internal_medicine', 'guideline',    'https://www.aasld.org', 'https://www.aasld.org/practice-guidelines', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('ers',   'European Respiratory Society',           'internal_medicine', 'guideline',    'https://www.ersnet.org', 'https://www.ersnet.org/science-and-research/clinical-practice-guidelines/', '', 'head', 100, 0, strftime('%s','now')*1000),
  ('ctgov', 'ClinicalTrials.gov',                     'internal_medicine', 'trial',        'https://clinicaltrials.gov', 'https://clinicaltrials.gov', '', 'head', 120, 0, strftime('%s','now')*1000),
  ('pubmed','PubMed (practice-changing)',             'internal_medicine', 'trial',        'https://pubmed.ncbi.nlm.nih.gov', 'https://pubmed.ncbi.nlm.nih.gov', '', 'head', 120, 0, strftime('%s','now')*1000);

-- Branch (Internal-Medicine sub-specialty) tagging. Harmless if the `branch` column
-- doesn't exist yet on an older DB — run migrate_branches.sql first on the live DB.
UPDATE sources SET branch = 'cardiology'          WHERE id IN ('acc', 'aha', 'esc');
UPDATE sources SET branch = 'nephrology'          WHERE id = 'kdigo';
UPDATE sources SET branch = 'endocrinology'       WHERE id = 'ada';
UPDATE sources SET branch = 'infectious_diseases' WHERE id IN ('idsa', 'cdc', 'who');
UPDATE sources SET branch = 'pulmonology'         WHERE id IN ('ats', 'chest', 'gold', 'gina', 'ers');
UPDATE sources SET branch = 'gastroenterology'    WHERE id = 'acg';
UPDATE sources SET branch = 'hepatology'          WHERE id = 'aasld';
