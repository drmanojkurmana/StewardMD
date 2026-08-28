/* CliniX: a system's history chapter must teach the complaints that system actually presents with.
 *
 * The abdomen module's history chapter contained exactly two skills, chief complaints and abdominal
 * pain (owner report, 2026-08-25). A student could finish it having never been taught to take a
 * history of vomiting, dysphagia, diarrhoea, constipation, GI bleeding or weight loss. The skills
 * that DID exist for jaundice and ascites were not referenced by the module at all, so they were
 * reachable only from a disease pathway.
 *
 * Two things are asserted here:
 *   1. Coverage - each system's history chapter contains the presenting complaints below.
 *   2. Depth - every history skill teaches, rather than just listing questions.
 *
 * KNOWN_GAPS records the systems still to be filled. It is deliberately a list rather than a
 * failing test: the work is queued in vault/Roadmap.md, and this keeps it visible so that finishing
 * a system means deleting its line here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLINIX = join(ROOT, "clinix");

const load = (p) => JSON.parse(readFileSync(join(CLINIX, p), "utf8"));
const historyChapter = (system) =>
  load(`systems/${system}.json`).chapters.find((c) => c.id === "history")?.skills || [];

/* The complaints each system must be able to take a history of. */
const REQUIRED = {
  abdomen: ["pain", "dyspepsia", "vomiting", "dysphagia", "diarrhoea", "constipation", "gibleed", "ascites", "jaundice", "weightloss"],
  cardiovascular: ["chestpain", "dyspnea_edema", "palpitations", "syncope", "riskfactors", "treatment"],
  respiratory: ["cough_sputum", "haemoptysis", "dyspnea", "wheeze", "chestpain", "smoking", "drug"],
  neurology: ["approach", "weakness", "headache", "seizure", "vertigo", "stroke.risk"],
};

/* Still thin. Filling one means adding it to REQUIRED and deleting it here.
 * All four systems now carry their core symptom set. What remains is a genuine but narrower gap:
 * the cranial-nerve symptom history (visual loss, diplopia, facial numbness, hoarseness, nasal
 * regurgitation) is taught in the EXAMINATION chapters but has no history skill of its own. */
const KNOWN_GAPS = {
  neurology: ["cranial nerve symptom history: visual loss, diplopia, facial sensation, hoarseness"],
};

test("every system teaches its whole symptom set, not just one complaint", () => {
  /* Each system's history chapter used to carry two or three skills. A student could finish the
   * abdomen module never having been taught to take a history of vomiting or GI bleeding, and the
   * cardiovascular module without palpitations or syncope. */
  const broken = [];
  for (const [system, required] of Object.entries(REQUIRED)) {
    const skills = historyChapter(system);
    const missing = required.filter((c) => !skills.some((s) => s.includes(c)));
    if (missing.length) broken.push(`${system} is missing: ${missing.join(", ")}`);
    if (!skills.includes("skill.hx.chief_complaints")) broken.push(`${system}: chief complaints must come first`);
  }
  assert.deepEqual(broken, [], "history chapters missing their core complaints:\n  " + broken.join("\n  "));
});

test("every skill a history chapter references actually exists", () => {
  // A chapter can reference a skill defined in its own system file or in core.
  const core = Object.keys(load("skills/core.json").skills);
  const broken = [];
  for (const system of ["abdomen", "cardiovascular", "respiratory", "neurology"]) {
    const defined = new Set([...Object.keys(load(`skills/${system}.json`).skills), ...core]);
    for (const s of historyChapter(system)) if (!defined.has(s)) broken.push(`${system} -> ${s}`);
  }
  assert.deepEqual(broken, [], "history chapters referencing undefined skills:\n  " + broken.join("\n  "));
});

test("a history skill TEACHES, it does not just list questions", () => {
  /* The point of CliniX is the reasoning behind the question. A skill with asks but no teach block
   * is a checklist, which the student already has. */
  const thin = [];
  for (const system of ["abdomen", "cardiovascular", "respiratory", "neurology"]) {
    const skills = load(`skills/${system}.json`).skills;
    for (const [id, s] of Object.entries(skills)) {
      if (s.kind !== "history") continue;
      const bad = [];
      if (!(s.asks || []).length) bad.push("no asks");
      if (!(s.teach || []).length) bad.push("no teach");
      if (!(s.probes || []).length) bad.push("no probes");
      if (!s.why) bad.push("no why");
      if (bad.length) thin.push(`${id}: ${bad.join(", ")}`);
    }
  }
  assert.deepEqual(thin, [], "history skills that do not teach:\n  " + thin.join("\n  "));
});

test("the new GI histories carry graded probes and a rubric", () => {
  const skills = load("skills/abdomen.json").skills;
  const added = ["vomiting", "dysphagia", "gibleed", "diarrhoea", "constipation", "dyspepsia", "weightloss"];
  for (const c of added) {
    const id = `skill.hx.gi.${c}`;
    const s = skills[id];
    assert.ok(s, `${id} missing`);
    // Every level must be COVERED. More than one probe at a level is a richer skill, not a fault.
    const levels = new Set((s.probes || []).map((p) => p.level));
    for (const lvl of [1, 2, 3]) {
      assert.ok(levels.has(lvl), `${id} has no level ${lvl} probe (has ${[...levels].sort()})`);
    }
    assert.ok((s.rubric || []).length >= 3, `${id} needs a rubric a marker can use`);
    assert.ok((s.pitfalls || []).length >= 2, `${id} needs pitfalls`);
    assert.equal(s.review?.status, "ai_drafted", `${id} must be marked for R1 review`);
    assert.ok((s.sources || []).length >= 1, `${id} must cite its sources`);
  }
});

test("the remaining history gaps stay visible instead of being forgotten", () => {
  // Not a failure: a checklist. Finishing a system means moving it from KNOWN_GAPS into REQUIRED.
  for (const [system, gaps] of Object.entries(KNOWN_GAPS)) {
    assert.ok(gaps.length > 0, `${system} has an empty gap list - move it into REQUIRED instead`);
    assert.ok(historyChapter(system).length >= 2, `${system} history chapter looks empty`);
  }
  for (const done of Object.keys(REQUIRED)) {
    if (KNOWN_GAPS[done]) {
      // A system may appear in both only if the remaining gap is narrower than its core set.
      assert.ok(KNOWN_GAPS[done].length <= 2, `${done} is built; its gap list should be small or gone`);
    }
  }
});
