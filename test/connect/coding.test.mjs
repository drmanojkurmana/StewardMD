import { test } from "node:test";
import assert from "node:assert/strict";
import { coding, codeable, quantity, reference } from "../../functions/_connect/canonical/coding.js";

test("coding defaults kind to 'standard' and keeps local tag", () => {
  assert.equal(coding({ system: "http://loinc.org", code: "718-7" }).kind, "standard");
  assert.equal(coding({ system: "urn:hospital:x", code: "HB", kind: "local" }).kind, "local");
});

test("codeable REQUIRES a non-empty text fallback", () => {
  assert.throws(() => codeable({ coding: [coding({ code: "x" })] }), /text/);
  assert.equal(codeable({ text: "Hemoglobin" }).text, "Hemoglobin");
});

test("quantity rejects a bad comparator", () => {
  assert.equal(quantity({ value: 1, unit: "mg", comparator: "<" }).comparator, "<");
  assert.throws(() => quantity({ value: 1, comparator: "~" }), /comparator/);
});

test("reference carries type + id", () => {
  assert.deepEqual(reference("Encounter", "e1"), { type: "Encounter", id: "e1" });
});
