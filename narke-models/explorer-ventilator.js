/* Narkē explorer model: ventilator waveforms from a single-compartment lung. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["ventilator"].
   The lung is one compliance C (mL/cmH2O) behind one resistance R (cmH2O per L/s); the time constant is
   tau = R x C / 1000 seconds. Airway pressure = PEEP + flow x R + volume above FRC / C (equation of motion).
   Volume control: constant (square) inspiratory flow = Vt / Ti. Pressure control: a square pressure step above PEEP;
   flow decays as e^(-t/tau). Expiration is passive in both. The breath is solved at steady state, so if expiration is
   too short the trapped volume shows as intrinsic PEEP (auto-PEEP).
   Peak pressure, plateau (what a 0.5 s inspiratory hold would show) and driving pressure (plateau minus total PEEP)
   follow Hess, Respir Care 2014. Limits: plateau below 30 cmH2O and driving pressure as low as possible, with values
   above about 15 cmH2O linked to higher mortality (the app's reviewed protocol
   kb/clinical-protocols/ards-lung-protective-ventilation.json; Amato 2015). Preset lungs are illustrative. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var LIMITS = { compliance: [10, 100], resistance: [2, 50], peep: [0, 20], vt: [200, 800], pinsp: [5, 35], rate: [6, 35], ie: [1, 4] };
  var DEFAULTS = { mode: "vc", compliance: 50, resistance: 10, peep: 5, vt: 500, pinsp: 10, rate: 12, ie: 2 };
  var PLATEAU_MAX = 30, DRIVING_MAX = 15;
  var T = function (en, hi) { return { en: en, hi: hi }; };
  var PRESETS = {
    normal: { compliance: 50, resistance: 10, name: T("Normal anaesthetised lung", "सामान्य anaesthetised फेफड़ा") },
    bronchospasm: { compliance: 50, resistance: 30, name: T("Bronchospasm: high resistance", "Bronchospasm: ऊँचा resistance") },
    stiff: { compliance: 20, resistance: 10, name: T("Low compliance: stiff lung", "Low compliance: सख़्त फेफड़ा") }
  };

  function r1(x) { return Math.round(x * 10) / 10; }
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function inR(v, k) { return typeof v === "number" && v === v && v >= LIMITS[k][0] && v <= LIMITS[k][1]; }

  function settings(s) {
    s = s || {};
    var o = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = s[k] == null ? DEFAULTS[k] : s[k];
    if (o.mode !== "vc" && o.mode !== "pc") return bad("Mode is volume control or pressure control.", "Mode volume control या pressure control है।");
    var names = { compliance: "Compliance", resistance: "Resistance", peep: "PEEP", vt: "Tidal volume", pinsp: "Inspiratory pressure", rate: "Rate", ie: "I:E" };
    for (k in LIMITS) if (Object.prototype.hasOwnProperty.call(LIMITS, k) && !inR(o[k], k)) {
      return bad(names[k] + " must be " + LIMITS[k][0] + " to " + LIMITS[k][1] + ".", names[k] + " " + LIMITS[k][0] + " से " + LIMITS[k][1] + " के बीच होना चाहिए।");
    }
    o.ok = true;
    return o;
  }

  /* breath(settings, n): one steady-state breath sampled at n points (default 120). */
  function breath(s, n) {
    var o = settings(s);
    if (!o.ok) return o;
    var N = n || 120, C = o.compliance, R = o.resistance, tau = R * C / 1000;
    var Ttot = 60 / o.rate, Ti = Ttot / (1 + o.ie), Te = Ttot - Ti;
    var ee = Math.exp(-Te / tau), ei = Math.exp(-Ti / tau);
    var x0, x1, vt, flowI = 0;
    if (o.mode === "vc") {
      vt = o.vt; x0 = vt * ee / (1 - ee); x1 = x0 + vt; flowI = vt / 1000 / Ti; // L/s
    } else {
      var CP = C * o.pinsp; x1 = CP * (1 - ei) / (1 - ei * ee); x0 = x1 * ee; vt = x1 - x0;
    }
    var pts = [], i, t, x, f, p;
    for (i = 0; i <= N; i++) {
      t = Ttot * i / N;
      if (t <= Ti) {
        if (o.mode === "vc") { x = x0 + flowI * 1000 * t; f = flowI; }
        else { x = C * o.pinsp + (x0 - C * o.pinsp) * Math.exp(-t / tau); f = (C * o.pinsp - x) / C / R; }
      } else {
        x = x1 * Math.exp(-(t - Ti) / tau); f = -x / C / R;
      }
      p = o.mode === "pc" && t <= Ti ? o.peep + o.pinsp : o.peep + (t <= Ti ? f * R : 0) + (t <= Ti ? x / C : 0);
      pts.push({ t: Math.round(t * 1000) / 1000, paw: r1(p), flow: r1(f * 60), volume: Math.round(x - x0) });
    }
    var autoPeep = x0 / C, totalPeep = o.peep + autoPeep, plateau = o.peep + x1 / C;
    var peak = o.mode === "vc" ? o.peep + flowI * R + x1 / C : o.peep + o.pinsp;
    var res = {
      ok: true, settings: o, tau: Math.round(tau * 1000) / 1000, ti: Math.round(Ti * 100) / 100, te: Math.round(Te * 100) / 100,
      vt: Math.round(vt), minuteVolume: r1(vt * o.rate / 1000), peak: r1(peak), plateau: r1(plateau), autoPeep: r1(autoPeep),
      totalPeep: r1(totalPeep), driving: r1(plateau - totalPeep), resistivePressure: r1(peak - plateau),
      endExpFlow: r1(-x0 / C / R * 60), trapped: x0 > 0.05 * Math.max(vt, 1) || Te < 3 * tau, points: pts
    };
    res.alerts = [];
    if (res.plateau >= PLATEAU_MAX) res.alerts.push({ id: "plateau", text: T("Plateau 30 cmH2O or more: lower the tidal volume (lung protective target below 30).", "Plateau 30 cmH2O या ज़्यादा: tidal volume घटाएँ (lung protective लक्ष्य 30 से कम)।") });
    if (res.driving > DRIVING_MAX) res.alerts.push({ id: "driving", text: T("Driving pressure above 15 cmH2O is linked to higher mortality in ARDS.", "ARDS में 15 cmH2O से ज़्यादा driving pressure अधिक mortality से जुड़ा है।") });
    if (res.trapped) res.alerts.push({ id: "trap", text: T("Expiration ends before flow reaches zero: gas trapping and auto-PEEP. Lower the rate or lengthen expiration.", "Flow शून्य होने से पहले expiration ख़त्म: gas trapping और auto-PEEP। Rate घटाएँ या expiration लंबा करें।") });
    return res;
  }

  var LESSONS = {
    vc: {
      bronchospasm: T("Volume control, high resistance: peak pressure rises but plateau stays about the same, so the gap between them grows. The tidal volume is still delivered.", "Volume control, ऊँचा resistance: peak pressure बढ़ता है पर plateau लगभग वही रहता है, इसलिए दोनों का अंतर बढ़ता है। Tidal volume फिर भी पहुँचता है।"),
      stiff: T("Volume control, low compliance: peak and plateau both rise together, and so does driving pressure.", "Volume control, low compliance: peak और plateau दोनों साथ बढ़ते हैं, और driving pressure भी।")
    },
    pc: {
      bronchospasm: T("Pressure control, high resistance: peak pressure is fixed, flow decays slowly and the tidal volume falls. Expiratory flow may not reach zero.", "Pressure control, ऊँचा resistance: peak pressure तय है, flow धीरे घटता है और tidal volume कम होता है। Expiratory flow शायद शून्य तक न पहुँचे।"),
      stiff: T("Pressure control, low compliance: flow falls to zero early and the tidal volume falls. Pressure does not warn you; watch the volume.", "Pressure control, low compliance: flow जल्दी शून्य हो जाता है और tidal volume घटता है। Pressure चेतावनी नहीं देता; volume देखें।")
    }
  };

  return {
    id: "ventilator", kind: "explorer", group: "equipment", level: "resident",
    title: { en: "Ventilator waveforms", hi: "Ventilator waveforms" },
    subtitle: { en: "See pressure, flow and volume change with the mode and the lung", hi: "Mode और फेफड़े के साथ pressure, flow और volume बदलते देखें" },
    sources: [
      { label: "Hess DR. Respiratory mechanics in mechanically ventilated patients. Respir Care 2014;59(11):1773-1794 (equation of motion; peak, plateau and driving pressure; time constant)", url: "https://pubmed.ncbi.nlm.nih.gov/25336536/" },
      { label: "Amato MBP et al. Driving pressure and survival in the acute respiratory distress syndrome. N Engl J Med 2015;372(8):747-755", url: "https://pubmed.ncbi.nlm.nih.gov/25693014/" },
      { label: "StewardMD reviewed protocol: ARDS lung protective ventilation (kb/clinical-protocols/ards-lung-protective-ventilation.json): plateau below 30 cmH2O; driving pressure above about 15 cmH2O linked to higher mortality" },
      { label: "Miller's Anesthesia, 9th edition, chapter on anaesthesia delivery systems and ventilators (volume and pressure control)" }
    ],
    review: "ai_drafted",
    notes: {
      model: { en: "One balloon behind one tube: a teaching model. Real lungs have many compartments with different time constants.", hi: "एक नली के पीछे एक गुब्बारा: शिक्षण model। असली फेफड़ों में अलग time constant वाले कई हिस्से होते हैं।" },
      presets: { en: "The preset lungs are illustrative numbers, not measurements from a patient.", hi: "Preset फेफड़े उदाहरण के अंक हैं, किसी मरीज़ के माप नहीं।" },
      plateau: { en: "Plateau is measured with an inspiratory hold, when flow is zero. Driving pressure is plateau minus total PEEP.", hi: "Plateau inspiratory hold पर मापा जाता है, जब flow शून्य हो। Driving pressure = plateau minus total PEEP।" }
    },
    presets: PRESETS, lessons: LESSONS,
    constants: { limits: LIMITS, defaults: DEFAULTS, plateauMax: PLATEAU_MAX, drivingMax: DRIVING_MAX },
    settings: settings, breath: breath
  };
});
