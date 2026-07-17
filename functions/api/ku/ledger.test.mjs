// Node test for the pure KU ledger + progression logic.
// Run: node functions/api/ku/ledger.test.mjs
import { WEIGHTS, CAPS, FIRST_OPEN_KU, COMBO_KU, WEEKLY, MONTHLY, dayStr, freshDoc, applyEvents, qualifyDay, summarize, streakBonus } from "./ledger.js";
import { levelFor, questForDay, questState, evalBadges, badgeState, progressionSummary } from "./progression.js";

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("✗ FAIL:", name); } }
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", a === b); }

const D1 = "20260711", D2 = "20260712", D3 = "20260714";

// dayStr
eq("dayStr format", dayStr(new Date("2026-07-11T05:00:00Z")), "20260711");

// applyEvents: first activity of the day grants the first-open bonus; content pays its weight.
let d = freshDoc();
let earned = applyEvents(d, [{ type: "read", refId: "cap" }], D1);
eq("first read earns open + weight", earned, FIRST_OPEN_KU + WEIGHTS.read);
eq("balance after first read", d.balance, FIRST_OPEN_KU + WEIGHTS.read);
eq("open bonus recorded", d.byType.open, FIRST_OPEN_KU);
eq("applyEvents does not touch streakDays", d.streakDays, 0);
ok("applyEvents does not add byType.streak", d.byType.streak === undefined);
let earned2 = applyEvents(d, [{ type: "read", refId: "cap" }], D1);
eq("same-day dup read ignored (and open not re-granted)", earned2, 0);
applyEvents(d, [{ type: "read", refId: "dka" }], D1);
eq("second distinct read pays", d.byType.read, WEIGHTS.read * 2);
eq("read action count", d.stats.readActions, 2);

// unknown type / missing refId ignored
let before = d.balance;
applyEvents(d, [{ type: "bogus", refId: "x" }, { type: "read" }], D1);
eq("unknown type / missing refId ignored", d.balance, before);

// per-type cap clamps
let c = freshDoc();
let events = [];
for (let i = 0; i < 100; i++) events.push({ type: "calc", refId: "c" + i });
applyEvents(c, events, D1);
eq("calc capped at CAPS.calc", c.byType.calc, CAPS.calc);
eq("calc dayTotals == cap", c.dayTotals.calc, CAPS.calc);

// day rollover clears seen + dayTotals + re-grants open, re-pays refId
let r = freshDoc();
applyEvents(r, [{ type: "read", refId: "cap" }], D1);
applyEvents(r, [{ type: "read", refId: "cap" }], D2);
eq("rollover re-pays same refId", r.byType.read, WEIGHTS.read * 2);
eq("rollover re-grants open", r.byType.open, FIRST_OPEN_KU * 2);
ok("rollover clears seen", (r.seen.read || []).length === 1);

// learning combo: read + case + calc same day → once-a-day +COMBO_KU
let cb = freshDoc();
applyEvents(cb, [{ type: "read", refId: "r1" }, { type: "case", refId: "c1" }, { type: "calc", refId: "k1" }], D1);
eq("combo granted once", cb.byType.combo, COMBO_KU);
eq("comboCount tracked", cb.stats.comboCount, 1);
applyEvents(cb, [{ type: "read", refId: "r2" }, { type: "case", refId: "c2" }, { type: "calc", refId: "k2" }], D1);
eq("combo not granted twice same day", cb.byType.combo, COMBO_KU);

// ---- qualifyDay: the daily-active streak ----
eq("streakBonus days 1-7", streakBonus(5), 10);
eq("streakBonus days 8-30", streakBonus(20), 15);
eq("streakBonus days 31-100", streakBonus(60), 20);
eq("streakBonus 100+", streakBonus(150), 25);

let s = freshDoc();
let q1 = qualifyDay(s, D1);
eq("qualify day1 streak", s.streakDays, 1);
ok("qualify day1 advanced", q1.advanced === true);
eq("qualify grants streak bonus", s.byType.streak, streakBonus(1));
ok("qualify records day1 in days[]", s.days.length === 1 && s.days[0] === D1);
eq("qualify counts an active day", s.stats.activeDays, 1);
let q1b = qualifyDay(s, D1);
ok("qualify same day is idempotent no-op", q1b.advanced === false && q1b.already === true);
eq("streak unchanged on repeat", s.streakDays, 1);
qualifyDay(s, D2);
eq("qualify consecutive day2", s.streakDays, 2);
eq("longestStreak tracks 2", s.longestStreak, 2);
qualifyDay(s, D3); // D2→D3 is a 2-day gap → reset
eq("qualify gap resets to 1", s.streakDays, 1);
eq("longestStreak stays 2 after reset", s.longestStreak, 2);
ok("days[] holds 3 qualified days", s.days.length === 3);

// weekly bonus: 5 active days in one Mon–Sun week → +WEEKLY.ku, once
let wk = freshDoc();
["20260105", "20260106", "20260107", "20260108", "20260109"].forEach(function (day) { qualifyDay(wk, day); });
eq("weekly bonus at 5 active days", wk.byType.weekly, WEEKLY.ku);
qualifyDay(wk, "20260110"); // same week, 6th day
eq("weekly bonus not repeated same week", wk.byType.weekly, WEEKLY.ku);

// monthly bonus: 20 active days in one month → +MONTHLY.ku, once
let mo = freshDoc();
for (let i = 1; i <= 20; i++) qualifyDay(mo, "202601" + String(i).padStart(2, "0"));
eq("monthly bonus at 20 active days", mo.byType.monthly, MONTHLY.ku);
qualifyDay(mo, "20260121");
eq("monthly bonus not repeated same month", mo.byType.monthly, MONTHLY.ku);

// migration grace: an old doc (no `v`) mid-streak CONTINUES, doesn't reset, on first qualify.
let m = { balance: 120, byType: {}, day: "", seen: {}, dayTotals: {}, streakDays: 2, lastDay: "20260101" };
let qm = qualifyDay(m, D1);
ok("migration advanced", qm.advanced === true);
eq("migration continues streak (2→3)", m.streakDays, 3);
eq("migration sets schema v=2", m.v, 2);
eq("migration seeds longestStreak", m.longestStreak, 3);
ok("migration backfills days to streak length", m.days.length === 3 && m.days[m.days.length - 1] === D1);

// anti clock-manipulation: an implausible day (given server clock + tz) is rejected.
const nowMs = Date.parse("2026-07-11T12:00:00Z");
let g = freshDoc();
let bad = qualifyDay(g, "20260720", { nowMs: nowMs, tzOffsetMin: 0 });
ok("implausible future day rejected", bad.advanced === false && bad.error === "implausible-day");
eq("rejected day does not advance", g.streakDays, 0);
ok("plausible day accepted", qualifyDay(g, "20260711", { nowMs: nowMs, tzOffsetMin: 0 }).advanced === true);

// ---- levels ----
eq("level at 0 KU", levelFor(0).level, 1);
eq("level name at 0", levelFor(0).name, "Intern");
eq("level 20 name", levelFor(1900).name, "Steward");
eq("level 50 name", levelFor(4900).name, "Clinical Luminary");
ok("level >=50 stays luminary", levelFor(9000).name === "Clinical Luminary");

// ---- quests ----
let qd = freshDoc();
applyEvents(qd, [
  { type: "read", refId: "r1" }, { type: "read", refId: "r2" }, { type: "read", refId: "r3" },
  { type: "case", refId: "c1" }, { type: "calc", refId: "k1" }, { type: "calc", refId: "k2" },
  { type: "maik", refId: "m1" }
], D1);
ok("questForDay is deterministic", questForDay(D1).id === questForDay(D1).id);
ok("quest completes when all goals met", questState(qd, D1).done === true);

// ---- badges ----
let bd = freshDoc();
applyEvents(bd, [{ type: "read", refId: "r1" }], D1);
let freshB = evalBadges(bd, 1000);
ok("first-read badge unlocks", bd.badges["reading:1"] === 1000 && freshB.indexOf("reading:1") >= 0);
let bs = badgeState(bd);
let hidden = bs.find(function (b) { return b.id === "special:1" && b.cat === "special"; });
// hidden + locked badges are masked
let anyHiddenMasked = bs.some(function (b) { return b.hidden && !b.unlocked && b.name === "???"; });
ok("hidden locked badges are masked", anyHiddenMasked === true);

// ---- summarize + progressionSummary ----
let sm = summarize({ balance: 6000, byType: {}, streakDays: 4, longestStreak: 9, day: D1, seen: {}, dayTotals: { read: 12, "case": 5 }, lastDay: D1, days: [D1, D2], stats: { lifetimeKU: 6000, readActions: 3, activeDays: 9 }, activity: [] });
eq("summary balance", sm.balance, 6000);
eq("summary streak", sm.streak, 4);
eq("summary longestStreak", sm.longestStreak, 9);
ok("summary today per-source read", sm.today.read.ku === 12 && sm.today.read.cap === CAPS.read);
ok("summary returns days", Array.isArray(sm.days) && sm.days.length === 2);
ok("tier 5000 unlocked", sm.tiers.find(function (t) { return t.ku === 5000; }).unlocked === true);
eq("nextTier is 15000", sm.nextTier.ku, 15000);
eq("progressPct 10", sm.progressPct, 10);

let ps = progressionSummary({ balance: 1900, byType: {}, day: D1, dayCounts: {}, stats: { lifetimeKU: 1900 }, badges: {}, longestStreak: 0 }, D1);
eq("progression level from lifetime KU", ps.level, 20);
eq("progression level name", ps.levelName, "Steward");
ok("progression has quest", !!ps.quest && typeof ps.quest.done === "boolean");
ok("progression badge counts present", ps.badgeCounts && ps.badgeCounts.total > 0);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
