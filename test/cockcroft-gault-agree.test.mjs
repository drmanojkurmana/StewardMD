/* test/cockcroft-gault-agree.test.mjs — one Cockcroft-Gault (Edge-Master-Plan A1.6).
 *
 * Six places compute CrCl: the CrCl calculator (calculators.js), the oncology dose engine
 * (onco-dose.js), the organ-dysfunction dose engine (onco-organ-dose.js), the safety overlay and the
 * renal card (reasoning.js renalCheck / smdCrclValue) and the dose calculator (dose-calc.js). They are
 * kept separate on purpose (each carries its own policy: an opt-in creatinine floor, a umol/L
 * auto-detect, ideal/adjusted weight, Schwartz under 18), but the FORMULA must be one formula. This
 * pins it: on the domain they share (adult, actual weight, mg/dL, no floor) every caller gives the
 * same whole-number mL/min. A change to any one of them fails here.
 *
 * node --test test/cockcroft-gault-agree.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// calculators.js: the CrCl calculator itself.
const g = { document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {}, head: { appendChild() {} }, body: { classList: { add() {}, remove() {} } } },
  localStorage: { getItem: () => null, setItem() {} }, location: { search: "" }, navigator: {} };
g.window = g; vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, "calculators.js"), "utf8"), g, { filename: "calculators.js" });
const M = g.MEDCALC;

const ONCO = require("../onco-dose.js");
const ORGAN = require("../onco-organ-dose.js");
const DOSE = require("../dose-calc.js");

// reasoning.js is a browser-only bundle; lift its two pure CrCl functions out of the source as-is.
const R = fs.readFileSync(path.join(ROOT, "reasoning.js"), "utf8");
function lift(name) {
  const a = R.indexOf("function " + name + "(");
  assert.ok(a > 0, name + " exists in reasoning.js");
  let depth = 0, i = R.indexOf("{", a);
  for (; i < R.length; i++) { if (R[i] === "{") depth++; else if (R[i] === "}" && --depth === 0) break; }
  return R.slice(a, i + 1);
}
const reasoning = new Function(lift("smdSafetyNum") + "\n" + lift("smdCrclValue") + "\n" + lift("renalCheck") + "\nreturn { crclValue: smdCrclValue, renalCheck: renalCheck };")();

const callers = {
  "calculators.js crcl": (c) => Number(M.run("crcl", { age: c.age, wt: c.wt, scr: c.scr, sex: c.f ? "f" : "m" }).value),
  "onco-dose.js gfrCockcroft": (c) => Math.round(ONCO.gfrCockcroft({ age: c.age, wKg: c.wt, scr: c.scr, sex: c.f ? "f" : "m" })),
  "onco-organ-dose.js": (c) => Math.round(ORGAN.calculateCockcroftGault({ age: c.age, weightKg: c.wt, creatinine: c.scr, sex: c.f ? "female" : "male" }).crcl),
  "reasoning.js smdCrclValue": (c) => reasoning.crclValue({ age: c.age, weight: c.wt, creatinine: c.scr, sex: c.f ? "female" : "male" }),
  "dose-calc.js (no height: actual weight)": (c) => DOSE.derive({ age: c.age, weight: c.wt, scr: c.scr, sex: c.f ? "F" : "M" }).renal.value
};
const truth = (c) => Math.round(((140 - c.age) * c.wt) / (72 * c.scr) * (c.f ? 0.85 : 1));

test("every caller gives the same CrCl on the shared adult domain (2,100 cases)", () => {
  let n = 0;
  for (let age = 18; age <= 102; age += 7) for (let wt = 38; wt <= 150; wt += 16) for (let scr = 0.5; scr <= 6.5; scr += 0.6) for (const f of [false, true]) {
    const c = { age, wt, scr: Math.round(scr * 10) / 10, f }, want = truth(c);
    for (const [name, fn] of Object.entries(callers)) {
      const got = fn(c);
      // Half-way values can round either way after a different multiplication order; never more.
      assert.ok(Math.abs(got - want) <= 1, `${name}: ${JSON.stringify(c)} gave ${got}, Cockcroft-Gault is ${want}`);
    }
    n++;
  }
  assert.ok(n >= 2000);
});

test("textbook case: 72 y, 58 kg, female, Scr 1.4 -> 33 mL/min everywhere", () => {
  const c = { age: 72, wt: 58, scr: 1.4, f: true };
  for (const [name, fn] of Object.entries(callers)) assert.equal(fn(c), 33, name);
});

test("missing inputs: nobody invents a number", () => {
  assert.equal(M.run("crcl", { age: 70, wt: 60, sex: "m" }).value, M.run("crcl", {}).value, "the calculator shows its empty state");
  assert.equal(ONCO.gfrCockcroft({ age: 70, wKg: 60 }), null);
  assert.equal(ORGAN.calculateCockcroftGault({ age: 70, weightKg: 60 }).crcl, null);
  assert.equal(reasoning.crclValue({ age: 70, weight: 60 }), null);
  assert.equal(DOSE.derive({ age: 70, weight: 60, sex: "M" }).renal, null);
});

test("the deliberate differences stay deliberate", () => {
  // Opt-in creatinine floor (oncology): OFF unless the caller supplies one.
  assert.equal(Math.round(ONCO.gfrCockcroft({ age: 80, wKg: 50, scr: 0.5, sex: "f", creatinineFloor: 0.8 })), truth({ age: 80, wt: 50, scr: 0.8, f: true }));
  // umol/L auto-detect (organ-dose engine only): 124 umol/L is 1.4 mg/dL.
  assert.equal(Math.round(ORGAN.calculateCockcroftGault({ age: 72, weightKg: 58, creatinine: 124, sex: "f" }).crcl), 33);
  // Children: the dose calculator switches to bedside Schwartz (needs height).
  assert.match(DOSE.derive({ age: 8, weight: 25, height: 128, scr: 0.5, sex: "M" }).renal.how, /Schwartz/);
});
