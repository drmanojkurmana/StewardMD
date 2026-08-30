/* test/profile-picker-options.test.mjs — the degree/speciality picker rendered a native function.
 *
 * Reported from a real device with screenshots of both pickers: every row showed the subtitle
 *   function sub() { [native code] }
 * under its label ("MBBS", "MD", "Internal Medicine"...).
 *
 * The cause is a JavaScript trap worth naming, because it is invisible on inspection:
 *
 *   var sub = it.sub || "";      // it === "MBBS"
 *
 * String.prototype.sub is a legacy HTML-wrapper method that still exists on every string. It is a
 * FUNCTION, so it is truthy, so `|| ""` never fires and the function itself gets rendered. Its
 * siblings are .big, .blink, .bold, .fontcolor, .fontsize, .italics, .link, .anchor, .small,
 * .strike and .sup - probing any of them on an unknown value has the same effect.
 *
 * `it.name` on the same line survived only by luck: strings have no .name. Had the options been
 * functions, that would have printed a name too.
 *
 * The fix reads properties from OBJECTS only. These tests exercise the real helpers, lifted out of
 * the module source (profile-setup.js is a DOM-bound IIFE that cannot be imported in node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../profile-setup.js", import.meta.url), "utf8");

function lift(name) {
  const m = SRC.match(new RegExp("function " + name + "\\(it\\) \\{[\\s\\S]*?\\n?\\s*\\}"));
  assert.ok(m, `${name}() not found in profile-setup.js`);
  return new Function(m[0] + "; return " + name + ";")();
}
const optName = lift("optName");
const optSub = lift("optSub");

test("the trap itself is real (why this bug existed)", () => {
  // If this ever stops being true the guard is no longer needed - but it is true in every engine.
  assert.equal(typeof "MBBS".sub, "function");
  assert.ok("MBBS".sub, 'String.prototype.sub is TRUTHY, which is what defeated `|| ""`');
  assert.match(String("MBBS".sub), /native code/);
});

test("a plain string option renders its own text and NO subtitle", () => {
  for (const s of ["MBBS", "MD", "MS", "DM", "MCh", "DNB", "DrNB", "Diploma", "Other"]) {
    assert.equal(optName(s), s);
    assert.equal(optSub(s), "", `${s} must have no subtitle, not a native function`);
  }
});

test("the reported strings can never appear again", () => {
  for (const s of ["MBBS", "Internal Medicine", "Obstetrics & Gynaecology"]) {
    assert.equal(String(optSub(s)).includes("native code"), false);
    assert.equal(String(optSub(s)).includes("function sub"), false);
  }
});

test("an object option still gets its name and subtitle", () => {
  assert.equal(optName({ name: "MD", sub: "Doctor of Medicine" }), "MD");
  assert.equal(optSub({ name: "MD", sub: "Doctor of Medicine" }), "Doctor of Medicine");
  assert.equal(optSub({ name: "MD" }), "", "a missing sub is empty, not undefined");
});

test("degenerate options never throw and never leak a stringified object", () => {
  for (const bad of [null, undefined, "", 0]) {
    assert.equal(typeof optName(bad), "string");
    assert.equal(optSub(bad), "");
  }
  assert.equal(optName(null), "");
  assert.equal(optName(undefined), "");
});

test("the unguarded pattern is gone from the source", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "");   // ignore the comment that quotes the old line
  // The defect was reading BOTH properties straight off a value that might be a string. Match that
  // exact shape - not `it.sub || ""` on its own, which is correct and expected inside optSub()'s
  // object branch. (Asserting the looser pattern flagged the fix itself.)
  assert.equal(/name = it\.name \|\| it/.test(code), false, "the unguarded destructuring is gone");
  assert.match(SRC, /typeof it === "object"/, "properties are read from objects only");
});
