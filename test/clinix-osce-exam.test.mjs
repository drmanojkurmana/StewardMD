/* test/clinix-osce-exam.test.mjs — examiner-marked OSCE exam engine tests.
 *
 * Requirements:
 * 1. Distractor builder gives 5 unique options with exactly one correct,
 *    never offers completed steps, deterministic per seed.
 * 2. scoreExam marks a perfect run 100% pass, a wrong critical pick fails on critical,
 *    an unsafe distractor fails, order scoring via longest increasing subsequence,
 *    time-up handling.
 * 3. Every station in every clinix/diseases/*.json and clinix/systems/*.json compiles
 *    and yields 5 options per step.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

import M from "../clinix-model.js";
import Exam from "../clinix-osce-exam.js";

/* ── 1. Distractor builder invariants ───────────────────────────────────────── */

test("distractor builder gives 5 unique options with exactly one correct", () => {
  const station = {
    id: "osce.test.station",
    title: "Test station",
    items: [
      { id: "s1/step1", skillId: "s1", text: "Wash hands with alcohol rub", critical: true, weight: 1 },
      { id: "s1/step2", skillId: "s1", text: "Introduce yourself and check identity", critical: true, weight: 1 },
      { id: "s1/step3", skillId: "s1", text: "Obtain informed verbal consent", critical: true, weight: 1 },
      { id: "s1/step4", skillId: "s1", text: "Position patient at 45 degrees", critical: false, weight: 1 },
      { id: "s1/step5", skillId: "s1", text: "Expose chest adequately maintaining dignity", critical: false, weight: 1 }
    ]
  };
  const phase = {
    skillId: "s1",
    title: "Approach",
    items: station.items
  };

  const opts = Exam.buildStepOptions(station.items[0], phase, station, null, {}, "seed:1");
  assert.equal(opts.length, 5, "must produce exactly 5 options");

  const correct = opts.filter((o) => o.isCorrect === true);
  assert.equal(correct.length, 1, "must have exactly one correct option");
  assert.equal(correct[0].text, "Wash hands with alcohol rub");

  const texts = opts.map((o) => o.text.trim().toLowerCase());
  const uniqueTexts = new Set(texts);
  assert.equal(uniqueTexts.size, 5, "all 5 options must have unique text");
});

test("distractor builder never offers completed steps", () => {
  const items = [
    { id: "s1/step1", skillId: "s1", text: "Wash hands", critical: true, weight: 1 },
    { id: "s1/step2", skillId: "s1", text: "Introduce self", critical: true, weight: 1 },
    { id: "s1/step3", skillId: "s1", text: "Obtain consent", critical: true, weight: 1 },
    { id: "s1/step4", skillId: "s1", text: "Position patient", critical: false, weight: 1 },
    { id: "s1/step5", skillId: "s1", text: "Inspect chest", critical: false, weight: 1 },
    { id: "s1/step6", skillId: "s1", text: "Palpate apex beat", critical: false, weight: 1 }
  ];
  const station = { id: "st1", items: items };
  const phase = { skillId: "s1", title: "Exam", items: items };

  const completed = {
    "s1/step1": true,
    "s1/step2": true
  };

  // We are at step 3. Steps 1 and 2 are completed.
  const opts = Exam.buildStepOptions(items[2], phase, station, null, completed, "seed:st1:step3");
  assert.equal(opts.length, 5);

  const offeredIds = opts.map((o) => o.id);
  assert.ok(!offeredIds.includes("s1/step1"), "must not offer completed step 1");
  assert.ok(!offeredIds.includes("s1/step2"), "must not offer completed step 2");
  assert.ok(opts.some((o) => o.id === "s1/step3" && o.isCorrect === true), "must offer step 3 as correct");
});

test("distractor builder is deterministic per seed", () => {
  const items = [
    { id: "s1/step1", skillId: "s1", text: "Step 1", critical: true, weight: 1 },
    { id: "s1/step2", skillId: "s1", text: "Step 2", critical: false, weight: 1 },
    { id: "s1/step3", skillId: "s1", text: "Step 3", critical: false, weight: 1 },
    { id: "s1/step4", skillId: "s1", text: "Step 4", critical: false, weight: 1 },
    { id: "s1/step5", skillId: "s1", text: "Step 5", critical: false, weight: 1 }
  ];
  const station = { id: "st1", items: items };
  const phase = { skillId: "s1", title: "Phase 1", items: items };

  const run1 = Exam.buildStepOptions(items[0], phase, station, null, {}, "fixed-seed-42");
  const run2 = Exam.buildStepOptions(items[0], phase, station, null, {}, "fixed-seed-42");
  const run3 = Exam.buildStepOptions(items[0], phase, station, null, {}, "different-seed-99");

  assert.deepEqual(run1, run2, "identical seed must produce identical options and order");
  assert.notDeepEqual(run1.map((o) => o.text), run3.map((o) => o.text), "different seeds produce different shuffle order");
});

test("distractor builder prioritizes authored distractors with unsafe flag support", () => {
  const items = [
    { id: "s1/step1", skillId: "s1", text: "Confirm bilateral air entry", critical: true, weight: 1 }
  ];
  const station = {
    id: "st1",
    items: items,
    distractors: [
      { text: "Inject 50ml potassium chloride undiluted", why: "Fatal injection error", unsafe: true },
      { text: "Administer high flow oxygen without check", why: "Contraindicated in severe hypercapnia" }
    ]
  };
  const phase = { skillId: "s1", title: "Airway", items: items };

  const opts = Exam.buildStepOptions(items[0], phase, station, null, {}, "seed:auth");
  const unsafeOpt = opts.find((o) => o.unsafe === true);
  assert.ok(unsafeOpt, "must include authored unsafe distractor");
  assert.match(unsafeOpt.text, /potassium chloride/i);
  assert.equal(unsafeOpt.why, "Fatal injection error");
  assert.equal(unsafeOpt.isCorrect, false);
});

/* ── 2. Scoring & Longest Increasing Subsequence ────────────────────────────── */

test("longestIncreasingSubsequence calculates optimal sequence length", () => {
  assert.equal(Exam.longestIncreasingSubsequence([]), 0);
  assert.equal(Exam.longestIncreasingSubsequence([0, 1, 2, 3]), 4);
  assert.equal(Exam.longestIncreasingSubsequence([0, 2, 1, 3]), 3);
  assert.equal(Exam.longestIncreasingSubsequence([3, 2, 1, 0]), 1);
  assert.equal(Exam.longestIncreasingSubsequence([10, 22, 9, 33, 21, 50, 41, 60]), 5);
});

test("scoreArrange evaluates partial and full sequence ordering", () => {
  const phaseItems = [
    { id: "step0", text: "First" },
    { id: "step1", text: "Second" },
    { id: "step2", text: "Third" },
    { id: "step3", text: "Fourth" },
    { id: "step4", text: "Fifth" }
  ];

  // Perfect order
  const perfect = Exam.scoreArrange(phaseItems, ["step0", "step1", "step2", "step3", "step4"]);
  assert.equal(perfect.inPlace, 5);
  assert.equal(perfect.total, 5);
  assert.equal(perfect.passed, true);
  assert.equal(perfect.awarded, 1);
  assert.equal(perfect.label, "Order: 5 of 5 in place");

  // Partial order (one swapped)
  const partial = Exam.scoreArrange(phaseItems, ["step0", "step2", "step1", "step3", "step4"]);
  assert.equal(partial.inPlace, 4);
  assert.equal(partial.total, 5);
  assert.equal(partial.passed, false);
  assert.equal(partial.awarded, 0);
  assert.equal(partial.label, "Order: 4 of 5 in place");
});

test("scoreExam marks a perfect run 100% pass", () => {
  const station = {
    id: "st_perfect",
    title: "Perfect station",
    seconds: 300,
    passMark: 50,
    items: [
      { id: "s1/a", skillId: "s1", text: "Step A", critical: true, weight: 1 },
      { id: "s1/b", skillId: "s1", text: "Step B", critical: false, weight: 1 },
      { id: "s1/c", skillId: "s1", text: "Step C", critical: false, weight: 1 },
      { id: "s1/d", skillId: "s1", text: "Step D", critical: false, weight: 1 }
    ]
  };

  const answers = {
    "s1/a": { isCorrect: true, pickedText: "Step A" },
    "s1/b": { isCorrect: true, pickedText: "Step B" },
    "s1/c": { isCorrect: true, pickedText: "Step C" },
    "s1/d": { isCorrect: true, pickedText: "Step D" }
  };
  const orderScores = {
    s1: { inPlace: 4, total: 4, passed: true, awarded: 1 }
  };

  const r = Exam.scoreExam(station, answers, { orderScores: orderScores });
  assert.equal(r.score, 5, "4 rubric points + 1 arrange point = 5");
  assert.equal(r.maxScore, 5, "max score is 5");
  assert.equal(r.pct, 100);
  assert.equal(r.passed, true);
  assert.equal(r.failedOnCritical, false);
  assert.equal(r.missedCritical.length, 0);
  assert.equal(r.missed.length, 0);
  assert.equal(r.perSkill.s1.seen, 4);
  assert.equal(r.perSkill.s1.correct, 4);
});

test("scoreExam fails on missed critical step regardless of total score", () => {
  const station = {
    id: "st_crit",
    title: "Critical station",
    passMark: 50,
    items: [
      { id: "s1/a", skillId: "s1", text: "Hand hygiene", critical: true, weight: 1 },
      { id: "s1/b", skillId: "s1", text: "Introduce", critical: false, weight: 1 },
      { id: "s1/c", skillId: "s1", text: "Inspection", critical: false, weight: 1 },
      { id: "s1/d", skillId: "s1", text: "Palpation", critical: false, weight: 1 }
    ]
  };

  // Got b, c, d right, but missed critical hand hygiene
  const answers = {
    "s1/a": { isCorrect: false, pickedText: "Skip hygiene" },
    "s1/b": { isCorrect: true, pickedText: "Introduce" },
    "s1/c": { isCorrect: true, pickedText: "Inspection" },
    "s1/d": { isCorrect: true, pickedText: "Palpation" }
  };
  const orderScores = {
    s1: { inPlace: 4, total: 4, passed: true, awarded: 1 }
  };

  const r = Exam.scoreExam(station, answers, { orderScores: orderScores });
  assert.equal(r.passed, false, "must fail because critical step was missed");
  assert.equal(r.failedOnCritical, true);
  assert.equal(r.missedCritical.length, 1);
  assert.equal(r.missedCritical[0].id, "s1/a");
});

test("scoreExam fails when an unsafe distractor is picked", () => {
  const station = {
    id: "st_unsafe",
    title: "Unsafe station",
    passMark: 50,
    items: [
      { id: "s1/a", skillId: "s1", text: "Confirm identity", critical: false, weight: 1 },
      { id: "s1/b", skillId: "s1", text: "Administer dose", critical: false, weight: 1 }
    ]
  };

  const answers = {
    "s1/a": { isCorrect: true, pickedText: "Confirm identity" },
    "s1/b": { isCorrect: false, pickedText: "Inject 10x overdose", unsafe: true, why: "Lethal overdose" }
  };

  const r = Exam.scoreExam(station, answers);
  assert.equal(r.passed, false, "must fail due to unsafe action");
  assert.equal(r.failedOnCritical, true);
  assert.equal(r.unsafeChosen, true);
  assert.equal(r.unsafeActions.length, 1);
  assert.match(r.unsafeActions[0].why, /lethal overdose/i);
});

test("scoreExam handles time-up with remaining steps counted as missed", () => {
  const station = {
    id: "st_timeup",
    title: "Timeup station",
    passMark: 50,
    items: [
      { id: "s1/a", skillId: "s1", text: "Step 1", critical: false, weight: 1 },
      { id: "s1/b", skillId: "s1", text: "Step 2", critical: false, weight: 1 },
      { id: "s1/c", skillId: "s1", text: "Step 3", critical: true, weight: 1 },
      { id: "s1/d", skillId: "s1", text: "Step 4", critical: false, weight: 1 }
    ]
  };

  // Only answered first two before clock expired
  const answers = {
    "s1/a": { isCorrect: true, pickedText: "Step 1" },
    "s1/b": { isCorrect: true, pickedText: "Step 2" }
  };

  const r = Exam.scoreExam(station, answers, { timeUp: true });
  assert.equal(r.score, 2);
  assert.equal(r.missed.length, 2);
  assert.equal(r.missedCritical.length, 1, "unattempted critical step 3 counts as missed critical");
  assert.equal(r.failedOnCritical, true);
  assert.equal(r.passed, false);
});

/* ── 3. Referential integrity & 5 options for EVERY station in repo ────────── */

test("every station in every clinix/diseases/*.json and clinix/systems/*.json compiles and yields 5 options per step", () => {
  // Load all skills from clinix/skills/*.json
  const allSkills = {};
  const skillsDir = path.join(ROOT, "clinix", "skills");
  for (const file of fs.readdirSync(skillsDir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(skillsDir, file), "utf8"));
    if (data.skills) {
      for (const [k, s] of Object.entries(data.skills)) {
        if (s) allSkills[s.id || k] = s;
      }
    }
  }
  assert.ok(Object.keys(allSkills).length > 200, "skills loaded from disk");

  let stationCount = 0;
  let totalStepsTested = 0;

  function verifyStation(st, localSkills, sourceFile) {
    const resolvedSkills = (st.skills || []).map((id) => localSkills[id]).filter(Boolean);
    assert.equal(resolvedSkills.length, (st.skills || []).length, `${sourceFile} ${st.id} has unresolvable skills`);

    const compiled = M.compileStation(resolvedSkills, st);
    assert.ok(compiled.items.length >= 1, `${sourceFile} ${st.id} has no compiled rubric items`);

    const phases = Exam.stationPhases(compiled.items);
    assert.ok(phases.length >= 1, `${sourceFile} ${st.id} has no phases`);

    const completed = {};
    for (let p = 0; p < phases.length; p++) {
      const phase = phases[p];
      for (let s = 0; s < phase.items.length; s++) {
        const step = phase.items[s];
        totalStepsTested++;

        const opts = Exam.buildStepOptions(step, phase, compiled, localSkills, completed, `${st.id}:${p}:${s}`);
        assert.equal(opts.length, 5, `${sourceFile} ${st.id} phase ${phase.title} step ${step.id} did not yield 5 options (got ${opts.length})`);

        const correct = opts.filter((o) => o.isCorrect === true);
        assert.equal(correct.length, 1, `${sourceFile} ${st.id} step ${step.id} has ${correct.length} correct options`);
        assert.equal(correct[0].text, step.text, "correct option text must match step rubric text");

        const texts = opts.map((o) => o.text.trim().toLowerCase());
        const uniqueTexts = new Set(texts);
        assert.equal(uniqueTexts.size, 5, `${sourceFile} ${st.id} step ${step.id} options are not unique`);

        // Mark completed to verify next step never offers it
        completed[step.id] = true;
      }
    }
    stationCount++;
  }

  // Diseases
  const dzDir = path.join(ROOT, "clinix", "diseases");
  for (const file of fs.readdirSync(dzDir)) {
    if (!file.endsWith(".json")) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dzDir, file), "utf8"));
    const localSkills = Object.assign({}, allSkills, d.skills || {});
    const sts = (d.osce && d.osce.stations) || d.stations || [];
    for (const st of sts) {
      verifyStation(st, localSkills, `diseases/${file}`);
    }
  }

  // Systems
  const sysDir = path.join(ROOT, "clinix", "systems");
  for (const file of fs.readdirSync(sysDir)) {
    if (!file.endsWith(".json")) continue;
    const sys = JSON.parse(fs.readFileSync(path.join(sysDir, file), "utf8"));
    const localSkills = Object.assign({}, allSkills, sys.skills || {});
    const sts = (sys.osce && sys.osce.stations) || sys.stations || [];
    for (const st of sts) {
      verifyStation(st, localSkills, `systems/${file}`);
    }
  }

  assert.ok(stationCount >= 150, `must test at least 150 stations (tested ${stationCount})`);
  assert.ok(totalStepsTested >= 2000, `must test at least 2000 steps (tested ${totalStepsTested})`);
});
