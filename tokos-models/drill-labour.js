/* Tokós labour room simulator: a time-stepped labour model. ES5, no DOM, pure (every call returns a new state).
   Browser: window.TOKOS_MODELS.labour. Node (tests): module.exports.
   API: init(seed, scenarioId) -> state; step(state, action, minutes) -> state; actions(state) -> [ids];
        outcome(state) -> {done, mode, grade, flags, lines, baby}; delayed(state); TEXT (event and flag copy).

   What comes from sources (cited in SOURCES, numbers pinned by test/tokos-drill-labour.test.mjs):
   - Cervical progress: Zhang et al. 2010 Table 2, median and 95th percentile hours per 1 cm by parity, and the
     second stage with and without epidural. Zhang assumed log-normal traverse times, so each interval is drawn
     from a log-normal with that median and 95th percentile. Delay = time in the current interval beyond its
     95th percentile (the basis of Zhang's proposed partogram). Admission stations are Zhang Table 1 medians.
   - Contractions: adequate = 3 or more in 10 minutes; inadequate = 2 or fewer (WHO MCPC 2017). Tachysystole =
     more than 5 in 10 minutes (FIGO 2015; MCPC hyperstimulation). Oxytocin runs the MCPC 2017 schedule:
     2.5 mIU/min, +2.5 every 30 minutes to 15, then +5 to a maximum of 30, held once contractions are adequate.
   - FHR: FIGO 2015 classes (normal, suspicious, pathological) as used by the CTG clinic deck. Repetitive late
     decelerations become pathological after 30 minutes; one prolonged deceleration after 5 minutes.
     Reversible causes (FIGO): stop oxytocin for tachysystole, fluids or turning her to her side for
     hypotension after an epidural.
   - Instrumental birth prerequisites (MCPC 2017 vacuum conditions): vertex, term, fully dilated, head at or
     below 0 station; the model also requires ruptured membranes (RCOG GTG 26 lists it; not opened here).
   - Judgements: oxytocin only for inadequate contractions or confirmed delay and never in obstruction; no
     amniotomy alone to prevent delay; no IV fluids to shorten labour (WHO 2018 recs 28, 30, 32; MCPC).
     Caesarean or vacuum needs an indication: delay, a pathological CTG (a suspicious one is not enough, FIGO), or
     obstruction, which is delivered by caesarean at once (MCPC); obstruction left 2 hours or more is flagged.

   Teaching simplifications (ponytail: model choices, not clinical data; a reviewer may tune them):
   - No descent before full dilatation; in the second stage the head descends linearly to +3 over the drawn
     second-stage time. Membranes rupture spontaneously at full dilatation if still intact.
   - Oxytocin raises inadequate contractions by 1 per 10 minutes at each 30-minute titration step.
   - After oxytocin stops, tachysystole settles after 20 minutes (the MCPC observation window).
   - Normal scenarios cap each draw at its 95th percentile so they never cross the delay line by chance.
   - Scheduled events (compromise onset, epidural hypotension, the obstruction course, which mirrors the MCPC
     obstructed-labour partograph example) and all vital-sign values are illustrative scenario settings.
   - Caesarean and instrumental birth complete at the moment of decision (no decision-to-delivery interval). */
(function (G) {
  "use strict";

  var SOURCES = [
    { label: "Zhang J, Landy HJ, Branch DW, et al. Contemporary patterns of spontaneous labor with normal neonatal outcomes. Obstet Gynecol 2010;116:1281-7 (Tables 1 and 2)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3660040/" },
    { label: "WHO recommendations: intrapartum care for a positive childbirth experience (2018)", url: "https://iris.who.int/server/api/core/bitstreams/ba043cf7-cba4-484d-bf7e-ec79c4102d54/content" },
    { label: "WHO. Managing Complications in Pregnancy and Childbirth, 2nd edition (2017)", url: "https://iris.who.int/server/api/core/bitstreams/3bda1306-da5d-487d-b2ad-aff995112a7a/content" },
    { label: "FIGO consensus guidelines on intrapartum fetal monitoring: Cardiotocography (Ayres-de-Campos et al., 2015)", url: "https://www.jsog.or.jp/international/pdf/CTG.pdf" }
  ];

  // Zhang 2010 Table 2, hours [median, 95th percentile]. first[parityGroup][startCm]; parity group 2 = 2+.
  var ZHANG = {
    first: {
      0: { 3: [1.8, 8.1], 4: [1.3, 6.4], 5: [0.8, 3.2], 6: [0.6, 2.2], 7: [0.5, 1.6], 8: [0.5, 1.4], 9: [0.5, 1.8] },
      1: { 4: [1.4, 7.3], 5: [0.8, 3.4], 6: [0.5, 1.9], 7: [0.4, 1.3], 8: [0.3, 1.0], 9: [0.3, 0.9] },
      2: { 4: [1.4, 7.0], 5: [0.8, 3.4], 6: [0.5, 1.8], 7: [0.4, 1.2], 8: [0.3, 0.9], 9: [0.3, 0.8] }
    },
    second: {
      epidural: { 0: [1.1, 3.6], 1: [0.4, 2.0], 2: [0.3, 1.6] },
      none: { 0: [0.6, 2.8], 1: [0.2, 1.3], 2: [0.1, 1.1] }
    }
  };
  var Z95 = 1.6448536269514722;
  var OXY_STEPS = [2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30]; // mIU/min, MCPC 2017 schedule
  var TICK = 5;

  function T(en, hi) { return { en: en, hi: hi }; }
  var SCENARIOS = {
    "normal-primi": { level: "mbbs", parity: 0, dil: 4, station: -1, kind: "normal",
      brief: T("First labour at term, 4 cm, contracting well. Support her and decide when to act.", "पहला प्रसव, पूर्ण अवधि, 4 cm, अच्छे संकुचन। उसका साथ दें और तय करें कब कार्रवाई करनी है।") },
    "normal-multi": { level: "mbbs", parity: 1, dil: 5, station: -1, kind: "normal",
      brief: T("Second baby at term, 5 cm, contracting well.", "दूसरा शिशु, पूर्ण अवधि, 5 cm, अच्छे संकुचन।") },
    "slow-primi": { level: "mbbs", parity: 0, dil: 5, station: -1, kind: "hypokinetic",
      brief: T("First labour at 5 cm; contractions feel weak and infrequent.", "पहला प्रसव, 5 cm; संकुचन कमज़ोर और कम लगते हैं।") },
    "epidural-multi": { level: "mbbs", parity: 2, dil: 5, station: -2, kind: "epidural",
      brief: T("Third baby at 5 cm. She is in pain and asks for an epidural.", "तीसरा शिशु, 5 cm। उसे दर्द है और वह एपिड्यूरल माँगती है।") },
    "obstructed": { level: "resident", parity: 3, dil: 6, station: -2, kind: "obstruction",
      brief: T("Fourth baby, 6 cm on admission, strong contractions, head high.", "चौथा शिशु, भर्ती पर 6 cm, तेज़ संकुचन, सिर ऊपर।") },
    "compromise": { level: "resident", parity: 1, dil: 7, station: -1, kind: "compromise",
      brief: T("Second baby at 7 cm, contracting well. Watch the CTG.", "दूसरा शिशु, 7 cm, अच्छे संकुचन। CTG पर नज़र रखें।") },
    "tachysystole": { level: "resident", parity: 0, dil: 5, station: -1, kind: "sensitive",
      brief: T("First labour at 5 cm with weak contractions. Augmentation may be needed; watch the uterus.", "पहला प्रसव, 5 cm, कमज़ोर संकुचन। संवर्धन की ज़रूरत हो सकती है; गर्भाशय पर नज़र रखें।") }
  };

  var TEXT = {
    // events
    start: T("Labour room: assessment done.", "लेबर रूम: आकलन पूरा।"),
    cm: T("Cervix dilated one more centimetre.", "गर्भाशय-ग्रीवा एक सेंटीमीटर और खुली।"),
    full: T("Fully dilated: second stage.", "पूरी खुली: दूसरा चरण।"),
    srom: T("Membranes ruptured spontaneously.", "झिल्ली अपने आप फट गई।"),
    amniotomy: T("Membranes ruptured (amniotomy).", "झिल्ली फोड़ी गई (एम्नियोटॉमी)।"),
    oxytocin_start: T("Oxytocin started at 2.5 mIU/min.", "ऑक्सीटोसिन 2.5 mIU/min पर शुरू।"),
    oxytocin_up: T("Oxytocin increased by one step.", "ऑक्सीटोसिन एक चरण बढ़ाया गया।"),
    oxytocin_stop: T("Oxytocin stopped.", "ऑक्सीटोसिन बंद।"),
    analgesia: T("Epidural analgesia in place.", "एपिड्यूरल एनाल्जेसिया लगा।"),
    position: T("Turned onto her left side.", "उसे बाईं करवट पर किया गया।"),
    fluids: T("IV fluid bolus given.", "IV फ़्लूइड बोलस दिया गया।"),
    hypotension: T("BP has dropped after the epidural.", "एपिड्यूरल के बाद BP गिर गया है।"),
    hypotension_over: T("BP has recovered.", "BP ठीक हो गया।"),
    tachysystole: T("More than 5 contractions in 10 minutes: tachysystole.", "10 मिनट में 5 से अधिक संकुचन: टैकीसिस्टोल।"),
    tachysystole_over: T("Contractions have settled.", "संकुचन सामान्य हो गए।"),
    arrest: T("No further dilatation or descent despite strong contractions; moulding is increasing.", "तेज़ संकुचनों के बावजूद और फैलाव या उतराव नहीं; मोल्डिंग बढ़ रही है।"),
    rupture_signs: T("Rapid maternal pulse, constant pain and suprapubic tenderness: signs of impending uterine rupture.", "माँ की तेज़ नाड़ी, लगातार दर्द और सुप्राप्यूबिक कोमलता: गर्भाशय फटने के संकेत।"),
    fhr_suspicious: T("CTG is now suspicious.", "CTG अब संदिग्ध है।"),
    fhr_pathological: T("CTG is now pathological.", "CTG अब पैथोलॉजिकल है।"),
    fhr_normal: T("CTG is back to normal.", "CTG फिर सामान्य है।"),
    svd: T("Spontaneous vaginal birth.", "स्वतः योनि प्रसव।"),
    instrumental: T("Assisted vaginal birth (vacuum).", "सहायता प्राप्त योनि प्रसव (वैक्यूम)।"),
    caesarean: T("Caesarean birth.", "सिज़ेरियन प्रसव।"),
    refused: T("Not possible now: its prerequisites are not met.", "अभी संभव नहीं: इसकी शर्तें पूरी नहीं हैं।"),
    // judgements (outcome lines)
    oxytocin_not_indicated: T("Oxytocin was started without inadequate contractions or a confirmed delay. WHO does not recommend oxytocin to prevent delay.", "ऑक्सीटोसिन कमज़ोर संकुचन या पुष्ट देरी के बिना शुरू हुआ। WHO देरी रोकने के लिए ऑक्सीटोसिन की सलाह नहीं देता।"),
    oxytocin_obstruction: T("Oxytocin was given in obstructed labour. Exclude disproportion and obstruction before augmenting: it risks uterine rupture.", "अवरुद्ध प्रसव में ऑक्सीटोसिन दिया गया। संवर्धन से पहले असमानता और रुकावट खारिज करें: इससे गर्भाशय फटने का खतरा है।"),
    amniotomy_routine: T("Amniotomy alone to prevent delay is not recommended (WHO); consider it with oxytocin for a confirmed delay.", "देरी रोकने के लिए केवल एम्नियोटॉमी की सलाह नहीं है (WHO); पुष्ट देरी में ऑक्सीटोसिन के साथ सोचें।"),
    fluids_not_indicated: T("IV fluids to shorten labour are not recommended (WHO); give them for a reason such as hypotension.", "प्रसव छोटा करने के लिए IV फ़्लूइड की सलाह नहीं है (WHO); इन्हें किसी कारण, जैसे BP गिरने, पर दें।"),
    cs_not_indicated: T("Caesarean without an indication: labour was progressing within Zhang's 95th percentiles and the CTG was normal.", "बिना कारण सिज़ेरियन: प्रसव ज़ांग के 95वें पर्सेंटाइल के भीतर बढ़ रहा था और CTG सामान्य था।"),
    cs_before_augmentation: T("Weak contractions were the cause of the delay: augment with oxytocin before deciding on caesarean (MCPC).", "देरी का कारण कमज़ोर संकुचन थे: सिज़ेरियन तय करने से पहले ऑक्सीटोसिन से संवर्धन करें (MCPC)।"),
    tachysystole_ignored: T("Tachysystole ran for 30 minutes with oxytocin still on. Stop the oxytocin, turn her to her side, and consider acute tocolysis (FIGO).", "ऑक्सीटोसिन चालू रहते टैकीसिस्टोल 30 मिनट चला। ऑक्सीटोसिन बंद करें, करवट दिलाएँ, और तुरंत टोकोलिसिस पर विचार करें (FIGO)।"),
    pathological_ignored: T("The CTG stayed pathological for more than 30 minutes. FIGO: correct reversible causes at once, or expedite birth.", "CTG 30 मिनट से अधिक पैथोलॉजिकल रहा। FIGO: सुधारे जा सकने वाले कारण तुरंत ठीक करें, या जल्दी प्रसव कराएँ।"),
    analgesia_declined: T("She asked for pain relief. WHO recommends epidural analgesia for women who request it.", "उसने दर्द से राहत माँगी थी। WHO माँगने वाली महिलाओं के लिए एपिड्यूरल की सलाह देता है।"),
    instrumental_not_indicated: T("Vacuum birth without an indication: the second stage was within Zhang's 95th percentile and the CTG was normal.", "बिना कारण वैक्यूम प्रसव: दूसरा चरण ज़ांग के 95वें पर्सेंटाइल के भीतर था और CTG सामान्य था।"),
    instrumental_for_suspicious: T("Vacuum birth for a suspicious CTG. FIGO advises correcting reversible causes and close monitoring first.", "संदिग्ध CTG पर वैक्यूम प्रसव। FIGO पहले सुधारे जा सकने वाले कारण ठीक करने और कड़ी निगरानी की सलाह देता है।"),
    cs_for_suspicious: T("Caesarean for a suspicious CTG. FIGO advises correcting reversible causes and close monitoring first. Expedite birth when the CTG is pathological and cannot be corrected.", "संदिग्ध CTG पर सिज़ेरियन। FIGO पहले सुधारे जा सकने वाले कारण ठीक करने और कड़ी निगरानी की सलाह देता है। CTG पैथोलॉजिकल हो और ठीक न हो, तब प्रसव शीघ्र कराएँ।"),
    obstruction_neglected: T("Obstructed labour was left for 2 hours or more. Deliver by caesarean as soon as obstruction is recognised (MCPC).", "अवरुद्ध प्रसव को 2 घंटे या अधिक छोड़ा गया। रुकावट पहचानते ही सिज़ेरियन से प्रसव कराएँ (MCPC)।"),
    good: T("Well managed: each intervention had an indication.", "अच्छा प्रबंधन: हर हस्तक्षेप का कारण था।"),
    baby_path: T("Minutes of pathological CTG before birth: ", "जन्म से पहले पैथोलॉजिकल CTG के मिनट: ")
  };
  var HARM = { oxytocin_obstruction: 1, tachysystole_ignored: 1, pathological_ignored: 1, obstruction_neglected: 1 };

  /* ---------- seeded randomness (mulberry32; the generator state lives in the labour state) ---------- */
  // 32-bit integer multiply in ES5 (Math.imul is ES2015); same result as Math.imul for every input.
  function imul(a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  }
  function rand(s) {
    var a = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    var t = imul(a ^ (a >>> 15), 1 | a);
    t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss(s) { var u = 0; while (u === 0) u = rand(s); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand(s)); }
  function between(s, lo, hi) { return lo + Math.floor(rand(s) * (hi - lo + 1)); }
  // Minutes drawn from a log-normal with Zhang's median and 95th percentile (hours).
  function drawMin(s, mp, capAtP95) {
    var h = Math.exp(Math.log(mp[0]) + (Math.log(mp[1] / mp[0]) / Z95) * gauss(s));
    return Math.max(1, Math.round((capAtP95 ? Math.min(h, mp[1]) : h) * 60));
  }
  function pg(s) { return Math.min(s.parity, 2); }
  function firstRow(s, cm) { var r = ZHANG.first[pg(s)]; return r[cm] || r[Math.max(cm, pg(s) ? 4 : 3)]; }
  function secondRow(s) { return ZHANG.second[s.epidural ? "epidural" : "none"][pg(s)]; }
  function capped(s) { return SCENARIOS[s.scenario].kind === "normal"; }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function log(s, code) { s.events.push({ t: s.t, code: code }); }
  function flag(s, code) { if (s.flags.indexOf(code) < 0) s.flags.push(code); }

  function newInterval(s) { var cm = Math.floor(s.dil); s.plan = { cm: cm, need: drawMin(s, firstRow(s, cm), capped(s)), spent: 0, wall: 0 }; }

  function init(seed, scenarioId) {
    var id = SCENARIOS[scenarioId] ? scenarioId : "normal-primi", sc = SCENARIOS[id];
    var s = {
      v: 1, scenario: id, level: sc.level, seed: seed, rng: (seed >>> 0) || 1, t: 0,
      parity: sc.parity, dil: sc.dil, station: sc.station, presentation: "vertex", position: "OA", gestWeeks: 39,
      membranes: "intact", liquor: null, contractions: sc.kind === "hypokinetic" || sc.kind === "sensitive" ? 2 : 4,
      oxytocin: { on: false, step: -1, since: null }, epidural: false, posture: "upright",
      maternal: { pulse: 0, sbp: 0, dbp: 0, temp: 37.0, hypotension: false },
      fhr: { baseline: 0, variability: "normal", decels: "none", figo: "normal", since: null, pathMin: 0 },
      stage: 1, plan: null, second: null, sched: {}, flags: [], events: [], delivered: null
    };
    s.maternal.pulse = between(s, 76, 92); s.maternal.sbp = between(s, 108, 122); s.maternal.dbp = between(s, 66, 78);
    s.fhr.baseline = between(s, 125, 150);
    if (sc.kind === "obstruction") s.sched.arrestCm = between(s, 6, 7);
    if (sc.kind === "compromise") s.sched.compromiseAt = between(s, 2, 4) * TICK;
    if (sc.kind === "sensitive") s.sched.tachyAfter = between(s, 6, 12) * TICK;
    newInterval(s);
    log(s, "start");
    return s;
  }

  /* ---------- clinical judgements the model needs ---------- */
  function delayed(s) {
    if (s.delivered) return false;
    if (s.stage === 1) return s.plan.wall > firstRow(s, s.plan.cm)[1] * 60;
    return s.second.spent > secondRow(s)[1] * 60;
  }
  function arrested(s) { return SCENARIOS[s.scenario].kind === "obstruction" && s.stage === 1 && Math.floor(s.dil) >= s.sched.arrestCm; }
  function instrumentalOk(s) {
    return s.stage === 2 && s.presentation === "vertex" && s.gestWeeks >= 37 && s.membranes === "ruptured" && s.station >= 0;
  }

  var ACTIONS = ["observe", "amniotomy", "oxytocin_start", "oxytocin_stop", "analgesia", "position", "fluids", "instrumental", "caesarean"];
  function actions(s) {
    if (s.delivered) return [];
    return ACTIONS.filter(function (a) {
      if (a === "amniotomy") return s.membranes === "intact" && s.stage === 1;
      if (a === "oxytocin_start") return !s.oxytocin.on;
      if (a === "oxytocin_stop") return s.oxytocin.on;
      if (a === "analgesia") return !s.epidural;
      if (a === "position") return s.posture !== "lateral";
      if (a === "instrumental") return instrumentalOk(s);
      return true;
    });
  }

  function deliver(s, mode) { s.delivered = { mode: mode, t: s.t }; s.oxytocin.on = false; log(s, mode); }

  function apply(s, a) {
    var kind = SCENARIOS[s.scenario].kind;
    if (a === "amniotomy") {
      if (!delayed(s) && !s.oxytocin.on && s.contractions >= 3) flag(s, "amniotomy_routine");
      s.membranes = "ruptured"; s.liquor = kind === "compromise" && s.t >= s.sched.compromiseAt ? "meconium" : "clear";
    } else if (a === "oxytocin_start") {
      if (arrested(s)) { flag(s, "oxytocin_obstruction"); s.sched.oxyInObstruction = s.t; }
      else if (s.contractions >= 3 && !delayed(s)) flag(s, "oxytocin_not_indicated");
      s.oxytocin = { on: true, step: 0, since: s.t };
    } else if (a === "oxytocin_stop") {
      s.oxytocin.on = false; s.oxytocin.stoppedAt = s.t;
    } else if (a === "analgesia") {
      s.epidural = true; s.posture = "supine";
      if (kind === "epidural") s.sched.hypoAt = s.t + 3 * TICK;
    } else if (a === "position") {
      s.posture = "lateral";
      if (s.maternal.hypotension) endHypotension(s);
    } else if (a === "fluids") {
      if (s.maternal.hypotension) endHypotension(s); else flag(s, "fluids_not_indicated");
    } else if (a === "instrumental") {
      if (s.fhr.figo !== "pathological" && !delayed(s)) flag(s, s.fhr.figo === "suspicious" ? "instrumental_for_suspicious" : "instrumental_not_indicated");
      deliver(s, "instrumental");
    } else if (a === "caesarean") {
      // FIGO: a pathological CTG that cannot be corrected is a reason to expedite birth; a suspicious one is not.
      // Obstructed labour (arrest despite strong contractions) is delivered by caesarean at once (MCPC).
      var path = s.fhr.figo === "pathological", susp = s.fhr.figo === "suspicious";
      if (kind === "hypokinetic" || kind === "sensitive") {
        if (!path && !susp && s.oxytocin.since === null) flag(s, "cs_before_augmentation");
        else if (susp && !delayed(s)) flag(s, "cs_for_suspicious");
      } else if (!path && !delayed(s) && !arrested(s)) flag(s, susp ? "cs_for_suspicious" : "cs_not_indicated");
      deliver(s, "caesarean");
    }
    if (a !== "observe" && a !== "instrumental" && a !== "caesarean") log(s, a);
  }
  function endHypotension(s) { s.maternal.hypotension = false; s.maternal.sbp += 28; s.maternal.dbp += 20; s.maternal.pulse -= 14; log(s, "hypotension_over"); }

  /* ---------- one 5-minute tick ---------- */
  function tick(s, dt) {
    var kind = SCENARIOS[s.scenario].kind;
    s.t += dt;
    // oxytocin titration every 30 minutes, held once contractions are adequate (MCPC)
    if (s.oxytocin.on) {
      var steps = Math.floor((s.t - s.oxytocin.since) / 30);
      while (s.oxytocin.step < Math.min(steps, OXY_STEPS.length - 1) && s.contractions < 3) {
        s.oxytocin.step++; s.contractions++; log(s, "oxytocin_up");
      }
      if (kind === "sensitive" && s.contractions >= 3 && s.contractions <= 5 && s.t - s.oxytocin.since >= s.sched.tachyAfter) {
        s.contractions = 6; s.sched.tachyFrom = s.t; log(s, "tachysystole");
      }
      if (s.contractions > 5 && s.t - s.sched.tachyFrom >= 30) flag(s, "tachysystole_ignored");
    } else if (s.contractions > 5 && s.t - s.oxytocin.stoppedAt >= 20) {
      s.contractions = 4; log(s, "tachysystole_over");
    }
    // epidural hypotension (scenario event)
    if (s.sched.hypoAt != null && s.t >= s.sched.hypoAt && !s.sched.hypoDone) {
      s.sched.hypoDone = true; s.maternal.hypotension = true; s.maternal.sbp -= 28; s.maternal.dbp -= 20; s.maternal.pulse += 14; log(s, "hypotension");
    }
    // cervix and descent
    var adequate = s.contractions >= 3;
    if (s.stage === 1) {
      s.plan.wall += dt;
      if (arrested(s)) {
        if (s.sched.arrestFrom == null) { s.sched.arrestFrom = s.t; log(s, "arrest"); }
        s.dil = s.sched.arrestCm;
      } else if (adequate) {
        s.plan.spent += dt;
        if (s.plan.spent >= s.plan.need) {
          s.dil = s.plan.cm + 1;
          if (s.dil >= 10) {
            s.dil = 10; s.stage = 2; log(s, "full");
            if (s.membranes === "intact") { s.membranes = "ruptured"; s.liquor = s.liquor || "clear"; log(s, "srom"); }
            s.second = { need: drawMin(s, secondRow(s), capped(s)), spent: 0, from: s.station };
          } else { log(s, "cm"); newInterval(s); }
        } else s.dil = Math.round((s.plan.cm + s.plan.spent / s.plan.need) * 10) / 10;
      }
    } else if (adequate) {
      s.second.spent += dt;
      var f = Math.min(1, s.second.spent / s.second.need);
      s.station = Math.round((s.second.from + (3 - s.second.from) * f) * 10) / 10;
      if (f >= 1) { tickFhr(s, dt); deliver(s, "svd"); return; }
    }
    // obstruction course: maternal distress, then fetal compromise (as in the MCPC partograph example)
    if (s.sched.arrestFrom != null) {
      if ((s.t - s.sched.arrestFrom) % 60 === 0) s.maternal.pulse = Math.min(160, s.maternal.pulse + 6);
      if (s.t - s.sched.arrestFrom >= 120) flag(s, "obstruction_neglected");
      if (s.sched.oxyInObstruction != null && s.oxytocin.on && s.t - s.sched.oxyInObstruction >= 60 && !s.sched.ruptureSigns) {
        s.sched.ruptureSigns = s.t; s.maternal.pulse = Math.max(s.maternal.pulse, 124); log(s, "rupture_signs");
      }
    }
    tickFhr(s, dt);
  }

  function tickFhr(s, dt) {
    var h = s.fhr, kind = SCENARIOS[s.scenario].kind;
    var late = s.contractions > 5 || (kind === "compromise" && s.t >= s.sched.compromiseAt) ||
      (s.sched.arrestFrom != null && s.t - s.sched.arrestFrom >= 180) || s.sched.ruptureSigns != null;
    var prolonged = s.maternal.hypotension;
    var was = h.figo;
    if (!late && !prolonged) {
      h.decels = "none"; h.variability = "normal"; h.since = null; h.figo = "normal";
    } else {
      if (h.since == null) h.since = s.t - dt;
      var dur = s.t - h.since;
      h.decels = prolonged ? "prolonged" : "late";
      h.figo = (prolonged ? dur > 5 : dur > 30) ? "pathological" : "suspicious";
      if (kind === "compromise" && late) h.variability = dur > 50 ? "reduced" : "normal";
    }
    if (h.figo === "pathological") { h.pathMin += dt; if (h.pathMin > 30) flag(s, "pathological_ignored"); }
    if (h.figo !== was) log(s, "fhr_" + h.figo);
  }

  function step(state, action, minutes) {
    var s = clone(state);
    if (s.delivered) return s;
    if (action && action !== "observe") {
      if (actions(s).indexOf(action) < 0) { log(s, "refused"); s.events[s.events.length - 1].action = action; return s; }
      apply(s, action);
      if (s.delivered) return s;
    }
    var left = Math.max(0, Math.min(240, Math.round(minutes || 0)));
    while (left > 0 && !s.delivered) { var dt = Math.min(TICK, left); tick(s, dt); left -= dt; }
    return s;
  }

  function outcome(s) {
    var flags = s.flags.slice();
    if (s.delivered && SCENARIOS[s.scenario].kind === "epidural" && !s.epidural) flags.push("analgesia_declined");
    var lines = [];
    if (s.delivered) lines.push(TEXT[s.delivered.mode]);
    flags.forEach(function (f) { lines.push(TEXT[f]); });
    if (s.fhr.pathMin) lines.push({ en: TEXT.baby_path.en + s.fhr.pathMin, hi: TEXT.baby_path.hi + s.fhr.pathMin });
    if (s.delivered && !flags.length) lines.push(TEXT.good);
    var harm = flags.some(function (f) { return HARM[f]; });
    return {
      done: !!s.delivered, mode: s.delivered ? s.delivered.mode : null, t: s.t,
      grade: !s.delivered ? null : harm ? "poor" : flags.length ? "ok" : "good",
      flags: flags, lines: lines, baby: { pathologicalMin: s.fhr.pathMin, liquor: s.liquor }
    };
  }

  var API = {
    id: "labour", kind: "drill", sim: "time-stepped", level: "mbbs",
    title: T("Labour room simulator", "लेबर रूम सिम्युलेटर"),
    sources: SOURCES, review: "ai_drafted",
    SCENARIOS: SCENARIOS, ZHANG: ZHANG, OXY_STEPS: OXY_STEPS, TEXT: TEXT, ACTIONS: ACTIONS,
    init: init, step: step, actions: actions, outcome: outcome, delayed: delayed, instrumentalOk: instrumentalOk
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else (G.TOKOS_MODELS = G.TOKOS_MODELS || {}).labour = API;
})(typeof window !== "undefined" ? window : this);
