/* PrepNucleus Arena: pure helpers shared by the Pages route (functions/api/prep/arena/[[path]].js) and the battle
 * Worker (prep-arena-worker/). Plan: vault/plans/PrepNucleus-Arena.md.
 *
 * No Workers runtime here: identity (uid hash, display name), the exam marking schemes (same numbers as MOCKS in
 * prep.js), Elo, the IST event schedule, and the seeded draw from the screened bank. The bank loader takes any
 * object with an R2-style get(), so node tests pass a Map.
 */
import { sha256Hex, mulberry32, seedFrom } from "./_prep-core.js";

export const EXAMS = ["neet-pg", "neet-ss", "usmle"];
const NEET_SS_SUBJECTS = ["ss-general-medicine", "ss-cardiology", "ss-neurology", "ss-nephrology", "ss-gastroenterology", "ss-hepatology", "ss-endocrinology", "ss-haematology", "ss-medical-oncology", "ss-rheumatology-immunology", "ss-pulmonology", "ss-infectious-diseases", "ss-critical-care", "ss-biostatistics"];
const USMLE_SUBJECTS = ["anatomy", "physiology", "biochemistry", "pathology", "pharmacology", "microbiology", "medicine", "surgery", "obstetrics-gynaecology", "paediatrics", "psychiatry"];
const PG_ONLY = ["forensic-medicine", "community-medicine", "ophthalmology", "ent", "orthopaedics", "dermatology", "anaesthesia", "radiology"];
// Subjects per exam, from prep/taxonomy.json (`ex` tags). Keep in step with the taxonomy.
export const SUBJECTS = { "neet-pg": USMLE_SUBJECTS.concat(PG_ONLY), "usmle": USMLE_SUBJECTS, "neet-ss": NEET_SS_SUBJECTS };

// Marking schemes: the MOCKS numbers in prep.js. An event uses its exam's first pattern (INI-CET is a pattern of the
// neet-pg exam tab; its scheme is here for parity and tests).
export const SCHEMES = { "neet-pg": { plus: 4, minus: 1 }, "ini-cet": { plus: 1, minus: 1 / 3 }, "neet-ss": { plus: 4, minus: 1 }, "usmle": { plus: 1, minus: 0 } };

/* ---------- identity ---------- */
export function uidHash(uid) { return sha256Hex(String(uid)).slice(0, 24); }
// Firebase `name` claim, control characters out, trimmed to 40; never the email. Escaped by the client on render.
export function displayName(claims, uidh) {
  const n = String((claims && claims.name) || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return n && n.indexOf("@") < 0 ? n : "Doctor " + String(uidh || "").slice(-4);
}

/* ---------- marking ---------- */
/* items: [{id, a}], ans: {itemId: optionIndex}. Unknown ids and non 0..3 values count as blank.
 * Same arithmetic as scoreMock in prep.js: marks rounded to 2 decimals. */
export function markEntry(items, ans, scheme) {
  const r = { right: 0, wrong: 0, blank: 0, score: 0 };
  const a = ans && typeof ans === "object" ? ans : {};
  for (const it of items) {
    const k = Object.prototype.hasOwnProperty.call(a, it.id) ? a[it.id] : -1;
    if (!Number.isInteger(k) || k < 0 || k > 3) r.blank++;
    else if (k === it.a) r.right++;
    else r.wrong++;
  }
  r.score = Math.round((r.right * scheme.plus - r.wrong * scheme.minus) * 100) / 100;
  return r;
}

/* ---------- Elo ---------- */
export const ELO_K = 24;
/* sa = 1 win, 0.5 draw, 0 loss for player A. Returns [newA, newB], integers, zero-sum up to rounding. */
export function elo(ra, rb, sa, k = ELO_K) {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const d = Math.round(k * (sa - ea));
  return [ra + d, rb - d];
}

/* ---------- schedule (IST, UTC+5:30, no DST) ---------- */
const IST = 5.5 * 3600e3, DAY = 86400e3;
export const EVENT_GRACE_MS = 60e3;
const ymdOf = (t) => new Date(t + IST).toISOString().slice(0, 10).replace(/-/g, "");
const istAt = (ymd, h, m) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), h, m) - IST;
export const EVENT_ID_RE = /^(daily|weekly)-(neet-pg|neet-ss|usmle)-(\d{8})$/;

/* The event with this id, or null. Daily 20:00-20:20 IST, 20 Q, 20 min; weekly Sunday 11:00-14:00 IST, 100 Q, 120 min
 * (NEET-SS 50 Q, 60 min). Deterministic: the same id always gives the same row. */
export function eventFromId(id) {
  const m = EVENT_ID_RE.exec(String(id || ""));
  if (!m) return null;
  const [, kind, exam, ymd] = m, start = kind === "daily" ? istAt(ymd, 20, 0) : istAt(ymd, 11, 0);
  if (!Number.isFinite(start) || ymdOf(start) !== ymd) return null;               // 20261332 and friends
  if (kind === "weekly" && new Date(start + IST).getUTCDay() !== 0) return null;   // Sundays only
  const ss = exam === "neet-ss";
  return kind === "daily"
    ? { id, kind, exam, starts_at: start, ends_at: start + 20 * 60e3, n: 20, secs: 1200, seed: "v1:" + id }
    : { id, kind, exam, starts_at: start, ends_at: start + 3 * 3600e3, n: ss ? 50 : 100, secs: ss ? 3600 : 7200, seed: "v1:" + id };
}
/* Per kind: `current` = the latest event that has started (open or closed), `next` = the first not yet started. */
export function scheduleFor(exam, now) {
  const today = ymdOf(now), out = [];
  for (const kind of ["daily", "weekly"]) {
    const step = kind === "daily" ? 1 : 7;
    let d = istAt(today, 12, 0);
    if (kind === "weekly") d -= new Date(d + IST).getUTCDay() * DAY;   // this week's Sunday
    let cur = eventFromId(`${kind}-${exam}-${ymdOf(d)}`);
    if (cur.starts_at > now) { d -= step * DAY; cur = eventFromId(`${kind}-${exam}-${ymdOf(d)}`); }
    out.push({ role: "current", ...cur }, { role: "next", ...eventFromId(`${kind}-${exam}-${ymdOf(d + step * DAY)}`) });
  }
  return out;
}
// The last moment a submit counts: the entry's own clock or the window, whichever ends first, plus 60 s grace.
export function submitDeadline(ev, startedAt) { return Math.min(startedAt + ev.secs * 1000, ev.ends_at) + EVENT_GRACE_MS; }

/* ---------- the screened bank ---------- */
const PREFIX = "prep-bank/v1/";
const _cache = new Map();
/* bank(r2) -> { index(subject), module(subject, file) } over R2 keys prep-bank/v1/...; files are immutable within a
 * version, so they are cached per isolate (bounded). Missing or broken files read as null. */
export function bankFrom(r2) {
  const read = async (key) => {
    if (_cache.has(key)) return _cache.get(key);
    let v = null;
    try { const o = r2 && (await r2.get(PREFIX + key)); v = o ? JSON.parse(await (o.text ? o.text() : new Response(o.body).text())) : null; } catch (e) { v = null; }
    if (v) { if (_cache.size > 400) _cache.clear(); _cache.set(key, v); }   // ponytail: crude bound, LRU if it matters
    return v;
  };
  return { index: (s) => read(`${s}/index.json`), module: (s, file) => (/^mcq\/[a-z0-9-]{2,80}\.json$/.test(file) ? read(`${s}/${file}`) : Promise.resolve(null)) };
}
const usable = (it) => !!it && !(it.flags && it.flags.length) && Array.isArray(it.o) && it.o.length === 4 && Number.isInteger(it.a) && it.a >= 0 && it.a < 4 && typeof it.id === "string";
// prep.js poolFor: flagged items out; for USMLE, vignettes when a module has at least 5.
function poolFor(items, exam) {
  const ok = (items || []).filter(usable);
  if (exam === "usmle") { const v = ok.filter((it) => it.ex && it.ex.indexOf("usmle") >= 0); if (v.length >= 5) return v; }
  return ok;
}
const countFor = (t, exam) => (exam === "usmle" && t.usmle >= 5 ? t.usmle : t.count || 0);
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

/* drawItems(bank, exam, n, seed) -> [{id, q, o, a, s, m}], at most n, deterministic for a seed and bank version.
 * Spread like MOCKS: every subject with questions gets one (subjects in seeded order, so a short draw does not always
 * favour the same subjects), the rest in proportion to question counts; inside a subject, up to half as many modules
 * as slots, items round-robin across them. Flagged (disputed key) items never appear. */
export async function drawItems(bank, exam, n, seed) {
  const rnd = mulberry32(seedFrom(String(seed)));
  const subs = [];
  for (const s of SUBJECTS[exam] || []) {
    const ix = await bank.index(s);
    const mods = ((ix && ix.topics) || []).filter((t) => countFor(t, exam) > 0 && t.file);
    const total = mods.reduce((a, t) => a + countFor(t, exam), 0);
    if (total) subs.push({ s, mods, total });
  }
  shuffle(subs, rnd);
  const all = subs.reduce((a, x) => a + x.total, 0);
  let left = n;
  subs.forEach((x) => { x.k = left > 0 ? 1 : 0; left -= x.k; });
  const spare = left;
  subs.forEach((x) => { const add = Math.min(Math.floor(spare * x.total / all), left); x.k += add; left -= add; });
  for (let i = 0; left > 0 && subs.length; i = (i + 1) % subs.length) { subs[i].k++; left--; }   // rounding leftovers
  const out = [], seen = new Set();
  for (const x of subs) {
    if (!x.k) continue;
    const mods = shuffle(x.mods.slice(), rnd).slice(0, Math.max(1, Math.ceil(x.k / 2)));
    const pools = [];
    for (const t of mods) { const f = await bank.module(x.s, t.file); const p = shuffle(poolFor(f && f.items, exam), rnd); if (p.length) pools.push({ m: t.id, p }); }
    for (let got = 0, j = 0, dry = 0; got < x.k && pools.length && dry < pools.length; j = (j + 1) % pools.length) {
      const pl = pools[j], it = pl.p.shift();
      if (!it) { dry++; continue; }
      dry = 0;
      if (seen.has(it.id)) continue;
      seen.add(it.id); got++;
      out.push({ id: it.id, q: String(it.q || ""), o: it.o.map(String), a: it.a, s: x.s, m: pl.m });
    }
  }
  return out;
}
