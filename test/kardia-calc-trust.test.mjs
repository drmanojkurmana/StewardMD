import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const K = require("../kardia-calc-data.js");
const TRUST = require("../kardia-calc-trust.js");

test("every calculator has a trust entry with formula, units, steps, reference and example", () => {
  const ids = new Set();
  for (const c of K.calcs) {
    assert.ok(!ids.has(c.id), "dup " + c.id); ids.add(c.id);
    const t = TRUST[c.id];
    assert.ok(t, "missing trust entry " + c.id);
    assert.equal(typeof t.formula, "string", c.id + " formula");
    assert.ok(t.formula.length > 10, c.id + " formula too short");
    assert.ok(t.units && typeof t.units === "object", c.id + " units");
    for (const inp of c.inputs) {
      assert.equal(typeof t.units[inp.k], "string", c.id + " unit " + inp.k);
      assert.ok(t.units[inp.k].length > 0, c.id + " empty unit " + inp.k);
    }
    assert.ok(Array.isArray(t.steps), c.id + " steps");
    assert.ok(t.steps.length >= 2 && t.steps.length <= 4, c.id + " steps count " + t.steps.length);
    for (const s of t.steps) assert.ok(typeof s === "string" && s.length > 5, c.id + " step text");
    assert.equal(typeof t.ref, "string", c.id + " ref");
    assert.equal(t.ref, c.source, c.id + " ref must reuse the cited source, not invent one");
    assert.equal(t.status, "Draft, awaiting review", c.id + " status");
    for (const k of Object.keys(t.example)) assert.equal(typeof t.example[k], "number", c.id + " example " + k);
  }
  assert.equal(Object.keys(TRUST).length, K.calcs.length, "no extra trust entries");
});

test("every trust example computes a finite result with a real grade", () => {
  for (const c of K.calcs) {
    const r = K.compute(c.id, TRUST[c.id].example);
    assert.ok(r, c.id + " no result");
    assert.ok(Number.isFinite(r.v), c.id + " non-finite value");
    assert.ok(r.g && typeof r.g.grade === "string" && r.g.grade.length > 0, c.id + " grade");
    assert.ok(["ok", "warn", "bad"].includes(r.g.tone), c.id + " tone " + (r.g && r.g.tone));
  }
});

test("UI wiring: trust block, worked example button, loader order, ES5, British text hygiene", () => {
  const ui = readFileSync("kardia-calc.js", "utf8");
  for (const s of ["How this works", "Try a worked example", "Draft, awaiting review", "KCALC_TRUST", "kcalc-trust", "Guideline:"]) assert.ok(ui.includes(s), s);
  assert.ok(ui.includes("Worked example"), "original worked example button stays");
  const loader = readFileSync("kardia-loader.js", "utf8");
  assert.ok(loader.includes('"kardia-calc-trust.js"'), "loader lists trust file");
  assert.ok(loader.indexOf('"kardia-calc-data.js"') < loader.indexOf('"kardia-calc-trust.js"'), "trust loads after data");
  assert.ok(loader.indexOf('"kardia-calc-trust.js"') < loader.indexOf('"kardia-calc.js"'), "trust loads before UI");
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/=>|\bconst\s|\blet\s/.test(code), "ES5 only");
  assert.ok(!/—|–/.test(code), "no em/en dashes in UI file");
  assert.ok(!/\bweb app\b|\bbrowser\b/i.test(code), "no web/browser wording");
  const trust = readFileSync("kardia-calc-trust.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/=>|\bconst\s|\blet\s/.test(trust), "trust ES5 only");
  assert.ok(!/—|–/.test(trust), "no em/en dashes in trust file");
  assert.ok(!/\bweb app\b|\bbrowser\b/i.test(trust), "no web/browser wording in trust");
  const css = readFileSync("kardia-calc.css", "utf8");
  for (const s of ["kcalc-trust", "kcalc-trust-badge", "kcalc-trustbtn"]) assert.ok(css.includes(s), s);
  assert.ok(!/gradient|glow|box-shadow/.test(css), "no new depth effects");
});
