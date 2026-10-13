/* Ophthalmós Explore: five interactive explorers on the Learn tab (eye anatomy, how the eye focuses, the visual
   pathway, the pupil pathway, guided image tours). ES5, buildless IIFE, English and Hindi.
   Part 1 is pure (no DOM): the visual-field model (a lesion site -> the field each eye loses) and the focus model
   (axial length, astigmatism, age and a trial lens -> where the focus falls, the blur, the correcting lens), built on
   the retinoscopy optics model. Node (tests): module.exports. Browser: window.OPHTHALMOS_EXPLORE, then part 2
   registers the screens (O._explore) and the Learn home lists them. */
(function (G) {
  "use strict";
  var R = G.OPHTHALMOS_RETINO || (typeof require === "function" ? require("./ophthalmos-retino-model.js") : null);

  /* ================= visual field model ================= */
  // Field coordinates as the patient sees them: x > 0 is the patient's right, y > 0 is up; the field is the unit
  // disc. Quadrants: U/L (upper, lower) + L/R (patient's left, right half of vision): "UL", "UR", "LL", "LR".
  // Wiring: the right half of vision reaches the left hemisphere. In each eye the nasal retina (temporal field)
  // crosses at the chiasm; the temporal retina (nasal field) stays on its own side. The upper field travels in the
  // inferior radiation (Meyer's loop, temporal lobe), the lower field in the parietal radiation.
  var SITES = ["nerve", "chiasm", "tract", "lgn", "meyer", "parietal", "occipital", "sparing"];
  var SIDED = { nerve: 1, tract: 1, lgn: 1, meyer: 1, parietal: 1, occipital: 1, sparing: 1 };
  var SPARE = 0.12; // macular sparing: the central field (about 5 of 60 degrees in this plot) survives
  var ALLQ = ["UL", "UR", "LL", "LR"];
  function opp(s) { return s === "L" ? "R" : "L"; }
  function half(h) { return ["U" + h, "L" + h]; } // both quadrants of one half of vision

  // site + side ("L" | "R", the patient's side of the lesion) -> the defect.
  // key names the defect; hemi is the half of vision lost (homonymous and quadrant defects) or the blind eye.
  function field(site, side) {
    var s = side === "L" ? "L" : "R", c = opp(s), eyes = { L: { lost: [], spare: 0 }, R: { lost: [], spare: 0 } }, key, hemi = null;
    if (SITES.indexOf(site) < 0) return { site: null, side: null, key: "normal", hemi: null, eyes: eyes };
    if (site === "nerve") { eyes[s].lost = ALLQ.slice(); key = "mono"; hemi = s; }
    else if (site === "chiasm") { eyes.R.lost = half("R"); eyes.L.lost = half("L"); key = "bitemporal"; s = null; }
    else {
      hemi = c; // everything behind the chiasm: the opposite half of vision, in both eyes
      var q = site === "meyer" ? ["U" + c] : site === "parietal" ? ["L" + c] : half(c);
      eyes.L.lost = q.slice(); eyes.R.lost = q.slice();
      key = site === "meyer" ? "supQuad" : site === "parietal" ? "infQuad" : "hemianopia";
      if (site === "sparing") { eyes.L.spare = eyes.R.spare = SPARE; key = "hemianopiaSparing"; }
    }
    return { site: site, side: s, key: key, hemi: hemi, eyes: eyes };
  }
  // Is the point (x, y) of this eye's field seen? null outside the field.
  function seen(res, eye, x, y) {
    var r2 = x * x + y * y, e = res.eyes[eye];
    if (r2 > 1) return null;
    if (e.spare && r2 <= e.spare * e.spare) return true;
    return e.lost.indexOf((y >= 0 ? "U" : "L") + (x >= 0 ? "R" : "L")) < 0;
  }
  // What one eye loses, in the words a chart is read with: "none", "all", or temporal/nasal + Half/Upper/Lower.
  // The temporal half of an eye's field is on that eye's own side.
  function eyeLoss(res, eye) {
    var lost = res.eyes[eye].lost;
    if (!lost.length) return "none";
    if (lost.length === 4) return "all";
    var h = lost[0].charAt(1), side = h === eye ? "temporal" : "nasal";
    if (lost.length === 2) return side + "Half";
    return side + (lost[0].charAt(0) === "U" ? "Upper" : "Lower");
  }
  // Polygon wedges of the lost quadrants for drawing (unit disc, SVG y down): the chart is computed, not a picture.
  function lostPaths(res, eye, cx, cy, r) {
    var out = [];
    res.eyes[eye].lost.forEach(function (q) {
      var sx = q.charAt(1) === "R" ? 1 : -1, sy = q.charAt(0) === "U" ? -1 : 1; // SVG: up is -y
      var x1 = cx + sx * r, y2 = cy + sy * r, sweep = sx * sy > 0 ? 1 : 0;
      out.push("M" + cx + " " + cy + "L" + x1 + " " + cy + "A" + r + " " + r + " 0 0 " + sweep + " " + cx + " " + y2 + "Z");
    });
    return out;
  }

  /* ================= focus model ================= */
  // Axial myopia: each millimetre of eye length off 23.5 mm is about 2.7 D (Gullstrand-type schematic eye).
  var AL0 = 23.5, D_PER_MM = 2.7, NEAR = 2.5; // near target at 40 cm
  function q25(v) { return Math.round(v * 4) / 4 + 0; }
  function up25(v) { return Math.ceil(v * 4 - 1e-9) / 4 + 0; }
  // Accommodation: Hofstetter's minimum amplitude (15 - age/4 D), of which about two thirds is used comfortably.
  function amplitude(age) { return Math.max(0, 15 - 0.25 * age); }
  function usable(age) { return amplitude(age) * 2 / 3; }
  // o: {len (mm), cyl (D, <= 0, minus-cylinder form), ax (90 | 180), age, near (bool), lens ({s, c, ax}) | null}.
  // Returns the eye's distance correction rx and reading add, the accommodation used, the residual error of the
  // vertical and horizontal meridians (D; + means the focus falls behind the retina, - in front) and a kind.
  function focus(o) {
    var s = q25(-(o.len - AL0) * D_PER_MM), rx = { s: s, c: o.cyl || 0, ax: o.cyl ? o.ax || 180 : 180 };
    var F = R.mat(rx.s, rx.c, rx.ax), E = o.lens ? R.sum(F, R.mat(o.lens.s || 0, o.lens.c || 0, o.lens.ax || 180), -1) : F;
    var d = o.near ? NEAR : 0, ev = R.meridian(E, 90) + d, eh = R.meridian(E, 0) + d, amp = usable(o.age);
    var acc = Math.max(0, Math.min(amp, (ev + eh) / 2)); // the eye focuses toward its circle of least confusion
    ev -= acc; eh -= acc;
    var m = (ev + eh) / 2, big = Math.max(Math.abs(ev), Math.abs(eh)), far = R.meridian(F, 0) / 2 + R.meridian(F, 90) / 2;
    var kind = big < 0.25 ? "clear" : Math.abs(ev - eh) >= 0.5 ? "astig" : m < 0 ? "myopia" :
      o.near && far - (o.lens ? (o.lens.s || 0) + (o.lens.c || 0) / 2 : 0) < 0.5 ? "presby" : "hyperopia";
    // reading add over the full distance correction: the near demand the comfortable accommodation cannot meet
    return { rx: R.toRx(F), add: up25(Math.max(0, NEAR - amp)), acc: acc, amp: amp, ev: ev + 0, eh: eh + 0, kind: kind };
  }
  // Blur (SVG feGaussianBlur standard deviation, in units of a 400-wide picture) for a residual error per meridian:
  // defocus spreads light along that meridian, so the vertical meridian blurs up and down.
  var BLUR_K = 2.4, BLUR_MAX = 14;
  function blur(f) { return { x: Math.min(BLUR_MAX, Math.abs(f.eh) * BLUR_K), y: Math.min(BLUR_MAX, Math.abs(f.ev) * BLUR_K) }; }

  var API = { SITES: SITES, SIDED: SIDED, SPARE: SPARE, field: field, seen: seen, eyeLoss: eyeLoss, lostPaths: lostPaths,
    AL0: AL0, D_PER_MM: D_PER_MM, amplitude: amplitude, usable: usable, focus: focus, blur: blur };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  G.OPHTHALMOS_EXPLORE = API;

  /* ================= UI (browser) ================= */
  var O = G.OPHTHALMOS, X = API;
  if (!O || !O._internal || !G.document) return;
  var I = O._internal, st = O._st, D = G.OPHTHALMOS_DATA, N = G.OPHTHALMOS_NEURO, A = I.ACTIONS, K = I.KEYS;
  var ico = I.ico, esc = I.esc;
  var BASE = G.SMD_OPHTHALMOS_BASE || "/ophthalmos/";
  var MINUS = "−";

  /* ---------- strings, English and Hindi ---------- */
  var STR = {
    explore: { en: "Explore", hi: "खोजें" },
    exploreSub: { en: "Tap, move and watch how the eye works", hi: "छूकर, खिसकाकर देखें कि आँख कैसे काम करती है" },
    explored: { en: "Explored", hi: "देख लिया" }, notYet: { en: "Not explored yet", hi: "अभी नहीं देखा" },
    nExplored: { en: "{d} of {n} explored", hi: "{n} में से {d} देखे" },
    backLearn: { en: "Back to Learn", hi: "सीखें पर वापस" }, backExplore: { en: "Back to explorer", hi: "एक्सप्लोरर पर वापस" },
    langSwitch: { en: "Switch to Hindi", hi: "अंग्रेज़ी में बदलें" },
    keepGoing: { en: "Keep going", hi: "आगे बढ़ें" }, lessonL: { en: "Lesson: {t}", hi: "पाठ: {t}" },
    testYourself: { en: "Test yourself", hi: "खुद को परखें" },
    testBank: { en: "Question bank: {t}", hi: "Question bank: {t}" }, testClinic: { en: "{c}: real images", hi: "{c}: असली images" },
    testNeuro: { en: "Pupil lab in the neuro-ophthalmology simulator", hi: "Neuro-ophthalmology simulator की pupil lab" },
    loading: { en: "Loading the picture…", hi: "तस्वीर लोड हो रही है…" },
    imgErr: { en: "The picture did not load. Check the connection and try again.", hi: "तस्वीर लोड नहीं हुई। कनेक्शन देखकर फिर कोशिश करें।" },
    retry: { en: "Try again", hi: "फिर कोशिश करें" },
    // anatomy
    anTitle: { en: "Eye anatomy", hi: "आँख की बनावट" }, anLine: { en: "Tap each part to name it, then find it yourself", hi: "हर हिस्से को छूकर नाम देखें, फिर खुद ढूँढें" },
    vSection: { en: "Section", hi: "कटाव" }, vFront: { en: "Front", hi: "सामने से" }, vSlit: { en: "Slit lamp", hi: "Slit lamp" }, vFundus: { en: "Fundus", hi: "Fundus" },
    views: { en: "Picture", hi: "तस्वीर" },
    anHint: { en: "Tap a part of the eye, or pick a name below.", hi: "आँख के किसी हिस्से को छुएँ, या नीचे से कोई नाम चुनें।" },
    anHintPhoto: { en: "Tap a numbered point to name it.", hi: "नाम देखने के लिए किसी नंबर वाले बिंदु को छुएँ।" },
    diagram: { en: "Eye diagram: tap a part, or use the arrow keys and Enter", hi: "आँख का चित्र: किसी हिस्से को छुएँ, या तीर वाली keys और Enter से चुनें" },
    parts: { en: "Parts", hi: "हिस्से" }, point: { en: "Point {n}", hi: "बिंदु {n}" },
    quizStart: { en: "Find the part", hi: "हिस्सा ढूँढें" }, quizStop: { en: "Stop", hi: "रोकें" },
    quizQ: { en: "Tap the {x}", hi: "{x} को छुएँ" }, quizOf: { en: "Question {i} of {n} · {r} right", hi: "प्रश्न {i} / {n} · {r} सही" },
    quizKeys: { en: "Keyboard: arrow keys move the highlight, Enter chooses.", hi: "Keyboard: तीर वाली keys से highlight खिसकाएँ, Enter से चुनें।" },
    right: { en: "Right, that is the {x}.", hi: "सही, यह {x} है।" }, wrong: { en: "That is the {y}. The {x} is lit up now.", hi: "यह {y} है। {x} अब चमक रहा है।" },
    next: { en: "Next", hi: "आगे" }, prev: { en: "Previous", hi: "पीछे" },
    quizDone: { en: "{r} of {n} right", hi: "{n} में से {r} सही" }, again: { en: "Try again", hi: "फिर से" },
    highlighted: { en: "Part {i} of {n} highlighted", hi: "{n} में से हिस्सा {i} चुना" },
    // focus
    foTitle: { en: "How the eye focuses", hi: "आँख फ़ोकस कैसे करती है" }, foLine: { en: "Change the eye and see where the light lands", hi: "आँख बदलें और देखें रोशनी कहाँ मिलती है" },
    preset: { en: "Start from", hi: "यहाँ से शुरू करें" },
    pNormal: { en: "Normal", hi: "सामान्य" }, pMyopia: { en: "Myopia", hi: "Myopia" }, pHyper: { en: "Hyperopia", hi: "Hyperopia" },
    pAstig: { en: "Astigmatism", hi: "Astigmatism" }, pPresby: { en: "Presbyopia", hi: "Presbyopia" },
    len: { en: "Eye length", hi: "आँख की लंबाई" }, cyl: { en: "Astigmatism", hi: "Astigmatism" }, age: { en: "Age", hi: "उम्र" },
    mm: { en: "{v} mm", hi: "{v} mm" }, dpt: { en: "{v} D", hi: "{v} D" }, years: { en: "{v} years", hi: "{v} साल" },
    axis: { en: "Steeper curve", hi: "ज़्यादा घुमाव" }, axV: { en: "Up and down", hi: "ऊपर-नीचे" }, axH: { en: "Side to side", hi: "दाएँ-बाएँ" },
    look: { en: "Looking at", hi: "देख रहे हैं" }, far: { en: "Far", hi: "दूर" }, near: { en: "Near (40 cm)", hi: "पास (40 cm)" },
    show: { en: "Patient sees", hi: "मरीज़ को दिखता है" }, chart: { en: "Letters", hi: "अक्षर" }, scene: { en: "Street", hi: "सड़क" }, fundus: { en: "Fundus", hi: "Fundus" },
    wear: { en: "Put on the correcting glasses", hi: "सही चश्मा पहनाएँ" }, wearing: { en: "Glasses on", hi: "चश्मा पहना है" },
    focusAt: { en: "Focus", hi: "फ़ोकस" }, onR: { en: "on the retina", hi: "रेटिना पर" }, frontR: { en: "in front of the retina", hi: "रेटिना के आगे" }, behindR: { en: "behind the retina", hi: "रेटिना के पीछे" },
    vRays: { en: "up-down rays {x}", hi: "ऊपर-नीचे की किरणें {x}" }, hRays: { en: "side-to-side rays {x}", hi: "दाएँ-बाएँ की किरणें {x}" },
    glasses: { en: "Glasses for this eye", hi: "इस आँख का चश्मा" }, noGlasses: { en: "none for distance", hi: "दूर के लिए ज़रूरत नहीं" },
    sph: { en: "{v} D sphere", hi: "{v} D sphere" }, cylAx: { en: "{v} D cylinder, axis {a}°", hi: "{v} D cylinder, axis {a}°" },
    add: { en: "reading add {v} D", hi: "पढ़ने के लिए add {v} D" }, lensWork: { en: "The lens is focusing by {v} D (accommodation).", hi: "लेंस {v} D ज़्यादा फ़ोकस कर रहा है (accommodation)।" },
    notScale: { en: "Side view of the eye. Focus shifts drawn larger than life.", hi: "आँख का बगल से चित्र। फ़ोकस का खिसकना असल से बड़ा दिखाया है।" },
    solidDashed: { en: "Solid: up-down rays. Dashed: side-to-side rays.", hi: "ठोस रेखा: ऊपर-नीचे की किरणें। टूटी रेखा: दाएँ-बाएँ की किरणें।" },
    kClear: { en: "The light meets exactly on the retina, so the retinal image is sharp.", hi: "रोशनी ठीक रेटिना पर मिलती है, इसलिए रेटिना पर बनी छवि (retinal image) साफ़ है।" },
    kClearGl: { en: "With the glasses the light meets on the retina again: the retinal image is sharp.", hi: "चश्मे से रोशनी फिर रेटिना पर मिलती है: रेटिना पर बनी छवि (retinal image) साफ़ है।" },
    kMyopia: { en: "Myopia (short sight): the eye is too long, so light meets in front of the retina and has spread out again when it lands. Far things blur; near things can stay clear. A minus (concave) lens spreads the light a little so it meets on the retina.", hi: "Myopia (दूर का कम दिखना): आँख ज़्यादा लंबी है, इसलिए रोशनी रेटिना के आगे मिल जाती है और रेटिना तक पहुँचते-पहुँचते फिर फैल जाती है। दूर की चीज़ें धुंधली; पास की साफ़ रह सकती हैं। माइनस (concave) लेंस रोशनी को थोड़ा फैलाता है ताकि वह रेटिना पर मिले।" },
    kHyper: { en: "Hyperopia (long sight): the eye is too short, so light would meet behind the retina. A young eye pulls the focus forward by making its lens fatter (accommodation), which is tiring; near things blur first. A plus (convex) lens brings the focus forward.", hi: "Hyperopia (पास का कम दिखना): आँख छोटी है, इसलिए रोशनी रेटिना के पीछे मिलती। जवान आँख लेंस को मोटा करके (accommodation) फ़ोकस आगे खींच लेती है, जो थकाता है; पहले पास की चीज़ें धुंधली होती हैं। प्लस (convex) लेंस फ़ोकस को आगे लाता है।" },
    kAstig: { en: "Astigmatism: the cornea is curved more in one direction, like the back of a spoon, so up-down rays and side-to-side rays meet at different places. Lines in one direction blur more than the others. A cylindrical lens corrects only the steeper direction.", hi: "Astigmatism: कॉर्निया एक दिशा में ज़्यादा मुड़ा है, चम्मच की पीठ की तरह, इसलिए ऊपर-नीचे और दाएँ-बाएँ की किरणें अलग-अलग जगह मिलती हैं। एक दिशा की रेखाएँ दूसरी से ज़्यादा धुंधली दिखती हैं। Cylindrical लेंस सिर्फ़ ज़्यादा मुड़ी दिशा को ठीक करता है।" },
    kPresby: { en: "Presbyopia: after about 45 the lens stiffens and cannot get fat enough for near, so reading blurs while distance stays clear. Reading glasses (a plus add) do the extra focusing.", hi: "Presbyopia: लगभग 45 साल के बाद लेंस सख़्त हो जाता है और पास के लिए पूरा मोटा नहीं हो पाता, इसलिए पढ़ना धुंधला होता है पर दूर साफ़ रहता है। पढ़ने का चश्मा (प्लस add) बाकी फ़ोकस करता है।" },
    chartText: { en: "The eye focuses light on the retina.|A sharp retinal image needs the focus|to land exactly there.", hi: "आँख रोशनी को रेटिना पर फ़ोकस करती है।|साफ़ छवि (retinal image) के लिए फ़ोकस|ठीक वहीं पड़ना चाहिए।" },
    // pathway
    paTitle: { en: "Visual pathway", hi: "देखने का रास्ता" }, paLine: { en: "Place a lesion, see the field each eye loses", hi: "कहीं नुकसान रखें, देखें हर आँख का कौन-सा field जाता है" },
    side: { en: "Side of the lesion", hi: "नुकसान किस ओर" }, sideL: { en: "Left", hi: "बायाँ" }, sideR: { en: "Right", hi: "दायाँ" },
    site: { en: "Where is the lesion?", hi: "नुकसान कहाँ है?" }, noLesion: { en: "No lesion", hi: "कोई नुकसान नहीं" },
    leftEye: { en: "Left eye", hi: "बाईं आँख" }, rightEye: { en: "Right eye", hi: "दाईं आँख" },
    fieldKey: { en: "Visual fields drawn as the patient sees them. Blue: the left half of the visual field (the left side of everything the patient sees). Amber: the right half. Black: lost.", hi: "दृष्टि क्षेत्र (visual field) वैसे बने हैं जैसे मरीज़ देखता है। नीला: दृष्टि क्षेत्र का बायाँ आधा (मरीज़ जो देखता है उसका बायाँ हिस्सा)। पीला: दायाँ आधा। काला: गया हुआ हिस्सा।" },
    pathCap: { en: "Seen from above, left eye on the left. Blue fibres carry the left half of the visual field, amber fibres the right half. Tap a spot on the pathway.", hi: "ऊपर से देखा चित्र, बाईं आँख बाईं ओर। नीले तंतु दृष्टि क्षेत्र (visual field) का बायाँ आधा ले जाते हैं, पीले तंतु दायाँ आधा। रास्ते पर किसी जगह को छुएँ।" },
    chiasmMid: { en: "The chiasm sits in the middle, so it has no side.", hi: "काइज़्मा बीच में है, इसलिए इसकी कोई ओर नहीं।" },
    cause: { en: "Common cause", hi: "आम कारण" }, whyH: { en: "Why", hi: "क्यों" },
    // pupil
    puTitle: { en: "Pupil pathway", hi: "पुतली का रास्ता" }, puLine: { en: "Swing a light, find the damaged path", hi: "रोशनी घुमाएँ, टूटा रास्ता ढूँढें" },
    cond: { en: "Patient", hi: "मरीज़" }, cNormal: { en: "Normal", hi: "सामान्य" }, cRapd: { en: "Afferent defect", hi: "Afferent कमी" }, cCn3: { en: "Third nerve palsy", hi: "तीसरी नस का लकवा" }, cHorner: { en: "Horner syndrome", hi: "Horner syndrome" },
    affSide: { en: "Affected eye", hi: "प्रभावित आँख" },
    light: { en: "Torch", hi: "टॉर्च" }, onRight: { en: "Right eye", hi: "दाईं आँख" }, onLeft: { en: "Left eye", hi: "बाईं आँख" }, off: { en: "Off", hi: "बंद" },
    swing: { en: "Swing to the other eye", hi: "दूसरी आँख पर घुमाएँ" },
    room: { en: "Room", hi: "कमरा" }, bright: { en: "Lit", hi: "रोशनी" }, dark: { en: "Dark", hi: "अंधेरा" },
    pupMm: { en: "{e}: {v} mm", hi: "{e}: {v} mm" },
    pupLive: { en: "Torch {l}. Right pupil {r} mm, left pupil {x} mm.", hi: "टॉर्च {l}। दाईं पुतली {r} mm, बाईं पुतली {x} mm।" },
    faceCap: { en: "You face the patient: their right eye is on your left.", hi: "आप मरीज़ के सामने हैं: उसकी दाईं आँख आपकी बाईं ओर है।" },
    lidHeld: { en: "The drooping lid is held up so you can see the pupil.", hi: "झुकी पलक को ऊपर पकड़ा है ताकि पुतली दिखे।" },
    reflexPath: { en: "Light reflex (makes the pupil small)", hi: "Light reflex (पुतली छोटी करता है)" },
    symPath: { en: "Sympathetic path (makes the pupil large)", hi: "Sympathetic रास्ता (पुतली बड़ी करता है)" },
    nRetina: { en: "Retina and optic nerve (afferent, in)", hi: "रेटिना और ऑप्टिक नर्व (afferent, अंदर)" }, nMid: { en: "Pretectal and Edinger-Westphal nuclei (midbrain), both sides", hi: "प्रीटेक्टल और एडिंगर-वेस्टफ़ाल न्यूक्लियस (pretectal and Edinger-Westphal nuclei, midbrain), दोनों ओर" },
    nCn3: { en: "Oculomotor (third) nerve, ciliary ganglion, short ciliary nerves (efferent, out)", hi: "ऑक्युलोमोटर (oculomotor, तीसरी) नस, सिलियरी गैंग्लियन, शॉर्ट सिलियरी नसें (efferent, बाहर)" }, nSph: { en: "Iris sphincter: pupil small", hi: "आइरिस स्फ़िंक्टर (sphincter pupillae): पुतली छोटी" },
    nHyp: { en: "Hypothalamus", hi: "हाइपोथैलेमस (hypothalamus)" }, nChain: { en: "Spinal cord (C8 to T2), lung apex, superior cervical ganglion", hi: "रीढ़ की हड्डी (spinal cord, C8 से T2), फेफड़े का ऊपरी सिरा (lung apex), सुपीरियर सर्वाइकल गैंग्लियन (superior cervical ganglion)" }, nDil: { en: "Iris dilator and Müller muscle: pupil large, lid lifted", hi: "आइरिस डाइलेटर और म्यूलर मांसपेशी (iris dilator, Müller muscle): पुतली बड़ी, पलक ऊपर" },
    damaged: { en: "damaged on the {s}", hi: "{s} ओर टूटा" }, rightW: { en: "right", hi: "दाईं" }, leftW: { en: "left", hi: "बाईं" },
    swingTip: { en: "Swinging flashlight test: move the light from eye to eye every 2 to 3 seconds and watch the lit pupil.", hi: "Swinging flashlight test: हर 2 से 3 सेकंड में रोशनी एक आँख से दूसरी पर ले जाएँ और रोशनी वाली पुतली देखें।" },
    // tours
    toTitle: { en: "Guided tours", hi: "गाइडेड टूर" }, toLine: { en: "Read a real fundus photo and optical coherence tomography (OCT) scan step by step", hi: "असली fundus photo और ऑप्टिकल कोहेरेंस टोमोग्राफ़ी (optical coherence tomography, OCT) स्कैन को कदम-दर-कदम पढ़ें" },
    tFundus: { en: "Fundus photo", hi: "Fundus photo" }, tOct: { en: "Macular OCT (optical coherence tomography)", hi: "Macular OCT (optical coherence tomography)" },
    stepOf: { en: "Step {i} of {n}", hi: "कदम {i} / {n}" }, tourDone: { en: "Tour done", hi: "टूर पूरा" }
  };
  function L() { return I.lang(); }
  function s(k, v) { return esc(D.t(STR[k], L())).replace(/\{(\w)\}/g, function (m, x) { return v && v[x] != null ? String(v[x]) : m; }); }
  function raw(k) { return D.t(STR[k], L()); }
  function tx(obj) { var h = esc(D.t(obj, L())); return L() === "hi" && obj && !obj.hi ? '<span lang="en">' + h + "</span>" : h; }
  function T(en, hi) { return { en: en, hi: hi }; }
  // Signed dioptres with the true minus sign and an explicit plus (docs/DESIGN.md numbers rule).
  function sd(v) { v = Math.round(v * 100) / 100; return (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toFixed(2); }
  function reduced() { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function $(id) { return G.document.getElementById(id); }
  function mediaUrl(file) { return BASE + "learn/media/" + file; }
  function LW() { return (O._learn && O._learn._w) || {}; }

  /* ---------- the five explorers ---------- */
  // lesson: the matching Learn lesson; test: where Test yourself goes (a clinic, the question bank topic, or a simulator).
  var LIST = [
    { id: "anatomy", title: "anTitle", line: "anLine", thumb: "photos/slit-lamp-diffuse.webp", lesson: "start-parts", test: { mcqTopic: "fundamentals" } },
    { id: "focus", title: "foTitle", line: "foLine", thumb: "photos/sim-myopia.webp", lesson: "start-seeing", test: { mcqTopic: "optics" } },
    { id: "pathway", title: "paTitle", line: "paLine", thumb: "illustrations/visual-pathway.svg", lesson: "start-seeing", test: { mcqTopic: "neuro" } },
    { id: "pupil", title: "puTitle", line: "puLine", thumb: "photos/external-eye-anterior.webp", lesson: "start-parts", test: { sim: "neuro" } },
    { id: "tours", title: "toTitle", line: "toLine", thumb: "photos/fundus-normal.webp", lesson: "fundus-tour", test: { clinic: "dr" } }
  ];
  var BY = {}; LIST.forEach(function (x) { BY[x.id] = x; });
  var EX = { id: null, an: { view: "section", sel: null, quiz: null, cur: -1 }, fo: null, pa: { site: "chiasm", side: "L" },
    pu: { cond: "rapd", side: "R", light: null, room: "light", cur: null, raf: 0 }, to: { which: "fundus", i: 0 }, svg: {} };

  function exploredMap() { if (!st.store.explore) st.store.explore = {}; return st.store.explore; }
  // An explorer counts as explored after its first real interaction (a part named, the eye changed, a lesion placed,
  // the light moved, a tour step taken): store.explore[id] = the day.
  function mark(id) { var m = exploredMap(); if (!m[id]) { m[id] = I.today(); I.save(); } }

  /* ---------- Learn home section ---------- */
  function homeHtml() {
    var m = exploredMap(), d = LIST.filter(function (x) { return m[x.id]; }).length;
    return '<section class="ex-home" aria-labelledby="exHomeH"><div class="ln-unit-h ex-home-h"><h2 class="oph-h2" id="exHomeH">' + s("explore") + '</h2><span class="oph-small">' +
      s("nExplored", { d: I.fmt(d), n: I.fmt(LIST.length) }) + '</span></div><ul class="oph-clinics ex-rows">' + LIST.map(function (x) {
        var done = !!m[x.id];
        return '<li><button class="oph-clinic ex-row" data-act="exopen" data-x="' + x.id + '"><span class="ex-thumb" aria-hidden="true"><img src="' + esc(mediaUrl(x.thumb)) +
          '" alt="" width="56" height="56" loading="lazy" decoding="async"></span><span class="oph-clinic-b"><b>' + s(x.title) + "</b><span>" + s(x.line) + "</span>" +
          (done ? '<span class="oph-small ex-done">' + ico("check") + s("explored") + "</span>" : '<span class="oph-sr">' + s("notYet") + "</span>") +
          '</span><span class="oph-chev" aria-hidden="true">' + ico("chev") + "</span></button></li>";
      }).join("") + "</ul></section>";
  }

  /* ---------- frame ---------- */
  function langBtn() {
    var hi = L() === "hi";
    return '<button class="ln-lang" data-act="lnlang" aria-label="' + s("langSwitch") + '"><span lang="' + (hi ? "en" : "hi") + '">' + (hi ? "English" : "हिन्दी") + "</span></button>";
  }
  function paint(id, body, focusSel) {
    var x = BY[id], prev = $("exScroll"), keep = prev && EX.painted === id ? prev.scrollTop : 0; // a repaint keeps the place
    st.view = "explore"; EX.id = id;
    st.onBack = null;
    LW().again = function (f) { open(id, f); }; // the language pill repaints this explorer in place
    I.paint(I.top(raw("backLearn"), s(x.title), s(x.line), langBtn()) +
      '<div class="oph-scroll oph-pad" id="exScroll"><div class="ex-wrap" data-x="' + id + '">' + body + endHtml(x) +
      "</div></div>", focusSel);
    if (L() === "hi") $("smdOphthalmos").setAttribute("lang", "hi");
    var sc = $("exScroll");
    EX.painted = id; sc.scrollTop = keep;
    sc.addEventListener("input", onInput);
    sc.addEventListener("change", onInput);
  }
  function endHtml(x) {
    var lid = lessonFor(x), les = O._learn && O._learn.meta(lid), t = testOf(x), bank = bankFor(t), tr = t.clinic && I.track(t.clinic);
    var what = t.sim ? s("testNeuro") : tr ? s("testClinic", { c: esc(tr.clinic) }) : bank ? s("testBank", { t: esc(bankTopic(t.mcqTopic)) }) : "";
    return '<section class="ex-end" aria-labelledby="exEndH"><h2 class="ln-h" id="exEndH">' + s("keepGoing") + "</h2>" +
      (what ? '<button class="oph-btn pri oph-wide" data-act="extest">' + ico("target") + " " + s("testYourself") + '</button><p class="oph-small">' + what + "</p>" : "") +
      (les ? '<button class="oph-btn sec oph-wide" data-act="lesson" data-l="' + esc(lid) + '">' + ico("book") + " " + s("lessonL", { t: tx(les.title) }) + "</button>" : "") +
      "</section>";
  }
  function testOf(x) {
    if (x.id === "tours" && EX.to.which === "oct") return { clinic: "oct", classes: ["NO", "DME"] };
    return x.test;
  }
  function bankFor(t) { var b = null; if (t && t.mcqTopic) (O._banks || []).forEach(function (x) { if (x.topic) b = x; }); return b; }
  var TOPICS = { fundamentals: T("anatomy and physiology", "anatomy और physiology"), optics: T("optics and refraction", "optics और refraction"), neuro: T("neuro-ophthalmology", "neuro-ophthalmology") };
  function bankTopic(k) { return D.t(TOPICS[k] || T(k, k), L()); }
  function lessonFor(x) { return x.id === "tours" && EX.to.which === "oct" ? "retina-macula" : x.lesson; }

  function open(id, focusSel) {
    if (!BY[id]) return;
    if (EX.id !== id) I.leave();
    EX.id = id;
    st.onLeave = stopAll;
    if (id === "anatomy") return anatomy(focusSel);
    if (id === "focus") return focusView(focusSel);
    if (id === "pathway") return pathway(focusSel);
    if (id === "pupil") return pupil(focusSel);
    return tours(focusSel);
  }
  function stopAll() { if (EX.pu.raf) { G.cancelAnimationFrame(EX.pu.raf); EX.pu.raf = 0; } EX.id = null; EX.painted = null; }
  // Replace one region and put the focus back on the same control (by selector), so a tap never loses the place.
  function region(id, html, focusSel) {
    var el = $(id); if (!el) return;
    el.innerHTML = html;
    if (focusSel) { var f = el.querySelector(focusSel); try { if (f) f.focus({ preventScroll: true }); } catch (e) {} }
  }
  function seg(label, act, cur, opts, cls) {
    return '<div class="oph-seg ex-seg' + (cls ? " " + cls : "") + '" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button data-act="' + act + '" data-v="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + "</button>";
    }).join("") + "</div>";
  }
  function svgText(file) {
    var c = EX.svg[file];
    if (c) return c;
    c = EX.svg[file] = G.fetch(mediaUrl(file)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
    c.then(null, function () { delete EX.svg[file]; });
    return c;
  }

  /* ================= 1. Eye anatomy ================= */
  var PARTS = {
    cornea: [T("Cornea", "कॉर्निया (cornea)"), T("The clear front window. It does most of the focusing of light.", "आगे की साफ़ खिड़की। रोशनी को सबसे ज़्यादा यही मोड़ती है।")],
    sclera: [T("Sclera", "स्क्लेरा (sclera)"), T("The tough white outer coat that keeps the eye's shape.", "मज़बूत सफ़ेद बाहरी परत जो आँख का आकार बनाए रखती है।")],
    conjunctiva: [T("Conjunctiva", "कंजंक्टिवा (conjunctiva)"), T("A thin clear skin over the white of the eye and inside the lids. Inflamed, it makes a red eye.", "आँख के सफ़ेद हिस्से और पलकों के अंदर की पतली साफ़ झिल्ली। इसमें सूजन से आँख लाल होती है।")],
    limbus: [T("Limbus", "लिम्बस (limbus)"), T("The ring where the cornea meets the sclera. Stem cells here renew the corneal surface.", "वह घेरा जहाँ कॉर्निया और स्क्लेरा मिलते हैं। यहाँ की stem cells कॉर्निया की सतह को नया करती हैं।")],
    "anterior-chamber": [T("Anterior chamber", "आगे का कक्ष (anterior chamber)"), T("The space between cornea and iris, filled with clear watery aqueous.", "कॉर्निया और आइरिस के बीच की जगह, जिसमें साफ़ पानी जैसा aqueous भरा है।")],
    "posterior-chamber": [T("Posterior chamber", "पीछे का कक्ष (posterior chamber)"), T("The narrow space behind the iris, where aqueous is made.", "आइरिस के पीछे की पतली जगह, जहाँ aqueous बनता है।")],
    "trabecular-meshwork": [T("Trabecular meshwork", "ट्रैबेक्युलर मेशवर्क (trabecular meshwork)"), T("The drain in the angle. If aqueous cannot leave, eye pressure rises (glaucoma).", "कोने (angle) में बनी नाली। aqueous बाहर न निकले तो आँख का दबाव बढ़ता है (ग्लूकोमा)।")],
    "ciliary-body": [T("Ciliary body", "सिलियरी बॉडी (ciliary body)"), T("Makes aqueous, and its muscle changes the lens shape to focus near.", "aqueous बनाती है, और इसकी मांसपेशी पास देखने के लिए लेंस का आकार बदलती है।")],
    zonules: [T("Zonules", "ज़ोन्यूल्स (zonules)"), T("Fine fibres that hang the lens from the ciliary body.", "बारीक धागे जो लेंस को सिलियरी बॉडी से टाँगे रखते हैं।")],
    lens: [T("Lens", "लेंस (lens)"), T("Clear and flexible; it fine-tunes the focus for near and far. Cloudy, it is a cataract.", "साफ़ और लचीला; पास और दूर के लिए फ़ोकस ठीक करता है। धुंधला हो जाए तो मोतियाबिंद (cataract)।")],
    iris: [T("Iris", "आइरिस (iris)"), T("The coloured ring. Its muscles make the pupil smaller or larger.", "रंगीन घेरा। इसकी मांसपेशियाँ पुतली को छोटा या बड़ा करती हैं।")],
    pupil: [T("Pupil", "पुतली (pupil)"), T("The hole in the iris that lets light in. It gets smaller in bright light.", "आइरिस के बीच का छेद जिससे रोशनी अंदर जाती है। तेज़ रोशनी में छोटा हो जाता है।")],
    vitreous: [T("Vitreous", "विट्रियस (vitreous)"), T("Clear jelly that fills most of the eye behind the lens.", "साफ़ जेली जो लेंस के पीछे आँख का ज़्यादातर हिस्सा भरती है।")],
    retina: [T("Retina", "रेटिना (retina)"), T("The light-sensing layer lining the back of the eye. It turns light into nerve signals.", "आँख के पीछे बिछी रोशनी पकड़ने वाली परत। यह रोशनी को नस के संकेतों में बदलती है।")],
    choroid: [T("Choroid", "कोरॉइड (choroid)"), T("A layer full of blood vessels that feeds the outer retina.", "खून की नलियों से भरी परत जो रेटिना के बाहरी हिस्से को पोषण देती है।")],
    macula: [T("Macula", "मैक्युला (macula)"), T("The centre of the retina, for fine detail and colour.", "रेटिना का बीच का हिस्सा, बारीक चीज़ें और रंग देखने के लिए।")],
    fovea: [T("Fovea", "फ़ोविया (fovea)"), T("The pit in the middle of the macula: the sharpest point of vision.", "मैक्युला के बीच का गड्ढा: सबसे साफ़ देखने वाली जगह।")],
    "optic-disc": [T("Optic disc", "ऑप्टिक डिस्क (optic disc)"), T("Where the nerve fibres leave the eye. It has no light cells, so it makes the blind spot.", "जहाँ नस के तंतु आँख से बाहर निकलते हैं। यहाँ रोशनी पकड़ने वाली कोशिकाएँ नहीं, इसलिए blind spot बनता है।")],
    "optic-nerve": [T("Optic nerve", "ऑप्टिक नर्व (optic nerve)"), T("It carries the nerve fibres (ganglion cell axons) from the whole retina of its own eye, nasal and temporal, to the optic chiasm.", "यह अपनी आँख के पूरे रेटिना, नेज़ल (nasal) और टेम्पोरल (temporal) दोनों हिस्सों, के तंतु (ganglion cell axons) ऑप्टिक कियाज़्म (optic chiasm) तक ले जाती है।")],
    "central-retinal-vessels": [T("Central retinal artery and vein", "सेंट्रल रेटिनल आर्टरी और वेन"), T("They run inside the optic nerve and branch over the inner retina.", "ये ऑप्टिक नर्व के अंदर चलकर रेटिना की अंदरूनी सतह पर फैलती हैं।")],
    "dural-sheath": [T("Optic nerve sheath", "ऑप्टिक नर्व का आवरण (sheath)"), T("The meninges (dura, arachnoid and pia) continue around the optic nerve; raised intracranial pressure swells the disc (papilloedema).", "दिमाग की झिल्लियाँ (meninges: dura, arachnoid, pia) ऑप्टिक नर्व को भी घेरती हैं; खोपड़ी के अंदर का दबाव (intracranial pressure) बढ़ने पर डिस्क सूज जाती है (papilloedema)।")],
    lid: [T("Eyelid", "पलक (eyelid)"), T("Protects the eye and spreads the tears with every blink.", "आँख की रक्षा करती है और हर झपक में आँसू फैलाती है।")],
    vessel: [T("Conjunctival vessel", "कंजंक्टिवा की नली"), T("Fine surface vessels. They swell and redden in conjunctivitis.", "सतह की बारीक नलियाँ। conjunctivitis में ये फूलकर लाल हो जाती हैं।")],
    "retinal-vessels": [T("Retinal arteries and veins", "रेटिना की आर्टरी और वेन"), T("Arteries are thinner and brighter red; veins are wider and darker.", "आर्टरी पतली और ज़्यादा चमकीली लाल; वेन चौड़ी और गहरी।")],
    background: [T("Healthy background", "स्वस्थ पृष्ठभूमि"), T("An even orange-red: the choroid glowing through a clear retina.", "एक-सा नारंगी-लाल रंग: साफ़ रेटिना के पार चमकता कोरॉइड।")]
  };
  // Order of the part list and of arrow-key travel on the section, front to back.
  var XS_ORDER = ["cornea", "conjunctiva", "limbus", "anterior-chamber", "iris", "pupil", "trabecular-meshwork", "posterior-chamber", "ciliary-body", "zonules",
    "lens", "vitreous", "retina", "choroid", "sclera", "macula", "fovea", "optic-disc", "central-retinal-vessels", "optic-nerve", "dural-sheath"];
  // Parts big enough to find with a finger on a phone.
  var QUIZ_POOL = ["cornea", "iris", "lens", "ciliary-body", "anterior-chamber", "vitreous", "retina", "choroid", "sclera", "optic-nerve", "macula", "optic-disc"];
  // Photo views: real images from the library, points placed on each picture.
  var PHOTOS = {
    front: { m: "external-eye-anterior", pts: [["iris", 0.25, 0.42], ["pupil", 0.47, 0.5], ["cornea", 0.66, 0.24], ["limbus", 0.07, 0.62], ["sclera", 0.93, 0.44], ["lid", 0.34, 0.07]] },
    slit: { m: "slit-lamp-diffuse", pts: [["pupil", 0.505, 0.49], ["iris", 0.37, 0.38], ["limbus", 0.745, 0.5], ["sclera", 0.22, 0.62], ["vessel", 0.125, 0.47], ["lid", 0.5, 0.25]] },
    fundus: { m: "fundus-normal", pts: [["optic-disc", 0.16, 0.45], ["fovea", 0.5, 0.49], ["macula", 0.61, 0.6], ["retinal-vessels", 0.35, 0.2], ["background", 0.82, 0.74]] }
  };
  function pname(id) { return PARTS[id] ? D.t(PARTS[id][0], L()) : id; }
  // inside an English sentence the name is lower case ("Tap the optic disc"); Hindi names keep their form
  function pin(id) { var n = pname(id); return L() === "en" ? n.charAt(0).toLowerCase() + n.slice(1) : n; }

  function anatomy(focusSel) {
    var a = EX.an, v = a.view;
    var stage = v === "section" ? '<div class="ex-fig ex-xs' + (a.sel || a.cur >= 0 ? " sel" : "") + '" id="exXs" data-act="expick" tabindex="0" role="application" aria-label="' + s("diagram") + '" style="aspect-ratio:1200 / 800"><p class="oph-mut ex-load" role="status">' + s("loading") + "</p></div>" : photoHtml(v);
    paint("anatomy", '<div class="ex-grid"><div class="ex-stage">' +
      seg(raw("views"), "exview", v, [["section", s("vSection")], ["front", s("vFront")], ["slit", s("vSlit")], ["fundus", s("vFundus")]], "ex-full") +
      '<figure class="ex-figwrap">' + stage + (v === "section" ? "" : '<figcaption class="ex-cap">' + creditOf(W().media && W().media[PHOTOS[v].m]) + "</figcaption>") + "</figure></div>" +
      '<div class="ex-panel" id="exPanel">' + anPanel() + "</div></div>", focusSel || ".oph-back");
    if (v === "section") loadSection();
  }
  function W() { return LW(); }
  function photoHtml(v) {
    var p = PHOTOS[v], m = W().media && W().media[p.m], a = EX.an;
    var w = m ? m.w : 1600, h = m ? m.h : 1200, file = m ? m.file : "photos/" + p.m + ".webp";
    return '<div class="ln-pic ex-photo" style="aspect-ratio:' + w + " / " + h + ";width:min(100%, calc(52vh * " + (w / h).toFixed(4) + '))">' +
      '<img src="' + esc(mediaUrl(file)) + '" alt="' + esc(m ? D.t(m.alt, L()) : "") + '" width="' + w + '" height="' + h + '" decoding="async" class="ex-photo-img">' +
      p.pts.map(function (q, i) {
        var on = a.sel === q[0] && a.pt === i, side = q[1] < 0.34 ? "l" : q[1] > 0.66 ? "r" : "c";
        return '<button class="ln-hot" data-act="exhot" data-k="' + i + '" data-side="' + side + '"' + (q[2] > 0.72 ? " data-up" : "") + (on ? " data-named" : "") +
          ' style="left:' + (q[1] * 100).toFixed(2) + "%;top:" + (q[2] * 100).toFixed(2) + '%" aria-pressed="' + on + '" aria-label="' + s("point", { n: i + 1 }) + (on ? ": " + esc(pname(q[0])) : "") + '">' +
          '<span class="ln-dot" aria-hidden="true">' + (i + 1) + '</span><span class="ln-chip" aria-hidden="true"' + (on ? "" : " hidden") + ">" + esc(pname(q[0])) + "</span></button>";
      }).join("") + "</div>";
  }
  // Credit as the licence asks (same wording as the lesson figures); originals name MAIKNOWLEDGE LLP.
  function creditOf(m) {
    if (!m) return "";
    var c = D.mediaCredit(m), parts = [];
    function a(u, t) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + "</a>"; }
    if (c.by) parts.push(esc(c.by));
    parts.push(c.licenceUrl ? a(c.licenceUrl, c.licence) : esc(c.licence));
    if (c.source) parts.push(a(c.source, /commons\.wikimedia\.org/.test(c.source) ? "Wikimedia Commons" : "Source") + (c.adapted ? ", adapted" : ""));
    return tx(m.caption) + ' <span class="oph-credit" lang="en">' + parts.join(" · ") + "</span>";
  }
  function anPanel() {
    var a = EX.an, q = a.quiz;
    if (q) return quizHtml();
    var info = a.sel ? "<h2>" + esc(pname(a.sel)) + "</h2><p>" + tx(PARTS[a.sel][1]) + "</p>" : '<p class="oph-mut">' + s(a.view === "section" ? "anHint" : "anHintPhoto") + "</p>";
    var sec = a.view === "section";
    return '<div class="ex-info" id="exInfo" aria-live="polite">' + info + "</div>" +
      (sec ? '<h2 class="ex-h3" id="exPartsH">' + s("parts") + '</h2><div class="ex-chips" role="group" aria-labelledby="exPartsH">' + XS_ORDER.map(function (id) {
        return '<button data-act="expart" data-p="' + id + '" aria-pressed="' + (a.sel === id) + '">' + esc(pname(id)) + "</button>";
      }).join("") + "</div>" +
      '<button class="oph-btn sec oph-wide ex-quizbtn" data-act="exquiz">' + ico("target") + " " + s("quizStart") + "</button>" : "");
  }
  function quizHtml() {
    var q = EX.an.quiz, n = q.list.length;
    if (q.i >= n) {
      return '<div class="ex-info ex-quiz" aria-live="polite"><p class="oph-verdict ' + (q.right * 2 >= n ? "ok" : "bad") + '">' + ico(q.right * 2 >= n ? "check" : "info") + "<span>" + s("quizDone", { r: q.right, n: n }) + "</span></p></div>" +
        '<div class="ex-row2"><button class="oph-btn pri" data-act="exquiz">' + s("again") + '</button><button class="oph-btn sec" data-act="exquizstop">' + s("quizStop") + "</button></div>";
    }
    var t = q.list[q.i], ans = q.ans;
    var fb = ans ? '<p class="oph-verdict ' + (ans.ok ? "ok" : "bad") + '">' + ico(ans.ok ? "check" : "close") + "<span>" +
      (ans.ok ? s("right", { x: esc(pin(t)) }) : s("wrong", { x: esc(pin(t)), y: esc(pin(ans.pick)) })) + "</span></p>" : "";
    return '<div class="ex-info ex-quiz"><p class="oph-small">' + s("quizOf", { i: q.i + 1, n: n, r: q.right }) + '</p><h2 id="exQ">' + s("quizQ", { x: esc(pin(t)) }) + "</h2>" +
      '<div aria-live="polite" id="exQfb">' + fb + '</div><p class="oph-small ex-keys">' + s("quizKeys") + "</p></div>" +
      '<div class="ex-row2">' + (ans ? '<button class="oph-btn pri" data-act="exqnext">' + s("next") + "</button>" : "<span></span>") +
      '<button class="oph-btn sec" data-act="exquizstop">' + s("quizStop") + "</button></div>";
  }
  function loadSection() {
    var file = "illustrations/eye-cross-section.svg";
    svgText(file).then(function (t) {
      var el = $("exXs");
      if (!el || EX.an.view !== "section") return;
      el.innerHTML = D.scopeSvg(t, "exs");
      Array.prototype.forEach.call(el.querySelectorAll("svg g[id]"), function (g) {
        var id = g.id.replace(/^exs-/, "");
        if (PARTS[id] || id === "visual-axis") g.setAttribute("data-part", id);
      });
      paintSel();
    }, function () {
      var el = $("exXs");
      if (el) el.innerHTML = '<p class="ln-imgerr">' + s("imgErr") + '</p><button class="oph-btn sec" data-act="exretry">' + ico("refresh") + " " + s("retry") + "</button>";
    });
  }
  // Light the selected (or keyboard-highlighted) part; every other part dims.
  function paintSel() {
    var el = $("exXs"), a = EX.an, on = a.cur >= 0 ? XS_ORDER[a.cur] : a.flash || (a.quiz ? null : a.sel);
    if (!el) return;
    el.classList.toggle("sel", !!on);
    Array.prototype.forEach.call(el.querySelectorAll("[data-part]"), function (g) { g.classList.toggle("on", g.getAttribute("data-part") === on); });
  }
  function selectPart(id, focusSel) {
    var a = EX.an;
    if (!PARTS[id]) return;
    if (a.quiz) return answerQuiz(id);
    a.sel = id; a.cur = -1;
    mark("anatomy");
    paintSel();
    region("exPanel", anPanel(), focusSel);
    I.haptic("tap");
  }
  function startQuiz() {
    var pool = QUIZ_POOL.slice(), list = [];
    while (list.length < 5) list.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    EX.an.quiz = { list: list, i: 0, right: 0, ans: null };
    EX.an.sel = null; EX.an.cur = -1; EX.an.flash = null;
    paintSel();
    region("exPanel", anPanel());
    try { $("exXs").focus({ preventScroll: true }); } catch (e) {}
  }
  // A thin layer is hard to hit with a finger: a tap within about 12 px of the asked part counts.
  function near(x, y, want) {
    var d = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [12, 12], [-12, 12], [12, -12], [-12, -12], [14, 0], [-14, 0], [0, 14], [0, -14]];
    for (var i = 0; i < d.length; i++) {
      var e = G.document.elementFromPoint(x + d[i][0], y + d[i][1]), g = e && e.closest && e.closest("[data-part]");
      if (g && g.getAttribute("data-part") === want) return true;
    }
    return false;
  }
  function answerQuiz(pick, ok) {
    var q = EX.an.quiz;
    if (!q || q.ans || q.i >= q.list.length) return;
    var t = q.list[q.i];
    ok = ok || pick === t;
    q.ans = { ok: ok, pick: pick };
    if (ok) q.right++;
    EX.an.flash = t; EX.an.cur = -1;
    mark("anatomy");
    paintSel();
    I.haptic(ok ? "success" : "error");
    region("exPanel", anPanel(), "[data-act=exqnext]");
  }
  function nextQuiz() {
    var q = EX.an.quiz;
    q.i++; q.ans = null; EX.an.flash = null;
    paintSel();
    region("exPanel", anPanel(), q.i >= q.list.length ? ".oph-btn.pri" : null);
    if (q.i < q.list.length) try { $("exXs").focus({ preventScroll: true }); } catch (e) {}
  }
  A.expick = function (b, e) {
    var g = e && e.target && e.target.closest && e.target.closest("[data-part]"), id = g && g.getAttribute("data-part");
    var q = EX.an.quiz;
    if (q && !q.ans && q.i < q.list.length) {
      var want = q.list[q.i];
      if (id === want || (e && e.clientX != null && near(e.clientX, e.clientY, want))) return answerQuiz(want, true);
      if (id && PARTS[id]) return answerQuiz(id);
      return;
    }
    if (id && id !== "visual-axis") selectPart(id);
  };
  A.expart = function (b) { selectPart(b.getAttribute("data-p"), '[data-p="' + b.getAttribute("data-p") + '"]'); };
  A.exview = function (b) { EX.an.view = b.getAttribute("data-v"); EX.an.sel = null; EX.an.pt = null; EX.an.quiz = null; EX.an.cur = -1; EX.an.flash = null; anatomy('[data-act=exview][data-v="' + EX.an.view + '"]'); };
  A.exhot = function (b) {
    var i = +b.getAttribute("data-k"), p = PHOTOS[EX.an.view].pts[i], a = EX.an;
    var off = a.sel === p[0] && a.pt === i;
    a.sel = off ? null : p[0]; a.pt = off ? null : i;
    mark("anatomy");
    Array.prototype.forEach.call(G.document.querySelectorAll(".ex-photo .ln-hot"), function (h) {
      var k = +h.getAttribute("data-k"), on = k === a.pt;
      h.querySelector(".ln-chip").hidden = !on;
      h.toggleAttribute("data-named", on);
      h.setAttribute("aria-pressed", String(on));
      h.setAttribute("aria-label", D.t(STR.point, L()).replace("{n}", k + 1) + (on ? ": " + pname(PHOTOS[a.view].pts[k][0]) : ""));
    });
    region("exPanel", anPanel());
    I.haptic("tap");
  };
  A.exquiz = startQuiz;
  A.exquizstop = function () { EX.an.quiz = null; EX.an.flash = null; EX.an.cur = -1; paintSel(); region("exPanel", anPanel(), "[data-act=exquiz]"); };
  A.exqnext = nextQuiz;
  A.exretry = function () { anatomy(); };
  function anKey(e) {
    var a = EX.an, inXs = e.target && e.target.id === "exXs";
    if (!inXs || a.view !== "section") return;
    var n = XS_ORDER.length, k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowUp") {
      e.preventDefault();
      var base = a.cur >= 0 ? a.cur : a.sel ? XS_ORDER.indexOf(a.sel) : -1, d = k === "ArrowRight" || k === "ArrowDown" ? 1 : -1;
      if (a.quiz && a.quiz.ans) return;
      a.cur = (base + d + n) % n;
      if (!a.quiz) { a.sel = XS_ORDER[a.cur]; mark("anatomy"); region("exPanel", anPanel()); }
      else { var live = $("exQfb"); if (live) live.textContent = D.t(STR.highlighted, L()).replace("{i}", a.cur + 1).replace("{n}", n); }
      paintSel();
    } else if ((k === "Enter" || k === " ") && a.quiz && !a.quiz.ans && a.cur >= 0) {
      e.preventDefault();
      answerQuiz(XS_ORDER[a.cur]);
    }
  }

  /* ================= 2. How the eye focuses ================= */
  var PRESETS = {
    normal: { len: 23.5, cyl: 0, ax: 180, age: 20, near: false },
    myopia: { len: 25.5, cyl: 0, ax: 180, age: 20, near: false },
    hyper: { len: 21.5, cyl: 0, ax: 180, age: 30, near: true },
    astig: { len: 23.5, cyl: -2, ax: 180, age: 25, near: false },
    presby: { len: 23.5, cyl: 0, ax: 180, age: 55, near: true }
  };
  function foState() {
    if (!EX.fo) EX.fo = { p: "myopia", len: 25.5, cyl: 0, ax: 180, age: 20, near: false, show: "chart", wear: false };
    return EX.fo;
  }
  function foCalc() {
    var o = foState(), f0 = X.focus({ len: o.len, cyl: o.cyl, ax: o.ax, age: o.age, near: o.near, lens: null }), lens = null;
    if (o.wear) lens = { s: f0.rx.s + (o.near ? f0.add : 0), c: f0.rx.c, ax: f0.rx.ax };
    var f = lens ? X.focus({ len: o.len, cyl: o.cyl, ax: o.ax, age: o.age, near: o.near, lens: lens }) : f0;
    return { o: o, f0: f0, f: f, lens: lens };
  }
  function range(k, label, min, max, step, val, out) {
    return '<label class="ex-ctl"><span class="ex-ctl-h"><b>' + label + '</b><output id="exOut_' + k + '">' + out + "</output></span>" +
      '<input type="range" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" aria-valuetext="' + esc(out.replace(/<[^>]+>/g, "")) + '"></label>';
  }
  function cylOut(v) { return s("dpt", { v: v ? MINUS + Math.abs(v).toFixed(2) : "0.00" }); }
  function focusView(focusSel) {
    var o = foState();
    paint("focus", '<div class="ex-grid"><div class="ex-stage">' +
      '<figure class="ex-figwrap"><div class="ex-fig ex-ray" id="exRay"></div><figcaption class="ex-cap" id="exRayCap"></figcaption></figure>' +
      '<figure class="ex-figwrap"><div class="ex-fig ex-pic" id="exPic"></div></figure>' +
      '<div class="ex-read" id="exRead"></div></div>' +
      '<div class="ex-panel">' +
      '<h2 class="ex-h3" id="exPreH">' + s("preset") + '</h2><div class="ex-chips" role="group" aria-labelledby="exPreH">' +
      [["normal", "pNormal"], ["myopia", "pMyopia"], ["hyper", "pHyper"], ["astig", "pAstig"], ["presby", "pPresby"]].map(function (p) {
        return '<button data-act="expreset" data-v="' + p[0] + '" aria-pressed="' + (o.p === p[0]) + '">' + s(p[1]) + "</button>";
      }).join("") + "</div>" +
      range("len", s("len"), 21, 26.5, 0.5, o.len, s("mm", { v: o.len.toFixed(1) })) +
      range("cyl", s("cyl"), 0, 3, 0.5, -o.cyl, cylOut(o.cyl)) +
      '<div class="ex-ctlrow"><span class="oph-small" id="exAxL">' + s("axis") + "</span>" + seg(raw("axis"), "exax", o.ax, [[180, s("axV")], [90, s("axH")]]) + "</div>" +
      range("age", s("age"), 10, 70, 5, o.age, s("years", { v: o.age })) +
      '<div class="ex-ctlrow"><span class="oph-small">' + s("look") + "</span>" + seg(raw("look"), "exnear", o.near ? 1 : 0, [[0, s("far")], [1, s("near")]]) + "</div>" +
      '<div class="ex-ctlrow"><span class="oph-small">' + s("show") + "</span>" + seg(raw("show"), "exshow", o.show, [["chart", s("chart")], ["scene", s("scene")], ["fundus", s("fundus")]]) + "</div>" +
      '<button class="oph-btn ' + (o.wear ? "pri" : "sec") + ' oph-wide ex-wear" data-act="exwear" aria-pressed="' + o.wear + '">' + ico("check") + " " + s("wear") + "</button>" +
      '<p class="ex-explain" id="exExplain" aria-live="polite"></p></div></div>', focusSel);
    drawFocus(true);
  }
  var liveT = 0;
  function drawFocus(now) {
    var c = foCalc(), o = c.o, f = c.f;
    region("exRay", raySvg(c));
    region("exRayCap", s("notScale") + (Math.abs(f.ev - f.eh) >= 0.25 || o.cyl ? " " + s("solidDashed") : ""));
    drawPic(c);
    var where = function (e) { return Math.abs(e) < 0.25 ? s("onR") : e < 0 ? s("frontR") : s("behindR"); };
    var fl = Math.abs(f.ev - f.eh) >= 0.25 ? s("vRays", { x: where(f.ev) }) + ", " + s("hRays", { x: where(f.eh) }) : where((f.ev + f.eh) / 2);
    var rx = c.f0.rx, gl = [];
    if (rx.s) gl.push(s("sph", { v: sd(rx.s) }));
    if (rx.c) gl.push(s("cylAx", { v: sd(rx.c), a: rx.ax }));
    if (!gl.length) gl.push(s("noGlasses"));
    if (c.f0.add > 0) gl.push(s("add", { v: sd(c.f0.add) }));
    region("exRead", '<p><span class="oph-small">' + s("focusAt") + "</span><b>" + fl + "</b></p>" +
      '<p><span class="oph-small">' + s("glasses") + "</span><b>" + gl.join(", ") + "</b></p>");
    var k = f.kind === "clear" ? (c.lens ? "kClearGl" : "kClear") : { myopia: "kMyopia", hyperopia: "kHyper", astig: "kAstig", presby: "kPresby" }[f.kind];
    var txt = s(k) + (f.acc >= 0.5 ? " " + s("lensWork", { v: sd(f.acc) }) : "");
    // the spoken line waits until the slider rests, so dragging does not read out every step
    G.clearTimeout(liveT);
    if (now) region("exExplain", txt);
    else liveT = G.setTimeout(function () { region("exExplain", txt); }, 350);
  }
  // Side view: parallel (far) or diverging (near) rays refract at the cornea and lens and meet at the computed focus.
  function raySvg(c) {
    var o = c.o, f = c.f, MM = 6.2, cx = 100, y0 = 90, xr = cx + o.len * MM, GAIN = 3;
    var ex = (cx + xr) / 2, rx = (xr - cx) / 2, ry = 66, lensX = cx + 22, lensRx = 6 + Math.min(8, f.acc * 1.1);
    function fx(e) { return xr + Math.max(-95, Math.min(70, e / X.D_PER_MM * MM * GAIN)); }
    function rays(e, offs, cls) {
      var xf = fx(e);
      return offs.map(function (d) {
        var x0 = o.near ? 18 : 0, ys = o.near ? y0 + d * 0.25 : y0 + d, pts = [x0 + "," + ys, (cx + 2) + "," + (y0 + d)];
        var p1x = lensX, p1y = y0 + d * 0.96, dx = xf - p1x, dy = y0 - p1y;
        pts.push(p1x + "," + p1y);
        var out = '<polyline class="' + cls + '" points="' + pts.join(" ") + " ";
        if (xf <= xr) { var t = (xr - 2 - p1x) / dx; out += (p1x + dx * t).toFixed(1) + "," + (p1y + dy * t).toFixed(1) + '"/>'; }
        else {
          var t2 = (xr - p1x) / dx, rx2 = xr, ry2 = p1y + dy * t2;
          out += rx2.toFixed(1) + "," + ry2.toFixed(1) + '"/><line class="' + cls + ' ghost" x1="' + rx2.toFixed(1) + '" y1="' + ry2.toFixed(1) + '" x2="' + xf.toFixed(1) + '" y2="' + y0 + '"/>';
        }
        return out;
      }).join("");
    }
    var astig = Math.abs(f.ev - f.eh) >= 0.25;
    var fv = fx(f.ev), fh = fx(f.eh), okV = Math.abs(f.ev) < 0.25, okH = Math.abs(f.eh) < 0.25;
    var glass = c.lens ? (c.lens.s + (c.lens.c || 0) / 2 < 0
      ? '<path class="ex-glass" d="M62 50 Q70 90 62 130 L78 130 Q70 90 78 50 Z"/>'
      : '<path class="ex-glass" d="M70 50 Q60 90 70 130 Q80 90 70 50 Z"/>') : "";
    return '<svg viewBox="0 0 380 180" aria-hidden="true" focusable="false">' +
      '<ellipse class="ex-ball" cx="' + ex + '" cy="' + y0 + '" rx="' + rx + '" ry="' + ry + '"/>' +
      '<path class="ex-retina" d="' + arc(ex, y0, rx, ry, -58, 58) + '"/>' +
      '<path class="ex-cornea" d="M' + (cx + 6) + " " + (y0 - 34) + " Q" + (cx - 12) + " " + y0 + " " + (cx + 6) + " " + (y0 + 34) + '"/>' +
      '<line class="ex-irisl" x1="' + (lensX - 3) + '" y1="' + (y0 - 40) + '" x2="' + (lensX - 3) + '" y2="' + (y0 - 22) + '"/><line class="ex-irisl" x1="' + (lensX - 3) + '" y1="' + (y0 + 22) + '" x2="' + (lensX - 3) + '" y2="' + (y0 + 40) + '"/>' +
      '<ellipse class="ex-lensb" cx="' + (lensX + 4) + '" cy="' + y0 + '" rx="' + lensRx.toFixed(1) + '" ry="22"/>' + glass +
      rays(f.ev, [-20, -10, 10, 20], "ex-rayv") + (astig ? rays(f.eh, [-15, 15], "ex-rayh") : "") +
      '<circle class="ex-fdot ' + (okV ? "ok" : "off") + '" cx="' + fv.toFixed(1) + '" cy="' + y0 + '" r="4"/>' +
      (astig ? '<circle class="ex-fdot h ' + (okH ? "ok" : "off") + '" cx="' + fh.toFixed(1) + '" cy="' + y0 + '" r="4"/>' : "") +
      (o.near ? '<rect class="ex-target" x="10" y="' + (y0 - 9) + '" width="6" height="18" rx="1"/>' : "") + "</svg>";
  }
  function arc(cx, cy, rx, ry, a0, a1) {
    var p = [], i, a;
    for (i = 0; i <= 12; i++) { a = (a0 + (a1 - a0) * i / 12) * Math.PI / 180; p.push((cx + rx * Math.cos(a)).toFixed(1) + " " + (cy + ry * Math.sin(a)).toFixed(1)); }
    return "M" + p.join(" L");
  }
  // What the patient sees: the chosen picture blurred by the computed defocus, per meridian (SVG feGaussianBlur x y).
  var PICS = { scene: ["photos/sim-normal.webp", 1600, 1333], fundus: ["photos/fundus-normal.webp", 1411, 1411] };
  function drawPic(c) {
    var o = c.o, b = X.blur(c.f), el = $("exPic"), p = PICS[o.show], h = p ? Math.round(400 * p[2] / p[1]) : 240;
    if (!el) return;
    var key = o.show + (o.near ? "n" : "f") + L();
    if (el.getAttribute("data-k") !== key) {
      var body;
      var paper = "";
      if (p) body = '<image href="' + esc(mediaUrl(p[0])) + '" x="0" y="0" width="400" height="' + h + '" preserveAspectRatio="xMidYMid slice"/>';
      else if (!o.near) body = [["E", 70, 64], ["F P", 124, 40], ["T O Z", 166, 28], ["L P E D", 198, 20], ["P E C F D", 222, 14]].map(function (r) {
        return '<text x="200" y="' + r[1] + '" font-size="' + r[2] + '" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600" letter-spacing="' + (r[2] * 0.25).toFixed(1) + '" fill="#141414">' + r[0] + "</text>";
      }).join("");
      else body = raw("chartText").split("|").map(function (line, i) {
        return '<text x="24" y="' + (92 + i * 34) + '" font-size="21" font-family="Inter, \'Noto Sans Devanagari\', system-ui, sans-serif" fill="#141414">' + esc(line) + "</text>";
      }).join("");
      el.innerHTML = '<svg viewBox="0 0 400 ' + h + '" role="img" aria-label="' + esc(raw("show")) + '"><defs><filter id="exBl" x="-5%" y="-5%" width="110%" height="110%">' +
        '<feGaussianBlur id="exBlF" edgeMode="duplicate" stdDeviation="0 0"/></filter><clipPath id="exClip"><rect width="400" height="' + h + '"/></clipPath></defs>' +
        // the paper stays put; only what is printed on it (or the photo) blurs
        '<g clip-path="url(#exClip)">' + (p ? "" : '<rect width="400" height="240" fill="#f4f1ea"/>') + '<g filter="url(#exBl)">' + body + "</g></g></svg>";
      el.setAttribute("data-k", key);
    }
    $("exBlF").setAttribute("stdDeviation", b.x.toFixed(2) + " " + b.y.toFixed(2));
  }
  function onInput(e) {
    var k = e.target && e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k || EX.id !== "focus") return;
    var o = foState(), v = +e.target.value;
    if (k === "len") o.len = v;
    else if (k === "cyl") o.cyl = v ? -v : 0;
    else if (k === "age") o.age = v;
    o.p = null; o.wear = false;
    mark("focus");
    var out = k === "len" ? s("mm", { v: v.toFixed(1) }) : k === "cyl" ? cylOut(o.cyl) : s("years", { v: v });
    region("exOut_" + k, out);
    e.target.setAttribute("aria-valuetext", out);
    Array.prototype.forEach.call(G.document.querySelectorAll("[data-act=expreset]"), function (b) { b.setAttribute("aria-pressed", "false"); });
    wearBtn();
    drawFocus(false);
  }
  function wearBtn() {
    var b = G.document.querySelector("[data-act=exwear]"), on = foState().wear;
    if (!b) return;
    b.setAttribute("aria-pressed", String(on));
    b.className = "oph-btn " + (on ? "pri" : "sec") + " oph-wide ex-wear";
  }
  A.expreset = function (b) {
    var v = b.getAttribute("data-v"), p = PRESETS[v], o = foState();
    for (var k in p) o[k] = p[k];
    o.p = v; o.wear = false;
    mark("focus");
    focusView('[data-act=expreset][data-v="' + v + '"]');
  };
  A.exax = function (b) { var o = foState(); o.ax = +b.getAttribute("data-v"); o.p = null; o.wear = false; mark("focus"); focusView('[data-act=exax][data-v="' + o.ax + '"]'); };
  A.exnear = function (b) { var o = foState(); o.near = b.getAttribute("data-v") === "1"; o.wear = false; mark("focus"); focusView('[data-act=exnear][data-v="' + (o.near ? 1 : 0) + '"]'); };
  A.exshow = function (b) { var o = foState(); o.show = b.getAttribute("data-v"); focusView('[data-act=exshow][data-v="' + o.show + '"]'); };
  A.exwear = function () { var o = foState(); o.wear = !o.wear; mark("focus"); wearBtn(); drawFocus(true); };

  /* ================= 3. Visual pathway ================= */
  var SITE_T = {
    nerve: T("Optic nerve", "ऑप्टिक नर्व (optic nerve)"), chiasm: T("Optic chiasm", "ऑप्टिक काइज़्मा (chiasm)"), tract: T("Optic tract", "ऑप्टिक ट्रैक्ट (optic tract)"),
    lgn: T("Lateral geniculate nucleus (LGN)", "लैटरल जेनिकुलेट न्यूक्लियस (lateral geniculate nucleus, LGN)"), meyer: T("Meyer loop (inferior optic radiation, temporal lobe)", "मेयर लूप (Meyer loop: ऑप्टिक रेडिएशन के निचले तंतु, टेम्पोरल लोब)"),
    parietal: T("Superior optic radiation, parietal lobe", "ऑप्टिक रेडिएशन के ऊपरी तंतु (superior optic radiation), पैराइटल लोब"), occipital: T("Occipital cortex", "ऑक्सिपिटल कॉर्टेक्स (occipital cortex)"),
    sparing: T("Occipital cortex, pole spared", "ऑक्सिपिटल कॉर्टेक्स, सिरा बचा (macular sparing)")
  };
  var SIDE_W = { R: T("Right", "दाईं ओर की"), L: T("Left", "बाईं ओर की") };
  var DEFECT = {
    normal: T("Full fields", "पूरे field, कोई कमी नहीं"),
    mono: T("{S} eye blind (monocular loss)", "{S} आँख में पूरा अंधापन (monocular loss)"),
    bitemporal: T("Bitemporal hemianopia", "Bitemporal hemianopia (दोनों आँखों का बाहरी आधा गया)"),
    hemianopia: T("{S} homonymous hemianopia", "{S} homonymous hemianopia"),
    supQuad: T("{S} superior quadrantanopia (“pie in the sky”)", "{S} ऊपरी quadrantanopia (“pie in the sky”)"),
    infQuad: T("{S} inferior quadrantanopia (“pie on the floor”)", "{S} निचली quadrantanopia (“pie on the floor”)"),
    hemianopiaSparing: T("{S} homonymous hemianopia with macular sparing", "{S} homonymous hemianopia, मैक्युला बची (macular sparing)")
  };
  var MONO_S = { R: T("Right", "दाईं"), L: T("Left", "बाईं") };
  var EYE_T = {
    none: T("sees the whole field", "पूरा field दिखता है"), all: T("sees nothing", "कुछ नहीं दिखता"),
    temporalHalf: T("loses the outer (temporal) half", "बाहरी (temporal) आधा गया"), nasalHalf: T("loses the inner (nasal) half", "अंदरूनी (nasal) आधा गया"),
    temporalUpper: T("loses the upper outer quarter", "ऊपर का बाहरी चौथाई गया"), nasalUpper: T("loses the upper inner quarter", "ऊपर का अंदरूनी चौथाई गया"),
    temporalLower: T("loses the lower outer quarter", "नीचे का बाहरी चौथाई गया"), nasalLower: T("loses the lower inner quarter", "नीचे का अंदरूनी चौथाई गया")
  };
  var SPARED = T(", but keeps the centre", ", पर बीच का हिस्सा बचा");
  var CAUSE = {
    nerve: T("Optic neuritis, ischaemic optic neuropathy, or injury to one optic nerve.", "एक ऑप्टिक नर्व में सूजन (optic neuritis), खून की कमी (ischaemic optic neuropathy) या चोट।"),
    chiasm: T("A pituitary tumour pressing up on the chiasm from below.", "पिट्यूटरी ट्यूमर जो नीचे से काइज़्मा को दबाता है।"),
    tract: T("A stroke, tumour or injury just behind the chiasm. Tract lesions are often incongruous, with a relative afferent pupillary defect (RAPD) in the eye that loses its temporal field.", "काइज़्मा के ठीक पीछे stroke, ट्यूमर या चोट। ट्रैक्ट की चोट में कमी अक्सर दोनों आँखों में बराबर नहीं होती, और जिस आँख का बाहरी (temporal) आधा जाता है उसमें रिलेटिव एफ़ेरेंट प्यूपिलरी डिफ़ेक्ट (relative afferent pupillary defect, RAPD) होता है।"),
    lgn: T("A small stroke in the thalamus, where the lateral geniculate nucleus lies. It is supplied by the anterior choroidal artery and the lateral posterior choroidal artery.", "थैलेमस में छोटा stroke, जहाँ लैटरल जेनिकुलेट न्यूक्लियस है। इसे anterior choroidal artery और lateral posterior choroidal artery से खून मिलता है।"),
    meyer: T("A temporal lobe tumour, abscess or surgery.", "टेम्पोरल लोब में ट्यूमर, abscess या ऑपरेशन।"),
    parietal: T("A parietal lobe stroke (middle cerebral artery) or tumour.", "पैराइटल लोब में stroke (middle cerebral artery) या ट्यूमर।"),
    occipital: T("A posterior cerebral artery stroke or a head injury.", "Posterior cerebral artery का stroke या सिर की चोट।"),
    sparing: T("A posterior cerebral artery stroke. The occipital pole, where the macula is represented, is often also supplied by branches of the middle cerebral artery, so the central field survives (macular sparing).", "Posterior cerebral artery का stroke। ऑक्सिपिटल पोल (occipital pole), जहाँ मैक्युला का हिस्सा है, को अक्सर middle cerebral artery की शाखाओं से भी खून मिलता है, इसलिए बीच का दृष्टि क्षेत्र बच जाता है (macular sparing)।")
  };
  var WHY = {
    normal: T("Pick a place on the pathway to see which part of the field it carries.", "रास्ते पर कोई जगह चुनें और देखें वह field का कौन-सा हिस्सा ले जाती है।"),
    mono: T("Each optic nerve carries both the nasal and the temporal fibres of its own eye. Damage there causes loss of the entire visual field of that eye.", "हर ऑप्टिक नर्व अपनी आँख के नेज़ल (nasal) और टेम्पोरल (temporal) दोनों तरह के तंतु ले जाती है। वहाँ नुकसान से उस आँख का पूरा दृष्टि क्षेत्र (visual field) चला जाता है।"),
    bitemporal: T("At the chiasm the fibres from the nasal half of each retina cross. They carry the outer (temporal) half of the visual field, so the outer half is lost in each eye.", "काइज़्मा पर हर रेटिना के नेज़ल (nasal) आधे के तंतु क्रॉस करते हैं। ये दृष्टि क्षेत्र (visual field) का बाहरी (temporal) आधा ले जाते हैं, इसलिए हर आँख का बाहरी आधा चला जाता है।"),
    hemianopia: T("Behind the chiasm each side carries the opposite half of the visual field from both eyes: its own temporal fibres and the other eye's crossed nasal fibres. So the same half is lost in both eyes.", "काइज़्मा के पीछे हर ओर दोनों आँखों से दृष्टि क्षेत्र (visual field) का उलटा आधा जाता है: अपनी आँख के टेम्पोरल तंतु और दूसरी आँख के पार किए नेज़ल तंतु। इसलिए दोनों आँखों में एक ही आधा जाता है।"),
    hemianopiaSparing: T("Behind the chiasm each side carries the opposite half of the visual field from both eyes. The occipital pole, where the macula is represented, is spared, so the central field is kept.", "काइज़्मा के पीछे हर ओर दोनों आँखों से दृष्टि क्षेत्र (visual field) का उलटा आधा जाता है। ऑक्सिपिटल पोल (occipital pole), जहाँ मैक्युला का हिस्सा है, बचा रहता है, इसलिए बीच का दृष्टि क्षेत्र बचता है।"),
    supQuad: T("The Meyer loop, the inferior fibres of the optic radiation, loops forward through the temporal lobe and carries the upper field. So only the upper quarter on the opposite side is lost (\u201cpie in the sky\u201d).", "मेयर लूप (Meyer loop), यानी ऑप्टिक रेडिएशन के निचले तंतु, टेम्पोरल लोब में आगे मुड़ते हैं और ऊपर का दृष्टि क्षेत्र ले जाते हैं। इसलिए उलटी ओर का सिर्फ़ ऊपरी चौथाई जाता है (\u201cpie in the sky\u201d)।"),
    infQuad: T("The superior fibres of the optic radiation run through the parietal lobe and carry the lower field. So only the lower quarter on the opposite side is lost (\u201cpie on the floor\u201d).", "ऑप्टिक रेडिएशन के ऊपरी तंतु पैराइटल लोब से गुज़रते हैं और नीचे का दृष्टि क्षेत्र ले जाते हैं। इसलिए उलटी ओर का सिर्फ़ निचला चौथाई जाता है (\u201cpie on the floor\u201d)।")
  };
  // Lesion spots on the schematic (left side; the right side mirrors at x = 320 - x). Sparing shares the occipital spot.
  var SPOT = { nerve: [124, 66], chiasm: [160, 95], tract: [133, 124], lgn: [114, 156], meyer: [69, 194], parietal: [107, 208], occipital: [112, 268], sparing: [112, 268] };
  function spot(site, side) { var p = SPOT[site]; return site === "chiasm" || side === "L" ? p : [320 - p[0], p[1]]; }
  function defectName(res) {
    var d = D.t(DEFECT[res.key], L()), w = res.key === "mono" ? MONO_S[res.hemi] : SIDE_W[res.hemi];
    return esc(d.replace("{S}", w ? D.t(w, L()) : ""));
  }
  function chart(res, eye) {
    var c = 50, r = 46, e = res.eyes[eye];
    var sp = e.spare ? '<path d="M' + c + " " + (c - r * e.spare) + " A" + r * e.spare + " " + r * e.spare + " 0 0 0 " + c + " " + (c + r * e.spare) + 'Z" class="ex-fl"/>' +
      '<path d="M' + c + " " + (c - r * e.spare) + " A" + r * e.spare + " " + r * e.spare + " 0 0 1 " + c + " " + (c + r * e.spare) + 'Z" class="ex-fr"/>' : "";
    return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path class="ex-fl" d="M50 4 A46 46 0 0 0 50 96Z"/><path class="ex-fr" d="M50 4 A46 46 0 0 1 50 96Z"/>' +
      X.lostPaths(res, eye, c, c, r).map(function (d) { return '<path class="ex-flost" d="' + d + '"/>'; }).join("") + sp +
      '<circle class="ex-frim" cx="50" cy="50" r="46"/><path class="ex-fx" d="M50 4V96M4 50H96"/><circle class="ex-ffix" cx="50" cy="50" r="2"/></svg>';
  }
  function pathway(focusSel) {
    var p = EX.pa;
    paint("pathway", '<div class="ex-grid"><div class="ex-stage">' +
      '<div id="exFields" aria-live="polite">' + fieldsHtml() + "</div>" +
      '<figure class="ex-figwrap"><div class="ex-fig ex-path" id="exPath">' + pathSvg() + "</div>" +
      '<figcaption class="ex-cap">' + s("pathCap") + "</figcaption></figure></div>" +
      '<div class="ex-panel" id="exPaPanel">' + paPanel() + "</div></div>", focusSel);
  }
  function fieldsHtml() {
    var p = EX.pa, res = X.field(p.site, p.side);
    function eyeLine(e) { var k = X.eyeLoss(res, e); return tx(EYE_T[k]) + (res.eyes[e].spare && k !== "none" ? tx(SPARED) : ""); }
    return '<div class="ex-fields"><figure>' + chart(res, "L") + "<figcaption><b>" + s("leftEye") + "</b><span>" + eyeLine("L") + "</span></figcaption></figure>" +
      "<figure>" + chart(res, "R") + "<figcaption><b>" + s("rightEye") + "</b><span>" + eyeLine("R") + "</span></figcaption></figure></div>" +
      '<div class="ex-info ex-defect"><h2>' + defectName(res) + "</h2>" +
      (p.site ? '<p><span class="oph-small">' + s("cause") + "</span> " + tx(CAUSE[p.site]) + "</p>" : "") +
      '<p><span class="oph-small">' + s("whyH") + "</span> " + tx(WHY[res.key === "normal" ? "normal" : res.key]) + "</p></div>" +
      '<p class="oph-small ex-key">' + s("fieldKey") + "</p>";
  }
  function paPanel() {
    var p = EX.pa;
    return '<div class="ex-ctlrow"><span class="oph-small">' + s("side") + "</span>" + (p.site === "chiasm" ? '<span class="oph-small ex-mid">' + s("chiasmMid") + "</span>" :
      seg(raw("side"), "exside", p.side, [["L", s("sideL")], ["R", s("sideR")]])) + "</div>" +
      '<h2 class="ex-h3" id="exSiteH">' + s("site") + '</h2><div class="ex-sites" role="group" aria-labelledby="exSiteH">' +
      X.SITES.map(function (id) { return '<button data-act="exsite" data-v="' + id + '" aria-pressed="' + (p.site === id) + '">' + tx(SITE_T[id]) + "</button>"; }).join("") +
      '<button data-act="exsite" data-v="" aria-pressed="' + !p.site + '">' + s("noLesion") + "</button></div>";
  }
  // The pathway, drawn as geometry: fibres coloured by the half of vision they carry, the lesion at its site.
  function pathSvg() {
    var p = EX.pa, spotsL = [], mk = "";
    function m(x) { return 320 - x; }
    function fib(pts, cls) { return '<polyline class="' + cls + '" points="' + pts.map(function (q) { return q.join(","); }).join(" ") + '"/>'; }
    function rad(sd) {
      var f = sd === "L" ? function (x) { return x; } : m;
      return '<path class="' + (sd === "L" ? "ex-pb" : "ex-pa") + '" d="M' + f(110) + ",162 C" + f(60) + ",166 " + f(52) + ",214 " + f(108) + ',252"/>' +
        '<path class="' + (sd === "L" ? "ex-pb" : "ex-pa") + '" d="M' + f(116) + ",162 C" + f(104) + ",194 " + f(104) + ",224 " + f(112) + ',252"/>' +
        '<path class="ex-cortex" d="M' + f(88) + ",262 Q" + f(114) + ",282 " + f(140) + ',262"/>' +
        '<ellipse class="ex-lgn" cx="' + f(114) + '" cy="156" rx="12" ry="8"/>';
    }
    if (p.site) {
      var q = spot(p.site, p.side);
      mk = '<g class="ex-lesion" transform="translate(' + q[0] + " " + q[1] + ')"><circle r="11"/><path d="M-6 -6L6 6M6 -6L-6 6"/></g>';
    }
    // tap targets over the schematic (pointer shortcut; the site list is the keyboard and screen-reader path)
    X.SITES.forEach(function (id) {
      if (id === "sparing") return;
      (id === "chiasm" ? ["L"] : ["L", "R"]).forEach(function (sd) {
        var q = spot(id, sd);
        spotsL.push('<button class="ex-spot" tabindex="-1" aria-hidden="true" data-act="exspot" data-v="' + id + '" data-s="' + sd + '" style="left:' + (q[0] / 3.2).toFixed(2) + "%;top:" + (q[1] / 2.9).toFixed(2) + '%"></button>');
      });
    });
    return '<svg viewBox="0 0 320 290" aria-hidden="true" focusable="false">' +
      '<circle class="ex-eye" cx="95" cy="26" r="15"/><circle class="ex-eye" cx="225" cy="26" r="15"/>' +
      fib([[84, 38], [150, 92], [116, 150]], "ex-pb") + fib([[216, 40], [160, 95], [114, 150]], "ex-pb") +
      fib([[236, 38], [170, 92], [204, 150]], "ex-pa") + fib([[104, 40], [160, 95], [206, 150]], "ex-pa") +
      rad("L") + rad("R") + mk + "</svg>" + spotsL.join("");
  }
  function setSite(site, side, focusSel) {
    var p = EX.pa;
    p.site = site || null;
    if (side) p.side = side;
    mark("pathway");
    region("exFields", fieldsHtml());
    region("exPath", pathSvg());
    region("exPaPanel", paPanel(), focusSel);
    I.haptic("tap");
  }
  A.exsite = function (b) { var v = b.getAttribute("data-v"); setSite(v, null, '[data-act=exsite][data-v="' + v + '"]'); };
  A.exspot = function (b) { setSite(b.getAttribute("data-v"), b.getAttribute("data-s")); };
  A.exside = function (b) { setSite(EX.pa.site, b.getAttribute("data-v"), '[data-act=exside][data-v="' + b.getAttribute("data-v") + '"]'); };

  /* ================= 4. Pupil pathway ================= */
  var COND = { normal: null, rapd: "rapd", cn3: "cn3", horner: "horner" };
  var PU_TXT = {
    normal: { see: T("Light in either eye makes both pupils constrict equally: the signal reaches both sides of the midbrain.", "किसी भी आँख में रोशनी से दोनों पुतलियाँ बराबर छोटी होती हैं: संकेत midbrain की दोनों ओर पहुँचता है।"),
      why: T("Each optic nerve feeds the pretectal nuclei on both sides of the midbrain. Each pretectal nucleus signals both Edinger-Westphal nuclei, which send the command along the oculomotor (third) nerve and the short ciliary nerves to the iris sphincter.", "हर ऑप्टिक नर्व midbrain की दोनों ओर के प्रीटेक्टल न्यूक्लियस (pretectal nucleus) तक संकेत देती है। हर प्रीटेक्टल न्यूक्लियस दोनों एडिंगर-वेस्टफ़ाल न्यूक्लियस (Edinger-Westphal nucleus) को संकेत देता है, जो ऑक्युलोमोटर (oculomotor, तीसरी) नस और शॉर्ट सिलियरी नसों (short ciliary nerves) से आइरिस स्फ़िंक्टर को आदेश भेजते हैं।") },
    rapd: { hit: T("Light swung onto the {s} eye from the healthy eye: both pupils dilate. The damaged {s} optic nerve carries a weaker signal than the other eye did.", "स्वस्थ आँख से रोशनी {s} आँख पर लाने पर दोनों पुतलियाँ फैलती हैं। ख़राब {s} ऑप्टिक नर्व दूसरी आँख से कमज़ोर संकेत ले जाती है।"),
      miss: T("Light on the healthy eye: both pupils constrict well.", "स्वस्थ आँख पर रोशनी: दोनों पुतलियाँ अच्छी तरह छोटी होती हैं।"),
      off: T("The pupils are equal, because both get the same command from the midbrain. Swing the light to find the defect.", "पुतलियाँ बराबर हैं, क्योंकि दोनों को midbrain से एक ही आदेश मिलता है। कमी ढूँढने के लिए रोशनी घुमाएँ।"),
      why: T("An afferent (incoming) defect: the pupils stay equal; only how strongly each eye's light drives them differs. This is a relative afferent pupillary defect (RAPD).", "Afferent (अंदर आने वाली) कमी: पुतलियाँ बराबर रहती हैं; बस हर आँख की रोशनी का असर अलग है। इसे relative afferent pupillary defect (RAPD) कहते हैं।") },
    cn3: { see: T("The {s} pupil stays large whatever the light, while the other pupil constricts to light in either eye.", "{s} पुतली रोशनी चाहे जहाँ हो, बड़ी ही रहती है; दूसरी पुतली किसी भी आँख की रोशनी से छोटी होती है।"),
      why: T("An efferent (outgoing) defect: the {s} eye still sees the light, but the oculomotor (third) nerve is damaged. Its parasympathetic fibres reach the iris sphincter through the ciliary ganglion and the short ciliary nerves. A painful third nerve palsy with a big pupil is an emergency: think of a posterior communicating artery aneurysm.", "Efferent (बाहर जाने वाली) कमी: {s} आँख रोशनी देखती है, पर ऑक्युलोमोटर (oculomotor, तीसरी) नस टूटी है। इसके parasympathetic तंतु सिलियरी गैंग्लियन और शॉर्ट सिलियरी नसों (short ciliary nerves) से आइरिस स्फ़िंक्टर तक जाते हैं। दर्द के साथ तीसरी नस का लकवा और बड़ी पुतली इमरजेंसी है: posterior communicating artery aneurysm सोचें।") },
    horner: { see: T("The {s} pupil is smaller, more so in the dark, and its lid droops a little (the Müller muscle is weak). Both pupils still constrict to light.", "{s} पुतली छोटी है, अंधेरे में और भी, और उसकी पलक थोड़ी झुकी है (म्यूलर मांसपेशी, Müller muscle, कमज़ोर है)। दोनों पुतलियाँ रोशनी से अब भी छोटी होती हैं।"),
      why: T("The iris dilator muscle has lost its sympathetic supply. It is a chain of three neurons: from the hypothalamus down the spinal cord to C8 to T2, then over the lung apex to the superior cervical ganglion, then up along the internal carotid artery to the eye. Damage anywhere on it gives Horner syndrome.", "आइरिस डाइलेटर मांसपेशी की sympathetic नस टूटी है। यह तीन neurons की कड़ी है: हाइपोथैलेमस से रीढ़ की हड्डी में C8 से T2 तक, फिर फेफड़े के ऊपरी सिरे (lung apex) के ऊपर से सुपीरियर सर्वाइकल गैंग्लियन तक, फिर internal carotid artery के साथ ऊपर आँख तक। इस रास्ते में कहीं भी नुकसान से Horner syndrome होता है।") }
  };
  function puModel() {
    var u = EX.pu, c = COND[u.cond];
    return c ? N.build(N.BY[c].lesion, u.side) : N.normal();
  }
  function puTarget(P) { var u = EX.pu; return N.pupils(P, { room: u.room === "dark" ? "dark" : "light", light: u.light }); }
  function pupil(focusSel) {
    var u = EX.pu;
    u.P = puModel();
    u.cur = puTarget(u.P);
    paint("pupil", '<div class="ex-grid"><div class="ex-stage">' +
      '<figure class="ex-figwrap"><div class="ex-fig ex-face" id="exFace"></div><figcaption class="ex-cap">' + s("faceCap") + '<span id="exLidCap"></span></figcaption></figure>' +
      '<p class="ex-mmrow" id="exMm" aria-hidden="true"></p><p class="oph-sr" id="exPuLive" aria-live="polite"></p></div>' +
      '<div class="ex-panel"><div class="ex-panel" id="exPuPanel">' + puPanel() + '</div><div id="exFlow"></div></div></div>', focusSel);
    puDraw(); puTexts(); puLoop(); puLive();   // announce the pupil sizes on first open too
  }
  function puPanel() {
    var u = EX.pu;
    return '<div class="ex-ctlrow"><span class="oph-small">' + s("cond") + "</span>" + seg(raw("cond"), "excond", u.cond, [["normal", s("cNormal")], ["rapd", s("cRapd")], ["cn3", s("cCn3")], ["horner", s("cHorner")]], "ex-full") + "</div>" +
      (u.cond === "normal" ? "" : '<div class="ex-ctlrow"><span class="oph-small">' + s("affSide") + "</span>" + seg(raw("affSide"), "exaff", u.side, [["R", s("onRight")], ["L", s("onLeft")]]) + "</div>") +
      '<div class="ex-ctlrow"><span class="oph-small">' + s("light") + "</span>" + seg(raw("light"), "exlight", u.light || "", [["R", s("onRight")], ["", s("off")], ["L", s("onLeft")]], "ex-full") + "</div>" +
      '<button class="oph-btn pri oph-wide" data-act="exswing">' + s("swing") + "</button>" +
      '<div class="ex-ctlrow"><span class="oph-small">' + s("room") + "</span>" + seg(raw("room"), "exroom", u.room, [["light", s("bright")], ["dark", s("dark")]]) + "</div>" +
      '<div class="ex-info" id="exPuTxt" aria-live="polite"></div><p class="oph-small">' + s("swingTip") + "</p>";
  }
  function side(sd) { return raw(sd === "L" ? "leftW" : "rightW"); }
  function puTexts() {
    var u = EX.pu, t = PU_TXT[u.cond], sw = side(u.side), see;
    if (u.cond === "rapd") see = !u.light ? t.off : u.light === u.side ? t.hit : t.miss;
    else see = t.see;
    region("exPuTxt", "<p>" + tx(see).replace(/\{s\}/g, esc(sw)) + '</p><p><span class="oph-small">' + s("whyH") + "</span> " + tx(t.why).replace(/\{s\}/g, esc(sw)) + "</p>");
    region("exLidCap", u.cond === "cn3" ? " " + s("lidHeld") : "");
    region("exFlow", flowHtml());
  }
  function flowHtml() {
    var u = EX.pu, bad = u.cond === "normal" ? null : u.cond, dmg = '<em class="ex-dmg">' + ico("close") + s("damaged", { s: esc(side(u.side)) }) + "</em>";
    function node(k, broken) { return '<li class="' + (broken ? "bad" : "") + '"><span>' + s(k) + "</span>" + (broken ? dmg : "") + "</li>"; }
    return '<div class="ex-flow"><h2 class="ex-h3">' + s("reflexPath") + "</h2><ol>" + node("nRetina", bad === "rapd") + node("nMid") + node("nCn3", bad === "cn3") + node("nSph") + "</ol>" +
      '<h2 class="ex-h3">' + s("symPath") + "</h2><ol>" + node("nHyp") + node("nChain", bad === "horner") + node("nDil") + "</ol></div>";
  }
  // The patient's face: right eye on the viewer's left. Pupil radius from the model (mm), lids from its MRD1.
  function puDraw() {
    var u = EX.pu, el = $("exFace"), lids = N.lids(u.P), K5 = 5;
    if (!el) return;
    function eye(e, cx) {
      var d = u.cur[e], cy = 70, mrd = u.cond === "cn3" ? Math.max(3, lids[e].mrd1) : lids[e].mrd1, lidY = cy - mrd * K5 - 4, lit = u.light === e;
      var alm = "M" + (cx - 62) + " " + cy + " Q" + cx + " " + (cy - 58) + " " + (cx + 62) + " " + cy + " Q" + cx + " " + (cy + 50) + " " + (cx - 62) + " " + cy + "Z";
      return '<clipPath id="exAlm' + e + '"><path d="' + alm + '"/></clipPath><g><path class="ex-sclera" d="' + alm + '"/><g clip-path="url(#exAlm' + e + ')">' +
        '<circle class="ex-irisc" cx="' + cx + '" cy="' + cy + '" r="30"/><circle class="ex-pupc" cx="' + cx + '" cy="' + cy + '" r="' + (d / 2 * K5).toFixed(2) + '"/>' +
        (lit ? '<circle class="ex-glint" cx="' + (cx + 5) + '" cy="' + (cy - 6) + '" r="3"/>' : "") + "</g>" +
        // the upper lid's margin dips to lidY at the centre (a quadratic's apex is halfway to its control point)
        '<path class="ex-lid" d="M' + (cx - 70) + " " + (cy - 70) + " L" + (cx + 70) + " " + (cy - 70) + " L" + (cx + 70) + " " + cy + " Q" + cx + " " + (2 * lidY - cy) + " " + (cx - 70) + " " + cy + 'Z"/>' +
        '<path class="ex-lidm" d="M' + (cx - 62) + " " + cy + " Q" + cx + " " + (2 * lidY - cy) + " " + (cx + 62) + " " + cy + '"/>' +
        (lit ? '<path class="ex-beam" d="M' + (cx - 8) + " 150 L" + (cx - 26) + " " + (cy + 8) + " L" + (cx + 26) + " " + (cy + 8) + " L" + (cx + 8) + ' 150Z"/>' : "") + "</g>";
    }
    el.innerHTML = '<svg viewBox="0 0 360 150" aria-hidden="true" focusable="false"><rect class="ex-skin" width="360" height="150"/>' + eye("R", 96) + eye("L", 264) + "</svg>";
    region("exMm", '<span>' + s("pupMm", { e: s("rightEye"), v: u.cur.R.toFixed(1) }) + "</span><span>" + s("pupMm", { e: s("leftEye"), v: u.cur.L.toFixed(1) }) + "</span>");
  }
  function puLive() {
    var u = EX.pu, t = puTarget(u.P), el = $("exPuLive");
    if (el) el.textContent = D.t(STR.pupLive, L()).replace("{l}", u.light ? D.t(STR[u.light === "R" ? "onRight" : "onLeft"], L()) : D.t(STR.off, L()))
      .replace("{r}", t.R.toFixed(1)).replace("{x}", t.L.toFixed(1));
  }
  // Pupils move with the model's own time constants (a Horner pupil redilates slowly). Reduced motion: they jump.
  function puLoop() {
    var u = EX.pu, last = 0;
    if (u.raf) G.cancelAnimationFrame(u.raf);
    if (reduced()) { u.cur = puTarget(u.P); u.raf = 0; return puDraw(); }
    function tick(ts) {
      if (EX.id !== "pupil" || !$("exFace")) { u.raf = 0; return; }
      var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
      var tg = puTarget(u.P), nx = N.pupilStep(u.P, u.cur, tg, dt);
      var moving = Math.abs(nx.R - u.cur.R) > 0.002 || Math.abs(nx.L - u.cur.L) > 0.002 || Math.abs(tg.R - nx.R) > 0.01 || Math.abs(tg.L - nx.L) > 0.01;
      u.cur = nx; puDraw();
      u.raf = moving ? G.requestAnimationFrame(tick) : 0;
    }
    u.raf = G.requestAnimationFrame(tick);
  }
  function puChange(focusSel, repanel) {
    var u = EX.pu;
    u.P = puModel();
    mark("pupil");
    if (repanel) region("exPuPanel", puPanel(), focusSel);
    else Array.prototype.forEach.call(G.document.querySelectorAll("#exPuPanel [data-act=exlight], #exPuPanel [data-act=exroom]"), function (b) {
      var a = b.getAttribute("data-act"), v = b.getAttribute("data-v");
      b.setAttribute("aria-pressed", String(a === "exlight" ? v === (u.light || "") : v === u.room));
    });
    puTexts(); puLive(); puLoop();
  }
  A.excond = function (b) { EX.pu.cond = b.getAttribute("data-v"); puChange('[data-act=excond][data-v="' + EX.pu.cond + '"]', true); };
  A.exaff = function (b) { EX.pu.side = b.getAttribute("data-v"); puChange('[data-act=exaff][data-v="' + EX.pu.side + '"]', true); };
  A.exlight = function (b) { EX.pu.light = b.getAttribute("data-v") || null; puChange(); };
  A.exroom = function (b) { EX.pu.room = b.getAttribute("data-v"); puChange(); };
  A.exswing = function () { EX.pu.light = EX.pu.light === "R" ? "L" : "R"; puChange(); I.haptic("tap"); };

  /* ================= 5. Guided tours ================= */
  // Each step: [x, y, r] as fractions of the picture's width (r too), then the title and what to look at.
  var TOURS = {
    fundus: { m: "fundus-normal", w: 1411, h: 1411, steps: [
      [0.5, 0.5, 0.5, T("The photo first", "पहले तस्वीर"), T("Is it in focus, and is the back of the eye in view? The optic disc is on the left, the nose side, so this is a left eye.", "क्या यह फ़ोकस में है, और आँख का पिछला हिस्सा दिख रहा है? ऑप्टिक डिस्क बाईं ओर, नाक की तरफ़ है, इसलिए यह बाईं आँख है।")],
      [0.16, 0.45, 0.085, T("Optic disc", "ऑप्टिक डिस्क"), T("Find the disc first: round, pink-orange, with a sharp edge. Everything else is measured from it.", "सबसे पहले डिस्क ढूँढें: गोल, गुलाबी-नारंगी, साफ़ किनारे वाली। बाकी सब इसी से नापा जाता है।")],
      [0.165, 0.445, 0.04, T("Cup", "कप (cup)"), T("The paler centre of the disc. Compare its width with the disc's: about a third is normal. A bigger cup can mean glaucoma.", "डिस्क का ज़्यादा सफ़ेद बीच। इसकी चौड़ाई डिस्क से मिलाएँ: लगभग एक-तिहाई सामान्य है। बड़ा कप ग्लूकोमा का संकेत हो सकता है।")],
      [0.34, 0.2, 0.1, T("Vessels", "नलियाँ"), T("Follow the vessels out from the disc. Arteries are thinner and brighter; veins are wider and darker.", "डिस्क से निकलती नलियों को देखें। आर्टरी पतली और चमकीली; वेन चौड़ी और गहरी।")],
      [0.5, 0.49, 0.16, T("Macula", "मैक्युला"), T("Between the big upper and lower arcades lies the darker macula. No large vessel crosses it.", "ऊपर और नीचे की बड़ी नलियों (arcades) के बीच गहरा मैक्युला है। कोई बड़ी नली इसे पार नहीं करती।")],
      [0.5, 0.49, 0.045, T("Fovea", "फ़ोविया"), T("Its darkest centre, about two and a half disc widths from the disc: the spot for reading vision.", "इसका सबसे गहरा बीच, डिस्क से लगभग ढाई डिस्क दूर: पढ़ने वाली नज़र की जगह।")],
      [0.78, 0.72, 0.18, T("Last, the rest", "आख़िर में, बाकी हिस्सा"), T("Sweep the rest of the retina for red spots, yellow deposits or pale patches. Here the background is an even orange-red: a healthy retina.", "बाकी रेटिना में लाल धब्बे, पीले जमाव या फीके हिस्से ढूँढें। यहाँ पृष्ठभूमि एक-सी नारंगी-लाल है: स्वस्थ रेटिना।")]
    ] },
    oct: { img: "oct/no_1250592_3.webp", w: 1024, h: 349, steps: [
      [0.5, 0.5, 0.5, T("A slice through the macula", "मैक्युला का एक कटाव"), T("An optical coherence tomography (OCT) scan is a cross-section of the retina, like a cut through a layered cake. The black top is the vitreous; the retina is the grey band; below it lies the choroid.", "ऑप्टिकल कोहेरेंस टोमोग्राफ़ी (optical coherence tomography, OCT) स्कैन रेटिना का आड़ा कटाव है, परतों वाले केक के कटे टुकड़े जैसा। ऊपर काला हिस्सा विट्रियस है; धूसर पट्टी रेटिना है; उसके नीचे कोरॉइड है।")],
      [0.49, 0.36, 0.07, T("Foveal dip", "फ़ोविया का गड्ढा"), T("Find the dip in the middle first. A smooth, even pit means the centre is not swollen.", "पहले बीच का गड्ढा ढूँढें। चिकना, बराबर गड्ढा बताता है कि बीच में सूजन नहीं है।")],
      [0.8, 0.23, 0.07, T("Nerve fibre layer", "नस-तंतु परत (nerve fibre layer)"), T("The bright top layer. It thickens toward the optic disc, here on the right edge of the scan.", "सबसे ऊपर की चमकीली परत। यह ऑप्टिक डिस्क की ओर मोटी होती है, जो यहाँ स्कैन के दाएँ किनारे पर है।")],
      [0.35, 0.405, 0.05, T("Photoreceptor line", "फ़ोटोरिसेप्टर रेखा"), T("Near the bottom of the retina, a thin bright line: the photoreceptors (ellipsoid zone). A break in it means damaged vision cells.", "रेटिना के निचले हिस्से में एक पतली चमकीली रेखा: फ़ोटोरिसेप्टर (ellipsoid zone)। इसमें टूट मतलब देखने वाली कोशिकाओं का नुकसान।")],
      [0.2, 0.44, 0.05, T("RPE", "RPE"), T("Just below, the brightest band: the retinal pigment epithelium. It should run smooth, with no bumps (drusen) and no lifts.", "ठीक नीचे सबसे चमकीली पट्टी: retinal pigment epithelium। यह चिकनी होनी चाहिए, बिना उभार (drusen) और बिना उठान के।")],
      [0.45, 0.58, 0.08, T("Choroid", "कोरॉइड"), T("Under the RPE, the choroid with its dark vessel spaces.", "RPE के नीचे कोरॉइड, जिसमें खून की नलियों की गहरी जगहें हैं।")],
      [0.5, 0.5, 0.5, T("Last, what should not be there", "आख़िर में, जो नहीं होना चाहिए"), T("Look for dark fluid pockets, bumps under the RPE or bright spots. This scan has none: a normal macula.", "गहरे द्रव की थैलियाँ, RPE के नीचे उभार या चमकीले धब्बे ढूँढें। इस स्कैन में कुछ नहीं: सामान्य मैक्युला।")]
    ] }
  };
  function tourImg(t) { return t.img ? I.imgUrl(t.img) : mediaUrl("photos/" + t.m + ".webp"); }
  function tourCredit(t) {
    if (t.m) return creditOf(W().media && W().media[t.m]);
    var tr = st.cfg && I.track("oct"), src = tr && st.cfg.sources[tr.source];
    return src ? '<span class="oph-credit" lang="en">OCT, normal macula · ' + esc(src.name) + " · " + esc(src.license) + "</span>" : "";
  }
  function tours(focusSel) {
    var o = EX.to, t = TOURS[o.which];
    paint("tours", '<div class="ex-grid"><div class="ex-stage">' +
      seg(raw("toTitle"), "extour", o.which, [["fundus", s("tFundus")], ["oct", s("tOct")]], "ex-full") +
      '<figure class="ex-figwrap"><div class="ex-fig ex-tour" style="aspect-ratio:' + t.w + " / " + t.h + '"><img src="' + esc(tourImg(t)) + '" alt="" width="' + t.w + '" height="' + t.h + '" decoding="async" id="exTourImg">' +
      '<svg viewBox="0 0 ' + t.w + " " + t.h + '" aria-hidden="true" focusable="false" preserveAspectRatio="none"><defs><mask id="exTourM"><rect width="' + t.w + '" height="' + t.h + '" fill="#fff"/>' +
      '<circle class="ex-spotc" id="exTourHole" r="1" fill="#000"/></mask></defs><rect class="ex-dim" width="' + t.w + '" height="' + t.h + '" mask="url(#exTourM)"/>' +
      '<circle class="ex-spotc ex-ring" id="exTourRing" r="1"/></svg></div><figcaption class="ex-cap">' + tourCredit(t) + "</figcaption></figure></div>" +
      '<div class="ex-panel" id="exTourPanel"></div></div>', focusSel);
    var img = $("exTourImg");
    if (img) img.addEventListener("error", function () { var f = img.parentNode; f.classList.add("err"); f.innerHTML = '<p class="ln-imgerr">' + s("imgErr") + "</p>"; });
    tourStep(true);
  }
  function tourStep(first, focusSel) {
    var o = EX.to, t = TOURS[o.which], n = t.steps.length, st0 = t.steps[o.i], last = o.i === n - 1;
    var x = st0[0] * t.w, y = st0[1] * t.h, r = Math.max(st0[2] * t.w, 6), tf = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px) scale(" + r.toFixed(1) + ")";
    ["exTourHole", "exTourRing"].forEach(function (id) { var c = $(id); if (c) { if (first) c.style.transition = "none"; c.style.transform = tf; if (first) { c.getBoundingClientRect(); c.style.transition = ""; } } });
    var whole = st0[2] >= 0.5, ring = $("exTourRing");
    if (ring) ring.style.opacity = whole ? "0" : "1";
    var dim = G.document.querySelector(".ex-tour .ex-dim"); if (dim) dim.style.opacity = whole ? "0" : "1";
    region("exTourPanel", '<div class="ex-info ex-tstep" aria-live="polite"><p class="oph-small">' + s("stepOf", { i: o.i + 1, n: n }) + "</p><h2>" + tx(st0[3]) + "</h2><p>" + tx(st0[4]) + "</p>" +
      (last ? '<p class="oph-verdict ok">' + ico("check") + "<span>" + s("tourDone") + "</span></p>" : "") + "</div>" +
      '<div class="ex-row2">' + (o.i > 0 ? '<button class="oph-btn sec" data-act="extprev">' + s("prev") + "</button>" : "<span></span>") +
      (last ? '<button class="oph-btn pri" data-act="extab" data-v="' + (o.which === "fundus" ? "oct" : "fundus") + '">' + s(o.which === "fundus" ? "tOct" : "tFundus") + "</button>"
        : '<button class="oph-btn pri" data-act="extnext">' + s("next") + "</button>") + "</div>", focusSel);
    if (last) mark("tours");
  }
  A.extour = function (b) { EX.to.which = b.getAttribute("data-v"); EX.to.i = 0; tours('[data-act=extour][data-v="' + EX.to.which + '"]'); };
  A.extab = A.extour;
  A.extnext = function () { var o = EX.to; if (o.i < TOURS[o.which].steps.length - 1) { o.i++; tourStep(false, o.i === TOURS[o.which].steps.length - 1 ? "[data-act=extab]" : "[data-act=extnext]"); } };
  A.extprev = function () { var o = EX.to; if (o.i > 0) { o.i--; tourStep(false, o.i > 0 ? "[data-act=extprev]" : "[data-act=extnext]"); } };

  /* ---------- wiring ---------- */
  A.exopen = function (b) { open(b.getAttribute("data-x")); };
  // Test yourself: the matching clinic, question-bank topic or simulator; back returns to this explorer.
  A.extest = function () {
    var x = BY[EX.id], t = x && testOf(x), id = EX.id, bank = bankFor(t);
    if (!t) return;
    var ret = function () { open(id); };
    I.leave();
    if (t.clinic && I.track(t.clinic) && st.decks[t.clinic]) O._startClinic(t.clinic, t.classes);
    else if (t.sim === "neuro" && N && N._ui) {
      var u = EX.pu, sim = null;
      (O._sims || []).forEach(function (z) { if (z.id === "neuro") sim = z; });
      N._ui.tab = "pupils"; N._ui.mode = "practice";
      N._ui.prac = { id: COND[u.cond] || "normal", side: u.side, grade: 0.9 };
      if (sim) sim.open();
    } else if (bank) bank.topic(t.mcqTopic);
    if (st.view === "explore") ret(); else if (st.view !== "hub") I.setRet(ret, raw("backExplore"), L());
  };
  K.explore = function (e) {
    var n = e.target && e.target.tagName;
    if (n === "INPUT" || n === "TEXTAREA") return;
    if (EX.id === "anatomy") return anKey(e);
    if (EX.id === "tours" && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !(e.target && e.target.closest && e.target.closest(".ex-seg"))) {
      e.preventDefault();
      if (e.key === "ArrowRight") A.extnext(); else A.extprev();
    }
  };

  O._explore = { homeHtml: homeHtml, open: open, list: LIST, _x: EX, _tours: TOURS, _photos: PHOTOS };
})(typeof window !== "undefined" ? window : this);
