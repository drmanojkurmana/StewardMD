/* Tokos explorer model: mechanism of labour. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.TOKOS_MODELS["mechanism"].
   The eight movements are an ordered state model; each movement lists its plain-language description, the head
   position before and after (OA, OP, OT and the oblique positions), the pelvic level and the SVG frame that draws it.
   The station scale is the ACOG scale (0 at the ischial spines, -5 to +5 in cm). No number here is a clinical
   threshold; the geometry (angles between positions) is computed from the position table. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.TOKOS_MODELS = root.TOKOS_MODELS || {}; root.TOKOS_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var FRAME_DIR = "tokos/explorer/mechanism/";

  /* Head position = where the occiput points. angle: degrees from the mother's front, turning toward the mother's left
     (OA 0, LOA 45, LOT 90, LOP 135, OP 180, ROP 225, ROT 270, ROA 315). */
  var POSITIONS = {
    OA:  { angle: 0,   family: "anterior",   name: { en: "Occiput anterior (OA)", hi: "Occiput anterior (OA): सिर का पिछला हिस्सा सामने, pubis की ओर" } },
    LOA: { angle: 45,  family: "anterior",   name: { en: "Left occiput anterior (LOA)", hi: "Left occiput anterior (LOA): पिछला हिस्सा सामने और बाईं ओर" } },
    LOT: { angle: 90,  family: "transverse", name: { en: "Left occiput transverse (LOT)", hi: "Left occiput transverse (LOT): पिछला हिस्सा सीधा बाईं ओर" } },
    LOP: { angle: 135, family: "posterior",  name: { en: "Left occiput posterior (LOP)", hi: "Left occiput posterior (LOP): पिछला हिस्सा पीछे और बाईं ओर" } },
    OP:  { angle: 180, family: "posterior",  name: { en: "Occiput posterior (OP)", hi: "Occiput posterior (OP): पिछला हिस्सा पीछे, sacrum की ओर" } },
    ROP: { angle: 225, family: "posterior",  name: { en: "Right occiput posterior (ROP)", hi: "Right occiput posterior (ROP): पिछला हिस्सा पीछे और दाईं ओर" } },
    ROT: { angle: 270, family: "transverse", name: { en: "Right occiput transverse (ROT)", hi: "Right occiput transverse (ROT): पिछला हिस्सा सीधा दाईं ओर" } },
    ROA: { angle: 315, family: "anterior",   name: { en: "Right occiput anterior (ROA)", hi: "Right occiput anterior (ROA): पिछला हिस्सा सामने और दाईं ओर" } }
  };
  var ORDER_POS = ["OA", "LOA", "LOT", "LOP", "OP", "ROP", "ROT", "ROA"];

  /* Names of the parts that carry data-part attributes in the SVG frames (labels are data, never text in the picture). */
  var PARTS = {
    symphysis: { en: "Pubic symphysis", hi: "Pubic symphysis (जघन संधि)" },
    sacrum: { en: "Sacrum and coccyx", hi: "Sacrum और coccyx" },
    inlet: { en: "Pelvic inlet", hi: "Pelvic inlet (श्रोणि का ऊपरी द्वार)" },
    outlet: { en: "Pelvic outlet", hi: "Pelvic outlet (श्रोणि का निचला द्वार)" },
    spines: { en: "Ischial spines (station 0)", hi: "Ischial spines (कूल्हे की हड्डी के काँटे, station 0)" },
    head: { en: "Fetal head", hi: "शिशु का सिर" },
    occiput: { en: "Occiput (red dot)", hi: "Occiput (लाल बिंदु)" },
    chin: { en: "Chin", hi: "ठोड़ी (chin)" },
    shoulders: { en: "Shoulders", hi: "कंधे" },
    perineum: { en: "Perineum", hi: "Perineum (मूलाधार)" }
  };

  /* The eight movements, in the order they are learnt. level is the pelvic level of the head at that step.
     rotation: the head or shoulders turn, if any, worked out from the positions in sequence(). */
  var MOVEMENTS = [
    { id: "engagement", level: "inlet", parts: ["symphysis", "sacrum", "inlet", "spines", "head", "occiput"],
      title: { en: "Engagement", hi: "Engagement (सिर का श्रोणि में उतरना)" },
      what: { en: "The widest part of the head, the biparietal diameter, passes through the pelvic inlet. The head usually settles in the transverse position, the widest diameter of the inlet. Indian textbooks (DC Dutta) describe left occiput anterior, in the right oblique diameter, as the commonest position.",
              hi: "सिर का सबसे चौड़ा हिस्सा (biparietal diameter) pelvic inlet से पार हो जाता है। सिर आमतौर पर transverse स्थिति में बैठता है, जो inlet का सबसे चौड़ा व्यास है। भारतीय किताबें (DC Dutta) right oblique diameter में left occiput anterior को सबसे आम स्थिति बताती हैं।" },
      why: { en: "Fits the head to the widest diameter available at the inlet.", hi: "सिर को inlet के सबसे चौड़े व्यास में बिठाता है।" } },
    { id: "descent", level: "pelvis", parts: ["symphysis", "sacrum", "spines", "head", "occiput"],
      title: { en: "Descent", hi: "Descent (सिर का नीचे खिसकना)" },
      what: { en: "The head moves down the birth canal. It is the first requirement for birth and carries on during every other movement.",
              hi: "सिर birth canal में नीचे खिसकता है। यह जन्म की पहली शर्त है और बाकी हर movement के दौरान भी चलता रहता है।" },
      why: null },
    { id: "flexion", level: "pelvis", parts: ["symphysis", "sacrum", "spines", "head", "chin", "occiput"],
      title: { en: "Flexion", hi: "Flexion (ठोड़ी का सीने की ओर झुकना)" },
      what: { en: "The chin moves toward the chest, so the shorter suboccipitobregmatic diameter takes the place of the longer occipitofrontal diameter.",
              hi: "ठोड़ी सीने की ओर झुकती है, इसलिए लंबे occipitofrontal diameter की जगह छोटा suboccipitobregmatic diameter आगे आता है।" },
      why: { en: "A smaller diameter of the head meets the pelvis.", hi: "सिर का छोटा व्यास श्रोणि से गुज़रता है।" } },
    { id: "internal-rotation", level: "pelvic-floor", parts: ["symphysis", "sacrum", "outlet", "spines", "head", "occiput"],
      title: { en: "Internal rotation", hi: "Internal rotation (सिर का अंदर घूमना)" },
      what: { en: "The occiput turns toward the symphysis pubis, less often toward the hollow of the sacrum. In about two thirds of labours the turn is complete by the time the head reaches the pelvic floor, and in about another quarter shortly after.",
              hi: "Occiput symphysis pubis की ओर घूमता है, कम बार sacrum के गड्ढे की ओर। लगभग दो तिहाई प्रसवों में यह घुमाव सिर के pelvic floor तक पहुँचने तक पूरा हो जाता है, और लगभग एक चौथाई में उसके तुरंत बाद।" },
      why: null },
    { id: "extension", level: "introitus", parts: ["symphysis", "perineum", "head", "chin", "occiput"],
      title: { en: "Extension", hi: "Extension (सिर का पीछे की ओर मुड़ना)" },
      what: { en: "The flexed head reaches the vulva and extends: the base of the occiput comes against the lower margin of the symphysis pubis, and the head is born by extension.",
              hi: "मुड़ा हुआ सिर vulva तक पहुँचकर extend होता है: occiput का आधार symphysis pubis के निचले किनारे से टिकता है और सिर extension से जन्म लेता है।" },
      why: { en: "The curve of the hollow of the sacrum favours extension as the head goes further down.", hi: "Sacrum के गड्ढे का मोड़ सिर के और नीचे आने पर extension की ओर ले जाता है।" } },
    { id: "restitution", level: "delivered", parts: ["symphysis", "head", "shoulders", "occiput"],
      title: { en: "Restitution", hi: "Restitution (सिर का वापस घूमना)" },
      what: { en: "After the head is born it turns back toward the oblique position it had before internal rotation, undoing the twist between the head and the shoulders.",
              hi: "सिर के जन्म के बाद वह उस oblique स्थिति की ओर वापस घूमता है जो internal rotation से पहले थी, यानी सिर और कंधों के बीच की ऐंठन खुल जाती है।" },
      why: null },
    { id: "external-rotation", level: "delivered", parts: ["symphysis", "head", "shoulders", "occiput"],
      title: { en: "External rotation", hi: "External rotation (सिर का बाहर घूमना)" },
      what: { en: "The shoulders turn into the front-to-back diameter of the outlet, and the head turns with them to the transverse position. Some books treat restitution and external rotation as one movement.",
              hi: "कंधे outlet के आगे-पीछे वाले व्यास में घूमते हैं और सिर उनके साथ transverse स्थिति में आ जाता है। कुछ किताबें restitution और external rotation को एक ही movement मानती हैं।" },
      why: null },
    { id: "expulsion", level: "delivered", parts: ["symphysis", "perineum", "head", "shoulders"],
      title: { en: "Expulsion", hi: "Expulsion (शिशु का बाहर आना)" },
      what: { en: "The anterior shoulder appears under the symphysis pubis, the perineum stretches over the posterior shoulder, and the rest of the body follows quickly.",
              hi: "अगला कंधा symphysis pubis के नीचे दिखता है, perineum पिछले कंधे पर खिंचता है और बाकी शरीर जल्दी बाहर आ जाता है।" },
      why: null }
  ];
  var FRAME_FILES = ["01-engagement", "02-descent", "03-flexion", "04-internal-rotation", "05-extension", "06-restitution", "07-external-rotation", "08-expulsion"];
  MOVEMENTS.forEach(function (m, i) { m.order = i + 1; m.file = FRAME_DIR + FRAME_FILES[i] + ".svg"; });

  /* ACOG station: the pelvis above and below the ischial spines is divided into fifths at 1 cm intervals; 0 is the
     level of the spines, +5 is the head visible at the introitus. */
  var STATION = { min: -5, max: 5, unit: "cm" };
  function station(n) {
    if (typeof n !== "number" || n !== n || n < STATION.min || n > STATION.max) {
      return { ok: false, error: { en: "Station is a number from -5 to +5 (cm).", hi: "Station -5 से +5 (cm) के बीच की संख्या होती है।" } };
    }
    var level = n < 0 ? "above-spines" : n === 0 ? "at-spines" : n < STATION.max ? "below-spines" : "introitus";
    var label = {
      "above-spines": { en: "Above the ischial spines", hi: "Ischial spines से ऊपर" },
      "at-spines": { en: "At the ischial spines", hi: "Ischial spines के स्तर पर" },
      "below-spines": { en: "Below the ischial spines", hi: "Ischial spines से नीचे" },
      introitus: { en: "Head visible at the introitus", hi: "सिर introitus पर दिखता है" }
    }[level];
    return { ok: true, station: n, level: level, label: label, cmFromSpines: n };
  }

  function norm(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  /* Shortest turn from one position to another: degrees, the direction the occiput travels as seen from below
     (clockwise = front, then the mother's left), and the positions passed on the way. */
  function rotation(from, to) {
    var a = POSITIONS[from], b = POSITIONS[to];
    if (!a || !b) return { ok: false, error: { en: "Unknown position.", hi: "अज्ञात स्थिति।" } };
    var d = norm(b.angle - a.angle);
    if (d === 0) return { ok: true, degrees: 0, direction: "none", via: [] };
    var dir = d < 180 ? "clockwise" : d > 180 ? "anticlockwise" : "either"; // as seen from below (the right-hand picture)
    // a 180 degree turn has no shorter side; it is drawn past the mother's left, the side this model restitutes to
    var deg = d > 180 ? 360 - d : d, step = d >= 180 ? -45 : 45, via = [], ang = a.angle;
    for (var k = 1; k < deg / 45; k++) { ang = norm(ang + step); via.push(ORDER_POS[ang / 45]); }
    return { ok: true, degrees: deg, direction: dir, via: via };
  }
  function nearestPos(angle) { return ORDER_POS[Math.round(norm(angle) / 45) % 8]; }

  /* The mechanism for a head that engages in position `start`. The occiput turns to OA at internal rotation
     (persistentOP: it fails to turn forward and turns 45 degrees back to direct OP, born face to pubes); restitution
     turns it back 45 degrees, external rotation completes the turn to the transverse position on the side the occiput
     started (OA or OP start: the left, LOT). */
  function sequence(start, opts) {
    opts = opts || {};
    if (!POSITIONS[start]) return { ok: false, error: { en: "Unknown position.", hi: "अज्ञात स्थिति।" } };
    var pos = start, family = POSITIONS[start].family, steps = [], side = POSITIONS[start].angle > 0 && POSITIONS[start].angle < 180 ? 1 : POSITIONS[start].angle > 180 ? -1 : 1;
    var stayPosterior = !!opts.persistentOP && family === "posterior";
    var i, m, before, after, turn;
    for (i = 0; i < MOVEMENTS.length; i++) {
      m = MOVEMENTS[i]; before = pos; after = pos;
      if (m.id === "internal-rotation") { after = stayPosterior ? "OP" : "OA"; }
      else if (m.id === "restitution") { after = side === 1 ? "LOA" : "ROA"; if (stayPosterior) after = pos; }
      else if (m.id === "external-rotation") { after = side === 1 ? "LOT" : "ROT"; if (stayPosterior) after = pos; }
      turn = rotation(before, after);
      steps.push({ id: m.id, order: m.order, level: m.level, before: before, after: after, degrees: turn.degrees, direction: turn.direction, via: turn.via, file: m.file });
      pos = after;
    }
    var notes = [];
    if (stayPosterior) notes.push({ en: "The occiput did not turn forward: persistent occiput posterior. It turned back to direct occiput posterior, and the baby is born face to pubes. Restitution and external rotation are not modelled for this course.", hi: "Occiput आगे नहीं घूमा: persistent occiput posterior। वह पीछे घूमकर direct occiput posterior में आया और शिशु face to pubes पैदा होता है। इस स्थिति के लिए restitution और external rotation दिखाए नहीं गए।" });
    if ((start === "OA" || start === "OP") && !stayPosterior) notes.push({ en: "The side of restitution is not fixed for a head that starts in the midline; this model uses the left.", hi: "जो सिर midline से शुरू होता है उसके restitution की दिशा तय नहीं होती; यह model बाईं दिशा लेता है।" });
    return { ok: true, start: start, steps: steps, bornAs: stayPosterior ? "OP" : "OA", notes: notes };
  }

  return {
    id: "mechanism", kind: "explorer", group: "obstetrics", level: "mbbs",
    title: { en: "Mechanism of labour", hi: "प्रसव की क्रियाविधि (mechanism of labour)" },
    subtitle: { en: "The cardinal movements of the fetal head, step by step", hi: "शिशु के सिर के cardinal movements, एक-एक कदम" },
    sources: [
      { label: "Williams Obstetrics, 24th ed., chapter 22 Normal Labor (text as reproduced on obgynkey.com; movement definitions)", url: "https://obgynkey.com/normal-labor-3/" },
      { label: "Ahn KH, Oh MJ. Intrapartum ultrasound. Obstet Gynecol Sci 2014;57(6):427-435 (seven movements; ACOG station scale; persistent OP frequency)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4245334/" },
      { label: "Iversen JK, Kahrs BH, Eggebo TM. There are 4, not 7, cardinal movements in labor. Am J Obstet Gynecol MFM 2021;3(6):100436 (abstract only)", url: "https://pubmed.ncbi.nlm.nih.gov/34214716/" },
      { label: "OB-GYN 101, Mechanism of Normal Labor, Brookside Associates (head assumes occiput transverse; restitution)", url: "https://oacapps.med.jhmi.edu/OBGYN-101/Text/Labor%20and%20Delivery/mechanism_of_normal_labor.htm" }
    ],
    review: "ai_drafted",
    notes: {
      sevenOrEight: { en: "Textbooks list seven movements (engagement, descent, flexion, internal rotation, extension, external rotation, expulsion) and treat restitution as part of external rotation. This explorer shows restitution as its own step so the turn back can be seen.", hi: "किताबें सात movements गिनती हैं (engagement, descent, flexion, internal rotation, extension, external rotation, expulsion) और restitution को external rotation का हिस्सा मानती हैं। यहाँ restitution को अलग कदम दिखाया गया है ताकि वापस घूमना दिखे।" },
      sideView: { en: "The left picture is a side view drawn as if the occiput were anterior, the usual textbook view, so that flexion and extension can be seen. The right picture is the view from below and shows the true position of the occiput.", hi: "बायाँ चित्र side view है जिसे occiput anterior मानकर बनाया गया है (आम textbook view), ताकि flexion और extension दिखें। दायाँ चित्र नीचे से देखा गया दृश्य है और occiput की असली स्थिति दिखाता है।" },
      viewFromBelow: { en: "View from below: the front of the mother is at the top and the mother's left is on the right of the picture.", hi: "नीचे से दृश्य: माँ का सामने का हिस्सा ऊपर है और माँ का बायाँ हिस्सा चित्र के दाईं ओर है।" },
      estimate: { en: "Pictures are diagrams, not to scale.", hi: "चित्र केवल आरेख हैं, पैमाने के अनुसार नहीं।" }
    },
    frameDir: FRAME_DIR,
    positions: POSITIONS, positionOrder: ORDER_POS, parts: PARTS, movements: MOVEMENTS,
    stationScale: STATION, station: station, rotation: rotation, sequence: sequence, nearestPosition: nearestPos,
    movement: function (id) { for (var i = 0; i < MOVEMENTS.length; i++) if (MOVEMENTS[i].id === id) return MOVEMENTS[i]; return null; }
  };
});
