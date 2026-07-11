/* StewardMD — Knowledge Units (KU) pure ledger logic.
 *
 * No I/O, no Worker globals — deterministic and unit-tested in node so the
 * earning/dedup/cap/streak rules can be verified without KV or a live provider.
 * The endpoint (./[[path]].js) does identity + KV; this owns the maths.
 *
 * Earning is READING-WEIGHTED (opening clinical content pays most) but overall
 * usage counts. Each refId pays ONCE PER (UTC) DAY per type, and each type has a
 * daily KU cap — so breadth of reading is rewarded and refresh-farming is not.
 */

// Weights + caps are the tunable policy. (Endpoint may override from env later.)
export const WEIGHTS = { read: 5, case: 15, calc: 3, maik: 2 };
export const CAPS = { read: 100, case: 90, calc: 30, maik: 40 }; // KU/day per type
export const STREAK_KU = 10;                                     // once per active day
export const TIERS = [
  { ku: 5000, label: "5% off" },
  { ku: 15000, label: "10% off" },
  { ku: 30000, label: "15% off" }
];

// "YYYYMMDD" in UTC.
export function dayStr(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function dayToMs(s) {
  s = String(s || "");
  if (s.length !== 8) return NaN;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}
function isConsecutive(prevDay, day) {
  const a = dayToMs(prevDay), b = dayToMs(day);
  if (isNaN(a) || isNaN(b)) return false;
  return (b - a) === 86400000;
}

export function freshDoc() {
  return { balance: 0, byType: {}, day: "", seen: {}, dayTotals: {}, streakDays: 0, lastDay: "", updatedAt: 0 };
}

// Apply a batch of {type, refId} events for `day` (UTC "YYYYMMDD"). Mutates doc,
// returns KU earned this call. Rolls the day (clearing per-day dedup/caps) first.
export function applyEvents(doc, events, day) {
  if (doc.day !== day) { doc.day = day; doc.seen = {}; doc.dayTotals = {}; }
  let earned = 0;

  // Daily-active streak: once per day, +STREAK_KU; streakDays increments only when
  // the previous active day was yesterday, else resets to 1.
  if (doc.lastDay !== day) {
    doc.streakDays = isConsecutive(doc.lastDay, day) ? (doc.streakDays + 1) : 1;
    doc.lastDay = day;
    doc.balance += STREAK_KU;
    doc.byType.streak = (doc.byType.streak || 0) + STREAK_KU;
    earned += STREAK_KU;
  }

  (events || []).forEach(function (ev) {
    const type = ev && ev.type, refId = String((ev && ev.refId) || "");
    if (!WEIGHTS[type] || !refId) return;                       // unknown type / missing id
    const seen = (doc.seen[type] = doc.seen[type] || []);
    if (seen.indexOf(refId) >= 0) return;                       // already paid today
    const spent = (doc.dayTotals[type] = doc.dayTotals[type] || 0);
    if (spent >= CAPS[type]) return;                            // daily cap reached
    const w = Math.min(WEIGHTS[type], CAPS[type] - spent);      // clamp final award to cap
    doc.balance += w;
    doc.byType[type] = (doc.byType[type] || 0) + w;
    doc.dayTotals[type] = spent + w;
    seen.push(refId);
    earned += w;
  });

  doc.updatedAt = Date.now();
  return earned;
}

// Public-facing view: balance, breakdown, streak, tier ladder + progress to next.
export function summarize(doc) {
  const balance = (doc && doc.balance) || 0;
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
  return {
    balance: balance,
    byType: (doc && doc.byType) || {},
    streak: (doc && doc.streakDays) || 0,
    tiers: tiers,
    nextTier: nextTier,
    progressPct: progressPct
  };
}
