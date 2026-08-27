/* pglog-qr.js — a minimal, dependency-free QR encoder (byte mode).
 * ===========================================================================
 * WHY THIS EXISTS RATHER THAN A LIBRARY: every signed record in the NMC Logbook carries a QR that a
 * University examiner can scan to check the signature. Shipping a QR library for that would add a
 * dependency to a buildless ES5 app; calling an external QR image service would send the
 * verification code to a third party and would not work offline, on a ward, which is where an
 * examiner actually is. So it is implemented here, from ISO/IEC 18004, byte mode only.
 *
 * SCOPE, DELIBERATELY SMALL: byte mode, versions 1-10, ECC level M (L for the longest payloads).
 * That covers a verification URL comfortably (version 6-M holds 134 bytes) and nothing more. It is
 * not a general-purpose encoder and should not be used as one.
 *
 * A WRONG QR IS WORSE THAN NO QR — it looks scannable and is not. So the parts with published
 * reference values are checked against them in test/pglog-qr.test.mjs: the GF(256) log tables, the
 * Reed-Solomon generator polynomials, the format-information bit strings for all 32 (ecc, mask)
 * combinations, and the ISO worked example (00100000 01011011 ... for "01234567" at 1-M).
 *
 * Dual export: module.exports for node tests, window.SMD_PGLOG_QR for the browser.
 */
(function () {
  "use strict";

  /* ── GF(256), the field QR's Reed-Solomon lives in. Primitive polynomial 0x11D. ── */
  var EXP = new Array(512), LOG = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
    LOG[0] = 0;                       // never read; 0 has no logarithm
  })();
  function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // The generator polynomial for `n` error-correction codewords: (x-a^0)(x-a^1)...(x-a^(n-1)).
  function rsGenerator(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecCount) {
    var gen = rsGenerator(ecCount);
    var res = data.slice().concat(new Array(ecCount));
    for (var i = data.length; i < res.length; i++) res[i] = 0;
    for (var p = 0; p < data.length; p++) {
      var factor = res[p];
      if (factor === 0) continue;
      for (var g = 0; g < gen.length; g++) res[p + g] ^= gfMul(gen[g], factor);
    }
    return res.slice(data.length);
  }

  /* ── capacity tables (ISO/IEC 18004 Table 9 / Annex), versions 1-10 ──────────
   * Per version+ecc: total data codewords, EC codewords PER BLOCK, and the block split
   * [group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords]. */
  var TABLE = {
    // version: { L: [dataCW, ecPerBlock, g1, g1cw, g2, g2cw], M: [...] }
    1:  { L: [19, 7, 1, 19, 0, 0],    M: [16, 10, 1, 16, 0, 0] },
    2:  { L: [34, 10, 1, 34, 0, 0],   M: [28, 16, 1, 28, 0, 0] },
    3:  { L: [55, 15, 1, 55, 0, 0],   M: [44, 26, 1, 44, 0, 0] },
    4:  { L: [80, 20, 1, 80, 0, 0],   M: [64, 18, 2, 32, 0, 0] },
    5:  { L: [108, 26, 1, 108, 0, 0], M: [86, 24, 2, 43, 0, 0] },
    6:  { L: [136, 18, 2, 68, 0, 0],  M: [108, 16, 4, 27, 0, 0] },
    7:  { L: [156, 20, 2, 78, 0, 0],  M: [124, 18, 4, 31, 0, 0] },
    8:  { L: [194, 24, 2, 97, 0, 0],  M: [154, 22, 2, 38, 2, 39] },
    9:  { L: [232, 30, 2, 116, 0, 0], M: [182, 22, 3, 36, 2, 37] },
    10: { L: [274, 18, 2, 68, 2, 69], M: [216, 26, 4, 43, 1, 44] }
  };
  // Alignment-pattern centres per version (ISO Table E.1). Version 1 has none.
  var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
                7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

  function size(version) { return 17 + 4 * version; }

  /* ── bit buffer ─────────────────────────────────────────────────────────── */
  function Bits() { this.bits = []; }
  Bits.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };
  Bits.prototype.length = function () { return this.bits.length; };
  Bits.prototype.bytes = function () {
    var out = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  };

  function utf8Bytes(str) {
    var out = [], s = String(str);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }

  // Smallest version that fits `n` data bytes at the given ECC level. null if it does not fit.
  function pickVersion(n, ecc) {
    for (var v = 1; v <= 10; v++) {
      var cap = TABLE[v][ecc][0];
      var lenBits = v < 10 ? 8 : 16;            // byte-mode character-count length, versions 1-9 = 8
      var need = Math.ceil((4 + lenBits + n * 8) / 8);
      if (need <= cap) return v;
    }
    return null;
  }

  /* ── data codewords: mode, length, payload, terminator, pad ─────────────── */
  function dataCodewords(bytes, version, ecc) {
    var total = TABLE[version][ecc][0];
    var bb = new Bits();
    bb.put(4, 4);                                  // mode 0100 = byte
    bb.put(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);
    var cap = total * 8;
    var term = Math.min(4, cap - bb.length());
    if (term > 0) bb.put(0, term);
    while (bb.length() % 8 !== 0) bb.put(0, 1);
    var cw = bb.bytes();
    var pads = [0xEC, 0x11], p = 0;
    while (cw.length < total) cw.push(pads[p++ % 2]);
    return cw;
  }

  // Interleave data + EC codewords across blocks, per the standard.
  function interleave(cw, version, ecc) {
    var t = TABLE[version][ecc];
    var ecPer = t[1], g1 = t[2], g1cw = t[3], g2 = t[4], g2cw = t[5];
    var blocks = [], pos = 0, i;
    for (i = 0; i < g1; i++) { blocks.push(cw.slice(pos, pos + g1cw)); pos += g1cw; }
    for (i = 0; i < g2; i++) { blocks.push(cw.slice(pos, pos + g2cw)); pos += g2cw; }
    var ecBlocks = blocks.map(function (b) { return rsEncode(b, ecPer); });
    var out = [], maxData = Math.max(g1cw, g2cw), j;
    for (i = 0; i < maxData; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    }
    for (i = 0; i < ecPer; i++) {
      for (j = 0; j < ecBlocks.length; j++) out.push(ecBlocks[j][i]);
    }
    return out;
  }

  /* ── matrix construction ────────────────────────────────────────────────── */
  function newMatrix(n) {
    var m = new Array(n);
    for (var i = 0; i < n; i++) { m[i] = new Array(n); for (var j = 0; j < n; j++) m[i][j] = null; }
    return m;
  }
  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }
  function placeAlignment(m, version) {
    var centres = ALIGN[version], n = m.length;
    for (var a = 0; a < centres.length; a++) {
      for (var b = 0; b < centres.length; b++) {
        var r = centres[a], c = centres[b];
        // skip the three that would collide with the finders
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
        for (var i = -2; i <= 2; i++) {
          for (var j = -2; j <= 2; j++) {
            m[r + i][c + j] = (Math.max(Math.abs(i), Math.abs(j)) !== 1) ? 1 : 0;
          }
        }
      }
    }
  }
  function placeTiming(m) {
    var n = m.length;
    for (var i = 8; i < n - 8; i++) {
      if (m[6][i] === null) m[6][i] = (i % 2 === 0) ? 1 : 0;
      if (m[i][6] === null) m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
  }
  function reserveFormat(m) {
    var n = m.length, i;
    for (i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 2;           // 2 = reserved
      if (m[i][8] === null) m[i][8] = 2;
    }
    for (i = n - 8; i < n; i++) {
      if (m[8][i] === null) m[8][i] = 2;
      if (m[i][8] === null) m[i][8] = 2;
    }
    m[n - 8][8] = 1;                                // the always-dark module
  }
  function reserveVersion(m, version) {
    if (version < 7) return;
    var n = m.length;
    for (var i = 0; i < 6; i++) for (var j = 0; j < 3; j++) {
      m[i][n - 11 + j] = 2; m[n - 11 + j][i] = 2;
    }
  }

  // Zig-zag placement of the interleaved codewords into the free modules.
  function placeData(m, data) {
    var n = m.length, bitIdx = 0, up = true;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;                        // skip the vertical timing column
      for (var k = 0; k < n; k++) {
        var row = up ? (n - 1 - k) : k;
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (m[row][cc] !== null) continue;
          var bit = 0;
          if (bitIdx < data.length * 8) {
            bit = (data[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1;
          }
          m[row][cc] = bit;
          bitIdx++;
        }
      }
      up = !up;
    }
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return ((((i * j) % 2) + ((i * j) % 3)) % 2) === 0; },
    function (i, j) { return ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0; }
  ];

  // Format information: 5 data bits (ecc<<3 | mask) + BCH(15,5), XOR 0x5412.
  var ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  function formatBits(ecc, mask) {
    var data = (ECC_BITS[ecc] << 3) | mask;
    var v = data << 10;
    for (var i = 4; i >= 0; i--) {
      if ((v >>> (i + 10)) & 1) v ^= 0x537 << i;   // generator 10100110111
    }
    return ((data << 10) | v) ^ 0x5412;
  }
  function versionBits(version) {
    var v = version << 12;
    for (var i = 5; i >= 0; i--) {
      if ((v >>> (i + 12)) & 1) v ^= 0x1F25 << i;  // generator 1111100100101
    }
    return (version << 12) | v;
  }

  function applyFormat(m, ecc, mask) {
    var n = m.length, bits = formatBits(ecc, mask), i;
    for (i = 0; i <= 5; i++) m[8][i] = (bits >> i) & 1;
    m[8][7] = (bits >> 6) & 1;
    m[8][8] = (bits >> 7) & 1;
    m[7][8] = (bits >> 8) & 1;
    for (i = 9; i <= 14; i++) m[14 - i][8] = (bits >> i) & 1;
    for (i = 0; i <= 7; i++) m[n - 1 - i][8] = (bits >> i) & 1;
    for (i = 8; i <= 14; i++) m[8][n - 15 + i] = (bits >> i) & 1;
    m[n - 8][8] = 1;
  }
  function applyVersion(m, version) {
    if (version < 7) return;
    var n = m.length, bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var b = (bits >> i) & 1;
      m[Math.floor(i / 3)][n - 11 + (i % 3)] = b;
      m[n - 11 + (i % 3)][Math.floor(i / 3)] = b;
    }
  }

  // Penalty scoring (ISO 18004 §8.8.2) — picks the mask that reads most reliably.
  function penalty(m) {
    var n = m.length, score = 0, i, j, run, dark = 0;
    for (i = 0; i < n; i++) {
      run = 1;
      for (j = 1; j < n; j++) {
        if (m[i][j] === m[i][j - 1]) { run++; } else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (j = 0; j < n; j++) {
      run = 1;
      for (i = 1; i < n; i++) {
        if (m[i][j] === m[i - 1][j]) { run++; } else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1; j++) {
      var v = m[i][j];
      if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
    }
    var PAT = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    function hasPattern(get) {
      var hits = 0;
      for (var s = 0; s + 11 <= n; s++) {
        var ok = true, okRev = true;
        for (var k = 0; k < 11; k++) {
          if (get(s + k) !== PAT[k]) ok = false;
          if (get(s + k) !== PAT[10 - k]) okRev = false;
        }
        if (ok || okRev) hits++;
      }
      return hits;
    }
    for (i = 0; i < n; i++) {
      score += 40 * hasPattern((function (r) { return function (k) { return m[r][k]; }; })(i));
      score += 40 * hasPattern((function (c) { return function (k) { return m[k][c]; }; })(i));
    }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (m[i][j]) dark++;
    var pct = (dark * 100) / (n * n);
    score += 10 * Math.floor(Math.abs(pct - 50) / 5);
    return score;
  }

  /* ── the encoder ────────────────────────────────────────────────────────── */
  function encode(text, opts) {
    opts = opts || {};
    var bytes = utf8Bytes(text);
    var ecc = opts.ecc === "L" ? "L" : "M";
    var version = pickVersion(bytes.length, ecc);
    if (!version && ecc === "M") { ecc = "L"; version = pickVersion(bytes.length, ecc); }
    if (!version) throw new Error("pglog_qr_too_long");
    if (opts.version && opts.version >= version && opts.version <= 10) version = opts.version;

    var cw = dataCodewords(bytes, version, ecc);
    var full = interleave(cw, version, ecc);
    var n = size(version);

    // The function-pattern skeleton, reused for every mask trial.
    function skeleton() {
      var m = newMatrix(n);
      placeFinder(m, 0, 0); placeFinder(m, 0, n - 7); placeFinder(m, n - 7, 0);
      placeAlignment(m, version);
      placeTiming(m);
      reserveVersion(m, version);
      reserveFormat(m);
      return m;
    }
    var base = skeleton();
    // Which modules are function patterns (never masked)? Anything set before data placement.
    var isFunction = [];
    for (var i = 0; i < n; i++) { isFunction[i] = []; for (var j = 0; j < n; j++) isFunction[i][j] = base[i][j] !== null; }

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var m = skeleton();
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c] === 2) m[r][c] = null;
      placeData(m, full);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        if (!isFunction[y][x] && MASKS[mask](y, x)) m[y][x] ^= 1;
      }
      applyVersion(m, version);
      applyFormat(m, ecc, mask);
      var sc = penalty(m);
      if (sc < bestScore) { bestScore = sc; best = m; }
    }
    return { modules: best, size: n, version: version, ecc: ecc, mask: -1 };
  }

  /* ── SVG rendering ───────────────────────────────────────────────────────────
   * One <path> of rectangles, no external assets, no script. Safe to inline in a report and to
   * print. `quiet` is the mandatory 4-module quiet zone; dropping it makes scanners fail. */
  function toSvg(text, opts) {
    opts = opts || {};
    var q = opts.quiet == null ? 4 : opts.quiet;
    var qr = encode(text, opts);
    var n = qr.size, total = n + q * 2;
    var px = opts.scale || 4;
    var d = [];
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (qr.modules[y][x]) d.push("M" + (x + q) + " " + (y + q) + "h1v1h-1z");
      }
    }
    var dim = total * px;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
      '" viewBox="0 0 ' + total + " " + total + '" shape-rendering="crispEdges" role="img" aria-label="' +
      (opts.label ? String(opts.label).replace(/[<>&"]/g, "") : "Verification QR code") + '">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
      '<path d="' + d.join("") + '" fill="#000"/></svg>';
  }
  function toDataUri(text, opts) {
    // encodeURIComponent, not base64: it keeps the SVG readable in a data: URI and avoids btoa's
    // Latin-1 limitation entirely.
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(toSvg(text, opts));
  }

  var API = {
    encode: encode, toSvg: toSvg, toDataUri: toDataUri,
    // exported for the tests that check them against published reference values
    _gfMul: gfMul, _rsGenerator: rsGenerator, _rsEncode: rsEncode,
    _formatBits: formatBits, _versionBits: versionBits,
    _dataCodewords: dataCodewords, _pickVersion: pickVersion, _size: size, _EXP: EXP, _LOG: LOG
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_QR = API;
})();
