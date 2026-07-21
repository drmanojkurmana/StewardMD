/* kardiox-ecgwave.js — KardioX AI · parametric vector-ECG generator (SMD_KARDIOX_ECGWAVE).
 *
 * Synthesises a clinically-representative single-lead ECG rhythm strip as an SVG polyline `points`
 * string from structured, diagnosis-specific parameters — so every Learn-ECG page shows an ECG that
 * actually demonstrates its diagnosis instead of one shared placeholder. Deterministic (no RNG), pure,
 * node + browser. Used at CONTENT-BUILD time to bake a static `ecgStrip` (+ mini `trace`) into each
 * lesson; the renderer just reads those strings (UI unchanged).
 *
 * params (all optional, sensible defaults = normal sinus):
 *   rate:   ventricular rate bpm (spacing of beats)
 *   rhythm: "regular" | "irregular"(AF) | "irregular-p"(WAP/MAT) | "chaotic"(VF) | "sine"(VT) | "torsades"
 *   p:      "upright" | "absent" | "inverted" | "sawtooth"(flutter) | "varying" | "dissociated"(3° AVB) | "none"
 *   pr:     "normal" | "short"(pre-excite) | "long"(1°AVB) | "lengthening"(Wenckebach) | "none"
 *   qrs:    "narrow" | "wide" | "rsr"(RBBB V1) | "monophasic"(LBBB V6) | "delta"(WPW) | "bizarre"(VT) | "low"
 *   amp:    QRS amplitude scale (1 = normal; ~1.8 = LVH voltage)
 *   st:     "iso" | "up"(STEMI/pericarditis) | "down"(ischemia/strain) | "scooped"(digoxin)
 *   t:      "normal" | "peaked"(hyperK) | "flat"(hypoK) | "inverted" | "hyperacute" | "biphasic"(Wellens)
 *   u:      true → prominent U wave (hypoK)
 *   extras: array incl "pvc","dropped"(Wenckebach drop),"osborn"(J wave),"alternans","epsilon","paced"
 */
(function () {
  "use strict";

  // Deterministic small "irregularity" jitter (no RNG so builds are reproducible).
  var JIT = [0, 0.22, -0.16, 0.3, -0.28, 0.12, 0.34, -0.2, 0.18, -0.3, 0.26, -0.12, 0.32, -0.24];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Build one beat's points from x (left) spanning `rr` px, on baseline `b`, height scale `h` (px per mV-ish).
  function beat(pts, x, rr, b, h, p) {
    var qrsW = p.qrs === "wide" || p.qrs === "monophasic" || p.qrs === "bizarre" || p.qrs === "delta" ? 0.16 : (p.qrs === "rsr" ? 0.14 : 0.07);
    var prFrac = p.pr === "long" ? 0.34 : p.pr === "short" ? 0.10 : p.pr === "none" ? 0 : 0.20;
    // isoelectric lead-in
    pts.push([x, b]);
    var cx = x;
    // P wave
    if (p.p === "upright" || p.p === "inverted" || p.p === "varying") {
      var pdir = p.p === "inverted" ? +1 : -1;                 // up = toward smaller y
      var pAmp = (p.p === "varying" ? 5 + (JIT[(x | 0) % JIT.length] * 6) : 6) * (p.p === "inverted" ? 0.7 : 1);
      var px = x + rr * (prFrac * 0.4);
      pts.push([px - rr * 0.05, b], [px, b + pdir * pAmp], [px + rr * 0.05, b]);
      cx = px + rr * 0.05;
    } else if (p.p === "sawtooth") {
      // flutter: continuous sawtooth up to the QRS (drawn across the RR pre-QRS)
      var n = 3, seg = (rr * prFrac) / n;
      for (var s = 0; s < n; s++) { pts.push([x + seg * s, b], [x + seg * (s + 0.5), b - 7], [x + seg * (s + 1), b + 4]); }
      cx = x + rr * prFrac;
    } else if (p.p === "dissociated") {
      // AV dissociation: an early independent P (kept before the QRS so points stay x-monotonic; the
      // "more Ps than QRS" relationship is taught in the finding tags/criteria).
      var dp = x + rr * 0.12; pts.push([dp - rr * 0.03, b], [dp, b - 6], [dp + rr * 0.03, b]);
    }
    // PR segment to QRS onset
    var qx = x + rr * (p.p === "sawtooth" ? prFrac : (prFrac + 0.02));
    pts.push([qx, b]);
    // QRS
    var R = 26 * (p.amp || 1), Sd = 10 * (p.amp || 1), w = rr * qrsW;
    if (p.qrs === "delta") {                                   // slurred delta upstroke then R
      pts.push([qx + w * 0.35, b - R * 0.35], [qx + w * 0.7, b - R], [qx + w, b + Sd], [qx + w * 1.15, b]);
    } else if (p.qrs === "rsr") {                              // rSR' (RBBB in V1): r, S, R'
      pts.push([qx + w * 0.2, b - 9], [qx + w * 0.4, b + Sd], [qx + w * 0.7, b - R * 0.8], [qx + w, b]);
    } else if (p.qrs === "monophasic") {                       // broad notched R (LBBB in V6)
      pts.push([qx + w * 0.3, b - R], [qx + w * 0.55, b - R * 0.75], [qx + w * 0.8, b - R], [qx + w * 1.05, b]);
    } else if (p.qrs === "bizarre") {                          // wide, no clear iso (VT)
      pts.push([qx + w * 0.3, b - R * 0.9], [qx + w * 0.7, b + Sd * 1.4], [qx + w * 1.05, b - R * 0.3]);
    } else if (p.qrs === "low") {                              // low voltage
      pts.push([qx + w * 0.4, b - 8], [qx + w * 0.6, b + 4], [qx + w, b]);
    } else {                                                   // narrow/wide standard qRS
      pts.push([qx + w * 0.25, b + 4], [qx + w * 0.5, b - R], [qx + w * 0.75, b + Sd], [qx + w, b]);
    }
    var jx = qx + w * 1.15;                                    // J point
    // ST segment
    var stY = p.st === "up" ? b - 8 : p.st === "down" ? b + 6 : b;
    if (p.st === "scooped") { pts.push([jx, b + 3], [jx + rr * 0.06, b + 6], [jx + rr * 0.1, b + 2]); }
    else pts.push([jx, stY]);
    if ((p.extras || []).indexOf("osborn") >= 0) pts.push([jx + rr * 0.02, b - 9], [jx + rr * 0.05, stY]); // J/Osborn wave
    // T wave
    var tx = jx + rr * 0.20, tw = rr * 0.14;
    var tAmp = p.t === "peaked" ? 18 : p.t === "hyperacute" ? 15 : p.t === "flat" ? 3 : 9;
    var tdir = (p.t === "inverted") ? +1 : -1;
    if (p.t === "biphasic") { pts.push([tx, stY], [tx + tw * 0.5, stY - 8], [tx + tw, stY + 8], [tx + tw * 1.4, b]); }
    else if (p.t === "peaked") { pts.push([tx, stY], [tx + tw * 0.4, b - tAmp], [tx + tw * 0.8, stY], [tx + tw * 1.2, b]); } // tall narrow
    else { pts.push([tx, stY], [tx + tw, stY + tdir * tAmp], [tx + tw * 2, b]); }
    // U wave
    if (p.u) { var ux = tx + tw * 2.4; pts.push([ux, b], [ux + rr * 0.06, b - 5], [ux + rr * 0.1, b]); }
    pts.push([x + rr, b]);
  }

  // Whole strip → points string. W×H viewbox; baseline at 0.6H.
  function strip(params, W, H) {
    params = params || {}; W = W || 320; H = H || 80;
    var p = {
      rate: params.rate || 72, rhythm: params.rhythm || "regular", p: params.p || "upright",
      pr: params.pr || "normal", qrs: params.qrs || "narrow", amp: params.amp || 1,
      st: params.st || "iso", t: params.t || "normal", u: !!params.u, extras: params.extras || []
    };
    var b = Math.round(H * 0.6), h = 1, pts = [];

    if (p.rhythm === "chaotic") {   // VF — coarse irregular fibrillation, no beats
      var y = b; for (var x = 0; x <= W; x += 6) { var d = ((JIT[(x / 6 | 0) % JIT.length]) * 26); pts.push([x, clamp(b + d + ((x % 12) ? -10 : 12), 8, H - 8)]); }
      return enc(pts);
    }
    if (p.rhythm === "sine" || p.qrs === "bizarre" && p.rhythm !== "regular") {  // VT — wide, regular, sine-like
      var rrv = clamp(W / Math.max(3, Math.round(p.rate / 20)), 40, 120);
      for (var xv = 0; xv <= W; xv += rrv) beat(pts, xv, rrv, b, h, { qrs: "bizarre", p: "none", pr: "none", st: "iso", t: "inverted", amp: 1.1, extras: [] });
      return enc(pts);
    }
    if (p.rhythm === "torsades") {  // twisting-around-baseline polymorphic VT
      var amp2 = 6; for (var xt = 0; xt <= W; xt += 5) { amp2 = 6 + 18 * Math.abs(Math.sin(xt / 55)); var yy = b + (xt % 10 < 5 ? -amp2 : amp2); pts.push([xt, clamp(yy, 8, H - 8)]); }
      return enc(pts);
    }

    // beat-based rhythms
    var nBeats = clamp(Math.round((p.rate / 60) * 4.2), 2, 9);   // ~4.2 s window
    var rr = W / nBeats;
    var acc = 0;
    for (var i = 0; i < nBeats; i++) {
      var thisRr = rr;
      if (p.rhythm === "irregular") thisRr = rr * (1 + JIT[i % JIT.length]);   // AF irregularly irregular
      var bp = { rate: p.rate, p: p.p, pr: p.pr, qrs: p.qrs, amp: p.amp, st: p.st, t: p.t, u: p.u, extras: p.extras };
      if (p.pr === "lengthening") bp.pr = (["normal", "long", "long"][i % 3]);   // Wenckebach PR creep
      // dropped beat (Mobitz/Wenckebach): every 4th beat drop the QRS (P only)
      if ((p.extras.indexOf("dropped") >= 0) && (i % 4 === 3)) { bp.qrs = "narrow"; drawPonly(pts, acc, thisRr, b); acc += thisRr; continue; }
      // interpolated PVC
      if ((p.extras.indexOf("pvc") >= 0) && (i === Math.floor(nBeats / 2))) { beat(pts, acc, thisRr, b, h, { qrs: "bizarre", p: "none", pr: "none", st: "iso", t: "inverted", amp: 1.2, extras: [] }); acc += thisRr * 1.3; continue; }
      beat(pts, acc, thisRr, b, h, bp);
      acc += thisRr;
    }
    return enc(pts);
  }
  function drawPonly(pts, x, rr, b) { pts.push([x, b], [x + rr * 0.2, b], [x + rr * 0.25, b - 6], [x + rr * 0.3, b], [x + rr, b]); }

  function enc(pts) { return pts.map(function (q) { return Math.max(0, Math.round(q[0])) + "," + Math.round(clamp(q[1], 2, 998)); }).join(" "); }

  function thumb(params) { return strip(params, 60, 40); }   // library mini-trace

  var API = { strip: strip, thumb: thumb };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_ECGWAVE = API;
})();
