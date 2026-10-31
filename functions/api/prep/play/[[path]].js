/* /api/prep/play/* - PrepNucleus play: focus room, spot diagnosis board, mnemonic lab, seasons (owner 2026-10-30).
 * Client: prep-play.js. Helpers: functions/_prep-play.js. D1: PREP_ARENA_DB (migration prep-arena-worker/migrations/0007_prep_play.sql).
 *
 * Every call needs a Bearer Firebase ID token (401). Students are keyed by sha256(uid) (24 hex, like the Arena). Calls
 * that show a name (spot board, seasons) also need the Arena consent row (403 consent-required). Leaving the Arena
 * deletes every play row (functions/_prep-social.js socialDeleteStmts).
 *
 *   GET  focus                      -> { now }                  students in a focus session now (heartbeats in 150 s)
 *   POST focus {on}                 -> { now }                  heartbeat (on: true) or leave (on: false)
 *   GET  spot                       -> { day, rows:[{rank,name,ms}], me:{rank,ok,ms}|null, n }   (consent)
 *   POST spot {day, ok, ms}         -> same as GET; once per day (409 already)                    (consent)
 *   GET  mn?item=                   -> { items:[{id,text,up,mine,voted}] }  top 5 shown, newest ties last
 *   POST mn {item, text}            -> { id } | { error: length|no-links|limit }
 *   POST mn/vote {id, up}           -> { up }                    one vote per student, up true or false
 *   POST mn/report {id}             -> { ok }                    hidden after 3 reports
 *   POST mn/delete {id}             -> { ok }                    own only
 *   GET  season?exam=               -> { season:{n,start,end}, me:{points,rank,tier,at,next}, rows:[{rank,name,points,tier}], last:{n,tier,points}|null } (consent)
 */
import { verifiedClaimsFor } from "../../../_fbauth.js";
import { EXAMS, uidHash } from "../../../_prep-arena.js";
import { istDay, seasonOf, tierOf, cleanSpot, cleanMnemonic, ITEM_RE, MN_PER_DAY, MN_HIDE_AT, FOCUS_WINDOW } from "../../../_prep-play.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const err = (code, s) => json({ error: code }, s);
function ranked(rows, key) {
  let prev = null, rank = 0;
  return rows.map((r, i) => { const k = key(r); if (k !== prev) { rank = i + 1; prev = k; } return { rank, r }; });
}
const mnId = () => "mn" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

// Season points per player for exam within [start, end): battles (win 3, draw 1) and submitted event entries (1 each).
async function seasonRows(db, exam, start, end) {
  const { results } = await db.prepare(
    "SELECT u, SUM(pts) AS points FROM (" +
    " SELECT a AS u, CASE WHEN winner = a THEN 3 WHEN winner IS NULL THEN 1 ELSE 0 END AS pts FROM arena_battles WHERE exam = ?1 AND ended_at >= ?2 AND ended_at < ?3" +
    " UNION ALL SELECT b AS u, CASE WHEN winner = b THEN 3 WHEN winner IS NULL THEN 1 ELSE 0 END AS pts FROM arena_battles WHERE exam = ?1 AND ended_at >= ?2 AND ended_at < ?3" +
    " UNION ALL SELECT e.uidh AS u, 1 AS pts FROM arena_entries e JOIN arena_events v ON v.id = e.event_id WHERE v.exam = ?1 AND e.submitted_at >= ?2 AND e.submitted_at < ?3" +
    ") x JOIN arena_players p ON p.uidh = x.u GROUP BY u ORDER BY points DESC").bind(exam, start, end).all();
  return results || [];
}

export async function handle(request, env, path, now = Date.now()) {
  const claims = await verifiedClaimsFor(request, env);
  if (!claims || !claims.sub) return err("sign-in-required", 401);
  const db = env && env.PREP_ARENA_DB;
  if (!db) return err("not-configured", 503);
  const uidh = uidHash(claims.sub), method = request.method, url = new URL(request.url);
  const route = method + " " + path.split("/").filter(Boolean).join("/");
  let b = {};
  if (method === "POST") { try { b = (await request.json()) || {}; } catch (e) { b = {}; } if (typeof b !== "object" || Array.isArray(b)) b = {}; }
  const today = istDay(now);
  const player = () => db.prepare("SELECT uidh, name FROM arena_players WHERE uidh = ?").bind(uidh).first();

  /* ---------- focus room ---------- */
  if (route === "GET focus" || route === "POST focus") {
    if (method === "POST") {
      if (b.on) await db.prepare("INSERT INTO play_focus (uidh, at) VALUES (?, ?) ON CONFLICT(uidh) DO UPDATE SET at = excluded.at").bind(uidh, now).run();
      else await db.prepare("DELETE FROM play_focus WHERE uidh = ?").bind(uidh).run();
    }
    const r = await db.prepare("SELECT COUNT(*) AS n FROM play_focus WHERE at > ?").bind(now - FOCUS_WINDOW).first();
    return json({ now: (r && r.n) || 0 });
  }

  /* ---------- spot diagnosis board ---------- */
  if (route === "GET spot" || route === "POST spot") {
    if (!(await player())) return err("consent-required", 403);
    if (method === "POST") {
      const x = cleanSpot(b, today);
      if (!x) return err("bad-request", 400);
      const had = await db.prepare("SELECT 1 AS x FROM play_spot WHERE day = ? AND uidh = ?").bind(today, uidh).first();
      if (had) return err("already", 409);
      await db.prepare("INSERT INTO play_spot (day, uidh, ok, ms, at) VALUES (?, ?, ?, ?, ?)").bind(today, uidh, x.ok, x.ms, now).run();
    }
    const { results } = await db.prepare("SELECT s.uidh, s.ok, s.ms, p.name FROM play_spot s JOIN arena_players p ON p.uidh = s.uidh WHERE s.day = ? ORDER BY s.ok DESC, s.ms ASC").bind(today).all();
    const all = results || [], right = all.filter((r) => r.ok), rk = ranked(right, (r) => r.ms), mine = all.find((r) => r.uidh === uidh);
    const myRank = mine && mine.ok ? (rk.find((x) => x.r.uidh === uidh) || {}).rank : null;
    return json({ day: today, n: all.length, rows: rk.slice(0, 30).map(({ rank, r }) => ({ rank, name: r.name, ms: r.ms, me: r.uidh === uidh })),
      me: mine ? { rank: myRank || null, ok: !!mine.ok, ms: mine.ms } : null });
  }

  /* ---------- mnemonic lab ---------- */
  if (route === "GET mn") {
    const item = url.searchParams.get("item") || "";
    if (!ITEM_RE.test(item)) return err("bad-request", 400);
    const { results } = await db.prepare(
      "SELECT m.id, m.text, m.up, m.uidh, (SELECT v.up FROM play_mn_vote v WHERE v.mn = m.id AND v.uidh = ?2) AS voted FROM play_mn m " +
      "WHERE m.item = ?1 AND m.hidden = 0 ORDER BY m.up DESC, m.at ASC LIMIT 5").bind(item, uidh).all();
    return json({ items: (results || []).map((r) => ({ id: r.id, text: r.text, up: r.up, mine: r.uidh === uidh, voted: r.voted === 1 })) });
  }
  if (route === "POST mn") {
    const item = String(b.item || "");
    if (!ITEM_RE.test(item)) return err("bad-request", 400);
    const c = cleanMnemonic(b.text);
    if (c.error) return err(c.error, 400);
    const n = await db.prepare("SELECT COUNT(*) AS c FROM play_mn WHERE uidh = ? AND day = ?").bind(uidh, today).first();
    if (n && n.c >= MN_PER_DAY) return err("limit", 429);
    const id = mnId();
    await db.prepare("INSERT INTO play_mn (id, item, uidh, text, up, rep, hidden, at, day) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)").bind(id, item, uidh, c.text, now, today).run();
    return json({ id });
  }
  if (route === "POST mn/vote" || route === "POST mn/report" || route === "POST mn/delete") {
    const id = String(b.id || "");
    const row = /^mn[0-9a-f]{16}$/.test(id) && (await db.prepare("SELECT id, uidh, up FROM play_mn WHERE id = ?").bind(id).first());
    if (!row) return err("not_found", 404);
    if (route === "POST mn/delete") {
      if (row.uidh !== uidh) return err("not_found", 404);
      await db.batch([db.prepare("DELETE FROM play_mn_vote WHERE mn = ?").bind(id), db.prepare("DELETE FROM play_mn WHERE id = ?").bind(id)]);
      return json({ ok: true });
    }
    if (route === "POST mn/report") {
      const r = await db.prepare("INSERT OR IGNORE INTO play_mn_report (mn, uidh, at) VALUES (?, ?, ?)").bind(id, uidh, now).run();
      if (r && r.meta && r.meta.changes) await db.prepare("UPDATE play_mn SET rep = rep + 1, hidden = CASE WHEN rep + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?").bind(MN_HIDE_AT, id).run();
      return json({ ok: true });
    }
    if (row.uidh === uidh) return err("own", 400);
    const up = b.up === true ? 1 : 0;
    const had = await db.prepare("SELECT up FROM play_mn_vote WHERE mn = ? AND uidh = ?").bind(id, uidh).first();
    const delta = up - (had ? had.up : 0);
    await db.batch([
      db.prepare("INSERT INTO play_mn_vote (mn, uidh, up) VALUES (?, ?, ?) ON CONFLICT(mn, uidh) DO UPDATE SET up = excluded.up").bind(id, uidh, up),
      db.prepare("UPDATE play_mn SET up = up + ? WHERE id = ?").bind(delta, id),
    ]);
    return json({ up: row.up + delta });
  }

  /* ---------- seasons ---------- */
  if (route === "GET season") {
    if (!(await player())) return err("consent-required", 403);
    const exam = url.searchParams.get("exam") || "neet-pg";
    if (EXAMS.indexOf(exam) < 0) return err("bad-exam", 400);
    const s = seasonOf(now), prev = seasonOf(s.start - 1);
    const rows = await seasonRows(db, exam, s.start, s.end), rk = ranked(rows, (r) => r.points);
    const mine = rk.find((x) => x.r.u === uidh), pts = mine ? mine.r.points : 0;
    const last = (await seasonRows(db, exam, prev.start, prev.end)).find((r) => r.u === uidh);
    const names = new Map();
    const top = rk.slice(0, 50);
    if (top.length) {
      const { results } = await db.prepare("SELECT uidh, name FROM arena_players WHERE uidh IN (" + top.map(() => "?").join(",") + ")").bind(...top.map((x) => x.r.u)).all();
      for (const r of results || []) names.set(r.uidh, r.name);
    }
    return json({
      season: { n: s.n, start: s.start, end: s.end },
      me: { points: pts, rank: mine ? mine.rank : null, ...tierOf(pts) },
      rows: top.map(({ rank, r }) => ({ rank, name: names.get(r.u) || "Doctor", points: r.points, tier: tierOf(r.points).tier, me: r.u === uidh })),
      last: last ? { n: prev.n, points: last.points, tier: tierOf(last.points).tier } : null,
    });
  }

  return err("not-found", 404);
}

export async function onRequest({ request, env, params }) {
  const path = [].concat((params && params.path) || []).map(String).join("/");
  try { return await handle(request, env, path, Date.now()); }
  catch (e) { return err("server-error", 500); }
}
