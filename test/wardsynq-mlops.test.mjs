/* test/wardsynq-mlops.test.mjs — the model that was right last year.
 *
 * The tests worth reading are the ones that refuse: retrospective numbers cannot deploy a model, a
 * shadow prediction cannot be visible, an aggregate cannot hide a subgroup, and a breach withdraws
 * the model rather than raising a ticket.
 *
 * node --test test/wardsynq-mlops.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGE, GATES, MlOpsError,
  registerModel, enterShadow, recordShadowPrediction, attachOutcome,
  evaluate, readyForDeployment, inputDrift, ModelMonitor, reinstate,
} from "../wardsynq/wardsynq-mlops.js";

const NOW = "2026-09-04T12:00:00.000Z";
const daysOn = (d) => new Date(Date.parse(NOW) + d * 86_400_000).toISOString();

const model = (over) => registerModel({
  id: "sepsis-risk", version: "2.1.0", task: "classification",
  intendedUse: "adult inpatients on general wards; not validated in ICU, paediatrics or obstetrics",
  retrospective: { accuracy: 0.94, auc: 0.91 },
  registeredBy: "ds-lead", now: NOW, ...over,
});

/** n shadow predictions, `wrong` of which are wrong, all in one subgroup. */
const feed = (m, n, wrong, subgroup, startDay = 0) => {
  for (let i = 0; i < n; i++) {
    recordShadowPrediction(m, {
      predicted: true, actual: i >= wrong, subgroup,
      patientId: `${subgroup}-${i}`, at: daysOn(startDay + (i % 30)),
    });
  }
  return m;
};

/* ------------------------------------------------------------------ ADVERSARIAL: retrospective */

test("ADVERSARIAL: excellent retrospective numbers deploy nothing", () => {
  const m = model();
  assert.equal(m.retrospective.accuracy, 0.94);
  assert.match(m.retrospectiveNote, /not evidence of clinical usefulness/);
  assert.match(m.retrospectiveNote, /Only prospective shadow performance can support deployment/);

  const r = readyForDeployment(m, { now: NOW });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => /not shadow/.test(b)));
});

test("a model needs a stated intended use, because otherwise off-label use is undetectable", () => {
  assert.throws(() => registerModel({ id: "m", version: "1", registeredBy: "x" }),
    (e) => e instanceof MlOpsError && e.code === "NO_INTENDED_USE");
  assert.throws(() => registerModel({ id: "m", intendedUse: "x", registeredBy: "y" }), (e) => e.code === "NO_VERSION");
});

/* ------------------------------------------------------------------ ADVERSARIAL: shadow means blind */

test("ADVERSARIAL: a shadow prediction cannot be shown to a clinician", () => {
  const m = enterShadow(model(), { by: "ds-lead", now: NOW });
  assert.throws(
    () => recordShadowPrediction(m, { predicted: true, visibleToClinician: true, patientId: "p1" }),
    (e) => e instanceof MlOpsError && e.code === "SHADOW_NOT_BLIND");
  try {
    recordShadowPrediction(m, { predicted: true, visibleToClinician: true, patientId: "p1" });
  } catch (e) {
    assert.match(e.message, /measures the behaviour it caused rather than the model/);
  }
});

test("a model that is not running records nothing", () => {
  assert.throws(() => recordShadowPrediction(model(), { predicted: true }), (e) => e.code === "NOT_RUNNING");
});

test("outcomes arrive later, which is how clinical labels actually arrive", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  recordShadowPrediction(m, { predicted: true, patientId: "p1", at: NOW });
  assert.equal(m.shadow.predictions[0].actual, null);
  attachOutcome(m, { patientId: "p1", actual: true });
  assert.equal(m.shadow.predictions[0].actual, true);
  assert.throws(() => attachOutcome(m, { patientId: "nobody", actual: true }), (e) => e.code === "NO_PREDICTION");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the aggregate hides */

test("ADVERSARIAL: a 92 percent model that fails a subgroup is not a 92 percent model", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 900, 40, "majority");     // ~96 percent
  feed(m, 100, 39, "minority");     // 61 percent

  const ev = evaluate(m);
  assert.ok(ev.overallAccuracy > 0.9, "the aggregate looks excellent");
  assert.ok(ev.subgroupGap > 0.3);
  assert.match(ev.caution, /works for the majority and fails the people already worst served/);
});

test("a subgroup too small to evaluate is reported as unknown, not as fine", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 200, 5, "majority");
  feed(m, 5, 5, "tiny");
  const ev = evaluate(m);
  const tiny = ev.subgroups.find((s) => s.subgroup === "tiny");
  assert.equal(tiny.reportable, false, "5 cases at 0 percent is noise, not a finding");
  assert.equal(ev.worstSubgroup, ev.subgroups.find((s) => s.subgroup === "majority").accuracy);
});

test("the evaluation states that it computes no confidence intervals", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 50, 5, "a");
  assert.match(evaluate(m).note, /needs a statistician rather than this function/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the gates */

test("ADVERSARIAL: a subgroup gap blocks deployment however good the aggregate is", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 900, 40, "majority");
  feed(m, 100, 39, "minority");

  const r = readyForDeployment(m, { now: daysOn(45) });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => /gap between the best and worst subgroup/.test(b)));
});

test("ADVERSARIAL: unlabelled predictions are not evidence", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 300, 10, "majority");
  for (let i = 0; i < 400; i++) recordShadowPrediction(m, { predicted: true, subgroup: "majority", patientId: `u-${i}`, at: NOW });

  const r = readyForDeployment(m, { now: daysOn(45) });
  assert.ok(r.blockers.some((b) => /percent of predictions have an outcome yet/.test(b)));
  assert.ok(r.blockers.some((b) => /disproportionately the recent, sicker cases/.test(b)));
});

test("too little time and too few predictions each block on their own", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 600, 20, "majority");
  feed(m, 100, 4, "minority");

  const tooSoon = readyForDeployment(m, { now: daysOn(3) });
  assert.ok(tooSoon.blockers.some((b) => /days in shadow/.test(b)));

  const small = enterShadow(model(), { by: "x", now: NOW });
  feed(small, 100, 3, "majority");
  assert.ok(readyForDeployment(small, { now: daysOn(45) }).blockers.some((b) => /shadow predictions, below the minimum/.test(b)));
});

test("a model with no evaluable subgroup is blocked, because unknown is not acceptable", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  for (let i = 0; i < 600; i++) {
    recordShadowPrediction(m, { predicted: true, actual: true, subgroup: `group-${i}`, patientId: `p-${i}`, at: NOW });
  }
  const r = readyForDeployment(m, { now: daysOn(45) });
  assert.ok(r.blockers.some((b) => /subgroup performance is unknown rather than acceptable/.test(b)));
});

test("a model meeting every gate is ready, and even that is not clinical approval", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  feed(m, 600, 30, "majority");
  feed(m, 200, 12, "minority");

  const r = readyForDeployment(m, { now: daysOn(45) });
  assert.equal(r.ready, true, r.blockers.join("; "));
  assert.match(r.note, /It is not clinical approval/);
  assert.match(r.note, /a judgement made by a named clinician/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: drift on inputs */

test("ADVERSARIAL: input drift is visible immediately, while outcome labels are still months away", () => {
  const reference = Array.from({ length: 200 }, () => ({ age: 60 + (Math.random() * 10 - 5) }));
  const current = Array.from({ length: 200 }, () => ({ age: 78 + (Math.random() * 10 - 5) }));
  const d = inputDrift(reference, current, { feature: "age" });
  assert.equal(d.drifted, true);
  assert.match(d.reading, /was validated on the reference population and is now seeing a different one/);
  assert.match(d.note, /has no p-value and none is implied/);
});

test("a stable feature is reported as stable", () => {
  const ref = Array.from({ length: 100 }, (_, i) => ({ age: 60 + (i % 7) }));
  const cur = Array.from({ length: 100 }, (_, i) => ({ age: 60 + (i % 7) }));
  assert.equal(inputDrift(ref, cur, { feature: "age" }).drifted, false);
});

test("too little data to compare is said, not guessed", () => {
  const d = inputDrift([{ age: 60 }], [{ age: 80 }], { feature: "age" });
  assert.equal(d.comparable, false);
  assert.match(d.reason, /too few to compare/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: automatic rollback */

test("ADVERSARIAL: a breach WITHDRAWS the model rather than raising a ticket", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  m.stage = STAGE.DEPLOYED;
  feed(m, 200, 90, "majority");   // 55 percent, well below the floor

  const notified = [];
  const monitor = new ModelMonitor({ now: () => NOW, onWithdraw: (e) => notified.push(e) });
  const r = monitor.check(m);

  assert.equal(r.withdrawn, true);
  assert.equal(m.stage, STAGE.WITHDRAWN, "withdrawn first, notified second");
  assert.equal(notified.length, 1);
  assert.match(r.note, /the meeting is next week/);
  assert.ok(m.history.some((h) => h.event === "withdrawn-automatically"));
});

test("ADVERSARIAL: a subgroup breach alone withdraws a model whose aggregate is fine", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  m.stage = STAGE.DEPLOYED;
  feed(m, 900, 20, "majority");    // ~98 percent
  feed(m, 100, 50, "minority");    // 50 percent

  const r = new ModelMonitor({ now: () => NOW }).check(m);
  assert.equal(r.withdrawn, true);
  assert.ok(r.breaches.some((b) => /subgroup "minority"/.test(b)));
  assert.equal(m.stage, STAGE.WITHDRAWN);
});

test("a healthy model is left alone", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  m.stage = STAGE.DEPLOYED;
  feed(m, 500, 20, "majority");
  const r = new ModelMonitor({ now: () => NOW }).check(m);
  assert.equal(r.withdrawn, false);
  assert.equal(m.stage, STAGE.DEPLOYED);
});

test("a model that is not running is not checked", () => {
  assert.equal(new ModelMonitor({ now: () => NOW }).check(model()).checked, false);
});

/* ------------------------------------------------------------------ ADVERSARIAL: reinstatement */

test("ADVERSARIAL: a withdrawn model goes back through SHADOW, never straight to deployment", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  m.stage = STAGE.DEPLOYED;
  feed(m, 200, 90, "majority");
  new ModelMonitor({ now: () => NOW }).check(m);

  const r = reinstate(m, { by: "ds-lead", reason: "retrained on the current population", now: daysOn(10) });
  assert.equal(m.stage, STAGE.SHADOW);
  assert.equal(m.shadow.predictions.length, 0, "the old evidence was gathered on a population that has since changed");
  assert.match(r.note, /it has to be gathered again/);
});

test("reinstating needs a person and a reason, and only applies to a withdrawn model", () => {
  const m = enterShadow(model(), { by: "x", now: NOW });
  assert.throws(() => reinstate(m, { by: "a", reason: "b" }), (e) => e.code === "NOT_WITHDRAWN");
  m.stage = STAGE.WITHDRAWN;
  assert.throws(() => reinstate(m, { by: "a" }), (e) => e.code === "NO_REASON");
});

test("the gate defaults are stated in one place and marked unapproved by being here at all", () => {
  assert.equal(GATES.minShadowDays, 30);
  assert.equal(GATES.minShadowPredictions, 500);
  assert.equal(GATES.maxSubgroupGap, 0.15);
});
