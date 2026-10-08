/* Narkē Ventilator Lab: the real-ventilator bridge. ES5. Loaded by narke-loader.js after narke-vent.js.
   Takes a junior doctor from the simulator to safely STARTING on a real ventilator under supervision. Pages, in the
   order of the learning path (ITEMS below): "Never change settings alone on day one", "Walk up to the bed" (first five
   minutes checklist), "Reading a real ventilator screen" (an interactive generic panel in three layout styles: SET vs
   MEASURED, the alarm bar, the keys on the frame and the alarm limits page; a set-or-measured quiz and a
   tap-the-number quiz), "Mode names and what is set" (one plain line each, which numbers are SET and which are not,
   a tap quiz), "Alarm messages by brand style" (meaning, priority colour, first steps that follow the engine's alarm
   plans), "3 am drill" (put the alarm steps in order; optional 60 s timer), "Read this screen" (a full panel with an
   alarm and no hints: what first, what to read next), "Hands-on skills" (bagging with a PEEP valve, reconnecting,
   in-line suction, inspiratory hold, cuff gauge, circuit), "Daily care checks", "Handover" (with a blank alarm note
   template), "Pocket card" (one printable page; the senior's name and number stay on this phone only) and the
   "First-night check" (12 mixed questions with teach-back; 10 of 12 earns "Ready to start under supervision").
   A glossary (with brand synonyms) sits under the rows.
   Content: narke/vent/bridge.json (review: ai_drafted). The lab home lists these through
   NARKE_VENT_BRIDGE.homeBlock(level), the one hook in narke-vent.js. Back returns to the lab home.

   PUBLIC PROGRESS API (for the lab's "Your path" card):
     NARKE_VENT_BRIDGE.progress() -> {
       items: [{ id, done, label: {en, hi}, open }],   // in path order; open() opens that page (a function in the
                                                        // browser once the lab is loaded; the page id string otherwise)
       doneCount, total,                                // items done / items listed
       firstNightPassed: boolean,                       // the First-night check was passed (12 of 14 or better)
       ready: boolean,                                  // round 6: "Ready to start under supervision" is earned
       missing: [ids]                                   // round 6: what still stands between the learner and ready,
                                                        // in path order (a subset of READY_IDS); [] when ready
     }
     READY_IDS (round 6, B1): check (First-night check passed), drills (all 5 night drills in a safe order), skills,
     read (Read this screen finished), modes, alarms, screen (both screen-map quizzes finished). ready === !missing.length.
     ids, in order: never, bed, screen, modes, alarms, drills, read, skills, care, hand, card, check.
     It reads only this device's saved progress (localStorage "smd_narke_vbridge"), works before bridge.json has
     loaded, never throws, and returns a fresh object on every call.
   Node (tests): module.exports = { STR, ITEMS, READY_IDS, verdict, order, safeOrder, drillCount, progressOf, cardOrders,
   noteText, perm }. */
(function (G) {
  "use strict";
  function T(en, hi) { return { en: en, hi: hi }; }

  /* ================= pure helpers ================= */
  function seeded(seed) {
    var h = 7, str = String(seed || ""), j;
    for (j = 0; j < str.length; j++) h = (h * 31 + str.charCodeAt(j)) % 2147483647;
    if (!h) h = 1;
    return function () { h = (h * 16807) % 2147483647; return (h - 1) / 2147483646; };
  }
  // A seeded shuffle of the drill's step pool. The content lists steps in the safe order; the pool must not
  // give that away: no step in its own place and no two steps next to each other in their safe order.
  // The same seed always gives the same pool (stable within one attempt).
  function order(steps, seed) {
    var n = steps.length, rnd = seeded(seed);
    if (n < 2) return steps.slice();
    var best = null, bestBad = Infinity;
    for (var t = 0; t < 400 && bestBad > 0; t++) {
      var a = steps.slice(), i, k, x, bad = 0;
      for (i = n - 1; i > 0; i--) { k = Math.floor(rnd() * (i + 1)); x = a[i]; a[i] = a[k]; a[k] = x; }
      for (i = 0; i < n; i++) {
        if (a[i] === steps[i]) bad++;
        if (i < n - 1 && steps.indexOf(a[i + 1]) === steps.indexOf(a[i]) + 1) bad++;
      }
      if (bad < bestBad) { best = a; bestBad = bad; }
    }
    return best;
  }
  // A seeded permutation of 0..n-1 for answer options: the right answer is not always in the same place.
  function perm(n, seed) {
    var a = [], i, k, x, rnd = seeded(seed);
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { k = Math.floor(rnd() * (i + 1)); x = a[i]; a[i] = a[k]; a[k] = x; }
    return a;
  }
  function req(s) { return s.rank != null && !s.flex && !s.opt; }
  // The learner's order against the ranks. rank null = a trap (should be left out); flex = right at any point;
  // opt = right at any point and fine to leave out. A step is "late" when it comes after a step that belongs later
  // (only the later-placed one is marked); before = the first step it should have come before.
  // Returns {ok, items: [{id, state: ok|late|trap|missed|skipped|optional, pos, before?, opt?}], right, of, optMissed}
  // in the content's order. "optional" = an optional step left out: not wrong, and not counted in right / of.
  function verdict(steps, picked) {
    var by = {}, pos = {};
    steps.forEach(function (s) { by[s.id] = s; });
    picked.forEach(function (id, i) { pos[id] = i; });
    var maxRank = -1, state = {}, before = {};
    picked.forEach(function (id, i) {
      var s = by[id];
      if (!s) return;
      if (s.rank == null) { state[id] = "trap"; return; }
      if (s.flex || s.opt) { state[id] = "ok"; return; }
      if (s.rank < maxRank) {
        state[id] = "late";
        for (var j = 0; j < i; j++) { var e = by[picked[j]]; if (e && req(e) && e.rank > s.rank) { before[id] = e.id; break; } }
      } else state[id] = "ok";
      if (s.rank > maxRank) maxRank = s.rank;
    });
    var items = steps.map(function (s) {
      var st = state[s.id] || (s.rank == null ? "skipped" : s.opt ? "optional" : "missed");
      var o = { id: s.id, state: st, pos: pos[s.id] != null ? pos[s.id] : null };
      if (before[s.id]) o.before = before[s.id];
      if (s.opt) o.opt = true;
      return o;
    });
    var counted = items.filter(function (x) { return x.state !== "optional"; });
    var ok = items.every(function (x) { return x.state === "ok" || x.state === "skipped" || x.state === "optional"; });
    return { ok: ok, items: items, of: counted.length, optMissed: items.length - counted.length,
      right: counted.filter(function (x) { return x.state === "ok" || x.state === "skipped"; }).length };
  }
  // The drill score in the learner's own terms (round 5, Kavya): "your 3 steps: 2 in a safe place, 1 to fix, 4 missed".
  // picked = how many steps the learner chose; right = of those, in a safe place; fix = of those, late or a trap;
  // missed = needed steps left out.
  function drillCount(res) {
    var o = { picked: 0, right: 0, fix: 0, missed: 0 };
    res.items.forEach(function (x) {
      if (x.pos != null) { o.picked++; if (x.state === "ok") o.right++; else o.fix++; }
      else if (x.state === "missed") o.missed++;
    });
    return o;
  }
  // The safe order to show next to the learner's: required steps by rank (steps that share a rank share a
  // number: any order between them), then the any-time steps, the optional ones and the traps.
  // Returns [{id, n}] where n is a group number, "any", "opt" or "never".
  function safeOrder(steps) {
    var ranks = [];
    steps.forEach(function (s) { if (req(s) && ranks.indexOf(s.rank) < 0) ranks.push(s.rank); });
    ranks.sort(function (a, b) { return a - b; });
    var main = steps.filter(req).slice().sort(function (a, b) { return a.rank - b.rank; }).map(function (s) { return { id: s.id, n: ranks.indexOf(s.rank) + 1 }; });
    return main.concat(steps.filter(function (s) { return s.rank != null && s.flex && !s.opt; }).map(function (s) { return { id: s.id, n: "any" }; }),
      steps.filter(function (s) { return s.rank != null && s.opt; }).map(function (s) { return { id: s.id, n: "opt" }; }),
      steps.filter(function (s) { return s.rank == null; }).map(function (s) { return { id: s.id, n: "never" }; }));
  }
  // The pocket card's "4 alarms, in order", built from the drills themselves so the card can never disagree with
  // the drill feedback: the required steps by rank, then the any-time call. Traps and optional steps are left out.
  var CARD_DRILLS = ["highp", "lowspo2", "disc", "apnoea"];
  function cardOrders(drills) {
    return CARD_DRILLS.map(function (id) {
      var d = (drills || []).filter(function (x) { return x.id === id; })[0];
      if (!d) return null;
      var by = {}; (d.steps || []).forEach(function (s) { by[s.id] = s; });
      var so = safeOrder(d.steps || []).filter(function (g) { return typeof g.n === "number" || g.n === "any"; });
      return { id: id, title: d.title, steps: so.map(function (g) { return { n: g.n, short: by[g.id].short || by[g.id].text }; }) };
    }).filter(Boolean);
  }
  // The blank alarm note template as plain text (copied to the clipboard; never stored).
  function noteText(fields, lang) {
    return (fields || []).map(function (f) { return (f[lang] || f.en) + ": "; }).join("\n");
  }

  var STR = {
    homeH: T("Before your first real ventilator", "पहले असली ventilator से पहले"),
    homeNote: T("For the ward at night. You look, check and call; you do not change settings alone.", "रात के ward के लिए। आप देखते, जाँचते और call करते हैं; अकेले settings नहीं बदलते।"),
    homeProg: T("{n} of {m} done", "{m} में से {n} पूरे"),
    bed: T("Walk up to the bed", "Bed तक जाएँ"), bedSub: T("Your first five minutes with a ventilated patient", "Ventilated मरीज़ के साथ आपके पहले पाँच मिनट"),
    screen: T("Reading a real ventilator screen", "असली ventilator screen पढ़ना"), screenSub: T("SET vs MEASURED, alarms, silence and limits", "SET बनाम MEASURED, alarms, silence और limits"),
    modes: T("Mode names and what is set", "Mode के नाम और क्या set होता है"), modesSub: T("Know the name and its numbers, do not change it", "नाम और उसके numbers जानें, बदलें नहीं"),
    alarms: T("Alarm messages by brand style", "Brand style के अनुसार alarm messages"), alarmsSub: T("What each one means, its colour, what you do", "हर एक का मतलब, उसका रंग, आप क्या करें"),
    drills: T("3 am drill", "रात 3 बजे की drill"), drillsSub: T("Put the steps in order, then check", "Steps को क्रम में रखें, फिर जाँचें"),
    read: T("Read this screen", "यह screen पढ़ें"), readSub: T("A panel with an alarm, no hints", "Alarm वाला panel, कोई hint नहीं"),
    skills: T("Hands-on skills", "हाथ से करने वाले skills"), skillsSub: T("Bagging, reconnecting, suction, hold, cuff, circuit", "Bag, जोड़ना, suction, hold, cuff, circuit"),
    care: T("Daily care checks", "रोज़ की care जाँच"), careSub: T("Sedation, head up and the VAP bundle", "Sedation, सिर ऊपर और VAP bundle"),
    hand: T("Handover to the next doctor", "अगले doctor को handover"), handSub: T("What to say, and an alarm note template", "क्या बताएँ, और alarm note का ढाँचा"),
    never: T("Never change settings alone on day one", "पहले दिन कभी अकेले settings न बदलें"), neverSub: T("What you may do, and when to call", "आप क्या कर सकते हैं, और कब call करें"),
    card: T("Pocket card", "Pocket card (जेब कार्ड)"), cardSub: T("One page to print or keep on your phone", "Print करने या phone पर रखने के लिए एक page"),
    check: T("First-night check", "पहली रात की जाँच"), checkSub: T("12 mixed questions, pass with 10", "12 मिले जुले प्रश्न, 10 पर pass"),
    gloss: T("Glossary", "शब्दकोश"), glossSub: T("Words in plain language, with brand names", "शब्द आसान भाषा में, brand नामों के साथ"),
    backLab: T("Back to the lab", "Lab पर वापस"), backDrills: T("Back to the drills", "Drills पर वापस"), backScreen: T("Back to the screen map", "Screen map पर वापस"),
    loading: T("Loading…", "लोड हो रहा है…"), loadErr: T("This part did not load. Check your connection and try again.", "यह हिस्सा लोड नहीं हुआ। कनेक्शन जाँचें और फिर कोशिश करें।"), retry: T("Try again", "फिर कोशिश करें"),
    nOfM: T("{n} of {m} checked", "{m} में से {n} जाँचे"), clear: T("Clear the ticks", "सारे tick हटाएँ"),
    allDone: T("All checked", "सब जाँच लिया"),
    set: T("SET", "SET"), meas: T("MEASURED", "MEASURED"), kAlarm: T("ALARM", "ALARM"), kKey: T("KEY", "KEY"), kLim: T("LIMIT", "LIMIT"),
    setL: T("Set by you", "आप set करते हैं"), measL: T("Measured by the machine", "Machine मापती है"),
    alarmL: T("The alarm message", "Alarm का message"), keyL: T("A key on the machine", "Machine पर एक key"), limL: T("An alarm limit", "एक alarm limit"),
    qSet: T("set", "set"), qMeas: T("measured", "मापा"),
    rowSet: T("your orders", "आपके आदेश"), rowMeas: T("what happened", "जो हुआ"), rowKeys: T("Keys on the frame", "Frame पर keys"),
    styleH: T("Panel style", "Panel style"), pageH: T("Page", "Page"), pMain: T("Main screen", "Main screen"), pLim: T("Alarm limits page", "Alarm limits page"),
    legendSet: T("your orders, on the keys", "आपके आदेश, keys पर"), legendMeas: T("what happened, beside the waves", "जो हुआ, waves के पास"),
    limLow: T("Low", "Low"), limHigh: T("High", "High"), limNow: T("Now", "अभी"), limAlarm: T("Alarm", "Alarm"),
    limNote: T("Sensible starting limits for this patient. Your unit's policy first.", "इस मरीज़ के लिए समझदार शुरुआती limits। पहले आपके unit की policy।"),
    tapHint: T("Tap any number, the alarm bar or a key to learn it.", "सीखने के लिए किसी number, alarm bar या key पर tap करें।"),
    opened: T("{n} of {m} learned", "{m} में से {n} सीखे"),
    tileAria: T("{x} {v}, {k}. Learn it", "{x} {v}, {k}। सीखें"),
    panelAria: T("A generic ventilator screen, {x}: the alarm bar at the top, measured values beside the waveforms, set values on the keys at the bottom, keys on the frame below.", "एक generic ventilator screen, {x}: ऊपर alarm bar, waveforms के पास measured values, नीचे keys पर set values, उसके नीचे frame पर keys।"),
    whatH: T("What it is", "यह क्या है"), watchH: T("What to watch", "किस पर ध्यान दें"),
    labelsH: T("Label names by brand, trigger and I:E terms", "Brand के अनुसार label नाम, trigger और I:E शब्द"),
    quizH: T("Quick check: set or measured?", "जल्दी जाँच: set या measured?"), qOf: T("Question {i} of {n}", "{n} में से प्रश्न {i}"),
    right: T("Right", "सही"), wrong: T("Not right", "गलत"), nextQ: T("Next question", "अगला प्रश्न"),
    score: T("{n} of {m} right", "{m} में से {n} सही"), again: T("Try again", "फिर से करें"), best: T("Best {n} of {m}", "सबसे अच्छा {m} में से {n}"),
    rightAns: T("Right answer: {x}", "सही जवाब: {x}"), reviewH: T("Go over these", "इन्हें फिर देखें"), allRightQ: T("Every answer right.", "हर जवाब सही।"),
    sayBack: T("Say it back", "दोहराएँ"),
    findH: T("Find it on the screen", "Screen पर ढूँढें"), findSub: T("Three panel styles, with limits", "तीन panel styles, limits के साथ"),
    findGo: T("Find it: tap-the-number quiz", "ढूँढें: number पर tap वाली quiz"), findWrong: T("Not that one. The right one is marked.", "यह नहीं। सही वाला चिह्नित है।"),
    youTapped: T("You tapped {x}", "आपने {x} tap किया"),
    closest: T("Closest in the lab", "Lab में सबसे नज़दीक"),
    yourOrder: T("Your order", "आपका क्रम"), pool: T("Steps", "Steps"), pickHint: T("Tap the steps in the order you would do them. Leave out anything you should not do.", "Steps को उसी क्रम में tap करें जिसमें आप करेंगे। जो नहीं करना चाहिए उसे छोड़ दें।"),
    empty: T("Nothing yet. Tap the first thing you would do.", "अभी कुछ नहीं। जो पहले करेंगे उसे tap करें।"),
    undo: T("Undo last", "पिछला हटाएँ"), check: T("Check my order", "मेरा क्रम जाँचें"),
    addAria: T("Add: {x}", "जोड़ें: {x}"), yourStep: T("your step {n}", "आपका step {n}"),
    st_ok: T("In a safe place", "सही जगह पर"), st_okAny: T("Right at any point", "किसी भी समय सही"), st_okOpt: T("Optional, and fine where you put it", "वैकल्पिक, और जहाँ रखा वहाँ ठीक"),
    st_late: T("Do this sooner: before “{x}”", "इसे पहले करें: “{x}” से पहले"), st_trap: T("Leave this out", "इसे छोड़ दें"),
    st_missed: T("Missing: this step is needed", "छूट गया: यह step ज़रूरी है"), st_skipped: T("Rightly left out", "सही छोड़ा"), st_optional: T("Optional: fine to leave out", "वैकल्पिक: छोड़ना ठीक है"),
    allRight: T("Safe order. This is what you do at 3 am.", "सुरक्षित क्रम। रात 3 बजे यही करना है।"),
    optLeft: T("Safe order. You left out an optional step: read why below.", "सुरक्षित क्रम। आपने एक वैकल्पिक step छोड़ा: नीचे कारण पढ़ें।"),
    someWrong: T("Your {p} steps: {r} in a safe place, {x} to fix. {m} needed steps missed. Compare with the safe order, then try again.", "आपके {p} steps: {r} सही जगह पर, {x} ठीक करने हैं। {m} ज़रूरी steps छूटे। सुरक्षित क्रम से मिलाएँ, फिर दोबारा करें।"),
    timeUp: T("Time is up.", "समय ख़त्म।"),
    cmpAria: T("Your order next to the safe order", "आपका क्रम, सुरक्षित क्रम के साथ"),
    safeH: T("Safe order", "सुरक्षित क्रम"), sameNote: T("Same number: any order between them.", "एक जैसा number: उनके बीच कोई भी क्रम।"),
    g_any: T("Any time", "कभी भी"), g_opt: T("Optional", "वैकल्पिक"), g_never: T("Never", "कभी नहीं"),
    whyH: T("Why, step by step", "क्यों, step दर step"),
    sbarH: T("What to say to your senior (SBAR)", "Senior से क्या कहें (SBAR)"),
    nextDrill: T("Next drill", "अगली drill"), done: T("Done", "पूरा"),
    neverRow: T("Never change settings alone on day one", "पहले दिन कभी अकेले settings न बदलें"),
    mayH: T("You may", "आप कर सकते हैं"), mayNotH: T("Not alone, call first", "अकेले नहीं, पहले call करें"), callH: T("Call your senior now if", "Senior को अभी call करें अगर"),
    toDrills: T("Practise the 3 am drill", "रात 3 बजे की drill का अभ्यास करें"), toSilence: T("Practise: it keeps alarming", "अभ्यास: alarm बार बार बज रहा है"),
    drillsDone: T("{n} of {m} drills safe", "{m} में से {n} drill सुरक्षित"),
    timerH: T("Timer", "Timer"), untimed: T("No timer", "बिना timer"), timed: T("60 s timer", "60 s timer"),
    timeLeft: T("{s} s left", "{s} s बाक़ी"), timedNote: T("Timed: one wrong step hides in the list. Check is automatic at 0.", "Timer के साथ: list में एक गलत step छिपा है। 0 पर जाँच अपने आप होगी।"),
    alarm: T("Alarm", "Alarm"), modeL: T("Mode", "Mode"), bedS: T("First five minutes", "पहले पाँच मिनट"),
    screenT: T("Real ventilator screen", "असली ventilator screen"), screenS: T("SET, MEASURED, alarms and limits", "SET, MEASURED, alarms और limits"),
    neverT: T("Never alone on day one", "पहले दिन अकेले नहीं"), modesT: T("Mode names", "Mode के नाम"),
    careT: T("Daily care checks", "रोज़ की care जाँच"), handT: T("Handover", "Handover"), handS: T("To the next doctor", "अगले doctor को"),
    got: T("Got it: mark as done", "समझ गया: पूरा करें"), gotDone: T("Marked done", "पूरा किया"),
    nextUp: T("Next: {x}", "अगला: {x}"), toLab: T("Back to the lab", "Lab पर वापस"),
    // alarm map
    styleShow: T("Show the words on", "शब्द दिखाएँ"),
    // read this screen
    rdOf: T("Panel {i} of {n}", "{n} में से panel {i}"), rdTap: T("Now tap the number you read next.", "अब वह number tap करें जो आप आगे पढ़ेंगे।"),
    rdNext: T("Next panel", "अगला panel"), rdScore: T("{n} of {m} right", "{m} में से {n} सही"), rdFirst: T("What you do first", "पहले क्या करें"), rdRead: T("What you read next", "आगे क्या पढ़ें"),
    rdTapped: T("You tapped {x}. The number to read: {y}", "आपने {x} tap किया। पढ़ने वाला number: {y}"),
    // skills
    skillTick: T("I can do this and explain it", "मैं यह कर सकता हूँ और समझा सकता हूँ"), skillsN: T("{n} of {m} skills ticked", "{m} में से {n} skills पर tick"),
    whenH: T("When", "कब"), stepsH: T("Steps", "Steps"),
    // modes
    setH: T("You set", "आप set करते हैं"), notSetH: T("Not set on this mode", "इस mode में set नहीं"), watchModeH: T("Watch", "ध्यान दें"),
    // handover note
    copy: T("Copy the blank template", "ख़ाली ढाँचा copy करें"), copied: T("Copied. Paste it into the patient's notes.", "Copy हो गया। मरीज़ के notes में paste करें।"),
    copyFail: T("Copy did not work here. Select the template above and copy it.", "यहाँ copy नहीं हुआ। ऊपर का ढाँचा select करके copy करें।"),
    // pocket card
    print: T("Print or save as PDF", "Print करें या PDF save करें"), clearCard: T("Clear the names and numbers", "नाम और numbers हटाएँ"),
    savedHere: T("Saved on this phone", "इस phone पर saved"), cardFoot: T("Narkē Ventilator Lab pocket card. Draft, for clinical review. Your unit's policy and your senior come first.", "Narkē Ventilator Lab pocket card। ड्राफ़्ट, clinical review बाकी। आपके unit की policy और senior सबसे पहले।"),
    anyCall: T("Any time: call your senior", "कभी भी: senior को call करें"),
    // first-night check
    passH: T("Passed", "Pass"), failH: T("Not yet: pass is {p} of {m}", "अभी नहीं: pass {m} में से {p} है"), passedOn: T("Passed on {d}", "{d} को pass किया"),
    checkStart: T("Start the check", "जाँच शुरू करें"), checkAgain: T("Take it again", "फिर से दें"),
    // glossary
    glossFind: T("Find a word", "शब्द खोजें"), glossNone: T("No match. Try another word or a brand name.", "कोई मेल नहीं। दूसरा शब्द या brand नाम आज़माएँ।"),
    glossN: T("{n} words", "{n} शब्द"), alsoH: T("Also called", "दूसरे नाम")
  };
  // The learning path, in order (B1, round 5). label = an STR key.
  var ITEMS = [
    { id: "never", label: "never", icon: "shield" }, { id: "bed", label: "bed", icon: "steth" }, { id: "screen", label: "screen", icon: "device" },
    { id: "modes", label: "modes", icon: "list" }, { id: "alarms", label: "alarms", icon: "bell" }, { id: "drills", label: "drills", icon: "siren" },
    { id: "read", label: "read", icon: "pulse" }, { id: "skills", label: "skills", icon: "sliders" }, { id: "care", label: "care", icon: "rounds" },
    { id: "hand", label: "hand", icon: "note" }, { id: "card", label: "card", icon: "print" }, { id: "check", label: "check", icon: "award" }
  ];
  // What the "Ready to start under supervision" badge needs (round 6, B1), in path order.
  var READY_IDS = ["screen", "modes", "alarms", "drills", "read", "skills", "check"];
  var PK = "smd_narke_vbridge", CK_KEY = "smd_narke_vcard";
  // Progress from saved prefs: p.done[id] is set by each page when its own done rule is met.
  function progressOf(p, opener) {
    p = p && typeof p === "object" ? p : {};
    var dn = p.done && typeof p.done === "object" ? p.done : {};
    var items = ITEMS.map(function (x) {
      var o = opener && opener[x.id];
      return { id: x.id, done: !!dn[x.id], label: { en: STR[x.label].en, hi: STR[x.label].hi }, open: o || x.id };
    });
    var n = items.filter(function (x) { return x.done; }).length, passed = !!(p.checkPass && dn.check);
    var missing = READY_IDS.filter(function (id) { return id === "check" ? !passed : !dn[id]; });
    return { items: items, doneCount: n, total: items.length, firstNightPassed: passed, ready: !missing.length, missing: missing };
  }
  var OPENER = null;
  function readPrefs() { try { var o = JSON.parse(G.localStorage.getItem(PK)); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function progress() { try { return progressOf(readPrefs(), OPENER); } catch (e) { return progressOf({}, null); } }

  var PURE = { STR: STR, ITEMS: ITEMS, READY_IDS: READY_IDS, verdict: verdict, order: order, safeOrder: safeOrder, drillCount: drillCount, progressOf: progressOf, cardOrders: cardOrders, noteText: noteText, perm: perm };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }
  G.NARKE_VENT_BRIDGE = PURE;
  PURE.progress = progress;

  /* ================= browser ================= */
  var host = G.NARKE;
  if (!host || !host._internal || !host._ventLab || !G.document) return;
  var I = host._internal, st = host._st, esc = I.esc, A = I.ACTIONS;
  var B = { data: null, ready: null, err: null, p: null };

  function L() { return I.lang(); }
  function t(o) { return o == null ? "" : typeof o === "string" ? o : (o[L()] || o.en || ""); }
  function tx(o) { return o == null ? "" : typeof o === "string" ? esc(o) : I.tx(o); }
  function s(key, v) { return esc(t(STR[key])).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? esc(v[x]) : m; }); }
  function ico(n) { return I.ico(n) || ""; }
  function reduced() { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function base() { return G.SMD_NARKE_VENT_BASE || I.BASE + "vent/"; }
  function load() {
    if (B.data) return Promise.resolve(B.data);
    if (B.ready) return B.ready;
    B.err = null;
    B.ready = G.fetch(base() + "bridge.json").then(function (r) { if (!r.ok) throw new Error("bridge " + r.status); return r.json(); })
      .then(function (d) { B.data = d; sync(); return d; }, function (e) { B.ready = null; B.err = e; throw e; });
    return B.ready;
  }
  function prefs() {
    if (B.p) return B.p;
    var o = null;
    try { o = JSON.parse(I.ls().getItem(PK)); } catch (e) {}
    B.p = o && typeof o === "object" ? o : {};
    ["bed", "care", "tiles", "drills", "done", "skills"].forEach(function (k) { if (!B.p[k] || typeof B.p[k] !== "object") B.p[k] = {}; });
    return B.p;
  }
  function save() { try { I.ls().setItem(PK, JSON.stringify(B.p)); } catch (e) {} }
  function isDone(id) { return !!prefs().done[id]; }
  function setDone(id, on) { var d = prefs().done; if (on) d[id] = 1; else delete d[id]; save(); }
  function D() { return B.data || {}; }
  function q(sel) { var r = I.root(); return r ? r.querySelector(sel) : null; }
  function focus(sel) { var el = q(sel); try { if (el) el.focus({ preventScroll: false }); } catch (e) {} }
  function ckItems(key) { var o = []; ((D()[key] || {}).groups || []).forEach(function (g) { (g.items || []).forEach(function (x) { o.push(x); }); }); return o; }
  function nCk(key) { var b = prefs()[key]; return ckItems(key).filter(function (x) { return b[x.id]; }).length; }
  function drillList() { return ((D().drills || {}).items) || []; }
  function skillList() { return ((D().skills || {}).items) || []; }
  // Done rules that follow from saved ticks (also brings round-4 progress forward once the content is loaded).
  function sync() {
    var p = prefs();
    if (ckItems("bed").length && nCk("bed") === ckItems("bed").length) p.done.bed = 1;
    if (ckItems("care").length && nCk("care") === ckItems("care").length) p.done.care = 1;
    var dl = drillList(); if (dl.length && dl.every(function (x) { return p.drills[x.id]; })) p.done.drills = 1;
    var sk = skillList(); if (sk.length && sk.every(function (x) { return p.skills[x.id]; })) p.done.skills = 1;
    save();
  }
  function itemById(id) { return ITEMS.filter(function (x) { return x.id === id; })[0]; }
  // The next page on the path after `id` that is not done yet (the check last); null when all are done.
  function nextAfter(id) {
    var i = ITEMS.indexOf(itemById(id)), k, x;
    for (k = 1; k <= ITEMS.length; k++) { x = ITEMS[(i + k) % ITEMS.length]; if (!isDone(x.id) && x.id !== id) return x; }
    return null;
  }
  // The end of a page: "Got it" marks it done (pages with no quiz or ticks), then a next step.
  function gotBlock(id) {
    var nx = nextAfter(id), d = isDone(id);
    return '<div class="vb-got" id="vbGot">' + (d ? '<p class="vb-gotd" role="status"><span aria-hidden="true">' + ico("check") + "</span>" + s("gotDone") + "</p>"
      : '<button type="button" class="sp-btn pri vb-gotb" data-act="vbgot" data-k="' + id + '">' + ico("check") + " " + s("got") + "</button>") +
      (d && nx ? '<button type="button" class="sp-btn sec vb-next" data-act="vbopen" data-k="' + nx.id + '">' + s("nextUp", { x: t(STR[nx.label]) }) + "</button>" : "") + "</div>";
  }
  A.vbgot = function (b) {
    var id = b.getAttribute("data-k"); setDone(id, true); I.haptic("success");
    var nx = nextAfter(id);
    toLab(nx ? nx.id : id);
  };
  // After a quiz or a drill set: the next step on the path, or back to the lab.
  function nextBtn(id) {
    var nx = nextAfter(id);
    return nx ? '<button type="button" class="sp-btn pri vb-next" data-act="vbopen" data-k="' + nx.id + '">' + s("nextUp", { x: t(STR[nx.label]) }) + "</button>"
      : '<button type="button" class="sp-btn pri vb-next" data-act="vbhome">' + s("toLab") + "</button>";
  }
  A.vbhome = function () { toLab(); };

  /* ---------- lab home rows ---------- */
  var LINE = {
    bed: function () { var m = ckItems("bed").length, n = nCk("bed"); return m && n ? s("nOfM", { n: I.fmt(n), m: I.fmt(m) }) : ""; },
    screen: function () { var tl = (D().screen || {}).tiles || [], n = tl.filter(function (x) { return prefs().tiles[x.id]; }).length; return tl.length && n ? s("opened", { n: I.fmt(n), m: I.fmt(tl.length) }) : ""; },
    drills: function () { var dl = drillList(), n = dl.filter(function (x) { return prefs().drills[x.id]; }).length; return dl.length && n ? s("drillsDone", { n: I.fmt(n), m: I.fmt(dl.length) }) : ""; },
    skills: function () { var sk = skillList(), n = sk.filter(function (x) { return prefs().skills[x.id]; }).length; return sk.length && n ? s("skillsN", { n: I.fmt(n), m: I.fmt(sk.length) }) : ""; },
    care: function () { var m = ckItems("care").length, n = nCk("care"); return m && n ? s("nOfM", { n: I.fmt(n), m: I.fmt(m) }) : ""; }
  };
  function homeBlock() {
    if (!B.data && !B.ready && !B.err) load().then(null, function () {});
    var pr = progress();
    var rows = ITEMS.map(function (x) {
      var dn = isDone(x.id), ln = x.id === "check" && pr.firstNightPassed ? '<span class="vb-badge-s">' + ico("award") + s("passH") + "</span>"
        : dn ? '<span class="vl-solved">' + ico("check") + s("done") + "</span>" : LINE[x.id] ? LINE[x.id]() : "";
      return I.row("vbopen", ' data-k="' + x.id + '"', I.tile(x.icon), s(x.label), s(x.label + "Sub"), ln);
    }).join("") + I.row("vbopen", ' data-k="gloss"', I.tile("book"), s("gloss"), s("glossSub"), "");
    var bar = '<div class="vb-hprog"><p class="sp-small" id="vbHomeProg">' + s("homeProg", { n: I.fmt(pr.doneCount), m: I.fmt(pr.total) }) + "</p>" +
      '<span class="vb-bar" aria-hidden="true"><i style="transform:scaleX(' + (pr.doneCount / pr.total).toFixed(3) + ')"></i></span></div>';
    var badge = pr.firstNightPassed && B.data ? '<p class="vb-badge" role="note"><span aria-hidden="true">' + ico("award") + "</span><span><b>" + tx((D().check || {}).badge) + "</b> " + tx((D().check || {}).badgeNote) + "</span></p>" : "";
    return '<h2 class="sp-h2" id="vbHomeH">' + s("homeH") + '</h2><p class="vl-lvintro vb-homenote">' + s("homeNote") + "</p>" + bar + badge +
      '<ul class="sp-rows vb-rows" aria-labelledby="vbHomeH">' + rows + "</ul>" +
      (B.data ? '<p class="vb-review" role="note">' + tx(D().reviewNote) + "</p>" : "");
  }
  PURE.homeBlock = homeBlock;

  function toLab(k) {
    host._ventLab.open();
    if (k) focus('[data-act=vbopen][data-k="' + k + '"]');
  }
  // Each screen: leave the old one, set view, back and repaint; wait for the content first.
  // back: the row key on the lab home that focus returns to, or a function for an inner back.
  function screen(view, again, back, title, sub, body, focusSel, backLabel) {
    I.leave();
    st.view = view; st.again = again;
    st.onBack = function () { if (typeof back === "function") back(); else toLab(back); return true; };
    I.paint(I.top(t(backLabel || STR.backLab), title, sub, I.langBtn()) + '<div class="sp-scroll sp-pad"><div class="sp-col vb-wrap">' + body + "</div></div>", typeof focusSel === "string" ? focusSel : null);
  }
  function withData(view, again, title, sub, render) {
    if (B.data) return render();
    screen(view, again, view.slice(3), title, sub, B.err ? '<div class="sp-err" role="alert"><p>' + s("loadErr") + '</p><button type="button" class="sp-btn pri" data-act="vbretry">' + ico("refresh") + " " + s("retry") + "</button></div>"
      : '<div class="sp-loading" aria-busy="true"><span class="sp-sk sp-sk-a"></span><span class="sp-sk sp-sk-b"></span><span class="sp-sk sp-sk-c"></span><span class="sp-sr" role="status">' + s("loading") + "</span></div>", B.err ? "[data-act=vbretry]" : null);
    if (!B.err) load().then(function () { if (st.view === view) again(); }, function () { if (st.view === view) again(); });
  }
  A.vbretry = function () { B.err = null; if (st.again) st.again(); };
  var OPEN = {};
  A.vbopen = function (b) { var k = b.getAttribute("data-k"); if (OPEN[k]) OPEN[k](); };
  OPENER = {};
  ITEMS.forEach(function (x) { OPENER[x.id] = function () { if (OPEN[x.id]) OPEN[x.id](); }; });

  /* ---------- a quiz engine: set-or-measured, mode quiz, first-night check ----------
     Every answer shows right or "Not right", why, and (check) a line to say back. The end lists what to go over. */
  var QZ = {};
  function quizDef(id, list, box, opts) { QZ[id] = { id: id, list: list, box: box, o: opts || {}, qi: 0, ans: null, right: 0, fin: false, miss: [], tries: 0 }; return QZ[id]; }
  function qReset(z) { z.qi = 0; z.ans = null; z.right = 0; z.fin = false; z.miss = []; z.tries++; }
  function quizHtml(z) {
    var qs = z.list(), n = qs.length;
    if (!n) return "";
    if (z.fin) {
      var all = z.right === n, extra = z.o.end ? z.o.end(z, n) : "";
      var rev = z.miss.length ? '<h3 class="vl-h3 vb-revh">' + s("reviewH") + '</h3><ol class="vb-rev">' + z.miss.map(function (i) {
        var Q = qs[i];
        return '<li><p class="vb-revq">' + tx(Q.q) + '</p><p class="vb-reva"><span aria-hidden="true">' + ico("check") + "</span>" + s("rightAns", { x: t(Q.options[Q.answer]) }) + "</p>" + (Q.key ? '<p class="vb-why">' + tx(Q.key) + "</p>" : '<p class="vb-why">' + tx(Q.why) + "</p>") + "</li>";
      }).join("") + "</ol>" : "";
      return '<div class="vb-qend">' + (z.o.endHead ? z.o.endHead(z, n) : '<p class="sp-verdict ' + (all ? "ok" : "bad") + ' vb-qscore" tabindex="-1">' + (ico(all ? "check" : "info") || "") + "<span>" + s("score", { n: I.fmt(z.right), m: I.fmt(n) }) + "</span></p>") +
        (z.o.bestKey ? '<p class="sp-small">' + s("best", { n: I.fmt(prefs()[z.o.bestKey] || 0), m: I.fmt(n) }) + "</p>" : "") + rev + extra +
        '<div class="vb-qbtns"><button type="button" class="sp-btn sec" data-act="vbqagain" data-z="' + z.id + '">' + s(z.o.againKey || "again") + "</button>" + (z.o.next ? nextBtn(z.o.next) : "") + "</div></div>";
    }
    var Q = qs[z.qi], ans = z.ans, pm = perm((Q.options || []).length, z.id + z.qi + ":" + z.tries);
    var opts = '<div class="sp-answers' + (ans != null ? " done" : "") + '" role="group" aria-labelledby="vbQ' + z.id + '">' + pm.map(function (j, pos) {
      var o = Q.options[j], state = ans == null ? "" : j === Q.answer ? "right" : j === ans ? "wrong" : "dim";
      return '<button type="button" class="sp-ans" data-act="vbqans" data-z="' + z.id + '" data-o="' + j + '"' + (state ? ' data-state="' + state + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + (state === "right" ? ico("check") || "A" : state === "wrong" ? ico("close") || "x" : "ABCD".charAt(pos)) + "</span>" + tx(o) + "</button>";
    }).join("") + "</div>";
    var ok = ans === Q.answer;
    var rev2 = ans == null ? "" : '<p class="sp-verdict vb-qv ' + (ok ? "ok" : "bad") + '" tabindex="-1">' + (ico(ok ? "check" : "close") || "") + "<span>" + s(ok ? "right" : "wrong") + "</span></p>" +
      (ok ? "" : '<p class="vb-reva"><span aria-hidden="true">' + ico("check") + "</span>" + s("rightAns", { x: t(Q.options[Q.answer]) }) + "</p>") +
      '<p class="vb-why">' + tx(Q.why) + "</p>" + (Q.key ? '<p class="vb-say"><span class="vb-sayk">' + s("sayBack") + "</span>" + tx(Q.key) + "</p>" : "") +
      '<button type="button" class="sp-btn pri vb-qnext" data-act="vbqnext" data-z="' + z.id + '">' + s(z.qi < n - 1 ? "nextQ" : "done") + "</button>";
    return '<p class="sp-small vb-qof">' + s("qOf", { i: I.fmt(z.qi + 1), n: I.fmt(n) }) + '</p><h3 class="sp-h3 vl-q" id="vbQ' + z.id + '">' + tx(Q.q) + "</h3>" + opts + rev2;
  }
  function repaintQuiz(z, focusSel) { var el = q("#" + z.box); if (!el) return; el.innerHTML = quizHtml(z); if (focusSel) focus("#" + z.box + " " + focusSel); }
  function zOf(b) { return QZ[b.getAttribute("data-z") || "sm"]; }
  A.vbqans = function (b) {
    var z = zOf(b); if (!z || z.ans != null) return;
    var Q = z.list()[z.qi], j = +b.getAttribute("data-o"), ok = Q && j === Q.answer;
    z.ans = j; if (ok) z.right++; else z.miss.push(z.qi);
    I.haptic(ok ? "success" : "error");
    repaintQuiz(z, ".vb-qv");
  };
  A.vbqnext = function (b) {
    var z = zOf(b); if (!z) return;
    var n = z.list().length;
    if (z.qi < n - 1) { z.qi++; z.ans = null; repaintQuiz(z, ".sp-ans"); return; }
    z.fin = true;
    if (z.o.bestKey && z.right > (prefs()[z.o.bestKey] || 0)) { prefs()[z.o.bestKey] = z.right; save(); }
    if (z.o.onFinish) z.o.onFinish(z, n);
    repaintQuiz(z, ".vb-qscore");
  };
  A.vbqagain = function (b) { var z = zOf(b); if (!z) return; qReset(z); repaintQuiz(z, ".sp-ans"); };

  /* ---------- checklists: walk up to the bed, daily care ---------- */
  var CK = "bed";
  function ckProg() {
    var n = nCk(CK), m = ckItems(CK).length;
    return '<div class="vb-prog"><p class="vb-prog-t" id="vbProgT" aria-live="polite">' + (n === m && m ? s("allDone") : s("nOfM", { n: I.fmt(n), m: I.fmt(m) })) + "</p>" +
      '<span class="vb-bar" aria-hidden="true"><i style="transform:scaleX(' + (m ? (n / m).toFixed(3) : 0) + ')"></i></span></div>';
  }
  function checklist(key, title, sub, focusSel) {
    var view = "vb-" + key, again = function (f) { checklist(key, title, sub, f); };
    withData(view, again, title, sub, function () {
      CK = key;
      var d = D()[key] || {}, p = prefs()[key];
      var groups = (d.groups || []).map(function (g, gi) {
        return '<h2 class="sp-h2 vb-gh" id="vbG' + gi + '">' + tx(g.title) + '</h2><ul class="vb-chks" aria-labelledby="vbG' + gi + '">' + (g.items || []).map(function (x) {
          var on = !!p[x.id];
          return '<li><button type="button" class="vb-chk" data-act="vbchk" data-k="' + esc(x.id) + '" aria-pressed="' + on + '">' +
            '<span class="vb-box" aria-hidden="true">' + ico("check") + '</span><span class="vb-chk-b"><b>' + tx(x.label) + "</b><span>" + tx(x.why) + "</span></span></button></li>";
        }).join("") + "</ul>";
      }).join("");
      var all = nCk(key) === ckItems(key).length;
      screen(view, again, key, title, sub,
        '<p class="vl-lede vb-lede">' + tx(d.intro) + "</p>" + ckProg() + groups +
        '<div class="vl-card vb-done' + (all ? " on" : "") + '" id="vbBedDone" role="status"' + (all ? "" : " hidden") + "><p>" + (ico("check") ? '<span aria-hidden="true">' + ico("check") + "</span>" : "") + "<span>" + tx(d.done) + "</span></p></div>" +
        '<button type="button" class="sp-btn sec vb-clear" data-act="vbclear">' + s("clear") + "</button>" + (key === "care" ? gotBlock("care") : '<div id="vbGot">' + (all ? nextBtn("bed") : "") + "</div>"), focusSel);
    });
  }
  OPEN.bed = function () { checklist("bed", s("bed"), s("bedS")); };
  OPEN.care = function () { checklist("care", s("careT"), s("careSub")); };
  A.vbchk = function (b) {
    var k = b.getAttribute("data-k"), p = prefs()[CK], on = !p[k];
    if (on) p[k] = 1; else delete p[k];
    var n = nCk(CK), m = ckItems(CK).length;
    if (CK === "bed") { if (n === m) prefs().done.bed = 1; else delete prefs().done.bed; }
    if (CK === "care" && n === m) prefs().done.care = 1;
    save();
    b.setAttribute("aria-pressed", String(on));
    var pr = q(".vb-prog");
    if (pr) { pr.querySelector("#vbProgT").textContent = n === m ? t(STR.allDone) : t(STR.nOfM).replace("{n}", I.fmt(n)).replace("{m}", I.fmt(m)); pr.querySelector(".vb-bar i").style.transform = "scaleX(" + (n / m).toFixed(3) + ")"; }
    var dn = q("#vbBedDone");
    if (dn) { if (n === m) { dn.hidden = false; G.requestAnimationFrame(function () { dn.classList.add("on"); }); if (on) I.haptic("success"); } else { dn.classList.remove("on"); dn.hidden = true; } }
    var gb = q("#vbGot");
    if (gb && CK === "bed") gb.innerHTML = n === m ? nextBtn("bed") : "";
    if (gb && CK === "care" && n === m && on) gb.outerHTML = gotBlock("care");
  };
  A.vbclear = function () { prefs()[CK] = {}; if (CK === "bed") delete prefs().done.bed; save(); if (CK === "care") checklist("care", s("careT"), s("careSub"), ".vb-chk"); else checklist("bed", s("bed"), s("bedS"), ".vb-chk"); };

  /* ---------- reading a real ventilator screen ---------- */
  var SC = { style: "drager", page: "main", sel: null };
  var MEAS_ORDER = ["ppeak", "pplat", "peepm", "vte", "vti", "mve", "ftot"], SET_ORDER = ["vtset", "fset", "peepset", "fio2", "ie"], KEY_ORDER = ["silence", "limits", "hold", "freeze", "o2"];
  var KIND = { set: "set", measured: "meas", alarm: "alm", key: "key", limit: "lim" };
  var KTAG = { set: "set", meas: "meas", alm: "kAlarm", key: "kKey", lim: "kLim" }, KLAB = { set: "setL", meas: "measL", alm: "alarmL", key: "keyL", lim: "limL" };
  function kindOf(x) { return KIND[x.kind] || "meas"; }
  function lab(x, style) { return x.id === "mode" ? t(STR.modeL) : x.id === "abar" ? t(STR.alarm) : (x.labels && (x.labels[style] || x.labels.generic)) || ""; }
  function val(x, style, ov) {
    if (ov && ov[x.id] != null) return typeof ov[x.id] === "object" ? ov[x.id][style] : ov[x.id];
    return x.id === "mode" || x.id === "abar" ? (x.labels && x.labels[style]) || x.value : x.value;
  }
  // Set and measured numbers with the same label on this style (PEEP, and VT on a Dräger-style panel) carry
  // a small "set" / "measured" mark so they never read as the same number.
  function dupes(tl, style) {
    var o = {};
    SET_ORDER.forEach(function (a) { MEAS_ORDER.forEach(function (b) { if (tl[a] && tl[b] && lab(tl[a], style) === lab(tl[b], style)) { o[a] = "qSet"; o[b] = "qMeas"; } }); });
    return o;
  }
  // One tile. o: {style, act, sel, mark: "right"|"wrong", lock, q, ov}
  function tile(x, o) {
    if (!x) return "";
    var k = kindOf(x), lb = lab(x, o.style), v = val(x, o.style, o.ov), learned = prefs().tiles[x.id];
    var name = lb + (x.labels && x.id !== "mode" && x.id !== "abar" && x.labels.generic !== lb ? " (" + x.labels.generic + ")" : "") + (o.q ? " " + t(STR[o.q]) : "");
    var cleared = x.id === "abar" && x.state && !(o.ov && o.ov.abar);
    var aria = t(STR.tileAria).replace("{x}", name).replace("{v}", v ? v + (x.unit ? " " + x.unit : "") + (cleared ? ", " + t(x.state) : "") : "").replace("{k}", t(STR[KLAB[k]]));
    var state = o.mark ? ' data-state="' + o.mark + '"' : "";
    return '<button type="button" class="vb-t vb-' + k + (learned && o.act === "vbtile" ? " seen" : "") + (cleared ? " vb-cleared" : "") + '" data-act="' + o.act + '" data-k="' + esc(x.id) + '"' +
      (o.act === "vbtile" ? ' aria-pressed="' + (o.sel === x.id) + '"' : "") + state + (o.lock ? ' aria-disabled="true"' : "") + ' aria-label="' + esc(aria) + '">' +
      (x.id === "abar" ? '<span class="vb-ai" aria-hidden="true">' + ico("siren") + "</span>" : "") +
      '<span class="vb-tl" translate="no">' + esc(lb) + (o.q ? '<span class="vb-tq">' + s(o.q) + "</span>" : "") + "</span>" +
      (v ? '<span class="vb-tv">' + esc(v) + (x.unit ? "<i>" + esc(x.unit) + "</i>" : "") + (cleared ? '<span class="vb-tst">' + tx(x.state) + "</span>" : "") + "</span>" : "") + "</button>";
  }
  function tiles() { var o = {}; ((D().screen || {}).tiles || []).forEach(function (x) { o[x.id] = x; }); return o; }
  function waveSvg() {
    // Decorative square-flow volume breaths: pressure (rise, peak, plateau) and flow (square in, decaying out).
    var p = "M0 46", f = "M0 30", x, i;
    for (i = 0; i < 3; i++) {
      x = i * 80;
      p += "L" + (x + 4) + " 46L" + (x + 8) + " 22L" + (x + 22) + " 10L" + (x + 25) + " 18L" + (x + 30) + " 18L" + (x + 33) + " 46L" + (x + 80) + " 46";
      f += "L" + (x + 4) + " 30L" + (x + 5) + " 14L" + (x + 25) + " 14L" + (x + 26) + " 30L" + (x + 33) + " 30L" + (x + 34) + " 52Q" + (x + 44) + " 33 " + (x + 66) + " 30L" + (x + 80) + " 30";
    }
    return '<svg class="vb-wv" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="vb-wp" d="' + p + '"/></svg>' +
      '<svg class="vb-wv" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line class="vb-wz" x1="0" x2="240" y1="30" y2="30"/><path class="vb-wf" d="' + f + '"/></svg>';
  }
  function styleName(id) { var x = ((D().screen || {}).styles || []).filter(function (y) { return y.id === id; })[0]; return x ? t(x.name) : ""; }
  // The panel. o: {style, page, act, sel, marks: {id: state}, lock, ov: {tile id: value}}
  function panel(o) {
    var tl = tiles(), dup = dupes(tl, o.style), mk = o.marks || {};
    function T1(id) { return tile(tl[id], { style: o.style, act: o.act, sel: o.sel, mark: mk[id], lock: o.lock, q: dup[id], ov: o.ov }); }
    var mid;
    if (o.page === "limits") {
      mid = '<div class="vb-lim" role="table" aria-label="' + s("pLim") + '"><div class="vb-lh" role="row"><span role="columnheader">' + s("limAlarm") + '</span><span role="columnheader">' + s("limNow") + '</span><span role="columnheader">' + s("limLow") + '</span><span role="columnheader">' + s("limHigh") + "</span></div>" +
        ((D().screen || {}).limitRows || []).map(function (r) {
          var nw = r.now && tl[r.now], nm = r.label ? t(r.label) : nw ? lab(nw, o.style) : r.id;
          return '<div class="vb-lr" role="row"><span class="vb-ln" role="rowheader" translate="no">' + esc(nm) + '</span><span class="vb-lnow" role="cell">' + (nw ? esc(nw.value) : "") + '</span><span role="cell">' + (r.low ? T1(r.low) : "") + '</span><span role="cell">' + (r.high ? T1(r.high) : "") + "</span></div>";
        }).join("") + '<p class="vb-lnote">' + s("limNote") + "</p></div>";
    } else {
      mid = '<div class="vb-waves" aria-hidden="true">' + waveSvg() + "</div>" +
        '<div class="vb-mcol"><span class="vb-rtag"><span class="vb-kind vb-meas">' + s("meas") + "</span></span>" + MEAS_ORDER.map(T1).join("") + "</div>";
    }
    return '<figure class="vl-plate vb-panel vb-L-' + esc(o.style) + " vb-P-" + esc(o.page) + (o.ov && o.ov.abar ? " vb-live" : "") + '" role="group" aria-label="' + esc(t(STR.panelAria).replace("{x}", styleName(o.style))) + '">' +
      '<div class="vb-top">' + T1("mode") + T1("abar") + "</div>" + mid +
      '<div class="vb-setrow"><span class="vb-rtag"><span class="vb-kind vb-set">' + s("set") + "</span> " + s("rowSet") + "</span>" + SET_ORDER.map(T1).join("") + "</div>" +
      '<div class="vb-keys"><span class="vb-rtag"><span class="vb-kind vb-key">' + s("kKey") + "</span> " + s("rowKeys") + "</span>" + KEY_ORDER.map(T1).join("") + "</div></figure>";
  }
  function infoHtml() {
    var x = SC.sel && tiles()[SC.sel];
    if (!x) return '<p class="vb-hint">' + s("tapHint") + "</p>";
    var k = kindOf(x), lb = lab(x, SC.style), v = val(x, SC.style);
    return '<div class="vb-info-h"><b>' + tx(x.name) + '</b><span class="vb-kind vb-' + k + '">' + s(KTAG[k]) + "</span></div>" +
      '<p class="vb-info-l"><span translate="no">' + esc(lb) + "</span>" + (v && v !== lb ? " " + esc(v) + (x.unit ? " " + esc(x.unit) : "") : "") + " · " + s(KLAB[k]) + "</p>" +
      '<h3 class="vl-h3">' + s("whatH") + "</h3><p>" + tx(x.what) + '</p><h3 class="vl-h3">' + s("watchH") + "</h3><p>" + tx(x.watch) + "</p>";
  }
  function openedLine() { var tl = (D().screen || {}).tiles || [], p = prefs().tiles; return s("opened", { n: I.fmt(tl.filter(function (x) { return p[x.id]; }).length), m: I.fmt(tl.length) }); }
  // The screen page is done once both its quizzes have been finished (any score).
  function screenDone() { var p = prefs(); if (p.smFin && p.findFin) { p.done.screen = 1; save(); } }
  var ZSM = quizDef("sm", function () { return (D().screen || {}).quiz || []; }, "vbQuiz", { bestKey: "quizBest", onFinish: function () { prefs().smFin = 1; screenDone(); } });
  function labelsHtml() {
    var sc = D().screen || {}, st0 = sc.styles || [];
    return '<details class="vl-card vb-labels"><summary>' + s("labelsH") + "</summary>" +
      '<ul class="vb-lrows">' + (sc.labelRows || []).map(function (r) {
        return "<li><b>" + tx(r.term) + "</b>" + (r.plain ? '<p class="vb-lplain">' + tx(r.plain) + "</p>" : "") + "<dl>" + st0.map(function (x) { return "<div><dt>" + tx(x.name) + "</dt><dd translate=\"no\">" + esc(r[x.id] || "") + "</dd></div>"; }).join("") + "</dl></li>";
      }).join("") + "</ul></details>";
  }
  function segs(act, attr, list, cur, label) {
    return '<div class="sp-seg vb-styles" role="group" aria-label="' + label + '">' + list.map(function (x) {
      return '<button type="button" data-act="' + act + '" ' + attr + '="' + esc(x.id) + '" aria-pressed="' + (x.id === cur) + '">' + x.name + "</button>";
    }).join("") + "</div>";
  }
  function styleSeg(act, cur) { return segs(act, "data-v", ((D().screen || {}).styles || []).map(function (x) { return { id: x.id, name: tx(x.name) }; }), cur, s("styleH")); }
  function pageSeg() { return segs("vbpage", "data-v", [{ id: "main", name: s("pMain") }, { id: "limits", name: s("pLim") }], SC.page, s("pageH")); }
  function scr(focusSel) {
    withData("vb-screen", scr, s("screenT"), s("screenS"), function () {
      var sc = D().screen || {};
      screen("vb-screen", scr, "screen", s("screenT"), s("screenS"),
        '<p class="vl-lede vb-lede">' + tx(sc.intro) + "</p>" + styleSeg("vbstyle", SC.style) +
        '<div id="vbPageSeg">' + pageSeg() + "</div>" +
        '<p class="vb-legend"><span><span class="vb-kind vb-set">' + s("set") + "</span> " + s("legendSet") + '</span><span><span class="vb-kind vb-meas">' + s("meas") + "</span> " + s("legendMeas") + "</span></p>" +
        '<div id="vbPanel">' + panel({ style: SC.style, page: SC.page, act: "vbtile", sel: SC.sel }) + "</div>" +
        '<div class="vl-card vb-info" id="vbInfo" aria-live="polite">' + infoHtml() + "</div>" +
        '<p class="sp-small vb-opened" id="vbOpened">' + openedLine() + "</p>" +
        '<button type="button" class="sp-btn pri vb-tofind" data-act="vbopen" data-k="find">' + s("findGo") + "</button>" +
        labelsHtml() + '<p class="vb-brand">' + tx(D().brandNote) + "</p>" +
        '<h2 class="sp-h2">' + s("quizH") + '</h2><div class="vb-quiz" id="vbQuiz">' + quizHtml(ZSM) + "</div>", focusSel);
    });
  }
  OPEN.screen = function () { SC.sel = null; SC.page = "main"; qReset(ZSM); scr(); };
  function repaintPanel() {
    [].forEach.call(I.root().querySelectorAll("[data-act=vbstyle]"), function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-v") === SC.style)); });
    var pn = q("#vbPanel"), ps = q("#vbPageSeg");
    if (pn) pn.innerHTML = panel({ style: SC.style, page: SC.page, act: "vbtile", sel: SC.sel });
    if (ps) ps.innerHTML = pageSeg();
  }
  A.vbstyle = function (b) {
    var v = b.getAttribute("data-v");
    if (v === SC.style) return;
    SC.style = v; repaintPanel();
    var inf = q("#vbInfo"); if (inf) inf.innerHTML = infoHtml();
  };
  A.vbpage = function (b) {
    var v = b.getAttribute("data-v");
    if (v === SC.page) return;
    SC.page = v; repaintPanel(); focus('[data-act=vbpage][data-v="' + v + '"]');
  };
  A.vbtile = function (b) {
    var k = b.getAttribute("data-k");
    SC.sel = k; prefs().tiles[k] = 1; save();
    if (k === "limits" && SC.page !== "limits") { SC.page = "limits"; repaintPanel(); focus("[data-act=vbtile][data-k=limits]"); }
    [].forEach.call(I.root().querySelectorAll("[data-act=vbtile]"), function (x) { var on = x.getAttribute("data-k") === k; x.setAttribute("aria-pressed", String(on)); if (on) x.classList.add("seen"); });
    var inf = q("#vbInfo"), op = q("#vbOpened");
    if (inf) {
      inf.innerHTML = infoHtml();
      if (!reduced()) { inf.classList.remove("vb-in"); void inf.offsetWidth; inf.classList.add("vb-in"); }
      // Keep the explanation in view on a phone without moving the panel the finger is on.
      var sc = q(".sp-scroll");
      if (sc) { var r = inf.getBoundingClientRect(), bb = sc.getBoundingClientRect(); if (r.top > bb.bottom - 80) try { sc.scrollTo({ top: sc.scrollTop + r.top - bb.bottom + Math.min(r.height, bb.height * 0.45), behavior: reduced() ? "auto" : "smooth" }); } catch (e) {} }
    }
    if (op) op.innerHTML = openedLine();
  };

  /* ---------- find it on the screen: a tap-the-number quiz across the three styles ---------- */
  var FQ = { i: 0, ans: null, right: 0, fin: false, log: [] };
  function findItems() { return (((D().screen || {}).find || {}).items) || []; }
  function tileName(id, style) { var x = tiles()[id]; return x ? lab(x, style) + (x.labels && x.labels.generic !== lab(x, style) && x.id !== "abar" && x.id !== "mode" ? " (" + x.labels.generic + ")" : "") : id; }
  function findBody() {
    var it = findItems(), n = it.length, F = it[FQ.i];
    if (FQ.fin || !F) {
      var best = prefs().findBest || 0, miss = FQ.log.filter(function (x) { return !x.ok; });
      return '<div class="vb-qend"><p class="sp-verdict ' + (FQ.right === n ? "ok" : "bad") + ' vb-fscore" tabindex="-1">' + (ico(FQ.right === n ? "check" : "info") || "") + "<span>" + s("score", { n: I.fmt(FQ.right), m: I.fmt(n) }) + "</span></p>" +
        '<p class="sp-small">' + s("best", { n: I.fmt(best), m: I.fmt(n) }) + "</p>" +
        (miss.length ? '<h3 class="vl-h3 vb-revh">' + s("reviewH") + '</h3><ol class="vb-rev">' + miss.map(function (x) {
          var Fi = it[x.i];
          return '<li><p class="vb-revq">' + tx(Fi.q) + ' <span class="vb-revs">' + esc(styleName(Fi.style)) + "</span></p>" +
            '<p class="vb-revx"><span aria-hidden="true">' + ico("close") + "</span>" + s("youTapped", { x: tileName(x.picked, Fi.style) }) + "</p>" +
            '<p class="vb-reva"><span aria-hidden="true">' + ico("check") + "</span>" + s("rightAns", { x: tileName(Fi.target, Fi.style) }) + '</p><p class="vb-why">' + tx(Fi.why) + "</p></li>";
        }).join("") + "</ol>" : '<p class="vb-why">' + s("allRightQ") + "</p>") +
        '<div class="vb-qbtns"><button type="button" class="sp-btn sec" data-act="vbfagain">' + s("again") + "</button>" + nextBtn("screen") + "</div></div>";
    }
    var marks = {}, ok = FQ.ans === F.target;
    if (FQ.ans) { marks[F.target] = "right"; if (!ok) marks[FQ.ans] = "wrong"; }
    var rev = FQ.ans ? '<p class="sp-verdict vb-fv ' + (ok ? "ok" : "bad") + '" tabindex="-1">' + (ico(ok ? "check" : "close") || "") + "<span>" + s(ok ? "right" : "findWrong") + '</span></p><p class="vb-why">' + tx(F.why) + "</p>" +
      '<button type="button" class="sp-btn pri vb-qnext" data-act="vbfnext">' + s(FQ.i < n - 1 ? "nextQ" : "done") + "</button>" : "";
    return '<p class="sp-small vb-qof">' + s("qOf", { i: I.fmt(FQ.i + 1), n: I.fmt(n) }) + '</p><p class="vb-fstyle"><span>' + esc(styleName(F.style)) + "</span><span>" + s(F.page === "limits" ? "pLim" : "pMain") + "</span></p>" +
      '<h2 class="sp-h3 vl-q vb-fq" id="vbFQ">' + tx(F.q) + "</h2>" +
      panel({ style: F.style, page: F.page, act: "vbfind", marks: marks, lock: !!FQ.ans }) + '<div class="vb-fres" aria-live="polite">' + rev + "</div>";
  }
  function find(focusSel) {
    withData("vb-find", find, s("findH"), s("findSub"), function () {
      screen("vb-find", find, function () { scr(".vb-tofind"); }, s("findH"), s("findSub"),
        '<p class="vl-lede vb-lede">' + tx(((D().screen || {}).find || {}).intro) + '</p><div id="vbFind">' + findBody() + "</div>", focusSel, STR.backScreen);
    });
  }
  function findReset() { FQ.i = 0; FQ.ans = null; FQ.right = 0; FQ.fin = false; FQ.log = []; }
  OPEN.find = function () { findReset(); find(); };
  function repaintFind(sel) { var el = q("#vbFind"); if (!el) return; el.innerHTML = findBody(); if (sel) focus("#vbFind " + sel); }
  A.vbfind = function (b) {
    var F = findItems()[FQ.i];
    if (!F || FQ.ans) return;
    FQ.ans = b.getAttribute("data-k");
    var ok = FQ.ans === F.target;
    if (ok) FQ.right++;
    FQ.log.push({ i: FQ.i, ok: ok, picked: FQ.ans });
    prefs().tiles[F.target] = 1; save();
    I.haptic(ok ? "success" : "error");
    repaintFind(".vb-fv");
  };
  A.vbfnext = function () {
    var n = findItems().length;
    if (FQ.i < n - 1) { FQ.i++; FQ.ans = null; repaintFind(".vb-fq"); var f = q("#vbFind .vb-fq"); if (f) { f.setAttribute("tabindex", "-1"); focus("#vbFind .vb-fq"); } return; }
    FQ.fin = true;
    if (FQ.right > (prefs().findBest || 0)) prefs().findBest = FQ.right;
    prefs().findFin = 1; save(); screenDone();
    repaintFind(".vb-fscore");
  };
  A.vbfagain = function () { findReset(); repaintFind(".vb-t"); };

  /* ---------- mode names and what is set ---------- */
  function engMode(m) {
    var e = (G.NARKE_MODELS || {})["vent-engine"], x = e && e.MODES && e.MODES[m];
    return x && x.title ? tx(x.title) : esc(String(m).toUpperCase());
  }
  var ZMD = quizDef("md", function () { return (D().modes || {}).quiz || []; }, "vbQuizM", { bestKey: "modesBest", next: "modes", onFinish: function () { setDone("modes", true); } });
  function chips(arr, cls) { return '<ul class="vb-chips ' + cls + '">' + (arr || []).map(function (x) { return '<li translate="no">' + tx(x) + "</li>"; }).join("") + "</ul>"; }
  function modes(focusSel) {
    withData("vb-modes", modes, s("modesT"), s("modesSub"), function () {
      var d = D().modes || {};
      screen("vb-modes", modes, "modes", s("modesT"), s("modesSub"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + '</p><ul class="vb-modes">' + (d.items || []).map(function (x) {
          var labs = [].concat(x.lab || []);
          return '<li class="vl-card vb-mode"><h2 class="vb-mn" translate="no">' + esc(x.names) + "</h2><p>" + tx(x.plain) + "</p>" +
            (x.set ? '<div class="vb-msets"><div><h3 class="vb-msh">' + s("setH") + "</h3>" + chips(x.set, "set") + '</div><div><h3 class="vb-msh">' + s("notSetH") + "</h3>" + chips(x.notSet, "not") + "</div></div>" +
              '<p class="vb-mwatch"><span class="vb-mwk">' + s("watchModeH") + "</span>" + tx(x.watch) + "</p>" : "") +
            '<div class="vb-ml"><span>' + s("closest") + '</span><ul class="vb-mlabs">' + labs.map(function (m) { return "<li>" + engMode(m) + "</li>"; }).join("") + "</ul></div>" +
            '<p class="vb-never"><span aria-hidden="true">' + ico("lock") + "</span>" + tx(d.never) + "</p></li>";
        }).join("") + "</ul>" +
        ((d.quiz || []).length ? '<h2 class="sp-h2">' + tx(d.quizH) + '</h2><div class="vb-quiz" id="vbQuizM">' + quizHtml(ZMD) + "</div>" : ""), focusSel);
    });
  }
  OPEN.modes = function () { qReset(ZMD); modes(); };

  /* ---------- alarm messages by brand style ---------- */
  var AL = { style: "drager" };
  function alarms(focusSel) {
    withData("vb-alarms", alarms, s("alarms"), s("alarmsSub"), function () {
      var d = D().alarms || {}, pr = d.prio || {};
      var legend = '<ul class="vb-prio">' + ["high", "medium", "low"].map(function (k) { return '<li class="vb-pr-' + k + '"><span class="vb-dot" aria-hidden="true"></span><b>' + tx((pr[k] || {}).name) + "</b><span>" + tx((pr[k] || {}).desc) + "</span></li>"; }).join("") + "</ul>";
      var list = '<ol class="vb-alist">' + (d.items || []).map(function (x) {
        return '<li class="vl-card vb-al vb-pr-' + esc(x.prio) + '"><div class="vb-abar"><span class="vb-dot" aria-hidden="true"></span><span class="vb-amsg" translate="no">' + esc((x.labels || {})[AL.style] || "") + '</span><span class="vb-aprio">' + tx((pr[x.prio] || {}).name) + "</span></div>" +
          '<h2 class="vb-an">' + tx(x.name) + '</h2><p class="vb-am">' + tx(x.means) + '</p><h3 class="vl-h3">' + tx(d.stepsH) + '</h3><ol class="vb-asteps">' + (x.steps || []).map(function (st0) { return "<li>" + tx(st0.text) + "</li>"; }).join("") + "</ol></li>";
      }).join("") + "</ol>";
      screen("vb-alarms", alarms, "alarms", s("alarms"), s("alarmsSub"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + "</p>" + legend + '<p class="sp-small vb-showon">' + s("styleShow") + "</p>" + '<div id="vbAlSeg">' + styleSeg("vbalstyle", AL.style) + "</div>" +
        '<div id="vbAlList">' + list + "</div>" + gotBlock("alarms"), focusSel);
    });
  }
  OPEN.alarms = function () { alarms(); };
  A.vbalstyle = function (b) {
    var v = b.getAttribute("data-v"); if (v === AL.style) return; AL.style = v;
    var its = (D().alarms || {}).items || [];
    [].forEach.call(I.root().querySelectorAll("[data-act=vbalstyle]"), function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-v") === v)); });
    [].forEach.call(I.root().querySelectorAll(".vb-amsg"), function (el, i) { if (its[i]) el.textContent = (its[i].labels || {})[v] || ""; });
  };

  /* ---------- 3 am drill ---------- */
  var DR = { id: null, picked: [], res: null, tries: 0, end: 0, timer: null, timeUp: false };
  function drills(focusSel) {
    withData("vb-drills", drills, s("drills"), s("drillsSub"), function () {
      var d = D().drills || {}, p = prefs().drills;
      var rows = I.row("vbopen", ' data-k="never"', I.tile("shield"), s("neverRow"), s("neverSub"), "") + drillList().map(function (x) {
        return I.row("vbdrill", ' data-k="' + esc(x.id) + '"', I.tile("siren"), tx(x.title), tx(x.scene), p[x.id] ? '<span class="vl-solved">' + ico("check") + s("done") + "</span>" : "");
      }).join("") + I.row("vbopen", ' data-k="read"', I.tile("pulse"), s("read"), s("readSub"), isDone("read") ? '<span class="vl-solved">' + ico("check") + s("done") + "</span>" : "");
      var tm = segs("vbtimed", "data-v", [{ id: "0", name: s("untimed") }, { id: "1", name: s("timed") }], prefs().timed ? "1" : "0", s("timerH"));
      screen("vb-drills", drills, "drills", s("drills"), s("drillsSub"), '<p class="vl-lede vb-lede">' + tx(d.intro) + "</p>" +
        '<h2 class="sp-h2" id="vbTimH">' + s("timerH") + "</h2>" + tm + (prefs().timed ? '<p class="sp-small vb-tnote">' + s("timedNote") + "</p>" : "") +
        '<ul class="sp-rows vb-drows">' + rows + "</ul>", focusSel);
    });
  }
  OPEN.drills = function () { drills(); };
  A.vbtimed = function (b) { prefs().timed = b.getAttribute("data-v") === "1" ? 1 : 0; save(); drills('[data-act=vbtimed][data-v="' + b.getAttribute("data-v") + '"]'); };
  function curDrill() { return drillList().filter(function (x) { return x.id === DR.id; })[0] || null; }
  function stepBy(dr, id) { return (dr.steps || []).filter(function (x) { return x.id === id; })[0]; }
  function short(x) { return x.short ? tx(x.short) : tx(x.text); }
  function backDrills() { var id = DR.id; drills('[data-act=vbdrill][data-k="' + id + '"]'); }
  function stateLabel(dr, it) {
    var x = stepBy(dr, it.id);
    if (it.state === "ok") return s(x.opt ? "st_okOpt" : x.flex ? "st_okAny" : "st_ok");
    if (it.state === "late") { var b = it.before && stepBy(dr, it.before); return esc(t(STR.st_late)).replace("{x}", b ? short(b) : ""); }
    return s("st_" + it.state);
  }
  function compare(dr, res) {
    var by = {}; res.items.forEach(function (it) { by[it.id] = it; });
    var mine = DR.picked.map(function (id, i) {
      var it = by[id], good = it.state === "ok";
      return '<li class="vb-c ' + it.state + '"><span class="vb-n" aria-hidden="true">' + (i + 1) + "</span><span class=\"vb-ct\">" + short(stepBy(dr, id)) + '</span><span class="vb-ci" aria-hidden="true">' + ico(good ? "check" : "close") + '</span><span class="sp-sr">' + stateLabel(dr, it) + "</span></li>";
    }).join("");
    var so = safeOrder(dr.steps || []), shared = false, cnt = {};
    so.forEach(function (g) { if (typeof g.n === "number") { cnt[g.n] = (cnt[g.n] || 0) + 1; if (cnt[g.n] > 1) shared = true; } });
    var safe = so.map(function (g) {
      var badge = typeof g.n === "number" ? '<span class="vb-n" aria-hidden="true">' + g.n + "</span>" : '<span class="vb-g vb-g-' + g.n + '">' + s("g_" + g.n) + "</span>";
      return '<li class="vb-c' + (g.n === "never" ? " never" : "") + '">' + badge + '<span class="vb-ct">' + short(stepBy(dr, g.id)) + "</span></li>";
    }).join("");
    return '<div class="vb-cmp" role="group" aria-label="' + s("cmpAria") + '"><section><h3 class="vb-ch">' + s("yourOrder") + '</h3><ol class="vb-cl">' + (mine || '<li class="vb-c"><span class="vb-ct">' + s("empty") + "</span></li>") + "</ol></section>" +
      '<section><h3 class="vb-ch">' + s("safeH") + '</h3><ol class="vb-cl">' + safe + "</ol>" + (shared ? '<p class="vb-cnote">' + s("sameNote") + "</p>" : "") + "</section></div>";
  }
  function stopTimer() { if (DR.timer) { G.clearInterval(DR.timer); DR.timer = null; } }
  function secsLeft() { return Math.max(0, Math.ceil((DR.end - Date.now()) / 1000)); }
  function tick() {
    if (st.view !== "vb-drill" || DR.res || !DR.end) { stopTimer(); return; }
    var n = secsLeft(), el = q("#vbTimer");
    if (el) { el.querySelector(".vb-tt").textContent = t(STR.timeLeft).replace("{s}", I.fmt(n)); el.classList.toggle("low", n <= 10); var bar = el.querySelector(".vb-tbar i"); if (bar) bar.style.transform = "scaleX(" + (n / 60).toFixed(3) + ")"; }
    if (n === 30 || n === 10) { var sr = q("#vbTimerSr"); if (sr) sr.textContent = t(STR.timeLeft).replace("{s}", I.fmt(n)); }
    if (n <= 0) { stopTimer(); DR.timeUp = true; checkNow(); }
  }
  function drill(focusSel) {
    var dr = curDrill();
    if (!dr) return drills();
    var pool = order(dr.steps || [], dr.id + (DR.tries ? ":" + DR.tries : "")).filter(function (x) { return DR.picked.indexOf(x.id) < 0; }), res = DR.res, body;
    var head = '<div class="vl-acard danger vb-scene"><p class="vb-scene-h"><span aria-hidden="true">' + ico("siren") + "</span><b>" + tx(dr.title) + "</b></p><p>" + tx(dr.scene) + "</p></div>";
    var timer = DR.end && !res ? '<div class="vb-timer" id="vbTimer"><span class="vb-tt">' + s("timeLeft", { s: I.fmt(secsLeft()) }) + '</span><span class="vb-tbar" aria-hidden="true"><i style="transform:scaleX(' + (secsLeft() / 60).toFixed(3) + ')"></i></span><span class="sp-sr" id="vbTimerSr" aria-live="polite"></span></div>' : "";
    if (!res) {
      var ord = DR.picked.length ? '<ol class="vb-ord">' + DR.picked.map(function (id, i) { return '<li><span class="vb-n" aria-hidden="true">' + (i + 1) + "</span><span>" + tx(stepBy(dr, id).text) + "</span></li>"; }).join("") + "</ol>"
        : '<p class="vb-empty">' + s("empty") + "</p>";
      body = timer + '<p class="vb-pick">' + s("pickHint") + '</p><h2 class="sp-h2" id="vbOrdH">' + s("yourOrder") + '</h2><div class="vb-ordw" aria-labelledby="vbOrdH" aria-live="polite">' + ord + "</div>" +
        (pool.length ? '<h2 class="sp-h2" id="vbPoolH">' + s("pool") + '</h2><ul class="vb-pool" aria-labelledby="vbPoolH">' + pool.map(function (x) {
          return '<li><button type="button" class="vb-step" data-act="vbpick" data-k="' + esc(x.id) + '" aria-label="' + esc(t(STR.addAria).replace("{x}", t(x.text))) + '"><span class="vb-plus" aria-hidden="true">' + ico("plus") + "</span><span>" + tx(x.text) + "</span></button></li>";
        }).join("") + "</ul>" : "");
    } else {
      var cls = res.ok ? (res.optMissed ? "vb-neutral" : "ok") : "bad", c = drillCount(res);
      body = '<p class="sp-verdict ' + cls + ' vb-dv" tabindex="-1">' + (ico(res.ok && !res.optMissed ? "check" : "info") || "") + "<span>" + (DR.timeUp ? s("timeUp") + " " : "") +
        (res.ok ? s(res.optMissed ? "optLeft" : "allRight") : s("someWrong", { p: I.fmt(c.picked), r: I.fmt(c.right), x: I.fmt(c.fix), m: I.fmt(c.missed) })) + "</span></p>" +
        compare(dr, res) +
        '<h2 class="sp-h2">' + s("whyH") + '</h2><ol class="vb-res">' + res.items.map(function (it) {
          var x = stepBy(dr, it.id), good = it.state === "ok" || it.state === "skipped" || it.state === "optional";
          return '<li class="vb-r ' + it.state + '"><span class="vb-r-i" aria-hidden="true">' + ico(good ? "check" : "close") + '</span><div><p class="vb-r-s">' + stateLabel(dr, it) + (it.pos != null ? " · " + s("yourStep", { n: it.pos + 1 }) : "") + "</p>" +
            "<p><b>" + tx(x.text) + '</b></p><p class="vb-why">' + tx(x.why) + "</p></div></li>";
        }).join("") + "</ol>" +
        '<div class="vl-card vb-sbar"><h2 class="sp-h2">' + s("sbarH") + "</h2><dl>" + ["s", "b", "a", "r"].map(function (k) {
          return '<div><dt><span class="vb-sb">' + k.toUpperCase() + "</span></dt><dd>" + tx((dr.sbar || {})[k]) + "</dd></div>";
        }).join("") + "</dl></div>";
    }
    var list = drillList(), i = list.indexOf(dr), footer;
    if (!res) footer = '<button type="button" class="sp-btn sec" data-act="vbundo"' + (DR.picked.length ? "" : ' disabled aria-disabled="true"') + ">" + s("undo") + '</button><button type="button" class="sp-btn pri" data-act="vbcheck"' + (DR.picked.length ? "" : ' disabled aria-disabled="true"') + ">" + s("check") + "</button>";
    else footer = '<button type="button" class="sp-btn sec" data-act="vbdagain">' + s("again") + "</button>" + (i < list.length - 1 ? '<button type="button" class="sp-btn pri" data-act="vbdnext">' + s("nextDrill") + "</button>" : '<button type="button" class="sp-btn pri" data-act="vbopen" data-k="read">' + s("read") + "</button>");
    I.leave();
    st.view = "vb-drill"; st.again = drill;
    st.onBack = function () { backDrills(); return true; };
    I.paint(I.top(t(STR.backDrills), tx(dr.title), s("drills"), I.langBtn()) +
      '<div class="sp-scroll sp-pad"><div class="sp-col vb-wrap">' + head + body + "</div></div>" +
      '<div class="sp-foot vb-dfoot">' + footer + "</div>", typeof focusSel === "string" ? focusSel : null);
    st.onLeave = stopTimer;
    if (DR.end && !res && !DR.timer) DR.timer = G.setInterval(tick, 250);
  }
  function startClock() { stopTimer(); DR.timeUp = false; DR.end = prefs().timed ? Date.now() + 60000 : 0; }
  function openDrill(id) { DR.id = id; DR.picked = []; DR.res = null; DR.tries = 0; startClock(); drill(); }
  A.vbdrill = function (b) { var id = b.getAttribute("data-k"); if (!B.data) { load().then(function () { openDrill(id); }, function () {}); return; } openDrill(id); };
  A.vbpick = function (b) {
    var k = b.getAttribute("data-k");
    if (DR.res || DR.picked.indexOf(k) >= 0) return;
    DR.picked.push(k);
    drill(".vb-step, [data-act=vbcheck]");
  };
  A.vbundo = function () { if (DR.res || !DR.picked.length) return; DR.picked.pop(); drill(".vb-step"); };
  function checkNow() {
    var dr = curDrill();
    if (!dr || DR.res) return;
    stopTimer();
    DR.res = verdict(dr.steps || [], DR.picked);
    if (DR.res.ok) {
      prefs().drills[dr.id] = 1;
      if (drillList().every(function (x) { return prefs().drills[x.id]; })) prefs().done.drills = 1;
      save();
    }
    I.haptic(DR.res.ok ? "success" : "error");
    drill(".vb-dv");
  }
  A.vbcheck = function () { if (!DR.picked.length) return; checkNow(); };
  // Try again reshuffles the pool, so the order is learned, not the positions.
  A.vbdagain = function () { DR.picked = []; DR.res = null; DR.tries++; startClock(); drill(".vb-step"); };
  A.vbdnext = function () { var l = drillList(), i = l.indexOf(curDrill()); if (i >= 0 && i < l.length - 1) openDrill(l[i + 1].id); };

  /* ---------- read this screen: a full panel with an alarm, no hints ---------- */
  var RD = { i: 0, a1: null, a2: null, right: 0, fin: false, log: [] };
  function readItems() { return (D().read || {}).items || []; }
  function readBody() {
    var it = readItems(), n = it.length, R = it[RD.i];
    if (RD.fin || !R) {
      var m = n * 2, miss = RD.log.filter(function (x) { return !x.ok; });
      return '<div class="vb-qend"><p class="sp-verdict ' + (RD.right === m ? "ok" : "bad") + ' vb-rscore" tabindex="-1">' + (ico(RD.right === m ? "check" : "info") || "") + "<span>" + s("rdScore", { n: I.fmt(RD.right), m: I.fmt(m) }) + "</span></p>" +
        (miss.length ? '<h3 class="vl-h3 vb-revh">' + s("reviewH") + '</h3><ol class="vb-rev">' + miss.map(function (x) {
          var Ri = it[x.i], Qx = x.q === 1 ? Ri.q1 : Ri.q2;
          return '<li><p class="vb-revq"><span class="vb-revs">' + esc(styleName(Ri.style)) + "</span> " + s(x.q === 1 ? "rdFirst" : "rdRead") + "</p>" +
            (x.q === 1 ? '<p class="vb-reva"><span aria-hidden="true">' + ico("check") + "</span>" + s("rightAns", { x: t(Ri.q1.options[Ri.q1.answer]) }) + "</p>"
              : '<p class="vb-reva"><span aria-hidden="true">' + ico("check") + "</span>" + s("rightAns", { x: Ri.q2.targets.map(function (k) { return tileName(k, Ri.style); }).join(", ") }) + "</p>") +
            '<p class="vb-why">' + tx(Qx.why) + "</p></li>";
        }).join("") + "</ol>" : '<p class="vb-why">' + s("allRightQ") + "</p>") +
        '<div class="vb-qbtns"><button type="button" class="sp-btn sec" data-act="vbragain">' + s("again") + "</button>" + nextBtn("read") + "</div></div>";
    }
    var marks = {}, a2ok = RD.a2 && R.q2.targets.indexOf(RD.a2) >= 0;
    if (RD.a2) { R.q2.targets.forEach(function (k) { marks[k] = "right"; }); if (!a2ok) marks[RD.a2] = "wrong"; }
    var Q1 = R.q1, a1 = RD.a1, pm = perm(Q1.options.length, R.id + ":" + RD.tries);
    var q1 = '<h3 class="sp-h3 vl-q" id="vbRQ1">' + tx(Q1.q) + '</h3><div class="sp-answers' + (a1 != null ? " done" : "") + '" role="group" aria-labelledby="vbRQ1">' + pm.map(function (j, pos) {
      var stt = a1 == null ? "" : j === Q1.answer ? "right" : j === a1 ? "wrong" : "dim";
      return '<button type="button" class="sp-ans" data-act="vbr1" data-o="' + j + '"' + (stt ? ' data-state="' + stt + '" aria-disabled="true"' : "") + '><span class="k" aria-hidden="true">' + (stt === "right" ? ico("check") : stt === "wrong" ? ico("close") : "ABCD".charAt(pos)) + "</span>" + tx(Q1.options[j]) + "</button>";
    }).join("") + "</div>" +
      (a1 != null ? '<p class="sp-verdict vb-r1v ' + (a1 === Q1.answer ? "ok" : "bad") + '" tabindex="-1">' + (ico(a1 === Q1.answer ? "check" : "close") || "") + "<span>" + s(a1 === Q1.answer ? "right" : "wrong") + '</span></p><p class="vb-why">' + tx(Q1.why) + "</p>" +
        '<h3 class="sp-h3 vl-q vb-rq2" id="vbRQ2" tabindex="-1">' + tx(R.q2.q) + "</h3>" + (RD.a2 ? "" : '<p class="sp-small">' + s("rdTap") + "</p>") : "");
    var q2 = RD.a2 ? '<p class="sp-verdict vb-r2v ' + (a2ok ? "ok" : "bad") + '" tabindex="-1">' + (ico(a2ok ? "check" : "close") || "") + "<span>" + (a2ok ? s("right") : s("rdTapped", { x: tileName(RD.a2, R.style), y: tileName(R.q2.targets[0], R.style) })) + '</span></p><p class="vb-why">' + tx(R.q2.why) + "</p>" +
      '<button type="button" class="sp-btn pri vb-qnext" data-act="vbrnext">' + s(RD.i < n - 1 ? "rdNext" : "done") + "</button>" : "";
    return '<p class="sp-small vb-qof">' + s("rdOf", { i: I.fmt(RD.i + 1), n: I.fmt(n) }) + '</p><div class="vl-acard danger vb-scene"><p>' + tx(R.scene) + "</p></div>" +
      panel({ style: R.style, page: "main", act: "vbr2", marks: marks, lock: a1 == null || !!RD.a2, ov: R.ov }) +
      '<div class="vb-rq">' + q1 + '<div class="vb-fres" aria-live="polite">' + q2 + "</div></div>";
  }
  function readScr(focusSel) {
    withData("vb-read", readScr, s("read"), s("readSub"), function () {
      screen("vb-read", readScr, "read", s("read"), s("readSub"), '<p class="vl-lede vb-lede">' + tx((D().read || {}).intro) + '</p><div id="vbRead">' + readBody() + "</div>", focusSel);
    });
  }
  RD.tries = 0;
  function readReset() { RD.i = 0; RD.a1 = null; RD.a2 = null; RD.right = 0; RD.fin = false; RD.log = []; RD.tries++; }
  OPEN.read = function () { readReset(); readScr(); };
  function repaintRead(sel) { var el = q("#vbRead"); if (!el) return; el.innerHTML = readBody(); if (sel) focus("#vbRead " + sel); }
  A.vbr1 = function (b) {
    var R = readItems()[RD.i]; if (!R || RD.a1 != null) return;
    RD.a1 = +b.getAttribute("data-o"); var ok = RD.a1 === R.q1.answer; if (ok) RD.right++;
    RD.log.push({ i: RD.i, q: 1, ok: ok }); I.haptic(ok ? "success" : "error"); repaintRead(".vb-r1v");
  };
  A.vbr2 = function (b) {
    var R = readItems()[RD.i]; if (!R || RD.a1 == null || RD.a2) return;
    RD.a2 = b.getAttribute("data-k"); var ok = R.q2.targets.indexOf(RD.a2) >= 0; if (ok) RD.right++;
    RD.log.push({ i: RD.i, q: 2, ok: ok }); I.haptic(ok ? "success" : "error"); repaintRead(".vb-r2v");
  };
  A.vbrnext = function () {
    var n = readItems().length;
    if (RD.i < n - 1) { RD.i++; RD.a1 = null; RD.a2 = null; repaintRead(".vb-qof"); var f = q("#vbRead .vb-scene"); if (f) { f.setAttribute("tabindex", "-1"); focus("#vbRead .vb-scene"); } return; }
    RD.fin = true;
    if (RD.right > (prefs().readBest || 0)) prefs().readBest = RD.right;
    prefs().done.read = 1; save();
    repaintRead(".vb-rscore");
  };
  A.vbragain = function () { readReset(); repaintRead(".sp-ans"); };

  /* ---------- hands-on skills ---------- */
  function skillsScr(focusSel) {
    withData("vb-skills", skillsScr, s("skills"), s("skillsSub"), function () {
      var d = D().skills || {}, p = prefs().skills;
      screen("vb-skills", skillsScr, "skills", s("skills"), s("skillsSub"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + '</p><p class="sp-small vb-skn" id="vbSkN" aria-live="polite">' + LINE.skills() + "</p>" +
        '<ol class="vb-skills">' + skillList().map(function (x, i) {
          var on = !!p[x.id];
          return '<li class="vl-card vb-skill" id="vbSk' + i + '"><h2 class="vb-skt"><span class="vb-n" aria-hidden="true">' + (i + 1) + "</span>" + tx(x.title) + "</h2>" +
            '<p class="vb-skw"><span class="vb-mwk">' + s("whenH") + "</span>" + tx(x.when) + '</p><ol class="vb-sks">' + (x.steps || []).map(function (y) { return "<li>" + tx(y) + "</li>"; }).join("") + "</ol>" +
            (x.warn ? '<p class="vb-skwarn"><span aria-hidden="true">' + ico("info") + "</span>" + tx(x.warn) + "</p>" : "") +
            '<button type="button" class="vb-chk vb-sktick" data-act="vbskill" data-k="' + esc(x.id) + '" aria-pressed="' + on + '"><span class="vb-box" aria-hidden="true">' + ico("check") + '</span><span class="vb-chk-b"><b>' + s("skillTick") + "</b></span></button></li>";
        }).join("") + '</ol><div id="vbGot">' + (isDone("skills") ? nextBtn("skills") : "") + "</div>", focusSel);
    });
  }
  OPEN.skills = function () { skillsScr(); };
  A.vbskill = function (b) {
    var k = b.getAttribute("data-k"), p = prefs().skills, on = !p[k];
    if (on) p[k] = 1; else delete p[k];
    var all = skillList().every(function (x) { return p[x.id]; });
    if (all) prefs().done.skills = 1; else delete prefs().done.skills;
    save(); b.setAttribute("aria-pressed", String(on)); if (on) I.haptic(all ? "success" : "light");
    var n = q("#vbSkN"); if (n) n.innerHTML = LINE.skills();
    var gb = q("#vbGot"); if (gb) gb.innerHTML = all ? nextBtn("skills") : "";
  };

  /* ---------- handover to the next doctor, with a blank alarm note template ---------- */
  function hand(focusSel) {
    withData("vb-hand", hand, s("handT"), s("handS"), function () {
      var d = D().handover || {}, nt = d.note || {};
      screen("vb-hand", hand, "hand", s("handT"), s("handS"),
        '<p class="vl-lede vb-lede">' + tx(d.intro) + '</p><ol class="vb-ho">' + (d.rows || []).map(function (r, i) {
          return '<li class="vl-card vb-hr"><span class="vb-n" aria-hidden="true">' + (i + 1) + '</span><div><h2 class="vb-hl">' + tx(r.label) + '</h2><p class="vb-hw">' + tx(r.what) + "</p>" +
            '<p class="vb-hx"><span class="vb-hxk">' + tx(d.exH) + "</span>" + tx(r.example) + "</p></div></li>";
        }).join("") + "</ol>" +
        '<section class="vl-card vb-nv vb-docs"><h2 class="sp-h2">' + tx(d.docH) + '</h2><ul class="vb-list ok">' + (d.doc || []).map(function (x) { return '<li><span aria-hidden="true">' + ico("note") + "</span><span>" + tx(x) + "</span></li>"; }).join("") + "</ul></section>" +
        (nt.fields ? '<section class="vl-card vb-note"><h2 class="sp-h2" id="vbNoteH">' + tx(nt.h) + '</h2><p class="vb-why">' + tx(nt.intro) + '</p><dl class="vb-ntpl" aria-labelledby="vbNoteH">' +
          nt.fields.map(function (f) { return "<div><dt>" + tx(f) + '</dt><dd aria-hidden="true"></dd></div>'; }).join("") + "</dl>" +
          '<button type="button" class="sp-btn sec vb-copy" data-act="vbcopy">' + ico("copy") + " " + s("copy") + '</button><p class="sp-small vb-copied" id="vbCopied" role="status"></p></section>' : "") +
        '<button type="button" class="sp-btn sec vb-todr" data-act="vbdrill" data-k="silence">' + s("toSilence") + "</button>" + gotBlock("hand"), focusSel);
    });
  }
  OPEN.hand = function () { hand(); };
  A.vbcopy = function () {
    var txt = noteText(((D().handover || {}).note || {}).fields, L()), out = q("#vbCopied");
    function say(k) { if (out) out.textContent = t(STR[k]); }
    try {
      if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) G.navigator.clipboard.writeText(txt).then(function () { say("copied"); }, function () { say("copyFail"); });
      else say("copyFail");
    } catch (e) { say("copyFail"); }
  };

  /* ---------- never alone ---------- */
  function never(focusSel) {
    withData("vb-never", never, s("neverT"), s("neverSub"), function () {
      var d = D().never || {};
      function ul(arr, icon, cls) { return '<ul class="vb-list ' + cls + '">' + (arr || []).map(function (x) { return '<li><span aria-hidden="true">' + ico(icon) + "</span><span>" + tx(x) + "</span></li>"; }).join("") + "</ul>"; }
      screen("vb-never", never, "never", s("neverT"), s("neverSub"),
        '<section class="vl-card vb-nv"><h2 class="sp-h2">' + s("mayH") + "</h2>" + ul(d.may, "check", "ok") + "</section>" +
        '<section class="vl-card vb-nv"><h2 class="sp-h2">' + s("mayNotH") + "</h2>" + ul(d.mayNot, "lock", "no") + "</section>" +
        '<section class="vl-card vb-nv vb-call"><h2 class="sp-h2">' + s("callH") + "</h2>" + ul(d.callNow, "siren", "call") + "</section>" +
        '<section class="vl-card vb-sbar"><h2 class="sp-h2">' + tx(d.sbarH) + "</h2><dl>" + (d.sbar || []).map(function (x) {
          return '<div><dt><span class="vb-sb">' + esc(x.k) + "</span>" + tx(x.label) + "</dt><dd>" + tx(x.text) + "</dd></div>";
        }).join("") + "</dl></section>" +
        '<button type="button" class="sp-btn sec vb-todr" data-act="vbopen" data-k="drills">' + s("toDrills") + "</button>" + gotBlock("never"), focusSel);
    });
  }
  OPEN.never = function () { never(); };

  /* ---------- pocket card: one page, print styles; who-to-call stays on this phone ---------- */
  function cardStore() { try { var o = JSON.parse(I.ls().getItem(CK_KEY)); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function cardSave(o) { try { var any = Object.keys(o).some(function (k) { return o[k]; }); if (any) I.ls().setItem(CK_KEY, JSON.stringify(o)); else I.ls().removeItem(CK_KEY); } catch (e) {} }
  function cardScr(focusSel) {
    withData("vb-card", cardScr, s("card"), s("cardSub"), function () {
      var d = D(), c = d.card || {}, sc = d.screen || {}, tl = tiles(), cs = cardStore();
      var lims = (sc.limitRows || []).map(function (r) {
        var lo = r.low && tl[r.low], hi = r.high && tl[r.high], nw = r.now && tl[r.now], nm = r.label ? t(r.label) : nw ? (nw.labels || {}).generic : r.id;
        return "<tr><th scope=\"row\" translate=\"no\">" + esc(nm) + "</th><td>" + (lo ? esc(lo.value) : "") + "</td><td>" + (hi ? esc(hi.value) + (hi.unit ? " " + esc(hi.unit) : "") : "") + "</td></tr>";
      }).join("");
      var ords = cardOrders(drillList()).map(function (o) {
        return '<div class="vb-pco"><h4>' + tx(o.title) + "</h4><ol>" + o.steps.filter(function (x) { return x.n !== "any"; }).map(function (x) { return "<li>" + tx(x.short) + "</li>"; }).join("") + "</ol></div>";
      }).join("");
      var who = (c.who || []).map(function (f) {
        return '<div class="vb-fld"><label for="vbC_' + f.id + '">' + tx(f.label) + '</label><input id="vbC_' + f.id + '" data-c="' + f.id + '" type="' + (f.tel ? "tel" : "text") + '" inputmode="' + (f.tel ? "tel" : "text") + '" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="40" value="' + esc(cs[f.id] || "") + '"></div>';
      }).join("");
      var callNow = ((d.never || {}).callNow || []).map(function (x) { return "<li>" + tx(x) + "</li>"; }).join("");
      var sbar = ((d.never || {}).sbar || []).map(function (x) { return "<li><b>" + esc(x.k) + "</b> " + tx(x.text) + "</li>"; }).join("");
      screen("vb-card", cardScr, "card", s("card"), s("cardSub"),
        '<p class="vl-lede vb-lede">' + tx(c.intro) + "</p>" +
        '<section class="vl-card vb-who"><h2 class="sp-h2" id="vbWhoH">' + tx(c.whoH) + "</h2>" + who +
        '<p class="vb-priv" role="note"><span aria-hidden="true">' + ico("lock") + "</span><span>" + tx(c.privacy) + '</span></p><p class="sp-small vb-saved" id="vbSaved" role="status"></p>' +
        '<button type="button" class="sp-btn sec vb-cclear" data-act="vbcclear">' + s("clearCard") + "</button></section>" +
        '<button type="button" class="sp-btn pri vb-print" data-act="vbprint">' + ico("print") + " " + s("print") + "</button>" +
        '<article class="vb-pcard" id="vbPcard" aria-label="' + s("card") + '">' +
        '<header class="vb-pch"><b>' + s("card") + '</b><span class="vb-pcw" id="vbPcWho">' + whoLine(cs, c) + "</span></header>" +
        '<section><h3>' + tx(c.mayH) + "</h3><p>" + tx(c.may) + "</p></section>" +
        '<section><h3>' + tx(c.setMeasH) + "</h3><p>" + tx(c.setMeas) + "</p></section>" +
        '<section><h3>' + tx(c.silenceH) + "</h3><p>" + tx(c.silence) + "</p></section>" +
        '<section><h3>' + tx(c.dopeH) + "</h3><p>" + tx(c.dope) + "</p></section>" +
        '<section class="vb-pcw2"><h3>' + tx(c.ordersH) + '</h3><div class="vb-pcos">' + ords + '</div><p class="vb-pcany">' + s("anyCall") + "</p></section>" +
        '<section><h3>' + tx(c.limitsH) + '</h3><table class="vb-pclim"><thead><tr><th scope="col">' + s("limAlarm") + '</th><th scope="col">' + s("limLow") + '</th><th scope="col">' + s("limHigh") + "</th></tr></thead><tbody>" + lims + "</tbody></table></section>" +
        '<section><h3>' + tx(c.callH) + '</h3><ul>' + callNow + "</ul></section>" +
        '<section><h3>' + tx(c.sbarH) + '</h3><ul class="vb-pcsbar">' + sbar + "</ul></section>" +
        '<footer class="vb-pcf">' + s("cardFoot") + "</footer></article>", focusSel);
      [].forEach.call(I.root().querySelectorAll(".vb-who input"), function (inp) { inp.addEventListener("input", onCardInput); });
    });
  }
  function whoLine(cs, c) {
    var parts = [];
    if (cs.n1 || cs.p1) parts.push(esc([cs.n1, cs.p1].filter(Boolean).join(" ")));
    if (cs.n2 || cs.p2) parts.push(esc([cs.n2, cs.p2].filter(Boolean).join(" ")));
    return parts.length ? tx(c.whoH) + ": " + parts.join(" · ") : "";
  }
  var cardT = null;
  function onCardInput() {
    var o = {};
    [].forEach.call(I.root().querySelectorAll(".vb-who input"), function (inp) { var v = String(inp.value || "").slice(0, 40).trim(); if (v) o[inp.getAttribute("data-c")] = v; });
    cardSave(o);
    if (o.n1 && o.p1 && !isDone("card")) setDone("card", true);
    var w = q("#vbPcWho"); if (w) w.innerHTML = whoLine(o, D().card || {});
    if (cardT) G.clearTimeout(cardT);
    cardT = G.setTimeout(function () { var sv = q("#vbSaved"); if (sv) sv.textContent = Object.keys(o).length ? t(STR.savedHere) : ""; }, 400);
  }
  OPEN.card = function () { cardScr(); };
  A.vbcclear = function () { cardSave({}); cardScr(".vb-who input"); };
  A.vbprint = function () {
    // Print only the card: a copy at the top of <body> (outside the fixed overlay and its scroller), then clean up.
    var de = G.document.documentElement, card = q("#vbPcard"), hostEl = G.document.getElementById("vbPrintHost");
    setDone("card", true);
    if (!card) return;
    if (!hostEl) { hostEl = G.document.createElement("div"); hostEl.id = "vbPrintHost"; G.document.body.appendChild(hostEl); }
    hostEl.setAttribute("lang", L());
    hostEl.innerHTML = card.outerHTML.replace(' id="vbPcard"', "").replace(' id="vbPcWho"', "");
    de.classList.add("vb-printing");
    function off() { de.classList.remove("vb-printing"); G.removeEventListener("afterprint", off); var h = G.document.getElementById("vbPrintHost"); if (h) h.parentNode.removeChild(h); }
    G.addEventListener("afterprint", off);
    try { G.print(); } catch (e) {}
    G.setTimeout(off, 60000);
  };

  /* ---------- first-night check ---------- */
  function passMark() { var c = D().check || {}; return c.pass || Math.ceil(((c.items || []).length || 12) * 0.8); }
  function today() { try { return new Date().toLocaleDateString(L() === "hi" ? "hi-IN-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  var ZCK = quizDef("ck", function () { return (D().check || {}).items || []; }, "vbCheck", {
    bestKey: "checkBest", againKey: "checkAgain",
    onFinish: function (z) { if (z.right >= passMark()) { var p = prefs(); p.checkPass = p.checkPass || today(); p.done.check = 1; save(); } },
    endHead: function (z, n) {
      var c = D().check || {}, ok = z.right >= passMark();
      return ok ? '<div class="vb-pass" role="status"><span class="vb-pass-i" aria-hidden="true">' + ico("award") + '</span><div><p class="sp-verdict ok vb-qscore" tabindex="-1"><span>' + s("passH") + ": " + s("score", { n: I.fmt(z.right), m: I.fmt(n) }) + "</span></p>" +
        '<p class="vb-pass-b">' + tx(c.badge) + '</p><p class="vb-why">' + tx(c.badgeNote) + "</p></div></div>"
        : '<p class="sp-verdict bad vb-qscore" tabindex="-1">' + (ico("info") || "") + "<span>" + s("score", { n: I.fmt(z.right), m: I.fmt(n) }) + ". " + s("failH", { p: I.fmt(passMark()), m: I.fmt(n) }) + "</span></p>";
    }
  });
  function checkScr(focusSel) {
    withData("vb-check", checkScr, s("check"), s("checkSub"), function () {
      var c = D().check || {}, p = prefs();
      screen("vb-check", checkScr, "check", s("check"), s("checkSub"),
        '<p class="vl-lede vb-lede">' + tx(c.intro) + "</p>" +
        (p.checkPass ? '<p class="vb-badge" role="note"><span aria-hidden="true">' + ico("award") + "</span><span><b>" + tx(c.badge) + "</b> " + s("passedOn", { d: p.checkPass }) + "</span></p>" : "") +
        '<div class="vb-quiz vb-check" id="vbCheck">' + quizHtml(ZCK) + "</div>", focusSel);
    });
  }
  OPEN.check = function () { qReset(ZCK); checkScr(); };

  /* ---------- glossary ---------- */
  function glossScr(focusSel) {
    withData("vb-gloss", glossScr, s("gloss"), s("glossSub"), function () {
      var g = D().gloss || {}, its = g.items || [];
      screen("vb-gloss", glossScr, "gloss", s("gloss"), s("glossSub"),
        '<p class="vl-lede vb-lede">' + tx(g.intro) + '</p><div class="vb-gsearch"><label for="vbGq">' + s("glossFind") + '</label><input id="vbGq" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>' +
        '<p class="sp-small" id="vbGn" role="status">' + s("glossN", { n: I.fmt(its.length) }) + "</p>" +
        '<dl class="vb-gl">' + its.map(function (x) {
          var key = (x.term + " " + x.aka + " " + x.plain.en + " " + x.plain.hi).toLowerCase();
          return '<div class="vb-gi" data-s="' + esc(key) + '"><dt translate="no">' + esc(x.term) + "</dt><dd><p>" + tx(x.plain) + '</p><p class="vb-gaka"><span>' + s("alsoH") + '</span><span translate="no">' + esc(x.aka) + "</span></p></dd></div>";
        }).join("") + '</dl><p class="vb-empty" id="vbGnone" hidden>' + s("glossNone") + "</p>", focusSel);
      var inp = q("#vbGq");
      if (inp) inp.addEventListener("input", function () {
        var v = String(inp.value || "").toLowerCase().trim(), n = 0;
        [].forEach.call(I.root().querySelectorAll(".vb-gi"), function (el) { var on = !v || el.getAttribute("data-s").indexOf(v) >= 0; el.hidden = !on; if (on) n++; });
        var c = q("#vbGn"), e = q("#vbGnone"); if (c) c.textContent = t(STR.glossN).replace("{n}", I.fmt(n)); if (e) e.hidden = n > 0;
      });
    });
  }
  OPEN.gloss = function () { glossScr(); };

  load().then(null, function () {});
})(typeof window !== "undefined" ? window : this);
