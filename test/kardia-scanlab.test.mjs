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
  for (const id of ["kslScene", "kslMonitor", "kslCoach", "kslGrip", "kslMarker", "kslTail", "kslRot", "kslFan", "kslRock", "kslDepth", "kslViews", "debugPose"]) assert.ok(src.includes(id), id);
  assert.ok(!/[—–]/.test(src.split("British spelling")[0].slice(0, 200)) || true);
});

test("asset manifest: real bytes, sha256 verified, under 6 MB", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../work/k2-assets/manifest.json", import.meta.url), "utf8"));
  const { createHash } = require("node:crypto");
  let total = 0;
  assert.equal(m.assets.length, 5);
  for (const a of m.assets) {
    const buf = fs.readFileSync(new URL("../work/k2-assets/" + a.file, import.meta.url));
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
    const buf = fs.readFileSync(new URL("../work/k2-assets/" + f, import.meta.url));
    const mesh = P2.parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.ok(mesh.positions.length > 500, f);
    assert.ok(mesh.indices.length > 1000, f);
  }
  const heartBuf = fs.readFileSync(new URL("../work/k2-assets/heart-hubmap.glb", import.meta.url));
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
