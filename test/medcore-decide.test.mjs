/* test/medcore-decide.test.mjs — the typed decision, and the refusal that is its honest output today.
 *
 * Every artifact that exists in this repository was trained on synthetic data, so the correct
 * end-to-end behaviour of the whole chain is to assemble completely and then decline to produce a
 * probability. That is the first test here, deliberately, rather than a happy path that does not
 * yet exist: proving the refusal fires through the real decision path is worth more than proving
 * the arithmetic works.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState } from "../medcore/medcore-state.js";
import { decide, SCHEMA, TYPE } from "../medcore/medcore-decide.js";
import { STATUS, ABSTAIN_REASON, confidenceFor, oodVerdict, verdict } from "../medcore/medcore-calibration.js";
import { PURPOSE } from "../medcore/medcore-models.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const j = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const DEPS = { unitTable: j("medcore/data/units.json"), freshness: j("medcore/data/freshness.json") };
const OUTCOMES = j("medcore/data/outcomes.json");
const SYNTHETIC_ARTIFACT = j("test/fixtures/medcore-artifact-mc3.json");
const clone = (o) => JSON.parse(JSON.stringify(o));

/** The same artifact with a real provenance, so the happy path can be exercised at all. */
function realArtifact() {
  const a = clone(SYNTHETIC_ARTIFACT);
  a.provenance.synthetic = false;
  a.provenance.dataset = "a-real-dataset";
  for (const k of Object.keys(a.gates)) a.gates[k].pass = true;
  a.allGatesPass = true;
  return a;
}

const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;

function stateFor(over) {
  const o = over || {};
  const obs = o.observations || [
    { param: "map", value: 62, at: min(10), unit: "mmHg", source: "extract" },
    { param: "hr", value: 118, at: min(10), unit: "bpm", source: "extract" },
    { param: "sbp", value: 92, at: min(10), unit: "mmHg", source: "extract" },
    { param: "rr", value: 26, at: min(10), unit: "/min", source: "extract" },
    { param: "spo2", value: 93, at: min(10), unit: "%", source: "extract" },
    { param: "temp", value: 38.4, at: min(10), unit: "degC", source: "extract" },
    { param: "gcs", value: 14, at: min(10), unit: "points", source: "extract" },
    { param: "lactate", value: 3.8, at: min(40), unit: "mmol/L", source: "extract" },
    { param: "creat", value: 1.4, at: min(120), unit: "mg/dL", source: "extract" }
  ];
  const base = buildState(DEPS, {
    asOf: NOW, subjectKey: "opaque-1",
    patient: { ageYears: 68, sex: "M", weightKg: 74 },
    observations: obs,
    interventions: Object.assign({
      vasopressor: { active: false }, ventilation: { active: false },
      oxygen: { active: true }, rrt: { active: false }
    }, o.interventions || {})
  });
  return Object.assign({}, base, {
    context: Object.assign({ dnr: false, inIcu: false, electivePostOp: false, admissionPlanned: false, creatinineBaseline: 0.9 }, o.context)
  });
}

const of = (out, id) => out.decisions.find((d) => d.id === id);

test("decide: THE HONEST OUTPUT TODAY - the chain assembles and refuses the synthetic artifact", () => {
  const out = decide(stateFor(), {
    outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": SYNTHETIC_ARTIFACT }, purpose: PURPOSE.SHADOW
  });
  const d = of(out, "MC-3");
  assert.equal(d.status, STATUS.ABSTAIN);
  assert.deepEqual(d.reason, [ABSTAIN_REASON.MODEL_UNAVAILABLE]);
  assert.equal(d.artifactRefusal.refusal, "SYNTHETIC_TRAINING_DATA");
  assert.equal(d.probability, undefined, "no probability may appear in a refused decision");
  assert.equal(d.model, null);
  assert.deepEqual(out.provenance.artifacts, [], "an unadmitted artifact is never recorded as used");
});

test("decide: an admitted artifact produces a typed decision with a probability and a band", () => {
  const out = decide(stateFor(), { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": realArtifact() } });
  const d = of(out, "MC-3");
  assert.equal(out.schema, SCHEMA);
  assert.equal(d.type, TYPE.BOOLEAN);
  assert.equal(d.status, STATUS.OK);
  assert.ok(d.probability >= 0 && d.probability <= 1);
  assert.ok(d.confidence && d.confidence.lo <= d.confidence.hi);
  assert.equal(d.confidence.basis, "validation-decile");
  assert.equal(d.horizonHours, 12);
  assert.ok(/@/.test(d.model));
  assert.deepEqual(out.provenance.artifacts, [d.model]);
});

test("decide: no artifact at all is MODEL_UNAVAILABLE, never a low probability", () => {
  const out = decide(stateFor(), { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: {} });
  const d = of(out, "MC-3");
  assert.equal(d.status, STATUS.ABSTAIN);
  assert.deepEqual(d.reason, [ABSTAIN_REASON.MODEL_UNAVAILABLE]);
  assert.equal(d.probability, undefined);
});

test("decide: missing inputs are INSUFFICIENT_INFORMATION, with what to go and get", () => {
  const thin = stateFor({ observations: [{ param: "hr", value: 118, at: min(10), unit: "bpm", source: "extract" }] });
  const out = decide(thin, { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": realArtifact() } });
  const d = of(out, "MC-3");
  assert.equal(d.status, STATUS.INSUFFICIENT_INFORMATION);
  assert.deepEqual(d.missing.map((m) => m.param), ["map or sbp"]);
  assert.equal(d.missing[0].reason, "NEVER_RECORDED");
  assert.equal(d.probability, undefined, "a patient we cannot assess gets no number at all");
});

test("decide: a prevalent case abstains rather than scoring - the model is not asked", () => {
  const onPressor = stateFor({ interventions: { vasopressor: { active: true, agents: ["noradrenaline"] } } });
  const d = of(decide(onPressor, { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": realArtifact() } }), "MC-3");
  assert.equal(d.status, STATUS.ABSTAIN);
  assert.deepEqual(d.reason, [ABSTAIN_REASON.EXCLUDED_FROM_RISK_SET]);
  assert.ok(d.detail.excludedBy.includes("vasopressorActiveAtT0"));
});

test("decide: an unknown intervention status abstains, it does not assume no", () => {
  const unknown = stateFor({ interventions: { vasopressor: { active: null } } });
  const d = of(decide(unknown, { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": realArtifact() } }), "MC-3");
  assert.equal(d.status, STATUS.ABSTAIN);
  assert.deepEqual(d.reason, [ABSTAIN_REASON.UNKNOWN_STATUS]);
});

test("decide: a patient unlike the training distribution abstains", () => {
  const a = realArtifact();
  a.ood.threshold = 0.0001;                       // force every patient out of distribution
  const d = of(decide(stateFor(), { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": a } }), "MC-3");
  assert.equal(d.status, STATUS.ABSTAIN);
  assert.deepEqual(d.reason, [ABSTAIN_REASON.OUT_OF_DISTRIBUTION]);
  assert.ok(d.distance > d.threshold);
});

test("decide: a probability in a decile validation never measured abstains, it is not confident", () => {
  const a = realArtifact();
  a.confidenceBands = a.confidenceBands.map((b) => ({ lo: b.lo, hi: b.hi, n: 0, observed: null, ci: null }));
  const d = of(decide(stateFor(), { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: { "MC-3": a } }), "MC-3");
  assert.equal(d.status, STATUS.ABSTAIN);
  assert.deepEqual(d.reason, [ABSTAIN_REASON.NO_CONFIDENCE_BAND]);
});

test("decide: what was not decided is named, never implied", () => {
  const out = decide(stateFor(), { outcomes: OUTCOMES, enabled: ["MC-3", "MC-99"], artifacts: {} });
  assert.deepEqual(out.skipped, [{ id: "MC-99", reason: "UNKNOWN_OUTCOME" }]);
  assert.equal(out.decisions.length, 1);
  // Every enabled, known outcome appears with a status. There is no silence that means low risk.
  const all = decide(stateFor(), { outcomes: OUTCOMES, artifacts: {} });
  assert.equal(all.decisions.length, Object.keys(OUTCOMES.outcomes).length);
  assert.ok(all.decisions.every((d) => d.status));
});

test("decide: asOf is the state's, and the module reads no clock", () => {
  const out = decide(stateFor(), { outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: {} });
  assert.equal(out.asOf, new Date(NOW).toISOString());
  const src = readFileSync(join(ROOT, "medcore/medcore-decide.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/Date\.now\s*\(|new Date\s*\(/.test(src), "no clock");
  assert.ok(!/fetch\s*\(|localStorage|document\./.test(src), "no I/O, no DOM");
});

test("decide: it produces nothing but a decision - no alert, prompt or write", () => {
  const src = readFileSync(join(ROOT, "medcore/medcore-decide.js"), "utf8");
  assert.ok(!/notify|escalat|alert\(|dispatchEvent|\.put\(|\.save\(|prompt\(/i.test(src),
    "the decision layer must not raise, write or notify anything");
});

test("decide: it can carry the deterministic blocks alongside, when asked", () => {
  const out = decide(stateFor(), {
    outcomes: OUTCOMES, enabled: ["MC-3"], artifacts: {},
    bands: j("medcore/data/change-bands.json"), needs: ["rr", "spo2", "uop"]
  });
  assert.ok(Array.isArray(out.changed));
  assert.ok(Array.isArray(out.missingInformation));
  assert.ok(out.missingInformation.some((m) => m.param === "uop"), "uop was never charted here");
});

test("calibration: the confidence band is a fact about validation, not about the patient", () => {
  const a = realArtifact();
  const band = a.confidenceBands.find((b) => b.n > 0);
  const p = (band.lo + band.hi) / 2;
  const c = confidenceFor(a, p);
  assert.equal(c.n, band.n);
  assert.equal(c.observed, band.observed);
  assert.equal(c.basis, "validation-decile");
  assert.equal(confidenceFor({ confidenceBands: [] }, 0.5), null);
});

test("calibration: an unmeasured OOD distance is not a pass", () => {
  assert.equal(oodVerdict({ ood: { threshold: 3 } }, null).unmeasured, true);
  assert.equal(oodVerdict({ ood: { threshold: 3 } }, 4).ood, true);
  assert.equal(oodVerdict({ ood: { threshold: 3 } }, 2).ood, false);
  assert.equal(oodVerdict({}, 4).threshold, null);
});

test("calibration: the verdict function is the whole policy, in order", () => {
  const ok = { askable: true };
  assert.equal(verdict({ ask: { askable: false, reason: "INSUFFICIENT_INFORMATION", detail: { missing: ["map"] } } }).status,
    STATUS.INSUFFICIENT_INFORMATION);
  assert.equal(verdict({ ask: ok, artifact: null, probability: null }).status, STATUS.ABSTAIN);
  assert.equal(verdict({ ask: ok, artifact: { ood: { threshold: 1 } }, probability: 0.3, distance: 9 }).reason[0],
    ABSTAIN_REASON.OUT_OF_DISTRIBUTION);
});
