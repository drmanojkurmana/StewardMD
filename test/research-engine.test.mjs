/* ResearchMD stats engine (research-engine.js) against the metafor dat.bcg fixture.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-engine.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const ENGINE = require("../research-engine.js");
const bcg = JSON.parse(readFileSync(new URL("./fixtures/research/dat_bcg.json", import.meta.url), "utf8"));

const TOL = 1e-3;
function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= TOL, label + ": got " + actual + ", want " + expected + " (tol " + TOL + ")");
}

/* Phase 1 numeric gate (plan section 12): abs diff <= 1e-4 OR rel diff <= 1e-4. */
function closeGate(actual, expected, label) {
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(1e-12, Math.abs(expected));
  assert.ok(abs <= 1e-4 || rel <= 1e-4,
    label + ": got " + actual + ", want " + expected + " (abs " + abs + ", rel " + rel + ")");
}

function bcgProject(model, extra) {
  const project = {
    measure: "RR",
    model: model,
    level: 0.95,
    createdAt: "2026-11-23T00:00:00.000Z",
    studies: bcg.studies.map(function (s) {
      return {
        id: "bcg-" + s.trial,
        verified: true,
        events1: s.tpos,
        n1: s.tpos + s.tneg,
        events2: s.cpos,
        n2: s.cpos + s.cneg
      };
    })
  };
  if (extra) Object.keys(extra).forEach(function (k) { project[k] = extra[k]; });
  return project;
}

test("engine exports the documented API and version", function () {
  assert.equal(ENGINE.version, "rmd1");
  ["effectFromRaw", "effectFromCI", "effectFromGeneric", "pool", "run", "tQuantile"].forEach(function (k) {
    assert.equal(typeof ENGINE[k], "function", k + " must be a function");
  });
});

test("browser global is set when window exists", function () {
  const src = readFileSync(new URL("../research-engine.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(fakeWindow.SMD_RESEARCH_ENGINE.version, "rmd1");
  assert.equal(fakeWindow.SMD_RESEARCH_ENGINE, fakeWindow.SMD_RESEARCH_ENGINE);
  assert.ok(fakeWindow.SMD_RESEARCH_ENGINE.pool);
});

test("research.js stays a thin shell with no engine", function () {
  const src = readFileSync(new URL("../research.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(fakeWindow.SMD_RESEARCH.version, "rmd1");
  assert.equal(typeof fakeWindow.SMD_RESEARCH.open, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_ENGINE, undefined);
});

test("dat.bcg per-study log-RR matches metafor escalc", function () {
  bcg.perStudyPublished.forEach(function (p) {
    const s = bcg.studies[p.trial - 1];
    const r = ENGINE.effectFromRaw({
      events1: s.tpos, n1: s.tpos + s.tneg, events2: s.cpos, n2: s.cpos + s.cneg
    }, "RR");
    close(r.yi, p.yi, "trial " + p.trial + " yi");
    close(r.vi, p.vi, "trial " + p.trial + " vi");
  });
});

test("dat.bcg random DL matches the published metafor results", function () {
  const res = ENGINE.run(bcgProject("random_dl"));
  const pub = bcg.published.random_DL;
  close(res.pooled.effect, pub.estimate, "DL estimate");
  close(res.pooled.se, pub.se, "DL se");
  close(res.heterogeneity.tau2, pub.tau2, "DL tau2");
  // metafor prints I2 to 2 decimals (92.12), so the reference itself carries
  // up to 0.005 rounding; check we round to it rather than using the 1e-3 bar.
  assert.ok(Math.abs(res.heterogeneity.i2 - pub.i2) < 0.005, "DL I2 rounds to 92.12, got " + res.heterogeneity.i2);
  close(res.heterogeneity.q, pub.q, "Q");
  assert.equal(res.heterogeneity.df, pub.df);
  assert.ok(res.heterogeneity.p < 1e-4, "Q p-value tiny, got " + res.heterogeneity.p);
  assert.equal(res.excluded.length, 0);
  assert.equal(res.weights.length, 13);
  const total = res.weights.reduce(function (a, b) { return a + b; }, 0);
  assert.ok(Math.abs(total - 100) < 1e-6, "weights sum to 100, got " + total);
  assert.ok(res.weights.every(function (w) { return w > 0; }), "every weight positive");
});

test("dat.bcg fixed effect matches the published result, tau2 still reported as DL", function () {
  const res = ENGINE.run(bcgProject("fixed"));
  close(res.pooled.effect, bcg.published.fixed.estimate, "fixed estimate");
  close(res.pooled.se, bcg.published.fixed.se, "fixed se");
  assert.equal(res.heterogeneity.tau2Estimator, "DL");
  close(res.heterogeneity.tau2, bcg.published.random_DL.tau2, "fixed-model tau2 is the DL estimate");
});

test("run manifest echoes method and caller inputs", function () {
  const project = bcgProject("random_dl");
  const res = ENGINE.run(project);
  assert.equal(res.manifest.engineVersion, "rmd1");
  assert.equal(res.manifest.measure, "RR");
  assert.equal(res.manifest.model, "random_dl");
  assert.equal(res.manifest.level, 0.95);
  assert.equal(res.manifest.createdAt, "2026-11-23T00:00:00.000Z");
  assert.equal(res.manifest.inputs.length, 13);
  assert.deepEqual(res.manifest.inputs[0], {
    id: "bcg-1",
    values: { events1: 4, n1: 123, events2: 11, n2: 139 }
  });
});

test("double-zero study is excluded with reason double-zero", function () {
  const out = ENGINE.effectFromRaw({ id: "dz", events1: 0, n1: 50, events2: 0, n2: 50 }, "RR");
  assert.equal(out.excluded, true);
  assert.equal(out.reason, "double-zero");
  const res = ENGINE.run({
    measure: "RR", model: "random_dl", level: 0.95, createdAt: "t",
    studies: [
      { id: "a", verified: true, events1: 10, n1: 100, events2: 20, n2: 100 },
      { id: "b", verified: true, events1: 15, n1: 120, events2: 25, n2: 120 },
      { id: "dz", verified: true, events1: 0, n1: 50, events2: 0, n2: 50 }
    ]
  });
  assert.deepEqual(res.excluded, [{ id: "dz", reason: "double-zero" }]);
  assert.equal(res.weights.length, 2);
});

test("a single zero cell gets the 0.5 correction on all four cells", function () {
  const r = ENGINE.effectFromRaw({ events1: 0, n1: 50, events2: 5, n2: 50 }, "RR");
  assert.ok(!r.excluded, "single-zero must not be excluded");
  const a = 0.5, b = 50.5, c = 5.5, d = 45.5;
  close(r.yi, Math.log((a / (a + b)) / (c / (c + d))), "single-zero yi");
  close(r.vi, 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d), "single-zero vi");
  close(r.effect, Math.exp(r.yi), "display effect is exp(yi)");
});

test("no correction without a zero cell", function () {
  const r = ENGINE.effectFromRaw({ events1: 10, n1: 100, events2: 20, n2: 100 }, "OR");
  close(r.yi, Math.log((10 * 80) / (90 * 20)), "OR yi");
  close(r.vi, 1 / 10 + 1 / 90 + 1 / 20 + 1 / 80, "OR vi");
});

test("effectFromCI recovers SE with the study's own ciLevel (the Python bug)", function () {
  const r = ENGINE.effectFromCI({ effect: 2.0, ciLower: 1.5, ciUpper: 2.6667, ciLevel: 0.9 }, "RR");
  const z90 = 1.6448536269514722;
  const se90 = (Math.log(2.6667) - Math.log(1.5)) / (2 * z90);
  close(r.se, se90, "SE from the study 90% CI");
  close(r.yi, Math.log(2.0), "logged point");
  const z95 = 1.959963984540054;
  const seWrong = (Math.log(2.6667) - Math.log(1.5)) / (2 * z95);
  assert.ok(Math.abs(r.se - seWrong) > 0.01, "must not use the analysis 95% level");
  const def = ENGINE.effectFromCI({ effect: 2.0, ciLower: 1.5, ciUpper: 2.6667 }, "RR");
  close(def.se, seWrong, "default ciLevel is 0.95");
});

test("effectFromCI rejects bad inputs", function () {
  assert.throws(function () { ENGINE.effectFromCI({ effect: 0.5, ciLower: -1, ciUpper: 2 }, "RR"); }, /positive/);
  assert.throws(function () { ENGINE.effectFromCI({ effect: 2, ciLower: -1, ciUpper: 3 }, "RR"); }, /positive/);
  assert.throws(function () { ENGINE.effectFromCI({ effect: 2, ciLower: 2, ciUpper: 3 }, "RR"); }, /ciLower < effect/);
  assert.throws(function () { ENGINE.effectFromCI({ effect: 2, ciLower: 1, ciUpper: 2 }, "RR"); }, /ciLower < effect/);
  assert.throws(function () { ENGINE.effectFromCI({ effect: 1, ciLower: 0.5, ciUpper: NaN }, "MD"); }, /finite/);
  assert.throws(function () { ENGINE.effectFromCI({ effect: 1, ciLower: 0.5, ciUpper: 1.5, ciLevel: 1 }, "MD"); }, /ciLevel/);
});

test("run throws on unverified studies and lists their ids", function () {
  assert.throws(function () {
    ENGINE.run({
      measure: "RR", model: "fixed", level: 0.95, createdAt: "t",
      studies: [
        { id: "ok-1", verified: true, events1: 10, n1: 100, events2: 20, n2: 100 },
        { id: "no-src", verified: false, events1: 5, n1: 80, events2: 9, n2: 80 },
        { id: "ok-2", verified: true, events1: 12, n1: 90, events2: 18, n2: 90 }
      ]
    });
  }, /unverified.*no-src/);
});

test("fewer than two studies throws", function () {
  assert.throws(function () {
    ENGINE.run({
      measure: "RR", model: "fixed", level: 0.95, createdAt: "t",
      studies: [{ id: "only", verified: true, events1: 10, n1: 100, events2: 20, n2: 100 }]
    });
  }, /at least two/);
  assert.throws(function () {
    ENGINE.pool([{ id: "only", yi: 0.5, vi: 0.04 }], { model: "fixed" });
  }, /at least two/);
  assert.throws(function () {
    ENGINE.pool([
      { id: "dz1", excluded: true, reason: "double-zero" },
      { id: "dz2", excluded: true, reason: "double-zero" }
    ], { model: "fixed" });
  }, /at least two/);
});

test("Q p-value is the chi-square upper tail", function () {
  const even = ENGINE.pool(
    [{ id: "a", yi: 0.5, vi: 0.04 }, { id: "b", yi: 0.5, vi: 0.04 }],
    { model: "fixed" }
  );
  assert.equal(even.heterogeneity.q, 0);
  assert.equal(even.heterogeneity.p, 1);
  assert.equal(even.heterogeneity.i2, 0);
  assert.equal(even.heterogeneity.tau2, 0);
  // Q = 3.8416 on df 1 is the 5% point: P(chisq_1 > 1.96^2) = 0.05.
  const cal = ENGINE.pool(
    [{ id: "a", yi: 0.98, vi: 0.5 }, { id: "b", yi: -0.98, vi: 0.5 }],
    { model: "fixed" }
  );
  close(cal.heterogeneity.q, 3.8416, "calibration Q");
  assert.equal(cal.heterogeneity.df, 1);
  close(cal.heterogeneity.p, 0.05, "chi-square upper tail at the 5% point");
});

test("MD and SMD follow the handbook formulae", function () {
  const md = ENGINE.effectFromRaw({ mean1: 10, sd1: 2, n1: 20, mean2: 8, sd2: 2, n2: 20 }, "MD");
  assert.equal(md.yi, 2);
  close(md.vi, 0.4, "MD vi");
  const smd = ENGINE.effectFromRaw({ mean1: 10, sd1: 2, n1: 20, mean2: 8, sd2: 2, n2: 20 }, "SMD");
  const df = 38, J = 1 - 3 / (4 * df - 1), d = 1;
  close(smd.yi, J * d, "Hedges g");
  close(smd.vi, J * J * (40 / 400 + (d * d) / (2 * df)), "Hedges-Olkin variance");
  assert.throws(function () {
    ENGINE.effectFromRaw({ mean1: 1, sd1: 0, n1: 10, mean2: 0, sd2: 1, n2: 10 }, "SMD");
  }, /sd/);
});

test("dat.bcg REML matches the published metafor results", function () {
  // Certain published values: estimate -0.7145, se 0.1798, tau2 0.3132, I2 92.22.
  const res = ENGINE.run(bcgProject("random_reml"));
  closeGate(res.pooled.effect, -0.7145, "REML estimate");
  closeGate(res.pooled.se, 0.1798, "REML se");
  closeGate(res.heterogeneity.tau2, 0.3132, "REML tau2");
  closeGate(res.heterogeneity.i2, 92.22, "REML I2");
  assert.equal(res.heterogeneity.tau2Estimator, "REML");
  assert.equal(res.heterogeneity.converged, true);
  assert.equal(res.heterogeneity.df, 12);
  close(res.heterogeneity.q, bcg.published.random_DL.q, "Q is estimator-independent");
  const total = res.weights.reduce(function (a, b) { return a + b; }, 0);
  assert.ok(Math.abs(total - 100) < 1e-6, "weights sum to 100, got " + total);
});

test("tQuantile matches textbook values", function () {
  close(ENGINE.tQuantile(0.975, 1), 12.70620, "t 0.975 df 1");
  close(ENGINE.tQuantile(0.975, 2), 4.30265, "t 0.975 df 2");
  close(ENGINE.tQuantile(0.975, 5), 2.57058, "t 0.975 df 5");
  close(ENGINE.tQuantile(0.975, 12), 2.17881, "t 0.975 df 12");
  close(ENGINE.tQuantile(0.975, 30), 2.04227, "t 0.975 df 30");
  assert.equal(ENGINE.tQuantile(0.5, 7), 0);
  close(ENGINE.tQuantile(0.025, 10), -2.22814, "lower tail symmetry");
});

test("effectFromGeneric takes yi with se, sei or vi, or effect with CI", function () {
  const a = ENGINE.effectFromGeneric({ id: "g", yi: 0.5, se: 0.2 }, "MD");
  assert.equal(a.yi, 0.5);
  close(a.vi, 0.04, "se squared");
  close(a.effect, 0.5, "MD display is natural scale");
  const b = ENGINE.effectFromGeneric({ id: "g", yi: 0.5, vi: 0.04 }, "MD");
  close(b.se, 0.2, "vi square-rooted");
  const c = ENGINE.effectFromGeneric({ id: "g", yi: 0.5, sei: 0.2 }, "MD");
  close(c.vi, 0.04, "sei accepted");
  const d = ENGINE.effectFromGeneric({ effect: 2.0, ciLower: 1.5, ciUpper: 2.6667 }, "RR");
  close(d.yi, Math.log(2.0), "effect/CI shape delegates to the CI path and logs");
  assert.throws(function () { ENGINE.effectFromGeneric({ yi: 0.5 }, "MD"); }, /se/);
  assert.throws(function () { ENGINE.effectFromGeneric({ yi: 0.5, se: 0 }, "MD"); }, /se > 0/);
  assert.throws(function () { ENGINE.effectFromGeneric({}, "MD"); }, /yi/);
  const routed = ENGINE.run({
    measure: "MD", model: "fixed", level: 0.95, createdAt: "t",
    studies: [
      { id: "g1", verified: true, yi: 0.5, se: 0.2 },
      { id: "g2", verified: true, yi: 0.7, se: 0.25 }
    ]
  });
  assert.equal(routed.weights.length, 2);
  assert.equal(routed.manifest.inputs[0].values.yi, 0.5);
});

test("HR pools on the log scale and has no raw-count form", function () {
  const h = ENGINE.effectFromCI({ effect: 0.7, ciLower: 0.5, ciUpper: 0.98 }, "HR");
  close(h.yi, Math.log(0.7), "log HR");
  const g = ENGINE.effectFromGeneric({ yi: Math.log(0.7), se: 0.17 }, "HR");
  close(g.effect, 0.7, "log-HR yi exponentiates for display");
  assert.throws(function () {
    ENGINE.effectFromRaw({ events1: 1, n1: 10, events2: 2, n2: 10 }, "HR");
  }, /reported effect/);
});

test("RD keeps double-zero studies with finite variance", function () {
  const dz = ENGINE.effectFromRaw({ id: "dz", events1: 0, n1: 50, events2: 0, n2: 50 }, "RD");
  assert.ok(!dz.excluded, "RD double-zero must stay in");
  assert.equal(dz.yi, 0);
  assert.ok(dz.vi > 0 && isFinite(dz.vi), "finite variance, got " + dz.vi);
  const res = ENGINE.run({
    measure: "RD", model: "random_dl", level: 0.95, createdAt: "t",
    studies: [
      { id: "a", verified: true, events1: 10, n1: 100, events2: 20, n2: 100 },
      { id: "b", verified: true, events1: 15, n1: 120, events2: 25, n2: 120 },
      { id: "dz", verified: true, events1: 0, n1: 50, events2: 0, n2: 50 }
    ]
  });
  assert.deepEqual(res.excluded, []);
  assert.equal(res.weights.length, 3);
});

test("prediction interval is null below k = 3 and wider than the CI above", function () {
  const two = ENGINE.pool(
    [{ id: "a", yi: 0.5, vi: 0.04 }, { id: "b", yi: 0.6, vi: 0.05 }],
    { model: "random_reml" }
  );
  assert.equal(two.predictionInterval, null);
  const res = ENGINE.run(bcgProject("random_reml"));
  assert.ok(res.predictionInterval !== null, "k = 13 reports a PI");
  assert.ok(res.predictionInterval.lower < res.pooled.ciLower, "PI wider below");
  assert.ok(res.predictionInterval.upper > res.pooled.ciUpper, "PI wider above");
  assert.equal(res.predictionInterval.level, 0.95);
});

test("DL-only runs carry a method notice; REML and HKSJ runs do not", function () {
  const dl = ENGINE.run(bcgProject("random_dl"));
  assert.ok(dl.notices.some(function (n) { return (/^DL-only:/).test(n); }),
    "DL-only notice, got " + JSON.stringify(dl.notices));
  const reml = ENGINE.run(bcgProject("random_reml"));
  assert.ok(!reml.notices.some(function (n) { return (/^DL-only:/).test(n); }),
    "no DL-only notice for REML, got " + JSON.stringify(reml.notices));
  const knha = ENGINE.run(bcgProject("random_dl", { test: "knha" }));
  assert.ok(knha.hksj !== null && knha.hksj.df === 12, "knha reports the HKSJ block with df k-1");
});

/* Phase 1.5: HKSJ, prediction-interval and truncated-HKSJ numeric parity with
 * metafor live in test/research-parity.test.mjs, driven by the R reference
 * values in test/fixtures/research/parity.json (generated in CI by
 * scripts/research-parity.R), including the truncated-HKSJ branch via the
 * homogeneous bcg-rr-hom4 slice. */
