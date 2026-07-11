// Node test for the pure KU ledger logic. Run: node functions/api/ku/ledger.test.mjs
import { WEIGHTS, CAPS, STREAK_KU, TIERS, dayStr, freshDoc, applyEvents, summarize } from "./ledger.js";

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("✗ FAIL:", name); } }
function eq(name, a, b) { ok(name + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", a === b); }

const D1 = "20260711", D2 = "20260712", D3 = "20260714";

// dayStr
eq("dayStr format", dayStr(new Date("2026-07-11T05:00:00Z")), "20260711");

// weight applied once, dedup same-day
let d = freshDoc();
let earned = applyEvents(d, [{ type: "read", refId: "cap" }], D1);
eq("read awards weight+streak", earned, WEIGHTS.read + STREAK_KU);
eq("balance after first read", d.balance, WEIGHTS.read + STREAK_KU);
let earned2 = applyEvents(d, [{ type: "read", refId: "cap" }], D1);
eq("same-day dup read ignored (only 0 more)", earned2, 0);

// different refId pays
applyEvents(d, [{ type: "read", refId: "dka" }], D1);
eq("second distinct read pays", d.byType.read, WEIGHTS.read * 2);

// unknown type ignored
let before = d.balance;
applyEvents(d, [{ type: "bogus", refId: "x" }, { type: "read" }], D1);
eq("unknown type / missing refId ignored", d.balance, before);

// per-type cap clamps
let c = freshDoc();
let events = [];
for (let i = 0; i < 100; i++) events.push({ type: "calc", refId: "c" + i });
applyEvents(c, events, D1);
ok("calc capped at CAPS.calc", c.byType.calc === CAPS.calc);
ok("calc dayTotals == cap", c.dayTotals.calc === CAPS.calc);

// day rollover clears seen + dayTotals, allows re-earn
let r = freshDoc();
applyEvents(r, [{ type: "read", refId: "cap" }], D1);
let balAfterD1 = r.balance;
applyEvents(r, [{ type: "read", refId: "cap" }], D2); // new day → same refId pays again + new streak
ok("rollover re-pays same refId", r.byType.read === WEIGHTS.read * 2);
ok("rollover clears seen", (r.seen.read || []).length === 1);

// streak: once per day, consecutive increments, gap resets
let s = freshDoc();
applyEvents(s, [{ type: "read", refId: "a" }], D1); eq("streak day1", s.streakDays, 1);
applyEvents(s, [{ type: "read", refId: "a" }], D1); eq("streak same day no double", s.streakDays, 1);
applyEvents(s, [{ type: "read", refId: "a" }], D2); eq("streak consecutive day2", s.streakDays, 2);
applyEvents(s, [{ type: "read", refId: "a" }], D3); eq("streak gap resets to 1", s.streakDays, 1);
eq("streak KU counted", s.byType.streak, STREAK_KU * 3);

// summarize tiers + progress
let sm = summarize({ balance: 600, byType: {}, streakDays: 4, day: D1, seen: {}, dayTotals: {}, lastDay: D1 });
eq("summary balance", sm.balance, 600);
eq("summary streak", sm.streak, 4);
ok("tier 500 unlocked", sm.tiers.find(t => t.ku === 500).unlocked === true);
ok("tier 1500 locked", sm.tiers.find(t => t.ku === 1500).unlocked === false);
eq("nextTier is 1500", sm.nextTier.ku, 1500);
// 600 of the way from 500→1500 = (600-500)/(1500-500) = 10%
eq("progressPct 10", sm.progressPct, 10);
let smMax = summarize({ balance: 5000, byType: {}, streakDays: 1, day: D1, seen: {}, dayTotals: {}, lastDay: D1 });
eq("all unlocked → nextTier null", smMax.nextTier, null);
eq("progress 100 when maxed", smMax.progressPct, 100);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
