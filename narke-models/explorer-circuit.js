/* Narkē explorer model: the circle system, fresh gas flow and the CO2 absorber. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["circuit"].
   A steady-state teaching model of inspired CO2. Each minute the patient breathes VE litres. Fresh gas supplies FGF
   of it; the rest, max(0, VE - FGF), is exhaled gas sent round the circle again (rebreathed), and the excess leaves
   through the APL valve or the ventilator spill valve. The absorber removes a fraction e of the CO2 in that rebreathed
   gas (1 fresh, 0 exhausted). With k = (rebreathed fraction) x (1 - e), and mixed expired CO2 = inspired +
   863 x VCO2 / VE (alveolar ventilation equation, mmHg, VCO2 in L/min STPD), inspired CO2 at steady state is
   PICO2 = k x 863 x VCO2 / VE / (1 - k). End-tidal CO2 is inspired + 863 x VCO2 / VA, VA = VE x (1 - VD/VT),
   VD/VT 0.3 (West). Flow names follow Baker (1994). It ignores machine dead space, valve leaks and the patient's
   own response to rising CO2, so it shows the direction and rough size, not a bedside number. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var K = 863;            // alveolar ventilation equation constant, mmHg
  var RUNAWAY = 100;     // above this the model says "keeps rising" rather than a number a patient would reach
  var VDVT = 0.3;         // dead space fraction (West: about 0.2 to 0.35 in health)
  var LIMITS = { fgf: [0.25, 10], ve: [3, 15], vco2: [100, 400] };
  var DEFAULTS = { fgf: 1, ve: 6, vco2: 200, absorber: "fresh" };
  var T = function (en, hi) { return { en: en, hi: hi }; };
  var ABSORBER = {
    fresh: { e: 1, name: T("Working absorber", "काम करता absorber") },
    partial: { e: 0.5, name: T("Half used (illustrative)", "आधा इस्तेमाल (उदाहरण)") },
    exhausted: { e: 0, name: T("Exhausted absorber", "ख़त्म absorber") }
  };
  // Baker AB 1994: names of fresh gas flow ranges (L/min), upper bounds.
  var FLOWS = [
    { id: "metabolic", max: 0.25, name: T("Metabolic flow", "Metabolic flow") },
    { id: "minimal", max: 0.5, name: T("Minimal flow", "Minimal flow") },
    { id: "low", max: 1, name: T("Low flow", "Low flow") },
    { id: "medium", max: 2, name: T("Medium flow", "Medium flow") },
    { id: "high", max: 4, name: T("High flow", "High flow") },
    { id: "very-high", max: Infinity, name: T("Very high flow", "Very high flow") }
  ];

  function r1(x) { return Math.round(x * 10) / 10; }
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function inR(v, k) { return typeof v === "number" && v === v && v >= LIMITS[k][0] && v <= LIMITS[k][1]; }

  function flowClass(fgf) { for (var i = 0; i < FLOWS.length; i++) if (fgf <= FLOWS[i].max) return FLOWS[i]; return FLOWS[FLOWS.length - 1]; }

  /* state({fgf L/min, ve L/min, vco2 mL/min, absorber: fresh|partial|exhausted}) */
  function state(s) {
    s = s || {};
    var o = { fgf: s.fgf == null ? DEFAULTS.fgf : s.fgf, ve: s.ve == null ? DEFAULTS.ve : s.ve, vco2: s.vco2 == null ? DEFAULTS.vco2 : s.vco2, absorber: s.absorber || DEFAULTS.absorber };
    if (!inR(o.fgf, "fgf")) return bad("Fresh gas flow is 0.25 to 10 L/min.", "Fresh gas flow 0.25 से 10 L/min होता है।");
    if (!inR(o.ve, "ve")) return bad("Minute ventilation is 3 to 15 L/min.", "Minute ventilation 3 से 15 L/min होता है।");
    if (!inR(o.vco2, "vco2")) return bad("CO2 production is 100 to 400 mL/min.", "CO2 production 100 से 400 mL/min होता है।");
    if (!ABSORBER[o.absorber]) return bad("Absorber is fresh, partial or exhausted.", "Absorber fresh, partial या exhausted होता है।");
    var e = ABSORBER[o.absorber].e, reb = Math.max(0, (o.ve - o.fgf) / o.ve), k = reb * (1 - e);
    var mixedRise = K * (o.vco2 / 1000) / o.ve, alvRise = K * (o.vco2 / 1000) / (o.ve * (1 - VDVT));
    var pi = k >= 1 ? Infinity : k * mixedRise / (1 - k);
    var fc = flowClass(o.fgf);
    var alerts = [];
    if (pi >= 5) alerts.push({ id: "rebreathing", text: T("Inspired CO2 is above zero: the capnogram baseline does not return to zero. Raise fresh gas flow to at least the minute ventilation and change the absorber.", "Inspired CO2 शून्य से ऊपर: capnogram की baseline शून्य पर नहीं लौटती। Fresh gas flow को कम से कम minute ventilation तक बढ़ाएँ और absorber बदलें।") });
    if (o.fgf < 1) alerts.push({ id: "sevo", text: T("With sevoflurane, the US label advises fresh gas of at least 1 L/min (compound A from the absorber).", "Sevoflurane के साथ US label कम से कम 1 L/min fresh gas की सलाह देता है (absorber से compound A)।") });
    return {
      ok: true, settings: o, rebreathedFraction: Math.round(reb * 1000) / 1000, removed: e,
      inspiredCO2: pi === Infinity ? null : r1(pi), endTidalCO2: pi === Infinity ? null : r1(pi + alvRise),
      runaway: pi > RUNAWAY, flowClass: { id: fc.id, name: fc.name }, washout: o.fgf >= o.ve, alerts: alerts
    };
  }

  /* capnogram(st, n): one breath of a stylised capnogram (mmHg) whose baseline is the inspired CO2. */
  function capnogram(st, n) {
    var N = n || 80, base = st.inspiredCO2 || 0, top = st.endTidalCO2 || base, out = [], i, x, y;
    for (i = 0; i <= N; i++) {
      x = i / N;
      if (x < 0.35) y = base;                                         // inspiration
      else if (x < 0.42) y = base + (top * 0.9 - base) * (x - 0.35) / 0.07; // expiratory upstroke
      else if (x < 0.9) y = top * 0.9 + top * 0.1 * (x - 0.42) / 0.48;   // alveolar plateau, slight upslope
      else y = top + (base - top) * (x - 0.9) / 0.1;                    // inspiratory downstroke
      out.push({ x: Math.round(x * 1000) / 1000, co2: r1(y) });
    }
    return out;
  }

  var PARTS = {
    fgf: { name: T("Fresh gas inlet", "Fresh gas inlet"), role: T("Oxygen, air or N2O and the vapour join the circle here.", "Oxygen, air या N2O और vapour यहाँ circle में आते हैं।") },
    insp: { name: T("Inspiratory valve and limb", "Inspiratory valve और limb"), role: T("A one-way valve: gas goes only towards the patient in this limb.", "एक-तरफ़ा valve: इस limb में gas केवल मरीज़ की ओर जाती है।") },
    y: { name: T("Y-piece", "Y-piece"), role: T("Joins both limbs at the patient. Dead space starts here.", "मरीज़ के पास दोनों limbs को जोड़ता है। Dead space यहीं से शुरू होता है।") },
    exp: { name: T("Expiratory valve and limb", "Expiratory valve और limb"), role: T("A one-way valve: exhaled gas goes only away from the patient.", "एक-तरफ़ा valve: बाहर निकली gas केवल मरीज़ से दूर जाती है।") },
    apl: { name: T("APL valve", "APL valve"), role: T("Adjustable pressure limiting valve. Open for spontaneous breathing; partly closed to squeeze the bag. Excess gas leaves here to scavenging.", "Adjustable pressure limiting valve। स्वतः साँस में खुला; bag दबाने के लिए आंशिक बंद। अतिरिक्त gas यहाँ से scavenging में जाती है।") },
    bag: { name: T("Reservoir bag", "Reservoir bag"), role: T("Holds gas for the next breath and lets you see and feel breathing. Squeeze it to ventilate by hand.", "अगली साँस के लिए gas रखता है और साँस देखने और महसूस करने देता है। हाथ से ventilate करने के लिए दबाएँ।") },
    absorber: { name: T("CO2 absorber", "CO2 absorber"), role: T("Soda lime takes CO2 out of the gas going round again. An indicator dye changes colour as it is used up.", "Soda lime दोबारा घूमती gas से CO2 निकालता है। इस्तेमाल होने पर indicator dye का रंग बदलता है।") }
  };

  return {
    id: "circuit", kind: "explorer", group: "equipment", level: "mbbs",
    title: { en: "Circle system and fresh gas flow", hi: "Circle system और fresh gas flow" },
    subtitle: { en: "Follow the gas round the circle and see what an exhausted absorber does to inspired CO2", hi: "Circle में gas का रास्ता देखें और जानें कि ख़त्म absorber inspired CO2 पर क्या करता है" },
    sources: [
      { label: "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition, chapter 3 (breathing systems: circle system, valves, APL valve, CO2 absorber and indicators)" },
      { label: "Baker AB. Low flow and closed circles. Anaesth Intensive Care 1994;22(4):341-342 (names of flow ranges)" },
      { label: "West JB, Luks AM. West's Respiratory Physiology: The Essentials, 11th edition, chapter 2 (alveolar ventilation equation; dead space)" },
      { label: "Ultane (sevoflurane) US prescribing information: fresh gas flow below 1 L/min not recommended; 1 to below 2 L/min for no more than 2 MAC hours" }
    ],
    review: "ai_drafted",
    notes: {
      model: { en: "A steady-state teaching model. In a patient CO2 rises over minutes and breathing changes, so the numbers show size and direction only.", hi: "Steady-state शिक्षण model। मरीज़ में CO2 मिनटों में बढ़ता है और साँस बदलती है, इसलिए अंक केवल मात्रा और दिशा दिखाते हैं।" },
      lowflow: { en: "Low flow saves volatile agent and keeps gas warm and moist. It needs a working absorber and gas monitoring.", hi: "Low flow volatile agent बचाता है और gas को गर्म और नम रखता है। इसके लिए काम करता absorber और gas monitoring चाहिए।" },
      partial: { en: "The half-used absorber setting is illustrative; real absorbers fail gradually and unevenly.", hi: "आधे इस्तेमाल absorber की setting उदाहरण है; असली absorber धीरे-धीरे और असमान रूप से ख़त्म होता है।" }
    },
    absorbers: ABSORBER, flows: FLOWS, parts: PARTS, partOrder: ["fgf", "insp", "y", "exp", "apl", "bag", "absorber"],
    constants: { k: K, vdvt: VDVT, runaway: RUNAWAY, limits: LIMITS, defaults: DEFAULTS },
    state: state, capnogram: capnogram, flowClass: flowClass
  };
});
