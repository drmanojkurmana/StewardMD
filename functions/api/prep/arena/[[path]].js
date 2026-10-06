/* /api/prep/arena/* - PrepNucleus Arena: consent, daily and weekly events, boards and stats.
 * Plan: vault/plans/PrepNucleus-Arena.md (server piece 3). Live 1v1 battles are the prep-arena Worker.
 *
 * Every call needs a Bearer Firebase ID token (401 otherwise). Players are keyed by sha256(uid) (24 hex), shown by the
 * token's `name` claim (never the email), and only after consent (POST consent). DELETE consent removes the player,
 * every event entry, their side of past battles, and every social row (friends, challenges, college, groups).
 *
 *   GET    consent                    -> { joined, name }
 *   POST   consent                    -> { joined: true, name }
 *   DELETE consent                    -> { left: true }
 *   GET    events?exam=               -> { events: [ current + next, daily and weekly ] }
 *   POST   events/<id>/start          -> { id, items:[{id,q,o}], secs, startedAt, endsAt }   (no keys)
 *   POST   events/<id>/submit {ans}   -> { score, right, wrong, blank, rank, of, key }       (once: 409 after)
 *   GET    events/<id>/board          -> { rows:[{rank,name,score,ms}], me }
 *   GET    board?exam=&period=week|all -> battle rating board { rows:[{rank,name,rating,battles,wins}], me }
 *   GET    me/stats                   -> { player, events, battles, trend }
 *
 * Timing is the server's: an entry starts at `start`, its ms is server elapsed time, and a submit counts until
 * min(start + secs, window end) + 60 s. Bindings: PREP_ARENA_DB (D1), PREP_BANK_R2 (the screened bank).
 */
import { verifiedClaimsFor } from "../../../_fbauth.js";
import { EXAMS, SCHEMES, uidHash, displayName, markEntry, eventFromId, scheduleFor, submitDeadline, bankFrom, drawItems } from "../../../_prep-arena.js";
import { socialDeleteStmts } from "../../../_prep-social.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const DAY = 86400e3;
const _draws = new Map();   // event id -> drawn items, per isolate (bank files are immutable within v1)

async function itemsFor(env, ev) {
  if (_draws.has(ev.id)) return _draws.get(ev.id);
  const items = await drawItems(bankFrom(env.PREP_BANK_R2), ev.exam, ev.n, ev.seed);
  if (items.length) { if (_draws.size > 50) _draws.clear(); _draws.set(ev.id, items); }
  return items;
}

// The event row for id (created lazily, deterministically), or null: unknown id, or more than 35 days away.
async function eventRow(db, id, now) {
  const ev = eventFromId(id);
  if (!ev || Math.abs(ev.starts_at - now) > 35 * DAY) return null;
  await db.prepare("INSERT OR IGNORE INTO arena_events (id, kind, exam, starts_at, ends_at, n, secs, seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(ev.id, ev.kind, ev.exam, ev.starts_at, ev.ends_at, ev.n, ev.secs, ev.seed).run();
  return ev;
}
const playerOf = (db, uidh) => db.prepare("SELECT uidh, name, consent_at, rating, battles, wins FROM arena_players WHERE uidh = ?").bind(uidh).first();
const entryOf = (db, eid, uidh) => db.prepare("SELECT * FROM arena_entries WHERE event_id = ? AND uidh = ?").bind(eid, uidh).first();
const pubEvent = (ev, now, entry) => ({
  id: ev.id, kind: ev.kind, exam: ev.exam, startsAt: ev.starts_at, endsAt: ev.ends_at, n: ev.n, secs: ev.secs,
  status: now < ev.starts_at ? "upcoming" : now < ev.ends_at ? "open" : "closed",
  entry: entry ? (entry.submitted_at ? "submitted" : "started") : null,
});
// Competition ranking: equal (score, ms) share a rank.
function ranked(rows, key) {
  let prev = null, rank = 0;
  return rows.map((r, i) => { const k = key(r); if (k !== prev) { rank = i + 1; prev = k; } return { rank, r }; });
}

export async function handle(request, env, path, now = Date.now()) {
  const claims = await verifiedClaimsFor(request, env);
  if (!claims || !claims.sub) return json({ error: "sign-in-required" }, 401);
  const db = env && env.PREP_ARENA_DB;
  if (!db) return json({ error: "not-configured" }, 503);
  const uidh = uidHash(claims.sub), method = request.method, url = new URL(request.url);
  const p = path.split("/").filter(Boolean);

  if (p[0] === "consent" && p.length === 1) {
    if (method === "GET") { const pl = await playerOf(db, uidh); return json({ joined: !!pl, name: pl ? pl.name : displayName(claims, uidh) }); }
    if (method === "POST") {
      const name = displayName(claims, uidh);
      await db.prepare("INSERT INTO arena_players (uidh, name, consent_at) VALUES (?, ?, ?) ON CONFLICT(uidh) DO UPDATE SET name = excluded.name, consent_at = excluded.consent_at").bind(uidh, name, now).run();
      return json({ joined: true, name });
    }
    if (method === "DELETE") {
      await db.batch([
        db.prepare("DELETE FROM arena_entries WHERE uidh = ?").bind(uidh),
        db.prepare("UPDATE arena_battles SET a = 'gone' WHERE a = ?").bind(uidh),
        db.prepare("UPDATE arena_battles SET b = 'gone' WHERE b = ?").bind(uidh),
        db.prepare("UPDATE arena_battles SET winner = 'gone' WHERE winner = ?").bind(uidh),
        ...socialDeleteStmts(db, uidh),   // friends, challenges, college tag, groups, progress
        db.prepare("DELETE FROM arena_players WHERE uidh = ?").bind(uidh),
      ]);
      return json({ left: true });
    }
    return json({ error: "method-not-allowed" }, 405);
  }

  if (p[0] === "events" && p.length === 1 && method === "GET") {
    const exam = url.searchParams.get("exam") || "";
    if (EXAMS.indexOf(exam) < 0) return json({ error: "bad-exam" }, 400);
    const out = [];
    for (const ev of scheduleFor(exam, now)) {
      await eventRow(db, ev.id, now);
      out.push({ role: ev.role, ...pubEvent(ev, now, await entryOf(db, ev.id, uidh)) });
    }
    return json({ events: out });
  }

  if (p[0] === "events" && p.length === 3) {
    const ev = await eventRow(db, p[1], now);
    if (!ev) return json({ error: "not-found" }, 404);
    const act = p[2];

    if (act === "board" && method === "GET") {
      const { results } = await db.prepare("SELECT e.uidh, e.score, e.ms, p.name FROM arena_entries e JOIN arena_players p ON p.uidh = e.uidh WHERE e.event_id = ? AND e.submitted_at IS NOT NULL ORDER BY e.score DESC, e.ms ASC LIMIT 50").bind(ev.id).all();
      const rows = ranked(results || [], (r) => r.score + ":" + r.ms).map(({ rank, r }) => ({ rank, name: r.name, score: r.score, ms: r.ms, ...(r.uidh === uidh ? { me: true } : {}) }));
      let me = null;
      const mine = await entryOf(db, ev.id, uidh);
      if (mine && mine.submitted_at) {
        const better = await db.prepare("SELECT COUNT(*) AS c FROM arena_entries WHERE event_id = ? AND submitted_at IS NOT NULL AND (score > ? OR (score = ? AND ms < ?))").bind(ev.id, mine.score, mine.score, mine.ms).first();
        const pl = await playerOf(db, uidh);
        me = { rank: (better ? better.c : 0) + 1, name: pl ? pl.name : displayName(claims, uidh), score: mine.score, ms: mine.ms };
      }
      return json({ event: pubEvent(ev, now, mine), rows, me });
    }

    if (method !== "POST" || (act !== "start" && act !== "submit")) return json({ error: "not-found" }, 404);
    if (!(await playerOf(db, uidh))) return json({ error: "consent-required" }, 403);
    if (now < ev.starts_at) return json({ error: "not-open", startsAt: ev.starts_at }, 425);
    let entry = await entryOf(db, ev.id, uidh);
    if (entry && entry.submitted_at) return json({ error: "already-submitted" }, 409);

    if (act === "start") {
      if (!entry && now >= ev.ends_at) return json({ error: "closed" }, 410);
      const items = await itemsFor(env, ev);
      if (!items.length) return json({ error: "bank-empty" }, 503);
      if (!entry) {
        await db.prepare("INSERT OR IGNORE INTO arena_entries (event_id, uidh, started_at) VALUES (?, ?, ?)").bind(ev.id, uidh, now).run();
        entry = await entryOf(db, ev.id, uidh);
      }
      const endsAt = Math.min(entry.started_at + ev.secs * 1000, ev.ends_at);
      if (now > endsAt + 60e3) return json({ error: "closed" }, 410);
      return json({ id: ev.id, items: items.map((it) => ({ id: it.id, q: it.q, o: it.o })), secs: ev.secs, startedAt: entry.started_at, endsAt });
    }

    // submit
    if (!entry) return json({ error: "not-started" }, 409);
    if (now > submitDeadline(ev, entry.started_at)) return json({ error: "too-late" }, 410);
    let b = null; try { b = await request.json(); } catch (e) { b = null; }
    const ans = b && b.ans;
    if (!ans || typeof ans !== "object" || Array.isArray(ans) || Object.keys(ans).length > 500) return json({ error: "bad-request" }, 400);
    const items = await itemsFor(env, ev);
    if (!items.length) return json({ error: "bank-empty" }, 503);
    const m = markEntry(items, ans, SCHEMES[ev.exam]);
    // server time, capped at the entry's own end (the grace minute does not count); the client's ms is not trusted
    const ms = Math.max(0, Math.min(now, entry.started_at + ev.secs * 1000, ev.ends_at) - entry.started_at);
    const r = await db.prepare("UPDATE arena_entries SET submitted_at = ?, score = ?, \"right\" = ?, wrong = ?, blank = ?, ms = ? WHERE event_id = ? AND uidh = ? AND submitted_at IS NULL")
      .bind(now, m.score, m.right, m.wrong, m.blank, ms, ev.id, uidh).run();
    if (!(r && r.meta && r.meta.changes === 1)) return json({ error: "already-submitted" }, 409);
    const better = await db.prepare("SELECT COUNT(*) AS c FROM arena_entries WHERE event_id = ? AND submitted_at IS NOT NULL AND (score > ? OR (score = ? AND ms < ?))").bind(ev.id, m.score, m.score, ms).first();
    const of = await db.prepare("SELECT COUNT(*) AS c FROM arena_entries WHERE event_id = ? AND submitted_at IS NOT NULL").bind(ev.id).first();
    const key = {}; items.forEach((it) => { key[it.id] = it.a; });
    return json({ score: m.score, right: m.right, wrong: m.wrong, blank: m.blank, ms, rank: (better ? better.c : 0) + 1, of: of ? of.c : 1, key });
  }

  if (p[0] === "board" && p.length === 1 && method === "GET") {
    const exam = url.searchParams.get("exam") || "", period = url.searchParams.get("period") || "all";
    if (EXAMS.indexOf(exam) < 0 || (period !== "week" && period !== "all")) return json({ error: "bad-request" }, 400);
    const since = period === "week" ? now - 7 * DAY : 0;
    // Players with a battle in this exam (this week, or ever), by rating. Rating is one number per player.
    const base = "SELECT p.uidh, p.name, p.rating, COUNT(*) AS battles, SUM(CASE WHEN b.winner = p.uidh THEN 1 ELSE 0 END) AS wins FROM arena_players p JOIN arena_battles b ON (b.a = p.uidh OR b.b = p.uidh) WHERE b.exam = ? AND b.ended_at >= ?";
    const { results } = await db.prepare(base + " GROUP BY p.uidh ORDER BY p.rating DESC, battles DESC LIMIT 50").bind(exam, since).all();
    const rows = ranked(results || [], (r) => r.rating).map(({ rank, r }) => ({ rank, name: r.name, rating: r.rating, battles: r.battles, wins: r.wins, ...(r.uidh === uidh ? { me: true } : {}) }));
    const mine = await db.prepare(base + " AND p.uidh = ? GROUP BY p.uidh").bind(exam, since, uidh).first();
    let me = null;
    if (mine) {
      const better = await db.prepare("SELECT COUNT(*) AS c FROM (SELECT p.uidh FROM arena_players p JOIN arena_battles b ON (b.a = p.uidh OR b.b = p.uidh) WHERE b.exam = ? AND b.ended_at >= ? AND p.rating > ? GROUP BY p.uidh)").bind(exam, since, mine.rating).first();
      me = { rank: (better ? better.c : 0) + 1, name: mine.name, rating: mine.rating, battles: mine.battles, wins: mine.wins };
    }
    return json({ exam, period, rows, me });
  }

  if (p[0] === "me" && p[1] === "stats" && p.length === 2 && method === "GET") {
    const pl = await playerOf(db, uidh);
    if (!pl) return json({ error: "consent-required" }, 403);
    const ev = await db.prepare("SELECT e.event_id, v.kind, v.exam, e.score, e.\"right\" AS r, e.wrong, e.blank, e.ms, e.submitted_at FROM arena_entries e JOIN arena_events v ON v.id = e.event_id WHERE e.uidh = ? AND e.submitted_at IS NOT NULL ORDER BY e.submitted_at DESC LIMIT 60").bind(uidh).all();
    const bt = await db.prepare("SELECT b.*, pa.name AS a_name, pb.name AS b_name FROM arena_battles b LEFT JOIN arena_players pa ON pa.uidh = b.a LEFT JOIN arena_players pb ON pb.uidh = b.b WHERE b.a = ? OR b.b = ? ORDER BY b.ended_at DESC LIMIT 60").bind(uidh, uidh).all();
    const battles = (bt.results || []).map((x) => {
      const isA = x.a === uidh;
      return { id: x.id, exam: x.exam, opp: (isA ? x.b_name : x.a_name) || "Former player", score: isA ? [x.a_score, x.b_score] : [x.b_score, x.a_score],
        result: !x.winner ? "draw" : x.winner === uidh ? "win" : "loss", rating: isA ? x.a_after : x.b_after, endedAt: x.ended_at };
    });
    return json({
      player: { name: pl.name, rating: pl.rating, battles: pl.battles, wins: pl.wins, since: pl.consent_at },
      events: (ev.results || []).map((x) => ({ id: x.event_id, kind: x.kind, exam: x.exam, score: x.score, right: x.r, wrong: x.wrong, blank: x.blank, ms: x.ms, at: x.submitted_at })),
      battles,
      trend: battles.filter((x) => x.rating != null).map((x) => ({ t: x.endedAt, rating: x.rating })).reverse(),
    });
  }

  return json({ error: "not-found" }, 404);
}

export async function onRequest({ request, env, params }) {
  const path = [].concat((params && params.path) || []).map(String).join("/");
  try { return await handle(request, env, path); }
  catch (e) { return json({ error: "server-error" }, 500); }
}
