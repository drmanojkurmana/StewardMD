/* test/wardsynq-pews.test.mjs — a child's normal is a curve, not a number.
 *
 * The test that carries the argument is the first one: the same heart rate is unremarkable in an
 * infant and a peri-arrest finding in an adolescent. That is why applying an adult chart to a child
 * is not slightly wrong but categorically wrong, and why the refusal in NEWS2 needed something
 * behind it.
 *
 * node --test test/wardsynq-pews.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { EFFORT, RISK, pews, pewsFromObservations, scoreAgainst } from "../wardsynq/wardsynq-pews.js";
import { BAND } from "../wardsynq/wardsynq-paediatrics.js";
import { news2 } from "../wardsynq/wardsynq-deterioration.js";
import { Observation } from "../wardsynq/wardsynq-model.js";

const NOW = "2026-09-04T12:00:00.000Z";
const ageDays = (d) => ({ ageDays: d });
const ageYears = (y) => ({ ageYears: y });

/** A well child of the given band. */
const WELL = {
  [BAND.INFANT]: { respiratoryRate: 40, respiratoryEffort: EFFORT.NORMAL, oxygenSaturation: 98, pulse: 130, capillaryRefillSeconds: 2, consciousness: "A" },
  [BAND.TODDLER]: { respiratoryRate: 28, respiratoryEffort: EFFORT.NORMAL, oxygenSaturation: 98, pulse: 120, capillaryRefillSeconds: 2, consciousness: "A" },
  [BAND.CHILD]: { respiratoryRate: 22, respiratoryEffort: EFFORT.NORMAL, oxygenSaturation: 98, pulse: 100, capillaryRefillSeconds: 2, consciousness: "A" },
  [BAND.ADOLESCENT]: { respiratoryRate: 16, respiratoryEffort: EFFORT.NORMAL, oxygenSaturation: 98, pulse: 80, capillaryRefillSeconds: 2, consciousness: "A" },
};

/* ------------------------------------------------------------------ the whole argument */

test("ADVERSARIAL: the SAME heart rate is normal in an infant and peri-arrest in an adolescent", () => {
  const infant = pews({ ...WELL[BAND.INFANT], pulse: 150 }, ageDays(120), NOW);
  const adolescent = pews({ ...WELL[BAND.ADOLESCENT], pulse: 150 }, ageYears(14), NOW);

  assert.equal(infant.parameters.pulse.points, 0, "150 is unremarkable at four months");
  assert.ok(adolescent.parameters.pulse.points >= 2, "the same number at fourteen is not");
  assert.notEqual(infant.risk, adolescent.risk,
    "one set of bands cannot serve both, which is the entire reason an adult chart must not be reused on a child");
});

test("a well child in every band scores zero and is low risk", () => {
  const cases = [[ageDays(200), BAND.INFANT], [ageYears(2), BAND.TODDLER], [ageYears(7), BAND.CHILD], [ageYears(15), BAND.ADOLESCENT]];
  for (const [patient, band] of cases) {
    const r = pews(WELL[band], patient, NOW);
    assert.equal(r.scorable, true, `${band} should be scorable`);
    assert.equal(r.band, band);
    assert.equal(r.total, 0, `${band} should total 0`);
    assert.equal(r.risk, RISK.LOW);
  }
});

/* ------------------------------------------------------------------ ADVERSARIAL: the refusals */

test("ADVERSARIAL: PEWS refuses NEONATES rather than approximating them", () => {
  const r = pews(WELL[BAND.INFANT], ageDays(5), NOW);
  assert.equal(r.scorable, false);
  assert.equal(r.code, "NEONATE");
  assert.match(r.reason, /where a wrong score does the most harm/);
});

test("ADVERSARIAL: an unestablished age band is refused, because a child's normal is a curve", () => {
  const r = pews(WELL[BAND.CHILD], {}, NOW);
  assert.equal(r.code, "NO_BAND");
  assert.match(r.reason, /a curve rather than a number/);
});

test("ADVERSARIAL: every refusal says it is not a reassurance", () => {
  for (const patient of [{}, ageDays(5), ageYears(40)]) {
    const r = pews(WELL[BAND.CHILD], patient, NOW);
    assert.equal(r.scorable, false);
    assert.match(r.note, /A refusal is not a reassurance/);
  }
});

test("an adult is sent to NEWS2, and the two charts do not both claim the same patient", () => {
  const child = ageYears(7);
  assert.equal(pews(WELL[BAND.CHILD], child, NOW).scorable, true);
  assert.equal(news2({ values: {}, patient: child, now: NOW }).code, "NOT_ADULT");

  const adult = ageYears(40);
  assert.equal(pews(WELL[BAND.CHILD], adult, NOW).code, "NOT_PAEDIATRIC");
  assert.match(pews(WELL[BAND.CHILD], adult, NOW).reason, /use NEWS2/);
});

test("ADVERSARIAL: the NEWS2 refusal now points at something that EXISTS", () => {
  // This is the debt being paid. Before this file, a child was refused and offered nothing.
  const child = ageYears(6);
  const refused = news2({ values: {}, patient: child, now: NOW });
  assert.match(refused.reason, /PEWS/);
  const scored = pews(WELL[BAND.CHILD], child, NOW);
  assert.equal(scored.scorable, true, "the chart NEWS2 names is now a real one");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the falling rate */

test("ADVERSARIAL: a FALLING respiratory rate in a tiring child scores harder than a rising one", () => {
  const high = pews({ ...WELL[BAND.CHILD], respiratoryRate: 40 }, ageYears(7), NOW);
  const low = pews({ ...WELL[BAND.CHILD], respiratoryRate: 8 }, ageYears(7), NOW);
  assert.ok(low.parameters.respiratoryRate.points >= high.parameters.respiratoryRate.points,
    "a tiring child's rate falls as they decompensate, so rate alone inverts at exactly the wrong moment");
  assert.equal(low.parameters.respiratoryRate.points, 3);
});

test("ADVERSARIAL: a NORMAL rate with severe effort is still scored severe", () => {
  const r = pews({ ...WELL[BAND.CHILD], respiratoryRate: 22, respiratoryEffort: EFFORT.SEVERE }, ageYears(7), NOW);
  assert.equal(r.parameters.respiratoryRate.points, 0, "the rate looks fine");
  assert.equal(r.parameters.respiratoryEffort.points, 3, "and the child is working hard to keep it that way");
  assert.equal(r.risk, RISK.MEDIUM);
});

test("a low blood pressure in a child is scored up, because it is a late sign", () => {
  const r = pews({ ...WELL[BAND.CHILD], systolicBloodPressure: 60 }, ageYears(7), NOW);
  assert.equal(r.parameters.systolicBloodPressure.points, 3);
  assert.match(r.advice, /a late reassurance, not an early one/);
});

test("blood pressure is optional, so a routine observation set is not permanently incomplete", () => {
  const r = pews(WELL[BAND.CHILD], ageYears(7), NOW);
  assert.equal(r.scorable, true);
  assert.equal(r.parameters.systolicBloodPressure, undefined,
    "demanding it on every round would make every set incomplete, which trains people to ignore incompleteness");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the parent */

test("ADVERSARIAL: a worried parent escalates a child whose numbers are all normal", () => {
  const calm = pews({ ...WELL[BAND.CHILD], parentConcerned: false }, ageYears(7), NOW);
  assert.equal(calm.risk, RISK.LOW);

  const worried = pews({ ...WELL[BAND.CHILD], parentConcerned: true }, ageYears(7), NOW);
  assert.equal(worried.risk, RISK.MEDIUM);
  assert.equal(worried.parentEscalated, true,
    "the numbers were normal in most of the cases that generated this literature");
  assert.match(worried.advice, /not a courtesy/);
  assert.match(worried.advice, /outperforms several of the numbers on this chart/);
});

test("parental concern is optional and its absence is not scored as reassurance", () => {
  const r = pews(WELL[BAND.CHILD], ageYears(7), NOW);
  assert.equal(r.parameters.parentConcerned, undefined);
  assert.equal(r.scorable, true, "not asking is not the same as asking and being told no");
});

/* ------------------------------------------------------------------ ADVERSARIAL: missing is not zero */

test("ADVERSARIAL: a missing parameter makes the score INCOMPLETE, not reassuring", () => {
  const r = pews({ ...WELL[BAND.CHILD], capillaryRefillSeconds: undefined }, ageYears(7), NOW);
  assert.equal(r.scorable, false);
  assert.equal(r.risk, null);
  assert.deepEqual(r.missing, ["capillaryRefillSeconds"]);
  assert.match(r.reason, /not a risk assessment/);
});

test("a sick child with one missing parameter is unscorable, and the partial total is still shown", () => {
  const r = pews({
    respiratoryRate: 60, respiratoryEffort: EFFORT.SEVERE, oxygenSaturation: 88,
    pulse: 170, consciousness: "P",
  }, ageYears(7), NOW);
  assert.equal(r.scorable, false);
  assert.deepEqual(r.missing, ["capillaryRefillSeconds"]);
  assert.ok(r.total >= 10, "a human can still see how sick this is");
});

test("an unparseable consciousness value is missing rather than assumed alert", () => {
  const r = pews({ ...WELL[BAND.CHILD], consciousness: "sleepy" }, ageYears(7), NOW);
  assert.deepEqual(r.missing, ["consciousness"]);
});

/* ------------------------------------------------------------------ risk */

test("two parameters at their extreme is high risk even on a modest total", () => {
  const r = pews({
    ...WELL[BAND.CHILD], respiratoryEffort: EFFORT.SEVERE, consciousness: "V",
  }, ageYears(7), NOW);
  assert.deepEqual(r.singleParameterThree.sort(), ["consciousness", "respiratoryEffort"]);
  assert.equal(r.risk, RISK.HIGH);
  assert.match(r.escalation, /Immediate paediatric review/);
});

test("one parameter at its extreme is at least medium", () => {
  const r = pews({ ...WELL[BAND.CHILD], consciousness: "V" }, ageYears(7), NOW);
  assert.equal(r.risk, RISK.MEDIUM);
});

test("scoreAgainst is a pure band comparison and returns null on nonsense", () => {
  assert.equal(scoreAgainst(50, { low: 20, high: 60 }), 0);
  assert.equal(scoreAgainst("x", { low: 1, high: 2 }), null);
  assert.equal(scoreAgainst(5, null), null);
});

/* ------------------------------------------------------------------ observations */

test("PEWS builds from observations through the same gatherer as the other two charts", () => {
  const obs = (code, value, minutesAgo = 0) => Observation({
    patientId: "pat-1", code, value, category: "vital-signs",
    effectiveAt: new Date(Date.parse(NOW) - minutesAgo * 60000).toISOString(),
  });

  const r = pewsFromObservations(
    [obs("9279-1", 22), obs("8867-4", 100), obs("2708-6", 98), obs("80339-5", "A")],
    ageYears(7),
    { now: NOW, values: { respiratoryEffort: EFFORT.NORMAL, capillaryRefillSeconds: 2 } },
  );
  assert.equal(r.scorable, true);
  assert.equal(r.total, 0);
  assert.equal(Object.keys(r.sources).length, 4);
});

test("ADVERSARIAL: a stale observation does not reach the paediatric chart either", () => {
  const obs = (code, value, minutesAgo = 0) => Observation({
    patientId: "pat-1", code, value, category: "vital-signs",
    effectiveAt: new Date(Date.parse(NOW) - minutesAgo * 60000).toISOString(),
  });

  const r = pewsFromObservations(
    [obs("9279-1", 22, 400), obs("8867-4", 100), obs("2708-6", 98), obs("80339-5", "A")],
    ageYears(7),
    { now: NOW, values: { respiratoryEffort: EFFORT.NORMAL, capillaryRefillSeconds: 2 } },
  );
  assert.equal(r.scorable, false);
  assert.ok(r.missing.includes("respiratoryRate"));
  assert.match(r.rejected[0].reason, /freshness window/);
});
