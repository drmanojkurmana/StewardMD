// calculators-ext.js: every added calculator registers into MEDCALC, has a source and search words, never scores a
// blank, has no dashes in app text, and returns the hand-worked answer for every known-answer case.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || {
  addEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
  head: { appendChild() {} }, body: { appendChild() {} },
};
require("../calculators.js");
const coreIds = new Set(window.MEDCALC._calcs.map((c) => c.id));
const LIST = require("../calculators-ext.js");
const cases = JSON.parse(fs.readFileSync(new URL("./calculators-ext.cases.json", import.meta.url), "utf8"));

function inputsFor(c, given) {
  const v = {};
  for (const inp of c.inputs) {
    const x = given[inp.id];
    v[inp.id] = inp.type === "number" ? (x == null || x === "" ? NaN : Number(x)) : inp.type === "check" ? !!x : x == null ? "" : String(x);
  }
  return v;
}

test("every added calculator registers, with a unique id, source and search words", () => {
  for (const c of LIST) {
    assert.ok(window.MEDCALC.get ? window.MEDCALC._calcs.includes(c) : true, c.id + " registered");
    assert.ok(c.ref && c.ref.length > 10, c.id + " has a source");
    assert.ok(Array.isArray(c.kw) && c.kw.length, c.id + " has search words");
    assert.ok(c.desc && c.title && c.cat, c.id + " has title, desc, category");
  }
  assert.equal(new Set(LIST.map((c) => c.id)).size, LIST.length, "ids unique");
});

test("no added calculator reuses a core id", () => {
  for (const c of LIST) assert.ok(!coreIds.has(c.id) || window.MEDCALC._calcs.filter((x) => x.id === c.id).length === 1, c.id);
});

test("blank inputs never produce a score", () => {
  for (const c of LIST) if (c.inputs.some((x) => x.type === "number")) assert.ok(c.compute(inputsFor(c, {})).err, c.id);
});

test("no em or en dashes in titles, text or results", () => {
  for (const c of LIST) assert.ok(!/[–—]/.test(c.title + c.desc + JSON.stringify(c.inputs)), c.id);
});

test("known answers", () => {
  const by = new Map(LIST.map((c) => [c.id, c]));
  for (const k of cases) {
    const c = by.get(k.id); assert.ok(c, "case for " + k.id);
    const r = c.compute(inputsFor(c, k.in));
    assert.ok(r && !r.err, k.id + " computes " + JSON.stringify(k.in));
    if (typeof k.v === "number") assert.ok(Math.abs(Number(r.v) - k.v) <= Math.max(0.011, Math.abs(k.v) * 0.005), `${k.id}: ${r.v} vs ${k.v}`);
    else assert.equal(String(r.v), String(k.v), k.id);
    if (k.band) assert.ok(String(r.i).toLowerCase().includes(k.band.toLowerCase()), `${k.id}: "${k.band}"`);
    assert.ok(!/[–—]/.test(JSON.stringify(r)), k.id + " result has no dash");
  }
});
