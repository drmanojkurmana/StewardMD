/* Plan v2 items 4 and 6: Kaplan-Meier, log-rank, Cox and matched odds ratio
 * against R (docs/research/stats-reference-survival.R, R 4.3.3 + survival 3.5-8).
 * Datasets: survival::lung (status recoded 1/2 -> 0/1) and survival::veteran.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-stats-survival.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const S = require("../research-stats.js");
const L = JSON.parse(readFileSync(new URL("./fixtures/research/survival/lung.json", import.meta.url), "utf8"));
const V = JSON.parse(readFileSync(new URL("./fixtures/research/survival/veteran.json", import.meta.url), "utf8"));
const SRC = readFileSync(new URL("../research-stats.js", import.meta.url), "utf8");

/* Relative tolerance 1e-4 with an absolute floor of 1e-10. */
function near(actual, expected, label) {
  assert.ok(typeof actual === "number" && isFinite(actual), label + ": got " + actual);
  const abs = Math.abs(actual - expected);
  assert.ok(abs <= 1e-10 || abs / Math.abs(expected) <= 1e-4, label + ": " + actual + " vs R " + expected);
}

function stepAt(group, t) {
  let st = null;
  for (const s of group.steps) if (s.t <= t) st = s;
  return st;
}

const lungRows = L.time.map((t, i) => ({ time: t, status: L.status[i], sex: L.sex[i], age: L.age[i], ecog: L.ph_ecog[i] == null ? "" : L.ph_ecog[i] }));
const vetRows = V.time.map((t, i) => ({ time: t, status: V.status[i], trt: V.trt[i], cell: V.celltype[i], karno: V.karno[i] }));

test("source stays ES5 with no dashes in the new code", () => {
  assert.ok(!/=>/.test(SRC), "no arrow functions");
  assert.ok(!/\b(let|const|class|async|await)\s/.test(SRC), "no ES6 keywords");
  assert.ok(!/[–—]/.test(SRC), "no em or en dash");
});

test("Kaplan-Meier, conf.type log (R default): survival, limits, at risk, median", () => {
  const km = S.kaplanMeier(L.time, L.status, null);
  assert.equal(km.ok, true);
  assert.equal(km.confType, "log");
  const g = km.groups[0];
  assert.equal(g.n, 228);
  assert.equal(g.nEvents, 165);
  assert.deepEqual(g.median, { value: 310, lower: 285, upper: 363 });
  const R = { surv: [0.863968967645244, 0.530608117760562, 0.293269193711569], lo: [0.820584892081258, 0.466878799657740, 0.231982138262412], hi: [0.909646746189512, 0.603036537190812, 0.370747595588351] };
  [100, 300, 500].forEach((t, i) => {
    const s = stepAt(g, t);
    near(s.survival, R.surv[i], "S(" + t + ")");
    near(s.ciLower, R.lo[i], "lower(" + t + ")");
    near(s.ciUpper, R.hi[i], "upper(" + t + ")");
  });
  /* R summary(times = 100, 300, 500) n.risk 196, 92, 41: first step at or after each time */
  const firstAtOrAfter = (t) => g.steps.find((s) => s.t >= t).atRisk;
  assert.deepEqual([100, 300, 500].map(firstAtOrAfter), [196, 92, 41]);
});

test("Kaplan-Meier log-log and plain limits match R", () => {
  const ll = S.kaplanMeier(L.time, L.status, null, { confType: "log-log" }).groups[0];
  const pl = S.kaplanMeier(L.time, L.status, null, { confType: "plain" }).groups[0];
  const RL = { lo: [0.812222319753539, 0.460465202515717, 0.226503677118074], hi: [0.902310180515044, 0.595789639415879, 0.363028599684183] };
  const RP = { lo: [0.819457733913681, 0.462714662012993, 0.224517932798043], hi: [0.908480201376806, 0.598501573508131, 0.362020454625094] };
  [100, 300, 500].forEach((t, i) => {
    near(stepAt(ll, t).ciLower, RL.lo[i], "log-log lower " + t);
    near(stepAt(ll, t).ciUpper, RL.hi[i], "log-log upper " + t);
    near(stepAt(pl, t).ciLower, RP.lo[i], "plain lower " + t);
    near(stepAt(pl, t).ciUpper, RP.hi[i], "plain upper " + t);
  });
  assert.deepEqual(ll.median, { value: 310, lower: 284, upper: 361 });
});

test("Kaplan-Meier by sex: medians and limits", () => {
  const km = S.kaplanMeier(L.time, L.status, L.sex.map(String));
  assert.deepEqual(km.groups.map((g) => g.name), ["1", "2"]);
  assert.deepEqual(km.groups.map((g) => g.median), [{ value: 270, lower: 212, upper: 310 }, { value: 426, lower: 348, upper: 550 }]);
});

test("log-rank matches survdiff (2 groups and 4 groups)", () => {
  const lr = S.logRank(L.time, L.status, L.sex.map(String));
  assert.equal(lr.ok, true);
  near(lr.chi2, 10.3267419548856, "chi2");
  near(lr.p, 0.00131116452035549, "p");
  assert.equal(lr.df, 1);
  assert.deepEqual(lr.table.map((r) => r.observed), [112, 53]);
  near(lr.table[0].expected, 91.5817390295728, "E1");
  near(lr.table[1].expected, 73.4182609704272, "E2");
  const lv = S.logRank(V.time, V.status, V.celltype);
  near(lv.chi2, 25.4037003457854, "veteran chi2");
  assert.equal(lv.df, 3);
  [15.6937646143605, 34.5494783863493, 30.1020793268148, 47.6546776724754].forEach((e, i) => near(lv.table[i].expected, e, "veteran E" + i));
});

test("Cox, Efron: lung ~ sex", () => {
  const c = S.cox(lungRows, { time: "time", event: "status", predictors: [{ name: "sex", type: "numeric" }] });
  assert.equal(c.ok, true);
  assert.equal(c.converged, true);
  assert.equal(c.ties, "efron");
  const k = c.coefficients[0];
  near(k.beta, -0.53102353761950816, "beta");
  near(k.se, 0.16717858323075435, "se");
  near(k.p, 0.00149122920488076, "p");
  near(k.hr, Math.exp(-0.53102353761950816), "hr");
  near(k.ciLower, 0.423717830353915, "lower");
  near(k.ciUpper, 0.815984813171387, "upper");
  near(c.logLikNull, -749.909801390395, "loglik null");
  near(c.logLik, -744.592999024955, "loglik");
  assert.ok(c.warnings.some((w) => /assume the effect stays the same over time/.test(w)), "PH reminder");
});

test("Cox, Breslow: lung ~ sex", () => {
  const c = S.cox(lungRows, { time: "time", event: "status", ties: "breslow", predictors: [{ name: "sex", type: "numeric" }] });
  near(c.coefficients[0].beta, -0.530396574509334, "beta");
  near(c.coefficients[0].se, 0.167180837385788, "se");
});

test("Cox with a missing covariate uses complete cases (lung ~ age + sex + ph.ecog)", () => {
  const c = S.cox(lungRows, { time: "time", event: "status", predictors: [{ name: "age", type: "numeric" }, { name: "sex", type: "numeric" }, { name: "ecog", type: "numeric" }] });
  assert.equal(c.n, 227);
  assert.equal(c.nEvents, 164);
  assert.equal(c.nExcluded, 1);
  near(c.lrTest.chi2, 30.5006687731566, "LR chi2");
  [0.0110667645600735, -0.5526123957036310, 0.4637284753704277].forEach((b, i) => near(c.coefficients[i].beta, b, "beta" + i));
  [0.00926741101370053, 0.16773905378726350, 0.11357726616199662].forEach((s, i) => near(c.coefficients[i].se, s, "se" + i));
});

test("Cox with a categorical factor (veteran ~ trt + celltype + karno), Efron and Breslow", () => {
  const preds = [{ name: "trt", type: "numeric" }, { name: "cell", type: "categorical" }, { name: "karno", type: "numeric" }];
  const e = S.cox(vetRows, { time: "time", event: "status", predictors: preds });
  assert.deepEqual(e.coefficients.map((k) => k.term), ["trt", "celllarge", "cellsmallcell", "cellsquamous", "karno"]);
  assert.equal(e.levels.cell.reference, "adeno");
  [0.2617440900575150, -0.7593689499159563, -0.3290142260046368, -1.1539944138617664, -0.0312712960478022].forEach((b, i) => near(e.coefficients[i].beta, b, "efron beta" + i));
  [0.20092305511889180, 0.29865655831737353, 0.26905792146178004, 0.29503773769712499, 0.00516508974291703].forEach((s, i) => near(e.coefficients[i].se, s, "efron se" + i));
  const b = S.cox(vetRows, { time: "time", event: "status", ties: "breslow", predictors: preds });
  [0.2573130796537101, -0.7547140370809718, -0.3280590343647801, -1.1476733665808079, -0.0311118575656421].forEach((x, i) => near(b.coefficients[i].beta, x, "breslow beta" + i));
  [0.20062914180278935, 0.29848856206597224, 0.26875292334157191, 0.29493150646894362, 0.00516671633781735].forEach((s, i) => near(b.coefficients[i].se, s, "breslow se" + i));
});

test("Cox reference level can be chosen", () => {
  const c = S.cox(vetRows, { time: "time", event: "status", predictors: [{ name: "cell", type: "categorical", reference: "squamous" }] });
  assert.deepEqual(c.coefficients.map((k) => k.level), ["adeno", "large", "smallcell"]);
});

test("matched odds ratio matches binom.test", () => {
  const m = S.matchedOr({ b: 25, c: 10 });
  assert.equal(m.method, "exact conditional");
  assert.equal(m.or, 2.5);
  near(m.ciLower, 1.1596189735922393, "lower");
  near(m.ciUpper, 5.8327132003357205, "upper");
  near(m.p, 0.0166738478001207, "p");
  const z = S.matchedOr({ b: 8, c: 0 });
  assert.equal(z.or, Infinity);
  assert.equal(z.ciUpper, Infinity);
  near(z.ciLower, 1.70697058896627, "lower c=0");
  near(z.p, 0.0078125, "p c=0");
  assert.ok(z.warnings.some((w) => /report only the lower limit/.test(w)));
  assert.ok(z.warnings.some((w) => /Very few pairs differ/.test(w)));
  const pairs = [];
  for (let i = 0; i < 25; i++) pairs.push({ caseExposed: "yes", controlExposed: "no" });
  for (let i = 0; i < 10; i++) pairs.push({ caseExposed: 0, controlExposed: 1 });
  for (let i = 0; i < 7; i++) pairs.push({ caseExposed: 1, controlExposed: 1 });
  pairs.push({ caseExposed: "maybe", controlExposed: 1 });
  const fromPairs = S.matchedOr(pairs);
  assert.equal(fromPairs.b, 25);
  assert.equal(fromPairs.c, 10);
  assert.ok(fromPairs.warnings.some((w) => /1 pairs were left out/.test(w)));
});

test("edge cases return plain messages, never throw", () => {
  assert.equal(S.matchedOr({ b: 0, c: 0 }).ok, false);
  assert.match(S.matchedOr({ b: 0, c: 0 }).warnings[0], /No pairs differ in exposure/);
  const none = S.logRank([1, 2, 3, 4], [0, 0, 0, 0], ["a", "a", "b", "b"]);
  assert.equal(none.ok, false);
  assert.match(none.warnings.join(" "), /No events yet/);
  const noCox = S.cox([{ t: 1, e: 0, x: 1 }, { t: 2, e: 0, x: 2 }], { time: "t", event: "e", predictors: [{ name: "x", type: "numeric" }] });
  assert.equal(noCox.ok, false);
  const bad = S.kaplanMeier([5, -1, "", 7, 9], ["died", 1, 1, "alive", "unknown"], null);
  assert.equal(bad.nExcluded, 3);
  assert.match(bad.warnings.join(" "), /3 rows were left out/);
  assert.match(bad.warnings.join(" "), /only 2 patients/);
  const noEv = S.kaplanMeier([1, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0], ["a", "a", "a", "b", "b", "b"]);
  assert.equal(noEv.groups[0].median.value, null);
  assert.equal(noEv.groups[0].steps[noEv.groups[0].steps.length - 1].survival, 1);
  assert.match(noEv.warnings.join(" "), /No one in group a had the event/);
  assert.equal(S.kaplanMeier("x", [1], null).ok, false);
  assert.equal(S.cox(null, {}).ok, false);
});

test("Cox flags separation and hides the hazard ratio", () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) rows.push({ t: i, e: 1, g: "a" });
  for (let i = 1; i <= 20; i++) rows.push({ t: i + 0.5, e: 0, g: "b" });
  const c = S.cox(rows, { time: "t", event: "e", predictors: [{ name: "g", type: "categorical" }] });
  assert.equal(c.ok, true);
  assert.equal(c.coefficients[0].estimable, false);
  assert.equal(c.coefficients[0].hr, null);
  assert.match(c.warnings.join(" "), /hazard ratio cannot be estimated/);
});

test("Cox warns when there are fewer than 10 events per parameter", () => {
  const c = S.cox(lungRows.slice(0, 30), { time: "time", event: "status", predictors: [{ name: "age", type: "numeric" }, { name: "sex", type: "numeric" }, { name: "ecog", type: "numeric" }] });
  assert.match(c.warnings.join(" "), /Too few events for this many factors/);
});

test("events coerce from words", () => {
  const km = S.kaplanMeier([1, 2, 3, 4, 5, 6], ["Dead", " died ", "EVENT", "alive", "Censored", "no"], null);
  assert.equal(km.groups[0].nEvents, 3);
  assert.equal(km.nExcluded, 0);
});

test("chooseTest offers Kaplan-Meier for a survival outcome", () => {
  const r = S.chooseTest({ outcomeType: "survival", groups: 2 });
  assert.equal(r.test, "km_logrank");
  assert.equal(r.label, "Kaplan-Meier with log-rank test (compares time to the event between groups)");
});
