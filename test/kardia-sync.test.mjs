/* test/kardia-sync.test.mjs - Kardia SyncProbe core (kardia-sync.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const SYNC = require("../kardia-sync.js");
const PROBE = require("../kardia-sim-probe.js");
const P = SYNC._pure;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeEcho() {
  const calls = [];
  return { calls, setProbeState(s) { calls.push(JSON.parse(JSON.stringify(s))); return s; }, getProbeState() { return calls[calls.length - 1] || null; } };
}
async function paired(opts = {}) {
  const clock = { now: opts.start ?? 100000 };
  const now = () => clock.now;
  const echo = fakeEcho();
  const display = SYNC.createDisplay({ probeLib: PROBE, echoLab: echo, now });
  const probe = SYNC.createProbe({ probeLib: PROBE, now });
  const pair = SYNC.createLoopbackPair(opts.loopback || {});
  const pairing = await display.createPairing();
  await display.hostWith(pair[0]);
  await probe.joinPairing(pairing.payload, pair[1]);
  await sleep(30);
  return { clock, now, echo, display, probe, pair, pairing };
}
async function connected(opts) {
  const ctx = await paired(opts);
  ctx.display.confirm(); ctx.probe.confirm();
  await sleep(10);
  return ctx;
}
function stubTransport(id, kind, statsRef, available = true) {
  return {
    id, kind,
    capabilities: async () => ({ available, canAdvertise: true, canScan: true, needsInternet: kind === "relay", maxPayload: 512, platform: "web" }),
    host: async () => {}, join: async () => {}, send: () => true, close: async () => {},
    stats: () => statsRef.value,
  };
}

test("capability detection: platform, WebCrypto, orientation, iOS permission", () => {
  const ios = SYNC.detectCapabilities({ DeviceOrientationEvent: { requestPermission: async () => "granted" }, crypto: globalThis.crypto, navigator: { userAgent: "iPhone" } });
  assert.equal(ios.hasWebCrypto, true);
  assert.equal(ios.hasDeviceOrientation, true);
  assert.equal(ios.needsIosPermission, true);
  assert.equal(ios.platform, "ios");
  const none = SYNC.detectCapabilities({ crypto: globalThis.crypto, navigator: { userAgent: "Android" } });
  assert.equal(none.hasDeviceOrientation, false);
  assert.equal(none.canUseProbeSensor, false);
  assert.equal(none.platform, "android");
});

test("registry: capability check, BLE direct preferred over relay, unavailable skipped", async () => {
  const healthy = { value: { rttMs: 10, lossPct: 0, lastRecvAt: 1 } };
  const relay = stubTransport("relay", "relay", healthy);
  const ble = stubTransport("ble", "direct", healthy);
  const dead = stubTransport("dead", "direct", healthy, false);
  const mgr = SYNC.createTransportManager({ transports: [relay, dead, ble] });
  const chosen = await mgr.select();
  assert.equal(chosen.transport.id, "ble");
  assert.throws(() => SYNC.registerTransport({ id: "bad" }), /missing/);
});

test("frames: POSE is 35 bytes, round trip, HELLO/WELCOME/CONTROL/PING/PONG/BYE sizes", () => {
  const key = new Uint8Array(32).fill(7);
  const pose = P.encodeFrame({ type: SYNC.TYPES.POSE, seq: 3, tMs: 100, sessionTag: 0x1234, pose: P.clampPose({ quat: [0, 0, 0, 1], window: "apical", slideXmm: 1.2, slideYmm: -2.3, touch: 1, flags: 5 }, PROBE) }, key);
  assert.equal(pose.length, 35);
  const dec = P.decodeFrame(pose, key);
  assert.equal(dec.ok, true);
  assert.equal(dec.frame.pose.window, "apical");
  assert.equal(dec.frame.pose.slideXmm, 1.2);
  assert.equal(dec.frame.pose.calibrated, true);
  const hello = P.encodeFrame({ type: SYNC.TYPES.HELLO, seq: 1, tMs: 0, sessionTag: 1, probePub: new Uint8Array(65), nonce: new Uint8Array(12) }, null);
  assert.equal(hello.length, 89);
});

test("pairing payload and short code", async () => {
  const { pairing, display } = await paired();
  assert.match(pairing.shortCode, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(pairing.sessionId.length, 32);
  const parsed = P.parsePairingPayload(pairing.payload);
  assert.equal(parsed.sessionId, pairing.sessionId);
  assert.equal(parsed.expiresAt, display.pairing.expiresAt);
  assert.equal(P.parsePairingPayload("kardia-sync:1:bad"), null);
  assert.equal(P.shortCodeHash4(pairing.shortCode).length, 4);
});

test("pairing: both sides derive same key and same 4 digit confirmation, session isolation", async () => {
  const a = await paired();
  assert.equal(a.display.state, "confirming");
  assert.equal(a.probe.state, "confirming");
  assert.match(a.display.confirmCode, /^\d{4}$/);
  assert.equal(a.display.confirmCode, a.probe.confirmCode);
  assert.deepEqual(a.display.sessionKey, a.probe.sessionKey);
  const b = await paired();
  // A pose from session A delivered to display B never crosses.
  const poseA = P.encodeFrame({ type: SYNC.TYPES.POSE, seq: 50, tMs: 0, sessionTag: P.sessionTagOf(P.hexToBytes(a.pairing.sessionId)), pose: P.clampPose({ quat: [0, 0, 0, 1], window: "apical" }, PROBE) }, a.display.sessionKey);
  const before = b.display.stats.accepted;
  await b.display.handleBytes(poseA);
  assert.equal(b.display.stats.accepted, before);
  assert.ok(b.display.stats.droppedMac > 0 || b.display.stats.droppedSession > 0);
});

test("MAC failure is dropped", async () => {
  const { display, probe } = await connected();
  const bytes = P.encodeFrame({ type: SYNC.TYPES.POSE, seq: 90, tMs: 0, sessionTag: P.sessionTagOf(P.hexToBytes(display.pairing.sessionId)), pose: P.clampPose({ quat: [0, 0, 0, 1], window: "apical" }, PROBE) }, display.sessionKey);
  const bad = bytes.slice(); bad[15] ^= 0xff;
  const before = display.stats.droppedMac;
  await display.handleBytes(bad);
  assert.equal(display.stats.droppedMac, before + 1);
  assert.equal(probe.state, "connected");
});

test("credential expiry: probe join after expiry fails with hint; display pairing expires", async () => {
  const clock = { now: 5000 };
  const now = () => clock.now;
  const display = SYNC.createDisplay({ probeLib: PROBE, now });
  const pairing = await display.createPairing();
  clock.now = pairing.expiresAt + 1;
  const probe = SYNC.createProbe({ probeLib: PROBE, now });
  await probe.joinPairing(pairing.payload);
  assert.equal(probe.state, "failed");
  assert.equal(probe.getState().reason, "credential-expired");
  assert.ok(probe.getState().recoveryHint);
  assert.equal(display.tick(clock.now).expired, true);
  assert.equal(display.state, "failed");
});

test("replay, duplicate, out-of-order and stale rejection", async () => {
  const { display, clock } = await connected();
  const tag = P.sessionTagOf(P.hexToBytes(display.pairing.sessionId));
  const mk = (seq, tMs) => P.encodeFrame({ type: SYNC.TYPES.POSE, seq, tMs, sessionTag: tag, pose: P.clampPose({ quat: [0, 0, 0, 1], window: "apical" }, PROBE) }, display.sessionKey);
  const mono = clock.now - 100000;
  await display.handleBytes(mk(200, mono));
  assert.equal(display.stats.accepted, 1);
  await display.handleBytes(mk(200, mono)); // duplicate and replay
  assert.equal(display.stats.droppedSeq, 1);
  await display.handleBytes(mk(199, mono)); // out of order
  assert.equal(display.stats.droppedSeq, 2);
  display.updateClockOffset(0);
  await display.handleBytes(mk(201, mono - 1000)); // stale by 1000 ms
  assert.equal(display.stats.droppedStale, 1);
  assert.equal(display.stats.accepted, 1);
});

test("PING/PONG estimates clock offset", async () => {
  const { display, probe } = await connected();
  probe.sendPing();
  await sleep(10);
  assert.notEqual(probe.clockOffsetMs, null);
  assert.ok(Math.abs(probe.clockOffsetMs) < 500);
  assert.equal(display.state, "connected");
});

test("bounds: sender clamps slides, forged out-of-bounds pose is dropped", async () => {
  const clamped = P.clampPose({ quat: [0, 0, 0, 2], window: "apical", slideXmm: 999, slideYmm: -999 }, PROBE);
  assert.equal(clamped.slideXmm, 35);
  assert.equal(clamped.slideYmm, -40);
  assert.equal(P.validatePose({ quat: [2, 0, 0, 0], window: "apical", slideXmm: 0, slideYmm: 0 }).ok, false);
  const { display } = await connected();
  const tag = P.sessionTagOf(P.hexToBytes(display.pairing.sessionId));
  const rawPose = { quat: [0, 0, 0, 1], touch: 0, windowIndex: 1, window: "apical", slideXmm: 0, slideYmm: 0, flags: 0 };
  // Craft with slide beyond clamp by encoding manually through a pose object that bypasses clampPose.
  const forged = P.encodeFrame({ type: SYNC.TYPES.POSE, seq: 77, tMs: 0, sessionTag: tag, pose: { quat: [0, 0, 0, 1], window: "apical", slideXmm: 999, slideYmm: 0, touch: 0, flags: 0 } }, display.sessionKey);
  void rawPose;
  const before = display.stats.droppedBounds;
  await display.handleBytes(forged);
  assert.equal(display.stats.droppedBounds, before + 1);
});

test("state transitions and transport health fallback with hysteresis on a fake clock", async () => {
  const seen = [];
  const clock = { now: 0 };
  const dStats = { value: { rttMs: 10, lossPct: 0, lastRecvAt: 1 } };
  const rStats = { value: { rttMs: 10, lossPct: 0, lastRecvAt: 1 } };
  const direct = stubTransport("ble", "direct", dStats);
  const relay = stubTransport("relay", "relay", rStats);
  const mgr = SYNC.createTransportManager({ transports: [direct, relay], now: () => clock.now });
  mgr.setActive(direct, 0);
  dStats.value = { rttMs: 900, lossPct: 80, lastRecvAt: 1 };
  assert.equal(mgr.evaluate(0).switched, false);
  assert.equal(mgr.evaluate(3999).switched, false);
  const sw = mgr.evaluate(4000);
  assert.equal(sw.switched, true);
  assert.equal(mgr.active.id, "relay");
  dStats.value = { rttMs: 10, lossPct: 0, lastRecvAt: 1 };
  mgr.evaluate(4000);
  assert.equal(mgr.evaluate(23999).switched, false);
  const back = mgr.evaluate(24000);
  assert.equal(back.switched, true);
  assert.equal(mgr.active.id, "ble");
  seen.push(mgr.active.id);
  assert.deepEqual(seen, ["ble"]);
});

test("scan back-off 2, 4, 8, cap 15 s and never more than one scan", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => P.scanBackoffMs(n)), [2000, 4000, 8000, 15000, 15000]);
  const mgr = SYNC.createTransportManager({ transports: [] });
  assert.equal(mgr.startScan(), true);
  assert.equal(mgr.startScan(), false);
  assert.equal(mgr.endScan(false), 4000);
  assert.equal(mgr.startScan(), true);
});

test("connected flow: coalescing keeps newest pose per render frame, smoothing and echoLab apply", async () => {
  const { display, probe, echo, clock } = await connected();
  for (let i = 1; i <= 3; i++) probe.sendPose({ quat: P.quatFromEuler(i * 5, 0, 0), window: "apical", slideXmm: i, slideYmm: 0 });
  await sleep(5);
  assert.equal(display.stats.accepted, 3);
  const out = display.renderFrame(clock.now + 16);
  assert.equal(echo.calls.length, 1);
  assert.equal(out.position.x, 3);
  assert.equal(display.renderFrame(clock.now + 32), null);
});

test("single controller: a second HELLO is rejected while one is active", async () => {
  const { display, pairing, now } = await connected();
  const codeBefore = display.confirmCode;
  const probe2 = SYNC.createProbe({ probeLib: PROBE, now });
  await probe2.joinPairing(pairing.payload);
  await display.handleBytes(probe2._lastHelloBytes);
  assert.equal(display.rejectedHellos, 1);
  assert.equal(display.confirmCode, codeBefore);
  assert.equal(display.getState().controllerActive, true);
});

test("freeze on loss and explicit resume with no jump", async () => {
  const { display, probe, echo, clock } = await connected();
  probe.sendPose({ quat: P.quatFromEuler(0, 0, 0), window: "apical", slideXmm: 0, slideYmm: 0 });
  await sleep(5);
  display.renderFrame(clock.now + 16);
  const frozenCalls = echo.calls.length;
  display.handlePeerLost("link-lost");
  assert.equal(display.frozen, true);
  assert.equal(display.state, "reconnecting");
  probe.sendPose({ quat: P.quatFromEuler(50, 0, 0), window: "apical", slideXmm: 9, slideYmm: 0 });
  await sleep(5);
  assert.equal(display.renderFrame(clock.now + 32), null);
  assert.equal(echo.calls.length, frozenCalls);
  display.resume();
  assert.equal(display.frozen, true, "freeze is kept until the first valid pose after Resume");
  assert.equal(display.getState().resumeArmed, true);
  assert.equal(display.state, "connected");
  probe.sendPose({ quat: P.quatFromEuler(50, 0, 0), window: "apical", slideXmm: 9, slideYmm: 0 });
  await sleep(5);
  assert.equal(display.frozen, false, "the first valid pose after Resume lifts the freeze");
  const out = display.renderFrame(clock.now + 48);
  assert.ok(Math.abs(out.tiltDeg) < 5, `no jump, tilt ${out.tiltDeg}`);
});

test("resume re-arms: restarted sequence and stale timestamp are accepted, then following resumes", async () => {
  const { display, probe, echo, clock } = await connected();
  probe.sendPose({ quat: P.quatFromEuler(0, 0, 0), window: "apical", slideXmm: 0, slideYmm: 0 });
  await sleep(5);
  display.renderFrame(clock.now + 16);
  display.updateClockOffset(0);
  display.handlePeerLost("link-lost");
  const acceptedBefore = display.stats.accepted;
  display.resume();
  assert.equal(display.clockOffsetMs, null, "clock offset is dropped for re-estimation");
  // A pose with a restarted sequence (seq 1) and an old timestamp, as a
  // probe that rebooted during the gap would send.
  const tag = P.sessionTagOf(P.hexToBytes(display.pairing.sessionId));
  const restarted = P.encodeFrame({ type: SYNC.TYPES.POSE, seq: 1, tMs: 0, sessionTag: tag, pose: P.clampPose({ quat: P.quatFromEuler(10, 0, 0), window: "apical", slideXmm: 1, slideYmm: 0 }, PROBE) }, display.sessionKey);
  await display.handleBytes(restarted);
  assert.equal(display.stats.accepted, acceptedBefore + 1, "first pose after Resume is accepted despite seq restart");
  assert.equal(display.frozen, false);
  const out1 = display.renderFrame(clock.now + 32);
  assert.ok(Math.abs(out1.tiltDeg) < 5, `eases from the frozen pose, tilt ${out1.tiltDeg}`);
  // Following resumes: a new pose relative to the new calibrate zero moves.
  const follow = P.encodeFrame({ type: SYNC.TYPES.POSE, seq: 2, tMs: 0, sessionTag: tag, pose: P.clampPose({ quat: P.quatFromEuler(40, 0, 0), window: "apical", slideXmm: 2, slideYmm: 0 }, PROBE) }, display.sessionKey);
  await display.handleBytes(follow);
  assert.equal(display.stats.accepted, acceptedBefore + 2);
  display.renderFrame(clock.now + 48);
  const out2 = display.renderFrame(clock.now + 64);
  assert.ok(echo.calls.length >= 2);
  void out2;
});

test("loopback faults: loss drops, duplication duplicates, delay and reorder still deliver", async () => {
  let got = 0;
  const [a, b] = SYNC.createLoopbackPair({ loss: 1, random: () => 0 });
  await a.host({}, { onBytes() {}, onPeerConnected() {}, onPeerLost() {}, onError() {} });
  await b.join({}, { onBytes() { got++; }, onPeerConnected() {}, onPeerLost() {}, onError() {} });
  assert.equal(a.send(new Uint8Array([1])), true);
  await sleep(5);
  assert.equal(got, 0);
  const [c, d] = SYNC.createLoopbackPair({ duplicate: true, reorder: true, delayMs: 1 });
  let got2 = 0;
  await c.host({}, { onBytes() {}, onPeerConnected() {}, onPeerLost() {}, onError() {} });
  await d.join({}, { onBytes() { got2++; }, onPeerConnected() {}, onPeerLost() {}, onError() {} });
  c.send(new Uint8Array([2]));
  await sleep(20);
  assert.equal(got2, 2);
});

test("probe sender: permission denied and no sensor, permission only on enableAsProbe tap", async () => {
  let asked = 0;
  const deniedEnv = {
    DeviceOrientationEvent: { requestPermission: async () => { asked++; return "denied"; } },
    addEventListener() {}, removeEventListener() {}, crypto: globalThis.crypto,
  };
  const denied = SYNC.createProbeSender({ env: deniedEnv, probeLib: PROBE, sendPose() {} });
  assert.equal(asked, 0);
  const r1 = await denied.enableAsProbe();
  assert.equal(asked, 1);
  assert.deepEqual(r1, { ok: false, reason: "permission-denied" });
  assert.equal(denied.listening, false);
  const noSensor = SYNC.createProbeSender({ env: { crypto: globalThis.crypto }, probeLib: PROBE, sendPose() {} });
  assert.deepEqual(await noSensor.enableAsProbe(), { ok: false, reason: "no-sensor" });
});

test("probe sender: granted permission maps DeviceOrientation through KARDIA_PROBE gyro mapping", async () => {
  let handler = null;
  const sent = [];
  const env = {
    DeviceOrientationEvent: { requestPermission: async () => "granted" },
    addEventListener(name, fn) { if (name === "deviceorientation") handler = fn; },
    removeEventListener() {}, crypto: globalThis.crypto,
  };
  const sender = SYNC.createProbeSender({ env, probeLib: PROBE, sendPose: (pose, st) => sent.push({ pose, st }) });
  const r = await sender.enableAsProbe();
  assert.equal(r.ok, true);
  assert.ok(handler);
  handler({ alpha: 0, beta: 0, gamma: 0, timeStamp: 1000 });
  handler({ alpha: 0, beta: 20, gamma: 0, timeStamp: 1016 });
  assert.ok(sent.length >= 2);
  assert.ok(sent[1].st.tiltDeg > 0);
  sender.disable();
});

test("probe sender handleOrientation uses calibration: first sample is the zero pose", () => {
  const sent = [];
  const sender = SYNC.createProbeSender({ env: {}, probeLib: PROBE, sendPose: (p, st) => sent.push(st) });
  sender.handleOrientation({ alpha: 10, beta: 30, gamma: 5 });
  sender.handleOrientation({ alpha: 10, beta: 50, gamma: 5 });
  assert.ok(sent[1].tiltDeg > sent[0].tiltDeg);
});

test("idle expiry wipes the session key after 30 minutes", async () => {
  const { display, clock } = await connected();
  assert.ok(display.sessionKey);
  clock.now += SYNC.SESSION_IDLE_MS + 1;
  // lastActivity was at start; tick uses the node clock.
  const res = display.tick(clock.now);
  assert.equal(res.expired, true);
  assert.equal(display.sessionKey, null);
  assert.equal(display.state, "disconnected");
});

test("existing touch probe controls and the KardiQ X gate are untouched", () => {
  const probe = PROBE.create({});
  assert.equal(typeof probe.bindTouchSurface, "function");
  assert.equal(typeof probe.bindDragControl, "function");
  assert.equal(typeof probe.applyGyroSample, "function");
  probe.setState({ tiltDeg: 999 });
  assert.ok(probe.getState().tiltDeg <= 80);
  const kardiaSrc = readFileSync(new URL("../kardia.js", import.meta.url), "utf8");
  assert.match(kardiaSrc, /echoLab/);
  assert.match(kardiaSrc, /setProbeState/);
  const kardioxSrc = readFileSync(new URL("../kardiox.js", import.meta.url), "utf8");
  assert.match(kardioxSrc, /SMD_XACCESS\.gate\("kardiox"/);
  const syncSrc = readFileSync(new URL("../kardia-sync.js", import.meta.url), "utf8");
  assert.ok(!syncSrc.includes("SMD_XACCESS"), "SyncProbe must not touch the KardiQ X gate");
  assert.ok(!/—|–/.test(syncSrc.split("\n").filter((l) => l.includes("Connection lost")).join("")), "no dash characters in user text");
});
