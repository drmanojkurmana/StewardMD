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
  var session = null, cam = null, sm = null, eng = null, perfMeter = null, hud = null, hub = null, lastFa = null, result = null, detail = null;
  function perfNow() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : (typeof Date !== "undefined" ? Date.now() : 0); }
  var usingNative = false;   // depth mode: native (ARCore/ARKit) camera owns the pipeline
  var usingGpu = false;      // GPU preview: native camera surface behind a transparent WebView
  var devLive = { pipeline: null, confidence: null, fps: 0, frames: 0, lastT: 0, depthMm: null, contributions: null, perf: null };  // live dev telemetry
  var capturing = false, lastHapticState = "", scanSeq = 0, lastCoachArrow = null, lastCritical = false, lastCoachText = "", lastCoachTier = "", lastCoachDetail = "", lastStepKey = null;

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
  // ONE patient-context mapping for BOTH the live report and the frozen (saved) assessment, so the
  // clinician reviews exactly what is persisted. assessRules regexes .dx for diabetes/HTN and reads
  // .hba1c/.sbp/.age; ctx.meta carries the joined history string, so it maps to .dx.
  function patientCtx() {
    var c = ctx || {};
    return { ref: c.ref || null, name: c.name || null, age: c.age, sex: c.sex, meta: c.meta, dx: c.meta || c.dx || c.diagnosis || "", hba1c: c.hba1c, sbp: c.sbp };
  }
  var SEVCLS = { none: "stable", mild: "stable", moderate: "warning", severe: "critical" };
  function reviewBadge(status) {
    var m = { accepted: ["check_circle", "Accepted", "stable"], rejected: ["cancel", "Rejected", "critical"], edited: ["edit", "Edited", "warning"], pending: ["hourglass_empty", "Pending review", "info"] };
    var x = m[status] || m.pending;
    return '<span class="fundx-rev-badge b-' + x[2] + '">' + ric(x[0]) + esc(x[1]) + '</span>';
  }
  // Full structured clinical REPORT (README 09) + clinician oversight. `record` is a ScanRecord-like
  // object (needs .vision + .quality + .patientContext + .clinicianReview); `scope` is "result" or
  // "detail" so oversight actions know where to persist. Advisory only — never a diagnosis.
  function clinicalCard(record, scope) {
    if (!clinicalOn() || !window.SMD_FUNDX_CLINICAL || !record) return "";
    var C = window.SMD_FUNDX_CLINICAL, rep;
    try { rep = C.buildReport(record); } catch (e) { return ""; }
    function badge(cls, txt) { return '<span class="fundx-badge b-' + cls + '">' + esc(txt) + '</span>'; }
    var sevCls = SEVCLS[rep.severity] || "info";
    var urgCls = { routine: "stable", soon: "warning", urgent: "urgent", emergency: "critical" }[rep.urgency] || "info";
    var urgent = rep.urgentFindings.length ? '<div class="fundx-verdict bad">' + ric("emergency") + '<span>Urgent — ' + esc(rep.urgentFindings.map(function (s) { return s.replace(/_/g, " "); }).join(", ")) + '</span></div>' : '';
    var diff = rep.differential.length
      ? '<div class="fundx-diff-list">' + rep.differential.slice(0, 4).map(function (d) {
          return '<div class="fundx-diff"><div class="fundx-diff-h"><b>' + d.rank + '. ' + esc(d.label) + '</b><span class="fundx-badge b-' + (SEVCLS[d.severity] || "info") + '">' + esc(d.severity) + ' · ' + esc(d.likelihood) + '</span></div>' + (d.reasoning ? '<span class="fundx-diff-r">' + esc(d.reasoning) + '</span>' : '') + '</div>';
        }).join("") + '</div>'
      : '<p class="fundx-note">No significant retinal features detected this scan.</p>';
    var rc = rep.recommendations || {};
    var ref = rc.referral ? '<div class="fundx-frow"><span>Referral</span><b>' + esc(rc.referral.to) + ' · ' + esc(rc.referral.priority) + '</b></div>' : '';
    var inv = (rc.investigations && rc.investigations.length) ? '<div class="fundx-frow"><span>Suggested</span><b>' + esc(rc.investigations.join(", ")) + '</b></div>' : '';
    var fu = rc.followUp ? '<div class="fundx-frow"><span>Follow-up</span><b>' + esc(rc.followUp.interval) + '</b></div>' : '';
    // Non-urgent safety flags (poor image quality, clinician-review-required, simulated findings)
    // must stay visible — they caution the clinician about confidence/validity (README 09 safety).
    var cautions = (rep.safetyFlags || []).filter(function (s) { return rep.urgentFindings.indexOf(s) < 0; });
    var cautionRow = cautions.length ? '<div class="fundx-whys">' + cautions.map(function (s) { return '<span class="fundx-why">' + ric("shield") + esc(s.replace(/_/g, " ")) + '</span>'; }).join("") + '</div>' : '';
    var rv = record.clinicianReview || null;
    var oversight = '<div class="rds-section-header"><span class="rds-section-title">Clinician oversight</span></div>' +
      '<div class="fundx-oversight">' + reviewBadge(rv ? rv.status : "pending") +
        (rv && rv.note ? '<div class="fundx-rev-note">' + ric("sticky_note_2") + esc(rv.note) + '</div>' : '') +
        (rv && rv.editedConclusion ? '<div class="fundx-rev-note">' + ric("edit_note") + esc(rv.editedConclusion) + '</div>' : '') +
        '<div class="fundx-rev-actions">' +
          '<button class="fundx-btn ghost sm" data-fx="reviewact" data-act="accept" data-scope="' + scope + '">' + ric("check") + 'Accept</button>' +
          '<button class="fundx-btn ghost sm" data-fx="reviewact" data-act="reject" data-scope="' + scope + '">' + ric("close") + 'Reject</button>' +
          '<button class="fundx-btn ghost sm" data-fx="reviewact" data-act="comment" data-scope="' + scope + '">' + ric("add_comment") + 'Note</button>' +
          '<button class="fundx-btn ghost sm" data-fx="reviewact" data-act="edit" data-scope="' + scope + '">' + ric("edit") + 'Edit</button>' +
        '</div></div>';
    return '<div class="rds-section-header"><span class="rds-section-title">Clinical assessment · advisory</span></div>' +
      '<div class="fundx-clin">' + urgent +
        '<div class="fundx-clin-top"><b>' + esc(rep.differential.length ? rep.differential[0].label : "No significant features detected") + '</b><span>' + badge(sevCls, rep.severity) + badge(urgCls, rep.urgency) + '</span></div>' +
        diff +
        '<div class="fundx-findings" style="margin-top:10px">' + ref + inv + fu +
          '<div class="fundx-frow"><span>Confidence</span><b>' + (rep.confidence != null ? rep.confidence : "—") + '</b></div>' +
        '</div>' +
        cautionRow +
        oversight +
        '<p class="fundx-note">' + esc(rep.disclaimer) + '</p>' +
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
        (uploadOn() ? '<button class="fundx-cta fundx-cta-2" data-fx="analyzeimg">' + ric("add_photo_alternate") +
          '<div class="fundx-cta-tx"><b>Analyze fundus image</b><span>Upload an existing retinal photo</span></div>' + ric("chevron_right") + '</button>' : '') +
        '<div class="fundx-row2">' +
          '<button class="fundx-tile" data-fx="training">' + ric("school") + '<b>Training</b><span>Learn to align the lens</span></button>' +
          '<button class="fundx-tile" data-fx="gallery">' + ric("collections") + '<b>Scans</b><span>Review captures</span></button>' +
        '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Recent scans</span></div>' +
        '<div id="fundxRecent" class="fundx-recent"><div class="fundx-empty">' + ric("hourglass_empty") + '<span>Loading…</span></div></div>' +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }

  // Workflow 2 · upload picker (drag-drop / camera roll / files / recent). Feeds the unified pipeline.
  function screenUpload() {
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="home" aria-label="Back">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Analyze fundus image</b></div><div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<div id="fundxDrop" class="fundx-drop" data-fx="pickimg" role="button" tabindex="0" aria-label="Add retinal image">' + ric("add_photo_alternate") +
          '<b>Add retinal image</b><span>Tap to choose from Camera roll / Files — or drag &amp; drop</span></div>' +
        '<input id="fundxFileInput" type="file" accept="image/*" multiple style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" aria-hidden="true">' +
        '<p class="fundx-note">Hospital fundus camera, smartphone adapter, referral, research or teaching image. Each is quality-checked, enhanced (non-destructively), and analyzed through the same pipeline as a live scan — then flows into the same report and history.</p>' +
        '<div class="rds-section-header"><span class="rds-section-title">Recent</span></div>' +
        '<div id="fundxRecent" class="fundx-recent"><div class="fundx-empty">' + ric("hourglass_empty") + '<span>Loading…</span></div></div>' +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }
  function readFileDataUrl(file) {
    return new Promise(function (resolve) {
      try { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = function () { resolve(null); }; r.readAsDataURL(file); } catch (e) { resolve(null); }
    });
  }
  function handleUploadFiles(files) {
    var imgs = Array.prototype.slice.call(files || []).filter(function (f) { return f && /^image\//.test(f.type); });
    if (!imgs.length) { toast("Choose an image file."); return; }
    if (imgs.length > 1) toast("Analyzing the first of " + imgs.length + " — batch analysis is coming.");
    readFileDataUrl(imgs[0]).then(function (url) {
      if (!url) { toast("Could not read that image."); return; }
      processImageUpload(url);
    });
  }
  function wireUpload() {
    var input = document.getElementById("fundxFileInput");
    var drop = document.getElementById("fundxDrop");
    if (input && !input._wired) {
      input._wired = true;
      input.addEventListener("change", function () { if (input.files && input.files.length) handleUploadFiles(input.files); input.value = ""; });
    }
    if (drop && !drop._wired) {
      drop._wired = true;
      ["dragover", "dragenter"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
      ["dragleave", "dragend"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("over"); }); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files); });
    }
    try { paintRecent(); } catch (e) {}
  }

  // ---- Lensless Corridor Preview (design demo — no camera, no capture, no findings) --------
  var previewHud = null, previewRaf = 0, previewT0 = 0;
  function screenCorridorPreview() {
    return '' +
      '<div class="fundx-cam fundx-preview">' +
        '<div class="fundx-preview-bg"></div>' +
        '<header class="fundx-cam-top rds-safe-top">' +
          '<button class="fundx-cam-x" data-fx="closepreview" aria-label="Close">' + ric("close") + '</button>' +
          '<div id="fundxState" class="fundx-state" role="status" aria-live="polite">Optical Corridor</div>' +
          '<span class="fundx-preview-badge">PREVIEW</span>' +
        '</header>' +
        '<div id="fundxCorridor" class="fundx-corridor-host" aria-hidden="true"></div>' +
        '<div class="fundx-cam-bottom rds-safe-bottom">' +
          '<div id="fundxCoach" class="fundx-coach" role="status" aria-live="polite">Scripted demo — no camera, no capture</div>' +
          '<button class="fundx-btn ghost" data-fx="closepreview">' + ric("check") + 'Done</button>' +
        '</div>' +
      '</div>';
  }
  function startCorridorPreview() {
    stopCorridorPreview();
    screen = "corridorpreview"; render();
    if (!window.SMD_FUNDX_HUD) { toast("Corridor module unavailable."); return; }
    try { previewHud = window.SMD_FUNDX_HUD.create(); var host = document.getElementById("fundxCorridor"); if (host) previewHud.mount(host); else { previewHud = null; return; } } catch (e) { previewHud = null; return; }
    previewT0 = perfNow();
    var DEMO = window.SMD_FUNDX_HUD.DEMO_MS || 14000;
    var lastHap = "";
    function loop() {
      if (screen !== "corridorpreview" || !previewHud) return;
      var t = (perfNow() - previewT0) % (DEMO + 1600);            // loop, with a short breath at the end
      var f = window.SMD_FUNDX_HUD.demoStep(Math.min(t, DEMO));
      previewHud.push(f.step, f.fa);
      var cue = V() ? V().Coach.cueFor(f.step.state, f.fa, f.step.readiness) : { text: "", haptic: null };
      var coach = document.getElementById("fundxCoach"); if (coach) coach.textContent = cue.text || "";
      var stEl = document.getElementById("fundxState"); if (stEl) stEl.textContent = humanState(f.step.state);
      if (f.step.state !== lastHap) { lastHap = f.step.state; haptic(cue.haptic || "selection"); }  // stage-transition ticks
      previewRaf = requestAnimationFrame(loop);
    }
    previewRaf = requestAnimationFrame(loop);
  }
  function stopCorridorPreview() {
    if (previewRaf) { try { cancelAnimationFrame(previewRaf); } catch (e) {} previewRaf = 0; }
    try { if (previewHud) previewHud.unmount(); } catch (e) {} previewHud = null;
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
        (corridorOn() ? '<div id="fundxCorridor" class="fundx-corridor-host" aria-hidden="true"></div>' : '') +
        '<header class="fundx-cam-top rds-safe-top">' +
          '<button class="fundx-cam-x" data-fx="camclose" aria-label="Close">' + ric("close") + '</button>' +
          '<div id="fundxState" class="fundx-state" role="status" aria-live="polite">Starting camera…</div>' +
          '<button id="fundxFlashBtn" class="fundx-cam-x' + (flashOn() ? ' on' : '') + '" data-fx="torch" aria-label="Flash">' + ric(flashOn() ? "flash_on" : "flash_off") + '</button>' +
          '<button id="fundxVoiceBtn" class="fundx-cam-x' + (VOICE.enabled() ? ' on' : '') + '" data-fx="voice" aria-label="Voice coaching">' + ric(VOICE.enabled() ? "volume_up" : "volume_off") + '</button>' +
        '</header>' +
        ((session && session.mode === "training") ? '<div class="fundx-goal">' + ric("school") + 'Level ' + session.trainLevel + ' · ' + esc((LEVELS[session.trainLevel - 1] || {}).title || "") + '</div>' : '<div id="fundxStep" class="fundx-step"></div>') +
        '<div class="fundx-reticle">' +
          '<svg class="fundx-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="fundx-ring-bg" cx="60" cy="60" r="54"/><circle id="fundxRingFg" class="fundx-ring-fg" cx="60" cy="60" r="54"/></svg>' +
          '<div id="fundxArrow" class="fundx-arrow">' + ric("north") + '</div>' +
          '<div id="fundxScore" class="fundx-score">0</div>' +
        '</div>' +
        '<div class="fundx-cam-bottom rds-safe-bottom">' +
          '<div id="fundxCoach" class="fundx-coach" role="status" aria-live="assertive">Point the camera at the eye</div>' +
          '<div id="fundxCoachDetail" class="fundx-coach-detail" aria-live="polite"></div>' +
          '<div id="fundxChips" class="fundx-chips">' + CHIPS.map(function (c) { return '<span class="fundx-chip" data-chip="' + c.k + '">' + c.l + '</span>'; }).join("") + '</div>' +
          '<button id="fundxFallback" class="fundx-fallback" data-fx="confirmlens" style="display:none">' + ric("check_circle") + 'Confirm lens is positioned</button>' +
          ((session && session.mode === "training") ? '' :
            '<button id="fundxCaptureBtn" class="fundx-capture" data-fx="capturebest" disabled aria-label="Capture best frame">' + ric("photo_camera") + '<span>Capture best frame</span></button>') +
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
    // Clinician-facing quality as a WORD, never a score (README 03).
    var qw = (V() && V().qualityWord) ? V().qualityWord(q) : { label: acc ? "Good" : "Retake recommended", tone: acc ? "good" : "warn" };
    var img = result && result.images ? result.images.original : "";
    function bar(label, val) {
      var pct = Math.round((val || 0) * 100);
      return '<div class="fundx-qbar"><span>' + label + '</span><i><b style="width:' + pct + '%"></b></i></div>';
    }
    var reasonNames = { poor_focus: "Focus", poor_exposure: "Exposure", excessive_reflection: "Reflection/glare", fundus_not_visible: "Retinal view not clear", no_vessels_detected: "Vessels not visible", field_of_view_inadequate: "Field of view" };
    var why = (q.reasons || []).map(function (r) { return '<span class="fundx-why">' + ric("error") + (reasonNames[r] || r) + '</span>'; }).join("");
    var s = q.subscores || {};
    // Stage-1 retinal gate failed → this is not a retinal image. No score, no accept, no Continue.
    var gated = q.retinalGate === false;
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="retake" aria-label="Retake">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>Quality review</b></div><div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<div class="fundx-shot">' + (img ? '<img src="' + esc(img) + '" alt="captured frame">' : '') +
          (gated ? '' : '<div class="fundx-shot-q ' + (acc ? 'ok' : 'bad') + '" aria-label="' + esc(qw.label) + '">' + ric(acc ? "check_circle" : "error") + '</div>') + '</div>' +
        (gated
          ? '<div class="fundx-verdict bad">' + ric("visibility_off") + '<span>No eye detected</span></div>' +
            '<div class="fundx-whys"><span class="fundx-why">' + ric("info") + "Point the camera at the patient's eye. Quality is only scored once a retinal view (red reflex + fundus) is detected." + '</span></div>'
          : '<div class="fundx-verdict ' + (acc ? 'ok' : 'bad') + '">' + ric(acc ? "check_circle" : "cancel") +
              '<span>' + esc(qw.label) + '</span></div>' +
            (why ? '<div class="fundx-whys">' + why + '</div>' : '') +
            '<div class="rds-section-header"><span class="rds-section-title">Quality breakdown</span></div>' +
            '<div class="fundx-qbars">' + bar("Focus", s.focus) + bar("Exposure", s.exposure) + bar("Low glare", s.reflection) + bar("Retinal view", s.fundusVisibility) + bar("Vessels", s.vesselVisibility) + bar("Red reflex", s.redReflex) + bar("Field of view", s.fieldOfView) + '</div>') +
        '<div class="fundx-actions">' +
          (gated
            ? '<button class="fundx-btn" data-fx="retake">' + ric("photo_camera") + 'Point at the eye</button>'
            : '<button class="fundx-btn ghost" data-fx="retake">' + ric("refresh") + 'Retake</button>' +
              '<button class="fundx-btn" data-fx="toresult">' + (acc ? "Continue" : "Use anyway") + ric("chevron_right") + '</button>') +
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
        clinicalCard(result ? { vision: result.findings, quality: result.quality, eye: session && session.eye, patientContext: patientCtx(), clinicianReview: result.clinicianReview } : null, "result") +
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
        clinicalCard(m, "detail") +
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
      ["confidence", (step.confidence ? step.confidence.level + " " + r2(step.confidence.overall) : ""), step.confidence ? step.confidence.overall >= 0.5 : undefined],
      ["blocker", (step.failure ? step.failure.code : "—"), step.failure ? false : undefined],
      ["decision", (step.capture ? step.capture.decision.toUpperCase() + " · " : "") + step.state + (step.shouldCapture ? " ●" : ""), step.shouldCapture],
      ["pipeline", (devLive.pipeline || ""), undefined],
      ["fps · latency", (devLive.perf ? devLive.perf.fps + " · " + (devLive.perf.latencyMs != null ? devLive.perf.latencyMs + "ms" : "—") : ""), undefined],
      ["stages a·d·r ms", (devLive.perf ? [devLive.perf.analyzeMs, devLive.perf.decideMs, devLive.perf.renderMs].map(function (x) { return x != null ? x : "—"; }).join(" · ") : ""), undefined]
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
    devBuffer.push({ t: fa.ts, state: step.state, focus: r2(fa.focus), glare: r2(fa.reflection), motion: r2(fa.motion), distance: fa.distanceState, roll: (fa.roll == null ? "" : Math.round(fa.roll)), rollState: fa.rollState, redReflex: r2(fa.redReflex), vessel: r2(fa.vesselScore), fundusConf: r2(fa.fundusConf), fundusCirc: r2(fa.fundusCircularity), diagnostic: r2(d), readiness: r2(step.readiness && step.readiness.overall), eyeConf: r2(fa.eyeConf), pupilOffset: r2(fa.pupilOffset), capture: step.shouldCapture ? 1 : 0, decision: (step.capture ? step.capture.decision : ""), confidence: r2(step.confidence && step.confidence.overall), confLevel: (step.confidence ? step.confidence.level : ""), blocker: (step.failure ? step.failure.code : ""), smoothed: r2(step.stability && step.stability.smoothedReadiness) });
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
    var mode = fundxMode();
    function modeChip(k, l) { return '<button class="fundx-chip2' + (mode === k ? ' on' : '') + '" data-fx="setmode" data-v="' + k + '">' + l + '</button>'; }
    function a11yRow(k, l, sub) { var on = a11yOn(k); return '<button class="fundx-set-row' + (on ? ' on' : '') + '" data-fx="seta11y" data-k="' + k + '"><span class="fundx-set-rl"><b>' + l + '</b><span>' + sub + '</span></span>' + ric(on ? "toggle_on" : "toggle_off") + '</button>'; }
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
        '<div class="rds-section-header"><span class="rds-section-title">Capture</span></div>' +
        '<button class="fundx-set-row' + (flashOn() ? ' on' : '') + '" data-fx="setflash"><span class="fundx-set-rl"><b>Auto-flash during capture</b><span>Turns on the rear-camera light to illuminate the fundus while capturing. On by default (Android; iOS WebView has no torch control). Turn off if the reflection is too strong.</span></span>' + ric(flashOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (autoCaptureOn() ? ' on' : '') + '" data-fx="setflag" data-k="smd_fundx_autocapture" data-def="1"><span class="fundx-set-rl"><b>Auto-capture</b><span>Capture automatically when a diagnostic-quality retinal image is held steady. Off = capture only with the manual button (manual shutter).</span></span>' + ric(autoCaptureOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (arGuidanceOn() ? ' on' : '') + '" data-fx="setflag" data-k="smd_fundx_ar_guidance" data-def="1"><span class="fundx-set-rl"><b>AR guidance overlays</b><span>Arrows, alignment ring and gate chips over the camera. Off = a minimal camera + text coaching only.</span></span>' + ric(arGuidanceOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (sensorsOn() ? ' on' : '') + '" data-fx="setsensors"><span class="fundx-set-rl"><b>Motion sensor fusion</b><span>Fuses the phone motion sensors (accelerometer + gyroscope) with the camera to steady capture and improve timing. Falls back automatically when unavailable. Off by default.</span></span>' + ric(sensorsOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">Diagnostics</span></div>' +
        '<button class="fundx-set-row' + (telOn() ? ' on' : '') + '" data-fx="settel"><span class="fundx-set-rl"><b>Acquisition telemetry (anonymous)</b><span>Local, no PHI — guidance steps, quality progression, capture time + outcome. For validation. Off by default.</span></span>' + ric(telOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<button class="fundx-set-row' + (devOn() ? ' on' : '') + '" data-fx="setdev"><span class="fundx-set-rl"><b>Developer mode</b><span>Live metric overlay on the camera + frame-by-frame CSV export (focus/glare/motion/distance/roll/reflex/vessel/fundus/diagnostic/decision). Field-testing only.</span></span>' + ric(devOn() ? "toggle_on" : "toggle_off") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">Guidance mode</span></div>' +
        '<div class="fundx-chips2">' + modeChip("beginner", "Beginner") + modeChip("standard", "Standard") + modeChip("expert", "Expert") + '</div>' +
        '<p class="fundx-note">Beginner adds extra coaching + larger arrows; Expert keeps it minimal. Capture timing is identical in every mode.</p>' +
        '<div class="rds-section-header"><span class="rds-section-title">Accessibility</span></div>' +
        a11yRow("contrast", "High contrast", "Stronger contrast for coaching and overlays.") +
        a11yRow("large", "Large text", "Bigger coaching text and labels.") +
        a11yRow("cvd", "Color-blind-safe cues", "Adds an icon to every colour cue so meaning never relies on colour alone.") +
        '<div class="rds-section-header"><span class="rds-section-title">Data</span></div>' +
        '<button class="fundx-set-row danger" data-fx="clearall"><span class="fundx-set-rl"><b>Delete all scans</b><span>Removes every stored image + record on this device</span></span>' + ric("delete_forever") + '</button>' +
        (devOn() ? '<div class="rds-section-header"><span class="rds-section-title">Advanced</span></div>' +
          '<button class="fundx-set-row" data-fx="devsettings"><span class="fundx-set-rl"><b>Developer · Sensor fusion</b><span>Hybrid depth-engine controls + live sensor status. Testing only.</span></span>' + ric("chevron_right") + '</button>' : '') +
        '<p class="fundx-disc">' + disclaimerText() + '</p>' +
      '</main>';
  }

  // ---- Developer Settings (hybrid sensor fusion) — testing/debugging only, hidden behind
  // Developer mode. Per-sensor enable/disable + force-fallback + live capability/confidence. ----
  function devSF(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : v === "1"; } catch (e) { return def; } }
  function depthOn() { try { var q = (location.search.match(/[?&]fundxdepth=([^&]+)/) || [])[1]; if (q != null) return q === "1"; return localStorage.getItem("smd_fundx_depth") === "1"; } catch (e) { return false; } }
  // Full-res GPU camera preview (native GLSurfaceView / ARKit background behind a transparent WebView).
  function gpuPreviewOn() { try { var q = (location.search.match(/[?&]fundxgpu=([^&]+)/) || [])[1]; if (q != null) return q === "1"; return localStorage.getItem("smd_fundx_gpu_preview") === "1"; } catch (e) { return false; } }
  // Optical Corridor HUD (SVG spatial-AR overlay). Off (default) = the legacy flat ring — an instant,
  // no-deploy revert. Presentation only: consumes the engine, never gates capture.
  function corridorOn() { try { var q = (location.search.match(/[?&]fundxcorridor=([^&]+)/) || [])[1]; if (q != null) return q === "1"; return localStorage.getItem("smd_fundx_corridor") === "1"; } catch (e) { return false; } }
  // Hybrid capture: "Capture Best Frame" enables at this readiness (0..100, default 60); a capture
  // below the recommended quality (0..100, default 50) still proceeds but shows a warning.
  function captureThreshold() { try { var v = parseInt(localStorage.getItem("smd_fundx_capture_threshold"), 10); return isNaN(v) ? 60 : Math.max(0, Math.min(100, v)); } catch (e) { return 60; } }
  function qualityWarnPct() { try { var v = parseInt(localStorage.getItem("smd_fundx_quality_warn"), 10); return isNaN(v) ? 50 : Math.max(0, Math.min(100, v)); } catch (e) { return 50; } }
  // Guidance mode (README 03: Beginner/Standard/Expert) — verbosity only; capture timing is identical.
  function fundxMode() { try { var q = (location.search.match(/[?&]fundxmode=([^&]+)/) || [])[1]; var v = q != null ? q : localStorage.getItem("smd_fundx_mode"); return (v === "beginner" || v === "expert") ? v : "standard"; } catch (e) { return "standard"; } }
  // Accessibility toggles (README 03): high-contrast / large-text / color-blind-safe cues.
  function a11yOn(k) { try { return localStorage.getItem("smd_fundx_a11y_" + k) === "1"; } catch (e) { return false; } }
  // Tone → icon so guidance meaning is conveyed by SHAPE, not colour alone (color-blind-safe).
  function toneGlyph(t) { return t === "critical" ? "report" : t === "warn" ? "warning" : t === "good" ? "check_circle" : "info"; }
  // Auto-capture (default ON): when OFF the app never auto-captures — the clinician uses the
  // manual shutter (the "Capture best frame" button). AR guidance overlays (default ON): when OFF,
  // only the camera + text coach show (no arrows/ring/chips) for a minimal experience.
  function autoCaptureOn() { try { return localStorage.getItem("smd_fundx_autocapture") !== "0"; } catch (e) { return true; } }
  function arGuidanceOn() { try { return localStorage.getItem("smd_fundx_ar_guidance") !== "0"; } catch (e) { return true; } }
  // Workflow 2 — Analyze existing fundus image (upload). Default ON. Reuses the whole downstream.
  function uploadOn() { try { return localStorage.getItem("smd_fundx_upload") !== "0"; } catch (e) { return true; } }
  function screenDevSettings() {
    function row(k, label, sub, def) {
      var on = devSF(k, def);
      return '<button class="fundx-set-row' + (on ? ' on' : '') + '" data-fx="setdevsf" data-k="' + k + '" data-def="' + (def ? "1" : "0") + '"><span class="fundx-set-rl"><b>' + esc(label) + '</b><span>' + esc(sub) + '</span></span>' + ric(on ? "toggle_on" : "toggle_off") + '</button>';
    }
    return '' +
      '<header class="fundx-head"><button class="fundx-close" data-fx="settings" aria-label="Back">' + ric("arrow_back_ios_new") + '</button><div class="fundx-head-tt"><b>Developer · Sensors</b></div><div class="fundx-head-sp"></div></header>' +
      '<main class="fundx-scroll">' +
        '<div class="rds-section-header"><span class="rds-section-title">Hybrid depth fusion</span></div>' +
        row("smd_fundx_depth", "Enable depth fusion", "Master switch for native ARKit/ARCore depth. Off = MediaPipe + CV only.", false) +
        row("smd_fundx_gpu_preview", "GPU camera preview", "Full-res hardware camera behind the UI (needs depth fusion on). Off = the CPU preview.", false) +
        row("smd_fundx_corridor", "Optical Corridor HUD", "Spatial-AR acquisition overlay — rings receding to the optical axis, red-reflex bloom, hold ring (replaces the flat ring). Presentation only; never gates capture.", false) +
        '<button class="fundx-set-row" data-fx="corridorpreview"><span class="fundx-set-rl"><b>Preview the Optical Corridor</b><span>Play a scripted demo of the full corridor (no lens or camera needed) to evaluate the interaction design.</span></span>' + ric("play_circle") + '</button>' +
        '<div class="rds-section-header"><span class="rds-section-title">iOS · ARKit / LiDAR</span></div>' +
        row("smd_fundx_dev_arkit", "ARKit", "World tracking + camera pose.", true) +
        row("smd_fundx_dev_lidar", "LiDAR", "LiDAR scanner (Pro devices).", true) +
        row("smd_fundx_dev_scenedepth", "SceneDepth", "Per-pixel metric scene depth.", true) +
        '<div class="rds-section-header"><span class="rds-section-title">Android · ARCore</span></div>' +
        row("smd_fundx_dev_arcore", "ARCore", "Motion tracking + camera pose.", true) +
        row("smd_fundx_dev_arcoredepth", "ARCore Depth API", "Depth-from-motion / ToF metric distance.", true) +
        '<div class="rds-section-header"><span class="rds-section-title">Fallback</span></div>' +
        row("smd_fundx_dev_forcemono", "Force MediaPipe-only", "Ignore all native depth; use the monocular pipeline.", false) +
        '<div class="rds-section-header"><span class="rds-section-title">Runtime capabilities</span></div>' +
        '<div class="fundx-devstat" id="fundxDevCaps"><div class="fundx-devlive">Detecting hardware…</div></div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Live acquisition</span></div>' +
        '<div class="fundx-devstat" id="fundxDevLive"><div class="fundx-devlive">No capture yet — start a Retinal Scan to populate.</div></div>' +
        '<p class="fundx-disc">Testing/debugging only. Changes take effect on the next capture. Depth is device-gated and never required — the app always falls back to the monocular MediaPipe + CV engine.</p>' +
      '</main>';
  }
  // Populate the Developer Settings live panels: async runtime capabilities from the native
  // FundxDepth plugin + the current/last acquisition state. Called after the screen renders.
  function wireDevSettings() {
    function kvh(label, val, state) {
      var cls = state === true ? "fx-ok" : (state === false ? "fx-off" : "");
      return '<div class="fundx-kv"><span>' + esc(label) + '</span><b class="' + cls + '">' + esc(String(val)) + '</b></div>';
    }
    function yn(b) { return b ? "yes" : "no"; }
    function paintCaps(c) {
      c = c || {};
      var mp = {}; try { mp = (window.SMD_FUNDX_SENSORS && window.SMD_FUNDX_SENSORS.capabilities()) || {}; } catch (e) {}
      var el = document.getElementById("fundxDevCaps"); if (!el) return;
      var cm = (c.coreMotion != null) ? c.coreMotion : mp.deviceMotion;
      el.innerHTML = '' +
        kvh("Platform", c.platform || (window.Capacitor ? "native" : "web"), c.platform ? true : null) +
        kvh("ARKit", c.arkit != null ? yn(c.arkit) : "—", c.arkit) +
        kvh("LiDAR", c.lidar != null ? yn(c.lidar) : "—", c.lidar) +
        kvh("SceneDepth", c.sceneDepth != null ? yn(c.sceneDepth) : "—", c.sceneDepth) +
        kvh("ARCore", c.arcore != null ? yn(c.arcore) : "—", c.arcore) +
        kvh("ARCore Depth", c.arcoreDepth != null ? yn(c.arcoreDepth) : "—", c.arcoreDepth) +
        kvh("Camera pose", c.pose != null ? yn(c.pose) : "—", c.pose) +
        kvh("CoreMotion / IMU", cm != null ? yn(cm) : "—", cm) +
        kvh("Depth fusion flag", depthOn() ? "ON" : "off", depthOn());
    }
    paintCaps({});
    var P; try { P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FundxDepth; } catch (e) {}
    if (P && P.capabilities) { P.capabilities().then(function (c) { paintCaps(c); }, function () {}); }
    var live = document.getElementById("fundxDevLive"); if (!live) return;
    var contribs = devLive.contributions || {};
    var mode = devLive.pipeline === "native-depth" ? "native depth + heuristics + IMU"
             : devLive.pipeline === "monocular" ? "monocular (MediaPipe + CV + IMU)" : "idle";
    live.innerHTML = '' +
      kvh("Active pipeline", devLive.pipeline || "idle (no capture yet)", devLive.pipeline ? true : null) +
      kvh("Fusion mode", mode) +
      kvh("Confidence", devLive.confidence != null ? Math.round(devLive.confidence * 100) + "%" : "—") +
      kvh("FPS", devLive.fps || "—") +
      kvh("Depth (last)", devLive.depthMm != null ? devLive.depthMm + " mm" : "—") +
      kvh("Contributions", JSON.stringify({ motion: contribs.motion || [], distance: contribs.distance || [], pose: contribs.pose || [] }));
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
    screen = "camera"; capturing = false; lastHapticState = ""; lastCoachArrow = null; lastCritical = false; lastCoachText = ""; lastCoachTier = ""; lastCoachDetail = ""; lastStepKey = null;
    session = session || newSession("right");
    if (session.mode !== "training") {
      var plat = "web"; try { var C = window.Capacitor; plat = C ? (typeof C.getPlatform === "function" ? C.getPlatform() : (C.platform || "web")) : "web"; } catch (e) {}
      var prov = "mock"; try { prov = (window.SMD_FUNDX_PROVIDERS && SMD_FUNDX_PROVIDERS.getActive && SMD_FUNDX_PROVIDERS.getActive().id) || "mock"; } catch (e) {}
      tel("startSession", { device: plat, appVersion: (window.SMD_APP_VERSION || "fundx-mvp"), provider: prov, sensitivity: loadSens(), eye: session.eye });
    }
    render();
    // Optical Corridor HUD: mount the SVG overlay when the flag is on (presentation only). If it
    // fails or the flag is off, the legacy ring/arrow render exactly as before.
    hud = null; try { if (corridorOn() && window.SMD_FUNDX_HUD) { hud = window.SMD_FUNDX_HUD.create(); var _ch = document.getElementById("fundxCorridor"); if (_ch) hud.mount(_ch); else hud = null; } } catch (e) { hud = null; }
    // Hide the legacy reticle ONLY when the HUD actually mounted — if fundx-hud.js is missing/broken
    // the flat ring/arrow/score must still render (never leave the operator with no readiness feedback).
    try { if (rootEl) rootEl.classList.toggle("fundx-hud-active", !!hud); } catch (e) {}
    var video = document.getElementById("fundxVideo");
    sm = V().createStateMachine();
    // Acquisition Decision Engine (README 05) wraps this SAME state machine and adds confidence
    // fusion + a Capture/Wait/Continue/Restart decision + failure→recovery + temporal stability +
    // explainability. observe() returns a superset of step() so the UI is unchanged; if the module
    // isn't loaded, onFrame falls back to sm.step() directly.
    eng = null; try { if (window.SMD_FUNDX_ENGINE) eng = window.SMD_FUNDX_ENGINE.create({ vision: V(), stateMachine: sm, mode: fundxMode() }); } catch (e) { eng = null; }
    perfMeter = null; try { if (window.SMD_FUNDX_ENGINE && window.SMD_FUNDX_ENGINE.createPerfMeter) perfMeter = window.SMD_FUNDX_ENGINE.createPerfMeter({ window: 30 }); } catch (e) { perfMeter = null; }
    cam = Vd.makeCamera();
    var startOpts = { hub: (hub = Vd.makeHub()), analyzeEveryMs: 110, analyzeScale: 0.25, flash: flashOn() };
    var useNative = false;
    try { useNative = depthOn() && !devSF("smd_fundx_dev_forcemono", false) && !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FundxDepth); } catch (e) {}
    usingNative = useNative;
    var gpuPreview = useNative && gpuPreviewOn();
    usingGpu = gpuPreview;
    var starter;
    if (gpuPreview) {
      // GPU preview: the native GLSurfaceView / ARKit camera background (behind the transparent
      // WebView) IS the preview — full-res, hardware-accelerated. No JS canvas; the streamed
      // low-res frames drive ONLY the analysis pipeline. body.fundx-gpu makes the camera area
      // transparent so the native surface shows through. Falls back to getUserMedia on failure.
      try { document.documentElement.classList.add("fundx-gpu"); document.body.classList.add("fundx-gpu"); } catch (e) {}
      if (video) video.style.display = "none";
      startOpts.gpuPreview = true;
      starter = cam.startNative(video, onFrame, startOpts).catch(function () {
        usingNative = false; usingGpu = false;
        try { document.documentElement.classList.remove("fundx-gpu"); document.body.classList.remove("fundx-gpu"); if (video) video.style.display = ""; } catch (x) {}
        delete startOpts.gpuPreview;
        return cam.start(video, onFrame, startOpts);
      });
    } else if (useNative) {
      // Depth mode (CPU preview): ARCore/ARKit owns the camera; render its streamed frames onto a
      // preview canvas over the (now source-less) <video>. On any failure, fall back to getUserMedia.
      var pc = document.createElement("canvas"); pc.className = "fundx-video"; pc.id = "fundxNativeCanvas";
      if (video && video.parentNode) video.parentNode.insertBefore(pc, video);
      if (video) video.style.display = "none";
      startOpts.previewCanvas = pc; startOpts.previewCtx = pc.getContext("2d");
      starter = cam.startNative(video, onFrame, startOpts).catch(function () {
        usingNative = false;
        try { pc.remove(); if (video) video.style.display = ""; } catch (x) {}
        delete startOpts.previewCanvas; delete startOpts.previewCtx;
        return cam.start(video, onFrame, startOpts);
      });
    } else {
      starter = cam.start(video, onFrame, startOpts);
    }
    starter.then(function () {
      setState("Point the camera at the eye");
      // Fundal exam needs illumination: auto-enable the torch in native/GPU mode (getUserMedia mode
      // already turns it on in cam.start). The flash button in the header toggles it.
      if (usingNative && flashOn() && cam && cam.setTorch) { try { cam.setTorch(true); } catch (e) {} }
    }).catch(function (err) { showCamError(err); });
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
    var _tA = perfNow();
    lastFa = fa;
    devLive.frames++;
    if (devLive.lastT) { var _dt = fa.ts - devLive.lastT; if (_dt > 0) devLive.fps = Math.round(1000 / _dt); }
    devLive.lastT = fa.ts;
    devLive.pipeline = usingNative ? "native-depth" : "monocular";
    if (fa.acqConfidence != null) devLive.confidence = fa.acqConfidence;
    if (fa.distanceMm != null) devLive.depthMm = fa.distanceMm;
    try { if (hub && hub.sensors && hub.sensors.contributions) devLive.contributions = hub.sensors.contributions(); } catch (e) {}
    var step = eng ? eng.observe(fa, fa.ts) : sm.step(fa, fa.ts);
    var _tD = perfNow();
    session.readinessTrace.push(Math.round((step.readiness.overall || 0) * 100));
    if (session.readinessTrace.length > 400) session.readinessTrace.shift();
    updateCameraUI(step, fa);
    // Per-stage frame timing (README 08): capture (native/grab) → analyze (JS receive) → decide
    // (engine) → render (UI). JS-side latencies are real; native camera/GPU latency needs a device.
    if (perfMeter) { perfMeter.mark({ capture: fa.ts, analyze: _tA, decide: _tD, render: perfNow() }); if (devOn()) devLive.perf = perfMeter.stats(); }
    if (devOn()) { paintDebug(step, fa); recordDevFrame(step, fa); }
    if (session.mode !== "training") tel("frame", step, fa.ts);
    if (session.mode === "training") { handleTraining(step); return; }
    if (step.shouldCapture && autoCaptureOn()) triggerCapture();
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
    // Prefer the Decision Engine's consolidated guidance (adds tier/detail + Safety-1 critical
    // override); fall back to the Coach cue if the engine module isn't present.
    var cue = step.guidance || V().Coach.cueFor(step.state, fa, step.readiness);
    var tier = cue.tier || cue.tone;
    if (session.mode !== "training" && cue.arrow && cue.arrow !== lastCoachArrow) { lastCoachArrow = cue.arrow; tel("correction"); }
    var stEl = document.getElementById("fundxState"); if (stEl) stEl.textContent = humanState(step.state);
    // Only rebuild the coach when the instruction/tier actually changes — #fundxCoach is an
    // aria-live="assertive" region, so mutating it every frame makes screen readers re-announce the
    // same instruction (defeats the one-instruction rule for VoiceOver/TalkBack users).
    var coach = document.getElementById("fundxCoach");
    if (coach && (cue.text !== lastCoachText || tier !== lastCoachTier)) {
      coach.className = "fundx-coach t-" + tier;
      coach.innerHTML = (tier === "info" ? "" : ric(toneGlyph(tier))) + '<span class="fundx-coach-tx">' + esc(cue.text) + '</span>';
      lastCoachText = cue.text; lastCoachTier = tier;
    }
    var cdet = document.getElementById("fundxCoachDetail"); if (cdet && (cue.detail || "") !== lastCoachDetail) { cdet.textContent = cue.detail || ""; lastCoachDetail = cue.detail || ""; }
    // Optical Corridor HUD — push the engine frame; the HUD interpolates on its own 60fps loop.
    if (hud) { try { hud.push(step, fa); } catch (e) {} }
    // Storyboard step indicator (README 03) — updated only when the named step changes.
    var stepEl = document.getElementById("fundxStep"); var st = step.step;
    if (stepEl && (st ? st.key : null) !== lastStepKey) {
      lastStepKey = st ? st.key : null;
      if (st) { stepEl.innerHTML = '<span class="fundx-step-lbl">Step ' + st.index + ' / ' + st.total + ' · ' + esc(st.title) + '</span><i class="fundx-step-bar"><b style="width:' + Math.round(st.progress * 100) + '%"></b></i>'; stepEl.style.display = "block"; }
      else stepEl.style.display = "none";
    }
    // readiness ring (circumference 2πr, r=54 → ~339.29)
    var pct = step.readiness.overall || 0; var C = 339.29;
    var ring = document.getElementById("fundxRingFg"); if (ring) { ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - pct); ring.setAttribute("class", "fundx-ring-fg " + (pct >= 0.9 ? "hi" : pct >= 0.5 ? "mid" : "lo")); }
    var score = document.getElementById("fundxScore"); if (score) score.textContent = Math.round(pct * 100);
    var capBtn = document.getElementById("fundxCaptureBtn");
    if (capBtn) { var canCap = Math.round(pct * 100) >= captureThreshold(); capBtn.disabled = !canCap; capBtn.classList.toggle("ready", canCap); }
    var arrow = document.getElementById("fundxArrow");
    if (arrow) { if (cue.arrow) { arrow.style.opacity = "1"; arrow.firstChild ? (arrow.innerHTML = ric(arrowGlyph(cue.arrow))) : null; arrow.className = "fundx-arrow show a-" + cue.arrow; arrow.innerHTML = ric(arrowGlyph(cue.arrow)); } else { arrow.className = "fundx-arrow"; } }
    var g = step.gates || {};
    CHIPS.forEach(function (c) { var el = document.querySelector('.fundx-chip[data-chip="' + c.k + '"]'); if (el) el.classList.toggle("on", !!g[c.k]); });
    // optional operator-confirm fallback: only surfaces on a stall AND only when configured
    var fb = document.getElementById("fundxFallback");
    if (fb) fb.style.display = (step.stalled && lensConfirmOn() && session.mode !== "training") ? "" : "none";
    // haptic + voice: on state change, on a NEW Safety-1 critical even mid-state (the warning
    // haptic + spoken alert must fire when severe glare appears without a state change), and
    // re-announce for warn / critical each frame so the more-severe critical is never quieter.
    var isCrit = tier === "critical";
    if (step.state !== lastHapticState) { lastHapticState = step.state; if (cue.haptic) haptic(cue.haptic); else haptic("selection"); VOICE.speak(cue.voice); }
    else { if (isCrit && !lastCritical) haptic(cue.haptic || "warning"); if (cue.tone === "warn" || isCrit) VOICE.speak(cue.voice); }
    lastCritical = isCrit;
  }
  function lastReadinessPct() { try { var t = session && session.readinessTrace; return (t && t.length) ? t[t.length - 1] : 0; } catch (e) { return 0; } }
  function triggerCapture() {
    if (capturing) return; capturing = true;
    session.captureMode = "auto"; session.captureReadinessPct = lastReadinessPct();
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
  // Hybrid manual capture: on the clinician's press (button enabled at readiness >= threshold),
  // grab the buffered burst and let BestFrameSelector pick the highest-quality frame — the same
  // best-of-buffer path the auto-capture uses — so perfect acquisition isn't required.
  function manualCapture() {
    if (capturing || !session || !cam) return;
    var pct = lastReadinessPct();
    if (pct < captureThreshold()) { haptic("warning"); toast("Keep improving alignment (readiness " + pct + " / " + captureThreshold() + ")."); return; }
    capturing = true;
    session.captureMode = "manual"; session.captureReadinessPct = pct;
    try { sm.set(V().STATE.CAPTURING); } catch (e) {}
    haptic("success"); VOICE.speak("Capturing best frame");
    var flash = document.getElementById("fundxFlash"); if (flash) { flash.classList.add("on"); setTimeout(function () { flash.classList.remove("on"); }, 220); }
    session.captures++;
    setTimeout(function () {
      var burst = [];
      try { burst = cam.captureBurst(20) || []; } catch (e) {}
      session.burstCount = burst.length;
      stopCamera();
      runProcessing(burst);
    }, 140);
  }
  function stopCamera() { try { if (cam) cam.stop(); } catch (e) {} try { if (hud) hud.unmount(); } catch (e) {} hud = null; try { if (rootEl) rootEl.classList.remove("fundx-hud-active"); } catch (e) {} try { document.documentElement.classList.remove("fundx-gpu"); document.body.classList.remove("fundx-gpu"); } catch (e) {} usingGpu = false; VOICE.stop(); }
  // Lifecycle: releasing the camera when the app is backgrounded (tab hidden / app to
  // background) prevents the stream + rAF loop running invisibly (battery/thermal). Wired
  // once; on return the user is on the pre-capture screen and can restart.
  var _visWired = false;
  function wireVisibility() {
    if (_visWired || typeof document === "undefined" || !document.addEventListener) return;
    _visWired = true;
    document.addEventListener("visibilitychange", function () {
      try {
        if (document.hidden && screen === "camera" && (hud || (cam && cam.isRunning && cam.isRunning()))) { stopCamera(); tel("endSession", "backgrounded"); if (FUNDX.isOpen()) { screen = "precapture"; render(); } }
        else if (document.hidden && screen === "corridorpreview") { stopCorridorPreview(); if (FUNDX.isOpen()) { screen = devOn() ? "devsettings" : "settings"; render(); } }
      } catch (e) {}
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

  // ---- Workflow 2 · Analyze existing fundus image (upload) ----------------
  // Decode an uploaded image → downscaled ImageData → the SAME Heuristic signals the live camera
  // produces, so an uploaded fundus flows through the identical quality + vision + report pipeline.
  function computeImageMetrics(dataUrl) {
    return new Promise(function (resolve) {
      var D = DET(); var H = D && D.Heuristic;
      if (!H || !dataUrl || typeof Image === "undefined") return resolve({});
      var img = new Image();
      img.onload = function () {
        try {
          var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, maxW = 480;
          var sc = Math.min(1, maxW / (iw || maxW));
          var w = Math.max(2, Math.round(iw * sc)), h = Math.max(2, Math.round(ih * sc));
          var c = document.createElement("canvas"); c.width = w; c.height = h;
          var cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
          var id = cx.getImageData(0, 0, w, h);
          var base = H.analyze(id, {}), fund = H.fundus(id), vess = H.vessels(id, {});
          resolve(Object.assign({}, base, fund, { vesselScore: vess, retinaConf: fund.fundusConf, srcW: iw, srcH: ih }));
        } catch (e) { resolve({}); }
      };
      img.onerror = function () { resolve({}); };
      img.src = dataUrl;
    });
  }
  // Analyze ONE uploaded fundus image through the unified downstream (Quality Review → AI → Report).
  function processImageUpload(dataUrl) {
    if (!dataUrl) return;
    if (!session || session.mode !== "upload") { session = newSession((session && session.eye) || "right"); session.mode = "upload"; }
    session.source = "upload"; session.burstCount = 1; session.captureMode = "upload";
    screen = "processing"; render();
    computeImageMetrics(dataUrl).then(function (metrics) {
      result = FUNDX._buildUploadResult(dataUrl, metrics, ctx, session.eye);
      if (!result) { toast("Could not read that image."); screen = "upload"; return render(); }
      finishProcessing([{ dataUrl: dataUrl, metrics: metrics }]);
    });
  }

  function runProcessing(burst) {
    screen = "processing"; render();
    result = FUNDX._buildResult(burst, ctx, session.eye, session);
    if (!result) { tel("capture", { success: false, durationMs: nowMs() - session.startTs, bursts: session.burstCount }); toast("No usable frames — try again."); screen = "camera"; return startCamera(); }
    result.source = "live";
    finishProcessing(burst);
  }
  // Shared downstream for BOTH workflows — live capture AND uploaded fundus image (Workflow 2):
  // Stage-1 retinal gate → non-destructive enhancement → AI inference (provider abstraction) →
  // Quality Review. `burst` supplies the frame metrics for the provider call. `result` is already
  // built (live: _buildResult; upload: _buildUploadResult) and carries result.source.
  function finishProcessing(burst) {
    var tx = document.getElementById("fundxProcTx");
    if (!result) { screen = "home"; return render(); }
    // STAGE-1 retinal gate: if the image is not a retinal scene, do NOT score it, do NOT run AI, and
    // route to the gated review ("No retina detected", no Continue). Same guarantee for both workflows.
    if (result.quality && result.quality.retinalGate === false) {
      tel("capture", { success: false, gated: true, source: result.source });
      haptic("warning"); screen = "review"; render(); return;
    }
    tel("capture", { success: true, quality: result.quality.overall, source: result.source, bursts: (session && session.burstCount) });
    // Quality gate is advisory, not blocking: warn below the recommended threshold but let the
    // clinician proceed with analysis (the hybrid workflow's point).
    result.qualityWarn = !!(result.quality && result.quality.overall != null && result.quality.overall * 100 < qualityWarnPct());
    if (result.qualityWarn) { haptic("warning"); try { toast("Image quality below recommended (" + Math.round(result.quality.overall * 100) + "/100). You can still proceed."); } catch (e) {} }
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
            { imageDataUrl: result.images.processed || result.images.original, quality: result.quality.overall, metrics: ((burst && burst[result.best]) || {}).metrics },
            { patientRef: (ctx && ctx.ref) || null, eye: (session && session.eye), ts: nowMs() }
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
      captureMode: (stats && stats.captureMode) || "auto",
      captureReadinessPct: (stats && stats.captureReadinessPct != null) ? stats.captureReadinessPct : null,
      images: { original: original, processed: original, thumbnail: best.thumb || original }
    };
  }
  // Build a result from an UPLOADED fundus image (Workflow 2): upload-mode quality (circular-glow
  // requirement relaxed — an existing fundus fills the frame) + the same Findings contract as live
  // capture, so it flows through the identical enhance/AI/review/report/history downstream. DOM-free.
  function _buildUploadResult(dataUrl, metrics, context, eye) {
    var Ve = V(); if (!Ve || !dataUrl) return null;
    var quality = Ve.QualityEngine.score(metrics || {}, { upload: true });
    var findings = Ve.Findings.build({
      input: { quality: quality.overall, metrics: metrics },
      ctx: { patientRef: (context && context.ref) || null, eye: eye, ts: nowMs() },
      quality: quality
    });
    return {
      best: 0, quality: quality, findings: findings, selection: { best: 0, scores: [quality] },
      source: "upload", captureMode: "upload", captureReadinessPct: null,
      images: { original: dataUrl, processed: dataUrl, thumbnail: dataUrl }
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
        captureMode: res.captureMode || "auto",
        captureReadinessPct: (res.captureReadinessPct != null) ? res.captureReadinessPct : null,
        readinessTrace: (stats && stats.readinessTrace) ? stats.readinessTrace.slice(-60) : [],
        stateHistory: (sm && sm.history) ? sm.history.slice(-40) : []
      },
      source: (res && res.source) || "live",
      vision: res.findings,
      clinical: (res && res.clinical) || null,
      clinicianReview: (res && res.clinicianReview) || null,
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
    // Freeze the advisory clinical assessment into the record at save time (so the report + any
    // clinician review persist with the scan; buildReport recomputes only if absent).
    if (clinicalOn() && window.SMD_FUNDX_CLINICAL && result && !result.clinical) {
      try { result.clinical = window.SMD_FUNDX_CLINICAL.assessSync(result.findings, patientCtx()); } catch (e) {}
    }
    var rec = _buildScanRecord(result, patientCtx(), session.eye, session);
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
    // Central teardown: leaving the corridor preview by ANY path (back, home, start-camera, close)
    // must unmount previewHud so its internal 60fps rAF loop can't orphan/leak (P2 review fix).
    if (previewHud && screen !== "corridorpreview") stopCorridorPreview();
    rootEl.classList.toggle("cam", screen === "camera");
    // Guidance mode + accessibility surface as root classes (CSS-only presentation, README 03).
    var _mode = fundxMode();
    rootEl.classList.toggle("fundx-mode-beginner", _mode === "beginner");
    rootEl.classList.toggle("fundx-mode-expert", _mode === "expert");
    rootEl.classList.toggle("fundx-a11y-contrast", a11yOn("contrast"));
    rootEl.classList.toggle("fundx-a11y-large", a11yOn("large"));
    rootEl.classList.toggle("fundx-a11y-cvd", a11yOn("cvd"));
    rootEl.classList.toggle("fundx-ar-off", !arGuidanceOn());
    rootEl.classList.toggle("fundx-corridor-on", corridorOn());
    if (screen === "home") { rootEl.innerHTML = screenHome(); paintRecent(); }
    else if (screen === "upload") { rootEl.innerHTML = screenUpload(); wireUpload(); }
    else if (screen === "corridorpreview") rootEl.innerHTML = screenCorridorPreview();
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
    else if (screen === "devsettings") { rootEl.innerHTML = screenDevSettings(); wireDevSettings(); }
  }
  function show(s) { screen = s; render(); }

  function onClick(e) {
    var b = e.target.closest("[data-fx]"); if (!b) return;
    var a = b.getAttribute("data-fx");
    switch (a) {
      case "close": return FUNDX.close();
      case "home": stopCamera(); return show("home");
      case "newscan": haptic("medium"); session = newSession("right"); return show("precapture");
      case "analyzeimg": haptic("light"); return show("upload");
      case "pickimg": { var fi = document.getElementById("fundxFileInput"); if (fi) fi.click(); return; }
      case "corridorpreview": haptic("light"); return startCorridorPreview();
      case "closepreview": stopCorridorPreview(); haptic("light"); return show(devOn() ? "devsettings" : "settings");
      case "eye": if (session) session.eye = b.getAttribute("data-eye"); haptic("selection"); return render();
      case "startcam": haptic("medium");
        // iOS 13+ requires DeviceMotion permission be requested from THIS user gesture, or the
        // IMU never emits. Fire-and-forget: once granted, events flow to the already-attached
        // listener; denial simply falls back to the monocular engine.
        if (sensorsOn() && window.SMD_FUNDX_SENSORS && window.SMD_FUNDX_SENSORS.requestMotionPermission) { try { window.SMD_FUNDX_SENSORS.requestMotionPermission(); } catch (e) {} }
        return startCamera();
      case "camclose": stopCamera(); haptic("light"); return show("home");
      case "capturebest": return manualCapture();
      case "torch": {
        var tOn = (cam && cam.torchOn) ? cam.torchOn() : false;
        var tNext = !tOn;
        if (cam && cam.setTorch) { try { cam.setTorch(tNext); } catch (e) {} }
        haptic("selection");
        var fbn = document.getElementById("fundxFlashBtn");
        if (fbn) { fbn.classList.toggle("on", tNext); fbn.innerHTML = ric(tNext ? "flash_on" : "flash_off"); }
        return;
      }
      case "confirmlens": if (sm && sm.confirmLensPositioned) sm.confirmLensPositioned(); haptic("selection"); { var fbb = document.getElementById("fundxFallback"); if (fbb) fbb.style.display = "none"; } toast("Proceeding — capture still needs a clear retinal image."); return;
      case "setlensconfirm": { try { localStorage.setItem("smd_fundx_lens_confirm", lensConfirmOn() ? "0" : "1"); } catch (e) {} applySettings(); haptic("selection"); return render(); }
      case "settel": { try { localStorage.setItem("smd_fundx_telemetry", telOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setdev": { try { localStorage.setItem("smd_fundx_dev", devOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setsensors": { try { localStorage.setItem("smd_fundx_sensors", sensorsOn() ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setflash": { try { localStorage.setItem("smd_fundx_flash", flashOn() ? "0" : "1"); } catch (e) {} if (cam && cam.setTorch) { try { cam.setTorch(flashOn()); } catch (e) {} } haptic("selection"); return render(); }
      case "devsettings": haptic("light"); return show("devsettings");
      case "setdevsf": { var k = b.getAttribute("data-k"); var def = b.getAttribute("data-def") === "1"; var cur; try { var v = localStorage.getItem(k); cur = v == null ? def : v === "1"; localStorage.setItem(k, cur ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "devexport": haptic("light"); return exportDevLog();
      case "voice": VOICE.setEnabled(!VOICE.enabled()); haptic("selection"); { var vb = document.getElementById("fundxVoiceBtn"); if (vb) { vb.classList.toggle("on", VOICE.enabled()); vb.innerHTML = ric(VOICE.enabled() ? "volume_up" : "volume_off"); } if (VOICE.enabled()) VOICE.speak("Voice coaching on"); } return;
      case "retake": haptic("light"); if (result && result.quality) tel("reject", result.quality.reasons); tel("endSession", "retake"); result = null; session.retries++; return startCamera();
      case "toresult": haptic("medium"); return show("result");
      case "review": return show("review");
      case "discard": haptic("light"); if (result && result.quality) tel("reject", result.quality.reasons); tel("endSession", "discarded"); result = null; return show("home");
      case "save": return saveScan();
      case "reviewact": {
        var Cx = window.SMD_FUNDX_CLINICAL; if (!Cx) return;
        var rvAct = b.getAttribute("data-act"), rvScope = b.getAttribute("data-scope"), rvPayload = {};
        if (rvAct === "comment") { var note = (typeof prompt === "function") ? prompt("Clinician note:", "") : ""; if (note == null) return; rvPayload.note = note; }
        if (rvAct === "edit") { var txt = (typeof prompt === "function") ? prompt("Edited conclusion (advisory):", "") : ""; if (txt == null) return; rvPayload.text = txt; }
        var rvTarget = rvScope === "detail" ? (detail && detail.meta) : result;
        if (!rvTarget) return;
        rvTarget.clinicianReview = Cx.applyReview(rvTarget.clinicianReview, rvAct, rvPayload, { by: (window.SMD_OPERATOR_ID || "clinician") });
        // Detail scope = an already-saved scan: persist via updateScan (a metadata-only patch). The
        // stored record has its images stripped, so saveScan would fail validation; updateScan does
        // not re-validate. Result scope persists later when the clinician taps "Save to patient".
        if (rvScope === "detail" && detail && detail.meta && detail.meta.id) {
          try { var stR = STORE(); if (stR && stR.updateScan) { stR.updateScan(detail.meta.id, { clinicianReview: rvTarget.clinicianReview }).catch(function () {}); } } catch (e) {}
        }
        haptic("selection"); toast("Review: " + rvTarget.clinicianReview.status); return render();
      }
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
      case "setmode": { try { localStorage.setItem("smd_fundx_mode", b.getAttribute("data-v")); } catch (e) {} if (eng && eng.setMode) { try { eng.setMode(fundxMode()); } catch (e) {} } haptic("selection"); return render(); }
      case "seta11y": { var ak = b.getAttribute("data-k"); try { localStorage.setItem("smd_fundx_a11y_" + ak, a11yOn(ak) ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
      case "setflag": { var flk = b.getAttribute("data-k"), fldef = b.getAttribute("data-def") !== "0"; try { var flcur = localStorage.getItem(flk); var flon = flcur == null ? fldef : flcur === "1"; localStorage.setItem(flk, flon ? "0" : "1"); } catch (e) {} haptic("selection"); return render(); }
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
    close: function () { stopCamera(); stopCorridorPreview(); tel("endSession", "abandoned"); if (rootEl) rootEl.classList.remove("on"); document.body.style.overflow = ""; haptic("tap"); },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
    enabled: function () { return true; },
    // Android back / swipe-back: step back WITHIN the overlay (camera -> precapture -> home ->
    // close) so the gesture never leaks to the main app. Returns true when it handled the back.
    back: function () {
      if (!(rootEl && rootEl.classList.contains("on"))) return false;
      if (screen === "camera") { stopCamera(); screen = "precapture"; render(); haptic("tap"); return true; }
      if (screen !== "home") { screen = "home"; render(); haptic("tap"); return true; }
      FUNDX.close(); return true;
    },
    _screen: function () { return screen; },
    _buildResult: _buildResult,
    _buildUploadResult: _buildUploadResult,
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
