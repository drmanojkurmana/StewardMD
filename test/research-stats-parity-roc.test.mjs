/* ResearchMD R parity for the on-device ROC curve and AUC code
 * (research-stats.js: roc) against R pROC:
 *   - direction ("auto" picks "<" or ">" from the medians, like pROC)
 *   - AUC, its DeLong SE and 95% CI
 *   - every threshold, sensitivity and specificity on the curve
 *   - the Youden best cut-off (every tied row) and the exact Clopper-Pearson
 *     intervals for its sensitivity and specificity (stats::binom.test)
 *   - the paired DeLong test between two tests: Z, p, CI of the difference
 *
 * Compares against test/fixtures/research/parity-roc.json, generated in CI by
 * scripts/research-parity-roc.R (R + pROC). Never committed, never faked: when
 * absent this file SKIPS with a message saying how to generate it.
 *
 * Numeric gate: abs diff <= 1e-4 OR rel diff <= 1e-4 (p < 1e-6 checks < 1e-6).
 *
 * Run: node --test test/research-stats-parity-roc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
const PARITY_PATH = new URL("./fixtures/research/parity-roc.json", import.meta.url);

function closeGate(actual, expected, label) {
  assert.ok(actual !== null && actual !== undefined, label + ": got null/undefined, want " + expected);
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(1e-12, Math.abs(expected));
  assert.ok(abs <= 1e-4 || rel <= 1e-4,
    label + ": got " + actual + ", want " + expected + " (abs " + abs + ", rel " + rel + ")");
}

function closeP(actual, expected, label) {
  if (expected < 1e-6) {
    assert.ok(actual < 1e-6, label + " p stays tiny, got " + actual);
  } else {
    closeGate(actual, expected, label + " p");
  }
}

const SKIP_MSG = "parity-roc.json missing: run `Rscript scripts/research-parity-roc.R` (needs R + pROC); CI generates it in the parity-roc job";

if (!existsSync(PARITY_PATH)) {
  test("ROC parity against pROC", { skip: SKIP_MSG }, () => {});
} else {
  const fixture = JSON.parse(readFileSync(PARITY_PATH, "utf8"));

  test("fixture is a real pROC run", () => {
    assert.equal(fixture.meta.generatedBy, "scripts/research-parity-roc.R");
    assert.ok(fixture.meta.pROC, "pROC version recorded");
    assert.ok(fixture.sets.length >= 5, "all data sets present");
  });

  for (const set of fixture.sets) {
    const opts = { positiveLevel: set.positive };
    if (set.direction && set.direction !== "auto") opts.direction = set.direction;
    const got = STATS.roc(set.rows, set.columns, set.truth, set.tests.map((t) => t.name), opts);

    test(set.id + ": levels", () => {
      assert.equal(got.positiveLevel, set.positive);
      assert.equal(got.negativeLevel, set.negative);
    });

    for (let i = 0; i < set.tests.length; i++) {
      const want = set.tests[i];
      const label = set.id + " " + want.name;

      test(label + ": counts, direction, AUC, SE and DeLong CI", () => {
        const g = got.tests[i];
        assert.equal(g.name, want.name);
        assert.equal(g.nCases, want.nCases, label + " cases");
        assert.equal(g.nControls, want.nControls, label + " controls");
        assert.equal(g.direction, want.direction, label + " direction");
        closeGate(g.auc, want.auc, label + " AUC");
        closeGate(g.se, want.se, label + " SE");
        closeGate(g.ciLower, want.ciLower, label + " CI lower");
        closeGate(g.ciUpper, want.ciUpper, label + " CI upper");
      });

      test(label + ": every threshold, sensitivity and specificity", () => {
        const g = got.tests[i];
        assert.equal(g.thresholds.length, want.innerThresholds.length + 2, label + " threshold count");
        assert.equal(g.thresholds[0], -Infinity);
        assert.equal(g.thresholds[g.thresholds.length - 1], Infinity);
        for (let k = 0; k < want.innerThresholds.length; k++) {
          closeGate(g.thresholds[k + 1], want.innerThresholds[k], label + " threshold " + (k + 1));
        }
        assert.equal(g.sensitivities.length, want.sensitivities.length);
        for (let k = 0; k < want.sensitivities.length; k++) {
          closeGate(g.sensitivities[k], want.sensitivities[k], label + " sensitivity " + k);
          closeGate(g.specificities[k], want.specificities[k], label + " specificity " + k);
        }
      });

      test(label + ": Youden best cut-off and exact intervals", () => {
        const g = got.tests[i];
        const best = g.best;
        /* every tied best row in pROC is a tie in the app too */
        assert.equal(best.ties.length, want.best.length, label + " number of tied best cut-offs");
        for (const w of want.best) {
          assert.ok(best.ties.some((t) => Math.abs(t - w.threshold) <= 1e-9 * Math.max(1, Math.abs(w.threshold))),
            label + ": pROC best threshold " + w.threshold + " missing from app ties " + best.ties.join(", "));
        }
        /* the one the app shows is one of them, with matching numbers */
        const row = want.best.find((w) => Math.abs(w.threshold - best.threshold) <= 1e-9 * Math.max(1, Math.abs(w.threshold)));
        assert.ok(row, label + ": shown cut-off " + best.threshold + " is a pROC best row");
        closeGate(best.sensitivity, row.sensitivity, label + " best sensitivity");
        closeGate(best.specificity, row.specificity, label + " best specificity");
        assert.equal(best.tp, row.tp, label + " true positives");
        assert.equal(best.tn, row.tn, label + " true negatives");
        closeGate(best.sensitivityCi[0], row.sensLower, label + " sensitivity CI lower");
        closeGate(best.sensitivityCi[1], row.sensUpper, label + " sensitivity CI upper");
        closeGate(best.specificityCi[0], row.specLower, label + " specificity CI lower");
        closeGate(best.specificityCi[1], row.specUpper, label + " specificity CI upper");
      });
    }

    for (const want of set.comparisons) {
      const label = set.id + " " + want.a + " vs " + want.b;
      test(label + ": paired DeLong test", () => {
        const g = got.comparisons.find((c) => c.a === want.a && c.b === want.b);
        assert.ok(g, label + " comparison present");
        assert.equal(g.n, want.n, label + " complete pairs");
        closeGate(g.aucA, want.aucA, label + " AUC A");
        closeGate(g.aucB, want.aucB, label + " AUC B");
        closeGate(g.z, want.z, label + " Z");
        closeP(g.p, want.p, label);
        closeGate(g.ciLower, want.ciLower, label + " diff CI lower");
        closeGate(g.ciUpper, want.ciUpper, label + " diff CI upper");
      });
    }
  }
}
