/* test/clinix-obgyn-osce.test.mjs - the Tokos O&G OSCE and viva stations, as a CliniX skill pack.
 *
 * The pack is data (skills/obgyn.json + systems/obgyn.json + two manifest entries), so the risk is an
 * authoring mistake that renders an empty station or a viva question that cannot be passed. Run against
 * the REAL shipped JSON and the same model the app renders with.
 *
 * node --test test/clinix-obgyn-osce.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const pack = read("skills/obgyn.json");
const mod = read("systems/obgyn.json");
const VOCAB = read("dx-vocabulary.json");

// Every pack, as the app merges them for a system's pathway.
const allSkills = {};
for (const p of manifest.skillPacks) Object.assign(allSkills, read(p.file).skills);
const skillsOf = (ids) => ids.map((id) => allSkills[id]);
const stations = mod.osce.stations;

/* Registration ------------------------------------------------------------- */

test("registration: the pack and the system are in the catalog, and the system is Pro", () => {
  const entry = manifest.skillPacks.find((p) => p.id === "obgyn");
  assert.ok(entry && entry.file === "skills/obgyn.json", "obgyn skill pack is not registered");
  const sys = manifest.systems.find((s) => s.id === "obgyn");
  assert.ok(sys, "obgyn system is not registered");
  assert.deepEqual(sys.skillPacks, ["core", "obgyn"]);
  assert.notEqual(sys.free, true, "the owner rule is that only respiratory is free");
  assert.equal(M.systemLocked(sys, false), true, "a non-Pro reader must see it locked");
  assert.equal(M.systemLocked(sys, true), false);
  // Shown, never hidden, but its skills are not reachable through the free library.
  assert.equal(M.openPackIds(manifest, false).includes("obgyn"), false);
  assert.equal(M.openPackIds(manifest, true).includes("obgyn"), true);
  assert.equal(sys.module.id, mod.id);
  assert.equal(sys.module.chapters, mod.chapters.length, "manifest chapter count drifted from the module file");
});

test("registration: the content version was bumped so a device that cached the old catalog refetches", () => {
  assert.notEqual(manifest.contentVersion, "0.9.2-audit");
});

test("deep link: tokos-osce resolves to a real pathway, and flag-off / unknown ids are a no-op", () => {
  const require = createRequire(import.meta.url);
  const CLINIX = require("../clinix.js");
  assert.equal(CLINIX.DEEP_LINKS["tokos-osce"], mod.id);
  assert.equal(mod.deepLink, "tokos-osce");
  const known = [];
  for (const s of manifest.systems) { if (s.module) known.push(s.module.id); for (const d of s.diseases) known.push(d.id); }
  assert.ok(known.includes(CLINIX.DEEP_LINKS["tokos-osce"]), "the link points at a pathway the catalog does not list");
  assert.equal(CLINIX.openDeep("tokos-osce"), false, "with the flag off (no window) it must do nothing");
  assert.equal(CLINIX.openDeep("nope"), false);
});

/* Validation --------------------------------------------------------------- */

test("the pack and its module pass full referential validation", () => {
  const v = M.validatePack({ skills: allSkills, media, diseases: [mod] });
  assert.deepEqual(v.errors, []);
});

test("every obgyn skill is well formed, ai_drafted, English, and cites a source that was opened", () => {
  const ids = Object.keys(pack.skills);
  assert.equal(ids.length, 32);
  for (const id of ids) {
    const s = pack.skills[id];
    assert.equal(s.system, "obgyn");
    assert.equal(M.reviewStatus(s), "ai_drafted", id + " must stay ai_drafted until a clinician approves it");
    assert.ok(s.rubric.length >= 4, id + " has too few checklist items to be a station");
    assert.ok(s.probes.length >= 2, id + " has too few viva questions");
    assert.ok(s.sources.length >= 1);
    for (const x of s.sources) {
      assert.ok(x.source && x.locator && x.locator.length > 2, id + " has a citation with no locator");
      assert.match(x.url || "", /^https:\/\//, id + " cites '" + x.source + "' with no URL");
    }
    if (s.kind === "treatment") assert.match(s.dosingNote, /does not prescribe/, id + " must carry the dosing note");
    if (s.kind === "exam") assert.ok(s.pitfalls && s.pitfalls.length >= 1, id);
    if (s.kind === "approach") assert.ok(s.pitfalls && s.pitfalls.length >= 1, id);
    assert.deepEqual(allSkills[id], s, id + " is shadowed by another pack");
  }
});

test("no em-dash, en-dash or Devanagari in the shipped obgyn content (CliniX packs are English only)", () => {
  for (const f of ["skills/obgyn.json", "systems/obgyn.json"]) {
    const t = raw(f);
    assert.equal(t.search(/[–—]/), -1, f + " contains a dash character");
    assert.equal(t.search(/[ऀ-ॿ]/), -1, f + " contains Devanagari; CliniX has no Hindi layer");
  }
});

/* The stations compile to OSCE ---------------------------------------------- */

test("there are exactly ten stations, each with a checklist, a clock, a critical step and examiner questions", () => {
  assert.equal(stations.length, 10);
  const ids = new Set(stations.map((s) => s.id));
  assert.equal(ids.size, 10);
  for (const def of stations) {
    const st = M.compileStation(skillsOf(def.skills), def);
    assert.ok(st.items.length >= 12, `${def.id}: only ${st.items.length} checklist items`);
    assert.ok(st.criticalCount >= 1, `${def.id}: a station with no critical step cannot fail anyone on safety`);
    assert.ok(st.seconds >= 300 && st.seconds <= 600, `${def.id}: unrealistic clock ${st.seconds}`);
    assert.ok(def.task.length > 40 && def.examinerQuestions.length >= 3, def.id);
    assert.ok(def.competencies.every((c) => /^OG\d+\.\d+$/.test(c)), def.id + " competency code shape");
    const seen = new Set();
    for (const it of st.items) { assert.ok(!seen.has(it.id), "duplicate item " + it.id); seen.add(it.id); }
    // Full marks pass; missing every critical step fails on safety whatever the total.
    const all = st.items.map((i) => i.id);
    assert.equal(M.scoreStation(st, all).passed, true, def.id + " cannot be passed");
    const noCrit = st.items.filter((i) => !i.critical).map((i) => i.id);
    const r = M.scoreStation(st, noCrit);
    assert.equal(r.failedOnCritical, true, def.id);
    assert.equal(r.passed, false, def.id);
    assert.equal(M.scoreStation(st, []).passed, false, def.id);
  }
});

test("the two team stations use a stricter bar, and the consent step is critical in every intimate examination", () => {
  for (const id of ["osce.obg.pph_team", "osce.obg.eclampsia_team"]) {
    assert.equal(stations.find((s) => s.id === id).passMark, 60, id);
  }
  for (const id of ["osce.obg.speculum", "osce.obg.bimanual"]) {
    const def = stations.find((s) => s.id === id);
    const st = M.compileStation(skillsOf(def.skills), def);
    const crit = st.items.filter((i) => i.critical).map((i) => i.id);
    assert.ok(crit.includes("skill.approach.obg.intimate_consent/consent"), id);
    assert.ok(crit.includes("skill.approach.obg.intimate_consent/chaperone"), id);
  }
});

test("the station list covers the required topics", () => {
  const want = ["history_obstetric", "exam_pregnancy", "history_gynae", "speculum", "bimanual",
    "bad_news_stillbirth", "contraception", "consent_caesarean", "pph_team", "eclampsia_team"];
  assert.deepEqual(stations.map((s) => s.id.replace("osce.obg.", "")), want);
});

/* The viva ---------------------------------------------------------------- */

test("the viva pool is adaptive across all four levels and large enough for a session", () => {
  const v = M.compileViva(skillsOf(mod.viva.skills));
  const levels = new Set(v.pool.map((q) => q.level));
  assert.deepEqual([...levels].sort(), [1, 2, 3, 4]);
  assert.ok(v.pool.length >= 70, "pool: " + v.pool.length);
  const q = M.nextVivaQuestion(v, { level: 1, asked: {} });
  assert.ok(q && q.q.level === 1);
});

test("every viva question can be passed by its own model answer and failed by nonsense", () => {
  for (const s of Object.values(pack.skills)) {
    for (const p of s.probes) {
      assert.ok(p.accept.length >= p.minMatch, `${s.id}: minMatch ${p.minMatch} > ${p.accept.length} accept terms`);
      const ok = M.markAnswer(p, p.a);
      assert.equal(ok.correct, true, `${s.id} L${p.level}: the model answer does not pass its own marking (${p.q})`);
      assert.equal(M.markAnswer(p, "banana purple monkey dishwasher").correct, false, `${s.id}: nonsense passes (${p.q})`);
    }
  }
});

test("every skill compiles into a lesson with a why and a closing question", () => {
  for (const s of Object.values(pack.skills)) {
    const turns = M.compileLesson(s);
    assert.ok(turns.some((t) => t.kind === "tell" && t.heading === "Why we do it"), s.id);
    assert.ok(turns.some((t) => t.kind === "ask" || t.kind === "check"), s.id);
  }
});

/* Sources for the numbers ---------------------------------------------------- */

test("the doses and thresholds in the team stations are pinned to the cited documents", () => {
  const text = (id) => JSON.stringify(pack.skills[id]);
  const pph = text("skill.tx.obg.pph_first_response") + text("skill.tx.obg.pph_atony_escalate") + text("skill.tx.obg.pph_recognise");
  for (const s of ["10 IU IM", "20 IU in 500 mL", "40 to 60 drops per minute", "1 g by slow IV injection over 10 minutes", "within 3 hours",
    "0.2 mg IM or slow IV", "up to 5 doses (1 mg)", "250 micrograms IM", "up to 8 doses (2 mg)", "800 micrograms", "100 IU in 24 hours",
    "more than 500 mL", "300 mL or more", "16 to 18 G"]) {
    assert.ok(pph.includes(s), "PPH content lost the ICMR/WHO value: " + s);
  }
  const ecl = text("skill.tx.obg.mgso4") + text("skill.tx.obg.eclampsia_bp_delivery") + text("skill.tx.obg.eclampsia_abcd");
  for (const s of ["4 g IV slowly", "1 g per minute", "5 g of 50% solution deep IM", "5 g deep IM in alternate buttocks every 4 hours",
    "more than 100 mL in the last 4 hours", "100 mL per hour", "10 mL of 10% calcium gluconate", "24 hours after delivery",
    "10 to 30 mg orally", "maximum total of 120 mg", "10 to 20 mg slow IV", "maximum total of 300 mg", "80 mL per hour", "above 96%"]) {
    assert.ok(ecl.includes(s) || ecl.includes(s.replace("5 g of 50% solution deep IM", "5 g of 50% deep IM")), "eclampsia content lost the FOGSI value: " + s);
  }
  // Every treatment skill names the two documents it was written from.
  for (const id of Object.keys(pack.skills).filter((k) => pack.skills[k].kind === "treatment")) {
    const orgs = pack.skills[id].sources.map((x) => x.source).join(" | ");
    assert.match(orgs, /ICMR|FOGSI/, id);
  }
});

/* The AI patient (Case mode) ------------------------------------------------- */

const cases = mod.cases;
const byId = (id) => cases.find((c) => c.id === id);

test("two simulated patients exist, are ai_drafted, and their facts agree with their own monitor", () => {
  assert.equal(cases.length, 2);
  for (const c of cases) {
    assert.equal(M.reviewStatus(c), "ai_drafted");
    assert.equal(c.system, "obgyn");
    for (const k of ["name", "age", "sex", "occupation", "residence"]) assert.ok(c.patient[k], `${c.id} persona.${k}`);
    assert.ok(/teaching scenario/i.test(c.opening), c.id + " must say it is a teaching scenario");
    const v = c.initialVitals;
    for (const k of ["hr", "bpSystolic", "bpDiastolic", "rr", "spo2", "temp", "gcs"]) assert.equal(typeof v[k], "number");
    const vit = c.exam["skill.gen.vitals"].finding;
    assert.match(vit, new RegExp("Pulse " + v.hr + "\\b"));
    assert.match(vit, new RegExp("Blood pressure " + v.bpSystolic + "/" + v.bpDiastolic + " mmHg"));
    assert.match(vit, new RegExp("Respiratory rate " + v.rr + "\\b"));
    for (const id of Object.keys(c.exam)) assert.ok(allSkills[id], `${c.id} exam references unknown skill ${id}`);
    for (const [k, h] of Object.entries(c.history)) {
      assert.ok(h.cues.length >= 2 && h.reply.length > 20, `${c.id}.${k}`);
      assert.ok(!h.skillId || allSkills[h.skillId], `${c.id}.${k} skillId`);
    }
    assert.ok(c.teachingPoints.length >= 3);
    // The AI patient answers from these facts only: no dose may sit in a reply.
    for (const h of Object.values(c.history)) assert.equal(/\b\d+\s?(mg|mcg|g|ml)\b/i.test(h.reply), false, "dose in a patient reply: " + h.reply);
    const eng = Engine.createCaseState(c, {});
    assert.equal(eng.currentVitals.bpSystolic, v.bpSystolic);
  }
});

test("the simulated patients understand how a student would actually ask", () => {
  const ask = (c, q) => { const r = M.matchAsk(c, q); return r ? r.key : null; };
  const c1 = byId("case.obg.booking_history"), c2 = byId("case.obg.postcoital_bleeding");
  const c1Cases = [
    ["when was your last period", "lmp"],
    ["how many pregnancies have you had", "previous"],
    ["tell me about your last pregnancy", "last_pregnancy"],
    ["did you have any fits", "complications"],
    ["do you have a headache or blurred vision", "symptoms_now"],
    ["does the baby move well", "movements"],
    ["any family history of blood pressure or diabetes", "family"],
    ["did you have a caesarean", "operations"]
  ];
  for (const [q, want] of c1Cases) assert.equal(ask(c1, q), want, "case1: " + q);
  const c2Cases = [
    ["do you bleed after sex", "bleeding_pattern"],
    ["have you ever had a smear test", "screening"],
    ["what contraception do you use", "contraception"],
    ["is there any discharge", "discharge"],
    ["how are your periods", "menstrual"],
    ["how many children do you have", "obstetric"]
  ];
  for (const [q, want] of c2Cases) assert.equal(ask(c2, q), want, "case2: " + q);
  assert.equal(ask(c1, "what is your favourite colour"), null, "small talk must match nothing");
});

test("cases are marked deterministically against the case's own model, and the plan is free text", () => {
  const c1 = byId("case.obg.booking_history"), c2 = byId("case.obg.postcoital_bleeding");
  assert.equal(DX.scoreDiagnosis(c1, "Pre eclampsia", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c1, "Eclampsia", VOCAB).correct, false, "the leading diagnosis is not eclampsia");
  assert.equal(DX.scoreDiagnosis(c2, "Carcinoma of the cervix", VOCAB).correct, true);
  assert.equal(DX.scoreDiagnosis(c2, "Fibroid uterus", VOCAB).correct, false);
  assert.equal(DX.scoreDifferential(c1, ["Pre eclampsia", "HELLP syndrome"], VOCAB).correct, true);
  assert.equal(DX.scoreDifferential(c2, ["Carcinoma of the cervix", "Pelvic inflammatory disease"], VOCAB).correct, true);
  assert.equal(DX.scoreDifferential(c2, ["Fibroid uterus", "Endometriosis"], VOCAB).correct, false);
  // The plan stage draws generic distractors written for medicine cases; an obstetric case falls back to
  // the written plan rather than offering "give a beta blocker during decompensation".
  assert.deepEqual(DX.planOptions(c1), []);
  assert.deepEqual(DX.planOptions(c2), []);
  // the system id maps onto the vocabulary's obstetrics and gynaecology group, so the picker opens filtered
  assert.equal(DX.vocabSystemFor("obgyn"), "obgy");
  const sc = M.scoreCase(c2, { asked: ["presenting", "bleeding_pattern", "screening", "discharge", "sexual", "obstetric", "menstrual", "general", "pain", "contraception", "medical"],
    examined: Object.keys(c2.exam), investigated: ["urine_pregnancy_test", "referral_colposcopy"], diagnosis: "Carcinoma of the cervix", differential: "Carcinoma of the cervix, pelvic inflammatory disease" });
  assert.equal(sc.verdict, "good");
  const thin = M.scoreCase(c2, { asked: ["presenting"], examined: [], investigated: [], diagnosis: "Carcinoma of the cervix", differential: "" });
  assert.equal(thin.verdict, "right-answer-thin-workup");
});

test("the non-indicated test in the gynaecology case is the screening sample, and the case says why", () => {
  const c2 = byId("case.obg.postcoital_bleeding");
  assert.equal(c2.investigations.cervical_cytology.indicated, false);
  assert.match(c2.investigations.cervical_cytology.note, /not a diagnostic test/);
  const sc = M.scoreCase(c2, { asked: [], examined: [], investigated: ["cervical_cytology"], diagnosis: null });
  assert.deepEqual(sc.investigations.unnecessary, ["cervical_cytology"]);
});
