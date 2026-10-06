// Narkē Ventilator Lab physiology engine (narke-models/vent-engine.js): API contract, textbook anchors, physiology
// property tests across modes and scenarios, alarms, explanations, determinism, language and ES5 rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
// The content ARDS lung (c 28, UI 26) overdistends at 6 mL/kg with PEEP 15; property tests use a milder recruitable copy.
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
  assert.ok(ids(s, Object.assign({}, st, { peepHigh: 5 })).includes("peepHigh"));
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
    for (const k of ["mode", "initial", "oxygenation", "ventilation", "protection", "alarms", "abg", "time", "unsafe"]) assert.equal(typeof x.parts[k], "number", k);
    assert.ok(x.notes.length && x.notes.every((n) => n.en && n.hi));
  }
  assert.ok(good.total > bad.total + 20, good.total + " vs " + bad.total);
  assert.ok(bad.parts.unsafe < 0);
});

test("learn.json tutorial expectations hold in the engine (timeline off)", () => {
  const get = (r, k) => [r.vent, r.gas, r.vitals].map((o) => o[k]).find((v) => v !== undefined);
  let checked = 0;
  for (const t of LEARN.tutorials) {
    let s, st, before = null;
    t.steps.forEach((step, i) => {
      const d = step.do || {};
      if (d.scenario) { s = E.init(quiet(d.scenario)); st = Object.assign({}, s.settings); before = null; }
      else if (d.mode || d.key) { before = E.readout(s, st); if (d.mode) st.mode = d.mode; else st[d.key] = d.to; s = E.step(s, st, 1800); }
      if (!step.expect || !before) return;
      const k = step.expect.key, b = get(before, k), a = get(E.readout(s, st), k);
      assert.notEqual(a, undefined, "readout exposes " + k);
      const tol = 0.1; // a value already at its floor may not move beyond display rounding; it must never move the wrong way
      if (step.expect.direction === "up") assert.ok(a > b || Math.abs(a - b) <= tol && b === a, `${t.id}[${i}] ${k} ${b} -> ${a}`);
      else assert.ok(a < b || Math.abs(a - b) <= tol && b === a, `${t.id}[${i}] ${k} ${b} -> ${a}`);
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
