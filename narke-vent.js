/* Narkē Ventilator Lab: the screens for the ventilator simulator (engine narke-models/vent-engine.js, content
   narke/vent/scenarios.json and narke/vent/learn.json). ES5. Registers with the engine's sim registry
   (host.registerSim({id: "ventlab"})) once the engine model has loaded, like tokos-sim-labour.js.
   Screens: lab home (level 1 to 4, patients, tutorials, what-if, ABG cases, dyssynchrony gallery), the run (patient
   card, bedside monitor, ventilator with live waveforms, settings that wait for Confirm as on a real ventilator,
   cause-and-effect chain, oxygenation vs ventilation, alarms, ABG before and after, time controls, tutorial coach),
   the debrief (engine score), and the three practice screens.
   The UI reads the engine only through its contract API and the content only through the JSON schemas; every
   number shown comes from the model. Strings: learn.json or the {en, hi} table below; ASCII digits in Hindi.
   Waveforms: canvas traces from E.breath, swept with requestAnimationFrame; reduced motion draws them still.
   Node (tests): module.exports = the pure helpers. */
(function (G) {
  "use strict";
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure helpers ================= */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function decs(step) { var s = String(step), i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; }
  // One click of a setting: snap to the step grid, stay in range.
  // coarse: a beginner step size (FiO2 in 5s); the value moves to the next point on that grid (PEEP 5, step 2: 6 or 4).
  function stepVal(def, v, dir, mult, coarse) {
    var st = coarse || def.step || 1, n;
    if (coarse) n = (dir > 0 ? Math.floor(+v / st + 1e-9) * st + st : Math.ceil(+v / st - 1e-9) * st - st) + dir * st * ((mult || 1) - 1);
    else { n = (+v) + dir * st * (mult || 1); n = Math.round(n / st) * st; }
    n = clamp(n, def.min, def.max);
    return +n.toFixed(decs(st));
  }
  function pbw(sex, h) { return Math.round((sex === "F" ? 45.5 : 50) + 0.91 * (h - 152.4)); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function dirOf(a, b, eps) { if (a == null || b == null || isNaN(a) || isNaN(b)) return 0; var d = b - a; return Math.abs(d) <= (eps || 0) ? 0 : d > 0 ? 1 : -1; }
  function clockParts(sec) { var m = Math.floor((sec || 0) / 60); return { h: Math.floor(m / 60), m: m % 60 }; }
  // A periodic trace as a lookup table of n samples over one period (t[] seconds, y[] values).
  function table(t, y, n) {
    var P = t[t.length - 1] - t[0], out = new Array(n), j = 0, i, x;
    for (i = 0; i < n; i++) {
      x = t[0] + P * i / n;
      while (j < t.length - 2 && t[j + 1] < x) j++;
      var f = t[j + 1] === t[j] ? 0 : (x - t[j]) / (t[j + 1] - t[j]);
      out[i] = y[j] + (y[j + 1] - y[j]) * clamp(f, 0, 1);
    }
    return { p: P > 0 ? P : 1, v: out };
  }
  function fnTable(fn, period, n) { var v = new Array(n), i; for (i = 0; i < n; i++) v[i] = fn(i / n); return { p: period, v: v }; }
  // Monitor shapes over one beat or breath, phase 0..1.
  function ecgShape(x) {
    function g(c, w, a) { var d = (x - c) / w; return a * Math.exp(-d * d); }
    return g(0.16, 0.03, 0.12) - g(0.255, 0.012, 0.14) + g(0.28, 0.016, 1) - g(0.305, 0.014, 0.28) + g(0.53, 0.055, 0.3);
  }
  function plethShape(x) {
    var u = (x + 0.82) % 1;
    var up = u < 0.18 ? Math.sin(Math.PI / 2 * u / 0.18) : Math.exp(-(u - 0.18) * 3.4);
    var notch = 0.09 * Math.exp(-Math.pow((u - 0.42) / 0.05, 2));
    return up * 0.92 + notch;
  }
  function capnoShape(insp, slow) {
    return function (x) {
      if (x < insp) return x < insp * 0.15 ? Math.max(0, 1 - x / (insp * 0.15)) * 0.97 : 0;
      var e = (x - insp) / (1 - insp);
      if (slow) return Math.min(1, Math.pow(e / 0.85, 0.55));
      return e < 0.08 ? e / 0.08 * 0.9 : Math.min(1, 0.9 + (e - 0.08) * 0.11);
    };
  }
  var PURE = { clamp: clamp, decs: decs, stepVal: stepVal, pbw: pbw, dirOf: dirOf, clockParts: clockParts, table: table };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  G.NARKE_VENT_UI = PURE;

  /* ================= browser ================= */
  var host = G.NARKE;
  if (!host || !host.registerSim || !host._internal || !G.document) return;
  var I = host._internal, st = host._st, C = G.SPECIALTY_CORE, esc = I.esc, A = I.ACTIONS;

  var STR = {
    title: T("Ventilator Lab", "वेंटिलेटर लैब"), sub: T("Simulator", "सिम्युलेटर"),
    lede: T("Ventilate a simulated patient. Change one thing, then watch the lungs, the gases and the patient answer.", "एक सिम्युलेटेड मरीज़ को वेंटिलेट करें। एक चीज़ बदलें, फिर फेफड़े, गैसें और मरीज़ का जवाब देखें।"),
    backTest: T("Back to Test", "टेस्ट पर वापस"), backLab: T("Back to the lab", "लैब पर वापस"),
    level: T("Your level", "आपका स्तर"), lvN: T("Level {n}", "स्तर {n}"),
    lv1: T("Beginner", "शुरुआती"), lv2: T("Intermediate", "मध्यम"), lv3: T("Advanced", "एडवांस्ड"), lv4: T("Advanced ICU", "एडवांस्ड ICU"),
    patients: T("Patients", "मरीज़"), morePts: T("{n} more patients open at a higher level.", "{n} और मरीज़ ऊँचे स्तर पर खुलते हैं।"),
    guided: T("Guided tutorials", "गाइडेड ट्यूटोरियल"), practise: T("Practise", "अभ्यास"),
    whatIf: T("What happens if I…", "अगर मैं… तो क्या होगा"), whatIfSub: T("Pick a setting, see before and after", "एक सेटिंग चुनें, पहले और बाद देखें"),
    cases: T("ABG reasoning", "ABG तर्क"), casesSub: T("Read the gas, choose the change", "गैस पढ़ें, बदलाव चुनें"),
    dys: T("Dyssynchrony gallery", "डिससिंक्रोनी गैलरी"), dysSub: T("Name the waveform", "वेवफ़ॉर्म पहचानें"),
    steps: T("{n} steps", "{n} चरण"), nCases: T("{n} cases", "{n} केस"), nPatterns: T("{n} patterns, {s} named", "{n} पैटर्न, {s} पहचाने"),
    loading: T("Loading the lab…", "लैब लोड हो रही है…"), loadErr: T("The lab content did not load. Check your connection and try again.", "लैब की सामग्री लोड नहीं हुई। कनेक्शन जांचें और फिर कोशिश करें।"), retry: T("Try again", "फिर कोशिश करें"),
    male: T("Male", "पुरुष"), female: T("Female", "महिला"), yrs: T("{n} y", "{n} वर्ष"),
    pbw: T("PBW", "PBW"), pbwFull: T("Predicted body weight {n} kg", "अनुमानित शरीर वज़न {n} kg"),
    tStiff: T("Stiff lung", "सख़्त फेफड़ा"), tNarrow: T("Narrow airways", "संकरे वायुमार्ग"), tTrap: T("Air trapping", "हवा का फँसना"), tShunt: T("Large shunt", "बड़ा शंट"), tNormal: T("Normal lungs", "सामान्य फेफड़े"),
    volLow: T("Low on fluid", "शरीर में फ़्लूइड कम"), volHigh: T("Fluid overloaded", "ज़्यादा फ़्लूइड"), volNormal: T("Normal fluid status", "फ़्लूइड सामान्य"),
    scenario: T("Scenario", "परिदृश्य"), why: T("Why ventilated", "वेंटिलेशन क्यों"), lung: T("Lung", "फेफड़ा"), circ: T("Circulation", "रक्त संचार"),
    compl: T("Lung compliance when fully open (scenario) {n} mL/cmH2O", "पूरी तरह खुले फेफड़े का कंप्लायंस (परिदृश्य) {n} mL/cmH2O"), resist: T("Resistance {n} cmH2O/L/s", "रेज़िस्टेंस {n} cmH2O/L/s"),
    targets: T("Targets", "लक्ष्य"), simulated: T("Simulated teaching values", "सिम्युलेटेड शिक्षण मान"),
    monitor: T("Bedside monitor", "बेडसाइड मॉनिटर"), hr: T("HR", "HR"), spo2: T("SpO2", "SpO2"), nibp: T("NIBP", "NIBP"), rr: T("RR", "RR"), temp: T("Temp", "तापमान"),
    etco2: T("EtCO2", "EtCO2"), ecg: T("ECG II", "ECG II"), pleth: T("Pleth", "Pleth"), co2: T("CO2", "CO2"),
    monSay: T("HR {a}, SpO2 {b} percent, BP {c} over {d}, mean {e}, RR {f}, EtCO2 {g}, temperature {h}.", "HR {a}, SpO2 {b} प्रतिशत, BP {c} बटा {d}, मीन {e}, RR {f}, EtCO2 {g}, तापमान {h}।"),
    vent: T("Ventilator", "वेंटिलेटर"), mode: T("Mode", "मोड"), changeMode: T("Change mode, now {x}", "मोड बदलें, अभी {x}"),
    paw: T("Pressure", "प्रेशर"), flow: T("Flow", "फ़्लो"), vol: T("Volume", "वॉल्यूम"),
    mkTrig: T("trigger", "ट्रिगर"), mkCyc: T("cycle", "साइकल"), mkAuto: T("auto-PEEP", "ऑटो-PEEP"),
    waveSay: T("Pressure, flow and volume waveforms. Peak {a}, plateau {b} cmH2O. {c} {d}", "प्रेशर, फ़्लो और वॉल्यूम वेवफ़ॉर्म। पीक {a}, प्लेटो {b} cmH2O। {c} {d}"),
    flowZero: T("Expiratory flow returns to zero before the next breath.", "अगली साँस से पहले एक्सपिरेटरी फ़्लो शून्य पर लौटता है।"),
    flowNot: T("Expiratory flow does not return to zero: air is trapped.", "एक्सपिरेटरी फ़्लो शून्य पर नहीं लौटता: हवा फँस रही है।"),
    trigSay: T("Breaths are triggered by the patient.", "साँसें मरीज़ ट्रिगर कर रहा है।"),
    ro_vte: T("VTe", "VTe"), ro_ve: T("VE", "VE"), ro_ppeak: T("Ppeak", "Ppeak"), ro_pplat: T("Pplat", "Pplat"), ro_pmean: T("Pmean", "Pmean"),
    ro_peepTotal: T("PEEP total", "कुल PEEP"), ro_autoPeep: T("Auto-PEEP", "ऑटो-PEEP"), ro_drivingP: T("Driving P", "ड्राइविंग P"), ro_cstat: T("Cstat", "Cstat"),
    ro_pfRatio: T("P/F", "P/F"), ro_shunt: T("Shunt", "शंट"), ro_vdvt: T("Vd/Vt", "Vd/Vt"), ro_aaGradient: T("A-a gradient", "A-a ग्रेडिएंट"),
    ro_raw: T("Raw", "Raw"), ro_rrTotal: T("RR total", "कुल RR"), ro_ieActual: T("I:E", "I:E"), ro_mechPower: T("Mech power", "मैकेनिकल पावर"), ro_trapV: T("Trapped air", "फँसी हवा"), ro_ineffective: T("Missed breaths", "छूटी साँसें"),
    high: T("high", "ऊँचा"), low: T("low", "कम"), perKg: T("{n} mL/kg PBW", "{n} mL/kg PBW"),
    settings: T("Settings", "सेटिंग"), pendNote: T("Changes wait for Confirm, as on a real ventilator.", "बदलाव Confirm तक रुकते हैं, जैसे असली वेंटिलेटर पर।"),
    info: T("Learn this setting: {x}", "यह सेटिंग सीखें: {x}"), inc: T("Increase {x}", "{x} बढ़ाएँ"), dec: T("Decrease {x}", "{x} घटाएँ"),
    was: T("was {v}", "पहले {v}"), valWas: T("{v}, was {w}", "{v}, पहले {w}"), alarmLimits: T("Alarm limits", "अलार्म सीमाएँ"),
    confirm1: T("Confirm change", "बदलाव पक्का करें"), confirmN: T("Confirm {n} changes", "{n} बदलाव पक्के करें"), cancel: T("Cancel", "रद्द करें"),
    chain: T("Cause and effect", "कारण और असर"), chainEmpty: T("Change a setting and confirm. Each link lights up in turn, with the reason.", "एक सेटिंग बदलें और पक्का करें। हर कड़ी कारण के साथ बारी-बारी से जलेगी।"),
    ch_setting: T("Setting", "सेटिंग"), ch_ventilator: T("Ventilator", "वेंटिलेटर"), ch_mechanics: T("Lung mechanics", "फेफड़े की मैकेनिक्स"), ch_waveforms: T("Waveforms", "वेवफ़ॉर्म"),
    ch_gasExchange: T("Gas exchange", "गैस विनिमय"), ch_monitor: T("SpO2 and EtCO2", "SpO2 और EtCO2"), ch_abg: T("ABG", "ABG"), ch_patient: T("Patient", "मरीज़"),
    cSet: T("{x}: {a} to {b}", "{x}: {a} से {b}"), cMode: T("Mode: {a} to {b}", "मोड: {a} से {b}"),
    cVent: T("Now delivers {v} mL at {r} breaths a minute, minute volume {m} L/min.", "अब {r} साँस प्रति मिनट पर {v} mL देता है, मिनट वॉल्यूम {m} L/min।"),
    cMech: T("Plateau {a} to {b}, driving pressure {c} to {d} cmH2O.", "प्लेटो {a} से {b}, ड्राइविंग प्रेशर {c} से {d} cmH2O।"),
    cWave: T("Peak pressure {a} to {b} cmH2O.", "पीक प्रेशर {a} से {b} cmH2O।"),
    cWaveAuto: T("Flow no longer reaches zero: auto-PEEP {a} cmH2O.", "फ़्लो अब शून्य तक नहीं पहुँचता: ऑटो-PEEP {a} cmH2O।"),
    cWaveFree: T("Flow reaches zero again: trapped air is gone.", "फ़्लो फिर शून्य तक पहुँचता है: फँसी हवा निकल गई।"),
    cMon: T("In 30 min without your change vs with it (prediction): SpO2 {a} vs {b}, EtCO2 {c} vs {d}.", "30 मिनट में, बिना बदलाव बनाम बदलाव के साथ (अनुमान): SpO2 {a} बनाम {b}, EtCO2 {c} बनाम {d}।"),
    cAbg: T("In 30 min without your change vs with it (prediction): PaO2 {a} vs {b}, PaCO2 {c} vs {d}, pH {e} vs {f}.", "30 मिनट में, बिना बदलाव बनाम बदलाव के साथ (अनुमान): PaO2 {a} बनाम {b}, PaCO2 {c} बनाम {d}, pH {e} बनाम {f}।"),
    cPt: T("In 30 min without your change vs with it (prediction): MAP {a} vs {b}, HR {c} vs {d}.", "30 मिनट में, बिना बदलाव बनाम बदलाव के साथ (अनुमान): MAP {a} बनाम {b}, HR {c} बनाम {d}।"),
    cSame: T("No change", "कोई बदलाव नहीं"),
    cPlat: T("Plateau {a} to {b} cmH2O", "प्लेटो {a} से {b} cmH2O"), cDrive: T("driving pressure {a} to {b}", "ड्राइविंग प्रेशर {a} से {b}"),
    cDriveSame: T("driving pressure stays {a}", "ड्राइविंग प्रेशर {a} पर स्थिर"), cPeepT: T("total PEEP {a} to {b}", "कुल PEEP {a} से {b}"),
    chainSay: T("Chain: {x}", "चेन: {x}"),
    ox: T("Oxygenation and ventilation", "ऑक्सीजनेशन और वेंटिलेशन"), oxSide: T("Oxygenation", "ऑक्सीजनेशन"), veSide: T("Ventilation", "वेंटिलेशन"),
    oxRule: T("FiO2, PEEP and mean airway pressure set the oxygen.", "FiO2, PEEP और मीन एयरवे प्रेशर ऑक्सीजन तय करते हैं।"),
    veRule: T("VT x RR is the minute ventilation. It sets the CO2.", "VT x RR मिनट वेंटिलेशन है। यही CO2 तय करता है।"),
    lastTouched: T("Your last change worked on this side.", "आपका पिछला बदलाव इसी तरफ़ था।"),
    abg: T("Blood gas", "ब्लड गैस"), draw: T("Draw ABG", "ABG लें"), abgNone: T("No gas drawn yet. Draw one, change something, wait, then draw again.", "अभी कोई गैस नहीं ली। एक लें, कुछ बदलें, रुकें, फिर दोबारा लें।"),
    abgAgain: T("Change a setting, let time pass, and draw again to compare.", "सेटिंग बदलें, समय बीतने दें, और तुलना के लिए दोबारा लें।"),
    before: T("Before", "पहले"), now: T("Now", "अभी"), at: T("at {t}", "{t} पर"), whyH: T("Why", "क्यों"),
    up: T("up", "बढ़ा"), down: T("down", "घटा"), same: T("no change", "कोई बदलाव नहीं"), pf: T("P/F", "P/F"), lact: T("Lactate", "लैक्टेट"),
    abgSay: T("ABG at {t}: pH {a}, PaCO2 {b}, PaO2 {c}, HCO3 {d}.", "{t} पर ABG: pH {a}, PaCO2 {b}, PaO2 {c}, HCO3 {d}।"),
    live: T("Live", "लाइव"), pause: T("Pause", "रोकें"), liveOn: T("Live time is running", "लाइव समय चल रहा है"), liveOff: T("Live time is paused", "लाइव समय रुका है"),
    t5: T("+5 min", "+5 मिनट"), t15: T("+15 min", "+15 मिनट"), t30: T("+30 min", "+30 मिनट"), t60: T("+1 h", "+1 घंटा"),
    skipAria: T("Skip ahead {x}", "{x} आगे बढ़ें"), clock: T("{h} h {m} min", "{h} घंटे {m} मिनट"), simTime: T("Sim time {x}", "सिम समय {x}"),
    skipped: T("{x} later: SpO2 {a}, PaCO2 {b}, MAP {c}.", "{x} बाद: SpO2 {a}, PaCO2 {b}, MAP {c}।"),
    bedH: T("Bedside actions", "बेडसाइड काम"), bedNote: T("Hands on the patient, not the dials. Each one goes in your run log.", "डायल नहीं, मरीज़ पर हाथ। हर काम आपके run log में दर्ज होता है।"),
    bedSug: T("The alarm card suggests this", "अलार्म कार्ड यह सुझाता है"), bedDone: T("Done: {x}", "हो गया: {x}"), drainIn: T("Chest drain in place", "Chest drain लगा है"),
    bagNow: T("Hand bagging, 100% oxygen", "हाथ से bagging, 100% oxygen"), bagOff: T("Off the ventilator, no PEEP valve. A recruitable lung can collapse.", "Ventilator से हटा, PEEP valve नहीं। खुल सकने वाला फेफड़ा बैठ सकता है।"),
    bagLeft: T("{n} s left", "{n} s बाकी"), bagEnd: T("Bagging over. Back on the ventilator.", "Bagging खत्म। फिर से ventilator पर।"), bagging: T("Bagging", "Bagging चालू"),
    alarmsNone: T("No active alarms", "कोई सक्रिय अलार्म नहीं"), silence: T("Silence 2 min", "2 मिनट चुप करें"), ack: T("Acknowledge", "स्वीकार करें"),
    silenced: T("silenced", "चुप"), causes: T("Likely causes", "संभावित कारण"), clue: T("Waveform clue", "वेवफ़ॉर्म संकेत"), trouble: T("Troubleshooting", "समस्या जाँच"),
    fix: T("Correct intervention", "सही कदम"), alarmOpen: T("Alarm: {x}. Open the alarm card", "अलार्म: {x}। अलार्म कार्ड खोलें"), alarmsH: T("Alarms", "अलार्म"), allAlarms: T("All {n} alarms", "सभी {n} अलार्म"), plusN: T("+{n} more", "+{n} और"),
    finish: T("Finish and debrief", "समाप्त करें और समीक्षा"), debrief: T("Debrief", "समीक्षा"), outOf: T("out of 100", "100 में से"),
    p_mode: T("Mode choice", "मोड चुनाव"), p_initial: T("First settings", "पहली सेटिंग"), p_oxygenation: T("Oxygenation", "ऑक्सीजनेशन"), p_ventilation: T("Ventilation", "वेंटिलेशन"),
    p_protection: T("Lung protection", "फेफड़े की सुरक्षा"), p_alarms: T("Alarm response", "अलार्म प्रतिक्रिया"), p_abg: T("ABG use", "ABG उपयोग"), p_time: T("Timing", "समय"), p_unsafe: T("Unsafe moments", "असुरक्षित पल"), penalty: T("Penalty", "दंड"), notScored: T("Not scored", "गिना नहीं"),
    takeaway: T("What to take away", "क्या सीखें"), atEnd: T("At the end", "अंत में"), met: T("met", "पूरा"), notMet: T("not met", "पूरा नहीं"),
    again: T("Run again", "फिर चलाएँ"), labHome: T("Lab home", "लैब होम"),
    mc_controlled: T("Controlled", "नियंत्रित"), mc_variable: T("Varies", "बदलता है"), mc_guarantees: T("Guarantees", "गारंटी"), mc_dependsOn: T("Depends on", "निर्भर करता है"),
    mc_when: T("When to use", "कब इस्तेमाल करें"), mc_risks: T("Risks", "जोखिम"), mc_beginner: T("In short", "संक्षेप में"), useMode: T("Use this mode", "यह मोड लें"), current: T("Current", "मौजूदा"),
    ls_what: T("What it is", "यह क्या है"), ls_controls: T("What it controls", "यह क्या नियंत्रित करता है"), ls_up: T("Turn it up", "बढ़ाने पर"), ls_down: T("Turn it down", "घटाने पर"),
    ls_oxygenation: T("Oxygenation", "ऑक्सीजनेशन"), ls_ventilation: T("Ventilation", "वेंटिलेशन"), ls_risks: T("Risks", "जोखिम"), ls_use: T("How to use it", "कैसे इस्तेमाल करें"),
    ls_pearl: T("Pearl", "खास बात"), ls_beginner: T("In short", "संक्षेप में"), range: T("Range {a} to {b} {u}", "सीमा {a} से {b} {u}"),
    close: T("Close", "बंद करें"),
    hPlat: T("The plateau is above the safe limit. Which setting decides how far each breath stretches the lung?", "प्लेटो सुरक्षित सीमा से ऊपर है। कौन सी सेटिंग तय करती है कि हर साँस फेफड़े को कितना खींचे?"),
    hVt: T("Check the tidal volume per kg of predicted body weight. Is this breath sized for the height?", "अनुमानित वज़न प्रति kg टाइडल वॉल्यूम जाँचें। क्या यह साँस ऊँचाई के हिसाब से है?"),
    hDrive: T("Driving pressure is high. What happens to it if each breath is smaller?", "ड्राइविंग प्रेशर ऊँचा है। साँस छोटी हो तो इसका क्या होगा?"),
    hAuto: T("Look at the end of the flow curve. Does it reach zero before the next breath?", "फ़्लो कर्व का अंत देखें। क्या यह अगली साँस से पहले शून्य तक पहुँचता है?"),
    hO2: T("Oxygen is below the target. Which two settings mainly decide oxygenation?", "ऑक्सीजन लक्ष्य से कम है। कौन सी दो सेटिंग मुख्य रूप से ऑक्सीजनेशन तय करती हैं?"),
    hO2hi: T("SpO2 is above the target. Could the patient manage with less oxygen?", "SpO2 लक्ष्य से ऊपर है। क्या मरीज़ कम ऑक्सीजन पर ठीक रहेगा?"),
    hCo2: T("Look at the pH and PaCO2. Which settings make the minute ventilation?", "pH और PaCO2 देखें। कौन सी सेटिंग मिनट वेंटिलेशन बनाती हैं?"),
    hMap: T("The blood pressure is falling. What does high pressure in the chest do to venous return?", "BP गिर रहा है। छाती में ऊँचा दबाव वीनस रिटर्न पर क्या करता है?"),
    hint: T("Hint", "संकेत"), event: T("Event", "घटना"),
    tut: T("Tutorial", "ट्यूटोरियल"), stepOf: T("Step {i} of {n}", "{n} में से चरण {i}"), next: T("Next", "आगे"), done: T("Done", "पूरा"), exitTut: T("Exit tutorial", "ट्यूटोरियल छोड़ें"),
    yourTurn: T("Your turn", "आपकी बारी"), doIt: T("Do it for me", "मेरे लिए करें"), setTo: T("Set {x} to {v}, then confirm.", "{x} को {v} करें, फिर पक्का करें।"),
    modeTo: T("Switch the mode to {x}, then confirm.", "मोड {x} करें, फिर पक्का करें।"), actTo: T("At the bedside: {x}.", "बेडसाइड पर: {x}।"),
    abgTo: T("Draw a blood gas.", "एक blood gas लें।"), sawIt: T("You saw it: {x} went {d}.", "आपने देखा: {x} {d}।"),
    waitSee: T("Now move time forward and watch {x}.", "अब समय आगे बढ़ाएँ और {x} देखें।"), doneStep: T("Done", "हो गया"),
    wiPick: T("Pick a question", "एक प्रश्न चुनें"), wiBuild: T("Or build your own", "या अपना बनाएँ"), wiSetting: T("Setting", "सेटिंग"), wiDir: T("Direction", "दिशा"),
    wiUp: T("Increase", "बढ़ाएँ"), wiDown: T("Decrease", "घटाएँ"), wiGo: T("Show before and after", "पहले और बाद दिखाएँ"), wiNow: T("Now", "अभी"), wiAfter: T("After 30 min", "30 मिनट बाद"),
    wiPatient: T("Patient", "मरीज़"), wiEmpty: T("Choose a question above to see what changes, and why.", "क्या बदलता है और क्यों, देखने के लिए ऊपर एक प्रश्न चुनें।"),
    caseOf: T("Case {i} of {n}", "{n} में से केस {i}"), right: T("Correct", "सही"), wrong: T("Not right", "गलत"), result: T("Simulated result, 30 min after the change", "बदलाव के 30 मिनट बाद सिम्युलेटेड परिणाम"), applied: T("Change applied", "लागू बदलाव"),
    nextCase: T("Next case", "अगला केस"), q1: T("Question 1", "प्रश्न 1"), q2: T("Question 2", "प्रश्न 2"), normal: T("Normal {a} to {b}", "सामान्य {a} से {b}"),
    pattern: T("Pattern {n}", "पैटर्न {n}"), nameIt: T("Which pattern is this?", "यह कौन सा पैटर्न है?"), named: T("Named", "पहचाना"), notNamed: T("Not named yet", "अभी पहचाना नहीं"), dysNext: T("Next pattern", "अगला पैटर्न"),
    dName: T("Name", "नाम"), dClue: T("Clue", "संकेत"), dCause: T("Cause", "कारण"), dFix: T("Fix", "समाधान"),
    dysAria: T("Pressure and flow over two breaths, showing a patient and ventilator out of step.", "दो साँसों में प्रेशर और फ़्लो, मरीज़ और वेंटिलेटर का तालमेल नहीं।"),
    runs: T("{n} runs, best {b}", "{n} रन, सर्वोत्तम {b}"), runs1: T("1 run, best {b}", "1 रन, सर्वोत्तम {b}"), none: T("Not started", "अभी शुरू नहीं"),
    maikQ: T("I ran a ventilator lab simulation", "I ran a ventilator lab simulation"),
    fallbackDisc: T("Educational simulator. Not a real ventilator and not a guide to treating a real patient.", "शैक्षिक सिम्युलेटर। यह असली वेंटिलेटर नहीं है और असली मरीज़ के इलाज की गाइड नहीं है।"),
    // beginner layer: plain words beside the clinical ones (Level 1 and 2)
    startHere: T("Start here", "यहाँ से शुरू करें"), tutFirst: T("New to ventilators? Do the first two tutorials, then open a patient.", "वेंटिलेटर नया है? पहले दो ट्यूटोरियल करें, फिर एक मरीज़ खोलें।"),
    storyGoals: T("Story and goals", "कहानी और लक्ष्य"),
    pbwWhy: T("PBW is the weight predicted from height. Breath size is set from it, not from real weight.", "PBW लंबाई से अनुमानित वज़न है। साँस का आकार इसी से तय होता है, असली वज़न से नहीं।"),
    monWhat: T("What these numbers mean", "इन संख्याओं का मतलब"),
    mHr: T("HR: heartbeats a minute. Normal adult range is about 60 to 100.", "HR: दिल की धड़कन प्रति मिनट। वयस्क में सामान्य लगभग 60 से 100।"),
    mSpo2: T("SpO2: how much of the blood's haemoglobin carries oxygen, in %.", "SpO2: खून का कितना हीमोग्लोबिन ऑक्सीजन ले जा रहा है, % में।"),
    mRr: T("RR: breaths a minute, the machine's and the patient's together.", "RR: प्रति मिनट साँसें, मशीन और मरीज़ की मिलाकर।"),
    mBp: T("NIBP: blood pressure, top over bottom. The number in brackets is the mean (MAP).", "NIBP: ब्लड प्रेशर, ऊपर बटा नीचे। कोष्ठक में औसत (MAP) है।"),
    mUnit: T("cmH2O is the unit for airway pressure. mmHg is the unit for blood pressure and blood gases.", "cmH2O वायुमार्ग दबाव की इकाई है। mmHg ब्लड प्रेशर और ब्लड गैस की इकाई है।"),
    wavesWhat: T("Each trace sweeps left to right, one breath after another: the push, the air moving, the air in the lung.", "हर ट्रेस बाएँ से दाएँ चलता है, एक साँस के बाद दूसरी: दबाव, चलती हवा, फेफड़े में हवा।"),
    doingH: T("What the ventilator is doing", "वेंटिलेटर क्या कर रहा है"),
    b_vte: T("Air per breath", "हर साँस में हवा"), b_rrTotal: T("Breaths a minute", "प्रति मिनट साँसें"), b_ve: T("Air per minute", "प्रति मिनट हवा"), b_ppeak: T("Highest push", "सबसे ऊँचा दबाव"),
    doingNote: T("Air per minute is air per breath times breaths a minute. It clears the CO2.", "प्रति मिनट हवा = हर साँस की हवा गुणा प्रति मिनट साँसें। यही CO2 निकालती है।"),
    k_fio2: T("Oxygen in the air", "हवा में ऑक्सीजन"), k_peep: T("Pressure kept in the lungs", "फेफड़ों में रखा दबाव"), k_vt: T("Size of each breath", "हर साँस का आकार"), k_rr: T("Machine breaths a minute", "मशीन की साँसें प्रति मिनट"),
    cd_setting: T("What you changed", "आपने क्या बदला"), cd_ventilator: T("What the machine now gives", "मशीन अब क्या दे रही है"), cd_mechanics: T("How the lung takes the push", "फेफड़ा दबाव को कैसे लेता है"),
    cd_waveforms: T("What the traces show", "ट्रेस क्या दिखाते हैं"), cd_gasExchange: T("Oxygen in and CO2 out, in the air sacs", "हवा की थैलियों में ऑक्सीजन अंदर, CO2 बाहर"),
    cd_monitor: T("What the bedside monitor shows", "बेडसाइड मॉनिटर क्या दिखाता है"), cd_abg: T("What a blood gas would show", "ब्लड गैस क्या दिखाएगी"), cd_patient: T("Blood pressure and heart rate", "ब्लड प्रेशर और दिल की धड़कन"),
    nextH: T("Next", "अगला कदम"),
    nx0: T("Tap Draw ABG to see where the patient starts.", "शुरुआत देखने के लिए ABG लें दबाएँ।"),
    nx1: T("Pick one dial, tap + or the minus button, then Confirm.", "एक dial चुनें, + या घटाने वाला बटन दबाएँ, फिर पक्का करें।"),
    nx2: T("Press Confirm to apply it. A real ventilator waits for this too.", "लागू करने के लिए पक्का करें दबाएँ। असली वेंटिलेटर भी इसका इंतज़ार करता है।"),
    nx3: T("Read the chain, then tap +30 min. Blood gases change slowly.", "चेन पढ़ें, फिर +30 मिनट दबाएँ। ब्लड गैस धीरे बदलती है।"),
    nx4: T("Now Draw ABG again to see what your change did.", "अब फिर ABG लें और देखें आपके बदलाव ने क्या किया।"),
    nx4b: T("Now Draw ABG to see what your change did.", "अब ABG लें और देखें आपके बदलाव ने क्या किया।"),
    nx6: T("This gas came soon after your change and has not settled. Tap +30 min, then Draw ABG again.", "यह गैस बदलाव के तुरंत बाद ली गई, अभी स्थिर नहीं हुई। +30 मिनट दबाएँ, फिर दोबारा ABG लें।"),
    nx7: T("Read this gas against the goals. Then try another change, or Finish.", "इस गैस को लक्ष्यों से मिलाएँ। फिर कोई और बदलाव करें, या समाप्त करें।"),
    nx5: T("Compare Before and Now in the blood gas. Then try another change, or Finish.", "ब्लड गैस में पहले और अभी की तुलना करें। फिर कोई और बदलाव करें, या समाप्त करें।"),
    tutMoved: T("The clock moved on {m} min so you can see it.", "आपको दिखाने के लिए घड़ी {m} मिनट आगे बढ़ी।"),
    tutFlat: T("{x} barely moves in this patient. Go on when ready.", "इस मरीज़ में {x} लगभग नहीं बदलता। तैयार हों तो आगे बढ़ें।"),
    tutLook: T("Watch {x}.", "{x} देखें।"),
    ex_paco2: T("CO2 in the blood (PaCO2)", "खून में CO2 (PaCO2)"), ex_pao2: T("oxygen in the blood (PaO2)", "खून में ऑक्सीजन (PaO2)"), ex_ph: T("pH", "pH"),
    ex_pplat: T("plateau pressure", "प्लेटो प्रेशर"), ex_map: T("mean blood pressure (MAP)", "औसत ब्लड प्रेशर (MAP)"), ex_vte: T("tidal volume", "टाइडल वॉल्यूम"),
    ex_autoPeep: T("auto-PEEP", "ऑटो-PEEP"), ex_drivingP: T("driving pressure", "ड्राइविंग प्रेशर"), ex_spo2: T("SpO2", "SpO2"),
    ex_etco2: T("EtCO2 (CO2 at the end of each breath)", "EtCO2 (हर साँस के अंत में CO2)"), ex_rrTotal: T("breathing rate (RR total)", "साँस की दर (कुल RR)"),
    ab_pH: T("acidity: lower is more acid", "अम्लता: कम यानी ज़्यादा एसिड"), ab_PaCO2: T("CO2 in the blood", "खून में CO2"), ab_PaO2: T("oxygen in the blood", "खून में ऑक्सीजन"),
    ab_HCO3: T("bicarbonate, the body's buffer", "बाइकार्बोनेट, शरीर का बफ़र"), ab_SaO2: T("% of haemoglobin carrying oxygen", "ऑक्सीजन ले जा रहा हीमोग्लोबिन %"),
    // persona pass: run tabs, coach, steppers, leave, alarms, holds, projections, debrief
    tabsH: T("Show", "दिखाएँ"), tb_mon: T("Monitor", "मॉनिटर"), tb_dials: T("Dials", "डायल"), tb_chg: T("What changed", "क्या बदला"), tb_abg: T("Blood gas", "ब्लड गैस"),
    coMin: T("Hide the coach", "कोच छोटा करें"), coMax: T("Show the coach", "कोच दिखाएँ"),
    needDo: T("First: {x}", "पहले: {x}"), needWait: T("First: press +5 min, then watch {x}.", "पहले: +5 मिनट दबाएँ, फिर {x} देखें।"),
    sawVal: T("{x}: {a} to {b}", "{x}: {a} से {b}"), coNow: T("Now", "अभी"),
    tutLeft: T("Your changes stay. Out of target now: {x}.", "आपके बदलाव बने रहेंगे। अभी लक्ष्य से बाहर: {x}।"), restore: T("Restore the starting settings", "शुरुआती सेटिंग वापस लाएँ"),
    restored: T("Starting settings restored.", "शुरुआती सेटिंग वापस आ गईं।"),
    setToL: T("{x} to {v}, then confirm.", "{x} को {v} करें, फिर पक्का करें।"),
    typeVal: T("Type a value for {x}", "{x} का मान लिखें"),
    typeTip: T("Tap a number to type it; hold + or the minus button to keep turning.", "किसी number पर tap करके सीधे लिखें; लगातार घुमाने के लिए + या घटाने वाला बटन दबाकर रखें।"),
    limTip: T("A limit only decides when the alarm sounds. Tap the number to type it; + and the minus button move the pressure limit 5 at a time.", "सीमा सिर्फ़ तय करती है कि alarm कब बजे। Number पर tap करके लिखें; + और घटाने वाला बटन pressure सीमा को हर tap पर 5 बदलते हैं।"),
    wHigh: T("{x} {v} is very high for this patient. Check before you confirm.", "{x} {v} इस मरीज़ के लिए बहुत ज़्यादा है। पक्का करने से पहले जाँचें।"),
    wLow: T("{x} {v} is very low for this patient. Check before you confirm.", "{x} {v} इस मरीज़ के लिए बहुत कम है। पक्का करने से पहले जाँचें।"),
    wO2: T("FiO2 {v}% while SpO2 is below target: oxygen will fall further.", "SpO2 लक्ष्य से कम है और FiO2 {v}%: ऑक्सीजन और गिरेगी।"),
    wVt: T("{v} mL is {k} mL/kg PBW. Breaths this size can injure the lung.", "{v} mL यानी {k} mL/kg PBW। इतनी बड़ी साँस फेफड़े को चोट दे सकती है।"),
    confirmAny: T("Confirm anyway", "फिर भी पक्का करें"),
    leaveH: T("Leave this run?", "यह रन छोड़ें?"), leaveB: T("The patient stays at {t}. You can come back to it from the lab home.", "मरीज़ {t} पर रुका रहेगा। आप लैब होम से फिर लौट सकते हैं।"),
    resumeLater: T("Resume later", "बाद में जारी रखें"), leaveRun: T("Leave without saving", "बिना सहेजे छोड़ें"),
    resumeAt: T("Unfinished run at {t}. Tap to resume.", "{t} पर अधूरा रन। जारी रखने के लिए दबाएँ।"), resumed: T("Run resumed at {t}.", "रन {t} से जारी।"),
    startOver: T("Start over", "फिर से शुरू करें"),
    bedLog: T("Your actions", "आपके काम"), usedAt: T("Used at {t}", "{t} पर किया"), sugg: T("Suggested", "सुझाया गया"),
    youChanged: T("You changed {x} from {a} to {b} {n} min ago. This can cause this alarm.", "आपने {n} मिनट पहले {x} को {a} से {b} किया। इससे यह अलार्म आ सकता है।"),
    setBack: T("Set {x} back to {a}", "{x} वापस {a} करें"), otherCauses: T("Other causes and checks", "दूसरे कारण और जाँच"),
    peepYou: T("You raised PEEP. High chest pressure lets less blood return to the heart, so BP falls. Lower PEEP.", "आपने PEEP ज़्यादा किया है। छाती के अंदर दबाव बढ़ने से खून दिल तक कम लौटता है, BP गिरता है। PEEP घटाएँ।"),
    lookFirst: T("Look at the patient first: is the chest moving, what colour is the skin, what does SpO2 show?", "पहले मरीज़ को देखें: छाती हिल रही है, त्वचा का रंग कैसा है, SpO2 क्या दिखा रहा है?"),
    a1_causes: T("What it means", "इसका मतलब"), a1_steps: T("What to try", "क्या करें"), a1_fix: T("Best fix", "सबसे सही कदम"),
    al_spo2Low: T("SpO2 below target", "SpO2 लक्ष्य से कम"), al_mapLow: T("Low blood pressure (MAP below 65)", "कम BP (MAP 65 से कम)"), al_hrHigh: T("Heart rate high", "दिल की धड़कन तेज़"), al_hrLow: T("Heart rate low", "दिल की धड़कन धीमी"),
    am_spo2Low: T("Oxygen in the blood is below the target for this patient. It stays on the bar until SpO2 recovers.", "खून में ऑक्सीजन इस मरीज़ के लक्ष्य से कम है। SpO2 सुधरने तक यह बार पर रहेगा।"),
    am_mapLow: T("The mean blood pressure is below 65. Organs get less blood. It stays on the bar until MAP recovers.", "औसत BP 65 से कम है। अंगों को कम खून मिलता है। MAP सुधरने तक यह बार पर रहेगा।"),
    am_hr: T("The heart rate is outside the safe range. Look for low oxygen, low pressure or pain.", "दिल की धड़कन सुरक्षित सीमा से बाहर है। कम ऑक्सीजन, कम BP या दर्द देखें।"),
    ams_spo2Low: T("Check the patient and the tube. Raise FiO2 first, then think about PEEP.", "मरीज़ और ट्यूब जाँचें। पहले FiO2 बढ़ाएँ, फिर PEEP के बारे में सोचें।"),
    ams_mapLow: T("Did you just raise PEEP or the rate? High chest pressure lowers BP. Check for air trapping and low fluid.", "क्या आपने अभी PEEP या rate बढ़ाया? छाती का ऊँचा दबाव BP घटाता है। हवा का फँसना और कम फ़्लूइड जाँचें।"),
    monStays: T("Monitor alarm: acknowledging does not clear it.", "मॉनिटर अलार्म: स्वीकार करने से यह हटता नहीं।"), acked: T("acknowledged", "स्वीकार"),
    holdI: T("Inspiratory hold", "इंस्पिरेटरी होल्ड"), holdE: T("Expiratory hold", "एक्सपिरेटरी होल्ड"), holdH: T("Holds and exam", "होल्ड और जाँच"),
    holdINote: T("Pauses at the end of a breath: shows the plateau, driving pressure and compliance.", "साँस के अंत में रुकता है: प्लेटो, ड्राइविंग प्रेशर और कंप्लायंस दिखाता है।"),
    holdENote: T("Pauses before the next breath: shows trapped pressure (auto-PEEP).", "अगली साँस से पहले रुकता है: फँसा दबाव (ऑटो-PEEP) दिखाता है।"),
    holdUnrel: T("The patient breathed during the hold, so there is no reliable number. Sedate, or wait for a quiet breath.", "Hold के दौरान मरीज़ ने साँस ली, इसलिए कोई भरोसेमंद संख्या नहीं। Sedation दें, या शांत साँस का इंतज़ार करें।"),
    holdRes: T("{x} at {t}", "{t} पर {x}"), needHold: T("needs a hold", "होल्ड चाहिए"), needHoldNote: T("The patient is breathing on their own, so plateau and compliance need an inspiratory hold to measure.", "मरीज़ ख़ुद साँस ले रहा है, इसलिए प्लेटो और कंप्लायंस मापने को इंस्पिरेटरी होल्ड चाहिए।"),
    exam: T("Listen to the chest", "छाती सुनें"), examH: T("Chest exam at {t}", "{t} पर छाती की जाँच"),
    ex_air: T("Air entry", "हवा का प्रवेश"), ex_trach: T("Trachea", "श्वासनली"), ex_sounds: T("Added sounds", "अतिरिक्त आवाज़ें"), ex_move: T("Chest movement", "छाती की हरकत"),
    exEqual: T("Equal on both sides", "दोनों तरफ़ बराबर"), exOneSide: T("Reduced on one side", "एक तरफ़ कम"), exMid: T("Central", "बीच में"), exShift: T("Pushed to one side", "एक तरफ़ खिसकी"),
    exWheeze: T("Wheeze on breathing out", "साँस छोड़ते समय सीटी (wheeze)"), exCrackles: T("Crackles", "कर्कश आवाज़ (crackles)"), exClear: T("None", "कोई नहीं"), exEven: T("Even, both sides rise", "बराबर, दोनों तरफ़ उठती है"),
    p3now: T("Now", "अभी"), p3without: T("In 30 min without your change (prediction)", "30 मिनट में, बिना आपके बदलाव (अनुमान)"), p3with: T("In 30 min with it (prediction)", "30 मिनट में, बदलाव के साथ (अनुमान)"),
    p3withoutS: T("30 min, no change", "30 मिनट, बिना बदलाव"), p3withS: T("30 min, with change", "30 मिनट, बदलाव के साथ"),
    p3without2: T("In 30 min without the change", "30 मिनट में, बिना बदलाव"),
    littleGain: T("Little to gain here: this change barely moves this patient.", "यहाँ ज़्यादा फ़ायदा नहीं: यह बदलाव इस मरीज़ को लगभग नहीं बदलता।"),
    moreDetail: T("More detail", "और जानकारी"),
    pl_setting: T("You set {x} from {a} to {b}.", "आपने {x} को {a} से {b} किया।"), pl_mode: T("You switched the mode from {a} to {b}.", "आपने मोड {a} से {b} किया।"),
    pl_ventUp: T("The machine now moves more air: {m} L a minute (was {w}).", "मशीन अब ज़्यादा हवा देती है: {m} L प्रति मिनट (पहले {w})।"),
    pl_ventDn: T("The machine now moves less air: {m} L a minute (was {w}).", "मशीन अब कम हवा देती है: {m} L प्रति मिनट (पहले {w})।"),
    pl_ventSame: T("The machine gives the same air each minute.", "मशीन हर मिनट उतनी ही हवा देती है।"),
    pl_mechUp: T("Each breath stretches the lung more.", "हर साँस फेफड़े को ज़्यादा खींचती है।"), pl_mechDn: T("Each breath stretches the lung less.", "हर साँस फेफड़े को कम खींचती है।"),
    pl_waveUp: T("The pressure trace peaks higher.", "प्रेशर ट्रेस ऊँचा जाता है।"), pl_waveDn: T("The pressure trace peaks lower.", "प्रेशर ट्रेस नीचा रहता है।"),
    pl_trap: T("Air is trapped: the flow trace no longer reaches zero.", "हवा फँस रही है: फ़्लो ट्रेस अब शून्य तक नहीं पहुँचता।"), pl_free: T("Trapped air is gone: flow reaches zero again.", "फँसी हवा निकल गई: फ़्लो फिर शून्य तक पहुँचता है।"),
    pl_monUp: T("In 30 min (prediction): SpO2 rises to {b}.", "30 मिनट में (अनुमान): SpO2 बढ़कर {b}।"), pl_monDn: T("In 30 min (prediction): SpO2 falls to {b}.", "30 मिनट में (अनुमान): SpO2 घटकर {b}।"), pl_monSame: T("In 30 min (prediction): SpO2 stays about {b}.", "30 मिनट में (अनुमान): SpO2 लगभग {b} रहता है।"),
    pl_co2Up: T("In 30 min (prediction): CO2 in the blood rises to {b}.", "30 मिनट में (अनुमान): खून में CO2 बढ़कर {b}।"), pl_co2Dn: T("In 30 min (prediction): CO2 in the blood falls to {b}.", "30 मिनट में (अनुमान): खून में CO2 घटकर {b}।"), pl_co2Same: T("In 30 min (prediction): CO2 in the blood stays about {b}.", "30 मिनट में (अनुमान): खून में CO2 लगभग {b} रहता है।"),
    pl_bpUp: T("Blood pressure rises: MAP {b}.", "BP बढ़ता है: MAP {b}।"), pl_bpDn: T("Blood pressure falls: MAP {b}.", "BP गिरता है: MAP {b}।"), pl_bpSame: T("Blood pressure stays about the same.", "BP लगभग वैसा ही रहता है।"),
    pl_gasSame: T("Oxygen in and CO2 out barely change.", "ऑक्सीजन अंदर और CO2 बाहर लगभग नहीं बदलते।"),
    driftH: T("Why is the patient changing?", "मरीज़ क्यों बदल रहा है?"),
    driftNone: T("You changed nothing, yet {x} in the last {m} min. The illness itself is moving the numbers.", "आपने कुछ नहीं बदला, फिर भी पिछले {m} मिनट में {x}। बीमारी ख़ुद संख्याएँ बदल रही है।"),
    dr_spo2: T("SpO2 went {a} to {b}", "SpO2 {a} से {b}"), dr_map: T("MAP went {a} to {b}", "MAP {a} से {b}"), dr_paco2: T("PaCO2 went {a} to {b}", "PaCO2 {a} से {b}"),
    pfVsS: T("SpO2 is how full the blood's oxygen carriers are (the monitor). PaO2 is the oxygen pressure in the blood (the blood gas).", "SpO2 बताता है खून के ऑक्सीजन वाहक कितने भरे हैं (मॉनिटर)। PaO2 खून में ऑक्सीजन का दबाव है (ब्लड गैस)।"),
    rrVs: T("Set rate {s}. The patient can add breaths of their own, so the total can be higher.", "तय दर {s}। मरीज़ अपनी साँसें जोड़ सकता है, इसलिए कुल ज़्यादा हो सकता है।"),
    dpDef: T("Plateau minus PEEP: the stretch on the open lung. Keep it 15 or less.", "प्लेटो माइनस PEEP: खुले फेफड़े पर खिंचाव। 15 या कम रखें।"),
    timeRun: T("running", "चल रहा"), timePause: T("paused", "रुका"), timeK: T("Time", "समय"),
    skipDone: T("Time moved on {x}: now {t}.", "समय {x} आगे बढ़ा: अब {t}।"), skipAlarm: T("The alarm is still active.", "अलार्म अभी भी सक्रिय है।"),
    dismiss: T("Dismiss", "हटाएँ"),
    mv_vc: T("VC: every breath is the machine's. The patient cannot trigger extra breaths.", "VC: हर साँस मशीन की है। मरीज़ अतिरिक्त साँस ट्रिगर नहीं कर सकता।"),
    mv_acvc: T("AC-VC: the same set breath, and the patient can trigger extra full breaths.", "AC-VC: वही तय साँस, और मरीज़ अतिरिक्त पूरी साँस ट्रिगर कर सकता है।"),
    mv_pc: T("PC: every breath is the machine's, at a set pressure.", "PC: हर साँस मशीन की, तय दबाव पर।"),
    mv_acpc: T("AC-PC: the same pressure breath, and the patient can trigger extra ones.", "AC-PC: वही दबाव वाली साँस, और मरीज़ अतिरिक्त ट्रिगर कर सकता है।"),
    arrestH: T("Cardiac arrest", "हृदय गति रुकना (cardiac arrest)"), arrestB: T("At {t} the patient arrested: {x}. In a real ICU this is a resuscitation call.", "{t} पर मरीज़ का हृदय रुक गया: {x}। असली ICU में यह पुनर्जीवन (resuscitation) कॉल है।"),
    arrestWhy: T("SpO2 {a}, MAP {b} for 2 min", "2 मिनट तक SpO2 {a}, MAP {b}"), arrestEnd: T("The run has ended. See the debrief for what led here.", "रन खत्म हुआ। यहाँ तक क्या ले गया, समीक्षा में देखें।"),
    arrestLast: T("Your last change: {x} at {t}.", "आपका पिछला बदलाव: {t} पर {x}।"),
    unsafeH: T("Unsafe moments", "असुरक्षित पल"), unsafeNone: T("No unsafe moments after the first 10 min.", "पहले 10 मिनट के बाद कोई असुरक्षित पल नहीं।"),
    us_spo2: T("SpO2 {v} at {t}", "{t} पर SpO2 {v}"), us_map: T("MAP {v} at {t}", "{t} पर MAP {v}"), us_pplat: T("Plateau {v} cmH2O at {t}", "{t} पर प्लेटो {v} cmH2O"),
    goodH: T("What a good run looked like", "अच्छा रन कैसा दिखता"), ownNotScored: T("patient's own (not scored)", "मरीज़ की अपनी (अंक नहीं)"),
    okHigh: T("met (above range on low FiO2 is fine)", "पूरा (कम FiO2 पर ऊपर ठीक है)"), weanO2: T("not met: wean FiO2", "पूरा नहीं: FiO2 घटाएँ"),
    px_mode: T("Points for the mode you chose. Untouched, the scenario's start mode counts.", "आपके चुने मोड के अंक। न बदला तो शुरुआती मोड गिना गया।"),
    px_initial: T("Your first settings judged on themselves: breath size for height, plateau and PEEP for the oxygen.", "आपकी पहली सेटिंग अपने आप में जाँची गई: ऊँचाई के हिसाब से साँस, प्लेटो, और ऑक्सीजन के लिए PEEP।"),
    px_oxygenation: T("Time SpO2 spent inside the target range.", "SpO2 कितना समय लक्ष्य के अंदर रहा।"), px_ventilation: T("Time pH and CO2 spent inside the target.", "pH और CO2 कितना समय लक्ष्य के अंदर रहे।"),
    px_protection: T("Plateau, driving pressure and breath size kept safe for the lung.", "प्लेटो, ड्राइविंग प्रेशर और साँस का आकार फेफड़े के लिए सुरक्षित रहे।"),
    px_alarms: T("Alarms you answered by a change or an action.", "जिन अलार्म का जवाब आपने बदलाव या काम से दिया।"), px_alarmsNone: T("No alarm occurred, so nothing to score here.", "कोई अलार्म नहीं आया, इसलिए यहाँ कुछ नहीं गिना गया।"),
    px_abg: T("Blood gases drawn at baseline or 15 min or more after a change.", "शुरुआत में या बदलाव के 15 मिनट या बाद ली गई ब्लड गैसें।"), px_abgNone: T("No blood gas was drawn.", "कोई ब्लड गैस नहीं ली गई।"),
    px_time: T("How quickly the patient reached the targets.", "मरीज़ कितनी जल्दी लक्ष्य तक पहुँचा।"),
    px_unsafe: T("Points lost for dangerous moments listed below.", "नीचे दिए ख़तरनाक पलों के लिए कटे अंक।"),
    keyH: T("Key points for this patient", "इस मरीज़ के मुख्य बिंदु"),
    vignette: T("The patient", "मरीज़"), caseSet: T("Current settings", "मौजूदा सेटिंग"), caseAns: T("The answer: {x}", "सही उत्तर: {x}"),
    caseNoSim: T("The simulated result appears when the lab can rebuild this case's patient.", "जब लैब इस केस का मरीज़ दोबारा बना सके, तब सिम्युलेटेड परिणाम दिखेगा।"),
    caseBefore: T("Case gas", "केस की गैस"), caseAfter: T("30 min after", "30 मिनट बाद"),
    tgt: T("target {a} to {b}", "लक्ष्य {a} से {b}"),
    tutsDone: T("{n} of {m} tutorials", "{m} में से {n} ट्यूटोरियल"), tutsN: T("{n} tutorials done", "{n} ट्यूटोरियल पूरे"),
    featLine: T("Ventilate a simulated patient. Tutorials, patients, blood gases and alarms.", "सिम्युलेटेड मरीज़ को वेंटिलेट करें। ट्यूटोरियल, मरीज़, ब्लड गैस और अलार्म।"),
    newT: T("New", "नया"), lvMine: T("Patient level {n}", "मरीज़ स्तर {n}"),
    goalsPlain: T("Keep oxygen saturation {a} to {b}%. Keep CO2 near normal. Keep each breath gentle.", "ऑक्सीजन सैचुरेशन {a} से {b}% रखें। CO2 सामान्य के पास रखें। हर साँस कोमल रखें।"),
    abnLow: T("low", "कम"), abnHigh: T("high", "ऊँचा"),
    // round 2: chest exam labels, alarm card, coach, tutorial runs, time, flags, debrief
    exl_airEntry: T("Air entry", "हवा का प्रवेश"), exl_trachea: T("Trachea", "श्वासनली (trachea)"), exl_wheeze: T("Wheeze", "सीटी (wheeze)"),
    exl_crackles: T("Crackles", "कर्कश आवाज़ (crackles)"), exl_chestRise: T("Chest rise", "छाती का उठना"), exLR: T("Left: {a}. Right: {b}.", "बाईं ओर: {a}। दाईं ओर: {b}।"),
    ex_ppeak: T("peak pressure (Ppeak)", "पीक प्रेशर (Ppeak)"), ex_ve: T("air per minute (VE)", "प्रति मिनट हवा (VE)"), ex_hco3: T("bicarbonate (HCO3)", "बाइकार्बोनेट (HCO3)"),
    went: T("{x} went {d}: {a} to {b}.", "{x} {d}: {a} से {b}।"),
    sawMove: T("You saw it: {x} went {d}, {a} to {b}.", "आपने देखा: {x} {d}, {a} से {b}।"),
    alreadyDid: T("You already did this at {t}. It counts.", "आपने यह {t} पर कर दिया था। यह गिना गया।"),
    showCtl: T("Show me the control", "कंट्रोल दिखाएँ"), openLim: T("Open alarm limits", "अलार्म सीमाएँ खोलें"), openBed: T("Open bedside actions", "बेडसाइड काम खोलें"),
    doNow: T("Do now, in this order", "अभी करें, इसी क्रम में"),
    ck_look: T("Look at the patient: is the chest moving, what colour is the skin, what does SpO2 show?", "मरीज़ को देखें: छाती हिल रही है, त्वचा का रंग कैसा है, SpO2 क्या दिखा रहा है?"),
    ck_bag: T("If SpO2 is falling or the patient is unstable: take them off the ventilator and bag with 100% oxygen.", "SpO2 गिर रहा हो या मरीज़ अस्थिर हो: ventilator हटाकर 100% oxygen से bag करें।"),
    ck_dope: T("Think DOPE: Displacement of the tube, Obstruction (suction it), Pneumothorax, Equipment and circuit.", "DOPE सोचें: tube का खिसकना (Displacement), रुकावट (Obstruction, suction करें), Pneumothorax, Equipment और circuit।"),
    ck_probe: T("Check the SpO2 probe and its trace, and the circuit from the wall to the tube.", "SpO2 probe और उसका trace जाँचें, और दीवार से tube तक circuit जाँचें।"),
    ck_senior: T("Call your senior now if SpO2 stays below 85 after bagging, MAP stays below 65, or you cannot find the cause.", "Bagging के बाद भी SpO2 85 से कम रहे, MAP 65 से कम रहे, या कारण न मिले, तो अभी senior को बुलाएँ।"),
    fio2Max: T("FiO2 is already 100%. The dial cannot give more oxygen: bag, suction, think DOPE and call your senior.", "FiO2 पहले से 100% है। Dial से और oxygen नहीं मिल सकती: bag करें, suction करें, DOPE सोचें और senior को बुलाएँ।"),
    fio2Hi: T("FiO2 is already {v}%. More oxygen buys time only: find the cause (DOPE) and think about PEEP with your senior.", "FiO2 पहले से {v}% है। और oxygen सिर्फ़ समय देती है: कारण ढूँढें (DOPE) और senior के साथ PEEP के बारे में सोचें।"),
    limBack: T("Set the alarm back to {a}", "अलार्म वापस {a} करें"), limNote: T("This hides the alarm. It does not fix the patient.", "यह अलार्म छिपाता है। मरीज़ को ठीक नहीं करता।"),
    limYou: T("You changed this alarm limit from {a} to {b} {n} min ago. The limit only decides when the alarm sounds.", "आपने {n} मिनट पहले यह अलार्म सीमा {a} से {b} की। सीमा सिर्फ़ तय करती है कि अलार्म कब बजे।"),
    tutDoneH: T("Tutorial done", "ट्यूटोरियल पूरा"), tutPractice: T("Tutorial done. This practice patient is not saved or scored. Open a patient from the lab home for a scored run.", "ट्यूटोरियल पूरा। यह अभ्यास वाला मरीज़ सहेजा या गिना नहीं जाता। गिने जाने वाले रन के लिए लैब होम से मरीज़ खोलें।"),
    tutRunNote: T("Practice run from a tutorial: not saved, not scored.", "ट्यूटोरियल से अभ्यास रन: सहेजा नहीं, गिना नहीं।"),
    timeStopped: T("Time is stopped while you read. Tap Time to run it.", "आप पढ़ रहे हैं, इसलिए समय रुका है। चलाने के लिए समय दबाएँ।"),
    noAlarms: T("No alarms", "कोई अलार्म नहीं"),
    perKgLine: T("{n} mL/kg PBW", "{n} mL/kg PBW"), perKgSafe: T("Safe band 6 to 8", "सुरक्षित दायरा 6 से 8"),
    scaleTo: T("{a} to {b}", "{a} से {b}"),
    vd_good: T("Helps", "मदद करता है"), vd_mix: T("Trade off", "फ़ायदा भी, नुकसान भी"), vd_bad: T("Makes it worse", "हालत बिगाड़ता है"), vd_none: T("Little change", "ख़ास बदलाव नहीं"),
    vdLine: T("in 30 min this {x}.", "30 मिनट में यह बदलाव {x}।"), vdNone: T("in 30 min SpO2, CO2 and blood pressure barely move for this patient.", "30 मिनट में इस मरीज़ का SpO2, CO2 और blood pressure लगभग नहीं बदलता।"),
    vdUp: T("raises {x} from {a} to {b}", "{x} को {a} से {b} करता है"), vdDn: T("lowers {x} from {a} to {b}", "{x} को {a} से {b} करता है"),
    vdPlat: T("pushes plateau pressure to {b}, above 30", "plateau pressure को {b} तक ले जाता है, 30 से ऊपर"), vdAnd: T(" and ", " और "),
    vdMap: T("blood pressure (MAP)", "blood pressure (MAP)"),
    band_mild: T("Mild:", "हल्की कमी:"), band_emergency: T("Emergency:", "Emergency:"),
    bandT_mild: T("SpO2 is below the goal but 88% or more. Look at the patient, check the probe trace, then raise FiO2 one step.", "SpO2 लक्ष्य से कम है पर 88% या ज़्यादा। मरीज़ को देखें, probe trace जाँचें, फिर FiO2 एक कदम बढ़ाएँ।"),
    bandT_emergency: T("SpO2 is below 88%. Hand bag with 100% oxygen, think DOPE and call your senior now.", "SpO2 88% से कम है। 100% oxygen से हाथ से bag करें, DOPE सोचें और अभी senior को बुलाएँ।"),
    o2Trend: T("Where SpO2 is heading", "SpO2 किधर जा रहा है"), unsafeBack: T("Why not set it back", "वापस क्यों नहीं"),
    interpH: T("Reading the gas", "गैस को पढ़ना"), stepByStep: T("Step by step", "क़दम दर क़दम"),
    worstH: T("Longest time off a goal", "किसी लक्ष्य से सबसे लंबा समय बाहर"), worstLine: T("{x}, from {a} to {b} min ({m} min).", "{x}, {a} से {b} मिनट तक ({m} मिनट)।"),
    wVe: T("Smaller breaths at this rate cut the air moved each minute by {p}% ({a} to {b} L/min). CO2 will rise.", "इस rate पर छोटी साँसें हर मिनट की हवा {p}% घटा देंगी ({a} से {b} L/min)। CO2 बढ़ेगा।"),
    rrPair: T("Also raise rate to {n} to keep minute air the same", "हर मिनट की हवा बराबर रखने के लिए rate भी {n} करें"),
    wRrHigh: T("Rate {v} is fast. Short breaths out can trap air. Check before you confirm.", "Rate {v} तेज़ है। छोटी साँस छोड़ने में हवा फँस सकती है। पक्का करने से पहले जाँचें।"),
    wVtLow: T("{v} mL is only {k} mL/kg PBW. Small breaths let CO2 rise: watch the pH and minute volume.", "{v} mL सिर्फ़ {k} mL/kg PBW है। छोटी साँसों से CO2 बढ़ सकती है: pH और minute volume देखें।"),
    wVtHigh: T("{v} mL is {k} mL/kg PBW, above the 6 to 8 band. Check before you confirm.", "{v} mL यानी {k} mL/kg PBW, 6 से 8 के दायरे से ऊपर। पक्का करने से पहले जाँचें।"),
    nFio2: T("FiO2 100% is for now, while you find the cause. Wean it as soon as SpO2 allows.", "FiO2 100% अभी के लिए है, जब तक कारण मिले। SpO2 ठीक होते ही घटाएँ।"),
    aboveTgt: T("above target", "लक्ष्य से ऊपर"), lowForFio2: T("low for the FiO2", "FiO2 के हिसाब से कम"),
    pl_mechPeep: T("The plateau rises with the PEEP, but each breath stretches the lung less.", "PEEP के साथ प्लेटो बढ़ता है, पर हर साँस फेफड़े को कम खींचती है।"),
    pl_mechPeepUp: T("The plateau rises with the PEEP. Each breath stretches the lung about the same.", "PEEP के साथ प्लेटो बढ़ता है। हर साँस फेफड़े को लगभग उतना ही खींचती है।"),
    missedAl: T("Missed: {x} at {t}. No change or bedside action within 5 min.", "छूटा: {t} पर {x}। 5 मिनट में कोई बदलाव या बेडसाइड काम नहीं।"),
    px_alarmsUnsc: T("Alarms sounded: {x}. None was cleared by your change or action, and none stayed 5 min unanswered. So this part was not scored.", "अलार्म बजे: {x}। कोई आपके बदलाव या काम से नहीं हटा, और कोई 5 मिनट बिना जवाब नहीं रहा। इसलिए यह हिस्सा नहीं गिना गया।"),
    px_alarmsNone2: T("No alarm sounded during this run, so nothing to score here.", "इस रन में कोई अलार्म नहीं बजा, इसलिए यहाँ कुछ नहीं गिना गया।"),
    atEndT: T("At the end ({t})", "अंत में ({t})"),
    draft: T("To be verified, draft", "सत्यापन बाकी, ड्राफ़्ट"),
    o2Why: T("Why is the oxygen low?", "ऑक्सीजन कम क्यों है?"), o2Call: T("Call your senior now.", "अभी senior को बुलाएँ।"),
    // Level 1 "why": one plain line per gas and direction; the engine's formulas wait under More detail (U9)
    wp_PaCO2_down: T("More air each minute washes more CO2 out of the blood.", "हर मिनट ज़्यादा हवा खून से ज़्यादा CO2 निकालती है।"),
    wp_PaCO2_up: T("Less air each minute leaves more CO2 in the blood.", "हर मिनट कम हवा से खून में ज़्यादा CO2 रहती है।"),
    wp_PaO2_up: T("More oxygen gets from the lungs into the blood.", "फेफड़ों से खून में ज़्यादा ऑक्सीजन पहुँचती है।"),
    wp_PaO2_down: T("Less oxygen gets from the lungs into the blood.", "फेफड़ों से खून में कम ऑक्सीजन पहुँचती है।"),
    wp_SaO2_up: T("More of the blood's oxygen carriers are full.", "खून के ज़्यादा ऑक्सीजन वाहक भरे हैं।"), wp_SaO2_down: T("Fewer of the blood's oxygen carriers are full.", "खून के कम ऑक्सीजन वाहक भरे हैं।"),
    wp_pH_up: T("Less CO2 makes the blood less acid.", "कम CO2 से खून कम अम्लीय होता है।"), wp_pH_down: T("More CO2 makes the blood more acid.", "ज़्यादा CO2 से खून ज़्यादा अम्लीय होता है।"),
    wp_HCO3_up: T("The body's buffer rises slowly to balance the acid.", "अम्ल को संतुलित करने के लिए शरीर का बफ़र धीरे बढ़ता है।"), wp_HCO3_down: T("The body's buffer falls slowly to balance the change.", "बदलाव को संतुलित करने के लिए शरीर का बफ़र धीरे घटता है।"),
    // round 5: the path card, the tutorial finish card, core and later tutorials, alarm and confirm safety
    pathH: T("Your path", "आपका रास्ता"), pathOf: T("{d} of {n} done", "{n} में से {d} पूरे"), pathNext: T("Next", "अगला"),
    pathTut: T("Tutorial", "ट्यूटोरियल"), pathGuide: T("Real ventilator guide", "असली ventilator गाइड"),
    p_bed: T("Walk up to the bed", "बेड तक जाना"), p_bedS: T("The first five minutes checklist", "पहले पाँच मिनट की checklist"),
    p_run: T("Run one patient to the debrief", "एक मरीज़ को समीक्षा तक चलाएँ"), p_runS: T("Start with {x}", "{x} से शुरू करें"), p_runD: T("Best score {b}", "सबसे अच्छा score {b}"),
    p_drills: T("Night drills", "रात की drills"), p_drillsS: T("What to do when the alarm sounds at 3 am", "रात 3 बजे alarm बजे तो क्या करें"),
    p_check: T("First-night check", "पहली रात की जाँच"), p_checkS: T("A short final quiz", "एक छोटा अंतिम quiz"),
    pathFin: T("Finish line: ready to start under supervision", "मंज़िल: निगरानी में शुरू करने को तैयार"),
    pathReady: T("Ready to start under supervision", "निगरानी में शुरू करने को तैयार"),
    pathReadyS: T("Never alone on day one: your senior still decides every change.", "पहले दिन कभी अकेले नहीं: हर बदलाव का फ़ैसला अब भी senior करता है।"),
    tagCore: T("Core", "ज़रूरी"), laterH: T("Later: {n} more tutorials", "बाद में: {n} और ट्यूटोरियल"),
    laterS: T("Open these after the core tutorials and one patient run.", "इन्हें ज़रूरी ट्यूटोरियल और एक मरीज़ रन के बाद खोलें।"),
    onTgt: T("Starts on target: little to fix", "शुरू से लक्ष्य पर: ठीक करने को कम"),
    finH: T("Tutorial done", "ट्यूटोरियल पूरा"), finDone: T("Done! You finished {x}.", "पूरा! आपने {x} पूरा किया।"),
    finNext: T("Next: {x}", "अगला: {x}"), finAll: T("Every step on your path is done.", "आपके रास्ते का हर कदम पूरा है।"),
    finNextT: T("Next tutorial", "अगला ट्यूटोरियल"), finGo: T("Go to the next step", "अगले कदम पर जाएँ"),
    finStay: T("Stay with this patient (practice, not scored)", "इसी मरीज़ के साथ रहें (अभ्यास, अंक नहीं)"),
    seniorTut: T("On a real patient, ask your senior before changing settings.", "असली मरीज़ पर settings बदलने से पहले अपने senior से पूछें।"),
    nxAl: T("Handle the alarm first: tap it to see what to do.", "पहले alarm सँभालें: क्या करना है, देखने के लिए उस पर दबाएँ।"),
    nx3b: T("Tap +30 min, then Draw ABG. Blood gases change slowly.", "+30 मिनट दबाएँ, फिर ABG लें। ब्लड गैस धीरे बदलती है।"),
    moreAl: T("{n} more alarms", "{n} और alarm"), moreAl1: T("1 more alarm", "1 और alarm"), reddest: T("look at the reddest first", "सबसे लाल वाला पहले देखें"),
    alAllNote: T("Reddest first. Tap one to see what to do.", "सबसे लाल पहले। क्या करना है, देखने के लिए किसी पर दबाएँ।"),
    alsoCo2: T("Also fix the CO2", "CO2 भी ठीक करें"), alsoThen: T("Then, once SpO2 is safe", "फिर, SpO2 सुरक्षित होने पर"),
    raiseFio2: T("Raise FiO2 to {v}%", "FiO2 {v}% करें"),
    noSil: T("Emergency: do not silence this alarm. Stay with the patient and call for help.", "Emergency: इस alarm को चुप न करें। मरीज़ के पास रहें और मदद बुलाएँ।"),
    wFio2Low: T("FiO2 {v}% on a patient who needs oxygen: SpO2 falls to about {s}% in 30 min.", "ऑक्सीजन चाहने वाले मरीज़ पर FiO2 {v}%: 30 मिनट में SpO2 लगभग {s}% तक गिरेगा।"),
    wFio2Drop: T("FiO2 {a}% to {b}% is a big drop. Lower it 5 to 10 at a time and watch SpO2.", "FiO2 {a}% से {b}% बड़ी गिरावट है। एक बार में 5 से 10 घटाएँ और SpO2 देखें।"),
    snrH: T("Only your senior orders this", "यह सिर्फ़ आपका senior तय करता है"),
    snrB: T("{x}: a junior doctor does not give this alone. In the lab it is logged as an unsafe step if it was not needed.", "{x}: junior doctor यह अकेले नहीं देता। Lab में ज़रूरत न हो तो यह असुरक्षित कदम के रूप में दर्ज होता है।"),
    snrCall: T("Call my senior instead", "इसके बजाय senior को बुलाएँ"), snrGo: T("Give it anyway", "फिर भी दें"),
    snrCalled: T("Good call. Tell your senior: the patient, the alarm, the numbers and what you have done.", "सही फ़ैसला। Senior को बताएँ: मरीज़, alarm, संख्याएँ और आपने क्या किया।"),
    caseCue: T("Read why, then answer Question 2 below.", "क्यों पढ़ें, फिर नीचे प्रश्न 2 का उत्तर दें।"),
    vdWrong: T("Does not fix it:", "इससे ठीक नहीं होता:"), vdOff: T("in 30 min {x} still off target.", "30 मिनट बाद भी {x} लक्ष्य से बाहर।"),
    predL: T("prediction", "अनुमान"), predIn: T("In {m} min (prediction):", "{m} मिनट में (अनुमान):"),
    driftMine: T("Your change is still working", "आपका बदलाव अभी असर कर रहा है"),
    noImprove: T("This patient started on target: nothing to improve here, so this run does not count as a best score. Practise the dials, or open a patient with something to fix.", "यह मरीज़ शुरू से लक्ष्य पर था: यहाँ सुधारने को कुछ नहीं, इसलिए यह रन सबसे अच्छे score में नहीं गिना जाता। Dials का अभ्यास करें, या ऐसा मरीज़ खोलें जिसमें कुछ ठीक करना हो।")
  };
  // Plain line for an engine reason: the engine's own `plain` when it gives one, else the table above, else its text.
  function plainWhy(x) {
    if (x.plain) return t(x.plain);
    var k = "wp_" + x.param + "_" + (x.direction === "down" ? "down" : "up");
    return STR[k] ? raw(k) : t(x.because);
  }
  // The bedside actions in a fixed order (never reordered by suggestion, so a hand learns where each one lives).
  // Clinical short names for the coach's live numbers (never an upper-cased key such as "PACO2")
  var NUM_LAB = { spo2: "SpO2", map: "MAP", sbp: "SBP", hr: "HR", paco2: "PaCO2", pao2: "PaO2", ph: "pH", hco3: "HCO3", sao2: "SaO2", etco2: "EtCO2", shunt: "Shunt", rr: "RR" };
  var BED_ORDER = ["reconnect", "suction", "bag100", "bronchodilator", "sedate", "paralyse", "fluid", "blood", "disconnect", "decompress"];
  // Alarm card defaults when the engine gives no bedside list for an alarm (E7): the bedside fix leads, never a limit.
  var CARD_ACTS = { pPeakHigh: ["suction", "bag100"], vtLow: ["suction", "bag100"], veLow: ["bag100", "suction"], apnoea: ["bag100"], spo2Low: ["bag100", "suction"], disconnect: ["bag100"], pPlatHigh: [], autoPeep: ["disconnect"] };
  var CARD_CK = { pPeakHigh: ["ck_look", "ck_bag", "ck_dope", "ck_senior"], vtLow: ["ck_look", "ck_bag", "ck_dope", "ck_senior"], veLow: ["ck_look", "ck_bag", "ck_dope", "ck_senior"],
    apnoea: ["ck_look", "ck_bag", "ck_dope", "ck_senior"], disconnect: ["ck_look", "ck_bag", "ck_dope", "ck_senior"], spo2Low: ["ck_look", "ck_bag", "ck_dope", "ck_probe", "ck_senior"], fio2Low: ["ck_look", "ck_probe", "ck_senior"] };
  var MODE_SHORT = { vc: "VC", acvc: "AC-VC", pc: "PC", acpc: "AC-PC", simv: "SIMV", psv: "PSV", cpap: "CPAP", prvc: "PRVC", niv: "NIV", aprv: "APRV" };
  var RO_UNIT = { pfRatio: "", shunt: "", vdvt: "", aaGradient: "mmHg", vte: "mL", ve: "L/min", ppeak: "cmH2O", pplat: "cmH2O", pmean: "cmH2O", peepTotal: "cmH2O", autoPeep: "cmH2O", drivingP: "cmH2O", cstat: "mL/cmH2O", raw: "cmH2O/L/s", rrTotal: "/min", ieActual: "", mechPower: "J/min", trapV: "mL", ineffective: "/min" };
  var RO_ORDER = ["ppeak", "pplat", "peepTotal", "vte", "ve", "rrTotal", "ineffective", "drivingP", "autoPeep", "trapV", "pmean", "cstat", "raw", "ieActual", "mechPower", "pfRatio", "shunt", "vdvt", "aaGradient"];
  var RO_DEFAULT = { 1: ["ppeak", "pplat", "peepTotal", "vte", "ve", "rrTotal"], 2: ["ppeak", "pplat", "peepTotal", "vte", "ve", "rrTotal", "drivingP", "cstat", "ieActual"],
    3: ["ppeak", "pplat", "peepTotal", "vte", "ve", "rrTotal", "ineffective", "drivingP", "autoPeep", "trapV", "cstat", "raw", "ieActual"], 4: RO_ORDER };
  var ALARM_KEYS = ["pPeakHigh", "veLow", "veHigh", "apnoea", "rrHigh", "fio2Low", "fio2High", "peepLow", "peepHigh"];
  var DYS_KINDS = ["doubleTrigger", "ineffectiveTrigger", "autoTrigger", "flowStarvation", "prematureCycle", "delayedCycle", "reverseTrigger"];
  // What-if moves a setting by a teaching-sized amount in its own units; others move four steps.
  var WI_DELTA = { fio2: 20, peep: 4, vt: 100, rr: 6, pinsp: 5, ps: 5, ti: 0.4, ipap: 4, epap: 3, phigh: 4, plow: 3, thigh: 1, tlow: 0.2, trigFlow: 2, cycle: 15 };
  var OX_KEYS = { fio2: 1, peep: 1, epap: 1, plow: 1, phigh: 1, ti: 1, thigh: 1 };

  function L() { return I.lang(); }
  function t(o) { return o == null ? "" : typeof o === "string" ? o : (o[L()] || o.en || ""); }
  function tx(o) { return o == null ? "" : typeof o === "string" ? esc(o) : I.tx(o); }
  function s(key, v) { return esc(t(STR[key])).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
  function raw(key, v) { return t(STR[key]).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? String(v[x]) : m; }); }
  function ico(n) { var i = I.ico(n); return i || ""; }
  // learn.json gloss: a plain meaning in brackets after a technical term's first use on a screen. English at Level 1,
  // Hindi at Level 1 and 2. Entry shapes: gloss[term] = {en, hi}, or {term: {en, hi}, gloss: {en, hi}}.
  var GL = { seen: {} };
  function glossReset() { GL.seen = {}; }
  function glossList() {
    var g = learn().gloss, n = lv();
    if (!g || typeof g !== "object" || (L() === "hi" ? n > 2 : n > 1)) return null;
    var sig = L() + n;
    if (GL.src === g && GL.sig === sig) return GL.list;
    GL.src = g; GL.sig = sig;
    GL.list = Object.keys(g).map(function (k) {
      var v = g[k] || {}, term = v.term ? t(v.term) : k.replace(/[-_]/g, " "), gl = v.gloss ? t(v.gloss) : t(v), w = /^[\w\s]+$/.test(term) ? "\\b" : "";
      return gl && term && typeof gl === "string" ? { k: k, term: term, gl: gl, re: new RegExp(w + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + w, "i") } : null;
    }).filter(Boolean).sort(function (a, b) { return b.term.length - a.term.length; });
    return GL.list;
  }
  function glossStr(str) {
    var list = glossList();
    if (!list || !str) return str;
    list.forEach(function (x) {
      if (GL.seen[x.k]) return;
      var m = x.re.exec(str);
      if (!m) return;
      var end = m.index + m[0].length, pre = str.slice(0, m.index);
      // never a gloss inside brackets that are already open: no nested brackets (round 5, U10)
      if ((pre.match(/\(/g) || []).length > (pre.match(/\)/g) || []).length) return;
      GL.seen[x.k] = 1;
      if (str.slice(end, end + 2) !== " (") str = str.slice(0, end) + " (" + x.gl + ")" + str.slice(end);
    });
    return str;
  }
  function txg(o) { return o == null ? "" : esc(glossStr(t(o))); }
  function txgS(str) { return esc(glossStr(str || "")); }
  function E() { return (G.NARKE_MODELS || {})["vent-engine"]; }
  function safe(fn, fb) { try { var r = fn(); return r == null ? fb : r; } catch (e) { return fb; } }
  function $(id) { return G.document.getElementById(id); }
  function q(sel) { var r = I.root(); return r ? r.querySelector(sel) : null; }
  function reduced() { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function fmtN(v) { return v == null || v === "" || (typeof v === "number" && isNaN(v)) ? "?" : typeof v === "number" ? I.fmt(v) : String(v); }
  function clockText(sec) { var p = clockParts(sec); return raw("clock", { h: p.h, m: (p.m < 10 ? "0" : "") + p.m }); }
  var MINUS = '<svg viewBox="0 0 24 24" class="smd-ico" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';
  var PLUS = '<svg viewBox="0 0 24 24" class="smd-ico" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>';
  function arrow(d) {
    if (!d) return '<span class="vl-arr same" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 8h10"/></svg></span>';
    return '<span class="vl-arr ' + (d > 0 ? "up" : "dn") + '" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="' + (d > 0 ? "M8 13V3M4 7l4-4 4 4" : "M8 3v10M4 9l4 4 4-4") + '"/></svg></span>';
  }

  /* ---------- content and preferences ---------- */
  var VL = { ready: null, scen: null, learn: null, err: null };
  function base() { return G.SMD_NARKE_VENT_BASE || I.BASE + "vent/"; }
  function getJ(p) { return G.fetch(base() + p).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  function load() {
    if (VL.ready) return VL.ready;
    VL.err = null;
    VL.ready = Promise.all([getJ("scenarios.json"), getJ("learn.json")]).then(function (a) {
      VL.scen = (a[0] && a[0].scenarios) || []; VL.learn = a[1] || {};
    }, function (e) { VL.ready = null; VL.err = e; throw e; });
    return VL.ready;
  }
  var PK = "smd_narke_vent";
  function prefs() {
    if (VL.p) return VL.p;
    var p = null;
    try { p = JSON.parse(I.ls().getItem(PK)); } catch (e) {}
    VL.p = p && typeof p === "object" ? p : {};
    if (!(VL.p.level >= 1 && VL.p.level <= 4)) VL.p.level = 1;
    VL.p.dys = VL.p.dys || {}; VL.p.cases = VL.p.cases || {}; VL.p.best = VL.p.best || {}; VL.p.tuts = VL.p.tuts || {};
    return VL.p;
  }
  function savePrefs() { try { I.ls().setItem(PK, JSON.stringify(VL.p)); } catch (e) {} }
  function lv() { return prefs().level; }
  function learn() { return VL.learn || {}; }
  function disc() { return tx(learn().disclaimer || STR.fallbackDisc); }
  // "Level 1: First breaths" -> "First breaths" (the number is drawn beside it).
  function lvName(n) { var x = (learn().levels || []).filter(function (l) { return l.n === n; })[0], v = x && x.title ? t(x.title) : raw("lv" + n); return v.indexOf(":") > 0 ? v.slice(v.indexOf(":") + 1).trim() : v; }
  function lvIntro(n) { var x = (learn().levels || []).filter(function (l) { return l.n === n; })[0]; return x && x.intro ? x.intro : null; }
  function scById(id) { return (VL.scen || []).filter(function (x) { return x.id === id; })[0] || null; }
  function setDef(k) { var e = E(); return e && e.SETTINGS && e.SETTINGS[k]; }
  function setLabel(k) { var d = setDef(k); return d ? t(d.label) : k; }
  function setUnit(k) { var d = setDef(k); return d && d.unit ? d.unit : ""; }
  function setText(k, v) {
    var d = setDef(k);
    if (d && d.options) return String(v);
    if (typeof v !== "number") return fmtN(v);
    return I.fmt(+v.toFixed(decs(d && d.step || 1)));
  }
  function modeShort(m) { return MODE_SHORT[m] || String(m || "").toUpperCase(); }
  function modeTitle(m) { var x = E() && E().MODES && E().MODES[m]; return (x ? t(x.title) : modeShort(m)).replace(/-/g, "\u2011"); }
  // Short-title rule for long engine titles ("Volume control (\u092a\u0942\u0930\u0940 \u0924\u0930\u0939 \u092e\u0936\u0940\u0928 \u0928\u093f\u092f\u0902\u0924\u094d\u0930\u093f\u0924)", "Assist control, volume (AC-VC): ..."):
  // head = the name without the mode's own abbreviation; note = the explanation after ":" or in a trailing bracket.
  // The mode button shows the head; the mode sheet shows head and note. Nothing is cut with an ellipsis.
  function modeParts(m) {
    var full = modeTitle(m), ab = modeShort(m).replace(/-/g, "\u2011"), head = full, note = "", i = full.indexOf(": ");
    if (i > 0) { head = full.slice(0, i); note = full.slice(i + 2); }
    head = head.replace(" (" + ab + ")", "");
    var br = /^(.*\S)\s*\(([^()]+)\)$/.exec(head);
    if (br && !note) { head = br[1]; note = br[2]; }
    if (head === ab && note) { head = note; note = ""; }
    return { head: head, note: note };
  }
  // The settings for a scenario: every engine default, then the scenario's start settings and mode.
  function baseSettings(sc) {
    var e = E(), o = {}, k, S = (e && e.SETTINGS) || {};
    var st0 = e && safe(function () { return e.init(clone(sc), null); }, null);
    if (st0 && st0.settings) return clone(st0.settings);
    for (k in S) if (Object.prototype.hasOwnProperty.call(S, k) && S[k]["default"] != null) o[k] = S[k]["default"];
    var ss = (sc.start && sc.start.settings) || {};
    for (k in ss) if (Object.prototype.hasOwnProperty.call(ss, k)) o[k] = ss[k];
    o.mode = (sc.start && sc.start.mode) || o.mode;
    return o;
  }
  // Settings shown at this level for this mode, in the mode's own order.
  // learn.json levels[].shows is cumulative and names settings and readouts; without it, the engine's own levels.
  function shows(n) { var x = (learn().levels || []).filter(function (l) { return l.n === n; })[0]; return x && x.shows ? x.shows : null; }
  function shown(k, n, lvDefault) { var sh = shows(n), d = setDef(k); if (sh) return sh.indexOf(k) >= 0 || tutKey(k); return d ? (d.level || lvDefault) <= n || tutKey(k) : false; }
  // A tutorial step can ask for a control above the learner's level; that control shows while the step needs it.
  function tutKey(k) { var sp = R && R.tut && R.tut.tu.steps[R.tut.i]; return !!(sp && sp.do && sp.do.key === k); }
  function visSettings(mode, n) {
    var e = E(), m = e && e.MODES && e.MODES[mode], ctl = (m && m.controls) || [];
    return ctl.filter(function (k) { return setDef(k) && k !== "ie" && shown(k, n, 1); });
  }
  function visAlarmKeys(n) { return ALARM_KEYS.filter(function (k) { return setDef(k) && shown(k, n, 3); }); }
  function visModes(n, cur) {
    var e = E(), sp = R && R.tut && R.tut.tu.steps[R.tut.i], want = sp && sp.do && sp.do.mode;
    return Object.keys((e && e.MODES) || {}).filter(function (m) { return (e.MODES[m].level || 1) <= n || m === cur || m === want; });
  }
  function visReadouts(n) {
    var sh = shows(n);
    if (!sh) return RO_DEFAULT[n] || RO_DEFAULT[1];
    // trapped volume sits next to auto-PEEP (Level 2+); missed breaths per minute from Level 3
    return RO_ORDER.filter(function (k) { return sh.indexOf(k) >= 0 || ((k === "peepTotal" || k === "trapV") && sh.indexOf("autoPeep") >= 0) || (k === "rrTotal" && sh.indexOf("ve") >= 0) || (k === "ineffective" && n >= 3); });
  }
  function ptPbw(sc) { return pbw(sc.patient.sex, sc.patient.heightCm); }
  function lungTags(sc) {
    var l = sc.lung || {}, out = [];
    if (l.c != null && l.c < 40) out.push("tStiff");
    if (l.r != null && l.r >= 18) out.push("tNarrow");
    if (l.flowLimited) out.push("tTrap");
    if (l.shunt != null && l.shunt >= 0.2) out.push("tShunt");
    return out.length ? out : ["tNormal"];
  }
  function gasAbg(g) { return g ? { pH: g.ph, PaCO2: g.paco2, PaO2: g.pao2, HCO3: g.hco3, SaO2: g.sao2, BE: g.be, lactate: g.lactate } : {}; }
  function roVal(r, key) {
    if (!r) return null;
    var groups = ["vitals", "vent", "gas"], i;
    for (i = 0; i < groups.length; i++) if (r[groups[i]] && r[groups[i]][key] != null) return r[groups[i]][key];
    return null;
  }

  /* ---------- waveform canvases ---------- */
  // Each plot: {cv, src: {p, v[]}, lo, hi, win (s), zero, marks: [{ph, k}], auto}. One rAF loop sweeps them all.
  var WV = { plots: [], raf: 0, t0: 0, frame: 0, still: false };
  function wvColor(p) { try { var cs = G.getComputedStyle(p.cv); p.color = cs.color; p.grid = cs.getPropertyValue("--vl-gridc").trim() || "rgba(128,128,128,.25)"; p.mut = cs.getPropertyValue("--vl-mutc").trim() || "#888"; p.plate = cs.getPropertyValue("--vl-plate").trim() || "#000"; p.warn = cs.getPropertyValue("--nk-warn").trim() || p.mut; p.font = cs.fontFamily; } catch (e) {} }
  function wvSize(p) {
    var r = p.cv.getBoundingClientRect(), d = Math.min(3, G.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (p.cv.width !== w || p.cv.height !== h) { p.cv.width = w; p.cv.height = h; }
    p.d = d; wvColor(p);
  }
  // Linear between samples (smooth traces); nearest sample for the ECG so its R peak keeps its height.
  function wvAt(src, time, near) {
    var f = (time % src.p) / src.p, n = src.v.length; if (f < 0) f += 1;
    var x = f * n, i = Math.floor(x) % n;
    if (near) return src.v[i];
    return src.v[i] + (src.v[(i + 1) % n] - src.v[i]) * (x - Math.floor(x));
  }
  function wvDraw(p, now) {
    var cv = p.cv, c = cv.getContext && cv.getContext("2d");
    if (!c || !p.src) return;
    var W = cv.width, H = cv.height, d = p.d || 1, pad = 4 * d, win = p.win, x, y, tt;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    function yOf(v) { return pad + (1 - (clamp(v, p.lo, p.hi) - p.lo) / (p.hi - p.lo)) * (H - 2 * pad); }
    // scale lines: hairlines snapped to device pixels, labelled in a left gutter the trace never enters
    var G0 = p.ticks ? 26 * d : 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (p.ticks) {
      c.font = (11 * d) + "px " + (p.font || "sans-serif"); c.textAlign = "right"; c.textBaseline = "middle";
      p.ticks.concat(p.zero ? [0] : []).forEach(function (v) {
        var ty = Math.round(yOf(v)) + 0.5;
        if (v !== 0) { c.strokeStyle = p.grid; c.lineWidth = 1; c.setLineDash([2 * d, 5 * d]); c.beginPath(); c.moveTo(G0, ty); c.lineTo(W, ty); c.stroke(); c.setLineDash([]); }
        c.fillStyle = p.mut; c.fillText(String(v), G0 - 5 * d, ty);
      });
      c.translate(G0, 0); W -= G0;
    }
    if (p.zero) { c.strokeStyle = p.grid; c.lineWidth = d; c.setLineDash([3 * d, 4 * d]); c.beginPath(); c.moveTo(0, yOf(0)); c.lineTo(W, yOf(0)); c.stroke(); c.setLineDash([]); }
    var sweepT = WV.still ? win : (now / 1000) % win, cyc = WV.still ? 0 : Math.floor((now / 1000) / win) * win;
    var head = sweepT / win * W, gap = 14 * d, step = (p.peak ? 1 : 2) * d, started = false, prevPh = null, marks = [];
    c.strokeStyle = p.color; c.lineWidth = 2 * d; c.lineJoin = "round"; c.lineCap = "round";
    var segs = [], seg = null, hx = null, hy = null;
    c.beginPath();
    for (x = 0; x <= W; x += step) {
      if (!WV.still && x > head && x < head + gap) { started = false; prevPh = null; continue; }
      tt = (x <= head ? cyc : cyc - win) + x / W * win;
      if (WV.still) tt = x / W * win;
      if (p.peak) { var v0 = wvAt(p.src, tt, 1), v1 = wvAt(p.src, tt + win * step / W / 2, 1), v2 = wvAt(p.src, tt - win * step / W / 2, 1); y = yOf(Math.abs(v1) > Math.abs(v0) ? (Math.abs(v2) > Math.abs(v1) ? v2 : v1) : Math.abs(v2) > Math.abs(v0) ? v2 : v0); }
      else y = yOf(wvAt(p.src, tt));
      if (!started) { c.moveTo(x, y); started = true; seg = [x, x]; segs.push(seg); } else { c.lineTo(x, y); seg[1] = x; }
      if (x <= head) { hx = x; hy = y; }
      if (p.marks && p.marks.length) {
        var ph = ((tt % p.src.p) + p.src.p) % p.src.p / p.src.p;
        if (prevPh != null) p.marks.forEach(function (m) { if ((prevPh <= m.ph && ph > m.ph) || (prevPh > ph && (m.ph >= prevPh || m.ph < ph))) marks.push({ x: x, y: y, k: m.k }); });
        prevPh = ph;
      }
    }
    c.stroke();
    if (WV.still && !started) return;
    // pressure: a faint fill down to zero under the trace (the area a learner reads as "the push")
    if (p.fill && segs.length) {
      c.save(); c.globalAlpha = 0.12; c.fillStyle = p.color; c.beginPath();
      segs.forEach(function (sg) {
        var xx, first = true;
        for (xx = sg[0]; xx <= sg[1] + 0.01; xx += step) { var t2 = WV.still ? xx / W * win : (xx <= head ? cyc : cyc - win) + xx / W * win, yy = yOf(wvAt(p.src, t2)); if (first) { c.moveTo(xx, yOf(0)); first = false; } c.lineTo(xx, yy); }
        c.lineTo(sg[1], yOf(0)); c.closePath();
      });
      c.fill(); c.restore();
    }
    // the sweep head: a small dot on the plate colour halo, so the eye finds where "now" is
    if (!WV.still && hx != null) { c.fillStyle = p.plate || "#000"; c.beginPath(); c.arc(hx, hy, 4.5 * d, 0, Math.PI * 2); c.fill(); c.fillStyle = p.color; c.beginPath(); c.arc(hx, hy, 2.5 * d, 0, Math.PI * 2); c.fill(); }
    marks.forEach(function (m) {
      c.fillStyle = m.k === "auto" ? p.warn || p.color : p.color;
      c.beginPath();
      if (m.k === "trig") { c.moveTo(m.x, H - pad); c.lineTo(m.x - 4 * d, H); c.lineTo(m.x + 4 * d, H); c.closePath(); c.fill(); }
      else if (m.k === "cyc") { c.save(); c.globalAlpha = 0.6; c.fillRect(m.x - d / 2, H - pad - 6 * d, d, 6 * d); c.restore(); }
      else { c.arc(m.x, m.y, 3.5 * d, 0, Math.PI * 2); c.fill(); }
      if (m.k === "auto" && p.autoLabel) { c.font = "600 " + (11 * d) + "px " + (p.font || "sans-serif"); c.textAlign = "right"; c.textBaseline = "top"; c.lineJoin = "round"; c.lineWidth = 3 * d; c.strokeStyle = p.plate || "#000"; c.strokeText(p.autoLabel, W - 4 * d, 2 * d); c.fillStyle = p.warn || p.mut; c.fillText(p.autoLabel, W - 4 * d, 2 * d); }
    });
  }
  function wvLoop(now) {
    WV.raf = 0;
    if (!WV.plots.length) return;
    WV.frame++;
    WV.plots.forEach(function (p) { if (WV.frame % 90 === 0) wvColor(p); wvDraw(p, now); });
    if (!WV.still) WV.raf = G.requestAnimationFrame(wvLoop);
  }
  function wvKick() {
    WV.still = reduced();
    if (WV.raf) { G.cancelAnimationFrame(WV.raf); WV.raf = 0; }
    if (!WV.plots.length) return;
    if (WV.still) { WV.plots.forEach(function (p) { wvDraw(p, 0); }); return; }
    WV.raf = G.requestAnimationFrame(wvLoop);
  }
  function wvStop() { if (WV.raf) G.cancelAnimationFrame(WV.raf); WV.raf = 0; WV.plots = []; }
  // Bind every canvas[data-w] under the root to a source from srcFor(name).
  function wvBind(srcFor) {
    wvStop();
    var r = I.root();
    [].forEach.call(r.querySelectorAll("canvas[data-w]"), function (cv) {
      var p = srcFor(cv.getAttribute("data-w"));
      if (!p) return;
      p.cv = cv; wvSize(p); WV.plots.push(p);
    });
    wvKick();
  }
  function wvUpdate(name, p) { WV.plots.forEach(function (x) { if (x.cv.getAttribute("data-w") === name) { for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) x[k] = p[k]; } }); if (WV.still) wvKick(); }
  if (G.addEventListener) {
    G.addEventListener("resize", function () { WV.plots.forEach(wvSize); if (WV.still) wvKick(); });
    // The host flips body.dark for the theme: re-read the channel colours at once, not on the next colour poll.
    try { new G.MutationObserver(function () { WV.plots.forEach(wvColor); if (WV.still) wvKick(); }).observe(G.document.body, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
    if (G.document.addEventListener) G.document.addEventListener("visibilitychange", function () { if (G.document.hidden) { if (WV.raf) G.cancelAnimationFrame(WV.raf); WV.raf = 0; } else wvKick(); });
  }
  // Breath arrays -> the three vent plots.
  function ventSources(b) {
    var n = 480, tp = table(b.t, b.paw, n), tf = table(b.t, b.flow, n), tv = table(b.t, b.vol, n);
    var pmax = 0, fmax = 0, vmax = 0;
    b.paw.forEach(function (v) { if (v > pmax) pmax = v; });
    b.flow.forEach(function (v) { if (Math.abs(v) > fmax) fmax = Math.abs(v); });
    b.vol.forEach(function (v) { if (v > vmax) vmax = v; });
    pmax = Math.max(30, Math.ceil((pmax + 4) / 10) * 10); fmax = Math.max(40, Math.ceil(fmax / 20) * 20); vmax = Math.max(600, Math.ceil(vmax / 100) * 100);
    var t0 = b.t[0], P = tp.p, marks = [];
    ((b.marks && b.marks.trigger) || []).forEach(function (x) { marks.push({ ph: ((x - t0) / P) % 1 + 0.0005, k: "trig" }); });
    ((b.marks && b.marks.cycle) || []).forEach(function (x) { marks.push({ ph: ((x - t0) / P) % 1, k: "cyc" }); });
    var endFlow = b.flow[b.flow.length - 1], trapped = endFlow < -1.5;
    // The sweep window holds whole breaths, so the last breath on screen is never cut at the right edge.
    var win = clamp(P * 2, 5, 14);
    if (b.t.length && b.marks && (b.events || []).length) win = clamp(P, 5, 14);
    win = Math.max(1, Math.round(win / P)) * P;
    // At most two scale lines per plot, on round steps, so short phone plots stay readable.
    function ticks(hi) { var steps = [10, 20, 50, 100, 200, 250, 500, 1000], i, o = [], v, stp = steps[steps.length - 1]; for (i = 0; i < steps.length; i++) if (Math.floor((hi - steps[i] * 0.4) / steps[i]) <= 2) { stp = steps[i]; break; } for (v = stp; v < hi - stp * 0.4; v += stp) o.push(v); return o; }
    return {
      paw: { src: tp, lo: 0, hi: pmax, win: win, marks: marks, ticks: ticks(pmax), fill: true },
      flow: { src: tf, lo: -fmax, hi: fmax, win: win, zero: true, marks: trapped ? [{ ph: 0.995, k: "auto" }] : [], autoLabel: trapped ? raw("mkAuto") : "", ticks: [fmax / 2, -fmax / 2] },
      vol: { src: tv, lo: 0, hi: vmax, win: win, ticks: ticks(vmax) },
      scale: { paw: pmax, flow: fmax, vol: vmax }, trapped: trapped, trig: ((b.marks && b.marks.trigger) || []).length > 0
    };
  }
  function monSources(v, rr, slow, ti) {
    var hr = Math.max(20, v.hr || 70), per = 60 / hr, br = 60 / Math.max(4, rr || 12);
    var insp = clamp((ti || 1) / br, 0.15, 0.6);
    return {
      ecg: { src: fnTable(ecgShape, per, 600), lo: -0.35, hi: 1.1, win: 4, peak: true },
      pleth: { src: fnTable(plethShape, per, 400), lo: -0.05, hi: 1.1 + (100 - Math.min(100, v.spo2 || 98)) / 60, win: 4 },
      capno: { src: fnTable(capnoShape(insp, slow), br, 400), lo: -0.05, hi: Math.max(1.05, 50 / Math.max(5, v.etco2 || 35)), win: Math.max(1, Math.round(clamp(br * 3, 8, 24) / br)) * br }
    };
  }

  /* ---------- sheet (bottom sheet on phones, dialog on wide screens) ---------- */
  var SH = { el: null, prevBack: null, ret: null };
  function setInert(on) {
    var r = I.root();
    [].forEach.call(r.querySelectorAll(":scope > .sp-top, :scope > .sp-scroll, :scope > .sp-foot, :scope > .vl-alarms, :scope > .vl-bagw, :scope > .vl-coach, :scope > .vl-toast"), function (n) {
      if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert");
    });
  }
  // trigger: the control that opened the sheet; focus returns there on close (Safari does not focus clicked buttons).
  function sheet(title, body, foot, trigger) {
    var prev = SH.el ? SH.ret : null;
    closeSheet(true);
    var r = I.root(), w = G.document.createElement("div");
    glossReset();
    SH.ret = trigger || prev || G.document.activeElement;
    w.className = "vl-sheet-wrap";
    w.innerHTML = '<div class="vl-scrim" data-act="vlsheetx"></div><div class="vl-sheet" role="dialog" aria-modal="true" aria-labelledby="vlShH">' +
      '<div class="vl-grab" aria-hidden="true"></div><div class="vl-sheet-h"><h2 id="vlShH" tabindex="-1">' + title + '</h2><button type="button" class="sp-icon vl-x" data-act="vlsheetx" aria-label="' + s("close") + '">' + (ico("close") || "x") + "</button></div>" +
      '<div class="vl-sheet-b">' + body + "</div>" + (foot ? '<div class="vl-sheet-f">' + foot + "</div>" : "") + "</div>";
    r.appendChild(w);
    SH.el = w;
    setInert(true);
    SH.prevBack = st.onBack;
    st.onBack = function () { closeSheet(); return true; };
    try { w.querySelector("#vlShH").focus({ preventScroll: true }); } catch (e) {}
    G.requestAnimationFrame(function () { if (SH.el === w) w.classList.add("on"); });
    sheetDrag(w);
  }
  // Phone: drag the sheet down by its grabber or title bar, 1:1; let go past 30 % of its height or with a flick
  // (> 0.11 px/ms) and it closes from where it is; otherwise it springs back. Upward drags meet a rubber band.
  function sheetDrag(w) {
    var el = w.querySelector(".vl-sheet"), D = null;
    if (!el || !G.PointerEvent) return;
    function onDown(e) {
      if (D || !isPhone() || e.button > 0 || (e.target.closest && e.target.closest("button"))) return;
      D = { id: e.pointerId, y0: e.clientY, t0: Date.now(), dy: 0, last: [{ y: e.clientY, t: Date.now() }] };
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      el.style.transition = "none";
    }
    function onMove(e) {
      if (!D || e.pointerId !== D.id) return;
      var dy = e.clientY - D.y0;
      D.dy = dy;
      D.last.push({ y: e.clientY, t: Date.now() }); if (D.last.length > 5) D.last.shift();
      var shown = dy >= 0 ? dy : -(Math.abs(dy) * 0.55 * 40) / (40 + 0.55 * Math.abs(dy));
      el.style.transform = "translateY(" + shown.toFixed(1) + "px)";
    }
    function onUp(e) {
      if (!D || e.pointerId !== D.id) return;
      var a = D.last[0], b = D.last[D.last.length - 1], v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0, h = el.offsetHeight || 1, dy = D.dy;
      D = null;
      el.style.transition = "";
      if (dy > h * 0.3 || (v > 0.11 && dy > 8)) {
        el.style.transition = "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "translateY(100%)";
        closeSheet();
      } else el.style.transform = "";
    }
    var hd = w.querySelectorAll(".vl-grab, .vl-sheet-h");
    [].forEach.call(hd, function (n) { n.addEventListener("pointerdown", onDown); });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }
  function closeSheet(quiet) {
    if (!SH.el) return;
    var w = SH.el;
    SH.el = null;
    st.onBack = SH.prevBack; SH.prevBack = null;
    setInert(false);
    if (reduced() || quiet) { if (w.parentNode) w.parentNode.removeChild(w); }
    else { w.classList.remove("on"); w.classList.add("out"); G.setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); }, 200); }
    if (!quiet) try { if (SH.ret && SH.ret.focus && G.document.contains(SH.ret)) SH.ret.focus({ preventScroll: true }); } catch (e) {}
  }
  A.vlsheetx = function () { closeSheet(); };

  /* ---------- toast and status ---------- */
  var TO = { tm: 0 };
  // A card floating at the bottom of the page, just above the coach or the footer: it never moves the layout and never
  // covers the first card under the tabs (round 4, U1). The page's top is where the eye lands after a tab switch.
  function toastPlace(el) {
    var r = I.root(), co = $("vlCoach"), ft = $("vlFoot"), dock = co && co.offsetHeight && G.getComputedStyle(co).position !== "absolute" ? co : ft;
    if (!r || !dock) return;
    el.style.top = "auto";
    el.style.bottom = Math.round(r.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 8) + "px";
  }
  // ~3 s on screen (longer lines a little longer, at most 5 s); the timer pauses while the card has focus or a finger
  // or pointer rests on it, and restarts when it leaves.
  function toastMs(el) { var n = (el.textContent || "").length; return n > 90 ? Math.min(5000, 3000 + (n - 90) * 25) : 3000; }
  function toastArm(el, ms) { G.clearTimeout(TO.tm); TO.tm = G.setTimeout(function () { if (!TO.hold) el.classList.remove("on"); }, ms); }
  function toastBind(el) {
    if (el._vlb) return; el._vlb = 1;
    function hold() { TO.hold = true; G.clearTimeout(TO.tm); }
    function rel() { TO.hold = false; if (el.classList.contains("on")) toastArm(el, 2000); }
    el.addEventListener("focusin", hold); el.addEventListener("pointerenter", hold);
    el.addEventListener("focusout", function (e) { if (!el.contains(e.relatedTarget)) rel(); }); el.addEventListener("pointerleave", rel);
    // the footer grows with Confirm and its warnings, the coach folds and unfolds: the card stays docked above them
    try { var ro = new G.ResizeObserver(function () { if (el.classList.contains("on")) toastPlace(el); }); [$("vlFoot"), $("vlCoach")].forEach(function (n) { if (n) ro.observe(n); }); } catch (e) {}
  }
  function toast(kind, html) {
    var el = q(".vl-toast");
    if (!el) return;
    // a hint never replaces an event the learner caused in the last 4 s (their bedside action's result stays readable)
    if (kind === "hint" && TO.kind === "event" && el.classList.contains("on") && Date.now() - TO.at < 4000) return;
    // phone, inside a tutorial: the coach already shows what the learner did and saw; no card over the monitor (U6)
    if (R && R.tut && isPhone() && $("vlCoach")) return;
    TO.kind = kind; TO.at = Date.now(); TO.hold = false;
    toastBind(el); toastPlace(el);
    el.innerHTML = '<span class="vl-toast-k">' + (ico(kind === "hint" ? "spark" : "info")) + "<b>" + s(kind === "hint" ? "hint" : "event") + '</b></span><span class="vl-toast-m">' + html + "</span>" +
      '<button type="button" class="vl-toast-x" data-act="vltoastx" aria-label="' + s("dismiss") + '">' + (ico("close") || "x") + "</button>";
    el.classList.add("on");
    toastArm(el, toastMs(el));
  }
  A.vltoastx = function () { var el = q(".vl-toast"); G.clearTimeout(TO.tm); TO.hold = false; if (el) el.classList.remove("on"); var n = q(".vl-tabs [aria-pressed=true]") || q(".vl-mode"); if (n) n.focus({ preventScroll: true }); };
  // Scroll only the screen's own scroller (scrollIntoView can also pan the page's visual viewport on phones).
  function scrollTo(el, center) {
    var sc = q(".sp-scroll");
    if (!sc || !el) return;
    var r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    // on a phone the sticky tab bar covers the top of the scroller: land below it, not under it
    var tb = q(".vl-tabbar"), off = tb && tb.offsetHeight && sc.contains(tb) ? tb.offsetHeight : 0;
    var top = sc.scrollTop + r.top - b.top - (center ? Math.max(12 + off, (b.height - r.height) / 2) : off + 12);
    try { sc.scrollTo({ top: Math.max(0, top), behavior: reduced() ? "auto" : "smooth" }); } catch (e) { sc.scrollTop = Math.max(0, top); }
  }
  function say(txt) { var el = $("vlSay"); if (el) { el.textContent = ""; G.setTimeout(function () { el.textContent = txt; }, 30); } }

  /* ================= lab home ================= */
  function home(focusSel) {
    var e = E();
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-home"; st.again = home;
    if (!VL.scen) {
      I.paint(I.top(t(STR.backTest), s("title"), s("sub"), I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col">' +
        (VL.err ? '<div class="sp-err" role="alert"><p>' + s("loadErr") + '</p><button type="button" class="sp-btn pri" data-act="vlretry">' + ico("refresh") + " " + s("retry") + "</button></div>"
          : '<div class="sp-loading" aria-busy="true"><span class="sp-sk sp-sk-a"></span><span class="sp-sk sp-sk-b"></span><span class="sp-sk sp-sk-c"></span><span class="sp-sr" role="status">' + s("loading") + "</span></div>") + "</div></div>");
      if (!VL.err) load().then(function () { if (st.view === "vl-home") home(); }, function () { if (st.view === "vl-home") home("[data-act=vlretry]"); });
      return;
    }
    glossReset();
    var n = lv(), all = VL.scen.slice().sort(function (a, b) { return (a.level || 1) - (b.level || 1); });
    var open = all.filter(function (x) { return (x.level || 1) <= n; }), more = all.length - open.length;
    // Levels 1 and 2: a patient with something to fix comes before one who starts on target (round 5, U3)
    if (n <= 2) open.sort(function (a, b) { return (a.level || 1) - (b.level || 1) || (fixCache(b) ? 1 : 0) - (fixCache(a) ? 1 : 0); });
    var seg = [1, 2, 3, 4].map(function (k) {
      return '<button type="button" data-act="vllevel" data-v="' + k + '" aria-pressed="' + (k === n) + '"><b>' + k + "</b><span>" + esc(lvName(k)) + "</span></button>";
    }).join("");
    var intro = lvIntro(n);
    var cards = open.map(function (sc) { return scCard(sc, e); }).join("");
    var tl = learn().tutorials || [], td = prefs().tuts, beg = n <= 2;
    // Levels 1 and 2: the core tutorials carry a "Core" tag; tutorials above the level fold under "Later" (round 5, U3).
    function tutRow(tu) {
      var right = (beg && tu.core ? '<span class="vl-core">' + s("tagCore") + "</span>" : "") + (td[tu.id] ? '<span class="vl-tdone">' + (ico("check") || "") + '<span class="sp-sr">' + s("done") + "</span></span>" : "");
      return I.row("vltut", ' data-k="' + esc(tu.id) + '"', I.tile("play"), tx(tu.title), s("steps", { n: (tu.steps || []).length }), right);
    }
    var nowT = beg ? tl.filter(function (tu) { return (tu.level || 1) <= n; }) : tl, laterT = beg ? tl.filter(function (tu) { return nowT.indexOf(tu) < 0; }) : [];
    var tutBlock = tl.length ? '<h2 class="sp-h2">' + s("guided") + '</h2><ul class="sp-rows vl-tuts">' + nowT.map(tutRow).join("") + "</ul>" +
      (laterT.length ? '<details class="vl-later"><summary><span class="vl-later-t">' + s("laterH", { n: laterT.length }) + '</span><span class="vl-later-s">' + s("laterS") + '</span></summary><ul class="sp-rows vl-tuts">' + laterT.map(tutRow).join("") + "</ul></details>" : "") : "";
    var nd = Object.keys(learn().dyssync || {}).filter(function (k) { return DYS_KINDS.indexOf(k) >= 0; });
    var solved = nd.filter(function (k) { return prefs().dys[k]; }).length;
    var prac = I.row("vlwhat", "", I.tile("sliders"), s("whatIf"), s("whatIfSub"), "") +
      ((learn().cases || []).length ? I.row("vlcases", "", I.tile("abg"), s("cases"), s("casesSub"), s("nCases", { n: caseList().length })) : "") +
      (nd.length ? I.row("vldys", "", I.tile("pulse"), s("dys"), s("dysSub"), s("nPatterns", { n: nd.length, s: solved })) : "");
    // real-ventilator bridge (narke-vent-bridge.js): directly under the path at Levels 1 and 2 (round 5, U1)
    var bridge = vb("homeBlock") ? vb("homeBlock").homeBlock(n) : "";
    I.paint(I.top(t(STR.backTest), s("title"), s("sub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="vl-wrap vl-home">' +
      '<p class="vl-lede">' + s("lede") + "</p>" +
      '<p class="vl-disc" role="note">' + (ico("info") ? '<span aria-hidden="true">' + ico("info") + "</span>" : "") + "<span>" + disc() + ' <span class="vl-draft">' + s("draft") + ".</span></span></p>" +
      '<h2 class="sp-h2" id="vlLvH">' + s("level") + '</h2><div class="vl-levels" role="group" aria-labelledby="vlLvH">' + seg + "</div>" +
      (intro ? '<p class="vl-lvintro">' + tx(intro) + "</p>" : "") +
      (beg ? pathHtml() + bridge + tutBlock : "") +
      '<h2 class="sp-h2">' + s("patients") + '</h2><ul class="vl-cards">' + cards + "</ul>" +
      (more > 0 ? '<p class="sp-small vl-more">' + s("morePts", { n: more }) + "</p>" : "") +
      (beg ? "" : tutBlock + bridge) +
      '<h2 class="sp-h2">' + s("practise") + '</h2><ul class="sp-rows">' + prac + "</ul>" +
      "</div></div>", typeof focusSel === "string" ? focusSel : null);
  }
  /* ---- "Your path" (round 5, U1): the core steps of a first night, ticked in order, with a finish line ---- */
  // The real-ventilator bridge (narke-vent-bridge.js), guarded: its rows (homeBlock(level)) and its own pages' progress
  // (progress(): {items: [{id, done}]}). Without progress the bridge steps still open, but cannot tick (the finish line waits).
  function vb(k) { return G.NARKE_VENT_BRIDGE && typeof G.NARKE_VENT_BRIDGE[k] === "function" ? G.NARKE_VENT_BRIDGE : null; }
  var PATH_BR = { bed: ["bed"], drills: ["drills", "drill"], check: ["check", "firstNight", "first-night", "quiz", "final", "fnc"] };
  function bridgeProg() {
    var B = vb("progress"), p = B ? safe(function () { return B.progress(); }, null) : null;
    return p && p.items && p.items.length ? p : null;
  }
  // A patient who starts outside a target has something to fix; one already on target is listed after (U3).
  function needsFix(sc) {
    var e = E(), r = safe(function () { var s0 = e.init(clone(sc), null); return e.readout(s0, s0.settings || baseSettings(sc)); }, null);
    if (!r) return true;
    var g = sc.goals || {}, v = r.vitals || {}, gs = r.gas || {}, w = r.vent || {}, kg = ptPbw(sc), set = baseSettings(sc);
    return !!((g.spo2 && v.spo2 != null && (v.spo2 < g.spo2[0] || (v.spo2 > g.spo2[1] && set.fio2 > 50))) ||
      (g.paco2 && gs.paco2 != null && (gs.paco2 < g.paco2[0] - 3 || gs.paco2 > g.paco2[1] + 3)) || (g.ph && gs.ph != null && (gs.ph < g.ph[0] || gs.ph > g.ph[1])) ||
      (w.pplat != null && w.pplat > (g.pplatMax || 30)) || (VOL_MODES[set.mode] && g.vtPerKg && set.vt / kg > g.vtPerKg[1] + 0.5) || (v.map != null && v.map < 65));
  }
  function fixCache(sc) { VL.fix = VL.fix || {}; if (VL.fix[sc.id] == null) VL.fix[sc.id] = needsFix(sc); return VL.fix[sc.id]; }
  function firstPatient() { var o = (VL.scen || []).filter(function (x) { return (x.level || 1) <= lv(); }); return o.filter(fixCache)[0] || o[0] || null; }
  function pathSteps() {
    var td = prefs().tuts, prog = bridgeProg(), out = [], best = prefs().best || {}, bk = Object.keys(best);
    (learn().tutorials || []).filter(function (tu) { return tu.core; }).forEach(function (tu) { out.push({ k: "t:" + tu.id, title: tx(tu.title), sub: s("pathTut"), done: !!td[tu.id] }); });
    function br(k) {
      var it = prog ? prog.items.filter(function (x) { return PATH_BR[k].indexOf(x.id) >= 0; })[0] : null;
      if (prog && !it && k === "check") return; // the bridge has no final check yet: the path does not wait for it
      out.push({ k: "b:" + (it ? it.id : k), title: s("p_" + k), sub: s("p_" + k + "S"), done: !!(it && it.done), br: true, open: !!it });
    }
    br("bed");
    var fp = firstPatient(), bs = bk.reduce(function (m, id) { return Math.max(m, best[id] || 0); }, 0);
    out.push({ k: "run", title: s("p_run"), sub: bk.length ? s("p_runD", { b: bs }) : fp ? s("p_runS", { x: t(fp.title) }) : "", done: bk.length > 0 });
    br("drills"); br("check");
    return { steps: out, prog: !!prog };
  }
  function pathNext(P) { return P.steps.filter(function (x) { return !x.done; })[0] || null; }
  function pathHtml() {
    var P = pathSteps(), st0 = P.steps, d = st0.filter(function (x) { return x.done; }).length, nx = pathNext(P), ready = !nx && P.prog;
    var rows = st0.map(function (x, i) {
      var isN = x === nx;
      return '<li class="' + (x.done ? "done" : isN ? "next" : "") + '"><button type="button" class="vl-pstep" data-act="vlpath" data-k="' + esc(x.k) + '"' + (isN ? ' aria-current="step"' : "") + ">" +
        '<span class="vl-pnum" aria-hidden="true">' + (x.done ? ico("check") || "" : i + 1) + "</span>" +
        '<span class="vl-pb"><b>' + x.title + "</b>" + (x.sub ? "<small>" + x.sub + "</small>" : "") + "</span>" +
        (x.done ? '<span class="sp-sr">' + s("done") + "</span>" : isN ? '<span class="vl-pnx">' + s("pathNext") + "</span>" : "") +
        '<span class="vl-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
    }).join("");
    return '<section class="vl-path' + (ready ? " ready" : "") + '" aria-labelledby="vlPathH"><div class="vl-path-h"><h2 class="sp-h2" id="vlPathH">' + s("pathH") + '</h2><span class="vl-path-n">' + s("pathOf", { d: d, n: st0.length }) + "</span></div>" +
      '<div class="vl-path-bar" aria-hidden="true"><i style="transform:scaleX(' + (d / (st0.length || 1)).toFixed(3) + ')"></i></div>' +
      '<ol class="vl-path-l">' + rows + "</ol>" +
      '<p class="vl-path-fin" role="note">' + (ico("flag") ? '<span aria-hidden="true">' + ico(ready ? "check" : "flag") + "</span>" : "") + "<span>" + (ready ? "<b>" + s("pathReady") + "</b> " + s("pathReadyS") : s("pathFin")) + "</span></p></section>";
  }
  function goPath(k) {
    if (!k) return home();
    if (k.indexOf("t:") === 0) return A.vltut({ getAttribute: function () { return k.slice(2); } });
    if (k === "run") { var fp = firstPatient(); if (fp) return A.vlgo({ getAttribute: function () { return fp.id; } }); return home(); }
    if (k.indexOf("b:") === 0 && A.vbopen) { closeSheet(true); return A.vbopen({ getAttribute: function () { return k.slice(2); } }); }
    home();
  }
  A.vlpath = function (b) { goPath(b.getAttribute("data-k")); };
  function miniTrace(sc, e) {
    var b = safe(function () { var st0 = e.init(sc); return e.breath(st0, baseSettings(sc), 60); }, null);
    if (!b || !b.t || b.t.length < 2) return "";
    var tp = table(b.t, b.paw, 60), tf = table(b.t, b.flow, 60), pm = 0, fm = 0;
    tp.v.forEach(function (v) { pm = Math.max(pm, v); }); tf.v.forEach(function (v) { fm = Math.max(fm, Math.abs(v)); });
    pm = Math.max(30, pm + 4); fm = Math.max(30, fm);
    function path(arr, lo, hi, y0, h) {
      var d = "", i, n = arr.length * 2;
      for (i = 0; i < n; i++) d += (i ? "L" : "M") + (i * 120 / (n - 1)).toFixed(1) + " " + (y0 + h - (clamp(arr[i % arr.length], lo, hi) - lo) / (hi - lo) * h).toFixed(1);
      return d;
    }
    return '<svg class="vl-mini" viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line class="vl-mini-z" x1="0" x2="120" y1="45" y2="45"/>' +
      '<path class="vl-mini-p" d="' + path(tp.v, 0, pm, 3, 24) + '"/><path class="vl-mini-f" d="' + path(tf.v, -fm, fm, 31, 28) + '"/></svg>';
  }
  function scCard(sc, e) {
    var p = sc.patient || {}, sv = savedRuns()[sc.id];
    var tags = lungTags(sc).map(function (k) { return '<span class="vl-tag2">' + s(k) + "</span>"; }).join("") + (lv() <= 2 && !fixCache(sc) ? '<span class="vl-tag2 vl-ontgt">' + s("onTgt") + "</span>" : "");
    return '<li><button type="button" class="vl-card vl-sc" data-act="vlgo" data-s="' + esc(sc.id) + '">' +
      '<span class="vl-sc-plate">' + miniTrace(sc, e) + "</span>" +
      '<span class="vl-sc-b"><span class="vl-sc-top"><b>' + tx(sc.title) + '</b><span class="vl-lvb">' + s("lvN", { n: sc.level || 1 }) + "</span></span>" +
      '<span class="vl-sc-who">' + s(p.sex === "F" ? "female" : "male") + ", " + s("yrs", { n: p.age }) + " · " + esc(fmtN(p.heightCm)) + " cm · " + esc(fmtN(p.weightKg)) + " kg · " + s("pbw") + " " + esc(fmtN(ptPbw(sc))) + " kg</span>" +
      '<span class="vl-sc-dx">' + tx(p.diagnosis) + "</span>" +
      '<span class="vl-tags">' + tags + "</span>" + (sv && sv.s ? '<span class="vl-resume">' + s("resumeAt", { t: clockText(sv.s.t) }) + "</span>" : "") + "</span></button>" +
      (sv && sv.s ? '<button type="button" class="vl-fresh" data-act="vlfresh" data-s="' + esc(sc.id) + '">' + s("startOver") + "</button>" : "") + "</li>";
  }
  A.vllevel = function (b) { var v = +b.getAttribute("data-v"); if (v === lv()) return; prefs().level = v; savePrefs(); if (st.view === "vl-run") return run('[data-act=vllevel][data-v="' + v + '"]'); home('[data-act=vllevel][data-v="' + v + '"]'); };
  A.vlretry = function () { VL.err = null; home(); };
  A.vlgo = function (b) { var sc = scById(b.getAttribute("data-s")); if (sc && !resume(sc)) start(forLevel(sc)); };

  /* ================= the run ================= */
  var R = null;
  G.NARKE_VENT_UI.run = function () { return R; }; // read-only hooks for test/run-narke-vent-ui.mjs
  G.NARKE_VENT_UI.learn = function () { return VL.learn; };
  // Level 1 runs carry no scripted events unless the scenario marks one as taught (teach: true).
  function forLevel(sc) { if (lv() > 1 || !(sc.timeline || []).length) return sc; var c = clone(sc); c.timeline = (c.timeline || []).filter(function (ev) { return ev.teach; }); return c; }
  function start(sc, tut) {
    var e = E(), s0 = e.init(clone(sc), null), set = s0 && s0.settings ? clone(s0.settings) : baseSettings(sc);
    // Level 1 starts with the clock stopped: a beginner reads first, then runs time (U8).
    R = { sc: sc, s: s0, set: set, startSet: clone(set), pend: {}, log: [], abgs: [], answers: [], seen: {}, lastSet: 0, lastAct: 0, lastLog: 0, bedSig: "", chain: null, live: lv() > 1, sil: {}, ack: {}, hints: [], evSeen: 0, tut: tut || null, side: null, alarmSig: "", bsig: "", msig: "",
      acts: [], hold: null, exam: null, drift: null, driftBase: { t: 0, r: null }, bad: 0, arrest: null, tab: "mon", coMin: false, fromTut: !!tut, alLab: {}, alT: {}, alIds: {} };    R.log.push({ t: 0, settings: clone(set), readout: e.readout(s0, set), action: "start" });
    if (!tut) dropSaved(sc.id);
    run();
  }
  /* ---- unfinished runs: Resume later keeps the run (this device only); opening the patient again resumes it ---- */
  var RK = "smd_narke_vent_runs", KEEP = ["s", "set", "startSet", "log", "abgs", "answers", "seen", "lastSet", "lastAct", "lastLog", "sil", "ack", "hints", "evSeen", "side", "acts", "hold", "exam", "bad", "tab", "alLab", "alSelf"];
  function savedRuns() { var o = null; try { o = JSON.parse(I.ls().getItem(RK)); } catch (e) {} return o && typeof o === "object" ? o : {}; }
  // A tutorial's patient is practice: it never writes the patient's own save slot (U5), even after the coach is done.
  function saveRun() {
    if (!R || R.tut || R.fromTut) return;
    var all = savedRuns(), o = { sc: R.sc.id, at: Date.now() };
    KEEP.forEach(function (k) { o[k] = R[k]; });
    all[R.sc.id] = o;
    try { I.ls().setItem(RK, JSON.stringify(all)); } catch (e) { try { o.log = o.log.slice(-120); o.abgs = o.abgs.slice(-4); all[R.sc.id] = o; I.ls().setItem(RK, JSON.stringify(all)); } catch (x) {} }
  }
  function dropSaved(id) { var all = savedRuns(); if (all[id]) { delete all[id]; try { I.ls().setItem(RK, JSON.stringify(all)); } catch (e) {} } }
  function resume(sc) {
    var o = savedRuns()[sc.id];
    if (!o || !o.s || !o.set) return false;
    R = { sc: sc, pend: {}, chain: null, live: false, tut: null, alarmSig: "", bsig: "", msig: "", bedSig: "", drift: null, driftBase: { t: o.s.t, r: null }, arrest: null, coMin: false };
    KEEP.forEach(function (k) { R[k] = o[k]; });
    ["log", "abgs", "answers", "hints", "acts"].forEach(function (k) { if (!R[k]) R[k] = []; });
    ["seen", "sil", "ack"].forEach(function (k) { if (!R[k]) R[k] = {}; });
    R.startSet = R.startSet || clone(R.set); R.tab = R.tab || "mon";
    run();
    toast("event", s("resumed", { t: clockText(R.s.t) }));
    return true;
  }
  // Back from a run with history asks first: Resume later, Finish and debrief, or Leave.
  function runBack() {
    if (R && !R.tut && !R.fromTut && !R.arrest && (R.s.t > 0 || R.log.length > 1)) { leaveSheet(); return true; }
    stopLive();
    home('[data-act=vlgo][data-s="' + R.sc.id + '"]'); return true;
  }
  function leaveSheet() {
    sheet(s("leaveH"), '<p class="vl-leave-b">' + s("leaveB", { t: clockText(R.s.t) }) + "</p>",
      '<div class="vl-leave-f"><button type="button" class="sp-btn pri" data-act="vlresl">' + s("resumeLater") + '</button><button type="button" class="sp-btn sec" data-act="vlfinish">' + s("finish") + '</button><button type="button" class="sp-btn sec vl-leave-x" data-act="vlleave">' + s("leaveRun") + "</button></div>", q(".sp-top .sp-back"));
  }
  A.vlresl = function () { saveRun(); var id = R.sc.id; closeSheet(true); stopLive(); home('[data-act=vlgo][data-s="' + id + '"]'); };
  A.vlleave = function () { var id = R.sc.id; dropSaved(id); closeSheet(true); stopLive(); home('[data-act=vlgo][data-s="' + id + '"]'); };
  A.vlfresh = function (b) { var sc = scById(b.getAttribute("data-s")); if (sc) { dropSaved(sc.id); start(forLevel(sc)); } };
  function cur() { return E().readout(R.s, R.set); }
  function pendSet() { var o = clone(R.set), k; for (k in R.pend) if (Object.prototype.hasOwnProperty.call(R.pend, k)) o[k] = R.pend[k]; return o; }
  function nPend() { return Object.keys(R.pend).length; }

  // Phone: the run is four tabs (Monitor, Dials, What changed, Blood gas), one open at a time, with a vitals strip.
  var TABS = ["mon", "dials", "chg", "abg"];
  function isPhone() { try { return !!(G.matchMedia && G.matchMedia("(max-width: 759px)").matches); } catch (e) { return false; } }
  function tabsHtml() {
    return '<div class="vl-tabbar"><div class="vl-tabs sp-seg" role="group" aria-label="' + s("tabsH") + '">' + TABS.map(function (k) {
      return '<button type="button" data-act="vltab" data-t="' + k + '" aria-pressed="' + (R.tab === k) + '">' + s("tb_" + k) + "</button>";
    }).join("") + '</div><p class="vl-minimon" id="vlMini" aria-hidden="true">' + miniMon(cur()) + "</p></div>";
  }
  function miniMon(r) {
    var v = r.vitals || {}, g = R.sc.goals || {}, lo = spo2Lo();
    function it(k, val, bad) { return '<span class="' + (bad ? "abn" : "") + '"><i>' + k + "</i> " + esc(fmtN(val)) + "</span>"; }
    return it("SpO2", v.spo2, v.spo2 < lo) + it("BP", fmtN(v.sbp) + "/" + fmtN(v.dbp), v.map < 65) + it("HR", v.hr, v.hr > 120 || v.hr < 50) + it("EtCO2", v.etco2, false);
  }
  function setTab(k, focus) {
    if (!R || TABS.indexOf(k) < 0) return;
    R.tab = k;
    var sc = q(".vl-scroll"); if (sc) sc.setAttribute("data-tab", k);
    var tt = q(".vl-toast.on"); if (tt) toastPlace(tt); // the vitals strip shows on some tabs only: the card moves with it
    [].forEach.call(I.root().querySelectorAll("[data-act=vltab]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-t") === k)); });
    if (focus) { var n = q('[data-act=vltab][data-t="' + k + '"]'); if (n) n.focus({ preventScroll: true }); }
    G.requestAnimationFrame(function () { WV.plots.forEach(wvSize); wvKick(); });
  }
  A.vltab = function (b) { setTab(b.getAttribute("data-t"), true); var sc = q(".vl-scroll"); if (sc) sc.scrollTop = 0; };
  // Before scrolling to an element on a phone, open the tab that holds it.
  function reveal(el) {
    if (!el || !isPhone()) return;
    var g = el.closest && el.closest("[data-g]");
    if (g && g.getAttribute("data-g") !== R.tab) setTab(g.getAttribute("data-g"));
  }
  function run(focusSel) {
    if (!R) return home();
    var e = E();
    I.leave(); closeSheet(true);
    st.view = "vl-run"; st.again = run;
    st.onBack = runBack;
    st.onLeave = function () { stopLive(); wvStop(); closeSheet(true); };
    var r = cur(), sc = R.sc;
    glossReset();
    var al0 = alarmsHtml();
    I.paint(I.top(t(STR.backLab), tx(sc.title), '<span id="vlClock">' + s("simTime", { x: clockText(R.s.t) }) + "</span>" + okChip(), I.langBtn()) +
      '<div class="vl-alarms' + (R.alN ? "" : " is-none") + '" id="vlAlarms" data-vl-id="alarms">' + al0 + "</div>" +
      '<div class="vl-bagw" id="vlBag">' + bagHtml() + "</div>" +
      '<div class="vl-toast" role="status" aria-live="polite"></div>' +
      '<div class="sp-scroll vl-scroll' + (R.tut ? " has-coach" : "") + '" data-tab="' + R.tab + '">' + tabsHtml() +
      (R.fromTut && !R.tut ? '<p class="vl-tutrun" role="note">' + s("tutRunNote") + "</p>" : "") +
      '<div class="vl-wrap vl-run">' +
      '<div class="vl-colA">' + ptHtml(r) + monHtml(r) + '<div class="vl-bedw" id="vlBedW" data-g="mon">' + bedHtml() + "</div></div>" +
      '<div class="vl-colB">' + ventHtml(r) + setHtml() + "</div>" +
      '<div class="vl-colC">' + chainHtml() + '<section class="vl-card vl-ov" data-vl-id="oxvent" data-g="chg" aria-labelledby="vlOvH" id="vlOv">' + ovHtml(r) + "</section>" +
      '<section class="vl-card vl-abg" data-vl-id="abg" data-g="abg" aria-labelledby="vlAbgH" id="vlAbg">' + abgHtml() + "</section>" +
      '<div class="vl-end"><button type="button" class="sp-btn sec sp-wide" data-act="vlfinish" data-vl-id="debrief">' + ico("flag") + " " + s("finish") + "</button>" +
      '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + '</span></p><p class="sp-small vl-simlab">' + s("simulated") + "</p></div></div>" +
      "</div></div>" +
      (R.tut ? '<div class="vl-coach' + (R.coMin ? " min" : "") + '" id="vlCoach" role="region" aria-label="' + s("tut") + '">' + coachHtml() + "</div>" : "") +
      '<div class="sp-foot vl-foot" id="vlFoot" data-vl-id="time">' + footHtml() + "</div>" +
      '<p class="sp-sr" id="vlSay" role="status" aria-live="polite"></p>',
      typeof focusSel === "string" ? focusSel : null);
    bindWaves(r);
    if (R.chain) paintChain(true);
    if (R.tut) tutHighlight();
    if (R.live) startLive();
  }

  /* ---- targets: values are coloured only when they are outside this patient's own targets ---- */
  function goals() { return (R && R.sc.goals) || {}; }
  function spo2Lo() { var g = goals(); return g.spo2 ? g.spo2[0] : 92; }
  // [lo, hi] for an ABG value against the scenario's goals (null bound = not judged). PaO2: low below what the SpO2
  // target needs; high only when FiO2 is above 50 % (hyperoxia is a lesson only when oxygen is being wasted).
  function gasRange(k, fio2) {
    // HCO3 and BE are the body's metabolic side, not the ventilator's target: flagged only when clearly abnormal (U10)
    var g = goals(), n = { pH: [7.35, 7.45], PaCO2: [35, 45], HCO3: [18, 30], BE: [-6, 6], lactate: [null, 2] };
    if (k === "pH" && g.ph) return g.ph;
    if (k === "PaCO2" && g.paco2) return g.paco2;
    if (k === "SaO2") return [g.spo2 ? g.spo2[0] : 92, null];
    if (k === "PaO2") return g.pao2 || [g.spo2 && g.spo2[0] <= 90 ? 55 : 60, fio2 > 50 ? 100 : null];
    return n[k] || [null, null];
  }
  function outOf(v, rg) { return v == null || !rg ? 0 : rg[0] != null && v < rg[0] ? -1 : rg[1] != null && v > rg[1] ? 1 : 0; }

  /* ---- patient ---- */
  // Level 1 opens the story the first time a patient is seen (outside a tutorial); after that it stays folded (U2 audit).
  function storyOpen(sc) {
    if (lv() > 1 || R.tut || R.fromTut) return false;
    var p = prefs(); p.story = p.story || {};
    if (R.storyShown === sc.id) return true;
    if (p.story[sc.id]) return false;
    p.story[sc.id] = 1; savePrefs(); R.storyShown = sc.id;
    return true;
  }
  function ptHtml(r) {
    var sc = R.sc, p = sc.patient || {}, l = sc.lung || {}, g = sc.goals || {}, n = lv();
    var vs = p.volumeStatus === "low" ? "volLow" : p.volumeStatus === "high" ? "volHigh" : "volNormal";
    var goalsL = [];
    if (n <= 1 && g.spo2) goalsL.push(s("goalsPlain", { a: g.spo2[0], b: g.spo2[1] }));
    else {
      if (g.spo2) goalsL.push("SpO2 " + g.spo2[0] + " to " + g.spo2[1] + " %");
      if (g.paco2) goalsL.push("PaCO2 " + g.paco2[0] + " to " + g.paco2[1]);
      if (g.ph) goalsL.push("pH " + g.ph[0] + " to " + g.ph[1]);
      if (g.pplatMax) goalsL.push("Pplat " + "&le; " + g.pplatMax);
      if (g.vtPerKg) goalsL.push("VT " + g.vtPerKg[0] + " to " + g.vtPerKg[1] + " mL/kg");
    }
    return '<section class="vl-card vl-pt" data-vl-id="patient" data-g="mon" aria-labelledby="vlPtH">' +
      '<div class="vl-pt-h"><h2 class="vl-h" id="vlPtH">' + txg(p.diagnosis) + '</h2><span class="vl-lvb" title="' + s("lvMine", { n: sc.level || 1 }) + '">' + s("lvN", { n: sc.level || 1 }) + "</span></div>" +
      '<p class="vl-pt-who">' + s(p.sex === "F" ? "female" : "male") + ", " + s("yrs", { n: p.age }) + " · " + esc(fmtN(p.heightCm)) + " cm · " + esc(fmtN(p.weightKg)) + ' kg · <b title="' + s("pbwFull", { n: ptPbw(sc) }) + '">' + s("pbw") + " " + esc(fmtN(ptPbw(sc))) + " kg</b></p>" +
      '<div class="vl-tags">' + lungTags(sc).map(function (k) { return '<span class="vl-tag2">' + s(k) + "</span>"; }).join("") + '<span class="vl-tag2 vs-' + esc(p.volumeStatus || "normal") + '">' + s(vs) + "</span></div>" +
      (n >= 2 ? '<p class="vl-pt-mech">' + s("compl", { n: l.c }) + " · " + s("resist", { n: l.r }) + "</p>" : '<p class="vl-plain">' + s("pbwWhy") + "</p>") +
      '<details class="vl-story"' + (storyOpen(sc) ? " open" : "") + "><summary>" + s("storyGoals") + "</summary><p>" + txg(sc.story) + "</p>" + (sc.why ? "<p><b>" + s("why") + "</b> " + txg(sc.why) + "</p>" : "") +
      (goalsL.length ? "<p><b>" + s("targets") + "</b> " + goalsL.join(" · ") + "</p>" : "") +
      (n >= 2 && (g.other || []).length ? "<ul>" + g.other.map(function (o) { return "<li>" + txg(o) + "</li>"; }).join("") + "</ul>" : "") + "</details></section>";
  }

  /* ---- monitor ---- */
  function monNums(r) {
    var v = r.vitals || {};
    return { hr: fmtN(v.hr), spo2: fmtN(v.spo2), et: fmtN(v.etco2), rr: fmtN(v.rr), bp: fmtN(v.sbp) + "/" + fmtN(v.dbp), map: "(" + fmtN(v.map) + ")", temp: v.temp == null ? "?" : String(v.temp) };
  }
  // Monitor numbers outside this patient's safe range: element id -> -1 low, 1 high.
  function monAbn(r) {
    var v = r.vitals || {}, o = {};
    if (v.spo2 != null && v.spo2 < spo2Lo()) o.vlSpo2 = -1;
    // above the target on added oxygen: amber "above target" (the oxygen can come down), never red (U10)
    // round 5 (U12): on a low FiO2 (50% or less, the debrief's own "above range is fine" line) the tag is neutral, not amber
    else if (v.spo2 != null && goals().spo2 && v.spo2 > goals().spo2[1] && R.set.fio2 > 21) o.vlSpo2 = R.set.fio2 > 50 ? 2 : 3;
    if (v.map != null && v.map < 65) o.vlBp = -1;
    if (v.hr != null && (v.hr > 120 || v.hr < 50)) o.vlHr = v.hr > 120 ? 1 : -1;
    return o;
  }
  function abnTag(d) { return d === 2 || d === 3 ? '<span class="vl-abn-t ' + (d === 2 ? "amb" : "neu") + '">' + s("aboveTgt") + "</span>" : d ? '<span class="vl-abn-t">' + s(d < 0 ? "abnLow" : "abnHigh") + "</span>" : ""; }
  function monHtml(r) {
    var m = monNums(r), ab = monAbn(r);
    function ch(cls, tag, w, num, id) {
      return '<div class="vl-ch ' + cls + '" data-vl-id="' + id + '"><div class="vl-ch-w"><span class="vl-tag">' + tag + '</span><canvas class="vl-cv" data-w="' + w + '" aria-hidden="true"></canvas></div><div class="vl-num">' + num + "</div></div>";
    }
    function big(k, id, v, sub) { return '<span class="vl-k">' + s(k) + '</span><b class="vl-v' + (ab[id] === 2 ? " amb" : ab[id] === 3 ? "" : ab[id] ? " abn" : "") + '" id="' + id + '">' + esc(v) + '</b><span class="vl-abn" id="' + id + 'T">' + abnTag(ab[id]) + "</span>" + (sub || ""); }
    return '<section class="vl-card vl-monw" data-vl-id="monitor" data-g="mon" aria-labelledby="vlMonH"><h2 class="vl-h" id="vlMonH">' + s("monitor") + "</h2>" +
      '<div class="vl-plate vl-mon">' +
      ch("c-ecg", s("ecg"), "ecg", big("hr", "vlHr", m.hr), "hr") +
      ch("c-spo2", s("pleth"), "pleth", big("spo2", "vlSpo2", m.spo2), "spo2") +
      ch("c-co2", s("co2"), "capno", big("etco2", "vlEt", m.et) + '<span class="vl-rr"><span class="vl-k">' + s("rr") + '</span><b class="vl-v2" id="vlRr">' + esc(m.rr) + "</b></span>", "etco2") +
      '<div class="vl-ch vl-nibp c-art" data-vl-id="sbp"><span class="vl-k">' + s("nibp") + '</span><span class="vl-bp"><b class="vl-v' + (ab.vlBp ? " abn" : "") + '" id="vlBp">' + esc(m.bp) + '</b><span class="vl-map" id="vlMap" data-vl-id="map">' + esc(m.map) + '</span><span class="vl-abn" id="vlBpT">' + abnTag(ab.vlBp) + "</span></span>" +
      '<span class="vl-temp"><span class="vl-k">' + s("temp") + '</span><b id="vlTemp">' + esc(m.temp) + "</b></span></div></div>" +
      '<div class="vl-flags" id="vlFlags">' + flagsHtml(r) + "</div>" +
      '<div class="vl-drift" id="vlDrift">' + driftHtml() + "</div>" +
      '<div class="vl-o2w" id="vlO2h">' + o2Html(r) + "</div>" +
      (lv() <= 2 ? '<details class="vl-what"><summary>' + s("monWhat") + "</summary><ul>" + ["mHr", "mSpo2"].map(function (k) { return "<li>" + s(k) + "</li>"; }).join("") +
        "<li>" + tx((learn().glossary || {}).etco2 ? { en: "EtCO2: " + learn().glossary.etco2.en, hi: "EtCO2: " + learn().glossary.etco2.hi } : "EtCO2") + "</li>" +
        ["mRr", "mBp", "mUnit", "pfVsS"].map(function (k) { return "<li>" + s(k) + "</li>"; }).join("") + "</ul></details>" : "") +
      '<p class="sp-sr" id="vlMonSay">' + monSay(r) + "</p></section>";
  }
  // SpO2 below target: the engine's reason and what to do next (readout.oxygenHelp), e.g. a lung that will not
  // recruit at FiO2 100% (Sameer stalled at 89 with no hint). Shown only while the oxygen is actually low.
  function trendHtml(r) {
    var tr = r && r.oxygenTrend;
    if (!tr || !tr.reason || !(tr.direction === "down" || tr.kind === "shunt" || (bagLeft() && tr.direction !== "steady"))) return "";
    return '<div class="vl-o2t" role="note"><p class="vl-o2h-h"><b>' + s("o2Trend") + (tr.toward != null ? " · " + arrow(tr.direction === "down" ? -1 : tr.direction === "up" ? 1 : 0) + " " + esc(fmtN(tr.toward)) + "%" : "") + "</b></p><p>" + tx(tr.reason) +
      (tr.direction === "down" && tr.lag ? " " + tx(tr.lag) : "") + "</p></div>";
  }
  function o2Html(r) {
    var h = r && r.oxygenHelp, v = (r && r.vitals) || {}, tr = trendHtml(r);
    if (!h || !h.reason || !(v.spo2 < spo2Lo())) return tr;
    return tr + '<div class="vl-o2h" role="note"><p class="vl-o2h-h"><b>' + (h.band === "mild" || h.band === "emergency" ? s("band_" + h.band) + " " : "") + s("o2Why") + "</b></p><p>" + tx(h.reason) + "</p>" +
      ((h.next || []).length ? '<ol class="vl-ol">' + h.next.map(function (x) { return "<li>" + tx(x) + "</li>"; }).join("") + "</ol>" : "") +
      (h.callSenior ? '<p class="vl-call">' + s("o2Call") + "</p>" : "") + "</div>";
  }
  function flagsHtml(r) {
    return (r.flags || []).map(function (f) { return '<span class="vl-fl ' + esc(f.severity || "info") + '">' + tx(lv() <= 1 && f.plain ? f.plain : f.label) + "</span>"; }).join(""); // Level 1: the plain line (engine r5)
  }
  function monSay(r) { var v = r.vitals || {}; return s("monSay", { a: fmtN(v.hr), b: fmtN(v.spo2), c: fmtN(v.sbp), d: fmtN(v.dbp), e: fmtN(v.map), f: fmtN(v.rr), g: fmtN(v.etco2), h: v.temp }); }
  function pulse(el) { if (!el || reduced()) return; el.classList.remove("vl-chg"); void el.offsetWidth; el.classList.add("vl-chg"); }
  function commitBeat(el) { if (!el || reduced()) return; el.classList.remove("vl-commit"); void el.offsetWidth; el.classList.add("vl-commit"); }
  function updMonitor(r, flash) {
    var m = monNums(r), ab = monAbn(r);
    [["vlHr", m.hr], ["vlSpo2", m.spo2], ["vlEt", m.et], ["vlRr", m.rr], ["vlBp", m.bp], ["vlMap", m.map], ["vlTemp", m.temp]].forEach(function (x) { var el = $(x[0]); if (el && el.textContent !== x[1]) { el.textContent = x[1]; if (flash) pulse(el); } });
    ["vlHr", "vlSpo2", "vlBp"].forEach(function (id) { var el = $(id), tg = $(id + "T"), h = abnTag(ab[id]); if (el) { el.classList.toggle("abn", !!ab[id] && ab[id] < 2); el.classList.toggle("amb", ab[id] === 2); } if (tg && tg.innerHTML !== h) tg.innerHTML = h; });
    var sr = $("vlMonSay"); if (sr) sr.innerHTML = monSay(r);
    var fl = $("vlFlags"), fh = flagsHtml(r); if (fl && fl.innerHTML !== fh) fl.innerHTML = fh;
    var mm = $("vlMini"), mh = miniMon(r); if (mm && mm.innerHTML !== mh) mm.innerHTML = mh;
    var oh = $("vlO2h"); if (oh) { var o2 = o2Html(r); if (oh.innerHTML !== o2) oh.innerHTML = o2; }
  }

  /* ---- why is the patient changing: engine E.whyDrift when present, else the numbers that moved with no change ---- */
  // R.drift keeps the data, not HTML: {why} (the engine's reason), {note} (a timeline event) or {xs, m} (numbers that
  // moved), written at paint time in the language of the moment (U7, round 4: the line used to stay in the old language).
  function whyTx(why) {
    if (!why) return "";
    if (typeof why === "string") return esc(why);
    if (Array.isArray(why)) return why.map(function (x) { return x && (x.en || x.hi) ? tx(x) : x && x.because ? tx(x.because) : esc(String(x)); }).join(" ");
    return why.en || why.hi ? tx(why) : why.because ? tx(why.because) : "";
  }
  function driftTx(d) {
    if (!d) return "";
    if (typeof d === "string") return d; // a run saved before round 4
    if (d.note) return tx(d.note);
    if (d.why) return whyTx(d.why);
    if (d.xs) return s("driftNone", { x: d.xs.map(function (x) { return raw("dr_" + x[0], { a: fmtN(x[1]), b: fmtN(x[2]) }); }).join(", "), m: d.m });
    return "";
  }
  function driftHtml() {
    var d = R && driftTx(R.drift);
    return d ? '<p class="vl-drift-p"><b>' + s(R.drift && R.drift.mine ? "driftMine" : "driftH") + "</b> <span>" + d + "</span></p>" : "";
  }
  function paintDrift() { var el = $("vlDrift"); if (el) { var h = driftHtml(); if (el.innerHTML !== h) el.innerHTML = h; } }
  function setDrift(d) { if (!R) return; R.drift = d; paintDrift(); }
  function markChange() { R.driftBase = { t: R.s.t, r: cur() }; setDrift(null); }
  function checkDrift(r) {
    var b = R.driftBase;
    if (!b || !b.r) { R.driftBase = { t: R.s.t, r: r }; return; }
    if (R.s.t - b.t < 300) return;
    var e = E(), why = e.whyDrift ? safe(function () { return e.whyDrift(R.s, R.set, b.r); }, null) : null, d = null;
    // engine r5: driftReport says whether the learner changed something in the window; then the heading is "Your change
    // is still working", and "You changed nothing" is never said
    var rep = e.driftReport ? safe(function () { return e.driftReport(R.s, R.set, b.r); }, null) : null, mine = !!(rep && rep.learnerChanged);
    if (why && whyTx(why)) d = { why: why, mine: mine };
    if (!d && !mine) {
      var v0 = b.r.vitals || {}, v1 = r.vitals || {}, g0 = b.r.gas || {}, g1 = r.gas || {}, xs = [];
      if (Math.abs((v1.spo2 || 0) - (v0.spo2 || 0)) >= 3) xs.push(["spo2", v0.spo2, v1.spo2]);
      if (Math.abs((v1.map || 0) - (v0.map || 0)) >= 8) xs.push(["map", v0.map, v1.map]);
      if (Math.abs((g1.paco2 || 0) - (g0.paco2 || 0)) >= 5) xs.push(["paco2", g0.paco2, g1.paco2]);
      if (xs.length) d = { xs: xs, m: Math.round((R.s.t - b.t) / 60) };
    }
    if (d) { setDrift(d); R.driftBase = { t: R.s.t, r: r }; }
  }

  /* ---- ventilator ---- */
  function ventHtml(r) {
    var m = R.set.mode;
    return '<section class="vl-card vl-vent" data-vl-id="vent" data-g="dials" aria-labelledby="vlVentH"><div class="vl-vent-h"><h2 class="vl-h" id="vlVentH">' + s("vent") + "</h2>" +
      '<button type="button" class="vl-mode" data-act="vlmode" data-vl-id="mode" aria-haspopup="dialog" aria-label="' + s("changeMode", { x: modeTitle(m) }) + '"><b>' + esc(modeShort(m)) + '</b><span class="vl-mode-t">' + esc(modeParts(m).head) + '</span><span class="vl-chev" aria-hidden="true">' + ico("chev") + "</span></button></div>" +
      (lv() <= 2 ? '<p class="vl-plain vl-wplain">' + s("wavesWhat") + "</p>" : "") +
      '<figure class="vl-plate vl-waves" data-vl-id="waves" role="img" id="vlWaves" aria-label="">' +
      wch("c-paw", "paw", "cmH2O", "vlScP", "wave-pressure") + wch("c-flow", "flow", "L/min", "vlScF", "wave-flow") + wch("c-vol", "vol", "mL", "vlScV", "wave-volume") +
      '<figcaption class="vl-legend" aria-hidden="true"><span><i class="mk-trig"></i>' + s("mkTrig") + '</span><span><i class="mk-cyc"></i>' + s("mkCyc") + '</span><span><i class="mk-auto"></i>' + s("mkAuto") + "</span></figcaption></figure>" +
      '<div class="vl-ro-w" data-vl-id="readouts" id="vlRo">' + roHtml(r) + "</div>" +
      '<div class="vl-holds" data-vl-id="holds">' + (lv() >= 2 ? '<button type="button" class="vl-hbtn" data-act="vlhold" data-k="insp">' + s("holdI") + '</button><button type="button" class="vl-hbtn" data-act="vlhold" data-k="exp">' + s("holdE") + "</button>" : "") +
      '<button type="button" class="vl-hbtn" data-act="vlexam">' + (ico("stethoscope") ? '<span aria-hidden="true">' + ico("stethoscope") + "</span>" : "") + s("exam") + "</button></div>" +
      '<div id="vlHold" aria-live="polite">' + holdHtml() + "</div></section>";
  }
  function wch(cls, w, unit, scId, id) {
    return '<div class="vl-wch ' + cls + '" data-vl-id="' + id + '"><span class="vl-tag">' + s(w) + " <i>" + esc(unit) + '</i></span><span class="vl-scale" id="' + scId + '"></span><canvas class="vl-cv" data-w="' + w + '" aria-hidden="true"></canvas></div>';
  }
  function roFlag(k, v) {
    var g = R.sc.goals || {}, kg = ptPbw(R.sc);
    if (k === "pplat" && v > (g.pplatMax || 30)) return "bad";
    if (k === "drivingP" && v > (g.drivingMax || 15)) return "warn";
    if (k === "autoPeep" && v > 2 && R.set.mode !== "aprv") return "warn";
    if (k === "ineffective" && v > 2) return "warn";
    if (k === "ppeak" && v > 40) return "warn";
    if (k === "vte" && g.vtPerKg && VOL_MODES[R.set.mode] && v / kg > g.vtPerKg[1] + 0.5) return "warn";
    return "";
  }
  /* ---- holds: in spontaneous modes plateau, compliance and driving pressure need an inspiratory hold ---- */
  var SPONT = { psv: 1, cpap: 1, niv: 1 }, VOL_MODES = { vc: 1, acvc: 1, simv: 1, prvc: 1 }, HOLD_KEYS = { insp: ["pplat", "drivingP", "cstat"], exp: ["autoPeep", "peepTotal"] };
  function holdSig() { var x = R.set; return [x.mode, x.vt, x.pinsp, x.ps, x.peep, x.rr, x.ti, x.ipap, x.epap].join("|"); }
  function holdNow(kind) { var h = R && R.hold && R.hold[kind]; return h && h.sig === holdSig() && R.s.t - h.t <= 600 ? h : null; }
  // Engine flags first (readout.notMeasurable as a list or a map, or on readout.vent); else the spontaneous-mode rule.
  function notMeas(r, k) {
    var nm = (r && (r.notMeasurable || (r.vent && r.vent.notMeasurable))) || null;
    if (nm) { if (Array.isArray(nm) ? nm.indexOf(k) < 0 : !nm[k]) return false; }
    else if (!(SPONT[R.set.mode] && HOLD_KEYS.insp.indexOf(k) >= 0)) return false;
    return !holdNow(HOLD_KEYS.insp.indexOf(k) >= 0 ? "insp" : "exp");
  }
  function holdVal(k) { var h = holdNow(HOLD_KEYS.insp.indexOf(k) >= 0 ? "insp" : "exp"); return h && h.v[k] != null ? h.v[k] : null; }
  function holdHtml() {
    var out = [], hf = R && R.holdFail;
    if (hf && hf.sig === holdSig() && R.s.t - hf.t <= 600) out.push('<p class="vl-hres vl-hbad"><b>' + s(hf.kind === "insp" ? "holdI" : "holdE") + "</b> " + s("at", { t: clockText(hf.t) }) + ": " + hf.why + "</p>");
    ["insp", "exp"].forEach(function (kind) {
      var h = holdNow(kind); if (!h) return;
      var bits = HOLD_KEYS[kind].filter(function (k) { return h.v[k] != null; }).map(function (k) { return s("ro_" + k) + " <b>" + esc(fmtN(h.v[k])) + "</b> " + esc(RO_UNIT[k] || ""); });
      out.push('<p class="vl-hres"><b>' + s(kind === "insp" ? "holdI" : "holdE") + "</b> " + s("at", { t: clockText(h.t) }) + ": " + bits.join(", ") + "</p>");
    });
    if (R && R.exam && R.s.t - R.exam.t <= 600) out.push('<div class="vl-exam"><p class="vl-hres"><b>' + s("examH", { t: clockText(R.exam.t) }) + '</b></p><dl>' + examRows(R.exam).map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>"; }).join("") + "</dl></div>");
    return out.join("");
  }
  A.vlhold = function (b) {
    var kind = b.getAttribute("data-k"), e = E(), r = cur(), res = e.hold ? safe(function () { return e.hold(R.s, R.set, kind); }, null) : null, v = {};
    var src = res ? (res.vent || res) : (r.vent || {});
    if (!R.hold) R.hold = {};
    // The engine measures a hold only on a passive patient; an active one breathes against it, so no number is kept.
    if (res && res.measured === false) { delete R.hold[kind]; R.holdFail = { kind: kind, t: R.s.t, sig: holdSig(), why: res.reason ? tx(res.reason) : s("holdUnrel") }; }
    else {
      HOLD_KEYS[kind].forEach(function (k) { if (src[k] != null) v[k] = src[k]; });
      R.hold[kind] = { t: R.s.t, sig: holdSig(), v: v };
      if (R.holdFail && R.holdFail.kind === kind) R.holdFail = null;
    }
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: "hold:" + kind });
    var el = $("vlHold"); if (el) el.innerHTML = holdHtml();
    var ro = $("vlRo"); if (ro) ro.innerHTML = roHtml(r);
    I.haptic("tap");
    say(t(STR[kind === "insp" ? "holdI" : "holdE"]) + ". " + (el ? el.textContent : ""));
  };
  // Listen to the chest: E.exam(state) when present ({key: {en, hi}} or [{label, finding}]); else read from the model.
  // The findings are kept as data ({x} the engine's own, or {fb} pairs of string keys) and written at paint time, so a
  // language switch rewrites them too (U8, round 4); an unknown engine key is never printed raw.
  function examData() {
    var e = E(), x = e.exam ? safe(function () { return e.exam(R.s, R.set); }, null) : null;
    if (x && examRows({ x: x }).length) return { x: x };
    var r = cur(), vv = r.vent || {}, gg = r.gas || {}, ptx = (R.s.m && (R.s.m.ptx || R.s.m.pneumothorax)) || /pneumothorax|tension/i.test(JSON.stringify(r.flags || []));
    return { fb: [["ex_air", ptx ? "exOneSide" : "exEqual"], ["ex_trach", ptx ? "exShift" : "exMid"], ["ex_move", ptx ? "exOneSide" : "exEven"],
      ["ex_sounds", (vv.raw || 0) >= 18 || (R.sc.lung && R.sc.lung.flowLimited) ? "exWheeze" : (gg.shunt || 0) >= 0.15 ? "exCrackles" : "exClear"]] };
  }
  function examRows(d) {
    var out = [], x = d && d.x;
    if (d && d.items) return d.items; // a run saved before round 4
    if (d && d.fb) return d.fb.map(function (p) { return [s(p[0]), s(p[1])]; });
    if (!x) return out;
    if (Array.isArray(x)) x.forEach(function (it) { if (it && it.label && (it.finding || it.text || it.value)) out.push([tx(it.label), tx(it.finding || it.text || it.value)]); });
    else Object.keys(x).forEach(function (k) {
      // the engine's keys (airEntry {left, right}, trachea, wheeze, crackles, chestRise) get labels; its summary
      // sentence repeats the rows, so it is not shown; an unknown key is never printed raw (U6)
      var v = x[k];
      if (k === "summary" || !v || typeof v !== "object") return;
      if (k === "airEntry" && v.left && v.right) { out.push([s("exl_airEntry"), v.left.en === v.right.en ? tx(v.left) : s("exLR", { a: t(v.left), b: t(v.right) })]); return; }
      if (v.en || v.hi) { if (STR["exl_" + k]) out.push([s("exl_" + k), tx(v)]); }
      else if (v.label && (v.finding || v.text)) out.push([tx(v.label), tx(v.finding || v.text)]);
    });
    return out;
  }
  A.vlexam = function () {
    var ed = examData(); ed.t = R.s.t; R.exam = ed;
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "exam" });
    var el = $("vlHold"); if (el) el.innerHTML = holdHtml();
    I.haptic("tap");
    say(el ? el.textContent : "");
  };
  // Level 1: the learner sees four plain numbers ("What the ventilator is doing"), each with its clinical name small
  // beside it; the full readout grid starts at Level 2.
  var DOING = ["vte", "rrTotal", "ve", "ppeak"];
  // Readouts the current tutorial step points at, or asks the learner to watch, show even above the learner's level.
  function tutRo() { var sp = R && R.tut && R.tut.tu.steps[R.tut.i], o = []; if (!sp) return o; (sp.highlight || []).concat(sp.expect ? [sp.expect.key || sp.expect.readout] : []).forEach(function (k) { if (RO_UNIT[k] != null && o.indexOf(k) < 0) o.push(k); }); return o; }
  // "Set rate 14. The patient can add breaths of their own" when the monitor's total differs from the set rate.
  function rrNote(vv) { var m = E().MODES && E().MODES[R.set.mode], has = m && (m.controls || []).indexOf("rr") >= 0; return has && R.set.rr != null && vv.rrTotal != null && Math.round(vv.rrTotal) !== Math.round(R.set.rr) ? '<p class="vl-doing-n vl-rrnote">' + s("rrVs", { s: setText("rr", R.set.rr) }) + "</p>" : ""; }
  function doingHtml(r) {
    var vv = r.vent || {};
    return '<h3 class="vl-doing-h">' + s("doingH") + '</h3><dl class="vl-ro vl-doing">' + DOING.concat(tutRo().filter(function (k) { return DOING.indexOf(k) < 0; })).filter(function (k) { return vv[k] != null; }).map(function (k) {
      var nmv = notMeas(r, k), hv = holdVal(k), v = hv != null ? hv : vv[k];
      return '<div class="vl-ro-i' + (nmv ? " nm" : "") + '" data-vl-id="' + k + '"><dt>' + (STR["b_" + k] ? s("b_" + k) : STR["ex_" + k] ? s("ex_" + k) : "") + ' <abbr>' + s("ro_" + k) + "</abbr></dt><dd>" +
        (nmv ? '<b class="vl-nmv">' + s("needHold") + "</b>" : "<b data-v=\"" + k + '">' + esc(fmtN(v)) + '</b><span class="vl-u">' + esc(RO_UNIT[k] || "") + "</span>") + "</dd></div>";
    }).join("") + '</dl><p class="vl-doing-n">' + s("doingNote") + "</p>" + rrNote(vv);
  }
  function roHtml(r) {
    if (lv() <= 1) return doingHtml(r);
    var items = roItems(r), anyNm = /vl-nmv/.test(items);
    return '<dl class="vl-ro">' + items + "</dl>" + rrNote(r.vent || {}) + (anyNm ? '<p class="vl-doing-n">' + s("needHoldNote") + "</p>" : "");
  }
  function roItems(r) {
    var vv = r.vent || {}, gg = r.gas || {}, kg = ptPbw(R.sc);
    var vis = visReadouts(lv()), extra = tutRo();
    return RO_ORDER.filter(function (k) { return (vis.indexOf(k) >= 0 || extra.indexOf(k) >= 0) && (vv[k] != null || gg[k] != null); }).map(function (k) {
      var nmv = notMeas(r, k), hv = holdVal(k), v = hv != null ? hv : vv[k] != null ? vv[k] : gg[k];
      if (k === "ieActual" && typeof v === "number") v = "1:" + (Math.round(v * 10) / 10);
      if (k === "shunt" && gg.shuntPct != null) v = gg.shuntPct;
      var f = !nmv && typeof v === "number" ? roFlag(k, v) : "", big = ["ppeak", "pplat", "peepTotal", "vte", "ve", "rrTotal"].indexOf(k) >= 0;
      var ex = k === "vte" && typeof v === "number" ? '<span class="vl-ro-x">' + (VOL_MODES[R.set.mode] || !SPONT[R.set.mode] ? s("perKg", { n: Math.round(v / kg * 10) / 10 }) : s("ownNotScored")) + "</span>"
        : k === "drivingP" && lv() <= 2 ? '<span class="vl-ro-x">' + s("dpDef") + "</span>"
        : k === "shunt" && gg.shuntPlain ? '<span class="vl-ro-x">' + tx(gg.shuntPlain) + "</span>" : "";
      return '<div class="vl-ro-i' + (big ? " big" : "") + (f ? " " + f : "") + (nmv ? " nm" : "") + '" data-vl-id="' + k + '"><dt>' + s("ro_" + k) + "</dt><dd>" +
        (nmv ? '<b class="vl-nmv">' + s("needHold") + "</b>" : "<b>" + esc(fmtN(v)) + '</b><span class="vl-u">' + esc(k === "shunt" && gg.shuntPct != null ? "%" : RO_UNIT[k] || "") + "</span>" + (f ? '<span class="vl-flag">' + s("high") + "</span>" : "")) + ex + "</dd></div>";
    }).join("");
  }
  function bindWaves(r) {
    var b = safe(function () { return E().breath(R.s, R.set, 160); }, null), v = r.vitals || {}, vv = r.vent || {};
    var vs = b ? ventSources(b) : null, raw0 = vv.raw || 10;
    var ms = monSources(v, vv.rrTotal || v.rr, raw0 >= 18 || (R.sc.lung && R.sc.lung.flowLimited), R.set.ti);
    R.bsig = breathSig(r); R.msig = monSig(r);
    wvBind(function (n) { return n === "paw" || n === "flow" || n === "vol" ? (vs ? vs[n] : null) : n === "ecg" ? ms.ecg : n === "pleth" ? ms.pleth : n === "capno" ? ms.capno : null; });
    waveText(r, vs);
  }
  function breathSig(r) { var v = r.vent || {}; return [R.set.mode, v.vte, v.ppeak, v.pplat, v.autoPeep, v.rrTotal, R.set.ti].join("|"); }
  function monSig(r) { var v = r.vitals || {}; return [v.hr, v.spo2, v.etco2, v.rr].join("|"); }
  function waveText(r, vs) {
    var el = $("vlWaves"), vv = r.vent || {};
    if (vs) {
      [["vlScP", vs.scale.paw], ["vlScF", vs.scale.flow], ["vlScV", vs.scale.vol]].forEach(function (x) { var n = $(x[0]); if (n) n.textContent = x[0] === "vlScF" ? "±" + x[1] : raw("scaleTo", { a: 0, b: x[1] }); });
    }
    if (el) el.setAttribute("aria-label", raw("waveSay", { a: fmtN(vv.ppeak), b: fmtN(vv.pplat), c: vs && vs.trapped ? raw("flowNot") : raw("flowZero"), d: vs && vs.trig ? raw("trigSay") : "" }).trim());
    var leg = q(".vl-legend .mk-auto");
    if (leg && leg.parentNode) leg.parentNode.hidden = !(vs && vs.trapped);
  }
  function updVent(r, flash) {
    var ro = $("vlRo");
    if (ro) {
      var old = {};
      [].forEach.call(ro.querySelectorAll(".vl-ro-i"), function (n) { old[n.getAttribute("data-vl-id")] = n.querySelector("b").textContent; });
      ro.innerHTML = roHtml(r);
      if (flash) [].forEach.call(ro.querySelectorAll(".vl-ro-i"), function (n) { var b = n.querySelector("b"), k = n.getAttribute("data-vl-id"); if (old[k] != null && old[k] !== b.textContent) pulse(b); });
      if (R.tut) tutHighlight(true);
    }
    var bs = breathSig(r);
    if (bs !== R.bsig) {
      R.bsig = bs;
      var b = safe(function () { return E().breath(R.s, R.set, 160); }, null), vs = b ? ventSources(b) : null;
      if (vs) { wvUpdate("paw", vs.paw); wvUpdate("flow", vs.flow); wvUpdate("vol", vs.vol); }
      waveText(r, vs);
    }
    var ms = monSig(r);
    if (ms !== R.msig) {
      R.msig = ms;
      var v = r.vitals || {}, vv = r.vent || {}, x = monSources(v, vv.rrTotal || v.rr, (vv.raw || 10) >= 18 || (R.sc.lung && R.sc.lung.flowLimited), R.set.ti);
      wvUpdate("ecg", x.ecg); wvUpdate("pleth", x.pleth); wvUpdate("capno", x.capno);
    }
    var mb = q(".vl-mode");
    if (mb) { mb.querySelector("b").textContent = modeShort(R.set.mode); mb.querySelector(".vl-mode-t").textContent = modeParts(R.set.mode).head; mb.setAttribute("aria-label", raw("changeMode", { x: modeTitle(R.set.mode) })); }
  }

  /* ---- settings: dials that wait for Confirm ---- */
  var ARC = (function () {
    var cx = 40, cy = 40, r = 32, a0 = 135 * Math.PI / 180, a1 = 45 * Math.PI / 180;
    return "M" + (cx + r * Math.cos(a0)).toFixed(2) + " " + (cy + r * Math.sin(a0)).toFixed(2) + " A" + r + " " + r + " 0 1 1 " + (cx + r * Math.cos(a1)).toFixed(2) + " " + (cy + r * Math.sin(a1)).toFixed(2);
  })();
  // Beginner steps (Level 1 and 2): FiO2 in 5s, PEEP and rate in 2s, VT in 50s. A tutorial step that asks for an exact
  // value keeps the fine step for that dial; tap the number to type any value at any level.
  // Round 4 (U3, U6): Level 2 turns VT in 20s and keeps PEEP in 1s; Levels 3 and 4 use the dial's own step. Alarm limits
  // move in useful jumps at every level (Ppeak limit 5 per tap: 40 to 25 is three taps, not fifteen). A tutorial step
  // that asks for an exact value keeps the coarse step only when that value sits on its grid.
  // Round 5 (U9): PEEP turns in 1s at every level (5, 6, 7, 8: never 5, 6, 8); a coarse step never jumps past the value a
  // tutorial step asks for (rate 14 to 16 lands on 16, and from 15 it lands on 16, not 17).
  var COARSE = { 1: { fio2: 5, rr: 2, vt: 50, pinsp: 2, ps: 2 }, 2: { fio2: 5, rr: 2, vt: 20, pinsp: 2, ps: 2 } };
  var ALARM_STEP = { pPeakHigh: 5, rrHigh: 5, veHigh: 1, apnoea: 5 };
  function coarse(k) {
    var c = ALARM_STEP[k] || (COARSE[lv()] || {})[k] || 0, sp = tutStep();
    if (c && sp && sp.do && sp.do.key === k && Math.abs(sp.do.to / c - Math.round(sp.do.to / c)) > 1e-9) return 0;
    return c;
  }
  function knob(k) {
    var d = setDef(k), v = R.pend[k] != null ? R.pend[k] : R.set[k], was = R.pend[k] != null ? R.set[k] : null, lab = setLabel(k), unit = setUnit(k);
    var plain = lv() <= 1 && STR["k_" + k] ? '<span class="vl-knob-s">' + s("k_" + k) + "</span>" : "";
    var head = '<div class="vl-knob-top"><span class="vl-knob-lw"><span class="vl-knob-l" id="vlKL-' + esc(k) + '">' + esc(lab) + "</span>" + plain + "</span>" +
      '<button type="button" class="vl-info" data-act="vlinfo" data-k="' + esc(k) + '" aria-label="' + s("info", { x: lab }) + '">' + (ico("info") || "i") + "</button></div>";
    if (d.options) {
      return '<div class="vl-knob vl-knob-opt' + (was != null ? " is-pend" : "") + '" data-vl-id="' + esc(k) + '" data-knob="' + esc(k) + '">' + head +
        '<div class="sp-seg vl-optseg" role="group" aria-labelledby="vlKL-' + esc(k) + '">' + d.options.map(function (o) {
          return '<button type="button" data-act="vlopt" data-k="' + esc(k) + '" data-v="' + esc(o) + '" aria-pressed="' + (String(v) === String(o)) + '">' + esc(o) + "</button>";
        }).join("") + "</div>" + (was != null ? '<span class="vl-was">' + s("was", { v: was }) + "</span>" : "") + "</div>";
    }
    var frac = clamp(((+v) - d.min) / ((d.max - d.min) || 1), 0, 1), vt = setText(k, v) + (unit ? " " + unit : "");
    return '<div class="vl-knob' + (was != null ? " is-pend" : "") + '" data-vl-id="' + esc(k) + '" data-knob="' + esc(k) + '">' + head +
      '<div class="vl-dial" role="spinbutton" tabindex="0" data-spin="' + esc(k) + '" aria-labelledby="vlKL-' + esc(k) + '" aria-valuemin="' + d.min + '" aria-valuemax="' + d.max + '" aria-valuenow="' + v + '" aria-valuetext="' +
      esc(was != null ? raw("valWas", { v: vt, w: setText(k, was) }) : vt) + '">' +
      '<svg viewBox="0 0 80 72" aria-hidden="true" focusable="false"><path class="vl-arc-t" d="' + ARC + '" pathLength="100"/><path class="vl-arc-v" d="' + ARC + '" pathLength="100" stroke-dasharray="' + (frac * 100).toFixed(1) + ' 100"/></svg>' +
      '<button type="button" class="vl-dial-v" data-act="vltype" data-k="' + esc(k) + '" tabindex="-1" aria-label="' + s("typeVal", { x: lab }) + '"><b>' + esc(setText(k, v)) + "</b><small>" + esc(unit) + "</small></button>" +
      (was != null ? '<span class="vl-was">' + s("was", { v: setText(k, was) }) + "</span>" : "") + "</div>" + perKgHtml(k, v) +
      '<div class="vl-step"><button type="button" data-act="vlstep" data-k="' + esc(k) + '" data-d="-1" aria-label="' + s("dec", { x: lab }) + '"' + ((+v) <= d.min ? " disabled" : "") + ">" + MINUS + "</button>" +
      '<button type="button" data-act="vlstep" data-k="' + esc(k) + '" data-d="1" aria-label="' + s("inc", { x: lab }) + '"' + ((+v) >= d.max ? " disabled" : "") + ">" + PLUS + "</button></div></div>";
  }
  // Under the tidal volume dial: the breath per kg of predicted body weight, live as it is turned, on a 4 to 10 scale
  // with the 6 to 8 band in green (U7). Volume modes only (in pressure modes the patient's lung sets the volume).
  function perKgHtml(k, v) {
    var mode = R.pend.mode || R.set.mode;
    if (k !== "vt" || !VOL_MODES[mode]) return "";
    var kg = ptPbw(R.sc), x = Math.round(v / kg * 10) / 10, pos = clamp((x - 4) / 6, 0, 1), inb = x >= 6 && x <= 8;
    return '<div class="vl-perkg' + (inb ? " ok" : "") + '"><span class="vl-perkg-t"><b>' + s("perKgLine", { n: fmtN(x) }) + "</b><small>" + s("perKgSafe") + "</small></span>" +
      '<span class="vl-perkg-s" aria-hidden="true"><i class="vl-perkg-b"></i><i class="vl-perkg-m" style="left:' + (pos * 100).toFixed(1) + '%"></i></span></div>';
  }
  function setHtml() {
    var mode = R.pend.mode || R.set.mode, keys = visSettings(mode, lv()), al = visAlarmKeys(lv());
    return '<section class="vl-card vl-set" data-vl-id="settings" data-g="dials" aria-labelledby="vlSetH" id="vlSet"><div class="vl-sec-h"><h2 class="vl-h" id="vlSetH">' + s("settings") + "</h2>" +
      '<span class="vl-note">' + s("pendNote") + " " + s("typeTip") + "</span></div>" +
      '<div class="vl-knobs">' + keys.map(knob).join("") + "</div>" +
      (al.length ? '<details class="vl-alim"' + (al.some(tutKey) ? " open" : "") + "><summary>" + s("alarmLimits") + '</summary><p class="vl-note vl-alim-n">' + s("limTip") + '</p><div class="vl-knobs">' + al.map(knob).join("") + "</div></details>" : "") + "</section>";
  }
  function refreshKnob(k, focusSel) {
    var el = q('[data-knob="' + k + '"]');
    if (el) el.outerHTML = knob(k);
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    if (focusSel) { var n = q(focusSel); if (n && !n.disabled) n.focus({ preventScroll: true }); else { n = q('[data-knob="' + k + '"] .vl-dial'); if (n) n.focus({ preventScroll: true }); } }
  }
  function stage(k, v) {
    if (String(v) === String(R.set[k])) delete R.pend[k]; else R.pend[k] = v;
  }
  function bump(k, dir, mult) {
    var d = setDef(k);
    if (!d || d.options) return;
    var v = R.pend[k] != null ? R.pend[k] : R.set[k], nv = stepVal(d, v, dir, mult, coarse(k)), sp = tutStep(), to = sp && sp.do && sp.do.key === k ? +sp.do.to : null;
    if (to != null && !isNaN(to) && ((+v < to && nv > to) || (+v > to && nv < to))) nv = to;
    stage(k, nv);
  }
  A.vlstep = function (b) {
    if (!R) return;
    if (HOLD.fired) { HOLD.fired = false; return; }
    var k = b.getAttribute("data-k"), d = +b.getAttribute("data-d");
    bump(k, d, 1); I.haptic("tap");
    refreshKnob(k, '[data-act=vlstep][data-k="' + k + '"][data-d="' + d + '"]');
  };
  // Tap the number to type a value: snapped to the dial's own step and range, staged like any other change.
  A.vltype = function (b) {
    var k = b.getAttribute("data-k"), d = setDef(k); if (!d || !R) return;
    var v = R.pend[k] != null ? R.pend[k] : R.set[k], dial = b.parentNode;
    var inp = G.document.createElement("input");
    inp.type = "number"; inp.className = "vl-type"; inp.setAttribute("inputmode", d.step < 1 ? "decimal" : "numeric"); inp.setAttribute("enterkeyhint", "done");
    inp.min = d.min; inp.max = d.max; inp.step = d.step || 1; inp.value = v; inp.setAttribute("aria-label", raw("typeVal", { x: setLabel(k) }));
    b.style.visibility = "hidden"; dial.appendChild(inp);
    var done = false;
    function fin(keep) {
      if (done) return; done = true;
      var n = parseFloat(inp.value);
      if (keep && !isNaN(n)) { var st0 = d.step || 1; n = clamp(Math.round(n / st0) * st0, d.min, d.max); stage(k, +n.toFixed(decs(st0))); }
      refreshKnob(k, '[data-spin="' + k + '"]');
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); fin(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fin(false); } });
    inp.addEventListener("blur", function () { fin(true); });
    try { inp.focus(); inp.select(); } catch (e) {}
  };
  // Press and hold a stepper to keep turning, like a ventilator knob; the click after a hold is not counted again.
  var HOLD = { tm: 0, iv: 0, fired: false }, UI_N = { n: 0 }; // UI_N counts the learner's presses: delayed moves give way
  function holdStop() { G.clearTimeout(HOLD.tm); G.clearInterval(HOLD.iv); HOLD.tm = HOLD.iv = 0; }
  function holdStart(e) {
    var b = e.target.closest && e.target.closest("[data-act=vlstep]");
    if (!b || b.disabled || !R) return;
    holdStop(); HOLD.fired = false;
    var k = b.getAttribute("data-k"), d = +b.getAttribute("data-d"), sel = '[data-act=vlstep][data-k="' + k + '"][data-d="' + d + '"]';
    HOLD.tm = G.setTimeout(function () {
      HOLD.iv = G.setInterval(function () {
        var n = q(sel); if (!n || n.disabled) return holdStop();
        HOLD.fired = true; bump(k, d, 1); refreshKnob(k, sel);
      }, 90);
    }, 420);
  }
  A.vlopt = function (b) { var k = b.getAttribute("data-k"); stage(k, b.getAttribute("data-v")); refreshKnob(k, '[data-act=vlopt][data-k="' + k + '"][data-v="' + b.getAttribute("data-v") + '"]'); };
  I.KEYS["vl-run"] = function (e) {
    var el = e.target, k = el && el.getAttribute && el.getAttribute("data-spin");
    if (!k || !R) return;
    var d = setDef(k), key = e.key;
    if (key === "ArrowUp" || key === "ArrowRight") bump(k, 1, 1);
    else if (key === "ArrowDown" || key === "ArrowLeft") bump(k, -1, 1);
    else if (key === "PageUp") bump(k, 1, 5);
    else if (key === "PageDown") bump(k, -1, 5);
    else if (key === "Home") stage(k, d.min);
    else if (key === "End") stage(k, d.max);
    else if (key === "Enter" && nPend()) { e.preventDefault(); return confirmChanges(); }
    else if (/^[0-9]$/.test(key)) { e.preventDefault(); var b = q('[data-act=vltype][data-k="' + k + '"]'); if (b) { A.vltype(b); var inp = q(".vl-type"); if (inp) inp.value = key; } return; }
    else return;
    e.preventDefault();
    refreshKnob(k, '[data-spin="' + k + '"]');
  };
  // Range check before Confirm: a warning for values that could harm this patient ("Confirm anyway"), and a quieter
  // note for a value that is right in the moment but must not stay (FiO2 100%). Strings are made with raw().
  function warnings() {
    var o = pendSet(), w = [], kg = ptPbw(R.sc), r = cur(), sp = (r.vitals || {}).spo2, n = lv();
    function W(x) { w.push({ t: x }); }
    if (R.pend.peep != null && o.peep > (n <= 2 ? 12 : 18)) W(raw("wHigh", { x: "PEEP", v: o.peep }));
    if (R.pend.peep != null && o.peep < 3 && n <= 2) W(raw("wLow", { x: "PEEP", v: o.peep }));
    if (!E().settingWarnings && R.pend.fio2 != null && o.fio2 < R.set.fio2 && sp != null && sp < spo2Lo()) W(raw("wO2", { v: o.fio2 }));
    // round 5 (U7, E8): the engine's own Confirm warnings when it gives them; else a big FiO2 drop (20 points or more, or
    // down to room air) on a patient who needs the oxygen: the 30 min prediction says how far SpO2 falls
    var ew = E().settingWarnings ? safe(function () { return E().settingWarnings(R.s, R.set, o); }, null) : null;
    if (ew && ew.length) ew.forEach(function (x) { if (x && (x.text || x.en)) w.push({ t: t(x.text || x), info: x.level === "info" }); });
    else if (R.pend.fio2 != null && o.fio2 < R.set.fio2 && !(sp != null && sp < spo2Lo()) && (o.fio2 <= 21 || R.set.fio2 - o.fio2 >= 20)) {
      var pr = safe(function () { return E().readout(E().step(clone(R.s), o, 1800), o); }, null), ps = pr && pr.vitals ? pr.vitals.spo2 : null;
      if (ps != null && ps < spo2Lo()) W(raw("wFio2Low", { v: o.fio2, s: fmtN(Math.round(ps)) }));
      else if (R.set.fio2 - o.fio2 >= 20) w.push({ t: raw("wFio2Drop", { a: R.set.fio2, b: o.fio2 }), info: true });
    }
    if (R.pend.rr != null && o.rr < 8) W(raw("wLow", { x: setLabel("rr"), v: o.rr }));
    if (R.pend.rr != null && o.rr >= 30) W(raw("wRrHigh", { v: o.rr }));
    if (R.pend.vt != null && VOL_MODES[o.mode]) {
      var k = Math.round(o.vt / kg * 10) / 10;
      if (k > 10) W(raw("wVt", { v: o.vt, k: k }));
      else if (k > 8.5) W(raw("wVtHigh", { v: o.vt, k: k }));
      else if (k < 5) W(raw("wVtLow", { v: o.vt, k: k }));
      // U4 (round 4): a smaller breath at the same rate moves less air each minute. Past a 15 % cut, say so and offer
      // the rate that keeps minute volume where it was (the safe pair: smaller breaths, more of them).
      var veB = R.set.vt * R.set.rr, veA = o.vt * o.rr;
      if (o.vt < R.set.vt && R.set.rr && veA < 0.85 * veB) {
        var rd = setDef("rr") || {}, need = clamp(Math.ceil(veB / o.vt), rd.min || 4, Math.min(35, rd.max || 40));
        w.push({ t: raw("wVe", { p: Math.round((1 - veA / veB) * 100), a: fmtN(Math.round(veB / 100) / 10), b: fmtN(Math.round(veA / 100) / 10) }), pair: need > o.rr ? need : null });
      }
    }
    if (R.pend.pinsp != null && o.pinsp > 30) W(raw("wHigh", { x: setLabel("pinsp"), v: o.pinsp }));
    if (R.pend.fio2 != null && o.fio2 >= 100) w.push({ t: raw("nFio2"), info: true });
    return w;
  }
  /* ---- footer: time controls, or Confirm while changes wait ---- */
  // Beginner levels: one always-visible "what to do next" line above the footer controls; tapping it goes there.
  function nextStep() {
    if (lv() > 2 || R.tut) return null;
    if (nPend()) return { k: "nx2", to: "confirm" };
    // an active alarm comes first, and the strip never offers a time skip over it (round 5, U4)
    var al = activeAlarms().filter(function (a) { return !(R.sil[a.id] > R.s.t) && !(R.ack[a.id] && !MON_AL[a.id]); })[0];
    if (al) return { k: "nxAl", to: "alarm", id: al.id };
    var ch = R.lastSet > 0, n = R.abgs.length, last = R.abgs[n - 1], after = ch && last && last.t >= R.lastSet;
    if (!ch) return n ? { k: "nx1", to: "settings" } : { k: "nx0", to: "abg" };
    // "again" only when a gas was drawn before (U6, round 4); no chain to read (a tutorial's last change), no "Read the chain"
    if (!after) return R.s.t - R.lastSet < 1500 ? (R.chain && !R.fromTut ? { k: "nx3", to: "chain" } : { k: "nx3b", to: "time" }) : { k: n ? "nx4" : "nx4b", to: "abg" };
    // a gas drawn too soon after the change has not settled yet; Before and Now need two gases
    if (last.t - R.lastSet < 900) return { k: "nx6", to: "abg" };
    return R.abgs.some(function (a) { return a.t < R.lastSet; }) ? { k: "nx5", to: "abg" } : { k: "nx7", to: "abg" };
  }
  function nextHtml() {
    var x = nextStep();
    return x ? '<button type="button" class="vl-next' + (x.to === "alarm" ? " al" : "") + '" data-act="vlnext" data-to="' + x.to + '"' + (x.id ? ' data-k="' + esc(x.id) + '"' : "") + '><b>' + s("nextH") + "</b><span>" + s(x.k) + '</span><span class="vl-chev" aria-hidden="true">' + ico("chev") + "</span></button>" : "";
  }
  function paintFoot() {
    var f = $("vlFoot"); if (!f) return;
    var a = G.document.activeElement, sel = a && f.contains(a) && a.getAttribute("data-act") ? '[data-act="' + a.getAttribute("data-act") + '"]' + (a.getAttribute("data-k") ? '[data-k="' + a.getAttribute("data-k") + '"]' : "") : null;
    f.innerHTML = footHtml();
    if (sel) { var n = f.querySelector(sel); if (n) n.focus({ preventScroll: true }); }
  }
  A.vlnext = function (b) {
    var to = b.getAttribute("data-to"), el, f;
    if (to === "confirm") { f = q("[data-act=vlconfirm]"); if (f) f.focus({ preventScroll: true }); return; }
    if (to === "alarm") { f = q('.vl-al[data-k="' + b.getAttribute("data-k") + '"]'); return A.vlalarm(f || b); }
    if (to === "time") { f = q('[data-act=vlskip][data-k="1800"]'); if (f) { pulse(f); f.focus({ preventScroll: true }); } return; }
    el = to === "abg" ? $("vlAbg") : to === "chain" ? $("vlChH") : $("vlSet");
    f = to === "abg" ? q("[data-act=vldraw]") : to === "chain" ? $("vlChH") : q("#vlSet .vl-dial");
    reveal(el);
    if (el) scrollTo(to === "chain" ? el.parentNode : el, false);
    if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  };
  function footHtml() {
    var n = nPend();
    if (n) {
      var w = warnings(), hard = w.filter(function (x) { return !x.info; }).length, pairOn = w.some(function (x) { return x.pair; });
      return nextHtml() + (w.length ? '<ul class="vl-warns"' + (hard ? ' role="alert"' : "") + ">" + w.map(function (x) { return '<li class="' + (x.info ? "info" : "") + '">' + (ico(x.info ? "info" : "warn") ? '<span aria-hidden="true">' + ico(x.info ? "info" : "warn") + "</span>" : "") + "<span>" + esc(x.t) +
        (x.pair ? '<button type="button" class="vl-pair is-pri" data-act="vlrrpair" data-v="' + x.pair + '">' + (ico("plus") || "") + "<span>" + s("rrPair", { n: x.pair }) + "</span></button>" : "") + "</span></li>"; }).join("") + "</ul>" : "") +
        '<div class="vl-confirm"><button type="button" class="sp-btn sec" data-act="vlcancel">' + s("cancel") + "</button>" +
        // with the safe rate pair on offer, the pair is the filled button and "Confirm anyway" is outlined (U7)
        '<button type="button" class="sp-btn ' + (pairOn ? "sec vl-anyway" : "pri") + (hard && !pairOn ? " vl-warnbtn" : "") + '" data-act="vlconfirm">' + (ico("check") || "") + " " + (hard ? s("confirmAny") : n === 1 ? s("confirm1") : s("confirmN", { n: n })) + "</button></div>";
    }
    var waits = [["300", "t5"], ["900", "t15"], ["1800", "t30"], ["3600", "t60"]];
    var stopped = lv() <= 1 && !R.live && !R.arrest ? '<p class="vl-tstop">' + s("timeStopped") + "</p>" : "";
    return nextHtml() + stopped + '<div class="vl-time" role="group" aria-label="' + s("simTime", { x: clockText(R.s.t) }) + '">' +
      '<button type="button" class="vl-tbtn vl-live" data-act="vllive" aria-pressed="' + !!R.live + '" aria-label="' + s(R.live ? "liveOn" : "liveOff") + '">' +
      '<span class="vl-dot" aria-hidden="true"></span><span class="vl-live-t"><small>' + s("timeK") + "</small>" + s(R.live ? "timeRun" : "timePause") + "</span></button>" +
      waits.map(function (w) { return '<button type="button" class="vl-tbtn" data-act="vlskip" data-k="' + w[0] + '" aria-label="' + s("skipAria", { x: t(STR[w[1]]) }) + '">' + s(w[1]) + "</button>"; }).join("") + "</div>";
  }
  A.vlcancel = function () {
    var ks = Object.keys(R.pend); R.pend = {};
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var n = ks[0] && q('[data-spin="' + ks[0] + '"]'); if (n) n.focus({ preventScroll: true });
  };
  A.vlconfirm = function () { confirmChanges(); };
  // "Also raise rate to N": stages the rate beside the smaller breath; both still wait for Confirm.
  A.vlrrpair = function (b) {
    stage("rr", +b.getAttribute("data-v"));
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    paintFoot(); commitBeat(q('[data-knob="rr"] .vl-dial-v b'));
    var n = q("[data-act=vlconfirm]"); if (n) n.focus({ preventScroll: true });
  };

  // Confirm: the new settings take effect now; mechanics change at once, gases over minutes. The chain shows three
  // labelled columns: now, 30 min on without the change, and 30 min on with it (one baseline for every number).
  function confirmChanges() {
    var e = E(), keys = Object.keys(R.pend);
    if (!keys.length) return;
    var setB = clone(R.set), setA = pendSet(), sB = clone(R.s);
    var roB = e.readout(sB, setB), roA = e.readout(sB, setA);
    var pB = safe(function () { return e.step(clone(sB), setB, 1800); }, sB), pA = safe(function () { return e.step(clone(sB), setA, 1800); }, sB);
    var prB = e.readout(pB, setB), prA = e.readout(pA, setA);
    var reasons = safe(function () { return e.explainDelta(e.abg(pB), e.abg(pA), setB, setA, pB, pA); }, []);
    R.set = setA; R.pend = {}; R.lastSet = R.s.t || 0.001;
    R.side = keys.some(function (k) { return OX_KEYS[k]; }) ? "ox" : "ve";
    R.chain = compose({ setB: setB, setA: setA, keys: keys, roB: roB, roA: roA, now: roB, prB: prB, prA: prA, reasons: reasons });
    R.log.push({ t: R.s.t, settings: clone(setA), readout: roA, action: "set:" + keys.join(",") });
    if (R.tut && !R.tut.saw) { R.tut.pre = { r: roB, t: R.s.t }; R.tut.base = null; }
    markChange();
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    refresh(true);
    paintChain(false);
    I.haptic("success");
    say(R.chain.say);
    // commit beat: the confirmed dials flash once where the hand is, then (220 ms later) the What changed tab opens
    keys.forEach(function (k) { var d = q('[data-knob="' + k + '"] .vl-dial-v b'); if (d) commitBeat(d); });
    var ch = $("vlChH");
    if (ch && !R.tut) {
      var go = function () {
        if (!R || st.view !== "vl-run" || !$("vlChH")) return;
        var c2 = $("vlChH"); reveal(c2);
        try { c2.focus({ preventScroll: true }); var rc = c2.getBoundingClientRect(), sb = q(".sp-scroll").getBoundingClientRect(); if (rc.top < sb.top || rc.bottom > sb.bottom - 40) scrollTo(c2, false); } catch (x) {}
        var cw = c2.closest(".vl-chainw"); if (cw && !reduced()) { cw.classList.remove("vl-in"); void cw.offsetWidth; cw.classList.add("vl-in"); }
      };
      // after the beat the tab opens, unless the learner has already pressed something else (no switch under them)
      var n0 = UI_N.n;
      if (reduced() || !isPhone()) go(); else G.setTimeout(function () { if (UI_N.n === n0 && !SH.el) go(); }, 220);
    }
    var R1 = R; G.setTimeout(function () { if (st.view === "vl-run" && R === R1) hint(roA); }, reduced() ? 0 : 1900);
    if (R.tut) tutCheck();
  }
  // Rows of the three-column projection. Level 1: SpO2, CO2 and blood pressure only.
  function p3Rows() {
    return lv() <= 1 ? [["SpO2", "vitals", "spo2", "%"], ["CO2", "gas", "paco2", "mmHg"], ["MAP", "vitals", "map", "mmHg"]]
      : [["SpO2", "vitals", "spo2", "%"], ["PaO2", "gas", "pao2", "mmHg"], ["PaCO2", "gas", "paco2", "mmHg"], ["pH", "gas", "ph", ""], ["MAP", "vitals", "map", "mmHg"], ["HR", "vitals", "hr", "/min"]];
  }
  function gv(r, g, k) { return r && r[g] ? r[g][k] : null; }
  // Little to gain: with and without the change end within a hair of each other on every row that matters.
  var TINY = { spo2: 1, pao2: 3, paco2: 1.5, ph: 0.01, map: 2, hr: 3 };
  function tiny(a, b) { return ["spo2", "pao2", "paco2", "ph", "map"].every(function (k) { var g = k === "spo2" || k === "map" ? "vitals" : "gas", x = gv(a, g, k), y = gv(b, g, k); return x == null || y == null || Math.abs(x - y) < TINY[k]; }); }
  function p3Html(now, wo, wi, extra, cls) {
    var rows = p3Rows().concat(lv() >= 2 && extra ? extra : []).filter(function (x) { return gv(now, x[1], x[2]) != null || gv(wi, x[1], x[2]) != null; });
    return '<table class="vl-abgt vl-p3' + (cls ? " " + cls : "") + '"><thead><tr><th scope="col"><span class="sp-sr">' + s("wiSetting") + "</span></th>" +
      '<th scope="col">' + s("p3now") + '</th><th scope="col">' + s("p3without") + '</th><th scope="col">' + s("p3with") + "</th></tr></thead><tbody>" +
      rows.map(function (x) {
        var a = gv(now, x[1], x[2]), b = gv(wo, x[1], x[2]), c = gv(wi, x[1], x[2]), d = dirOf(b, c, x[2] === "ph" ? 0.004 : 0.5);
        return '<tr><th scope="row">' + esc(x[0]) + (x[3] ? ' <small>' + esc(x[3]) + "</small>" : "") + "</th><td>" + esc(fmtN(a)) + "</td><td>" + esc(fmtN(b)) + "</td><td><b>" + esc(fmtN(c)) + "</b> " + arrow(d) + '<span class="sp-sr">' + s(d > 0 ? "up" : d < 0 ? "down" : "same") + "</span></td></tr>";
      }).join("") + "</tbody></table>" + (tiny(wo, wi) ? '<p class="vl-little">' + s("littleGain") + "</p>" : "");
  }
  // The setting as a noun in a sentence: "the rate", never "Set rate" after "You set" (U6). At Level 1 in English the
  // dial's own plain caption follows in brackets, so the chain and the dial use the same words (U9).
  function setNoun(k, n) {
    var lab = setLabel(k);
    if (L() !== "en") return lab;
    if (/^set\s/i.test(lab)) lab = "the " + lab.slice(4).toLowerCase();
    return n <= 1 && STR["k_" + k] ? lab + " (" + t(STR["k_" + k]).toLowerCase() + ")" : lab;
  }
  // The stretch line follows driving pressure (the stretch on the lung), not the plateau alone: a smaller breath with a
  // higher PEEP raises the plateau yet stretches the lung less (round 2: "stretches the lung more" was wrong there).
  function mechPlain(v0, v1, dpl) {
    var dd = dirOf(v0.drivingP, v1.drivingP, 0.4);
    if (v0.drivingP == null || v1.drivingP == null) return dpl ? raw(dpl > 0 ? "pl_mechUp" : "pl_mechDn") : "";
    if (dpl > 0 && dd < 0) return raw("pl_mechPeep");
    if (dpl > 0 && !dd && dirOf(v0.peepTotal, v1.peepTotal, 0.4) > 0) return raw("pl_mechPeepUp");
    return dd ? raw(dd > 0 ? "pl_mechUp" : "pl_mechDn") : dpl ? raw(dpl > 0 ? "pl_mechUp" : "pl_mechDn") : "";
  }
  function compose(o) {
    var v0 = o.roB.vent || {}, v1 = o.roA.vent || {}, a0 = o.prB, a1 = o.prA, out = {}, said = [], n = lv();
    function u(k) { return setUnit(k) ? " " + setUnit(k) : ""; }
    out.setting = { on: true, lines: o.keys.map(function (k) {
      if (k === "mode") return raw("cMode", { a: modeShort(o.setB.mode), b: modeShort(o.setA.mode) });
      return raw("cSet", { x: setLabel(k), a: setText(k, o.setB[k]) + u(k), b: setText(k, o.setA[k]) + u(k) });
    }), plain: o.keys.map(function (k) { return k === "mode" ? raw("pl_mode", { a: modeShort(o.setB.mode), b: modeShort(o.setA.mode) }) : raw("pl_setting", { x: setNoun(k, n), a: setText(k, o.setB[k]) + u(k), b: setText(k, o.setA[k]) + u(k) }); }).join(" ") };
    var dve = dirOf(v0.ve, v1.ve, 0.05);
    out.ventilator = { on: v0.vte !== v1.vte || v0.rrTotal !== v1.rrTotal || o.setA.mode !== o.setB.mode || v0.ve !== v1.ve, lines: [raw("cVent", { v: fmtN(v1.vte), r: fmtN(v1.rrTotal), m: fmtN(v1.ve) })],
      plain: raw(dve > 0 ? "pl_ventUp" : dve < 0 ? "pl_ventDn" : "pl_ventSame", { m: fmtN(v1.ve), w: fmtN(v0.ve) }) };
    var mp = [];
    if (v0.pplat !== v1.pplat) mp.push(raw("cPlat", { a: fmtN(v0.pplat), b: fmtN(v1.pplat) }));
    if (v0.peepTotal !== v1.peepTotal && v1.autoPeep > 0.5) mp.push(raw("cPeepT", { a: fmtN(v0.peepTotal), b: fmtN(v1.peepTotal) }));
    if (mp.length) mp.push(v0.drivingP !== v1.drivingP ? raw("cDrive", { a: fmtN(v0.drivingP), b: fmtN(v1.drivingP) }) : raw("cDriveSame", { a: fmtN(v0.drivingP) }));
    var dpl = dirOf(v0.pplat, v1.pplat, 0.4);
    out.mechanics = { on: mp.length > 0, lines: mp.length ? [mp.join(", ") + "."] : [], plain: mechPlain(v0, v1, dpl) };
    var auto0 = (v0.autoPeep || 0) > 1, auto1 = (v1.autoPeep || 0) > 1, dpk = dirOf(v0.ppeak, v1.ppeak, 0.4);
    out.waveforms = { on: v0.ppeak !== v1.ppeak || auto0 !== auto1, lines: [auto1 && !auto0 ? raw("cWaveAuto", { a: fmtN(v1.autoPeep) }) : auto0 && !auto1 ? raw("cWaveFree") : raw("cWave", { a: fmtN(v0.ppeak), b: fmtN(v1.ppeak) })],
      plain: auto1 && !auto0 ? raw("pl_trap") : auto0 && !auto1 ? raw("pl_free") : dpk ? raw(dpk > 0 ? "pl_waveUp" : "pl_waveDn") : "" };
    var g0 = a0.gas || {}, g1 = a1.gas || {}, w0 = a0.vitals || {}, w1 = a1.vitals || {};
    var dsp = dirOf(w0.spo2, w1.spo2, 0.5), dco = dirOf(g0.paco2, g1.paco2, 1), dmap = dirOf(w0.map, w1.map, 1);
    out.gasExchange = { on: false, lines: [], plain: "" };
    out.monitor = { on: dsp !== 0 || dirOf(w0.etco2, w1.etco2) !== 0, lines: [raw("cMon", { a: fmtN(w0.spo2), b: fmtN(w1.spo2), c: fmtN(w0.etco2), d: fmtN(w1.etco2) })],
      plain: raw(dsp > 0 ? "pl_monUp" : dsp < 0 ? "pl_monDn" : "pl_monSame", { b: fmtN(w1.spo2) }) };
    out.abg = { on: dirOf(g0.pao2, g1.pao2, 1) !== 0 || dco !== 0 || dirOf(g0.ph, g1.ph, 0.005) !== 0, lines: [raw("cAbg", { a: fmtN(g0.pao2), b: fmtN(g1.pao2), c: fmtN(g0.paco2), d: fmtN(g1.paco2), e: fmtN(g0.ph), f: fmtN(g1.ph) })],
      plain: raw(dco > 0 ? "pl_co2Up" : dco < 0 ? "pl_co2Dn" : "pl_co2Same", { b: fmtN(g1.paco2) }) };
    out.patient = { on: dmap !== 0 || dirOf(w0.hr, w1.hr, 1) !== 0, lines: [raw("cPt", { a: fmtN(w0.map), b: fmtN(w1.map), c: fmtN(w0.hr), d: fmtN(w1.hr) })],
      plain: raw(dmap > 0 ? "pl_bpUp" : dmap < 0 ? "pl_bpDn" : "pl_bpSame", { b: fmtN(w1.map) }) };
    // Engine reasons: `because` is the plain line, `detail` (when the engine gives one) the technical one.
    (o.reasons || []).forEach(function (x) {
      var ch = x.chain || [], stp = ch.indexOf("gasExchange") >= 0 ? "gasExchange" : ch.indexOf("mechanics") >= 0 ? "mechanics" : ch[ch.length - 1] || "gasExchange";
      if (!out[stp]) return;
      out[stp].on = true;
      out[stp].lines.push((x.param ? x.param + " " + raw(x.direction === "down" ? "down" : "up") + ": " : "") + t(x.detail || x.because));
      var pw = plainWhy(x);
      if ((!out[stp].plain || stp === "gasExchange") && (out[stp].plain || "").indexOf(pw) < 0) out[stp].plain = (out[stp].plainR ? out[stp].plain + " " : "") + pw;
      out[stp].plainR = true;
    });
    // Static teaching copy (learn.json whatIf) never overrides the model's own lines; it sits under More detail.
    var notes = [];
    if (o.wiChain) o.wiChain.forEach(function (x) { if (x && x.text) notes.push({ step: x.step, text: t(x.text) }); });
    var steps = (E().CHAIN_STEPS || ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"]);
    steps.forEach(function (k) {
      if (!out[k]) out[k] = { on: false, lines: [], plain: "" };
      if (!out[k].on) { out[k].lines = [raw("cSame")]; out[k].plain = out[k].plain || (k === "gasExchange" ? raw("pl_gasSame") : raw("cSame")); }
      if (!out[k].plain) out[k].plain = out[k].lines[0];
      // Level 1: one plain sentence per box (round 5, U10); the setting box keeps one sentence per changed dial
      if (n <= 1 && k !== "setting") out[k].plain = oneSentence(out[k].plain);
      if (out[k].on) said.push(raw("ch_" + k) + ": " + (n <= 1 ? out[k].plain : out[k].lines.join(" ")));
    });
    var now = o.now || o.roB;
    return { steps: steps, data: out, notes: notes, p3: { now: now, wo: a0, wi: a1 }, say: raw("chainSay", { x: said.join(" ") }), src: o, lang: L(), lv: n };
  }
  function oneSentence(str) { var m = /^[\s\S]*?[.।](?=\s|$)/.exec(str || ""); return m ? m[0] : str || ""; }
  // A chain is written in the language and level of the moment it was made; after a switch it is written again.
  function fresh(c) { return c && c.src && (c.lang !== L() || c.lv !== lv()) ? compose(c.src) : c; }
  function chainHtml() {
    if (R && R.chain) R.chain = fresh(R.chain);
    return '<section class="vl-card vl-chainw" data-vl-id="chain" data-g="chg" aria-labelledby="vlChH"><h2 class="vl-h" id="vlChH" tabindex="-1">' + s("chain") + "</h2>" +
      '<div id="vlChain">' + chainBody(R && R.chain, false) + "</div></section>";
  }
  function chainBody(c, still, noTable) {
    var steps = (c && c.steps) || (E() && E().CHAIN_STEPS) || ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"], beg = lv() <= 1;
    var ol = (c ? "" : '<p class="vl-empty">' + s("chainEmpty") + "</p>") + '<ol class="vl-chain' + (c ? "" : " idle") + '">' + steps.map(function (k) {
      var d = c && c.data[k], state = !c ? "idle" : still ? (d.on ? "on" : "same") : "wait";
      var body = d ? '<p class="vl-cs-t">' + (beg ? txgS(d.plain) : d.lines.map(txgS).join("<br>")) + "</p>" : "";
      return '<li class="vl-cs" data-step="' + esc(k) + '" data-state="' + state + '"><span class="vl-cs-dot" aria-hidden="true"></span><div class="vl-cs-b"><b>' + s("ch_" + k) + "</b>" + (beg && STR["cd_" + k] ? '<span class="vl-cs-d">' + s("cd_" + k) + "</span>" : "") +
        body + "</div></li>";
    }).join("") + "</ol>";
    if (!c) return ol;
    var tbl = c.p3 && !noTable ? p3Html(c.p3.now, c.p3.wo, c.p3.wi) : "";
    var tech = beg ? '<ul class="vl-tech">' + steps.filter(function (k) { return c.data[k].on; }).map(function (k) { return "<li><b>" + s("ch_" + k) + ":</b> " + c.data[k].lines.map(esc).join(" ") + "</li>"; }).join("") + "</ul>" : "";
    var notes = (c.notes || []).length ? '<ul class="vl-tech">' + c.notes.map(function (x) { return "<li>" + (STR["ch_" + x.step] ? "<b>" + s("ch_" + x.step) + ":</b> " : "") + esc(x.text) + "</li>"; }).join("") + "</ul>" : "";
    // Level 1: the numbers and the technical lines wait behind More detail, except the little-to-gain sentence.
    if (beg) return ol + (c.p3 && !noTable && tiny(c.p3.wo, c.p3.wi) ? '<p class="vl-little">' + s("littleGain") + "</p>" : "") + '<details class="vl-more"><summary>' + s("moreDetail") + "</summary>" + tbl.replace(/<p class="vl-little">[\s\S]*?<\/p>/, "") + tech + notes + "</details>";
    return ol + tbl + (notes ? '<details class="vl-more"><summary>' + s("moreDetail") + "</summary>" + notes + "</details>" : "");
  }
  var CHT = [];
  function paintChain(still) {
    var box = $("vlChain"), c = R && R.chain;
    CHT.forEach(function (x) { G.clearTimeout(x); }); CHT = [];
    if (!box || !c) return;
    var quick = still || reduced();
    box.innerHTML = chainBody(c, quick);
    if (quick) return;
    staggerChain(box, c);
  }
  // Only the links that light up animate, 120 ms apart; the unchanged ones settle at once (a shorter, truer cascade).
  function staggerChain(box, c) {
    var j = 0;
    c.steps.forEach(function (k) {
      var li = box.querySelector('[data-step="' + k + '"]');
      if (!c.data[k].on) { if (li) li.setAttribute("data-state", "same"); return; }
      CHT.push(G.setTimeout(function () { var l2 = box.querySelector('[data-step="' + k + '"]'); if (l2) l2.setAttribute("data-state", "on"); }, 100 + (j++) * 120));
    });
  }

  /* ---- oxygenation vs ventilation ---- */
  function ovHtml(r) {
    var set = R.set, v = r.vent || {}, g = r.gas || {}, w = r.vitals || {};
    function row(k, val, u) { return "<div><dt>" + esc(k) + "</dt><dd><b>" + esc(fmtN(val)) + "</b>" + (u ? '<span class="vl-u">' + esc(u) + "</span>" : "") + "</dd></div>"; }
    var ox = R.side === "ox", ve = R.side === "ve";
    return '<h2 class="vl-h" id="vlOvH">' + s("ox") + '</h2><div class="vl-ov2">' +
      '<div class="vl-ovs c-ox' + (ox ? " hot" : "") + '"><h3>' + s("oxSide") + "</h3><dl>" +
      row("FiO2", set.fio2, "%") + row("PEEP", set.mode === "niv" ? set.epap : set.mode === "aprv" ? set.plow : set.peep, "cmH2O") + row("Pmean", v.pmean, "cmH2O") + '</dl><div class="vl-ov-res"><dl>' +
      row("PaO2", g.pao2, "mmHg") + row("SpO2", w.spo2, "%") + "</dl></div><p>" + s("oxRule") + "</p>" + (ox ? '<p class="vl-hot">' + s("lastTouched") + "</p>" : "") + "</div>" +
      '<div class="vl-ovs c-ve' + (ve ? " hot" : "") + '"><h3>' + s("veSide") + "</h3><dl>" +
      row("VT", v.vte, "mL") + row("RR", v.rrTotal, "/min") + row("VE", v.ve, "L/min") + '</dl><div class="vl-ov-res"><dl>' +
      row("PaCO2", g.paco2, "mmHg") + row("EtCO2", w.etco2, "mmHg") + row("pH", g.ph, "") + "</dl></div><p>" + s("veRule") + "</p>" + (ve ? '<p class="vl-hot">' + s("lastTouched") + "</p>" : "") + "</div></div>";
  }

  /* ---- ABG ---- */
  var ABG_ROWS = [["pH", "pH", 7.35, 7.45], ["PaCO2", "PaCO2", 35, 45], ["PaO2", "PaO2", 80, 100], ["HCO3", "HCO3", 22, 26], ["BE", "BE", -2, 2], ["SaO2", "SaO2", 94, 100], ["lactate", "lact", 0.5, 2]];
  function abgVal(a, k) { return a ? a[k] : null; }
  function abgHtml() {
    var n = R.abgs.length, a1 = R.abgs[n - 1], a0 = R.abgs[n - 2];
    var head = '<div class="vl-sec-h"><h2 class="vl-h" id="vlAbgH">' + s("abg") + '</h2><button type="button" class="sp-btn sec vl-draw" data-act="vldraw">' + (ico("abg") || ico("droplet")) + " " + s("draw") + "</button></div>";
    if (!a1) return head + '<p class="vl-empty">' + s("abgNone") + "</p>";
    var beg = lv() <= 1;
    var rows = ABG_ROWS.filter(function (x) { return !beg || STR["ab_" + x[0]]; }).map(function (x) {
      var v1 = abgVal(a1.abg, x[0]), v0 = a0 ? abgVal(a0.abg, x[0]) : null, d = a0 ? dirOf(v0, v1, x[0] === "pH" ? 0.004 : x[0] === "lactate" ? 0.05 : 0.5) : 0;
      var od = v1 != null ? outOf(v1, gasRange(x[0], a1.fio2)) : 0, out = !!od;
      // a PaO2 in range can still be low for the oxygen given (P/F under 300): an amber flag, not a red one (U10)
      var lowF = x[0] === "PaO2" && !od && v1 != null && a1.fio2 > 21 && v1 / (a1.fio2 / 100) < 300;
      return '<tr data-vl-id="' + x[0].toLowerCase() + '"' + (out ? ' class="out"' : lowF ? ' class="amb"' : "") + '><th scope="row">' + (x[1] === "lact" ? s("lact") : esc(x[1])) + (beg ? '<span class="vl-abg-d">' + s("ab_" + x[0]) + "</span>" : "") + "</th>" + (a0 ? "<td>" + esc(fmtN(v0)) + "</td>" : "") + "<td><b>" + esc(fmtN(v1)) + "</b>" + (od ? '<span class="vl-flag">' + s(od < 0 ? "abnLow" : "abnHigh") + "</span>" : lowF ? '<span class="vl-flag amb">' + s("lowForFio2") + "</span>" : "") + "</td>" +
        (a0 ? "<td>" + arrow(d) + '<span class="sp-sr">' + s(d > 0 ? "up" : d < 0 ? "down" : "same") + "</span></td>" : "") + "</tr>";
    }).join("");
    var pf = a1.fio2 ? Math.round(a1.abg.PaO2 / (a1.fio2 / 100)) : null;
    var why = "";
    if (a0) {
      var rs = agree(safe(function () { return E().explainDelta(a0.abg, a1.abg, a0.set, a1.set, a0.st, a1.st); }, []), a0.abg, a1.abg);
      var whyLi = function (x, txt) { return "<li>" + arrow(x.direction === "down" ? -1 : 1) + "<span><b>" + esc(x.param || "") + "</b> " + txt + "</span></li>"; };
      if (rs.length && beg) {
        // Level 1: one plain line per gas and direction; the formulas sit under More detail
        var seenW = {}, pl = rs.filter(function (x) { var k = x.param + x.direction; if (seenW[k]) return false; seenW[k] = 1; return true; });
        why = '<h3 class="vl-h3">' + s("whyH") + '</h3><ul class="vl-why">' + pl.map(function (x) { return whyLi(x, esc(plainWhy(x))); }).join("") + "</ul>" +
          '<details class="vl-more"><summary>' + s("moreDetail") + '</summary><ul class="vl-why">' + rs.map(function (x) { return whyLi(x, tx(x.because)); }).join("") + "</ul></details>";
      } else if (rs.length) why = '<h3 class="vl-h3">' + s("whyH") + '</h3><ul class="vl-why">' + rs.map(function (x) { return whyLi(x, tx(x.because)); }).join("") + "</ul>";
    }
    return head + '<table class="vl-abgt"><thead><tr><th scope="col"><span class="sp-sr">ABG</span></th>' +
      (a0 ? '<th scope="col">' + s("before") + "<small>" + esc(clockText(a0.t)) + "</small></th>" : "") +
      '<th scope="col">' + s(a0 ? "now" : "now") + "<small>" + esc(clockText(a1.t)) + "</small></th>" + (a0 ? '<th scope="col"><span class="sp-sr">' + s("whyH") + "</span></th>" : "") + "</tr></thead><tbody>" + rows +
      (pf != null && !beg ? '<tr><th scope="row">' + s("pf") + "</th>" + (a0 ? "<td>" + esc(fmtN(a0.fio2 ? Math.round(a0.abg.PaO2 / (a0.fio2 / 100)) : null)) + "</td>" : "") + "<td><b>" + esc(fmtN(pf)) + "</b></td>" + (a0 ? "<td></td>" : "") + "</tr>" : "") +
      "</tbody></table>" + interpHtml(a1.abg.interp, beg) + ((beg && a1.abg.curveNoteShort) || a1.abg.curveNote ? '<p class="vl-plain vl-curve">' + esc(t(beg && a1.abg.curveNoteShort ? a1.abg.curveNoteShort : a1.abg.curveNote).replace(/^./, function (c) { return c.toUpperCase(); })) + "</p>" : "") + (lv() <= 2 ? '<p class="vl-plain">' + s("pfVsS") + "</p>" : "") + (a0 ? why : '<p class="vl-empty">' + s("abgAgain") + "</p>");
  }
  // The engine's reading of a gas (abg().interp or E.interpretAbg): its label, and the steps (folded at Level 1).
  function interpHtml(ip, fold) {
    if (!ip || !ip.label) return "";
    // Level 1 reads the engine's short plain form when it gives one (E4: no Winter's, no acidaemia); the full reading folds
    var d = ip.detail ? txg(ip.detail) : "", lab = fold && (ip.short || ip.plain) ? ip.short || ip.plain : ip.label;
    return '<div class="vl-interp"><p><b>' + s("interpH") + ":</b> " + tx(lab) + "</p>" +
      (d ? fold ? '<details class="vl-more"><summary>' + s("stepByStep") + "</summary><p>" + d + "</p></details>" : '<p class="vl-plain">' + d + "</p>" : "") + "</div>";
  }
  // A reason whose direction disagrees with the numbers it sits next to is dropped, never shown.
  function agree(rs, b, a) {
    return (rs || []).filter(function (x) {
      var k = x.param, d = b && a && k && b[k] != null && a[k] != null ? dirOf(b[k], a[k], k === "pH" ? 0.004 : 0.3) : null;
      return d == null || d === 0 || d === (x.direction === "down" ? -1 : 1);
    });
  }
  A.vldraw = function () {
    if (!R) return;
    var e = E(), a = e.abg(R.s);
    R.abgs.push({ abg: a, t: R.s.t, fio2: R.set.fio2, set: clone(R.set), st: clone(R.s) });
    // A gas drawn at baseline or 15 min or more after a change is well timed (gases settle over 10 to 30 min).
    R.answers.push({ kind: "abg", correct: R.lastSet === 0 || R.s.t - R.lastSet >= 900 });
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "abg" });
    var el = $("vlAbg"); if (el) el.innerHTML = abgHtml();
    paintFoot();
    if (R.tut) { R.tut.did = "abg"; tutCheck(); }
    var b = q("[data-act=vldraw]"); if (b) b.focus({ preventScroll: true });
    I.haptic("tap");
    say(raw("abgSay", { t: clockText(R.s.t), a: fmtN(a.pH), b: fmtN(a.PaCO2), c: fmtN(a.PaO2), d: fmtN(a.HCO3) }));
  };

  /* ---- alarms ---- */
  // Monitor alarms (SpO2 below target, MAP below 65, heart rate) stay on the bar until the patient recovers:
  // Acknowledge only marks them seen. The engine's own ids win; the UI adds any it does not raise yet.
  var MON_AL = { spo2Low: 1, mapLow: 1, hrHigh: 1, hrLow: 1 };
  function monAlarms(have) {
    var r = cur(), v = r.vitals || {}, o = [];
    function add(id, sev) { if (!have[id]) o.push({ id: id, severity: sev, label: STR["al_" + id], ui: true }); }
    if (v.spo2 != null && v.spo2 < spo2Lo()) add("spo2Low", v.spo2 < 85 ? "danger" : "warn");
    if (v.map != null && v.map < 65) add("mapLow", v.map < 55 ? "danger" : "warn");
    if (v.hr != null && v.hr > 130) add("hrHigh", "warn");
    if (v.hr != null && v.hr < 45) add("hrLow", "danger");
    return o;
  }
  function abgCtx() {
    var g = R && R.abgs && R.abgs[R.abgs.length - 1], x;
    if (!g || !g.abg) return {};
    x = clone(g.abg); x.t = g.t;
    return { lastAbg: x };
  }
  function allAlarms() {
    var list = safe(function () { return E().alarms(R.s, R.set, abgCtx()); }, []).slice(), have = {};
    list.forEach(function (a) { have[a.id] = 1; });
    return list.concat(monAlarms(have));
  }
  function activeAlarms() {
    var list = allAlarms(), ids = {};
    list.forEach(function (a) { ids[a.id] = 1; });
    Object.keys(R.ack).forEach(function (id) { if (!ids[id]) delete R.ack[id]; });
    // highest tier first; on a tie the patient's own alarms (SpO2, blood pressure) before the machine's; acknowledged last
    return list.filter(function (a) { return !R.ack[a.id] || MON_AL[a.id]; }).sort(function (a, b) {
      return tier(b) - tier(a) || (!!R.ack[a.id]) - (!!R.ack[b.id]) || (!!MON_AL[b.id]) - (!!MON_AL[a.id]);
    });
  }
  function tier(a) { var v = sevOf(a); return v === "danger" ? 3 : v === "warn" ? 2 : 1; }
  function okChip() { return '<span class="vl-okchip" id="vlOk"' + (R && R.alN ? " hidden" : "") + ">" + (ico("check") ? '<span aria-hidden="true">' + ico("check") + "</span>" : "") + s("noAlarms") + "</span>"; }
  function alSig(list) { return list.map(function (a) { return a.id + (R.sil[a.id] > R.s.t ? "s" : "") + (R.ack[a.id] ? "a" : ""); }).join(",") + "|" + L(); }
  function alarmsHtml() {
    var list = activeAlarms();
    R.alarmSig = alSig(list); R.alN = list.length;
    if (!list.length) return '<p class="vl-al-none">' + (ico("check") ? '<span aria-hidden="true">' + ico("check") + "</span>" : "") + s("alarmsNone") + "</p>";
    // the "+N more" chip on a phone takes the colour of the worst alarm it hides, so a hidden red never looks grey
    var hid = list.slice(1), worst = hid.reduce(function (m, a) { return Math.max(m, R.sil[a.id] > R.s.t || R.ack[a.id] ? 0 : tier(a)); }, 0);
    var more = list.length > 1 ? '<button type="button" class="vl-al-more' + (worst === 3 ? " danger" : worst === 2 ? " warn" : "") + '" data-act="vlalall" aria-haspopup="dialog"><b>' + (list.length === 2 ? s("moreAl1") : s("moreAl", { n: list.length - 1 })) + "</b><small>" + s("reddest") + "</small></button>" : "";
    return '<h2 class="sp-sr">' + s("alarmsH") + '</h2><ul class="vl-al-list">' + list.map(function (a) {
      var sil = R.sil[a.id] > R.s.t, ak = !!R.ack[a.id];
      return '<li><button type="button" class="vl-al ' + esc(sevOf(a)) + (sil || ak ? " sil" : "") + '" data-act="vlalarm" data-k="' + esc(a.id) + '" aria-label="' + s("alarmOpen", { x: t(a.label) }) + (sil ? ", " + s("silenced") : ak ? ", " + s("acked") : "") + '">' +
        '<span class="vl-al-i" aria-hidden="true">' + (ico(sevOf(a) === "danger" ? "siren" : "warn") || "!") + "</span>" + tx(a.label) + (sil ? ' <small>' + s("silenced") + "</small>" : ak ? ' <small>' + s("acked") + "</small>" : "") + "</button></li>";
    }).join("") + "</ul>" + more;
  }
  // Alarm answers for the score: an alarm that clears after a learner change counts as handled.
  function trackAlarms() {
    var now = allAlarms(), ids = {};
    if (!R.alLab) R.alLab = {};
    if (!R.alSelf) R.alSelf = {};
    // engine r5 (E6): an alarm the learner's own change caused is "selfMade" (not a response to score), with its times
    now.forEach(function (a) { ids[a.id] = 1; if (R.seen[a.id] == null) { R.seen[a.id] = R.s.t; R.alSelf[a.id] = !!safe(function () { return causedBy(a); }, null); } R.alLab[a.id] = a.label; });
    Object.keys(R.seen).forEach(function (id) {
      if (ids[id]) return;
      if (R.lastSet >= R.seen[id] || R.lastAct >= R.seen[id]) R.answers.push({ kind: "alarm", id: id, correct: true, t: R.seen[id], clearedT: R.s.t, selfMade: !!R.alSelf[id] });
      delete R.seen[id]; delete R.alSelf[id];
    });
  }
  function finalAnswers() {
    var out = R.answers.slice();
    Object.keys(R.seen).forEach(function (id) { if (R.s.t - R.seen[id] >= 300) out.push({ kind: "alarm", id: id, correct: false, t: R.seen[id], selfMade: !!(R.alSelf && R.alSelf[id]) }); });
    return out;
  }
  function updAlarms() {
    var el = $("vlAlarms"); if (!el) return;
    trackAlarms();
    var list = activeAlarms(), sig = alSig(list);
    if (sig === R.alarmSig) return;
    var a = G.document.activeElement, keep = a && el.contains(a) ? a.getAttribute("data-k") : null;
    // arrival cue: one haptic for a new alarm (strong for high priority), never for one already on the bar
    var fresh = list.filter(function (x) { return !R.alIds[x.id] && !(R.sil[x.id] > R.s.t); }), ids = {};
    list.forEach(function (x) { ids[x.id] = 1; });
    R.alIds = ids;
    if (fresh.length) I.haptic(fresh.some(function (x) { return sevOf(x) === "danger"; }) ? "error" : "warning");
    el.innerHTML = alarmsHtml();
    el.classList.toggle("is-none", !R.alN);
    var nx = q(".vl-next"), want = nextStep(); if ((nx ? nx.getAttribute("data-to") : null) !== (want ? want.to : null) || (want && want.id && nx.getAttribute("data-k") !== want.id)) paintFoot(); // the Next strip follows the alarm bar (U4)
    var ok = $("vlOk"); if (ok) ok.hidden = !!R.alN;
    if (keep) { var n = el.querySelector('[data-k="' + keep + '"]'); if (n) n.focus({ preventScroll: true }); }
  }
  // Which setting change most likely raised this alarm: the engine's alarm.causedBy, else the learner's last change
  // (within 30 min before the alarm began) to a setting known to cause it.
  var CAUSE_KEYS = { peepHigh: ["peep", "epap", "plow"], peepSetHigh: ["peep", "epap"], mapLow: ["peep", "rr", "vt", "ti", "epap", "phigh"], pPeakHigh: ["vt", "pinsp", "rr", "ti", "ipap"], pPlatHigh: ["vt", "pinsp", "peep"],
    veLow: ["rr", "vt", "pinsp", "ps", "mode"], vtLow: ["vt", "pinsp", "ps", "mode"], veHigh: ["rr", "vt"], apnoea: ["rr", "mode", "ps"], rrHigh: ["ps", "trigFlow", "trigPress", "mode"],
    autoPeep: ["rr", "vt", "ti"], spo2Low: ["fio2", "peep", "mode"], fio2Low: ["fio2"], fio2High: ["fio2"], peepLow: ["peep"] };
  function causedBy(a) {
    if (a && a.causedBy && a.causedBy.key) return a.causedBy;
    var keys = CAUSE_KEYS[a && a.id], since = R.seen[a.id] != null ? R.seen[a.id] : R.s.t, i, x, prev, k;
    if (!keys) return null;
    for (i = R.log.length - 1; i > 0; i--) {
      x = R.log[i];
      if (x.t > since) continue;
      if (since - x.t > 1800) break;
      if (!/^set:/.test(x.action || "")) continue;
      prev = null;
      for (var j = i - 1; j >= 0; j--) if (R.log[j].settings) { prev = R.log[j].settings; break; }
      if (!prev) return null;
      var ch = x.action.slice(4).split(",");
      for (k = 0; k < ch.length; k++) if (keys.indexOf(ch[k]) >= 0 && ch[k] !== "mode" && String(prev[ch[k]]) !== String(x.settings[ch[k]])) return { key: ch[k], from: prev[ch[k]], to: x.settings[ch[k]], minutesAgo: Math.round((R.s.t - x.t) / 60), ui: true };
      return null;
    }
    return null;
  }
  // The alarm card leads with the patient and the bedside fix, in order (look, bag, DOPE, suction, call the senior). The
  // engine's plan (E.alarms() items, or E.alarmPlan for the UI's own monitor alarms) gives the ordered checklist, the
  // actions and the primary step, which is the one filled button. A changed alarm LIMIT never leads: setting it back only
  // hides the alarm, so it sits under "Other causes and checks" and says so. A changed SETTING (PEEP) is a real cause.
  function planOf(a, id) {
    if (a && a.checklist && a.checklist.length) return a;
    var e = E(), p = e.alarmPlan ? safe(function () { return e.alarmPlan(R.s, id, R.set, abgCtx()); }, null) : null;
    return p && p.checklist && p.checklist.length ? p : null;
  }
  // Without an engine plan (an older engine): the UI's own ordered list and bedside actions.
  function fallbackChecks(id) { return (CARD_CK[id] || (MON_AL[id] ? [] : ["ck_look", "ck_dope", "ck_senior"])).map(function (k) { return { text: STR[k] }; }); }
  function fallbackActs(a, id) {
    var A0 = E().ACTIONS || {}, out = [];
    function add(k) { if (k && A0[k] && out.indexOf(k) < 0) out.push(k); }
    sugFor([a || { id: id }]).forEach(add);
    (CARD_ACTS[id] || []).forEach(add);
    return out;
  }
  function sevOf(a) { var p = a && a.priority; return p === "high" ? "danger" : p === "medium" ? "warn" : p === "low" ? "info" : (a && a.severity) || "warn"; }
  A.vlalarm = function (b) {
    var id = b.getAttribute("data-k"), a = activeAlarms().filter(function (x) { return x.id === id; })[0], c = (learn().alarms || {})[id] || {}, beg = lv() <= 1;
    var list = function (arr) { return arr && arr.length ? "<ul>" + arr.map(function (x) { return "<li>" + txg(x) + "</li>"; }).join("") + "</ul>" : ""; };
    glossReset();
    var cb = a ? causedBy(a) : null, top = "", lim = "", sev = sevOf(a), A0 = E().ACTIONS || {};
    if (cb) {
      var u = setUnit(cb.key) ? " " + setUnit(cb.key) : "", can = setDef(cb.key) && String(R.set[cb.key]) === String(cb.to), n0 = cb.minutesAgo != null ? cb.minutesAgo : 0;
      if (ALARM_KEYS.indexOf(cb.key) >= 0) {
        lim = '<div class="vl-limit"><p>' + s("limYou", { a: setText(cb.key, cb.from) + u, b: setText(cb.key, cb.to) + u, n: n0 }) + "</p>" +
          (can ? '<button type="button" class="sp-btn sec" data-act="vlsetback" data-k="' + esc(cb.key) + '" data-v="' + esc(cb.from) + '">' + s("limBack", { a: setText(cb.key, cb.from) + u }) + "</button>" : "") +
          '<p class="vl-note">' + s("limNote") + "</p></div>";
      } else {
        // U9 (round 4): "Set X back" only when the old value was safe (engine causedBy.safeBack); otherwise say why not and
        // offer the engine's safe step instead (the rate pair for a smaller breath, or PEEP 5)
        var ins = cb.safeBack === false ? cb.instead : null;
        top = '<div class="vl-cause"><p>' + (cb.key === "peep" && (id === "peepHigh" || id === "peepSetHigh") ? s("peepYou") + " " : "") + s("youChanged", { x: setLabel(cb.key), a: setText(cb.key, cb.from) + u, b: setText(cb.key, cb.to) + u, n: n0 }) + "</p>" +
          (cb.safeBack === false ? (cb.unsafeWhy ? '<p class="vl-unsafe"><b>' + s("unsafeBack") + ":</b> " + txg(cb.unsafeWhy) + "</p>" : "") +
            (ins && setDef(ins.key) && String(R.set[ins.key]) !== String(ins.to) ? planBtn(ins, "pri") + (ins.why ? '<p class="vl-note vl-prim-why">' + txg(ins.why) + "</p>" : "") : "")
            : can ? '<button type="button" class="sp-btn pri" data-act="vlsetback" data-k="' + esc(cb.key) + '" data-v="' + esc(cb.from) + '">' + s("setBack", { x: setLabel(cb.key), a: setText(cb.key, cb.from) + u }) + "</button>" : "") + "</div>";
      }
    }
    var P = planOf(a, id), checks = P ? P.checklist : fallbackChecks(id), acts = P ? (P.actions || []) : fallbackActs(a, id), pr = P && P.primary;
    // Round 5 (U5, E1): an alarm leads with its own fix. Low SpO2 leads with oxygen (mild: FiO2 one step; emergency: bag
    // with 100%); a CO2 cause (a smaller breath) moves under "Also fix the CO2", and in an emergency a lowered FiO2 is
    // never set "back" to a value below what the emergency needs: bagging leads, the set back waits under "Then".
    var o2 = id === "spo2Low", band = (P && P.spo2Band) || (o2 ? (sev === "danger" ? "emergency" : "mild") : null), also = "";
    // Engine r5 (E1): primary.second is the learner-caused fix, under the primary with its own heading. Older engines:
    // the UI's own rule for low SpO2.
    var sec2 = pr && pr.second;
    if (sec2) {
      also = '<div class="vl-also"><h3 class="vl-h3">' + (sec2.heading ? tx(sec2.heading) : s("alsoThen")) + "</h3>" +
        (top ? top.replace(/sp-btn pri/g, "sp-btn sec") : sec2.kind === "action" && A0[sec2.id] ? bedBtn({ id: sec2.id, a: A0[sec2.id], on: true, sug: true }, true) : setDef(sec2.key) && ALARM_KEYS.indexOf(sec2.key) < 0 ? planBtn(sec2, "sec") + (sec2.why ? '<p class="vl-note vl-prim-why">' + txg(sec2.why) + "</p>" : "") : "") + "</div>";
      top = "";
    } else if (o2 && cb && top && (!OX_KEYS[cb.key] || (band === "emergency" && cb.key === "fio2" && +cb.from < 100))) {
      also = '<div class="vl-also"><h3 class="vl-h3">' + s(OX_KEYS[cb.key] ? "alsoThen" : "alsoCo2") + "</h3>" + top.replace(/sp-btn pri/g, "sp-btn sec") + "</div>";
      top = "";
    }
    // an r5 engine (it sends silenceOk) already leads with the alarm's own fix (reconnect, bag, DOPE while bagging)
    if (o2 && !oxPrim(pr) && !(P && P.silenceOk != null)) pr = o2Prim(band, A0);
    var lead = !top;
    if (top && pr && pr.kind !== "action") pr = null; // the cause block above already carries the setting step
    function actBtn(k, isLead) { if (!A0[k]) return ""; var on = safe(function () { return A0[k].available(R.s); }, false), h = bedBtn({ id: k, a: A0[k], on: on, sug: true }, true); return isLead && on ? h.replace('class="vl-bedb', 'class="vl-bedb lead') : h; }
    // the primary step: a bedside action, a setting (never a limit), or a check the learner does with their eyes
    var prim = "", primAct = null;
    if (pr && pr.kind === "action" && A0[pr.id]) { primAct = pr.id; prim = '<div class="vl-prim">' + actBtn(pr.id, lead) + "</div>"; }
    else if (pr && pr.kind === "setting" && setDef(pr.key) && ALARM_KEYS.indexOf(pr.key) < 0 && String(R.set[pr.key]) !== String(pr.to)) prim = planBtn(pr, lead ? "pri" : "sec") + (pr.why ? '<p class="vl-note vl-prim-why">' + txg(pr.why) + "</p>" : "");
    else if (pr && pr.label) prim = '<p class="vl-prim vl-prim-c">' + tx(pr.label) + "</p>";
    else if (!P && acts.length) { primAct = acts[0]; prim = '<div class="vl-prim">' + actBtn(acts[0], lead) + "</div>"; }
    var call = (P && (P.spo2Band === "mild" || P.spo2Band === "emergency") ? '<p class="vl-band vl-band-' + P.spo2Band + '"><b>' + s("band_" + P.spo2Band) + "</b> " + s("bandT_" + P.spo2Band) + "</p>" : "") +
      (P && P.callNow ? '<p class="vl-call" role="note">' + (P.callWhy ? txg(P.callWhy) : s("ck_senior")) + "</p>" : "");
    var lineActs = {};
    var ol = checks.length ? '<h3 class="vl-h3 vl-now-h">' + s("doNow") + '</h3><ol class="vl-ol vl-now">' + checks.map(function (x) {
      var k = x.action && A0[x.action] && x.action !== primAct ? x.action : null; if (k) lineActs[k] = 1;
      return "<li><span>" + (x.text ? tx(x.text) : tx(x)) + "</span>" + (k ? actBtn(k, false) : "") + "</li>";
    }).join("") + "</ol>" : (beg ? '<p class="vl-look">' + s("lookFirst") + "</p>" : "");
    var rest = acts.filter(function (k) { return k !== primAct && !lineActs[k] && A0[k]; });
    var fio2 = !P && id === "spo2Low" ? '<p class="vl-fix vl-fio2l">' + (R.set.fio2 >= 100 ? s("fio2Max") : R.set.fio2 >= 60 ? s("fio2Hi", { v: R.set.fio2 }) : s("ams_spo2Low")) + "</p>" : "";
    var now = call + prim + ol + fio2 + (rest.length ? '<div class="vl-bed-g vl-bed-s" role="group" aria-label="' + s("bedH") + '">' + rest.map(function (k) { return actBtn(k, false); }).join("") + "</div>" : "");
    var mon = MON_AL[id] ? "<p>" + s(id === "spo2Low" ? "am_spo2Low" : id === "mapLow" ? "am_mapLow" : "am_hr") + "</p>" + (!P && id === "mapLow" ? '<p class="vl-fix">' + s("ams_mapLow") + "</p>" : "") + '<p class="vl-note">' + s("monStays") + "</p>" : "";
    var more = mon + (c.causes ? '<h3 class="vl-h3">' + s(beg ? "a1_causes" : "causes") + "</h3>" + list(c.causes) : "") +
      (c.clue ? '<h3 class="vl-h3">' + s("clue") + "</h3><p>" + txg(c.clue) + "</p>" : "") +
      (c.steps ? '<h3 class="vl-h3">' + s(beg ? "a1_steps" : "trouble") + '</h3><ol class="vl-ol">' + c.steps.map(function (x) { return "<li>" + txg(x) + "</li>"; }).join("") + "</ol>" : "") +
      (c.fix ? '<h3 class="vl-h3">' + s(beg ? "a1_fix" : "fix") + '</h3><p class="vl-fix">' + txg(c.fix) + "</p>" : "") + lim;
    // open for a high-priority alarm or a changed limit (the real guidance must not hide); folded under a setting cause
    var open = sev === "danger" || !!lim || !top;
    sheet((a ? tx(a.label) : esc(id)),
      '<div class="vl-acard ' + esc(sev) + '">' + top + now + also + (more ? '<details class="vl-more"' + (open ? " open" : "") + "><summary>" + s("otherCauses") + "</summary>" + more + "</details>" : "") + "</div>",
      (silenceOk(a, P, id, band) ? '<button type="button" class="sp-btn sec" data-act="vlsil" data-k="' + esc(id) + '">' + s("silence") + "</button>" : '<p class="vl-nosil" role="note">' + (P && P.silenceWhy ? txg(P.silenceWhy) : a && a.silenceWhy ? txg(a.silenceWhy) : s("noSil")) + "</p>") +
      '<button type="button" class="sp-btn sec" data-act="vlack" data-k="' + esc(id) + '">' + s("ack") + "</button>", b);
  };
  // Silence is not offered for an emergency or a high-priority patient alarm (S10): the engine's silenceOk when it gives
  // one, else the UI's own rule.
  function silenceOk(a, P, id, band) {
    var x = (P && P.silenceOk != null) ? P.silenceOk : a && a.silenceOk != null ? a.silenceOk : null;
    if (x != null) return !!x;
    return !(band === "emergency" || (MON_AL[id] && sevOf(a) === "danger"));
  }
  function oxPrim(pr) { return !!pr && ((pr.kind === "action" && pr.id === "bag100") || (pr.kind === "setting" && OX_KEYS[pr.key] && (pr.key !== "fio2" || +pr.to > +R.set.fio2))); }
  function o2Prim(band, A0) {
    var on = function (k) { return !!A0[k] && safe(function () { return A0[k].available(R.s); }, false); }, f = +R.set.fio2;
    if (band === "emergency" && on("bag100")) return { kind: "action", id: "bag100", label: A0.bag100.label };
    // one FiO2 step: the engine's own fio2Step when exported; until then the same rule as its fio2Line (+20 below 60, else +10)
    if (f < 100) { var up = band === "emergency" ? 100 : E().fio2Step ? safe(function () { return E().fio2Step(f); }, 100) : Math.min(100, f + (f < 60 ? 20 : 10)); return { kind: "setting", key: "fio2", to: up, label: { en: STR.raiseFio2.en.replace("{v}", up), hi: STR.raiseFio2.hi.replace("{v}", up) } }; }
    return { kind: "check", id: "fio2max", label: STR.fio2Max };
  }
  // A plan's setting step as a button; `also` (e.g. a shorter Ti with a faster rate) travels with it.
  function planBtn(x, cls) {
    var al = x.also && typeof x.also === "object" ? JSON.stringify(x.also) : "";
    return '<button type="button" class="sp-btn ' + cls + ' sp-wide vl-prim" data-act="vlplanset" data-k="' + esc(x.key) + '" data-v="' + esc(x.to) + '"' + (al ? ' data-also="' + esc(al) + '"' : "") + ">" + tx(x.label) + "</button>";
  }
  // The plan's primary setting step (e.g. FiO2 to 100% for low SpO2): applied like any change, through Confirm.
  A.vlplanset = function (b) {
    var k = b.getAttribute("data-k"), v = b.getAttribute("data-v"), d = setDef(k), al = null, k2;
    if (!d || ALARM_KEYS.indexOf(k) >= 0) return;
    try { al = JSON.parse(b.getAttribute("data-also") || "null"); } catch (e) { al = null; }
    closeSheet(true);
    R.pend = {}; R.pend[k] = d.options ? v : +v;
    if (al) for (k2 in al) if (Object.prototype.hasOwnProperty.call(al, k2) && setDef(k2) && ALARM_KEYS.indexOf(k2) < 0 && al[k2] != null) R.pend[k2] = setDef(k2).options ? al[k2] : +al[k2];
    confirmChanges();
  };
  A.vlsetback = function (b) {
    var k = b.getAttribute("data-k"), v = b.getAttribute("data-v"), d = setDef(k);
    closeSheet(true);
    R.pend = {}; R.pend[k] = d && !d.options ? +v : v;
    confirmChanges();
  };
  A.vlalall = function (b) {
    var list = activeAlarms();
    sheet(s("alarmsH"), '<p class="vl-note vl-al-note">' + s("alAllNote") + '</p><ul class="vl-al-list vl-al-sheet">' + list.map(function (a) {
      return '<li><button type="button" class="vl-al ' + esc(sevOf(a)) + '" data-act="vlalarm" data-k="' + esc(a.id) + '"><span class="vl-al-i" aria-hidden="true">' + (ico(sevOf(a) === "danger" ? "siren" : "warn") || "!") + "</span>" + tx(a.label) + "</button></li>";
    }).join("") + "</ul>", null, b);
  };
  A.vlsil = function (b) { var id = b.getAttribute("data-k"); R.sil[id] = R.s.t + 120; R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "silence:" + id }); closeSheet(true); R.alarmSig = ""; updAlarms(); focusAlarmBar(); };
  A.vlack = function (b) { var id = b.getAttribute("data-k"); R.ack[id] = 1; R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "ack:" + id }); closeSheet(true); R.alarmSig = ""; updAlarms(); focusAlarmBar(); };
  function focusAlarmBar() { var n = q(".vl-alarms button") || q(".vl-mode"); if (n) n.focus({ preventScroll: true }); }

  /* ---- bedside actions (engine E.ACTIONS / E.act) ---- */
  var BED_ICO = { decompress: "syringe", suction: "droplet", bag100: "lungs", disconnect: "unlink", reconnect: "plus", bronchodilator: "spray", sedate: "moon", fluid: "droplet", blood: "droplet" };
  // Fallback when the engine has no E.suggestActions: the actions the alarm card's own fix names (then its steps).
  var BED_RX = { decompress: /decompress|needle|drain/i, suction: /suction/i, bag100: /\bbag/i, disconnect: /disconnect/i, bronchodilator: /bronchodilat|salbutamol|nebul/i, sedate: /sedat|paralys/i, fluid: /fluid|bolus/i, blood: /blood|transfus/i };
  function alarmActs(id) {
    var c = (learn().alarms || {})[id] || {}, A0 = E().ACTIONS || {};
    function hit(arr) { var txt = arr.map(function (x) { return x && x.en ? x.en : String(x || ""); }).join(" "); return Object.keys(BED_RX).filter(function (k) { return A0[k] && BED_RX[k].test(txt); }); }
    var f = hit(c.fix ? [c.fix] : []);
    return f.length ? f : hit(c.steps || []);
  }
  function sugFor(alarms) {
    var e = E();
    if (e.suggestActions) { var x = safe(function () { return e.suggestActions(R.s, alarms); }, null); if (x) return x.map(function (y) { return typeof y === "string" ? y : y && y.id; }).filter(Boolean); }
    var o = [];
    alarms.forEach(function (a) { alarmActs(a.id).forEach(function (k) { if (o.indexOf(k) < 0) o.push(k); }); });
    return o;
  }
  function bedSuggested() { var o = {}; sugFor(activeAlarms()).forEach(function (k) { o[k] = 1; }); return o; }
  function bagLeft() { var m = R.s.m || {}; return m.bagUntil > R.s.t ? Math.ceil(m.bagUntil - R.s.t) : 0; }
  // A running action's countdown, from the engine's state (m.<id>Until or m.<stem>Until), in seconds.
  function actLeft(id) { var m = R.s.m || {}, u = m[id + "Until"] || m[id.replace(/\d+$/, "") + "Until"]; return u > R.s.t ? Math.ceil(u - R.s.t) : 0; }
  function lastUse(id) { for (var i = (R.acts || []).length - 1; i >= 0; i--) if (R.acts[i].id === id) return R.acts[i].t; return null; }
  function bedList() {
    var acts = (E() && E().ACTIONS) || {}, sug = bedSuggested(), ks = BED_ORDER.filter(function (k) { return acts[k]; });
    Object.keys(acts).forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); });
    // every action, in one fixed order (U4: Level 1 has them too, folded); suggestion marks, never reorders
    return ks.map(function (k) {
      return { id: k, a: acts[k], on: safe(function () { return acts[k].available(R.s); }, false), sug: !!sug[k] };
    }).filter(function (x) { return x.id !== "reconnect" || x.on; }); // Reconnect shows only while off the ventilator
  }
  function bedBtn(x, inSheet) {
    var left = actLeft(x.id), used = lastUse(x.id);
    var stat = !x.on ? (x.id === "decompress" ? s("drainIn") : left ? s("bagLeft", { n: left }) : x.id === "bag100" ? s("bagging") : used != null ? s("usedAt", { t: clockText(used) }) : "")
      : [x.sug ? s("sugg") : "", used != null ? s("usedAt", { t: clockText(used) }) : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="vl-bedb' + (x.sug && x.on ? " sug" : "") + '" data-act="vlbed" data-k="' + esc(x.id) + '"' + (x.on ? "" : ' aria-disabled="true"') + ">" +
      '<span class="vl-bedb-i" aria-hidden="true">' + (ico(BED_ICO[x.id]) || ico("plus")) + '</span><span class="vl-bedb-t">' + tx(x.a.label) + (stat ? "<small>" + stat + "</small>" : "") + "</span></button>";
  }
  function bedLogHtml() {
    var l = (R.acts || []).slice(-4).reverse(), A0 = E().ACTIONS || {};
    return l.length ? '<div class="vl-bedlog"><h3 class="vl-h3">' + s("bedLog") + "</h3><ul>" + l.map(function (x) { return "<li><b>" + esc(clockText(x.t)) + "</b> " + (A0[x.id] ? tx(A0[x.id].label) : esc(x.id)) + "</li>"; }).join("") + "</ul></div>" : "";
  }
  function bedSigOf(list) { return list.map(function (x) { return x.id + (x.on ? 1 : 0) + (x.sug ? "s" : "") + actLeft(x.id); }).join(",") + "|" + lv() + L() + (R.acts || []).length; }
  function bedHtml() {
    var list = bedList();
    R.bedSig = bedSigOf(list);
    if (!list.length) return "";
    var grid = '<div class="vl-bed-g" role="group" aria-labelledby="vlBedH">' + list.map(function (x) { return bedBtn(x); }).join("") + "</div>" + bedLogHtml();
    if (lv() <= 1) {
      // Level 1: one folded line, opened by an alarm that suggests an action, a tutorial step that asks for one, or a tap
      var sp = tutStep(), want = list.some(function (x) { return x.sug && x.on; }) || !!(sp && sp.do && sp.do.action), open = R.bedOpen != null ? R.bedOpen || want : want;
      return '<details class="vl-bed vl-bedd" data-vl-id="bedside"' + (open ? " open" : "") + '><summary><span class="vl-h" id="vlBedH">' + s("bedH") + '</span><span class="vl-bed-n">' + s("bedNote") + "</span></summary>" + grid + "</details>";
    }
    return '<section class="vl-bed" data-vl-id="bedside" aria-labelledby="vlBedH"><div class="vl-bed-h"><h2 class="vl-h" id="vlBedH">' + s("bedH") + '</h2><p class="vl-bed-n">' + s("bedNote") + "</p></div>" + grid + "</section>";
  }
  function bagHtml() {
    var n = bagLeft();
    return n ? '<div class="vl-bag" role="timer" aria-live="off"><span class="vl-bag-i" aria-hidden="true">' + ico("lungs") + '</span><span class="vl-bag-t"><b>' + s("bagNow") + "</b><small>" + s("bagOff") + '</small></span><b class="vl-bag-n" id="vlBagN">' + s("bagLeft", { n: n }) + '</b><i class="vl-bag-p" style="--p:' + (n / 60).toFixed(3) + '" aria-hidden="true"></i></div>' : "";
  }
  function updBed() {
    var w = $("vlBedW"), b = $("vlBag");
    if (b) {
      var n = bagLeft(), had = !!b.firstChild;
      if (!n) { if (had) { b.innerHTML = ""; say(raw("bagEnd")); } }
      else if (!had) b.innerHTML = bagHtml();
      else { var c = $("vlBagN"); if (c) c.textContent = raw("bagLeft", { n: n }); var p = b.querySelector(".vl-bag-p"); if (p) p.style.setProperty("--p", (n / 60).toFixed(3)); }
    }
    coachAuto();
    if (!w) return;
    var list = bedList(), sig = bedSigOf(list);
    if (sig === R.bedSig) return;
    var a = G.document.activeElement, keep = a && w.contains(a) ? a.getAttribute("data-k") : null;
    w.innerHTML = bedHtml();
    if (keep) { var n2 = w.querySelector('[data-k="' + keep + '"]'); if (n2) n2.focus({ preventScroll: true }); }
  }
  A.vlbed = function (b) {
    var id = b.getAttribute("data-k"), e = E(), a = e.ACTIONS && e.ACTIONS[id];
    if (!a || !safe(function () { return a.available(R.s); }, false)) return;
    // a senior-only order (a muscle relaxant, a transfusion) asks first (round 5, U7 + E7)
    if (seniorOnly(id, a) && b.getAttribute("data-ok") !== "1") return seniorSheet(id, a, b);
    var inSheet = !!(b.closest && b.closest(".vl-sheet")), r0 = cur();
    // a tutorial remembers every bedside action with the readout just before it: a later step that asks for the same
    // action accepts it (the first-alarm deadlock: suction from the alarm card, then a step that asks for suction)
    // (a step whose change was already seen keeps its evidence: it is not re-judged against this action)
    if (R.tut) { if (!R.tut.saw) { R.tut.pre = { r: r0, t: R.s.t }; R.tut.base = null; } R.tut.acted = R.tut.acted || {}; R.tut.acted[id] = { r: r0, t: R.s.t }; }
    R.s = e.act(R.s, id);
    R.lastAct = R.s.t || 0.001;
    if (!R.acts) R.acts = [];
    R.acts.push({ id: id, t: R.s.t });
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "act:" + id });
    markChange();
    if (inSheet) closeSheet(true);
    var r1 = refresh(true), v0 = r0.vitals || {}, v1 = r1.vitals || {}, vv0 = r0.vent || {}, vv1 = r1.vent || {}, eff = [];
    // off the ventilator (bagging, a disconnect) the ventilator measures no airway pressure: no Ppeak line then
    if (id !== "bag100" && id !== "disconnect" && vv0.ppeak !== vv1.ppeak && vv1.ppeak != null) eff.push(raw("sawVal", { x: "Ppeak", a: fmtN(vv0.ppeak), b: fmtN(vv1.ppeak) }));
    if (v0.spo2 !== v1.spo2) eff.push(raw("sawVal", { x: "SpO2", a: fmtN(v0.spo2), b: fmtN(v1.spo2) }));
    if (v0.map !== v1.map) eff.push(raw("sawVal", { x: "MAP", a: fmtN(v0.map), b: fmtN(v1.map) }));
    I.haptic("tap");
    var trd = r1.oxygenTrend && r1.oxygenTrend.direction === "down" && r1.oxygenTrend.reason ? " " + tx(r1.oxygenTrend.reason) : "";
    // reconnect (engine r5): the checks to do once back on the ventilator (chest rise, VTe, EtCO2) travel with it
    var cks = a.checks && a.checks.length ? " " + a.checks.slice(0, 3).map(function (x) { return tx(x); }).join(" ") : "";
    toast("event", s("bedDone", { x: t(a.label) }) + (eff.length ? ". " + esc(eff.join(", ")) + "." : "") + trd + cks);
    say(raw("bedDone", { x: t(a.label) }) + (id === "bag100" ? ". " + raw("bagOff") : ""));
    if (R.tut) { R.tut.did = id; tutCheck(); }
    var n = q('#vlBedW [data-k="' + id + '"]') || q("#vlBedW button") || q(".vl-mode"); if (n) n.focus({ preventScroll: true });
    if (R.tut) tutCheck();
  };

  // The engine marks high-risk orders seniorOnly (E7); until it does, the UI treats the relaxant and blood the same way.
  var SENIOR_ONLY = { paralyse: 1, blood: 1 };
  function seniorOnly(id, a) { return a && a.seniorOnly != null ? !!a.seniorOnly : !!SENIOR_ONLY[id]; }
  function seniorSheet(id, a, trig) {
    var why = a.consequence ? '<p class="vl-snr-c">' + txg(a.consequence) + "</p>" : "";
    sheet(s("snrH"), '<p class="vl-senior" role="note">' + s("snrB", { x: t(a.label) }) + "</p>" + why,
      '<div class="vl-fin-f"><button type="button" class="sp-btn pri" data-act="vlsnrcall">' + s("snrCall") + '</button><button type="button" class="sp-btn sec" data-act="vlsnrgo" data-k="' + esc(id) + '">' + s("snrGo") + "</button></div>",
      trig && trig.getAttribute ? trig : null);
  }
  A.vlsnrcall = function () { closeSheet(); toast("event", s("snrCalled")); say(raw("snrCalled")); };
  A.vlsnrgo = function (b) { var id = b.getAttribute("data-k"); closeSheet(true); A.vlbed({ getAttribute: function (k) { return k === "data-k" ? id : k === "data-ok" ? "1" : null; }, closest: function () { return null; } }); };
  // Phone, tutorial, bagging: once the bag step is done the coach folds to its one-line header (Next stays in it), so
  // the bag banner and the monitor are not buried under five layers (round 5, U6). The learner can open it again.
  function coachAuto() {
    if (!R || !R.tut || !$("vlCoach")) return;
    var want = isPhone() && bagLeft() > 0 && R.tut.ok;
    if (want && !R.coMin && !R.coKeep) { R.coMin = true; R.coAuto = true; paintCoach(); }
    else if (!want && R.coAuto) { R.coAuto = false; R.coKeep = false; if (R.coMin) { R.coMin = false; paintCoach(); } }
    if (!want) R.coKeep = false;
  }

  /* ---- time ---- */
  var LIVE = { tm: 0 };
  function startLive() { stopLive(); LIVE.tm = G.setInterval(function () { if (!R || st.view !== "vl-run" || G.document.hidden || SH.el) return; tick(1); }, 1000); }
  function stopLive() { if (LIVE.tm) G.clearInterval(LIVE.tm); LIVE.tm = 0; }
  function tick(sec) {
    if (R.arrest) return;
    R.s = E().step(R.s, R.set, sec);
    var r = refresh();
    if (R.s.t - R.lastLog >= 60) { R.lastLog = R.s.t; R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: "live" }); }
    if (R.s.t % 60 < sec) checkDrift(r);
    checkArrest(r);
  }
  // flash: a Confirm or a time skip (not a live tick): changed numbers get a brief tint so the eye finds them.
  function refresh(flash) {
    var r = cur();
    updMonitor(r, flash); updVent(r, flash);
    var ov = $("vlOv"); if (ov) ov.innerHTML = ovHtml(r);
    updAlarms(); updBed();
    var c = $("vlClock"); if (c) c.textContent = raw("simTime", { x: clockText(R.s.t) });
    var h = $("vlHold"); if (h) { var hh = holdHtml(); if (h.innerHTML !== hh) h.innerHTML = hh; }
    events();
    if (R.tut) tutWatch(r);
    return r;
  }
  // Scripted events: a dismissible note, and the drift line names the cause.
  function events() {
    var tl = R.sc.timeline || [];
    tl.forEach(function (ev, i) {
      if (i < R.evSeen || ev.t > R.s.t) return;
      R.evSeen = i + 1;
      if (ev.note) { toast("event", tx(ev.note)); setDrift({ note: ev.note }); R.driftBase = { t: R.s.t, r: cur() }; }
    });
  }
  /* ---- arrest: the engine's readout.arrest, else SpO2 below 50 or MAP below 40 for 2 sim-min, ends the run ---- */
  function checkArrest(r) {
    var v = r.vitals || {}, bad = !!r.arrest || (v.spo2 != null && v.spo2 < 50) || (v.map != null && v.map < 40);
    if (!bad) { R.bad = null; return; }
    if (R.bad == null) R.bad = R.s.t;
    if (r.arrest || R.s.t - R.bad >= 120) arrest(r);
  }
  function arrest(r) {
    if (R.arrest) return;
    var v = r.vitals || {}, last = null, i;
    for (i = R.log.length - 1; i >= 0; i--) if (/^set:/.test(R.log[i].action || "")) { last = R.log[i]; break; }
    R.arrest = { t: R.s.t, spo2: v.spo2, map: v.map, why: r.arrest && (r.arrest.en || r.arrest.because) ? r.arrest : null, last: last ? { t: last.t, keys: last.action.slice(4) } : null };
    R.live = false; stopLive(); if (!R.fromTut) dropSaved(R.sc.id);
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: "arrest" });
    paintFoot(); I.haptic("error");
    sheet(s("arrestH"), arrestHtml(), '<button type="button" class="sp-btn pri sp-wide" data-act="vlfinish">' + s("finish") + "</button>", q(".vl-mode"));
  }
  function arrestHtml() {
    var a = R.arrest, why = a.why ? (a.why.because ? tx(a.why.because) : tx(a.why)) : s("arrestWhy", { a: fmtN(a.spo2), b: fmtN(a.map) });
    return '<div class="vl-arrest"><p>' + s("arrestB", { t: clockText(a.t), x: why }) + "</p>" +
      (a.last ? "<p>" + s("arrestLast", { x: a.last.keys.split(",").map(function (k) { return k === "mode" ? "Mode" : setLabel(k); }).join(", "), t: clockText(a.last.t) }) + "</p>" : "") + '<p class="vl-note">' + s("arrestEnd") + "</p></div>";
  }
  A.vllive = function () {
    if (R.arrest) return;
    R.live = !R.live;
    if (R.live) startLive(); else stopLive();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var b = q("[data-act=vllive]"); if (b) b.focus({ preventScroll: true });
  };
  // Exactly the time on the button, alarms or not (an active alarm does not pause the clock: the toast says so).
  A.vlskip = function (b) {
    if (!R || R.arrest) return;
    var k = +b.getAttribute("data-k"), lab = k === 300 ? "t5" : k === 900 ? "t15" : k === 1800 ? "t30" : "t60", t0 = R.s.t, r;
    // Five-minute chunks so the score sees the course of the wait, not only its end.
    for (var done = 0; done < k && !R.arrest; done += 300) {
      R.s = E().step(R.s, R.set, Math.min(300, k - done));
      r = E().readout(R.s, R.set);
      R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: done + 300 >= k ? "wait:" + k : "wait" });
      checkArrest(r);
    }
    R.lastLog = R.s.t;
    r = refresh(true);
    if (R.arrest) return;
    checkDrift(r);
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var n = q('[data-act=vlskip][data-k="' + k + '"]'); if (n) n.focus({ preventScroll: true });
    I.haptic("tap");
    var v = r.vitals || {}, g = r.gas || {}, al = activeAlarms().length;
    toast("event", s("skipDone", { x: t(STR[lab]).replace("+", ""), t: clockText(R.s.t) }) + (al ? " " + s("skipAlarm") : ""));
    say(raw("skipped", { x: t(STR[lab]).replace("+", ""), a: fmtN(v.spo2), b: fmtN(g.paco2), c: fmtN(v.map) }));
    var R1 = R; G.setTimeout(function () { if (st.view === "vl-run" && R === R1) hint(r); }, 2600);
  };

  /* ---- hints: a question that points at the cause without naming the fix (and only for this mode) ---- */
  function hint(r) {
    var g = R.sc.goals || {}, v = r.vent || {}, w = r.vitals || {}, gs = r.gas || {}, kg = ptPbw(R.sc), id = null, m = R.set.mode, aprv = m === "aprv";
    if (!notMeas(r, "pplat") && v.pplat > (g.pplatMax || 30)) id = "hPlat";
    else if (VOL_MODES[m] && g.vtPerKg && v.vte / kg > g.vtPerKg[1] + 0.5) id = "hVt";
    else if (!aprv && !notMeas(r, "drivingP") && v.drivingP > (g.drivingMax || 15)) id = "hDrive";
    else if (!aprv && v.autoPeep > 2) id = "hAuto";
    else if (w.map != null && w.map < 65) id = "hMap";
    else if (g.spo2 && w.spo2 < g.spo2[0]) id = "hO2";
    else if ((g.ph && (gs.ph < g.ph[0] || gs.ph > g.ph[1])) || (g.paco2 && (gs.paco2 < g.paco2[0] - 3 || gs.paco2 > g.paco2[1] + 3))) id = "hCo2";
    else if (g.spo2 && w.spo2 > g.spo2[1] && R.set.fio2 > 50) id = "hO2hi";
    if (!id || R.tut || R.hints.slice(-2).indexOf(id) >= 0) return;
    R.hints.push(id);
    toast("hint", s(id));
  }

  /* ---- mode picker and Learn-this-setting cards ---- */
  function modeCard(id) {
    var m = (learn().modes || {})[id] || {}, keys = lv() <= 1 ? ["beginner", "guarantees"] : ["controlled", "variable", "guarantees", "dependsOn", "when", "risks"];
    var rows = keys.filter(function (k) { return m[k]; }).map(function (k) { return "<div><dt>" + s("mc_" + k) + "</dt><dd>" + tx(m[k]) + "</dd></div>"; }).join("");
    return rows ? '<dl class="vl-mcard">' + rows + "</dl>" : "";
  }
  A.vlmode = function () {
    if (!R) return;
    var curM = R.pend.mode || R.set.mode;
    R.pick = curM;
    modeSheet();
  };
  function modeSheet(focusSel) {
    var curM = R.pend.mode || R.set.mode, list = visModes(lv(), curM);
    sheet(s("mode"), '<div class="vl-modes" role="group" aria-label="' + s("mode") + '">' + list.map(function (id) {
      var on = R.pick === id;
      return '<div class="vl-mrow' + (on ? " on" : "") + '"><button type="button" class="vl-mbtn" data-act="vlmpick" data-k="' + esc(id) + '" aria-pressed="' + on + '"><b>' + esc(modeShort(id)) + '</b><span class="vl-mbtn-t">' + esc(modeParts(id).head) + (modeParts(id).note ? "<small>" + esc(modeParts(id).note) + "</small>" : "") + (STR["mv_" + id] ? '<small class="vl-mv">' + s("mv_" + id) + "</small>" : "") + "</span>" +
        (id === R.set.mode ? '<em class="vl-cur">' + s("current") + "</em>" : "") + "</button>" + (on ? modeCard(id) : "") + "</div>";
    }).join("") + "</div>", '<button type="button" class="sp-btn pri sp-wide" data-act="vlmuse"' + (R.pick === curM ? " disabled" : "") + ">" + s("useMode") + "</button>", q(".vl-mode"));
    if (focusSel) { var n = q(focusSel); if (n) n.focus({ preventScroll: true }); }
  }
  A.vlmpick = function (b) { R.pick = b.getAttribute("data-k"); modeSheet('[data-act=vlmpick][data-k="' + R.pick + '"]'); };
  A.vlmuse = function () {
    stage("mode", R.pick);
    closeSheet(true);
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var n = q("[data-act=vlconfirm]") || q(".vl-mode"); if (n) n.focus({ preventScroll: true });
  };
  A.vlinfo = function (b) {
    var k = b.getAttribute("data-k"), c = (learn().settings || {})[k] || {}, d = setDef(k) || {};
    glossReset();
    var keys = lv() <= 1 ? ["beginner", "what", "up", "down", "risks"] : ["what", "controls", "up", "down", "oxygenation", "ventilation", "risks", "use", "pearl"];
    var body = (d.min != null ? '<p class="vl-range">' + s("range", { a: setText(k, d.min), b: setText(k, d.max), u: d.unit || "" }) + "</p>" : "") +
      '<dl class="vl-mcard vl-lcard">' + keys.filter(function (x) { return c[x]; }).map(function (x) {
        return '<div class="lk-' + x + '"><dt>' + s("ls_" + x) + "</dt><dd>" + txg(c[x]) + "</dd></div>";
      }).join("") + "</dl>";
    sheet(esc(setLabel(k)), body, null, b);
  };

  /* ---- tutorial coach ---- */
  A.vltut = function (b) {
    var tu = (learn().tutorials || []).filter(function (x) { return x.id === b.getAttribute("data-k"); })[0];
    if (!tu) return;
    var first = (tu.steps || [])[0], sid = first && first.do && first.do.scenario, sc = (sid && scById(sid)) || VL.scen.filter(function (x) { return (x.level || 1) <= lv(); })[0] || VL.scen[0];
    start(tu.keepTimeline ? clone(sc) : noTimeline(sc), { tu: tu, i: 0, ok: false, saw: false, base: null, t0: 0 });
    tutEnter();
  };
  // Tutorials run without the scenario's timeline, so events do not confound the steps.
  function noTimeline(sc) { var c = clone(sc); c.timeline = []; return c; }
  function tutStep() { return R && R.tut && R.tut.tu.steps[R.tut.i]; }
  // Expected changes are judged against a base readout: for a step with a `do`, the readout just before that change
  // (so an instant change such as plateau after a smaller breath counts at once); for an observation step (expect, no
  // do), the readout before the previous `do`. A time-course effect gets the sim clock moved on in 5 min chunks.
  // An expected change that never shows (a patient where it is tiny) still lets the learner go on: no step can stall.
  function expKey(sp) { return sp.expect.key || sp.expect.readout; }
  function expName(sp) { var k = expKey(sp); return STR["ex_" + k] ? raw("ex_" + k) : k; }
  function expMet(sp, base, r) { var d = dirOf(roVal(base, expKey(sp)), roVal(r, expKey(sp))); return sp.expect.direction === "down" ? d < 0 : d > 0; }
  function tutEnter() {
    var sp = tutStep(); if (!sp) return;
    R.tut.did = null; R.tut.ok = !sp.do || !!sp.do.scenario || !!sp.do.event; R.tut.saw = !sp.expect; R.tut.base = null; R.tut.moved = 0; R.tut.flat = false; R.tut.early = null; R.tut.sawV = null;
    if (sp.do && sp.do.scenario && sp.do.scenario !== R.sc.id) { var sc = scById(sp.do.scenario); if (sc) { var tu = R.tut; tu.pre = null; tu.acted = {}; tu.evT = 0; start(tu.tu.keepTimeline ? clone(sc) : noTimeline(sc), tu); return; } }
    if (sp.do && sp.do.key != null && String(R.set[sp.do.key]) === String(sp.do.to)) R.tut.ok = true;
    if (sp.do && sp.do.mode && R.set.mode === sp.do.mode) R.tut.ok = true;
    // asked for a bedside action the learner already took after the last event (e.g. suction from the alarm card): done,
    // and its effect is judged from the readout just before that action, so Next never deadlocks (U1)
    var did = sp.do && sp.do.action && R.tut.acted && R.tut.acted[sp.do.action];
    if (did && did.t >= (R.tut.evT || 0)) { R.tut.ok = true; R.tut.early = did; R.tut.pre = { r: did.r, t: did.t }; }
    // an event step: the coach makes it happen now (the scenario timeline is off in a tutorial)
    if (sp.do && sp.do.event) {
      R.tut.evT = R.s.t; R.tut.acted = {};
      R.tut.pre = { r: cur(), t: R.s.t };
      R.s = E().inject(R.s, sp.do.event, sp.do);
      R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "event:" + sp.do.event });
      // repaint at once (the clock may be stopped at Level 1, so no tick would show the alarm the event raises)
      refresh(true);
    }
    // a reconnect step (round 5, U11) whose bag has already run out while time moved on: the patient is back on the
    // ventilator, so the step is done (the tutorial still ends connected)
    var AC = E().ACTIONS || {};
    if (sp.do && sp.do.action === "reconnect" && AC.reconnect && !safe(function () { return AC.reconnect.available(R.s); }, true)) R.tut.ok = true;
    if (sp.expect && R.tut.ok) tutObserve(sp);
    var ro = $("vlRo"); if (ro) ro.innerHTML = roHtml(cur());
    // the control the step asks for exists and is open: a dial above the level, the alarm limits, the bedside group
    if (sp.do && sp.do.key != null && !nPend()) { var sE = $("vlSet"); if (sE) sE.outerHTML = setHtml(); }
    R.bedSig = ""; updBed();
    paintCoach(); tutHighlight();
  }
  function tutObserve(sp) {
    var base = R.tut.pre || { r: cur(), t: R.s.t }, i;
    R.tut.base = base;
    if (expMet(sp, base.r, cur())) { R.tut.saw = true; return; }
    for (i = 0; i < 4 && !R.tut.saw; i++) {
      R.s = E().step(R.s, R.set, 300); R.tut.moved += 5;
      R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "wait" });
      if (expMet(sp, base.r, cur())) R.tut.saw = true;
    }
    R.lastLog = R.s.t;
    if (!R.tut.saw) R.tut.flat = true;
    refresh(true);
  }
  // The coach is docked, never over its target: on a phone it is a compact sheet above the footer (at most 40 % of the
  // screen, collapsible to one line) and the page above it scrolls; at 1000 px and wider it is a column at the right.
  function taskText(sp) {
    if (sp.do && sp.do.key != null) {
      var lab = setLabel(sp.do.key), v = setText(sp.do.key, sp.do.to) + (setUnit(sp.do.key) ? " " + setUnit(sp.do.key) : "");
      // English labels that already start with "Set" ("Set rate") read "Set rate to 16", never "Set Set rate to 16".
      return L() === "en" && /^set\s/i.test(lab) ? s("setToL", { x: lab, v: v }) : s("setTo", { x: lab, v: v });
    }
    if (sp.do && sp.do.mode) return s("modeTo", { x: modeShort(sp.do.mode) });
    if (sp.do && sp.do.action) return s("actTo", { x: esc(t(((E().ACTIONS || {})[sp.do.action] || {}).label || sp.do.action)) });
    if (sp.do && sp.do.abg) return s("abgTo");
    return "";
  }
  // Live numbers for what the step points at, so the evidence is in the coach, not off screen.
  function coachNums(sp) {
    var r = cur(), keys = (sp.highlight || []).concat(sp.expect ? [expKey(sp)] : []), seen = {}, out = [];
    keys.forEach(function (k) {
      if (seen[k]) return; seen[k] = 1;
      var v = roVal(r, k);
      if (k === "shunt" && r.gas && r.gas.shuntPct != null) v = r.gas.shuntPct + "%";
      if (v == null || typeof v === "object") return;
      out.push('<span><i>' + (STR["ro_" + k] ? s("ro_" + k) : esc(NUM_LAB[k] || k)) + "</i> " + esc(fmtN(v)) + "</span>");
    });
    return out.length ? '<p class="vl-co-nums"><b>' + s("coNow") + "</b> " + out.slice(0, 4).join("") + "</p>" : "";
  }
  // On the last step: if the tutorial left the patient outside a target, say so and offer the starting settings back.
  function tutLeftHtml(sp) {
    var r = cur(), g = goals(), v = r.vitals || {}, gs = r.gas || {}, bad = [];
    if (g.spo2 && v.spo2 != null && v.spo2 < g.spo2[0]) bad.push("SpO2 " + fmtN(v.spo2));
    if (g.paco2 && gs.paco2 != null && (gs.paco2 < g.paco2[0] - 3 || gs.paco2 > g.paco2[1] + 3)) bad.push("PaCO2 " + fmtN(gs.paco2));
    else if (g.ph && gs.ph != null && (gs.ph < g.ph[0] || gs.ph > g.ph[1])) bad.push("pH " + fmtN(gs.ph));
    if (v.map != null && v.map < 65) bad.push("MAP " + fmtN(v.map));
    if (!bad.length) return "";
    // the tutorial's own reason why this patient is not fully fixed yet (U11); else the offer to restore
    if (sp && sp.left) return '<p class="vl-co-wait vl-co-left">' + s("tutLeft", { x: bad.join(", ") }) + " " + txg(sp.left) + "</p>";
    return '<p class="vl-co-wait">' + s("tutLeft", { x: bad.join(", ") }) + '</p><button type="button" class="vl-co-link" data-act="vltutrst">' + s("restore") + "</button>";
  }
  function coachHtml() {
    var tu = R.tut.tu, sp = tutStep(), n = tu.steps.length, last = R.tut.i >= n - 1, task = taskText(sp), exp = "";
    // a term is glossed once per tutorial, on the step where it first appears (repaints of that step keep it) (U10)
    if (R.tut.glI !== R.tut.i) { R.tut.glBase = clone(R.tut.gl || {}); R.tut.glI = R.tut.i; }
    var keep = GL.seen; GL.seen = clone(R.tut.glBase || {});
    if (sp.expect) {
      var bv = R.tut.base ? roVal(R.tut.base.r, expKey(sp)) : null, nv = roVal(cur(), expKey(sp));
      // the evidence is frozen when the change is first seen: a later fix (suction) must not rewrite what was seen
      if (R.tut.saw && !R.tut.sawV && bv != null && nv != null && dirOf(bv, nv)) R.tut.sawV = { a: bv, b: nv };
      if (R.tut.sawV) { bv = R.tut.sawV.a; nv = R.tut.sawV.b; }
      var d = dirOf(bv, nv);
      // the evidence names the real direction and the plain label ("peak pressure (Ppeak) went down, 25 to 17.8")
      if (R.tut.saw) exp = '<p class="vl-co-ok">' + (task ? "" : ico("check") || "") + (bv != null && nv != null && d ? s("sawMove", { x: expName(sp), d: raw(d < 0 ? "down" : "up"), a: fmtN(bv), b: fmtN(nv) }) : s("sawIt", { x: expName(sp), d: raw(sp.expect.direction === "down" ? "down" : "up") })) + "</p>";
      else if (R.tut.flat) exp = '<p class="vl-co-wait">' + s("tutFlat", { x: expName(sp) }) + "</p>";
      else if (R.tut.ok) exp = '<p class="vl-co-wait">' + s("waitSee", { x: expName(sp) }) + "</p>";
      else exp = '<p class="vl-co-wait">' + s("tutLook", { x: expName(sp) }) + "</p>";
      if (R.tut.moved) exp += '<p class="vl-co-wait">' + s("tutMoved", { m: R.tut.moved }) + "</p>";
    }
    if (R.tut.early) exp = '<p class="vl-co-wait">' + s("alreadyDid", { t: clockText(R.tut.early.t) }) + "</p>" + exp;
    var canNext = R.tut.ok && (R.tut.saw || R.tut.flat);
    // Next never looks dead without a reason: while the task waits, the task line itself ("Your turn") describes Next;
    // once it is done and the change is still to come, one line says to move time on. No line repeats another.
    var waitTask = !R.tut.ok && !!task, needTx = !waitTask && !canNext && sp.expect ? s("needWait", { x: expName(sp) }) : "";
    var need = needTx ? '<p class="vl-co-need" id="vlCoNeed">' + needTx + "</p>" : "";
    // a step about an alarm that the learner has already cleared says so instead of narrating it as still sounding
    var cleared = sp.cleared && sp.alarm && !activeAlarms().some(function (a) { return a.id === sp.alarm; });
    var say = txg(cleared ? sp.cleared : sp.say);
    var show = !R.tut.ok && sp.do && (sp.do.key != null || sp.do.action || sp.do.mode) ? '<button type="button" class="vl-co-link vl-co-show" data-act="vltutshow">' +
      s(sp.do.key != null && ALARM_KEYS.indexOf(sp.do.key) >= 0 ? "openLim" : sp.do.action ? "openBed" : "showCtl") + "</button>" : "";
    R.tut.gl = GL.seen; GL.seen = keep;
    // the instruction comes first while it waits (U12): "Your turn" above the explanation, then the explanation
    var taskL = task ? '<p class="vl-co-task"' + (waitTask ? ' id="vlCoNeed"' : "") + "><b>" + s("yourTurn") + "</b> " + task + (R.tut.ok ? ' <span class="vl-co-done">' + (ico("check") || "") + s("doneStep") + "</span>" : "") + "</p>" + show : "";
    var sayL = '<p class="vl-co-say" id="vlCoSay" tabindex="-1">' + say + "</p>";
    return '<div class="vl-co-h"><button type="button" class="vl-co-min" data-act="vlcomin" aria-expanded="' + !R.coMin + '" aria-controls="vlCoBody"><span class="vl-co-ht"><span class="vl-co-tt">' + tx(tu.title) + '</span><span class="vl-co-st"> · ' + s("stepOf", { i: R.tut.i + 1, n: n }) + "</span>" +
      '</span><span class="vl-co-chev" aria-hidden="true">' + ico("chev") + '</span><span class="sp-sr">' + s(R.coMin ? "coMax" : "coMin") + '</span></button>' + (R.coMin && canNext ? '<button type="button" class="sp-btn pri vl-co-hn" data-act="vltutn">' + s(last ? "done" : "next") + "</button>" : '<button type="button" class="vl-co-x" data-act="vltutx">' + s("exitTut") + "</button>") + "</div>" +
      '<div class="vl-co-bar" aria-hidden="true"><i style="transform:scaleX(' + ((R.tut.i + 1) / n).toFixed(3) + ')"></i></div>' +
      '<div class="vl-co-body" id="vlCoBody">' +
      (waitTask ? taskL + sayL : sayL + taskL) + exp + coachNums(sp) +
      (last ? tutLeftHtml(sp) + (tutChanges(tu) ? '<p class="vl-senior" role="note">' + s("seniorTut") + "</p>" : "") : "") + "</div>" +
      need + '<div class="vl-co-f">' + (task && !R.tut.ok ? '<button type="button" class="sp-btn sec" data-act="vltutdo">' + s("doIt") + "</button>" : "") +
      '<button type="button" class="sp-btn pri' + (canNext ? "" : " is-wait") + '" data-act="vltutn"' + (canNext ? "" : ' data-wait="1" aria-describedby="vlCoNeed"') + ">" + s(last ? "done" : "next") + "</button></div>";
  }
  function paintCoach(focus) {
    var el = $("vlCoach");
    if (!el) {
      var r = I.root(), f = $("vlFoot");
      el = G.document.createElement("div"); el.className = "vl-coach"; el.id = "vlCoach"; el.setAttribute("role", "region"); el.setAttribute("aria-label", raw("tut"));
      if (f) r.insertBefore(el, f); else r.appendChild(el);
      var sc = q(".vl-scroll"); if (sc) sc.classList.add("has-coach");
    }
    var old = $("vlCoSay"), oldTx = old ? old.textContent : null, bodyTop = $("vlCoBody") ? $("vlCoBody").scrollTop : 0;
    el.classList.toggle("min", !!R.coMin);
    el.innerHTML = coachHtml();
    var nw = $("vlCoSay"), bd = $("vlCoBody");
    // a new line crossfades in (160 ms); a repaint of the same step keeps its scroll and does not flash
    if (nw && oldTx != null && oldTx !== nw.textContent && !reduced()) { nw.classList.add("swap"); if (bd) bd.scrollTop = 0; }
    else if (bd) bd.scrollTop = bodyTop;
    var ft = $("vlFoot"); if (ft) el.style.setProperty("--vl-cob", (ft.offsetHeight + 16) + "px");
    var tt = q(".vl-toast.on"); if (tt) toastPlace(tt);
    if (focus) { var n = $("vlCoSay"); if (n && !R.coMin) n.focus({ preventScroll: true }); }
  }
  // "Show me the control": open its tab (and the folded group it sits in), scroll it into the clear area, focus it.
  A.vltutshow = function () {
    var sp = tutStep(); if (!sp || !sp.do) return;
    var tg = null, det = null;
    if (sp.do.key != null) { tg = q('[data-knob="' + sp.do.key + '"]'); det = tg && tg.closest("details"); if (det) det.open = true; }
    else if (sp.do.action) { var bd = q(".vl-bedd"); if (bd) { bd.open = true; R.bedOpen = true; } tg = q('#vlBedW [data-k="' + sp.do.action + '"]'); }
    else if (sp.do.mode) tg = q(".vl-mode");
    if (!tg) return;
    reveal(tg);
    G.requestAnimationFrame(function () {
      // Alarm limits (U2, round 4): the whole limits card lands just below the tab bar, its heading in view and the
      // dial above the coach; if the card is taller than the clear area, the dial itself goes to the top.
      if (det) {
        var sc = q(".sp-scroll"), rb = sc && sc.getBoundingClientRect(), tb = q(".vl-tabbar"), off = tb && tb.offsetHeight && sc && sc.contains(tb) ? tb.offsetHeight : 0;
        var shift = rb ? det.getBoundingClientRect().top - (rb.top + off + 12) : 0;
        scrollTo(rb && tg.getBoundingClientRect().bottom - shift > rb.bottom - 4 ? tg : det, false);
      } else scrollTo(tg, true);
      pulse(tg); var f = tg.querySelector ? tg.querySelector(".vl-dial") || tg : tg; try { f.focus({ preventScroll: true }); } catch (e) {}
    });
  };
  A.vlcomin = function () { R.coMin = !R.coMin; if (!R.coMin && R.coAuto) { R.coAuto = false; R.coKeep = true; } paintCoach(); var b = q("[data-act=vlcomin]"); if (b) b.focus({ preventScroll: true }); if (!R.coMin) tutHighlight(); };
  // The highlighted target comes into the clear area: its tab opens on a phone, then it scrolls to the middle of the
  // visible page (the coach is outside the scroller, so the middle is always clear).
  function tutHighlight(still) {
    [].forEach.call(I.root().querySelectorAll(".vl-hl"), function (n) { n.classList.remove("vl-hl"); });
    var sp = tutStep(); if (!sp || !sp.highlight) return;
    var first = null;
    sp.highlight.forEach(function (id) { [].forEach.call(I.root().querySelectorAll('[data-vl-id="' + id + '"]'), function (n) { n.classList.add("vl-hl"); first = first || n; }); });
    if (first && !still) { reveal(first); G.requestAnimationFrame(function () { scrollTo(first, true); }); }
  }
  function tutCheck() {
    var sp = tutStep(); if (!sp || !sp.do) return;
    if (sp.do.key != null && String(R.set[sp.do.key]) === String(sp.do.to)) R.tut.ok = true;
    if (sp.do.mode && R.set.mode === sp.do.mode) R.tut.ok = true;
    if (sp.do.action && R.tut.did === sp.do.action) R.tut.ok = true;
    if (sp.do.abg && R.tut.did === "abg") R.tut.ok = true;
    if (sp.do.action && (R.acts || []).some(function (x) { return x.id === sp.do.action && x.t >= (R.tut.t0 || 0); })) R.tut.ok = true;
    if (R.tut.ok && sp.expect && !R.tut.base) { R.tut.base = R.tut.pre || { r: cur(), t: R.s.t }; if (expMet(sp, R.tut.base.r, cur())) R.tut.saw = true; }
    paintCoach();
  }
  function tutWatch(r) {
    var sp = tutStep(); if (!sp || !sp.expect || R.tut.saw || !R.tut.ok || !R.tut.base) return;
    if (expMet(sp, R.tut.base.r, r)) { R.tut.saw = true; R.tut.flat = false; paintCoach(); say(raw("sawIt", { x: expName(sp), d: raw(sp.expect.direction === "down" ? "down" : "up") })); }
    else if (!R.tut.flat && R.s.t - R.tut.base.t >= 1800) { R.tut.flat = true; paintCoach(); }
  }
  A.vltutdo = function () {
    var sp = tutStep(); if (!sp || !sp.do) return;
    var nx;
    // a bedside action or a gas: done the same way the learner's own tap does it (logged, scored, announced)
    if (sp.do.action || sp.do.abg) {
      if (sp.do.abg) A.vldraw();
      else A.vlbed(q('[data-act=vlbed][data-k="' + sp.do.action + '"]') || { getAttribute: function () { return sp.do.action; }, closest: function () { return null; } });
      nx = q("[data-act=vltutn]"); if (nx) nx.focus({ preventScroll: true });
      return;
    }
    if (sp.do.key != null) R.pend[sp.do.key] = sp.do.to; else if (sp.do.mode) R.pend.mode = sp.do.mode;
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    confirmChanges();
    var n = q("[data-act=vltutn]"); if (n) n.focus({ preventScroll: true });
  };
  A.vltutn = function (b) {
    if (b.getAttribute("data-wait") === "1") {
      // Waiting: point at what to press first instead of doing nothing.
      var sp = tutStep();
      if (!R.tut.ok && sp && sp.do && (sp.do.key != null || sp.do.mode || sp.do.action)) A.vltutshow();
      else if (R.tut.ok) { var tg = q('[data-act=vlskip][data-k="300"]'); if (tg) { pulse(tg); try { tg.focus({ preventScroll: true }); } catch (e) {} } }
      pulse($("vlCoNeed")); say(($("vlCoNeed") || {}).textContent || "");
      return;
    }
    if (R.tut.i >= R.tut.tu.steps.length - 1) { prefs().tuts[R.tut.tu.id] = 1; savePrefs(); return tutFinish(); }
    R.tut.i++; R.tut.t0 = R.s.t; tutEnter(); paintCoach(true);
  };
  A.vltutrst = function () {
    var k, ss = R.startSet || {};
    R.pend = {};
    for (k in ss) if (Object.prototype.hasOwnProperty.call(ss, k) && String(ss[k]) !== String(R.set[k]) && (setDef(k) || k === "mode")) R.pend[k] = ss[k];
    if (nPend()) confirmChanges();
    toast("event", s("restored"));
    paintCoach();
  };
  function tutClose() { R.tut = null; var c = $("vlCoach"); if (c) c.parentNode.removeChild(c); var sc = q(".vl-scroll"); if (sc) sc.classList.remove("has-coach"); tutHighlight(); paintFoot(); R.bedSig = ""; updBed(); var tb = q(".vl-tabbar"); if (tb && !q(".vl-tutrun")) tb.insertAdjacentHTML("afterend", '<p class="vl-tutrun" role="note">' + s("tutRunNote") + "</p>"); }
  function tutEnd() { tutClose(); toast("event", s("tutPractice")); var m = q(".vl-mode"); if (m) m.focus({ preventScroll: true }); }
  A.vltutx = function () { tutEnd(); };
  // A tutorial that changes a setting or the mode closes with the real-ward rule (round 5, U11).
  function tutChanges(tu) { return (tu.steps || []).some(function (x) { return x.do && ((x.do.key != null && ALARM_KEYS.indexOf(x.do.key) < 0) || x.do.mode); }); }
  // Finish card (round 5, U2): "Done! Next: <the next step on the path>", with Next and Back to the lab. Staying on the
  // practice patient is a choice (the quiet third button, or closing the card), never where the learner is left.
  function tutNext(doneId) {
    if (lv() <= 2) { var nx = pathNext(pathSteps()); return nx ? { k: nx.k, title: nx.title, tut: nx.k.indexOf("t:") === 0 } : null; }
    var td = prefs().tuts, tu = (learn().tutorials || []).filter(function (x) { return x.id !== doneId && !td[x.id] && (x.level || 1) <= lv(); })[0];
    return tu ? { k: "t:" + tu.id, title: tx(tu.title), tut: true } : null;
  }
  function tutFinish() {
    var tu = R.tut.tu, nx = tutNext(tu.id);
    tutClose();
    I.haptic("success");
    R.finNext = nx ? nx.k : null;
    sheet(s("finH"), '<div class="vl-fin"><p class="vl-fin-d">' + (ico("check") ? '<span class="vl-fin-i" aria-hidden="true">' + ico("check") + "</span>" : "") + "<span>" + s("finDone", { x: t(tu.title) }) + "</span></p>" +
      (tutChanges(tu) ? '<p class="vl-senior" role="note">' + s("seniorTut") + "</p>" : "") +
      '<p class="vl-fin-n">' + (nx ? s("finNext", { x: "" }).replace(/\s*$/, " ") + "<b>" + nx.title + "</b>" : s("finAll")) + "</p></div>",
      '<div class="vl-fin-f">' + (nx ? '<button type="button" class="sp-btn pri" data-act="vlfingo">' + s(nx.tut ? "finNextT" : "finGo") + "</button>" : "") +
      '<button type="button" class="sp-btn sec" data-act="vlfinlab">' + s("backLab") + '</button><button type="button" class="vl-co-link vl-fin-stay" data-act="vlfinstay">' + s("finStay") + "</button></div>", q(".vl-mode"));
  }
  A.vlfingo = function () { var k = R && R.finNext; closeSheet(true); stopLive(); goPath(k); };
  A.vlfinlab = function () { closeSheet(true); stopLive(); home(lv() <= 2 ? ".vl-path .next .vl-pstep" : null); };
  A.vlfinstay = function () { closeSheet(true); toast("event", s("tutPractice")); var m = q(".vl-mode"); if (m) m.focus({ preventScroll: true }); };

  /* ================= debrief ================= */
  A.vlfinish = function () {
    if (!R) return;
    var e = E(), r = cur();
    closeSheet(true); stopLive();
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: "finish" });
    R.score = safe(function () { return e.score({ scenario: R.sc, scenarioId: R.sc.id, log: R.log, answers: finalAnswers(), arrest: R.arrest, tutorial: !!R.fromTut }); }, { total: 0, parts: {}, notes: [] });
    R.final = r;
    var ok = (R.score.total || 0) >= 70 && !R.arrest, today = I.today();
    // A tutorial's practice patient is never a scored run: no hub count, no "best", and the patient's own save stays (U5).
    if (!R.fromTut && R.score.countsForBest !== false) {
      dropSaved(R.sc.id);
      if (C && st.store) { try { C.recordSim(st.store, "ventlab", ok, ok ? null : "low", today); I.save(); } catch (x) {} }
      var b = prefs().best; b[R.sc.id] = Math.max(b[R.sc.id] || 0, R.score.total || 0); savePrefs();
    }
    I.haptic(ok ? "success" : "error");
    debrief(".vl-score");
    countUp();
  };
  // The score counts up once (700 ms, strong ease-out) as the debrief opens; the bars grow in a short stagger (CSS).
  function countUp() {
    var b = q(".vl-score b"), to = +((R.score || {}).total || 0);
    if (!b || reduced() || !G.requestAnimationFrame || to <= 0) return;
    var t0 = 0, D = 700;
    function ease(x) { var u = 1 - x; return 1 - u * u * u * u; }
    function f(now) { if (!t0) t0 = now; var x = Math.min(1, (now - t0) / D); b.textContent = I.fmt(Math.round(to * ease(x))); if (x < 1 && st.view === "vl-done") G.requestAnimationFrame(f); else b.textContent = I.fmt(to); }
    b.setAttribute("aria-label", I.fmt(to)); b.textContent = "0"; G.requestAnimationFrame(f);
    var l = q(".vl-parts"); if (l) l.classList.add("grow");
  }
  function anyTx(v) { return v == null ? "" : typeof v === "string" ? esc(v) : v.en || v.hi ? tx(v) : v.text ? tx(v.text) : v.because ? tx(v.because) : ""; }
  // One sentence per part: the engine's own explanation when it gives one, else what the run log shows.
  function partWhy(k, sco) {
    var src = sco.explain || sco.why || sco.partNotes || sco.partWhy || {}, v = src[k];
    var labs = R.alLab || {}, seenIds = Object.keys(labs);
    if (k === "alarms") {
      // name every alarm that went unanswered, with its time (U12); an unscored part says which alarms did sound
      var missed = finalAnswers().filter(function (a) { return a.kind === "alarm" && !a.correct; }).map(function (a) { return s("missedAl", { x: labs[a.id] ? t(labs[a.id]) : a.id, t: clockText(a.t != null ? a.t : 0) }); });
      var scored = R.answers.some(function (a) { return a.kind === "alarm"; }) || missed.length;
      if (!scored) return seenIds.length ? s("px_alarmsUnsc", { x: seenIds.map(function (id) { return t(labs[id]); }).join(", ") }) : s("px_alarmsNone2");
      return (v ? anyTx(v) : s("px_alarms")) + (missed.length ? " " + missed.join(" ") : "");
    }
    if (v) return anyTx(v);
    if (k === "abg" && !R.abgs.length) return s("px_abgNone");
    return STR["px_" + k] ? s("px_" + k) : "";
  }
  // Unsafe moments with their sim time: the engine's list when present, else from the run log after the first 10 min.
  function unsafeList(sco) {
    var u = sco.unsafeMoments || sco.unsafeList || (Array.isArray(sco.unsafe) ? sco.unsafe : null);
    if (u) return u.map(function (x) { return (x.t != null ? "<b>" + esc(clockText(x.t)) + "</b> " : "") + anyTx(x.label || x.what || x.text || x); });
    var out = [], on = {}, i, x, v, vv;
    for (i = 0; i < R.log.length; i++) {
      x = R.log[i]; if (!x.readout || x.t < 600) continue;
      v = x.readout.vitals || {}; vv = x.readout.vent || {};
      [["spo2", v.spo2 != null && v.spo2 < 85, "us_spo2", v.spo2], ["map", v.map != null && v.map < 55, "us_map", v.map], ["pplat", vv.pplat != null && vv.pplat > 35 && !SPONT[(x.settings || {}).mode], "us_pplat", vv.pplat]].forEach(function (c) {
        if (c[1] && !on[c[0]]) { on[c[0]] = 1; out.push(s(c[2], { v: fmtN(c[3]), t: clockText(x.t) })); }
        else if (!c[1]) on[c[0]] = 0;
      });
    }
    return out.slice(0, 8);
  }
  function debrief(focusSel) {
    var sc = R.sc, sco = R.score, r = R.final, g = sc.goals || {}, kg = ptPbw(sc), fio2 = (R.set || {}).fio2;
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-done"; st.again = debrief;
    st.onBack = function () { home(); return true; };
    glossReset();
    var MX = E().SCORE_MAX || {};
    var iP = 0, parts = Object.keys(sco.parts || {}).map(function (k) {
      var v = +sco.parts[k] || 0, mx = MX[k], why = partWhy(k, sco);
      // null = not part of this run (no such decision made): say why instead of showing a zero
      if (sco.parts[k] === null) return '<li class="vl-pna"><span class="vl-pl">' + s("p_" + k) + '</span><span class="vl-pnote vl-pwhy">' + why + "</span><b>" + s("notScored") + "</b></li>";
      if (k === "unsafe") return v < 0 ? '<li class="vl-pen"><span class="vl-pl">' + s("p_unsafe") + '</span><span class="vl-pnote">' + s("penalty") + "</span><b>" + I.fmt(v) + "</b>" + (why ? '<p class="vl-pwhy">' + why + "</p>" : "") + "</li>" : "";
      var pct = mx ? clamp(v / mx * 100, 0, 100) : clamp(v, 0, 100);
      return '<li><span class="vl-pl">' + s("p_" + k) + '</span><span class="vl-pbar ' + (pct >= 80 ? "hi" : pct >= 40 ? "mid" : "lo") + '" aria-hidden="true"><i style="width:' + pct.toFixed(0) + '%;--i:' + (iP++) + '"></i></span><b>' + I.fmt(v) + (mx ? '<small>/' + mx + "</small>" : "") + "</b>" + (why ? '<p class="vl-pwhy">' + why + "</p>" : "") + "</li>";
    }).join("");
    var v = r.vitals || {}, vv = r.vent || {}, gs = r.gas || {}, tg = [];
    function goal(lab, val, ok, note) { tg.push("<tr><th scope=\"row\">" + lab + "</th><td>" + val + '</td><td class="' + (ok ? "ok" : "bad") + '">' + (note || s(ok ? "met" : "notMet")) + "</td></tr>"); }
    if (g.spo2) {
      var hiS = v.spo2 > g.spo2[1], okS = v.spo2 >= g.spo2[0] && (!hiS || fio2 <= 50);
      goal("SpO2 " + g.spo2[0] + " to " + g.spo2[1], fmtN(v.spo2), okS, hiS ? s(okS ? "okHigh" : "weanO2") : null);
    }
    if (g.paco2) goal("PaCO2 " + g.paco2[0] + " to " + g.paco2[1], fmtN(gs.paco2), gs.paco2 >= g.paco2[0] && gs.paco2 <= g.paco2[1]);
    if (g.ph) goal("pH " + g.ph[0] + " to " + g.ph[1], fmtN(gs.ph), gs.ph >= g.ph[0] && gs.ph <= g.ph[1]);
    if (g.pplatMax && !SPONT[R.set.mode]) goal("Pplat &le; " + g.pplatMax, fmtN(vv.pplat), vv.pplat <= g.pplatMax);
    if (g.drivingMax && vv.drivingP != null && !SPONT[R.set.mode]) goal("Driving P &le; " + g.drivingMax, fmtN(vv.drivingP), vv.drivingP <= g.drivingMax);
    if (g.vtPerKg && vv.vte) {
      var pk = Math.round(vv.vte / kg * 10) / 10;
      if (SPONT[R.set.mode] || R.set.mode === "aprv") tg.push('<tr><th scope="row">VT ' + g.vtPerKg[0] + " to " + g.vtPerKg[1] + " mL/kg</th><td>" + fmtN(pk) + '</td><td class="nsc">' + s("ownNotScored") + "</td></tr>");
      else goal("VT " + g.vtPerKg[0] + " to " + g.vtPerKg[1] + " mL/kg", fmtN(pk), pk >= g.vtPerKg[0] - 0.3 && pk <= g.vtPerKg[1] + 0.3);
    }
    var ws = sco.worstSpell, wsEn = ws && ws.what ? "Longest time off a goal" : null;
    var us = unsafeList(sco), notes = (sco.notes || []).filter(function (n) { return !(wsEn && n && n.en && n.en.indexOf(wsEn) === 0); }).map(anyTx).filter(Boolean), good = sco.goodRun || sco.good || sco.goodRunDescription;
    // the engine's "nothing to improve" note (its first note then) leads the debrief instead of hiding in the takeaways
    var noimp = sco.nothingToImprove ? (notes.length ? notes.shift() : s("noImprove")) : null;
    var worst = ws && ws.what ? '<div class="vl-worst" role="note"><p class="vl-o2h-h"><b>' + s("worstH") + "</b></p><p>" + s("worstLine", { x: t(ws.what), a: ws.fromMin, b: ws.toMin, m: ws.minutes }) + "</p></div>" : "";
    var key = (sc.debrief || []).map(function (n) { return txg(n); });
    var tone = R.arrest ? "bad" : sco.total >= 80 ? "ok" : sco.total >= 60 ? "mid" : "bad";
    I.paint(I.top(t(STR.backLab), s("debrief"), tx(sc.title), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vl-done">' +
      (R.arrest ? '<div class="vl-arrest vl-arrest-d" role="note"><h2 class="vl-h">' + s("arrestH") + "</h2>" + arrestHtml() + "</div>" : "") +
      '<div class="vl-score ' + tone + '" tabindex="-1"><b>' + I.fmt(sco.total || 0) + "</b><span>" + s("outOf") + "</span></div>" +
      // engine r5: a patient on target at the start says so, and the run does not count as a best (E6)
      (noimp ? '<p class="vl-worst vl-noimp" role="note">' + noimp + "</p>" : "") +
      '<ul class="vl-parts">' + parts + "</ul>" + worst +
      '<h2 class="sp-h2">' + s("unsafeH") + "</h2>" + (us.length ? '<ul class="dr-lines vl-notes vl-unsafe">' + us.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" : '<p class="vl-empty">' + s("unsafeNone") + "</p>") +
      (tg.length ? '<h2 class="sp-h2">' + s("atEndT", { t: clockText(R.s.t) }) + '</h2><table class="vl-goals"><tbody>' + tg.join("") + "</tbody></table>" + (sco.goals && sco.goals.missedText ? '<p class="vl-plain">' + anyTx(sco.goals.missedText) + "</p>" : "") : "") +
      (notes.length ? '<h2 class="sp-h2">' + s("takeaway") + '</h2><ul class="dr-lines vl-notes">' + notes.map(function (n) { return "<li>" + n + "</li>"; }).join("") + "</ul>" : "") +
      (good ? '<h2 class="sp-h2">' + s("goodH") + '</h2><div class="vl-good">' + (Array.isArray(good) ? "<ul>" + good.map(function (x) { return "<li>" + anyTx(x) + "</li>"; }).join("") + "</ul>" : "<p>" + anyTx(good) + "</p>") + "</div>"
        : key.length ? '<h2 class="sp-h2">' + s("goodH") + '</h2><ul class="dr-lines vl-notes">' + key.map(function (n) { return "<li>" + n + "</li>"; }).join("") + "</ul>" : "") +
      I.maikBtn(STR.maikQ.en + ": " + (sc.title && sc.title.en) + ". Score " + sco.total + ". " + (sco.notes || []).map(function (n) { return typeof n === "string" ? n : n.en; }).join(" ") + " Explain what the best ventilator settings would have been and why.") +
      '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + "</span></p></div></div>" +
      '<div class="sp-foot"><div class="mcq-foot2"><button type="button" class="sp-btn sec" data-act="vlhome">' + s("labHome") + '</button><button type="button" class="sp-btn pri" data-act="vlrerun">' + s("again") + "</button></div></div>",
      typeof focusSel === "string" ? focusSel : null);
  }
  A.vlhome = function () { home(); };
  A.vlrerun = function () { if (R) { if (!R.fromTut) dropSaved(R.sc.id); start(forLevel(scById(R.sc.id) || R.sc)); } };

  /* ================= what-if sandbox ================= */
  var WI = { sc: null, key: null, dir: 1, preset: null, res: null };
  A.vlwhat = function () { WI.res = null; WI.preset = null; whatIf(); };
  function whatIf(focusSel) {
    var e = E();
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-what"; st.again = whatIf;
    st.onBack = function () { home("[data-act=vlwhat]"); return true; };
    var open = VL.scen.filter(function (x) { return (x.level || 1) <= lv(); });
    if (!WI.sc || !scById(WI.sc) || open.indexOf(scById(WI.sc)) < 0) WI.sc = (open[0] || VL.scen[0]).id;
    var sc = scById(WI.sc), set0 = baseSettings(sc), keys = visSettings(set0.mode, lv()).filter(function (k) { return !setDef(k).options; });
    if (!WI.key || keys.indexOf(WI.key) < 0) WI.key = keys[0];
    var presets = (learn().whatIf || []).filter(function (p) { return keys.indexOf(p.key) >= 0; });
    var scOpts = open.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === WI.sc ? " selected" : "") + ">" + tx(x.title) + "</option>"; }).join("");
    I.paint(I.top(t(STR.backLab), s("whatIf"), s("whatIfSub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="vl-wrap vl-wi">' +
      '<div class="vl-wi-pick"><label class="vl-field"><span>' + s("wiPatient") + '</span><select id="vlWiSc" data-vlsel="sc">' + scOpts + "</select></label>" +
      (presets.length ? '<h2 class="sp-h2">' + s("wiPick") + '</h2><ul class="vl-chips">' + presets.map(function (p, i) {
        return '<li><button type="button" class="vl-chip2" data-act="vlwip" data-k="' + i + '" aria-pressed="' + (WI.preset === i) + '">' + tx(p.label) + "</button></li>";
      }).join("") + "</ul>" : "") +
      '<h2 class="sp-h2">' + s("wiBuild") + "</h2>" +
      '<div class="vl-wi-b"><label class="vl-field"><span>' + s("wiSetting") + '</span><select id="vlWiK" data-vlsel="key">' + keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === WI.key ? " selected" : "") + ">" + esc(setLabel(k)) + "</option>"; }).join("") + "</select></label>" +
      '<div class="vl-field"><span id="vlWiDl">' + s("wiDir") + '</span><div class="sp-seg" role="group" aria-labelledby="vlWiDl"><button type="button" data-act="vlwid" data-v="1" aria-pressed="' + (WI.dir > 0) + '">' + s("wiUp") + '</button><button type="button" data-act="vlwid" data-v="-1" aria-pressed="' + (WI.dir < 0) + '">' + s("wiDown") + "</button></div></div>" +
      '<button type="button" class="sp-btn pri" data-act="vlwigo">' + s("wiGo") + "</button></div></div>" +
      '<div class="vl-wi-res" id="vlWiRes" tabindex="-1">' + (WI.res ? wiResHtml(WI.res) : '<p class="vl-empty">' + s("wiEmpty") + "</p>") + "</div>" +
      '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + "</span></p></div></div>", typeof focusSel === "string" ? focusSel : null);
    if (WI.res) { WI.res.chain = fresh(WI.res.chain); var box = $("vlChain"); if (box) box.innerHTML = chainBody(WI.res.chain, true, true); }
  }
  function wiCompute(key, dir, presetChain) {
    var e = E(), sc = scById(WI.sc), st0 = e.init(clone(sc), null), set0 = baseSettings(sc), d = setDef(key);
    var to = stepVal(d, set0[key], dir, WI_DELTA[key] ? WI_DELTA[key] / (d.step || 1) : 4), set1 = clone(set0); set1[key] = to;
    var wi = safe(function () { return e.whatIf(st0, set0, { key: key, to: to }); }, null) || {};
    var pB = safe(function () { return e.step(clone(st0), set0, 1800); }, st0), pA = safe(function () { return e.step(clone(st0), set1, 1800); }, st0);
    // Three columns from the engine when it gives them (now / without / with), else computed here from one baseline.
    var now = wi.now || e.readout(st0, set0), prB = wi.without || wi.before || e.readout(pB, set0), prA = wi["with"] || wi.after || e.readout(pA, set1);
    var reasons = safe(function () { return e.explainDelta(e.abg(pB), e.abg(pA), set0, set1, pB, pA); }, []);
    var chain = compose({ setB: set0, setA: set1, keys: [key], roB: e.readout(st0, set0), roA: e.readout(st0, set1), now: now, prB: prB, prA: prA, reasons: reasons, wiChain: presetChain });
    return { key: key, from: set0[key], to: to, now: now, before: prB, after: prA, chain: chain };
  }
  // One-sentence verdict (U5, round 4): what the change does in 30 min to oxygen, CO2 (or pH) and blood pressure, judged
  // against this patient's own goals: Helps, Trade off, Makes it worse, or Little change. b = without, a = with.
  function verdictHtml(b, a, g, withPh) {
    g = g || {};
    var items = [], good = 0, bad = 0;
    function dist(x, rg) { return x == null || !rg ? 0 : x < rg[0] ? rg[0] - x : x > rg[1] ? x - rg[1] : 0; }
    function add(x, va, vb, eps, judge) {
      if (va == null || vb == null || Math.abs(vb - va) < eps) return;
      var j = judge(va, vb); if (j > 0) good++; else if (j < 0) bad++;
      items.push(raw(vb > va ? "vdUp" : "vdDn", { x: x, a: fmtN(va), b: fmtN(vb) }));
    }
    var sp = g.spo2 || [92, 98], co = g.paco2 || (g.ph ? null : [35, 45]);
    add("SpO2", gv(b, "vitals", "spo2"), gv(a, "vitals", "spo2"), 1, function (x, y) { return y > x ? (x < sp[1] ? 1 : 0) : (y < sp[0] ? -1 : 0); });
    add("PaCO2", gv(b, "gas", "paco2"), gv(a, "gas", "paco2"), 2, function (x, y) {
      if (co) { var d0 = dist(x, co), d1 = dist(y, co); return d1 < d0 - 1 ? 1 : d1 > d0 + 1 ? -1 : 0; }
      var p0 = dist(gv(b, "gas", "ph"), g.ph), p1 = dist(gv(a, "gas", "ph"), g.ph); return p1 < p0 - 0.01 ? 1 : p1 > p0 + 0.01 ? -1 : 0;
    });
    if (withPh) add("pH", gv(b, "gas", "ph"), gv(a, "gas", "ph"), 0.02, function (x, y) { var r = g.ph || [7.35, 7.45], d0 = dist(x, r), d1 = dist(y, r); return d1 < d0 ? 1 : d1 > d0 ? -1 : 0; });
    add(raw("vdMap"), gv(b, "vitals", "map"), gv(a, "vitals", "map"), 3, function (x, y) { return y < x ? (y < 65 || x - y >= 8 ? -1 : 0) : (x < 65 ? 1 : 0); });
    var pl0 = gv(b, "vent", "pplat"), pl1 = gv(a, "vent", "pplat"), pmax = g.pplatMax || 30;
    if (pl1 != null && pl0 != null && pl1 > pmax && pl1 > pl0 + 1) { bad++; items.push(raw("vdPlat", { b: fmtN(pl1) })); }
    var tag = !items.length ? "vd_none" : bad && good ? "vd_mix" : bad ? "vd_bad" : good ? "vd_good" : "vd_none";
    var list = items.length > 1 ? items.slice(0, -1).join(", ") + raw("vdAnd") + items[items.length - 1] : items[0];
    var line = items.length ? raw("vdLine", { x: list }) : raw("vdNone");
    return '<p class="vl-verdict vd-' + tag.slice(3) + '"><b>' + s(tag) + ":</b> " + esc(line) + "</p>";
  }
  function wiResHtml(res) {
    var u = setUnit(res.key);
    return '<h2 class="vl-h vl-wi-h">' + s("cSet", { x: setLabel(res.key), a: setText(res.key, res.from) + (u ? " " + u : ""), b: setText(res.key, res.to) + (u ? " " + u : "") }) + "</h2>" +
      verdictHtml(res.before, res.after, (scById(WI.sc) || {}).goals) +
      '<div class="vl-wi-grid"><div class="vl-card">' + p3Html(res.now, res.before, res.after, [["Pplat", "vent", "pplat", "cmH2O"], ["Driving P", "vent", "drivingP", "cmH2O"], ["Auto-PEEP", "vent", "autoPeep", "cmH2O"]], "vl-ba") +
      '<p class="sp-small">' + s("simulated") + "</p></div>" +
      '<section class="vl-card vl-chainw" aria-labelledby="vlChH"><h2 class="vl-h" id="vlChH">' + s("chain") + '</h2><div id="vlChain"></div></section></div>';
  }
  function wiRun(key, dir, presetChain, preset) {
    WI.key = key; WI.dir = dir; WI.preset = preset;
    WI.res = wiCompute(key, dir, presetChain);
    whatIf("#vlWiRes");
    var box = $("vlChain"), c = WI.res.chain;
    if (box && !reduced()) {
      box.innerHTML = chainBody(c, false, true);
      CHT.forEach(function (x) { G.clearTimeout(x); }); CHT = [];
      staggerChain(box, c);
    }
    say(c.say);
    scrollTo($("vlWiRes"), false);
  }
  A.vlwip = function (b) { var p = (learn().whatIf || []).filter(function (x) { return visSettings(baseSettings(scById(WI.sc)).mode, lv()).indexOf(x.key) >= 0; })[+b.getAttribute("data-k")]; if (p) wiRun(p.key, p.direction === "down" ? -1 : 1, p.chain, +b.getAttribute("data-k")); };
  A.vlwid = function (b) { WI.dir = +b.getAttribute("data-v"); whatIf('[data-act=vlwid][data-v="' + WI.dir + '"]'); };
  A.vlwigo = function () { var k = $("vlWiK"); wiRun(k ? k.value : WI.key, WI.dir, null, null); };
  function onSel(e) {
    var el = e.target, k = el && el.getAttribute && el.getAttribute("data-vlsel");
    if (!k) return;
    if (k === "sc") { WI.sc = el.value; WI.res = null; WI.preset = null; whatIf("#vlWiSc"); }
    if (k === "key") { WI.key = el.value; }
  }

  /* ================= ABG reasoning cases ================= */
  // Cases are filtered by level (the case's own level, else its patient's). Each opens with the patient in one line
  // and the current settings; the result is run from the case's own state (E.caseState), so Before is the case gas.
  var CS = { i: 0, a1: null, a2: null, res: null };
  function caseLevel(c) { var sc = scById(c.scenario); return c.level || (sc && sc.level) || 1; }
  function caseList() { var all = learn().cases || [], o = all.filter(function (c) { return caseLevel(c) <= lv(); }); return o.length ? o : all; }
  A.vlcases = function () { CS.i = 0; CS.a1 = null; CS.a2 = null; CS.res = null; caseView(); };
  function optText(o) { return o && o.label ? tx(o.label) : tx(o); }
  // {s, st} for the case: the engine's E.caseState when present (it may return {s, st} or a state with .settings).
  function caseSt(c, sc) {
    var e = E();
    if (!e.caseState || !sc) return null;
    var x = safe(function () { return e.caseState(clone(sc), c.setup || c, c); }, null);
    if (!x) return null;
    if (x.s && x.st) return x;
    if (x.state) return { s: x.state, st: x.settings || x.state.settings };
    return x.settings ? { s: x, st: clone(x.settings) } : null;
  }
  function setLine(set) {
    if (!set) return "";
    var m = E().MODES && E().MODES[set.mode], keys = ((m && m.controls) || []).filter(function (k) { return ["vt", "pinsp", "ps", "rr", "peep", "fio2", "ipap", "epap", "phigh", "plow"].indexOf(k) >= 0; });
    return "<b>" + esc(modeShort(set.mode)) + "</b> · " + keys.map(function (k) { return esc(setLabel(k)) + " " + esc(setText(k, set[k])) + (setUnit(k) ? " " + esc(setUnit(k)) : ""); }).join(" · ");
  }
  function caseView(focusSel) {
    var list = caseList(), c = list[CS.i], beg = lv() <= 1, sc0 = q(".sp-scroll"), keepTop = st.view === "vl-case" && sc0 ? sc0.scrollTop : 0;
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-case"; st.again = caseView;
    st.onBack = function () { home("[data-act=vlcases]"); return true; };
    if (!c) return home();
    glossReset();
    var ab = c.abg || {}, sc = scById(c.scenario), cs = caseSt(c, sc);
    var shown = beg ? ["pH", "PaCO2", "PaO2"] : null;
    var card = ABG_ROWS.filter(function (x) { return ab[x[0]] != null && (!shown || shown.indexOf(x[0]) >= 0); }).map(function (x) {
      var v = ab[x[0]], lo = v < x[2], hi = v > x[3];
      return '<div class="' + (lo || hi ? "out" : "") + '"><dt>' + (x[1] === "lact" ? s("lact") : esc(x[1])) + (beg && STR["ab_" + x[0]] ? '<span class="vl-abg-d">' + s("ab_" + x[0]) + "</span>" : "") + "</dt><dd><b>" + esc(fmtN(v)) + "</b>" + (lo || hi ? '<span class="vl-flag">' + s(lo ? "low" : "high") + "</span>" : "") +
        '<small>' + s("normal", { a: x[2], b: x[3] }) + "</small></dd></div>";
    }).join("") + (ab.FiO2 != null ? "<div><dt>FiO2</dt><dd><b>" + esc(fmtN(ab.FiO2 <= 1 ? Math.round(ab.FiO2 * 100) : ab.FiO2)) + "</b><small>%</small></dd></div>" : "") + (c.spo2 != null ? "<div><dt>SpO2</dt><dd><b>" + esc(fmtN(c.spo2)) + "</b><small>%</small></dd></div>" : "");
    var setNow = cs ? cs.st : null;
    if (!setNow && sc) { setNow = baseSettings(sc); var ss = (c.setup && c.setup.settings) || c.settings || {}, k0; for (k0 in ss) if (Object.prototype.hasOwnProperty.call(ss, k0)) setNow[k0] = ss[k0]; if (ab.FiO2 != null) setNow.fio2 = ab.FiO2 <= 1 ? Math.round(ab.FiO2 * 100) : ab.FiO2; }
    var vig = c.vignette ? txg(c.vignette) : sc ? txg(sc.patient && sc.patient.diagnosis) : "";
    function opts(qq, act, ans) {
      return '<div class="sp-answers' + (ans != null ? " done" : "") + '" role="group">' + (qq.options || []).map(function (o, j) {
        var state = ans == null ? "" : j === qq.answer ? "right" : j === ans ? "wrong" : "dim";
        return '<button type="button" class="sp-ans" data-act="' + act + '" data-o="' + j + '"' + (state ? ' data-state="' + state + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + (state === "right" ? ico("check") || "A" : state === "wrong" ? ico("close") || "x" : "ABCD".charAt(j)) + "</span>" + optText(o) + "</button>";
      }).join("") + "</div>";
    }
    function verdict(cls, ok, qq) { return '<p class="sp-verdict ' + cls + " " + (ok ? "ok" : "bad") + '" tabindex="-1">' + (ico(ok ? "check" : "close") || "") + "<span>" + s(ok ? "right" : "wrong") + "</span></p>" + (ok ? "" : '<p class="vl-ans">' + s("caseAns", { x: t(qq.options[qq.answer] && (qq.options[qq.answer].label || qq.options[qq.answer])) }) + "</p>"); }
    var q1 = c.q1 || {}, q2 = c.q2 || {};
    var h = '<div class="vl-card vl-vig">' + (vig ? '<p><b>' + s("vignette") + ":</b> " + vig + "</p>" : "") + (setNow ? '<p class="vl-vig-set"><b>' + s("caseSet") + ":</b> " + setLine(setNow) + "</p>" : "") + "</div>" +
      '<div class="vl-card vl-abgcard" aria-label="ABG"><dl>' + card + "</dl></div>" +
      '<h2 class="sp-h3 vl-q" id="vlQ1">' + s("q1") + ": " + txg(q1.ask) + "</h2>" + opts(q1, "vlq1", CS.a1);
    if (CS.a1 != null) {
      var ipc = E().interpretAbg ? safe(function () { return E().interpretAbg(c.abg); }, null) : null;
      h += verdict("vl-v1", CS.a1 === q1.answer, q1) + (q1.why ? '<p class="vl-whyp">' + txg(q1.why) + "</p>" : "") + interpHtml(ipc, beg) +
        (CS.a2 == null ? '<p class="vl-cue" aria-hidden="true">' + s("caseCue") + (ico("chev") ? '<span class="vl-cue-i">' + ico("chev") + "</span>" : "") + "</p>" : "") +
        '<h2 class="sp-h3 vl-q" id="vlQ2">' + s("q2") + ": " + txg(q2.ask) + "</h2>" + opts(q2, "vlq2", CS.a2);
    }
    if (CS.a2 != null) {
      var rr = CS.res;
      h += verdict("vl-v2", CS.a2 === q2.answer, q2) + (rr && rr.after ? caseVerdict(caseBefore(rr, c), rr.after, sc && sc.goals, CS.a2 === q2.answer) : "") +
        (q2.why ? '<h3 class="vl-h3">' + s("whyH") + '</h3><p class="vl-whyp">' + txg(q2.why) + "</p>" : "") +
        (rr && rr.applied && rr.applied.length ? '<p class="vl-applied"><b>' + s("applied") + ":</b> " + rr.applied.map(function (x) { return esc(setLabel(x.k)) + " " + esc(setText(x.k, x.a)) + " &rarr; " + esc(setText(x.k, x.b)) + (setUnit(x.k) ? " " + esc(setUnit(x.k)) : ""); }).join(" · ") + "</p>" : "") +
        (rr && rr.after ? '<h3 class="vl-h3">' + s("result") + '</h3><div class="vl-card">' + caseResult(rr, c) + "</div>" : '<p class="vl-empty">' + s("caseNoSim") + "</p>") +
        (rr && rr.reasons.length ? whyList(rr.reasons, beg) : "");
    }
    I.paint(I.top(t(STR.backLab), s("cases"), s("caseOf", { i: CS.i + 1, n: list.length }), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vl-case">' + h + '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + "</span></p></div></div>" +
      (CS.a2 != null ? '<div class="sp-foot"><button type="button" class="sp-btn pri sp-wide" data-act="vlcnext">' + s(CS.i < list.length - 1 ? "nextCase" : "labHome") + "</button></div>" : ""),
      typeof focusSel === "string" ? focusSel : null);
    // the answer's verdict comes into view where the learner is reading, never back at the top (round 5, U8, S4)
    var scN = q(".sp-scroll"); if (scN && keepTop) scN.scrollTop = keepTop;
    var vf = typeof focusSel === "string" ? q(focusSel) : null;
    if (vf && scN) G.requestAnimationFrame(function () { scrollTo(vf, false); try { vf.focus({ preventScroll: true }); } catch (e) {} });
  }
  // A wrong answer's verdict leads with what is still wrong 30 min later, never "Little change" (round 5, U8)
  function caseVerdict(b, a, g, ok) {
    var h = verdictHtml(b, a, g, true);
    if (ok) return h;
    g = g || {};
    var sp = g.spo2 || [92, 98], co = g.paco2 || (g.ph ? null : [35, 45]), ph = g.ph || [7.35, 7.45], off = [];
    var v = gv(a, "vitals", "spo2"), pc = gv(a, "gas", "paco2"), p = gv(a, "gas", "ph"), m = gv(a, "vitals", "map");
    if (v != null && v < sp[0]) off.push("SpO2 " + fmtN(v));
    if (pc != null && co && (pc < co[0] || pc > co[1])) off.push("PaCO2 " + fmtN(pc));
    if (p != null && (p < ph[0] || p > ph[1])) off.push("pH " + fmtN(p));
    if (m != null && m < 65) off.push("MAP " + fmtN(m));
    if (off.length) return '<p class="vl-verdict vd-bad"><b>' + s("vdWrong") + "</b> " + s("vdOff", { x: off.join(", ") }) + "</p>";
    return h.replace("vd-none", "vd-bad").replace("<b>" + s("vd_none") + ":</b>", "<b>" + s("vdWrong") + "</b>");
  }
  // "Why" lines under a gas: Level 1 one plain line per gas and direction, the engine's formulas under More detail.
  function whyList(rs, beg) {
    // a reason about the future (engine r5 prediction + horizonMin) says so: "In 30 min (prediction)"
    var li = function (x, txt) { return "<li>" + arrow(x.direction === "down" ? -1 : 1) + "<span><b>" + esc(x.param || "") + "</b> " + (x.prediction ? '<small class="vl-pred">' + s("predIn", { m: x.horizonMin || 30 }) + "</small> " : "") + txt + "</span></li>"; };
    if (!beg) return '<ul class="vl-why">' + rs.map(function (x) { return li(x, tx(x.because)); }).join("") + "</ul>";
    var seen = {}, pl = rs.filter(function (x) { var k = x.param + x.direction; if (seen[k]) return false; seen[k] = 1; return true; });
    return '<ul class="vl-why">' + pl.map(function (x) { return li(x, esc(plainWhy(x))); }).join("") + "</ul>" +
      '<details class="vl-more"><summary>' + s("moreDetail") + '</summary><ul class="vl-why">' + rs.map(function (x) { return li(x, tx(x.because)); }).join("") + "</ul></details>";
  }
  // The verdict reads the same Before as the table: the case's own gas where it has a number, else the engine's.
  function caseBefore(rr, c) {
    var ab = c.abg || {}, b = clone(rr.before) || {};
    b.vitals = b.vitals || {}; b.gas = b.gas || {};
    if (c.spo2 != null) b.vitals.spo2 = c.spo2;
    if (ab.PaCO2 != null) b.gas.paco2 = ab.PaCO2;
    if (ab.pH != null) b.gas.ph = ab.pH;
    return b;
  }
  // Before = the case's own gas; after = the engine 30 min after the chosen change, from the case's own state.
  function caseResult(rr, c) {
    var ab = c.abg || {}, rows = [["pH", "ph", "pH"], ["PaCO2", "paco2", "PaCO2"], ["PaO2", "pao2", "PaO2"], ["HCO3", "hco3", "HCO3"], ["SaO2", "sao2", "SaO2"]];
    if (lv() <= 1) rows = rows.slice(0, 3);
    return '<table class="vl-abgt vl-ba"><thead><tr><th scope="col"><span class="sp-sr">ABG</span></th><th scope="col">' + s("caseBefore") + '</th><th scope="col">' + s("caseAfter") + '</th><th scope="col"><span class="sp-sr">' + s("whyH") + "</span></th></tr></thead><tbody>" +
      rows.map(function (x) {
        var a = ab[x[2]] != null ? ab[x[2]] : (rr.before.gas || {})[x[1]], b = (rr.after.gas || {})[x[1]], d = dirOf(a, b, x[1] === "ph" ? 0.004 : 0.5);
        return '<tr><th scope="row">' + x[0] + "</th><td>" + esc(fmtN(a)) + "</td><td><b>" + esc(fmtN(b)) + "</b></td><td>" + arrow(d) + '<span class="sp-sr">' + s(d > 0 ? "up" : d < 0 ? "down" : "same") + "</span></td></tr>";
      }).join("") + "</tbody></table>";
  }
  A.vlq1 = function (b) { if (CS.a1 != null) return; var c = caseList()[CS.i]; CS.a1 = +b.getAttribute("data-o"); I.haptic(CS.a1 === c.q1.answer ? "success" : "error"); caseView(".vl-v1"); };
  A.vlq2 = function (b) {
    if (CS.a2 != null) return;
    var c = caseList()[CS.i], j = +b.getAttribute("data-o"), opt = (c.q2.options || [])[j], e = E(), sc = scById(c.scenario) || VL.scen[0];
    CS.a2 = j; CS.res = null;
    if (opt && opt.change && sc) {
      var cs = caseSt(c, sc), ch = opt.change, app = ch.key != null ? [[ch.key, ch.to]] : [], k2;
      var st0 = cs ? cs.s : null, set0 = cs ? clone(cs.st) : baseSettings(sc), set1 = clone(set0);
      if (ch.mode) set1.mode = ch.mode; if (ch.key != null) set1[ch.key] = ch.to;
      // a combined option (e.g. lower VT and raise the rate together) carries also: {key: value}
      if (ch.also) for (k2 in ch.also) if (Object.prototype.hasOwnProperty.call(ch.also, k2)) { set1[k2] = ch.also[k2]; app.push([k2, ch.also[k2]]); }
      var res = { before: {}, after: null, reasons: [], applied: app.map(function (x) { return { k: x[0], a: set0[x[0]], b: x[1] }; }) };
      if (st0) {
        var wi = safe(function () { return e.whatIf(st0, set0, ch); }, null) || {};
        var pB = safe(function () { return e.step(clone(st0), set0, 1800); }, st0), pA = safe(function () { return e.step(clone(st0), set1, 1800); }, st0);
        res.before = e.readout(st0, set0); res.after = (!ch.also && (wi["with"] || wi.after)) || e.readout(pA, set1);
        res.reasons = agree(safe(function () { return e.explainDelta(e.abg(st0), e.abg(pA), set0, set1, st0, pA, { prediction: true, horizonMin: 30 }); }, []), e.abg(st0), e.abg(pA));
      }
      CS.res = res;
    }
    if (j === c.q2.answer) { prefs().cases[c.id] = 1; savePrefs(); }
    I.haptic(j === c.q2.answer ? "success" : "error");
    caseView(".vl-v2");
  };
  A.vlcnext = function () { var n = caseList().length; if (CS.i >= n - 1) return home("[data-act=vlcases]"); CS.i++; CS.a1 = null; CS.a2 = null; CS.res = null; caseView(); };

  /* ================= dyssynchrony gallery ================= */
  var DY = { k: null, ans: null };
  function dysKinds() { return Object.keys(learn().dyssync || {}).filter(function (k) { return DYS_KINDS.indexOf(k) >= 0; }).sort(function (a, b) { return DYS_KINDS.indexOf(a) - DYS_KINDS.indexOf(b); }); }
  function dysSet() { var sc = VL.scen[0], o = baseSettings(sc), ms = Object.keys(E().MODES || {}); if (ms.indexOf("acvc") >= 0) o.mode = "acvc"; return o; }
  function dysBreath(k) { return safe(function () { return E().dyssync(k, dysSet()); }, null); }
  A.vldys = function () { gallery(); };
  function gallery(focusSel) {
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-dys"; st.again = gallery;
    st.onBack = function () { home("[data-act=vldys]"); return true; };
    var ks = dysKinds();
    I.paint(I.top(t(STR.backLab), s("dys"), s("dysSub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="vl-wrap"><ul class="vl-dgrid">' + ks.map(function (k, i) {
        var b = dysBreath(k), solved = prefs().dys[k], name = (learn().dyssync[k] || {}).name;
        return '<li><button type="button" class="vl-card vl-dcard" data-act="vldys1" data-k="' + esc(k) + '"><span class="vl-sc-plate">' + (b ? dysSvg(b) : "") + "</span>" +
          '<span class="vl-sc-b"><b>' + s("pattern", { n: i + 1 }) + "</b>" + (solved ? '<span class="vl-solved">' + (ico("check") || "") + tx(name) + "</span>" : '<span class="sp-small">' + s("notNamed") + "</span>") + "</span></button></li>";
      }).join("") + '</ul><p class="vl-disc vl-disc-end" role="note"><span>' + disc() + "</span></p></div></div>", typeof focusSel === "string" ? focusSel : null);
  }
  function dysSvg(b) {
    var tp = table(b.t, b.paw, 120), tf = table(b.t, b.flow, 120), pm = 0, fm = 0;
    tp.v.forEach(function (v) { pm = Math.max(pm, v); }); tf.v.forEach(function (v) { fm = Math.max(fm, Math.abs(v)); });
    pm = Math.max(30, pm + 4); fm = Math.max(30, fm);
    function path(arr, lo, hi, y0, h) { var d = "", i, n = arr.length; for (i = 0; i < n; i++) d += (i ? "L" : "M") + (i * 120 / (n - 1)).toFixed(1) + " " + (y0 + h - (clamp(arr[i], lo, hi) - lo) / (hi - lo) * h).toFixed(1); return d; }
    return '<svg class="vl-mini" viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line class="vl-mini-z" x1="0" x2="120" y1="45" y2="45"/><path class="vl-mini-p" d="' + path(tp.v, 0, pm, 3, 24) + '"/><path class="vl-mini-f" d="' + path(tf.v, -fm, fm, 31, 28) + '"/></svg>';
  }
  A.vldys1 = function (b) { DY.k = b.getAttribute("data-k"); DY.ans = null; dysOne(); };
  function dysOne(focusSel) {
    var k = DY.k, info = (learn().dyssync || {})[k] || {}, quiz = info.quiz || { options: [], answer: -1 }, ks = dysKinds(), i = ks.indexOf(k);
    I.leave(); closeSheet(true);
    st.view = "vl-dys1"; st.again = dysOne;
    st.onBack = function () { gallery('[data-act=vldys1][data-k="' + k + '"]'); return true; };
    st.onLeave = function () { wvStop(); };
    var ans = DY.ans;
    var opts = '<div class="sp-answers' + (ans != null ? " done" : "") + '" role="group" aria-labelledby="vlDyQ">' + (quiz.options || []).map(function (o, j) {
      var state = ans == null ? "" : j === quiz.answer ? "right" : j === ans ? "wrong" : "dim";
      return '<button type="button" class="sp-ans" data-act="vldyans" data-o="' + j + '"' + (state ? ' data-state="' + state + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + (state === "right" ? ico("check") || "A" : state === "wrong" ? ico("close") || "x" : "ABCD".charAt(j)) + "</span>" + tx(o) + "</button>";
    }).join("") + "</div>";
    var rev = ans == null ? "" : '<p class="sp-verdict vl-dyv ' + (ans === quiz.answer ? "ok" : "bad") + '" tabindex="-1">' + (ico(ans === quiz.answer ? "check" : "close") || "") + "<span>" + s(ans === quiz.answer ? "right" : "wrong") + "</span></p>" +
      '<dl class="vl-mcard">' + [["dName", info.name], ["dClue", info.clue], ["dCause", info.cause], ["dFix", info.fix]].filter(function (x) { return x[1]; }).map(function (x) { return "<div><dt>" + s(x[0]) + "</dt><dd>" + tx(x[1]) + "</dd></div>"; }).join("") + "</dl>";
    I.paint(I.top(t(STR.dys), s("pattern", { n: i + 1 }), s("dysSub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vl-dys1">' +
      '<figure class="vl-plate vl-waves" role="img" aria-label="' + s("dysAria") + '">' +
      '<div class="vl-wch c-paw tall"><span class="vl-tag">' + s("paw") + " <i>cmH2O</i></span><canvas class=\"vl-cv\" data-w=\"dpaw\" aria-hidden=\"true\"></canvas></div>" +
      '<div class="vl-wch c-flow tall"><span class="vl-tag">' + s("flow") + " <i>L/min</i></span><canvas class=\"vl-cv\" data-w=\"dflow\" aria-hidden=\"true\"></canvas></div></figure>" +
      '<h2 class="sp-h3 vl-q" id="vlDyQ">' + s("nameIt") + "</h2>" + opts + rev + "</div></div>" +
      (ans != null && i < ks.length - 1 ? '<div class="sp-foot"><button type="button" class="sp-btn pri sp-wide" data-act="vldynext">' + s("dysNext") + "</button></div>" : ""),
      typeof focusSel === "string" ? focusSel : null);
    var b = dysBreath(k);
    if (b) {
      var vs = ventSources(b), win = vs.paw.src.p;
      wvBind(function (n) { return n === "dpaw" ? { src: vs.paw.src, lo: 0, hi: vs.scale.paw, win: win, marks: vs.paw.marks, ticks: vs.paw.ticks } : n === "dflow" ? { src: vs.flow.src, lo: -vs.scale.flow, hi: vs.scale.flow, win: win, zero: true, ticks: vs.flow.ticks } : null; });
    }
  }
  A.vldyans = function (b) {
    if (DY.ans != null) return;
    var info = (learn().dyssync || {})[DY.k] || {}, j = +b.getAttribute("data-o"), ok = info.quiz && j === info.quiz.answer;
    DY.ans = j;
    if (ok) { prefs().dys[DY.k] = 1; savePrefs(); }
    I.haptic(ok ? "success" : "error");
    dysOne(".vl-dyv");
  };
  A.vldynext = function () { var ks = dysKinds(), i = ks.indexOf(DY.k); if (i < ks.length - 1) { DY.k = ks[i + 1]; DY.ans = null; dysOne(); } };

  /* ---------- wiring ---------- */
  function wire() {
    var el = I.root();
    if (!el || el._vl) return;
    el._vl = 1;
    el.addEventListener("change", onSel);
    el.addEventListener("toggle", function (e) { if (R && e.target && e.target.classList && e.target.classList.contains("vl-bedd")) R.bedOpen = e.target.open; }, true);
    el.addEventListener("pointerdown", holdStart);
    ["pointerdown", "keydown", "click"].forEach(function (x) { el.addEventListener(x, function () { UI_N.n++; }, true); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (x) { el.addEventListener(x, holdStop); });
  }
  function openLab() { wire(); home(); }
  function register() {
    var e = E();
    if (!e || !e.init || !e.breath) return;
    // Pinned first on Narkē Test with a featured card; the line counts finished tutorials as progress too.
    host.registerSim({ id: "ventlab", title: STR.title, sub: STR.sub, icon: "lungs", level: "mbbs", pin: true, feature: STR.featLine,
      line: function (r) {
        var b = prefs().best, ks = Object.keys(b), best = 0, nt = Object.keys(prefs().tuts).length, mt = (learn().tutorials || []).length, out = [];
        ks.forEach(function (k) { best = Math.max(best, b[k]); });
        if (nt) out.push(mt ? s("tutsDone", { n: I.fmt(nt), m: I.fmt(mt) }) : s("tutsN", { n: I.fmt(nt) }));
        if (r && r.n) out.push(s(r.n === 1 ? "runs1" : "runs", { n: I.fmt(r.n), b: I.fmt(best) }));
        return out.length ? out.join(" · ") : s("none");
      },
      open: openLab });
  }
  host._ventLab = { open: openLab, STR: STR };
  if (host._syncers) host._syncers.push(register);
  register();
})(typeof window !== "undefined" ? window : this);
