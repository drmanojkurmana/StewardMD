/* test/kardia-sim-probe.test.mjs - Kardia WP4 probe (kardia-sim-probe.js).
 * Reachability: for every TTE target view, the state built by
 * stateForView lies inside the window clamps and its plane matches the
 * views.json target plane (through KARDIA_GEOM.viewPlane) inside the
 * view tolerance, so the quality score there is 100.
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
  return { h, g, p };
}
function angle(a, b) {
  const d = Math.max(-1, Math.min(1, a.reduce((s, x, i) => s + x * b[i], 0) /
    (Math.hypot(...a) * Math.hypot(...b))));
  return Math.acos(d) * 180 / Math.PI;
}

test("exports: window global, module.exports, ES5 source", () => {
  assert.ok(PROBE && typeof PROBE.create === "function");
  const src = readFileSync(new URL("../kardia-sim-probe.js", import.meta.url), "utf8");
  assert.ok(!/\blet\s|\bconst\s|=>|\bclass\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "ES5 only");
  const win = {};
  new Function("window", "module", src)(win, undefined);
  assert.ok(win.KARDIA_PROBE && typeof win.KARDIA_PROBE.create === "function");
});

test("every TTE target view is reachable from its window within the clamps", () => {
  const { g, p } = settled();
  const tte = views.views.filter((v) => v.modality === "tte");
  assert.ok(tte.length >= 20, "TTE views " + tte.length);
  for (const v of tte) {
    const s = p.stateForView(v);
    assert.ok(s, v.id);
    assert.equal(s.window, v.window, v.id + " window");
    const c = p.clampsFor(v.window);
    assert.ok(s.position.x >= c.positionX[0] - 1e-9 && s.position.x <= c.positionX[1] + 1e-9, `${v.id} slide x ${s.position.x} in ${c.positionX}`);
    assert.ok(s.position.y >= c.positionY[0] - 1e-9 && s.position.y <= c.positionY[1] + 1e-9, `${v.id} slide y ${s.position.y} in ${c.positionY}`);
    assert.ok(s.rotationDeg >= c.rotationDeg[0] - 1e-9 && s.rotationDeg <= c.rotationDeg[1] + 1e-9, `${v.id} rotation ${s.rotationDeg}`);
    assert.ok(s.tiltDeg >= c.tiltDeg[0] - 1e-9 && s.tiltDeg <= c.tiltDeg[1] + 1e-9, `${v.id} tilt ${s.tiltDeg} in ${c.tiltDeg}`);
    assert.ok(s.rockDeg >= c.rockDeg[0] - 1e-9 && s.rockDeg <= c.rockDeg[1] + 1e-9, `${v.id} rock ${s.rockDeg} in ${c.rockDeg}`);
    p.setState(s);
    const pl = p.plane(), tp = g.viewPlane(v);
    const dist = Math.abs(pl.origin.reduce((sum, x, i) => sum + (x - tp.origin[i]) * tp.normal[i], 0));
    assert.ok(dist <= v.tolerance.distanceMm, `${v.id} plane distance ${dist.toFixed(2)}mm vs ${v.tolerance.distanceMm}`);
    assert.ok(angle(pl.normal, tp.normal) <= v.tolerance.angleDeg, `${v.id} normal angle ${angle(pl.normal, tp.normal).toFixed(2)} vs ${v.tolerance.angleDeg}`);
    assert.ok(angle(pl.up, tp.up) <= Math.max(v.tolerance.angleDeg, 8), `${v.id} up angle ${angle(pl.up, tp.up).toFixed(2)}`);
  }
});

test("TEE views are reachable with depth, omniplane 0 to 180 and flex in range", () => {
  const { p } = settled();
  const tee = views.views.filter((v) => v.modality === "tee");
  assert.ok(tee.length >= 8, "TEE views " + tee.length);
  for (const v of tee) {
    const s = p.stateForView(v);
    assert.ok(s.omniplaneDeg >= 0 && s.omniplaneDeg <= 180, `${v.id} omniplane ${s.omniplaneDeg}`);
    const c = p.clampsFor(v.window);
    assert.ok(s.depthCm >= c.depthCm[0] && s.depthCm <= c.depthCm[1], `${v.id} depth ${s.depthCm} in ${c.depthCm}`);
    assert.ok(s.flexDeg >= c.flexDeg[0] && s.flexDeg <= c.flexDeg[1], `${v.id} flex ${s.flexDeg}`);
  }
});

test("quality score is 100 at the target and drops with each error type", () => {
  const { p } = settled();
  const view = views.views.find((v) => v.id === "tte_a4c");
  const target = p.stateForView(view);
  p.setState(target);
  const atTarget = p.score(view);
  assert.equal(atTarget.score, 100, "at target " + JSON.stringify(atTarget));
  assert.ok(atTarget.withinTolerance);
  assert.equal(atTarget.landmarksPresent, atTarget.landmarksTotal, "all A4C landmarks in the target cut");

  const cases = {
    slide: { position: { x: target.position.x + 25, y: target.position.y } },
    rotation: { rotationDeg: target.rotationDeg + 25 },
    tilt: { tiltDeg: target.tiltDeg + 25 },
    rock: { rockDeg: target.rockDeg + 25 }
  };
  for (const [name, delta] of Object.entries(cases)) {
    p.setState(target); p.setState(delta);
    const r = p.score(view);
    assert.ok(r.score < 100, `${name} error should drop the score, got ${r.score}`);
    assert.ok(r.hints.length >= 1, name + " gives a hint");
  }
  // Foreshortening: moving the plane off the apex drops that component.
  p.setState(target);
  const apex = p.score(view);
  assert.equal(apex.components.foreshortening, 100);
  p.setState({ position: { x: target.position.x + 30, y: target.position.y - 20 } });
  assert.ok(p.score(view).score < atTarget.score, "off apex position scores lower");
});

test("view achieved needs one second inside tolerance", () => {
  const { p } = settled();
  const view = views.views.find((v) => v.id === "tte_plax");
  p.setState(p.stateForView(view));
  assert.equal(p.tick(view, 1000).achieved, false, "not yet held");
  assert.equal(p.tick(view, 1999).achieved, false, "999 ms is not enough");
  assert.equal(p.tick(view, 2000).achieved, true, "held for 1000 ms");
  p.setState({ rotationDeg: p.getState().rotationDeg + 40 });
  assert.equal(p.tick(view, 2100).achieved, false, "leaving tolerance resets the hold");
  assert.equal(p.tick(view, 2200).heldMs, 0);
});

test("clamps keep every control in its anatomical range", () => {
  const { p } = settled();
  p.setState({ window: "apical", position: { x: 999, y: -999 }, rotationDeg: 999, tiltDeg: 999, rockDeg: -999 });
  const s = p.getState(), c = p.clampsFor("apical");
  assert.equal(s.position.x, c.positionX[1]);
  assert.equal(s.position.y, c.positionY[0]);
  assert.equal(s.rotationDeg, c.rotationDeg[1]);
  assert.equal(s.tiltDeg, c.tiltDeg[1]);
  assert.equal(s.rockDeg, c.rockDeg[0]);
  p.setState({ window: "oesophageal", depthCm: 99, omniplaneDeg: 270, flexDeg: 99 });
  const t = p.getState();
  assert.equal(t.depthCm, p.clampsFor("oesophageal").depthCm[1]);
  assert.equal(t.omniplaneDeg, 180);
  assert.equal(t.flexDeg, 60);
  assert.equal(t.anteflexDeg, 60);
});

test("gyroscope mapping maths: calibrate pose, deltas and low-pass filter", () => {
  // Deltas are relative to the calibrate pose and wrapped.
  assert.deepEqual(PROBE.gyroDeltas({ alpha: 10, beta: 50, gamma: 20 }, { alpha: 10, beta: 30, gamma: 20 }),
    { tiltDeg: 20, rotationDeg: 0, rockDeg: 0 });
  assert.equal(PROBE.gyroDeltas({ alpha: 0, beta: 0, gamma: -170 }, { alpha: 0, beta: 0, gamma: 170 }).rotationDeg, 20, "gamma wraps across 180");
  assert.equal(PROBE.gyroDeltas({ alpha: 200, beta: 0, gamma: 0 }, { alpha: 0, beta: 0, gamma: 0 }).rockDeg, -45, "alpha rock is capped");

  // Low-pass: alpha from cutoff and period, and the filter converges
  // towards a step without overshoot.
  const a = PROBE.lowPassAlpha(5, 16);
  assert.ok(a > 0.2 && a < 0.5, "alpha at 5 Hz, 16 ms: " + a);
  assert.ok(PROBE.lowPassAlpha(5, 100) > a, "a slower sample rate trusts each sample more");
  let f = 0;
  for (let i = 0; i < 30; i++) f = PROBE.lowPass(f, 30, a);
  assert.ok(f > 29 && f <= 30, "filter settles on the step, got " + f);

  // End to end through a probe: calibrate, then tilt the phone.
  const { p } = settled();
  p.setState({ window: "apical", rotationDeg: 0, tiltDeg: 0, rockDeg: 0 });
  p.calibrateGyro({ alpha: 0, beta: 40, gamma: 0 });
  const before = p.getState();
  let s = before;
  for (let i = 0; i < 20; i++) s = p.applyGyroSample({ alpha: 0, beta: 60, gamma: 10 }, 16);
  assert.ok(Math.abs(s.tiltDeg - 20) < 2, "beta drives tilt, got " + s.tiltDeg);
  assert.ok(Math.abs(s.rotationDeg - 10) < 2, "gamma drives rotation, got " + s.rotationDeg);
  assert.equal(s.rockDeg, 0);
  // A single noisy sample barely moves the filtered probe.
  p.setState({ rotationDeg: 0, tiltDeg: 0, rockDeg: 0 });
  p.calibrateGyro({ alpha: 0, beta: 40, gamma: 0 });
  const one = p.applyGyroSample({ alpha: 0, beta: 70, gamma: 0 }, 16);
  assert.ok(one.tiltDeg < 15, "one 30 degree spike is damped, got " + one.tiltDeg);
});

test("gyroscope is off by default and permission is only asked on request", () => {
  const { p } = settled();
  assert.equal(p.getState().gyroOn, false);
  assert.equal(typeof p.requestGyroPermission, "function");
  assert.equal(typeof p.enableGyro, "function");
});

test("every catalogue view scores 100 at its target and below 90 fifteen degrees off", () => {
  // WP4b: target probe states derive from the CURRENT views.json planes
  // (inverted state to plane map, numerically for TEE), so the quality
  // score at stateForView(view) is exactly 100 for every TTE, TEE and
  // POCUS view, while fifteen degrees of rotation off target reads
  // below 90 everywhere.
  const { p } = settled();
  const all = views.views;
  assert.ok(all.length >= 40, "catalogue views " + all.length);
  for (const v of all) {
    const s = p.stateForView(v);
    assert.ok(s, v.id + " has a target state");
    assert.equal(s.window, v.window, v.id + " window");
    const c = p.clampsFor(v.window);
    assert.ok(s.position.x >= c.positionX[0] - 1e-9 && s.position.x <= c.positionX[1] + 1e-9, `${v.id} slide x ${s.position.x} in ${c.positionX}`);
    assert.ok(s.position.y >= c.positionY[0] - 1e-9 && s.position.y <= c.positionY[1] + 1e-9, `${v.id} slide y ${s.position.y} in ${c.positionY}`);
    assert.ok(s.rotationDeg >= c.rotationDeg[0] - 1e-9 && s.rotationDeg <= c.rotationDeg[1] + 1e-9, `${v.id} rotation ${s.rotationDeg} in ${c.rotationDeg}`);
    if (v.modality === "tee") {
      assert.ok(s.omniplaneDeg >= 0 && s.omniplaneDeg <= 180, `${v.id} omniplane ${s.omniplaneDeg}`);
      assert.ok(s.flexDeg >= c.flexDeg[0] - 1e-9 && s.flexDeg <= c.flexDeg[1] + 1e-9, `${v.id} flex ${s.flexDeg} in ${c.flexDeg}`);
      assert.ok(s.depthCm >= c.depthCm[0] - 1e-9 && s.depthCm <= c.depthCm[1] + 1e-9, `${v.id} depth ${s.depthCm} in ${c.depthCm}`);
    } else {
      assert.ok(s.tiltDeg >= c.tiltDeg[0] - 1e-9 && s.tiltDeg <= c.tiltDeg[1] + 1e-9, `${v.id} tilt ${s.tiltDeg} in ${c.tiltDeg}`);
      assert.ok(s.rockDeg >= c.rockDeg[0] - 1e-9 && s.rockDeg <= c.rockDeg[1] + 1e-9, `${v.id} rock ${s.rockDeg} in ${c.rockDeg}`);
    }
    p.setState(s);
    const at = p.score(v);
    assert.equal(at.score, 100, v.id + " scores 100 at target " + JSON.stringify({ d: at.distanceMm, a: at.angleDeg, lm: at.landmarksPresent + "/" + at.landmarksTotal + "/" + at.landmarksExpected }));
    assert.ok(at.withinTolerance, v.id + " within tolerance at target");
    // Fifteen degrees of rotation off target, away from a clamp wall so
    // the perturbation always moves the plane.
    const cur = p.getState().rotationDeg;
    const delta = cur + 15 > c.rotationDeg[1] + 1e-9 ? -15 : 15;
    p.setState({ rotationDeg: cur + delta });
    const moved = p.getState().rotationDeg;
    assert.ok(Math.abs(moved - cur) >= 15 - 1e-9, `${v.id} rotation perturbation applies (${cur} -> ${moved})`);
    const off = p.score(v);
    assert.ok(off.score < 90, `${v.id} fifteen degrees off scores below 90, got ${off.score}`);
  }
});
