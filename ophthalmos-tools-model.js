/* Ophthalmós clinical calculators: the pure model. ES5, no DOM.
   Browser: window.OPHTHALMOS_TOOLS. Node (tests): module.exports.
   Every rule here is transcribed from a primary or peer-reviewed source named beside it and pinned by
   test/tools.test.mjs against published reference values. For learning, not for clinical decisions. */
(function (G) {
  "use strict";
  var MINUS = "−";

  /* ---------- numbers ---------- */
  function round(v, dp) { var f = Math.pow(10, dp || 0); return Math.round(v * f) / f; }
  // Dioptres with an explicit sign and a true minus sign: +1.25, −0.50, 0.00 (never "−0.00").
  function signed(v, dp) {
    if (dp == null) dp = 2;
    var r = round(v, dp);
    if (r === 0) return (0).toFixed(dp);
    return (r > 0 ? "+" : MINUS) + Math.abs(r).toFixed(dp);
  }
  // Plain number, true minus sign only when negative.
  function num(v, dp) {
    var r = round(v, dp || 0);
    return (r < 0 ? MINUS : "") + Math.abs(r).toFixed(dp || 0);
  }
  // Accepts "−2.5", "-2.5", "+2.5", "2,5". Anything else is NaN.
  function parse(s) {
    if (typeof s === "number") return s;
    s = String(s == null ? "" : s).replace(/−/g, "-").replace(",", ".").replace(/\s+/g, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function nearest(v, step) { return round(Math.round(v / step) * step, 4); }

  /* ---------- refraction (thin-lens optics; Elkington, Frank, Greaney, Clinical Optics, 1999) ---------- */
  // Axis in 1..180; 0 is written 180.
  function axis(a) { a = Math.round(a) % 180; if (a <= 0) a += 180; return a; }
  // The same lens in the other cylinder form: sphere + cylinder, cylinder sign flipped, axis turned 90°.
  function transpose(rx) {
    if (!rx.c) return { s: rx.s, c: 0, ax: axis(rx.ax) };
    return { s: round(rx.s + rx.c, 6), c: -rx.c, ax: axis(rx.ax + 90) };
  }
  function sphEq(rx) { return rx.s + rx.c / 2; }
  // Effective power of a thin lens moved d metres toward the eye: F / (1 − dF).
  function effective(F, dM) { return F / (1 - dM * F); }
  // A prescription measured at fromMm, worn at toMm (0 = corneal plane, a contact lens). Each principal
  // meridian is compensated on its own, then rebuilt in the same cylinder form.
  function vertex(rx, fromMm, toMm) {
    var d = (fromMm - toMm) / 1000;
    var m1 = rx.s, m2 = rx.s + rx.c;             // power along the axis, and 90° from it
    var e1 = effective(m1, d), e2 = effective(m2, d), q1 = nearest(e1, 0.25), q2 = nearest(e2, 0.25);
    // To prescribe, each meridian is rounded to 0.25 D and the cylinder rebuilt from them, so neither meridian
    // moves by more than 0.125 D (rounding sphere and cylinder separately can move the second by 0.25 D).
    return { s: e1, c: e2 - e1, ax: axis(rx.ax), q: { s: q1, c: round(q2 - q1, 4), ax: axis(rx.ax) }, meridians: [
      { at: axis(rx.ax), from: m1, to: e1 }, { at: axis(rx.ax + 90), from: m2, to: e2 }] };
  }

  /* ---------- visual acuity ---------- */
  // ETDRS chart lines (Ferris, Kassoff, Bresnick, Bailey 1982): logMAR, metric 6/x, imperial 20/x, decimal.
  var LINES = [[1.0, "60", "200", "0.10"], [0.9, "48", "160", "0.125"], [0.8, "38", "125", "0.16"], [0.7, "30", "100", "0.20"],
    [0.6, "24", "80", "0.25"], [0.5, "19", "63", "0.32"], [0.4, "15", "50", "0.40"], [0.3, "12", "40", "0.50"],
    [0.2, "9.5", "32", "0.63"], [0.1, "7.5", "25", "0.80"], [0.0, "6", "20", "1.00"], [-0.1, "4.8", "16", "1.25"],
    [-0.2, "3.8", "12.5", "1.60"], [-0.3, "3", "10", "2.00"]];
  var VA_KINDS = {
    m6: { min: 1.5, max: 600, toL: function (v) { return log10(v / 6); } },
    f20: { min: 5, max: 2000, toL: function (v) { return log10(v / 20); } },
    dec: { min: 0.01, max: 4, toL: function (v) { return -log10(v); } },
    logmar: { min: -0.6, max: 2, toL: function (v) { return v; } },
    // Gregori, Feuer, Rosenfeld 2010: approximate ETDRS letters = 85 + 50 × log(Snellen fraction).
    letters: { min: 0, max: 100, toL: function (v) { return (85 - v) / 50; } }
  };
  function log10(x) { return Math.log(x) / Math.LN10; }
  function snellenDen(num0, L) { var x = num0 * Math.pow(10, L); return x >= 10 ? String(Math.round(x)) : String(round(x, 1)); }
  // Chart notations are rounded (6/12 is logMAR 0.301, decimal 0.32 is 0.495): within 0.006 logMAR is that line;
  // the next line is 0.1 away, and off-chart Snellen lines (6/9 at 0.176, 6/5 at −0.079) stay off.
  function va(kind, v) {
    var L = VA_KINDS[kind].toL(v), best = LINES[0];
    LINES.forEach(function (x) { if (Math.abs(x[0] - L) < Math.abs(best[0] - L)) best = x; });
    var on = Math.abs(best[0] - L) < 0.006, letters = Math.round(85 - 50 * L);
    return {
      logmar: L, dec: Math.pow(10, -L), decTxt: on ? best[3] : num(Math.pow(10, -L), 2),
      m6: on ? best[1] : snellenDen(6, L), f20: on ? best[2] : snellenDen(20, L),
      letters: letters >= 0 && letters <= 100 ? letters : null,
      onLine: on, nearest: best
    };
  }

  /* ---------- IOL power: SRK/T ----------
     Retzlaff JA, Sanders DR, Kraff MC. J Cataract Refract Surg 1990;16:333-340, erratum 1990;16:528.
     The erratum corrected the axial length correction (LCOR) to −3.446 + 1.715 L − 0.0237 L² above 24.2 mm.
     Many devices keep the original 1.716; the difference is under 0.02 D up to 30 mm (see the tests). */
  var SRKT = { na: 1.336, ncm1: 0.333, V: 12, LCOR_B: 1.715 };
  function srktEye(al, K, A) {
    var r = 337.5 / K;
    var lcor = al <= 24.2 ? al : -3.446 + SRKT.LCOR_B * al - 0.0237 * al * al;
    var cw = -5.40948 + 0.58412 * lcor + 0.098 * K;           // corneal width
    var x = r * r - cw * cw / 4;
    var h = r - Math.sqrt(x < 0 ? 0 : x);                      // corneal height
    var offset = (0.62467 * A - 68.74709) - 3.3357;            // from the A-constant
    var lopt = al + (0.65696 - 0.02029 * al);                 // + retinal thickness
    return { r: r, K: K, lcor: lcor, cw: cw, h: h, elp: h + offset, lopt: lopt };
  }
  // IOL power for a target refraction at the spectacle plane.
  function srktPower(e, target) {
    var na = SRKT.na, n1 = SRKT.ncm1, V = SRKT.V, r = e.r, L = e.lopt, C = e.elp;
    return (1000 * na * (na * r - n1 * L - 0.001 * target * (V * (na * r - n1 * L) + L * r))) /
      ((L - C) * (na * r - n1 * C - 0.001 * target * (V * (na * r - n1 * C) + C * r)));
  }
  // Predicted refraction for a given IOL power.
  function srktRefraction(e, P) {
    var na = SRKT.na, n1 = SRKT.ncm1, V = SRKT.V, r = e.r, L = e.lopt, C = e.elp;
    return (1000 * na * (na * r - n1 * L) - P * (L - C) * (na * r - n1 * C)) /
      (na * (V * (na * r - n1 * L) + L * r) - 0.001 * P * (L - C) * (V * (na * r - n1 * C) + C * r));
  }
  function srkt(o) {
    var e = srktEye(o.al, (o.k1 + o.k2) / 2, o.a);
    var p = srktPower(e, o.target), lo = Math.floor(p * 2) / 2;
    var lenses = [lo, lo + 0.5].map(function (P) { return { power: P, refraction: srktRefraction(e, P) }; });
    var closest = Math.abs(lenses[0].refraction - o.target) <= Math.abs(lenses[1].refraction - o.target) ? 0 : 1;
    lenses[closest].closest = true;
    return { eye: e, emmetropia: srktPower(e, 0), power: p, lenses: lenses,
      caution: o.al < 22 ? "short" : o.al > 26 ? "long" : null };
  }

  /* ---------- ROP: ETROP 2003 types ----------
     Early Treatment for ROP Cooperative Group. Arch Ophthalmol 2003;121:1684-1694.
     zone 1..3; stage 0 (none) .. 3, 4 means stage 4 or 5; plus "none" | "pre" | "plus". */
  function etrop(o) {
    var plus = o.plus === "plus", s = o.stage, z = o.zone;
    if (o.arop) return { type: "arop" };
    if (s >= 4) return { type: "rd" };
    if (!s) return { type: 0, rule: "No ROP stage: the ETROP types start at stage 1." };
    if (z === 1) {
      if (plus) return { type: 1, rule: "Zone I, any stage, with plus disease." };
      if (s === 3) return { type: 1, rule: "Zone I, stage 3, without plus disease." };
      return { type: 2, rule: "Zone I, stage 1 or 2, without plus disease." };
    }
    if (z === 2) {
      if (plus && s >= 2) return { type: 1, rule: "Zone II, stage 2 or 3, with plus disease." };
      if (!plus && s === 3) return { type: 2, rule: "Zone II, stage 3, without plus disease." };
      if (plus) return { type: 0, rule: "Zone II, stage 1 with plus is in neither ETROP type." };
      return { type: 0, rule: "Zone II, stage 1 or 2, without plus disease, is in neither type." };
    }
    return { type: 0, rule: "Zone III is in neither type." };
  }

  /* ---------- diabetic retinopathy: ICDR scale and AAO PPP follow-up ----------
     Wilkinson CP et al. Ophthalmology 2003;110:1677-1682 (international definitions).
     Follow-up: AAO Diabetic Retinopathy PPP 2024 (Lim JI et al. Ophthalmology 2025;132:P75-P162), Table 5.
     High-risk PDR: any 3 of the 4 DRS features listed in the same PPP. */
  var DR_LEVELS = ["No apparent retinopathy", "Mild NPDR", "Moderate NPDR", "Severe NPDR", "PDR"];
  var DR_FU = { // months, [low, high]
    none: { none: [12, 12] },
    mild: { none: [12, 12], nci: [3, 6], ci: [1, 1] },
    moderate: { none: [6, 12], nci: [3, 6], ci: [1, 1] },
    severe: { none: [3, 4], nci: [2, 4], ci: [1, 1] },
    pdr: { none: [3, 4], nci: [2, 4], ci: [1, 1] },
    hrpdr: { none: [2, 4], nci: [2, 4], ci: [1, 1] }
  };
  function icdr(f) {
    var q = [f.hemQ >= 4, f.vbQ >= 2, f.irmaQ >= 1], n421 = q.filter(Boolean).length;
    var nv = !!(f.nvd || f.nve), pdr = nv || !!f.vh;
    var more = f.hem || f.ex || f.hemQ > 0 || f.vbQ > 0;
    var level = pdr ? 4 : n421 ? 3 : more ? 2 : f.ma ? 1 : 0;
    var drs = [nv, !!f.nvd, nv && !!f.nvMod, !!f.vh], nDrs = drs.filter(Boolean).length;
    var highRisk = level === 4 && nDrs >= 3;
    var key = ["none", "mild", "moderate", "severe", highRisk ? "hrpdr" : "pdr"][level];
    var dme = f.dme || "none", fu = DR_FU[key][dme] || null;
    return { level: level, name: DR_LEVELS[level], key: key, rule421: q, n421: n421,
      verySevere: level === 3 && n421 >= 2, drs: drs, nDrs: nDrs, highRisk: highRisk, dme: dme, followUp: fu };
  }

  /* ---------- uveal melanoma: AJCC 8th edition T category (choroid and ciliary body) ----------
     Kivelä T et al. Uveal melanoma. AJCC Cancer Staging Manual, 8th ed. Grid as reproduced by Baron ED,
     Di Nicola M, Shields CL. Retina Today, May/June 2018, Table 1; cross-checked against the T text in Table 2. */
  var AJCC_TH = [3, 6, 9, 12, 15];        // thickness bands: ≤3.0, 3.1-6.0, ... 12.1-15.0, >15.0
  var AJCC_LBD = [3, 6, 9, 12, 15, 18];   // basal diameter bands: ≤3.0, ... 15.1-18.0, >18.0
  var AJCC_GRID = [                       // [thickness band][diameter band]
    [1, 1, 1, 1, 2, 2, 4],
    [1, 1, 1, 2, 2, 3, 4],
    [2, 2, 2, 2, 3, 3, 4],
    [3, 3, 3, 3, 3, 3, 4],
    [3, 3, 3, 3, 3, 4, 4],
    [4, 4, 4, 4, 4, 4, 4]];
  function band(v, bounds) { for (var i = 0; i < bounds.length; i++) if (v <= bounds[i]) return i; return bounds.length; }
  // o: {lbd, th (mm), cb (ciliary body involved), exe: "none" | "le5" | "gt5"}
  function ajcc(o) {
    var row = band(o.th, AJCC_TH), col = band(o.lbd, AJCC_LBD), size = AJCC_GRID[row][col];
    var sub = o.exe === "gt5" ? "e" : o.cb ? (o.exe === "le5" ? "d" : "b") : (o.exe === "le5" ? "c" : "a");
    return { row: row, col: col, size: size, sub: sub, t: "T" + (sub === "e" ? 4 : size) + sub };
  }

  var API = {
    MINUS: MINUS, round: round, signed: signed, num: num, parse: parse, nearest: nearest,
    axis: axis, transpose: transpose, sphEq: sphEq, effective: effective, vertex: vertex,
    LINES: LINES, VA_KINDS: VA_KINDS, va: va,
    SRKT: SRKT, srktEye: srktEye, srktPower: srktPower, srktRefraction: srktRefraction, srkt: srkt,
    etrop: etrop, DR_LEVELS: DR_LEVELS, DR_FU: DR_FU, icdr: icdr,
    AJCC_TH: AJCC_TH, AJCC_LBD: AJCC_LBD, AJCC_GRID: AJCC_GRID, ajcc: ajcc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.OPHTHALMOS_TOOLS = API;
})(typeof window !== "undefined" ? window : this);
