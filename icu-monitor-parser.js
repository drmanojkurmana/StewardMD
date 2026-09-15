/* icu-monitor-parser.js — ICU bedside-monitor value extraction over a 2-D OCR observation graph.
 *
 * Input: Apple Vision (or any OCR) observations {text, conf, x, y, w, h, q?} in NORMALIZED top-left
 * coordinates (q = the recognizer's quadrilateral, when available), plus optionally a pixel source for
 * colour and image-quality measures. Output: per-field {value, status, confidence, evidence,
 * candidates}. Statuses:
 *   AUTO_ACCEPTED  enough independent evidence to auto-fill (never size alone, never colour alone)
 *   NEEDS_REVIEW   candidates exist but evidence is thin, two candidates are too close, the source is
 *                  not identified, the OCR scales disagree, or the photo must be retaken
 *   NOT_FOUND      nothing readable for this field (value null; the clinician fills it)
 * Hard rules: MAP is only ever a displayed "(MM)" value, never computed; Pulse is only ever a displayed
 * Pulse/PR value, never copied from HR; ART and NIBP are never merged; a missing value is never 0; OCR
 * text order is never the association mechanism. Colour and layout are supporting signals with a
 * NEUTRAL contribution when unreliable or unknown.
 *
 * Two-scale OCR (v2.1): the caller runs OCR on the full image, asks monitorRegion() for the numeric
 * area, runs OCR again on that crop at a higher scale, maps it back with mapCropObservations() and
 * unions both with mergeObservations(). parseMonitor() works on the merged list.
 *
 * Loaded by the WebView (window.SMD_ICU_MONITOR), by Node tests and by bench/icu-monitor. ES5. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SMD_ICU_MONITOR = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "2.1.0";

  /* ------------------------------------------------------------------ vocabulary */
  var FIELDS = {
    hr:    { lo: 25, hi: 240, int: true },
    spo2:  { lo: 50, hi: 100, int: true },
    rr:    { lo: 4,  hi: 70,  int: true },
    pulse: { lo: 25, hi: 240, int: true },
    temp:  { lo: 33, hi: 43,  dec: true },
    etco2: { lo: 5,  hi: 80 },
    cvp:   { lo: 0,  hi: 30 },
    pvc:   { lo: 0,  hi: 99,  int: true }
  };
  var PRIMARY = { hr: 1, spo2: 1, rr: 1 };
  // [strong regex, fuzzy regex]. Strong = the canonical label; fuzzy = what OCR makes of it. A label
  // token may be glued to its number by the OCR ("PR72", "PVC 0"), so a digit may follow directly.
  var LABELS = {
    hr:    [/\b(?:HR|Heart\s*Rate)(?=\b|\d)/,            /\b(?:H\s*R)(?=\b|\d)/i],
    spo2:  [/Sp\s*O\s*[2₂]/i,                            /Sp\s*[O0oQ]\s*[2zZ₂]|\bSaO2\b|\bSp02\b/i],
    rr:    [/\b(?:RR|Resp|RESP|awRR|Resp\w*)(?=\b|\d)/,  /\b(?:R\s*R|RESP\w*)(?=\b|\d)/i],
    pulse: [/\b(?:Pulse|PULSE|PR)(?=\b|\d)/,             /\bPuls\w*(?=\b|\d)/i],
    temp:  [/\b(?:Temp|TEMP|Tcore|T1|T2)(?=\b|\d)/,      /\bT\s*emp\w*(?=\b|\d)/i],
    etco2: [/\b(?:EtCO2|etCO2|etCO₂|ETCO2|EtCO₂)(?=\b|\d)/,    /\bCO\s*2\b/i],
    cvp:   [/\bCVP(?=\b|\d)/,                            /\bC\s*V\s*P\b/i],
    pvc:   [/\bPVCs?(?=\b|\d)/,                          /\bP\s*V\s*C\b/i]
  };
  // Plain "IBP" is NOT an arterial source: it is what a clipped or partly occluded "NIBP" reads as (ext-mocr-036: the
  // "N" was outside the photo and the NIBP reading auto-filled as ART, 2026-09-15). A numbered channel ("IBP1") still is.
  var PRESSURE_SRC = { art: /\b(?:ART|ABP|Art|ARTI|IBP\d|P1)\b/, nibp: /\b(?:NIBP|NBP|NI\s*BP)\b/i, pap: /\b(?:PAP|PA\s*P)\b/ };
  /* Pass-3 rules (2026-09-15), each switchable for ablation: opts.disable = ["pap", ...].
   *   norm     Cyrillic / Greek look-alike letters in LABEL text read as Latin (Vision: "АВP", "грm")
   *   vocab    etCO2, Puise, 8p02, aWRR spellings seen on real monitor photos
   *   ecg      a standalone "ECG" token labels HR (Mindray-style tiles: "ECG" + "bpm")
   *   (edge)   a pressure-source label touching the photo edge is weak evidence, never proof
   *   pap      PAP is a pulmonary pressure: never SBP/DBP/MAP, never a competing arterial reading
   *   onelabel one pressure-source label serves only its nearest reading
   *   limit1   a small number directly left of a much larger value is that value's alarm limit
   *   mapcheck displayed MAP vs (SBP + 2 DBP) / 3 as a consistency check only (never fills MAP) */
  var FEATURES = ["norm", "vocab", "ecg", "pap", "onelabel", "limit1", "mapcheck", "color", "detector"];   // "color": ablation switch for colour evidence (on by default, predates pass 3)
  var MAP_CONSISTENCY_TOL = 25;   // mmHg; displayed-vs-formula spread on 212 labelled readings: median 3, max 15.3
  function on(opts, f) { return !(opts && opts.disable && opts.disable.indexOf(f) >= 0); }
  var LOOKALIKE = { "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "г": "r", "Г": "r",
    "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Ζ": "Z", "ο": "o", "₂": "2" };
  function latin(t) { return String(t).replace(/[\u0370-\u03FF\u0400-\u04FF\u2082]/g, function (c) { return LOOKALIKE[c] || c; }); }
  var VOCAB = { etco2: /\b[Ee][Tt]\s*C\s*O\s*2(?=\b|\d)/, pulse: /\bPu[iíl1I|]se(?=\b|\d)/i, spo2: /(?:^|\W)[S58]p\s*[O0oQ]\s*[2zZ]/, rr: /\ba\s*[wW]\s*RR(?=\b|\d)/ };
  var GENERIC_ORDER = ["hr", "spo2", "pressure", "rr", "temp"];
  var PROFILES = {
    "philips-intellivue": { sig: /IntelliVue|Philips|Main\s*Screen|Main\s*Setup|Screen\s+[A-E]\b/i, order: GENERIC_ORDER },
    "ge-carescape":       { sig: /CARESCAPE|NBP\s*Go|Admit\s*\/?\s*Discharge|Monitor\s*Setup/i,     order: GENERIC_ORDER },
    "draeger-infinity":   { sig: /Infinity|Dr[aä]e?ger/i,                                           order: GENERIC_ORDER },
    "mindray-beneview":   { sig: /BeneView|Mindray|\bPI\b/i,                                         order: GENERIC_ORDER },
    "nihon-kohden":       { sig: /Nihon|Kohden/i,                                                    order: GENERIC_ORDER }
  };
  var W = { spatial: 0.22, size: 0.22, align: 0.08, label: 0.16, layout: 0.12, color: 0.10, plaus: 0.10 };
  /* Field-specific thresholds. Not one number: HR is the largest, best-separated numeral on every
   * layout; RR is the field most often confused with EtCO2 / Temp / a respiratory-rate limit; PVC and
   * Pulse are small and sit among limit and ST numbers. The benchmark sweeps these (bench --sweep). */
  var THRESH = {
    hr:       { conf: 0.80, margin: 0.12 },
    spo2:     { conf: 0.82, margin: 0.12 },
    rr:       { conf: 0.85, margin: 0.15 },
    pulse:    { conf: 0.85, margin: 0.15 },
    pvc:      { conf: 0.88, margin: 0.15 },
    temp:     { conf: 0.85, margin: 0.15 },
    etco2:    { conf: 0.88, margin: 0.15 },
    cvp:      { conf: 0.88, margin: 0.15 },
    pressure: { conf: 0.80 },
    map:      { conf: 0.85 }
  };
  var DEGRADED_BUMP = 0.05;
  // Quality gate thresholds (see assessQuality). Severe → RETAKE_PHOTO, moderate → DEGRADED.
  var QUALITY = {
    minValuePx: 14, lowValuePx: 22,     // tallest value text height in source pixels
    blurSevere: 1.6, blurModerate: 1.0,   // edge transition width / expected stroke width
    glareSevere: 0.35, glareModerate: 0.18, // near-white fraction of the numeric region
    tiltSevere: 18, tiltModerate: 8,      // degrees, median text-line angle
    skewSevere: 12, skewModerate: 6,      // degrees, spread of text-line angles (perspective)
    lowConfSevere: 0.30, lowConfModerate: 0.45
  };

  /* ------------------------------------------------------------------ helpers */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function nums(t) {
    return (String(t).replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ").replace(/\d+(?:\.\d+)?\s*mm\/s/gi, " ").match(/-?\d{1,3}(?:\.\d)?/g) || []).map(parseFloat);
  }
  function isClock(t) { return /\b\d{1,2}\s*:\s*\d{2}\b/.test(t); }
  function isDate(t) { return /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/.test(t); }
  // "** RR HIGH" is a banner; "*105" is a value with the alarm-bell glyph glued on (letters decide).
  function isBanner(t) { return /^\W*\*{1,3}\s*[A-Za-z]/.test(t) || /\b(?:HIGH|LOW|ALARM|APNEA|ASYSTOLE|LEADS?\s*OFF)\b/i.test(t); }
  // "SSS/DD" plus two OCR repairs that only ever produce a SUGGESTION (the field stays NEEDS_REVIEW):
  // a leading 1 read as T/I/l ("T18/76" → 118/76) and a split hundreds digit ("1 08/64", "NBP1 30/85").
  function pressureMatch(t) {
    if (isDate(t)) return null;
    var s = String(t), m = s.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (m) {
      var pre = s.slice(0, m.index), r = null;
      if (m[1].length === 2 && /[TIl|]$/.test(pre)) r = { s: 100 + +m[1], d: +m[2], repaired: "leading 1 read as " + pre.slice(-1) };
      else if (m[1].length === 2 && /(?:^|\D)([12])\s+$/.test(pre)) r = { s: +RegExp.$1 * 100 + +m[1], d: +m[2], repaired: "split hundreds digit" };
      return r || { s: +m[1], d: +m[2] };
    }
    return null;
  }
  function pressureSourceInBox(t) {
    var pre = String(t).split(/\d{1,3}\s*\/\s*\d/)[0] || "";
    if (/\b(?:ART|ABP|IBP\d|P1)\b/.test(pre)) return { src: "art", strength: 1 };
    if (/\b(?:NIBP|NBP)\b/i.test(pre)) return { src: "nibp", strength: 1 };
    if (/\bPAP\b/.test(pre)) return { src: "pap", strength: 1 };
    if (/\bNB\W*$/i.test(pre) || /\bNI\s*BP/i.test(pre)) return { src: "nibp", strength: 0.8 };
    return null;
  }
  function parenMatch(t) { var m = String(t).match(/\(\s*(\d{2,3})\s*\)/); return m ? +m[1] : null; }
  function lastInRange(t, f) { var n = nums(t), v = null; for (var i = 0; i < n.length; i++) if (n[i] >= f.lo && n[i] <= f.hi) v = n[i]; return v; }
  function valueLike(t, f) { var n = nums(t); return !/[A-Za-z]{2,}/.test(String(t).replace(/mm\/s|bpm|rpm|mmHg/gi, "")) && n.length >= 1 && n.length <= 2 && n[n.length - 1] >= f.lo && n[n.length - 1] <= f.hi; }
  function hueDist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h: h, s: mx ? d / mx : 0, v: mx };
  }
  function assign(a) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) a[k] = s[k]; } return a; }
  function median(xs) { if (!xs.length) return null; var s = xs.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  /* ------------------------------------------------------------------ two-scale OCR */
  // Normalized alnum text, with letters that sit next to a digit mapped to the digit they are usually
  // misread from. Used ONLY to decide whether two OCR readings agree, never as a reading itself.
  var CONFUSE = { T: "1", I: "1", l: "1", "|": "1", i: "1", O: "0", o: "0", D: "0", S: "5", s: "5", B: "8", Z: "2", z: "2", g: "9", q: "9" };
  function digitsOf(t) {
    var s = String(t), out = "";
    for (var k = 0; k < s.length; k++) {
      var c = s[k];
      if (c >= "0" && c <= "9") { out += c; continue; }
      if (CONFUSE[c] && ((k > 0 && /\d/.test(s[k - 1])) || (k + 1 < s.length && /\d/.test(s[k + 1])))) out += CONFUSE[c];
    }
    return out;
  }
  function normText(t) { return String(t).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }
  // Two readings agree when their digits match, or when their MULTI-DIGIT tokens match exactly: a stray
  // single digit from a glued icon ("2° 100": the SpO2 subscript) is not a different reading, while a
  // split number ("1 08/64" vs "108/64") still is.
  // An OCR engine that reports no confidence (older iOS plugin builds) must stay UNKNOWN, not become 0:
  // a 0 here made the quality gate call every phone photo "unreadable" (2026-09-14 device benchmark).
  function maxConf(a, b) { return a == null ? (b == null ? null : b) : (b == null ? a : Math.max(a, b)); }
  function digitsAgree(a, b) {
    if (digitsOf(a) === digitsOf(b)) return true;
    var ma = (String(a).match(/\d{2,}/g) || []).join(","), mb = (String(b).match(/\d{2,}/g) || []).join(",");
    return !!ma && ma === mb;
  }
  function lev(a, b) {
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) { cur = [i]; for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  function similarity(a, b) { a = normText(a); b = normText(b); var L = Math.max(a.length, b.length); return L ? 1 - lev(a, b) / L : 1; }
  function overlapMin(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    var inter = ix * iy, am = Math.min(a.w * a.h, b.w * b.h);
    return am > 0 ? inter / am : 0;
  }
  /* Where to look again: the numeric area, i.e. the band of large values plus the labels, limits and
   * small secondary values beside them. Returns {x,y,w,h,scale,why} in the full image's normalized
   * frame, or null when the full pass already has no numerics to anchor a crop. `imageSize` is the
   * SOURCE image in pixels (used to pick a scale that makes small labels ~34 px tall, capped). */
  function monitorRegion(obs, imageSize) {
    var G = buildGraph(obs, {});
    var big = G.big;
    if (big.length < 2) return null;
    var minX = 1, minY = 1, maxX = 0, maxY = 0, k;
    for (k = 0; k < big.length; k++) { minX = Math.min(minX, big[k].x); minY = Math.min(minY, big[k].y); maxX = Math.max(maxX, big[k].x + big[k].w); maxY = Math.max(maxY, big[k].y + big[k].h); }
    var bandTop = minY - 3 * G.maxH, bandBot = maxY + 3 * G.maxH, leftLim = minX - 0.40;
    var labelHs = [];
    for (k = 0; k < G.B.length; k++) {
      var b = G.B[k];
      if (b.role === "clock" || b.role === "date") continue;
      if (b.cy < bandTop || b.cy > bandBot || b.x < leftLim) continue;
      if (b.labels.length || b.role === "limit" || b.role === "limitRange" || b.role === "numeric" || b.role === "pressure" || b.role === "paren") {
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
        if (b.labels.length && b.t.length <= 12) labelHs.push(b.h);
      }
    }
    var m = 0.02;
    var x = clamp(minX - m, 0, 1), y = clamp(minY - m, 0, 1), x2 = clamp(maxX + m, 0, 1), y2 = clamp(maxY + m, 0, 1);
    var reg = { x: x, y: y, w: x2 - x, h: y2 - y };
    var SW = imageSize && imageSize.w || 1000, SH = imageSize && imageSize.h || 1000;
    var labelPx = (labelHs.length ? median(labelHs) : 0.3 * G.maxH) * SH;
    var scale = clamp(34 / Math.max(1, labelPx), 2, 3);
    var longPx = Math.max(reg.w * SW, reg.h * SH);
    scale = Math.min(scale, 3200 / Math.max(1, longPx));
    if (scale < 1.1) return null;
    reg.scale = +scale.toFixed(2);
    reg.why = big.length + " large values; label height " + labelPx.toFixed(0) + " px";
    return reg;
  }
  function mapCropObservations(cropObs, region) {
    return (cropObs || []).map(function (o) {
      var r = assign({}, o, { x: region.x + o.x * region.w, y: region.y + o.y * region.h, w: o.w * region.w, h: o.h * region.h, scale: "crop" });
      if (o.q && o.q.length === 8) r.q = o.q.map(function (v, i) { return i % 2 === 0 ? region.x + v * region.w : region.y + v * region.h; });
      delete r.hpx;
      return r;
    });
  }
  /* Union of the two passes. For every full-pass box:
   *   - crop boxes inside it that together read the same text (digits agreeing after undoing
   *     digit-adjacent confusables) REPLACE it: the crop is finer and higher-resolution;
   *   - one crop box with the same text confirms it (conf = max);
   *   - digits that disagree between the passes mark the box ocrConflict: it can never auto-fill.
   * Crop boxes that overlap nothing are added (recovered small labels / values). */
  function mergeObservations(full, crop) {
    full = (full || []).map(function (o) { return assign({}, o, { scale: o.scale || "full" }); });
    crop = crop || [];
    var used = {}, out = [], notes = [];
    // A crop box is PART of a full-pass reading only when it lies inside it AND is at least half its text
    // height: alarm limits and "(MM)" sitting inside a large value's rectangle are separate objects, and
    // folding them in turned every core field into a false scale conflict (2026-09-14 benchmark).
    function partOf(f, c) { return overlapMin(f, c) > 0.5 && c.h >= 0.5 * f.h && c.h <= 1.8 * f.h; }
    // first give every crop box to the full box it matches best, so a crop box is never counted twice
    var owner = {};
    crop.forEach(function (c, ci) {
      var best = -1, bestO = 0;
      full.forEach(function (f, fi) { if (partOf(f, c)) { var o = overlapMin(f, c); if (o > bestO) { bestO = o; best = fi; } } });
      if (best >= 0) owner[ci] = best;
    });
    full.forEach(function (f, fi) {
      var inside = [];
      crop.forEach(function (c, ci) { if (owner[ci] === fi) inside.push(ci); });
      if (!inside.length) { out.push(f); return; }
      var cs = inside.map(function (ci) { return crop[ci]; }).sort(function (a, b) { return (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5) ? a.x - b.x : a.y - b.y; });
      var joined = cs.map(function (c) { return c.text; }).join(" ");
      var dF = digitsOf(f.text), dC = digitsOf(joined);
      inside.forEach(function (ci) { used[ci] = true; });
      if (dF === dC || (dF && dC && digitsAgree(f.text, joined))) {
        // same numbers at both scales: one crop box CONFIRMS the full box (letter noise like "WN 22" is
        // not a disagreement); several crop boxes are a finer split (label separated from value)
        // ...unless that one crop box is clearly narrower: the crop separated a fused label ("ART T18/76"
        // → "118/76 (90)"; the small "ART" is added on its own as a recovered box)
        if (cs.length === 1 && !(cs[0].w < 0.85 * f.w && normText(cs[0].text) !== normText(f.text))) { out.push(assign(f, { conf: maxConf(f.conf, cs[0].conf), scale: "both", confirmed: true })); return; }
        if (normText(joined) !== normText(f.text)) notes.push("crop re-read " + JSON.stringify(f.text) + " as " + JSON.stringify(joined));
        cs.forEach(function (c) { out.push(assign({}, c, { scale: "crop", replaced: f.text, confirmed: !!digitsOf(c.text) })); });
        return;
      }
      if (!dF && !dC) {
        // no numbers either way: prefer the reading that is a known label, else the crop's finer split
        cs.forEach(function (c) { out.push(assign({}, c, { scale: "crop", replaced: f.text })); });
        return;
      }
      notes.push("OCR scales disagree: " + JSON.stringify(f.text) + " vs " + JSON.stringify(joined));
      out.push(assign(f, { ocrConflict: joined }));
    });
    crop.forEach(function (c, ci) {
      if (used[ci]) return;
      // an unowned crop box re-reading the same digits as an overlapping full box (offset / height
      // mismatch) confirms that box instead of duplicating it
      var dc = digitsOf(c.text), twin = dc ? out.filter(function (o) { return o.scale !== "crop" && overlapMin(o, c) > 0.3 && digitsAgree(o.text, c.text); })[0] : null;
      if (twin) { twin.confirmed = true; twin.scale = "both"; return; }
      out.push(assign({}, c, { scale: "crop", recovered: true }));
    });
    out.notes = notes;
    return out;
  }

  /* Confirmation read (third, optional pass). The region crop is scaled for small LABELS; a large value it
   * failed to read ("22" on the 2x MP40 came back as waveform "WN") stays unconfirmed. confirmationRegion
   * returns a tight crop around the still-unconfirmed large values, scaled so the numerals are ~110 px tall;
   * applyConfirmation may ONLY mark an existing box confirmed (same digits) or conflicted (different
   * digits). It never adds a value, so it cannot introduce a reading the first two passes did not make. */
  function confirmationRegion(obs, imageSize) {
    var G = buildGraph(obs, {}), SH = imageSize && imageSize.h || 1000, SW = imageSize && imageSize.w || 1000;
    var targets = G.B.filter(function (b) { return (b.role === "numeric" || b.role === "pressure") && b.h >= G.maxH * 0.55 && !b.confirmed && !b.conflict; });
    if (!targets.length) return null;
    var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    targets.forEach(function (b) { x0 = Math.min(x0, b.x - b.w * 0.25); y0 = Math.min(y0, b.y - b.h * 0.4); x1 = Math.max(x1, b.x + b.w * 1.25); y1 = Math.max(y1, b.y + b.h * 1.4); });
    var reg = { x: clamp(x0, 0, 1), y: clamp(y0, 0, 1) }; reg.w = clamp(x1, 0, 1) - reg.x; reg.h = clamp(y1, 0, 1) - reg.y;
    var valPx = median(targets.map(function (b) { return b.h; })) * SH;
    var scale = clamp(110 / Math.max(1, valPx), 1.2, 4);
    scale = Math.min(scale, 3200 / Math.max(1, Math.max(reg.w * SW, reg.h * SH)));
    if (scale < 1.05) scale = 1.05;
    reg.scale = +scale.toFixed(2); reg.targets = targets.map(function (b) { return b.t; });
    return reg;
  }
  function applyConfirmation(obs, confirmObs) {
    var notes = (obs.notes || []).slice();
    var out = obs.map(function (o) { return assign({}, o); });
    out.forEach(function (o) {
      var d = digitsOf(o.text); if (!d || o.confirmed || o.ocrConflict) return;
      var same = null, diff = null;
      (confirmObs || []).forEach(function (c) {
        if (overlapMin(o, c) < 0.3 || c.h < 0.5 * o.h) return;
        var dc = digitsOf(c.text); if (!dc) return;
        if (digitsAgree(o.text, c.text)) same = c; else if (!same) diff = c;
      });
      if (same) { o.confirmed = true; o.confirmedBy = "confirmation read"; }
      else if (diff) { o.ocrConflict = diff.text; notes.push("confirmation read disagrees: " + JSON.stringify(o.text) + " vs " + JSON.stringify(diff.text)); }
    });
    out.notes = notes;
    return out;
  }

  /* Tile reads (on-device detector). A detector tile with no digits read inside it gets its own two crops of the
   * ORIGINAL at two different scales: read A is unioned in (mergeObservations, values enter UNCONFIRMED), read B
   * can only confirm identical digits (applyConfirmation). No new trust path: every parser gate still applies.
   * Returns [{x,y,w,h,scale,scaleB,cls}] in the full image frame, best tile first, at most `max` (default 4). */
  var TILE_MIN = 0.5, TILE_CLS = { hr: 1, spo2: 1, rr: 1, pulse: 1, etco2: 1 };   // pressures need a source label anyway
  function tileRegions(obs, detections, imageSize, max) {
    var SW = imageSize && imageSize.w || 1000, SH = imageSize && imageSize.h || 1000, out = [];
    (detections || []).filter(function (d) { return d && TILE_CLS[d.cls] && d.conf >= TILE_MIN && d.w > 0 && d.h > 0; })
      .sort(function (a, b) { return b.conf - a.conf; })
      .forEach(function (d) {
        // any digits already overlapping the tile: a crop would only cut through them (a cut "150/54" read "I54")
        var read = (obs || []).some(function (o) { return digitsOf(o.text) && overlapMin(o, d) > 0.2; });
        if (read || out.some(function (r) { return overlapMin(r.core, d) > 0.5; })) return;
        var px = d.w * 0.15, py = d.h * 0.2;
        var reg = { x: clamp(d.x - px, 0, 1), y: clamp(d.y - py, 0, 1), cls: d.cls, core: { x: d.x, y: d.y, w: d.w, h: d.h } };
        reg.w = clamp(d.x + d.w + px, 0, 1) - reg.x; reg.h = clamp(d.y + d.h + py, 0, 1) - reg.y;
        var hPx = reg.h * SH, longPx = Math.max(reg.w * SW, hPx);
        // tile ~260 px tall for read A, ~400 px for read B; never downscale, cap the long edge at 1600 px
        var cap = 1600 / Math.max(1, longPx);
        reg.scale = +Math.max(1, Math.min(260 / Math.max(1, hPx), cap)).toFixed(2);
        reg.scaleB = +Math.max(1.05, Math.min(400 / Math.max(1, hPx), cap)).toFixed(2);
        if (reg.scaleB === reg.scale) reg.scaleB = +(reg.scale * 1.3).toFixed(2);
        out.push(reg);
      });
    return out.slice(0, max || 4);
  }
  // A tile read's boxes (already mapped to the full frame) that belong to the tile: centre inside the detector box.
  function tileObservations(mapped, region) {
    var c = region && region.core; if (!c) return mapped || [];
    return (mapped || []).filter(function (o) { var cx = o.x + o.w / 2, cy = o.y + o.h / 2; return cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h; });
  }

  /* ------------------------------------------------------------------ colour sampling
   * ONE implementation for the app (canvas ImageData) and the benchmark (decoded RGB). `px` is
   * { w, h, get(x, y) -> [r, g, b] } in PIXELS. Text pixels = bright and saturated; white text is a
   * class of its own. Unreliable when too few text pixels or the hue is spread out (glare, mixed). */
  function circularMean(hues) {
    var sx = 0, sy = 0; for (var i = 0; i < hues.length; i++) { var a = hues[i] * Math.PI / 180; sx += Math.cos(a); sy += Math.sin(a); }
    var n = hues.length || 1, R = Math.sqrt(sx * sx + sy * sy) / n, h = Math.atan2(sy, sx) * 180 / Math.PI; if (h < 0) h += 360;
    return { h: h, R: R };
  }
  function sampleRegion(px, x0, y0, x1, y1, maxSamples) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(px.w - 1, Math.ceil(x1)); y1 = Math.min(px.h - 1, Math.ceil(y1));
    var area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1)), step = Math.max(1, Math.floor(Math.sqrt(area / (maxSamples || 600))));
    var colored = [], white = 0, total = 0, sSum = 0, vSum = 0;
    for (var y = y0; y <= y1; y += step) for (var x = x0; x <= x1; x += step) {
      var c = px.get(x, y); if (!c) continue; total++;
      var hsv = rgbToHsv(c[0], c[1], c[2]);
      if (hsv.v > 0.45 && hsv.s > 0.22) { colored.push(hsv.h); sSum += hsv.s; vSum += hsv.v; }
      else if (hsv.v > 0.62 && hsv.s < 0.16) white++;
    }
    var out = { total: total, colored: colored.length, white: white, reliable: false, kind: "none", h: null, s: 0, v: 0, R: 0, share: 0 };
    if (colored.length >= 12 && colored.length >= white * 0.6) {
      var bins = new Array(24), k; for (k = 0; k < 24; k++) bins[k] = 0;
      for (k = 0; k < colored.length; k++) bins[Math.floor(colored[k] / 15) % 24]++;
      var peak = 0, peakSum = -1;
      for (k = 0; k < 24; k++) { var s3 = bins[(k + 23) % 24] + bins[k] + bins[(k + 1) % 24]; if (s3 > peakSum) { peakSum = s3; peak = k; } }
      var centre = peak * 15 + 7.5, members = [];
      for (k = 0; k < colored.length; k++) if (hueDist(colored[k], centre) <= 24) members.push(colored[k]);
      var cm = circularMean(members.length ? members : colored);
      out.h = cm.h; out.R = cm.R; out.share = members.length / colored.length; out.s = sSum / colored.length; out.v = vSum / colored.length;
      out.kind = "colored"; out.reliable = out.share >= 0.55 && members.length >= 10;
    } else if (white >= 12) { out.kind = "white"; out.reliable = true; }
    out.whiteFrac = total ? white / total : 0;
    return out;
  }
  function sampleColors(obs, px) {
    if (!px || !px.get || !px.w || !px.h) return obs;
    for (var i = 0; i < obs.length; i++) {
      var b = obs[i]; if (b.color) continue;
      var X = b.x * px.w, Y = b.y * px.h, Wd = b.w * px.w, Ht = b.h * px.h;
      b.color = sampleRegion(px, X + Wd * 0.1, Y + Ht * 0.12, X + Wd * 0.9, Y + Ht * 0.88, 500);
    }
    return obs;
  }
  function channelColor(label, px) {
    if (!px || !px.get) return { reliable: false };
    var yc = (label.y + label.h / 2) * px.h, band = Math.max(label.h * 3, 0.03) * px.h;
    var x1 = (label.x - 0.03) * px.w; if (x1 < px.w * 0.15) return { reliable: false };
    return sampleRegion(px, px.w * 0.03, yc - band, x1, yc + band, 900);
  }
  function channelColorAtValue(box, px) {
    if (!px || !px.get) return { reliable: false };
    var y0 = (box.y - box.h * 0.5) * px.h, y1 = (box.y + box.h) * px.h;
    var x1 = (box.x - 0.03) * px.w; if (x1 < px.w * 0.15) return { reliable: false };
    var near = sampleRegion(px, x1 * 0.55, y0, x1, y1, 700), full = sampleRegion(px, px.w * 0.03, y0, x1, y1, 900);
    if (near.reliable && near.share >= (full.share || 0)) return near;
    return full.reliable ? full : near;
  }
  function colorCompat(a, b) {
    if (!a || !b || !a.reliable || !b.reliable) return { score: 0.5, neutral: true, why: "unreliable or unknown colour" };
    if (a.kind === "white" && b.kind === "white") return { score: 1, neutral: false, why: "both white" };
    if (a.kind !== b.kind) return { score: 0.5, neutral: true, why: a.kind + " vs " + b.kind + " (neutral)" };
    var d = hueDist(a.h, b.h);
    return { score: 1 - clamp((d - 12) / 55, 0, 1), neutral: false, why: "hue distance " + d.toFixed(0) + "°" };
  }

  /* ------------------------------------------------------------------ image-quality gate */
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  // Edge transition width across value strokes, relative to the stroke width expected for that text
  // height. Sharp text steps over ~1-2 px whatever its size; blur widens the step. ~1 = strokes smeared.
  function blurOf(box, px) {
    var X0 = Math.floor(box.x * px.w), X1 = Math.ceil((box.x + box.w) * px.w), Y0 = box.y * px.h, Hp = box.h * px.h;
    if (Hp < 8 || X1 - X0 < 8) return null;
    var widths = [];
    for (var r = 1; r <= 7; r++) {
      var y = Math.round(Y0 + Hp * r / 8), row = [], mx = -1, mn = 999, maxG = 0;
      for (var x = X0; x <= X1; x++) { var c = px.get(x, y); if (!c) continue; var l = lum(c); row.push(l); if (l > mx) mx = l; if (l < mn) mn = l; }
      for (var k = 1; k < row.length; k++) maxG = Math.max(maxG, Math.abs(row[k] - row[k - 1]));
      if (mx - mn >= 45 && maxG > 0) widths.push((mx - mn) / maxG);
    }
    if (widths.length < 3) return null;
    return median(widths) / Math.max(1, 0.12 * Hp);
  }
  function tiltOf(obs, imageSize) {
    if (!imageSize || !imageSize.w) return null;
    var angles = [];
    obs.forEach(function (o) {
      if (!o.q || o.q.length !== 8 || o.w < o.h * 2.5) return;
      var dx = (o.q[2] - o.q[0]) * imageSize.w, dy = (o.q[3] - o.q[1]) * imageSize.h;
      if (Math.abs(dx) < 1) return;
      angles.push(Math.atan2(dy, dx) * 180 / Math.PI);
    });
    if (angles.length < 3) return null;
    var s = angles.slice().sort(function (a, b) { return a - b; });
    return { angle: median(angles), spread: s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)], n: angles.length };
  }
  function assessQuality(G, px, opts) {
    var issues = [], Q = assign({}, QUALITY, opts && opts.quality);
    function add(kind, sev, value, thr, msg) { issues.push({ kind: kind, severity: sev, value: value == null ? null : +(+value).toFixed(3), threshold: thr, message: msg }); }
    var srcH = (opts && opts.imageSize && opts.imageSize.h) || (px && px.h) || null;
    var values = G.B.filter(function (b) { return (b.role === "numeric" || b.role === "pressure") && b.h >= G.maxH * 0.55; });
    if (!values.length || (values.length < 2 && !G.B.some(function (b) { return b.role === "pressure"; }))) add("unreadable", "severe", values.length, 2, "no monitor numerics were read");
    if (srcH && G.maxH) {
      var vpx = G.maxH * srcH;
      if (vpx < Q.minValuePx) add("resolution", "severe", vpx, Q.minValuePx, "value text " + vpx.toFixed(0) + " px tall");
      else if (vpx < Q.lowValuePx) add("resolution", "moderate", vpx, Q.lowValuePx, "value text " + vpx.toFixed(0) + " px tall");
    }
    var confs = values.map(function (b) { return b.conf; }).filter(function (c) { return c != null; });
    if (confs.length >= 2) {
      var mc = confs.reduce(function (a, b) { return a + b; }, 0) / confs.length;
      if (mc < Q.lowConfSevere) add("unreadable", "severe", mc, Q.lowConfSevere, "mean OCR confidence of values " + mc.toFixed(2));
      else if (mc < Q.lowConfModerate) add("unreadable", "moderate", mc, Q.lowConfModerate, "mean OCR confidence of values " + mc.toFixed(2));
    }
    if (px && px.get && values.length) {
      var bl = values.map(function (b) { return blurOf(b, px); }).filter(function (v) { return v != null; });
      var mb = median(bl);
      if (mb != null) {
        if (mb >= Q.blurSevere) add("blur", "severe", mb, Q.blurSevere, "text edges smeared");
        else if (mb >= Q.blurModerate) add("blur", "moderate", mb, Q.blurModerate, "text edges soft");
      }
      // glare: near-white share of the numeric region (the band of values)
      var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      values.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      var gs = sampleRegion(px, x0 * px.w, y0 * px.h, x1 * px.w, y1 * px.h, 4000), glare = 0, tot = 0;
      var step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * px.w * (y1 - y0) * px.h) / 4000)));
      for (var yy = Math.floor(y0 * px.h); yy <= y1 * px.h; yy += step) for (var xx = Math.floor(x0 * px.w); xx <= x1 * px.w; xx += step) {
        var c = px.get(xx, yy); if (!c) continue; tot++; var hv = rgbToHsv(c[0], c[1], c[2]); if (hv.v > 0.93 && hv.s < 0.12) glare++;
      }
      var gf = tot ? glare / tot : 0;
      if (gf >= Q.glareSevere) add("glare", "severe", gf, Q.glareSevere, "bright glare over the numerics");
      else if (gf >= Q.glareModerate) add("glare", "moderate", gf, Q.glareModerate, "some glare over the numerics");
      void gs;
    }
    var imgSize = (opts && opts.imageSize) || (px ? { w: px.w, h: px.h } : null);
    var tl = tiltOf(G.B.map(function (b) { return G.src[b.i]; }), imgSize);
    if (tl) {
      // INFORMATIONAL ONLY (2026-09-14 benchmark): Vision's quadrilaterals measured 0° on a 5° rotation,
      // -7° on 12°, nothing on 25°, and a 6° "perspective" on an undistorted photo. A signal that wrong in
      // both directions may not decide RETAKE or DEGRADED; rotated photos are protected instead by the
      // two-pass confirmation rule and the edge / conflict blockers.
      if (Math.abs(tl.angle) >= Q.tiltModerate) add("tilt", "info", tl.angle, Q.tiltModerate, "text lines measured at " + tl.angle.toFixed(0) + "° (unreliable estimate)");
      if (tl.spread >= Q.skewModerate) add("perspective", "info", tl.spread, Q.skewModerate, "text-line angle spread " + tl.spread.toFixed(0) + "° (unreliable estimate)");
    }
    var edge = G.B.filter(function (b) { return b.edge && (b.role === "numeric" || b.role === "pressure"); });
    if (edge.length) add("partial", "moderate", edge.length, 0, "monitor partially cropped: " + edge.map(function (b) { return JSON.stringify(b.t); }).join(", ") + " touch the photo edge");
    var severe = issues.some(function (i) { return i.severity === "severe"; }), moderate = issues.some(function (i) { return i.severity === "moderate"; });
    return { status: severe ? "RETAKE_PHOTO" : moderate ? "DEGRADED" : "OK", issues: issues, blur: mb == null ? null : +mb.toFixed(2), tilt: tl };
  }

  /* ------------------------------------------------------------------ graph */
  function buildGraph(obs, opts) {
    var B = [], src = [], i, o;
    for (i = 0; i < obs.length; i++) {
      o = obs[i]; src[i] = o; if (!o || typeof o.text !== "string") continue;
      var x = +o.x || 0, y = +o.y || 0, w = +o.w || 0, h = +o.h || 0, t = o.text.trim();
      var n = { i: i, t: t, conf: (o.conf == null ? null : +o.conf), x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, color: o.color || null, role: "text", nums: nums(t), labels: [],
        scale: o.scale || null, confirmed: !!(o.confirmed || o.scale === "both"), conflict: o.ocrConflict || null, edge: (x <= 0.004 || y <= 0.004 || x + w >= 0.996 || y + h >= 0.996) };
      if (isClock(t)) n.role = "clock";
      else if (isDate(t)) n.role = "date";
      else if (isBanner(t)) n.role = "banner";
      else if (pressureMatch(t)) { n.role = "pressure"; n.press = pressureMatch(t); n.paren = parenMatch(t); n.gluedSrc = pressureSourceInBox(t); }
      else if (/^\W*\(\s*\d{2,3}\s*\)\W*$/.test(t)) { n.role = "paren"; n.paren = parenMatch(t); }
      else if (/^\W*\d{1,3}\s*-\s*\d{1,3}\W*$/.test(t)) n.role = "limitRange";
      else if (/[▲▼↑↓]/.test(t) && n.nums.length) n.role = "limit";
      else if (n.nums.length && !/[A-Za-z]{3,}/.test(t)) n.role = "numeric";
      var tl = on(opts, "norm") ? latin(t) : t;
      n.tl = tl;
      if (n.role === "pressure") n.gluedSrc = pressureSourceInBox(tl);
      for (var f in LABELS) if (LABELS.hasOwnProperty(f) && n.role !== "banner") {
        if (LABELS[f][0].test(tl)) n.labels.push({ field: f, strength: 1 });
        else if (LABELS[f][1].test(tl) || (on(opts, "vocab") && VOCAB[f] && VOCAB[f].test(tl))) n.labels.push({ field: f, strength: 0.7 });
      }
      if (n.role !== "banner" && on(opts, "ecg") && /^\W*ECG\W*(?:bpm)?\W*$/i.test(tl) && !n.labels.some(function (l) { return l.field === "hr"; })) n.labels.push({ field: "hr", strength: 0.7, via: "ECG" });
      if (n.role !== "pressure") for (var s in PRESSURE_SRC) if (PRESSURE_SRC.hasOwnProperty(s) && (s !== "pap" || on(opts, "pap")) && PRESSURE_SRC[s].test(tl)) n.labels.push({ field: "press:" + s, strength: /ARTI|Art\W/.test(tl) ? 0.7 : 1 });
      B.push(n);
    }
    var maxH = 0, valueBoxes = [];
    for (i = 0; i < B.length; i++) if (B[i].role === "numeric" || B[i].role === "pressure") { valueBoxes.push(B[i]); if (B[i].h > maxH) maxH = B[i].h; }
    var big = valueBoxes.filter(function (b) { return b.h >= maxH * 0.55; }).sort(function (a, b) { return a.cx - b.cx; });
    var colX = big.length ? big[Math.floor(big.length / 2)].cx : null;
    for (i = 0; i < B.length; i++) {
      var b = B[i]; if (b.role !== "numeric" || b.h >= maxH * 0.5) continue;
      if (b.nums.length === 2 && b.nums[0] >= b.nums[1]) { b.role = "limit"; b.limitPair = "pair-in-box"; continue; }
      for (var j = 0; j < B.length; j++) {
        var s2 = B[j]; if (j === i) continue;
        if ((s2.role === "numeric" || s2.role === "limit") && s2.h < maxH * 0.5 && Math.abs(s2.x - b.x) < b.h * 2 && Math.abs(s2.y - b.y) <= b.h * 2.8 && Math.abs(s2.y - b.y) > b.h * 0.5) { b.role = "limit"; b.limitPair = j; break; }
        if (s2.labels.length && !s2.nums.length && b.cy >= s2.y - s2.h * 0.3 && b.cy <= s2.y + s2.h * 1.3 && b.x > s2.x && b.x - (s2.x + s2.w) < s2.h * 10) { b.role = "limit"; b.limitPair = j; break; }
      }
    }
    if (on(opts, "limit1")) for (i = 0; i < B.length; i++) {
      var sm = B[i]; if (sm.role !== "numeric" || sm.h >= maxH * 0.5) continue;
      for (var k2 = 0; k2 < B.length; k2++) {
        var big2 = B[k2]; if (k2 === i || big2.role !== "numeric" || big2.h < sm.h * 2.2) continue;
        var gap = big2.x - (sm.x + sm.w), vOverlap = Math.min(sm.y + sm.h, big2.y + big2.h) - Math.max(sm.y, big2.y);
        if (gap >= -sm.h * 0.3 && gap <= big2.h * 0.6 && vOverlap >= sm.h * 0.5) { sm.role = "limit"; sm.limitPair = "left-of-value " + k2; break; }
      }
    }
    var allText = B.map(function (b) { return b.t; }).join(" \n "), profile = null;
    if (opts && opts.profile && PROFILES[opts.profile]) profile = opts.profile;
    else for (var p in PROFILES) if (PROFILES.hasOwnProperty(p) && PROFILES[p].sig.test(allText)) { profile = p; break; }
    return { opts: opts || {}, B: B, src: src, maxH: maxH, colX: colX, big: big.slice().sort(function (a, b) { return a.y - b.y; }), profile: profile, order: (profile ? PROFILES[profile].order : GENERIC_ORDER) };
  }

  /* ------------------------------------------------------------------ scoring */
  function findLabel(G, field, claimedLabels) {
    var best = null;
    for (var i = 0; i < G.B.length; i++) {
      var b = G.B[i]; if (claimedLabels[b.i]) continue;
      for (var k = 0; k < b.labels.length; k++) if (b.labels[k].field === field) {
        var st = b.labels[k].strength;
        if (!best || st > best.strength || (st === best.strength && b.y < best.box.y)) best = { box: b, strength: st };
      }
    }
    return best;
  }
  function rankInColumn(G, box) {
    var col = G.big.filter(function (b) { return G.colX == null || Math.abs(b.cx - G.colX) < 0.14; });
    for (var i = 0; i < col.length; i++) if (col[i] === box) return i;
    return -1;
  }
  function scoreCandidate(G, field, cand, label, px, chan) {
    var f = FIELDS[field], L = label && label.box, unit = L ? L.h : Math.max(G.maxH * 0.3, 0.01);
    var sc = {}, why = [];
    if (L) {
      var dx = cand.x - L.x, dy = cand.y - L.y;
      var sameRow = Math.abs(dy) <= 1.2 * unit || (cand.y <= L.y + L.h && cand.y + cand.h >= L.y);
      var inTile = dx > -0.5 * unit && dy >= -1.2 * unit && dy <= 5 * unit;
      var sdx = Math.exp(-Math.pow(Math.abs(dx) / ((sameRow || inTile ? 40 : 12) * unit), 2)), sdy = dy < -1.2 * unit && !sameRow ? 0.15 : Math.exp(-Math.pow(Math.max(0, dy) / (4 * unit), 2));
      sc.spatial = sdx * sdy; why.push("dx=" + (dx / unit).toFixed(1) + "u dy=" + (dy / unit).toFixed(1) + "u" + (sameRow ? " same row" : inTile ? " in tile" : ""));
    } else { sc.spatial = 0.5; why.push("no label: spatial neutral"); }
    sc.size = G.maxH ? Math.pow(clamp(cand.h / G.maxH, 0, 1), 0.7) : 0.5;
    sc.labelRel = L ? clamp(cand.h / L.h, 0, 2) : 0;
    var al = L ? 1 - clamp(Math.abs(cand.x - L.x) / 0.15, 0, 1) : 0.5;
    if (G.colX != null) al = Math.max(al, 1 - clamp(Math.abs(cand.cx - G.colX) / 0.10, 0, 1));
    sc.align = al;
    sc.label = L ? label.strength : 0;
    var bpB = G.bpBox, hrB = G.hrBox, rk = rankInColumn(G, cand);
    if (field === "hr") {
      if (bpB) { sc.layout = cand.y < bpB.y ? (rk === 0 ? 1 : 0.7) : 0.2; why.push(cand.y < bpB.y ? "above pressure" + (rk === 0 ? ", topmost" : "") : "below pressure"); }
      else sc.layout = rk === 0 ? 1 : rk < 0 ? 0.5 : 0.55;
    } else if (field === "spo2") {
      var belowHr = hrB ? cand.y > hrB.y : null, aboveBp = bpB ? cand.y < bpB.y : null;
      if (belowHr === false || aboveBp === false) { sc.layout = 0.2; why.push("outside the HR..pressure band"); }
      else if (belowHr && aboveBp) { sc.layout = 1; why.push("between HR and pressure"); }
      else if (belowHr || aboveBp) { sc.layout = 0.8; why.push(belowHr ? "below HR" : "above pressure"); }
      else sc.layout = 0.5;
    } else if (field === "rr") {
      if (bpB) { sc.layout = cand.y > bpB.y ? 1 : 0.2; why.push(cand.y > bpB.y ? "below pressure" : "above pressure"); }
      else sc.layout = 0.5;
    } else sc.layout = 0.5;
    if (!chan && px) { chan = channelColorAtValue(cand, px); why.push("channel sampled at value height"); }
    var noColor = !on(G.opts, "color"), cc = noColor ? { neutral: true, why: "disabled" } : colorCompat(cand.color, L && L.color), ch = noColor ? { neutral: true, why: "disabled" } : colorCompat(cand.color, chan);
    var parts = []; if (!cc.neutral) parts.push(cc.score); else if (!ch.neutral) parts.push(ch.score);
    sc.color = parts.length ? parts[0] : 0.5;
    sc.colorNeutral = !parts.length; sc.colorWhy = "label: " + cc.why + "; channel: " + ch.why + (!cc.neutral && !ch.neutral ? " (label colour used)" : "");
    var v = lastInRange(cand.t, f), pl = v == null ? 0 : 1;
    if (pl && f.int && v !== Math.round(v)) pl = 0.5;
    if (pl && (v === f.lo || v === f.hi)) pl = Math.max(pl - 0.2, 0.3);
    sc.plaus = pl;
    var num = W.size * sc.size + W.align * sc.align + W.layout * sc.layout + W.plaus * sc.plaus, den = W.size + W.align + W.layout + W.plaus;
    if (L) { num += W.spatial * sc.spatial + W.label * sc.label; den += W.spatial + W.label; }
    if (!sc.colorNeutral) { num += W.color * sc.color; den += W.color; }
    var total = num / den;
    var role = cand.role;
    if (role === "limit" || role === "limitRange") { total *= 0.45; why.push("alarm-limit geometry"); }
    if (cand.conf != null && cand.conf < 0.3) { total *= 0.85; why.push("low OCR confidence"); }
    return { box: cand, value: v, score: clamp(total, 0, 1), parts: sc, role: role, why: why, chan: chan };
  }
  /* Two-pass confirmation (2026-09-14). A single Vision pass misread DBP 66 as 86 at confidence 1.0 on
   * a 12°-rotated photo, and no image-quality signal flagged it reliably. So when the caller ran the
   * two-scale pipeline (opts.twoScale = {ran: bool}), every auto-filled NUMBER must be read with the same
   * digits by both passes; if the second pass could not run, nothing numeric auto-fills. Degraded photos
   * require it even from single-scale callers. */
  function needsConfirmation(opts) { return !!(opts && (opts.twoScale || opts.__degraded)); }
  function confirmationReason(opts) {
    if (opts && opts.twoScale && !opts.twoScale.ran) return "second OCR pass could not locate the monitor numerics, so the value is unconfirmed";
    return (opts && opts.__degraded ? "photo quality degraded and the" : "the") + " value was not read identically by both OCR passes";
  }
  function thresholdFor(field, opts) {
    var t = assign({}, THRESH[field] || THRESH.hr, opts && opts.thresholds && opts.thresholds[field]);
    if (opts && opts.__degraded) { t.conf = Math.min(0.99, t.conf + DEGRADED_BUMP); if (t.margin != null) t.margin += 0.03; }
    return t;
  }
  function decide(cands, hasLabel, opts) {
    if (!cands.length) return { status: "NOT_FOUND", confidence: 0, value: null, reason: "no readable candidate" };
    var field = opts && opts.__field, T = thresholdFor(field, opts);
    cands.sort(function (a, b) { return b.score - a.score; });
    var top = cands[0], second = null;
    for (var i = 1; i < cands.length; i++) if (cands[i].value !== top.value) { second = cands[i]; break; }
    var margin = second ? top.score - second.score : 0.3;
    var conf = top.score * (0.7 + 0.3 * clamp(margin / 0.25, 0, 1));
    var sizeTie = second && Math.abs(second.box.h - top.box.h) <= 0.15 * top.box.h && Math.abs(second.box.y - top.box.y) < top.box.h && second.role === "numeric";
    var needMargin = Math.max(sizeTie ? 0.20 : 0, T.margin);
    var ev = 0; if (top.parts.label >= 0.7) ev++; if (top.parts.layout >= 0.9) ev++; if (!top.parts.colorNeutral && top.parts.color >= 0.8) ev++; if (top.glued) ev++;
    var secondary = !PRIMARY[field];
    var sizeOk = (top.parts.size >= 0.55 || (secondary && top.parts.labelRel >= 0.8) || top.glued) && top.parts.spatial >= 0.4;
    var labelOk = hasLabel || top.glued || (opts && opts.unlabeledAuto);
    var blockers = [];
    if (top.box.conflict) blockers.push("OCR scales disagree (" + JSON.stringify(top.box.t) + " vs " + JSON.stringify(top.box.conflict) + ")");
    if (top.box.edge) blockers.push("value touches the photo edge (may be truncated)");
    if (top.glueConflict) blockers.push(top.glueConflict);
    // On a DEGRADED photo a single OCR reading is not enough: the 12°-rotated MP40 read DBP 66 as 86 at
    // confidence 1.0 in one pass (2026-09-14). Only digits read identically by both passes may auto-fill.
    if (!top.box.confirmed && needsConfirmation(opts)) blockers.push(confirmationReason(opts));
    if (!blockers.length && conf >= T.conf && margin >= needMargin && ev >= 2 && sizeOk && labelOk && top.role !== "limit" && top.role !== "limitRange")
      return { status: "AUTO_ACCEPTED", confidence: +conf.toFixed(2), value: top.value, margin: +margin.toFixed(2), evidence: ev, threshold: T.conf };
    var reason = blockers.length ? blockers.join("; ") : second && margin < needMargin ? "two candidates too close (" + top.value + " vs " + second.value + (sizeTie ? ", same size and row" : "") + ")" : !labelOk ? "label not read (slot" + (ev >= 2 ? " and colour agree" : " only") + ")" : ev < 2 ? "only " + ev + " independent signal(s)" : !sizeOk ? "size/position inconsistent" : "confidence " + conf.toFixed(2) + " below " + T.conf;
    return { status: "NEEDS_REVIEW", confidence: +conf.toFixed(2), value: null, suggested: top.value, margin: +margin.toFixed(2), evidence: ev, threshold: T.conf, reason: reason };
  }
  // The number the OCR bound to a label token in the SAME box ("PR72", "PI 3.2 PR 72", "... PVC 0").
  function gluedValue(L, field) {
    var f = FIELDS[field], res = [LABELS[field][0], LABELS[field][1]];
    for (var r = 0; r < res.length; r++) {
      var re = new RegExp(res[r].source, res[r].flags.replace("g", "") + "g"), m;
      while ((m = re.exec(L.t))) {
        var rest = L.t.slice(m.index + m[0].length), g = rest.match(/^\s*[:=]?\s*(-?\d{1,3}(?:\.\d)?)(?![\d\/])/);
        if (g) { var v = parseFloat(g[1]); if (v >= f.lo && v <= f.hi) return v; }
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ pressures */
  function parsePressures(G, px, claimed, claimedLabels, opts) {
    var P = G.B.filter(function (b) { return b.role === "pressure"; });
    var out = { sbp: null, dbp: null, map: null, art: null, nibp: null }, notes = [];
    var TP = thresholdFor("pressure", opts), TM = thresholdFor("map", opts);
    if (!P.length) {
      var nf = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no SSS/DD box" };
      out.sbp = nf; out.dbp = nf; out.map = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no pressure" };
      return out;
    }
    P.forEach(function (p) {
      var best = null;
      if (p.gluedSrc) best = { box: p, src: p.gluedSrc.src, d: 0, strength: p.gluedSrc.strength, glued: true };
      else G.B.forEach(function (b) {
        b.labels.forEach(function (l) {
          if (l.field !== "press:art" && l.field !== "press:nibp" && l.field !== "press:pap") return;
          var dx = p.x - b.x, dy = p.y - b.y;
          if (dx < -0.05 || dx > 0.30 || dy < -b.h * 1.5 || dy > b.h * 10 + 0.03) return;
          if (/\b(?:Start|Stop|Go|Setup|Zero|Menu)\b/i.test(b.t)) return;   // softkeys name a pressure without labelling a reading
          var d = Math.abs(dx) + Math.abs(dy);
          // a source label touching the photo edge may be clipped ("NIBP" -> "IBP"): weak evidence, never proof
          if (!best || d < best.d) best = { box: b, src: l.field.slice(6), d: d, strength: b.edge ? Math.min(l.strength, 0.5) : l.strength };
        });
      });
      if (best && best.src === "pap" && !on(opts, "pap")) best = null;
      p.src = best ? best.src : null; p.srcLabel = best && !best.glued ? best.box : null; p.srcStrength = best ? best.strength : 0; p.srcGlued = !!(best && best.glued); p.srcD = best ? best.d : null;
      p.mapBox = null; p.mapVal = p.paren;
      if (p.mapVal == null) G.B.forEach(function (b) {
        if (b.role !== "paren") return;
        var below = b.y >= p.y && b.y <= p.y + p.h * 2.6, inCol = b.cx >= p.x - 0.02 && b.cx <= p.x + p.w + 0.02;
        if (below && inCol && (!p.mapBox || b.h > p.mapBox.h)) { p.mapBox = b; p.mapVal = b.paren; }
      });
      if (p.mapVal != null && !(p.mapVal > p.press.d && p.mapVal < p.press.s)) { notes.push("MAP " + p.mapVal + " outside DBP..SBP for " + p.t + ", dropped"); p.mapVal = null; p.mapBox = null; }
      p.valid = p.press.s > p.press.d && p.press.s >= 50 && p.press.s <= 260 && p.press.d >= 20 && p.press.d <= 160;
    });
    if (on(opts, "onelabel")) P.forEach(function (p) {
      // a source label names ONE reading: a farther reading that picked the same label loses it
      if (!p.srcLabel) return;
      if (P.some(function (q) { return q !== p && q.srcLabel === p.srcLabel && q.srcD < p.srcD; })) { notes.push("source label " + JSON.stringify(p.srcLabel.t) + " belongs to a nearer reading than " + p.t); p.src = null; p.srcLabel = null; p.srcStrength = 0; }
    });
    var PAP = on(opts, "pap") ? P.filter(function (p) { return p.src === "pap"; }) : [];
    if (PAP.length) { notes.push("pulmonary pressure (PAP) " + PAP.map(function (p) { return p.t; }).join(", ") + " is not SBP/DBP/MAP"); P = P.filter(function (p) { return p.src !== "pap"; }); PAP.forEach(function (p) { claimed[p.i] = true; }); }
    if (!P.length) { out.sbp = { status: "NOT_FOUND", confidence: 0, value: null, reason: "only a pulmonary pressure (PAP) is displayed" }; out.dbp = out.sbp; out.map = out.sbp; out.pap = PAP.map(function (p) { return p.t; }); return out; }
    var V = P.filter(function (p) { return p.valid; }).sort(function (a, b) { return b.h - a.h; });
    if (!V.length) { var bad = { status: "NEEDS_REVIEW", confidence: 0.2, value: null, reason: "pressure text implausible: " + P.map(function (p) { return p.t; }).join(", ") }; out.sbp = bad; out.dbp = bad; out.map = bad; return out; }
    var unreadable = P.filter(function (p) { return !p.valid; });
    G.B.forEach(function (b) {
      b.labels.forEach(function (l) {
        if (l.field !== "press:art" && l.field !== "press:nibp") return;
        if (/\b(?:Start|Stop|Go|Setup|Zero|Menu)\b/i.test(b.t)) return;
        var served = V.some(function (p) { return p.srcLabel === b; });
        if (!served && !unreadable.some(function (p) { return p.srcLabel === b; })) unreadable.push({ t: b.t, srcLabel: b, labelOnly: true, src: l.field.slice(6) });
      });
    });
    function blockersOf(p) {
      var bl = [];
      if (p.press.repaired) bl.push("OCR repaired (" + p.press.repaired + "): " + JSON.stringify(p.t) + " read as " + p.press.s + "/" + p.press.d);
      if (p.conflict) bl.push("OCR scales disagree (" + JSON.stringify(p.t) + " vs " + JSON.stringify(p.conflict) + ")");
      if (p.edge) bl.push("reading touches the photo edge (may be truncated)");
      if (!p.confirmed && needsConfirmation(opts)) bl.push(confirmationReason(opts));
      return bl;
    }
    function reading(p) { return { s: p.press.s, d: p.press.d, map: p.mapVal == null ? null : p.mapVal }; }
    // Named sources, never merged. Each is AUTO only with a strong source label (or the source glued in
    // the same box) and no blocker; its MAP is only the "(MM)" read with THAT reading.
    V.forEach(function (p) {
      if (!p.src || out[p.src]) return;
      var bl = blockersOf(p), c = 0.6 + 0.25 * p.srcStrength + 0.15 * clamp(p.h / G.maxH, 0, 1);
      var ok = !bl.length && c >= TP.conf && p.srcStrength >= 0.7;   // same source rule as the primary pressure
      if (!ok && !bl.length && p.srcStrength < 0.7) bl.push("source label weak (" + JSON.stringify(p.srcLabel ? p.srcLabel.t : p.t) + ")");
      out[p.src] = { status: ok ? "AUTO_ACCEPTED" : "NEEDS_REVIEW", confidence: +c.toFixed(2), value: ok ? reading(p) : null, suggested: reading(p), source: p.src.toUpperCase(), box: p.i, mapBox: p.mapBox ? p.mapBox.i : (p.mapVal != null ? p.i : null),
        label: p.srcLabel ? { text: p.srcLabel.t, box: p.srcLabel.i, strength: p.srcStrength } : (p.srcGlued ? { text: p.t, box: p.i, strength: p.srcStrength, glued: true } : null), reason: bl.length ? bl.join("; ") : undefined };
    });
    var top = V[0], second = V.length > 1 ? V[1] : null;
    var approx = (top.press.s + 2 * top.press.d) / 3;
    var derivedMAP = { value: Math.round(approx), source: "CALCULATED", formula: "(SBP + 2 x DBP) / 3", note: "not a monitor reading; never fills MAP" };
    var mapConflict = on(opts, "mapcheck") && top.mapVal != null && Math.abs(top.mapVal - approx) > MAP_CONSISTENCY_TOL;
    var sameReading = second && second.press.s === top.press.s && second.press.d === top.press.d;
    var sources = {}; V.forEach(function (p) { if (p.src) sources[p.src] = true; });
    unreadable.forEach(function (u) { if (u.src && Math.abs((u.srcLabel || u).x - (top.srcLabel ? top.srcLabel.x : top.x)) < 0.12 && !(u.labelOnly && u.srcLabel.y > top.y + top.h)) sources[u.src] = true; });
    var reasons = [];
    var bothSources = sources.art && sources.nibp;
    if (bothSources) reasons.push("ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice");
    else if (second && !sameReading && (second.h >= top.h * 0.6 || (second.src && second.src !== top.src))) reasons.push("two pressures of similar size: " + top.t + " vs " + second.t);
    var refX = top.srcLabel ? top.srcLabel.x : top.x;
    var otherUnread = unreadable.filter(function (u) {
      if (u.srcLabel === top.srcLabel && u.srcLabel) return false;
      var box = u.labelOnly ? u.srcLabel : u;
      if (u.labelOnly && !/^\W*(?:ART|ABP|NIBP|NBP|IBP|P1)\W{0,3}$/i.test(u.t)) return false;
      if (u.labelOnly && box.y > top.y + top.h) return false;
      return Math.abs(box.x - refX) < 0.12;
    });
    if (otherUnread.length && !bothSources) reasons.push("another pressure on screen could not be read: " + otherUnread.map(function (u) { return JSON.stringify(u.t); }).join(", "));
    if (!top.src) reasons.push("pressure source (ART / NIBP) not identified");
    reasons = reasons.concat(blockersOf(top));
    if (mapConflict) reasons.push("displayed MAP " + top.mapVal + " inconsistent with " + top.press.s + "/" + top.press.d + " (calculated about " + Math.round(approx) + "): one of the three readings may be misread");
    var conf = 0.72 + 0.14 * clamp(top.h / G.maxH, 0, 1) + (top.src ? 0.08 * top.srcStrength : 0) + (second ? 0 : 0.06);
    var ambiguous = reasons.length > 0 || conf < TP.conf;
    if (!reasons.length && conf < TP.conf) reasons.push("confidence " + conf.toFixed(2) + " below " + TP.conf);
    if (ambiguous) conf = Math.min(conf, 0.6);
    claimed[top.i] = true; if (top.srcLabel) claimedLabels[top.srcLabel.i] = true;
    V.forEach(function (p) { claimed[p.i] = true; if (p.mapBox) claimed[p.mapBox.i] = true; });
    G.bpBox = top;
    var primary = {
      status: ambiguous ? "NEEDS_REVIEW" : "AUTO_ACCEPTED", confidence: +conf.toFixed(2), source: top.src ? top.src.toUpperCase() : null, box: top.i,
      label: top.srcLabel ? { text: top.srcLabel.t, box: top.srcLabel.i, strength: top.srcStrength } : (top.srcGlued ? { text: top.t, box: top.i, strength: top.srcStrength, glued: true } : null),
      reason: ambiguous ? reasons.join("; ") : undefined,
      candidates: V.map(function (p) { return { text: p.t, source: p.src, h: p.h, box: p.i }; })
    };
    primary.derivedMAP = derivedMAP;
    if (on(opts, "mapcheck") && top.mapVal != null) primary.mapConsistency = { displayed: top.mapVal, calculated: +approx.toFixed(1), difference: +(top.mapVal - approx).toFixed(1), tolerance: MAP_CONSISTENCY_TOL, consistent: !mapConflict };
    out.sbp = assign({}, primary, { value: ambiguous ? null : top.press.s, suggested: top.press.s });
    out.dbp = assign({}, primary, { value: ambiguous ? null : top.press.d, suggested: top.press.d });
    if (top.mapVal != null) {
      var mconf = ambiguous ? 0.5 : Math.min(conf, 0.94), mok = !ambiguous && mconf >= TM.conf;
      out.map = { status: mok ? "AUTO_ACCEPTED" : "NEEDS_REVIEW", confidence: +mconf.toFixed(2), value: mok ? top.mapVal : null, suggested: top.mapVal, box: top.mapBox ? top.mapBox.i : top.i, source: top.src ? top.src.toUpperCase() : null, label: primary.label,
        mapText: top.mapBox ? top.mapBox.t : top.t, reason: mok ? undefined : (ambiguous ? reasons.join("; ") : "confidence " + mconf.toFixed(2) + " below " + TM.conf) };
    } else out.map = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no (MM) read next to " + top.t + "; MAP is only ever a displayed value" };
    if (PAP.length) out.pap = PAP.map(function (p) { return p.t; });
    out.notes = notes;
    return out;
  }

  /* ------------------------------------------------------------------ evidence (every AUTO field) */
  function evidenceFor(k, f, G) {
    if (f.status !== "AUTO_ACCEPTED") return null;
    var boxIdx = f.box != null ? f.box : null;
    if (boxIdx == null && f.candidates) for (var i = 0; i < f.candidates.length; i++) if (f.candidates[i].value === f.value) { boxIdx = f.candidates[i].box; break; }
    var o = boxIdx != null ? G.src[boxIdx] : null;
    var kind = f.label ? (f.label.detector ? "detector" : f.label.glued || f.glued ? "glued-label" : "label") : "layout+colour";
    var src = f.source || (f.label ? "label " + JSON.stringify(f.label.text) : "layout slot + channel colour (unlabeledAuto)");
    var ev = {
      ocr: o ? { text: o.text, conf: o.conf == null ? null : +(+o.conf).toFixed(2), scale: o.scale || "full" } : null,
      box: o ? { x: +o.x.toFixed(4), y: +o.y.toFixed(4), w: +o.w.toFixed(4), h: +o.h.toFixed(4) } : null,
      association: { kind: kind, label: f.label ? { text: f.label.text, box: f.label.box } : null, signals: f.evidence != null ? f.evidence : null },
      confidence: f.confidence, source: src
    };
    if (f.verifyRequired) ev.verify = f.verify ? { status: f.verify.status, read: f.verify.read, method: f.verify.method, glyphs: f.verify.glyphs } : null;
    if (k === "map") ev.association.kind = "(MM) displayed with the " + (f.source || "?") + " reading";
    ev.complete = !!(ev.ocr && ev.ocr.text && ev.box && ev.association.kind && typeof ev.confidence === "number" && ev.source && (!f.verifyRequired || (ev.verify && ev.verify.status === "verified")));
    return ev;
  }

  /* ------------------------------------------------------------------ independent digit verification
   * A second Vision pass is NOT independent: both passes read RR 16 as "15" on a real photo, and every
   * re-read at other scales repeated it (2026-09-14). This reads the value's digits from the PIXELS with
   * a different method: Otsu binarisation of the value box, connected-component glyph segmentation, and
   * a shape classifier (seven stroke zones + enclosed holes + width). It never proposes a value: it only
   * returns "verified" (same digits, every glyph confident), "disagree" or "unsure", and only "verified"
   * may auto-fill a gated field. Plausibility and history play no part. */
  // Digit templates (bench/icu-monitor/digit-templates.py): 16 sans-serif faces + a seven-segment set,
  // each digit 20x20, 16 grey levels, one hex char per cell. Generated, not hand-edited.
  var DIGIT_TEMPLATES = {"arial":["0000004befeb40000000000008fffffff800000000005ffa203bff5000000000ffa00000afe000000006ff3000002ff60000000afe0000000efa0000000dfc0000000bfd0000000ffa0000000aff0000000ff800000008ff0000000ff800000008ff0000000ff800000008ff0000000ff800000008ff0000000ffa0000000aff0000000cfb0000000bfc00000009fe0000000ef900000006ff2000003ff600000000ffa00000afe0000000006ffb303bff500000000009fffffff80000000000004befeb40000000","00000000000df000000000000000009ff00000000000000006fff0000000000000007ffff00000000000004cffcff0000000000000fff65ff0000000000000fa105ff000000000000010005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff000000000000000005ff0000000","0000005beffc8100000000001cffffffff40000000009ffb3018fff100000001ffb000003ff800000006ff1000000afc00000004aa00000008fd00000000000000000bfc00000000000000001ff90000000000000000cff2000000000000000bff8000000000000000bffb000000000000001bffa000000000000001cff8000000000000002dff7000000000000004fff5000000000000002ffe3000000000000000dff20000000000000006ffa6666666660000000cffffffffffff0000000fffffffffffff0000","0000007cffe92000000000002dfffffff70000000000dff6003bff4000000006ff500000efc00000000bfd0000009ff00000000033000000aff00000000000000001efb0000000000000015dff30000000000000ffffc200000000000002fffffb200000000000003139ffe100000000000000007ff800000000000000000efd00000000000000000aff00000009b60000000bfe0000000efc0000000ffb00000008ff4000009ff500000001eff6002affb0000000004efffffffa1000000000007cffeb40000000","000000000002ff50000000000000000cff50000000000000009fff5000000000000005ffff500000000000001ff9ff50000000000000bfb2ff50000000000006fe12ff5000000000004ff302ff500000000000df9002ff500000000008fd0002ff50000000005fe20002ff5000000002ff600002ff500000000cfc222224ff722000000ffffffffffffff000000ffffffffffffff000000333333335ff733000000000000002ff500000000000000002ff500000000000000002ff500000000000000002ff500000","00000efffffffff0000000001ffffffffff0000000003ff866666660000000006ff000000000000000009fd00000000000000000cf900000000000000000ff518aa7100000000002ffaffffff60000000005ffffedffff6000000008ffb20007fff200000002560000005ff900000000000000000cfc000000000000000009fe000000000000000008fe00000008a40000000bfc0000000efb0000001ff800000008ff500000cff100000001eff8104dff70000000004ffffffff90000000000018cffea30000000","00000018cffc81000000000004fffffffe20000000003ffd4007ffc000000000cfe100006ff400000003ff4000000ef800000007fd00000002100000000af900000000000000000df704bffd80000000000ff5affffffe200000000ffefe856dffd00000000fffc100009ff60000000fff2000000dfc0000000efc00000008fe0000000cfa00000008ff00000009fd00000008fd00000005ff2000000cf900000000ffc000005ff4000000005ffc4018ffb00000000007fffffffc10000000000029effb60000000","000fffffffffffff0000000fffffffffffff0000000888888888bff90000000000000002efb0000000000000000dfc00000000000000008ff40000000000000001ffb0000000000000000aff20000000000000002ff800000000000000009ff10000000000000001ff900000000000000006ff30000000000000000dfd00000000000000002ff800000000000000006ff30000000000000000aff00000000000000000dfc00000000000000000ff900000000000000002ff800000000000000002ff500000000000","0000005bfffb4000000000000bfffffffb00000000007ffb202bff7000000000efc00000cff000000002ff5000004ff200000002ff5000003ff200000000ff9000008ff0000000008ff60004ff900000000008ffdacff9000000000005cfffffd400000000009ffb424bff9000000005ff7000005ff50000000cfc0000000bfc0000000df800000007ff0000000df800000007ff0000000cfc0000000afd00000007ff5000003ff800000000dff82017ffe1000000002dfffffffe2000000000005bfffb70000000","0000006cffe81000000000002dfffffff60000000000dff8202aff5000000008ff7000009ff00000000cfd0000001ff60000000ff80000000cfa0000000ff60000000cfc0000000ff80000000dfe0000000dfd0000002fff00000008ff900000cfff00000001effc657dfeff000000004effffff96fe00000000018dffb408fd00000000000000000bfa00000001430000000ff700000009fe0000006ff200000005ff400001efc000000000efe4004dff30000000004effffffe30000000000018dffc800000000"],"arial-bold":["0000004befeb40000000000009fffffff800000000007fffffffff5000000001ffff505fffe000000006fff9000afff50000000afff40005fff90000000cfff20002fffc0000000ffff00000fffe0000000ffff00000ffff0000000ffff00000ffff0000000ffff00000ffff0000000ffff00000ffff0000000ffff00000fffe0000000dfff10003fffc0000000afff40005fff900000006fff9000afff500000001ffff505fffe0000000007fffffffff500000000008fffffff90000000000004befeb40000000","00000000006fff0000000000000002ffff000000000000000cffff00000000000004efffff000000000003afffffff00000000000ffffeffff00000000000fffb1ffff00000000000fe400ffff0000000000040000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff0000000000000000ffff000000","0000005beffd9200000000000bffffffff40000000009ffffffffff200000001ffff724bfff900000006fff70000effe00000005bdf20000afff0000000000000000cffe0000000000000002fffb000000000000000bfff6000000000000009fffd00000000000000affff30000000000000bffff60000000000000cffff800000000000009ffff700000000000008ffff600000000000005ffff500000000000000efffd888888800000005ffffffffffff0000000bffffffffffff0000000fffffffffffff0000","0000007cffea3000000000002efffffff90000000000dfffffffff7000000005fffb206fffe000000008fff0000cfff2000000000340000bfff2000000000000001fffe000000000000047efff50000000000000dfffe500000000000000ffffe80000000000000098bfffd00000000000000008fff80000000000000000fffe0000000000000000dfff0000000abdc00000ffff0000000cfff20004fffc00000008fffd204efff600000000dfffffffffc0000000002dfffffffb1000000000006bffeb50000000","00000000000dffa0000000000000009fffa000000000000003ffffa00000000000000cffffa00000000000008fffffa0000000000002ffffffa000000000000cffafffa000000000009ffd0fffa00000000004fff40fffa0000000000effa00fffa0000000009ffe100fffa000000003fff5000fffa00000000dffd5555fffc55000000ffffffffffffff000000ffffffffffffff000000ffffffffffffff00000000000000fffa0000000000000000fffa0000000000000000fffa0000000000000000fffa00000","00000cfffffffff2000000000ffffffffff2000000001ffffffffff2000000004fffbaaaaaa1000000007fff0000000000000000affc0000000000000000dffb6aa8200000000000fffffffff80000000003ffffffffff8000000005ffff98bffff3000000048ba00007fffa0000000000000000effe0000000000000000cfff0000000000000000cfff0000000acdc00000effe0000000cfff30004fff900000006fffe526efff200000000cfffffffff90000000002dfffffffa0000000000007cffeb50000000","00000018cffd81000000000004effffffe20000000003fffffffffe000000000dfff801bfff500000004fffb0002ffe800000009fff5000020000000000cfff2000000000000000efff19efd81000000000ffffdfffffe200000000ffffffbcfffe00000000ffffe1008fff80000000ffff70000effd0000000efff40000bfff0000000cfff400009fff00000009fff60000bfff00000005fffc0001fffc00000000efff901bfff7000000005fffffffffd00000000006fffffffd20000000000028effc70000000","000fffffffffffff0000000fffffffffffff0000000fffffffffffff000000088888888cfff8000000000000002fffa000000000000000bfff1000000000000005fff5000000000000001effb0000000000000008fff3000000000000000effc0000000000000005fff5000000000000000bffe0000000000000000fffa0000000000000005fff50000000000000009fff1000000000000000cffd0000000000000000fffa0000000000000002fff60000000000000003fff60000000000000006fff30000000000","0000007cfffb6000000000002efffffffd1000000000cffffdffffb000000004fffc101dfff100000006fff40005fff500000006fff20005fff500000004fff70007fff200000000cffe526fffa0000000001cfffffffb000000000007fffffff70000000000afffdadfffb000000005fffa0009fff60000000bfff10000fffc0000000dffc00000cfff0000000dffe00000dfff0000000cfff30002fffc00000008fffc100bfff800000000effffdffffe0000000002dfffffffe2000000000005bfffc70000000","0000007cffe92000000000001dfffffff40000000000cfffffffff3000000006fff9018fffd00000000cffe0000bfff40000000effa00005fff70000000fffa00002fffa0000000fffa00002fffd0000000cffd00006fffd00000007fff7001dffff00000000efffcaffffff000000002efffffeeffd00000000018efea1fffc0000000000000001fffa0000000002400004fff600000008fff1000afff100000004fffa107fffc000000000dfffffffff20000000002effffffe40000000000019effc800000000"],"arial-narrow":["00000001affb200000000000001efffff2000000000000afb11afc000000000001fe1000df300000000005f900007f800000000009f500003fb0000000000cf200000fd0000000000df100000ff0000000000ff000000ff0000000000ff000000df0000000000ff000000df0000000000ff000000ff0000000000df100000ff0000000000cf200000fd0000000000af500003fb00000000006f900007f700000000001fe1000df300000000000bfb11afc0000000000001efffff200000000000001affb20000000","000000000008f000000000000000003ff00000000000000001eff0000000000000003efff000000000000007ffdff00000000000000ffa1ff00000000000000f600ff000000000000001000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff0000000","00000018dffc40000000000001dffffff800000000000cfe401aff40000000003ff20000bfa0000000007fb000004fe0000000008e8000002ff000000000000000004fe000000000000000009fb00000000000000001ff50000000000000000cfc00000000000000009fe10000000000000009ff40000000000000009ff60000000000000009ff50000000000000007ff80000000000000004ff80000000000000000ef800000000000000008ff55555555000000000cffffffffff000000000fffffffffff00000","0000003bffd800000000000004ffffffb000000000001ff9104df900000000006fc00004ff00000000008f600000ff200000000000000000ff200000000000000005ff00000000000000006ef700000000000000cfff8000000000000000efffb100000000000000203cff100000000000000000df8000000000000000006fc000000000000000004ff0000000007a2000005ff000000000cf6000008fc0000000009fd00001ef80000000002ff9103cfe100000000005ffffffe30000000000003befe910000000","00000000000df000000000000000007ff00000000000000001eff0000000000000000afff0000000000000004fbff000000000000000df2ff000000000000006f80ff00000000000000ee00ff00000000000008f500ff0000000000001fc000ff000000000000af4000ff000000000002fc0000ff00000000000bf52222ff22000000000fffffffffff000000000fffffffffff0000000002222222ff220000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff0000000","000000ffffffff500000000003ffffffff500000000006fa333333100000000008f600000000000000000bf300000000000000000ef000000000000000001fe059840000000000003ffeffffb000000000005fff98affc00000000008fe10004ff7000000000253000009fc000000000000000004ff000000000000000002ff000000000000000002ff0000000009c3000003ff000000000cf7000008fc0000000008fe00002ff60000000001efc426efc000000000003ffffffe10000000000003befe910000000","00000006cffb400000000000009ffffff5000000000007fe4019ff10000000001ff40000df60000000005fc000008e80000000009f700000000000000000cf400000000000000000ef23bffb300000000000ff4ffffff40000000000ffee402cff1000000000fff10000df8000000000ff9000007fc000000000ff5000003fe000000000ef5000002ff000000000cf6000004fd0000000008fb000007fb0000000003ff30000df60000000000bfe402bfe000000000000bfffffe300000000000008dfea20000000","0000fffffffffff000000000fffffffffff00000000055555555ef900000000000000008fd00000000000000002ff30000000000000000afb00000000000000003ff20000000000000000afc00000000000000001ff400000000000000007fd00000000000000000cf800000000000000001ff300000000000000007fe00000000000000000bf900000000000000000ff400000000000000002ff000000000000000005fe000000000000000007fb000000000000000008fa00000000000000000af800000000000","0000001aefe910000000000002efffffe100000000000cfd303dfc00000000002ff20002ff20000000005fd00000df50000000005fd00000df50000000002ff10001ff20000000000afd302bfa0000000000008fffff90000000000001bfffffb000000000001efb303cfe10000000008fd00000df8000000000cf6000005fd000000000ff2000002ff000000000ff2000002ff000000000cf6000005fd0000000009fd00000cf90000000002ffb202aff200000000004fffffff50000000000002aefea20000000","0000002aefd700000000000003efffffb000000000001efd303dfa00000000008ff10001ff2000000000cf8000009f7000000000ef4000005fb000000000ff2000005fd000000000ef3000005ff000000000cf7000009ff0000000008fd00001eff0000000002ffc303dfff00000000005ffffff7ff000000000003bffb32fd000000000000000004fc000000000000000008f90000000008e700000df40000000006fc00005fe00000000002ff7105ef5000000000006ffffff900000000000004cffc600000000"],"arial-narrow-bold":["00000002bffa100000000000003fffffe1000000000000dffffffb000000000004fff24fff100000000008ff800bff60000000000cff4007ff90000000000eff2005ffc0000000000fff2005ffd0000000000fff0003ffd0000000000fff0002fff0000000000fff0002fff0000000000fff0003ffd0000000000fff2005ffd0000000000eff2005ffc0000000000cff4007ff900000000008ff800bff600000000004fff24fff100000000000dffffffb0000000000003fffffe100000000000002bffa10000000","0000000000aff00000000000000002fff0000000000000000cfff000000000000000affff00000000000003cfffff0000000000000fffdfff0000000000000ffe1fff0000000000000fc20fff00000000000005000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff0000000","00000008effc60000000000001dffffffa00000000000bffffffff50000000002fff924dffb0000000006ffd0004fff0000000005cd90002fff00000000000000002fff00000000000000007ffe0000000000000001eff9000000000000000bfff2000000000000009fff9000000000000007fffd000000000000004fffe200000000000002ffff400000000000000cfff6000000000000007fff9000000000000001ffff5555550000000007ffffffffff000000000bffffffffff000000000effffffffff00000","0000003befe900000000000004ffffffd100000000000efffffffb00000000006ffe309fff10000000009ff7000fff50000000004891000dff50000000000000002fff2000000000000014dffa00000000000000bfffb000000000000000cfff9000000000000000b9effe10000000000000000cff900000000000000005ffe00000000000000002fff000000000bdf20004fff000000000cff70009ffe0000000009fff405fff90000000002fffffffff200000000004ffffffe30000000000002aefea10000000","00000000001ffd0000000000000000affd0000000000000002fffd000000000000000afffd000000000000004ffffd00000000000000dffffd00000000000007ffaffd0000000000000efe3ffd0000000000008ff62ffd000000000002ffc02ffd00000000000bff302ffd00000000004ffb002ffd0000000000dff8557ffe5500000000ffffffffffff00000000ffffffffffff00000000ffffffffffff000000000000002ffd00000000000000002ffd00000000000000002ffd00000000000000002ffd000000","000000ffffffff500000000003ffffffff500000000006ffffffff500000000009ff85555510000000000cff20000000000000000fff00000000000000001ffe8efa1000000000004fffffffe200000000006ffffffffe00000000008ffd428fff70000000002681000bffb00000000000000006ffe00000000000000004fff00000000000100004fff000000000dff30005ffd000000000cff8000bff90000000008fff728fff40000000001efffffffa000000000003ffffffc00000000000002affe810000000","00000006cffc400000000000009ffffff6000000000008ffffffff10000000001fffa12eff60000000006ffe0007ffa000000000aff90001420000000000dff60000000000000000fff58efc400000000000fffdfffff60000000000fffffdffff2000000000ffff300bff9000000000fffb0004ffe000000000fff80001fff000000000dff80000fff000000000bff90002fff0000000007ffe0005ffd0000000002fffc12eff900000000009ffffffff200000000000bffffff500000000000007dfeb30000000","0000fffffffffff000000000fffffffffff000000000fffffffffff0000000005555555eff80000000000000006ffd0000000000000000eff30000000000000008ffa0000000000000000fff40000000000000005ffd0000000000000000cff50000000000000001fff00000000000000006ffb0000000000000000bff60000000000000000fff30000000000000003fff00000000000000006ffc00000000000000008ff90000000000000000aff60000000000000000bff60000000000000000dff50000000000","0000003befeb30000000000004fffffff400000000001ffffffffe00000000005fff505fff40000000008ff90009ff80000000008ff80008ff80000000005ffa000aff50000000000eff959ffd000000000002cfffffd1000000000000afffffb100000000000dfffcffff10000000006ffd201dff8000000000cff60004ffe000000000eff20002fff000000000fff40002fff000000000cff80007ffe0000000009fff504eff90000000002fffffffff300000000005fffffff50000000000002aefeb30000000","0000002affd600000000000003efffffb000000000001efffffff800000000008ffe21bfff1000000000cff7001fff6000000000eff3000bff9000000000fff20008ffc000000000fff20008ffd000000000cff6000cfff0000000009ffd003ffff0000000002fffedfffff00000000005fffffefff000000000003bfe85ffd00000000000000008ffc0000000000232000aff90000000009ff8000fff40000000006ffe20affe00000000001ffffffff5000000000005ffffff800000000000004cffc400000000"],"helvetica":["0000004bfffb50000000000008fffffff900000000004ffc301aff6000000000cfd00000bfe000000003ff5000003ff500000008ff0000000ef90000000bfd0000000bfd0000000dfa00000009ff0000000ff900000008ff0000000ff800000008ff0000000ff800000008ff0000000ff800000008ff0000000dfa0000000afd0000000bfc0000000cfb00000008ff0000000ef700000004ff4000003ff300000000dfc00000cfc0000000004ffc424cff300000000008fffffff50000000000004bfffb40000000","000000000006ff00000000000000000bff00000000000000006fff00000000000036aeffff000000000000ffffffff000000000000cccccfff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff000000","00000039dfffc8100000000006ffffffffe2000000004ffe7324bffc00000000eff300000aff70000003ff80000001ffd0000006ff30000000dff0000008ff00000000eff00000012200000002ffd0000000000000000bff7000000000000001bffc000000000000007fffc10000000000004dfff70000000000001bfffb20000000000003fffd300000000000002eff8000000000000000dff40000000000000005ff500000000000000009fe22222222222000000dfffffffffffff000000ffffffffffffff000","0000005beffda500000000000bffffffffb0000000008ffc4004dffa00000001ffc000001dff10000006ff40000007ff40000008ff00000006ff40000003660000000aff10000000000000007ffa0000000000006abeff900000000000009fffffa1000000000000366afffe10000000000000001aff800000000000000000efe00000088500000000bff000000ffb00000000bff000000cfe00000000efc0000007ff70000009ff60000000dffb4236cffc000000001effffffffb000000000007ceffda4000000","000000000005ff00000000000000002fff0000000000000000cfff0000000000000006ffff000000000000002ffbff00000000000001ef86ff0000000000000afd06ff0000000000004ff306ff000000000000ef7006ff000000000009fb0006ff00000000006fe10006ff0000000002ff500006ff000000000cfb000006ff000000000ffffffffffffff000000ffffffffffffff000000222222228ff222000000000000006ff000000000000000006ff000000000000000006ff000000000000000006ff000000","00000cfffffffffd000000000efffffffffd000000000ff988888886000000003ff000000000000000006fe000000000000000008fb00000000000000000bf802454100000000000df9cfffff90000000000fffffddfffe200000002ffe500019ffe100000029910000009ff800000000000000001ffd00000000000000000dff00000000000000000cff00000055300000000ffd000000dfc00000004ff8000000aff5000000cff20000002fffa4237dff7000000003effffffff8000000000007cfffd94000000","00000019effda2000000000004ffffffff30000000001ffe5006ffd0000000009ff200005ff400000000ff6000000ef800000005ff000000022100000009fc00000000000000000cf905addb60000000000df8bffffffd200000000ffffb4238ffe00000000fffa000006ff70000000fff1000000efc0000000ffc00000009fe0000000dfa00000008ff0000000afd00000009fd00000006ff1000000dfa00000000ffa000006ff4000000006ffc4238ff900000000007fffffffb0000000000004beffc60000000","000ffffffffffffff000000ffffffffffffff00000088888888889ffa0000000000000000cfd00000000000000008fe20000000000000003ff60000000000000000dfb00000000000000008ff10000000000000001ff800000000000000008ff10000000000000001ff800000000000000008ff10000000000000000efa00000000000000006ff40000000000000000bff00000000000000001ffb00000000000000005ff60000000000000000aff30000000000000000eff00000000000000002ffc00000000000","0000006bfffc7000000000000bfffffffd10000000009ff81019ffb000000000ff900000aff200000004ff3000003ff500000005ff2000003ff500000002ff7000007ff200000000bff50005ffb0000000001afffdeffa000000000009fffffffa1000000000cffb434bffe000000006ff8000006ff80000000cfd0000000cfe0000000ffa00000008ff0000000ffa00000008ff0000000cfc0000000afc00000008ff5000003ff700000000dff94238ffd0000000001dfffffffe1000000000007bfffc80000000","0000007cffeb4000000000002efffffffa0000000000dff8102aff8000000006ff700000aff00000000cfd0000002ff60000000ff90000000efb0000000ff60000000cfd0000000ff80000000eff0000000dfd0000003fff00000008ff700000cfff00000000eff9436dffff000000002effffffc8ff00000000006bdda50bfc00000000000000000ef900000002310000003ff50000000cfc0000009ff000000009ff300004ff8000000002ffe7238ffd00000000005fffffffd1000000000003aeffd800000000"],"helvetica-bold":["0000005bfffb6000000000000bfffffffb00000000007fffffffff8000000000efff404ffff000000004fff70007fff400000009fff20002fff90000000cfff00000fffc0000000dffd00000dffe0000000fffd00000dfff0000000fffd00000dfff0000000fffd00000dfff0000000fffd00000dfff0000000dffd00000dffe0000000cfff00000fffc00000009fff20003fff900000004fff80008fff500000000efff404ffff0000000008fffffffff80000000000bfffffffb0000000000006bfffb60000000","00000000008fff0000000000000000efff0000000000000009ffff0000000000089bffffff00000000000fffffffff00000000000fffffffff0000000000022224ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff000000","0000005beffda400000000000affffffffa0000000008ffffffffffa00000002ffffb65bffff50000007fffa0000bfffa000000afff500005fffd000000cfff200003fffd0000000000000007fffc000000000000000efff900000000000001cffff20000000000003effff50000000000007fffff5000000000001bffffd3000000000002effff90000000000002efffe30000000000000dfffe100000000000004ffff988888888000000afffffffffffff000000dfffffffffffff000000ffffffffffffff000","0000005beffda400000000000affffffff90000000009ffffffffff900000002ffff501bffff10000006fff60000efff40000008fff10000afff5000000122200000dfff3000000000000008fffb0000000000008effffb0000000000000afffff90000000000000affffffe0000000000000038ffff80000000000000008fffc0000005554000003fffe000000effe000003fffd000000bfff40000afffb0000006ffff5019ffff50000000effffffffffb000000001dffffffffb000000000006beffeb5000000","0000000000efffa000000000000008ffffa00000000000002fffffa0000000000000cfffffa0000000000006ffbfffa000000000000efe3fffa000000000009ff62fffa00000000002ffd02fffa0000000000bff302fffa0000000005ff9002fffa000000001eff1002fffa000000008ff80002fffa00000000fff76668fffc66000000ffffffffffffff000000ffffffffffffff0000009999999afffd9900000000000002fffa0000000000000002fffa0000000000000002fffa0000000000000002fffa00000","00000fffffffffff200000001fffffffffff200000003fffffffffff200000006ffe55555555000000008ffb0000000000000000aff80000000000000000cff50465100000000000fffafffffc3000000001fffffffffff500000003ffffeabfffff20000005fffa0003ffff90000000012000008fffc0000000000000003fffe0000000000000003fffe000000bccc000004fffc000000cfff50000bfff80000006ffff723affff10000000cffffffffff5000000000cffffffff7000000000006beffd94000000","0000002aeffc80000000000004fffffffe20000000003fffffffffd000000000cfff602cfff500000002fff80003fff800000007fff1000000000000000bffd0012000000000000dffb5dfffc3000000000fffefffffff600000000ffffffffffff20000000ffffc101cfff90000000ffff10002fffe0000000fffc00000cfff0000000cffb00000afff00000009ffe00000dffe00000004fff40003fffb00000000dfff502efff4000000005fffffffffc00000000008fffffffd1000000000004beffc70000000","000ffffffffffffff000000ffffffffffffff000000ffffffffffffff000000999999999bfffb000000000000000cffd100000000000000bfff2000000000000006fff6000000000000001effc0000000000000009fff4000000000000002fffc000000000000000bfff4000000000000003fffd0000000000000009fff6000000000000000efff0000000000000004fffc0000000000000008fff8000000000000000cfff4000000000000000ffff1000000000000000ffff0000000000000002fffd0000000000","0000004aeffeb5000000000009ffffffffb0000000008ffffffffff900000001ffff8006ffff10000004fffb0000afff50000004fff700006fff50000001fffb0000afff200000009fffa338fffa000000000affffffffa00000000009ffffffffb000000000cffffddffffd00000006fffe3003efff6000000cfff500004fffc000000ffff100000ffff000000ffff200001ffff000000cfff800006fffc0000008ffff6006ffff70000000effffffffffd000000001dffffffffb100000000006beffea5000000","0000005beffc8100000000000bffffffff4000000000bffffffffff200000004ffff934cfffc0000000bfff80000dfff3000000efff000004fff8000000fffd000003fffb000000ffff000003fffd000000efff300009fffd000000afffe2006ffffe0000002ffffffffffffd00000005fffffffefffd000000002affffa2fffc0000000000022003fff90000000000000007fff50000009fff60001efff00000005ffff502cfff800000000dfffffffffd0000000001cfffffffd2000000000006bfffb60000000"],"helvetica-neue-condensed-bold":["0000002aeffea3000000000002efffffff40000000000dfffaafffe0000000004fff7006fff4000000009fff1001fff900000000cfff0000fffc00000000dffd0000dffd00000000fffd0000dfff00000000fffd0000dfff00000000fffd0000dfff00000000fffd0000dfff00000000fffd0000dfff00000000fffd0000dffe00000000effd0000fffd00000000dffe0000fffb00000000afff0002fff9000000005fff6008fff4000000000efffbbfffc00000000005fffffffe2000000000004beffea2000000","00000000001fff0000000000000000afff0000000000000019ffff000000000000deffffff000000000000ffffffff000000000000ddddffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff0000000000000002ffff000000","0000004aeffea4000000000009ffffffff80000000004ffffbbffff300000000bfff5008fff900000000efff0003fffc00000000fffd0002fffd0000000088860004fffc0000000000000008fff9000000000000001efff400000000000002dfffc00000000000001effff10000000000001dfffe30000000000000cfffe10000000000000cfffe200000000000008fffe100000000000001ffff4000000000000007fffd222222200000000cfffffffffff00000000efffffffffff00000000ffffffffffff0000","0000003aeffea2000000000006ffffffff50000000001fffeabfffe0000000006fff3008fff4000000009ffe0004fff7000000007aa80003fff70000000000000006fff4000000000000000cffe00000000000008aefff40000000000000dffff600000000000000dfffffc0000000000000002bfff60000000000000002fffc0000000022210000fffe00000000fffb0000effe00000000dffd0000fffc000000009fff3005fff9000000002ffffbbffff20000000008ffffffff5000000000004bfffd92000000","0000000008ffff000000000000002fffff000000000000009fffff00000000000002ffffff0000000000000affffff0000000000002ffebfff000000000000bff6afff000000000004ffd0afff00000000000cff60afff00000000005ffe00afff0000000000eff700afff0000000006ffd000afff000000000dff8333bfff330000000fffffffffffff0000000fffffffffffff0000000fffffffffffff00000000000000afff0000000000000000afff0000000000000000afff0000000000000000afff000000","00000ffffffffff2000000002ffffffffff2000000002ffffffffff2000000003fff22222220000000005ffe00000000000000005ffd00000000000000007ffb39ddb400000000008ffdffffff80000000008ffffffffff200000000afff701cfff8000000008ccc0004fffc0000000000000002fffd0000000000000001ffff0000000022220000ffff00000000fffd0002fffd00000000ffff0005fffb00000000cfff700cfff7000000005ffffdfffff0000000000affffffff5000000000005bfffd92000000","0000005bfffc9100000000000bfffffffe3000000000afffe9cfffe000000002fffd100dfff400000008fff70008fff70000000bfff5000000000000000dfff3003300000000000dfff4affff9000000000efffeffffffc00000000fffffeadffff60000000ffffe000cfffa0000000ffff90006fffd0000000efff70005fffe0000000dfff50004fffe0000000cfff80005fffd00000009fff80006fffb00000004fffe100cfff600000000bfffeadfffd0000000001dfffffffe1000000000008cfffc81000000","0000ffffffffffff00000000ffffffffffff00000000ffffffffffff0000000099999999fffd0000000000000006fff3000000000000001effa000000000000000afff1000000000000003fff9000000000000000afff2000000000000002fffb0000000000000008fff6000000000000000efff1000000000000004fffc0000000000000009fff8000000000000000dfff4000000000000001ffff0000000000000005fffd0000000000000009fffa000000000000000cfff7000000000000000ffff4000000000","0000018cfffc8100000000003efffffffe3000000000efffd9dfffd000000004fffe000efff400000007fff9000afff600000008fff80008fff700000004fffb000bfff400000000dfff404fffd0000000001cfffffffb100000000018efffffe80000000000efffd9dfffc000000007fffc000cfff60000000cfff50006fffc0000000ffff30004fffe0000000ffff30005fffe0000000dfff50006fffc00000009fffc000cfff900000002ffffdadffff2000000003fffffffff3000000000029cfffc91000000","0000018cfffc7000000000003efffffffd1000000000efffc9dfffb000000006fffb001efff30000000bfff50009fff80000000dfff30008fffb0000000ffff20008fffd0000000ffff40008fffd0000000dfff60009fffe0000000bfffc002fffff00000005ffffecfffffd00000000cffffffefffd0000000009ffff94fffd0000000000022005fffc0000000000000005fffa00000006ddd60008fff700000005fffc001efff200000000efffcaefff90000000003ffffffffb000000000003adffeb50000000"],"din-alternate-bold":["0000003bffeb30000000000006fffffff600000000002fffecefff2000000000aff90009ff8000000000efe00000ffd000000000ffc00000dff000000000ffa00000dff000000000ffa00000dff000000000ffa00000dff000000000ffa00000dff000000000ffa00000dff000000000ffa00000dff000000000ffa00000dff000000000ffa00000dff000000000ffc00000dff000000000efe00000ffd000000000aff80009ff80000000002fffecefff200000000006fffffff60000000000003aefea30000000","000000001bfff000000000000004effff00000000000000ffffff00000000000000fe5fff00000000000000b10fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff0000000","0000003bffea20000000000005fffffff600000000001fffecefff20000000008ffb0009ff9000000000cff00000efe000000000aa800000aff00000000000000000dff00000000000000005ffc0000000000000002fff4000000000000000dff9000000000000000bffd0000000000000008fff2000000000000004fff5000000000000002eff8000000000000000cffc0000000000000008ffd1000000000000004fff2000000000000000ffffddddddd000000000fffffffffff000000000fffffffffff00000","00000018dffc70000000000003effffffd10000000001efffdefffd0000000007ffe3004fff500000000cff400006ffa00000000222000003ffc00000000000000004ffb0000000000000001dff7000000000000289effe10000000000005ffffe100000000000004ddfffa00000000000000003eff600000000000000003ffc00000000000000000fff00000000000000000eff00000000dff300003ffc000000008ffe3003eff8000000001ffffddfffe10000000003effffffe30000000000018dffc70000000","0000000008ffc0000000000000000eff30000000000000006ffc0000000000000000eff50000000000000005ffd0000000000000000cff50000000000000003ffe0000000000000000cff60000000000000003ffe0046620000000000aff800aff60000000003fff000aff6000000000aff9000aff6000000002fff2000aff6000000009ff90000aff600000000fffbaaaaeffca0000000fffffffffffff0000000fffffffffffff000000000000000aff60000000000000000aff60000000000000000aff600000","0000afffffffffa000000000afffffffffa000000000affccccccc8000000000afd00000000000000000afd00000000000000000afd00000000000000000afd18cc8200000000000affefffff40000000000afffffffff2000000000affb201bff900000000069910001ffd00000000000000000dff00000000000000000cff00000000000000000cff00000000000000000dff000000000efe00000ffd0000000009ff90009ff80000000002ffffdefff100000000005fffffff50000000000002aefea20000000","0000000006ffa0000000000000000eff20000000000000005ffb0000000000000000dff40000000000000005ffc0000000000000000dff40000000000000005ffb0000000000000000cff30000000000000003fffcdb6000000000000afffffffb00000000002fffb8bfff60000000007ff80004ffc000000000bfe00000dff000000000efd00000aff000000000ffd00000aff000000000eff00000efd000000000aff90009ff80000000002fffecefff100000000006fffffff40000000000004bffea20000000","0000fffffffffff000000000fffffffffff000000000fffdddddfff000000000ffa00005ffb000000000ffa0000bff5000000000cc80001ffe00000000000000007ff90000000000000000dff30000000000000003ffd0000000000000000aff80000000000000001fff10000000000000007ffb0000000000000000dff50000000000000003fff00000000000000009ff90000000000000000eff30000000000000005ffd0000000000000000bff50000000000000001ffe00000000000000007ff900000000000","00000007cffc70000000000002dffffffc10000000000cfffddfffb0000000004ffe3003eff4000000009ff600006ff800000000aff200003ffa000000009ff500006ff9000000005ffc0000dff5000000000cffd88dffc00000000001fffffffd00000000000bfffddfffa0000000007ffd3003dff600000000dff300003ffc00000000ffd000000eff00000000ffd000000eff00000000eff300003ffe000000008ffd3003eff8000000001ffffddffff10000000004effffffe30000000000018cffc80000000","00000018dffb40000000000004fffffff800000000000efffcefff30000000007ffb0008ffa000000000cff10000ffe000000000ffb00000dff000000000ffc00000dfd000000000efe00000ffb000000000aff8000aff60000000003fffdadfff100000000008fffffffb0000000000005bdcfff40000000000000004ffc0000000000000000cff40000000000000004ffc0000000000000000cff60000000000000004ffe0000000000000000cff60000000000000003ffe00000000000000009ff80000000000"],"din-condensed-bold":["00000002bffb300000000000002ffffff3000000000000affeeffb000000000000ffe10dff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffe10dff000000000000affeeffb0000000000002ffffff300000000000002bffb30000000","000000001afff000000000000003effff00000000000000ffffff00000000000000ff6fff00000000000000b10fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff00000000000000000fff0000000","00000002affb300000000000001efffff2000000000000affeeffa000000000000efe00dfe000000000000ffa00aff000000000000dd800aff00000000000000000bff00000000000000001ffd00000000000000009ff80000000000000001fff00000000000000009ff70000000000000001fff00000000000000009ff80000000000000001fff00000000000000009ff80000000000000001fff00000000000000009ff80000000000000000fffedddd000000000000ffffffff000000000000ffffffff000000","00000002affb300000000000002efffff3000000000000affeeffb000000000000ffe10dff000000000000ffa00aff000000000000dd800aff00000000000000000aff00000000000000000bff0000000000000006affc000000000000000dffc0000000000000000bfff600000000000000000dff00000000000000000aff00000000000000000aff000000000000dd800aff000000000000ffa00aff000000000000ffe10eff000000000000bffeeffc0000000000003ffffff300000000000003bffc30000000","000000000fff00000000000000004ffb00000000000000009ff70000000000000000dff20000000000000002ffd00000000000000006ff80000000000000000aff20000000000000000ffd00000000000000004ff916630000000000009ff43ff9000000000000eff03ff9000000000003ffb03ff9000000000007ff703ff900000000000cff203ff900000000000fffaabffda0000000000ffffffffff0000000000ffffffffff0000000000000003ff900000000000000003ff900000000000000003ff9000000","000000afffffff000000000000afffffff000000000000afeaaaaa000000000000afa00000000000000000afa00000000000000000afa00000000000000000afa00000000000000000afb8cc70000000000000affffff8000000000000affdcffe0000000000007a900cff00000000000000000aff00000000000000000aff00000000000000000aff00000000000022100aff000000000000ffa00aff000000000000ffd00dff000000000000affeeffb0000000000002ffffff300000000000003bffc40000000","0000000002ffe00000000000000008ff80000000000000000dff20000000000000003ffc00000000000000009ff60000000000000000fff00000000000000004ffa0000000000000000aff40000000000000000fffcd800000000000006ffffff9000000000000bffcbffe000000000000ffd00cff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffe10eff000000000000affffffb0000000000002ffffff300000000000003bffb30000000","00000fffffffff00000000000fffffffff00000000000ffdaabffe00000000000ff9006ffa00000000000dd800bff40000000000000000eff00000000000000004ffc00000000000000009ff70000000000000000eff30000000000000003ffe00000000000000008ff90000000000000000cff40000000000000001fff00000000000000005ffa0000000000000000bff60000000000000000fff10000000000000004ffd00000000000000009ff80000000000000000dff20000000000000002ffd00000000000","00000002bffb200000000000001effffe20000000000009fffeffa000000000000efe11eff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000efc00bff0000000000009ffa9ffa0000000000000ffffff00000000000009ffb9ffa000000000000ffc00bff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffe11eff000000000000bffeeffc0000000000003ffffff400000000000003bffb30000000","00000003bffb300000000000003ffffff3000000000000bffeeffc000000000000ffe10eff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffa00aff000000000000ffd00cff000000000000dffccffc0000000000008ffffff600000000000008dcfff10000000000000004ffb0000000000000000aff40000000000000000ffe00000000000000005ffa0000000000000000bff40000000000000002ffd00000000000000008ff80000000000000000dff3000000000"],"tahoma":["00000007cffc80000000000000cffffffb000000000008ff9338ff70000000000ff900008ff0000000004ff200001ff4000000008fd000000df900000000bfb000000bfc00000000dfa0000009fd00000000df90000009ff00000000ef80000009ff00000000df80000009ff00000000df80000009ff00000000dfa000000afd00000000afa000000bfc000000008fd000000df9000000004ff200001ff5000000000ef900008ff00000000008ff9338ff700000000000cffffffc00000000000007cffc80000000","000000000cf600000000000000003ff60000000000000359fff60000000000000ffffff60000000000000aaabff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff600000000000000003ff60000000000000ffffffffff0000000000ffffffffff00000","0000049cffeb600000000000affffffffb0000000000afc6326cff800000000084000000eff000000000000000008ff200000000000000007ff200000000000000008ff20000000000000000cff00000000000000002ffa0000000000000000cff2000000000000000aff80000000000000008ffb0000000000000006ffb0000000000000005ffc1000000000000004ffb0000000000000004ffb0000000000000004ffb0000000000000000ffd32222222200000000ffffffffffff00000000ffffffffffff0000","0000038beffd9200000000007fffffffff60000000008fd84249fff200000000760000006ff800000000000000000ffa00000000000000000ff900000000000000006ff40000000000000008ff80000000000000ddffc500000000000000ffffb500000000000000557bffb000000000000000005ff800000000000000000efe00000000000000000cff00000000000000000cff00000000000000000ffd00000000b20000009ff800000000ffb6325bffd000000000fffffffffd200000000006adfffb60000000","000000000005ffa0000000000000004fffa000000000000002ffffa00000000000001dfcefa0000000000001dfc0dfa000000000000cfd10dfa00000000000bfe200dfa00000000008ff1000dfa0000000006ff40000dfa000000006ff600000dfa00000000ffa222222dfb22000000ffffffffffffff000000ffffffffffffff000000222222222dfb22000000000000000dfa00000000000000000dfa00000000000000000dfa00000000000000000dfa00000000000000000dfa00000000000000000dfa00000","00005ffffffffffd000000005ffffffffffd000000005ff922222222000000005ff800000000000000005ff800000000000000005ff800000000000000005ff800000000000000005ffb88740000000000005ffffffff800000000005fdbabdfffc00000000000000003dff700000000000000002ffc00000000000000000eff00000000000000000dff00000000000000000efe00000000000000002ffb0000000091000000bff500000000ffb6325cffb000000000fffffffffa000000000027bdffeb40000000","0000000018dffe40000000000008ffffff5000000000009ffc5226300000000004ff90000000000000000cfb00000000000000003ff200000000000000008fd00000000000000000bf9059a9500000000000efcefffffd1000000000ffffb88cffd000000000ffa000007ff800000000ff5000000cfc00000000ff60000009ff00000000ef80000009ff00000000cfa0000009ff000000007ff000000cfc000000001ff900004ff50000000009ffa338ffc00000000000bffffffc10000000000006cffc80000000","000fffffffffffff0000000fffffffffffff00000003333333333bff00000000000000002ffa0000000000000000aff20000000000000003ff90000000000000000cff10000000000000004ff80000000000000000cff00000000000000005ff80000000000000000dfe00000000000000005ff60000000000000000cfd00000000000000005ff60000000000000000efe00000000000000008ff60000000000000000ffe00000000000000007ff70000000000000001efe00000000000000009ff6000000000000","0000006bfffb6000000000001dffedfffd1000000000cff50007ffc000000004ff5000008ff400000008ff0000003ff700000008ff2000003ff600000005ffb000006ff200000000cffc4001ef90000000001cfffc6dfb000000000003efffffc000000000006ff539fffe4000000003ff500009fff20000000bfc0000005ffa0000000ffa0000000dfd0000000ffa0000000cfe0000000efc0000000efc0000000aff6000005ff700000002fff82018ffd0000000004efffffffc1000000000017cffeb50000000","0000004befea3000000000000bfffffff90000000000bffb425dff7000000004ff900001dff00000000aff0000005ff60000000dfc0000000efa0000000ffa0000000cfd0000000efc0000000afe0000000cff1000000aff00000006ffb000002dff00000000dffe989cfffd000000001cffffffbefc000000000048aa830df900000000000000001ff600000000000000008ff10000000000000001ffa0000000000000001dff2000000000363248fff500000000005ffffffd3000000000004effeb6000000000"],"tahoma-bold":["0000018cfffc8100000000004fffffffff4000000003fffffffffff30000000dffffc8cffffc0000004ffffc000cffff3000008ffff50005ffff800000cffff10002ffffb00000dffff00000ffffd00000fffff00000ffffe00000ffffd00000fffff00000ffffd00000fffff00000fffff00000ffffe00000dffff00000ffffd00000bffff20002ffffb000008ffff50005ffff8000004ffffc000cffff3000000dffffc8cffffd00000003fffffffffff3000000004fffffffff4000000000018cfffc81000000","00000008ffff000000000000001effff00000000000348efffff00000000000fffffffff00000000000fffffffff00000000000fffffffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000000000dffff000000000008888effff88880000000fffffffffffff0000000fffffffffffff0000000fffffffffffff0000","000037bdfffc810000000007ffffffffff6000000008fffffffffff400000008fffbadfffffc00000008e600007fffff100000041000000effff200000000000000bffff200000000000000dffff000000000000002ffffc00000000000000affff500000000000006ffffc00000000000002efffe10000000000002effff30000000000003efffe40000000000004ffffe20000000000005ffffe10000000000007fffffa8888888000000ffffffffffffff000000ffffffffffffff000000ffffffffffffff000","000026adfffdb60000000006ffffffffffd200000008fffffffffffe00000008fffcabefffff50000008f8100009ffff8000000210000002ffff8000000000000004ffff400000000000014efffc00000000000dffffffc100000000000dfffffb3000000000000dfffffff9000000000002225bffff7000000000000000dfffe000000000000000affff000000600000000cffff000000fe6000008ffffd000000ffffbabefffff6000000ffffffffffffc0000000fffffffffffa00000000049cefffd93000000","0000000002effff50000000000000cfffff50000000000008ffffff5000000000003fffffff500000000001efffffff50000000000bffe8ffff50000000007fff46ffff5000000002fff906ffff500000000cffd006ffff500000008fff3006ffff50000004fff60006ffff5000000effd55559ffff8550000ffffffffffffffff0000ffffffffffffffff0000ffffffffffffffff0000555555559ffff8550000000000006ffff5000000000000006ffff5000000000000006ffff5000000000000006ffff50000","0002ffffffffffff50000002ffffffffffff50000002ffffffffffff50000002ffffa888888820000002ffff5000000000000002ffff5000000000000002ffff7221000000000002ffffffffe91000000002fffffffffff400000002ffffffffffff10000002eb8669dfffff8000000000000008ffffc000000000000000efffe000000000000000dfffe000000400000000ffffc000000fc400000bffff8000000fffebacffffff1000000ffffffffffff60000000fffffffffff500000000059cffffc81000000","000000039ceffec30000000002cffffffff5000000004ffffffffff500000001effffeb88af50000000affff900000000000002ffffb000000000000007ffff400220000000000bffff3bffffb30000000effffffffffff5000000ffffffffffffff200000ffffe3004dffff900000ffffd00004ffffd00000ffffd00000ffffe00000dfffe00000ffffd00000affff20000ffffc000005ffff80007ffff8000000effff958fffff10000004fffffffffff7000000005fffffffff7000000000018cfffc82000000","00fffffffffffffff00000fffffffffffffff00000fffffffffffffff00000aaaaaaaaacfffff00000000000000cffff900000000000006fffff10000000000000effff800000000000007ffffd00000000000000effff600000000000008ffffe00000000000002fffff50000000000000bffffd00000000000004fffff50000000000000cffffc00000000000004fffff30000000000000dffffa00000000000006fffff20000000000000dffffa00000000000008fffff20000000000002fffff900000000000","0000029cfffda400000000008fffffffffb100000008fffffffffffc0000002fffff857fffff4000007ffff50004ffff8000008ffff30000ffff7000005ffffb0003ffff2000000fffffe719fff800000004ffffffffff80000000003efffffffc3000000001bffffffffff60000001efff518efffff400000afffc00008ffffc00000ffff900000cffff00000ffffb00000affff00000effff20001efffc000008fffff857dffff7000001efffffffffffc00000002cfffffffffa00000000005adfffd93000000","0000018cfffc8100000000006fffffffff5000000006fffffffffff40000001fffff859ffffe0000008ffff80008ffff500000cffff10002ffffa00000fffff00000efffd00000fffff00000dffff00000dffff40000dffff000009ffffd6225effff000002ffffffffffffff0000006ffffffffffffd00000004bffffb3ffffa000000000022004ffff600000000000000cffff10000000000001affff900000005e988bfffffe100000005fffffffffe2000000005ffffffffb10000000003dfffec9300000000"],"verdana":["0000004bfffb40000000000009fffffff900000000007ffb424bff6000000000ffb00000bfe000000005ff3000003ff400000009ff0000000ff90000000cfc0000000cfc0000000ffa0000000afe0000000ffa0000000aff0000000ffa0000000aff0000000ffa0000000aff0000000ffa0000000aff0000000ffa0000000afe0000000cfc0000000dfc00000009fe0000000ff900000005ff3000003ff500000000ffb00000bff0000000007ffb424bff700000000009fffffff90000000000005bfffb40000000","000000006fd00000000000000001dfd0000000000000358effd0000000000000ffffffd0000000000000aaaaffd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd00000000000000000dfd0000000000000fffffffffff000000000fffffffffff00000","000038beffda400000000009fffffffff8000000000afe84237eff700000000960000001eff000000000000000008ff200000000000000008ff200000000000000008ff20000000000000000cff00000000000000004ff90000000000000001efe1000000000000000cff4000000000000000bff6000000000000000bff6000000000000001bff6000000000000001dff4000000000000001eff4000000000000002efe4000000000000000fff52222222220000000fffffffffffff0000000fffffffffffff0000","000027befffc700000000006fffffffffe3000000008ff95224affe000000007800000008ff600000000000000002ff800000000000000002ff700000000000000008ff10000000000000018ff60000000000006deffb300000000000008ffffa400000000000002557cff8000000000000000007ff600000000000000000efc00000000000000000bff00000000000000000cfe00000000000000000ffc0000000c40000000aff60000000ffc74236dffc00000000ffffffffffb100000000049cfffda40000000","00000000000dff2000000000000000bfff2000000000000008ffff200000000000005ffcff20000000000003ff58ff2000000000002ef708ff200000000001df9008ff20000000000cfc0008ff2000000000afe10008ff2000000008fe200008ff200000006fe3000008ff20000000ff40000008ff20000000fffffffffffffff00000fffffffffffffff00000555555555aff755000000000000008ff200000000000000008ff200000000000000008ff200000000000000008ff200000000000000008ff200000","0002ffffffffffff00000002ffffffffffff00000002ff922222222200000002ff800000000000000002ff800000000000000002ff800000000000000002ff800000000000000002ffb88864000000000002ffffffffe70000000002fdbaacefffb00000000000000004eff700000000000000003ffd00000000000000000dff00000000000000000cff00000000000000000dff00000000000000002ffb0000000910000000cff50000000ffb74236dffb00000000ffffffffffa00000000016adfffd930000000","0000000039cfffd100000000001bfffffff20000000004effb632471000000001eff4000000000000000aff40000000000000001ff900000000000000007ff10000000000000000bfc027aaa72000000000dfcbfffffffa00000000ffffd988bfffc0000000ffc2000001cff6000000ff900000001ffc000000ffa00000000bff000000efa00000000aff000000bfe00000000bfe0000006ff40000000ffb0000000ffe200000aff400000005fff8325cffa0000000006ffffffffa0000000000028cffd93000000","000ffffffffffffff000000ffffffffffffff00000033333333333bff00000000000000001ffa0000000000000000aff20000000000000002ff80000000000000000cfe00000000000000003ff60000000000000000dfe00000000000000006ff60000000000000000efd00000000000000008ff50000000000000001ffd00000000000000009ff30000000000000004ffa0000000000000000cff20000000000000005ff90000000000000000cff20000000000000004ff90000000000000000dfe000000000000","0000004aeffea500000000001bfffddfffc100000000cff700008ffc00000004ff60000008ff40000008ff10000001ff80000008ff40000002ff70000004ffd1000006ff20000000cffe60002ef9000000000affff95efa00000000002cffffff900000000004ff705bfffe400000003ff7000019fff3000000bfd00000005ffb000000ff900000000cff000000ff900000000aff000000ffd00000000cfe000000aff80000005ff80000001effb30039ffd000000002effffffffc100000000005beffda4000000","0000003adffc8200000000000affffffff6000000000affc5238fff500000004ffa000002eff0000000bff00000005ff6000000ffb00000000efb000000ffa00000000bfe000000ffb00000000aff000000cff10000000aff0000007ffc1000002cff0000000cfffb889dffff00000001afffffffbcfd00000000027aaa720dfa00000000000000001ff600000000000000009ff10000000000000004ff90000000000000004efe100000000174225affe30000000002fffffffb100000000001dfffc9300000000"],"verdana-bold":["0000006beffeb600000000004effffffffe300000003ffffffffffff2000000cffffe88effffc000003ffffe1001fffff300008ffff800008ffff80000cffff400004ffffb0000effff200002ffffd0000fffff000000fffff0000fffff000000fffff0000fffff000000fffff0000fffff000000fffff0000effff200002ffffd0000cffff400004ffffb00008ffff800009ffff800004fffff1001fffff300000cffffe88effffc0000003ffffffffffff200000004effffffffe400000000007beffeb7000000","00000008ffff000000000000001effff00000000000348efffff00000000000fffffffff00000000000fffffffff00000000000fffffffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000000000fffff000000000008888fffff88880000000fffffffffffff0000000fffffffffffff0000000fffffffffffff0000","000169cefffc95000000006fffffffffffc10000008ffffffffffffd1000008ffffddfffffff9000008fb500006fffffe00000430000000afffff000000000000006fffff000000000000007ffffe00000000000000dffff800000000000006ffffe10000000000004fffff50000000000005fffff80000000000007fffff90000000000009fffff6000000000001cffffe3000000000004fffffd1000000000007ffffffbaaaaaaaa0000ffffffffffffffff0000ffffffffffffffff0000ffffffffffffffff00","000169cffffc94000000006fffffffffffb10000008ffffffffffffc0000008ffffddeffffff4000008fc500002dffff7000004400000005ffff6000000000000007ffff100000000012248ffff80000000000afffffff800000000000affffff8100000000000affffffff8000000000012236dffff5000000000000001ffffc000000000000000fffff000007000000002ffffe00000ff8300004dffffb00000fffffddfffffff400000fffffffffffff9000000ffffffffffff80000000048cefffec81000000","0000000004fffff80000000000001efffff8000000000000cffffff8000000000008fffffff800000000005fffeffff80000000003fffa8ffff8000000002fffd08ffff800000000dfff208ffff800000009fff6008ffff80000007fff90008ffff8000004fffb00008ffff800000effe55555affffa55000fffffffffffffffff000fffffffffffffffff000fffffffffffffffff000555555555affffa550000000000008ffff8000000000000008ffff8000000000000008ffff8000000000000008ffff80000","005fffffffffffff8000005fffffffffffff8000005fffffffffffff8000005ffffcaaaaaaaa5000005ffff5000000000000005ffff5000000000000005ffff5000000000000005ffffffffda5000000005fffffffffffd20000005ffffffffffffe1000005fea888bffffff900000010000000bffffe000000000000001fffff000000000000000fffff000009200000005ffffe00000ffa300006fffff900000fffffddfffffff200000fffffffffffff6000000fffffffffffe50000000059cefffda50000000","000000006adfffec30000000008fffffffff500000001cffffffffff50000000cfffffc988bf50000007ffffe40000000000000fffff200000000000004ffff9001220000000009ffff58dffffa2000000cfffffffffffff400000dffffffffffffff10000dffff84249fffff80000effff000008ffffc0000dffff200003ffffe0000bffff300002ffffe00008ffff700003ffffc00002ffffe1000bffff800000bffffd65bfffff1000001efffffffffff500000002cfffffffff500000000005adffeb7000000","00ffffffffffffffff0000ffffffffffffffff0000ffffffffffffffff0000ddddddddddefffff00000000000000effffc00000000000007fffff30000000000002fffff90000000000000bffffe00000000000004fffff60000000000000dffffd00000000000007fffff40000000000001fffffb00000000000009fffff10000000000002fffff80000000000000cffffe00000000000006fffff60000000000001fffffc00000000000008fffff20000000000002fffffa0000000000000cfffff10000000000","0000018cefffc820000000007ffffffffffa00000008ffffffffffffb000002fffffa559fffff400007ffff800008ffff800008ffff500002ffff700005ffffd30006ffff200000efffffb52efff60000004ffffffffffd4000000002cffffffffa2000000008fffffffffff6000000cfffa17dffffff300009ffff00004cffffb0000ffffb000000fffff0000ffffc000000dffff0000effff400002ffffd00009fffffa658fffff700001effffffffffffb0000001cffffffffff900000000049dfffec8200000","0000006beffeb600000000004effffffffe400000005ffffffffffff3000001fffffb56cffffd000008ffffb0000cffff50000cffff300004ffffa0000fffff000000ffffd0000fffff200000fffff0000dffff800000fffff00008fffff94247fffff00001fffffffffffffff000004fffffffffffffd0000002affffe84ffffa000000000221007ffff600000000000001fffff00000000000003dffff80000005fb889dfffffd00000005ffffffffffd100000005fffffffff80000000003defffda610000000"],"trebuchet":["00000029effc60000000000004fffffffb00000000002ffe624bffa000000000cfe10000cff300000004ff8000004ff800000009ff3000000ffb0000000cff0000000efd0000000dfd0000000dff0000000ffd0000000dff0000000ffd0000000cff0000000ffd0000000dff0000000ffd0000000dff0000000dfe0000000dfd0000000cff0000000ffb00000009ff4000003ff800000006ff8000007ff300000002ffe10001efd0000000009ffd425eff30000000000bfffffff60000000000005befea30000000","000000000005f000000000000000007ff0000000000000000afff000000000000003cffff0000000000000affffff0000000000000ffa2dff0000000000000e400dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff0000000","000002aeffda4000000000004ffffffff80000000000dff9337fff30000000006f400004ff900000000001000000ffc00000000000000000ffc00000000000000002ff900000000000000007ff40000000000000000efe00000000000000009ff60000000000000004ffc0000000000000000eff30000000000000009ff90000000000000002ffe1000000000000000cff40000000000000007ff90000000000000002ffe0000000000000000bffa6666666000000004fffffffffff00000000efffffffffff0000","000005bfffc60000000000006fffffffd200000000000ea424bffc00000000000100000dff400000000000000008ff700000000000000008ff600000000000000009ff30000000000000004ffb000000000000008dffc100000000000000dffd20000000000000006afff600000000000000001dff400000000000000002ffc00000000000000000dff00000000000000000cff00000000000000000fff00000000004000006ffc0000000008fa4248fff4000000000cffffffff6000000000005beffc820000000","00000000000006f000000000000000005ff00000000000000001fff0000000000000001efff000000000000000cffff00000000000000affdff00000000000007ff5aff0000000000004ff80aff000000000003ffb00aff00000000002efc000aff0000000000cfe1000aff000000000bff40000aff000000009ffc88888dff88000000ffffffffffffff000000999999999dff99000000000000000aff00000000000000000aff00000000000000000aff00000000000000000aff00000000000000000aff00000","00008fffffffff20000000008fffffffff20000000008ff222222200000000008ff000000000000000008ff000000000000000008ff000000000000000008ff49a960000000000008fffffffe400000000008ffa89effe10000000005e20000cff800000000000000002ffc00000000000000000dff00000000000000000bff00000000000000000bff00000000000000000dfe00000000000000001ffa00000000015000009ff50000000008fa4249ffe0000000000cfffffffe2000000000006bfffc800000000","00000000008e50000000000000002dffb000000000000002eff6000000000000000dff8000000000000000affa0000000000000004ffe0000000000000000dff50000000000000003ffc04530000000000009ffcfffff80000000000dffffddfffb000000000fffd2003eff500000000fff300002ffc00000000ffe000000eff00000000ffc000000cff00000000cfd000000cff000000009ff100000ffd000000004ff700005ff8000000000cff8338fff10000000001cfffffff40000000000006cffe92000000","000fffffffffffff0000000ffffffffffffc0000000999999999dff40000000000000001ffb00000000000000009ff20000000000000002ff90000000000000000aff30000000000000001ffc00000000000000009ff40000000000000000ffc00000000000000007ff40000000000000000dfd00000000000000006ff60000000000000000dff00000000000000005ffa0000000000000000bff40000000000000001ffd00000000000000008ff80000000000000000dff20000000000000002ffe000000000000","00000018dffd91000000000002efffffff40000000000dff8339ffe0000000003ffa00009ff4000000005ff800006ff5000000003ffb00007ff4000000000eff6000dff00000000004fff909ff6000000000004dfffff80000000000006fffffe2000000000008ffc49fff60000000004ffc0004eff300000000bff200002ffb00000000ffd000000cff00000000ffc000000aff00000000efe000000eff00000000cff500003ffc000000005fff8338fff40000000009ffffffff8000000000004aeffd93000000","00000018effc70000000000004fffffffc10000000001fff8338ffc0000000008ff700005ff400000000eff000000ff900000000ffc000000cfd00000000ffc000000cff00000000ffe000000eff00000000cff400001fff000000005ffe3002cfff000000000bfffddffffd00000000008fffffbff90000000000003540bff30000000000000004ffd0000000000000001eff4000000000000000bff90000000000000008ffe0000000000000006ffe2000000000000009ffd20000000000000004e80000000000"],"futura":["00000005bffb50000000000000bffffffb00000000000bfffaafffb0000000007ffd1001dff700000000fff400004fff00000005ffc000000cff50000009ff60000006ff9000000cff30000003ffc000000fff00000000fff000000fff00000000fff000000fff00000000fff000000fff10000000fff000000cff30000003ffc0000009ff70000007ff90000005ffd000000dff50000000fff500005fff000000007ffe3003fff7000000000bfffccfffb00000000000bffffffb00000000000005bffb50000000","00000000cffff000000000000004fffff00000000000000addfff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff00000000000000000dff0000000","0000004aeffc60000000000007fffffffc10000000003fffeabfffc000000000bff90002dff600000001ffd000003ffc00000005ff8000000eff00000000220000000eff00000000000000005ffc0000000000000000dff6000000000000000affd0000000000000005fff3000000000000002fff8000000000000000dffc000000000000000affd1000000000000008ffe2000000000000007ffe2000000000000003fff5000000000000001efffddddddd00000000cfffffffffff00000009ffffffffffff0000","00000008cffd80000000000001dffffffe30000000000afffbbfffe0000000000ffe1001dff5000000004ff800004ff900000000244100002ffa00000000000000004ff80000000000000001cff300000000000009dfff900000000000000bfffe1000000000000007bfffc00000000000000000bff600000000000000001ffc00000000000000000dff00000000aa8000000eff00000000dff100002ffc000000008ffb0001cff8000000001efffbcfffe00000000003fffffffe20000000000018dffc80000000","0000000000000070000000000000000002f000000000000000000cf000000000000000008ff00000000000000003fff0000000000000000dfff0000000000000008ffff000000000000004fffff00000000000001effeff00000000000009ff8dff0000000000005ffc0dff000000000001eff20dff00000000000aff600dff00000000005ffa000dff0000000002eff6444eff440000000bffffffffffff0000006fffffffffffff000000455555555eff55000000000000000dff00000000000000000dff00000","00000000ffffffffa00000000004ffffffffa00000000009ffeddddd80000000000eff10000000000000003ffe00000000000000008ff92000000000000000dfffffc5000000000002ffffffffb00000000007ffa89dfffa000000000cb100008fff40000000050000000affa00000000000000003ffe00000000000000000fff00000000000000000fff00000001300000004ffc0000004ff2000001dff8000000cffe50003dffe00000002effffdeffff4000000002dfffffffe4000000000007cffeb70000000","00000000000b5000000000000000009ff70000000000000004fff1000000000000000eff5000000000000000affa0000000000000008ffc0000000000000004ffe1000000000000001eff9410000000000000bffffffd400000000006fffffffff4000000000fffc525cfff100000008ffa00000aff90000000dff0000000ffe0000000ffd0000000dff0000000ffe0000000eff0000000bff4000004ffb00000004fff40004fff400000000afffdadfffa00000000009fffffffa0000000000004aefeb40000000","00ffffffffffffffb00000ffffffffffffff100000bbbbbbbbbcfff60000000000000009ffc0000000000000003fff2000000000000000cff80000000000000006ffe0000000000000002fff3000000000000000cff90000000000000005ffe0000000000000000eff50000000000000009ffc0000000000000003fff2000000000000000eff60000000000000008ffc0000000000000002fff3000000000000000cff90000000000000006ffe0000000000000000dff4000000000000000008a000000000000000","00000006cffc60000000000001bffffffc10000000000affe99effa0000000002ffd1001dff2000000006ff500005ff6000000008ff200002ff8000000006ff500005ff6000000001ffe2002eff10000000008fffbbfff800000000000cffffffd000000000009ffffffffa0000000004fff6006fff400000000cff400004ffb00000000ffe000000eff00000000ffd000000dff00000000dff300003ffd000000008ffd1001dff8000000001efffbbfffe10000000002effffffe30000000000007cffd81000000","0000004befea4000000000000afffffff90000000000afffa8afffa000000004ffe30003eff40000000bff4000004ffb0000000ffe0000000eff0000000ffd0000000dff0000000eff0000000ffd00000009ffa00000aff800000002fffc424cfff0000000005fffffffff600000000004dffffffb000000000000025affe1000000000000001eff4000000000000000cff80000000000000008ffb0000000000000005ffe1000000000000001eff50000000000000007ff9000000000000000006b000000000000"],"avenir-next-condensed":["0000004befeb40000000000006fffffff600000000004fffffffff4000000000effffdffffd000000005ffff707ffff400000009ffff101ffff90000000cfffc000cfffc0000000efff90009fffd0000000ffff80009ffff0000000ffff60006ffff0000000ffff60006ffff0000000ffff80009ffff0000000efff90009fffd0000000cfffb000cfffc00000009ffff001ffff800000004ffff808ffff400000000effffdffffd0000000004fffffffff400000000006fffffff60000000000004befeb40000000","0000000008ffff00000000000001cfffff0000000000003effffff000000000008ffffffff00000000000dffffffff000000000004fff9ffff000000000000cd23ffff0000000000002003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff0000000000000003ffff000000","00000017cffe92000000000004efffffff60000000001efffffffff2000000007ffffccffff900000000cfffa00afffe00000000cdff4005ffff0000000000000007ffff000000000000000cfffc000000000000005ffff700000000000002ffffe00000000000001effff40000000000000dffff60000000000000affffa00000000000008ffffc00000000000007ffffd10000000000004ffffe20000000000000affffedddddb00000000affffffffffd00000000affffffffffd00000000affffffffffd0000","00000006bffd81000000000000bffffffe20000000000affffffffe0000000003ffff9affff50000000039ef800afff80000000000021008fff90000000000000008fff7000000000000002efff20000000000006dffff800000000000008ffff8000000000000008fffff80000000000000259ffff50000000000000007fffc0000000000000002ffff0000000003790004ffff00000000cfff4009fffc00000000affff8affff8000000002fffffffffe10000000004fffffffe40000000000018cffd81000000","000000009fffff20000000000001ffffff20000000000008ffffff2000000000000fffffff2000000000007fffdfff200000000000dffbafff200000000006fff3afff20000000000effc0afff20000000006fff50afff2000000000effe00afff2000000005fff800afff200000000cfff100afff200000000ffffcccefffdc0000000fffffffffffff0000000fffffffffffff0000000fffffffffffff00000000000000dfff2000000000000000dfff2000000000000000dfff2000000000000000dfff200000","000005fffffffff50000000008fffffffff50000000008fffffffff50000000008fffffffff50000000008fff20000000000000009fff2000000000000000afff1000000000000000afffdffb400000000000affffffff80000000000afffffffff4000000000cb634affffa0000000000000008fffe0000000000000002ffff0000000000130002ffff000000004bfe0004fffe00000000dfff902cfffc000000007ffffffffff6000000000dffffffffc00000000002effffffe10000000000018dffd81000000","00000000cffff400000000000004ffffc00000000000000effff300000000000006ffffa00000000000000efffe100000000000008ffff600000000000000efffe651000000000009ffffffff90000000001ffffffffffc000000007fffffaeffff60000000bffff201efffb0000000efff90008fffe0000000ffff60005ffff0000000ffff60006ffff0000000efffa000afffe0000000bffff605ffffc00000005fffffffffff500000000afffffffffb0000000000bfffffffb0000000000006beffc60000000","0000ffffffffffff00000000ffffffffffff00000000ffffffffffff00000000fffffffffffe000000000000004ffff9000000000000009ffff300000000000000ffffc000000000000005ffff800000000000000cffff200000000000003ffffc000000000000008ffff600000000000000dffff000000000000004ffffa00000000000000affff500000000000001ffffe000000000000006ffff900000000000000cffff200000000000002ffffc000000000000009ffff700000000000000effff2000000000","0000006cfffc6000000000000bfffffffc1000000000cfffffffffd000000004ffff706ffff500000008fffd000dfffa00000008fffc0009fffa00000007fffd000dfff900000002ffff504ffff4000000006ffffdffff800000000004fffffff600000000005fffffffff7000000003ffffb5bffff60000000afffd000dfffc0000000dfff90008ffff0000000efff90009ffff0000000cfffe000dfffe00000008ffffb5affffa00000001effffffffff2000000001dfffffffe3000000000006cfffc70000000","0000006befeb6000000000001bfffffffb1000000000cfffffffffc000000005fffffafffff50000000cfffe102efffb0000000ffff80008fffe0000000ffff50006ffff0000000ffff60006ffff0000000efff90009fffe0000000bffff204ffffb00000005fffffdfffff600000000affffffffff00000000007ffffffff800000000000145efffe100000000000006ffff600000000000001ffffe00000000000000affff600000000000003ffffd00000000000000cffff400000000000004ffffc000000000"],"seven-segment":["00000bfffffffb00000000000febbbbbef00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf000000000007500000570000000000086000006800000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000febbbbbef00000000000bfffffffb000000","000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff0000000000000000007700000000000000000077000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000000000000ff000000000","000007fffffffb000000000005bbbbbbef000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000006ddddddfb00000000000cfdddddd500000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000febbbbbb500000000000bfffffff7000000","00000ffffffffb00000000000bbbbbbbff000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf00000000000dddddddfb00000000000dddddddfc000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf00000000000bbbbbbbff00000000000ffffffffb000000","00000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000fe000000ef0000000000bfeeeeeefb00000000005eeeeeeefb000000000000000000ef000000000000000000ef000000000000000000ef000000000000000000ef000000000000000000ef000000000000000000ef000000000000000000ef000000000000000000ef000000000000000000ef00000","00000bfffffff700000000000febbbbbb500000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000bfdddddd6000000000005ddddddfc000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000005bbbbbbef000000000007fffffffb000000","00000bfffffff700000000000febbbbbb500000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000fb000000000000000000bfdddddd600000000000cfdddddfc00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000febbbbbef00000000000bfffffffb000000","00000ffffffffb00000000000bbbbbbbff000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf0000000000000000009b00000000000000000023000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000000000000000cf000000","00000bfffffffb00000000000febbbbbef00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000bfdddddfb00000000000cfdddddfc00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000febbbbbef00000000000bfffffffb000000","00000bfffffffb00000000000febbbbbef00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000fb00000bf00000000000bfdddddfb000000000005ddddddfc000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000000000000bf000000000005bbbbbbef000000000007fffffffb000000"]};
  var TEMPLATE_VEC = null;
  var DIGIT_HOLES_OK = { 0: [1], 1: [0], 2: [0], 3: [0], 4: [0, 1], 5: [0], 6: [1], 7: [0], 8: [2], 9: [1] };
  // fields whose AUTO needs the independent digit check (opts.verifyFields overrides, e.g. ["hr","spo2","rr"])
  var VERIFY_FIELDS = ["rr"];
  function verifyRequired(field, opts) { return (opts && opts.verifyFields || VERIFY_FIELDS).indexOf(field) >= 0; }
  var VERIFY = { minGlyphPx: 14, minContrast: 45, minScore: 0.75, minMargin: 0.08, holePenalty: 0.85 };
  function otsu(hist, n) {
    var sum = 0, i; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = -1, T = 128;
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break; sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; T = i; } }
    return T;
  }
  function components(ink, W, H) {
    var lab = new Int32Array(W * H), comps = [], stack = [], id = 0;
    for (var p = 0; p < W * H; p++) {
      if (!ink[p] || lab[p]) continue;
      id++; var c = { id: id, n: 0, x0: W, x1: -1, y0: H, y1: -1 }; lab[p] = id; stack.push(p);
      while (stack.length) {
        var q = stack.pop(), x = q % W, y = (q - x) / W; c.n++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          var r = Y * W + X; if (ink[r] && !lab[r]) { lab[r] = id; stack.push(r); }
        }
      }
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }
  // same normalisation as digit-templates.py norm(): fit into 20x20 keeping aspect, area-average
  function normGlyph(bm, w, h) {
    var S = 20, nh = S, nw = Math.max(1, Math.round(w * S / h));
    if (nw > S) { nw = S; nh = Math.max(1, Math.round(h * S / w)); }
    var out = new Float64Array(S * S), ox = Math.floor((S - nw) / 2), oy = Math.floor((S - nh) / 2);
    for (var cy = 0; cy < nh; cy++) for (var cx = 0; cx < nw; cx++) {
      var sx0 = cx * w / nw, sx1 = (cx + 1) * w / nw, sy0 = cy * h / nh, sy1 = (cy + 1) * h / nh, acc = 0, area = 0;
      for (var y = Math.floor(sy0); y < Math.ceil(sy1); y++) for (var x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
        var a = (Math.min(x + 1, sx1) - Math.max(x, sx0)) * (Math.min(y + 1, sy1) - Math.max(y, sy0));
        if (a > 0) { area += a; acc += a * bm[y * w + x]; }
      }
      out[(oy + cy) * S + ox + cx] = area ? acc / area : 0;
    }
    return out;
  }
  function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0, i; for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    var sab = 0, saa = 0, sbb = 0; for (i = 0; i < n; i++) { var da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  function templates() {
    if (TEMPLATE_VEC) return TEMPLATE_VEC;
    TEMPLATE_VEC = [];
    Object.keys(DIGIT_TEMPLATES).forEach(function (face) {
      DIGIT_TEMPLATES[face].forEach(function (hex, d) { var v = new Float64Array(400); for (var i = 0; i < 400; i++) v[i] = parseInt(hex.charAt(i), 16) / 15; TEMPLATE_VEC.push({ face: face, d: d, v: v }); });
    });
    return TEMPLATE_VEC;
  }
  function countHoles(bm, w, h) {
    var PW = w + 2, PH = h + 2, bg = new Uint8Array(PW * PH), seen = new Uint8Array(PW * PH), holes = [], st = [], x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (!bm[y * w + x]) bg[(y + 1) * PW + x + 1] = 1;
    for (x = 0; x < PW; x++) { bg[x] = 1; bg[(PH - 1) * PW + x] = 1; } for (y = 0; y < PH; y++) { bg[y * PW] = 1; bg[y * PW + PW - 1] = 1; }
    function fill(start) {
      var n = 0, sy = 0; st.length = 0; st.push(start); seen[start] = 1;
      while (st.length) {
        var q = st.pop(), qx = q % PW, qy = (q - qx) / PW; n++; sy += qy;
        if (qx > 0 && bg[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st.push(q - 1); }
        if (qx < PW - 1 && bg[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st.push(q + 1); }
        if (qy > 0 && bg[q - PW] && !seen[q - PW]) { seen[q - PW] = 1; st.push(q - PW); }
        if (qy < PH - 1 && bg[q + PW] && !seen[q + PW]) { seen[q + PW] = 1; st.push(q + PW); }
      }
      return { n: n, cy: sy / n };
    }
    fill(0);
    for (var p = 0; p < PW * PH; p++) if (bg[p] && !seen[p]) { var f = fill(p); if (f.n >= Math.max(3, 0.012 * w * h)) holes.push(+((f.cy - 1) / h).toFixed(2)); }
    return holes;
  }
  // best correlation per digit over all faces; a hole count the digit cannot have costs holePenalty
  function classifyGlyph(g) {
    var v = normGlyph(g.bm, g.w, g.h), holes = countHoles(g.bm, g.w, g.h), best = [], face = [], d;
    for (d = 0; d < 10; d++) { best[d] = -1; face[d] = null; }
    templates().forEach(function (t) { var r = pearson(v, t.v); if (r > best[t.d]) { best[t.d] = r; face[t.d] = t.face; } });
    var scores = [];
    for (d = 0; d < 10; d++) scores.push({ d: d, s: best[d] * (DIGIT_HOLES_OK[d].indexOf(Math.min(holes.length, 2)) >= 0 ? 1 : VERIFY.holePenalty), face: face[d] });
    scores.sort(function (a, b) { return b.s - a.s; });
    return { digit: scores[0].d, score: +scores[0].s.toFixed(2), margin: +(scores[0].s - scores[1].s).toFixed(2), second: scores[1].d, face: scores[0].face, holes: holes.length, aspect: +(g.w / g.h).toFixed(2) };
  }
  function readGlyphs(px, box) {
    if (!px || !px.get || !px.w) return { error: "no pixels" };
    var X0 = Math.max(0, Math.floor((box.x - box.h * 0.08) * px.w)), X1 = Math.min(px.w - 1, Math.ceil((box.x + box.w + box.h * 0.08) * px.w));
    var Y0 = Math.max(0, Math.floor((box.y - box.h * 0.12) * px.h)), Y1 = Math.min(px.h - 1, Math.ceil((box.y + box.h * 1.12) * px.h));
    var W = X1 - X0 + 1, H = Y1 - Y0 + 1;
    if (H < VERIFY.minGlyphPx || W < 4) return { error: "value too small in pixels (" + H + " px)" };
    var val = new Uint8Array(W * H), hist = new Array(256), i; for (i = 0; i < 256; i++) hist[i] = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var c = px.get(X0 + x, Y0 + y) || [0, 0, 0], v = Math.max(c[0], c[1], c[2]); val[y * W + x] = v; hist[v]++; }
    var T = otsu(hist, W * H), nHi = 0, sHi = 0, sLo = 0;
    for (i = 0; i < W * H; i++) if (val[i] > T) { nHi++; sHi += val[i]; } else sLo += val[i];
    if (!nHi || nHi === W * H) return { error: "blank value box" };
    var contrast = sHi / nHi - sLo / (W * H - nHi);
    if (contrast < VERIFY.minContrast) return { error: "low contrast (" + contrast.toFixed(0) + ")" };
    var dark = nHi > W * H * 0.5, ink = new Uint8Array(W * H);   // more "bright" than "dark": dark text on a light screen
    for (i = 0; i < W * H; i++) ink[i] = dark ? (val[i] <= T ? 1 : 0) : (val[i] > T ? 1 : 0);
    var cc = components(ink, W, H), parts = cc.comps.filter(function (c) { return c.n >= 4 && (c.y1 - c.y0 + 1) >= H * 0.12; });
    // glyph = components overlapping in x (broken strokes, seven-segment segments)
    parts.sort(function (a, b) { return a.x0 - b.x0; });
    var glyphs = [];
    parts.forEach(function (c) {
      var g = glyphs[glyphs.length - 1];
      if (g) { var ov = Math.min(g.x1, c.x1) - Math.max(g.x0, c.x0) + 1; if (ov >= 0.5 * Math.min(g.x1 - g.x0 + 1, c.x1 - c.x0 + 1)) { g.ids.push(c.id); g.x0 = Math.min(g.x0, c.x0); g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); return; } }
      glyphs.push({ ids: [c.id], x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 });
    });
    var maxGH = 0; glyphs.forEach(function (g) { maxGH = Math.max(maxGH, g.y1 - g.y0 + 1); });
    glyphs = glyphs.filter(function (g) { return g.y1 - g.y0 + 1 >= maxGH * 0.6 && !(g.y0 === 0 && g.y1 === H - 1 && g.x1 - g.x0 + 1 > H); });
    if (maxGH < VERIFY.minGlyphPx) return { error: "digits too small in pixels (" + maxGH + " px)" };
    return { glyphs: glyphs.map(function (g) {
      var w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1, bm = new Uint8Array(w * h), ids = {}; g.ids.forEach(function (id) { ids[id] = 1; });
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) if (ids[cc.lab[(g.y0 + yy) * W + g.x0 + xx]]) bm[yy * w + xx] = 1;
      var r = classifyGlyph({ w: w, h: h, bm: bm }); r.px = { x: X0 + g.x0, y: Y0 + g.y0, w: w, h: h }; return r;
    }), threshold: T, contrast: +contrast.toFixed(0), dark: dark };
  }
  // expected = the digits Vision read for the value (e.g. "15"). The rightmost glyphs carry them (icons
  // and "=" / "°" Vision glues on the left are shorter or unclassifiable); an extra CONFIDENT digit
  // glyph means Vision dropped a digit, so nothing is verified.
  function verifyDigits(px, box, expected) {
    var rd = readGlyphs(px, box), exp = String(expected);
    if (rd.error) return { status: "unsure", reason: "independent digit check could not run: " + rd.error };
    var G = rd.glyphs, n = exp.length;
    if (G.length < n) return { status: "unsure", reason: "independent digit check found " + G.length + " digit shape(s) for " + JSON.stringify(exp), glyphs: G };
    var run = G.slice(G.length - n), extra = G.slice(0, G.length - n);
    var sure = function (g) { return g.score >= VERIFY.minScore && g.margin >= VERIFY.minMargin; };
    var read = run.map(function (g) { return sure(g) ? String(g.digit) : "?"; }).join("");
    var info = { read: read, method: "pixel glyphs: Otsu binarisation, connected components, template correlation (16 faces + seven-segment), hole topology", glyphs: run.map(function (g) { return { d: g.digit, score: g.score, margin: g.margin, second: g.second, face: g.face, holes: g.holes, aspect: g.aspect }; }), contrast: rd.contrast };
    if (extra.some(function (g) { return sure(g) && g.score >= 0.85; })) return assign(info, { status: "unsure", reason: "independent digit check sees an extra digit-like shape left of " + JSON.stringify(exp) });
    for (var i = 0; i < n; i++) if (read[i] !== "?" && read[i] !== exp[i]) return assign(info, { status: "disagree", reason: "independent digit check reads " + JSON.stringify(read) + ", OCR read " + JSON.stringify(exp) });
    if (read.indexOf("?") >= 0) return assign(info, { status: "unsure", reason: "independent digit check could not distinguish digit(s) of " + JSON.stringify(exp) + " (read " + JSON.stringify(read) + ")" });
    return assign(info, { status: "verified" });
  }

  /* ------------------------------------------------------------------ main */
  function parseMonitor(obs, opts) {
    opts = assign({}, opts);
    var t0 = Date.now(), px = opts.px || null;
    if (px) sampleColors(obs, px);
    var G = buildGraph(obs, opts), claimed = {}, claimedLabels = {}, fields = {};
    var quality = assessQuality(G, px, opts);
    if (quality.status === "DEGRADED") opts.__degraded = true;
    var dbg = { profile: G.profile, maxH: G.maxH, colX: G.colX, column: G.big.map(function (b) { return { text: b.t, y: +b.y.toFixed(3), h: +b.h.toFixed(4) }; }) };
    if (quality.status === "RETAKE_PHOTO") {
      var why = "RETAKE_PHOTO: " + quality.issues.filter(function (i) { return i.severity === "severe"; }).map(function (i) { return i.message; }).join("; ");
      ["sbp", "dbp", "map", "hr", "spo2", "rr", "pulse", "temp", "etco2", "cvp", "pvc"].forEach(function (k) { fields[k] = { status: "NEEDS_REVIEW", confidence: 0, value: null, retake: true, reason: why, candidates: [] }; });
      return { version: VERSION, fields: fields, values: {}, review: fields, notFound: [], warnings: [why], quality: quality, layout: { profile: G.profile || "generic", order: G.order }, stats: { boxes: G.B.length, parseMs: Date.now() - t0, colorSampled: !!px }, graph: dbg };
    }
    var pr = parsePressures(G, px, claimed, claimedLabels, opts);
    fields.sbp = pr.sbp; fields.dbp = pr.dbp; fields.map = pr.map; if (pr.art) fields.art = pr.art; if (pr.nibp) fields.nibp = pr.nibp;
    // On-device vital-tile detector (opts.detections from Core ML): a detector box of a field's class can
    // stand in for an UNREAD label. It only associates; digits are still Vision's, and every gate still applies.
    var DET_MIN = 0.5;
    var dets = on(opts, "detector") ? (opts.detections || []).filter(function (d) { return d && d.conf >= DET_MIN && d.w > 0 && d.h > 0; }) : [];
    function inDet(b, d) { var cx = b.x + b.w / 2, cy = b.y + b.h / 2, mx = d.w * 0.1, my = d.h * 0.1; return cx >= d.x - mx && cx <= d.x + d.w + mx && cy >= d.y - my && cy <= d.y + d.h + my; }
    function bestDet(field) { var best = null; dets.forEach(function (d) { if (d.cls === field && (!best || d.conf > best.conf)) best = d; }); return best; }
    function claimedByOther(b, field, d) { return dets.some(function (o) { return o !== d && o.cls !== field && o.conf > d.conf && inDet(b, o); }); }
    var ORDER = ["hr", "spo2", "rr", "pulse", "temp", "etco2", "cvp", "pvc"];
    ORDER.forEach(function (field) {
      var f = FIELDS[field], label = findLabel(G, field, claimedLabels), L = label && label.box;
      var det = !L ? bestDet(field) : null;      var chan = L && px ? channelColor(L, px) : null;
      var cands = [];
      function gather() { G.B.forEach(function (b) {
        if (claimed[b.i] || (L && b === L)) return;
        if (b.role !== "numeric" && b.role !== "limit" && b.role !== "limitRange") return;
        if (!valueLike(b.t, f)) return;
        if (L) { var dx = b.x - L.x, dy = b.y - L.y; if (dx < -4 * L.h || dx > 30 * L.h || dy < -1.5 * L.h || dy > 7 * L.h + 0.01) return; }
        else if (det) { if (!inDet(b, det) || claimedByOther(b, field, det)) return; }        else { if (G.order.indexOf(field) < 0 || field === "temp") return; if (G.colX == null || Math.abs(b.cx - G.colX) > 0.12 || b.h < G.maxH * 0.55) return; }
        cands.push(scoreCandidate(G, field, b, label, px, chan));
      }); }
      gather();
      // a detector box with no OCR value inside it proves nothing: fall back to the unlabelled slot path
      if (det && !cands.length) { det = null; gather(); }
      if (L) {
        var gv = gluedValue(L, field);
        if (gv != null) {
          var own = scoreCandidate(G, field, assign({}, L, { role: "numeric" }), label, px, chan);
          own.value = gv; own.why.push("value glued to label token"); own.glued = true; own.parts.spatial = 0.95; own.parts.size = Math.max(own.parts.size, 0.7); own.score = clamp(own.score + 0.25, 0, 1);
          // HR / SpO2 / RR are drawn as the tile's large numeral; a number glued to their label is more
          // often an alarm limit. If a large value of a different reading exists, neither is certain.
          if (PRIMARY[field]) {
            var bigOther = cands.filter(function (c) { return c.parts.size >= 0.55 && c.value !== gv && c.role === "numeric"; });
            if (bigOther.length) { own.glueConflict = "number glued to the " + field.toUpperCase() + " label (" + gv + ") differs from the large value (" + bigOther[0].value + ")"; bigOther.forEach(function (c) { c.glueConflict = own.glueConflict; }); }
          }
          cands.push(own);
        }
      }
      if (det) cands.forEach(function (c) { c.parts.label = det.conf; c.viaDetector = det; c.why.push("inside detector box " + field + " " + det.conf.toFixed(2)); });
      var d = decide(cands, !!L || (!!det && cands.length > 0), assign({}, opts, { __field: field }));
      // independent digit verification gate: a second OCR pass can repeat Vision's misread, the pixels cannot
      if (verifyRequired(field, opts)) {
        d.verifyRequired = true;
        if (d.status === "AUTO_ACCEPTED") {
          var vd = FIELDS[field].int && /^\d+$/.test(String(d.value)) ? verifyDigits(px, cands[0].box, String(d.value)) : { status: "unsure", reason: "independent digit check supports whole numbers only" };
          d.verify = vd;
          if (vd.status !== "verified") d = assign(d, { status: "NEEDS_REVIEW", value: null, suggested: d.value, reason: vd.reason });
        }
      }
      if (d.status === "AUTO_ACCEPTED") { claimed[cands[0].box.i] = true; if (L) claimedLabels[L.i] = true; if (field === "hr") G.hrBox = cands[0].box; d.box = cands[0].box.i; d.glued = !!cands[0].glued; }
      d.label = L ? { text: L.t, box: L.i, strength: label.strength, glued: d.status === "AUTO_ACCEPTED" && !!cands[0].glued } : det && cands.length ? { text: "detector:" + field, box: null, strength: +det.conf.toFixed(2), detector: { x: det.x, y: det.y, w: det.w, h: det.h, conf: det.conf } } : null;
      d.source = L ? "label " + JSON.stringify(L.t) : det && cands.length ? "on-device detector (" + field + " " + det.conf.toFixed(2) + ")" : (d.status === "AUTO_ACCEPTED" ? "layout slot + channel colour (unlabeledAuto)" : null);
      d.channel = chan && chan.reliable ? { kind: chan.kind, h: chan.h == null ? null : +chan.h.toFixed(0) } : null;
      d.candidates = cands.map(function (c) { return { text: c.box.t, value: c.value, score: +c.score.toFixed(2), role: c.role, box: c.box.i, scale: c.box.scale, parts: roundParts(c.parts), why: c.why }; });
      fields[field] = d;
    });
    var warnings = [];
    if (fields.spo2.value != null && fields.spo2.value > 100) { warnings.push("SpO2 > 100 rejected"); fields.spo2 = assign({}, fields.spo2, { status: "NEEDS_REVIEW", value: null }); }
    if (fields.pulse.status === "AUTO_ACCEPTED" && fields.hr.value != null && Math.abs(fields.pulse.value - fields.hr.value) > 30) warnings.push("Pulse and HR differ by >30");
    var flat = {}, review = {}, notFound = [];
    for (var k in fields) if (fields.hasOwnProperty(k)) {
      var fl = fields[k];
      if (fl.status === "AUTO_ACCEPTED") { fl.proof = evidenceFor(k, fl, G); flat[k] = fl.value; }
      else if (fl.status === "NEEDS_REVIEW") review[k] = fl;
      else notFound.push(k);
    }
    return { version: VERSION, fields: fields, values: flat, review: review, notFound: notFound, warnings: warnings.concat(pr.notes || []).concat(quality.issues.map(function (i) { return i.kind + " (" + i.severity + "): " + i.message; })), quality: quality, layout: { profile: G.profile || "generic", order: G.order }, stats: { boxes: G.B.length, parseMs: Date.now() - t0, colorSampled: !!px, recovered: G.B.filter(function (b) { return b.scale === "crop"; }).length }, graph: dbg };
  }
  function roundParts(p) { var o = {}; for (var k in p) if (p.hasOwnProperty(k)) o[k] = typeof p[k] === "number" ? +p[k].toFixed(2) : p[k]; return o; }

  /* ------------------------------------------------------------------ debug: evidence text + SVG overlay */
  function explain(res, obs) {
    var q = res.quality || { status: "?", issues: [] };
    var lines = ["ICU monitor parser v" + res.version + "  layout=" + res.layout.profile + "  boxes=" + res.stats.boxes + (res.stats.recovered != null ? " (crop " + res.stats.recovered + ")" : "") + "  parse=" + res.stats.parseMs + "ms  colour=" + (res.stats.colorSampled ? "sampled" : "none"),
      "Image quality: " + q.status + (q.issues.length ? "  [" + q.issues.map(function (i) { return i.kind + " " + i.severity + " " + i.value; }).join("; ") + "]" : "")];
    Object.keys(res.fields).forEach(function (k) {
      var f = res.fields[k];
      lines.push("", "Field: " + k.toUpperCase(), "Status: " + f.status + "   Confidence: " + f.confidence + (f.threshold != null ? " (threshold " + f.threshold + ")" : "") + (f.reason ? "   Reason: " + f.reason : ""));
      lines.push("Selected: " + (f.value != null ? (typeof f.value === "object" ? JSON.stringify(f.value) : f.value) : "null") + (f.suggested != null && f.value == null ? "   (suggested " + (typeof f.suggested === "object" ? JSON.stringify(f.suggested) : f.suggested) + ", not auto-filled)" : ""));
      if (f.source) lines.push("Source: " + f.source);
      if (f.label) lines.push("Label: " + JSON.stringify(f.label.text) + " box#" + f.label.box + " strength " + f.label.strength + (f.label.glued ? " (glued)" : "")); else if (k !== "sbp" && k !== "dbp" && k !== "map") lines.push("Label: none");
      if (f.channel) lines.push("Channel colour: " + f.channel.kind + (f.channel.h != null ? " hue " + f.channel.h + "°" : ""));
      if (f.proof) lines.push("Evidence: " + JSON.stringify(f.proof));
      (f.candidates || []).forEach(function (c) {
        var b = obs && obs[c.box];
        lines.push("  candidate " + JSON.stringify(c.text) + (c.value != null ? " → " + c.value : "") + "  score " + (c.score != null ? c.score : "-") + (c.role ? "  role " + c.role : "") + (c.source ? "  source " + c.source : "") + (c.scale ? "  scale " + c.scale : "") +
          (b ? "  box x" + b.x.toFixed(3) + " y" + b.y.toFixed(3) + " w" + b.w.toFixed(3) + " h" + b.h.toFixed(4) + (b.conf != null ? " ocr " + b.conf : "") : "") +
          (c.parts ? "  spatial " + c.parts.spatial + " size " + c.parts.size + " align " + c.parts.align + " label " + c.parts.label + " layout " + c.parts.layout + " colour " + c.parts.color + (c.parts.colorNeutral ? "(neutral)" : "") + " plaus " + c.parts.plaus : "") +
          (c.why && c.why.length ? "  [" + c.why.join("; ") + "]" : ""));
        if (c.parts && c.parts.colorWhy) lines.push("      colour: " + c.parts.colorWhy);
      });
    });
    if (res.warnings.length) lines.push("", "Warnings: " + res.warnings.join(" | "));
    return lines.join("\n");
  }
  function overlaySVG(res, obs, w, h) {
    w = w || 1000; h = h || 1000;
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" style="position:absolute;left:0;top:0;pointer-events:none">'];
    var sel = {}, rej = {}, lab = {}, lim = {};
    Object.keys(res.fields).forEach(function (k) {
      var f = res.fields[k];
      if (f.label) lab[f.label.box] = k;
      if (f.status === "AUTO_ACCEPTED" && f.box != null) sel[f.box] = k;
      (f.candidates || []).forEach(function (c) { if (!sel[c.box]) { rej[c.box] = k; if (c.role === "limit" || c.role === "limitRange") lim[c.box] = 1; } });
    });
    obs.forEach(function (b, i) {
      var x = b.x * w, y = b.y * h, bw = b.w * w, bh = b.h * h;
      var stroke = sel[i] ? "#16a34a" : lab[i] ? "#2563eb" : lim[i] ? "#f59e0b" : rej[i] ? "#9ca3af" : b.scale === "crop" ? "rgba(168,85,247,.6)" : "rgba(255,255,255,.35)";
      var sw = sel[i] ? 3 : lab[i] ? 2 : 1, dash = lim[i] ? ' stroke-dasharray="6 4"' : "";
      out.push('<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + "/>");
      var tag = sel[i] ? sel[i].toUpperCase() : lab[i] ? "label " + lab[i] : lim[i] ? "limit" : null;
      if (tag) out.push('<text x="' + x + '" y="' + Math.max(10, y - 3) + '" font-size="' + Math.max(10, h * 0.012) + '" fill="' + stroke + '" font-family="system-ui">' + esc(tag) + "</text>");
    });
    Object.keys(res.fields).forEach(function (k) {
      var f = res.fields[k]; if (!f.label || f.box == null || f.status !== "AUTO_ACCEPTED") return;
      var L = obs[f.label.box], V = obs[f.box]; if (!L || !V || L === V) return;
      out.push('<line x1="' + ((L.x + L.w / 2) * w) + '" y1="' + ((L.y + L.h / 2) * h) + '" x2="' + ((V.x + V.w / 2) * w) + '" y2="' + ((V.y + V.h / 2) * h) + '" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="3 3"/>');
    });
    out.push("</svg>");
    return out.join("");
  }

  return { VERSION: VERSION, THRESH: THRESH, QUALITY: QUALITY, parseMonitor: parseMonitor, monitorRegion: monitorRegion, mapCropObservations: mapCropObservations, mergeObservations: mergeObservations, confirmationRegion: confirmationRegion, applyConfirmation: applyConfirmation, tileRegions: tileRegions, tileObservations: tileObservations, sampleColors: sampleColors, explain: explain, overlaySVG: overlaySVG,
    verifyDigits: verifyDigits, VERIFY: VERIFY, VERIFY_FIELDS: VERIFY_FIELDS,
    _internals: { DIGIT_TEMPLATES: DIGIT_TEMPLATES, readGlyphs: readGlyphs, classifyGlyph: classifyGlyph, buildGraph: buildGraph, assessQuality: assessQuality, blurOf: blurOf, tiltOf: tiltOf, digitsOf: digitsOf, similarity: similarity, gluedValue: gluedValue, FIELDS: FIELDS, LABELS: LABELS, rgbToHsv: rgbToHsv, sampleRegion: sampleRegion, channelColorAtValue: channelColorAtValue, channelColor: channelColor } };
});
