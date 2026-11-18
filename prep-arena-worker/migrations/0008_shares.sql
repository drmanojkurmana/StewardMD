-- PrepReels "send to a friend" (owner 2026-11-17). ref is a JSON reference (functions/_prep-social.js validShareRef), never
-- free text. The route also creates the table on first use. Leave Arena deletes the rows (socialDeleteStmts).
-- Apply (owner): npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0008_shares.sql
CREATE TABLE IF NOT EXISTS social_shares (id INTEGER PRIMARY KEY AUTOINCREMENT, from_uidh TEXT NOT NULL, to_uidh TEXT NOT NULL, ref TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS social_shares_to ON social_shares (to_uidh, at);
