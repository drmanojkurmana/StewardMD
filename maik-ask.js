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

  // PUBLIC-RELEASE-GATE: default ON for dev/testing (owner enable 2026-08-15). The clinical pathways are
  // reviewed:false — SET back to === "1" before any store/public release, pending clinician sign-off. Opt-out: smd_maik_ask="0".
  function flagOn() { try { return !!(root && root.localStorage) && localStorage.getItem("smd_maik_ask") !== "0"; } catch (e) { return true; } }
  // Pipelined interview (silence endpointing + Done button + background extraction + doctor-confirmed
  // transcript before anything is written). Default ON because the previous serial path was not just
  // slow but lossy — it discarded the transcript on every turn. Opt out with smd_maik_ask_fast="0".
  function fastOn() { try { return !!(root && root.localStorage) && localStorage.getItem("smd_maik_ask_fast") !== "0"; } catch (e) { return true; } }

  // ---- multilingual yes/no + deterministic answer extraction (cost control: LLM only when needed) ----
  function isPositive(text) {
    var s = " " + String(text == null ? "" : text).toLowerCase() + " ";
    var neg = /\b(no|not|nahi|nahin|ledu|led|kaadu|kadu|illa|absent|never|em ledu)\b/.test(s);
    var pos = /\b(yes|yeah|yep|ha|haan|avunu|avnu|undi|unnai|unnayi|vundi|present|correct|okay|ok)\b/.test(s);
    if (neg && !pos) return false;
    if (pos && !neg) return true;
    return null;   // ambiguous -> LLM
  }
  // Duration on-device: English digits/number-words (via SMD_VVITALS) + romanized Telugu/Hindi number +
  // unit words. Returns "N days/weeks/months" or "" (-> LLM). Cheap; cuts the most common LLM turn.
  var NUMWORD = { oka: 1, okati: 1, ek: 1, rendu: 2, do: 2, moodu: 3, mudu: 3, teen: 3, naalugu: 4, nalugu: 4, char: 4, chaar: 4,
    aidu: 5, ayidu: 5, paanch: 5, panch: 5, aaru: 6, aru: 6, che: 6, chhe: 6, edu: 7, saat: 7, enimidi: 8, aath: 8, tommidi: 9, nau: 9, padi: 10, das: 10 };
  var UNITWORD = [["day", /\b(days?|roju\w*|din\w*)\b/], ["week", /\b(weeks?|vaar\w*|var\w*|haft\w*)\b/], ["month", /\b(months?|nela\w*|mahin\w*)\b/], ["hour", /\b(hours?|gant\w*)\b/], ["year", /\b(years?|samvats\w*|saal\w*|sanvats\w*)\b/]];
  function durationFromText(t) {
    var num = (root && root.SMD_VVITALS && root.SMD_VVITALS.wordsToNumbers) ? root.SMD_VVITALS.wordsToNumbers(t) : t;
    var low = " " + String(num).toLowerCase() + " ";
    var n = null, m = low.match(/(\d+)/);
    if (m) n = parseInt(m[1], 10);
    else { for (var w in NUMWORD) { if (new RegExp("\\b" + w + "\\b").test(low)) { n = NUMWORD[w]; break; } } }
    if (n == null) return "";
    for (var i = 0; i < UNITWORD.length; i++) if (UNITWORD[i][1].test(low)) return n + " " + UNITWORD[i][0] + (n === 1 ? "" : "s");
    return "";
  }
  // Returns [{field,value,confidence}] for the common cases (duration, yes/no symptoms, cue words); [] -> LLM.
  function deterministicAnswer(transcript, target) {
    var t = String(transcript == null ? "" : transcript);
    if (!target || !t.trim()) return [];
    // duration: "3 days" / "three days" / Telugu "moodu rojulu" / Hindi "do din" — all on-device (no LLM).
    if (target.field === "duration" || /duration/i.test(target.emr || "")) {
      var d = durationFromText(t);
      if (d) return [{ field: target.field, value: d, confidence: 0.85 }];
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
    // Unambiguous denials only. Deliberately NOT "normal"/"fine" — those can co-occur with a positive
    // ("neck is fine but severe weakness") and must never suppress a red-flag alert (sensitivity wins).
    return /\b(absent|no|nope|none|nothing|negative|denies|denied|nil|not|never|without|ledu|led|nahi|nahin|illa|kaadu|kadu)\b/.test(v);
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

  // ---- one listening turn (extracted from the browser layer so its TIMING is unit-testable) -------
  // BUGFIX (2026-08-23): the old inline version called `sess.stop()` and resolved with `text` in the
  // SAME tick. `stop()` only STARTS whisper transcription, and clinical Whisper emits no partials
  // (WhisperEngine.swift declares onPartial but never calls it), so it always resolved "" and the real
  // `onFinal` was then dropped by `if (done) return`. Every question burned the full window and
  // captured NOTHING, so the loop re-asked, then gave up with "__unable__". Now the cap only stops the
  // mic and the promise settles on `onFinal` — with a grace timer so a lost final can never hang us.
  //
  // Endpointing: `silenceEndpointMs` asks the native engine to auto-stop shortly after the patient
  // stops speaking (the big win — the old code always waited the full window). `done()` is the on-screen
  // "Done" button (works everywhere, including builds without native VAD); `skip()` abandons the answer.
  var LISTEN_MAX_MS = 15000;      // hard backstop only; VAD/Done normally end the turn far sooner
  var LISTEN_GRACE_MS = 12000;    // Android CPU whisper can take ~7s after stop; leave headroom
  var SILENCE_ENDPOINT_MS = 1500; // ponytail: tuned by ear in a quiet room; a noisy OPD may need more
  function _listenTurn(deps) {
    deps = deps || {};
    var listen = deps.listen;
    var maxMs = deps.maxMs == null ? LISTEN_MAX_MS : deps.maxMs;
    var graceMs = deps.graceMs == null ? LISTEN_GRACE_MS : deps.graceMs;
    var silenceMs = deps.silenceMs == null ? SILENCE_ENDPOINT_MS : deps.silenceMs;
    var onPartial = deps.onPartial || function () {};
    var done = false, stopped = false, text = "", hardTmr = null, graceTmr = null, sess = null, settle;
    var promise = new Promise(function (res) {
      settle = function (v) {
        if (done) return; done = true;
        if (hardTmr) { clearTimeout(hardTmr); hardTmr = null; }
        if (graceTmr) { clearTimeout(graceTmr); graceTmr = null; }
        res(String(v == null ? "" : v).trim());
      };
    });
    function stopMic() { try { if (sess && sess.stop) sess.stop(); } catch (e) {} }
    function endTurn() {                       // patient finished: stop the mic, then WAIT for the text
      if (stopped || done) return; stopped = true;
      stopMic();
      graceTmr = setTimeout(function () { settle(text); }, graceMs);
    }
    function skip() { if (done) return; stopped = true; stopMic(); settle(""); }
    if (typeof listen !== "function") { settle(""); return { promise: promise, done: endTurn, skip: skip }; }
    sess = listen({
      engine: "clinical", language: "auto", noCloud: true, silenceEndpointMs: silenceMs,
      onPartial: function (t) { text = String(t == null ? "" : t); onPartial(text); },
      onFinal: function (t) { settle(t || text); },
      onError: function () { settle(""); }
    });
    hardTmr = setTimeout(endTurn, maxMs);
    return { promise: promise, done: endTurn, skip: skip };
  }

  // The A-to-Z interview transcript. Built from EVERY turn, including ones that produced no finding —
  // the old summary kept a transcript only on individual findings, so an unanswered or unclassified
  // question vanished without trace. The doctor confirms THIS text before anything is saved.
  function _buildTranscript(turns) {
    return (turns || []).map(function (t) {
      var q = String(t.question == null ? "" : t.question).trim();
      var a = String(t.answer == null ? "" : t.answer).trim();
      return "Q" + (t.n || "") + ". " + q + "\nA. " + (a || "(no answer heard)");
    }).join("\n\n");
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

    // background:true = pipelined mode (flag smd_maik_ask_fast). The on-device deterministic pass picks
    // the next question immediately; a slow LLM extraction runs UNAWAITED and is reconciled at the end.
    var background = !!deps.background;
    var running = true, paused = false, asked = 0, clarifies = 0, attempts = {};
    var summary = { asked: 0, findings: [], turns: [], transcript: "", known: null, stoppedReason: "" };
    var pending = [];        // in-flight background extractions, drained by finish()
    var resolveOuter;
    var promise = new Promise(function (res) { resolveOuter = res; });

    // finish() is ASYNC in background mode: it drains the in-flight extractions, folds their findings in,
    // clears any "__pending__" sentinel, and only then builds the transcript and resolves.
    function finish(reason) {
      if (!running) return;
      running = false; summary.stoppedReason = reason;
      var wait = pending.length ? Promise.all(pending) : Promise.resolve([]);
      if (pending.length) onState("reconciling", reason);
      wait.then(function (results) {
        (results || []).forEach(function (r) {
          if (!r || !r.target) return;
          (r.findings || []).forEach(function (f) {
            if (!(f.field in known) || known[f.field] === "__pending__") known[f.field] = f.value;
            var rec = { field: f.field, value: f.value, confidence: f.confidence, target: r.target.field,
              emr: r.target.emr || "", source: "patient_spoken_via_MaiK", transcript: (summary.turns[r.ti] || {}).answer || "" };
            summary.findings.push(rec);
            if (summary.turns[r.ti]) summary.turns[r.ti].findings.push(rec);
            try { onFinding(rec, r.target); } catch (e) {}
          });
        });
        for (var k in known) if (known[k] === "__pending__") known[k] = "__unclear__";
        summary.known = known;
        summary.transcript = _buildTranscript(summary.turns);
        onState("done", reason);
        resolveOuter(summary);
      });
    }
    function waitIfPaused() { return new Promise(function (res) { (function tick() { if (!paused || !running) return res(); setTimeout(tick, 120); })(); }); }

    // Prefetch: while the patient answers question N, generate question N+1 in the background so it is
    // ready instantly. Keyed by field; an unused prefetch (if the answer changes the next target) is just
    // a discarded promise. generateNextQuestion never rejects (validates + falls back), so a stored
    // prefetch is always a safe, valid question — it can never surface a wrong or unvalidated question.
    var prefetched = {};
    function buildCtx(t) {
      return { complaint: deps.complaint || pathway.label, pathwayLabel: pathway.label, targetField: t.field,
        targetHint: t.ask, known: known, allowedFields: allowed, language: language, pathway: pathway };
    }
    function getQuestion(t) {
      if (prefetched[t.field]) { var p = prefetched[t.field]; delete prefetched[t.field]; return p; }
      return provider.generateNextQuestion(buildCtx(t));
    }
    function prefetchNext(assumedKnown) {
      if (!running) return;
      try { var t2 = PW.nextTarget(pathway, assumedKnown); if (t2 && !prefetched[t2.field]) prefetched[t2.field] = provider.generateNextQuestion(buildCtx(t2)); } catch (e) {}
    }
    function step() {
      if (!running) return;
      waitIfPaused().then(function () {
        if (!running) return;
        if (asked >= maxQ) return finish("max-questions");
        var target = PW.nextTarget(pathway, known);
        if (!target) return finish("complete");

        getQuestion(target).then(function (q) {
          if (!running) return;
          if (q.action === "finish") return finish("provider-finish");
          if (q.action === "alert_doctor") { onRedFlag({ field: target.field, ask: target.ask, reason: q.reason }); return finish("alert-doctor"); }
          asked++; summary.asked = asked;
          onQuestion({ question: q.question, language: q.language || language, targetField: target.field, n: asked, of: maxQ });
          return speak(q.question, q.language || language).then(function () {
            if (!running) return;
            onState("listening", target.field);
            // Overlap the next question's LLM round-trip with the patient's answer + ASR (assume the
            // current target gets answered) so the next question is ready instantly.
            var assumed = {}; for (var ak in known) assumed[ak] = known[ak]; assumed[target.field] = "__pending__";
            prefetchNext(assumed);
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
            // Record the turn BEFORE any extraction, so the transcript keeps the answer even when
            // nothing is extracted from it (the old code lost those answers entirely).
            var ti = summary.turns.length;
            summary.turns.push({ n: asked, field: target.field, question: q.question, answer: transcript, findings: [] });
            var det = deterministic(transcript, target) || [];
            var applyFindings = function (findings) {
              findings = findings || [];
              findings.forEach(function (f) {
                known[f.field] = f.value;
                var rec = { field: f.field, value: f.value, confidence: f.confidence, target: target.field, emr: target.emr || "", source: "patient_spoken_via_MaiK", transcript: transcript };
                summary.findings.push(rec); if (summary.turns[ti]) summary.turns[ti].findings.push(rec); onFinding(rec, target);
              });
              var rf = positiveRedFlag(target, findings);
              if (rf) { onRedFlag(rf); return finish("red-flag"); }
              // The patient answered but nothing resolved THIS target (irrelevant answer / extraction miss).
              // Re-ask at most twice, then mark it unclear and MOVE ON — never loop forever on one field.
              if (!(target.field in known)) {
                attempts[target.field] = (attempts[target.field] || 0) + 1;
                if (attempts[target.field] >= 2) { known[target.field] = "__unclear__"; onState("unclear", target.field); }
              }
              return step();
            };
            if (det.length) return applyFindings(det);          // deterministic-first (no LLM call)
            var pex = provider.extractPatientAnswer({ complaint: deps.complaint || pathway.label, targetField: target.field, targetHint: target.ask,
              targetKind: target.kind, allowedFields: allowed, question: q.question, pathway: pathway }, transcript);
            // SAFETY CARVE-OUT: red flags are NEVER pipelined. The deterministic pass only catches
            // yes/no, so a descriptive positive ("numbness since this morning") is visible only to the
            // LLM. Deferring it would let the interview carry on asking routine questions instead of
            // stopping and alerting the doctor. Red-flag targets are few, so the wait is cheap.
            if (!background || target.kind === "redflag") return pex.then(function (r) { return applyFindings((r && r.findings) || []); });
            // Pipelined: claim the field so nextTarget moves on, run the extraction unawaited, and
            // reconcile it in finish(). Never rejects out of the loop.
            known[target.field] = "__pending__";
            pending.push(pex.then(function (r) { return { findings: (r && r.findings) || [], target: target, ti: ti }; },
              function () { return null; }));
            return step();
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
      '<div class="mka-row"><button class="mka-btn ghost" data-mka="cancel" aria-label="Close">Cancel</button><button class="mka-btn primary" data-mka="start">Start</button></div>' +
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
      '<div class="mka-row">' + (listening ? '<button class="mka-btn primary" data-mka="done">Done</button>' : "") +
      '<button class="mka-btn ghost" data-mka="pause">' + (s.paused ? "Resume" : "Pause") + '</button>' +
      '<button class="mka-btn ghost" data-mka="skip">Skip</button>' +
      '<button class="mka-btn stop" data-mka="stop" aria-label="Close">Stop interview</button></div>' +
      "</div></div>";
  }
  // Doctor-confirmation gate. The transcript is EDITABLE (MaiK mishears; the doctor is the authority)
  // and every extracted field is a tick box, defaulting to on. Nothing reaches the record or the
  // patient timeline until "Save to record" is tapped.
  function renderReview(summary, pathway) {
    var rows = (summary.findings || []).map(function (f, i) {
      return '<li><label class="mka-pickrow"><input type="checkbox" class="mka-pick" data-i="' + i + '" checked>' +
        "<span><b>" + esc(prettyField(f.target || f.field)) + ":</b> " + esc(f.value) + "</span></label></li>";
    }).join("");
    var alertHtml = summary.stoppedReason === "red-flag" ? '<div class="mka-alert">' + warn() + "<b>Stopped for doctor review</b><span>A potentially important finding was reported.</span></div>" : "";
    var n = (summary.findings || []).length;
    return '<div class="mka-sheet"><div class="mka-card mka-review">' +
      '<div class="mka-brand">' + spark() + "<span>MaiK Ask complete</span></div>" +
      alertHtml +
      '<div class="mka-review-h">' + (summary.asked || 0) + " question" + (summary.asked === 1 ? "" : "s") + " asked · " + n + " field" + (n === 1 ? "" : "s") + " to add</div>" +
      (summary.transcript
        ? '<div class="mka-review-sub">Transcript — edit anything MaiK misheard</div>' +
          '<textarea class="mka-tx" id="mkaTx" rows="8" aria-label="Interview transcript">' + esc(summary.transcript) + "</textarea>"
        : "") +
      (rows ? '<div class="mka-review-sub">Add to the record</div><ul class="mka-findings">' + rows + "</ul>"
            : '<div class="mka-empty">No new history was captured.</div>') +
      '<div class="mka-row"><button class="mka-btn ghost" data-mka="close">Discard</button>' +
      '<button class="mka-btn primary" data-mka="save">Save to record</button></div>' +
      '<div class="mka-priv"><span>Nothing is saved until you tap Save. Patient-reported history, not a diagnosis.</span></div>' +
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
    var listenHandle = { done: null, skip: null };
    var lastSummary = null;
    var fast = fastOn();

    function paint() { el.innerHTML = renderCard(cardState); }
    function close() { try { stopSpeaking(); } catch (e) {} el.classList.remove("on"); el.innerHTML = ""; }
    function stopSpeaking() { try { var P = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.TextToSpeech; if (P && P.stop) P.stop(); } catch (e) {} }

    function realListen() {
      var turn = _listenTurn({
        listen: (root.SMD_VOICE && root.SMD_VOICE.listen) ? function (o) { return root.SMD_VOICE.listen(o); } : null,
        onPartial: function (t) {
          cardState.partial = t;
          try { var e = el.querySelector(".mka-ans"); if (e) e.textContent = t; else paint(); } catch (x) {}
        }
      });
      listenHandle.done = turn.done;     // "Done" button: stop the mic, still wait for the transcript
      listenHandle.skip = turn.skip;     // "Skip": abandon this answer immediately
      return turn.promise;
    }
    var demoIdx = 0;
    function demoListen() { return Promise.resolve((opts.demoAnswers || [])[demoIdx++] || ""); }

    function runInterview() {
      cardState.state = "start"; cardState.partial = ""; paint();
      ctl = _runInterview({
        pathway: pathway, pathways: root.SMD_PATHWAYS, provider: root.SMD_MAIK_REASON,
        known: known, language: lang, complaint: complaint, background: fast,
        speak: opts.demo ? function () { return Promise.resolve(); } : nativeSpeak,
        listen: opts.demo ? demoListen : realListen,
        onQuestion: function (q) { cardState.question = q.question; cardState.partial = ""; cardState.n = q.n; cardState.of = q.of; cardState.state = "speaking"; cardState.statusText = "MaiK is asking…"; paint(); },
        onState: function (st, info) { if (st === "listening") { cardState.state = "listening"; paint(); } else if (st === "clarify") { cardState.statusText = "Sorry, could you say that again?"; paint(); } },
        onFinding: function () {},
        onRedFlag: function (rf) { cardState.redFlag = rf.ask ? ("Patient may have reported: " + rf.ask) : "A potentially important finding was reported."; paint(); }
      });
      ctl.promise.then(function (summary) {
        lastSummary = summary;
        // Legacy path folds findings straight into the EMR draft. In fast mode NOTHING is applied or
        // saved until the doctor reviews the transcript and taps Save (handled in the click dispatcher).
        if (!fast) { try { if (opts.onFindings) opts.onFindings(summary.findings || []); } catch (e) {} }
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
      if (a === "done") { if (listenHandle.done) listenHandle.done(); return; }   // answer finished -> transcribe now
      if (a === "skip") { if (listenHandle.skip) listenHandle.skip(); return; }   // abandon this answer -> loop moves on
      if (a === "stop") { if (ctl) ctl.stop(); return; }
      if (a === "review") { close(); try { if (opts.onReview) opts.onReview(); } catch (e) {} return; }
      if (a === "save") {                      // the ONLY route that writes anything to the record
        var tx = ""; try { var ta = el.querySelector("#mkaTx"); tx = ta ? String(ta.value || "") : ""; } catch (e) {}
        var picked = [];
        try {
          [].forEach.call(el.querySelectorAll(".mka-pick"), function (cb) {
            if (!cb.checked) return;
            var f = ((lastSummary && lastSummary.findings) || [])[parseInt(cb.getAttribute("data-i"), 10)];
            if (f) picked.push(f);
          });
        } catch (e) {}
        close();
        try {
          if (opts.onConfirm) opts.onConfirm({ transcript: tx, findings: picked, summary: lastSummary });
          else if (opts.onFindings) opts.onFindings(picked);        // caller without a confirm handler
        } catch (e) {}
        return;
      }
    };
  }
  function toast(m) { try { (root.toast || root.SMD_toast || function () {})(m); } catch (e) {} }

  var API = {
    _version: "phase-ui",
    flagOn: flagOn,
    start: start,
    _runInterview: _runInterview,
    _listenTurn: _listenTurn,
    _buildTranscript: _buildTranscript,
    _deterministicAnswer: deterministicAnswer,
    _isPositive: isPositive,
    _positiveRedFlag: positiveRedFlag,
    _durationFromText: durationFromText,
    _renderConfirm: renderConfirm,
    _renderCard: renderCard,
    _renderReview: renderReview,
    _ttsLang: ttsLang
  };
  if (root) root.SMD_MAIKASK = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
