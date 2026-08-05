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

test("parseState turns field records into a history object", () => {
  const recs = [
    { field: "itch", value: "severe", pressed: true },
    { field: "scale", value: "greasy", pressed: false },   // not selected -> dropped
    { field: "onset", value: "chronic", pressed: true },
    { field: "bleeding", isCheckbox: true, checked: true },
    { field: "changing", isCheckbox: true, checked: false }, // unchecked -> dropped
    { field: "site", value: "flexures", pressed: true },
    { field: "site", value: "hands/feet", pressed: true },
    { field: "abcde-asymmetry", isCheckbox: true, checked: true },
    { field: "note", text: "  3 weeks, spreading  " }
  ];
  const h = H.parseState(recs);
  assert.equal(h.itch, "severe");
  assert.equal(h.scale, undefined);
  assert.equal(h.onset, "chronic");
  assert.equal(h.bleeding, true);
  assert.equal(h.changing, undefined);
  assert.deepEqual(h.site, ["flexures", "hands/feet"]);
  assert.deepEqual(h.abcde, { asymmetry: true });
  assert.equal(h.note, "3 weeks, spreading");
});

test("readForm reads a rendered form (fake root) into a history object", () => {
  // faithful-enough fake: querySelectorAll('[data-field]') returns the el records readForm reads.
  const els = [
    { getAttribute: (a) => ({ "data-field": "itch", "data-value": "mild", "aria-pressed": "true" })[a] || null },
    { getAttribute: (a) => ({ "data-field": "bleeding", type: "checkbox" })[a] || null, type: "checkbox", checked: true },
    { getAttribute: (a) => ({ "data-field": "note" })[a] || null, value: "sun exposed area" }
  ];
  const root = { querySelectorAll: (sel) => (sel === "[data-field]" ? els : []) };
  const h = H.readForm(root);
  assert.equal(h.itch, "mild");
  assert.equal(h.bleeding, true);
  assert.equal(h.note, "sun exposed area");
});

test("readForm on a null/empty root is safe", () => {
  assert.deepEqual(H.readForm(null), {});
  assert.deepEqual(H.readForm({}), {});
});
