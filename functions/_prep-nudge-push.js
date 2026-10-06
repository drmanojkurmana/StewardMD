/* PrepNucleus social nudges: real-time pushes from real rows. Plan: vault/plans/PrepNucleus-Nudges.md (social).
 *
 * Who gets them: an Arena player who chose Smart nudges on a phone that already allowed StewardMD push notifications.
 * prep-nudges.js posts that phone's push token (POST /api/prep/social/nudges); the token is accepted only when the
 * native token store (functions/_nativepush.js, PUSH_KV) already holds it for the same signed-in account. D1 keeps
 * its token id (a hash), never the uid: social_push (migration prep-arena-worker/migrations/0003_nudges.sql).
 *
 * What: a friend challenged you (functions/api/prep/social), a friend passed you on your college board (an Arena entry
 * submitted, functions/api/prep/arena), and the evening "N friends studied today" (POST /api/prep/social/digest, called
 * by the prep-arena Worker's cron). Each is true at send time, from the rows it names.
 *
 * Limits, per player: at most 2 a day (their local day), never in their quiet hours, and 4 h apart except a challenge
 * (it expires in 10 minutes). The phone's own nudges (prep-nudges.js) keep their own cap of 2: the phone cannot see these.
 */
import { nativeTokensById, sendNativeToTokens, tokenId } from "./_nativepush.js";
import { pushKv } from "./_webpush.js";
import { istDay } from "./_prep-social.js";

const H4 = 4 * 3600e3, DAY = 86400e3, MAX_TOKENS = 3, CAP = 2;
const QUIET_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

/* The copy. {friend} is the Arena display name the friend chose; no em-dash, no shame, no fake urgency, no emoji (owner 2026-09-24). */
export const TEMPLATES = {
  challenge: [["{friend} challenged you", "A 1v1 battle. The room stays open for 10 minutes."]],
  passed: [["{friend} passed you on your college board", "Daily sprint is at {time} if you want your spot back."]],
  digest1: [["{friend} studied today", "Join in? Even 10 questions count."]],
  digestN: [["{n} friends studied today", "{names} put in work today. Join in?"]],
};
const ROUTES = { challenge: { social: "friends" }, passed: { social: "boards" }, digest1: { social: "friends" }, digestN: { social: "friends" } };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => String(v[k] == null ? "" : v[k]));
export const first = (name) => String(name || "").trim().split(/\s+/).filter((w) => !/^(dr|dr\.|prof|prof\.)$/i.test(w))[0] || "A friend";
// "Bilal", "Bilal and Chitra", "Bilal, Chitra and 3 more"
export function names(list) {
  const n = list.map(first);
  return n.length <= 2 ? n.join(" and ") : n.slice(0, 2).join(", ") + " and " + (n.length - 2) + " more";
}

/* ---------- time on the player's clock: tz = Date.getTimezoneOffset() (IST -330) ---------- */
export const localMin = (now, tz) => { const d = new Date(now - tz * 60e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const localDay = (now, tz) => new Date(now - tz * 60e3).toISOString().slice(0, 10);
export const clock = (m) => { const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ":" + String(mm).padStart(2, "0") : "") + (h < 12 ? " am" : " pm"); };
const mins = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
export function inQuiet(m, quiet) {
  if (!QUIET_RE.test(String(quiet || ""))) return false;
  const a = mins(quiet.slice(0, 5)), b = mins(quiet.slice(6));
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}
/* Whether a push of this kind may go to this social_push row now. */
export function allowed(row, now, kind) {
  if (!row) return false;
  const tz = Number.isInteger(row.tz) ? row.tz : -330;
  if (inQuiet(localMin(now, tz), row.quiet)) return false;
  const n = row.day === localDay(now, tz) ? row.n || 0 : 0;
  if (n >= CAP) return false;
  return kind === "challenge" || !row.last_at || now - row.last_at >= H4;
}

/* POST nudges { on, token, quiet, tz }. on false forgets the player. -> { ok } or { error, status }. */
export async function register(env, db, uid, uidh, b, now) {
  if (!b || b.on !== true) { await db.prepare("DELETE FROM social_push WHERE uidh = ?").bind(uidh).run(); return { ok: true }; }
  const token = typeof b.token === "string" && b.token.length >= 8 && b.token.length <= 4096 ? b.token : null;
  const quiet = QUIET_RE.test(String(b.quiet || "")) ? b.quiet : "22:30-07:30";
  const tz = Number.isInteger(b.tz) && b.tz >= -840 && b.tz <= 840 ? b.tz : -330;
  if (!token) return { error: "bad-request", status: 400 };
  const store = pushKv(env);
  if (!store) return { error: "not-configured", status: 503 };
  const id = await tokenId(token);
  let rec = null; try { rec = await store.get("push:native:" + id, "json"); } catch (e) { rec = null; }
  // Only a token this account registered for push (native-push.js register-native, verified sign-in).
  if (!rec || rec.uid !== uid) return { error: "push-not-enabled", status: 409 };
  const row = await db.prepare("SELECT toks FROM social_push WHERE uidh = ?").bind(uidh).first();
  let toks = []; try { toks = JSON.parse((row && row.toks) || "[]"); } catch (e) { toks = []; }
  toks = [id].concat(toks.filter((t) => t !== id)).slice(0, MAX_TOKENS);
  await db.prepare("INSERT INTO social_push (uidh, toks, quiet, tz, day, n, last_at, at) VALUES (?, ?, ?, ?, NULL, 0, NULL, ?) ON CONFLICT(uidh) DO UPDATE SET toks = excluded.toks, quiet = excluded.quiet, tz = excluded.tz, at = excluded.at")
    .bind(uidh, JSON.stringify(toks), quiet, tz, now).run();
  return { ok: true };
}

/* One push of kind to one player, inside their limits. -> true when a phone accepted it. */
export async function pushTo(env, db, uidh, kind, vars, now) {
  const row = await db.prepare("SELECT * FROM social_push WHERE uidh = ?").bind(uidh).first();
  if (!allowed(row, now, kind)) return false;
  let ids = []; try { ids = JSON.parse(row.toks || "[]"); } catch (e) { ids = []; }
  const toks = await nativeTokensById(env, ids);
  if (!toks.length) return false;
  const t = TEMPLATES[kind][0], tz = Number.isInteger(row.tz) ? row.tz : -330;
  vars = { time: clock((870 - tz + 1440 * 2) % 1440), ...vars };   // the daily sprint, 20:00 IST (14:30 UTC), on their clock
  const r = await sendNativeToTokens(env, toks, { title: fill(t[0], vars), body: fill(t[1], vars), url: "/", tag: "prep", data: { type: "prep", prep: JSON.stringify(ROUTES[kind]) } });
  if (!r || !r.sent) return false;
  const day = localDay(now, tz);
  await db.prepare("UPDATE social_push SET day = ?, n = CASE WHEN day = ? THEN n + 1 ELSE 1 END, last_at = ? WHERE uidh = ?").bind(day, day, now, uidh).run();
  return true;
}
// Never lets a push failure reach the request that caused it.
export async function safely(p) { try { return await p; } catch (e) { return false; } }

/* After uidh's Arena entry scored `gained`: friends on the same college board whose 30-day score sat strictly between
 * uidh's old and new score were passed. -> number pushed. */
export async function passed(env, db, uidh, gained, now) {
  if (!(gained > 0)) return 0;
  const tag = await db.prepare("SELECT college_key FROM social_college WHERE uidh = ?").bind(uidh).first();
  if (!tag) return 0;
  const since = now - 30 * DAY;
  const me = await db.prepare("SELECT p.name, COALESCE((SELECT SUM(e.score) FROM arena_entries e WHERE e.uidh = p.uidh AND e.submitted_at >= ?1), 0) AS s FROM arena_players p WHERE p.uidh = ?2").bind(since, uidh).first();
  if (!me) return 0;
  const after = me.s, before = after - gained;
  const { results } = await db.prepare(
    "SELECT t.uidh, COALESCE((SELECT SUM(e.score) FROM arena_entries e WHERE e.uidh = t.uidh AND e.submitted_at >= ?1), 0) AS s FROM social_college t " +
    "JOIN social_friends f ON f.status = 'accepted' AND ((f.a = ?2 AND f.b = t.uidh) OR (f.b = ?2 AND f.a = t.uidh)) WHERE t.college_key = ?3").bind(since, uidh, tag.college_key).all();
  let n = 0;
  for (const r of results || []) if (r.s > before && r.s < after && await safely(pushTo(env, db, r.uidh, "passed", { friend: first(me.name) }, now))) n++;
  return n;
}

/* The evening digest: to each registered player with at least one accepted friend who did questions today (IST, as
 * POST progress records them). -> { players, sent }. */
export async function digest(env, db, now) {
  const day = istDay(now);
  const { results } = await db.prepare("SELECT uidh FROM social_push").all();
  let sent = 0;
  for (const p of results || []) {
    const fr = await db.prepare(
      "SELECT a.name FROM social_friends f JOIN social_progress pr ON pr.uidh = (CASE WHEN f.a = ?1 THEN f.b ELSE f.a END) AND pr.day = ?2 AND pr.done > 0 " +
      "JOIN arena_players a ON a.uidh = pr.uidh WHERE (f.a = ?1 OR f.b = ?1) AND f.status = 'accepted' ORDER BY pr.done DESC, a.name").bind(p.uidh, day).all();
    const list = (fr.results || []).map((r) => r.name);
    if (!list.length) continue;
    const ok = list.length === 1 ? await safely(pushTo(env, db, p.uidh, "digest1", { friend: first(list[0]) }, now))
      : await safely(pushTo(env, db, p.uidh, "digestN", { n: list.length, names: names(list) }, now));
    if (ok) sent++;
  }
  return { players: (results || []).length, sent };
}

/* The cron caller's secret, compared in constant time. Both sides must be set. */
export function cronOk(env, header) {
  const a = String((env && env.PREP_CRON_TOKEN) || ""), b = String(header || "");
  if (a.length < 16 || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
