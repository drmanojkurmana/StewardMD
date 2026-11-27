/* ResearchMD journey and checklist keys for the five study types.
 * Case-control and case-series match before case-report.
 * Run: node --test test/research-journey.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contracts = require("../research-contracts.js");
const SMD = require("../research.js");
const stats = require("../research-stats.js");
const sampleSize = require("../research-samplesize.js");
const randomise = require("../research-randomise.js");
const phi = require("../research-phi.js");
const backup = require("../research-backup.js");

function journey(studyType) {
  return SMD.journeyFor({ studyType: studyType });
}

test("five study types follow the locked journey tables", function () {
  assert.deepEqual(contracts.STUDY_TYPES, ["case-report", "case-series", "case-control", "cohort", "rct"]);
  assert.deepEqual(journey("Case Report"), contracts.JOURNEYS["case-report"]);
  assert.deepEqual(journey("Case series"), contracts.JOURNEYS["case-series"]);
  assert.deepEqual(journey("Case-control study"), contracts.JOURNEYS["case-control"]);
  assert.deepEqual(journey("case control"), contracts.JOURNEYS["case-control"]);
  assert.deepEqual(journey("Cohort study"), contracts.JOURNEYS.cohort);
  assert.deepEqual(journey("Randomized Controlled Trial"), contracts.JOURNEYS.rct);
  assert.deepEqual(journey("randomised trial"), contracts.JOURNEYS.rct);
  assert.ok(journey("Case series").indexOf("masterchart") > journey("Case series").indexOf("images"));
  assert.equal(journey("Case Report").indexOf("masterchart"), -1);
  assert.ok(journey("Randomized Controlled Trial").indexOf("plan") < journey("Randomized Controlled Trial").indexOf("protocol"));
  assert.ok(journey("Randomized Controlled Trial").indexOf("ctri") < journey("Randomized Controlled Trial").indexOf("randomise"));
  assert.ok(journey("Randomized Controlled Trial").indexOf("manuscript") < journey("Randomized Controlled Trial").indexOf("checklist"));
});

test("checklist picker uses protocol and publication keys", function () {
  assert.equal(SMD.checklistFor({ studyType: "Case Report" }, "protocol"), "none");
  assert.equal(SMD.checklistFor({ studyType: "Case Report" }, "publication"), "care");
  assert.equal(SMD.checklistFor({ studyType: "Case series" }, "protocol"), "none");
  assert.equal(SMD.checklistFor({ studyType: "Case series" }, "publication"), "care");
  assert.equal(SMD.checklistFor({ studyType: "Case-control study" }, "protocol"), "none");
  assert.equal(SMD.checklistFor({ studyType: "Case-control study" }, "publication"), "strobe");
  assert.equal(SMD.checklistFor({ studyType: "Cohort study" }, "protocol"), "none");
  assert.equal(SMD.checklistFor({ studyType: "Cohort study" }, "publication"), "strobe");
  assert.equal(SMD.checklistFor({ studyType: "Randomized Controlled Trial" }, "protocol"), "spirit");
  assert.equal(SMD.checklistFor({ studyType: "Randomized Controlled Trial" }, "publication"), "consort");
  assert.equal(contracts.CHECKLISTS["case-report"].note, "SCARE for surgical case reports");
  assert.equal(contracts.CHECKLISTS["case-series"].note, "PROCESS 2025 for surgical case series");
});

test("legacy journeys stay on their old paths", function () {
  const thesis = journey("Thesis to Journal Article");
  assert.equal(thesis.length, 9);
  assert.equal(thesis[0], "thesis");
  assert.ok(thesis.indexOf("manuscript") >= 0);
  assert.equal(journey("Systematic Review & Meta-Analysis").length, 15);
  const obs = journey("Observational Study");
  assert.equal(obs.indexOf("iec"), -1);
  assert.equal(obs.indexOf("ctri"), -1);
  assert.notDeepEqual(obs, journey("Cohort study"));
  const chart = journey("Original Study (Master Chart)");
  assert.deepEqual(chart, ["plan", "protocol", "masterchart", "manuscript", "checklist", "ready"]);
  const synth = journey("cohort synthesis");
  assert.equal(synth.indexOf("iec"), -1);
  assert.equal(SMD.checklistFor({ studyType: "Observational Study" }, "publication"), "strobe");
  assert.equal(SMD.checklistFor({ studyType: "cohort synthesis" }, "publication"), "strobe");
  assert.equal(SMD.checklistFor({ studyType: "Original Study (Master Chart)" }, "publication"), "prisma2020");
  assert.equal(SMD.checklistFor({ studyType: "Cross-sectional study" }, "publication"), "prisma2020");
  assert.equal(SMD.checklistFor({ id: "p1", studyType: "Thesis to Journal Article" }, "publication"), "strobe");
});

test("research.js does not test the bare word case", function () {
  const src = readFileSync(new URL("../research.js", import.meta.url), "utf8");
  assert.equal(src.indexOf('indexOf("case")'), -1);
  assert.equal(src.indexOf("indexOf('case')"), -1);
});

test("start choices exist for all five study types", function () {
  const src = readFileSync(new URL("../research-screen-projects.js", import.meta.url), "utf8");
  assert.ok(src.indexOf("Case series (a few patients with the same condition)") >= 0);
  assert.ok(src.indexOf('studyType: "Case series"') >= 0);
  assert.ok(src.indexOf('studyType: "Case-control study"') >= 0);
  assert.ok(src.indexOf('studyType: "Cohort study"') >= 0);
  assert.ok(src.indexOf('studyType: "Case Report"') >= 0);
  assert.ok(src.indexOf('firstScreen: "casefile"') >= 0);
  assert.equal(src.indexOf('firstScreen: "manuscript"'), -1);
});

test("item 0 engine stubs and status helpers", async function () {
  // Survival, sample size, randomisation and backup are implemented.
  // A call with no data stays a soft failure and does not throw.
  assert.equal(stats.kaplanMeier().ok, false);
  assert.deepEqual(stats.kaplanMeier().warnings, []);
  assert.equal(stats.logRank().ok, false);
  assert.deepEqual(stats.logRank().warnings, []);
  assert.equal(stats.cox().ok, false);
  assert.deepEqual(stats.cox().warnings, []);
  assert.equal(stats.matchedOr().ok, false);
  assert.deepEqual(stats.matchedOr().warnings, []);
  assert.equal(sampleSize.caseControl().ok, false);
  assert.deepEqual(sampleSize.caseControl().warnings, []);
  assert.equal(sampleSize.logRankEvents().ok, false);
  assert.deepEqual(sampleSize.logRankEvents().warnings, []);
  assert.equal(randomise.blockList().ok, false);
  assert.deepEqual(randomise.blockList().warnings, []);
  assert.deepEqual(phi.prepareCaseText(), { text: "", removed: [], blocked: false, findings: [] });
  assert.deepEqual(phi.scan(), []);
  assert.deepEqual(phi.numbersNotIn(), []);
  const exported = await backup.exportFile();
  assert.equal(exported.ok, false);
  assert.equal(exported.reason, "not-a-backup");
  const read = await backup.readFile();
  assert.equal(read.ok, false);
  assert.equal(read.reason, "wrong-passphrase");
  const restored = await backup.restore();
  assert.equal(restored.ok, false);
  assert.equal(restored.added, 0);
  assert.equal(restored.updated, 0);
  assert.equal(restored.skipped, 0);
  assert.deepEqual(restored.warnings, []);
  assert.equal(await backup.isDue(), false);
  assert.equal(await globalThis.RMDIec.status("p1"), "none");
  assert.equal(await globalThis.RMDCtri.registered("p1"), false);
});

/* Minimal DOM-like container: real screens bind() against querySelector(All). */
function domStub() {
  return { innerHTML: "", querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
}

test("still-stub screens render a step banner, Next line and Coming soon", function () {
  const keys = ["pubconsent", "ctri", "randomise", "consort", "backup"];
  SMD.store = {
    getActiveProject: function () { return { studyType: "Case Report" }; }
  };
  keys.forEach(function (key) {
    require("../research-screen-" + key + ".js");
    const el = { innerHTML: "" };
    SMD.screens[key].render(el);
    assert.match(el.innerHTML, /rmd-step-banner/);
    assert.equal(el.innerHTML.indexOf("rmdStepBanner"), -1);
    if (key === "consort") {
      /* Live BUG-10: consort is a supporting screen, not a journey step, so it
       * renders an honest banner instead of a fake step and an invented Next. */
      assert.match(el.innerHTML, /CONSORT flow<\/strong> for this trial/);
      assert.equal(el.innerHTML.indexOf("Next:"), -1);
    } else {
      assert.match(el.innerHTML, /Next:/);
    }
    if (key === "backup") {
      assert.equal(el.innerHTML.indexOf("Coming soon"), -1);
      assert.match(el.innerHTML, /If you forget this passphrase, nobody can open the backup, including us\./);
    } else {
      assert.match(el.innerHTML, /Coming soon/);
    }
    SMD.screens[key].render(null);
  });
});

test("implemented case screens render a real step, not Coming soon", function () {
  const keys = ["casefile", "novelty", "iec", "images"];
  SMD.store = {
    getActiveProject: function () { return { studyType: "Case Report" }; }
  };
  keys.forEach(function (key) {
    require("../research-screen-" + key + ".js");
    const el = domStub();
    SMD.screens[key].render(el);
    assert.match(el.innerHTML, /rmd-step-banner/);
    assert.equal(el.innerHTML.indexOf("rmdStepBanner"), -1);
    assert.match(el.innerHTML, /Next:/);
    assert.equal(el.innerHTML.indexOf("Coming soon"), -1);
    SMD.screens[key].render(null);
  });
  const el = domStub();
  SMD.screens.casefile.render(el);
  assert.match(el.innerHTML, /Step 1 of 8/);
  assert.match(el.innerHTML, /Next: Novelty/);
});

test("new client files stay ES5 and have no em or en dash", function () {
  const files = [
    "research-contracts.js",
    "research-idb.js",
    "research-randomise.js",
    "research-phi.js",
    "research-backup.js",
    "research-screen-casefile.js",
    "research-screen-novelty.js",
    "research-screen-iec.js",
    "research-screen-pubconsent.js",
    "research-screen-images.js",
    "research-screen-ctri.js",
    "research-screen-randomise.js",
    "research-screen-consort.js",
    "research-screen-backup.js"
  ];
  files.forEach(function (name) {
    const src = readFileSync(new URL("../" + name, import.meta.url), "utf8");
    ["=>", "let ", "const ", "class ", "`", "async", "await", "\u2014", "\u2013"].forEach(function (tok) {
      assert.equal(src.indexOf(tok), -1, name + " has " + tok);
    });
  });
});
