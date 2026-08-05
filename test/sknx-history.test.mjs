// test/sknx-history.test.mjs - SknX clinical-history model. Pure historyToFeatures mapping (the danger-
// sign fields -> the exact feature keys sknx-engines.redFlag() reads) + the intake form read (readForm).
import { test } from "node:test";
import assert from "node:assert";
import H from "../sknx-history.js";

test("historyToFeatures maps danger signs to the engine feature keys", () => {
  const f = H.historyToFeatures({ changing: true, bleeding: true, rapidGrowth: true, systemic: true });
  assert.equal(f.evolving, true);
  assert.equal(f.bleeding, true);
  assert.equal(f.ulceration, true);   // "bleeding / non-healing" implies non-healing/ulceration
  assert.equal(f.rapidGrowth, true);
  assert.equal(f.systemicSymptoms, true);
});

test("historyToFeatures maps ABCDE (diameter >=6mm) for pigmented lesions", () => {
  const f = H.historyToFeatures({ abcde: { asymmetry: true, border: true, color: true, diameter6: true } });
  assert.equal(f.asymmetry, true);
  assert.equal(f.borderIrregular, true);
  assert.equal(f.colorVariegation, true);
  assert.equal(f.diameterMm, 6);
});

test("historyToFeatures on empty/undefined history returns an empty features object", () => {
  assert.deepEqual(H.historyToFeatures(), {});
  assert.deepEqual(H.historyToFeatures({ itch: "severe", onset: "chronic" }), {}); // non-danger fields aren't features
});
