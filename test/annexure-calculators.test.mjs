/* The two calculations from the Annexures: UK alcohol units, and the smoking index.
 *
 * Both are arithmetic a clinician will trust without checking, so they are verified here against
 * the worked examples in the source the module was built from. The smoking index in particular is
 * NOT pack-years - it does not divide by 20 - and confusing the two overstates exposure twentyfold,
 * which is exactly the kind of error a test should make impossible.
 *
 * calculators.js is a browser IIFE, so it is loaded under a minimal window shim and driven through
 * its real public API (MEDCALC.run) rather than by re-implementing the formulas here. Re-implementing
 * them would test this file against itself.
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
  const ctx = vm.createContext(win);
  vm.runInContext(src, ctx, { filename: "calculators.js" });
  assert.ok(win.MEDCALC, "calculators.js did not expose MEDCALC under the shim");
  return win.MEDCALC;
}

const MEDCALC = loadMedcalc();
const run = (id, inputs) => MEDCALC.run(id, inputs);

test("both annexure calculators are registered", () => {
  for (const id of ["alcohol_units", "smoking_index"]) {
    assert.ok(MEDCALC.get(id), `${id} is not in the catalog`);
  }
});

test("alcohol units match the worked examples", () => {
  // 1 UK unit = 10 mL (8 g) pure ethanol; units = mL x ABV / 1000.
  const cases = [
    [25, 40, 1],       // a 25 mL single measure of 40% whisky = 1 unit
    [250, 12, 3],      // 250 mL glass of 12% wine = 3 units
    [330, 5, 1.65],    // 330 mL bottle of 5% lager = 1.65 units
    [1000, 40, 40],    // a 1 litre bottle of 40% whisky = 40 units
    [568, 3.5, 1.988], // a pint of 3.5% beer, about 2 units
  ];
  for (const [ml, abv, expected] of cases) {
    const r = run("alcohol_units", { ml, abv });
    assert.ok(r, `no result for ${ml} mL at ${abv}%`);
    assert.ok(Math.abs(r.value - expected) < 0.06,
      `${ml} mL at ${abv}% should be ~${expected} units, got ${r.value}`);
  }
});

test("alcohol: the weekly total flags the 14 unit threshold and the 30 g/day liver risk", () => {
  // 14 x 25 mL whisky measures a week = 14 units: at the threshold, not above it.
  const atLimit = run("alcohol_units", { ml: 25, abv: 40, perweek: 14 });
  assert.match(atLimit.interpretation, /within the 14 units\/week/i);

  // Well above: 10 pints of 5% lager a week is ~28 units.
  const over = run("alcohol_units", { ml: 568, abv: 5, perweek: 10 });
  assert.match(over.interpretation, /above the 14 units\/week/i);

  // Heavy daily intake must name the ~30 g/day threshold where liver disease risk begins.
  const heavy = run("alcohol_units", { ml: 750, abv: 12, perweek: 7 });
  assert.match(heavy.interpretation, /30 g\/day/);
});

test("smoking index is cigarettes per day x years, and is NOT pack-years", () => {
  // The book's own example: 1 cigarette a day for 10 years = 10.
  assert.equal(run("smoking_index", { cpd: 1, years: 10 }).value, 10);
  assert.equal(run("smoking_index", { cpd: 20, years: 30 }).value, 600);

  // The trap: the same exposure in pack-years is 30, not 600. A twentyfold difference.
  const py = run("pack_years", { cpd: 20, years: 30 });
  assert.equal(py.value, 30);
  assert.notEqual(run("smoking_index", { cpd: 20, years: 30 }).value, py.value);
  assert.match(run("smoking_index", { cpd: 20, years: 30 }).interpretation, /not the same as pack-years/i);
});

test("smoking index grades mild, moderate and heavy at the documented cut-offs", () => {
  assert.match(run("smoking_index", { cpd: 5, years: 10 }).interpretation, /mild/i);      // 50
  assert.match(run("smoking_index", { cpd: 10, years: 20 }).interpretation, /moderate/i); // 200
  assert.match(run("smoking_index", { cpd: 20, years: 20 }).interpretation, /heavy/i);    // 400
  // Above 300 the lung cancer association is called out explicitly.
  assert.match(run("smoking_index", { cpd: 20, years: 20 }).interpretation, /lung cancer/i);
});

test("both refuse impossible input rather than returning a number", () => {
  for (const bad of [{ ml: -10, abv: 40 }, { ml: 100, abv: 140 }, { ml: 100, abv: -1 }]) {
    const r = run("alcohol_units", bad);
    assert.ok(!r || r.value === undefined || Number.isNaN(Number(r.value)) || r.raw?.err,
      `alcohol_units accepted impossible input ${JSON.stringify(bad)}`);
  }
  for (const bad of [{ cpd: -1, years: 10 }, { cpd: 10, years: -5 }]) {
    const r = run("smoking_index", bad);
    assert.ok(!r || r.value === undefined || Number.isNaN(Number(r.value)) || r.raw?.err,
      `smoking_index accepted impossible input ${JSON.stringify(bad)}`);
  }
});
