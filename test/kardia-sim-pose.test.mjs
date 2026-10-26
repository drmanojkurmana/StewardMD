import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../kardia-scan-targets.js");
const SL = require("../kardia-scanlab.js");
const V = require("../kardia-sim-volume.js");
const P = SL._pure;

function angleDeg(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const la = Math.hypot(a[0], a[1], a[2]) || 1, lb = Math.hypot(b[0], b[1], b[2]) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (la * lb)))) * 180 / Math.PI;
}
function distMm(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

/* Parent-aligned Scan Lab plane for a view: beam is minus the parent
 * window probe up, up is the probe normal (views.json convention). */
function parentPlane(t) {
  const home = P.SIM_VOL_HOME[t.id];
  const probe = P.SIM_SL_PROBE[home.sl];
  return { origin: t.contact.slice(), beam: mul(probe.up, -1), normal: probe.normal.slice() };
}

test("sim constants: zoom and gain match the approved Sim path", () => {
  assert.equal(P.SIM_ZOOM, 1.8);
  assert.equal(P.SIM_GAIN, 1.6);
  assert.equal(P.SIM_VOL_SCALE, 1);
});

test("ssn resolves to the suprasternal arch target", () => {
  assert.equal(T.byId("ssn").id, "suprasternal_arch");
  assert.equal(T.byId("suprasternal").id, "suprasternal_arch");
});

test("each view maps onto its volume view pose within 1 mm and 1 degree", () => {
  assert.equal(T.VIEWS.length, 15);
  for (const t of T.VIEWS) {
    const home = P.SIM_VOL_HOME[t.id];
    assert.ok(home, t.id + " has a volume home");
    const vol = V.VIEWS[home.vol];
    assert.ok(vol, t.id + " volume view " + home.vol);
    const parent = T.byId(home.sl);
    assert.ok(parent, t.id + " parent " + home.sl);
    // At the parent target with the parent probe plane the cut coincides
    // with the round-1 volume pose, including the subcostal beam sign flip.
    const pose = { contact: parent.contact.slice() };
    const sim = P.simPoseFromScanlab(pose, parentPlane(parent), t, V, T);
    const vpl = V.poseToPlane(vol);
    assert.ok(distMm(sim.origin, vol.origin) < 1, `${t.id} origin ${distMm(sim.origin, vol.origin).toFixed(3)} mm`);
    assert.ok(angleDeg(sim.beam, vpl.beam) < 1, `${t.id} beam ${angleDeg(sim.beam, vpl.beam).toFixed(3)} deg`);
    assert.ok(angleDeg(sim.up, vpl.up) < 1, `${t.id} up ${angleDeg(sim.up, vpl.up).toFixed(3)} deg`);
  }
});

test("sliding to a sibling target keeps the sector and moves the cut with the contact", () => {
  for (const t of T.VIEWS) {
    const home = P.SIM_VOL_HOME[t.id];
    const vol = V.VIEWS[home.vol];
    const vpl = V.poseToPlane(vol);
    const pose = { contact: t.contact.slice() };
    const sim = P.simPoseFromScanlab(pose, parentPlane(t), t, V, T);
    assert.ok(angleDeg(sim.beam, vpl.beam) < 1, `${t.id} beam holds under slide`);
    assert.ok(angleDeg(sim.up, vpl.up) < 1, `${t.id} up holds under slide`);
    const parent = T.byId(home.sl);
    const want = [vol.origin[0] + (t.contact[0] - parent.contact[0]),
      vol.origin[1] + (t.contact[1] - parent.contact[1]),
      vol.origin[2] + (t.contact[2] - parent.contact[2])];
    assert.ok(distMm(sim.origin, want) < 1, `${t.id} slide ${distMm(sim.origin, want).toFixed(3)} mm`);
  }
});

test("sim pose falls back to the plane when no volume is loaded", () => {
  const plane = { origin: [1, 2, 3], beam: [0, -1, 0], normal: [0, 0, 1] };
  const sim = P.simPoseFromScanlab({ contact: [1, 2, 3] }, plane, null, null, T);
  assert.deepEqual(sim.origin, [1, 2, 3]);
});
