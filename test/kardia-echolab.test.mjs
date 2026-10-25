import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const EL = require("../kardia-echolab.js");
const P = EL._pure;

test("mapKnobs: centre gain is 0 dB, TGC centre is 0 dB", () => {
  const k = P.mapKnobs({ gain: 55, depth: 160, focus: 50, tgc: [50,50,50,50,50,50,50,50], frequencyMHz: 3, sectorDeg: 80, dynamicRange: 55, colourGain: 70, colourNyquistMs: 0.6 }, 1);
  assert.equal(k.gain, 0); assert.equal(k.focusMm, 80); assert.deepEqual(k.tgc, [0,0,0,0,0,0,0,0]);
  const hi = P.mapKnobs({ gain: 100, depth: 160, focus: 50, tgc: [100,0,50,50,50,50,50,50] }, 1);
  assert.ok(hi.gain > 20); assert.equal(hi.tgc[0], 12); assert.equal(hi.tgc[1], -12);
});

test("backingSizeForCssBox scales both axes by the same DPR (aspect preserved)", () => {
  assert.deepEqual(P.backingSizeForCssBox(358, 268.5, 2), { width: 716, height: 537, scale: 2 });
  assert.deepEqual(P.backingSizeForCssBox(358, 269, 1), { width: 358, height: 269, scale: 1 });
  assert.deepEqual(P.backingSizeForCssBox(100, 50, 1.5), { width: 150, height: 75, scale: 1.5 });
  for (const [w, h, d] of [[390, 292, 2], [820, 615, 2], [333, 250, 3]]) {
    const s = P.backingSizeForCssBox(w, h, d);
    assert.ok(Math.abs(s.width / s.height - w / h) < 0.01, `aspect ${w}x${h}@${d} -> ${s.width}x${s.height}`);
    assert.equal(s.width, Math.round(w * d)); assert.equal(s.height, Math.round(h * d));
  }
  assert.equal(P.backingSizeForCssBox(0, 100, 2), null);
  assert.equal(P.backingSizeForCssBox(100, 0, 2), null);
});

test("fitCanvasToCssBox sets backing = CSS box x DPR uniformly and is a no-op when already sized", () => {
  const c = { width: 640, height: 480, clientWidth: 358, clientHeight: 269 };
  assert.deepEqual(P.fitCanvasToCssBox(c, 2), { width: 716, height: 538, scale: 2 });
  assert.equal(c.width, 716); assert.equal(c.height, 538);
  assert.deepEqual(P.fitCanvasToCssBox(c, 2), { width: 716, height: 538, scale: 2 });
  const hidden = { width: 640, height: 480, clientWidth: 0, clientHeight: 0 };
  assert.equal(P.fitCanvasToCssBox(hidden, 2), null);
  assert.equal(hidden.width, 640, "no CSS box: backing untouched");
});

test("pickResolutionScale steps down when frames are slow", () => {
  assert.equal(P.pickResolutionScale(2, 10), 2);
  assert.equal(P.pickResolutionScale(2, 40), 0.5);
  assert.equal(P.pickResolutionScale(1, 28), 0.75);
});

test("pathologyGeom converts words to factors and defects", () => {
  const g = P.pathologyGeom({ chamberDilation: { lv: "severe", la: "mild", rv: "normal", ra: "small" }, effusionMm: 12, wallThicknessScale: 1.3, wallMotion: { "1": "akinetic", "2": "normal" }, defect: { type: "asd", sizeMm: 20 }, leaflet: { aortic: { restriction: true, thickening: true } } });
  assert.equal(g.chamberDilation.LV, 1.6); assert.equal(g.chamberDilation.LA, 1.15); assert.equal(g.chamberDilation.RA, 0.8);
  assert.equal(g.wallMotion["1"], 0.05); assert.equal(g.septalDefect.type, "ASD"); assert.equal(g.septalDefect.sizeMm, 20);
  assert.ok(g.leafletRestriction > 0); assert.ok(g.leafletThickeningMm > 0);
  const unknown = P.pathologyGeom({ chamberDilation: { lv: "huge" } });
  assert.equal(unknown.chamberDilation.LV, 1);
});

test("soundKindFor maps conditions and gallops", () => {
  assert.equal(P.soundKindFor("aortic_stenosis", { murmur: {} }), "as_murmur");
  assert.equal(P.soundKindFor("mitral_regurgitation", null), "mr_murmur");
  assert.equal(P.soundKindFor("anything", { s3: "present" }), "s3_gallop");
  assert.equal(P.soundKindFor("unknown", null), "s1s2_normal");
});

test("cine ring buffer wraps without growing", () => {
  const c = P.createCine(3);
  c.push(1, 10); c.push(2, 20); c.push(3, 30); c.push(4, 40);
  assert.equal(c.count(), 3); assert.equal(c.at(0).timeMs, 4); assert.equal(c.at(2).timeMs, 2);
});

test("spectrumSource converts pixels both ways", () => {
  const s = P.spectrumSource({ velocityAxisMs: [-2, 2], timesMs: [0, 1000] }, 100, 100);
  assert.equal(s.velocityAt(50), 0); assert.equal(s.timeAt(50), 0.5);
  assert.equal(s.velocityToPx(0), 50);
});

test("renderer is recreated when the sector canvas is replaced, and debug() reports it", () => {
  const created = [];
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = { create(canvas) { const r = { canvas, stats: { mode: "cpu", frames: 0, ms: 16 }, errors: [], destroyed: false, setProbe() {}, setKnobs() {}, frame() { this.stats.frames++; return true; }, snapshot() { return { mean: 0.5 }; }, destroy() { this.destroyed = true; } }; created.push(r); return r; } };
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    const geom = { loadedParts: () => [] };
    const probe = { plane: () => ({ origin: [0, 0, 0], normal: [1, 0, 0], up: [0, 0, 1] }) };
    const lab = EL.create({ doc, heart, geom, probe, knobs: P.cloneKnobs(null) });
    const canvasA = { width: 64, height: 48 }, canvasB = { width: 64, height: 48 };
    lab.mount(canvasA, null, null, {});
    let d = lab.debug();
    assert.equal(d.rendererCreated, true); assert.equal(d.rendererOnCurrentCanvas, true);
    assert.equal(d.geometryMode, "parametric"); assert.equal(d.chunksLoaded, 0); assert.equal(d.lastError, "");
    lab.mount(canvasB, null, null, {});
    assert.equal(created.length, 2, "a new renderer is created for the replacement canvas");
    assert.equal(created[0].destroyed, true, "the renderer bound to the detached canvas is destroyed");
    assert.equal(created[1].canvas, canvasB);
    d = lab.debug(); assert.equal(d.rendererOnCurrentCanvas, true);
    assert.equal(lab.snapshot().mean, 0.5, "snapshot reads the renderer on the current canvas");
    lab.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("renderer is never created for a detached or zero-size sector canvas", () => {
  const created = [];
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = { create(canvas) { created.push(canvas); return { canvas, stats: { mode: "cpu", frames: 0, ms: 16 }, errors: [], setProbe() {}, setKnobs() {}, frame() { return true; }, snapshot() { return { mean: 0.5 }; }, destroy() {} }; } };
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    const lab = EL.create({ doc, heart, geom: { loadedParts: () => [] }, probe: { plane: () => ({ origin: [0, 0, 0], normal: [1, 0, 0], up: [0, 0, 1] }) }, knobs: P.cloneKnobs(null) });
    lab.mount({ width: 64, height: 48, isConnected: false }, null, null, {});
    assert.equal(created.length, 0, "no renderer for a detached canvas");
    assert.equal(lab.debug().sectorConnected, false);
    lab.mount({ width: 0, height: 48, isConnected: true }, null, null, {});
    assert.equal(created.length, 0, "no renderer for a zero-width canvas");
    const live = { width: 64, height: 48, isConnected: true };
    lab.mount(live, null, null, {});
    assert.equal(created.length, 1, "renderer created once the canvas is on screen");
    assert.equal(lab.debug().rendererOnCurrentCanvas, true);
    lab.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("canvas CSS box aspect is pinned and mount/resize sizing is wired", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../kardia-echolab.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../kardia-echolab.js", import.meta.url), "utf8");
  assert.ok(/#krdSector \{[^}]*aspect-ratio: 4 \/ 3/.test(css), "sector CSS box is 4:3 regardless of backing");
  assert.ok(src.includes("resizeCanvases(); observeResize();"), "mount sizes canvases from the CSS box and observes resize");
  assert.ok(src.includes("fitCanvasToCssBox"), "sizing goes through the uniform DPR fit");
  assert.ok(src.includes("diagnostics:"), "diagnostics bundle exposed for the browser runner");
});

test("host keeps persistent live canvases outside the repainted HTML and joins probe text with Marker", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../kardia.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../kardia-echolab.css", import.meta.url), "utf8");
  assert.ok(src.includes("liveCanvases"), "canvases are held outside the paint HTML");
  assert.ok(src.includes('id="krdSectorSlot"') && src.includes('id="krdSpectrumSlot"'), "paint emits slots, not canvases");
  assert.ok(!/<canvas id="krdSector"/.test(src), "the sector canvas is not recreated by innerHTML");
  assert.ok(src.includes("attachLiveCanvases()"), "mount re-attaches after every paint");
  assert.ok(src.includes('". Marker "'), 'probe text joins as "<position>. Marker <direction>."');
  assert.ok(/\.kel-overlay \{[^}]*pointer-events: none/.test(css), "overlay does not cover the sector for hit testing");
});

test("probeForPlane carries the view id as a filter-only tag, and diagnostics cut the rendered plane", () => {
  const pl = { origin: [10, 20, 30], normal: [1, 0, 0], up: [0, 0, -1] };
  const p = P.probeForPlane(pl, 160, "tte_a4c");
  assert.equal(p.viewId, "tte_a4c", "view id passed through for the renderer TTE filter");
  assert.deepEqual(p.viewOrigin, [10, 20, 30], "explicit plane still wins over the view id");
  assert.equal(P.probeForPlane(pl, 160).viewId, undefined, "no view id, no tag");
  /* diagnostics: geom.viewPlane re-solves a different (target) plane;
   * the bundle must cut the probe plane that was actually rendered. */
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = { create(canvas) { return { canvas, stats: { mode: "cpu", frames: 0, ms: 16 }, errors: [], setProbe() {}, setKnobs() {}, frame() { return true; }, snapshot() { return {}; }, destroy() {} }; } };
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    let cutArgs = null;
    const geom = { loadedParts: () => [],
      viewPlane: () => ({ origin: [999, 999, 999], normal: [0, 1, 0], up: [0, 0, 1] }),
      cut: (o, n, u, w, d) => { cutArgs = { o, n, u }; return []; } };
    const probe = { plane: () => ({ origin: [1, 2, 3], normal: [1, 0, 0], up: [0, 0, -1] }), getState: () => ({ window: "apical" }) };
    const lab = EL.create({ doc, heart, geom, probe, knobs: P.cloneKnobs(null), getView: () => ({ id: "tte_a4c" }) });
    lab.mount({ width: 64, height: 48 }, null, null, {});
    const dg = lab.diagnostics("tte_a4c");
    assert.deepEqual(dg.viewPlane.origin, [1, 2, 3], "viewPlane in the bundle is the rendered probe plane");
    assert.deepEqual(dg.targetViewPlane.origin, [999, 999, 999], "re-solved target kept only for comparison");
    assert.deepEqual(cutArgs.o, [1, 2, 3], "cut is taken at the rendered plane");
    assert.equal(dg.usProbe.viewId, "tte_a4c", "diagnostics probe carries the filter view id");
    lab.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("probeForPlane puts the apex up-ray from the plane origin like setProbe({viewId})", () => {
  const pl = { origin: [10, 20, 30], normal: [1, 0, 0], up: [0, 0, -1] };
  const p = P.probeForPlane(pl, 160);
  assert.deepEqual(p.viewOrigin, [10, 20, 30], "plane origin stays the cut origin");
  assert.deepEqual(p.up, [0, 0, -1], "display up is passed through, so the beam (-up) points down the fan");
  assert.deepEqual(p.normal, [1, 0, 0]);
  assert.ok(Math.abs(p.origin[0] - 10) < 1e-9 && Math.abs(p.origin[1] - 20) < 1e-9);
  assert.ok(Math.abs(p.origin[2] - (30 - 160 * 0.42)) < 1e-9,
    "apex sits depth*0.42 along +up from the plane origin, got " + p.origin);
});

test("fallbackDraw never paints over a live renderer, only when no renderer exists", () => {
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  let rafCb = null, fallbackCalls = 0, renderer = null;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    const probe = { plane: () => ({ origin: [0, 0, 0], normal: [1, 0, 0], up: [0, 0, -1] }) };
    globalThis.KARDIA_US = { create(canvas) {
      renderer = { canvas, stats: { mode: "webgl", frames: 0, ms: 16 }, errors: [], setProbe() {}, setKnobs() {}, frame() { return false; }, snapshot() { return {}; }, destroy() {} };
      return renderer;
    } };
    const lab = EL.create({ doc, heart, geom: { loadedParts: () => [] }, probe, knobs: P.cloneKnobs(null),
      fallbackDraw() { fallbackCalls++; } });
    lab.mount({ width: 64, height: 48 }, null, null, {});
    assert.ok(renderer, "renderer created");
    if (rafCb) rafCb(1000);
    assert.equal(fallbackCalls, 0, "a failed/lost live frame keeps the renderer as sole painter");
    lab.destroy();
    /* No KARDIA_US at all: the schematic fallback is the only painter. */
    delete globalThis.KARDIA_US;
    fallbackCalls = 0; rafCb = null;
    const lab2 = EL.create({ doc, heart, geom: { loadedParts: () => [] }, probe, knobs: P.cloneKnobs(null),
      fallbackDraw() { fallbackCalls++; } });
    lab2.mount({ width: 64, height: 48 }, null, null, {});
    if (rafCb) rafCb(1000);
    assert.ok(fallbackCalls > 0, "fallback paints when no renderer exists");
    lab2.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("render rate is capped at 30 fps and drops to 15 fps over 25 ms frames", () => {
  assert.equal(P.targetFps(16), 30); assert.equal(P.targetFps(25), 30);
  assert.equal(P.targetFps(26), 15); assert.equal(P.targetFps(80), 15);
  assert.ok(Math.abs(P.frameIntervalMs(16) - 1000 / 30) < 1e-9);
  assert.ok(Math.abs(P.frameIntervalMs(40) - 1000 / 15) < 1e-9);
});

test("frame loop renders at most 30 fps, applies onFrameStart first, suspend releases the renderer", () => {
  const prevUS = globalThis.KARDIA_US, prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  let rafCb = null, created = [];
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return created.length + 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = { create(canvas) { const r = { canvas, stats: { mode: "webgl", frames: 0, ms: 16 }, errors: [], lost: false, destroyed: false, setProbe() {}, setKnobs() {}, frame() { this.stats.frames++; return true; }, snapshot() { return {}; }, destroy() { this.destroyed = true; }, _loseContext() { this.lost = true; return true; } }; created.push(r); return r; } };
  try {
    const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const heart = { step() {}, state: () => ({ timeMs: 0, cycleTimeMs: 0, volumes: { LV: 100 } }) };
    const probe = { plane: () => ({ origin: [0, 0, 0], normal: [1, 0, 0], up: [0, 0, -1] }) };
    const order = [];
    const lab = EL.create({ doc, heart, geom: { loadedParts: () => [] }, probe, knobs: P.cloneKnobs(null),
      onFrameStart() { order.push("pose"); } });
    const origFrame = () => {};
    void origFrame;
    lab.mount({ width: 64, height: 48 }, null, null, {});
    assert.equal(created.length, 1);
    const r0 = created[0]; const baseFrame = r0.frame.bind(r0);
    r0.frame = (t) => { order.push("render"); return baseFrame(t); };
    for (const t of [1000, 1016, 1034, 1050, 1068]) { const cb = rafCb; rafCb = null; if (cb) cb(t); }
    assert.equal(r0.stats.frames, 3, "five rAF ticks at 16 ms spacing render three frames at 30 fps");
    assert.deepEqual(order.slice(0, 4), ["pose", "render", "pose", "render"], "newest pose applies at the start of each rendered frame");
    lab.suspend();
    assert.equal(r0.lost, true, "suspend releases the WebGL context");
    assert.equal(r0.destroyed, true, "suspend destroys the renderer");
    assert.equal(lab.debug().rendererCreated, false);
    assert.equal(lab.debug().suspended, true);
    assert.equal(lab.debug().running, false);
    lab.resume();
    const cb2 = rafCb; if (cb2) cb2(2000);
    assert.equal(created.length, 2, "resume recreates the renderer on the same canvas");
    lab.destroy();
  } finally {
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
  }
});

test("probe mode suspends Echo Lab and the runner prints both pages busy time", async () => {
  const { readFileSync } = await import("node:fs");
  const sp = readFileSync(new URL("../kardia-syncprobe.js", import.meta.url), "utf8");
  const host = readFileSync(new URL("../kardia.js", import.meta.url), "utf8");
  const runner = readFileSync(new URL("./run-kardia-ui.mjs", import.meta.url), "utf8");
  assert.ok(sp.includes("suspendProbeRender()") && sp.includes("resumeProbeRender()"), "SyncProbe suspends on probe entry and resumes on exit");
  assert.ok(host.includes("suspendLive") && host.includes("onFrameStart"), "host suspends the live loop and applies synced poses at frame start");
  assert.ok(runner.includes("BUSY loopback: main-thread busy page A"), "runner prints both pages main-thread busy time");
  assert.ok(runner.includes("e2eMs < 150"), "runner keeps the under 150 ms loopback assertion");
});

test("severity helpers read the pathology files shape", () => {
  const cond = { id: "x", severities: { severe: { heart: { aorticValveAreaCm2: 0.75 }, geom: { effusionMm: 3 }, sound: { s4: "present" } } } };
  assert.equal(P.severityHeart(cond, "severe").aorticValveAreaCm2, 0.75);
  assert.equal(P.severityGeom(cond, "severe").effusionMm, 3);
  assert.deepEqual(P.severityHeart(cond, "mild"), {});
});
