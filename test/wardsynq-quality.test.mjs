/* test/wardsynq-quality.test.mjs — the denominator, not the numerator.
 *
 * Almost every test here is an attempt to make a unit look good without treating anybody better,
 * which is what quality measures are actually subjected to in the field. The numerator is barely
 * tested because the numerator is barely the point.
 *
 * node --test test/wardsynq-quality.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_DENOMINATOR, EXCLUSION, MEASURES, QualityError,
  defineMeasure, computeMeasure, withEvidence, compare, trend,
} from "../wardsynq/wardsynq-quality.js";

/** n discharged inpatient episodes, `deaths` of which died. */
const cohort = (n, deaths = 0, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    id: `case-${i}`, encounterClass: "IPD", dischargedAt: "2026-09-01T00:00:00.000Z",
    died: i < deaths, ...over(i),
  }));

const period = { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" };

/* ------------------------------------------------------------------ the basics, briefly */

test("a measure computes over its eligible population", () => {
  const r = computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, 4), { period });
  assert.equal(r.denominator, 100);
  assert.equal(r.numerator, 4);
  assert.equal(r.ratePercent, 4);
  assert.equal(r.excluded, 0);
});

test("patients outside the population are counted separately from exclusions", () => {
  const cases = [...cohort(50, 2), ...Array.from({ length: 30 }, (_, i) => ({ id: `opd-${i}`, encounterClass: "OPD" }))];
  const r = computeMeasure(MEASURES.INPATIENT_MORTALITY, cases);
  assert.equal(r.denominator, 50);
  assert.equal(r.notInPopulation, 30);
  assert.equal(r.excluded, 0,
    "never being in the population and being taken out of it are different facts");
});

/* ------------------------------------------------------------------ ADVERSARIAL: the denominator */

test("ADVERSARIAL: an exclusion always carries a reason and is counted by reason", () => {
  const cases = cohort(100, 10, (i) => (i < 30 ? { palliativeOnAdmission: true } : {}));
  const r = computeMeasure(MEASURES.INPATIENT_MORTALITY, cases);
  assert.equal(r.excluded, 30);
  assert.equal(r.exclusionsByReason["admitted for palliative care"], 30);
  assert.equal(r.exclusionDetail.length, 30);
  assert.equal(r.exclusionDetail[0].kind, EXCLUSION.CLINICAL);
});

test("ADVERSARIAL: improving the rate by emptying the denominator is VISIBLE", () => {
  // The same hospital, the same 10 deaths, the same 100 patients. The only thing that changed is how
  // many were called palliative on admission.
  const honest = computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, 10));
  const gamed = computeMeasure(MEASURES.INPATIENT_MORTALITY,
    cohort(100, 10, (i) => (i < 8 ? { palliativeOnAdmission: true } : {})));

  assert.equal(honest.ratePercent, 10);
  assert.equal(gamed.ratePercent, 2.2, "8 of the 10 deaths excluded: the rate collapses");

  // And the thing that makes it a measurement rather than a claim:
  assert.equal(honest.exclusionRate, 0);
  assert.equal(Math.round(gamed.exclusionRate * 100), 8);
  assert.match(gamed.reading, /with 8 excluded from a possible 100/,
    "the exclusions travel with the rate, in the same sentence");
});

test("ADVERSARIAL: 'we cannot tell' is not 'not eligible'", () => {
  const cases = cohort(100, 5, (i) => (i >= 90 ? { died: null } : {}));
  const r = computeMeasure(MEASURES.INPATIENT_MORTALITY, cases);
  assert.equal(r.exclusionsByReason["outcome not recorded"], 10);
  assert.equal(r.exclusionDetail.find((e) => e.reason === "outcome not recorded").kind, EXCLUSION.DATA_MISSING,
    "missing data excluded as though it were a clinical decision is how an unmeasured cohort disappears");
});

/* ------------------------------------------------------------------ ADVERSARIAL: small numbers */

test("ADVERSARIAL: a small denominator is reported as counts, never as a percentage", () => {
  const r = computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(3, 1));
  assert.equal(r.suppressed, true);
  assert.equal(r.rate, null);
  assert.equal(r.ratePercent, null, "one death in three is not 33 percent mortality, it is three patients");
  assert.equal(r.numerator, 1, "the counts are still reported: this is suppression of a rate, not of a fact");
  assert.equal(r.denominator, 3);
  assert.match(r.reading, /^1 of 3\. Reported as counts/);
  assert.match(r.suppressionReason, /compared with percentages from far larger populations/);
});

test("the threshold is the measure's own, and the default is stated once", () => {
  assert.equal(MIN_DENOMINATOR, 20);
  assert.equal(computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(19, 1)).suppressed, true);
  assert.equal(computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(20, 1)).suppressed, false);
});

test("an empty population is not an error and is not a zero percent", () => {
  const r = computeMeasure(MEASURES.INPATIENT_MORTALITY, []);
  assert.equal(r.denominator, 0);
  assert.equal(r.rate, null);
  assert.equal(r.reading, "No eligible cases.");
});

/* ------------------------------------------------------------------ ADVERSARIAL: comparison */

test("ADVERSARIAL: compare() REFUSES to rank unadjusted rates", () => {
  const a = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(200, 4)), unit: "ward-A" };
  const b = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(200, 18)), unit: "ward-B" };

  const c = compare([a, b]);
  assert.equal(c.comparable, false);
  assert.equal(c.ranked, null, "a league table of raw mortality is a picture of case mix");
  assert.match(c.reason, /dominated by case mix/);
  assert.equal(c.rows.length, 2, "the rows are still shown; what is refused is the ordering");
});

test("ADVERSARIAL: even an asserted risk adjustment does not produce a ranking", () => {
  const a = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(200, 4)), unit: "ward-A" };
  const b = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(200, 18)), unit: "ward-B" };
  const c = compare([a, b], { riskAdjusted: true });
  assert.equal(c.ranked, null);
  assert.match(c.reason, /cannot verify the claim/);
});

test("ADVERSARIAL: results from different definitions are not comparable at all", () => {
  const v1 = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, 5)), unit: "A" };
  const v2 = { ...v1, unit: "B", version: "0.2.0-unapproved" };
  const c = compare([v1, v2]);
  assert.equal(c.comparable, false);
  assert.match(c.reason, /not the same measurement/);
});

/* ------------------------------------------------------------------ ADVERSARIAL: trends */

test("ADVERSARIAL: no line is drawn across a definition change", () => {
  const jan = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, 10)), period: { from: "2026-01-01" } };
  const feb = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, 4)), period: { from: "2026-02-01" }, version: "0.2.0-unapproved" };
  const t = trend([jan, feb]);
  assert.equal(t.continuous, false);
  assert.equal(t.direction, null,
    "a fall from 10 to 4 percent across a definition change is a picture of the definition changing");
  assert.match(t.reason, /Plot the segments separately/);
});

test("a same-definition series reports direction, and refuses to call it significant", () => {
  const mk = (deaths, from) => ({ ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, deaths)), period: { from }, higherIsBetter: false });
  const t = trend([mk(10, "2026-01-01"), mk(6, "2026-02-01")]);
  assert.equal(t.continuous, true);
  assert.equal(t.direction, "down");
  assert.equal(t.improving, true, "lower mortality is better, and the measure says which way is better");
  assert.match(t.reason, /is not a trend and is not tested for significance/);
});

test("a series with suppressed periods does not invent a direction", () => {
  const small = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(5, 1)), period: { from: "2026-01-01" } };
  const one = { ...computeMeasure(MEASURES.INPATIENT_MORTALITY, cohort(100, 5)), period: { from: "2026-02-01" } };
  assert.equal(trend([small, one]).direction, null);
});

/* ------------------------------------------------------------------ ADVERSARIAL: evidence quality */

test("ADVERSARIAL: a compliance measure over attested bundles says what it really measures", () => {
  const bundles = Array.from({ length: 40 }, (_, i) => ({
    id: `b-${i}`, sepsisBundle: { compliant: i < 38, state: "complete" },
  }));
  const base = computeMeasure(MEASURES.SEPSIS_BUNDLE, bundles, { period });
  assert.equal(base.ratePercent, 95);

  const r = withEvidence(base, { derivedPercent: 12, derivedElements: 14, attestedElements: 106 });
  assert.equal(r.ratePercent, 95, "the rate is NOT adjusted downward: two different things are not averaged");
  assert.match(r.evidence.caution, /substantially a measure of documentation/);
});

test("well-evidenced compliance carries no caution", () => {
  const bundles = Array.from({ length: 40 }, (_, i) => ({ id: `b-${i}`, sepsisBundle: { compliant: i < 30, state: "complete" } }));
  const r = withEvidence(computeMeasure(MEASURES.SEPSIS_BUNDLE, bundles), { derivedPercent: 88, derivedElements: 100, attestedElements: 14 });
  assert.equal(r.evidence.caution, null);
});

test("withEvidence tolerates having no provenance to fold in", () => {
  const r = withEvidence(computeMeasure(MEASURES.SEPSIS_BUNDLE, []), null);
  assert.equal(r.evidence, null);
});

test("a voided bundle is excluded and counted, not silently dropped", () => {
  const bundles = [
    ...Array.from({ length: 25 }, (_, i) => ({ id: `b-${i}`, sepsisBundle: { compliant: true, state: "complete" } })),
    { id: "b-void", sepsisBundle: { compliant: false, state: "voided" } },
  ];
  const r = computeMeasure(MEASURES.SEPSIS_BUNDLE, bundles);
  assert.equal(r.denominator, 25);
  assert.equal(r.exclusionsByReason["bundle voided"], 1);
});

/* ------------------------------------------------------------------ definitions */

test("a measure without a version is refused", () => {
  assert.throws(() => defineMeasure({ id: "x", population: () => true, met: () => true }),
    (e) => e instanceof QualityError && e.code === "NO_VERSION");
  assert.throws(() => defineMeasure({ id: "x", version: "1" }), (e) => e.code === "INCOMPLETE_DEFINITION");
});

test("every result carries the definition it was computed with", () => {
  const r = computeMeasure(MEASURES.READMISSION_30D, cohort(30, 0, () => ({ readmittedWithin30Days: false })));
  assert.equal(r.measureId, "readmission-30-day");
  assert.match(r.version, /unapproved/, "the seed definitions say so in their own version string");
});

test("readmission excludes the died and the not-yet-followed-up, for different reasons", () => {
  const cases = cohort(100, 5, (i) => ({ readmittedWithin30Days: i >= 95 ? undefined : i < 20 }));
  const r = computeMeasure(MEASURES.READMISSION_30D, cases);
  assert.equal(r.exclusionsByReason["died during the index admission"], 5);
  assert.equal(r.exclusionsByReason["follow-up window not complete"], 5);
  assert.equal(r.denominator, 90);
});

test("a planned readmission is in the denominator but not the numerator", () => {
  const cases = cohort(40, 0, (i) => ({ readmittedWithin30Days: i < 10, readmissionPlanned: i < 6 }));
  const r = computeMeasure(MEASURES.READMISSION_30D, cases);
  assert.equal(r.denominator, 40);
  assert.equal(r.numerator, 4, "a planned readmission is not an unplanned one, and is not an exclusion either");
});
