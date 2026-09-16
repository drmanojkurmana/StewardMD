/* test/wardsynq-growth.test.mjs — WHO growth z-scores, centiles and corrected age (wardsynq/wardsynq-growth.js).
 *
 * Pins: the six published WHO values reproduced by the LMS tables (verify.json from the data fetch,
 * each against WHO's own z-score/centile xlsx), WHO's restricted |z| > 3 adjustment on the weight
 * indicators only (checked against the formula in anthro R/z-score-helper.R written out here with
 * table rows copied from WHO's data-raw txt files), 0.1 cm and month interpolation, the table
 * boundaries, preterm corrected age, and refusals that are never numbers.
 *
 * node --test test/wardsynq-growth.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test } from "node:test";
import assert from "node:assert/strict";

const G = await import("../wardsynq/wardsynq-growth.js");
const M = 30.4375;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const at = (ind, sex, days, z) => { const l = G.lmsFor(ind, sex, days); assert.ok(l.ok, JSON.stringify(l)); return G.valueAtZ(z, l.l, l.m, l.s); };

test("PUBLISHED WHO VALUES: the six values WHO publishes are reproduced from the tables", () => {
  // who.int child-growth-standards xlsx files (URLs in the fetch's verify.json), rounded as WHO prints them.
  assert.equal(Math.round(at("wfa", "male", 12 * M, 0) * 10) / 10, 9.6, "wfa boys 12 months median");
  assert.equal(Math.round(at("wfa", "male", 12 * M, -2) * 10) / 10, 7.7, "wfa boys 12 months -2 SD");
  assert.equal(Math.round(at("hcfa", "male", 0, 0) * 10) / 10, 34.5, "hcfa boys birth median");
  assert.equal(Math.round(at("hcfa", "male", 24 * M, 2) * 10) / 10, 51.0, "hcfa boys 24 months +2 SD");
  assert.equal(Math.round(at("lhfa", "female", 180 * M, 0) * 1000) / 1000, 161.669, "hfa girls 15 years median (2007)");
  assert.equal(Math.round(at("bmi", "female", 120 * M, G.zForCentile(85)) * 1000) / 1000, 19.137, "bmi girls 10 years P85 (2007)");
  // And the other way round: a child exactly on the median is z 0, centile 50.
  const z = G.growthZ({ indicator: "wfa", sex: "male", ageDays: 365, value: 9.646 });
  assert.equal(z.z, 0); assert.equal(z.centile, 50); assert.equal(z.reference, "who2006");
});

test("RESTRICTED ADJUSTMENT beyond |z| 3 applies to weight-for-age, weight-for-length/height and BMI, not to length or head circumference", () => {
  // weianthro.txt sex 1 age 365: L 0.0645, M 9.646, S 0.10925 (anthro R/z-score-helper.R compute_zscore_adjusted).
  const [l, m, s] = [0.0645, 9.646, 0.10925];
  const sd = (k) => m * Math.pow(1 + l * s * k, 1 / l);
  const plain = (y) => (Math.pow(y / m, l) - 1) / (s * l);
  const whoHigh = 3 + (16 - sd(3)) / (sd(3) - sd(2));
  const whoLow = -3 + (5 - sd(-3)) / (sd(-2) - sd(-3));
  assert.ok(plain(16) > 3 && plain(5) < -3);
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 365, value: 16 }).z, Math.round(whoHigh * 100) / 100);
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 365, value: 5 }).z, Math.round(whoLow * 100) / 100);
  assert.notEqual(Math.round(plain(16) * 100) / 100, Math.round(whoHigh * 100) / 100, "the adjustment really changes the answer here");

  // lenanthro.txt sex 1 age 365: L 1, M 75.7391, S 0.03137. Not adjusted: plain LMS even at z < -3.
  const lz = G.growthZ({ indicator: "lhfa", sex: "male", ageDays: 365, value: 65, position: "lying" });
  assert.equal(lz.z, Math.round(((65 / 75.7391 - 1) / 0.03137) * 100) / 100);
  assert.ok(lz.z < -3);
  // hcanthro.txt sex 1 age 365: L 1, M 46.0637, S 0.02789. Not adjusted.
  const hz = G.growthZ({ indicator: "hcfa", sex: "male", ageDays: 365, value: 51 });
  assert.equal(hz.z, Math.round(((51 / 46.0637 - 1) / 0.02789) * 100) / 100);
  assert.ok(hz.z > 3);
  assert.deepEqual(G.ADJUSTED, { wfa: true, wfl: true, wfh: true, bmi: true, lhfa: false, hcfa: false });
});

test("INTERPOLATION: weight-for-length between 0.1 cm rows, and WHO 2007 between whole months", () => {
  // wflanthro.txt sex 1: 75.0 -> L -0.3521 M 9.5032 S 0.08295; 75.1 -> M 9.5235 S 0.08297 (R/z-score-weight-for-lenhei.R).
  const r = G.lmsFor("wfl", "male", 365, 75.05);
  near(r.m, 9.5032 + 0.5 * (9.5235 - 9.5032), 1e-9, "M halfway");
  near(r.s, 0.08295 + 0.5 * (0.08297 - 0.08295), 1e-9, "S halfway");
  // wfawho2007.txt sex 1: month 100 M 26.2911, month 101 M 26.5128 (anthroplus R/zscores.R zscore_indicator).
  const p = G.lmsFor("wfa", "male", 100.25 * M);
  near(p.m, 26.2911 + 0.25 * (26.5128 - 26.2911), 1e-9, "M a quarter of the way");
  assert.equal(p.reference, "who2007");
  // Age tables for 0 to 5 years are by day with WHO's round-half-up: 365.5 days reads row 366.
  assert.equal(G.roundUp(365.5), 366); assert.equal(G.roundUp(365.49), 365);
});

test("BOUNDARIES: 2006 standards below 60 months (1825 and 1826 days), 2007 reference from 60 months; weight-for-age stops at 121 months, height at 229", () => {
  assert.equal(G.lmsFor("wfa", "female", 1825).reference, "who2006");
  assert.equal(G.lmsFor("wfa", "female", 1826).reference, "who2006", "1826 days is 59.99 months");
  // weianthro.txt sex 2 age 1826: M 18.2179.
  assert.equal(G.lmsFor("wfa", "female", 1826).m, 18.2179);
  assert.equal(G.lmsFor("wfa", "female", 60 * M).reference, "who2007");
  // wfawho2007.txt sex 2 month 60: M 18.0823.
  assert.equal(G.lmsFor("wfa", "female", 60 * M).m, 18.0823);
  assert.equal(G.lmsFor("lhfa", "male", 61 * M).reference, "who2007");
  assert.equal(G.lmsFor("wfa", "male", 120.9 * M).ok, true);
  assert.equal(G.lmsFor("wfa", "male", 121 * M).code, "OUT_OF_RANGE");
  assert.equal(G.lmsFor("lhfa", "male", 228.9 * M).ok, true);
  assert.equal(G.lmsFor("lhfa", "male", 229 * M).code, "OUT_OF_RANGE");
  assert.equal(G.lmsFor("hcfa", "male", 60 * M).code, "OUT_OF_RANGE", "no WHO head circumference reference after 5 years");
  assert.equal(G.lmsFor("wfl", "male", 365, 44.9).code, "OUT_OF_RANGE");
  assert.equal(G.lmsFor("wfh", "male", 800, 64.9).code, "OUT_OF_RANGE", "from 731 days the height table (65 to 120 cm) applies");
});

test("LENGTH vs HEIGHT: +0.7 cm for standing under 731 days, -0.7 cm for lying from 731 days, standing under 9 months is implausible, unknown position is stated", () => {
  assert.equal(G.standardLenhei(80, 700, "standing").cm, 80.7);
  assert.equal(G.standardLenhei(90, 731, "lying").cm, 89.3);
  assert.equal(G.standardLenhei(90, 731, "standing").cm, 90);
  assert.equal(G.standardLenhei(70, 200, "standing").positionImplausible, true);
  assert.equal(G.standardLenhei(70, 200, "standing").cm, 70);
  assert.equal(G.standardLenhei(70, 200, null).positionAssumed, true);
  assert.equal(G.growthZ({ indicator: "lhfa", sex: "male", ageDays: 365, value: 75 }).positionAssumed, true);
});

test("CORRECTED AGE: preterm under 37 weeks until 24 months chronological; never when gestation is unknown; before term is refused", () => {
  assert.deepEqual(G.correctedAge(100, 32 * 7), { corrected: true, ageDays: 44, reason: "PRETERM" });
  assert.deepEqual(G.correctedAge(100, 36 * 7 + 6), { corrected: true, ageDays: 78, reason: "PRETERM" }, "36+6 is still preterm: 100 - (280 - 258)");
  assert.deepEqual(G.correctedAge(100, 37 * 7), { corrected: false, ageDays: 100, reason: "TERM" });
  assert.deepEqual(G.correctedAge(730, 28 * 7), { corrected: true, ageDays: 646, reason: "PRETERM" }, "730 days is still under 24 months");
  assert.deepEqual(G.correctedAge(731, 28 * 7), { corrected: false, ageDays: 731, reason: "PAST_24_MONTHS" });
  assert.deepEqual(G.correctedAge(100, null), { corrected: false, ageDays: 100, reason: "GA_UNKNOWN" });
  assert.deepEqual(G.correctedAge(20, 30 * 7), { corrected: true, ageDays: null, reason: "BEFORE_TERM" });
});

test("REFUSALS are refusals, never numbers: unknown sex, unknown or negative age, non-positive value, unknown indicator", () => {
  for (const p of [
    { indicator: "wfa", sex: "unknown", ageDays: 100, value: 6 },
    { indicator: "wfa", sex: null, ageDays: 100, value: 6 },
    { indicator: "wfa", sex: "male", ageDays: null, value: 6 },
    { indicator: "wfa", sex: "male", ageDays: -1, value: 6 },
    { indicator: "wfa", sex: "male", ageDays: 100, value: 0 },
    { indicator: "wfa", sex: "male", ageDays: 100, value: Number.NaN },
    { indicator: "wfa", sex: "male", ageDays: 400 * M, value: 60 },
    { indicator: "hcfa", sex: "male", ageDays: 6 * 365, value: 50 },
    { indicator: "wfl", sex: "male", ageDays: 100, value: 6 },
    { indicator: "height", sex: "male", ageDays: 100, value: 60 },
  ]) {
    const r = G.growthZ(p);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.equal(r.z, undefined); assert.equal(r.centile, undefined);
    assert.ok(r.code && r.reason);
  }
  assert.equal(G.growthZ({ indicator: "wfa", sex: "unknown", ageDays: 100, value: 6 }).code, "SEX_UNKNOWN");
});

test("CENTILE LINES: the five WHO centiles, ordered, and nothing drawn outside the reference", () => {
  const lines = G.centileLines("wfa", "male", 0, 400, 10);
  assert.deepEqual(lines.map((l) => l.centile), [3, 15, 50, 85, 97]);
  for (let i = 0; i < 10; i++) assert.ok(lines[0].points[i][1] < lines[2].points[i][1] && lines[2].points[i][1] < lines[4].points[i][1]);
  assert.equal(G.centileLines("hcfa", "male", 1900, 2000, 5)[0].points.length, 0);
  near(G.normalCdf(1.96), 0.9750021048517795, 2e-7, "normal CDF");
});

test("DATA carries its citation, source and licence", () => {
  for (const k of ["who2006", "who2007"]) {
    assert.match(G.REFERENCES[k].citation, /World Health Organization|Bull World Health Organ/);
    assert.match(G.REFERENCES[k].licence, /CC BY-NC-SA 3\.0 IGO/);
    assert.ok(G.REFERENCES[k].source.every((u) => /^https:\/\/raw\.githubusercontent\.com\/WorldHealthOrganization\//.test(u)));
  }
});
