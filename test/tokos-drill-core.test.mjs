// Branching timed drills (tokos/drill/<id>.json via tokos-models/drill-core.js): schema, ideal path scores 100,
// every critical step missed (wrong, skipped, late) is caught, generated model files are in sync, and the
// doses in the drills match the app's reviewed-protocol files word for word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { render, drillIds } from "../tools/tokos-build-drills.mjs";

const require = createRequire(import.meta.url);
const core = require("../tokos-models/drill-core.js");
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const IDS = ["breech", "collapse", "eclampsia", "pph", "shoulder", "twins"];
const LEVEL = { pph: "mbbs", eclampsia: "mbbs", shoulder: "mbbs", breech: "resident", twins: "resident", collapse: "resident" };

test("all six drills exist and nothing else is in tokos/drill", () => assert.deepEqual(drillIds(), IDS));

for (const id of IDS) {
  const data = JSON.parse(read(`tokos/drill/${id}.json`));
  const model = require(`../tokos-models/drill-${id}.js`);
  const ideal = () => structuredClone(model.idealAttempt());

  test(`${id}: schema valid, level, generated model in sync`, () => {
    assert.deepEqual(core.validate(data), []);
    assert.equal(data.level, LEVEL[id]);
    assert.equal(read(`tokos-models/drill-${id}.js`), render(data), "run node tools/tokos-build-drills.mjs");
    assert.equal(model.id, id); assert.equal(model.kind, "drill"); assert.equal(typeof model.score, "function");
    assert.deepEqual(model.stages, data.stages);
  });

  test(`${id}: the ideal path scores 100 with no critical misses`, () => {
    const r = model.score(ideal());
    assert.equal(r.pct, 100); assert.deepEqual(r.criticalMisses, []);
    assert.equal(r.lines.length, 1);
  });

  const critical = model.idealPath().filter((sid) => data.stages.find((s) => s.id === sid).options.find((o) => o.correct).critical);
  test(`${id}: has critical steps (${critical.join(", ")})`, () => assert.ok(critical.length >= 3));

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

test("only the first answer to a stage counts, so a remediation loop cannot rescue a critical miss", () => {
  const pph = require("../tokos-models/drill-pph.js");
  const a = pph.idealAttempt();
  a.choices.splice(0, 1, { stage: "recognise", option: "b", atSec: 10 }, { stage: "delay", option: "a", atSec: 20 }, { stage: "recognise", option: "a", atSec: 30 });
  const r = pph.score(a);
  assert.deepEqual(r.criticalMisses.map((m) => m.stage), ["recognise"]);
  assert.equal(r.pct, Math.round(100 * 8 / 9)); // off-path "delay" is not scored
});

test("validate catches broken drills", () => {
  const d = JSON.parse(read("tokos/drill/pph.json"));
  d.stages[0].options[1].next = "nowhere"; d.stages[1].options.forEach((o) => { o.correct = false; });
  d.title.en = "PPH \u2014 drill"; d.stages[2].prompt.hi = "\u0967";
  const errs = core.validate(d).join(" | ");
  for (const bit of ["not found", "exactly one correct", "em-dash", "Devanagari"]) assert.ok(errs.includes(bit), bit);
});

// Every dose the drills teach, pinned to the app's protocol files (kb/clinical-protocols, ICMR and FOGSI).
const PINS = {
  pph: ["postpartum-haemorrhage-india", ["16 to 18 G", "15 to 20 minutes", "6 to 8 L/min", "10 IU IM", "20 IU in 500 mL", "40 to 60 drops/min",
    "1 g", "over 10 minutes", "3 hours", "30 minutes", "10 to 20 units/h", "800 micrograms", "250 micrograms", "every 20 minutes", "8 doses", "0.2 mg", "100 IU in 24 hours"]],
  eclampsia: ["pre-eclampsia-eclampsia-india", ["4 g", "20 mL of 20%", "12 mL distilled water", "1 g per minute", "5 g of 50%", "0.5 mL of 2% lignocaine", "14 g",
    "80 mL/h", "10 to 30 mg", "30 to 45 minutes", "120 mg", "10 to 20 mg", "20 to 80 mg", "every 20 to 30 minutes", "300 mg", "10 mL of 10% calcium gluconate", "over 10 minutes", "24 hours"]]
};
for (const [id, [proto, pins]] of Object.entries(PINS)) {
  test(`${id}: every pinned dose appears in both the drill and kb/clinical-protocols/${proto}.json`, () => {
    const drill = read(`tokos/drill/${id}.json`), p = read(`kb/clinical-protocols/${proto}.json`);
    for (const pin of pins) {
      assert.ok(drill.includes(pin), `drill ${id} lacks "${pin}"`);
      assert.ok(p.includes(pin), `protocol ${proto} lacks "${pin}"`);
    }
  });
}

test("a stage's time is its own clock (spentSec): reading the previous feedback is not charged as slowness", () => {
  const sh = require("../tokos-models/drill-shoulder.js");
  // Each step answered 10 s into its own stage clock, with 25 s spent reading the feedback before Continue.
  let t = 0;
  const choices = sh.idealPath().map((sid) => {
    t += 10;
    const c = { stage: sid, option: sh.stages.find((s) => s.id === sid).options.find((o) => o.correct).id, atSec: t, spentSec: 10 };
    t += 25;
    return c;
  });
  const r = sh.score({ choices });
  assert.equal(r.pct, 100); assert.deepEqual(r.criticalMisses, []);
  // Over the stage's own budget is still late.
  const slow = structuredClone(choices); slow[1].spentSec = 31;
  assert.deepEqual(sh.score({ choices: slow }).criticalMisses.map((m) => [m.stage, m.reason]), [["mcroberts", "late"]]);
});

test("no option without next falls through to an off-path consequence stage", () => {
  for (const id of IDS) {
    const d = JSON.parse(read(`tokos/drill/${id}.json`)), ideal = new Set(core.idealPath(d));
    d.stages.forEach((s, i) => s.options.forEach((o) => {
      if (o.next) return;
      const n = d.stages[i + 1];
      assert.ok(!n || ideal.has(n.id), `${id} ${s.id}.${o.id} falls into ${n && n.id}`);
    }));
  }
});

test("per-step time budgets fit inside each drill's time limit", () => {
  for (const id of IDS) {
    const d = JSON.parse(read(`tokos/drill/${id}.json`));
    const sum = core.idealPath(d).reduce((a, sid) => a + (d.stages.find((s) => s.id === sid).timeSec || 0), 0);
    assert.ok(!d.timeLimitSec || sum <= d.timeLimitSec, `${id}: ${sum} > ${d.timeLimitSec}`);
  }
});
