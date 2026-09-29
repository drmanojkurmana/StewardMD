// Labour room simulator (tokos-models/drill-labour.js): progression bounds against Zhang 2010, every
// action's preconditions and effects, the FIGO-linked FHR state machine, complications, determinism by seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const L = require("../tokos-models/drill-labour.js");
const run = (s, n, mins = 30) => { for (let i = 0; i < n && !s.delivered; i++) s = L.step(s, "observe", mins); return s; };
const until = (s, pred, max = 200) => { for (let i = 0; i < max && !pred(s) && !s.delivered; i++) s = L.step(s, "observe", 5); return s; };
const codes = (s) => s.events.map((e) => e.code);

test("Zhang 2010 Table 2 is transcribed exactly (Obstet Gynecol 2010;116:1281, PMC3660040)", () => {
  assert.deepEqual(L.ZHANG.first[0], { 3: [1.8, 8.1], 4: [1.3, 6.4], 5: [0.8, 3.2], 6: [0.6, 2.2], 7: [0.5, 1.6], 8: [0.5, 1.4], 9: [0.5, 1.8] });
  assert.deepEqual(L.ZHANG.first[1], { 4: [1.4, 7.3], 5: [0.8, 3.4], 6: [0.5, 1.9], 7: [0.4, 1.3], 8: [0.3, 1.0], 9: [0.3, 0.9] });
  assert.deepEqual(L.ZHANG.first[2], { 4: [1.4, 7.0], 5: [0.8, 3.4], 6: [0.5, 1.8], 7: [0.4, 1.2], 8: [0.3, 0.9], 9: [0.3, 0.8] });
  assert.deepEqual(L.ZHANG.second.epidural, { 0: [1.1, 3.6], 1: [0.4, 2.0], 2: [0.3, 1.6] });
  assert.deepEqual(L.ZHANG.second.none, { 0: [0.6, 2.8], 1: [0.2, 1.3], 2: [0.1, 1.1] });
  assert.deepEqual(L.OXY_STEPS, [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30]); // WHO MCPC 2017 schedule, max 30 mIU/min
});

test("drawn traverse times reproduce Zhang's median and 95th percentile (log-normal, uncapped scenario)", () => {
  const need = [];
  for (let seed = 1; seed <= 4000; seed++) need.push(L.init(seed, "compromise").plan.need / 60); // parity 1, 7 to 8 cm
  need.sort((a, b) => a - b);
  const q = (p) => need[Math.floor(p * (need.length - 1))];
  const [med, p95] = L.ZHANG.first[1][7];
  assert.ok(Math.abs(q(0.5) - med) / med < 0.1, "median " + q(0.5));
  assert.ok(Math.abs(q(0.95) - p95) / p95 < 0.12, "p95 " + q(0.95));
});

test("normal scenarios cap draws at the 95th percentile and never cross the delay line", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = L.init(seed, "normal-primi");
    assert.ok(s.plan.need > 0 && s.plan.need <= L.ZHANG.first[0][4][1] * 60);
  }
  for (let seed = 1; seed <= 40; seed++) {
    let s = L.init(seed, seed % 2 ? "normal-primi" : "normal-multi"), prevDil = s.dil, prevT = s.t;
    for (let i = 0; i < 80 && !s.delivered; i++) {
      assert.equal(L.delayed(s), false);
      s = L.step(s, "observe", 15);
      assert.ok(s.dil >= prevDil && s.dil <= 10, "dilatation monotonic and bounded");
      assert.ok(s.station >= -3 && s.station <= 3);
      assert.ok(s.delivered ? s.t <= prevT + 15 : s.t === prevT + 15, "time advances by the step");
      prevDil = s.dil; prevT = s.t;
    }
    assert.equal(s.delivered.mode, "svd");
    assert.equal(L.outcome(s).grade, "good");
    assert.equal(s.station, 3);
  }
});

test("deterministic by seed; different seeds give different labours", () => {
  const play = (seed) => { let s = L.init(seed, "tachysystole"); s = L.step(s, "oxytocin_start", 60); s = L.step(s, "amniotomy", 30); s = L.step(s, "position", 45); return run(s, 20); };
  assert.deepEqual(play(42), play(42));
  assert.notDeepEqual(L.init(1, "normal-primi").plan, L.init(2, "normal-primi").plan);
});

test("step is pure and clamps time", () => {
  const s = L.init(3, "normal-primi"), copy = JSON.stringify(s);
  const n = L.step(s, "observe", 999);
  assert.equal(JSON.stringify(s), copy);
  assert.equal(n.t, 240);
  assert.equal(L.step(s, "observe", -5).t, 0);
});

test("amniotomy: needs intact membranes in the first stage; reveals liquor; routine use is flagged (WHO rec 28)", () => {
  let s = L.init(5, "normal-primi");
  assert.ok(L.actions(s).includes("amniotomy"));
  s = L.step(s, "amniotomy", 0);
  assert.equal(s.membranes, "ruptured"); assert.equal(s.liquor, "clear");
  assert.ok(!L.actions(s).includes("amniotomy"));
  assert.ok(s.flags.includes("amniotomy_routine"));
});

test("oxytocin: start and stop availability; MCPC titration lifts inadequate contractions; unindicated use flagged", () => {
  let s = L.init(5, "slow-primi");
  assert.equal(s.contractions, 2);
  assert.ok(L.actions(s).includes("oxytocin_start") && !L.actions(s).includes("oxytocin_stop"));
  s = L.step(s, "oxytocin_start", 30);
  assert.equal(s.contractions, 3); assert.equal(s.oxytocin.step, 1);
  assert.deepEqual(s.flags, []);
  assert.ok(L.actions(s).includes("oxytocin_stop") && !L.actions(s).includes("oxytocin_start"));
  s = L.step(s, "oxytocin_stop", 0);
  assert.equal(s.oxytocin.on, false);
  const n = L.step(L.init(5, "normal-primi"), "oxytocin_start", 0);
  assert.ok(n.flags.includes("oxytocin_not_indicated"));
});

test("inadequate contractions stall the cervix until augmented, and delay is judged on Zhang's 95th percentile", () => {
  let s = L.init(9, "slow-primi");
  const dil = s.dil;
  s = L.step(s, "observe", 240);
  assert.equal(s.dil, dil);
  assert.equal(L.delayed(s), true); // 5 to 6 cm, nulliparous 95th percentile 3.2 h
  s = L.step(s, "oxytocin_start", 30);
  assert.deepEqual(s.flags, []);
  s = run(s, 40);
  assert.equal(s.delivered.mode, "svd");
});

test("analgesia: epidural switches the second stage to Zhang's epidural row; epidural hypotension gives a prolonged deceleration that fluids reverse", () => {
  let s = L.init(11, "epidural-multi");
  s = L.step(s, "analgesia", 0);
  assert.equal(s.epidural, true); assert.ok(!L.actions(s).includes("analgesia"));
  s = L.step(s, "observe", 25);
  assert.equal(s.maternal.hypotension, true);
  assert.equal(s.fhr.decels, "prolonged");
  assert.equal(s.fhr.figo, "pathological"); // FIGO: one prolonged deceleration over 5 minutes
  s = L.step(s, "fluids", 5);
  assert.equal(s.maternal.hypotension, false); assert.equal(s.fhr.figo, "normal");
  assert.ok(!s.flags.includes("fluids_not_indicated"));
  s = until(s, (x) => x.stage === 2);
  assert.ok(s.second.need <= L.ZHANG.second.epidural[2][1] * 60 + 1);
  assert.ok(L.step(L.init(11, "normal-primi"), "fluids", 0).flags.includes("fluids_not_indicated"));
});

test("position: turning her to her side is available once and also reverses epidural hypotension", () => {
  let s = L.init(11, "epidural-multi");
  s = L.step(L.step(s, "analgesia", 0), "observe", 20);
  assert.equal(s.maternal.hypotension, true);
  s = L.step(s, "position", 0);
  assert.equal(s.posture, "lateral"); assert.equal(s.maternal.hypotension, false);
  assert.ok(!L.actions(s).includes("position"));
});

test("instrumental birth only when MCPC prerequisites are met; refused otherwise without moving the clock", () => {
  let s = L.init(21, "normal-multi");
  assert.ok(!L.actions(s).includes("instrumental"));
  const r = L.step(s, "instrumental", 30);
  assert.equal(r.t, s.t); assert.equal(r.delivered, null); assert.equal(codes(r).pop(), "refused");
  s = until(s, (x) => x.stage === 2 && x.station >= 0);
  assert.ok(L.instrumentalOk(s) && L.actions(s).includes("instrumental"));
  assert.equal(s.membranes, "ruptured");
  s = L.step(s, "instrumental", 0);
  assert.equal(s.delivered.mode, "instrumental");
  assert.deepEqual(L.actions(s), []);
  assert.deepEqual(L.step(s, "observe", 30), s);
});

test("caesarean: always available; flagged without an indication or before augmenting weak contractions", () => {
  assert.ok(L.actions(L.init(1, "normal-primi")).includes("caesarean"));
  const n = L.step(L.init(1, "normal-primi"), "caesarean", 0);
  assert.equal(n.delivered.mode, "caesarean"); assert.ok(n.flags.includes("cs_not_indicated"));
  assert.equal(L.outcome(n).grade, "ok");
  const w = L.step(L.step(L.init(1, "slow-primi"), "observe", 240), "caesarean", 0);
  assert.ok(w.flags.includes("cs_before_augmentation"));
});

test("obstructed labour: arrest despite strong contractions, oxytocin is harmful, caesarean after arrest is correct", () => {
  let s = L.init(4, "obstructed");
  s = run(s, 12);
  assert.equal(s.dil, s.sched.arrestCm); assert.ok(codes(s).includes("arrest") || s.sched.arrestFrom === 0);
  assert.equal(s.station, -2);
  assert.equal(s.fhr.figo, "pathological"); // fetal compromise after 3 h of arrest (MCPC partograph example)
  let o = L.init(4, "obstructed");
  o = until(o, (x) => x.sched.arrestFrom != null);
  o = L.step(o, "oxytocin_start", 60);
  assert.ok(o.flags.includes("oxytocin_obstruction"));
  assert.ok(codes(o).includes("rupture_signs"));
  o = L.step(o, "caesarean", 0);
  assert.equal(L.outcome(o).grade, "poor");
  let c = until(L.init(4, "obstructed"), (x) => L.delayed(x));
  c = L.step(c, "caesarean", 0);
  assert.deepEqual(L.outcome(c).flags, []); assert.equal(L.outcome(c).grade, "good");
});

test("tachysystole on oxytocin: FIGO suspicious then pathological; stopping oxytocin settles it, ignoring it is flagged", () => {
  let s = L.step(L.init(8, "tachysystole"), "oxytocin_start", 0);
  s = until(s, (x) => x.contractions > 5);
  assert.equal(s.fhr.figo, "suspicious"); assert.equal(s.fhr.decels, "late");
  const ignored = L.step(s, "observe", 35);
  assert.equal(ignored.fhr.figo, "pathological");
  assert.ok(ignored.flags.includes("tachysystole_ignored"));
  let fixed = L.step(L.step(s, "oxytocin_stop", 0), "position", 20);
  assert.equal(fixed.contractions, 4); assert.equal(fixed.fhr.figo, "normal");
  fixed = run(fixed, 40);
  assert.ok(!fixed.flags.includes("tachysystole_ignored"));
});

test("fetal compromise: CTG goes suspicious then pathological; leaving it over 30 minutes is flagged; prompt birth is not", () => {
  let s = null, checked = 0;
  for (let seed = 1; seed <= 200 && checked < 5; seed++) {
    const x = until(L.init(seed, "compromise"), (y) => y.fhr.figo !== "normal");
    if (x.delivered) continue; // this seed delivered before the scheduled compromise
    const late = L.step(x, "observe", 35);
    if (late.delivered) continue;
    assert.equal(x.fhr.figo, "suspicious");
    assert.equal(late.fhr.figo, "pathological");
    const ignored = L.step(late, "observe", 30); // 35 pathological minutes unless she delivers first
    assert.ok(ignored.flags.includes("pathological_ignored") || ignored.delivered);
    s = s || x; checked++;
  }
  assert.ok(s, "at least one seed reaches compromise before birth");
  const now = L.step(s, L.actions(s).includes("instrumental") ? "instrumental" : "caesarean", 0);
  assert.deepEqual(L.outcome(now).flags, []);
});

test("FHR classes match the CTG clinic deck categories", () => {
  const deck = JSON.parse(readFileSync(new URL("../tokos/decks/ctg.json", import.meta.url)));
  const cats = new Set(deck.cases.map((c) => c.figo));
  for (const sc of Object.keys(L.SCENARIOS)) {
    let s = L.init(2, sc);
    for (let i = 0; i < 30 && !s.delivered; i++) { assert.ok(cats.has(s.fhr.figo)); s = L.step(s, i === 0 ? "oxytocin_start" : "observe", 20); }
  }
});

test("model contract: id, kind, bilingual text, sources, review, no em-dash, ASCII numerals in Hindi", () => {
  assert.equal(L.id, "labour"); assert.equal(L.kind, "drill"); assert.equal(L.review, "ai_drafted");
  assert.ok(L.sources.length >= 4 && L.sources.every((x) => x.label && x.url.startsWith("https://")));
  const texts = [L.title, ...Object.values(L.TEXT), ...Object.values(L.SCENARIOS).map((x) => x.brief)];
  for (const t of texts) {
    assert.ok(t.en && t.hi);
    assert.doesNotMatch(t.en + t.hi, /[\u2013\u2014]/);
    assert.doesNotMatch(t.hi, /[\u0966-\u096F]/);
  }
  for (const sc of Object.keys(L.SCENARIOS)) assert.ok(L.SCENARIOS[sc].level === "mbbs" || L.SCENARIOS[sc].level === "resident");
});
