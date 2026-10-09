/* The shared image viewer's gesture maths (prep-viewer.js _pure). What must hold: a zoom keeps the point under the
 * fingers still; panning stops at the image's edges (an image narrower than the stage stays centred); past an edge or a
 * zoom limit the image follows with falling resistance and never more than a third of the stage; 1x to 5x.
 * node --test test/prep-viewer.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const V = createRequire(import.meta.url)("../prep-viewer.js");

test("viewer: zoom keeps the focal point still", () => {
  const t = { x: 10, y: -20 }, s = 1.5, s2 = 3, f = { x: 80, y: 40 };
  const t2 = V.zoomAt(t, s, s2, f);
  // The image point under f: (f - t) / s; after the zoom it must map back to f.
  const q = { x: (f.x - t.x) / s, y: (f.y - t.y) / s };
  assert.ok(Math.abs(t2.x + s2 * q.x - f.x) < 1e-9 && Math.abs(t2.y + s2 * q.y - f.y) < 1e-9);
  assert.deepEqual(V.zoomAt({ x: 0, y: 0 }, 1, 2, { x: 0, y: 0 }), { x: 0, y: 0 }, "a zoom about the centre does not pan");
});

test("viewer: pan limits and the rubber band", () => {
  assert.deepEqual(V.bounds(2, 300, 200, 400, 600), { x: 100, y: 0 }, "600 wide in 400: 100 each side; 400 tall in 600: centred");
  assert.deepEqual(V.clampPan({ x: 500, y: -90 }, 2, 300, 200, 400, 600), { x: 100, y: 0 });
  assert.deepEqual(V.clampPan({ x: 0, y: 0 }, 1, 300, 200, 400, 600), { x: 0, y: 0 });
  const p = V.softPan({ x: 400, y: 0 }, 2, 300, 200, 400, 600);
  assert.ok(p.x > 100 && p.x < 100 + 400 / 3, "past the edge it moves less than the finger and at most a third");
  assert.ok(V.rubber(50, 400) < V.rubber(100, 400) && V.rubber(1e6, 400) <= 400 / 3 + 1e-9);
  assert.equal(V.softScale(3), 3); assert.ok(V.softScale(7) > 5 && V.softScale(7) < 7); assert.ok(V.softScale(0.5) < 1 && V.softScale(0.5) > 0.5);
  assert.equal(V.MIN, 1); assert.equal(V.MAX, 5);
});
