// The 12 Narke anaesthesia calculators: contract, pinned examples, rejections and the source facts each one states.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load, shape, examples, rejects } from "./narke-tool-helpers.mjs";

const TOOLS = createRequire(import.meta.url)("../specialty-tools.js");
const LEVEL = { asa: "mbbs", "maintenance-fluids": "mbbs", "fasting-deficit": "mbbs", mabl: "mbbs", "la-maxdose": "mbbs", "paeds-ett": "mbbs", stopbang: "mbbs", apfel: "mbbs",
  "dosing-weight": "resident", rcri: "resident", "pf-ratio": "resident", "airway-predict": "resident" };
const BAD = {
  asa: [{}, { cls: "7" }, { cls: "0" }],
  "maintenance-fluids": [{}, { weight: 2, sex: "m" }, { weight: 20, sex: "x" }, { weight: 200, sex: "f" }],
  "fasting-deficit": [{}, { weight: 20, hours: 0 }, { weight: 20, hours: 30 }, { weight: 1, hours: 6 }],
  mabl: [{}, { weight: 70, group: "m", hi: 30, hf: 30 }, { weight: 70, group: "z", hi: 40, hf: 30 }, { weight: 70, group: "m", hi: 90, hf: 30 }],
  "la-maxdose": [{}, { drug: "x", weight: 70 }, { drug: "lido", weight: 0 }, { drug: "lido", weight: 70, conc: 10 }],
  "paeds-ett": [{}, { mode: "child", age: 0.5 }, { mode: "child", age: 14 }, { mode: "neonate", weight: 8 }],
  "dosing-weight": [{}, { sex: "m", height: 90, weight: 70 }, { sex: "f", height: 160, weight: 10 }, { sex: "x", height: 170, weight: 70 }],
  stopbang: [], apfel: [], rcri: [],
  "pf-ratio": [{}, { pao2: 80, unit: "mmHg", fio2: 0.1 }, { pao2: 80, unit: "mmHg", fio2: 50 }, { pao2: 80, unit: "x", fio2: 0.5 }, { pao2: 80, unit: "mmHg", fio2: 0.5, peep: 40 }],
  "airway-predict": [{}, { mp: "5", neck: "normal", ulbt: "1" }, { mp: "1", neck: "normal", ulbt: "1", mouth: 12 }, { mp: "1", neck: "x", ulbt: "1" }]
};

for (const id of Object.keys(LEVEL)) {
  const m = load(id);
  test(`${id}: shape, level, contract and ES5`, () => {
    shape(m, id);
    assert.equal(m.level, LEVEL[id]);
    assert.ok(m.examples.length >= 3, "at least 3 pinned examples");
    assert.deepEqual(TOOLS.validateTool(m), []);
    assert.ok(TOOLS.runExamples(m).every((x) => x.ok), "runExamples all pass");
    const src = readFileSync(new URL(`../narke-models/tool-${id}.js`, import.meta.url), "utf8");
    assert.ok(!/[–—]/.test(src), "no en or em dash");
    assert.ok(!/\b(let|const)\s+\w+\s*=|\bclass\s+\w+\s*(extends\b|\{)|=>|`|\.includes\(|Math\.imul|\.\.\.\w/.test(src), "ES5 only");
    assert.match(src, /root\.NARKE_MODELS/);
  });
  test(`${id}: every example matches its source`, () => examples(m));
  if (BAD[id].length) test(`${id}: invalid inputs give ok:false with en and hi error`, () => rejects(m, BAD[id]));
}

const en = (r) => r.lines.map((l) => l.en).join(" ");

test("maintenance-fluids: NICE NG29 cap and isotonic advice", () => {
  const m = load("maintenance-fluids"), r = m.compute({ weight: 70, sex: "f" });
  assert.match(en(r), /Capped at 2000 mL/); assert.match(en(r), /131 to 154 mmol\/L/);
  assert.doesNotMatch(en(m.compute({ weight: 30, sex: "m" })), /Capped/);
});

test("fasting-deficit: 50/25/25 schedule on top of maintenance", () => {
  const r = load("fasting-deficit").compute({ weight: 20, hours: 6 });
  assert.match(en(r), /Hour 1: .*240 mL/); assert.match(en(r), /Hours 2 and 3: .*150 mL each/);
});

test("mabl: SPA worked case inputs at 80 mL/kg (Morgan and Mikhail infant) give 253 mL by the Gross variant", () => {
  assert.match(en(load("mabl").compute({ weight: 6, group: "i", hi: 36, hf: 21 })), /Gross variant.*: 253 mL/);
});

test("la-maxdose: mg/kg and caps match the app's LAST protocol", () => {
  const kb = readFileSync(new URL("../kb/clinical-protocols/local-anaesthetic-systemic-toxicity.json", import.meta.url), "utf8");
  for (const s of ["lidocaine plain 3 mg/kg, max 200 mg", "plain 4.5 mg/kg (max 300 mg)", "with adrenaline 7 mg/kg (max 500 mg)", "levobupivacaine 2 mg/kg (max 150 mg)", "ropivacaine 3 mg/kg (max 200 mg)"]) assert.ok(kb.includes(s), s);
  const L = load("la-maxdose").compute({ drug: "lido", weight: 70, conc: 1 });
  assert.equal(L.value, 200, "UK default: 70 kg x 3 mg/kg = 210 mg, capped at 200 mg"); assert.equal(L.ml, 20);
  assert.match(en(L), /US\/ASRA references allow 4\.5 mg\/kg, max 300 mg/);
  const r = load("la-maxdose").compute({ drug: "bupi", weight: 50 });
  assert.equal(r.ok, true); assert.equal(r.ml, null);
});

test("paeds-ett: over 3 kg offers 3.5 or 4.0", () => {
  assert.match(load("paeds-ett").compute({ mode: "neonate", weight: 3.5 }).label.en, /3\.5 or 4\.0/);
});

test("pf-ratio: no grade without PEEP of 5 or more", () => {
  const r = load("pf-ratio").compute({ pao2: 80, unit: "mmHg", fio2: 0.5, peep: 3 });
  assert.equal(r.band, undefined); assert.match(r.label.en, /not graded/);
});

test("airway-predict: lists predictors, never a probability", () => {
  const r = load("airway-predict").compute({ mp: "3", mouth: 2.5, tmd: 7, neck: "normal", ulbt: "1" });
  assert.doesNotMatch(r.label.en, /%/); assert.match(en(r), /not a probability/);
});
