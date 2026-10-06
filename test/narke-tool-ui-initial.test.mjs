// The app's form (specialty-tools.js initial()) starts every number and date input as null, every bool as false and
// every select at its first option, and sends null for a cleared field. Each pinned example must still compute the
// same result when the keys it leaves out arrive in that shape. Narke copy of the Tokos check.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./narke-tool-helpers.mjs";

const IDS = ["asa", "maintenance-fluids", "fasting-deficit", "mabl", "la-maxdose", "paeds-ett", "dosing-weight", "stopbang", "apfel", "rcri", "pf-ratio", "airway-predict"];
const initial = (m) => Object.fromEntries(m.inputs.map((i) => [i.id, i.type === "bool" ? false : i.type === "select" ? i.options[0].value : null]));

for (const id of IDS) {
  test(`${id}: every example computes the same from the app's initial form values`, () => {
    const m = load(id);
    m.examples.forEach((e, n) => {
      const r = m.compute({ ...initial(m), ...e.values });
      assert.equal(r.ok, true, `example ${n}: ${r.error && r.error.en}`);
      for (const k of Object.keys(e.expect)) {
        const got = k === "label" ? r.label.en : r[k];
        if (e.tol !== undefined && k === "value") assert.ok(Math.abs(got - e.expect[k]) <= e.tol, `example ${n} ${k}`);
        else assert.equal(got, e.expect[k], `example ${n} ${k}`);
      }
    });
  });
}

test("every tool handles the untouched form (nulls, false, first options) without throwing", () => {
  for (const id of IDS) {
    const m = load(id), r = m.compute(initial(m));
    assert.equal(typeof r.ok, "boolean", id);
    if (!r.ok) assert.ok(r.error.en && r.error.hi, `${id} needs a bilingual error`);
  }
});

