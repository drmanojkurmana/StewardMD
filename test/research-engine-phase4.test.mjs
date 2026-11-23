/* ResearchMD Phase 4.1 / 4.2 engine tests: hand-checked values.
 *
 * node --test test/research-engine-phase4.test.mjs
 *
 * R/metafor numeric parity (leave1out, regtest, subgroup QM on dat.bcg) lives
 * in test/research-parity.test.mjs and runs in CI; this file checks the
 * formulae against hand arithmetic shown in comments.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const ENGINE = require("../research-engine.js");
const bcg = JSON.parse(readFileSync(new URL("./fixtures/research/dat_bcg.json", import.meta.url), "utf8"));

const TOL = 1e-6;
function close(actual, expected, label, tol) {
  const t = tol === undefined ? TOL : tol;
  assert.ok(Math.abs(actual - expected) <= t,
    label + ": got " + actual + ", want " + expected + " (tol " + t + ")");
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
        alloc: s.alloc,
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

/* Generic-input project helper (MD, natural scale). */
function genProject(studies, model) {
  return {
    measure: "MD", model: model || "fixed", level: 0.95, createdAt: "t",
    studies: studies.map(function (s) {
      return Object.assign({ verified: true }, s);
    })
  };
}

test("phase 4 exports exist and the browser global carries them", function () {
  ["subgroup", "leaveOneOut", "sensitivity", "egger", "funnel",
    "splitSharedControl", "clusterAdjust", "crossoverAdjust",
    "medianToMean", "rangeToMean", "normalQuantile"].forEach(function (k) {
    assert.equal(typeof ENGINE[k], "function", k + " must be a function");
  });
  const src = readFileSync(new URL("../research-engine.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.equal(typeof fakeWindow.SMD_RESEARCH_ENGINE.subgroup, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_ENGINE.version, "rmd1");
});

test("engine source stays ES5 (no arrows, let/const, template strings)", function () {
  /* Strip comments first: backticks and prose words are fine in comments. */
  const src = readFileSync(new URL("../research-engine.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(src.indexOf("=>") === -1, "no arrow functions");
  assert.ok(!/\b(let|const)\s/.test(src), "no let/const declarations");
  assert.ok(src.indexOf("`") === -1, "no template strings");
  assert.ok(!/\bclass\s+[A-Za-z]/.test(src), "no classes");
});

/* ---- subgroup ---------------------------------------------------------- */

test("subgroup: hand-checked fixed-effect between-group Q", function () {
  /* Group A: yi 0.5 and 0.7, vi 0.04 each -> theta_A = 0.6, se_A^2 = 1/50.
   * Group B: yi -0.2 and 0.0, vi 0.01 each -> theta_B = -0.1, se_B^2 = 1/200.
   * w_A = 50, w_B = 200; theta_bar = (50*0.6 + 200*(-0.1))/250 = 0.04.
   * Q_between = 50*(0.6-0.04)^2 + 200*(-0.1-0.04)^2
   *           = 50*0.3136 + 200*0.0196 = 15.68 + 3.92 = 19.6, df = 1. */
  const project = genProject([
    { id: "a1", yi: 0.5, se: 0.2, grp: "A" },
    { id: "a2", yi: 0.7, se: 0.2, grp: "A" },
    { id: "b1", yi: -0.2, se: 0.1, grp: "B" },
    { id: "b2", yi: 0.0, se: 0.1, grp: "B" }
  ], "fixed");
  const res = ENGINE.subgroup(project, "grp");
  assert.equal(res.key, "grp");
  assert.equal(res.groups.length, 2);
  assert.equal(res.groups[0].group, "A");
  assert.equal(res.groups[0].k, 2);
  close(res.groups[0].result.pooled.effect, 0.6, "theta_A");
  close(res.groups[1].result.pooled.effect, -0.1, "theta_B");
  close(res.between.q, 19.6, "Q_between");
  assert.equal(res.between.df, 1);
  assert.ok(res.between.p < 1e-4, "Q 19.6 on df 1 is far past the 5% point, got " + res.between.p);
  /* Each subgroup result is exactly run() on the subset (manifest included). */
  const subset = genProject([
    { id: "a1", yi: 0.5, se: 0.2 },
    { id: "a2", yi: 0.7, se: 0.2 }
  ], "fixed");
  close(res.groups[0].result.pooled.se, ENGINE.run(subset).pooled.se, "subgroup se equals run on subset");
  assert.equal(res.groups[0].result.manifest.measure, "MD");
});

test("subgroup: random_dl subgroups match run on each subset", function () {
  const project = genProject([
    { id: "a1", yi: 0.5, se: 0.2, grp: "A" },
    { id: "a2", yi: 0.9, se: 0.25, grp: "A" },
    { id: "b1", yi: -0.2, se: 0.1, grp: "B" },
    { id: "b2", yi: 0.0, se: 0.15, grp: "B" }
  ], "random_dl");
  const res = ENGINE.subgroup(project, "grp");
  ["A", "B"].forEach(function (g, i) {
    const subset = genProject(project.studies.filter(function (s) { return s.grp === g; })
      .map(function (s) { return { id: s.id, yi: s.yi, se: s.se }; }), "random_dl");
    const want = ENGINE.run(subset);
    close(res.groups[i].result.pooled.effect, want.pooled.effect, g + " DL effect");
    close(res.groups[i].result.heterogeneity.tau2, want.heterogeneity.tau2, g + " DL tau2");
  });
  assert.equal(res.between.df, 1);
  assert.ok(res.between.q >= 0);
});

test("subgroup: dat.bcg split by alloc has three groups with the right sizes", function () {
  const res = ENGINE.subgroup(bcgProject("fixed"), "alloc");
  const counts = {};
  bcg.studies.forEach(function (s) { counts[s.alloc] = (counts[s.alloc] || 0) + 1; });
  assert.equal(res.groups.length, Object.keys(counts).length);
  res.groups.forEach(function (g) {
    assert.equal(g.k, counts[g.group], "group " + g.group + " size");
    assert.equal(g.result.weights.length, g.k);
  });
  assert.equal(res.between.df, res.groups.length - 1);
  assert.ok(res.between.p >= 0 && res.between.p <= 1);
});

test("subgroup: validation errors", function () {
  const base = genProject([
    { id: "a1", yi: 0.5, se: 0.2, grp: "A" },
    { id: "a2", yi: 0.7, se: 0.2, grp: "A" },
    { id: "b1", yi: -0.2, se: 0.1, grp: "B" },
    { id: "b2", yi: 0.0, se: 0.1, grp: "B" }
  ], "fixed");
  assert.throws(function () { ENGINE.subgroup(base, ""); }, /field name/);
  assert.throws(function () { ENGINE.subgroup(base, "missing"); }, /missing subgroup field/);
  const oneGroup = genProject([
    { id: "a1", yi: 0.5, se: 0.2, grp: "A" },
    { id: "a2", yi: 0.7, se: 0.2, grp: "A" }
  ], "fixed");
  assert.throws(function () { ENGINE.subgroup(oneGroup, "grp"); }, /at least two groups/);
  const singleton = genProject([
    { id: "a1", yi: 0.5, se: 0.2, grp: "A" },
    { id: "a2", yi: 0.7, se: 0.2, grp: "A" },
    { id: "b1", yi: -0.2, se: 0.1, grp: "B" }
  ], "fixed");
  assert.throws(function () { ENGINE.subgroup(singleton, "grp"); }, /subgroup B needs at least two/);
  const unverified = genProject([
    { id: "a1", yi: 0.5, se: 0.2, grp: "A" },
    { id: "a2", yi: 0.7, se: 0.2, grp: "A" },
    { id: "b1", yi: -0.2, se: 0.1, grp: "B" },
    { id: "b2", yi: 0.0, se: 0.1, grp: "B" }
  ], "fixed");
  unverified.studies[2].verified = false;
  assert.throws(function () { ENGINE.subgroup(unverified, "grp"); }, /unverified/);
});

/* ---- leaveOneOut -------------------------------------------------------- */

test("leaveOneOut: hand-checked fixed-effect refits", function () {
  /* yi 0.5, 0.7, 0.9 with vi 0.04 each. Omitting one leaves the mean of the
   * other two: 0.8, 0.7, 0.6. se = sqrt(0.04/2) = sqrt(0.02).
   * Q of a pair = (diff)^2 / (0.04+0.04): adjacent pairs (diff 0.2) give
   * 0.5; omitting the middle leaves the outer pair (diff 0.4), Q = 2. */
  const project = genProject([
    { id: "s1", yi: 0.5, se: 0.2 },
    { id: "s2", yi: 0.7, se: 0.2 },
    { id: "s3", yi: 0.9, se: 0.2 }
  ], "fixed");
  const res = ENGINE.leaveOneOut(project);
  assert.equal(res.length, 3);
  const want = { s1: 0.8, s2: 0.7, s3: 0.6 };
  const wantQ = { s1: 0.5, s2: 2, s3: 0.5 };
  res.forEach(function (r) {
    close(r.effect, want[r.id], "omit " + r.id + " effect");
    close(r.se, Math.sqrt(0.02), "omit " + r.id + " se");
    close(r.ciLower, want[r.id] - 1.959963984540054 * Math.sqrt(0.02), "ci lower", 1e-5);
    close(r.ciUpper, want[r.id] + 1.959963984540054 * Math.sqrt(0.02), "ci upper", 1e-5);
    close(r.q, wantQ[r.id], "pair Q");
    assert.equal(r.df, 1);
  });
  assert.deepEqual(res.map(function (r) { return r.id; }), ["s1", "s2", "s3"]);
});

test("leaveOneOut: hand-checked DL refit with nonzero tau2", function () {
  /* yi 0, 0.4, 0.8 with vi 0.04. Omit the middle study: the pair (0, 0.8)
   * has Q = 0.64/0.08 = 8, df 1, C = 50 - 1250/50 = 25,
   * tau2_DL = (8-1)/25 = 0.28. DL weights 1/(0.04+0.28) = 3.125 each, so
   * effect = 0.4, se = sqrt(1/6.25) = 0.4.
   * s2 = (k-1)*sumW/(sumW^2-sumW2) = 50/1250 = 0.04,
   * I2 = 100*0.28/(0.28+0.04) = 87.5. */
  const project = genProject([
    { id: "lo", yi: 0.0, se: 0.2 },
    { id: "mid", yi: 0.4, se: 0.2 },
    { id: "hi", yi: 0.8, se: 0.2 }
  ], "random_dl");
  const res = ENGINE.leaveOneOut(project);
  const mid = res.filter(function (r) { return r.id === "mid"; })[0];
  close(mid.effect, 0.4, "DL effect");
  close(mid.se, 0.4, "DL se");
  close(mid.tau2, 0.28, "DL tau2");
  close(mid.i2, 87.5, "DL I2");
  close(mid.q, 8, "Q");
});

test("leaveOneOut: needs three included studies; double-zero drops do not count", function () {
  assert.throws(function () {
    ENGINE.leaveOneOut(genProject([
      { id: "s1", yi: 0.5, se: 0.2 }, { id: "s2", yi: 0.7, se: 0.2 }
    ], "fixed"));
  }, /at least three/);
  /* Two real studies plus a double-zero: only two included, so it throws. */
  assert.throws(function () {
    ENGINE.leaveOneOut({
      measure: "RR", model: "fixed", level: 0.95, createdAt: "t",
      studies: [
        { id: "a", verified: true, events1: 10, n1: 100, events2: 20, n2: 100 },
        { id: "b", verified: true, events1: 15, n1: 120, events2: 25, n2: 120 },
        { id: "dz", verified: true, events1: 0, n1: 50, events2: 0, n2: 50 }
      ]
    });
  }, /at least three/);
});

test("leaveOneOut: dat.bcg DL records equal run() on the reduced project", function () {
  const project = bcgProject("random_dl");
  const res = ENGINE.leaveOneOut(project);
  assert.equal(res.length, 13);
  res.forEach(function (r) {
    const reduced = bcgProject("random_dl");
    reduced.studies = reduced.studies.filter(function (s) { return s.id !== r.id; });
    const want = ENGINE.run(reduced);
    close(r.effect, want.pooled.effect, r.id + " effect");
    close(r.se, want.pooled.se, r.id + " se");
    close(r.tau2, want.heterogeneity.tau2, r.id + " tau2");
    close(r.i2, want.heterogeneity.i2, r.id + " I2");
  });
});

/* ---- sensitivity -------------------------------------------------------- */

test("sensitivity: excludeIds re-runs on the kept studies", function () {
  const project = genProject([
    { id: "s1", yi: 0.5, se: 0.2 },
    { id: "s2", yi: 0.7, se: 0.2 },
    { id: "s3", yi: 0.9, se: 0.2 }
  ], "fixed");
  const res = ENGINE.sensitivity(project, ["s3"]);
  assert.deepEqual(res.excluded, ["s3"]);
  const want = ENGINE.run(genProject([
    { id: "s1", yi: 0.5, se: 0.2 }, { id: "s2", yi: 0.7, se: 0.2 }
  ], "fixed"));
  close(res.run.pooled.effect, want.pooled.effect, "sensitivity effect");
  assert.equal(res.run.manifest.inputs.length, 2);
  /* Unknown ids are ignored. */
  const none = ENGINE.sensitivity(project, ["nope"]);
  assert.deepEqual(none.excluded, []);
  close(none.run.pooled.effect, ENGINE.run(project).pooled.effect, "no-op sensitivity");
});

test("sensitivity: exclusion predicate drops studies returning true", function () {
  const project = genProject([
    { id: "s1", yi: 0.5, se: 0.2, big: false },
    { id: "s2", yi: 0.7, se: 0.2, big: true },
    { id: "s3", yi: 0.9, se: 0.2, big: false }
  ], "fixed");
  const res = ENGINE.sensitivity(project, function (s) { return s.big === true; });
  assert.deepEqual(res.excluded, ["s2"]);
  close(res.run.pooled.effect, 0.7, "mean of 0.5 and 0.9");
});

test("sensitivity: validation errors", function () {
  const project = genProject([
    { id: "s1", yi: 0.5, se: 0.2 },
    { id: "s2", yi: 0.7, se: 0.2 },
    { id: "s3", yi: 0.9, se: 0.2 }
  ], "fixed");
  assert.throws(function () { ENGINE.sensitivity(project, "s3"); }, /array of study ids or an exclusion function/);
  assert.throws(function () { ENGINE.sensitivity(project, ["s1", "s2"]); }, /fewer than two/);
});

/* ---- egger -------------------------------------------------------------- */

test("egger: weighted lm of yi on sei (k = 10), values from R", function () {
  /* sei x_i = 1..10, yi = 1 + 2 x_i + (+1, -1 alternating). Reference:
   * R 4.6.2 lm(yi ~ x, weights = 1/x^2), the regression regtest(model="lm") fits:
   *   x coefficient 1.79834702743418, se 0.161930332462890, t 11.1056835373713,
   *   p 3.85963175934692e-06; intercept (limit estimate) 1.90890867208489. */
  const studies = [];
  for (let i = 1; i <= 10; i++) {
    studies.push({ id: "e" + i, yi: 1 + 2 * i + (i % 2 === 1 ? 1 : -1), se: i });
  }
  const res = ENGINE.egger(genProject(studies, "fixed"));
  assert.equal(res.k, 10);
  assert.equal(res.df, 8);
  assert.equal(res.predictor, "sei");
  assert.equal(res.model, "lm");
  close(res.slope, 1.79834702743418, "sei coefficient");
  close(res.se, 0.161930332462890, "sei coefficient se");
  close(res.t, 11.1056835373713, "t");
  close(res.est, 1.90890867208489, "limit estimate");
  close(res.p, 3.85963175934692e-06, "p", 1e-9);
  /* Self-consistency with the exposed inverse t CDF. */
  close(ENGINE.tQuantile(1 - res.p / 2, 8), res.t, "t from p", 1e-4);
});

test("egger: refuses k < 10 (publication bias only at 10+ studies)", function () {
  const studies = [];
  for (let i = 1; i <= 9; i++) studies.push({ id: "e" + i, yi: 0.1 * i, se: 0.1 * i });
  assert.throws(function () { ENGINE.egger(genProject(studies, "fixed")); },
    /at least 10 studies \(got 9\)/);
  /* dat.bcg has 13 trials: allowed. */
  const res = ENGINE.egger(bcgProject("fixed"));
  assert.equal(res.k, 13);
  assert.equal(res.df, 11);
  assert.ok(isFinite(res.slope) && isFinite(res.p) && res.p >= 0 && res.p <= 1);
});

test("egger: refuses zero variation in se and exact collinearity", function () {
  const flat = [];
  for (let i = 1; i <= 10; i++) flat.push({ id: "f" + i, yi: 0.1 * i, se: 0.2 });
  assert.throws(function () { ENGINE.egger(genProject(flat, "fixed")); }, /variation in the standard errors/);
  const line = [];
  for (let i = 1; i <= 10; i++) line.push({ id: "l" + i, yi: 0.5 + 2 * (0.1 * i), se: 0.1 * i });
  assert.throws(function () { ENGINE.egger(genProject(line, "fixed")); }, /zero residual variance/);
});

/* ---- funnel ------------------------------------------------------------- */

test("funnel: points and pseudo-95% limit lines for the FE estimate", function () {
  /* Two studies, vi 0.04 each: FE estimate 0.6, se sqrt(0.02), seMax 0.2.
   * Limits at se = 0.2: 0.6 +/- 1.959964*0.2. */
  const project = genProject([
    { id: "s1", yi: 0.5, se: 0.2 },
    { id: "s2", yi: 0.7, se: 0.2 }
  ], "random_dl");
  const res = ENGINE.funnel(project);
  assert.deepEqual(res.points, [
    { id: "s1", yi: 0.5, se: 0.2 },
    { id: "s2", yi: 0.7, se: 0.2 }
  ]);
  close(res.fe.effect, 0.6, "FE reference (independent of the project model)");
  close(res.fe.se, Math.sqrt(0.02), "FE se");
  assert.equal(res.limits.level, 0.95);
  close(res.limits.z, 1.959963984540054, "z", 1e-7);
  assert.equal(res.limits.seFrom, 0);
  close(res.limits.seTo, 0.2, "seTo");
  close(res.limits.lower[0].yi, 0.6, "lower line starts at theta");
  close(res.limits.lower[1].yi, 0.6 - 1.959963984540054 * 0.2, "lower end", 1e-7);
  close(res.limits.upper[1].yi, 0.6 + 1.959963984540054 * 0.2, "upper end", 1e-7);
  assert.equal(res.limits.lower[1].se, 0.2);
});

test("funnel: dat.bcg has 13 points and needs two studies", function () {
  const res = ENGINE.funnel(bcgProject("fixed"));
  assert.equal(res.points.length, 13);
  assert.ok(res.limits.seTo > 0);
  assert.throws(function () {
    ENGINE.funnel(genProject([{ id: "only", yi: 0.5, se: 0.2 }], "fixed"));
  }, /at least two/);
});

/* ---- splitSharedControl -------------------------------------------------- */

test("splitSharedControl: even split, first comparison gets the odd event", function () {
  /* Control 11 events / 100 participants over 2 comparisons:
   * n shares 50/50; event shares 6/5 (11 mod 2 = 1 goes to the first). */
  const out = ENGINE.splitSharedControl({
    control: { events: 11, n: 100 },
    treatments: [
      { id: "t1", events: 20, n: 100 },
      { id: "t2", events: 30, n: 100 }
    ]
  });
  assert.deepEqual(out, [
    { id: "t1", events1: 20, n1: 100, events2: 6, n2: 50 },
    { id: "t2", events1: 30, n1: 100, events2: 5, n2: 50 }
  ]);
});

test("splitSharedControl: odd n and three-way splits keep exact totals", function () {
  /* 75 participants over 2: 38/37; 10 events over 2: 5/5. */
  const two = ENGINE.splitSharedControl({
    control: { events: 10, n: 75 },
    treatments: [{ events: 1, n: 40 }, { events: 2, n: 40 }]
  });
  assert.deepEqual(two.map(function (c) { return c.n2; }), [38, 37]);
  assert.deepEqual(two.map(function (c) { return c.events2; }), [5, 5]);
  /* 75 over 3: 25 each; 10 events over 3: 4/3/3. */
  const three = ENGINE.splitSharedControl({
    control: { events: 10, n: 75 },
    treatments: [{ events: 1, n: 40 }, { events: 2, n: 40 }, { events: 3, n: 40 }]
  });
  assert.deepEqual(three.map(function (c) { return c.n2; }), [25, 25, 25]);
  assert.deepEqual(three.map(function (c) { return c.events2; }), [4, 3, 3]);
  const sumE = three.reduce(function (a, c) { return a + c.events2; }, 0);
  const sumN = three.reduce(function (a, c) { return a + c.n2; }, 0);
  assert.equal(sumE, 10);
  assert.equal(sumN, 75);
  three.forEach(function (c) { assert.ok(c.events2 <= c.n2); });
  /* A single treatment passes the control through unchanged. */
  const one = ENGINE.splitSharedControl({
    control: { events: 7, n: 30 },
    treatments: [{ events: 9, n: 30 }]
  });
  assert.deepEqual(one, [{ events1: 9, n1: 30, events2: 7, n2: 30 }]);
});

test("splitSharedControl: output feeds effectFromRaw directly", function () {
  const out = ENGINE.splitSharedControl({
    control: { events: 11, n: 100 },
    treatments: [{ events: 20, n: 100 }, { events: 30, n: 100 }]
  });
  out.forEach(function (c) {
    const r = ENGINE.effectFromRaw(c, "RR");
    assert.ok(!r.excluded && isFinite(r.yi) && r.vi > 0);
  });
});

test("splitSharedControl: validation errors", function () {
  assert.throws(function () { ENGINE.splitSharedControl(null); }, /control, treatments/);
  assert.throws(function () { ENGINE.splitSharedControl({ treatments: [] }); }, /control arm/);
  assert.throws(function () {
    ENGINE.splitSharedControl({ control: { events: 5, n: 50 }, treatments: [] });
  }, /treatments array/);
  assert.throws(function () {
    ENGINE.splitSharedControl({ control: { events: 60, n: 50 }, treatments: [{ events: 5, n: 50 }] });
  }, /events above n/);
  assert.throws(function () {
    ENGINE.splitSharedControl({ control: { events: 5.5, n: 50 }, treatments: [{ events: 5, n: 50 }] });
  }, /integer events/);
  assert.throws(function () {
    ENGINE.splitSharedControl({ control: { events: 5, n: 0 }, treatments: [{ events: 5, n: 50 }] });
  }, /n >= 1/);
});

/* ---- clusterAdjust ------------------------------------------------------- */

test("clusterAdjust: binary design effect 1 + (m-1)*ICC on n and events", function () {
  /* ICC 0.05, m 10 -> DE = 1 + 9*0.05 = 1.45.
   * n1 = 100/1.45 = 68.96551724..., events1 = 20/1.45 = 13.79310345...
   * Effective counts stay fractional (no rounding). */
  const res = ENGINE.clusterAdjust(
    { id: "c1", events1: 20, n1: 100, events2: 30, n2: 100 }, 0.05, 10);
  close(res.designEffect, 1.45, "DE");
  assert.equal(res.icc, 0.05);
  assert.equal(res.meanClusterSize, 10);
  assert.equal(res.study.id, "c1");
  close(res.study.n1, 100 / 1.45, "effective n1");
  close(res.study.n2, 100 / 1.45, "effective n2");
  close(res.study.events1, 20 / 1.45, "effective events1");
  close(res.study.events2, 30 / 1.45, "effective events2");
  /* Event rates are preserved by the adjustment. */
  close(res.study.events1 / res.study.n1, 0.2, "rate unchanged");
});

test("clusterAdjust: continuous studies divide n only", function () {
  const res = ENGINE.clusterAdjust(
    { mean1: 10, sd1: 2, n1: 100, mean2: 8, sd2: 2, n2: 90 }, 0.1, 5);
  close(res.designEffect, 1.4, "DE = 1 + 4*0.1");
  assert.equal(res.study.mean1, 10);
  assert.equal(res.study.sd1, 2);
  assert.equal(res.study.mean2, 8);
  assert.equal(res.study.sd2, 2);
  close(res.study.n1, 100 / 1.4, "effective n1");
  close(res.study.n2, 90 / 1.4, "effective n2");
});

test("clusterAdjust: ICC 0 or m 1 leaves the study unchanged; validation", function () {
  const s = { events1: 20, n1: 100, events2: 30, n2: 100 };
  const zero = ENGINE.clusterAdjust(s, 0, 10);
  assert.equal(zero.designEffect, 1);
  assert.deepEqual(zero.study, s);
  const m1 = ENGINE.clusterAdjust(s, 0.2, 1);
  assert.equal(m1.designEffect, 1);
  assert.throws(function () { ENGINE.clusterAdjust(s, 1.1, 10); }, /between 0 and 1/);
  assert.throws(function () { ENGINE.clusterAdjust(s, -0.1, 10); }, /between 0 and 1/);
  assert.throws(function () { ENGINE.clusterAdjust(s, 0.05, 0.5); }, /meanClusterSize must be >= 1/);
  assert.throws(function () { ENGINE.clusterAdjust({ foo: 1 }, 0.05, 10); }, /binary .* or continuous/);
});

/* ---- crossoverAdjust ------------------------------------------------------ */

test("crossoverAdjust: reported paired MD and SE pass through", function () {
  const res = ENGINE.crossoverAdjust({ id: "x1", md: 2, se: 0.5 });
  assert.equal(res.id, "x1");
  assert.equal(res.yi, 2);
  close(res.vi, 0.25, "vi");
  close(res.se, 0.5, "se");
  assert.equal(res.method, "paired-reported");
});

test("crossoverAdjust: imputed paired variance from within-patient corr", function () {
  /* Var(MD) = (s1^2 + s2^2 - 2 r s1 s2)/n.
   * s1 = s2 = 2, n 20, r 0.5: (4 + 4 - 4)/20 = 0.2, se = sqrt(0.2).
   * r 0 reproduces the unpaired MD variance (4+4)/20 = 0.4. */
  const half = ENGINE.crossoverAdjust({ mean1: 10, sd1: 2, mean2: 8, sd2: 2, n: 20, corr: 0.5 });
  assert.equal(half.yi, 2);
  close(half.vi, 0.2, "paired vi at r 0.5");
  close(half.se, Math.sqrt(0.2), "paired se");
  assert.equal(half.method, "paired-imputed-corr");
  const zero = ENGINE.crossoverAdjust({ mean1: 10, sd1: 2, mean2: 8, sd2: 2, n: 20, corr: 0 });
  close(zero.vi, 0.4, "r 0 equals unpaired MD vi");
  const md = ENGINE.effectFromRaw({ mean1: 10, sd1: 2, n1: 20, mean2: 8, sd2: 2, n2: 20 }, "MD");
  close(zero.vi, md.vi, "matches effectFromRaw MD at r 0");
});

test("crossoverAdjust: validation errors", function () {
  assert.throws(function () { ENGINE.crossoverAdjust({ md: 2 }); }, /se alongside md/);
  assert.throws(function () { ENGINE.crossoverAdjust({ md: 2, se: 0 }); }, /se > 0/);
  assert.throws(function () {
    ENGINE.crossoverAdjust({ mean1: 10, sd1: 2, mean2: 8, sd2: 2, n: 20, corr: 1 });
  }, /non-positive paired variance/);
  assert.throws(function () {
    ENGINE.crossoverAdjust({ mean1: 10, sd1: 2, mean2: 8, sd2: 2, n: 20, corr: 1.5 });
  }, /between -1 and 1/);
  assert.throws(function () {
    ENGINE.crossoverAdjust({ mean1: 10, sd1: 2, mean2: 8, sd2: 2, n: 20 });
  }, /corr must be a finite number/);
});

/* ---- Wan et al. 2014 conversions ------------------------------------------ */

test("medianToMean: Wan 2014 S2 hand arithmetic", function () {
  /* q1 4, median 6, q3 9, n 50:
   * mean = (4+6+9)/3 = 19/3 = 6.333333...
   * SD = (9-4) / (2 * qnorm((0.75*50 - 0.125)/(50 + 0.25)))
   *    = 5 / (2 * qnorm(37.375/50.25)) = 5 / (2 * qnorm(0.7437810945))
   * qnorm(0.7437810945) = 0.6550465079 (Acklam inverse normal, |err| < 1.2e-9)
   * SD = 5 / 1.3100930159 = 3.8165229030. */
  const res = ENGINE.medianToMean(4, 6, 9, 50);
  close(res.mean, 19 / 3, "S2 mean");
  close(res.sd, 3.816522902957336, "S2 sd", 1e-6);
  assert.equal(res.method, "wan2014-s2-iqr");
});

test("medianToMean: large-n limit approaches IQR / 1.349", function () {
  /* As n grows, (0.75n - 0.125)/(n + 0.25) -> 0.75 and
   * qnorm(0.75) = 0.6744897502, so SD -> (q3-q1)/(2*0.6744897502). */
  const res = ENGINE.medianToMean(4, 6, 9, 100000);
  close(res.sd, 5 / (2 * 0.6744897501960817), "large-n S2 sd", 1e-3);
});

test("rangeToMean: Wan 2014 S1 hand arithmetic", function () {
  /* min 2, median 6, max 14, n 50:
   * mean = (2 + 2*6 + 14)/4 = 28/4 = 7.
   * SD = (14-2) / (2 * qnorm((50 - 0.375)/(50 + 0.25)))
   *    = 12 / (2 * qnorm(49.625/50.25)) = 12 / (2 * qnorm(0.9875621891))
   * qnorm(0.9875621891) = 2.2433287619 (Acklam, |err| < 1.2e-9)
   * SD = 12 / 4.4866575239 = 2.6745968321. */
  const res = ENGINE.rangeToMean(2, 6, 14, 50);
  close(res.mean, 7, "S1 mean");
  close(res.sd, 2.674596832081883, "S1 sd", 1e-6);
  assert.equal(res.method, "wan2014-s1-range");
});

test("Wan conversions: validation errors", function () {
  assert.throws(function () { ENGINE.medianToMean(7, 6, 9, 50); }, /q1 <= median <= q3/);
  assert.throws(function () { ENGINE.medianToMean(4, 10, 9, 50); }, /q1 <= median <= q3/);
  assert.throws(function () { ENGINE.medianToMean(4, 6, 9, 1); }, /integer n >= 2/);
  assert.throws(function () { ENGINE.medianToMean(4, 6, 9, 2.5); }, /integer n >= 2/);
  assert.throws(function () { ENGINE.medianToMean(6, 6, 6, 50); }, /q3 > q1/);
  assert.throws(function () { ENGINE.medianToMean(4, 6, NaN, 50); }, /finite/);
  assert.throws(function () { ENGINE.rangeToMean(3, 2, 14, 50); }, /min <= median <= max/);
  assert.throws(function () { ENGINE.rangeToMean(6, 6, 6, 50); }, /max > min/);
  assert.throws(function () { ENGINE.rangeToMean(2, 6, 14, 0); }, /integer n >= 2/);
});

test("normalQuantile calibration (used by the Wan denominators)", function () {
  close(ENGINE.normalQuantile(0.75), 0.6744897501960817, "qnorm 0.75", 1e-7);
  close(ENGINE.normalQuantile(0.975), 1.959963984540054, "qnorm 0.975", 1e-7);
  close(ENGINE.normalQuantile(0.5), 0, "qnorm 0.5", 1e-12);
});
