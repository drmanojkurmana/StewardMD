/* StewardMD — Knowledge Units (KU) pure ledger logic.
 *
 * No I/O, no Worker globals — deterministic and unit-tested in node so the earning / streak /
 * bonus rules can be verified without KV or a live provider. The endpoint (./[[path]].js) does
 * identity + KV; the level/quest/badge FRAMEWORK lives in ./progression.js; this file owns the
 * ECONOMY: what earns KU, the daily caps, the daily-active streak, and the derived stats/rollups
 * every other subsystem reads.
 *
 * Earning is reading-weighted (opening clinical content pays most) but overall usage counts.
 * Each refId pays ONCE PER (UTC) DAY per type, and each type has a daily KU cap — so breadth of
 * reading is rewarded and refresh-farming is not. The daily-active STREAK is separate: a day
 * counts only after 5 min of active use (client posts the LOCAL day → qualifyDay), not by earning.
 */

// ── Earning policy (tunable) ────────────────────────────────────────────────────────────────
export const WEIGHTS = { read: 3, case: 5, calc: 1, maik: 2 };  // KU per distinct refId/day
export const CAPS = { read: 60, case: 40, calc: 10, maik: 10 }; // KU/day per type
export const FIRST_OPEN_KU = 5;                                 // first activity of a new day
export const COMBO_KU = 10;                                     // read + case + calc same day
export const WEEKLY = { activeDays: 5, ku: 50 };                // 5 active days in a week → +50
export const MONTHLY = { activeDays: 20, ku: 250 };             // 20 active days in a month → +250
export const TIERS = [
  { ku: 5000, label: "5% off" },
  { ku: 15000, label: "10% off" },
  { ku: 30000, label: "15% off" }
];

// Daily-active streak bonus scales with how long the streak is (rewards persistence).
export function streakBonus(streakDays) {
  const n = streakDays || 0;
  if (n >= 100) return 25;
  if (n >= 31) return 20;
  if (n >= 8) return 15;
  return 10;                                                    // days 1–7
}

// ── day-key helpers ─────────────────────────────────────────────────────────────────────────
// "YYYYMMDD" in UTC. (Streak days are the client's LOCAL day-key, but the string maths is the same.)
export function dayStr(date) { return date.toISOString().slice(0, 10).replace(/-/g, ""); }
function dayToMs(s) { s = String(s || ""); if (s.length !== 8) return NaN; return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }
function isConsecutive(prevDay, day) { const a = dayToMs(prevDay), b = dayToMs(day); if (isNaN(a) || isNaN(b)) return false; return (b - a) === 86400000; }
function dayAdd(day, n) { const ms = dayToMs(day); if (isNaN(ms)) return ""; return dayStr(new Date(ms + n * 86400000)); }
function monthKey(day) { return String(day || "").slice(0, 6); }              // YYYYMM
function weekKey(day) { const ms = dayToMs(day); if (isNaN(ms)) return ""; const dow = (new Date(ms).getUTCDay() + 6) % 7; return dayStr(new Date(ms - dow * 86400000)); } // Monday
function activeInWeek(days, day) { const k = weekKey(day); return (days || []).filter(function (d) { return weekKey(d) === k; }).length; }
function activeInMonth(days, day) { const k = monthKey(day); return (days || []).filter(function (d) { return monthKey(d) === k; }).length; }

// ── doc shape ───────────────────────────────────────────────────────────────────────────────
export function freshDoc() {
  // v: streak-engine schema version. 2 = day qualifies via 5-min active use (client posts the
  // LOCAL day) rather than via earning a KU. Docs written by the old engine lack `v`, which
  // triggers the one-time migration grace in qualifyDay().
  return {
    balance: 0, byType: {}, updatedAt: 0,
    day: "", seen: {}, dayTotals: {}, dayCounts: {},           // per-(UTC)day dedup / caps / quest counts
    openDay: "", comboDay: "",                                  // once-a-day bonus guards
    streakDays: 0, lastDay: "", longestStreak: 0, days: [], v: 2,
    weekBonusKey: "", monthBonusKey: "",                        // once-a-period bonus guards
    weekKU: { key: "", ku: 0 }, monthKU: { key: "", ku: 0 },   // rolling KU rollups
    stats: { readActions: 0, caseActions: 0, calcActions: 0, maikActions: 0, lifetimeKU: 0, activeDays: 0, comboCount: 0, questsDone: 0, calcUses: {}, specReads: {} },
    activity: [],                                               // per-day rollups (last ~30)
    flags: {},                                                  // one-off unlock flags (doctorsDay, onboarded…)
    badges: {}, quest: { day: "", doneDay: "" }, pinned: []
  };
}

// Append a special event to a day's timeline entry (bonuses, unlocks). Exported so the endpoint
// can record quest/badge/level unlocks that live in progression.js without reaching into internals.
export function noteActivity(doc, day, note) { touchActivity(doc, day).notes.push(note); }

// Record a completed streak day-key: dedup, keep ascending, cap to the last 60.
function pushDay(doc, day) {
  if (!Array.isArray(doc.days)) doc.days = [];
  if (doc.days.indexOf(day) < 0) doc.days.push(day);
  doc.days.sort();
  if (doc.days.length > 60) doc.days = doc.days.slice(doc.days.length - 60);
}
// Today's activity rollup entry (created on demand, list capped to 30 days).
function touchActivity(doc, day) {
  if (!Array.isArray(doc.activity)) doc.activity = [];
  let a = null;
  for (let i = 0; i < doc.activity.length; i++) if (doc.activity[i].day === day) { a = doc.activity[i]; break; }
  if (!a) {
    a = { day: day, byType: {}, ku: 0, notes: [] };
    doc.activity.push(a);
    doc.activity.sort(function (x, y) { return x.day < y.day ? -1 : 1; });
    if (doc.activity.length > 30) doc.activity = doc.activity.slice(doc.activity.length - 30);
  }
  return a;
}
function rollup(doc, field, key, amount) { const r = doc[field]; if (!r || r.key !== key) doc[field] = { key: key, ku: amount }; else r.ku += amount; }

// The single sink for granting KU: keeps balance, byType, lifetime, week/month rollups and the
// day's activity entry in lockstep. src is a KU source key (read/case/calc/maik/streak/open/combo/
// weekly/monthly/quest).
function addKU(doc, src, amount, day) {
  amount = amount || 0; if (!amount) return 0;
  doc.balance = (doc.balance || 0) + amount;
  doc.byType = doc.byType || {}; doc.byType[src] = (doc.byType[src] || 0) + amount;
  doc.stats = doc.stats || {}; doc.stats.lifetimeKU = (doc.stats.lifetimeKU || 0) + amount;
  rollup(doc, "weekKU", weekKey(day), amount);
  rollup(doc, "monthKU", monthKey(day), amount);
  const a = touchActivity(doc, day); a.ku += amount; a.byType[src] = (a.byType[src] || 0) + amount;
  return amount;
}
// Exposed for the endpoint (used by quest completion in progression.js so all KU flows through here).
export function grantKU(doc, src, amount, day) { return addKU(doc, src, amount, day); }

// First activity of a new day → one-time +FIRST_OPEN_KU. Guarded by openDay; safe to call from
// both applyEvents and qualifyDay (whichever the day's first interaction happens to be).
function grantFirstOpen(doc, day) {
  if (doc.openDay === day) return 0;
  doc.openDay = day;
  addKU(doc, "open", FIRST_OPEN_KU, day);
  touchActivity(doc, day).notes.push({ kind: "open", ku: FIRST_OPEN_KU });
  return FIRST_OPEN_KU;
}

// Apply a batch of {type, refId, spec?} events for `day` (UTC "YYYYMMDD"). Mutates doc, returns
// KU earned this call. Rolls the day (clearing per-day dedup/caps/counts) first. Also drives:
// first-open bonus, per-type lifetime action counters, calculator/specialty tallies, and the
// read+case+calc learning combo. The daily-active STREAK is NOT here — see qualifyDay().
export function applyEvents(doc, events, day) {
  if (doc.day !== day) { doc.day = day; doc.seen = {}; doc.dayTotals = {}; doc.dayCounts = {}; }
  doc.stats = doc.stats || { calcUses: {}, specReads: {} };
  doc.stats.calcUses = doc.stats.calcUses || {}; doc.stats.specReads = doc.stats.specReads || {};
  doc.flags = doc.flags || {};
  if (String(day).slice(4, 8) === "0701") doc.flags.doctorsDay = true;  // National Doctors' Day (India)
  let earned = 0;

  earned += grantFirstOpen(doc, day);                           // "first app open each day"

  (events || []).forEach(function (ev) {
    const type = ev && ev.type, refId = String((ev && ev.refId) || "");
    if (type === "open") { return; }                            // handled by grantFirstOpen
    if (type === "flag") { if (refId) doc.flags[refId] = true; return; }  // hidden-badge flags (e.g. onboarded)
    if (!WEIGHTS[type] || !refId) return;                       // unknown type / missing id
    const seen = (doc.seen[type] = doc.seen[type] || []);
    if (seen.indexOf(refId) >= 0) return;                       // already paid today
    const spent = (doc.dayTotals[type] = doc.dayTotals[type] || 0);
    if (spent >= CAPS[type]) { seen.push(refId); return; }      // capped: still record the action
    const w = Math.min(WEIGHTS[type], CAPS[type] - spent);      // clamp final award to cap
    addKU(doc, type, w, day);
    doc.dayTotals[type] = spent + w;
    doc.dayCounts[type] = (doc.dayCounts[type] || 0) + 1;       // quest progress source
    seen.push(refId);
    earned += w;
    // lifetime + specialty/calculator tallies (approx: counts awarded actions, dedup'd per day)
    doc.stats[type + "Actions"] = (doc.stats[type + "Actions"] || 0) + 1;
    if (type === "calc") doc.stats.calcUses[refId] = (doc.stats.calcUses[refId] || 0) + 1;
    if (type === "read" && ev && ev.spec) doc.stats.specReads[ev.spec] = (doc.stats.specReads[ev.spec] || 0) + 1;
  });

  // Learning combo: read + case + calc the same day → once-a-day bonus.
  if (doc.comboDay !== day && (doc.dayCounts.read || 0) > 0 && (doc.dayCounts["case"] || 0) > 0 && (doc.dayCounts.calc || 0) > 0) {
    doc.comboDay = day;
    doc.stats.comboCount = (doc.stats.comboCount || 0) + 1;
    earned += addKU(doc, "combo", COMBO_KU, day);
    touchActivity(doc, day).notes.push({ kind: "combo", ku: COMBO_KU });
  }

  doc.updatedAt = Date.now();
  return earned;
}

// Credit `day` (client's LOCAL "YYYYMMDD") to the learning streak. The client calls this once it
// has accumulated 5 min of active foreground use that calendar day (see streak.js). Streak math
// is on LOCAL day-keys — no UTC/DST drift. Idempotent per day (a repeat call is a no-op), so the
// streak can never double-count. Grants the tiered streak bonus, plus weekly/monthly active-day
// bonuses. opts.nowMs / opts.tzOffsetMin → optional anti-clock-manipulation guard.
export function qualifyDay(doc, day, opts) {
  opts = opts || {};
  if (!/^\d{8}$/.test(String(day || ""))) return { advanced: false, error: "bad-day" };

  if (typeof opts.nowMs === "number") {
    let off = typeof opts.tzOffsetMin === "number" ? opts.tzOffsetMin : 0;
    off = Math.max(-840, Math.min(840, off));                   // plausible tz range (min)
    const expected = dayStr(new Date(opts.nowMs - off * 60000));
    const gap = Math.abs(dayToMs(day) - dayToMs(expected));
    if (isNaN(gap) || gap > 86400000) return { advanced: false, error: "implausible-day" };
  }

  if (doc.lastDay === day) return { advanced: false, already: true };  // already counted today

  grantFirstOpen(doc, day);                                     // opening & qualifying counts as first-open too
  doc.stats = doc.stats || {};
  doc.flags = doc.flags || {};
  if (String(day).slice(4, 8) === "0701") doc.flags.doctorsDay = true;

  if (doc.v !== 2) {
    // One-time migration grace: CONTINUE a pre-existing streak (old KU-earn logic) instead of
    // resetting on the engine boundary, so an active user keeps their current count.
    doc.streakDays = (doc.streakDays || 0) + 1;
    doc.longestStreak = Math.max(doc.longestStreak || 0, doc.streakDays);
    doc.v = 2;
    for (let i = doc.streakDays - 1; i >= 0; i--) pushDay(doc, dayAdd(day, -i));  // backfill calendar
  } else {
    doc.streakDays = isConsecutive(doc.lastDay, day) ? ((doc.streakDays || 0) + 1) : 1;
    doc.longestStreak = Math.max(doc.longestStreak || 0, doc.streakDays);
    pushDay(doc, day);
  }
  doc.lastDay = day;
  doc.stats.activeDays = (doc.stats.activeDays || 0) + 1;

  const sb = streakBonus(doc.streakDays);
  addKU(doc, "streak", sb, day);
  touchActivity(doc, day).notes.push({ kind: "streak", n: doc.streakDays, ku: sb });

  let bonus = 0;
  if (activeInWeek(doc.days, day) >= WEEKLY.activeDays && doc.weekBonusKey !== weekKey(day)) {
    doc.weekBonusKey = weekKey(day); bonus += addKU(doc, "weekly", WEEKLY.ku, day);
    touchActivity(doc, day).notes.push({ kind: "weekly", ku: WEEKLY.ku });
  }
  if (activeInMonth(doc.days, day) >= MONTHLY.activeDays && doc.monthBonusKey !== monthKey(day)) {
    doc.monthBonusKey = monthKey(day); bonus += addKU(doc, "monthly", MONTHLY.ku, day);
    touchActivity(doc, day).notes.push({ kind: "monthly", ku: MONTHLY.ku });
  }
  doc.updatedAt = Date.now();
  return { advanced: true, streakDays: doc.streakDays, longestStreak: doc.longestStreak, earned: sb + bonus };
}

// Public-facing ECONOMY view. progression.js adds level/quest/badge fields on top of this.
export function summarize(doc) {
  doc = doc || {};
  const balance = doc.balance || 0;
  const tiers = TIERS.map(function (t) { return { ku: t.ku, label: t.label, unlocked: balance >= t.ku }; });
  let nextTier = null;
  for (let i = 0; i < TIERS.length; i++) { if (balance < TIERS[i].ku) { nextTier = { ku: TIERS[i].ku, label: TIERS[i].label }; break; } }
  let progressPct;
  if (!nextTier) progressPct = 100;
  else {
    let prevKu = 0;
    for (let i = 0; i < TIERS.length; i++) { if (balance >= TIERS[i].ku) prevKu = TIERS[i].ku; }
    const span = nextTier.ku - prevKu;
    progressPct = span > 0 ? Math.max(0, Math.min(100, Math.round(((balance - prevKu) / span) * 100))) : 0;
  }
  const dt = doc.dayTotals || {};
  const today = {
    read: { ku: dt.read || 0, cap: CAPS.read },
    case: { ku: dt["case"] || 0, cap: CAPS["case"] },
    calc: { ku: dt.calc || 0, cap: CAPS.calc },
    maik: { ku: dt.maik || 0, cap: CAPS.maik },
    total: (doc.activity || []).reduce(function (s, a) { return a.day === doc.day ? a.ku : s; }, 0)
  };
  const stats = doc.stats || {};
  return {
    balance: balance,
    byType: doc.byType || {},
    streak: doc.streakDays || 0,
    longestStreak: doc.longestStreak || doc.streakDays || 0,
    lastDay: doc.lastDay || "",
    days: Array.isArray(doc.days) ? doc.days.slice(-30) : [],
    today: today,
    stats: {
      readActions: stats.readActions || 0, caseActions: stats.caseActions || 0,
      calcActions: stats.calcActions || 0, maikActions: stats.maikActions || 0,
      lifetimeKU: stats.lifetimeKU || 0, activeDays: stats.activeDays || 0,
      weekKU: (doc.weekKU && doc.weekKU.ku) || 0, monthKU: (doc.monthKU && doc.monthKU.ku) || 0,
      topCalc: topKey(stats.calcUses), topSpec: topKey(stats.specReads)
    },
    activity: (doc.activity || []).slice(-14).reverse(),
    tiers: tiers, nextTier: nextTier, progressPct: progressPct
  };
}

function topKey(map) {
  let best = "", n = -1;
  for (const k in (map || {})) if (map[k] > n) { n = map[k]; best = k; }
  return best || "";
}
