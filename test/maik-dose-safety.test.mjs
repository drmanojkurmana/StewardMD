/* MaiK dose answers carry intrinsic drug-safety flags (QT-prolonging, renal clearance) + a
 * verify-this-patient line. node --test test/maik-dose-safety.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
global.window = global;
const KB = require("../kb/ai/maik-kb.js");
const note = KB._doseSafetyNote;

test("flags QT-prolonging drugs", () => {
  const n = note("azithromycin ondansetron");
  assert.match(n, /QT-prolonging/i);
  assert.match(n, /azithromycin/i);
});
test("flags renally-cleared drugs", () => {
  const n = note("vancomycin metformin");
  assert.match(n, /Renally cleared/i);
  assert.match(n, /vancomycin/i);
});
test("always appends the verify-this-patient line, even for a plain drug", () => {
  const n = note("paracetamol");
  assert.match(n, /Verify against THIS patient/i);
  assert.doesNotMatch(n, /QT-prolonging/i);   // paracetamol isn't flagged
});
