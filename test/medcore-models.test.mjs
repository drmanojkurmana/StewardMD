/* test/medcore-models.test.mjs — the gate between a trained artifact and a patient.
 *
 * The owner chose to build on a public ICU dataset AND on synthetic data generated from the
 * StewardMD Knowledge Base (2026-09-19). Synthetic training data is useful for proving the pipeline
 * and useless as clinical evidence, and the difference between those two must not depend on anybody
 * remembering it. These tests are that guarantee: an artifact trained on synthetic data cannot be
 * loaded for any clinical purpose, by any flag, option or override.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { admit, load, score, PURPOSE, REFUSED } from "../medcore/medcore-models.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test/fixtures/medcore-artifact-mc3.json");
const ART = JSON.parse(readFileSync(FIXTURE, "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A real-provenance artifact whose gates all pass: the only kind that may go to shadow. */
function clean() {
  const a = clone(ART);
  a.provenance.synthetic = false;
  a.provenance.dataset = "a-real-dataset";
  for (const k of Object.keys(a.gates)) a.gates[k].pass = true;
  a.allGatesPass = true;
  return a;
}

test("models: the fixture is what the pipeline actually produced", () => {
  assert.equal(ART.schema, "medcore-artifact/1");
  assert.equal(ART.provenance.synthetic, true);
  assert.equal(ART.approvalStatus, "unapproved");
  assert.ok(ART.parityVectors.length >= 50, "an artifact ships with parity vectors or it does not ship");
  assert.ok(ART.model.featureIds.length > 10);
});

test("models: SYNTHETIC IS REFUSED for clinical use, and for shadow, with no override", () => {
  for (const purpose of [PURPOSE.CLINICAL, PURPOSE.SHADOW]) {
    const r = admit(ART, purpose);
    assert.equal(r.ok, false, purpose + " must be refused");
    assert.equal(r.refusal, REFUSED.SYNTHETIC);
  }
  // Not even with every other property made perfect.
  const dressed = clone(ART);
  for (const k of Object.keys(dressed.gates)) dressed.gates[k].pass = true;
  dressed.allGatesPass = true;
  dressed.approvalStatus = "approved";
  assert.equal(admit(dressed, PURPOSE.CLINICAL).refusal, REFUSED.SYNTHETIC,
    "an approval field cannot launder synthetic training data");
  assert.throws(() => load(ART, PURPOSE.SHADOW), /SYNTHETIC_TRAINING_DATA/);
});

test("models: synthetic loads ONLY for the named pipeline-test purpose", () => {
  const m = load(ART, PURPOSE.PIPELINE_TEST);
  assert.equal(m.outcome, ART.outcome);
  assert.equal(typeof m.score, "function");
  const p = m.score(ART.parityVectors[0].values);
  assert.ok(p >= 0 && p <= 1);
});

test("models: no app code may ask for the pipeline-test purpose", () => {
  // The refusal is only as good as the absence of callers. This is the absence.
  const appFiles = ["medcore-boot.js", "icu.js", "medcore/medcore-decide.js"]
    .map((f) => join(ROOT, f)).filter((f) => existsSync(f));
  for (const f of appFiles) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/pipeline-test|PIPELINE_TEST/.test(src), f + " must never request the pipeline-test purpose");
  }
});

test("models: a model that failed its gates does not load, and the boolean is not trusted", () => {
  const a = clean();
  a.gates.calibrationSlope.pass = false;
  a.allGatesPass = true;                       // the lie a boolean makes easy
  const r = admit(a, PURPOSE.SHADOW);
  assert.equal(r.ok, false);
  assert.equal(r.refusal, REFUSED.GATES_FAILED);
  assert.deepEqual(r.detail.failed, ["calibrationSlope"]);
});

test("models: a parity mismatch refuses the artifact", () => {
  const a = clean();
  a.parityVectors[3].p = a.parityVectors[3].p + 0.01;
  const r = admit(a, PURPOSE.SHADOW);
  assert.equal(r.refusal, REFUSED.PARITY);
  assert.equal(r.detail.mismatches[0].i, 3);

  // And a coefficient edited after training is caught by the same check, which is the real case.
  const b = clean();
  b.model.coefficients[0] = b.model.coefficients[0] + 0.5;
  assert.equal(admit(b, PURPOSE.SHADOW).refusal, REFUSED.PARITY);
});

test("models: a feature-set mismatch is refused before parity is even considered", () => {
  const a = clean();
  const r = admit(a, PURPOSE.SHADOW, { featureSet: "medcore-features@9.9.9" });
  assert.equal(r.refusal, REFUSED.FEATURE_SET);
  assert.equal(r.detail.artifact, a.featureSet);
});

test("models: clinical use needs an approval this file cannot grant itself", () => {
  const a = clean();
  assert.equal(admit(a, PURPOSE.SHADOW).ok, true, "a clean artifact may go to shadow");
  const r = admit(a, PURPOSE.CLINICAL);
  assert.equal(r.refusal, REFUSED.UNAPPROVED);
  a.approvalStatus = "approved";
  assert.equal(admit(a, PURPOSE.CLINICAL).ok, true, "and only a signature changes that");
});

test("models: a malformed artifact is refused rather than partially trusted", () => {
  assert.equal(admit(null, PURPOSE.SHADOW).refusal, REFUSED.MALFORMED);
  assert.equal(admit({}, PURPOSE.SHADOW).refusal, REFUSED.MALFORMED);
  const a = clean(); delete a.parityVectors;
  assert.equal(admit(a, PURPOSE.SHADOW).refusal, REFUSED.MALFORMED);
});

test("models: the scorer reproduces every parity vector the trainer recorded", () => {
  for (const v of ART.parityVectors) {
    assert.ok(Math.abs(score(ART, v.values) - v.p) <= 1e-6,
      "scorer and trainer must agree: " + v.p + " vs " + score(ART, v.values));
  }
});
