import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const P = require("../kardia-scanlab.js")._pure;
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

test("mode: default Cine, only sim is Sim, British labels in source", () => {
  assert.equal(P.loadCineSimMode(mem()), "cine");
  assert.equal(P.normalizeCineSimMode("sim"), "sim");
  assert.equal(P.normalizeCineSimMode("SIM"), "cine");
  assert.equal(P.normalizeCineSimMode(null), "cine");
  const src = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  assert.ok(src.includes('data-cinesim="cine"') && src.includes('data-cinesim="sim"'));
  assert.ok(src.includes("Simulation loading"));
  assert.ok(!/[—–]/.test(src.match(/ksl-cinesim[^<]*/)?.[0] || ""));
});

test("persistence: remembered per device under one key", () => {
  const s = mem();
  assert.equal(P.saveCineSimMode(s, "sim"), "sim");
  assert.equal(s.getItem(P.CINE_SIM_KEY), "sim");
  assert.equal(P.loadCineSimMode(s), "sim");
  assert.equal(P.saveCineSimMode(s, "bogus"), "cine");
  assert.equal(P.loadCineSimMode({ getItem() { throw new Error("x"); } }), "cine");
});

test("lazy load: dedupes, retries after failure, ready when files present", async () => {
  let calls = 0, present = false;
  const loader = P.createSimLazyLoader({ hasSim: () => present, loadFiles: () => { calls++; return Promise.resolve(); } });
  assert.equal(await loader.ensure(), false);
  assert.equal(loader.state(), "error");
  present = true;
  const a = loader.ensure(), b = loader.ensure();
  assert.equal(await a, true); assert.equal(await b, true);
  assert.ok(calls >= 1 && calls <= 2, `calls=${calls}`);
  assert.equal(loader.state(), "ready");
});

test("sim pose and phase map the shared plane and ECG cycle", () => {
  const plane = { origin: [1, 2, 3], beam: [0, 1, 0], up: [0, -1, 0], normal: [1, 0, 0] };
  // Origin is the probe contact point, beam is minus the plane up vector, up is the plane normal.
  assert.deepEqual(P.simPoseFromPlane(plane, [4, 5, 6]), { origin: [4, 5, 6], beam: [0, 1, 0], up: [1, 0, 0] });
  // No contact: fall back to the plane origin.
  assert.deepEqual(P.simPoseFromPlane(plane), { origin: [1, 2, 3], beam: [0, 1, 0], up: [1, 0, 0] });
  // The plane beam field is ignored: beam always derives from minus the plane up.
  assert.deepEqual(P.simPoseFromPlane({ origin: [1, 2, 3], beam: [9, 9, 9], up: [0, 0, -1], normal: [0, 1, 0] }, [0, 0, 0]).beam, [0, 0, 1]);
  assert.equal(P.simPoseFromPlane(null), null);
  assert.equal(P.simPoseFromPlane(null, [1, 1, 1]), null);
  assert.equal(P.simPhaseFromHeart({ cycleTimeMs: 214, cycleMs: 857 }, 0), 214 / 857);
  assert.ok(P.simPhaseFromHeart(null, 857) === 0);
});

test("loadSimAtlas: resolves the prebuilt atlas, rejects on error", async () => {
  const fakeAtlas = { width: 8, height: 8, cols: 1 };
  let seenBase = null;
  const okApi = { loadAtlas: (base, cb) => { seenBase = base; cb(null, fakeAtlas); } };
  assert.equal(await P.loadSimAtlas(okApi, "/custom/base/"), fakeAtlas);
  assert.equal(seenBase, "/custom/base/");
  // Default base is the prebuilt on-device atlas.
  await P.loadSimAtlas(okApi);
  assert.equal(seenBase, P.SIM_ATLAS_BASE);
  assert.ok(P.SIM_ATLAS_BASE === "/kardia/media/k3-volume/");
  const errApi = { loadAtlas: (base, cb) => cb(new Error("manifest")) };
  await assert.rejects(() => P.loadSimAtlas(errApi), /manifest/);
  const nullApi = { loadAtlas: (base, cb) => cb(null, null) };
  await assert.rejects(() => P.loadSimAtlas(nullApi), /atlas/);
  await assert.rejects(() => P.loadSimAtlas({}), /not available/);
  await assert.rejects(() => P.loadSimAtlas(null), /not available/);
});

test("wiring: ensureSim loads the prebuilt atlas, drawSim maps pose and knobs", () => {
  const src = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  assert.ok(src.includes('loadAtlas("/kardia/media/k3-volume/"') || src.includes("loadSimAtlas(G.KARDIA_SIM_VOLUME, SIM_ATLAS_BASE)"));
  assert.ok(!/buildVolumes\(\)/.test(src), "must not build volumes on the phone");
  assert.ok(!/packAtlas\(/.test(src), "must not pack an atlas on the phone");
  assert.ok(src.includes("simPoseFromScanlab(pose, plane, view, G.KARDIA_SIM_VOLUME, T)"));
  assert.ok(src.includes("gain: SIM_GAIN") && src.includes("dynamicRange: 55"));
  assert.ok(src.includes("SIM_ZOOM = 1.8") && src.includes("SIM_GAIN = 1.6"));
  assert.ok(src.includes("pose.depthCm * 10 / SIM_ZOOM"));
  assert.ok(src.includes("simCanvas.width = sw") && src.includes("simCanvas.height = sh"));
});

test("registration: loader SIM_JS lazy, build-www ships sim files", () => {
  const loader = fs.readFileSync(new URL("../kardia-loader.js", import.meta.url), "utf8");
  for (const f of P.SIM_FILES) assert.ok(loader.includes(f), f);
  assert.ok(/loadSim/.test(loader));
  const jsList = loader.match(/var JS = \[([^\]]+)\]/)[1];
  for (const f of P.SIM_FILES) assert.ok(!jsList.includes(f), `${f} must not load at boot`);
  const build = fs.readFileSync(new URL("../scripts/build-www.sh", import.meta.url), "utf8");
  for (const f of P.SIM_FILES) assert.ok(build.includes(f), f);
  assert.ok(build.includes("k3-volume"));
  const css = fs.readFileSync(new URL("../kardia-scanlab.css", import.meta.url), "utf8");
  assert.ok(/\.ksl-cinesim button\{[^}]*min-height:44px/.test(css));
  assert.ok(/\.ksl-cinesim button\[aria-checked="true"\]/.test(css));
});
