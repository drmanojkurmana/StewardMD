/* test/clinix-anaesthesia-osce.test.mjs - the Narke anaesthesia OSCE and viva stations, as a CliniX skill pack.
 *
 * Modelled on clinix-obgyn-osce.test.mjs. The pack is data (skills/anaesthesia.json + systems/anaesthesia.json +
 * two manifest entries), so the risk is an authoring mistake that renders an empty station, a viva question that
 * cannot be passed, or a BLS number that drifts from the app's reviewed cardiac arrest protocol.
 *
 * node --test test/clinix-anaesthesia-osce.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import M from "../clinix-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = (p) => readFileSync(join(ROOT, "clinix", p), "utf8");
const read = (p) => JSON.parse(raw(p));
const manifest = read("manifest.json");
const media = read("media/manifest.json").media;
const pack = read("skills/anaesthesia.json");
const mod = read("systems/anaesthesia.json");

const allSkills = {};
for (const p of manifest.skillPacks) Object.assign(allSkills, read(p.file).skills);
const skillsOf = (ids) => ids.map((id) => allSkills[id]);
const stations = mod.osce.stations;

/* Registration ------------------------------------------------------------- */

test("registration: the pack and the system are in the catalog, and the system is Pro", () => {
  const entry = manifest.skillPacks.find((p) => p.id === "anaesthesia");
  assert.ok(entry && entry.file === "skills/anaesthesia.json", "anaesthesia skill pack is not registered");
  const sys = manifest.systems.find((s) => s.id === "anaesthesia");
  assert.ok(sys, "anaesthesia system is not registered");
  assert.deepEqual(sys.skillPacks, ["core", "anaesthesia"]);
  assert.notEqual(sys.free, true, "the owner rule is that only respiratory is free");
  assert.equal(M.systemLocked(sys, false), true);
  assert.equal(M.systemLocked(sys, true), false);
  assert.equal(M.openPackIds(manifest, false).includes("anaesthesia"), false);
  assert.equal(M.openPackIds(manifest, true).includes("anaesthesia"), true);
  assert.equal(sys.module.id, mod.id);
  assert.equal(sys.module.chapters, mod.chapters.length, "manifest chapter count drifted from the module file");
});

test("registration: the content version was bumped past the obgyn release", () => {
  assert.notEqual(manifest.contentVersion, "0.9.3-obgyn");
});

test("deep link: narke-osce resolves to a real pathway, and flag-off / unknown ids are a no-op", () => {
  const require = createRequire(import.meta.url);
  const CLINIX = require("../clinix.js");
  assert.equal(CLINIX.DEEP_LINKS["narke-osce"], mod.id);
  assert.equal(CLINIX.DEEP_LINKS["tokos-osce"], "obgyn-osce", "the Tokos link must survive");
  assert.equal(mod.deepLink, "narke-osce");
  const known = [];
  for (const s of manifest.systems) { if (s.module) known.push(s.module.id); for (const d of s.diseases) known.push(d.id); }
  assert.ok(known.includes(CLINIX.DEEP_LINKS["narke-osce"]));
  assert.equal(CLINIX.openDeep("narke-osce"), false, "with the flag off (no window) it must do nothing");
});

test("narke.js registers the OSCE entry that opens narke-osce, with the bilingual not-available toast", () => {
  const src = readFileSync(join(ROOT, "narke.js"), "utf8");
  assert.match(src, /registerSim\(\{ id: "osce"/);
  assert.match(src, /openDeep\("narke-osce"\)/);
  assert.match(src, /CliniX is not available on this device\./);
  assert.match(src, /इस डिवाइस पर CliniX उपलब्ध नहीं है।/);
});

test("verify-clinix-bundle.sh checks both new files", () => {
  const sh = readFileSync(join(ROOT, "scripts/verify-clinix-bundle.sh"), "utf8");
  assert.ok(sh.includes("skills/anaesthesia.json") && sh.includes("systems/anaesthesia.json"));
});

/* Validation --------------------------------------------------------------- */

test("the pack and its module pass full referential validation", () => {
  const v = M.validatePack({ skills: allSkills, media, diseases: [mod] });
  assert.deepEqual(v.errors, []);
});

test("every anaesthesia skill is well formed, ai_drafted, and cites a source with a locator and URL", () => {
  const ids = Object.keys(pack.skills);
  assert.equal(ids.length, 19);
  for (const id of ids) {
    const s = pack.skills[id];
    assert.equal(s.system, "anaesthesia");
    assert.equal(M.reviewStatus(s), "ai_drafted", id);
    assert.ok(s.rubric.length >= 4, id + " has too few checklist items");
    assert.ok(s.probes.length >= 2, id + " has too few viva questions");
    assert.ok(s.pitfalls && s.pitfalls.length >= 1, id);
    for (const x of s.sources) {
      assert.ok(x.source && x.locator && x.locator.length > 2, id + " has a citation with no locator");
      assert.match(x.url || "", /^https:\/\//, id + " cites '" + x.source + "' with no URL");
    }
    if (s.kind === "treatment") assert.match(s.dosingNote, /does not prescribe/, id);
    assert.deepEqual(allSkills[id], s, id + " is shadowed by another pack");
  }
});

test("no em-dash, en-dash or Devanagari in the shipped anaesthesia content (CliniX packs are English only)", () => {
  for (const f of ["skills/anaesthesia.json", "systems/anaesthesia.json"]) {
    const t = raw(f);
    assert.equal(t.search(/[–—]/), -1, f + " contains a dash character");
    assert.equal(t.search(/[ऀ-ॿ]/), -1, f + " contains Devanagari");
  }
});

/* The stations compile to OSCE ---------------------------------------------- */

test("eight stations, each with a checklist, a clock, a critical step and examiner questions", () => {
  assert.equal(stations.length, 8);
  assert.equal(new Set(stations.map((s) => s.id)).size, 8);
  for (const def of stations) {
    const st = M.compileStation(skillsOf(def.skills), def);
    assert.ok(st.items.length >= 12, `${def.id}: only ${st.items.length} checklist items`);
    assert.ok(st.criticalCount >= 2, `${def.id}: needs critical steps`);
    assert.ok(st.seconds >= 300 && st.seconds <= 600, `${def.id}: unrealistic clock ${st.seconds}`);
    assert.ok(def.task.length > 40 && def.examinerQuestions.length >= 3, def.id);
    assert.ok(def.competencies.length >= 2 && def.competencies.every((c) => /^AS\d+\.\d+$/.test(c)), def.id + " competency codes");
    const seen = new Set();
    for (const it of st.items) { assert.ok(!seen.has(it.id), "duplicate item " + it.id); seen.add(it.id); }
    const all = st.items.map((i) => i.id);
    assert.equal(M.scoreStation(st, all).passed, true, def.id + " cannot be passed");
    const noCrit = st.items.filter((i) => !i.critical).map((i) => i.id);
    const r = M.scoreStation(st, noCrit);
    assert.equal(r.failedOnCritical, true, def.id);
    assert.equal(r.passed, false, def.id);
  }
});

test("the station list covers the required topics, in order", () => {
  assert.deepEqual(stations.map((s) => s.id.replace("osce.ana.", "")),
    ["preop_assessment", "airway_assessment", "consent_ga", "consent_spinal", "bmv_opa", "lma", "spinal_procedure", "bls_adult"]);
});

test("competency codes are real NMC AS codes, and the airway stations carry the 2024 AS11 airway codes", () => {
  // AS1 to AS10 from the 2018 list (unchanged in CBME 2024); AS11.1 to AS11.6 are new in CBME 2024.
  const valid = new Set();
  const counts = { 1: 4, 2: 2, 3: 6, 4: 7, 5: 6, 6: 3, 7: 5, 8: 5, 9: 4, 10: 4, 11: 6 };
  for (const [t, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) valid.add("AS" + t + "." + i);
  for (const def of stations) for (const c of def.competencies) assert.ok(valid.has(c), def.id + ": unknown code " + c);
  const by = (id) => stations.find((s) => s.id === "osce.ana." + id).competencies;
  assert.ok(by("airway_assessment").includes("AS4.2"));
  for (const c of ["AS11.3", "AS11.4", "AS11.5"]) assert.ok(by("bmv_opa").includes(c), "bmv_opa " + c);
  assert.ok(by("lma").includes("AS11.5"));
  assert.ok(by("bls_adult").includes("AS2.1"));
  assert.ok(by("preop_assessment").includes("AS3.2"));
  assert.ok(by("spinal_procedure").includes("AS5.1"));
});

test("safety steps are critical: hand hygiene, capacity, CSF before injecting, capnography, no-touch at shock", () => {
  const critOf = (id) => {
    const def = stations.find((s) => s.id === "osce.ana." + id);
    return M.compileStation(skillsOf(def.skills), def).items.filter((i) => i.critical).map((i) => i.id);
  };
  assert.ok(critOf("spinal_procedure").includes("skill.exam.ana.spinal_inject_aftercare/csf"));
  assert.ok(critOf("spinal_procedure").includes("skill.approach.ana.spinal_prepare/iv"));
  assert.ok(critOf("lma").includes("skill.exam.ana.lma_insert/confirm"));
  assert.ok(critOf("bmv_opa").includes("skill.exam.ana.bmv/confirm"));
  assert.ok(critOf("consent_ga").includes("skill.approach.ana.consent_setup/capacity"));
  assert.ok(critOf("bls_adult").includes("skill.tx.ana.bls_aed/clear"));
  assert.ok(critOf("bls_adult").includes("skill.tx.ana.bls_cpr/depth"));
});

/* The viva ---------------------------------------------------------------- */

test("the viva pool is adaptive across all four levels", () => {
  const v = M.compileViva(skillsOf(mod.viva.skills));
  assert.deepEqual([...new Set(v.pool.map((q) => q.level))].sort(), [1, 2, 3, 4]);
  assert.ok(v.pool.length >= 50, "pool: " + v.pool.length);
  assert.ok(M.nextVivaQuestion(v, { level: 1, asked: {} }));
  assert.deepEqual([...mod.viva.skills].sort(), Object.keys(pack.skills).sort(), "the viva must cover every skill");
});

test("every viva question can be passed by its own model answer and failed by nonsense", () => {
  for (const s of Object.values(pack.skills)) {
    for (const p of s.probes) {
      assert.ok(p.accept.length >= p.minMatch, `${s.id}: minMatch ${p.minMatch} > ${p.accept.length}`);
      assert.equal(M.markAnswer(p, p.a).correct, true, `${s.id} L${p.level}: model answer fails (${p.q})`);
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

/* Numbers pinned to sources ---------------------------------------------------- */

test("BLS numbers match kb/clinical-protocols/adult-cardiac-arrest.json", () => {
  const kb = readFileSync(join(ROOT, "kb/clinical-protocols/adult-cardiac-arrest.json"), "utf8");
  for (const s of ["100 to 120/min", "at least 5 cm (not more than 6 cm)", "30:2", "10 breaths/min", "no more than 10 seconds",
    "every 2 minutes", "under 5 seconds", "without a pulse check", "mid-axillary line"]) {
    assert.ok(kb.includes(s), "the protocol no longer says: " + s + " (re-check the BLS skills)");
  }
  const bls = ["skill.tx.ana.bls_recognise", "skill.tx.ana.bls_cpr", "skill.tx.ana.bls_aed"].map((id) => JSON.stringify(pack.skills[id])).join(" ");
  for (const s of ["100 to 120 per minute", "at least 5 cm but not more than 6 cm", "30 compressions then 2 breaths", "10 breaths per minute",
    "no more than 10 seconds", "every 2 minutes", "under 5 seconds", "without a pulse check", "mid-axillary line", "100% oxygen"]) {
    assert.ok(bls.includes(s), "BLS content lost the protocol value: " + s);
  }
  for (const id of ["skill.tx.ana.bls_recognise", "skill.tx.ana.bls_cpr", "skill.tx.ana.bls_aed"]) {
    assert.match(pack.skills[id].sources.map((x) => x.source).join(" | "), /adult-cardiac-arrest/, id);
  }
});

test("the airway, fasting and ASA values are pinned to their cited documents", () => {
  const t = (id) => JSON.stringify(pack.skills[id]);
  const fast = t("skill.hx.ana.preop_drugs_fasting");
  for (const s of ["6 hours", "2 hours", "8 hours"]) assert.ok(fast.includes(s), "fasting lost: " + s);
  const asa = t("skill.reasoning.ana.asa_readiness");
  for (const s of ["constant threat to life", "moribund", "brain-dead organ donor", "Add E for an emergency"]) assert.ok(asa.includes(s), "ASA lost: " + s);
  const air = t("skill.exam.ana.airway_mouth") + t("skill.exam.ana.airway_jaw_neck");
  for (const s of ["less than 3 cm", "about 6 cm", "vermilion line", "without saying 'aah'"]) assert.ok(air.includes(s), "airway lost: " + s);
  const spinal = t("skill.exam.ana.spinal_position_asepsis");
  for (const s of ["0.5% chlorhexidine in alcohol", "L3-L4 or L4-L5", "Tuffier"]) assert.ok(spinal.includes(s), "spinal lost: " + s);
  // No spinal dose is given anywhere: dosing is the treating anaesthetist's decision.
  assert.equal(/\b\d+(\.\d+)?\s?(mg|mcg|micrograms)\b/i.test(JSON.stringify(pack)), false, "a drug dose crept into the pack");
});
