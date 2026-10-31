/* test/kardia-probe-feel.test.mjs - real probe feel: quaternion probe frame. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROBE = require("../kardia-sim-probe.js");
const SYNC = require("../kardia-sync.js");
const P = PROBE._pure;
const S = SYNC._pure;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wrap(d) { let x = d % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x; }
function settle(probe, attitude, n) {
  let s = null;
  for (let i = 0; i < (n || 40); i++) s = probe.applyGyroSample(attitude, 16);
  return s;
}
function freshProbe() {
  const p = PROBE.create({});
  p.setState({ window: "parasternal", rotationDeg: 0, tiltDeg: 0, rockDeg: 0 });
  return p;
}

test("flat phone spun on the bed: alpha spin becomes rotation, fan and rock stay near zero", () => {
  const p = freshProbe();
  p.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 });
  const frame = p.getGyroFrame();
  assert.deepEqual(frame.a, [0, 0, -1], "flat screen up: probe axis is device Z, pointing down into the bed");
  assert.deepEqual(frame.m, [0, 1, 0], "marker is device +Y, the top edge");
  const alphas = [0, 30, 90, 179, 181, 270, 359];
  let prev = null;
  for (const alpha of alphas) {
    const s = settle(p, { alpha, beta: 0, gamma: 0 });
    const expected = wrap(-alpha);
    assert.ok(Math.abs(wrap(s.rotationDeg - expected)) < 2, "alpha " + alpha + " rotation " + s.rotationDeg + " expected " + expected);
    assert.ok(Math.abs(s.tiltDeg) < 2, "alpha " + alpha + " fan " + s.tiltDeg);
    assert.ok(Math.abs(s.rockDeg) < 2, "alpha " + alpha + " rock " + s.rockDeg);
    if (prev !== null) assert.ok(Math.abs(wrap(s.rotationDeg - prev)) < 95, "no 360 jump at alpha " + alpha);
    prev = s.rotationDeg;
  }
});

test("flat phone: lifting the top edge rocks, lifting the side fans", () => {
  // Top edge lifted is beta +20. With a = -Z and m = +Y the swung axis
  // leans toward +m, so rock is +20 by the atan2(dot(a2, m), dot(a2, a)) rule.
  let p = freshProbe();
  p.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 });
  let s = settle(p, { alpha: 0, beta: 20, gamma: 0 });
  assert.ok(Math.abs(s.rockDeg - 20) < 2, "rock " + s.rockDeg);
  assert.ok(Math.abs(s.rotationDeg) < 2, "rotation " + s.rotationDeg);
  assert.ok(Math.abs(s.tiltDeg) < 2, "fan " + s.tiltDeg);

  // Side lifted is gamma +20. The swung axis leans toward -n for this
  // frame, so fan is -20: magnitude 20, sign from atan2(dot(a2, n), ...).
  p = freshProbe();
  p.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 });
  s = settle(p, { alpha: 0, beta: 0, gamma: 20 });
  assert.ok(Math.abs(s.tiltDeg - -20) < 2, "fan " + s.tiltDeg);
  assert.ok(Math.abs(s.rotationDeg) < 2, "rotation " + s.rotationDeg);
  assert.ok(Math.abs(s.rockDeg) < 2, "rock " + s.rockDeg);
});

test("upright phone head down: twisting about the long axis becomes rotation with no jumps", () => {
  // Beta -90 is head down: Rx(-90) maps device +Y (the top edge) to
  // world down, whereas Rx(+90) would point the top edge up. Twisting
  // about the long axis then varies gamma at fixed beta -90.
  const p = freshProbe();
  p.calibrateGyro({ alpha: 0, beta: -90, gamma: 0 });
  const frame = p.getGyroFrame();
  assert.deepEqual(frame.a, [0, 1, 0], "upright head down: probe axis is device +Y, pointing down");
  assert.deepEqual(frame.m, [0, 0, 1], "marker is device +Z, the screen normal");
  let prev = null;
  for (let g = 0; g <= 180; g += 5) {
    const s = settle(p, { alpha: 0, beta: -90, gamma: g }, 3);
    if (prev !== null) assert.ok(Math.abs(wrap(s.rotationDeg - prev)) <= 15, "jump at gamma " + g + ": " + prev + " to " + s.rotationDeg);
    prev = s.rotationDeg;
  }
  const end = settle(p, { alpha: 0, beta: -90, gamma: 180 }, 40);
  assert.ok(Math.abs(wrap(end.rotationDeg - 180)) < 2 || Math.abs(wrap(end.rotationDeg + 180)) < 2, "end rotation " + end.rotationDeg);
});

test("pure helpers: quatFromDeviceOrientation and swing-twist decomposition", () => {
  const q0 = P.quatFromDeviceOrientation(0, 0, 0);
  assert.ok(Math.abs(q0[3] - 1) < 1e-9);
  const frame = P.probeFrameFromQuat(q0);
  assert.deepEqual(frame.a, [0, 0, -1]);
  const spun = P.probePoseFromOrientation({ alpha: 30, beta: 0, gamma: 0 }, { alpha: 0, beta: 0, gamma: 0 });
  assert.ok(Math.abs(spun.rotationDeg - -30) < 0.001, "spun rotation " + spun.rotationDeg);
  assert.ok(Math.abs(spun.tiltDeg) < 0.001 && Math.abs(spun.rockDeg) < 0.001);
});

test("wire round trip: quatFromEuler then eulerFromQuat is lossless", () => {
  for (let rotation = -180; rotation <= 180; rotation += 15) {
    for (const fan of [-20, 0, 20]) {
      for (const rock of [-20, 0, 20]) {
        const e = S.eulerFromQuat(S.quatFromEuler(fan, rotation, rock));
        assert.ok(Math.abs(e.tiltDeg - fan) < 0.5, "fan " + fan + " got " + e.tiltDeg + " rot " + rotation);
        assert.ok(Math.abs(wrap(e.rotationDeg - rotation)) < 0.5, "rotation " + rotation + " got " + e.rotationDeg);
        assert.ok(Math.abs(e.rockDeg - rock) < 0.5, "rock " + rock + " got " + e.rockDeg);
      }
    }
  }
});

test("end to end: probe sender over loopback drives the display rotation", async () => {
  const clock = { now: 100000 };
  const now = () => clock.now;
  const display = SYNC.createDisplay({ probeLib: PROBE, now });
  const probeNode = SYNC.createProbe({ probeLib: PROBE, now });
  const pair = SYNC.createLoopbackPair({});
  const pairing = await display.createPairing();
  await display.hostWith(pair[0]);
  await probeNode.joinPairing(pairing.payload, pair[1]);
  await sleep(30);
  display.confirm(); probeNode.confirm();
  await sleep(10);

  const sent = [];
  const sender = SYNC.createProbeSender({ env: {}, probeLib: PROBE, sendPose: (pose, st) => sent.push({ pose, st }) });
  sender.handleOrientation({ alpha: 0, beta: 0, gamma: 0 }, 16);

  async function driveTo(alpha) {
    sent.length = 0;
    let returned = null;
    for (let i = 0; i < 40; i++) returned = sender.handleOrientation({ alpha, beta: 0, gamma: 0 }, 16) || returned;
    const pose = sent.length ? sent[sent.length - 1].pose : returned;
    assert.ok(pose, "sender sent a pose for alpha " + alpha);
    let out = null;
    for (let i = 0; i < 25; i++) {
      probeNode.sendPose(pose);
      clock.now += 16;
      out = display.renderFrame(clock.now) || out;
    }
    return out;
  }

  let out = await driveTo(0);
  assert.ok(Math.abs(wrap(out.rotationDeg)) < 5, "zero rotation " + out.rotationDeg);
  out = await driveTo(90);
  assert.ok(Math.abs(wrap(out.rotationDeg - -90)) < 5, "display rotation at alpha 90: " + out.rotationDeg);
  out = await driveTo(181);
  assert.ok(Math.abs(wrap(out.rotationDeg - 179)) < 6, "display rotation at alpha 181: " + out.rotationDeg);
  sender.disable();
});
