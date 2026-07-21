/* kardiox-ecgwave.js — KardioX AI · parametric vector-ECG generator (SMD_KARDIOX_ECGWAVE).
 *
 * Synthesises a clinically-representative single-lead ECG rhythm strip as an SVG polyline `points`
 * string from structured, diagnosis-specific parameters — so every Learn-ECG page shows an ECG that
 * actually demonstrates its diagnosis instead of one shared placeholder. Deterministic (no RNG), pure,
 * node + browser. Baked into each lesson at content-build time; the renderer just reads the string.
 *
 * params (all optional; defaults = normal sinus):
 *   rate, rhythm("regular|irregular|irregular-p|chaotic|sine|torsades"),
 *   p("upright|absent|inverted|sawtooth|varying|dissociated|none"),
 *   pr("normal|short|long|lengthening|none"),
 *   qrs("narrow|wide|rsr|monophasic|delta|bizarre|low"), amp,
 *   st("iso|up|down|scooped"), t("normal|peaked|flat|inverted|hyperacute|biphasic"), u(bool),
 *   qt("normal|short|long"), q(bool pathologic Q), axis("left|right"), prDep(bool PR depression),
 *   deltaDir("neg"), artifact("tremor|ac|wander|pseudo-flutter"), paced("capture|crt|fail|inhibit"),
 *   blockedP("2to1"), extras(["pvc","dropped","osborn"]).
 */
(function () {
  "use strict";

  var JIT = [0, 0.22, -0.16, 0.3, -0.28, 0.12, 0.34, -0.2, 0.18, -0.3, 0.26, -0.12, 0.32, -0.24];
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function beat(pts, x, rr, b, h, p) {
    var qrsW = p.qrs === "wide" || p.qrs === "monophasic" || p.qrs === "bizarre" || p.qrs === "delta" ? 0.16 : (p.qrs === "rsr" ? 0.14 : 0.07);
    var prFrac = p.pr === "long" ? 0.34 : p.pr === "short" ? 0.10 : p.pr === "none" ? 0 : 0.20;
    var prY = p.prDep ? b + 5 : b;                              // PR-segment depression (pericarditis)
    pts.push([x, b]);
    if (p.p === "upright" || p.p === "inverted" || p.p === "varying") {
      var pdir = p.p === "inverted" ? +1 : -1;
      var pAmp = (p.p === "varying" ? 5 + (JIT[(x | 0) % JIT.length] * 6) : 6) * (p.p === "inverted" ? 0.7 : 1);
      var px = x + rr * (prFrac * 0.4);
      pts.push([px - rr * 0.05, b], [px, b + pdir * pAmp], [px + rr * 0.05, prY]);
    } else if (p.p === "sawtooth") {
      var n = 3, seg = (rr * prFrac) / n;
      for (var s = 0; s < n; s++) pts.push([x + seg * s, b], [x + seg * (s + 0.5), b - 7], [x + seg * (s + 1), b + 4]);
    } else if (p.p === "dissociated") {
      var dp = x + rr * 0.12; pts.push([dp - rr * 0.03, b], [dp, b - 6], [dp + rr * 0.03, b]);
    }
    var qx = x + rr * (p.p === "sawtooth" ? prFrac : (prFrac + 0.02));
    pts.push([qx, prY]);
    // QRS — axis scales the R/S balance on this single educational lead.
    var amp = p.amp || 1;
    var Rk = p.axis === "left" ? 0.45 : p.axis === "right" ? 1.45 : 1;
    var Sk = p.axis === "left" ? 1.7 : p.axis === "right" ? 0.4 : 1;
    var R = 26 * amp * Rk, Sd = 10 * amp * Sk, w = rr * qrsW;
    if (p.qrs === "delta") {
      var dd = p.deltaDir === "neg" ? -1 : 1;
      pts.push([qx + w * 0.35, b - R * 0.35 * dd], [qx + w * 0.7, b - R * dd], [qx + w, b + Sd], [qx + w * 1.15, b]);
    } else if (p.qrs === "rsr") {
      pts.push([qx + w * 0.2, b - 9], [qx + w * 0.4, b + Sd], [qx + w * 0.7, b - R * 0.8], [qx + w, b]);
    } else if (p.qrs === "monophasic") {
      pts.push([qx + w * 0.3, b - R], [qx + w * 0.55, b - R * 0.75], [qx + w * 0.8, b - R], [qx + w * 1.05, b]);
    } else if (p.qrs === "bizarre") {
      pts.push([qx + w * 0.3, b - R * 0.9], [qx + w * 0.7, b + Sd * 1.4], [qx + w * 1.05, b - R * 0.3]);
    } else if (p.qrs === "low") {
      pts.push([qx + w * 0.4, b - 8], [qx + w * 0.6, b + 4], [qx + w, b]);
    } else {
      if (p.q) pts.push([qx + w * 0.12, b + 15]);              // pathologic Q (old MI / HCM septal)
      pts.push([qx + w * 0.25, b + 4], [qx + w * 0.5, b - R], [qx + w * 0.75, b + Sd], [qx + w, b]);
    }
    var jx = qx + w * 1.15;
    var stY = p.st === "up" ? b - 8 : p.st === "down" ? b + 6 : b;
    if (p.st === "scooped") pts.push([jx, b + 3], [jx + rr * 0.06, b + 6], [jx + rr * 0.1, b + 2]);
    else pts.push([jx, stY]);
    if ((p.extras || []).indexOf("osborn") >= 0) pts.push([jx + rr * 0.02, b - 9], [jx + rr * 0.05, stY]);
    var qtShift = p.qt === "long" ? 0.16 : p.qt === "short" ? -0.07 : 0;   // QT interval → T position
    var tx = jx + rr * (0.20 + qtShift), tw = rr * 0.14;
    var tAmp = p.t === "peaked" ? 18 : p.t === "hyperacute" ? 15 : p.t === "flat" ? 3 : 9;
    var tdir = (p.t === "inverted") ? +1 : -1;
    if (p.t === "biphasic") pts.push([tx, stY], [tx + tw * 0.5, stY - 8], [tx + tw, stY + 8], [tx + tw * 1.4, b]);
    else if (p.t === "peaked") pts.push([tx, stY], [tx + tw * 0.4, b - tAmp], [tx + tw * 0.8, stY], [tx + tw * 1.2, b]);
    else pts.push([tx, stY], [tx + tw, stY + tdir * tAmp], [tx + tw * 2, b]);
    if (p.u) { var ux = tx + tw * 2.4; pts.push([ux, b], [ux + rr * 0.06, b - 5], [ux + rr * 0.1, b]); }
    pts.push([x + rr, b]);
  }

  function artifactStrip(p, b, W, H) {                          // baseline noise + QRS spikes
    var pts = [], nb = clamp(Math.round((p.rate / 60) * 4.2), 2, 9), rr = W / nb;
    for (var x = 0; x <= W; x += 3) {
      if ((x % rr) < 3) { pts.push([x, b], [x + 1, b - 24], [x + 2, b + 8]); continue; }
      var y = b;
      if (p.artifact === "wander") y = b + 12 * Math.sin(x / 40);
      else if (p.artifact === "ac") y = b + (((x / 3) | 0) % 2 ? 3 : -3);
      else if (p.artifact === "pseudo-flutter") y = b + 9 * Math.sin(x / 4);   // regular, mimics flutter sawtooth
      else y = b + 7 * Math.sin(x / 6) + JIT[((x / 3) | 0) % JIT.length] * 4;   // tremor (irregular)
      pts.push([x, clamp(y, 6, H - 6)]);
    }
    return enc(pts);
  }

  function strip(params, W, H) {
    params = params || {}; W = W || 320; H = H || 80;
    var p = {
      rate: params.rate || 72, rhythm: params.rhythm || "regular", p: params.p || "upright",
      pr: params.pr || "normal", qrs: params.qrs || "narrow", amp: params.amp || 1,
      st: params.st || "iso", t: params.t || "normal", u: !!params.u, extras: params.extras || [],
      q: !!params.q, qt: params.qt || "normal", axis: params.axis || "", prDep: !!params.prDep,
      deltaDir: params.deltaDir || "", artifact: params.artifact || "", paced: params.paced || "", blockedP: params.blockedP || ""
    };
    var b = Math.round(H * 0.6), h = 1, pts = [];

    if (p.artifact) return artifactStrip(p, b, W, H);
    if (p.rhythm === "chaotic") {
      for (var x = 0; x <= W; x += 6) { var d = (JIT[(x / 6 | 0) % JIT.length]) * 26; pts.push([x, clamp(b + d + ((x % 12) ? -10 : 12), 8, H - 8)]); }
      return enc(pts);
    }
    if (p.rhythm === "sine" || (p.qrs === "bizarre" && p.rhythm !== "regular")) {
      var rrv = clamp(W / Math.max(3, Math.round(p.rate / 20)), 40, 120);
      for (var xv = 0; xv <= W; xv += rrv) beat(pts, xv, rrv, b, h, { qrs: "bizarre", p: "none", pr: "none", st: "iso", t: "inverted", amp: 1.1, extras: [] });
      return enc(pts);
    }
    if (p.rhythm === "torsades") {
      for (var xt = 0; xt <= W; xt += 5) { var a2 = 6 + 18 * Math.abs(Math.sin(xt / 55)); pts.push([xt, clamp(b + (xt % 10 < 5 ? -a2 : a2), 8, H - 8)]); }
      return enc(pts);
    }

    var nBeats = clamp(Math.round((p.rate / 60) * 4.2), 2, 9);
    var rr = W / nBeats, acc = 0;
    for (var i = 0; i < nBeats; i++) {
      var thisRr = rr;
      if (p.rhythm === "irregular") thisRr = rr * (1 + JIT[i % JIT.length]);
      var bp = { rate: p.rate, p: p.p, pr: p.pr, qrs: p.qrs, amp: p.amp, st: p.st, t: p.t, u: p.u, extras: p.extras, q: p.q, qt: p.qt, axis: p.axis, prDep: p.prDep, deltaDir: p.deltaDir };
      if (p.pr === "lengthening") bp.pr = ["normal", "long", "long"][i % 3];
      if (p.blockedP === "2to1") pts.push([acc, b], [acc + thisRr * 0.12, b - 6], [acc + thisRr * 0.2, b]);   // extra non-conducted P
      if (p.paced === "capture" || p.paced === "crt") {
        var sp = acc + thisRr * 0.12; pts.push([sp - 1, b], [sp, b - 30], [sp + 0.5, b]);                     // pacing spike + capture
        bp.qrs = p.paced === "crt" ? "monophasic" : "wide"; bp.p = "none"; bp.pr = "short";
      } else if (p.paced === "fail" && (i % 2 === 1)) {
        var sf = acc + thisRr * 0.3; pts.push([acc, b], [sf - 1, b], [sf, b - 30], [sf + 0.5, b], [acc + thisRr, b]); acc += thisRr; continue;   // spike, NO capture
      } else if (p.paced === "inhibit" && (i % 3 === 1)) {
        pts.push([acc, b], [acc + thisRr, b]); acc += thisRr * 1.4; continue;                                 // inappropriate inhibition → pause
      }
      if ((p.extras.indexOf("dropped") >= 0) && (nBeats >= 5 ? i % 4 === 3 : i === nBeats - 2)) { drawPonly(pts, acc, thisRr, b); acc += thisRr; continue; }   // dropped/blocked beat (works at slow rates too)
      if ((p.extras.indexOf("pvc") >= 0) && (i === Math.floor(nBeats / 2))) { beat(pts, acc, thisRr, b, h, { qrs: "bizarre", p: "none", pr: "none", st: "iso", t: "inverted", amp: 1.2, extras: [] }); acc += thisRr * 1.3; continue; }
      beat(pts, acc, thisRr, b, h, bp);
      acc += thisRr;
    }
    return enc(pts);
  }
  function drawPonly(pts, x, rr, b) { pts.push([x, b], [x + rr * 0.2, b], [x + rr * 0.25, b - 6], [x + rr * 0.3, b], [x + rr, b]); }
  function enc(pts) { return pts.map(function (q) { return Math.max(0, Math.round(q[0])) + "," + Math.round(clamp(q[1], 2, 998)); }).join(" "); }
  function thumb(params) { return strip(params, 60, 40); }

  var API = { strip: strip, thumb: thumb };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_ECGWAVE = API;
})();
