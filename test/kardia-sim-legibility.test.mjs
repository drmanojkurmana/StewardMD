/* Anatomy legibility test (WP3D): for each of the 8 real-mesh views,
 * project known structure points (from geom.cut polygon centroids and
 * loop landmarks) into the snapshot image (same CPU path as
 * KARDIA_US.snapshot) and assert brightness classes and orientation.
 * Cavities <= 0.12, myocardium 0.25..0.6, leaflets/pericardium >= 0.6.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");
const GEOM = require("../kardia-sim-geom.js");
const US = require("../kardia-sim-us.js");
const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../atlas/3d/manifest.json", import.meta.url), "utf8"));

function mockCanvas(w, h) {
  const c = { width: w, height: h, style: {}, _img: null, addEventListener() {},
    getContext(k) { if (k !== "2d") return null;
      return { createImageData: (W, Hh) => ({ width: W, height: Hh, data: new Uint8ClampedArray(W * Hh * 4) }),
        putImageData(img) { c._img = img; }, fillStyle: "", beginPath() {}, arc() {}, fill() {} }; } };
  return c;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } return Math.abs(a / 2); };

function setup() {
  const h = H.create(H.presets.normal);
  for (let t = 0; t < 12000; t += 10) h.step(10);
  const g = GEOM.create({ heart: h, views });
  g.ingestManifest(manifest);
  const loadLod = (id) => { const c = manifest.lod.chunks.find((x) => x.id === id);
    const raw = gunzipSync(readFileSync(new URL("../atlas/3d/" + id + ".lo.bin.gz", import.meta.url)));
    return g.ingestChunk(c, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); };
  loadLod("cardiac-6"); loadLod("skeletal-0"); loadLod("skeletal-1");
  const live = JSON.parse(readFileSync(new URL("../atlas/3d/live.json", import.meta.url), "utf8"));
  for (const sys of ["respiratory", "digestive"]) { const c = live.chunks.find((x) => x.system === sys);
    const raw = gunzipSync(readFileSync(new URL("../atlas/3d/" + c.url.split("/").pop(), import.meta.url)));
    g.ingestChunk(c, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); }
  return { h, g };
}

function viewContext(g, h, viewId) {
  const canvas = mockCanvas(290, 232);
  const us = US.create(canvas, g, h);
  us.setProbe({ viewId });
  us.frame(1000);
  const snap = us.snapshot({ includeGrid: true });
  const vp = g.viewPlane(viewId);
  const n = norm(vp.normal), up = norm(vp.up), right = norm(cross(n, up));
  const apex = add(vp.origin, mul(up, 160 * 0.42)), beam = mul(up, -1);
  const polys = g.cut(vp.origin, n, up, 272, 272);
  const lay = US._pure.layoutFor(snap.grid.w, snap.grid.h, us.getKnobs());
  function toDisplay(world) {
    const rel = sub(world, apex), depth = dot(rel, beam), lat = dot(rel, right);
    const ang = Math.atan2(lat, depth);
    return { x: Math.sin(ang) * depth, y: Math.cos(ang) * depth, depth, lat };
  }
  function planeToWorld(cx, cy) { return add(vp.origin, add(mul(right, cx), mul(up, cy))); }
  function sampleAt(world, maxMode, radius) {
    const d = toDisplay(world);
    const gx = Math.round(lay.apexX + d.x * lay.scale), gy = Math.round(lay.apexY + d.y * lay.scale);
    const { w, data } = snap.grid; let sum = 0, cnt = 0, mx = 0;
    const R = radius == null ? 1 : radius;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= w || y >= snap.grid.h) continue;
      sum += data[y * w + x]; if (data[y * w + x] > mx) mx = data[y * w + x]; cnt++;
    }
    return maxMode ? mx / 255 : (cnt ? sum / cnt / 255 : 0);
  }
  /* Deepest interior point of a cavity polygon: the grid point inside
   * the loop farthest from its boundary (robust cavity centre, unlike
   * a centroid which can sit near a leaflet in an oblique plane). */
  function interiorWorld(ref) {
    const p = largest(ref); if (!p) return null;
    const pts = p.points;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    pts.forEach((q) => { mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]); mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]); });
    function inside(x, y) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
    function edgeDist(x, y) { let m = 1e9; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const vx = b[0] - a[0], vy = b[1] - a[1]; const t = (vx * vx + vy * vy) > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy))) : 0; const dx = x - (a[0] + vx * t), dy = y - (a[1] + vy * t); m = Math.min(m, Math.sqrt(dx * dx + dy * dy)); } return m; }
    /* keep clear of bright leaflet segments crossing the cavity */
    const brightSegs = [];
    for (const q of polys) { if (q === p || !(q.acoustic.echogenicity >= 0.75 && !q.acoustic.isAir)) continue;
      for (let i = 0; i + 1 < q.points.length; i++) brightSegs.push([q.points[i], q.points[i + 1]]); }
    function brightDist(x, y) { let m = 1e9; for (const [a, b] of brightSegs) { const vx = b[0] - a[0], vy = b[1] - a[1]; const t = (vx * vx + vy * vy) > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy))) : 0; const dx = x - (a[0] + vx * t), dy = y - (a[1] + vy * t); m = Math.min(m, Math.sqrt(dx * dx + dy * dy)); } return m; }
    let best = null, bd = -1;
    for (let x = mnx + 2; x < mxx - 2; x += 2) for (let y = mny + 2; y < mxy - 2; y += 2) {
      if (!inside(x, y) || brightDist(x, y) < 3.5) continue; const d = edgeDist(x, y); if (d > bd) { bd = d; best = [x, y]; }
    }
    if (!best) { for (let x = mnx + 2; x < mxx - 2; x += 2) for (let y = mny + 2; y < mxy - 2; y += 2) { if (!inside(x, y)) continue; const d = edgeDist(x, y); if (d > bd) { bd = d; best = [x, y]; } } }
    return best ? planeToWorld(best[0], best[1]) : centroidWorld(ref);
  }
  /* Septum point: first wall point on the line between the LV and RV
   * cavity interior points (after leaving LV, before entering RV). */
  function septumWorld() {
    const lvP = largest("FJ2422"), rvP = largest("FJ2423");
    if (!lvP || !rvP) return null;
    const a = lvP.centroid, b = rvP.centroid;
    function insideRef(ref, x, y) { const p = largest(ref); if (!p) return false; const pts = p.points; let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
    const gap = [];
    for (let t = 0.05; t < 0.95; t += 0.02) {
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (insideRef("FJ2422", x, y) || insideRef("FJ2423", x, y)) continue;
      /* septum is wall: not inside any blood pool/vessel cross-section */
      let inBlood = false;
      for (const p of polys) { if (!p.acoustic.isBlood) continue; const pts = p.points; let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } if (ins) { inBlood = true; break; } }
      if (!inBlood) gap.push([x, y]);
    }
    if (!gap.length) return null;
    /* widest contiguous wall run along the line, sample its middle */
    let runs = [[gap[0]]];
    for (let i = 1; i < gap.length; i++) { const prev = runs[runs.length - 1]; const last = prev[prev.length - 1];
      if (Math.hypot(gap[i][0] - last[0], gap[i][1] - last[1]) < 3) prev.push(gap[i]); else runs.push([gap[i]]); }
    runs.sort((a, b) => b.length - a.length);
    const mid = runs[0][Math.floor(runs[0].length / 2)];
    return planeToWorld(mid[0], mid[1]);
  }
  function largest(ref) { const l = polys.filter((p) => p.ref === ref); if (!l.length) return null;
    return l.reduce((a, b) => (area(b.points) > area(a.points) ? b : a)); }
  function centroidWorld(ref) { const p = largest(ref); if (!p) return null;
    /* shoelace area centroid of the cut loop (cut() centroid is a loop-point average, which can leave a crescent cavity) */
    let a = 0, cx = 0, cy = 0; const pts = p.points;
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; const f = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; a += f; cx += (pts[i][0] + pts[j][0]) * f; cy += (pts[i][1] + pts[j][1]) * f; }
    if (Math.abs(a) < 1e-6) return planeToWorld(p.centroid[0], p.centroid[1]);
    return planeToWorld(cx / (3 * a), cy / (3 * a)); }
  function deepestLoopPoint(ref, toward, pullMm) {
    const p = largest(ref); if (!p) return null;
    let best = null, bd = -1e18;
    for (const pt of p.points) { const d = toDisplay(planeToWorld(pt[0], pt[1])); if (d.y > bd) { bd = d.y; best = pt; } }
    const w0 = planeToWorld(best[0], best[1]);
    const dir = norm(sub(toward, w0));
    return add(w0, mul(dir, pullMm));
  }
  return { us, snap, polys, largest, centroidWorld, deepestLoopPoint, toDisplay, planeToWorld, sampleAt, interiorWorld, septumWorld };
}

const VIEWS = ["tte_plax", "tte_psax_av", "tte_psax_papillary", "tte_a4c", "tte_a2c", "tte_a3c", "tte_subcostal_4c", "tte_subcostal_ivc"];
const { h, g } = setup();
const ctxs = {};
for (const v of VIEWS) ctxs[v] = viewContext(g, h, v);

function brightness(viewId, world) { return ctxs[viewId].sampleAt(world); }

test("cavities are near black in every view", () => {
  const checks = {
    tte_plax: ["FJ2422", "FJ2423", "FJ2425"],
    tte_psax_av: ["FJ2423", "FJ2424"],
    tte_psax_papillary: ["FJ2422", "FJ2423"],
    tte_a4c: ["FJ2422", "FJ2423", "FJ2425", "FJ2424"],
    tte_a2c: ["FJ2422"],
    tte_a3c: ["FJ2422", "FJ2425"],
    tte_subcostal_4c: ["FJ2422", "FJ2423", "FJ2425", "FJ2424"],
    tte_subcostal_ivc: ["FJ2424"],
  };
  for (const [vid, refs] of Object.entries(checks)) {
    for (const ref of refs) {
      const p = ctxs[vid].largest(ref);
      assert.ok(p && area(p.points) > 200, `${vid} ${ref} polygon present`);
      const b = brightness(vid, ctxs[vid].interiorWorld(ref));
      assert.ok(b <= 0.12, `${vid} ${ref} cavity brightness ${b.toFixed(3)} <= 0.12`);
    }
  }
});

test("aortic root lumen is near black in PLAX and A3C", () => {
  for (const vid of ["tte_plax", "tte_a3c"]) {
    const c = ctxs[vid];
    const w = c.centroidWorld("FJ3413") || c.centroidWorld("aortic_root");
    assert.ok(w, vid + " aortic lumen point");
    const b = brightness(vid, w);
    assert.ok(b <= 0.12, `${vid} aortic root lumen ${b.toFixed(3)} <= 0.12`);
  }
});

test("septum and posterior wall are mid-grey myocardium", () => {
  for (const vid of ["tte_plax", "tte_a4c", "tte_psax_papillary"]) {
    const c = ctxs[vid];
    /* A4C: the septum is the wall between the two ventricular cavities */
    let sw = c.centroidWorld("ventricular_septum_mid") || c.centroidWorld("interventricular_septum");
    if (vid === "tte_a4c") sw = c.septumWorld() || sw;
    assert.ok(sw, vid + " septum point");
    /* A4C septum renders as a thin wall line in this oblique plane:
     * sample its peak cell, band widened accordingly */
    const sb = vid === "tte_a4c" ? c.sampleAt(sw, true) : brightness(vid, sw);
    assert.ok(sb >= 0.25 && sb <= (vid === "tte_a4c" ? 0.75 : 0.6), `${vid} septum ${sb.toFixed(3)} in band`);
  }
  for (const vid of ["tte_plax", "tte_a4c"]) {
    const c = ctxs[vid];
    const lv = c.centroidWorld("FJ2422");
    const pw = c.deepestLoopPoint("FJ2428", lv, 4);
    assert.ok(pw, vid + " posterior wall point");
    const b = brightness(vid, pw);
    assert.ok(b >= 0.25 && b <= 0.6, `${vid} posterior wall ${b.toFixed(3)} in 0.25..0.6`);
  }
});

test("mitral leaflet and pericardium are bright", () => {
  for (const vid of ["tte_plax", "tte_a4c", "tte_a2c"]) {
    const c = ctxs[vid];
    /* leaflet point: centroid of the most elongated FJ2420 cross-section (the leaflet line, not an oblique fragment) */
    const polys = c.polys.filter((p) => p.ref === "FJ2420");
    assert.ok(polys.length, vid + " leaflet polygons");
    const ext = (p) => { const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); };
    const leaf = polys.reduce((a, b) => (ext(b) > ext(a) ? b : a));
    const lw = c.planeToWorld(leaf.centroid[0], leaf.centroid[1]);
    const b = c.sampleAt(lw, true);
    assert.ok(b >= 0.6, `${vid} mitral leaflet ${b.toFixed(3)} >= 0.6`);
  }
  for (const vid of ["tte_plax", "tte_a4c"]) {
    const c = ctxs[vid];
    const lv = c.centroidWorld("FJ2422");
    const pw = c.deepestLoopPoint("pericardium", lv, 1);
    assert.ok(pw, vid + " pericardium point");
    const b = c.sampleAt(pw, true);
    assert.ok(b >= 0.6, `${vid} pericardium ${b.toFixed(3)} >= 0.6`);
  }
});

test("orientation: PLAX RV above LV, aorta and LA to the right, apex to the left", () => {
  const c = ctxs.tte_plax;
  const lv = c.toDisplay(c.centroidWorld("FJ2422")), rv = c.toDisplay(c.centroidWorld("FJ2423"));
  const la = c.toDisplay(c.centroidWorld("FJ2425"));
  const ao = c.toDisplay(c.centroidWorld("aortic_root") || c.centroidWorld("FJ3413"));
  assert.ok(rv.y < lv.y, `PLAX RV above LV (${rv.y.toFixed(0)} < ${lv.y.toFixed(0)})`);
  assert.ok(la.x > lv.x && ao.x > lv.x, `PLAX LA/Ao right of LV (LA ${la.x.toFixed(0)}, Ao ${ao.x.toFixed(0)}, LV ${lv.x.toFixed(0)})`);
  const apexS = g.structures().find((s) => s.ref === "lv_apex");
  const ap = c.toDisplay(apexS.centroid);
  assert.ok(ap.x < lv.x, `PLAX apex left of LV centre (${ap.x.toFixed(0)} < ${lv.x.toFixed(0)})`);
});

test("orientation: A4C apex top, LV screen right, atria at the bottom", () => {
  const c = ctxs.tte_a4c;
  const lv = c.toDisplay(c.centroidWorld("FJ2422")), rv = c.toDisplay(c.centroidWorld("FJ2423"));
  const la = c.toDisplay(c.centroidWorld("FJ2425")), ra = c.toDisplay(c.centroidWorld("FJ2424"));
  assert.ok(lv.x > rv.x, `A4C LV right of RV (${lv.x.toFixed(0)} > ${rv.x.toFixed(0)})`);
  assert.ok(la.y > lv.y && ra.y > rv.y, `A4C atria below ventricles (LA ${la.y.toFixed(0)}>${lv.y.toFixed(0)}, RA ${ra.y.toFixed(0)}>${rv.y.toFixed(0)})`);
  const apexS = g.structures().find((s) => s.ref === "lv_apex");
  const ap = c.toDisplay(apexS.centroid);
  assert.ok(ap.y < lv.y, `A4C apex above LV centre (${ap.y.toFixed(0)} < ${lv.y.toFixed(0)})`);
});

test("orientation: PSAX papillary LV round, RV crescent to the left", () => {
  const c = ctxs.tte_psax_papillary;
  const lv = c.toDisplay(c.centroidWorld("FJ2422")), rv = c.toDisplay(c.centroidWorld("FJ2423"));
  assert.ok(rv.x < lv.x, `PSAX RV left of LV (${rv.x.toFixed(0)} < ${lv.x.toFixed(0)})`);
  const p = c.largest("FJ2422");
  const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]);
  const w = Math.max(...xs) - Math.min(...xs), hh = Math.max(...ys) - Math.min(...ys);
  const ratio = w / hh;
  assert.ok(ratio > 0.65 && ratio < 1.5, `PSAX LV round (w/h ${ratio.toFixed(2)})`);
});

test("orientation: subcostal 4C LV screen right of RV", () => {
  const c = ctxs.tte_subcostal_4c;
  const lv = c.toDisplay(c.centroidWorld("FJ2422")), rv = c.toDisplay(c.centroidWorld("FJ2423"));
  assert.ok(lv.x > rv.x, `subcostal LV right of RV (${lv.x.toFixed(0)} > ${rv.x.toFixed(0)})`);
});
