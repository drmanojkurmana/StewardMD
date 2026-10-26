/* test/kardia-syncprobe-pairing-errors.test.mjs - every SyncProbe host and
 * join failure maps to a specific message and one next action; the role
 * sheet buttons and backdrop meet the size and dimming contract; Bluetooth
 * pairing needs no sign-in; a signed-in display shows QR and code fast. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/* Sign-in opener seam, set before the UI module loads. */
let signInMode = null;
globalThis.SMD_EMAIL_AUTH = { openEmail: (mode) => { signInMode = mode; } };
const SP = require("../kardia-syncprobe.js")._pure;
const SYNC = require("../kardia-sync.js");

test("failure messages: every reason is specific with one next action", () => {
  const cases = [
    [{ reason: "sign-in-required" }, /signed out/, /Sign in to pair over the internet/, "sign-in", "Sign in"],
    [{ message: "Relay session creation failed (401): sign-in required" }, /signed out/, /Sign in to pair over the internet/, "sign-in", "Sign in"],
    [{ reason: "offline" }, /No internet and no Bluetooth/, /Turn on Bluetooth or connect to the internet/, "retry", "Try again"],
    [{ reason: "no-transport" }, /No internet and no Bluetooth/, /./, "retry", "Try again"],
    [{ reason: "relay-unreachable" }, /could not reach the pairing service/, /try again/i, "retry", "Try again"],
    [{ message: "Failed to fetch" }, /could not reach the pairing service/, /try again/i, "retry", "Try again"],
    [{ message: "WebSocket connection error" }, /could not reach the pairing service/, /try again/i, "retry", "Try again"],
    [{ reason: "bluetooth-unavailable" }, /Bluetooth is not available/, /Scan the QR code/, "scan", "Scan the QR code"],
    [{ message: "Bluetooth pairing is only available in the app." }, /Bluetooth is not available/, /./, "scan", "Scan the QR code"],
    [{ reason: "bluetooth-off" }, /Bluetooth is off/, /Turn Bluetooth on/, "settings", "Open Settings"],
    [{ reason: "bluetooth-permission" }, /Bluetooth permission is off/, /Allow Bluetooth in Settings/, "settings", "Open Settings"],
    [{ reason: "expired" }, /expired/, /fresh code/, "scan", "Scan the fresh code"],
    [{ reason: "busy" }, /already training/, /./, "retry", "Try again"],
    [{ reason: "not-found" }, /No display found/, /./, "scan", "Scan the QR code instead"],
    [{ reason: "rate-limited" }, /Too many code tries/, /Wait a minute/, "retry", "Try again"],
    [{ reason: "version-mismatch" }, /different app versions/, /Update both phones/, "retry", "Try again"],
    [{ reason: "bad-code" }, /does not look right/, /Check the display phone/, "retry", "Check the code"],
  ];
  for (const [err, re, re2, action, label] of cases) {
    const info = SP.mapReason(err);
    assert.match(info.message, re, JSON.stringify(err));
    assert.match(info.message, re2, JSON.stringify(err));
    assert.equal(info.action, action, JSON.stringify(err));
    assert.equal(info.actionLabel, label, JSON.stringify(err));
    assert.ok(!/Something went wrong/.test(info.message), "never generic: " + JSON.stringify(err));
    assert.ok(!/[–—]/.test(info.message), "no dashes");
  }
  const unknown = SP.mapReason({ message: "weird failure 123" });
  assert.ok(!/Something went wrong/.test(unknown.message));
});

test("core reason codes: relay, offline, bluetooth and sign-in stay distinct", () => {
  const R = SYNC._pure.transportErrorReason;
  assert.equal(R(new Error("Relay session creation failed (401): x")), "sign-in-required");
  assert.equal(R(new Error("Relay session creation failed (500): x")), "relay-unreachable");
  assert.equal(R(new Error("Failed to fetch")), "relay-unreachable");
  assert.equal(R(new Error("WebSocket connection error")), "relay-unreachable");
  assert.equal(R(new Error("Internet connection required")), "offline");
  assert.equal(R(new Error("Bluetooth pairing is only available in the app.")), "bluetooth-unavailable");
  assert.equal(R(new Error("Sign-in required")), "sign-in-required");
  const tagged = new Error("WebSocket connection error"); tagged.reason = "relay-unreachable";
  assert.equal(R(tagged), "relay-unreachable", "typed reason wins over message text");
});

test("sign-in action opens the app sign-in sheet in sign-in mode", () => {
  signInMode = null;
  assert.equal(SP.openSignIn(), true);
  assert.equal(signInMode, "signin");
});

test("role sheet contract: 17px labels, 50px targets, primary fill, 40 percent dim", () => {
  const css = readFileSync("kardia-syncprobe.css", "utf8");
  assert.match(css, /\.krd-sp-sheet \.sp-btn \{[^}]*font-size: 17px/);
  assert.match(css, /\.krd-sp-sheet \.sp-btn \{[^}]*min-height: 50px/);
  assert.match(css, /\.krd-sp-sheet \.sp-btn\.pri \{ background: var\(--sp-pri\); color: var\(--sp-on-pri\)/);
  assert.match(css, /\.krd-sp-scrim \{[^}]*background: rgba\(0, 0, 0, 0\.4\)/);
  assert.match(css, /\.krd-sp \{[^}]*background: transparent/);
  const ui = readFileSync("kardia-syncprobe.js", "utf8");
  assert.match(ui, /class="sp-btn pri sp-wide" data-act="sp-display">Pair a probe</);
  assert.ok(!ui.includes('setStateLine("failed")'), "no generic failed line left");
});

function stubTransport(id, kind, caps, hostImpl) {
  return {
    id, kind,
    capabilities: async () => caps,
    host: hostImpl || (async () => {}),
    join: async () => {},
    send: () => true,
    close: async () => {},
    stats: () => ({ rttMs: 5, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: 1 }),
  };
}
const signedOutCaps = { available: false, reason: "Sign-in required", canAdvertise: false, canScan: false, needsInternet: true, maxPayload: 128, platform: "web" };
const noBleCaps = { available: false, reason: "Bluetooth pairing is only available in the app.", canAdvertise: false, canScan: false, needsInternet: false, maxPayload: 20, platform: "web" };

test("facade host failure: signed out surfaces sign-in-required, not a generic error", async () => {
  SYNC.registerTransport(stubTransport("relay-signedout", "relay", signedOutCaps));
  SYNC.registerTransport(stubTransport("ble-absent", "direct", noBleCaps));
  await assert.rejects(() => SYNC.startDisplay(), (e) => e.reason === "sign-in-required");
  await SYNC.disconnect();
});

test("facade host failure: relay unreachable surfaces relay-unreachable with its raw message kept", async () => {
  const fail = new Error("Relay session creation failed (500): boom");
  fail.reason = "relay-unreachable";
  SYNC.registerTransport(stubTransport("relay-down", "relay",
    { available: true, canAdvertise: true, canScan: true, needsInternet: true, maxPayload: 128, platform: "web" },
    async () => { throw fail; }));
  await assert.rejects(() => SYNC.startDisplay(), (e) => e.reason === "relay-unreachable");
  assert.match(SYNC.lastError(), /Relay session creation failed/);
  await SYNC.disconnect();
});

test("facade host: Bluetooth present pairs with no sign-in, QR and code ready within 2s", async () => {
  SYNC.registerTransport(stubTransport("ble-native", "direct",
    { available: true, canAdvertise: true, canScan: true, needsInternet: false, maxPayload: 182, platform: "ios" }));
  const t0 = Date.now();
  const pairing = await SYNC.startDisplay();
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, "pairing ready in " + elapsed + "ms");
  assert.match(pairing.shortCode, /^[A-Z2-9]{6}$/, "6 character code shown");
  assert.ok(pairing.payload.startsWith("kardia-sync:1:"), "QR payload ready");
  assert.ok(SYNC.parsePairingPayload(pairing.payload), "QR payload parses for the probe");
  assert.equal(SYNC.session().shortCode, pairing.shortCode);
  await SYNC.disconnect();
});
