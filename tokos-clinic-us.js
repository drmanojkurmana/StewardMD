/* Tokós fetal ultrasound clinics: two clinic plugins on the specialty engine (host.registerClinic). ES5.
   fetal-planes: name the plane of a real ultrasound image (FETAL_PLANES_DB, CC BY 4.0). MBBS answers from the grouped
     planes, Resident from the fine planes (Pro, one trial clinic.fetal-planes). The reveal names the plane, says what
     defines it (teaching points cited to ISUOG guidelines and the dataset paper) and credits the image.
   hc-biometry: fit an ellipse over the outer edge of the fetal skull (HC18, CC BY 4.0). Handles (centre, long axis,
     short axis, turn) and steppers or arrow keys move it; positions are image pixels so zoom never changes a result.
     HC is the Ramanujan perimeter times the case pixel size, compared with the sonographer's HC; gestational age comes
     from the ground-truth HC by the deck's Hadlock 1984 formula with its +/-2 SD band.
   Scoring bands for HC are ours (see HC_BANDS), not a guideline's. All teaching text is review: "ai_drafted".
   Pure functions are exported under node (module.exports) and as window.TOKOS_US in the browser. */
(function (G) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;

  /* ================= pure geometry ================= */
  var MIN_AXIS = 8; // image px: an ellipse never collapses to a line
  // Ramanujan's second approximation: pi (a + b) (1 + 3h / (10 + sqrt(4 - 3h))), h = ((a - b) / (a + b))^2.
  function perimeter(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    if (a + b === 0) return 0;
    var h = Math.pow((a - b) / (a + b), 2);
    return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
  }
  function pxToMm(px, mmPerPx) { return px * mmPerPx; }
  function hcMm(e, mmPerPx) { return pxToMm(perimeter(e.a, e.b), mmPerPx); }
  // Signed error of the learner's HC against the truth, in mm and percent of the truth.
  function hitError(mine, truth) { var d = mine - truth; return { mm: d, pct: truth ? d * 100 / truth : 0, absPct: truth ? Math.abs(d) * 100 / truth : 0 }; }

  // Our scoring bands for the absolute HC error (percent of the sonographer's HC). Not from a guideline: a first cut for
  // teaching, to be set by the reviewer. grade: 3 = Good, 2 = Hard, 1 = Again (FSRS).
  var HC_BANDS = [{ id: "on", maxPct: 3, grade: 3 }, { id: "close", maxPct: 7, grade: 2 }, { id: "off", maxPct: Infinity, grade: 1 }];
  function hcBand(absPct) { for (var i = 0; i < HC_BANDS.length; i++) if (absPct <= HC_BANDS[i].maxPct) return HC_BANDS[i]; return HC_BANDS[HC_BANDS.length - 1]; }

  // Hadlock 1984 GA from HC, coefficients from the deck (HC in cm). Null outside the formula's valid HC range.
  function gaFromHc(hc, cfg) {
    if (!cfg || hc < cfg.validHcMm[0] || hc > cfg.validHcMm[1]) return null;
    var cm = hc / 10, k = cfg.coefficients;
    return k.c0 + k.c1 * cm + k.c3 * cm * cm * cm;
  }
  // +/-2 SD in weeks from the deck's table; an HC in the gap before a range takes that (wider, next) range's value.
  function gaTol(hc, cfg) {
    if (!cfg || hc < cfg.validHcMm[0] || hc > cfg.validHcMm[1]) return null;
    var t = cfg.tolerance2SD;
    for (var i = 0; i < t.length; i++) if (hc <= t[i].hcMm[1]) return t[i].sd2Weeks;
    return t[t.length - 1].sd2Weeks;
  }

  function normAngle(d) { d = d % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; }
  function copy(e) { return { cx: e.cx, cy: e.cy, a: e.a, b: e.b, angleDeg: e.angleDeg }; }
  function clampE(e, w, h) {
    var n = copy(e), big = Math.max(w, h);
    n.cx = Math.min(Math.max(n.cx, 0), w); n.cy = Math.min(Math.max(n.cy, 0), h);
    n.a = Math.min(Math.max(n.a, MIN_AXIS), big); n.b = Math.min(Math.max(n.b, MIN_AXIS), big);
    n.angleDeg = normAngle(n.angleDeg);
    return n;
  }
  // Neutral start that says nothing about the answer: centred, a fixed share of the frame, level.
  function startEllipse(w, h) { return { cx: w / 2, cy: h / 2, a: Math.round(w * 0.22), b: Math.round(h * 0.24), angleDeg: 0 }; }
  // Handle positions in image px: c centre, a long-axis end, b short-axis end, r turn handle (the other long-axis end).
  function handles(e) {
    var t = e.angleDeg * Math.PI / 180, ux = Math.cos(t), uy = Math.sin(t);
    return { c: { x: e.cx, y: e.cy }, a: { x: e.cx + e.a * ux, y: e.cy + e.a * uy }, b: { x: e.cx - e.b * uy, y: e.cy + e.b * ux }, r: { x: e.cx - e.a * ux, y: e.cy - e.a * uy } };
  }
  // A handle dragged to image point p (the centre handle gets p already corrected by the grab offset).
  function dragTo(e, h, p, w, hgt) {
    var t = e.angleDeg * Math.PI / 180, ux = Math.cos(t), uy = Math.sin(t), dx = p.x - e.cx, dy = p.y - e.cy, n = copy(e);
    if (h === "c") { n.cx = p.x; n.cy = p.y; }
    else if (h === "a") n.a = Math.abs(dx * ux + dy * uy);
    else if (h === "b") n.b = Math.abs(-dx * uy + dy * ux);
    else if (h === "r") n.angleDeg = Math.atan2(dy, dx) * 180 / Math.PI + 180;
    return clampE(n, w, hgt);
  }
  // Steppers and arrow keys. mode: move | long | short | turn. dx, dy in steps (move); d = +1 / -1 otherwise.
  function nudge(e, mode, dx, dy, d, w, h) {
    var n = copy(e);
    if (mode === "move") { n.cx += dx; n.cy += dy; }
    else if (mode === "long") n.a += d;
    else if (mode === "short") n.b += d;
    else if (mode === "turn") n.angleDeg += d;
    return clampE(n, w, h);
  }

  /* ================= plane deck handling ================= */
  function planeOptions(deck, level) {
    var lv = deck.levels[level === "resident" ? "resident" : "mbbs"], list = lv.answer === "group" ? deck.groups : deck.classes;
    return lv.options.map(function (id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return { id: id, label: { en: id, hi: id } }; });
  }
  function planeTruth(deck, c, level) { return deck.levels[level === "resident" ? "resident" : "mbbs"].answer === "group" ? c.group : c.label; }
  function classOf(deck, id) { for (var i = 0; i < deck.classes.length; i++) if (deck.classes[i].id === id) return deck.classes[i]; return null; }
  function groupOf(deck, id) { for (var i = 0; i < deck.groups.length; i++) if (deck.groups[i].id === id) return deck.groups[i]; return null; }

  /* ================= teaching points (review: ai_drafted) ================= */
  var SOURCES = {
    "isuog-mt": { label: "Salomon LJ et al. ISUOG Practice Guidelines (updated): performance of the routine mid-trimester fetal ultrasound scan. Ultrasound Obstet Gynecol 2022;59:840-856", url: "https://doi.org/10.1002/uog.24888" },
    "isuog-cns": { label: "Malinger G et al. ISUOG Practice Guidelines (updated): sonographic examination of the fetal central nervous system. Part 1. Ultrasound Obstet Gynecol 2020;56:476-484", url: "https://doi.org/10.1002/uog.22145" },
    "isuog-ptb": { label: "Coutinho CM et al. ISUOG Practice Guidelines: role of ultrasound in the prediction of spontaneous preterm birth. Ultrasound Obstet Gynecol 2022;60:435-456", url: "https://doi.org/10.1002/uog.26020" },
    "fpdb": { label: "Burgos-Artizzu XP et al. Evaluation of deep convolutional neural networks for automatic classification of common maternal fetal ultrasound planes. Sci Rep 2020;10:10200", url: "https://doi.org/10.1038/s41598-020-67076-5" },
    "hc18": { label: "van den Heuvel TLA et al. Automated measurement of fetal head circumference using 2D ultrasound images. PLoS ONE 2018;13(8):e0200412", url: "https://doi.org/10.1371/journal.pone.0200412" }
  };
  function P(en, hi) { return { en: en, hi: hi }; }
  var PLANES = {
    "fetal-abdomen": { src: ["isuog-mt"], points: [
      P("A transverse section of the abdomen, as round as possible.", "पेट का अनुप्रस्थ (transverse) सेक्शन, जितना हो सके गोल।"),
      P("The umbilical vein at the level of the portal sinus, and the stomach, are both in view.", "पोर्टल साइनस के स्तर पर अम्बिलिकल वेन और पेट (stomach) दोनों दिखें।"),
      P("The kidneys are not seen; if they are, the section is too low.", "किडनी न दिखें; दिखें तो सेक्शन बहुत नीचे है।"),
      P("AC is measured on the outer skin line with an ellipse.", "AC त्वचा की बाहरी रेखा पर ellipse से मापा जाता है।")] },
    "brain-transthalamic": { src: ["isuog-cns", "isuog-mt"], points: [
      P("Axial plane at the level of the thalami: the plane for BPD and HC.", "थैलेमस के स्तर का axial प्लेन: BPD और HC का प्लेन।"),
      P("From front to back: frontal horns, cavum septi pellucidi (CSP), thalami, hippocampal gyri.", "आगे से पीछे: frontal horns, cavum septi pellucidi (CSP), थैलेमस, hippocampal gyri।"),
      P("The midline falx is broken in front only by the CSP; the cerebellum is not seen.", "मध्य रेखा (falx) आगे केवल CSP से टूटती है; cerebellum नहीं दिखता।")] },
    "brain-transcerebellar": { src: ["isuog-cns"], points: [
      P("Just below the transventricular plane, with a slight backward tilt of the probe.", "transventricular प्लेन से थोड़ा नीचे, प्रोब को हल्का पीछे झुकाकर।"),
      P("Shows the thalami, the butterfly-shaped cerebellum (two hemispheres joined by the vermis) and the cisterna magna behind it.", "थैलेमस, तितली के आकार का cerebellum (vermis से जुड़े दो hemispheres) और उसके पीछे cisterna magna दिखते हैं।"),
      P("In the second half of pregnancy the cisterna magna should not measure more than 10 mm front to back.", "गर्भावस्था के दूसरे भाग में cisterna magna आगे से पीछे 10 mm से ज़्यादा नहीं होना चाहिए।")] },
    "brain-transventricular": { src: ["isuog-cns"], points: [
      P("Shows the front and back parts of the lateral ventricles.", "lateral ventricles के आगे और पीछे के हिस्से दिखते हैं।"),
      P("Comma-shaped frontal horns separated by the CSP; the atrium with the bright choroid plexus on the far side.", "कॉमा जैसे frontal horns, बीच में CSP; दूर वाली ओर चमकीले choroid plexus के साथ atrium।"),
      P("The atrium is measured here. Only the hemisphere far from the probe is usually seen clearly.", "atrium यहीं मापा जाता है। आमतौर पर प्रोब से दूर वाला hemisphere ही साफ़ दिखता है।")] },
    "brain-other": { src: ["fpdb", "isuog-cns"], points: [
      P("A fetal brain image that is not one of the three standard axial planes (transventricular, transthalamic, transcerebellar).", "भ्रूण के मस्तिष्क की ऐसी तस्वीर जो तीन मानक axial प्लेन (transventricular, transthalamic, transcerebellar) में से कोई नहीं।"),
      P("Check each standard plane's landmarks in turn; here none is complete.", "हर मानक प्लेन के landmarks एक-एक कर जांचें; यहाँ कोई पूरा नहीं है।")] },
    "fetal-femur": { src: ["isuog-mt"], points: [
      P("Both ends of the ossified shaft (diaphysis) are in view; the longest axis is measured.", "हड्डी बने shaft (diaphysis) के दोनों सिरे दिखें; सबसे लंबा अक्ष मापा जाता है।"),
      P("The beam usually meets the femur at 45 to 90 degrees.", "बीम आमतौर पर फीमर से 45 से 90 डिग्री पर मिलती है।"),
      P("One femur is usually enough unless an abnormality is suspected.", "असामान्यता का शक न हो तो एक फीमर काफ़ी है।")] },
    "fetal-thorax": { src: ["isuog-mt", "fpdb"], points: [
      P("Thorax planes show the heart and lungs; the four-chamber view is where cardiac screening starts.", "वक्ष के प्लेन में हृदय और फेफड़े दिखते हैं; हृदय की जांच four-chamber view से शुरू होती है।"),
      P("With normal situs the heart sits in the left chest, on the same side as the stomach.", "सामान्य situs में हृदय बाईं छाती में, पेट (stomach) की ही ओर होता है।"),
      P("A normal heart is no larger than one-third of the chest area; its axis points about 45 degrees (+/-20) to the left.", "सामान्य हृदय छाती के क्षेत्र के एक-तिहाई से बड़ा नहीं; उसका अक्ष लगभग 45 डिग्री (+/-20) बाईं ओर।")] },
    "maternal-cervix": { src: ["isuog-ptb", "fpdb"], points: [
      P("A transvaginal sagittal view of the cervix, taken with the bladder empty.", "खाली मूत्राशय के साथ योनि मार्ग से (transvaginal) ग्रीवा का sagittal view।"),
      P("The internal os, endocervical canal and external os are all in view; the cervix fills 50 to 75% of the screen.", "internal os, endocervical canal और external os सभी दिखें; ग्रीवा स्क्रीन का 50 से 75% भरे।"),
      P("Cervical length is the straight line from the functional internal os to the external os; probe pressure falsely lengthens it.", "ग्रीवा की लंबाई functional internal os से external os तक सीधी रेखा है; प्रोब का दबाव इसे गलत रूप से लंबा कर देता है।")] },
    "other": { src: ["fpdb"], points: [
      P("In this dataset 'Other' is a random set of images that are none of the main planes.", "इस डेटासेट में 'अन्य' ऐसी तस्वीरों का समूह है जो मुख्य प्लेन में से कोई नहीं।"),
      P("Name it by exclusion: look for each standard plane's landmarks and find them missing.", "बाहर करके पहचानें: हर मानक प्लेन के landmarks खोजें और पाएँ कि वे नहीं हैं।")] }
  };
  var HC_POINTS = { src: ["isuog-mt", "isuog-cns"], points: [
    P("HC is taken in the transthalamic plane: thalami, CSP in front, cerebellum not seen.", "HC transthalamic प्लेन में लिया जाता है: थैलेमस, आगे CSP, cerebellum नहीं दिखता।"),
    P("The ellipse goes around the outside of the skull bone echoes (outer to outer).", "ellipse खोपड़ी की हड्डी की गूंज के बाहर से (outer to outer) लगाया जाता है।"),
    P("Without an ellipse tool: HC = 1.62 x (BPD + OFD).", "ellipse टूल न हो तो: HC = 1.62 x (BPD + OFD)।")] };

  var API = { MIN_AXIS: MIN_AXIS, perimeter: perimeter, pxToMm: pxToMm, hcMm: hcMm, hitError: hitError, HC_BANDS: HC_BANDS, hcBand: hcBand,
    gaFromHc: gaFromHc, gaTol: gaTol, normAngle: normAngle, clampE: clampE, startEllipse: startEllipse, handles: handles, dragTo: dragTo, nudge: nudge,
    planeOptions: planeOptions, planeTruth: planeTruth, classOf: classOf, groupOf: groupOf, SOURCES: SOURCES, PLANES: PLANES, HC_POINTS: HC_POINTS };
  if (node) { module.exports = API; return; }
  G.TOKOS_US = API;

  /* ================= the clinic plugins ================= */
  var host = G.TOKOS;
  if (!host || !host.registerClinic || !G.document) return;
  var I = host._internal, st = host._st, S = G.SPECIALTY_STAGE, C = G.SPECIALTY_CORE, D = G.SPECIALTY_DATA;
  var SVGNS = "http://www.w3.org/2000/svg";
  var us = { stage: null, mo: null, done: null, credits: null, creditsP: null, e: null, mode: "move", drag: null, deck: null };

  var L10N = {
    en: {
      backHub: "Back to Tokós", caseOf: "Case {i} of {n}", zoomIn: "Zoom in", fit: "Fit", zoomHint: "Pinch or double-tap to zoom",
      imgErr: "The image did not load. Check your connection and try again.", tryAgain: "Try again", imgAria: "Ultrasound image, case {id}",
      whichPlane: "Which plane is this?", check: "Check", pickOne: "Choose one plane",
      right: "Correct", wrong: "Not this plane", yours: "Yours", key: "Answer", plane: "Plane", group: "Group",
      defines: "What defines this plane", sources: "Sources", credit: "Image", adapted: "adapted: resized, corner masked",
      nextReview: "Next review in", day: "day", days: "days", next: "Next case", draftMark: "Draft, pending obstetric review",
      hcHow: "Fit the ellipse to the outer edge of the skull bone. Drag the centre, the axis ends or the turn handle, or use the buttons.",
      mode: "What to adjust", move: "Move", long: "Long axis", short: "Short axis", turn: "Turn",
      left: "Left", right2: "Right", up: "Up", down: "Down", less: "Smaller", more: "Larger", turnL: "Turn anticlockwise", turnR: "Turn clockwise",
      stepNote: "Arrow keys on the image adjust too; Shift moves 10 at a time.", measure: "Measure",
      yourHc: "Your HC", liveHc: "Your HC {v} mm", truthHc: "Sonographer's HC", error: "Difference", mm: "mm",
      band_on: "On target", band_close: "Close", band_off: "Off the skull edge",
      bandRule: "Our scoring bands (not from a guideline): within 3% on target, within 7% close, beyond that off.",
      ga: "Gestational age from the sonographer's HC", gaRange: "+/-2 SD {t} wk: {lo} to {hi} wk", wk: "wk",
      yourGa: "Your HC reads as {g} wk", gaOut: "Your HC is outside the formula's range (68 to 360 mm)",
      gaRule: "Hadlock 1984: GA = 8.96 + 0.540 x HC + 0.0003 x HC^3 (HC in cm).", legendYou: "Your ellipse", legendTruth: "Sonographer's ellipse",
      howHc: "How HC is measured", pxNote: "Pixel size {p} mm, so zooming never changes the result.",
      handleC: "Centre", handleA: "Long axis end", handleB: "Short axis end", handleR: "Turn handle"
    },
    hi: {
      backHub: "टोकोस पर वापस", caseOf: "{n} में से केस {i}", zoomIn: "ज़ूम करें", fit: "पूरा देखें", zoomHint: "ज़ूम के लिए पिंच या डबल-टैप करें",
      imgErr: "तस्वीर लोड नहीं हुई। कनेक्शन जांचें और फिर कोशिश करें।", tryAgain: "फिर कोशिश करें", imgAria: "अल्ट्रासाउंड तस्वीर, केस {id}",
      whichPlane: "यह कौन सा प्लेन है?", check: "जांचें", pickOne: "एक प्लेन चुनें",
      right: "सही", wrong: "यह प्लेन नहीं", yours: "आपका", key: "उत्तर", plane: "प्लेन", group: "समूह",
      defines: "यह प्लेन किससे पहचाना जाता है", sources: "स्रोत", credit: "तस्वीर", adapted: "बदली गई: आकार छोटा, कोना ढका",
      nextReview: "अगला दोहराव", day: "दिन में", days: "दिन में", next: "अगला केस", draftMark: "ड्राफ़्ट, प्रसूति विशेषज्ञ की समीक्षा बाकी",
      hcHow: "ellipse को खोपड़ी की हड्डी के बाहरी किनारे पर बैठाएँ। केंद्र, अक्ष के सिरे या घुमाने वाला हैंडल खींचें, या बटन इस्तेमाल करें।",
      mode: "क्या बदलें", move: "खिसकाएँ", long: "लंबा अक्ष", short: "छोटा अक्ष", turn: "घुमाएँ",
      left: "बाएँ", right2: "दाएँ", up: "ऊपर", down: "नीचे", less: "छोटा", more: "बड़ा", turnL: "उल्टी दिशा में घुमाएँ", turnR: "घड़ी की दिशा में घुमाएँ",
      stepNote: "तस्वीर पर तीर वाली कुंजियाँ भी काम करती हैं; Shift से 10 एक साथ।", measure: "मापें",
      yourHc: "आपका HC", liveHc: "आपका HC {v} mm", truthHc: "सोनोग्राफ़र का HC", error: "अंतर", mm: "mm",
      band_on: "सटीक", band_close: "करीब", band_off: "खोपड़ी के किनारे से दूर",
      bandRule: "हमारे स्कोर बैंड (किसी गाइडलाइन से नहीं): 3% तक सटीक, 7% तक करीब, उससे ज़्यादा दूर।",
      ga: "सोनोग्राफ़र के HC से गर्भ की अवधि", gaRange: "+/-2 SD {t} सप्ताह: {lo} से {hi} सप्ताह", wk: "सप्ताह",
      yourGa: "आपका HC {g} सप्ताह दर्शाता है", gaOut: "आपका HC सूत्र की सीमा (68 से 360 mm) से बाहर है",
      gaRule: "Hadlock 1984: GA = 8.96 + 0.540 x HC + 0.0003 x HC^3 (HC cm में)।", legendYou: "आपका ellipse", legendTruth: "सोनोग्राफ़र का ellipse",
      howHc: "HC कैसे मापा जाता है", pxNote: "पिक्सेल का आकार {p} mm, इसलिए ज़ूम से नतीजा नहीं बदलता।",
      handleC: "केंद्र", handleA: "लंबे अक्ष का सिरा", handleB: "छोटे अक्ष का सिरा", handleR: "घुमाने का हैंडल"
    }
  };
  function W() { return L10N[I.lang()]; }
  function esc(s) { return I.esc(s); }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] == null ? m : o[k]; }); }
  function n1(v) { return (Math.round(v * 10) / 10).toFixed(1); } // ASCII digits in both languages
  function $(id) { return G.document.getElementById(id); }
  function icoH(n) { var i = I.ico(n); return i ? '<span class="tok-i" aria-hidden="true">' + i + "</span>" : ""; }
  function current() { var s = st.session; return s && s.list[s.i] ? s.list[s.i].c : null; }
  function deckOf(id) { return st.decks[id]; }
  function caseLine() { var s = st.session; return fmt(W().caseOf, { i: s.i + 1, n: s.list.length }); }
  function key(id) { return D.levelKey(id, I.level()); }

  function credits() {
    if (!us.creditsP) us.creditsP = I.getJSON("media/credits.json").then(function (c) { us.credits = c; return c; }, function () { us.creditsP = null; return null; });
    return us.creditsP;
  }
  function creditHtml(c, deck) {
    var w = W(), src = deck.source || {}, cr = us.credits && us.credits[src.credit], file = cr && cr.files ? cr.files[c.img] : null;
    return '<p class="tus-credit">' + esc(w.credit) + ": " + esc(src.dataset || "") + (file ? ", " + esc(file) : "") + ". " +
      (cr && cr.author ? esc(cr.author) + ". " : "") +
      (src.url ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.doi || src.url) + "</a>. " : "") +
      (cr && cr.licenceUrl ? '<a href="' + esc(cr.licenceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(src.licence || cr.licence) + "</a>" : esc(src.licence || "")) +
      (deck.id === "fetal-planes" ? ", " + esc(w.adapted) : "") + ".</p>";
  }
  function sourcesHtml(keys) {
    return '<details class="tus-src"><summary>' + esc(W().sources) + "</summary><ul>" + keys.map(function (k) {
      var s = SOURCES[k]; return s ? '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + "</a></li>" : "";
    }).join("") + "</ul></details>";
  }
  function pointsHtml(p, title) {
    return '<section class="tok-why"><h3>' + esc(title) + "</h3><ul>" + p.points.map(function (x) { return "<li>" + esc(I.t(x)) + "</li>"; }).join("") + "</ul>" +
      sourcesHtml(p.src) + '<p class="tus-draft">' + esc(W().draftMark) + "</p></section>";
  }

  /* ---------- the image stage: an inline SVG (image + overlay) in image px, zoomed by the engine stage ---------- */
  function stageHtml(c, extra, keys) {
    var w = W();
    return '<div class="tus-stage" id="tusStage"' + (keys ? ' tabindex="0" role="group" aria-label="' + esc(w.stepNote) + '"' : "") + ' style="aspect-ratio:' + c.w + " / " + c.h + '">' +
      '<svg id="tusSvg" xmlns="' + SVGNS + '" width="' + c.w + '" height="' + c.h + '" viewBox="0 0 ' + c.w + " " + c.h + '" role="img" aria-label="' + esc(fmt(w.imgAria, { id: c.id })) + '">' +
      '<image href="' + esc(I.imgUrl("media/" + c.img)) + '" x="0" y="0" width="' + c.w + '" height="' + c.h + '" preserveAspectRatio="none"/>' + (extra || "") + "</svg></div>";
  }
  function zoomBar() {
    var w = W();
    return '<div class="tok-zoom"><button type="button" class="tok-icon" data-act="us-zoom" aria-label="' + esc(w.zoomIn) + '" title="' + esc(w.zoomHint) + '">' + (icoH("plus") || "+") + "</button>" +
      '<button type="button" class="tok-icon tok-fit" data-act="us-fit">' + esc(w.fit) + "</button></div>";
  }
  function unmount() {
    if (us.mo) { try { us.mo.disconnect(); } catch (e) {} us.mo = null; }
    us.stage = null; us.drag = null;
  }
  function mountStage() {
    var stage = $("tusStage"), svg = $("tusSvg");
    if (!stage || !svg || !S) return;
    us.stage = S.attach(stage, svg); us.stage.reset();
    var img = svg.querySelector("image");
    if (img) img.addEventListener("error", function () {
      stage.innerHTML = '<div class="tok-err tus-err" role="alert"><p>' + esc(W().imgErr) + '</p><button type="button" class="tok-btn sec" data-act="us-retry">' + esc(W().tryAgain) + "</button></div>";
    });
    // Handles keep one on-screen size at every zoom: the stage's scale is read back from the SVG's transform.
    // An animated zoom (double-tap, the zoom button) is read again when its transition ends.
    if (G.MutationObserver) { us.mo = new G.MutationObserver(sizeHandles); us.mo.observe(svg, { attributes: true, attributeFilter: ["style"] }); }
    svg.addEventListener("transitionend", sizeHandles);
    sizeHandles();
  }
  function screenScale() { var svg = $("tusSvg"); if (!svg) return 1; var r = svg.getBoundingClientRect(), w = +svg.getAttribute("width"); return r.width && w ? r.width / w : 1; }
  function sizeHandles() {
    var svg = $("tusSvg"); if (!svg) return;
    var k = screenScale();
    [].forEach.call(svg.querySelectorAll(".tus-h"), function (g) {
      var hit = g.querySelector(".tus-hit"), dot = g.querySelector(".tus-dot");
      if (hit) hit.setAttribute("r", 22 / k); if (dot) dot.setAttribute("r", (g.getAttribute("data-h") === "c" ? 6 : 8) / k);
    });
    svg.style.setProperty("--tus-k", k);
  }

  /* ================= fetal planes ================= */
  function renderPlanes() {
    var c = current(), w = W(), deck = deckOf("fetal-planes"), pick = st.session.pick;
    var opts = planeOptions(deck, I.level()).map(function (o) {
      var on = pick === o.id;
      return '<button type="button" class="tok-opt" aria-pressed="' + on + '" data-act="us-pick" data-o="' + esc(o.id) + '">' + I.tx(o.label) + "</button>";
    }).join("");
    return I.top(w.backHub, esc(I.t(fp.title)), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll tus-view"><div class="tus-hold">' + stageHtml(c) + '<div class="tus-bar tok-pad"><span class="sp-small">' + esc(w.zoomHint) + "</span>" + zoomBar() + "</div></div>" +
      '<div class="tok-pad"><fieldset class="tok-q tus-q"><legend>' + esc(w.whichPlane) + '</legend><div class="tok-opts">' + opts + "</div></fieldset>" +
      '<div class="tok-foot"><span class="tok-count" aria-live="polite">' + (pick ? "" : esc(w.pickOne)) + "</span>" +
      '<button type="button" class="tok-btn pri" data-act="us-check"' + (pick ? "" : " disabled") + ">" + esc(w.check) + "</button></div></div></div>";
  }
  function renderPlanesReveal() {
    var c = current(), w = W(), deck = deckOf("fetal-planes"), r = st.session.result, lv = I.level();
    var truthLabel = lv === "resident" ? classOf(deck, r.truth) : groupOf(deck, r.truth), mine = lv === "resident" ? classOf(deck, r.pick) : groupOf(deck, r.pick);
    var fine = classOf(deck, c.label), pts = PLANES[c.label];
    var les = !r.ok && host._learn && host._learn.lessonFor ? host._learn.lessonFor("fetal-planes", c.label) : null;
    return I.top(w.backHub, esc(I.t(fp.title)), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll"><div class="tok-reveal tok-pad">' +
      '<p class="tok-score tus-verdict ' + (r.ok ? "ok" : "no") + '" tabindex="-1">' + icoH(r.ok ? "check" : "x") + "<b>" + esc(r.ok ? w.right : w.wrong) + "</b></p>" +
      '<ol class="tok-concord"><li class="tok-row ' + (r.ok ? "ok" : "no") + '"><div class="tok-row-h"><b>' + esc(w.plane) + "</b></div>" +
      (r.ok ? '<p class="tok-ans">' + I.tx(truthLabel.label) + "</p>"
        : '<p class="tok-ans mine"><span>' + esc(w.yours) + "</span>" + I.tx(mine.label) + '</p><p class="tok-ans key"><span>' + esc(w.key) + "</span>" + I.tx(truthLabel.label) + "</p>") +
      (lv !== "resident" && fine && deck.classes.filter(function (x) { return x.group === c.group; }).length > 1 ? '<p class="sp-small tus-fine">' + esc(w.plane) + ": " + I.tx(fine.label) + "</p>" : "") + "</li></ol>" +
      '<div class="tus-thumb" style="aspect-ratio:' + c.w + " / " + c.h + '"><img src="' + esc(I.imgUrl("media/" + c.img)) + '" alt="' + esc(fmt(w.imgAria, { id: c.id })) + '" width="' + c.w + '" height="' + c.h + '"></div>' +
      creditHtml(c, deck) +
      (pts ? pointsHtml(pts, w.defines) : "") +
      '<p class="tok-next">' + esc(w.nextReview) + " <b>" + r.ivl + "</b> " + esc(r.ivl === 1 ? w.day : w.days) + "</p>" +
      (les ? '<button type="button" class="sp-btn sec sp-wide tok-learnthis" data-act="lesson" data-l="' + esc(les.id) + '">' + esc(typeof les.title === "string" ? les.title : I.t(les.title)) + "</button>" : "") +
      I.maikBtn("I am learning fetal ultrasound planes. This image is the " + I.t(fine ? fine.label : { en: c.label }) + " plane" + (r.ok ? "" : "; I called it " + I.t(mine.label)) +
        ". Explain the landmarks that define this plane and how to tell it from the one I chose.") +
      '</div><div class="tok-foot tok-pad"><button type="button" class="tok-btn pri" data-act="us-next">' + esc(w.next) + "</button></div></div>";
  }
  function checkPlane() {
    var c = current(), deck = deckOf("fetal-planes"), lv = I.level(), today = I.today(), pick = st.session.pick;
    if (!pick) return;
    var truth = planeTruth(deck, c, lv), ok = pick === truth;
    var card = C.review(st.store, key("fetal-planes"), c.id, C.gradeFor(ok), today);
    C.recordAnswer(st.store, key("fetal-planes"), truth, pick);
    I.save();
    I.haptic(ok ? "success" : "error");
    st.session.result = { pick: pick, truth: truth, ok: ok, ivl: card[3] - today };
    st.view = "us-planes-reveal";
    credits().then(function () { if (st.view === "us-planes-reveal" && current() === c) paint(".tus-verdict"); });
  }

  /* ================= head circumference ================= */
  function ellipseSvg(e, cls) {
    return '<ellipse class="' + cls + '" cx="' + e.cx + '" cy="' + e.cy + '" rx="' + e.a + '" ry="' + e.b + '" transform="rotate(' + e.angleDeg + " " + e.cx + " " + e.cy + ')"/>';
  }
  function handlesSvg(e) {
    var h = handles(e), w = W(), lab = { c: w.handleC, a: w.handleA, b: w.handleB, r: w.handleR };
    return ["a", "b", "r", "c"].map(function (k) {
      return '<g class="tus-h tus-h-' + k + '" data-h="' + k + '" aria-label="' + esc(lab[k]) + '"><circle class="tus-hit" cx="' + h[k].x + '" cy="' + h[k].y + '" r="12"/><circle class="tus-dot" cx="' + h[k].x + '" cy="' + h[k].y + '" r="6"/></g>';
    }).join("");
  }
  function drawEllipse() {
    var svg = $("tusSvg"), g = svg && svg.querySelector(".tus-edit");
    if (!g) return;
    g.innerHTML = ellipseSvg(us.e, "tus-ell") + '<line class="tus-axis" x1="' + handles(us.e).r.x + '" y1="' + handles(us.e).r.y + '" x2="' + handles(us.e).a.x + '" y2="' + handles(us.e).a.y + '"/>' + handlesSvg(us.e);
    sizeHandles();
    var c = current(), out = $("tusLive");
    if (out && c) out.textContent = fmt(W().liveHc, { v: n1(hcMm(us.e, c.mmPerPx)) });
  }
  var MODES = ["move", "long", "short", "turn"];
  function stepBtns() {
    var w = W(), m = us.mode;
    function b(label, a, extra) { return '<button type="button" class="tok-icon tus-step" data-act="us-step" ' + extra + ' aria-label="' + esc(label) + '">' + a + "</button>"; }
    if (m === "move") return b(w.left, "←", 'data-x="-1" data-y="0"') + b(w.up, "↑", 'data-x="0" data-y="-1"') + b(w.down, "↓", 'data-x="0" data-y="1"') + b(w.right2, "→", 'data-x="1" data-y="0"');
    if (m === "turn") return b(w.turnL, "↺", 'data-d="-1"') + b(w.turnR, "↻", 'data-d="1"');
    return b(w.less, "−", 'data-d="-1"') + b(w.more, "+", 'data-d="1"');
  }
  function renderHc() {
    var c = current(), w = W();
    return I.top(w.backHub, esc(I.t(hc.title)), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll tus-view"><div class="tus-hold">' + stageHtml(c, '<g class="tus-edit" aria-hidden="true"></g>', true) +
      '<div class="tus-bar tok-pad"><output id="tusLive" class="tok-read tus-live"></output>' + zoomBar() + "</div></div>" +
      '<div class="tok-pad"><p class="tus-how">' + esc(w.hcHow) + "</p>" +
      '<div class="tus-ctl"><div class="tok-seg sm tus-modes" role="group" aria-label="' + esc(w.mode) + '">' + MODES.map(function (m) {
        return '<button type="button" data-act="us-mode" data-m="' + m + '" aria-pressed="' + (us.mode === m) + '">' + esc(w[m]) + "</button>";
      }).join("") + '</div><div class="tus-steps" id="tusSteps">' + stepBtns() + "</div></div>" +
      '<p class="sp-small tus-note">' + esc(w.stepNote) + " " + esc(fmt(w.pxNote, { p: String(+c.mmPerPx.toFixed(3)) })) + "</p>" +
      '<div class="tok-foot"><button type="button" class="tok-btn pri" data-act="us-measure">' + esc(w.measure) + "</button></div></div></div>";
  }
  function mountHc() {
    var svg = $("tusSvg"); if (!svg) return;
    drawEllipse();
    var g = svg.querySelector(".tus-edit");
    g.addEventListener("pointerdown", function (ev) {
      var t = ev.target.closest && ev.target.closest(".tus-h"); if (!t) return;
      ev.stopPropagation(); ev.preventDefault();
      var h = t.getAttribute("data-h"), p = toImg(ev);
      us.drag = { h: h, id: ev.pointerId, off: h === "c" ? { x: us.e.cx - p.x, y: us.e.cy - p.y } : { x: 0, y: 0 } };
      try { g.setPointerCapture(ev.pointerId); } catch (x) {}
      svg.classList.add("tus-dragging");
    });
    g.addEventListener("pointermove", function (ev) {
      var d = us.drag; if (!d || d.id !== ev.pointerId) return;
      ev.stopPropagation();
      var c = current(), p = toImg(ev);
      us.e = dragTo(us.e, d.h, { x: p.x + d.off.x, y: p.y + d.off.y }, c.w, c.h);
      drawEllipse();
    });
    function up(ev) { if (us.drag && us.drag.id === ev.pointerId) { us.drag = null; svg.classList.remove("tus-dragging"); ev.stopPropagation(); } }
    g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
  }
  // Pointer to image px through the zoomed SVG's on-screen box: zoom and pan never change a measurement.
  function toImg(ev) { var svg = $("tusSvg"), r = svg.getBoundingClientRect(), c = current(); return { x: (ev.clientX - r.left) * c.w / r.width, y: (ev.clientY - r.top) * c.h / r.height }; }
  function step(dx, dy, d, mult) {
    var c = current(); if (!c || !us.e) return;
    us.e = nudge(us.e, us.mode, dx * mult, dy * mult, d * mult, c.w, c.h);
    drawEllipse();
  }
  function renderHcReveal() {
    var c = current(), w = W(), deck = deckOf("hc-biometry"), r = st.session.result, cfg = deck.gaFromHc;
    var ga = gaFromHc(c.hcMm, cfg), tol = gaTol(c.hcMm, cfg), myGa = gaFromHc(r.mine, cfg), sign = r.err.mm > 0 ? "+" : "";
    var legend = '<p class="tus-legend"><span><span class="tus-k tus-k-you"></span>' + esc(w.legendYou) + '</span><span><span class="tus-k tus-k-truth"></span>' + esc(w.legendTruth) + "</span></p>";
    return I.top(w.backHub, esc(I.t(hc.title)), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll"><div class="tus-hold">' + stageHtml(c, ellipseSvg(c.ellipse, "tus-truth") + ellipseSvg(r.e, "tus-ell tus-mine")) +
      '<div class="tus-bar tok-pad">' + legend + zoomBar() + "</div></div>" +
      '<div class="tok-reveal tok-pad">' +
      '<p class="tok-score tus-verdict ' + r.band.id + '" tabindex="-1"><b>' + esc(w["band_" + r.band.id]) + "</b> " + esc(sign + n1(r.err.pct)) + "%</p>" +
      '<section class="tok-block"><dl>' +
        kv(w.yourHc, n1(r.mine) + " mm") + kv(w.truthHc, n1(c.hcMm) + " mm") +
        kv(w.error, sign + n1(r.err.mm) + " mm", sign + n1(r.err.pct) + "%") + "</dl>" +
        '<p class="sp-small">' + esc(w.bandRule) + "</p></section>" +
      '<section class="tok-block"><h3>' + esc(w.ga) + "</h3>" +
        (ga == null ? "" : '<p class="tus-ga"><b>' + n1(ga) + "</b> " + esc(w.wk) + "</p>" +
          '<p class="sp-small">' + esc(fmt(w.gaRange, { t: String(tol), lo: n1(ga - tol), hi: n1(ga + tol) })) + "</p>") +
        '<p class="sp-small">' + esc(myGa == null ? w.gaOut : fmt(w.yourGa, { g: n1(myGa) })) + "</p>" +
        '<p class="sp-small">' + esc(w.gaRule) + "</p>" + sourcesHtml([]).replace("<ul></ul>", "<ul><li>" + esc(cfg.source.primary) + "</li><li>" + esc(cfg.source.verifiedAgainst) + "</li></ul>") + "</section>" +
      creditHtml(c, deck) + pointsHtml(HC_POINTS, w.howHc) +
      '<p class="tok-next">' + esc(w.nextReview) + " <b>" + r.ivl + "</b> " + esc(r.ivl === 1 ? w.day : w.days) + "</p>" +
      I.maikBtn("I am learning to measure fetal head circumference. My ellipse gave HC " + n1(r.mine) + " mm; the sonographer's HC was " + n1(c.hcMm) +
        " mm (" + sign + n1(r.err.pct) + "%). Explain the correct plane and caliper placement for HC and the common reasons for over- or under-measuring.") +
      '</div><div class="tok-foot tok-pad"><button type="button" class="tok-btn pri" data-act="us-next">' + esc(w.next) + "</button></div></div>";
  }
  function kv(label, value, sub) { return '<div class="tok-kv"><dt>' + esc(label) + '<span class="tok-sr">: </span></dt><dd>' + esc(value) + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</dd></div>"; }
  function measure() {
    var c = current(), today = I.today(), mine = hcMm(us.e, c.mmPerPx), err = hitError(mine, c.hcMm), band = hcBand(err.absPct);
    var card = C.review(st.store, key("hc-biometry"), c.id, band.grade, today);
    I.save();
    I.haptic(band.id === "off" ? "error" : "success");
    st.session.result = { e: us.e, mine: mine, err: err, band: band, ivl: card[3] - today };
    st.view = "us-hc-reveal";
    credits().then(function () { if (st.view === "us-hc-reveal" && current() === c) paint(".tus-verdict"); });
  }

  /* ---------- one painter for both clinics; repaints (language) come back through st.again ---------- */
  function paint(focusSel) {
    unmount();
    if (!current()) return;
    var v = st.view, html = v === "us-planes" ? renderPlanes() : v === "us-planes-reveal" ? renderPlanesReveal() : v === "us-hc" ? renderHc() : renderHcReveal();
    I.paint(html, typeof focusSel === "string" ? focusSel : null);
    mountStage();
    if (v === "us-hc") mountHc();
    try { if (v.indexOf("reveal") > 0 && typeof focusSel === "string") { var sc = I.root().querySelector(".tok-scroll"); if (sc) sc.scrollTop = 0; } } catch (e) {}
  }
  function start(view, done) {
    us.done = done;
    st.session.pick = null; st.session.result = null;
    st.view = view; st.again = paint; st.onLeave = unmount;
    credits();
  }

  var fp = {
    id: "fetal-planes", icon: "image", deck: "decks/fetal-planes.json", size: 12, newCap: 12,
    title: { en: "Fetal ultrasound planes", hi: "भ्रूण अल्ट्रासाउंड प्लेन" },
    sub: { en: "Name the plane on real scans", hi: "असली स्कैन पर प्लेन पहचानें" },
    items: function (d) { return (d.cases || []).map(function (c) { return { id: c.id, a: c.label, c: c }; }); },
    render: function (h, item, done) { start("us-planes", done); paint(st.session.i > 0 ? ".tus-stage" : null); }
  };
  var hc = {
    id: "hc-biometry", icon: "target", deck: "decks/hc-biometry.json", size: 8, newCap: 8,
    title: { en: "Head circumference", hi: "सिर की परिधि (HC)" },
    sub: { en: "Fit the ellipse, get HC and GA", hi: "ellipse बैठाएँ, HC और GA पाएँ" },
    items: function (d) { return (d.cases || []).map(function (c) { return { id: c.id, a: "hc", c: c }; }); },
    render: function (h, item, done) {
      var c = item.c;
      us.e = startEllipse(c.w, c.h); us.mode = "move";
      start("us-hc", done); paint(st.session.i > 0 ? ".tus-stage" : null);
    }
  };
  host.registerClinic(fp);
  host.registerClinic(hc);

  var A = I.ACTIONS;
  A["us-pick"] = function (b) {
    if (st.view !== "us-planes") return;
    st.session.pick = b.getAttribute("data-o");
    [].forEach.call(I.root().querySelectorAll("[data-act=us-pick]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    var chk = I.root().querySelector("[data-act=us-check]"), cnt = I.root().querySelector(".tus-view .tok-count");
    if (chk) chk.disabled = false; if (cnt) cnt.textContent = "";
  };
  A["us-check"] = function () { if (st.view === "us-planes") checkPlane(); };
  A["us-measure"] = function () { if (st.view === "us-hc") measure(); };
  A["us-next"] = function () { if (us.done) us.done(); };
  A["us-zoom"] = function () { if (us.stage) us.stage.zoomBy(2); };
  A["us-fit"] = function () { if (us.stage) us.stage.reset(); };
  A["us-retry"] = function () { paint(); };
  A["us-mode"] = function (b) {
    us.mode = b.getAttribute("data-m");
    [].forEach.call(I.root().querySelectorAll("[data-act=us-mode]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    var s = $("tusSteps"); if (s) s.innerHTML = stepBtns();
  };
  A["us-step"] = function (b, ev) { step(+b.getAttribute("data-x") || 0, +b.getAttribute("data-y") || 0, +b.getAttribute("data-d") || 0, ev && ev.shiftKey ? 10 : 1); };
  // Arrow keys on the focused image: the selected adjustment, Shift x10. Plus and minus zoom the plane images.
  var ARROWS = { ArrowLeft: [-1, 0, -1], ArrowRight: [1, 0, 1], ArrowUp: [0, -1, 1], ArrowDown: [0, 1, -1] };
  I.KEYS["us-hc"] = function (e) {
    var a = ARROWS[e.key];
    if (!a || !e.target || !e.target.closest || !e.target.closest(".tus-stage")) return;
    e.preventDefault();
    step(a[0], a[1], a[2], e.shiftKey ? 10 : 1);
  };
  // ES5 getters for the UI test.
  Object.defineProperty(host, "_us", { get: function () { return { e: us.e, mode: us.mode, stage: us.stage }; }, configurable: true });
  host.US_L10N = L10N;
})(typeof window !== "undefined" ? window : this);
