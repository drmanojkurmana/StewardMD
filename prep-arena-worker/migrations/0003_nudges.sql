-- PrepNucleus social nudges (vault/plans/PrepNucleus-Nudges.md, functions/_prep-nudge-push.js). One row per Arena player
-- who chose Smart nudges on a phone with push allowed. toks = JSON array of push token ids (functions/_nativepush.js
-- tokenId, a hash; at most 3), never the uid. quiet "HH:MM-HH:MM" and tz (Date.getTimezoneOffset) are the player's own;
-- day/n/last_at enforce 2 a day and 4 h apart. Leave Arena deletes the row (functions/_prep-social.js socialDeleteStmts).
-- Apply (owner): npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0003_nudges.sql
CREATE TABLE IF NOT EXISTS social_push (
  uidh TEXT PRIMARY KEY,
  toks TEXT NOT NULL,
  quiet TEXT NOT NULL,
  tz INTEGER NOT NULL,
  day TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER,
  at INTEGER NOT NULL
);
