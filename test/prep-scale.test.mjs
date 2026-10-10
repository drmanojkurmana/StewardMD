// PrepNucleus effective scale (owner 2026-10-10: "1.0 in PrepNucleus only"): home.js prepZoomD takes the app's default
// 0.95 shrink off inside PrepNucleus. Auto fit -> max(1, scale); a size the user chose -> scale / 0.95, clamped to 2.
// The live behaviour (html.pn-open, Chrome + WebKit, 44 px targets) is test/run-prep-scale.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const shrink = SRC.match(/var PN_SHRINK = ([\d.]+);/);
const fn = SRC.match(/function prepZoomD\(scale, autoFit\) \{[\s\S]*?\n  \}/);
const prepZoom = vm.runInNewContext("var PN_SHRINK = " + shrink[1] + "; " + fn[0] + "; prepZoomD");

test("auto fit: the 0.95 and 0.9 phone shrink comes off, an iPad's larger fit is kept", () => {
  assert.equal(prepZoom(0.95, true), 1);
  assert.equal(prepZoom(0.9, true), 1);
  assert.equal(prepZoom(1, true), 1);
  assert.equal(prepZoom(1.08, true), 1.08);
  assert.equal(prepZoom(1.15, true), 1.15);
});
test("a size the user chose: only the default shrink is removed (scale / 0.95), clamped to the app's 0.8..2", () => {
  assert.equal(prepZoom(0.95, false), 1);
  assert.equal(prepZoom(1.1, false), 1.1579);
  assert.equal(prepZoom(0.8, false), 0.8421);
  assert.equal(prepZoom(1.9, false), 2);
  assert.equal(prepZoom(5, false), 2);
  assert.equal(prepZoom("x", false), 1.0526);
});
test("one zoom on html, switched by html.pn-open (prep.js open/close), restored on close", () => {
  assert.match(SRC, /classList\.contains\("pn-open"\) \? prepZoomD\(s, ds\.autoFit\) : s/);
  assert.match(SRC, /attributeFilter: \["class"\]/);
  const prep = readFileSync(new URL("../prep.js", import.meta.url), "utf8");
  assert.match(prep, /classList\.add\("pn-open"\)/);
  assert.match(prep, /classList\.remove\("pn-open"\)/);
});
