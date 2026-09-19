/* test/medcore-labels.test.mjs — HAZ-ML-02. The treatment paradox, enforced.
 *
 * The failure this prevents is quiet and catastrophic: a model trained with prevalent cases as
 * negatives learns that being on a vasopressor predicts NOT needing one, and then reassures the
 * clinician about the sickest patient in the unit. These tests are the risk-set rule and the
 * blanking window, plus the rule that "nobody charted it" is a refusal rather than a no.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState } from "../medcore/medcore-state.js";
import { askable, riskSet, inBlankingWindow, dropBlanked, NOT_ASKABLE } from "../medcore/medcore-outcomes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const OUT = JSON.parse(readFileSync(join(ROOT, "medcore/data/outcomes.json"), "utf8"));
const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;

function patientState(over) {
  const base = buildState(DEPS, {
    asOf: NOW, patient: { ageYears: 65, sex: "M" },
    observations: [
      { param: "map", value: 62, at: min(10), source: "icu-state" },
      { param: "hr", value: 118, at: min(10), source: "icu-state" },
      { param: "sbp", value: 92, at: min(10), source: "icu-state" },
      { param: "rr", value: 26, at: min(10), source: "icu-state" },
      { param: "spo2", value: 93, at: min(10), source: "icu-state" },
      { param: "temp", value: 38.4, at: min(10), source: "icu-state" },
      { param: "gcs", value: 14, at: min(10), source: "icu-state" },
      { param: "creat", value: 1.4, at: min(120), source: "icu-state" }
    ],
    interventions: {
      vasopressor: { active: false }, ventilation: { active: false },
      oxygen: { active: true }, rrt: { active: false }
    }
  });
  // `context` is the encounter-level truth a real adapter supplies; the state is frozen, so the
  // test composes rather than mutates, exactly as a caller would.
  return Object.assign({}, base, { context: Object.assign({ dnr: false, creatinineBaseline: 0.9 }, (over || {}).context) },
    (over || {}).interventions ? { interventions: Object.assign({}, base.interventions, over.interventions) } : {});
}

test("labels: a patient already on a vasopressor is EXCLUDED from MC-3, never a negative", () => {
  const on = patientState({ interventions: { vasopressor: { active: true, agents: ["noradrenaline"] } } });
  const a = askable(on, OUT, "MC-3");
  assert.equal(a.askable, false);
  assert.equal(a.reason, NOT_ASKABLE.EXCLUDED);
  assert.deepEqual(a.detail.excludedBy, ["vasopressorActiveAtT0"]);

  const off = patientState();
  assert.equal(askable(off, OUT, "MC-3").askable, true, "a patient not on one is in the risk set");
});

test("labels: the same rule holds for ventilation and for renal replacement", () => {
  const vented = patientState({ interventions: { ventilation: { active: true, mode: "PCV" } } });
  assert.equal(askable(vented, OUT, "MC-4").reason, NOT_ASKABLE.EXCLUDED);
  const rrt = patientState({ interventions: { rrt: { active: true } } });
  assert.equal(askable(rrt, OUT, "MC-5").reason, NOT_ASKABLE.EXCLUDED);
});

test("labels: nobody charted it is a refusal, not a no", () => {
  const unknown = patientState({ interventions: { vasopressor: { active: null } } });
  const a = askable(unknown, OUT, "MC-3");
  assert.equal(a.askable, false);
  assert.equal(a.reason, NOT_ASKABLE.UNKNOWN_STATUS, "we must not assume they are not on one");
  assert.deepEqual(a.detail.unknown, ["vasopressorActiveAtT0", "vasopressor"],
    "both the risk-set question and the required-known question are unanswerable");
});

test("labels: an outcome that needs a resuscitation status will not be asked without one", () => {
  const noStatus = patientState({ context: { dnr: null } });
  assert.equal(askable(noStatus, OUT, "MC-2").reason, NOT_ASKABLE.UNKNOWN_STATUS);
  const dnr = patientState({ context: { dnr: true } });
  assert.equal(askable(dnr, OUT, "MC-2").reason, NOT_ASKABLE.EXCLUDED,
    "a patient with a DNR decision is censored, not a patient in whom arrest was prevented");
});

test("labels: the minimum input set is checked deterministically, before any model could run", () => {
  const thin = buildState(DEPS, {
    asOf: NOW, patient: { ageYears: 65 },
    observations: [{ param: "hr", value: 118, at: min(10), source: "icu-state" }],
    interventions: { vasopressor: { active: false }, ventilation: { active: false }, oxygen: { active: true }, rrt: { active: false } }
  });
  const withCtx = Object.assign({}, thin, { context: { dnr: false, creatinineBaseline: 0.9 } });
  const a = askable(withCtx, OUT, "MC-3");
  assert.equal(a.reason, NOT_ASKABLE.INSUFFICIENT_INPUTS);
  assert.deepEqual(a.detail.missing, ["map"]);
  // MC-1 tolerates one unusable input of its six, and no more. It also needs to know where the
  // patient already is, so the encounter context is supplied here the way an adapter would.
  const ward = Object.assign({}, thin, {
    context: { dnr: false, inIcu: false, electivePostOp: false, admissionPlanned: false }
  });
  const b = askable(ward, OUT, "MC-1");
  assert.equal(b.reason, NOT_ASKABLE.INSUFFICIENT_INPUTS);
  assert.ok(b.detail.missing.length > 1);
});

test("labels: riskSet and the bedside share one function, so they cannot drift", () => {
  const points = [
    { t0: 1, state: patientState() },
    { t0: 2, state: patientState({ interventions: { vasopressor: { active: true } } }) },
    { t0: 3, state: patientState({ interventions: { vasopressor: { active: null } } }) }
  ];
  const rs = riskSet(points, OUT, "MC-3");
  assert.deepEqual(rs.included.map((p) => p.t0), [1]);
  assert.deepEqual(rs.excluded.map((e) => e.reason),
    [NOT_ASKABLE.EXCLUDED, NOT_ASKABLE.UNKNOWN_STATUS]);
});

test("labels: the blanking window drops the hour before the event, and nothing else", () => {
  const event = NOW;
  assert.equal(inBlankingWindow(event - 30 * 60000, event, OUT, "MC-3"), true, "half an hour before is preparation");
  assert.equal(inBlankingWindow(event - 90 * 60000, event, OUT, "MC-3"), false, "ninety minutes before is physiology");
  assert.equal(inBlankingWindow(event + 60000, event, OUT, "MC-3"), false, "after the event is not blanking, it is the future");
  const kept = dropBlanked([
    { atMs: event - 120 * 60000, param: "map" },
    { atMs: event - 20 * 60000, param: "map" }
  ], event, OUT, "MC-3");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].atMs, event - 120 * 60000);
});

test("labels: the blanking window is a declared constant, identical across outcomes", () => {
  const windows = Object.values(OUT.outcomes).map((o) => o.blankingMin);
  assert.ok(windows.every((w) => w === 60), "one declared constant, not a tuned hyperparameter");
});

test("labels: every outcome is an event with a timestamp, and says so", () => {
  assert.equal(OUT.approvalStatus, "unapproved");
  assert.equal(Object.keys(OUT.outcomes).length, 5, "five, not fifty");
  for (const [id, o] of Object.entries(OUT.outcomes)) {
    assert.ok(o.horizonHours > 0, id + " needs a horizon");
    assert.ok(o.minimumInputs.length > 0, id + " needs a minimum input set");
    assert.ok(/^First |, or death|KDIGO/.test(o.labelDefinition), id + " must define a first-occurrence event: " + o.labelDefinition);
    assert.ok(Array.isArray(o.riskSetExclusions), id + " needs a risk set rule");
    assert.equal(o.approvalStatus, "unapproved", id + " must not claim approval");
    assert.ok(/Never its own alert|prompt/.test(o.workflow), id + " must say it feeds a prompt, not an alert");
  }
});

test("labels: an ICU-transfer question cannot be asked without knowing where the patient already is", () => {
  // MC-1 is about a WARD patient. Without the encounter context nobody can say the patient is not
  // already in ICU, and a model asked anyway would be scoring the population it excludes.
  const noContext = patientState();
  assert.equal(askable(noContext, OUT, "MC-1").reason, NOT_ASKABLE.UNKNOWN_STATUS);
  const ward = patientState({ context: { inIcu: false, electivePostOp: false, admissionPlanned: false } });
  assert.equal(askable(ward, OUT, "MC-1").askable, true);
  const inIcu = patientState({ context: { inIcu: true, electivePostOp: false, admissionPlanned: false } });
  assert.equal(askable(inIcu, OUT, "MC-1").reason, NOT_ASKABLE.EXCLUDED);
});

test("labels: an unknown outcome id is refused rather than defaulted", () => {
  assert.equal(askable(patientState(), OUT, "MC-99").reason, NOT_ASKABLE.UNKNOWN_OUTCOME);
});
