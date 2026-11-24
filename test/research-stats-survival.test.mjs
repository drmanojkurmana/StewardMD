/* Kaplan-Meier, log-rank and Cox against R 4.6.2 (survival).
 * Fixtures are survival::lung and survival::veteran (teaching data, not patients).
 * lung status in the fixture is already recoded to 0 = censored, 1 = event.
 * Relative tolerance 1e-4. p values also pass at an absolute floor of 1e-10.
 * Run: node --test test/research-stats-survival.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");

const PH = "Hazard ratios assume the effect stays the same over time.";

function closeRel(actual, expected, label) {
  if (expected == null) {
    assert.equal(actual, null, label + " should be null");
    return;
  }
  assert.equal(typeof actual, "number", label);
  assert.ok(Number.isFinite(actual), label + " not finite: " + actual);
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(Math.abs(expected), 1e-15);
  assert.ok(rel <= 1e-4, label + ": got " + actual + ", want " + expected + ", rel " + rel);
}

function closeP(actual, expected, label) {
  assert.equal(typeof actual, "number", label);
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(Math.abs(expected), 1e-15);
  assert.ok(rel <= 1e-4 || abs <= 1e-10, label + ": got " + actual + ", want " + expected + ", abs " + abs + ", rel " + rel);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let i;
  for (i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\"") {
        if (text[i + 1] === "\"") { cell += "\""; i += 1; }
        else quoted = false;
      } else cell += c;
    } else if (c === "\"") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") {
      row.push(cell);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function loadCsv(name) {
  const text = readFileSync(new URL("./fixtures/survival/" + name, import.meta.url), "utf8");
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map(function (cells) {
    const obj = {};
    header.forEach(function (h, idx) { obj[h] = cells[idx] == null ? "" : cells[idx]; });
    return obj;
  });
}

function numOrNull(s) {
  if (s == null || s === "" || s === "NA" || s === "NaN") return null;
  return Number(s);
}

function lungTable() {
  return loadCsv("lung.csv").map(function (r) {
    return {
      time: r.time === "" ? null : Number(r.time),
      status: r.status === "" ? null : Number(r.status),
      age: r.age === "" ? null : Number(r.age),
      sex: r.sex === "" ? null : Number(r.sex),
      "ph.ecog": r["ph.ecog"] === "" ? null : Number(r["ph.ecog"])
    };
  });
}

function veteranTable() {
  return loadCsv("veteran.csv").map(function (r) {
    return {
      time: Number(r.time),
      status: Number(r.status),
      trt: Number(r.trt),
      celltype: r.celltype
    };
  });
}

function assertNoPh(warnings, label) {
  (warnings || []).forEach(function (w) {
    assert.equal(w.indexOf(PH), -1, label + " must not carry the proportional hazards reminder");
  });
}

function coef(fit, predictor, level) {
  const hit = fit.coefficients.filter(function (c) {
    return c.predictor === predictor && c.level === level;
  });
  assert.equal(hit.length, 1, predictor + " " + level);
  return hit[0];
}

function assertCoef(fit, predictor, level, want) {
  const c = coef(fit, predictor, level);
  closeRel(c.beta, want.beta, predictor + " beta");
  closeRel(c.se, want.se, predictor + " se");
  closeRel(c.hr, want.hr, predictor + " hr");
  closeRel(c.ciLower, want.lo, predictor + " lo");
  closeRel(c.ciUpper, want.hi, predictor + " hi");
  closeRel(c.z, want.z, predictor + " z");
  closeP(c.p, want.p, predictor + " p");
  assert.equal(c.estimable, true);
}

function assertFit(fit, want) {
  assert.equal(fit.ok, true);
  assert.equal(fit.converged, true);
  assert.equal(fit.n, want.n);
  assert.equal(fit.nEvents, want.events);
  assert.equal(fit.iterations, want.iter);
  closeRel(fit.logLik, want.logLik, "logLik");
  assert.ok(fit.lrTest);
  closeRel(fit.lrTest.chi2, want.lrChi, "lr chi");
  assert.equal(fit.lrTest.df, want.lrDf);
  closeP(fit.lrTest.p, want.lrP, "lr p");
  assertNoPh(fit.warnings, "cox");
}

test("Kaplan-Meier steps match the R fixtures for log, log-log and plain", function () {
  const lung = lungTable();
  const times = lung.map(function (r) { return r.time; });
  const events = lung.map(function (r) { return r.status; });
  const files = { log: "km-lung-log.csv", "log-log": "km-lung-loglog.csv", plain: "km-lung-plain.csv" };
  const medians = {
    log: { value: 310, lower: 285, upper: 363 },
    "log-log": { value: 310, lower: 284, upper: 361 },
    plain: { value: 310, lower: 284, upper: 361 }
  };
  Object.keys(files).forEach(function (confType) {
    const fit = STATS.kaplanMeier(times, events, null, { confType: confType });
    assert.equal(fit.ok, true, confType);
    assert.equal(fit.nExcluded, 0, confType);
    assert.equal(fit.groups.length, 1);
    const g = fit.groups[0];
    assert.equal(g.name, "All");
    assert.equal(g.n, 228);
    assert.equal(g.nEvents, 165);
    const want = loadCsv(files[confType]);
    assert.equal(g.steps.length, want.length, confType + " step count");
    g.steps.forEach(function (step, i) {
      const w = want[i];
      const tag = confType + " t " + w.t;
      assert.equal(step.t, Number(w.t), tag);
      assert.equal(step.atRisk, Number(w.atRisk), tag);
      assert.equal(step.events, Number(w.events), tag);
      assert.equal(step.censored, Number(w.censored), tag);
      closeRel(step.survival, numOrNull(w.survival), tag + " survival");
      closeRel(step.seLogS, numOrNull(w.seLogS), tag + " seLogS");
      closeRel(step.ciLower, numOrNull(w.ciLower), tag + " ciLower");
      closeRel(step.ciUpper, numOrNull(w.ciUpper), tag + " ciUpper");
    });
    assert.equal(g.median.value, medians[confType].value);
    assert.equal(g.median.lower, medians[confType].lower);
    assert.equal(g.median.upper, medians[confType].upper);
    assertNoPh(fit.warnings, confType);
  });
});

test("Kaplan-Meier median rules and null limits where n equals events", function () {
  function med(times, events, confType) {
    const fit = STATS.kaplanMeier(times, events, null, { confType: confType || "log" });
    assert.equal(fit.ok, true);
    return fit.groups[0];
  }
  let g = med([10, 30], [1, 1]);
  assert.equal(g.median.value, 20);
  assert.equal(g.median.lower, 10);
  assert.equal(g.median.upper, null);
  g = med([10, 20, 30], [1, 0, 1]);
  assert.equal(g.median.value, 30);
  assert.equal(g.median.lower, 10);
  assert.equal(g.median.upper, null);
  g = med([10, 40], [1, 0]);
  assert.equal(g.median.value, 25);
  assert.equal(g.median.lower, 10);
  assert.equal(g.median.upper, null);
  g = med([1, 2, 3, 4], [1, 1, 0, 0]);
  assert.equal(g.median.value, 3);
  assert.equal(g.median.lower, 1);
  assert.equal(g.median.upper, null);
  g = med([1, 2, 3, 10], [1, 1, 0, 1]);
  assert.equal(g.median.value, 6);
  assert.equal(g.median.lower, 1);
  assert.equal(g.median.upper, null);

  g = med([5, 5, 5, 8, 10], [1, 0, 1, 0, 1], "log");
  assert.deepEqual(g.steps.map(function (s) { return s.t; }), [5, 8, 10]);
  assert.deepEqual(g.steps.map(function (s) { return s.atRisk; }), [5, 2, 1]);
  assert.deepEqual(g.steps.map(function (s) { return s.events; }), [2, 0, 1]);
  assert.deepEqual(g.steps.map(function (s) { return s.censored; }), [1, 1, 0]);
  closeRel(g.steps[0].survival, 0.6, "tie surv");
  closeRel(g.steps[1].survival, 0.6, "tie surv 8");
  closeRel(g.steps[2].survival, 0, "tie surv 10");
  closeRel(g.steps[0].seLogS, Math.sqrt(2 / 15), "tie se");
  assert.equal(g.steps[2].seLogS, null);
  closeRel(g.steps[0].ciLower, 0.29331643163832644, "tie log lo");
  closeRel(g.steps[0].ciUpper, 1, "tie log hi");
  assert.equal(g.steps[2].ciLower, null);
  assert.equal(g.steps[2].ciUpper, null);
  assert.equal(g.median.value, 10);
  assert.equal(g.median.lower, 5);
  assert.equal(g.median.upper, null);

  g = med([5, 5, 5, 8, 10], [1, 0, 1, 0, 1], "log-log");
  closeRel(g.steps[0].ciLower, 0.12573018299443153, "loglog lo");
  closeRel(g.steps[0].ciUpper, 0.88175640739353223, "loglog hi");
  assert.equal(g.steps[2].ciLower, null);
  assert.equal(g.steps[2].ciUpper, null);

  g = med([5, 5, 5, 8, 10], [1, 0, 1, 0, 1], "plain");
  closeRel(g.steps[0].ciLower, 0.17059340550788243, "plain lo");
  closeRel(g.steps[0].ciUpper, 1, "plain hi");
  assert.equal(g.steps[2].ciLower, null);
  assert.equal(g.median.value, 10);
  assert.equal(g.median.lower, 5);
  assert.equal(g.median.upper, null);
});

test("log-rank on lung by sex matches survdiff rho = 0", function () {
  const lung = lungTable();
  const fit = STATS.logRank(
    lung.map(function (r) { return r.time; }),
    lung.map(function (r) { return r.status; }),
    lung.map(function (r) { return r.sex; })
  );
  assert.equal(fit.ok, true);
  assert.equal(fit.df, 1);
  closeRel(fit.chi2, 10.326741954885632, "chi2");
  closeP(fit.p, 0.0013111645203554892, "logrank p");
  assert.equal(fit.table.length, 2);
  const a = fit.table[0];
  const b = fit.table[1];
  assert.equal(a.group, "1");
  assert.equal(b.group, "2");
  assert.equal(a.n, 138);
  assert.equal(b.n, 90);
  assert.equal(a.observed, 112);
  assert.equal(b.observed, 53);
  closeRel(a.expected, 91.581739029572802, "exp 1");
  closeRel(b.expected, 73.418260970427212, "exp 2");
  assertNoPh(fit.warnings, "logrank");
});

test("Kaplan-Meier by sex uses the log confidence limits", function () {
  const lung = lungTable();
  const fit = STATS.kaplanMeier(
    lung.map(function (r) { return r.time; }),
    lung.map(function (r) { return r.status; }),
    lung.map(function (r) { return r.sex; }),
    { confType: "log" }
  );
  const g1 = fit.groups.filter(function (g) { return g.name === "1"; })[0];
  const g2 = fit.groups.filter(function (g) { return g.name === "2"; })[0];
  assert.equal(g1.n, 138);
  assert.equal(g1.nEvents, 112);
  assert.equal(g1.median.value, 270);
  assert.equal(g1.median.lower, 212);
  assert.equal(g1.median.upper, 310);
  assert.equal(g2.n, 90);
  assert.equal(g2.nEvents, 53);
  assert.equal(g2.median.value, 426);
  assert.equal(g2.median.lower, 348);
  assert.equal(g2.median.upper, 550);
});

test("Cox Efron and Breslow on lung and veteran", function () {
  const lung = lungTable();
  const vet = veteranTable();
  const sex = { name: "sex", type: "numeric" };
  const age = { name: "age", type: "numeric" };
  const ph = { name: "ph.ecog", type: "numeric" };
  const trt = { name: "trt", type: "numeric" };
  const cell = { name: "celltype", type: "categorical", reference: "squamous" };

  const sexE = STATS.cox(lung, { time: "time", event: "status", predictors: [sex], ties: "efron" });
  assertFit(sexE, {
    n: 228, events: 165, iter: 3, logLik: -744.59299902495457,
    lrChi: 10.633604730880279, lrDf: 1, lrP: 0.0011105103779009624
  });
  assert.equal(sexE.nExcluded, 0);
  assertCoef(sexE, "sex", null, {
    beta: -0.53102353761950816, se: 0.16717858323075435, hr: 0.58800281856358849,
    lo: 0.42371783035391469, hi: 0.8159848131713866, z: -3.1763849612635102, p: 0.0014912292048807623
  });

  const sexB = STATS.cox(lung, { time: "time", event: "status", predictors: [sex], ties: "breslow" });
  assertFit(sexB, {
    n: 228, events: 165, iter: 3, logLik: -744.81818274537522,
    lrChi: 10.607672299887099, lrDf: 1, lrP: 0.0011261937457322632
  });
  assertCoef(sexB, "sex", null, {
    beta: -0.53039657450933453, se: 0.16718083738578801, hr: 0.58837159023054175,
    lo: 0.42398169591631313, hi: 0.81650017329697866, z: -3.1725919238302809, p: 0.0015108472157001039
  });

  const multiE = STATS.cox(lung, { time: "time", event: "status", predictors: [age, sex, ph], ties: "efron" });
  assertFit(multiE, {
    n: 227, events: 164, iter: 3, logLik: -729.23012137486194,
    lrChi: 30.500668773156576, lrDf: 3, lrP: 1.0828176991986987e-06
  });
  assert.equal(multiE.nExcluded, 1);
  assert.equal(multiE.warnings.indexOf("1 rows were left out because the time or event value was missing or invalid."), -1);
  assertCoef(multiE, "age", null, {
    beta: 0.011066764560073482, se: 0.0092674110137005283, hr: 1.0111282277225162,
    lo: 0.99292809716985009, hi: 1.0296619622421546, z: 1.1941592472496223, p: 0.23241568099961177
  });
  assertCoef(multiE, "sex", null, {
    beta: -0.55261239570363108, se: 0.1677390537872635, hr: 0.57544455619049184,
    lo: 0.41421301854917242, hi: 0.79943512738714639, z: -3.2944766482615702, p: 0.00098605137213844955
  });
  assertCoef(multiE, "ph.ecog", null, {
    beta: 0.46372847537042761, se: 0.11357726616199662, hr: 1.5899911900542845,
    lo: 1.2726751777742971, hi: 1.9864235812875901, z: 4.0829339448002395, p: 4.4470666518568141e-05
  });

  const multiB = STATS.cox(lung, { time: "time", event: "status", predictors: [age, sex, ph], ties: "breslow" });
  assertFit(multiB, {
    n: 227, events: 164, iter: 3, logLik: -729.48870517677403,
    lrChi: 30.408228178773697, lrDf: 3, lrP: 1.1324237644499274e-06
  });
  assertCoef(multiB, "age", null, {
    beta: 0.011041136349488504, se: 0.0092667701135355496, hr: 1.0111023146474221,
    lo: 0.99290389775230847, hi: 1.0296342808198, z: 1.1914762332736859, p: 0.23346668140113414
  });
  assertCoef(multiB, "sex", null, {
    beta: -0.55188956978759729, se: 0.16774244802101848, hr: 0.57586065279353427,
    lo: 0.41450977312136023, hi: 0.80001851087526699, z: -3.2901008438749169, p: 0.0010015148278656326
  });
  assertCoef(multiB, "ph.ecog", null, {
    beta: 0.46294704059016395, se: 0.11357405206130104, hr: 1.5887492009679982,
    lo: 1.2716890646061028, hi: 1.9848594234458432, z: 4.0761690913369062, p: 4.5783731467028622e-05
  });

  const vetE = STATS.cox(vet, { time: "time", event: "status", predictors: [trt, cell], ties: "efron" });
  assertFit(vetE, {
    n: 137, events: 128, iter: 4, logLik: -492.52033198932884,
    lrChi: 25.857445857458288, lrDf: 4, lrP: 3.3809463045307854e-05
  });
  assertCoef(vetE, "trt", null, {
    beta: 0.19780141649626792, se: 0.19681974597175839, hr: 1.2187203520321088,
    lo: 0.82864934649196775, hi: 1.7924099050401703, z: 1.0049876627960408, p: 0.31490279052967207
  });
  assertCoef(vetE, "celltype", "adeno", {
    beta: 1.1688735944269255, se: 0.29500372094178678, hr: 3.2183654113120479,
    lo: 1.8052099956096375, hi: 5.7377678751616985, z: 3.9622333938546483, p: 7.4251901049859093e-05
  });
  assertCoef(vetE, "celltype", "large", {
    beta: 0.29704935339374317, se: 0.28567704199791943, hr: 1.3458817216395436,
    lo: 0.76884386989752285, hi: 2.3560018874636515, z: 1.0398082790142673, p: 0.2984289819635389
  });
  assertCoef(vetE, "celltype", "smallcell", {
    beta: 1.0964417726414171, se: 0.27248502340082531, hr: 2.9934955135196262,
    lo: 1.7548457133799031, hi: 5.1064405953973342, z: 4.0238606840000593, p: 5.7251792670647759e-05
  });
  assert.equal(vetE.coefficients.some(function (c) { return c.level === "squamous"; }), false);

  const vetB = STATS.cox(vet, { time: "time", event: "status", predictors: [trt, cell], ties: "breslow" });
  assertFit(vetB, {
    n: 137, events: 128, iter: 4, logLik: -493.10855051769903,
    lrChi: 25.550811530833926, lrDf: 4, lrP: 3.8977696729233955e-05
  });
  assertCoef(vetB, "trt", null, {
    beta: 0.19481584056589824, se: 0.19667904874896233, hr: 1.2150871961133882,
    lo: 0.82640690020522112, hi: 1.7865737735152658, z: 0.99052665652536143, p: 0.32191676658379786
  });
  assertCoef(vetB, "celltype", "adeno", {
    beta: 1.1623900508497687, se: 0.29497500397552756, hr: 3.1975664971130056,
    lo: 1.7936446493264375, hi: 5.7003662945718307, z: 3.9406391564832584, p: 8.1264791983409857e-05
  });
  assertCoef(vetB, "celltype", "large", {
    beta: 0.2960428095498488, se: 0.28566634015110531, hr: 1.3445277142262462,
    lo: 0.76808649479755919, hi: 2.3535822938781332, z: 1.0363237383629265, p: 0.30005113515225207
  });
  assertCoef(vetB, "celltype", "smallcell", {
    beta: 1.0899415641607186, se: 0.27239007077115868, hr: 2.9741002734394804,
    lo: 1.7438003412466161, hi: 5.0724112315228957, z: 4.0013997612872032, p: 6.2968869966280151e-05
  });
});

test("chooseTest offers Kaplan-Meier with log-rank test for survival", function () {
  const pick = STATS.chooseTest({ outcomeType: "survival" });
  assert.equal(pick.test, "log_rank");
  assert.equal(pick.label, "Kaplan-Meier with log-rank test");
  assert.equal(pick.why, "(compares time to the event between groups)");
  assert.equal(pick.ok, true);
  assert.deepEqual(pick.warnings, []);
});
