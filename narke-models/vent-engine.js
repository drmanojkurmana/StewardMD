/* Narkē Ventilator Lab: physiology engine. Pure logic, no DOM, deterministic. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["vent-engine"]. Educational simulator, not a clinical device.
   Every number the lab shows is "simulated": it comes from the equations below, never from a lookup table.

   UNITS. Pressure cmH2O, volume mL, flow L/s inside (L/min shown), compliance mL/cmH2O, resistance cmH2O per L/s,
   gas tensions mmHg, FiO2 setting in %, VCO2 and VO2 mL/min STPD, Hb g/dL, time s.

   1. LUNG (recruitable single compartment; Gattinoni "baby lung" concept; Hess Respir Care 2014).
      Scenario units (narke/vent/scenarios.json): c = compliance with the recruitable lung open; shunt = shunt at
      PEEP 5; recruitable = share of that shunt that PEEP and mean airway pressure can reopen.
      Open share of the recruitable units at equilibrium: open* = 1 / (1 + e^(-(Peff - 12) / 4)),
      Peff = 0.7 x PEEPtotal + 0.3 x Pmean; at PEEP 5 the reference is Peff 5.9 (Pmean about 8), open5 = 0.18.
      Collapsed lung fraction = shunt x recruitable x (1 - open) / (1 - open5) (collapsed volume taken equal to
      its perfusion share). Crs = c x (1 - collapsed) x event factor. Approach is first order: tau 120 s when
      recruiting, 300 s when derecruiting. Opening midpoint 12 cmH2O and width 4 are teaching values.
      Overdistension: elastic recoil is linear up to the upper inflection UI (scenario); above it the incremental
      compliance is 0.5 x Crs, so plateau climbs steeply (Roupie 1995 upper inflection; 0.5 is a teaching value).
      Pel(V) = V / C below V = C x UI; UI + (V - C x UI) / (0.5 C) above. V is volume above relaxation volume.
   2. EQUATION OF MOTION (Tobin; Hess and Kacmarek): Paw = Pmus + flow x R + V / C + PEEPtotal.
      Pmus is negative during an inspiratory effort (it lowers Paw), positive during active expiration.
      Time constants: tauI = R x C / 1000; tauE = Rexp x C / 1000. Rexp = 2 R when expiratory flow limited (COPD).
      Volume breath (VC): VT fixed; square flow VT / Ti or decelerating (peak 2 VT / Ti).
      Pressure breath (PC, PRVC, PSV, NIV, APRV) at steady state with incomplete emptying:
        x1 = C P (1 - eI) / (1 - eI eE), x0 = x1 eE, VT = x1 - x0, eI = e^(-Ti / tauI), eE = e^(-Te / tauE).
      Volume breath trapping: x0 = VT eE / (1 - eE). Intrinsic PEEP = x0 / C (Marini; Hess 2014).
      Flow-limited lung (waterfall): PEEPtotal = max(PEEPe + 0.2 PEEPi, PEEPi), so external PEEP up to about 80% of
      intrinsic PEEP does not raise total PEEP (Tobin and Lodato 1989; Marini 2011).
      PSV / NIV cycle off when flow decays to cycle % of peak: Ti = tauI x ln(100 / cycle%).
      Peak (VC square) = Pplat + R x flow; Pmean (Marini 1981) = PEEP + k (Ppeak - PEEP) Ti / Ttot, k 0.5 for square
      volume breaths, 1 for pressure breaths. Driving pressure = Pplat - PEEPtotal (Amato 2015).
      Mechanical power, simplified (Gattinoni 2016): MP J/min = 0.098 x RR x VT(L) x (Ppeak - 0.5 x driving P).
   3. PATIENT EFFORT AND CHEMOREFLEX. chemo = 1 + 5 (7.40 - pH) + 0.02 (PaCO2 - 40) + 0.03 max(0, 60 - PaO2),
      clamped 0 to 3; below 0.3 the patient is apnoeic (apnoeic threshold). Sedation s (0 to 1) scales it:
      Pmus = effort x chemo x (1 - s); rate = drive rate x (0.6 + 0.4 chemo) x (1 - s). Teaching gains.
      Mean effective pressure of an effort = 0.7 Pmus over a neural Ti of 1.0 s.
      Triggering load = (PEEPtotal - PEEPe) + sensitivity (pressure trigger |set|; flow trigger 0.3 + 0.1 x L/min).
      Missed (ineffective) efforts = clamp((load - 0.5 Pmus) / (0.5 Pmus + 0.1), 0, 1): auto-PEEP must be
      overcome before the ventilator sees the effort (Tobin, Principles and Practice of Mechanical Ventilation).
   4. MODES. vc and pc are controlled (efforts do not trigger); acvc, acpc and prvc are assist control; simv gives
      set VC breaths plus pressure-supported spontaneous breaths; psv is patient-triggered, flow-cycled; cpap gives
      no inspiratory support; prvc moves the pressure up to 3 cmH2O per breath toward the target VT, capped 5 below
      the peak pressure alarm; niv is IPAP/EPAP with a timed backup rate and a 10% leak; aprv is Phigh/Plow/Thigh/Tlow
      with unsupported breathing at Phigh. PSV and CPAP switch to apnoea backup (VC at the set VT and rate) after
      the apnoea alarm time, as real ventilators do.
   5. VENTILATION (West). VD = anatomic 2.2 mL/kg PBW + alveolar (deadSpace x VT, + 0.005 per cmH2O plateau above UI,
      + 0.1 x fractional fall in cardiac output; capped at 0.6). VA = sum of rate x (VT - VD). Steady state PaCO2 = 0.863 VCO2 / VA.
      Kinetics from a CO2 store mass balance: dPaCO2/dt = (VCO2 - VA x PaCO2 / 0.863) / K, K = 40 mL/mmHg, giving an
      apnoeic rise of about 5 mmHg/min and a time constant near 8 min at normal VA (teaching value; ABG equilibrates
      in 10 to 30 min after a change). PBW (ARDSNet 2000): men 50, women 45.5, + 0.91 (height cm - 152.4).
      EtCO2 = PaCO2 x (1 - 0.05 - VDalv / (VT - VDanat)) (Bohr; normal gap 2 to 5 mmHg, wider with dead space).
   6. OXYGENATION. Alveolar gas equation PAO2 = FiO2 (760 - 47) - PaCO2 / 0.8 is the target; PAO2 approaches it
      with an FRC oxygen store (30 mL/kg PBW x (1 - collapsed) + C x PEEPtotal) washed by VA, so apnoea or disconnection
      desaturates over minutes. Shunt = shunt x (1 - recruitable) + collapsed fraction + events.
      A low V/Q compartment (perfusion fraction lowVQ, V/Q 0.1 of the mean; default 0.25 when flow limited, 0.2 when
      R is 20 or more, else 0.01) solves its own O2 mass balance: VA_L x 1.16 x (PAO2 - P) = Q_L x 10 x (Cc'(P) - CvO2).
      CaO2 = sum of compartment contents; CvO2 = CaO2 - VO2 / (10 CO), iterated to a fixed point (West; Nunn).
      Content = 1.34 Hb SO2 + 0.003 PO2. SO2 by Severinghaus 1979 with the Kelman 1966 virtual PO2 correction for pH,
      temperature and PCO2 (same equations as narke-models/explorer-odc.js). VO2 = VCO2 / 0.8. SpO2 = SaO2.
   7. ACID BASE. HCO3 = scenario HCO3 - (lactate - baseline lactate) + acute CO2 buffering (+1 per 10 mmHg PaCO2 rise,
      -2 per 10 fall). pH = 6.1 + log10(HCO3 / (0.03 PaCO2)) (Henderson-Hasselbalch).
      Buffering is scaled by HCO3 / 24 below 24 (less buffer base in severe metabolic acidosis; teaching value).
      The acute buffering reference is the PaCO2 at the start steady state, so scenario HCO3 is the presenting value.
      Standard base excess (Van Slyke, CLSI C46): BE = 0.93 (HCO3 - 24.4 + 14.83 (pH - 7.40)).
      Lactate rises 0.1 mmol/L/min per unit stress, stress = max(0, (80 - SpO2) / 20) + max(0, (60 - MAP) / 20);
      without stress it clears to baseline with a 90 min time constant (teaching values).
   8. HAEMODYNAMICS. Mean intrathoracic (alveolar) pressure = Pmean + auto-PEEP x expiratory fraction.
      CO = CO0 x max(0.35, 1 - k (Pitp - 7)) x event factor; k per cmH2O: low volume 0.045, normal 0.022, high 0.008
      (venous return falls as intrathoracic pressure rises: Guyton; Pinsky). Baselines: low volume CO0 4.0, MAP 72,
      HR 105; normal 5.0, 85, 80; high 5.0, 88, 85. MAP = MAP0 (1 - 0.6 (1 - CO/CO0)) (partial baroreflex), x
      (1 - 0.5 (7.2 - pH)) below pH 7.2. HR = HR0 + 50 (1 - CO/CO0) + 0.5 per % SpO2 below 92 + 0.4 per mmHg PaCO2 above 45
      + 10 per degree above 37.5; SpO2 below 70 brings bradycardia (HR x (SpO2/70)^2) and falling MAP. Teaching gains.
   9. HARM. VILI index accumulates per minute: (Pplat - 30) / 5 + (driving P - 15) / 5 + (VT/kg PBW - 8) / 2, each
      only above its limit (ARDSNet 2000; Amato 2015; kb/clinical-protocols/ards-lung-protective-ventilation.json).
      Oxygen hours above FiO2 60%; minutes of hypotension, hypoxaemia, plateau above 35 and auto-PEEP with hypotension.
   10. EVENTS (scenario timeline, see EVENTS): secretions (R x1.5, shunt +0.03), bronchospasm (R x2.5), pneumothorax
      (C x0.6, shunt +0.10, CO x0.75), disconnect (no ventilator, PEEP 0, room air; duration default 30 s), hypotension
      (CO x0.7 for duration default 900 s, volume status low), fever (VCO2 x1.2, +1.5 degrees), improve (event insults
      cleared; R x0.7, shunt x0.7, c x1.15, HCO3 +6 up to 24 if below 22, sedation -0.3). Also plug, cuffLeak,
      o2Failure, sedationLight, sedationDeep, hypovolaemia, fluidBolus, fatigue, bronchospasmEases.
      whatIf() marks pending events as fired, so its 30 min result shows only the one setting change.
   Settings also accept flowPattern "square" | "decel" for volume breaths (not in SETTINGS until learn.json covers it).
   Integration: step() sub-steps at 10 s or less with exact exponential updates, so dt from 1 s to 3600 s is stable.
   Teaching gains marked above are model choices for a clinical reviewer to tune, not measured patient data. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function T(en, hi) { return { en: en, hi: hi }; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function r0(x) { return Math.round(x); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function log10(x) { return Math.log(x) / Math.LN10; }

  var K_CO2 = 40, KOD = 0.5, PATM = 760, PH2O = 47, RQ = 0.8, TIN = 1.0, SUB = 10;

  var SOURCES = [
    { label: "West JB, Luks AM. West's Respiratory Physiology: The Essentials, 11th edition (alveolar gas equation, PaCO2 and alveolar ventilation, shunt, V/Q, O2 content)" },
    { label: "Tobin MJ. Principles and Practice of Mechanical Ventilation, 3rd edition (equation of motion, triggering, intrinsic PEEP, dyssynchrony)" },
    { label: "Hess DR, Kacmarek RM. Essentials of Mechanical Ventilation, 4th edition (modes, cycling, PRVC, APRV)" },
    { label: "Hess DR. Respiratory mechanics in mechanically ventilated patients. Respir Care 2014;59(11):1773-1794", url: "https://pubmed.ncbi.nlm.nih.gov/25336536/" },
    { label: "ARDS Network. Ventilation with lower tidal volumes. N Engl J Med 2000;342(18):1301-1308 (PBW, 6 mL/kg, plateau 30)", url: "https://pubmed.ncbi.nlm.nih.gov/10793162/" },
    { label: "Amato MBP et al. Driving pressure and survival in ARDS. N Engl J Med 2015;372(8):747-755", url: "https://pubmed.ncbi.nlm.nih.gov/25693014/" },
    { label: "Gattinoni L et al. Ventilator-related causes of lung injury: the mechanical power. Intensive Care Med 2016;42(10):1567-1575", url: "https://pubmed.ncbi.nlm.nih.gov/27620287/" },
    { label: "Severinghaus JW. Simple, accurate equations for human blood O2 dissociation computations. J Appl Physiol 1979;46(3):599-602", url: "https://pubmed.ncbi.nlm.nih.gov/35496/" },
    { label: "Marini JJ, Ravenscraft SA. Mean airway pressure: physiologic determinants and clinical importance. Crit Care Med 1992;20(10):1461-1472", url: "https://pubmed.ncbi.nlm.nih.gov/1395670/" },
    { label: "StewardMD reviewed protocols: kb/clinical-protocols/ards-lung-protective-ventilation.json, acute-respiratory-failure-niv-hfnc.json, acute-asthma-adult.json, copd-exacerbation.json" }
  ];

  var CHAIN_STEPS = ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"];
  var CHAIN_LABELS = {
    setting: T("Setting", "Setting"), ventilator: T("Ventilator delivers", "Ventilator देता है"),
    mechanics: T("Lung mechanics", "Lung mechanics"), waveforms: T("Waveforms", "Waveforms"),
    gasExchange: T("Gas exchange", "Gas exchange"), monitor: T("Monitor", "Monitor"), abg: T("ABG", "ABG"), patient: T("Patient", "मरीज़")
  };

  var TRIG = ["trigType", "trigFlow", "trigPress"];
  function M(id, en, hi, controls, level) { return { id: id, title: T(en, hi), controls: controls, level: level }; }
  var MODES = {
    vc: M("vc", "Volume control (controlled)", "Volume control (controlled)", ["fio2", "peep", "vt", "rr", "ti"], 1),
    acvc: M("acvc", "Assist control, volume (AC-VC)", "Assist control, volume (AC-VC)", ["fio2", "peep", "vt", "rr", "ti"].concat(TRIG), 1),
    pc: M("pc", "Pressure control (controlled)", "Pressure control (controlled)", ["fio2", "peep", "pinsp", "rr", "ti", "rise"], 2),
    acpc: M("acpc", "Assist control, pressure (AC-PC)", "Assist control, pressure (AC-PC)", ["fio2", "peep", "pinsp", "rr", "ti", "rise"].concat(TRIG), 2),
    simv: M("simv", "SIMV (volume) with pressure support", "SIMV (volume) और pressure support", ["fio2", "peep", "vt", "rr", "ti", "ps", "cycle"].concat(TRIG), 3),
    psv: M("psv", "Pressure support (PSV)", "Pressure support (PSV)", ["fio2", "peep", "ps", "cycle", "rise"].concat(TRIG), 2),
    cpap: M("cpap", "CPAP (no inspiratory support)", "CPAP (inspiratory support नहीं)", ["fio2", "peep"].concat(TRIG), 2),
    prvc: M("prvc", "Pressure regulated volume control (PRVC)", "Pressure regulated volume control (PRVC)", ["fio2", "peep", "vt", "rr", "ti"].concat(TRIG), 3),
    niv: M("niv", "Non-invasive BiPAP (IPAP and EPAP)", "Non-invasive BiPAP (IPAP और EPAP)", ["fio2", "ipap", "epap", "rr", "ti", "cycle", "rise"].concat(TRIG), 3),
    aprv: M("aprv", "Airway pressure release ventilation (APRV)", "Airway pressure release ventilation (APRV)", ["fio2", "phigh", "plow", "thigh", "tlow"], 4)
  };

  function S(en, hi, unit, min, max, step, def, level) { return { label: T(en, hi), unit: unit, min: min, max: max, step: step, "default": def, level: level }; }
  var SETTINGS = {
    fio2: S("FiO2", "FiO2", "%", 21, 100, 1, 40, 1),
    peep: S("PEEP", "PEEP", "cmH2O", 0, 24, 1, 5, 1),
    vt: S("Tidal volume", "Tidal volume", "mL", 200, 1000, 10, 450, 1),
    rr: S("Set rate", "Set rate", "/min", 4, 40, 1, 14, 1),
    pinsp: S("Inspiratory pressure above PEEP", "PEEP के ऊपर inspiratory pressure", "cmH2O", 5, 40, 1, 15, 2),
    ps: S("Pressure support", "Pressure support", "cmH2O", 0, 30, 1, 10, 2),
    ti: S("Inspiratory time", "Inspiratory time", "s", 0.4, 3.0, 0.1, 1.0, 2),
    ie: { label: T("I:E ratio (derived)", "I:E ratio (derived)"), unit: "1:x", min: 0.2, max: 10, step: 0.1, "default": null, level: 2, derived: true },
    trigType: { label: T("Trigger type", "Trigger type"), unit: "", options: ["flow", "pressure"], "default": "flow", level: 3 },
    trigFlow: S("Flow trigger", "Flow trigger", "L/min", 0.5, 10, 0.5, 2, 3),
    trigPress: S("Pressure trigger", "Pressure trigger", "cmH2O", -5, -0.5, 0.5, -2, 3),
    cycle: S("Expiratory cycle", "Expiratory cycle", "% of peak flow", 5, 80, 5, 25, 3),
    rise: S("Rise time", "Rise time", "s", 0.05, 0.4, 0.05, 0.1, 3),
    phigh: S("P high", "P high", "cmH2O", 10, 40, 1, 28, 4),
    plow: S("P low", "P low", "cmH2O", 0, 15, 1, 0, 4),
    thigh: S("T high", "T high", "s", 2, 10, 0.5, 4.5, 4),
    tlow: S("T low", "T low", "s", 0.2, 1.5, 0.1, 0.5, 4),
    ipap: S("IPAP", "IPAP", "cmH2O", 5, 30, 1, 12, 3),
    epap: S("EPAP", "EPAP", "cmH2O", 3, 15, 1, 5, 3),
    pPeakHigh: S("Peak pressure alarm", "Peak pressure alarm", "cmH2O", 15, 60, 1, 40, 2),
    veLow: S("Low minute volume alarm", "Low minute volume alarm", "L/min", 1, 10, 0.5, 3, 2),
    veHigh: S("High minute volume alarm", "High minute volume alarm", "L/min", 5, 30, 1, 15, 2),
    apnoea: S("Apnoea alarm time", "Apnoea alarm time", "s", 10, 60, 5, 20, 2),
    rrHigh: S("High rate alarm", "High rate alarm", "/min", 10, 60, 1, 35, 2),
    fio2Low: S("Low FiO2 alarm", "Low FiO2 alarm", "%", 18, 95, 1, 18, 3),
    fio2High: S("High FiO2 alarm", "High FiO2 alarm", "%", 25, 100, 1, 100, 3),
    peepLow: S("Low PEEP alarm", "Low PEEP alarm", "cmH2O", 0, 20, 1, 0, 3),
    peepHigh: S("High PEEP alarm", "High PEEP alarm", "cmH2O", 5, 30, 1, 20, 3)
  };

  /* Timeline events a scenario can schedule ({t, event, note, duration?}). Unknown ids only show their note. */
  var EVENTS = {
    secretions: T("Secretions: airway resistance up", "Secretions: airway resistance बढ़ा"),
    bronchospasm: T("Bronchospasm: airway resistance much higher", "Bronchospasm: airway resistance बहुत बढ़ा"),
    bronchospasmEases: T("Bronchospasm eases", "Bronchospasm कम हुआ"),
    pneumothorax: T("Pneumothorax: compliance and cardiac output fall", "Pneumothorax: compliance और cardiac output गिरे"),
    plug: T("Mucus plug: lobe collapse, shunt up", "Mucus plug: lobe collapse, shunt बढ़ा"),
    disconnect: T("Circuit disconnected", "Circuit disconnect हुआ"),
    cuffLeak: T("Cuff leak", "Cuff leak"),
    o2Failure: T("Oxygen supply failure", "Oxygen supply failure"),
    sedationLight: T("Sedation lightens: effort returns", "Sedation हल्का: effort लौटा"),
    sedationDeep: T("Deep sedation: no effort", "गहरा sedation: कोई effort नहीं"),
    fever: T("Fever: CO2 production up", "बुखार: CO2 production बढ़ा"),
    hypovolaemia: T("Bleeding: volume status low", "Bleeding: volume status कम"),
    hypotension: T("Hypotension: cardiac output falls for a while", "Hypotension: कुछ समय के लिए cardiac output गिरा"),
    improve: T("Treatment works: resistance, shunt and acidosis ease; sedation lightens", "इलाज असर कर रहा है: resistance, shunt और acidosis घटे; sedation हल्का"),
    fluidBolus: T("Fluid given: volume status up", "Fluid दिया: volume status बढ़ा"),
    fatigue: T("Respiratory muscle fatigue", "Respiratory muscle fatigue")
  };

  var NORMAL_SET = { mode: "acvc" };
  function norm(st) {
    st = st || {};
    var o = {}, k, d;
    for (k in SETTINGS) if (own(SETTINGS, k)) {
      d = SETTINGS[k];
      var v = own(st, k) && st[k] != null ? st[k] : d["default"];
      if (d.options) { if (d.options.indexOf(v) < 0) v = d["default"]; }
      else if (typeof v === "number" && v === v) v = clamp(v, d.min, d.max);
      o[k] = v;
    }
    o.mode = own(MODES, st.mode) ? st.mode : NORMAL_SET.mode;
    o.flowPattern = st.flowPattern === "decel" ? "decel" : "square"; // VC flow shape; not yet a learn.json setting

    return o;
  }

  function pbw(p) { return (p.sex === "F" ? 45.5 : 50) + 0.91 * (p.heightCm - 152.4); }

  /* ---------- oxygen: Severinghaus + Kelman ---------- */
  function sat(po2, ph, temp, pco2) {
    if (!(po2 > 0)) return 0;
    var f = Math.pow(10, 0.024 * (37 - temp) + 0.40 * (ph - 7.40) + 0.06 * log10(40 / Math.max(5, pco2)));
    var p = po2 * f;
    return 1 / (23400 / (p * p * p + 150 * p) + 1);
  }
  function content(po2, hb, ph, temp, pco2) { return 1.34 * hb * sat(po2, ph, temp, pco2) + 0.003 * po2; }
  function po2From(ca, hb, ph, temp, pco2) {
    var lo = 0, hi = 800, mid, i;
    for (i = 0; i < 40; i++) { mid = (lo + hi) / 2; if (content(mid, hb, ph, temp, pco2) < ca) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  /* oxy(o): PaO2 and contents from alveolar PO2, shunt, low V/Q fraction, VA, CO, VO2. */
  function oxy(o) {
    var hb = o.hb, ph = o.ph, tp = o.temp, pc = o.paco2, PA = Math.max(1, o.pao2A);
    var ccI = content(PA, hb, ph, tp, pc), sh = o.shunt, fl = Math.min(o.lowvq, 0.95 - sh), co = Math.max(0.5, o.co);
    var avd = o.vo2 / (10 * co), cv = ccI - avd, ca = ccI, i, j, PL = PA, ccL = ccI;
    var vaL = 0.1 * fl * Math.max(0, o.va), qL = fl * co;
    for (i = 0; i < 14; i++) {
      if (fl > 0.001) {
        var lo = 0, hi = PA, mid;
        for (j = 0; j < 30; j++) {
          mid = (lo + hi) / 2;
          var f = vaL * 1.16 * (PA - mid) - qL * 10 * (content(mid, hb, ph, tp, pc) - cv);
          if (f > 0) lo = mid; else hi = mid;
        }
        PL = (lo + hi) / 2; ccL = content(PL, hb, ph, tp, pc);
      }
      ca = (1 - sh - fl) * ccI + fl * ccL + sh * cv;
      cv = Math.max(2, ca - avd);
    }
    var pao2 = po2From(ca, hb, ph, tp, pc);
    return { pao2: pao2, sao2: sat(pao2, ph, tp, pc), cao2: ca, cvo2: cv, ccI: ccI };
  }

  /* ---------- lung pieces ---------- */
  function pel(V, C, ui) { var vk = C * ui; return V <= vk ? V / C : ui + (V - vk) / (C * KOD); }
  function vOf(P, C, ui) { return P <= ui ? P * C : C * ui + (P - ui) * C * KOD; }
  function openOf(peff) { return 1 / (1 + Math.exp(-(peff - 12) / 4)); }
  var OPEN5 = openOf(0.7 * 5 + 0.3 * 8);
  function recTarget(s, peepTot, pmean) { return openOf(0.7 * peepTot + 0.3 * pmean); }
  function collapsed(s) { return clamp(s.p.shunt0 * s.p.recr * (1 - s.rec) / (1 - OPEN5), 0, 0.7); }
  function hco3Of(s, paco2) {
    var d = paco2 - s.p.pco2Ref;
    var buf = (d > 0 ? 0.1 * d : 0.2 * d) * Math.min(1, s.p.hco3 / 24);
    return Math.max(2, s.p.hco3 - (s.lac - s.p.lac0) + buf);
  }
  function phOf(hco3, paco2) { return 6.1 + log10(hco3 / (0.03 * paco2)); }

  function drive(s) {
    var p = s.p, m = s.m, act = 1 - m.sed;
    var chemo = clamp(1 + 5 * (7.4 - s.ch.ph) + 0.02 * (s.paco2 - 40) + 0.03 * Math.max(0, 60 - s.ch.pao2), 0, 3);
    if (chemo < 0.3 || act < 0.05 || p.rate <= 0) return { rate: 0, pmus: 0, chemo: chemo };
    return { rate: clamp(p.rate * (0.6 + 0.4 * chemo) * act, 0, 45), pmus: clamp(p.effort * chemo * act * m.effF, 0, 30), chemo: chemo };
  }

  function disconnected(s) { return s.m.discUntil > s.t; }

  /* Steady breath solution for one class of breath. */
  function solve(cl, L, Ttot) {
    var C = L.C, ce = C, i, res = null;
    for (i = 0; i < 5; i++) {
      var tauI = L.R * ce / 1000, tauE = L.Re * ce / 1000, ti;
      if (cl.k === "ps") ti = clamp(tauI * Math.log(100 / cl.cycle), 0.25, 3);
      else if (cl.k === "sp") ti = TIN;
      else ti = cl.ti;
      ti = Math.min(ti, Math.max(0.2, Ttot - 0.15));
      var te = Math.max(0.15, Ttot - ti), eE = Math.exp(-te / tauE), vt, x0;
      if (cl.k === "vc") { vt = cl.vt; x0 = vt * eE / (1 - eE); }
      else { var eI = Math.exp(-ti / tauI), x1 = ce * cl.p * (1 - eI) / (1 - eI * eE); x0 = x1 * eE; vt = Math.max(0, x1 - x0); }
      var vee = vOf(L.peepTot, C, L.ui), pplat = pel(vee + vt, C, L.ui);
      var cn = vt > 1 ? vt / Math.max(0.3, pplat - L.peepTot) : C;
      res = { vt: vt, ti: ti, te: te, x0: x0, ap: x0 / ce, pplat: pplat, ce: ce, tauI: tauI, tauE: tauE };
      ce = 0.5 * ce + 0.5 * cn;
    }
    return res;
  }

  /* mech(s, st): every ventilator and lung number for these settings and this lung state. */
  function mech(s, st) {
    var p = s.p, m = s.m, dr = drive(s), disc = disconnected(s);
    var mode = disc ? "cpap" : st.mode;
    var C = Math.max(3, p.c * (1 - collapsed(s)) * m.cF), R = p.r * m.rF, Re = R * (p.fl ? 2 : 1);
    var peep = disc ? 0 : mode === "niv" ? st.epap : mode === "aprv" ? st.plow : st.peep;
    if (!disc && m.leak > 0) peep = Math.max(0, peep - 3 * m.leak / 0.3);
    var leakF = mode === "niv" ? 0.9 : 1 - m.leak, pm = dr.pmus, peff = 0.7 * pm;
    var sens = st.trigType === "pressure" ? Math.abs(st.trigPress) : 0.3 + 0.1 * st.trigFlow;
    var L = { C: C, R: R, Re: Re, ui: p.ui, peepTot: peep };
    var ap = 0, pass, out = null;
    for (pass = 0; pass < 3; pass++) {
      var load = ap + sens;
      var fmiss = dr.rate > 0 ? (pm > 0 ? clamp((load - 0.5 * pm) / (0.5 * pm + 0.1), 0, 1) : 1) : 0;
      var trig = dr.rate * (1 - fmiss), cls = [], backup = false, apnoea = false, ineff = dr.rate * fmiss, rrT;
      if (mode === "vc" || mode === "pc") {
        ineff = dr.rate;
        cls.push(mode === "vc" ? { k: "vc", rate: st.rr, vt: st.vt, ti: st.ti, mand: true } : { k: "pc", rate: st.rr, p: st.pinsp, pset: st.pinsp, ti: st.ti, mand: true });
      } else if (mode === "acvc") {
        cls.push({ k: "vc", rate: Math.max(st.rr, trig), vt: st.vt, ti: st.ti, mand: true, assist: trig > st.rr ? peff : 0 });
      } else if (mode === "acpc" || mode === "prvc") {
        var r1_ = Math.max(st.rr, trig), share = r1_ > 0 ? Math.min(1, trig / r1_) : 0, pin = mode === "prvc" ? s.prvcP : st.pinsp;
        cls.push({ k: "pc", rate: r1_, p: pin + peff * share, pset: pin, ti: st.ti, mand: true });
      } else if (mode === "simv") {
        cls.push({ k: "vc", rate: st.rr, vt: st.vt, ti: st.ti, mand: true });
        if (trig > st.rr) cls.push({ k: st.ps > 0 ? "ps" : "sp", rate: trig - st.rr, p: st.ps + peff, pset: st.ps, cycle: st.cycle });
      } else if (mode === "psv" || mode === "cpap") {
        if (trig >= 1) cls.push(mode === "psv" && st.ps > 0 ? { k: "ps", rate: trig, p: st.ps + peff, pset: st.ps, cycle: st.cycle } : { k: "sp", rate: trig, p: peff, pset: 0 });
        else if (disc) apnoea = true;
        else {
          apnoea = true;
          if (s.apS >= st.apnoea) { backup = true; cls.push({ k: "vc", rate: st.rr, vt: st.vt, ti: st.ti, mand: true }); }
        }
      } else if (mode === "niv") {
        var psn = Math.max(0, st.ipap - st.epap);
        if (trig > 0) cls.push({ k: "ps", rate: trig, p: (psn + peff) * leakF, pset: psn, cycle: st.cycle });
        if (trig < st.rr) cls.push({ k: "pc", rate: st.rr - trig, p: psn * leakF, pset: psn, ti: st.ti, mand: true });
      }
      if (mode === "aprv") { out = aprv(s, st, L, dr); break; }
      rrT = 0; var i; for (i = 0; i < cls.length; i++) rrT += cls[i].rate;
      var Ttot = rrT > 0 ? 60 / rrT : 60, sumAp = 0, sumR = 0;
      for (i = 0; i < cls.length; i++) { cls[i].sol = solve(cls[i], L, Ttot); sumAp += cls[i].sol.ap * cls[i].rate; sumR += cls[i].rate; }
      ap = sumR > 0 ? sumAp / sumR : 0;
      L.peepTot = p.fl ? Math.max(peep + 0.2 * ap, ap) : peep + ap;
      out = { cls: cls, rrT: rrT, Ttot: Ttot, backup: backup, apnoea: apnoea, ineff: ineff, fmiss: fmiss, trig: trig };
    }
    return finishMech(s, st, out, L, peep, mode, dr, leakF, disc);
  }

  function aprv(s, st, L, dr) {
    var cyc = st.thigh + st.tlow, P = Math.max(0, st.phigh - st.plow), C = L.C, ce = C, i, sol;
    for (i = 0; i < 4; i++) {
      var tauI = L.R * ce / 1000, tauE = L.Re * ce / 1000, eI = Math.exp(-st.thigh / tauI), eE = Math.exp(-st.tlow / tauE);
      var x1 = ce * P * (1 - eI) / (1 - eI * eE), x0 = x1 * eE;
      sol = { vt: x1 - x0, ti: st.thigh, te: st.tlow, x0: x0, ap: x0 / ce, ce: ce, tauI: tauI, tauE: tauE };
      var vt = x1 - x0, pp = pel(vOf(st.plow + sol.ap, C, L.ui) + vt, C, L.ui);
      ce = 0.5 * ce + 0.5 * (vt > 1 ? vt / Math.max(0.3, pp - st.plow - sol.ap) : C);
    }
    var vHigh = vOf(st.phigh, C, L.ui), slope = (pel(vHigh + 50, C, L.ui) - pel(vHigh, C, L.ui)) / 50;
    var cHigh = 1 / Math.max(1e-3, slope), tau = L.R * cHigh / 1000;
    var spRate = dr.rate * st.thigh / cyc, spVt = cHigh * 0.7 * dr.pmus * (1 - Math.exp(-TIN / tau));
    L.peepTot = st.plow + sol.ap;
    sol.pplat = st.phigh;
    var cls = [{ k: "pc", rate: 60 / cyc, p: P, pset: P, ti: st.thigh, mand: true, sol: sol }];
    if (spRate > 0.5 && spVt > 1) cls.push({ k: "sp", rate: spRate, p: 0.7 * dr.pmus, pset: 0, sol: { vt: spVt, ti: TIN, te: 1, x0: 0, ap: 0, pplat: st.phigh, ce: cHigh, tauI: tau } });
    var rrT = cls[0].rate + (cls[1] ? cls[1].rate : 0);
    return { cls: cls, rrT: rrT, Ttot: 60 / rrT, backup: false, apnoea: false, ineff: 0, fmiss: 0, trig: spRate, aprv: true };
  }

  function finishMech(s, st, o, L, peep, mode, dr, leakF, disc) {
    var p = s.p, cls = o.cls, i, ve = 0, vtw = 0, rr = o.rrT, pm = 0, prim = null, best = -1;
    for (i = 0; i < cls.length; i++) {
      var c = cls[i], sl = c.sol;
      if (c.k === "vc") {
        var fl = sl.vt / 1000 / sl.ti;
        c.ppeak = st.flowPattern === "decel" ? Math.max(L.peepTot + L.R * 2 * fl, sl.pplat) : sl.pplat + L.R * fl;
        c.ppeak -= 0.5 * (c.assist || 0);
        c.kk = st.flowPattern === "decel" ? 0.67 : 0.5;
      } else if (c.k === "sp") { c.ppeak = (o.aprv ? st.phigh : peep) + 0.5; c.kk = 0; }
      else { c.ppeak = (o.aprv ? st.plow : peep) + c.pset; c.kk = 1; if (c.mand) sl.pplat = Math.min(sl.pplat, c.ppeak); }
      ve += c.rate * sl.vt / 1000; vtw += c.rate * sl.vt;
      pm += c.rate * sl.ti / 60 * c.kk * (c.ppeak - (o.aprv ? st.plow : peep));
      var score = (c.mand ? 1000 : 0) + c.rate;
      if (score > best) { best = score; prim = c; }
    }
    var pmean = o.aprv ? (st.phigh * st.thigh + st.plow * st.tlow) / (st.thigh + st.tlow) : peep + pm;
    var vtAvg = rr > 0 ? vtw / rr : 0, apShown = L.peepTot - peep;
    var teFrac = prim ? clamp(prim.sol.te / (prim.sol.ti + prim.sol.te), 0, 1) : 1;
    var pitp = pmean + Math.max(0, apShown) * teFrac;
    var pplat = prim ? prim.sol.pplat : L.peepTot, ppeak = prim ? prim.ppeak : peep;
    var vtP = prim ? prim.sol.vt : 0, drv = Math.max(0, pplat - L.peepTot);
    var C = L.C;
    return {
      mode: mode, disc: disc, peep: peep, peepTot: L.peepTot, autoPeep: Math.max(0, apShown), pplat: pplat, ppeak: ppeak, pmean: pmean, pitp: pitp,
      vt: vtP, vtAvg: vtAvg, ve: ve, vte: vtP * leakF, veMeasured: disc ? 0 : ve * leakF, rr: rr, ti: prim ? prim.sol.ti : 0, te: prim ? prim.sol.te : 0,
      driving: drv, cstat: drv > 0.3 ? vtP / drv : C, C: C, R: L.R, Re: L.Re, ce: prim ? prim.sol.ce : C,
      mp: 0.098 * rr * vtP / 1000 * Math.max(0, ppeak - 0.5 * drv), cls: cls, backup: o.backup, apnoea: o.apnoea,
      ineff: o.ineff, fmiss: o.fmiss, trig: o.trig, drive: dr, leakF: leakF
    };
  }

  /* model(s, st): mechanics + haemodynamics + ventilation + oxygenation + acid base, all from the state. */
  function hemoBase(vs) { return vs === "low" ? { co: 4.0, map: 72, hr: 105, k: 0.045 } : vs === "high" ? { co: 5.0, map: 88, hr: 85, k: 0.008 } : { co: 5.0, map: 85, hr: 80, k: 0.022 }; }
  function model(s, st) {
    st = norm(st);
    var p = s.p, m = s.m, mc = mech(s, st), hb0 = hemoBase(m.vs);
    var co = hb0.co * Math.max(0.35, 1 - hb0.k * Math.max(0, mc.pitp - 7)) * m.coF * (m.hypoUntil > s.t ? 0.7 : 1), cof = co / hb0.co;
    var vdA = 2.2 * p.pbw, va = 0, vdW = 0, i, dsf = Math.min(0.6, p.ds + 0.005 * Math.max(0, mc.pplat - p.ui) + 0.1 * Math.max(0, 1 - cof)), vdAlvP = 0;
    for (i = 0; i < mc.cls.length; i++) {
      var c = mc.cls[i], v = c.sol.vt, vd = vdA + dsf * v;
      va += c.rate * Math.max(0, v - vd) / 1000; vdW += c.rate * Math.min(v, vd);
      if (c === mc.cls[0]) vdAlvP = dsf * v;
    }
    var vdvt = mc.ve > 0 ? vdW / 1000 / mc.ve : 1;
    var fio2 = mc.disc || m.o2Until > s.t ? 0.21 : st.fio2 / 100;
    var hco3 = hco3Of(s, s.paco2), ph = phOf(hco3, s.paco2);
    var vco2 = p.vco2 * m.vco2F, vo2 = vco2 / RQ, temp = p.temp + m.tempAdd;
    var shunt = clamp(p.shunt0 * (1 - p.recr) + collapsed(s) + m.shuntAdd, 0.01, 0.8);
    var ox = oxy({ hb: p.hb, ph: ph, temp: temp, paco2: s.paco2, pao2A: s.pao2A, shunt: shunt, lowvq: p.lowvq, va: va, co: co, vo2: vo2 });
    var spo2 = ox.sao2 * 100, map = hb0.map * (1 - 0.6 * (1 - cof)) * (1 - 0.5 * Math.max(0, 7.2 - ph));
    var hr = hb0.hr + 50 * (1 - cof) + 0.5 * Math.max(0, 92 - spo2) + 0.4 * Math.max(0, s.paco2 - 45) + 10 * Math.max(0, temp - 37.5);
    if (spo2 < 70) { var q = spo2 / 70; hr *= q * q; map *= 0.5 + 0.5 * q; }
    hr = clamp(hr, 20, 190); map = Math.max(15, map); // floors: an agonal patient, not a number below physiology
    var pp = 45 * clamp(cof, 0.4, 1.2), vtAlv = mc.vt - vdA;
    var etco2 = mc.ve > 0.2 && vtAlv > 0 ? s.paco2 * clamp(1 - 0.05 - vdAlvP / vtAlv, 0.05, 1) : 0;
    var PAtarget = Math.max(0, fio2 * (PATM - PH2O) - s.paco2 / RQ);
    return {
      st: st, mech: mc, co: co, cof: cof, va: va, vdvt: vdvt, vdAnat: vdA, dsf: dsf, fio2: fio2, vco2: vco2, vo2: vo2, temp: temp,
      shunt: shunt, PAtarget: PAtarget, pao2A: s.pao2A, ox: ox, pao2: ox.pao2, sao2: ox.sao2, spo2: spo2, hco3: hco3, ph: ph,
      be: 0.93 * (hco3 - 24.4 + 14.83 * (ph - 7.4)), map: map, sbp: map + pp * 2 / 3, dbp: map - pp / 3, hr: hr, etco2: etco2,
      paco2: s.paco2, lactate: s.lac, vtkg: mc.vt / p.pbw
    };
  }

  /* ---------- state ---------- */
  function lowvqOf(l) { return typeof l.lowVQ === "number" ? l.lowVQ : l.flowLimited ? 0.25 : l.r >= 20 ? 0.2 : 0.01; }
  function init(scenario, override) {
    var sc = scenario || {}, pt = sc.patient || {}, lg = sc.lung || {}, start = sc.start || {}, dv = pt.drive || {}, mt = pt.metabolic || {};
    var raw = {}, k;
    var ss = start.settings || {};
    for (k in ss) if (own(ss, k)) raw[k] = ss[k];
    raw.mode = start.mode || raw.mode;
    if (override) for (k in override) if (own(override, k)) raw[k] = override[k];
    var st = norm(raw);
    var p = {
      pbw: pbw({ sex: pt.sex, heightCm: pt.heightCm || 170 }), hb: pt.hb || 13, temp: pt.temp || 37, hco3: mt.hco3 || 24, lac0: mt.lactate == null ? 1 : mt.lactate,
      vco2: pt.vco2 || 200, rate: dv.rate == null ? 12 : dv.rate, effort: dv.effort == null ? 6 : dv.effort,
      c: lg.c || 50, r: lg.r || 10, fl: !!lg.flowLimited, shunt0: lg.shunt == null ? 0.03 : lg.shunt, recr: clamp(lg.recruitable || 0, 0, 1),
      ds: lg.deadSpace || 0, pco2Ref: 40, ui: lg.upperInflection || 30, lowvq: lowvqOf(lg)
    };
    var s = {
      v: 1, id: sc.id || "custom", t: 0, p: p, rec: 1, paco2: 40, pao2A: 100, lac: p.lac0, prvcP: 15, apS: 0,
      ch: { ph: 7.4, pao2: 95 },
      m: { rF: 1, cF: 1, shuntAdd: 0, coF: 1, leak: 0, discUntil: -1, o2Until: -1, sed: clamp(dv.sedation == null ? 0.5 : dv.sedation, 0, 1), effF: 1, vco2F: 1, tempAdd: 0, vs: pt.volumeStatus || "normal", leakUntil: -1, hypoUntil: -1 },
      timeline: (sc.timeline || []).map(function (e) { return { t: e.t, event: e.event, duration: e.duration || 0 }; }),
      fired: [], harm: { vili: 0, o2h: 0, hypotMin: 0, hypoxMin: 0, baroMin: 0, apHypoMin: 0 }, settings: st, last: null, log: []
    };
    settle(s, st);
    s.settings = st;
    return s;
  }
  /* Solve the steady state at the start settings (fixed point), so the t = 0 ABG reflects them. */
  function settle(s, st) {
    var i, mo, a = 0;
    s.apS = 1e9;
    for (i = 0; i < 80; i++) {
      mo = model(s, st);
      var tgt = recTarget(s, mo.mech.peepTot, mo.mech.pmean);
      s.rec = 0.5 * s.rec + 0.5 * tgt;
      var pss = mo.va > 0.05 ? clamp(0.863 * mo.vco2 / mo.va, 10, 150) : 150;
      s.paco2 = 0.6 * s.paco2 + 0.4 * pss;
      s.p.pco2Ref = s.paco2; // scenario HCO3 is the bicarbonate at the presenting (start) PaCO2
      s.pao2A = mo.PAtarget;
      s.ch = { ph: mo.ph, pao2: mo.pao2 };
      if (st.mode === "prvc") prvcAdjust(s, st, mo.mech, 10);
      a = mo;
    }
    s.apS = mo.mech.apnoea ? 1e9 : 0;
    a = model(s, st);
    store(s, a);
  }
  function prvcAdjust(s, st, mc, n) {
    var pmax = Math.max(5, st.pPeakHigh - 5 - st.peep), i, P = s.prvcP, vt = mc.vt;
    for (i = 0; i < n; i++) {
      var need = vt > 1 ? P * st.vt / vt : P + 3;
      var nP = clamp(clamp(need, P - 3, P + 3), 5, pmax);
      vt = vt * (nP / Math.max(1, P)); P = nP;
    }
    s.prvcP = P;
  }
  function store(s, mo) {
    s.last = { pao2: mo.pao2, paco2: s.paco2, ph: mo.ph, hco3: mo.hco3, sao2: mo.sao2, be: mo.be, lactate: s.lac, fio2: mo.fio2, spo2: mo.spo2, map: mo.map };
  }

  function applyEvent(s, e) {
    var m = s.m, d = e.duration || 0;
    switch (e.event) {
      case "secretions": m.rF *= 1.5; m.shuntAdd += 0.03; break;
      case "bronchospasm": m.rF *= 2.5; break;
      case "bronchospasmEases": m.rF = 1; break;
      case "pneumothorax": m.cF *= 0.6; m.shuntAdd += 0.1; m.coF *= 0.75; break;
      case "plug": m.shuntAdd += 0.1; m.cF *= 0.85; break;
      case "disconnect": m.discUntil = s.t + (d || 30); break;
      case "cuffLeak": m.leak = 0.3; m.leakUntil = d ? s.t + d : 1e12; break;
      case "o2Failure": m.o2Until = s.t + (d || 60); break;
      case "sedationLight": m.sed = Math.max(0, m.sed - 0.5); break;
      case "sedationDeep": m.sed = 1; break;
      case "fever": m.vco2F *= 1.2; m.tempAdd += 1.5; break;
      case "hypovolaemia": m.vs = "low"; break;
      case "hypotension": m.hypoUntil = s.t + (d || 900); m.vs = "low"; break;
      case "improve":
        m.rF = 1; m.cF = 1; m.shuntAdd = 0; m.coF = 1; m.effF = 1; m.hypoUntil = -1;
        s.p.r = Math.max(8, s.p.r * 0.7); s.p.shunt0 *= 0.7; s.p.c = Math.min(100, s.p.c * 1.15);
        if (s.p.hco3 < 22) s.p.hco3 = Math.min(24, s.p.hco3 + 6);
        m.sed = Math.max(0, m.sed - 0.3); break;
      case "fluidBolus": m.vs = m.vs === "low" ? "normal" : "high"; break;
      case "fatigue": m.effF *= 0.5; break;
    }
  }

  function step(state, settings, dt) {
    var s = clone(state), st = norm(settings), left = Math.max(0, Math.min(86400, +dt || 0)), i;
    while (left > 1e-9) {
      for (i = 0; i < s.timeline.length; i++) if (s.fired.indexOf(i) < 0 && s.timeline[i].t <= s.t + 1e-9) { s.fired.push(i); applyEvent(s, s.timeline[i]); }
      if (s.m.leakUntil <= s.t) s.m.leak = 0;
      var h = Math.min(SUB, left), mo = model(s, st), mc = mo.mech, p = s.p;
      // CO2 store mass balance, exact over h
      if (mo.va > 0.05) { var pss = 0.863 * mo.vco2 / mo.va; s.paco2 = pss + (s.paco2 - pss) * Math.exp(-h / 60 * mo.va / (0.863 * K_CO2)); }
      else s.paco2 += mo.vco2 / K_CO2 * h / 60;
      s.paco2 = clamp(s.paco2, 8, 200);
      // alveolar O2 store
      var store_ = 30 * p.pbw * (1 - collapsed(s)) + mc.C * mc.peepTot, cap = store_ * 0.826 / 713;
      if (mo.va > 0.3) { var tauO = cap / (1.16 * mo.va); s.pao2A = mo.PAtarget + (s.pao2A - mo.PAtarget) * Math.exp(-h / 60 / tauO); }
      // apnoea: the store empties at VO2 / capacity; 0.5 allows for aventilatory mass flow (teaching value)
      else s.pao2A = Math.max(15, s.pao2A - mo.vo2 / Math.max(0.5, cap) * h / 60 * 0.5);
      // recruitment
      var tgt = recTarget(s, mc.peepTot, mc.pmean), tau = tgt > s.rec ? 120 : 300;
      s.rec = tgt + (s.rec - tgt) * Math.exp(-h / tau);
      if (st.mode === "prvc" && !mc.disc) prvcAdjust(s, st, mc, Math.max(1, Math.min(10, Math.round(mc.rr * h / 60))));
      s.apS = mc.apnoea ? s.apS + h : 0;
      // lactate
      var stress = Math.max(0, (80 - mo.spo2) / 20) + Math.max(0, (60 - mo.map) / 20);
      if (stress > 0) s.lac += 0.1 * stress * h / 60;
      else s.lac = p.lac0 + (s.lac - p.lac0) * Math.exp(-h / 5400);
      // harm
      var hm = s.harm, mn = h / 60;
      hm.vili += mn * (Math.max(0, mc.pplat - 30) / 5 + Math.max(0, mc.driving - 15) / 5 + Math.max(0, mo.vtkg - 8) / 2);
      if (mo.fio2 > 0.6) hm.o2h += h / 3600;
      if (mo.map < 65) hm.hypotMin += mn;
      if (mo.spo2 < 88) hm.hypoxMin += mn;
      if (mc.pplat > 35) hm.baroMin += mn;
      if (mc.autoPeep >= 5 && mo.map < 65) hm.apHypoMin += mn;
      s.t += h; left -= h;
      var after = model(s, st);
      s.ch = { ph: after.ph, pao2: after.pao2 };
      store(s, after);
    }
    s.settings = st;
    return s;
  }

  /* ---------- readout, abg, alarms ---------- */
  var FLAG = {
    vili: T("Injurious ventilation: plateau, driving pressure or VT above the protective limit", "Injurious ventilation: plateau, driving pressure या VT protective limit से ऊपर"),
    overdistension: T("Plateau above the upper inflection: overdistension", "Plateau upper inflection से ऊपर: overdistension"),
    baro: T("Plateau above 35 cmH2O: barotrauma risk", "Plateau 35 cmH2O से ऊपर: barotrauma का ख़तरा"),
    autoPeep: T("Auto-PEEP: gas trapping", "Auto-PEEP: gas trapping"),
    o2tox: T("FiO2 above 60% for hours: oxygen toxicity risk", "घंटों तक FiO2 60% से ऊपर: oxygen toxicity का ख़तरा"),
    hypotension: T("Hypotension: MAP below 65", "Hypotension: MAP 65 से कम"),
    hypoxaemia: T("Hypoxaemia", "Hypoxaemia"),
    acidosis: T("Acidaemia", "Acidaemia"),
    alkalosis: T("Alkalaemia", "Alkalaemia"),
    apnoeaBackup: T("Apnoea backup ventilation running", "Apnoea backup ventilation चल रहा है"),
    ineffective: T("Ineffective efforts: the ventilator misses breaths", "Ineffective efforts: ventilator साँसें नहीं पकड़ रहा"),
    leak: T("Leak present", "Leak है"),
    gastric: T("IPAP above 20: gastric insufflation risk", "IPAP 20 से ऊपर: पेट में हवा जाने का ख़तरा"),
    inverseRatio: T("Inverse ratio: inspiration longer than expiration", "Inverse ratio: inspiration expiration से लंबा"),
    disconnect: T("Circuit disconnected", "Circuit disconnect"),
    periArrest: T("Peri-arrest: severe hypoxaemia or no blood pressure", "Peri-arrest: गंभीर hypoxaemia या blood pressure नहीं")
  };
  function flag(id, sev) { return { id: id, severity: sev, label: FLAG[id] }; }
  function flagsOf(s, mo) {
    var mc = mo.mech, f = [], st = mo.st;
    if (mc.disc) f.push(flag("disconnect", "danger"));
    if (mo.spo2 < 60 || mo.map < 40 || mo.hr < 40) f.push(flag("periArrest", "danger"));
    if (mc.pplat > 30 || mc.driving > 15 || mo.vtkg > 8) f.push(flag("vili", mc.pplat > 35 || mc.driving > 20 ? "danger" : "warn"));
    if (mc.pplat > s.p.ui) f.push(flag("overdistension", "warn"));
    if (mc.pplat > 35) f.push(flag("baro", "danger"));
    if (mc.autoPeep >= 5) f.push(flag("autoPeep", mc.autoPeep >= 10 ? "danger" : "warn"));
    if (s.harm.o2h >= 2 && mo.fio2 > 0.6) f.push(flag("o2tox", s.harm.o2h >= 12 ? "danger" : "warn"));
    if (mo.map < 65) f.push(flag("hypotension", "danger"));
    if (mo.spo2 < 88) f.push(flag("hypoxaemia", mo.spo2 < 85 ? "danger" : "warn"));
    if (mo.ph < 7.30) f.push(flag("acidosis", mo.ph < 7.20 ? "danger" : "warn"));
    if (mo.ph > 7.50) f.push(flag("alkalosis", mo.ph > 7.55 ? "danger" : "warn"));
    if (mc.backup) f.push(flag("apnoeaBackup", "warn"));
    if (mc.ineff > 2 && mc.drive.pmus > 1) f.push(flag("ineffective", "warn"));
    if (st.mode === "niv" || s.m.leak > 0) f.push(flag("leak", s.m.leak > 0 ? "warn" : "info"));
    if (st.mode === "niv" && st.ipap > 20) f.push(flag("gastric", "warn"));
    if (mc.ti > mc.te && st.mode !== "aprv") f.push(flag("inverseRatio", "info"));
    return f;
  }
  function readout(state, settings) {
    var mo = model(state, settings || state.settings), mc = mo.mech;
    return {
      vitals: { spo2: r0(mo.spo2), hr: r0(mo.hr), sbp: r0(mo.sbp), dbp: r0(mo.dbp), map: r0(mo.map), rr: r0(mc.rr), temp: r1(mo.temp), etco2: r0(mo.etco2) },
      vent: {
        vte: r0(mc.vte), ve: r1(mc.veMeasured), ppeak: r1(mc.ppeak), pplat: r1(mc.pplat), pmean: r1(mc.pmean), peepTotal: r1(mc.peepTot),
        autoPeep: r1(mc.autoPeep), drivingP: r1(mc.driving), cstat: r0(mc.cstat), raw: r0(mc.R), rrTotal: r0(mc.rr),
        ieActual: mc.ti > 0 ? r1(mc.te / mc.ti) : 0, mechPower: r1(mc.mp)
      },
      gas: {
        pao2: r0(mo.pao2), paco2: r0(mo.paco2), ph: r2(mo.ph), hco3: r1(mo.hco3), sao2: r0(mo.sao2 * 100), be: r1(mo.be), lactate: r1(mo.lactate),
        pfRatio: r0(mo.pao2 / mo.fio2), aaGradient: r0(Math.max(0, mo.pao2A - mo.pao2)), vdvt: r2(mo.vdvt), shunt: r2(mo.shunt)
      },
      flags: flagsOf(state, mo)
    };
  }
  function abg(state) {
    var l = state.last;
    return { pH: r2(l.ph), PaCO2: r0(l.paco2), PaO2: r0(l.pao2), HCO3: r1(l.hco3), SaO2: r0(l.sao2 * 100), BE: r1(l.be), lactate: r1(l.lactate), FiO2: r2(l.fio2), t: state.t };
  }

  var ALARM = {
    pPeakHigh: T("High peak pressure", "Peak pressure ज़्यादा"), pPlatHigh: T("Plateau above 30", "Plateau 30 से ऊपर"),
    vtLow: T("Low tidal volume", "Tidal volume कम"), veLow: T("Low minute volume", "Minute volume कम"), veHigh: T("High minute volume", "Minute volume ज़्यादा"),
    apnoea: T("Apnoea", "Apnoea"), rrHigh: T("High rate", "Rate ज़्यादा"), fio2Low: T("Low FiO2", "FiO2 कम"), fio2High: T("High FiO2", "FiO2 ज़्यादा"),
    peepLow: T("Low PEEP", "PEEP कम"), peepHigh: T("High PEEP", "PEEP ज़्यादा"), disconnect: T("Disconnection", "Disconnection"),
    autoPeep: T("Auto-PEEP", "Auto-PEEP"), dyssync: T("Patient-ventilator dyssynchrony", "Patient-ventilator dyssynchrony")
  };
  function alarm(id, sev) { return { id: id, severity: sev, label: ALARM[id] }; }
  function alarms(state, settings) {
    var st = norm(settings || state.settings), mo = model(state, st), mc = mo.mech, a = [];
    var volMode = ["vc", "acvc", "simv", "prvc"].indexOf(st.mode) >= 0, setPeep = st.mode === "niv" ? st.epap : st.mode === "aprv" ? st.plow : st.peep;
    if (mc.disc) a.push(alarm("disconnect", "danger"));
    if (mc.ppeak >= st.pPeakHigh) a.push(alarm("pPeakHigh", "danger"));
    if (mc.pplat > 30) a.push(alarm("pPlatHigh", "warn"));
    if (mc.vte < 4 * state.p.pbw || (volMode && mc.vte < 0.8 * st.vt)) a.push(alarm("vtLow", "warn"));
    if (mc.veMeasured < st.veLow) a.push(alarm("veLow", "danger"));
    if (mc.veMeasured > st.veHigh) a.push(alarm("veHigh", "warn"));
    if (mc.apnoea && (state.apS >= st.apnoea || mc.disc)) a.push(alarm("apnoea", "danger"));
    if (mc.rr > st.rrHigh) a.push(alarm("rrHigh", "warn"));
    var fi = mo.fio2 * 100;
    if (fi < st.fio2Low || fi < st.fio2 - 6) a.push(alarm("fio2Low", "danger"));
    if (fi > st.fio2High || fi > st.fio2 + 6) a.push(alarm("fio2High", "warn"));
    if (!mc.disc && (mc.peep < st.peepLow || mc.peep < setPeep - 2)) a.push(alarm("peepLow", "warn"));
    if (mc.peepTot >= st.peepHigh || mc.peepTot >= setPeep + 5) a.push(alarm("peepHigh", "warn"));
    if (mc.autoPeep >= 5) a.push(alarm("autoPeep", "warn"));
    if (mc.ineff > 2 && mc.drive.pmus > 1) a.push(alarm("dyssync", "warn"));
    return a;
  }

  /* ---------- explanations ---------- */
  function fx(x, d) { return String(d ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : Math.round(x)); }
  function explainDelta(abgB, abgA, sB, sA, stB, stA) {
    var B = model(stB, sB || stB.settings), A = model(stA, sA || stA.settings), out = [];
    var CH = ["setting", "ventilator", "mechanics", "gasExchange", "abg"];
    // PaCO2
    var dC = abgA.PaCO2 - abgB.PaCO2;
    if (Math.abs(dC) >= 1) {
      var dir = dC > 0 ? "up" : "down", why = [];
      var vaUp = A.va > B.va * 1.03, vaDn = A.va < B.va * 0.97;
      if ((dir === "down" && vaUp) || (dir === "up" && vaDn)) {
        why.push(T("Alveolar ventilation went from " + fx(B.va, 1) + " to " + fx(A.va, 1) + " L/min. PaCO2 = 0.863 x VCO2 / VA.",
          "Alveolar ventilation " + fx(B.va, 1) + " से " + fx(A.va, 1) + " L/min हुआ। PaCO2 = 0.863 x VCO2 / VA।"));
        if (Math.abs(A.vdvt - B.vdvt) >= 0.03) why.push(T("Dead space fraction went from " + fx(B.vdvt, 2) + " to " + fx(A.vdvt, 2) + ".", "Dead space fraction " + fx(B.vdvt, 2) + " से " + fx(A.vdvt, 2) + " हुआ।"));
      }
      if ((dir === "up" && A.vco2 > B.vco2 * 1.03) || (dir === "down" && A.vco2 < B.vco2 * 0.97)) why.push(T("CO2 production changed from " + fx(B.vco2) + " to " + fx(A.vco2) + " mL/min.", "CO2 production " + fx(B.vco2) + " से " + fx(A.vco2) + " mL/min हुआ।"));
      if (!why.length) why.push(dir === "up" ? T("PaCO2 is still rising toward its new steady state. Body CO2 stores fill over minutes.", "PaCO2 अभी नए steady state की ओर बढ़ रहा है। शरीर के CO2 stores मिनटों में भरते हैं।")
        : T("PaCO2 is still falling toward its new steady state. Body CO2 stores empty over minutes.", "PaCO2 अभी नए steady state की ओर गिर रहा है। शरीर के CO2 stores मिनटों में खाली होते हैं।"));
      for (var i = 0; i < why.length; i++) out.push({ param: "PaCO2", direction: dir, because: why[i], chain: CH.slice() });
    }
    // PaO2: counterfactual effect of each model term
    var dO = abgA.PaO2 - abgB.PaO2;
    if (Math.abs(dO) >= 2) {
      var dirO = dO > 0 ? "up" : "down";
      var base = { hb: stB.p.hb, ph: B.ph, temp: B.temp, paco2: B.paco2, pao2A: B.PAtarget, shunt: B.shunt, lowvq: stB.p.lowvq, va: B.va, co: B.co, vo2: B.vo2 };
      var p0 = oxy(base).pao2, terms = [], k;
      var tryT = function (id, ch, txt) { var o = clone(base), x; for (x in ch) if (own(ch, x)) o[x] = ch[x]; terms.push({ id: id, eff: oxy(o).pao2 - p0, txt: txt }); };
      tryT("fio2", { pao2A: Math.max(0, A.fio2 * (PATM - PH2O) - B.paco2 / RQ) }, T("FiO2 went from " + fx(B.fio2 * 100) + " to " + fx(A.fio2 * 100) + "%, so alveolar PO2 changed from " + fx(B.PAtarget) + " to " + fx(A.PAtarget) + " mmHg.",
        "FiO2 " + fx(B.fio2 * 100) + " से " + fx(A.fio2 * 100) + "% हुआ, इसलिए alveolar PO2 " + fx(B.PAtarget) + " से " + fx(A.PAtarget) + " mmHg हुआ।"));
      tryT("shunt", { shunt: A.shunt }, T("Shunt went from " + fx(B.shunt * 100) + "% to " + fx(A.shunt * 100) + "% as lung " + (A.shunt < B.shunt ? "recruited" : "collapsed") + ".",
        "फेफड़ा " + (A.shunt < B.shunt ? "recruit हुआ" : "collapse हुआ") + ", shunt " + fx(B.shunt * 100) + "% से " + fx(A.shunt * 100) + "% हुआ।"));
      tryT("paco2", { pao2A: Math.max(0, B.fio2 * (PATM - PH2O) - A.paco2 / RQ), paco2: A.paco2 }, T("PaCO2 changed from " + fx(B.paco2) + " to " + fx(A.paco2) + ". The alveolar gas equation moves PAO2 the other way.",
        "PaCO2 " + fx(B.paco2) + " से " + fx(A.paco2) + " हुआ। Alveolar gas equation PAO2 को उल्टी दिशा में ले जाता है।"));
      tryT("co", { co: A.co }, T("Cardiac output went from " + fx(B.co, 1) + " to " + fx(A.co, 1) + " L/min. Mixed venous oxygen changed and the shunt carries it.",
        "Cardiac output " + fx(B.co, 1) + " से " + fx(A.co, 1) + " L/min हुआ। Mixed venous oxygen बदला और shunt उसे arterial blood में लाता है।"));
      tryT("va", { va: A.va }, T("Ventilation of low V/Q units changed with alveolar ventilation.", "Alveolar ventilation के साथ low V/Q units का ventilation बदला।"));
      terms.sort(function (a, b) { return Math.abs(b.eff) - Math.abs(a.eff); });
      var n0 = out.length;
      for (k = 0; k < terms.length; k++) if (Math.abs(terms[k].eff) >= 2 && (terms[k].eff > 0) === (dirO === "up")) out.push({ param: "PaO2", direction: dirO, because: terms[k].txt, chain: terms[k].id === "co" ? ["setting", "ventilator", "mechanics", "patient", "gasExchange", "abg"] : CH.slice() });
      if (out.length === n0) out.push({ param: "PaO2", direction: dirO, because: dirO === "up" ? T("Alveolar oxygen is still filling after the change.", "बदलाव के बाद alveolar oxygen अभी भर रहा है।") : T("Alveolar oxygen is still emptying after the change.", "बदलाव के बाद alveolar oxygen अभी घट रहा है।"), chain: CH.slice() });
    }
    // pH
    var dH = abgA.pH - abgB.pH;
    if (Math.abs(dH) >= 0.02) {
      var dirH = dH > 0 ? "up" : "down", hb = [];
      if (Math.abs(dC) >= 1 && (dC > 0) !== (dH > 0)) hb.push(T("PaCO2 " + (dC > 0 ? "rose" : "fell") + ", so pH " + (dH > 0 ? "rose" : "fell") + " (Henderson-Hasselbalch).", "PaCO2 " + (dC > 0 ? "बढ़ा" : "घटा") + ", इसलिए pH " + (dH > 0 ? "बढ़ा" : "घटा") + " (Henderson-Hasselbalch)।"));
      var dB = abgA.HCO3 - abgB.HCO3 - (dC > 0 ? 0.1 : 0.2) * dC;
      if (Math.abs(dB) >= 1 && (dB > 0) === (dH > 0)) hb.push(T("Metabolic bicarbonate " + (dB > 0 ? "rose" : "fell as lactate rose") + ".", "Metabolic bicarbonate " + (dB > 0 ? "बढ़ा" : "घटा, क्योंकि lactate बढ़ा") + "।"));
      if (!hb.length) hb.push(T("pH follows the PaCO2 to HCO3 ratio.", "pH, PaCO2 और HCO3 के अनुपात से चलता है।"));
      for (k = 0; k < hb.length; k++) out.push({ param: "pH", direction: dirH, because: hb[k], chain: CH.slice() });
    }
    var dL = abgA.lactate - abgB.lactate;
    if (Math.abs(dL) >= 0.5) out.push({ param: "lactate", direction: dL > 0 ? "up" : "down", because: dL > 0 ? T("Oxygen delivery was too low: hypoxaemia or low blood pressure.", "Oxygen delivery बहुत कम था: hypoxaemia या कम blood pressure।") : T("Oxygen delivery recovered and lactate is clearing.", "Oxygen delivery सुधरा और lactate साफ़ हो रहा है।"), chain: ["patient", "abg"] });
    return out;
  }

  var WHATIF_CHAIN = {
    fio2: ["setting", "ventilator", "gasExchange", "monitor", "abg"],
    rr: ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg"],
    vt: ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"],
    peep: ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"]
  };
  function whatIf(state, settings, change) {
    var st = norm(settings || state.settings), s2 = clone(st);
    s2[change.key] = change.to;
    s2 = norm(s2);
    var frozen = clone(state), i;
    for (i = 0; i < frozen.timeline.length; i++) if (frozen.fired.indexOf(i) < 0) frozen.fired.push(i); // isolate the change
    var after = step(frozen, s2, 1800);
    return { before: readout(state, st), after: readout(after, s2), chain: (WHATIF_CHAIN[change.key] || CHAIN_STEPS).slice() };
  }

  /* ---------- waveform simulator (equation of motion, Euler) ---------- */
  function simulate(o) {
    var C = o.C, R = o.R, Re = o.Re, ui = o.ui || 40, peep = o.peep, V = vOf(peep, C, ui) + (o.v0 || 0), dt = Math.min(0.005, R * C / 1000 / 5);
    var t, trace = [], vb = o.vent, ef = o.efforts, i, active = null, psPeak = 0, ends = {}, marks = { trigger: [], cycle: [] };
    for (t = 0; t <= o.dur + 1e-9; t += dt) {
      var pm = 0;
      for (i = 0; i < ef.length; i++) {
        var e = ef[i];
        if (t >= e.start && t < e.start + e.tin) pm -= e.amp * Math.sin(Math.PI * (t - e.start) / e.tin);
        if (e.expAmp && t >= e.start + e.tin && t < e.start + e.tin + 0.5) pm += e.expAmp * Math.sin(Math.PI * (t - e.start - e.tin) / 0.5);
      }
      active = null;
      for (i = 0; i < vb.length; i++) {
        var b = vb[i], end = ends[i] != null ? ends[i] : b.start + (b.ti || 3);
        if (t >= b.start && t < end) { active = b; active._i = i; break; }
      }
      var palv = pel(V, C, ui) + pm, q, paw;
      if (active && active.type === "vc") {
        var tt = t - active.start;
        q = active.flowPattern === "decel" ? 2 * active.vt / 1000 / active.ti * (1 - tt / active.ti) : active.vt / 1000 / active.ti;
        paw = palv + q * R;
      } else if (active) {
        var pset = peep + active.p * Math.min(1, (t - active.start) / (active.rise || 0.1));
        q = (pset - palv) / R; paw = pset;
        if (active.type === "ps") {
          if (t - active.start < 0.05) psPeak = 0;
          if (q > psPeak) psPeak = q;
          if (t - active.start > 0.15 && q < psPeak * active.cycle / 100) ends[active._i] = t + dt;
        }
      } else { paw = peep; q = (peep - palv) / ((peep - palv) < 0 ? Re : R); }
      V += q * 1000 * dt;
      trace.push([t, paw, q * 60, V, pm]);
    }
    for (i = 0; i < vb.length; i++) {
      if (vb[i].triggered) marks.trigger.push(vb[i].start);
      marks.cycle.push(ends[i] != null ? ends[i] : vb[i].start + (vb[i].ti || 3));
    }
    return { trace: trace, marks: marks };
  }
  function resample(sim, t0, t1, n, events) {
    var tr = sim.trace, out = { t: [], paw: [], flow: [], vol: [], pmus: [], marks: { trigger: [], cycle: [] }, events: events || [] }, i, j = 0, vRef = null;
    for (i = 0; i < n; i++) {
      var t = t0 + (t1 - t0) * i / (n - 1);
      while (j < tr.length - 1 && tr[j + 1][0] <= t) j++;
      var row = tr[j];
      if (vRef === null) vRef = row[3];
      out.t.push(r2(t - t0)); out.paw.push(r1(row[1])); out.flow.push(r1(row[2])); out.vol.push(r0(row[3] - vRef)); out.pmus.push(r1(row[4]));
    }
    var mn = Math.min.apply(null, out.vol);
    for (i = 0; i < out.vol.length; i++) out.vol[i] -= mn;
    for (i = 0; i < sim.marks.trigger.length; i++) if (sim.marks.trigger[i] >= t0 && sim.marks.trigger[i] <= t1) out.marks.trigger.push(r2(sim.marks.trigger[i] - t0));
    for (i = 0; i < sim.marks.cycle.length; i++) if (sim.marks.cycle[i] >= t0 && sim.marks.cycle[i] <= t1) out.marks.cycle.push(r2(sim.marks.cycle[i] - t0));
    for (i = 0; i < out.events.length; i++) out.events[i].t = r2(out.events[i].t - t0);
    return out;
  }

  function breath(state, settings, nPoints) {
    var st = norm(settings || state.settings), mo = model(state, st), mc = mo.mech, n = nPoints || 120;
    var pm = mc.drive.pmus, vent = [], ef = [], events = [], k, t = 0, cycles = 6, span;
    if (st.mode === "aprv" && !mc.disc) {
      span = st.thigh + st.tlow;
      var spPer = mc.drive.rate > 0 ? 60 / mc.drive.rate : 0;
      for (k = 0; k < cycles; k++, t += span) {
        vent.push({ type: "pc", p: st.phigh - st.plow, ti: st.thigh, start: t, rise: st.rise });
        if (pm > 0 && spPer > 0) for (var u = t + 0.5; u + TIN < t + st.thigh; u += spPer) ef.push({ start: u, tin: TIN, amp: pm });
      }
    } else {
      var seq = mc.cls.length > 1 ? [mc.cls[0], mc.cls[1]] : [mc.cls[0]], period = mc.rr > 0 ? 60 / mc.rr : 6;
      var assisted = ["acvc", "acpc", "prvc"].indexOf(mc.mode) >= 0 && mc.trig >= mc.rr * 0.95;
      span = period * seq.length;
      for (k = 0; k < cycles * seq.length; k++, t += period) {
        var c = seq[k % seq.length], trig = !!c && (!c.mand || assisted), b = null;
        if (c && c.k === "vc") b = { type: "vc", vt: c.vt, ti: c.sol.ti, flowPattern: st.flowPattern };
        else if (c && c.k !== "sp") b = { type: c.k, p: c.pset * mc.leakF, ti: c.k === "ps" ? 3 : c.sol.ti, cycle: c.cycle || 25, rise: st.rise };
        if (b) { b.start = t + (trig ? 0.1 : 0); b.triggered = trig; vent.push(b); }
        if (pm > 0 && (trig || !c)) ef.push({ start: t, tin: TIN, amp: pm });
        if (pm > 0 && (mc.fmiss >= 0.3 || mc.mode === "vc" || mc.mode === "pc") && period > 2) {
          ef.push({ start: t + period * 0.6, tin: TIN * 0.7, amp: pm }); events.push({ t: t + period * 0.6, id: "ineffectiveTrigger" });
        }
      }
    }
    var sim = simulate({ C: mc.C, R: mc.R, Re: mc.Re, ui: state.p.ui, peep: mc.peep, dur: t, vent: vent, efforts: ef });
    var keep = [], i;
    for (i = 0; i < events.length; i++) if (events[i].t >= t - span) keep.push(events[i]);
    return resample(sim, t - span, t, n, keep);
  }

  var DYS = {
    doubleTrigger: T("Double trigger", "Double trigger"), ineffectiveTrigger: T("Ineffective trigger", "Ineffective trigger"),
    autoTrigger: T("Auto-trigger", "Auto-trigger"), flowStarvation: T("Flow starvation", "Flow starvation"),
    prematureCycle: T("Premature cycling", "Premature cycling"), delayedCycle: T("Delayed cycling", "Delayed cycling"),
    reverseTrigger: T("Reverse triggering", "Reverse triggering")
  };
  function dyssync(kind, settings) {
    var st = norm(settings), peep = st.peep, C = 45, R = 12, Re = 12, vent = [], ef = [], ev = [], per = 4, k, n = 160;
    var vt = st.vt, ti = st.ti;
    for (k = 0; k < 3; k++) {
      var t0 = k * per;
      if (kind === "doubleTrigger") {
        vent.push({ type: "vc", vt: vt, ti: 0.8, start: t0 + 0.1, triggered: true }); vent.push({ type: "vc", vt: vt, ti: 0.8, start: t0 + 0.95, triggered: true });
        ef.push({ start: t0, tin: 1.8, amp: 12 }); ev.push({ t: t0 + 0.95, id: kind });
      } else if (kind === "ineffectiveTrigger") {
        R = 25; Re = 50;
        vent.push({ type: "ps", p: st.ps || 10, ti: 3, cycle: 25, start: t0 + 0.1, triggered: true });
        ef.push({ start: t0, tin: 1.0, amp: 8 }); ef.push({ start: t0 + 2.2, tin: 0.8, amp: 6 }); ev.push({ t: t0 + 2.2, id: kind });
      } else if (kind === "autoTrigger") {
        vent.push({ type: "ps", p: st.ps || 10, ti: 3, cycle: 25, start: t0 + 0.1, triggered: true }); vent.push({ type: "ps", p: st.ps || 10, ti: 3, cycle: 25, start: t0 + 2.1, triggered: true });
        ev.push({ t: t0 + 2.1, id: kind });
      } else if (kind === "flowStarvation") {
        vent.push({ type: "vc", vt: vt, ti: 1.2, start: t0 + 0.1, triggered: true });
        ef.push({ start: t0, tin: 1.2, amp: 14 }); ev.push({ t: t0 + 0.5, id: kind });
      } else if (kind === "prematureCycle") {
        vent.push({ type: "ps", p: st.ps || 10, ti: 3, cycle: 70, start: t0 + 0.1, triggered: true });
        ef.push({ start: t0, tin: 1.6, amp: 10 }); ev.push({ t: t0 + 0.6, id: kind });
      } else if (kind === "delayedCycle") {
        R = 25; Re = 40;
        vent.push({ type: "ps", p: st.ps || 14, ti: 3, cycle: 5, start: t0 + 0.1, triggered: true });
        ef.push({ start: t0, tin: 0.7, amp: 8, expAmp: 7 }); ev.push({ t: t0 + 0.9, id: kind });
      } else if (kind === "reverseTrigger") {
        vent.push({ type: "vc", vt: vt, ti: ti, start: t0 + 0.1, triggered: false });
        ef.push({ start: t0 + 0.7, tin: 0.9, amp: 8 }); ev.push({ t: t0 + 0.7, id: kind });
      } else return { ok: false, error: T("Unknown dyssynchrony kind.", "अज्ञात dyssynchrony kind।") };
    }
    var sim = simulate({ C: C, R: R, Re: Re, ui: 40, peep: peep, dur: 3 * per, vent: vent, efforts: ef });
    var keep = [], i;
    for (i = 0; i < ev.length; i++) if (ev[i].t >= per) keep.push(ev[i]);
    var o = resample(sim, per, 3 * per, n, keep);
    o.kind = kind; o.label = DYS[kind];
    return o;
  }

  /* ---------- score ---------- */
  function inR(x, r) { return r && x >= r[0] && x <= r[1]; }
  function score(run) {
    run = run || {};
    var sc = run.scenario || {}, g = run.goals || sc.goals || {}, pt = sc.patient || {}, log = run.log || [], notes = [];
    var spo2R = g.spo2 || [92, 98], pplatMax = g.pplatMax || 30, drvMax = g.drivingMax || 15, vtR = g.vtPerKg || [4, 8];
    var kg = pt.heightCm ? pbw(pt) : null, n = log.length, i, oxOK = 0, vOK = 0, prOK = 0, alOK = 0, unsafe = 0, backup = 0, ineff = 0, tGoal = null;
    for (i = 0; i < n; i++) {
      var r = log[i].readout || { vitals: {}, vent: {}, gas: {}, flags: [] }, f = r.flags || [], j;
      var o = inR(r.vitals.spo2, spo2R) && !(r.vitals.spo2 > spo2R[1] && (log[i].settings || {}).fio2 > 50);
      var v = g.ph ? inR(r.gas.ph, g.ph) : inR(r.gas.paco2, g.paco2 || [35, 45]);
      var vk = kg ? r.vent.vte / kg : null;
      var pr = r.vent.pplat <= pplatMax && r.vent.drivingP <= drvMax && (vk === null || inR(vk, [vtR[0] - 0.5, vtR[1] + 0.5]));
      var dg = false;
      for (j = 0; j < f.length; j++) { if (f[j].severity === "danger") dg = true; if (f[j].id === "apnoeaBackup") backup++; if (f[j].id === "ineffective") ineff++; }
      if (o) oxOK++; if (v) vOK++; if (pr) prOK++; if (!dg) alOK++;
      if (o && v && pr && tGoal === null) tGoal = log[i].t;
      if (r.vent.pplat > 35 || r.vitals.spo2 < 85 || (vk !== null && vk > 10) || (r.vent.autoPeep >= 10 && r.vitals.map < 65)) unsafe++;
    }
    var fr = function (x) { return n ? x / n : 0; };
    var ans = run.answers || [];
    function ansFrac(kind) { var c = 0, t = 0, k; for (k = 0; k < ans.length; k++) if (ans[k] && ans[k].kind === kind) { t++; if (ans[k].correct) c++; } return t ? c / t : null; }
    var first = n ? (log[Math.min(n - 1, 1)].readout || null) : null, init = 0;
    if (first) init = (inR(first.vitals.spo2, [Math.min(spo2R[0], 88), 100]) ? 4 : 0) + (first.vent.pplat <= pplatMax ? 3 : 0) + (kg && inR(first.vent.vte / kg, vtR) || !kg ? 3 : 0);
    var aa = ansFrac("alarm"), ab = ansFrac("abg");
    var last = n ? log[n - 1].readout : null;
    var parts = {
      mode: n ? Math.round(10 * (1 - fr(backup)) * (1 - 0.5 * fr(ineff))) : 0,
      initial: init,
      oxygenation: Math.round(15 * fr(oxOK)),
      ventilation: Math.round(15 * fr(vOK)),
      protection: Math.round(20 * fr(prOK)),
      alarms: Math.round(10 * (aa === null ? fr(alOK) : aa)),
      abg: Math.round(10 * (ab === null ? (last && (g.ph ? inR(last.gas.ph, g.ph) : inR(last.gas.paco2, g.paco2 || [35, 45])) ? 1 : 0) : ab)),
      time: tGoal === null ? 0 : Math.round(10 * clamp(1 - (tGoal - 900) / 2700, 0, 1)),
      unsafe: -Math.min(30, unsafe * 5)
    };
    var total = 0, k;
    for (k in parts) if (own(parts, k)) total += parts[k];
    if (fr(prOK) < 0.8) notes.push(T("Keep plateau at or below " + pplatMax + " and driving pressure at or below " + drvMax + ".", "Plateau " + pplatMax + " या कम और driving pressure " + drvMax + " या कम रखें।"));
    if (fr(oxOK) < 0.8) notes.push(T("SpO2 was outside the target range for long periods.", "SpO2 लंबे समय तक target range से बाहर रहा।"));
    if (fr(vOK) < 0.8) notes.push(T("Ventilation goal was not met for much of the run.", "Run के बड़े हिस्से में ventilation लक्ष्य पूरा नहीं हुआ।"));
    if (backup) notes.push(T("The patient needed apnoea backup: the mode did not match the drive to breathe.", "मरीज़ को apnoea backup चाहिए था: mode साँस की drive से मेल नहीं खाता था।"));
    if (unsafe) notes.push(T("Unsafe moments: very high plateau, severe hypoxaemia, large VT or trapping with hypotension.", "असुरक्षित पल: बहुत ऊँचा plateau, गंभीर hypoxaemia, बड़ा VT या trapping के साथ hypotension।"));
    if (!notes.length) notes.push(T("Goals met safely. Well done.", "लक्ष्य सुरक्षित रूप से पूरे हुए। बहुत अच्छा।"));
    return { total: clamp(Math.round(total), 0, 100), parts: parts, notes: notes };
  }

  return {
    id: "vent-engine", kind: "sim-engine", review: "ai_drafted", version: 1,
    title: T("Ventilator lab physiology engine", "Ventilator lab physiology engine"),
    disclaimer: T("Educational simulator. Not a real ventilator and not a guide to treating a real patient.", "शैक्षिक simulator। यह असली ventilator नहीं है और असली मरीज़ के इलाज की guide नहीं है।"),
    sources: SOURCES, MODES: MODES, SETTINGS: SETTINGS, EVENTS: EVENTS, CHAIN_STEPS: CHAIN_STEPS, CHAIN_LABELS: CHAIN_LABELS, DYSSYNC: DYS,
    constants: { kCO2: K_CO2, overdistensionFactor: KOD, neuralTi: TIN, substep: SUB, plateauMax: 30, drivingMax: 15 },
    init: init, step: step, breath: breath, readout: readout, abg: abg, explainDelta: explainDelta, alarms: alarms,
    dyssync: dyssync, whatIf: whatIf, score: score, pbw: pbw, normSettings: norm
  };
});
