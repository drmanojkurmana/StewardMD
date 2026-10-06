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
      recruiting, 8 s when derecruiting (collapse takes seconds once PEEP is lost: Katz 1981; Gattinoni and
      Chiumello). Hysteresis: a sharp fall of Peff (more than 5 below its pre-collapse level, as in a disconnect)
      stores a memory h (0 to 1, the share of open units lost); open* is then computed at Peff - 6 h, so the lung
      stays partly closed at the old PEEP. h fades in 60 s once Peff is 2 above the pre-collapse level (recruit),
      else with tau 30 min. Opening midpoint 12, width 4, shift 6 and the time constants are teaching values.
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
   3. PATIENT EFFORT AND CHEMOREFLEX. chemo = 1 + 5 (7.40 - pH) + 0.02 (PaCO2 - 40) + 0.03 max(0, 60 - PaO2)
      + 0.04 per % SpO2 below 94 (dyspnoea and hypoxic drive fall as support restores oxygenation), clamped 0 to 3; below 0.3 the patient is apnoeic (apnoeic threshold). Sedation s (0 to 1) scales it:
      Pmus = effort x chemo x (1 - s); rate = drive rate x (0.6 + 0.4 chemo) x (1 - s). Teaching gains.
      Mean effective pressure of an effort = 0.7 Pmus over a neural Ti of 1.0 s.
      Triggering load = (PEEPtotal - PEEPe) + sensitivity (pressure trigger |set|; flow trigger 0.3 + 0.1 x L/min);
      in a flow-limited lung external PEEP up to about 80% of PEEPi removes this load without raising PEEPtotal.
      Missed (ineffective) efforts = clamp((load - 0.5 Pmus) / (0.5 Pmus + 0.1), 0, 1): auto-PEEP must be
      overcome before the ventilator sees the effort (Tobin, Principles and Practice of Mechanical Ventilation).
   4. MODES. vc and pc are controlled (efforts do not trigger); acvc, acpc and prvc are assist control; simv gives
      set VC breaths plus pressure-supported spontaneous breaths; psv is patient-triggered, flow-cycled; cpap gives
      no inspiratory support; prvc moves the pressure up to 3 cmH2O per breath toward the target VT, capped 5 below
      the peak pressure alarm; niv is IPAP/EPAP with a timed backup rate and a 10% leak; aprv is Phigh/Plow/Thigh/Tlow
      with unsupported breathing at Phigh. In PSV and CPAP the patient is apnoeic when breaths come further apart than
      the apnoea time (60 / rate > apnoea s) or are smaller than the anatomic dead space; after the apnoea time the
      apnoea alarm sounds and backup VC (set VT and rate) runs, as real ventilators do.
      Volume breaths are pressure limited: inspiration ends when Paw reaches the peak pressure alarm (vcLimit), so
      delivered VT falls and vtLow / veLow fire. Displayed VT, Ti and EtCO2 come from the breath class carrying the
      most minute volume; peak and plateau are the highest over the classes, and plateau never exceeds peak.
   5. VENTILATION (West). VD = anatomic 2.2 mL/kg PBW + alveolar (deadSpace x VT, + 0.005 per cmH2O plateau above UI,
      + 0.1 x fractional fall in cardiac output, + 1.6 x (trapped volume / FRC - 0.1) when gas trapping exceeds 10%
      of FRC (30 mL/kg PBW): hyperinflation squeezes alveolar capillaries, so a high rate in asthma or COPD adds dead
      space and does not clear CO2 (Tuxen and Lane 1987; Leatherman 2015); capped at 0.6). VA = sum of rate x (VT - VD). Steady state PaCO2 = 0.863 VCO2 / VA.
      Kinetics from a CO2 store mass balance: dPaCO2/dt = (VCO2 - VA x PaCO2 / 0.863) / K, K = 40 mL/mmHg, giving an
      apnoeic rise of about 5 mmHg/min and a time constant near 8 min at normal VA (teaching value; ABG equilibrates
      in 10 to 30 min after a change). PBW (ARDSNet 2000): men 50, women 45.5, + 0.91 (height cm - 152.4).
      EtCO2 = PaCO2 x (1 - 0.05 - 0.5 VDalv / (VT - VDanat)) (Bohr; normal gap 2 to 5 mmHg, wider with dead space;
      0.5 because end-tidal gas comes last from slow, CO2-rich units; teaching value).
   6. OXYGENATION. Alveolar gas equation PAO2 = FiO2 (760 - 47) - PaCO2 / 0.8 is the target; PAO2 approaches it
      with an FRC oxygen store (30 mL/kg PBW x (1 - collapsed) + C x PEEPtotal) washed by VA, so apnoea or disconnection
      desaturates over minutes. Shunt = shunt x (1 - recruitable) + collapsed fraction + events.
      A low V/Q compartment (perfusion fraction lowVQ, V/Q 0.1 of the mean; default 0.25 when flow limited, 0.2 when
      R is 20 or more, else 0.01; scenario lung.lowVQ overrides) solves its own O2 mass balance: VA_L x 1.16 x (PAO2 - P) = Q_L x 10 x (Cc'(P) - CvO2).
      CaO2 = sum of compartment contents; CvO2 = CaO2 - VO2 / (10 CO), iterated to a fixed point (West; Nunn).
      Content = 1.34 Hb SO2 + 0.003 PO2. SO2 by Severinghaus 1979 with the Kelman 1966 virtual PO2 correction for pH,
      temperature and PCO2 (same equations as narke-models/explorer-odc.js). VO2 = VCO2 / 0.8. SpO2 = SaO2.
   7. ACID BASE. HCO3 = scenario HCO3 - (lactate - baseline lactate) + acute CO2 buffering along the textbook lines
      (+1 per 10 mmHg PaCO2 above 40, -2 per 10 below 40): buffer(P) = 0.1 (P - 40) above 40, 0.2 (P - 40) below,
      and HCO3 moves by buffer(PaCO2) - buffer(reference). pH = 6.1 + log10(HCO3 / (0.03 PaCO2)) (Henderson-Hasselbalch).
      Buffering is scaled by HCO3 / 24 below 24 (less buffer base in severe metabolic acidosis; teaching value).
      The reference is the start PaCO2, so scenario HCO3 is the presenting value. A scenario may give start.abg.PaCO2,
      the presenting PaCO2 from the patient's own breathing before the ventilator took over (DKA compensation, acute on
      chronic hypercapnia). init() then holds that PaCO2 at t = 0 and the CO2 store carries it to the new steady state
      over minutes, so the first gas shows the story and the effect of the start settings appears with time.
      Standard base excess (Van Slyke, CLSI C46): BE = 0.93 (HCO3 - 24.4 + 14.83 (pH - 7.40)).
      Lactate rises 0.1 mmol/L/min per unit stress, stress = max(0, (80 - SpO2) / 20) + max(0, (60 - MAP) / 20);
      without stress it clears to baseline with a 90 min time constant (teaching values).
   8. HAEMODYNAMICS. Mean intrathoracic (alveolar) pressure = Pmean + auto-PEEP x expiratory fraction.
      CO = CO0 x clamp(1 - k (Pitp - 7), 0.35, 1.1) x event factor; k per cmH2O: low volume 0.045, normal 0.022,
      high -0.005 (venous return falls as intrathoracic pressure rises: Guyton; in a full circulation with a failing
      left ventricle, pressure lowers LV afterload and CO may rise slightly: Pinsky). Baselines: low volume CO0 4.0, MAP 72,
      HR 105; normal 5.0, 85, 80; high 5.0, 88, 85. MAP = MAP0 (1 - 0.6 (1 - CO/CO0)) (partial baroreflex), x
      (1 - 0.5 (7.2 - pH)) below pH 7.2. HR = HR0 + 50 (1 - CO/CO0) + 0.5 per % SpO2 below 92 + 0.4 per mmHg PaCO2 above 45
      + 10 per degree above 37.5; SpO2 below 70 brings bradycardia (HR x (SpO2/70)^2) and falling MAP. Teaching gains.
   9. HARM. VILI index accumulates per minute: (Pplat - 30) / 5 + (driving P - 15) / 5 + (VT/kg PBW - 8) / 2, each
      only above its limit (ARDSNet 2000; Amato 2015; kb/clinical-protocols/ards-lung-protective-ventilation.json).
      Oxygen hours above FiO2 60%; minutes of hypotension, hypoxaemia, plateau above 35 and auto-PEEP with hypotension.
   10. EVENTS (scenario timeline, see EVENTS): secretions (R x1.5, shunt +0.03), bronchospasm (R x2.5), pneumothorax
      (C x0.6, shunt +0.10, CO x0.75), disconnect (no ventilator, PEEP 0, room air; duration default 30 s), hypotension
      (CO x0.7 for duration default 900 s, volume status low), fever (VCO2 x1.2, +1.5 degrees), improve (event insults
      cleared; R x0.7, shunt x0.7, c x1.15, sedation -0.3; HCO3 rises toward +6 (up to 24, if below 22) first order,
      tau 20 min). Also plug, cuffLeak, o2Failure, sedationLight, sedationDeep, hypovolaemia, fluidBolus, fatigue,
      bronchospasmEases. A pneumothorax stays until the learner decompresses it. An event may carry requires
      {key, min} (fires once that setting reaches min) or {action} (fires after that learner action), or a list of
      these meaning ANY of them (e.g. [{key:"epap",min:8},{key:"peep",min:8}]).
      whatIf() marks pending events as fired, so its 30 min result shows only the one setting change.
      whatIf change may carry also: {key: value} for a combined change (e.g. lower VT and raise rate together).
   11. LEARNER ACTIONS. E.ACTIONS = { decompress, suction, bag100 }, each {id, label {en, hi}, available(state)}.
      E.act(state, id) -> new state (pure; logs {t, id} in state.acts). decompress: needle then drain, undoes every
      pneumothorax (C, shunt, CO), available until a drain is in. suction: clears secretions and mucus plugs (R,
      shunt, C). bag100: 60 s of hand bagging off the circuit at FiO2 1.0, about 7 mL/kg PBW x 12 a minute, no
      PEEP valve (so a recruitable lung derecruits); the ventilator shows a disconnect alarm and VTe 0.
   12. SCORE. VT per kg PBW is scored only in modes where the ventilator sets the breath (not psv, cpap, niv).
      Unsafe moments are not counted for 5 min (plus the event's duration) after a scripted harmful event. Round 2:
      time-weighted, half time on target and half end state, honest goals-met reporting (see score()).
   13. ALARMS. Priorities follow IEC 60601-1-8 (danger = high, warn = medium); each alarm carries a bedside checklist
      and its bedside actions (planOf). High EtCO2 (capnograph, limit 50 or the scenario's monitor.etco2High) shows
      hypoventilation before a blood gas. readout().oxygenHelp says why SpO2 is below goal (fixed vs recruitable
      shunt) and what to try next.
   Settings also accept flowPattern "square" | "decel" for volume breaths (not in SETTINGS until learn.json covers it).
   Integration: step() sub-steps at 10 s or less with exact exponential updates, so dt from 1 s to 3600 s is stable.
   Teaching gains marked above are model choices for a clinical reviewer to tune, not measured patient data.
   CALIBRATION. Scenario numbers (narke/vent/scenarios.json) are tuned so the t = 0 gas matches each story, a
   good-practice strategy meets the scenario goals within 60 min and a typical mistake shows its harm. The runs are
   fixed in test/narke-vent-strategies.mjs, checked by test/narke-vent-engine.test.mjs and printed by
   tools/narke-vent-audit.mjs. */
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

  var LAG = 0.6, HYPER_DS = 0.03, VEI0 = 12, HYPER_MAX = 0.45, DS_MAX = 0.6, ARREST_S = 120, HYS_P = 6, K_CO2 = 40, KOD = 0.5, PATM = 760, PH2O = 47, RQ = 0.8, TIN = 1.0, SUB = 10;

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
    { label: "Katz JA et al. Time course and mechanisms of lung-volume increase with PEEP in acute pulmonary failure. Anesthesiology 1981;54:9-16 (fast loss of volume when PEEP is removed)" },
    { label: "Tuxen DV, Lane S. The effects of ventilatory pattern on hyperinflation, airway pressures, and circulation in mechanical ventilation of patients with severe air-flow obstruction. Am Rev Respir Dis 1987;136:872-879" },
    { label: "Thille AW et al. Patient-ventilator asynchrony during assisted mechanical ventilation. Intensive Care Med 2006;32:1515-1522 (delayed cycling, ineffective triggering)" },
    { label: "Pinsky MR. Heart-lung interactions (positive pressure lowers LV afterload in heart failure)" },
    { label: "StewardMD reviewed protocols: kb/clinical-protocols/ards-lung-protective-ventilation.json, acute-respiratory-failure-niv-hfnc.json, acute-asthma-adult.json, copd-exacerbation.json" }
  ];

  var CHAIN_STEPS = ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"];
  var CHAIN_LABELS = {
    setting: T("Setting", "सेटिंग"), ventilator: T("Ventilator delivers", "Ventilator देता है"),
    mechanics: T("Lung mechanics", "फेफड़े की mechanics"), waveforms: T("Waveforms", "Waveforms (तरंगें)"),
    gasExchange: T("Gas exchange", "गैस का आदान प्रदान"), monitor: T("Monitor", "मॉनिटर"), abg: T("ABG", "ABG"), patient: T("Patient", "मरीज़")
  };

  var TRIG = ["trigType", "trigFlow", "trigPress"];
  function M(id, en, hi, controls, level) { return { id: id, title: T(en, hi), controls: controls, level: level }; }
  var MODES = {
    vc: M("vc", "Volume control (controlled)", "Volume control (पूरी तरह मशीन नियंत्रित)", ["fio2", "peep", "vt", "rr", "ti"], 1),
    acvc: M("acvc", "Assist control, volume (AC-VC)", "Assist control, volume (AC-VC): मरीज़ trigger कर सकता है", ["fio2", "peep", "vt", "rr", "ti"].concat(TRIG), 1),
    pc: M("pc", "Pressure control (controlled)", "Pressure control (पूरी तरह मशीन नियंत्रित)", ["fio2", "peep", "pinsp", "rr", "ti", "rise"], 2),
    acpc: M("acpc", "Assist control, pressure (AC-PC)", "Assist control, pressure (AC-PC): मरीज़ trigger कर सकता है", ["fio2", "peep", "pinsp", "rr", "ti", "rise"].concat(TRIG), 2),
    simv: M("simv", "SIMV (volume) with pressure support", "SIMV (volume) और pressure support", ["fio2", "peep", "vt", "rr", "ti", "ps", "cycle"].concat(TRIG), 3),
    psv: M("psv", "Pressure support (PSV)", "Pressure support (PSV): हर साँस मरीज़ शुरू करता है", ["fio2", "peep", "ps", "cycle", "rise"].concat(TRIG), 2),
    cpap: M("cpap", "CPAP (no inspiratory support)", "CPAP (inspiratory support नहीं)", ["fio2", "peep"].concat(TRIG), 2),
    prvc: M("prvc", "Pressure regulated volume control (PRVC)", "Pressure regulated volume control (PRVC): pressure से तय volume", ["fio2", "peep", "vt", "rr", "ti"].concat(TRIG), 3),
    niv: M("niv", "Non-invasive BiPAP (IPAP and EPAP)", "Non-invasive BiPAP (IPAP और EPAP)", ["fio2", "ipap", "epap", "rr", "ti", "cycle", "rise"].concat(TRIG), 3),
    aprv: M("aprv", "Airway pressure release ventilation (APRV)", "Airway pressure release ventilation (APRV): ऊँचे pressure से छोटी release", ["fio2", "phigh", "plow", "thigh", "tlow"], 4)
  };

  function S(en, hi, unit, min, max, step, def, level) { return { label: T(en, hi), unit: unit, min: min, max: max, step: step, "default": def, level: level }; }
  var SETTINGS = {
    fio2: S("FiO2", "FiO2", "%", 21, 100, 1, 40, 1),
    peep: S("PEEP", "PEEP", "cmH2O", 0, 24, 1, 5, 1),
    vt: S("Tidal volume", "हर साँस का volume (tidal volume)", "mL", 200, 1000, 10, 450, 1),
    rr: S("Set rate", "तय साँस दर (set rate)", "/min", 4, 40, 1, 14, 1),
    pinsp: S("Inspiratory pressure above PEEP", "PEEP के ऊपर inspiratory pressure", "cmH2O", 5, 40, 1, 15, 2),
    ps: S("Pressure support", "साँस में pressure सहारा (pressure support)", "cmH2O", 0, 30, 1, 10, 2),
    ti: S("Inspiratory time", "साँस अंदर लेने का समय (Ti)", "s", 0.4, 3.0, 0.1, 1.0, 2),
    ie: { label: T("I:E ratio (derived)", "I:E अनुपात (गणना से)"), unit: "1:x", min: 0.2, max: 10, step: 0.1, "default": null, level: 2, derived: true },
    trigType: { label: T("Trigger type", "Trigger का प्रकार"), unit: "", options: ["flow", "pressure"], "default": "flow", level: 3 },
    trigFlow: S("Flow trigger", "Flow से trigger", "L/min", 0.5, 10, 0.5, 2, 3),
    trigPress: S("Pressure trigger", "Pressure से trigger", "cmH2O", -5, -0.5, 0.5, -2, 3),
    cycle: S("Expiratory cycle", "साँस छोड़ने पर cycle (expiratory cycle)", "% of peak flow", 5, 80, 5, 25, 3),
    rise: S("Rise time", "Pressure चढ़ने का समय (rise time)", "s", 0.05, 0.4, 0.05, 0.1, 3),
    phigh: S("P high", "ऊँचा pressure (P high)", "cmH2O", 10, 40, 1, 28, 4),
    plow: S("P low", "नीचा pressure (P low)", "cmH2O", 0, 15, 1, 0, 4),
    thigh: S("T high", "ऊँचे pressure का समय (T high)", "s", 2, 10, 0.5, 4.5, 4),
    tlow: S("T low", "नीचे pressure का समय (T low)", "s", 0.2, 1.5, 0.1, 0.5, 4),
    ipap: S("IPAP", "IPAP", "cmH2O", 5, 30, 1, 12, 3),
    epap: S("EPAP", "EPAP", "cmH2O", 3, 15, 1, 5, 3),
    pPeakHigh: S("Peak pressure alarm", "Peak pressure की alarm सीमा", "cmH2O", 15, 60, 1, 40, 2),
    veLow: S("Low minute volume alarm", "कम minute volume की alarm", "L/min", 1, 10, 0.5, 3, 2),
    veHigh: S("High minute volume alarm", "ज़्यादा minute volume की alarm", "L/min", 5, 30, 1, 15, 2),
    apnoea: S("Apnoea alarm time", "Apnoea alarm का समय", "s", 10, 60, 5, 20, 2),
    rrHigh: S("High rate alarm", "ज़्यादा rate की alarm", "/min", 10, 60, 1, 35, 2),
    fio2Low: S("Low FiO2 alarm", "कम FiO2 की alarm", "%", 18, 95, 1, 18, 3),
    fio2High: S("High FiO2 alarm", "ज़्यादा FiO2 की alarm", "%", 25, 100, 1, 100, 3),
    peepLow: S("Low PEEP alarm", "कम PEEP की alarm", "cmH2O", 0, 20, 1, 0, 3),
    peepHigh: S("High PEEP alarm", "ज़्यादा PEEP की alarm", "cmH2O", 5, 30, 1, 20, 3)
  };

  /* Timeline events a scenario can schedule ({t, event, note, duration?}). Unknown ids only show their note. */
  var EVENTS = {
    secretions: T("Secretions: airway resistance up", "Secretions: airway resistance बढ़ा"),
    bronchospasm: T("Bronchospasm: airway resistance much higher", "Bronchospasm: airway resistance बहुत बढ़ा"),
    bronchospasmEases: T("Bronchospasm eases", "Bronchospasm कम हुआ"),
    pneumothorax: T("Pneumothorax: compliance and cardiac output fall", "Pneumothorax: compliance और cardiac output गिरे"),
    plug: T("Mucus plug: lobe collapse, shunt up", "Mucus plug: lobe collapse, shunt बढ़ा"),
    disconnect: T("Circuit disconnected", "Circuit disconnect हुआ"),
    cuffLeak: T("Cuff leak", "Cuff से हवा का रिसाव"),
    o2Failure: T("Oxygen supply failure", "Oxygen supply बंद हुई"),
    sedationLight: T("Sedation lightens: effort returns", "Sedation हल्का: effort लौटा"),
    sedationDeep: T("Deep sedation: no effort", "गहरा sedation: कोई effort नहीं"),
    fever: T("Fever: CO2 production up", "बुखार: CO2 production बढ़ा"),
    hypovolaemia: T("Bleeding: volume status low", "Bleeding: volume status कम"),
    hypotension: T("Hypotension: cardiac output falls for a while", "Hypotension: कुछ समय के लिए cardiac output गिरा"),
    improve: T("Treatment works: resistance, shunt and acidosis ease; sedation lightens", "इलाज असर कर रहा है: resistance, shunt और acidosis घटे; sedation हल्का"),
    fluidBolus: T("Fluid given: volume status up", "Fluid दिया: volume status बढ़ा"),
    fatigue: T("Respiratory muscle fatigue", "साँस की मांसपेशियों की थकान")
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
  /* In vivo P50: the PO2 at 50% saturation. Severinghaus' standard P50 is 26.8 (virtual PO2 26.86); pH, temperature
     and PCO2 move it by the same Kelman factor that sat() applies (Bohr effect: acid blood and fever shift right). */
  var P50_STD = 26.86;
  function p50Of(ph, temp, pco2) { return P50_STD / Math.pow(10, 0.024 * (37 - temp) + 0.40 * (ph - 7.40) + 0.06 * log10(40 / Math.max(5, pco2))); }
  /* One line that explains a shifted curve, so "SaO2 90 at PaO2 78" reads as physiology, not a bug (E4). */
  function curveNote(pao2, sao2, ph, temp, pco2) {
    var p50 = p50Of(ph, temp, pco2), std = sat(pao2, 7.4, 37, 40) * 100, why = [], whyH = [];
    if (Math.abs(p50 - 26.8) < 2 || Math.abs(std - sao2 * 100) < 1.5) return null;
    if (ph < 7.35) { why.push("acid blood (pH " + fx(ph, 2) + ")"); whyH.push("अम्लीय ख़ून (pH " + fx(ph, 2) + ")"); }
    if (ph > 7.45) { why.push("alkaline blood (pH " + fx(ph, 2) + ")"); whyH.push("क्षारीय ख़ून (pH " + fx(ph, 2) + ")"); }
    if (temp >= 38) { why.push("fever (" + fx(temp, 1) + " C)"); whyH.push("बुख़ार (" + fx(temp, 1) + " C)"); }
    if (temp <= 36) { why.push("a low temperature (" + fx(temp, 1) + " C)"); whyH.push("कम तापमान (" + fx(temp, 1) + " C)"); }
    if (pco2 >= 50) { why.push("high CO2"); whyH.push("ज़्यादा CO2"); }
    if (pco2 <= 30) { why.push("low CO2"); whyH.push("कम CO2"); }
    var right = p50 > 26.8;
    return T((why.length ? why.join(" and ") : "pH and temperature") + " shift the oxygen curve " + (right ? "right" : "left") + " (P50 " + fx(p50) + " instead of 27). At PaO2 " + fx(pao2) + " the saturation is " + fx(sao2 * 100) + "%, where a normal curve gives " + fx(std) + "%." + (right ? " Blood gives oxygen to the tissues more easily." : " Blood holds on to oxygen more tightly."),
      (whyH.length ? whyH.join(" और ") : "pH और तापमान") + " oxygen curve को " + (right ? "दाईं" : "बाईं") + " ओर खिसकाते हैं (P50 27 की जगह " + fx(p50) + ")। PaO2 " + fx(pao2) + " पर saturation " + fx(sao2 * 100) + "% है, जहाँ सामान्य curve " + fx(std) + "% देती है।" + (right ? " ख़ून tissues को oxygen आसानी से देता है।" : " ख़ून oxygen को कसकर पकड़े रहता है।"));
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
    var vaL = (o.vqr || 0.1) * fl * Math.max(0, o.va), qL = fl * co;
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
  // w is the weight of end-expiratory pressure (0.7; less in APRV when the release is shorter than the collapse time)
  function peffOf(peepTot, pmean, w) { w = w == null ? 0.7 : w; return w * peepTot + (1 - w) * pmean; }
  function peffM(mc) { return peffOf(mc.peepTot, mc.pmean, mc.relW); }
  function recTarget(s, mc) { return openOf(peffM(mc) - HYS_P * (s.hys || 0)); }
  /* Airway resistance: scenario R x other insults x bronchospasm x secretions x bronchodilator tone. */
  function rOf(s) { var m = s.m; return s.p.r * m.rF * (m.spF || 1) * (m.secF || 1) * (m.bdF || 1); }
  function collapsed(s) { return clamp(s.p.shunt0 * s.p.recr * (1 - s.rec) / (1 - OPEN5), 0, 0.7); }
  function hco3Of(s, paco2) {
    var buf = (bufOf(paco2) - bufOf(s.p.pco2Ref)) * Math.min(1, s.p.hco3 / 24);
    return Math.max(2, s.p.hco3 - (s.lac - s.p.lac0) + buf);
  }
  function bufOf(p) { return p > 40 ? 0.1 * (p - 40) : 0.2 * (p - 40); }
  function phOf(hco3, paco2) { return 6.1 + log10(hco3 / (0.03 * paco2)); }

  function drive(s) {
    var p = s.p, m = s.m, act = 1 - m.sed;
    var sp = s.ch.spo2 == null ? 97 : s.ch.spo2;
    if (m.parUntil > s.t) return { rate: 0, pmus: 0, chemo: 1, paralysed: true }; // neuromuscular blockade: no efforts
    var chemo = clamp(1 + 5 * (7.4 - s.ch.ph) + 0.02 * (s.paco2 - 40) + 0.03 * Math.max(0, 60 - s.ch.pao2) + 0.04 * Math.max(0, 94 - sp), 0, 3);
    if (chemo < 0.3 || act < 0.05 || p.rate <= 0) return { rate: 0, pmus: 0, chemo: chemo };
    return { rate: clamp(p.rate * (0.6 + 0.4 * chemo) * act, 0, 45), pmus: clamp(p.effort * chemo * act * m.effF, 0, p.effMax), chemo: chemo };
  }

  function disconnected(s) { return s.m.discUntil > s.t; }
  function bagging(s) { return s.m.bagUntil > s.t; }
  /* Manual bagging off the circuit (action bag100): FiO2 1.0, about 7 mL/kg PBW at 12 a minute, no PEEP valve. */
  function bagSettings(st, p) {
    var o = {}, k;
    for (k in st) if (own(st, k)) o[k] = st[k];
    o.mode = "vc"; o.vt = Math.round(7 * p.pbw); o.rr = 12; o.ti = 1; o.peep = 0; o.fio2 = 100; o.flowPattern = "square";
    return o;
  }

  /* Steady breath solution for one class of breath. */
  function solve(cl, L, Ttot) {
    var C = L.C, ce = C, i, res = null;
    for (i = 0; i < 5; i++) {
      var tauI = L.R * ce / 1000, tauE = L.Re * ce / 1000, ti;
      if (cl.k === "ps") ti = clamp(tauI * Math.log(100 / cl.cycle), 0.25, 3);
      else if (cl.k === "sp") ti = TIN;
      else ti = cl.ti;
      ti = Math.min(ti, Math.max(0.2, Ttot - 0.15));
      var vee = vOf(L.peepTot, C, L.ui), lim = null;
      if (cl.k === "vc" && cl.plim) { lim = vcLimit(cl.vt, ti, cl.decel, L, vee, cl.plim); if (lim) ti = Math.max(0.05, lim.ti); }
      var te = Math.max(0.15, Ttot - ti), eE = Math.exp(-te / tauE), vt, x0;
      if (cl.k === "vc") { vt = lim ? lim.vt : cl.vt; x0 = vt * eE / (1 - eE); }
      else { var eI = Math.exp(-ti / tauI), x1 = ce * cl.p * (1 - eI) / (1 - eI * eE); x0 = x1 * eE; vt = Math.max(0, x1 - x0); }
      var pplat = pel(vee + vt, C, L.ui);
      var cn = vt > 1 ? vt / Math.max(0.3, pplat - L.peepTot) : C;
      res = { vt: vt, ti: ti, te: te, x0: x0, ap: x0 / ce, pplat: pplat, ce: ce, tauI: tauI, tauE: tauE, limited: !!lim };
      ce = 0.5 * ce + 0.5 * cn;
    }
    return res;
  }

  /* Volume breath against the peak pressure alarm: inspiration ends where Paw first reaches the limit (pressure-limited
     cycling). Returns the volume and time at the limit, or null when the full VT fits under it. */
  function vcLimit(vt, ti, decel, L, vee, plim) {
    var k, prev = 0;
    for (k = 0; k <= 40; k++) {
      var t = ti * k / 40, q = decel ? 2 * vt / ti * (1 - t / ti) : vt / ti, V = decel ? 2 * vt / ti * (t - t * t / (2 * ti)) : vt * t / ti;
      if (pel(vee + V, L.C, L.ui) + L.R * q / 1000 >= plim) return { vt: prev, ti: t };
      prev = V;
    }
    return null;
  }

  /* mech(s, st): every ventilator and lung number for these settings and this lung state. */
  function mech(s, st) {
    var p = s.p, m = s.m, dr = drive(s), bag = bagging(s), disc = disconnected(s) && !bag;
    if (bag) st = bagSettings(st, p);
    var mode = disc ? "cpap" : st.mode, vdA = 2.2 * p.pbw, weak = false, plim = bag ? 0 : st.pPeakHigh, decel = st.flowPattern === "decel";
    var C = Math.max(3, p.c * (1 - collapsed(s)) * m.cF), R = rOf(s), Re = R * (p.fl ? 2 : 1);
    var peep = disc ? 0 : mode === "niv" ? st.epap : mode === "aprv" ? st.plow : st.peep;
    if (!disc && m.leak > 0) peep = Math.max(0, peep - 3 * m.leak / 0.3);
    var leakF = mode === "niv" ? 0.9 : 1 - m.leak, pm = dr.pmus, peff = 0.7 * pm;
    var sens = st.trigType === "pressure" ? Math.abs(st.trigPress) : 0.3 + 0.1 * st.trigFlow;
    var L = { C: C, R: R, Re: Re, ui: p.ui, peepTot: peep };
    var ap = 0, trapV = 0, pass, out = null;
    for (pass = 0; pass < 3; pass++) {
      var load = (L.peepTot - peep) + sens; // trapped pressure above set PEEP must be overcome first
      var fmiss = dr.rate > 0 ? (pm > 0 ? clamp((load - 0.5 * pm) / (0.5 * pm + 0.1), 0, 1) : 1) : 0;
      var trig = dr.rate * (1 - fmiss), cls = [], backup = false, apnoea = false, ineff = dr.rate * fmiss, rrT;
      if (mode === "vc" || mode === "pc") {
        ineff = dr.rate;
        cls.push(mode === "vc" ? { k: "vc", rate: st.rr, vt: st.vt, ti: st.ti, mand: true, plim: plim, decel: decel } : { k: "pc", rate: st.rr, p: st.pinsp, pset: st.pinsp, ti: st.ti, mand: true });
      } else if (mode === "acvc") {
        cls.push({ k: "vc", rate: Math.max(st.rr, trig), vt: st.vt, ti: st.ti, mand: true, assist: trig > st.rr ? peff : 0, plim: plim, decel: decel });
      } else if (mode === "acpc" || mode === "prvc") {
        var r1_ = Math.max(st.rr, trig), share = r1_ > 0 ? Math.min(1, trig / r1_) : 0, pin = mode === "prvc" ? s.prvcP : st.pinsp;
        cls.push({ k: "pc", rate: r1_, p: pin + peff * share, pset: pin, ti: st.ti, mand: true });
      } else if (mode === "simv") {
        cls.push({ k: "vc", rate: st.rr, vt: st.vt, ti: st.ti, mand: true, plim: plim, decel: decel });
        if (trig > st.rr) cls.push({ k: st.ps > 0 ? "ps" : "sp", rate: trig - st.rr, p: st.ps + peff, pset: st.ps, cycle: st.cycle });
      } else if (mode === "psv" || mode === "cpap") {
        // apnoea: breaths further apart than the apnoea time, or too small to clear the anatomic dead space
        apnoea = !(trig > 0 && 60 / trig <= st.apnoea && !weak);
        if (apnoea && !disc && s.apS >= st.apnoea) { backup = true; cls.push({ k: "vc", rate: st.rr, vt: st.vt, ti: st.ti, mand: true, plim: plim, decel: decel }); }
        else if (trig > 0) cls.push(mode === "psv" && st.ps > 0 ? { k: "ps", rate: trig, p: st.ps + peff, pset: st.ps, cycle: st.cycle } : { k: "sp", rate: trig, p: peff, pset: 0 });
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
      trapV = 0; for (i = 0; i < cls.length; i++) trapV += cls[i].sol.x0 * cls[i].rate / sumR;
      if ((mode === "psv" || mode === "cpap") && !backup && cls.length && cls[0].sol.vt < vdA) weak = true;
      L.peepTot = p.fl ? Math.max(peep + 0.2 * ap, ap) : peep + ap;
      out = { cls: cls, rrT: rrT, Ttot: Ttot, backup: backup, apnoea: apnoea, ineff: ineff, fmiss: fmiss, trig: trig, trapV: trapV };
    }
    // one more solve at the final total PEEP, so every breath, plateau and driving pressure share one reference (A2)
    if (!out.aprv) for (pass = 0; pass < out.cls.length; pass++) out.cls[pass].sol = solve(out.cls[pass], L, out.Ttot);
    var mo_ = finishMech(s, st, out, L, peep, mode, dr, leakF, disc);
    mo_.bag = bag; mo_.st = st;
    return mo_;
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

  /* Displayed numbers: VT, Ti and EtCO2 come from the breath class that moves the most minute volume; peak and
     plateau are the highest over all classes (the breath that stretches the lung most), and plateau never exceeds
     peak (a patient's own effort stretch is not a plateau). */
  function finishMech(s, st, o, L, peep, mode, dr, leakF, disc) {
    var p = s.p, cls = o.cls, i, ve = 0, vtw = 0, rr = o.rrT, pm = 0, prim = null, best = -1, plc = null, mand = null;
    var vee = vOf(L.peepTot, L.C, L.ui), base = o.aprv ? st.plow : peep;
    for (i = 0; i < cls.length; i++) {
      var c = cls[i], sl = c.sol;
      // plateau of this breath: end-inspiratory elastic pressure on top of the same total PEEP (one reference, A2)
      sl.pplat = pel(vee + sl.vt, L.C, L.ui);
      if (c.k === "vc") {
        var fl = sl.vt / 1000 / sl.ti;
        c.ppeak = st.flowPattern === "decel" ? Math.max(L.peepTot + L.R * 2 * fl, sl.pplat) : sl.pplat + L.R * fl;
        c.ppeak -= 0.5 * (c.assist || 0);
        if (sl.limited) c.ppeak = c.plim; // the breath ended when Paw reached the limit
        c.ppeak = Math.max(c.ppeak, sl.pplat);
        c.kk = st.flowPattern === "decel" ? 0.67 : 0.5;
      } else if (c.k === "sp") { c.ppeak = (o.aprv ? st.phigh : peep) + 0.5; c.kk = 0; }
      else {
        c.ppeak = base + c.pset; c.kk = 1;
        // in a passive pressure breath alveolar pressure cannot pass the applied pressure (patient effort adds volume)
        sl.pplat = Math.min(sl.pplat, Math.max(c.ppeak, L.peepTot));
      }
      ve += c.rate * sl.vt / 1000; vtw += c.rate * sl.vt;
      pm += c.rate * sl.ti / 60 * c.kk * (c.ppeak - base);
      var mv = c.rate * sl.vt;
      if (mv > best) { best = mv; prim = c; }
      if (c.k !== "sp" && (!plc || sl.pplat > plc.sol.pplat)) plc = c;
      if (c.mand && !mand) mand = c;
    }
    var pmean = o.aprv ? (st.phigh * st.thigh + st.plow * st.tlow) / (st.thigh + st.tlow) : peep + pm;
    var vtAvg = rr > 0 ? vtw / rr : 0, apShown = Math.max(0, L.peepTot - peep);
    var teFrac = prim ? clamp(prim.sol.te / (prim.sol.ti + prim.sol.te), 0, 1) : 1;
    var pitp = pmean + apShown * teFrac;
    var pplat = Math.max(plc ? plc.sol.pplat : L.peepTot, L.peepTot), ppeak = peep;
    for (i = 0; i < cls.length; i++) ppeak = Math.max(ppeak, cls[i].ppeak);
    ppeak = Math.max(ppeak, pplat);
    var vtP = prim ? prim.sol.vt : 0, drv = pplat - L.peepTot; // never negative: pplat is built on peepTot
    var C = L.C;
    // APRV: the release is shorter than the collapse time, so the lung is held open by Pmean more than by Plow (E1)
    var relW = 0.7, relEnd = null;
    if (o.aprv) { relW = 0.7 * Math.min(1, st.tlow / 1.5); relEnd = cls[0].sol.tauE > 0 ? Math.exp(-st.tlow / cls[0].sol.tauE) : 0; }
    return {
      mode: mode, disc: disc, peep: peep, peepTot: L.peepTot, autoPeep: apShown, pplat: pplat, ppeak: ppeak, pmean: pmean, pitp: pitp,
      vt: vtP, vtAvg: vtAvg, ve: ve, vte: vtP * leakF, veMeasured: disc || s.m.bagUntil > s.t ? 0 : ve * leakF, rr: rr, ti: prim ? prim.sol.ti : 0, te: prim ? prim.sol.te : 0,
      driving: drv, cstat: drv > 0.3 && plc ? plc.sol.vt / drv : C, trapV: apShown * C, trapDyn: o.trapV || 0, prim: prim, plc: plc, vtMand: mand ? mand.sol.vt * leakF : null, C: C, R: L.R, Re: L.Re, ce: prim ? prim.sol.ce : C,
      mp: 0.098 * rr * vtP / 1000 * Math.max(0, ppeak - 0.5 * drv), cls: cls, backup: o.backup, apnoea: o.apnoea,
      ineff: o.ineff, fmiss: o.fmiss, trig: o.trig, drive: dr, leakF: leakF, aprv: !!o.aprv, relW: relW, relEnd: relEnd,
      limited: mand && mand.k === "vc" && mand.sol.limited ? { set: mand.vt, delivered: mand.sol.vt, limit: mand.plim } : null
    };
  }

  /* model(s, st): mechanics + haemodynamics + ventilation + oxygenation + acid base, all from the state. */
  function hemoBase(vs) { return vs === "low" ? { co: 4.0, map: 72, hr: 105, k: 0.045 } : vs === "high" ? { co: 5.0, map: 88, hr: 85, k: -0.005 } : { co: 5.0, map: 85, hr: 80, k: 0.022 }; }
  function model(s, st) {
    st = norm(st);
    var p = s.p, m = s.m, mc = mech(s, st), hb0 = hemoBase(m.vs);
    var co = hb0.co * clamp(1 - hb0.k * Math.max(0, mc.pitp - 7), 0.35, 1.1) * m.coF * (m.hypoUntil > s.t ? 0.7 : 1), cof = co / hb0.co;
    // dynamic hyperinflation: end-inspiratory volume above relaxation (trapped + VT) beyond 12 mL/kg PBW squeezes capillaries
    var vei = (mc.trapDyn + mc.vt) / p.pbw, hyper = Math.min(HYPER_MAX, HYPER_DS * Math.max(0, vei - VEI0));
    var vdA = 2.2 * p.pbw, va = 0, vdW = 0, i, dsf = Math.min(DS_MAX, p.ds + hyper + 0.005 * Math.max(0, mc.pplat - p.ui) + 0.1 * Math.max(0, 1 - cof)), vdAlvP = 0;
    for (i = 0; i < mc.cls.length; i++) {
      var c = mc.cls[i], v = c.sol.vt, vd = vdA + dsf * v;
      va += c.rate * Math.max(0, v - vd) / 1000; vdW += c.rate * Math.min(v, vd);
      if (c === mc.prim) vdAlvP = dsf * v;
    }
    var vdvt = mc.ve > 0 ? vdW / 1000 / mc.ve : 1;
    var fio2 = mc.bag ? 1 : mc.disc || m.o2Until > s.t ? 0.21 : st.fio2 / 100;
    var hco3 = hco3Of(s, s.paco2), ph = phOf(hco3, s.paco2);
    var vco2 = p.vco2 * m.vco2F, vo2 = vco2 / RQ, temp = p.temp + m.tempAdd;
    var shunt = clamp(p.shunt0 * (1 - p.recr) + collapsed(s) + m.shuntAdd, 0.01, 0.8);
    var ox = oxy({ hb: p.hb, ph: ph, temp: temp, paco2: s.paco2, pao2A: s.pao2A, shunt: shunt, lowvq: p.lowvq, vqr: p.vqr, va: va, co: co, vo2: vo2 });
    var spo2 = ox.sao2 * 100, map = hb0.map * (1 - 0.6 * (1 - cof)) * (1 - 0.5 * Math.max(0, 7.2 - ph));
    var hr = hb0.hr + 50 * (1 - cof) + 0.5 * Math.max(0, 92 - spo2) + 0.4 * Math.max(0, s.paco2 - 45) + 10 * Math.max(0, temp - 37.5);
    if (spo2 < 70) { var q = spo2 / 70; hr *= q * q; map *= 0.5 + 0.5 * q; }
    hr = clamp(hr, 20, 190); map = Math.max(15, map); // floors: an agonal patient, not a number below physiology
    var pp = 45 * clamp(cof, 0.4, 1.2), vtAlv = mc.vt - vdA;
    // end-tidal gas comes last from slow, CO2-rich units, so only half the alveolar dead space dilutes it (teaching value)
    var etco2 = mc.ve > 0.2 && vtAlv > 0 ? s.paco2 * clamp(1 - 0.05 - 0.5 * vdAlvP / vtAlv, 0.05, 1) : 0;
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
      vco2: pt.vco2 || 200, rate: dv.rate == null ? 12 : dv.rate, effort: dv.effort == null ? 6 : dv.effort, effMax: typeof dv.maxEffort === "number" ? dv.maxEffort : 30,
      c: lg.c || 50, r: lg.r || 10, fl: !!lg.flowLimited, shunt0: lg.shunt == null ? 0.03 : lg.shunt, recr: clamp(lg.recruitable || 0, 0, 1),
      ds: lg.deadSpace || 0, pco2Ref: 40, ui: lg.upperInflection || 30, lowvq: lowvqOf(lg), vqr: typeof lg.vqLow === "number" ? lg.vqLow : 0.1
    };
    var g = sc.goals || {};
    var s = {
      v: 1, id: sc.id || "custom", t: 0, p: p, rec: 1, hys: 0, hysRef: 0, peffLast: 0, paco2: 40, pao2A: 100, lac: p.lac0, prvcP: 15, apS: 0, acts: [],
      ch: { ph: 7.4, pao2: 95 },
      m: { rF: 1, cF: 1, shuntAdd: 0, coF: 1, leak: 0, discUntil: -1, o2Until: -1, sed: clamp(dv.sedation == null ? 0.5 : dv.sedation, 0, 1), effF: 1, vco2F: 1, tempAdd: 0, vs: pt.volumeStatus || "normal", leakUntil: -1, hypoUntil: -1, bagUntil: -1, ptx: 0, sec: 0, plug: 0, hco3T: null,
        spF: 1, secF: 1, bdF: 1, spT: null, bdT: null, spasm: 0, bdUntil: -1, parUntil: -1, fluidAt: -1e9, drain: false, ptxSide: null, bled: false, improved: false, oedema: 0 },
      timeline: (sc.timeline || []).map(function (e) {
        var o = { t: e.t, event: e.event, duration: e.duration || 0 };
        if (e.requires) o.requires = clone(e.requires);
        if (e.side) o.side = e.side;
        if (typeof e.factor === "number") o.factor = e.factor;
        if (e.note) o.note = clone(e.note);
        return o;
      }),
      fired: [], harm: { vili: 0, o2h: 0, hypotMin: 0, hypoxMin: 0, baroMin: 0, apHypoMin: 0 }, settings: st, last: null, log: [],
      goals: { spo2: g.spo2 || [92, 98] }, limits: { etco2High: (sc.monitor || {}).etco2High || ETCO2_HIGH }, exam: clone(sc.exam || {}), startSet: clone(st), changes: [], evlog: [], crit: 0, arrest: null, hold: null
    };
    var ab = start.abg || {};
    settle(s, st, typeof ab.PaCO2 === "number" ? clamp(ab.PaCO2, 10, 150) : null);
    s.settings = st;
    return s;
  }
  /* Solve the steady state at the start settings (fixed point), so the t = 0 ABG reflects them. */
  function settle(s, st, presenting) {
    var i, mo, a = 0;
    s.apS = 1e9;
    for (i = 0; i < 80; i++) {
      mo = model(s, st);
      var tgt = recTarget(s, mo.mech);
      s.rec = 0.5 * s.rec + 0.5 * tgt;
      var pss = mo.va > 0.05 ? clamp(0.863 * mo.vco2 / mo.va, 10, 150) : 150;
      s.paco2 = presenting != null ? presenting : 0.6 * s.paco2 + 0.4 * pss;
      s.p.pco2Ref = s.paco2; // scenario HCO3 is the bicarbonate at the presenting (start) PaCO2
      s.pao2A = mo.PAtarget;
      s.ch = { ph: mo.ph, pao2: mo.pao2, spo2: mo.spo2 };
      if (st.mode === "prvc") prvcAdjust(s, st, mo.mech, 10);
      a = mo;
    }
    s.apS = mo.mech.apnoea ? 1e9 : 0;
    a = model(s, st);
    s.peffLast = s.hysRef = peffM(a.mech);
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
    s.last = { pao2: mo.pao2, paco2: s.paco2, ph: mo.ph, hco3: mo.hco3, sao2: mo.sao2, be: mo.be, lactate: s.lac, fio2: mo.fio2, spo2: mo.spo2, map: mo.map, pA: mo.PAtarget, temp: mo.temp };
  }

  /* Snapshot of the numbers an event or action moves, for its one-line detail (E8). */
  function snap(s) { var mo = model(s, s.settings); return { r: mo.mech.R, c: mo.mech.C, co: mo.co, shunt: mo.shunt, map: mo.map, hb: s.p.hb, temp: mo.temp }; }
  function evDetail(id, b, a) {
    if (Math.abs(a.r - b.r) >= 0.5) return T("Airway resistance " + fx(b.r) + " to " + fx(a.r) + " cmH2O/L/s.", "Airway resistance " + fx(b.r) + " से " + fx(a.r) + " cmH2O/L/s हुआ।");
    if (Math.abs(a.c - b.c) >= 1) return T("Lung compliance " + fx(b.c) + " to " + fx(a.c) + " mL/cmH2O.", "फेफड़े की compliance " + fx(b.c) + " से " + fx(a.c) + " mL/cmH2O हुई।");
    if (Math.abs(a.shunt - b.shunt) >= 0.01) return T("Shunt " + fx(b.shunt * 100) + "% to " + fx(a.shunt * 100) + "%.", "Shunt " + fx(b.shunt * 100) + "% से " + fx(a.shunt * 100) + "% हुआ।");
    if (Math.abs(a.hb - b.hb) >= 0.1) return T("Haemoglobin " + fx(b.hb, 1) + " to " + fx(a.hb, 1) + " g/dL.", "Haemoglobin " + fx(b.hb, 1) + " से " + fx(a.hb, 1) + " g/dL हुआ।");
    if (Math.abs(a.co - b.co) >= 0.1) return T("Cardiac output " + fx(b.co, 1) + " to " + fx(a.co, 1) + " L/min.", "Cardiac output " + fx(b.co, 1) + " से " + fx(a.co, 1) + " L/min हुआ।");
    if (Math.abs(a.temp - b.temp) >= 0.1) return T("Temperature " + fx(b.temp, 1) + " to " + fx(a.temp, 1) + " C.", "तापमान " + fx(b.temp, 1) + " से " + fx(a.temp, 1) + " C हुआ।");
    return null;
  }
  function logEv(s, kind, id, b, extra) {
    var e = { t: s.t, kind: kind, id: id, label: kind === "action" ? (ACTIONS[id] || {}).label || null : EVENTS[id] || null, detail: b ? evDetail(id, b, snap(s)) : null };
    if (extra && extra.note) e.note = extra.note;
    if (extra && extra.side) e.side = extra.side;
    s.evlog.push(e);
    if (s.evlog.length > 60) s.evlog.shift();
  }
  /* A fluid bolus raises preload when the circulation is dry; in a full circulation it only adds lung water. */
  function fluidEffect(s) {
    var m = s.m;
    m.fluidAt = s.t;
    if (m.vs === "low") { m.vs = "normal"; m.hypoUntil = -1; return; }
    if (m.vs === "high" || s.p.shunt0 >= 0.2) { m.shuntAdd += 0.04; m.cF *= 0.95; m.oedema++; }
    m.vs = "high";
  }
  function applyEvent(s, e) {
    var m = s.m, d = e.duration || 0, b = snap(s);
    switch (e.event) {
      case "secretions": m.secF *= e.factor || 1.5; m.shuntAdd += 0.03; m.sec++; break;
      case "bronchospasm": m.spF *= e.factor || 2.5; m.spT = null; m.spasm++; break;
      case "bronchospasmEases": m.spT = 1; m.spasm = 0; break; // relaxes over minutes, like a bronchodilator
      case "pneumothorax": m.cF *= 0.6; m.shuntAdd += 0.1; m.coF *= 0.75; m.ptx++; m.ptxSide = e.side || s.exam.ptxSide || "right"; break;
      case "plug": m.shuntAdd += 0.1; m.cF *= 0.85; m.plug++; break;
      case "disconnect": m.discUntil = s.t + (d || 30); break;
      case "cuffLeak": m.leak = 0.3; m.leakUntil = d ? s.t + d : 1e12; break;
      case "o2Failure": m.o2Until = s.t + (d || 60); break;
      case "sedationLight": m.sed = Math.max(0, m.sed - 0.5); break;
      case "sedationDeep": m.sed = 1; break;
      case "fever": m.vco2F *= 1.2; m.tempAdd += 1.5; break;
      case "hypovolaemia": m.vs = "low"; m.bled = true; break;
      case "hypotension": m.hypoUntil = s.t + (d || 900); m.vs = "low"; break;
      case "improve":
        m.rF = 1; m.cF = 1; m.shuntAdd = 0; m.coF = 1; m.effF = 1; m.hypoUntil = -1; m.ptx = 0; m.sec = 0; m.plug = 0;
        m.spF = 1; m.secF = 1; m.spT = null; m.spasm = 0; m.improved = true; m.oedema = 0;
        s.p.r = Math.max(8, s.p.r * 0.7); s.p.shunt0 *= 0.7; s.p.c = Math.min(100, s.p.c * 1.15);
        if (s.p.hco3 < 22) m.hco3T = Math.min(24, s.p.hco3 + 6); // renal and metabolic recovery: first order, see step()
        m.sed = Math.max(0, m.sed - 0.3); break;
      case "fluidBolus": fluidEffect(s); break;
      case "fatigue": m.effF *= 0.5; break;
    }
    logEv(s, "event", e.event, b, { note: e.note, side: e.event === "pneumothorax" ? m.ptxSide : null });
  }
  /* inject(state, eventId, opts): apply one event now (a tutorial or teacher button); pure, returns a new state. */
  function inject(state, id, opt) {
    var s = clone(state), e = { t: s.t, event: id, duration: (opt && opt.duration) || 0 };
    if (opt && typeof opt.factor === "number") e.factor = opt.factor;
    if (opt && opt.side) e.side = opt.side;
    if (EVENTS[id]) applyEvent(s, e);
    return s;
  }

  /* Learner actions at the bedside (the UI shows them as buttons). act() is pure: it returns a new state. */
  var ACTIONS = {
    decompress: { id: "decompress", label: T("Decompress the chest: needle, then drain", "Chest decompress करें: पहले needle, फिर drain"),
      available: function (s) { return !s.m.drain; } },
    suction: { id: "suction", label: T("Suction the tube", "Tube को suction करें"), available: function () { return true; } },
    bag100: { id: "bag100", label: T("Hand bag with 100% oxygen off the ventilator", "Ventilator हटाकर 100% oxygen से हाथ से bag करें"),
      available: function (s) { return !(s.m.bagUntil > s.t); } },
    disconnect: { id: "disconnect", label: T("Disconnect briefly to let trapped air out", "फँसी हवा निकालने के लिए थोड़ी देर ventilator अलग करें"),
      available: function (s) { return !(s.m.discUntil > s.t) && !(s.m.bagUntil > s.t); } },
    bronchodilator: { id: "bronchodilator", label: T("Give a nebulised bronchodilator", "Nebuliser से bronchodilator दें"),
      available: function (s) { return !(s.m.bdUntil > s.t); } },
    sedate: { id: "sedate", label: T("Deepen sedation", "Sedation गहरा करें"),
      available: function (s) { return s.m.sed < 0.95 && !(s.m.parUntil > s.t); } },
    paralyse: { id: "paralyse", label: T("Give a muscle relaxant: no more breathing efforts", "Muscle relaxant दें: साँस के प्रयास बंद"),
      available: function (s) { return !(s.m.parUntil > s.t); } },
    fluid: { id: "fluid", label: T("Give a 500 mL fluid bolus", "500 mL fluid bolus दें"),
      available: function (s) { return !(s.m.fluidAt > s.t - 600); } },
    blood: { id: "blood", label: T("Transfuse 2 units of blood", "2 unit blood चढ़ाएँ"),
      available: function (s) { return s.p.hb < 10 || (!!s.m.bled && s.m.vs === "low"); } }
  };
  function act(state, id, opt) {
    var s = clone(state), m = s.m, b;
    if (id === "sedate" && opt && opt.paralyse) id = "paralyse";
    var a = ACTIONS[id];
    if (!a || !a.available(s)) return s;
    b = snap(s);
    s.acts.push({ t: s.t, id: id });
    if (id === "decompress") {
      // a tension pneumothorax drained: compliance, shunt and venous return recover (inverse of the event)
      while (m.ptx > 0) { m.cF /= 0.6; m.shuntAdd = Math.max(0, m.shuntAdd - 0.1); m.coF /= 0.75; m.ptx--; }
      m.drain = true;
    } else if (id === "suction") {
      m.secF = 1;
      while (m.sec > 0) { m.shuntAdd = Math.max(0, m.shuntAdd - 0.03); m.sec--; }
      while (m.plug > 0) { m.shuntAdd = Math.max(0, m.shuntAdd - 0.1); m.cF /= 0.85; m.plug--; }
    } else if (id === "bag100") m.bagUntil = s.t + 60;
    else if (id === "disconnect") m.discUntil = s.t + 15; // gas leaves with PEEP 0; a recruitable lung partly collapses
    else if (id === "bronchodilator") {
      // bronchospasm resolves and airway tone falls over minutes (tau 5 min); a narrow, obstructed airway gains most
      m.spT = 1; m.spasm = 0; m.bdUntil = s.t + 1200;
      m.bdT = Math.max(0.6, (m.bdT || 1) * (s.p.fl || s.p.r >= 20 ? 0.8 : 0.97));
    } else if (id === "sedate") m.sed = Math.min(1, m.sed + 0.3);
    else if (id === "paralyse") m.parUntil = s.t + 3600;
    else if (id === "fluid") fluidEffect(s);
    else if (id === "blood") { s.p.hb = Math.min(13, s.p.hb + 1.5); if (m.vs === "low") m.vs = "normal"; m.hypoUntil = -1; }
    logEv(s, "action", id, b);
    return s;
  }

  /* A timeline event may wait for a condition: requires {key, min} on the settings, or {action} already taken, or a list (any of). */
  function met(s, st, rq) {
    if (!rq) return true;
    if (Object.prototype.toString.call(rq) === "[object Array]") { for (var k = 0; k < rq.length; k++) if (met(s, st, rq[k])) return true; return rq.length === 0; }
    if (rq.action) { for (var i = 0; i < s.acts.length; i++) if (s.acts[i].id === rq.action) return true; return false; }
    if (rq.key && typeof rq.min === "number") return st[rq.key] >= rq.min;
    return true;
  }
  /* Every learner setting change is remembered (key, from, to, t) so an alarm can name its cause. */
  var CHANGE_KEYS = ["mode", "fio2", "peep", "vt", "rr", "pinsp", "ps", "ti", "trigType", "trigFlow", "trigPress", "cycle", "rise", "phigh", "plow", "thigh", "tlow", "ipap", "epap", "pPeakHigh", "flowPattern"];
  function noteChanges(s, a, b) {
    if (!a) return;
    for (var i = 0; i < CHANGE_KEYS.length; i++) { var k = CHANGE_KEYS[i]; if (a[k] !== b[k] && b[k] != null) s.changes.push({ t: s.t, key: k, from: a[k], to: b[k] }); }
    while (s.changes.length > 40) s.changes.shift();
  }
  function step(state, settings, dt) {
    var s = clone(state), st = norm(settings), left = Math.max(0, Math.min(86400, +dt || 0)), i;
    noteChanges(s, s.settings, st);
    if (s.arrest) { s.t += left; s.settings = st; return s; } // arrest ends the run: no spontaneous recovery
    while (left > 1e-9) {
      for (i = 0; i < s.timeline.length; i++) if (s.fired.indexOf(i) < 0 && s.timeline[i].t <= s.t + 1e-9 && met(s, st, s.timeline[i].requires)) { s.fired.push(i); applyEvent(s, s.timeline[i]); }
      if (s.m.leakUntil <= s.t) s.m.leak = 0;
      var h = Math.min(SUB, left), mo = model(s, st), mc = mo.mech, p = s.p, m = s.m;
      // CO2 store mass balance, exact over h
      if (mo.va > 0.05) { var pss = 0.863 * mo.vco2 / mo.va; s.paco2 = pss + (s.paco2 - pss) * Math.exp(-h / 60 * mo.va / (0.863 * K_CO2)); }
      else s.paco2 += mo.vco2 / K_CO2 * h / 60;
      s.paco2 = clamp(s.paco2, 8, 200);
      // alveolar O2 store
      var store_ = 30 * p.pbw * (1 - collapsed(s)) + mc.C * mc.peepTot, cap = store_ * 0.826 / 713;
      if (mo.va > 0.3) { var tauO = cap / (1.16 * mo.va); s.pao2A = mo.PAtarget + (s.pao2A - mo.PAtarget) * Math.exp(-h / 60 / tauO); }
      // apnoea: the store empties at VO2 / capacity; 0.5 allows for aventilatory mass flow (teaching value)
      else s.pao2A = Math.max(15, s.pao2A - mo.vo2 / Math.max(0.5, cap) * h / 60 * 0.5);
      // recruitment: reopening is slow (tau 120 s); collapse is fast (tau 8 s) once the pressure holding it open is lost.
      // Hysteresis: after a sharp loss of Peff (disconnect, PEEP cut) the collapsed units need HYS_P more Peff to reopen;
      // the memory fades only when Peff goes 2 above its pre-collapse level (recruit), else very slowly (tau 30 min).
      var peff = peffM(mc);
      if (s.hys < 0.02) s.hysRef = s.peffLast;
      var tgt = recTarget(s, mc), rec0 = s.rec;
      s.rec = tgt + (s.rec - tgt) * Math.exp(-h / (tgt > s.rec ? 120 : 8));
      if (s.rec < rec0 && peff < s.hysRef - 5) s.hys = Math.min(1, s.hys + (rec0 - s.rec) / Math.max(0.05, rec0));
      s.hys *= Math.exp(-h / (peff >= s.hysRef + 2 ? 60 : 1800));
      s.peffLast = peff;
      // airway tone: bronchospasm easing and bronchodilators act over minutes (tau 5 min)
      if (m.spT != null) { m.spF = m.spT + (m.spF - m.spT) * Math.exp(-h / 300); if (Math.abs(m.spF - m.spT) < 0.005) { m.spF = m.spT; m.spT = null; } }
      if (m.bdT != null) m.bdF = m.bdT + (m.bdF - m.bdT) * Math.exp(-h / 300);
      if (m.hco3T != null) { p.hco3 = m.hco3T + (p.hco3 - m.hco3T) * Math.exp(-h / 1200); if (Math.abs(p.hco3 - m.hco3T) < 0.01) { p.hco3 = m.hco3T; m.hco3T = null; } }
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
      // arrest clock: SpO2 below 50 or MAP below 40 for 2 minutes in a row (E5)
      s.crit = mo.spo2 < 50 || mo.map < 40 ? s.crit + h : 0;
      s.t += h; left -= h;
      var after = model(s, st);
      s.ch = { ph: after.ph, pao2: after.pao2, spo2: after.spo2 };
      store(s, after);
      if (s.crit >= ARREST_S) { s.arrest = { t: s.t, cause: mo.spo2 < 50 ? "hypoxia" : "shock" }; s.t += left; left = 0; }
    }
    s.settings = st;
    return s;
  }

  /* ---------- readout, abg, alarms ---------- */
  var FLAG = {
    vili: T("Injurious ventilation: plateau, driving pressure or VT above the protective limit", "Injurious ventilation: plateau, driving pressure या VT protective limit से ऊपर"),
    overdistension: T("Plateau above the upper inflection: overdistension", "Plateau upper inflection से ऊपर: overdistension"),
    baro: T("Plateau above 35 cmH2O: barotrauma risk", "Plateau 35 cmH2O से ऊपर: barotrauma का ख़तरा"),
    autoPeep: T("Auto-PEEP: gas trapping", "Auto-PEEP: फेफड़ों में हवा फँस रही है"),
    o2tox: T("FiO2 above 60% for hours: oxygen toxicity risk", "घंटों तक FiO2 60% से ऊपर: oxygen toxicity का ख़तरा"),
    hypotension: T("Hypotension: MAP below 65", "Hypotension: MAP 65 से कम"),
    hypoxaemia: T("Hypoxaemia", "ख़ून में oxygen कम (hypoxaemia)"),
    acidosis: T("Acidaemia", "ख़ून में अम्लता (acidaemia)"),
    alkalosis: T("Alkalaemia", "ख़ून में क्षारीयता (alkalaemia)"),
    apnoeaBackup: T("Apnoea backup ventilation running", "Apnoea backup ventilation चल रहा है"),
    ineffective: T("Ineffective efforts: the ventilator misses breaths", "Ineffective efforts: ventilator साँसें नहीं पकड़ रहा"),
    effortsIgnored: T("Patient efforts ignored in a controlled mode", "Controlled mode में मरीज़ के efforts अनदेखे"),
    bagging: T("Hand bagging with 100% oxygen", "100% oxygen से हाथ से bagging"),
    leak: T("Leak present", "Leak है"),
    gastric: T("IPAP above 20: gastric insufflation risk", "IPAP 20 से ऊपर: पेट में हवा जाने का ख़तरा"),
    inverseRatio: T("Inverse ratio: inspiration longer than expiration", "Inverse ratio: inspiration expiration से लंबा"),
    disconnect: T("Circuit disconnected", "Circuit disconnect"),
    periArrest: T("Peri-arrest: severe hypoxaemia or no blood pressure", "Peri-arrest: गंभीर hypoxaemia या blood pressure नहीं"),
    arrest: T("Cardiac arrest: the run has ended", "Cardiac arrest: यह run ख़त्म हुआ"),
    aprvRelease: T("In APRV, short T low keeps the lung open. Set T low so expiratory flow ends at 50 to 75% of peak.", "APRV में छोटा T low फेफड़े को खुला रखता है। T low ऐसा रखें कि expiratory flow peak के 50 से 75% पर रुके।"),
    aprvLongRelease: T("APRV release too long: expiratory flow nearly stops, so the lung can collapse", "APRV release बहुत लंबा: expiratory flow लगभग रुक जाता है, फेफड़ा सिकुड़ सकता है"),
    breathLimited: T("Breath stopped at the high pressure limit: less volume delivered", "साँस high pressure limit पर रुकी: कम volume पहुँचा"),
    paralysed: T("Muscle relaxant given: no breathing efforts", "Muscle relaxant दिया: साँस के प्रयास नहीं")
  };
  function flag(id, sev, detail) { var o = { id: id, severity: sev, label: FLAG[id] }; if (detail) o.detail = detail; return o; }
  function flagsOf(s, mo) {
    var mc = mo.mech, f = [], st = mo.st;
    if (s.arrest) f.push(flag("arrest", "danger"));
    if (mc.disc) f.push(flag("disconnect", "danger"));
    if (mo.spo2 < 60 || mo.map < 40 || mo.hr < 40) f.push(flag("periArrest", "danger"));
    if (mc.pplat > 30 || mc.driving > 15 || mo.vtkg > 8) f.push(flag("vili", mc.pplat > 35 || mc.driving > 20 ? "danger" : "warn"));
    if (mc.pplat > s.p.ui) f.push(flag("overdistension", "warn"));
    if (mc.pplat > 35) f.push(flag("baro", "danger"));
    if (mc.aprv) f.push(mc.relEnd != null && mc.relEnd < 0.25 ? flag("aprvLongRelease", "warn") : flag("aprvRelease", "info"));
    else if (mc.autoPeep >= 5) f.push(flag("autoPeep", mc.autoPeep >= 10 ? "danger" : "warn"));
    if (mc.limited) f.push(flag("breathLimited", "warn", T("Breath stopped at the high pressure limit (" + fx(mc.limited.limit) + "): only " + fx(mc.limited.delivered) + " of " + fx(mc.limited.set) + " mL delivered. Find the cause before raising the limit.",
      "साँस high pressure limit (" + fx(mc.limited.limit) + ") पर रुकी: " + fx(mc.limited.set) + " में से केवल " + fx(mc.limited.delivered) + " mL पहुँचा। Limit बढ़ाने से पहले कारण ढूँढें।")));
    if (s.harm.o2h >= 2 && mo.fio2 > 0.6) f.push(flag("o2tox", s.harm.o2h >= 12 ? "danger" : "warn"));
    if (mo.map < 65) f.push(flag("hypotension", "danger"));
    if (mo.spo2 < 88) f.push(flag("hypoxaemia", mo.spo2 < 85 ? "danger" : "warn"));
    if (mo.ph < 7.30) f.push(flag("acidosis", mo.ph < 7.20 ? "danger" : "warn"));
    if (mo.ph > 7.50) f.push(flag("alkalosis", mo.ph > 7.55 ? "danger" : "warn"));
    if (mc.backup) f.push(flag("apnoeaBackup", "warn"));
    if (mc.ineff > 2 && mc.drive.pmus > 1) f.push(flag(mc.mode === "vc" || mc.mode === "pc" ? "effortsIgnored" : "ineffective", "warn"));
    if (mc.drive.paralysed) f.push(flag("paralysed", "info"));
    if (mc.bag) f.push(flag("bagging", "info"));
    if (st.mode === "niv" || s.m.leak > 0) f.push(flag("leak", s.m.leak > 0 ? "warn" : "info"));
    if (st.mode === "niv" && st.ipap > 20) f.push(flag("gastric", "warn"));
    if (mc.ti > mc.te && st.mode !== "aprv") f.push(flag("inverseRatio", "info"));
    return f;
  }
  /* In spontaneous modes plateau, static compliance and driving pressure need an inspiratory hold on a passive patient (E6). */
  var SPONT_MODES = ["psv", "cpap", "niv"];
  function holdValid(s) { return !!(s.hold && s.hold.kind === "insp" && s.hold.passive && s.t - s.hold.t <= 120); }
  var ARREST_TXT = { hypoxia: T("Cardiac arrest from severe hypoxaemia", "गंभीर hypoxaemia से cardiac arrest"), shock: T("Cardiac arrest from circulatory collapse", "रक्त संचार बैठने से cardiac arrest") };
  /* oxygenHelp (E6): when SpO2 is below the goal, why, and what to try next, from the model's own shunt split.
     kind: "secretions" | "pneumothorax" | "disconnected" | "moreOxygen" | "recruitable" | "notRecruiting".
     Fixed shunt (consolidation, events) does not open with PEEP; collapsed shunt does (recruitable lung).
     Returns null when SpO2 is on goal. Fields: kind, reason {en, hi}, next [{en, hi}], callSenior, fio2AtMax,
     shunt {fixed, collapsed} (fractions). */
  function oxyHelp(state, st, mo) {
    var gl = (state.goals || {}).spo2 || [92, 98], m = state.m || {}, p = state.p, mc = mo.mech;
    if (state.arrest || mo.spo2 >= gl[0]) return null;
    var col = collapsed(state), fixed = clamp(p.shunt0 * (1 - p.recr) + m.shuntAdd, 0, 0.8), atMax = st.fio2 >= 100, kind, reason, next = [];
    if (mc.disc || mc.bag) {
      kind = "disconnected";
      reason = mc.bag ? T("You are hand bagging off the ventilator: no PEEP, so a recruitable lung partly closes.", "आप ventilator हटाकर हाथ से bag कर रहे हैं: PEEP नहीं, इसलिए खुलने वाला फेफड़ा कुछ बंद होता है।")
        : T("The circuit is disconnected: no ventilation, no PEEP, room air.", "Circuit अलग है: ventilation नहीं, PEEP नहीं, कमरे की हवा।");
      next.push(STEP.reconnect);
    } else if (m.ptx > 0) {
      kind = "pneumothorax";
      reason = T("A pneumothorax is collapsing one lung: shunt rose and the heart is squeezed.", "Pneumothorax एक फेफड़ा दबा रहा है: shunt बढ़ा और दिल दब रहा है।");
      next.push(T("Listen to both sides and look at the trachea, then decompress.", "दोनों ओर सुनें और trachea देखें, फिर decompress करें।"));
    } else if (m.sec > 0 || m.plug > 0) {
      kind = "secretions";
      reason = T("Secretions or a mucus plug are blocking airways: the lung behind them gets blood but no air.", "Secretions या mucus plug airways रोक रहे हैं: उनके पीछे के फेफड़े को ख़ून मिलता है, हवा नहीं।");
      next.push(STEP.suction);
    } else if (st.fio2 < 60) {
      kind = "moreOxygen";
      reason = T("FiO2 is " + st.fio2 + "%: there is room to give more oxygen.", "FiO2 " + st.fio2 + "% है: और oxygen देने की गुंजाइश है।");
      next.push(fio2Line(st, mo));
    } else if (col >= 0.05 && col >= 0.5 * fixed) {
      kind = "recruitable";
      reason = T("Part of this lung is collapsed and can reopen (collapsed shunt " + fx(col * 100) + "%). Higher PEEP may help.", "इस फेफड़े का हिस्सा सिकुड़ा है और खुल सकता है (सिकुड़ा shunt " + fx(col * 100) + "%)। ज़्यादा PEEP मदद कर सकता है।");
      next.push(T("Raise PEEP in steps of 2 and watch SpO2 and BP after each step.", "PEEP 2 cmH2O के क़दमों में बढ़ाएँ और हर क़दम के बाद SpO2 और BP देखें।"));
      if (!atMax) next.push(fio2Line(st, mo));
    } else {
      kind = "notRecruiting";
      reason = T("This lung is not recruiting: most of the shunt (" + fx(fixed * 100) + "%) is solid lung, pus or fluid, that PEEP cannot open. More PEEP mainly lowers BP.", "यह फेफड़ा recruit नहीं हो रहा: ज़्यादातर shunt (" + fx(fixed * 100) + "%) ठोस फेफड़ा, pus या fluid है, जिसे PEEP नहीं खोल सकता। ज़्यादा PEEP मुख्यतः BP गिराता है।");
      if (!atMax) next.push(fio2Line(st, mo));
      next.push(T("Check DOPE and suction the tube.", "DOPE जाँचें और tube को suction करें।"));
      next.push(T("Call your senior: prone positioning, a recruitment trial or a muscle relaxant are senior decisions.", "Senior को बुलाएँ: prone position, recruitment trial या muscle relaxant senior के फ़ैसले हैं।"));
    }
    return { kind: kind, reason: reason, next: next, callSenior: mo.spo2 < 85 || atMax || kind === "notRecruiting" || kind === "pneumothorax", fio2AtMax: atMax, shunt: { fixed: r2(fixed), collapsed: r2(col) } };
  }
  function readout(state, settings) {
    var st = norm(settings || state.settings), mo = model(state, st), mc = mo.mech, ev = [], i;
    for (i = 0; i < (state.evlog || []).length; i++) { var e = state.evlog[i]; if (state.t - e.t <= 600) ev.push(clone(e)); }
    var rrSet = ["vc", "acvc", "pc", "acpc", "simv", "prvc", "niv"].indexOf(st.mode) >= 0 && !mc.disc && !mc.bag ? st.rr : null;
    var vent = {
      vte: r0(mc.vte), ve: r1(mc.veMeasured), ppeak: r1(mc.ppeak), pplat: r1(mc.pplat), pmean: r1(mc.pmean), peepTotal: r1(mc.peepTot),
      autoPeep: r1(mc.autoPeep), drivingP: r1(mc.driving), cstat: r0(mc.cstat), raw: r0(mc.R), rrTotal: r0(mc.rr),
      ieActual: mc.ti > 0 ? r1(mc.te / mc.ti) : 0, mechPower: r1(mc.mp), ineffective: r0(mc.ineff), trapV: r0(mc.trapV),
      rrSet: rrSet, rrExtra: rrSet == null ? null : Math.max(0, r0(mc.rr) - rrSet),
      notMeasurable: SPONT_MODES.indexOf(mc.mode) >= 0 && !holdValid(state) ? ["pplat", "cstat", "drivingP"] : [],
      releaseEnd: mc.relEnd == null ? null : r0(mc.relEnd * 100), limited: mc.limited ? { set: r0(mc.limited.set), delivered: r0(mc.limited.delivered), limit: r0(mc.limited.limit) } : null
    };
    return {
      vitals: { spo2: r0(mo.spo2), hr: r0(mo.hr), sbp: r0(mo.sbp), dbp: r0(mo.dbp), map: r0(mo.map), rr: r0(mc.rr), temp: r1(mo.temp), etco2: r0(mo.etco2) },
      vent: vent,
      gas: {
        pao2: r0(mo.pao2), paco2: r0(mo.paco2), ph: r2(mo.ph), hco3: r1(mo.hco3), sao2: r0(mo.sao2 * 100), be: r1(mo.be), lactate: r1(mo.lactate),
        // A-a gradient from the alveolar gas equation at the set FiO2, as a clinician calculates it (E11)
        pfRatio: r0(mo.pao2 / mo.fio2), aaGradient: r0(Math.max(0, mo.PAtarget - mo.pao2)), vdvt: r2(mo.vdvt), shunt: r2(mo.shunt),
        p50: r1(p50Of(mo.ph, mo.temp, mo.paco2))
      },
      flags: flagsOf(state, mo),
      events: ev,
      arrest: state.arrest ? { t: state.arrest.t, cause: state.arrest.cause, label: ARREST_TXT[state.arrest.cause] } : null,
      oxygenHelp: oxyHelp(state, st, mo)
    };
  }
  function abg(state) {
    var l = state.last;
    var tp = l.temp != null ? l.temp : state.p.temp + ((state.m || {}).tempAdd || 0);
    // P50 and curveNote (E4): additive; the UI may show the note beside SaO2 so a right-shifted curve is explained
    return { pH: r2(l.ph), PaCO2: r0(l.paco2), PaO2: r0(l.pao2), HCO3: r1(l.hco3), SaO2: r0(l.sao2 * 100), BE: r1(l.be), lactate: r1(l.lactate), FiO2: r2(l.fio2), AaDO2: r0(Math.max(0, (l.pA || 0) - l.pao2)), t: state.t,
      P50: r1(p50Of(l.ph, tp, l.paco2)), curveNote: curveNote(l.pao2, l.sao2, l.ph, tp, l.paco2) };
  }

  /* hold(state, settings, "insp"|"exp"): an inspiratory hold measures plateau (so Cstat and driving pressure); an
     expiratory hold measures total PEEP (so auto-PEEP). A hold is valid only on a passive patient. Returns the numbers
     and a new state that remembers the hold, so readout() can show Pplat in a spontaneous mode for the next 2 min. */
  function hold(state, settings, kind) {
    var st = norm(settings || state.settings), mo = model(state, st), mc = mo.mech, s = clone(state);
    kind = kind === "exp" ? "exp" : "insp";
    var passive = mc.drive.rate <= 0 || mc.drive.pmus < 1, cl = mc.plc || mc.prim, o = { kind: kind, measured: false, passive: passive };
    var setPeep = mc.mode === "niv" ? st.epap : mc.mode === "aprv" ? st.plow : st.peep;
    if (!passive) o.reason = T("The patient breathed during the hold, so the number is not reliable. Sedate, or wait for a quiet breath.", "Hold के दौरान मरीज़ ने साँस ली, इसलिए संख्या भरोसेमंद नहीं। Sedation दें, या शांत साँस का इंतज़ार करें।");
    else if (kind === "insp" && !cl) o.reason = T("There is no ventilator breath to hold in this mode.", "इस mode में hold करने के लिए ventilator की साँस नहीं है।");
    else {
      o.measured = true;
      o.peepTotal = r1(mc.peepTot); o.autoPeep = r1(Math.max(0, mc.peepTot - setPeep));
      if (kind === "insp") {
        var pp = Math.max(mc.peepTot, pel(vOf(mc.peepTot, mc.C, state.p.ui) + cl.sol.vt, mc.C, state.p.ui)), dp = pp - mc.peepTot;
        o.pplat = r1(pp); o.drivingP = r1(dp); o.cstat = dp > 0.3 ? r0(cl.sol.vt / dp) : null;
      }
    }
    s.hold = { t: s.t, kind: kind, passive: o.measured };
    o.state = s;
    return o;
  }

  /* exam(state): what the learner hears and sees at the bedside. Scenario exam {crackles, reduced, ptxSide} sets the
     baseline; events (pneumothorax side, bronchospasm, secretions, plug, oedema, disconnect) change it. */
  var EX = {
    normal: T("Normal air entry", "हवा का प्रवेश सामान्य"), reduced: T("Reduced air entry", "हवा का प्रवेश कम"), absent: T("No air entry", "हवा का प्रवेश नहीं"),
    central: T("Trachea central", "Trachea बीच में"), devL: T("Trachea pushed to the left", "Trachea बाईं ओर खिसकी"), devR: T("Trachea pushed to the right", "Trachea दाईं ओर खिसकी"),
    noWheeze: T("No wheeze", "Wheeze नहीं"), wheeze: T("Wheeze when breathing out", "साँस छोड़ते समय wheeze (सीटी जैसी आवाज़)"),
    silent: T("Very quiet chest: airways so tight that little air moves", "छाती बहुत शांत: airways इतनी सँकरी कि हवा कम चलती है"),
    noCrackles: T("No crackles", "Crackles नहीं"), bibasal: T("Fine crackles at both bases", "दोनों निचले हिस्सों में बारीक crackles"),
    bilateral: T("Crackles over both lungs", "दोनों फेफड़ों में crackles"), crR: T("Crackles over the right lower chest", "दाईं निचली छाती में crackles"),
    crL: T("Crackles over the left chest", "बाईं छाती में crackles"), coarse: T("Coarse crackles and gurgling in the tube: secretions", "मोटे crackles और tube में गुड़गुड़: secretions"),
    riseEq: T("Chest rises equally", "छाती दोनों ओर बराबर उठती है"), riseL: T("Left chest rises less", "बाईं छाती कम उठती है"), riseR: T("Right chest rises less", "दाईं छाती कम उठती है"),
    riseSmall: T("Chest barely rises", "छाती मुश्किल से उठती है"), riseNone: T("No chest rise", "छाती नहीं उठती")
  };
  function exItem(id) { return { id: id, en: EX[id].en, hi: EX[id].hi }; }
  function exam(state) {
    var s = state, mo = model(s, s.settings), mc = mo.mech, m = s.m, x = s.exam || {}, side = m.ptx > 0 ? m.ptxSide || x.ptxSide || "right" : null;
    var air = { left: "normal", right: "normal" }, red = x.reduced || "none", cr = x.crackles || "none", rise = "riseEq";
    if (red === "bibasal" || red === "both") { air.left = "reduced"; air.right = "reduced"; }
    else if (red === "left" || red === "right") air[red] = "reduced";
    if (m.plug > 0) air.right = "reduced";
    if (side) { air[side] = "absent"; rise = side === "left" ? "riseL" : "riseR"; }
    else if (red === "left") rise = "riseL"; else if (red === "right") rise = "riseR";
    var R = mc.R, wh = R >= 60 ? "silent" : R >= 18 || m.spF > 1.05 ? "wheeze" : "noWheeze";
    if (wh === "silent") { air.left = air.left === "absent" ? "absent" : "reduced"; air.right = air.right === "absent" ? "absent" : "reduced"; }
    if (mc.disc || mc.vte < 3 * s.p.pbw) { rise = mc.disc ? "riseNone" : "riseSmall"; if (mc.disc) { air.left = "absent"; air.right = "absent"; } }
    var crId = cr === "bibasal" ? "bibasal" : cr === "bilateral" ? "bilateral" : cr === "right" ? "crR" : cr === "left" ? "crL" : "noCrackles";
    if (cr === "bilateral" && m.improved) crId = "bibasal"; // oedema clearing
    if (m.oedema > 0) crId = "bilateral"; // fluid in a full circulation: more lung water
    if (m.sec > 0) crId = "coarse";
    var o = {
      airEntry: { left: exItem(air.left), right: exItem(air.right) },
      trachea: exItem(side ? (side === "left" ? "devR" : "devL") : "central"),
      wheeze: exItem(wh), crackles: exItem(crId), chestRise: exItem(rise)
    };
    o.summary = T([o.airEntry.left.en + " on the left", o.airEntry.right.en + " on the right", o.trachea.en, o.wheeze.en, o.crackles.en].join(". ") + ".",
      ["बाईं ओर: " + o.airEntry.left.hi, "दाईं ओर: " + o.airEntry.right.hi, o.trachea.hi, o.wheeze.hi, o.crackles.hi].join("। ") + "।");
    return o;
  }

  var ALARM = {
    pPeakHigh: T("High peak pressure", "Peak pressure ज़्यादा"), pPlatHigh: T("Plateau above 30", "Plateau 30 से ऊपर"),
    vtLow: T("Low tidal volume", "Tidal volume कम"), veLow: T("Low minute volume", "Minute volume कम"), veHigh: T("High minute volume", "Minute volume ज़्यादा"),
    apnoea: T("Apnoea", "साँस रुकना (apnoea)"), rrHigh: T("High rate", "Rate ज़्यादा"), fio2Low: T("Low FiO2", "FiO2 कम"), fio2High: T("High FiO2", "FiO2 ज़्यादा"),
    peepLow: T("Low PEEP", "PEEP कम"), peepHigh: T("High PEEP", "PEEP ज़्यादा"), disconnect: T("Disconnection", "Circuit अलग हुआ"),
    autoPeep: T("Auto-PEEP", "फँसी हवा का दबाव (auto-PEEP)"), dyssync: T("Patient-ventilator dyssynchrony", "मरीज़ और ventilator का तालमेल नहीं (dyssynchrony)"),
    peepSetHigh: T("PEEP set high: blood pressure falling", "PEEP ज़्यादा रखा गया: BP गिर रहा है"),
    spo2Low: T("Low SpO2", "SpO2 कम"), mapLow: T("Low blood pressure", "Blood pressure कम"),
    hrHigh: T("High heart rate", "Heart rate ज़्यादा"), hrLow: T("Low heart rate", "Heart rate कम"),
    etco2High: T("High EtCO2", "EtCO2 ज़्यादा")
  };
  var MONITOR = { spo2Low: 1, mapLow: 1, hrHigh: 1, hrLow: 1, etco2High: 1 };
  /* Capnograph high EtCO2 limit (mmHg): 50 by default (a common monitor default); a scenario may set monitor.etco2High
     for a patient whose usual CO2 is high (COPD, permissive hypercapnia), as a clinician sets the limit at the bedside. */
  var ETCO2_HIGH = 50;
  function alarm(id, sev) { var o = { id: id, severity: sev, label: ALARM[id] }; if (MONITOR[id]) { o.monitor = true; o.persistent = true; } return o; }
  function setPeepOf(st) { return st.mode === "niv" ? st.epap : st.mode === "aprv" ? st.plow : st.peep; }
  /* The PEEP a learner who set it too high should go back to: the start PEEP for a lung with little to recruit. */
  function peepFix(state, st) {
    var key = st.mode === "niv" ? "epap" : "peep", sp = setPeepOf(st), s0 = (state.startSet || {})[key] || 5, p = state.p;
    return { key: key, to: Math.round(p.shunt0 * p.recr < 0.1 ? Math.max(5, s0) : Math.max(s0, sp - 4)) };
  }
  function rawAlarms(state, st, mo) {
    mo = mo || model(state, st);
    var mc = mo.mech, a = [];
    var volMode = ["vc", "acvc", "simv", "prvc"].indexOf(st.mode) >= 0, setPeep = setPeepOf(st);
    if (mc.disc || mc.bag) a.push(alarm("disconnect", "danger"));
    if (!mc.bag) {
      if (mc.ppeak >= st.pPeakHigh) a.push(alarm("pPeakHigh", "danger"));
      if (mc.pplat > 30 && SPONT_MODES.indexOf(mc.mode) < 0) a.push(alarm("pPlatHigh", "warn"));
      if (mc.vte < 4 * state.p.pbw || (volMode && mc.vtMand != null && mc.vtMand < 0.8 * st.vt)) a.push(alarm("vtLow", "warn"));
      if (mc.veMeasured < st.veLow) a.push(alarm("veLow", "danger"));
      if (mc.veMeasured > st.veHigh) a.push(alarm("veHigh", "warn"));
      if (mc.apnoea && (state.apS >= st.apnoea || mc.disc)) a.push(alarm("apnoea", "danger"));
      if (mc.rr > st.rrHigh) a.push(alarm("rrHigh", "warn"));
      var fi = mo.fio2 * 100;
      if (fi < st.fio2Low || fi < st.fio2 - 6) a.push(alarm("fio2Low", "danger"));
      if (fi > st.fio2High || fi > st.fio2 + 6) a.push(alarm("fio2High", "warn"));
      if (!mc.disc && (mc.peep < st.peepLow || mc.peep < setPeep - 2)) a.push(alarm("peepLow", "warn"));
      // measured PEEP above the limit, or 5 above the set PEEP (trapping); APRV's short release traps gas on purpose (E1)
      if (!mc.aprv && (mc.peepTot >= setPeep + 5 || (st.peepHigh > setPeep && mc.peepTot >= st.peepHigh))) a.push(alarm("peepHigh", "warn"));
      if (!mc.aprv && mc.autoPeep >= 5) a.push(alarm("autoPeep", "warn"));
      if (mc.ineff > 2 && mc.drive.pmus > 1) a.push(alarm("dyssync", "warn"));
      // the learner's own PEEP lowers venous return (Raju 1): separate from auto-PEEP
      if (!mc.aprv && !mc.disc && setPeep >= 10 && mo.map < 65) {
        var fx_ = peepFix(state, st), alt = clone(st); alt[fx_.key] = fx_.to;
        if (fx_.to < setPeep && model(state, norm(alt)).map >= mo.map + 3) { var ps = alarm("peepSetHigh", "warn"); ps.fix = fx_; a.push(ps); }
      }
    }
    // monitor alarms stay on until the value recovers (they cannot be acknowledged away)
    var gl = (state.goals || {}).spo2 || [92, 98];
    if (mo.spo2 < gl[0]) a.push(alarm("spo2Low", mo.spo2 < 85 ? "danger" : "warn"));
    if (mo.map < 65) a.push(alarm("mapLow", mo.map < 55 ? "danger" : "warn"));
    if (mo.hr > 120) a.push(alarm("hrHigh", mo.hr > 140 ? "danger" : "warn"));
    if (mo.hr < 50) a.push(alarm("hrLow", "danger"));
    // capnography: hypoventilation shows here before the blood gas (E5); not while disconnected or bagged (no trace)
    if (!mc.disc && !mc.bag && mo.etco2 > ((state.limits || {}).etco2High || ETCO2_HIGH)) a.push(alarm("etco2High", "warn"));
    return a;
  }
  function hasA(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return true; return false; }
  /* Which setting changes can cause which alarm (only these are tested by reverting them). */
  var CAUSE_KEYS = {
    pPeakHigh: ["vt", "pinsp", "ti", "peep", "rr", "pPeakHigh", "mode", "flowPattern", "ps", "ipap", "phigh"], pPlatHigh: ["vt", "peep", "pinsp", "ti", "rr", "mode", "ipap"],
    vtLow: ["vt", "pinsp", "ps", "ti", "pPeakHigh", "mode", "rr", "peep", "ipap", "epap"], veLow: ["rr", "vt", "ps", "pinsp", "mode", "pPeakHigh", "peep"], veHigh: ["rr", "vt", "pinsp", "ps", "mode"],
    apnoea: ["mode", "ps", "rr"], rrHigh: ["rr", "mode"], fio2Low: ["fio2"], fio2High: ["fio2"], peepLow: ["peep", "epap", "plow"], peepHigh: ["peep", "rr", "vt", "ti", "epap"],
    autoPeep: ["rr", "vt", "ti", "pinsp", "mode", "ps", "cycle"], dyssync: ["trigType", "trigFlow", "trigPress", "cycle", "mode", "ps", "rr", "vt", "ti", "peep"],
    peepSetHigh: ["peep", "epap"], spo2Low: ["fio2", "peep", "epap", "mode", "vt", "rr", "pinsp", "ps", "plow", "phigh", "tlow"],
    mapLow: ["peep", "epap", "rr", "vt", "ti", "pinsp", "ipap", "mode", "phigh", "plow"], hrHigh: ["peep", "rr", "vt", "ti", "fio2", "mode"], hrLow: ["fio2", "peep", "mode", "rr", "vt"],
    etco2High: ["rr", "vt", "pinsp", "ps", "mode", "ipap", "pPeakHigh"]
  };
  var SLOW_ALARMS = { spo2Low: 1, hrLow: 1, hrHigh: 1, etco2High: 1 };
  /* causedBy: the newest learner change (within 30 min) whose reversal clears this alarm. Fast alarms are tested on the
     current state; SpO2 and heart rate, which follow oxygen stores, are tested after 10 min at both settings. */
  function causeOf(state, st, id, settled) {
    var ch = (state.changes || []).slice(), cur = state.settings || {}, i, k;
    for (i = 0; i < CHANGE_KEYS.length; i++) { k = CHANGE_KEYS[i]; if (cur[k] != null && st[k] != null && cur[k] !== st[k]) ch.push({ t: state.t, key: k, from: cur[k], to: st[k] }); }
    for (i = ch.length - 1; i >= 0; i--) {
      var c = ch[i];
      if (state.t - c.t > 1800) break;
      if ((CAUSE_KEYS[id] || []).indexOf(c.key) < 0) continue;
      var alt = clone(st); alt[c.key] = c.from; alt = norm(alt);
      var gone;
      if (SLOW_ALARMS[id]) {
        if (!settled.on) settled.on = rawAlarms(settled.base = frozenStep(state, st, 600), st);
        gone = hasA(settled.on, id) && !hasA(rawAlarms(frozenStep(state, alt, 600), alt), id);
      } else gone = !hasA(rawAlarms(state, alt), id);
      if (gone) return { key: c.key, from: c.from, to: c.to, minutesAgo: Math.max(0, Math.round((state.t - c.t) / 60)) };
    }
    return null;
  }
  function frozenStep(state, st, secs) {
    var f = clone(state), i;
    for (i = 0; i < f.timeline.length; i++) if (f.fired.indexOf(i) < 0) f.fired.push(i);
    f.changes = []; f.settings = st;
    return step(f, st, secs);
  }
  function alarms(state, settings) {
    var st = norm(settings || state.settings), a = rawAlarms(state, st), i, settled = {};
    // E7: the bedside response plan rides on each alarm (additive fields, see planOf)
    var mo = model(state, st), k, pl;
    for (i = 0; i < a.length; i++) { pl = planOf(state, st, mo, a[i], sugOf(state, a[i])); for (k in pl) if (own(pl, k)) a[i][k] = pl[k]; }
    if (state.arrest) return a;
    for (i = 0; i < a.length; i++) { var c = causeOf(state, st, a[i].id, settled); if (c) a[i].causedBy = c; }
    return a;
  }

  /* suggestActions(state, alarms?): only the bedside actions that fit the active alarms and events (E7, A15). */
  var SUGGEST_WHY = {
    decompress: T("The chest is silent on one side and pressures rose: a pneumothorax needs decompression.", "एक ओर छाती शांत है और pressure बढ़ा: pneumothorax को decompress करना होगा।"),
    suction: T("Secretions narrow the tube and raise peak pressure. Suction clears them.", "Secretions tube को सँकरा करते हैं और peak pressure बढ़ाते हैं। Suction उन्हें साफ़ करता है।"),
    bronchodilator: T("Narrow airways raise peak pressure and trap air. A bronchodilator opens them over minutes.", "सँकरी airways peak pressure बढ़ाती हैं और हवा फँसाती हैं। Bronchodilator कुछ मिनटों में उन्हें खोलता है।"),
    disconnect: T("Trapped air is squeezing the heart. A brief disconnect lets it out and BP should rise.", "फँसी हवा दिल को दबा रही है। थोड़ी देर disconnect से वह निकलती है और BP बढ़ना चाहिए।"),
    sedate: T("The patient is fighting the ventilator. Deeper sedation calms the efforts.", "मरीज़ ventilator से लड़ रहा है। गहरा sedation प्रयासों को शांत करता है।"),
    paralyse: T("Efforts still fight the ventilator despite deep sedation. A muscle relaxant stops them.", "गहरे sedation के बाद भी प्रयास ventilator से लड़ रहे हैं। Muscle relaxant उन्हें रोकता है।"),
    fluid: T("The circulation is dry. A fluid bolus raises preload and BP.", "शरीर में पानी कम है। Fluid bolus preload और BP बढ़ाता है।"),
    blood: T("He has lost blood. Blood restores volume and oxygen carrying.", "ख़ून बहा है। Blood volume और oxygen ले जाने की क्षमता लौटाता है।"),
    bag100: T("Oxygen is dangerously low. Hand bag with 100% oxygen while you look for the cause.", "Oxygen ख़तरनाक रूप से कम है। कारण ढूँढते हुए 100% oxygen से हाथ से bag करें।")
  };
  function suggestActions(state, list) {
    var st = state.settings, mo = model(state, st), mc = mo.mech, m = state.m, out = [], ids = {}, i;
    list = list || alarms(state, st);
    for (i = 0; i < list.length; i++) ids[list[i].id] = list[i];
    function add(id) { if (ACTIONS[id] && ACTIONS[id].available(state)) { for (var j = 0; j < out.length; j++) if (out[j].id === id) return; out.push({ id: id, label: ACTIONS[id].label, why: SUGGEST_WHY[id] }); } }
    var press = ids.pPeakHigh || ids.vtLow || ids.pPlatHigh || ids.veLow;
    if (m.ptx > 0 && (press || ids.spo2Low || ids.mapLow)) add("decompress");
    if ((m.sec > 0 || m.plug > 0) && (press || ids.spo2Low)) add("suction");
    if ((m.spF > 1.05 || mc.R >= 20) && (press || ids.autoPeep || ids.peepHigh)) add("bronchodilator");
    if (mc.autoPeep >= 5 && ids.mapLow && !mc.aprv) add("disconnect");
    if (ids.dyssync) add(m.sed >= 0.9 ? "paralyse" : "sedate");
    if (ids.mapLow && !ids.peepSetHigh && (m.vs === "low" || m.hypoUntil > state.t)) { add("fluid"); if (state.p.hb < 10 || m.bled) add("blood"); }
    if (ids.spo2Low && mo.spo2 < 85 && !mc.disc) add("bag100");
    return out;
  }

  /* ---------- alarm response plan (E7) ----------
     Every alarm from alarms() also carries, additively:
       priority   "high" | "medium" | "low": IEC 60601-1-8 priority. danger maps to high, warn to medium; no existing
                  alarm is lowered. "low" (advisory) is reserved and no alarm uses it yet.
       checklist  ordered bedside steps [{id, text {en, hi}, action?}], patient first; action names an E.ACTIONS id
                  the UI can offer as a button on that line.
       actions    E.ACTIONS ids that fit this alarm now: the state-aware cause first (suggestActions), then the
                  generic bedside response; only actions available in this state.
       primary    what the card leads with: {kind: "action", id, label} | {kind: "setting", key, to, label} |
                  {kind: "check", id, label}. Never the alarm limit.
       fio2Line   (spo2Low, fio2Low) a state-aware FiO2 sentence: says so when FiO2 is already 100%.
       callNow    true when a call-the-senior trigger is met; callWhy {en, hi} names it.
     E.alarmPlan(state, id, settings) returns the same fields for any alarm id (also UI-only monitor alarms). */
  var STEP = {
    patient: T("Look at the patient first: colour, chest rise, the SpO2 trace.", "पहले मरीज़ को देखें: रंग, छाती का उठना, SpO2 trace।"),
    probe: T("Check the SpO2 probe: a clean trace on a warm finger. A poor trace can give a false low reading.", "SpO2 probe जाँचें: गर्म उँगली पर साफ़ trace। ख़राब trace से reading झूठी कम आ सकती है।"),
    circuit: T("Follow the circuit from the tube to the ventilator: every joint connected, no leak, no water in the tubing.", "Tube से ventilator तक circuit देखें: हर जोड़ लगा हो, कोई leak न हो, tubing में पानी न हो।"),
    reconnect: T("Reconnect the circuit at once. If you cannot find the break, hand bag with 100% oxygen.", "Circuit तुरंत जोड़ें। टूटी जगह न मिले तो 100% oxygen से हाथ से bag करें।"),
    dope: T("Think DOPE: Displaced tube, Obstructed tube, Pneumothorax, Equipment (circuit, ventilator, oxygen).", "DOPE सोचें: tube खिसकी (Displaced), tube बंद (Obstructed), Pneumothorax, Equipment (circuit, ventilator, oxygen)।"),
    suction: T("Suction the tube: it clears secretions and shows the tube is open.", "Tube को suction करें: secretions साफ़ होते हैं और पता चलता है कि tube खुली है।"),
    bag: T("If the patient is unstable or you are unsure: take the patient off the ventilator and hand bag with 100% oxygen.", "मरीज़ unstable हो या आप पक्के न हों: ventilator हटाकर 100% oxygen से हाथ से bag करें।"),
    senior: T("Call your senior and say: patient, alarm, numbers, what you have done (SBAR).", "Senior को बुलाएँ और बताएँ: मरीज़, alarm, संख्याएँ, आपने क्या किया (SBAR)।"),
    noLimit: T("Do not raise the alarm limit to stop the sound: that hides the problem, it does not treat the patient.", "आवाज़ बंद करने के लिए alarm limit न बढ़ाएँ: इससे समस्या छिपती है, मरीज़ का इलाज नहीं होता।"),
    peakPlat: T("Check the plateau with an inspiratory hold. High peak with a normal plateau: the airway (secretions, bitten or kinked tube, bronchospasm). Both high: the lung or chest (pneumothorax, stiff lung).", "Inspiratory hold से plateau देखें। Peak ज़्यादा और plateau सामान्य: airway (secretions, दबी या मुड़ी tube, bronchospasm)। दोनों ज़्यादा: फेफड़ा या छाती (pneumothorax, सख़्त फेफड़ा)।"),
    lowerVt: T("Lower VT toward 6 mL/kg predicted body weight; raise the rate to hold pH.", "VT को 6 mL/kg predicted body weight की ओर घटाएँ; pH बनाए रखने को rate बढ़ाएँ।"),
    breathing: T("Is the patient breathing? Check sedation and the drive to breathe. Missing breaths need a mode with a set rate.", "क्या मरीज़ साँस ले रहा है? Sedation और साँस की drive देखें। साँसें छूट रही हों तो तय rate वाला mode चाहिए।"),
    agitation: T("Look for pain, agitation, hypoxia, fever or a full bladder. Treat the cause before you sedate.", "दर्द, बेचैनी, hypoxia, बुख़ार या भरा bladder देखें। Sedation से पहले कारण का इलाज करें।"),
    trapping: T("Look at the flow wave: if expiratory flow does not reach zero, air is trapped. Lower the rate or shorten Ti to give time to breathe out.", "Flow wave देखें: expiratory flow zero तक न पहुँचे तो हवा फँसी है। साँस छोड़ने का समय देने को rate घटाएँ या Ti छोटा करें।"),
    letOut: T("If BP is falling with trapped air: disconnect for a few seconds to let it out.", "फँसी हवा के साथ BP गिर रहा हो: कुछ सेकंड ventilator अलग करके हवा निकलने दें।"),
    peepBack: T("Your PEEP is lowering the BP: bring it back toward the start PEEP.", "आपका PEEP BP गिरा रहा है: उसे शुरू वाले PEEP की ओर वापस लाएँ।"),
    bpCheck: T("Feel the pulse and recheck the BP cuff. High chest pressure (PEEP, trapped air) lets less blood return to the heart.", "Pulse देखें और BP cuff दोबारा जाँचें। छाती में ऊँचा दबाव (PEEP, फँसी हवा) दिल तक कम ख़ून लौटने देता है।"),
    bpTreat: T("Fluids or a vasopressor are your senior's decision: call while you check.", "Fluid या vasopressor का फ़ैसला senior का है: जाँचते हुए बुलाएँ।"),
    o2supply: T("Check the oxygen supply: wall outlet, cylinder, hose. Hand bag from a separate oxygen source.", "Oxygen supply जाँचें: wall outlet, cylinder, hose। अलग oxygen source से हाथ से bag करें।"),
    fio2Set: T("Check that the FiO2 setting is the one you meant.", "जाँचें कि FiO2 वही set है जो आप चाहते थे।"),
    co2: T("Check the minute volume: a low rate, small breaths, a leak or apnoea raise CO2. Fever and shivering make more CO2.", "Minute volume देखें: कम rate, छोटी साँसें, leak या apnoea से CO2 बढ़ता है। बुख़ार और कँपकँपी ज़्यादा CO2 बनाते हैं।"),
    abg: T("Draw a blood gas: the pH says how urgent a high CO2 is. In COPD or asthma a high CO2 with a safe pH can be accepted: ask your senior.", "Blood gas लें: pH बताता है कि ऊँचा CO2 कितना urgent है। COPD या asthma में सुरक्षित pH के साथ ऊँचा CO2 स्वीकार हो सकता है: senior से पूछें।"),
    slowHeart: T("A slow heart rate with low oxygen is hypoxia until proved otherwise: hand bag with 100% oxygen now.", "कम oxygen के साथ धीमी धड़कन hypoxia है जब तक उल्टा साबित न हो: अभी 100% oxygen से हाथ से bag करें।")
  };
  var STEP_ACT = { suction: "suction", bag: "bag100", slowHeart: "bag100", letOut: "disconnect", reconnect: "bag100" };
  var PLAN = {
    pPeakHigh: [["patient", "suction", "peakPlat", "dope", "bag", "noLimit", "senior"], ["suction", "bag100"]],
    pPlatHigh: [["patient", "peakPlat", "lowerVt", "dope", "senior"], []],
    vtLow: [["patient", "circuit", "dope", "breathing", "bag", "senior"], ["bag100"]],
    veLow: [["patient", "circuit", "breathing", "dope", "bag", "senior"], ["bag100"]],
    veHigh: [["patient", "agitation", "circuit", "senior"], []],
    apnoea: [["patient", "breathing", "bag", "dope", "senior"], ["bag100"]],
    rrHigh: [["patient", "agitation", "circuit", "senior"], []],
    fio2Low: [["patient", "o2supply", "fio2", "bag", "senior"], ["bag100"]],
    fio2High: [["fio2Set", "patient"], []],
    peepLow: [["patient", "circuit", "dope", "senior"], []],
    peepHigh: [["patient", "trapping", "letOut", "senior"], []],
    disconnect: [["patient", "reconnect", "circuit", "dope", "senior"], ["bag100"]],
    autoPeep: [["patient", "trapping", "letOut", "senior"], []],
    dyssync: [["patient", "agitation", "senior"], []],
    peepSetHigh: [["patient", "peepBack", "senior"], []],
    spo2Low: [["patient", "probe", "circuit", "fio2", "suction", "dope", "bag", "senior"], ["bag100", "suction"]],
    mapLow: [["patient", "bpCheck", "trapping", "bpTreat", "senior"], []],
    hrHigh: [["patient", "agitation", "senior"], []],
    hrLow: [["patient", "slowHeart", "dope", "senior"], ["bag100"]],
    etco2High: [["patient", "co2", "abg", "senior"], []]
  };
  var PRIO = { danger: "high", warn: "medium", info: "low" };
  var CHECK_LABEL = {
    patient: T("Look at the patient", "मरीज़ को देखें"), dope: T("Check DOPE", "DOPE जाँचें"), circuit: T("Check the circuit", "Circuit जाँचें"),
    reconnect: T("Reconnect the circuit", "Circuit जोड़ें"), peepBack: T("Bring PEEP back down", "PEEP वापस घटाएँ"), o2supply: T("Check the oxygen supply", "Oxygen supply जाँचें"),
    fio2Set: T("Check the FiO2 setting", "FiO2 setting जाँचें"), co2: T("Check the minute volume", "Minute volume जाँचें"), trapping: T("Give time to breathe out", "साँस छोड़ने का समय दें")
  };
  function fio2Line(st, mo) {
    var f = st.fio2, sp = r0(mo.spo2);
    if (f >= 100) return T("FiO2 is already 100%: the ventilator cannot give more oxygen. Find the cause (DOPE, suction) and call your senior.", "FiO2 पहले से 100% है: ventilator इससे ज़्यादा oxygen नहीं दे सकता। कारण ढूँढें (DOPE, suction) और senior को बुलाएँ।");
    if (f >= 60) return T("FiO2 is " + f + "%. Raise it to 100% now while you look for the cause, then wean it once SpO2 is back.", "FiO2 " + f + "% है। कारण ढूँढते हुए अभी 100% करें, SpO2 लौटने पर फिर घटाएँ।");
    return T("FiO2 is " + f + "%. Raise it (SpO2 " + sp + "%) while you look for the cause.", "FiO2 " + f + "% है। कारण ढूँढते हुए इसे बढ़ाएँ (SpO2 " + sp + "%)।");
  }
  function callOf(state, st, mo) {
    var mc = mo.mech, gl = (state.goals || {}).spo2 || [92, 98], en = [], hi = [];
    if (mo.spo2 < 85) { en.push("SpO2 below 85%"); hi.push("SpO2 85% से कम"); }
    else if (mo.spo2 < gl[0] && st.fio2 >= 80) { en.push("SpO2 below target on FiO2 " + st.fio2 + "%"); hi.push("FiO2 " + st.fio2 + "% पर भी SpO2 लक्ष्य से कम"); }
    if (mo.map < 65) { en.push("mean BP below 65"); hi.push("औसत BP 65 से कम"); }
    if (mo.hr < 50) { en.push("heart rate below 50"); hi.push("धड़कन 50 से कम"); }
    if (mo.ph < 7.2) { en.push("pH below 7.20"); hi.push("pH 7.20 से कम"); }
    if (!mc.aprv && mc.autoPeep >= 10) { en.push("auto-PEEP 10 or more"); hi.push("auto-PEEP 10 या ज़्यादा"); }
    if (state.m && state.m.ptx > 0) { en.push("a possible pneumothorax"); hi.push("संभावित pneumothorax"); }
    if (mc.disc && !mc.bag) { en.push("the circuit is disconnected"); hi.push("circuit अलग है"); }
    return en.length ? T("Call your senior now: " + en.join(", ") + ".", "अभी senior को बुलाएँ: " + hi.join(", ") + "।") : null;
  }
  function planOf(state, st, mo, a, sug) {
    var id = a.id, pl = PLAN[id] || [["patient", "dope", "senior"], []], mc = mo.mech, steps = [], acts = [], i, k;
    function avail(x) { return !!(ACTIONS[x] && ACTIONS[x].available(state)); }
    function addAct(x) { if (avail(x) && acts.indexOf(x) < 0) acts.push(x); }
    for (i = 0; i < sug.length; i++) addAct(sug[i]);
    for (i = 0; i < pl[1].length; i++) addAct(pl[1][i]);
    var fl = id === "spo2Low" || id === "fio2Low" ? fio2Line(st, mo) : null;
    for (i = 0; i < pl[0].length; i++) {
      k = pl[0][i];
      if (k === "fio2") { if (fl) steps.push({ id: "fio2", text: fl }); continue; }
      var o = { id: k, text: STEP[k] };
      if (STEP_ACT[k] && avail(STEP_ACT[k])) o.action = STEP_ACT[k];
      steps.push(o);
    }
    var prim;
    function pa(x) { return { kind: "action", id: x, label: ACTIONS[x].label }; }
    function pc(x) { return { kind: "check", id: x, label: CHECK_LABEL[x] || CHECK_LABEL.patient }; }
    if (sug.length && avail(sug[0])) prim = pa(sug[0]);
    else if (id === "pPeakHigh") prim = avail("suction") ? pa("suction") : pc("dope");
    else if (id === "spo2Low") {
      if (mo.spo2 < 88 && avail("bag100")) prim = pa("bag100");
      else if (st.fio2 < 100 && !mc.disc) { var to = Math.min(100, st.fio2 >= 60 ? 100 : st.fio2 + 20); prim = { kind: "setting", key: "fio2", to: to, label: T("Raise FiO2 to " + to + "%", "FiO2 " + to + "% करें") }; }
      else prim = avail("bag100") ? pa("bag100") : pc("dope");
    }
    else if (id === "disconnect") prim = pc(mc.bag ? "patient" : "reconnect");
    else if (id === "apnoea" || id === "hrLow") prim = avail("bag100") ? pa("bag100") : pc("patient");
    else if (id === "vtLow" || id === "veLow" || id === "peepLow") prim = pc("circuit");
    else if (id === "fio2Low") prim = pc("o2supply");
    else if (id === "fio2High") prim = pc("fio2Set");
    else if (id === "peepSetHigh") prim = pc("peepBack");
    else if (id === "autoPeep" || id === "peepHigh") prim = pc("trapping");
    else if (id === "etco2High") prim = pc("co2");
    else prim = pc("patient");
    var call = callOf(state, st, mo), out = { priority: PRIO[a.severity] || "medium", checklist: steps, actions: acts, primary: prim, callNow: !!call };
    if (call) out.callWhy = call;
    if (fl) out.fio2Line = fl;
    return out;
  }
  /* suggestions that belong to one alarm (the state-aware cause) */
  function sugOf(state, a) { var x = suggestActions(state, [a]), o = [], i; for (i = 0; i < x.length; i++) o.push(x[i].id); return o; }
  function alarmPlan(state, id, settings) {
    var st = norm(settings || state.settings), mo = model(state, st), list = rawAlarms(state, st, mo), a = null, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) a = list[i];
    a = a || { id: id, severity: "warn" };
    return planOf(state, st, mo, a, sugOf(state, a));
  }

  /* ---------- explanations ---------- */
  function fx(x, d) { return String(d ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : Math.round(x)); }
  function metOf(s) { return s.p.hco3 - (s.lac - s.p.lac0); } // metabolic bicarbonate, before acute CO2 buffering
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
      var base = { hb: stB.p.hb, ph: B.ph, temp: B.temp, paco2: B.paco2, pao2A: B.PAtarget, shunt: B.shunt, lowvq: stB.p.lowvq, vqr: stB.p.vqr, va: B.va, co: B.co, vo2: B.vo2 };
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
      if (out.length === n0) out.push({ param: "PaO2", direction: dirO, because: dirO === "up" ? T("PaO2 is still rising. The oxygen held in the lungs takes a few minutes to build up after a change.", "PaO2 अभी बढ़ रहा है। बदलाव के बाद फेफड़ों में oxygen भरने में कुछ मिनट लगते हैं।")
        : T("PaO2 is still falling. The oxygen held in the lungs runs down over a few minutes.", "PaO2 अभी गिर रहा है। फेफड़ों में रखी oxygen कुछ मिनटों में घटती है।"), chain: CH.slice() });
      // SaO2 can move against PaO2 when pH or temperature shift the curve (Bohr effect); say so instead of contradicting
      var dS = abgA.SaO2 - abgB.SaO2;
      if (Math.abs(dS) >= 1 && (dS > 0) !== (dO > 0)) out.push({ param: "SaO2", direction: dS > 0 ? "up" : "down", because: T("SaO2 moved the other way to PaO2: pH went from " + fx(B.ph, 2) + " to " + fx(A.ph, 2) + " and shifted the oxygen curve.", "SaO2 PaO2 से उल्टी दिशा में गया: pH " + fx(B.ph, 2) + " से " + fx(A.ph, 2) + " हुआ और oxygen curve खिसकी।"), chain: ["gasExchange", "abg"] });
    }
    // pH: from the actual signed changes of PaCO2 and of the metabolic bicarbonate (A6)
    var dH = abgA.pH - abgB.pH;
    if (Math.abs(dH) >= 0.02) {
      var dirH = dH > 0 ? "up" : "down", hb = [], mB = metOf(stB), mA = metOf(stA), dM = mA - mB;
      if (Math.abs(dC) >= 1 && (dC > 0) !== (dH > 0)) hb.push(T("PaCO2 " + (dC > 0 ? "rose" : "fell") + " from " + abgB.PaCO2 + " to " + abgA.PaCO2 + ", so pH " + (dH > 0 ? "rose" : "fell") + " (Henderson-Hasselbalch).", "PaCO2 " + abgB.PaCO2 + " से " + abgA.PaCO2 + " हुआ, इसलिए pH " + (dH > 0 ? "बढ़ा" : "घटा") + " (Henderson-Hasselbalch)।"));
      if (Math.abs(dM) >= 1 && (dM > 0) === (dH > 0)) hb.push(T("Metabolic bicarbonate went from " + fx(mB, 1) + " to " + fx(mA, 1) + (dM < 0 && stA.lac > stB.lac + 0.5 ? " as lactate rose." : "."), "Metabolic bicarbonate " + fx(mB, 1) + " से " + fx(mA, 1) + " हुआ" + (dM < 0 && stA.lac > stB.lac + 0.5 ? ", क्योंकि lactate बढ़ा।" : "।")));
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
  /* Projection rows: now, in 30 min without the change, in 30 min with it (A7, E4). */
  var ROWS = [
    ["spo2", "vitals", T("SpO2", "SpO2"), "%", 1], ["pao2", "gas", T("PaO2", "PaO2"), "mmHg", 5], ["paco2", "gas", T("PaCO2", "PaCO2"), "mmHg", 2],
    ["ph", "gas", T("pH", "pH"), "", 0.02], ["map", "vitals", T("Mean BP", "औसत BP"), "mmHg", 3], ["hr", "vitals", T("Heart rate", "Heart rate (धड़कन)"), "/min", 5],
    ["pplat", "vent", T("Plateau", "Plateau दबाव"), "cmH2O", 1.5], ["drivingP", "vent", T("Driving pressure", "Driving pressure (खिंचाव का दबाव)"), "cmH2O", 1.5],
    ["autoPeep", "vent", T("Auto-PEEP", "फँसी हवा का दबाव (auto-PEEP)"), "cmH2O", 1]
  ];
  function rowsOf(now, wo, w) {
    var out = [], i;
    for (i = 0; i < ROWS.length; i++) { var R = ROWS[i], g = R[1], k = R[0]; out.push({ key: k, label: R[2], unit: R[3], now: now[g][k], without: wo[g][k], withChange: w[g][k], diff: r2(w[g][k] - wo[g][k]), matters: Math.abs(w[g][k] - wo[g][k]) >= R[4] }); }
    return out;
  }
  /* One line per row that really moves, written from the signed numbers so it can never contradict them (A6, P8). */
  function verdictOf(rows, state, key) {
    var en = [], hi = [], i, n = 0;
    for (i = 0; i < rows.length && n < 3; i++) {
      var r = rows[i];
      if (!r.matters) continue;
      n++;
      var up = r.withChange > r.without;
      en.push(r.label.en + " " + (up ? "higher" : "lower") + ": " + r.withChange + " instead of " + r.without + ".");
      hi.push(r.label.hi + " " + (up ? "ज़्यादा" : "कम") + ": " + r.without + " की जगह " + r.withChange + "।");
    }
    if (!n) {
      var p = state.p, healthy = p.shunt0 * p.recr < 0.05 && p.shunt0 <= 0.1;
      if ((key === "peep" || key === "epap") && healthy) return T("Healthy lungs: little to gain from PEEP. The numbers barely move.", "स्वस्थ फेफड़े: PEEP से ज़्यादा फ़ायदा नहीं। संख्याएँ लगभग नहीं बदलतीं।");
      return T("This change makes little difference for this patient in 30 minutes.", "इस मरीज़ में 30 मिनट में इस बदलाव से ख़ास फ़र्क नहीं पड़ता।");
    }
    return T(en.join(" "), hi.join(" "));
  }
  function freeze(state) { var f = clone(state), i; for (i = 0; i < f.timeline.length; i++) if (f.fired.indexOf(i) < 0) f.fired.push(i); return f; }
  function whatIf(state, settings, change) {
    var st = norm(settings || state.settings), s2 = clone(st);
    if (change.key != null) s2[change.key] = change.to;
    if (change.mode) s2.mode = change.mode;
    if (change.also) for (var k in change.also) if (own(change.also, k)) s2[k] = change.also[k]; // combined change
    s2 = norm(s2);
    var frozen = freeze(state); // isolate the change from scripted events
    frozen.settings = st;
    var wo = step(frozen, st, 1800), w = step(frozen, s2, 1800);
    var now = readout(state, st), rWo = readout(wo, st), rW = readout(w, s2), rows = rowsOf(now, rWo, rW);
    return {
      before: now, after: rW, now: now, without: rWo, withChange: rW, minutes: 30, rows: rows,
      because: explainDelta(abg(wo), abg(w), st, s2, wo, w), verdict: verdictOf(rows, state, change.key),
      columns: { now: T("Now", "अभी"), without: T("In 30 min without the change", "30 मिनट में, बदलाव के बिना"), withChange: T("In 30 min with the change", "30 मिनट में, बदलाव के साथ") },
      chain: (WHATIF_CHAIN[change.key] || CHAIN_STEPS).slice()
    };
  }

  /* whyDrift(stateBefore, stateAfter): why the patient changed when the learner did not touch the settings (A17). */
  function whyDrift(a, b) {
    var A = model(a, a.settings), B = model(b, b.settings), out = [], i;
    function add(param, up, en, hi) { out.push({ param: param, direction: up ? "up" : "down", because: T(en, hi) }); }
    for (i = 0; i < (b.evlog || []).length; i++) {
      var e = b.evlog[i];
      if (e.t > a.t && e.t <= b.t && e.label) out.push({ param: e.kind, direction: "event", id: e.id, because: e.detail ? T(e.label.en + ". " + e.detail.en, e.label.hi + "। " + e.detail.hi) : e.label });
    }
    var cA = collapsed(a), cB = collapsed(b);
    if (cB > cA + 0.01) add("shunt", true, "Part of the lung is collapsing at this pressure. Shunt went from " + fx(A.shunt * 100) + "% to " + fx(B.shunt * 100) + "%.", "इस दबाव पर फेफड़े का हिस्सा सिकुड़ रहा है। Shunt " + fx(A.shunt * 100) + "% से " + fx(B.shunt * 100) + "% हुआ।");
    else if (cB < cA - 0.01) add("shunt", false, "Collapsed lung is reopening at this pressure. Shunt went from " + fx(A.shunt * 100) + "% to " + fx(B.shunt * 100) + "%.", "इस दबाव पर सिकुड़ा फेफड़ा खुल रहा है। Shunt " + fx(A.shunt * 100) + "% से " + fx(B.shunt * 100) + "% हुआ।");
    if (Math.abs(B.vdvt - A.vdvt) >= 0.03) {
      var why = B.mech.trapDyn > A.mech.trapDyn + 20 ? ["Trapped air is squeezing lung capillaries.", "फँसी हवा फेफड़े की capillaries दबा रही है।"] : B.cof < A.cof - 0.03 ? ["Lower cardiac output sends less blood through the lung.", "कम cardiac output से फेफड़े में कम ख़ून जाता है।"] : ["Lung stretch and blood flow changed.", "फेफड़े का खिंचाव और ख़ून का बहाव बदला।"];
      add("deadSpace", B.vdvt > A.vdvt, "Dead space went from " + fx(A.vdvt * 100) + "% to " + fx(B.vdvt * 100) + "% of each breath. " + why[0], "Dead space हर साँस के " + fx(A.vdvt * 100) + "% से " + fx(B.vdvt * 100) + "% हुआ। " + why[1]);
    }
    var dC = b.paco2 - a.paco2;
    if (Math.abs(dC) >= 2) {
      var pss = B.va > 0.05 ? 0.863 * B.vco2 / B.va : null;
      if (Math.abs(B.va - A.va) < 0.03 * A.va && pss) add("PaCO2", dC > 0, "PaCO2 is still settling toward about " + fx(pss) + " at these settings. Body CO2 stores take 10 to 30 minutes.", "इन settings पर PaCO2 अभी लगभग " + fx(pss) + " की ओर जा रहा है। शरीर के CO2 stores को 10 से 30 मिनट लगते हैं।");
      else add("PaCO2", dC > 0, "Alveolar ventilation went from " + fx(A.va, 1) + " to " + fx(B.va, 1) + " L/min, so PaCO2 went from " + fx(a.paco2) + " to " + fx(b.paco2) + ".", "Alveolar ventilation " + fx(A.va, 1) + " से " + fx(B.va, 1) + " L/min हुआ, इसलिए PaCO2 " + fx(a.paco2) + " से " + fx(b.paco2) + " हुआ।");
      if (B.vco2 > A.vco2 * 1.03) add("VCO2", true, "CO2 production went from " + fx(A.vco2) + " to " + fx(B.vco2) + " mL/min.", "CO2 production " + fx(A.vco2) + " से " + fx(B.vco2) + " mL/min हुआ।");
    }
    if (Math.abs(B.map - A.map) >= 3) {
      var mw = Math.abs(B.mech.pitp - A.mech.pitp) >= 1 ? ["Pressure inside the chest went from " + fx(A.mech.pitp, 1) + " to " + fx(B.mech.pitp, 1) + " cmH2O.", "छाती के अंदर दबाव " + fx(A.mech.pitp, 1) + " से " + fx(B.mech.pitp, 1) + " cmH2O हुआ।"]
        : B.ph < 7.2 || A.ph < 7.2 ? ["pH went from " + fx(A.ph, 2) + " to " + fx(B.ph, 2) + ". Severe acidaemia weakens the heart.", "pH " + fx(A.ph, 2) + " से " + fx(B.ph, 2) + " हुआ। गंभीर acidaemia दिल को कमज़ोर करता है।"]
        : ["Cardiac output went from " + fx(A.co, 1) + " to " + fx(B.co, 1) + " L/min.", "Cardiac output " + fx(A.co, 1) + " से " + fx(B.co, 1) + " L/min हुआ।"];
      add("MAP", B.map > A.map, "Mean BP went from " + fx(A.map) + " to " + fx(B.map) + ". " + mw[0], "औसत BP " + fx(A.map) + " से " + fx(B.map) + " हुआ। " + mw[1]);
    }
    if (Math.abs(B.pao2 - A.pao2) >= 5 && Math.abs(B.shunt - A.shunt) < 0.01 && Math.abs(b.pao2A - a.pao2A) >= 5)
      add("PaO2", B.pao2 > A.pao2, "Oxygen in the lungs is still settling after the last change. PaO2 went from " + fx(A.pao2) + " to " + fx(B.pao2) + ".", "पिछले बदलाव के बाद फेफड़ों में oxygen अभी स्थिर हो रही है। PaO2 " + fx(A.pao2) + " से " + fx(B.pao2) + " हुआ।");
    if (b.lac - a.lac >= 0.5) add("lactate", true, "Lactate went from " + fx(a.lac, 1) + " to " + fx(b.lac, 1) + ": tissues are short of oxygen.", "Lactate " + fx(a.lac, 1) + " से " + fx(b.lac, 1) + " हुआ: tissues को oxygen कम मिल रही है।");
    if (Math.abs(metOf(b) - metOf(a)) >= 1) add("HCO3", metOf(b) > metOf(a), "Metabolic bicarbonate went from " + fx(metOf(a), 1) + " to " + fx(metOf(b), 1) + ".", "Metabolic bicarbonate " + fx(metOf(a), 1) + " से " + fx(metOf(b), 1) + " हुआ।");
    return out;
  }

  /* caseState(scenario, setup): the state an ABG case describes, built from its learn.json setup
     {patch (scenario overrides), settings, pre (seconds at those settings), atInit (settle at those settings)} (E3). */
  function merge(a, b) { for (var k in b) if (own(b, k)) { if (b[k] && typeof b[k] === "object" && Object.prototype.toString.call(b[k]) !== "[object Array]" && a[k] && typeof a[k] === "object") merge(a[k], b[k]); else a[k] = clone(b[k]); } return a; }
  function caseState(scenario, setup) {
    setup = setup || {};
    var sc = merge(clone(scenario || {}), setup.patch || {});
    sc.timeline = [];
    var s = init(sc, setup.atInit ? setup.settings : null), st = norm(merge(clone(s.settings), setup.settings || {}));
    if (setup.pre) s = step(s, st, setup.pre);
    s.changes = []; s.settings = st;
    return { state: s, settings: st };
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
        var xd = e.expDur || 0.5, x0 = e.start + e.tin + (e.expDelay || 0);
        if (e.expAmp && t >= x0 && t < x0 + xd) pm += e.expAmp * Math.sin(Math.PI * (t - x0) / xd);
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
        if (active.plim && paw >= active.plim) { paw = active.plim; q = Math.max(0, (paw - palv) / R); ends[active._i] = t + dt; } // pressure-limited cycling
      } else if (active) {
        var pset = peep + active.p * Math.min(1, (t - active.start) / (active.rise || 0.1));
        // controller lag: an expiratory push against the closed exhalation valve lifts Paw above the set level
        paw = pset + (pm > 0 && active.type === "ps" ? LAG * pm : 0);
        q = (paw - palv) / R;
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
        if (c && c.k === "vc") b = { type: "vc", vt: c.vt, ti: c.sol.limited ? c.ti : c.sol.ti, flowPattern: st.flowPattern, plim: c.plim };
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
    doubleTrigger: T("Double trigger", "दोहरा trigger (double trigger)"), ineffectiveTrigger: T("Ineffective trigger", "बेअसर trigger (ineffective trigger)"),
    autoTrigger: T("Auto-trigger", "अपने आप trigger (auto-trigger)"), flowStarvation: T("Flow starvation", "Flow की कमी (flow starvation)"),
    prematureCycle: T("Premature cycling", "जल्दी cycle होना (premature cycling)"), delayedCycle: T("Delayed cycling", "देर से cycle होना (delayed cycling)"),
    reverseTrigger: T("Reverse triggering", "उल्टा trigger (reverse triggering)")
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
        // long time constant (R 25, C 60) and a 5% cycle: the breath outlasts the neural Ti of 0.7 s; the patient then
        // pushes to exhale while the valve is still in inspiration, so Paw spikes above the set level before cycling
        C = 60; R = 25; Re = 40;
        vent.push({ type: "ps", p: st.ps || 14, ti: 3, cycle: 5, start: t0 + 0.1, triggered: true });
        ef.push({ start: t0, tin: 0.7, amp: 8, expAmp: 10, expDur: 1.4, expDelay: 0.3 }); ev.push({ t: t0 + 1.2, id: kind });
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
  /* Score part maxima (initial is 4 + 3 + 3 points; unsafe is a penalty down to unsafeMin). The UI reads these. */
  var SPONT = ["psv", "cpap", "niv"];
  var HARMFUL = { secretions: 1, bronchospasm: 1, pneumothorax: 1, plug: 1, disconnect: 1, cuffLeak: 1, o2Failure: 1, hypotension: 1, hypovolaemia: 1, fever: 1, fatigue: 1, sedationLight: 1, sedationDeep: 1 };
  var SCORE_MAX = { mode: 10, initial: 10, oxygenation: 15, ventilation: 15, protection: 20, alarms: 10, abg: 10, time: 10, unsafeMin: -30 };
  var GRACE = 600, ARREST_CAP = 20;
  /* ARDSNet 2000 PEEP/FiO2 tables: lower PEEP table minimum and higher PEEP table maximum for this FiO2. */
  function peepTableOk(fio2, peep) {
    var f = fio2 / 100;
    var lo = f <= 0.4 ? 5 : f <= 0.5 ? 8 : f <= 0.7 ? 10 : f <= 0.9 ? 14 : 18;
    var hi = f <= 0.3 ? 14 : f <= 0.4 ? 16 : f <= 0.5 ? 20 : f < 0.9 ? 22 : 24;
    return peep >= lo - 2 && peep <= hi + 2;
  }
  function tmin(t) { return Math.round(t / 60); }
  /* SCORE (round 2: E1, E2, E3, E8).
     Time on target is weighted by sim time (trapezoid between log samples), so a +30 min skip counts as 30 minutes,
     not as one sample. Oxygenation, ventilation and protection are half time on target after the first 10 minutes and
     half the end state, so a run that ends with every goal met scores well even when the fix came late.
     Unsafe moments count only strictly after the first 10 minutes and outside scripted response windows. A VT above
     10 mL/kg counts only when the learner set the breath (mode, VT or a pressure changed from the start): the start VT
     is the presenting problem and is scored under lung protection and named in the notes. The penalty is 5 per episode
     plus 5 per further 10 min the episode lasts, down to unsafeMin (it was 5 per log sample, so one episode of minute
     samples reached -30).
     Goals met together: the first time, whether they still held at the end, and the end misses by name (goals field).
     run.tutorial marks a practice run: practice true and countsForBest false, so the hub does not count it. */
  function score(run) {
    run = run || {};
    var sc = run.scenario || {}, g = run.goals || sc.goals || {}, pt = sc.patient || {}, log = run.log || [], notes = [];
    var spo2R = g.spo2 || [92, 98], pplatMax = g.pplatMax || 30, drvMax = g.drivingMax || 15, vtR = g.vtPerKg || [4, 8];
    var kg = pt.heightCm ? pbw(pt) : null, n = log.length, i, j;
    var wsum = 0, oxW = 0, vW = 0, prW = 0, lowSpW = 0, hiFiO2 = 0, backup = 0, ineff = 0, tFirst = null, unsafeList = [], hemo = null, hemoN = 0;
    var seen = { pplat: false, drv: false, vt: false }, arrest = null, last = n ? log[n - 1].readout : null, end = null, presetS = 0, presetVk = 0;
    var start = n ? log[0].settings || {} : {};
    // windows after scripted harmful events: the learner gets 5 minutes (plus the event's duration) to respond
    var tl = sc.timeline || [], win = [];
    for (i = 0; i < tl.length; i++) if (HARMFUL[tl[i].event]) win.push([tl[i].t, tl[i].t + (tl[i].duration || 0) + 300]);
    function scripted(t) { for (var w = 0; w < win.length; w++) if (t >= win[w][0] && t <= win[w][1]) return true; return false; }
    var useGrace = false;
    for (i = 0; i < n; i++) if (log[i].t > GRACE) useGrace = true;
    function counted(k) { return !useGrace || log[k].t > GRACE; }
    // trapezoid weights in seconds over the counted part of the run; equal weights if the run has no length
    var wt = [], wTot = 0;
    for (i = 0; i < n; i++) {
      var w0 = 0;
      if (counted(i)) {
        var lo = useGrace ? GRACE : -1e12;
        w0 = ((i > 0 ? log[i].t - Math.max(lo, log[i - 1].t) : 0) + (i < n - 1 ? log[i + 1].t - log[i].t : 0)) / 2;
      }
      wt.push(Math.max(0, w0)); wTot += Math.max(0, w0);
    }
    if (wTot <= 0) for (i = 0; i < n; i++) wt[i] = counted(i) ? 1 : 0;
    var PRESET = ["mode", "vt", "pinsp", "ps", "ipap", "epap", "phigh", "plow"];
    for (i = 0; i < n; i++) {
      var L = log[i], r = L.readout || { vitals: {}, vent: {}, gas: {}, flags: [] }, f = r.flags || [], ls = L.settings || {};
      if (r.arrest && !arrest) arrest = r.arrest;
      for (j = 0; j < f.length; j++) { if (f[j].id === "apnoeaBackup") backup++; if (f[j].id === "ineffective" || f[j].id === "effortsIgnored") ineff++; if (f[j].id === "arrest" && !arrest) arrest = { t: L.t }; }
      var sp = r.vitals.spo2, above = sp > spo2R[1];
      // above target on low FiO2 is fine; above target on FiO2 above 50% means wean FiO2 (P7, E10)
      var o = inR(sp, spo2R) || (above && !(ls.fio2 > 50));
      var v = g.ph ? inR(r.gas.ph, g.ph) : inR(r.gas.paco2, g.paco2 || [35, 45]);
      // VT per kg is scored only when the ventilator sets the volume or pressure; a spontaneous mode's VT is the patient's
      var spont = SPONT.indexOf(ls.mode) >= 0, vk = kg && !spont ? r.vent.vte / kg : null;
      var pr = (spont || r.vent.pplat <= pplatMax) && (spont || r.vent.drivingP <= drvMax) && (vk === null || inR(vk, [vtR[0] - 0.5, vtR[1] + 0.5]));
      // haemodynamic harm from the learner's own settings: hypotension with PEEP raised above the start, or with trapping
      // after the learner raised rate, VT or Ti (Raju 3)
      var mine = ls.peep >= 10 && ls.peep > (start.peep || 5) + 2 ? "peep" : r.vent.autoPeep >= 5 && (ls.rr > start.rr || ls.vt > start.vt || ls.ti > start.ti) ? "trap" : null;
      var harm = r.vitals.map < 65 && !!mine;
      if (harm && L.t > GRACE) { hemoN++; if (!hemo) hemo = { t: L.t, map: r.vitals.map, kind: mine, peep: ls.peep, from: start.peep }; }
      var learnerBreath = false;
      for (j = 0; j < PRESET.length; j++) if (ls[PRESET[j]] !== start[PRESET[j]]) learnerBreath = true;
      var w = wt[i];
      if (counted(i)) {
        wsum += w;
        if (o) oxW += w; if (v) vW += w; if (pr && !harm) prW += w;
        if (above && ls.fio2 > 50) hiFiO2++;
        if (sp < spo2R[0]) lowSpW += w;
        if (!spont && r.vent.pplat > pplatMax) seen.pplat = true;
        if (!spont && r.vent.drivingP > drvMax) seen.drv = true;
        if (vk !== null && !inR(vk, [vtR[0] - 0.5, vtR[1] + 0.5])) seen.vt = true;
        if (vk !== null && vk > vtR[1] + 0.5 && !learnerBreath) { presetS += w; presetVk = Math.max(presetVk, vk); }
      }
      var all = o && v && pr;
      if (all && tFirst === null) tFirst = L.t;
      end = { all: all, o: o, v: v, pr: pr && !harm, harm: harm, sp: sp, fio2: ls.fio2, r: r, vk: vk, spont: spont, above: above };
      // unsafe moments: strictly after the arrival grace window (first 10 sim-min) and outside a scripted event's
      // response window (E2); a large VT only when the learner set the breath (E1)
      if (L.t > GRACE && !scripted(L.t)) {
        var why = r.vent.pplat > 35 ? T("plateau " + fx(r.vent.pplat) + " cmH2O", "plateau " + fx(r.vent.pplat) + " cmH2O") : sp < 85 ? T("SpO2 " + sp + "%", "SpO2 " + sp + "%")
          : vk !== null && vk > 10 && learnerBreath ? T("VT " + fx(vk, 1) + " mL/kg", "VT " + fx(vk, 1) + " mL/kg") : r.vent.autoPeep >= 10 && r.vitals.map < 65 ? T("auto-PEEP " + fx(r.vent.autoPeep) + " with MAP " + r.vitals.map, "auto-PEEP " + fx(r.vent.autoPeep) + " के साथ MAP " + r.vitals.map) : null;
        if (why) {
          var prev = unsafeList[unsafeList.length - 1];
          if (!prev || prev.what.en.split(" ")[0] !== why.en.split(" ")[0] || L.t - prev.until > 600) unsafeList.push({ t: L.t, until: L.t, minute: tmin(L.t), what: why });
          else prev.until = L.t;
        }
      }
    }
    var fr = function (x) { return wsum > 0 ? x / wsum : 0; };
    var endAll = !!(end && end.all && end.pr);
    var ans = run.answers || [];
    function ansFrac(kind) { var c = 0, t = 0, k; for (k = 0; k < ans.length; k++) if (ans[k] && ans[k].kind === kind) { t++; if (ans[k].correct) c++; } return t ? { f: c / t, c: c, t: t } : null; }
    function did(re) { for (var k = 0; k < n; k++) if (re.test(String(log[k].action || ""))) return log[k]; return null; }
    var X = SCORE_MAX, parts = {}, scored = {}, ex = {};
    // mode: only if the learner chose or confirmed one (A16)
    var modeAct = did(/^(set:.*\bmode\b|confirm)/);
    if (modeAct) { parts.mode = Math.round(X.mode * (1 - (n ? backup / n : 0)) * (1 - 0.5 * (n ? ineff / n : 0))); ex.mode = T("You chose " + String(modeAct.settings && modeAct.settings.mode || "").toUpperCase() + ". Points fall with apnoea backup or missed efforts.", "आपने " + String(modeAct.settings && modeAct.settings.mode || "").toUpperCase() + " चुना। Apnoea backup या छूटे efforts से अंक घटते हैं।"); }
    else ex.mode = T("You kept the start mode, so mode choice was not scored.", "आपने शुरू का mode रखा, इसलिए mode के अंक नहीं गिने गए।");
    // first settings: judged on the settings themselves, not on the arrival state (E2)
    var firstSet = did(/^(set:|confirm)/);
    if (firstSet) {
      var fs = firstSet.settings || {}, pts = 0, avail = 0, r30 = null;
      if (sc.patient) { var q = clone(sc); q.timeline = []; var s0 = init(q, start); if (firstSet.t > 0) s0 = step(s0, start, firstSet.t); r30 = readout(step(s0, fs, 1800), fs); }
      var fsp = SPONT.indexOf(fs.mode) >= 0 || fs.mode === "aprv";
      if (!fsp && kg) { avail += 4; var vkk = (["vc", "acvc", "simv", "prvc"].indexOf(fs.mode) >= 0 ? fs.vt : r30 ? r30.vent.vte : 0) / kg; if (inR(vkk, vtR)) pts += 4; }
      if (r30) { avail += 3; if (r30.vent.pplat <= pplatMax) pts += 3; }
      avail += 3;
      if (g.peepTable === "ardsnet") { if (peepTableOk(fs.fio2, fs.peep)) pts += 3; }
      else if (r30 ? r30.vitals.spo2 >= spo2R[0] - 2 && !(r30.vitals.spo2 > spo2R[1] && fs.fio2 > 50) : true) pts += 3;
      parts.initial = Math.round(X.initial * pts / avail);
      ex.initial = T("Your first settings were judged on VT per kg, plateau 30 min later" + (g.peepTable === "ardsnet" ? " and the PEEP/FiO2 table." : " and oxygen 30 min later."), "आपकी पहली settings VT per kg, 30 मिनट बाद के plateau" + (g.peepTable === "ardsnet" ? " और PEEP/FiO2 table पर परखी गईं।" : " और 30 मिनट बाद की oxygen पर परखी गईं।"));
    } else ex.initial = T("You did not change the start settings, so first settings were not scored.", "आपने शुरू की settings नहीं बदलीं, इसलिए पहली settings के अंक नहीं गिने गए।");
    var pct = function (x) { return fx(fr(x) * 100); };
    // half time on target, half the end state (E3)
    var blend = function (x, ok) { return 0.5 * fr(x) + (ok ? 0.5 : 0); };
    var endTxt = function (ok) { return ok ? T(" At the end it was on target.", " अंत में यह लक्ष्य पर था।") : T(" At the end it was off target.", " अंत में यह लक्ष्य से बाहर था।"); };
    var eo = end ? end.o : false, ev = end ? end.v : false, ep = end ? end.pr : false;
    parts.oxygenation = Math.round(X.oxygenation * blend(oxW, eo));
    var et = endTxt(eo);
    ex.oxygenation = T("SpO2 was on target " + pct(oxW) + "% of the time after the first 10 minutes." + et.en + (hiFiO2 ? " It was above target on FiO2 above 50%: wean FiO2." : ""), "पहले 10 मिनट के बाद SpO2 " + pct(oxW) + "% समय लक्ष्य पर रहा।" + et.hi + (hiFiO2 ? " FiO2 50% से ऊपर पर यह लक्ष्य से ऊपर था: FiO2 घटाएँ।" : ""));
    parts.ventilation = Math.round(X.ventilation * blend(vW, ev));
    et = endTxt(ev);
    ex.ventilation = T((g.ph ? "pH" : "PaCO2") + " was on target " + pct(vW) + "% of the time after the first 10 minutes." + et.en, "पहले 10 मिनट के बाद " + (g.ph ? "pH" : "PaCO2") + " " + pct(vW) + "% समय लक्ष्य पर रहा।" + et.hi);
    parts.protection = Math.round(X.protection * blend(prW, ep));
    et = endTxt(ep);
    ex.protection = T("Plateau, driving pressure and VT were protective " + pct(prW) + "% of the time" + (hemoN ? ", minus time your settings dropped BP." : ".") + et.en, "Plateau, driving pressure और VT " + pct(prW) + "% समय सुरक्षित रहे" + (hemoN ? ", उस समय को छोड़कर जब आपकी settings से BP गिरा।" : "।") + et.hi);
    var aa = ansFrac("alarm"), missed = [], mk = {};
    for (i = 0; i < ans.length; i++) if (ans[i] && ans[i].kind === "alarm" && !ans[i].correct && ans[i].id && !mk[ans[i].id]) { mk[ans[i].id] = 1; missed.push({ id: ans[i].id, label: ALARM[ans[i].id] || T(ans[i].id, ans[i].id) }); }
    var missEn = missed.map(function (x) { return x.label.en; }).join(", "), missHi = missed.map(function (x) { return x.label.hi; }).join(", ");
    if (arrest) { parts.alarms = 0; ex.alarms = T("The patient arrested, so alarm response scores 0.", "मरीज़ का arrest हुआ, इसलिए alarm response को 0 मिला।"); }
    else if (aa) { parts.alarms = Math.round(X.alarms * aa.f); ex.alarms = T("You responded to " + aa.c + " of " + aa.t + " alarms in time." + (missed.length ? " Not answered within 5 minutes: " + missEn + "." : ""), "आपने " + aa.t + " में से " + aa.c + " alarms का समय पर जवाब दिया।" + (missed.length ? " 5 मिनट में जवाब नहीं दिया: " + missHi + "।" : "")); }
    else ex.alarms = T("No alarm needed your response: none cleared after something you did, and none stayed unanswered for 5 minutes. Alarm response was not scored.", "किसी alarm को आपके जवाब की ज़रूरत नहीं पड़ी: न कोई आपके किए से हटा, न कोई 5 मिनट बिना जवाब रहा। Alarm response के अंक नहीं गिने गए।");
    var ab = ansFrac("abg"), drew = did(/^abg/);
    if (ab || drew) {
      var onT = last && (g.ph ? inR(last.gas.ph, g.ph) : inR(last.gas.paco2, g.paco2 || [35, 45]));
      parts.abg = Math.round(X.abg * (ab ? ab.f : onT ? 1 : 0));
      ex.abg = ab ? T(ab.c + " of " + ab.t + " gases were drawn at a useful time, 15 min or more after a change.", ab.t + " में से " + ab.c + " gases सही समय पर, बदलाव के 15 मिनट या बाद में ली गईं।") : T("You drew a gas. The last gas " + (onT ? "met" : "missed") + " the target.", "आपने gas ली। आख़िरी gas लक्ष्य " + (onT ? "पर थी।" : "से बाहर थी।"));
    } else ex.abg = T("You did not draw a blood gas, so this was not scored.", "आपने blood gas नहीं ली, इसलिए इसके अंक नहीं गिने गए।");
    // goals met together (E2): the first time, and the end state named honestly
    var miss = [], mEn = [], mHi = [];
    if (end) {
      var er = end.r, gv = er.gas || {}, ve = er.vent || {};
      if (!end.o) {
        if (end.above) { miss.push({ key: "spo2", value: end.sp }); mEn.push("SpO2 " + end.sp + "% on FiO2 " + end.fio2 + "% (wean FiO2)"); mHi.push("FiO2 " + end.fio2 + "% पर SpO2 " + end.sp + "% (FiO2 घटाएँ)"); }
        else { miss.push({ key: "spo2", value: end.sp }); mEn.push("SpO2 " + end.sp + "% (goal " + spo2R[0] + " to " + spo2R[1] + ")"); mHi.push("SpO2 " + end.sp + "% (लक्ष्य " + spo2R[0] + " से " + spo2R[1] + ")"); }
      }
      if (!end.v) {
        if (g.ph) { miss.push({ key: "ph", value: gv.ph }); mEn.push("pH " + gv.ph + " (goal " + g.ph[0] + " to " + g.ph[1] + ")"); mHi.push("pH " + gv.ph + " (लक्ष्य " + g.ph[0] + " से " + g.ph[1] + ")"); }
        else { var pc_ = g.paco2 || [35, 45]; miss.push({ key: "paco2", value: gv.paco2 }); mEn.push("PaCO2 " + gv.paco2 + " (goal " + pc_[0] + " to " + pc_[1] + ")"); mHi.push("PaCO2 " + gv.paco2 + " (लक्ष्य " + pc_[0] + " से " + pc_[1] + ")"); }
      }
      if (!end.spont && ve.pplat > pplatMax) { miss.push({ key: "pplat", value: ve.pplat }); mEn.push("plateau " + fx(ve.pplat) + " (" + pplatMax + " or less)"); mHi.push("plateau " + fx(ve.pplat) + " (" + pplatMax + " या कम)"); }
      if (!end.spont && ve.drivingP > drvMax) { miss.push({ key: "drivingP", value: ve.drivingP }); mEn.push("driving pressure " + fx(ve.drivingP) + " (" + drvMax + " or less)"); mHi.push("driving pressure " + fx(ve.drivingP) + " (" + drvMax + " या कम)"); }
      if (end.vk !== null && !inR(end.vk, [vtR[0] - 0.5, vtR[1] + 0.5])) { miss.push({ key: "vt", value: r1(end.vk) }); mEn.push("VT " + fx(end.vk, 1) + " mL/kg (" + vtR[0] + " to " + vtR[1] + ")"); mHi.push("VT " + fx(end.vk, 1) + " mL/kg (" + vtR[0] + " से " + vtR[1] + ")"); }
      if (end.harm) { miss.push({ key: "map", value: (er.vitals || {}).map }); mEn.push("mean BP " + (er.vitals || {}).map + " from your settings"); mHi.push("आपकी settings से औसत BP " + (er.vitals || {}).map); }
    }
    var speed = function (t) { return clamp(1 - (t - 900) / 2700, 0, 1); };
    parts.time = Math.round(X.time * (endAll ? Math.max(0.3, speed(tFirst)) : tFirst !== null ? 0.5 * speed(tFirst) : 0));
    var missT = T(mEn.join(", "), mHi.join(", "));
    ex.time = endAll ? T("All goals were first met together at " + tmin(tFirst) + " min and still held at the end.", "सभी लक्ष्य पहली बार " + tmin(tFirst) + " मिनट पर एक साथ पूरे हुए और अंत तक बने रहे।")
      : tFirst !== null ? T("All goals were met together at " + tmin(tFirst) + " min, but not at the end: " + missT.en + ".", "सभी लक्ष्य " + tmin(tFirst) + " मिनट पर एक साथ पूरे हुए, पर अंत में नहीं: " + missT.hi + "।")
      : T("All goals were never met at the same time." + (mEn.length ? " At the end: " + missT.en + "." : ""), "सभी लक्ष्य कभी एक साथ पूरे नहीं हुए।" + (mHi.length ? " अंत में: " + missT.hi + "।" : ""));
    var pen = 0;
    for (i = 0; i < unsafeList.length; i++) pen += 5 + 5 * Math.floor((unsafeList[i].until - unsafeList[i].t) / 600);
    parts.unsafe = pen ? Math.max(X.unsafeMin, -pen) : 0;
    ex.unsafe = unsafeList.length ? T(unsafeList.length + " unsafe " + (unsafeList.length === 1 ? "moment" : "moments") + " after the first 10 minutes, listed with their times.", "पहले 10 मिनट के बाद " + unsafeList.length + " असुरक्षित पल, समय के साथ सूची में।") : T("No unsafe moments after the first 10 minutes.", "पहले 10 मिनट के बाद कोई असुरक्षित पल नहीं।");
    var earned = 0, maxA = 0, k;
    for (k in X) if (own(X, k) && k !== "unsafeMin") { scored[k] = own(parts, k); if (scored[k]) { earned += parts[k]; maxA += X[k]; } else parts[k] = null; }
    scored.unsafe = true;
    var total = maxA ? Math.round(100 * earned / maxA) + parts.unsafe : 0;
    if (hemo) notes.push(hemo.kind === "peep" ? T("Key lesson: your PEEP " + hemo.peep + " dropped mean BP to " + hemo.map + ". High chest pressure lets less blood return to the heart.", "मुख्य सीख: आपके PEEP " + hemo.peep + " से औसत BP " + hemo.map + " तक गिरा। छाती में ऊँचा दबाव दिल तक कम ख़ून लौटने देता है।")
      : T("Key lesson: your faster or bigger breaths trapped air and dropped mean BP to " + hemo.map + ".", "मुख्य सीख: आपकी तेज़ या बड़ी साँसों ने हवा फँसाई और औसत BP " + hemo.map + " तक गिरा।"));
    if (presetS >= 300) notes.push(T("The start VT was " + fx(presetVk, 1) + " mL/kg predicted body weight and stayed for " + fx(presetS / 60) + " min. Size VT to height in the first minutes: " + vtR[0] + " to " + vtR[1] + " mL/kg.", "शुरू का VT " + fx(presetVk, 1) + " mL/kg predicted body weight था और " + fx(presetS / 60) + " मिनट रहा। पहले मिनटों में VT लंबाई के हिसाब से रखें: " + vtR[0] + " से " + vtR[1] + " mL/kg।"));
    if (seen.pplat) notes.push(T("Keep plateau at or below " + pplatMax + " cmH2O.", "Plateau " + pplatMax + " cmH2O या कम रखें।"));
    if (seen.drv) notes.push(T("Keep driving pressure at or below " + drvMax + ". Driving pressure is plateau minus PEEP.", "Driving pressure " + drvMax + " या कम रखें। Driving pressure यानी plateau minus PEEP।"));
    if (seen.vt) notes.push(T("Keep VT at " + vtR[0] + " to " + vtR[1] + " mL/kg predicted body weight.", "VT predicted body weight के " + vtR[0] + " से " + vtR[1] + " mL/kg रखें।"));
    if (fr(lowSpW) > 0.2) notes.push(T("SpO2 was below the target range for long periods.", "SpO2 लंबे समय तक target range से नीचे रहा।"));
    if (hiFiO2) notes.push(T("SpO2 was above target on FiO2 above 50%: wean FiO2.", "FiO2 50% से ऊपर पर SpO2 लक्ष्य से ऊपर था: FiO2 घटाएँ।"));
    if (fr(vW) < 0.8 && wsum > 0) notes.push(T("Ventilation goal was not met for much of the run.", "Run के बड़े हिस्से में ventilation लक्ष्य पूरा नहीं हुआ।"));
    if (backup) notes.push(T("The patient needed apnoea backup: the mode did not match the drive to breathe.", "मरीज़ को apnoea backup चाहिए था: mode साँस की drive से मेल नहीं खाता था।"));
    if (unsafeList.length) notes.push(T("Unsafe moments: very high plateau, severe hypoxaemia, a large VT you set, or trapping with hypotension.", "असुरक्षित पल: बहुत ऊँचा plateau, गंभीर hypoxaemia, आपका रखा बड़ा VT, या trapping के साथ hypotension।"));
    if (arrest) { total = Math.min(total, ARREST_CAP); notes.unshift(T("The patient had a cardiac arrest at " + tmin(arrest.t) + " min. The score is capped at " + ARREST_CAP + ".", "मरीज़ का " + tmin(arrest.t) + " मिनट पर cardiac arrest हुआ। Score " + ARREST_CAP + " पर सीमित है।")); }
    if (!notes.length) notes.push(endAll ? T("Goals met safely. Well done.", "लक्ष्य सुरक्षित रूप से पूरे हुए। बहुत अच्छा।") : T("No safety problems. Keep going until every goal is met together.", "कोई सुरक्षा समस्या नहीं। तब तक जारी रखें जब तक सभी लक्ष्य एक साथ पूरे न हों।"));
    if (run.tutorial) notes.unshift(T("Practice run in a tutorial: it does not count toward your best score.", "Tutorial में अभ्यास run: यह आपके सर्वोत्तम score में नहीं गिना जाता।"));
    for (i = 0; i < unsafeList.length; i++) { unsafeList[i].toMinute = tmin(unsafeList[i].until); delete unsafeList[i].until; }
    return { total: clamp(Math.round(total), 0, 100), parts: parts, scored: scored, max: X, explain: ex, unsafeList: unsafeList, notes: notes, arrest: !!arrest, goodRun: sc.goodRun || null,
      goals: { firstMin: tFirst === null ? null : tmin(tFirst), metAtEnd: endAll, missedAtEnd: miss, missedText: miss.length ? missT : null },
      missedAlarms: missed, practice: !!run.tutorial, countsForBest: !run.tutorial };
  }

  return {
    id: "vent-engine", kind: "sim-engine", review: "ai_drafted", version: 1,
    title: T("Ventilator lab physiology engine", "Ventilator lab का physiology engine"),
    disclaimer: T("Educational simulator. Not a real ventilator and not a guide to treating a real patient.", "शैक्षिक simulator। यह असली ventilator नहीं है और असली मरीज़ के इलाज की guide नहीं है।"),
    sources: SOURCES, MODES: MODES, SETTINGS: SETTINGS, EVENTS: EVENTS, CHAIN_STEPS: CHAIN_STEPS, CHAIN_LABELS: CHAIN_LABELS, DYSSYNC: DYS,
    constants: { kCO2: K_CO2, overdistensionFactor: KOD, neuralTi: TIN, substep: SUB, plateauMax: 30, drivingMax: 15 },
    init: init, step: step, breath: breath, readout: readout, abg: abg, explainDelta: explainDelta, alarms: alarms,
    dyssync: dyssync, whatIf: whatIf, score: score, SCORE_MAX: SCORE_MAX, pbw: pbw, normSettings: norm, ACTIONS: ACTIONS, act: act,
    hold: hold, exam: exam, suggestActions: suggestActions, alarmPlan: alarmPlan, oxygen: { sat: sat, p50: p50Of }, whyDrift: whyDrift, caseState: caseState, inject: inject,
    constants2: { grace: GRACE, arrestSeconds: ARREST_S, arrestScoreCap: ARREST_CAP }
  };
});
