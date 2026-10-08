/* prep-rad.js pure helpers (the radiology scroll-stack viewer): slice URLs, drag and wheel maths, key map, load order,
 * stack validation; plus prep.js reading a subject's own bank version (taxonomy bv) and PYQ figures accepting bank paths. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const R = require("../prep-rad.js");

const st = { id: "vs", n: 60, base: "v6/ss-radiology/stack/vs/", w: ["mr"], wl: ["MR"], ar: 1 };

test("rad: slice URL is api + base + window + 3-digit index", () => {
  assert.equal(R.sliceUrl("/api/prep/bank/", st, 0, 7), "/api/prep/bank/v6/ss-radiology/stack/vs/mr/007.webp");
  const two = { ...st, w: ["soft", "lung"] };
  assert.equal(R.sliceUrl("/x/", two, 1, 123), "/x/v6/ss-radiology/stack/vs/lung/123.webp");
  assert.equal(R.pad3(0), "000");
});

test("rad: drag maps pixels to slices, clamped, a full-height drag covers the stack", () => {
  assert.equal(R.pxPerSlice(360, 60), 6);
  assert.equal(R.pxPerSlice(800, 20), 8);
  assert.equal(R.pxPerSlice(100, 200), 3);
  assert.equal(R.sliceFromDrag(30, 60, 6, 60), 40);
  assert.equal(R.sliceFromDrag(30, -600, 6, 60), 0);
  assert.equal(R.sliceFromDrag(30, 600, 6, 60), 59);
  const px = R.pxPerSlice(360, 60);
  assert.equal(R.sliceFromDrag(0, 360, px, 60), 59);
});

test("rad: wheel accumulates to whole slices (pixels, lines, pages)", () => {
  assert.deepEqual(R.wheelSteps(0, 30, 0), [0, 30]);
  assert.deepEqual(R.wheelSteps(30, 30, 0), [1, 20]);
  assert.deepEqual(R.wheelSteps(0, -100, 0), [-2, -20]);
  assert.deepEqual(R.wheelSteps(0, 3, 1), [3, 0]);
});

test("rad: keys move one, a tenth, or to the ends; other keys are not ours", () => {
  assert.equal(R.keyTo("ArrowDown", 5, 60), 6);
  assert.equal(R.keyTo("ArrowUp", 0, 60), 0);
  assert.equal(R.keyTo("PageDown", 5, 60), 11);
  assert.equal(R.keyTo("Home", 30, 60), 0);
  assert.equal(R.keyTo("End", 30, 60), 59);
  assert.equal(R.keyTo("a", 30, 60), null);
});

test("rad: preload goes from the current slice outward and covers every slice once", () => {
  assert.deepEqual(R.preloadOrder(2, 6), [2, 3, 1, 4, 0, 5]);
  const o = R.preloadOrder(29, 60);
  assert.equal(o.length, 60);
  assert.equal(new Set(o).size, 60);
  assert.equal(o[0], 29);
});

test("rad: only a well-formed stack under a bank version is drawn", () => {
  assert.ok(R.valid(st));
  assert.ok(!R.valid(null));
  assert.ok(!R.valid({ ...st, n: 0 }));
  assert.ok(!R.valid({ ...st, base: "https://evil.example/" }));
  assert.ok(!R.valid({ ...st, base: "v6/ss-radiology/stack/../../x/" }));
});

test("rad: prep.js reads a subject's own bank version; prep-pyq.js serves bank-path images; loader lists prep-rad.js", () => {
  const p = fs.readFileSync(new URL("../prep.js", import.meta.url), "utf8");
  assert.match(p, /function bvOf\(sid\) \{ var s = subjectById\(sid\); return \(s && s\.bv\) \|\| VER; \}/);
  assert.doesNotMatch(p, /VER \+ "\/" \+ sid/);
  assert.match(p, /"rd-"/);
  assert.match(p, /\.pn-yq-fig,\.pn-stack,/);
  const y = fs.readFileSync(new URL("../prep-pyq.js", import.meta.url), "utf8");
  assert.match(y, /if \(f\.indexOf\("\/"\) >= 0\) \{ var u = \(host\.bankApi/);
  assert.match(y, /data-u="' \+ e\(itemImg\(it, P\.host, f\)\)/);
  const l = fs.readFileSync(new URL("../prep-loader.js", import.meta.url), "utf8");
  assert.match(l, /"prep-pyq\.js", "prep-rad\.js"/);
  assert.match(l, /"prep-rad\.js": 1/);
  const tx = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy.json", import.meta.url), "utf8"));
  const rad = tx.branches.flatMap((b) => b.subjects).find((s) => s.id === "ss-radiology");
  if (rad) assert.match(rad.bv, /^v\d+$/);
});
