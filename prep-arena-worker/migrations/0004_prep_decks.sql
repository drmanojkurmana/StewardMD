-- PrepNucleus deck backup (functions/api/prep/decks, client prep-decks.js PREP_DECKS.backup). A student's own decks,
-- one encrypted row per deck, so decks come back on a new phone or after a reinstall once the student signs in.
-- uh = hex sha256("prep-decks|" + uid); the uid is never stored. salt = per-user random 32 bytes (HKDF salt) in
-- prep_deck_keys; blob = AES-GCM ciphertext of { manifest, items, cards, facts } (no source file, no page text beyond the
-- one or two sentences an unused fact cites, no images) that the server cannot read without the uid.
CREATE TABLE IF NOT EXISTS prep_deck_keys (
  uh TEXT PRIMARY KEY,
  salt BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS prep_decks (
  uh TEXT NOT NULL,
  id TEXT NOT NULL,
  blob BLOB NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uh, id)
);
