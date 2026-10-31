/* /api/prep/stats - de-identified, opt-in item statistics (owner decision 10, 2026-10-10; plan section 11).
 *
 * POST: opt-in student item statistics. The app sends this only when the student opted in (prep-tests.js,
 *   localStorage smd_prep_stats = "1"; asked once after a Tests 2 result; flag smd_prep_tests2).
 *   Body: { v: 1, exam, type, items: [[itemId, correct 1|0|null, seconds, chosen 0..3 or -1]] }.
 *   No sign-in, no user id, no device id, no attempt id, no timestamp: nothing links a row to a person or to
 *   another submission. The handler reads no identity headers and stores strictly aggregate counters per item.
 *
 * GET: read-only aggregate statistics. Owner/admin gated (ownerOK) or published snapshot (?snapshot=1).
 *   Query params: ?item_id=<id> for a single item, or ?exam=<exam>&limit=<1..500>&offset=<n> for aggregates.
 * Rank (functions/_prep-rank.js): GET ?rank=1&key=&pct= and POST { v: 1, kind: "rank", key, pct }, an anonymous
 *   score histogram per test; same no-identity rule as the item counters.
 * GET ?pct=1&ids=a,b,c (public, up to PCT_MAX_IDS): "how others answered" for the app. Only items with at least
 *   PCT_MIN_N answers are returned, as { n, o: [% per option] }; an item under that is left out, so the app shows
 *   nothing until real answers exist. Counts only, never a row per student.
 *
 * Storage: D1 binding PREP_STATS_DB (falls back to PREP_ARENA_DB), table prep_item_stats, or KV (UPDATES_KV/MAIK_KV).
 *   Columns: item_id, exam, n (exposures/sample size), right (correct), blank (omitted), secs (sum of seconds),
 *   o0..o3 (counts of option choices), updated (IST date). "wrong" is derived as n - right - blank.
 */
import { ownerOK } from "../../_adminauth.js";
import { rankGet, rankPost } from "../../_prep-rank.js";

const ID_RE = /^[A-Za-z0-9_.:-]{2,100}$/;
export const EXAMS = {
  "neet-pg": 1, "ini-cet": 1, fmge: 1, "neet-ss": 1, "ini-ss": 1,
  "usmle-step1": 1, "usmle-step2ck": 1, "plab-1": 1, "mrcp-1": 1,
  "mrcp-2": 1, "mrcs-a": 1, "amc-1": 1, "mccqe-1": 1,
  // PrepNucleus exam tabs, sent by practice answers (prep-tools.js), which know the tab, not a test profile.
  usmle: 1, plab: 1, mrcs: 1, amc: 1, mccqe: 1, mrcp: 1
};
export const MAX_ITEMS = 300;
export const PCT_MIN_N = 30, PCT_MAX_IDS = 60;
const RATE_LIMIT_CAP = 60; // max submissions per IP per 10 minutes

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/* clean(body) -> { exam, rows: [[id, c, s, o]] } or null. Unknown fields dropped; bad rows skipped; duplicates once. */
export function clean(b) {
  if (!b || b.v !== 1 || !EXAMS[b.exam] || !Array.isArray(b.items)) return null;
  const seen = {}, rows = [];
  for (const r of b.items.slice(0, MAX_ITEMS)) {
    if (!Array.isArray(r)) continue;
    const id = String(r[0] || ""), c = r[1] === 1 ? 1 : r[1] === 0 ? 0 : null, s = Math.round(Number(r[2])), o = Number(r[3]);
    if (!ID_RE.test(id) || seen[id] || !(s >= 0 && s <= 3600) || !(Number.isInteger(o) && o >= -1 && o <= 3)) continue;
    if ((c === null) !== (o === -1)) continue; // blank iff no option
    seen[id] = 1; rows.push([id, c, s, o]);
  }
  return { exam: b.exam, rows };
}

async function rateLimited(env, request) {
  const kv = (env && (env.UPDATES_KV || env.MAIK_KV || env.GHIS_KV)) || null;
  if (!kv || !request || !request.headers) return false;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  if (!ip) return false;
  try {
    const k = "prep:stats_rate:" + ip;
    const n = parseInt((await kv.get(k)) || "0", 10);
    if (n >= RATE_LIMIT_CAP) return true;
    await kv.put(k, String(n + 1), { expirationTtl: 600 });
  } catch (e) {}
  return false;
}

const SQL = "INSERT INTO prep_item_stats (item_id, exam, n, right, blank, secs, o0, o1, o2, o3, updated) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) " +
  "ON CONFLICT(item_id) DO UPDATE SET n = n + 1, right = right + ?3, blank = blank + ?4, secs = secs + ?5, o0 = o0 + ?6, o1 = o1 + ?7, o2 = o2 + ?8, o3 = o3 + ?9, updated = ?10";

export async function onRequestPost({ request, env }) {
  if (await rateLimited(env, request)) return json({ error: "rate-limited" }, 429);
  let b = null; try { b = await request.json(); } catch (e) {}
  if (b && b.kind === "rank") return rankPost(b, request, env);
  const x = clean(b);
  if (!x) return json({ error: "bad-request" }, 400);

  const db = env && (env.PREP_STATS_DB || env.PREP_ARENA_DB);
  const kv = env && (env.UPDATES_KV || env.MAIK_KV);
  if ((!db || !db.prepare) && !kv) return json({ accepted: x.rows.length, stored: false }, 202);
  if (!x.rows.length) return json({ accepted: 0, stored: false }, 202);

  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  if (db && db.prepare) {
    const st = db.prepare(SQL);
    try {
      await db.batch(x.rows.map(([id, c, s, o]) => st.bind(id, x.exam, c === 1 ? 1 : 0, c === null ? 1 : 0, s, o === 0 ? 1 : 0, o === 1 ? 1 : 0, o === 2 ? 1 : 0, o === 3 ? 1 : 0, day)));
      return json({ accepted: x.rows.length, stored: true }, 202);
    } catch (e) {
      if (!kv) return json({ accepted: x.rows.length, stored: false, error: "store-failed" }, 503);
    }
  }

  if (kv) {
    try {
      for (const [id, c, s, o] of x.rows) {
        const key = "prep:stats:" + id;
        let rec = null;
        try { rec = JSON.parse(await kv.get(key)); } catch (err) {}
        rec = (rec && typeof rec === "object") ? rec : {
          item_id: id, exam: x.exam, n: 0, right: 0, wrong: 0, blank: 0, secs: 0,
          o0: 0, o1: 0, o2: 0, o3: 0, updated: day
        };
        rec.n = (rec.n || 0) + 1;
        if (c === 1) rec.right = (rec.right || 0) + 1;
        else if (c === 0) rec.wrong = (rec.wrong || 0) + 1;
        else rec.blank = (rec.blank || 0) + 1;
        rec.secs = (rec.secs || 0) + s;
        if (o === 0) rec.o0 = (rec.o0 || 0) + 1;
        else if (o === 1) rec.o1 = (rec.o1 || 0) + 1;
        else if (o === 2) rec.o2 = (rec.o2 || 0) + 1;
        else if (o === 3) rec.o3 = (rec.o3 || 0) + 1;
        rec.updated = day;
        await kv.put(key, JSON.stringify(rec));
      }
      return json({ accepted: x.rows.length, stored: true }, 202);
    } catch (e) {
      return json({ accepted: x.rows.length, stored: false, error: "store-failed" }, 503);
    }
  }

  return json({ accepted: x.rows.length, stored: false }, 202);
}

function formatRow(r) {
  if (!r) return null;
  const n = Number(r.n || 0), right = Number(r.right || 0), blank = Number(r.blank || 0);
  const wrong = r.wrong != null ? Number(r.wrong) : Math.max(0, n - right - blank);
  const secs = Number(r.secs || 0);
  return {
    item_id: String(r.item_id || ""),
    exam: r.exam || null,
    n,
    sample_size: n,
    exposures: n,
    right,
    correct: right,
    wrong,
    blank,
    omitted: blank,
    secs,
    sum_seconds: secs,
    o0: Number(r.o0 || 0),
    o1: Number(r.o1 || 0),
    o2: Number(r.o2 || 0),
    o3: Number(r.o3 || 0),
    options: [Number(r.o0 || 0), Number(r.o1 || 0), Number(r.o2 || 0), Number(r.o3 || 0)],
    p_value: n > 0 ? Math.round((right / n) * 1000) / 1000 : null,
    avg_secs: n > 0 ? Math.round((secs / n) * 10) / 10 : null,
    omission_rate: n > 0 ? Math.round((blank / n) * 1000) / 1000 : null,
    updated: r.updated || null
  };
}

/* pctOf(row) -> { n, o: [4 whole percents] } or null under PCT_MIN_N answered (blanks are not answers). */
export function pctOf(r) {
  if (!r) return null;
  const o = [Number(r.o0 || 0), Number(r.o1 || 0), Number(r.o2 || 0), Number(r.o3 || 0)];
  const n = o[0] + o[1] + o[2] + o[3];
  if (n < PCT_MIN_N) return null;
  return { n, o: o.map((x) => Math.round((x / n) * 100)) };
}
export function pctIds(q) {
  const seen = {}, out = [];
  for (const id of String(q || "").split(",")) { if (ID_RE.test(id) && !seen[id] && out.length < PCT_MAX_IDS) { seen[id] = 1; out.push(id); } }
  return out;
}
async function pctGet(url, env) {
  const ids = pctIds(url.searchParams.get("ids"));
  const out = {};
  const pub = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" } });
  if (!ids.length) return pub({ min: PCT_MIN_N, items: out });
  const db = env && (env.PREP_STATS_DB || env.PREP_ARENA_DB);
  const kv = env && (env.UPDATES_KV || env.MAIK_KV);
  try {
    if (db && db.prepare) {
      const qs = ids.map((_, i) => "?" + (i + 1)).join(",");
      const res = await db.prepare("SELECT item_id, o0, o1, o2, o3 FROM prep_item_stats WHERE item_id IN (" + qs + ")").bind(...ids).all();
      for (const r of (res && res.results) || []) { const p = pctOf(r); if (p) out[r.item_id] = p; }
    } else if (kv) {
      for (const id of ids) { let r = null; try { r = JSON.parse(await kv.get("prep:stats:" + id)); } catch (e) {} const p = pctOf(r); if (p) out[id] = p; }
    }
  } catch (e) { return json({ error: "store-error" }, 503); }
  return pub({ min: PCT_MIN_N, items: out });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get("pct") === "1") return pctGet(url, env);
  if (url.searchParams.get("rank") === "1") return rankGet(request, env);
  const isSnapshot = url.searchParams.get("snapshot") === "1";
  const isOwner = await ownerOK(request, env);
  if (!isSnapshot && !isOwner) return json({ error: "forbidden" }, 403);

  const db = env && (env.PREP_STATS_DB || env.PREP_ARENA_DB);
  const kv = env && (env.UPDATES_KV || env.MAIK_KV);
  const itemId = url.searchParams.get("item_id");

  if (itemId) {
    if (db && db.prepare) {
      try {
        const row = await db.prepare("SELECT item_id, exam, n, right, blank, secs, o0, o1, o2, o3, updated FROM prep_item_stats WHERE item_id = ?1").bind(itemId).first();
        if (!row) return json({ error: "not-found" }, 404);
        return json(formatRow(row));
      } catch (e) {
        return json({ error: "db-error" }, 500);
      }
    }
    if (kv) {
      try {
        const raw = await kv.get("prep:stats:" + itemId);
        if (!raw) return json({ error: "not-found" }, 404);
        return json(formatRow(JSON.parse(raw)));
      } catch (e) {
        return json({ error: "kv-error" }, 500);
      }
    }
    return json({ error: "not-configured" }, 503);
  }

  const exam = url.searchParams.get("exam");
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  if (db && db.prepare) {
    try {
      let query = "SELECT item_id, exam, n, right, blank, secs, o0, o1, o2, o3, updated FROM prep_item_stats";
      const params = [];
      if (exam) { query += " WHERE exam = ?1 ORDER BY n DESC LIMIT ?2 OFFSET ?3"; params.push(exam, limit, offset); }
      else { query += " ORDER BY n DESC LIMIT ?1 OFFSET ?2"; params.push(limit, offset); }
      const res = await db.prepare(query).bind(...params).all();
      const items = ((res && res.results) || []).map(formatRow);
      return json({ items, count: items.length, limit, offset, exam: exam || null });
    } catch (e) {
      return json({ error: "db-error" }, 500);
    }
  }

  if (kv) {
    // If published snapshot is requested or KV list
    if (isSnapshot) {
      const snap = await kv.get("prep:stats:monthly_snapshot");
      if (snap) {
        try { return json(JSON.parse(snap)); } catch (e) {}
      }
    }
    return json({ items: [], count: 0, limit, offset, exam: exam || null });
  }

  return json({ error: "not-configured" }, 503);
}
