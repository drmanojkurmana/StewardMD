/* Phase 1 ink engine pure helpers (study-ink.js). node --test test/study-ink.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const I = createRequire(import.meta.url)("../study-ink.js");

test("1.4 pressure: 0% constant, 100% doubles under hard press", () => {
  assert.equal(I.widthFactor(0, 0), 1);
  assert.equal(I.widthFactor(1, 0), 1);
  assert.equal(I.widthFactor(0.5, 0.5), 1);
  assert.equal(I.widthFactor(1, 1), 2);
  assert.ok(I.widthFactor(0, 1) < 0.2);
  assert.equal(I.effPressure(0.9, 0), 0.5);
});

test("1.2/1.3 pen styles: fountain tapers, ball even, brush heavy taper", () => {
  const pts = Array.from({ length: 21 }, (_, i) => [i / 20, 0.5, 0.5]);
  const wF = I.strokeWidths(pts, { style: "fountain", sens: 0.5, tip: 1, w: 0.0032 }, 800);
  const wB = I.strokeWidths(pts, { style: "ball", sens: 0.5, tip: 1, w: 0.0032 }, 800);
  const wBr = I.strokeWidths(pts, { style: "brush", sens: 0.5, tip: 1, w: 0.0032 }, 800);
  assert.ok(wF[0] < wF[10] * 0.4, "fountain sharp tip tapers at the start");
  assert.ok(Math.abs(wB[0] - wB[10]) < wB[10] * 0.05, "ball is even");
  assert.ok(wBr[0] < wB[0], "brush tapers heavier than ball at the ends");
  const blunt = I.strokeWidths(pts, { style: "fountain", sens: 0.5, tip: 0, w: 0.0032 }, 800);
  assert.ok(blunt[0] > wF[0], "blunt tip is wider at the start than sharp");
  assert.ok(I.outline(pts, { style: "fountain", sens: 0.5, tip: 0.7, w: 0.0032 }, 800, 800).length >= 40);
});

test("1.9 split: erasing the middle of a stroke gives two pieces, ends and no-touch keep it whole", () => {
  const pts = [[0.1, 0.5, 0.5], [0.3, 0.5, 0.5], [0.5, 0.5, 0.5], [0.7, 0.5, 0.5], [0.9, 0.5, 0.5]];
  const pieces = I.splitPts(pts, 0.5, 0.5, 30, 1000, 1000);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0][pieces[0].length - 1][0] < 0.5 && pieces[1][0][0] > 0.5);
  assert.equal(I.splitPts(pts, 0.5, 0.9, 30, 1000, 1000).length, 1);
  assert.deepEqual(I.splitPts([[0.5, 0.5, 0.5]], 0.5, 0.5, 30, 1000, 1000), []);
  assert.equal(I.splitPts([[0.1, 0.1, 0.5]], 0.5, 0.5, 30, 1000, 1000).length, 1);
});

test("1.8 straight snap: hold gate at 500ms and snap keeps only the ends", () => {
  assert.equal(I.isStraightSnap(499), false);
  assert.equal(I.isStraightSnap(500), true);
  assert.deepEqual(I.snapStraight([[0.1, 0.2, 0.5], [0.3, 0.4, 0.5], [0.9, 0.2, 0.5]]), [[0.1, 0.2, 0.5], [0.9, 0.2, 0.5]]);
});

test("1.16/1.17 palm and finger: pen draws, touch pans once a pen was seen, finger draws before that", () => {
  const pen = { pointerType: "pen", isPrimary: true };
  const touch = { pointerType: "touch", isPrimary: true };
  assert.equal(I.pointerAction(pen, { penSeen: true, drawFinger: false }), "draw");
  assert.equal(I.pointerAction(touch, { penSeen: true, drawFinger: true }), "pan");
  assert.equal(I.pointerAction(touch, { penSeen: false, drawFinger: true }), "draw");
  assert.equal(I.pointerAction(touch, { penSeen: false, drawFinger: false }), "pan");
  assert.equal(I.pointerAction({ pointerType: "touch", isPrimary: false }, { penSeen: false, drawFinger: true }), "ignore");
  assert.equal(I.pointerAction({ pointerType: "mouse", isPrimary: true, button: 2 }, {}), "ignore");
});

test("1.5/1.6 settings: defaults, per-tool width, recent colours capped at 5, hex check", () => {
  const s = I.mergeSettings({ pen: { style: "brush" } });
  assert.equal(s.pen.style, "brush");
  assert.equal(s.pen.sens, 0.5);
  assert.equal(s.eraser.mode, "standard");
  assert.equal(s.eraser.autoDeselect, true);
  assert.equal(I.activeWidth(s, "pen"), s.pen.widths[s.pen.wi]);
  let r = I.defaults();
  ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#111111"].forEach((c) => I.addRecent(r, c));
  assert.equal(r.recents.length, 5);
  assert.equal(r.recents[0], "#111111");
  assert.equal(I.validHex("#42cdb5"), true);
  assert.equal(I.validHex("red"), false);
  assert.equal(I.PEN_COLORS.length, 12);
  assert.equal(I.HL_COLORS.length, 12);
});

test("latency outline: 500-point stroke outlines without dropping points", () => {
  const pts = Array.from({ length: 500 }, (_, i) => [i / 500, 0.5 + Math.sin(i / 20) * 0.05, 0.5]);
  const t0 = Date.now();
  const poly = I.outline(pts, { style: "fountain", sens: 0.5, tip: 0.7, w: 0.0032 }, 800, 800);
  assert.ok(poly.length >= 900);
  assert.ok(Date.now() - t0 < 100, "outline of 500 points is fast (live-layer budget is 4ms in the browser; node bound is generous)");
});
