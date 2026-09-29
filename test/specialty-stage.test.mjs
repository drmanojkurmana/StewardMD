import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const S = createRequire(import.meta.url)("../specialty-stage.js");

test("fit contains a wide scan in a phone-width stage", () => {
  const f = S.fit(390, 300, 1024, 381);
  assert.equal(Math.round(f.w), 390);
  assert.ok(f.h <= 300);
});

test("zoom keeps the image point under the finger", () => {
  const v = S.zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50);
  // image point under (100,50) before: (100,50); after: x + 100*k must equal 100
  assert.equal(v.x + 100 * 2, 100);
  assert.equal(v.y + 50 * 2, 50);
});

test("zoom is clamped to [MIN, MAX]", () => {
  assert.equal(S.zoomAt({ k: 1, x: 0, y: 0 }, 50, 0, 0).k, S.MAX);
  assert.equal(S.zoomAt({ k: 2, x: 0, y: 0 }, 0.1, 0, 0).k, S.MIN);
});

test("bound centres a small image and stops a zoomed one leaving the stage", () => {
  const c = S.bound({ k: 1, x: 99, y: 99 }, 400, 300, 200, 100);
  assert.deepEqual([c.x, c.y], [100, 100]);
  const z = S.bound({ k: 3, x: 50, y: -2000 }, 400, 300, 400, 300);
  assert.equal(z.x, 0);                 // cannot pan past the left edge
  assert.equal(z.y, 300 - 900);         // cannot pan past the bottom edge
});
