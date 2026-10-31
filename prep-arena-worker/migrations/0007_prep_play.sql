-- PrepNucleus play: focus room, spot diagnosis board, mnemonic lab (functions/api/prep/play/[[path]].js).
-- Same keys as the Arena (uidh). Leaving the Arena deletes every row (functions/_prep-social.js socialDeleteStmts).
-- Seasons need no table: they are computed from arena_battles and arena_entries.
-- Apply: npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0007_prep_play.sql
CREATE TABLE IF NOT EXISTS play_focus (
  uidh TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS play_focus_at ON play_focus (at);
CREATE TABLE IF NOT EXISTS play_spot (
  day TEXT NOT NULL,
  uidh TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, uidh)
);
CREATE TABLE IF NOT EXISTS play_mn (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  uidh TEXT NOT NULL,
  text TEXT NOT NULL,
  up INTEGER NOT NULL DEFAULT 0,
  rep INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS play_mn_item ON play_mn (item, hidden, up DESC);
CREATE INDEX IF NOT EXISTS play_mn_uidh ON play_mn (uidh, day);
CREATE TABLE IF NOT EXISTS play_mn_vote (
  mn TEXT NOT NULL,
  uidh TEXT NOT NULL,
  up INTEGER NOT NULL,
  PRIMARY KEY (mn, uidh)
);
CREATE TABLE IF NOT EXISTS play_mn_report (
  mn TEXT NOT NULL,
  uidh TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (mn, uidh)
);
