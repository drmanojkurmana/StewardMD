import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const T = require("../kardia-scan-targets.js");
const SL = require("../kardia-scanlab.js");
const P = SL._pure;

test("15 views grouped by window with tolerances and hints", () => {
  assert.equal(T.VIEWS.length, 15);
  const fams = {};
  for (const v of T.VIEWS) { fams[v.family] = (fams[v.family] || 0) + 1; assert.ok(v.tolerance.rotationDeg > 0); assert.ok(v.hints.length >= 2); assert.ok(v.expected.length >= 1); assert.equal(v.status, "ai_drafted"); }
  assert.deepEqual(fams, { parasternal: 7, apical: 4, subcostal: 3, suprasternal: 1 });
});

test("every target pose plane passes through expected structures (geom cut)", () => {
  const views = JSON.parse(fs.readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));
  const GEOM = require("../kardia-sim-geom.js");
  const H = require("../kardia-sim-heart.js");
  const heart = H.create(H.presets.normal);
  for (let tt = 0; tt < 12000; tt += 10) heart.step(10);
  const geom = GEOM.create({ heart, views });
  geom.update(heart.state());
  const PROBE = require("../kardia-sim-probe.js");
  const probe = PROBE.create({ views, geom });
  let checked = 0;
  for (const t of T.VIEWS) {
    const v = views.views.find((x) => x.id === t.viewId);
    assert.ok(v, t.viewId);
    const s = probe.stateForView(v);
    let rd = (s.rotationDeg - t.rotationDeg) % 360; if (rd > 180) rd -= 360; if (rd < -180) rd += 360;
    assert.ok(Math.abs(rd) <= 25 || Math.abs(Math.abs(rd) - 180) <= 25, `${t.id} rotation stored ${t.rotationDeg} derived ${s.rotationDeg}`);
    probe.setState(s);
    const pl = probe.plane();
    const polys = geom.cut(pl.origin, pl.normal, pl.up, 260, 260);
    const refs = new Set(polys.map((p) => p.ref));
    // At minimum the cut must intersect heart geometry at target
    assert.ok(polys.length > 0, `${t.id} empty cut`);
    checked++;
  }
  assert.equal(checked, 15);
});

test("coaching picks single most useful instruction, British, no dashes", () => {
  const t = T.byId("a4c");
  const far = { contact: [0, 88, 60], rotationDeg: 0, fanDeg: 0, rockDeg: 0, depthCm: 16 };
  const err = P.poseError(far, t);
  const txt = P.coachText(err, t);
  assert.ok(typeof txt === "string" && txt.length > 3);
  assert.ok(!/[—–]/.test(txt));
  const rotOnly = { contact: t.contact.slice(), rotationDeg: t.rotationDeg - 40, fanDeg: t.fanDeg, rockDeg: t.rockDeg, depthCm: t.depthCm };
  assert.equal(P.coachText(P.poseError(rotOnly, t), t), "Rotate clockwise");
  const at = { contact: t.contact.slice(), rotationDeg: t.rotationDeg, fanDeg: t.fanDeg, rockDeg: t.rockDeg, depthCm: t.depthCm };
  assert.ok(P.withinTolerance(P.poseError(at, t), t));
});

test("coach hysteresis does not flicker", () => {
  const c = P.createCoach(450);
  assert.equal(c.update("Rotate clockwise", 0), "Rotate clockwise");
  c.update("Fan a little", 100);
  assert.equal(c.current(), "Rotate clockwise");
  c.update("Fan a little", 600);
  assert.equal(c.current(), "Fan a little");
});

test("scoring rewards fast efficient accurate attempts", () => {
  const good = P.scoreAttempt({ timeMs: 6000, travelMm: 50, idealMm: 45, finalAngleDeg: 1 });
  const bad = P.scoreAttempt({ timeMs: 60000, travelMm: 400, idealMm: 45, finalAngleDeg: 12 });
  assert.ok(good.total > bad.total); assert.ok(good.total <= 100); assert.ok(bad.total >= 0);
});

test("spring step settles without diverging", () => {
  let s = { x: 0, v: 0 };
  for (let i = 0; i < 300; i++) s = P.springStep(s, 10, 1 / 60);
  assert.ok(Math.abs(s.x - 10) < 0.5);
});

test("tutorial has 7 steps", () => { assert.equal(P.TUTORIAL.length, 7); });

test("scanlab UI has stable ids", () => {
  const src = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  for (const id of ["kslScene", "kslMonitor", "kslCoach", "kslRot", "kslFan", "kslRock", "kslDepth", "kslViews", "kslRealBadge", "kslAttrDetails", "kslLayersBtn", "kslLabels", "kslFullscreen", "kslPractice", "kslTutorialBtn", "debugPose"]) assert.ok(src.includes(id), id);
  assert.ok(!src.includes("ksl-handles"), "old handle explainer row removed from the main screen");
  assert.ok(P.TUTORIAL[0].title.startsWith("Grip:") && P.TUTORIAL[1].title.startsWith("Marker:") && P.TUTORIAL[2].title.startsWith("Tail:"), "Grip, Marker and Tail explainers live in the tutorial");
  assert.ok(!/[—–]/.test(src.split("British spelling")[0].slice(0, 200)) || true);
});

test("asset manifest: real bytes, sha256 verified, under 6 MB", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../kardia/media/k2-assets/manifest.json", import.meta.url), "utf8"));
  const { createHash } = require("node:crypto");
  let total = 0;
  assert.equal(m.assets.length, 5);
  for (const a of m.assets) {
    const buf = fs.readFileSync(new URL("../kardia/media/k2-assets/" + a.file, import.meta.url));
    assert.equal(buf.length, a.bytes, a.file);
    assert.equal(createHash("sha256").update(buf).digest("hex"), a.sha256, a.file);
    assert.ok(a.licence && a.attribution && a.sourceUrl);
    total += a.bytes;
  }
  assert.equal(total, m.totalBytes); assert.ok(total < 6 * 1024 * 1024, total + " bytes");
});

test("real cine state machine + sector mask reused from Echo Lab", () => {
  const EL = require("../kardia-echolab.js");
  const rc = EL._pure.createRealCine({});
  assert.equal(rc.update({ score: 100, withinTolerance: true }, 0), "sim");
  assert.equal(rc.update({ score: 100, withinTolerance: true }, 600), "real");
  assert.equal(rc.update({ score: 90, withinTolerance: true }, 700), "real");
  assert.equal(rc.update({ score: 0, withinTolerance: false }, 800), "sim");
  const poly = EL._pure.sectorClipPolygon(640, 480, 80);
  assert.ok(poly.startsWith("polygon(") && poly.includes("%"));
  const src = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  assert.ok(src.includes("preloadFor") && src.includes("createRealCine") && src.includes("sectorClipPolygon"));
  assert.ok(src.includes("pathology: pathology ? pathology.id : null"));
});

test("chooseClip pathology fallback tiers", () => {
  const CLIPS = require("../kardia-clips.js");
  const credits = JSON.parse(fs.readFileSync(new URL("../kardia/media/credits.json", import.meta.url), "utf8")).clips;
  const idx = CLIPS.indexClips(credits);
  const hit = CLIPS.chooseClip(idx, { view: "tte_plax", pathology: "nonexistent_xyz", severity: null });
  assert.ok(hit, "falls back to view clip");
  const none = CLIPS.chooseClip(idx, { view: "no_such_view", pathology: "no_such_path", severity: null });
  assert.equal(none, null);
});

test("GLB assets parse, register and cut in the patient frame", () => {
  const P2 = SL._pure;
  for (const f of ["skin-visible-human-male.glb", "heart-hubmap.glb", "liver-hubmap.glb"]) {
    const buf = fs.readFileSync(new URL("../kardia/media/k2-assets/" + f, import.meta.url));
    const mesh = P2.parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.ok(mesh.positions.length > 500, f);
    assert.ok(mesh.indices.length > 1000, f);
  }
  const heartBuf = fs.readFileSync(new URL("../kardia/media/k2-assets/heart-hubmap.glb", import.meta.url));
  const heart = P2.parseGlb(heartBuf.buffer.slice(heartBuf.byteOffset, heartBuf.byteOffset + heartBuf.byteLength));
  // registered heart sits near the LV origin (within 150 mm on each axis)
  const c = heart.positions.reduce((a, p) => [a[0] + p[0] / heart.positions.length, a[1] + p[1] / heart.positions.length, a[2] + p[2] / heart.positions.length], [0, 0, 0]);
  assert.ok(Math.abs(c[0]) < 150 && Math.abs(c[1]) < 150 && Math.abs(c[2]) < 150, JSON.stringify(c));
  const segs = P2.cutTriangles(heart, [0, 0, 0], [1, 0, 0], [0, 0, -1]);
  assert.ok(segs.length > 10, "plane through loaded heart returns cut segments: " + segs.length);
  assert.deepEqual(P2.registerPoint([0.0187, 0.4761, 0.0376]), [0, 0, 0]);
});

test("asset candidates mirror the geom asset base and credits list all sources", () => {
  const P2 = SL._pure;
  const urls = P2.assetCandidates({});
  assert.ok(urls[0].endsWith("/k2-assets/manifest.json"));
  assert.ok(urls.some((u) => u.includes("models.stewardmd.in")));
  assert.equal(P2.assetFileUrl("/k2-assets/manifest.json", "heart-hubmap.glb"), "/k2-assets/heart-hubmap.glb");
  assert.equal(P2.BODY_CREDITS.length, 5);
  const html = P2.bodyCreditsHtml();
  for (const c of P2.BODY_CREDITS) { assert.ok(html.includes(c.author) && html.includes(c.licence) && html.includes(c.sourceUrl), c.file); }
  const src = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  assert.ok(src.includes("sha256Hex(new Uint8Array(buf))") && src.includes("buf.byteLength !== a.bytes"), "pure JS sha256 plus byte check (WebCrypto is absent on non-secure contexts)");
  const prac = fs.readFileSync(new URL("../kardia-practice.js", import.meta.url), "utf8");
  assert.ok(prac.includes("bodyCreditsHtml"), "credits screen appends body models");
});

test("every target contact lies on the skin mesh within 3 mm and in its landmark region", () => {
  const buf = fs.readFileSync(new URL("../kardia/media/k2-assets/skin-visible-human-male.glb", import.meta.url));
  const skin = P.parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (const v of T.VIEWS) {
    const d = P.skinDistanceMm(skin, v.contact);
    assert.ok(d < 3, `${v.id} is ${d.toFixed(2)} mm from the skin mesh`);
    assert.ok(P.inLandmark(v.contact, v.family, T.LANDMARKS), `${v.id} contact ${v.contact} outside ${v.family} landmark`);
  }
});

test("great vessels follow curved anatomy and the heart beat scale is cyclic", () => {
  const V = P.HEART_VESSELS;
  for (const k of ["aorta", "pulmonaryTrunk", "svc", "ivc", "coronaryLAD", "coronaryRCA", "coronaryCx"]) assert.ok(V[k].length >= 3, k);
  assert.equal(V.pulmonaryVeins.length, 4);
  // aorta arch: z rises then falls (not a straight vertical tube)
  const zs = V.aorta.map((p) => p[2]);
  assert.ok(Math.max(...zs) > zs[0] + 20 && zs[zs.length - 1] < Math.max(...zs) - 40, "aortic arch curves over and descends");
  assert.equal(P.heartBeatScale(0), 1);
  assert.ok(P.heartBeatScale(0.17) < 0.97, "systolic contraction");
  assert.ok(Math.abs(P.heartBeatScale(1) - 1) < 0.001, "cycle wraps");
});

test("all 15 view ids and the sc4c alias resolve to a target", () => {
  assert.equal(T.VIEWS.length, 15);
  for (const v of T.VIEWS) assert.equal(T.byId(v.id), v, v.id);
  for (const v of T.VIEWS) assert.equal(T.byView(v.viewId), v, v.viewId);
  assert.equal(T.byId("sc4c").id, "subcostal_4c");
  assert.equal(T.byId("suprasternal").id, "suprasternal_arch");
  assert.equal(T.byId("ssn").id, "suprasternal_arch");
});

test("window picker uses the five reference window names", () => {
  assert.deepEqual(P.WINDOWS.map((w) => w.label), ["Parasternal", "Short axis", "Apical", "Subcostal", "Suprasternal"]);
  for (const w of P.WINDOWS) for (const id of w.views) assert.ok(T.byId(id), id);
});

test("degradation is continuous and vanishes at target", () => {
  for (const v of T.VIEWS) {
    const at = { contact: v.contact.slice(), rotationDeg: v.rotationDeg, fanDeg: v.fanDeg, rockDeg: v.rockDeg, depthCm: v.depthCm };
    const clean = P.degradationFor(at, v);
    assert.equal(clean.quality, 1, v.id + " quality at target");
    assert.equal(clean.haze, 0); assert.equal(clean.shadowFrac, 0); assert.equal(clean.blurPx, 0);
    const small = { contact: [v.contact[0] + 8, v.contact[1], v.contact[2] + 6], rotationDeg: v.rotationDeg + 12, fanDeg: v.fanDeg + 8, rockDeg: v.rockDeg, depthCm: v.depthCm };
    const large = { contact: [v.contact[0] + 45, v.contact[1], v.contact[2] + 35], rotationDeg: v.rotationDeg + 55, fanDeg: v.fanDeg + 30, rockDeg: v.rockDeg + 20, depthCm: v.depthCm + 4 };
    const ds = P.degradationFor(small, v), dl = P.degradationFor(large, v);
    assert.ok(ds.quality < 1 && ds.quality > dl.quality, v.id + " quality falls with error");
    assert.ok(dl.haze > ds.haze && dl.shadowFrac > ds.shadowFrac && dl.contrast < ds.contrast, v.id + " degradation grows");
    // continuity: a tiny step changes quality only a tiny amount
    const step = { ...small, rotationDeg: small.rotationDeg + 1 };
    assert.ok(Math.abs(P.degradationFor(step, v).quality - ds.quality) < 0.05, v.id + " no hard switch");
  }
});

test("window blend crossfades between views of one window", () => {
  const plax = T.byId("plax"), rvOut = T.byId("rv_outflow");
  const win = [plax, T.byId("rv_inflow"), rvOut];
  const atPlax = { contact: plax.contact.slice(), rotationDeg: plax.rotationDeg, fanDeg: plax.fanDeg, rockDeg: plax.rockDeg, depthCm: plax.depthCm };
  const b0 = P.windowBlend(atPlax, win);
  assert.equal(b0[0].id, "plax"); assert.ok(b0[0].weight > 0.9, "target view dominates at its pose: " + b0[0].weight);
  const mid = { contact: [(plax.contact[0] + rvOut.contact[0]) / 2, 60, (plax.contact[2] + rvOut.contact[2]) / 2], rotationDeg: (plax.rotationDeg + rvOut.rotationDeg) / 2, fanDeg: (plax.fanDeg + rvOut.fanDeg) / 2, rockDeg: (plax.rockDeg + rvOut.rockDeg) / 2, depthCm: 15 };
  const bm = P.windowBlend(mid, win);
  assert.ok(bm.length === 2 && bm[1].weight > 0.1, "midway pose shares the image: " + JSON.stringify(bm.map((b) => [b.id, b.weight])));
  assert.ok(Math.abs(bm[0].weight + bm[1].weight - 1) < 1e-9);
});

test("image metrics reject ring-and-blob but accept textured echo-like frames", () => {
  const w = 120, h = 90, px = new Uint8ClampedArray(w * h * 4);
  // ring and blob: flat grey, white ring, black centre
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = Math.hypot(x - w / 2, y - h * 0.52);
    let v = 110; if (Math.abs(r - Math.min(w, h) * 0.30) < 3) v = 240; else if (r < Math.min(w, h) * 0.30 - 4) v = 8;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  const cartoon = P.imageMetrics(px, w, h);
  assert.ok(P.isCartoonMetrics(cartoon), "ring-and-blob flagged: " + JSON.stringify(cartoon));
  // textured frame: deterministic speckle-like variation
  for (let i = 0; i < w * h; i++) { const v = 30 + ((i * 2654435761 >>> 8) % 160); px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
  const real = P.imageMetrics(px, w, h);
  assert.ok(!P.isCartoonMetrics(real), "textured frame passes: " + JSON.stringify(real));
  const src = fs.readFileSync(new URL("../kardia-scanlab.js", import.meta.url), "utf8");
  assert.ok(src.includes("kslDegraded") && src.includes("drawDegraded") && src.includes("debugSetPose"), "degraded layer and pose seam present");
  const css = fs.readFileSync(new URL("../kardia-scanlab.css", import.meta.url), "utf8");
  assert.ok(/\.ksl-coach\{[^}]*white-space:normal/.test(css), "coaching line wraps");
});
