/* ResearchMD Phase 1.5 + Phase 4 R parity: research-engine.js against
 * metafor/metadat. Phase 4 adds leave1out (FE and DL), regtest (classic
 * Egger, model="lm", predictor="sei"), subgroup QM via rma mods FE, and the
 * funnel FE reference, all on dat.bcg RR (parity.json "phase4" key).
 *
 * Compares the engine to test/fixtures/research/parity.json, generated in CI
 * by scripts/research-parity.R (R + metafor + metadat; pinned reference calls
 * from docs/research/contracts/phase-1/reference-calls.md). The JSON file is
 * never committed and never faked locally: when it is absent this file SKIPS
 * with a message saying how to generate it.
 *
 * Numeric gate (plan section 12): abs diff <= 1e-4 OR rel diff <= 1e-4, with
 * exact agreement on boundary cases (tau2 = 0, dropped-study sets, k = 2
 * prediction intervals, HKSJ-truncation presence).
 *
 * Run: node --test test/research-parity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const ENGINE = require("../research-engine.js");
const PARITY_PATH = new URL("./fixtures/research/parity.json", import.meta.url);
const bcg = JSON.parse(readFileSync(new URL("./fixtures/research/dat_bcg.json", import.meta.url), "utf8"));

/* dat.bcg project for the Phase 4 references (alloc carried for subgroup). */
function bcgProject(model) {
  return {
    measure: "RR", model: model, test: "wald", level: 0.95, createdAt: "parity",
    studies: bcg.studies.map(function (s) {
      return {
        id: "bcg-" + s.trial, verified: true, alloc: s.alloc,
        events1: s.tpos, n1: s.tpos + s.tneg,
        events2: s.cpos, n2: s.cpos + s.cneg
      };
    })
  };
}

/* Tiny-p rule from checkQ: below 1e-6 only the order of magnitude is pinned. */
function closeP(actual, expected, label) {
  if (expected < 1e-6) {
    assert.ok(actual < 1e-6, label + " p stays tiny, got " + actual);
  } else {
    closeGate(actual, expected, label + " p");
  }
}

/* Phase 1 numeric gate (plan section 12). */
function closeGate(actual, expected, label) {
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(1e-12, Math.abs(expected));
  assert.ok(abs <= 1e-4 || rel <= 1e-4,
    label + ": got " + actual + ", want " + expected +
    " (abs " + abs + ", rel " + rel + ")");
}

function checkQ(actual, exp, label) {
  closeGate(actual.q, exp.q, label + " Q");
  assert.equal(actual.df, exp.df, label + " df (exact)");
  if (exp.p < 1e-6) {
    assert.ok(actual.p < 1e-6, label + " p stays tiny, got " + actual.p);
  } else {
    closeGate(actual.p, exp.p, label + " p");
  }
}

function checkTau(actual, exp, label) {
  closeGate(actual.i2, exp.i2, label + " I2");
  if (exp.tau2 === 0) {
    assert.equal(actual.tau2, 0, label + " tau2 is exactly 0");
  } else {
    closeGate(actual.tau2, exp.tau2, label + " tau2");
  }
}

function checkPooled(actual, exp, label) {
  closeGate(actual.effect, exp.est, label + " pooled effect");
  closeGate(actual.se, exp.se, label + " pooled se");
  closeGate(actual.ciLower, exp.lo, label + " pooled ciLower");
  closeGate(actual.ciUpper, exp.hi, label + " pooled ciUpper");
}

/* The engine wald block carries no effect field (it shares the pooled
 * estimate by construction); compare its se and CI only. */
function checkWald(actual, exp, label) {
  closeGate(actual.se, exp.se, label + " wald se");
  closeGate(actual.ciLower, exp.lo, label + " wald ciLower");
  closeGate(actual.ciUpper, exp.hi, label + " wald ciUpper");
}

function checkPI(actual, exp, label) {
  if (exp === null || exp === undefined) {
    assert.equal(actual, null, label + " prediction interval is null (exact)");
    return;
  }
  closeGate(actual.lower, exp.lower, label + " PI lower");
  closeGate(actual.upper, exp.upper, label + " PI upper");
  assert.equal(actual.level, 0.95, label + " PI level");
}

function checkDropped(res, c, label) {
  const got = res.excluded.map(function (e) { return e.id; }).sort();
  const want = c.droppedByR.slice().sort();
  assert.deepEqual(got, want, label + " dropped-study set matches R exactly");
  assert.equal(res.weights.length + res.excluded.length, c.studies.length,
    label + " every study is pooled or excluded");
  if ((c.measure === "OR" || c.measure === "RR") && want.length > 0) {
    assert.ok(res.excluded.every(function (e) { return e.reason === "double-zero"; }),
      label + " OR/RR drops are double-zero, got " + JSON.stringify(res.excluded));
  }
}

function checkWeights(actual, exp, label) {
  assert.equal(actual.length, exp.length, label + " weights length");
  actual.forEach(function (w, i) {
    closeGate(w, exp[i], label + " weight " + i);
  });
}

if (!existsSync(PARITY_PATH)) {
  test("R parity against metafor (skipped: parity.json absent)", function (t) {
    t.skip("parity.json is absent: it is generated in CI by " +
      "`Rscript scripts/research-parity.R` (needs R + metafor + metadat; " +
      "see the parity job in .github/workflows/research-ci.yml). " +
      "It is never committed and never faked locally.");
  });
} else {
  const parity = JSON.parse(readFileSync(PARITY_PATH, "utf8"));

  test("parity.json records the pinned reference calls and tolerance", function () {
    assert.deepEqual(parity.meta.tolerance, { abs: 1e-4, rel: 1e-4 });
    assert.ok(parity.meta.referenceCalls.escalc_OR_RR.indexOf("drop00=TRUE") !== -1);
    assert.ok(parity.meta.referenceCalls.rma_REML.indexOf("stepadj=0.5") !== -1);
    assert.ok(parity.meta.referenceCalls.rma_knha.indexOf('test="knha"') !== -1);
    assert.ok(parity.meta.referenceCalls.leave1out.indexOf("leave1out(") === 0);
    assert.ok(parity.meta.referenceCalls.regtest.indexOf('model="lm"') !== -1);
    assert.ok(parity.meta.referenceCalls.regtest.indexOf('predictor="sei"') !== -1);
    assert.ok(parity.meta.referenceCalls.rma_mods_FE.indexOf("mods=~factor(alloc)") !== -1);
    assert.ok(parity.phase4 && parity.phase4.dataset === "dat.bcg",
      "phase4 references are recorded for dat.bcg");
    const measures = {};
    const inputs = {};
    parity.cases.forEach(function (c) {
      measures[c.measure] = 1;
      inputs[c.input] = 1;
      assert.equal(c.level, 0.95, c.id + " runs at level 0.95");
      assert.ok(Array.isArray(c.droppedByR), c.id + " records R drops");
    });
    ["RR", "OR", "RD", "MD", "SMD"].forEach(function (m) {
      assert.ok(measures[m], "a case covers measure " + m);
    });
    ["counts", "generic", "reported"].forEach(function (k) {
      assert.ok(inputs[k], "a case covers input shape " + k);
    });
    const hom4 = parity.cases.filter(function (c) { return c.id === "bcg-rr-hom4"; })[0];
    assert.ok(hom4 && hom4.fits.REML_knha.truncated !== null,
      "the homogeneous slice triggers truncated HKSJ in R");
    const k2 = parity.cases.filter(function (c) { return c.id === "bcg-rr-k2"; })[0];
    assert.ok(k2 && k2.fits.REML.tau2 === 0, "the k = 2 slice has tau2 exactly 0 in R");
    assert.deepEqual(k2.pi, { FE: null, DL: null, REML: null, REML_knha: null },
      "no prediction interval is recorded below k = 3");
  });

  parity.cases.forEach(function (c) {
    test("parity: " + c.id + " (" + c.dataset + " " + c.measure + "/" + c.input + ")", function () {
      const byId = {};
      c.studies.forEach(function (s) { byId[s.id] = s; });

      /* Per-study effects: engine against escalc / back-calculation. */
      c.perStudy.forEach(function (p) {
        if (c.droppedByR.indexOf(p.id) !== -1) return;
        let r;
        if (c.input === "counts") r = ENGINE.effectFromRaw(byId[p.id], c.measure);
        else if (c.input === "generic") r = ENGINE.effectFromGeneric(byId[p.id], c.measure);
        else r = ENGINE.effectFromCI(byId[p.id], c.measure);
        closeGate(r.yi, p.yi, c.id + " " + p.id + " yi");
        closeGate(r.se, Math.sqrt(p.vi), c.id + " " + p.id + " se");
      });

      const base = {
        measure: c.measure, level: c.level,
        createdAt: "parity", studies: c.studies
      };
      function run(model, tst) {
        return ENGINE.run(Object.assign({}, base, { model: model, test: tst }));
      }

      /* FE pools with tau2 0 but reports the DL tau2, labelled. */
      const fe = run("fixed", "wald");
      checkPooled(fe.pooled, c.fits.FE, c.id + " FE");
      checkQ(fe.heterogeneity, c.fits.FE, c.id + " FE");
      checkTau(fe.heterogeneity, c.fits.DL, c.id + " FE");
      assert.equal(fe.heterogeneity.tau2Estimator, "DL");
      checkPI(fe.predictionInterval, c.pi.FE, c.id + " FE");
      checkDropped(fe, c, c.id + " FE");
      checkWeights(fe.weights, c.fits.FE.w, c.id + " FE");

      const dl = run("random_dl", "wald");
      checkPooled(dl.pooled, c.fits.DL, c.id + " DL");
      checkQ(dl.heterogeneity, c.fits.DL, c.id + " DL");
      checkTau(dl.heterogeneity, c.fits.DL, c.id + " DL");
      assert.equal(dl.heterogeneity.tau2Estimator, "DL");
      checkPI(dl.predictionInterval, c.pi.DL, c.id + " DL");
      checkDropped(dl, c, c.id + " DL");
      checkWeights(dl.weights, c.fits.DL.w, c.id + " DL");

      const re = run("random_reml", "wald");
      checkPooled(re.pooled, c.fits.REML, c.id + " REML");
      checkQ(re.heterogeneity, c.fits.REML, c.id + " REML");
      checkTau(re.heterogeneity, c.fits.REML, c.id + " REML");
      assert.equal(re.heterogeneity.tau2Estimator, "REML");
      checkPI(re.predictionInterval, c.pi.REML, c.id + " REML");
      checkDropped(re, c, c.id + " REML");
      checkWeights(re.weights, c.fits.REML.w, c.id + " REML");

      const knha = run("random_reml", "knha");
      checkPooled(knha.pooled, c.fits.REML_knha, c.id + " REML+knha");
      checkWald(knha.wald, c.fits.REML, c.id + " REML+knha");
      checkQ(knha.heterogeneity, c.fits.REML, c.id + " REML+knha");
      checkTau(knha.heterogeneity, c.fits.REML, c.id + " REML+knha");
      closeGate(knha.hksj.se, c.fits.REML_knha.se, c.id + " HKSJ se");
      assert.equal(knha.hksj.df, c.fits.REML_knha.df, c.id + " HKSJ df (exact)");
      assert.equal((knha.hksj.truncated === null),
        (c.fits.REML_knha.truncated === null),
        c.id + " truncated presence matches R exactly");
      if (c.fits.REML_knha.truncated !== null) {
        closeGate(knha.hksj.truncated.se, c.fits.REML_knha.truncated.se,
          c.id + " truncated se");
        closeGate(knha.hksj.truncated.ciLower, c.fits.REML_knha.truncated.lo,
          c.id + " truncated ciLower");
        closeGate(knha.hksj.truncated.ciUpper, c.fits.REML_knha.truncated.hi,
          c.id + " truncated ciUpper");
        assert.equal(knha.hksj.truncated.reason, "hksj-narrower-than-wald");
      }
      checkPI(knha.predictionInterval, c.pi.REML_knha, c.id + " REML+knha");
      checkDropped(knha, c, c.id + " REML+knha");
    });
  });

  /* ---- Phase 4 parity (dat.bcg RR, 13 trials) ---- */

  const p4 = parity.phase4;

  test("parity phase4: leaveOneOut FE matches leave1out(rma FE)", function () {
    const res = ENGINE.leaveOneOut(bcgProject("fixed"));
    assert.equal(res.length, p4.leaveOneOut.FE.length);
    res.forEach(function (r, i) {
      const fe = p4.leaveOneOut.FE[i];
      const dl = p4.leaveOneOut.DL[i];
      assert.equal(r.id, fe.id, "omit order matches R (FE)");
      closeGate(r.effect, fe.est, r.id + " FE estimate");
      closeGate(r.se, fe.se, r.id + " FE se");
      closeGate(r.ciLower, fe.lo, r.id + " FE ciLower");
      closeGate(r.ciUpper, fe.hi, r.id + " FE ciUpper");
      closeGate(r.q, fe.q, r.id + " FE Q");
      closeP(r.p, fe.p, r.id + " FE Q");
      /* Engine convention: fixed runs report the DL tau2/I2, labelled, so
       * the heterogeneity pair is compared against the DL leave1out record
       * (same rule as the Phase 1 FE checks). */
      assert.equal(r.tau2Estimator, "DL");
      if (dl.tau2 === 0) {
        assert.equal(r.tau2, 0, r.id + " FE-reported tau2 is exactly 0");
      } else {
        closeGate(r.tau2, dl.tau2, r.id + " FE-reported (DL) tau2");
      }
      closeGate(r.i2, dl.i2, r.id + " FE-reported (DL) I2");
    });
  });

  test("parity phase4: leaveOneOut DL matches leave1out(rma DL)", function () {
    const res = ENGINE.leaveOneOut(bcgProject("random_dl"));
    assert.equal(res.length, p4.leaveOneOut.DL.length);
    res.forEach(function (r, i) {
      const dl = p4.leaveOneOut.DL[i];
      assert.equal(r.id, dl.id, "omit order matches R (DL)");
      closeGate(r.effect, dl.est, r.id + " DL estimate");
      closeGate(r.se, dl.se, r.id + " DL se");
      closeGate(r.ciLower, dl.lo, r.id + " DL ciLower");
      closeGate(r.ciUpper, dl.hi, r.id + " DL ciUpper");
      closeGate(r.q, dl.q, r.id + " DL Q");
      closeP(r.p, dl.p, r.id + " DL Q");
      if (dl.tau2 === 0) {
        assert.equal(r.tau2, 0, r.id + " DL tau2 is exactly 0");
      } else {
        closeGate(r.tau2, dl.tau2, r.id + " DL tau2");
      }
      closeGate(r.i2, dl.i2, r.id + " DL I2");
    });
  });

  test("parity phase4: egger matches regtest(rma FE, model=lm, predictor=sei)", function () {
    const res = ENGINE.egger(bcgProject("fixed"));
    const exp = p4.egger;
    assert.equal(res.k, exp.k, "k (exact)");
    assert.equal(res.df, exp.df, "df k-2 (exact)");
    closeGate(res.intercept, exp.intercept, "Egger intercept");
    closeGate(res.se, exp.se, "Egger intercept se");
    closeGate(res.t, exp.t, "Egger t");
    closeP(res.p, exp.p, "Egger");
  });

  test("parity phase4: subgroup FE between-group Q matches rma mods FE QM", function () {
    const res = ENGINE.subgroup(bcgProject("fixed"), "alloc");
    closeGate(res.between.q, p4.subgroup.between.q, "Q_between (QM)");
    assert.equal(res.between.df, p4.subgroup.between.df, "Q_between df (exact)");
    closeP(res.between.p, p4.subgroup.between.p, "Q_between (QMp)");
    assert.equal(res.groups.length, p4.subgroup.groups.length);
    p4.subgroup.groups.forEach(function (g) {
      const mine = res.groups.filter(function (x) { return String(x.group) === g.group; })[0];
      assert.ok(mine, "engine reports subgroup " + g.group);
      assert.equal(mine.k, g.k, g.group + " k (exact)");
      closeGate(mine.result.pooled.effect, g.FE.est, g.group + " FE estimate");
      closeGate(mine.result.pooled.se, g.FE.se, g.group + " FE se");
      closeGate(mine.result.pooled.ciLower, g.FE.lo, g.group + " FE ciLower");
      closeGate(mine.result.pooled.ciUpper, g.FE.hi, g.group + " FE ciUpper");
      closeGate(mine.result.heterogeneity.q, g.FE.q, g.group + " FE Q");
      /* FE runs report the DL tau2/I2 labelled: compare with the group DL fit. */
      if (g.DL.tau2 === 0) {
        assert.equal(mine.result.heterogeneity.tau2, 0, g.group + " tau2 exactly 0");
      } else {
        closeGate(mine.result.heterogeneity.tau2, g.DL.tau2, g.group + " (DL) tau2");
      }
      closeGate(mine.result.heterogeneity.i2, g.DL.i2, g.group + " (DL) I2");
    });
  });

  test("parity phase4: subgroup DL estimates match per-group rma DL", function () {
    const res = ENGINE.subgroup(bcgProject("random_dl"), "alloc");
    p4.subgroup.groups.forEach(function (g) {
      const mine = res.groups.filter(function (x) { return String(x.group) === g.group; })[0];
      assert.ok(mine, "engine reports subgroup " + g.group);
      closeGate(mine.result.pooled.effect, g.DL.est, g.group + " DL estimate");
      closeGate(mine.result.pooled.se, g.DL.se, g.group + " DL se");
      closeGate(mine.result.pooled.ciLower, g.DL.lo, g.group + " DL ciLower");
      closeGate(mine.result.pooled.ciUpper, g.DL.hi, g.group + " DL ciUpper");
      if (g.DL.tau2 === 0) {
        assert.equal(mine.result.heterogeneity.tau2, 0, g.group + " DL tau2 exactly 0");
      } else {
        closeGate(mine.result.heterogeneity.tau2, g.DL.tau2, g.group + " DL tau2");
      }
      closeGate(mine.result.heterogeneity.i2, g.DL.i2, g.group + " DL I2");
    });
    /* The between-group Q stays the fixed-effect form on the DL subgroup
     * estimates; it is NOT compared with a random-effects QM (not pinned). */
    assert.equal(res.between.df, p4.subgroup.between.df);
    assert.ok(res.between.q >= 0);
  });

  test("parity phase4: funnel FE reference and pseudo-95% limits", function () {
    const res = ENGINE.funnel(bcgProject("random_dl"));
    const f = p4.funnel;
    assert.deepEqual(res.points.map(function (p) { return p.id; }), p4.ids,
      "funnel points cover the included studies in fit order");
    closeGate(res.fe.effect, f.feEst, "funnel FE estimate");
    closeGate(res.fe.se, f.feSe, "funnel FE se");
    closeGate(res.limits.seTo, f.seMax, "funnel se range");
    const z = 1.959963984540054;
    closeGate(res.limits.lower[1].yi, f.feEst - z * f.seMax, "pseudo lower limit at seMax");
    closeGate(res.limits.upper[1].yi, f.feEst + z * f.seMax, "pseudo upper limit at seMax");
    closeGate(res.limits.lower[0].yi, f.feEst, "lower line starts at the FE estimate");
    closeGate(res.limits.upper[0].yi, f.feEst, "upper line starts at the FE estimate");
  });
}
