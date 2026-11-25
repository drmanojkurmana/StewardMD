/* Exact edge-case messages for the survival, matched-odds and sample-size engines.
 * The describe-mode sentence ("With so few patients...") belongs to item 3.
 * describe() is unchanged here and is not asserted.
 * Run: node --test test/research-stats-edge.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
const SS = require("../research-samplesize.js");
const RAND = require("../research-randomise.js");

const NO_ONE = "No one in group N had the event, so median survival is not reached.";
const NO_EVENTS = "No events yet, so the groups cannot be compared.";
const SMALL = "Group A has only 3 patients; treat these numbers as unreliable.";
const LEFT_OUT = "1 rows were left out because the time or event value was missing or invalid.";
const NOT_SETTLED = "The model did not settle on an answer. Do not report a hazard ratio; ask your statistician.";
const SEPARATION = "One group had no events (or only events), so its hazard ratio cannot be estimated.";
const TOO_FEW = "Too few events for this many factors; use fewer factors.";
const NO_PAIRS = "No pairs differ in exposure, so the matched odds ratio cannot be calculated.";
const OR_HUGE = "The odds ratio is very large; report only the lower limit.";
const OR_WIDE = "Very few pairs differ; the interval is wide.";
const OR_RANGE = "The odds ratio must differ from 1 and exposure must be between 0% and 100%.";
const HR_ONE = "A hazard ratio of 1 means no difference; choose the smallest difference that matters.";
const BLOCK = "Block size 4 cannot split 2:1; use 3 or 6.";

function rowsOf(times, events, extra) {
  return times.map(function (t, i) {
    const row = { time: t, event: events[i] };
    if (extra) Object.keys(extra).forEach(function (k) { row[k] = extra[k][i]; });
    return row;
  });
}

test("no events in a group keeps survival at 1 and names that group", function () {
  const fit = STATS.kaplanMeier([1, 2, 3, 4], [0, 0, 0, 1], ["N", "N", "N", "B"]);
  assert.equal(fit.ok, true);
  const quiet = fit.groups.filter(function (g) { return g.name === "N"; })[0];
  assert.equal(quiet.steps[quiet.steps.length - 1].survival, 1);
  assert.equal(quiet.median.value, null);
  assert.ok(fit.warnings.indexOf(NO_ONE) >= 0);
  assert.equal(fit.warnings.join(" ").indexOf("3o one"), -1);
});

test("no events at all blocks log-rank and Cox", function () {
  const lr = STATS.logRank([1, 2, 3], [0, 0, 0], ["A", "A", "B"]);
  assert.equal(lr.ok, false);
  assert.deepEqual(lr.warnings.filter(function (w) { return w === NO_EVENTS; }), [NO_EVENTS]);
  assert.equal(lr.chi2, null);
  const cx = STATS.cox(
    rowsOf([1, 2, 3, 4], [0, 0, 0, 0], { x: [1, 2, 3, 4] }),
    { time: "time", event: "event", predictors: [{ name: "x", type: "numeric" }] }
  );
  assert.equal(cx.ok, false);
  assert.ok(cx.warnings.indexOf(NO_EVENTS) >= 0);
  assert.equal(cx.coefficients.length, 0);
});

test("a group under 5 patients is still computed and warned", function () {
  const fit = STATS.kaplanMeier([1, 2, 4], [1, 0, 1], ["A", "A", "A"]);
  assert.equal(fit.ok, true);
  assert.ok(fit.groups[0].steps.length > 0);
  assert.ok(fit.warnings.indexOf(SMALL) >= 0);
  assert.equal(fit.groups[0].median.value, 4);
  const lr = STATS.logRank([1, 2, 4, 5, 6, 7], [1, 0, 1, 1, 0, 1], ["A", "A", "A", "B", "B", "B"]);
  assert.equal(lr.ok, true);
  assert.ok(lr.warnings.indexOf(SMALL) >= 0);
  assert.equal(typeof lr.chi2, "number");
});

test("bad time or event rows are counted with the exact sentence", function () {
  const fit = STATS.kaplanMeier([1, -1, 3], [1, 1, "maybe"], ["A", "A", "A"]);
  assert.equal(fit.ok, true);
  assert.equal(fit.nExcluded, 2);
  assert.ok(fit.warnings.indexOf("2 rows were left out because the time or event value was missing or invalid.") >= 0);
  const one = STATS.kaplanMeier([1, ""], [1, 1]);
  assert.ok(one.warnings.indexOf(LEFT_OUT) >= 0);
  const grouped = STATS.kaplanMeier([1, 2, 3], [1, 1, 1], ["A", null, "A"]);
  assert.equal(grouped.nExcluded, 1);
  assert.equal(grouped.warnings.indexOf(LEFT_OUT), -1);
});

test("Cox that does not settle hides the hazard ratio", function () {
  const lung = readFileSync(new URL("./fixtures/survival/lung.csv", import.meta.url), "utf8").trim().split("\n").slice(1);
  const rows = lung.map(function (line) {
    const c = line.split(",");
    return { time: Number(c[0]), event: Number(c[1]), sex: Number(c[3]) };
  });
  const fit = STATS.cox(rows, {
    time: "time",
    event: "event",
    predictors: [{ name: "sex", type: "numeric" }],
    maxIter: 1
  });
  assert.equal(fit.ok, false);
  assert.equal(fit.converged, false);
  assert.equal(fit.iterations, 1);
  assert.ok(fit.warnings.indexOf(NOT_SETTLED) >= 0);
  assert.equal(fit.lrTest, null);
  fit.coefficients.forEach(function (c) {
    assert.equal(c.hr, null);
    assert.equal(c.estimable, false);
  });
});

test("Cox separation hides the hazard ratio and stays ok", function () {
  const rows = [];
  let i;
  for (i = 0; i < 20; i++) rows.push({ time: i + 1, event: 1, grp: "A" });
  for (i = 0; i < 20; i++) rows.push({ time: 30 + i, event: 0, grp: "B" });
  const fit = STATS.cox(rows, {
    time: "time",
    event: "event",
    predictors: [{ name: "grp", type: "categorical", reference: "A" }]
  });
  assert.equal(fit.ok, true);
  assert.equal(fit.converged, false);
  assert.ok(fit.warnings.indexOf(SEPARATION) >= 0);
  assert.equal(fit.warnings.indexOf(NOT_SETTLED), -1);
  const term = fit.coefficients.filter(function (c) { return c.level === "B"; })[0];
  assert.ok(term);
  assert.equal(term.estimable, false);
  assert.equal(term.hr, null);
  assert.equal(term.p, null);
});

test("fewer than 10 events per Cox factor warns and still returns a ratio", function () {
  const rows = [];
  let i;
  for (i = 0; i < 12; i++) rows.push({ time: i + 1, event: i % 2 === 0 ? 1 : 0, x: i % 3 });
  const fit = STATS.cox(rows, {
    time: "time",
    event: "event",
    predictors: [{ name: "x", type: "numeric" }]
  });
  assert.equal(fit.ok, true, JSON.stringify(fit.warnings));
  assert.ok(fit.warnings.indexOf(TOO_FEW) >= 0);
  assert.equal(fit.converged, true);
  assert.equal(typeof fit.coefficients[0].hr, "number");
  assert.ok(Number.isFinite(fit.coefficients[0].hr));
});

test("matched odds ratio edge messages", function () {
  const none = STATS.matchedOr({ b: 0, c: 0 });
  assert.equal(none.ok, false);
  assert.deepEqual(none.warnings, [NO_PAIRS]);
  const huge = STATS.matchedOr({ b: 12, c: 0 });
  assert.equal(huge.ok, true);
  assert.equal(huge.or, Infinity);
  assert.equal(huge.ciUpper, Infinity);
  assert.ok(huge.warnings.indexOf(OR_HUGE) >= 0);
  assert.equal(huge.warnings.indexOf(OR_WIDE), -1);
  const wide = STATS.matchedOr({ b: 3, c: 2 });
  assert.equal(wide.ok, true);
  assert.ok(wide.warnings.indexOf(OR_WIDE) >= 0);
  assert.equal(wide.warnings.indexOf(NO_PAIRS), -1);
});

test("case-control and log-rank sample size reject a null effect", function () {
  assert.deepEqual(SS.caseControl({ p0: 0.4, or: 1 }).warnings, [OR_RANGE]);
  assert.equal(SS.caseControl({ p0: 0.4, or: 1 }).ok, false);
  assert.deepEqual(SS.caseControl({ p0: 0, or: 2 }).warnings, [OR_RANGE]);
  assert.deepEqual(SS.caseControl({ p0: 1, or: 2 }).warnings, [OR_RANGE]);
  assert.deepEqual(SS.caseControl({ p0: 1.2, or: 2 }).warnings, [OR_RANGE]);
  assert.deepEqual(SS.logRankEvents({ hr: 1 }).warnings, [HR_ONE]);
  assert.equal(SS.logRankEvents({ hr: 1 }).ok, false);
});

test("a block size that cannot split the ratio is refused", function () {
  const fit = RAND.blockList({ n: 12, arms: ["A", "B"], ratio: [2, 1], blockSizes: [4], seed: "s" });
  assert.equal(fit.ok, false);
  assert.deepEqual(fit.warnings, [BLOCK]);
  assert.equal(fit.csv, "");
  assert.deepEqual(fit.rows, []);
});

test("bad shapes return ok false and do not throw", function () {
  assert.equal(STATS.kaplanMeier([1, 2], [1]).ok, false);
  assert.deepEqual(STATS.kaplanMeier([1, 2], [1]).warnings, []);
  assert.equal(STATS.logRank("no").ok, false);
  assert.equal(STATS.cox([{ time: 1, event: 1 }], { time: "time", event: "event", predictors: [], ties: "efron" }).ok, false);
  assert.equal(STATS.matchedOr({ b: -1, c: 2 }).ok, false);
  assert.deepEqual(STATS.matchedOr({ b: -1, c: 2 }).warnings, []);
  assert.equal(SS.caseControl().ok, false);
  assert.deepEqual(SS.caseControl().warnings, []);
  assert.equal(RAND.blockList().ok, false);
  const src = readFileSync(new URL("../research-stats.js", import.meta.url), "utf8")
    + readFileSync(new URL("../research-samplesize.js", import.meta.url), "utf8");
  ["=>", "let ", "const ", "class ", "`", "async ", "\u2014", "\u2013"].forEach(function (tok) {
    assert.equal(src.indexOf(tok), -1, tok);
  });
});
