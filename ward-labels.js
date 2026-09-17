/* ward-labels.js - WardSynQ printed labels and camera scanning (window.WARD_LABELS).
 *
 * Buildless ES5 IIFE, no dependency. Loaded before ward.js, which calls it from the natural places: the
 * wristband and ID slip at admission and on the Wristband screen, the tube label at Collect, the pharmacy
 * label at Dispense, and "Scan with camera" wherever a code is scanned.
 *
 * THE BARCODES ARE GENERATED HERE, NOT FETCHED. A label that needed a network call to draw its barcode
 * would fail on the ward printer exactly when the network does, and a third-party generator would send the
 * MRN or an accession number to someone who has no business holding it.
 *   Code 128 (ISO/IEC 15417): set B with set C for runs of digits, the symbol table as published in the
 *   standard (pinned value by value in test/ward-labels.test.mjs against https://en.wikipedia.org/wiki/Code_128).
 *   QR (ISO/IEC 18004): byte mode, error correction level M, versions 1 to 10 (up to 213 bytes). Reed-Solomon,
 *   format and version strings are pinned against the published tables (https://www.thonky.com/qr-code-tutorial/).
 *   test/run-ward-labels-ui.mjs decodes both with the browser's own BarcodeDetector.
 *
 * A PRINTED LABEL IS ENGLISH WHOLE, like the printed discharge summary: a tube is read by the laboratory and a
 * pharmacy label by whoever holds the medicine. Every value on it is what the record holds; nothing is invented,
 * and ward.js refuses to print a wristband whose allergies could not be read.
 *
 * THE CAMERA ONLY FILLS THE FIELD. scan() resolves with what it read; ward.js puts it in the same input a
 * keyboard-wedge scanner types into, and the same button sends it through the same server check. Nothing here
 * compares a code or decides a match.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  /* ---- Code 128 ------------------------------------------------------------------------------------------ */
  /* Bar/space widths of symbol values 0-106 (103 A, 104 B, 105 C are the starts; 106 is the stop without its
   * terminating bar, which STOP below completes). */
  var C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
    "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 " +
    "111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 " +
    "141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
    "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 " +
    "311141 411131 211412 211214 211232 233111").split(" ");
  var START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = "2331112";

  function c128Checksum(values) {
    var sum = values[0];
    for (var i = 1; i < values.length; i++) sum += values[i] * i;
    return sum % 103;
  }
  /* Symbol values (start, data, code changes; no checksum, no stop). Set C for a run of at least four digits at the
   * start or end, or six in the middle, an odd digit going first in set B - the length rule the standard's
   * informative annex gives. Only printable ASCII (32-126): anything else is refused rather than dropped. */
  function code128Values(text) {
    var s = String(text == null ? "" : text), i;
    if (!s) throw new Error("code128: nothing to encode");
    for (i = 0; i < s.length; i++) { var cc = s.charCodeAt(i); if (cc < 32 || cc > 126) throw new Error("code128: character " + cc + " is not printable ASCII"); }
    var digitsAt = function (k) { var n = 0; while (k + n < s.length && s.charCodeAt(k + n) >= 48 && s.charCodeAt(k + n) <= 57) n++; return n; };
    var out = [], setC = false, first = digitsAt(0);
    if (first >= 4 || (first >= 2 && first === s.length)) { out.push(START_C); setC = true; } else out.push(START_B);
    i = 0;
    while (i < s.length) {
      if (setC) {
        if (digitsAt(i) >= 2) { out.push(Number(s.substr(i, 2))); i += 2; continue; }
        out.push(CODE_B); setC = false; continue;
      }
      var run = digitsAt(i);
      if (run >= 6 || (run >= 4 && i + run === s.length)) {
        if (run % 2) { out.push(s.charCodeAt(i) - 32); i++; }
        out.push(CODE_C); setC = true; continue;
      }
      out.push(s.charCodeAt(i) - 32); i++;
    }
    return out;
  }
  /* The whole symbol as run widths, bar first: start, data, checksum, stop. */
  function code128(text) {
    var values = code128Values(text);
    var check = c128Checksum(values);
    return { values: values, checksum: check, widths: values.concat([check]).map(function (v) { return C128[v]; }).join("") + STOP };
  }
  function code128Svg(text, opts) {
    var w = code128(text).widths, quiet = 10, x = quiet, bars = "";
    for (var i = 0; i < w.length; i++) {
      var n = Number(w.charAt(i));
      if (i % 2 === 0) bars += "M" + x + " 0h" + n + "v10h-" + n + "z";
      x += n;
    }
    var total = x + quiet;
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + esc((opts && opts.cls) || "bc") + '" viewBox="0 0 ' + total + ' 10" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="' + esc(text) + '">' +
      '<rect width="' + total + '" height="10" fill="#fff"/><path fill="#000" d="' + bars + '"/></svg>';
  }

  /* ---- QR, level M --------------------------------------------------------------------------------------- */
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } })();
  function gfMul(a, b) { return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }
  /* Error correction codewords for one block: the remainder of data(x)·x^n divided by the generator of degree n. */
  function rsEc(data, n) {
    var gen = [1], i, j;
    for (i = 0; i < n; i++) {
      var next = []; for (j = 0; j <= gen.length; j++) next.push(0);
      for (j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= gfMul(gen[j], EXP[i]); }
      gen = next;
    }
    var rem = []; for (i = 0; i < n; i++) rem.push(0);
    for (i = 0; i < data.length; i++) {
      var f = data[i] ^ rem.shift(); rem.push(0);
      for (j = 0; j < n; j++) rem[j] ^= gfMul(gen[j + 1], f);
    }
    return rem;
  }
  /* Level M per version: [EC codewords per block, data codewords of each block]. ISO/IEC 18004 table 9. */
  var QR_M = [null, [10, [16]], [16, [28]], [26, [44]], [18, [32, 32]], [24, [43, 43]], [16, [27, 27, 27, 27]], [18, [31, 31, 31, 31]],
    [22, [38, 38, 39, 39]], [22, [36, 36, 36, 37, 37]], [26, [43, 43, 43, 43, 44]]];
  var QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  function utf8(s) {
    var out = [], e = unescape(encodeURIComponent(String(s)));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }
  /* EC level M is 00; the 15-bit format string with its BCH(15,5) remainder and mask. */
  function formatBits(mask) {
    var data = (0 << 3) | mask, rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function versionBits(ver) {
    var rem = ver;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | rem;
  }
  function qrCodewords(bytes, ver) {
    var spec = QR_M[ver], capacity = 0, i;
    spec[1].forEach(function (n) { capacity += n; });
    var bits = [], put = function (v, len) { for (var k = len - 1; k >= 0; k--) bits.push((v >>> k) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    for (i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    for (i = 0; data.length < capacity; i++) data.push(i % 2 ? 0x11 : 0xec);
    var blocks = [], ecs = [], at = 0;
    spec[1].forEach(function (n) { var blk = data.slice(at, at + n); at += n; blocks.push(blk); ecs.push(rsEc(blk, spec[0])); });
    var out = [], most = spec[1][spec[1].length - 1];
    for (i = 0; i < most; i++) blocks.forEach(function (blk) { if (i < blk.length) out.push(blk[i]); });
    for (i = 0; i < spec[0]; i++) ecs.forEach(function (e) { out.push(e[i]); });
    return out;
  }
  function qrMaskAt(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }
  function qrPenalty(m) {
    var n = m.length, score = 0, x, y, run, dark = 0;
    var line = function (get) {
      var s = "";
      for (var i = 0; i < n; i++) s += get(i) ? "1" : "0";
      var r = /(0{5,}|1{5,})/g, mm;
      while ((mm = r.exec(s))) score += 3 + mm[0].length - 5;
      var f = /(?=(10111010000|00001011101))/g;
      while ((mm = f.exec(s))) { score += 40; f.lastIndex++; }
    };
    for (y = 0; y < n; y++) line(function (i) { return m[y][i]; });
    for (x = 0; x < n; x++) line(function (i) { return m[i][x]; });
    for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++) {
      run = m[y][x];
      if (run === m[y][x + 1] && run === m[y + 1][x] && run === m[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (m[y][x]) dark++;
    return score + 10 * Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n));
  }
  /* The module matrix (true = dark), without the quiet zone. */
  function qr(text) {
    var bytes = utf8(text), ver;
    for (ver = 1; ver <= 10; ver++) {
      var cap = 0; QR_M[ver][1].forEach(function (c) { cap += c; });
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break;
    }
    if (ver > 10) throw new Error("qr: too long for a label");
    var size = ver * 4 + 17, mod = [], fn = [], x, y, i;
    for (y = 0; y < size; y++) { mod.push([]); fn.push([]); for (x = 0; x < size; x++) { mod[y].push(false); fn[y].push(false); } }
    var set = function (xx, yy, dark) { mod[yy][xx] = !!dark; fn[yy][xx] = true; };
    var finder = function (cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = cx + dx, yy = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    };
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var al = QR_ALIGN[ver], last = al.length - 1;
    for (i = 0; i < al.length; i++) for (var j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) set(al[i] + dx2, al[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    var drawFormat = function (mask) {
      var b = formatBits(mask), bit = function (k) { return ((b >>> k) & 1) === 1; };
      for (var k = 0; k <= 5; k++) set(8, k, bit(k));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (k = 9; k < 15; k++) set(14 - k, 8, bit(k));
      for (k = 0; k < 8; k++) set(size - 1 - k, 8, bit(k));
      for (k = 8; k < 15; k++) set(8, size - 15 + k, bit(k));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      var vb = versionBits(ver);
      for (i = 0; i < 18; i++) {
        var a = size - 11 + i % 3, c = Math.floor(i / 3), on = ((vb >>> i) & 1) === 1;
        set(a, c, on); set(c, a, on);
      }
    }
    var words = qrCodewords(bytes, ver), bitAt = 0, total = words.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var k2 = 0; k2 < 2; k2++) {
        x = right - k2;
        y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && bitAt < total) { mod[y][x] = ((words[bitAt >>> 3] >>> (7 - (bitAt & 7))) & 1) === 1; bitAt++; }
      }
    }
    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var trial = mod.map(function (row, yy) { return row.map(function (v, xx) { return fn[yy][xx] ? v : v !== qrMaskAt(mask, xx, yy); }); });
      mod = trial; drawFormat(mask);
      var sc = qrPenalty(mod);
      if (sc < bestScore) { bestScore = sc; best = { mask: mask, m: mod.map(function (r) { return r.slice(); }) }; }
      mod = trial.map(function (row, yy) { return row.map(function (v, xx) { return fn[yy][xx] ? v : v !== qrMaskAt(mask, xx, yy); }); });
    }
    return { version: ver, mask: best.mask, size: size, modules: best.m };
  }
  function qrSvg(text, opts) {
    var q = qr(text), quiet = 4, n = q.size + quiet * 2, d = "";
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) d += "M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + esc((opts && opts.cls) || "qr") + '" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(text) + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  /* ---- label sizes and markup ------------------------------------------------------------------------------ */
  /* What a hospital that set nothing gets: 75 x 25 mm wristband insert, 50 x 25 mm tube label, 75 x 50 mm pharmacy
   * label, 80 x 60 mm slip on a receipt printer. Admin > Hospital changes them (functions/_wardsynq/labels.js
   * bounds them on the server; the same bounds apply here to a size that arrives without them). */
  var DEFAULT_SIZES = { wristband: { widthMm: 75, heightMm: 25 }, specimen: { widthMm: 50, heightMm: 25 }, pharmacy: { widthMm: 75, heightMm: 50 }, slip: { widthMm: 80, heightMm: 60 } };
  function sizeOf(kind, sizes) {
    var d = DEFAULT_SIZES[kind], s = sizes && sizes[kind], ok = function (v) { return typeof v === "number" && isFinite(v) && v >= 15 && v <= 300; };
    return s && ok(s.widthMm) && ok(s.heightMm) ? { widthMm: s.widthMm, heightMm: s.heightMm } : { widthMm: d.widthMm, heightMm: d.heightMm };
  }
  function line(label, value) { return value ? "<div><i>" + esc(label) + "</i> " + esc(value) + "</div>" : ""; }
  /* d: { name, mrn, dob, ageYears, sex, allergies: [substance] (empty = none recorded), bandValue } */
  function wristbandHtml(d) {
    var allergy = d.allergies && d.allergies.length
      ? '<div class="al">ALLERGY: ' + esc(d.allergies.join(", ")) + "</div>"
      : '<div class="nal">Allergies: none recorded</div>';
    return '<div class="row">' + qrSvg(d.bandValue) + '<div class="txt"><div class="nm">' + esc(d.name) + "</div>" +
      line("MRN", d.mrn) +
      "<div>" + (d.dob ? "<i>DOB</i> " + esc(d.dob) + (d.ageYears != null ? " (" + esc(d.ageYears) + " y)" : "") : d.ageYears != null ? "<i>Age</i> " + esc(d.ageYears) + " y" : "") +
      (d.sex ? " <i>Sex</i> " + esc(d.sex) : "") + "</div>" +
      allergy + "</div></div>";
  }
  /* d: { name, mrn, accessionNumber, test, specimenType, collectedAt, collectedBy } */
  function specimenHtml(d) {
    return '<div class="nm">' + esc(d.name) + (d.mrn ? " <span>" + esc(d.mrn) + "</span>" : "") + "</div>" +
      code128Svg(d.accessionNumber) + '<div class="acc">' + esc(d.accessionNumber) + "</div>" +
      "<div>" + esc(d.test) + (d.specimenType ? " &middot; " + esc(d.specimenType) : "") + "</div>" +
      "<div><i>Coll</i> " + esc(d.collectedAt) + (d.collectedBy ? " <i>by</i> " + esc(d.collectedBy) : "") + "</div>";
  }
  /* d: { name, mrn, drug, dose, route, frequency, quantity, batch, expiry, dispensedAt, dispensedBy } */
  function pharmacyHtml(d) {
    return '<div class="nm">' + esc(d.name) + (d.mrn ? " <span>" + esc(d.mrn) + "</span>" : "") + "</div>" +
      '<div class="drug">' + esc(d.drug) + "</div>" +
      "<div>" + esc([d.dose, d.route, d.frequency].filter(Boolean).join(" · ")) + "</div>" +
      line("Qty", d.quantity) +
      "<div>" + (d.batch ? "<i>Batch</i> " + esc(d.batch) + " " : "") + (d.expiry ? "<i>Exp</i> " + esc(d.expiry) : "") + "</div>" +
      "<div><i>Dispensed</i> " + esc(d.dispensedAt) + (d.dispensedBy ? " <i>by</i> " + esc(d.dispensedBy) : "") + "</div>";
  }
  /* d: { hospital, name, mrn, ageYears, sex, ward, bed, issuedAt } */
  function slipHtml(d) {
    return (d.hospital ? '<div class="hosp">' + esc(d.hospital) + "</div>" : "") +
      '<div class="nm">' + esc(d.name) + "</div>" +
      "<div>" + (d.ageYears != null ? esc(d.ageYears) + " y " : "") + esc(d.sex || "") + "</div>" +
      code128Svg(d.mrn) + '<div class="acc">' + esc(d.mrn) + "</div>" +
      (d.ward ? "<div><i>Ward</i> " + esc(d.ward) + (d.bed ? " <i>bed</i> " + esc(d.bed) : "") + "</div>" : "") +
      "<div><i>Issued</i> " + esc(d.issuedAt) + "</div>";
  }
  var RENDER = { wristband: wristbandHtml, specimen: specimenHtml, pharmacy: pharmacyHtml, slip: slipHtml };
  /* A whole print document: the page IS the label (@page size, no margin), so the browser prints only the label. */
  function labelDocument(kind, data, sizes) {
    var sz = sizeOf(kind, sizes), h = sz.heightMm, pad = 1.5, inner = h - pad * 2;
    var base = Math.max(5, Math.min(11, h / 5.5));
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>" + esc(kind) + " label</title><style>" +
      "@page{size:" + sz.widthMm + "mm " + sz.heightMm + "mm;margin:0}" +
      "html,body{margin:0;padding:0;background:#fff;color:#000}" +
      ".lbl{box-sizing:border-box;width:" + sz.widthMm + "mm;height:" + sz.heightMm + "mm;padding:" + pad + "mm;overflow:hidden;font:" + base + "pt/1.15 Arial,Helvetica,sans-serif;page-break-after:avoid;break-after:avoid}" +
      ".lbl i{font-style:normal;font-weight:700}.lbl div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".row{display:flex;gap:1.5mm;height:100%}.row .qr{flex:none;width:" + inner + "mm;height:" + inner + "mm}.txt{min-width:0;flex:1}" +
      ".nm{font-weight:700;font-size:" + (base * 1.2).toFixed(1) + "pt}.nm span{font-weight:400;font-size:" + base + "pt}" +
      ".al{background:#000;color:#fff;font-weight:700;padding:0 1mm}.nal{border:0.3mm solid #000;padding:0 1mm}" +
      ".bc{display:block;width:100%;height:" + Math.max(6, Math.round(h * 0.32)) + "mm;margin:0.5mm 0}" +
      ".acc{font-family:'Courier New',monospace;font-weight:700;text-align:center}.drug{font-weight:700;font-size:" + (base * 1.3).toFixed(1) + "pt}" +
      ".hosp{font-weight:700;text-transform:uppercase}" +
      "</style></head><body><div class=\"lbl " + esc(kind) + "\">" + RENDER[kind](data || {}) + "</div></body></html>";
  }
  /* Prints one label through a hidden frame, so the page behind it never reaches the printer. Returns false when
   * this browser could not start printing, so the screen can say so rather than claim it printed. */
  function printDocument(doc) {
    if (typeof document === "undefined" || !document.body) return false;
    var f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true"); f.setAttribute("tabindex", "-1");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(f);
    try {
      var w = f.contentWindow;
      w.document.open(); w.document.write(doc); w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000); }, 50);
      return true;
    } catch (e) {
      if (f.parentNode) f.parentNode.removeChild(f);
      return false;
    }
  }
  function print(kind, data, sizes) {
    if (!RENDER[kind]) return false;
    var doc;
    try { doc = labelDocument(kind, data, sizes); } catch (e) { return false; }
    return API.printDocument(doc);
  }

  /* ---- camera ---------------------------------------------------------------------------------------------- */
  function cameraSupported() {
    var n = G.navigator;
    return typeof G.BarcodeDetector === "function" && !!(n && n.mediaDevices && typeof n.mediaDevices.getUserMedia === "function");
  }
  /* Resolves { code } with what was read, { cancelled: true }, or { error: "unsupported" | "denied" | "failed" }.
   * tr(key, english) words the overlay in the staff language; without one it is English. */
  function scan(tr) {
    var t = typeof tr === "function" ? tr : function (k, en) { return en; };
    if (!cameraSupported()) return Promise.resolve({ error: "unsupported" });
    return new Promise(function (resolve) {
      var box = document.createElement("div"), stream = null, done = false, timer = null;
      box.className = "w-camscan"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      box.innerHTML = '<div class="w-camscan-in"><video playsinline muted autoplay></video><p>' + esc(t("ward.cam-point-at-code", "Point the camera at the barcode or QR code.")) + "</p>" +
        '<button type="button" class="w-btn ghost">' + esc(t("ward.cancel", "Cancel")) + "</button></div>";
      document.body.appendChild(box);
      var video = box.querySelector("video");
      var finish = function (result) {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        if (stream) stream.getTracks().forEach(function (tk) { try { tk.stop(); } catch (e) {} });
        if (box.parentNode) box.parentNode.removeChild(box);
        resolve(result);
      };
      box.querySelector("button").onclick = function () { finish({ cancelled: true }); };
      var detector;
      try { detector = new G.BarcodeDetector(); } catch (e) { finish({ error: "unsupported" }); return; }
      G.navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
        stream = s;
        if (done) { finish({ cancelled: true }); return; }
        video.srcObject = s;
        var p = video.play && video.play(); if (p && p.catch) p.catch(function () {});
        var tick = function () {
          if (done) return;
          detector.detect(video).then(function (found) {
            var hit = (found || []).filter(function (b) { return b && String(b.rawValue || "").trim(); })[0];
            if (hit) finish({ code: String(hit.rawValue).trim(), format: hit.format || null });
            else timer = setTimeout(tick, 200);
          }, function () { timer = setTimeout(tick, 400); });
        };
        tick();
      }, function (e) {
        finish({ error: e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "failed" });
      });
    });
  }

  var API = {
    code128: code128, code128Values: code128Values, c128Checksum: c128Checksum, code128Svg: code128Svg, C128: C128,
    qr: qr, qrSvg: qrSvg, rsEc: rsEc, formatBits: formatBits, versionBits: versionBits, qrCodewords: qrCodewords,
    DEFAULT_SIZES: DEFAULT_SIZES, sizeOf: sizeOf, labelDocument: labelDocument, printDocument: printDocument, print: print,
    cameraSupported: cameraSupported, scan: scan,
  };
  G.WARD_LABELS = API;
})();
