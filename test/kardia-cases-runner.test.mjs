/* Kardia Cases (WP11): pure grading helpers, fixture schema and wiring.
   Run: node --test --experimental-test-module-mocks --experimental-sqlite test/kardia-cases-runner.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build, summarise } from "../tools/kardia-cases-index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const H = createRequire(import.meta.url)("../kardia-cases.js");
const FIX = join(HERE, "fixtures", "kardia-cases");
const msCase = JSON.parse(readFileSync(join(FIX, "severe-rheumatic-ms-af.json"), "utf8"));
const miCase = JSON.parse(readFileSync(join(FIX, "anterior-mi-apical-rwma.json"), "utf8"));

test("normalise: case, punctuation and spacing collapse", () => {
  assert.equal(H.normalizeText("  Severe  Mitral-Stenosis! "), "severe mitral stenosis");
  assert.equal(H.normalizeText("EF 47%"), "ef 47%");
  assert.equal(H.normalizeText(null), "");
});

test("accept matching: exact, synonym and phrase in a longer answer", () => {
  const accept = ["mitral stenosis", "severe rheumatic mitral stenosis"];
  assert.equal(H.matchAccept("Mitral stenosis.", accept), true);
  assert.equal(H.matchAccept("severe rheumatic mitral stenosis with AF", accept), true);
  assert.equal(H.matchAccept("  MITRAL   STENOSIS ", accept), true);
});

test("accept matching: no substring false positives", () => {
  assert.equal(H.matchAccept("symptoms improved", ["ms"]), false, "ms inside symptoms must not match");
  assert.equal(H.matchAccept("stenosis", ["mitral stenosis"]), false, "one word of a phrase must not match");
  assert.equal(H.matchAccept("mitral stenoses", ["mitral stenosis"]), false, "near token must not match");
  assert.equal(H.matchAccept("aortic stenosis", ["mitral stenosis"]), false);
  assert.equal(H.matchAccept("mitralstenosis", ["mitral stenosis"]), false);
  assert.equal(H.matchAccept("", ["mitral stenosis"]), false);
  assert.equal(H.matchAccept("mitral stenosis", []), false);
  assert.equal(H.matchAccept("atrial fibrillation", ["af"]), false, "abbreviation needs its own token, not a substring");
  assert.equal(H.matchAccept("AF", ["af"]), true);
});

test("tolerance grading: inclusive boundary, outside and bad input", () => {
  assert.deepEqual(H.gradeTolerance(0.9, 0.9, 0.2), { correct: true, value: 0.9, truth: 0.9, error: 0, within: true });
  assert.equal(H.gradeTolerance(1.1, 0.9, 0.2).correct, true, "upper boundary is inclusive");
  assert.equal(H.gradeTolerance(0.7, 0.9, 0.2).correct, true, "lower boundary is inclusive");
  assert.equal(H.gradeTolerance(1.11, 0.9, 0.2).correct, false);
  assert.equal(H.gradeTolerance("47 percent", 47, 5).correct, true, "units in the typed text are ignored");
  assert.equal(H.gradeTolerance("not a number", 47, 5).correct, false);
  assert.equal(H.gradeTolerance("", 47, 5).value, null);
});

test("report marking: per field, synonyms and score", () => {
  const r = H.gradeReport(msCase.report.required, {
    "Left atrium": "large left atrium",
    "Mitral valve": "Rheumatic mitral stenosis",
    "Mitral valve area": "completely wrong",
    "Rhythm during study": "AF",
  });
  assert.equal(r.total, 4);
  assert.equal(r.correct, 3);
  assert.equal(r.score, 0.75);
  assert.deepEqual(r.fields.map((f) => f.correct), [true, true, false, true]);
  const empty = H.gradeReport(miCase.report.required, {});
  assert.equal(empty.correct, 0);
});

test("diagnosis marking uses the accept list without substrings", () => {
  assert.equal(H.gradeDiagnosis(miCase.diagnosis, "Anterior STEMI").correct, true);
  assert.equal(H.gradeDiagnosis(miCase.diagnosis, "inferior mi").correct, false);
  assert.equal(H.gradeDiagnosis(msCase.diagnosis, "mitral stenosis").correct, true);
});

test("ECG params: AF is irregular with no P, STEMI lifts ST, LVH raises voltage", () => {
  const af = H.ecgParamsFor(msCase);
  assert.equal(af.rhythm, "irregular"); assert.equal(af.p, "none"); assert.equal(af.rate, 90);
  const mi = H.ecgParamsFor(miCase);
  assert.equal(mi.rhythm, "regular"); assert.equal(mi.st, "up");
  const lvh = H.ecgParamsFor({ ecg: { rhythm: "Sinus rhythm", rate: 70, axis: "Normal", findings: ["Left ventricular hypertrophy"] }, vitals: {} });
  assert.ok(lvh.amp > 1.5);
});

test("audio kind follows the pathology record and murmur timing", () => {
  assert.equal(H.audioKindFor(null, msCase), "ms_murmur");
  assert.equal(H.audioKindFor(null, miCase), "s4_gallop", "S4 in the text maps to the gallop model");
  const doc = { sound: { murmur: { timing: "mid diastolic", shape: "rumbling", location: "apex" } } };
  assert.equal(H.audioKindFor(doc, { pathology: { id: "unknown", severity: null }, exam: {} }), "ms_murmur");
  assert.equal(H.murmurSiteFor(doc, { pathology: { id: "unknown", severity: null } }), "apex");
  assert.equal(H.audioKindFor(null, { pathology: { id: "unknown" }, exam: { auscultation: { added: "", murmur: "No murmur" } } }), "s1s2_normal");
});

test("echo diagram resolves the lesson diagram for a view", () => {
  assert.equal(H.diagramFor("tte_a4c", "mitral_stenosis"), "diagrams/view_a4c.svg");
  assert.equal(H.diagramFor("tte_plax", "x"), "diagrams/view_plax.svg");
  assert.equal(H.diagramFor("tee_me_4c", "x"), "diagrams/tee_me_4c.svg");
  const fs = readFileSync(join(ROOT, "kardia", "learn", "diagrams", "view_a4c.svg"), "utf8");
  assert.ok(fs.includes("<svg"), "the A4C lesson diagram exists on disk");
});

test("fixtures satisfy the case schema and the index builder", () => {
  for (const c of [msCase, miCase]) {
    assert.equal(c.review.status, "ai_drafted");
    assert.ok(c.history.length >= 3 && c.echoTasks.length >= 1);
    for (const t of c.echoTasks) if (t.measure) assert.ok(t.measure.tolerance > 0 && t.measure.unit);
    for (const r of c.report.required) assert.ok(r.accept.length >= 1, r.field);
    assert.deepEqual(summarise(c, c.id + ".json").errors, []);
  }
  assert.equal(msCase.pathology.id, "mitral_stenosis"); assert.equal(msCase.pathology.severity, "severe");
  assert.match(msCase.ecg.rhythm, /fibrillation/i);
  assert.equal(miCase.pathology.id, "regional_wall_motion_abnormality_mi");
  assert.ok(miCase.ecg.findings.join(" ").includes("ST elevation"));
  const { index, errors } = build(FIX);
  assert.deepEqual(errors, []);
  assert.deepEqual(index.cases.map((c) => c.id), ["fixture-ms-af", "fixture-anterior-mi"]);
  const bad = summarise({ id: "x" }, "x.json");
  assert.ok(bad.errors.length > 3, "a thin case is rejected");
});

test("production case index exists and is valid JSON with a cases list", () => {
  const ix = JSON.parse(readFileSync(join(ROOT, "kardia", "cases", "index.json"), "utf8"));
  assert.ok(Array.isArray(ix.cases), "the parallel case data lands behind this index without code changes");
});

test("wiring: loader loads cases after the host, kardia.js delegates only the Cases tab", () => {
  const loader = readFileSync(join(ROOT, "kardia-loader.js"), "utf8");
  assert.ok(loader.includes('"kardia-cases.js"') && loader.includes('"kardia-cases.css"'));
  assert.ok(loader.includes('"clinix-audio.js"') && loader.includes('"kardiox-ecgwave.js"'), "sound and ECG engines load with Cases");
  assert.ok(loader.indexOf('"kardia.js"') < loader.indexOf('"kardia-cases.js"'), "host first, then Cases");
  const host = readFileSync(join(ROOT, "kardia.js"), "utf8");
  assert.ok(host.includes("KARDIA_CASES"), "Cases tab delegates to kardia-cases.js");
  assert.ok(host.includes("soonHtml(id)"), "other coming soon panels stay untouched");
  const src = readFileSync(join(ROOT, "kardia-cases.js"), "utf8");
  assert.ok(!/=>|`|\bconst\b|\blet\b/.test(src), "ES5 only: no arrows, templates, const or let");
  assert.ok(!/[\u2013\u2014]/.test(src), "no em or en dash in cases source");
  assert.ok(/SPECIALTY_CORE/.test(src) && /recordSim/.test(src) && /review\(/.test(src), "attempt and FSRS card recorded in the engine store");
  assert.ok(/SMD_CLINIX_AUDIO/.test(src) && /SMD_KARDIOX_ECGWAVE/.test(src), "existing audio and ECG engines are reused");
  const css = readFileSync(join(ROOT, "kardia-cases.css"), "utf8");
  assert.ok(css.split("\n").filter((l) => l.trim() && !l.trim().startsWith("/*") && !l.trim().startsWith("*")).every((l) => !l.includes("{") || l.includes(".krd-root") || l.startsWith("@media") || l.startsWith("}")), "every cases rule is scoped under .krd-root");
  assert.ok(/prefers-reduced-motion/.test(css) && /min-height: 52px/.test(css), "reduced motion and large touch targets");
});
