/* Phase 2 select/shape pure helpers (study-select.js). node --test test/study-p2.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../study-select.js");

function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function genLine(r) { const cx = 0.5 + (r() - 0.5) * 0.2, cy = 0.5 + (r() - 0.5) * 0.2, ang = r() * Math.PI, len = 0.35 + r() * 0.15, hx = Math.cos(ang) * len / 2, hy = Math.sin(ang) * len / 2, pts = []; for (let i = 0; i < 24; i++) { const t = i / 23; const nx = -(hy), ny = (hx); const n = (r() * 2 - 1) * 0.004; pts.push([cx - hx + (2 * hx) * t + nx * n / Math.hypot(nx, ny) || 0, cy - hy + (2 * hy) * t + ny * n, 0.5]); } return pts; }
function genCircle(r) { const cx = 0.5 + (r() - 0.5) * 0.2, cy = 0.5 + (r() - 0.5) * 0.2, rad = 0.09 + r() * 0.06, pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; const rr = rad + (r() * 2 - 1) * 0.004; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.5]); } return pts; }
function genEllipse(r) { const cx = 0.5 + (r() - 0.5) * 0.2, cy = 0.5 + (r() - 0.5) * 0.2, rx = 0.08 + r() * 0.08, ry = rx * (0.35 + r() * 0.35), pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; pts.push([cx + Math.cos(a) * (rx + (r() * 2 - 1) * 0.003), cy + Math.sin(a) * (ry + (r() * 2 - 1) * 0.003), 0.5]); } return pts; }
function genRect(r) { const cx = 0.5 + (r() - 0.5) * 0.15, cy = 0.5 + (r() - 0.5) * 0.15, hw = 0.08 + r() * 0.07, hh = hw * (0.4 + r() * 0.5); const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh; const per = []; const E = 8; for (let k = 0; k <= E; k++) per.push([x0 + (x1 - x0) * k / E, y0]); for (let k = 1; k <= E; k++) per.push([x1, y0 + (y1 - y0) * k / E]); for (let k = 1; k <= E; k++) per.push([x1 - (x1 - x0) * k / E, y1]); for (let k = 1; k < E; k++) per.push([x0, y1 - (y1 - y0) * k / E]); return per.map((p) => [p[0] + (r() * 2 - 1) * 0.003, p[1] + (r() * 2 - 1) * 0.003, 0.5]); }
function genTri(r) { const cx = 0.5 + (r() - 0.5) * 0.15, cy = 0.5 + (r() - 0.5) * 0.15; const top = [cx + (r() - 0.5) * 0.06, cy - 0.10 - r() * 0.04], bl = [cx - 0.10 - r() * 0.03, cy + 0.08 + r() * 0.03], br = [cx + 0.10 + r() * 0.03, cy + 0.08 + r() * 0.03]; const V = [top, bl, br]; const per = []; const M = 10; for (let e = 0; e < 3; e++) { const A = V[e], B = V[(e + 1) % 3]; for (let f = 0; f <= M; f++) per.push([A[0] + (B[0] - A[0]) * f / M, A[1] + (B[1] - A[1]) * f / M]); } return per.map((p) => [p[0] + (r() * 2 - 1) * 0.003, p[1] + (r() * 2 - 1) * 0.003, 0.5]); }
function genArrow(r) { const cx = 0.5 + (r() - 0.5) * 0.15, cy = 0.5 + (r() - 0.5) * 0.15, ang = r() * Math.PI - 0.4, len = 0.3 + r() * 0.1, hx = Math.cos(ang) * len / 2, hy = Math.sin(ang) * len / 2; const A = [cx - hx, cy - hy], B = [cx + hx, cy + hy]; const hd = 0.11 + r() * 0.05; const d1 = [B[0] + hd * Math.cos(ang + Math.PI - 0.55), B[1] + hd * Math.sin(ang + Math.PI - 0.55)], d2 = [B[0] + hd * Math.cos(ang + Math.PI + 0.55), B[1] + hd * Math.sin(ang + Math.PI + 0.55)]; const pts = []; const seg = (P, Q, n) => { for (let i = 0; i <= n; i++) pts.push([P[0] + (Q[0] - P[0]) * i / n + (r() * 2 - 1) * 0.002, P[1] + (Q[1] - P[1]) * i / n + (r() * 2 - 1) * 0.002, 0.5]); }; seg(A, B, 16); seg(B, d1, 5); seg(d1, B, 5); seg(B, d2, 5); return pts; }
// Handwriting: letter-like humps with varying heights plus small zigzags. Must never snap.
function genWord(r) { const x0 = 0.12 + r() * 0.05, y = 0.32 + r() * 0.08, w = 0.35 + r() * 0.2, n = 70, pts = []; const humps = []; for (let h = 0; h < 4; h++) humps.push({ c: 0.1 + r() * 0.8, w: 0.12 + r() * 0.12, a: 0.018 + r() * 0.03 }); for (let i = 0; i < n; i++) { const t = i / (n - 1); let yy = y; for (const h of humps) yy -= h.a * Math.exp(-Math.pow((t - h.c) / h.w, 2)); yy += (r() * 2 - 1) * 0.003 + 0.01 * t; pts.push([x0 + w * t, yy, 0.5]); } return pts; }
function genZig(r) { const x = 0.2 + r() * 0.05, y = 0.3 + r() * 0.05, w = 0.04 + r() * 0.02, h = 0.05, revs = 3 + Math.floor(r() * 3), per = 5, pts = []; for (let rr = 0; rr <= revs; rr++) for (let s = 0; s < per; s++) pts.push([x + (rr % 2 ? w - (w * s) / per : (w * s) / per), y + (h * (rr + s / per)) / (revs + 1), 0.5]); return pts; }

test("shape fitter: 12 noisy samples each, at least 11 of 12 correct (90%+)", () => {
  const gens = { line: genLine, circle: genCircle, ellipse: genEllipse, rect: genRect, triangle: genTri, arrow: genArrow };
  for (const [name, gen] of Object.entries(gens)) {
    const r = mulberry32(1234);
    let ok = 0;
    for (let i = 0; i < 12; i++) { const f = S.fitShape(gen(r)); if (f && f.type === name) ok++; }
    assert.ok(ok >= 11, name + " expected >=11/12, got " + ok);
  }
});

test("shape fitter: 20 handwriting samples have 0 false snaps; small dots never snap", () => {
  const r = mulberry32(777);
  let fp = 0;
  for (let i = 0; i < 10; i++) if (S.fitShape(genWord(r))) fp++;
  for (let i = 0; i < 10; i++) if (S.fitShape(genZig(r))) fp++;
  assert.equal(fp, 0);
  assert.equal(S.fitShape([[0.5, 0.5, 0.5], [0.501, 0.5, 0.5]]), null);
  assert.equal(S.fitShape([[0.5, 0.5, 0.5]]), null);
  assert.equal(S.fitShape([]), null);
  // a small closed letter-o size loop stays ink (below CLOSED_MIN)
  const o = [];
  for (let i = 0; i < 32; i++) { const a = (i / 32) * 2 * Math.PI; o.push([0.5 + Math.cos(a) * 0.012, 0.5 + Math.sin(a) * 0.012, 0.5]); }
  assert.equal(S.fitShape(o), null);
});

test("fitForced never returns null for 3+ points (Shapes tool snaps every stroke)", () => {
  const r = mulberry32(42);
  for (let i = 0; i < 8; i++) assert.ok(S.fitForced(genWord(r)) !== null);
  assert.ok(S.fitForced([[0.2, 0.2, 0.5], [0.5, 0.5, 0.5], [0.8, 0.2, 0.5]]) !== null);
  assert.equal(S.fitForced([[0.5, 0.5, 0.5]]), null);
});

test("shapePts outline round-trips through the fitter for every shape type", () => {
  const r = mulberry32(99);
  const makers = { line: genLine, circle: genCircle, ellipse: genEllipse, rect: genRect, triangle: genTri, arrow: genArrow };
  for (const [name, gen] of Object.entries(makers)) {
    const f = S.fitShape(gen(r));
    assert.ok(f, name + " fits");
    const back = S.fitShape(S.shapePts(f));
    assert.equal(back && back.type, name, name + " outline re-fits");
  }
});

test("bbox, translate and scale: line width follows the scale factor", () => {
  const s = { id: "a", pts: [[0.2, 0.2, 0.5], [0.6, 0.6, 0.5]], w: 0.004, color: "#111111" };
  const bb = S.bboxOf(s.pts);
  assert.deepEqual([bb.x0, bb.y0, bb.x1, bb.y1], [0.2, 0.2, 0.6, 0.6]);
  const m = S.translate(s, 0.1, 0.05);
  assert.deepEqual(m.pts[0], [0.3, 0.25, 0.5]);
  assert.deepEqual(s.pts[0], [0.2, 0.2, 0.5]); // original untouched
  const z = S.scaleStroke(s, 0.5, 0.5, 2, 2);
  assert.ok(Math.abs(z.w - 0.008) < 1e-9, "width doubles at 2x");
  const st = S.scaleStroke(s, 0.5, 0.5, 2, 1);
  assert.ok(Math.abs(st.w - 0.006) < 1e-9, "width scales by mean factor on a side stretch");
  assert.equal(S.selBBox([s, { pts: [[0.9, 0.05, 0.5]] }]).x0, 0.2);
  assert.equal(S.selBBox([]), null);
});

test("rotate 90 twice is 180; clamp keeps ink on the page", () => {
  const s = { id: "a", pts: [[0.3, 0.5, 0.5], [0.7, 0.5, 0.5]], w: 0.003, color: "#1a56db" };
  const r180 = S.rotateStroke(S.rotateStroke(s, 90, 0.5, 0.5, 1), 90, 0.5, 0.5, 1);
  assert.deepEqual(r180.pts[0].slice(0, 2), [0.7, 0.5]);
  const c = S.clampStroke({ id: "b", pts: [[-0.2, 0.5, 0.5], [1.2, 0.5, 0.5]], w: 0.003, color: "#111111" });
  c.pts.forEach((p) => assert.ok(p[0] >= 0 && p[0] <= 1));
});

test("xform snapshots: applySnap restores before, redo reapplies after", () => {
  const a = { id: "a", pts: [[0.2, 0.2, 0.5]], w: 0.004, color: "#111111" };
  const b = { id: "b", pts: [[0.4, 0.4, 0.5]], w: 0.004, color: "#111111" };
  const strokes = [a, b];
  const before = S.snapItems(strokes);
  b.pts = [[0.9, 0.9, 0.5]];
  const after = S.snapItems(strokes);
  S.applySnap(strokes, before);
  assert.deepEqual(strokes[1].pts[0], [0.4, 0.4, 0.5]);
  S.applySnap(strokes, after);
  assert.deepEqual(strokes[1].pts[0], [0.9, 0.9, 0.5]);
});

test("clipboard: encode/decode round trips, bad JSON and wrong version rejected", () => {
  const items = [{ tool: "pen", color: "#111111", w: 0.004, pts: [[0.2, 0.2, 0.5], [0.5, 0.5, 0.7]], shape: null, gone: false }];
  const clip = S.decodeClip(S.encodeClip(items));
  assert.equal(clip.items.length, 1);
  assert.equal(clip.items[0].color, "#111111");
  assert.deepEqual(clip.items[0].pts, [[0.2, 0.2, 0.5], [0.5, 0.5, 0.7]]);
  assert.throws(() => S.decodeClip("not json"));
  assert.equal(S.decodeClip(JSON.stringify({ v: 2, items: [] })), null);
  assert.equal(S.decodeClip(JSON.stringify({ v: 1 })), null);
});

test("lasso settings: highlighter can be excluded, pen and shapes stay", () => {
  assert.equal(S.lassoPick(null, { tool: "hl" }), true);
  assert.equal(S.lassoPick(null, { tool: "pen" }), true);
  const d = S.lassoDefaults();
  d.hl = false;
  assert.equal(S.lassoPick(d, { tool: "hl" }), false);
  assert.equal(S.lassoPick(d, { tool: "pen" }), true);
  assert.equal(S.lassoPick(d, { tool: "shape" }), true);
  assert.equal(S.lassoPick(d, { tool: "text" }), true);
  assert.equal(S.lassoPick(d, null), false);
  const m = S.mergeSelectSettings({ lasso: { hl: false }, shapeFill: "25", drawSnap: false });
  assert.equal(m.lasso.hl, false);
  assert.equal(m.lasso.pen, true);
  assert.equal(m.shapeFill, "25");
  assert.equal(m.drawSnap, false);
});

test("handles: corners proportional, sides stretch, centre inside", () => {
  const bb = { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6, cx: 0.4, cy: 0.4 };
  assert.equal(S.handlesOf(bb).length, 8);
  assert.equal(S.handleAt(bb, 0.2, 0.2, 400, 400, 22), "nw");
  assert.equal(S.handleAt(bb, 0.4, 0.4, 400, 400, 22), null);
  assert.equal(S.insideBB(bb, 0.4, 0.4), true);
  assert.equal(S.insideBB(bb, 0.05, 0.05), false);
  const corner = S.resizeFactors(bb, "se", 0.8, 0.8);
  assert.equal(corner.sx, corner.sy); // proportional
  assert.ok(corner.sx > 1.4 && corner.sx < 1.6);
  const side = S.resizeFactors(bb, "e", 0.8, 0.4);
  assert.ok(side.sx > 1.4 && Math.abs(side.sy - 1) < 1e-9);
  const tiny = S.resizeFactors(bb, "se", 0.21, 0.9);
  assert.ok(tiny.sx * 0.4 >= 0.02 - 1e-9, "min side respected");
});

test("pickGesture: flat selection centre moves, corner resizes, degenerate axis never explodes", () => {
  const flat = { x0: 0.15, y0: 0.74, x1: 0.85, y1: 0.74, cx: 0.5, cy: 0.74 };
  assert.equal(S.pickGesture(flat, 0.5, 0.74, 344, 486, 22).kind, "move");
  const corner = S.pickGesture(flat, 0.85, 0.74, 344, 486, 22);
  assert.equal(corner.kind, "resize");
  const f = S.resizeFactors({ x0: 0.15, y0: 0.74, x1: 0.85, y1: 0.74 }, "se", 0.95, 0.84);
  assert.ok(Math.abs(f.sx - 8 / 7) < 1e-6 && f.sy === 1, "flat corner scales x only: " + JSON.stringify(f));
});

test("pickGesture: tall box interior moves, edge dots resize, outside is null", () => {
  const tall = { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6, cx: 0.4, cy: 0.4 };
  assert.equal(S.pickGesture(tall, 0.4, 0.4, 400, 400, 22).kind, "move");
  assert.equal(S.pickGesture(tall, 0.4, 0.2, 400, 400, 22).handle, "n");
  assert.equal(S.pickGesture(tall, 0.6, 0.6, 400, 400, 22).handle, "se");
  assert.equal(S.pickGesture(tall, 0.05, 0.05, 400, 400, 22), null);
  assert.equal(S.pickGesture(null, 0.4, 0.4, 400, 400, 22), null);
});

test("dwell gate: snap only at 500ms and only when enabled", () => {
  assert.equal(S.dwellSnap(499, true), false);
  assert.equal(S.dwellSnap(500, true), true);
  assert.equal(S.dwellSnap(900, false), false);
});

test("nearStroke finds shape outlines and misses far points", () => {
  const s = { tool: "shape", w: 0.004, pts: [[0.2, 0.2, 0.5], [0.8, 0.2, 0.5]] };
  assert.equal(S.nearStroke(s, 0.5, 0.2, 8, 400, 400), true);
  assert.equal(S.nearStroke(s, 0.5, 0.5, 8, 400, 400), false);
});
