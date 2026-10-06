-- PrepNucleus encrypted progress sync (functions/api/prep/sync, client prep-sync.js). One row per user.
-- uh = hex sha256("prep-sync|" + uid); the uid is never stored. blob = AES-GCM ciphertext the server cannot read
-- without the uid; salt = per-user random 32 bytes (HKDF salt); ver = compare-and-set version (ETag).
CREATE TABLE IF NOT EXISTS prep_sync (
  uh TEXT PRIMARY KEY,
  salt BLOB NOT NULL,
  ver INTEGER NOT NULL DEFAULT 0,
  blob BLOB,
  updated_at INTEGER
);
