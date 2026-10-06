/* Narkē explorer model: dermatomes and the height of a neuraxial block. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["dermatomes"].
   The dermatomes run C2 (highest) to S5 (lowest). A spinal or epidural "level" is the highest dermatome that has lost
   sensation (to cold or pinprick); everything below it is blocked. Surface landmarks: T4 nipple line, T6 xiphoid,
   T10 umbilicus, L1 inguinal ligament (Morgan and Mikhail 7e, chapter 45; Miller 9e).
   Levels needed for operations follow Morgan and Mikhail 7e, Table 45-3; caesarean delivery needs T4
   (Miller 9e, obstetric anaesthesia). The sympathetic block usually reaches about 2 segments above the sensory level
   and the motor block about 2 below it (Morgan and Mikhail). Cardiac accelerator fibres arise from T1 to T4;
   the phrenic nerve from C3 to C5. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var LEVELS = [], i;
  for (i = 2; i <= 8; i++) LEVELS.push("C" + i);
  for (i = 1; i <= 12; i++) LEVELS.push("T" + i);
  for (i = 1; i <= 5; i++) LEVELS.push("L" + i);
  for (i = 1; i <= 5; i++) LEVELS.push("S" + i);
  var SYMP_ABOVE = 2, MOTOR_BELOW = 2;

  var T = function (en, hi) { return { en: en, hi: hi }; };
  var LANDMARKS = [
    { level: "T4", name: T("Nipple line", "Nipple की रेखा") },
    { level: "T6", name: T("Xiphoid", "Xiphoid") },
    { level: "T10", name: T("Umbilicus", "नाभि (umbilicus)") },
    { level: "L1", name: T("Inguinal ligament", "Inguinal ligament") }
  ];
  // Morgan and Mikhail 7e Table 45-3, plus caesarean delivery (T4).
  var OPERATIONS = [
    { id: "caesarean", level: "T4", name: T("Caesarean delivery", "Caesarean delivery (सिज़ेरियन)") },
    { id: "upper-abdominal", level: "T4", name: T("Upper abdominal surgery", "ऊपरी पेट की surgery") },
    { id: "pelvic", level: "T6", name: T("Bowel, gynaecological pelvic, ureter and renal pelvis surgery", "आँत, स्त्री रोग pelvic, ureter और renal pelvis surgery") },
    { id: "turp-distension", level: "T10", name: T("TURP with bladder distension", "Bladder distension के साथ TURP") },
    { id: "hip", level: "T10", name: T("Hip surgery; vaginal delivery", "Hip surgery; vaginal delivery") },
    { id: "thigh", level: "L1", name: T("Thigh surgery; lower leg amputation; TURP without bladder distension", "जांघ की surgery; निचले पैर का amputation; बिना bladder distension के TURP") },
    { id: "foot", level: "L2", name: T("Foot and ankle surgery", "पैर और टखने की surgery") },
    { id: "perineal", level: "S2", name: T("Perineal and perianal surgery", "Perineal और perianal surgery") }
  ];

  function idx(l) { return LEVELS.indexOf(l); }
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function at(k) { return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, k))]; }

  /* block(level, operationId?): what a sensory level of the level covers, and whether it is enough for the operation. */
  function block(level, opId) {
    var k = idx(level);
    if (k < 0) return bad("Level is a dermatome from C2 to S5.", "Level C2 से S5 तक का dermatome है।");
    var op = null, j;
    for (j = 0; j < OPERATIONS.length; j++) if (OPERATIONS[j].id === opId) op = OPERATIONS[j];
    if (opId && !op) return bad("Unknown operation.", "अज्ञात operation।");
    var sympK = k - SYMP_ABOVE, motorK = k + MOTOR_BELOW;
    var warnings = [];
    if (k <= idx("C8")) warnings.push({ id: "high", text: T("Cervical level: a high or total spinal. Expect arm weakness, trouble breathing and speaking; C3 to C5 block stops the diaphragm.", "Cervical level: high या total spinal। हाथ कमज़ोर, साँस और बोलने में दिक़्क़त; C3 से C5 block diaphragm रोक देता है।") });
    if (sympK <= idx("T4")) warnings.push({ id: "cardiac", text: T("The sympathetic block likely reaches T1 to T4, the cardiac accelerator fibres: watch for bradycardia and hypotension.", "Sympathetic block शायद T1 से T4 (cardiac accelerator fibres) तक है: bradycardia और hypotension पर नज़र रखें।") });
    var covered = [];
    LANDMARKS.forEach(function (lm) { if (idx(lm.level) >= k) covered.push(lm.level); });
    return {
      ok: true, level: level, index: k, sympathetic: at(sympK), motor: at(motorK),
      blocked: LEVELS.slice(k), landmarksCovered: covered,
      operation: op ? { id: op.id, needs: op.level, enough: k <= idx(op.level), gap: Math.max(0, k - idx(op.level)) } : null,
      warnings: warnings
    };
  }

  /* landmarkFor(level): the nearest named landmark at or below a level, or null. */
  function landmarkFor(level) {
    var k = idx(level), best = null;
    LANDMARKS.forEach(function (lm) { if (idx(lm.level) === k) best = lm; });
    return best;
  }

  return {
    id: "dermatomes", kind: "explorer", group: "regional", level: "mbbs",
    title: { en: "Dermatomes and block height", hi: "Dermatomes और block की ऊँचाई" },
    subtitle: { en: "Set the level of a spinal and see what it covers and what it is enough for", hi: "Spinal का level चुनें और देखें कि यह क्या ढकता है और किसके लिए काफ़ी है" },
    sources: [
      { label: "Butterworth JF, Mackey DC, Wasnick JD. Morgan and Mikhail's Clinical Anesthesiology, 7th edition, chapter 45 (dermatomal landmarks; Table 45-3, block levels for operations; sympathetic and motor levels)" },
      { label: "Miller's Anesthesia, 9th edition, chapters on spinal, epidural and caudal anaesthesia and on obstetric anaesthesia (T4 for caesarean delivery)" },
      { label: "Ajay Yadav. Short Textbook of Anaesthesia, chapter on spinal anaesthesia (Indian standard)" }
    ],
    review: "ai_drafted",
    notes: {
      level: { en: "The level is the highest dermatome with lost sensation. Test cold or pinprick on both sides.", hi: "Level वह सबसे ऊँचा dermatome है जहाँ संवेदना नहीं है। दोनों तरफ़ ठंडक या pinprick से जाँचें।" },
      spread: { en: "Sympathetic block usually sits about 2 segments above the sensory level, motor block about 2 below.", hi: "Sympathetic block आमतौर पर sensory level से लगभग 2 segment ऊपर, motor block लगभग 2 नीचे होता है।" },
      visceral: { en: "Pulling on the peritoneum can be felt above the skin level. This is one reason caesarean delivery needs T4.", hi: "Peritoneum खींचना त्वचा के level से ऊपर महसूस हो सकता है। यही एक कारण है कि caesarean delivery में T4 चाहिए।" },
      drawing: { en: "The body map is a simple original diagram. Real dermatomes overlap and vary between people.", hi: "शरीर का नक्शा एक सरल मूल चित्र है। असली dermatomes एक-दूसरे पर चढ़ते हैं और लोगों में अलग होते हैं।" }
    },
    levels: LEVELS, landmarks: LANDMARKS, operations: OPERATIONS,
    constants: { sympatheticAbove: SYMP_ABOVE, motorBelow: MOTOR_BELOW },
    block: block, landmarkFor: landmarkFor, index: idx
  };
});
