/* /api/prep/social/* - PrepNucleus social: friends, challenge a friend, college boards, study groups.
 * Owner decision 2026-10-06 (vault/decisions/Decisions.md). Same auth and consent as the Arena: Bearer Firebase ID
 * token (401), and only players who joined the Arena (arena_players row, else 403 consent-required). Leaving the Arena
 * deletes every social row (functions/_prep-social.js socialDeleteStmts). D1: PREP_ARENA_DB (migration
 * prep-arena-worker/migrations/0002_social.sql).
 *
 *   GET    friends                     -> { friends:[{smdId,name,since}], incoming:[{smdId,name,at}], outgoing:[...] }
 *   POST   friends/add|accept|decline|remove {smdId} -> { ok:true } | { error }   (adding someone who already asked you accepts)
 *   POST   challenge {smdId, exam?}    -> { room, expiresAt, exam }   (accepted friends only; 10 min)
 *   GET    challenges                  -> { incoming:[{room,from:{smdId,name},exam,expiresAt}], outgoing:[{room,to:{smdId,name},exam,expiresAt,status}] }
 *   POST   challenge/accept {room}     -> { room, exam };  challenge/decline {room} -> { ok:true }  (either side)
 *   GET    college-list                -> { colleges:[{name,state}] }
 *   GET    college                     -> { college, state, key, stateKey } | { college:null }
 *   POST   college {college, state}    -> same as GET;  DELETE college -> { ok:true }
 *   GET    board?scope=college|state&key= -> { rows:[{rank,name,score,rating}], me:{rank,score}|null, scope, key }
 *   POST   groups/create {name, dailyTarget} -> { code };  groups/join {code};  groups/leave {code} -> { ok:true }
 *   GET    groups                      -> { groups:[{code,name,dailyTarget,owner,mine,members:[{name,todayDone}]}] }
 *   GET    groups/board?code=          -> { rows:[{name,score}], week }
 *   POST   progress {done}             -> { ok:true }   (questions done today; feeds todayDone and the group sprint)
 *   POST   nudges {on, token, quiet, tz} -> { ok:true } | { error }   (social pushes for this phone, functions/_prep-nudge-push.js)
 *   POST   digest  (no user: X-Prep-Cron = PREP_CRON_TOKEN, the prep-arena Worker's cron) -> { players, sent }
 *
 * A challenge pushes to the friend it names (their limits apply); see functions/_prep-nudge-push.js.
 *
 * Board score: the sum of the player's Arena event scores (submitted daily and weekly entries) over the last 30 days;
 * ties broken by battle rating. Group sprint score: questions done this IST week (Monday start), from progress.
 */
import { verifiedClaimsFor } from "../../../_fbauth.js";
import { EXAMS, uidHash } from "../../../_prep-arena.js";
import { register as nudgeRegister, pushTo, digest, cronOk, safely, first } from "../../../_prep-nudge-push.js";
import { istDay, weekStart, randomCode, ROOM_RE, GROUP_RE, COLLEGES, collegeKey, cleanText, uidhForSmd, ensureMySmd, leaveGroupStmts, normalizeSmdId } from "../../../_prep-social.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const err = (code, s) => json({ error: code }, s);
const DAY = 86400e3, CHALLENGE_MS = 10 * 60e3, BOARD_DAYS = 30;
const MAX_FRIENDS = 200, MAX_OPEN_CHALLENGES = 5, MAX_GROUPS = 10, GROUP_MAX = 30;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
function ranked(rows, key) {
  let prev = null, rank = 0;
  return rows.map((r, i) => { const k = key(r); if (k !== prev) { rank = i + 1; prev = k; } return { rank, r }; });
}

/* bg(promise): the platform's waitUntil, so a push never delays the answer; without it (tests) the push is awaited. */
export async function handle(request, env, path, now = Date.now(), bg = null) {
  const later = async (p) => { const q = safely(p); if (bg) bg(q); else await q; };
  if (path === "digest") {
    if (request.method !== "POST" || !cronOk(env, request.headers.get("X-Prep-Cron"))) return err("not-found", 404);
    if (!(env && env.PREP_ARENA_DB)) return err("not-configured", 503);
    return json(await digest(env, env.PREP_ARENA_DB, now));
  }
  const claims = await verifiedClaimsFor(request, env);
  if (!claims || !claims.sub) return err("sign-in-required", 401);
  const db = env && env.PREP_ARENA_DB;
  if (!db) return err("not-configured", 503);
  const uidh = uidHash(claims.sub), method = request.method, url = new URL(request.url);
  const me = await db.prepare("SELECT uidh FROM arena_players WHERE uidh = ?").bind(uidh).first();
  if (!me) return err("consent-required", 403);
  const route = method + " " + path.split("/").filter(Boolean).join("/");
  let b = {};
  if (method === "POST") { try { b = (await request.json()) || {}; } catch (e) { b = {}; } if (typeof b !== "object" || Array.isArray(b)) b = {}; }
  const q = (k) => url.searchParams.get(k) || "";
  const today = istDay(now);

  // The other player named by smdId in the body: { o } or { res } (an error response).
  async function other(fresh) {
    let o;
    try { o = fresh ? await uidhForSmd(env, db, b.smdId) : (await db.prepare("SELECT uidh FROM social_ids WHERE smd_id = ?").bind(normalizeSmdId(b.smdId)).first() || {}).uidh; }
    catch (e) { return { res: err("lookup-failed", 503) }; }
    if (!o) return { res: err("not_found", 404) };
    if (o === uidh) return { res: err("self", 400) };
    return { o };
  }
  const friendRow = (o) => { const [x, y] = pair(uidh, o); return db.prepare("SELECT * FROM social_friends WHERE a = ? AND b = ?").bind(x, y).first(); };

  if (route === "GET friends") {
    const { results } = await db.prepare(
      "SELECT f.*, CASE WHEN f.a = ?1 THEN f.b ELSE f.a END AS o, p.name, s.smd_id FROM social_friends f " +
      "JOIN arena_players p ON p.uidh = (CASE WHEN f.a = ?1 THEN f.b ELSE f.a END) LEFT JOIN social_ids s ON s.uidh = p.uidh " +
      "WHERE f.a = ?1 OR f.b = ?1 ORDER BY p.name").bind(uidh).all();
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const r of results || []) {
      const who = { smdId: r.smd_id || null, name: r.name };
      if (r.status === "accepted") out.friends.push({ ...who, since: r.accepted_at || r.at });
      else (r.requester === uidh ? out.outgoing : out.incoming).push({ ...who, at: r.at });
    }
    return json(out);
  }

  if (route === "POST friends/add") {
    let mine;
    try { mine = await ensureMySmd(env, db, claims.sub, uidh); } catch (e) { return err("lookup-failed", 503); }
    if (!mine) return err("no_smd_id", 409);
    const { o, res } = await other(true);
    if (res) return res;
    if (!(await db.prepare("SELECT 1 AS x FROM arena_players WHERE uidh = ?").bind(o).first())) return err("not_in_arena", 409);
    const row = await friendRow(o);
    if (row && (row.status === "accepted" || row.requester === uidh)) return err("already", 409);
    const [x, y] = pair(uidh, o);
    if (row) { await db.prepare("UPDATE social_friends SET status = 'accepted', accepted_at = ? WHERE a = ? AND b = ?").bind(now, x, y).run(); return json({ ok: true }); }   // they asked first
    const n = await db.prepare("SELECT COUNT(*) AS c FROM social_friends WHERE a = ? OR b = ?").bind(uidh, uidh).first();
    if (n && n.c >= MAX_FRIENDS) return err("limit", 409);
    await db.prepare("INSERT INTO social_friends (a, b, status, requester, at) VALUES (?, ?, 'pending', ?, ?)").bind(x, y, uidh, now).run();
    return json({ ok: true });
  }

  if (route === "POST friends/accept" || route === "POST friends/decline" || route === "POST friends/remove") {
    const { o, res } = await other(false);
    if (res) return res;
    const row = await friendRow(o), [x, y] = pair(uidh, o);
    const act = route.slice(13);
    // accept/decline: only a request they sent me; remove: any row (a friend, or my own pending request)
    if (!row || (act !== "remove" && (row.status !== "pending" || row.requester === uidh))) return err("not_found", 404);
    if (act === "accept") await db.prepare("UPDATE social_friends SET status = 'accepted', accepted_at = ? WHERE a = ? AND b = ?").bind(now, x, y).run();
    else await db.batch([
      db.prepare("DELETE FROM social_friends WHERE a = ? AND b = ?").bind(x, y),
      db.prepare("DELETE FROM social_challenges WHERE (from_uidh = ? AND to_uidh = ?) OR (from_uidh = ? AND to_uidh = ?)").bind(uidh, o, o, uidh),
    ]);
    return json({ ok: true });
  }

  if (route === "POST challenge") {
    const exam = b.exam == null ? "neet-pg" : String(b.exam);
    if (EXAMS.indexOf(exam) < 0) return err("bad-exam", 400);
    const { o, res } = await other(false);
    if (res) return res;
    const row = await friendRow(o);
    if (!row || row.status !== "accepted") return err("not_friends", 403);
    const n = await db.prepare("SELECT COUNT(*) AS c FROM social_challenges WHERE from_uidh = ? AND expires_at > ?").bind(uidh, now).first();
    if (n && n.c >= MAX_OPEN_CHALLENGES) return err("limit", 429);
    await db.prepare("DELETE FROM social_challenges WHERE expires_at <= ?").bind(now - DAY).run();   // housekeeping
    const room = randomCode(16), expiresAt = now + CHALLENGE_MS;
    await db.prepare("INSERT INTO social_challenges (room, from_uidh, to_uidh, exam, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')").bind(room, uidh, o, exam, now, expiresAt).run();
    const meRow = await db.prepare("SELECT name FROM arena_players WHERE uidh = ?").bind(uidh).first();
    await later(pushTo(env, db, o, "challenge", { friend: first(meRow && meRow.name) }, now));
    return json({ room, expiresAt, exam });
  }

  if (route === "GET challenges") {
    const { results } = await db.prepare(
      "SELECT c.*, p.name, s.smd_id FROM social_challenges c JOIN arena_players p ON p.uidh = (CASE WHEN c.from_uidh = ?1 THEN c.to_uidh ELSE c.from_uidh END) " +
      "LEFT JOIN social_ids s ON s.uidh = p.uidh WHERE (c.from_uidh = ?1 OR c.to_uidh = ?1) AND c.expires_at > ?2 ORDER BY c.created_at DESC").bind(uidh, now).all();
    const out = { incoming: [], outgoing: [] };
    for (const r of results || []) {
      const who = { smdId: r.smd_id || null, name: r.name };
      if (r.from_uidh === uidh) out.outgoing.push({ room: r.room, to: who, exam: r.exam, expiresAt: r.expires_at, status: r.status });
      else if (r.status === "pending") out.incoming.push({ room: r.room, from: who, exam: r.exam, expiresAt: r.expires_at });
    }
    return json(out);
  }

  if (route === "POST challenge/accept" || route === "POST challenge/decline") {
    const room = String(b.room || "");
    if (!ROOM_RE.test(room)) return err("not_found", 404);
    const c = await db.prepare("SELECT * FROM social_challenges WHERE room = ? AND expires_at > ?").bind(room, now).first();
    if (route === "POST challenge/decline") {
      if (!c || (c.to_uidh !== uidh && c.from_uidh !== uidh)) return err("not_found", 404);
      await db.prepare("DELETE FROM social_challenges WHERE room = ?").bind(room).run();
      return json({ ok: true });
    }
    if (!c || c.to_uidh !== uidh || c.status !== "pending") return err("not_found", 404);
    await db.prepare("UPDATE social_challenges SET status = 'accepted' WHERE room = ?").bind(room).run();
    return json({ room, exam: c.exam });
  }

  if (route === "GET college-list") return json({ colleges: COLLEGES });

  const myTag = async () => {
    const t = await db.prepare("SELECT * FROM social_college WHERE uidh = ?").bind(uidh).first();
    return t ? { college: t.college, state: t.state, key: t.college_key, stateKey: t.state_key } : { college: null };
  };
  if (route === "GET college") return json(await myTag());
  if (route === "POST college") {
    const college = cleanText(b.college, 120), state = cleanText(b.state, 40), ck = collegeKey(college), sk = collegeKey(state);
    if (ck.length < 3 || sk.length < 2) return err("bad-request", 400);
    await db.prepare("INSERT INTO social_college (uidh, college_key, college, state_key, state, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uidh) DO UPDATE SET college_key = excluded.college_key, college = excluded.college, state_key = excluded.state_key, state = excluded.state, at = excluded.at")
      .bind(uidh, ck, college, sk, state, now).run();
    return json(await myTag());
  }
  if (route === "DELETE college") { await db.prepare("DELETE FROM social_college WHERE uidh = ?").bind(uidh).run(); return json({ ok: true }); }

  if (route === "GET board") {
    const scope = q("scope"), key = collegeKey(q("key"));
    if ((scope !== "college" && scope !== "state") || !key) return err("bad-request", 400);
    const col = scope === "college" ? "college_key" : "state_key";
    // ponytail: scores every tagged player of the college/state per request; a materialised board if a key grows past a few thousand
    const { results } = await db.prepare(
      "SELECT t.uidh, p.name, p.rating, COALESCE((SELECT SUM(e.score) FROM arena_entries e WHERE e.uidh = t.uidh AND e.submitted_at >= ?), 0) AS score " +
      "FROM social_college t JOIN arena_players p ON p.uidh = t.uidh WHERE t." + col + " = ? ORDER BY score DESC, p.rating DESC").bind(now - BOARD_DAYS * DAY, key).all();
    const all = ranked(results || [], (r) => r.score + ":" + r.rating);
    const mine = all.find((x) => x.r.uidh === uidh);
    const rows = all.slice(0, 50).map(({ rank, r }) => ({ rank, name: r.name, score: Math.round(r.score * 100) / 100, rating: r.rating, ...(r.uidh === uidh ? { me: true } : {}) }));
    return json({ scope, key, rows, me: mine ? { rank: mine.rank, score: Math.round(mine.r.score * 100) / 100 } : null });
  }

  if (route === "POST progress") {
    const done = b.done;
    if (!Number.isInteger(done) || done < 0 || done > 5000) return err("bad-request", 400);
    await db.prepare("INSERT INTO social_progress (uidh, day, done) VALUES (?, ?, ?) ON CONFLICT(uidh, day) DO UPDATE SET done = MAX(done, excluded.done)").bind(uidh, today, done).run();
    return json({ ok: true });
  }

  if (route === "POST nudges") {
    const r = await nudgeRegister(env, db, claims.sub, uidh, b, now);
    return r.ok ? json({ ok: true }) : err(r.error, r.status);
  }

  const myGroupCount = async () => ((await db.prepare("SELECT COUNT(*) AS c FROM social_group_members WHERE uidh = ?").bind(uidh).first()) || {}).c || 0;
  if (route === "POST groups/create") {
    const name = cleanText(b.name, 40), target = b.dailyTarget;
    if (name.length < 2 || !Number.isInteger(target) || target < 1 || target > 1000) return err("bad-request", 400);
    if ((await myGroupCount()) >= MAX_GROUPS) return err("limit", 409);
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const c = randomCode(6);
      const r = await db.prepare("INSERT OR IGNORE INTO social_groups (code, name, owner, daily_target, created_at) VALUES (?, ?, ?, ?, ?)").bind(c, name, uidh, target, now).run();
      if (r && r.meta && r.meta.changes === 1) code = c;
    }
    if (!code) return err("server-error", 500);
    await db.prepare("INSERT INTO social_group_members (code, uidh, joined_at) VALUES (?, ?, ?)").bind(code, uidh, now).run();
    return json({ code });
  }
  if (route === "POST groups/join" || route === "POST groups/leave") {
    const code = String(b.code || "").trim().toUpperCase();
    const g = GROUP_RE.test(code) && (await db.prepare("SELECT code FROM social_groups WHERE code = ?").bind(code).first());
    if (!g) return err("not_found", 404);
    const member = await db.prepare("SELECT 1 AS x FROM social_group_members WHERE code = ? AND uidh = ?").bind(code, uidh).first();
    if (route === "POST groups/leave") {
      if (!member) return err("not_found", 404);
      await db.batch(leaveGroupStmts(db, uidh, code));
      return json({ ok: true });
    }
    if (member) return err("already", 409);
    if ((await myGroupCount()) >= MAX_GROUPS) return err("limit", 409);
    // the count check and the insert are one statement, so two joiners cannot both take the 30th seat
    const r = await db.prepare("INSERT INTO social_group_members (code, uidh, joined_at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM social_group_members WHERE code = ?) < ?").bind(code, uidh, now, code, GROUP_MAX).run();
    if (!(r && r.meta && r.meta.changes === 1)) return err("full", 409);
    return json({ ok: true });
  }
  if (route === "GET groups") {
    const { results } = await db.prepare(
      "SELECT g.code, g.name, g.daily_target, g.owner, op.name AS owner_name, p.name AS m_name, COALESCE(pr.done, 0) AS done FROM social_group_members mine " +
      "JOIN social_groups g ON g.code = mine.code JOIN social_group_members m ON m.code = g.code JOIN arena_players p ON p.uidh = m.uidh " +
      "LEFT JOIN arena_players op ON op.uidh = g.owner LEFT JOIN social_progress pr ON pr.uidh = m.uidh AND pr.day = ? " +
      "WHERE mine.uidh = ? ORDER BY g.created_at, m.joined_at, m.uidh").bind(today, uidh).all();
    const by = new Map();
    for (const r of results || []) {
      if (!by.has(r.code)) by.set(r.code, { code: r.code, name: r.name, dailyTarget: r.daily_target, owner: r.owner_name || null, mine: r.owner === uidh, members: [] });
      by.get(r.code).members.push({ name: r.m_name, todayDone: r.done });
    }
    return json({ groups: [...by.values()] });
  }
  if (route === "GET groups/board") {
    const code = q("code").trim().toUpperCase();
    const member = GROUP_RE.test(code) && (await db.prepare("SELECT 1 AS x FROM social_group_members WHERE code = ? AND uidh = ?").bind(code, uidh).first());
    if (!member) return err("not_found", 404);
    const week = weekStart(now);
    const { results } = await db.prepare(
      "SELECT p.name, COALESCE((SELECT SUM(pr.done) FROM social_progress pr WHERE pr.uidh = m.uidh AND pr.day >= ? AND pr.day <= ?), 0) AS score " +
      "FROM social_group_members m JOIN arena_players p ON p.uidh = m.uidh WHERE m.code = ? ORDER BY score DESC, p.name").bind(week, today, code).all();
    return json({ week, rows: (results || []).map((r) => ({ name: r.name, score: r.score })) });
  }

  return err("not-found", 404);
}

export async function onRequest({ request, env, params, waitUntil }) {
  const path = [].concat((params && params.path) || []).map(String).join("/");
  try { return await handle(request, env, path, Date.now(), typeof waitUntil === "function" ? waitUntil : null); }
  catch (e) { return err("server-error", 500); }
}
