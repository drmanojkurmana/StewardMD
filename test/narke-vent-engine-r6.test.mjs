// Narkē Ventilator Lab engine, round-6 persona fixes (E1 to E9 in the round-6 fix brief, from the Pinki, Kavya and
// Sameer round-5 runs). Each test reproduces a finding, then checks the fix.
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
const noDash = (o) => !/[–—]/.test(o.en + o.hi);
const set = (s, o) => Object.assign({}, s.settings, o);
const OXY_UP = (c) => c && (c.key === "fio2" || c.key === "peep" || c.key === "epap" || c.key === "plow") && c.to > c.from;

/* ---------- E1 (SAFETY): a low SpO2 alarm never blames an FiO2 or PEEP increase ---------- */
test("E1: asthma, PEEP 5 to 14: the low SpO2 alarm does not name the PEEP rise as its cause", () => {
  let s = E.init(quiet("asthma")); const st = set(s, { peep: 14 });
  s = E.step(s, st, 300);
  const a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.ok(a, "SpO2 is below goal");
  assert.ok(!OXY_UP(a.causedBy), "causedBy must not be an oxygen increase: " + JSON.stringify(a.causedBy));
  const p = E.alarmPlan(s, "spo2Low", st);
  assert.ok(!OXY_UP(p.causedBy), "alarmPlan agrees");
  assert.ok(!(p.primary.setBack && p.primary.key === "peep"));
  assert.ok(!(p.primary.second && p.primary.second.key === "peep" && p.primary.second.to < 14));
});

test("E1: Kavya T4: FiO2 raised 40 to 50, then a plug: no set back of FiO2, and a keep-it line instead", () => {
  let s = E.init(quiet("postop-normal")); let st = s.settings;
  s = E.step(E.inject(s, "plug"), st, 120); s = E.step(E.inject(s, "plug"), st, 120);
  st = set(s, { fio2: 50 }); s = E.step(s, st, 300);
  s = E.step(E.inject(s, "secretions", { factor: 4 }), st, 120);
  s = E.step(E.inject(s, "plug"), st, 120);
  for (const band of ["emergency"]) {
    const a = E.alarms(s, st).find((x) => x.id === "spo2Low");
    assert.equal(a.spo2Band, band);
    assert.ok(!OXY_UP(a.causedBy));
    const txt = JSON.stringify(a);
    assert.ok(!/Set FiO2 back to 40/.test(txt), "never offer FiO2 back to 40 on a low SpO2 alarm");
    assert.ok(a.oxygenKeep, "the card says to keep the oxygen the learner gave");
    assert.equal(a.oxygenKeep.key, "fio2"); assert.equal(a.oxygenKeep.to, 50);
    assert.match(a.oxygenKeep.text.en, /^You raised FiO2 to 50%.*keep it until SpO2 is back.*wean/i);
    assert.ok(bi(a.oxygenKeep.text) && noDash(a.oxygenKeep.text));
  }
});

/* ---------- E3: a self-made respiratory acidosis alarms and counts as unsafe ---------- */
// Pinki B9: Mrs Das, VT 500 to 300 at rate 14: pH 7.22, PaCO2 57 for 30 min with no alarm (EtCO2 stayed under 50).
function pinkiAcid(min) {
  let s = E.init(quiet("postop-atelectasis")); const st = set(s, { vt: 300 });
  s = E.step(s, st, min * 60);
  return { s, st };
}
test("E3: pH below 7.30 or PaCO2 above 50 from the learner's change raises a medium CO2 high alarm", () => {
  const { s, st } = pinkiAcid(5);
  const r = E.readout(s, st);
  assert.ok(r.vitals.etco2 <= 50, "EtCO2 alone is quiet here: " + r.vitals.etco2);
  assert.ok(r.gas.paco2 > 50 || r.gas.ph < 7.3, JSON.stringify(r.gas));
  const a = E.alarms(s, st).find((x) => x.id === "co2High");
  assert.ok(a, "CO2 high alarm: " + E.alarms(s, st).map((x) => x.id));
  assert.equal(a.severity, "warn"); assert.equal(a.priority, "medium");
  assert.ok(bi(a.label) && noDash(a.label));
  assert.equal(a.causedBy.key, "vt");
  assert.equal(a.primary.kind, "setting");
  assert.ok(a.primary.key === "rr" || (a.primary.key === "vt" && a.primary.to > 300), JSON.stringify(a.primary));
  assert.ok(bi(a.primary.why) && /Raise the rate or the breath size/.test(a.primary.why.en), JSON.stringify(a.primary.why));
  // the plan for the same id from alarmPlan agrees
  const p = E.alarmPlan(s, "co2High", st);
  assert.equal(p.primary.key, a.primary.key);
  // once EtCO2 itself is over its limit, that alarm carries the message (no duplicate)
  const later = pinkiAcid(20), ids = E.alarms(later.s, later.st).map((x) => x.id);
  assert.ok(ids.includes("etco2High") && !ids.includes("co2High"), ids.join(","));
});

test("E3: no CO2 high alarm for a presenting acidosis the learner did not cause (DKA, COPD)", () => {
  for (const id of ["metabolic-dka", "copd", "asthma"]) {
    let s = E.init(quiet(id)); s = E.step(s, s.settings, 600);
    assert.ok(!E.alarms(s, s.settings).some((x) => x.id === "co2High"), id);
  }
});

test("E3: pH below 7.25 for 10 min or more from the learner's settings is an unsafe moment in the score", () => {
  const sc = quiet("postop-atelectasis");
  let s = E.init(sc); const st0 = s.settings, st = set(s, { vt: 300 }), log = [{ t: 0, settings: st0, readout: E.readout(s, st0), action: "start" }];
  log.push({ t: 0, settings: st, readout: E.readout(s, st), action: "set:vt" });
  for (let i = 0; i < 30; i++) { s = E.step(s, st, 60); log.push({ t: s.t, settings: st, readout: E.readout(s, st), action: "live" }); }
  const r = E.score({ scenario: sc, log });
  const u = r.unsafeList.find((x) => /^pH/.test(x.what.en));
  assert.ok(u, JSON.stringify(r.unsafeList));
  assert.ok(bi(u.what)); assert.ok(u.toMinute - u.minute >= 10);
  assert.ok(r.parts.unsafe < 0);
  // a presenting acidosis the learner leaves alone is not counted (DKA)
  const dk = quiet("metabolic-dka"); let d = E.init(dk); const dl = [{ t: 0, settings: d.settings, readout: E.readout(d, d.settings), action: "start" }];
  for (let i = 0; i < 30; i++) { d = E.step(d, d.settings, 60); dl.push({ t: d.t, settings: d.settings, readout: E.readout(d, d.settings), action: "live" }); }
  assert.ok(!E.score({ scenario: dk, log: dl }).unsafeList.some((x) => /^pH/.test(x.what.en)));
});

/* ---------- E4: debrief honesty ---------- */
const ro = (o) => ({ vitals: { spo2: o.spo2 ?? 94, map: o.map ?? 80, hr: 80, etco2: 38 }, gas: { paco2: o.paco2 ?? 40, ph: o.ph ?? 7.4, shuntPct: 10 }, vent: { vte: o.vte ?? 330, pplat: 24, drivingP: 12, autoPeep: 0 }, flags: [], events: [] });
const das = () => quiet("postop-atelectasis");
const START = { mode: "acvc", fio2: 60, peep: 5, vt: 500, rr: 14, ti: 1 };
test("E4: an alarm the learner caused is not scored as an alarm response, even when another answer for it says otherwise", () => {
  const log = [{ t: 0, settings: START, readout: ro({ vte: 500 }), action: "start" }];
  for (let t = 60; t <= 1800; t += 60) log.push({ t, settings: START, readout: ro({}), action: "live" });
  const answers = [{ kind: "alarm", id: "etco2High", correct: true, t: 300, clearedT: 420, selfMade: true }, { kind: "alarm", id: "etco2High", correct: true, t: 900, clearedT: 960, selfMade: false }];
  const r = E.score({ scenario: das(), log, answers });
  assert.equal(r.parts.alarms, null, "not 10/10: " + JSON.stringify(r.parts));
  assert.equal(r.scored.alarms, false);
  assert.match(r.explain.alarms.en, /own changes/);
  assert.equal(r.selfMadeAlarms.length, 1);
});

test("E4: Timing lists every spell off a goal of 5 min or more, not only the longest (SpO2 82 spell)", () => {
  const log = [{ t: 0, settings: START, readout: ro({}), action: "start" }];
  for (let t = 60; t <= 3600; t += 60) {
    const low = t >= 900 && t <= 1260, co2 = t >= 1800 && t <= 2700; // SpO2 82 for 6 min, PaCO2 55 for 15 min
    log.push({ t, settings: START, readout: ro({ spo2: low ? 82 : 94, paco2: co2 ? 55 : 40 }), action: "live" });
  }
  const r = E.score({ scenario: das(), log });
  assert.ok(Array.isArray(r.offGoalSpells), "offGoalSpells");
  assert.deepEqual(r.offGoalSpells.map((x) => x.key), ["spo2", "paco2"]);
  assert.equal(r.offGoalSpells[0].peak, 82);
  assert.ok(r.offGoalSpells.every((x) => x.minutes >= 5 && bi(x.what)));
  const n = r.notes.find((x) => /^Every time off a goal/.test(x.en));
  assert.ok(n && /SpO2 below 92% \(down to 82%\)/.test(n.en) && /PaCO2 above 45/.test(n.en), JSON.stringify(r.notes.map((x) => x.en)));
  assert.ok(bi(n) && noDash(n));
});

test("E4: Kavya B6: goals are not 'met at 0 min' when VT was 10.4 mL/kg at 0 min and only the same-minute change fixed it", () => {
  const set1 = Object.assign({}, START, { vt: 330 });
  const log = [{ t: 0, settings: START, readout: ro({ vte: 500 }), action: "start" }, { t: 0, settings: set1, readout: ro({ vte: 330 }), action: "set:vt" }];
  for (let t = 60; t <= 1800; t += 60) log.push({ t, settings: set1, readout: ro({}), action: "live" });
  const r = E.score({ scenario: das(), log });
  assert.notEqual(r.goals.firstMin, 0, r.explain.time.en);
  assert.ok(!/at 0 min/.test(r.explain.time.en), r.explain.time.en);
  assert.equal(r.goals.firstMin, 1);
});

/* ---------- E5: drift and chain wording ---------- */
test("E5: a worsening after the learner's change is named with its direction, not 'still working'", () => {
  let s = E.init(quiet("postop-normal")); const st0 = s.settings, base = E.readout(s, st0), st = set(s, { fio2: 21 });
  s = E.step(s, st, 600);
  const why = E.whyDrift(s, st, base), r0 = why[0];
  assert.equal(r0.kind, "yourChange");
  assert.match(r0.because.en, /^Your change 10 min ago \(FiO2 40 to 21%\) lowered SpO2 \d+% to \d+%/);
  assert.ok(!/still working/.test(r0.because.en)); assert.ok(bi(r0.because) && noDash(r0.because));
  // an improvement keeps the old wording (r5): the change is still working
  let c = E.init(quiet("postop-normal")); const s1 = set(c, { rr: 8 }); c = E.step(c, s1, 1800); c.changes = [];
  const b2 = E.readout(c, s1), s2 = set(c, { rr: 14 }); c = E.step(c, s2, 1800);
  assert.match(E.whyDrift(c, s2, b2)[0].because.en, /^Your change 30 min ago \(the rate 8 to 14\/min\) is still working: PaCO2 \d+ to \d+/);
});

test("E5: smaller breaths at a faster rate: one dead-space line, never 'more air' next to 'did not fall'", () => {
  const sc = quiet("postop-atelectasis"), s0 = E.init(sc), stB = s0.settings, stA = set(s0, { vt: 300, rr: 24 });
  const b = E.step(s0, stB, 1800), a = E.step(s0, stA, 1800);
  const why = E.explainDelta(E.abg(b), E.abg(a), stB, stA, b, a).filter((x) => x.param === "PaCO2");
  assert.ok(E.abg(a).PaCO2 > E.abg(b).PaCO2, "CO2 rose with the pair");
  const ds = why.filter((x) => /dead space/i.test(x.plain.en));
  assert.equal(ds.length, 1, JSON.stringify(why.map((x) => x.plain.en)));
  assert.match(ds[0].plain.en, /^Smaller breaths waste more on dead space, so CO2 rose although the air each minute (stayed about the same|rose)\.$/);
  assert.ok(bi(ds[0].plain) && noDash(ds[0].plain));
  assert.ok(!why.some((x) => /did not fall/.test(x.plain.en)));
});

/* ---------- E6: what-if has a lung protection axis ---------- */
test("E6: lowering an injurious VT is 'Safer for the lung; CO2 rises to N: add rate', not only 'makes it worse'", () => {
  const s = E.init(quiet("postop-atelectasis")), w = E.whatIf(s, s.settings, { key: "vt", to: 400 });
  assert.ok(w.lung, "lung axis");
  assert.equal(w.lung.axis, "safer");
  assert.ok(w.lung.vtPerKg.without > 10 && w.lung.vtPerKg.withChange < 8.5, JSON.stringify(w.lung.vtPerKg));
  const pc = w.withChange.gas.paco2;
  assert.ok(pc > 45);
  assert.equal(w.lung.text.en, "Safer for the lung; CO2 rises to " + pc + ": add rate.");
  assert.ok(bi(w.lung.text) && noDash(w.lung.text));
  // raising VT into injury is harder on the lung; a change that does not touch the lung has no axis
  const up = E.whatIf(E.init(quiet("postop-normal")), E.init(quiet("postop-normal")).settings, { key: "vt", to: 700 });
  assert.equal(up.lung.axis, "harder"); assert.match(up.lung.text.en, /^Harder on the lung/);
  const f = E.whatIf(s, s.settings, { key: "fio2", to: 70 });
  assert.equal(f.lung.axis, null); assert.equal(f.lung.text, null);
});

/* ---------- E8: the PEEP and blood flow line is plain ---------- */
test("E8: PEEP what-if: 'higher pressure squeezes blood flow ... less oxygen is carried to the body' (Kavya B5)", () => {
  const OLD = /holds less oxygen|holds more oxygen|बची रहती/;
  const s = E.init(quiet("postop-normal")), w = E.whatIf(s, s.settings, { key: "peep", to: 14 });
  const co = w.because.find((x) => /heart pumps/.test(x.plain.en));
  assert.ok(co, JSON.stringify(w.because.map((x) => x.plain.en)));
  assert.equal(co.plain.en, "Higher pressure in the chest squeezes blood flow, so the heart pumps less. Less blood flows, so less oxygen is carried to the body.");
  assert.ok(bi(co.plain) && noDash(co.plain) && !OLD.test(co.plain.en + co.plain.hi), co.plain.hi);
  const a = E.init(quiet("asthma")), u = E.whatIf(a, a.settings, { key: "peep", to: 0 }).because.find((x) => /heart pumps/.test(x.plain.en));
  assert.ok(u && !OLD.test(u.plain.en + u.plain.hi), JSON.stringify(u && u.plain));
  assert.match(u.plain.en, /more oxygen is carried to the body/);
});

/* ---------- E9: bagging over, and suction reopens the lung over minutes ---------- */
function plugged() {
  let s = E.init(quiet("postop-normal")); let st = s.settings;
  s = E.step(E.inject(E.inject(s, "plug"), "plug"), st, 240);
  st = set(s, { fio2: 50 }); s = E.step(s, st, 300);
  s = E.step(E.inject(E.inject(s, "secretions", { factor: 4 }), "plug"), st, 240);
  return { s, st };
}
test("E9: after a bag ends with SpO2 still below goal: 'Bagging over: set the ventilator FiO2 to 100% now, or keep bagging'", () => {
  let { s, st } = plugged();
  assert.equal(E.readout(s, st).bagOver, null, "no prompt before any bagging");
  s = E.step(E.act(s, "bag100"), st, 30);
  assert.equal(E.readout(s, st).bagOver, null, "no prompt while bagging");
  s = E.step(s, st, 50); // the 60 s bag has ended
  const r = E.readout(s, st);
  assert.ok(r.vitals.spo2 < 94, "SpO2 still below goal: " + r.vitals.spo2);
  assert.ok(r.bagOver, "bagOver prompt");
  assert.equal(r.bagOver.text.en, "Bagging over: set the ventilator FiO2 to 100% now, or keep bagging.");
  assert.ok(bi(r.bagOver.text) && noDash(r.bagOver.text)); assert.equal(r.bagOver.fio2To, 100);
  const a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.ok(a.bagOver, "the low SpO2 card carries it");
  if (a.spo2Band === "mild") assert.deepEqual([a.primary.key, a.primary.to], ["fio2", 100]);
  else assert.ok((a.primary.kind === "action" && a.primary.id === "bag100") || a.primary.to === 100, JSON.stringify(a.primary));
  // FiO2 100 set: the prompt goes
  assert.equal(E.readout(s, set(s, { fio2: 100 })).bagOver, null);
});

test("E9: suction clears the plug, but SpO2 does not jump 86 to 100 in one step: the lung reopens over minutes", () => {
  let { s, st } = plugged();
  const sp0 = E.readout(s, st).vitals.spo2;
  assert.ok(sp0 <= 88, "plugged: " + sp0);
  s = E.step(E.act(s, "suction"), st, 60);
  const sp1 = E.readout(s, st).vitals.spo2;
  assert.ok(sp1 > sp0 && sp1 <= 94, "one minute after suction: " + sp1);
  s = E.step(s, st, 240);
  assert.ok(E.readout(s, st).vitals.spo2 >= 94, "back on goal within 5 minutes");
});

test("R6: every new bilingual field is short, dash free and has Hindi", () => {
  const out = [], short = (o) => o.en.split(/(?<=[.!?:;])\s+/).every((x) => x.split(/\s+/).length <= 22);
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (typeof x.en === "string" && "hi" in x) out.push(x); for (const k in x) walk(x[k]); } };
  const { s, st } = pinkiAcid(5); walk(E.alarms(s, st));
  let p = plugged(); let b = E.step(E.act(p.s, "bag100"), p.st, 80); walk(E.readout(b, p.st)); walk(E.alarms(b, p.st));
  const d = E.init(quiet("postop-atelectasis")); walk(E.whatIf(d, d.settings, { key: "vt", to: 400 }).lung);
  assert.ok(out.length > 20);
  for (const o of out) { assert.ok(bi(o) || o.en === o.hi, JSON.stringify(o)); assert.ok(short(o), "over 22 words: " + o.en); assert.ok(noDash(o)); }
});

/* ---------- E7: one FiO2 step is 10 points everywhere ---------- */
test("E7: the mild low SpO2 card raises FiO2 one step, 40 to 50 (Pinki B2), and E.fio2Step is exported", () => {
  let s = E.init(quiet("postop-normal")); const st = s.settings;
  s = E.step(E.inject(E.inject(s, "plug"), "plug"), st, 240);
  const a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.equal(a.spo2Band, "mild");
  assert.deepEqual([a.primary.key, a.primary.to], ["fio2", 50]);
  assert.match(a.fio2Line.en, /from 40% to 50%/);
  assert.equal(typeof E.fio2Step, "function");
  assert.deepEqual([21, 40, 55, 60, 95, 100].map((f) => E.fio2Step(f)), [31, 50, 65, 70, 100, 100]);
});

/* ---------- E2: blood gas reading ---------- */
test("E2: Pinki B1: pH 7.22, PaCO2 57, HCO3 22.6 is a respiratory acidosis, not 'two causes', and no lactate line", () => {
  const g = E.interpretAbg({ pH: 7.22, PaCO2: 57, HCO3: 22.6, PaO2: 80, FiO2: 0.6, lactate: 2.2 });
  assert.equal(g.acidBase, "respiratoryAcidosis");
  assert.equal(g.mixed, false);
  assert.ok(!/two causes|low bicarbonate|Lactate/i.test(g.plain.en), g.plain.en);
  assert.ok(!/Lactate/i.test(g.detail.en), g.detail.en);
  // Sameer (Mrs Das, own bicarbonate about 22 at this CO2): HCO3 21.5 is not a low-bicarbonate mixed acidosis either
  assert.equal(E.interpretAbg({ pH: 7.24, PaCO2: 58, HCO3: 21.5, hco3Base: 22.2 }).acidBase, "respiratoryAcidosis");
  // without a baseline, 24 carried by the acute rise is expected: 4 or more below it is a metabolic part (ARDS case abg-15)
  assert.equal(E.interpretAbg({ pH: 7.15, PaCO2: 59, HCO3: 20.1, lactate: 3.8 }).acidBase, "mixedAcidosis");
  // abg-05: a metabolic acidosis whose CO2 is not low enough is not "high CO2"
  const w = E.interpretAbg({ pH: 7.3, PaCO2: 40, HCO3: 19.3 });
  assert.equal(w.acidBase, "mixedAcidosis"); assert.ok(!/high CO2/.test(w.plain.en), w.plain.en);
});

test("E2: the metabolic part of a mixed acidosis needs HCO3 below 20, or 4 below the patient's own baseline", () => {
  const m = E.interpretAbg({ pH: 7.12, PaCO2: 58, HCO3: 18, lactate: 4.1 });
  assert.equal(m.acidBase, "mixedAcidosis");
  assert.ok(m.lactic); assert.equal(m.lactate, 4.1, "the lactate the line quotes is exposed");
  assert.match(m.plain.en, /Lactate 4\.1 is high/);
  // a COPD patient whose own HCO3 is 32: 26 with PaCO2 70 is a metabolic acidosis on top
  const c = E.interpretAbg({ pH: 7.15, PaCO2: 70, HCO3: 26, hco3Base: 32 });
  assert.equal(c.acidBase, "mixedAcidosis");
  assert.equal(E.interpretAbg({ pH: 7.15, PaCO2: 70, HCO3: 26 }).acidBase, "respiratoryAcidosis", "no baseline: 26 is not low");
  // a pure metabolic acidosis keeps its reading and its lactate line
  const d = E.interpretAbg({ pH: 7.21, PaCO2: 25, HCO3: 10, lactate: 3 });
  assert.equal(d.acidBase, "metabolicAcidosis"); assert.ok(d.lactic);
});

test("E2: the acid blood / oxygen curve line is shown only when the shown pH is below 7.35", () => {
  const s = E.init(quiet("postop-atelectasis")), g = E.abg(s);
  assert.equal(g.pH, 7.35);
  assert.ok(!g.curveNoteShort || !/Acid|अम्लीय/.test(g.curveNoteShort.en + g.curveNoteShort.hi), JSON.stringify(g.curveNoteShort));
  assert.ok(!g.curveNote || !/acid blood/i.test(g.curveNote.en), JSON.stringify(g.curveNote));
  // an acid gas still explains the shift
  let a = E.init(quiet("postop-atelectasis")); const st = set(a, { vt: 300 }); a = E.step(a, st, 1200);
  const ga = E.abg(a); assert.ok(ga.pH < 7.3);
  assert.match(ga.curveNoteShort.en, /^Acid blood/);
  // the model passes the patient's own bicarbonate (carried to this PaCO2 by buffering) as the baseline, so a CO2 rise
  // the learner made reads as a respiratory acidosis only
  assert.ok(Math.abs(ga.interp.hco3Base - ga.HCO3) < 0.3, JSON.stringify([ga.interp.hco3Base, ga.HCO3]));
  assert.equal(ga.interp.acidBase, "respiratoryAcidosis");
  assert.ok(!/two causes|Lactate/.test(ga.interp.plain.en), ga.interp.plain.en);
});
