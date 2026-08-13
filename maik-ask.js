/* maik-ask.js — MaiK Ask interview controller (Phases C/E/G/H/I).
 * ===========================================================================
 * window.SMD_MAIKASK — orchestrates the turn-based patient history interview: pathway picks WHAT to ask,
 * the reasoning provider words it, native TTS speaks it, MaiK Scribe's ASR hears the answer, findings are
 * extracted (deterministic-first, LLM only when needed) and folded into the EXISTING EMR for the doctor
 * to review. Flag-gated `smd_maik_ask` (default OFF). Spec: docs/superpowers/specs/2026-08-14-maik-ask-design.md.
 *
 * SAFETY: history-taking aid only — never diagnoses, prescribes, advises, reassures, or overrides the
 * doctor. Every LLM response is validated (maik-reasoning.js) before use. Findings are tagged
 * source:"patient_spoken_via_MaiK" and folded through the caller's apply() (which uses the Scribe
 * doctor-override guard). A positive red flag STOPS routine questioning and alerts the doctor.
 *
 * The core (_runInterview) is dependency-injected + Node-testable; the browser start() wires the real
 * deps (SMD_PATHWAYS, SMD_MAIK_REASON, SMD_VOICE.listen, native TTS, the EMR apply callback) + UI.
 * ======================================================================== */
(function (root) {
  "use strict";

  function flagOn() { try { return root && root.localStorage && localStorage.getItem("smd_maik_ask") === "1"; } catch (e) { return false; } }

  // ---- multilingual yes/no + deterministic answer extraction (cost control: LLM only when needed) ----
  function isPositive(text) {
    var s = " " + String(text == null ? "" : text).toLowerCase() + " ";
    var neg = /\b(no|not|nahi|nahin|ledu|led|kaadu|kadu|illa|absent|never|em ledu)\b/.test(s);
    var pos = /\b(yes|yeah|yep|ha|haan|avunu|avnu|undi|unnai|unnayi|vundi|present|correct|okay|ok)\b/.test(s);
    if (neg && !pos) return false;
    if (pos && !neg) return true;
    return null;   // ambiguous -> LLM
  }
  // Returns [{field,value,confidence}] for the common cases (duration, yes/no symptoms, cue words); [] -> LLM.
  function deterministicAnswer(transcript, target) {
    var t = String(transcript == null ? "" : transcript);
    if (!target || !t.trim()) return [];
    // duration: "3 days" / "three days" (number-words via SMD_VVITALS) etc.
    if (target.field === "duration" || /duration/i.test(target.emr || "")) {
      var num = (root && root.SMD_VVITALS && root.SMD_VVITALS.wordsToNumbers) ? root.SMD_VVITALS.wordsToNumbers(t) : t;
      var m = String(num).toLowerCase().match(/(\d+)\s*(hours?|days?|weeks?|months?|years?)/);
      if (m) return [{ field: target.field, value: m[1] + " " + m[2], confidence: 0.85 }];
    }
    // yes/no nature: associated symptoms + red flags
    if (target.kind === "associated" || target.kind === "redflag") {
      var yn = isPositive(t);
      if (yn === true) return [{ field: target.field, value: "present", confidence: 0.8 }];
      if (yn === false) return [{ field: target.field, value: "absent", confidence: 0.8 }];
    }
    // cue fields (location/character/…): first matching cue word
    if (target.cues && target.cues.length) {
      var low = " " + t.toLowerCase() + " ";
      for (var i = 0; i < target.cues.length; i++) {
        var c = String(target.cues[i]).toLowerCase();
        if (low.indexOf(c) >= 0) return [{ field: target.field, value: c, confidence: 0.7 }];
      }
    }
    return [];
  }
  // A negated red-flag answer (in any of the 3 languages). Everything else with a value counts as a
  // POSITIVE red flag — safer to alert the doctor on a descriptive answer ("numbness since morning")
  // than to miss it because it didn't say the word "yes".
  function isNegated(value) {
    var v = " " + String(value == null ? "" : value).toLowerCase() + " ";
    return /\b(absent|no|none|negative|denies|denied|nil|not|never|without|ledu|led|nahi|nahin|illa|kaadu|kadu)\b/.test(v);
  }
  function positiveRedFlag(target, findings) {
    if (!target || target.kind !== "redflag") return null;
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      if (f.field !== target.field) continue;
      var v = String(f.value == null ? "" : f.value).trim();
      if (v && !isNegated(v)) return { field: target.field, ask: target.ask };   // present OR descriptive-positive -> alert
    }
    return null;
  }

  function allowedFieldNames(pathwaysApi, pathway) {
    try { return (pathwaysApi._targets(pathway) || []).map(function (t) { return t.field; }); } catch (e) { return []; }
  }

  // ---- the interview loop (pure-ish, async, dependency-injected) -----------
  // deps: { pathway, pathways, provider, known?, language?, maxQuestions?, listen, speak?, deterministic?,
  //         onQuestion?, onFinding?, onRedFlag?, onState?, complaint? }
  // Returns a controller: { stop(), pause(), resume(), promise } where promise resolves to a summary.
  function _runInterview(deps) {
    deps = deps || {};
    var pathway = deps.pathway, PW = deps.pathways;
    var provider = deps.provider;
    var known = {}; for (var k in (deps.known || {})) known[k] = deps.known[k];
    var language = deps.language || "";
    var maxQ = deps.maxQuestions || pathway.maxQuestions || 7;
    var listen = deps.listen;                        // () -> Promise<transcript>
    var speak = deps.speak || function () { return Promise.resolve(); };
    var deterministic = deps.deterministic || deterministicAnswer;
    var onQuestion = deps.onQuestion || function () {};
    var onFinding = deps.onFinding || function () {};
    var onRedFlag = deps.onRedFlag || function () {};
    var onState = deps.onState || function () {};
    var allowed = allowedFieldNames(PW, pathway);

    var running = true, paused = false, asked = 0, clarifies = 0;
    var summary = { asked: 0, findings: [], stoppedReason: "" };
    var resolveOuter;
    var promise = new Promise(function (res) { resolveOuter = res; });

    function finish(reason) { if (!running) return; running = false; summary.stoppedReason = reason; onState("done", reason); resolveOuter(summary); }
    function waitIfPaused() { return new Promise(function (res) { (function tick() { if (!paused || !running) return res(); setTimeout(tick, 120); })(); }); }

    function step() {
      if (!running) return;
      waitIfPaused().then(function () {
        if (!running) return;
        if (asked >= maxQ) return finish("max-questions");
        var target = PW.nextTarget(pathway, known);
        if (!target) return finish("complete");

        var ctx = { complaint: deps.complaint || pathway.label, pathwayLabel: pathway.label,
          targetField: target.field, targetHint: target.ask, known: known, allowedFields: allowed,
          language: language, pathway: pathway };

        provider.generateNextQuestion(ctx).then(function (q) {
          if (!running) return;
          if (q.action === "finish") return finish("provider-finish");
          if (q.action === "alert_doctor") { onRedFlag({ field: target.field, ask: target.ask, reason: q.reason }); return finish("alert-doctor"); }
          asked++; summary.asked = asked;
          onQuestion({ question: q.question, language: q.language || language, targetField: target.field, n: asked, of: maxQ });
          return speak(q.question, q.language || language).then(function () {
            if (!running) return;
            onState("listening", target.field);
            return listen();
          }).then(function (transcript) {
            if (!running) return;
            transcript = String(transcript == null ? "" : transcript).trim();
            if (!transcript) {                                  // couldn't hear -> up to 2 clarifications
              clarifies++;
              if (clarifies >= 2) { known[target.field] = "__unable__"; clarifies = 0; onState("unable", target.field); return step(); }
              onState("clarify", target.field); return step();
            }
            clarifies = 0;
            var det = deterministic(transcript, target) || [];
            var applyFindings = function (findings) {
              findings = findings || [];
              findings.forEach(function (f) {
                known[f.field] = f.value;
                var rec = { field: f.field, value: f.value, confidence: f.confidence, target: target.field, emr: target.emr || "", source: "patient_spoken_via_MaiK", transcript: transcript };
                summary.findings.push(rec); onFinding(rec, target);
              });
              var rf = positiveRedFlag(target, findings);
              if (rf) { onRedFlag(rf); return finish("red-flag"); }
              return step();
            };
            if (det.length) return applyFindings(det);          // deterministic-first (no LLM call)
            return provider.extractPatientAnswer({ complaint: ctx.complaint, targetField: target.field, targetHint: target.ask,
              targetKind: target.kind, allowedFields: allowed, question: q.question, pathway: pathway }, transcript)
              .then(function (r) { return applyFindings((r && r.findings) || []); });
          });
        }).catch(function () { if (running) return step(); });    // never die on one bad turn
      });
    }

    onState("start", pathway.id);
    step();

    return {
      stop: function () { finish("doctor-stopped"); },
      pause: function () { paused = true; onState("paused"); },
      resume: function () { paused = false; onState("resumed"); },
      promise: promise
    };
  }

  // ---- browser layer: native TTS + UI + start() --------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var LANG_MAP = { te: "te-IN", "te-en": "te-IN", hi: "hi-IN", "hi-en": "hi-IN", en: "en-IN", "en-in": "en-IN" };
  function ttsLang(code) { code = String(code || "en").toLowerCase(); return LANG_MAP[code] || (code.indexOf("te") === 0 ? "te-IN" : code.indexOf("hi") === 0 ? "hi-IN" : "en-IN"); }
  // Native TTS (AVSpeechSynthesizer / Android TextToSpeech). Resolves when spoken, or immediately if
  // unavailable (web / missing voice) so the loop never blocks — the question is always on screen too.
  function nativeSpeak(text, lang) {
    text = String(text || ""); if (!text.trim()) return Promise.resolve();
    var P; try { P = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.TextToSpeech; } catch (e) {}
    if (!P || !P.speak) return Promise.resolve();   // web / no plugin -> on-screen only
    return P.speak({ text: text, lang: ttsLang(lang), rate: 1.0, pitch: 1.0, category: "playback" }).catch(function () { return null; });
  }

  function overlay() {
    var el = root.document && document.getElementById("smdMaikAsk");
    if (!el) { el = document.createElement("div"); el.id = "smdMaikAsk"; document.body.appendChild(el); }
    return el;
  }
  function renderConfirm(pathway, langLabel) {
    return '<div class="mka-sheet"><div class="mka-card mka-confirm">' +
      '<div class="mka-brand">' + spark() + "<span>MaiK Ask</span></div>" +
      '<div class="mka-confirm-t">Let MaiK ask a few history questions?</div>' +
      '<div class="mka-confirm-s">MaiK will ask the patient a few relevant questions about the ' + esc(pathway.label || "complaint") +
      " and add the answers to the clinical record for you to review. You can stop anytime." + (langLabel ? " Language: " + esc(langLabel) + "." : "") + "</div>" +
      '<div class="mka-row"><button class="mka-btn ghost" data-mka="cancel">Cancel</button><button class="mka-btn primary" data-mka="start">Start</button></div>' +
      '<div class="mka-priv">' + lock() + "<span>On-device speech - only the answer text (no audio) is used. History aid only; MaiK does not diagnose or advise.</span></div>" +
      "</div></div>";
  }
  function renderCard(s) {
    var listening = s.state === "listening";
    return '<div class="mka-sheet"><div class="mka-card mka-live">' +
      '<div class="mka-brand">' + spark() + "<span>MaiK Ask</span>" + (s.demo ? '<span class="mka-demo">DEMO</span>' : "") + "</div>" +
      '<div class="mka-q" aria-live="polite">' + (s.question ? esc(s.question) : "…") + "</div>" +
      (s.partial ? '<div class="mka-ans">' + esc(s.partial) + "</div>" : "") +
      '<div class="mka-meta">Question ' + (s.n || 1) + " of ~" + (s.of || 6) + "</div>" +
      '<div class="mka-status ' + (listening ? "on" : "") + '">' + (listening ? "&#128308; Listening…" : esc(s.statusText || "Thinking…")) + "</div>" +
      (s.redFlag ? '<div class="mka-alert">' + warn() + "<b>Possible important finding</b><span>" + esc(s.redFlag) + "</span></div>" : "") +
      '<div class="mka-row"><button class="mka-btn ghost" data-mka="pause">' + (s.paused ? "Resume" : "Pause") + '</button>' +
      '<button class="mka-btn ghost" data-mka="skip">Skip</button>' +
      '<button class="mka-btn stop" data-mka="stop">Stop interview</button></div>' +
      "</div></div>";
  }
  function renderReview(summary, pathway) {
    var rows = (summary.findings || []).map(function (f) {
      return '<li><b>' + esc(prettyField(f.target || f.field)) + ":</b> " + esc(f.value) + "</li>";
    }).join("");
    var alertHtml = summary.stoppedReason === "red-flag" ? '<div class="mka-alert">' + warn() + "<b>Stopped for doctor review</b><span>A potentially important finding was reported.</span></div>" : "";
    return '<div class="mka-sheet"><div class="mka-card mka-review">' +
      '<div class="mka-brand">' + spark() + "<span>MaiK Ask complete</span></div>" +
      alertHtml +
      '<div class="mka-review-h">' + (summary.asked || 0) + " question" + (summary.asked === 1 ? "" : "s") + " asked · " + (summary.findings || []).length + " field" + ((summary.findings || []).length === 1 ? "" : "s") + " to add</div>" +
      (rows ? '<ul class="mka-findings">' + rows + "</ul>" : '<div class="mka-empty">No new history was captured.</div>') +
      '<div class="mka-row"><button class="mka-btn ghost" data-mka="close">Continue consultation</button><button class="mka-btn primary" data-mka="review">Review in record</button></div>' +
      "</div></div>";
  }
  function prettyField(f) { return String(f || "").replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function spark() { return '<span class="mka-spark">&#10022;</span>'; }
  function lock() { try { return (root.SMD_MAIKASK && root.icon) ? "" : ""; } catch (e) { return ""; } }
  function warn() { return '<span class="mka-warn">&#9888;</span>'; }

  // Public entry: ensures the pathways are loaded (once), then opens the confirm sheet. opts:
  //   { complaint, known, language?, onFindings(findings), onDone(summary), onReview?, demo?, demoAnswers? }
  function start(opts) {
    opts = opts || {};
    if (!flagOn()) { toast("MaiK Ask is off."); return; }
    if (!(root.SMD_PATHWAYS && root.SMD_MAIK_REASON)) { toast("MaiK Ask is not ready."); return; }
    if (!root.SMD_PATHWAYS.all().length && root.SMD_PATHWAYS.loadAll) { root.SMD_PATHWAYS.loadAll().then(function () { _start(opts); }); return; }
    _start(opts);
  }
  function _start(opts) {
    opts = opts || {};
    var complaint = String(opts.complaint || "");
    var id = root.SMD_PATHWAYS.match(complaint, opts.known || {});
    if (!id) { toast("MaiK Ask does not have a question pathway for this complaint yet."); return; }
    var pathway = root.SMD_PATHWAYS.get(id);
    var known = root.SMD_PATHWAYS.knownFrom(opts.known || {}, pathway);
    var lang = opts.language || (root.SMD_MAIK_REASON.detectLanguage(complaint || "").primary) || "";
    var langLabel = { telugu: "Telugu", hindi: "Hindi", english: "English" }[lang] || "";

    var el = overlay(); el.classList.add("on");
    el.innerHTML = renderConfirm(pathway, langLabel);
    var ctl = null, cardState = { question: "", n: 0, of: pathway.maxQuestions, state: "start", demo: !!opts.demo, paused: false };
    var listenHandle = { setPartial: function () {}, onDone: null };

    function paint() { el.innerHTML = renderCard(cardState); }
    function close() { try { stopSpeaking(); } catch (e) {} el.classList.remove("on"); el.innerHTML = ""; }
    function stopSpeaking() { try { var P = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.TextToSpeech; if (P && P.stop) P.stop(); } catch (e) {} }

    function realListen() {
      return new Promise(function (resolve) {
        if (!root.SMD_VOICE || !root.SMD_VOICE.listen) return resolve("");
        var done = false, text = "";
        var sess = root.SMD_VOICE.listen({
          engine: "clinical", language: "auto", noCloud: true,
          onPartial: function (t) { text = t; cardState.partial = t; try { var e = el.querySelector(".mka-ans"); if (e) e.textContent = t; else paint(); } catch (x) {} },
          onFinal: function (t) { if (done) return; done = true; resolve(String(t || text || "").trim()); },
          onError: function () { if (done) return; done = true; resolve(""); }
        });
        listenHandle.onDone = function () { try { sess && sess.stop && sess.stop(); } catch (e) {} };
        setTimeout(function () { try { sess && sess.stop && sess.stop(); } catch (e) {} if (!done) { done = true; resolve(String(text || "").trim()); } }, 14000);
      });
    }
    var demoIdx = 0;
    function demoListen() { return Promise.resolve((opts.demoAnswers || [])[demoIdx++] || ""); }

    function runInterview() {
      cardState.state = "start"; cardState.partial = ""; paint();
      ctl = _runInterview({
        pathway: pathway, pathways: root.SMD_PATHWAYS, provider: root.SMD_MAIK_REASON,
        known: known, language: lang, complaint: complaint,
        speak: opts.demo ? function () { return Promise.resolve(); } : nativeSpeak,
        listen: opts.demo ? demoListen : realListen,
        onQuestion: function (q) { cardState.question = q.question; cardState.partial = ""; cardState.n = q.n; cardState.of = q.of; cardState.state = "speaking"; cardState.statusText = "MaiK is asking…"; paint(); },
        onState: function (st, info) { if (st === "listening") { cardState.state = "listening"; paint(); } else if (st === "clarify") { cardState.statusText = "Sorry, could you say that again?"; paint(); } },
        onFinding: function () {},
        onRedFlag: function (rf) { cardState.redFlag = rf.ask ? ("Patient may have reported: " + rf.ask) : "A potentially important finding was reported."; paint(); }
      });
      ctl.promise.then(function (summary) {
        // Fold findings into the EXISTING EMR (draft) for the doctor to review — via the caller's guarded apply.
        try { if (opts.onFindings) opts.onFindings(summary.findings || []); } catch (e) {}
        el.innerHTML = renderReview(summary, pathway);
        try { if (opts.onDone) opts.onDone(summary); } catch (e) {}
      });
    }

    el.onclick = function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest("[data-mka]"); if (!b) return;
      var a = b.getAttribute("data-mka");
      if (a === "cancel" || a === "close") return close();
      if (a === "start") return runInterview();
      if (a === "pause") { if (!ctl) return; if (cardState.paused) { ctl.resume(); cardState.paused = false; } else { ctl.pause(); cardState.paused = true; } paint(); return; }
      if (a === "skip") { if (listenHandle.onDone) listenHandle.onDone(); return; }   // stop listening -> loop moves on
      if (a === "stop") { if (ctl) ctl.stop(); return; }
      if (a === "review") { close(); try { if (opts.onReview) opts.onReview(); } catch (e) {} return; }
    };
  }
  function toast(m) { try { (root.toast || root.SMD_toast || function () {})(m); } catch (e) {} }

  var API = {
    _version: "phase-ui",
    flagOn: flagOn,
    start: start,
    _runInterview: _runInterview,
    _deterministicAnswer: deterministicAnswer,
    _isPositive: isPositive,
    _positiveRedFlag: positiveRedFlag,
    _renderConfirm: renderConfirm,
    _renderCard: renderCard,
    _renderReview: renderReview,
    _ttsLang: ttsLang
  };
  if (root) root.SMD_MAIKASK = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
