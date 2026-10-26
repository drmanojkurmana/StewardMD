/* test/kardia-k3-volume.test.mjs - K3 volume, B-mode shader and probe model. */
import { createRequire } from "node:module";
import { readFileSync, statSync, existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const V = require("../kardia-sim-volume.js");
const B = require("../kardia-sim-bmode-gl.js");
const P = require("../kardia-probe-model.js");
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  FAIL:", n); } };

const vol = V.buildVolumes();
ok("volume: dims and data length", vol.dims.every((d) => d >= 160) && vol.labels.length === vol.dims[0] * vol.dims[1] * vol.dims[2]);
ok("volume: smoothed fields present", ["echo", "spec", "atten", "blood"].every((k) => vol.fields[k] && vol.fields[k].length === vol.labels.length));
const counts = {}; vol.labels.forEach((l) => counts[l] = (counts[l] || 0) + 1);
ok("volume: all 8 tissue labels present", [1, 2, 3, 4, 5, 6, 7, 8].every((l) => counts[l] > 0));
ok("volume: blood is a minority, liver present", counts[1] > 1000 && counts[6] > 5000);
const atlas = V.packAtlas(vol);
ok("atlas: size matches grid", atlas.width === atlas.cols * vol.dims[0] && atlas.height === atlas.rows * vol.dims[1] && atlas.rgba.length === atlas.width * atlas.height * 4);
ok("contraction: systole peaks then relaxes", V.contraction(0.32) > 0.95 && V.contraction(0) === 0);
const d0 = V.deformPoint([5, 10, 0], 0), d1 = V.deformPoint([5, 10, 0], 0.32);
ok("deform: point moves between phases", Math.abs(d0[0] - d1[0]) + Math.abs(d0[1] - d1[1]) > 0.01);
ok("classify: LV centre is blood", V.classify([0, 8, -2]) === 1);
ok("classify: far outside is outside or fat", [0, 5].includes(V.classify([0, -40, 0])) || V.classify([0, 60, -60]) === 6);

// pose to plane maths
for (const id of Object.keys(V.VIEWS)) {
  const pl = V.poseToPlane(V.VIEWS[id]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  ok(`plane ${id}: orthonormal`, Math.abs(dot(pl.beam, pl.right)) < 1e-9 && Math.abs(dot(pl.beam, pl.up)) < 1e-9 && Math.abs(len(pl.beam) - 1) < 1e-9);
}
ok("plane: normal-form pose also works", !!V.poseToPlane({ origin: [0, 90, 40], normal: [0, -1, 0], up: [1, 0, 0] }));

// shader compile with a fake GL
function fakeGL() {
  const calls = [];
  return { calls, VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3,
    createShader(t) { return { t }; }, shaderSource() {}, compileShader(s) { calls.push(s.t); },
    getShaderParameter() { return true; }, getShaderInfoLog() { return ""; } };
}
const gl = fakeGL();
ok("shader: fake-GL compile of both stages", B._compileCheck(gl) === true && gl.calls.length === 2);
ok("shader: sources expose sector, speckle and TGC terms",
  /uTgc/.test(B.FRAG) && /hash\(/.test(B.FRAG) && /halfA/.test(B.FRAG) && /shadow/.test(B.FRAG));
ok("bmode: create without WebGL throws a clear error", (() => { try { B.create({ getContext: () => null }); return false; } catch (e) { return /WebGL/.test(e.message); } })());

// packed PNG assets
const man = JSON.parse(readFileSync(new URL("../kardia/media/k3-volume/manifest.json", import.meta.url), "utf8"));
ok("assets: manifest total under 3 MB", man.totalBytes < 3 * 1024 * 1024);
ok("assets: PNG files exist and are non-trivial", man.files.every((f) => existsSync(new URL(`../kardia/media/k3-volume/${f.name}`, import.meta.url)) && statSync(new URL(`../kardia/media/k3-volume/${f.name}`, import.meta.url)).size > 1000));

// probe model with a minimal fake THREE
class Vec2 { constructor(x, y) { this.x = x; this.y = y; } }
class Vec3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; } }
class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.isMesh = true; this.position = new Vec3(0, 0, 0); this.rotation = {}; this.scale = { set() {} }; } }
class Group { constructor() { this.children = []; } add(o) { this.children.push(o); } traverse(fn) { fn(this); this.children.forEach((c) => fn(c)); } }
const FakeTHREE = { Group, Mesh, Vector2: Vec2, Vector3: Vec3,
  LatheGeometry: class {}, CylinderGeometry: class {}, BoxGeometry: class {}, TorusGeometry: class {}, TubeGeometry: class {},
  CatmullRomCurve3: class { constructor(p) { this.points = p; } },
  MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } },
  Color: class {}, Scene: class {}, PerspectiveCamera: class {}, WebGLRenderer: class {}, HemisphereLight: class {}, DirectionalLight: class {} };
const probe = P.buildProbe(FakeTHREE);
const names = probe.children.map((c) => c.name);
ok("probe: has body, grip, lens, marker, relief and cable",
  ["probe-body", "probe-grip", "probe-lens", "probe-marker-ridge", "probe-strain-relief", "probe-cable"].every((n) => names.includes(n)));
console.log(`kardia-k3-volume: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
