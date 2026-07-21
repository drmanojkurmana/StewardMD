/* kardiox-stemi.js — KardioX AI · rule-based STEMI detector (SMD_KARDIOX_STEMI).
 *
 * A DETERMINISTIC ST-elevation analysis that complements the neural ensemble. STEMI is the rarest,
 * most territory-skewed class in the training data (CPSC STE 3.2%; PTB-XL inferior/lateral/posterior
 * injury <20 examples each), so a learned head alone is unreliable — explicit measurement covers every
 * territory. Measures, per lead: PR-segment baseline, J-point, ST deviation (mm), and T-wave amplitude,
 * then applies standard STEMI criteria (contiguous-lead ST elevation, reciprocal depression, hyperacute
 * T) plus Sgarbossa / modified-Sgarbossa when the QRS is wide (LBBB / paced). Emits a fusion candidate
 * so Evidence Fusion combines the rule and neural predictions. Requires CALIBRATED mV input (unlike the
 * z-norming NN). node + browser. No fabrication: returns fired=false with reasons when criteria aren't met.
 */
(function () {
  "use strict";

  var LEAD_ORDER = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  var IDX = {}; LEAD_ORDER.forEach(function (l, i) { IDX[l] = i; });

  // Contiguous anatomical lead groups (STEMI territories) + their reciprocal group.
  var TERRITORIES = [
    { name: "inferior", leads: ["II", "III", "aVF"], reciprocal: ["I", "aVL"] },
    { name: "lateral", leads: ["I", "aVL", "V5", "V6"], reciprocal: ["III", "aVF"] },
    { name: "anteroseptal", leads: ["V1", "V2", "V3"], reciprocal: [] },
    { name: "anterior", leads: ["V2", "V3", "V4"], reciprocal: [] },
    { name: "anterolateral", leads: ["V3", "V4", "V5", "V6"], reciprocal: ["III", "aVF"] }
  ];

  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // Pan-Tompkins-style R-peak indices on one lead (own copy so the module is self-contained).
  function rpeakIdx(lead, fs) {
    var n = lead.length, d = new Float64Array(n), i;
    for (i = 2; i < n - 2; i++) { var g = (2 * lead[i + 1] + lead[i + 2] - lead[i - 2] - 2 * lead[i - 1]); d[i] = g * g; }
    var w = Math.round(0.15 * fs), integ = new Float64Array(n), acc = 0;
    for (i = 0; i < n; i++) { acc += d[i]; if (i >= w) acc -= d[i - w]; integ[i] = acc / w; }
    var max = 0; for (i = 0; i < n; i++) if (integ[i] > max) max = integ[i];
    if (max <= 0) return [];
    var thr = 0.3 * max, minRR = Math.round(0.25 * fs), peaks = [], last = -minRR;
    for (i = 1; i < n - 1; i++) if (integ[i] > thr && integ[i] >= integ[i - 1] && integ[i] > integ[i + 1] && (i - last) >= minRR) { peaks.push(i); last = i; }
    // refine each integrator peak to the local |lead| maximum within ±40ms (the true R apex)
    var rad = Math.round(0.04 * fs);
    return peaks.map(function (p) {
      var a = Math.max(0, p - rad), b = Math.min(n - 1, p + rad), best = a, bv = -Infinity;
      for (var k = a; k <= b; k++) { var v = Math.abs(lead[k]); if (v > bv) { bv = v; best = k; } }
      return best;
    });
  }

  // Global QRS energy envelope (sum of squared derivatives across all leads, smoothed). QRS is
  // simultaneous across leads, so onset/offset found here are consistent and robust to notched/wide
  // complexes (RBBB R') — the naive per-lead "slope flattens" test failed there (read R' as ST).
  function qrsEnergy(leads, fs) {
    var n = (leads[0] || []).length, e = new Float64Array(n), c, i;
    for (c = 0; c < 12; c++) {
      var s = leads[c] || [];
      for (i = 2; i < n - 2; i++) { var g = (2 * s[i + 1] + s[i + 2] - s[i - 2] - 2 * s[i - 1]); e[i] += g * g; }
    }
    var w = Math.round(0.03 * fs), out = new Float64Array(n), acc = 0;   // ~30 ms smoothing
    for (i = 0; i < n; i++) { acc += e[i]; if (i >= w) acc -= e[i - w]; out[i] = acc / w; }
    return out;
  }

  // Per-beat QRS onset/offset(J) from the energy envelope around each R peak.
  function boundaries(energy, r, fs) {
    var ms = fs / 1000, L = Math.round(70 * ms), R = Math.round(160 * ms), n = energy.length;
    var a = Math.max(1, r - L), b = Math.min(n - 1, r + R), lmax = 0, i;
    for (i = a; i <= b; i++) if (energy[i] > lmax) lmax = energy[i];
    var thr = 0.12 * lmax;
    var onset = r - Math.round(50 * ms), off = r + Math.round(50 * ms);
    for (i = r; i >= a; i--) { if (energy[i] < thr) { onset = i; break; } }
    for (i = r; i <= b; i++) { if (energy[i] < thr) { off = i; break; } }
    return { onset: onset, j: off };
  }

  // Per-lead ST deviation (mm) at the J-point + J+40ms, baseline = PR segment, median over beats.
  // Also median QRS width + median T-wave apex amplitude (mm) per lead.
  function measure(leads, fs, peaks) {
    var ms = fs / 1000, energy = qrsEnergy(leads, fs);
    var stJ = {}, stJ40 = {}, tmm = {}, net = {}, qrsW = [], perBeat = [];
    peaks.forEach(function (r) { perBeat.push(boundaries(energy, r, fs)); });
    LEAD_ORDER.forEach(function (name) {
      var c = IDX[name], sig = leads[c] || [], vJ = [], v40 = [], tv = [], nv = [];
      peaks.forEach(function (r, bi) {
        var bnd = perBeat[bi], onset = bnd.onset, j = bnd.j;
        if (onset - Math.round(40 * ms) < 0 || j + Math.round(400 * ms) >= sig.length) return;
        var baseline = 0, cnt = 0;                                     // PR segment [onset-40, onset-5]
        for (var k = onset - Math.round(40 * ms); k <= onset - Math.round(5 * ms); k++) { baseline += sig[k]; cnt++; }
        baseline = cnt ? baseline / cnt : 0;
        vJ.push((sig[j] - baseline) * 10);                             // ST at J-point (mm)
        v40.push((sig[Math.min(sig.length - 1, j + Math.round(40 * ms))] - baseline) * 10);
        var t0 = j + Math.round(80 * ms), t1 = Math.min(sig.length - 1, j + Math.round(400 * ms)), tpk = 0;
        for (var t = t0; t <= t1; t++) { var dv = sig[t] - baseline; if (Math.abs(dv) > Math.abs(tpk)) tpk = dv; }
        tv.push(tpk * 10);
        var area = 0; for (var q = onset; q <= j; q++) area += (sig[q] - baseline);   // net QRS deflection
        nv.push(area);
        if (c === IDX.II) qrsW.push((j - onset) / ms);
      });
      stJ[name] = vJ.length ? median(vJ) : 0;
      stJ40[name] = v40.length ? median(v40) : 0;
      tmm[name] = tv.length ? median(tv) : 0;
      net[name] = nv.length ? median(nv) : 0;
    });
    return { st: stJ, stJ40: stJ40, t: tmm, qrsNet: net, qrsMs: qrsW.length ? median(qrsW) : null };
  }

  // Apply STEMI criteria. thr: V2/V3 = 2.0mm (or 1.5 female), other leads 1.0mm.
  // BBB-aware (hybrid): opts.rbbb / opts.lbbb (NN conduction probabilities) gate which territories are
  // trusted, because bundle branch block produces SECONDARY ST deviation:
  //   RBBB  -> right-precordial V1-V3 ST is secondary; exclude anteroseptal/anterior territories.
  //   LBBB / paced / wide-QRS -> all leads discordant; automated thresholds are INVALID. Rather than
  //     auto-diagnose from an unreliable single-lead Sgarbossa (which false-fires on normal LBBB
  //     discordance / RBBB V1-3 depression), we compute Sgarbossa components as an ADVISORY for
  //     clinician review and do NOT emit a STEMI call. (LBBB head is noisy, so it must be confident.)
  function classify(m, opts) {
    opts = opts || {};
    var st = m.st, tW = m.t, female = opts.sex === "F" || opts.sex === "female";
    var rbbbP = opts.rbbb || 0, lbbbP = opts.lbbb || 0;
    var rbbbFlag = rbbbP >= 0.5 && rbbbP >= lbbbP;               // dominant conduction call
    var lbbbFlag = (lbbbP >= 0.8 && lbbbP > rbbbP) || (m.qrsMs != null && m.qrsMs >= 140);
    var wide = opts.wideQRS || lbbbFlag || (m.qrsMs != null && m.qrsMs >= 120);
    // "standard criteria valid" only for a NON-wide, non-LBBB tracing.
    var standardValid = !wide && !lbbbFlag;
    function thr(lead) { return (lead === "V2" || lead === "V3") ? (female ? 1.5 : 2.0) : 1.0; }
    var suppressed = {};
    if (rbbbFlag) { suppressed.anteroseptal = true; suppressed.anterior = true; }   // RBBB secondary V1-3

    var best = null;
    if (standardValid) TERRITORIES.forEach(function (terr) {
      if (suppressed[terr.name]) return;
      var hits = terr.leads.filter(function (l) { return st[l] >= thr(l); });
      if (hits.length >= 2) {
        var recip = terr.reciprocal.filter(function (l) { return st[l] <= -0.5; });
        var hyper = hits.filter(function (l) { return tW[l] >= 6; });
        var maxSt = Math.max.apply(null, hits.map(function (l) { return st[l]; }));
        var cand = { territory: terr.name, leads: hits, maxElevationMm: +maxSt.toFixed(2), reciprocalLeads: recip, hyperacuteLeads: hyper, kind: "st-elevation" };
        if (!best || cand.leads.length > best.leads.length || (cand.leads.length === best.leads.length && cand.maxElevationMm > best.maxElevationMm)) best = cand;
      }
    });

    // Hyperacute-T / early-STEMI equivalent (conservative): modest ST elevation (>=0.5mm at J, rising to
    // >=1.2mm at J+40) with TALL T (>=8mm) in >=2 contiguous leads, narrow QRS. Catches early STEMI
    // before frank elevation. Requires reciprocal-or-clearly-upsloping to keep specificity.
    var hyperacute = null;
    if (!best && standardValid) {
      TERRITORIES.forEach(function (terr) {
        if (suppressed[terr.name]) return;
        var hits = terr.leads.filter(function (l) { return st[l] >= 0.5 && m.stJ40[l] >= 1.2 && tW[l] >= 8 && m.stJ40[l] > st[l] + 0.5; });
        if (hits.length >= 2 && (!hyperacute || hits.length > hyperacute.leads.length)) {
          hyperacute = { territory: terr.name, leads: hits, maxElevationMm: +Math.max.apply(null, hits.map(function (l) { return m.stJ40[l]; })).toFixed(2),
            reciprocalLeads: terr.reciprocal.filter(function (l) { return st[l] <= -0.5; }), hyperacuteLeads: hits, kind: "hyperacute-t" };
        }
      });
      if (hyperacute) best = hyperacute;
    }

    // Sgarbossa / modified Sgarbossa — computed for the ADVISORY only when wide/LBBB (never auto-fires).
    // Uses true QRS polarity (net area) so "concordant" is meaningful. Surfaced for clinician review.
    var sgarbossa = null, advisory = null;
    if (wide) {
      var pol = m.qrsNet || {};
      var concordantSTE = LEAD_ORDER.some(function (l) { return st[l] >= 1.0 && pol[l] > 0; });          // STE where QRS positive
      var concordantSTD = ["V1", "V2", "V3"].some(function (l) { return st[l] <= -1.0 && pol[l] < 0; }); // STD where QRS negative
      var discordant = LEAD_ORDER.some(function (l) { return (st[l] >= 1.0 && pol[l] < 0) || (st[l] <= -1.0 && pol[l] > 0); });
      var score = (concordantSTE ? 5 : 0) + (concordantSTD ? 3 : 0);
      sgarbossa = { applicable: true, concordantSTE: concordantSTE, concordantSTD: concordantSTD, discordant: discordant, score: score, note: "Sgarbossa is advisory only on automated single-lead analysis; confirm on the full 12-lead and compare with a prior ECG." };
      advisory = "Wide-QRS / suspected " + (lbbbFlag ? "LBBB" : "IVCD") + ": automated ST-elevation thresholds are invalid. Sgarbossa components " + (score >= 3 ? "PRESENT (" + score + ") — urgent clinician review to exclude STEMI." : "not met.") + " Compare with a prior ECG.";
    }

    var fired = !!best;
    var conf = 0;
    if (best && best.kind === "st-elevation") {
      conf = 0.62;
      if (best.reciprocalLeads.length) conf += 0.15;      // reciprocal change = high specificity
      if (best.hyperacuteLeads.length) conf += 0.06;
      if (best.leads.length >= 3) conf += 0.05;
      if (best.maxElevationMm >= 3) conf += 0.05;
      conf = Math.min(conf, 0.93);
    } else if (best && best.kind === "hyperacute-t") {
      conf = 0.56 + (best.reciprocalLeads.length ? 0.08 : 0) + (best.leads.length >= 3 ? 0.04 : 0);
    }
    return {
      fired: fired, probability: +conf.toFixed(3),
      territory: best ? best.territory : null,
      criteria: best, sgarbossa: sgarbossa, advisory: advisory,
      bbbContext: { rbbb: rbbbFlag, lbbb: lbbbFlag, wide: wide, standardValid: standardValid, suppressed: Object.keys(suppressed) },
      reason: fired ? null : (wide ? "Wide-QRS/BBB: STEMI not auto-assessed (advisory issued)" : "No contiguous ST elevation meeting threshold"),
      stByLead: st, tByLead: tW, qrsMs: m.qrsMs
    };
  }

  // Full detector: leads (12 arrays, CALIBRATED mV) + opts{fs,sex,wideQRS,rbbb,lbbb} -> result.
  function detect(leads, opts) {
    opts = opts || {}; var fs = opts.fs || 500;
    if (!leads || leads.length !== 12) return { fired: false, probability: 0, reason: "need 12 leads" };
    var peaks = rpeakIdx(leads[IDX.II] || leads[0], fs);
    if (peaks.length < 2) return { fired: false, probability: 0, reason: "no QRS complexes detected" };
    var m = measure(leads, fs, peaks);
    return classify(m, opts);
  }

  // Evidence-Fusion candidate: STEMI-family finding as an INDEPENDENT source. Returns null if not fired
  // (so it never injects a phantom finding). label "st elevation" fuses with any NN "STE".
  function candidate(leads, opts) {
    var r = detect(leads, opts);
    if (!r.fired) return { fired: false, detail: r };
    return {
      fired: true, detail: r,
      source: "stemi-rule", label: "st elevation", _code: "STE",
      confidence: r.probability, weight: 0.7,     // measurement-based, high reliability for STEMI territory
      territory: r.territory
    };
  }

  var API = { detect: detect, candidate: candidate, measure: measure, classify: classify,
              rpeakIdx: rpeakIdx, TERRITORIES: TERRITORIES, LEAD_ORDER: LEAD_ORDER };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_STEMI = API;
})();
