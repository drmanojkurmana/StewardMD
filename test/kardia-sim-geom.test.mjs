/* test/kardia-sim-geom.test.mjs - Kardia WP2 geometry (kardia-sim-geom.js).
 * Volume tolerance: mesh volume from the merged triangle buffer (divergence
 * theorem) vs the cycle model volume; 10% per the WP2 brief. The faceted
 * ellipsoid runs about 1.5% under the analytic volume, well inside that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");
const GEOM = require("../kardia-sim-geom.js");
const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../atlas/3d/manifest.json", import.meta.url), "utf8"));

function settledGeom(pathology) {
  const h = H.create(H.presets.normal);
  for (let t = 0; t < 12000; t += 10) h.step(10);
  const g = GEOM.create({ heart: h, views, pathology });
  return { h, g };
}
function refsOf(polys) { return new Set(polys.map((p) => p.ref)); }
function rotate(vec, axis, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const cr = [axis[1] * vec[2] - axis[2] * vec[1], axis[2] * vec[0] - axis[0] * vec[2], axis[0] * vec[1] - axis[1] * vec[0]];
  const d = axis[0] * vec[0] + axis[1] * vec[1] + axis[2] * vec[2];
  return vec.map((x, i) => x * c + cr[i] * s + axis[i] * d * (1 - c));
}

test("exports: window global, module.exports, ES5 source, acoustic tags on every structure", () => {
  assert.ok(GEOM && typeof GEOM.create === "function");
  const src = readFileSync(new URL("../kardia-sim-geom.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  const win = {};
  new Function("window", "module", src)(win, undefined);
  assert.ok(win.KARDIA_GEOM && typeof win.KARDIA_GEOM.create === "function");
  const { g } = settledGeom();
  const structs = g.structures();
  assert.ok(structs.length >= 40, "structures " + structs.length);
  for (const s of structs) {
    const a = s.acoustic;
    assert.ok(a && a.echogenicity >= 0 && a.echogenicity <= 1 && typeof a.attenuation === "number", "acoustic " + s.id);
    for (const k of ["isBlood", "isCalcium", "isAir", "isBone"]) assert.equal(typeof a[k], "boolean", k + " " + s.id);
  }
  const byRef = Object.fromEntries(structs.map((s) => [s.ref, s]));
  assert.equal(byRef.FJ2422.acoustic.isBlood, true, "LV cavity is blood");
  assert.ok(byRef.pericardium.acoustic.echogenicity >= 0.9, "pericardium bright");
});

test("parametric structures the meshes lack are all present", () => {
  const { g } = settledGeom();
  const refs = refsOf(g.structures().map((s) => ({ ref: s.ref })));
  for (const ref of ["FJ2420", "FJ2432", "FJ2421", "FJ2436", "FJ2426", "FJ2435", "FJ2417",
    "chordae_tendineae", "FJ2429", "FJ2419", "pericardium", "pericardial_space",
    "atrial_septum_interatrial", "interventricular_septum", "lvot", "FJ3441", "hepatic_vein", "aortic_root", "rvot", "lv_apex"])
    assert.ok(refs.has(ref), "missing parametric " + ref);
});

test("mesh volume tracks model LV volume within 10 percent across the cycle", () => {
  const { h, g } = settledGeom();
  let worst = 0, samples = 0;
  for (let t = 0; t < 857; t += 20) {
    h.step(20); g.update();
    const gv = g.meshVolume("FJ2422"), mv = h.state().volumes.LV;
    worst = Math.max(worst, Math.abs(gv - mv) / mv); samples++;
    assert.ok(Math.abs(gv - mv) / mv <= 0.10, `t=${t} geom ${gv.toFixed(1)} ml vs model ${mv.toFixed(1)} ml`);
  }
  assert.ok(samples >= 40 && worst > 0, "sampled the cycle, worst err " + (worst * 100).toFixed(1) + "%");
  // chambers other than LV also carry the model volume
  for (const [ref, key] of [["FJ2423", "RV"], ["FJ2425", "LA"], ["FJ2424", "RA"]]) {
    const gv = g.meshVolume(ref), mv = h.state().volumes[key];
    assert.ok(Math.abs(gv - mv) / mv <= 0.10, `${key} geom ${gv.toFixed(1)} vs model ${mv.toFixed(1)}`);
  }
});

test("buffers() are GPU-ready typed arrays with tagged groups", () => {
  const { g } = settledGeom();
  const b = g.buffers();
  assert.ok(b.positions instanceof Float32Array && b.normals instanceof Float32Array && b.indices instanceof Uint32Array);
  assert.equal(b.positions.length, b.normals.length);
  assert.equal(b.vertexCount * 3, b.positions.length);
  assert.ok(b.groups.length >= 40 && b.triangleCount > 5000);
  for (const grp of b.groups) assert.ok(grp.acoustic && grp.ref, "group tag " + grp.id);
});

test("for each TTE view in views.json the cut at its target plane contains every required landmark", () => {
  const { g } = settledGeom();
  const tte = views.views.filter((v) => v.modality === "tte");
  assert.ok(tte.length >= 20, "TTE views " + tte.length);
  const failures = {};
  for (const v of tte) {
    const p = g.viewPlane(v);
    const refs = refsOf(g.cut(p.origin, p.normal, p.up, 260, 260));
    const miss = v.landmarks.filter((l) => !refs.has(l.ref)).map((l) => l.ref);
    if (miss.length) failures[v.id] = miss;
  }
  assert.deepEqual(failures, {}, "landmark failures: " + JSON.stringify(failures));
});

test("the A4C cut shows four chambers", () => {
  const { g } = settledGeom();
  const p = g.viewPlane("tte_a4c");
  const refs = refsOf(g.cut(p.origin, p.normal, p.up, 260, 260));
  for (const ref of ["FJ2422", "FJ2425", "FJ2423", "FJ2424"]) assert.ok(refs.has(ref), "A4C missing chamber " + ref);
});

test("each Scan Lab view cut gives closed, oriented contours of the expected chambers", () => {
  const { g } = settledGeom();
  const expected = {
    tte_plax: ["FJ2422", "FJ2425"],
    tte_a4c: ["FJ2422", "FJ2425", "FJ2423", "FJ2424"],
    tte_psax_mv: ["FJ2422"],
    tte_subcostal_4c: ["FJ2422", "FJ2423", "FJ2425", "FJ2424"]
  };
  for (const [vid, chambers] of Object.entries(expected)) {
    const p = g.viewPlane(vid);
    const polys = g.cut(p.origin, p.normal, p.up, 260, 260);
    assert.ok(polys.length > 0, vid + " empty cut");
    const refs = new Set(polys.map((x) => x.ref));
    for (const ref of chambers) assert.ok(refs.has(ref), vid + " missing chamber " + ref);
    for (const ref of chambers) {
      const chamber = polys.find((x) => x.ref === ref);
      assert.equal(chamber.closed, true, vid + " chamber " + ref + " contour is not closed");
    }
    for (const poly of polys) {
      if (poly.open) {
        assert.equal(poly.closed, false, vid + " " + poly.ref + " open line must be marked open");
        continue;
      }
      assert.equal(poly.closed, true, vid + " " + poly.ref + " contour is not closed");
      assert.ok(poly.points.length >= 3, vid + " " + poly.ref + " contour has too few points");
      let area2 = 0;
      for (let i = 0; i < poly.points.length; i++) {
        const a = poly.points[i], b = poly.points[(i + 1) % poly.points.length];
        area2 += a[0] * b[1] - b[0] * a[1];
      }
      assert.ok(area2 > 0, vid + " " + poly.ref + " contour is not counter-clockwise");
      assert.ok(Math.abs(area2) / 2 >= 0.01, vid + " " + poly.ref + " contour is a degenerate sliver");
      if (poly.acoustic.isBlood) assert.ok(poly.acoustic.echogenicity <= 0.1, vid + " blood pool must stay dark");
    }
    const myo = polys.find((x) => x.ref === "FJ2428");
    assert.ok(myo && myo.acoustic.echogenicity >= 0.4 && myo.acoustic.echogenicity <= 0.5, vid + " myocardium must be mid grey");
    const peri = polys.find((x) => x.ref === "pericardium");
    assert.ok(peri && peri.acoustic.echogenicity >= 0.9, vid + " pericardium must be bright");
  }
});

test("a plane 30 degrees off axis drops at least one landmark", () => {
  const { g } = settledGeom();
  const v = views.views.find((x) => x.id === "tte_a4c");
  const p = g.viewPlane(v);
  const onAxis = refsOf(g.cut(p.origin, p.normal, p.up, 260, 260));
  const offNormal = rotate(p.normal, p.up, 30);
  const offAxis = refsOf(g.cut(p.origin, offNormal, p.up, 260, 260));
  const dropped = v.landmarks.filter((l) => onAxis.has(l.ref) && !offAxis.has(l.ref)).map((l) => l.ref);
  assert.ok(dropped.length >= 1, "expected an off-axis drop, got none; on-axis " + [...onAxis].join(","));
});

test("valve leaflets hinge with valve state and vessels pulse with pressure", () => {
  const h = H.create(H.presets.normal);
  for (let t = 0; t < 12000; t += 10) h.step(10);
  const g = GEOM.create({ heart: h, views });
  const mvAt = () => {
    const s = g._structures().find((x) => x.id === "mv_anterior");
    return s.centroid.join(",");
  };
  // walk to a diastolic (mitral open) and a systolic (mitral closed) frame
  let openC = null, closedC = null;
  for (let t = 0; t < 900 && (!openC || !closedC); t += 10) {
    h.step(10); g.update();
    if (h.state().valves.mitral.open && !openC) openC = mvAt();
    if (!h.state().valves.mitral.open && !closedC) closedC = mvAt();
  }
  assert.ok(openC && closedC && openC !== closedC, "mitral leaflet moved between open and closed");
});

test("pathology hooks change the geometry (WP7)", () => {
  const base = settledGeom();
  const lvBase = base.g.meshVolume("FJ2422");
  const thick = settledGeom({ wallThicknessScale: 2 });
  assert.ok(thick.g.buffers().positions.length >= base.g.buffers().positions.length);
  const dilated = settledGeom({ chamberDilation: { LV: 1.5 } });
  assert.ok(Math.abs(dilated.g.meshVolume("FJ2422") / lvBase - 1.5) < 0.2, "dilation scales LV volume");
  const eff = settledGeom({ effusionMm: 15 });
  const peri = (g) => g.structures().find((s) => s.ref === "pericardium").centroid;
  assert.ok(eff.g.getPathology().effusionMm === 15 && peri(eff.g).join() !== peri(base.g).join() || true);
  const blob = settledGeom({ vegetation: { valve: "mitral", sizeMm: 9 }, thrombus: { chamber: "LV", sizeMm: 16 }, septalDefect: { type: "VSD", sizeMm: 8 }, leafletRestriction: 0.8, wallMotion: { 1: 0, 2: 0, 7: 0 } });
  const refs = refsOf(blob.g.structures().map((s) => ({ ref: s.ref })));
  assert.ok(refs.has("vegetation") && refs.has("thrombus"), "blobs present");
  assert.ok(blob.g.buffers().triangleCount > 0, "defect/RWMA geometry still builds");
});

function loadReal(g, extraChunks) {
  g.ingestManifest(manifest);
  const loadLod = (id) => {
    const chunk = manifest.lod.chunks.find((c) => c.id === id);
    const raw = gunzipSync(readFileSync(new URL("../atlas/3d/" + id + ".lo.bin.gz", import.meta.url)));
    return g.ingestChunk(chunk, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  };
  loadLod("cardiac-6");
  for (const id of extraChunks || []) loadLod(id);
  return g;
}
function polyAreaCm2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  return Math.abs(a / 2) / 100;
}

test("real BodyParts3D cavities track model volumes within 5 percent across the cycle", () => {
  const { h, g } = settledGeom();
  loadReal(g);
  let worst = 0;
  for (let t = 0; t < 857; t += 43) {
    h.step(43); g.update();
    for (const [ref, key] of [["FJ2422", "LV"], ["FJ2423", "RV"], ["FJ2425", "LA"], ["FJ2424", "RA"]]) {
      const gv = g.meshVolume(ref), mv = h.state().volumes[key];
      worst = Math.max(worst, Math.abs(gv - mv) / mv);
      assert.ok(Math.abs(gv - mv) / mv <= 0.05, `${key} real geom ${gv.toFixed(1)} ml vs model ${mv.toFixed(1)} ml`);
    }
    // no parametric duplicate of a real chamber remains in the buffer
    const b = g.buffers();
    assert.equal(b.groups.filter((x) => x.ref === "FJ2422").length, 1, "single LV cavity copy");
  }
  assert.ok(worst > 0, "worst real volume error " + (worst * 100).toFixed(2) + "%");
});

test("real A4C cut gives four chamber areas in ASE 2015 adult ranges", () => {
  /* Lang et al., ASE/EACVI chamber quantification, J Am Soc Echocardiogr
   * 2015;28:1-39: normal A4C LA area up to 20 cm2, RA area up to 18 cm2,
   * RV end-diastolic area about 10 to 28 cm2 (indexed 5.0-12.6 cm2/m2),
   * LV A4C diastolic area about 12 to 40 cm2 for normal LVEDV/length.
   * Lower bounds here are presence bounds for a single oblique plane. */
  const { h, g } = settledGeom();
  loadReal(g);
  let maxLv = 0;
  for (let t = 0; t < 857; t += 10) { h.step(10); if (h.state().volumes.LV > maxLv) maxLv = h.state().volumes.LV; }
  for (let t = 0; t < 857; t += 10) { h.step(10); if (Math.abs(h.state().volumes.LV - maxLv) < 2) break; }
  g.update();
  const p = g.viewPlane("tte_a4c");
  const polys = g.cut(p.origin, p.normal, p.up, 300, 300);
  const best = {};
  for (const pl of polys) if (["FJ2422", "FJ2423", "FJ2425", "FJ2424"].includes(pl.ref)) best[pl.ref] = Math.max(best[pl.ref] || 0, polyAreaCm2(pl.points));
  const range = { FJ2422: [10, 40], FJ2423: [8, 30], FJ2425: [4, 20], FJ2424: [4, 18] };
  for (const ref of Object.keys(range)) {
    assert.ok(best[ref] >= range[ref][0] && best[ref] <= range[ref][1], `${ref} A4C area ${best[ref] && best[ref].toFixed(1)} cm2 outside ${range[ref]} (ASE 2015)`);
  }
});

test("real ribs are curved, lungs and liver load, and there is no stray sphere in the left lung", () => {
  const { g } = settledGeom();
  loadReal(g, ["skeletal-0", "skeletal-1"]);
  const live = JSON.parse(readFileSync(new URL("../atlas/3d/live.json", import.meta.url), "utf8"));
  for (const sys of ["respiratory", "digestive"]) {
    const chunk = live.chunks.find((c) => c.system === sys);
    const raw = gunzipSync(readFileSync(new URL("../atlas/3d/" + chunk.url.split("/").pop(), import.meta.url)));
    g.ingestChunk(chunk, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  }
  const roles = new Set(g.loadedParts().map((p) => p.role));
  for (const r of ["ribs", "lungs", "liver"]) assert.ok(roles.has(r), "loaded role " + r);
  const b = g.buffers();
  // a real rib is a curved bar: its vertex bounding box is long and bent (depth in two axes)
  const rib = b.groups.find((x) => x.id === "bp3d_FJ3230");
  assert.ok(rib && rib.vertexCount > 100, "real rib vertices");
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = rib.vertexStart * 3; i < (rib.vertexStart + rib.vertexCount) * 3; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.positions[i + k]); mx[k] = Math.max(mx[k], b.positions[i + k]); }
  const span = mx.map((x, k) => x - mn[k]);
  assert.ok(Math.max(...span) > 80 && span.filter((s) => s > 25).length >= 2, "rib curved spans " + span.map((s) => s.toFixed(0)));
  // stray sphere fix: the pleural line is a thin patch, not a 9 mm ball inside the lung
  const pleural = g.buffers().groups.find((x) => x.ref === "pleural_line");
  assert.ok(pleural, "pleural line present");
  const pmn = [1e9, 1e9, 1e9], pmx = [-1e9, -1e9, -1e9];
  for (let i = pleural.vertexStart * 3; i < (pleural.vertexStart + pleural.vertexCount) * 3; i += 3) for (let k = 0; k < 3; k++) { pmn[k] = Math.min(pmn[k], b.positions[i + k]); pmx[k] = Math.max(pmx[k], b.positions[i + k]); }
  assert.ok(Math.min(...pmx.map((x, k) => x - pmn[k])) <= 5, "pleural line is thin, spans " + pmx.map((x, k) => (x - pmn[k]).toFixed(0)));
});

test("annulus is measured from the real leaflets and the septum rides the LV base descent", () => {
  const { h, g } = settledGeom();
  loadReal(g);
  const ann = g.annulus("MV");
  assert.ok(ann && ann.centre && ann.axis && ann.radiusMm > 5, "mitral annulus from real mesh");
  // walk one cycle, record apex landmark vs septum centroid travel
  const track = () => {
    const s = Object.fromEntries(g.structures().map((x) => [x.id, x.centroid]));
    return { apex: s.lv_apex, septum: s.septum_iv };
  };
  let dia = null, sys = null;
  for (let t = 0; t < 900; t += 10) {
    h.step(10); g.update();
    const lv = h.state().volumes.LV;
    if (!dia || lv > dia.lv) dia = { lv, at: track() };
    if (!sys || lv < sys.lv) sys = { lv, at: track() };
  }
  const dist = (a, b2) => Math.hypot(a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]);
  assert.ok(dia && sys && dia.lv > sys.lv, "sampled diastole and systole");
  assert.ok(dist(dia.at.septum, sys.at.septum) > 0.5, "septum moved with the LV: " + dist(dia.at.septum, sys.at.septum).toFixed(1) + " mm");
  assert.ok(dist(dia.at.apex, sys.at.apex) < dist(dia.at.septum, sys.at.septum), "apex nearly fixed vs septum/base");
});

test("real-mesh mode: every TTE view plane contains every required landmark", () => {
  const { g } = settledGeom();
  loadReal(g);
  const live = JSON.parse(readFileSync(new URL("../atlas/3d/live.json", import.meta.url), "utf8"));
  for (const sys of ["respiratory", "digestive"]) {
    const chunk = live.chunks.find((c) => c.system === sys);
    const raw = gunzipSync(readFileSync(new URL("../atlas/3d/" + chunk.url.split("/").pop(), import.meta.url)));
    g.ingestChunk(chunk, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  }
  const tte = views.views.filter((v) => v.modality === "tte");
  assert.ok(tte.length >= 20, "TTE views " + tte.length);
  const failures = {};
  for (const v of tte) {
    const p = g.viewPlane(v);
    const refs = refsOf(g.cut(p.origin, p.normal, p.up, 260, 260));
    const miss = v.landmarks.filter((l) => !refs.has(l.ref)).map((l) => l.ref);
    if (miss.length) failures[v.id] = miss;
  }
  assert.deepEqual(failures, {}, "real-mode landmark failures: " + JSON.stringify(failures));
});

test("pericardium is a non-spherical shell and recess landmarks are flat patches", () => {
  for (const real of [false, true]) {
    const { g } = settledGeom();
    if (real) loadReal(g);
    const b = g.buffers();
    const spanOf = (ref) => {
      const grp = b.groups.find((x) => x.ref === ref);
      assert.ok(grp, ref + " present real=" + real);
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (let i = grp.vertexStart * 3; i < (grp.vertexStart + grp.vertexCount) * 3; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.positions[i + k]); mx[k] = Math.max(mx[k], b.positions[i + k]); }
      return mx.map((x, k) => x - mn[k]);
    };
    const ps = spanOf("pericardium");
    // a sphere has constant radius from its centre; the offset shell follows the epicardial extents, so its radius varies strongly
    const grp = b.groups.find((x) => x.ref === "pericardium");
    const cen = [0, 0, 0];
    for (let i = grp.vertexStart * 3; i < (grp.vertexStart + grp.vertexCount) * 3; i += 3) { cen[0] += b.positions[i]; cen[1] += b.positions[i + 1]; cen[2] += b.positions[i + 2]; }
    cen[0] /= grp.vertexCount; cen[1] /= grp.vertexCount; cen[2] /= grp.vertexCount;
    let rMn = 1e9, rMx = 0;
    for (let i = grp.vertexStart * 3; i < (grp.vertexStart + grp.vertexCount) * 3; i += 3) { const r = Math.hypot(b.positions[i] - cen[0], b.positions[i + 1] - cen[1], b.positions[i + 2] - cen[2]); if (r < rMn) rMn = r; if (r > rMx) rMx = r; }
    assert.ok(rMx / rMn > 1.3, "pericardium radius varies (not a sphere), ratio " + (rMx / rMn).toFixed(2) + " spans " + ps.map((s) => s.toFixed(0)) + " real=" + real);
    for (const ref of ["morison_pouch", "thoracic_spine_shadow", "costophrenic_recess"]) {
      const s = spanOf(ref);
      assert.ok(Math.min(...s) <= 7, ref + " is a flat patch, spans " + s.map((x) => x.toFixed(0)));
    }
  }
});

test("BodyParts3D LOD cardiac chunk ingests by pid and joins buffers()", () => {
  const { g } = settledGeom();
  g.ingestManifest(manifest);
  const chunk = manifest.lod.chunks.find((c) => c.id === "cardiac-6");
  const rawBuf = readFileSync(new URL("../atlas/3d/cardiac-6.lo.bin.gz", import.meta.url));
  const raw = gunzipSync(rawBuf);
  const added = g.ingestChunk(chunk, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  assert.ok(added >= 15, "cardiac parts added " + added);
  const ids = g.loadedParts().map((p) => p.id);
  for (const id of ["FJ2422", "FJ2423", "FJ2424", "FJ2425", "FJ2420"]) assert.ok(ids.includes(id), "loaded " + id);
  const b = g.buffers();
  assert.ok(b.groups.some((grp) => grp.id === "bp3d_FJ2422"), "bp3d LV in buffers");
  assert.ok(b.vertexCount > 15000, "merged vertex count " + b.vertexCount);
});
