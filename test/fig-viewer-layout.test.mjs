// Figure viewer layout (fig-viewer.js LAY_CSS): the docked controls and readouts must fit
// the iframe viewport on landscape tablets and desktop, and scroll intentionally on phones.
// node --test --experimental-test-module-mocks --experimental-sqlite test/fig-viewer-layout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../fig-viewer.js", import.meta.url), "utf8");
const lay = src.slice(src.indexOf("var LAY_CSS"), src.indexOf("/* \"What is happening\""));

test("wide dock width is bounded and every grid column can shrink", () => {
  assert.match(lay, /grid-template-columns:minmax\(0,1fr\) minmax\(300px,min\(380px,38vw\)\)/, "dock capped at 380px and at 38vw");
  assert.ok(!/grid-template-columns:minmax\(0,1fr\) 380px/.test(lay), "no fixed 380px column left");
  for (const frag of ["grid-template-columns:minmax(0,1fr) minmax(0,1fr)", ".smd-dock .dr-controls>*{min-width:0}", ".smdc>*{min-width:0}"]) {
    assert.ok(lay.includes(frag), "grid can shrink: " + frag);
  }
  assert.ok(lay.includes("min-width:0;max-width:100%"), "grid items fit the iframe viewport");
  assert.ok(lay.includes(".smd-dock .dr-range select,.smd-dock .dr-range input{max-width:100%;min-width:0}"), "long control labels never push the dock off-screen");
});

test("treatment controls and explanation stay visible, never hidden", () => {
  for (const hidden of [".dr-controls{display:none", ".dr-info{display:none", ".smdc{display:none", ".smd-dock{display:none"]) {
    assert.ok(!lay.includes(hidden), "not hidden: " + hidden);
  }
  assert.ok(lay.includes(".smd-dock .dr-controls{grid-template-columns:minmax(0,1fr)}"), "readable single-column controls beside the figure");
});

test("phones keep a one-screen layout with scrolling only on real overflow", () => {
  assert.ok(lay.includes("@media (max-width:799px){.smd-dock{max-height:44dvh;overflow-y:auto}}"), "dock scrolls instead of clipping on narrow screens");
  assert.ok(lay.includes("body{position:relative;display:flex;flex-direction:column;height:100dvh;overflow:hidden"), "sheet itself never scrolls sideways");
});
