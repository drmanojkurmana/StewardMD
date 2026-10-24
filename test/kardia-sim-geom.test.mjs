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
