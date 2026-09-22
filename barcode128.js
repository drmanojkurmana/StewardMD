/* barcode128.js — a minimal, dependency-free Code 128 (subset B) SVG barcode generator.
 * ===========================================================================
 * WHY SUBSET B, AND WHY HERE: clinics paste NFC tags onto patient files and print the same UID
 * as a barcode + QR on the file label. Subset B covers exactly the characters a UID/MRN ever
 * holds (printable ASCII 32-126: A-Z, 0-9, hyphen) with one symbol per character, so there is no
 * reason to carry subset switching. Like pglog-qr.js this is dependency-free on purpose: the
 * app is buildless ES5, and a barcode library would be a dependency for ~100 lines of table.
 *
 * A WRONG BARCODE IS WORSE THAN NO BARCODE — it prints, sticks to a file, and scans as nothing.
 * So the pattern table is checked against the published Code 128 chart in
 * test/opd-nfc-barcode.test.mjs (107 entries, module sums, uniqueness, start/stop anchors), and
 * the checksum path is verified by re-deriving it from the emitted SVG rects.
 *
 * Dual export: module.exports for node tests, window.SMD_BARCODE for the browser.
 */
(function () {
  "use strict";

  /* Symbol value -> bar/space widths (even index = bar, odd = space). Index 106 (stop) has
   * 7 elements and ends with a 2-module bar; every other symbol has 6 elements totalling
   * 11 modules. Values 103-105 are the subset starts; only 104 (Start B) is used here. */
  var PATTERNS = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
    "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
    "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
    "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
    "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
    "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
    "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
    "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
    "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
    "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
    "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
    "211214", "211232", "2331112"
  ];
  var START_B = 104, STOP = 106, MAX_LEN = 64;

  // Subset B: printable ASCII 32-126 maps to values 0-95 by subtracting 32.
  function encodeB(text) {
    if (typeof text !== "string" || !text.length) throw new Error("barcode128: text must be a non-empty string");
    if (text.length > MAX_LEN) throw new Error("barcode128: text too long (max " + MAX_LEN + " chars)");
    var data = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 32 || c > 126) throw new Error("barcode128: unsupported character " + JSON.stringify(text[i]) + " (subset B holds ASCII 32-126)");
      data.push(c - 32);
    }
    var sum = START_B;
    for (var j = 0; j < data.length; j++) sum += data[j] * (j + 1);
    var symbols = [START_B].concat(data, [sum % 103, STOP]);
    return { symbols: symbols, checksum: sum % 103 };
  }

  function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* One <rect> per bar (never per space), so a scanner-grade renderer and the tests both read
   * the same bars the table describes. `quiet` is the blank margin in modules each side. */
  function toSvg(text, opts) {
    opts = opts || {};
    var scale = opts.scale || 2;
    var height = opts.height || 64;
    var quiet = opts.quiet == null ? 10 : opts.quiet;
    var fg = opts.fg || "#000000", bg = opts.bg || "#ffffff";
    var showText = opts.showText !== false;
    var enc = encodeB(text), symbols = enc.symbols;
    var modules = quiet * 2;
    for (var s = 0; s < symbols.length; s++) modules += (symbols[s] === STOP ? 13 : 11);
    var W = modules * scale, textLine = showText ? 14 : 0, barH = height - textLine;
    if (barH <= 0) throw new Error("barcode128: height too small for the caption line");
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + height + '" width="' + W + '" height="' + height + '" role="img">';
    out += "<title>" + escXml(text) + "</title>";
    out += '<rect x="0" y="0" width="' + W + '" height="' + height + '" fill="' + bg + '"/>';
    var x = quiet * scale;
    for (var k = 0; k < symbols.length; k++) {
      var pat = PATTERNS[symbols[k]];
      for (var e = 0; e < pat.length; e++) {
        var w = (+pat.charAt(e)) * scale;
        if (e % 2 === 0) out += '<rect x="' + x + '" y="0" width="' + w + '" height="' + barH + '" fill="' + fg + '"/>';
        x += w;
      }
    }
    if (showText) {
      out += '<text x="' + (W / 2) + '" y="' + (height - 2) + '" text-anchor="middle" font-family="monospace" font-size="11" fill="' + fg + '">' + escXml(text) + "</text>";
    }
    return out + "</svg>";
  }

  function toDataUri(text, opts) {
    // encodeURIComponent, not base64: keeps the SVG readable in a data: URI and avoids btoa's
    // Latin-1 limitation entirely (same reason as pglog-qr.js).
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(toSvg(text, opts));
  }

  var API = {
    toSvg: toSvg, toDataUri: toDataUri,
    // exported for the tests that check them against the published chart
    _encode: encodeB, _patterns: PATTERNS, _startB: START_B, _stop: STOP
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_BARCODE = API;
})();
