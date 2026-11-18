/* ui-refine.css + scroll-fade.js: the edge rule, the wiring and the switches (browser checks: run-ui-refine-ui.mjs). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SF = require(join(ROOT, "scroll-fade.js"));

test("a row fades only on the side that hides content", () => {
  assert.equal(SF.edges(0, 300, 300), "", "fits: no fade");
  assert.equal(SF.edges(0, 900, 300), "e");
  assert.equal(SF.edges(300, 900, 300), "s e");
  assert.equal(SF.edges(600, 900, 300), "s");
  assert.equal(SF.edges(-300, 900, 300), "s e", "RTL scrollLeft is negative");
});

test("loaded by index.html with a kill switch; never sets a transition or a module transform", () => {
  const html = fs.readFileSync(join(ROOT, "index.html"), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/ui-refine\.css\?v=[^"]+">/);
  assert.match(html, /<script src="\/scroll-fade\.js\?v=[^"]+" defer><\/script>/);
  assert.match(html, /smd_ui_refine.*no-ui-refine/);
  const css = fs.readFileSync(join(ROOT, "ui-refine.css"), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rules, /\btransition(-property)?\s*:/, "a button's own transitions are never replaced");
  assert.doesNotMatch(rules, /(^|[;{\s])transform\s*:/, "press uses the individual scale property, not transform");
  assert.match(rules, /prefers-reduced-motion/);
  assert.match(rules, /forced-colors/);
});
