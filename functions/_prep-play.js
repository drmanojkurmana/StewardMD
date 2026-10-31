/* PrepNucleus play: pure helpers for functions/api/prep/play/[[path]].js (owner 2026-10-30).
 * Seasons, the spot diagnosis board, mnemonic text rules and the focus room window. No I/O here.
 */
const IST = 5.5 * 3600e3, DAY = 86400e3;
export const istDay = (t) => new Date(t + IST).toISOString().slice(0, 10);

/* ---------- seasons ----------
 * 8-week seasons, the first starting Monday 2026-01-05 00:00 IST. Points from Arena battles in the season: a win 3,
 * a draw 1, a loss 0; each submitted daily or weekly event entry 1. Tiers by points; every season starts at zero, so a
 * player is promoted by climbing past a threshold and drops back by not playing the next season. */
export const SEASON_DAYS = 56;
export const SEASON_ZERO = Date.UTC(2026, 0, 5) - IST;
export const TIERS = [["Bronze", 0], ["Silver", 15], ["Gold", 40], ["Platinum", 80], ["Diamond", 140]];
export function seasonOf(t) {
  const n = Math.floor((t - SEASON_ZERO) / (SEASON_DAYS * DAY));
  const start = SEASON_ZERO + n * SEASON_DAYS * DAY;
  return { n: n + 1, start, end: start + SEASON_DAYS * DAY };
}
export function tierOf(points) {
  let t = TIERS[0], next = null;
  for (let i = 0; i < TIERS.length; i++) if (points >= TIERS[i][1]) { t = TIERS[i]; next = TIERS[i + 1] || null; }
  return { tier: t[0], at: t[1], next: next ? { tier: next[0], at: next[1] } : null };
}

/* ---------- spot diagnosis ----------
 * One image a day for everyone; 10 seconds. A result counts once per player per IST day; ms is the time the phone
 * reports (0..10000). Board: right answers only, fastest first. */
export const SPOT_MS = 10000;
export function cleanSpot(b, today) {
  if (!b || b.day !== today) return null;
  const ms = Math.round(Number(b.ms));
  if (!(ms >= 0 && ms <= SPOT_MS)) return null;
  return { ok: b.ok === true ? 1 : 0, ms };
}

/* ---------- mnemonic lab ----------
 * Students' own memory aids under a question. Plain text, 6 to 280 characters, no links or contact details, at most
 * MN_PER_DAY a day per student. Shown as written by a student and not checked; hidden at MN_HIDE_AT reports. */
export const MN_MIN = 6, MN_MAX = 280, MN_PER_DAY = 5, MN_HIDE_AT = 3;
const LINKISH = /(https?:\/\/|www\.|\.(com|in|org|net|io|me|co)\b|@[a-z0-9_]{3,}|\b\d{10}\b|t\.me|wa\.me)/i;
export function cleanMnemonic(s) {
  const t = String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < MN_MIN || t.length > MN_MAX) return { error: "length" };
  if (LINKISH.test(t)) return { error: "no-links" };
  return { text: t };
}
export const ITEM_RE = /^[A-Za-z0-9_.:-]{2,100}$/;

/* ---------- focus room ----------
 * A phone in a focus session sends a heartbeat each minute; "studying now" counts heartbeats from the last FOCUS_WINDOW. */
export const FOCUS_WINDOW = 150e3;
