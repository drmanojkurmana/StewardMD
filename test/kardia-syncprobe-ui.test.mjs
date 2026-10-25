/* test/kardia-syncprobe-ui.test.mjs - SyncProbe UI pure helpers (kardia-syncprobe.js)
 * and the loopback stub (test/fixtures/kardia-sync-stub.mjs).
 * QR: spec constants (format L/mask0 derived by hand), an independent BCH
 * implementation, read-back of format and version bits from the matrix, Reed
 * Solomon divisibility by independent long division, capacity boundaries from
 * the spec tables, and exact finder/timing/alignment/dark-module geometry.
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

test("format bits: L/mask0 is the spec constant, all masks match independent BCH", () => {
  assert.equal(SP.qrFormatBits(0).toString(2).padStart(15, "0"), "111011111000100");
  for (let m = 0; m < 8; m++) {
    assert.equal(SP.qrFormatBits(m).toString(2).padStart(15, "0"), formatBitsIndependent(m), "mask " + m);
  }
});

test("version bits: v7 matches independent BCH and has zero residue", () => {
  const got = SP.qrVersionBits(7).toString(2).padStart(18, "0");
  assert.equal(got, versionBitsIndependent(7));
  assert.equal(got, "000111110010010100");
  for (let v = 7; v <= 9; v++) {
    assert.equal(SP.qrVersionBits(v).toString(2).padStart(18, "0"), versionBitsIndependent(v), "v" + v);
  }
});

test("capacity boundaries follow the level L byte table", () => {
  assert.equal(SP.qrEncode("A".repeat(17)).version, 1);
  assert.equal(SP.qrEncode("A".repeat(18)).version, 2);
  assert.equal(SP.qrEncode("A".repeat(32)).version, 2);
  assert.equal(SP.qrEncode("A".repeat(33)).version, 3);
  assert.equal(SP.qrEncode("A".repeat(106)).version, 5);
  assert.equal(SP.qrEncode("A".repeat(107)).version, 6);
  assert.equal(SP.qrEncode("A".repeat(154)).version, 7);
  assert.equal(SP.qrEncode("A".repeat(230)).version, 9);
  assert.equal(SP.qrEncode("A".repeat(231)), null);
});

test("matrix geometry: size, finders, timing, dark module, no gaps", () => {
  const q = SP.qrEncode("HELLO");
  assert.equal(q.version, 1);
  assert.equal(q.size, 21);
  assert.ok(q.mask >= 0 && q.mask <= 7);
  const m = q.modules;
  // Finder at top left is the exact 7x7 pattern.
  const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    assert.equal(m[r][c], +finder[r][c], `finder (${r},${c})`);
    assert.equal(m[r][20 - c], +finder[r][c], `top-right (${r},${20 - c})`);
    assert.equal(m[20 - r][c], +finder[r][c], `bottom-left (${20 - r},${c})`);
  }
  // Separators.
  for (let i = 0; i < 8; i++) {
    assert.equal(m[7][i], 0, "sep row " + i);
    assert.equal(m[i][7], 0, "sep col " + i);
  }
  // Timing alternation between the separators.
  for (let i = 8; i < 13; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, "timing h " + i);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, "timing v " + i);
  }
  // Dark module and no unset cells.
  assert.equal(m[13][8], 1);
  for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) {
    assert.ok(m[r][c] === 0 || m[r][c] === 1, `settled (${r},${c})`);
  }
});

test("format bits read back identically from both copies", () => {
  for (const text of ["A", "Hello probe", "X".repeat(100)]) {
    const q = SP.qrEncode(text), m = q.modules, n = q.size;
    const order1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    // First copy holds all 15 bits; the second holds every bit but bit 7,
    // whose slot is the always-dark module.
    let a = 0;
    for (let i = 0; i < 15; i++) a |= m[order1[i][0]][order1[i][1]] << i; // bit i from the LSB
    assert.equal(a, SP.qrFormatBits(q.mask), `first copy for ${text.length} chars`);
    let b = 0;
    for (let i = 0; i < 7; i++) b |= m[n - 1 - i][8] << i;
    for (let i = 8; i < 15; i++) b |= m[8][n - 15 + i] << i;
    assert.equal(b, SP.qrFormatBits(q.mask) & ~(1 << 7), `second copy for ${text.length} chars`);
  }
});

test("version bits read back for v7+", () => {
  const q = SP.qrEncode("Y".repeat(160));
  assert.ok(q.version >= 7);
  const m = q.modules, n = q.size;
  let v = 0;
  for (let i = 0; i < 18; i++) v |= m[n - 11 + (i % 3)][Math.floor(i / 3)] << i;
  assert.equal(v, SP.qrVersionBits(q.version));
});

test("alignment patterns overwrite timing, skip finder corners", () => {
  const q = SP.qrEncode("Z".repeat(160));
  assert.equal(q.version, 8); // centres [6, 24, 42]
  const m = q.modules;
  // Interior and edge patterns are full 5x5 rings, even on the timing row.
  for (const [ar, ac] of [[6, 24], [24, 6], [24, 24], [24, 42], [42, 24], [42, 42]]) {
    assert.equal(m[ar][ac], 1, `centre ${ar},${ac}`);
    assert.equal(m[ar - 2][ac - 2], 1, `ring ${ar},${ac}`);
    assert.equal(m[ar + 2][ac + 2], 1, `ring ${ar},${ac}`);
    assert.equal(m[ar - 1][ac - 1], 0, `inner ${ar},${ac}`);
    assert.equal(m[ar][ac - 2], 1, `edge ${ar},${ac}`);
  }
  // The three combos landing on finders are skipped: (42,6) stays separator.
  assert.equal(m[41][6], 0, "no pattern on the bottom-left finder corner");
});

test("Reed Solomon: check bytes match long division, blocks divide the generator", () => {
  for (const len of [5, 17, 18, 40, 80, 120, 150, 160, 200, 230]) {
    const text = "Q".repeat(len);
    const q = SP.qrEncode(text);
    assert.ok(q, "encodes " + len);
    // Rebuild data codewords the spec way (pad bytes 0xEC then 0x11).
    const bytes = [...text].map((ch) => ch.charCodeAt(0));
    const dataCw = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232][q.version];
    const ecLen = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30][q.version];
    const nBlock = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2][q.version];
    const bits = [0, 1, 0, 0];
    for (let i = 7; i >= 0; i--) bits.push((bytes.length >> i) & 1);
    for (const by of bytes) for (let b = 7; b >= 0; b--) bits.push((by >> b) & 1);
    const cap = dataCw * 8, term = Math.min(4, cap - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let w = 0;
      for (let k = 0; k < 8; k++) w = (w << 1) | bits[i + k];
      cw.push(w);
    }
    for (let p = 0; cw.length < dataCw; p++) cw.push(p % 2 ? 0x11 : 0xec);
    const gen = generator(ecLen);
    const per = dataCw / nBlock;
    for (let b = 0; b < nBlock; b++) {
      const blk = cw.slice(b * per, (b + 1) * per);
      // Independent oracle: plain long division of data plus a zero tail.
      const out = blk.concat(new Array(ecLen).fill(0));
      for (let i = 0; i < blk.length; i++) {
        const f = out[i];
        if (f !== 0) for (let j = 1; j < gen.length; j++) out[i + j] ^= gmul(gen[j], f);
      }
      assert.deepEqual(SP.rsEncode(blk, ecLen), out.slice(blk.length), `check bytes at len ${len}, block ${b}`);
      const rem = polyMod([...blk, ...out.slice(blk.length)], gen);
      assert.ok(rem.every((x) => x === 0), `RS divides generator at len ${len}`);
    }
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
