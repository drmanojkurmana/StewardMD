import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const SL = require("../kardia-scanlab.js");
const P = SL._pure;

test("handle hit-test: only grip, marker, tail or ghost start a probe drag", () => {
  const probe = { x: 200, y: 300 }, ghost = { x: 320, y: 180 };
  assert.equal(P.hitTestHandle({ x: 200, y: 300 }, probe, ghost), "grip");
  assert.equal(P.hitTestHandle({ x: 230, y: 320 }, probe, ghost), "grip", "inside the 44px plus grip area");
  assert.equal(P.hitTestHandle({ x: 320, y: 180 }, probe, ghost), "ghost");
  assert.equal(P.hitTestHandle({ x: 200, y: 190 }, probe, ghost), "tail", "above the probe inside the tail reach");
  assert.equal(P.hitTestHandle({ x: 270, y: 300 }, probe, ghost), "marker", "on the marker ring beside the grip");
  assert.equal(P.hitTestHandle({ x: 200, y: 470 }, probe, ghost), null, "empty skin below scrolls");
  assert.equal(P.hitTestHandle({ x: 40, y: 40 }, probe, ghost), null, "far corner scrolls");
  assert.equal(P.hitTestHandle({ x: 200, y: 300 }, null, ghost), null, "no probe position, no drag");
  assert.equal(P.hitTestHandle(null, probe, ghost), null);
  assert.equal(P.hitTestHandle({ x: 260, y: 300 }, probe, null), "marker", "ghost is optional");
});

test("render scheduler renders only when dirty or the heart phase moves", () => {
  const s = P.createRenderScheduler({ maxFps: 30 });
  assert.equal(s.shouldRender(0, 0), true, "first frame is dirty");
  assert.equal(s.shouldRender(16, 0), false, "same phase, nothing invalidated");
  s.invalidate();
  assert.equal(s.shouldRender(20, 0), false, "dirty but inside the 30 fps cap");
  assert.equal(s.shouldRender(40, 0), true, "dirty and past the cap interval");
  assert.equal(s.shouldRender(80, 1), true, "heart phase moved");
  assert.equal(s.shouldRender(90, 1), false, "phase still, cap not reached");
  const st = s.stats();
  assert.equal(st.renders, 3); assert.ok(st.skipped >= 3);
});

test("render scheduler pauses when hidden or scrolled out of view", () => {
  const s = P.createRenderScheduler({ maxFps: 60 });
  assert.equal(s.shouldRender(0, 0), true);
  s.setVisible(false);
  s.invalidate();
  assert.equal(s.shouldRender(100, 1), false, "background app renders nothing");
  s.setVisible(true);
  assert.equal(s.shouldRender(100, 1), true, "visible again renders");
  s.setInView(false);
  s.invalidate();
  assert.equal(s.shouldRender(200, 2), false, "off screen renders nothing");
  s.setInView(true);
  assert.equal(s.shouldRender(200, 2), true, "back in view renders");
  assert.equal(s.isRunnable(), true);
});

test("slider mapping covers the full probe ranges and clamps", () => {
  assert.deepEqual(P.SLIDERS.map((s) => [s.id, s.min, s.max]), [
    ["rotation", -180, 180], ["fan", -30, 30], ["rock", -30, 30], ["depth", 8, 30]
  ]);
  assert.deepEqual(P.poseFromSlider("rotation", 190), { rotationDeg: 180 });
  assert.deepEqual(P.poseFromSlider("rotation", -190), { rotationDeg: -180 });
  assert.deepEqual(P.poseFromSlider("fan", 45), { fanDeg: 30 });
  assert.deepEqual(P.poseFromSlider("rock", -45), { rockDeg: -30 });
  assert.deepEqual(P.poseFromSlider("depth", 4), { depthCm: 8 });
  assert.deepEqual(P.poseFromSlider("depth", 40), { depthCm: 30 });
  assert.deepEqual(P.poseFromSlider("nope", 10), {});
  const pose = { rotationDeg: -171, fanDeg: -8, rockDeg: 19, depthCm: 18 };
  assert.equal(P.sliderValueFromPose("rotation", pose), -171);
  assert.equal(P.sliderValueFromPose("fan", pose), -8);
  assert.equal(P.sliderValueFromPose("rock", pose), 19);
  assert.equal(P.sliderValueFromPose("depth", pose), 18);
});

test("scroll contract: scene and monitor pan vertically, handles own their drag", () => {
  const css = fs.readFileSync(new URL("../kardia-scanlab.css", import.meta.url), "utf8");
  assert.match(css, /#kslScene\{[^}]*touch-action:pan-y/, "scene lets vertical touches scroll");
  assert.match(css, /#kslMonitor\{[^}]*touch-action:pan-y/, "monitor lets vertical touches scroll");
  assert.match(css, /\.ksl-handle\{[^}]*touch-action:none/, "probe handles own every axis of their drag");
  assert.match(css, /\.ksl-handle\{[^}]*pointer-events:auto/, "probe handles receive the press");
  assert.ok(!/#kslScene\{[^}]*touch-action:none/.test(css), "scene never traps scroll");
  const host = fs.readFileSync(new URL("../kardia.css", import.meta.url), "utf8");
  assert.match(host, /\.krd-chest \{[^}]*touch-action: pan-y/, "chest map scrolls from empty skin");
  assert.match(host, /\.krd-probe-dot \{[^}]*touch-action: none/, "probe dot owns its drag");
  assert.match(host, /\.krd-strip \{[^}]*touch-action: pan-y/, "rock strip keeps vertical scroll");
  assert.match(host, /\.krd-strip-v \{ touch-action: pan-x/, "tilt strip owns vertical drags, page keeps the rest");
  const js = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  assert.ok(js.includes("hitTestHandle") && js.includes('data-slider'), "hit test and sliders are wired");
  assert.ok(js.includes('"kslSlider-"') && js.includes("data-slider"), "slider inputs are built from the slider specs");
  for (const id of ["kslGhostHandle", "kslTailHandle", "kslMarkerHandle"]) assert.ok(js.includes(id), id);
  assert.ok(js.includes("IntersectionObserver") && js.includes("createRenderScheduler"), "rendering pauses off screen and on demand");
  assert.ok(js.includes("devicePixelRatio") || js.includes("setPixelRatio"), "pixel ratio path present");
});

/* Minimal fake DOM plus fake three, enough to mount Scan Lab and
 * drive its real pointer and slider handlers. */
function fakeGL() {
  const gl = { drawCalls: 0, canvas: null };
  return new Proxy(gl, { get(t, prop) { if (prop in t) return t[prop]; if (typeof prop === "string" && /^[A-Z0-9_]+$/.test(prop)) return 1; if (prop === "getParameter") return () => 8192; if (prop === "getExtension") return () => null; if (prop === "getError") return () => 0; return () => ({}); }, set(t, prop, v) { t[prop] = v; return true; } });
}
function fake2d() {
  const base = { measureText: () => ({ width: 10 }) };
  return new Proxy(base, { get(t, prop) { if (prop in t) return t[prop]; return () => {}; }, set(t, prop, v) { t[prop] = v; return true; } });
}
class El {
  constructor(tag, attrs, doc) {
    this.tagName = String(tag).toUpperCase(); this.ownerDocument = doc; this.attrs = attrs || {};
    this.id = this.attrs.id || ""; this.children = []; this.style = {}; this.hidden = !!this.attrs.hidden;
    this.disabled = false; this._text = ""; this._html = ""; this.listeners = {};
    this.width = parseInt(this.attrs.width || "300", 10); this.height = parseInt(this.attrs.height || "150", 10);
    this.clientWidth = this.width; this.clientHeight = this.height; this.value = this.attrs.value || "";
    if (this.tagName === "CANVAS") { this._gl = fakeGL(); this._2d = fake2d(); }
    if (this.tagName === "VIDEO") { this.play = () => Promise.resolve(); this.pause = () => {}; }
  }
  getAttribute(n) { return this.attrs[n] != null ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); if (n === "id") this.id = String(v); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t, ev) { (this.listeners[t] || []).forEach((fn) => fn.call(this, ev || { target: this })); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  getContext(kind) { return kind === "2d" ? this._2d : this._gl; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); this.ownerDocument._parse(this._html); }
  get innerHTML() { return this._html; }
  querySelectorAll(sel) { return this.ownerDocument._query(sel); }
}
class FakeDoc {
  constructor() { this.byId = new Map(); this.all = []; this.head = new El("head", {}, this); }
  _parse(html) {
    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g; let m;
    while ((m = re.exec(html))) {
      const attrs = {}; const are = /([a-zA-Z-]+)(?:="([^"]*)")?/g; let a;
      while ((a = are.exec(m[2]))) attrs[a[1]] = a[2] != null ? a[2] : true;
      if (["svg", "path", "ellipse", "circle"].includes(m[1])) continue;
      const el = new El(m[1], attrs, this); this.all.push(el); if (el.id) this.byId.set(el.id, el);
    }
  }
  _query(sel) { const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return []; return this.all.filter((el) => el.attrs[m[1]] != null && (m[2] == null || String(el.attrs[m[1]]) === m[2])); }
  getElementById(id) { return this.byId.get(id) || null; }
  createElement(tag) { const el = new El(tag, {}, this); this.all.push(el); return el; }
  querySelectorAll(sel) { return this._query(sel); }
}
function fakeTHREE() {
  class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } clone() { return new V3(this.x, this.y, this.z); } add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; } multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; } crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; } normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.multiplyScalar(1 / l); } project() { return this; } }
  class Q { setFromUnitVectors() { return this; } setFromAxisAngle() { return this; } premultiply() { return this; } }
  class Obj { constructor() { this.children = []; this.position = new V3(); this.quaternion = new Q(); this.scale = new V3(1, 1, 1); this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.userData = {}; this.visible = true; } add(c) { this.children.push(c); return this; } getWorldPosition(v) { v.copy(this.position); return v; } traverse(fn) { fn(this); this.children.forEach((c) => c.traverse ? c.traverse(fn) : fn(c)); } }
  class Geom { constructor() { this.attributes = { position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, normal: { array: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) } }; this.index = null; } setAttribute(n, a) { this.attributes[n] = a; } setIndex(i) { this.index = i; } computeVertexNormals() {} toNonIndexed() { return this; } applyMatrix4() { return this; } }
  class Mat { constructor(o) { Object.assign(this, o || {}); this.color = { setHex(h) { this.hex = h; } }; } }
  class M4 { makeTranslation() { return this; } makeRotationY() { return this; } makeRotationFromEuler() { return this; } makeRotationX() { return this; } setPosition() { return this; } }
  const T = { Vector3: V3, Quaternion: Q, Group: Obj, Scene: Obj, Object3D: Obj, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }, Sprite: class extends Obj { constructor(m) { super(); this.material = m; } }, BufferGeometry: Geom, BufferAttribute: class { constructor(arr, n) { this.array = arr; this.itemSize = n; } }, CanvasTexture: class { constructor(c) { this.canvas = c; } }, CatmullRomCurve3: class { constructor(p) { this.points = p; } }, Color: class { constructor(h) { this.hex = h; const n = typeof h === "number" ? h : 0xffffff; this.r = ((n >> 16) & 255) / 255; this.g = ((n >> 8) & 255) / 255; this.b = (n & 255) / 255; } }, Matrix4: M4, Euler: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }, PerspectiveCamera: class extends Obj { lookAt() {} }, AmbientLight: class extends Obj {}, DirectionalLight: class extends Obj {}, HemisphereLight: class extends Obj {}, WebGLRenderer: class { constructor(o) { this.domElement = o.canvas; this.info = { render: { calls: 0 } }; this.shadowMap = {}; } setPixelRatio() {} setSize() {} render() { this.info.render.calls = 1; } } };
  ["LatheGeometry", "CylinderGeometry", "BoxGeometry", "TorusGeometry", "SphereGeometry", "TubeGeometry"].forEach((n) => { T[n] = Geom; });
  ["MeshStandardMaterial", "MeshBasicMaterial", "MeshPhysicalMaterial", "SpriteMaterial"].forEach((n) => { T[n] = Mat; });
  T.DoubleSide = 2; T.sRGBEncoding = 3007; T.ACESFilmicToneMapping = 4;
  return T;
}

test("sliders and handle drags move the real probe pose; empty scene does not", async () => {
  const doc = new FakeDoc();
  const root = new El("div", { id: "root" }, doc);
  doc.byId.set("root", root); doc.all.push(root);
  global.window = { document: doc, localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } }, navigator: {}, devicePixelRatio: 1 };
  const T = require("../kardia-scan-targets.js");
  const fetch404 = () => Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error("404"); }, arrayBuffer: async () => new ArrayBuffer(0) });
  const inst = SL.create({ doc, root, targets: T, THREE: fakeTHREE(), fetch: fetch404, noViewsFetch: true, raf: () => 1, cancelRaf: () => {} });
  assert.ok(inst);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const rot = doc.getElementById("kslSlider-rotation"), fan = doc.getElementById("kslSlider-fan"), depth = doc.getElementById("kslSlider-depth");
  assert.ok(rot && fan && depth, "probe sliders render under the monitor");
  assert.equal(rot.attrs.min, "-180"); assert.equal(rot.attrs.max, "180");
  assert.equal(depth.attrs.min, "8"); assert.equal(depth.attrs.max, "30");
  rot.value = "45"; rot.dispatch("input", { target: rot });
  assert.equal(inst.getState().pose.rotationDeg, 45, "rotation slider turns the probe");
  fan.value = "99"; fan.dispatch("input", { target: fan });
  assert.equal(inst.getState().pose.fanDeg, 30, "fan slider clamps at 30 degrees");
  depth.value = "22"; depth.dispatch("input", { target: depth });
  assert.equal(inst.getState().pose.depthCm, 22, "depth slider sets depth");
  /* Grip handle drag slides the contact point in two dimensions. */
  const before = inst.getState().pose.contact.slice();
  const grip = doc.getElementById("kslHandle");
  assert.ok(grip, "grip handle renders");
  grip.dispatch("pointerdown", { pointerId: 7, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} });
  grip.dispatch("pointermove", { pointerId: 7, clientX: 140, clientY: 60 });
  grip.dispatch("pointerup", { pointerId: 7 });
  const after = inst.getState().pose.contact;
  assert.ok(after[0] > before[0] && after[2] > before[2], "grip drag slides in x and z: " + before + " to " + after);
  /* A touch on empty scene takes no drag: the page scrolls instead. */
  const scene = doc.getElementById("kslScene");
  const poseBeforeScroll = JSON.stringify(inst.getState().pose);
  scene.dispatch("pointerdown", { pointerId: 9, pointerType: "touch", clientX: 700, clientY: 590 });
  scene.dispatch("pointermove", { pointerId: 9, pointerType: "touch", clientX: 700, clientY: 500 });
  assert.equal(inst.getDebug().lastDragMode, "scroll", "empty skin touch is left to scroll");
  assert.equal(JSON.stringify(inst.getState().pose), poseBeforeScroll, "scrolling touch never moves the probe");
  inst.stop();
});
