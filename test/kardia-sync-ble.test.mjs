// kardia-sync-ble.js: BLE transport adapter over a mocked KardiaBle plugin.
// Covers capabilities (native and web), host/join wiring including the short
// code hash, frame send gating by MTU payload, inbound bytes, peer events,
// stats, close, and registration with KARDIA_SYNC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const SRC = readFileSync(new URL("../kardia-sync-ble.js", import.meta.url), "utf8");

function makePlugin(caps, opts = {}) {
  const listeners = {};
  const calls = { host: [], join: [], discover: [], send: [], close: [] };
  const plugin = {
    calls,
    listeners,
    getCapabilities: () => Promise.resolve(caps),
    host: (opts2) => { calls.host.push(opts2); return Promise.resolve({ started: true }); },
    join: (opts2) => { calls.join.push(opts2); return Promise.resolve({ started: true }); },
    discover: (args) => {
      calls.discover.push(args);
      if (typeof opts.onDiscover === "function") return opts.onDiscover(args);
      return Promise.resolve(null);
    },
    send: (opts2) => { calls.send.push(opts2); return Promise.resolve({ sent: true }); },
    close: (opts2) => { calls.close.push(opts2); return Promise.resolve({ closed: true }); },
    addListener: (name, fn) => { listeners[name] = fn; return Promise.resolve({ remove() { delete listeners[name]; } }); },
    emit: (name, ev) => { if (listeners[name]) listeners[name](ev); },
  };
  if (opts.noDiscover) delete plugin.discover;
  return plugin;
}

function loadEnv({ native = true, caps = null, onDiscover = null, noDiscover = false } = {}) {
  const registered = [];
  const plugin = makePlugin(caps || { available: true, reason: "", canAdvertise: true, canScan: true, maxPayload: 182, platform: "ios" }, { onDiscover, noDiscover });
  const windowObj = {
    crypto: webcrypto,
    KARDIA_SYNC: { registerTransport: (t) => registered.push(t) },
    addEventListener() {},
  };
  if (native) {
    windowObj.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
      isPluginAvailable: (n) => n === "KardiaBle",
      Plugins: { KardiaBle: plugin },
    };
  }
  const ctx = vm.createContext({
    window: windowObj,
    globalThis: windowObj,
    console,
    Buffer,
    TextEncoder,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Error,
    Uint8Array,
  });
  windowObj.window = windowObj;
  // The IIFE reads bare `window`; expose it as a global in the vm too.
  vm.runInContext("var window = globalThis.window;", ctx);
  vm.runInContext(SRC, ctx);
  return { window: windowObj, plugin, registered };
}

const PAIRING = {
  sessionId: "00112233445566778899aabbccddeeff",
  shortCode: "KARDIA",
  displayPub: "AAECAwQFBgc=",
  expiresAt: Date.now() + 300000,
};

test("registers a ble direct transport with KARDIA_SYNC when both exist", () => {
  const { registered } = loadEnv();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, "ble");
  assert.equal(registered[0].kind, "direct");
});

test("capabilities come from the plugin radio state", async () => {
  const { registered } = loadEnv();
  const caps = await registered[0].capabilities();
  assert.equal(caps.available, true);
  assert.equal(caps.canAdvertise, true);
  assert.equal(caps.canScan, true);
  assert.equal(caps.needsInternet, false);
  assert.equal(caps.maxPayload, 182);
  assert.equal(caps.platform, "ios");
});

test("capabilities report the plugin reason when unavailable", async () => {
  const { registered } = loadEnv({ caps: { available: false, reason: "Bluetooth is off. Turn Bluetooth on and try again.", canAdvertise: false, canScan: false, maxPayload: 20, platform: "android" } });
  const caps = await registered[0].capabilities();
  assert.equal(caps.available, false);
  assert.match(caps.reason, /Bluetooth is off/);
  assert.equal(caps.platform, "android");
});

test("web build reports available false", async () => {
  const { window } = loadEnv({ native: false });
  const t = window.KARDIA_SYNC_BLE.createTransport(null);
  const caps = await t.capabilities();
  assert.equal(caps.available, false);
  assert.equal(caps.canAdvertise, false);
  assert.equal(caps.platform, "web");
  await assert.rejects(() => t.host(PAIRING, {}), /only available in the app/);
});

test("host passes session, displayPub and the 4 byte code hash to the plugin", async () => {
  const { registered, plugin } = loadEnv();
  await registered[0].host(PAIRING, {});
  assert.equal(plugin.calls.host.length, 1);
  assert.equal(plugin.calls.host[0].sessionId, PAIRING.sessionId);
  assert.equal(plugin.calls.host[0].displayPub, PAIRING.displayPub);
  assert.match(plugin.calls.host[0].codeHashHex, /^[0-9a-f]{8}$/);
  // SHA-256("KARDIA") first 4 bytes, computed independently here.
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("KARDIA"));
  const expect = Buffer.from(new Uint8Array(digest).subarray(0, 4)).toString("hex");
  assert.equal(plugin.calls.host[0].codeHashHex, expect);
});

test("join filters by session and code hash, peerConnected carries displayPub", async () => {
  const { registered, plugin } = loadEnv();
  const seen = { connected: null };
  await registered[0].join(PAIRING, { onPeerConnected: (info) => { seen.connected = info; } });
  assert.equal(plugin.calls.join.length, 1);
  assert.equal(plugin.calls.join[0].sessionId, PAIRING.sessionId);
  plugin.emit("peerConnected", { role: "probe", displayPub: PAIRING.displayPub, protocolVersion: 1, sessionId: PAIRING.sessionId, maxPayload: 182 });
  assert.equal(seen.connected.displayPub, PAIRING.displayPub);
  assert.equal(registered[0]._isConnected(), true);
});

test("send refuses frames over the MTU payload and sends whole frames as base64", async () => {
  const { registered, plugin } = loadEnv();
  await registered[0].join(PAIRING, {});
  assert.equal(registered[0].send(new Uint8Array([1, 2, 3])), false, "not connected yet");
  plugin.emit("peerConnected", { role: "probe", maxPayload: 20 });
  const frame = new Uint8Array([1, 3, 7, 0, 0, 0, 9, 0, 0, 0]);
  assert.equal(registered[0].send(frame), true);
  assert.equal(plugin.calls.send.length, 1);
  assert.deepEqual([...Buffer.from(plugin.calls.send[0].data, "base64")], [...frame]);
  assert.equal(registered[0].send(new Uint8Array(21)), false, "over the 20 byte payload");
  assert.equal(plugin.calls.send.length, 1);
});

test("inbound bytes reach onBytes and update stats", async () => {
  const { registered, plugin } = loadEnv();
  const got = [];
  await registered[0].host(PAIRING, { onBytes: (b) => got.push([...b]) });
  plugin.emit("peerConnected", { role: "display", maxPayload: 182 });
  const frame = new Uint8Array([1, 1, 2, 0, 0, 0]);
  plugin.emit("bytesReceived", { data: Buffer.from(frame).toString("base64") });
  assert.deepEqual(got, [[...frame]]);
  const stats = registered[0].stats();
  assert.equal(stats.recvPerSec, 1);
  assert.ok(stats.lastRecvAt > 0);
  assert.equal(stats.rttMs, 0);
});

test("peerLost and bleError reach the handlers, close tears down", async () => {
  const { registered, plugin } = loadEnv();
  const seen = { lost: "", error: "" };
  await registered[0].join(PAIRING, {
    onPeerLost: (r) => { seen.lost = r; },
    onError: (e) => { seen.error = e.message; },
  });
  plugin.emit("peerConnected", { role: "probe", maxPayload: 182 });
  plugin.emit("bleError", { message: "Scan failed with code 2." });
  plugin.emit("peerLost", { reason: "The display disconnected." });
  assert.equal(seen.error, "Scan failed with code 2.");
  assert.equal(seen.lost, "The display disconnected.");
  assert.equal(registered[0]._isConnected(), false);
  await registered[0].close("done");
  assert.equal(plugin.calls.close.length, 1);
  assert.equal(registered[0].send(new Uint8Array([1])), false);
});

test("exposes the SyncProbe UUIDs", () => {
  const { window } = loadEnv();
  assert.equal(window.KARDIA_SYNC_BLE.SERVICE_UUID, "A91E0001-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
  assert.equal(window.KARDIA_SYNC_BLE.DOWN_UUID, "A91E0003-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
  assert.equal(window.KARDIA_SYNC_BLE.UP_UUID, "A91E0004-9D3C-4F5A-B2C4-1A2B3C4D5E6F");
});

// Short code discovery: the probe joins with only the 6 character code. The
// adapter hashes the code, the native plugin scans for that hash, connects,
// reads the info characteristic and returns sessionId plus displayPub.

const DISCOVER_SESSION = "00112233445566778899aabbccddeeff";

function validDisplayPubB64() {
  const raw = Buffer.alloc(65);
  raw[0] = 4;
  for (let i = 1; i < 65; i++) raw[i] = i & 0xff;
  return raw.toString("base64");
}

async function codeHashHexOf(code) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Buffer.from(new Uint8Array(digest).subarray(0, 4)).toString("hex");
}

test("discover scans by code hash and returns pairing details for a match", async () => {
  const pubB64 = validDisplayPubB64();
  const { registered, plugin } = loadEnv({
    onDiscover: () => Promise.resolve({ sessionId: DISCOVER_SESSION, displayPub: pubB64, protocolVersion: 1 }),
  });
  const found = await registered[0].discover("MNPQRS");
  assert.equal(found.sessionId, DISCOVER_SESSION);
  assert.equal(found.shortCode, "MNPQRS");
  assert.ok(found.expiresAt > Date.now(), "missing native expiry is filled in");
  assert.ok(found.payload.startsWith("kardia-sync:1:" + DISCOVER_SESSION + ":"));
  assert.match(found.displayPub, /^[A-Za-z0-9_-]+$/, "payload key is base64url");
  assert.equal(plugin.calls.discover.length, 1);
  assert.equal(plugin.calls.discover[0].codeHashHex, await codeHashHexOf("MNPQRS"));
});

test("discover rejects with a clear error when no display answers", async () => {
  const { registered, plugin } = loadEnv({
    onDiscover: () => Promise.reject(new Error("No display found for that code.")),
  });
  await assert.rejects(() => registered[0].discover("MNPQRS"), /No display found/);
  assert.equal(plugin.calls.discover.length, 1);
  assert.equal(registered[0]._discoverAttempt(), 1, "failure climbs the back-off ladder");
  assert.equal(registered[0]._discoverBackoffMs(), 4000);
});

test("discover ignores displays advertising a different code hash", async () => {
  const pubB64 = validDisplayPubB64();
  const wanted = await codeHashHexOf("MNPQRS");
  const notFound = () => {
    const e = new Error("No display found for that code.");
    e.reason = "not-found";
    return Promise.reject(e);
  };
  const { registered, plugin } = loadEnv({
    onDiscover: (args) => (args.codeHashHex === wanted
      ? Promise.resolve({ sessionId: DISCOVER_SESSION, displayPub: pubB64, protocolVersion: 1 })
      : notFound()),
  });
  const found = await registered[0].discover("MNPQRS");
  assert.equal(found.sessionId, DISCOVER_SESSION);
  await assert.rejects(() => registered[0].discover("WXYZ73"), /No display found/);
  assert.equal(plugin.calls.discover.length, 2);
  assert.notEqual(plugin.calls.discover[1].codeHashHex, wanted);
});

test("discover times out with a clear error instead of hanging", async () => {
  const { registered, plugin } = loadEnv({ onDiscover: () => new Promise(() => {}) });
  await assert.rejects(() => registered[0].discover("MNPQRS", 60), /No display found/);
  assert.equal(plugin.calls.discover.length, 1);
});

test("concurrent discover calls share one BLE scan", async () => {
  const { registered, plugin } = loadEnv({
    onDiscover: () => new Promise((res) => setTimeout(
      () => res({ sessionId: DISCOVER_SESSION, displayPub: validDisplayPubB64(), protocolVersion: 1 }), 30)),
  });
  const t = registered[0];
  const [a, b] = await Promise.all([t.discover("MNPQRS"), t.discover("MNPQRS")]);
  assert.equal(a.sessionId, DISCOVER_SESSION);
  assert.equal(b.sessionId, DISCOVER_SESSION);
  assert.equal(plugin.calls.discover.length, 1, "single scan rule");
});

test("discover rejects malformed codes without scanning", async () => {
  const { registered, plugin } = loadEnv({ onDiscover: () => Promise.resolve(null) });
  await assert.rejects(() => registered[0].discover("ABC"), /6 character code/);
  await assert.rejects(() => registered[0].discover(""), /6 character code/);
  assert.equal(plugin.calls.discover.length, 0);
});
