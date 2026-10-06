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
  function stepVal(def, v, dir, mult) {
    var st = def.step || 1, n = (+v) + dir * st * (mult || 1);
    n = Math.round(n / st) * st;
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
    compl: T("Compliance {n} mL/cmH2O", "कंप्लायंस {n} mL/cmH2O"), resist: T("Resistance {n} cmH2O/L/s", "रेज़िस्टेंस {n} cmH2O/L/s"),
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
    cMon: T("In 30 min: SpO2 {a} to {b}, EtCO2 {c} to {d}.", "30 मिनट में: SpO2 {a} से {b}, EtCO2 {c} से {d}।"),
    cAbg: T("In 30 min: PaO2 {a} to {b}, PaCO2 {c} to {d}, pH {e} to {f}.", "30 मिनट में: PaO2 {a} से {b}, PaCO2 {c} से {d}, pH {e} से {f}।"),
    cPt: T("In 30 min: MAP {a} to {b}, HR {c} to {d}.", "30 मिनट में: MAP {a} से {b}, HR {c} से {d}।"),
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
    p_protection: T("Lung protection", "फेफड़े की सुरक्षा"), p_alarms: T("Alarm response", "अलार्म प्रतिक्रिया"), p_abg: T("ABG use", "ABG उपयोग"), p_time: T("Timing", "समय"), p_unsafe: T("Unsafe moments", "असुरक्षित पल"), penalty: T("Penalty", "दंड"),
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
    modeTo: T("Switch the mode to {x}, then confirm.", "मोड {x} करें, फिर पक्का करें।"), sawIt: T("You saw it: {x} went {d}.", "आपने देखा: {x} {d}।"),
    waitSee: T("Now move time forward and watch {x}.", "अब समय आगे बढ़ाएँ और {x} देखें।"), doneStep: T("Done", "हो गया"),
    wiPick: T("Pick a question", "एक प्रश्न चुनें"), wiBuild: T("Or build your own", "या अपना बनाएँ"), wiSetting: T("Setting", "सेटिंग"), wiDir: T("Direction", "दिशा"),
    wiUp: T("Increase", "बढ़ाएँ"), wiDown: T("Decrease", "घटाएँ"), wiGo: T("Show before and after", "पहले और बाद दिखाएँ"), wiNow: T("Now", "अभी"), wiAfter: T("After 30 min", "30 मिनट बाद"),
    wiPatient: T("Patient", "मरीज़"), wiEmpty: T("Choose a question above to see what changes, and why.", "क्या बदलता है और क्यों, देखने के लिए ऊपर एक प्रश्न चुनें।"),
    caseOf: T("Case {i} of {n}", "{n} में से केस {i}"), right: T("Correct", "सही"), wrong: T("Not this one", "यह नहीं"), result: T("Simulated result, 30 min after the change", "बदलाव के 30 मिनट बाद सिम्युलेटेड परिणाम"), applied: T("Change applied", "लागू बदलाव"),
    nextCase: T("Next case", "अगला केस"), q1: T("Question 1", "प्रश्न 1"), q2: T("Question 2", "प्रश्न 2"), normal: T("Normal {a} to {b}", "सामान्य {a} से {b}"),
    pattern: T("Pattern {n}", "पैटर्न {n}"), nameIt: T("Which pattern is this?", "यह कौन सा पैटर्न है?"), named: T("Named", "पहचाना"), notNamed: T("Not named yet", "अभी पहचाना नहीं"), dysNext: T("Next pattern", "अगला पैटर्न"),
    dName: T("Name", "नाम"), dClue: T("Clue", "संकेत"), dCause: T("Cause", "कारण"), dFix: T("Fix", "समाधान"),
    dysAria: T("Pressure and flow over two breaths, showing a patient and ventilator out of step.", "दो साँसों में प्रेशर और फ़्लो, मरीज़ और वेंटिलेटर का तालमेल नहीं।"),
    runs: T("{n} runs, best {b}", "{n} रन, सर्वोत्तम {b}"), none: T("Not started", "अभी शुरू नहीं"),
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
    nx3: T("Read the chain, then tap +15 min. Blood gases change slowly.", "चेन पढ़ें, फिर +15 मिनट दबाएँ। ब्लड गैस धीरे बदलती है।"),
    nx4: T("Now Draw ABG again to see what your change did.", "अब फिर ABG लें और देखें आपके बदलाव ने क्या किया।"),
    nx5: T("Compare Before and Now in the blood gas. Then try another change, or Finish.", "ब्लड गैस में पहले और अभी की तुलना करें। फिर कोई और बदलाव करें, या समाप्त करें।"),
    tutMoved: T("The clock moved on {m} min so you can see it.", "आपको दिखाने के लिए घड़ी {m} मिनट आगे बढ़ी।"),
    tutFlat: T("{x} barely moves in this patient. Go on when ready.", "इस मरीज़ में {x} लगभग नहीं बदलता। तैयार हों तो आगे बढ़ें।"),
    tutLook: T("Watch {x}.", "{x} देखें।"),
    ex_paco2: T("CO2 in the blood (PaCO2)", "खून में CO2 (PaCO2)"), ex_pao2: T("oxygen in the blood (PaO2)", "खून में ऑक्सीजन (PaO2)"), ex_ph: T("pH", "pH"),
    ex_pplat: T("plateau pressure", "प्लेटो प्रेशर"), ex_map: T("mean blood pressure (MAP)", "औसत ब्लड प्रेशर (MAP)"), ex_vte: T("tidal volume", "टाइडल वॉल्यूम"),
    ex_autoPeep: T("auto-PEEP", "ऑटो-PEEP"), ex_drivingP: T("driving pressure", "ड्राइविंग प्रेशर"), ex_spo2: T("SpO2", "SpO2"),
    ab_pH: T("acidity: lower is more acid", "अम्लता: कम यानी ज़्यादा एसिड"), ab_PaCO2: T("CO2 in the blood", "खून में CO2"), ab_PaO2: T("oxygen in the blood", "खून में ऑक्सीजन"),
    ab_HCO3: T("bicarbonate, the body's buffer", "बाइकार्बोनेट, शरीर का बफ़र"), ab_SaO2: T("% of haemoglobin carrying oxygen", "ऑक्सीजन ले जा रहा हीमोग्लोबिन %")
  };
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
  function wvColor(p) { try { var cs = G.getComputedStyle(p.cv); p.color = cs.color; p.grid = cs.getPropertyValue("--vl-gridc").trim() || "rgba(128,128,128,.25)"; p.mut = cs.getPropertyValue("--vl-mutc").trim() || "#888"; p.font = cs.fontFamily; } catch (e) {} }
  function wvSize(p) {
    var r = p.cv.getBoundingClientRect(), d = Math.min(2, G.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (p.cv.width !== w || p.cv.height !== h) { p.cv.width = w; p.cv.height = h; }
    p.d = d; wvColor(p);
  }
  function wvAt(src, time) { var f = (time % src.p) / src.p; if (f < 0) f += 1; return src.v[Math.floor(f * src.v.length) % src.v.length]; }
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
      c.font = (10 * d) + "px " + (p.font || "sans-serif"); c.textAlign = "right"; c.textBaseline = "middle";
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
    c.beginPath();
    for (x = 0; x <= W; x += step) {
      if (!WV.still && x > head && x < head + gap) { started = false; prevPh = null; continue; }
      tt = (x <= head ? cyc : cyc - win) + x / W * win;
      if (WV.still) tt = x / W * win;
      if (p.peak) { var v0 = wvAt(p.src, tt), v1 = wvAt(p.src, tt + win * step / W / 2), v2 = wvAt(p.src, tt - win * step / W / 2); y = yOf(Math.abs(v1) > Math.abs(v0) ? (Math.abs(v2) > Math.abs(v1) ? v2 : v1) : Math.abs(v2) > Math.abs(v0) ? v2 : v0); }
      else y = yOf(wvAt(p.src, tt));
      if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
      if (p.marks && p.marks.length) {
        var ph = ((tt % p.src.p) + p.src.p) % p.src.p / p.src.p;
        if (prevPh != null) p.marks.forEach(function (m) { if ((prevPh <= m.ph && ph > m.ph) || (prevPh > ph && (m.ph >= prevPh || m.ph < ph))) marks.push({ x: x, y: y, k: m.k }); });
        prevPh = ph;
      }
    }
    c.stroke();
    if (WV.still && !started) return;
    marks.forEach(function (m) {
      c.fillStyle = m.k === "auto" ? p.warn || p.color : p.color;
      c.beginPath();
      if (m.k === "trig") { c.moveTo(m.x, H - pad); c.lineTo(m.x - 4 * d, H); c.lineTo(m.x + 4 * d, H); c.closePath(); c.fill(); }
      else if (m.k === "cyc") { c.fillRect(m.x - d / 2, pad, d, H - 2 * pad); }
      else { c.arc(m.x, m.y, 3.5 * d, 0, Math.PI * 2); c.fill(); }
      if (m.k === "auto" && p.autoLabel) { c.font = (11 * d) + "px " + (p.font || "sans-serif"); c.fillStyle = p.mut; c.textAlign = "right"; c.fillText(p.autoLabel, Math.max(60 * d, m.x - 6 * d), m.y - 6 * d); }
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
      paw: { src: tp, lo: 0, hi: pmax, win: win, marks: marks, ticks: ticks(pmax) },
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
    [].forEach.call(r.querySelectorAll(":scope > .sp-top, :scope > .sp-scroll, :scope > .sp-foot, :scope > .vl-alarms, :scope > .vl-bagw, :scope > .vl-coach"), function (n) {
      if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert");
    });
  }
  // trigger: the control that opened the sheet; focus returns there on close (Safari does not focus clicked buttons).
  function sheet(title, body, foot, trigger) {
    var prev = SH.el ? SH.ret : null;
    closeSheet(true);
    var r = I.root(), w = G.document.createElement("div");
    SH.ret = trigger || prev || G.document.activeElement;
    w.className = "vl-sheet-wrap";
    w.innerHTML = '<div class="vl-scrim" data-act="vlsheetx"></div><div class="vl-sheet" role="dialog" aria-modal="true" aria-labelledby="vlShH">' +
      '<div class="vl-sheet-h"><h2 id="vlShH" tabindex="-1">' + title + '</h2><button type="button" class="sp-icon vl-x" data-act="vlsheetx" aria-label="' + s("close") + '">' + (ico("close") || "x") + "</button></div>" +
      '<div class="vl-sheet-b">' + body + "</div>" + (foot ? '<div class="vl-sheet-f">' + foot + "</div>" : "") + "</div>";
    r.appendChild(w);
    SH.el = w;
    setInert(true);
    SH.prevBack = st.onBack;
    st.onBack = function () { closeSheet(); return true; };
    try { w.querySelector("#vlShH").focus({ preventScroll: true }); } catch (e) {}
    G.requestAnimationFrame(function () { if (SH.el === w) w.classList.add("on"); });
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
  function toast(kind, html) {
    var el = q(".vl-toast");
    if (!el) return;
    el.innerHTML = '<span class="vl-toast-k">' + (ico(kind === "hint" ? "spark" : "info")) + "<b>" + s(kind === "hint" ? "hint" : "event") + "</b></span><span>" + html + "</span>";
    el.classList.add("on");
    G.clearTimeout(TO.tm);
    TO.tm = G.setTimeout(function () { el.classList.remove("on"); }, 6500);
  }
  // Scroll only the screen's own scroller (scrollIntoView can also pan the page's visual viewport on phones).
  function scrollTo(el, center) {
    var sc = q(".sp-scroll");
    if (!sc || !el) return;
    var r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    var top = sc.scrollTop + r.top - b.top - (center ? Math.max(12, (b.height - r.height) / 2) : 12);
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
    var n = lv(), all = VL.scen.slice().sort(function (a, b) { return (a.level || 1) - (b.level || 1); });
    var open = all.filter(function (x) { return (x.level || 1) <= n; }), more = all.length - open.length;
    var seg = [1, 2, 3, 4].map(function (k) {
      return '<button type="button" data-act="vllevel" data-v="' + k + '" aria-pressed="' + (k === n) + '"><b>' + k + "</b><span>" + esc(lvName(k)) + "</span></button>";
    }).join("");
    var intro = lvIntro(n);
    var cards = open.map(function (sc) { return scCard(sc, e); }).join("");
    var tl = learn().tutorials || [], td = prefs().tuts, nextT = tl.filter(function (tu) { return !td[tu.id]; })[0];
    var tuts = tl.map(function (tu) {
      var right = td[tu.id] ? '<span class="vl-tdone">' + (ico("check") || "") + '<span class="sp-sr">' + s("done") + "</span></span>" : tu === nextT && n <= 2 ? '<span class="vl-start">' + s("startHere") + "</span>" : "";
      return I.row("vltut", ' data-k="' + esc(tu.id) + '"', I.tile("play"), tx(tu.title), s("steps", { n: (tu.steps || []).length }), right);
    }).join("");
    // Beginners meet the tutorials before the patients; residents (Level 3 and 4) see patients first.
    var tutBlock = tuts ? '<h2 class="sp-h2">' + s("guided") + "</h2>" + (n <= 1 && !td[(tl[1] || {}).id] ? '<p class="vl-lvintro vl-tfirst">' + s("tutFirst") + "</p>" : "") + '<ul class="sp-rows vl-tuts">' + tuts + "</ul>" : "";
    var nd = Object.keys(learn().dyssync || {}).filter(function (k) { return DYS_KINDS.indexOf(k) >= 0; });
    var solved = nd.filter(function (k) { return prefs().dys[k]; }).length;
    var prac = I.row("vlwhat", "", I.tile("sliders"), s("whatIf"), s("whatIfSub"), "") +
      ((learn().cases || []).length ? I.row("vlcases", "", I.tile("abg"), s("cases"), s("casesSub"), s("nCases", { n: learn().cases.length })) : "") +
      (nd.length ? I.row("vldys", "", I.tile("pulse"), s("dys"), s("dysSub"), s("nPatterns", { n: nd.length, s: solved })) : "");
    I.paint(I.top(t(STR.backTest), s("title"), s("sub"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="vl-wrap vl-home">' +
      '<p class="vl-lede">' + s("lede") + "</p>" +
      '<p class="vl-disc" role="note">' + (ico("info") ? '<span aria-hidden="true">' + ico("info") + "</span>" : "") + "<span>" + disc() + "</span></p>" +
      '<h2 class="sp-h2" id="vlLvH">' + s("level") + '</h2><div class="vl-levels" role="group" aria-labelledby="vlLvH">' + seg + "</div>" +
      (intro ? '<p class="vl-lvintro">' + tx(intro) + "</p>" : "") +
      (n <= 2 ? tutBlock : "") +
      '<h2 class="sp-h2">' + s("patients") + '</h2><ul class="vl-cards">' + cards + "</ul>" +
      (more > 0 ? '<p class="sp-small vl-more">' + s("morePts", { n: more }) + "</p>" : "") +
      (n > 2 ? tutBlock : "") +
      '<h2 class="sp-h2">' + s("practise") + '</h2><ul class="sp-rows">' + prac + "</ul>" +
      "</div></div>", typeof focusSel === "string" ? focusSel : null);
  }
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
    var p = sc.patient || {};
    var tags = lungTags(sc).map(function (k) { return '<span class="vl-tag2">' + s(k) + "</span>"; }).join("");
    return '<li><button type="button" class="vl-card vl-sc" data-act="vlgo" data-s="' + esc(sc.id) + '">' +
      '<span class="vl-sc-plate">' + miniTrace(sc, e) + "</span>" +
      '<span class="vl-sc-b"><span class="vl-sc-top"><b>' + tx(sc.title) + '</b><span class="vl-lvb">' + s("lvN", { n: sc.level || 1 }) + "</span></span>" +
      '<span class="vl-sc-who">' + s(p.sex === "F" ? "female" : "male") + ", " + s("yrs", { n: p.age }) + " · " + esc(fmtN(p.heightCm)) + " cm · " + esc(fmtN(p.weightKg)) + " kg · " + s("pbw") + " " + esc(fmtN(ptPbw(sc))) + " kg</span>" +
      '<span class="vl-sc-dx">' + tx(p.diagnosis) + "</span>" +
      '<span class="vl-tags">' + tags + "</span></span></button></li>";
  }
  A.vllevel = function (b) { var v = +b.getAttribute("data-v"); if (v === lv()) return; prefs().level = v; savePrefs(); if (st.view === "vl-run") return run('[data-act=vllevel][data-v="' + v + '"]'); home('[data-act=vllevel][data-v="' + v + '"]'); };
  A.vlretry = function () { VL.err = null; home(); };
  A.vlgo = function (b) { var sc = scById(b.getAttribute("data-s")); if (sc) start(sc); };

  /* ================= the run ================= */
  var R = null;
  G.NARKE_VENT_UI.run = function () { return R; }; // read-only hook for test/run-narke-vent-ui.mjs
  function start(sc, tut) {
    var e = E(), s0 = e.init(clone(sc), null), set = s0 && s0.settings ? clone(s0.settings) : baseSettings(sc);
    R = { sc: sc, s: s0, set: set, pend: {}, log: [], abgs: [], answers: [], seen: {}, lastSet: 0, lastAct: 0, lastLog: 0, bedSig: "", chain: null, live: true, sil: {}, ack: {}, hints: [], evSeen: 0, tut: tut || null, side: null, alarmSig: "", bsig: "", msig: "" };
    R.log.push({ t: 0, settings: clone(set), readout: e.readout(s0, set), action: "start" });
    run();
  }
  function cur() { return E().readout(R.s, R.set); }
  function pendSet() { var o = clone(R.set), k; for (k in R.pend) if (Object.prototype.hasOwnProperty.call(R.pend, k)) o[k] = R.pend[k]; return o; }
  function nPend() { return Object.keys(R.pend).length; }

  function run(focusSel) {
    if (!R) return home();
    var e = E();
    I.leave(); closeSheet(true);
    st.view = "vl-run"; st.again = run;
    st.onBack = function () { home('[data-act=vlgo][data-s="' + R.sc.id + '"]'); return true; };
    st.onLeave = function () { stopLive(); wvStop(); closeSheet(true); };
    var r = cur(), sc = R.sc;
    I.paint(I.top(t(STR.backLab), tx(sc.title), '<span id="vlClock">' + s("simTime", { x: clockText(R.s.t) }) + "</span>", I.langBtn()) +
      '<div class="vl-alarms" id="vlAlarms" data-vl-id="alarms">' + alarmsHtml() + "</div>" +
      '<div class="vl-bagw" id="vlBag">' + bagHtml() + "</div>" +
      '<div class="sp-scroll vl-scroll' + (R.tut ? " has-coach" : "") + '"><div class="vl-wrap" id="vlBedW">' + bedHtml() + '</div><div class="vl-wrap vl-run">' +
      '<div class="vl-colA">' + ptHtml(r) + monHtml(r) + "</div>" +
      '<div class="vl-colB">' + ventHtml(r) + setHtml() + "</div>" +
      '<div class="vl-colC">' + chainHtml() + '<section class="vl-card vl-ov" data-vl-id="oxvent" aria-labelledby="vlOvH" id="vlOv">' + ovHtml(r) + "</section>" +
      '<section class="vl-card vl-abg" data-vl-id="abg" aria-labelledby="vlAbgH" id="vlAbg">' + abgHtml() + "</section>" +
      '<div class="vl-end"><button type="button" class="sp-btn sec sp-wide" data-act="vlfinish" data-vl-id="debrief">' + ico("flag") + " " + s("finish") + "</button>" +
      '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + '</span></p><p class="sp-small vl-simlab">' + s("simulated") + "</p></div></div>" +
      "</div></div>" +
      '<div class="sp-foot vl-foot" id="vlFoot" data-vl-id="time">' + footHtml() + "</div>" +
      (R.tut ? '<div class="vl-coach" id="vlCoach" role="region" aria-label="' + s("tut") + '">' + coachHtml() + "</div>" : "") +
      '<div class="vl-toast" role="status" aria-live="polite"></div><p class="sp-sr" id="vlSay" role="status" aria-live="polite"></p>',
      typeof focusSel === "string" ? focusSel : null);
    bindWaves(r);
    if (R.chain) paintChain(true);
    if (R.tut) tutHighlight();
    if (R.live) startLive();
  }

  /* ---- patient ---- */
  function ptHtml(r) {
    var sc = R.sc, p = sc.patient || {}, l = sc.lung || {}, g = sc.goals || {}, n = lv();
    var vs = p.volumeStatus === "low" ? "volLow" : p.volumeStatus === "high" ? "volHigh" : "volNormal";
    var goals = [];
    if (g.spo2) goals.push("SpO2 " + g.spo2[0] + " to " + g.spo2[1] + " %");
    if (g.paco2) goals.push("PaCO2 " + g.paco2[0] + " to " + g.paco2[1]);
    if (g.ph) goals.push("pH " + g.ph[0] + " to " + g.ph[1]);
    if (g.pplatMax) goals.push("Pplat " + "&le; " + g.pplatMax);
    if (g.vtPerKg) goals.push("VT " + g.vtPerKg[0] + " to " + g.vtPerKg[1] + " mL/kg");
    return '<section class="vl-card vl-pt" data-vl-id="patient" aria-labelledby="vlPtH">' +
      '<div class="vl-pt-h"><h2 class="vl-h" id="vlPtH">' + tx(p.diagnosis) + '</h2><span class="vl-lvb">' + s("lvN", { n: n }) + "</span></div>" +
      '<p class="vl-pt-who">' + s(p.sex === "F" ? "female" : "male") + ", " + s("yrs", { n: p.age }) + " · " + esc(fmtN(p.heightCm)) + " cm · " + esc(fmtN(p.weightKg)) + ' kg · <b title="' + s("pbwFull", { n: ptPbw(sc) }) + '">' + s("pbw") + " " + esc(fmtN(ptPbw(sc))) + " kg</b></p>" +
      '<div class="vl-tags">' + lungTags(sc).map(function (k) { return '<span class="vl-tag2">' + s(k) + "</span>"; }).join("") + '<span class="vl-tag2 vs-' + esc(p.volumeStatus || "normal") + '">' + s(vs) + "</span></div>" +
      (n >= 2 ? '<p class="vl-pt-mech">' + s("compl", { n: l.c }) + " · " + s("resist", { n: l.r }) + "</p>" : '<p class="vl-plain">' + s("pbwWhy") + "</p>") +
      '<details class="vl-story"' + (n <= 1 && !R.tut ? " open" : "") + "><summary>" + s("storyGoals") + "</summary><p>" + tx(sc.story) + "</p>" + (sc.why ? "<p><b>" + s("why") + "</b> " + tx(sc.why) + "</p>" : "") +
      (goals.length ? "<p><b>" + s("targets") + "</b> " + goals.join(" · ") + "</p>" : "") +
      ((g.other || []).length ? "<ul>" + g.other.map(function (o) { return "<li>" + tx(o) + "</li>"; }).join("") + "</ul>" : "") + "</details></section>";
  }

  /* ---- monitor ---- */
  function monNums(r) {
    var v = r.vitals || {};
    return { hr: fmtN(v.hr), spo2: fmtN(v.spo2), et: fmtN(v.etco2), rr: fmtN(v.rr), bp: fmtN(v.sbp) + "/" + fmtN(v.dbp), map: "(" + fmtN(v.map) + ")", temp: v.temp == null ? "?" : String(v.temp) };
  }
  function monHtml(r) {
    var m = monNums(r);
    function ch(cls, tag, w, num, id) {
      return '<div class="vl-ch ' + cls + '" data-vl-id="' + id + '"><div class="vl-ch-w"><span class="vl-tag">' + tag + '</span><canvas class="vl-cv" data-w="' + w + '" aria-hidden="true"></canvas></div><div class="vl-num">' + num + "</div></div>";
    }
    function big(k, id, v, sub) { return '<span class="vl-k">' + s(k) + '</span><b class="vl-v" id="' + id + '">' + esc(v) + "</b>" + (sub || ""); }
    return '<section class="vl-card vl-monw" data-vl-id="monitor" aria-labelledby="vlMonH"><h2 class="vl-h" id="vlMonH">' + s("monitor") + "</h2>" +
      '<div class="vl-plate vl-mon">' +
      ch("c-ecg", s("ecg"), "ecg", big("hr", "vlHr", m.hr), "hr") +
      ch("c-spo2", s("pleth"), "pleth", big("spo2", "vlSpo2", m.spo2), "spo2") +
      ch("c-co2", s("co2"), "capno", big("etco2", "vlEt", m.et) + '<span class="vl-rr"><span class="vl-k">' + s("rr") + '</span><b class="vl-v2" id="vlRr">' + esc(m.rr) + "</b></span>", "etco2") +
      '<div class="vl-ch vl-nibp c-art" data-vl-id="sbp"><span class="vl-k">' + s("nibp") + '</span><span class="vl-bp"><b class="vl-v" id="vlBp">' + esc(m.bp) + '</b><span class="vl-map" id="vlMap" data-vl-id="map">' + esc(m.map) + "</span></span>" +
      '<span class="vl-temp"><span class="vl-k">' + s("temp") + '</span><b id="vlTemp">' + esc(m.temp) + "</b></span></div></div>" +
      '<div class="vl-flags" id="vlFlags">' + flagsHtml(r) + "</div>" +
      (lv() <= 2 ? '<details class="vl-what"><summary>' + s("monWhat") + "</summary><ul>" + ["mHr", "mSpo2"].map(function (k) { return "<li>" + s(k) + "</li>"; }).join("") +
        "<li>" + tx((learn().glossary || {}).etco2 ? { en: "EtCO2: " + learn().glossary.etco2.en, hi: "EtCO2: " + learn().glossary.etco2.hi } : "EtCO2") + "</li>" +
        ["mRr", "mBp", "mUnit"].map(function (k) { return "<li>" + s(k) + "</li>"; }).join("") + "</ul></details>" : "") +
      '<p class="sp-sr" id="vlMonSay">' + monSay(r) + "</p></section>";
  }
  function flagsHtml(r) {
    return (r.flags || []).map(function (f) { return '<span class="vl-fl ' + esc(f.severity || "info") + '">' + tx(f.label) + "</span>"; }).join("");
  }
  function monSay(r) { var v = r.vitals || {}; return s("monSay", { a: fmtN(v.hr), b: fmtN(v.spo2), c: fmtN(v.sbp), d: fmtN(v.dbp), e: fmtN(v.map), f: fmtN(v.rr), g: fmtN(v.etco2), h: v.temp }); }
  function pulse(el) { if (!el || reduced()) return; el.classList.remove("vl-chg"); void el.offsetWidth; el.classList.add("vl-chg"); }
  function updMonitor(r, flash) {
    var m = monNums(r);
    [["vlHr", m.hr], ["vlSpo2", m.spo2], ["vlEt", m.et], ["vlRr", m.rr], ["vlBp", m.bp], ["vlMap", m.map], ["vlTemp", m.temp]].forEach(function (x) { var el = $(x[0]); if (el && el.textContent !== x[1]) { el.textContent = x[1]; if (flash) pulse(el); } });
    var sr = $("vlMonSay"); if (sr) sr.innerHTML = monSay(r);
    var fl = $("vlFlags"), fh = flagsHtml(r); if (fl && fl.innerHTML !== fh) fl.innerHTML = fh;
  }

  /* ---- ventilator ---- */
  function ventHtml(r) {
    var m = R.set.mode;
    return '<section class="vl-card vl-vent" data-vl-id="vent" aria-labelledby="vlVentH"><div class="vl-vent-h"><h2 class="vl-h" id="vlVentH">' + s("vent") + "</h2>" +
      '<button type="button" class="vl-mode" data-act="vlmode" data-vl-id="mode" aria-haspopup="dialog" aria-label="' + s("changeMode", { x: modeTitle(m) }) + '"><b>' + esc(modeShort(m)) + '</b><span class="vl-mode-t">' + esc(modeParts(m).head) + '</span><span class="vl-chev" aria-hidden="true">' + ico("chev") + "</span></button></div>" +
      (lv() <= 2 ? '<p class="vl-plain vl-wplain">' + s("wavesWhat") + "</p>" : "") +
      '<figure class="vl-plate vl-waves" data-vl-id="waves" role="img" id="vlWaves" aria-label="">' +
      wch("c-paw", "paw", "cmH2O", "vlScP", "wave-pressure") + wch("c-flow", "flow", "L/min", "vlScF", "wave-flow") + wch("c-vol", "vol", "mL", "vlScV", "wave-volume") +
      '<figcaption class="vl-legend" aria-hidden="true"><span><i class="mk-trig"></i>' + s("mkTrig") + '</span><span><i class="mk-cyc"></i>' + s("mkCyc") + '</span><span><i class="mk-auto"></i>' + s("mkAuto") + "</span></figcaption></figure>" +
      '<div class="vl-ro-w" data-vl-id="readouts" id="vlRo">' + roHtml(r) + "</div></section>";
  }
  function wch(cls, w, unit, scId, id) {
    return '<div class="vl-wch ' + cls + '" data-vl-id="' + id + '"><span class="vl-tag">' + s(w) + " <i>" + esc(unit) + '</i></span><span class="vl-scale" id="' + scId + '"></span><canvas class="vl-cv" data-w="' + w + '" aria-hidden="true"></canvas></div>';
  }
  function roFlag(k, v) {
    var g = R.sc.goals || {}, kg = ptPbw(R.sc);
    if (k === "pplat" && v > (g.pplatMax || 30)) return "bad";
    if (k === "drivingP" && v > (g.drivingMax || 15)) return "warn";
    if (k === "autoPeep" && v > 2) return "warn";
    if (k === "ineffective" && v > 2) return "warn";
    if (k === "ppeak" && v > 40) return "warn";
    if (k === "vte" && g.vtPerKg && v / kg > g.vtPerKg[1] + 0.5) return "warn";
    return "";
  }
  // Level 1: the learner sees four plain numbers ("What the ventilator is doing"), each with its clinical name small
  // beside it; the full readout grid starts at Level 2.
  var DOING = ["vte", "rrTotal", "ve", "ppeak"];
  // Readouts the current tutorial step points at, or asks the learner to watch, show even above the learner's level.
  function tutRo() { var sp = R && R.tut && R.tut.tu.steps[R.tut.i], o = []; if (!sp) return o; (sp.highlight || []).concat(sp.expect ? [sp.expect.key || sp.expect.readout] : []).forEach(function (k) { if (RO_UNIT[k] != null && o.indexOf(k) < 0) o.push(k); }); return o; }
  function doingHtml(r) {
    var vv = r.vent || {};
    return '<h3 class="vl-doing-h">' + s("doingH") + '</h3><dl class="vl-ro vl-doing">' + DOING.concat(tutRo().filter(function (k) { return DOING.indexOf(k) < 0; })).filter(function (k) { return vv[k] != null; }).map(function (k) {
      return '<div class="vl-ro-i" data-vl-id="' + k + '"><dt>' + (STR["b_" + k] ? s("b_" + k) : STR["ex_" + k] ? s("ex_" + k) : "") + ' <abbr>' + s("ro_" + k) + "</abbr></dt><dd><b data-v=\"" + k + '">' + esc(fmtN(vv[k])) + '</b><span class="vl-u">' + esc(RO_UNIT[k] || "") + "</span></dd></div>";
    }).join("") + '</dl><p class="vl-doing-n">' + s("doingNote") + "</p>";
  }
  function roHtml(r) {
    if (lv() <= 1) return doingHtml(r);
    return '<dl class="vl-ro">' + roItems(r) + "</dl>";
  }
  function roItems(r) {
    var vv = r.vent || {}, gg = r.gas || {}, kg = ptPbw(R.sc);
    var vis = visReadouts(lv()), extra = tutRo();
    return RO_ORDER.filter(function (k) { return (vis.indexOf(k) >= 0 || extra.indexOf(k) >= 0) && (vv[k] != null || gg[k] != null); }).map(function (k) {
      var v = vv[k] != null ? vv[k] : gg[k];
      if (k === "ieActual" && typeof v === "number") v = "1:" + (Math.round(v * 10) / 10);
      var f = typeof v === "number" ? roFlag(k, v) : "", big = ["ppeak", "pplat", "peepTotal", "vte", "ve", "rrTotal"].indexOf(k) >= 0;
      var extra = k === "vte" && typeof v === "number" ? '<span class="vl-ro-x">' + s("perKg", { n: Math.round(v / kg * 10) / 10 }) + "</span>" : "";
      return '<div class="vl-ro-i' + (big ? " big" : "") + (f ? " " + f : "") + '" data-vl-id="' + k + '"><dt>' + s("ro_" + k) + "</dt><dd><b>" + esc(fmtN(v)) + '</b><span class="vl-u">' + esc(RO_UNIT[k] || "") + "</span>" +
        (f ? '<span class="vl-flag">' + s("high") + "</span>" : "") + extra + "</dd></div>";
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
      [["vlScP", vs.scale.paw], ["vlScF", vs.scale.flow], ["vlScV", vs.scale.vol]].forEach(function (x) { var n = $(x[0]); if (n) n.textContent = (x[0] === "vlScF" ? "±" : "0 to ") + x[1]; });
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
      '<span class="vl-dial-v"><b>' + esc(setText(k, v)) + "</b><small>" + esc(unit) + "</small></span>" +
      (was != null ? '<span class="vl-was">' + s("was", { v: setText(k, was) }) + "</span>" : "") + "</div>" +
      '<div class="vl-step"><button type="button" data-act="vlstep" data-k="' + esc(k) + '" data-d="-1" aria-label="' + s("dec", { x: lab }) + '"' + ((+v) <= d.min ? " disabled" : "") + ">" + MINUS + "</button>" +
      '<button type="button" data-act="vlstep" data-k="' + esc(k) + '" data-d="1" aria-label="' + s("inc", { x: lab }) + '"' + ((+v) >= d.max ? " disabled" : "") + ">" + PLUS + "</button></div></div>";
  }
  function setHtml() {
    var mode = R.pend.mode || R.set.mode, keys = visSettings(mode, lv()), al = visAlarmKeys(lv());
    return '<section class="vl-card vl-set" data-vl-id="settings" aria-labelledby="vlSetH" id="vlSet"><div class="vl-sec-h"><h2 class="vl-h" id="vlSetH">' + s("settings") + "</h2>" +
      '<span class="vl-note">' + s("pendNote") + "</span></div>" +
      '<div class="vl-knobs">' + keys.map(knob).join("") + "</div>" +
      (al.length ? '<details class="vl-alim"><summary>' + s("alarmLimits") + '</summary><div class="vl-knobs">' + al.map(knob).join("") + "</div></details>" : "") + "</section>";
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
    var v = R.pend[k] != null ? R.pend[k] : R.set[k];
    stage(k, stepVal(d, v, dir, mult));
  }
  A.vlstep = function (b) {
    if (!R) return;
    if (HOLD.fired) { HOLD.fired = false; return; }
    var k = b.getAttribute("data-k"), d = +b.getAttribute("data-d");
    bump(k, d, 1); I.haptic("tap");
    refreshKnob(k, '[data-act=vlstep][data-k="' + k + '"][data-d="' + d + '"]');
  };
  // Press and hold a stepper to keep turning, like a ventilator knob; the click after a hold is not counted again.
  var HOLD = { tm: 0, iv: 0, fired: false };
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
    var d = setDef(k), key = e.key, v;
    if (key === "ArrowUp" || key === "ArrowRight") bump(k, 1, 1);
    else if (key === "ArrowDown" || key === "ArrowLeft") bump(k, -1, 1);
    else if (key === "PageUp") bump(k, 1, 5);
    else if (key === "PageDown") bump(k, -1, 5);
    else if (key === "Home") stage(k, d.min);
    else if (key === "End") stage(k, d.max);
    else if (key === "Enter" && nPend()) { e.preventDefault(); return confirmChanges(); }
    else return;
    e.preventDefault();
    v = R.pend[k];
    refreshKnob(k, '[data-spin="' + k + '"]');
  };

  /* ---- footer: time controls, or Confirm while changes wait ---- */
  // Beginner levels: one always-visible "what to do next" line above the footer controls; tapping it goes there.
  function nextStep() {
    if (lv() > 2 || R.tut) return null;
    if (nPend()) return { k: "nx2", to: "confirm" };
    var ch = R.lastSet > 0, after = ch && R.abgs.some(function (a) { return a.t >= R.lastSet; });
    if (!ch) return R.abgs.length ? { k: "nx1", to: "settings" } : { k: "nx0", to: "abg" };
    if (!after) return R.s.t - R.lastSet < 600 ? { k: "nx3", to: "chain" } : { k: "nx4", to: "abg" };
    return { k: "nx5", to: "abg" };
  }
  function nextHtml() {
    var x = nextStep();
    return x ? '<button type="button" class="vl-next" data-act="vlnext" data-to="' + x.to + '"><b>' + s("nextH") + "</b><span>" + s(x.k) + '</span><span class="vl-chev" aria-hidden="true">' + ico("chev") + "</span></button>" : "";
  }
  function paintFoot() { var f = $("vlFoot"); if (f) f.innerHTML = footHtml(); }
  A.vlnext = function (b) {
    var to = b.getAttribute("data-to"), el, f;
    if (to === "confirm") { f = q("[data-act=vlconfirm]"); if (f) f.focus({ preventScroll: true }); return; }
    el = to === "abg" ? $("vlAbg") : to === "chain" ? $("vlChH") : $("vlSet");
    f = to === "abg" ? q("[data-act=vldraw]") : to === "chain" ? $("vlChH") : q("#vlSet .vl-dial");
    if (el) scrollTo(to === "chain" ? el.parentNode : el, false);
    if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  };
  function footHtml() {
    var n = nPend();
    if (n) {
      return nextHtml() + '<div class="vl-confirm"><button type="button" class="sp-btn sec" data-act="vlcancel">' + s("cancel") + "</button>" +
        '<button type="button" class="sp-btn pri" data-act="vlconfirm">' + (ico("check") || "") + " " + (n === 1 ? s("confirm1") : s("confirmN", { n: n })) + "</button></div>";
    }
    var waits = [["300", "t5"], ["900", "t15"], ["1800", "t30"], ["3600", "t60"]];
    return nextHtml() + '<div class="vl-time" role="group" aria-label="' + s("simTime", { x: clockText(R.s.t) }) + '">' +
      '<button type="button" class="vl-tbtn vl-live" data-act="vllive" aria-pressed="' + !!R.live + '" aria-label="' + s(R.live ? "liveOn" : "liveOff") + '">' +
      '<span class="vl-dot" aria-hidden="true"></span>' + s(R.live ? "live" : "pause") + "</button>" +
      waits.map(function (w) { return '<button type="button" class="vl-tbtn" data-act="vlskip" data-k="' + w[0] + '" aria-label="' + s("skipAria", { x: t(STR[w[1]]) }) + '">' + s(w[1]) + "</button>"; }).join("") + "</div>";
  }
  A.vlcancel = function () {
    var ks = Object.keys(R.pend); R.pend = {};
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var n = ks[0] && q('[data-spin="' + ks[0] + '"]'); if (n) n.focus({ preventScroll: true });
  };
  A.vlconfirm = function () { confirmChanges(); };

  // Confirm: the new settings take effect now; mechanics change at once, gases over minutes. The chain shows both:
  // the immediate readouts and the engine's prediction 30 minutes on, old settings against new.
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
    R.chain = compose({ setB: setB, setA: setA, keys: keys, roB: roB, roA: roA, prB: prB, prA: prA, reasons: reasons });
    R.log.push({ t: R.s.t, settings: clone(setA), readout: roA, action: "set:" + keys.join(",") });
    if (R.tut) { R.tut.pre = { r: roB, t: R.s.t }; R.tut.base = null; }
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    refresh(true);
    paintChain(false);
    I.haptic("success");
    say(R.chain.say);
    var ch = $("vlChH");
    if (ch) { try { ch.focus({ preventScroll: true }); var rc = ch.getBoundingClientRect(), sb = q(".sp-scroll").getBoundingClientRect(); if (rc.top < sb.top || rc.bottom > sb.bottom - 40) scrollTo(ch, false); } catch (x) {} }
    G.setTimeout(function () { if (st.view === "vl-run") hint(roA); }, reduced() ? 0 : 1900);
    if (R.tut) tutCheck();
  }
  function compose(o) {
    var v0 = o.roB.vent || {}, v1 = o.roA.vent || {}, a0 = o.prB, a1 = o.prA, out = {}, said = [];
    var set = o.keys.map(function (k) {
      if (k === "mode") return raw("cMode", { a: modeShort(o.setB.mode), b: modeShort(o.setA.mode) });
      return raw("cSet", { x: setLabel(k), a: setText(k, o.setB[k]) + (setUnit(k) ? " " + setUnit(k) : ""), b: setText(k, o.setA[k]) + (setUnit(k) ? " " + setUnit(k) : "") });
    });
    out.setting = { on: true, lines: set };
    out.ventilator = { on: v0.vte !== v1.vte || v0.rrTotal !== v1.rrTotal || o.setA.mode !== o.setB.mode || v0.ve !== v1.ve, lines: [raw("cVent", { v: fmtN(v1.vte), r: fmtN(v1.rrTotal), m: fmtN(v1.ve) })] };
    var mp = [];
    if (v0.pplat !== v1.pplat) mp.push(raw("cPlat", { a: fmtN(v0.pplat), b: fmtN(v1.pplat) }));
    if (v0.peepTotal !== v1.peepTotal && v1.autoPeep > 0.5) mp.push(raw("cPeepT", { a: fmtN(v0.peepTotal), b: fmtN(v1.peepTotal) }));
    if (mp.length) mp.push(v0.drivingP !== v1.drivingP ? raw("cDrive", { a: fmtN(v0.drivingP), b: fmtN(v1.drivingP) }) : raw("cDriveSame", { a: fmtN(v0.drivingP) }));
    out.mechanics = { on: mp.length > 0, lines: mp.length ? [mp.join(", ") + "."] : [] };
    var auto0 = (v0.autoPeep || 0) > 1, auto1 = (v1.autoPeep || 0) > 1;
    out.waveforms = { on: v0.ppeak !== v1.ppeak || auto0 !== auto1, lines: [auto1 && !auto0 ? raw("cWaveAuto", { a: fmtN(v1.autoPeep) }) : auto0 && !auto1 ? raw("cWaveFree") : raw("cWave", { a: fmtN(v0.ppeak), b: fmtN(v1.ppeak) })] };
    var g0 = a0.gas || {}, g1 = a1.gas || {}, w0 = a0.vitals || {}, w1 = a1.vitals || {};
    out.gasExchange = { on: false, lines: [] };
    out.monitor = { on: dirOf(w0.spo2, w1.spo2) !== 0 || dirOf(w0.etco2, w1.etco2) !== 0, lines: [raw("cMon", { a: fmtN(w0.spo2), b: fmtN(w1.spo2), c: fmtN(w0.etco2), d: fmtN(w1.etco2) })] };
    out.abg = { on: dirOf(g0.pao2, g1.pao2, 1) !== 0 || dirOf(g0.paco2, g1.paco2, 1) !== 0 || dirOf(g0.ph, g1.ph, 0.005) !== 0, lines: [raw("cAbg", { a: fmtN(g0.pao2), b: fmtN(g1.pao2), c: fmtN(g0.paco2), d: fmtN(g1.paco2), e: fmtN(g0.ph), f: fmtN(g1.ph) })] };
    out.patient = { on: dirOf(w0.map, w1.map, 1) !== 0 || dirOf(w0.hr, w1.hr, 1) !== 0, lines: [raw("cPt", { a: fmtN(w0.map), b: fmtN(w1.map), c: fmtN(w0.hr), d: fmtN(w1.hr) })] };
    (o.reasons || []).forEach(function (x) {
      var ch = x.chain || [], stp = ch.indexOf("gasExchange") >= 0 ? "gasExchange" : ch.indexOf("mechanics") >= 0 ? "mechanics" : ch[ch.length - 1] || "gasExchange";
      if (!out[stp]) return;
      out[stp].on = true;
      out[stp].lines.push((x.param ? x.param + " " + raw(x.direction === "down" ? "down" : "up") + ": " : "") + t(x.because));
    });
    if (o.wiChain) o.wiChain.forEach(function (x) { if (out[x.step]) { out[x.step].on = true; out[x.step].lines = [t(x.text)]; } });
    var steps = (E().CHAIN_STEPS || ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"]);
    steps.forEach(function (k) { if (!out[k]) out[k] = { on: false, lines: [] }; if (!out[k].lines.length || !out[k].on) out[k].lines = out[k].on ? out[k].lines : [raw("cSame")]; if (out[k].on) said.push(raw("ch_" + k) + ": " + out[k].lines.join(" ")); });
    return { steps: steps, data: out, say: raw("chainSay", { x: said.join(" ") }), src: o, lang: L() };
  }
  // A chain is written in the language of the moment it was made; after a language switch it is written again.
  function fresh(c) { return c && c.src && c.lang !== L() ? compose(c.src) : c; }
  function chainHtml() {
    if (R && R.chain) R.chain = fresh(R.chain);
    return '<section class="vl-card vl-chainw" data-vl-id="chain" aria-labelledby="vlChH"><h2 class="vl-h" id="vlChH" tabindex="-1">' + s("chain") + "</h2>" +
      '<div id="vlChain">' + chainBody(R && R.chain, false) + "</div></section>";
  }
  function chainBody(c, still) {
    var steps = (c && c.steps) || (E() && E().CHAIN_STEPS) || ["setting", "ventilator", "mechanics", "waveforms", "gasExchange", "monitor", "abg", "patient"];
    return (c ? "" : '<p class="vl-empty">' + s("chainEmpty") + "</p>") + '<ol class="vl-chain' + (c ? "" : " idle") + '">' + steps.map(function (k) {
      var d = c && c.data[k], state = !c ? "idle" : still ? (d.on ? "on" : "same") : "wait";
      return '<li class="vl-cs" data-step="' + esc(k) + '" data-state="' + state + '"><span class="vl-cs-dot" aria-hidden="true"></span><div class="vl-cs-b"><b>' + s("ch_" + k) + "</b>" + (lv() <= 1 && STR["cd_" + k] ? '<span class="vl-cs-d">' + s("cd_" + k) + "</span>" : "") +
        (d ? '<p class="vl-cs-t">' + d.lines.map(esc).join("<br>") + "</p>" : "") + "</div></li>";
    }).join("") + "</ol>";
  }
  var CHT = [];
  function paintChain(still) {
    var box = $("vlChain"), c = R && R.chain;
    CHT.forEach(function (x) { G.clearTimeout(x); }); CHT = [];
    if (!box || !c) return;
    var quick = still || reduced();
    box.innerHTML = chainBody(c, quick);
    if (quick) return;
    c.steps.forEach(function (k, i) {
      CHT.push(G.setTimeout(function () {
        var li = box.querySelector('[data-step="' + k + '"]');
        if (li) li.setAttribute("data-state", c.data[k].on ? "on" : "same");
      }, 140 + i * 210));
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
      var out = v1 != null && (v1 < x[2] || v1 > x[3]);
      return '<tr data-vl-id="' + x[0].toLowerCase() + '"' + (out ? ' class="out"' : "") + '><th scope="row">' + (x[1] === "lact" ? s("lact") : esc(x[1])) + (beg ? '<span class="vl-abg-d">' + s("ab_" + x[0]) + "</span>" : "") + "</th>" + (a0 ? "<td>" + esc(fmtN(v0)) + "</td>" : "") + "<td><b>" + esc(fmtN(v1)) + "</b></td>" +
        (a0 ? "<td>" + arrow(d) + '<span class="sp-sr">' + s(d > 0 ? "up" : d < 0 ? "down" : "same") + "</span></td>" : "") + "</tr>";
    }).join("");
    var pf = a1.fio2 ? Math.round(a1.abg.PaO2 / (a1.fio2 / 100)) : null;
    var why = "";
    if (a0) {
      var rs = safe(function () { return E().explainDelta(a0.abg, a1.abg, a0.set, a1.set, a0.st, a1.st); }, []);
      if (rs.length) why = '<h3 class="vl-h3">' + s("whyH") + '</h3><ul class="vl-why">' + rs.map(function (x) {
        return "<li>" + arrow(x.direction === "down" ? -1 : 1) + "<span><b>" + esc(x.param || "") + "</b> " + tx(x.because) + "</span></li>";
      }).join("") + "</ul>";
    }
    return head + '<table class="vl-abgt"><thead><tr><th scope="col"><span class="sp-sr">ABG</span></th>' +
      (a0 ? '<th scope="col">' + s("before") + "<small>" + esc(clockText(a0.t)) + "</small></th>" : "") +
      '<th scope="col">' + s(a0 ? "now" : "now") + "<small>" + esc(clockText(a1.t)) + "</small></th>" + (a0 ? '<th scope="col"><span class="sp-sr">' + s("whyH") + "</span></th>" : "") + "</tr></thead><tbody>" + rows +
      (pf != null && !beg ? '<tr><th scope="row">' + s("pf") + "</th>" + (a0 ? "<td>" + esc(fmtN(a0.fio2 ? Math.round(a0.abg.PaO2 / (a0.fio2 / 100)) : null)) + "</td>" : "") + "<td><b>" + esc(fmtN(pf)) + "</b></td>" + (a0 ? "<td></td>" : "") + "</tr>" : "") +
      "</tbody></table>" + (a0 ? why : '<p class="vl-empty">' + s("abgAgain") + "</p>");
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
    var b = q("[data-act=vldraw]"); if (b) b.focus({ preventScroll: true });
    I.haptic("tap");
    say(raw("abgSay", { t: clockText(R.s.t), a: fmtN(a.pH), b: fmtN(a.PaCO2), c: fmtN(a.PaO2), d: fmtN(a.HCO3) }));
  };

  /* ---- alarms ---- */
  function activeAlarms() {
    var list = safe(function () { return E().alarms(R.s, R.set); }, []);
    var ids = {};
    list.forEach(function (a) { ids[a.id] = 1; });
    Object.keys(R.ack).forEach(function (id) { if (!ids[id]) delete R.ack[id]; });
    return list.filter(function (a) { return !R.ack[a.id]; }).sort(function (a, b) { return (b.severity === "danger") - (a.severity === "danger"); });
  }
  function alarmsHtml() {
    var list = activeAlarms();
    R.alarmSig = list.map(function (a) { return a.id + (R.sil[a.id] > R.s.t ? "s" : ""); }).join(",") + "|" + L();
    if (!list.length) return '<p class="vl-al-none">' + (ico("check") ? '<span aria-hidden="true">' + ico("check") + "</span>" : "") + s("alarmsNone") + "</p>";
    var more = list.length > 1 ? '<button type="button" class="vl-al-more" data-act="vlalall" aria-label="' + s("allAlarms", { n: list.length }) + '">' + s("plusN", { n: list.length - 1 }) + "</button>" : "";
    return '<h2 class="sp-sr">' + s("alarmsH") + '</h2><ul class="vl-al-list">' + list.map(function (a) {
      var sil = R.sil[a.id] > R.s.t;
      return '<li><button type="button" class="vl-al ' + esc(a.severity || "warn") + (sil ? " sil" : "") + '" data-act="vlalarm" data-k="' + esc(a.id) + '" aria-label="' + s("alarmOpen", { x: t(a.label) }) + (sil ? ", " + s("silenced") : "") + '">' +
        '<span class="vl-al-i" aria-hidden="true">' + (ico(a.severity === "danger" ? "siren" : "warn") || "!") + "</span>" + tx(a.label) + (sil ? ' <small>' + s("silenced") + "</small>" : "") + "</button></li>";
    }).join("") + "</ul>" + more;
  }
  // Alarm answers for the score: an alarm that clears after a learner change counts as handled.
  function trackAlarms() {
    var now = safe(function () { return E().alarms(R.s, R.set); }, []), ids = {};
    now.forEach(function (a) { ids[a.id] = 1; if (R.seen[a.id] == null) R.seen[a.id] = R.s.t; });
    Object.keys(R.seen).forEach(function (id) {
      if (ids[id]) return;
      if (R.lastSet >= R.seen[id] || R.lastAct >= R.seen[id]) R.answers.push({ kind: "alarm", id: id, correct: true });
      delete R.seen[id];
    });
  }
  function finalAnswers() {
    var out = R.answers.slice();
    Object.keys(R.seen).forEach(function (id) { if (R.s.t - R.seen[id] >= 300) out.push({ kind: "alarm", id: id, correct: false }); });
    return out;
  }
  function updAlarms() {
    var el = $("vlAlarms"); if (!el) return;
    trackAlarms();
    var list = activeAlarms(), sig = list.map(function (a) { return a.id + (R.sil[a.id] > R.s.t ? "s" : ""); }).join(",") + "|" + L();
    if (sig === R.alarmSig) return;
    var a = G.document.activeElement, keep = a && el.contains(a) ? a.getAttribute("data-k") : null;
    el.innerHTML = alarmsHtml();
    if (keep) { var n = el.querySelector('[data-k="' + keep + '"]'); if (n) n.focus({ preventScroll: true }); }
  }
  A.vlalarm = function (b) {
    var id = b.getAttribute("data-k"), a = activeAlarms().filter(function (x) { return x.id === id; })[0], c = (learn().alarms || {})[id] || {};
    var list = function (arr) { return arr && arr.length ? "<ul>" + arr.map(function (x) { return "<li>" + tx(x) + "</li>"; }).join("") + "</ul>" : ""; };
    sheet((a ? tx(a.label) : esc(id)),
      '<div class="vl-acard ' + esc((a && a.severity) || "warn") + '">' +
      // the bedside actions this card's troubleshooting names come first: they are what to do now
      (function () { var ks = alarmActs(id), acts = E().ACTIONS || {}; return ks.length ? '<h3 class="vl-h3">' + s("bedH") + '</h3><div class="vl-bed-g vl-bed-s">' + ks.map(function (k) { return bedBtn({ id: k, a: acts[k], on: safe(function () { return acts[k].available(R.s); }, false), sug: true }, true); }).join("") + "</div>" : ""; })() +
      (c.causes ? '<h3 class="vl-h3">' + s("causes") + "</h3>" + list(c.causes) : "") +
      (c.clue ? '<h3 class="vl-h3">' + s("clue") + "</h3><p>" + tx(c.clue) + "</p>" : "") +
      (c.steps ? '<h3 class="vl-h3">' + s("trouble") + '</h3><ol class="vl-ol">' + c.steps.map(function (x) { return "<li>" + tx(x) + "</li>"; }).join("") + "</ol>" : "") +
      (c.fix ? '<h3 class="vl-h3">' + s("fix") + '</h3><p class="vl-fix">' + tx(c.fix) + "</p>" : "") +
      "</div>",
      '<button type="button" class="sp-btn sec" data-act="vlsil" data-k="' + esc(id) + '">' + s("silence") + '</button><button type="button" class="sp-btn pri" data-act="vlack" data-k="' + esc(id) + '">' + s("ack") + "</button>", b);
  };
  A.vlalall = function (b) {
    var list = activeAlarms();
    sheet(s("alarmsH"), '<ul class="vl-al-list vl-al-sheet">' + list.map(function (a) {
      return '<li><button type="button" class="vl-al ' + esc(a.severity || "warn") + '" data-act="vlalarm" data-k="' + esc(a.id) + '"><span class="vl-al-i" aria-hidden="true">' + (ico(a.severity === "danger" ? "siren" : "warn") || "!") + "</span>" + tx(a.label) + "</button></li>";
    }).join("") + "</ul>", null, b);
  };
  A.vlsil = function (b) { var id = b.getAttribute("data-k"); R.sil[id] = R.s.t + 120; R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "silence:" + id }); closeSheet(true); R.alarmSig = ""; updAlarms(); focusAlarmBar(); };
  A.vlack = function (b) { var id = b.getAttribute("data-k"); R.ack[id] = 1; R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "ack:" + id }); closeSheet(true); R.alarmSig = ""; updAlarms(); focusAlarmBar(); };
  function focusAlarmBar() { var n = q(".vl-alarms button") || q(".vl-mode"); if (n) n.focus({ preventScroll: true }); }

  /* ---- bedside actions (engine E.ACTIONS / E.act) ---- */
  var BED_ICO = { decompress: "syringe", suction: "droplet", bag100: "lungs" };
  // Which actions an alarm card suggests: read from its own troubleshooting text in learn.json, not hard-coded here.
  var BED_RX = { decompress: /decompress|needle|drain/i, suction: /suction/i, bag100: /\bbag/i };
  function alarmActs(id) {
    var c = (learn().alarms || {})[id] || {}, txt = (c.steps || []).concat(c.fix ? [c.fix] : []).map(function (x) { return x && x.en ? x.en : String(x || ""); }).join(" ");
    return Object.keys(BED_RX).filter(function (k) { return E().ACTIONS && E().ACTIONS[k] && BED_RX[k].test(txt); });
  }
  function bedSuggested() { var o = {}; activeAlarms().forEach(function (a) { alarmActs(a.id).forEach(function (k) { o[k] = 1; }); }); return o; }
  function bagLeft() { var m = R.s.m || {}; return m.bagUntil > R.s.t ? Math.ceil(m.bagUntil - R.s.t) : 0; }
  function bedList() {
    var acts = (E() && E().ACTIONS) || {}, sug = bedSuggested();
    return Object.keys(acts).filter(function (k) { return lv() >= 2 || sug[k]; }).map(function (k) {
      return { id: k, a: acts[k], on: safe(function () { return acts[k].available(R.s); }, false), sug: !!sug[k] };
    });
  }
  function bedBtn(x, inSheet) {
    var stat = !x.on ? (x.id === "decompress" ? s("drainIn") : x.id === "bag100" ? s("bagging") : "") : x.sug && !inSheet ? s("bedSug") : "";
    return '<button type="button" class="vl-bedb' + (x.sug ? " sug" : "") + '" data-act="vlbed" data-k="' + esc(x.id) + '"' + (x.on ? "" : ' aria-disabled="true"') + ">" +
      '<span class="vl-bedb-i" aria-hidden="true">' + ico(BED_ICO[x.id] || "plus") + '</span><span class="vl-bedb-t">' + tx(x.a.label) + (stat ? "<small>" + stat + "</small>" : "") + "</span></button>";
  }
  function bedHtml() {
    var list = bedList();
    R.bedSig = list.map(function (x) { return x.id + (x.on ? 1 : 0) + (x.sug ? "s" : ""); }).join(",") + "|" + lv() + L();
    if (!list.length) return "";
    return '<section class="vl-bed" data-vl-id="bedside" aria-labelledby="vlBedH"><div class="vl-bed-h"><h2 class="vl-h" id="vlBedH">' + s("bedH") + '</h2><p class="vl-bed-n">' + s("bedNote") + "</p></div>" +
      '<div class="vl-bed-g" role="group" aria-labelledby="vlBedH">' + list.map(function (x) { return bedBtn(x); }).join("") + "</div></section>";
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
    if (!w) return;
    var list = bedList(), sig = list.map(function (x) { return x.id + (x.on ? 1 : 0) + (x.sug ? "s" : ""); }).join(",") + "|" + lv() + L();
    if (sig === R.bedSig) return;
    var a = G.document.activeElement, keep = a && w.contains(a) ? a.getAttribute("data-k") : null;
    w.innerHTML = bedHtml();
    if (keep) { var n2 = w.querySelector('[data-k="' + keep + '"]'); if (n2) n2.focus({ preventScroll: true }); }
  }
  A.vlbed = function (b) {
    var id = b.getAttribute("data-k"), e = E(), a = e.ACTIONS && e.ACTIONS[id];
    if (!a || !safe(function () { return a.available(R.s); }, false)) return;
    var inSheet = !!b.closest(".vl-sheet");
    R.s = e.act(R.s, id);
    R.lastAct = R.s.t || 0.001;
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: cur(), action: "act:" + id });
    if (inSheet) closeSheet(true);
    refresh(true);
    I.haptic("tap");
    toast("event", s("bedDone", { x: t(a.label) }));
    say(raw("bedDone", { x: t(a.label) }) + (id === "bag100" ? ". " + raw("bagOff") : ""));
    var n = q('#vlBedW [data-k="' + id + '"]') || q("#vlBedW button") || q(".vl-mode"); if (n) n.focus({ preventScroll: true });
  };

  /* ---- time ---- */
  var LIVE = { tm: 0 };
  function startLive() { stopLive(); LIVE.tm = G.setInterval(function () { if (!R || st.view !== "vl-run" || G.document.hidden) return; tick(1); }, 1000); }
  function stopLive() { if (LIVE.tm) G.clearInterval(LIVE.tm); LIVE.tm = 0; }
  function tick(sec) {
    R.s = E().step(R.s, R.set, sec);
    var r = refresh();
    if (R.s.t - R.lastLog >= 60) { R.lastLog = R.s.t; R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: "live" }); }
  }
  // flash: a Confirm or a time skip (not a live tick): changed numbers get a brief tint so the eye finds them.
  function refresh(flash) {
    var r = cur();
    updMonitor(r, flash); updVent(r, flash);
    var ov = $("vlOv"); if (ov) ov.innerHTML = ovHtml(r);
    updAlarms(); updBed();
    var c = $("vlClock"); if (c) c.textContent = raw("simTime", { x: clockText(R.s.t) });
    events();
    if (R.tut) tutWatch(r);
    return r;
  }
  function events() {
    var tl = R.sc.timeline || [];
    tl.forEach(function (ev, i) {
      if (i < R.evSeen || ev.t > R.s.t) return;
      R.evSeen = i + 1;
      if (ev.note) toast("event", tx(ev.note));
    });
  }
  A.vllive = function () {
    R.live = !R.live;
    if (R.live) startLive(); else stopLive();
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var b = q("[data-act=vllive]"); if (b) b.focus({ preventScroll: true });
  };
  A.vlskip = function (b) {
    if (!R) return;
    var k = +b.getAttribute("data-k"), lab = k === 300 ? "t5" : k === 900 ? "t15" : k === 1800 ? "t30" : "t60";
    // Five-minute chunks so the score sees the course of the wait, not only its end.
    for (var done = 0; done < k; done += 300) {
      R.s = E().step(R.s, R.set, Math.min(300, k - done));
      R.log.push({ t: R.s.t, settings: clone(R.set), readout: E().readout(R.s, R.set), action: done + 300 >= k ? "wait:" + k : "wait" });
    }
    R.lastLog = R.s.t;
    var r = refresh(true);
    var f = $("vlFoot"); if (f) f.innerHTML = footHtml();
    var n = q('[data-act=vlskip][data-k="' + k + '"]'); if (n) n.focus({ preventScroll: true });
    I.haptic("tap");
    var v = r.vitals || {}, g = r.gas || {};
    say(raw("skipped", { x: t(STR[lab]).replace("+", ""), a: fmtN(v.spo2), b: fmtN(g.paco2), c: fmtN(v.map) }));
    hint(r);
  };

  /* ---- hints: a question that points at the cause without naming the fix ---- */
  function hint(r) {
    var g = R.sc.goals || {}, v = r.vent || {}, w = r.vitals || {}, gs = r.gas || {}, kg = ptPbw(R.sc), id = null;
    if (v.pplat > (g.pplatMax || 30)) id = "hPlat";
    else if (g.vtPerKg && v.vte / kg > g.vtPerKg[1] + 0.5) id = "hVt";
    else if (v.drivingP > (g.drivingMax || 15)) id = "hDrive";
    else if (v.autoPeep > 2) id = "hAuto";
    else if (w.map != null && w.map < 65) id = "hMap";
    else if (g.spo2 && w.spo2 < g.spo2[0]) id = "hO2";
    else if ((g.ph && (gs.ph < g.ph[0] || gs.ph > g.ph[1])) || (g.paco2 && (gs.paco2 < g.paco2[0] - 3 || gs.paco2 > g.paco2[1] + 3))) id = "hCo2";
    else if (g.spo2 && w.spo2 > g.spo2[1] && R.set.fio2 > 40) id = "hO2hi";
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
      return '<div class="vl-mrow' + (on ? " on" : "") + '"><button type="button" class="vl-mbtn" data-act="vlmpick" data-k="' + esc(id) + '" aria-pressed="' + on + '"><b>' + esc(modeShort(id)) + '</b><span class="vl-mbtn-t">' + esc(modeParts(id).head) + (modeParts(id).note ? "<small>" + esc(modeParts(id).note) + "</small>" : "") + "</span>" +
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
    var keys = lv() <= 1 ? ["beginner", "what", "up", "down", "risks"] : ["what", "controls", "up", "down", "oxygenation", "ventilation", "risks", "use", "pearl"];
    var body = (d.min != null ? '<p class="vl-range">' + s("range", { a: setText(k, d.min), b: setText(k, d.max), u: d.unit || "" }) + "</p>" : "") +
      '<dl class="vl-mcard vl-lcard">' + keys.filter(function (x) { return c[x]; }).map(function (x) {
        return '<div class="lk-' + x + '"><dt>' + s("ls_" + x) + "</dt><dd>" + tx(c[x]) + "</dd></div>";
      }).join("") + "</dl>";
    sheet(esc(setLabel(k)), body, null, b);
  };

  /* ---- tutorial coach ---- */
  A.vltut = function (b) {
    var tu = (learn().tutorials || []).filter(function (x) { return x.id === b.getAttribute("data-k"); })[0];
    if (!tu) return;
    var first = (tu.steps || [])[0], sid = first && first.do && first.do.scenario, sc = (sid && scById(sid)) || VL.scen.filter(function (x) { return (x.level || 1) <= lv(); })[0] || VL.scen[0];
    start(noTimeline(sc), { tu: tu, i: 0, ok: false, saw: false, base: null });
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
    R.tut.ok = !sp.do || !!sp.do.scenario; R.tut.saw = !sp.expect; R.tut.base = null; R.tut.moved = 0; R.tut.flat = false;
    if (sp.do && sp.do.scenario && sp.do.scenario !== R.sc.id) { var sc = scById(sp.do.scenario); if (sc) { var tu = R.tut; tu.pre = null; start(noTimeline(sc), tu); return; } }
    if (sp.do && sp.do.key != null && String(R.set[sp.do.key]) === String(sp.do.to)) R.tut.ok = true;
    if (sp.do && sp.do.mode && R.set.mode === sp.do.mode) R.tut.ok = true;
    if (sp.expect && R.tut.ok) tutObserve(sp);
    var ro = $("vlRo"); if (ro) ro.innerHTML = roHtml(cur());
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
  function coachHtml() {
    var tu = R.tut.tu, sp = tutStep(), n = tu.steps.length, last = R.tut.i >= n - 1, task = "";
    if (sp.do && sp.do.key != null) task = s("setTo", { x: setLabel(sp.do.key), v: setText(sp.do.key, sp.do.to) + (setUnit(sp.do.key) ? " " + setUnit(sp.do.key) : "") });
    else if (sp.do && sp.do.mode) task = s("modeTo", { x: modeShort(sp.do.mode) });
    var exp = "";
    if (sp.expect) {
      if (R.tut.saw) exp = '<p class="vl-co-ok">' + (ico("check") || "") + s("sawIt", { x: expName(sp), d: raw(sp.expect.direction === "down" ? "down" : "up") }) + "</p>";
      else if (R.tut.flat) exp = '<p class="vl-co-wait">' + s("tutFlat", { x: expName(sp) }) + "</p>";
      else if (R.tut.ok) exp = '<p class="vl-co-wait">' + s("waitSee", { x: expName(sp) }) + "</p>";
      else exp = '<p class="vl-co-wait">' + s("tutLook", { x: expName(sp) }) + "</p>";
      if (R.tut.moved) exp += '<p class="vl-co-wait">' + s("tutMoved", { m: R.tut.moved }) + "</p>";
    }
    var canNext = R.tut.ok && (R.tut.saw || R.tut.flat);
    return '<div class="vl-co-h"><span>' + tx(tu.title) + " · " + s("stepOf", { i: R.tut.i + 1, n: n }) + '</span><button type="button" class="vl-co-x" data-act="vltutx">' + s("exitTut") + "</button></div>" +
      '<div class="vl-co-bar" aria-hidden="true"><i style="transform:scaleX(' + ((R.tut.i + 1) / n).toFixed(3) + ')"></i></div>' +
      '<p class="vl-co-say" id="vlCoSay" tabindex="-1">' + tx(sp.say) + "</p>" +
      (task ? '<p class="vl-co-task"><b>' + s("yourTurn") + "</b> " + task + (R.tut.ok ? ' <span class="vl-co-done">' + (ico("check") || "") + s("doneStep") + "</span>" : "") + "</p>" : "") + exp +
      '<div class="vl-co-f">' + (task && !R.tut.ok ? '<button type="button" class="sp-btn sec" data-act="vltutdo">' + s("doIt") + "</button>" : "") +
      '<button type="button" class="sp-btn pri" data-act="vltutn"' + (canNext ? "" : ' aria-disabled="true"') + ">" + s(last ? "done" : "next") + "</button></div>";
  }
  function paintCoach(focus) {
    var el = $("vlCoach");
    if (!el) { var r = I.root(); el = G.document.createElement("div"); el.className = "vl-coach"; el.id = "vlCoach"; el.setAttribute("role", "region"); el.setAttribute("aria-label", raw("tut")); r.appendChild(el); var sc = q(".vl-scroll"); if (sc) sc.classList.add("has-coach"); }
    el.innerHTML = coachHtml();
    if (focus) { var n = $("vlCoSay"); if (n) n.focus({ preventScroll: true }); }
  }
  function tutHighlight(still) {
    [].forEach.call(I.root().querySelectorAll(".vl-hl"), function (n) { n.classList.remove("vl-hl"); });
    var sp = tutStep(); if (!sp || !sp.highlight) return;
    var first = null;
    sp.highlight.forEach(function (id) { [].forEach.call(I.root().querySelectorAll('[data-vl-id="' + id + '"]'), function (n) { n.classList.add("vl-hl"); first = first || n; }); });
    if (first && !still) scrollTo(first, true);
  }
  function tutCheck() {
    var sp = tutStep(); if (!sp || !sp.do) return;
    if (sp.do.key != null && String(R.set[sp.do.key]) === String(sp.do.to)) R.tut.ok = true;
    if (sp.do.mode && R.set.mode === sp.do.mode) R.tut.ok = true;
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
    if (sp.do.key != null) R.pend[sp.do.key] = sp.do.to; else if (sp.do.mode) R.pend.mode = sp.do.mode;
    var sEl = $("vlSet"); if (sEl) sEl.outerHTML = setHtml();
    confirmChanges();
    var n = q("[data-act=vltutn]"); if (n) n.focus({ preventScroll: true });
  };
  A.vltutn = function (b) {
    if (b.getAttribute("aria-disabled") === "true") return;
    if (R.tut.i >= R.tut.tu.steps.length - 1) { prefs().tuts[R.tut.tu.id] = 1; savePrefs(); return tutEnd(); }
    R.tut.i++; tutEnter(); paintCoach(true);
  };
  function tutEnd() { R.tut = null; var c = $("vlCoach"); if (c) c.parentNode.removeChild(c); var sc = q(".vl-scroll"); if (sc) sc.classList.remove("has-coach"); tutHighlight(); paintFoot(); var m = q(".vl-mode"); if (m) m.focus(); }
  A.vltutx = function () { tutEnd(); };

  /* ================= debrief ================= */
  A.vlfinish = function () {
    if (!R) return;
    var e = E(), r = cur();
    R.log.push({ t: R.s.t, settings: clone(R.set), readout: r, action: "finish" });
    R.score = safe(function () { return e.score({ scenario: R.sc, scenarioId: R.sc.id, log: R.log, answers: finalAnswers() }); }, { total: 0, parts: {}, notes: [] });
    R.final = r;
    var ok = (R.score.total || 0) >= 70, today = I.today();
    if (C && st.store) { try { C.recordSim(st.store, "ventlab", ok, ok ? null : "low", today); I.save(); } catch (x) {} }
    var b = prefs().best; b[R.sc.id] = Math.max(b[R.sc.id] || 0, R.score.total || 0); savePrefs();
    I.haptic(ok ? "success" : "error");
    debrief(".vl-score");
  };
  function debrief(focusSel) {
    var sc = R.sc, sco = R.score, r = R.final, g = sc.goals || {}, kg = ptPbw(sc);
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-done"; st.again = debrief;
    st.onBack = function () { home(); return true; };
    var MX = E().SCORE_MAX || {};
    var parts = Object.keys(sco.parts || {}).map(function (k) {
      var v = +sco.parts[k] || 0, mx = MX[k];
      if (k === "unsafe") return v < 0 ? '<li class="vl-pen"><span class="vl-pl">' + s("p_unsafe") + '</span><span class="vl-pnote">' + s("penalty") + "</span><b>" + I.fmt(v) + "</b></li>" : "";
      var pct = mx ? clamp(v / mx * 100, 0, 100) : clamp(v, 0, 100);
      return '<li><span class="vl-pl">' + s("p_" + k) + '</span><span class="vl-pbar" aria-hidden="true"><i style="width:' + pct.toFixed(0) + '%"></i></span><b>' + I.fmt(v) + (mx ? '<small>/' + mx + "</small>" : "") + "</b></li>";
    }).join("");
    var v = r.vitals || {}, vv = r.vent || {}, gs = r.gas || {}, tg = [];
    function goal(lab, val, ok) { tg.push("<tr><th scope=\"row\">" + lab + "</th><td>" + val + '</td><td class="' + (ok ? "ok" : "bad") + '">' + s(ok ? "met" : "notMet") + "</td></tr>"); }
    if (g.spo2) goal("SpO2 " + g.spo2[0] + " to " + g.spo2[1], fmtN(v.spo2), v.spo2 >= g.spo2[0] && v.spo2 <= g.spo2[1]);
    if (g.paco2) goal("PaCO2 " + g.paco2[0] + " to " + g.paco2[1], fmtN(gs.paco2), gs.paco2 >= g.paco2[0] && gs.paco2 <= g.paco2[1]);
    if (g.ph) goal("pH " + g.ph[0] + " to " + g.ph[1], fmtN(gs.ph), gs.ph >= g.ph[0] && gs.ph <= g.ph[1]);
    if (g.pplatMax) goal("Pplat &le; " + g.pplatMax, fmtN(vv.pplat), vv.pplat <= g.pplatMax);
    if (g.drivingMax && vv.drivingP != null) goal("Driving P &le; " + g.drivingMax, fmtN(vv.drivingP), vv.drivingP <= g.drivingMax);
    if (g.vtPerKg && vv.vte) { var pk = Math.round(vv.vte / kg * 10) / 10; goal("VT " + g.vtPerKg[0] + " to " + g.vtPerKg[1] + " mL/kg", fmtN(pk), pk >= g.vtPerKg[0] - 0.3 && pk <= g.vtPerKg[1] + 0.3); }
    var notes = (sco.notes || []).concat(sc.debrief || []);
    var tone = sco.total >= 80 ? "ok" : sco.total >= 60 ? "mid" : "bad";
    I.paint(I.top(t(STR.backLab), s("debrief"), tx(sc.title), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vl-done">' +
      '<div class="vl-score ' + tone + '" tabindex="-1"><b>' + I.fmt(sco.total || 0) + "</b><span>" + s("outOf") + "</span></div>" +
      '<ul class="vl-parts">' + parts + "</ul>" +
      (tg.length ? '<h2 class="sp-h2">' + s("atEnd") + '</h2><table class="vl-goals"><tbody>' + tg.join("") + "</tbody></table>" : "") +
      (notes.length ? '<h2 class="sp-h2">' + s("takeaway") + '</h2><ul class="dr-lines vl-notes">' + notes.map(function (n) { return "<li>" + tx(n) + "</li>"; }).join("") + "</ul>" : "") +
      I.maikBtn(STR.maikQ.en + ": " + (sc.title && sc.title.en) + ". Score " + sco.total + ". " + notes.map(function (n) { return typeof n === "string" ? n : n.en; }).join(" ") + " Explain what the best ventilator settings would have been and why.") +
      '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + "</span></p></div></div>" +
      '<div class="sp-foot"><div class="mcq-foot2"><button type="button" class="sp-btn sec" data-act="vlhome">' + s("labHome") + '</button><button type="button" class="sp-btn pri" data-act="vlrerun">' + s("again") + "</button></div></div>",
      typeof focusSel === "string" ? focusSel : null);
  }
  A.vlhome = function () { home(); };
  A.vlrerun = function () { if (R) start(R.sc); };

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
    if (WI.res) { WI.res.chain = fresh(WI.res.chain); var box = $("vlChain"); if (box) box.innerHTML = chainBody(WI.res.chain, true); }
  }
  function wiCompute(key, dir, presetChain) {
    var e = E(), sc = scById(WI.sc), st0 = e.init(clone(sc), null), set0 = baseSettings(sc), d = setDef(key);
    var to = stepVal(d, set0[key], dir, WI_DELTA[key] ? WI_DELTA[key] / (d.step || 1) : 4), set1 = clone(set0); set1[key] = to;
    var wi = safe(function () { return e.whatIf(st0, set0, { key: key, to: to }); }, null);
    var pB = safe(function () { return e.step(clone(st0), set0, 1800); }, st0), pA = safe(function () { return e.step(clone(st0), set1, 1800); }, st0);
    var prB = (wi && wi.before) || e.readout(pB, set0), prA = (wi && wi.after) || e.readout(pA, set1);
    var reasons = safe(function () { return e.explainDelta(e.abg(pB), e.abg(pA), set0, set1, pB, pA); }, []);
    var chain = compose({ setB: set0, setA: set1, keys: [key], roB: e.readout(st0, set0), roA: e.readout(st0, set1), prB: prB, prA: prA, reasons: reasons, wiChain: presetChain });
    return { key: key, from: set0[key], to: to, before: prB, after: prA, chain: chain };
  }
  function wiResHtml(res) {
    var rows = [["SpO2", "vitals", "spo2", "%"], ["PaO2", "gas", "pao2", "mmHg"], ["PaCO2", "gas", "paco2", "mmHg"], ["pH", "gas", "ph", ""], ["Pplat", "vent", "pplat", "cmH2O"], ["Driving P", "vent", "drivingP", "cmH2O"], ["Auto-PEEP", "vent", "autoPeep", "cmH2O"], ["MAP", "vitals", "map", "mmHg"], ["HR", "vitals", "hr", "/min"]];
    var body = rows.filter(function (x) { return (res.before[x[1]] || {})[x[2]] != null; }).map(function (x) {
      var a = res.before[x[1]][x[2]], b = res.after[x[1]][x[2]], d = dirOf(a, b, x[2] === "ph" ? 0.004 : 0.5);
      return '<tr><th scope="row">' + esc(x[0]) + "</th><td>" + esc(fmtN(a)) + "</td><td><b>" + esc(fmtN(b)) + "</b></td><td>" + arrow(d) + '<span class="sp-sr">' + s(d > 0 ? "up" : d < 0 ? "down" : "same") + "</span></td></tr>";
    }).join("");
    var u = setUnit(res.key);
    return '<h2 class="vl-h vl-wi-h">' + s("cSet", { x: setLabel(res.key), a: setText(res.key, res.from) + (u ? " " + u : ""), b: setText(res.key, res.to) + (u ? " " + u : "") }) + "</h2>" +
      '<div class="vl-wi-grid"><div class="vl-card"><table class="vl-abgt vl-ba"><thead><tr><th scope="col"><span class="sp-sr">' + s("wiSetting") + '</span></th><th scope="col">' + s("wiNow") + '</th><th scope="col">' + s("wiAfter") + '</th><th scope="col"><span class="sp-sr">' + s("whyH") + "</span></th></tr></thead><tbody>" + body + "</tbody></table>" +
      '<p class="sp-small">' + s("simulated") + "</p></div>" +
      '<section class="vl-card vl-chainw" aria-labelledby="vlChH"><h2 class="vl-h" id="vlChH">' + s("chain") + '</h2><div id="vlChain"></div></section></div>';
  }
  function wiRun(key, dir, presetChain, preset) {
    WI.key = key; WI.dir = dir; WI.preset = preset;
    WI.res = wiCompute(key, dir, presetChain);
    whatIf("#vlWiRes");
    var box = $("vlChain"), c = WI.res.chain;
    if (box && !reduced()) {
      box.innerHTML = chainBody(c, false);
      c.steps.forEach(function (k, i) { CHT.push(G.setTimeout(function () { var li = box.querySelector('[data-step="' + k + '"]'); if (li) li.setAttribute("data-state", c.data[k].on ? "on" : "same"); }, 140 + i * 210)); });
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
  var CS = { i: 0, a1: null, a2: null, res: null };
  A.vlcases = function () { CS.i = 0; CS.a1 = null; CS.a2 = null; CS.res = null; caseView(); };
  function optText(o) { return o && o.label ? tx(o.label) : tx(o); }
  function caseView(focusSel) {
    var list = learn().cases || [], c = list[CS.i];
    I.leave(); closeSheet(true); wvStop();
    st.view = "vl-case"; st.again = caseView;
    st.onBack = function () { home("[data-act=vlcases]"); return true; };
    if (!c) return home();
    var ab = c.abg || {};
    var card = ABG_ROWS.filter(function (x) { return ab[x[0]] != null; }).map(function (x) {
      var v = ab[x[0]], lo = v < x[2], hi = v > x[3];
      return '<div class="' + (lo || hi ? "out" : "") + '"><dt>' + (x[1] === "lact" ? s("lact") : esc(x[1])) + "</dt><dd><b>" + esc(fmtN(v)) + "</b>" + (lo || hi ? '<span class="vl-flag">' + s(lo ? "low" : "high") + "</span>" : "") +
        '<small>' + s("normal", { a: x[2], b: x[3] }) + "</small></dd></div>";
    }).join("") + (ab.FiO2 != null ? "<div><dt>FiO2</dt><dd><b>" + esc(fmtN(ab.FiO2 <= 1 ? Math.round(ab.FiO2 * 100) : ab.FiO2)) + "</b><small>%</small></dd></div>" : "") + (c.spo2 != null ? "<div><dt>SpO2</dt><dd><b>" + esc(fmtN(c.spo2)) + "</b><small>%</small></dd></div>" : "");
    function opts(qq, act, ans) {
      return '<div class="sp-answers' + (ans != null ? " done" : "") + '" role="group">' + (qq.options || []).map(function (o, j) {
        var state = ans == null ? "" : j === qq.answer ? "right" : j === ans ? "wrong" : "dim";
        return '<button type="button" class="sp-ans" data-act="' + act + '" data-o="' + j + '"' + (state ? ' data-state="' + state + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + (state === "right" ? ico("check") || "A" : state === "wrong" ? ico("close") || "x" : "ABCD".charAt(j)) + "</span>" + optText(o) + "</button>";
      }).join("") + "</div>";
    }
    var q1 = c.q1 || {}, q2 = c.q2 || {};
    var h = '<div class="vl-card vl-abgcard" aria-label="ABG"><dl>' + card + "</dl></div>" +
      '<h2 class="sp-h3 vl-q" id="vlQ1">' + s("q1") + ": " + tx(q1.ask) + "</h2>" + opts(q1, "vlq1", CS.a1);
    if (CS.a1 != null) {
      h += '<p class="sp-verdict vl-v1 ' + (CS.a1 === q1.answer ? "ok" : "bad") + '" tabindex="-1">' + (ico(CS.a1 === q1.answer ? "check" : "close") || "") + "<span>" + s(CS.a1 === q1.answer ? "right" : "wrong") + "</span></p>" +
        (q1.why ? '<p class="vl-whyp">' + tx(q1.why) + "</p>" : "") +
        '<h2 class="sp-h3 vl-q" id="vlQ2">' + s("q2") + ": " + tx(q2.ask) + "</h2>" + opts(q2, "vlq2", CS.a2);
    }
    if (CS.a2 != null) {
      var rr = CS.res;
      h += '<p class="sp-verdict vl-v2 ' + (CS.a2 === q2.answer ? "ok" : "bad") + '" tabindex="-1">' + (ico(CS.a2 === q2.answer ? "check" : "close") || "") + "<span>" + s(CS.a2 === q2.answer ? "right" : "wrong") + "</span></p>" +
        (rr && rr.applied && rr.applied.length ? '<p class="vl-applied"><b>' + s("applied") + ":</b> " + rr.applied.map(function (x) { return esc(setLabel(x.k)) + " " + esc(setText(x.k, x.a)) + " &rarr; " + esc(setText(x.k, x.b)) + (setUnit(x.k) ? " " + esc(setUnit(x.k)) : ""); }).join(" · ") + "</p>" : "") +
        (rr ? '<h3 class="vl-h3">' + s("result") + '</h3><div class="vl-card">' + caseResult(rr) + "</div>" : "") +
        (q2.why ? '<h3 class="vl-h3">' + s("whyH") + '</h3><p class="vl-whyp">' + tx(q2.why) + "</p>" : "") +
        (rr && rr.reasons.length ? '<ul class="vl-why">' + rr.reasons.map(function (x) { return "<li>" + arrow(x.direction === "down" ? -1 : 1) + "<span><b>" + esc(x.param || "") + "</b> " + tx(x.because) + "</span></li>"; }).join("") + "</ul>" : "");
    }
    I.paint(I.top(t(STR.backLab), s("cases"), s("caseOf", { i: CS.i + 1, n: list.length }), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vl-case">' + h + '<p class="vl-disc vl-disc-end" role="note"><span>' + disc() + "</span></p></div></div>" +
      (CS.a2 != null ? '<div class="sp-foot"><button type="button" class="sp-btn pri sp-wide" data-act="vlcnext">' + s(CS.i < list.length - 1 ? "nextCase" : "labHome") + "</button></div>" : ""),
      typeof focusSel === "string" ? focusSel : null);
  }
  function caseResult(rr) {
    var rows = [["pH", "ph"], ["PaCO2", "paco2"], ["PaO2", "pao2"], ["HCO3", "hco3"], ["SaO2", "sao2"]];
    return '<table class="vl-abgt vl-ba"><thead><tr><th scope="col"><span class="sp-sr">ABG</span></th><th scope="col">' + s("before") + '</th><th scope="col">' + s("now") + '</th><th scope="col"><span class="sp-sr">' + s("whyH") + "</span></th></tr></thead><tbody>" +
      rows.map(function (x) {
        var a = (rr.before.gas || {})[x[1]], b = (rr.after.gas || {})[x[1]], d = dirOf(a, b, x[1] === "ph" ? 0.004 : 0.5);
        return '<tr><th scope="row">' + x[0] + "</th><td>" + esc(fmtN(a)) + "</td><td><b>" + esc(fmtN(b)) + "</b></td><td>" + arrow(d) + '<span class="sp-sr">' + s(d > 0 ? "up" : d < 0 ? "down" : "same") + "</span></td></tr>";
      }).join("") + "</tbody></table>";
  }
  A.vlq1 = function (b) { if (CS.a1 != null) return; var c = learn().cases[CS.i]; CS.a1 = +b.getAttribute("data-o"); I.haptic(CS.a1 === c.q1.answer ? "success" : "error"); caseView(".vl-v1"); };
  A.vlq2 = function (b) {
    if (CS.a2 != null) return;
    var c = learn().cases[CS.i], j = +b.getAttribute("data-o"), opt = (c.q2.options || [])[j], e = E(), sc = scById(c.scenario) || VL.scen[0];
    CS.a2 = j; CS.res = null;
    if (opt && opt.change && sc) {
      var st0 = e.init(clone(sc), null), set0 = baseSettings(sc), set1 = clone(set0), ch = opt.change;
      if (ch.mode) set1.mode = ch.mode; if (ch.key != null) set1[ch.key] = ch.to;
      var app = ch.key != null ? [[ch.key, ch.to]] : [], k2;
      // a combined option (e.g. lower VT and raise the rate together) carries also: {key: value}
      if (ch.also) for (k2 in ch.also) if (Object.prototype.hasOwnProperty.call(ch.also, k2)) { set1[k2] = ch.also[k2]; app.push([k2, ch.also[k2]]); }
      var wi = ch.key != null ? safe(function () { return e.whatIf(st0, set0, ch); }, null) : null;
      var pB = safe(function () { return e.step(clone(st0), set0, 1800); }, st0), pA = safe(function () { return e.step(clone(st0), set1, 1800); }, st0);
      CS.res = { before: (wi && wi.before) || e.readout(pB, set0), after: (wi && wi.after) || e.readout(pA, set1), reasons: safe(function () { return e.explainDelta(e.abg(pB), e.abg(pA), set0, set1, pB, pA); }, []),
        applied: app.map(function (x) { return { k: x[0], a: set0[x[0]], b: x[1] }; }) };
    }
    if (j === c.q2.answer) { prefs().cases[c.id] = 1; savePrefs(); }
    I.haptic(j === c.q2.answer ? "success" : "error");
    caseView(".vl-v2");
  };
  A.vlcnext = function () { var n = (learn().cases || []).length; if (CS.i >= n - 1) return home("[data-act=vlcases]"); CS.i++; CS.a1 = null; CS.a2 = null; CS.res = null; caseView(); };

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
    el.addEventListener("pointerdown", holdStart);
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (x) { el.addEventListener(x, holdStop); });
  }
  function openLab() { wire(); home(); }
  function register() {
    var e = E();
    if (!e || !e.init || !e.breath) return;
    host.registerSim({ id: "ventlab", title: STR.title, sub: STR.sub, icon: "lungs", level: "mbbs",
      line: function (r) { var b = prefs().best, ks = Object.keys(b), best = 0; ks.forEach(function (k) { best = Math.max(best, b[k]); }); return r && r.n ? s("runs", { n: I.fmt(r.n), b: I.fmt(best) }) : s("none"); },
      open: openLab });
  }
  host._ventLab = { open: openLab, STR: STR };
  if (host._syncers) host._syncers.push(register);
  register();
})(typeof window !== "undefined" ? window : this);
