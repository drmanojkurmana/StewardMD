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
 *   sender: "user" | "support";  kind: "msg" | "status:<open|in_progress|resolved>" | "read" | "typing"
 *   | "new:<bug|help|feedback>" (older rows: "new")
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

/* Owner 2026-09-27: "still not as fast or real time as WhatsApp". A long-poll: the request is held
 * open and answers the moment an event lands (checking D1 every tickMs), or with nothing after
 * waitMs, and the client asks again straight away. One request per ~20 s when idle instead of one
 * every few seconds, and a reply shows up within a tick instead of a poll interval. */
export const WAIT_MAX_MS = 25000;
export const MAX_CHECKS = 40;
export async function waitEvents(env, { owner, after, waitMs, tickMs } = {}, db) {
  db = db || liveDb(env);
  const wait = Math.max(0, Math.min(WAIT_MAX_MS, +waitMs || 0));
  const tick = Math.max(100, Math.min(5000, +tickMs || 400));
  const end = Date.now() + wait;
  // At most MAX_CHECKS D1 queries per held request (Workers cap queries per invocation; the free plan
  // at 50). At the fast rate that ends a hold at ~14 s; the client simply asks again.
  for (let n = 1; ; n++) {
    const r = await eventsSince(env, { owner, after }, db);
    if (!r.live || r.events.length || Date.now() + tick > end || n >= MAX_CHECKS) return r;
    await new Promise((res) => setTimeout(res, tick));
  }
}

/* KV is eventually consistent across edge locations, so a ticket read at one PoP can miss a message
 * written a moment ago at another, and writing that stale copy back would drop it. Every message is
 * also in the D1 log, so reads and writes fold in the recent ones: a message is never lost or hidden
 * by KV lag. -> [{ ticket, from, text, ts }] */
export async function recentMsgs(env, { ticket, owner, since } = {}, db) {
  db = db || liveDb(env);
  if (!db || (!ticket && !owner)) return [];
  try {
    await ensure(db);
    const s = Math.max(0, +since || 0);
    const q = ticket
      ? db.prepare("SELECT ticket, sender, text, ts FROM support_events WHERE ticket = ? AND kind = 'msg' AND ts >= ? ORDER BY seq LIMIT 500").bind(String(ticket), s)
      : db.prepare("SELECT ticket, sender, text, ts FROM support_events WHERE owner = ? AND kind = 'msg' AND ts >= ? ORDER BY seq LIMIT 500").bind(String(owner), s);
    const r = await q.all();
    return ((r && r.results) || []).map((e) => ({ ticket: e.ticket, from: e.sender === "support" ? "support" : "user", text: e.text, ts: +e.ts }));
  } catch (e) { return []; }
}
// Fold messages into a ticket (same sender + text within 5 s = the same message). Mutates and returns t.
export function mergeMsgs(t, msgs) {
  if (!t || !msgs || !msgs.length) return t;
  const have = t.messages = t.messages || [];
  let added = false;
  msgs.forEach((m) => {
    if (m.ticket && m.ticket !== t.id) return;
    if (!m.text) return;
    if (have.some((h) => h.from === m.from && h.text === m.text && Math.abs((h.ts || 0) - m.ts) < 5000)) return;
    have.push({ from: m.from, text: m.text, ts: m.ts }); added = true;
    if (m.from === "support" && !(t.userSeenAt >= m.ts)) t.userUnread = true;
    if (m.ts > (t.updatedAt || 0)) t.updatedAt = m.ts;
  });
  if (added) have.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return t;
}

/* The admin inbox list is the KV index, which lags the same way. Fold the last few minutes of D1
 * into it: a conversation's latest message, its unread dot, and conversations started so recently
 * that the index here has not caught up. Mutates and returns rows. */
export async function mergeIndex(env, rows, since, db) {
  db = db || liveDb(env);
  if (!db || !Array.isArray(rows)) return rows;
  let evs = [];
  try {
    await ensure(db);
    const r = await db.prepare("SELECT ticket, owner, sender, kind, text, ts FROM support_events WHERE ts >= ? AND (kind = 'msg' OR kind = 'read' OR kind LIKE 'new%' OR kind LIKE 'status:%') ORDER BY seq LIMIT 1000").bind(Math.max(0, +since || 0)).all();
    evs = (r && r.results) || [];
  } catch (e) { return rows; }
  const byId = {}; rows.forEach((x) => { byId[x.id] = x; });
  evs.forEach((e) => {
    let row = byId[e.ticket];
    if (!row && String(e.kind).indexOf("new") === 0) {
      const k = String(e.kind).split(":")[1];
      row = byId[e.ticket] = { id: e.ticket, owner: e.owner, subject: String(e.text || "").split("\n")[0].slice(0, 80) || "(new conversation)",
        status: "open", kind: k === "bug" || k === "feedback" ? k : "help", unread: true, createdAt: +e.ts, updatedAt: +e.ts,
        dueAt: k === "bug" ? +e.ts + 86400000 : undefined, last: { from: "user", text: String(e.text || "").slice(0, 140) }, _live: true };
      rows.unshift(row);
      return;
    }
    if (!row || +e.ts < (row.updatedAt || 0)) return;
    if (e.kind === "msg") {
      row.last = { from: e.sender === "support" ? "support" : "user", text: String(e.text || "").slice(0, 140) };
      row.updatedAt = +e.ts; row.unread = e.sender !== "support";
    } else if (e.kind === "read" && e.sender === "support") {
      row.unread = false;
    } else if (String(e.kind).indexOf("status:") === 0) {
      row.status = String(e.kind).slice(7); row.updatedAt = +e.ts;
      if (row.status === "resolved") row.resolvedAt = +e.ts; else delete row.resolvedAt;
    }
  });
  return rows;
}
