-- PrepNucleus Arena D1 schema (database prep-arena-db, binding PREP_ARENA_DB on the prep-arena Worker and on Pages).
-- Plan: vault/plans/PrepNucleus-Arena.md. Keys are sha256(uid) hex prefixes (24); no email anywhere.
-- Apply: npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/schema.sql
CREATE TABLE IF NOT EXISTS arena_players (
  uidh TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  consent_at INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1200,
  battles INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS arena_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  exam TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  n INTEGER NOT NULL,
  secs INTEGER NOT NULL,
  seed TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_entries (
  event_id TEXT NOT NULL,
  uidh TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  score REAL,
  right INTEGER,
  wrong INTEGER,
  blank INTEGER,
  ms INTEGER,
  PRIMARY KEY (event_id, uidh)
);
CREATE INDEX IF NOT EXISTS arena_entries_board ON arena_entries (event_id, score DESC, ms ASC);
CREATE INDEX IF NOT EXISTS arena_entries_uidh ON arena_entries (uidh);
-- a_after / b_after: each side's rating after the battle (the "rating trend" in me/stats; added to the plan's columns).
CREATE TABLE IF NOT EXISTS arena_battles (
  id TEXT PRIMARY KEY,
  exam TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  a_score INTEGER NOT NULL,
  b_score INTEGER NOT NULL,
  winner TEXT,
  ended_at INTEGER NOT NULL,
  a_after INTEGER,
  b_after INTEGER
);
CREATE INDEX IF NOT EXISTS arena_battles_a ON arena_battles (a, ended_at);
CREATE INDEX IF NOT EXISTS arena_battles_b ON arena_battles (b, ended_at);
CREATE INDEX IF NOT EXISTS arena_battles_exam ON arena_battles (exam, ended_at);
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

-- PrepNucleus social (friends, challenges, college tags, study groups). Owner decision 2026-10-06. Same keys as the
-- Arena (uidh = sha256(uid) prefix 24). Leave Arena deletes every row (functions/_prep-social.js socialDeleteStmts).
-- Apply (owner): npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0002_social.sql
CREATE TABLE IF NOT EXISTS social_ids (
  uidh TEXT PRIMARY KEY,
  smd_id TEXT NOT NULL UNIQUE
);
-- One row per pair, a < b. requester sent the request; accepted_at set when accepted.
CREATE TABLE IF NOT EXISTS social_friends (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requester TEXT NOT NULL,
  at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS social_friends_b ON social_friends (b);
CREATE TABLE IF NOT EXISTS social_challenges (
  room TEXT PRIMARY KEY,
  from_uidh TEXT NOT NULL,
  to_uidh TEXT NOT NULL,
  exam TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted'))
);
CREATE INDEX IF NOT EXISTS social_challenges_to ON social_challenges (to_uidh, expires_at);
CREATE INDEX IF NOT EXISTS social_challenges_from ON social_challenges (from_uidh, expires_at);
CREATE TABLE IF NOT EXISTS social_college (
  uidh TEXT PRIMARY KEY,
  college_key TEXT NOT NULL,
  college TEXT NOT NULL,
  state_key TEXT NOT NULL,
  state TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_college_key ON social_college (college_key);
CREATE INDEX IF NOT EXISTS social_college_state ON social_college (state_key);
CREATE TABLE IF NOT EXISTS social_groups (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT,
  daily_target INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_group_members (
  code TEXT NOT NULL,
  uidh TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (code, uidh)
);
CREATE INDEX IF NOT EXISTS social_group_members_uidh ON social_group_members (uidh);
-- Questions done per IST day, reported by the client (POST progress); feeds group todayDone and the weekly sprint.
CREATE TABLE IF NOT EXISTS social_progress (
  uidh TEXT NOT NULL,
  day TEXT NOT NULL,
  done INTEGER NOT NULL,
  PRIMARY KEY (uidh, day)
);
