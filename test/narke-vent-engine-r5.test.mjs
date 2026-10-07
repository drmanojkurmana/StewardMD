// Narkē Ventilator Lab engine, round-5 persona fixes (E1 to E9 in the round-5 fix brief, from the Pinki, Kavya and
// Sameer round-4 runs). Each test reproduces a finding, then checks the fix.
// NARKE_VENT_ENGINE=<path> runs the same tests against another engine build (used to show the bugs on the old one).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const E = require(process.env.NARKE_VENT_ENGINE ? path.resolve(process.env.NARKE_VENT_ENGINE) : "../narke-models/vent-engine.js");
const S = JSON.parse(readFileSync("narke/vent/scenarios.json", "utf8"));
const byId = (id) => JSON.parse(JSON.stringify(S.scenarios.find((s) => s.id === id)));
const quiet = (id) => Object.assign(byId(id), { timeline: [] });
const bi = (o) => !!(o && typeof o.en === "string" && o.en.length > 3 && typeof o.hi === "string" && /[ऀ-ॿ]/.test(o.hi));
const short = (o) => o.en.split(/(?<=[.!?:;])\s+/).every((x) => x.split(/\s+/).length <= 22);
const noDash = (o) => !/[–—]/.test(o.en + o.hi);
const set = (s, o) => Object.assign({}, s.settings, o);

/* ---------- E1: the alarm card leads with the alarm's own problem ---------- */
// Pinki al1: atelectasis, VT 500 -> 300 (Confirm anyway), 30 min: the low SpO2 card led with "Raise the rate to 29".
function pinkiLowSpo2() {
  let s = E.init(quiet("postop-atelectasis")); const st = set(s, { vt: 300 });
  s = E.step(s, st, 1800);
  return { s, st, a: E.alarms(s, st).find((x) => x.id === "spo2Low") };
}
test("E1: a mild low SpO2 card leads with one FiO2 step; the learner's CO2 pair comes second as 'Also fix the CO2'", () => {
  const { a } = pinkiLowSpo2();
  assert.ok(a, "low SpO2 alarm fires (SpO2 91, goal 92 to 96)");
  assert.equal(a.spo2Band, "mild");
  assert.equal(a.causedBy.key, "vt");
  assert.deepEqual([a.primary.kind, a.primary.key, a.primary.to], ["setting", "fio2", 70], "FiO2 60 to 70, not the rate pair");
  assert.equal(a.primary.label.en, "Raise FiO2 to 70%");
  const sec = a.primary.second;
  assert.ok(sec, "the cause fix rides as primary.second");
  assert.deepEqual([sec.kind, sec.key, sec.to], ["setting", "rr", 29]);
  assert.deepEqual(sec.pair, { key: "vt", keep: 300 });
  assert.equal(sec.heading.en, "Also fix the CO2"); assert.ok(bi(sec.heading) && bi(sec.label));
  assert.equal(a.silenceOk, true, "a mild low SpO2 may be silenced while you work");
  // the high EtCO2 card for the same patient still leads with the rate pair (CO2 is its own problem)
  const { s, st } = pinkiLowSpo2();
  const c = E.alarms(s, st).find((x) => x.id === "etco2High");
  assert.equal(c.primary.key, "rr"); assert.equal(c.primary.second, undefined);
});

test("E1: an emergency low SpO2 never offers Silence and never leads with a FiO2 set back below 100", () => {
  // pneumonia with FiO2 cut from 70 to 40: SpO2 86, emergency band
  let s = E.init(quiet("pneumonia")); const st = set(s, { fio2: 40 });
  s = E.step(s, st, 600);
  let a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.equal(a.spo2Band, "emergency");
  assert.equal(a.severity, "danger", "below 88% is the red emergency the tutorial teaches (raised, never lowered)");
  assert.equal(a.priority, "high");
  assert.equal(a.silenceOk, false); assert.ok(bi(a.silenceWhy) && noDash(a.silenceWhy));
  assert.deepEqual([a.primary.kind, a.primary.id], ["action", "bag100"]);
  // while bagging (Bag 100% is no longer available) the card must not say "Raise FiO2" or "Set FiO2 back to 70"
  s = E.step(E.act(s, "bag100"), st, 5);
  a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.ok(a, "SpO2 is still low while bagging");
  assert.ok(!(a.primary.kind === "setting" && a.primary.key === "fio2"), "no FiO2 dial while bagging: " + a.primary.label.en);
  assert.equal(a.silenceOk, false);
  // an emergency caused by a FiO2 cut: setting FiO2 back to 70 does not treat SpO2 86
  const p = E.alarmPlan(s, "spo2Low", st);
  assert.ok(!(p.primary.setBack && p.primary.key === "fio2" && p.primary.to < 100), "never 'Set FiO2 back to 70' in an emergency");
  // high-priority patient alarms are not silenced either; ventilator alarms keep their 2 min silence
  const d = E.alarms(s, st).find((x) => x.id === "disconnect");
  assert.equal(d.silenceOk, true);
});

test("E1: disconnected: the low SpO2 card leads with Reconnect, an engine action", () => {
  let s = E.init(quiet("postop-atelectasis")); const st = s.settings;
  s = E.step(E.inject(s, "disconnect", { duration: 600 }), st, 90);
  const a = E.alarms(s, st).find((x) => x.id === "spo2Low"), d = E.alarms(s, st).find((x) => x.id === "disconnect");
  assert.deepEqual([d.primary.kind, d.primary.id], ["action", "reconnect"]);
  if (a) assert.deepEqual([a.primary.kind, a.primary.id], ["action", "reconnect"]);
});

/* ---------- E2: drift attribution ---------- */
test("E2: 'You changed nothing' is never said within 30 min of a change: the change is named with its numbers", () => {
  // Pinki B-1: VT 500 to 350, +30 min, rate 23 from the card, +30 min. The UI calls whyDrift(state, settings, baseReadout).
  let s = E.init(quiet("postop-atelectasis")); const st1 = set(s, { vt: 350 });
  s = E.step(s, st1, 1800);
  const base = E.readout(s, st1);
  assert.equal(base.t, 1800, "readout carries its sim time");
  const st2 = Object.assign({}, st1, { rr: 23 });
  s = E.step(s, st2, 1800);
  const why = E.whyDrift(s, st2, base);
  assert.ok(Array.isArray(why) && why.length, "a reason list");
  assert.equal(why[0].kind, "yourChange");
  assert.match(why[0].because.en, /^Your change 30 min ago \(the rate 14 to 23\/min\) is still working: PaCO2 \d+ to \d+/);
  assert.ok(bi(why[0].because) && noDash(why[0].because));
  assert.ok(!why.some((x) => /changed nothing/i.test(x.because.en)));
  const rep = E.driftReport(s, st2, base);
  assert.equal(rep.learnerChanged, true);
  assert.deepEqual(rep.changes.map((c) => [c.key, c.from, c.to, c.minutesAgo]), [["rr", 14, 23, 30]]);
});

test("E2: a bedside action counts as a change too; with no change and no event the report says so", () => {
  let s = E.init(quiet("postop-normal")); const st = s.settings;
  s = E.inject(s, "secretions", { factor: 3 }); s = E.step(s, st, 120);
  const base = E.readout(s, st);
  s = E.act(s, "suction"); s = E.step(s, st, 600);
  const rep = E.driftReport(s, st, base);
  assert.equal(rep.learnerChanged, true); assert.equal(rep.actions[0].id, "suction");
  let q = E.init(quiet("postop-atelectasis")); const b2 = E.readout(q, q.settings); q = E.step(q, q.settings, 1800);
  const r2 = E.driftReport(q, q.settings, b2);
  assert.equal(r2.learnerChanged, false); assert.deepEqual(r2.changes, []);
  // the old two-state signature still works
  const old = E.whyDrift(E.init(quiet("postop-atelectasis")), q);
  assert.ok(Array.isArray(old));
});

/* ---------- E3: directions from values; predictions flagged ---------- */
test("E3: the fallback 'still rising' is never used when the gas at those settings is heading down", () => {
  // B: 10 min after a VT cut (CO2 rising); A: 30 min after it, but the rate was just raised (CO2 now heading down)
  let s = E.init(quiet("postop-atelectasis")); const st1 = set(s, { vt: 300 });
  const sB = E.step(s, st1, 600), sAraw = E.step(s, st1, 1800);
  const st2 = Object.assign({}, st1, { rr: 30, ti: 0.8 });
  const sA = E.step(sAraw, st2, 1);
  const rs = E.explainDelta(E.abg(sB), E.abg(sA), st1, st2, sB, sA).filter((x) => x.param === "PaCO2");
  assert.ok(rs.length);
  for (const x of rs) {
    assert.ok(!/still rising/.test(x.because.en) && !/still rising/.test((x.plain || {}).en || ""), x.because.en);
  }
  assert.equal(rs[0].prediction, false);
});

test("E3: what-if and two futures of one moment are labelled as predictions with their horizon", () => {
  const s = E.init(quiet("postop-atelectasis")), st = s.settings, st2 = Object.assign({}, st, { vt: 300 });
  const w = E.whatIf(s, st, { key: "vt", to: 300 });
  assert.equal(w.prediction, true); assert.equal(w.horizonMin, 30);
  assert.ok(w.because.length && w.because.every((x) => x.prediction === true && x.horizonMin === 30));
  // the Confirm chain: explainDelta of 30 min without vs with the change, both from the same moment
  const pB = E.step(s, st, 1800), pA = E.step(s, st2, 1800);
  const rs = E.explainDelta(E.abg(pB), E.abg(pA), st, st2, pB, pA);
  assert.ok(rs.length && rs.every((x) => x.prediction === true && x.horizonMin === 30));
  // a caller can say so explicitly (the ABG case: now vs 30 min with the change)
  const rc = E.explainDelta(E.abg(s), E.abg(pA), st, st2, s, pA, { prediction: true, horizonMin: 30 });
  assert.ok(rc.every((x) => x.prediction === true && x.horizonMin === 30));
});

/* ---------- E4: ABG reading ---------- */
test("E4: pH 7.35 to 7.45 with near-normal CO2 and HCO3 is a normal acid base; 7.34 with low HCO3 is metabolic acidosis", () => {
  assert.equal(E.interpretAbg({ pH: 7.35, PaCO2: 40, HCO3: 21.5 }).acidBase, "normal");
  assert.equal(E.interpretAbg({ pH: 7.36, PaCO2: 39, HCO3: 20.8 }).acidBase, "normal");
  assert.equal(E.interpretAbg({ pH: 7.44, PaCO2: 40, HCO3: 26.8 }).acidBase, "normal");
  assert.equal(E.interpretAbg({ pH: 7.34, PaCO2: 40, HCO3: 21 }).acidBase, "metabolicAcidosis");
  // a real compensated metabolic acidosis keeps its name: low HCO3, low CO2, normal pH
  assert.notEqual(E.interpretAbg({ pH: 7.37, PaCO2: 30, HCO3: 17 }).acidBase, "normal");
});

test("E4: Level 1 plain reading has no Winter's, no acidaemia, no equations; grammar 'makes'", () => {
  for (const g of [{ pH: 7.21, PaCO2: 35, HCO3: 13.5 }, { pH: 7.25, PaCO2: 63, HCO3: 27 }, { pH: 7.48, PaCO2: 30, HCO3: 22 }, { pH: 7.40, PaCO2: 40, HCO3: 24 }]) {
    const ip = E.interpretAbg(g);
    assert.ok(bi(ip.plain), JSON.stringify(g));
    assert.ok(!/Winter|acidaem|alkalaem|Henderson|=/i.test(ip.plain.en), ip.plain.en);
    assert.ok(short(ip.plain) && noDash(ip.plain));
  }
  // curveNoteShort: "Acid blood makes", not "Acid blood make"
  const s = E.step(E.init(quiet("asthma")), E.init(quiet("asthma")).settings, 60), g = E.abg(s);
  if (g.curveNoteShort) assert.match(g.curveNoteShort.en, /^(Acid blood makes|Acid blood and fever make|Alkaline blood makes|Fever makes)/);
  // flags with jargon labels carry a plain line
  const r = E.readout(s); const ac = r.flags.find((f) => f.id === "acidosis");
  if (ac) { assert.ok(bi(ac.plain)); assert.ok(!/acidaem/i.test(ac.plain.en)); }
});

/* ---------- E5: no instant SpO2 change at Confirm; alarm and target agree ---------- */
test("E5: Confirm does not move SpO2 with the clock stopped; the low SpO2 alarm agrees with the target", () => {
  // Sameer S2: Mrs Das, sensible settings VT 330, rate 22, PEEP 10: SpO2 93 to 91 and a Low SpO2 alarm at 0h00
  const s = E.init(quiet("postop-atelectasis")), st0 = s.settings, st1 = Object.assign({}, st0, { vt: 330, rr: 22, peep: 10 });
  const r0 = E.readout(s, st0), r1 = E.readout(s, st1);
  assert.equal(r1.vitals.spo2, r0.vitals.spo2, "no SpO2 change before time runs");
  assert.ok(!E.alarms(s, st1).some((a) => a.id === "spo2Low"), "no low SpO2 alarm at 0 s");
  // the monitor follows within a minute (finger probe and circulation lag), and the patient improves with time
  const r60 = E.readout(E.step(s, st1, 60), st1), r30m = E.readout(E.step(s, st1, 1800), st1);
  assert.ok(r30m.vitals.spo2 > r0.vitals.spo2, r0.vitals.spo2 + " to " + r30m.vitals.spo2);
  assert.ok(Math.abs(r60.vitals.spo2 - r0.vitals.spo2) <= 3);
  // B-6: an SpO2 shown as 92 with a goal of 92 to 96 never alarms
  let p = E.init(quiet("postop-atelectasis")); const sp = set(p, { vt: 350 }); p = E.step(p, sp, 1800);
  const shown = E.readout(p, sp).vitals.spo2, low = E.alarms(p, sp).some((a) => a.id === "spo2Low");
  assert.equal(low, shown < 92, "alarm iff the shown SpO2 is below 92 (shown " + shown + ")");
});

/* ---------- E6: honest debrief ---------- */
function liveRun(id, plan) {
  const sc = quiet(id); let s = E.init(sc); let st = Object.assign({}, s.settings); const log = [];
  const snap = (action) => log.push({ t: s.t, settings: Object.assign({}, st), readout: E.readout(s, st), action });
  snap("start");
  for (const p of plan) {
    if (p.set) { st = Object.assign({}, st, p.set); snap("set:" + Object.keys(p.set).join(",")); }
    if (p.act) { s = E.act(s, p.act); snap("act:" + p.act); }
    for (let k = 0; k < (p.wait || 0); k += 60) { s = E.step(s, st, 60); snap("live"); }
  }
  return { sc, log, s, st };
}
test("E6: a patient who started on target: 'nothing to improve', no best score, no time points", () => {
  // Kavya B3: Mr Rao, FiO2 40 to 35 and nothing else: 100/100, "all goals met at 0 min"
  const { sc, log } = liveRun("postop-normal", [{ set: { fio2: 35 }, wait: 1800 }]);
  const x = E.score({ scenario: sc, log, answers: [{ kind: "alarm", id: "fio2Low", correct: true, selfMade: true }] });
  assert.equal(x.nothingToImprove, true);
  assert.equal(x.countsForBest, false);
  assert.equal(x.scored.time, false, "time to goals means nothing when the goals held from the start");
  assert.match(x.notes[0].en, /started on target/); assert.ok(bi(x.notes[0]));
  assert.equal(x.scored.alarms, false, "fixing your own alarm is not an alarm response");
  assert.ok(x.selfMadeAlarms && x.selfMadeAlarms.length === 1);
});

test("E6: an alarm that stayed on 5 min or more counts as late even if a change cleared it later", () => {
  // Pinki: EtCO2 alarm ignored for 35 min, then cleared by a rate change: "3 of 3 in time"
  const { sc, log } = liveRun("postop-atelectasis", [{ set: { vt: 300 }, wait: 2100 }, { set: { rr: 29, ti: 0.8 }, wait: 1800 }]);
  const x = E.score({ scenario: sc, log, answers: [{ kind: "alarm", id: "etco2High", correct: true }, { kind: "alarm", id: "vtLow", correct: true }] });
  assert.equal(x.parts.alarms, 5, "1 of 2 in time");
  assert.ok(x.missedAlarms.some((m) => m.id === "etco2High" && m.late === true));
  assert.match(x.explain.alarms.en, /1 of 2/);
});

test("E6: the Time part agrees with the longest spell off a goal (S6)", () => {
  // goals met early, then CO2 off target for 10+ min, then back: "met at 5 min and held" was the old text
  const sc = quiet("postop-normal"), log = [];
  const rd = (pc) => ({ vitals: { spo2: 96, map: 85, hr: 80 }, vent: { vte: 450, pplat: 18, drivingP: 12 }, gas: { paco2: pc, ph: 7.4 }, flags: [] });
  for (let t = 0; t <= 3600; t += 60) log.push({ t, settings: { mode: "acvc", fio2: 40, vt: 450 }, readout: rd(t >= 1200 && t < 2100 ? 50 : 40) });
  const x = E.score({ scenario: sc, log });
  assert.ok(x.worstSpell && x.worstSpell.key === "paco2" && x.worstSpell.minutes >= 10);
  assert.ok(!/held 5 min or more, and still held/.test(x.explain.time.en), x.explain.time.en);
  assert.match(x.explain.time.en, /lost/);
  assert.ok(x.parts.time < 10, "time " + x.parts.time);
  assert.equal(x.goals.settledMin, 35);
});

/* ---------- E7: senior-only actions ---------- */
test("E7: muscle relaxant and transfusion are senior-only with a consequence line; unneeded use is unsafe in the score", () => {
  for (const id of ["paralyse", "blood"]) {
    const a = E.ACTIONS[id];
    assert.equal(a.seniorOnly, true, id); assert.ok(bi(a.consequence) && noDash(a.consequence) && short(a.consequence)); assert.equal(typeof a.indicated, "function");
  }
  for (const id of ["suction", "bag100", "reconnect"]) assert.ok(!E.ACTIONS[id].seniorOnly, id);
  // Pinki B-8: a relaxant at Level 1 on a calm patient: no flag, "No unsafe moments"
  const { sc, log } = liveRun("postop-normal", [{ wait: 120 }, { act: "paralyse", wait: 900 }]);
  const ev = log.find((l) => l.action === "act:paralyse").readout.events.find((e) => e.id === "paralyse");
  assert.equal(ev.seniorOnly, true); assert.equal(ev.indicated, false);
  const x = E.score({ scenario: sc, log });
  assert.ok(x.unsafeList.some((u) => /relaxant/i.test(u.what.en)), JSON.stringify(x.unsafeList));
  assert.ok(x.parts.unsafe < 0);
  assert.ok(x.notes.some((n) => /senior/i.test(n.en)));
});

/* ---------- E8: suggestions and Confirm warnings ---------- */
test("E8: a bronchodilator is not suggested for a mucus plug or secretions in a healthy lung", () => {
  // the low SpO2 tutorial's patient: healthy lungs, mucus plugs and thick secretions (resistance 40), peak alarm 30
  let s = E.init(quiet("postop-normal"), { pPeakHigh: 30 }); const st = s.settings;
  s = E.inject(s, "secretions", { factor: 4 }); s = E.inject(s, "plug"); s = E.inject(s, "plug"); s = E.step(s, st, 120);
  assert.ok(E.alarms(s, st).some((a) => a.id === "pPeakHigh"), "high peak pressure from the secretions");
  const ids = E.suggestActions(s).map((a) => a.id);
  assert.ok(ids.includes("suction")); assert.ok(!ids.includes("bronchodilator"), ids.join(","));
  // bronchospasm still gets it
  let b = E.init(quiet("postop-normal"), { pPeakHigh: 30 }); b = E.inject(b, "bronchospasm", { factor: 4 }); b = E.step(b, b.settings, 60);
  assert.ok(E.suggestActions(b).some((a) => a.id === "bronchodilator"));
});

test("E8: FiO2 21 or a big FiO2 drop on a patient who needs oxygen is a Confirm warning", () => {
  const s = E.init(quiet("postop-atelectasis")), st = s.settings;
  const w = E.settingWarnings(s, st, Object.assign({}, st, { fio2: 21 }));
  const ids = w.map((x) => x.id);
  assert.ok(ids.includes("fio2RoomAir") && ids.includes("fio2BigDrop") && ids.includes("fio2Hypoxic"), ids.join(","));
  for (const x of w) { assert.ok(bi(x.text) && noDash(x.text) && short(x.text)); assert.ok(["warn", "danger"].includes(x.severity)); }
  assert.equal(w.find((x) => x.id === "fio2Hypoxic").severity, "danger");
  // a gentle wean on a patient above target is fine
  const n = E.init(quiet("postop-normal"));
  assert.deepEqual(E.settingWarnings(n, n.settings, Object.assign({}, n.settings, { fio2: 35 })), []);
});

/* ---------- E9: low SpO2 tutorial physics ---------- */
test("E9: suction while bagging does not jump SpO2 to 100 at once; the lobe reopens on the ventilator; Reconnect ends bagging", () => {
  let t = E.init(quiet("postop-normal")); const st = Object.assign({}, t.settings, { fio2: 50 });
  t = E.inject(t, "plug"); t = E.inject(t, "plug"); t = E.inject(t, "secretions", { factor: 4 }); t = E.inject(t, "plug"); t = E.step(t, st, 300);
  t = E.step(E.act(t, "bag100"), st, 10);
  const before = E.readout(t, st).vitals.spo2;
  t = E.act(t, "suction");
  assert.ok(E.readout(t, st).vitals.spo2 <= before + 1, "no jump at the moment of suction: " + before + " to " + E.readout(t, st).vitals.spo2);
  assert.ok(E.readout(E.step(t, st, 20), st).vitals.spo2 < 99, "20 s later, still bagging without PEEP, not 100");
  assert.ok(E.ACTIONS.reconnect.available(t));
  assert.ok(Array.isArray(E.ACTIONS.reconnect.checks) && E.ACTIONS.reconnect.checks.length >= 3 && E.ACTIONS.reconnect.checks.every(bi));
  t = E.act(t, "reconnect");
  assert.ok(!E.ACTIONS.reconnect.available(t) && E.ACTIONS.bag100.available(t), "back on the ventilator");
  assert.ok(!E.alarms(t, st).some((a) => a.id === "disconnect"));
  const r5 = E.readout(E.step(t, st, 300), st).vitals.spo2;
  assert.ok(r5 >= 94, "on the ventilator with PEEP the lobe reopens over minutes: " + r5);
});
