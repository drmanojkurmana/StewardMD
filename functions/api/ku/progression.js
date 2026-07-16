/* StewardMD — KU progression framework (pure): permanent LEVELS, rotating daily QUESTS, and the
 * BADGE achievement system. No I/O and no import of ledger.js — every function reads a ledger doc
 * (or its derived stats) and returns plain data, so it is deterministic and unit-testable. The
 * endpoint composes ledger.summarize() + progressionSummary() into one response; KU grants for
 * quest completion flow back through ledger.grantKU() so the economy stays single-sourced.
 */

// ── Levels ──────────────────────────────────────────────────────────────────────────────────
// A permanent level derived from LIFETIME KU (monotonic — never drops). The band NAME changes at
// the milestones below (from the product spec). Display-only; gates nothing.
export const KU_PER_LEVEL = 100;
const LEVEL_NAMES = [
  { min: 1, name: "Intern" }, { min: 2, name: "Resident" }, { min: 3, name: "Junior Clinician" },
  { min: 5, name: "Clinical Learner" }, { min: 10, name: "Clinical Thinker" }, { min: 20, name: "Evidence Master" },
  { min: 30, name: "Stewardship Expert" }, { min: 40, name: "Consultant" }, { min: 50, name: "Clinical Legend" }
];
export function levelFor(ku) {
  ku = Math.max(0, ku || 0);
  const level = Math.floor(ku / KU_PER_LEVEL) + 1;
  let name = LEVEL_NAMES[0].name;
  for (let i = 0; i < LEVEL_NAMES.length; i++) if (level >= LEVEL_NAMES[i].min) name = LEVEL_NAMES[i].name;
  const floor = (level - 1) * KU_PER_LEVEL, ceil = level * KU_PER_LEVEL;
  return { level: level, name: name, floor: floor, ceil: ceil, into: ku - floor, toNext: ceil - ku, pct: Math.round(((ku - floor) / KU_PER_LEVEL) * 100) };
}
function levelBasis(doc) { return Math.max((doc && doc.stats && doc.stats.lifetimeKU) || 0, (doc && doc.balance) || 0); }

// ── Daily quests ────────────────────────────────────────────────────────────────────────────
export const QUEST_REWARD = 20;
export const QUESTS = [
  { id: "read3", label: "Read 3 clinical topics", goals: [{ type: "read", n: 3 }] },
  { id: "case1", label: "Solve 1 clinical case", goals: [{ type: "case", n: 1 }] },
  { id: "calc2", label: "Use 2 calculators", goals: [{ type: "calc", n: 2 }] },
  { id: "maik1", label: "Ask MaiK a clinical question", goals: [{ type: "maik", n: 1 }] },
  { id: "mix", label: "Read 2 topics and solve a case", goals: [{ type: "read", n: 2 }, { type: "case", n: 1 }] }
];
function hashDay(day) { let h = 0; const s = String(day || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
export function questForDay(day) { return QUESTS[hashDay(day) % QUESTS.length]; }
// Progress is read from the day's per-type action counts (ledger keeps dayCounts fresh per day).
export function questState(doc, day) {
  const q = questForDay(day);
  const dc = (doc && doc.day === day && doc.dayCounts) ? doc.dayCounts : {};
  const goals = q.goals.map(function (g) { const raw = dc[g.type] || 0; return { type: g.type, need: g.n, have: Math.min(raw, g.n), rawHave: raw }; });
  const met = goals.filter(function (g) { return g.rawHave >= g.need; }).length;
  return {
    id: q.id, label: q.label, goals: goals, met: met, total: goals.length,
    done: met === goals.length, reward: QUEST_REWARD,
    completedToday: !!(doc && doc.quest && doc.quest.doneDay === day)
  };
}

// ── Badges ──────────────────────────────────────────────────────────────────────────────────
// Each badge: { id, cat, name, desc, rarity, metric, target, hidden? }. `metric` is resolved by
// badgeValue() against the ledger doc/stats; unlocked when value >= target.
function tier(cat, metric, rows) {
  return rows.map(function (r) { return { id: cat + ":" + r.t, cat: cat, metric: metric, target: r.t, name: r.name, desc: r.desc, rarity: r.rarity, hidden: !!r.hidden }; });
}
export const BADGES = [].concat(
  tier("reading", "read", [
    { t: 1, name: "First Read", desc: "Read your first clinical topic", rarity: "common" },
    { t: 25, name: "Curious Clinician", desc: "Read 25 topics", rarity: "common" },
    { t: 100, name: "Well Read", desc: "Read 100 topics", rarity: "uncommon" },
    { t: 500, name: "Bookworm", desc: "Read 500 topics", rarity: "rare" },
    { t: 1000, name: "Scholar", desc: "Read 1,000 topics", rarity: "epic" },
    { t: 5000, name: "Living Library", desc: "Read 5,000 topics", rarity: "legendary" }
  ]),
  tier("cases", "case", [
    { t: 10, name: "Case Starter", desc: "Work through 10 cases", rarity: "common" },
    { t: 50, name: "Case Solver", desc: "Work through 50 cases", rarity: "uncommon" },
    { t: 250, name: "Diagnostician", desc: "Work through 250 cases", rarity: "rare" },
    { t: 500, name: "Master Diagnostician", desc: "Work through 500 cases", rarity: "epic" },
    { t: 1000, name: "Case Legend", desc: "Work through 1,000 cases", rarity: "legendary" }
  ]),
  tier("calculators", "calc", [
    { t: 25, name: "Number Cruncher", desc: "Use calculators 25 times", rarity: "common" },
    { t: 100, name: "Calculating", desc: "Use calculators 100 times", rarity: "uncommon" },
    { t: 500, name: "Precision Tools", desc: "Use calculators 500 times", rarity: "rare" },
    { t: 2000, name: "Human Calculator", desc: "Use calculators 2,000 times", rarity: "epic" }
  ]),
  tier("maik", "maik", [
    { t: 25, name: "MaiK Curious", desc: "25 MaiK conversations", rarity: "common" },
    { t: 100, name: "MaiK Regular", desc: "100 MaiK conversations", rarity: "uncommon" },
    { t: 500, name: "MaiK Power User", desc: "500 MaiK conversations", rarity: "rare" },
    { t: 2000, name: "MaiK Whisperer", desc: "2,000 MaiK conversations", rarity: "epic" }
  ]),
  tier("streak", "streakMax", [
    { t: 3, name: "Getting Consistent", desc: "3-day learning streak", rarity: "common" },
    { t: 7, name: "One Week Strong", desc: "7-day learning streak", rarity: "common" },
    { t: 14, name: "Fortnight Focus", desc: "14-day learning streak", rarity: "uncommon" },
    { t: 30, name: "Monthly Habit", desc: "30-day learning streak", rarity: "rare" },
    { t: 50, name: "Unbroken", desc: "50-day learning streak", rarity: "rare" },
    { t: 100, name: "Centurion", desc: "100-day learning streak", rarity: "epic" },
    { t: 180, name: "Half-Year Hero", desc: "180-day learning streak", rarity: "legendary" },
    { t: 365, name: "Year of Learning", desc: "365-day learning streak", rarity: "mythic" }
  ]),
  tier("consistency", "active", [
    { t: 5, name: "Reliable", desc: "5 active days", rarity: "common" },
    { t: 30, name: "Dedicated", desc: "30 active days", rarity: "uncommon" },
    { t: 100, name: "Committed", desc: "100 active days", rarity: "rare" },
    { t: 250, name: "Relentless", desc: "250 active days", rarity: "epic" },
    { t: 500, name: "Ever-Present", desc: "500 active days", rarity: "legendary" }
  ]),
  tier("quests", "quests", [
    { t: 1, name: "First Quest", desc: "Complete your first daily quest", rarity: "common" },
    { t: 10, name: "Quest Seeker", desc: "Complete 10 daily quests", rarity: "uncommon" },
    { t: 50, name: "Quest Master", desc: "Complete 50 daily quests", rarity: "epic" }
  ]),
  tier("levels", "level", [
    { t: 5, name: "Clinical Learner", desc: "Reach level 5", rarity: "uncommon" },
    { t: 10, name: "Clinical Thinker", desc: "Reach level 10", rarity: "rare" },
    { t: 20, name: "Evidence Master", desc: "Reach level 20", rarity: "epic" },
    { t: 30, name: "Stewardship Expert", desc: "Reach level 30", rarity: "legendary" },
    { t: 50, name: "Clinical Legend", desc: "Reach level 50", rarity: "mythic" }
  ]),
  tier("combo", "combo", [
    { t: 1, name: "Triple Threat", desc: "Read, solve a case and use a calculator in one day", rarity: "common" },
    { t: 10, name: "Combo Regular", desc: "10 learning-combo days", rarity: "uncommon" },
    { t: 50, name: "Combo Machine", desc: "50 learning-combo days", rarity: "epic" }
  ]),
  tier("special", "flag:onboarded", [{ t: 1, name: "Welcome Aboard", desc: "Complete onboarding", rarity: "common", hidden: true }]),
  tier("special", "flag:doctorsDay", [{ t: 1, name: "Happy Doctors' Day", desc: "Opened StewardMD on National Doctors' Day", rarity: "rare", hidden: true }]),
  tier("special", "distinctCalc", [{ t: 10, name: "Toolbox Explorer", desc: "Try 10 different calculators", rarity: "uncommon", hidden: true }])
);

function badgeValue(doc, metric, basis) {
  const s = (doc && doc.stats) || {};
  switch (metric) {
    case "read": return s.readActions || 0;
    case "case": return s.caseActions || 0;
    case "calc": return s.calcActions || 0;
    case "maik": return s.maikActions || 0;
    case "streakMax": return (doc && doc.longestStreak) || 0;
    case "active": return s.activeDays || 0;
    case "quests": return s.questsDone || 0;
    case "combo": return s.comboCount || 0;
    case "level": return levelFor(basis).level;
    case "distinctCalc": return Object.keys(s.calcUses || {}).length;
    case "flag:doctorsDay": return (doc && doc.flags && doc.flags.doctorsDay) ? 1 : 0;
    case "flag:onboarded": return (doc && doc.flags && doc.flags.onboarded) ? 1 : 0;
    default: return 0;
  }
}

// Unlock any newly-earned badges (mutates doc.badges with the unlock timestamp). Returns the ids
// unlocked THIS call so the endpoint can surface a celebration. Call only on write paths.
export function evalBadges(doc, nowMs) {
  doc.badges = doc.badges || {};
  const basis = levelBasis(doc);
  const fresh = [];
  for (let i = 0; i < BADGES.length; i++) {
    const b = BADGES[i];
    if (!doc.badges[b.id] && badgeValue(doc, b.metric, basis) >= b.target) { doc.badges[b.id] = nowMs || 1; fresh.push(b.id); }
  }
  return fresh;
}

// Read-only badge list with progress. Hidden + still-locked badges are masked to "???".
export function badgeState(doc) {
  const badges = (doc && doc.badges) || {};
  const basis = levelBasis(doc);
  return BADGES.map(function (b) {
    const unlocked = !!badges[b.id];
    if (b.hidden && !unlocked) return { id: b.id, cat: b.cat, rarity: b.rarity, hidden: true, unlocked: false, name: "???", desc: "Hidden achievement", pct: 0, value: 0, target: b.target };
    const val = badgeValue(doc, b.metric, basis);
    const pct = Math.max(0, Math.min(100, Math.round((val / b.target) * 100)));
    return { id: b.id, cat: b.cat, rarity: b.rarity, hidden: !!b.hidden, name: b.name, desc: b.desc, target: b.target, value: val, pct: pct, unlocked: unlocked, unlockedAt: badges[b.id] || 0 };
  });
}
export function badgeById(id) { for (let i = 0; i < BADGES.length; i++) if (BADGES[i].id === id) return BADGES[i]; return null; }

// Everything the client needs on top of the economy summary.
export function progressionSummary(doc, day) {
  const basis = levelBasis(doc);
  const lvl = levelFor(basis);
  const bs = badgeState(doc);
  let unlocked = 0;
  for (let i = 0; i < bs.length; i++) if (bs[i].unlocked) unlocked++;
  return {
    level: lvl.level, levelName: lvl.name, levelPct: lvl.pct, levelInto: lvl.into, levelSpan: KU_PER_LEVEL, levelToNext: lvl.toNext, levelBasis: basis,
    quest: questState(doc, day),
    badges: bs, badgeCounts: { unlocked: unlocked, total: bs.length },
    pinned: (doc && doc.pinned) || []
  };
}
