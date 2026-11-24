/* Case series describe mode: n rules, type 7 quantiles, common features (plan item 3).
 *
 * Reference quantiles frozen from R 4.6.2 quantile(x, type = 7):
 *   x20 = 23,25,...,61  median 42  q1 32.5  q3 51.5  mean 42  sd 11.83216
 *   x10 = 12,18,22,27,31,36,40,45,52,60  median 33.5  q1 23.25  q3 43.75
 *   x3  = 30,40,50  median 40  q1 35  q3 45
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-describe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.SMD_RESEARCH_STATS = require("../research-stats.js");
const MC = require("../research-screen-masterchart.js");
const SRC = readFileSync(new URL("../research-screen-masterchart.js", import.meta.url), "utf8");

const X20 = [23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61];
const X10 = [12, 18, 22, 27, 31, 36, 40, 45, 52, 60];
const X3 = [30, 40, 50];

function chart(ages, sexes) {
  const columns = ["Age", "Sex"];
  const rows = ages.map((a, i) => [a, sexes ? sexes[i] : "Male"]);
  return { columns, rows, types: { Age: "numeric", Sex: "categorical" } };
}

test("no em or en dashes in the master chart screen source", () => {
  assert.equal((SRC.match(/[–—]/g) || []).length, 0);
});

test("describeRule: n<=5 list, n<15 median-range, n>=15 median-mean", () => {
  assert.equal(MC.describeRule(1), "list");
  assert.equal(MC.describeRule(5), "list");
  assert.equal(MC.describeRule(6), "median-range");
  assert.equal(MC.describeRule(14), "median-range");
  assert.equal(MC.describeRule(15), "median-mean");
  assert.equal(MC.describeRule(200), "median-mean");
});

test("n=3 lists every value (edge case: too few patients)", () => {
  const c = chart(X3);
  const data = MC.computeDescribeData(c.columns, c.rows, c.types);
  assert.equal(data.n, 3);
  assert.equal(data.rule, "list");
  const age = data.items.find((i) => i.name === "Age");
  assert.deepEqual(age.values, [30, 40, 50]);
  assert.equal(age.median, 40);
  assert.equal(age.q1, 35);
  assert.equal(age.q3, 45);
});

test("n=10 uses median (IQR) and range, no mean shown, quantiles equal R type 7", () => {
  const c = chart(X10);
  const data = MC.computeDescribeData(c.columns, c.rows, c.types);
  assert.equal(data.rule, "median-range");
  const age = data.items.find((i) => i.name === "Age");
  assert.equal(age.values, undefined);
  assert.equal(age.median, 33.5);
  assert.equal(age.q1, 23.25);
  assert.equal(age.q3, 43.75);
  assert.equal(age.min, 12);
  assert.equal(age.max, 60);
});

test("n=20 quantiles, mean and SD equal R type 7 / sample SD", () => {
  const sexes = X20.map((_, i) => (i < 14 ? "Male" : "Female"));
  const c = chart(X20, sexes);
  const data = MC.computeDescribeData(c.columns, c.rows, c.types);
  assert.equal(data.rule, "median-mean");
  const age = data.items.find((i) => i.name === "Age");
  assert.equal(age.median, 42);
  assert.equal(age.q1, 32.5);
  assert.equal(age.q3, 51.5);
  assert.equal(age.mean, 42);
  assert.ok(Math.abs(age.sd - 11.832159566199232) < 1e-9);
  assert.equal(age.min, 23);
  assert.equal(age.max, 61);
});

test("common features counts the top level of each categorical column", () => {
  const sexes = X20.map((_, i) => (i < 14 ? "Male" : "Female"));
  const c = chart(X20, sexes);
  const data = MC.computeDescribeData(c.columns, c.rows, c.types);
  const sex = data.common.find((f) => f.name === "Sex");
  assert.equal(sex.level, "Male");
  assert.equal(sex.n, 14);
  assert.equal(sex.of, 20);
  assert.equal(sex.pct, 70);
  assert.equal(data.common.length, 1);
});

test("describeParagraph reports the most common feature from the calculation only", () => {
  const sexes = X20.map((_, i) => (i < 14 ? "Male" : "Female"));
  const c = chart(X20, sexes);
  const data = MC.computeDescribeData(c.columns, c.rows, c.types);
  const p = MC.describeParagraph(data);
  assert.equal(
    p,
    "In this series of 20 patients, the most common feature was Sex (Male), seen in 14 of 20 (70.0%)."
  );
});

test("missing values are excluded from the count, not treated as zero", () => {
  const columns = ["Age"];
  const rows = [[30], [""], [40], ["NA"], [50]];
  const data = MC.computeDescribeData(columns, rows, { Age: "numeric" });
  const age = data.items.find((i) => i.name === "Age");
  assert.equal(age.n, 3);
  assert.equal(age.missing, 2);
  assert.deepEqual(age.values, [30, 40, 50]);
});

test("empty chart returns no items and an empty paragraph, never throws", () => {
  const data = MC.computeDescribeData([], [], {});
  assert.equal(data.n, 0);
  assert.deepEqual(data.items, []);
  assert.equal(MC.describeParagraph(data), "");
});
