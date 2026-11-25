/* Plan v2 items 0 and 1: study type keys, journeys and checklist keys for all five types.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-journeys.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const C = require("../research-contracts.js");
globalThis.SMD_RESEARCH_CONTRACTS = C;
const SMD = require("../research.js");

const JOURNEYS = {
  "case-report": ["casefile", "novelty", "iec", "pubconsent", "images", "manuscript", "checklist", "ready"],
  "case-series": ["casefile", "novelty", "iec", "pubconsent", "images", "masterchart", "manuscript", "checklist", "ready"],
  "case-control": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
  "cohort": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
  "rct": ["plan", "protocol", "iec", "ctri", "randomise", "masterchart", "checklist", "manuscript", "ready"]
};

const CHECKLISTS = {
  "case-report": ["", "care"],
  "case-series": ["", "care"],
  "case-control": ["strobe", "strobe"],
  "cohort": ["strobe", "strobe"],
  "rct": ["spirit", "consort"]
};

test("type keys: case-control and case-series win over case-report; bare case never matches", () => {
  assert.equal(C.typeKey("Case Report"), "case-report");
  assert.equal(C.typeKey("Case Series"), "case-series");
  assert.equal(C.typeKey("Case-Control Study"), "case-control");
  assert.equal(C.typeKey("case control study of a case report"), "case-control");
  assert.equal(C.typeKey("Cohort Study"), "cohort");
  assert.equal(C.typeKey("Randomized Controlled Trial"), "rct");
  assert.equal(C.typeKey("Randomised controlled trial"), "rct");
  assert.equal(C.typeKey("case"), "");
  assert.equal(C.typeKey("Systematic Review & Meta-Analysis"), "");
  assert.equal(C.typeKey("Systematic review of randomized trials"), "");
  assert.equal(C.typeKey("Thesis to Journal Article"), "");
  assert.equal(C.typeKey("Original Study (Master Chart)"), "");
  assert.equal(C.typeKey("Observational Study"), "");
});

test("contract journeys and checklist keys for all five types", () => {
  assert.deepEqual(C.TYPES, Object.keys(JOURNEYS));
  for (const t of C.TYPES) {
    assert.deepEqual(C.journey(t), JOURNEYS[t], t);
    assert.equal(C.checklistFor(t, "protocol"), CHECKLISTS[t][0], t + " protocol");
    assert.equal(C.checklistFor(t, "publication"), CHECKLISTS[t][1], t + " publication");
    const j = C.journey(t);
    assert.equal(j[j.length - 1], "ready");
    if (j.indexOf("protocol") >= 0) assert.equal(j[j.indexOf("protocol") + 1], "iec", t + ": iec right after protocol");
  }
  assert.ok(C.journey("rct").indexOf("ctri") === C.journey("rct").indexOf("iec") + 1);
  assert.ok(C.journey("rct").indexOf("randomise") < C.journey("rct").indexOf("masterchart"));
});

test("research.js journeyFor uses the contract once every step screen is loaded", () => {
  SMD.screens = SMD.screens || {};
  for (const k of ["casefile", "novelty", "iec", "pubconsent", "images", "ctri", "randomise"]) SMD.screens[k] = { render() {} };
  const names = { "case-report": "Case Report", "case-series": "Case Series", "case-control": "Case-Control Study", "cohort": "Cohort Study", "rct": "Randomized Controlled Trial" };
  for (const t of C.TYPES) assert.deepEqual(SMD.journeyFor({ studyType: names[t] }), JOURNEYS[t], t);
});

test("journeyFor hides a new step whose screen is not loaded", () => {
  const saved = SMD.screens.ctri;
  delete SMD.screens.ctri;
  assert.deepEqual(SMD.journeyFor({ studyType: "Randomized Controlled Trial" }), JOURNEYS.rct.filter((k) => k !== "ctri"));
  SMD.screens.ctri = saved;
});

test("older project types keep their journeys", () => {
  assert.equal(SMD.journeyFor({ studyType: "Systematic Review & Meta-Analysis" })[0], "studies");
  assert.equal(SMD.journeyFor({ studyType: "Thesis to Journal Article" })[0], "thesis");
  assert.deepEqual(SMD.journeyFor({ studyType: "Original Study (Master Chart)" }), ["plan", "protocol", "masterchart", "manuscript", "checklist", "ready"]);
});

test("every new step has a tab label and a Next line", () => {
  const src = readFileSync(new URL("../research.js", import.meta.url), "utf8");
  for (const k of ["casefile", "novelty", "iec", "pubconsent", "images", "ctri", "randomise"]) {
    assert.ok(new RegExp("\\b" + k + ': "').test(src), k + " label/tip");
    assert.ok(C.NEXT_LINES[k], k + " next line");
  }
});

test("contract sources are ES5 with no dashes", () => {
  for (const f of ["../research-contracts.js", "../research-randomise.js"]) {
    const s = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/=>/.test(s) && !/\b(let|const|class)\s/.test(s), f);
    assert.ok(!/[–—]/.test(s), f);
  }
});
