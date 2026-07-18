/* fundx.js — FundX AI · module shell + guided-acquisition UI (StewardMD).
 *
 * AI-guided smartphone fundus imaging, built INSIDE StewardMD. Owns the full-screen
 * overlay + screen router: Home → Pre-capture → Live Camera (AR coaching) → Processing
 * → Quality Review → Result. Consumes the Vision Engine (window.SMD_FUNDX_VISION), the
 * perception layer (window.SMD_FUNDX_DETECT) and persistence (window.SMD_FUNDX_STORE)
 * through their public contracts only.
 *
 * Additive + reversible: gated behind smd_fundx (DEFAULT OFF; ?fundx=1 or Settings). When
 * off, this module returns early and is a complete no-op. Phase A UI is the frozen source
 * of truth; deviations forced by the web/Capacitor target are in the design Deviations log.
 *
 * The heavy pieces (camera, coaching) are wired here; the pure processing helpers
 * (_buildResult / _buildScanRecord) are DOM-free and unit-tested.
 */
(function () {
  "use strict";

  function fundxOn() {
    try {
      var q = (location.search.match(/[?&]fundx=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      var v = localStorage.getItem("smd_fundx");
      return v === null ? false : v === "1";
    } catch (e) { return false; }
  }
  if (!fundxOn()) {
    if (typeof window !== "undefined" && !window.FUNDX) {
      window.FUNDX = { open: function () { try { if (window.toast) toast("FundX AI is off — enable it in Settings."); } catch (e) {} }, close: function () {}, isOpen: function () { return false; }, enabled: function () { return false; } };
    }
    return;
  }

  function V() { return window.SMD_FUNDX_VISION; }
  function DET() { return window.SMD_FUNDX_DETECT; }
  function STORE() { return window.SMD_FUNDX_STORE; }
  var H = (typeof window !== "undefined" && window.SMD_HAPTICS) || null;

  var rootEl = null, ctx = null, screen = "home";
  var session = null, cam = null, sm = null, hub = null, lastFa = null, result = null, detail = null;
  var capturing = false, lastHapticState = "", scanSeq = 0, lastCoachArrow = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function ric(name) { return '<span class="rds-icon" aria-hidden="true">' + name + '</span>'; }
  function haptic(kind) { try { if (H && H[kind]) H[kind](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function nowMs() { return (typeof Date !== "undefined") ? Date.now() : 0; }

  var DISC_LOCAL = 'Vision detection preview — not a diagnosis. Images stay on this device.';
  var DISC_CLOUD = 'Vision preview via StewardMD AI (Google Vertex AI) — images are sent securely for this analysis, not used to train models. Not a diagnosis.';

  // ---- cloud provider selection: health-gated auto-activation + one-time consent ----
  // Once the FundX backend reports a real provider available (GET /api/fundx/health), the app
  // AUTO-ACTIVATES it instead of the on-device mock — so it never sits in mock mode when valid
  // credentials exist. Because cloud analysis sends the image off-device, a one-time consent
  // is required (null pref → ask at pre-capture); the disclaimer updates to reflect it.
  function cloudPref() { try { return localStorage.getItem("smd_fundx_cloud"); } catch (e) { return null; } }   // "1" | "0" | null(ask)
  function cloudEnabled() { return cloudPref() === "1"; }
  function setCloudPref(v) { try { localStorage.setItem("smd_fundx_cloud", v); } catch (e) {} }
  var _backend = null;
  function parseHealth(h) {
    var av = (h && h.providers ? h.providers : []).filter(function (p) { return p && p.available; }).map(function (p) { return p.name; });
    var vision = av.indexOf("vertex") >= 0 || av.indexOf("developer") >= 0;
    return { vision: vision, clinical: vision || av.indexOf("cerebras") >= 0, providers: av };
  }
  function checkBackend() {
    if (_backend) return Promise.resolve(_backend);
    if (typeof fetch !== "function") { _backend = { vision: false, clinical: false, providers: [] }; return Promise.resolve(_backend); }
    return fetch("/api/fundx/health").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) { _backend = parseHealth(h); return _backend; })
      .catch(function () { _backend = { vision: false, clinical: false, providers: [] }; return _backend; });
  }
  function providerTarget(enabled, backend) { return (enabled && backend && backend.vision) ? "vertex-gemini" : "mock"; }
  function cloudActive() { return cloudEnabled() && !!(_backend && _backend.vision); }
  function applyProviderSelection() {
    return checkBackend().then(function (b) {
      try {
        var P = window.SMD_FUNDX_PROVIDERS; if (P) P.setActive(providerTarget(cloudEnabled(), b));
        var Cx = window.SMD_FUNDX_CLINICAL; if (Cx) Cx.setActive(cloudEnabled() && b.clinical ? "backend" : "rules");
      } catch (e) {}
      if (rootEl && screen === "precapture") render();   // refresh the consent card once health is known
      return b;
    });
  }
  function disclaimerText() { return cloudActive() ? DISC_CLOUD : DISC_LOCAL; }

  // Advisory Clinical Engine (Phase C) is a NESTED flag, default OFF — no clinical advice
  // surfaces unless explicitly enabled. When on, a rule-based advisory assessment renders.
  function clinicalOn() { try { return localStorage.getItem("smd_fundx_clinical") === "1"; } catch (e) { return false; } }
  function clinicalCard(findingsWrap) {
    if (!clinicalOn() || !window.SMD_FUNDX_CLINICAL || !findingsWrap) return "";
    var a;
    try { a = window.SMD_FUNDX_CLINICAL.assessSync(findingsWrap, { age: ctx && ctx.age, sex: ctx && ctx.sex, dx: (ctx && ctx.meta) || "" }); } catch (e) { return ""; }
    var sev = { none: "stable", mild: "stable", moderate: "warning", severe: "critical" }[a.severity] || "info";
    var urg = { routine: "stable", soon: "warning", urgent: "urgent", emergency: "critical" }[a.urgency] || "info";
    function badge(cls, txt) { return '<span class="fundx-badge b-' + cls + '">' + esc(txt) + '</span>'; }
    var ref = a.referral ? '<div class="fundx-frow"><span>Referral</span><b>' + esc(a.referral.to) + ' · ' + esc(a.referral.priority) + '</b></div>' : '';
    var inv = a.investigations && a.investigations.length ? '<div class="fundx-frow"><span>Suggested</span><b>' + esc(a.investigations.join(", ")) + '</b></div>' : '';
    var safety = a.safetyFlags && a.safetyFlags.length ? '<div class="fundx-whys">' + a.safetyFlags.map(function (s) { return '<span class="fundx-why">' + ric("shield") + esc(s.replace(/_/g, " ")) + '</span>'; }).join("") + '</div>' : '';
    return '<div class="rds-section-header"><span class="rds-section-title">Clinical assessment · advisory</span></div>' +
      '<div class="fundx-clin">' +
        '<div class="fundx-clin-top"><b>' + esc(a.label) + '</b><span>' + badge(sev, a.severity) + badge(urg, a.urgency) + '</span></div>' +
        '<div class="fundx-findings" style="margin-top:10px">' + ref + inv +
          '<div class="fundx-frow"><span>Follow-up</span><b>' + esc(a.followUp.interval) + '</b></div>' +
          '<div class="fundx-frow"><span>Confidence</span><b>' + a.confidence + '</b></div>' +
        '</div>' + safety +
        '<p class="fundx-note">' + esc(a.disclaimer) + ' (' + esc(a.provider) + ' engine)</p>' +
      '</div>';
  }

  // ---- voice coaching (TTS) — OFF by default, Web Speech, graceful ---------
  var VOICE = (function () {
    var last = "", lastAt = 0;
    function on() { try { return localStorage.getItem("smd_fundx_voice") === "1"; } catch (e) { return false; } }
    return {
      enabled: on,
      setEnabled: function (b) { try { localStorage.setItem("smd_fundx_voice", b ? "1" : "0"); } catch (e) {} },
      speak: function (text) {
        if (!on() || !text) return;
        var t = nowMs(); if (text === last && (t - lastAt) < 2800) return; last = text; lastAt = t;
        try {
          if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return;
          var u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 1;
          window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
        } catch (e) {}
      },
      stop: function () { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {} }
    };
  })();

  // ---- gate chips config --------------------------------------------------
  var CHIPS = [
    { k: "eye", l: "Eye" }, { k: "pupil", l: "Pupil" }, { k: "distance", l: "Distance" },
    { k: "redReflex", l: "Reflex" }, { k: "fundus", l: "Fundus" }, { k: "vessels", l: "Vessels" },
    { k: "focus", l: "Focus" }, { k: "reflection", l: "Glare" }, { k: "motion", l: "Steady" },
    { k: "level", l: "Level" }, { k: "quality", l: "Quality" }
  ];
  function arrowGlyph(a) {
    return { left: "west", right: "east", up: "north", down: "south", closer: "add", farther: "remove", rot_cw: "rotate_right", rot_ccw: "rotate_left" }[a] || "";
  }

  // Guided Training Mode — 7 acquisition-skill levels (observable-cue driven; no diagnosis,
  // no saved scan, no lens-power knowledge required).
  var LEVELS = [
    { n: 1, key: "find_eye", title: "Find the eye", desc: "Point the camera so the eye fills the view." },
    { n: 2, key: "center_pupil", title: "Center the pupil", desc: "Move until the pupil sits in the centre." },
    { n: 3, key: "working_distance", title: "Set the working distance", desc: "Move closer or back until the distance is right." },
    { n: 4, key: "red_reflex", title: "Hold the red reflex", desc: "Tilt until the orange-red glow appears and stays." },
    { n: 5, key: "retinal_view", title: "Bring up the retinal view", desc: "Get a round, filled fundus field in the centre." },
    { n: 6, key: "steady_focus", title: "Steady and in focus", desc: "Hold still, level, and glare-free until it sharpens." },
    { n: 7, key: "diagnostic_capture", title: "Diagnostic-quality capture", desc: "Hold until vessels and quality are good enough to capture." }
  ];
  // Pure: has the target skill for `level` been achieved this frame? (observable gates only)
  function levelAchieved(level, gates, readiness) {
    gates = gates || {}; readiness = readiness || {};
    switch (level) {
      case 1: return !!gates.eye;
      case 2: return !!gates.pupil;
      case 3: return !!gates.distance;
      case 4: return !!gates.redReflex;
      case 5: return !!gates.fundus;
      case 6: return !!(gates.focus && gates.motion && gates.reflection && gates.level);
      case 7: return !!readiness.ready;
      default: return false;
    }
  }

  // ================= SCREENS =================
  function screenHome() {
    var who = ctx && ctx.name ? '<div class="fundx-sub">' + esc(ctx.name) + (ctx.meta ? ' · ' + esc(ctx.meta) : '') + '</div>' : '';
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="close" aria-label="Close">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>FundX<span>AI</span></b>' + who + '</div><div class="fundx-head-sp"></div>' +
        '<button class="fundx-close" data-fx="settings" aria-label="Settings">' + ric("settings") + '</button>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<button class="fundx-cta" data-fx="newscan">' + ric("visibility") +
          '<div class="fundx-cta-tx"><b>New retinal scan</b><span>Guided capture with the 20D lens</span></div>' + ric("chevron_right") + '</button>' +
        '<div class="fundx-row2">' +
          '<button class="fundx-tile" data-fx="training">' + ric("school") + '<b>Training</b><span>Learn to align the lens</span></button>' +
          '<button class="fundx-tile" data-fx="gallery">' + ric("collections") + '<b>Scans</b><span>Review captures</span></button>' +
        '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Recent scans</span></div>' +
        '<div id="fundxRecent" class="fundx-recent"><div class="fundx-empty">' + ric("hourglass_empty") + '<span>Loading…</span></div></div>' +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }

  function screenPrecapture() {
    var eye = (session && session.eye) || "right";
    function eyeBtn(v, label) { return '<button class="fundx-eye' + (eye === v ? ' on' : '') + '" data-fx="eye" data-eye="' + v + '">' + ric("visibility") + '<span>' + label + '</span></button>'; }
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="home" aria-label="Back">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Prepare capture</b></div><div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<div class="rds-section-header"><span class="rds-section-title">Which eye?</span></div>' +
        '<div class="fundx-eyes">' + eyeBtn("right", "Right (OD)") + eyeBtn("left", "Left (OS)") + '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Holding the 20D lens</span></div>' +
        '<ul class="fundx-primer">' +
          '<li>' + ric("pan_tool") + '<div><b>Hold the lens ~2 cm from the eye</b><span>White-ring side toward you; keep it steady between the phone and the eye.</span></div></li>' +
          '<li>' + ric("center_focus_strong") + '<div><b>Line up phone → lens → pupil</b><span>Keep all three on one axis; the coach will nudge you left/right and closer/farther.</span></div></li>' +
          '<li>' + ric("lightbulb") + '<div><b>Dim the room</b><span>Lower ambient light so the red reflex and retina show through.</span></div></li>' +
        '</ul>' +
        ((_backend && _backend.vision && cloudPref() === null) ?
          '<div class="fundx-consent"><div class="fundx-consent-h">' + ric("cloud") + 'AI cloud analysis available</div>' +
          '<p>This scan can be analysed by StewardMD&rsquo;s AI (Google Vertex AI). The image is sent securely for this analysis and is not used to train models. You can keep analysis on-device instead.</p>' +
          '<div class="fundx-actions"><button class="fundx-btn ghost" data-fx="cloudno">Keep on-device</button><button class="fundx-btn" data-fx="cloudyes">Use AI analysis</button></div></div>' : '') +
        '<button class="fundx-cta" data-fx="startcam">' + ric("photo_camera") +
          '<div class="fundx-cta-tx"><b>Start guided capture</b><span>' + esc(eye === "right" ? "Right (OD)" : "Left (OS)") + ' · camera opens</span></div>' + ric("chevron_right") + '</button>' +
        '<p class="fundx-disc">The camera captures automatically when alignment and quality are good — there is no shutter button. ' + disclaimerText() + '</p>' +
      '</main>';
  }

  function screenCamera() {
    return '' +
      '<div class="fundx-cam">' +
        '<video id="fundxVideo" class="fundx-video" playsinline muted autoplay></video>' +
        '<div class="fundx-cam-scrim"></div>' +
        '<header class="fundx-cam-top rds-safe-top">' +
          '<button class="fundx-cam-x" data-fx="camclose" aria-label="Close">' + ric("close") + '</button>' +
          '<div id="fundxState" class="fundx-state" role="status" aria-live="polite">Starting camera…</div>' +
          '<button id="fundxVoiceBtn" class="fundx-cam-x' + (VOICE.enabled() ? ' on' : '') + '" data-fx="voice" aria-label="Voice coaching">' + ric(VOICE.enabled() ? "volume_up" : "volume_off") + '</button>' +
        '</header>' +
        ((session && session.mode === "training") ? '<div class="fundx-goal">' + ric("school") + 'Level ' + session.trainLevel + ' · ' + esc((LEVELS[session.trainLevel - 1] || {}).title || "") + '</div>' : '') +
        '<div class="fundx-reticle">' +
          '<svg class="fundx-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="fundx-ring-bg" cx="60" cy="60" r="54"/><circle id="fundxRingFg" class="fundx-ring-fg" cx="60" cy="60" r="54"/></svg>' +
          '<div id="fundxArrow" class="fundx-arrow">' + ric("north") + '</div>' +
          '<div id="fundxScore" class="fundx-score">0</div>' +
        '</div>' +
        '<div class="fundx-cam-bottom rds-safe-bottom">' +
          '<div id="fundxCoach" class="fundx-coach" role="status" aria-live="assertive">Point the camera at the eye</div>' +
          '<div id="fundxChips" class="fundx-chips">' + CHIPS.map(function (c) { return '<span class="fundx-chip" data-chip="' + c.k + '">' + c.l + '</span>'; }).join("") + '</div>' +
          '<button id="fundxFallback" class="fundx-fallback" data-fx="confirmlens" style="display:none">' + ric("check_circle") + 'Confirm lens is positioned</button>' +
        '</div>' +
        '<div id="fundxFlash" class="fundx-flash"></div>' +
        (devOn() ? '<div class="fundx-debug-wrap"><div id="fundxDebug" class="fundx-debug"></div><button class="fundx-debug-x" data-fx="devexport">' + ric("download") + 'Export frames</button></div>' : '') +
      '</div>';
  }

  function screenTraining() {
    var st = STORE();
    var lp = st ? st.learning.get() : { levels: {} };
    var op = st ? st.operator.get() : { scans: 0, avgQuality: 0, captures: 0 };
    var done = (lp && lp.levels) || {};
    var doneCount = LEVELS.filter(function (L) { return done[L.n] && done[L.n].done; }).length;
    var rows = LEVELS.map(function (L) {
      var ok = done[L.n] && done[L.n].done;
      return '<button class="fundx-lvl' + (ok ? ' done' : '') + '" data-fx="level" data-level="' + L.n + '">' +
        '<span class="fundx-lvl-n">' + (ok ? ric("check") : L.n) + '</span>' +
        '<span class="fundx-lvl-tx"><b>' + esc(L.title) + '</b><span>' + esc(L.desc) + '</span></span>' +
        '<span class="fundx-lvl-go">' + ric("play_circle") + '</span></button>';
    }).join("");
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="home" aria-label="Back">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Training</b><div class="fundx-sub">' + doneCount + ' / ' + LEVELS.length + ' levels complete</div></div>' +
        '<div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<p class="fundx-primer-note">Practice acquisition skills on a real (or model) eye. No image is saved and no diagnosis is made — just guided coaching until you nail each skill.</p>' +
        '<div class="fundx-lvls">' + rows + '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Your acquisition stats</span></div>' +
        '<div class="fundx-stats">' +
          '<div class="fundx-stat"><b>' + (op.scans || 0) + '</b><span>Scans</span></div>' +
          '<div class="fundx-stat"><b>' + (op.avgQuality || 0) + '</b><span>Avg quality</span></div>' +
          '<div class="fundx-stat"><b>' + doneCount + '</b><span>Levels</span></div>' +
        '</div>' +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }

  function screenProcessing() {
    return '<div class="fundx-proc">' +
      '<div class="fundx-proc-ring"><svg viewBox="0 0 80 80"><circle class="fundx-proc-c" cx="40" cy="40" r="34"/></svg>' + ric("visibility") + '</div>' +
      '<div id="fundxProcTx" class="fundx-proc-tx">Selecting the best frame…</div></div>';
  }

  function screenReview() {
    var q = result && result.quality ? result.quality : { overall: 0, subscores: {}, accepted: false, reasons: [] };
    var acc = q.accepted;
    var img = result && result.images ? result.images.original : "";
    function bar(label, val) {
      var pct = Math.round((val || 0) * 100);
      return '<div class="fundx-qbar"><span>' + label + '</span><i><b style="width:' + pct + '%"></b></i></div>';
    }
    var reasonNames = { poor_focus: "Focus", poor_exposure: "Exposure", excessive_reflection: "Reflection/glare", fundus_not_visible: "Retinal view not clear", no_vessels_detected: "Vessels not visible", field_of_view_inadequate: "Field of view" };
    var why = (q.reasons || []).map(function (r) { return '<span class="fundx-why">' + ric("error") + (reasonNames[r] || r) + '</span>'; }).join("");
    var s = q.subscores || {};
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="retake" aria-label="Retake">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Quality review</b></div><div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<div class="fundx-shot">' + (img ? '<img src="' + esc(img) + '" alt="captured retinal frame">' : '') +
          '<div class="fundx-shot-q ' + (acc ? 'ok' : 'bad') + '">' + Math.round(q.overall) + '</div></div>' +
        '<div class="fundx-verdict ' + (acc ? 'ok' : 'bad') + '">' + ric(acc ? "check_circle" : "cancel") +
          '<span>' + (acc ? "Image accepted — good quality" : "Image rejected — retake recommended") + '</span></div>' +
        (why ? '<div class="fundx-whys">' + why + '</div>' : '') +
        '<div class="rds-section-header"><span class="rds-section-title">Quality breakdown</span></div>' +
        '<div class="fundx-qbars">' + bar("Focus", s.focus) + bar("Exposure", s.exposure) + bar("Low glare", s.reflection) + bar("Retinal view", s.fundusVisibility) + bar("Vessels", s.vesselVisibility) + bar("Red reflex", s.redReflex) + bar("Field of view", s.fieldOfView) + '</div>' +
        '<div class="fundx-actions">' +
          '<button class="fundx-btn ghost" data-fx="retake">' + ric("refresh") + 'Retake</button>' +
          '<button class="fundx-btn" data-fx="toresult">' + (acc ? "Continue" : "Use anyway") + ric("chevron_right") + '</button>' +
        '</div>' +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }

  function screenResult() {
    var f = result && result.findings ? result.findings.findings : {};
    var img = result && result.images ? result.images.original : "";
    function row(l, v) { return '<div class="fundx-frow"><span>' + l + '</span><b>' + v + '</b></div>'; }
    var od = f.optic_disc || {}, mac = f.macula || {};
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="review" aria-label="Back">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Result</b></div><div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<div class="fundx-shot">' + (img ? '<img src="' + esc(img) + '" alt="captured retinal frame">' : '') + '</div>' +
        '<div class="fundx-modelbadge">' + ric("science") + 'Detection preview · ' + esc(result && result.findings ? result.findings.provider : "mock") + ' ' + esc(result && result.findings ? result.findings.modelVersion : "") + '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Structured findings (Vision JSON)</span></div>' +
        '<div class="fundx-findings">' +
          row("Image quality", (f.quality != null ? f.quality : "—")) +
          row("Cup–disc ratio", (od.cup_disc_ratio != null ? od.cup_disc_ratio : "—")) +
          row("Microaneurysms", (f.microaneurysms != null ? f.microaneurysms : "—")) +
          row("Haemorrhages", (f.hemorrhages != null ? f.hemorrhages : "—")) +
          row("Hard exudates", (f.hard_exudates != null ? f.hard_exudates : "—")) +
          row("Macula", (mac.visible ? (mac.edema ? "oedema" : "visible") : "—")) +
          row("Field of view", esc(f.field_of_view || "—")) +
          row("Model confidence", (f.confidence != null ? f.confidence : "—")) +
        '</div>' +
        clinicalCard(result && result.findings) +
        '<div class="fundx-actions">' +
          '<button class="fundx-btn ghost" data-fx="discard">' + ric("delete") + 'Discard</button>' +
          '<button class="fundx-btn" data-fx="save">' + ric("save") + 'Save to patient</button>' +
        '</div>' +
        '<p class="fundx-disc">' + esc(f.disclaimer || disclaimerText()) + '</p>' +
      '</main>';
  }

  function screenDetail() {
    var m = (detail && detail.meta) || {};
    var f = (m.vision && m.vision.findings) || {};
    var q = m.quality || { overall: 0, subscores: {} };
    var img = (detail && detail.imgSrc) || m.thumbnail || "";
    var od = f.optic_disc || {}, mac = f.macula || {};
    var acq = m.acquisition || {};
    function row(l, v) { return '<div class="fundx-frow"><span>' + l + '</span><b>' + v + '</b></div>'; }
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="home" aria-label="Back">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Scan</b><div class="fundx-sub">' + esc((acq.eye || m.eye || "").toUpperCase() + (m.timestamp ? " · " + new Date(m.timestamp).toLocaleString() : "")) + '</div></div>' +
        '<div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<div class="fundx-shot">' + (img ? '<img src="' + esc(img) + '" alt="retinal scan">' : '<span class="fundx-scan-ph">' + ric("visibility") + '</span>') +
          '<div class="fundx-shot-q ' + (q.accepted ? 'ok' : 'bad') + '">' + Math.round(q.overall || 0) + '</div></div>' +
        '<div class="fundx-modelbadge">' + ric("science") + 'Detection preview · ' + esc((m.provider && m.provider.provider) || "mock") + ' ' + esc((m.provider && m.provider.modelVersion) || "") + '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Structured findings (Vision JSON)</span></div>' +
        '<div class="fundx-findings">' +
          row("Image quality", (f.quality != null ? f.quality : "—")) +
          row("Cup–disc ratio", (od.cup_disc_ratio != null ? od.cup_disc_ratio : "—")) +
          row("Microaneurysms", (f.microaneurysms != null ? f.microaneurysms : "—")) +
          row("Haemorrhages", (f.hemorrhages != null ? f.hemorrhages : "—")) +
          row("Hard exudates", (f.hard_exudates != null ? f.hard_exudates : "—")) +
          row("Macula", (mac.visible ? (mac.edema ? "oedema" : "visible") : "—")) +
          row("Model confidence", (f.confidence != null ? f.confidence : "—")) +
        '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Acquisition</span></div>' +
        '<div class="fundx-findings">' +
          row("Eye", esc((acq.eye || m.eye || "—"))) +
          row("Duration", (acq.durationMs != null ? Math.round(acq.durationMs / 1000) + "s" : "—")) +
          row("Attempts / retries", esc((acq.attempts != null ? acq.attempts : "—") + " / " + (acq.retries != null ? acq.retries : "—"))) +
          row("Burst frames", (acq.burstCount != null ? acq.burstCount : "—")) +
          row("Device", esc((m.device && m.device.platform) || "—") + " · " + esc((m.device && m.device.appVersion) || "")) +
          row("Operator", esc((m.audit && m.audit.operator) || "—")) +
        '</div>' +
        clinicalCard(m.vision) +
        '<div class="fundx-actions"><button class="fundx-btn ghost" data-fx="deletescan" data-id="' + esc(m.id) + '">' + ric("delete") + 'Delete</button>' +
          '<button class="fundx-btn" data-fx="export" data-id="' + esc(m.id) + '">' + ric("ios_share") + 'Export JSON</button></div>' +
        '<p class="fundx-disc">' + esc(f.disclaimer || disclaimerText()) + '</p>' +
      '</main>';
  }

  function openDetail(id) {
    var st = STORE(); if (!st) return;
    Promise.all([st.getScan(id), st.imageUri(id, "original")]).then(function (r) {
      if (!r[0]) { toast("Scan not found."); return; }
      detail = { meta: r[0], imgSrc: r[1] || r[0].thumbnail || null };
      show("detail");
    }).catch(function () { toast("Could not open scan."); });
  }
  function deleteScan(id) {
    var st = STORE(); if (!st) return;
    st.deleteScan(id).then(function () { haptic("warning"); toast("Scan deleted."); detail = null; show("home"); }).catch(function () { toast("Could not delete scan."); });
  }

  // ---- Timeline + Compare (pure helpers are unit-tested) ------------------
  // Chronological metric series for a set of scans. key: "quality" | "cdr".
  function trend(scans, key) {
    return (scans || []).slice().sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); })
      .map(function (s) {
        var v = null;
        if (key === "quality") v = s.quality && s.quality.overall != null ? s.quality.overall : null;
        else if (key === "cdr") { var od = s.vision && s.vision.findings && s.vision.findings.optic_disc; v = od && od.cup_disc_ratio != null ? od.cup_disc_ratio : null; }
        return { t: s.timestamp || 0, v: v };
      }).filter(function (p) { return p.v != null; });
  }
  // Delta between an older scan `a` and a newer scan `b`.
  function compareDelta(a, b) {
    function q(s) { return s && s.quality && s.quality.overall != null ? s.quality.overall : null; }
    function cdr(s) { var od = s && s.vision && s.vision.findings && s.vision.findings.optic_disc; return od && od.cup_disc_ratio != null ? od.cup_disc_ratio : null; }
    var qa = q(a), qb = q(b), ca = cdr(a), cb = cdr(b);
    return {
      qualityDelta: (qa != null && qb != null) ? (qb - qa) : null,
      cdrDelta: (ca != null && cb != null) ? +(cb - ca).toFixed(2) : null,
      days: (a && b && a.timestamp != null && b.timestamp != null) ? Math.round((b.timestamp - a.timestamp) / 86400000) : null
    };
  }
  function sparkline(series, w, h) {
    if (!series.length) return "";
    var vs = series.map(function (p) { return p.v; }), mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), rng = (mx - mn) || 1;
    var step = series.length > 1 ? w / (series.length - 1) : w;
    var pts = series.map(function (p, i) { return (i * step).toFixed(1) + "," + (h - ((p.v - mn) / rng) * (h - 4) - 2).toFixed(1); }).join(" ");
    return '<svg class="fundx-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }

  var timelineScans = [], compare = null;
  function openTimeline() {
    var st = STORE(); if (!st) return;
    st.listScans(ctx && ctx.ref).then(function (list) {
      timelineScans = (list || []).slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
      show("timeline");
    }).catch(function () { timelineScans = []; show("timeline"); });
  }
  function screenTimeline() {
    var qTrend = trend(timelineScans, "quality");
    var head = '<header class="fundx-head rds-safe-top"><button class="fundx-close" data-fx="home" aria-label="Back">' + ric("arrow_back_ios_new") + '</button><div class="fundx-head-tt"><b>Timeline</b>' + (ctx && ctx.name ? '<div class="fundx-sub">' + esc(ctx.name) + '</div>' : '') + '</div><div class="fundx-head-sp"></div></header>';
    if (!timelineScans.length) return head + '<main class="fundx-scroll"><div class="fundx-empty">' + ric("timeline") + '<span>No scans yet for this patient.</span></div></main>';
    var trendCard = qTrend.length >= 2 ? '<div class="fundx-trend"><div class="fundx-trend-h"><span>Image quality trend</span><b>' + qTrend[qTrend.length - 1].v + '</b></div>' + sparkline(qTrend, 260, 48) + '</div>' : '';
    var cmp = timelineScans.length >= 2 ? '<button class="fundx-btn" data-fx="comparelatest">' + ric("compare") + 'Compare latest two</button>' : '';
    var rows = timelineScans.map(function (m) {
      var q = m.quality && m.quality.overall != null ? m.quality.overall : "—";
      var eye = (m.acquisition && m.acquisition.eye) || m.eye || "";
      return '<button class="fundx-scan" data-fx="open" data-id="' + esc(m.id) + '">' +
        (m.thumbnail ? '<img src="' + esc(m.thumbnail) + '" alt="">' : '<span class="fundx-scan-ph">' + ric("visibility") + '</span>') +
        '<div class="fundx-scan-m"><b>' + esc(eye ? eye.toUpperCase() + " eye" : "Scan") + '</b><span>' + esc(m.timestamp ? new Date(m.timestamp).toLocaleString() : "") + '</span></div>' +
        '<span class="fundx-q">Q ' + esc(q) + '</span></button>';
    }).join("");
    return head + '<main class="fundx-scroll">' + trendCard + (cmp ? '<div class="fundx-actions">' + cmp + '</div>' : '') +
      '<div class="rds-section-header"><span class="rds-section-title">' + timelineScans.length + ' scan' + (timelineScans.length === 1 ? '' : 's') + '</span></div>' +
      '<div class="fundx-recent">' + rows + '</div><p class="fundx-disc">' + disclaimerText() + '</p></main>';
  }
  function openCompare(idA, idB) {
    var st = STORE(); if (!st) return;
    Promise.all([st.getScan(idA), st.getScan(idB), st.imageUri(idA, "original"), st.imageUri(idB, "original")]).then(function (r) {
      if (!r[0] || !r[1]) { toast("Need two scans to compare."); return; }
      compare = { a: r[0], b: r[1], imgA: r[2] || r[0].thumbnail, imgB: r[3] || r[1].thumbnail, delta: compareDelta(r[0], r[1]) };
      show("compare");
    }).catch(function () { toast("Could not compare scans."); });
  }
  function screenCompare() {
    if (!compare) return '<main class="fundx-scroll"><div class="fundx-empty">' + ric("compare") + '<span>Nothing to compare.</span></div></main>';
    var d = compare.delta;
    function when(m) { return m.timestamp ? new Date(m.timestamp).toLocaleDateString() : ""; }
    function side(label, m, img) { return '<div class="fundx-cmp-side"><div class="fundx-cmp-lbl">' + label + ' · ' + esc(when(m)) + '</div><div class="fundx-shot">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + '<div class="fundx-shot-q ' + (m.quality && m.quality.accepted ? 'ok' : 'bad') + '">' + Math.round((m.quality && m.quality.overall) || 0) + '</div></div></div>'; }
    function deltaRow(l, v, unit) { var cls = v == null ? '' : (v > 0 ? 'up' : v < 0 ? 'down' : ''); var sign = v == null ? '—' : (v > 0 ? '+' : '') + v + (unit || ''); return '<div class="fundx-frow"><span>' + l + '</span><b class="d-' + cls + '">' + sign + '</b></div>'; }
    return '<header class="fundx-head rds-safe-top"><button class="fundx-close" data-fx="totimeline" aria-label="Back">' + ric("arrow_back_ios_new") + '</button><div class="fundx-head-tt"><b>Compare</b>' + (d.days != null ? '<div class="fundx-sub">' + d.days + ' day' + (d.days === 1 ? '' : 's') + ' apart</div>' : '') + '</div><div class="fundx-head-sp"></div></header>' +
      '<main class="fundx-scroll"><div class="fundx-cmp">' + side("Previous", compare.a, compare.imgA) + side("Current", compare.b, compare.imgB) + '</div>' +
      '<div class="rds-section-header"><span class="rds-section-title">Change</span></div>' +
      '<div class="fundx-findings">' + deltaRow("Image quality", d.qualityDelta, "") + deltaRow("Cup–disc ratio", d.cdrDelta, "") + '</div>' +
      '<p class="fundx-disc">Comparison of stored measurements. Not a diagnosis. Longitudinal clinical interpretation is Phase C.</p></main>';
  }

  // ---- Settings + Export --------------------------------------------------
  var SENS = { low: { r: 0.82, f: 4 }, med: { r: 0.9, f: 6 }, high: { r: 0.95, f: 8 } };
  function loadSens() { try { return localStorage.getItem("smd_fundx_sens") || "med"; } catch (e) { return "med"; } }
  function lensConfirmOn() { try { return localStorage.getItem("smd_fundx_lens_confirm") === "1"; } catch (e) { return false; } }
  function telOn() { try { return localStorage.getItem("smd_fundx_telemetry") === "1"; } catch (e) { return false; } }
  // Sensor fusion (Phase 1: IMU). Delegates to the module's flag helper (smd_fundx_sensors /
  // ?fundxsensors=1). Additive; when off or no motion sensor, the engine is unchanged.
  function sensorsOn() { try { return !!(window.SMD_FUNDX_SENSORS && window.SMD_FUNDX_SENSORS.flagOn && window.SMD_FUNDX_SENSORS.flagOn()); } catch (e) { return false; } }
  // Auto-flash (torch): illuminate the fundus with the rear-camera light during capture.
  // Default ON; Android supports it via getUserMedia, iOS WKWebView is a graceful no-op.
  function flashOn() { try { return localStorage.getItem("smd_fundx_flash") !== "0"; } catch (e) { return true; } }
  // Developer mode: live debug overlay + frame-by-frame metric recording. OFF by default
  // (flag smd_fundx_dev or ?fundxdev=1). Additive; never affects acquisition behaviour.
  function devOn() { try { var q = (location.search.match(/[?&]fundxdev=([^&]+)/) || [])[1]; if (q != null) return q === "1"; return localStorage.getItem("smd_fundx_dev") === "1"; } catch (e) { return false; } }
  var devBuffer = [], DEV_MAX = 6000;
  function r2(n) { return (n == null || n !== n) ? "" : Math.round(n * 100) / 100; }
  // Build one debug row {label, value, pass} for a metric vs its live gate.
  function devMetrics(step, fa) {
    var g = step.gates || {}, d = step.diagnostic != null ? step.diagnostic : (step.readiness && step.readiness.diagnostic);
    return [
      ["focus", r2(fa.focus), g.focus], ["glare (refl)", r2(fa.reflection), g.reflection],
      ["motion", r2(fa.motion), g.motion], ["distance", fa.distanceState, g.distance],
      ["roll", (fa.roll == null ? "—" : Math.round(fa.roll) + "° " + fa.rollState), g.level],
      ["red reflex", r2(fa.redReflex), g.redReflex], ["vessel", r2(fa.vesselScore), g.vessels],
      ["fundus", r2(fa.fundusConf) + " ·circ " + r2(fa.fundusCircularity), g.fundus],
      ["DIAGNOSTIC", r2(d), g.quality], ["readiness", r2(step.readiness && step.readiness.overall), step.readiness && step.readiness.ready],
      ["decision", step.state + (step.shouldCapture ? " ● CAPTURE" : ""), step.shouldCapture]
    ];
  }
  function paintDebug(step, fa) {
    var el = document.getElementById("fundxDebug"); if (!el) return;
    el.innerHTML = devMetrics(step, fa).map(function (m) {
      return '<div class="fdbg-row' + (m[2] === true ? ' ok' : m[2] === false ? ' bad' : '') + '"><span>' + m[0] + '</span><b>' + esc(m[1]) + '</b></div>';
    }).join("");
  }
  function recordDevFrame(step, fa) {
    if (devBuffer.length >= DEV_MAX) return;
    var d = step.diagnostic != null ? step.diagnostic : (step.readiness && step.readiness.diagnostic);
    devBuffer.push({ t: fa.ts, state: step.state, focus: r2(fa.focus), glare: r2(fa.reflection), motion: r2(fa.motion), distance: fa.distanceState, roll: (fa.roll == null ? "" : Math.round(fa.roll)), rollState: fa.rollState, redReflex: r2(fa.redReflex), vessel: r2(fa.vesselScore), fundusConf: r2(fa.fundusConf), fundusCirc: r2(fa.fundusCircularity), diagnostic: r2(d), readiness: r2(step.readiness && step.readiness.overall), eyeConf: r2(fa.eyeConf), pupilOffset: r2(fa.pupilOffset), capture: step.shouldCapture ? 1 : 0 });
  }
  function devCsv() {
    if (!devBuffer.length) return "";
    var cols = Object.keys(devBuffer[0]);
    return cols.join(",") + "\n" + devBuffer.map(function (r) { return cols.map(function (c) { return r[c]; }).join(","); }).join("\n");
  }
  function exportDevLog() {
    var csv = devCsv(); if (!csv) { toast("No dev frames recorded yet."); return; }
    try {
      var blob = new Blob([csv], { type: "text/csv" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "fundx-dev-" + nowMs() + ".csv";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast(devBuffer.length + " frames exported.");
    } catch (e) { toast("Export failed."); }
  }
  function applySettings() {
    var Ve = V(); if (!Ve) return;
    var s = SENS[loadSens()] || SENS.med; Ve.CFG.captureReadiness = s.r; Ve.CFG.readySustainFrames = s.f;
    // Optional operator-confirm fallback is OFF unless the config flag is set; even then it
    // only un-sticks the optical-setup phase — capture still needs real diagnostic quality.
    Ve.CFG.lensConfirmFallback = lensConfirmOn();
  }

  function screenSettings() {
    var P = window.SMD_FUNDX_PROVIDERS;
    var providers = P && P.health ? P.health() : [];
    var sens = loadSens();
    function provRow(p) {
      return '<button class="fundx-set-row' + (p.active ? ' on' : '') + (p.available ? '' : ' off') + '"' + (p.available ? ' data-fx="setprovider" data-id="' + esc(p.id) + '"' : '') + '>' +
        '<span class="fundx-set-rl"><b>' + esc(p.id) + '</b><span>' + esc(p.provider) + ' · ' + esc(p.modelVersion) + (p.available ? '' : ' · not configured') + '</span></span>' +
        (p.active ? ric("radio_button_checked") : ric(p.available ? "radio_button_unchecked" : "lock")) + '</button>';
    }
    function sensChip(k, l) { return '<button class="fundx-chip2' + (sens === k ? ' on' : '') + '" data-fx="setsens" data-v="' + k + '">' + l + '</button>'; }
    return '' +
      '<header class="fundx-head rds-safe-top"><button class="fundx-close" data-fx="home" aria-label="Back">' + ric("arrow_back_ios_new") + '</button><div class="fundx-head-tt"><b>Settings</b></div><div class="fundx-head-sp"></div></header>' +
      '<main class="fundx-scroll">' +
        '<div class="rds-section-header"><span class="rds-section-title">AI provider (retinal inference)</span></div>' +
        '<div class="fundx-set-list">' + providers.map(provRow).join("") + '</div>' +
        '<p class="fundx-note">Only providers with configured endpoints/models are selectable. Others connect through the AI Router once credentials are supplied — no app change needed.</p>' +
        '<button class="fundx-set-row' + (cloudEnabled() ? ' on' : '') + '" data-fx="setcloud"><span class="fundx-set-rl"><b>Cloud AI analysis</b><span>' + (_backend && _backend.vision ? 'Backend available — send scans to StewardMD AI (Vertex/Gemini). Off = on-device only.' : 'Backend not reachable — analysis stays on-device.') + '</span></span>' + ric(cloudEnabled() ? "toggle_on" : "toggle_off") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">Auto-capture sensitivity</span></div>' +
        '<div class="fundx-chips2">' + sensChip("low", "Easier") + sensChip("med", "Balanced") + sensChip("high", "Strict") + '</div>' +
        '<button class="fundx-set-row' + (lensConfirmOn() ? ' on' : '') + '" data-fx="setlensconfirm"><span class="fundx-set-rl"><b>Manual lens-confirm fallback</b><span>If auto-guidance stalls, offer a “Confirm lens is positioned” tap. Off by default; capture still needs a clear retinal image.</span></span>' + ric(lensConfirmOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">Coaching</span></div>' +
        '<button class="fundx-set-row' + (VOICE.enabled() ? ' on' : '') + '" data-fx="setvoice"><span class="fundx-set-rl"><b>Voice coaching</b><span>Spoken guidance during capture</span></span>' + ric(VOICE.enabled() ? "toggle_on" : "toggle_off") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">Clinical (Phase C · advisory)</span></div>' +
        '<button class="fundx-set-row' + (clinicalOn() ? ' on' : '') + '" data-fx="setclinical"><span class="fundx-set-rl"><b>Clinical assessment</b><span>Rule-based, advisory severity / referral / follow-up from findings. Never a diagnosis.</span></span>' + ric(clinicalOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">Data</span></div>' +
        '<button class="fundx-set-row" data-fx="clearall"><span class="fundx-set-rl"><b>Delete all scans</b><span>Removes every stored image + record on this device</span></span>' + ric("delete_forever") + '</button>' +
        '<button class="fundx-set-row' + (telOn() ? ' on' : '') + '" data-fx="settel"><span class="fundx-set-rl"><b>Acquisition telemetry (anonymous)</b><span>Local, no PHI — guidance steps, quality progression, capture time + outcome. For validation. Off by default.</span></span>' + ric(telOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (flashOn() ? ' on' : '') + '" data-fx="setflash"><span class="fundx-set-rl"><b>Auto-flash during capture</b><span>Turns on the rear-camera light to illuminate the fundus while capturing. On by default (Android; iOS WebView has no torch control). Turn off if the reflection is too strong.</span></span>' + ric(flashOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (sensorsOn() ? ' on' : '') + '" data-fx="setsensors"><span class="fundx-set-rl"><b>Motion sensor fusion</b><span>Fuses the phone motion sensors (accelerometer + gyroscope) with the camera to steady capture and improve timing. Falls back automatically when unavailable. Off by default.</span></span>' + ric(sensorsOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (devOn() ? ' on' : '') + '" data-fx="setdev"><span class="fundx-set-rl"><b>Developer mode</b><span>Live metric overlay on the camera + frame-by-frame CSV export (focus/glare/motion/distance/roll/reflex/vessel/fundus/diagnostic/decision). Field-testing only.</span></span>' + ric(devOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }

  // Pure: build the export payload for a scan (no image bytes — metadata + findings).
  function exportPayload(meta) {
    meta = meta || {};
    return {
      schema: "fundx.scan.export/1", exportedAt: nowMs(),
      scan: { id: meta.id, eye: meta.eye || (meta.acquisition && meta.acquisition.eye) || null, timestamp: meta.timestamp || null, quality: meta.quality || null, acquisition: meta.acquisition || null, vision: meta.vision || null, provider: meta.provider || null, device: meta.device || null, patientContext: meta.patientContext || null, audit: meta.audit || null }
    };
  }
  function exportScan(meta) {
    var json = JSON.stringify(exportPayload(meta), null, 2);
    var fname = "fundx-" + (meta && meta.id ? meta.id : "scan") + ".json";
    try {
      var C = window.Capacitor, P = C && C.Plugins;
      if (window.SMD_IS_NATIVE && P && P.Filesystem && P.Share) {
        return P.Filesystem.writeFile({ path: fname, data: json, directory: "CACHE", encoding: "utf8" })
          .then(function () { return P.Filesystem.getUri({ path: fname, directory: "CACHE" }); })
          .then(function (u) { return P.Share.share({ title: "FundX scan", files: [u.uri] }); })
          .then(function () { toast("Scan exported."); })
          .catch(function () { toast("Could not export."); });
      }
    } catch (e) {}
    // web fallback: Blob download
    try {
      var blob = new Blob([json], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast("Scan exported.");
    } catch (e) { toast("Could not export."); }
  }
  function clearAllScans() {
    var st = STORE(); if (!st) return;
    st.listScans().then(function (list) {
      return Promise.all((list || []).map(function (m) { return st.deleteScan(m.id); }));
    }).then(function () { haptic("warning"); toast("All scans deleted."); show("home"); }).catch(function () { toast("Could not clear scans."); });
  }

  function paintRecent() {
    var box = document.getElementById("fundxRecent"); var st = STORE(); if (!box || !st) return;
    st.listScans(ctx && ctx.ref).then(function (list) {
      if (!list || !list.length) { box.innerHTML = '<div class="fundx-empty">' + ric("photo_camera") + '<span>No scans yet. Tap “New retinal scan” to begin.</span></div>'; return; }
      box.innerHTML = list.slice(0, 20).map(function (m) {
        var q = m.quality && m.quality.overall != null ? m.quality.overall : "—";
        var eye = (m.acquisition && m.acquisition.eye) || m.eye || "";
        var when = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
        return '<button class="fundx-scan" data-fx="open" data-id="' + esc(m.id) + '">' +
          (m.thumbnail ? '<img src="' + esc(m.thumbnail) + '" alt="">' : '<span class="fundx-scan-ph">' + ric("visibility") + '</span>') +
          '<div class="fundx-scan-m"><b>' + esc(eye ? eye.toUpperCase() + " eye" : "Scan") + '</b><span>' + esc(when) + '</span></div>' +
          '<span class="fundx-q">Q ' + esc(q) + '</span></button>';
      }).join("");
    }).catch(function () { box.innerHTML = '<div class="fundx-empty">' + ric("error") + '<span>Could not load scans.</span></div>'; });
  }

  // ================= CAMERA WIRING =================
  function newSession(eye) {
    return { eye: eye || "right", startTs: nowMs(), attempts: (session ? session.attempts + 1 : 1), captures: 0, retries: 0, readinessTrace: [], burstCount: 0 };
  }
  function humanState(s) {
    var V0 = V().STATE, map = {};
    map[V0.SEARCHING_EYE] = "Finding the eye"; map[V0.CENTERING_PUPIL] = "Centering the pupil";
    map[V0.WORKING_DISTANCE] = "Setting distance"; map[V0.RED_REFLEX] = "Finding red reflex";
    map[V0.LOCATING_FUNDUS] = "Bringing up the retinal view"; map[V0.OPTIMIZING] = "Improving image";
    map[V0.ASSESSING_QUALITY] = "Checking image quality"; map[V0.READY] = "Hold — capturing";
    map[V0.CAPTURING] = "Capturing"; return map[s] || s;
  }
  function tel(fn) { try { var T = window.SMD_FUNDX_TELEMETRY; if (T && T[fn]) T[fn].apply(T, Array.prototype.slice.call(arguments, 1)); } catch (e) {} }
  function startCamera() {
    var Vd = DET(); if (!Vd) { toast("FundX perception layer not loaded."); return; }
    screen = "camera"; capturing = false; lastHapticState = ""; lastCoachArrow = null;
    session = session || newSession("right");
    if (session.mode !== "training") {
      var plat = "web"; try { var C = window.Capacitor; plat = C ? (typeof C.getPlatform === "function" ? C.getPlatform() : (C.platform || "web")) : "web"; } catch (e) {}
      var prov = "mock"; try { prov = (window.SMD_FUNDX_PROVIDERS && SMD_FUNDX_PROVIDERS.getActive && SMD_FUNDX_PROVIDERS.getActive().id) || "mock"; } catch (e) {}
      tel("startSession", { device: plat, appVersion: (window.SMD_APP_VERSION || "fundx-mvp"), provider: prov, sensitivity: loadSens(), eye: session.eye });
    }
    render();
    var video = document.getElementById("fundxVideo");
    sm = V().createStateMachine();
    cam = Vd.makeCamera();
    cam.start(video, onFrame, { hub: (hub = Vd.makeHub()), analyzeEveryMs: 110, analyzeScale: 0.25, flash: flashOn() })
      .then(function () { setState("Point the camera at the eye"); })
      .catch(function (err) { showCamError(err); });
  }
  function setState(txt) { var el = document.getElementById("fundxState"); if (el) el.textContent = txt; }
  function showCamError(err) {
    var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
    var box = document.getElementById("fundxCoach");
    setState(denied ? "Camera permission needed" : "Camera unavailable");
    if (box) box.innerHTML = denied
      ? 'Allow camera access to use guided capture, then reopen.'
      : 'Could not start the camera on this device.';
    haptic("error");
  }
  function onFrame(fa) {
    if (!sm || capturing) return;
    lastFa = fa;
    var step = sm.step(fa, fa.ts);
    session.readinessTrace.push(Math.round((step.readiness.overall || 0) * 100));
    if (session.readinessTrace.length > 400) session.readinessTrace.shift();
    updateCameraUI(step, fa);
    if (devOn()) { paintDebug(step, fa); recordDevFrame(step, fa); }
    if (session.mode !== "training") tel("frame", step, fa.ts);
    if (session.mode === "training") { handleTraining(step); return; }
    if (step.shouldCapture) triggerCapture();
  }
  function handleTraining(step) {
    var lvl = session.trainLevel;
    if (levelAchieved(lvl, step.gates, step.readiness)) {
      session.trainHold = (session.trainHold || 0) + 1;
      if (session.trainHold >= 5) completeTrainingLevel(lvl);
    } else { session.trainHold = 0; }
  }
  function completeTrainingLevel(lvl) {
    if (capturing) return; capturing = true;     // guard re-entry
    var st = STORE(); if (st) { try { st.learning.completeLevel(lvl); } catch (e) {} }
    haptic("success"); VOICE.speak("Level complete");
    var flash = document.getElementById("fundxFlash"); if (flash) { flash.classList.add("on"); setTimeout(function () { flash.classList.remove("on"); }, 220); }
    stopCamera();
    toast("Level " + lvl + " complete!");
    session = null;
    setTimeout(function () { show("training"); }, 300);
  }
  function startTraining(level) {
    session = newSession("right"); session.mode = "training"; session.trainLevel = level; session.trainHold = 0;
    startCamera();
  }
  function updateCameraUI(step, fa) {
    var cue = V().Coach.cueFor(step.state, fa, step.readiness);
    if (session.mode !== "training" && cue.arrow && cue.arrow !== lastCoachArrow) { lastCoachArrow = cue.arrow; tel("correction"); }
    var stEl = document.getElementById("fundxState"); if (stEl) stEl.textContent = humanState(step.state);
    var coach = document.getElementById("fundxCoach"); if (coach) { coach.textContent = cue.text; coach.className = "fundx-coach t-" + cue.tone; }
    // readiness ring (circumference 2πr, r=54 → ~339.29)
    var pct = step.readiness.overall || 0; var C = 339.29;
    var ring = document.getElementById("fundxRingFg"); if (ring) { ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - pct); ring.setAttribute("class", "fundx-ring-fg " + (pct >= 0.9 ? "hi" : pct >= 0.5 ? "mid" : "lo")); }
    var score = document.getElementById("fundxScore"); if (score) score.textContent = Math.round(pct * 100);
    var arrow = document.getElementById("fundxArrow");
    if (arrow) { if (cue.arrow) { arrow.style.opacity = "1"; arrow.firstChild ? (arrow.innerHTML = ric(arrowGlyph(cue.arrow))) : null; arrow.className = "fundx-arrow show a-" + cue.arrow; arrow.innerHTML = ric(arrowGlyph(cue.arrow)); } else { arrow.className = "fundx-arrow"; } }
    var g = step.gates || {};
    CHIPS.forEach(function (c) { var el = document.querySelector('.fundx-chip[data-chip="' + c.k + '"]'); if (el) el.classList.toggle("on", !!g[c.k]); });
    // optional operator-confirm fallback: only surfaces on a stall AND only when configured
    var fb = document.getElementById("fundxFallback");
    if (fb) fb.style.display = (step.stalled && lensConfirmOn() && session.mode !== "training") ? "" : "none";
    // haptic + voice on state change
    if (step.state !== lastHapticState) { lastHapticState = step.state; if (cue.haptic) haptic(cue.haptic); else haptic("selection"); VOICE.speak(cue.voice); }
    else if (cue.tone === "warn") { VOICE.speak(cue.voice); }
  }
  function triggerCapture() {
    if (capturing) return; capturing = true;
    sm.set(V().STATE.CAPTURING); haptic("success"); VOICE.speak("Hold still, capturing");
    var flash = document.getElementById("fundxFlash"); if (flash) { flash.classList.add("on"); setTimeout(function () { flash.classList.remove("on"); }, 220); }
    session.captures++;
    setTimeout(function () {
      var burst = [];
      try { burst = cam.captureBurst(20) || []; } catch (e) {}
      session.burstCount = burst.length;
      stopCamera();
      runProcessing(burst);
    }, 180);
  }
  function stopCamera() { try { if (cam) cam.stop(); } catch (e) {} VOICE.stop(); }
  // Lifecycle: releasing the camera when the app is backgrounded (tab hidden / app to
  // background) prevents the stream + rAF loop running invisibly (battery/thermal). Wired
  // once; on return the user is on the pre-capture screen and can restart.
  var _visWired = false;
  function wireVisibility() {
    if (_visWired || typeof document === "undefined" || !document.addEventListener) return;
    _visWired = true;
    document.addEventListener("visibilitychange", function () {
      try { if (document.hidden && screen === "camera" && cam && cam.isRunning && cam.isRunning()) { stopCamera(); tel("endSession", "backgrounded"); if (FUNDX.isOpen()) { screen = "precapture"; render(); } } } catch (e) {}
    });
  }

  // Decode a captured dataURL → ImageData → run the enhancement pipeline → re-encode.
  // The enhancement ALGORITHM is pure (fundx-enhance.js, unit-tested); this is the
  // browser wrapper. Resolves null on any failure (caller keeps the original).
  function enhanceDataUrl(dataUrl) {
    return new Promise(function (resolve) {
      var E = window.SMD_FUNDX_ENHANCE;
      if (!E || !dataUrl || typeof Image === "undefined") return resolve(null);
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, maxW = 1024;
            var sc = Math.min(1, maxW / (iw || maxW));
            var w = Math.max(2, Math.round(iw * sc)), h = Math.max(2, Math.round(ih * sc));
            var c = document.createElement("canvas"); c.width = w; c.height = h;
            var cx = c.getContext("2d"); cx.drawImage(img, 0, 0, w, h);
            var out = E.enhance(cx.getImageData(0, 0, w, h));
            cx.putImageData(out, 0, 0);
            resolve(c.toDataURL("image/jpeg", 0.9));
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = dataUrl;
      } catch (e) { resolve(null); }
    });
  }

  function runProcessing(burst) {
    screen = "processing"; render();
    var tx = document.getElementById("fundxProcTx");
    result = FUNDX._buildResult(burst, ctx, session.eye, session);
    if (!result) { tel("capture", { success: false, durationMs: nowMs() - session.startTs, bursts: session.burstCount }); toast("No usable frames — try again."); screen = "camera"; return startCamera(); }
    tel("capture", { success: true, quality: result.quality.overall, durationMs: nowMs() - session.startTs, bursts: session.burstCount });
    // 1) real image enhancement → the persisted "enhanced image" (distinct from original)
    if (tx) tx.textContent = "Enhancing image…";
    enhanceDataUrl(result.images.original).then(function (enh) { if (enh) result.images.processed = enh; })
      .catch(function () {})
      .then(function () {
        // 2) retinal inference via the provider abstraction (mock by default; a configured
        //    real provider — Vertex/Gemini, Cerebras, ONNX, TFLite — transparently overrides)
        if (tx) tx.textContent = "Generating structured findings…";
        var P = window.SMD_FUNDX_PROVIDERS;
        if (P && P.analyzeFindings) {
          return P.analyzeFindings(
            { imageDataUrl: result.images.processed || result.images.original, quality: result.quality.overall, metrics: (burst[result.best] || {}).metrics },
            { patientRef: (ctx && ctx.ref) || null, eye: session.eye, ts: nowMs() }
          ).then(function (f) { if (f) result.findings = f; }).catch(function () {});
        }
      })
      .then(function () { screen = "review"; render(); });
  }

  // ================= PURE HELPERS (unit-tested, DOM-free) =================
  // Build the capture result from a burst: best frame, quality, mock findings, images.
  function _buildResult(burst, context, eye, stats) {
    var Ve = V(); if (!Ve || !burst || !burst.length) return null;
    var sel = Ve.BestFrameSelector.select(burst);
    if (sel.best < 0) return null;
    var best = burst[sel.best];
    var quality = sel.scores[sel.best];
    var findings = Ve.Findings.build({
      input: { quality: quality.overall, metrics: best.metrics },
      ctx: { patientRef: (context && context.ref) || null, eye: eye, ts: nowMs() },
      quality: quality
    });
    var original = best.dataUrl || null;
    return {
      best: sel.best, quality: quality, findings: findings, selection: sel,
      images: { original: original, processed: original, thumbnail: best.thumb || original }
    };
  }
  // Build the full, versioned ScanRecord with all nine mandated fields + audit.
  function _buildScanRecord(res, context, eye, stats, opts) {
    opts = opts || {};
    var id = opts.id || ("fx_" + nowMs() + "_" + (++scanSeq));
    var t = opts.now != null ? opts.now : nowMs();
    var plat = "web"; try { var C = window.Capacitor; plat = C ? (typeof C.getPlatform === "function" ? C.getPlatform() : (C.platform || "web")) : "web"; } catch (e) {}
    var dur = stats && stats.startTs ? (t - stats.startTs) : null;
    return {
      id: id,
      originalImage: res.images.original,
      processedImage: res.images.processed,
      thumbnail: res.images.thumbnail,
      eye: eye,
      quality: res.quality,
      acquisition: {
        eye: eye, durationMs: dur, attempts: (stats && stats.attempts) || 1,
        captures: (stats && stats.captures) || 1, retries: (stats && stats.retries) || 0,
        burstCount: (stats && stats.burstCount) || 0,
        readinessTrace: (stats && stats.readinessTrace) ? stats.readinessTrace.slice(-60) : [],
        stateHistory: (sm && sm.history) ? sm.history.slice(-40) : []
      },
      vision: res.findings,
      patientContext: context || { ref: null, name: null },
      timestamp: t,
      device: { platform: plat, appVersion: (window.SMD_APP_VERSION || "fundx-mvp"), userAgent: (typeof navigator !== "undefined" ? navigator.userAgent : "") },
      provider: { provider: res.findings.provider, modelVersion: res.findings.modelVersion },
      audit: { operator: (window.SMD_OPERATOR_ID || "local"), createdAt: t, recordVersion: 1, actions: [{ type: "created", at: t }] }
    };
  }

  function saveScan() {
    if (!result) return;
    var st = STORE(); if (!st) { toast("Storage unavailable."); return; }
    var rec = _buildScanRecord(result, ctx, session.eye, session);
    var chk = V().validate.scanRecord(rec);
    if (!chk.ok) { toast("Could not save scan (" + chk.errors[0] + ")."); return; }
    st.saveScan(rec).then(function () {
      try { st.operator.record({ quality: result.quality.overall, captures: session.captures, retries: session.retries }); } catch (e) {}
      tel("endSession", "saved");
      haptic("success"); toast("Scan saved to patient."); result = null; screen = "home"; render();
    }).catch(function () { toast("Could not save scan."); });
  }

  // ================= CONTROLLER =================
  function render() {
    if (!rootEl) return;
    rootEl.classList.toggle("cam", screen === "camera");
    if (screen === "home") { rootEl.innerHTML = screenHome(); paintRecent(); }
    else if (screen === "precapture") rootEl.innerHTML = screenPrecapture();
    else if (screen === "camera") rootEl.innerHTML = screenCamera();
    else if (screen === "processing") rootEl.innerHTML = screenProcessing();
    else if (screen === "review") rootEl.innerHTML = screenReview();
    else if (screen === "result") rootEl.innerHTML = screenResult();
    else if (screen === "detail") rootEl.innerHTML = screenDetail();
    else if (screen === "training") rootEl.innerHTML = screenTraining();
    else if (screen === "timeline") rootEl.innerHTML = screenTimeline();
    else if (screen === "compare") rootEl.innerHTML = screenCompare();
    else if (screen === "settings") rootEl.innerHTML = screenSettings();
  }
  function show(s) { screen = s; render(); }

  function onClick(e) {
    var b = e.target.closest("[data-fx]"); if (!b) return;
    var a = b.getAttribute("data-fx");
    switch (a) {
      case "close": return FUNDX.close();
      case "home": stopCamera(); return show("home");
      case "newscan": haptic("medium"); session = newSession("right"); return show("precapture");
      case "eye": if (session) session.eye = b.getAttribute("data-eye"); haptic("selection"); return render();
      case "startcam": haptic("medium");
        // iOS 13+ requires DeviceMotion permission be requested from THIS user gesture, or the
        // IMU never emits. Fire-and-forget: once granted, events flow to the already-attached
        // listener; denial simply falls back to the monocular engine.
        if (sensorsOn() && window.SMD_FUNDX_SENSORS && window.SMD_FUNDX_SENSORS.requestMotionPermission) { try { window.SMD_FUNDX_SENSORS.requestMotionPermission(); } catch (e) {} }
        return startCamera();
      case "camclose": stopCamera(); haptic("light"); return show("home");
      case "confirmlens": if (sm && sm.confirmLensPositioned) sm.confirmLensPositioned(); haptic("selection"); { var fbb = document.getElementById("fundxFallback"); if (fbb) fbb.style.display = "none"; } toast("Proceeding — capture still needs a clear retinal image."); return;
      case "setlensconfirm": { try { localStorage.setItem("smd_fundx_lens_confirm", lensConfirmOn() ? "0" : "1"); } catch (e) {} applySettings(); haptic("selection"); return render(); }
      case "settel": { try { localStorage.setItem("smd_fundx_telemetry", telOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setdev": { try { localStorage.setItem("smd_fundx_dev", devOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setsensors": { try { localStorage.setItem("smd_fundx_sensors", sensorsOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setflash": { try { localStorage.setItem("smd_fundx_flash", flashOn() ? "0" : "1"); } catch (e) {} if (cam && cam.setTorch) { try { cam.setTorch(flashOn()); } catch (e) {} } haptic("selection"); return render(); }
      case "devexport": haptic("light"); return exportDevLog();
      case "voice": VOICE.setEnabled(!VOICE.enabled()); haptic("selection"); { var vb = document.getElementById("fundxVoiceBtn"); if (vb) { vb.classList.toggle("on", VOICE.enabled()); vb.innerHTML = ric(VOICE.enabled() ? "volume_up" : "volume_off"); } if (VOICE.enabled()) VOICE.speak("Voice coaching on"); } return;
      case "retake": haptic("light"); if (result && result.quality) tel("reject", result.quality.reasons); tel("endSession", "retake"); result = null; session.retries++; return startCamera();
      case "toresult": haptic("medium"); return show("result");
      case "review": return show("review");
      case "discard": haptic("light"); if (result && result.quality) tel("reject", result.quality.reasons); tel("endSession", "discarded"); result = null; return show("home");
      case "save": return saveScan();
      case "training": haptic("light"); session = null; return show("training");
      case "level": haptic("medium"); return startTraining(parseInt(b.getAttribute("data-level"), 10) || 1);
      case "gallery": haptic("light"); return openTimeline();
      case "comparelatest": haptic("medium"); return (timelineScans.length >= 2 ? openCompare(timelineScans[1].id, timelineScans[0].id) : toast("Need two scans to compare."));
      case "totimeline": haptic("light"); return show("timeline");
      case "open": haptic("light"); return openDetail(b.getAttribute("data-id"));
      case "deletescan": haptic("light"); return deleteScan(b.getAttribute("data-id"));
      case "settings": haptic("light"); return show("settings");
      case "setprovider": { var P = window.SMD_FUNDX_PROVIDERS; if (P && P.setActive(b.getAttribute("data-id"))) { haptic("selection"); toast("Provider: " + b.getAttribute("data-id")); render(); } return; }
      case "setsens": { try { localStorage.setItem("smd_fundx_sens", b.getAttribute("data-v")); } catch (e) {} applySettings(); haptic("selection"); return render(); }
      case "setvoice": VOICE.setEnabled(!VOICE.enabled()); haptic("selection"); return render();
      case "setclinical": { try { localStorage.setItem("smd_fundx_clinical", clinicalOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "cloudyes": setCloudPref("1"); haptic("success"); return applyProviderSelection().then(render);
      case "cloudno": setCloudPref("0"); haptic("selection"); return applyProviderSelection().then(render);
      case "setcloud": { setCloudPref(cloudEnabled() ? "0" : "1"); haptic("selection"); return applyProviderSelection().then(render); }
      case "clearall": haptic("warning"); return clearAllScans();
      case "export": haptic("light"); { var st = STORE(); if (st) st.getScan(b.getAttribute("data-id")).then(function (m) { if (m) exportScan(m); }); } return;
    }
  }

  var FUNDX = {
    open: function (context) {
      ctx = context || null; screen = "home"; session = null; result = null; capturing = false; devBuffer = [];
      applySettings();
      applyProviderSelection();   // health-gated: auto-activates the backend provider when available
      if (!rootEl) {
        rootEl = document.createElement("div"); rootEl.id = "fundxRoot";
        rootEl.setAttribute("role", "dialog"); rootEl.setAttribute("aria-modal", "true"); rootEl.setAttribute("aria-label", "FundX AI retinal imaging");
        document.body.appendChild(rootEl); rootEl.addEventListener("click", onClick);
      }
      wireVisibility();
      render(); rootEl.classList.add("on"); document.body.style.overflow = "hidden"; haptic("tap");
    },
    close: function () { stopCamera(); tel("endSession", "abandoned"); if (rootEl) rootEl.classList.remove("on"); document.body.style.overflow = ""; haptic("tap"); },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
    enabled: function () { return true; },
    _screen: function () { return screen; },
    _buildResult: _buildResult,
    _buildScanRecord: _buildScanRecord,
    _levelAchieved: levelAchieved,
    _levels: function () { return LEVELS; },
    _trend: trend,
    _compareDelta: compareDelta,
    _exportPayload: exportPayload,
    _parseHealth: parseHealth,
    _providerTarget: providerTarget,
    _devMetrics: devMetrics,
    _recordDevFrame: function (step, fa) { recordDevFrame(step, fa); },
    _devBuffer: function () { return devBuffer; },
    _devCsv: devCsv
  };
  window.FUNDX = FUNDX;
})();
