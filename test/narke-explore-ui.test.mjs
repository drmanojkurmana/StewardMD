import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const U = require("../narke-explore-ui.js");
const derm = require("../narke-models/explorer-dermatomes.js");
const vent = require("../narke-models/explorer-ventilator.js");
const circ = require("../narke-models/explorer-circuit.js");

test("pathOf maps points into the box, y up, clamped to the range", () => {
  const box = { x: 10, y: 0, w: 100, h: 50 };
  assert.equal(U.pathOf([{ a: 0, b: 0 }, { a: 10, b: 100 }, { a: 5, b: 200 }], "a", "b", box, [0, 10], [0, 100]), "M10.0 50.0L110.0 0.0L60.0 0.0");
});

test("twoBreaths repeats the breath once, continuing in time", () => {
  const r = vent.breath({}, 10), two = U.twoBreaths(r.points);
  assert.equal(two.length, 21);
  assert.equal(two[20].t, +(2 * r.points[10].t).toFixed(3));
  assert.deepEqual(two[11].paw, r.points[1].paw);
});

test("every dermatome has a place on the body, top to bottom", () => {
  assert.deepEqual(Object.keys(U.DERM_Y), derm.levels);
  const ys = derm.levels.map((l) => U.DERM_Y[l]);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1]);
  assert.ok(U.DERM_Y.T4 < U.DERM_Y.T6 && U.DERM_Y.T6 < U.DERM_Y.T10 && U.DERM_Y.T10 < U.DERM_Y.L1);
});

test("fresh gas steps are valid model inputs and include 1 L/min and a flow equal to the default minute ventilation", () => {
  for (const f of U.FGF_STEPS) assert.equal(circ.state({ fgf: f }).ok, true);
  assert.ok(U.FGF_STEPS.includes(1) && U.FGF_STEPS.includes(circ.constants.defaults.ve));
});

test("lessonsFor: fixed first, then lessons naming the explorer; graceful without an index", () => {
  const ix = { units: [{ id: "as4", level: "mbbs", lessons: ["a"] }, { id: "asr7", level: "resident", lessons: ["b"] }],
    lessons: { a: { title: { en: "A" }, test: { explorer: "mac" } }, b: { title: { en: "B" }, test: { explorer: "mac" } } } };
  assert.deepEqual(U.lessonsFor("mac", ix, []).map((x) => x.level), ["mbbs", "resident"]);
  assert.deepEqual(U.lessonsFor("mac", null, ["a"]), []);
});

test("shipped UI: ES5, no dashes, registers into NARKE, CSS scoped to .nrk-root with reduced motion", () => {
  const js = readFileSync(new URL("../narke-explore-ui.js", import.meta.url), "utf8"), css = readFileSync(new URL("../narke-explore-ui.css", import.meta.url), "utf8");
  assert.ok(!/\b(let|const|class)\s/.test(js) && !/=>/.test(js) && !/`/.test(js) && !/\.includes\(/.test(js), "ES5");
  const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
  assert.ok(!DASH.test(js) && !DASH.test(css));
  assert.match(js, /var host = G\.NARKE;/);
  assert.match(js, /host\.registerExplorer\(/);
  assert.ok(!/<text/.test(js), "no text inside the SVG pictures");
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const rule of css.split("}").map((r) => r.trim()).filter((r) => r && !r.startsWith("@") && !r.startsWith("/*") && /\{/.test(r))) {
    const sel = rule.split("{")[0].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!sel || /^(from|to)$/.test(sel) || /^@/.test(sel)) continue;
    assert.ok(sel.split(",").every((s) => /\.nrk-root/.test(s)), "scoped: " + sel);
  }
});
