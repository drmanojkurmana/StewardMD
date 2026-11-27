-- ResearchMD 0008 rollback. Drops the publication consent attestation table
-- (F-12). Manuscript versions, sections and audit rows survive; the
-- publication_consent_confirmed audit events reference the dropped table's
-- ids only as opaque strings. Run once.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS research_publication_consents;

PRAGMA foreign_keys = ON;
