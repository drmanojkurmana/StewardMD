/* test/clinix-paediatrics-osce.test.mjs - the Paediatrics OSCE and viva stations, as a CliniX system module.
 *
 * Modelled on clinix-obgyn-osce.test.mjs and clinix-anaesthesia-osce.test.mjs.
 * The module is data (systems/paediatrics.json with its station distractors, shared skills in skills/paediatrics.json,
 * diagnosis terms in dx-vocabulary.json and the manifest module entry), so tests protect against authoring drift,
 * malformed stations, unpassable viva probes, and invalid case models.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/clinix-paediatrics-osce.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../clinix-model.js";
import DX from "../clinix-dx.js";
import Engine from "../clinix-engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = (p) => readFileSync(join(ROOT, "clinix", p), "utf8");
const read = (p) => JSON.parse(raw(p));
const manifest = read("manifest.json");
const media = read("media/manifest.json").media;
const mod = read("systems/paediatrics.json");
const VOCAB = read("dx-vocabulary.json");

// Merged skills as the app loads them for the system pathway, including shared work skills
const allSkills = {};
for (const p of manifest.skillPacks) {
  const f = join(ROOT, "clinix", p.file);
  if (existsSync(f)) Object.assign(allSkills, read(p.file).skills);
}

// The module's shared skills are merged into skills/paediatrics.json.
const sharedPack = read("skills/paediatrics.json");

const skillsOf = (ids) => ids.map((id) => allSkills[id]);
const stations = mod.osce.stations;

const SHARED_SKILL_IDS = [
  "skill.approach.paed.immunisation_counsel",
  "skill.approach.paed.ors_counsel_prep",
  "skill.exam.paed.imnci_danger_signs",
  "skill.exam.paed.development_screening"
];

/* Registration and Manifest ------------------------------------------------ */

test("registration: paediatrics system exists in catalog and manifest module file is authored", () => {
  const sys = manifest.systems.find((s) => s.id === "paediatrics");
  assert.ok(sys, "paediatrics system is not registered in manifest");
  assert.deepEqual(sys.skillPacks, ["core", "paediatrics"]);

  const manifestModule = sys.module;
  assert.ok(manifestModule, "paediatrics module is registered in manifest.json");
  assert.equal(manifestModule.id, mod.id);
  assert.equal(manifestModule.file, "systems/paediatrics.json");
  assert.equal(manifestModule.chapters, mod.chapters.length, "manifest chapter count drifted from module file");
  assert.equal(manifestModule.review, "ai_drafted");
  assert.ok(manifestModule.subtitle.includes("12 stations"));
});

test("deep link: paediatrics-osce matches deepLink property", () => {
  assert.equal(mod.deepLink, "paediatrics-osce");
  assert.equal(mod.kind, "system-module");
});

/* Validation --------------------------------------------------------------- */

test("the paediatrics module passes full referential validation with merged skills", () => {
  const v = M.validatePack({ skills: allSkills, media, diseases: [mod] });
  assert.deepEqual(v.errors, []);
});

test("all shared paediatric skills are well formed, ai_drafted, British English, and cite valid sources", () => {
  for (const id of SHARED_SKILL_IDS) {
    const s = sharedPack.skills[id];
    assert.ok(s, "shared skill missing: " + id);
    assert.equal(s.system, "paediatrics");
    assert.equal(M.reviewStatus(s), "ai_drafted", id + " must be ai_drafted");
    assert.ok(s.rubric && s.rubric.length >= 5 && s.rubric.length <= 10, id + " rubric length must be 5 to 10");
    assert.ok(s.probes && s.probes.length >= 3, id + " has too few viva questions");
    assert.ok(s.sources && s.sources.length >= 2, id + " needs at least 2 sources");

    // First source must be StewardMD Clinical KB
    assert.equal(s.sources[0].source, "StewardMD Clinical KB", id + " first source must be Clinical KB");
    assert.ok(s.sources[0].locator && s.sources[0].locator.length > 2, id + " locator missing");

    if (s.kind === "exam" || s.kind === "general_exam" || s.kind === "approach") {
      assert.ok(s.pitfalls && s.pitfalls.length >= 1, id + " needs at least 1 pitfall");
    }
    if (s.kind === "exam") {
      assert.ok(s.normal && s.abnormal && s.significance, id + " needs normal, abnormal, significance");
    }

    const turns = M.compileLesson(s);
    assert.ok(turns.some((t) => t.kind === "tell" && t.heading === "Why we do it"), id + " missing Why we do it");
    assert.ok(turns.some((t) => t.kind === "ask" || t.kind === "check"), id + " missing probe turn");
  }
});

test("no em-dash, en-dash or Devanagari in the paediatrics files", () => {
  const files = [
    join(ROOT, "clinix/systems/paediatrics.json"),
    join(ROOT, "clinix/skills/paediatrics.json")
  ];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.search(/[–—]/), -1, f + " contains a dash character");
    assert.equal(t.search(/[ऀ-ॿ]/), -1, f + " contains Devanagari");
  }
});

/* The stations compile to OSCE ---------------------------------------------- */

test("there are exactly twelve stations, each with a checklist, a clock, a critical step and examiner questions", () => {
  assert.equal(stations.length, 12);
  const ids = new Set(stations.map((s) => s.id));
  assert.equal(ids.size, 12);

  for (const def of stations) {
    const st = M.compileStation(skillsOf(def.skills), def);
    assert.ok(st.items.length >= 12, `${def.id}: only ${st.items.length} checklist items`);
    assert.ok(st.criticalCount >= 1, `${def.id}: a station with no critical step cannot fail on safety`);
    assert.ok(st.seconds >= 300 && st.seconds <= 480, `${def.id}: clock ${st.seconds} outside 300-480`);
    assert.ok(def.task.length > 40 && def.examinerQuestions.length >= 3, def.id);
    assert.ok(def.competencies.every((c) => /^PE\d+\.\d+$/.test(c)), def.id + " competency code shape");

    const seen = new Set();
    for (const it of st.items) {
      assert.ok(!seen.has(it.id), "duplicate item " + it.id);
      seen.add(it.id);
    }

    const all = st.items.map((i) => i.id);
    assert.equal(M.scoreStation(st, all).passed, true, def.id + " cannot be passed with all items");
    const noCrit = st.items.filter((i) => !i.critical).map((i) => i.id);
    const r = M.scoreStation(st, noCrit);
    assert.equal(r.failedOnCritical, true, def.id + " must fail when critical items are missed");
    assert.equal(r.passed, false, def.id);
    assert.equal(M.scoreStation(st, []).passed, false, def.id);
  }
});

test("the neonatal resuscitation emergency station uses a stricter passMark (60)", () => {
  const neo = stations.find((s) => s.id === "osce.paed.neonatal_resuscitation");
  assert.ok(neo, "neonatal resuscitation station missing");
  assert.equal(neo.passMark, 60, "emergency resuscitation must carry a 60% pass mark");
});

test("the station list covers all twelve required paediatric topics", () => {
  const want = [
    "history",
    "development",
    "growth_chart",
    "newborn_exam",
    "respiratory_exam",
    "cardiovascular_exam",
    "abdominal_exam",
    "nervous_system_exam",
    "immunisation_counsel",
    "dehydration_ors",
    "imnci_danger_signs",
    "neonatal_resuscitation"
  ];
  assert.deepEqual(stations.map((s) => s.id.replace("osce.paed.", "")), want);
});

/* The viva ------------------------------------------------------------------ */

test("the viva pool is adaptive across all four levels and large enough for a session", () => {
  assert.ok(mod.viva.skills.length >= 20, "viva pool should have at least 20 skills");
  const v = M.compileViva(skillsOf(mod.viva.skills));
  const levels = new Set(v.pool.map((q) => q.level));
  assert.deepEqual([...levels].sort(), [1, 2, 3, 4]);
  assert.ok(v.pool.length >= 70, "viva pool length: " + v.pool.length);
  const q = M.nextVivaQuestion(v, { level: 1, asked: {} });
  assert.ok(q && q.q.level === 1);
});

test("every viva question in shared skills can be passed by its model answer and failed by nonsense", () => {
  for (const s of Object.values(sharedPack.skills)) {
    for (const p of s.probes) {
      assert.ok(p.accept.length >= p.minMatch, `${s.id}: minMatch ${p.minMatch} > ${p.accept.length} accept terms`);
      const ok = M.markAnswer(p, p.a);
      assert.equal(ok.correct, true, `${s.id} L${p.level}: model answer does not pass marking (${p.q})`);
      assert.equal(M.markAnswer(p, "banana purple monkey dishwasher").correct, false, `${s.id}: nonsense passes (${p.q})`);
    }
  }
});

/* Distractors file validation ---------------------------------------------- */

test("every station carries 4 to 6 plausible wrong actions for the OSCE exam mode", () => {
  const distractors = {};
  for (const st of stations) distractors[st.id] = st.distractors;

  let totalUnsafe = 0, totalSafe = 0;
  for (const def of stations) {
    const list = distractors[def.id];
    assert.ok(list && Array.isArray(list), "missing distractors for " + def.id);
    assert.ok(list.length >= 4 && list.length <= 6, `${def.id}: wrong count ${list.length}`);
    for (const d of list) {
      assert.ok(d.text && d.text.length > 10, `${def.id}: distractor text too short`);
      assert.ok(d.why && d.why.length > 10, `${def.id}: distractor why too short`);
      assert.equal(typeof d.unsafe, "boolean", `${def.id}: distractor unsafe must be boolean`);
      if (d.unsafe) totalUnsafe++;
      else totalSafe++;
    }
  }
  assert.ok(totalUnsafe >= 10, "distractors file should contain unsafe actions");
  assert.ok(totalSafe >= 10, "distractors file should contain safe-but-wrong actions");
});

/* The AI patient (Case mode) ------------------------------------------------ */

const cases = mod.cases;
const byId = (id) => cases.find((c) => c.id === id);

test("two simulated patients exist, are ai_drafted, and their facts agree with their monitor", () => {
  assert.equal(cases.length, 2);
  for (const c of cases) {
    assert.equal(M.reviewStatus(c), "ai_drafted");
    assert.equal(c.system, "paediatrics");
    for (const k of ["name", "age", "sex", "occupation", "residence"]) {
      assert.ok(c.patient[k], `${c.id} persona.${k}`);
    }
    assert.ok(/teaching scenario/i.test(c.opening), c.id + " must state it is a teaching scenario");

    const v = c.initialVitals;
    for (const k of ["hr", "bpSystolic", "bpDiastolic", "rr", "spo2", "temp", "gcs"]) {
      assert.equal(typeof v[k], "number");
    }

    const vit = c.exam["skill.gen.vitals"].finding;
    assert.match(vit, new RegExp("Pulse " + v.hr + "\\b"));
    assert.match(vit, new RegExp("Blood pressure " + v.bpSystolic + "/" + v.bpDiastolic + " mmHg"));
    assert.match(vit, new RegExp("Respiratory rate " + v.rr + "\\b"));

    for (const id of Object.keys(c.exam)) {
      assert.ok(allSkills[id], `${c.id} exam references unknown skill ${id}`);
    }

    const topics = Object.entries(c.history);
    assert.ok(topics.length >= 12, `${c.id} has only ${topics.length} history topics`);
    for (const [k, h] of topics) {
      assert.ok(h.cues.length >= 2, `${c.id}.${k} has fewer than 2 cues`);
      assert.ok(h.reply.length > 20, `${c.id}.${k} reply too short`);
      assert.ok(!h.skillId || allSkills[h.skillId], `${c.id}.${k} unknown skillId ${h.skillId}`);
      // No doses in patient replies
      assert.equal(/\b\d+\s?(mg|mcg|g|ml)\b/i.test(h.reply), false, "dose in a patient reply: " + h.reply);
    }

    assert.ok(c.teachingPoints.length >= 3);
    const eng = Engine.createCaseState(c, {});
    assert.equal(eng.currentVitals.bpSystolic, v.bpSystolic);
  }
});

test("the simulated patients understand realistic student questions and reject irrelevant inputs", () => {
  const ask = (c, q) => { const r = M.matchAsk(c, q); return r ? r.key : null; };
  const c1 = byId("case.paed.acute_diarrhoea_dehydration");
  const c2 = byId("case.paed.neonatal_jaundice");

  const c1Cases = [
    ["what brings you", "presenting"],
    ["how many loose motions has he passed", "frequency"],
    ["what does the stool look like", "stool_character"],
    ["is there any blood in the stool", "blood_in_stool"],
    ["how many times has he vomited", "vomiting"],
    ["does he have fever", "fever"],
    ["is he thirsty or drinking eagerly", "thirst"],
    ["how many wet nappies has he passed", "urine_output"],
    ["is he breastfeeding", "feeding"],
    ["have you given him any ors", "ors_given"],
    ["source of drinking water", "water_sanitation"]
  ];
  for (const [q, want] of c1Cases) assert.equal(ask(c1, q), want, "c1 question: " + q);

  const c2Cases = [
    ["what brings you", "presenting"],
    ["when did the jaundice start", "onset"],
    ["how far down has the yellow colour spread", "progression"],
    ["how is the baby breastfeeding", "feeding"],
    ["what is your blood group", "maternal_blood_group"],
    ["what colour is the stool", "stool_colour"],
    ["what colour is the urine", "urine_colour"],
    ["was the baby born at term", "gestational_age"],
    ["did he cry at birth", "birth_and_delivery"],
    ["did previous children have jaundice", "previous_children"]
  ];
  for (const [q, want] of c2Cases) assert.equal(ask(c2, q), want, "c2 question: " + q);

  // Irrelevant small talk and out-of-context clinical sentences must return null
  assert.equal(ask(c1, "what is your favourite colour"), null);
  assert.equal(ask(c1, "an effusion should expect stony dullness"), null);
  assert.equal(ask(c2, "what is your favourite colour"), null);
  assert.equal(ask(c2, "an effusion should expect stony dullness"), null);
});

test("cases are marked deterministically against the vocabulary and models", () => {
  const c1 = byId("case.paed.acute_diarrhoea_dehydration");
  const c2 = byId("case.paed.neonatal_jaundice");

  assert.equal(DX.scoreDiagnosis(c1, "Acute diarrhoeal disease", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c1, "Acute gastroenteritis", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c1, "Bacterial meningitis", VOCAB).correct, false);

  assert.equal(DX.scoreDiagnosis(c2, "Neonatal jaundice", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c2, "Nephrotic syndrome of childhood", VOCAB).correct, false);

  assert.equal(DX.scoreDifferential(c1, ["Acute diarrhoeal disease", "Rotavirus gastroenteritis"], VOCAB).correct, true);
  assert.equal(DX.scoreDifferential(c2, ["Neonatal jaundice", "Neonatal sepsis"], VOCAB).correct, true);

  assert.deepEqual(DX.planOptions(c1), []);
  assert.deepEqual(DX.planOptions(c2), []);
  assert.equal(DX.vocabSystemFor("paediatrics"), "paeds");

  const sc1 = M.scoreCase(c1, {
    asked: Object.keys(c1.history),
    examined: Object.keys(c1.exam),
    investigated: ["serum_electrolytes_glucose", "stool_microscopy"],
    diagnosis: "Acute diarrhoeal disease",
    differential: "Acute diarrhoeal disease, rotavirus gastroenteritis"
  });
  assert.equal(sc1.verdict, "good");

  const thin1 = M.scoreCase(c1, {
    asked: ["presenting"],
    examined: [],
    investigated: [],
    diagnosis: "Acute diarrhoeal disease",
    differential: ""
  });
  assert.equal(thin1.verdict, "right-answer-thin-workup");

  const sc2 = M.scoreCase(c2, {
    asked: Object.keys(c2.history),
    examined: Object.keys(c2.exam),
    investigated: ["total_serum_bilirubin", "blood_grouping_and_coombs"],
    diagnosis: "Neonatal jaundice",
    differential: "Neonatal jaundice, neonatal sepsis"
  });
  assert.equal(sc2.verdict, "good");

  const thin2 = M.scoreCase(c2, {
    asked: ["presenting"],
    examined: [],
    investigated: [],
    diagnosis: "Neonatal jaundice",
    differential: ""
  });
  assert.equal(thin2.verdict, "right-answer-thin-workup");
});

test("non-indicated investigations are flagged and accounted for in both cases", () => {
  const c1 = byId("case.paed.acute_diarrhoea_dehydration");
  const c2 = byId("case.paed.neonatal_jaundice");

  assert.equal(c1.investigations.stool_culture.indicated, false);
  assert.match(c1.investigations.stool_culture.note, /Not routinely indicated/);

  const sc1 = M.scoreCase(c1, { asked: [], examined: [], investigated: ["stool_culture"], diagnosis: null });
  assert.deepEqual(sc1.investigations.unnecessary, ["stool_culture"]);

  assert.equal(c2.investigations.sepsis_screen_crp.indicated, false);
  assert.match(c2.investigations.sepsis_screen_crp.note, /Not indicated/);

  const sc2 = M.scoreCase(c2, { asked: [], examined: [], investigated: ["sepsis_screen_crp"], diagnosis: null });
  assert.deepEqual(sc2.investigations.unnecessary, ["sepsis_screen_crp"]);
});
