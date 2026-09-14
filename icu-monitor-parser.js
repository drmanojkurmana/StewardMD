/* icu-monitor-parser.js — ICU bedside-monitor value extraction over a 2-D OCR observation graph.
 *
 * Input: Apple Vision (or any OCR) observations {text, conf, x, y, w, h} in NORMALIZED top-left
 * coordinates, plus (optionally) a pixel source for colour. Output: per-field {value, status,
 * confidence, evidence, candidates}. Statuses:
 *   AUTO_ACCEPTED  enough independent evidence to auto-fill (never size alone, never colour alone)
 *   NEEDS_REVIEW   candidates exist but evidence is thin or two candidates are too close
 *   NOT_FOUND      nothing readable for this field (value null; the clinician fills it)
 * Hard rules: MAP is never computed from SBP/DBP, Pulse is never copied from HR, a missing value is
 * never 0, OCR text order is never the association mechanism. Colour and layout are supporting
 * signals with a NEUTRAL contribution when unreliable or unknown.
 *
 * Loaded by the WebView (window.SMD_ICU_MONITOR), by Node tests and by bench/icu-monitor. ES5. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SMD_ICU_MONITOR = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "2.0.0";

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
  // [strong regex, fuzzy regex]. Strong = the canonical label; fuzzy = what OCR makes of it.
  var LABELS = {
    hr:    [/\b(?:HR|Heart\s*Rate)\b/,            /\b(?:H\s*R|HR\W)\b/i],
    spo2:  [/Sp\s*O\s*[2₂]/i,                     /Sp\s*[O0oQ]\s*[2zZ₂]|\bSaO2\b|\bSp02\b/i],
    rr:    [/\b(?:RR|Resp|RESP|awRR|Resp\w*)\b/,  /\b(?:R\s*R|RESP\w*)\b/i],
    pulse: [/\b(?:Pulse|PULSE|PR)\b/,             /\bPuls\w*\b/i],
    temp:  [/\b(?:Temp|TEMP|Tcore|T1|T2)\b/,      /\bT\s*emp\w*\b/i],
    etco2: [/\b(?:EtCO2|etCO₂|ETCO2|EtCO₂)\b/,    /\bCO\s*2\b/i],
    cvp:   [/\bCVP\b/,                            /\bC\s*V\s*P\b/i],
    pvc:   [/\bPVCs?\b/,                          /\bP\s*V\s*C\b/i]
  };
  var PRESSURE_SRC = { art: /\b(?:ART|ABP|Art|ARTI|IBP|P1)\b/, nibp: /\b(?:NIBP|NBP|NI\s*BP)\b/i, map: /\b(?:MAP|ABPm|Mean)\b/i };
  // The default top-to-bottom order of the numeric column on nearly every bedside monitor. A profile
  // may override it. Used as ONE signal (layoutScore), never as the association mechanism.
  var GENERIC_ORDER = ["hr", "spo2", "pressure", "rr", "temp"];
  var PROFILES = {
    "philips-intellivue": { sig: /IntelliVue|Philips|Main\s*Screen|Main\s*Setup|Screen\s+[A-E]\b/i, order: GENERIC_ORDER, limits: "left" },
    "ge-carescape":       { sig: /CARESCAPE|NBP\s*Go|Admit\s*\/?\s*Discharge|Monitor\s*Setup/i,     order: GENERIC_ORDER, limits: "range" },
    "draeger-infinity":   { sig: /Infinity|Dr[aä]e?ger/i,                                           order: GENERIC_ORDER, limits: "triangles" },
    "mindray-beneview":   { sig: /BeneView|Mindray|\bPI\b/i,                                         order: GENERIC_ORDER, limits: "right" },
    "nihon-kohden":       { sig: /Nihon|Kohden/i,                                                    order: ["hr", "spo2", "pressure", "rr", "temp"], limits: "right" }
  };
  var W = { spatial: 0.22, size: 0.22, align: 0.08, label: 0.16, layout: 0.12, color: 0.10, plaus: 0.10 };
  var AUTO_CONF = 0.80, AUTO_MARGIN = 0.12;

  /* ------------------------------------------------------------------ helpers */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function nums(t) {
    return (String(t).replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ").replace(/\d+(?:\.\d+)?\s*mm\/s/gi, " ").match(/-?\d{1,3}(?:\.\d)?/g) || []).map(parseFloat);
  }
  function isClock(t) { return /\b\d{1,2}\s*:\s*\d{2}\b/.test(t); }
  function isDate(t) { return /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/.test(t); }
  // "** RR HIGH" is a banner; "*105" is a value with the alarm-bell glyph glued on (letters decide).
  function isBanner(t) { return /^\W*\*{1,3}\s*[A-Za-z]/.test(t) || /\b(?:HIGH|LOW|ALARM|APNEA|ASYSTOLE|LEADS?\s*OFF)\b/i.test(t); }
  // "SSS/DD" plus two OCR repairs that only ever produce a SUGGESTION (the primary stays NEEDS_REVIEW):
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

  /* ------------------------------------------------------------------ colour sampling
   * ONE implementation for the app (canvas ImageData) and the benchmark (decoded RGBA). `px` is
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
      // dominant hue CLUSTER, not the mean: a band can hold two traces or a label; the peak of a
      // 15° histogram (with its neighbours) is the channel's colour, its share is the reliability.
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
  // The waveform channel to the LEFT of a label: dominant saturated hue in the band at the label's height.
  function channelColor(label, px) {
    if (!px || !px.get) return { reliable: false };
    var yc = (label.y + label.h / 2) * px.h, band = Math.max(label.h * 3, 0.03) * px.h;
    var x1 = (label.x - 0.03) * px.w; if (x1 < px.w * 0.15) return { reliable: false };
    return sampleRegion(px, px.w * 0.03, yc - band, x1, yc + band, 900);
  }
  // No label: the trace beside the VALUE. Values sit level with their waveform on bedside layouts;
  // a band of mixed traces comes back with a low hue concentration and is treated as unreliable.
  function channelColorAtValue(box, px) {
    if (!px || !px.get) return { reliable: false };
    var y0 = (box.y - box.h * 0.5) * px.h, y1 = (box.y + box.h) * px.h;
    var x1 = (box.x - 0.03) * px.w; if (x1 < px.w * 0.15) return { reliable: false };
    // the trace nearest the numerics is the value's own channel; the far left of a band often
    // holds the neighbouring trace's sweep or a channel legend. Prefer the near part, fall back
    // to the whole band, and report the better-concentrated of the two.
    var near = sampleRegion(px, x1 * 0.55, y0, x1, y1, 700), full = sampleRegion(px, px.w * 0.03, y0, x1, y1, 900);
    if (near.reliable && near.share >= (full.share || 0)) return near;
    return full.reliable ? full : near;
  }
  function colorCompat(a, b) {
    if (!a || !b || !a.reliable || !b.reliable) return { score: 0.5, neutral: true, why: "unreliable or unknown colour" };
    if (a.kind === "white" && b.kind === "white") return { score: 1, neutral: false, why: "both white" };
    // most manufacturers draw labels white and values coloured: white vs coloured says nothing
    if (a.kind !== b.kind) return { score: 0.5, neutral: true, why: a.kind + " vs " + b.kind + " (neutral)" };
    var d = hueDist(a.h, b.h);
    return { score: 1 - clamp((d - 12) / 55, 0, 1), neutral: false, why: "hue distance " + d.toFixed(0) + "°" };
  }

  /* ------------------------------------------------------------------ graph */
  function buildGraph(obs, opts) {
    var B = [], i, o;
    for (i = 0; i < obs.length; i++) {
      o = obs[i]; if (!o || typeof o.text !== "string") continue;
      var x = +o.x || 0, y = +o.y || 0, w = +o.w || 0, h = +o.h || 0, t = o.text.trim();
      var n = { i: i, t: t, conf: (o.conf == null ? null : +o.conf), x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, color: o.color || null, role: "text", nums: nums(t), labels: [] };
      if (isClock(t)) n.role = "clock";
      else if (isDate(t)) n.role = "date";
      else if (isBanner(t)) n.role = "banner";
      else if (pressureMatch(t)) { n.role = "pressure"; n.press = pressureMatch(t); n.paren = parenMatch(t); }
      else if (/^\W*\(\s*\d{2,3}\s*\)\W*$/.test(t)) { n.role = "paren"; n.paren = parenMatch(t); }
      else if (/^\W*\d{1,3}\s*-\s*\d{1,3}\W*$/.test(t)) n.role = "limitRange";
      else if (/[▲▼↑↓]/.test(t) && n.nums.length) n.role = "limit";
      else if (n.nums.length && !/[A-Za-z]{3,}/.test(t)) n.role = "numeric";
      // label membership (a box may be label AND carry a glued number, e.g. "PVC 0")
      for (var f in LABELS) if (LABELS.hasOwnProperty(f) && n.role !== "banner") {
        if (LABELS[f][0].test(t)) n.labels.push({ field: f, strength: 1 });
        else if (LABELS[f][1].test(t)) n.labels.push({ field: f, strength: 0.7 });
      }
      for (var s in PRESSURE_SRC) if (PRESSURE_SRC.hasOwnProperty(s) && PRESSURE_SRC[s].test(t)) n.labels.push({ field: "press:" + s, strength: /ARTI|Art\W/.test(t) ? 0.7 : 1 });
      B.push(n);
    }
    var maxH = 0, valueBoxes = [];
    for (i = 0; i < B.length; i++) if (B[i].role === "numeric" || B[i].role === "pressure") { valueBoxes.push(B[i]); if (B[i].h > maxH) maxH = B[i].h; }
    // main numeric column = median centre-x of the BIG value boxes
    var big = valueBoxes.filter(function (b) { return b.h >= maxH * 0.55; }).sort(function (a, b) { return a.cx - b.cx; });
    var colX = big.length ? big[Math.floor(big.length / 2)].cx : null;
    // Alarm limits: small numerics that come (a) as a hi/lo pair in one box ("120 50"), (b) stacked in
    // a vertical pair (Philips), or (c) on a label's own row just right of it (Mindray, Nihon Kohden).
    for (i = 0; i < B.length; i++) {
      var b = B[i]; if (b.role !== "numeric" || b.h >= maxH * 0.5) continue;
      if (b.nums.length === 2 && b.nums[0] >= b.nums[1]) { b.role = "limit"; b.limitPair = "pair-in-box"; continue; }
      for (var j = 0; j < B.length; j++) {
        var s2 = B[j]; if (j === i) continue;
        if ((s2.role === "numeric" || s2.role === "limit") && s2.h < maxH * 0.5 && Math.abs(s2.x - b.x) < b.h * 2 && Math.abs(s2.y - b.y) <= b.h * 2.8 && Math.abs(s2.y - b.y) > b.h * 0.5) { b.role = "limit"; b.limitPair = j; break; }
        if (s2.labels.length && !s2.nums.length && b.cy >= s2.y - s2.h * 0.3 && b.cy <= s2.y + s2.h * 1.3 && b.x > s2.x && b.x - (s2.x + s2.w) < s2.h * 10) { b.role = "limit"; b.limitPair = j; break; }
      }
    }
    // layout profile from the vocabulary on screen
    var allText = B.map(function (b) { return b.t; }).join(" \n "), profile = null;
    if (opts && opts.profile && PROFILES[opts.profile]) profile = opts.profile;
    else for (var p in PROFILES) if (PROFILES.hasOwnProperty(p) && PROFILES[p].sig.test(allText)) { profile = p; break; }
    return { B: B, maxH: maxH, colX: colX, big: big.slice().sort(function (a, b) { return a.y - b.y; }), profile: profile, order: (profile ? PROFILES[profile].order : GENERIC_ORDER) };
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
  function expectedRank(G, field) {
    var order = G.order, idx = order.indexOf(field === "sbp" ? "pressure" : field);
    return idx;
  }
  function rankInColumn(G, box) {
    var col = G.big.filter(function (b) { return G.colX == null || Math.abs(b.cx - G.colX) < 0.14; });
    for (var i = 0; i < col.length; i++) if (col[i] === box) return i;
    return -1;
  }
  function scoreCandidate(G, field, cand, label, px, chan) {
    var f = FIELDS[field], L = label && label.box, unit = L ? L.h : Math.max(G.maxH * 0.3, 0.01);
    var sc = {}, why = [];
    // spatial: below/right of the label, in label-height units
    if (L) {
      var dx = cand.x - L.x, dy = cand.y - L.y;
      // Same row as the label (Dräger, Mindray, Nihon Kohden put the value at the far right of the
      // tile): the row IS the relation, so horizontal distance is tolerated much further.
      var sameRow = Math.abs(dy) <= 1.2 * unit || (cand.y <= L.y + L.h && cand.y + cand.h >= L.y);
      // inside the label's tile band (label at the top-left of a tile, value big at the right, Mindray /
      // GE / Nihon Kohden): horizontal distance is the tile width, not a weak relation
      var inTile = dx > -0.5 * unit && dy >= -1.2 * unit && dy <= 5 * unit;
      var sdx = Math.exp(-Math.pow(Math.abs(dx) / ((sameRow || inTile ? 40 : 12) * unit), 2)), sdy = dy < -1.2 * unit && !sameRow ? 0.15 : Math.exp(-Math.pow(Math.max(0, dy) / (4 * unit), 2));
      sc.spatial = sdx * sdy; why.push("dx=" + (dx / unit).toFixed(1) + "u dy=" + (dy / unit).toFixed(1) + "u" + (sameRow ? " same row" : inTile ? " in tile" : ""));
    } else { sc.spatial = 0.5; why.push("no label: spatial neutral"); }
    // size: relative to the tallest value on screen (limits are small)
    sc.size = G.maxH ? Math.pow(clamp(cand.h / G.maxH, 0, 1), 0.7) : 0.5;
    // alignment: left edge with label, or centre with the numeric column
    var al = L ? 1 - clamp(Math.abs(cand.x - L.x) / 0.15, 0, 1) : 0.5;
    if (G.colX != null) al = Math.max(al, 1 - clamp(Math.abs(cand.cx - G.colX) / 0.10, 0, 1));
    sc.align = al;
    sc.label = L ? label.strength : 0;
    // layout: RELATIONS in the numeric column, not an exact slot (Dräger puts TEMP before RESP, GE
    // puts NBP before ART): HR is the topmost big value and above the pressure, SpO2 sits between HR
    // and the pressure, RR sits below the pressure. Unknown neighbours → neutral.
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
    // colour: value vs label, value vs waveform channel (at the label, or at the value when unlabeled); neutral when unknown
    if (!chan && px) { chan = channelColorAtValue(cand, px); why.push("channel sampled at value height"); }
    var cc = colorCompat(cand.color, L && L.color), ch = colorCompat(cand.color, chan);
    // A coloured label that matches the value is the direct signal; the trace band beside it may
    // belong to a neighbouring channel on layouts whose waveforms do not line up with the tiles
    // (GE), so it only counts when there is no informative label colour.
    var parts = []; if (!cc.neutral) parts.push(cc.score); else if (!ch.neutral) parts.push(ch.score);
    sc.color = parts.length ? parts[0] : 0.5;
    sc.colorNeutral = !parts.length; sc.colorWhy = "label: " + cc.why + "; channel: " + ch.why + (!cc.neutral && !ch.neutral ? " (label colour used)" : "");
    // plausibility: in range, integer-ness, not a known limit
    var v = lastInRange(cand.t, f), pl = v == null ? 0 : 1;
    if (pl && f.int && v !== Math.round(v)) pl = 0.5;
    if (pl && (v === f.lo || v === f.hi)) pl = Math.max(pl - 0.2, 0.3);
    sc.plaus = pl;
    // Weighted mean over the INFORMATIVE signals only: no label → label and label-relative spatial
    // are unknown, not zero; neutral colour → colour neither helps nor hurts. The evidence gate in
    // decide() (two independent signals among label / layout / colour / glued) is what stops a
    // single loud signal from carrying a value on its own.
    var num = W.size * sc.size + W.align * sc.align + W.layout * sc.layout + W.plaus * sc.plaus, den = W.size + W.align + W.layout + W.plaus;
    if (L) { num += W.spatial * sc.spatial + W.label * sc.label; den += W.spatial + W.label; }
    if (!sc.colorNeutral) { num += W.color * sc.color; den += W.color; }
    var total = num / den;
    var role = cand.role;
    if (role === "limit" || role === "limitRange") { total *= 0.45; why.push("alarm-limit geometry"); }
    if (cand.conf != null && cand.conf < 0.3) { total *= 0.85; why.push("low OCR confidence"); }
    return { box: cand, value: v, score: clamp(total, 0, 1), parts: sc, role: role, why: why };
  }
  function decide(cands, hasLabel, opts) {
    if (!cands.length) return { status: "NOT_FOUND", confidence: 0, value: null, reason: "no readable candidate" };
    cands.sort(function (a, b) { return b.score - a.score; });
    var top = cands[0], second = null;
    for (var i = 1; i < cands.length; i++) if (cands[i].value !== top.value) { second = cands[i]; break; }
    var margin = second ? top.score - second.score : 0.3;
    var conf = top.score * (0.7 + 0.3 * clamp(margin / 0.25, 0, 1));
    // a rival of the same text size on the same row is a genuine second reading, not a limit or a
    // stray: it needs a wider margin than geometry alone usually gives
    var sizeTie = second && Math.abs(second.box.h - top.box.h) <= 0.15 * top.box.h && Math.abs(second.box.y - top.box.y) < top.box.h && second.role === "numeric";
    var needMargin = sizeTie ? 0.20 : AUTO_MARGIN;
    // independent evidence: label, layout slot, colour agreement. Size/spatial alone never suffice.
    // independent evidence: label, layout slot, colour agreement, or the OCR itself gluing label and value
    var ev = 0; if (top.parts.label >= 0.7) ev++; if (top.parts.layout >= 0.9) ev++; if (!top.parts.colorNeutral && top.parts.color >= 0.8) ev++; if (top.glued) ev++;
    var sizeOk = top.parts.size >= 0.55 && top.parts.spatial >= 0.4;
    // Policy: a value whose label could not be read is NEEDS_REVIEW by default (owner rule: unreadable
    // label = ambiguous), even when slot and colour agree. opts.unlabeledAuto lets slot + channel colour
    // carry it; the benchmark reports both policies.
    var labelOk = hasLabel || top.glued || (opts && opts.unlabeledAuto);
    if (conf >= AUTO_CONF && margin >= needMargin && ev >= 2 && sizeOk && labelOk && top.role !== "limit" && top.role !== "limitRange")
      return { status: "AUTO_ACCEPTED", confidence: +conf.toFixed(2), value: top.value, margin: +margin.toFixed(2), evidence: ev };
    var reason = second && margin < needMargin ? "two candidates too close (" + top.value + " vs " + second.value + (sizeTie ? ", same size and row" : "") + ")" : !labelOk ? "label not read (slot" + (ev >= 2 ? " and colour agree" : " only") + ")" : ev < 2 ? "only " + ev + " independent signal(s)" : !sizeOk ? "size/position inconsistent" : "confidence " + conf.toFixed(2) + " below " + AUTO_CONF;
    return { status: "NEEDS_REVIEW", confidence: +conf.toFixed(2), value: null, suggested: top.value, margin: +margin.toFixed(2), evidence: ev, reason: reason };
  }

  /* ------------------------------------------------------------------ pressures */
  function parsePressures(G, px, claimed, claimedLabels) {
    var P = G.B.filter(function (b) { return b.role === "pressure"; });
    var out = { sbp: null, dbp: null, map: null, art: null, nibp: null }, notes = [];
    if (!P.length) {
      var nf = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no SSS/DD box" };
      out.sbp = nf; out.dbp = nf; out.map = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no pressure" };
      return out;
    }
    // attach a source label (ART / NIBP) to each pressure box: nearest label box above-left within 6 label heights
    P.forEach(function (p) {
      var best = null;
      G.B.forEach(function (b) {
        b.labels.forEach(function (l) {
          if (l.field !== "press:art" && l.field !== "press:nibp") return;
          var dx = p.x - b.x, dy = p.y - b.y;
          if (dx < -0.05 || dx > 0.30 || dy < -b.h * 1.5 || dy > b.h * 10 + 0.03) return;   // tall tiles put the label well above the reading
          var d = Math.abs(dx) + Math.abs(dy);
          if (!best || d < best.d) best = { box: b, src: l.field.slice(6), d: d, strength: l.strength };
        });
      });
      p.src = best ? best.src : null; p.srcLabel = best ? best.box : null; p.srcStrength = best ? best.strength : 0;
      // MAP: same box "(98)" or a paren box just below within the pressure's column
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
    // A pressure the OCR could not read cleanly ("ART T19/66": a 1 read as T) or a pressure label
    // with no readable reading beside it means ANOTHER pressure is on screen: the primary is then a
    // choice, not a fact.
    var unreadable = P.filter(function (p) { return !p.valid; });
    G.B.forEach(function (b) {
      b.labels.forEach(function (l) {
        if (l.field !== "press:art" && l.field !== "press:nibp") return;
        var served = V.some(function (p) { return p.srcLabel === b; });
        if (!served && !unreadable.some(function (p) { return p.srcLabel === b; })) unreadable.push({ t: b.t, srcLabel: b, labelOnly: true });
      });
    });
    function mk(p, conf, extra) { return { status: conf >= AUTO_CONF ? "AUTO_ACCEPTED" : "NEEDS_REVIEW", confidence: +conf.toFixed(2), value: conf >= AUTO_CONF ? p.press : null, suggested: p.press, source: p.src, box: p.i, reason: extra || undefined }; }
    // named sub-fields
    V.forEach(function (p) {
      var c = 0.6 + 0.25 * p.srcStrength + 0.15 * clamp(p.h / G.maxH, 0, 1);
      if (p.src === "art" && !out.art) out.art = mk(p, c);
      if (p.src === "nibp" && !out.nibp) out.nibp = mk(p, c);
    });
    // primary pressure: the tallest; ambiguous when the runner-up is nearly as tall with a different reading
    var top = V[0], second = V.length > 1 ? V[1] : null;
    var sameReading = second && second.press.s === top.press.s && second.press.d === top.press.d;
    // Two different readings on screen (ART beside NIBP, or two unlabelled pressures of comparable
    // size) make the PRIMARY a clinician's choice. Only a clearly smaller, unlabelled second reading
    // (a trend / previous NIBP) is ignored.
    var ambiguous = second && !sameReading && (second.h >= top.h * 0.6 || (second.src && second.src !== top.src));
    // Only a TILE label counts: short text (not a softkey "NIBP Start" or a header mode "ART"), in
    // the same label column as the chosen pressure's own label (or its box when it has none).
    var refX = top.srcLabel ? top.srcLabel.x : top.x;
    var repaired = top.press.repaired || null;
    if (repaired) ambiguous = true;
    var otherUnread = unreadable.filter(function (u) {
      if (u.srcLabel === top.srcLabel && u.srcLabel) return false;
      var box = u.labelOnly ? u.srcLabel : u;
      if (u.labelOnly && !/^\W*(?:ART|ABP|NIBP|NBP|IBP|P1)\W{0,3}$/i.test(u.t)) return false;
      if (u.labelOnly && box.y > top.y + top.h) return false;   // a tile label is never below its reading (softkey rows are)
      return Math.abs(box.x - refX) < 0.12;
    });
    if (otherUnread.length) ambiguous = true;
    var conf = 0.72 + 0.14 * clamp(top.h / G.maxH, 0, 1) + (top.src ? 0.08 * top.srcStrength : 0) + (second ? 0 : 0.06);
    if (ambiguous) conf = Math.min(conf, 0.6);
    claimed[top.i] = true; if (top.srcLabel) claimedLabels[top.srcLabel.i] = true;
    G.bpBox = top;
    var primary = {
      status: ambiguous ? "NEEDS_REVIEW" : "AUTO_ACCEPTED", confidence: +conf.toFixed(2), source: top.src, box: top.i,
      reason: !ambiguous ? undefined : repaired ? "OCR repaired (" + repaired + "): " + JSON.stringify(top.t) + " read as " + top.press.s + "/" + top.press.d + "; confirm" : otherUnread.length ? "another pressure on screen could not be read: " + otherUnread.map(function (u) { return JSON.stringify(u.t); }).join(", ") : "two pressures of similar size: " + top.t + (top.src ? " (" + top.src + ")" : "") + " vs " + (second ? second.t + (second.src ? " (" + second.src + ")" : "") : "?"),
      candidates: V.map(function (p) { return { text: p.t, source: p.src, h: p.h, box: p.i }; })
    };
    out.sbp = Object.assign({}, primary, { value: ambiguous ? null : top.press.s, suggested: top.press.s });
    out.dbp = Object.assign({}, primary, { value: ambiguous ? null : top.press.d, suggested: top.press.d });
    if (top.mapVal != null) {
      var mconf = ambiguous ? 0.5 : Math.min(conf, 0.94);
      out.map = { status: ambiguous ? "NEEDS_REVIEW" : "AUTO_ACCEPTED", confidence: +mconf.toFixed(2), value: ambiguous ? null : top.mapVal, suggested: top.mapVal, box: top.mapBox ? top.mapBox.i : top.i, source: top.src, evidence: top.mapBox ? "(MM) box below the pressure" : "(MM) in the pressure box" };
      if (top.mapBox) claimed[top.mapBox.i] = true;
    } else out.map = { status: "NOT_FOUND", confidence: 0, value: null, reason: "no (MM) read next to " + top.t + "; MAP is never computed from SBP/DBP" };
    out.notes = notes;
    return out;
  }

  /* ------------------------------------------------------------------ main */
  function parseMonitor(obs, opts) {
    opts = opts || {};
    var t0 = Date.now(), px = opts.px || null;
    if (px) sampleColors(obs, px);
    var G = buildGraph(obs, opts), claimed = {}, claimedLabels = {}, fields = {}, dbg = { profile: G.profile, maxH: G.maxH, colX: G.colX, column: G.big.map(function (b) { return { text: b.t, y: +b.y.toFixed(3), h: +b.h.toFixed(4) }; }) };
    var pr = parsePressures(G, px, claimed, claimedLabels);
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
        else { if (G.order.indexOf(field) < 0 || field === "temp") return; if (G.colX == null || Math.abs(b.cx - G.colX) > 0.12 || b.h < G.maxH * 0.55) return; }   // unlabeled: only the big column values, only for column-order fields (HR/SpO2/RR); never Pulse/PVC/Temp/EtCO2/CVP
        cands.push(scoreCandidate(G, field, b, label, px, chan));
      });
      // label with its own glued number ("PVC 0", "T 36.5") is a candidate of its own when it holds exactly one number
      if (L && L.nums.length === 1 && valueLike(L.t.replace(LABELS[field][0], " ").replace(LABELS[field][1], " "), f)) {
        var own = scoreCandidate(G, field, Object.assign({}, L, { role: "numeric" }), label, px, chan); own.why.push("value glued to label"); own.glued = true; own.parts.spatial = 0.9; own.score = clamp(own.score + 0.1, 0, 1); cands.push(own);
      }
      var d = decide(cands, !!L, opts);
      if (d.status === "AUTO_ACCEPTED") { claimed[cands[0].box.i] = true; if (L) claimedLabels[L.i] = true; if (field === "hr") G.hrBox = cands[0].box; }
      d.label = L ? { text: L.t, box: L.i, strength: label.strength } : null;
      d.channel = chan && chan.reliable ? { kind: chan.kind, h: chan.h == null ? null : +chan.h.toFixed(0) } : null;
      d.candidates = cands.map(function (c) { return { text: c.box.t, value: c.value, score: +c.score.toFixed(2), role: c.role, box: c.box.i, parts: roundParts(c.parts), why: c.why }; });
      fields[field] = d;
    });
    // clinical sanity: cross-field checks are VALIDATION only, never a source of values
    var warnings = [];
    if (fields.spo2.value != null && fields.spo2.value > 100) { warnings.push("SpO2 > 100 rejected"); fields.spo2 = Object.assign({}, fields.spo2, { status: "NEEDS_REVIEW", value: null }); }
    if (fields.pulse.status === "AUTO_ACCEPTED" && fields.hr.value != null && Math.abs(fields.pulse.value - fields.hr.value) > 30) warnings.push("Pulse and HR differ by >30");
    var flat = {}, review = {}, notFound = [];
    for (var k in fields) if (fields.hasOwnProperty(k)) {
      var fl = fields[k];
      if (fl.status === "AUTO_ACCEPTED") { if (k === "art" || k === "nibp") flat[k] = fl.value; else flat[k] = fl.value; }
      else if (fl.status === "NEEDS_REVIEW") review[k] = fl;
      else notFound.push(k);
    }
    return { version: VERSION, fields: fields, values: flat, review: review, notFound: notFound, warnings: warnings.concat(pr.notes || []), layout: { profile: G.profile || "generic", order: G.order }, stats: { boxes: G.B.length, parseMs: Date.now() - t0, colorSampled: !!px }, graph: dbg };
  }
  function roundParts(p) { var o = {}; for (var k in p) if (p.hasOwnProperty(k)) o[k] = typeof p[k] === "number" ? +p[k].toFixed(2) : p[k]; return o; }

  /* ------------------------------------------------------------------ debug: evidence text + SVG overlay */
  function explain(res, obs) {
    var lines = ["ICU monitor parser v" + res.version + "  layout=" + res.layout.profile + "  boxes=" + res.stats.boxes + "  parse=" + res.stats.parseMs + "ms  colour=" + (res.stats.colorSampled ? "sampled" : "none")];
    Object.keys(res.fields).forEach(function (k) {
      var f = res.fields[k];
      lines.push("", "Field: " + k.toUpperCase(), "Status: " + f.status + "   Confidence: " + f.confidence + (f.reason ? "   Reason: " + f.reason : ""));
      lines.push("Selected: " + (f.value != null ? (typeof f.value === "object" ? JSON.stringify(f.value) : f.value) : "null") + (f.suggested != null && f.value == null ? "   (suggested " + (typeof f.suggested === "object" ? JSON.stringify(f.suggested) : f.suggested) + ", not auto-filled)" : ""));
      if (f.label) lines.push("Label: " + JSON.stringify(f.label.text) + " box#" + f.label.box + " strength " + f.label.strength); else if (k !== "sbp" && k !== "dbp" && k !== "map") lines.push("Label: none");
      if (f.channel) lines.push("Channel colour: " + f.channel.kind + (f.channel.h != null ? " hue " + f.channel.h + "°" : ""));
      (f.candidates || []).forEach(function (c) {
        var b = obs && obs[c.box];
        lines.push("  candidate " + JSON.stringify(c.text) + (c.value != null ? " → " + c.value : "") + "  score " + (c.score != null ? c.score : "-") + (c.role ? "  role " + c.role : "") + (c.source ? "  source " + c.source : "") +
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
      (f.candidates || []).forEach(function (c) { if (f.status === "AUTO_ACCEPTED" && c.value === f.value && f.box == null) { sel[c.box] = k; f.box = c.box; } else if (!sel[c.box]) { rej[c.box] = k; if (c.role === "limit" || c.role === "limitRange") lim[c.box] = 1; } });
    });
    obs.forEach(function (b, i) {
      var x = b.x * w, y = b.y * h, bw = b.w * w, bh = b.h * h;
      var stroke = sel[i] ? "#16a34a" : lab[i] ? "#2563eb" : lim[i] ? "#f59e0b" : rej[i] ? "#9ca3af" : "rgba(255,255,255,.35)";
      var sw = sel[i] ? 3 : lab[i] ? 2 : 1, dash = lim[i] ? ' stroke-dasharray="6 4"' : "";
      out.push('<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + "/>");
      var tag = sel[i] ? sel[i].toUpperCase() : lab[i] ? "label " + lab[i] : lim[i] ? "limit" : null;
      if (tag) out.push('<text x="' + x + '" y="' + Math.max(10, y - 3) + '" font-size="' + Math.max(10, h * 0.012) + '" fill="' + stroke + '" font-family="system-ui">' + esc(tag) + "</text>");
    });
    Object.keys(res.fields).forEach(function (k) {
      var f = res.fields[k]; if (!f.label || f.box == null) return;
      var L = obs[f.label.box], V = obs[f.box]; if (!L || !V) return;
      out.push('<line x1="' + ((L.x + L.w / 2) * w) + '" y1="' + ((L.y + L.h / 2) * h) + '" x2="' + ((V.x + V.w / 2) * w) + '" y2="' + ((V.y + V.h / 2) * h) + '" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="3 3"/>');
    });
    out.push("</svg>");
    return out.join("");
  }

  return { VERSION: VERSION, parseMonitor: parseMonitor, sampleColors: sampleColors, explain: explain, overlaySVG: overlaySVG, _internals: { buildGraph: buildGraph, FIELDS: FIELDS, LABELS: LABELS, rgbToHsv: rgbToHsv, sampleRegion: sampleRegion, channelColorAtValue: channelColorAtValue, channelColor: channelColor } };
});
