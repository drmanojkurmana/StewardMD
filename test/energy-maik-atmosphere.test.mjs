/* test/energy-maik-atmosphere.test.mjs: static pins for the MaiK atmosphere energy pass.
 * Pixel identity (bit-exact on software raster, <= 1/255 on screen on GPU raster) and the draw count
 * are proven in a real browser by test/run-maik-atmosphere-pixels.mjs; these pins keep the invariants
 * that proof relies on. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const A = readFileSync(new URL("../maik-atmosphere.js", import.meta.url), "utf8");
const C = readFileSync(new URL("../maik-atmosphere.css", import.meta.url), "utf8");
const I = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("glyph cells: one font, 11 x 20 px grid, no shadow or filter that could bleed into a neighbour", () => {
  assert.match(A, /FONT = '14px ui-monospace, SFMono-Regular, monospace'/);
  assert.match(A, /ctx\.fillText\(l\.char, x, y\)/);
  assert.match(A, /x = \(i % cols\) \* 11, y = Math\.floor\(i \/ cols\) \* 20/);
  assert.match(A, /cols = Math\.ceil\(width \/ 11\)/);
  assert.doesNotMatch(A, /shadowBlur|shadowColor|ctx\.filter|globalCompositeOperation/);
});

test("a cell is skipped only when its glyph, colour and 8-bit alpha all match what was painted", () => {
  assert.match(A, /q = Math\.round\(a \* 255\)/);
  assert.match(A, /if \(l\.pc === l\.char && l\.pq === q && l\.pf === fill\) return; ctx\.clearRect\(x - CELL_L, y - CELL_T, 11, 20\);/);
  assert.match(A, /l\.pc = l\.char; l\.pq = q; l\.pf = fill;/);
  // Values still advance for every cell, painted or not (the animation state is unchanged).
  assert.ok(A.indexOf("l.value += (l.target - l.value) * .14;") < A.indexOf("if (l.pc === l.char"));
});

test("full redraw: first frame, any sync (theme, busy, visibility, sheet class), palette change, and unsafe fonts", () => {
  assert.match(A, /cellsFit = false, fresh = true;/);
  assert.match(A, /var full = !cellsFit \|\| fresh;\n\s*if \(full\) ctx\.clearRect\(0, 0, width, height\);/);
  assert.match(A, /function sync\(\) \{\n\s*if \(dead\) return;\n\s*fresh = true;/);
  assert.match(A, /fresh = true; paint\(\);\n\s*\},\n\s*setBusy/);
  assert.match(A, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\); cellsFit = measureCells\(dpr\);/);
  // The measured ink must sit a device pixel inside the cell's clear box, on all four sides.
  assert.match(A, /var m = 1 \/ dpr \+ \.05;/);
  assert.match(A, /actualBoundingBoxLeft > CELL_L - m \|\| t\.actualBoundingBoxRight > 11 - CELL_L - m \|\|/);
  assert.match(A, /actualBoundingBoxAscent > CELL_T - m \|\| t\.actualBoundingBoxDescent > 20 - CELL_T - m\) return false;/);
});

test("the loop's run condition is unchanged (no figure-viewer pause)", () => {
  assert.match(A, /function active\(\) \{ return !dead && sheet\.isConnected && sheet\.classList\.contains\('on'\) && !document\.hidden && !reduced\.matches; \}/);
  assert.doesNotMatch(A, /maik-lb-on/);
});

test("the harness's on-screen bound uses the stylesheet's layer opacities and fade", () => {
  assert.match(C, /#maikSheet \.mk-atmo-thinking \.mk-atmo-code \{ opacity:\.28; \}/);
  assert.match(C, /#maikSheet \.mk-atmo-dark\.mk-atmo-thinking \.mk-atmo-code \{ opacity:\.46; \}/);
  assert.match(C, /transition:opacity \.5s ease;/);
});

test("index.html busts the cache for the new maik-atmosphere.js", () => {
  assert.match(I, /<script src="\/maik-atmosphere\.js\?v=2-energy1" defer><\/script>/);
});
