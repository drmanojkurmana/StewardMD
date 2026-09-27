/* _support_live.js - the live event log behind Help & Support chat.
 *
 * Owner report 2026-09-27: "I replied immediately but it never reached the user". Tickets live in KV
 * (_support.js), and KV is eventually consistent ACROSS edge locations: a reply written at one PoP
 * can take up to 60 s to be readable at the doctor's PoP, and the app only re-read on open. So every
 * message, status change and read receipt is ALSO appended here, in D1 (UPDATES_DB), which is
 * strongly consistent. Both sides poll `after=<seq>` every few seconds while a chat is open and get
 * exactly the new events; the KV ticket stays the list/thread of record.
 *
 * Table (created on first use, like _counters.js):
 *   support_events(seq PK autoinc, ticket, owner, sender, kind, text, ts)
 *   sender: "user" | "support";  kind: "msg" | "status:<open|in_progress|resolved>" | "read" | "new"
 * Text is the message itself (owner-only data, same access rules as the KV ticket) and is capped.
 * Old rows are pruned opportunistically (older than KEEP_MS); the KV thread keeps the history.
 */
const KEEP_MS = 30 * 86400000;
const TEXT_MAX = 4000;

export function liveDb(env) { try { return (env && env.UPDATES_DB) || null; } catch (e) { return null; } }

let _ready = null;
async function ensure(db) {
  if (_ready) return _ready;
  _ready = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS support_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ticket TEXT NOT NULL, owner TEXT NOT NULL, sender TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, ts INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS support_events_owner ON support_events (owner, seq)"),
  ]).catch((e) => { _ready = null; throw e; });
  return _ready;
}
export function _resetForTests() { _ready = null; }

// Append one event. Never throws (the KV write already happened; live is a fast path, not the record).
export async function logEvent(env, ev, db) {
  db = db || liveDb(env);
  if (!db || !ev || !ev.ticket || !ev.owner) return null;
  try {
    await ensure(db);
    const r = await db.prepare("INSERT INTO support_events (ticket, owner, sender, kind, text, ts) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(String(ev.ticket), String(ev.owner), ev.sender === "support" ? "support" : "user", String(ev.kind || "msg").slice(0, 40),
            ev.text == null ? null : String(ev.text).slice(0, TEXT_MAX), +ev.ts || Date.now()).run();
    if (Math.random() < 0.02) { try { await db.prepare("DELETE FROM support_events WHERE ts < ?").bind(Date.now() - KEEP_MS).run(); } catch (e) {} }
    return (r && r.meta && r.meta.last_row_id) || null;
  } catch (e) { return null; }
}

// Events after `after` (a seq). owner = one doctor's events only; null = everything (admin).
// -> { seq: highest seq seen (or `after`), events: [...] }. { live:false } when D1 is not bound.
export async function eventsSince(env, { owner, after, limit } = {}, db) {
  db = db || liveDb(env);
  if (!db) return { live: false, seq: +after || 0, events: [] };
  try {
    await ensure(db);
    const n = Math.max(1, Math.min(500, +limit || 200));
    const a = Math.max(0, +after || 0);
    const q = owner
      ? db.prepare("SELECT seq, ticket, owner, sender, kind, text, ts FROM support_events WHERE owner = ? AND seq > ? ORDER BY seq LIMIT ?").bind(String(owner), a, n)
      : db.prepare("SELECT seq, ticket, owner, sender, kind, text, ts FROM support_events WHERE seq > ? ORDER BY seq LIMIT ?").bind(a, n);
    const r = await q.all();
    const events = (r && r.results) || [];
    return { live: true, seq: events.length ? events[events.length - 1].seq : a, events };
  } catch (e) { return { live: false, seq: +after || 0, events: [] }; }
}

// The current head, so a client can start polling from "now" without replaying history.
export async function headSeq(env, owner, db) {
  db = db || liveDb(env);
  if (!db) return 0;
  try {
    await ensure(db);
    const r = owner
      ? await db.prepare("SELECT MAX(seq) AS s FROM support_events WHERE owner = ?").bind(String(owner)).first()
      : await db.prepare("SELECT MAX(seq) AS s FROM support_events").first();
    return (r && +r.s) || 0;
  } catch (e) { return 0; }
}
