/* POST /api/prep/stats - de-identified, opt-in item statistics (owner decision 10, 2026-10-10; Tests 2 M1).
 *
 * The app sends this only when the student said yes once (prep-tests.js, localStorage smd_prep_stats = "1"; asked once
 * after a Tests 2 result; flag smd_prep_tests2). Body: { v: 1, exam, type, items: [[itemId, correct 1|0|null, seconds,
 * chosen 0..3 or -1]] }. No sign-in, no user id, no device id, no attempt id, no time of day: nothing links a row to a
 * person or to another submission. The handler reads nothing else from the request (no IP, no headers) and logs nothing.
 *
 * Use: per-item exposure, share right, time and option counts, ONLY to flag items for the owner's review (plan section
 * 11; minimum n before any statistic is read, e.g. 200). Never to edit, re-key or remove an item automatically.
 *
 * Storage (design; inactive until the owner binds it): D1 binding PREP_STATS_DB, table
 *   prep_item_stats(item_id TEXT PRIMARY KEY, exam TEXT, n INTEGER, right INTEGER, blank INTEGER, secs INTEGER,
 *                   o0 INTEGER, o1 INTEGER, o2 INTEGER, o3 INTEGER, updated TEXT)   -- updated = IST date only
 * Each row is an aggregate counter (UPSERT n = n + 1 ...), so no per-response record exists at all. Without the binding
 * the endpoint validates and answers 202 { accepted, stored: false }, so the client path can ship first. */
const ID_RE = /^[A-Za-z0-9_.:-]{2,100}$/;
const EXAMS = { "neet-pg": 1, "ini-cet": 1, fmge: 1, "neet-ss": 1, "ini-ss": 1, "usmle-step1": 1 };
const MAX_ITEMS = 300;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/* clean(body) -> { exam, rows: [[id, c, s, o]] } or null. Unknown fields dropped; bad rows skipped; duplicates once. */
export function clean(b) {
  if (!b || b.v !== 1 || !EXAMS[b.exam] || !Array.isArray(b.items)) return null;
  const seen = {}, rows = [];
  for (const r of b.items.slice(0, MAX_ITEMS)) {
    if (!Array.isArray(r)) continue;
    const id = String(r[0] || ""), c = r[1] === 1 ? 1 : r[1] === 0 ? 0 : null, s = Math.round(Number(r[2])), o = Number(r[3]);
    if (!ID_RE.test(id) || seen[id] || !(s >= 0 && s <= 3600) || !(Number.isInteger(o) && o >= -1 && o <= 3)) continue;
    if ((c === null) !== (o === -1)) continue;   // blank iff no option
    seen[id] = 1; rows.push([id, c, s, o]);
  }
  return { exam: b.exam, rows };
}
const SQL = "INSERT INTO prep_item_stats (item_id, exam, n, right, blank, secs, o0, o1, o2, o3, updated) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) " +
  "ON CONFLICT(item_id) DO UPDATE SET n = n + 1, right = right + ?3, blank = blank + ?4, secs = secs + ?5, o0 = o0 + ?6, o1 = o1 + ?7, o2 = o2 + ?8, o3 = o3 + ?9, updated = ?10";

export async function onRequestPost({ request, env }) {
  let b = null; try { b = await request.json(); } catch (e) {}
  const x = clean(b);
  if (!x) return json({ error: "bad-request" }, 400);
  const db = env && env.PREP_STATS_DB;
  if (!db || !db.prepare || !x.rows.length) return json({ accepted: x.rows.length, stored: false }, 202);
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const st = db.prepare(SQL);
  try {
    await db.batch(x.rows.map(([id, c, s, o]) => st.bind(id, x.exam, c === 1 ? 1 : 0, c === null ? 1 : 0, s, o === 0 ? 1 : 0, o === 1 ? 1 : 0, o === 2 ? 1 : 0, o === 3 ? 1 : 0, day)));
  } catch (e) { return json({ accepted: x.rows.length, stored: false, error: "store-failed" }, 503); }
  return json({ accepted: x.rows.length, stored: true }, 202);
}
