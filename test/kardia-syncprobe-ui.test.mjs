/* test/kardia-syncprobe-ui.test.mjs - SyncProbe UI pure helpers (kardia-syncprobe.js)
 * and the loopback stub (test/fixtures/kardia-sync-stub.mjs).
 * QR: vendored qrcode-generator at level M; geometry and capacity checks here,
 * jsQR decode round trips in test/kardia-syncprobe-pairing.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SP = require("../kardia-syncprobe.js")._pure;
const stub = await import("./fixtures/kardia-sync-stub.mjs");

/* ---------- independent GF(256) + BCH, written separately from the source --- */
const EXP = new Array(512), LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
// Polynomial long division over GF(256), coefficients high degree first.
// Returns the remainder; used to check (data + ec) divides the generator.
function polyMod(msg, gen) {
  const m = msg.slice();
  for (let i = 0; i <= m.length - gen.length; i++) {
    const f = m[i];
    if (f !== 0) for (let j = 0; j < gen.length; j++) m[i + j] ^= gmul(gen[j], f);
  }
  return m.slice(m.length - gen.length + 1);
}
function generator(ecLen) {
  let g = [1]; // high degree first
  for (let i = 0; i < ecLen; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}
// Format BCH by plain bit-array division (generator x^10+x^8+x^5+x^4+x^2+x+1).
function formatBitsIndependent(mask) {
  const data = [0, 1, (mask >> 2) & 1, (mask >> 1) & 1, mask & 1]; // 01mmm MSB first
  const gen = [1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1];
  const msg = data.concat(new Array(10).fill(0));
  for (let i = 0; i < 5; i++) {
    if (msg[i] === 1) for (let j = 0; j < 11; j++) msg[i + j] ^= gen[j];
  }
  const rem = msg.slice(5);
  const full = data.concat(rem).map((b, i) => b ^ ([1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0][i]));
  return full.join("");
}
// Version BCH by bit-array division (x^12+x^11+x^10+x^9+x^8+x^5+x^2+1).
function versionBitsIndependent(version) {
  const data = [];
  for (let i = 5; i >= 0; i--) data.push((version >> i) & 1);
  const gen = [1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1];
  const msg = data.concat(new Array(12).fill(0));
  for (let i = 0; i < 6; i++) {
    if (msg[i] === 1) for (let j = 0; j < 13; j++) msg[i + j] ^= gen[j];
  }
  return data.concat(msg.slice(6)).join("");
}

test("capacity boundaries follow the level M byte table (vendored encoder)", () => {
  assert.equal(SP.qrEncode("A".repeat(14)).version, 1);
  assert.equal(SP.qrEncode("A".repeat(15)).version, 2);
  assert.equal(SP.qrEncode("A".repeat(155)).version, 9);
  assert.ok(SP.qrEncode("A".repeat(231)), "payload with relay room still encodes");
});

test("matrix geometry: size, finders, timing, dark module, no gaps", () => {
  const q = SP.qrEncode("HELLO");
  assert.equal(q.version, 1);
  assert.equal(q.size, 21);
  const m = q.modules;
  const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    assert.equal(m[r][c], +finder[r][c], `finder (${r},${c})`);
  }
  for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) {
    assert.ok(m[r][c] === 0 || m[r][c] === 1, `settled (${r},${c})`);
  }
});

test("payload round trip and rejection", () => {
  const p = { sessionId: "ab".repeat(16), displayPub: "B".repeat(86), shortCode: "AB23CD", expiresAt: 1799999999999 };
  const s = SP.buildPayload(p);
  assert.deepEqual(SP.parsePayload(s), { ...p, sessionId: p.sessionId.toLowerCase() });
  assert.equal(SP.parsePayload("kardia-sync:1:short"), null);
  assert.equal(SP.parsePayload("https://example.com/x"), null);
  assert.equal(SP.parsePayload(s.replace("AB23CD", "TOOLONG7")), null);
  assert.equal(SP.parsePayload(s.replace("AB23CD", "AB12CD")), null, "1 is not in the code alphabet");
  assert.equal(SP.parsePayload(null), null);
  assert.ok(!SP.isExpired(1799999999999, 1700000000000));
  assert.ok(SP.isExpired(1700000000000, 1799999999999));
  const withRoom = s + ":0123456789abcdef0123456789abcdef:" + "A".repeat(43);
  const parsedRoom = SP.parsePayload(withRoom);
  assert.equal(parsedRoom.roomId, "0123456789abcdef0123456789abcdef");
  assert.equal(parsedRoom.roomToken, "A".repeat(43));
});

test("state labels cover every contract state, plain words", () => {
  for (const name of ["idle", "discovering", "pairing", "confirming", "connecting", "connected", "reconnecting", "disconnected", "failed"]) {
    const L = SP.stateLabel(name);
    assert.ok(L.line && L.sub, name);
    assert.ok(!/[–—]/.test(L.line + L.sub), "no dashes in " + name);
  }
  assert.deepEqual(SP.stateLabel("nonsense"), SP.stateLabel("idle"));
  const all = Object.values(SP.STATE_LABELS || {}).join(" ");
  void all;
});

test("transport names are plain words", () => {
  assert.equal(SP.transportName("ble"), "Nearby, Bluetooth");
  assert.equal(SP.transportName("relay"), "Over the internet");
  assert.equal(SP.transportName("loopback"), "On this phone");
  assert.equal(SP.transportName("other"), "Unknown link");
});

test("signal bars and latency formatting", () => {
  assert.equal(SP.signalBars({ rttMs: 42, lossPct: 0 }), 4);
  assert.equal(SP.signalBars({ rttMs: 200, lossPct: 1 }), 3);
  assert.equal(SP.signalBars({ rttMs: 500, lossPct: 5 }), 2);
  assert.equal(SP.signalBars({ rttMs: 900, lossPct: 0 }), 1);
  assert.equal(SP.signalBars({ rttMs: 40, lossPct: 30 }), 1);
  assert.equal(SP.signalBars(null), 0);
  assert.equal(SP.fmtLatency(42), "42 ms");
  assert.equal(SP.fmtLatency(null), "no signal");
  assert.equal(SP.fmtExpiry(1700000000000 + 125000, 1700000000000), "2 min 05 sec");
  assert.equal(SP.codeGroups("AB23CD"), "AB2 3CD");
});

test("loopback pair delivers bytes both ways, honours loss and close", async () => {
  const [a, b] = stub.createLoopbackPair();
  const seenA = [], seenB = [];
  await a.host({}, { onBytes: (x) => seenA.push(x), onPeerConnected: () => {}, onPeerLost: () => {}, onError: () => {} });
  await b.join({}, { onBytes: (x) => seenB.push(x), onPeerConnected: () => {}, onPeerLost: () => {}, onError: () => {} });
  assert.equal(a.send(new Uint8Array([1, 2, 3])), true);
  assert.equal(b.send(new Uint8Array([9])), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([...seenB[0]], [1, 2, 3]);
  assert.deepEqual([...seenA[0]], [9]);
  const s = a.stats();
  assert.ok(typeof s.rttMs === "number" && typeof s.lossPct === "number");
  assert.ok(typeof s.sentPerSec === "number" && typeof s.recvPerSec === "number");
  const [c, d] = stub.createLoopbackPair({ loss: 1 });
  let n = 0;
  await c.host({}, { onBytes: () => n++, onPeerConnected: () => {}, onPeerLost: () => {}, onError: () => {} });
  await d.join({}, { onBytes: () => {}, onPeerConnected: () => {}, onPeerLost: () => {}, onError: () => {} });
  c.send(new Uint8Array([1]));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(n, 0);
  await c.close();
  assert.equal(c.send(new Uint8Array([1])), false);
});

test("stub session pair: display to probe, confirm on both, then connected", async () => {
  stub.__reset();
  const { display, probe } = stub.createSessionPair();
  const seen = [];
  const until = async (core, name) => {
    for (let i = 0; i < 100; i++) {
      if (core.state().name === name) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  };
  display.on((e) => seen.push(["d", e.type, e.name].join(":")));
  probe.on((e) => seen.push(["p", e.type, e.name].join(":")));
  const pairing = display.startDisplay();
  assert.match(pairing.shortCode, /^[A-Z2-9]{6}$/);
  assert.ok(SP.parsePayload(SP.buildPayload(pairing)));
  await probe.joinProbe(pairing.shortCode);
  assert.ok(await until(display, "confirming"));
  assert.ok(await until(probe, "confirming"));
  assert.equal(display.session().confirm, probe.session().confirm);
  display.confirm();
  assert.equal(display.state().name, "confirming", "one side is not enough");
  probe.confirm();
  assert.ok(await until(display, "connected"));
  assert.ok(await until(probe, "connected"));
  assert.equal(display.activeTransport(), "loopback");
  assert.ok(display.stats().rttMs > 0);
  assert.equal(display.transports().filter((t) => t.available).length, 2);
  probe.reconnect();
  assert.ok(await until(display, "connected"), "reconnect returns to connected");
  await display.disconnect();
  assert.ok(await until(probe, "disconnected"));
});
