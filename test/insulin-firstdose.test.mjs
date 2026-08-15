/* test/insulin-firstdose.test.mjs — First-dose / no-prior-data correction pathway.
 * Verifies ISF resolution (known / TDD / weight-estimate), safe IOB, provenance, safety routing, and
 * that the arithmetic still flows through correctionDose. node --test test/insulin-firstdose.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../insulin-engine.js");

test("Known TDD -> ISF via 1800 rule (spec example: 300/120, TDD 30 -> 3u)", () => {
  const r = E.firstDoseCorrection({ glucose: 300, target: 120, tdd: 30, insulinNaive: true, increment: 1 });
  assert.equal(r.isf, 60);            // 1800/30
  assert.equal(r.rounded, 3);         // (300-120)/60 = 3
  assert.match(r.isfSource, /estimated from TDD 30/);
  assert.match(r.iobSource, /0 u - no previous/);
});

test("First-dose weight estimate (spec example: 70kg x0.3 -> TDD21 -> ISF~85.7 -> 300/100 -> 2u)", () => {
  const r = E.firstDoseCorrection({ glucose: 300, target: 100, weightKg: 70, insulinNaive: true, increment: 1 });
  assert.equal(r.tddEstimated, 21);   // 70 * 0.3
  assert.equal(r.isf, 85.7);          // 1800/21
  assert.equal(r.rounded, 2);         // 200/85.7 = 2.33 -> 2
  assert.match(r.tddSource, /assumption, NOT a measured value/);
  assert.ok(r.clinicalNotes.some((n) => /does NOT set the patient's full basal-bolus/.test(n)));
});

test("does NOT hardcode 0.3 for everyone — tddFactor is respected + shown", () => {
  const r = E.firstDoseCorrection({ glucose: 300, target: 120, weightKg: 80, tddFactor: 0.4, insulinNaive: true, increment: 1 });
  assert.equal(r.tddEstimated, 32);   // 80 * 0.4, not 0.3
  assert.match(r.tddSource, /80 kg x 0.4/);
});

test("known ISF overrides the estimate (and says so)", () => {
  const r = E.firstDoseCorrection({ glucose: 250, target: 120, isf: 50, tdd: 30, increment: 1 });
  assert.equal(r.isf, 50);            // entered ISF wins over 1800/30=60
  assert.match(r.isfSource, /overrides the estimate/);
  assert.equal(r.rounded, 3);         // (250-120)/50 = 2.6 -> 3
});

test("IOB from a prior rapid-acting dose is estimated (not fabricated, not zeroed)", () => {
  const r = E.firstDoseCorrection({ glucose: 300, target: 120, tdd: 30, dia: 4, priorDose: { units: 6, minutesAgo: 60 }, increment: 1 });
  // ISF 60 -> gross (300-120)/60 = 3; IOB 6*(1-1/4)=4.5 -> 3-4.5 floored to 0
  assert.match(r.iobSource, /4.5 u active from a prior 6 u/);
  assert.equal(r.rounded, 0);
});

test("IOB is NOT fabricated when history is unknown (assumed 0 with a warning)", () => {
  const r = E.firstDoseCorrection({ glucose: 300, target: 120, tdd: 30, increment: 1 });  // not naive, no priorDose
  assert.match(r.iobSource, /0 u assumed .* if one was given/);
});

test("safety routing: DKA/HHS and pediatric do not produce a routine correction", () => {
  const dka = E.firstDoseCorrection({ glucose: 500, target: 120, weightKg: 70, ctx: { dka: true } });
  assert.equal(dka.result, null); assert.equal(dka.route, "dka"); assert.match(dka.routing, /DKA\/HHS/);
  const ped = E.firstDoseCorrection({ glucose: 300, target: 120, weightKg: 20, pediatric: true });
  assert.equal(ped.result, null); assert.equal(ped.route, "pediatric"); assert.match(ped.routing, /aediatric/);
});

test("glucose at/below target -> no negative insulin", () => {
  assert.equal(E.firstDoseCorrection({ glucose: 90, target: 120, tdd: 30, insulinNaive: true }).rounded, 0);
});

test("insufficient inputs (no ISF, no TDD, no weight) -> no result, clear message", () => {
  const r = E.firstDoseCorrection({ glucose: 300, target: 120 });
  assert.equal(r.result, null);
  assert.match(r.assumptions[0], /known ISF, a known TDD, or a weight/);
});

test("renal context still reduces the first-dose correction (reuses correctionDose factor)", () => {
  const plain = E.firstDoseCorrection({ glucose: 300, target: 120, tdd: 30, insulinNaive: true, increment: 1 });
  const renal = E.firstDoseCorrection({ glucose: 300, target: 120, tdd: 30, insulinNaive: true, increment: 1, ctx: { renal: true, egfr: 30 } });
  assert.ok(renal.contextFactor === 0.75 && renal.result < plain.result, "renal 0.75 factor should lower the dose");
});
