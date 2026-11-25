/* On-device master chart statistics against base R (docs/research/stats-reference.R).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-stats.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
const SRC = readFileSync(new URL("../research-stats.js", import.meta.url), "utf8");

/* Phase 1 numeric gate: absolute difference <= 1e-4 or relative difference <= 1e-4.
 * Normal-approximation p values also pass at 1e-3 absolute.
 */
function closeGate(actual, expected, label) {
  const abs = Math.abs(actual - expected);
  const rel = abs / Math.max(1e-12, Math.abs(expected));
  assert.ok(abs <= 1e-4 || rel <= 1e-4,
    label + ": got " + actual + ", want " + expected + " (abs " + abs + ", rel " + rel + ")");
}

function closeP(actual, expected, label) {
  const abs = Math.abs(actual - expected);
  assert.ok(abs <= 1e-3, label + " p: got " + actual + ", want " + expected + " (abs " + abs + ")");
  closeGate(actual, expected, label);
}

function throwsResearch(fn) {
  assert.throws(fn, function (err) {
    return err instanceof Error && String(err.message).indexOf("research: ") === 0;
  });
}

function walkStrings(value, fn) {
  if (typeof value === "string") fn(value);
  else if (Array.isArray(value)) value.forEach(function (v) { walkStrings(v, fn); });
  else if (value && typeof value === "object") {
    Object.keys(value).forEach(function (k) { walkStrings(value[k], fn); });
  }
}

function assertNoDash(value, label) {
  walkStrings(value, function (s) {
    assert.equal(s.indexOf("\u2014"), -1, label + " has an em dash: " + s);
    assert.equal(s.indexOf("\u2013"), -1, label + " has an en dash: " + s);
  });
}

function rep(n, v) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(v);
  return out;
}

function nums(xs) {
  return xs.map(function (x) { return String(x); });
}

const MPG = [21, 21, 22.8, 21.4, 18.7, 18.1, 14.3, 24.4, 22.8, 19.2, 17.8, 16.4, 17.3, 15.2, 10.4, 10.4, 14.7, 32.4, 30.4, 33.9, 21.5, 15.5, 15.2, 13.3, 19.2, 27.3, 26, 30.4, 15.8, 19.7, 15, 21.4];
const WT = [2.62, 2.875, 2.32, 3.215, 3.44, 3.46, 3.57, 3.19, 3.15, 3.44, 3.44, 4.07, 3.73, 3.78, 5.25, 5.424, 5.345, 2.2, 1.615, 1.835, 2.465, 3.52, 3.435, 3.84, 3.845, 1.935, 2.14, 1.513, 3.17, 2.77, 3.57, 2.78];
const HP = [110, 110, 93, 110, 175, 105, 245, 62, 95, 123, 123, 180, 180, 180, 205, 215, 230, 66, 52, 65, 97, 150, 150, 245, 175, 66, 91, 113, 264, 175, 335, 109];
const AM = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
const CYL = [6, 6, 4, 6, 8, 6, 8, 4, 4, 6, 6, 8, 8, 8, 8, 8, 8, 4, 4, 4, 4, 8, 8, 8, 8, 4, 4, 4, 8, 6, 8, 4];
const SLEEP = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0, 2, 1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];
const SLEEP_G = rep(10, "1").concat(rep(10, "2"));
const TOOTH = [4.2, 11.5, 7.3, 5.8, 6.4, 10, 11.2, 11.2, 5.2, 7, 16.5, 16.5, 15.2, 17.3, 22.5, 17.3, 13.6, 14.5, 18.8, 15.5, 23.6, 18.5, 33.9, 25.5, 26.4, 32.5, 26.7, 21.5, 23.3, 29.5, 15.2, 21.5, 17.6, 9.7, 14.5, 10, 8.2, 9.4, 16.5, 9.7, 19.7, 23.3, 23.6, 26.4, 20, 25.2, 25.8, 21.2, 14.5, 27.3, 25.5, 26.4, 22.4, 24.5, 24.8, 30.9, 26.4, 27.3, 29.4, 23];
const PT_A = [44.99, 51.47, 43.31, 62.76, 52.64, 43.44, 53.90, 55.91, 54.61, 47.56, 62.09, 53.12, 45.03, 32.28, 59.00, 49.64, 49.87, 57.55, 56.57, 54.75, 57.35, 56.26, 50.60, 34.09];
const PT_B = [39.13, 47.64, 39.78, 63.17, 50.07, 38.19, 45.82, 52.22, 49.45, 43.72, 62.22, 50.36, 42.21, 28.46, 51.70, 43.35, 46.36, 54.31, 50.48, 49.08, 55.42, 54.38, 45.51, 27.78];

test("exports the documented API and the browser global", function () {
  ["parseCsv", "inferColumn", "describe", "chooseTest", "compare", "crosstab", "table1", "logistic", "formatP", "resultsSentence"].forEach(function (k) {
    assert.equal(typeof STATS[k], "function", k);
  });
  const fakeWindow = {};
  new Function("module", "window", SRC)({ exports: {} }, fakeWindow);
  assert.equal(typeof fakeWindow.SMD_RESEARCH_STATS.parseCsv, "function");
  assert.equal(fakeWindow.SMD_RESEARCH_STATS.formatP(0.034), "p = 0.034");
});

test("source is ES5 and has no em or en dash", function () {
  ["=>", "let ", "const ", "class ", "`", "Array.from", ".includes(", "Object.assign", "\u2014", "\u2013"].forEach(function (tok) {
    assert.equal(SRC.indexOf(tok), -1, "forbidden token " + tok);
  });
});

test("parseCsv handles quotes, delimiters, BOM, and blank rows", function () {
  const quoted = STATS.parseCsv("\uFEFFa,b\r\n\"hello, \"\"x\"\"\",2\r\n\r\n");
  assert.deepEqual(quoted, { columns: ["a", "b"], rows: [["hello, \"x\"", "2"]] });
  assert.deepEqual(STATS.parseCsv("a;b\n1;2\n"), { columns: ["a", "b"], rows: [["1", "2"]] });
  assert.deepEqual(STATS.parseCsv("a\tb\n1\t2\n"), { columns: ["a", "b"], rows: [["1", "2"]] });
  assert.deepEqual(STATS.parseCsv("a,b;c\n1,2\n"), { columns: ["a", "b;c"], rows: [["1", "2"]] });
  const nl = STATS.parseCsv("name,note\nAnn,\"line1\nline2\"\n");
  assert.deepEqual(nl.rows, [["Ann", "line1\nline2"]]);
  const mid = STATS.parseCsv("a,b\n1,2\n,\n3,4\n\n");
  assert.deepEqual(mid.rows, [["1", "2"], ["", ""], ["3", "4"]]);
  assert.deepEqual(STATS.parseCsv("a,b,c\n1,2\n").rows, [["1", "2", ""]]);
  throwsResearch(function () { STATS.parseCsv("a,b\n1,2,3\n"); });
  throwsResearch(function () { STATS.parseCsv("\"a,b\n"); });
  throwsResearch(function () { STATS.parseCsv(""); });
  throwsResearch(function () { STATS.parseCsv(null); });
});

test("inferColumn types, levels, missing tokens, and phi", function () {
  const age = STATS.inferColumn("age", ["54", "1,234.5", "NA", "3", "n/a", "-", ".", "nil", ""]);
  assert.equal(age.type, "numeric");
  assert.equal(age.missing, 6);
  assert.equal(age.phi, false);
  assert.deepEqual(age.levels, []);
  assert.equal(STATS.inferColumn("arm", ["1", "2", "1", "2"]).type, "numeric");
  const yn = STATS.inferColumn("flag", ["yes", "No", "yes"]);
  assert.equal(yn.type, "binary");
  assert.deepEqual(yn.levels, ["No", "yes"]);
  const mf = STATS.inferColumn("sex", ["M", "F", "M"]);
  assert.equal(mf.type, "binary");
  assert.deepEqual(mf.levels, ["F", "M"]);
  assert.equal(STATS.inferColumn("bit", ["1", "0", "1", "0"]).type, "binary");
  assert.equal(STATS.inferColumn("mark", ["present", "absent"]).type, "binary");
  assert.equal(STATS.inferColumn("code", ["A", "B", "A"]).type, "binary");
  assert.deepEqual(STATS.inferColumn("group", ["treated", "control"]).levels, ["control", "treated"]);
  const cat = STATS.inferColumn("stage", ["II", "I", "III", "II"]);
  assert.equal(cat.type, "categorical");
  assert.deepEqual(cat.levels, ["I", "II", "III"]);
  const many = [];
  for (let i = 0; i < 21; i++) many.push("L" + i);
  assert.equal(STATS.inferColumn("note", many).type, "text");
  const nine = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "x"];
  assert.equal(STATS.inferColumn("mix", nine).type, "numeric");
  nine.push("y");
  assert.equal(STATS.inferColumn("mix", nine).type, "categorical");
  assert.equal(STATS.inferColumn("id", ["a", "b", "c"]).type, "id");
  assert.equal(STATS.inferColumn("S.No", ["1", "2", "3"]).type, "id");
  assert.equal(STATS.inferColumn("serial", ["s1", "s2"]).type, "id");
  assert.equal(STATS.inferColumn("IP No", ["A1", "A2"]).type, "id");
  const dupUhid = STATS.inferColumn("uhid", ["U1", "U2", "U1"]);
  assert.equal(dupUhid.type, "binary");
  assert.equal(dupUhid.phi, true);
  assert.equal(dupUhid.phiReason, "header matches uhid");
  const uhid = STATS.inferColumn("UHID", ["U1", "U2", "U3"]);
  assert.equal(uhid.type, "id");
  assert.equal(uhid.phi, true);
  assert.equal(STATS.inferColumn("visit", ["2020-01-02", "03/04/2021", "05-Jan-2022", "2020-01-02"]).type, "date");
  assert.equal(STATS.inferColumn("filename", ["a", "b"]).phi, false);
  const named = STATS.inferColumn("patient name", ["Ann", "Bob"]);
  assert.equal(named.phi, true);
  assert.equal(named.phiReason, "header matches patient name");
  ["phone", "mobile", "contact", "address", "aadhaar", "abha", "mrn", "hospital no", "op no", "DOB", "date of birth", "email"].forEach(function (header) {
    const info = STATS.inferColumn(header, ["a", "b"]);
    assert.equal(info.phi, true, header);
    assert.equal(info.phiReason.indexOf("header matches "), 0, header);
  });
  const phones = STATS.inferColumn("code", ["9876543210", "+91 9123456789", "8123456780", "not-a-phone"]);
  assert.equal(phones.phi, true);
  assert.equal(phones.phiReason, "values look like phone numbers");
  const fewPhones = STATS.inferColumn("code", ["9876543210", "office", "desk"]);
  assert.equal(fewPhones.phi, false);
  const aadhaar = STATS.inferColumn("code", ["1234 1234 1234", "9999-8888-7777"]);
  assert.equal(aadhaar.phi, true);
  assert.equal(aadhaar.phiReason, "values look like Aadhaar numbers");
  const mail = STATS.inferColumn("code", ["a@b.co", "c@d.in"]);
  assert.equal(mail.phi, true);
  assert.equal(mail.phiReason, "values look like email addresses");
  assert.equal(STATS.inferColumn("code", ["5123456789", "4123456789"]).phi, false);
  assert.equal(STATS.inferColumn("empty", []).type, "text");
  throwsResearch(function () { STATS.inferColumn("age", "1,2"); });
});

test("describe matches R for sleep, Shapiro-Wilk, and categorical counts", function () {
  const g1 = STATS.describe(SLEEP.slice(0, 10), "numeric");
  assert.equal(g1.n, 10);
  assert.equal(g1.missing, 0);
  closeGate(g1.mean, 0.75, "sleep mean");
  closeGate(g1.sd, 1.789009657759163, "sleep sd");
  closeGate(g1.min, -1.6, "sleep min");
  closeGate(g1.q1, -0.175, "sleep q1");
  closeGate(g1.median, 0.35, "sleep median");
  closeGate(g1.q3, 1.7, "sleep q3");
  closeGate(g1.max, 3.7, "sleep max");
  assert.equal(g1.normality.test, "Shapiro-Wilk");
  closeGate(g1.normality.W, 0.9258060289366405, "sleep W");
  closeP(g1.normality.p, 0.4079287964299891, "sleep shapiro");
  assert.equal(g1.normality.normal, true);
  const sw3 = STATS.describe([1, 2, 4], "numeric");
  closeGate(sw3.normality.W, 0.9642857142857142, "sw3 W");
  closeP(sw3.normality.p, 0.6368868450289632, "sw3 p");
  const mpg = STATS.describe(MPG, "numeric");
  closeGate(mpg.normality.W, 0.9475647264792743, "mpg W");
  closeP(mpg.normality.p, 0.1228813585394433, "mpg p");
  assert.equal(STATS.describe([1, 2], "numeric").normality, null);
  assert.equal(STATS.describe([5, 5, 5, 5], "numeric").normality, null);
  const big = [];
  for (let i = 0; i < 5001; i++) big.push(i);
  assert.equal(STATS.describe(big, "numeric").normality, null);
  const miss = STATS.describe(["1", "NA", "", "nil", "N/A", "-", ".", "2", "1,234.5"], "numeric");
  assert.equal(miss.n, 3);
  assert.equal(miss.missing, 6);
  closeGate(miss.mean, (1 + 2 + 1234.5) / 3, "thousands mean");
  const bin = STATS.describe(["yes", "yes", "no", "NA"], "binary");
  assert.equal(bin.n, 3);
  assert.equal(bin.missing, 1);
  assert.equal(bin.counts[0].level, "no");
  assert.equal(bin.counts[0].n, 1);
  closeGate(bin.counts[1].pct, 200 / 3, "yes pct");
  throwsResearch(function () { STATS.describe([1], "text"); });
});

test("chooseTest covers every branch with frozen wording", function () {
  const cases = [
    [{ outcomeType: "numeric", groups: 2, normal: true }, "welch_t", "Welch t test", "(both groups were normally distributed, so we compared means)"],
    [{ outcomeType: "numeric", groups: ["a", "b"], normal: [true, false] }, "mann_whitney", "Mann-Whitney U test", "(the outcome was not normally distributed in both groups, so we compared medians)"],
    [{ outcomeType: "numeric", groups: 3, normal: true }, "anova", "One-way ANOVA", "(the groups were normally distributed, so we compared means)"],
    [{ outcomeType: "numeric", groups: 4, normal: [true, true, false] }, "kruskal", "Kruskal-Wallis test", "(the groups were not all normally distributed, so we compared ranks)"],
    [{ outcomeType: "binary", groups: 2, smallExpected: false }, "chi_square", "Chi-square test", "(the outcome was categorical and the expected counts were large enough for a chi-square test)"],
    [{ outcomeType: "categorical", groups: 2, smallExpected: true }, "fisher", "Fisher exact test", "(an expected count was under 5, so we used an exact test)"],
    [{ outcomeType: "numeric", groups: 2, paired: true, normal: true }, "paired_t", "Paired t test", "(the paired differences were normally distributed, so we compared the mean difference)"],
    [{ outcomeType: "numeric", paired: true, normal: false }, "wilcoxon", "Wilcoxon signed-rank test", "(the paired differences were not normally distributed, so we compared the ranks of the differences)"],
    [{ outcomeType: "binary", paired: true }, "mcnemar", "McNemar test", "(the outcome was paired and binary, so we compared discordant pairs)"],
    [{ outcomeType: "numeric", groups: 0, normal: true }, "pearson", "Pearson correlation", "(both variables were normally distributed, so we used a linear correlation)"],
    [{ outcomeType: "numeric", normal: [true, false] }, "spearman", "Spearman rank correlation", "(a variable was not normally distributed, so we used a rank correlation)"]
  ];
  cases.forEach(function (row) {
    const got = STATS.chooseTest(row[0]);
    assert.equal(got.test, row[1]);
    assert.equal(got.label, row[2]);
    assert.equal(got.why, row[3]);
    assertNoDash(got, row[1]);
  });
  throwsResearch(function () { STATS.chooseTest({ outcomeType: "date", groups: 2 }); });
});

test("compare matches R: Welch, Wilcoxon, ANOVA, Kruskal, Mann-Whitney", function () {
  assert.equal(MPG.length, 32);
  assert.equal(AM.reduce(function (s, x) { return s + x; }, 0), 13);
  assert.equal(TOOTH.length, 60);
  const sleep = STATS.compare(SLEEP, SLEEP_G, { outcomeType: "numeric" });
  assert.equal(sleep.test, "welch_t");
  assert.equal(sleep.statisticName, "t");
  closeGate(sleep.statistic, -1.860813467486853, "sleep t");
  closeGate(sleep.df, 17.7764735161785, "sleep df");
  closeP(sleep.p, 0.07939414018735817, "sleep p");
  closeGate(sleep.effect.estimate, -1.58, "sleep md");
  closeGate(sleep.effect.ciLower, -3.36548323071171, "sleep lo");
  closeGate(sleep.effect.ciUpper, 0.2054832307117102, "sleep hi");
  assert.equal(sleep.effect.measure, "MD");
  const dropped = STATS.compare(SLEEP.concat(["NA"]), SLEEP_G.concat(["1"]), { outcomeType: "numeric" });
  assert.equal(dropped.dropped, 1);
  closeGate(dropped.statistic, sleep.statistic, "dropped t");
  const pairedW = STATS.compare(SLEEP.slice(0, 10), SLEEP.slice(10), { outcomeType: "numeric", paired: true });
  assert.equal(pairedW.test, "wilcoxon");
  assert.equal(pairedW.statisticName, "V");
  assert.equal(pairedW.df, null);
  closeGate(pairedW.statistic, 0, "sleep V");
  closeGate(pairedW.p, 0.00390625, "sleep Vp");
  const am = STATS.compare(nums(MPG), nums(AM), { outcomeType: "numeric" });
  assert.equal(am.test, "welch_t");
  assert.equal(am.byGroup[0].group, "0");
  closeGate(am.statistic, -3.767123145144925, "am t");
  closeGate(am.df, 18.33225163840046, "am df");
  closeP(am.p, 0.001373638333071028, "am p");
  closeGate(am.effect.ciLower, -11.28019435504016, "am lo");
  closeGate(am.effect.ciUpper, -3.20968418746996, "am hi");
  const cyl = STATS.compare(nums(MPG), nums(CYL), { outcomeType: "numeric" });
  assert.equal(cyl.test, "anova");
  assert.equal(cyl.statisticName, "F");
  assert.deepEqual(cyl.df, [2, 29]);
  closeGate(cyl.statistic, 39.69751525586901, "cyl F");
  closeP(cyl.p, 4.978919174400245e-09, "cyl p");
  assert.equal(cyl.effect.measure, null);
  const kwY = [1, 2, 3, 4, 5, 6, 7, 8, 9].concat([2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 1, 1, 1, 2, 2, 3, 15, 18]);
  const kwG = rep(9, "A").concat(rep(9, "B"), rep(9, "C"));
  const kw = STATS.compare(nums(kwY), kwG, { outcomeType: "numeric" });
  assert.equal(kw.test, "kruskal");
  assert.equal(kw.statisticName, "H");
  assert.equal(kw.df, 2);
  closeGate(kw.statistic, 3.712882845762946, "kw H");
  closeP(kw.p, 0.1562275902765789, "kw p");
  const sk = STATS.compare(
    nums([1, 1, 1, 1, 2, 2, 3, 14].concat([2, 2, 3, 3, 4, 10, 12, 15])),
    rep(8, "A").concat(rep(8, "B")),
    { outcomeType: "numeric" }
  );
  assert.equal(sk.test, "mann_whitney");
  assert.equal(sk.statisticName, "U");
  assert.equal(sk.df, null);
  closeGate(sk.statistic, 12, "skew U");
  closeGate(sk.p, 0.03185703185703186, "skew p");
  const supp = rep(30, "VC").concat(rep(30, "OJ"));
  const tooth = STATS.compare(nums(TOOTH), supp, { outcomeType: "numeric" });
  assert.equal(tooth.test, "mann_whitney");
  assert.equal(tooth.byGroup[0].group, "OJ");
  closeGate(tooth.statistic, 575.5, "tooth U");
  closeP(tooth.p, 0.06366220730468641, "tooth p");
  const left = [];
  const right = [];
  const lab = [];
  for (let i = 1; i <= 60; i++) { left.push(i); lab.push("A"); }
  for (let i = 10; i <= 69; i++) { right.push(i); lab.push("B"); }
  const asym = STATS.compare(nums(left.concat(right)), lab, { outcomeType: "numeric" });
  assert.equal(asym.test, "mann_whitney");
  closeGate(asym.statistic, 1300.5, "asym U");
  closeP(asym.p, 0.008810972218690793, "asym p");
});

test("compare matches R: correlation, chi-square, Fisher, McNemar, paired t", function () {
  const pear = STATS.compare(nums(MPG), nums(WT), { outcomeType: "numeric" });
  assert.equal(pear.test, "pearson");
  assert.equal(pear.statisticName, "r");
  assert.equal(pear.df, 30);
  closeGate(pear.statistic, -0.8676593765172279, "pear r");
  closeP(pear.p, 1.293958701350493e-10, "pear p");
  closeGate(pear.effect.ciLower, -0.9338264132849942, "pear lo");
  closeGate(pear.effect.ciUpper, -0.7440871964601129, "pear hi");
  assert.equal(pear.effect.measure, "r");
  const spear = STATS.compare(nums(MPG), nums(HP), { outcomeType: "numeric" });
  assert.equal(spear.test, "spearman");
  assert.equal(spear.statisticName, "rho");
  closeGate(spear.statistic, -0.8946646457499626, "rho");
  closeP(spear.p, 5.08596943092452e-12, "rho p");
  assert.equal(spear.effect.measure, "rho");
  const chiY = rep(12, "no").concat(rep(6, "yes"), rep(5, "no"), rep(14, "yes"));
  const chiG = rep(18, "A").concat(rep(19, "B"));
  const chi = STATS.compare(chiY, chiG, { outcomeType: "binary" });
  assert.equal(chi.test, "chi_square");
  assert.equal(chi.statisticName, "chi2");
  assert.equal(chi.df, 1);
  closeGate(chi.statistic, 4.543939198486413, "chi stat");
  closeP(chi.p, 0.03303548581067882, "chi p");
  closeGate(chi.effect.estimate, 0.1785714285714286, "chi or");
  closeGate(chi.effect.ciLower, 0.04336698637016966, "chi or lo");
  closeGate(chi.effect.ciUpper, 0.7353002311448386, "chi or hi");
  closeGate(chi.effect.rr, 0.4523809523809524, "chi rr");
  closeGate(chi.effect.rrCiLower, 0.2232069554163041, "chi rr lo");
  closeGate(chi.effect.rrCiUpper, 0.9168555061172122, "chi rr hi");
  const cylam = STATS.compare(nums(AM), nums(CYL), { outcomeType: "binary" });
  assert.equal(cylam.test, "chi_square");
  closeGate(cylam.statistic, 8.740732951259268, "cyl am");
  closeP(cylam.p, 0.01264660504610728, "cyl am p");
  const fishY = rep(8, "no").concat(rep(1, "yes"), rep(2, "no"), rep(7, "yes"));
  const fishG = rep(9, "A").concat(rep(9, "B"));
  const fish = STATS.compare(fishY, fishG, { outcomeType: "binary" });
  assert.equal(fish.test, "fisher");
  assert.equal(fish.statistic, null);
  assert.equal(fish.df, null);
  closeGate(fish.p, 0.01522007404360345, "fish p");
  closeGate(fish.effect.estimate, 0.03571428571428571, "fish or");
  closeGate(fish.effect.ciLower, 0.00263680297656804, "fish or lo");
  closeGate(fish.effect.ciUpper, 0.4837336029337265, "fish or hi");
  closeGate(fish.effect.rr, 0.1428571428571428, "fish rr");
  closeGate(fish.effect.rrCiLower, 0.02178594702167088, "fish rr lo");
  closeGate(fish.effect.rrCiUpper, 0.9367581425313182, "fish rr hi");
  const zeroY = rep(10, "yes").concat(rep(8, "no"), rep(3, "yes"));
  const zeroG = rep(10, "A").concat(rep(11, "B"));
  const zero = STATS.compare(zeroY, zeroG, { outcomeType: "binary" });
  assert.equal(zero.test, "fisher");
  closeGate(zero.p, 0.001031991744066046, "zero p");
  closeGate(zero.effect.estimate, 51, "zero or");
  closeGate(zero.effect.ciLower, 2.301862673181158, "zero or lo");
  closeGate(zero.effect.ciUpper, 1129.954462663681, "zero or hi");
  closeGate(zero.effect.rr, 3.272727272727272, "zero rr");
  closeGate(zero.effect.rrCiLower, 1.342480273373523, "zero rr lo");
  closeGate(zero.effect.rrCiUpper, 7.978324906583415, "zero rr hi");
  const before = rep(20, "no").concat(rep(3, "no"), rep(8, "yes"), rep(15, "yes"));
  const after = rep(20, "no").concat(rep(3, "yes"), rep(8, "no"), rep(15, "yes"));
  const mc = STATS.compare(before, after, { outcomeType: "binary", paired: true });
  assert.equal(mc.test, "mcnemar");
  assert.equal(mc.statisticName, "chi2");
  assert.equal(mc.df, 1);
  closeGate(mc.statistic, 1.454545454545455, "mc stat");
  closeP(mc.p, 0.227799993988229, "mc p");
  closeGate(mc.effect.estimate, 0.375, "mc or");
  closeGate(mc.effect.ciLower, 0.09948671680394394, "mc or lo");
  closeGate(mc.effect.ciUpper, 1.413505285103803, "mc or hi");
  assert.equal(mc.dropped, 0);
  const pt = STATS.compare(nums(PT_A), nums(PT_B), { outcomeType: "numeric", paired: true });
  assert.equal(pt.test, "paired_t");
  assert.equal(pt.statisticName, "t");
  assert.equal(pt.df, 23);
  closeGate(pt.statistic, 9.398805509987081, "pt t");
  closeP(pt.p, 2.430391925702864e-09, "pt p");
  closeGate(pt.effect.estimate, 4.0825, "pt md");
  closeGate(pt.effect.ciLower, 3.183950212416687, "pt lo");
  closeGate(pt.effect.ciUpper, 4.981049787583313, "pt hi");
  const tab = STATS.crosstab(chiY, chiG);
  assert.deepEqual(tab.rowLevels, ["no", "yes"]);
  assert.deepEqual(tab.colLevels, ["A", "B"]);
  assert.deepEqual(tab.counts, [[12, 5], [6, 14]]);
  closeGate(tab.expected[0][0], 17 * 18 / 37, "expected");
  const tabMiss = STATS.crosstab(["yes", "NA"], ["A", "B"]);
  assert.deepEqual(tabMiss.counts, [[1]]);
  throwsResearch(function () { STATS.compare([1], [1, 2], { outcomeType: "numeric" }); });
});

test("formatP, table 1 strings, and result sentences", function () {
  assert.equal(STATS.formatP(0), "p < 0.001");
  assert.equal(STATS.formatP(0.0004), "p < 0.001");
  assert.equal(STATS.formatP(0.001), "p = 0.001");
  assert.equal(STATS.formatP(0.001373638), "p = 0.001");
  assert.equal(STATS.formatP(0.034), "p = 0.034");
  assert.equal(STATS.formatP(0.07939414018735817), "p = 0.079");
  assert.equal(STATS.formatP(0.1), "p = 0.10");
  assert.equal(STATS.formatP(0.204), "p = 0.20");
  assert.equal(STATS.formatP(1), "p = 1.00");
  throwsResearch(function () { STATS.formatP(1.2); });
  throwsResearch(function () { STATS.formatP(-0.01); });
  const mpgRows = MPG.map(function (v, i) { return [String(v), String(AM[i])]; });
  const mpgTable = STATS.table1(mpgRows, ["mpg", "am"], "am", ["mpg"], { mpg: "numeric", am: "binary" });
  assert.deepEqual(mpgTable.groups, [{ name: "0", n: 19 }, { name: "1", n: 13 }]);
  assert.equal(mpgTable.rows[0].label, "mean \u00b1 SD");
  assert.equal(mpgTable.rows[0].overall, "20.1 \u00b1 6.0");
  assert.deepEqual(mpgTable.rows[0].cells, ["17.1 \u00b1 3.8", "24.4 \u00b1 6.2"]);
  assert.equal(mpgTable.rows[0].p, "p = 0.001");
  assert.equal(mpgTable.rows[0].test, "Welch t test");
  const skewA = [1, 1, 1, 1, 2, 2, 3, 15, 18];
  const skewB = [1, 1, 2, 2, 3, 4, 5, 20, 30];
  const skewRows = skewA.map(function (v) { return [String(v), "A"]; }).concat(skewB.map(function (v) { return [String(v), "B"]; }));
  const skewTable = STATS.table1(skewRows, ["age", "arm"], "arm", ["age"], ["numeric", "binary"]);
  assert.equal(skewTable.rows[0].label, "median (IQR)");
  assert.equal(skewTable.rows[0].overall, "2.0 (1.0 to 4.8)");
  assert.deepEqual(skewTable.rows[0].cells, ["2.0 (1.0 to 3.0)", "3.0 (2.0 to 5.0)"]);
  assert.equal(skewTable.rows[0].test, "Mann-Whitney U test");
  const cat = [];
  for (let i = 0; i < 42; i++) cat.push(["A", "yes"]);
  for (let i = 0; i < 78; i++) cat.push(["A", "no"]);
  for (let i = 0; i < 10; i++) cat.push(["B", "yes"]);
  for (let i = 0; i < 10; i++) cat.push(["B", "no"]);
  const catTable = STATS.table1(cat, ["g", "y"], "g", ["y"]);
  const yes = catTable.rows.filter(function (r) { return r.label === "yes"; })[0];
  assert.equal(yes.cells[0], "42 (35.0%)");
  assert.equal(yes.overall, "52 (37.1%)");
  assert.equal(yes.p, "p = 0.30");
  assert.equal(yes.test, "Chi-square test");
  assert.equal(catTable.rows[0].p, yes.p);
  const sleep = STATS.compare(SLEEP, SLEEP_G, { outcomeType: "numeric" });
  const sentence = STATS.resultsSentence(sleep, { outcome: "age", groupLabels: ["group A", "group B"] });
  assert.equal(sentence, "Mean age was 0.8 \u00b1 1.8 in group A and 2.3 \u00b1 2.0 in group B (mean difference -1.6, 95% CI -3.4 to 0.2; Welch t test, p = 0.079).");
  assert.equal(sentence.indexOf("years"), -1);
  const mw = STATS.compare(nums(skewA.concat(skewB)), skewRows.map(function (r) { return r[1]; }), { outcomeType: "numeric" });
  const mwSentence = STATS.resultsSentence(mw, { outcome: "age", groupLabels: ["arm A", "arm B"] });
  assert.equal(mwSentence, "Median age was 2.0 (1.0 to 3.0) in arm A and 3.0 (2.0 to 5.0) in arm B (Mann-Whitney U test, p = 0.30).");
  const pear = STATS.compare(nums(MPG), nums(WT), { outcomeType: "numeric" });
  const pearSentence = STATS.resultsSentence(pear, { outcome: "mpg", groupLabels: ["mpg", "wt"] });
  assert.ok(pearSentence.indexOf("95% CI") > 0);
  assert.ok(pearSentence.indexOf(" to ") > 0);
  assert.equal(pearSentence.indexOf("Pearson correlation"), 0);
  const an = STATS.compare(nums(MPG), nums(CYL), { outcomeType: "numeric" });
  const anSentence = STATS.resultsSentence(an, { outcome: "mpg" });
  assert.ok(anSentence.indexOf("One-way ANOVA") === 0);
  assert.ok(anSentence.indexOf("F = ") > 0);
  assertNoDash([sentence, mwSentence, pearSentence, anSentence, mpgTable, skewTable, catTable], "display");
  throwsResearch(function () { STATS.resultsSentence(null, {}); });
});

test("logistic matches glm, warns on few events, and stops on separation", function () {
  const rows = MPG.map(function (v, i) { return [String(v), String(AM[i]), String(CYL[i])]; });
  const fit = STATS.logistic(rows, ["mpg", "am", "cyl"], "am", ["mpg", "cyl"], { mpg: "numeric", am: "binary", cyl: "categorical" });
  assert.equal(fit.n, 32);
  assert.equal(fit.events, 13);
  assert.equal(fit.converged, true);
  assert.equal(fit.iterations, 5);
  assert.equal(fit.warning, "Too few events for this many risk factors (fewer than 10 events per factor); treat the result with caution.");
  assert.deepEqual(fit.coefficients.map(function (c) { return c.name; }), ["Intercept", "mpg", "cyl: 6 vs 4", "cyl: 8 vs 4"]);
  const beta = [-8.342127178614856, 0.3699205052089804, 0.7315879356544212, 0.7016122019926093];
  const lo = [-18.39861003300112, -0.04413658302329393, -2.039074181490753, -3.132466391937708];
  const hi = [1.714355675771406, 0.7839775934412547, 3.502250052799595, 4.535690795922926];
  const p = [0.103982919268451, 0.07993887722247275, 0.6047899502064833, 0.719848671253939];
  fit.coefficients.forEach(function (c, i) {
    closeGate(Math.log(c.or), beta[i], "glm b" + i);
    closeGate(c.or, Math.exp(beta[i]), "glm or" + i);
    closeGate(Math.log(c.ciLower), lo[i], "glm lo" + i);
    closeGate(Math.log(c.ciUpper), hi[i], "glm hi" + i);
    closeGate(c.ciLower, Math.exp(lo[i]), "glm or lo" + i);
    closeGate(c.ciUpper, Math.exp(hi[i]), "glm or hi" + i);
    closeP(c.p, p[i], "glm p" + i);
  });
  const y = rep(12, 0).concat(rep(8, 1), rep(8, 0), rep(12, 1));
  const x = rep(20, 0).concat(rep(20, 1));
  const easyRows = y.map(function (v, i) { return [String(v), String(x[i])]; });
  const easy = STATS.logistic(easyRows, ["y", "x"], "y", ["x"], { y: "binary", x: "numeric" });
  assert.equal(easy.converged, true);
  assert.equal(easy.iterations, 4);
  assert.equal(easy.warning, "");
  assert.equal(easy.events, 20);
  closeGate(easy.coefficients[0].or, 2 / 3, "easy intercept");
  closeGate(easy.coefficients[1].or, 2.25, "easy x");
  closeGate(Math.log(easy.coefficients[0].ciLower), -1.300062175026538, "easy lo0");
  closeGate(Math.log(easy.coefficients[0].ciUpper), 0.4891319588102104, "easy hi0");
  closeGate(Math.log(easy.coefficients[1].ciLower), -0.454221088678828, "easy lo1");
  closeGate(Math.log(easy.coefficients[1].ciUpper), 2.076081521111484, "easy hi1");
  closeP(easy.coefficients[0].p, 0.3743635094970091, "easy p0");
  closeP(easy.coefficients[1].p, 0.2090116812932778, "easy p1");
  const wtRows = MPG.map(function (v, i) { return [String(AM[i]), String(v), String(WT[i])]; });
  const wide = STATS.logistic(wtRows, ["am", "mpg", "wt"], "am", ["mpg", "wt"], { am: "binary", mpg: "numeric", wt: "numeric" });
  assert.equal(wide.converged, true);
  assert.equal(wide.iterations, 7);
  assert.equal(wide.warning, fit.warning);
  wide.coefficients.forEach(function (c) { assert.ok(isFinite(c.or) && c.or > 0); });
  const sepY = [0, 0, 0, 0, 1, 1, 1, 1];
  const sepX = [1, 2, 3, 4, 5, 6, 7, 8];
  const sep = STATS.logistic(
    sepY.map(function (v, i) { return [String(v), String(sepX[i])]; }),
    ["y", "x"], "y", ["x"], { y: "binary", x: "numeric" }
  );
  assert.equal(sep.converged, false);
  assert.equal(sep.warning, "The outcome is perfectly separated by a predictor, so the odds ratios are not finite.");
  sep.coefficients.forEach(function (c) {
    assert.equal(c.or, null);
    assert.equal(c.ciLower, null);
    assert.equal(c.ciUpper, null);
    assert.equal(c.p, null);
  });
  const sing = STATS.logistic(
    [["0", "5"], ["1", "5"], ["0", "5"], ["1", "5"], ["0", "5"], ["1", "5"], ["0", "5"], ["1", "5"]],
    ["y", "x"], "y", ["x"], { y: "binary", x: "numeric" }
  );
  assert.equal(sing.converged, false);
  assert.equal(sing.warning, "A predictor has no variation, so the model is not identified.");
  assertNoDash([fit, easy, sep, sing, wide], "logistic");
  throwsResearch(function () { STATS.logistic([["1", "0"], ["0", "1"]], ["y", "x"], "y", [], {}); });
});

/* Orchestrator parity cases (R 4.6.2 defaults): exact conditional p for n < 50 even with ties and zeros. */
test("rank tests match R 4.6 wilcox.test defaults with ties and zeros", () => {
  const R = STATS._rank;
  const a = [10, 12, 9, 14, 11, 13, 10, 15, 12, 11], b = [12, 12, 11, 13, 14, 15, 10, 18, 13, 14];
  assert.ok(Math.abs(R.wilcoxonSigned(a.map((v, i) => v - b[i])).p - 0.0234375) < 1e-9);
  assert.ok(Math.abs(R.wilcoxonSigned([-0.4, -0.7, 0.2, -0.4, 0.3, -0.3]).p - 0.1875) < 1e-9);
  const x = [5.1, 4.8, 6.2, 5.9, 7.1, 6.4, 5.5, 6.8, 7.3, 5.0, 6.1, 4.9, 30];
  const y = [6.9, 7.4, 8.1, 6.5, 7.9, 8.8, 7.2, 9.1, 6.8, 7.7, 8.3, 7.0, 9.4];
  assert.ok(Math.abs(R.mannWhitney(x, y).p - 0.001056093) < 1e-8);
});
