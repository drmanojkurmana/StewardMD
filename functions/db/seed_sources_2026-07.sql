-- StewardMD — Medical Updates: additional guideline sources (Europe PMC / litapi). 2026-07-19.
-- Every query was verified against the live Europe PMC API (real, recent society guidelines) before
-- seeding. litapi is reliable + granular (one card per guideline), unlike head-poll on landing pages.
-- Apply: wrangler d1 execute stewardmd-updates --remote --file functions/db/seed_sources_2026-07.sql

-- New society guideline sources (idempotent on id).
INSERT OR IGNORE INTO sources (id, name, workspace, branch, type, query, homepage, parser_type, priority, enabled, created_ts) VALUES
  ('esmo','ESMO Clinical Practice Guidelines','internal_medicine','oncology','guideline','(TITLE:"ESMO Clinical Practice Guideline") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.esmo.org','litapi',90,1,strftime('%s','now')*1000),
  ('asco','ASCO Oncology Guidelines','internal_medicine','oncology','guideline','(AUTH:"American Society of Clinical Oncology" OR TITLE:"ASCO Guideline") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.asco.org','litapi',90,1,strftime('%s','now')*1000),
  ('sccm','Surviving Sepsis / SCCM','internal_medicine','critical_care','guideline','(TITLE:"Surviving Sepsis" OR AUTH:"Society of Critical Care Medicine") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.sccm.org','litapi',90,1,strftime('%s','now')*1000),
  ('acr','American College of Rheumatology','internal_medicine','','guideline','(AUTH:"American College of Rheumatology" OR TITLE:"American College of Rheumatology Guideline") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://rheumatology.org','litapi',100,1,strftime('%s','now')*1000),
  ('nice','NICE (UK) Guidelines','internal_medicine','','guideline','(AUTH:"National Institute for Health and Care Excellence" OR TITLE:"NICE guideline") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.nice.org.uk','litapi',95,1,strftime('%s','now')*1000),
  ('icmr','ICMR (India) Guidelines','internal_medicine','','guideline','(AUTH:"Indian Council of Medical Research" OR TITLE:"ICMR") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.icmr.gov.in','litapi',80,1,strftime('%s','now')*1000),
  ('acog','ACOG (Obstetrics & Gynaecology)','obstetrics_gynaecology','','guideline','(TITLE:"ACOG Practice Bulletin" OR AUTH:"American College of Obstetricians and Gynecologists") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.acog.org','litapi',100,1,strftime('%s','now')*1000),
  ('aap','AAP (Paediatrics)','paediatrics','','guideline','(AUTH:"American Academy of Pediatrics" OR TITLE:"American Academy of Pediatrics") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.aap.org','litapi',100,1,strftime('%s','now')*1000),
  ('aua','AUA (Urology)','urology','','guideline','(AUTH:"American Urological Association" OR TITLE:"AUA Guideline") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")','https://www.auanet.org','litapi',100,1,strftime('%s','now')*1000);

-- Convert flaky head-poll guideline sources to reliable litapi, and enable ESC.
UPDATE sources SET parser_type='litapi', enabled=1, query='(TITLE:"ESC Guidelines" OR AUTH:"European Society of Cardiology") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")' WHERE id='esc';
UPDATE sources SET parser_type='litapi', query='(AUTH:"American College of Gastroenterology" OR TITLE:"ACG Clinical Guideline") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")' WHERE id='acg';
UPDATE sources SET parser_type='litapi', query='(AUTH:"American Association for the Study of Liver Diseases" OR TITLE:"AASLD Practice Guidance") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")' WHERE id='aasld';
UPDATE sources SET parser_type='litapi', query='(TITLE:"CHEST Guideline" OR AUTH:"American College of Chest Physicians") AND (PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")' WHERE id='chest';
