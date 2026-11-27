/* ResearchMD R parity for JS on-device statistics (research-stats.js) against
 * epiR and tableone:
 *   - 2x2 tables: risk ratio (Katz log CI), odds ratio (Woolf CI), and the
 *     Yates chi-square or Fisher exact p, against epiR::epi.2by2.
 *   - Table 1 by group: per-group n, mean, SD, median, IQR and Shapiro-Wilk p
 *     (describe), the group test p (compare: Welch t, classic ANOVA,
 *     Mann-Whitney, Kruskal-Wallis, chi-square, Fisher), and the rendered
 *     Table 1 cells (table1), against tableone::CreateTableOne.
 *   - Mann-Whitney U and p against stats::wilcox.test.
 *
 * Compares against test/fixtures/research/parity-epi.json, generated in CI by
 * scripts/research-parity-epi.R (R + epiR + tableone). Never committed, never
 * faked: when absent this file SKIPS with a message saying how to generate it.
 *
 * Numeric gate: abs diff <= 1e-4 OR rel diff <= 1e-4 (p < 1e-6 checks < 1e-6).
 * Rendered Table 1 cells are rounded to 1 decimal place, so they are checked
 * within half a unit of the last shown digit.
 *
 * One known, deliberate difference: with tied values and both groups under 50,
 * the app's Mann-Whitney p is an exact permutation p, while R's wilcox.test
 * falls back to a normal approximation. Those cases are listed, not compared.
 *
 * Run: node --test test/research-stats-parity-epi.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
const PARITY_PATH = new URL("./fixtures/research/parity-epi.json", import.meta.url);

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

/* A rounded cell is right when it is within half a unit of its last digit. */
function closeShown(shown, expected, decimals, label) {
  const tol = 0.5 * Math.pow(10, -decimals) + 1e-6;
  assert.ok(Math.abs(shown - expected) <= tol,
    label + ": shows " + shown + ", R gives " + expected + " (allowed " + tol + ")");
}

function decimalsOf(text) {
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function checkShownP(text, expected, label) {
  if (text === "p < 0.001") {
    assert.ok(expected < 0.001 + 1e-6, label + ": shows p < 0.001 but R gives " + expected);
    return;
  }
  const m = /^p = (\d+(?:\.\d+)?)$/.exec(text);
  assert.ok(m, label + ": unexpected p text " + JSON.stringify(text));
  closeShown(Number(m[1]), expected, decimalsOf(m[1]), label);
}

const NUM = "(-?\\d+(?:\\.\\d+)?)";
const MEAN_SD = new RegExp("^" + NUM + " ± " + NUM + "$");
const MEDIAN_IQR = new RegExp("^" + NUM + " \\(" + NUM + " to " + NUM + "\\)$");
const COUNT_PCT = new RegExp("^(\\d+) \\(" + NUM + "%\\)$");

function groupValues(set, name) {
  const g = set.columns[set.group];
  const out = [];
  for (let i = 0; i < g.length; i++) if (name === "Overall" || g[i] === name) out.push(i);
  return out;
}

if (!existsSync(PARITY_PATH)) {
  test("epiR and tableone R parity (skipped: parity-epi.json absent)", function (t) {
    t.skip("parity-epi.json is absent: generate it with " +
      "`R_LIBS_USER=~/Library/R/library Rscript scripts/research-parity-epi.R` " +
      "(needs R + epiR + tableone; see the parity-epi job in " +
      ".github/workflows/research-ci.yml). It is never committed and never faked.");
  });
} else {
  const PARITY = JSON.parse(readFileSync(PARITY_PATH, "utf8"));

  test("parity-epi meta records pinned reference calls and tolerance", function () {
    assert.deepEqual(PARITY.meta.tolerance, { abs: 1e-4, rel: 1e-4 });
    assert.equal(PARITY.meta.level, 0.95);
    assert.ok(PARITY.meta.referenceCalls.epi2by2.indexOf("epi.2by2") !== -1);
    assert.ok(PARITY.meta.referenceCalls.tableone.indexOf("CreateTableOne") !== -1);
    assert.ok(PARITY.twoByTwo.length >= 5, "at least five 2x2 tables");
    assert.ok(PARITY.table1.length >= 3, "at least three Table 1 sets");
  });

  test("parity-epi: 2x2 risk ratio, odds ratio and p match epiR::epi.2by2", function () {
    const seen = {};
    PARITY.twoByTwo.forEach(function (t) {
      const outcome = [];
      const group = [];
      function add(n, o, g) { for (let i = 0; i < n; i++) { outcome.push(o); group.push(g); } }
      add(t.a, "yes", "Exposed");
      add(t.b, "no", "Exposed");
      add(t.c, "yes", "Unexposed");
      add(t.d, "no", "Unexposed");
      const res = STATS.compare(outcome, group, { outcomeType: "binary", paired: false });
      const wantTest = t.minExpected < 5 ? "fisher" : "chi_square";
      assert.equal(res.test, wantTest, t.id + " test choice (smallest expected count " + t.minExpected + ")");
      seen[res.test] = true;
      assert.equal(res.effect.measure, "OR", t.id + " effect measure");
      closeGate(res.effect.estimate, t.or.est, t.id + " OR");
      closeGate(res.effect.ciLower, t.or.lo, t.id + " OR lower");
      closeGate(res.effect.ciUpper, t.or.hi, t.id + " OR upper");
      closeGate(res.effect.rr, t.rr.est, t.id + " RR");
      closeGate(res.effect.rrCiLower, t.rr.lo, t.id + " RR lower");
      closeGate(res.effect.rrCiUpper, t.rr.hi, t.id + " RR upper");
      closeP(res.p, wantTest === "fisher" ? t.pFisher : t.pYates, t.id + " " + wantTest);
    });
    assert.ok(seen.fisher && seen.chi_square, "covers both the Fisher and the Yates chi-square path");
  });

  test("parity-epi: Mann-Whitney U and p match stats::wilcox.test", function () {
    PARITY.mannWhitney.forEach(function (c) {
      const res = STATS._rank.mannWhitney(c.x, c.y);
      closeGate(res.statistic, c.W, c.id + " U");
      closeP(res.p, c.p, c.id);
    });
    assert.ok(PARITY.mannWhitney.some(function (c) { return c.exact; }), "covers the exact path");
    assert.ok(PARITY.mannWhitney.some(function (c) { return !c.exact; }), "covers the normal approximation");
  });

  PARITY.table1.forEach(function (set) {
    const n = set.columns[set.group].length;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(set.columnOrder.map(function (c) { return set.columns[c][i]; }));
    const groupCol = set.columns[set.group];

    /* What the app should report for one variable, and the R p it maps to. */
    const plan = {};
    const skipped = [];

    test("parity-epi " + set.id + ": per-group summaries match tableone", function () {
      set.numeric.forEach(function (v) {
        const col = set.columns[v.variable];
        v.groups.forEach(function (g) {
          const vals = groupValues(set, g.name).map(function (i) { return col[i]; });
          const d = STATS.describe(vals, "numeric");
          const label = set.id + " " + v.variable + " " + g.name;
          assert.equal(d.n, g.n, label + " n");
          closeGate(d.mean, g.mean, label + " mean");
          closeGate(d.sd, g.sd, label + " SD");
          closeGate(d.median, g.median, label + " median");
          closeGate(d.q1, g.q1, label + " Q1");
          closeGate(d.q3, g.q3, label + " Q3");
          if (g.shapiroP !== null) {
            assert.ok(d.normality, label + " has a Shapiro-Wilk result");
            closeP(d.normality.p, g.shapiroP, label + " Shapiro-Wilk");
          }
        });
      });
      set.categorical.forEach(function (v) {
        const col = set.columns[v.variable];
        const type = set.types[v.variable];
        v.groups.forEach(function (g) {
          const vals = groupValues(set, g.name).map(function (i) { return col[i]; });
          const d = STATS.describe(vals, type);
          const label = set.id + " " + v.variable + " " + g.name;
          assert.equal(d.n, g.n, label + " n");
          g.counts.forEach(function (want) {
            const got = d.counts.find(function (c) { return c.level === want.level; });
            if (want.n === 0) {
              assert.ok(!got || got.n === 0, label + " level " + want.level + " is empty");
              return;
            }
            assert.ok(got, label + " has level " + want.level);
            assert.equal(got.n, want.n, label + " level " + want.level + " count");
            closeGate(got.pct, want.pct, label + " level " + want.level + " percent");
          });
        });
      });
    });

    test("parity-epi " + set.id + ": group test and p match tableone", function () {
      const seen = {};
      set.numeric.forEach(function (v) {
        const strata = v.groups.filter(function (g) { return g.name !== "Overall"; });
        const allNormal = strata.every(function (g) { return g.shapiroP !== null && g.shapiroP >= 0.05; });
        const wantTest = allNormal ? v.normalTest : v.nonNormalTest;
        const res = STATS.compare(set.columns[v.variable], groupCol, { outcomeType: "numeric", paired: false });
        const label = set.id + " " + v.variable;
        assert.equal(res.test, wantTest, label + " test choice");
        seen[res.test] = true;
        if (res.test === "mann_whitney" && v.ties && v.maxGroupN < 50) {
          skipped.push(v.variable);
          plan[v.variable] = null;
          return;
        }
        const ref = allNormal ? v.pNormal : v.pNonNormal;
        closeP(res.p, ref, label + " " + res.test);
        plan[v.variable] = ref;
      });
      set.categorical.forEach(function (v) {
        const res = STATS.compare(set.columns[v.variable], groupCol,
          { outcomeType: set.types[v.variable], paired: false });
        const label = set.id + " " + v.variable;
        assert.ok(res.test === "chi_square" || res.test === "fisher", label + " uses chi-square or Fisher");
        if (res.test === "fisher") assert.equal(v.levels, 2, label + " Fisher only for 2x2");
        seen[res.test] = true;
        const ref = res.test === "fisher" ? v.pExact : v.pApprox;
        closeP(res.p, ref, label + " " + res.test);
        plan[v.variable] = ref;
      });
      assert.ok(Object.keys(seen).length > 0, set.id + " ran at least one test");
    });

    test("parity-epi " + set.id + ": rendered Table 1 cells match tableone", function (t) {
      const vars = set.numeric.map(function (v) { return v.variable; })
        .concat(set.categorical.map(function (v) { return v.variable; }));
      const out = STATS.table1(rows, set.columnOrder, set.group, vars, set.types);
      assert.deepEqual(out.groups.map(function (g) { return g.name; }), set.levels, set.id + " group order");
      set.numeric.forEach(function (v) {
        const row = out.rows.find(function (r) { return r.variable === v.variable; });
        const label = set.id + " " + v.variable;
        assert.ok(row, label + " has a Table 1 row");
        const overall = v.groups[0];
        assert.equal(overall.name, "Overall");
        const wantMean = overall.shapiroP !== null && overall.shapiroP >= 0.05;
        assert.equal(row.label, wantMean ? "mean ± SD" : "median (IQR)", label + " summary style");
        const shown = [row.overall].concat(row.cells);
        v.groups.forEach(function (g, k) {
          const cell = shown[k];
          const where = label + " " + g.name;
          if (wantMean) {
            const m = MEAN_SD.exec(cell);
            assert.ok(m, where + ": unexpected cell " + JSON.stringify(cell));
            closeShown(Number(m[1]), g.mean, 1, where + " mean");
            closeShown(Number(m[2]), g.sd, 1, where + " SD");
          } else {
            const m = MEDIAN_IQR.exec(cell);
            assert.ok(m, where + ": unexpected cell " + JSON.stringify(cell));
            closeShown(Number(m[1]), g.median, 1, where + " median");
            closeShown(Number(m[2]), g.q1, 1, where + " Q1");
            closeShown(Number(m[3]), g.q3, 1, where + " Q3");
          }
        });
        if (plan[v.variable] !== undefined && plan[v.variable] !== null) {
          checkShownP(row.p, plan[v.variable], label + " shown p");
        }
      });
      set.categorical.forEach(function (v) {
        const label = set.id + " " + v.variable;
        const levelRows = out.rows.filter(function (r) { return r.variable === v.variable; });
        assert.ok(levelRows.length >= 2, label + " has a row per level");
        levelRows.forEach(function (row) {
          const shown = [row.overall].concat(row.cells);
          v.groups.forEach(function (g, k) {
            const want = g.counts.find(function (c) { return c.level === row.label; });
            const wantN = want ? want.n : 0;
            const where = label + " " + row.label + " " + g.name;
            const m = COUNT_PCT.exec(shown[k]);
            assert.ok(m, where + ": unexpected cell " + JSON.stringify(shown[k]));
            assert.equal(Number(m[1]), wantN, where + " count");
            closeShown(Number(m[2]), want ? want.pct : 0, 1, where + " percent");
          });
          if (plan[v.variable] !== undefined && plan[v.variable] !== null) {
            checkShownP(row.p, plan[v.variable], label + " shown p");
          }
        });
      });
      if (skipped.length) {
        t.diagnostic("Mann-Whitney with ties and both groups under 50 (app uses an exact p, " +
          "R a normal approximation), not compared: " + skipped.join(", "));
      }
    });
  });
}
