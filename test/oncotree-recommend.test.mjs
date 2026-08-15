/* ONCOTREE recommend: phenotype -> APPLICABLE existing Standard Protocols, lifecycle-badged, never
 * auto-selected. Exercised against the REAL promoted breast protocols in kb/protocols/. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const R = require(join(ROOT, "oncotree-recommend.js"));

const PROTO_DIR = join(ROOT, "kb/protocols");
const BREAST = readdirSync(PROTO_DIR).filter(f => f.startsWith("breast-") && f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(join(PROTO_DIR, f), "utf8")));

function ids(res) { return res.applicable.map(a => a.id); }

test("HER2-positive early breast surfaces HER2-directed regimens, excludes endocrine + TNBC", () => {
  const ph = { diseaseId: "breast_cancer", stage: "II", setting: "neoadjuvant", intent: "curative",
    biomarkers: { HER2: "positive", HR: "negative" } };
  const res = R.recommend(ph, BREAST);
  assert.ok(res.reviewRequired);
  const got = ids(res);
  assert.ok(got.indexOf("breast-tchp") >= 0, "expected TCHP");
  assert.ok(got.indexOf("breast-tch") >= 0, "expected TCH");
  assert.ok(got.indexOf("breast-tamoxifen") < 0, "endocrine (HR-) must be excluded");
  assert.ok(got.indexOf("breast-pembro-chemo-tnbc") < 0, "TNBC pembro excluded (HER2+)");
});

test("HER2-positive metastatic surfaces the ADC regimens (TDM1/TDXd), excludes stage-I-only de-escalation", () => {
  const ph = { diseaseId: "breast_cancer", stage: "IV", setting: "metastatic", intent: "palliative",
    biomarkers: { HER2: "positive" } };
  const got = ids(R.recommend(ph, BREAST));
  assert.ok(got.indexOf("breast-tdm1") >= 0);
  assert.ok(got.indexOf("breast-tdxd") >= 0);
  assert.ok(got.indexOf("breast-paclitaxel-trastuzumab") < 0, "stage-I adjuvant-only excluded at stage IV");
});

test("HR-positive HER2-negative metastatic surfaces endocrine + CDK4/6, excludes HER2-directed", () => {
  const ph = { diseaseId: "breast_cancer", stage: "IV", setting: "metastatic", intent: "palliative",
    biomarkers: { HER2: "negative", HR: "positive" } };
  const got = ids(R.recommend(ph, BREAST));
  assert.ok(got.indexOf("breast-cdk46-ai") >= 0);
  assert.ok(got.indexOf("breast-fulvestrant") >= 0);
  assert.ok(got.indexOf("breast-tchp") < 0, "HER2-directed excluded (HER2-)");
  assert.ok(got.indexOf("breast-tdm1") < 0);
});

test("triple-negative neoadjuvant surfaces pembro-chemo + cytotoxic backbones, excludes endocrine + HER2", () => {
  const ph = { diseaseId: "breast_cancer", stage: "II", setting: "neoadjuvant", intent: "curative",
    biomarkers: { HER2: "negative", HR: "negative" } };
  const got = ids(R.recommend(ph, BREAST));
  assert.ok(got.indexOf("breast-pembro-chemo-tnbc") >= 0);
  assert.ok(got.indexOf("breast-ac") >= 0, "cytotoxic backbone applies (not biomarker-restricted)");
  assert.ok(got.indexOf("breast-anastrozole") < 0, "endocrine excluded (HR-)");
  assert.ok(got.indexOf("breast-tchp") < 0, "HER2-directed excluded (HER2-)");
});

test("every result is lifecycle-badged and NONE is approved (library is draft/experimental)", () => {
  const ph = { diseaseId: "breast_cancer", stage: "II", setting: "adjuvant", intent: "curative",
    biomarkers: { HER2: "positive" } };
  const res = R.recommend(ph, BREAST);
  assert.ok(res.applicable.length > 0);
  for (const a of res.applicable) {
    assert.ok(a.badge, "must carry a lifecycle badge");
    assert.equal(a.approved, false, a.id + " must not be marked approved");
    assert.equal(a.experimental, true);
    assert.ok(/not an approved clinical recommendation/.test(a.rationale), "rationale must flag draft status");
  }
});

test("never auto-selects: returns the FULL applicable list with reviewRequired, even for one match", () => {
  const ph = { diseaseId: "breast_cancer", stage: "IV", setting: "metastatic", intent: "palliative",
    biomarkers: { HER2: "positive" } };
  const res = R.recommend(ph, BREAST);
  assert.equal(res.reviewRequired, true);
  assert.ok(!("selected" in res));
});

test("wrong disease phenotype yields no breast matches (disease is a hard exclude)", () => {
  const res = R.recommend({ diseaseId: "nsclc", stage: "IV", biomarkers: {} }, BREAST);
  assert.equal(res.applicable.length, 0);
});

test("missing biomarker is unconfirmed, not a silent exclude (protocol stays, flagged)", () => {
  const ph = { diseaseId: "breast_cancer", stage: "II", setting: "adjuvant", intent: "curative", biomarkers: {} };
  const res = R.recommend(ph, BREAST);
  // HER2-directed regimens require HER2+; with HER2 unsupplied they are NOT excluded but flagged unconfirmed
  const tchp = res.applicable.find(a => a.id === "breast-tchp");
  assert.ok(tchp, "TCHP stays in the list when HER2 is unknown");
  assert.ok(tchp.unconfirmed.indexOf("biomarkers.HER2") >= 0);
});

test("stageToken avoids false exclusion by granular labels (I vs 'I (high-risk)')", () => {
  assert.equal(R._stageToken("I (high-risk)"), "i");
  assert.equal(R._stageToken("Stage IV (metastatic)"), "iv");
  assert.equal(R._stageToken("DCIS (0)"), "0");
});

test("protoHR derives HR from ER/PR when no explicit HR key", () => {
  assert.equal(R._protoHR({ ER: "negative", PR: "negative", HER2: "negative" }), "negative");
  assert.equal(R._protoHR({ ER: "positive", PR: "tested" }), "positive");
  assert.equal(R._protoHR({ HER2: "positive" }), null);   // no HR info => no constraint
});
