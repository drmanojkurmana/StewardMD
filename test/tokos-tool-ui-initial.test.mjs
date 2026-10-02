// The app's form (specialty-tools.js initial()) starts every number and date input as null, every bool as false and
// every select at its first option, and sends null for a cleared field. Each pinned example must still compute the
// same result when the keys it leaves out arrive in that shape. Bishop and anti-D (BSH) failed this before.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./tokos-tool-helpers.mjs";

const IDS = ["antid", "apgar", "bishop", "dipsi", "edd", "efw", "ganzoni", "mec", "meows", "mgso4", "rmi", "vbac", "weightgain"];
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

test("mgso4: the reflex starts as 'not checked' in the app, so a maintenance check asks for it instead of withholding", () => {
  const m = load("mgso4");
  const r = m.compute({ ...initial(m), regimen: "pritchard", phase: "maintenance", rr: 18, urine4h: 200 });
  assert.equal(r.ok, false);
  assert.match(r.error.en, /patellar reflex/);
});
