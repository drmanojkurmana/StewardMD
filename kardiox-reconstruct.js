/* kardiox-reconstruct.js — KardioX AI · paper-ECG Reconstruction Layer (SMD_KARDIOX_RECONSTRUCT).
 *
 * Converts DIGITIZED paper-ECG lead traces (from the learned nnU-Net digitiser or the classical
 * OpenCV fallback) into the representation the EcgLib 10s x 12 ensemble expects — WITHOUT fabricating
 * data. Grounded in an adversarially-verified spec (PhysioNet/CinC-2024 conventions, PatchECG
 * NaN+mask policy). Additive: does NOT modify the ensemble, fusion, or ONNX provider.
 *
 * Core rules (verified):
 *  - A printed 12-lead ECG is ONE 10s acquisition sliced into column time-windows. 3x4 → 4 columns of
 *    2.5s: col c holds t=[c*2.5, (c+1)*2.5]s; 6x2 → 2 columns of 5s; 12x1 → every lead is a full 10s.
 *  - Place each lead's real samples at its TRUE start t=c*D (column-based). Leave the unprinted portion
 *    as NaN + mask=0 — NEVER zero-pad (0 mV is a real isoelectric value), interpolate (invents beats),
 *    or stitch columns (fabricates R-R intervals). The rhythm-strip lead (full continuous 10s) overwrites
 *    that lead's entire row.
 *  - Rhythm/rate → the continuous 10s rhythm strip only. Morphology/conduction → each lead's own window.
 *    Cross-lead simultaneity holds ONLY within a column (3x4: I/II/III share col0; frontal axis OK there).
 *  - A dense 10s x 12 signal EcgLib can validly consume exists ONLY when coverage is complete (12x1 /
 *    full-disclosure). For partial layouts toDense() returns null and the confidence gate warns — the
 *    ensemble is never fed fabricated data. Pure; no DOM/IO. node + browser.
 */
(function () {
  "use strict";

  var STD12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

  // Layout registry. leadColumns maps each lead → its 0-based column (time window index).
  var LAYOUTS = {
    "12x1":       { columns: 1, secondsPerCell: 10, order: STD12.slice(),
                    leadColumns: col(STD12, 1) },
    "6x2":        { columns: 2, secondsPerCell: 5,
                    order: STD12.slice(),
                    leadColumns: { I: 0, II: 0, III: 0, aVR: 0, aVL: 0, aVF: 0, V1: 1, V2: 1, V3: 1, V4: 1, V5: 1, V6: 1 } },
    "3x4":        { columns: 4, secondsPerCell: 2.5,
                    order: STD12.slice(),
                    leadColumns: { I: 0, II: 0, III: 0, aVR: 1, aVL: 1, aVF: 1, V1: 2, V2: 2, V3: 2, V4: 3, V5: 3, V6: 3 } },
    "3x1":        { columns: 1, secondsPerCell: 10, order: ["I", "II", "V1"],
                    leadColumns: { I: 0, II: 0, V1: 0 } }
  };
  function col(leads, c) { var m = {}; leads.forEach(function (l) { m[l] = 0; }); return m; }

  // Contemporaneous groups: leads that share the same wall-clock column window (valid for cross-lead
  // measurements like frontal axis). Everything across columns is asynchronous.
  function contemporaneityGroups(layoutName) {
    var L = LAYOUTS[layoutName]; if (!L) return [];
    var byCol = {}; Object.keys(L.leadColumns).forEach(function (lead) { var c = L.leadColumns[lead]; (byCol[c] = byCol[c] || []).push(lead); });
    return Object.keys(byCol).sort().map(function (c) { return byCol[c]; });
  }

  // Detect layout from digitized traces: prefer an explicit hint, else infer from per-lead durations +
  // the presence of a full-10s strip. digitized = { leads:{name:{mv:[...],fs}}, rhythmLead?, layoutHint? }.
  function detectLayout(digitized) {
    if (digitized && digitized.layoutHint && LAYOUTS[digitized.layoutHint]) return digitized.layoutHint;
    var leads = (digitized && digitized.leads) || {};
    var names = Object.keys(leads);
    if (!names.length) return null;
    var fs = firstFs(leads);
    var durs = names.map(function (n) { return (leads[n].mv || []).length / (leads[n].fs || fs || 500); });
    var maxDur = Math.max.apply(null, durs);
    var typical = median(durs.filter(function (d) { return d < maxDur - 0.5 || durs.every(function (x) { return Math.abs(x - maxDur) < 0.5; }); }));
    // classify by the typical (non-strip) cell duration
    if (typical >= 9) return names.length <= 4 ? "3x1" : "12x1";   // both show full-10s leads; disambiguate by lead count
    if (typical >= 4) return "6x2";
    if (typical >= 2) return "3x4";
    return "3x4";
  }
  function firstFs(leads) { var k = Object.keys(leads)[0]; return k ? (leads[k].fs || 500) : 500; }
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }

  // Reconstruct → NaN+mask canvas [12 x N] with real samples placed at their true column offsets.
  // opts.fs / opts.seconds default to the EcgLib contract (500Hz, 10s → N=5000).
  function reconstruct(digitized, opts) {
    opts = opts || {};
    var layoutName = opts.layout || detectLayout(digitized);
    var L = LAYOUTS[layoutName]; if (!L) throw new Error("unknown/undetected layout");
    var fs = opts.fs || firstFs((digitized && digitized.leads) || {}) || 500;
    var seconds = opts.seconds || 10;
    var N = Math.round(fs * seconds);
    // II is a genuine full-10s lead in 12x1/3x1 too, so default to it always — a null rhythmLead here
    // would trigger a FALSE "no continuous rhythm strip" downgrade on full-coverage layouts.
    var rhythmLead = (digitized && digitized.rhythmLead) || "II";

    var canvas = new Float32Array(12 * N); canvas.fill(NaN);
    var mask = new Uint8Array(12 * N);      // 1 = real sample, 0 = absent (NEVER fabricated)
    var leads = (digitized && digitized.leads) || {};
    var perLead = {}, missingLeads = [];

    for (var li = 0; li < 12; li++) {
      var name = STD12[li];
      var isStrip = (name === rhythmLead);
      var trace = leads[name] && leads[name].mv ? leads[name].mv : null;
      if (!trace || !trace.length) { perLead[name] = { coverage: 0, observed: 0, window: null }; missingLeads.push(name); continue; }
      var c = L.leadColumns[name];
      // rhythm-strip lead genuinely spans the whole 0-10s row; other leads only their column window.
      var t0 = isStrip ? 0 : c * L.secondsPerCell;
      var winSec = isStrip ? seconds : L.secondsPerCell;
      var start = Math.round(t0 * fs);
      var count = Math.min(trace.length, Math.round(winSec * fs), N - start);
      for (var i = 0; i < count; i++) { canvas[li * N + start + i] = trace[i]; mask[li * N + start + i] = 1; }
      perLead[name] = { coverage: count / N, observed: count, window: [t0, t0 + winSec], column: c, contemporaneous: !isStrip };
    }

    var coverageVals = STD12.map(function (n) { return perLead[n].coverage; });
    var overallCoverage = coverageVals.reduce(function (a, b) { return a + b; }, 0) / 12;
    var full = coverageVals.every(function (v) { return v >= 0.999; });

    var conf = confidence({ layoutName: layoutName, perLead: perLead, missingLeads: missingLeads,
      overallCoverage: overallCoverage, full: full, rhythmLead: rhythmLead, digitized: digitized });

    return {
      layout: layoutName, fs: fs, samples: N, leads: 12, rhythmLead: rhythmLead,
      canvas: canvas, mask: mask, perLead: perLead, missingLeads: missingLeads,
      overallCoverage: overallCoverage, full: full,
      contemporaneityGroups: contemporaneityGroups(layoutName),
      confidence: conf.metrics, warnings: conf.warnings
    };
  }

  // Confidence framework (tiered gate — every read returns these; low → warn, never overconfident).
  function confidence(ctx) {
    var digi = ctx.digitized || {};
    var cal = digi.calibration || {};
    var warnings = [];

    // calibration confidence: grid detection > geometry fallback; needs a pixel scale.
    var calMethod = cal.method || "unknown";
    var calibration = calMethod === "grid" ? 0.9 : calMethod === "ecg-digitiser" ? 0.85 : calMethod === "geometry" ? 0.6 : 0.5;
    if (cal.pxPerMm == null) calibration = Math.min(calibration, 0.6);
    if (calibration < 0.7) warnings.push("calibration uncertain (" + calMethod + "); amplitude-dependent findings downgraded");

    // digitization confidence: passthrough from the digitiser if given, else layout-based proxy.
    var digitization = (typeof digi.digitizationConfidence === "number") ? digi.digitizationConfidence
      : (digi.method === "ecg-digitiser" ? 0.85 : digi.method === "grid" || digi.method === "classical" ? 0.6 : 0.6);
    if (digi.overlapDetected) { digitization = Math.min(digitization, 0.5); warnings.push("overlapping traces detected; per-lead fidelity low"); }

    // missing leads
    var missing = ctx.missingLeads.slice();
    if (missing.length) warnings.push("missing/unreadable leads: " + missing.join(", "));

    // lead quality proxy (coverage-weighted; full SQI = production upgrade)
    var leadQuality = Math.max(0, 1 - missing.length / 12);

    // rhythm confidence: high only if a genuine continuous 10s strip exists.
    var hasStrip = ctx.rhythmLead && ctx.perLead[ctx.rhythmLead] && ctx.perLead[ctx.rhythmLead].coverage >= 0.999;
    var rhythm = hasStrip ? 0.9 : (ctx.layoutName === "6x2" ? 0.5 : 0.3);
    if (!hasStrip) warnings.push("no continuous 10s rhythm strip; rhythm/rate confidence downgraded (R-R never computed across column seams)");

    // overall (tiered): complete coverage → gate on calibration/digitization; partial → LOW + warn.
    var overall;
    if (ctx.full) {
      overall = Math.min(digitization, calibration, leadQuality);
    } else {
      overall = Math.min(0.45, ctx.overallCoverage + 0.2);   // partial layout is capped LOW
      warnings.push("partial paper layout (coverage " + Math.round(ctx.overallCoverage * 100) + "%): the ensemble is NOT run on fabricated data; morphology per-lead only, cross-column axis/concordance unreliable, diagnosis deferred to rhythm strip — clinician review advised");
    }

    return {
      metrics: {
        digitization: round(digitization), leadQuality: round(leadQuality),
        missingLeads: missing, calibration: round(calibration), rhythm: round(rhythm),
        overall: round(overall), coverage: round(ctx.overallCoverage), full: ctx.full
      },
      warnings: warnings
    };
  }
  function round(x) { return Math.round(x * 100) / 100; }

  // A clean dense 10s x 12 signal EcgLib can validly consume — ONLY when every lead is fully covered.
  // Returns { dense:[12][N], reason } ; dense is null for partial layouts (never fabricate to fit the API).
  function toDense(recon) {
    if (!recon.full) return { dense: null, reason: "partial coverage (" + recon.layout + ", " + Math.round(recon.overallCoverage * 100) + "%); EcgLib needs a dense 10s x 12 — refusing to fabricate. Use the rhythm strip + warn." };
    var N = recon.samples, out = [];
    for (var li = 0; li < 12; li++) {
      var lead = new Array(N);
      for (var i = 0; i < N; i++) {
        var v = recon.canvas[li * N + i];
        if (v !== v) return { dense: null, reason: "residual NaN at supposedly-full coverage — refusing to zero-fill (never fabricate)" };
        lead[i] = v;
      }
      out.push(lead);
    }
    return { dense: out, reason: "full coverage (" + recon.layout + ")" };
  }

  // The continuous rhythm-strip lead samples (for rhythm/rate analysis), or null.
  function rhythmLeadSignal(recon) {
    var name = recon.rhythmLead; if (!name) return null;
    var li = STD12.indexOf(name); if (li < 0 || !recon.perLead[name] || recon.perLead[name].coverage < 0.999) return null;
    var N = recon.samples, out = new Array(N);
    for (var i = 0; i < N; i++) { var v = recon.canvas[li * N + i]; out[i] = (v === v) ? v : 0; }
    return out;
  }

  // Validation/testing helper: slice a full 10s x 12 ground-truth signal into a printed layout, exactly
  // as a PERFECT digitiser would output it (isolates the reconstruction layer from digitiser noise).
  function simulateFromFull(fullLeads, fs, layoutName, rhythmLead) {
    var L = LAYOUTS[layoutName]; if (!L) throw new Error("unknown layout " + layoutName);
    rhythmLead = rhythmLead || (layoutName.indexOf("x1") > 0 ? null : "II");
    var leads = {};
    STD12.forEach(function (name, li) {
      var full = fullLeads[li] || []; var Nfull = full.length;
      var isStrip = (name === rhythmLead);
      if (layoutName === "3x1" && ["I", "II", "V1"].indexOf(name) < 0 && !isStrip) return;   // 3x1 shows only 3 leads
      var c = L.leadColumns[name];
      if (isStrip) { leads[name] = { mv: full.slice(0, Nfull), fs: fs }; return; }
      var start = Math.round(c * L.secondsPerCell * fs);
      var count = Math.round(L.secondsPerCell * fs);
      leads[name] = { mv: full.slice(start, start + count), fs: fs };
    });
    return { leads: leads, rhythmLead: rhythmLead, layoutHint: layoutName,
             calibration: { mmPerS: 25, mmPerMv: 10, pxPerMm: 40, method: "grid" }, method: "simulated-perfect" };
  }

  var API = { LAYOUTS: LAYOUTS, STD12: STD12, detectLayout: detectLayout, reconstruct: reconstruct,
              toDense: toDense, rhythmLeadSignal: rhythmLeadSignal, contemporaneityGroups: contemporaneityGroups,
              simulateFromFull: simulateFromFull };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_RECONSTRUCT = API;
})();
