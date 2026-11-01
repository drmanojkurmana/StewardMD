/* test/kardia-tee-orientation.test.mjs - Kardia TEE plane basis.
 * Re-sweep after the mirrored mid oesophageal two chamber (ME 2C) and
 * long axis (ME LAX) fix. Rule (ASE and SCA comprehensive TEE
 * guideline, Hahn et al. 2013): the sector apex (transducer) is at
 * the top of the image, at omniplane 0 degrees the image is a
 * transverse plane with the patient left on the image right, and
 * turning the omniplane forward (about 60 to 70 degrees for ME 2C,
 * about 120 to 140 degrees for ME LAX) swings the image right from
 * the patient left towards the head. So a TEE long axis image right
 * points cranial: in ME 2C the left atrial appendage is to the image
 * right, and in ME LAX the outflow tract and aortic valve sit to the
 * image right of the left ventricle with the apex to the image left.
 * Landmark positions come from KARDIA_GEOM.cut at the target plane
 * (the same polygons the probe scorer uses): cut coordinates are
 * [image right, image up], so a bigger first coordinate is further
 * to the image right and a bigger second coordinate is nearer the
 * transducer at the top. No geometry is invented here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const H = require("../kardia-sim-heart.js");
const GEOM = require("../kardia-sim-geom.js");
const PROBE = require("../kardia-sim-probe.js");
const views = JSON.parse(readFileSync(new URL("../kardia/views.json", import.meta.url), "utf8"));

function settled() {
  const h = H.create(H.presets.normal);
  for (let t = 0; t < 12000; t += 10) h.step(10);
  const g = GEOM.create({ heart: h, views });
  const p = PROBE.create({ views, geom: g });
  return { g, p };
}
function norm(a) { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a.reduce((s, x, i) => s + x * b[i], 0); }
function cutCentroids(g, tp) {
  const polys = g.cut(tp.origin, tp.normal, tp.up, 260, 260);
  const byRef = {};
  for (const pol of polys) if (!byRef[pol.ref]) byRef[pol.ref] = pol.centroid;
  return byRef;
}

const TEE_LONG = ["tee_me_2c", "tee_me_lax", "tee_me_bicaval", "tee_me_av_lax"];

test("catalogue long axis TEE normals give a cranial image right, not a mirrored caudal one", () => {
  for (const id of TEE_LONG) {
    const v = views.views.find((x) => x.id === id);
    assert.ok(v, id);
    const right = norm(cross(norm(v.probe.normal), norm(v.probe.up)));
    assert.ok(dot(right, [0, 0, 1]) > 0, `${id} image right points cranial (got ${right.map((x) => x.toFixed(2))})`);
  }
  const me4c = views.views.find((x) => x.id === "tee_me_4c");
  const right4c = norm(cross(norm(me4c.probe.normal), norm(me4c.probe.up)));
  assert.ok(dot(right4c, [1, 0, 0]) > 0, "ME 4C at omniplane 0 keeps the patient left on the image right");
});

test("every TEE target scores 100 at its target pose and shows landmarks on the correct side", () => {
  const { g, p } = settled();
  const tee = views.views.filter((v) => v.modality === "tee");
  assert.ok(tee.length >= 8, "TEE views " + tee.length);
  for (const v of tee) {
    p.setState(p.stateForView(v));
    const at = p.score(v);
    assert.equal(at.score, 100, `${v.id} scores 100 at target (distance ${at.distanceMm}, angle ${at.angleDeg})`);
    const tp = g.viewPlane(v);
    const c = cutCentroids(g, tp);
    const right = norm(cross(norm(tp.normal), norm(tp.up)));
    if (TEE_LONG.includes(v.id)) {
      assert.ok(dot(right, [0, 0, 1]) > 0, `${v.id} target image right points cranial`);
    }
    if (v.id === "tee_me_4c") {
      assert.ok(c.FJ2425 && c.FJ2422, "ME 4C cut shows left atrium and left ventricle");
      assert.ok(c.FJ2425[1] > c.FJ2422[1], "ME 4C left atrium is nearer the transducer (higher) than the left ventricle");
      assert.ok(c.FJ2422[0] > c.FJ2423[0], "ME 4C left ventricle is to the image right of the right ventricle");
    }
    if (v.id === "tee_me_2c") {
      assert.ok(c.left_atrial_appendage && c.FJ2422, "ME 2C cut shows appendage and left ventricle");
      assert.ok(c.left_atrial_appendage[0] > c.FJ2422[0], "ME 2C left atrial appendage is to the image right of the left ventricle");
      assert.ok(c.FJ2425[0] > c.FJ2422[0], "ME 2C left atrium is to the image right of the left ventricle");
      if (c.lv_apex) assert.ok(c.lv_apex[0] < c.FJ2422[0], "ME 2C apex is to the image left of the left ventricle centre");
    }
    if (v.id === "tee_me_lax") {
      assert.ok(c.lvot && c.aortic_root && c.FJ2422, "ME LAX cut shows outflow tract, aortic root and left ventricle");
      assert.ok(c.lvot[0] > c.FJ2422[0], "ME LAX outflow tract is to the image right of the left ventricle");
      assert.ok(c.aortic_root[0] > c.FJ2422[0], "ME LAX aortic root is to the image right of the left ventricle");
      assert.ok(c.FJ3413[0] > c.aortic_root[0], "ME LAX ascending aorta continues to the image right of the aortic root");
      if (c.lv_apex) assert.ok(c.lv_apex[0] < c.FJ2422[0], "ME LAX apex is to the image left");
    }
    if (v.id === "tee_me_bicaval") {
      assert.ok(c.FJ3645 && c.FJ3441, "bicaval cut shows both cavae");
      assert.ok(c.FJ3645[0] > c.FJ3441[0], "bicaval superior vena cava is to the image right of the inferior vena cava");
    }
    if (v.id === "tee_me_av_sax") {
      assert.ok(c.FJ2426 && c.FJ2435, "ME AV short axis cut shows aortic cusps");
      assert.ok(c.FJ2426[0] > c.FJ2435[0], "ME AV short axis left cusp is to the image right of the anterior cusp");
    }
    if (v.id === "tee_me_av_lax") {
      assert.ok(c.lvot && c.aortic_root, "ME AV long axis cut shows outflow tract and aortic root");
      assert.ok(c.aortic_root[0] > c.lvot[0], "ME AV long axis aortic root is to the image right of the outflow tract");
      assert.ok(c.lvot[0] > 0, "ME AV long axis outflow tract is to the image right of the centre");
    }
    if (v.id === "tee_tg_mid_sax") {
      assert.ok(c.FJ2422 && c.FJ2423, "transgastric short axis cut shows both ventricles");
      assert.ok(c.FJ2422[0] > c.FJ2423[0], "transgastric short axis left ventricle stays to the image right of the right ventricle");
    }
    if (v.id === "tee_desc_aorta_sax") {
      assert.ok(c.FJ3427 && c.LIVE_esophagus, "descending aorta cut shows aorta and oesophagus");
      assert.ok(c.FJ3427[1] < c.LIVE_esophagus[1], "descending aorta sits further from the transducer than the oesophagus");
    }
  }
});

test("TTE target side is unchanged by the TEE basis fix", () => {
  const { g } = settled();
  const v = views.views.find((x) => x.id === "tte_a4c");
  const c = cutCentroids(g, g.viewPlane(v));
  assert.ok(c.FJ2422[0] > c.FJ2423[0], "apical four chamber left ventricle stays on the image right");
});
