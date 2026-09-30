-- StewardMD - Clinical Bulletins: physician-signed practice updates on the disease reader.
-- Plan: docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md. Safe to re-run (CREATE ... IF NOT EXISTS only).
--   wrangler d1 execute stewardmd-updates --remote --file functions/db/migrate_bulletins.sql
-- The same DDL is at the end of updates_schema.sql; test/bulletins.test.mjs keeps the two identical.

-- BEGIN bulletins
CREATE TABLE IF NOT EXISTS bulletins (
  id               TEXT PRIMARY KEY,              -- "b<base36ts><rand>"
  update_id        TEXT NOT NULL,                 -- updates.id this bulletin was written from
  source_hash      TEXT NOT NULL DEFAULT '',      -- updates.content_hash when the draft was last saved
  status           TEXT NOT NULL DEFAULT 'draft', -- draft | signed | retracted
  kind             TEXT NOT NULL,                 -- safety | approval | guideline | trial
  headline         TEXT NOT NULL,
  what_changed     TEXT NOT NULL,
  applies_to       TEXT NOT NULL DEFAULT '',
  evidence_type    TEXT NOT NULL,                 -- regulatory_approval | regulatory_safety | guideline | rct | meta_analysis
  evidence_note    TEXT NOT NULL DEFAULT '',
  regulator        TEXT NOT NULL DEFAULT '',
  india_status     TEXT NOT NULL,                 -- cdsco_approved | not_approved_india | not_applicable | unknown
  source_label     TEXT NOT NULL,
  source_url       TEXT NOT NULL,                 -- https only
  source_date      TEXT NOT NULL,                 -- YYYY-MM-DD of the source
  doi              TEXT NOT NULL DEFAULT '',
  pmid             TEXT NOT NULL DEFAULT '',
  review_months    INTEGER NOT NULL,              -- 6 | 12 | 24, part of the signed content
  review_due_ts    INTEGER NOT NULL DEFAULT 0,    -- set at signing: signed_ts + review_months
  body_hash        TEXT NOT NULL,                 -- sha256 of the canonical signed fields
  signed_hash      TEXT NOT NULL DEFAULT '',      -- body_hash at the moment of signing
  signed_uid       TEXT NOT NULL DEFAULT '',
  signed_name      TEXT NOT NULL DEFAULT '',
  signed_reg       TEXT NOT NULL DEFAULT '',
  signed_council   TEXT NOT NULL DEFAULT '',
  signed_ts        INTEGER NOT NULL DEFAULT 0,
  retract_reason   TEXT NOT NULL DEFAULT '',
  created_uid      TEXT NOT NULL DEFAULT '',
  created_ts       INTEGER NOT NULL DEFAULT 0,
  updated_ts       INTEGER NOT NULL DEFAULT 0,
  second_required  INTEGER NOT NULL DEFAULT 0,    -- set at signing: 1 when a second reader must co-sign (approval, safety)
  cosigned_hash    TEXT NOT NULL DEFAULT '',      -- body_hash the second reader confirmed
  cosigned_uid     TEXT NOT NULL DEFAULT '',
  cosigned_name    TEXT NOT NULL DEFAULT '',
  cosigned_reg     TEXT NOT NULL DEFAULT '',
  cosigned_council TEXT NOT NULL DEFAULT '',
  cosigned_ts      INTEGER NOT NULL DEFAULT 0,
  returned_note    TEXT NOT NULL DEFAULT '',      -- a second reader sent it back: what to fix (cleared at the next signing)
  returned_uid     TEXT NOT NULL DEFAULT '',
  returned_ts      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bulletins_update ON bulletins(update_id);
CREATE INDEX IF NOT EXISTS idx_bulletins_status ON bulletins(status, updated_ts DESC);

CREATE TABLE IF NOT EXISTS bulletin_diseases (
  bulletin_id TEXT NOT NULL,
  disease_id  TEXT NOT NULL,                      -- key of KB_ENRICHMENT.byId, case preserved
  PRIMARY KEY (bulletin_id, disease_id)
);
CREATE INDEX IF NOT EXISTS idx_bd_disease ON bulletin_diseases(disease_id);

CREATE TABLE IF NOT EXISTS bulletin_audit (       -- append-only: nothing in the code updates or deletes it
  id          TEXT PRIMARY KEY,
  bulletin_id TEXT NOT NULL,                      -- '' for signer and kill-switch events
  ts          INTEGER NOT NULL,
  actor_uid   TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,                      -- draft | edit | sign | cosign | return | retract | source_deleted | signer_add | signer_remove | kill_on | kill_off | skip | unskip | second_reader_on | second_reader_off
  body_hash   TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_bulletin ON bulletin_audit(bulletin_id, ts DESC);

CREATE TABLE IF NOT EXISTS bulletin_signers (     -- who may sign; identity confirmed by an owner
  uid         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  reg_no      TEXT NOT NULL,
  council     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  added_by    TEXT NOT NULL,
  added_ts    INTEGER NOT NULL,
  specialties TEXT NOT NULL DEFAULT ''            -- comma-separated keys from SPECIALTIES (functions/_bulletin_rules.js)
);

CREATE TABLE IF NOT EXISTS bulletin_settings (    -- runtime switches that must act without a redeploy
  key         TEXT PRIMARY KEY,                   -- 'enabled': missing or '1' = on, '0' = kill switch
  value       TEXT NOT NULL,
  updated_by  TEXT NOT NULL DEFAULT '',
  updated_ts  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cdsco_lists (          -- CDSCO yearly "new drugs approved" lists (functions/_cdsco.js)
  year        INTEGER PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  release     TEXT NOT NULL DEFAULT '',
  fetched_ts  INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bulletin_skips (       -- source items a signer marked "not for the disease page"
  update_id   TEXT PRIMARY KEY,
  uid         TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
-- END bulletins
