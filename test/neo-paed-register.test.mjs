/* Neonatal no-safety drugs (data/neo/paed-register.json, neonatal_status "none").
 * Such a drug must show the no-safety note and its register child doses labelled as not neonatal,
 * and never a newborn dose.
 *
 * node --test test/neo-paed-register.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (f) => { const m = { exports: {} }; new Function("module", "window", readFileSync(new URL("../" + f, import.meta.url), "utf8"))(m, undefined); return m.exports; };
load("neo-patient.js");
const DOSE = load("neo-dose.js");
const REG = JSON.parse(readFileSync(new URL("../data/neo/paed-register.json", import.meta.url), "utf8"));
const A = { esc: (s) => String(s), srcLine: () => "" };

test("a neonatal_status none drug renders the note and register child doses, never a neonatal dose", () => {
  assert.equal(REG.drugs.length, 71, "the 71 owner drugs");
  const none = REG.drugs.filter((d) => d.neonatal_status === "none");
  assert.equal(none.length, 71);
  for (const d of none) {
    assert.equal((d.regimens || []).length, 0, `${d.id}: no neonatal regimen may exist`);
    const h = DOSE.paedHtml(d, A, REG);
    assert.ok(h.includes(d.neonatal_note.en), `${d.id}: no-safety note shown`);
    assert.ok(h.includes("Paediatric dose (not neonatal)"), `${d.id}: paediatric block labelled`);
    assert.ok(!h.includes(DOSE.NO_DOSE), `${d.id}: no newborn "no dose" wording`);
    if (d.paediatric.length) {
      for (const p of d.paediatric) {
        assert.equal(p.src, "owner-register-2026-10-10", `${d.id}: register source`);
        assert.ok(h.includes(p.quote), `${d.id}: verbatim child dose shown`);
      }
    } else {
      assert.ok(h.includes("No paediatric dose on file."), `${d.id}: says no child dose`);
    }
  }
  assert.equal(none.filter((d) => d.paediatric.length).length, 23);
});
