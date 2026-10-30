/* /api/prep/rank - rank and percentile for a PrepNucleus test, among PrepNucleus students (owner 2026-10-30).
 *
 * The store is a histogram: per test key, how many attempts scored each 0.1% bin. No sign-in, no user, device or
 * attempt id, no timestamp: a bin count cannot be traced to a person.
 *   POST { v: 1, key, pct }  adds one attempt (only sent when the student opted in to anonymous statistics),
 *                            then answers like GET.
 *   GET  ?key=&pct=          reads only: { n, above, same, below, rank, percentile, min }. rank and percentile are
 *                            null until n >= MIN_N, so the app says "after N students" instead of a thin number.
 * key = "<profile>:<test type>[:<paper id>]" (prep-tests.js rankKey). pct = marks / max x 100, -100..100.
 * Storage: D1 PREP_STATS_DB (falls back to PREP_ARENA_DB), table prep_score_hist (migrations/0006_prep_rank.sql).
 */
const KEY_RE = /^[a-z0-9-]{2,40}:[a-z0-9_-]{2,40}(:[A-Za-z0-9_.-]{1,60})?$/;
export const MIN_N = 20;
const RATE_CAP = 30; // submissions per IP per 10 minutes

const json = (o, s = 200, cache) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": cache || "no-store" } });

export function binOf(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p) || p < -100 || p > 100) return null;
  return Math.round(p * 10);
}
export function validKey(k) { return typeof k === "string" && KEY_RE.test(k); }

/* standing(rows, bin) -> the caller's place in the histogram rows [{ bin, n }]. Rank counts only higher scores (ties
   share a rank); percentile = share of attempts below plus half the ties, as a whole number. */
export function standing(rows, bin) {
  let n = 0, above = 0, same = 0;
  for (const r of rows || []) {
    const c = Number(r.n) || 0, b = Number(r.bin);
    n += c; if (b > bin) above += c; else if (b === bin) same += c;
  }
  const below = n - above - same, ok = n >= MIN_N;
  return { n, above, same, below, min: MIN_N, rank: ok ? above + 1 : null, percentile: ok ? Math.round(((below + same / 2) / n) * 100) : null };
}

function dbOf(env) { const d = env && (env.PREP_STATS_DB || env.PREP_ARENA_DB); return d && d.prepare ? d : null; }
async function rows(db, k) {
  const r = await db.prepare("SELECT bin, n FROM prep_score_hist WHERE k = ?1").bind(k).all();
  return (r && r.results) || [];
}
async function limited(env, request) {
  const kv = env && (env.UPDATES_KV || env.MAIK_KV || env.GHIS_KV);
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!kv || !ip) return false;
  try {
    const k = "prep:rank_rate:" + ip, n = parseInt((await kv.get(k)) || "0", 10);
    if (n >= RATE_CAP) return true;
    await kv.put(k, String(n + 1), { expirationTtl: 600 });
  } catch (e) {}
  return false;
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), k = u.searchParams.get("key"), bin = binOf(u.searchParams.get("pct"));
  if (!validKey(k) || bin === null) return json({ error: "bad-request" }, 400);
  const db = dbOf(env); if (!db) return json({ error: "not-configured" }, 503);
  try { return json(standing(await rows(db, k), bin), 200, "public, max-age=300"); } catch (e) { return json({ error: "db-error" }, 503); }
}

export async function onRequestPost({ request, env }) {
  let b = null; try { b = await request.json(); } catch (e) {}
  const bin = b ? binOf(b.pct) : null;
  if (!b || b.v !== 1 || !validKey(b.key) || bin === null) return json({ error: "bad-request" }, 400);
  if (await limited(env, request)) return json({ error: "rate-limited" }, 429);
  const db = dbOf(env); if (!db) return json({ error: "not-configured" }, 503);
  try {
    await db.prepare("INSERT INTO prep_score_hist (k, bin, n) VALUES (?1, ?2, 1) ON CONFLICT(k, bin) DO UPDATE SET n = n + 1").bind(b.key, bin).run();
    return json(standing(await rows(db, b.key), bin));
  } catch (e) { return json({ error: "db-error" }, 503); }
}
