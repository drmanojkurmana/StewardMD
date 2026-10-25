/* test/kardia-realcine.test.mjs - real patient cine in Echo Lab:
 * clip choice (view, pathology and severity fallback) in
 * kardia-clips.js and the at-target state machine (dwell plus
 * hysteresis) and sector mask in kardia-echolab.js. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const CLIPS = require("../kardia-clips.js");
const EL = require("../kardia-echolab.js");
const credits = JSON.parse(readFileSync(new URL("../kardia/media/credits.json", import.meta.url), "utf8"));

test("chooseClip: view only, pathology fallback, and no match", () => {
  const a4c = CLIPS.chooseClip(credits.clips, { view: "tte_a4c" });
  assert.ok(a4c && a4c.view === "tte_a4c");
  assert.equal(CLIPS.isVideo(a4c), true, "a moving clip beats a still for the view");
  /* Pathology selected with a view that has no combined clip: the
   * pathology clip wins over the plain view clip. */
  const ms = CLIPS.chooseClip(credits.clips, { view: "tte_a4c", pathology: "mitral_stenosis" });
  assert.ok(ms && ms.pathology === "mitral_stenosis", "pathology clip is the fallback after the combined tier");
  assert.equal(CLIPS.chooseClip(credits.clips, { view: "no_such_view" }), null);
  assert.equal(CLIPS.chooseClip(credits.clips, {}), null);
  assert.equal(CLIPS.chooseClip([], { view: "tte_a4c" }), null);
  const idx = CLIPS.indexClips(credits.clips);
  assert.equal(CLIPS.chooseClip(idx, { view: "tte_a4c" }).file, a4c.file, "indexed input works");
});

test("chooseClip: severity must match in the severity tiers, then falls back", () => {
  const clips = [
    { file: "view.mp4", view: "tte_a4c", pathology: null, url: "https://x/view.mp4" },
    { file: "ms-any.mp4", view: null, pathology: "mitral_stenosis", url: "https://x/ms.mp4" },
    { file: "ms-severe.mp4", view: null, pathology: "mitral_stenosis", severity: "severe", url: "https://x/mss.mp4" },
    { file: "combo-severe.mp4", view: "tte_a4c", pathology: "mitral_stenosis", severity: "severe", url: "https://x/cs.mp4" },
    { file: "still.webp", view: "tte_plax", pathology: null, url: "https://x/still.webp" },
    { file: "plax.mp4", view: "tte_plax", pathology: null, url: "https://x/plax.mp4" },
  ];
  assert.equal(CLIPS.chooseClip(clips, { view: "tte_a4c", pathology: "mitral_stenosis", severity: "severe" }).file, "combo-severe.mp4");
  assert.equal(CLIPS.chooseClip(clips, { view: "tte_plax", pathology: "mitral_stenosis", severity: "severe" }).file, "ms-severe.mp4",
    "pathology plus severity beats pathology alone and the view");
  assert.equal(CLIPS.chooseClip(clips, { view: "tte_plax", pathology: "mitral_stenosis", severity: "mild" }).file, "ms-any.mp4",
    "an unmatched severity falls back to the pathology clip, never a severe clip for mild");
  assert.equal(CLIPS.chooseClip(clips, { view: "tte_plax" }).file, "plax.mp4", "video beats an earlier still in the same tier");
});

test("cacheClipBytes: cache hit needs no fetch, miss fetches and stores, failure rejects", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  let fetches = 0, puts = 0;
  const store = new Map();
  const caches = { open: async () => ({
    match: async (u) => store.has(u) ? { arrayBuffer: async () => store.get(u) } : undefined,
    put: async (u, r) => { puts++; store.set(u, await r.arrayBuffer()); },
  }) };
  const fetchOk = async () => { fetches++; return { ok: true, status: 200, clone() { return this; }, arrayBuffer: async () => bytes }; };
  const out1 = await CLIPS.cacheClipBytes("https://x/a.mp4", { caches, fetch: fetchOk });
  assert.equal(out1, bytes); assert.equal(fetches, 1); assert.equal(puts, 1);
  const out2 = await CLIPS.cacheClipBytes("https://x/a.mp4", { caches, fetch: fetchOk });
  assert.equal(out2, bytes); assert.equal(fetches, 1, "second load is served from the Cache API with no fetch");
  await assert.rejects(() => CLIPS.cacheClipBytes("https://x/b.mp4", { caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) }, fetch: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(() => CLIPS.cacheClipBytes("https://x/c.mp4", { caches: null, fetch: null }), /no fetch/);
  assert.equal(CLIPS.CLIP_CACHE_NAME, "kardia-clips-v1");
});

test("at-target: needs quality 85 held for 0.5 s, then hysteresis holds to 80", () => {
  const m = EL._pure.createRealCine({});
  assert.equal(m.enterScore, 85); assert.equal(m.dwellMs, 500);
  assert.equal(m.update({ score: 84, withinTolerance: true }, 0), "sim", "84 never enters");
  assert.equal(m.update({ score: 100, withinTolerance: false }, 100), "sim", "outside tolerance never enters");
  assert.equal(m.update({ score: 90, withinTolerance: true }, 200), "sim", "dwell starts");
  assert.equal(m.update({ score: 90, withinTolerance: true }, 600), "sim", "0.4 s is not enough");
  assert.equal(m.update({ score: 86, withinTolerance: true }, 699), "sim");
  assert.equal(m.update({ score: 86, withinTolerance: true }, 700), "real", "0.5 s at or above 85 enters");
  /* Hysteresis: hovering between 80 and 85 at the edge stays real. */
  for (const [s, t] of [[84, 800], [81, 900], [84, 1000], [80, 1100]]) {
    assert.equal(m.update({ score: s, withinTolerance: true }, t), "real", `score ${s} holds`);
  }
  assert.equal(m.update({ score: 79, withinTolerance: true }, 1200), "sim", "below the exit score leaves");
  /* A dip during the dwell restarts it, so edge flicker cannot enter. */
  const m2 = EL._pure.createRealCine({});
  m2.update({ score: 95, withinTolerance: true }, 0);
  m2.update({ score: 60, withinTolerance: true }, 400);
  assert.equal(m2.update({ score: 95, withinTolerance: true }, 800), "sim", "dwell restarted after the dip");
  assert.equal(m2.update({ score: 95, withinTolerance: true }, 1299), "sim", "restarted dwell has not yet run for 0.5 s");
  assert.equal(m2.update({ score: 95, withinTolerance: true }, 1300), "real");
  assert.equal(m2.update({ score: 95, withinTolerance: false }, 1000), "sim", "leaving tolerance exits at once");
  m2.reset();
  assert.equal(m2.state(), "sim");
});

test("sectorClipPolygon masks the fan: apex top centre, arc at the depth edge", () => {
  const poly = EL._pure.sectorClipPolygon(400, 300, 80);
  assert.ok(poly.startsWith("polygon(50% "));
  const pts = poly.slice(8, -1).split(", ").map((p) => p.split(" ").map((v) => parseFloat(v)));
  assert.equal(pts.length, 18, "apex plus 17 arc points");
  assert.ok(pts[0][1] < 5, "apex sits near the top");
  const mid = pts[9];
  assert.ok(Math.abs(mid[0] - 50) < 1 && mid[1] > 95, "the bottom centre of the arc reaches the depth edge");
  const left = pts[1], right = pts[17];
  assert.ok(Math.abs((50 - left[0]) - (right[0] - 50)) < 1.5, "fan edges are symmetric about the centre");
  assert.equal(EL._pure.sectorClipPolygon(0, 300, 80), "");
});

test("source gates: ES5, British spelling, probe device never loads clips", () => {
  for (const f of ["../kardia-echolab.js", "../kardia-clips.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), f + " ES5 only");
    assert.ok(!/[–—]/.test(src), f + " no em or en dashes");
  }
  const lab = readFileSync(new URL("../kardia-echolab.js", import.meta.url), "utf8");
  assert.ok(lab.includes("isProbeDevice") && lab.includes('role === "probe"'), "probe role is checked before any clip work");
  assert.ok(lab.includes("updateRealCine(now)"), "the frame loop drives the state machine");
  assert.ok(lab.includes("KARDIA_CLIPS") && lab.includes("preloadFor"), "clips preload through kardia-clips");
  assert.ok(lab.includes('id = "krdRealVideo"') || lab.includes('"krdRealVideo"'), "the real cine element has a stable id");
});
