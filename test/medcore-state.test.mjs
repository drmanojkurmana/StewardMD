/* test/medcore-state.test.mjs — the canonical state, and the leakage control that is its whole point. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState, fromIcuState, toMs, UNUSABLE } from "../medcore/medcore-state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;

function icu(over) {
  return Object.assign({
    patient: { age: 65, sex: "M", weightKg: 72 },
    vitals: [
      { ts: min(180), hr: 98, sbp: 120, dbp: 70, spo2: 96 },
      { ts: min(60), hr: 119 },
      { ts: min(10), hr: 128, rr: 31 }
    ],
    labs: { recent: { k: 5.2, creat: 2.1, lactate: 4.1 } },
    src: { k: { ts: min(120) }, creat: { ts: min(200) }, lactate: { ts: min(90) } },
    infusions: [{ drug: "Noradrenaline" }]
  }, over || {});
}

test("state: asOf is required and is the only clock", () => {
  assert.throws(() => fromIcuState(DEPS, icu(), {}), /asOf is required/);
  // Strip comments first: the header explains the rule by naming the call, and a test that cannot
  // tell an explanation from an invocation would force the explanation out of the file.
  const src = readFileSync(join(ROOT, "medcore/medcore-state.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/Date\.now\s*\(/.test(src), "the state builder must never read the wall clock");
  assert.ok(!/fetch\s*\(|localStorage|document\./.test(src), "no I/O, no DOM");
});

test("state: nothing recorded after asOf is visible, and the drop is counted", () => {
  const withFuture = icu({
    vitals: [{ ts: min(30), hr: 90 }, { ts: NOW + 60000, hr: 150 }]
  });
  const s = fromIcuState(DEPS, withFuture, { asOf: NOW });
  assert.equal(s.params.hr.value, 90, "the future reading must not become the current one");
  assert.ok(s.provenance.rejected.some((r) => r.reason === "AFTER_ASOF"));
});

test("state: rewinding asOf reproduces what the bedside had at that instant", () => {
  const earlier = fromIcuState(DEPS, icu(), { asOf: min(50) });
  assert.equal(earlier.params.hr.value, 119, "at 50 minutes ago the newest HR was the 119 charted at 60");
  assert.equal(earlier.params.rr, undefined, "the RR charted later must not exist at all yet");
  const nowState = fromIcuState(DEPS, icu(), { asOf: NOW });
  assert.equal(nowState.params.hr.value, 128);
  assert.equal(nowState.params.rr.value, 31);
});

test("state: a sparse save does not blank a parameter charted separately (the mergedVitals trap)", () => {
  // ingestMonitor() pushes a NEW ROW per save containing only the fields just entered. The
  // newest-timestamp row here has no SpO2 at all; SpO2 was charted three hours ago and is still
  // inside its window, so it must still be the current value.
  const s = fromIcuState(DEPS, icu(), { asOf: NOW });
  assert.equal(s.params.spo2.value, 96);
  assert.equal(s.params.spo2.ageMin, 180);
  assert.equal(s.params.sbp.value, 120);
});

test("state: stale is refused as stale, and says what the old value was", () => {
  const s = fromIcuState(DEPS, icu({ src: { lactate: { ts: min(600) } }, labs: { recent: { lactate: 4.1 } } }),
    { asOf: NOW });
  const p = s.params.lactate;
  assert.equal(p.usable, false);
  assert.equal(p.refusal, UNUSABLE.STALE);
  assert.equal(p.value, null, "a stale value is not a current value");
  assert.equal(p.staleValue, 4.1, "but it is still the answer to 'when was this last done'");
  assert.equal(p.windowMin, 360);
  assert.deepEqual(s.series.lactate, [], "a stale parameter contributes no trend");
});

test("state: an observation older than the lookback is remembered as evidence of last-done", () => {
  const s = fromIcuState(DEPS, icu({ src: { creat: { ts: min(60 * 30) } }, labs: { recent: { creat: 2.1 } } }),
    { asOf: NOW });
  assert.equal(s.params.creat.refusal, UNUSABLE.STALE);
  assert.equal(s.params.creat.ageMin, 1800);
  assert.equal(s.params.creat.staleValue, 2.1);
});

test("state: a lab with no recorded time cannot be aged and is dropped, not treated as current", () => {
  const s = fromIcuState(DEPS, icu({ src: {} }), { asOf: NOW });
  assert.equal(s.params.k, undefined);
  assert.ok(s.provenance.rejected.some((r) => r.param === "k" && r.reason === "NO_TIMESTAMP"));
});

test("state: a refused unit propagates as a refusal, never as a value", () => {
  const s = buildState(DEPS, {
    asOf: NOW,
    observations: [{ param: "creat", value: 180, unit: "mg/dL", at: min(10), source: "ghis-adapter" }],
    patient: { ageYears: 40 }
  });
  assert.equal(s.params.creat.usable, false);
  assert.equal(s.params.creat.refusal, "IMPLAUSIBLE");
  assert.equal(s.params.creat.value, null);
  assert.equal(s.params.creat.sourceValue, 180);
});

test("state: a parameter with no declared freshness window fails closed", () => {
  const noWindow = { unitTable: DEPS.unitTable, freshness: { windows: { hr: 240 } } };
  const s = buildState(noWindow, {
    asOf: NOW,
    observations: [{ param: "k", value: 5.2, at: min(5), source: "icu-state" }],
    patient: {}
  });
  assert.equal(s.params.k.refusal, UNUSABLE.NO_WINDOW);
  assert.equal(s.params.k.value, null);
});

test("state: unknown is null, not false", () => {
  const s = fromIcuState(DEPS, icu({ infusions: [], ventilator: {} }), { asOf: NOW });
  assert.equal(s.interventions.ventilation.active, null, "an unfilled ventilator tab is not 'not ventilated'");
  assert.equal(s.interventions.rrt.active, null);
  assert.equal(s.interventions.vasopressor.active, null, "an empty infusion list charted by nobody is unknown");

  const charted = fromIcuState(DEPS, icu({ infusions: [{ drug: "Fentanyl" }] }), { asOf: NOW });
  assert.equal(charted.interventions.vasopressor.active, false, "a charted list without a pressor IS an answer");
  const onPressor = fromIcuState(DEPS, icu(), { asOf: NOW });
  assert.equal(onPressor.interventions.vasopressor.active, true);
  assert.deepEqual(onPressor.interventions.vasopressor.agents, ["Noradrenaline"]);
});

test("state: the series is oldest first, capped, and carries only usable values", () => {
  const rows = [];
  for (let i = 100; i >= 1; i--) rows.push({ ts: min(i), hr: 60 + i });
  const s = fromIcuState(DEPS, icu({ vitals: rows }), { asOf: NOW, windows: { lookbackHours: 24, seriesCapPerParam: 10 } });
  assert.equal(s.series.hr.length, 10);
  assert.equal(s.series.hr[0].v, 70, "oldest of the kept window first");
  assert.equal(s.series.hr[9].v, 61);
  for (let i = 1; i < s.series.hr.length; i++) {
    assert.ok(Date.parse(s.series.hr[i].at) > Date.parse(s.series.hr[i - 1].at));
  }
});

test("state: no identifier reaches the state", () => {
  const s = fromIcuState(DEPS, icu({ patient: { age: 65, sex: "M", name: "Real Name", mrn: "MRN-99887", hospital: "GIMSR" } }),
    { asOf: NOW, subjectKey: "opaque-1" });
  const json = JSON.stringify(s);
  assert.ok(!/Real Name/.test(json), "no name");
  assert.ok(!/MRN-99887/.test(json), "no MRN");
  assert.equal(s.subjectKey, "opaque-1", "the caller supplies the handle; the state never derives one");
});

test("state: the result is frozen so a consumer cannot edit the record it was given", () => {
  const s = fromIcuState(DEPS, icu(), { asOf: NOW });
  assert.throws(() => { s.params.hr.value = 200; }, TypeError);
  assert.throws(() => { s.series.hr.push({ v: 1 }); }, TypeError);
});

test("state: toMs refuses the adapter's deliberate non-date", () => {
  assert.equal(toMs("0000-00-00"), null);
  assert.equal(toMs("0000-00-00T00:00:00Z"), null);
  assert.equal(toMs(""), null);
  assert.equal(toMs(NOW), NOW);
  assert.equal(toMs("2026-09-19T10:04:00Z"), NOW);
});
