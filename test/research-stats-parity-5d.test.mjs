/* ResearchMD Phase 5D R parity for JS on-device statistics (research-stats.js):
 * lm + HC3, glm binomial, survfit, survdiff, coxph efron + cox.zph(transform="km"),
 * mada::reitsma, and mada::sroc (ruttergatsonis and naive).
 *
 * Compares against test/fixtures/research/parity-5d.json, generated in CI by
 * scripts/research-parity-5d.R (R + survival + mada). Never committed, never faked:
 * when absent this file SKIPS with a message saying how to generate it.
 *
 * Numeric gate: abs diff <= 1e-4 OR rel diff <= 1e-4 (p < 1e-6 checks < 1e-6).
 *
 * Run: node --test test/research-stats-parity-5d.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
const PARITY_PATH = new URL("./fixtures/research/parity-5d.json", import.meta.url);

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

function nullOrClose(actual, expected, label) {
  if (expected === null || expected === undefined) {
    assert.equal(actual, null, label + " is null");
  } else {
    closeGate(actual, expected, label);
  }
}

if (!existsSync(PARITY_PATH)) {
  test("5D R parity against lm/glm/survival/mada (skipped: parity-5d.json absent)", function (t) {
    t.skip("parity-5d.json is absent: generate it with " +
      "`R_LIBS_USER=~/Library/R/library Rscript scripts/research-parity-5d.R` " +
      "(needs R + survival + mada; see the parity-5d job in " +
      ".github/workflows/research-ci.yml). It is never committed and never faked.");
  });
} else {
  const PARITY = JSON.parse(readFileSync(PARITY_PATH, "utf8"));

  test("parity-5d meta records pinned reference calls and tolerance", function () {
    assert.deepEqual(PARITY.meta.tolerance, { abs: 1e-4, rel: 1e-4 });
    assert.equal(PARITY.meta.level, 0.95);
    assert.ok(PARITY.meta.referenceCalls.coxph.indexOf('ties = "efron"') !== -1);
    assert.ok(PARITY.meta.referenceCalls.cox_zph.indexOf('transform = "km"') !== -1);
    assert.ok(PARITY.meta.referenceCalls.reitsma.indexOf("reitsma") !== -1);
  });

  test("parity-5d: linear regression matches lm(mpg ~ wt + hp) and HC3 SEs", function () {
    const ref = PARITY.regression;
    const cols = ref.columns;
    const rows = cols.mpg.map(function (_, i) {
      return [cols.mpg[i], cols.wt[i], cols.hp[i]];
    });
    const types = { mpg: "numeric", wt: "numeric", hp: "numeric" };
    const fit = STATS.linear(rows, ["mpg", "wt", "hp"], "mpg", ["wt", "hp"], types);
    const exp = ref.linear;
    assert.equal(fit.n, exp.n);
    assert.equal(fit.dfResidual, exp.dfResidual);
    assert.equal(fit.coefficients.length, exp.coefficients.length);
    fit.coefficients.forEach(function (got, i) {
      const want = exp.coefficients[i];
      assert.equal(got.term, want.term);
      closeGate(got.estimate, want.est, "lm " + want.term + " estimate");
      closeGate(got.se, want.se, "lm " + want.term + " se");
      closeGate(got.t, want.t, "lm " + want.term + " t");
      closeP(got.p, want.p, "lm " + want.term);
      closeGate(got.ciLower, want.lo, "lm " + want.term + " ciLower");
      closeGate(got.ciUpper, want.hi, "lm " + want.term + " ciUpper");
    });
    closeGate(fit.sigma, exp.sigma, "lm sigma");
    closeGate(fit.r2, exp.r2, "lm R2");
    closeGate(fit.aic, exp.aic, "lm AIC");

    const hc3 = STATS.linear(rows, ["mpg", "wt", "hp"], "mpg", ["wt", "hp"], types, { robust: "HC3" });
    hc3.coefficients.forEach(function (got, i) {
      closeGate(got.se, exp.hc3Se[i], "HC3 " + got.term + " se");
    });
  });

  test("parity-5d: logistic regression matches glm(am ~ wt + hp, binomial), Wald CI, AIC", function () {
    const ref = PARITY.regression;
    const cols = ref.columns;
    const rows = cols.am.map(function (_, i) {
      return [String(cols.am[i]), String(cols.wt[i]), String(cols.hp[i])];
    });
    const fit = STATS.logistic(rows, ["am", "wt", "hp"], "am", ["wt", "hp"], { am: "binary", wt: "numeric", hp: "numeric" });
    const exp = ref.logistic;
    assert.equal(fit.n, exp.n);
    assert.equal(fit.converged, true);
    assert.equal(fit.coefficients.length, exp.coefficients.length);
    fit.coefficients.forEach(function (got, i) {
      const want = exp.coefficients[i];
      assert.equal(got.name, want.term);
      closeGate(got.estimate, want.est, "glm " + want.term + " estimate");
      closeGate(got.se, want.se, "glm " + want.term + " se");
      closeGate(got.z, want.z, "glm " + want.term + " z");
      closeP(got.p, want.p, "glm " + want.term);
      closeGate(Math.log(got.ciLower), want.lo, "glm " + want.term + " Wald ciLower");
      closeGate(Math.log(got.ciUpper), want.hi, "glm " + want.term + " Wald ciUpper");
    });
    closeGate(fit.aic, exp.aic, "glm AIC");
    closeGate(fit.deviance, exp.deviance, "glm deviance");
    closeGate(fit.nullDeviance, exp.nullDeviance, "glm nullDeviance");
  });

  function lungRows() {
    return PARITY.survival.rows.map(function (r) {
      return { time: r.time, event: r.status === 2 ? 1 : 0, age: r.age, sex: r.sex };
    });
  }

  test("parity-5d: Kaplan-Meier steps and median CI match survfit", function () {
    const rows = lungRows();
    const res = STATS.kaplanMeier(
      rows.map(function (r) { return r.time; }),
      rows.map(function (r) { return r.event; }),
      null,
      { confType: "log" }
    );
    const exp = PARITY.survival.km;
    assert.equal(res.ok, true);
    const g = res.groups[0];
    assert.equal(g.n, exp.n);
    assert.equal(g.nEvents, exp.events);
    assert.equal(g.steps.length, exp.steps.length);
    g.steps.forEach(function (got, i) {
      const want = exp.steps[i];
      const lbl = "KM t=" + want.time;
      assert.equal(got.t, want.time, lbl + " time");
      assert.equal(got.atRisk, want.nRisk, lbl + " nRisk");
      assert.equal(got.events, want.nEvent, lbl + " nEvent");
      assert.equal(got.censored, want.nCensor, lbl + " nCensor");
      closeGate(got.survival, want.surv, lbl + " surv");
      closeGate(got.seLogS, want.se, lbl + " se");
      nullOrClose(got.ciLower, want.lo, lbl + " ciLower");
      nullOrClose(got.ciUpper, want.hi, lbl + " ciUpper");
    });
    assert.equal(g.median.value, exp.median);
    assert.equal(g.median.lower, exp.medianLo);
    assert.equal(g.median.upper, exp.medianHi);
  });

  test("parity-5d: log-rank chisq and p match survdiff", function () {
    const rows = lungRows();
    const res = STATS.logRank(
      rows.map(function (r) { return r.time; }),
      rows.map(function (r) { return r.event; }),
      rows.map(function (r) { return r.sex; })
    );
    const exp = PARITY.survival.logrank;
    assert.equal(res.ok, true);
    assert.equal(res.df, exp.df);
    closeGate(res.chi2, exp.chisq, "logrank chisq");
    closeP(res.p, exp.p, "logrank");
    assert.equal(res.table.length, exp.groups.length);
    res.table.forEach(function (got, i) {
      const want = exp.groups[i];
      assert.equal(Number(got.group), want.group);
      assert.equal(got.n, want.n);
      closeGate(got.observed, want.observed, "logrank obs " + want.group);
      closeGate(got.expected, want.expected, "logrank exp " + want.group);
    });
  });

  test("parity-5d: Cox coefficients and Schoenfeld PH test match coxph efron and cox.zph", function () {
    const rows = lungRows();
    const spec = {
      time: "time",
      event: "event",
      predictors: [{ name: "age", type: "numeric" }, { name: "sex", type: "numeric" }],
      ties: "efron"
    };
    const fit = STATS.cox(rows, spec);
    const expCox = PARITY.survival.cox;
    assert.equal(fit.ok, true);
    assert.equal(fit.converged, true);
    assert.equal(fit.n, expCox.n);
    assert.equal(fit.nEvents, expCox.events);
    closeGate(fit.logLik, expCox.logLik, "cox logLik");
    fit.coefficients.forEach(function (got, i) {
      const want = expCox.coefficients[i];
      assert.equal(got.term, want.term);
      closeGate(got.beta, want.coef, "cox " + want.term + " coef");
      closeGate(got.se, want.se, "cox " + want.term + " se");
      closeGate(got.z, want.z, "cox " + want.term + " z");
      closeP(got.p, want.p, "cox " + want.term);
      closeGate(got.hr, want.hr, "cox " + want.term + " hr");
      closeGate(got.ciLower, want.lo, "cox " + want.term + " lo");
      closeGate(got.ciUpper, want.hi, "cox " + want.term + " hi");
    });

    const ph = STATS.schoenfeld(fit, rows, spec, { transform: "km" });
    const expPh = PARITY.survival.ph;
    assert.equal(ph.ok, true);
    assert.equal(ph.transform, expPh.transform);
    ph.terms.forEach(function (got, i) {
      const want = expPh.terms[i];
      assert.equal(got.term, want.term);
      assert.equal(got.df, want.df);
      closeGate(got.chisq, want.chisq, "zph " + want.term + " chisq");
      closeP(got.p, want.p, "zph " + want.term);
    });
    assert.equal(ph.global.df, expPh.global.df);
    closeGate(ph.global.chisq, expPh.global.chisq, "zph global chisq");
    closeP(ph.global.p, expPh.global.p, "zph global");
  });

  PARITY.diagnostic.datasets.forEach(function (ds) {
    test("parity-5d: diagnostic per-study, Reitsma, and SROC match mada on " + ds.name, function () {
      const ps = STATS.diagnosticPerStudy(ds.studies);
      assert.equal(ps.correctionApplied, ds.correctionApplied);
      ps.studies.forEach(function (got, i) {
        const want = ds.perStudy[i];
        assert.equal(got.id, want.id);
        closeGate(got.sens, want.sens, ds.name + " " + want.id + " sens");
        closeGate(got.spec, want.spec, ds.name + " " + want.id + " spec");
      });

      const fit = STATS.reitsma(ds.studies);
      const exp = ds.reitsma;
      assert.equal(fit.k, ds.studies.length);
      fit.coefficients.forEach(function (got, i) {
        const want = exp.coefficients[i];
        assert.equal(got.term, want.term);
        closeGate(got.estimate, want.est, ds.name + " " + want.term + " est");
        closeGate(got.se, want.se, ds.name + " " + want.term + " se");
        closeGate(got.z, want.z, ds.name + " " + want.term + " z");
        closeP(got.p, want.p, ds.name + " " + want.term);
        closeGate(got.ciLower, want.lo, ds.name + " " + want.term + " lo");
        closeGate(got.ciUpper, want.hi, ds.name + " " + want.term + " hi");
      });
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          closeGate(fit.psi[i][j], exp.psi[i][j], ds.name + " Psi[" + i + "," + j + "]");
        }
      }
      closeGate(fit.pooledSens, exp.pooledSens, ds.name + " pooledSens");
      closeGate(fit.pooledFpr, exp.pooledFpr, ds.name + " pooledFpr");
      closeGate(fit.pooledSpec, exp.pooledSpec, ds.name + " pooledSpec");

      const rg = STATS.sroc(fit, ds.sroc.fpr, "ruttergatsonis");
      const nv = STATS.sroc(fit, ds.sroc.fpr, "naive");
      assert.equal(rg.length, ds.sroc.ruttergatsonis.length);
      assert.equal(nv.length, ds.sroc.naive.length);
      rg.forEach(function (v, idx) {
        closeGate(v, ds.sroc.ruttergatsonis[idx], ds.name + " sroc ruttergatsonis[" + idx + "]");
      });
      nv.forEach(function (v, idx) {
        closeGate(v, ds.sroc.naive[idx], ds.name + " sroc naive[" + idx + "]");
      });
    });
  });
}
