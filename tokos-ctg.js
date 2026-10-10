/* Tokós CTG clinic: a clinic plugin on the specialty engine (host.registerClinic). ES5.
   Pure part (node and browser, window.TOKOS_CTG): the FIGO checklist, the answer key with reviewer overrides, grading,
   the teaching points a case shows, and the labels a reviewer confirms (Review Desk, scripts/apply-reviews.mjs).
   UI part (browser): per case a vignette, the inline trace with calipers and zoom, the FIGO checklist, then the reveal
   (concordance, trace features, recorded outcome at birth, why). The engine runs the session (FSRS deck key
   ctg.<level>), the Resident trial gate (clinic.ctg, before any fetch), the done screen and TOKOS.openCase.
   Numbers stay plain ASCII digits in both languages; only labels translate. */
(function (G) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./specialty-core.js") : G.SPECIALTY_CORE;

  /* ---------- FIGO checklist (v2). MBBS: 5 reading questions. Resident: plus the FIGO action, and the
     deceleration type only where an obstetrician confirmed it (case.review.decelType). ---------- */
  var QUESTIONS = {
    uc: ["normal", "tachysystole"],
    baseline: ["severe_bradycardia", "bradycardia", "normal", "tachycardia"],
    variability: ["reduced", "normal", "increased"],
    decels: ["none", "present", "prolonged", "over5"],
    decelType: ["early", "late", "variable", "prolonged"],
    figo: ["normal", "suspicious", "pathological"],
    action: ["normal", "suspicious", "pathological"] // answer ids reuse the category; labels carry the FIGO action text
  };
  function checklistFor(c, level) {
    var q = ["uc", "baseline", "variability", "decels", "figo"];
    if (level !== "resident") return q;
    if (rev(c.review || {}, "decelType", "decelType")) q.push("decelType");
    q.push("action");
    return q;
  }
  /* A reviewer's label (case.review.<field>) wins over the rule for every graded field: uc, baselineClass,
     variability, decels, decelType, figo (action always follows figo). A value outside QUESTIONS is ignored. */
  function rev(r, field, q) { return r[field] != null && QUESTIONS[q].indexOf(r[field]) >= 0 ? r[field] : null; }
  function truthFor(c) {
    var f = c.features, r = c.review || {}, maxD = 0;
    (f.decels || []).forEach(function (d) { if (d.durationSec > maxD) maxD = d.durationSec; });
    var figo = rev(r, "figo", "figo") || c.figo;
    var t = {
      uc: rev(r, "uc", "uc") || (f.contractions.tachysystole ? "tachysystole" : "normal"),
      baseline: rev(r, "baselineClass", "baseline") || f.baselineClass,
      variability: rev(r, "variability", "variability") || f.variability.band,
      decels: rev(r, "decels", "decels") || (!f.decels || !f.decels.length ? "none" : maxD > 300 ? "over5" : maxD > 180 ? "prolonged" : "present"),
      figo: figo, action: figo
    };
    if (rev(r, "decelType", "decelType")) t.decelType = r.decelType;
    return t;
  }
  // Complete review: the obstetrician confirmed every graded field and set review.complete = true. Only then does the
  // reveal drop the "Rule-based, pending obstetrician review" banner.
  function reviewComplete(c) { return !!(c && c.review && c.review.complete === true); }
  /* The labels a reviewer confirms by approving a case in the Review Desk. decelType only when every deceleration has
     the same suggested subtype; a mixed case keeps the Resident deceleration type question off. */
  function suggestedReview(c) {
    var t = truthFor(c), r = { uc: t.uc, baselineClass: t.baseline, variability: t.variability, decels: t.decels, figo: t.figo };
    var types = ((c.features && c.features.decels) || []).map(function (d) { return d.subtypeSuggested; });
    if (t.decelType) r.decelType = t.decelType;
    else if (types.length && types.every(function (x) { return x === types[0]; }) && QUESTIONS.decelType.indexOf(types[0]) >= 0) r.decelType = types[0];
    if (c.acidosis) r.acidosis = c.acidosis;
    return r;
  }
  function gradeChecklist(ids, answers, truth) {
    var perQ = {}, m = 0;
    ids.forEach(function (q) { perQ[q] = answers[q] === truth[q]; if (perQ[q]) m++; });
    var pct = ids.length ? m / ids.length : 0, g;
    if (pct < 0.5) g = C.AGAIN;
    else if (!perQ.figo) g = C.HARD; // the overall category is the clinically critical call
    else if (pct < 0.8) g = C.HARD;
    else if (pct < 1) g = C.GOOD;
    else g = C.EASY;
    return { matches: m, total: ids.length, pct: pct, grade: g, perQ: perQ };
  }
  function rationaleKeys(c) {
    var t = truthFor(c), k = [];
    if (t.baseline !== "normal") k.push("baseline." + t.baseline);
    if (t.variability !== "normal") k.push("variability." + t.variability);
    if (t.decels !== "none") k.push("decels." + t.decels);
    if (t.uc === "tachysystole") k.push("uc.tachysystole");
    if (c.acidosis === "metabolic" || c.acidosis === "acidaemia_not_metabolic") k.push("acidosis." + c.acidosis);
    ((c.vignette && c.vignette.risks) || []).forEach(function (r) { if (r === "pyrexia" || r === "preeclampsia") k.push("risk." + r); });
    k.push("trace_vs_outcome");
    return k;
  }

  // Teaching only for the questions the learner missed; a right answer needs no note.
  function missedKeys(c, missed) {
    var t = truthFor(c), k = [];
    missed.forEach(function (id) {
      if (id === "uc" && t.uc === "tachysystole") k.push("uc.tachysystole");
      if (id === "baseline" && t.baseline !== "normal") k.push("baseline." + t.baseline);
      if (id === "variability" && t.variability !== "normal") k.push("variability." + t.variability);
      if ((id === "decels" || id === "decelType") && t.decels !== "none") k.push("decels." + t.decels);
      if (id === "figo" || id === "action") k.push("trace_vs_outcome");
    });
    return k.filter(function (x, i) { return k.indexOf(x) === i; });
  }

  /* ---------- words (Review Desk shows the checklist labels from here) ---------- */
  var L10N = {
    en: { contractions: "Contractions", baseline: "Baseline heart rate", variability: "Variability", decels: "Decelerations", decelType: "Deceleration type",
      figo: "Overall (FIGO 2015)", action: "Next step", submit: "Check my reading", next: "Next case", caliper: "Calipers",
      bpmMode: "Measure bpm", timeMode: "Measure time", grid: "1 major square = 1 minute", quality: "Signal quality", rule: "Rule-based, pending obstetrician review",
      yours: "Yours", key: "Answer", features: "Trace features", outcome: "Recorded outcome at birth", why: "Why", notRecorded: "not recorded", nextReview: "Next review in",
      days: "days", day: "day", vignette: "Patient", weeks: "weeks", age: "Age", gp: "G/P", stage2: "Second stage", min: "min", induced: "Induced labour",
      risks: { diabetes: "Diabetes", hypertension: "Hypertension", preeclampsia: "Pre-eclampsia", pyrexia: "Maternal fever", meconium: "Meconium" },
      opts: {
        uc: { normal: "5 or fewer in 10 min", tachysystole: "More than 5 in 10 min (tachysystole)" },
        baseline: { severe_bradycardia: "Below 100", bradycardia: "100 to 109", normal: "110 to 160", tachycardia: "Above 160" },
        variability: { reduced: "Below 5 bpm", normal: "5 to 25 bpm", increased: "Above 25 bpm" },
        decels: { none: "None", present: "Present, under 3 min", prolonged: "Prolonged, 3 to 5 min", over5: "Over 5 min" },
        decelType: { early: "Early", late: "Late", variable: "Variable", prolonged: "Prolonged" },
        figo: { normal: "Normal", suspicious: "Suspicious", pathological: "Pathological" },
        action: { normal: "No intervention needed to improve fetal oxygenation", suspicious: "Correct reversible causes, monitor closely or add other methods", pathological: "Act now: correct reversible causes, add other methods, or expedite delivery if that is not possible" }
      },
      backHub: "Back to Test", traceLoading: "Loading trace…", traceErr: "Could not load this trace.", tryAgain: "Try again",
      caseOf: "Case {i} of {n}", answered: "{a} of {n} answered", match: "match the key", matchOne: "Match", noMatch: "No match",
      gest: "Gestation", fit: "Fit", zoomIn: "Zoom in", zoomHint: "Pinch or double-tap the strip to zoom",
      pH: "pH", bdecf: "BDecf", pco2: "pCO2", apgar: "Apgar at 1 and 5 min", weight: "Birth weight", window: "in the last {m} min", longest: "longest {s} s", per10: "per 10 min",
      traceAria: "CTG trace, last {m} min", calPrompt: "Drag a line, or use the buttons below, to measure",
      lineGroup: "Caliper line", lineN: "Line {n}", s: "s", learnThis: "Learn this: {t}",
      bpmDown: "Move line {n} down 1 bpm", bpmUp: "Move line {n} up 1 bpm", timeDown: "Move line {n} 1 second earlier", timeUp: "Move line {n} 1 second later" },
    hi: { contractions: "संकुचन", baseline: "बेसलाइन हृदय गति", variability: "परिवर्तनशीलता", decels: "डिसेलेरेशन", decelType: "डिसेलेरेशन का प्रकार",
      figo: "कुल वर्गीकरण (FIGO 2015)", action: "अगला कदम", submit: "मेरी रीडिंग जांचें", next: "अगला केस", caliper: "कैलिपर",
      bpmMode: "bpm मापें", timeMode: "समय मापें", grid: "1 बड़ा खाना = 1 मिनट", quality: "सिग्नल गुणवत्ता", rule: "नियम-आधारित, प्रसूति विशेषज्ञ की समीक्षा बाकी",
      yours: "आपका", key: "उत्तर", features: "ट्रेस की विशेषताएं", outcome: "जन्म के समय दर्ज परिणाम", why: "क्यों", notRecorded: "दर्ज नहीं", nextReview: "अगली समीक्षा",
      days: "दिन में", day: "दिन में", vignette: "मरीज़", weeks: "सप्ताह", age: "आयु", gp: "G/P", stage2: "दूसरा चरण", min: "मिनट", induced: "प्रेरित प्रसव",
      risks: { diabetes: "मधुमेह", hypertension: "उच्च रक्तचाप", preeclampsia: "प्री-एक्लेम्पसिया", pyrexia: "माँ को बुखार", meconium: "मेकोनियम" },
      opts: {
        uc: { normal: "10 मिनट में 5 या कम", tachysystole: "10 मिनट में 5 से अधिक (टैकीसिस्टोल)" },
        baseline: { severe_bradycardia: "100 से कम", bradycardia: "100 से 109", normal: "110 से 160", tachycardia: "160 से अधिक" },
        variability: { reduced: "5 bpm से कम", normal: "5 से 25 bpm", increased: "25 bpm से अधिक" },
        decels: { none: "कोई नहीं", present: "मौजूद, 3 मिनट से कम", prolonged: "लंबा, 3 से 5 मिनट", over5: "5 मिनट से अधिक" },
        decelType: { early: "अर्ली", late: "लेट", variable: "वेरिएबल", prolonged: "प्रोलॉन्ग्ड" },
        figo: { normal: "सामान्य", suspicious: "संदिग्ध", pathological: "पैथोलॉजिकल" },
        action: { normal: "भ्रूण ऑक्सीजनेशन सुधारने के लिए किसी हस्तक्षेप की आवश्यकता नहीं", suspicious: "प्रतिवर्ती कारणों को ठीक करें, कड़ी निगरानी रखें या अन्य तरीके जोड़ें", pathological: "तुरंत कार्रवाई: प्रतिवर्ती कारण ठीक करें, अन्य तरीके जोड़ें, या संभव न हो तो प्रसव शीघ्र कराएं" }
      },
      backHub: "टेस्ट पर वापस", traceLoading: "ट्रेस लोड हो रहा है…", traceErr: "यह ट्रेस लोड नहीं हो सका।", tryAgain: "फिर कोशिश करें",
      caseOf: "केस {i} / {n}", answered: "{n} में से {a} उत्तर दिए", match: "उत्तर से मेल", matchOne: "मेल", noMatch: "मेल नहीं",
      gest: "गर्भकाल", fit: "पूरा", zoomIn: "ज़ूम करें", zoomHint: "ज़ूम के लिए स्ट्रिप पर पिंच या डबल-टैप करें",
      pH: "pH", bdecf: "BDecf (बेस डेफिसिट)", pco2: "pCO2", apgar: "अपगार, 1 और 5 मिनट पर", weight: "जन्म का वज़न", window: "आखिरी {m} मिनट में", longest: "सबसे लंबा {s} सेकंड", per10: "प्रति 10 मिनट",
      traceAria: "CTG ट्रेस, आखिरी {m} मिनट", calPrompt: "मापने के लिए रेखा खींचें, या नीचे के बटन इस्तेमाल करें",
      lineGroup: "कैलिपर रेखा", lineN: "रेखा {n}", s: "सेकंड", learnThis: "यह सीखें: {t}",
      bpmDown: "रेखा {n} को 1 bpm नीचे करें", bpmUp: "रेखा {n} को 1 bpm ऊपर करें", timeDown: "रेखा {n} को 1 सेकंड पहले करें", timeUp: "रेखा {n} को 1 सेकंड बाद करें" }
  };

  var API = { QUESTIONS: QUESTIONS, checklistFor: checklistFor, truthFor: truthFor, suggestedReview: suggestedReview, reviewComplete: reviewComplete,
    gradeChecklist: gradeChecklist, rationaleKeys: rationaleKeys, missedKeys: missedKeys, L10N: L10N };
  if (node) { module.exports = API; return; }
  G.TOKOS_CTG = API;

  /* ================= the clinic plugin ================= */
  var host = G.TOKOS;
  if (!host || !host.registerClinic || !G.document) return;
  var I = host._internal, st = host._st, S = G.SPECIALTY_STAGE;
  var cs = { cal: null, stage: null, ro: null, done: null, rationale: null };
  var QLABEL = { uc: "contractions", baseline: "baseline", variability: "variability", decels: "decels", decelType: "decelType", figo: "figo", action: "action" };
  function $(id) { return G.document.getElementById(id); }
  function esc(s) { return I.esc(s); }
  function W() { return L10N[I.lang()]; }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] == null ? m : o[k]; }); }
  function num(v, unit) { return v == null || v !== v ? W().notRecorded : String(v) + (unit ? " " + unit : ""); } // plain ASCII digits in both languages
  function icoH(n) { var i = I.ico(n); return i ? '<span class="tok-i" aria-hidden="true">' + i + "</span>" : ""; }
  function level() { return I.level(); }
  function deckKey() { return "ctg." + level(); }
  function current() { var s = st.session; return s && s.list[s.i] ? s.list[s.i].c : null; }
  function caseLine() { var s = st.session; return fmt(W().caseOf, { i: s.i + 1, n: s.list.length }); }
  function title() { return esc(I.t(spec.title)); }

  // The teaching points load once, with the case deck (the engine loads decks/ctg.json itself).
  function rationale() {
    if (!cs.rationale) cs.rationale = I.getJSON("rationale.json").then(function (r) { cs.rationaleData = r; return r; }, function () { cs.rationale = null; return null; });
    return cs.rationale;
  }

  function unmountTrace() {
    if (cs.ro) { try { cs.ro.disconnect(); } catch (e) {} cs.ro = null; }
    if (cs.cal) { try { cs.cal.destroy(); } catch (e) {} }
    cs.cal = null; cs.stage = null;
  }
  // Clinic and reveal repaint in place (language, re-render): the trace remounts from the in-memory SVG.
  function paint(focusSel) {
    unmountTrace();
    var c = current();
    if (!c) return;
    I.paint(st.view === "reveal" ? renderReveal() : renderClinic(), typeof focusSel === "string" ? focusSel : null);
    if (st.view === "clinic") mountTrace(c);
  }

  function renderVignette(c) {
    var v = c.vignette || {}, w = W(), cells = [];
    function cell(val, label) { cells.push('<div class="tok-vc"><b>' + val + "</b><span>" + esc(label) + "</span></div>"); }
    if (v.gestWeeks != null) cell(esc(v.gestWeeks) + " <small>" + esc(w.weeks) + "</small>", w.gest);
    if (v.age != null) cell(esc(v.age), w.age);
    if (v.gravidity != null && v.parity != null) cell(esc(v.gravidity + "/" + v.parity), w.gp);
    if (v.stage2Min != null) cell(esc(v.stage2Min) + " <small>" + esc(w.min) + "</small>", w.stage2);
    // Risks stay [] until the header codings are confirmed; the chips render nothing today.
    var chips = (v.risks || []).map(function (r) { return '<span class="tok-chip">' + esc(w.risks[r] || r) + "</span>"; }).join("");
    if (v.induced) chips += '<span class="tok-chip">' + esc(w.induced) + "</span>";
    return '<section class="tok-vignette" tabindex="-1" aria-label="' + esc(w.vignette) + '"><div class="tok-vrow">' + cells.join("") + "</div>" + (chips ? '<div class="tok-chips">' + chips + "</div>" : "") + "</section>";
  }
  function renderChecklist(c) {
    var w = W(), ids = checklistFor(c, level()), a = st.session.answers, n = 0;
    var q = ids.map(function (id) {
      if (a[id]) n++;
      return '<fieldset class="tok-q" data-q="' + id + '"><legend>' + esc(w[QLABEL[id]]) + '</legend><div class="tok-opts">' +
        QUESTIONS[id].map(function (o) {
          var on = a[id] === o;
          return '<button type="button" class="tok-opt' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="ans" data-q="' + id + '" data-o="' + o + '">' + esc(w.opts[id][o]) + "</button>";
        }).join("") + "</div></fieldset>";
    }).join("");
    return q + '<div class="tok-foot"><span class="tok-count" aria-live="polite">' + esc(fmt(w.answered, { a: n, n: ids.length })) + "</span>" +
      '<button type="button" class="tok-btn pri" data-act="reveal"' + (n === ids.length ? "" : " disabled") + ">" + esc(w.submit) + "</button></div>";
  }
  function stepLabel(d, m, n) { var w = W(); return fmt(m === "bpm" ? (d > 0 ? w.bpmUp : w.bpmDown) : (d > 0 ? w.timeUp : w.timeDown), { n: n }); }
  function stepText(d, m) { return (d > 0 ? "+1" : "−1") + "<small>" + esc(m === "bpm" ? "bpm" : W().s) + "</small>"; }
  function stepBtn(d, m, n) { return '<button type="button" class="tok-icon tok-step" data-act="nudge" data-d="' + d + '" aria-label="' + esc(stepLabel(d, m, n)) + '">' + stepText(d, m) + "</button>"; }
  function renderClinic() {
    var c = current(), w = W(), L = c.layout, q = c.stripQuality || {}, sig = q.fhrLossPct == null ? null : Math.round(100 - q.fhrLossPct); // the displayed strip
    return I.top(w.backHub, title(), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll tok-clinic-view"><div class="tok-pad">' + renderVignette(c) + "</div>" +
      '<div class="tok-strip-head tok-pad"><span>' + esc(w.grid) + '</span><span class="tok-quality' + (sig != null && sig < 90 ? " low" : "") + '">' + esc(w.quality) + " " + (sig == null ? esc(w.notRecorded) : sig + "%") + "</span></div>" +
      '<div class="tok-hold">' +
        '<div class="tok-stage" id="tokStage" style="aspect-ratio:' + L.W + " / " + L.H + '"><div class="tok-loading-trace" id="tokTraceSlot" aria-busy="true">' + esc(w.traceLoading) + "</div></div>" +
        '<output id="tokCalOut" class="tok-read tok-pad idle" aria-live="polite">' + esc(w.calPrompt) + "</output>" +
      "</div>" +
      '<div class="tok-cal-bar tok-pad">' +
        '<div class="tok-seg sm" role="group" aria-label="' + esc(w.caliper) + '">' +
          '<button type="button" data-act="cal" data-m="bpm" aria-pressed="true">' + esc(w.bpmMode) + '</button><button type="button" data-act="cal" data-m="time" aria-pressed="false">' + esc(w.timeMode) + "</button></div>" +
        '<div class="tok-zoom"><button type="button" class="tok-icon" data-act="zoom" aria-label="' + esc(w.zoomIn) + '" title="' + esc(w.zoomHint) + '">' + (icoH("plus") || "+") + '</button><button type="button" class="tok-icon tok-fit" data-act="fit">' + esc(w.fit) + "</button></div>" +
        '<div class="tok-seg sm" role="group" aria-label="' + esc(w.lineGroup) + '">' +
          '<button type="button" data-act="line" data-l="1" aria-pressed="true">' + esc(fmt(w.lineN, { n: 1 })) + '</button><button type="button" data-act="line" data-l="2" aria-pressed="false">' + esc(fmt(w.lineN, { n: 2 })) + "</button></div>" +
        '<div class="tok-zoom">' + stepBtn(-1, "bpm", 1) + stepBtn(1, "bpm", 1) + "</div>" +
      "</div>" +
      '<div class="tok-pad" id="tokChecklist">' + renderChecklist(c) + "</div></div>";
  }

  // Inline SVG so the calipers can map pointer positions into viewBox units. Our own generated file: class names only,
  // no <style>, no scripts.
  function mountTrace(c) {
    var slot = $("tokTraceSlot"); if (!slot) return;
    var p = st.svg[c.svg] ? Promise.resolve(st.svg[c.svg]) : G.fetch(I.BASE + "media/" + c.svg).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
    p.then(function (txt) {
      var stage = $("tokStage"); if (!stage || current() !== c || st.view !== "clinic") return;
      var svg = safeSvg(txt);
      if (!svg) throw new Error("unsafe svg");
      st.svg[c.svg] = txt;
      stage.innerHTML = ""; stage.appendChild(svg);
      var L = c.layout; svg.id = "tokTrace"; svg.setAttribute("data-src", c.svg);
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", fmt(W().traceAria, { m: L.durationSec / 60 }));
      // bpm labels sit inside the plot so a legible size is never clipped by the narrow left margin, and every other
      // FHR label is dropped (40 bpm steps) so they never collide at phone width.
      [].forEach.call(svg.querySelectorAll(".tk-axis"), function (t) {
        t.setAttribute("x", L.padL + 6); t.setAttribute("text-anchor", "start");
        var v = +t.textContent; if (+t.getAttribute("y") < L.yTop + L.hFhr + 1 && v % 40) t.setAttribute("class", "tk-axis tk-axis-odd");
      });
      // Non-scaling strokes ignore the stage's CSS scale, so the stage publishes it as --k and the stroke and label sizes
      // divide by it: lines and labels keep one on-screen size at every zoom.
      if (G.MutationObserver) {
        var mo = new G.MutationObserver(function () { var m = /scale\(([\d.]+)\)/.exec(svg.style.transform); stage.style.setProperty("--k", m ? m[1] : 1); });
        mo.observe(svg, { attributes: true, attributeFilter: ["style"] });
      }
      cs.stage = S.attach(stage, svg); cs.stage.reset();
      if (G.ResizeObserver) { cs.ro = new G.ResizeObserver(function () { if (cs.stage) cs.stage.reset(); }); cs.ro.observe(stage); }
      // Neutral start: the lines sit a few bpm either side of this strip's baseline, and the readout prompts instead of
      // showing a verdict until the learner moves a line (drag or stepper).
      st.calMoved = { bpm: false, time: false }; st.calLine = 1;
      cs.cal = G.TOKOS_CALIPERS.attach(svg, L, function (s, reason, key) {
        if (reason === "drag") { st.calMoved[s.mode] = true; st.calLine = key === "y2" || key === "x2" ? 2 : 1; syncCal(); }
        calOut();
      });
      var K = G.TOKOS_CALIPERS, b = (c.features && c.features.baseline) || 140;
      cs.cal.set("y1", K.yForBpm(L, b + 8)); cs.cal.set("y2", K.yForBpm(L, b - 8));
      cs.cal.set("x1", L.padL + L.plotW * 0.46); cs.cal.set("x2", L.padL + L.plotW * 0.54);
      syncCal(); calOut();
    }).catch(function () {
      var s2 = $("tokStage"); if (s2) s2.innerHTML = '<div class="tok-err tok-err-trace" role="alert"><p>' + esc(W().traceErr) + '</p><button type="button" class="tok-btn sec" data-act="retrace">' + esc(W().tryAgain) + "</button></div>";
    });
  }
  // Our own renderer's SVG, still parsed as data: anything scriptable is refused and only the <svg> element is adopted.
  function safeSvg(txt) {
    try {
      var doc = new G.DOMParser().parseFromString(txt, "image/svg+xml"), r = doc.documentElement;
      if (!r || r.localName !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
      if (r.getElementsByTagName("script").length || r.getElementsByTagName("foreignObject").length) return null;
      var all = [r].concat([].slice.call(r.getElementsByTagName("*")));
      for (var i = 0; i < all.length; i++) {
        for (var j = 0; j < all[i].attributes.length; j++) {
          var at = all[i].attributes[j];
          if (/^on/i.test(at.name) || (/href$/i.test(at.name) && /^\s*javascript:/i.test(at.value))) return null;
        }
      }
      return G.document.importNode(r, true);
    } catch (e) { return null; }
  }

  /* ---------- calipers: readout, line choice, keyboard steppers ---------- */
  function calOut() {
    var o = $("tokCalOut"); if (!o || !cs.cal) return;
    var m = cs.cal.state().mode, moved = st.calMoved && st.calMoved[m];
    o.textContent = moved ? cs.cal.readout(I.lang()) : W().calPrompt;
    o.classList.toggle("idle", !moved);
  }
  function syncCal() {
    var el = I.root(); if (!el || !cs.cal) return;
    var m = cs.cal.state().mode, n = st.calLine || 1;
    [].forEach.call(el.querySelectorAll("[data-act=line]"), function (x) { x.setAttribute("aria-pressed", String(+x.getAttribute("data-l") === n)); });
    [].forEach.call(el.querySelectorAll("[data-act=nudge]"), function (x) {
      var d = +x.getAttribute("data-d");
      x.setAttribute("aria-label", stepLabel(d, m, n));
      x.innerHTML = stepText(d, m);
    });
    var svg = $("tokTrace"), lines = svg ? svg.querySelectorAll(".tk-cal-line") : [];
    [].forEach.call(lines, function (l, i) { l.classList.toggle("tk-cal-sel", i === n - 1); });
  }
  function nudge(d) {
    var c = current(); if (!cs.cal || !c) return;
    var K = G.TOKOS_CALIPERS, L = c.layout, s = cs.cal.state(), k = (s.mode === "bpm" ? "y" : "x") + (st.calLine || 1);
    if (s.mode === "bpm") cs.cal.set(k, K.yForBpm(L, Math.round(K.bpmAt(L, s[k])) + d));
    else { var sec = Math.min(Math.max(Math.round(K.secAt(L, s[k])) + d, 0), L.durationSec); cs.cal.set(k, L.padL + (sec / L.durationSec) * L.plotW); }
    st.calMoved[s.mode] = true; calOut();
  }
  // Answering updates the checklist in place: the mounted trace, its zoom and the calipers stay put, and keyboard focus
  // stays on the option just pressed.
  function answer(el) {
    var q = el.getAttribute("data-q"), o = el.getAttribute("data-o"), c = current();
    st.session.answers[q] = o;
    var fs = el.closest(".tok-q");
    [].forEach.call(fs.querySelectorAll("[data-act=ans]"), function (b) { var on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    var ids = checklistFor(c, level()), n = ids.filter(function (id) { return st.session.answers[id]; }).length;
    var box = $("tokChecklist");
    box.querySelector(".tok-count").textContent = fmt(W().answered, { a: n, n: ids.length });
    box.querySelector("[data-act=reveal]").disabled = n !== ids.length;
  }

  /* ---------- reveal ---------- */
  function kv(label, value, sub) {
    // The hidden ": " keeps "pH: 7.31" readable as one phrase for screen readers and copy-paste.
    return '<div class="tok-kv"><dt>' + esc(label) + '<span class="tok-sr">: </span></dt><dd>' + esc(value) + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</dd></div>";
  }
  function renderReveal() {
    var c = current(), w = W(), res = st.session.result, t = res.truth, o = c.outcome || {}, f = c.features, i = 0, lang = I.lang();
    var rows = res.ids.map(function (id) {
      var ok = res.perQ[id], mine = w.opts[id][st.session.answers[id]], key = w.opts[id][t[id]];
      return '<li class="tok-row ' + (ok ? "ok" : "no") + '" style="--i:' + (i++) + '"><div class="tok-row-h"><b>' + esc(w[QLABEL[id]]) + '</b><span class="tok-mark">' + icoH(ok ? "check" : "x") + "<span>" + esc(ok ? w.matchOne : w.noMatch) + "</span></span></div>" +
        (ok ? '<p class="tok-ans">' + esc(key) + "</p>"
            : '<p class="tok-ans mine"><span>' + esc(w.yours) + "</span>" + esc(mine) + '</p><p class="tok-ans key"><span>' + esc(w.key) + "</span>" + esc(key) + "</p>") + "</li>";
    }).join("");
    var maxD = 0; (f.decels || []).forEach(function (d) { if (d.durationSec > maxD) maxD = d.durationSec; });
    var winM = f.window && f.window.minutes, R = cs.rationaleData;
    var missed = res.ids.filter(function (id) { return !res.perQ[id]; });
    var why = missedKeys(c, missed).map(function (k) { var r = R && R[k]; return r ? "<li>" + esc(r[lang] || r.en) + "</li>" : ""; }).join("");
    var apgar = o.apgar1 == null && o.apgar5 == null ? w.notRecorded : num(o.apgar1) + " / " + num(o.apgar5);
    var les = !res.perQ.figo && host._learn ? host._learn.lessonFor("ctg", t.figo) : null;
    // Review Focus: the two .tok-block sections stay separate: what the trace showed, then what was recorded at birth.
    return I.top(w.backHub, title(), esc(caseLine()), I.langBtn()) +
      '<div class="sp-scroll tok-scroll"><div class="tok-reveal tok-pad">' +
      '<p class="tok-score" tabindex="-1"><b>' + res.matches + "<small>/" + res.ids.length + "</small></b> " + esc(w.match) + "</p>" +
      (reviewComplete(c) ? "" : '<p class="tok-rule">' + icoH("info") + "<span>" + esc(w.rule) + "</span></p>") +
      '<ol class="tok-concord">' + rows + "</ol>" +
      '<section class="tok-block"><h3>' + esc(w.features) + "</h3><dl>" +
        kv(w.baseline, num(f.baseline, "bpm")) +
        kv(w.variability, num(f.variability && f.variability.medianRange, "bpm"), f.variability && w.opts.variability[f.variability.band]) +
        kv(w.decels, num(f.decels ? f.decels.length : null), (winM ? fmt(w.window, { m: winM }) : "") + (maxD ? ", " + fmt(w.longest, { s: Math.round(maxD) }) : "")) +
        kv(w.contractions, num(f.contractions && f.contractions.per10), w.per10) + "</dl></section>" +
      '<section class="tok-block"><h3>' + esc(w.outcome) + "</h3><dl>" +
        kv(w.pH, num(o.pH)) + kv(w.bdecf, num(o.BDecf, "mmol/L")) + kv(w.pco2, num(o.pCO2, "kPa")) + kv(w.apgar, apgar) + kv(w.weight, num(o.weightG, "g")) + "</dl></section>" +
      (why ? '<section class="tok-why"><h3>' + esc(w.why) + "</h3><ul>" + why + "</ul></section>" : "") +
      '<p class="tok-next">' + esc(w.nextReview) + " <b>" + res.ivl + "</b> " + esc(res.ivl === 1 ? w.day : w.days) + "</p>" +
      (les ? '<button type="button" class="sp-btn sec sp-wide tok-learnthis" data-act="lesson" data-l="' + esc(les.id) + '">' + esc(fmt(w.learnThis, { t: les.title })) + "</button>" : "") +
      I.maikBtn("I am learning to read intrapartum CTG (FIGO 2015). On this trace the key is: baseline " + t.baseline + ", variability " + t.variability + ", decelerations " + t.decels +
        ", FIGO category " + t.figo + "; I said FIGO " + st.session.answers.figo + ". Explain how to read these features and what the category means for management.") +
      '</div><div class="tok-foot tok-pad"><button type="button" class="tok-btn pri" data-act="next">' + esc(w.next) + "</button></div></div>";
  }
  function submit() {
    var c = current(), ids = checklistFor(c, level()), t = truthFor(c), today = I.today();
    var g = gradeChecklist(ids, st.session.answers, t);
    var card = C.review(st.store, deckKey(), c.id, g.grade, today);
    Object.keys(t).forEach(function (q) { if (ids.indexOf(q) >= 0) C.recordAnswer(st.store, deckKey() + "." + q, t[q], st.session.answers[q]); });
    I.save();
    st.session.result = { ids: ids, perQ: g.perQ, truth: t, matches: g.matches, ivl: card[3] - today };
    I.haptic(g.perQ.figo ? "success" : "error");
    st.view = "reveal";
    var go = function () { if (st.view === "reveal" && current() === c) { paint(".tok-score"); try { var sc = I.root().querySelector(".tok-scroll"); if (sc) sc.scrollTop = 0; } catch (e) {} } };
    if (cs.rationaleData) go(); else rationale().then(go);
  }

  var spec = {
    id: "ctg", icon: "pulse", deck: "decks/ctg.json", size: 12, newCap: 12,
    title: { en: "CTG reading", hi: "सीटीजी पढ़ना" },
    sub: { en: "Real intrapartum traces, FIGO 2015", hi: "प्रसव के असली ट्रेस, FIGO 2015" },
    items: function (d) { return (d.cases || []).map(function (c) { return { id: c.id, a: c.figo, c: c }; }); },
    render: function (h, item, done) {
      cs.done = done;
      st.session.answers = {}; st.session.result = null;
      if (!st.svg) st.svg = {};
      st.view = "clinic";
      st.again = paint;
      st.onLeave = unmountTrace;
      rationale();
      paint(st.session.i > 0 ? ".tok-vignette" : null);
    }
  };
  host.registerClinic(spec);

  var A = I.ACTIONS;
  A.ans = function (b) { if (st.view === "clinic") answer(b); };
  A.reveal = function () { if (st.view === "clinic") submit(); };
  A.next = function () { if (cs.done) cs.done(); };
  A.cal = function (b) {
    if (cs.cal) cs.cal.setMode(b.getAttribute("data-m"));
    [].forEach.call(I.root().querySelectorAll("[data-act=cal]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    syncCal(); calOut();
  };
  A.line = function (b) { st.calLine = +b.getAttribute("data-l"); syncCal(); };
  A.nudge = function (b) { nudge(+b.getAttribute("data-d")); };
  A.zoom = function () { if (cs.stage) cs.stage.zoomBy(2); };
  A.fit = function () { if (cs.stage) cs.stage.reset(); };
  A.retrace = function () { var s = $("tokStage"); if (s) s.innerHTML = '<div class="tok-loading-trace" id="tokTraceSlot" aria-busy="true">' + esc(W().traceLoading) + "</div>"; mountTrace(current()); };
  // ES5 getters for the UI test: the live caliper and stage handles of the mounted trace.
  Object.defineProperty(host, "_cal", { get: function () { return cs.cal; }, configurable: true });
  Object.defineProperty(host, "_stage", { get: function () { return cs.stage; }, configurable: true });
  host.L10N = L10N;
})(typeof window !== "undefined" ? window : this);
