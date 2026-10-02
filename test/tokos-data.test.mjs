// test/tokos-data.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Tokós on the engine: levels, trials and storage come from specialty-data.js with the Tokós keys; the CTG checklist,
// key, grading and review labels from the CTG clinic plugin (tokos-ctg.js).
const S = createRequire(import.meta.url)("../specialty-data.js");
const D = createRequire(import.meta.url)("../tokos-ctg.js");

test("trialState: open when Pro, trial when unused, used when spent", () => {
  const store = { trials: {} };
  assert.equal(S.trialState(store, "clinic.ctg", true), "open");
  assert.equal(S.trialState(store, "clinic.ctg", false), "trial");
  S.useTrial(store, "clinic.ctg", 100);
  assert.equal(S.trialState(store, "clinic.ctg", false), "used");
});

test("useTrial only records the first use", () => {
  const store = { trials: {} };
  assert.equal(S.useTrial(store, "x", 1), true);
  assert.equal(S.useTrial(store, "x", 2), false);
  assert.equal(store.trials.x, 1);
});

test("levelLocked: resident locked unless free-listed or Pro", () => {
  const cfg = { access: { freeLevels: ["mbbs"] } };
  assert.equal(S.levelLocked(cfg, "resident", false), true);
  assert.equal(S.levelLocked(cfg, "resident", true), false);
  assert.equal(S.levelLocked(cfg, "mbbs", false), false);
});

test("loadStore returns a fresh store shape when localStorage is empty or corrupt", () => {
  const fakeLs = { getItem: () => null, setItem: () => {} };
  const s = S.loadStore(fakeLs, "smd_tokos_v1");
  assert.deepEqual(s.cards, {});
  assert.deepEqual(s.trials, {});
});

test("loadPrefs defaults to mbbs level, English, and no tab until first-run choice", () => {
  const fakeLs = { getItem: () => null };
  const p = S.loadPrefs(fakeLs, "smd_tokos_prefs");
  assert.equal(p.level, "mbbs");
  assert.equal(p.lang, "en");
  assert.equal(p.tab, undefined);
});

test("today() computes a stable local day number", () => {
  const d1 = S.today(Date.UTC(2026, 8, 29, 6, 0));
  const d2 = S.today(Date.UTC(2026, 8, 29, 6, 0) + 3600000);
  assert.equal(d1, d2);
});

const C = createRequire(import.meta.url)("../specialty-core.js");
const baseCase = {
  figo: "suspicious", acidosis: "metabolic", review: null, vignette: { risks: ["pyrexia"] },
  features: { baselineClass: "tachycardia", variability: { band: "normal" }, contractions: { tachysystole: false }, decels: [{ durationSec: 200, subtypeSuggested: "late" }] },
};

test("MBBS answers 5 questions; Resident adds action, and decelType only when a reviewer confirmed it", () => {
  assert.deepEqual(D.checklistFor(baseCase, "mbbs"), ["uc", "baseline", "variability", "decels", "figo"]);
  assert.deepEqual(D.checklistFor(baseCase, "resident"), ["uc", "baseline", "variability", "decels", "figo", "action"]);
  const reviewed = Object.assign({}, baseCase, { review: { by: "Dr X", decelType: "late" } });
  assert.ok(D.checklistFor(reviewed, "resident").includes("decelType"));
});

test("truthFor derives from features, and a reviewer's label wins over the rule", () => {
  const t = D.truthFor(baseCase);
  assert.deepEqual([t.uc, t.baseline, t.decels, t.figo, t.action], ["normal", "tachycardia", "prolonged", "suspicious", "suspicious"]);
  assert.equal(D.truthFor(Object.assign({}, baseCase, { review: { figo: "pathological" } })).figo, "pathological");
});

test("grading: all right is EASY, a wrong FIGO category caps at HARD, under half is AGAIN", () => {
  const ids = D.checklistFor(baseCase, "mbbs"), t = D.truthFor(baseCase);
  const right = {}; ids.forEach((q) => (right[q] = t[q]));
  assert.equal(D.gradeChecklist(ids, right, t).grade, C.EASY);
  assert.equal(D.gradeChecklist(ids, Object.assign({}, right, { figo: "normal" }), t).grade, C.HARD);
  assert.equal(D.gradeChecklist(ids, { uc: "tachysystole", baseline: "normal", variability: "reduced", decels: "none", figo: "suspicious" }, t).grade, C.AGAIN);
});

test("rationaleKeys picks the teaching points this case shows, always ending with trace_vs_outcome", () => {
  const k = D.rationaleKeys(baseCase);
  assert.ok(k.includes("baseline.tachycardia") && k.includes("decels.prolonged") && k.includes("acidosis.metabolic") && k.includes("risk.pyrexia"));
  assert.equal(k[k.length - 1], "trace_vs_outcome");
});

test("every graded field is overridable by the reviewer; action follows figo; invalid values fall back to the rule", () => {
  const review = { uc: "tachysystole", baselineClass: "normal", variability: "reduced", decels: "present", decelType: "late", figo: "pathological" };
  const t = D.truthFor(Object.assign({}, baseCase, { review }));
  assert.deepEqual([t.uc, t.baseline, t.variability, t.decels, t.decelType, t.figo, t.action],
    ["tachysystole", "normal", "reduced", "present", "late", "pathological", "pathological"]);
  const bad = D.truthFor(Object.assign({}, baseCase, { review: { variability: "Reduced", figo: "abnormal", decelType: "x" } }));
  assert.deepEqual([bad.variability, bad.figo, bad.decelType], ["normal", "suspicious", undefined]);
  assert.ok(!D.checklistFor(Object.assign({}, baseCase, { review: { decelType: "x" } }), "resident").includes("decelType"));
});

test("reviewComplete: only review.complete === true counts; partial labels keep the rule-based banner", () => {
  assert.equal(D.reviewComplete(baseCase), false);
  assert.equal(D.reviewComplete(Object.assign({}, baseCase, { review: { by: "Dr X", figo: "normal" } })), false);
  assert.equal(D.reviewComplete(Object.assign({}, baseCase, { review: { complete: "yes" } })), false);
  assert.equal(D.reviewComplete(Object.assign({}, baseCase, { review: { by: "Dr X", date: "2026-10-01", complete: true } })), true);
});

test("decelerations key: exactly 3 min is not prolonged (FIGO: more than 3 min); over 5 min is over5", () => {
  const withDecel = (sec) => D.truthFor(Object.assign({}, baseCase, { features: Object.assign({}, baseCase.features, { decels: [{ durationSec: sec }] }) })).decels;
  assert.equal(withDecel(180), "present");
  assert.equal(withDecel(181), "prolonged");
  assert.equal(withDecel(300), "prolonged");
  assert.equal(withDecel(301), "over5");
});
