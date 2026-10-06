/* Narkē teaching signals: a seeded, deterministic generator of synthetic capnograms and multiparameter monitor screens
   for the capnography (capno) and monitor clinics. Pure logic, ES5 UMD, no DOM. Nothing here is patient data.
   capnogram(pattern, seed)  -> { fs, sec, y[], breaths[], etco2, rr, trend[]|null }   (mmHg against time)
   monitor(scenario, seed)   -> { ecg{fs,sec,y}, pleth{fs,sec,y}, co2 (a capnogram)|null, nums{}, trend[]|null }
   features(capnogram)       -> measured shape features (baseline, breaths, upslope, clefts, ripples, flat tail)
   describeCapno / describeMonitor -> screen-reader text built from measured features, English or Hindi.
   Waveform shapes follow the phase model in Gravenstein's Capnography 2e and Morgan and Mikhail 7e; numbers are
   illustrative teaching values, not thresholds. Teaching points cite their source keys (SOURCES). review: ai_drafted. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else (root.NARKE_MODELS = root.NARKE_MODELS || {})[m.id] = m;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function P(en, hi) { return { en: en, hi: hi }; }

  /* ---------- seeded random: Park-Miller minimal standard (exact in doubles, no Math.imul) ---------- */
  function rng(seed) {
    var s = Math.abs(Math.floor(+seed || 0)) % 2147483646 + 1;
    return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
  }
  function between(r, a, b) { return a + (b - a) * r(); }
  function r2(v) { return Math.round(v * 100) / 100; }

  var SOURCES = {
    miller: { label: "Gropper MA et al. (eds). Miller's Anesthesia, 9th edition. Elsevier, 2020. Respiratory and cardiovascular monitoring." },
    morgan: { label: "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition. McGraw Hill, 2022. Noninvasive monitoring." },
    gravenstein: { label: "Gravenstein JS, Jaffe MB, Gravenstein N, Paulus DA (eds). Capnography, 2nd edition. Cambridge University Press, 2011." },
    nap4: { label: "Cook TM, Woodall N, Frerk C (eds). 4th National Audit Project (NAP4): major complications of airway management in the UK. RCoA and DAS, 2011." },
    atls: { label: "American College of Surgeons. Advanced Trauma Life Support (ATLS), 10th edition, 2018. Thoracic trauma." },
    kbArrest: { label: "StewardMD protocol: adult cardiac arrest (monitoring during CPR, after ROSC)." },
    kbMH: { label: "StewardMD protocol: malignant hyperthermia crisis." },
    kbLAST: { label: "StewardMD protocol: local anaesthetic systemic toxicity." },
    kbAnaph: { label: "StewardMD protocol: anaphylaxis." }
  };

  /* ================= capnogram patterns ================= */
  // Each recipe(r) returns the breath plan for a 24 s window: rr, per-breath shape (peak, base, rise, slope, cleft, osc),
  // optional cut (no breaths after), cpr ripple, and a 16-point per-minute EtCO2 trend where the pattern is a trend.
  function shape(o) {
    return { peak: o.peak, base: o.base || 0, rise: o.rise || 0.08, slope: o.slope == null ? 0.04 : o.slope, cleft: o.cleft || null, osc: o.osc || null };
  }
  function flatTrend(r, v) { var t = [], i; for (i = 0; i < 16; i++) t.push(Math.round(v + between(r, -1, 1))); return t; }
  var RECIPES = {
    normal: function (r, o) {
      var rr = o.rr || Math.round(between(r, 10, 14)), et = o.et || between(r, 34, 40), b = [], i;
      for (i = 0; i < 8; i++) b.push(shape({ peak: et + between(r, -0.8, 0.8) }));
      return { rr: rr, breaths: b };
    },
    oesophageal: function (r) {
      var n = r() < 0.5 ? 3 : 4, p = between(r, 9, 15), b = [], i;
      for (i = 0; i < n; i++) { b.push(shape({ peak: p, rise: 0.2, slope: 0 })); p *= between(r, 0.45, 0.6); }
      return { rr: 15, breaths: b, flatAfter: true };
    },
    bronchospasm: function (r, o) {
      var rr = o.rr || Math.round(between(r, 10, 13)), et = o.et || between(r, 38, 46), b = [], i;
      for (i = 0; i < 8; i++) b.push(shape({ peak: et + between(r, -1, 1), rise: between(r, 0.5, 0.75), slope: between(r, 0.3, 0.42) }));
      return { rr: rr, breaths: b };
    },
    curare: function (r) {
      var rr = Math.round(between(r, 10, 12)), et = between(r, 35, 40), b = [], i;
      for (i = 0; i < 8; i++) b.push(shape({ peak: et + between(r, -0.8, 0.8), cleft: { at: between(r, 0.5, 0.68), depth: between(r, 9, 15), w: 0.13 } }));
      return { rr: rr, breaths: b };
    },
    rebreathing: function (r) {
      var rr = Math.round(between(r, 10, 13)), base = between(r, 5, 9), et = between(r, 43, 50), b = [], i;
      for (i = 0; i < 8; i++) b.push(shape({ peak: et + between(r, -0.8, 0.8), base: base }));
      return { rr: rr, breaths: b };
    },
    disconnect: function (r) {
      var et = between(r, 34, 40), b = [], i, n = 2 + Math.floor(r() * 2);
      for (i = 0; i < n; i++) b.push(shape({ peak: et + between(r, -0.8, 0.8) }));
      return { rr: 12, breaths: b, flatAfter: true };
    },
    mh: function (r) {
      var rr = Math.round(between(r, 17, 20)), et = between(r, 62, 74), b = [], i, t = [], t0 = between(r, 36, 39);
      for (i = 0; i < 9; i++) b.push(shape({ peak: et + between(r, -0.8, 0.8), slope: 0.06 }));
      for (i = 0; i < 16; i++) t.push(Math.round(t0 + (et - t0) * Math.pow(i / 15, 1.6)));
      return { rr: rr, breaths: b, trend: t };
    },
    falling: function (r, o) {
      var from = o.from || between(r, 33, 38), to = o.et || between(r, 14, 19), b = [], i, t = [], k = 10 + Math.floor(r() * 3);
      for (i = 0; i < 6; i++) b.push(shape({ peak: i < 1 ? from : Math.max(to, from - (from - to) * (i / 3)) + between(r, -0.5, 0.5) }));
      for (i = 0; i < 16; i++) t.push(Math.round(i < k ? from + between(r, -1, 1) : i === k ? (from + to) / 2 : to));
      return { rr: 12, breaths: b, trend: t };
    },
    cpr: function (r) {
      var lo = between(r, 11, 17), hi = between(r, 38, 46), k = 2, b = [], i;
      for (i = 0; i < 5; i++) b.push(shape({ peak: i < k ? lo + between(r, -1.5, 1.5) : hi + between(r, -1, 1), rise: 0.12, slope: 0.05 }));
      return { rr: 10, breaths: b, cpr: { amp: 1.6, hz: between(r, 1.75, 1.95) } };
    },
    cardiogenic: function (r) {
      var rr = Math.round(between(r, 6, 8)), et = between(r, 33, 38), hz = between(r, 60, 80) / 60, b = [], i;
      for (i = 0; i < 4; i++) b.push(shape({ peak: et + between(r, -0.8, 0.8), osc: { amp: between(r, 3.5, 4.5), hz: hz } }));
      return { rr: rr, breaths: b };
    }
  };

  var FS = 25, SEC = 24;
  // One breath at u seconds from its start. Expiration [0, te), then inspiration [te, T).
  function breathAt(u, T, s) {
    var ti = T / 3, te = T - ti, d = te * 0.1, x, v, tp = te * 0.55;
    function exp(uu) {
      if (uu < d) return s.base;
      x = uu - d;
      var plat = s.peak * (1 - s.slope) + s.peak * s.slope * Math.min(1, x / (te - d));
      var w = s.base + (plat - s.base) * (1 - Math.exp(-x / s.rise));
      if (s.cleft) w -= s.cleft.depth * Math.exp(-Math.pow((uu - s.cleft.at * te) / s.cleft.w, 2));
      if (s.osc && uu > tp) {
        // expiratory pause: CO2 falls slowly and each heartbeat moves gas past the sampler
        var z = uu - tp, top = s.peak * (1 - s.slope) + s.peak * s.slope * Math.min(1, (tp - d) / (te - d));
        w = s.base + (top - s.base) * Math.exp(-z / 1.1) + s.osc.amp * Math.sin(2 * Math.PI * s.osc.hz * z) * Math.min(1, z / 0.25);
      }
      return Math.max(s.base, w);
    }
    if (u < te) return exp(u);
    v = exp(te - 1e-6);
    return s.base + (v - s.base) * Math.exp(-(u - te) / 0.06);
  }
  function capnogram(id, seed, opts) {
    var rec = RECIPES[id];
    if (!rec) return null;
    var r = rng(seed), plan = rec(r, opts || {}), sec = (opts && opts.sec) || SEC, n = Math.round(sec * FS), T = 60 / plan.rr;
    var start = between(r, 0.3, 1.2), y = [], marks = [], i, k, t, v;
    for (k = 0; k < plan.breaths.length; k++) marks.push({ t0: start + k * T, T: T, peak: r2(plan.breaths[k].peak), base: r2(plan.breaths[k].base) });
    var last = marks[marks.length - 1], endPlan = last.t0 + T;
    var noise = rng(+seed + 7919);
    for (i = 0; i < n; i++) {
      t = i / FS; v = 0;
      if (t < start) v = plan.breaths[0].base;
      else {
        k = Math.floor((t - start) / T);
        if (k < plan.breaths.length) v = breathAt(t - start - k * T, T, plan.breaths[k]);
        else v = plan.flatAfter ? 0 : plan.breaths[plan.breaths.length - 1].base;
      }
      if (plan.cpr) v += plan.cpr.amp * (0.5 + 0.5 * Math.sin(2 * Math.PI * plan.cpr.hz * t));
      v += (noise() - 0.5) * 0.5;
      y.push(r2(Math.max(0, v)));
    }
    // breaths fully or partly inside the window
    marks = marks.filter(function (m) { return m.t0 < sec; });
    var seen = marks.filter(function (m) { return m.t0 + m.T * 0.6 < sec; });
    var et = plan.flatAfter && endPlan < sec - 2 ? 0 : seen.length ? Math.round(seen[seen.length - 1].peak) : 0;
    return { kind: "capno", pattern: id, seed: seed, fs: FS, sec: sec, unit: "mmHg", y: y, breaths: marks, etco2: et,
      rr: plan.flatAfter && endPlan < sec - 2 ? 0 : plan.rr, trend: plan.trend || null };
  }

  /* ---------- measured features (tests and screen-reader text use these, never the recipe) ---------- */
  function features(sig) {
    var y = sig.y, fs = sig.fs, n = y.length, sorted = y.slice().sort(function (a, b) { return a - b; });
    var base = sorted[Math.floor(n * 0.05)], max = sorted[n - 1], segs = [], on = false, s0 = 0, i;
    for (i = 0; i < n; i++) {
      if (!on && y[i] > base + 4) { on = true; s0 = i; }
      else if (on && y[i] < base + 2.5) { on = false; segs.push([s0, i]); }
    }
    if (on) segs.push([s0, n]);
    // join pieces split by ripples or a cleft (gaps under 0.6 s)
    var joined = [];
    segs.forEach(function (sg) { var p = joined[joined.length - 1]; if (p && sg[0] - p[1] < 0.6 * fs) p[1] = sg[1]; else joined.push([sg[0], sg[1]]); });
    var breaths = joined.map(function (sg) {
      var a = sg[0], b = sg[1], pk = a, j;
      for (j = a; j < b; j++) if (y[j] > y[pk]) pk = j;
      var peak = y[pk], i90 = a;
      while (i90 < pk && y[i90] < 0.9 * peak) i90++;
      // cleft: the deepest dip below the running maximum between the 90% point and the peak
      var run = 0, dip = 0;
      for (j = i90; j <= pk; j++) { if (y[j] > run) run = y[j]; if (run - y[j] > dip) dip = run - y[j]; }
      // ripples: rises of more than 1.2 mmHg after the peak
      var low = peak, high = peak, up = false, osc = 0;
      for (j = pk + 1; j < b; j++) {
        if (up) { if (y[j] > high) high = y[j]; else if (high - y[j] > 1.2) { up = false; low = y[j]; } }
        else { if (y[j] < low) low = y[j]; else if (y[j] - low > 1.2) { up = true; osc++; high = y[j]; } }
      }
      return { start: a / fs, end: b / fs, peak: peak, upslope: pk > a ? (i90 - a) / (pk - a) : 0, dip: r2(dip), ripples: osc };
    }).filter(function (b) { return b.peak >= 6 && b.end - b.start > 0.5 && b.start > 0 && b.end < n / fs; }); // whole breaths only
    var tail = 0;
    for (i = n - 1; i >= 0 && y[i] < 2; i--) tail++;
    return { baseline: r2(base), max: max, breaths: breaths, flatTail: r2(tail / fs) };
  }
  function median(a) { var s = a.slice().sort(function (x, z) { return x - z; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }

  /* ================= monitor scenarios ================= */
  // rhythm: sinus | tachy | brady | vt | vf | asystole. co2: capnogram pattern and EtCO2/RR overrides, or null when no
  // capnograph is attached (awake patient). pleth: amplitude (perfusion) and respiratory swing. Ranges are illustrative.
  var SCEN = {
    normal: { rhythm: "sinus", hr: [64, 84], spo2: [97, 99], sys: [110, 128], dia: [64, 78], pleth: [0.9, 0.05], co2: { shape: "normal", et: [34, 39], rr: [10, 12], trend: "flat" } },
    hypovolaemia: { rhythm: "tachy", hr: [118, 134], spo2: [96, 99], sys: [76, 88], dia: [42, 52], pleth: [0.38, 0.35], co2: { shape: "normal", et: [26, 30], rr: [10, 12], trend: "drift" } },
    anaphylaxis: { rhythm: "tachy", hr: [126, 144], spo2: [87, 91], sys: [56, 68], dia: [28, 38], pleth: [0.22, 0.1], co2: { shape: "bronchospasm", et: [20, 25], rr: [10, 12], trend: "drop" } },
    bronchospasm: { rhythm: "tachy", hr: [102, 116], spo2: [87, 91], sys: [124, 140], dia: [72, 84], pleth: [0.7, 0.08], co2: { shape: "bronchospasm", et: [44, 50], rr: [10, 12], trend: "rise" } },
    highspinal: { rhythm: "brady", hr: [38, 46], spo2: [90, 93], sys: [66, 78], dia: [30, 40], pleth: [0.35, 0.05], co2: null },
    mh: { rhythm: "tachy", hr: [126, 140], spo2: [94, 96], sys: [136, 152], dia: [80, 92], pleth: [0.6, 0.05], co2: { shape: "normal", et: [64, 76], rr: [17, 20], trend: "mh" } },
    last: { rhythm: "vt", hr: [168, 188], spo2: [89, 93], sys: [70, 82], dia: [40, 48], pleth: [0.18, 0.04], co2: null },
    tension: { rhythm: "tachy", hr: [124, 140], spo2: [82, 87], sys: [68, 80], dia: [38, 48], pleth: [0.28, 0.25], co2: { shape: "normal", et: [19, 24], rr: [12, 14], trend: "drop" } },
    vf: { rhythm: "vf", co2: { shape: "falling", et: [4, 8], rr: [12, 12], trend: "arrest" } },
    asystole: { rhythm: "asystole", co2: { shape: "falling", et: [3, 6], rr: [12, 12], trend: "arrest" } }
  };

  var EFS = 125, ESEC = 8, PFS = 50;
  function gauss(x, c, w) { return Math.exp(-Math.pow((x - c) / w, 2)); }
  function beatTimes(r, hr, sec, jitter) {
    var out = [], rr = 60 / hr, t = between(r, 0.15, rr);
    while (t < sec + 1) { out.push(t); t += rr * (1 + between(r, -jitter, jitter)); }
    return out;
  }
  function ecg(rhythm, hr, r) {
    var n = EFS * ESEC, y = [], i, t, v, k, beats = [], noise = rng(Math.floor(r() * 1e9));
    if (rhythm === "sinus" || rhythm === "tachy" || rhythm === "brady") beats = beatTimes(r, hr, ESEC, 0.02);
    if (rhythm === "vt") beats = beatTimes(r, hr, ESEC, 0.005);
    var f = [between(r, 4, 4.6), between(r, 5, 5.6), between(r, 6, 6.6)], ph = [r() * 6.28, r() * 6.28, r() * 6.28], env = between(r, 0.25, 0.45);
    for (i = 0; i < n; i++) {
      t = i / EFS; v = 0;
      if (rhythm === "vf") v = 0.32 * (0.6 + 0.4 * Math.sin(2 * Math.PI * env * t)) * (Math.sin(2 * Math.PI * f[0] * t + ph[0]) + 0.6 * Math.sin(2 * Math.PI * f[1] * t + ph[1]) + 0.4 * Math.sin(2 * Math.PI * f[2] * t + ph[2]));
      else if (rhythm === "asystole") v = 0.03 * Math.sin(2 * Math.PI * 0.3 * t);
      else for (k = 0; k < beats.length; k++) {
        var x = t - beats[k];
        if (x < -0.4 || x > 0.6) continue;
        if (rhythm === "vt") v += 1.0 * gauss(x, 0, 0.055) - 0.55 * gauss(x, 0.13, 0.06);
        else {
          var RR = 60 / hr, tc = 0.2 + 0.06 * RR;
          v += 0.12 * gauss(x, -0.17, 0.025) - 0.08 * gauss(x, -0.03, 0.008) + 1.0 * gauss(x, 0, 0.011) - 0.22 * gauss(x, 0.03, 0.01) + 0.28 * gauss(x, tc, 0.045);
        }
      }
      y.push(r2(v + (noise() - 0.5) * 0.02));
    }
    return { fs: EFS, sec: ESEC, y: y, beats: beats.filter(function (b) { return b < ESEC; }).map(r2) };
  }
  function pleth(rhythm, beats, amp, swing, r) {
    var n = PFS * ESEC, y = [], i, k, t, v, noise = rng(Math.floor(r() * 1e9)), tr = 60 / 12, ph = r() * 6.28;
    var pulsatile = rhythm !== "vf" && rhythm !== "asystole";
    for (i = 0; i < n; i++) {
      t = i / PFS; v = 0;
      if (pulsatile) for (k = 0; k < beats.length; k++) {
        var x = t - beats[k] - 0.22;
        if (x < 0 || x > 1.2) continue;
        var w = x < 0.12 ? Math.sin(Math.PI / 2 * x / 0.12) : Math.exp(-(x - 0.12) / 0.32) + 0.1 * gauss(x, 0.34, 0.04);
        v += amp * (1 + swing * Math.sin(2 * Math.PI * t / tr + ph)) * w;
      }
      y.push(r2(v + (noise() - 0.5) * 0.02));
    }
    return { fs: PFS, sec: ESEC, y: y };
  }
  var SHAPES = { normal: "normal", bronchospasm: "bronchospasm", falling: "falling" };
  function co2For(c, r, seed) {
    var et = between(r, c.et[0], c.et[1]), rr = Math.round(between(r, c.rr[0], c.rr[1]));
    var sig = capnogram(SHAPES[c.shape], seed, { et: et, rr: rr, from: between(r, 30, 34) });
    sig.etco2 = Math.round(et); sig.rr = rr;
    sig.trend = trendFor(c.trend, r, et);
    return sig;
  }
  function trendFor(kind, r, et) {
    var t = [], i, from;
    if (kind === "flat") return flatTrend(r, et);
    if (kind === "mh") { from = between(r, 36, 39); for (i = 0; i < 16; i++) t.push(Math.round(from + (et - from) * Math.pow(i / 15, 1.6))); return t; }
    if (kind === "rise") { from = et - between(r, 6, 9); for (i = 0; i < 16; i++) t.push(Math.round(i < 12 ? from : from + (et - from) * (i - 11) / 4)); return t; }
    if (kind === "drift") { from = et + between(r, 7, 10); for (i = 0; i < 16; i++) t.push(Math.round(from + (et - from) * i / 15)); return t; }
    if (kind === "drop" || kind === "arrest") {
      from = between(r, 34, 38); var k = kind === "arrest" ? 15 : 12 + Math.floor(r() * 2);
      for (i = 0; i < 16; i++) t.push(Math.round(i < k ? from + between(r, -1, 1) : i === k ? (from + et) / 2 : et));
      if (kind === "arrest") t[15] = Math.round(et);
      return t;
    }
    return null;
  }
  function monitor(id, seed) {
    var sc = SCEN[id];
    if (!sc) return null;
    var r = rng(seed), hr = sc.hr ? Math.round(between(r, sc.hr[0], sc.hr[1])) : null;
    var e = ecg(sc.rhythm, hr || 60, r);
    var p = pleth(sc.rhythm, e.beats, sc.pleth ? sc.pleth[0] : 0, sc.pleth ? sc.pleth[1] : 0, r);
    var co2 = sc.co2 ? co2For(sc.co2, r, +seed + 104729) : null;
    var sys = sc.sys ? Math.round(between(r, sc.sys[0], sc.sys[1])) : null, dia = sc.dia ? Math.round(between(r, sc.dia[0], sc.dia[1])) : null;
    return { kind: "monitor", scenario: id, seed: seed, rhythm: sc.rhythm, ecg: e, pleth: p, co2: co2,
      nums: { hr: hr, spo2: sc.spo2 ? Math.round(between(r, sc.spo2[0], sc.spo2[1])) : null, sys: sys, dia: dia,
        map: sys != null ? Math.round(dia + (sys - dia) / 3) : null, etco2: co2 ? co2.etco2 : null, rr: co2 ? co2.rr : null },
      trend: co2 ? co2.trend : null };
  }
  // QRS width (s) of the first beat: time the trace stays above half the R height. Tests use it to tell VT from sinus.
  function qrsWidth(e) {
    if (!e.beats.length) return 0;
    var y = e.y, c = Math.round(e.beats[0] * e.fs), hi = 0, j, a, b;
    if (c < 1) c = Math.round(e.beats[1] * e.fs);
    for (j = c - 5; j <= c + 5; j++) if (y[j] > hi) hi = y[j];
    for (a = c; a > 0 && y[a] > hi / 2; a--) {}
    for (b = c; b < y.length && y[b] > hi / 2; b++) {}
    return (b - a) / e.fs;
  }
  // Heart rate counted from R peaks in the trace (local maxima above 0.6).
  function measuredRate(e) {
    var y = e.y, pk = [], i;
    for (i = 1; i < y.length - 1; i++) if (y[i] > 0.6 && y[i] >= y[i - 1] && y[i] > y[i + 1] && (!pk.length || i - pk[pk.length - 1] > 0.2 * e.fs)) pk.push(i);
    if (pk.length < 2) return 0;
    return Math.round(60 * (pk.length - 1) / ((pk[pk.length - 1] - pk[0]) / e.fs));
  }

  /* ================= screen-reader descriptions (from measured features, never the answer's name) ================= */
  var SR = {
    en: {
      capno: "Capnogram, {s} seconds, CO2 in mmHg.", nBreaths: "{n} breaths.", none: "No breaths are seen.",
      heights: "Breath heights about {a} to {b} mmHg.", height: "Breath height about {a} mmHg.",
      fall: "Heights fall from about {a} to {b} mmHg.", rise: "Heights jump from about {a} to {b} mmHg.",
      zero: "The baseline returns to zero.", raised: "The baseline stays raised, about {b} mmHg.",
      slow: "Each breath rises slowly and its top keeps sloping up.", square: "Each breath rises steeply to a nearly flat top.",
      dip: "A notch dips into the top of {n} breaths.", ripple: "Small regular ripples follow the top of {n} breaths.",
      flat: "The trace is flat for the last {s} seconds.", trendUp: "The 15 minute trend climbs from {a} to {b}.",
      trendDown: "The 15 minute trend falls from {a} to {b}.", trendFlat: "The 15 minute trend is steady near {a}.",
      ecg: { sinus: "ECG: regular narrow complexes.", tachy: "ECG: fast regular narrow complexes.", brady: "ECG: slow regular narrow complexes.",
        vt: "ECG: fast regular broad complexes.", vf: "ECG: chaotic irregular waves, no clear complexes.", asystole: "ECG: an almost flat line." },
      nums: "Heart rate {hr}. SpO2 {sp}. Blood pressure {bp}.", dash: "not shown",
      pl: { big: "Pleth: tall pulse waves.", small: "Pleth: small pulse waves.", swing: "Pleth: small pulse waves that swing with each breath.", flat: "Pleth: no pulse waves." },
      noCo2: "No capnograph is attached."
    },
    hi: {
      capno: "कैपनोग्राम, {s} सेकंड, CO2 mmHg में।", nBreaths: "{n} साँसें।", none: "कोई साँस नहीं दिखती।",
      heights: "साँसों की ऊँचाई लगभग {a} से {b} mmHg।", height: "साँस की ऊँचाई लगभग {a} mmHg।",
      fall: "ऊँचाई लगभग {a} से गिरकर {b} mmHg होती है।", rise: "ऊँचाई लगभग {a} से उछलकर {b} mmHg होती है।",
      zero: "बेसलाइन शून्य पर लौटती है।", raised: "बेसलाइन ऊपर रहती है, लगभग {b} mmHg।",
      slow: "हर साँस धीरे उठती है और उसका ऊपरी हिस्सा ऊपर की ओर झुकता रहता है।", square: "हर साँस तेज़ी से उठकर लगभग सपाट ऊपरी हिस्से तक जाती है।",
      dip: "{n} साँसों के ऊपरी हिस्से में एक गड्ढा है।", ripple: "{n} साँसों के ऊपरी हिस्से के बाद छोटी नियमित लहरें हैं।",
      flat: "आख़िरी {s} सेकंड ट्रेस सपाट है।", trendUp: "15 मिनट का ट्रेंड {a} से बढ़कर {b} होता है।",
      trendDown: "15 मिनट का ट्रेंड {a} से गिरकर {b} होता है।", trendFlat: "15 मिनट का ट्रेंड लगभग {a} पर स्थिर है।",
      ecg: { sinus: "ECG: नियमित संकरे कॉम्प्लेक्स।", tachy: "ECG: तेज़ नियमित संकरे कॉम्प्लेक्स।", brady: "ECG: धीमे नियमित संकरे कॉम्प्लेक्स।",
        vt: "ECG: तेज़ नियमित चौड़े कॉम्प्लेक्स।", vf: "ECG: अव्यवस्थित अनियमित तरंगें, कोई साफ़ कॉम्प्लेक्स नहीं।", asystole: "ECG: लगभग सपाट रेखा।" },
      nums: "हृदय गति {hr}। SpO2 {sp}। ब्लड प्रेशर {bp}।", dash: "नहीं दिख रहा",
      pl: { big: "Pleth: ऊँची नाड़ी तरंगें।", small: "Pleth: छोटी नाड़ी तरंगें।", swing: "Pleth: छोटी नाड़ी तरंगें जो हर साँस के साथ ऊपर नीचे होती हैं।", flat: "Pleth: कोई नाड़ी तरंग नहीं।" },
      noCo2: "कोई कैपनोग्राफ़ नहीं लगा है।"
    }
  };
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] == null ? m : o[k]; }); }
  function trendLine(t, W) {
    if (!t) return "";
    var a = t[0], b = t[t.length - 1];
    return " " + fmt(b - a >= 5 ? W.trendUp : a - b >= 5 ? W.trendDown : W.trendFlat, { a: a, b: b });
  }
  function describeCapno(sig, lang) {
    var W = SR[lang === "hi" ? "hi" : "en"], f = features(sig), b = f.breaths, out = [fmt(W.capno, { s: sig.sec })];
    if (!b.length) out.push(W.none);
    else {
      out.push(fmt(W.nBreaths, { n: b.length }));
      var pk = b.map(function (x) { return Math.round(x.peak); }), lo = Math.min.apply(null, pk), hi = Math.max.apply(null, pk);
      if (hi - lo < 6) out.push(lo === hi ? fmt(W.height, { a: lo }) : fmt(W.heights, { a: lo, b: hi }));
      else if (pk[0] > pk[pk.length - 1]) out.push(fmt(W.fall, { a: pk[0], b: pk[pk.length - 1] }));
      else out.push(fmt(W.rise, { a: pk[0], b: pk[pk.length - 1] }));
      out.push(f.baseline > 3 ? fmt(W.raised, { b: Math.round(f.baseline) }) : W.zero);
      out.push(median(b.map(function (x) { return x.upslope; })) > 0.45 ? W.slow : W.square);
      var dips = b.filter(function (x) { return x.dip >= 4; }).length, rip = b.filter(function (x) { return x.ripples >= 2; }).length;
      if (dips) out.push(fmt(W.dip, { n: dips }));
      if (rip && !sig.trend && rip >= b.length / 2) out.push(fmt(W.ripple, { n: rip }));
    }
    if (f.flatTail >= 4) out.push(fmt(W.flat, { s: Math.round(f.flatTail) }));
    return out.join(" ") + trendLine(sig.trend, W);
  }
  function describeMonitor(m, lang) {
    var W = SR[lang === "hi" ? "hi" : "en"], n = m.nums, sc = SCEN[m.scenario], out = [W.ecg[m.rhythm]];
    out.push(fmt(W.nums, { hr: n.hr == null ? W.dash : n.hr, sp: n.spo2 == null ? W.dash : n.spo2 + "%", bp: n.sys == null ? W.dash : n.sys + "/" + n.dia }));
    out.push(!sc.pleth ? W.pl.flat : sc.pleth[1] >= 0.2 ? W.pl.swing : sc.pleth[0] >= 0.6 ? W.pl.big : W.pl.small);
    out.push(m.co2 ? describeCapno(m.co2, lang) : W.noCo2);
    return out.join(" ");
  }

  /* ================= teaching content (English and Hindi, review: ai_drafted) ================= */
  var CAPNO = {
    normal: { level: "mbbs", src: ["gravenstein", "morgan"],
      title: P("Normal capnogram", "सामान्य कैपनोग्राम"),
      scene: P("Ventilated adult under general anaesthesia, 20 minutes into surgery.", "सामान्य एनेस्थीसिया में वेंटिलेटेड वयस्क, सर्जरी के 20 मिनट बाद।"),
      describe: P("Square waves that rise steeply, stay nearly flat on top and return to zero between breaths.", "चौकोर तरंगें जो तेज़ी से उठती हैं, ऊपर लगभग सपाट रहती हैं और साँसों के बीच शून्य पर लौटती हैं।"),
      points: [
        P("Phase I is dead space gas with no CO2. Phase II is the steep rise as alveolar gas arrives.", "फ़ेज़ I डेड स्पेस गैस है जिसमें CO2 नहीं होती। फ़ेज़ II तेज़ चढ़ाव है जब एल्वियोलर गैस पहुँचती है।"),
        P("Phase III is the nearly flat alveolar plateau. Its end value is the end-tidal CO2.", "फ़ेज़ III लगभग सपाट एल्वियोलर प्लेटो है। इसका अंतिम मान end-tidal CO2 है।"),
        P("Inspiration (phase 0) brings the trace straight back to a zero baseline.", "साँस अंदर लेने (फ़ेज़ 0) पर ट्रेस सीधे शून्य बेसलाइन पर लौटता है।"),
        P("Normal EtCO2 is about 35 to 45 mmHg, usually a few mmHg below arterial PaCO2.", "सामान्य EtCO2 लगभग 35 से 45 mmHg होता है, आमतौर पर धमनी PaCO2 से कुछ mmHg कम।")] },
    oesophageal: { level: "mbbs", src: ["kbArrest", "nap4", "morgan"],
      title: P("Oesophageal intubation", "ग्रासनली (oesophageal) इंट्यूबेशन"),
      scene: P("Seconds after tracheal intubation. The tube is connected and ventilation starts.", "ट्रेकियल इंट्यूबेशन के कुछ सेकंड बाद। ट्यूब जोड़ी गई और वेंटिलेशन शुरू हुआ।"),
      describe: P("A few small waves, each lower than the one before, then a flat line.", "कुछ छोटी तरंगें, हर एक पिछली से नीची, फिर सपाट रेखा।"),
      points: [
        P("A flat capnography trace means the tube is in the oesophagus until proven otherwise.", "सपाट कैपनोग्राफ़ी ट्रेस का मतलब है कि ट्यूब ग्रासनली में है, जब तक उल्टा साबित न हो।"),
        P("Gas pushed into the stomach during mask ventilation can give a few early CO2 waves that fade.", "मास्क वेंटिलेशन में पेट में गई गैस से शुरू में कुछ CO2 तरंगें दिख सकती हैं जो मिट जाती हैं।"),
        P("Tracheal placement needs a sustained trace with a plateau, breath after breath.", "ट्रेकिया में सही स्थिति के लिए हर साँस पर प्लेटो वाला लगातार ट्रेस चाहिए।"),
        P("In NAP4, absent or misread capnography contributed to deaths from unrecognised oesophageal intubation.", "NAP4 में कैपनोग्राफ़ी न होने या गलत पढ़ने से, पहचान में न आए ग्रासनली इंट्यूबेशन से मौतें हुईं।"),
        P("If unsure, take the tube out and oxygenate by mask or supraglottic airway.", "संदेह हो तो ट्यूब निकालें और मास्क या सुप्राग्लॉटिक एयरवे से ऑक्सीजन दें।")] },
    bronchospasm: { level: "mbbs", src: ["morgan", "miller", "gravenstein"],
      title: P("Bronchospasm or COPD (shark fin)", "ब्रोंकोस्पाज़्म या COPD (शार्क फ़िन)"),
      scene: P("Ventilated adult, 10 minutes after intubation. Peak airway pressure has gone up.", "इंट्यूबेशन के 10 मिनट बाद वेंटिलेटेड वयस्क। पीक एयरवे प्रेशर बढ़ गया है।"),
      describe: P("A slow, curved rise with a top that keeps sloping upward: a shark fin.", "धीमा, घुमावदार चढ़ाव और ऊपरी हिस्सा लगातार ऊपर की ओर झुका हुआ: शार्क फ़िन।"),
      points: [
        P("Narrowed airways empty unevenly, so CO2 arrives slowly and phase III slopes upward.", "सिकुड़े वायुमार्ग असमान रूप से खाली होते हैं, इसलिए CO2 धीरे आती है और फ़ेज़ III ऊपर की ओर झुकता है।"),
        P("Causes include bronchospasm, COPD, a kinked or blocked tube and secretions.", "कारण: ब्रोंकोस्पाज़्म, COPD, मुड़ी या बंद ट्यूब, और स्राव (secretions)।"),
        P("With uneven emptying, EtCO2 can read well below the arterial PaCO2.", "असमान खाली होने पर EtCO2, धमनी PaCO2 से काफ़ी कम पढ़ सकता है।"),
        P("Check the tube and circuit first, then listen to the chest for wheeze.", "पहले ट्यूब और सर्किट जांचें, फिर छाती में wheeze सुनें।")] },
    curare: { level: "resident", src: ["morgan", "gravenstein"],
      title: P("Curare cleft", "क्यूरारे क्लेफ़्ट (curare cleft)"),
      scene: P("Ventilated adult near the end of surgery. The last relaxant dose was 50 minutes ago.", "सर्जरी के अंत के पास वेंटिलेटेड वयस्क। मांसपेशी शिथिलक की आख़िरी खुराक 50 मिनट पहले दी गई थी।"),
      describe: P("Normal waves with a notch that dips into the flat top of each breath.", "सामान्य तरंगें जिनमें हर साँस के सपाट ऊपरी हिस्से में एक गड्ढा (notch) है।"),
      points: [
        P("The cleft is a small spontaneous breath that draws in fresh gas during expiration.", "क्लेफ़्ट मरीज़ की अपनी छोटी साँस है जो साँस छोड़ने के दौरान ताज़ी गैस अंदर खींचती है।"),
        P("It means the diaphragm is moving: neuromuscular block is wearing off.", "इसका मतलब है कि डायाफ्राम हिल रहा है: न्यूरोमस्कुलर ब्लॉक ख़त्म हो रहा है।"),
        P("Check the depth of anaesthesia and the train-of-four count before deciding to redose.", "दोबारा खुराक देने से पहले एनेस्थीसिया की गहराई और train-of-four गिनती जांचें।"),
        P("Ripples at the heart rate are cardiogenic oscillations, a different and harmless sign.", "हृदय गति पर उठने वाली लहरें कार्डियोजेनिक ऑसिलेशन हैं, यह अलग और हानिरहित संकेत है।")] },
    rebreathing: { level: "mbbs", src: ["morgan", "miller"],
      title: P("Rebreathing", "दोबारा साँस लेना (rebreathing)"),
      scene: P("Ventilated adult on a circle system with low fresh gas flow, 2 hours into surgery.", "कम fresh gas flow के साथ सर्कल सिस्टम पर वेंटिलेटेड वयस्क, सर्जरी के 2 घंटे बाद।"),
      describe: P("Normal-shaped waves, but the baseline between breaths stays above zero.", "सामान्य आकार की तरंगें, लेकिन साँसों के बीच बेसलाइन शून्य से ऊपर रहती है।"),
      points: [
        P("A baseline above zero means the patient is breathing in CO2.", "शून्य से ऊपर बेसलाइन का मतलब है कि मरीज़ CO2 अंदर ले रहा है।"),
        P("Common causes are exhausted CO2 absorbent or a sticking unidirectional valve in the circle.", "आम कारण: ख़त्म हुआ CO2 absorbent या सर्कल का अटकता एक-दिशा वाल्व।"),
        P("In Mapleson circuits, fresh gas flow that is too low causes rebreathing.", "Mapleson सर्किट में बहुत कम fresh gas flow से rebreathing होती है।"),
        P("Raise the fresh gas flow, then check the absorbent colour and the valves.", "fresh gas flow बढ़ाएँ, फिर absorbent का रंग और वाल्व जांचें।")] },
    disconnect: { level: "mbbs", src: ["morgan", "miller"],
      title: P("Disconnection or apnoea", "सर्किट अलग होना या एप्निया"),
      scene: P("Ventilated adult. The team is turning the patient's head for surgical access.", "वेंटिलेटेड वयस्क। सर्जरी के लिए टीम मरीज़ का सिर घुमा रही है।"),
      describe: P("Normal waves that suddenly stop, after which the trace stays flat at zero.", "सामान्य तरंगें जो अचानक रुक जाती हैं, जिसके बाद ट्रेस शून्य पर सपाट रहता है।"),
      points: [
        P("A sudden flat trace means no exhaled CO2 reaches the sampler.", "अचानक सपाट ट्रेस का मतलब है कि छोड़ी गई CO2 सैंपलर तक नहीं पहुँच रही।"),
        P("Think of disconnection, accidental extubation, complete obstruction, ventilator failure or apnoea.", "सर्किट का अलग होना, गलती से extubation, पूरी रुकावट, वेंटिलेटर की खराबी या एप्निया सोचें।"),
        P("Look at the patient and the circuit, and ventilate by hand with oxygen.", "मरीज़ और सर्किट देखें, और हाथ से ऑक्सीजन के साथ वेंटिलेट करें।"),
        P("SpO2 falls only later, so the capnograph gives the earliest warning.", "SpO2 बाद में गिरता है, इसलिए कैपनोग्राफ़ सबसे पहले चेतावनी देता है।"),
        P("A blocked or kinked sampling line can look the same; check it once the patient is safe.", "बंद या मुड़ी सैंपलिंग लाइन भी ऐसी दिख सकती है; मरीज़ सुरक्षित होने पर उसे जांचें।")] },
    mh: { level: "resident", src: ["kbMH", "miller"],
      title: P("Rising EtCO2: malignant hyperthermia", "बढ़ता EtCO2: मैलिग्नेंट हाइपरथर्मिया"),
      scene: P("Ventilated adult on sevoflurane after suxamethonium. Minute ventilation has already been doubled.", "suxamethonium के बाद sevoflurane पर वेंटिलेटेड वयस्क। मिनट वेंटिलेशन पहले ही दोगुना किया जा चुका है।"),
      describe: P("Normal-shaped waves at a high level, and a trend that keeps climbing over 15 minutes.", "ऊँचे स्तर पर सामान्य आकार की तरंगें, और ट्रेंड जो 15 मिनट में लगातार बढ़ रहा है।"),
      points: [
        P("Unexplained rising EtCO2 despite increased ventilation is an early sign of malignant hyperthermia.", "बढ़े वेंटिलेशन के बावजूद बिना कारण बढ़ता EtCO2 मैलिग्नेंट हाइपरथर्मिया का शुरुआती संकेत है।"),
        P("Look for tachycardia, rigidity or masseter spasm, and mixed acidosis. Fever comes late.", "टैकीकार्डिया, अकड़न या masseter spasm, और मिश्रित acidosis देखें। बुखार देर से आता है।"),
        P("Stop volatile agents, hyperventilate with 100% oxygen and give dantrolene 2.5 mg/kg IV.", "volatile agents बंद करें, 100% ऑक्सीजन से hyperventilate करें और dantrolene 2.5 mg/kg IV दें।"),
        P("Rule out hypoventilation, rebreathing, laparoscopic CO2 absorption, sepsis and thyroid storm.", "hypoventilation, rebreathing, लेप्रोस्कोपिक CO2 अवशोषण, sepsis और thyroid storm को बाहर करें।")] },
    falling: { level: "resident", src: ["miller", "morgan", "gravenstein"],
      title: P("Sudden fall: low cardiac output or embolism", "अचानक गिरावट: कम कार्डियक आउटपुट या एम्बोलिज़्म"),
      scene: P("Ventilated adult, prone for spine surgery. The ventilator settings have not changed.", "स्पाइन सर्जरी के लिए प्रोन स्थिति में वेंटिलेटेड वयस्क। वेंटिलेटर सेटिंग्स नहीं बदलीं।"),
      describe: P("Waves keep a normal shape but drop sharply in height within a few breaths.", "तरंगों का आकार सामान्य रहता है लेकिन कुछ ही साँसों में ऊँचाई तेज़ी से गिरती है।"),
      points: [
        P("EtCO2 depends on CO2 production, lung blood flow and ventilation.", "EtCO2, CO2 बनने, फेफड़ों के रक्त प्रवाह और वेंटिलेशन पर निर्भर करता है।"),
        P("A sudden fall with unchanged ventilation means less blood is reaching the lungs.", "वेंटिलेशन वही रहते हुए अचानक गिरावट का मतलब है कि फेफड़ों तक कम रक्त पहुँच रहा है।"),
        P("Think of severe hypotension, cardiac arrest, or embolism of thrombus, air, fat or CO2.", "गंभीर hypotension, कार्डियक अरेस्ट, या thrombus, हवा, वसा या CO2 के एम्बोलिज़्म के बारे में सोचें।"),
        P("Check the pulse and blood pressure at once.", "तुरंत नाड़ी और ब्लड प्रेशर जांचें।"),
        P("A slow fall over hours suggests hyperventilation or hypothermia instead.", "घंटों में धीमी गिरावट इसके बजाय hyperventilation या hypothermia की ओर इशारा करती है।")] },
    cpr: { level: "mbbs", src: ["kbArrest", "gravenstein"],
      title: P("CPR, then ROSC", "CPR, फिर ROSC"),
      scene: P("Intubated adult in cardiac arrest. Chest compressions are in progress.", "कार्डियक अरेस्ट में इंट्यूबेटेड वयस्क। छाती दबाना (compressions) चल रहा है।"),
      describe: P("Low waves with small fast ripples, then a sudden jump to much taller waves.", "छोटी तेज़ लहरों के साथ नीची तरंगें, फिर अचानक बहुत ऊँची तरंगों पर छलांग।"),
      points: [
        P("During CPR, EtCO2 tracks the blood flow made by chest compressions.", "CPR के दौरान EtCO2 छाती दबाने से बने रक्त प्रवाह को दर्शाता है।"),
        P("Below 10 mmHg suggests poor CPR quality or a poor outlook. Improve the compressions.", "10 mmHg से कम खराब CPR गुणवत्ता या खराब परिणाम दर्शाता है। compressions सुधारें।"),
        P("Above 10, and ideally above 20 mmHg, is linked with return of circulation.", "10 से ऊपर, और आदर्श रूप से 20 mmHg से ऊपर, संचार लौटने से जुड़ा है।"),
        P("An abrupt, sustained rise suggests ROSC. Check for a pulse at the next rhythm check.", "अचानक और लगातार बढ़त ROSC का संकेत है। अगली rhythm check पर नाड़ी देखें।"),
        P("The small fast ripples come from chest compressions moving gas in the airway.", "छोटी तेज़ लहरें compressions से वायुमार्ग में गैस हिलने के कारण हैं।")] },
    cardiogenic: { level: "resident", src: ["gravenstein", "morgan"],
      title: P("Cardiogenic oscillations", "कार्डियोजेनिक ऑसिलेशन"),
      scene: P("Ventilated adult at a slow rate of 8 breaths a minute, at the end of surgery.", "सर्जरी के अंत में 8 साँस प्रति मिनट की धीमी दर पर वेंटिलेटेड वयस्क।"),
      describe: P("Small regular ripples on the falling end of each breath, at the pace of the heartbeat.", "हर साँस के गिरते हिस्से पर छोटी नियमित लहरें, धड़कन की गति से।"),
      points: [
        P("Each heartbeat squeezes the lungs and moves a little gas past the sampler.", "हर धड़कन फेफड़ों को दबाती है और थोड़ी गैस सैंपलर के पास से हिलती है।"),
        P("They show when expiratory flow is low: slow rates and long expiratory pauses.", "ये तब दिखती हैं जब साँस छोड़ने का प्रवाह कम हो: धीमी दर और लंबा expiratory ठहराव।"),
        P("They are harmless and need no treatment.", "ये हानिरहित हैं और इलाज की ज़रूरत नहीं।"),
        P("Count them against the ECG: their rate matches the heart rate.", "ECG से गिनें: इनकी दर हृदय गति के बराबर है।"),
        P("A curare cleft is one dip per breath in the plateau, not a run of ripples.", "curare cleft प्लेटो में हर साँस पर एक गड्ढा है, लहरों की कतार नहीं।")] }
  };

  var MONITOR = {
    normal: { level: "mbbs", src: ["morgan", "miller"],
      title: P("Stable, no crisis", "स्थिर, कोई संकट नहीं"),
      scene: P("Healthy adult under general anaesthesia, 30 minutes into an uneventful operation.", "सामान्य एनेस्थीसिया में स्वस्थ वयस्क, बिना घटना वाले ऑपरेशन के 30 मिनट बाद।"),
      describe: P("Regular narrow complexes, a clear pleth with a notch, normal blood pressure and a normal capnogram.", "नियमित संकरे कॉम्प्लेक्स, notch वाला साफ़ pleth, सामान्य ब्लड प्रेशर और सामान्य कैपनोग्राम।"),
      points: [
        P("Read every channel and check that they agree with each other.", "हर चैनल पढ़ें और देखें कि वे आपस में मेल खाते हैं।"),
        P("The pleth rate should match the ECG rate. A mismatch suggests artefact or poor perfusion.", "pleth की दर ECG की दर से मेल खानी चाहिए। मेल न हो तो artefact या कम perfusion हो सकता है।"),
        P("A clear pleth with a dicrotic notch suggests good peripheral perfusion.", "dicrotic notch वाला साफ़ pleth अच्छे peripheral perfusion का संकेत है।"),
        P("Trends matter more than one reading. Look at the last 15 minutes.", "एक रीडिंग से ज़्यादा ट्रेंड मायने रखता है। पिछले 15 मिनट देखें।")] },
    hypovolaemia: { level: "mbbs", src: ["miller", "morgan"],
      title: P("Hypovolaemia", "हाइपोवोलेमिया"),
      scene: P("Laparotomy for trauma. Suction shows heavy blood loss over the last 20 minutes.", "ट्रॉमा के लिए लैपरोटॉमी। सक्शन में पिछले 20 मिनट में भारी रक्तस्राव दिखता है।"),
      describe: P("Fast narrow complexes, a small pleth that swings with ventilation, low blood pressure and EtCO2 drifting down.", "तेज़ संकरे कॉम्प्लेक्स, वेंटिलेशन के साथ ऊपर नीचे होता छोटा pleth, कम ब्लड प्रेशर और धीरे गिरता EtCO2।"),
      points: [
        P("Tachycardia with hypotension after blood loss points to hypovolaemia.", "रक्तस्राव के बाद hypotension के साथ टैकीकार्डिया हाइपोवोलेमिया की ओर इशारा करता है।"),
        P("A small pleth that swings with each ventilated breath suggests the patient may respond to fluid.", "हर वेंटिलेटेड साँस के साथ ऊपर नीचे होता छोटा pleth बताता है कि मरीज़ fluid से सुधर सकता है।"),
        P("EtCO2 drifts down as cardiac output falls, with ventilation unchanged.", "वेंटिलेशन वही रहते हुए कार्डियक आउटपुट गिरने से EtCO2 धीरे गिरता है।"),
        P("Control the bleeding, give warmed fluid and blood, and call for help early.", "रक्तस्राव रोकें, गर्म fluid और रक्त दें, और जल्दी मदद बुलाएँ।")] },
    anaphylaxis: { level: "mbbs", src: ["kbAnaph", "miller"],
      title: P("Anaphylaxis", "एनाफिलेक्सिस"),
      scene: P("Five minutes after an IV antibiotic at induction. No rash is seen.", "इंडक्शन पर IV एंटीबायोटिक के पाँच मिनट बाद। कोई रैश नहीं दिखता।"),
      describe: P("Fast narrow complexes, very low blood pressure, a small pleth, falling SpO2 and a low shark fin capnogram.", "तेज़ संकरे कॉम्प्लेक्स, बहुत कम ब्लड प्रेशर, छोटा pleth, गिरता SpO2 और नीचा शार्क फ़िन कैपनोग्राम।"),
      points: [
        P("Sudden hypotension, tachycardia and bronchospasm after a drug suggest anaphylaxis, even without skin signs.", "किसी दवा के बाद अचानक hypotension, टैकीकार्डिया और ब्रोंकोस्पाज़्म एनाफिलेक्सिस दर्शाते हैं, त्वचा के लक्षण न हों तब भी।"),
        P("The shark fin shows bronchospasm. The low EtCO2 shows falling cardiac output.", "शार्क फ़िन ब्रोंकोस्पाज़्म दिखाता है। कम EtCO2 गिरता कार्डियक आउटपुट दिखाता है।"),
        P("Stop the suspected trigger and give 100% oxygen.", "संदिग्ध कारण (trigger) बंद करें और 100% ऑक्सीजन दें।"),
        P("Give adrenaline at once: IM 0.5 mg in adults, or IV 50 microgram boluses by experienced hands.", "तुरंत adrenaline दें: वयस्क में IM 0.5 mg, या अनुभवी हाथों से IV 50 microgram बोलस।"),
        P("Lie the patient flat and give a rapid IV fluid bolus.", "मरीज़ को सीधा लिटाएँ और तेज़ IV fluid बोलस दें।")] },
    bronchospasm: { level: "mbbs", src: ["miller", "morgan"],
      title: P("Bronchospasm", "ब्रोंकोस्पाज़्म"),
      scene: P("Adult with asthma, just intubated under light anaesthesia. Airway pressure is high.", "अस्थमा वाला वयस्क, हल्के एनेस्थीसिया में अभी इंट्यूबेट हुआ। एयरवे प्रेशर ऊँचा है।"),
      describe: P("Fast narrow complexes, normal blood pressure, falling SpO2 and a tall shark fin capnogram.", "तेज़ संकरे कॉम्प्लेक्स, सामान्य ब्लड प्रेशर, गिरता SpO2 और ऊँचा शार्क फ़िन कैपनोग्राम।"),
      points: [
        P("A shark fin capnogram with high airway pressure and falling SpO2 suggests bronchospasm.", "ऊँचे एयरवे प्रेशर और गिरते SpO2 के साथ शार्क फ़िन कैपनोग्राम ब्रोंकोस्पाज़्म दर्शाता है।"),
        P("Common triggers are airway instrumentation under light anaesthesia, asthma and anaphylaxis.", "आम कारण: हल्के एनेस्थीसिया में एयरवे पर काम, अस्थमा और एनाफिलेक्सिस।"),
        P("First rule out a kinked or blocked tube and endobronchial intubation.", "पहले मुड़ी या बंद ट्यूब और endobronchial इंट्यूबेशन को बाहर करें।"),
        P("Give 100% oxygen, deepen anaesthesia and give an inhaled bronchodilator such as salbutamol.", "100% ऑक्सीजन दें, एनेस्थीसिया गहरा करें और salbutamol जैसा inhaled bronchodilator दें।"),
        P("Blood pressure is normal here, which points away from anaphylaxis.", "यहाँ ब्लड प्रेशर सामान्य है, जो एनाफिलेक्सिस के विरुद्ध इशारा करता है।")] },
    highspinal: { level: "mbbs", src: ["morgan", "miller"],
      title: P("High spinal block", "हाई स्पाइनल ब्लॉक"),
      scene: P("Caesarean section under spinal anaesthesia. The mother says her hands feel weak.", "स्पाइनल एनेस्थीसिया में सिज़ेरियन। माँ कहती हैं कि उनके हाथ कमज़ोर लग रहे हैं।"),
      describe: P("Slow narrow complexes, low blood pressure, a small pleth and SpO2 starting to fall. No capnograph is attached.", "धीमे संकरे कॉम्प्लेक्स, कम ब्लड प्रेशर, छोटा pleth और गिरना शुरू करता SpO2। कोई कैपनोग्राफ़ नहीं लगा।"),
      points: [
        P("A block reaching T1 to T4 blocks the cardiac accelerator fibres and causes bradycardia.", "T1 से T4 तक पहुँचा ब्लॉक cardiac accelerator fibres को रोकता है और bradycardia करता है।"),
        P("The wide sympathetic block also causes vasodilatation and hypotension.", "फैला हुआ sympathetic ब्लॉक vasodilatation और hypotension भी करता है।"),
        P("Weak hands, breathlessness and a weak voice mean the block is reaching cervical levels.", "कमज़ोर हाथ, साँस फूलना और कमज़ोर आवाज़ का मतलब है कि ब्लॉक cervical स्तर तक पहुँच रहा है।"),
        P("Give oxygen, a vasopressor and atropine. Support breathing and intubate if needed.", "ऑक्सीजन, vasopressor और atropine दें। साँस में मदद करें और ज़रूरत हो तो इंट्यूबेट करें।"),
        P("In pregnancy, keep the uterus displaced to the left.", "गर्भावस्था में गर्भाशय को बाईं ओर खिसकाकर रखें।")] },
    mh: { level: "resident", src: ["kbMH", "miller"],
      title: P("Malignant hyperthermia", "मैलिग्नेंट हाइपरथर्मिया"),
      scene: P("Ventilated adult on sevoflurane, 40 minutes into surgery. The absorbent canister feels hot.", "sevoflurane पर वेंटिलेटेड वयस्क, सर्जरी के 40 मिनट बाद। absorbent canister गर्म लग रहा है।"),
      describe: P("Fast narrow complexes, high blood pressure and an EtCO2 trend climbing despite fast ventilation.", "तेज़ संकरे कॉम्प्लेक्स, ऊँचा ब्लड प्रेशर और तेज़ वेंटिलेशन के बावजूद बढ़ता EtCO2 ट्रेंड।"),
      points: [
        P("Unexplained rising EtCO2 despite increased ventilation is an early sign of malignant hyperthermia.", "बढ़े वेंटिलेशन के बावजूद बिना कारण बढ़ता EtCO2 मैलिग्नेंट हाइपरथर्मिया का शुरुआती संकेत है।"),
        P("A hot absorbent canister reflects very high CO2 production.", "गर्म absorbent canister बहुत ज़्यादा CO2 बनने को दर्शाता है।"),
        P("Inappropriate tachycardia, ectopics and unstable blood pressure are common. Fever comes late.", "अनुचित टैकीकार्डिया, ectopics और अस्थिर ब्लड प्रेशर आम हैं। बुखार देर से आता है।"),
        P("Stop volatile agents, hyperventilate with 100% oxygen and give dantrolene 2.5 mg/kg IV.", "volatile agents बंद करें, 100% ऑक्सीजन से hyperventilate करें और dantrolene 2.5 mg/kg IV दें।")] },
    last: { level: "resident", src: ["kbLAST"],
      title: P("Local anaesthetic systemic toxicity (LAST)", "लोकल एनेस्थेटिक सिस्टेमिक टॉक्सिसिटी (LAST)"),
      scene: P("Two minutes after a large-volume interscalene block, the patient had a seizure.", "बड़ी मात्रा वाले interscalene ब्लॉक के दो मिनट बाद मरीज़ को दौरा पड़ा।"),
      describe: P("Fast regular broad complexes, low blood pressure and a small pleth. No capnograph is attached.", "तेज़ नियमित चौड़े कॉम्प्लेक्स, कम ब्लड प्रेशर और छोटा pleth। कोई कैपनोग्राफ़ नहीं लगा।"),
      points: [
        P("A seizure, then an arrhythmia, after a local anaesthetic injection is LAST until proven otherwise.", "लोकल एनेस्थेटिक इंजेक्शन के बाद दौरा, फिर arrhythmia, LAST है जब तक उल्टा साबित न हो।"),
        P("Early hypertension and tachycardia give way to bradycardia, conduction block, ventricular arrhythmias and asystole.", "शुरू का hypertension और टैकीकार्डिया बाद में bradycardia, conduction block, ventricular arrhythmia और asystole में बदलता है।"),
        P("Stop injecting, call for help, give 100% oxygen and treat seizures with a benzodiazepine.", "इंजेक्शन रोकें, मदद बुलाएँ, 100% ऑक्सीजन दें और दौरे का इलाज benzodiazepine से करें।"),
        P("Give 20% lipid emulsion early: 1.5 mL/kg over 1 minute, then 15 mL/kg/h.", "20% lipid emulsion जल्दी दें: 1.5 mL/kg 1 मिनट में, फिर 15 mL/kg/h।"),
        P("In arrest, use small adrenaline doses and avoid vasopressin and lidocaine.", "अरेस्ट में adrenaline की छोटी खुराक दें और vasopressin तथा lidocaine से बचें।")] },
    tension: { level: "resident", src: ["atls", "miller"],
      title: P("Tension pneumothorax", "टेंशन न्यूमोथोरैक्स"),
      scene: P("Ventilated adult just after a right subclavian central line. Airway pressure is rising.", "दाहिनी subclavian central line के ठीक बाद वेंटिलेटेड वयस्क। एयरवे प्रेशर बढ़ रहा है।"),
      describe: P("Fast narrow complexes, low blood pressure, low SpO2, a small swinging pleth and EtCO2 falling.", "तेज़ संकरे कॉम्प्लेक्स, कम ब्लड प्रेशर, कम SpO2, छोटा ऊपर नीचे होता pleth और गिरता EtCO2।"),
      points: [
        P("Rising airway pressure, falling SpO2 and hypotension after a central line suggest tension pneumothorax.", "central line के बाद बढ़ता एयरवे प्रेशर, गिरता SpO2 और hypotension टेंशन न्यूमोथोरैक्स दर्शाते हैं।"),
        P("Positive pressure ventilation can quickly turn a small pneumothorax into a tension one.", "positive pressure वेंटिलेशन छोटे न्यूमोथोरैक्स को जल्दी टेंशन न्यूमोथोरैक्स बना सकता है।"),
        P("Listen for absent breath sounds on one side. Tracheal deviation is a late sign.", "एक तरफ़ साँस की आवाज़ न होना सुनें। ट्रेकिया का खिसकना देर का संकेत है।"),
        P("The diagnosis is clinical. Do not wait for an X-ray.", "निदान क्लिनिकल है। X-ray का इंतज़ार न करें।"),
        P("Decompress the chest at once, then insert a chest drain.", "तुरंत छाती को decompress करें, फिर chest drain लगाएँ।")] },
    vf: { level: "mbbs", src: ["kbArrest"],
      title: P("Cardiac arrest: VF", "कार्डियक अरेस्ट: VF"),
      scene: P("Ventilated adult during surgery. All alarms sound and no carotid pulse is felt.", "सर्जरी के दौरान वेंटिलेटेड वयस्क। सभी अलार्म बजते हैं और कैरोटिड नाड़ी नहीं मिलती।"),
      describe: P("Chaotic irregular waves with no clear complexes, a flat pleth, no blood pressure and EtCO2 collapsing.", "बिना साफ़ कॉम्प्लेक्स की अव्यवस्थित अनियमित तरंगें, सपाट pleth, कोई ब्लड प्रेशर नहीं और तेज़ी से गिरता EtCO2।"),
      points: [
        P("Chaotic waves with no complexes and no pulse is ventricular fibrillation.", "बिना कॉम्प्लेक्स की अव्यवस्थित तरंगें और नाड़ी न होना ventricular fibrillation है।"),
        P("Start CPR and defibrillate as soon as possible, with minimal pauses.", "CPR शुरू करें और जितनी जल्दी हो सके defibrillate करें, कम से कम रुकावट के साथ।"),
        P("If shocks fail, give adrenaline 1 mg every 3 to 5 minutes, and amiodarone.", "शॉक असफल हों तो हर 3 से 5 मिनट पर adrenaline 1 mg, और amiodarone दें।"),
        P("Check the patient as well as the leads: movement and loose leads can mimic VF.", "लीड के साथ मरीज़ को भी जांचें: हिलना और ढीली लीड VF जैसी दिख सकती हैं।")] },
    asystole: { level: "mbbs", src: ["kbArrest", "miller"],
      title: P("Cardiac arrest: asystole", "कार्डियक अरेस्ट: एसिस्टोली"),
      scene: P("Adult under anaesthesia during laparoscopic gas insufflation. No pulse is felt.", "लेप्रोस्कोपिक गैस भरने के दौरान एनेस्थीसिया में वयस्क। नाड़ी नहीं मिलती।"),
      describe: P("An almost flat ECG, a flat pleth, no blood pressure and EtCO2 collapsing.", "लगभग सपाट ECG, सपाट pleth, कोई ब्लड प्रेशर नहीं और तेज़ी से गिरता EtCO2।"),
      points: [
        P("Confirm it: check the leads, the gain and a second lead before calling asystole.", "पक्का करें: एसिस्टोली कहने से पहले लीड, gain और दूसरी लीड जांचें।"),
        P("A flat ECG with no pulse is asystole, a non-shockable rhythm.", "नाड़ी के बिना सपाट ECG एसिस्टोली है, जिसमें शॉक नहीं दिया जाता।"),
        P("Start CPR and give adrenaline 1 mg as soon as possible.", "CPR शुरू करें और जितनी जल्दी हो सके adrenaline 1 mg दें।"),
        P("Treat the cause. In laparoscopy, stop insufflation and release the gas, as vagal stretch can cause asystole.", "कारण का इलाज करें। लेप्रोस्कोपी में गैस भरना रोकें और गैस निकालें, क्योंकि vagal खिंचाव से एसिस्टोली हो सकती है।")] }
  };

  /* ---------- answer options: the truth plus three others from the same level's pool, ordered by the seed ---------- */
  function pool(set, level) {
    return Object.keys(set).filter(function (k) { return level === "resident" || set[k].level === "mbbs"; });
  }
  function options(kind, truth, seed, level) {
    var set = kind === "monitor" ? MONITOR : CAPNO, r = rng(+seed + 31), others = pool(set, level).filter(function (k) { return k !== truth; }), out = [truth], i, j, x;
    for (i = others.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); x = others[i]; others[i] = others[j]; others[j] = x; }
    out = out.concat(others.slice(0, 3));
    for (i = out.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); x = out[i]; out[i] = out[j]; out[j] = x; }
    return out;
  }

  return {
    id: "signals", kind: "signals", review: "ai_drafted",
    title: P("Teaching signals for the capnography and monitor clinics", "कैपनोग्राफ़ी और मॉनिटर क्लिनिक के शिक्षण सिग्नल"),
    sources: [SOURCES.gravenstein, SOURCES.morgan, SOURCES.miller],
    note: P("Synthetic teaching signals made by a seeded model. Not patient data.", "बीज (seed) वाले मॉडल से बने कृत्रिम शिक्षण सिग्नल। मरीज़ का डेटा नहीं।"),
    SOURCES: SOURCES, CAPNO: CAPNO, MONITOR: MONITOR, SCENARIOS: SCEN,
    rng: rng, capnogram: capnogram, monitor: monitor, features: features, qrsWidth: qrsWidth, measuredRate: measuredRate,
    describeCapno: describeCapno, describeMonitor: describeMonitor, options: options, pool: pool
  };
});
