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
