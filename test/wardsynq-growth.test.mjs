/* test/wardsynq-growth.test.mjs — growth z-scores, centiles and corrected age (wardsynq/wardsynq-growth.js) against the
 * CDC 2000 reference, and a hospital's own tables through the same engine.
 *
 * Pins: CDC's own worked example from its data page (9-month boy: 5th centile 7.90 kg; 9.7 kg is z 0.207, the 58th
 * centile), smoothed percentiles CDC publishes in its data files reproduced from L, M and S, no WHO |z| > 3 adjustment
 * for CDC but WHO's for a hospital's "who-restricted" tables, interpolation between rows, the 24-month switch from the
 * infant to the 2-to-20-years tables, CDC's 0.8 cm length/height rule and its extreme-value flags, preterm corrected age,
 * refusals that are never numbers, and the data file's citation and licence.
 *
 * node --test test/wardsynq-growth.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const G = await import("../wardsynq/wardsynq-growth.js");
const M = 30.4375;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const at = (ind, sex, months, c, cm) => { const l = G.lmsFor(ind, sex, months * M, cm); assert.ok(l.ok, JSON.stringify(l)); return G.valueAtZ(G.zForCentile(c), l.l, l.m, l.s); };

test("CDC'S WORKED EXAMPLE: a 9-month boy (the 9.5-month row), 5th centile 7.90 kg; 9.7 kg is z 0.207, the 58th centile", () => {
  // cdc.gov/growthcharts data files page: "L=-0.1600954, M=9.476500305, and S=0.11218624 ... the 5th percentile is 7.90 kg
  // ... the z-score for this child is 0.207. This z-score corresponds to the 58th percentile."
  const l = G.lmsFor("wfa", "male", 9.5 * M);
  assert.deepEqual([l.l, l.m, l.s, l.reference], [-0.1600954, 9.476500305, 0.11218624, "cdc2000"]);
  assert.equal(Math.round(G.valueAtZ(-1.645, l.l, l.m, l.s) * 100) / 100, 7.9);
  assert.equal(Math.round(G.zscoreLms(9.7, l.l, l.m, l.s) * 1000) / 1000, 0.207);
  const z = G.growthZ({ indicator: "wfa", sex: "male", ageDays: 9.5 * M, value: 9.7 });
  assert.equal(z.reference, "cdc2000"); assert.equal(z.z, 0.21); assert.equal(Math.round(z.centile), 58);
});

test("PUBLISHED CDC PERCENTILES are reproduced from the tables' L, M and S (values from CDC's own data files)", () => {
  near(at("wfa", "male", 0, 3), 2.355450986, 1e-4, "wtageinf boys birth P3");
  near(at("wfa", "male", 0, 97), 4.446488308, 1e-4, "wtageinf boys birth P97");
  near(at("lhfa", "female", 180.5, 3), 149.7416255, 1e-4, "statage girls 180.5 months P3");
  near(at("lhfa", "female", 180.5, 50), 161.8979913, 1e-6, "statage girls 180.5 months P50 = M");
  near(at("bmi", "male", 120.5, 85), 19.3904113, 1e-4, "bmiagerev boys 120.5 months P85");
  near(at("bmi", "male", 120.5, 95), 22.15409238, 1e-4, "bmiagerev boys 120.5 months P95");
  near(at("hcfa", "female", 12.5, 97), 47.65765724, 1e-4, "hcageinf girls 12.5 months P97");
  near(at("wfl", "female", 6, 10, 80.5), 9.68761705, 1e-4, "wtleninf girls 80.5 cm P10");
});

test("NO WHO ADJUSTMENT FOR CDC: plain LMS even beyond |z| 3; a hospital's who-restricted tables get WHO's adjustment on weight only", () => {
  const l = G.lmsFor("wfa", "male", 12.5 * M);
  const plain = G.zscoreLms(16, l.l, l.m, l.s);
  assert.ok(plain > 3);
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 12.5 * M, value: 16 }).z, Math.round(plain * 100) / 100);
  // WHO weianthro.txt sex 1 age 365: L 0.0645, M 9.646, S 0.10925 (anthro R/z-score-helper.R compute_zscore_adjusted).
  const rows = [["wfa", "male", 0, 0.0645, 9.646, 0.10925], ["wfa", "male", 24, 0.0645, 9.646, 0.10925], ["lhfa", "male", 0, 1, 75.7391, 0.03137], ["lhfa", "male", 24, 1, 75.7391, 0.03137]];
  const who = G.hospitalReference({ name: "WHO Child Growth Standards", method: "who-restricted", rows });
  const sd = (k) => G.valueAtZ(k, 0.0645, 9.646, 0.10925);
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 365, value: 16 }, who).z, Math.round((3 + (16 - sd(3)) / (sd(3) - sd(2))) * 100) / 100);
  assert.notEqual(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 365, value: 16 }, who).z, Math.round(G.zscoreLms(16, 0.0645, 9.646, 0.10925) * 100) / 100);
  const lz = G.growthZ({ indicator: "lhfa", sex: "male", ageDays: 365, value: 65, position: "lying" }, who);
  assert.equal(lz.z, Math.round(((65 / 75.7391 - 1) / 0.03137) * 100) / 100, "length is never adjusted");
  assert.equal(lz.reference, "hospital");
  const lms = G.hospitalReference({ name: "IAP", method: "lms", rows });
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 365, value: 16 }, lms).z, Math.round(G.zscoreLms(16, 0.0645, 9.646, 0.10925) * 100) / 100);
});

test("INTERPOLATION between rows, and the 24-month switch from the birth-to-36-months tables to the 2-to-20-years tables", () => {
  const a = G.lmsFor("wfa", "male", 9.5 * M), b = G.lmsFor("wfa", "male", 10.5 * M), mid = G.lmsFor("wfa", "male", 10 * M);
  near(mid.m, (a.m + b.m) / 2, 1e-9, "M halfway"); near(mid.s, (a.s + b.s) / 2, 1e-9, "S halfway");
  assert.equal(G.lmsFor("wfa", "male", 24 * M).m, 12.6707633, "wtage.csv boys 24 months");
  assert.equal(G.lmsFor("lhfa", "male", 24 * M).m, 86.45220101, "statage.csv boys 24 months: standing height from 24 months");
  assert.equal(G.lmsFor("hcfa", "male", 36 * M).ok, true);
  assert.equal(G.lmsFor("hcfa", "male", 36.1 * M).code, "OUT_OF_RANGE", "no head circumference table after 36 months");
  assert.equal(G.lmsFor("wfa", "female", 240 * M).ok, true);
  assert.equal(G.lmsFor("wfa", "female", 240.6 * M).code, "OUT_OF_RANGE", "the reference stops at 20 years");
  assert.equal(G.lmsFor("bmi", "male", 23 * M).code, "OUT_OF_RANGE", "BMI-for-age starts at 24 months");
  assert.equal(G.lmsFor("wfl", "male", 12 * M, 44.9).code, "OUT_OF_RANGE", "weight-for-length 45 to 103.5 cm");
  assert.equal(G.lmsFor("wfh", "male", 30 * M, 76.9).code, "OUT_OF_RANGE", "weight-for-stature from 77 cm, used from 24 months");
  assert.equal(G.lmsFor("wfh", "male", 30 * M, 90).indicator, "wfh");
  assert.equal(G.lmsFor("wfl", "male", 12 * M, 75).indicator, "wfl");
});

test("CDC'S LENGTH AND HEIGHT RULE: +0.8 cm for a standing height under 24 months, -0.8 cm for a length from 24 months; unknown position is stated", () => {
  assert.equal(G.standardLenhei(80, 700, "standing").cm, 80.8);
  near(G.standardLenhei(90, 24 * M, "lying").cm, 89.2, 1e-9, "lying at 24 months");
  assert.equal(G.standardLenhei(90, 24 * M, "standing").cm, 90);
  assert.equal(G.standardLenhei(70, 200, null).positionAssumed, true);
  assert.equal(G.growthZ({ indicator: "lhfa", sex: "male", ageDays: 365, value: 75 }).positionAssumed, true);
});

test("CDC'S EXTREME-VALUE FLAGS on the modified z-score (weight-for-age below -5 or above 8), and the BMI above the 95th centile note", () => {
  const l = G.lmsFor("wfa", "male", 12.5 * M);
  const hi2 = G.valueAtZ(2, l.l, l.m, l.s);
  const at8 = l.m + 8 * (hi2 - l.m) / 2;
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 12.5 * M, value: at8 - 0.01 }).implausible, false);
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 12.5 * M, value: at8 + 0.01 }).implausible, true);
  near(G.modifiedZ(hi2, l.l, l.m, l.s), 2, 1e-9, "the +2 z value is modified z 2");
  assert.deepEqual(G.CDC_EXTREME.lhfa, [-5, 4]);
  assert.equal(G.growthZ({ indicator: "bmi", sex: "male", ageDays: 120.5 * M, value: 25 }).extendedBmiNotApplied, true);
  assert.equal(G.growthZ({ indicator: "bmi", sex: "male", ageDays: 120.5 * M, value: 17 }).extendedBmiNotApplied, undefined);
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

test("REFUSALS are refusals, never numbers: unknown sex, unknown or negative age, non-positive value, unknown indicator, outside the tables", () => {
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
  const hosp = G.hospitalReference({ name: "Only girls", method: "lms", rows: [["wfa", "female", 0, 1, 3, 0.1], ["wfa", "female", 12, 1, 9, 0.1]] });
  assert.equal(G.growthZ({ indicator: "wfa", sex: "male", ageDays: 100, value: 6 }, hosp).code, "OUT_OF_RANGE", "a hospital table without that sex refuses");
  assert.equal(G.growthZ({ indicator: "hcfa", sex: "female", ageDays: 100, value: 40 }, hosp).code, "OUT_OF_RANGE", "and without that indicator");
});

test("CENTILE LINES: 3, 10, 25, 50, 75, 90 and 97, ordered, and nothing drawn outside the reference", () => {
  const lines = G.centileLines("wfa", "male", 0, 400, 10);
  assert.deepEqual(lines.map((l) => l.centile), [3, 10, 25, 50, 75, 90, 97]);
  for (let i = 0; i < 10; i++) for (let k = 1; k < lines.length; k++) assert.ok(lines[k - 1].points[i][1] < lines[k].points[i][1]);
  assert.equal(G.centileLines("hcfa", "male", 1200, 1300, 5)[0].points.length, 0);
  near(G.normalCdf(1.96), 0.9750021048517795, 2e-7, "normal CDF");
});

test("DATA: CDC 2000 only, with its citation, CDC sources, public domain licence and CDC's attribution; the WHO tables are gone", () => {
  const info = G.CDC2000.info;
  assert.match(info.citation, /2000 CDC Growth Charts for the United States/);
  assert.match(info.licence, /public domain/i);
  assert.match(info.licence, /agencymaterials/);
  assert.match(info.attribution, /does not imply endorsement by CDC/);
  assert.ok(info.source.every((u) => /^https:\/\/www\.cdc\.gov\/growthcharts\//.test(u)));
  assert.equal(info.name, "CDC 2000 growth reference");
  const data = readdirSync(new URL("../wardsynq/data/", import.meta.url));
  assert.ok(data.includes("cdc-growth-2000.json"));
  assert.deepEqual(data.filter((f) => /who-growth|WHO-GROWTH/i.test(f)), [], "the CC BY-NC-SA WHO tables are not shipped");
});
