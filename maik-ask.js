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
  function positiveRedFlag(target, findings) {
    if (!target || target.kind !== "redflag") return null;
    for (var i = 0; i < findings.length; i++) {
      if (findings[i].field === target.field && /present|yes|positive/i.test(String(findings[i].value))) {
        return { field: target.field, ask: target.ask };
      }
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
              allowedFields: allowed, question: q.question, pathway: pathway }, transcript)
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

  var API = {
    _version: "phase-core",
    flagOn: flagOn,
    _runInterview: _runInterview,
    _deterministicAnswer: deterministicAnswer,
    _isPositive: isPositive,
    _positiveRedFlag: positiveRedFlag
  };
  if (root) root.SMD_MAIKASK = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
