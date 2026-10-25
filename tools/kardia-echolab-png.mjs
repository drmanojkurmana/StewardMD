/* tools/kardia-echolab-png.mjs
 * Reproduce Echo Lab's A4C canvas in Node (CPU path, no browser):
 *   probe state from KARDIA_PROBE.stateForView('tte_a4c')
 *   -> KARDIA_PROBE.plane()
 *   -> KARDIA_ECHOLAB controller (its exact setProbe/setKnobs/frame code)
 *   -> KARDIA_US on a mock 2D canvas (WebGL unavailable in Node, so the
 *      renderer's own CPU fallback draws, masked to the sector).
 * Also renders the standalone path used by test/run-kardia-us-ui.mjs
 * (KARDIA_US directly with setProbe({ viewId }) and the views.json
 * target plane) at the same canvas size and Echo Lab knobs, so the two
 * PNGs can be compared pixel by pixel.
 *
 * Usage: node tools/kardia-echolab-png.mjs [outDir]
 * Writes:
 *   <outDir>/kardia-echolab-node.png       Echo Lab pipeline
 *   <outDir>/kardia-standalone-a4c-node.png standalone renderer
 * Prints sector metrics for each: non-black fraction outside the
 * sector polygon and the left/right edge angles of the non-black
 * region (fan axis deviation from vertical).
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "work", "shots");
mkdirSync(OUT, { recursive: true });

const HEART = require(join(ROOT, "kardia-sim-heart.js"));
const GEOM = require(join(ROOT, "kardia-sim-geom.js"));
const PROBE = require(join(ROOT, "kardia-sim-probe.js"));
const US = require(join(ROOT, "kardia-sim-us.js"));
const EL = require(join(ROOT, "kardia-echolab.js"));

const views = JSON.parse(readFileSync(join(ROOT, "kardia", "views.json"), "utf8"));
const W = 640, H = 480; /* the live sector canvas size Echo Lab uses */

function mockCanvas(w, h) {
  const c = {
    width: w, height: h, style: {}, _img: null, isConnected: true,
    addEventListener() {},
    getContext(kind) {
      if (kind !== "2d") return null; /* no WebGL in Node: US CPU path */
      return {
        createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData(img) { c._img = img; },
        fillStyle: "", beginPath() {}, arc() {}, fill() {},
      };
    },
  };
  return c;
}

function writePng(path, img, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]));
  return path;
}

/* Sector metrics from raw pixels, against the renderer's own layout:
 * apex (W/2, apexY), half-angle sectorDeg/2, radius depth*scale. */
function sectorMetrics(img, w, h, knobs) {
  const lay = US._pure.layoutFor(w, h, knobs);
  const half = (knobs.sectorDeg * Math.PI / 180) / 2;
  const radius = knobs.depth * lay.scale;
  let outside = 0, outsideLit = 0;
  const leftAngles = [], rightAngles = [];
  for (let y = 0; y < h; y++) {
    let mn = Infinity, mx = -Infinity;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const lit = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3 > 20;
      const dx = x - lay.apexX, dy = y - lay.apexY;
      const r = Math.hypot(dx, dy), ang = Math.atan2(dx, dy);
      const inside = dy >= 0 && r <= radius && Math.abs(ang) <= half;
      if (!inside) { outside++; if (lit) outsideLit++; }
      if (lit) { if (x < mn) mn = x; if (x > mx) mx = x; }
    }
    const dy = y - lay.apexY;
    if (mx >= 0 && dy > radius * 0.35 && dy < radius * 0.95) {
      if (mn < lay.apexX) leftAngles.push(Math.atan2(lay.apexX - mn, dy) * 180 / Math.PI);
      if (mx > lay.apexX) rightAngles.push(Math.atan2(mx - lay.apexX, dy) * 180 / Math.PI);
    }
  }
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const leftDeg = median(leftAngles), rightDeg = median(rightAngles);
  return {
    outsideNonBlackPct: outside ? 100 * outsideLit / outside : 0,
    leftEdgeDeg: leftDeg, rightEdgeDeg: rightDeg,
    axisDeviationDeg: Math.abs(rightDeg - leftDeg) / 2,
    apex: [lay.apexX, lay.apexY], radius,
  };
}

function settledWorld() {
  const heart = HEART.create(HEART.presets.normal);
  for (let t = 0; t < 12000; t += 10) heart.step(10);
  const geom = GEOM.create({ heart, views });
  return { heart, geom };
}

const knobs = EL._pure.mapKnobs(EL.DEFAULT_UI_KNOBS, 1);

/* ---- Echo Lab exact pipeline, through the real controller ---- */
let echoMetrics, echoPath, fallbackCalls = 0;
{
  const { heart, geom } = settledWorld();
  const probe = PROBE.create({ views, geom });
  probe.setState(probe.stateForView("tte_a4c"));
  const canvas = mockCanvas(W, H);
  let rafCb = null;
  const prevRAF = globalThis.requestAnimationFrame, prevCAF = globalThis.cancelAnimationFrame;
  const prevUS = globalThis.KARDIA_US, prevDoc = globalThis.document;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.KARDIA_US = US;
  const doc = { hidden: false, addEventListener() {}, removeEventListener() {} };
  try {
    const lab = EL.create({ doc, heart, geom, probe, knobs: EL._pure.cloneKnobs(null),
      fallbackDraw() { fallbackCalls++; } });
    lab.mount(canvas, null, null, {});
    if (rafCb) rafCb(1000); /* one live frame */
    console.log("echolab debug:", JSON.stringify(lab.debug()));
    lab.destroy();
    if (!canvas._img) throw new Error("Echo Lab frame produced no canvas pixels");
    echoPath = writePng(join(OUT, "kardia-echolab-node.png"), canvas._img, W, H);
    echoMetrics = sectorMetrics(canvas._img, W, H, knobs);
  } finally {
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRAF;
    if (prevCAF === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = prevCAF;
    if (prevUS === undefined) delete globalThis.KARDIA_US; else globalThis.KARDIA_US = prevUS;
  }
}

/* ---- Standalone renderer (run-kardia-us-ui.mjs path) ---- */
let standaloneMetrics, standalonePath;
{
  const { heart, geom } = settledWorld();
  const canvas = mockCanvas(W, H);
  const us = US.create(canvas, geom, heart);
  us.setProbe({ viewId: "tte_a4c" });
  us.setKnobs(knobs);
  us.frame(1000);
  us.destroy();
  if (!canvas._img) throw new Error("standalone frame produced no canvas pixels");
  standalonePath = writePng(join(OUT, "kardia-standalone-a4c-node.png"), canvas._img, W, H);
  standaloneMetrics = sectorMetrics(canvas._img, W, H, knobs);
}

console.log("echo-lab   :", echoPath, JSON.stringify(echoMetrics), "fallbackCalls=" + fallbackCalls);
console.log("standalone :", standalonePath, JSON.stringify(standaloneMetrics));
