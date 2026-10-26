/* test/kardia-syncprobe-probelab.test.mjs - SyncProbe drives the Probe Lab.
 * Two parts: (1) a headless two-node loopback run (display node and probe
 * node over a real loopback pair): pair, confirm on both, the phone moves,
 * and the resulting pose drives a fake Probe Lab frame (rotation, fan, rock
 * and depth ranges fire input and change; slide fires a grip pointer drag).
 * (2) A mocked relay anonymous run: the real worker core directory resolves
 * a typed code with no sign-in, and the real relay client carries it with
 * no Authorization header.
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/kardia-syncprobe-probelab.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SYNC = require("../kardia-sync.js");
const PROBE = require("../kardia-sim-probe.js");
const SP = require("../kardia-syncprobe.js")._pure;
const Core = await import("../kardia-sync-worker/src/core.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeRange(min, max, value) {
  return {
    min: String(min), max: String(max), value: String(value), events: [],
    dispatchEvent(e) { this.events.push(e.type); return true; },
  };
}
function fakeProbeLabDoc() {
  const ranges = {
    rotation: fakeRange(-180, 180, 0),
    fan: fakeRange(-30, 30, 0),
    rock: fakeRange(-30, 30, 0),
    depth: fakeRange(8, 30, 18),
  };
  const sceneEvents = [];
  const scene = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    dispatchEvent(e) { sceneEvents.push(e.type + ":" + Math.round(e.clientX) + "," + Math.round(e.clientY)); return true; },
  };
  const byId = { ...ranges, scene };
  return { ranges, sceneEvents, doc: { getElementById: (id) => byId[id] || null, defaultView: globalThis } };
}

test("loopback two-node run: pair, confirm, phone moves, Probe Lab sliders change", async () => {
  const display = SYNC.createDisplay({ probeLib: PROBE });
  const pair = SYNC.createLoopbackPair({ idA: "loopback-pl-display", idB: "loopback-pl-probe" });
  const pairing = await display.createPairing();
  await display.hostWith(pair[0]);
  const probe = SYNC.createProbe({ probeLib: PROBE });
  await probe.joinPairing(pairing.payload, pair[1]);
  await sleep(30);
  assert.equal(display.state, "confirming");
  assert.equal(display.confirmCode, probe.confirmCode, "4 digit match number agrees on both phones");
  display.confirm(); probe.confirm();
  await sleep(20);
  assert.equal(display.state, "connected");
  assert.equal(probe.state, "connected");

  // The phone moves: first pose calibrates the display zero, the second
  // is the move itself, plus a depth step, as probePatch sends.
  probe.sendProbeState({ window: "parasternal", rotationDeg: 0, tiltDeg: 0, rockDeg: 0, position: { x: 0, y: 0 } });
  await sleep(40);
  display.renderFrame();
  probe.sendProbeState({ window: "parasternal", rotationDeg: 25, tiltDeg: 10, rockDeg: 5, position: { x: 6, y: 2 } });
  probe.sendControl(SYNC.CONTROLS.DEPTH, 210);
  await sleep(60);
  const out = display.renderFrame();
  assert.ok(out, "display rendered the phone pose");
  assert.equal(out.depthCm, 21);

  // That pose drives the Probe Lab frame ranges and grip.
  const fake = fakeProbeLabDoc();
  const prevDoc = globalThis.document;
  globalThis.document = { getElementById: (id) => (id === "krdProbeFrame" ? { contentDocument: fake.doc } : null) };
  try {
    const pose = { rotationDeg: out.rotationDeg, tiltDeg: out.tiltDeg, rockDeg: out.rockDeg, depthCm: out.depthCm, slideX: out.position.x, slideY: out.position.y };
    assert.equal(SP.driveProbeLab(pose), true);
    assert.ok(Math.abs(parseFloat(fake.ranges.rotation.value) - out.rotationDeg) < 0.6, "rotation slider follows: " + fake.ranges.rotation.value);
    assert.ok(Math.abs(parseFloat(fake.ranges.fan.value) - out.tiltDeg) < 0.6, "fan slider follows: " + fake.ranges.fan.value);
    assert.ok(Math.abs(parseFloat(fake.ranges.rock.value) - out.rockDeg) < 0.6, "rock slider follows: " + fake.ranges.rock.value);
    assert.equal(parseFloat(fake.ranges.depth.value), 21, "depth slider follows");
    for (const id of ["rotation", "fan", "rock", "depth"]) {
      assert.deepEqual(fake.ranges[id].events, ["input", "change"], id + " fired input and change as a user would");
    }
    // A second, moved pose drags the grip by the slide delta.
    SP.driveProbeLab({ ...pose, slideX: out.position.x + 5, slideY: out.position.y });
    assert.ok(fake.sceneEvents.some((e) => e.startsWith("pointerdown:")), "grip drag starts: " + fake.sceneEvents.join(" "));
    assert.ok(fake.sceneEvents.some((e) => e.startsWith("pointermove:")), "grip drag moves");
    assert.ok(fake.sceneEvents.some((e) => e.startsWith("pointerup:")), "grip drag ends");
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  }
});

test("mocked relay anonymous run: worker core resolves a typed code with no sign-in", () => {
  const directory = new Core.CodeDirectory();
  const limiter = new Core.LookupRateLimiter();
  const roomId = "a".repeat(32);
  const roomToken = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ab";
  const reg = directory.register({
    code: "KARD2X", roomId, roomToken,
    sessionId: "b".repeat(32), displayPub: "B" + "A".repeat(86),
    now: 100000, expiresAt: 100000 + Core.CODE_TTL_MS,
  });
  assert.equal(reg.ok, true);
  // No uid at all: the anonymous path keys the limit by IP.
  const hit = Core.handleCodeLookup({ code: "kard2x", uid: null, ip: "203.0.113.7", now: 100001 }, { directory, limiter });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.roomId, roomId);
  assert.equal(hit.body.roomToken, roomToken);
  assert.ok(!("displayUid" in hit.body), "no user identity leaks on the anonymous path");
  // Single use even anonymously.
  const again = Core.handleCodeLookup({ code: "KARD2X", uid: null, ip: "203.0.113.7", now: 100002 }, { directory, limiter });
  assert.equal(again.status, 404);
});

test("Echo Lab bar and touch probe contract in source", async () => {
  const { readFileSync } = await import("node:fs");
  const kardia = readFileSync("kardia.js", "utf8");
  assert.ok(kardia.includes("Use a phone as the probe"), "SyncProbe button on the Echo Lab bar above the Probe Lab");
  assert.ok(kardia.includes('class="krd-probe-bar"'), "bar sits above the frame");
  assert.ok(kardia.includes('id="krdSyncPill"'), "connection pill on the bar");
  const kardiaCss = readFileSync("kardia.css", "utf8");
  assert.match(kardiaCss, /\.krd-probe-syncbtn \{[^}]*min-height: 48px/, "button is at least 44pt");
  const ui = readFileSync("kardia-syncprobe.js", "utf8");
  assert.ok(ui.includes("marker towards the patient"), "Calibrate step wording");
  assert.ok(ui.includes("tap Calibrate"), "Calibrate step action");
  assert.ok(ui.includes('id="krdSpPad"'), "large touch pad");
  assert.ok(ui.includes('id="krdSpRock"'), "rock slider");
  assert.ok(ui.includes("data-spdepth"), "depth buttons");
  assert.ok(!ui.includes("Sign in to pair"), "no sign-in block on the relay path");
  assert.ok(!/[—–]/.test(ui), "no em or en dashes in app text");
});
