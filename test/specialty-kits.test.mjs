// Specialty kits (specialty-kits.js, window.SMD_KITS): the pure clinical maths against published
// oracles, the kit validator and bundle freshness, and rendering against fake hosts.
//
// Oracles (all WHO's own numbers, so a wrong table or formula cannot agree with them by accident):
//   - WHO anthro README example (4 children, 0 to 5 y) and the anthro unit tests (wfa 0.24, lhfa LMS);
//   - a fixed sample of the WHO 2007 reference survey (anthroplus data-raw/survey_who2007_z.csv,
//     WHO's expected zhfa / zwfa / zbfa). The full 933-child file (2101 z-scores) was checked once
//     on 2026-09-25 with 0 differences; the sample below keeps that check in CI.
//   - ACOG Committee Opinion 700 redating table; WHO ICD-11 vision categories; WHO 2021 hearing grades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const K = require("../specialty-kits.js");
const FLAGS = require("../specialty-kits-flags.js");
const W = JSON.parse(readFileSync(join(ROOT, "kb/growth/who-growth.json"), "utf8"));
const BUNDLE = JSON.parse(readFileSync(join(ROOT, "kb/specialty-kits/kits.json"), "utf8"));
const B = await import("../scripts/build-specialty-kits.mjs");
K._setBundle(BUNDLE); K._setGrowth(W);

const z = (r, key) => { const x = r.rows.find((y) => y.key === key); return x ? x.z : null; };
const iso = (d) => d.toISOString().slice(0, 10);

/* ================================ flags + bundle ================================ */
test("flag defaults ON and exposes on()/defs() like the other flag modules", () => {
  assert.equal(FLAGS.on(), true);
  assert.equal(FLAGS.defs().smd_specialty_kits.query, "kits");
  assert.equal(K.on(), true);
});

test("kits.json, KITS_V, GROWTH_V and the index.html token are in sync (build --check)", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/build-specialty-kits.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const js = readFileSync(join(ROOT, "specialty-kits.js"), "utf8");
  assert.match(js, new RegExp(`var KITS_V = "${BUNDLE.version}";`));
  assert.match(js, new RegExp(`var GROWTH_V = "${B.growthVersion()}";`));
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.match(html, /<script src="\/specialty-kits-flags\.js\?v=[^"]+" defer><\/script>\s*<script src="\/specialty-kits\.js\?v=kits\d+\.[0-9a-f]{10}" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/specialty-kits\.css\?v=[^"]+">/);
});

test("every source kit validates, is in KIT_ORDER, and the bundle carries the milestone data", () => {
  const { kits, data, errors } = B.loadAll();
  assert.deepEqual(errors, []);
  const ids = kits.map((k) => k.id);
  ids.forEach((id) => assert.ok(B.KIT_ORDER.includes(id), id + " missing from KIT_ORDER"));
  assert.ok(ids.includes("obgyn") && ids.includes("paediatrics"));
  assert.deepEqual(BUNDLE.kits.map((k) => k.id), ids, "bundle order = KIT_ORDER order");
  assert.equal(data.milestones.ages.length, 12);
  data.milestones.ages.forEach((a) => assert.equal(a.domains.length, 4, "4 domains at " + a.label));
});

test("the tool ids the validator accepts are exactly the tools the engine implements", () => {
  assert.deepEqual([...B.TOOL_IDS].sort(), [...K.TOOL_IDS].sort());
});

test("validator rejects unknown keys, bad targets, dashes, dangling references and unreviewed approvals", () => {
  const refs = B.refsNow();
  const base = JSON.parse(readFileSync(join(ROOT, "kb/specialty-kits/src/obgyn.json"), "utf8"));
  const bad = (mut) => { const k = structuredClone(base); mut(k); return B.validateKit(k, "obgyn", refs).join("\n"); };
  assert.equal(B.validateKit(structuredClone(base), "obgyn", refs).length, 0);
  assert.match(bad((k) => { k.extra = 1; }), /unknown key "extra"/);
  assert.match(bad((k) => { k.sections[0].target = "Not_a_field"; }), /not an Initial Assessment field/);
  assert.match(bad((k) => { k.sections[0].fields[0].set = "Nope"; }), /set "Nope"/);
  assert.match(bad((k) => { k.label = "O—G"; }), /em or en dash/);
  assert.match(bad((k) => { k.protocols.push("no-such-protocol"); }), /unknown protocol/);
  assert.match(bad((k) => { k.calculators.push("no_such_calc"); }), /unknown calculator/);
  assert.match(bad((k) => { k.subject = "astrology"; }), /unknown protocol subject/);
  assert.match(bad((k) => { k.tools = ["x-ray-vision"]; }), /tools must be from/);
  assert.match(bad((k) => { k.sections[0].fields[0] = { id: "s", label: "S", type: "select", opts: ["only"] }; }), /select needs >= 2 opts/);
  assert.match(bad((k) => { k.sections[1].fields[0].id = k.sections[0].fields[0].id; }), /duplicate field id/);
  assert.match(bad((k) => { k.review = { status: "approved", compiled: "2026-09-25" }; }), /must name its reviewer/);
  assert.match(bad((k) => { k.sources[0].url = "http://insecure.example"; }), /https url/);
  assert.match(bad((k) => { k.advice[0].text = "Take <b>this</b>"; }), /HTML-like markup/);
});

test("every kit renders its review status and cites at least one https source", () => {
  BUNDLE.kits.forEach((k) => {
    assert.ok(k.sources.length >= 1 && k.sources.every((s) => s.url.startsWith("https://")), k.id);
    assert.ok(["ai_drafted", "reviewed", "approved"].includes(k.review.status), k.id);
  });
});

/* ================================ pregnancy dating ================================ */
test("ACOG CO 700 redating thresholds at every band edge", () => {
  const T = K._acogThreshold;
  [[0, 5], [62, 5], [63, 7], [97, 7], [98, 7], [111, 7], [112, 10], [153, 10], [154, 14], [195, 14], [196, 21], [280, 21]]
    .forEach(([ga, th]) => assert.equal(T(ga), th, "GA " + ga + " days"));
});

test("LMP dating: Naegele EDD, gestation, trimester, cycle adjustment", () => {
  let r = K._dating({ lmp: "2026-01-01", asOf: "2026-03-12" });
  assert.equal(r.ok, true); assert.equal(r.basis, "LMP");
  assert.equal(iso(r.edd), "2026-10-08"); assert.equal(r.ga, 70); assert.equal(r.trimester, "First trimester");
  r = K._dating({ lmp: "2026-01-01", cycle: 35, asOf: "2026-03-12" });
  assert.equal(iso(r.edd), "2026-10-15"); assert.equal(r.ga, 63);
  assert.ok(r.notes.some((n) => /35-day cycle/.test(n)));
  r = K._dating({ lmp: "2026-01-01", cycle: 60, asOf: "2026-03-12" });   // implausible cycle: not adjusted
  assert.equal(iso(r.edd), "2026-10-08");
});

test("LMP and scan: keep the LMP within the ACOG threshold, redate beyond it, or when the LMP is uncertain", () => {
  // Scan on 12 Mar 2026 when the LMP gestation is 10+0 (70 days); threshold at 9+0 to 13+6 is 7 days.
  let r = K._dating({ lmp: "2026-01-01", usgDate: "2026-03-12", usgWeeks: 10, usgDays: 3, asOf: "2026-03-12" });
  assert.equal(r.discrepancy, 3); assert.equal(r.threshold, 7); assert.equal(r.basis, "LMP"); assert.equal(iso(r.edd), "2026-10-08");
  r = K._dating({ lmp: "2026-01-01", usgDate: "2026-03-12", usgWeeks: 11, usgDays: 2, asOf: "2026-03-12" });
  assert.equal(r.discrepancy, 9); assert.equal(r.basis, "ultrasound");
  assert.equal(iso(r.edd), "2026-09-29");          // scan date + (280 - 79) days
  assert.equal(r.ga, 79);
  // At or before 8+6 the threshold is 5 days: a 6-day difference redates.
  r = K._dating({ lmp: "2026-01-01", usgDate: "2026-03-04", usgWeeks: 8, usgDays: 0, asOf: "2026-03-04" });
  assert.equal(r.threshold, 5); assert.equal(r.discrepancy, 6); assert.equal(r.basis, "ultrasound");
  r = K._dating({ lmp: "2026-01-01", lmpUncertain: true, usgDate: "2026-03-12", usgWeeks: 10, usgDays: 3, asOf: "2026-03-12" });
  assert.equal(r.basis, "ultrasound"); assert.ok(r.notes.some((n) => /LMP uncertain/.test(n)));
});

test("scan-only dating, suboptimal late first scan, milestone windows and out-of-range dates", () => {
  let r = K._dating({ usgDate: "2026-06-01", usgWeeks: 24, usgDays: 0, asOf: "2026-06-01" });
  assert.equal(r.basis, "ultrasound"); assert.ok(r.notes.some((n) => /suboptimally dated/.test(n)));
  r = K._dating({ lmp: "2026-01-01", asOf: "2026-03-12" });
  const first = r.milestones[0], anomaly = r.milestones[1];
  assert.equal(iso(first.from), "2026-03-19"); assert.equal(iso(first.to), "2026-04-08");   // 11+0 to 13+6
  assert.equal(iso(anomaly.from), "2026-05-07"); assert.equal(iso(anomaly.to), "2026-06-04"); // 18+0 to 22+0
  r = K._dating({ lmp: "2024-01-01", asOf: "2026-03-12" });
  assert.equal(r.ok, false); assert.ok(r.notes.some((n) => /outside 0 to 44 weeks/.test(n)));
  assert.equal(K._dating({}).ok, false);
  assert.equal(K._dating({ lmp: "2026-02-30" }).edd, undefined, "an impossible date is ignored");
});

/* ================================ WHO growth ================================ */
test("WHO anthro README example: 4 children, every indicator and flag exactly as WHO's anthro", () => {
  const cases = [
    [1, 1001, 18, 120, { lhfa: [7.31, true], wfa: [2.2, false], wflh: [-2.39, false], bfa: [-3.01, false] }],
    [2, 1000, 15, 80, { lhfa: [-3.5, false], wfa: [0.95, false], wflh: [4.13, false], bfa: [4.66, false] }],
    [1, 1010, 10, 100, { lhfa: [1.62, false], wfa: [-2.76, false], wflh: [-5.19, true], bfa: [-5.61, true] }],
    [1, 1000, 15, 100, { lhfa: [1.7, false], wfa: [0.69, false], wflh: [-0.29, false], bfa: [-0.58, false] }]
  ];
  cases.forEach(([sex, days, w, lh, exp]) => {
    const r = K._growth(W, { sex, ageDays: days, weight: w, lenhei: lh });
    Object.keys(exp).forEach((k) => {
      const row = r.rows.find((x) => x.key === k);
      assert.ok(row, `${k} computed for sex ${sex}, ${days} d`);
      assert.equal(row.z, exp[k][0], `${k} z for sex ${sex}, ${days} d`);
      assert.equal(row.flag, exp[k][1], `${k} flag for sex ${sex}, ${days} d`);
    });
  });
});

test("WHO anthro unit cases: weight-for-age 17 kg at 1522 days (girl) = 0.24; length-for-age LMS at day 44", () => {
  assert.equal(z(K._growth(W, { sex: 2, ageDays: 1522, weight: 17 }), "wfa"), 0.24);
  const expected = Math.round(((50 / 56.4833) - 1) / 0.03492 * 100) / 100;
  assert.equal(z(K._growth(W, { sex: 1, ageDays: 44, lenhei: 50 }), "lhfa"), expected);
});

// [sex, age in months, weight, height, oedema, WHO zhfa, WHO zwfa, WHO zbfa]; null = WHO gives none.
const WHO2007 = [
  [1, 166.59, 50.7, 153.7, "n", -1.13, null, 0.94], [2, 170.49, 61, 162.5, "n", 0.32, null, 1.05],
  [2, 167.85, 65.9, 150, "n", -1.41, null, 2.33], [2, 175.74, 56.7, 161.2, "n", 0.01, null, 0.6],
  [1, 124.41, 58.3, 166.4, "n", 4.1, null, 1.8], [2, 93.86, 35.7, 136.9, "n", 1.98, 2.11, 1.55],
  [1, 147.09, 44.7, 160.7, "y", 1.38, null, null], [1, 145.85, 37.1, 147.7, "n", -0.33, null, -0.32],
  [2, 220.09, 61.3, 167.9, "n", 0.73, null, 0.14], [1, 218.29, 97.4, 177.1, "n", 0.11, null, 2.32],
  [2, 161.75, 54.1, 156.1, "n", -0.31, null, 0.98], [1, 92.87, 20.5, 116.7, "n", -1.65, -1.4, -0.44],
  [2, 152.36, 47.5, 160.8, "y", 0.84, null, null], [1, 215.3, 56.7, 174.7, "n", -0.19, null, -1.3],
  [1, 210.86, 73.1, 182.5, "n", 0.88, null, 0.17], [2, 89.55, 55.2, 143.3, "n", 3.53, 4.92, 3.77],
  [1, 111.49, 24.5, 132.9, "y", -0.19, null, null], [1, 194.89, 74.5, 178.3, "n", 0.61, null, 0.92],
  [1, 215.22, 74.4, 170.6, "n", -0.74, null, 1.18], [1, 216.95, 66.8, 167, "n", -1.23, null, 0.72],
  [1, 215.95, 66.6, 179.2, "n", 0.41, null, -0.36], [1, 99.27, 26.8, 127.9, "n", -0.14, 0.17, 0.35],
  [1, 216.01, 78.5, 176, "n", -0.02, null, 1.11], [1, 165.58, 73.8, 170, "y", 1.07, null, null],
  [2, 197.4, 53.5, 167.1, "n", 0.65, null, -0.63], [2, 128.7, 39.7, 153, "n", 1.48, null, -0.05],
  [2, 86.33, 23.3, 120.7, "n", -0.22, 0.12, 0.31], [2, 147.6, 45, 144.5, "y", -1.23, null, null],
  [2, 144.31, 64.7, 142.2, "n", -1.34, null, 3.01], [2, 161.16, 46.1, 159, "n", 0.14, null, -0.37],
  [1, 173.87, 71.9, 170.8, "n", 0.59, null, 1.63], [2, 182.09, 53.3, 160.1, "n", -0.26, null, 0.17],
  [2, 94.08, 21.4, 121.2, "n", -0.77, -0.89, -0.66], [1, 212.74, 85.3, 178.9, "n", 0.39, null, 1.48],
  [2, 214.44, 73.4, 166, "n", 0.45, null, 1.44]
];
test("WHO 2007 reference (5 to 19 y): 35 survey children, height, weight and BMI-for-age exactly as WHO", () => {
  WHO2007.forEach(([sex, months, w, h, oed, zh, zw, zb]) => {
    const r = K._growth(W, { sex, ageDays: months * 30.4375, weight: w, lenhei: h, measured: "h", oedema: oed === "y" });
    assert.equal(z(r, "hfa07"), zh, `hfa ${sex}/${months}`);
    assert.equal(z(r, "wfa07"), zw, `wfa ${sex}/${months}`);
    assert.equal(z(r, "bfa07"), zb, `bfa ${sex}/${months}`);
  });
});

test("WHO method details: length/height standardisation, 9-month rule, oedema, MUAC cut-offs, ranges", () => {
  // Standing height under 2 years: +0.7 cm (WHO); lying length from 2 years: -0.7 cm.
  let r = K._growth(W, { sex: 1, ageDays: 400, weight: 9.5, lenhei: 75, measured: "h" });
  assert.equal(r.clenhei, 75.7); assert.ok(r.notes.some((n) => /\+0\.7 cm/.test(n)));
  r = K._growth(W, { sex: 1, ageDays: 900, weight: 12, lenhei: 88, measured: "l" });
  assert.equal(r.clenhei, 87.3);
  r = K._growth(W, { sex: 1, ageDays: 200, weight: 7, lenhei: 66, measured: "h" });
  assert.ok(r.notes.some((n) => /under 9 months is implausible/.test(n)));
  // Oedema: SAM regardless of anthropometry, weight-based indicators withheld.
  r = K._growth(W, { sex: 2, ageDays: 500, weight: 8, lenhei: 76, oedema: true });
  assert.equal(r.sam, true); assert.equal(z(r, "wfa"), null); assert.equal(z(r, "wflh"), null); assert.ok(z(r, "lhfa") != null);
  // MUAC (6 to 59 months): < 11.5 SAM, 11.5 to 12.4 MAM.
  r = K._growth(W, { sex: 1, ageDays: 400, muac: 11.4 }); assert.equal(r.sam, true);
  r = K._growth(W, { sex: 1, ageDays: 400, muac: 12 }); assert.equal(r.sam, false); assert.ok(r.notes.some((n) => /moderate acute malnutrition/.test(n)));
  r = K._growth(W, { sex: 1, ageDays: 100, muac: 11 }); assert.equal(r.sam, false, "MUAC cut-offs start at 6 months");
  // Weight-for-length needs 45 to 110 cm under 2 years.
  r = K._growth(W, { sex: 1, ageDays: 300, weight: 30, lenhei: 115 });
  assert.equal(z(r, "wflh"), null); assert.ok(r.notes.some((n) => /45 to 110 cm/.test(n)));
  // Weight-for-length below -3 SD is SAM.
  r = K._growth(W, { sex: 1, ageDays: 400, weight: 6, lenhei: 76, measured: "l" });
  assert.ok(z(r, "wflh") < -3); assert.equal(r.sam, true);
  // After 10 years weight-for-age is not used; after 19 years nothing is.
  r = K._growth(W, { sex: 2, ageDays: 130 * 30.4375, weight: 30, lenhei: 140 });
  assert.equal(z(r, "wfa07"), null); assert.ok(r.notes.some((n) => /not used after 10 years/.test(n)));
  r = K._growth(W, { sex: 2, ageDays: 240 * 30.4375, weight: 50, lenhei: 160 });
  assert.equal(r.rows.length, 0); assert.ok(r.notes.some((n) => /birth to 19 years/.test(n)));
  assert.ok(K._growth(W, { sex: "", ageDays: 10 }).notes.some((n) => /Select the sex/.test(n)));
});

test("restricted application beyond +3 SD matches the WHO formula, and centiles are sane", () => {
  const p = { l: W.wfa["1"].l[365], m: W.wfa["1"].m[365], s: W.wfa["1"].s[365] };
  const sd = (k) => p.m * Math.pow(1 + p.l * p.s * k, 1 / p.l);
  const y = sd(3) + 0.8;
  assert.ok(Math.abs(K._lmsZAdj(y, p.l, p.m, p.s) - (3 + 0.8 / (sd(3) - sd(2)))) < 1e-12);
  assert.ok(Math.abs(K._lmsZ(sd(2), p.l, p.m, p.s) - 2) < 1e-12);
  assert.equal(K._pct(0), 50); assert.equal(K._pct(-2), 2.3); assert.equal(K._pct(1.96), 97.5);
});

test("growth tables: contiguous, both sexes, WHO row counts", () => {
  const n = (k) => [W[k]["1"].l.length, W[k]["2"].l.length];
  assert.deepEqual(n("wfa"), [1827, 1827]); assert.deepEqual(n("lhfa"), [1827, 1827]);
  assert.deepEqual(n("acfa"), [1736, 1736]); assert.equal(W.acfa["1"].start, 91);
  assert.deepEqual(n("wfl"), [651, 651]); assert.deepEqual(n("wfh"), [551, 551]);
  assert.deepEqual(n("hfa07"), [170, 170]); assert.deepEqual(n("wfa07"), [62, 62]);
  // Length and head circumference medians only rise, except where WHO switches from lying length to
  // standing height at 2 years (day 731), a drop of about 0.7 cm. (Weight medians dip after birth.)
  ["lhfa", "hcfa"].forEach((k) => ["1", "2"].forEach((sex) => {
    const m = W[k][sex].m;
    for (let i = 1; i < m.length; i++) {
      if (k === "lhfa" && i === 731) { const drop = m[i - 1] - m[i]; assert.ok(drop > 0.6 && drop < 0.8, "length-to-height switch"); continue; }
      assert.ok(m[i] >= m[i - 1], `${k}/${sex} median never falls (day ${i})`);
    }
  }));
});

/* ================================ eye, ear, skin, teeth ================================ */
test("vision: logMAR and the WHO ICD-11 category from presenting acuity in the better eye", () => {
  assert.equal(K._logmar("6/6"), 0); assert.equal(K._logmar("6/60"), 1); assert.equal(K._logmar("6/12"), 0.3);
  assert.match(K._whoVision("6/12", "6/60"), /^No visual impairment/);
  assert.match(K._whoVision("6/18", "6/36"), /^Mild/);
  assert.match(K._whoVision("6/24", "6/60"), /^Moderate/);
  assert.match(K._whoVision("6/60", "5/60"), /^Moderate/);
  assert.match(K._whoVision("5/60", "3/60"), /^Severe/);
  assert.match(K._whoVision("2/60", "CF"), /^Blindness/);
  assert.match(K._whoVision("NPL", "6/9"), /^No visual impairment/, "the better eye decides");
  assert.equal(K._whoVision("", ""), null);
});

test("hearing: WHO 2021 grades at every boundary, unilateral loss, tuning-fork patterns", () => {
  [[0, "Normal"], [19.9, "Normal"], [20, "Mild"], [34, "Mild"], [35, "Moderate"], [50, "Moderately severe"], [65, "Severe"], [80, "Profound"], [95, "Complete"]]
    .forEach(([db, g]) => assert.ok(K._whoHearing(db).startsWith(g), db + " dB"));
  assert.match(K._whoHearing(15, 40), /^Unilateral/);
  assert.match(K._tuningFork("Right", "Negative", "Positive"), /Conductive hearing loss in the right ear/);
  assert.match(K._tuningFork("Right", "Positive", "Positive"), /Sensorineural hearing loss in the left ear/);
  assert.match(K._tuningFork("Central", "Positive", "Positive"), /^Normal/);
  assert.equal(K._tuningFork("", "Positive", "Positive"), null);
});

test("PASI: area bands and the 72 maximum", () => {
  [[0, 0], [5, 1], [9.9, 1], [10, 2], [29, 2], [30, 3], [50, 4], [70, 5], [90, 6], [100, 6]].forEach(([p, a]) => assert.equal(K._pasiArea(p), a, p + "%"));
  const all = {}; ["head", "upper", "trunk", "lower"].forEach((r) => { all[r + "_a"] = 100; all[r + "_e"] = 4; all[r + "_i"] = 4; all[r + "_d"] = 4; });
  assert.equal(K._pasi(all), 72);
  assert.equal(K._pasi({ trunk_a: 20, trunk_e: 2, trunk_i: 1, trunk_d: 1 }), 2.4);
  assert.equal(K._pasi({}), null);
});

test("DMFT counts decayed, missing for caries and filled only", () => {
  assert.deepEqual(K._dmft({ 16: "D", 26: "F", 36: "M", 46: "X", 11: "C", 21: "R" }, false), { d: 1, m: 1, f: 1, total: 3 });
  assert.deepEqual(K._dmft({ 55: "D", 65: "D", 16: "D" }, true), { d: 2, m: 0, f: 0, total: 2 }, "primary chart ignores permanent teeth");
});

/* ================================ composing text ================================ */
test("a section composes only what was filled, with units and formatted dates", () => {
  const sec = { title: "Current pregnancy", fields: [
    { id: "a", label: "Booking", type: "select" }, { id: "b", label: "SFH", type: "number", unit: "cm" },
    { id: "c", label: "Reduced movements", type: "check" }, { id: "d", label: "Scan date", type: "date" }, { id: "e", label: "Empty", type: "text" }] };
  assert.equal(K._composeSection(sec, { a: "Booked", b: "28", c: true, d: "2026-03-12", e: " " }),
    "Current pregnancy: Booking: Booked; SFH: 28 cm; Reduced movements; Scan date: 12 Mar 2026.");
  assert.equal(K._composeSection(sec, {}), "");
});

test("tool texts carry the computed result, and growth fills weight, height and MUAC", () => {
  const T = K._tools;
  assert.match(T["pregnancy-dating"].text({ lmp: "2026-01-01", asOf: "2026-03-12" }), /EDD 8 Oct 2026 \(by LMP\); gestation 10\+0 weeks/);
  assert.deepEqual(T["pregnancy-dating"].sets({ lmp: "2026-01-01" }), { LMP: "1 Jan 2026" });
  const g = { sex: "Female", dob: "2023-01-01", asOf: "2025-09-25", weight: "11", lenhei: "88", measured: "Standing (height)", muac: "13.5" };
  assert.match(T["growth-who"].text(g), /^Growth \(WHO Child Growth Standards \(0 to 5 years\), age 2 y 8 m\): Weight-for-age z /);
  assert.deepEqual(T["growth-who"].sets(g), { Weight: "11", Height: "88", muac_cm: "13.5" });
  assert.match(T["visual-acuity"].text({ re: "6/9", le: "6/60", reIop: "24" }), /VA presenting RE 6\/9, LE 6\/60; IOP RE 24, LE - mmHg; No visual impairment/);
  assert.match(T["visual-acuity"].out({ reIop: "24" }), /above 21 mmHg/);
  assert.match(T.hearing.text({ weber: "Left", rinneL: "Negative", rinneR: "Positive" }), /Conductive hearing loss in the left ear likely/);
  assert.equal(T.odontogram.text({}), "");
  assert.equal(T.pasi.text({ trunk_a: 20, trunk_e: 2, trunk_i: 1, trunk_d: 1 }), "PASI 2.4.");
});

test("milestones tool: checkpoint picker from the CDC data and an achieved / not-yet summary", () => {
  const T = K._tools.milestones;
  const a = BUNDLE.data.milestones.ages.find((x) => x.months === 12);
  const done = {}; a.domains[0].items.forEach((_, i) => { done["12:" + a.domains[0].id + ":" + i] = true; });
  const txt = T.text({ age: "12", done });
  const total = a.domains.reduce((n, d) => n + d.items.length, 0);
  assert.match(txt, new RegExp("^Developmental milestones \\(1 year checkpoint, CDC 2022\\): achieved " + a.domains[0].items.length + " of " + total + "; not yet: "));
  assert.match(T.form({ age: "12" }), /<option value="12" selected>/);
});

/* ================================ rendering ================================ */
function fakeHost(over) {
  return Object.assign({ kind: "opd", canWrite: () => true, ready: () => true, readyNote: () => "Loading the assessment…", addLabel: () => "Add",
    fieldLabel: (n) => "Label of " + n, insert() {}, repaint() {}, protocol() {}, calculator: null, investigate() {}, openTab() {}, setScribe() {},
    patient: () => ({ sex: "F" }) }, over || {});
}
test("every kit renders for the OPD host and the standalone host without undefined, NaN or dashes", () => {
  BUNDLE.kits.forEach((kit, i) => {
    [fakeHost(), fakeHost({ kind: "standalone", addLabel: () => "Copy", investigate: null, openTab: null, calculator() {} })].forEach((host, j) => {
      const key = "t" + i + "-" + j;
      K.state(key).kitId = kit.id;
      const html = K.html({ host, key });
      assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/, kit.id);
      assert.doesNotMatch(html, /[–—]/, kit.id + " has an em or en dash");
      kit.sections.forEach((s) => assert.ok(html.includes('data-kit-sec="' + s.id + '"'), kit.id + "/" + s.id));
      assert.equal(html.includes("Investigations</h3>"), host.kind === "opd" && kit.investigations.length > 0);
      assert.equal(html.includes("Calculators</h3>"), host.kind === "standalone" && kit.calculators.length > 0);
      assert.ok(html.includes("pending clinical review") || kit.review.status !== "ai_drafted");
    });
  });
});

test("OPD host: Add buttons are disabled until the assessment is loaded, and say where the text goes", () => {
  K.state("ro").kitId = "obgyn";
  let html = K.html({ host: fakeHost({ ready: () => false }), key: "ro" });
  assert.ok(html.includes("Loading the assessment…"));
  assert.match(html, /data-kit-act="sec:obstetric-history" disabled/);
  html = K.html({ host: fakeHost({ canWrite: () => false, writeNote: () => "This assessment is authorised and locked in GHIS." }), key: "ro" });
  assert.ok(html.includes("authorised and locked"));
  html = K.html({ host: fakeHost(), key: "ro" });
  assert.match(html, /data-kit-act="sec:obstetric-history">[^<]*<span[^>]*>playlist_add<\/span>Add to Label of Others/);
  assert.match(html, /data-kit-act="tool:pregnancy-dating">/);
});

test("growth tool takes the patient's sex from the OPD host; kit state is per consult and can be forgotten", () => {
  K.state("g1").kitId = "paediatrics";
  const html = K.html({ host: fakeHost({ patient: () => ({ sex: "Male" }) }), key: "g1" });
  assert.match(html, /<option value="Male" selected>/);
  K.state("g1").vals.x = 1;
  K.forget("g1");
  assert.deepEqual(K.state("g1").vals, {});
});

test("a kit chip with a default kit and 'my specialty' picks the right kit", () => {
  const html = K.html({ host: fakeHost(), key: "d1", defaultKit: "paediatrics" });
  assert.match(html, /data-kit-act="kit:paediatrics" aria-pressed="true"/);
  const html2 = K.html({ host: fakeHost(), key: "d2", defaultKit: "not-a-kit" });
  assert.match(html2, /data-kit-act="kit:obgyn" aria-pressed="true"/, "unknown default falls back to the first kit");
});

/* ================================ OPD EMR integration ================================ */
test("OPD EMR: Specialty tab sits after Assessment and renders the kit with the OPD host", () => {
  globalThis.SMD_QUEUE_FLAGS = { bool: () => true };
  globalThis.SMD_KITS = K;
  const OPDEMR = require("../opd-emr.js");
  const st = OPDEMR._state();
  Object.assign(st, { loading: false, error: "", tab: "kit", patient: { name: "T", mrn: "M1", sex: "Female" }, writeOn: true, assessLoaded: true, assessVals: {} });
  const html = OPDEMR._render(st);
  const tabs = [...html.matchAll(/data-oe-act="tab:([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(tabs[tabs.indexOf("assess") + 1], "kit");
  assert.match(html, /data-kit-host="opd"/);
  assert.match(html, /Add to Menstrual - others|Add to /);
  globalThis.SMD_KITS = { on: () => false };
  const off = OPDEMR._render(st);
  assert.ok(![...off.matchAll(/data-oe-act="tab:([a-z]+)"/g)].some((m) => m[1] === "kit"), "flag off hides the tab");
  globalThis.SMD_KITS = K;
});

test("OPD kit host: Add appends to the assessment (textarea on a new line, text fields with '; ') and fills set fields", () => {
  globalThis.SMD_KITS = K;
  const OPDEMR = require("../opd-emr.js");
  const host = OPDEMR.kitHost, st = OPDEMR._state();
  Object.assign(st, { tab: "kit", writeOn: true, assessLoaded: true, assessLoading: false, assessErr: "", assessAuthorized: null,
    assessVals: { History_present_illness: "Fever 2 days", Nutrtion: "Thin" }, assessTouched: {} });
  globalThis.document = globalThis.document || { getElementById: () => null, createElement: () => ({ setAttribute() {}, classList: { add() {}, remove() {} } }), body: { appendChild() {} }, documentElement: { classList: { add() {}, remove() {} } }, querySelector: () => null };
  try { host.insert("History_present_illness", "Pregnancy dating: EDD 8 Oct 2026.", { LMP: "1 Jan 2026", Diet: "vegetarian", children_living: "2" }); } catch (e) { /* paint() needs a DOM; state is already written */ }
  assert.equal(st.assessVals.History_present_illness, "Fever 2 days\nPregnancy dating: EDD 8 Oct 2026.");
  assert.equal(st.assessVals.LMP, "1 Jan 2026");
  assert.equal(st.assessVals.Diet, "Vegetarian", "select values snap to the form's own option");
  assert.equal(st.assessVals.children_living, "2");
  assert.equal(st.assessTouched.History_present_illness, true);
  try { host.insert("Nutrtion", "Growth: normal.", {}); } catch (e) {}
  assert.equal(st.assessVals.Nutrtion, "Thin; Growth: normal.");
  try { host.insert("Nutrtion", "Growth: normal.", {}); } catch (e) {}
  assert.equal(st.assessVals.Nutrtion, "Thin; Growth: normal.", "the same text is never added twice");
  assert.equal(host.fieldLabel("Nutrtion"), "Nutrition", "the form's label, not the raw key");
  assert.equal(host.fieldLabel("History_present_illness"), "Present history");
  st.assessAuthorized = { by: "x" };
  assert.equal(host.canWrite(), false);
  assert.match(host.writeNote(), /authorised and locked/);
});
