/* test/kardia-sync-code-race.test.mjs - typed-code lookup race:
 * joinProbe with a 6-character code races Bluetooth discovery and the
 * relay code lookup in parallel; the first healthy result wins, the same
 * as the QR path races transports. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SYNC = require("../kardia-sync.js");
const PROBE = require("../kardia-sim-probe.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stubSeq = 0;

function baseStub(id, kind) {
  return {
    id,
    kind,
    capabilities: async () => ({
      available: false,
      reason: "lookup only",
      canAdvertise: false,
      canScan: false,
      needsInternet: kind === "relay",
      maxPayload: 0,
      platform: "web",
    }),
    host: async () => {},
    join: async () => {},
    send: () => false,
    close: async () => {},
    stats: () => ({ rttMs: 0, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: null }),
  };
}

/* Bluetooth discovery stub: resolves a pairing hit (or null) after delay. */
function makeBleLookup({ delay = 0, hit = null, fail = null } = {}) {
  const t = baseStub("ble-race-" + (++stubSeq), "direct");
  t.discover = async (code) => {
    if (delay) await sleep(delay);
    if (fail) throw fail;
    return typeof hit === "function" ? hit(code) : hit;
  };
  return t;
}

/* Relay code lookup stub: resolves join material (or rejects) after delay. */
function makeRelayLookup({ delay = 0, hit = null, fail = null, calls = null } = {}) {
  const t = baseStub("relay-race-" + (++stubSeq), "relay");
  t.resolveCode = async (code) => {
    if (calls) calls.push(code);
    if (delay) await sleep(delay);
    if (fail) throw (typeof fail === "function" ? fail(code) : fail);
    return typeof hit === "function" ? hit(code) : hit;
  };
  return t;
}

function bleHit(pairing) {
  // Real Bluetooth discovery returns session material without a room.
  return {
    sessionId: pairing.sessionId,
    displayPub: pairing.displayPub,
    shortCode: pairing.shortCode,
    expiresAt: pairing.expiresAt,
  };
}

function relayHit(pairing, roomId, roomToken) {
  return {
    sessionId: pairing.sessionId,
    displayPub: pairing.displayPub,
    shortCode: pairing.shortCode,
    expiresAt: pairing.expiresAt,
    roomId,
    roomToken,
    relay: { roomId, roomToken },
  };
}

/* Host a real display on a fresh loopback pair; returns the pairing.
 * Earlier pairs are closed so only this test's link is available: a
 * rejected lookup never joins, leaving its pair open, and an open stale
 * pair would otherwise win the join race and swallow the HELLO. */
let openPairs = [];
async function hostDisplay() {
  await SYNC.disconnect();
  for (const p of openPairs) {
    try { await p[0].close(); } catch (e) {}
    try { await p[1].close(); } catch (e) {}
  }
  openPairs = [];
  const display = SYNC.createDisplay({ probeLib: PROBE });
  const pair = SYNC.createLoopbackPair({ idA: "loopback-race-a" + (++stubSeq), idB: "loopback-race-b" + stubSeq });
  SYNC.registerTransport(pair[1]);
  openPairs.push(pair);
  const pairing = await display.createPairing();
  await display.hostWith(pair[0]);
  return { display, pairing };
}

function notFoundErr() {
  const e = new Error("No display found for that code.");
  e.reason = "not-found";
  return e;
}

/* Stubs only answer for their own display's code, like the real radio and
 * relay lookups: a stale stub from an earlier test must miss here. */
function bleHitFor(pairing) {
  return (code) => (code === pairing.shortCode ? bleHit(pairing) : null);
}

function relayHitFor(pairing, roomId, roomToken) {
  return (code) => {
    if (code !== pairing.shortCode) throw notFoundErr();
    return relayHit(pairing, roomId, roomToken);
  };
}

test("typed-code race: relay lookup wins when Bluetooth is slow", async () => {
  const { display, pairing } = await hostDisplay();
  const roomId = "cd".repeat(16);
  const relayCalls = [];
  SYNC.registerTransport(makeBleLookup({ delay: 60, hit: bleHitFor(pairing) }));
  SYNC.registerTransport(makeRelayLookup({ delay: 5, hit: relayHitFor(pairing, roomId, "R".repeat(43)), calls: relayCalls }));

  await SYNC.joinProbe(pairing.shortCode.toLowerCase());
  await sleep(40);
  assert.equal(SYNC.role, "probe");
  assert.equal(SYNC.state().name, "confirming", "relay material joins and waits for confirmation");
  assert.equal(SYNC.session().roomId, roomId, "winner is the relay lookup");
  assert.equal(SYNC.session().confirm, display.confirmCode);
  assert.deepEqual(relayCalls, [pairing.shortCode]);
  await SYNC.disconnect();
});

test("typed-code race: Bluetooth wins when the relay is slow", async () => {
  const { display, pairing } = await hostDisplay();
  SYNC.registerTransport(makeBleLookup({ delay: 5, hit: bleHitFor(pairing) }));
  SYNC.registerTransport(makeRelayLookup({ delay: 80, hit: relayHitFor(pairing, "cd".repeat(16), "R".repeat(43)) }));

  await SYNC.joinProbe(pairing.shortCode);
  await sleep(40);
  assert.equal(SYNC.state().name, "confirming");
  assert.equal(SYNC.session().roomId, undefined, "winner is Bluetooth discovery, which carries no room");
  assert.equal(SYNC.session().shortCode, pairing.shortCode);
  assert.equal(SYNC.session().confirm, display.confirmCode, "short code path still needs the 4 digit confirmation");
  await SYNC.disconnect();
});

test("typed-code race: Bluetooth wins when the relay rejects", async () => {
  const { display, pairing } = await hostDisplay();
  SYNC.registerTransport(makeBleLookup({ delay: 10, hit: bleHitFor(pairing) }));
  SYNC.registerTransport(makeRelayLookup({ fail: notFoundErr() }));

  await SYNC.joinProbe(pairing.shortCode);
  await sleep(40);
  assert.equal(SYNC.state().name, "confirming");
  assert.equal(SYNC.session().roomId, undefined);
  assert.equal(SYNC.session().confirm, display.confirmCode);
  await SYNC.disconnect();
});

test("typed-code race: all lookups failing reports not-found", async () => {
  await hostDisplay();
  SYNC.registerTransport(makeBleLookup({ hit: null }));
  SYNC.registerTransport(makeRelayLookup({ fail: notFoundErr() }));

  await assert.rejects(() => SYNC.joinProbe("ZZZZZZ"), (e) => e.reason === "not-found");
  await SYNC.disconnect();
});

test("typed-code race: relay sign-in failure surfaces when Bluetooth misses", async () => {
  await hostDisplay();
  SYNC.registerTransport(makeBleLookup({ hit: null }));
  const signedOut = new Error("Sign-in required");
  signedOut.reason = "sign-in-required";
  // Only this test's code sees the sign-in failure; other codes read as
  // not-found so this stub cannot dominate later tests' error ranking.
  SYNC.registerTransport(makeRelayLookup({ fail: (code) => (code === "KARD2X" ? signedOut : notFoundErr()) }));

  await assert.rejects(() => SYNC.joinProbe("KARD2X"), (e) => e.reason === "sign-in-required");
  await SYNC.disconnect();
});

test("typed-code race: a used code reads as not-found on retry", async () => {
  const { pairing } = await hostDisplay();
  const roomId = "ef".repeat(16);
  let uses = 0;
  SYNC.registerTransport(makeBleLookup({ hit: null }));
  SYNC.registerTransport(makeRelayLookup({
    hit: (code) => {
      if (code !== pairing.shortCode) throw notFoundErr();
      uses++;
      if (uses > 1) throw notFoundErr();
      return relayHit(pairing, roomId, "R".repeat(43));
    },
  }));

  await SYNC.joinProbe(pairing.shortCode);
  await sleep(40);
  assert.equal(SYNC.state().name, "confirming");
  assert.equal(SYNC.session().roomId, roomId);
  await SYNC.disconnect();

  await assert.rejects(() => SYNC.joinProbe(pairing.shortCode), (e) => e.reason === "not-found");
  await SYNC.disconnect();
});
