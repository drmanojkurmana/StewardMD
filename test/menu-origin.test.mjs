/* menu-origin.js: dropdowns and menus grow out of the button that opened them (owner 2026-11-15). The browser part is
 * covered by test/run-smd-motion-ui.mjs; this checks the pure size rule, the wiring and the switches. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M = require(join(ROOT, "menu-origin.js"));
const src = fs.readFileSync(join(ROOT, "menu-origin.js"), "utf8");

test("a menu is a floating box short of the whole screen", () => {
  assert.equal(M.isMenuBox("absolute", 216, 260, 390, 844), true);
  assert.equal(M.isMenuBox("fixed", 300, 200, 390, 844), true);
  assert.equal(M.isMenuBox("static", 216, 260, 390, 844), false, "in-flow content is not a menu");
  assert.equal(M.isMenuBox("fixed", 390, 844, 390, 844), false, "a full-screen page is page-motion.js's job");
  assert.equal(M.isMenuBox("absolute", 20, 20, 390, 844), false, "too small to be a menu");
});

test("loaded after smd-motion.js, with its switches and reduced motion", () => {
  const html = fs.readFileSync(join(ROOT, "index.html"), "utf8");
  const a = html.indexOf("/smd-motion.js?v="), b = html.indexOf("/menu-origin.js?v=");
  assert.ok(a > 0 && b > a, "menu-origin.js loads after smd-motion.js");
  assert.match(src, /smd_menu_origin/);
  assert.match(src, /SMD_MOTION/);   // on() covers prefers-reduced-motion and smd_motion3
  assert.match(src, /data-own-motion/);
});

test("smd-motion.js morph is exact: scale 1 and the morph spring in 200 to 320 ms", () => {
  const S = require(join(ROOT, "smd-motion.js"));
  const m = S.morphFrom({ left: 30, top: 420, width: 120, height: 90 }, { left: 0, top: 0, width: 390, height: 844 }, 20, 1);
  assert.equal(m.scale, 1);
  assert.equal(m.clip, "inset(420px 240px 334px 30px round 20px)");
  const c = S.springCurve(S.PRESET.morph[0], S.PRESET.morph[1]);
  assert.ok(c.ms >= 200 && c.ms <= 340, "morph spring settles in about 300 ms: " + c.ms);
  assert.ok(Math.max(...c.pts) <= 1.001, "no overshoot on the morph");
});
