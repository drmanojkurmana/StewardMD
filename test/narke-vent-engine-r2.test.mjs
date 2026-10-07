// Narkē Ventilator Lab engine, round-2 persona fixes (E1 to E8 in the round-2 fix brief).
// Each test reproduces a finding from the Sameer and Pinki persona runs, then checks the fix.
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

// A run driver that logs like the UI: a sample every minute, a "set:" sample at each change, a "finish" at the end.
function runner(sc, override) {
  let s = E.init(sc, override); const st = Object.assign({}, s.settings), log = [], answers = [];
  const snap = (action) => log.push({ t: s.t, settings: Object.assign({}, st), readout: E.readout(s, st), action });
  snap("start");
  return {
    st, log, answers,
    get s() { return s; },
    adv(secs, every = 60) { for (let k = 0; k < secs; k += every) { s = E.step(s, st, every); snap("live"); } },
    set(ch) { Object.assign(st, ch); snap("set:" + Object.keys(ch).join(",")); },
    abg() { answers.push({ kind: "abg", correct: true }); snap("abg"); },
    score(extra) { snap("finish"); return E.score(Object.assign({ scenario: sc, log, answers }, extra || {})); }
  };
}

/* E1: a preset VT the learner never touched is not an "unsafe moment", and 10:00 itself is inside the grace window */
test("E1: the start VT (10.4 mL/kg, never touched) is not an unsafe moment; it is named in the notes instead", () => {
  const sc = quiet("postop-atelectasis"), r = runner(sc);
  r.adv(3600);
  const x = r.score();
  assert.equal(x.unsafeList.filter((u) => /^VT/.test(u.what.en)).length, 0, JSON.stringify(x.unsafeList));
  assert.equal(x.parts.unsafe, 0);
  assert.ok(x.notes.some((n) => /start VT was 10\.4 mL\/kg/.test(n.en) && bi(n)), "the note names the start VT");
  assert.ok(x.parts.protection < 20, "protection still loses points for the large start VT");
});

test("E1: a VT the learner set counts only strictly after the first 10 minutes", () => {
  const sc = { id: "x", patient: { sex: "F", heightCm: 155 }, goals: { spo2: [92, 96], paco2: [35, 45], vtPerKg: [6, 8] }, timeline: [] };
  const rd = { vitals: { spo2: 94, map: 80 }, vent: { pplat: 25, drivingP: 12, vte: 500, autoPeep: 0 }, gas: { ph: 7.4, paco2: 40 }, flags: [] };
  const start = { mode: "acvc", vt: 330 }, mine = { mode: "acvc", vt: 500 };
  const log = [{ t: 0, settings: start, readout: Object.assign({}, rd, { vent: Object.assign({}, rd.vent, { vte: 330 }) }) }, { t: 600, settings: mine, readout: rd }];
  assert.equal(E.score({ scenario: sc, log }).parts.unsafe, 0, "t = 600 s is still the first 10 minutes");
  log.push({ t: 660, settings: mine, readout: rd });
  const x = E.score({ scenario: sc, log });
  assert.equal(x.parts.unsafe, -5);
  assert.match(x.unsafeList[0].what.en, /^VT 10\.4 mL\/kg/);
});

test("E3: one long unsafe episode costs by its length, not 5 per log sample", () => {
  const sc = { id: "x", patient: { sex: "M", heightCm: 175 }, goals: { spo2: [88, 95], paco2: [35, 45] }, timeline: [] };
  const rd = (spo2) => ({ vitals: { spo2, map: 80 }, vent: { pplat: 25, drivingP: 12, vte: 420, autoPeep: 0 }, gas: { ph: 7.3, paco2: 40 }, flags: [] });
  const log = [{ t: 0, settings: { mode: "acvc" }, readout: rd(92) }];
  for (let t = 660; t <= 960; t += 60) log.push({ t, settings: { mode: "acvc" }, readout: rd(80) }); // 6 samples over 5 min
  const x = E.score({ scenario: sc, log });
  assert.equal(x.unsafeList.length, 1);
  assert.equal(x.parts.unsafe, -5, "one 5 min episode is -5, not -30");
  for (let t = 1020; t <= 1920; t += 60) log.push({ t, settings: { mode: "acvc" }, readout: rd(80) }); // the same episode, now 21 min
  assert.equal(E.score({ scenario: sc, log }).parts.unsafe, -15, "5 per episode plus 5 per further 10 min");
});

/* E2: "all goals met together at 37 min" while the end SpO2 is 89 and not met */
test("E2: goals met once but lost by the end are reported honestly, with the end misses named", () => {
  const sc = { id: "x", patient: { sex: "M", heightCm: 168 }, goals: { spo2: [92, 96], paco2: [35, 45], pplatMax: 30, drivingMax: 15, vtPerKg: [6, 8] }, timeline: [] };
  const rd = (spo2) => ({ vitals: { spo2, map: 80 }, vent: { pplat: 22, drivingP: 12, vte: 450, autoPeep: 0 }, gas: { ph: 7.38, paco2: 40 }, flags: [] });
  const set = { mode: "acvc", fio2: 80 }, log = [];
  for (let t = 0; t <= 4200; t += 300) log.push({ t, settings: set, readout: rd(t >= 2400 && t <= 2700 ? 93 : 89) });
  const x = E.score({ scenario: sc, log });
  assert.equal(x.goals.firstMin, 40);
  assert.equal(x.goals.metAtEnd, false);
  assert.match(x.explain.time.en, /met together at 40 min, but not at the end: SpO2 89% \(goal 92 to 96\)/);
  assert.ok(bi(x.explain.time));
  assert.deepEqual(x.goals.missedAtEnd.map((m) => m.key), ["spo2"]);
  assert.ok(x.parts.time <= 5, "half credit at most when the goals did not hold");
});

/* E3: Pinki: every end target met (SpO2 93, PaCO2 39, Pplat 18, DP 11, VT 6.3), yet 29/100 */
test("E3: a run that ends with every goal met and no unsafe moment scores well", () => {
  const sc = quiet("postop-atelectasis"), r = runner(sc);
  r.adv(1800); r.set({ fio2: 100 }); r.adv(1800); r.abg();
  r.set({ vt: 330, peep: 10, fio2: 50, rr: 24 }); r.adv(3600); r.abg();
  const x = r.score(), end = r.log[r.log.length - 1].readout;
  assert.ok(end.vitals.spo2 >= 92 && end.vitals.spo2 <= 96 && end.gas.paco2 >= 35 && end.gas.paco2 <= 45 && end.vent.pplat <= 30, "the run ends on target");
  assert.equal(x.parts.unsafe, 0);
  assert.equal(x.goals.metAtEnd, true);
  assert.match(x.explain.time.en, /still held at the end/);
  assert.ok(x.total >= 70, "score " + x.total + " " + JSON.stringify(x.parts));
});

test("E3: time on target is weighted by sim time, so a +30 min skip counts as 30 minutes", () => {
  const sc = { id: "x", patient: { sex: "M", heightCm: 175 }, goals: { spo2: [92, 96], paco2: [35, 45] }, timeline: [] };
  const rd = (spo2) => ({ vitals: { spo2, map: 80 }, vent: { pplat: 22, drivingP: 12, vte: 420, autoPeep: 0 }, gas: { ph: 7.4, paco2: 40 }, flags: [] });
  // 10 min of minute samples off target, then one +60 min skip that ends on target. Counting samples gave 1 in 11 (9%);
  // by time the skip is half credited (linear between its ends), so 40 to 50%.
  const log = [];
  for (let t = 0; t <= 1200; t += 60) log.push({ t, settings: { mode: "acvc", fio2: 40 }, readout: rd(88) });
  log.push({ t: 4800, settings: { mode: "acvc", fio2: 40 }, readout: rd(94) });
  const x = E.score({ scenario: sc, log });
  assert.ok(/on target 4\d% of the time/.test(x.explain.oxygenation.en), x.explain.oxygenation.en);
});

/* E4: "SaO2 90 at PaO2 78 (should be about 95)" */
test("E4: the oxygen curve is Severinghaus 1979 at standard conditions", () => {
  const sat = E.oxygen.sat;
  assert.ok(Math.abs(sat(26.86, 7.4, 37, 40) - 0.5) < 0.005, "P50 26.9");
  assert.equal(Math.round(sat(40, 7.4, 37, 40) * 100), 75);
  assert.equal(Math.round(sat(60, 7.4, 37, 40) * 100), 91);
  assert.equal(Math.round(sat(78, 7.4, 37, 40) * 100), 95, "PaO2 78 gives 95% on a normal curve");
  assert.equal(Math.round(sat(100, 7.4, 37, 40) * 1000), 977);
  assert.ok(Math.abs(E.oxygen.p50(7.4, 37, 40) - 26.86) < 0.01);
});

test("E4: pneumonia's SaO2 90 at PaO2 78 is the Bohr and fever shift, and the gas says so", () => {
  const s = E.init(quiet("pneumonia")), a = E.abg(s), r = E.readout(s, s.settings);
  assert.equal(a.PaO2, 78); assert.equal(a.SaO2, 90); assert.equal(r.vitals.spo2, a.SaO2, "SpO2 and SaO2 agree");
  assert.ok(a.P50 > 31 && a.P50 < 36, "right shifted P50 " + a.P50);
  assert.ok(bi(a.curveNote), "curve note in en and hi");
  assert.match(a.curveNote.en, /Acid blood \(pH 7\.23\) and fever \(39 C\) shift the oxygen curve right/);
  assert.match(a.curveNote.en, /a normal curve gives 95%/);
  assert.equal(r.gas.p50, a.P50);
  const n = E.init(quiet("postop-normal"));
  assert.equal(E.abg(n).curveNote, null, "no note on a near normal curve");
});

/* E5: no alarm at EtCO2 68 with a low minute volume; alarm priorities follow IEC 60601-1-8 */
test("E5: hypoventilation raises a High EtCO2 alarm (medium priority) once CO2 climbs", () => {
  const sc = quiet("neuromuscular-gbs"); let s = E.init(sc); const st = Object.assign({}, s.settings, { rr: 6 });
  const at0 = E.alarms(s, st).map((a) => a.id);
  assert.ok(at0.includes("veLow"), "low minute volume fires at once: " + at0);
  s = E.step(s, st, 1800);
  const r = E.readout(s, st), al = E.alarms(s, st), et = al.find((a) => a.id === "etco2High");
  assert.ok(r.vitals.etco2 >= 60, "EtCO2 " + r.vitals.etco2);
  assert.ok(et, "High EtCO2 alarm at EtCO2 " + r.vitals.etco2 + ": " + al.map((a) => a.id));
  assert.equal(et.severity, "warn"); assert.equal(et.priority, "medium"); assert.ok(bi(et.label));
  assert.equal(et.checklist[0].id, "patient");
  assert.ok(et.checklist.some((c) => c.id === "abg") && et.checklist.some((c) => c.id === "senior"));
});

test("E5: the EtCO2 limit is the patient's: COPD alarms at his presenting CO2, not once he is back near his usual", () => {
  const sc = quiet("copd");
  assert.equal(sc.monitor.etco2High, 65);
  let s = E.init(sc); const st = Object.assign({}, s.settings, { vt: 460, rr: 12, ti: 0.8, fio2: 35 });
  assert.ok(E.readout(s, st).vitals.etco2 > 65 && E.alarms(s, st).some((a) => a.id === "etco2High"), "presenting CO2 alarms");
  s = E.step(s, st, 900);
  assert.ok(!E.alarms(s, st).some((a) => a.id === "etco2High"), "EtCO2 " + E.readout(s, st).vitals.etco2 + " is inside his limit");
  const n = E.init(quiet("postop-normal"));
  assert.ok(!E.alarms(n, n.settings).some((a) => a.id === "etco2High"), "a normal patient does not alarm");
});

test("E5: the five alarms a learner must meet can all be produced, each high or medium priority with a checklist", () => {
  const seen = {};
  const grab = (s, st) => E.alarms(s, st).forEach((a) => { seen[a.id] = a; });
  // low SpO2: pneumonia at start
  let s = E.init(quiet("pneumonia")); grab(s, s.settings);
  // disconnect: a scripted disconnect
  s = E.inject(E.init(quiet("postop-normal")), "disconnect", { duration: 60 }); s = E.step(s, s.settings, 10); grab(s, s.settings);
  // apnoea: pressure support with no drive to breathe
  s = E.init(quiet("postop-normal")); let st = Object.assign({}, s.settings, { mode: "psv", ps: 10 });
  s = E.inject(s, "sedationDeep"); s = E.step(s, st, 60); grab(s, st);
  // low minute volume and high EtCO2: a low rate in a paralysed patient
  s = E.init(quiet("neuromuscular-gbs")); st = Object.assign({}, s.settings, { rr: 6 }); grab(s, st); s = E.step(s, st, 1800); grab(s, st);
  for (const id of ["spo2Low", "disconnect", "apnoea", "veLow", "etco2High"]) {
    const a = seen[id];
    assert.ok(a, id + " can be produced: " + Object.keys(seen));
    assert.ok(["high", "medium"].includes(a.priority), id + " priority " + a.priority);
    assert.equal(a.priority, a.severity === "danger" ? "high" : "medium", id + " priority follows severity");
    assert.ok(a.checklist.length >= 3 && a.checklist.every((c) => bi(c.text)), id + " checklist");
    assert.equal(a.checklist[0].id === "patient" || a.checklist[1].id === "patient", true, id + " patient first");
    assert.ok(a.primary && bi(a.primary.label) && a.primary.key !== "pPeakHigh", id + " primary");
  }
  ["disconnect", "apnoea", "veLow"].forEach((id) => assert.equal(seen[id].severity, "danger", id + " keeps its high priority"));
});

test("E5: no existing alarm is downgraded: danger stays danger (high), warn stays warn (medium)", () => {
  const pairs = [];
  for (const sc of S.scenarios) {
    let s = E.init(Object.assign(JSON.parse(JSON.stringify(sc)), { timeline: [] }));
    const st = Object.assign({}, s.settings, { rr: 6, peep: 16 });
    for (let k = 0; k < 4; k++) { E.alarms(s, st).forEach((a) => pairs.push([a.id, a.severity, a.priority])); s = E.step(s, st, 600); }
  }
  const HIGH = { pPeakHigh: 1, veLow: 1, apnoea: 1, fio2Low: 1, disconnect: 1, hrLow: 1 };
  pairs.forEach(([id, sev, pr]) => {
    if (HIGH[id]) assert.equal(sev, "danger", id);
    assert.equal(pr, sev === "danger" ? "high" : "medium", id + " " + sev + " " + pr);
  });
  assert.ok(pairs.length > 20);
});

/* E6: pneumonia: PEEP up made SpO2 and BP worse, SpO2 stuck below goal, no hint */
test("E6: consolidated pneumonia does not recruit: PEEP lowers BP without oxygen gain, and the engine says why", () => {
  const sc = quiet("pneumonia");
  let s = E.init(sc); const st = Object.assign({}, s.settings);
  const r0 = E.readout(s, st);
  st.peep = 10; s = E.step(s, st, 900);
  const r1 = E.readout(s, st);
  assert.ok(r1.vitals.spo2 <= r0.vitals.spo2 + 1, "little or no oxygen gain: " + r0.vitals.spo2 + " to " + r1.vitals.spo2);
  assert.ok(r1.vitals.map < r0.vitals.map, "BP falls: " + r0.vitals.map + " to " + r1.vitals.map);
  const h = r1.oxygenHelp;
  assert.ok(h, "a hint while SpO2 is below the goal");
  assert.equal(h.kind, "notRecruiting");
  assert.match(h.reason.en, /not recruiting/); assert.ok(bi(h.reason) && h.next.every(bi));
  assert.ok(h.next.some((x) => /prone/.test(x.en)) && h.callSenior === true);
  assert.ok(h.shunt.fixed > h.shunt.collapsed);
  // contrast: ARDS has a large recruitable share
  const a = E.init(quiet("ards")), ha = E.readout(a, a.settings).oxygenHelp;
  assert.equal(ha.kind, "recruitable");
  // secretions name the obstruction first
  const p = E.inject(E.init(quiet("pneumonia")), "secretions");
  assert.equal(E.readout(p, p.settings).oxygenHelp.kind, "secretions");
  // on goal: no hint
  const n = E.init(quiet("postop-normal"));
  assert.equal(E.readout(n, n.settings).oxygenHelp, null);
});

/* E7: alarm cards lead with the bedside fix; the low SpO2 card knows FiO2 is already 100 */
test("E7: the low SpO2 alarm carries bag, suction, DOPE, probe and circuit, and a state-aware FiO2 line", () => {
  let s = E.init(quiet("pneumonia")); const st = Object.assign({}, s.settings);
  let a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  const ids = a.checklist.map((c) => c.id);
  ["patient", "probe", "circuit", "fio2", "suction", "dope", "bag", "senior"].forEach((k) => assert.ok(ids.includes(k), "step " + k));
  assert.equal(ids[0], "patient");
  assert.ok(a.actions.includes("bag100") && a.actions.includes("suction"), "bedside actions " + a.actions);
  assert.equal(a.checklist.find((c) => c.id === "suction").action, "suction");
  assert.equal(a.checklist.find((c) => c.id === "bag").action, "bag100");
  // round 4 (E6): SpO2 90 is a mild fall: one FiO2 step after the probe check (it was 100% at once before)
  assert.match(a.fio2Line.en, /SpO2 90% is a mild fall\. After the probe check, raise FiO2 one step, from 70% to 80%/);
  assert.deepEqual([a.primary.kind, a.primary.key, a.primary.to], ["setting", "fio2", 80]);
  st.fio2 = 100;
  s = E.inject(s, "secretions"); s = E.inject(s, "plug");
  a = E.alarms(s, st).find((x) => x.id === "spo2Low");
  assert.match(a.fio2Line.en, /already 100%/); assert.ok(bi(a.fio2Line));
  assert.equal(a.checklist.find((c) => c.id === "fio2").text.en, a.fio2Line.en);
  assert.equal(a.primary.kind, "action"); assert.equal(a.primary.id, "suction", "a plug: the bedside fix is suction");
  assert.ok(a.callNow && bi(a.callWhy), "call the senior: SpO2 below target on FiO2 100");
});

test("E7: the high pressure alarm leads with suction, never with the alarm limit", () => {
  let s = E.init(quiet("postop-normal")); const st = Object.assign({}, s.settings, { pPeakHigh: 25 });
  s = E.inject(s, "secretions", { factor: 4 });
  const a = E.alarms(s, st).find((x) => x.id === "pPeakHigh");
  assert.ok(a, "alarm fires");
  assert.deepEqual([a.primary.kind, a.primary.id], ["action", "suction"]);
  const ids = a.checklist.map((c) => c.id);
  assert.deepEqual(ids.slice(0, 2), ["patient", "suction"]);
  assert.ok(ids.includes("dope") && ids.includes("bag") && ids.includes("noLimit") && ids.indexOf("senior") === ids.length - 1);
  assert.equal(a.actions[0], "suction");
  assert.equal(a.priority, "high");
  // every engine alarm id has a plan through E.alarmPlan too (the UI uses it for its own monitor alarms)
  for (const id of ["pPeakHigh", "pPlatHigh", "vtLow", "veLow", "veHigh", "apnoea", "rrHigh", "fio2Low", "fio2High", "peepLow", "peepHigh",
    "disconnect", "autoPeep", "dyssync", "peepSetHigh", "spo2Low", "mapLow", "hrHigh", "hrLow", "etco2High"]) {
    const p = E.alarmPlan(s, id, st);
    assert.ok(p.checklist.length >= 2 && p.checklist.every((c) => bi(c.text)) && p.primary && bi(p.primary.label), id);
  }
});

/* E8: a tutorial run must not count as the hub's best score */
test("E8: a tutorial run is scored as practice and does not count toward the best score", () => {
  // round 5: a patient already on target never counts (nothing to improve), so use one with something to fix
  const sc = quiet("postop-atelectasis"), r = runner(sc);
  r.adv(600);
  const x = r.score({ tutorial: true }), y = E.score({ scenario: sc, log: r.log, answers: [] });
  assert.equal(x.practice, true); assert.equal(x.countsForBest, false);
  assert.ok(/Practice run/.test(x.notes[0].en) && bi(x.notes[0]));
  assert.equal(y.practice, false); assert.equal(y.countsForBest, true);
});

// Round 3 engine copy fixes.
test("R3: curveNote reads as a sentence in both languages", () => {
  const m = E.abg(E.init(quiet("pneumonia"))).curveNote;
  assert.ok(m, "acid blood and fever shift the curve");
  assert.ok(/^[A-Z]/.test(m.en), m.en); assert.ok(/[.]$/.test(m.en)); assert.ok(bi(m));
});

test("R3: explainDelta never says a quantity went from X to the same X", () => {
  const re = /from (-?[\d.]+)%? to (-?[\d.]+)/g;
  for (const id of ["ards", "copd", "postop-normal", "neuromuscular-gbs"]) {
    let a = E.init(quiet(id)); const st = Object.assign({}, a.settings);
    a = E.step(a, st, 600);
    for (const ch of [{ key: "fio2", to: 100 }, { key: "peep", to: 14 }, { key: "rr", to: 26 }, { key: "vt", to: 300 }]) {
      const w = E.whatIf(a, st, ch);
      for (const x of w.because) { let m; re.lastIndex = 0; while ((m = re.exec(x.because.en))) assert.notEqual(m[1], m[2], id + " " + x.because.en); }
    }
  }
  const a = E.init(quiet("ards")), st = Object.assign({}, a.settings), b = E.step(a, st, 600);
  assert.equal(E.explainDelta(E.abg(b), E.abg(b), st, st, b, b).length, 0);
});

test("R3: every bilingual text the engine and scenarios emit has en and hi", () => {
  const bad = [];
  const walk = (x, p) => {
    if (Array.isArray(x)) x.forEach((v) => walk(v, p));
    else if (x && typeof x === "object") {
      if ("en" in x || "hi" in x) {
        const nameOnly = !/ /.test(x.en || "") && x.en === x.hi; // a bare name such as "pH" is the same in both
        if (!(typeof x.en === "string" && x.en.trim() && typeof x.hi === "string" && x.hi.trim()) || (!nameOnly && !/[ऀ-ॿ]/.test(x.hi))) bad.push(p + " " + JSON.stringify(x).slice(0, 120));
      }
      for (const k in x) walk(x[k], p + "." + k);
    }
  };
  const ids = ["pPeakHigh", "pPlatHigh", "vtLow", "veLow", "veHigh", "apnoea", "rrHigh", "fio2Low", "fio2High", "peepLow", "peepHigh", "disconnect", "autoPeep", "dyssync", "peepSetHigh", "spo2Low", "mapLow", "hrHigh", "hrLow", "etco2High"];
  for (const sc0 of S.scenarios) {
    walk(sc0, sc0.id + ".scenario");
    let s = E.init(JSON.parse(JSON.stringify(sc0))), prev = s; const st = Object.assign({}, s.settings);
    for (let i = 0; i < 40; i++) {
      s = E.step(s, st, 120);
      walk(E.readout(s, st), sc0.id + ".readout"); walk(E.abg(s), sc0.id + ".abg"); walk(E.alarms(s, st), sc0.id + ".alarms");
      walk(E.whyDrift(prev, s), sc0.id + ".drift"); walk(E.suggestActions(s, E.alarms(s, st)), sc0.id + ".sug"); prev = s;
    }
    for (const id of ids) walk(E.alarmPlan(s, id, st), sc0.id + ".plan." + id);
    for (const [key, to] of [["fio2", 100], ["peep", 14], ["vt", 300], ["rr", 28]]) walk(E.whatIf(s, st, { key, to }), sc0.id + ".whatif." + key);
  }
  assert.deepEqual(bad, []);
});

test("R3: the pPeakHigh hold step is one short line", () => {
  const s = E.init(quiet("postop-normal")), p = E.alarmPlan(s, "pPeakHigh", s.settings);
  const hold = p.checklist[2];
  assert.equal(hold.id, "peakPlat");
  assert.ok(hold.text.en.length <= 100, hold.text.en.length + " " + hold.text.en);
  assert.ok(!/[–—]/.test(hold.text.en + hold.text.hi) && bi(hold.text));
});
