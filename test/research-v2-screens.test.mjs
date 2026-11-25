/* Plan v2 screens: the pure parts (CONSORT sums, blinding sentence, case series
 * to master chart, number marking, consent template, CTRI and ethics banners,
 * image sizing, novelty query) plus the ES5 and no-dash rules for every new file.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-v2-screens.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.SMD_RESEARCH_CONTRACTS = require("../research-contracts.js");
const K = require("../research-screen-kit.js");
for (const f of ["casefile", "novelty", "iec", "pubconsent", "images", "ctri", "randomise", "consort", "backup"]) require("../research-screen-" + f + ".js");
const S = globalThis.SMD_RESEARCH.screens;

const FILES = ["kit", "casefile", "novelty", "iec", "pubconsent", "images", "ctri", "randomise", "consort", "backup"].map((f) => "research-screen-" + f + ".js");

test("new screen files are ES5 with no em or en dashes", () => {
  for (const f of FILES) {
    const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.ok(!/=>/.test(src), f + " has an arrow function");
    assert.ok(!/\b(let|const|class|async|await)\s/.test(src), f + " has ES6 keywords");
    assert.ok(!/`/.test(src), f + " has a template literal");
    assert.ok(!/[–—]/.test(src), f + " has a dash");
  }
});

test("every journey step has a screen", () => {
  const C = globalThis.SMD_RESEARCH_CONTRACTS;
  for (const t of ["case-report", "case-series", "case-control", "cohort", "rct"]) {
    for (const step of C.journey(t)) {
      if (["plan", "protocol", "masterchart", "manuscript", "checklist", "ready"].includes(step)) continue;
      assert.ok(S[step] && S[step].render, t + ": " + step);
    }
  }
  assert.equal(C.typeKey("Case Series"), "case-series");
  assert.equal(C.typeKey("Case Report"), "case-report");
});

test("CONSORT sums: all four checks, silent when they add up", () => {
  const ok = { assessed: 120, notMeeting: 10, declined: 6, otherReasons: 4, randomised: 100, arms: [
    { name: "Dressing", allocated: 50, received: 48, notReceived: 2, analysed: 47, excludedAnalysis: 3 },
    { name: "Standard", allocated: 50, received: 50, notReceived: 0, analysed: 50, excludedAnalysis: 0 }] };
  assert.deepEqual(S.consort.checks(ok), []);
  const bad = JSON.parse(JSON.stringify(ok));
  bad.assessed = 121; bad.arms[0].allocated = 51; bad.arms[1].analysed = 49;
  const w = S.consort.checks(bad);
  assert.equal(w.length, 5);
  assert.match(w[0], /Assessed \(121\) should equal excluded \(20\) plus randomised \(100\)/);
  assert.match(w.join(" "), /Randomised \(100\) should equal the sum allocated to the arms \(101\)/);
  assert.deepEqual(S.consort.checks(S.consort.blank()), [], "empty form shows nothing");
  assert.match(S.consort.svg(ok), /^<svg[^>]+><rect/);
  assert.match(S.consort.svg(ok), /Allocated to Dressing \(n = 50\)/);
});

test("blinding paragraph names the groups and never says single, double or triple", () => {
  const t = S.randomise.blindingText({ participants: true, assessors: true, how: "identical tablets" });
  assert.equal(t, "Participants and outcome assessors did not know which treatment each patient received (identical tablets).");
  assert.equal(S.randomise.blindingText({ nobody: true, why: "the operations look different." }), "Nobody was blinded, because the operations look different.");
  assert.ok(!/single|double|triple/i.test(t));
});

test("keeper sheet holds the seed and arms; envelope labels hold numbers only", () => {
  const res = require("../research-randomise.js").blockList({ seed: "thesis-2026", arms: ["A", "B"], n: 8, blockSizes: [4] });
  const env = S.randomise.envelopeSheet(res), keep = S.randomise.keeperSheet(res, "abc");
  assert.ok(!/\b[AB]\b/.test(env.replace(/Envelope labels \(envelope numbers only\)/, "")), "no arm on envelope labels");
  assert.match(keep, /Seed: thesis-2026/);
  assert.match(keep, /1-001  [AB]/);
});

test("case series becomes one master chart row per patient", () => {
  const rec = S.casefile.toMasterChart([
    { id: "1", value: { age: "34", sex: "Male", diagnosis: "X", investigations: [{ test: "Troponin I", value: "2.4" }] } },
    { id: "2", value: { age: "51", sex: "Female", diagnosis: "X", investigations: [{ test: "Potassium", value: "3.1" }, { test: "Troponin I", value: "0.9" }] } }]);
  assert.deepEqual(rec.columns, ["patient", "age", "sex", "diagnosis", "treatment", "outcome", "Troponin I", "Potassium"]);
  assert.deepEqual(rec.rows[1], ["2", "51", "Female", "X", "", "", "0.9", "3.1"]);
});

test("numbers not in the case file are marked, entities are left alone", () => {
  const html = S.casefile.markNumbers("K 2.90 and 3.1, it's day 9", ["2.9"]);
  assert.match(html, /<mark title="This number is not in your case file\. Check it\.">2\.90<\/mark>/);
  assert.match(html, /it&#39;s day 9/);
});

test("Do it myself consent holds every required element", () => {
  const t = S.pubconsent.template("ECG on Day 0");
  assert.match(t.whatWillBePublished, /images/);
  assert.match(t.readWorldwide, /world.*online|online.*world/);
  assert.match(t.mayBeRecognised, /name will not be used.*recognise/);
  assert.match(t.canWithdraw, /withdraw.*before.*published/);
  assert.match(t.careNotAffected, /not change your care/);
  assert.equal(t.images, "ECG on Day 0");
  assert.match(t.signatureBlock, /thumb impression/);
  assert.match(t.signatureBlock, /Witness/);
  assert.match(t.signatureBlock, /next of kin or legally acceptable representative/);
  assert.match(t.signatureBlock, /Date/);
  assert.match(S.pubconsent.SIGN_LINE, /^Get the patient or next of kin to sign this before you submit\./);
});

test("ethics and CTRI banners: calm, case reports never gated", () => {
  assert.deepEqual(K.gateMessages("case-report", null, null), []);
  assert.deepEqual(K.gateMessages("cohort", { status: "approved" }, null), []);
  assert.deepEqual(K.gateMessages("cohort", { status: "submitted" }, null), [K.IEC_BANNER]);
  assert.deepEqual(K.gateMessages("rct", { status: "waiver" }, { number: "CTRI/2026/01/012345" }), []);
  assert.deepEqual(K.gateMessages("rct", { status: "approved" }, { number: "CTRI/26/1/1" }), ["Register on CTRI before you enrol the first patient."]);
  assert.ok(K.CTRI_RE.test("CTRI/2020/05/025013"));
  assert.equal(S.ctri.sentence({ number: "CTRI/2026/01/012345", date: "2026-01-10" }),
    "The trial was registered prospectively with the Clinical Trials Registry - India (CTRI/2026/01/012345) on 2026-01-10.");
  assert.match(S.iec.STUDY_LINE, /only the ethics committee can decide that a study is exempt/);
});

test("images: longest side capped at 2048, boxes kept inside the picture", () => {
  assert.deepEqual(S.images.fitSize(4032, 3024), { w: 2048, h: 1536, scale: 2048 / 4032 });
  assert.equal(S.images.fitSize(800, 600).scale, 1);
  assert.deepEqual(S.images.normRect(50, 40, -10, 500, 100, 200), { x: 0, y: 40, w: 50, h: 160 });
});

test("novelty query uses the diagnosis and unusual feature only, without numbers", () => {
  assert.equal(S.novelty.buildQuery({ diagnosis: "Acute myocardial injury from zinc phosphide poisoning", novelty: "ST elevation in 3 leads with normal coronaries", age: "34" }),
    "Acute myocardial injury zinc phosphide poisoning ST elevation leads normal coronaries");
  assert.match(S.novelty.countLine(3), /^We found 3 similar published cases\.$/);
});

test("master chart survival card: median, sentence and curve from survival::lung", () => {
  globalThis.SMD_RESEARCH_STATS = require("../research-stats.js");
  require("../research-screen-masterchart.js");
  const M = globalThis.SMD_RESEARCH.screens.masterchart;
  const L = JSON.parse(readFileSync(new URL("./fixtures/research/survival/lung.json", import.meta.url), "utf8"));
  const St = globalThis.SMD_RESEARCH_STATS;
  const km = St.kaplanMeier(L.time, L.status, null);
  assert.equal(M.medianCell(km.groups[0].median), "310.0 (95% CI 285.0 to 363.0)");
  assert.equal(M.medianCell({ value: null }), "not reached");
  const sex = L.sex.map((x) => (x === 1 ? "Male" : "Female"));
  const km2 = St.kaplanMeier(L.time, L.status, sex), lr = St.logRank(L.time, L.status, sex);
  const s = M.survivalSentence(km2, lr, "time");
  assert.match(s, /^Kaplan-Meier analysis of time\. Female/);
  assert.match(s, /Log-rank test: chi-square 10\.33, df 1, p/);
  assert.ok(!/[–—]/.test(s));
  const svg = M.kmSvg(km2, "Days");
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, />Male</);
  const src = readFileSync(new URL("../research-screen-masterchart.js", import.meta.url), "utf8");
  assert.ok(!/=>|`/.test(src) && !/\b(let|const|class|async|await)\s/.test(src) && !/[–—]/.test(src), "master chart stays ES5 with no dashes");
});
