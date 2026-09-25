/* test/camicu.test.mjs — CAM-ICU, the one ICU score calculators.js was missing.
 *
 * The two ways a CAM-ICU implementation goes wrong are both failures of logic rather than
 * arithmetic, so they are what this file asserts: it is a SEQUENCE (1 and 2, then 3 or 4), not a
 * sum of features; and a patient at RASS -4 or -5 is UNASSESSABLE, never negative. Reporting "no
 * delirium" for a patient nobody could assess is the false reassurance the instrument exists to
 * prevent.
 *
 * node --test test/camicu.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const g = {
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, querySelector: () => null }), addEventListener() {}, body: { classList: { add() {}, remove() {} } }, head: { appendChild() {} } },
  localStorage: { getItem: () => null, setItem() {} }, location: { search: "" }, navigator: {},
};
g.window = g; g.self = g;
vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, "calculators.js"), "utf8"), g, { filename: "calculators.js" });
const M = g.MEDCALC;
const CAM = (M._calcs || []).find((c) => c.id === "camicu");
const run = (v) => CAM.compute(Object.assign({ rass: "0" }, v));

test("camicu: the calculator exists and sits with the other critical-care scores", () => {
  assert.ok(CAM, "camicu must be a shipped calculator");
  assert.equal(CAM.cat, "Critical care");
  assert.equal(CAM.inputs.length, 5, "RASS gate plus the four features");
  // Joined rather than deep-compared: calculators.js runs in a vm realm, so its arrays have a
  // different Array.prototype and deepStrictEqual rejects them on identity alone.
  assert.equal(CAM.inputs.map((i) => i.id).join(","), "rass,f1,f2,f3,f4");
});

test("camicu: positive requires 1 AND 2 AND (3 OR 4)", () => {
  assert.equal(run({ f1: true, f2: true, f3: true }).v, "Positive");
  assert.equal(run({ f1: true, f2: true, f4: true }).v, "Positive");
  assert.equal(run({ f1: true, f2: true, f3: true, f4: true }).v, "Positive");
});

test("camicu: it is a sequence, not a sum - three features can still be negative", () => {
  // Inattention, altered consciousness and disorganised thinking, but no acute change or
  // fluctuation. A scoring implementation that added features up would call this positive.
  const r = run({ f2: true, f3: true, f4: true });
  assert.equal(r.v, "Negative");
  assert.match(r.i, /Feature 1 absent/);

  // Acute change plus both of 3 and 4, but attention intact. Inattention is required.
  const s = run({ f1: true, f3: true, f4: true });
  assert.equal(s.v, "Negative");
  assert.match(s.i, /inattention/i);
});

test("camicu: features 1 and 2 alone are not enough", () => {
  const r = run({ f1: true, f2: true });
  assert.equal(r.v, "Negative");
  assert.match(r.i, /neither Feature 3 nor Feature 4/);
});

test("camicu: a deeply sedated patient is UNASSESSABLE, never negative", () => {
  const r = CAM.compute({ rass: "1", f1: false, f2: false, f3: false, f4: false });
  assert.equal(r.v, "UTA");
  assert.match(r.i, /NOT a negative result/);
  assert.match(r.i, /reassess/i);
  // Even with every feature ticked, an unassessable patient has no CAM-ICU result.
  const s = CAM.compute({ rass: "1", f1: true, f2: true, f3: true, f4: true });
  assert.equal(s.v, "UTA");
});

test("camicu: the result always shows which features were present, and cites the source", () => {
  const r = run({ f1: true, f2: true, f3: true });
  assert.match(r.i, /Features: 1 \+, 2 \+, 3 \+, 4 −/);
  assert.match(r.i, /Ely, JAMA 2001/);
  assert.match(run({}).i, /Ely, JAMA 2001/);
});

test("camicu: a doctor typing the name finds it, and does NOT get the general CAM", () => {
  assert.equal(M.find("CAM-ICU").id, "camicu");
  assert.equal(M.find("cam icu").id, "camicu");
  // The two are different instruments for different patients and both must stay reachable: CAM
  // (Inouye 1990) needs a patient who can be interviewed, CAM-ICU (Ely 2001) does not.
  assert.equal(M.find("confusion assessment method").id, "cam");
  const general = (M._calcs || []).find((c) => c.id === "cam");
  assert.ok(general, "the general CAM must still exist");
  assert.equal(general.cat, "Neurology");
  assert.match(CAM.desc, /Distinct from the general CAM/);
});
