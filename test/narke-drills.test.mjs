// Narkē crisis drills (narke/drill/<id>.json via the shared drill core): schema, ideal path scores 100,
// every critical step missed (wrong, skipped, late) is caught, generated models are in sync, the copied
// core is byte-identical to Tokós, and every pinned dose appears in both the drill and its kb protocol.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { render, drillIds } from "../tools/tokos-build-drills.mjs";

const require = createRequire(import.meta.url);
const core = require("../narke-models/drill-core.js");
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const LEVEL = {
  bls: "mbbs", als: "mbbs", anaphylaxis: "mbbs", paedarrest: "mbbs",
  cico: "resident", last: "resident", mh: "resident", highspinal: "resident",
  laryngospasm: "resident", bronchospasm: "resident", haemorrhage: "resident", aspiration: "resident"
};
const IDS = Object.keys(LEVEL).sort();

// Drills whose doses come from an app protocol must cite it as a source.
const CITES = {
  bls: ["adult-cardiac-arrest"], als: ["adult-cardiac-arrest", "post-cardiac-arrest-care"], anaphylaxis: ["anaphylaxis"],
  paedarrest: ["paediatric-cardiac-arrest"], last: ["local-anaesthetic-systemic-toxicity"], mh: ["malignant-hyperthermia"],
  haemorrhage: ["blood-transfusion"]
};

// Every dose, energy and timing the drills teach, pinned to the app's protocol files word for word.
const PINS = {
  bls: [["adult-cardiac-arrest", ["10 seconds", "100 to 120/min", "at least 5 cm (not more than 6 cm)", "30:2", "100% oxygen", "under 5 seconds", "every 2 minutes"]],
    ["post-cardiac-arrest-care", ["94 to 98%"]]],
  als: [["adult-cardiac-arrest", ["1 mg", "every 3 to 5 minutes", "300 mg", "150 mg", "after the 3rd shock", "at least 150 J", "120 to 200 J", "360 J",
    "10 breaths/min", "after 2 attempts", "calcium chloride 10% 10 mL", "10 units with glucose 25 g (50 mL of 50% glucose)", "sodium bicarbonate 8.4% 50 mmol", "under 5 seconds"]],
    ["post-cardiac-arrest-care", ["94 to 98%", "35 to 45 mmHg", "65 mmHg or more"]]],
  anaphylaxis: [["anaphylaxis", ["500 micrograms (0.5 mL", "anterolateral mid-thigh", "after 5 minutes", "500 to 1000 mL", "3 to 5 L", "1 mg in 100 mL 0.9% saline",
    "0.5 mL/kg/h", "50 micrograms", "2 doses", "1 to 2 hours", "at least 24 hours", "5 mg", "94 to 98%"]]],
  paedarrest: [["paediatric-cardiac-arrest", ["0.01 mg/kg", "0.1 mg/mL", "every 3 to 5 minutes", "within 5 minutes", "below 60/min", "100 to 120/min", "15:2",
    "one-third", "2 J/kg", "4 J/kg", "10 J/kg", "5 mg/kg", "every 2 to 3 seconds", "94 to 99%", "35 to 45 mmHg", "37.5", "10th centile", "under 10 seconds"]]],
  last: [["local-anaesthetic-systemic-toxicity", ["1.5 mL/kg", "over 1 minute", "15 mL/kg/h", "0.25 mL/kg/min", "30 mL/kg/h", "12 mL/kg", "1 mcg/kg", "20 mg increments",
    "0.1 mg/kg", "max 4 mg", "300 mg", "at least 15 minutes", "5 minutes apart", "2 repeat boluses", "100% oxygen", "20% lipid emulsion"]]],
  mh: [["malignant-hyperthermia", ["2.5 mg/kg", "1 mg/kg IV every 5 minutes", "60 mL sterile water", "7 to 9 vials", "10 L/min", "2 to 3 times normal", "10 mg/kg IV (max 2 g)",
    "2000 to 3000 mL", "4 to 8 C", "38.5 C", "2 mL/kg/h", "24 hours", "25%", "50 mL of 50% glucose", "10 units", "every 10 minutes", "10 mg/kg"]]],
  haemorrhage: [["major-haemorrhage-trauma", ["1:1", "1:1:1", "1 g IV over 10 minutes", "1 g over 8 hours", "3 hours", "SBP 80 to 90 mmHg (MAP 50 to 60 mmHg)", "MAP 80 mmHg or more",
    "36 to 37°C", "10 mL IV", "1.1 to 1.3 mmol/L", "0.9 mmol/L", "1.5 g/L or less", "3 to 4 g", "above 50 x 10^9/L", "7 to 9 g/dL", "every 30 to 60 minutes", "within 24 hours", "1.5 times normal"]],
    ["blood-transfusion", ["15 mL/kg", "1 apheresis unit", "1.5 g/L"]]],
  // Guideline-led drills (DAS, AIDAA, textbooks): only their kb-backed doses are pinned.
  highspinal: [["adult-cardiac-arrest", ["1 mg IV", "aiming for 5 minutes", "left uterine displacement"]]],
  laryngospasm: [["paediatric-cardiac-arrest", ["below 60/min"]]],
  bronchospasm: [["acute-asthma-adult", ["2 g over 20 minutes", "100 mg IV every 6 hours"]], ["anaphylaxis", ["50 micrograms"]]]
};

test("all twelve drills exist and nothing else is in narke/drill", () => assert.deepEqual(drillIds("narke"), IDS));

test("narke-models/drill-core.js is a byte-identical copy of tokos-models/drill-core.js", () =>
  assert.equal(read("narke-models/drill-core.js"), read("tokos-models/drill-core.js"), "run node tools/tokos-build-drills.mjs --host narke"));

for (const id of IDS) {
  const data = JSON.parse(read(`narke/drill/${id}.json`));
  const model = require(`../narke-models/drill-${id}.js`);
  const ideal = () => structuredClone(model.idealAttempt());

  test(`${id}: schema valid, level, generated model in sync`, () => {
    assert.deepEqual(core.validate(data), []);
    assert.equal(data.level, LEVEL[id]);
    assert.equal(read(`narke-models/drill-${id}.js`), render(data, "narke"), "run node tools/tokos-build-drills.mjs --host narke");
    assert.ok(read(`narke-models/drill-${id}.js`).includes("G.NARKE_MODELS"));
    assert.equal(model.id, id); assert.equal(model.kind, "drill"); assert.equal(typeof model.score, "function");
    assert.deepEqual(model.stages, data.stages);
  });

  test(`${id}: cites its kb protocols, scenario is labelled as teaching, vitals render cleanly`, () => {
    const paths = data.sources.filter((s) => s.path).map((s) => s.path);
    for (const p of CITES[id] || []) assert.ok(paths.includes(`kb/clinical-protocols/${p}.json`), `${id} must cite ${p}`);
    for (const p of paths) assert.ok(read(p).length > 0, p);
    assert.match(data.scenario.en, /Teaching scenario, not a real patient\./);
    for (const s of data.stages) for (const [k, v] of Object.entries(s.vitals || {})) {
      if (v && typeof v === "object") {
        assert.ok(v.label && v.label.en && v.label.hi, `${id}.${s.id}.vitals.${k} label needs {en, hi}`);
        assert.ok(typeof v.value === "number" || typeof v.value === "string", `${id}.${s.id}.vitals.${k} value is printed raw`);
      } else assert.ok(typeof v === "number" || /^[0-9/.]+$/.test(v), `${id}.${s.id}.vitals.${k} = ${v}`);
    }
  });

  test(`${id}: the ideal path scores 100 with no critical misses`, () => {
    const r = model.score(ideal());
    assert.equal(r.pct, 100); assert.deepEqual(r.criticalMisses, []);
    assert.equal(r.lines.length, 1);
  });

  const critical = model.idealPath().filter((sid) => data.stages.find((s) => s.id === sid).options.find((o) => o.correct).critical);
  test(`${id}: has critical steps (${critical.join(", ")})`, () => assert.ok(critical.length >= 1));

  for (const sid of critical) {
    test(`${id}: skipping or getting "${sid}" wrong or late is a critical miss`, () => {
      const skip = ideal(); skip.choices = skip.choices.filter((c) => c.stage !== sid);
      let r = model.score(skip);
      assert.deepEqual(r.criticalMisses.map((m) => [m.stage, m.reason]), [[sid, "skipped"]]);
      assert.ok(r.pct < 100);

      const stage = data.stages.find((s) => s.id === sid);
      const wrong = ideal(); wrong.choices.find((c) => c.stage === sid).option = stage.options.find((o) => !o.correct).id;
      r = model.score(wrong);
      assert.deepEqual(r.criticalMisses.map((m) => [m.stage, m.reason]), [[sid, "wrong"]]);
      assert.ok(r.lines[0].en.includes(stage.prompt.en) && r.lines[0].hi.includes(stage.prompt.hi));

      if (stage.timeSec) {
        const late = ideal(); let at = 0;
        late.choices.forEach((c) => { at += c.stage === sid ? stage.timeSec + 1 : 1; c.atSec = at; });
        r = model.score(late);
        assert.deepEqual(r.criticalMisses.map((m) => [m.stage, m.reason]), [[sid, "late"]]);
      }
    });
  }
}

for (const [id, list] of Object.entries(PINS)) {
  for (const [proto, pins] of list) {
    test(`${id}: every pinned dose appears in both the drill and kb/clinical-protocols/${proto}.json`, () => {
      const drill = read(`narke/drill/${id}.json`), p = read(`kb/clinical-protocols/${proto}.json`);
      for (const pin of pins) {
        assert.ok(drill.includes(pin), `drill ${id} lacks "${pin}"`);
        assert.ok(p.includes(pin), `protocol ${proto} lacks "${pin}"`);
      }
    });
  }
}

test("every drill with a kb protocol has pins", () => {
  for (const id of Object.keys(CITES)) assert.ok(PINS[id] && PINS[id].some(([, p]) => p.length >= 5), id);
});

test("no option without next falls through to an off-path consequence stage", () => {
  for (const id of IDS) {
    const d = JSON.parse(read(`narke/drill/${id}.json`)), ideal = new Set(core.idealPath(d));
    d.stages.forEach((s, i) => s.options.forEach((o) => {
      if (o.next) return;
      const n = d.stages[i + 1];
      assert.ok(!n || ideal.has(n.id), `${id} ${s.id}.${o.id} falls into ${n && n.id}`);
    }));
  }
});

test("per-step time budgets are set and fit inside each drill's time limit", () => {
  for (const id of IDS) {
    const d = JSON.parse(read(`narke/drill/${id}.json`));
    assert.ok(d.timeLimitSec > 0, id);
    for (const s of d.stages) assert.ok(s.timeSec > 0, `${id}.${s.id} has no timeSec`);
    const sum = core.idealPath(d).reduce((a, sid) => a + d.stages.find((s) => s.id === sid).timeSec, 0);
    assert.ok(sum <= d.timeLimitSec, `${id}: ${sum} > ${d.timeLimitSec}`);
  }
});
