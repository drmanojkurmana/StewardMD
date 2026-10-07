// Narkē Ventilator Lab physiology engine (narke-models/vent-engine.js): API contract, textbook anchors, physiology
// property tests across modes and scenarios, alarms, explanations, determinism, language and ES5 rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { STRATEGIES, CASES, caseState } from "./narke-vent-strategies.mjs";
const require = createRequire(import.meta.url);
const file = fileURLToPath(new URL("../narke-models/vent-engine.js", import.meta.url));
const E = require(file);
const src = readFileSync(file, "utf8");
const SC = JSON.parse(readFileSync(new URL("../narke/vent/scenarios.json", import.meta.url), "utf8")).scenarios;
const LEARN = JSON.parse(readFileSync(new URL("../narke/vent/learn.json", import.meta.url), "utf8"));
const byId = (id) => JSON.parse(JSON.stringify(SC.find((s) => s.id === id)));
const quiet = (id) => { const s = byId(id); s.timeline = []; return s; };
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

// Steady state: init with settings, then run 3 h with no timeline events.
function steady(sc, set, secs = 10800) {
  if (typeof sc === "string") sc = quiet(sc);
  let s = E.init(sc, set);
  const st = Object.assign({}, s.settings);
  s = E.step(s, st, secs);
  return { s, st, r: E.readout(s, st) };
}
// Property tests use a milder, more recruitable copy of the content ARDS lung so their effects are large.
const ardsMild = () => { const s = quiet("ards"); s.lung.c = 40; s.lung.upperInflection = 30; s.lung.deadSpace = 0.2; return s; };
const textbook = () => { const s = quiet("postop-normal"); s.lung.shunt = 0.01; s.lung.deadSpace = 0; s.patient.vco2 = 200; return s; };

test("API matches the contract", () => {
  assert.equal(E.id, "vent-engine"); assert.equal(E.kind, "sim-engine"); assert.equal(E.review, "ai_drafted");
  assert.ok(E.sources.length >= 5 && E.sources.every((x) => x.label && (!x.url || /^https:\/\//.test(x.url))));
  assert.deepEqual(Object.keys(E.MODES).sort(), ["acpc", "acvc", "aprv", "cpap", "niv", "pc", "prvc", "psv", "simv", "vc"]);
  for (const [k, m] of Object.entries(E.MODES)) {
    assert.equal(m.id, k); assert.ok(m.title.en && m.title.hi && m.level >= 1 && m.level <= 4);
    for (const c of m.controls) assert.ok(E.SETTINGS[c], k + " control " + c);
  }
  for (const k of ["fio2", "peep", "vt", "rr", "pinsp", "ps", "ti", "ie", "trigType", "trigFlow", "trigPress", "cycle", "rise", "phigh", "plow",
    "thigh", "tlow", "ipap", "epap", "pPeakHigh", "veLow", "veHigh", "apnoea", "rrHigh", "fio2Low", "fio2High", "peepLow", "peepHigh"]) {
    assert.ok(E.SETTINGS[k] && E.SETTINGS[k].label.en && E.SETTINGS[k].label.hi, "setting " + k);
  }
  assert.deepEqual(E.SETTINGS.fio2.min, 21); assert.deepEqual(E.SETTINGS.fio2.max, 100);
  assert.deepEqual(E.CHAIN_STEPS, ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"]);
  for (const f of ["init", "step", "breath", "readout", "abg", "explainDelta", "alarms", "dyssync", "whatIf", "score"]) assert.equal(typeof E[f], "function", f);
  for (const ev of ["secretions", "bronchospasm", "pneumothorax", "disconnect", "hypotension", "fever", "improve"]) assert.ok(E.EVENTS[ev], "event " + ev);
  const s = E.init(byId("postop-normal")), r = E.readout(s, s.settings);
  for (const k of ["spo2", "hr", "sbp", "dbp", "map", "rr", "temp", "etco2"]) assert.equal(typeof r.vitals[k], "number", k);
  for (const k of ["vte", "ve", "ppeak", "pplat", "pmean", "peepTotal", "autoPeep", "drivingP", "cstat", "raw", "rrTotal", "ieActual", "mechPower"]) assert.equal(typeof r.vent[k], "number", k);
  for (const k of ["pao2", "paco2", "ph", "hco3", "sao2", "be", "lactate", "pfRatio", "aaGradient", "vdvt", "shunt"]) assert.equal(typeof r.gas[k], "number", k);
  const a = E.abg(s);
  for (const k of ["pH", "PaCO2", "PaO2", "HCO3", "SaO2", "BE", "lactate", "FiO2", "t"]) assert.equal(typeof a[k], "number", k);
  assert.ok(a.FiO2 > 0 && a.FiO2 <= 1, "abg FiO2 is a fraction");
});

test("textbook anchors: normal lung on air", () => {
  const { r } = steady(textbook(), { mode: "vc", vt: 500, rr: 12, fio2: 21, peep: 5 });
  assert.ok(r.gas.paco2 >= 37 && r.gas.paco2 <= 44, "PaCO2 about 40: " + r.gas.paco2);
  assert.ok(r.gas.pao2 >= 88 && r.gas.pao2 <= 102, "PaO2 about 90 to 100: " + r.gas.pao2);
  assert.ok(r.gas.ph >= 7.37 && r.gas.ph <= 7.43, "pH about 7.40: " + r.gas.ph);
  assert.ok(r.vitals.spo2 >= 96, "SpO2 " + r.vitals.spo2);
  assert.ok(r.vitals.etco2 < r.gas.paco2 && r.gas.paco2 - r.vitals.etco2 <= 5, "normal EtCO2 gap 2 to 5");
  assert.equal(r.vent.autoPeep, 0);
  // doubling alveolar ventilation (same VT, double rate, no trapping) halves PaCO2
  const d = steady(textbook(), { mode: "vc", vt: 500, rr: 24, fio2: 21, peep: 5, ti: 0.8 }).r;
  const ratio = d.gas.paco2 / r.gas.paco2;
  assert.ok(ratio > 0.45 && ratio < 0.56, "ratio " + ratio);
});

test("more rate or more VT lowers PaCO2 and raises pH at steady state", () => {
  for (const id of ["postop-normal", "pneumonia", "trauma-contusion"]) {
    const base = steady(id, { mode: "vc", rr: 14, vt: 450 }).r;
    const rr = steady(id, { mode: "vc", rr: 22, vt: 450 }).r, vt = steady(id, { mode: "vc", rr: 14, vt: 550 }).r;
    for (const x of [rr, vt]) { assert.ok(x.gas.paco2 < base.gas.paco2, id + " PaCO2"); assert.ok(x.gas.ph > base.gas.ph, id + " pH"); }
  }
});

test("FiO2 raises PaO2, with less effect when shunt is high", () => {
  const gain = (sc) => { const lo = steady(sc, { mode: "vc", fio2: 40 }, 1800).r.gas.pao2, hi = steady(sc, { mode: "vc", fio2: 100 }, 1800).r.gas.pao2; assert.ok(hi > lo); return hi - lo; };
  const low = gain(textbook()), high = gain("ards");
  assert.ok(high < low / 4, "ARDS gain " + high + " vs normal " + low);
  const pts = [21, 40, 60, 80, 100].map((f) => steady("ards", { mode: "vc", fio2: f }, 1800).r.gas.pao2);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i] >= pts[i - 1], "monotonic " + pts);
});

test("PEEP: recruitable lung improves P/F and compliance; non-recruitable lung only raises plateau and lowers MAP", () => {
  const set = (peep) => ({ mode: "vc", vt: 420, rr: 26, fio2: 60, peep, ti: 0.8 }); // ARDS PBW 70.6 kg: 6 mL/kg
  const a5 = steady(ardsMild(), set(5)).r, a15 = steady(ardsMild(), set(15)).r;
  assert.ok(a15.gas.pfRatio > a5.gas.pfRatio + 20, "P/F " + a5.gas.pfRatio + " to " + a15.gas.pfRatio);
  assert.ok(a15.vent.cstat > a5.vent.cstat, "compliance " + a5.vent.cstat + " to " + a15.vent.cstat);
  assert.ok(a15.gas.shunt < a5.gas.shunt);
  const nr = ardsMild(); nr.lung.recruitable = 0;
  const n5 = steady(nr, set(5)).r, n15 = steady(nr, set(15)).r;
  assert.ok(n15.vent.pplat >= n5.vent.pplat + 9, "plateau " + n5.vent.pplat + " to " + n15.vent.pplat);
  assert.ok(n15.vitals.map < n5.vitals.map, "MAP " + n5.vitals.map + " to " + n15.vitals.map);
  assert.ok(n15.vent.cstat <= n5.vent.cstat);
  assert.ok(Math.abs(n15.gas.shunt - n5.gas.shunt) < 0.01);
});

test("auto-PEEP: short expiration in a high resistance lung traps gas, more with higher rate", () => {
  const sc = quiet("asthma");
  const ap = [12, 20, 28].map((rr) => { const s = E.init(sc, { mode: "vc", rr, vt: 450, ti: 1.0, peep: 0 }); return E.readout(s, s.settings).vent.autoPeep; });
  assert.ok(ap[0] < ap[1] && ap[1] < ap[2], "auto-PEEP " + ap);
  assert.ok(ap[2] >= 8);
  const n = E.init(textbook(), { mode: "vc", rr: 20, vt: 450, ti: 1.0, peep: 0 });
  assert.ok(E.readout(n, n.settings).vent.autoPeep < 1, "low resistance lung empties");
  // flow-limited lung: external PEEP below about 80% of intrinsic PEEP does not raise total PEEP
  const c0 = E.init(quiet("copd"), { mode: "vc", rr: 24, vt: 600, peep: 0 }), c4 = E.init(quiet("copd"), { mode: "vc", rr: 24, vt: 600, peep: 4 });
  const t0 = E.readout(c0, c0.settings).vent.peepTotal, t4 = E.readout(c4, c4.settings).vent.peepTotal;
  assert.ok(t0 > 6 && Math.abs(t4 - t0) < 0.5, "waterfall " + t0 + " vs " + t4);
});

test("volume control: plateau rises with VT and is higher when compliance is lower", () => {
  const p = (sc, vt) => { const s = E.init(sc, { mode: "vc", vt }); return E.readout(s, s.settings).vent; };
  const a = p(quiet("postop-normal"), 400), b = p(quiet("postop-normal"), 600);
  assert.ok(b.pplat > a.pplat && b.vte === 600 && a.vte === 400);
  const stiff = quiet("postop-normal"); stiff.lung.c = 25;
  assert.ok(p(stiff, 500).pplat > p(quiet("postop-normal"), 500).pplat);
  assert.ok(b.ppeak > b.pplat, "peak above plateau by flow x R");
});

test("pressure control: VT falls when compliance falls; peak stays at the set pressure", () => {
  const v = (c) => { const sc = quiet("postop-normal"); sc.lung.c = c; const s = E.init(sc, { mode: "pc", pinsp: 15, peep: 5 }); return E.readout(s, s.settings).vent; };
  const hi = v(55), lo = v(25);
  assert.ok(lo.vte < hi.vte * 0.7, lo.vte + " vs " + hi.vte);
  assert.equal(hi.ppeak, 20); assert.equal(lo.ppeak, 20);
});

test("PSV: VT depends on patient effort; CPAP gives no inspiratory support", () => {
  const sp = (effort, mode, ps) => { const sc = quiet("postop-normal"); sc.patient.drive = { rate: 14, effort, sedation: 0.2 }; const s = E.init(sc, { mode, ps, peep: 5 }); return E.readout(s, s.settings).vent.vte; };
  assert.ok(sp(10, "psv", 8) > sp(4, "psv", 8) + 40, "effort drives PSV VT");
  assert.ok(sp(6, "psv", 12) > sp(6, "psv", 4), "support adds VT");
  assert.equal(sp(6, "cpap", 0), sp(6, "psv", 0), "CPAP = no support");
  assert.ok(sp(6, "cpap", 10) < sp(6, "psv", 10));
});

test("PRVC converges to the target VT and its pressure tracks compliance", () => {
  const run = (c) => { const sc = quiet("postop-normal"); sc.lung.c = c; let s = E.init(sc, { mode: "vc", vt: 480 }); const st = Object.assign({}, s.settings, { mode: "prvc" }); s = E.step(s, st, 300); return { r: E.readout(s, st), p: s.prvcP }; };
  const a = run(55), b = run(30);
  for (const x of [a, b]) assert.ok(Math.abs(x.r.vent.vte - 480) <= 24, "VT " + x.r.vent.vte);
  assert.ok(b.p > a.p + 3, "stiffer lung needs more pressure: " + a.p + " vs " + b.p);
});

test("alarms fire at their thresholds", () => {
  const ids = (s, st) => E.alarms(s, st).map((a) => a.id);
  let s = E.init(quiet("postop-normal"));
  const st = Object.assign({}, s.settings);
  assert.equal(ids(s, st).length, 0, "no alarms at a sensible start: " + ids(s, st));
  const pk = E.readout(s, st).vent.ppeak;
  assert.ok(ids(s, Object.assign({}, st, { pPeakHigh: Math.floor(pk) })).includes("pPeakHigh"));
  assert.ok(!ids(s, Object.assign({}, st, { pPeakHigh: Math.ceil(pk) + 1 })).includes("pPeakHigh"));
  assert.ok(ids(s, Object.assign({}, st, { veLow: 8 })).includes("veLow"));
  assert.ok(ids(s, Object.assign({}, st, { veHigh: 5 })).includes("veHigh"));
  assert.ok(ids(s, Object.assign({}, st, { rrHigh: 10 })).includes("rrHigh"));
  // a PEEP the learner set at the limit is not a high PEEP alarm (that card is about trapping); measured PEEP above the limit is
  assert.ok(!ids(s, Object.assign({}, st, { peepHigh: 5 })).includes("peepHigh"));
  const tr = E.init(quiet("asthma"));
  assert.ok(ids(tr, Object.assign({}, tr.settings, { peepHigh: 8 })).includes("peepHigh"), "trapping above the limit");
  assert.ok(ids(s, Object.assign({}, st, { vt: 800 })).includes("pPlatHigh") || E.readout(s, Object.assign({}, st, { vt: 800 })).vent.pplat <= 30);
  // apnoea in PSV when sedated: alarm after the apnoea time, then backup ventilation
  const deep = quiet("postop-normal"); deep.patient.drive.sedation = 1;
  let a = E.init(deep, { mode: "vc" });
  const psv = Object.assign({}, a.settings, { mode: "psv", apnoea: 20 });
  a = E.step(a, psv, 5);
  assert.ok(!ids(a, psv).includes("apnoea"));
  a = E.step(a, psv, 20);
  assert.ok(ids(a, psv).includes("apnoea"));
  assert.ok(E.readout(a, psv).flags.some((f) => f.id === "apnoeaBackup"));
  // disconnect event
  const dsc = quiet("ards"); dsc.timeline = [{ t: 10, event: "disconnect", note: { en: "x", hi: "x" }, duration: 60 }];
  let d = E.init(dsc);
  d = E.step(d, d.settings, 20);
  assert.ok(ids(d, d.settings).includes("disconnect"));
  assert.ok(E.readout(d, d.settings).vent.ve === 0);
  d = E.step(d, d.settings, 120);
  assert.ok(!ids(d, d.settings).includes("disconnect"));
  // auto-PEEP alarm
  const ap = E.init(quiet("asthma"), { mode: "vc", rr: 28, peep: 0 });
  assert.ok(ids(ap, ap.settings).includes("autoPeep"));
  // FiO2 delivery failure
  const o2 = quiet("postop-normal"); o2.timeline = [{ t: 0, event: "o2Failure", note: { en: "x", hi: "x" }, duration: 60 }];
  let o = E.step(E.init(o2), E.init(o2).settings, 5);
  assert.ok(ids(o, o.settings).includes("fio2Low"));
});

test("timeline events change the physiology", () => {
  const ev = (event, key, sel) => {
    const sc = quiet("pneumonia"), before = steady(sc, null, 60).r;
    sc.timeline = [{ t: 0, event, note: { en: "x", hi: "x" } }];
    let s = E.init(sc); s = E.step(s, s.settings, 300);
    return [sel(before), sel(E.readout(s, s.settings))];
  };
  let [b, a] = ev("secretions", "ppeak", (r) => r.vent.ppeak); assert.ok(a > b);
  [b, a] = ev("bronchospasm", "ppeak", (r) => r.vent.ppeak); assert.ok(a > b + 5);
  [b, a] = ev("pneumothorax", "map", (r) => r.vitals.map); assert.ok(a < b);
  [b, a] = ev("hypotension", "map", (r) => r.vitals.map); assert.ok(a < b);
  [b, a] = ev("fever", "temp", (r) => r.vitals.temp); assert.ok(a > b);
  [b, a] = ev("improve", "pao2", (r) => r.gas.pao2); assert.ok(a > b);
});

test("explainDelta: reasons match the direction of change and use the model's terms", () => {
  let s0 = E.init(quiet("postop-normal"));
  const st0 = Object.assign({}, s0.settings), st1 = Object.assign({}, st0, { rr: 20, fio2: 80 });
  const s1 = E.step(s0, st1, 1800);
  const ex = E.explainDelta(E.abg(s0), E.abg(s1), st0, st1, s0, s1);
  const co2 = ex.filter((x) => x.param === "PaCO2"), o2 = ex.filter((x) => x.param === "PaO2"), ph = ex.filter((x) => x.param === "pH");
  assert.ok(co2.length && co2.every((x) => x.direction === "down"));
  assert.match(co2[0].because.en, /Alveolar ventilation/);
  assert.ok(o2.length && o2.every((x) => x.direction === "up"));
  assert.match(o2[0].because.en, /FiO2/);
  assert.ok(ph.length && ph.every((x) => x.direction === "up"));
  for (const x of ex) { assert.ok(x.because.en && x.because.hi); assert.ok(x.chain.every((c) => E.CHAIN_STEPS.includes(c))); }
  // the reverse change reverses every direction
  const back = E.explainDelta(E.abg(s1), E.abg(E.step(s1, st0, 1800)), st1, st0, s1, E.step(s1, st0, 1800));
  assert.ok(back.filter((x) => x.param === "PaCO2").every((x) => x.direction === "up"));
  assert.ok(back.filter((x) => x.param === "PaO2").every((x) => x.direction === "down"));
  // recruitment is named when PEEP raises PaO2
  let a = E.init(ardsMild(), { mode: "vc", vt: 420, rr: 26, peep: 5 });
  const ap = Object.assign({}, a.settings, { peep: 15 }), a2 = E.step(a, ap, 1800);
  const rx = E.explainDelta(E.abg(a), E.abg(a2), a.settings, ap, a, a2).filter((x) => x.param === "PaO2");
  assert.ok(rx.length && rx[0].direction === "up" && /[Ss]hunt/.test(rx[0].because.en), JSON.stringify(rx));
});

test("whatIf isolates one change from the timeline and returns a valid chain", () => {
  const s = E.init(byId("pneumonia"));
  const w = E.whatIf(s, s.settings, { key: "fio2", to: 100 });
  assert.ok(w.after.gas.pao2 > w.before.gas.pao2);
  assert.ok(w.chain.length && w.chain.every((c) => E.CHAIN_STEPS.includes(c)));
  assert.equal(s.t, 0, "whatIf does not mutate the state");
});

test("determinism and stepping", () => {
  const a = E.init(byId("ards")), b = E.init(byId("ards"));
  assert.deepEqual(a, b);
  const x = E.step(a, a.settings, 3600), y = E.step(b, b.settings, 3600);
  assert.deepEqual(x, y);
  let z = b; for (let i = 0; i < 360; i++) z = E.step(z, b.settings, 10);
  assert.ok(Math.abs(z.paco2 - x.paco2) < 1e-6 && Math.abs(z.lac - x.lac) < 1e-6, "one long step equals many short steps");
  assert.equal(a.t, 0, "step does not mutate its input");
  assert.deepEqual(E.breath(a, a.settings, 80), E.breath(b, b.settings, 80));
  const t0 = process.hrtime.bigint();
  let s = a; for (let i = 0; i < 200; i++) s = E.step(s, a.settings, 1);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  assert.ok(ms < 2, "step(dt=1) " + ms + " ms");
});

const finite = (o) => JSON.stringify(o, (k, v) => { if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite " + k); return v; });

test("all 10 modes run every scenario for an hour without NaN", () => {
  for (const sc of SC) for (const mode of Object.keys(E.MODES)) {
    let s = E.init(sc);
    const st = Object.assign({}, s.settings, { mode });
    s = E.step(s, st, 3600);
    const r = E.readout(s, st);
    finite(r); finite(E.abg(s)); finite(E.alarms(s, st));
    const b = E.breath(s, st, 60);
    finite(b);
    assert.equal(b.t.length, 60); assert.equal(b.paw.length, 60);
    assert.ok(r.vitals.spo2 >= 0 && r.vitals.spo2 <= 100 && r.gas.ph > 5.5 && r.gas.ph < 7.9 && r.gas.paco2 <= 200 && r.vitals.hr >= 20, sc.id + " " + mode + " " + r.gas.ph);
  }
});

test("waveform: VC breath reaches the set VT; PC and PSV shapes", () => {
  const s = E.init(textbook(), { mode: "vc", vt: 500, rr: 12 });
  const b = E.breath(s, s.settings, 200);
  assert.ok(Math.abs(Math.max(...b.vol) - 500) < 30, "VT " + Math.max(...b.vol));
  assert.ok(Math.max(...b.paw) > s.settings.peep + 8);
  assert.ok(Math.min(...b.flow) < 0, "passive expiration");
  const p = E.breath(s, Object.assign({}, s.settings, { mode: "pc", pinsp: 15 }), 200);
  assert.ok(Math.abs(Math.max(...p.paw) - 20) < 0.6);
  const two = E.breath(s, Object.assign({}, s.settings, { mode: "simv" }), 100);
  assert.ok(two.t.length === 100);
});

test("dyssynchrony gallery returns every kind", () => {
  for (const k of ["doubleTrigger", "ineffectiveTrigger", "autoTrigger", "flowStarvation", "prematureCycle", "delayedCycle", "reverseTrigger"]) {
    const d = E.dyssync(k, { mode: "acvc", vt: 450, ps: 10 });
    finite(d);
    assert.equal(d.kind, k); assert.ok(d.label.en && d.label.hi);
    assert.ok(d.t.length > 50 && d.paw.length === d.t.length && d.events.some((e) => e.id === k), k);
  }
  const fs = E.dyssync("flowStarvation", { vt: 450 }), vc = E.dyssync("autoTrigger", { vt: 450 });
  assert.ok(Math.min(...fs.pmus) < -10 && Math.min(...vc.pmus) === 0);
  assert.equal(E.dyssync("nope", {}).ok, false);
});

test("score rewards protective, on-target runs and penalises unsafe ones", () => {
  const sc = ardsMild();
  const runOf = (set) => {
    let s = E.init(sc, set); const st = Object.assign({}, s.settings), log = [];
    for (let t = 0; t <= 3600; t += 300) { log.push({ t: s.t, settings: st, readout: E.readout(s, st), action: null }); s = E.step(s, st, 300); }
    return E.score({ scenarioId: sc.id, scenario: sc, log, answers: [] });
  };
  const good = runOf({ mode: "acvc", vt: 420, rr: 28, peep: 12, fio2: 70, ti: 0.8 }), bad = runOf({ mode: "acvc", vt: 650, rr: 12, peep: 5, fio2: 40 });
  for (const x of [good, bad]) {
    assert.ok(x.total >= 0 && x.total <= 100);
    // a part is a number when scored and null when the learner made no such decision (A16)
    for (const k of ["mode", "initial", "oxygenation", "ventilation", "protection", "alarms", "abg", "time", "unsafe"]) {
      assert.ok(typeof x.parts[k] === "number" || x.parts[k] === null, k);
      assert.equal(x.scored[k], x.parts[k] !== null, k + " scored flag");
      assert.ok(x.explain[k] && x.explain[k].en && x.explain[k].hi, k + " explained");
    }
    assert.ok(x.notes.length && x.notes.every((n) => n.en && n.hi));
  }
  assert.ok(good.total > bad.total + 20, good.total + " vs " + bad.total);
  assert.ok(bad.parts.unsafe < 0);
});

test("learn.json tutorial expectations hold in the engine (timeline off)", () => {
  const get = (r, k) => [r.vent, r.gas, r.vitals].map((o) => o[k]).find((v) => v !== undefined);
  let checked = 0;
  // each expectation must hold against the state just before its own step, whether the learner waits 10 or 60 min
  for (const wait of [600, 3600]) for (const t of LEARN.tutorials) {
    let s, st, before = null;
    t.steps.forEach((step, i) => {
      const d = step.do || {};
      if (d.scenario) { s = E.init(quiet(d.scenario)); st = Object.assign({}, s.settings); before = null; }
      else if (d.mode || d.key) { before = E.readout(s, st); if (d.mode) st.mode = d.mode; else st[d.key] = d.to; s = E.step(s, st, wait); }
      // new step kinds: inject an event, take a bedside action (then wait), draw a gas
      else if (d.event) { before = E.readout(s, st); s = E.step(E.inject(s, d.event, d), st, 60); }
      else if (d.action) { before = E.readout(s, st); s = E.step(E.act(s, d.action), st, 60); }
      if (!step.expect || !before) return;
      const k = step.expect.key, b = get(before, k), a = get(E.readout(s, st), k);
      assert.notEqual(a, undefined, "readout exposes " + k);
      // displayed values must move the promised way by at least one display step
      assert.ok(step.expect.direction === "up" ? a > b : a < b, `${t.id}[${i}] ${k} ${b} -> ${a}`);
      checked++;
    });
  }
  assert.ok(checked >= 15, "checked " + checked);
});

function pairs(o, seen = new Set(), out = []) {
  if (!o || typeof o !== "object" || seen.has(o)) return out;
  seen.add(o);
  if (typeof o.en === "string" && "hi" in o) out.push(o);
  for (const k of Object.keys(o)) if (typeof o[k] === "object") pairs(o[k], seen, out);
  return out;
}

test("language: Hindi present with ASCII digits, no dashes, short sentences", () => {
  const s = E.init(byId("ards"));
  const ps = pairs(E).concat(pairs(E.readout(s, s.settings)), pairs(E.alarms(s, s.settings)), pairs(E.dyssync("doubleTrigger", {})));
  assert.ok(ps.length > 60);
  for (const p of ps) {
    assert.ok(p.en.trim() && typeof p.hi === "string" && p.hi.trim(), JSON.stringify(p));
    assert.ok(!/[०-९]/.test(p.hi), "ASCII digits in Hindi: " + p.hi);
    assert.ok(!DASH.test(p.en + p.hi));
    for (const x of p.en.split(/(?<=[.!?:;])\s+/)) assert.ok(x.split(/\s+/).length <= 20, "over 20 words: " + x);
  }
  assert.ok(ps.some((p) => /[ऀ-ॿ]/.test(p.hi)), "some Devanagari");
  assert.ok(!DASH.test(src), "no em or en dash in the file");
});

test("ES5 and UMD", () => {
  assert.match(src, /Narkē/);
  assert.match(src, /root\.NARKE_MODELS\[m\.id\] = m/);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.ok(!/\b(let|const|class)\s/.test(code), "no let/const/class");
  assert.ok(!/=>/.test(code) && !/`/.test(code) && !/\.\.\.\w/.test(code), "no arrows, templates, spread");
  assert.ok(!/\.(includes|find|findIndex|fill|startsWith|endsWith|padStart|assign)\(/.test(code), "no ES2015+ methods");
  assert.ok(!/\bfunction\s*\*/.test(code) && !/\basync\b|\bawait\b/.test(code));
  // no function declarations nested inside blocks (illegal in ES5 strict)
  assert.ok(!/(if|for|while)\s*\([^)]*\)\s*\{[^{}]*\bfunction\s+\w+\s*\(/.test(code));
});

/* ---------- calibration: every scenario behaves like the patient its story describes ----------
   Strategies and case setups live in test/narke-vent-strategies.mjs; tools/narke-vent-audit.mjs prints the same runs. */
const at = (id, change, secs, timeline = false) => {
  const sc = timeline ? byId(id) : quiet(id);
  let s = E.init(sc);
  const st = Object.assign({}, s.settings, change);
  if (secs) s = E.step(s, st, secs);
  return { s, st, r: E.readout(s, st), sc };
};
const flagIds = (r) => r.flags.map((f) => f.id);
const inside = (x, [lo, hi], msg) => assert.ok(x >= lo && x <= hi, `${msg} ${x} not in ${lo} to ${hi}`);

test("calibration: the t = 0 gas and monitor match each story", () => {
  const START = {
    "postop-normal": (r) => { inside(r.gas.paco2, [35, 45], "PaCO2"); inside(r.gas.ph, [7.35, 7.45], "pH"); assert.ok(r.vitals.spo2 >= 96); },
    "neuromuscular-gbs": (r) => { inside(r.gas.paco2, [35, 45], "PaCO2"); inside(r.gas.ph, [7.35, 7.45], "pH"); assert.ok(r.vitals.spo2 >= 94); },
    "postop-atelectasis": (r, s) => { inside(r.vitals.spo2, [88, 94], "SpO2"); assert.ok(r.gas.pfRatio < 200 && r.vent.drivingP > 15 && r.vent.vte / s.p.pbw > 8); },
    pneumonia: (r) => { inside(r.vitals.spo2, [86, 92], "SpO2"); assert.ok(r.gas.pfRatio < 150 && r.gas.ph < 7.35); },
    "cardiogenic-oedema": (r) => { inside(r.vitals.spo2, [86, 92], "SpO2"); assert.ok(r.gas.pfRatio < 150 && r.vitals.rr >= 28 && r.vitals.map >= 75); },
    copd: (r) => { inside(r.gas.ph, [7.2, 7.3], "pH"); inside(r.gas.paco2, [70, 90], "PaCO2"); inside(r.gas.hco3, [30, 36], "HCO3"); assert.ok(r.vent.autoPeep >= 2 && r.vitals.map < 65); },
    asthma: (r) => { inside(r.gas.ph, [7.1, 7.22], "pH"); inside(r.gas.paco2, [60, 80], "PaCO2"); assert.ok(r.vent.autoPeep >= 3 && r.vitals.map < 65 && r.vent.ppeak > 30); },
    "metabolic-dka": (r) => { inside(r.gas.ph, [7.1, 7.2], "pH"); inside(r.gas.paco2, [15, 20], "PaCO2"); assert.ok(r.gas.hco3 <= 8); },
    ards: (r, s) => { assert.ok(r.gas.pfRatio < 100 && r.vitals.spo2 < 88 && r.vent.drivingP > 15 && r.vent.vte / s.p.pbw > 8); inside(r.vent.pplat, [26, 32], "plateau"); },
    "trauma-contusion": (r) => { assert.ok(r.vitals.map < 70 && r.gas.lactate >= 3); inside(r.vitals.spo2, [86, 92], "SpO2"); }
  };
  assert.deepEqual(Object.keys(START).sort(), SC.map((x) => x.id).sort());
  for (const id of Object.keys(START)) {
    const { s, r } = at(id, {}, 0);
    try { START[id](r, s); } catch (e) { e.message = id + ": " + e.message; throw e; }
  }
});

test("calibration: good practice reaches the scenario goals within 60 minutes (timeline off)", () => {
  for (const sc of SC) {
    const g = sc.goals, { s, r } = at(sc.id, STRATEGIES[sc.id].good, 3600), kg = r.vent.vte / s.p.pbw, tag = sc.id + " good: ";
    inside(r.vitals.spo2, g.spo2, tag + "SpO2");
    if (g.ph) inside(r.gas.ph, g.ph, tag + "pH"); else inside(r.gas.paco2, g.paco2, tag + "PaCO2");
    assert.ok(r.vent.pplat <= g.pplatMax && r.vent.drivingP <= g.drivingMax, tag + "plateau " + r.vent.pplat + " driving " + r.vent.drivingP);
    if (sc.start.mode !== "niv") inside(kg, [g.vtPerKg[0] - 0.5, g.vtPerKg[1] + 0.5], tag + "VT/kg");
    assert.ok(r.vitals.map >= 65, tag + "MAP " + r.vitals.map);
    assert.ok(!r.flags.some((f) => ["vili", "baro", "periArrest", "hypotension"].includes(f.id)), tag + flagIds(r));
    assert.ok(s.harm.vili < 5, tag + "VILI " + s.harm.vili);
  }
});

test("calibration: the typical mistake produces the expected harm", () => {
  const HARM = {
    "postop-normal": (r) => r.gas.ph < 7.25 && r.gas.paco2 > 60,
    // weak muscles trigger few breaths, so a low set rate is hypoventilation (P10)
    "neuromuscular-gbs": (r) => r.gas.paco2 > 50 && r.gas.ph < 7.3 && r.vitals.rr <= 10,
    "postop-atelectasis": (r, s) => s.harm.vili > 50 && flagIds(r).includes("vili"),
    pneumonia: (r, s) => s.harm.vili > 50 && r.vent.drivingP > 15,
    "cardiogenic-oedema": (r) => r.vitals.spo2 < 90,
    // high rate in airflow obstruction: trapping, hypotension and no better CO2 than the slow good strategy (Tuxen 1987)
    copd: (r) => r.vent.autoPeep >= 10 && r.vitals.map < 65 && r.gas.paco2 >= at("copd", STRATEGIES.copd.good, 3600).r.gas.paco2,
    asthma: (r) => r.vent.autoPeep >= 10 && r.vitals.map < 55 && r.gas.paco2 >= at("asthma", STRATEGIES.asthma.good, 3600).r.gas.paco2,
    "metabolic-dka": (r) => r.gas.ph < 7.0 && r.vitals.map < 65,
    // VT 700 meets the 40 cmH2O peak limit, so delivered VT is about 610 mL: still 8.7 mL/kg with driving pressure above 20
    ards: (r, s) => r.vent.drivingP > 20 && s.harm.vili > 100 && r.flags.some((f) => f.id === "vili" && f.severity === "danger"),
    "trauma-contusion": (r) => r.vitals.map < 55 && r.gas.lactate > 5
  };
  for (const sc of SC) {
    const { s, r } = at(sc.id, STRATEGIES[sc.id].mistake, 3600);
    assert.ok(HARM[sc.id](r, s), sc.id + " mistake: " + JSON.stringify({ gas: r.gas, vitals: r.vitals, vent: r.vent, vili: s.harm.vili }));
  }
  // atelectasis: chasing SpO2 with FiO2 100 also earns the oxygen toxicity flag within hours
  assert.ok(flagIds(at("postop-atelectasis", STRATEGIES["postop-atelectasis"].mistake, 3 * 3600).r).includes("o2tox"));
  // DKA: the danger appears over minutes, not at t = 0
  const d0 = at("metabolic-dka", {}, 0).r.gas.ph, d10 = at("metabolic-dka", {}, 600).r.gas.ph;
  assert.ok(d0 >= 7.1 && d10 < d0 - 0.1, "DKA pH " + d0 + " to " + d10);
});

test("calibration: ARDS is winnable with lung protection and worse at 10 mL/kg", () => {
  const good = at("ards", STRATEGIES.ards.good, 3600).r, big = at("ards", Object.assign({}, STRATEGIES.ards.good, { vt: 700, rr: 20, pPeakHigh: 60 }), 3600);
  assert.ok(good.vent.pplat <= 30 && good.vent.drivingP <= 15 && good.gas.ph >= 7.2 && good.vitals.spo2 >= 88 && good.vitals.spo2 <= 95);
  assert.ok(big.r.vent.pplat > 35 && big.r.vent.drivingP > 20 && big.s.harm.vili > 100 && flagIds(big.r).includes("baro"));
});

test("calibration: timeline events behave sensibly under good practice", () => {
  const run = (id, until) => at(id, STRATEGIES[id].good, until, true).r;
  // trauma: pneumothorax at 15 min drops SpO2 and BP; it does not resolve by itself; the learner's decompression does
  const t14 = run("trauma-contusion", 840), t20 = at("trauma-contusion", STRATEGIES["trauma-contusion"].good, 1200, true);
  assert.ok(t20.r.vitals.spo2 < t14.vitals.spo2 - 3 && t20.r.vitals.map < t14.vitals.map && t20.r.vent.pplat > t14.vent.pplat, "pneumothorax");
  const left = E.step(t20.s, t20.st, 1200), drained = E.step(E.act(t20.s, "decompress"), t20.st, 1200);
  assert.ok(E.readout(left, t20.st).vitals.spo2 < t14.vitals.spo2 - 3, "no self resolution");
  const dr = E.readout(drained, t20.st);
  assert.ok(dr.vitals.spo2 >= t14.vitals.spo2 - 1, "drain " + dr.vitals.spo2);
  // E11: draining the chest does not cure the bleeding; BP stays low until blood is given
  const bl = E.readout(E.step(E.act(E.act(t20.s, "decompress"), "blood"), t20.st, 1200), t20.st);
  assert.ok(dr.vitals.map <= t14.vitals.map + 1 && bl.vitals.map > dr.vitals.map + 5, "blood " + dr.vitals.map + " to " + bl.vitals.map);
  // COPD: a named bronchospasm at 20 min raises peak pressure and auto-PEEP; it stays until the learner gives a bronchodilator
  const c19 = run("copd", 1140), c30 = at("copd", STRATEGIES.copd.good, 1800, true);
  assert.ok(c30.r.vent.ppeak > c19.vent.ppeak + 5 && c30.r.vent.autoPeep >= c19.vent.autoPeep, "COPD bronchospasm");
  assert.ok(c30.r.events.some((e) => e.id === "bronchospasm" && /Airway resistance 22 to 55/.test(e.detail.en)), "the event is named with its numbers (A1, E8)");
  const untreated = E.readout(E.step(c30.s, c30.st, 1200), c30.st), treated = E.readout(E.step(E.act(c30.s, "bronchodilator"), c30.st, 1200), c30.st);
  assert.ok(untreated.vent.ppeak > c19.vent.ppeak + 5 && treated.vent.ppeak < c19.vent.ppeak + 1 && treated.vitals.map >= 65, "bronchodilator " + treated.vent.ppeak);
  // asthma starts tight (E11); steroids and bronchodilators at 40 min ease it
  const a0 = at("asthma", {}, 0, true).r, a20 = run("asthma", 1200), a60 = run("asthma", 3600);
  assert.ok(a0.vent.ppeak >= 36 && a0.vent.raw >= 35, "near-fatal asthma starts tight: " + a0.vent.ppeak);
  assert.ok(a60.vent.ppeak < a20.vent.ppeak - 5 && a60.vent.raw < a20.vent.raw && a60.vitals.map >= a20.vitals.map, "asthma");
  // ARDS: suction disconnect at 40 min derecruits fast; at the same PEEP the lung stays partly closed (see C1 test)
  const r39 = run("ards", 2390), r41 = run("ards", 2460), r60 = run("ards", 3600);
  assert.ok(r41.vitals.spo2 < r39.vitals.spo2 - 5 && r60.vitals.spo2 < r39.vitals.spo2, "ARDS disconnect");
  // every scenario with its timeline stays finite and physiological for 3 hours
  for (const sc of SC) {
    let s = E.init(sc); const st = Object.assign({}, s.settings, STRATEGIES[sc.id].good);
    for (let t = 0; t < 10800; t += 300) { s = E.step(s, st, 300); const r = E.readout(s, st); finite(r); assert.ok(r.gas.ph > 6.8 && r.vitals.map > 30, sc.id + " t " + s.t); }
  }
});

test("ABG cases: the gas comes from the model, the keyed answer works and wrong answers do not look better", () => {
  assert.deepEqual(Object.keys(CASES).sort(), LEARN.cases.map((c) => c.id).sort());
  for (const c of LEARN.cases) {
    const setup = CASES[c.id], { s, st } = caseState(E, SC.find((x) => x.id === c.scenario), c.setup), g = E.abg(s), r0 = E.readout(s, st);
    const near = (k, tol) => assert.ok(Math.abs(g[k] - c.abg[k]) <= tol, `${c.id} ${k} case ${c.abg[k]} model ${g[k]}`);
    near("pH", 0.02); near("PaCO2", 2); near("HCO3", 1); near("FiO2", 0.01); near("PaO2", 3 + 0.05 * g.PaO2);
    assert.ok(Math.abs(r0.vitals.spo2 - c.spo2) <= 1, c.id + " SpO2");
    const res = c.q2.options.map((o) => E.whatIf(s, st, o.change));
    const right = res[c.q2.answer];
    assert.ok(setup.claim(right.before, right.after), c.id + " keyed answer does what the explanation says");
    res.forEach((w, i) => {
      if (i === c.q2.answer) return;
      const a = setup.score(w.after), b = setup.score(right.after);
      // abg-13's keyed answer is "change nothing", so a neutral wrong option may tie it
      assert.ok(setup.atInit ? a <= b : a < b, `${c.id} option ${i} (${c.q2.options[i].label.en}) scores ${a} vs keyed ${b}`);
    });
  }
});

test("Hindi labels are real Hindi, and score maxima add to 100", () => {
  const s = E.init(byId("ards")), ps = pairs(E).concat(pairs(E.readout(s, s.settings)), pairs(E.alarms(s, s.settings)));
  const blocks = src.match(/var (FLAG|ALARM) = \{[\s\S]*?\n  \};/g);
  assert.equal(blocks.length, 2);
  const lits = [...blocks.join("\n").matchAll(/T\("([^"]*)", "([^"]*)"\)/g)].map((m) => ({ en: m[1], hi: m[2] }));
  assert.ok(lits.length >= 25, "flag and alarm labels " + lits.length);
  const abbr = (x) => /^[A-Za-z0-9:]+$/.test(x) && x.replace(/[^A-Z]/g, "").length >= 2; // PEEP, FiO2, IPAP, ABG
  for (const p of ps.concat(lits)) assert.ok(p.hi !== p.en || abbr(p.en), "Hindi equals English: " + p.en);
  const M = E.SCORE_MAX, sum = M.mode + M.initial + M.oxygenation + M.ventilation + M.protection + M.alarms + M.abg + M.time;
  assert.equal(sum, 100); assert.equal(M.unsafeMin, -30);
});

/* ---------- clinical review regressions (vent-review.md: C1, M1 to M10, m1 to m14) ---------- */
const scoreRun = (sc, set, secs = 3600, every = 60) => {
  let s = E.init(sc); const st = Object.assign({}, s.settings, set), log = [];
  for (let t = 0; t <= secs; t += every) { log.push({ t: s.t, settings: st, readout: E.readout(s, st) }); s = E.step(s, st, every); }
  return { s, sc: E.score({ scenarioId: sc.id, scenario: sc, log, answers: [] }) };
};

test("C1: ARDS disconnect derecruits within 60 s and stays worse at the same PEEP until the lung is recruited again", () => {
  const sc = byId("ards"), good = STRATEGIES.ards.good;
  let s = E.init(sc); const st = Object.assign({}, s.settings, good);
  s = E.step(s, st, 2390); const pre = E.readout(s, st), pa0 = s.pao2A;
  const d20 = E.step(s, st, 30); // 20 s into the 30 s disconnect at 2400 s
  assert.ok(E.readout(d20, st).vitals.spo2 <= pre.vitals.spo2 - 5, "SpO2 falls within 60 s: " + pre.vitals.spo2 + " to " + E.readout(d20, st).vitals.spo2);
  assert.ok(d20.pao2A < pa0 - 20, "alveolar O2 store empties on room air: " + pa0 + " to " + d20.pao2A);
  const after = E.step(s, st, 610), r10 = E.readout(after, st); // 10 min after reconnection at the same PEEP
  assert.ok(r10.vitals.spo2 <= pre.vitals.spo2 - 3 && r10.gas.shunt > pre.gas.shunt, "still derecruited: " + r10.vitals.spo2);
  const rec = E.step(E.step(after, Object.assign({}, st, { peep: 18 }), 180), st, 600), rr = E.readout(rec, st); // PEEP 18 for 3 min, back to 14
  assert.ok(rr.vitals.spo2 >= pre.vitals.spo2 - 1 && rr.gas.shunt <= pre.gas.shunt + 0.01, "recruited again: " + rr.vitals.spo2);
});

test("M1: in COPD missed triggers fall as external PEEP approaches about 80% of intrinsic PEEP", () => {
  const miss = (peep) => { const sc = quiet("copd"); let s = E.init(sc, { vt: 500, rr: 16, ti: 0.8, fio2: 45, peep }); s = E.step(s, s.settings, 1800); return E.readout(s, s.settings).vent; };
  const z = miss(0), pi = z.peepTotal, m = [0, 1, 2, 3].map((p) => miss(p).ineffective);
  assert.ok(pi >= 3 && z.ineffective > 0, "intrinsic PEEP " + pi + " and missed efforts " + z.ineffective);
  for (let i = 1; i < m.length; i++) assert.ok(m[i] <= m[i - 1], "monotonic " + m);
  assert.ok(miss(Math.round(0.8 * pi)).ineffective < z.ineffective, "PEEPe near 80% of PEEPi removes the trigger load");
  assert.ok(Math.abs(miss(Math.round(0.8 * pi)).peepTotal - pi) < 1, "and total PEEP barely rises (waterfall)");
});

test("M2: plateau never exceeds peak in any mode or scenario", () => {
  for (const sc of SC) for (const mode of Object.keys(E.MODES)) {
    const s = E.init(quiet(sc.id), { mode, ps: 8, peep: 8 }), v = E.readout(s, s.settings).vent;
    assert.ok(v.pplat <= v.ppeak + 0.05, sc.id + " " + mode + " plateau " + v.pplat + " peak " + v.ppeak);
  }
});

test("M3: NIV EtCO2 is below PaCO2 by a sensible gap, from the breaths that carry the minute volume", () => {
  let s = E.init(quiet("copd"), { mode: "niv", ipap: 20, epap: 5, rr: 12 }); s = E.step(s, s.settings, 1800);
  const r = E.readout(s, s.settings);
  assert.ok(r.vitals.etco2 > 0 && r.vitals.etco2 < r.gas.paco2 && r.vitals.etco2 >= 0.5 * r.gas.paco2, "EtCO2 " + r.vitals.etco2 + " PaCO2 " + r.gas.paco2);
  const n = steady(textbook(), { mode: "vc", vt: 500, rr: 12, fio2: 21, peep: 5 }).r;
  assert.ok(n.gas.paco2 - n.vitals.etco2 >= 1 && n.gas.paco2 - n.vitals.etco2 <= 5, "normal gap stays 2 to 5");
});

test("M4: the peak pressure alarm ends a volume breath; delivered VT falls and the volume alarms fire", () => {
  const sc = quiet("asthma"); sc.timeline = [{ t: 10, event: "bronchospasm", note: { en: "x", hi: "x" } }];
  let s = E.init(sc, { pPeakHigh: 40 }); s = E.step(s, s.settings, 300);
  const r = E.readout(s, s.settings), ids = E.alarms(s, s.settings).map((a) => a.id);
  assert.ok(r.vent.ppeak <= 40, "peak held at the limit: " + r.vent.ppeak);
  assert.ok(r.vent.vte < 0.8 * s.settings.vt, "VT falls: " + r.vent.vte);
  for (const id of ["pPeakHigh", "vtLow", "veLow"]) assert.ok(ids.includes(id), id + " in " + ids);
  const b = E.breath(s, s.settings, 200);
  assert.ok(Math.max(...b.paw) <= 40.5 && Math.max(...b.vol) < 0.8 * s.settings.vt, "waveform is cut at the limit");
});

test("M5: dynamic hyperinflation adds dead space, so high rate does not out-clear the slow strategy in asthma and COPD", () => {
  const co2 = (id, ch) => at(id, ch, 3600).r.gas.paco2;
  inside(co2("asthma", {}), [55, 70], "asthma start settings hold PaCO2");
  // COPD start settings (VT 600, rate 20) over-ventilate a chronic retainer: post-hypercapnic alkalaemia with trapping (A1)
  const cs = at("copd", {}, 3600).r;
  assert.ok(cs.gas.ph > 7.45 && cs.vent.autoPeep >= 3 && cs.vitals.map < 65, "COPD start settings: " + cs.gas.ph);
  for (const id of ["asthma", "copd"]) assert.ok(co2(id, STRATEGIES[id].mistake) >= co2(id, STRATEGIES[id].good), id + " high-rate mistake vs good");
  const g = at("asthma", STRATEGIES.asthma.good, 3600).r;
  assert.ok(g.gas.ph >= 7.2 && g.gas.paco2 > 45, "permissive hypercapnia still holds: " + g.gas.paco2 + " pH " + g.gas.ph);
});

test("M6: delayed cycling shows mechanical Ti beyond neural Ti, expiratory effort in inspiration and an end-inspiratory spike", () => {
  const d = E.dyssync("delayedCycle", { ps: 14, peep: 5 }), t0 = d.marks.trigger[0], t1 = d.marks.cycle.find((c) => c > t0);
  const inI = d.t.map((t, i) => i).filter((i) => d.t[i] >= t0 && d.t[i] < t1);
  const neural = d.t.filter((t, i) => t >= t0 - 0.2 && t < t1 && d.pmus[i] < 0).length * (d.t[1] - d.t[0]);
  assert.ok(t1 - t0 > 0.7 + 0.3, "mechanical Ti " + (t1 - t0) + " vs neural 0.7");
  assert.ok(neural < t1 - t0, "neural Ti " + neural + " shorter than mechanical");
  assert.ok(inI.some((i) => d.pmus[i] > 2), "expiratory muscles push while the valve is still in inspiration");
  assert.ok(Math.max(...inI.map((i) => d.paw[i])) > 5 + 14 + 1, "pressure spike above the set level");
});

test("M8: apnoea when breaths are further apart than the apnoea time, with alarm and backup", () => {
  for (const mode of ["cpap", "psv"]) {
    let s = E.init(quiet("postop-normal")); const st = Object.assign({}, s.settings, { mode, ps: 0, apnoea: 20 });
    s = E.step(s, st, 30);
    assert.ok(E.alarms(s, st).some((a) => a.id === "apnoea"), mode + " apnoea alarm");
    assert.ok(E.readout(s, st).flags.some((f) => f.id === "apnoeaBackup"), mode + " backup");
    s = E.step(s, st, 1800);
    assert.ok(E.readout(s, st).vitals.spo2 >= 94, mode + " backup keeps him oxygenated: " + E.readout(s, st).vitals.spo2);
  }
});

test("M9: cardiogenic oedema separates good NIV support from too little; high volume status keeps BP with pressure", () => {
  const sc = byId("cardiogenic-oedema"), good = scoreRun(sc, STRATEGIES["cardiogenic-oedema"].good), bad = scoreRun(sc, STRATEGIES["cardiogenic-oedema"].mistake);
  assert.ok(good.sc.total >= bad.sc.total + 10, "score " + good.sc.total + " vs " + bad.sc.total);
  const imp = sc.timeline.findIndex((e) => e.event === "improve");
  assert.ok(good.s.fired.includes(imp) && !bad.s.fired.includes(imp), "improvement waits for adequate support");
  const map = (epap) => { const s = E.init(quiet("cardiogenic-oedema"), { ipap: epap + 6, epap }); return E.readout(s, s.settings).vitals.map; };
  assert.ok(map(12) >= map(4), "MAP does not fall with EPAP in a full circulation: " + map(4) + " to " + map(12));
});

test("m9: scripted harmful events are not counted as unsafe in their response window", () => {
  const sc = { id: "x", patient: { sex: "M", heightCm: 175 }, goals: { spo2: [88, 95] }, timeline: [{ t: 600, event: "disconnect" }] };
  const rd = (spo2) => ({ vitals: { spo2, map: 80 }, vent: { pplat: 25, drivingP: 12, vte: 420, autoPeep: 0 }, gas: { ph: 7.3, paco2: 45 }, flags: [] });
  const log = [{ t: 0, settings: { mode: "acvc" }, readout: rd(92) }, { t: 620, settings: { mode: "acvc" }, readout: rd(80) }];
  assert.equal(E.score({ scenario: sc, log }).parts.unsafe, 0);
  assert.equal(E.score({ scenario: Object.assign({}, sc, { timeline: [] }), log }).parts.unsafe, -5);
  log.push({ t: 1200, settings: { mode: "acvc" }, readout: rd(80) }); // after the window the learner owns it
  assert.equal(E.score({ scenario: sc, log }).parts.unsafe, -5);
});

test("m9: learner actions: E.ACTIONS and E.act decompress, suction and bag", () => {
  assert.deepEqual(Object.keys(E.ACTIONS).sort(), ["bag100", "blood", "bronchodilator", "decompress", "disconnect", "fluid", "paralyse", "reconnect", "sedate", "suction"]);
  for (const [id, a] of Object.entries(E.ACTIONS)) { assert.equal(a.id, id); assert.ok(a.label.en && a.label.hi && typeof a.available === "function"); }
  // trauma: the pneumothorax stays until the learner decompresses it
  const sc = byId("trauma-contusion"); assert.ok(!sc.timeline.some((e) => e.event === "improve"), "no scripted drain");
  let s = E.init(sc); const st = Object.assign({}, s.settings, STRATEGIES["trauma-contusion"].good);
  s = E.step(s, st, 1200);
  const ptx = E.readout(s, st), d = E.act(s, "decompress");
  assert.equal(s.acts.length, 0, "act is pure");
  assert.ok(d.acts.length === 1 && !E.ACTIONS.decompress.available(d));
  const dr = E.readout(E.step(d, st, 600), st);
  assert.ok(dr.vent.pplat < ptx.vent.pplat - 3 && dr.vitals.map > ptx.vitals.map && dr.vitals.spo2 > ptx.vitals.spo2, "decompression resolves it");
  // suction clears secretions
  const pn = quiet("pneumonia"); pn.timeline = [{ t: 0, event: "secretions", note: { en: "x", hi: "x" } }];
  const p0 = E.init(pn), p = E.step(p0, p0.settings, 60), pk = E.readout(p, p.settings).vent.ppeak;
  assert.ok(E.readout(E.act(p, "suction"), p.settings).vent.ppeak < pk - 1, "suction lowers peak pressure");
  // bag 100%: FiO2 1.0 off the ventilator for 60 s, the ventilator alarms disconnect, PEEP is lost
  const a0 = E.init(quiet("postop-atelectasis")), b = E.act(a0, "bag100"), bs = b.settings, br = E.readout(b, bs);
  assert.ok(br.flags.some((f) => f.id === "bagging") && E.alarms(b, bs).some((x) => x.id === "disconnect") && br.vent.peepTotal < 1);
  assert.ok(E.readout(E.step(b, bs, 50), bs).gas.pao2 > E.readout(a0, bs).gas.pao2, "PaO2 rises on 100%");
  assert.ok(!E.readout(E.step(b, bs, 70), bs).flags.some((f) => f.id === "bagging"), "back on the ventilator after 60 s");
});

test("m10: improve raises HCO3 first order over about an hour, not as a jump", () => {
  const sc = quiet("pneumonia"); sc.timeline = [{ t: 10, event: "improve", note: { en: "x", hi: "x" } }];
  const s = E.init(sc), h0 = E.abg(s).HCO3, st = s.settings;
  const h1 = E.abg(E.step(s, st, 70)).HCO3, h60 = E.abg(E.step(s, st, 3610)).HCO3;
  assert.ok(h1 - h0 < 1.5, "one minute: " + h0 + " to " + h1);
  assert.ok(h60 - h0 >= 3, "one hour: " + h0 + " to " + h60);
});

test("m11: controlled modes say efforts are ignored, not missed", () => {
  const sc = quiet("pneumonia"); sc.patient.drive.sedation = 0.2;
  const v = E.init(sc, { mode: "vc" }), a = E.init(sc, { mode: "acvc" });
  const fv = E.readout(v, v.settings).flags.map((f) => f.id);
  assert.ok(fv.includes("effortsIgnored") && !fv.includes("ineffective"), fv.join());
  assert.ok(!E.readout(a, a.settings).flags.some((f) => f.id === "effortsIgnored"));
});

test("timeline events can wait for a setting or a learner action", () => {
  const sc = quiet("postop-normal"); sc.timeline = [{ t: 10, event: "fever", requires: { key: "peep", min: 8 }, note: { en: "x", hi: "x" } }];
  let s = E.init(sc); const lo = E.step(s, s.settings, 60), hi = E.step(s, Object.assign({}, s.settings, { peep: 8 }), 60);
  assert.ok(E.readout(hi, hi.settings).vitals.temp > E.readout(lo, lo.settings).vitals.temp);
  sc.timeline = [{ t: 10, event: "fever", requires: { action: "suction" }, note: { en: "x", hi: "x" } }];
  s = E.init(sc);
  assert.ok(E.step(E.act(s, "suction"), s.settings, 60).fired.length === 1 && E.step(s, s.settings, 60).fired.length === 0);
});

test("m3: no ABG case option repeats the case's current setting", () => {
  for (const c of LEARN.cases) {
    const { st } = caseState(E, SC.find((x) => x.id === c.scenario), c.setup);
    for (const o of c.q2.options) assert.ok(st[o.change.key] !== o.change.to || o.change.also || /^Keep /.test(o.label.en), c.id + " no-op option " + o.label.en);
  }
});

test("timeline requires may be a list meaning any of (cardiogenic oedema improves on EPAP or PEEP 8+)", () => {
  const sc = quiet("postop-normal");
  sc.timeline = [{ t: 10, event: "fever", requires: [{ key: "epap", min: 8 }, { key: "peep", min: 8 }], note: { en: "x", hi: "x" } }];
  const s = E.init(sc), fired = (o) => E.step(s, Object.assign({}, s.settings, o), 60).fired.length;
  assert.equal(fired({ peep: 5, epap: 4 }), 0);
  assert.equal(fired({ peep: 8, epap: 4 }), 1);
  assert.equal(fired({ peep: 5, epap: 8 }), 1);
  const ev = byId("cardiogenic-oedema").timeline.find((e) => e.event === "improve");
  assert.ok(Array.isArray(ev.requires) && ev.requires.some((r) => r.key === "peep") && ev.requires.some((r) => r.key === "epap"));
  // CPAP/PEEP 8 on the real scenario fires the improve event at 30 min
  const c = byId("cardiogenic-oedema"), c0 = E.init(c), set = Object.assign({}, c0.settings, { mode: "cpap", peep: 8 });
  assert.ok(E.step(c0, set, 1900).fired.length >= 1);
});
