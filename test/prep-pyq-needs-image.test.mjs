// PYQ papers must never show a question whose stem points at a picture it does not carry (owner 2026-11-19).
// prep-pyq.js flags such items img-missing at load, and usable() hides flagged items; prep-pyqss.js drops them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ASSESS = require("../prep-assess.js");

test("needsImage catches picture stems and leaves text-described ones", () => {
  assert.equal(ASSESS.needsImage({ q: "The X-ray shown below is suggestive of which condition?" }), true);
  assert.equal(ASSESS.needsImage({ q: "Identify the instrument marked A." }), true);
  assert.equal(ASSESS.needsImage({ q: "Bat wing appearance on chest X-ray is seen in" }), false);
  assert.equal(ASSESS.needsImage({ q: "The X-ray shown below is suggestive of which condition?", img: ["v90/img/x.webp"] }), false);
});

test("prep-pyq.js flags image-less picture stems and usable() hides them", () => {
  const src = fs.readFileSync(new URL("../prep-pyq.js", import.meta.url), "utf8");
  assert.match(src, /AS\.needsImage\(it\)[^\n]*img-missing/);
  const P = require("../prep-pyq.js");  // Node gets the pure helpers
  assert.equal(P.usable({ id: "a", q: "x", flags: ["img-missing"] }, {}, {}), false);
  assert.equal(P.usable({ id: "b", q: "x" }, {}, {}), true);
});

test("prep-pyqss.js filters image-less picture stems at load", () => {
  const src = fs.readFileSync(new URL("../prep-pyqss.js", import.meta.url), "utf8");
  assert.match(src, /\.filter\(function \(it\) \{ return !\(AS && AS\.needsImage && AS\.needsImage\(it\)\); \}\)/);
});
