/* Owner 2026-11-13: every PrepNucleus question shows exactly four options (prep-assess.js fourOptions, run when modules and paper overlays load).
 * node --test test/prep-four-options.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const A = createRequire(import.meta.url)("../prep-assess.js");
const P = { fourOptions: A.fourOptions, usable: createRequire(import.meta.url)("../prep.js").usable };

const five = (a) => ({ id: "t", q: "Next step?", o: ["v", "w", "x", "y", "z"], a, r: ["rv", "rw", "rx", "ry", "rz"],
  exp: "Because z.", x: { key: "k", others: { A: "ov", B: "ow", C: "ox", D: "oy", E: "oz" } } });

test("key E: drops D, key stays the same text, reasons and others follow", () => {
  const it = P.fourOptions(five(4));
  assert.deepEqual(it.o, ["v", "w", "x", "z"]);
  assert.equal(it.o[it.a], "z");
  assert.deepEqual(it.r, ["rv", "rw", "rx", "rz"]);
  assert.deepEqual(it.x.others, { A: "ov", B: "ow", C: "ox", D: "oz" });
  assert.equal(it.flags, undefined);
});

test("key A..D: drops E, key unchanged, idempotent", () => {
  for (let a = 0; a < 4; a++) {
    const it = P.fourOptions(P.fourOptions(five(a)));
    assert.equal(it.o.length, 4);
    assert.equal(it.o[it.a], "vwxyz"[a]);
    assert.equal(it.r[it.a], "r" + "vwxyz"[a]);
  }
});

test("letter references or linked options are hidden, not cut", () => {
  const a = five(1); a.exp = "Option E is wrong because...";
  assert.deepEqual(P.fourOptions(a).flags, ["opt-count"]);
  assert.equal(a.o.length, 5);
  const b = five(1); b.o[4] = "All of the above";
  assert.deepEqual(P.fourOptions(b).flags, ["opt-count"]);
  assert.equal(P.usable(b), false);
});

test("four-option items are untouched", () => {
  const it = { o: ["a", "b", "c", "d"], a: 2 };
  assert.deepEqual(P.fourOptions(it), { o: ["a", "b", "c", "d"], a: 2 });
});

test("tester 2026-11-12 Q-48J-SJ4-MA3: 'You are shown an MLO view' needs a picture; narrative 'shown' does not", () => {
  assert.equal(A.needsImage({ q: "You are shown an MLO view of the left breast. What is the MOST likely diagnosis?" }), true);
  assert.equal(A.needsImage({ q: "You are shown two films from an ERCP in a 40-year-old woman." }), true);
  assert.equal(A.needsImage({ q: "The patient was shown the X-ray report by the doctor. Next step?" }), false);
  assert.equal(A.needsImage({ q: "Bat wing appearance on chest X-ray is seen in" }), false);
});
