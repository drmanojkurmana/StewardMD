/* Tokós: OBGYN CTG reading trainer, a StewardMD module. DOM layer, ES5.
   Host contract mirrors Ophthalmós: open() hides home, close() restores it, back() unwinds
   one layer (swipe-back.js and Escape call it). Content is ai_drafted; every screen carries
   the draft footer until clinical review (.tok-draft, same treatment as .oph-draft).
   Clinic flow: hub -> clinic (vignette, inline trace with calipers, FIGO checklist) -> reveal
   (concordance, trace features, recorded outcome, why) -> next case -> session done. */
(function (G) {
  "use strict";
  var C = G.TOKOS_CORE, D = G.TOKOS_DATA, S = G.TOKOS_STAGE;
  var BASE = G.SMD_TOKOS_BASE || "/tokos/";

  var st = { view: "hub", cfg: null, decks: {}, rationale: null, store: null, prefs: null, loading: null, err: null, session: null, svg: {}, _cal: null, _stage: null, _ro: null, _prevFocus: null };

  function $(id) { return G.document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function icoH(n) { var i = ico(n); return i ? '<span class="tok-i" aria-hidden="true">' + i + "</span>" : ""; }
  function ico(n) { try { if (!G.ICONS || !G.ICONS.get || (G.ICONS.has && !G.ICONS.has(n))) return ""; return G.ICONS.get(n); } catch (e) { return ""; } }
  function isPro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (e) { return false; } }
  function showPro() {
    try { if (G.SMD_PRO_NOTICE && G.SMD_PRO_NOTICE.show) return G.SMD_PRO_NOTICE.show("tokos"); } catch (e) {}
    try { if (G.SMD_PRO && G.SMD_PRO.openPaywall) return G.SMD_PRO.openPaywall("tokos"); } catch (e) {}
    try { if (G.toast) G.toast("This level is part of StewardMD Pro"); } catch (e) {}
  }
  function ls() { try { return G.localStorage; } catch (e) { return null; } }
  function save() { D.saveStore(ls(), st.store); }
  function today() { return D.today(Date.now()); }
  function level() { return st.prefs.level === "resident" ? "resident" : "mbbs"; }
  function levelLocked(lv) { return D.levelLocked(st.cfg, lv || level(), isPro()); }
  function trial(featureId) { return D.trialState(st.store, featureId, !levelLocked("resident")); }

  // Trial gate: check BEFORE any fetch. A spent trial must never touch the network (Review Focus).
  function gate(featureId, run) {
    var s = trial(featureId);
    if (s === "used") return showPro();
    if (s === "trial") { D.useTrial(st.store, featureId, today()); save(); }
    return run();
  }

  function getJSON(path) {
    return fetch(BASE + path).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function loadAll() {
    if (st.loading) return st.loading;
    st.err = null;
    st.loading = Promise.all([getJSON("tracks.json"), getJSON("rationale.json")]).then(function (res) {
      var cfg = res[0];
      st.rationale = res[1];
      return Promise.all(cfg.tracks.map(function (t) { return getJSON(t.deck).then(function (d) { st.decks[t.id] = d; }); })).then(function () { st.cfg = cfg; });
    }).catch(function (e) { st.err = e; st.loading = null; throw e; });
    return st.loading;
  }

  /* ---------- words. Numbers stay plain ASCII digits in both languages; only labels translate. ---------- */
  var L10N = {
    en: { contractions: "Contractions", baseline: "Baseline heart rate", variability: "Variability", decels: "Decelerations", decelType: "Deceleration type",
      figo: "Overall (FIGO 2015)", action: "Next step", submit: "Check my reading", next: "Next case", done: "Session done", caliper: "Calipers",
      bpmMode: "Measure bpm", timeMode: "Measure time", grid: "1 major square = 1 minute", quality: "Signal quality", rule: "Rule-based, pending obstetrician review",
      yours: "Yours", key: "Answer", features: "Trace features", outcome: "Recorded outcome at birth", why: "Why", notRecorded: "not recorded", nextReview: "Next review in",
      days: "days", day: "day", vignette: "Patient", weeks: "weeks", age: "Age", gp: "G/P", stage1: "First stage", stage2: "Second stage", min: "min", induced: "Induced labour",
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
      // v2 design pass additions (hub, states, reveal labels)
      close: "Close", backHub: "Back to Tokós", sub: "Intrapartum CTG, FIGO 2015", clinicSub: "12 real traces from labour ward records", toRead: "to read today", caughtUp: "All caught up for today",
      freeTry: "1 free try", pro: "Pro", level: "Level", langBtn: "हिन्दी", langLabel: "Language: switch to Hindi",
      how: "Read the last 30 minutes of the strip, answer the checklist, then compare with the key and the recorded outcome at birth.",
      source: "Traces: CTU-UHB intrapartum CTG database (Chudáček et al. 2014, PhysioNet, ODC-BY 1.0).",
      loading: "Loading cases…", loadErr: "Could not load Tokós. Check your connection.", tryAgain: "Try again", traceLoading: "Loading trace…", traceErr: "Could not load this trace.",
      caseOf: "Case {i} of {n}", answered: "{a} of {n} answered", match: "match the key", matchOne: "Match", noMatch: "No match",
      gest: "Gestation", fit: "Fit", zoomIn: "Zoom in", zoomHint: "Pinch or double-tap the strip to zoom",
      pH: "pH", bdecf: "BDecf", pco2: "pCO2", apgar: "Apgar at 1 and 5 min", weight: "Birth weight", window: "in the last {m} min", longest: "longest {s}\u00a0s", per10: "per 10 min",
      doneLine: "{n} cases read in this session.", emptyLine: "No cases are due. New and due cases come back tomorrow.", backToHub: "Back to Tokós",
      draft: "To be verified, draft", traceAria: "CTG trace, last {m} min", calPrompt: "Drag a line, or use the buttons below, to measure",
      lineGroup: "Caliper line", lineN: "Line {n}", s: "s",
      bpmDown: "Move line {n} down 1 bpm", bpmUp: "Move line {n} up 1 bpm", timeDown: "Move line {n} 1 second earlier", timeUp: "Move line {n} 1 second later" },
    hi: { contractions: "संकुचन", baseline: "बेसलाइन हृदय गति", variability: "परिवर्तनशीलता", decels: "डिसेलेरेशन", decelType: "डिसेलेरेशन का प्रकार",
      figo: "कुल वर्गीकरण (FIGO 2015)", action: "अगला कदम", submit: "मेरी रीडिंग जांचें", next: "अगला केस", done: "सत्र पूरा", caliper: "कैलिपर",
      bpmMode: "bpm मापें", timeMode: "समय मापें", grid: "1 बड़ा खाना = 1 मिनट", quality: "सिग्नल गुणवत्ता", rule: "नियम-आधारित, प्रसूति विशेषज्ञ की समीक्षा बाकी",
      yours: "आपका", key: "उत्तर", features: "ट्रेस की विशेषताएं", outcome: "जन्म के समय दर्ज परिणाम", why: "क्यों", notRecorded: "दर्ज नहीं", nextReview: "अगली समीक्षा",
      days: "दिन में", day: "दिन में", vignette: "मरीज़", weeks: "सप्ताह", age: "आयु", gp: "G/P", stage1: "पहला चरण", stage2: "दूसरा चरण", min: "मिनट", induced: "प्रेरित प्रसव",
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
      close: "बंद करें", backHub: "Tokós पर वापस", sub: "प्रसव के दौरान CTG, FIGO 2015", clinicSub: "लेबर वार्ड रिकॉर्ड से 12 असली ट्रेस", toRead: "आज पढ़ने हैं", caughtUp: "आज के सभी केस पूरे",
      freeTry: "1 मुफ़्त प्रयास", pro: "Pro", level: "स्तर", langBtn: "English", langLabel: "भाषा: अंग्रेज़ी में बदलें",
      how: "स्ट्रिप के आखिरी 30 मिनट पढ़ें, चेकलिस्ट का उत्तर दें, फिर उत्तर कुंजी और जन्म के समय दर्ज परिणाम से मिलाएं।",
      source: "ट्रेस: CTU-UHB इंट्रापार्टम CTG डेटाबेस (Chudáček et al. 2014, PhysioNet, ODC-BY 1.0)।",
      loading: "केस लोड हो रहे हैं…", loadErr: "Tokós लोड नहीं हो सका। अपना कनेक्शन जांचें।", tryAgain: "फिर कोशिश करें", traceLoading: "ट्रेस लोड हो रहा है…", traceErr: "यह ट्रेस लोड नहीं हो सका।",
      caseOf: "केस {i} / {n}", answered: "{n} में से {a} उत्तर दिए", match: "उत्तर से मेल", matchOne: "मेल", noMatch: "मेल नहीं",
      gest: "गर्भकाल", fit: "पूरा", zoomIn: "ज़ूम करें", zoomHint: "ज़ूम के लिए स्ट्रिप पर पिंच या डबल-टैप करें",
      pH: "pH", bdecf: "BDecf (बेस डेफिसिट)", pco2: "pCO2", apgar: "अपगार, 1 और 5 मिनट पर", weight: "जन्म का वज़न", window: "आखिरी {m} मिनट में", longest: "सबसे लंबा {s}\u00a0सेकंड", per10: "प्रति 10 मिनट",
      doneLine: "इस सत्र में {n} केस पढ़े।", emptyLine: "अभी कोई केस बाकी नहीं। नए और बाकी केस कल आएंगे।", backToHub: "Tokós पर वापस",
      draft: "सत्यापन बाकी, ड्राफ़्ट", traceAria: "CTG ट्रेस, आखिरी {m} मिनट", calPrompt: "मापने के लिए रेखा खींचें, या नीचे के बटन इस्तेमाल करें",
      lineGroup: "कैलिपर रेखा", lineN: "रेखा {n}", s: "सेकंड",
      bpmDown: "रेखा {n} को 1 bpm नीचे करें", bpmUp: "रेखा {n} को 1 bpm ऊपर करें", timeDown: "रेखा {n} को 1 सेकंड पहले करें", timeUp: "रेखा {n} को 1 सेकंड बाद करें" }
  };
  var QLABEL = { uc: "contractions", baseline: "baseline", variability: "variability", decels: "decels", decelType: "decelType", figo: "figo", action: "action" };
  function W() { return L10N[st.prefs && st.prefs.lang === "hi" ? "hi" : "en"]; }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] == null ? m : o[k]; }); }
  function num(v, unit) { return v == null || v !== v ? W().notRecorded : String(v) + (unit ? " " + unit : ""); } // plain ASCII digits in both languages

  /* ---------- frame ---------- */
  function root() {
    var el = $("smdTokos");
    if (!el) {
      el = G.document.createElement("div");
      el.id = "smdTokos";
      G.document.body.appendChild(el);
    }
    el.className = "tok-root" + (el.classList.contains("on") ? " on" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Tokós");
    return el;
  }
  function top(backLabel, title, sub, right) {
    var chev = ico("chev");
    return '<div class="tok-top"><button type="button" class="tok-back" data-act="back" aria-label="' + esc(backLabel) + '">' + (chev ? '<span class="tok-flip">' + chev + "</span>" : "‹") + "</button>" +
      '<div class="tok-title"><b' + (title === "Tokós" ? ' translate="no"' : "") + ">" + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>" + (right || "") + "</div>";
  }

  function unmountTrace() {
    if (st._ro) { try { st._ro.disconnect(); } catch (e) {} st._ro = null; }
    if (st._cal) { try { st._cal.destroy(); } catch (e) {} }
    st._cal = null; st._stage = null;
  }

  // Focus: a new view starts at its back button (or at focusSel, e.g. the score after submit); a re-render of
  // the same view (language, level, retry) puts focus back on the control that caused it.
  function focusKey(a) {
    if (!a || !a.getAttribute || !a.getAttribute("data-act")) return null;
    return ["data-act", "data-q", "data-o", "data-v", "data-m", "data-l", "data-d"].map(function (k) { var v = a.getAttribute(k); return v == null ? "" : "[" + k + '="' + v + '"]'; }).join("");
  }
  function render(focusSel) {
    var el = $("smdTokos");
    if (!el) return;
    var same = st._shown === st.view, a = G.document.activeElement, key = a && el.contains(a) ? focusKey(a) : null;
    unmountTrace();
    var html;
    if (st.view === "clinic") html = renderClinic();
    else if (st.view === "reveal") html = renderReveal();
    else html = renderHub();
    el.innerHTML = html;
    var sc = el.querySelector(".tok-scroll");
    if (sc) sc.insertAdjacentHTML("beforeend", '<p class="tok-draft">' + esc(W().draft) + "</p>");
    if (st.prefs && st.prefs.lang === "hi") el.setAttribute("lang", "hi"); else el.removeAttribute("lang");
    bind(el);
    st._shown = st.view;
    if (st.view === "clinic" && current()) mountTrace(current());
    if (typeof focusSel !== "string") focusSel = null; // render is also a promise callback (value or Error)
    var f = (focusSel && el.querySelector(focusSel)) || (same && key && el.querySelector(key)) || el.querySelector(".tok-back");
    try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- hub ---------- */
  function renderHub() {
    var w = W();
    if (st.err) return top(w.close, "Tokós", w.sub) + '<div class="tok-scroll tok-pad"><div class="tok-err" role="alert"><p>' + esc(w.loadErr) + '</p><button type="button" class="tok-btn sec" data-act="retry">' + esc(w.tryAgain) + "</button></div></div>";
    if (!st.cfg) return top(w.close, "Tokós", w.sub) + '<div class="tok-scroll tok-pad"><div class="tok-loading" aria-busy="true"><span class="tok-sk tok-sk-a"></span><span class="tok-sk tok-sk-b"></span><span class="tok-sk tok-sk-c"></span><span class="tok-sr">' + esc(w.loading) + "</span></div></div>";
    var lang = st.prefs.lang, tr = st.cfg.tracks[0];
    var t = lang === "hi" ? tr.labelHi : tr.labelEn;
    var locked = levelLocked("resident"), ts = trial("clinic.ctg");
    var proBadge = !locked ? "" : '<span class="tok-pro' + (ts === "used" ? " used" : "") + '">' + icoH("lock") + esc(ts === "used" ? w.pro : w.freeTry) + "</span>";
    var deck = st.decks.ctg, cnt = C.counts({ id: "ctg." + level(), items: deck.cases.map(function (c) { return { id: c.id }; }) }, st.store, today());
    var n = Math.min(12, cnt.due + cnt.fresh);
    var lv = level();
    return top(w.close, "Tokós", w.sub, '<button type="button" class="tok-lang" data-act="lang" aria-label="' + esc(w.langLabel) + '" lang="' + (lang === "hi" ? "en" : "hi") + '">' + esc(w.langBtn) + "</button>") +
      '<div class="tok-scroll tok-pad">' +
      '<div class="tok-seg" role="group" aria-label="' + esc(w.level) + '">' +
        '<button type="button" data-act="level" data-v="mbbs" aria-pressed="' + (lv === "mbbs") + '">MBBS</button>' +
        '<button type="button" data-act="level" data-v="resident" aria-pressed="' + (lv === "resident") + '">Resident' + proBadge + "</button></div>" +
      '<button type="button" class="tok-clinic" data-act="clinic" data-t="ctg">' +
        '<span class="tok-tile" aria-hidden="true">' + ico("pulse") + "</span>" +
        '<span class="tok-clinic-b"><b>' + esc(t) + "</b><span>" + esc(w.clinicSub) + '</span><span class="tok-due">' + (n ? "<b>" + n + "</b> " + esc(w.toRead) : esc(w.caughtUp)) + "</span></span>" +
        '<span class="tok-chev" aria-hidden="true">' + ico("chev") + "</span></button>" +
      '<p class="tok-note">' + esc(w.how) + "</p>" +
      '<p class="tok-note tok-src">' + esc(w.source) + "</p>" +
      "</div>";
  }

  /* ---------- clinic ---------- */
  function startSession() {
    var deck = st.decks.ctg, lv = level();
    var sched = { id: "ctg." + lv, items: deck.cases.map(function (c) { return { id: c.id, a: c.figo, c: c }; }) };
    st.session = { list: C.buildSession(sched, st.store, today(), { size: 12, newCap: 12 }), i: 0, answers: {}, result: null, done: 0 };
    st.view = "clinic"; render();
  }
  function current() { var s = st.session; return s && s.list[s.i] ? s.list[s.i].c : null; }
  function caseLine() { var s = st.session; return fmt(W().caseOf, { i: s.i + 1, n: s.list.length }); }

  function renderVignette(c) {
    var v = c.vignette || {}, w = W(), cells = [];
    function cell(val, label) { cells.push('<div class="tok-vc"><b>' + val + "</b><span>" + esc(label) + "</span></div>"); }
    if (v.gestWeeks != null) cell(esc(v.gestWeeks) + " <small>" + esc(w.weeks) + "</small>", w.gest);
    if (v.age != null) cell(esc(v.age), w.age);
    if (v.gravidity != null && v.parity != null) cell(esc(v.gravidity + "/" + v.parity), w.gp);
    if (v.stage2Min != null) cell(esc(v.stage2Min) + " <small>" + esc(w.min) + "</small>", w.stage2);
    // R9: risks stay [] until the header codings are confirmed; the chips render nothing today.
    var chips = (v.risks || []).map(function (r) { return '<span class="tok-chip">' + esc(w.risks[r] || r) + "</span>"; }).join("");
    if (v.induced) chips += '<span class="tok-chip">' + esc(w.induced) + "</span>";
    return '<section class="tok-vignette" tabindex="-1" aria-label="' + esc(w.vignette) + '"><div class="tok-vrow">' + cells.join("") + "</div>" + (chips ? '<div class="tok-chips">' + chips + "</div>" : "") + "</section>";
  }

  function renderChecklist(c) {
    var w = W(), ids = D.checklistFor(c, level()), a = st.session.answers, n = 0;
    var q = ids.map(function (id) {
      if (a[id]) n++;
      return '<fieldset class="tok-q" data-q="' + id + '"><legend>' + esc(w[QLABEL[id]]) + '</legend><div class="tok-opts">' +
        D.QUESTIONS[id].map(function (o) {
          var on = a[id] === o;
          return '<button type="button" class="tok-opt' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="ans" data-q="' + id + '" data-o="' + o + '">' + esc(w.opts[id][o]) + "</button>";
        }).join("") + "</div></fieldset>";
    }).join("");
    return q + '<div class="tok-foot"><span class="tok-count" aria-live="polite">' + esc(fmt(w.answered, { a: n, n: ids.length })) + "</span>" +
      '<button type="button" class="tok-btn pri" data-act="reveal"' + (n === ids.length ? "" : " disabled") + ">" + esc(w.submit) + "</button></div>";
  }

  function renderClinic() {
    var c = current(), w = W();
    if (!c) return renderDone();
    var L = c.layout, q = c.stripQuality || {}, sig = q.fhrLossPct == null ? null : Math.round(100 - q.fhrLossPct); // R16: the displayed strip
    return top(w.backHub, (st.prefs.lang === "hi" ? st.cfg.tracks[0].labelHi : st.cfg.tracks[0].labelEn), caseLine()) +
      '<div class="tok-scroll tok-clinic-view">' + '<div class="tok-pad">' + renderVignette(c) + "</div>" +
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

  // Inline SVG so the calipers can map pointer positions into viewBox units. Our own generated file
  // (Task 1c): class names only, no <style>, no scripts.
  function mountTrace(c) {
    var slot = $("tokTraceSlot"); if (!slot) return;
    var p = st.svg[c.svg] ? Promise.resolve(st.svg[c.svg]) : fetch(BASE + "media/" + c.svg).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
    p.then(function (txt) {
      var stage = $("tokStage"); if (!stage || current() !== c || st.view !== "clinic") return;
      var svg = safeSvg(txt);
      if (!svg) throw new Error("unsafe svg");
      st.svg[c.svg] = txt;
      stage.innerHTML = ""; stage.appendChild(svg);
      var L = c.layout; svg.id = "tokTrace"; svg.setAttribute("data-src", c.svg);
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", fmt(W().traceAria, { m: L.durationSec / 60 }));
      // bpm labels sit inside the plot so a legible size is never clipped by the narrow left margin
      // and every other FHR label is dropped (40 bpm steps) so they never collide at phone width.
      [].forEach.call(svg.querySelectorAll(".tk-axis"), function (t) {
        t.setAttribute("x", L.padL + 6); t.setAttribute("text-anchor", "start");
        var v = +t.textContent; if (+t.getAttribute("y") < L.yTop + L.hFhr + 1 && v % 40) t.setAttribute("class", "tk-axis tk-axis-odd");
      });
      // Non-scaling strokes ignore the stage's CSS scale, so the stage publishes it as --k and the
      // stroke and label sizes divide by it: the lines and labels keep one on-screen size at every zoom.
      if (G.MutationObserver) {
        var mo = new G.MutationObserver(function () { var m = /scale\(([\d.]+)\)/.exec(svg.style.transform); stage.style.setProperty("--k", m ? m[1] : 1); });
        mo.observe(svg, { attributes: true, attributeFilter: ["style"] });
      }
      st._stage = S.attach(stage, svg); st._stage.reset();
      if (G.ResizeObserver) { st._ro = new G.ResizeObserver(function () { if (st._stage) st._stage.reset(); }); st._ro.observe(stage); }
      // Neutral start: the lines sit a few bpm either side of this strip's baseline, and the readout
      // prompts instead of showing a verdict until the learner moves a line (drag or stepper).
      st.calMoved = { bpm: false, time: false }; st.calLine = 1;
      st._cal = G.TOKOS_CALIPERS.attach(svg, L, function (s, reason, key) {
        if (reason === "drag") { st.calMoved[s.mode] = true; st.calLine = key === "y2" || key === "x2" ? 2 : 1; syncCal(); }
        calOut();
      });
      var K = G.TOKOS_CALIPERS, b = (c.features && c.features.baseline) || 140;
      st._cal.set("y1", K.yForBpm(L, b + 8)); st._cal.set("y2", K.yForBpm(L, b - 8));
      st._cal.set("x1", L.padL + L.plotW * 0.46); st._cal.set("x2", L.padL + L.plotW * 0.54);
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
    var o = $("tokCalOut"); if (!o || !st._cal) return;
    var m = st._cal.state().mode, moved = st.calMoved && st.calMoved[m];
    o.textContent = moved ? st._cal.readout(st.prefs.lang) : W().calPrompt;
    o.classList.toggle("idle", !moved);
  }
  // One stepper button's label and text for a caliper mode and line; used by the first render and by syncCal.
  function stepLabel(d, m, n) { var w = W(); return fmt(m === "bpm" ? (d > 0 ? w.bpmUp : w.bpmDown) : (d > 0 ? w.timeUp : w.timeDown), { n: n }); }
  function stepText(d, m) { return (d > 0 ? "+1" : "\u22121") + "<small>" + esc(m === "bpm" ? "bpm" : W().s) + "</small>"; }
  function stepBtn(d, m, n) { return '<button type="button" class="tok-icon tok-step" data-act="nudge" data-d="' + d + '" aria-label="' + esc(stepLabel(d, m, n)) + '">' + stepText(d, m) + "</button>"; }
  function syncCal() {
    var el = $("smdTokos"); if (!el || !st._cal) return;
    var m = st._cal.state().mode, n = st.calLine || 1;
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
    var c = current(); if (!st._cal || !c) return;
    var K = G.TOKOS_CALIPERS, L = c.layout, s = st._cal.state(), k = (s.mode === "bpm" ? "y" : "x") + (st.calLine || 1);
    if (s.mode === "bpm") st._cal.set(k, K.yForBpm(L, Math.round(K.bpmAt(L, s[k])) + d));
    else { var sec = Math.min(Math.max(Math.round(K.secAt(L, s[k])) + d, 0), L.durationSec); st._cal.set(k, L.padL + (sec / L.durationSec) * L.plotW); }
    st.calMoved[s.mode] = true; calOut();
  }

  // Answering updates the checklist in place: the mounted trace, its zoom and the calipers stay put,
  // and keyboard focus stays on the option just pressed.
  function answer(el) {
    var q = el.getAttribute("data-q"), o = el.getAttribute("data-o"), c = current();
    st.session.answers[q] = o;
    var fs = el.closest(".tok-q");
    [].forEach.call(fs.querySelectorAll("[data-act=ans]"), function (b) { var on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    var ids = D.checklistFor(c, level()), n = ids.filter(function (id) { return st.session.answers[id]; }).length;
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
    var c = current(), w = W(), res = st.session.result, t = res.truth, o = c.outcome || {}, f = c.features, i = 0;
    var rows = res.ids.map(function (id) {
      var ok = res.perQ[id], mine = w.opts[id][st.session.answers[id]], key = w.opts[id][t[id]];
      return '<li class="tok-row ' + (ok ? "ok" : "no") + '" style="--i:' + (i++) + '"><div class="tok-row-h"><b>' + esc(w[QLABEL[id]]) + '</b><span class="tok-mark">' + icoH(ok ? "check" : "x") + "<span>" + esc(ok ? w.matchOne : w.noMatch) + "</span></span></div>" +
        (ok ? '<p class="tok-ans">' + esc(key) + "</p>"
            : '<p class="tok-ans mine"><span>' + esc(w.yours) + "</span>" + esc(mine) + '</p><p class="tok-ans key"><span>' + esc(w.key) + "</span>" + esc(key) + "</p>") + "</li>";
    }).join("");
    var maxD = 0; (f.decels || []).forEach(function (d) { if (d.durationSec > maxD) maxD = d.durationSec; });
    var winM = f.window && f.window.minutes;
    var why = D.rationaleKeys(c).map(function (k) { var r = st.rationale && st.rationale[k]; return r ? "<li>" + esc(r[st.prefs.lang] || r.en) + "</li>" : ""; }).join("");
    var apgar = o.apgar1 == null && o.apgar5 == null ? w.notRecorded : num(o.apgar1) + " / " + num(o.apgar5);
    // Review Focus: the two .tok-block sections stay separate: what the trace showed, then what was recorded at birth.
    return top(w.backHub, (st.prefs.lang === "hi" ? st.cfg.tracks[0].labelHi : st.cfg.tracks[0].labelEn), caseLine()) +
      '<div class="tok-scroll"><div class="tok-reveal tok-pad">' +
      '<p class="tok-score" tabindex="-1"><b>' + res.matches + "<small>/" + res.ids.length + "</small></b> " + esc(w.match) + "</p>" +
      (c.review ? "" : '<p class="tok-rule">' + icoH("info") + "<span>" + esc(w.rule) + "</span></p>") +
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
      '</div><div class="tok-foot tok-pad"><button type="button" class="tok-btn pri" data-act="next">' + esc(w.next) + "</button></div></div>";
  }
  function renderDone() {
    var w = W(), n = st.session ? st.session.done : 0;
    return top(w.backHub, n ? w.done : "Tokós", "") + '<div class="tok-scroll tok-pad"><div class="tok-done">' +
      '<p class="tok-done-h">' + esc(n ? w.done : w.caughtUp) + "</p><p>" + esc(n ? fmt(w.doneLine, { n: n }) : w.emptyLine) + "</p>" +
      '<button type="button" class="tok-btn pri" data-act="hub">' + esc(w.backToHub) + "</button></div></div>";
  }

  function submit() {
    var c = current(), ids = D.checklistFor(c, level()), t = D.truthFor(c);
    var g = D.gradeChecklist(ids, st.session.answers, t);
    var card = C.review(st.store, "ctg." + level(), c.id, g.grade, today());
    Object.keys(t).forEach(function (q) { if (ids.indexOf(q) >= 0) C.recordAnswer(st.store, "ctg." + level() + "." + q, t[q], st.session.answers[q]); });
    save();
    st.session.done++;
    st.session.result = { ids: ids, perQ: g.perQ, truth: t, matches: g.matches, ivl: card[3] - today() };
    st.view = "reveal"; render(".tok-score");
    try { var sc = $("smdTokos").querySelector(".tok-scroll"); if (sc) sc.scrollTop = 0; } catch (e) {}
  }

  function bind(el) {
    el.onclick = function (e) {
      var b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      var act = b.getAttribute("data-act");
      if (act === "clinic") { if (level() === "resident") gate("clinic.ctg", startSession); else startSession(); }
      else if (act === "ans") answer(b);
      else if (act === "reveal") submit();
      else if (act === "next") { st.session.i++; st.session.answers = {}; st.session.result = null; st.view = "clinic"; render(".tok-vignette"); }
      else if (act === "cal") { if (st._cal) st._cal.setMode(b.getAttribute("data-m")); [].forEach.call(el.querySelectorAll("[data-act=cal]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); }); syncCal(); calOut(); }
      else if (act === "line") { st.calLine = +b.getAttribute("data-l"); syncCal(); }
      else if (act === "nudge") nudge(+b.getAttribute("data-d"));
      else if (act === "zoom") { if (st._stage) st._stage.zoomBy(2); }
      else if (act === "fit") { if (st._stage) st._stage.reset(); }
      else if (act === "retrace") { var s = $("tokStage"); if (s) s.innerHTML = '<div class="tok-loading-trace" id="tokTraceSlot" aria-busy="true">' + esc(W().traceLoading) + "</div>"; mountTrace(current()); }
      else if (act === "hub") { st.view = "hub"; render(); }
      else if (act === "back") back();
      else if (act === "lang") { st.prefs.lang = st.prefs.lang === "hi" ? "en" : "hi"; D.savePrefs(ls(), st.prefs); render(); }
      else if (act === "level") { var v = b.getAttribute("data-v") || (st.prefs.level === "resident" ? "mbbs" : "resident"); if (v !== st.prefs.level) { st.prefs.level = v; D.savePrefs(ls(), st.prefs); render(); } }
      else if (act === "retry") { st.loading = null; st.err = null; render(); loadAll().then(render).catch(render); }
    };
  }

  function open() {
    var el = root();
    if (!el.classList.contains("on")) { try { st._prevFocus = G.document.activeElement; } catch (e) { st._prevFocus = null; } }
    el.classList.add("on");
    G.document.body.classList.add("tok-noscroll");
    try { if (G.SMD_hideHome) G.SMD_hideHome(); } catch (e) {}
    st.view = "hub";
    st.store = D.loadStore(ls());
    st.prefs = D.loadPrefs(ls());
    render();
    if (!st.cfg && !st.loading) loadAll().then(render).catch(render);
  }
  function isOpen() { var el = $("smdTokos"); return !!(el && el.classList.contains("on")); }
  function close() {
    unmountTrace();
    var el = $("smdTokos");
    if (el) { el.classList.remove("on"); el.innerHTML = ""; }
    G.document.body.classList.remove("tok-noscroll");
    try { if (G.SMD_showHome) G.SMD_showHome(); } catch (e) {}
    try { if (st._prevFocus && st._prevFocus.focus) st._prevFocus.focus(); } catch (e) {}
    st._prevFocus = null; st.view = "hub";
  }
  function back() {
    if (!isOpen()) return false;
    if (st.view === "hub") { close(); return true; }
    if (st.view === "reveal" || st.view === "clinic") { st.view = "hub"; render(); return true; }
    return false;
  }

  // Escape unwinds one layer like swipe-back (mirrors Ophthalmós); MaiK above us owns Escape while it is open.
  function maikOpen() { try { return G.document.body.classList.contains("maik-open"); } catch (e) { return false; } }
  if (G.document && G.document.addEventListener)
    G.document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !isOpen() || maikOpen()) return;
      e.preventDefault();
      back();
    });

  var API = { open: open, close: close, back: back, isOpen: isOpen, _st: st, _render: render };
  // ES5 getters for the UI test: the live caliper and stage handles of the mounted trace.
  Object.defineProperty(API, "_cal", { get: function () { return st._cal; } });
  Object.defineProperty(API, "_stage", { get: function () { return st._stage; } });
  G.TOKOS = API;
})(typeof window !== "undefined" ? window : this);
