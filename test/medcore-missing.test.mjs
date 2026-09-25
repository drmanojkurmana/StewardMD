/* test/medcore-missing.test.mjs — the union with what the deterministic scores already know. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState } from "../medcore/medcore-state.js";
import { missing, MISSING, CORE_NEEDS, labelFor } from "../medcore/medcore-missing.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const NOW = Date.parse("2026-09-19T10:04:00Z");
const min = (n) => NOW - n * 60000;

function st(observations, patient) {
  return buildState(DEPS, { asOf: NOW, patient: patient || { ageYears: 65 }, observations: observations });
}
const find = (rows, param) => rows.find((r) => r.param === param);

test("missing: a parameter nobody charted is NEVER_RECORDED", () => {
  const rows = missing(st([{ param: "hr", value: 90, at: min(5), source: "icu-state" }]));
  assert.equal(find(rows, "hr"), undefined, "a usable parameter is not missing");
  const gcs = find(rows, "gcs");
  assert.equal(gcs.reason, MISSING.NEVER_RECORDED);
  assert.equal(gcs.label, "Conscious level (GCS)");
});

test("missing: stale carries the old value, because that is a different conversation", () => {
  const rows = missing(st([{ param: "spo2", value: 88, at: min(600), source: "icu-state" }]));
  const s = find(rows, "spo2");
  assert.equal(s.reason, MISSING.STALE);
  assert.equal(s.staleValue, 88);
  assert.equal(s.ageMin, 600);
  assert.equal(s.detail, "older than 240 min");
});

test("missing: a charted but unreadable value is OUR problem, not a repeat test", () => {
  const rows = missing(
    buildState(DEPS, {
      asOf: NOW, patient: {},
      observations: [{ param: "creat", value: 180, unit: "mg/dL", at: min(5), source: "ghis-adapter" }]
    }),
    { needs: ["creat"] }
  );
  const c = find(rows, "creat");
  assert.equal(c.reason, MISSING.REFUSED);
  assert.ok(/IMPLAUSIBLE/.test(c.detail));
});

test("missing: an undeclared freshness window is reported as ours", () => {
  const s = buildState({ unitTable: DEPS.unitTable, freshness: { windows: { hr: 240 } } }, {
    asOf: NOW, patient: {},
    observations: [{ param: "k", value: 5.2, at: min(5), source: "icu-state" }]
  });
  const k = find(missing(s, { needs: ["k"] }), "k");
  assert.equal(k.reason, MISSING.NO_WINDOW);
});

test("missing: the score adapters' __missing is merged in, per parameter not per score", () => {
  const state = st([{ param: "hr", value: 90, at: min(5), source: "icu-state" }]);
  const rows = missing(state, {
    needs: ["hr"],
    scores: [
      { id: "qsofa", label: "qSOFA", __missing: ["RR", "SBP", "GCS"] },
      { id: "news2", label: "NEWS2", __missing: ["RR", "SpO2", "temp", "SBP", "HR", "GCS"] },
      { id: "sofa", label: "SOFA", result: { __missing: ["platelets", "creatinine", "GCS"] } }
    ]
  });
  const gcs = find(rows, "gcs");
  assert.deepEqual(gcs.neededBy.sort(), ["NEWS2", "SOFA", "qSOFA"], "one line, three consumers");
  assert.equal(find(rows, "plt").reason, MISSING.NEVER_RECORDED);
  assert.equal(find(rows, "creat").reason, MISSING.NEVER_RECORDED);
  assert.equal(rows[0].param, "gcs", "the thing the most consumers wait on comes first");
  // HR is present and usable, so NEWS2 naming it must not invent a gap that is not there.
  assert.equal(find(rows, "hr"), undefined);
});

test("missing: a label this layer cannot map is still reported, never dropped", () => {
  const rows = missing(st([]), {
    needs: [],
    scores: [{ id: "cp", label: "Child-Pugh", __missing: ["ascites grade", "encephalopathy grade"] }]
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].param, null);
  assert.ok(rows.map((r) => r.label).includes("ascites grade"));
  assert.equal(rows[0].detail, "not a Medical Core parameter");
  assert.deepEqual(rows[0].neededBy, ["Child-Pugh"]);
});

test("missing: subscript labels from the score cards map correctly", () => {
  const rows = missing(st([]), { needs: [], scores: [{ id: "pf", label: "P/F", __missing: ["PaO₂", "FiO₂"] }] });
  assert.ok(find(rows, "pao2"), "PaO2 with a subscript is still PaO2");
  assert.ok(find(rows, "fio2"));
});

test("missing: age is known not to be a parameter and is not reported as a lab", () => {
  const rows = missing(st([]), { needs: [], scores: [{ id: "apache", label: "APACHE II", __missing: ["age"] }] });
  assert.deepEqual(rows, []);
});

test("missing: the default need set is the observation set a ward already charts", () => {
  assert.deepEqual(CORE_NEEDS, ["rr", "spo2", "hr", "sbp", "temp", "gcs"]);
  const rows = missing(st([]));
  assert.equal(rows.length, CORE_NEEDS.length);
  assert.ok(rows.every((r) => r.reason === MISSING.NEVER_RECORDED));
  assert.equal(labelFor("uop"), "Urine output");
  assert.equal(labelFor("unmapped_thing"), "unmapped_thing");
});

test("missing: nothing is truncated here - the caller decides how short a list to show", () => {
  const rows = missing(st([]), { needs: ["rr", "spo2", "hr", "sbp", "temp", "gcs", "uop", "lactate", "creat", "k"] });
  assert.equal(rows.length, 10);
});
