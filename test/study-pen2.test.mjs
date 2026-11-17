import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const INK = require("../study-ink.js");
const INS = require("../study-insert.js");
const W = 800, H = 1100;
const rel = (xy) => xy.map(([x, y]) => [x / W, y / H, 0.5]);

test("hold-to-straighten: wobbly open stroke becomes a straight line from start to end", () => {
  const pts = rel(Array.from({ length: 40 }, (_, i) => [100 + i * 10, 300 + Math.sin(i) * 6]));
  const s = INK.recognizeShape(pts, W, H);
  assert.equal(s.kind, "line");
  const a = s.pts[0], b = s.pts[s.pts.length - 1];
  assert.ok(Math.abs(a[0] * W - 100) < 1 && Math.abs(b[0] * W - 490) < 1);
  for (const p of s.pts) assert.ok(Math.abs(p[1] * H - (300 + (Math.sin(39) * 6) * ((p[0] * W - 100) / 390))) < 2, "points lie on the start-end line");
});

test("hold-to-straighten: closed boxy stroke becomes a rectangle", () => {
  const box = [];
  for (let i = 0; i <= 20; i++) box.push([100 + i * 15 + (i % 2), 200]);
  for (let i = 0; i <= 10; i++) box.push([400, 200 + i * 15]);
  for (let i = 0; i <= 20; i++) box.push([400 - i * 15, 350 + (i % 2)]);
  for (let i = 0; i <= 10; i++) box.push([100, 350 - i * 14]);
  const s = INK.recognizeShape(rel(box), W, H);
  assert.equal(s.kind, "rect");
});

test("hold-to-straighten: closed round stroke becomes an ellipse", () => {
  const c = Array.from({ length: 60 }, (_, i) => { const t = i / 57 * Math.PI * 2; return [300 + Math.cos(t) * 120, 400 + Math.sin(t) * 80]; });
  assert.equal(INK.recognizeShape(rel(c), W, H).kind, "ellipse");
});

test("hold-to-straighten: tiny marks and closed scribbles are left alone", () => {
  assert.equal(INK.recognizeShape(rel([[10, 10], [12, 11], [13, 12]]), W, H), null);
  const scr = Array.from({ length: 80 }, (_, i) => [300 + Math.cos(i * 2.7) * (40 + (i * 37) % 60), 300 + Math.sin(i * 1.3) * (30 + (i * 53) % 70)]);
  scr.push(scr[0]);
  assert.equal(INK.recognizeShape(rel(scr), W, H), null);
});

test("laser: Fade mode shows the trail 5 s after lift then fades; Keep mode stays", () => {
  const f = INS.laserStrokeAlpha, lift = 1000;
  assert.equal(f(1500, 0, "trail"), 1, "still drawing");
  assert.equal(f(lift + 4000, lift, "trail"), 1);
  assert.ok(f(lift + 4700, lift, "trail") > 0 && f(lift + 4700, lift, "trail") < 1);
  assert.equal(f(lift + 5000, lift, "trail"), 0);
  assert.equal(f(lift + 60000, lift, "keep"), 1);
});
