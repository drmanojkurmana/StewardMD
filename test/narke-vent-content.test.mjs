// Narkē Ventilator Lab content: scenarios.json and learn.json against the vent-lab contract, language rules,
// goal sanity, and consistency with kb/clinical-protocols.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rj = (p) => JSON.parse(readFileSync(p, "utf8"));
const S = rj("narke/vent/scenarios.json");
const L = rj("narke/vent/learn.json");
const kb = (id) => rj(`kb/clinical-protocols/${id}.json`);
const kbText = (id) => JSON.stringify(kb(id));

const SETTING_KEYS = ["fio2", "peep", "vt", "rr", "pinsp", "ps", "ti", "ie", "trigType", "trigFlow", "trigPress", "cycle", "rise",
  "phigh", "plow", "thigh", "tlow", "ipap", "epap", "pPeakHigh", "veLow", "veHigh", "apnoea", "rrHigh", "fio2Low", "fio2High",
  "peepLow", "peepHigh"];
const MODES = ["vc", "acvc", "pc", "acpc", "simv", "psv", "cpap", "prvc", "niv", "aprv"];
const ALARMS = ["pPeakHigh", "pPlatHigh", "vtLow", "veLow", "veHigh", "apnoea", "rrHigh", "fio2Low", "fio2High", "peepLow",
  "peepHigh", "disconnect", "autoPeep", "dyssync"];
const DYSSYNC = ["doubleTrigger", "ineffectiveTrigger", "autoTrigger", "flowStarvation", "prematureCycle", "delayedCycle", "reverseTrigger"];
const CHAIN = ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"];
const TUTORIALS = ["how-it-works", "fio2-peep", "vt-rr", "pc-vs-vc", "waveforms", "abg-adjust", "ards", "copd-autopeep"];
const SCENARIOS = ["postop-normal", "copd", "asthma", "ards", "cardiogenic-oedema", "pneumonia", "postop-atelectasis",
  "neuromuscular-gbs", "metabolic-dka", "trauma-contusion"];
const MAIN_WHATIF = ["fio2", "peep", "vt", "rr", "ti", "pinsp", "ps", "trigFlow", "cycle", "rise", "ipap", "epap", "phigh", "tlow"];
const EVENTS = ["secretions", "bronchospasm", "pneumothorax", "disconnect", "hypotension", "fever", "improve"];
const LEVEL1 = ["mode", "fio2", "peep", "rr", "vt", "spo2", "hr", "sbp", "dbp", "map", "abg"];
const DASHES = new RegExp("[" + String.fromCharCode(8211) + String.fromCharCode(8212) + "]");
const HI_DIGIT = /[०-९]/;
const DEVANAGARI = /[ऀ-ॿ]/;

// If the engine has landed, its catalogue is the source of truth for keys and ids.
const enginePath = "narke-models/vent-engine.js";
const E = existsSync(enginePath) ? require("../" + enginePath) : null;

const bi = (o) => o && typeof o.en === "string" && o.en.trim() && typeof o.hi === "string" && o.hi.trim();
const pbw = (sex, h) => (sex === "M" ? 50 : 45.5) + 0.91 * (h - 152.4);

function eachBi(o, fn, path = "") {
  if (Array.isArray(o)) o.forEach((v, i) => eachBi(v, fn, `${path}[${i}]`));
  else if (o && typeof o === "object") {
    if (typeof o.en === "string" && typeof o.hi === "string") return fn(o, path);
    Object.keys(o).forEach((k) => eachBi(o[k], fn, `${path}.${k}`));
  }
}

test("both files are versioned and ai_drafted", () => {
  for (const f of [S, L]) {
    assert.equal(f.v, 1);
    assert.equal(f.review, "ai_drafted");
  }
});

test("engine catalogue matches the content keys (when the engine exists)", { skip: !E }, () => {
  Object.keys(E.SETTINGS).forEach((k) => assert.ok(L.settings[k], "learn.settings missing engine key " + k));
  Object.keys(E.MODES).forEach((k) => assert.ok(L.modes[k], "learn.modes missing engine mode " + k));
  if (E.CHAIN_STEPS) assert.deepEqual([...E.CHAIN_STEPS].sort(), [...CHAIN].sort());
});

test("scenarios: the 10 required scenarios with full schema", () => {
  const ids = S.scenarios.map((s) => s.id);
  assert.deepEqual([...ids].sort(), [...SCENARIOS].sort());
  assert.equal(new Set(ids).size, ids.length);
  [1, 2, 3, 4].forEach((n) => assert.ok(S.scenarios.some((s) => s.level === n), "a scenario at level " + n));
  for (const s of S.scenarios) {
    ["title", "story", "why"].forEach((k) => assert.ok(bi(s[k]), s.id + "." + k));
    const p = s.patient;
    assert.ok(p.age >= 16 && p.age <= 100 && ["M", "F"].includes(p.sex), s.id + " patient");
    assert.ok(p.heightCm >= 140 && p.heightCm <= 200 && p.weightKg >= 35 && p.weightKg <= 200, s.id + " size");
    assert.ok(bi(p.diagnosis), s.id + " diagnosis");
    assert.ok(p.hb >= 6 && p.hb <= 20 && p.temp >= 34 && p.temp <= 41, s.id + " hb/temp");
    assert.ok(["low", "normal", "high"].includes(p.volumeStatus), s.id + " volumeStatus");
    assert.ok(p.metabolic.hco3 >= 4 && p.metabolic.hco3 <= 45 && p.metabolic.lactate >= 0, s.id + " metabolic");
    assert.ok(p.vco2 >= 150 && p.vco2 <= 350, s.id + " vco2");
    assert.ok(p.drive.rate >= 0 && p.drive.effort >= 0 && p.drive.sedation >= 0 && p.drive.sedation <= 1, s.id + " drive");
    const g = s.lung;
    assert.ok(g.c >= 10 && g.c <= 100 && g.r >= 5 && g.r <= 50, s.id + " c/r");
    assert.equal(typeof g.flowLimited, "boolean");
    assert.ok(g.shunt >= 0 && g.shunt <= 0.6 && g.recruitable >= 0 && g.recruitable <= 1, s.id + " shunt");
    assert.ok(g.deadSpace >= 0 && g.deadSpace < 0.6 && g.upperInflection >= 20 && g.upperInflection <= 45, s.id + " dead space/UIP");
    assert.ok(MODES.includes(s.start.mode), s.id + " start mode");
    Object.keys(s.start.settings).forEach((k) => assert.ok(SETTING_KEYS.includes(k), s.id + " start key " + k));
    if (s.start.abg) assert.ok(Object.keys(s.start.abg).join() === "PaCO2" && s.start.abg.PaCO2 >= 10 && s.start.abg.PaCO2 <= 120, s.id + " presenting PaCO2");
    assert.ok(Array.isArray(s.timeline));
    s.timeline.forEach((e) => {
      assert.ok(e.t > 0 && (E ? E.EVENTS[e.event] : EVENTS.includes(e.event)) && bi(e.note), s.id + " timeline " + e.event);
    });
    assert.ok(s.debrief.length >= 3 && s.debrief.every(bi), s.id + " debrief");
    assert.ok(s.sources.length >= 2 && s.sources.every((x) => x.label && typeof x.url === "string"), s.id + " sources");
  }
  assert.ok(S.scenarios.find((s) => s.id === "trauma-contusion").timeline.some((e) => e.event === "pneumothorax"),
    "trauma has a pneumothorax event");
});

test("scenarios: goals are within current guidance", () => {
  for (const s of S.scenarios) {
    const g = s.goals;
    assert.ok(g.pplatMax <= 30, s.id + " pplatMax <= 30");
    assert.ok(g.drivingMax <= 15, s.id + " drivingMax <= 15");
    assert.ok(g.vtPerKg[0] >= 4 && g.vtPerKg[1] <= 8, s.id + " vtPerKg inside 4 to 8");
    // BTS 2017: 94 to 98% for most patients, 88 to 92% with hypercapnic risk; lung injury bands sit at 88 to 96.
    assert.ok(g.spo2[0] >= 88 && g.spo2[1] <= 98 && g.spo2[1] - g.spo2[0] >= 3, s.id + " spo2 band");
    if (g.spo2[1] > 96) assert.ok(g.spo2[0] >= 94 && s.lung.shunt <= 0.1, s.id + " a 94 to 98 band only for near normal lungs");
    assert.ok(g.paco2 || g.ph, s.id + " has a CO2 or pH goal");
    if (g.ph) assert.ok(g.ph[0] >= 7.15 && g.ph[1] <= 7.45);
    assert.ok(g.other.every(bi));
  }
  const by = Object.fromEntries(S.scenarios.map((s) => [s.id, s]));
  assert.deepEqual(by.copd.goals.spo2, [88, 92]);
  assert.ok(by.copd.patient.metabolic.hco3 > 26 && by.copd.lung.flowLimited, "COPD is a chronic retainer with flow limitation");
  assert.ok(by.asthma.lung.r >= 25 && by.asthma.lung.flowLimited, "asthma has high resistance");
  assert.ok(by["metabolic-dka"].goals.paco2[1] < 35, "DKA goal preserves respiratory compensation");
  assert.ok(by["metabolic-dka"].start.settings.rr <= 16, "DKA starts on the dangerous normal rate");
  // Starting tidal volumes that the learner must correct are really above 8 mL/kg PBW.
  ["ards", "postop-atelectasis"].forEach((id) => {
    const s = by[id];
    assert.ok(s.start.settings.vt / pbw(s.patient.sex, s.patient.heightCm) > 8, id + " starts above 8 mL/kg PBW");
  });
});

test("ARDS, COPD and asthma targets match kb/clinical-protocols", () => {
  const ards = kbText("ards-lung-protective-ventilation");
  ["6 mL/kg", "range 4 to 8", "below 30 cmH2O", "SpO2 88 to 95%", "PaO2 55 to 80 mmHg", "about 15 cmH2O", "about 35/min"]
    .forEach((t) => assert.ok(ards.includes(t), "kb ARDS still says " + t));
  const a = S.scenarios.find((s) => s.id === "ards");
  assert.deepEqual(a.goals.vtPerKg, [4, 8]);
  assert.equal(a.goals.pplatMax, 30);
  assert.deepEqual(a.goals.spo2, [88, 95]);
  const other = a.goals.other.map((o) => o.en).join(" ");
  ["6 mL/kg predicted body weight", "range 4 to 8", "below 30", "PaO2 55 to 80 mmHg or SpO2 88 to 95%", "about 35"]
    .forEach((t) => assert.ok(other.includes(t), "ARDS goals text says " + t));
  const p = pbw(a.patient.sex, a.patient.heightCm);
  const tut = L.tutorials.find((t) => t.id === "ards").steps.find((s) => s.do && s.do.key === "vt");
  assert.ok(Math.abs(tut.do.to - 6 * p) <= 10, "ARDS tutorial VT is 6 mL/kg PBW");
  assert.ok(kbText("copd-exacerbation").includes("88 to 92%"));
  assert.ok(kbText("acute-asthma-adult").includes("92 to 95%"));
  assert.deepEqual(S.scenarios.find((s) => s.id === "asthma").goals.spo2, [92, 95]);
  assert.ok(kbText("acute-respiratory-failure-niv-hfnc").includes("Cardiogenic pulmonary oedema: CPAP or bilevel NIV"));
  assert.equal(S.scenarios.find((s) => s.id === "cardiogenic-oedema").start.mode, "niv");
  assert.ok(kbText("diabetic-ketoacidosis").includes("pH below 7.0"));
});

test("learn.settings: a full card for every setting key", () => {
  const F = ["what", "controls", "up", "down", "oxygenation", "ventilation", "risks", "use", "pearl", "beginner"];
  SETTING_KEYS.forEach((k) => {
    assert.ok(L.settings[k], "settings." + k);
    F.forEach((f) => assert.ok(bi(L.settings[k][f]), `settings.${k}.${f}`));
  });
});

test("learn.modes: a full card for all 10 modes", () => {
  const F = ["controlled", "variable", "guarantees", "dependsOn", "when", "risks", "beginner"];
  assert.deepEqual(Object.keys(L.modes).sort(), [...MODES].sort());
  MODES.forEach((m) => F.forEach((f) => assert.ok(bi(L.modes[m][f]), `modes.${m}.${f}`)));
});

test("learn.levels: 4 cumulative levels, level 1 is the beginner set", () => {
  assert.deepEqual(L.levels.map((l) => l.n), [1, 2, 3, 4]);
  assert.deepEqual([...L.levels[0].shows].sort(), [...LEVEL1].sort());
  L.levels.forEach((l, i) => {
    assert.ok(bi(l.title) && bi(l.intro));
    if (i) l.shows.length && L.levels[i - 1].shows.forEach((k) => assert.ok(l.shows.includes(k), `level ${l.n} keeps ${k}`));
  });
  ["cstat", "raw", "ppeak", "pplat", "ie", "autoPeep", "vdvt", "ve"].forEach((k) => assert.ok(L.levels[1].shows.includes(k), "L2 " + k));
  ["drivingP", "mechPower", "dyssync", "flowStarvation", "trigFlow", "cycle", "recruitment", "lungProtection"]
    .forEach((k) => assert.ok(L.levels[2].shows.includes(k), "L3 " + k));
  ["waveforms", "alarms", "dope"].forEach((k) => assert.ok(L.levels[3].shows.includes(k), "L4 " + k));
});

test("learn.tutorials: the 8 tutorials with drivable steps", () => {
  assert.deepEqual(L.tutorials.map((t) => t.id), TUTORIALS);
  for (const t of L.tutorials) {
    assert.ok(bi(t.title) && t.steps.length >= 5, t.id);
    assert.ok(t.steps[0].do && SCENARIOS.includes(t.steps[0].do.scenario), t.id + " starts by loading a scenario");
    t.steps.forEach((s, i) => {
      assert.ok(bi(s.say), `${t.id}[${i}].say`);
      if (s.do) {
        const ok = (s.do.scenario && SCENARIOS.includes(s.do.scenario)) || (s.do.mode && MODES.includes(s.do.mode)) ||
          (SETTING_KEYS.includes(s.do.key) && typeof s.do.to === "number");
        assert.ok(ok, `${t.id}[${i}].do`);
      }
      if (s.expect) assert.ok(typeof s.expect.key === "string" && ["up", "down"].includes(s.expect.direction), `${t.id}[${i}].expect`);
      if (s.highlight) assert.ok(Array.isArray(s.highlight) && s.highlight.length);
    });
    assert.ok(t.steps.some((s) => s.expect), t.id + " has at least one checked expectation");
  }
});

test("learn.alarms and learn.dyssync cover every id", () => {
  assert.deepEqual(Object.keys(L.alarms).sort(), [...ALARMS].sort());
  ALARMS.forEach((id) => {
    const a = L.alarms[id];
    assert.ok(a.causes.length >= 2 && a.causes.every(bi) && bi(a.clue) && a.steps.length >= 3 && a.steps.every(bi) && bi(a.fix), id);
  });
  ["pPeakHigh", "disconnect"].forEach((id) => assert.ok(JSON.stringify(L.alarms[id]).includes("DOPE"), id + " teaches DOPE"));
  assert.deepEqual(Object.keys(L.dyssync).sort(), [...DYSSYNC].sort());
  DYSSYNC.forEach((k) => {
    const d = L.dyssync[k];
    ["name", "clue", "cause", "fix"].forEach((f) => assert.ok(bi(d[f]), `${k}.${f}`));
    assert.ok(d.quiz.options.length >= 3 && d.quiz.options.every(bi), k + " quiz options");
    assert.ok(Number.isInteger(d.quiz.answer) && d.quiz.answer >= 0 && d.quiz.answer < d.quiz.options.length, k + " quiz answer");
    assert.equal(d.quiz.options[d.quiz.answer].en, d.name.en, k + " quiz answer is the pattern's own name");
  });
});

test("learn.cases: at least 12 ABG cases, one correct answer each, consistent numbers", () => {
  assert.ok(L.cases.length >= 12);
  assert.equal(new Set(L.cases.map((c) => c.id)).size, L.cases.length);
  for (const c of L.cases) {
    assert.ok(SCENARIOS.includes(c.scenario), c.id + " scenario");
    const g = c.abg;
    ["pH", "PaCO2", "PaO2", "HCO3", "SaO2", "FiO2"].forEach((k) => assert.equal(typeof g[k], "number", c.id + " abg." + k));
    const hh = 6.1 + Math.log10(g.HCO3 / (0.03 * g.PaCO2));
    assert.ok(Math.abs(hh - g.pH) <= 0.05, `${c.id} pH ${g.pH} vs Henderson-Hasselbalch ${hh.toFixed(2)}`);
    assert.ok(g.FiO2 >= 0.21 && g.FiO2 <= 1);
    for (const q of [c.q1, c.q2]) {
      assert.ok(bi(q.ask) && bi(q.why), c.id + " ask/why");
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, c.id + " one answer index");
    }
    assert.ok(c.q1.options.length >= 3 && c.q1.options.every(bi));
    assert.ok(c.q2.options.length >= 3);
    c.q2.options.forEach((o) => {
      assert.ok(bi(o.label) && SETTING_KEYS.includes(o.change.key) && typeof o.change.to === "number", c.id + " change");
    });
    const sig = c.q2.options.map((o) => o.change.key + "=" + o.change.to);
    assert.equal(new Set(sig).size, sig.length, c.id + " options are distinct, so exactly one is correct");
  }
});

/* ---------- clinical review regressions (content) ---------- */
const caseBy = (id) => L.cases.find((c) => c.id === id);
const scBy = (id) => S.scenarios.find((s) => s.id === id);

test("M7: rise time is a time, so up means slower pressure climb", () => {
  assert.match(L.settings.rise.up.en, /Longer rise time: pressure climbs more slowly/);
  assert.match(L.settings.rise.down.en, /Shorter rise time: pressure climbs faster/);
  assert.equal(L.whatIf.find((w) => w.key === "rise" && w.label.en === "Faster rise").direction, "down");
  assert.equal(L.whatIf.find((w) => w.key === "rise" && w.label.en === "Slower rise").direction, "up");
});

test("M10: abg-07 keyed answer is defensible by the Boston rules", () => {
  const c = caseBy("abg-07"), g = c.abg, acute = 24 + 0.1 * (g.PaCO2 - 40), chronic = 24 + 0.35 * (g.PaCO2 - 40);
  assert.ok(g.HCO3 > acute + 1 && g.HCO3 < chronic - 1, `HCO3 ${g.HCO3} between acute ${acute} and chronic ${chronic}: acute on chronic`);
  assert.ok(g.pH < 7.3, "the acute component shows as acidaemia");
  assert.match(c.q1.options[c.q1.answer].en, /Acute respiratory acidosis on top of chronic/);
  assert.ok(c.q2.ask.en.includes("Total PEEP is 7.4"), "ask quotes the model's total PEEP");
});

test("m1 to m8: case and card wording from the review", () => {
  const o12 = caseBy("abg-12").q2.options[caseBy("abg-12").q2.answer];
  assert.deepEqual(o12.change, { key: "vt", to: 420, also: { rr: 30 } });
  assert.equal(o12.label.en, "Lower VT to 420 mL and raise rate to 30");
  assert.match(caseBy("abg-05").q2.why.en, /A small PEEP trial, 8 to 10, is still reasonable/);
  assert.ok(caseBy("abg-07").q2.options.some((o) => o.change.key === "ti" && o.change.to === 2));
  const c10 = caseBy("abg-10");
  c10.q1.options.forEach((o) => { const m = o.en.match(/PaCO2 is (\d+)/); if (m) assert.equal(+m[1], c10.abg.PaCO2, "distractor quotes the gas"); });
  assert.match(L.settings.pinsp.pearl.en, /only if inspiratory flow reaches zero and there is no auto-PEEP/);
  assert.equal(L.modes.pc.guarantees.en, "Airway pressure never exceeds PEEP plus the set pressure.");
  assert.ok(L.settings.fio2.pearl.hi.includes("PEEP बढ़ाने पर विचार करें"));
  // m8: the oxygen tutorial makes VT protective before anything else
  const tut = L.tutorials.find((t) => t.id === "fio2-peep"), at = scBy("postop-atelectasis"), kg = pbw(at.patient.sex, at.patient.heightCm);
  const firstSet = tut.steps.find((s) => s.do && s.do.key);
  assert.ok(firstSet.do.key === "vt" && firstSet.do.to / kg <= 8, "first change is VT " + firstSet.do.to);
});

test("m11 to m14: plateau fix, SpO2 target source, GINA, Hindi patient word", () => {
  assert.match(L.alarms.pPlatHigh.fix.en, /Raise the rate to hold pH/);
  for (const s of S.scenarios) if (s.goals.spo2[0] === 92 && s.goals.spo2[1] === 96)
    assert.ok(s.sources.some((x) => /Siemieniuk/.test(x.label) && /k4169/.test(x.label)), s.id + " cites the BMJ 2018 Rapid Recommendation");
  assert.ok(scBy("asthma").sources.some((x) => /GINA 2026/.test(x.label) && /ginasthma\.org/.test(x.url)), "GINA 2026 (published May 2026) with its link");
  assert.ok(L.disclaimer.hi.includes("मरीज़"));
  if (E) assert.ok(E.disclaimer.hi.includes("मरीज़"));
  assert.ok(!/रोगी/.test(JSON.stringify(L) + JSON.stringify(S)), "one Hindi word for patient");
});

test("M9/m9: conditional timeline events are well formed; trauma has no scripted drain", () => {
  for (const s of S.scenarios) for (const e of s.timeline) if (e.requires) {
    const list = Array.isArray(e.requires) ? e.requires : [e.requires];
    assert.ok(list.length > 0, s.id + " requires list is empty");
    for (const r of list) assert.ok((r.action && (!E || E.ACTIONS[r.action])) || (SETTING_KEYS.includes(r.key) && typeof r.min === "number"), s.id + " requires");
  }
  assert.ok(scBy("cardiogenic-oedema").timeline.find((e) => e.event === "improve").requires, "oedema improvement needs adequate support");
  assert.ok(!scBy("trauma-contusion").timeline.some((e) => e.event === "improve"), "the learner places the drain");
});

test("learn.whatIf: every main setting both ways, full cause-effect chain", () => {
  MAIN_WHATIF.forEach((k) => ["up", "down"].forEach((d) => {
    const w = L.whatIf.find((x) => x.key === k && x.direction === d);
    assert.ok(w && bi(w.label), `whatIf ${k} ${d}`);
    assert.deepEqual(w.chain.map((c) => c.step), CHAIN, `whatIf ${k} ${d} chain order`);
    w.chain.forEach((c) => assert.ok(bi(c.text)));
  }));
});

test("learn.glossary and disclaimer", () => {
  assert.ok(Object.keys(L.glossary).length >= 30);
  Object.entries(L.glossary).forEach(([k, v]) => assert.ok(/^[a-z0-9-]+$/.test(k) && bi(v), "glossary " + k));
  ["pbw", "driving-pressure", "plateau-pressure", "auto-peep", "shunt", "dead-space", "dope"].forEach((k) => assert.ok(L.glossary[k], k));
  assert.equal(L.disclaimer.en, "Educational simulator. Not a real ventilator and not a guide to treating a real patient.");
  assert.ok(bi(L.disclaimer));
});

test("language: bilingual, Hindi with ASCII digits, no dashes, short English sentences", () => {
  for (const [name, f] of [["scenarios", S], ["learn", L]]) {
    assert.ok(!DASHES.test(JSON.stringify(f)), name + " has no en or em dash");
    eachBi(f, (o, path) => {
      assert.ok(bi(o), name + path + " needs en and hi");
      assert.ok(DEVANAGARI.test(o.hi), name + path + " Hindi is in Devanagari");
      assert.ok(!HI_DIGIT.test(o.hi), name + path + " uses ASCII digits");
      assert.ok(!o.en.includes(" - ") && !o.hi.includes(" - "), name + path + " uses no hyphen as a dash");
      o.en.split(/(?<=[.!?])\s+/).forEach((s) => {
        assert.ok(s.split(/\s+/).length <= 20, `${name}${path}: sentence over 20 words: ${s}`);
      });
    });
  }
});
