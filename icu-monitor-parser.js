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
    etco2: [/\b(?:EtCO2|etCO₂|ETCO2|EtCO₂)(?=\b|\d)/,    /\bCO\s*2\b/i],
    cvp:   [/\bCVP(?=\b|\d)/,                            /\bC\s*V\s*P\b/i],
    pvc:   [/\bPVCs?(?=\b|\d)/,                          /\bP\s*V\s*C\b/i]
  };
  var PRESSURE_SRC = { art: /\b(?:ART|ABP|Art|ARTI|IBP|P1)\b/, nibp: /\b(?:NIBP|NBP|NI\s*BP)\b/i };
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
    if (/\b(?:ART|ABP|IBP|P1)\b/.test(pre)) return { src: "art", strength: 1 };
    if (/\b(?:NIBP|NBP)\b/i.test(pre)) return { src: "nibp", strength: 1 };
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
      for (var f in LABELS) if (LABELS.hasOwnProperty(f) && n.role !== "banner") {
        if (LABELS[f][0].test(t)) n.labels.push({ field: f, strength: 1 });
        else if (LABELS[f][1].test(t)) n.labels.push({ field: f, strength: 0.7 });
      }
      if (n.role !== "pressure") for (var s in PRESSURE_SRC) if (PRESSURE_SRC.hasOwnProperty(s) && PRESSURE_SRC[s].test(t)) n.labels.push({ field: "press:" + s, strength: /ARTI|Art\W/.test(t) ? 0.7 : 1 });
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
    var allText = B.map(function (b) { return b.t; }).join(" \n "), profile = null;
    if (opts && opts.profile && PROFILES[opts.profile]) profile = opts.profile;
    else for (var p in PROFILES) if (PROFILES.hasOwnProperty(p) && PROFILES[p].sig.test(allText)) { profile = p; break; }
    return { B: B, src: src, maxH: maxH, colX: colX, big: big.slice().sort(function (a, b) { return a.y - b.y; }), profile: profile, order: (profile ? PROFILES[profile].order : GENERIC_ORDER) };
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
    var cc = colorCompat(cand.color, L && L.color), ch = colorCompat(cand.color, chan);
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
          if (l.field !== "press:art" && l.field !== "press:nibp") return;
          var dx = p.x - b.x, dy = p.y - b.y;
          if (dx < -0.05 || dx > 0.30 || dy < -b.h * 1.5 || dy > b.h * 10 + 0.03) return;
          if (/\b(?:Start|Stop|Go|Setup|Zero|Menu)\b/i.test(b.t)) return;   // softkeys name a pressure without labelling a reading
          var d = Math.abs(dx) + Math.abs(dy);
          if (!best || d < best.d) best = { box: b, src: l.field.slice(6), d: d, strength: l.strength };
        });
      });
      p.src = best ? best.src : null; p.srcLabel = best && !best.glued ? best.box : null; p.srcStrength = best ? best.strength : 0; p.srcGlued = !!(best && best.glued);
      p.mapBox = null; p.mapVal = p.paren;
      if (p.mapVal == null) G.B.forEach(function (b) {
        if (b.role !== "paren") return;
        var below = b.y >= p.y && b.y <= p.y + p.h * 2.6, inCol = b.cx >= p.x - 0.02 && b.cx <= p.x + p.w + 0.02;
        if (below && inCol && (!p.mapBox || b.h > p.mapBox.h)) { p.mapBox = b; p.mapVal = b.paren; }
      });
      if (p.mapVal != null && !(p.mapVal > p.press.d && p.mapVal < p.press.s)) { notes.push("MAP " + p.mapVal + " outside DBP..SBP for " + p.t + ", dropped"); p.mapVal = null; p.mapBox = null; }
      p.valid = p.press.s > p.press.d && p.press.s >= 50 && p.press.s <= 260 && p.press.d >= 20 && p.press.d <= 160;
    });
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
    out.sbp = assign({}, primary, { value: ambiguous ? null : top.press.s, suggested: top.press.s });
    out.dbp = assign({}, primary, { value: ambiguous ? null : top.press.d, suggested: top.press.d });
    if (top.mapVal != null) {
      var mconf = ambiguous ? 0.5 : Math.min(conf, 0.94), mok = !ambiguous && mconf >= TM.conf;
      out.map = { status: mok ? "AUTO_ACCEPTED" : "NEEDS_REVIEW", confidence: +mconf.toFixed(2), value: mok ? top.mapVal : null, suggested: top.mapVal, box: top.mapBox ? top.mapBox.i : top.i, source: top.src ? top.src.toUpperCase() : null, label: primary.label,
        mapText: top.mapBox ? top.mapBox.t : top.t, reason: mok ? undefined : (ambiguous ? reasons.join("; ") : "confidence " + mconf.toFixed(2) + " below " + TM.conf) };
    } else out.map = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no (MM) read next to " + top.t + "; MAP is only ever a displayed value" };
    out.notes = notes;
    return out;
  }

  /* ------------------------------------------------------------------ evidence (every AUTO field) */
  function evidenceFor(k, f, G) {
    if (f.status !== "AUTO_ACCEPTED") return null;
    var boxIdx = f.box != null ? f.box : null;
    if (boxIdx == null && f.candidates) for (var i = 0; i < f.candidates.length; i++) if (f.candidates[i].value === f.value) { boxIdx = f.candidates[i].box; break; }
    var o = boxIdx != null ? G.src[boxIdx] : null;
    var kind = f.label ? (f.label.glued || f.glued ? "glued-label" : "label") : "layout+colour";
    var src = f.source || (f.label ? "label " + JSON.stringify(f.label.text) : "layout slot + channel colour (unlabeledAuto)");
    var ev = {
      ocr: o ? { text: o.text, conf: o.conf == null ? null : +(+o.conf).toFixed(2), scale: o.scale || "full" } : null,
      box: o ? { x: +o.x.toFixed(4), y: +o.y.toFixed(4), w: +o.w.toFixed(4), h: +o.h.toFixed(4) } : null,
      association: { kind: kind, label: f.label ? { text: f.label.text, box: f.label.box } : null, signals: f.evidence != null ? f.evidence : null },
      confidence: f.confidence, source: src
    };
    if (k === "map") ev.association.kind = "(MM) displayed with the " + (f.source || "?") + " reading";
    ev.complete = !!(ev.ocr && ev.ocr.text && ev.box && ev.association.kind && typeof ev.confidence === "number" && ev.source);
    return ev;
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
    var ORDER = ["hr", "spo2", "rr", "pulse", "temp", "etco2", "cvp", "pvc"];
    ORDER.forEach(function (field) {
      var f = FIELDS[field], label = findLabel(G, field, claimedLabels), L = label && label.box;
      var chan = L && px ? channelColor(L, px) : null;
      var cands = [];
      G.B.forEach(function (b) {
        if (claimed[b.i] || (L && b === L)) return;
        if (b.role !== "numeric" && b.role !== "limit" && b.role !== "limitRange") return;
        if (!valueLike(b.t, f)) return;
        if (L) { var dx = b.x - L.x, dy = b.y - L.y; if (dx < -4 * L.h || dx > 30 * L.h || dy < -1.5 * L.h || dy > 7 * L.h + 0.01) return; }
        else { if (G.order.indexOf(field) < 0 || field === "temp") return; if (G.colX == null || Math.abs(b.cx - G.colX) > 0.12 || b.h < G.maxH * 0.55) return; }
        cands.push(scoreCandidate(G, field, b, label, px, chan));
      });
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
      var d = decide(cands, !!L, assign({}, opts, { __field: field }));
      if (d.status === "AUTO_ACCEPTED") { claimed[cands[0].box.i] = true; if (L) claimedLabels[L.i] = true; if (field === "hr") G.hrBox = cands[0].box; d.box = cands[0].box.i; d.glued = !!cands[0].glued; }
      d.label = L ? { text: L.t, box: L.i, strength: label.strength, glued: d.status === "AUTO_ACCEPTED" && !!cands[0].glued } : null;
      d.source = L ? "label " + JSON.stringify(L.t) : (d.status === "AUTO_ACCEPTED" ? "layout slot + channel colour (unlabeledAuto)" : null);
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

  return { VERSION: VERSION, THRESH: THRESH, QUALITY: QUALITY, parseMonitor: parseMonitor, monitorRegion: monitorRegion, mapCropObservations: mapCropObservations, mergeObservations: mergeObservations, confirmationRegion: confirmationRegion, applyConfirmation: applyConfirmation, sampleColors: sampleColors, explain: explain, overlaySVG: overlaySVG,
    _internals: { buildGraph: buildGraph, assessQuality: assessQuality, blurOf: blurOf, tiltOf: tiltOf, digitsOf: digitsOf, similarity: similarity, gluedValue: gluedValue, FIELDS: FIELDS, LABELS: LABELS, rgbToHsv: rgbToHsv, sampleRegion: sampleRegion, channelColorAtValue: channelColorAtValue, channelColor: channelColor } };
});
