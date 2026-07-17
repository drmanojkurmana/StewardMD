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
  var capturing = false, lastHapticState = "", scanSeq = 0;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function ric(name) { return '<span class="rds-icon" aria-hidden="true">' + name + '</span>'; }
  function haptic(kind) { try { if (H && H[kind]) H[kind](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function nowMs() { return (typeof Date !== "undefined") ? Date.now() : 0; }

  var DISCLAIMER = 'Vision detection preview — not a diagnosis. Images stay on this device.';

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
    { k: "eye", l: "Eye" }, { k: "pupil", l: "Pupil" }, { k: "lens", l: "Lens" },
    { k: "distance", l: "Distance" }, { k: "redReflex", l: "Reflex" }, { k: "retina", l: "Retina" },
    { k: "focus", l: "Focus" }, { k: "reflection", l: "Glare" }, { k: "motion", l: "Steady" },
    { k: "disc", l: "Disc" }, { k: "macula", l: "Macula" }
  ];
  function arrowGlyph(a) {
    return { left: "west", right: "east", up: "north", down: "south", closer: "add", farther: "remove" }[a] || "";
  }

  // ================= SCREENS =================
  function screenHome() {
    var who = ctx && ctx.name ? '<div class="fundx-sub">' + esc(ctx.name) + (ctx.meta ? ' · ' + esc(ctx.meta) : '') + '</div>' : '';
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="close" aria-label="Close">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>FundX<span>AI</span></b>' + who + '</div><div class="fundx-head-sp"></div>' +
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
        '<p class="fundx-disc">' + DISCLAIMER + '</p>' +
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
        '<button class="fundx-cta" data-fx="startcam">' + ric("photo_camera") +
          '<div class="fundx-cta-tx"><b>Start guided capture</b><span>' + esc(eye === "right" ? "Right (OD)" : "Left (OS)") + ' · camera opens</span></div>' + ric("chevron_right") + '</button>' +
        '<p class="fundx-disc">The camera captures automatically when alignment and quality are good — there is no shutter button. ' + DISCLAIMER + '</p>' +
      '</main>';
  }

  function screenCamera() {
    return '' +
      '<div class="fundx-cam">' +
        '<video id="fundxVideo" class="fundx-video" playsinline muted autoplay></video>' +
        '<div class="fundx-cam-scrim"></div>' +
        '<header class="fundx-cam-top rds-safe-top">' +
          '<button class="fundx-cam-x" data-fx="camclose" aria-label="Close">' + ric("close") + '</button>' +
          '<div id="fundxState" class="fundx-state">Starting camera…</div>' +
          '<button id="fundxVoiceBtn" class="fundx-cam-x' + (VOICE.enabled() ? ' on' : '') + '" data-fx="voice" aria-label="Voice coaching">' + ric(VOICE.enabled() ? "volume_up" : "volume_off") + '</button>' +
        '</header>' +
        '<div class="fundx-reticle">' +
          '<svg class="fundx-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="fundx-ring-bg" cx="60" cy="60" r="54"/><circle id="fundxRingFg" class="fundx-ring-fg" cx="60" cy="60" r="54"/></svg>' +
          '<div id="fundxArrow" class="fundx-arrow">' + ric("north") + '</div>' +
          '<div id="fundxScore" class="fundx-score">0</div>' +
        '</div>' +
        '<div class="fundx-cam-bottom rds-safe-bottom">' +
          '<div id="fundxCoach" class="fundx-coach">Point the camera at the eye</div>' +
          '<div id="fundxChips" class="fundx-chips">' + CHIPS.map(function (c) { return '<span class="fundx-chip" data-chip="' + c.k + '">' + c.l + '</span>'; }).join("") + '</div>' +
        '</div>' +
        '<div id="fundxFlash" class="fundx-flash"></div>' +
      '</div>';
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
    var reasonNames = { poor_focus: "Focus", poor_exposure: "Exposure", excessive_reflection: "Reflection/glare", retina_not_visible: "Retina not visible", disc_not_visible: "Optic disc not visible", macula_not_visible: "Macula not visible", field_of_view_inadequate: "Field of view" };
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
        '<div class="fundx-qbars">' + bar("Focus", s.focus) + bar("Exposure", s.exposure) + bar("Low glare", s.reflection) + bar("Retina", s.retinaVisibility) + bar("Optic disc", s.discVisibility) + bar("Macula", s.maculaVisibility) + bar("Field of view", s.fieldOfView) + '</div>' +
        '<div class="fundx-actions">' +
          '<button class="fundx-btn ghost" data-fx="retake">' + ric("refresh") + 'Retake</button>' +
          '<button class="fundx-btn" data-fx="toresult">' + (acc ? "Continue" : "Use anyway") + ric("chevron_right") + '</button>' +
        '</div>' +
        '<p class="fundx-disc">' + DISCLAIMER + '</p>' +
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
        '<div class="fundx-actions">' +
          '<button class="fundx-btn ghost" data-fx="discard">' + ric("delete") + 'Discard</button>' +
          '<button class="fundx-btn" data-fx="save">' + ric("save") + 'Save to patient</button>' +
        '</div>' +
        '<p class="fundx-disc">' + esc(f.disclaimer || DISCLAIMER) + '</p>' +
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
        '<div class="fundx-actions"><button class="fundx-btn ghost" data-fx="deletescan" data-id="' + esc(m.id) + '">' + ric("delete") + 'Delete scan</button></div>' +
        '<p class="fundx-disc">' + esc(f.disclaimer || DISCLAIMER) + '</p>' +
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
    var V0 = V().STATE, map = {}; map[V0.SEARCHING_EYE] = "Finding the eye"; map[V0.CENTERING_PUPIL] = "Centering the pupil"; map[V0.DETECTING_LENS] = "Detecting the lens"; map[V0.ALIGNING] = "Aligning"; map[V0.RED_REFLEX] = "Finding red reflex"; map[V0.RETINA] = "Retina in view"; map[V0.OPTIMIZING] = "Improving image"; map[V0.FRAMING] = "Framing"; map[V0.READY] = "Hold — capturing"; map[V0.CAPTURING] = "Capturing"; return map[s] || s;
  }
  function startCamera() {
    var Vd = DET(); if (!Vd) { toast("FundX perception layer not loaded."); return; }
    screen = "camera"; capturing = false; lastHapticState = "";
    session = session || newSession("right");
    render();
    var video = document.getElementById("fundxVideo");
    sm = V().createStateMachine();
    cam = Vd.makeCamera();
    cam.start(video, onFrame, { hub: (hub = Vd.makeHub()), analyzeEveryMs: 110, analyzeScale: 0.25 })
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
    if (step.shouldCapture) triggerCapture();
  }
  function updateCameraUI(step, fa) {
    var cue = V().Coach.cueFor(step.state, fa, step.readiness);
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

  function runProcessing(burst) {
    screen = "processing"; render();
    var tx = document.getElementById("fundxProcTx");
    setTimeout(function () { if (tx) tx.textContent = "Scoring image quality…"; }, 500);
    setTimeout(function () { if (tx) tx.textContent = "Generating structured findings…"; }, 1100);
    setTimeout(function () {
      result = FUNDX._buildResult(burst, ctx, session.eye, session);
      if (!result) { toast("No usable frames — try again."); screen = "camera"; return startCamera(); }
      screen = "review"; render();
    }, 1600);
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
      case "startcam": haptic("medium"); return startCamera();
      case "camclose": stopCamera(); haptic("light"); return show("home");
      case "voice": VOICE.setEnabled(!VOICE.enabled()); haptic("selection"); { var vb = document.getElementById("fundxVoiceBtn"); if (vb) { vb.classList.toggle("on", VOICE.enabled()); vb.innerHTML = ric(VOICE.enabled() ? "volume_up" : "volume_off"); } if (VOICE.enabled()) VOICE.speak("Voice coaching on"); } return;
      case "retake": haptic("light"); result = null; session.retries++; return startCamera();
      case "toresult": haptic("medium"); return show("result");
      case "review": return show("review");
      case "discard": haptic("light"); result = null; return show("home");
      case "save": return saveScan();
      case "training": haptic("light"); return toast("Guided Training Mode arrives in a later milestone.");
      case "gallery": haptic("light"); { var rc = document.getElementById("fundxRecent"); if (rc && rc.scrollIntoView) rc.scrollIntoView({ behavior: "smooth" }); } return toast("Your recent scans are listed below.");
      case "open": haptic("light"); return openDetail(b.getAttribute("data-id"));
      case "deletescan": haptic("light"); return deleteScan(b.getAttribute("data-id"));
    }
  }

  var FUNDX = {
    open: function (context) {
      ctx = context || null; screen = "home"; session = null; result = null; capturing = false;
      if (!rootEl) { rootEl = document.createElement("div"); rootEl.id = "fundxRoot"; document.body.appendChild(rootEl); rootEl.addEventListener("click", onClick); }
      render(); rootEl.classList.add("on"); document.body.style.overflow = "hidden"; haptic("tap");
    },
    close: function () { stopCamera(); if (rootEl) rootEl.classList.remove("on"); document.body.style.overflow = ""; haptic("tap"); },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
    enabled: function () { return true; },
    _screen: function () { return screen; },
    _buildResult: _buildResult,
    _buildScanRecord: _buildScanRecord
  };
  window.FUNDX = FUNDX;
})();
