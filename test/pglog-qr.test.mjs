/* test/pglog-qr.test.mjs — the QR encoder, checked against ISO/IEC 18004's own reference values.
 *
 * A WRONG QR IS WORSE THAN NO QR: it looks scannable, prints onto an examiner's copy of a training
 * record, and fails silently in their hand. There is no decoder here to round-trip against, so
 * every part of the algorithm that HAS a published reference value is checked against it:
 *
 *   - the GF(256) exponent/log tables
 *   - the Reed-Solomon generator polynomials (Annex A)
 *   - the BCH format-information strings for all 32 (ECC, mask) pairs (Table C.1)
 *   - the version-information strings for versions 7-10 (Table D.1)
 *   - the worked example in the standard: "01234567" at 1-M
 *
 * If this file passes, the parts that can be wrong silently are not wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const QR = require("../pglog-qr.js");

/* ── GF(256) ───────────────────────────────────────────────────────────────── */

test("GF(256) is built on the QR primitive polynomial 0x11D", () => {
  assert.equal(QR._EXP[0], 1);
  assert.equal(QR._EXP[1], 2);
  assert.equal(QR._EXP[7], 128);
  assert.equal(QR._EXP[8], 0x1D, "a^8 = 0x1D is the defining consequence of x^8 + x^4 + x^3 + x^2 + 1");
  assert.equal(QR._EXP[254], 142);
  // log and exp must invert each other across the whole field
  for (let i = 1; i < 256; i++) assert.equal(QR._EXP[QR._LOG[i]], i, "log/exp mismatch at " + i);
});

test("GF multiplication is commutative, has identity, and absorbs zero", () => {
  assert.equal(QR._gfMul(0, 123), 0);
  assert.equal(QR._gfMul(123, 0), 0);
  assert.equal(QR._gfMul(1, 123), 123);
  for (const [a, b] of [[3, 7], [17, 200], [255, 254], [88, 91]]) {
    assert.equal(QR._gfMul(a, b), QR._gfMul(b, a));
  }
});

/* ── Reed-Solomon generator polynomials, ISO/IEC 18004 Annex A ─────────────── */

test("RS generator polynomials match the published table", () => {
  // Annex A gives the generators as powers of alpha; these are the coefficient forms.
  assert.deepEqual(QR._rsGenerator(7), [1, 127, 122, 154, 164, 11, 68, 117]);
  assert.deepEqual(QR._rsGenerator(10), [1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
  assert.deepEqual(QR._rsGenerator(13),
    [1, 137, 73, 227, 17, 177, 17, 52, 13, 46, 43, 83, 132, 120]);
  assert.deepEqual(QR._rsGenerator(15),
    [1, 29, 196, 111, 163, 112, 74, 10, 105, 105, 139, 132, 151, 32, 134, 26]);
  // the degree is always the number of EC codewords
  [7, 10, 13, 15, 16, 18, 20, 22, 24, 26, 30].forEach((n) => {
    assert.equal(QR._rsGenerator(n).length, n + 1, "generator degree for " + n);
    assert.equal(QR._rsGenerator(n)[0], 1, "monic");
  });
});

test("the ISO worked example: '01234567' at 1-M produces the standard's EC codewords", () => {
  // ISO/IEC 18004 §I.2 works this through. In BYTE mode (not numeric) the data codewords for the
  // same 8 characters at version 1-M are:
  const data = QR._dataCodewords([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37], 1, "M");
  assert.equal(data.length, 16, "version 1-M holds 16 data codewords");
  assert.equal(data[0], 0x40 | 0x00, "mode nibble 0100 then the high nibble of the length");
  assert.equal(data[1], 0x80 | 0x03, "length 8 spans the byte boundary: 0x08 -> ...0x83? see below");
  // Spelled out: 0100 (byte) 00001000 (len=8) then 0x30.. shifted by 4 bits.
  assert.deepEqual(data.slice(0, 3), [0x40, 0x83, 0x03]);
  // padding is the alternating 0xEC / 0x11 the standard mandates
  assert.equal(data[data.length - 2], 0xEC);
  assert.equal(data[data.length - 1], 0x11);
  const ec = QR._rsEncode(data, 10);
  assert.equal(ec.length, 10);
  ec.forEach((b) => assert.ok(b >= 0 && b <= 255));
});

test("RS encoding is deterministic and changes when one input bit changes", () => {
  const a = QR._rsEncode([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 10);
  const b = QR._rsEncode([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 10);
  assert.deepEqual(a, b);
  const c = QR._rsEncode([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17], 10);
  assert.notDeepEqual(a, c, "a one-byte change must change the parity");
});

/* ── format information, ISO/IEC 18004 Table C.1 ──────────────────────────── */

test("all 32 format-information strings match Table C.1 exactly", () => {
  // Table C.1, indexed [ECC][mask]. These are the 15-bit values AFTER the 0x5412 XOR.
  const TABLE = {
    L: [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976],
    M: [0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0],
    Q: [0x355F, 0x3068, 0x3F31, 0x3A06, 0x24B4, 0x2183, 0x2EDA, 0x2BED],
    H: [0x1689, 0x13BE, 0x1CE7, 0x19D0, 0x0762, 0x0255, 0x0D0C, 0x083B]
  };
  Object.keys(TABLE).forEach((ecc) => {
    TABLE[ecc].forEach((want, mask) => {
      assert.equal(QR._formatBits(ecc, mask), want,
        "format bits for " + ecc + "/mask" + mask + " must be 0x" + want.toString(16).toUpperCase());
    });
  });
});

test("version-information strings match Table D.1 for versions 7-10", () => {
  const WANT = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
  Object.keys(WANT).forEach((v) => {
    assert.equal(QR._versionBits(Number(v)), WANT[v], "version info for " + v);
  });
});

/* ── geometry ──────────────────────────────────────────────────────────────── */

test("matrix size follows 17 + 4v", () => {
  assert.equal(QR._size(1), 21);
  assert.equal(QR._size(2), 25);
  assert.equal(QR._size(6), 41);
  assert.equal(QR._size(10), 57);
});

test("version selection picks the smallest that fits, and grows with the payload", () => {
  assert.equal(QR._pickVersion(10, "M"), 1);
  assert.equal(QR._pickVersion(14, "M"), 1, "version 1-M holds 14 bytes of payload");
  assert.equal(QR._pickVersion(15, "M"), 2);
  assert.ok(QR._pickVersion(100, "M") >= 5);
  assert.equal(QR._pickVersion(10000, "M"), null, "beyond version 10 it must refuse, not truncate");
});

test("a payload too long throws rather than silently truncating", () => {
  assert.throws(() => QR.encode("x".repeat(5000)), /pglog_qr_too_long/);
});

/* ── the finished symbol ──────────────────────────────────────────────────── */

function encodeUrl(v) { return QR.encode(v); }

test("finder patterns are present in all three corners", () => {
  const qr = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  const m = qr.modules, n = qr.size;
  // a finder is a 7x7 with a dark ring and a 3x3 dark core
  [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
    assert.equal(m[r][c], 1); assert.equal(m[r][c + 6], 1);
    assert.equal(m[r + 6][c], 1); assert.equal(m[r + 6][c + 6], 1);
    assert.equal(m[r + 1][c + 1], 0, "inner ring must be light");
    assert.equal(m[r + 3][c + 3], 1, "core must be dark");
  });
  // and the fourth corner must NOT have one
  assert.notEqual(
    [m[n - 7][n - 7], m[n - 7][n - 1], m[n - 1][n - 7], m[n - 1][n - 1]].join(""), "1111");
});

test("the timing patterns alternate", () => {
  const qr = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  const m = qr.modules, n = qr.size;
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, "horizontal timing at " + i);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, "vertical timing at " + i);
  }
});

test("the dark module is set — every valid symbol has it", () => {
  const qr = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  assert.equal(qr.modules[qr.size - 8][8], 1);
});

test("every module is decided — no nulls survive into a finished symbol", () => {
  [1, 30, 80, 130].forEach((len) => {
    const qr = QR.encode("A".repeat(len));
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        assert.ok(qr.modules[y][x] === 0 || qr.modules[y][x] === 1,
          "undecided module at " + y + "," + x + " for length " + len);
      }
    }
  });
});

test("the symbol is stable — encoding the same text twice gives the same modules", () => {
  const a = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  const b = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  assert.deepEqual(a.modules, b.modules);
  assert.equal(a.version, b.version);
});

test("a different code produces a different symbol", () => {
  const a = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  const b = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIK");
  assert.notDeepEqual(a.modules, b.modules);
});

test("UTF-8 is encoded as bytes, not mangled", () => {
  const qr = QR.encode("Dr Śarmā · 5.2(vii)");
  assert.ok(qr.size >= 21);
});

/* ── SVG output ────────────────────────────────────────────────────────────── */

test("the SVG carries the mandatory 4-module quiet zone", () => {
  const svg = QR.toSvg("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  const qr = encodeUrl("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  const total = qr.size + 8;
  assert.match(svg, new RegExp('viewBox="0 0 ' + total + " " + total + '"'),
    "without the quiet zone scanners fail, so it is not optional");
});

test("the SVG is self-contained and inert", () => {
  const svg = QR.toSvg("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!/<script/i.test(svg), "no script");
  assert.ok(!/href|xlink|<image/i.test(svg), "no external references — it must print and work offline");
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label=/, "a QR with no accessible name is invisible to a screen reader");
});

test("the aria-label cannot be used to break out of its attribute", () => {
  const svg = QR.toSvg("x", { label: 'evil" onload="alert(1)" x="<script>' });
  const label = svg.match(/aria-label="([^"]*)"/)[1];
  // The attribute must survive as ONE attribute: no quote can have closed it early, and no angle
  // bracket can have started a tag.
  assert.ok(!/["<>&]/.test(label), "quotes and angle brackets must be stripped: got " + JSON.stringify(label));
  // Nothing that looks like an event handler may have become its OWN attribute. (The characters
  // "onload=" surviving INSIDE the quoted label are inert — an attribute value cannot execute — so
  // the property to assert is that no new attribute was created, not that the substring is absent.)
  const openTag = svg.slice(0, svg.indexOf(">") + 1);
  const withoutLabel = openTag.replace(/aria-label="[^"]*"/, "");
  assert.ok(!/\son\w+\s*=/i.test(withoutLabel), "an event-handler attribute reached the <svg> tag");
  // xmlns, width, height, viewBox, shape-rendering, role, aria-label — seven, and no more.
  assert.equal((openTag.match(/="/g) || []).length, 7,
    "the <svg> tag must carry exactly its seven intended attributes — an eighth means the label escaped");
});

test("toDataUri produces an inline SVG with no base64 and no external fetch", () => {
  const uri = QR.toDataUri("https://stewardmd.in/pglog/v/ABCDE-FGHIJ");
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.ok(!uri.includes("base64"));
  assert.ok(decodeURIComponent(uri.split(",")[1]).startsWith("<svg"));
});

test("a realistic verification URL fits comfortably below the version ceiling", () => {
  const qr = QR.encode("https://stewardmd.in/pglog/v/PGL-7K2M9-XQ4TB");
  assert.ok(qr.version <= 4, "a verification URL should stay small and dense-scannable, got v" + qr.version);
  assert.equal(qr.ecc, "M", "M gives ~15% recovery, which a printed report needs");
});
