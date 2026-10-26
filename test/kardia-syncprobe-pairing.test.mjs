/* test/kardia-syncprobe-pairing.test.mjs - SyncProbe pairing fixes:
 * vendored QR decode round trip (jsQR), payload parse, auto-join helpers,
 * specific error mapping, and the parallel transport race. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SP = require("../kardia-syncprobe.js")._pure;
const SYNC = require("../kardia-sync.js");
const jsQR = require("jsqr");

function decodeQr(text) {
  const q = SP.qrEncode(text);
  assert.ok(q, "encodes: " + text.length + " chars");
  const quiet = 4, scale = 4;
  const n = q.size + quiet * 2;
  const width = n * scale, height = n * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) {
    if (q.modules[r][c] !== 1) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const px = ((r + quiet) * scale + y) * width + (c + quiet) * scale + x;
      data[px * 4] = 0; data[px * 4 + 1] = 0; data[px * 4 + 2] = 0; data[px * 4 + 3] = 255;
    }
  }
  const found = jsQR(data, width, height);
  return found && found.data;
}

function realPayload(withRoom) {
  const pub = Buffer.alloc(65, 7).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const p = { sessionId: "ab".repeat(16), displayPub: pub, shortCode: "MNPQRS", expiresAt: 1799999999999 };
  if (withRoom) { p.roomId = "cd".repeat(16); p.roomToken = "A".repeat(43); }
  return SP.buildPayload(p);
}

test("QR decode round trip: real pairing payloads, with and without relay room", () => {
  for (const withRoom of [false, true]) {
    const payload = realPayload(withRoom);
    assert.equal(decodeQr(payload), payload, "payload len " + payload.length);
    assert.ok(SP.parsePayload(payload), "payload parses");
  }
});

test("QR decode round trip: every payload length the app can produce", () => {
  const base = realPayload(false);
  const room = realPayload(true);
  const lengths = new Set([6, base.length, room.length]);
  for (let n = 1; n <= room.length; n++) lengths.add(n);
  for (const n of lengths) {
    const text = "K".repeat(n);
    assert.equal(decodeQr(text), text, "length " + n);
  }
});

test("typed code: auto-uppercase, grouping, auto-join on the 6th character", () => {
  assert.equal(SP.normalizeCodeInput("mnp qrs"), "MNPQRS");
  assert.equal(SP.normalizeCodeInput("mnpqrs7"), "MNPQRS");
  assert.equal(SP.formatCodeInput("mnpqrs"), "MNP QRS");
  assert.equal(SP.normalizeCodeInput("ab1"), "AB", "ambiguous 1 is stripped");
  assert.equal(SP.normalizeCodeInput("abcde").length, 5);
  assert.equal(SP.normalizeCodeInput("abcdef").length, 6, "6th character is the join trigger");
});

test("payload parse rejects bad codes and accepts relay room", () => {
  assert.equal(SP.parsePayload("https://example.com"), null);
  assert.equal(SP.parsePayload(realPayload(false).replace("MNPQRS", "MNPQR1")), null);
  const parsed = SP.parsePayload(realPayload(true));
  assert.equal(parsed.roomId, "cd".repeat(16));
});

test("error mapping: every failure is specific with one next action", () => {
  const cases = [
    [{ reason: "expired" }, /expired/, "scan"],
    [{ reason: "busy" }, /already training/, "retry"],
    [{ reason: "sign-in-required" }, /signed out/, "sign-in"],
    [{ message: "Relay session creation failed (401): x" }, /signed out/, "sign-in"],
    [{ reason: "not-found" }, /No display found/, "scan"],
    [{ reason: "bluetooth-off" }, /Bluetooth is off/, "settings"],
    [{ reason: "bluetooth-permission" }, /permission is off/, "settings"],
    [{ reason: "offline" }, /No internet and no Bluetooth/, "retry"],
    [{ reason: "version-mismatch" }, /different app versions/, "retry"],
  ];
  for (const [err, re, action] of cases) {
    const info = SP.mapReason(err);
    assert.match(info.message, re, JSON.stringify(err));
    assert.equal(info.action, action, JSON.stringify(err));
    assert.ok(info.actionLabel.length > 0);
    assert.ok(!/[–—]/.test(info.message), "no dashes");
  }
  const unknown = SP.mapReason({ message: "weird failure 123" });
  assert.equal(unknown.reason, "unknown");
  assert.match(unknown.message, /could not reach each other/);
});

function mockTransport(id, opts) {
  const o = opts || {};
  return {
    id, kind: o.kind || "direct",
    capabilities: async () => ({ available: true }),
    host: () => new Promise((res, rej) => setTimeout(() => (o.fail ? rej(new Error(o.fail)) : res(id)), o.delay || 0)),
    join: () => new Promise((res, rej) => setTimeout(() => (o.fail ? rej(new Error(o.fail)) : res(id)), o.delay || 0)),
    send: () => !o.sendFails,
    close: async () => {},
    stats: () => ({ rttMs: 10, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: 1 }),
  };
}

test("parallel race: fast transport wins over slow, failing one does not block", async () => {
  const slow = mockTransport("ble", { delay: 60 });
  const fast = mockTransport("relay", { delay: 5, kind: "relay" });
  const raced = SYNC.createRacedTransport([slow, fast]);
  await raced.host({}, {});
  assert.equal(raced.activeId(), "relay");
  assert.deepEqual(raced.backupIds(), ["ble"], "the other transport is kept as backup");
});

test("parallel race: one failing, one working still connects", async () => {
  const raced = SYNC.createRacedTransport([
    mockTransport("relay", { fail: "Sign-in required", kind: "relay" }),
    mockTransport("ble", { delay: 10 }),
  ]);
  await raced.join({}, {});
  assert.equal(raced.activeId(), "ble");
});

test("parallel race: all failing reports the most specific reason", async () => {
  const raced = SYNC.createRacedTransport([
    mockTransport("ble", { fail: "Bluetooth is off" }),
    mockTransport("relay", { fail: "Sign-in required", kind: "relay" }),
  ]);
  await assert.rejects(() => raced.host({}, {}), (e) => e.reason === "sign-in-required");
});

test("parallel race: send falls back to the backup transport", async () => {
  const bad = mockTransport("ble", { delay: 1 }); bad.send = () => false;
  const good = mockTransport("relay", { delay: 30, kind: "relay" }); let sentOn = null;
  good.send = () => { sentOn = "relay"; return true; };
  const raced = SYNC.createRacedTransport([bad, good]);
  await raced.host({}, {});
  assert.equal(raced.activeId(), "ble");
  assert.equal(raced.send(new Uint8Array([1, 2])), true);
  assert.equal(sentOn, "relay");
  assert.equal(raced.activeId(), "relay");
});

test("core error reasons map relay and bluetooth failures", () => {
  assert.equal(SYNC._pure.transportErrorReason(new Error("Sign-in required")), "sign-in-required");
  assert.equal(SYNC._pure.transportErrorReason(new Error("Bluetooth is off")), "bluetooth-off");
  assert.equal(SYNC._pure.transportErrorReason({ reason: "expired" }), "expired");
});

test("BLE nearby: lists displays and joins one by hash with no typing", async () => {
  const BLE = require("../kardia-sync-ble.js");
  const pub = Buffer.alloc(65, 4).toString("base64");
  const plugin = {
    getCapabilities: async () => ({ available: true, canAdvertise: true, canScan: true, maxPayload: 182, platform: "ios" }),
    scanNearby: async () => ({ devices: [{ name: "KS-AABBCCDD", codeHashHex: "aabbccdd", rssi: -42 }] }),
    discover: async (args) => {
      assert.equal(args.codeHashHex, "aabbccdd");
      return { sessionId: "ab".repeat(16), displayPub: pub, protocolVersion: 1 };
    },
  };
  const t = BLE.createTransport(plugin);
  const nearby = await t.discoverNearby();
  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].shortLabel, "AABB");
  const pairing = await t.discoverByHash(nearby[0].codeHashHex);
  assert.equal(pairing.sessionId, "ab".repeat(16));
  assert.equal(pairing.codeHashHex, "aabbccdd");
});
