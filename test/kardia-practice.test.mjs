/* test/kardia-practice.test.mjs - Kardia WP10 practice pure helpers
 * (kardia-practice.js): drill sets by level, drill scoring, exam
 * marking with critical fails, knobology scoring and spot questions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const PR = require("../kardia-practice.js");
const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));

test("exports: pure helpers, module.exports, ES5 source", () => {
  for (const k of ["drillViewsForLevel", "examViews", "scoreDrill", "markExam", "scoreKnob", "buildSpotQuestion", "validateProtocol"]) {
    assert.equal(typeof PR[k], "function", k);
  }
  const src = readFileSync(new URL("../kardia-practice.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  assert.ok(!/[–—]/.test(src), "no em or en dashes");
});

test("drill sets by level: MBBS four, resident rest of TTE, fellow adds TEE", () => {
  const mbbs = PR.drillViewsForLevel("mbbs", views).map((v) => v.id);
  assert.deepEqual(mbbs.sort(), ["tte_a4c", "tte_plax", "tte_psax_papillary", "tte_subcostal_4c"]);
  const res = PR.drillViewsForLevel("resident", views);
  assert.ok(res.length > mbbs.length, "resident has more than MBBS");
  assert.ok(res.every((v) => v.modality === "tte"), "resident is TTE only");
  const tteCount = views.views.filter((v) => v.modality === "tte").length;
  assert.equal(res.length, tteCount, "resident adds the rest of TTE");
  const fel = PR.drillViewsForLevel("fellow", views);
  assert.ok(fel.some((v) => v.modality === "tee"), "fellow adds TEE");
  assert.ok(fel.length > res.length);
  const son = PR.drillViewsForLevel("sonographer", views);
  assert.equal(son.length, fel.length, "sonographer shares the full view catalogue (knobology is separate)");
  assert.deepEqual(PR.drillViewsForLevel("mbbs", null), []);
  assert.deepEqual(PR.drillViewsForLevel("mbbs", { views: [] }), []);
});

test("exam views are the five station views in fixed protocol order", () => {
  const list = PR.examViews(views);
  assert.deepEqual(list.map((v) => v.id), PR.EXAM_VIEWS);
  assert.equal(list.length, 5);
  assert.ok(list.every((v) => v.name && v.name !== v.id || v.id === "tte_subcostal_ivc"), "names resolve from the catalogue");
});

test("counts read singular and plural: 1 second, 2 seconds, 0 seconds", () => {
  assert.equal(PR.countUnit(1, "second"), "1 second");
  assert.equal(PR.countUnit(2, "second"), "2 seconds");
  assert.equal(PR.countUnit(0, "second"), "0 seconds");
  assert.equal(PR.countUnit(20, "second"), "20 seconds");
  assert.equal(PR.countUnit(1, "degree"), "1 degree");
  assert.equal(PR.unitWord(1, "second", "seconds"), "second");
  assert.equal(PR.unitWord(0.4, "second", "seconds"), "seconds");
  const one = PR.scoreDrill({ elapsedSec: 1, quality: 100, achieved: true });
  assert.match(one.line, /in 1 second at quality/, "achieved in a second, got: " + one.line);
  assert.ok(!/1 seconds/.test(one.line), "no '1 seconds'");
  const two = PR.scoreDrill({ elapsedSec: 2, quality: 100, achieved: true });
  assert.match(two.line, /in 2 seconds at quality/);
  const limit1 = PR.scoreDrill({ elapsedSec: 9, quality: 10, achieved: false, limitSec: 1 });
  assert.match(limit1.line, /within 1 second\./);
});

test("angle readouts: proper minus, degree sign, words for screen readers", () => {
  assert.equal(PR.degStr(-180), "−180°");
  assert.equal(PR.degStr(-7), "−7°");
  assert.equal(PR.degStr(0), "0°");
  assert.equal(PR.degStr(6), "6°");
  assert.ok(!/-/.test(PR.degStr(-180)), "no hyphen-minus in a negative readout");
  assert.equal(PR.degText(-180), "minus 180 degrees");
  assert.equal(PR.degText(-7), "minus 7 degrees");
  assert.equal(PR.degText(1), "1 degree");
  assert.equal(PR.degText(0), "0 degrees");
});

test("drill scoring: achieved beats fast, timeout caps the score", () => {
  const fast = PR.scoreDrill({ elapsedSec: 5, quality: 95, achieved: true });
  const slow = PR.scoreDrill({ elapsedSec: 19, quality: 95, achieved: true });
  assert.ok(fast.pct > slow.pct, "faster scores higher at equal quality");
  assert.ok(fast.ok && fast.grade >= 3);
  const missed = PR.scoreDrill({ elapsedSec: 20, quality: 95, achieved: false });
  assert.equal(missed.achieved, false);
  assert.ok(missed.pct <= 40, "unachieved caps at 40 percent, got " + missed.pct);
  assert.equal(missed.ok, false);
  const poor = PR.scoreDrill({ elapsedSec: 8, quality: 40, achieved: true });
  assert.equal(poor.ok, false, "achieved at poor quality is not ok");
  const zero = PR.scoreDrill({});
  assert.equal(zero.pct, 0);
  assert.equal(zero.grade, 1);
});

test("exam marking: critical fail for unachieved view or wrong orientation", () => {
  const good = PR.EXAM_VIEWS.map((id) => ({ viewId: id, achieved: true, quality: 90, elapsedSec: 30, angleDeg: 4 }));
  const pass = PR.markExam(good);
  assert.equal(pass.passed, true);
  assert.equal(pass.criticalFails.length, 0);
  assert.ok(pass.pct >= PR.EXAM_PASS_MARK);

  const missed = good.map((s, i) => (i === 2 ? { ...s, achieved: false, quality: 30 } : s));
  const rMissed = PR.markExam(missed);
  assert.equal(rMissed.passed, false, "one unachieved view fails the exam");
  assert.equal(rMissed.criticalFails.length, 1);
  assert.match(rMissed.criticalFails[0].reason, /not achieved/i);

  const flipped = good.map((s, i) => (i === 0 ? { ...s, angleDeg: 45 } : s));
  const rFlipped = PR.markExam(flipped);
  assert.equal(rFlipped.passed, false, "wrong orientation fails even when achieved");
  assert.match(rFlipped.criticalFails[0].reason, /orientation/i);

  const weak = PR.EXAM_VIEWS.map((id) => ({ viewId: id, achieved: true, quality: 55, elapsedSec: 50, angleDeg: 5 }));
  const rWeak = PR.markExam(weak);
  assert.equal(rWeak.passed, false, "below the pass mark without criticals still fails");
  assert.equal(rWeak.criticalFails.length, 0);

  assert.equal(PR.markExam([]).passed, false);
});

test("knobology: each degraded scenario is unfixed at start and fixed at target", () => {
  assert.ok(PR.KNOB_SCENARIOS.length >= 5);
  const ids = PR.KNOB_SCENARIOS.map((s) => s.id);
  for (const want of ["gain-high", "depth-wrong", "focus-off", "tgc-banding", "frequency-wrong"]) {
    assert.ok(ids.includes(want), "scenario " + want);
  }
  for (const sc of PR.KNOB_SCENARIOS) {
    const atStart = PR.scoreKnob(sc.start, sc);
    assert.equal(atStart.allFixed, false, sc.id + " starts unfixed");
    const atTarget = PR.scoreKnob(sc.target, sc);
    assert.equal(atTarget.allFixed, true, sc.id + " target is fully fixed");
    assert.equal(atTarget.pct, 100);
    assert.equal(atTarget.fixedCount, atTarget.totalKnobs);
  }
  const one = PR.scoreKnob({ ...PR.KNOB_TARGET, gainDb: 3 }, PR.KNOB_SCENARIOS[0]);
  assert.equal(one.perKnob.gainDb.fixed, true, "small gain error is within tolerance");
  const off = PR.scoreKnob({ ...PR.KNOB_TARGET, gainDb: 20 }, PR.KNOB_SCENARIOS[0]);
  assert.equal(off.perKnob.gainDb.fixed, false);
});

test("spot question: four options, one answer, deterministic per seed", () => {
  const pool = ["mitral_stenosis", "aortic_stenosis", "mitral_regurgitation", "pericardial_effusion", "lv_thrombus"];
  const names = Object.fromEntries(pool.map((id) => [id, "Name " + id]));
  const q = PR.buildSpotQuestion(pool, names, "seed-1");
  assert.ok(q);
  assert.equal(q.options.length, 4);
  assert.ok(q.answer >= 0 && q.answer < 4);
  assert.equal(q.options[q.answer].id, q.pathology);
  assert.equal(new Set(q.options.map((o) => o.id)).size, 4, "options are distinct");
  assert.deepEqual(PR.buildSpotQuestion(pool, names, "seed-1"), q, "same seed, same question");
  assert.equal(PR.buildSpotQuestion(["a", "b"], names, "x"), null, "fewer than four pathologies cannot build a question");
  assert.equal(PR.buildSpotQuestion([], names, "x"), null);
});
