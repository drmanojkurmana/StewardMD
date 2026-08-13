/* test/opd-alcohol.test.mjs — alcohol quantification + habit-field voice mapping.
 * "60 ml whisky" -> 24 ml pure alcohol -> x0.79 = ~19 g -> /14 (1 US standard drink) = ~1.4 SD.
 * node --test test/opd-alcohol.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const OPD = require("../opd-emr.js");
const { _alcoholCalc, VOICE_MAP, _voiceMerge } = OPD;

test("alcoholCalc: 60 ml whisky -> 24 ml pure, ~19 g, ~1.4 standard drinks", () => {
  const a = _alcoholCalc("60 ml whisky per day");
  assert.equal(a.pureMl, 24, "60 x 40% = 24 ml pure alcohol");
  assert.equal(a.grams, 19, "24 x 0.79 = ~19 g (rounded)");
  assert.equal(a.std, 1.4, "19 / 14 = ~1.4 standard drinks");
});

test("alcoholCalc: other drinks + units", () => {
  assert.equal(_alcoholCalc("750 ml wine").std, 5.1);     // 750 x .12 x .79 / 14
  assert.equal(_alcoholCalc("1 litre beer daily").std, 2.8); // 1000 x .05 x .79 / 14
});

test("alcoholCalc: no volume or unknown drink -> null", () => {
  assert.equal(_alcoholCalc("2 pegs whisky"), null, "peg is not a fixed volume");
  assert.equal(_alcoholCalc("drinks occasionally"), null);
  assert.equal(_alcoholCalc(""), null);
});

test("habit flags map to the GHIS Personal-history fields + coerce to checkbox/radio", () => {
  assert.equal(VOICE_MAP.alcohol, "Habitat_addiction_alcohol");
  assert.equal(VOICE_MAP.smoking, "Habitat_addiction_smoking");
  assert.equal(VOICE_MAP.habits, "Habitat_addiction_yesno");
  const m = _voiceMerge({}, {}, [{ field: "alcohol", value: "Yes", applied: true }, { field: "habits", value: "Yes", applied: true }]);
  assert.equal(m.vals.Habitat_addiction_alcohol, "true", "alcohol check -> true");
  assert.equal(m.vals.Habitat_addiction_yesno, "Y", "habits yes/no -> Y");
});
