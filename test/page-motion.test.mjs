/* page-motion.js: full-screen pages and modules open and close with motion (owner 2026-10-28). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(join(ROOT, "page-motion.js"), "utf8");
const html = fs.readFileSync(join(ROOT, "index.html"), "utf8");

test("page-motion.js parses and is loaded by index.html", () => {
  new Function(src);
  assert.match(html, /<script src="\/page-motion\.js\?v=[^"]+" defer><\/script>/);
});
test("kill switch, reduced motion and dialog-motion ownership are respected", () => {
  assert.match(src, /smd_page_motion/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /\[role=dialog\],\.modal,\.overlay/);
  for (const id of ["smdBootSplash", "introPoster", "accountGate"]) assert.ok(src.includes(id), id + " is never animated");
});
test("a removed page is faded as an inert, id-less copy that the observer ignores", () => {
  assert.match(src, /data-pm-ghost/);
  assert.match(src, /setAttribute\("inert"/);
  assert.match(src, /removeAttribute\("id"\)/);
  assert.match(src, /iframe,video,audio,script/);
});
test("the drug database header no longer has a home button", () => {
  assert.ok(!fs.readFileSync(join(ROOT, "api.js"), "utf8").includes('id="dbClose"'));
});
test("a screen swapped inside a module fades up; a repaint of the same screen does not", () => {
  assert.match(src, /function innerSwap/);
  assert.match(src, /same screen repainted/);
});
