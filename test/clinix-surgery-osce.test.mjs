/* test/clinix-surgery-osce.test.mjs - the General Surgery OSCE and viva stations, as a CliniX skill pack.
 *
 * Modelled on test/clinix-obgyn-osce.test.mjs and clinix-anaesthesia-osce.test.mjs.
 * The module file (clinix/systems/surgery.json) owns no skills; it references skills from
 * clinix/skills/core.json and clinix/skills/surgery.json (the module's shared skills are merged there).
 *
 * Run with:
 * node --test --experimental-test-module-mocks --experimental-sqlite test/clinix-surgery-osce.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
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
const pack = read("skills/surgery.json");
const mod = read("systems/surgery.json");
const VOCAB = read("dx-vocabulary.json");

// Shipped skills across all registered skill packs
const shippedSkills = {};
for (const p of manifest.skillPacks) Object.assign(shippedSkills, read(p.file).skills);

// The module's shared skills live in skills/surgery.json.
const sharedSkills = read("skills/surgery.json").skills;
const allSkills = shippedSkills;
const skillsOf = (ids) => ids.map((id) => allSkills[id]);
const stations = mod.osce.stations;

/* Registration and Catalog -------------------------------------------------- */

test("registration: surgery pack and surgery system are in manifest", () => {
  const entry = manifest.skillPacks.find((p) => p.id === "surgery");
  assert.ok(entry && entry.file === "skills/surgery.json", "surgery skill pack is not registered");
  const sys = manifest.systems.find((s) => s.id === "surgery");
  assert.ok(sys, "surgery system is not registered");
  assert.deepEqual(sys.skillPacks, ["core", "surgery"]);
  assert.notEqual(sys.free, true, "only respiratory is free");
  assert.equal(M.systemLocked(sys, false), true, "non-Pro user must see surgery locked");
  assert.equal(M.systemLocked(sys, true), false);
});

test("manifest entry: matches the surgery module structure", () => {
  const mWork = manifest.systems.find((s) => s.id === "surgery").module;
  assert.ok(mWork, "surgery module is registered in manifest.json");
  assert.equal(mWork.id, mod.id);
  assert.equal(mWork.file, "systems/surgery.json");
  assert.equal(mWork.chapters, mod.chapters.length);
  assert.equal(mWork.review, "ai_drafted");
});

test("deep link: surgery-osce is assigned on the module", () => {
  assert.equal(mod.deepLink, "surgery-osce");
  assert.equal(mod.id, "surgery-osce");
  assert.equal(mod.kind, "system-module");
  assert.equal(mod.system, "surgery");
});

/* Validation ---------------------------------------------------------------- */

test("referential validation: passes completely with the merged shared skills", () => {
  const v = M.validatePack({ skills: allSkills, media, diseases: [mod] });
  assert.deepEqual(v.errors, []);
});

test("shared skills: all 6 shared skills are well-formed, ai_drafted, with 2 valid sources and probes", () => {
  const ids = [
    "skill.approach.surg.intimate_chaperone",
    "skill.approach.surg.consent_operation",
    "skill.tx.surg.atls_primary_survey",
    "skill.tx.surg.catheterisation",
    "skill.tx.surg.nasogastric_tube",
    "skill.tx.surg.suture_wound"
  ];
  for (const id of ids) {
    const s = sharedSkills[id];
    assert.ok(s, "missing shared skill: " + id);
    assert.equal(s.system, "surgery");
    assert.equal(M.reviewStatus(s), "ai_drafted", id + " must be ai_drafted");
    assert.ok(s.rubric.length >= 5 && s.rubric.length <= 10, id + " rubric steps out of range: " + s.rubric.length);
    assert.ok(s.probes.length >= 4, id + " needs 4 probes across levels 1 to 4");
    assert.ok(s.sources.length >= 2, id + " needs at least 2 sources");
    assert.equal(s.sources[0].source, "StewardMD Clinical KB");
    assert.ok(s.sources[0].locator && s.sources[0].locator.length > 3);
    assert.match(s.sources[1].source, /Bailey|Browse|ATLS/, id + " source 2 must be standard text");
    if (s.kind === "treatment") {
      assert.match(s.dosingNote, /does not prescribe/, id + " treatment skill needs dosingNote");
    }
  }
});

test("no em-dash, en-dash, or Devanagari in the surgery module or pack", () => {
  const files = [
    join(ROOT, "clinix", "systems", "surgery.json"),
    join(ROOT, "clinix", "skills", "surgery.json")
  ];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.search(/[\u2013\u2014]/), -1, f + " contains an en-dash or em-dash");
    assert.equal(t.search(/[\u0900-\u097F]/), -1, f + " contains Devanagari characters");
  }
});

/* The stations compile to OSCE ---------------------------------------------- */

test("stations compile: 14 stations, each with checklist, clock, critical steps and examiner questions", () => {
  assert.equal(stations.length, 14);
  const ids = new Set(stations.map((s) => s.id));
  assert.equal(ids.size, 14, "duplicate station ids detected");

  for (const def of stations) {
    const sk = skillsOf(def.skills);
    assert.ok(def.skills.length >= 3 && def.skills.length <= 6, `${def.id}: skill count ${def.skills.length} outside 3-6`);
    assert.match(def.skills[0], /skill\.approach\./, `${def.id}: first skill must be an approach skill`);
    const st = M.compileStation(sk, def);
    assert.ok(st.items.length >= 10, `${def.id}: only ${st.items.length} checklist items`);
    assert.ok(st.criticalCount >= 1, `${def.id}: station needs at least one critical safety step`);
    assert.ok(st.seconds >= 300 && st.seconds <= 480, `${def.id}: clock ${st.seconds} outside 300-480 seconds`);
    assert.ok(def.task.length > 40, `${def.id}: task too short`);
    assert.equal(def.examinerQuestions.length, 3, `${def.id}: must have exactly 3 examiner questions`);
    assert.ok(def.competencies.every((c) => /^SU\d+\.\d+$/.test(c)), `${def.id}: invalid NMC CBME competency codes`);

    // Full marks pass
    const all = st.items.map((i) => i.id);
    assert.equal(M.scoreStation(st, all).passed, true, `${def.id} cannot be passed with all items`);

    // Missing critical steps fails on safety
    const noCrit = st.items.filter((i) => !i.critical).map((i) => i.id);
    const r = M.scoreStation(st, noCrit);
    assert.equal(r.failedOnCritical, true, `${def.id}: missing critical steps did not fail on safety`);
    assert.equal(r.passed, false, `${def.id}: missing critical steps passed unexpectedly`);
    assert.equal(M.scoreStation(st, []).passed, false, `${def.id}: empty checklist passed`);
  }
});

test("station list covers all 14 required topics in clinical order", () => {
  const want = [
    "lump",
    "ulcer",
    "thyroid",
    "breast",
    "inguinal_hernia",
    "scrotal",
    "varicose_veins",
    "peripheral_arterial",
    "acute_abdomen",
    "dre",
    "trauma_primary_survey",
    "consent_operation",
    "catheter_ng",
    "suturing"
  ];
  assert.deepEqual(stations.map((s) => s.id.replace("osce.surg.", "")), want);
});

test("safety steps are critical across intimate, procedural, and emergency stations", () => {
  const critOf = (id) => {
    const def = stations.find((s) => s.id === "osce.surg." + id);
    return M.compileStation(skillsOf(def.skills), def).items.filter((i) => i.critical).map((i) => i.id);
  };

  // Intimate examination stations require chaperone and consent
  for (const stId of ["breast", "inguinal_hernia", "scrotal", "dre"]) {
    assert.ok(critOf(stId).includes("skill.approach.surg.intimate_chaperone/chaperone"), `${stId} missing chaperone critical step`);
    assert.ok(critOf(stId).includes("skill.approach.surg.intimate_chaperone/consent"), `${stId} missing consent critical step`);
  }

  // Trauma primary survey requires cervical spine, decompression, and circulation
  assert.ok(critOf("trauma_primary_survey").includes("skill.tx.surg.atls_primary_survey/airway_cspine"));
  assert.ok(critOf("trauma_primary_survey").includes("skill.tx.surg.atls_primary_survey/decompression"));
  assert.ok(critOf("trauma_primary_survey").includes("skill.tx.surg.atls_primary_survey/circulation_bleeding"));

  // Procedural safety
  assert.ok(critOf("catheter_ng").includes("skill.tx.surg.catheterisation/urine_confirmation"));
  assert.ok(critOf("catheter_ng").includes("skill.tx.surg.nasogastric_tube/ph_confirmation"));
  assert.ok(critOf("suturing").includes("skill.tx.surg.suture_wound/pre_exam"));
  assert.ok(critOf("consent_operation").includes("skill.approach.surg.consent_operation/capacity"));
});

test("every one of the 14 stations carries 4 to 6 distractors for the OSCE exam mode", () => {
  const distractors = {};
  for (const st of stations) distractors[st.id] = st.distractors;
  for (const def of stations) {
    const list = distractors[def.id];
    assert.ok(Array.isArray(list), `${def.id} has no distractors`);
    assert.ok(list.length >= 4 && list.length <= 6, `${def.id} has ${list ? list.length : 0} distractors (expected 4-6)`);
    for (const d of list) {
      assert.ok(d.text && d.text.length > 15, `${def.id} distractor text too short`);
      assert.ok(d.why && d.why.length > 15, `${def.id} distractor why too short`);
      assert.equal(typeof d.unsafe, "boolean", `${def.id} distractor unsafe must be boolean`);
    }
  }
});

/* The viva pool ------------------------------------------------------------- */

test("the viva pool is adaptive across all four levels and large enough for a full viva", () => {
  const v = M.compileViva(skillsOf(mod.viva.skills));
  const levels = new Set(v.pool.map((q) => q.level));
  assert.deepEqual([...levels].sort(), [1, 2, 3, 4]);
  assert.ok(v.pool.length >= 70, "viva pool size: " + v.pool.length);
  const q1 = M.nextVivaQuestion(v, { level: 1, asked: {} });
  assert.ok(q1 && q1.q.level === 1);
});

test("every viva question in the pool can be passed by its own model answer and failed by nonsense", () => {
  for (const sId of mod.viva.skills) {
    const s = allSkills[sId];
    assert.ok(s, "viva skill missing: " + sId);
    for (const p of s.probes || []) {
      assert.ok(p.accept.length >= p.minMatch, `${s.id}: minMatch ${p.minMatch} > ${p.accept.length} accept terms`);
      const ok = M.markAnswer(p, p.a);
      assert.equal(ok.correct, true, `${s.id} L${p.level}: model answer does not pass (${p.q})`);
      assert.equal(M.markAnswer(p, "banana purple monkey dishwasher").correct, false, `${s.id}: nonsense passes (${p.q})`);
    }
  }
});

/* The AI-Patient Cases ------------------------------------------------------ */

const cases = mod.cases;
const byId = (id) => cases.find((c) => c.id === id);

test("two simulated surgical patients exist, are ai_drafted, and match their own vitals", () => {
  assert.equal(cases.length, 2);
  for (const c of cases) {
    assert.equal(M.reviewStatus(c), "ai_drafted");
    assert.equal(c.system, "surgery");
    for (const k of ["name", "age", "sex", "occupation", "residence"]) {
      assert.ok(c.patient[k], `${c.id} patient.${k} missing`);
    }
    assert.ok(/teaching scenario/i.test(c.opening), `${c.id} must declare teaching scenario in opening`);
    const v = c.initialVitals;
    for (const k of ["hr", "bpSystolic", "bpDiastolic", "rr", "spo2", "temp", "gcs"]) {
      assert.equal(typeof v[k], "number", `${c.id} vitals.${k}`);
    }
    const vit = c.exam["skill.gen.vitals"].finding;
    assert.match(vit, new RegExp("Pulse " + v.hr + "\\b"));
    assert.match(vit, new RegExp("Blood pressure " + v.bpSystolic + "/" + v.bpDiastolic + " mmHg"));
    assert.match(vit, new RegExp("Respiratory rate " + v.rr + "\\b"));

    for (const id of Object.keys(c.exam)) {
      assert.ok(allSkills[id], `${c.id} exam references unknown skill ${id}`);
    }
    for (const [k, h] of Object.entries(c.history)) {
      assert.ok(h.cues.length >= 2 && h.reply.length > 20, `${c.id}.${k}`);
      assert.ok(!h.skillId || allSkills[h.skillId], `${c.id}.${k} skillId: ${h.skillId}`);
      // No medication dose in patient reply
      assert.equal(/\b\d+\s?(mg|mcg|g|ml)\b/i.test(h.reply), false, `${c.id}.${k} dose in patient reply`);
    }
    assert.ok(c.teachingPoints.length >= 3, `${c.id} needs at least 3 teaching points`);
    const eng = Engine.createCaseState(c, {});
    assert.equal(eng.currentVitals.bpSystolic, v.bpSystolic);
  }
});

test("simulated surgical patients understand natural student questions and reject irrelevant chat", () => {
  const ask = (c, q) => { const r = M.matchAsk(c, q); return r ? r.key : null; };
  const c1 = byId("case.surg.acute_appendicitis");
  const c2 = byId("case.surg.inguinal_hernia");

  const c1Questions = [
    ["what brings you today", "presenting"],
    ["when did the pain start", "pain_onset_shift"],
    ["did the pain shift from the belly button", "pain_onset_shift"],
    ["what kind of pain is it", "pain_character"],
    ["does coughing make it worse", "aggravating_relieving"],
    ["do you have any appetite", "anorexia"],
    ["have you vomited", "nausea_vomiting"],
    ["do you have fever", "fever"],
    ["have you passed flatus", "bowels"],
    ["any burning with urine", "urinary"]
  ];
  for (const [q, want] of c1Questions) {
    assert.equal(ask(c1, q), want, `case1: "${q}"`);
  }

  const c2Questions = [
    ["what brings you today", "presenting"],
    ["when did the swelling start", "swelling_onset_duration"],
    ["does it go back when you lie down", "reducibility"],
    ["is there any dragging pain", "pain_dragging"],
    ["does coughing make it bulge", "cough_straining"],
    ["do you strain to pass urine", "urinary_straining"],
    ["are you constipated", "bowel_constipation"],
    ["do you have chest trouble", "chronic_cough"],
    ["has it ever become stuck", "strangulation_signs"]
  ];
  for (const [q, want] of c2Questions) {
    assert.equal(ask(c2, q), want, `case2: "${q}"`);
  }

  assert.equal(ask(c1, "what is your favourite colour"), null, "small talk must return null");
  assert.equal(ask(c2, "what is your favourite colour"), null, "small talk must return null");
  assert.equal(ask(c1, "an effusion should expect stony dullness"), null, "irrelevant medical phrases must return null");
  assert.equal(ask(c2, "an effusion should expect stony dullness"), null, "irrelevant medical phrases must return null");
});

test("cases are marked deterministically against clinical model and vocabulary", () => {
  const c1 = byId("case.surg.acute_appendicitis");
  const c2 = byId("case.surg.inguinal_hernia");

  assert.equal(DX.scoreDiagnosis(c1, "Acute appendicitis", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c1, "Perforated peptic ulcer", VOCAB).correct, false);
  assert.equal(DX.scoreDifferential(c1, ["Acute appendicitis", "Mesenteric adenitis"], VOCAB).correct, true);

  assert.equal(DX.scoreDiagnosis(c2, "Inguinal hernia", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c2, "Femoral hernia", VOCAB).correct, false);
  assert.equal(DX.scoreDifferential(c2, ["Inguinal hernia", "Hydrocele"], VOCAB).correct, true);

  const sc1 = M.scoreCase(c1, {
    asked: ["presenting", "pain_onset_shift", "pain_character", "aggravating_relieving", "anorexia", "nausea_vomiting", "fever", "bowels", "urinary"],
    examined: Object.keys(c1.exam),
    investigated: ["complete_blood_count", "ultrasound_abdomen"],
    diagnosis: "Acute appendicitis",
    differential: "Acute appendicitis, mesenteric adenitis"
  });
  assert.equal(sc1.verdict, "good");

  const sc2 = M.scoreCase(c2, {
    asked: ["presenting", "swelling_onset_duration", "reducibility", "pain_dragging", "cough_straining", "urinary_straining", "bowel_constipation", "chronic_cough", "strangulation_signs"],
    examined: Object.keys(c2.exam),
    investigated: ["ultrasound_groin", "preoperative_workup"],
    diagnosis: "Inguinal hernia",
    differential: "Inguinal hernia, hydrocele"
  });
  assert.equal(sc2.verdict, "good");
});

test("non-indicated investigations in surgical cases are identified with explicit notes", () => {
  const c1 = byId("case.surg.acute_appendicitis");
  const c2 = byId("case.surg.inguinal_hernia");

  assert.equal(c1.investigations.contrast_ct_abdomen.indicated, false);
  assert.match(c1.investigations.contrast_ct_abdomen.note, /Not indicated/i);

  assert.equal(c2.investigations.computed_tomography_abdomen.indicated, false);
  assert.match(c2.investigations.computed_tomography_abdomen.note, /unnecessary/i);

  const sc1 = M.scoreCase(c1, { asked: [], examined: [], investigated: ["contrast_ct_abdomen"], diagnosis: null });
  assert.deepEqual(sc1.investigations.unnecessary, ["contrast_ct_abdomen"]);

  const sc2 = M.scoreCase(c2, { asked: [], examined: [], investigated: ["computed_tomography_abdomen"], diagnosis: null });
  assert.deepEqual(sc2.investigations.unnecessary, ["computed_tomography_abdomen"]);
});
