/* Annexure section C: the grading systems, as calculators.
 *
 * These are ordinal scales a student will quote in a viva, so the boundaries and the "what does
 * normal mean" cases are what matter. Three traps are asserted explicitly because each is a real
 * error people make:
 *   - NINDS reflex 2 AND 3 are both normal (which is why it beats plus signs);
 *   - a pulse of 3+ is normal, not 2+;
 *   - diastolic murmurs are graded out of FOUR, systolic out of six.
 *
 * Driven through the real MEDCALC.run rather than by re-implementing the scales here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadMedcalc() {
  const src = readFileSync(join(ROOT, "calculators.js"), "utf8");
  const noop = () => {};
  const el = () => ({
    style: {}, classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    appendChild: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null, remove: noop, querySelector: () => null,
    querySelectorAll: () => [], insertAdjacentHTML: noop, focus: noop, click: noop,
    get innerHTML() { return ""; }, set innerHTML(_v) {}, textContent: "", value: "", dataset: {}
  });
  const document = {
    createElement: el, createTextNode: el, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    body: el(), head: el(), documentElement: el(), readyState: "complete"
  };
  const win = {
    document, navigator: { userAgent: "node" }, location: { search: "", href: "" },
    addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop })
  };
  win.window = win; win.globalThis = win; win.self = win;
  vm.runInContext(src, vm.createContext(win), { filename: "calculators.js" });
  assert.ok(win.MEDCALC, "calculators.js did not expose MEDCALC");
  return win.MEDCALC;
}

const MEDCALC = loadMedcalc();
const run = (id, inputs) => MEDCALC.run(id, inputs);

const ADDED = ["ccs_angina", "mrc_power", "ninds_reflex", "levine_murmur",
               "diastolic_murmur", "pulse_grade", "ehra_af", "framingham_hf"];

test("every grading system from the annexure is registered", () => {
  const missing = ADDED.filter((id) => !MEDCALC.get(id));
  assert.deepEqual(missing, [], `not in the catalog: ${missing.join(", ")}`);
});

test("the ones the app already had were NOT duplicated", () => {
  /* mMRC, NYHA, ABCD2, CAT, CHADS2, CHA2DS2-VASc, HAS-BLED, Child-Pugh, West Haven, CURB-65,
   * Forrest, Truelove-Witts and CAGE already existed. Adding a second copy is how two versions of
   * a score drift apart. */
  const src = readFileSync(join(ROOT, "calculators.js"), "utf8");
  for (const id of ["mmrc_dyspnoea", "nyha", "abcd2", "cat_copd", "chads2", "chadsvasc",
                    "hasbled", "childpugh", "west_haven", "curb65", "forrest",
                    "truelove_witts", "cage", "pack_years"]) {
    const hits = [...src.matchAll(new RegExp(`\\{ *id:"${id}", *cat:`, "g"))].length;
    assert.equal(hits, 1, `${id} is defined ${hits} times; it must appear exactly once`);
  }
});

test("MRC power: the functional threshold is 3, and every grade returns its number", () => {
  for (let g = 0; g <= 5; g++) assert.equal(run("mrc_power", { g: String(g) }).value, g);
  assert.match(run("mrc_power", { g: "3" }).interpretation, /antigravity|gravity/i);
  assert.match(run("mrc_power", { g: "4" }).interpretation, /4-|4\+|wide range/i);
});

test("NINDS reflex: grades 2 AND 3 are both normal", () => {
  for (const g of ["2", "3"]) {
    assert.match(run("ninds_reflex", { g }).interpretation, /normal range/i,
      `grade ${g} must read as within the normal range`);
  }
  assert.match(run("ninds_reflex", { g: "0" }).interpretation, /reinforce/i);
  assert.match(run("ninds_reflex", { g: "4" }).interpretation, /clonus/i);
  // The whole point of the scale, stated where a student will read it.
  assert.match(run("ninds_reflex", { g: "2" }).interpretation, /both NORMAL|asymmetr/i);
});

test("pulse grading: 3+ is normal, not 2+", () => {
  assert.match(run("pulse_grade", { g: "3" }).interpretation, /^Normal|Normal\./);
  assert.match(run("pulse_grade", { g: "2" }).interpretation, /diminished/i);
  assert.match(run("pulse_grade", { g: "4" }).interpretation, /bounding/i);
  assert.match(run("pulse_grade", { g: "0" }).interpretation, /doppler/i);
  assert.match(run("pulse_grade", { g: "3" }).interpretation, /3\+ is NORMAL/);
});

test("murmurs: systolic out of six with a thrill from 4, diastolic out of four", () => {
  assert.equal(run("levine_murmur", { g: "6" }).unit, "/6");
  assert.match(run("levine_murmur", { g: "4" }).interpretation, /thrill is present/i);
  assert.match(run("levine_murmur", { g: "3" }).interpretation, /no thrill/i);
  // Loudness is not severity: the single most quoted misconception about murmurs.
  assert.match(run("levine_murmur", { g: "5" }).interpretation, /does NOT track severity/i);

  assert.equal(run("diastolic_murmur", { g: "4" }).unit, "/4");
  assert.match(run("diastolic_murmur", { g: "2" }).interpretation, /out of FOUR/i);
  assert.match(run("diastolic_murmur", { g: "1" }).interpretation, /pathological/i);
});

test("CCS angina is I to IV with NO class 0", () => {
  /* R1 clinical review, 2026-08-25: the first version of this calculator was off by one. It
   * offered a "Grade 0" that does not exist in the CCS scale and shifted every real class down by
   * one, so a genuinely class III patient would have been referred as "CCS 2" and triaged down.
   * This test previously ASSERTED that wrong scale, which is how it survived. */
  assert.deepEqual(
    [1, 2, 3, 4].map((g) => run("ccs_angina", { g: String(g) }).value),
    ["I", "II", "III", "IV"],
    "CCS classes are I to IV in Roman numerals");
  // There must be no class 0, and asking for one must not silently produce a result.
  const zero = run("ccs_angina", { g: "0" });
  assert.ok(!zero || zero.value === undefined || zero.value === "" || zero.raw?.err,
    "there is no CCS class 0");
  assert.match(run("ccs_angina", { g: "2" }).interpretation, /NO CLASS 0/i);
  assert.match(run("ccs_angina", { g: "2" }).interpretation, /unstable/i);
  assert.match(run("ccs_angina", { g: "4" }).interpretation, /at rest/i);
  // Class II must carry the CCS descriptor, not NYHA-style "walks slower than peers" language.
  assert.ok(!/slower than people|slower than peers/i.test(JSON.stringify(MEDCALC.get("ccs_angina"))),
    "class II must use the CCS descriptor, not spliced-in NYHA language");
});

test("EHRA scores symptoms only, and says so", () => {
  assert.equal(run("ehra_af", { g: "1" }).value, "I");
  assert.equal(run("ehra_af", { g: "3" }).value, "IIb");
  assert.equal(run("ehra_af", { g: "5" }).value, "IV");
  const i = run("ehra_af", { g: "2" }).interpretation;
  assert.match(i, /CHA2DS2-VASc/, "must point stroke risk elsewhere");
  assert.match(i, /HAS-BLED/, "must point bleeding risk elsewhere");
});

test("Framingham heart failure criteria: 2 major, or 1 major plus 2 minor", () => {
  assert.equal(run("framingham_hf", { major: 2, minor: 0 }).value, "Met");
  assert.equal(run("framingham_hf", { major: 1, minor: 2 }).value, "Met");
  assert.equal(run("framingham_hf", { major: 1, minor: 1 }).value, "Not met");
  assert.equal(run("framingham_hf", { major: 0, minor: 5 }).value, "Not met",
    "minor criteria alone can never satisfy the rule");
  assert.equal(run("framingham_hf", { major: 3, minor: 0 }).value, "Met");
});

test("every added scale refuses an empty or impossible selection", () => {
  for (const id of ADDED) {
    if (id === "framingham_hf") continue;
    const r = run(id, {});
    assert.ok(!r || r.value === undefined || r.value === "" || r.raw?.err,
      `${id} returned a grade for no input`);
  }
  const bad = run("framingham_hf", { major: -1, minor: 0 });
  assert.ok(!bad || bad.value === undefined || bad.raw?.err, "framingham_hf accepted a negative count");
});
