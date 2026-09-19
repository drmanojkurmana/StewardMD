/* test/medcore-changes.test.mjs — "what changed", and the four ways it could become noise. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState } from "../medcore/medcore-state.js";
import { changes } from "../medcore/medcore-changes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const BANDS = JSON.parse(readFileSync(join(ROOT, "medcore/data/change-bands.json"), "utf8"));
const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;
const obs = (param, pairs) => pairs.map(([v, m]) => ({ param, value: v, at: min(m), source: "icu-state" }));
const state = (observations, over) => buildState(DEPS, Object.assign({ asOf: NOW, patient: { ageYears: 65 }, observations }, over || {}));
const find = (rows, p) => rows.find((r) => r.param === p);

test("changes: a falling MAP is reported with its size, its direction and how long it took", () => {
  const s = state(obs("map", [[78, 180], [70, 120], [62, 60], [55, 10]]));
  const c = find(changes(s, BANDS), "map");
  assert.equal(c.direction, "down");
  assert.equal(c.from, 78);
  assert.equal(c.to, 55);
  assert.equal(c.delta, -23);
  assert.equal(c.overMin, 170);
  assert.equal(c.magnitude, "large");
  assert.equal(c.concerning, true);
  assert.equal(c.unit, "mmHg");
});

test("changes: the bands are absolute, so equal percentages are not equal events", () => {
  // 5 percent moves: sodium 140 -> 133 is a moderate fall, heart rate 100 -> 95 does not register.
  const na = find(changes(state(obs("na", [[140, 300], [133, 30]])), BANDS), "na");
  assert.equal(na.magnitude, "moderate");
  assert.equal(na.delta, -7);
  const hr = changes(state(obs("hr", [[100, 120], [95, 10]])), BANDS);
  assert.equal(find(hr, "hr"), undefined, "a 5 bpm move is not worth a line");
});

test("changes: a trend may not end on a value we have refused", () => {
  // The newest SpO2 is stale, so the parameter is unusable and reports no change at all, even
  // though the earlier points would have made a dramatic one.
  const s = state(obs("spo2", [[98, 900], [88, 600]]));
  assert.equal(s.params.spo2.usable, false);
  assert.deepEqual(changes(s, BANDS), []);
});

test("changes: a refused reading cannot become the START of a trend either", () => {
  const s = state([
    { param: "creat", value: 180, unit: "mg/dL", at: min(600), source: "ghis-adapter" },   // IMPLAUSIBLE
    { param: "creat", value: 2.1, unit: "mg/dL", at: min(30), source: "ghis-adapter" }
  ]);
  assert.equal(s.params.creat.value, 2.1);
  assert.deepEqual(changes(s, BANDS), [], "there is only one usable point, so there is no change");
});

test("changes: two readings a minute apart are not a trajectory", () => {
  const s = state(obs("k", [[5.2, 11], [6.4, 10]]));
  assert.deepEqual(changes(s, BANDS), [], "1 minute apart is below the minimum separation");
  const ok = state(obs("k", [[5.2, 200], [6.4, 10]]));
  assert.equal(find(changes(ok, BANDS), "k").magnitude, "large");
});

test("changes: the comparison window is per parameter, not the whole lookback", () => {
  // A MAP from 20 hours ago is inside the state's lookback but outside the MAP comparison window,
  // so "falling" is measured over the last four hours, not the last day.
  const s = state(obs("map", [[95, 1200], [70, 200], [60, 20]]));
  const c = find(changes(s, BANDS), "map");
  assert.equal(c.from, 70, "not 95");
  assert.equal(c.delta, -10, "measured over the last four hours, not the last day");
  assert.equal(c.overMin, 180);
});

test("changes: the list is ranked by band, then by the direction worth mentioning, then stably", () => {
  const s = state([].concat(
    obs("map", [[78, 180], [55, 10]]),          // large, concerning
    obs("hr", [[98, 180], [128, 10]]),          // large, concerning (both directions matter)
    obs("temp", [[37.0, 180], [37.6, 10]]),     // small
    obs("na", [[138, 300], [134, 30]])          // small
  ));
  const rows = changes(s, BANDS);
  assert.equal(rows[0].param, "map", "MAP outranks HR at the same band by the table's own order");
  assert.equal(rows[1].param, "hr");
  assert.ok(rows.findIndex((r) => r.param === "temp") > 1);
  assert.deepEqual(rows.map((r) => r.magnitude), ["large", "large", "small", "small"]);
});

test("changes: a move in the unconcerning direction is still reported, just ranked lower", () => {
  const s = state([].concat(
    obs("lactate", [[4.1, 200], [2.0, 20]]),    // falling lactate: good news, still a change
    obs("bili", [[1.0, 1200], [4.5, 30]])       // rising bilirubin: the concerning direction
  ));
  const rows = changes(s, BANDS);
  assert.equal(find(rows, "lactate").concerning, false);
  assert.equal(find(rows, "bili").concerning, true);
  assert.equal(rows[0].param, "bili", "same band, the concerning direction first");
});

test("changes: the list is capped", () => {
  const many = [];
  for (const p of ["map", "sbp", "spo2", "rr", "hr", "gcs", "temp"]) {
    const lo = { map: 78, sbp: 130, spo2: 99, rr: 12, hr: 70, gcs: 15, temp: 36.5 }[p];
    const hi = { map: 50, sbp: 90, spo2: 88, rr: 30, hr: 130, gcs: 9, temp: 39 }[p];
    many.push(...obs(p, [[lo, 200], [hi, 10]]));
  }
  const rows = changes(state(many), BANDS);
  assert.equal(rows.length, 5, "five, as the table says");
  assert.equal(changes(state(many), BANDS, { max: 2 }).length, 2);
});

test("changes: an explicit previous state wins over the series", () => {
  const prev = state(obs("map", [[95, 100]]), {});
  const now = state(obs("map", [[80, 60], [78, 10]]));
  const c = find(changes(now, BANDS, { prev: prev }), "map");
  assert.equal(c.basis, "prev-state");
  assert.equal(c.from, 95);
  assert.equal(c.delta, -17);
});

test("changes: the band table is unapproved content and says so", () => {
  assert.equal(BANDS.approvalStatus, "unapproved");
  for (const p of Object.keys(BANDS.params)) {
    const d = BANDS.params[p];
    assert.ok(d.small < d.moderate && d.moderate < d.large, p + " bands must be ordered");
    assert.ok(["up", "down", "both"].includes(d.concern), p + " needs a concern direction");
  }
  const src = readFileSync(join(ROOT, "medcore/medcore-changes.js"), "utf8");
  assert.ok(!/document\.|fetch\(|Date\.now/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "pure");
  assert.throws(() => changes({}, null), /band table is required/);
});
