// Narkē Ventilator Lab engine, round-4 persona fixes (E1 to E8 in the round-4 fix brief, from the Pinki and Sameer
// round-3 runs). Each test reproduces a finding, then checks the fix.
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
const short = (o) => o.en.split(/(?<=[.!?:;])\s+/).every((x) => x.split(/\s+/).length <= 20);

// Pinki's run: postop-atelectasis (PBW 47.9 kg) starts on VT 500 = 10.4 mL/kg. She lowers VT to 290 (6 mL/kg) and
// leaves the rate at 14, so the minute volume falls and CO2 climbs for 30 minutes.
function pinki() {
  let s = E.init(quiet("postop-atelectasis")); const st = Object.assign({}, s.settings, { vt: 290 });
  s = E.step(s, st, 1800);
  return { s, st };
}

/* E1: "Set VT back to 500" (10.4 mL/kg) was the alarm's fix */
test("E1: a learner-caused alarm never leads with an injurious set back; it offers the safe rate pair and says why", () => {
  const { s, st } = pinki();
  const a = E.alarms(s, st).find((x) => x.id === "etco2High");
  assert.ok(a, "high EtCO2 fires");
  assert.equal(a.causedBy.key, "vt"); assert.equal(a.causedBy.from, 500);
  assert.equal(a.causedBy.safeBack, false, "VT 500 is 10.4 mL/kg: not a safe set back");
  assert.match(a.causedBy.unsafeWhy.en, /VT 10\.4 mL\/kg predicted body weight, above the safe 4 to 8/); assert.ok(bi(a.causedBy.unsafeWhy) && short(a.causedBy.unsafeWhy));
  assert.ok(!(a.primary.key === "vt" && a.primary.to === 500), "primary is not VT back to 500");
  // the rate that restores ALVEOLAR ventilation (rate 14 x 500 / 290 = 24 matches minute volume but not the fresh air)
  assert.deepEqual([a.primary.kind, a.primary.key, a.primary.to], ["setting", "rr", 31]);
  assert.deepEqual(a.primary.pair, { key: "vt", keep: 290 });
  assert.deepEqual(a.primary.also, { ti: 0.8 }, "Ti shortened so breathing out stays longer than breathing in");
  assert.equal(a.primary.label.en, "Raise the rate to 31, Ti 0.8 s (keep VT 290 mL)");
  assert.ok(bi(a.primary.label) && bi(a.primary.why) && short(a.primary.why));
  assert.deepEqual(a.causedBy.instead, a.primary);
  // the pair works: 30 min at rate 24 brings CO2 down without the big breath
  const st2 = Object.assign({}, st, { rr: 31, ti: 0.8 }), r = E.readout(E.step(s, st2, 1800), st2), r0 = E.readout(s, st);
  assert.ok(r.gas.paco2 <= 45 && r.gas.paco2 < r0.gas.paco2 - 30, r0.gas.paco2 + " to " + r.gas.paco2);
  assert.ok(r.vent.autoPeep < 2 && r.vent.ieActual >= 1.3, "no trapping, I:E " + r.vent.ieActual);
  // the same rule holds for the UI's monitor alarm plan
  const p = E.alarmPlan(s, "etco2High", st);
  assert.equal(p.causedBy.safeBack, false); assert.equal(p.primary.key, "rr");
});

test("E1: a safe set back still leads (the old value was protective)", () => {
  let s = E.init(quiet("neuromuscular-gbs")); const st = Object.assign({}, s.settings, { rr: 6 });
  s = E.step(s, st, 1800);
  const a = E.alarms(s, st).find((x) => x.id === "etco2High");
  assert.equal(a.causedBy.key, "rr"); assert.equal(a.causedBy.safeBack, true); assert.equal(a.causedBy.instead, null);
  assert.deepEqual([a.primary.kind, a.primary.key, a.primary.to, a.primary.setBack], ["setting", "rr", 14, true]);
  assert.match(a.primary.label.en, /^Set the rate back to 14\/min$/); assert.ok(bi(a.primary.label));
});

test("E1: a set back to PEEP below 5 is not safe either: the safe step is PEEP 5", () => {
  // trauma started on PEEP 0; the learner raised it to 16 and the BP fell
  let s = E.init(quiet("trauma-contusion"), { peep: 0 }); const st = Object.assign({}, s.settings, { peep: 16 });
  s = E.step(s, st, 300);
  const a = E.alarms(s, st).find((x) => x.id === "peepSetHigh");
  assert.ok(a && a.causedBy, "PEEP set high, caused by the learner");
  assert.equal(a.causedBy.safeBack, false); assert.match(a.causedBy.unsafeWhy.en, /^Setting PEEP back to 0 cmH2O is not safe: PEEP 0, below 5: the lung can collapse\./);
  assert.ok(bi(a.causedBy.unsafeWhy) && short(a.causedBy.unsafeWhy));
  assert.deepEqual([a.primary.kind, a.primary.key, a.primary.to], ["setting", "peep", 5]);
  assert.ok(bi(a.primary.why) && short(a.primary.why));
  // a bedside action still leads (fluid for the bleeding patient's low BP)
  const m = E.alarms(s, st).find((x) => x.id === "mapLow");
  assert.equal(m.primary.kind, "action");
});

/* E2: the high EtCO2 card: "Check the minute volume" was a dead step with no number and no action */
test("E2: the high EtCO2 card names the learner's change and the minute volume numbers", () => {
  const { s, st } = pinki();
  const a = E.alarms(s, st).find((x) => x.id === "etco2High");
  const co2 = a.checklist.find((c) => c.id === "co2");
  assert.match(co2.text.en, /The air each minute is 4\.1 L\/min \(rate 14 x VT 290 mL\)\./);
  assert.match(co2.text.en, /It was 7 L\/min before you changed VT from 500 mL to 290 mL/);
  assert.ok(bi(co2.text) && short(co2.text));
  assert.notEqual(a.primary.kind === "check" && a.primary.id, "co2", "no dead 'check the minute volume' primary");
});

test("E2: without a learner cause, high EtCO2 leads with a rate step, or with a blood gas in a lung that traps air", () => {
  let s = E.init(quiet("neuromuscular-gbs"), { rr: 6 }); const st = Object.assign({}, s.settings);
  s = E.step(s, st, 1800);
  const a = E.alarms(s, st).find((x) => x.id === "etco2High");
  assert.ok(a && !a.causedBy, "no learner change");
  assert.deepEqual([a.primary.kind, a.primary.key, a.primary.to], ["setting", "rr", 10]);
  assert.ok(bi(a.primary.why));
  assert.match(a.checklist.find((c) => c.id === "co2").text.en, /The air each minute is \d/);
  // asthma: a flow-limited lung; more rate traps air, so the gas decides
  const p = E.alarmPlan(E.init(quiet("asthma")), "etco2High");
  assert.deepEqual([p.primary.kind, p.primary.id], ["check", "abg"]); assert.ok(bi(p.primary.label));
});

/* E3: "Call your senior now: pH below 7.20" with no blood gas drawn */
test("E3: the call-senior line quotes a pH only from a blood gas the learner drew", () => {
  const { s, st } = pinki();
  assert.ok(s.last.ph < 7.2, "the hidden blood is acid: " + s.last.ph);
  for (const a of E.alarms(s, st)) assert.ok(!a.callWhy || !/pH/.test(a.callWhy.en), a.id + ": " + (a.callWhy && a.callWhy.en));
  assert.ok(!/pH/.test((E.alarmPlan(s, "etco2High", st).callWhy || { en: "" }).en));
  const g = E.abg(s), t0 = s.t, later = E.step(s, st, 120);
  const a = E.alarms(later, st, { lastAbg: g }).find((x) => x.id === "etco2High");
  assert.ok(a.callNow); assert.match(a.callWhy.en, new RegExp("pH " + g.pH.toFixed(2).replace(/0$/, "") + " on the last blood gas \\(2 min ago\\)"));
  assert.ok(bi(a.callWhy));
  const p = E.alarmPlan(Object.assign({}, later, { lastAbg: g }), "etco2High", st);
  assert.match(p.callWhy.en, /on the last blood gas/, "state.lastAbg works too");
  assert.ok(t0 < later.t);
});

/* E4: plain lines that contradict the numbers; raw "Shunt 0.25"; the P50 paragraph at Level 1 */
test("E4: every explainDelta reason carries a plain line that follows the real deltas", () => {
  // CO2 still rising at the same settings (minute volume unchanged): never "less air each minute"
  let a = E.init(quiet("postop-atelectasis")); const st = Object.assign({}, a.settings, { vt: 290 });
  const b1 = E.step(a, st, 120), b2 = E.step(b1, st, 600);
  const rs = E.explainDelta(E.abg(b1), E.abg(b2), st, st, b1, b2);
  const co2 = rs.filter((x) => x.param === "PaCO2");
  assert.ok(co2.length, "PaCO2 moved");
  for (const x of rs) assert.ok(bi(x.plain) && short(x.plain), JSON.stringify(x));
  for (const x of co2) { assert.ok(!/less (fresh )?air each minute/i.test(x.plain.en), x.plain.en); assert.match(x.plain.en, /still rising/); }
  // a real minute volume cut: the plain line says less fresh air
  const c = E.explainDelta(E.abg(a), E.abg(E.step(a, st, 900)), a.settings, st, a, E.step(a, st, 900)).find((x) => x.param === "PaCO2");
  assert.match(c.plain.en, /Less fresh air reaches the air sacs each minute/);
  // whatIf reasons carry it too
  for (const x of E.whatIf(E.init(quiet("ards")), null, { key: "peep", to: 14 }).because) assert.ok(bi(x.plain), x.param);
});

test("E4: SaO2 against PaO2 is explained in plain words, not as a contradiction", () => {
  const B = { PaCO2: 40, PaO2: 70, SaO2: 93, pH: 7.4, lactate: 1 }, A = { PaCO2: 60, PaO2: 75, SaO2: 91, pH: 7.25, lactate: 1 };
  let s = E.init(quiet("postop-atelectasis")); const st = Object.assign({}, s.settings, { vt: 290, fio2: 80 }), s2 = E.step(s, st, 1500);
  const rs = E.explainDelta(B, A, s.settings, st, s, s2), sa = rs.find((x) => x.param === "SaO2");
  assert.ok(sa, "SaO2 reason when it moves against PaO2");
  assert.match(sa.plain.en, /more acid, so it holds oxygen less tightly/); assert.match(sa.plain.en, /Both numbers are right/);
});

test("E4: shunt in plain words and a short curve note without P50", () => {
  const r = E.readout(E.init(quiet("postop-atelectasis")));
  assert.equal(r.gas.shuntPct, Math.round(r.gas.shunt * 100));
  assert.match(r.gas.shuntPlain.en, /^About a quarter of the blood passes lung that gets no air \(shunt 2\d%\)\.$/);
  assert.ok(bi(r.gas.shuntPlain));
  const g = E.abg(E.init(quiet("pneumonia")));
  assert.ok(g.curveNote && /P50/.test(g.curveNote.en), "long form keeps P50 for higher levels");
  assert.ok(bi(g.curveNoteShort) && !/P50/.test(g.curveNoteShort.en + g.curveNoteShort.hi) && short(g.curveNoteShort), g.curveNoteShort && g.curveNoteShort.en);
  assert.match(g.curveNoteShort.en, /^Acid blood and fever make blood let go of oxygen more easily, so SaO2 is 90% at PaO2 78\.$/);
  assert.equal(E.abg(E.init(quiet("postop-normal"))).curveNoteShort, null);
});

/* E5: "all goals met together at 0 min" while CO2 sat at 63 for 30 minutes; 94/100 with the CO2 spell unnamed */
function pinkiRun() {
  const sc = quiet("postop-atelectasis"); let s = E.init(sc); const st = Object.assign({}, s.settings), log = [];
  const snap = (action) => log.push({ t: s.t, settings: Object.assign({}, st), readout: E.readout(s, st), action });
  snap("start");
  Object.assign(st, { vt: 290 }); snap("set:vt");
  for (let k = 0; k < 30; k++) { s = E.step(s, st, 60); snap("live"); }
  Object.assign(st, { rr: 31, ti: 0.8 }); snap("set:rr,ti");
  for (let k = 0; k < 40; k++) { s = E.step(s, st, 60); snap("live"); }
  snap("finish");
  return { sc, log, x: E.score({ scenario: sc, log, answers: [] }) };
}
test("E5: goals count as met only when all hold together for 5 sim min; the worst spell is named with its times", () => {
  const { log, x } = pinkiRun();
  const zero = log.find((l) => l.action.startsWith("set:vt")).readout;
  assert.ok(zero.gas.paco2 <= 45 && zero.vitals.spo2 >= 92, "every goal is true for a moment at 0 min");
  assert.notEqual(x.goals.firstMin, 0, "a moment at 0 min is not 'goals met'");
  assert.ok(x.goals.firstMin >= 30, "met only after the rate rose: " + x.goals.firstMin);
  assert.equal(x.goals.metAtEnd, true); assert.ok(x.goals.heldAtEndMin >= 5); assert.equal(x.goals.holdMin, 5);
  assert.match(x.explain.time.en, /held 5 min or more, and still held at the end/);
  const w = x.worstSpell;
  assert.ok(w, "worst spell named");
  assert.equal(w.key, "paco2"); assert.equal(w.side, "high");
  assert.ok(w.fromMin <= 5 && w.toMin >= 30 && w.minutes >= 25, JSON.stringify(w));
  assert.ok(w.peak >= 60);
  assert.match(w.what.en, /^PaCO2 above 45 \(up to \d+\)$/); assert.ok(bi(w.what));
  assert.match(x.notes[0].en, /^Longest time off a goal: PaCO2 above 45 \(up to \d+\) from \d+ to \d+ min\.$/); assert.ok(bi(x.notes[0]));
});

test("E5: all goals true for under 5 min do not count; a short end spell is said plainly", () => {
  const sc = { id: "x", patient: { sex: "M", heightCm: 168 }, goals: { spo2: [92, 96], paco2: [35, 45], pplatMax: 30, drivingMax: 15, vtPerKg: [6, 8] }, timeline: [] };
  const rd = (spo2) => ({ vitals: { spo2, map: 80 }, vent: { pplat: 22, drivingP: 12, vte: 420, autoPeep: 0 }, gas: { ph: 7.38, paco2: 40 }, flags: [] });
  const set = { mode: "acvc", fio2: 40 }, log = [];
  for (let t = 0; t <= 1200; t += 60) log.push({ t, settings: set, readout: rd(t >= 300 && t <= 480 ? 94 : 89) }); // 3 min on target
  for (let t = 1260; t <= 1440; t += 60) log.push({ t, settings: set, readout: rd(94) }); // the last 3 min on target
  const x = E.score({ scenario: sc, log });
  assert.equal(x.goals.firstMin, null);
  assert.equal(x.goals.metAtEnd, true);
  assert.match(x.explain.time.en, /only for the last 3 min\. They count once they hold together for 5 minutes\./); assert.ok(bi(x.explain.time));
  assert.equal(x.worstSpell.key, "spo2"); assert.match(x.worstSpell.what.en, /SpO2 below 92% \(down to 89%\)/);
});

/* E6: "What to try: suction (...) the tube." and no mild versus emergency split for low SpO2 */
test("E6: low SpO2 is mild from 88% to the goal and an emergency below 88%, in the alarm plan and in oxygenHelp", () => {
  // mild: pneumonia starts at SpO2 90 on FiO2 70
  let s = E.init(quiet("pneumonia")); const st = Object.assign({}, s.settings);
  const m = E.alarms(s, st).find((x) => x.id === "spo2Low"), h = E.readout(s, st).oxygenHelp;
  assert.equal(m.spo2Band, "mild"); assert.equal(h.band, "mild");
  assert.deepEqual([m.primary.kind, m.primary.key, m.primary.to], ["setting", "fio2", 80]);
  assert.deepEqual(m.checklist.slice(0, 3).map((c) => c.id), ["patient", "probe", "fio2"]);
  assert.match(h.next[0].en, /check the probe/); assert.ok(bi(h.next[0]));
  // emergency: ARDS on its start settings is below 88
  const a = E.init(quiet("ards")), e = E.alarms(a, a.settings).find((x) => x.id === "spo2Low"), he = E.readout(a, a.settings).oxygenHelp;
  assert.ok(E.readout(a, a.settings).vitals.spo2 < 88);
  assert.equal(e.spo2Band, "emergency"); assert.equal(he.band, "emergency");
  assert.deepEqual([e.primary.kind, e.primary.id], ["action", "bag100"]);
  assert.deepEqual(e.checklist.slice(0, 2).map((c) => c.id), ["patient", "bag"]);
  assert.ok(e.callNow && /SpO2 below 88%/.test(e.callWhy.en));
  assert.match(he.next[0].en, /below 88% is an emergency: hand bag with 100% oxygen, think DOPE and call your senior/);
  assert.equal(e.priority, e.severity === "danger" ? "high" : "medium", "priority unchanged");
});

test("E6: no engine line reads 'suction the tube' (the gloss broke it into 'suction (...) the tube')", () => {
  const texts = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (typeof x.en === "string") texts.push(x.en); for (const k in x) walk(x[k]); } };
  for (const sc0 of S.scenarios) {
    let s = E.init(Object.assign(JSON.parse(JSON.stringify(sc0)), { timeline: [] })); const st = Object.assign({}, s.settings, { peep: 12 });
    s = E.step(s, st, 600); walk(E.readout(s, st)); walk(E.alarms(s, st));
    walk(E.readout(E.inject(s, "secretions"), st));
    for (const id of ["spo2Low", "pPeakHigh", "vtLow"]) walk(E.alarmPlan(s, id, st));
  }
  assert.ok(texts.length > 100);
  for (const t of texts) assert.ok(!/suction the tube/i.test(t), t);
});

/* E7: SpO2 falls from 88 to 87 while bagging and nothing says why */
test("E7: a fall while bagging on 100% oxygen comes with its reason (no PEEP, lung closing, shunt)", () => {
  let s = E.init(quiet("ards")); const st = Object.assign({}, s.settings);
  s = E.step(s, st, 600); s = E.act(s, "bag100");
  const r0 = E.readout(s, st), s1 = E.step(s, st, 10), r1 = E.readout(s1, st);
  assert.ok(r1.vitals.spo2 < r0.vitals.spo2, "SpO2 falls while bagging: " + r0.vitals.spo2 + " to " + r1.vitals.spo2);
  for (const r of [r0, r1]) {
    const tr = r.oxygenTrend;
    assert.ok(tr, "trend present");
    assert.equal(tr.direction, "down"); assert.equal(tr.kind, "derecruit");
    assert.match(tr.reason.en, /no PEEP/); assert.match(tr.reason.en, /extra oxygen cannot reach that blood/);
    assert.ok(bi(tr.reason) && short(tr.reason) && bi(tr.lag));
    assert.deepEqual(r.oxygenHelp.trend, tr, "oxygenHelp carries the same trend");
  }
  // recovering after a FiO2 rise: up, with the lag reason
  let p = E.init(quiet("pneumonia")); const sp = Object.assign({}, p.settings, { fio2: 100 });
  const up = E.readout(E.step(p, sp, 10), sp).oxygenTrend;
  assert.equal(up.direction, "up"); assert.equal(up.kind, "recovering"); assert.ok(up.toward > E.readout(p, p.settings).vitals.spo2);
  // steady and on goal: no trend
  const n = E.init(quiet("postop-normal"));
  assert.equal(E.readout(n, n.settings).oxygenTrend, null);
});

/* E8: 7.18 / 57 / HCO3 20.7 was never named a mixed acidosis */
test("E8: abg() names a mixed respiratory and metabolic acidosis, and the textbook steps behind it", () => {
  const I = E.interpretAbg;
  // round 6 (E2): the metabolic part needs HCO3 below 20, or 4 below the baseline (the patient's own, else a normal 24
  // carried by the acute CO2 rise); against Mrs Das's own 22, 20.7 reads respiratory
  assert.equal(I({ pH: 7.18, PaCO2: 57, HCO3: 20.7, hco3Base: 22 }).acidBase, "respiratoryAcidosis");
  const sameer = I({ pH: 7.14, PaCO2: 57, HCO3: 19.2, PaO2: 55, FiO2: 0.6, lactate: 2.5 });
  assert.equal(sameer.acidBase, "mixedAcidosis"); assert.equal(sameer.mixed, true);
  assert.deepEqual(sameer.parts, ["respiratoryAcidosis", "metabolicAcidosis"]);
  assert.equal(sameer.label.en, "Mixed respiratory and metabolic acidosis"); assert.ok(bi(sameer.label) && bi(sameer.detail));
  assert.equal(sameer.failure, "type2", "low oxygen and high CO2 together"); assert.equal(sameer.lactic, true);
  // Winter's formula: DKA that lost its breathing compensation is mixed too
  const dka = I({ pH: 6.94, PaCO2: 32, HCO3: 6.7, PaO2: 167, FiO2: 0.4 });
  assert.equal(dka.acidBase, "mixedAcidosis"); assert.deepEqual(dka.winters, [16, 20]); assert.equal(dka.main, "metabolic");
  assert.equal(I({ pH: 7.31, PaCO2: 31, HCO3: 15, lactate: 5.5 }).acidBase, "metabolicAcidosis", "compensated lactic acidosis");
  const copd = I({ pH: 7.27, PaCO2: 72, HCO3: 32.2 });
  assert.equal(copd.acidBase, "respiratoryAcidosis"); assert.equal(copd.chronicity, "acuteOnChronic");
  assert.equal(I({ pH: 7.51, PaCO2: 28, HCO3: 21.6 }).acidBase, "respiratoryAlkalosis");
  assert.equal(I({ pH: 7.41, PaCO2: 40, HCO3: 24.4 }).acidBase, "normal");
  assert.equal(I({ pH: 7.48, PaCO2: 30, HCO3: 30 }).acidBase, "mixedAlkalosis");
  // abg() carries it, from the model's own gas
  const { s } = pinki(), g = E.abg(s);
  assert.ok(g.interp && bi(g.interp.label) && bi(g.interp.detail));
  assert.ok(g.interp.parts.includes("respiratoryAcidosis"));
  for (const sc0 of S.scenarios) { const x = E.abg(E.init(byId(sc0.id))).interp; assert.ok(x && bi(x.label) && bi(x.detail), sc0.id); x.detail.en.split(/(?<=[.!?:;])\s+/).forEach((t) => assert.ok(t.split(/\s+/).length <= 30, t)); }
});

test("E8: a combined hypoxia and hypercapnia gas case comes from the model (data for learn.json)", () => {
  // suggested case: ARDS, VT 420, rate 24, PEEP 5, FiO2 50 for 60 min
  const cs = E.caseState(byId("ards"), { settings: { vt: 420, rr: 24, peep: 5, fio2: 50 }, pre: 3600 }), g = E.abg(cs.state);
  assert.ok(g.pH < 7.2 && g.PaCO2 > 45 && g.HCO3 < 22 && g.PaO2 < 60, JSON.stringify(g));
  // round 6 (E2): the live gas is judged against this patient's own bicarbonate (20 at presentation), so HCO3 20.1 is no
  // new metabolic acid there; the case card (learn.json abg-15) reads its printed gas against a normal 24: mixed
  assert.ok(g.interp.parts.includes("respiratoryAcidosis")); assert.equal(g.interp.failure, "type2");
  assert.equal(E.interpretAbg({ pH: g.pH, PaCO2: g.PaCO2, HCO3: g.HCO3, PaO2: g.PaO2, FiO2: 0.5, lactate: g.lactate }).acidBase, "mixedAcidosis");
});

test("R4: every new bilingual field is short, dash free and has Hindi", () => {
  const out = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (typeof x.en === "string" && "hi" in x) out.push(x); for (const k in x) walk(x[k]); } };
  const { s, st } = pinki();
  walk(E.alarms(s, st)); walk(E.readout(s, st)); walk(E.abg(s));
  let b = E.act(E.step(E.init(quiet("ards")), E.init(quiet("ards")).settings, 300), "bag100"); walk(E.readout(b, b.settings)); walk(E.alarms(b, b.settings));
  assert.ok(out.length > 20);
  for (const p of out) { assert.ok(bi(p) || p.en === p.hi, JSON.stringify(p)); assert.ok(short(p), "over 20 words: " + p.en); assert.ok(!/[–—]/.test(p.en + p.hi)); }
});
