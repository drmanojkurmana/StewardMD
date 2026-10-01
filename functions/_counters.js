/* functions/_counters.js - atomic daily counters in D1 for the hot global AI rollups (T53).
 *
 * aiu:global:<day> and maik:global:<day> were KV read-modify-writes on EVERY AI request, the first
 * with a docs map that grows all day: concurrent requests overwrote each other's increments. D1's
 * per-row UPSERT (n = n + ?) is atomic, so these live in one table, one row per (day, counter):
 *   ai_counters(day, k, n)   k like "aiu.req", "aiu.mod.maik", "aiu.doc.em:x@y", "maik.cost"
 *
 * The table is created on first use (CREATE TABLE IF NOT EXISTS, once per isolate), together with
 * ai_cost_daily, the breaker mirror _usage.js already writes, so no manual migration is needed.
 * FAIL-SAFE: no UPDATES_DB binding or any D1 error -> bump() returns false and the caller keeps its
 * old KV write; readDay() returns null and the reports use KV alone. Reports SUM KV + D1, so the
 * deploy day (KV before, D1 after) still totals correctly.
 */
const _ready = new WeakMap();
function counterDb(env) { try { return (env && env.UPDATES_DB) || null; } catch (e) { return null; } }
function ensure(db) {
  let p = _ready.get(db);
  if (!p) {
    p = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS ai_counters (day TEXT NOT NULL, k TEXT NOT NULL, n REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, k))"),
      db.prepare("CREATE TABLE IF NOT EXISTS ai_cost_daily (day TEXT PRIMARY KEY, cost_paise INTEGER NOT NULL DEFAULT 0)"),
    ]).catch((e) => { _ready.delete(db); throw e; });
    _ready.set(db, p);
  }
  return p;
}

/* incs: { counterKey: delta }. true when D1 recorded it, false when the caller must fall back. */
export async function bump(env, day, incs) {
  const db = counterDb(env);
  if (!db || !day || !incs) return false;
  const ks = Object.keys(incs).filter((k) => Number(incs[k]));
  if (!ks.length) return true;
  try {
    await ensure(db);
    await db.batch(ks.map((k) => db.prepare("INSERT INTO ai_counters (day, k, n) VALUES (?, ?, ?) ON CONFLICT(day, k) DO UPDATE SET n = n + excluded.n").bind(day, String(k).slice(0, 200), Number(incs[k]))));
    return true;
  } catch (e) { return false; }
}

/* { counterKey: n } for keys under `prefix` on `day`, or null when D1 is unavailable. */
export async function readDay(env, day, prefix) {
  const db = counterDb(env);
  if (!db) return null;
  try {
    await ensure(db);
    const r = await db.prepare("SELECT k, n FROM ai_counters WHERE day = ? AND k LIKE ?").bind(day, prefix + "%").all();
    const out = {};
    ((r && r.results) || []).forEach((row) => { out[row.k] = Number(row.n) || 0; });
    return out;
  } catch (e) { return null; }
}

/* Flat D1 counters -> the KV rollup object shape, then summed into `base` (the KV value, if any).
 * groups maps the key segment after the prefix to the nested map, e.g. { mod: "byModule" }. */
export function mergeCounters(base, flat, prefix, groups) {
  const out = JSON.parse(JSON.stringify(base || {}));
  Object.keys(flat || {}).forEach((k) => {
    const rest = k.slice(prefix.length + 1);
    const dot = rest.indexOf(".");
    const g = dot > 0 ? groups[rest.slice(0, dot)] : null;
    if (g) { out[g] = out[g] || {}; const sub = rest.slice(dot + 1); out[g][sub] = (out[g][sub] || 0) + flat[k]; }
    else out[rest] = (out[rest] || 0) + flat[k];
  });
  return out;
}
export const AIU_GROUPS = { mod: "byModule", model: "byModel", doc: "docs" };
export const MAIK_GROUPS = { type: "byType", status: "byStatus" };

/* ---- day keys: the doctor-facing "today" is the IST calendar day -----------------------------------
 * The AI Usage page says the allowance "resets at midnight", which for an Indian clinician is IST, not
 * UTC (UTC midnight is 05:30). Every per-user / per-day AI key (aiu:*, maik:u:*, the wallet's day tally,
 * the D1 rollups below) is written AND read through istDay, so the writer and reader can never disagree.
 * The project-wide admin rollup and cost breaker use the same key, so they roll over at IST midnight too.
 * Months (maik:m:*) stay UTC: a 5h30 shift of a monthly cap is not user-visible. */
const IST_OFFSET_MS = 19800000;
// `now` is epoch ms, or anything Date accepts (callers and tests pass ISO strings); junk falls back to the clock.
function ms(now) { const v = now == null ? Date.now() : (typeof now === "number" ? now : new Date(now).getTime()); return Number.isFinite(v) ? v : Date.now(); }
export function istDay(now) { return new Date(ms(now) + IST_OFFSET_MS).toISOString().slice(0, 10); }
export function istNextMidnightMs(now) { const t = ms(now) + IST_OFFSET_MS; return (Math.floor(t / 86400000) + 1) * 86400000 - IST_OFFSET_MS; }

/* { counterKey: n } for exactly these keys on `day` (no LIKE: ids hold "_" and "%"), or null w/o D1. */
export async function readKeys(env, day, keys) {
  const db = counterDb(env);
  if (!db || !keys || !keys.length) return null;
  try {
    await ensure(db);
    const ks = keys.map((k) => String(k).slice(0, 200));
    const r = await db.prepare("SELECT k, n FROM ai_counters WHERE day = ? AND k IN (" + ks.map(() => "?").join(",") + ")").bind(day, ...ks).all();
    const out = {};
    ((r && r.results) || []).forEach((row) => { out[row.k] = Number(row.n) || 0; });
    return out;
  } catch (e) { return null; }
}

/* Per-user day SPEND (rupees + tokens), written by _ai_usage.addAiSpend. It lives apart from the
 * aiu:doc request counts because both used to read-modify-write ONE KV key and overwrote each other
 * (lost updates). Spend goes to atomic D1 counters when bound, else to its own KV key; readers sum both. */
export function spendKey(key, day) { return "aiu:spend:" + key + ":" + day; }
export async function readSpend(env, store, key, day) {
  let cost = 0, tok = 0;
  try { const s = store && await store.get(spendKey(key, day), "json"); if (s) { cost += +s.cost || 0; tok += +s.tok || 0; } } catch (e) {}
  const d1 = await readKeys(env, day, ["aiud.cost." + key, "aiud.tok." + key]);
  if (d1) { cost += d1["aiud.cost." + key] || 0; tok += d1["aiud.tok." + key] || 0; }
  return { cost: Math.round(cost * 10000) / 10000, tok };
}
