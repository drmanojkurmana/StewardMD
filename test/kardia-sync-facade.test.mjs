/* test/kardia-sync-facade.test.mjs - the KARDIA_SYNC facade the UI calls.
 * One authoritative contract: the facade in kardia-sync.js over a real core
 * node, exercised against a real probe node over a real loopback pair. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SYNC = require("../kardia-sync.js");
const PROBE = require("../kardia-sim-probe.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FACADE_METHODS = ["state", "on", "startDisplay", "joinProbe", "confirm", "disconnect", "reconnect", "recenter", "setPaused", "calibrate", "probePatch", "stats", "transports", "activeTransport", "session", "lastError"];

test("facade exposes exactly the surface the UI header lists, plus the core registry", () => {
  for (const m of FACADE_METHODS) assert.equal(typeof SYNC[m], "function", m);
  assert.equal(typeof SYNC.registerTransport, "function");
  assert.equal(typeof SYNC.createLoopbackPair, "function");
  assert.equal(SYNC.role, null, "no role before a session starts");
  assert.deepEqual(SYNC.state(), { name: "idle", confirm: null, reason: null, hint: null });
  assert.equal(SYNC.session(), null);
  assert.equal(SYNC.activeTransport(), null);
  assert.equal(SYNC.lastError(), null);
  assert.ok(Array.isArray(SYNC.transports()));
});

test("facade display session: pairing, confirm on both, pose reaches Echo Lab, freeze and resume", async () => {
  const echoCalls = [];
  globalThis.KARDIA_PROBE = PROBE;
  globalThis.KARDIA = { _kardia: { echoLab: { setProbeState(s) { echoCalls.push(JSON.parse(JSON.stringify(s))); return s; }, getProbeState() { return echoCalls[echoCalls.length - 1] || null; } } } };
  try {
    const pair = SYNC.createLoopbackPair({ idA: "loopback", idB: "loopback-b" });
    SYNC.registerTransport(pair[0]);
    const events = [];
    const unsub = SYNC.on((e) => events.push(e));
    const pairing = await SYNC.startDisplay();
    assert.match(pairing.shortCode, /^[A-Z2-9]{6}$/);
    assert.match(pairing.sessionId, /^[0-9a-f]{32}$/);
    assert.ok(pairing.payload.startsWith("kardia-sync:1:"));
    assert.equal(SYNC.role, "display");
    assert.equal(SYNC.session().shortCode, pairing.shortCode);

    const probe = SYNC.createProbe({ probeLib: PROBE });
    await probe.joinPairing(pairing.payload, pair[1]);
    await sleep(30);
    assert.equal(SYNC.state().name, "confirming");
    assert.equal(SYNC.state().confirm, probe.confirmCode);
    assert.equal(SYNC.session().confirm, probe.confirmCode);
    SYNC.confirm();
    assert.notEqual(SYNC.state().name, "connected", "one side confirming is not enough");
    probe.confirm();
    await sleep(20);
    assert.equal(SYNC.state().name, "connected");
    assert.equal(probe.state, "connected");
    assert.equal(SYNC.activeTransport(), "loopback");
    SYNC.transports();
    await sleep(20);
    assert.equal(SYNC.transports().find((t) => t.id === "loopback").available, true, "capabilities are cached after the async refresh");
    assert.equal(typeof SYNC.stats().rttMs, "number");

    probe.sendPose({ quat: SYNC._pure.quatFromEuler(20, 0, 0), window: "apical", slideXmm: 4, slideYmm: 0 });
    await sleep(120);
    assert.ok(echoCalls.length >= 1, "display render loop applied a pose to Echo Lab");
    const last = echoCalls[echoCalls.length - 1];
    assert.ok(Math.abs(last.position.x - 4) < 1.5, "slide follows within tolerance: " + JSON.stringify(last));

    // Loss freezes with no jump, then an explicit resume unfreezes.
    const frozenCount = echoCalls.length;
    const frozenState = JSON.stringify(echoCalls[frozenCount - 1]);
    await pair[1].close();
    assert.equal(SYNC.state().name, "reconnecting");
    probe.sendPose({ quat: SYNC._pure.quatFromEuler(60, 0, 0), window: "apical", slideXmm: 9, slideYmm: 0 });
    await sleep(80);
    assert.equal(echoCalls.length, frozenCount, "no pose is applied while frozen");
    await SYNC.reconnect();
    assert.equal(SYNC.state().name, "connected");
    assert.equal(JSON.stringify(echoCalls[echoCalls.length - 1]), frozenState, "resume itself does not jump");

    assert.ok(events.some((e) => e.type === "state" && e.name === "connected"));
    unsub();
    await SYNC.disconnect();
    assert.equal(SYNC.state().name, "disconnected");
    assert.equal(SYNC.session(), null);
    assert.equal(SYNC.role, null);
  } finally {
    delete globalThis.KARDIA;
    delete globalThis.KARDIA_PROBE;
  }
});

test("facade probe session: join by payload, probePatch drives the display, short code rejects cleanly", async () => {
  const echoCalls = [];
  try {
    await SYNC.disconnect();
    const display = SYNC.createDisplay({ probeLib: PROBE, echoLab: { setProbeState(s) { echoCalls.push(JSON.parse(JSON.stringify(s))); return s; } } });
    const pair = SYNC.createLoopbackPair({ idA: "loopback-display", idB: "loopback" });
    SYNC.registerTransport(pair[1]);
    const pairing = await display.createPairing();
    await display.hostWith(pair[0]);
    await assert.rejects(() => SYNC.joinProbe("ZZZZZZ"), /not-found/);
    await SYNC.joinProbe(pairing.payload);
    await sleep(30);
    assert.equal(SYNC.role, "probe");
    assert.equal(SYNC.state().name, "confirming");
    assert.equal(SYNC.session().confirm, display.confirmCode);
    SYNC.confirm(); display.confirm();
    await sleep(20);
    assert.equal(SYNC.state().name, "connected");
    assert.equal(SYNC.probePatch({ rotationDeg: 15, tiltDeg: 10 }), true);
    await sleep(30);
    const out = display.renderFrame();
    assert.ok(out, "display rendered the probePatch pose");
    assert.equal(SYNC.calibrate(), true);
    assert.equal(SYNC.recenter(), true);
    assert.equal(SYNC.setPaused(true), true);
    assert.equal(SYNC.setPaused(false), true);
    await SYNC.disconnect();
    assert.equal(SYNC.state().name, "disconnected");
  } finally {
    delete globalThis.KARDIA;
  }
});

test("facade transports include a relay adapter registered later, with no facade change", async () => {
  const relay = {
    id: "relay", kind: "relay",
    capabilities: async () => ({ available: true, canAdvertise: true, canScan: true, needsInternet: true, maxPayload: 4096, platform: "web" }),
    host: async () => {}, join: async () => {}, send: () => true, close: async () => {},
    stats: () => ({ rttMs: 30, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: null }),
  };
  SYNC.registerTransport(relay);
  await sleep(10);
  const list = SYNC.transports();
  const row = list.find((t) => t.id === "relay");
  assert.ok(row && row.kind === "relay" && row.needsInternet === true);
});

test("facade probe session: join by short code through a discover transport, confirm still required", async () => {
  await SYNC.disconnect();
  const display = SYNC.createDisplay({ probeLib: PROBE });
  const pair = SYNC.createLoopbackPair({ idA: "loopback-d2", idB: "loopback" });
  SYNC.registerTransport(pair[1]);
  const pairing = await display.createPairing();
  await display.hostWith(pair[0]);
  const stub = {
    id: "stub-discover", kind: "direct",
    capabilities: async () => ({ available: false, reason: "stub", canAdvertise: false, canScan: false, needsInternet: false, maxPayload: 0, platform: "web" }),
    host: async () => {}, join: async () => {}, send: () => false, close: async () => {},
    stats: () => ({ rttMs: 0, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: null }),
    discover: async (code) => (String(code).toUpperCase() === pairing.shortCode ? { payload: pairing.payload } : null),
  };
  SYNC.registerTransport(stub);
  await assert.rejects(() => SYNC.joinProbe("ZZZZZZ"), /not-found/);
  await SYNC.joinProbe(pairing.shortCode.toLowerCase());
  await sleep(30);
  assert.equal(SYNC.role, "probe");
  assert.equal(SYNC.state().name, "confirming", "short code path still needs the 4 digit confirmation");
  assert.equal(SYNC.session().confirm, display.confirmCode);
  assert.equal(SYNC.session().shortCode, pairing.shortCode);
  SYNC.confirm(); display.confirm();
  await sleep(20);
  assert.equal(SYNC.state().name, "connected");
  await SYNC.disconnect();
  assert.equal(SYNC.state().name, "disconnected");
});

test("loader order: core, then guarded adapters, then the UI, at krd3", () => {
  const { readFileSync } = require("node:fs");
  const loader = readFileSync(new URL("../kardia-loader.js", import.meta.url), "utf8");
  const order = ["kardia-sync.js", "kardia-sync-ble.js", "kardia-sync-relay.js", "kardia-syncprobe.js"].map((f) => loader.indexOf('"' + f + '"'));
  assert.ok(order.every((i) => i >= 0), "all SyncProbe files are listed");
  assert.ok(order[0] < order[1] && order[1] < order[3] && order[2] < order[3], "adapters before the UI");
  assert.match(loader, /var V = "krd3"/);
  const build = readFileSync(new URL("../scripts/build-www.sh", import.meta.url), "utf8");
  assert.match(build, /for f in \*\.js/, "root glob already copies the SyncProbe files, so no build script entry is needed");
});
