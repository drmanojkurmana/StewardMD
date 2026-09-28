-- StewardMD - Medical Updates: journal + openFDA sources for Clinical Bulletins (2026-09-28).
-- Hand-runnable copy of functions/_journal_sources.js (the pipeline seeds these once by itself).
-- Idempotent (INSERT OR IGNORE). From the repo root:
--   wrangler d1 execute stewardmd-updates --remote --command "$(sed 's/--.*$//' functions/db/seed_sources_journals.sql | tr '\n' ' ')"

INSERT OR IGNORE INTO sources (id, name, workspace, branch, type, homepage, guideline_page, rss_url, query, parser_type, priority, enabled, created_ts) VALUES
  ('openfda-approvals', 'FDA new drug and biologic approvals (openFDA)', 'internal_medicine', '', 'drug_approval', 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm', '', '', '', 'openfda', 15, 1, strftime('%s','now')*1000),
  ('pubmed-core', 'NEJM, Lancet, JAMA, BMJ: randomised and phase 3 trials', 'internal_medicine', '', 'trial', 'https://pubmed.ncbi.nlm.nih.gov', '', '', '("N Engl J Med"[ta] OR "Lancet"[ta] OR "JAMA"[ta] OR "BMJ"[ta]) AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt]) NOT ("Comment"[pt] OR "Letter"[pt] OR "Editorial"[pt])', 'pubmed', 60, 1, strftime('%s','now')*1000),
  ('pubmed-cardio', 'Circulation, Eur Heart J, JACC: randomised and phase 3 trials', 'internal_medicine', 'cardiology', 'trial', 'https://pubmed.ncbi.nlm.nih.gov', '', '', '("Circulation"[ta] OR "Eur Heart J"[ta] OR "J Am Coll Cardiol"[ta]) AND ("Randomized Controlled Trial"[pt] OR "Clinical Trial, Phase III"[pt]) NOT ("Comment"[pt] OR "Letter"[pt] OR "Editorial"[pt])', 'pubmed', 70, 1, strftime('%s','now')*1000),
  ('pubmed-onc', 'J Clin Oncol, Lancet Oncol, JAMA Oncol: phase 3 trials', 'internal_medicine', 'oncology', 'trial', 'https://pubmed.ncbi.nlm.nih.gov', '', '', '("J Clin Oncol"[ta] OR "Lancet Oncol"[ta] OR "JAMA Oncol"[ta]) AND "Clinical Trial, Phase III"[pt] NOT ("Comment"[pt] OR "Letter"[pt] OR "Editorial"[pt])', 'pubmed', 70, 1, strftime('%s','now')*1000);
