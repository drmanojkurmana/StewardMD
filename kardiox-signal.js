/* kardiox-signal.js — KardioX AI · signalMath (SMD_KARDIOX_SIGNAL).
 *
 * Pure, deterministic ECG interval/axis math. SAFETY-CRITICAL → ≥95% test coverage
 * (test/kardiox-signal.test.mjs). No DOM, no I/O; usable in node (module.exports) and browser (window).
 * All millisecond inputs unless noted. Formulas are standard textbook definitions; the module NEVER
 * diagnoses — it computes numbers + categorises them against conventional adult thresholds.
 */
(function () {
  "use strict";

  function num(v) { v = +v; return isFinite(v) ? v : NaN; }
  function round(v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; }

  // ── Rate ↔ RR ────────────────────────────────────────────────────────────────────────────────
  function rrFromRate(bpm) { bpm = num(bpm); return bpm > 0 ? 60000 / bpm : NaN; }        // ms
  function rateFromRr(rrMs) { rrMs = num(rrMs); return rrMs > 0 ? 60000 / rrMs : NaN; }    // bpm
  function rateCategory(bpm) { bpm = num(bpm); if (!isFinite(bpm)) return "unknown"; if (bpm < 60) return "brady"; if (bpm > 100) return "tachy"; return "normal"; }

  // ── QTc ──────────────────────────────────────────────────────────────────────────────────────
  // Bazett: QT / √RR ; Fridericia: QT / RR^(1/3) ; RR in SECONDS.
  function qtcBazett(qtMs, rrMs) { qtMs = num(qtMs); rrMs = num(rrMs); if (!(qtMs > 0) || !(rrMs > 0)) return NaN; return round(qtMs / Math.sqrt(rrMs / 1000), 0); }
  function qtcFridericia(qtMs, rrMs) { qtMs = num(qtMs); rrMs = num(rrMs); if (!(qtMs > 0) || !(rrMs > 0)) return NaN; return round(qtMs / Math.cbrt(rrMs / 1000), 0); }

  // ── Interval categories (conventional adult thresholds) ───────────────────────────────────────
  // PR: <120 short, 120–200 normal, >200 prolonged (1° AV block).
  function prCategory(prMs) { prMs = num(prMs); if (!isFinite(prMs)) return "unknown"; if (prMs < 120) return "short"; if (prMs > 200) return "prolonged"; return "normal"; }
  // QRS: <110 normal, 110–119 borderline, ≥120 wide.
  function qrsCategory(qrsMs) { qrsMs = num(qrsMs); if (!isFinite(qrsMs)) return "unknown"; if (qrsMs >= 120) return "wide"; if (qrsMs >= 110) return "borderline"; return "normal"; }
  // QTc bands chosen to match the app's metric-card colouring (design labels QTc 468 as "borderline"/
  // amber, not prolonged): short <350, normal ≤440, borderline 441–480, prolonged >480. Female
  // thresholds run 10 ms higher (optional `sex`). Prolongation risk escalates clinically past ~500 ms.
  function qtcCategory(qtcMs, sex) {
    qtcMs = num(qtcMs); if (!isFinite(qtcMs)) return "unknown";
    var off = (sex === "F" || sex === "female") ? 10 : 0;
    if (qtcMs < 350) return "short";
    if (qtcMs <= 440 + off) return "normal";
    if (qtcMs <= 480 + off) return "borderline";
    return "prolonged";
  }

  // ── Axis ───────────────────────────────────────────────────────────────────────────────────────
  // From the net QRS deflection in leads I and aVF (mV or mm — only the ratio matters).
  // Axis = atan2(aVF, I) in degrees on the hexaxial frame (I = 0°, aVF = +90°).
  function axisDegrees(netI, netAvf) {
    netI = num(netI); netAvf = num(netAvf);
    if (!isFinite(netI) || !isFinite(netAvf) || (netI === 0 && netAvf === 0)) return NaN;
    return round(Math.atan2(netAvf, netI) * 180 / Math.PI, 0);
  }
  // Category: normal -30..+90, LAD -30..-90, RAD +90..+180, extreme/NW -90..-180 (i.e. +180..+270).
  function axisCategory(deg) {
    deg = num(deg); if (!isFinite(deg)) return "unknown";
    // normalise to (-180, 180]
    while (deg > 180) deg -= 360; while (deg <= -180) deg += 360;
    if (deg >= -30 && deg <= 90) return "normal";
    if (deg > -90 && deg < -30) return "left";
    if (deg > 90 && deg <= 180) return "right";
    return "extreme"; // -180..-90 (northwest / indeterminate)
  }

  // ── Regularity from an RR series (ms) — variance-based, used for the AF "irregularly irregular". ─
  function rrVarianceSec(rrList) {
    if (!Array.isArray(rrList) || rrList.length < 2) return NaN;
    var xs = rrList.map(num).filter(isFinite); if (xs.length < 2) return NaN;
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var v = xs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / xs.length;
    return round(Math.sqrt(v) / 1000, 2); // SD in seconds
  }
  function regularity(rrList) {
    var sd = rrVarianceSec(rrList); if (!isFinite(sd)) return "unknown";
    if (sd < 0.04) return "regular";
    if (sd < 0.12) return "slightlyIrregular";
    return "irregular";
  }

  var API = {
    rrFromRate: rrFromRate, rateFromRr: rateFromRr, rateCategory: rateCategory,
    qtcBazett: qtcBazett, qtcFridericia: qtcFridericia,
    prCategory: prCategory, qrsCategory: qrsCategory, qtcCategory: qtcCategory,
    axisDegrees: axisDegrees, axisCategory: axisCategory,
    rrVarianceSec: rrVarianceSec, regularity: regularity
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_SIGNAL = API;
})();
