/* Scan Lab smoke test: runs the real kardia-scanlab.js module in Node
 * with a fake DOM, a fake WebGL context and a fake three.js surface,
 * while fetch serves the real files from kardia/media/k2-assets. Asserts the
 * round 2 contract: manifest loaded, every part verified and parsed,
 * meshes registered, first frame drew, loading cleared, debugPose
 * reaches the target and requests the real clip, and the monitor ran
 * KARDIA_US over a non-empty heart cut. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import zlib from "node:zlib";
const require = createRequire(import.meta.url);

/* ---------- fake WebGL context: every draw call is counted ---------- */
function fakeGL() {
  const gl = { drawCalls: 0, canvas: null };
  return new Proxy(gl, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === "string" && /^[A-Z0-9_]+$/.test(prop)) return 1;
      if (prop === "getParameter") return () => 8192;
      if (prop === "getShaderParameter" || prop === "getProgramParameter") return () => false;
      if (prop === "getExtension") return () => null;
      if (prop === "getError") return () => 0;
      if (prop === "drawElements" || prop === "drawArrays") return () => { t.drawCalls++; };
      return () => ({});
    },
    set(t, prop, v) { t[prop] = v; return true; }
  });
}
function fake2d() {
  const base = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 10 })
  };
  return new Proxy(base, {
    get(t, prop) { if (prop in t) return t[prop]; return () => {}; },
    set(t, prop, v) { t[prop] = v; return true; }
  });
}

/* ---------- minimal fake DOM (id and data attribute aware) ---------- */
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
  click() { this.dispatch("click", { target: this }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  requestFullscreen() { return Promise.resolve(); }
  getContext(kind) { if (kind === "2d") return this._2d; return this._gl; }
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
      const attrs = {};
      const are = /([a-zA-Z-]+)(?:="([^"]*)")?/g; let a;
      while ((a = are.exec(m[2]))) attrs[a[1]] = a[2] != null ? a[2] : true;
      if (m[1] === "svg" || m[1] === "path" || m[1] === "ellipse" || m[1] === "circle") continue;
      const el = new El(m[1], attrs, this);
      this.all.push(el);
      if (el.id) this.byId.set(el.id, el);
    }
  }
  _query(sel) {
    const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return [];
    return this.all.filter((el) => el.attrs[m[1]] != null && (m[2] == null || String(el.attrs[m[1]]) === m[2]));
  }
  getElementById(id) { return this.byId.get(id) || null; }
  createElement(tag) { const el = new El(tag, {}, this); this.all.push(el); return el; }
  querySelectorAll(sel) { return this._query(sel); }
}

/* ---------- fake three.js surface (uses the fake GL for draws) ------ */
function fakeTHREE(glRef) {
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new V3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
    normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.multiplyScalar(1 / l); }
    project() { return this; }
  }
  class Q {
    setFromUnitVectors() { return this; } setFromAxisAngle() { return this; } premultiply() { return this; }
  }
  class Obj {
    constructor() { this.children = []; this.position = new V3(); this.quaternion = new Q(); this.scale = new V3(1, 1, 1); this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.userData = {}; this.visible = true; }
    add(c) { this.children.push(c); return this; }
    getWorldPosition(v) { v.copy(this.position); return v; }
    traverse(fn) { fn(this); this.children.forEach((c) => c.traverse ? c.traverse(fn) : fn(c)); }
  }
  class Geom {
    constructor() { this.attributes = { position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, normal: { array: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) } }; this.index = null; }
    setAttribute(n, a) { this.attributes[n] = a; } setIndex(i) { this.index = i; } computeVertexNormals() {}
    toNonIndexed() { return this; } applyMatrix4() { return this; }
  }
  class Mat { constructor(o) { Object.assign(this, o || {}); this.color = { setHex(h) { this.hex = h; } }; } }
  class M4 { makeTranslation() { return this; } makeRotationY() { return this; } makeRotationFromEuler() { return this; } setPosition() { return this; } }
  const T = {
    Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
    Vector3: V3, Quaternion: Q, Group: Obj, Scene: Obj, Object3D: Obj,
    Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } },
    Sprite: class extends Obj { constructor(m) { super(); this.material = m; } },
    BufferGeometry: Geom,
    BufferAttribute: class { constructor(arr, n) { this.array = arr; this.itemSize = n; } },
    CanvasTexture: class { constructor(c) { this.canvas = c; } },
    CatmullRomCurve3: class { constructor(p) { this.points = p; } },
    Color: class { constructor(h) { this.hex = h; const n = typeof h === "number" ? h : 0xffffff; this.r = ((n >> 16) & 255) / 255; this.g = ((n >> 8) & 255) / 255; this.b = (n & 255) / 255; } },
    Matrix4: M4, Euler: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    PerspectiveCamera: class extends Obj { constructor() { super(); } lookAt() {} },
    AmbientLight: class extends Obj {}, DirectionalLight: class extends Obj {},
    WebGLRenderer: class {
      constructor(o) { this.domElement = o.canvas; this.gl = o.canvas.getContext("webgl"); glRef.gl = this.gl; this.info = { render: { calls: 0 } }; this.shadowMap = {}; }
      setPixelRatio() {} setSize() {} render(scene) { let n = 0; scene.traverse((c) => { if (c.isMesh) { n++; this.gl.drawElements(); } }); this.info.render.calls = n; }
    }
  };
  ["LatheGeometry", "CylinderGeometry", "BoxGeometry", "TorusGeometry", "SphereGeometry", "TubeGeometry"].forEach((n) => { T[n] = Geom; });
  ["MeshStandardMaterial", "MeshBasicMaterial", "MeshPhysicalMaterial", "SpriteMaterial"].forEach((n) => { T[n] = Mat; });
  T.DoubleSide = 2; T.sRGBEncoding = 3007; T.ACESFilmicToneMapping = 4;
  return T;
}

test("Scan Lab smoke: body loads, probe at target, monitor cuts, clip plays", async () => {
  const doc = new FakeDoc();
  const root = new El("div", { id: "root" }, doc);
  doc.byId.set("root", root); doc.all.push(root);
  const glRef = {};
  const THREE = fakeTHREE(glRef);
  const fetchCalls = [];
  const fetchImpl = (url) => {
    fetchCalls.push(String(url));
    const u = String(url);
    const k2 = u.match(/k2-assets\/([^/?]+)$/);
    const file = k2 ? new URL("../kardia/media/k2-assets/" + k2[1], import.meta.url) : u.includes("views.json") ? new URL("../kardia/views.json", import.meta.url) : null;
    if (!file) return Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error("404"); }, arrayBuffer: async () => new ArrayBuffer(0) });
    const buf = fs.readFileSync(file);
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    });
  };
  /* real sim modules for the monitor */
  global.window = { document: doc, THREE, fetch: fetchImpl, localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } }, navigator: {}, devicePixelRatio: 1 };
  const T = require("../kardia-scan-targets.js");
  const GEOM = require("../kardia-sim-geom.js");
  const HEART = require("../kardia-sim-heart.js");
  require("../kardia-sim-us.js");
  require("../kardia-sim-probe.js");
  const views = JSON.parse(fs.readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
  const heart = HEART.create(HEART.presets.normal);
  for (let tt = 0; tt < 4000; tt += 10) heart.step(10);
  const geom = GEOM.create({ heart, views });
  geom.update(heart.state());
  const clipQueries = [];
  const fakeClips = {
    preloadFor: (q) => { clipQueries.push(q); return Promise.resolve({ clip: { title: "PLAXnormal", attribution: "Test Author, CC BY-SA 3.0", view: q.view }, src: "blob:fake-clip", cached: true }); },
    chooseClip: () => null,
    _pure: { attributionLine: (c) => c.attribution }
  };
  let rafCb = null;
  const SL = require("../kardia-scanlab.js");
  const inst = SL.create({
    doc, root, targets: T, THREE, fetch: fetchImpl, geom, heart, views,
    clips: fakeClips, noViewsFetch: true,
    decompress: (buf) => { const out = zlib.gunzipSync(Buffer.from(buf)); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength); },
    raf: (fn) => { rafCb = fn; return 1; }, cancelRaf: () => {}
  });
  assert.ok(inst, "instance created");
  const pump = async (t) => { const cb = rafCb; rafCb = null; if (cb) cb(t); await new Promise((r) => setImmediate(r)); };
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) await pump(t0 + i * 100);
  const dbg = inst.getDebug();
  assert.ok(dbg.manifestUrl.includes("/kardia/media/k2-assets/manifest.json"), "manifest loaded from the bundled path: " + dbg.manifestUrl);
  assert.ok(fetchCalls.some((u) => u.includes("k2-assets/manifest.json")), "manifest fetched");
  for (const name of ["skin", "heart", "liver", "bones", "vessels"]) assert.ok(dbg.meshesRegistered[name] > 0, name + " registered with vertices: " + dbg.meshesRegistered[name]);
  assert.ok(dbg.frames > 0, "frames rendered");
  assert.ok(dbg.drawCalls > 0, "renderer issued draw calls: " + dbg.drawCalls);
  assert.ok(glRef.gl && glRef.gl.drawCalls > 0, "fake WebGL context received draw calls: " + (glRef.gl && glRef.gl.drawCalls));
  assert.equal(doc.getElementById("kslLoading").hidden, true, "loading cleared, state " + dbg.loadingState + " errors " + dbg.errors.join("; "));
  assert.equal(dbg.loadingState, "ready");
  /* monitor: KARDIA_US ran over a non-empty heart cut */
  assert.ok(dbg.usCalls > 0, "KARDIA_US frame calls");
  assert.ok(dbg.usCutPolys > 0, "non-empty heart cut at the live plane: " + dbg.usCutPolys);
  /* target: real clip requested and shown in the sector */
  const hit = inst.debugPose("plax");
  assert.equal(hit.within, true, "debugPose reaches plax target");
  for (let i = 0; i < 4; i++) await pump(Date.now() + 700 + i * 250);
  assert.ok(clipQueries.some((q) => q.view === "tte_plax"), "real clip requested for tte_plax: " + JSON.stringify(clipQueries));
  assert.equal(dbg.clipRequestedFor, "tte_plax");
  const vid = doc.getElementById("kslReal");
  assert.equal(vid.hidden, false, "real clip video shown at target");
  assert.equal(vid.attrs.src, "blob:fake-clip", "clip src set from preload");
  assert.ok(doc.getElementById("kslAttribution").textContent.includes("Test Author"), "attribution shown");
  assert.equal(doc.getElementById("kslMonLabel").textContent, "Real patient clip");
  /* every view id switches view, title, picker and monitor (round 4) */
  for (const v of T.VIEWS) {
    const r = inst.debugPose(v.id);
    assert.ok(r && r.within, "debugPose within for " + v.id);
    assert.equal(inst.getDebug().view, v.id, "debug view for " + v.id);
    assert.equal(doc.getElementById("kslTargetName").textContent, v.label, "title for " + v.id);
    assert.equal(doc.getElementById("kslView-" + v.id).attrs["aria-pressed"], "true", "picker for " + v.id);
    assert.equal(inst.getDebug().clipRequestedFor, v.viewId, "monitor clip view for " + v.id);
    for (let i = 0; i < 2; i++) await pump(Date.now() + 900 + i * 120);
    assert.ok(inst.getDebug().usCalls > 0, "monitor cut ran for " + v.id);
  }
  const alias = inst.debugPose("sc4c");
  assert.ok(alias && alias.within, "debugPose sc4c alias reaches the target");
  assert.equal(inst.getDebug().view, "subcostal_4c", "sc4c alias switches the view");
  assert.equal(doc.getElementById("kslTargetName").textContent, "Subcostal 4C", "sc4c alias switches the title");
  assert.equal(doc.getElementById("kslView-subcostal_4c").attrs["aria-pressed"], "true", "sc4c alias switches the picker");
  assert.equal(inst.getDebug().clipRequestedFor, "tte_subcostal_4c", "sc4c alias switches the monitor");
  /* Tutorial open path: it is rendered on step 1 at create, Next and
   * Back move, a step chip jumps, Skip closes and remembers, and the
   * tutorial button reopens it on step 1 after the done flag is set. */
  const tut = () => doc.getElementById("kslTutorial");
  const tutStepIs = (n) => tut() && !tut().hidden && tut().innerHTML.includes("Step " + n + " of 7");
  assert.ok(tutStepIs(1), "tutorial opens on step 1 at create");
  doc.getElementById("kslTutNext").click();
  assert.ok(tutStepIs(2), "tutorial Next advances to step 2");
  const chips = doc._query("[data-tut]");
  chips[chips.length - 3].click(); /* last render's chip for step 5 (index 4 of 7) */
  assert.ok(tutStepIs(5), "tutorial step chip jumps to step 5");
  doc.getElementById("kslTutBack").click();
  assert.ok(tutStepIs(4), "tutorial Back returns to step 4");
  doc.getElementById("kslTutSkip").click();
  assert.equal(tut().hidden, true, "tutorial Skip closes it");
  assert.equal(global.window.localStorage.getItem("ksl_tutorial_done"), "1", "tutorial Skip remembers");
  doc.getElementById("kslTutorialBtn").click();
  assert.ok(tutStepIs(1), "tutorial button reopens on step 1 after Skip");
  assert.equal(global.window.localStorage.getItem("ksl_tutorial_done"), null, "tutorial button clears the remembered flag");
  /* Probe role: suspend stops the render loop, resume restarts it. */
  const framesBeforeSuspend = inst.getDebug().frames;
  inst.suspend();
  assert.equal(inst.isSuspended(), true, "Scan Lab suspends for the probe role");
  assert.equal(inst.getDebug().suspended, true, "debug reports Scan Lab suspended");
  await pump(Date.now() + 1200);
  assert.equal(inst.getDebug().frames, framesBeforeSuspend, "no frames render while suspended");
  inst.resume();
  assert.equal(inst.isSuspended(), false, "Scan Lab resumes after the probe role");
  await pump(Date.now() + 1400);
  assert.ok(inst.getDebug().frames > framesBeforeSuspend, "frames render again after resume");
  console.log("SCANLAB_EVIDENCE mergedStatic=" + inst.getDebug().mergedStatic + " drawCalls=" + inst.getDebug().drawCalls + " pixelRatio=" + inst.getDebug().pixelRatio + " fps=" + inst.getDebug().fps);
  assert.equal(inst.getDebug().mergedStatic, true, "static geometry merged on the merged path");
  assert.ok(inst.getDebug().drawCalls > 0 && inst.getDebug().drawCalls < 15, "merged draw calls under 15: " + inst.getDebug().drawCalls);
  assert.ok(inst.getDebug().pixelRatio <= 2, "pixel ratio capped at 2: " + inst.getDebug().pixelRatio);
  inst.stop();
});
