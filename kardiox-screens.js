/* kardiox-screens.js — KardioX AI · all 18 screens (02-19) + router.
 * ASSEMBLED from the M2/M3/M4 screen workflows (each screen adversarially verified for #kardioxRoot/
 * .kx-* scoping + copy fidelity + ctx data-binding) + a hand-written router that owns navigation
 * (with a back stack), the mock analysis pipeline, RuleValidator fusion on the report, Clear-local-ECGs,
 * bookmark/confidence toggles, and the sign-out wipe hook. De-dashed. window.SMD_KARDIOX_ROUTER.
 */
(function () {
  "use strict";
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function haptic(k) { try { if (window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_haptics") && window.SMD_HAPTICS && window.SMD_HAPTICS[k]) window.SMD_HAPTICS[k](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); else if (window.SMD_toast) SMD_toast(m); } catch (e) {} }

  /* landing */
  /* Screen 02 · Module landing.
   * host = #kxScroll; ctx = { providers, analysis, nav(id), close() }.
   * Renders the handoff-exact landing, then hydrates counts + Recent from ctx.providers.
   * ic() (Material Symbols span) is provided by the kardiox.js module scope.
   * Navigation is delegation-only via data-act (the router's #kardioxRoot listener handles it);
   * this screen adds NO document/global listeners. */
  function renderLanding(host, ctx) {
    if (!host) return;
    ctx = ctx || {};
    var P = ctx.providers ||
      (typeof window !== "undefined" && window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_PROVIDERS.current()) ||
      null;
  
    // Severity presentation - COLOR (via .kx-pill--*) + ICON + LABEL, never colour alone.
    var SEV = {
      critical: { label: "Critical", icon: "crisis_alert" },
      urgent:   { label: "Urgent",   icon: "priority_high" },
      warn:     { label: "Caution",  icon: "warning" },
      stable:   { label: "Stable",   icon: "check_circle" },
      info:     { label: "Info",     icon: "info" }
    };
  
    // Mini-trace polylines lifted verbatim from KardioX AI.dc.html (AF = jagged/irregular, NSR = regular).
    var DEMO = [
      { id: "kx-mock-af-rvr", title: "Atrial fibrillation", meta: "Today · 08:12 · Bed 14", severity: "urgent",
        trace: "0,20 10,20 14,16 18,20 22,25 25,5 28,30 31,20 40,20 46,14 52,20 60,20" },
      { id: "demo-nsr", title: "Normal sinus rhythm", meta: "Yesterday · 17:40", severity: "stable",
        trace: "0,20 8,20 12,16 16,20 20,22 23,7 26,28 29,20 38,20 44,13 50,20 60,20" }
    ];
    var DEFAULT_TRACE = "0,20 9,20 13,16 17,20 21,23 24,6 27,29 30,20 39,20 45,13 51,20 60,20";
  
    var TILES = [
      { act: "kardiox-learn",   icon: "school",  ic2: "",                    title: "Learn ECG",      sub: '<span data-hook="learn-total">100</span> core cases' },
      { act: "kardiox-daily",   icon: "bolt",    ic2: " kx-tile-ic--cardiac", title: "Daily Challenge", sub: 'Streak · <span data-hook="streak">12</span> days' },
      { act: "kardiox-history", icon: "history", ic2: "",                    title: "History",        sub: '<span data-hook="history">24</span> ECGs' },
      { act: "kardiox-quiz",    icon: "quiz",    ic2: "",                    title: "Quiz Mode",      sub: "Test yourself" }
    ];
  
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function noop() {}
  
    function recRow(r) {
      var sev = SEV[r.severity] || SEV.info;
      var pts = r.trace || DEFAULT_TRACE;
      return "" +
        '<button class="kx-rec" type="button" data-act="kardiox-open" data-id="' + esc(r.id) + '" ' +
          'aria-label="' + esc(r.title) + ", " + sev.label + ' - open analysis">' +
          '<span class="kx-rec-thumb" aria-hidden="true">' +
            '<svg viewBox="0 0 60 40" width="46" height="46">' +
              '<polyline class="kx-trace kx-trace--' + esc(r.severity) + '" points="' + pts + '"></polyline>' +
            "</svg>" +
          "</span>" +
          '<span class="kx-rec-body">' +
            '<b class="kx-rec-title">' + esc(r.title) + "</b>" +
            '<span class="kx-rec-meta">' + esc(r.meta) + "</span>" +
          "</span>" +
          '<span class="kx-pill kx-pill--' + esc(r.severity) + '">' + ic(sev.icon) +
            '<span class="kx-data">' + sev.label + "</span></span>" +
        "</button>";
    }
    function emptyState() {
      return "" +
        '<div class="kx-empty">' +
          '<span class="kx-empty-ic" aria-hidden="true">' + ic("monitor_heart") + "</span>" +
          '<b class="kx-empty-title">No analyses yet</b>' +
          '<span class="kx-empty-sub">Analyze an ECG to see it here.</span>' +
        "</div>";
    }
  
    var header = "" +
      '<header class="kx-land-head">' +
        '<button class="kx-land-close" type="button" data-act="kardiox-close" aria-label="Close KardioX">' + ic("close") + "</button>" +
        '<div class="kx-land-titles">' +
          '<div class="kx-land-title">KardioX<span> AI</span></div>' +
          '<div class="kx-land-sub">ECG interpretation &amp; learning</div>' +
        "</div>" +
        '<button class="kx-land-gear" type="button" data-act="kardiox-settings" aria-label="KardioX settings">' + ic("settings") + "</button>" +
      "</header>";
  
    var cta = "" +
      '<button class="kx-cta" type="button" data-act="kardiox-add">' +
        '<span class="kx-cta-ic" aria-hidden="true">' + ic("add_a_photo") + "</span>" +
        '<span class="kx-cta-txt">' +
          '<b class="kx-cta-title">Analyze an ECG</b>' +
          '<span class="kx-cta-sub">Camera, photo, file or PDF</span>' +
        "</span>" +
        '<span class="kx-cta-go" aria-hidden="true">' + ic("arrow_forward") + "</span>" +
      "</button>";
  
    var grid = '<div class="kx-grid">' + TILES.map(function (t) {
      return "" +
        '<button class="kx-tile" type="button" data-act="' + t.act + '">' +
          '<span class="kx-tile-ic' + t.ic2 + '" aria-hidden="true">' + ic(t.icon) + "</span>" +
          '<span class="kx-tile-title">' + t.title + "</span>" +
          '<span class="kx-tile-sub">' + t.sub + "</span>" +
        "</button>";
    }).join("") + "</div>";
  
    var secHead = "" +
      '<div class="kx-sec-head">' +
        '<span class="kx-sec-title">Recent analyses</span>' +
        '<button class="kx-seeall" type="button" data-act="kardiox-history">See all</button>' +
      "</div>";
  
    var recent = '<div class="kx-recent" data-hook="recent">' + DEMO.map(recRow).join("") + "</div>";
  
    var foot = '<div class="kx-foot">' + ic("verified_user") + "ECGs stay on your device</div>";
  
    host.innerHTML = header +
      '<div class="kx-landing">' + cta + grid + secHead + recent + foot + "</div>";
  
    /* ── Async hydration (providers are async; render is sync). Only overwrite when data is present so
          the handoff-exact defaults survive in mock/preview; live-empty shows a real empty state. ── */
    function setHook(name, val) {
      if (val == null) return;
      var n = host.querySelector('[data-hook="' + name + '"]');
      if (n) n.textContent = String(val);
    }
    function toRow(a) {
      return {
        id: a.id,
        title: a.verdict || "ECG analysis",
        meta: [a.createdAt, a.context].filter(Boolean).join(" · "),
        severity: a.severity || "info"
      };
    }
    if (P) {
      try {
        if (P.learning && P.learning.progress) {
          Promise.resolve(P.learning.progress()).then(function (pr) {
            if (!pr) return;
            setHook("streak", pr.streakDays);
            setHook("learn-total", pr.total);
          }).catch(noop);
        }
        if (P.ecgStore && P.ecgStore.all) {
          Promise.resolve(P.ecgStore.all()).then(function (list) {
            list = Array.isArray(list) ? list : [];
            var box = host.querySelector('[data-hook="recent"]');
            if (list.length) {
              setHook("history", list.length);
              if (box) box.innerHTML = list.slice(-2).reverse().map(function (a) { return recRow(toRow(a)); }).join("");
            } else if (P.kind !== "mock") {
              setHook("history", 0);
              if (box) box.innerHTML = emptyState();
            }
          }).catch(noop);
        }
      } catch (e) {}
    }
  }

  /* source */
  function render03(host, ctx) {
    ctx = ctx || {};
  
    // One source tile: icon + name + hint. Declares intent via data-act/data-source
    // so the module router (kardiox.js) drives navigation - no local document listeners.
    function srcCard(source, icon, name, hint, mod) {
      return '<button type="button" class="kx-src-card' + (mod ? ' ' + mod : '') + '"' +
               ' data-act="kx-source" data-source="' + source + '"' +
               ' aria-label="' + name + ' - ' + hint + '">' +
               '<span class="kx-src-ic">' + ic(icon) + '</span>' +
               '<span class="kx-src-name">' + name + '</span>' +
               '<span class="kx-src-hint">' + hint + '</span>' +
             '</button>';
    }
  
    host.innerHTML =
      '<section class="kx-src" aria-labelledby="kxSrcTitle">' +
  
        // Screen header - back + title (matches the in-app header in the handoff, not the phone chrome).
        '<div class="kx-src-head">' +
          '<button type="button" class="kx-src-back" data-act="kardiox-back" aria-label="Back">' +
            ic('arrow_back') +
          '</button>' +
          '<h2 class="kx-src-title" id="kxSrcTitle">Add an ECG</h2>' +
        '</div>' +
  
        '<div class="kx-src-body">' +
  
          // Dashed drop-zone (drag target on iPad; sources below are the tap actions).
          '<div class="kx-drop" role="group" aria-label="Drop an ECG here. Drag and drop on iPad, or choose a source below.">' +
            '<span class="kx-drop-ic">' + ic('upload_file') + '</span>' +
            '<b class="kx-drop-title">Drop an ECG here</b>' +
            '<span class="kx-drop-sub">Drag &amp; drop on iPad, or choose a source below</span>' +
          '</div>' +
  
          // 2x2 source cards.
          '<div class="kx-src-grid">' +
            srcCard('camera',  'photo_camera',   'Camera',        'Guided capture') +
            srcCard('library', 'photo_library',  'Photo Library', 'Pick an image') +
            srcCard('files',   'folder',         'Files',         'Browse iCloud') +
            srcCard('pdf',     'picture_as_pdf', 'Scan PDF',      'Multi-page', 'kx-src-card--pdf') +
          '</div>' +
  
          // Blue capture tip (color + icon + label).
          '<div class="kx-tip" role="note">' +
            '<span class="kx-tip-ic">' + ic('tips_and_updates') + '</span>' +
            '<span class="kx-tip-txt">Capture all 12 leads. Keep the paper flat, fill the frame, avoid glare - KardioX auto-deskews and enhances.</span>' +
          '</div>' +
  
          // Privacy footer.
          '<div class="kx-src-foot">' + ic('lock') + 'Encrypted upload · deleted after analysis</div>' +
  
        '</div>' +
      '</section>';
  }

  /* permission */
  function render16(host, ctx) {
    // Screen 16 · Camera permission - dark scrim + bottom sheet.
    // Static consent prompt: no analysis values to bind from ctx. Navigation is
    // delegated to the router via data-act (Allow -> proceed to capture; Not now /
    // scrim tap -> dismiss). No document listeners added here.
    host.innerHTML =
      '<div class="kx-perm" role="dialog" aria-modal="true" aria-labelledby="kxPermTitle" aria-describedby="kxPermBody">' +
        '<button class="kx-perm-scrim" type="button" data-act="kardiox-cam-deny" aria-label="Dismiss"></button>' +
        '<div class="kx-perm-sheet" role="document">' +
          '<span class="kx-perm-icon">' + ic('photo_camera') + '</span>' +
          '<h2 class="kx-perm-title" id="kxPermTitle">Allow camera access?</h2>' +
          '<p class="kx-perm-body" id="kxPermBody">KardioX uses the camera to capture ECG tracings for analysis. Images are processed then deleted - nothing is saved to your camera roll.</p>' +
          '<div class="kx-perm-assure">' + ic('lock') + '<span>Encrypted &amp; deleted after use</span></div>' +
          '<button class="kx-perm-allow" type="button" data-act="kardiox-cam-allow">Allow camera</button>' +
          '<button class="kx-perm-deny" type="button" data-act="kardiox-cam-deny">Not now</button>' +
        '</div>' +
      '</div>';
  }

  /* processing */
  function render04(host, ctx){
    ctx = ctx || {};
  
    // ── Pipeline model ──────────────────────────────────────────────────────────
    // The 5-step checklist mirrors the enhancement/digitization sub-pipeline (README
    // Processing Pipeline · stages 2–3). `fail` names the step for graceful errors.
    var STEPS = [
      { label: 'Deskew & crop',            fail: 'deskew & crop the ECG' },
      { label: 'Enhance contrast',         fail: 'enhance contrast' },
      { label: 'Remove glare & gridlines', fail: 'remove glare & gridlines' },
      { label: 'Detect 12 leads',          fail: 'detect the 12 leads' },
      { label: 'Digitise signal',          fail: 'digitise the signal' }
    ];
    // Analyzer streams 13 global stages; map the relevant ones onto the visible rows.
    var STAGE_TO_STEP = { upload: 0, enhancement: 2, digitization: 3, signalExtraction: 4 };
    var DESIGN_STEP = 2;   // dc.html ships the frame: rows 0–1 done, glare active → 60%.
  
    function ico(name, cls){
      return '<span class="material-symbols-rounded ' + (cls || '') + '" aria-hidden="true">' + name + '</span>';
    }
    function row(i, stateCls, glyph){
      return '<li class="kx-proc-step ' + stateCls + '">' +
               '<span class="kx-proc-step-ico" data-ico>' + glyph + '</span>' +
               '<span class="kx-proc-step-label">' + STEPS[i].label + '</span>' +
             '</li>';
    }
  
    host.innerHTML =
      '<section class="kx-proc" aria-label="Preparing your ECG">' +
        '<header class="kx-proc-head">' +
          '<button class="kx-proc-close" type="button" data-act="kardiox-close" aria-label="Cancel processing">' +
            ico('close') +
          '</button>' +
          '<h2 class="kx-proc-title">Preparing your ECG</h2>' +
        '</header>' +
        '<div class="kx-proc-body">' +
          '<div class="kx-proc-preview" role="img" aria-label="ECG being enhanced on-device">' +
            '<svg class="kx-proc-svg" viewBox="0 0 320 240" preserveAspectRatio="none" aria-hidden="true">' +
              '<defs>' +
                '<pattern id="kx-egrid" width="16" height="16" patternUnits="userSpaceOnUse">' +
                  '<path class="kx-proc-gridline" d="M16 0H0V16" fill="none"/>' +
                '</pattern>' +
              '</defs>' +
              '<rect width="320" height="240" fill="url(#kx-egrid)"/>' +
              '<polyline class="kx-proc-trace" fill="none" points="0,120 30,120 40,108 50,120 60,120 66,132 72,60 78,150 84,120 100,120 112,100 124,120 140,120 170,120 180,108 190,120 200,120 206,132 212,60 218,150 224,120 240,120 252,100 264,120 280,120 300,120 320,120"/>' +
            '</svg>' +
            '<div class="kx-proc-sweep" aria-hidden="true"></div>' +
            '<span class="kx-proc-badge" data-badge>ENHANCING</span>' +
          '</div>' +
          '<div class="kx-proc-progress">' +
            '<div class="kx-proc-progress-row">' +
              '<span class="kx-proc-progress-label">On-device pipeline</span>' +
              '<span class="kx-proc-progress-pct kx-data" data-pct>60%</span>' +
            '</div>' +
            '<div class="kx-proc-track" role="progressbar" aria-label="On-device pipeline progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60" data-track>' +
              '<div class="kx-proc-bar" data-bar></div>' +
            '</div>' +
          '</div>' +
          '<ol class="kx-proc-steps">' +
            row(0, 'is-done',    'check_circle') +
            row(1, 'is-done',    'check_circle') +
            row(2, 'is-active',  'progress_activity') +
            row(3, 'is-pending', 'radio_button_unchecked') +
            row(4, 'is-pending', 'radio_button_unchecked') +
          '</ol>' +
          '<div class="kx-proc-fail" data-fail hidden>' +
            '<div class="kx-proc-fail-head">' + ico('error', 'kx-proc-fail-ico') +
              '<span data-fail-msg></span></div>' +
            '<div class="kx-proc-fail-acts">' +
              '<button class="kx-btn kx-btn-primary" type="button" data-act="kardiox-retry">' + ico('refresh') + 'Try again</button>' +
              '<button class="kx-btn kx-btn-secondary" type="button" data-act="kardiox-pick">Choose another photo</button>' +
            '</div>' +
          '</div>' +
          '<p class="kx-proc-live" data-live aria-live="polite"></p>' +
        '</div>' +
      '</section>';
  
    // ── Refs ─────────────────────────────────────────────────────────────────────
    var rootEl = host.querySelector('.kx-proc');
    var rows   = Array.prototype.slice.call(host.querySelectorAll('.kx-proc-step'));
    var barEl  = host.querySelector('[data-bar]');
    var trackEl= host.querySelector('[data-track]');
    var pctEl  = host.querySelector('[data-pct]');
    var badgeEl= host.querySelector('[data-badge]');
    var failEl = host.querySelector('[data-fail]');
    var liveEl = host.querySelector('[data-live]');
  
    var current = -1;
    var timer = null;
  
    function alive(){ return !!(rootEl && rootEl.isConnected && host.contains(rootEl)); }
    function stop(){ if (timer){ clearInterval(timer); timer = null; } }
  
    function setPct(p){
      p = Math.max(0, Math.min(100, Math.round(p)));
      if (barEl) barEl.style.width = p + '%';
      if (pctEl) pctEl.textContent = p + '%';
      if (trackEl) trackEl.setAttribute('aria-valuenow', String(p));
    }
  
    function applyStep(n){
      n = Math.max(current, Math.min(n, STEPS.length));   // monotonic - never regress
      current = n;
      rows.forEach(function(li, i){
        var g = li.querySelector('[data-ico]');
        li.classList.remove('is-done', 'is-active', 'is-pending', 'is-error');
        if (i < n){ li.classList.add('is-done'); g.textContent = 'check_circle'; }
        else if (i === n){ li.classList.add('is-active'); g.textContent = 'progress_activity'; }
        else { li.classList.add('is-pending'); g.textContent = 'radio_button_unchecked'; }
      });
      var done = n >= STEPS.length;
      setPct(done ? 100 : (n + 1) * 20);                  // step 2 (glare) → 60%, matches design
      if (liveEl) liveEl.textContent = done ? 'Enhancement complete' : STEPS[n].label + ' in progress';
    }
  
    function applyError(stepIndex, failText){
      stop();
      var li = rows[stepIndex] || rows[current] || rows[0];
      li.classList.remove('is-done', 'is-active', 'is-pending');
      li.classList.add('is-error');
      li.querySelector('[data-ico]').textContent = 'error';
      if (badgeEl){ badgeEl.textContent = 'PAUSED'; badgeEl.classList.add('is-error'); }
      if (failEl){
        var msg = failEl.querySelector('[data-fail-msg]');
        if (msg) msg.textContent = "Couldn't " + failText + ". The photo may be blurry, cropped, or low-contrast.";
        failEl.hidden = false;
      }
      if (liveEl) liveEl.textContent = "Processing paused: couldn't " + failText;
    }
  
    // ── Drive ──────────────────────────────────────────────────────────────────────
    applyStep(DESIGN_STEP);   // baseline = the shipped design frame
  
    function toStep(stage){
      return STAGE_TO_STEP.hasOwnProperty(stage) ? STAGE_TO_STEP[stage] : STEPS.length;
    }
  
    function demo(){
      stop();
      timer = setInterval(function(){
        if (!alive()){ stop(); return; }
        applyStep(current + 1);
        if (current >= STEPS.length){ stop(); if (typeof ctx.nav === 'function') ctx.nav('05'); }
      }, 900);
    }
  
    var providers = (ctx.providers && typeof ctx.providers.current === 'function') ? ctx.providers.current() : ctx.providers;
    var analyzer  = providers && providers.analyzer;
    var img = ctx.image || ctx.asset || ctx.source || (ctx.analysis && ctx.analysis.image);
  
    if (analyzer && typeof analyzer.analyze === 'function' && img){
      try {
        var p = analyzer.analyze(img, function(stage, pct){
          if (!alive()) return;
          applyStep(toStep(stage));
        });
        if (p && typeof p.then === 'function'){
          p.then(function(analysis){
            if (!alive()) return;
            applyStep(STEPS.length);
            if (analysis && typeof ctx.setAnalysis === 'function') ctx.setAnalysis(analysis);
            if (typeof ctx.nav === 'function') ctx.nav('05');
          }).catch(function(err){
            if (!alive()) return;
            var idx = (err && typeof err.stepIndex === 'number') ? err.stepIndex : current;
            applyError(idx, (STEPS[idx] || STEPS[0]).fail);
          });
        } else { demo(); }
      } catch (e){ demo(); }
    } else {
      demo();
    }
  }

  /* analysis */
  function render05(host, ctx) {
    ctx = ctx || {};
    var A = ctx.analysis || {};
  
    // Material Symbols glyph (same helper contract as the rest of the module).
    function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  
    // Confidence: accept 0..1 (canonical ECGAnalysis.confidence) or 0..100 → integer percent.
    var rawConf = typeof A.confidence === 'number' ? A.confidence : 0.94;
    var conf = Math.max(0, Math.min(100, Math.round(rawConf <= 1 ? rawConf * 100 : rawConf)));
  
    // Lead count for the headline ("Analysing 12 leads…").
    var leads = A.leadCount || A.leads || 12;
  
    // Staged pipeline. The analyzer/router feeds A.stages ({label,state,pct}); otherwise render the
    // canonical live snapshot from the design handoff (screen 05): two done, one active, one pending.
    var stages = (Array.isArray(A.stages) && A.stages.length) ? A.stages : [
      { label: 'Rhythm & rate',         state: 'done',    pct: 100 },
      { label: 'Intervals (PR·QRS·QT)', state: 'done',    pct: 100 },
      { label: 'Morphology & axis',     state: 'active',  pct: 72  },
      { label: 'ST-segment & T-waves',  state: 'pending', pct: 0   }
    ];
  
    var ICONS = { done: 'check_circle', active: 'progress_activity', pending: 'radio_button_unchecked' };
  
    function stageRow(s) {
      var st = ICONS[s.state] ? s.state : 'pending';
      var pct = typeof s.pct === 'number' ? Math.max(0, Math.min(100, s.pct)) : (st === 'done' ? 100 : 0);
      var value = st === 'done' ? 'done' : st === 'active' ? (Math.round(pct) + '%') : '-';
      return '' +
        '<div class="kx-stage is-' + st + '">' +
          '<div class="kx-stage-head">' +
            '<span class="kx-stage-name">' + ic(ICONS[st]) + esc(s.label) + '</span>' +
            '<span class="kx-stage-val kx-data">' + esc(value) + '</span>' +
          '</div>' +
          '<div class="kx-stage-track"><div class="kx-stage-fill" data-pct="' + pct + '"></div></div>' +
        '</div>';
    }
  
    host.innerHTML =
      '<section class="kx-analysis">' +
        '<div class="kx-analysis-inner" role="status" aria-live="polite">' +
          '<div class="kx-conf-ring" role="img" aria-label="Analysis confidence ' + conf + ' percent">' +
            '<svg class="kx-conf-svg" viewBox="0 0 120 120" aria-hidden="true">' +
              '<circle class="kx-conf-track" cx="60" cy="60" r="52"></circle>' +
              '<circle class="kx-conf-arc" cx="60" cy="60" r="52"></circle>' +
            '</svg>' +
            '<div class="kx-conf-center">' +
              '<span class="kx-conf-val kx-data">' + conf + '</span>' +
              '<span class="kx-conf-cap">CONFIDENCE</span>' +
            '</div>' +
          '</div>' +
          '<h2 class="kx-analysis-title">Analysing ' + leads + ' leads…</h2>' +
          '<p class="kx-analysis-sub">KardioX is reading rhythm, rate &amp; morphology</p>' +
          '<div class="kx-stages">' + stages.map(stageRow).join('') + '</div>' +
          '<div class="kx-analysis-foot">' + ic('lock') + '<span>Encrypted · deleted immediately after analysis</span></div>' +
        '</div>' +
      '</section>';
  
    // Runtime scalars only (all styling stays in the cssBlock): the ring arc offset and each bar
    // fill width. stroke-dashoffset is an SVG presentation attribute; the width/offset animate via
    // the CSS transitions (frozen under prefers-reduced-motion). raf() lets the reveal play from empty.
    var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
    var C = 2 * Math.PI * 52; // ring circumference ≈ 326.73 (r = 52 in the 120×120 viewBox)
    var arc = host.querySelector('.kx-conf-arc');
    if (arc) {
      arc.setAttribute('stroke-dasharray', C.toFixed(2));
      arc.setAttribute('stroke-dashoffset', C.toFixed(2)); // start empty, then draw to the confidence value
      raf(function () { arc.setAttribute('stroke-dashoffset', (C * (1 - conf / 100)).toFixed(2)); });
    }
    Array.prototype.forEach.call(host.querySelectorAll('.kx-stage-fill'), function (f) {
      var p = parseFloat(f.getAttribute('data-pct')) || 0;
      raf(function () { f.style.width = p + '%'; });
    });
  }

  /* report */
  function render06(host, ctx){
    ctx = ctx || {};
    var a = ctx.analysis;
    if ((!a || !a.verdict) && typeof window !== "undefined" && window.SMD_KARDIOX_MODELS) {
      try { a = window.SMD_KARDIOX_MODELS.makeAnalysis(window.SMD_KARDIOX_MODELS.samples.afWithRvr); } catch (e) {}
    }
  
    function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  
    var sub = [a && a.createdAt, a && a.context].filter(Boolean).join(" · ");
    var head =
      '<div class="kx-rpt-head">' +
        '<button class="kx-rpt-back" type="button" data-act="kxnav:back" aria-label="Back">' + ic("arrow_back") + '</button>' +
        '<div class="kx-rpt-titles">' +
          '<div class="kx-rpt-title">AI Report</div>' +
          (sub ? '<div class="kx-rpt-sub">' + esc(sub) + '</div>' : '') +
        '</div>' +
        '<button class="kx-rpt-share" type="button" data-act="kxnav:share" aria-label="Share report">' + ic("ios_share") + '</button>' +
      '</div>';
  
    function wire(hostEl, c){
      hostEl._kx06ctx = c;
      if (hostEl._kx06Bound) return;
      hostEl._kx06Bound = true;
      hostEl.addEventListener("click", function(e){
        var el = e.target.closest && e.target.closest('[data-act^="kxnav:"]');
        if (!el || !hostEl.contains(el)) return;
        var target = el.getAttribute("data-act").slice(6);
        var cur = hostEl._kx06ctx || {};
        if (typeof cur.nav === "function") cur.nav(target);
      });
    }
  
    if (!a || !a.verdict) {
      host.innerHTML = head +
        '<div class="kx-rpt-empty">' + ic("monitor_heart") +
          '<div class="kx-rpt-empty-t">No analysis to show</div>' +
          '<div class="kx-rpt-empty-s">Analyze an ECG to generate an AI report.</div>' +
        '</div>';
      wire(host, ctx);
      return;
    }
  
    var SEV = {
      critical: { label: "Critical", icon: "crisis_alert" },
      urgent:   { label: "Urgent",   icon: "priority_high" },
      warn:     { label: "Caution",  icon: "warning" },
      stable:   { label: "Stable",   icon: "check_circle" },
      info:     { label: "Info",     icon: "info" }
    };
    var sevKey = SEV[a.severity] ? a.severity : "info";
    var sev = SEV[sevKey];
    var pct = Math.max(0, Math.min(100, Math.round((a.confidence || 0) * 100)));
  
    var mm = a.measurements || {};
    function fmtAxis(d){ return d == null ? "-" : (d > 0 ? "+" : "") + d + "°"; }
    function shortRhythm(r){ r = String(r || ""); if (/irreg/i.test(r)) return "Irreg"; if (/sinus/i.test(r)) return "Sinus";
      var w = (r.split(/[\s.]+/)[0] || "-"); return w.charAt(0).toUpperCase() + w.slice(1, 6); }
  
    var metrics = [];
    (function(){ var v = mm.ventRateBpm;
      if (v == null) metrics.push({ k:"Vent. rate", v:"-", s:"bpm", t:"muted" });
      else { var t = v > 100 ? "urgent" : (v < 60 ? "warn" : "neutral"); var tag = v > 100 ? "high" : (v < 60 ? "low" : "normal");
        metrics.push({ k:"Vent. rate", v:String(v), s:"bpm · " + tag, t:t }); } })();
    metrics.push({ k:"Rhythm", v:shortRhythm(mm.rhythm), s:String(mm.rhythm || "").toLowerCase(), t:"neutral" });
    (function(){ if (mm.prMs == null) metrics.push({ k:"PR", v:"-", s:"no P waves", t:"muted" });
      else { var v = mm.prMs, ab = (v < 120 || v > 200); metrics.push({ k:"PR", v:String(v), s:"ms · " + (ab ? "abnormal" : "normal"), t:ab ? "warn" : "neutral" }); } })();
    (function(){ var v = mm.qrsMs; if (v == null) metrics.push({ k:"QRS", v:"-", s:"ms", t:"muted" });
      else { var wide = v >= 120; metrics.push({ k:"QRS", v:String(v), s:"ms · " + (wide ? "wide" : "normal"), t:wide ? "warn" : "stable" }); } })();
    (function(){ var v = mm.qtcMs; if (v == null) metrics.push({ k:"QTc", v:"-", s:"ms", t:"muted" });
      else { var t, tag; if (v >= 500) { t = "urgent"; tag = "prolonged"; } else if (v >= 450) { t = "warn"; tag = "borderline"; } else { t = "stable"; tag = "normal"; }
        metrics.push({ k:"QTc", v:String(v), s:"ms · " + tag, t:t }); } })();
    (function(){ var v = mm.axisDeg; if (v == null) metrics.push({ k:"Axis", v:"-", s:"-", t:"muted" });
      else { var norm = (v >= -30 && v <= 90); metrics.push({ k:"Axis", v:fmtAxis(v), s:norm ? "normal" : (v > 90 ? "right deviation" : "left deviation"), t:norm ? "neutral" : "warn" }); } })();
  
    var TONE = { urgent:"kx-metric--urgent", stable:"kx-metric--stable", warn:"kx-metric--warn", muted:"kx-metric--muted", neutral:"" };
    var metricsHtml = metrics.map(function(c){
      return '<div class="kx-metric ' + (TONE[c.t] || "") + '">' +
        '<div class="kx-metric-k">' + esc(c.k) + '</div>' +
        '<div class="kx-metric-v kx-data">' + esc(c.v) + '</div>' +
        '<div class="kx-metric-s">' + esc(c.s) + '</div>' +
      '</div>';
    }).join("");
  
    var morphHtml = (a.morphology || []).map(function(r){
      var label = r.label, val = r.value;
      if (/st[-\s]?segment/i.test(label)) {
        var s, mIcon;
        if (/no acute|normal|nil|none/i.test(val)) { s = "stable"; mIcon = "check_circle"; }
        else if (/elevat|depress|acute/i.test(val)) { s = "urgent"; mIcon = "warning"; }
        else { s = "info"; mIcon = "info"; }
        return '<div class="kx-morph-row"><span class="kx-morph-k">' + esc(label) + '</span>' +
          '<span class="kx-morph-pill kx-morph-pill--' + s + '">' + ic(mIcon) + esc(val) + '</span></div>';
      }
      return '<div class="kx-morph-row"><span class="kx-morph-k">' + esc(label) + '</span>' +
        '<b class="kx-morph-v kx-data">' + esc(val) + '</b></div>';
    }).join("");
  
    var strip =
      '<div class="kx-verdict-strip">' +
        '<svg class="kx-strip-svg" viewBox="0 0 320 90" width="100%" height="76" preserveAspectRatio="none" aria-hidden="true">' +
          '<defs>' +
            '<pattern id="kxRptPaperA" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="#f6d3d3" stroke-width="1"></path></pattern>' +
            '<pattern id="kxRptPaperB" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#eaa9a9" stroke-width="1"></path></pattern>' +
          '</defs>' +
          '<rect width="320" height="90" fill="url(#kxRptPaperA)"></rect><rect width="320" height="90" fill="url(#kxRptPaperB)"></rect>' +
          '<polyline points="0,55 8,53 16,56 24,54 30,55 33,58 36,30 39,66 42,55 50,54 58,56 66,53 74,55 82,56 86,55 88,55 91,58 94,30 97,66 100,55 112,54 122,56 128,55 130,55 133,58 136,32 139,66 142,55 160,54 178,56 196,55 200,55 203,58 206,31 209,66 212,55 230,54 246,56 250,55 253,58 256,30 259,66 262,55 280,54 296,55 300,55 303,58 306,31 309,66 312,55 320,55" fill="none" stroke="#161616" stroke-width="1.6" stroke-linejoin="round"></polyline>' +
        '</svg>' +
        '<div class="kx-strip-label kx-data">' + esc(a.leadStripLabel) + '</div>' +
      '</div>';
  
    var hero =
      '<div class="kx-verdict kx-verdict--' + sevKey + '">' +
        '<div class="kx-verdict-top">' +
          '<div class="kx-verdict-row">' +
            '<span class="kx-sev-pill">' + ic(sev.icon) + esc(sev.label) + '</span>' +
            '<span class="kx-ai-mark' + (a.demo ? ' kx-ai-mark--demo' : '') + '">' +
              ic(a.demo ? "science" : "auto_awesome") + (a.demo ? 'DEMO SAMPLE' : 'KardioX AI') + '</span>' +
          '</div>' +
          '<div class="kx-verdict-dx">' + esc(a.verdict) + '</div>' +
          (a.verdictQualifier ? '<div class="kx-verdict-qual">' + esc(a.verdictQualifier) + '</div>' : '') +
          '<div class="kx-conf">' +
            '<div class="kx-conf-bar" role="progressbar" aria-label="AI confidence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
              '<div class="kx-conf-fill"></div>' +
            '</div>' +
            '<span class="kx-conf-val kx-data">' + pct + '%</span>' +
          '</div>' +
          '<div class="kx-conf-band">Confidence · ' + esc(a.confidenceBand || "") + '</div>' +
        '</div>' +
        strip +
      '</div>';
  
    function section(icon, label){ return '<div class="kx-sec">' + ic(icon) + '<span class="kx-sec-t">' + label + '</span></div>'; }
  
    var redFlag = (a.redFlag && a.redFlag.title) ?
      '<div class="kx-redflag">' + ic("warning") +
        '<div><b class="kx-redflag-t">' + esc(a.redFlag.title) + '</b>' +
        '<span class="kx-redflag-b">' + esc(a.redFlag.body) + '</span></div>' +
      '</div>' : '';
  
    var learn = a.educationalRef ?
      '<button class="kx-learn" type="button" data-act="kxnav:' + esc(a.educationalRef) + '">' +
        ic("school") + '<span class="kx-learn-t">Learn: ' + esc(a.verdict) + '</span>' + ic("chevron_right") +
      '</button>' : '';
  
    var noteLabel = a.physicianNote ? a.physicianNote : "Add physician note";
  
    var demoBanner = a.demo ?
      '<div class="kx-demo-note" role="note">' + ic("science") +
        '<div><b>DEMO SAMPLE &mdash; not your ECG.</b> No validated AI model is connected, so this is a ' +
        'fixed example (the same for any or no image), not an analysis of what you uploaded. ' +
        'Do NOT use for any clinical decision.</div>' +
      '</div>' : '';

    var body =
      '<div class="kx-rpt-body">' +
        demoBanner +
        hero +
        section("straighten", "Measurements &amp; intervals") +
        '<div class="kx-metrics">' + metricsHtml + '</div>' +
        section("show_chart", "Morphology &amp; ST") +
        '<div class="kx-morph">' + morphHtml + '</div>' +
        section("clinical_notes", "Clinical interpretation") +
        '<div class="kx-interp">' + esc(a.clinicalInterpretation) + '</div>' +
        '<button class="kx-why" type="button" data-act="kxnav:why">' +
          ic("psychology") +
          '<span class="kx-why-txt"><b>Why this diagnosis?</b>' +
            '<span class="kx-why-sub">See the leads, criteria &amp; differentials</span></span>' +
          ic("chevron_right") +
        '</button>' +
        redFlag +
        learn +
        '<button class="kx-note" type="button" data-act="kxnav:note">' +
          ic("edit_note") + '<span class="kx-note-t">' + esc(noteLabel) + '</span>' +
        '</button>' +
        '<div class="kx-actions">' +
          '<button class="kx-btn kx-btn-primary" type="button" data-act="kxnav:export">' + ic("picture_as_pdf") + 'Export</button>' +
          '<button class="kx-btn kx-btn-secondary" type="button" data-act="kxnav:compare">' + ic("compare_arrows") + 'Compare</button>' +
        '</div>' +
        '<div class="kx-disc">' + ic("info") + 'AI decision support · not a diagnosis. Confirm clinically.</div>' +
      '</div>';
  
    host.innerHTML = head + body;
  
    var fill = host.querySelector(".kx-conf-fill");
    if (fill) fill.style.setProperty("--kx-conf", pct + "%");
  
    wire(host, ctx);
  }

  /* why */
  function render07(host, ctx){
    ctx = ctx || {};
    var analysis = ctx.analysis
      || (ctx.providers && ctx.providers.current && ctx.providers.current().analysis)
      || null;
  
    function esc(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
      });
    }
    function ic(name){ return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
    function fmtWeight(w){
      if (typeof w !== 'number' || isNaN(w)) return '';
      return (w >= 0 ? '+' : '−') + Math.abs(w).toFixed(2);
    }
    function pct(p){ return Math.round((typeof p === 'number' ? p : 0) * 100); }
    // Map a finding to an ECG highlight region ('rr' red box / 'fwave' blue box / '' none).
    function hlFor(f){
      var s = ((f && f.title || '') + ' ' + (f && f.detail || '')).toLowerCase();
      if (s.indexOf('r-r') > -1 || s.indexOf('r‑r') > -1 || s.indexOf('irregular') > -1) return 'rr';
      if (s.indexOf('f-wave') > -1 || s.indexOf('fwave') > -1 || s.indexOf('fibrill') > -1) return 'fwave';
      return '';
    }
  
    var verdict = analysis && analysis.verdict ? String(analysis.verdict) : '';
    var title = verdict ? ('Why ' + verdict.toLowerCase() + '?') : 'Why this diagnosis?';
  
    var findings = (analysis && analysis.findings || []).filter(function(f){ return f && f.matched; });
    var diffs = (analysis && analysis.differentials || []).slice();
    var verify = analysis && analysis.whatToVerify;
  
    // ── Matched criteria cards ──────────────────────────────────────────────
    var critHtml;
    if (findings.length) {
      critHtml = findings.map(function(f){
        var hl = hlFor(f);
        var w = fmtWeight(f.weight);
        return '<button type="button" class="kx-crit" data-hl="' + esc(hl) + '"' +
                 (hl ? ' aria-label="' + esc(f.title) + ' - highlight on ECG"' : '') + '>' +
                 '<span class="kx-crit-ic">' + ic('check_circle') + '</span>' +
                 '<span class="kx-crit-body">' +
                   '<b>' + esc(f.title) + '</b>' +
                   '<span>' + esc(f.detail || '') + '</span>' +
                 '</span>' +
                 (w ? '<span class="kx-crit-w kx-data">' + w + '</span>' : '') +
               '</button>';
      }).join('');
    } else {
      critHtml = '<div class="kx-empty">' + ic('rule') +
                 '<span>No matched criteria for this analysis.</span></div>';
    }
  
    // ── Differentials bars ──────────────────────────────────────────────────
    var diffsHtml = diffs.length
      ? diffs.map(function(d, i){
          var p = pct(d.probability);
          var primary = (i === 0);
          return '<div class="kx-diff' + (primary ? ' is-primary' : '') + '">' +
                   '<div class="kx-diff-top">' +
                     '<span class="kx-diff-label">' + esc(d.label) + '</span>' +
                     '<span class="kx-diff-pct kx-data">' + p + '%</span>' +
                   '</div>' +
                   '<div class="kx-diff-track"><div class="kx-diff-fill" style="width:' + p + '%"></div></div>' +
                 '</div>';
        }).join('')
      : '<div class="kx-empty">' + ic('insights') + '<span>No differentials recorded.</span></div>';
  
    // ── ECG region (art reproduced from the design; colors via CSS classes) ──
    var ecg =
      '<div class="kx-ecg">' +
        '<svg class="kx-ecg-svg" viewBox="0 0 320 120" width="100%" height="118" preserveAspectRatio="none" aria-hidden="true">' +
          '<defs><pattern id="kxEcgPaper07" width="8" height="8" patternUnits="userSpaceOnUse">' +
            '<path class="kx-ecg-grid" d="M8 0H0V8"></path></pattern></defs>' +
          '<rect width="320" height="120" fill="url(#kxEcgPaper07)"></rect>' +
          '<rect class="kx-hl kx-hl--rr" x="10" y="66" width="150" height="34" rx="6"></rect>' +
          '<rect class="kx-hl kx-hl--fwave" x="176" y="20" width="60" height="34" rx="6"></rect>' +
          '<polyline class="kx-ecg-trace" points="0,74 8,72 16,75 24,73 30,74 33,77 36,48 39,86 42,74 54,73 62,75 70,72 78,74 86,75 90,74 92,74 95,77 98,48 101,86 104,74 118,73 128,75 134,74 150,74 156,73 176,40 182,34 190,44 200,40 206,74 209,77 212,48 215,86 218,74 236,73 250,74 256,77 260,48 263,86 266,74 288,73 300,74 306,48 309,86 312,74 320,74"></polyline>' +
        '</svg>' +
        '<span class="kx-ecg-tag kx-ecg-tag--rr kx-data" data-hl="rr">Irregular R-R</span>' +
        '<span class="kx-ecg-tag kx-ecg-tag--fwave kx-data" data-hl="fwave">f-waves (V1)</span>' +
      '</div>';
  
    host.innerHTML =
      '<section class="kx-why">' +
        '<header class="kx-why-head">' +
          '<button type="button" class="kx-why-back" data-act="report" aria-label="Back to report">' + ic('arrow_back') + '</button>' +
          '<div class="kx-why-titles">' +
            '<h2>' + esc(title) + '</h2>' +
            '<p>Explainable AI · tap a finding</p>' +
          '</div>' +
        '</header>' +
  
        '<div class="kx-why-body">' +
          ecg +
  
          '<div class="kx-why-chips" role="tablist" aria-label="Explanation views">' +
            '<button type="button" class="kx-chip is-selected" role="tab" aria-selected="true" data-chip="leads">Which leads?</button>' +
            '<button type="button" class="kx-chip" role="tab" aria-selected="false" data-chip="criteria">Criteria</button>' +
            '<button type="button" class="kx-chip" role="tab" aria-selected="false" data-chip="diff">Differentials</button>' +
          '</div>' +
  
          '<div class="kx-why-label" id="kxWhyCriteria">Criteria the AI matched</div>' +
          '<div class="kx-crit-list">' + critHtml + '</div>' +
  
          '<div class="kx-why-label" id="kxWhyDiff">Differentials considered</div>' +
          '<div class="kx-diffs">' + diffsHtml + '</div>' +
  
          (verify
            ? '<div class="kx-verify">' +
                '<span class="kx-verify-ic">' + ic('fact_check') + '</span>' +
                '<div><b>What you should verify</b><span>' + esc(verify) + '</span></div>' +
              '</div>'
            : '') +
        '</div>' +
      '</section>';
  
    // ── In-screen interactions (no document listeners; router still owns data-act nav) ──
    function pulseTag(hl){
      if (!hl) return;
      var tag = host.querySelector('.kx-ecg-tag--' + hl);
      var box = host.querySelector('.kx-hl--' + hl);
      [tag, box].forEach(function(el){
        if (!el) return;
        el.classList.remove('is-lit');
        // reflow to restart the animation
        void el.getBoundingClientRect();
        el.classList.add('is-lit');
      });
    }
    function selectChip(chip){
      var chips = host.querySelectorAll('.kx-chip');
      for (var i = 0; i < chips.length; i++){
        var on = chips[i] === chip;
        chips[i].classList.toggle('is-selected', on);
        chips[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      var view = chip.getAttribute('data-chip');
      if (view === 'criteria') { var c = host.querySelector('#kxWhyCriteria'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (view === 'diff') { var d = host.querySelector('#kxWhyDiff'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else { var e = host.querySelector('.kx-ecg'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); pulseTag('rr'); pulseTag('fwave'); }
    }
  
    host.onclick = function(e){
      var chip = e.target.closest ? e.target.closest('.kx-chip') : null;
      if (chip && host.contains(chip)) { selectChip(chip); return; }
      var crit = e.target.closest ? e.target.closest('.kx-crit') : null;
      if (crit && host.contains(crit)) { pulseTag(crit.getAttribute('data-hl')); return; }
      // data-act elements (e.g. back → report) bubble to the router at #kardioxRoot; not handled here.
    };
  }

  /* history */
  /* screen 13 · History timeline & trends
   * Header (History / Bed 14 · R. Mehta + tune + back) → QTc TREND card (line chart) →
   * date-grouped trace-thumb rows (verdict · time·rate·QTc · severity pill) → "Compare two ECGs".
   * Sync render uses the handoff demo; hydrates live from ctx.providers.ecgStore.timeline() when present.
   * ic() is provided by the kardiox.js module scope. Navigation is delegation-only via data-act.
   */
  function render13(host, ctx) {
    if (!host) return;
    ctx = ctx || {};
    var P = ctx.providers ||
      (typeof window !== "undefined" && window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_PROVIDERS.current()) ||
      null;
  
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function noop() {}
  
    // Severity presentation - COLOR (via .kx-pill--*) + ICON + LABEL, never colour alone.
    var SEV = {
      critical: { label: "Critical", icon: "crisis_alert" },
      urgent:   { label: "Urgent",   icon: "priority_high" },
      warn:     { label: "Caution",  icon: "warning" },
      stable:   { label: "Stable",   icon: "check_circle" },
      info:     { label: "Info",     icon: "info" }
    };
  
    // Handoff demo (KardioX AI.dc.html screen 13) - survives when no provider / mock / empty live store.
    var TRACE_AF  = "0,17 6,17 9,21 12,5 15,27 18,17 34,17 37,21 40,5 43,27 46,17 56,17";
    var TRACE_NSR = "0,17 8,17 11,21 14,6 17,25 20,17 32,17 40,21 43,6 46,25 49,17 56,17";
    var DEMO_TREND = {
      qtc: 468, count: 6, sev: "warn",
      points: "6,40 60,36 116,30 172,32 226,22 292,16",
      delta: "+42 ms since admission · monitor"
    };
    var DEMO_GROUPS = [
      { label: "Today", rows: [
        { id: "kx-mock-af-rvr", title: "Atrial fibrillation", meta: "08:12 · 128 bpm · QTc 468", severity: "urgent", trace: TRACE_AF }
      ]},
      { label: "3 days ago", rows: [
        { id: "kx-mock-nsr-1", title: "Sinus rhythm", meta: "14:03 · 78 bpm · QTc 426", severity: "stable", trace: TRACE_NSR },
        { id: "kx-mock-nsr-0", title: "Sinus rhythm", meta: "On admission · 82 bpm", severity: "stable", trace: TRACE_NSR }
      ]}
    ];
  
    /* ── markup builders ─────────────────────────────────────────────────────────── */
    function lastDot(pts) {
      var arr = String(pts).trim().split(/\s+/);
      var xy = (arr[arr.length - 1] || "0,0").split(",");
      return '<circle cx="' + esc(xy[0]) + '" cy="' + esc(xy[1]) + '" r="4"></circle>';
    }
    function trendCard(t) {
      var sev = SEV[t.sev] ? t.sev : "warn";
      return "" +
        '<div class="kx-hist-trend kx-hist-trend--' + esc(sev) + '" role="group" ' +
          'aria-label="QTc trend, ' + esc(t.qtc) + ' milliseconds across ' + esc(t.count) + ' ECGs, ' + esc(t.delta) + '">' +
          '<div class="kx-hist-trend-top">' +
            '<span class="kx-hist-trend-lbl">QTc trend · ' + esc(t.count) + ' ECGs</span>' +
            '<span class="kx-hist-trend-val kx-data">' + esc(t.qtc) +
              '<span class="kx-hist-trend-unit"> ms</span></span>' +
          "</div>" +
          '<svg class="kx-hist-spark" viewBox="0 0 300 56" width="100%" height="52" aria-hidden="true">' +
            '<polyline points="' + esc(t.points) + '" fill="none" stroke-width="2.5" ' +
              'stroke-linecap="round" stroke-linejoin="round"></polyline>' +
            lastDot(t.points) +
          "</svg>" +
          '<div class="kx-hist-trend-delta">' + ic("trending_up") +
            "<span>" + esc(t.delta) + "</span></div>" +
        "</div>";
    }
    function rowHtml(r) {
      var sev = SEV[r.severity] || SEV.info;
      return "" +
        '<button class="kx-rec" type="button" data-act="kardiox-open" data-id="' + esc(r.id) + '" ' +
          'aria-label="' + esc(r.title) + ", " + esc(r.meta) + ", " + sev.label + ' - open analysis">' +
          '<span class="kx-rec-thumb" aria-hidden="true">' +
            '<svg viewBox="0 0 56 34" width="46" height="34">' +
              '<polyline class="kx-trace kx-trace--' + esc(r.severity) + '" points="' + esc(r.trace) + '"></polyline>' +
            "</svg>" +
          "</span>" +
          '<span class="kx-rec-body">' +
            '<b class="kx-rec-title">' + esc(r.title) + "</b>" +
            '<span class="kx-rec-meta">' + esc(r.meta) + "</span>" +
          "</span>" +
          '<span class="kx-pill kx-pill--' + esc(r.severity) + '">' + ic(sev.icon) +
            '<span class="kx-data">' + sev.label + "</span></span>" +
        "</button>";
    }
    function groupsHtml(groups) {
      return groups.map(function (g) {
        return '<div class="kx-hist-group">' + esc(g.label) + "</div>" +
          '<div class="kx-recent">' + g.rows.map(rowHtml).join("") + "</div>";
      }).join("");
    }
  
    /* ── shell ───────────────────────────────────────────────────────────────────── */
    host.innerHTML = "" +
      '<header class="kx-land-head">' +
        '<button class="kx-land-close" type="button" data-act="kardiox-back" aria-label="Back">' +
          ic("arrow_back") + "</button>" +
        '<div class="kx-land-titles">' +
          '<div class="kx-land-title">History</div>' +
          '<div class="kx-land-sub">Bed 14 · R. Mehta</div>' +
        "</div>" +
        '<button class="kx-land-gear" type="button" data-act="kardiox-settings" aria-label="Tune history filters">' +
          ic("tune") + "</button>" +
      "</header>" +
      '<div class="kx-hist">' +
        '<div data-hook="trend">' + trendCard(DEMO_TREND) + "</div>" +
        '<div data-hook="groups">' + groupsHtml(DEMO_GROUPS) + "</div>" +
        '<button class="kx-hist-compare" type="button" data-act="kxnav:compare">' +
          ic("compare_arrows") + "<span>Compare two ECGs</span></button>" +
      "</div>";
  
    /* ── live hydration (providers are async; render is sync) ──────────────────────
          Only overwrite when timeline() returns rows so the handoff-exact demo survives
          in mock/preview; a live-but-empty store keeps the demo unless it's a real store. */
    function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
    function tsOf(a) {
      var t = a.ts != null ? a.ts : (a.createdAt ? Date.parse(a.createdAt) : NaN);
      return isNaN(t) ? null : t;
    }
    function qtcOf(a) {
      return num(a.qtc) != null ? a.qtc
        : (a.metrics && num(a.metrics.qtc) != null ? a.metrics.qtc
        : (a.qt && num(a.qt.corrected) != null ? a.qt.corrected : null));
    }
    function rateOf(a) {
      return num(a.rate) != null ? a.rate
        : (num(a.hr) != null ? a.hr
        : (a.metrics && num(a.metrics.rate) != null ? a.metrics.rate : null));
    }
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function timeOf(a) {
      if (a.time) return a.time;
      var t = tsOf(a);
      if (t == null) return a.createdAt || "";
      var d = new Date(t);
      return pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    function dayLabel(a) {
      if (a.dateGroup) return a.dateGroup;
      var t = tsOf(a);
      if (t == null) return a.createdAt || "Earlier";
      var d = new Date(t), now = new Date();
      var a0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
      var b0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      var diff = Math.round((b0 - a0) / 864e5);
      if (diff <= 0) return "Today";
      if (diff === 1) return "Yesterday";
      return diff + " days ago";
    }
    function qtcSev(q) { return q == null ? null : (q >= 480 ? "urgent" : (q >= 440 ? "warn" : "stable")); }
    function spark(vals) {
      if (!vals || vals.length < 2) return null;
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
      var x0 = 6, x1 = 292, top = 16, bot = 40;
      return vals.map(function (v, i) {
        var x = x0 + (x1 - x0) * (i / (vals.length - 1));
        var y = bot - (bot - top) * ((v - min) / span);
        return (Math.round(x * 10) / 10) + "," + (Math.round(y * 10) / 10);
      }).join(" ");
    }
    function metaOf(a) {
      var q = qtcOf(a), rate = rateOf(a);
      return [timeOf(a), rate != null ? rate + " bpm" : null, q != null ? "QTc " + q : null]
        .filter(Boolean).join(" · ");
    }
  
    if (P && P.ecgStore && P.ecgStore.timeline) {
      try {
        Promise.resolve(P.ecgStore.timeline()).then(function (list) {
          list = Array.isArray(list) ? list : [];
          if (!list.length) return; // keep the handoff demo
  
          // chronological ascending series for the trend sparkline …
          var chrono = list.slice().sort(function (x, y) {
            var a = tsOf(x), b = tsOf(y);
            if (a == null || b == null) return 0;
            return a - b;
          });
          var qtcs = chrono.map(qtcOf).filter(function (v) { return num(v) != null; });
          var trendBox = host.querySelector('[data-hook="trend"]');
          if (trendBox && qtcs.length >= 2) {
            var first = qtcs[0], lastV = qtcs[qtcs.length - 1], d = lastV - first;
            trendBox.innerHTML = trendCard({
              qtc: lastV, count: qtcs.length, sev: qtcSev(lastV) || "warn",
              points: spark(qtcs),
              delta: (d >= 0 ? "+" : "") + d + " ms since admission · monitor"
            });
          }
  
          // … newest-first, grouped by relative day for the entry rows.
          var recent = chrono.slice().reverse();
          var groups = [], byLabel = {};
          recent.forEach(function (a) {
            var label = dayLabel(a);
            if (!byLabel[label]) { byLabel[label] = { label: label, rows: [] }; groups.push(byLabel[label]); }
            byLabel[label].rows.push({
              id: a.id, title: a.verdict || a.title || "ECG analysis",
              meta: metaOf(a), severity: a.severity || "info",
              trace: a.trace || TRACE_NSR
            });
          });
          var gbox = host.querySelector('[data-hook="groups"]');
          if (gbox && groups.length) gbox.innerHTML = groupsHtml(groups);
        }).catch(noop);
      } catch (e) {}
    }
  }

  /* comparison */
  function render14(host, ctx) {
    ctx = ctx || {};
    var a = ctx.analysis || {};
    var m = a.measurements || {};
  
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function ic(name) {
      return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>';
    }
    function rShort(v) {
      v = String(v || "");
      if (/atrial fib/i.test(v)) return "AF";
      if (/atrial flutter/i.test(v)) return "AFL";
      if (/sinus tach/i.test(v)) return "STach";
      if (/sinus brad/i.test(v)) return "SBrad";
      if (/sinus/i.test(v)) return "Sinus";
      if (/\bvt\b|ventricular tach/i.test(v)) return "VT";
      var abbr = v.split(/\s+/).map(function (w) { return w.charAt(0); }).join("").toUpperCase().slice(0, 4);
      return abbr || "AF";
    }
    function morph(label, fallback) {
      var rows = a.morphology || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && String(rows[i].label).toLowerCase() === label.toLowerCase()) {
          return rows[i].value || fallback;
        }
      }
      return fallback;
    }
  
    // Current panel + right column bind to live analysis; fall back to the AF-with-RVR design scenario.
    var curRhythm = a.verdict ? rShort(a.verdict) : "AF";
    var curRate = (m.ventRateBpm != null) ? m.ventRateBpm : 128;
    var curQtc = (m.qtcMs != null) ? m.qtcMs : 468;
    var curP = morph("P waves", "Absent");
  
    // Prior = the fixed "3 days ago" clinical baseline for the evolution scenario.
    var rows = [
      { label: "Rhythm", old: "Sinus", icon: "arrow_forward", tone: "urgent", now: curRhythm },
      { label: "Rate", old: "78", icon: "trending_up", tone: "urgent", now: curRate },
      { label: "QTc", old: "426", icon: "trending_up", tone: "warn", now: curQtc },
      { label: "P waves", old: "Present", icon: "arrow_forward", tone: "urgent", now: curP }
    ];
  
    var priorTrace =
      '<polyline points="0,40 14,40 18,44 22,16 26,52 30,40 44,38 48,30 58,30 66,40 74,40 78,44 82,16 86,52 90,40 110,40 114,44 118,16 122,52 126,40 150,40"></polyline>';
    var curTrace =
      '<polyline points="0,40 8,38 16,42 22,40 26,44 30,18 34,54 38,40 52,38 60,42 66,40 70,44 74,18 78,54 82,40 104,38 116,40 120,44 124,18 128,54 132,40 150,40"></polyline>';
  
    function traceSvg(inner) {
      return '<svg class="kx-cmp-svg" viewBox="0 0 150 70" width="100%" height="66" ' +
        'preserveAspectRatio="none" aria-hidden="true">' + inner + '</svg>';
    }
  
    var head =
      '<div class="kx-cmp-head">' +
        '<button class="kx-cmp-back" type="button" data-act="kxnav:back" aria-label="Back">' +
          ic("arrow_back") +
        '</button>' +
        '<div class="kx-cmp-titles">' +
          '<div class="kx-cmp-title">Compare</div>' +
          '<div class="kx-cmp-sub">Evolution over 3 days</div>' +
        '</div>' +
      '</div>';
  
    var panels =
      '<div class="kx-cmp-panels">' +
        '<div class="kx-cmp-panel">' +
          '<div class="kx-cmp-plabel">Prior &middot; 3d ago</div>' +
          '<div class="kx-cmp-trace">' + traceSvg(priorTrace) + '</div>' +
          '<div class="kx-cmp-verdict kx-cmp-verdict--prior kx-data">Sinus &middot; 78</div>' +
        '</div>' +
        '<div class="kx-cmp-panel">' +
          '<div class="kx-cmp-plabel kx-cmp-plabel--current">Current</div>' +
          '<div class="kx-cmp-trace kx-cmp-trace--current">' + traceSvg(curTrace) + '</div>' +
          '<div class="kx-cmp-verdict kx-cmp-verdict--current kx-data">' +
            esc(curRhythm) + ' &middot; ' + '<span class="kx-data">' + esc(curRate) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  
    var tableRows = rows.map(function (r, i) {
      var last = i === rows.length - 1;
      return '<div class="kx-cmp-row' + (last ? " is-last" : "") + '">' +
          '<span class="kx-cmp-rlabel">' + esc(r.label) + '</span>' +
          '<span class="kx-cmp-old kx-data">' + esc(r.old) + '</span>' +
          '<span class="kx-cmp-trend kx-cmp-t-' + r.tone + '">' + ic(r.icon) + '</span>' +
          '<b class="kx-cmp-new kx-cmp-t-' + r.tone + ' kx-data">' + esc(r.now) + '</b>' +
        '</div>';
    }).join("");
  
    var table =
      '<div class="kx-cmp-changed">What changed</div>' +
      '<div class="kx-cmp-table">' + tableRows + '</div>';
  
    var banner =
      '<div class="kx-cmp-banner" role="note">' +
        '<span class="kx-cmp-bolt">' + ic("bolt") + '</span>' +
        '<div class="kx-cmp-banner-body">' +
          '<b>New-onset AF detected</b>' +
          '<span>Rhythm converted from sinus. Rate up 50 bpm. Flag to the primary team.</span>' +
        '</div>' +
      '</div>';
  
    host.innerHTML = head + '<div class="kx-cmp-body">' + panels + table + banner + '</div>';
  }

  /* privacy */
  function render15(host, ctx) {
    ctx = ctx || {};
    // Screen 15 · Privacy (a feature). Static privacy contract copy per handoff;
    // navigation is delegation-only via data-act (the router owns the #kardioxRoot listener).
    var rows = [
      ["smartphone", "On your device by default", "Images and reports are stored locally, never in the cloud."],
      ["enhanced_encryption", "Encrypted, temporary upload", "Only when AI analysis needs the cloud, end-to-end encrypted."],
      ["auto_delete", "Deleted immediately after", "The upload is erased the moment analysis completes."],
      ["logout", "Cleared on sign-out &amp; uninstall", "No residue is left behind on the device."]
    ];
  
    var rowsHtml = rows.map(function (r) {
      return '<div class="kx-priv-row">' +
        '<span class="kx-priv-row-ic">' + ic(r[0]) + '</span>' +
        '<div class="kx-priv-row-tx">' +
          '<b class="kx-priv-row-t">' + r[1] + '</b>' +
          '<span class="kx-priv-row-s">' + r[2] + '</span>' +
        '</div>' +
      '</div>';
    }).join("");
  
    host.innerHTML =
      '<div class="kx-priv-head">' +
        '<button class="kx-priv-back" type="button" data-act="kardiox-back" aria-label="Back">' + ic("arrow_back") + '</button>' +
        '<h1 class="kx-priv-htitle">Privacy</h1>' +
      '</div>' +
      '<div class="kx-priv-body">' +
        '<span class="kx-priv-hero">' + ic("verified_user") + '</span>' +
        '<div class="kx-priv-title">Your ECGs stay yours</div>' +
        '<div class="kx-priv-sub">KardioX is built privacy-first. Here\'s exactly what happens to every ECG.</div>' +
        '<div class="kx-priv-rows">' + rowsHtml + '</div>' +
        '<button class="kx-btn kx-btn-secondary kx-priv-manage" type="button" data-act="kxnav:settings">Manage my data</button>' +
      '</div>';
  }

  /* settings */
  function render17(host, ctx){
    ctx = ctx || {};
    var store = (ctx.providers && ctx.providers.ecgStore) || null;
  
    var esc = function(s){
      return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
      });
    };
  
    // Storage line - defaults from the design handoff, overridden by ecgStore.storageInfo() when available.
    var storeSub = '24 ECGs · 42 MB local';
    var storeVal = '42 MB';
  
    var fmt = function(i){
      if (i == null) return null;
      if (typeof i === 'string') return { sub: i, val: '' };
      var count = (i.count != null) ? i.count : (i.ecgs != null ? i.ecgs : null);
      var mb = (i.sizeMB != null) ? i.sizeMB : (i.mb != null ? i.mb : null);
      var size = i.sizeLabel || (mb != null ? mb + ' MB' : null);
      var parts = [];
      if (count != null) parts.push(count + ' ECG' + (count === 1 ? '' : 's'));
      if (size != null) parts.push(size + ' local');
      return { sub: parts.join(' · ') || null, val: size || '' };
    };
  
    var pending = null;
    try {
      if (store && typeof store.storageInfo === 'function') {
        var info = store.storageInfo();
        if (info && typeof info.then === 'function') {
          pending = info;
        } else {
          var r = fmt(info);
          if (r) { if (r.sub) storeSub = r.sub; if (r.val) storeVal = r.val; }
        }
      }
    } catch (e) {}
  
    var soonRow = function(icon, title){
      return '<div class="kx-settings-row kx-soon" aria-disabled="true">'
        + '<span class="kx-sr-ic">' + ic(icon) + '</span>'
        + '<span class="kx-sr-body"><b class="kx-sr-title">' + title + '</b></span>'
        + '<span class="kx-soon-pill">SOON</span>'
        + '</div>';
    };
  
    host.innerHTML =
      '<header class="kx-set-head">'
        + '<button type="button" class="kx-set-back" data-act="kx-back" aria-label="Back">' + ic('arrow_back') + '</button>'
        + '<h1 class="kx-set-title">Settings</h1>'
      + '</header>'
      + '<div class="kx-set-wrap">'
  
        + '<div class="kx-set-label">Privacy &amp; data</div>'
        + '<div class="kx-set-group">'
          + '<button type="button" class="kx-settings-row" data-act="kxnav:privacy">'
            + '<span class="kx-sr-ic">' + ic('verified_user') + '</span>'
            + '<span class="kx-sr-body"><b class="kx-sr-title">Privacy</b><span class="kx-sr-sub">How your ECGs are handled</span></span>'
            + '<span class="kx-sr-chev">' + ic('chevron_right') + '</span>'
          + '</button>'
          + '<button type="button" class="kx-settings-row" data-act="kxnav:storage">'
            + '<span class="kx-sr-ic">' + ic('sd_storage') + '</span>'
            + '<span class="kx-sr-body"><b class="kx-sr-title">Storage</b><span class="kx-sr-sub" data-kx-storage-sub>' + esc(storeSub) + '</span></span>'
            + '<span class="kx-sr-val kx-data" data-kx-storage-val>' + esc(storeVal) + '</span>'
          + '</button>'
          + '<button type="button" class="kx-settings-row" data-act="kxnav:export">'
            + '<span class="kx-sr-ic">' + ic('ios_share') + '</span>'
            + '<span class="kx-sr-body"><b class="kx-sr-title">Export</b><span class="kx-sr-sub">PDF · FHIR · image</span></span>'
            + '<span class="kx-sr-chev">' + ic('chevron_right') + '</span>'
          + '</button>'
          + '<button type="button" class="kx-settings-row kx-danger" data-act="kx-clear-ecgs">'
            + '<span class="kx-sr-ic">' + ic('delete_forever') + '</span>'
            + '<span class="kx-sr-body"><b class="kx-sr-title">Clear local ECGs</b><span class="kx-sr-sub">Permanently remove all</span></span>'
          + '</button>'
        + '</div>'
  
        + '<div class="kx-set-label">Intelligence</div>'
        + '<div class="kx-set-group">'
          + '<button type="button" class="kx-settings-row" data-act="kx-toggle-confidence" role="switch" aria-checked="true">'
            + '<span class="kx-sr-ic">' + ic('tune') + '</span>'
            + '<span class="kx-sr-body"><b class="kx-sr-title">Confidence display</b><span class="kx-sr-sub">Always show %</span></span>'
            + '<span class="kx-sr-toggle kx-on" aria-hidden="true"><span class="kx-sr-knob"></span></span>'
          + '</button>'
        + '</div>'
  
        + '<div class="kx-set-label">Coming soon</div>'
        + '<div class="kx-set-group">'
          + soonRow('bluetooth', 'Bluetooth devices')
          + soonRow('watch', 'Apple Watch')
          + soonRow('local_hospital', 'Hospital integration')
        + '</div>'
  
      + '</div>';
  
    if (pending) {
      pending.then(function(info){
        var r = fmt(info);
        if (!r) return;
        var subEl = host.querySelector('[data-kx-storage-sub]');
        var valEl = host.querySelector('[data-kx-storage-val]');
        if (subEl && r.sub) subEl.textContent = r.sub;
        if (valEl && r.val) valEl.textContent = r.val;
      }).catch(function(){});
    }
  }

  /* empty */
  /* screen 18 · History - empty state
   * host = #kxScroll; ctx = { providers, analysis, nav(id), close(), toast(msg) }.
   * Renders the handoff-exact History header + zero-ECG empty state. Copy is VERBATIM
   * from KardioX AI.dc.html (screen 18). Navigation is delegation-only via data-act
   * (the router's #kardioxRoot listener owns it) - this screen adds NO document listeners.
   * ic() (Material Symbols span) is provided by the module scope.
   * The empty state has no dynamic fields to bind; we read ecgStore.all() only to keep the
   * "confirmed empty" contract explicit (the router shows screen 13 when the store is non-empty). */
  function render18(host, ctx) {
    if (!host) return;
    ctx = ctx || {};
  
    host.innerHTML =
      '<section class="kx-hist" aria-labelledby="kxHistTitle">' +
  
        // Screen header - back + title (matches the in-app header in the handoff, not the phone chrome).
        '<div class="kx-hist-head">' +
          '<button type="button" class="kx-hist-back" data-act="kardiox-back" aria-label="Back">' +
            ic("arrow_back") +
          '</button>' +
          '<h2 class="kx-hist-title" id="kxHistTitle">History</h2>' +
        '</div>' +
  
        // Empty state - dashed monitor_heart ring, copy, primary CTA.
        '<div class="kx-hist-empty" role="status">' +
          '<span class="kx-hist-empty-ring" aria-hidden="true">' + ic("monitor_heart") + '</span>' +
          '<b class="kx-hist-empty-title">No ECGs yet</b>' +
          '<span class="kx-hist-empty-sub">Analyze your first ECG and it\'ll appear here with its report, trend and history.</span>' +
          '<button type="button" class="kx-hist-cta" data-act="kardiox-add">' +
            '<span class="kx-hist-cta-ic" aria-hidden="true">' + ic("add_a_photo") + '</span>' +
            'Analyze an ECG' +
          '</button>' +
        '</div>' +
  
      '</section>';
  
    /* Confirm-empty contract: providers are async and swappable (mock <-> live). If a live store ever
       reports saved ECGs, that is screen 13's territory - surface it to the router via ctx.nav so this
       empty screen never masks real data. Guarded + best-effort; never throws into render. */
    try {
      var P = ctx.providers ||
        (typeof window !== "undefined" && window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_PROVIDERS.current()) ||
        null;
      if (P && P.ecgStore && P.ecgStore.all && P.kind !== "mock" && typeof ctx.nav === "function") {
        Promise.resolve(P.ecgStore.all()).then(function (list) {
          if (Array.isArray(list) && list.length) ctx.nav("history");
        }).catch(function () {});
      }
    } catch (e) {}
  }

  /* states */
  function render19(host, ctx) {
    // Screen 19 · System states - renders ALL FOUR states as labelled sub-blocks.
    // ctx = { providers, analysis, nav, close, toast }. Interactions are wired via
    // data-act attributes and resolved by the module router (no document listeners here).
    host.innerHTML = `
      <div class="kx-st">
  
        <!-- (1) Poor image / error -->
        <div class="kx-st-label">Poor image / error</div>
        <div class="kx-st-err" role="alert">
          <span class="kx-st-err-ico" aria-hidden="true">${ic('image_not_supported')}</span>
          <b class="kx-st-err-title">Couldn't read this ECG</b>
          <span class="kx-st-err-body">The image is blurry or cropped. Retake with all 12 leads flat in frame.</span>
          <button type="button" class="kx-btn kx-btn-primary kx-st-retake" data-act="kardiox-retry">Retake</button>
        </div>
  
        <!-- (2) Offline (amber) -->
        <div class="kx-st-label">Offline</div>
        <div class="kx-st-off" role="status">
          <span class="kx-st-off-ico" aria-hidden="true">${ic('cloud_off')}</span>
          <div class="kx-st-off-txt">
            <b class="kx-st-off-title">You're offline</b>
            <span class="kx-st-off-body">Learning works offline. Cloud AI resumes when reconnected.</span>
          </div>
        </div>
  
        <!-- (3) Loading · skeleton (kxShimmer) -->
        <div class="kx-st-label">Loading &middot; skeleton</div>
        <div class="kx-st-skel" aria-hidden="true">
          <div class="kx-st-skel-block"></div>
          <div class="kx-st-skel-line kx-st-skel-line--60"></div>
          <div class="kx-st-skel-line kx-st-skel-line--40"></div>
        </div>
  
        <!-- (4) Success toast (dark, green check) -->
        <div class="kx-st-label">Success toast</div>
        <div class="kx-st-toast" role="status">
          <span class="kx-st-toast-ico" aria-hidden="true">${ic('check_circle')}</span>
          <span class="kx-st-toast-msg">Report saved to history</span>
          <button type="button" class="kx-st-toast-view" data-act="kardiox-history">View</button>
        </div>
  
      </div>`;
  }

  /* library */
  async function render08(host, ctx) {
    var P = ctx && ctx.providers ? ctx.providers : {};
    var lib = P.library || {};
    var learn = P.learning || {};
  
    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var hash = function (s) {
      var h = 0, str = String(s || '');
      for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      return h;
    };
    var catName = function (c) {
      if (typeof c === 'string') return c;
      return (c && (c.name || c.label || c.title || c.id)) || String(c);
    };
    var settle = function (p, d) {
      return Promise.resolve(p).then(function (v) { return v == null ? d : v; }).catch(function () { return d; });
    };
  
    var TRACES = [
      '0,16 8,16 11,20 14,6 17,24 20,16 30,16 34,20 37,6 40,24 43,16 56,16',
      '0,16 6,16 9,20 12,4 15,26 18,16 34,16 37,20 40,4 43,26 46,16 56,16',
      '0,16 4,10 8,22 12,8 16,24 20,10 24,22 28,8 32,24 36,10 40,22 44,10 48,22 56,16',
      '0,18 8,18 11,22 14,4 17,20 20,12 30,12 38,18 44,22 47,4 50,20 56,14'
    ];
  
    // Loading placeholder while providers resolve.
    host.innerHTML =
      '<div class="kx-lib-head">' +
        '<button type="button" class="kx-lib-back" data-act="kxnav:back" aria-label="Back"><span class="msr">arrow_back</span></button>' +
        '<div class="kx-lib-title">Learn ECG</div>' +
        '<button type="button" class="kx-lib-bm" aria-label="Bookmarks" aria-pressed="false"><span class="msr">bookmark</span></button>' +
      '</div>' +
      '<div class="kx-lib-body"><div class="kx-lib-empty">Loading library…</div></div>';
  
    var progDefault = { mastered: 0, total: 100, streakDays: 0 };
    var results = await Promise.all([
      settle(learn.progress ? learn.progress() : null, progDefault),
      settle(lib.categories ? lib.categories() : null, []),
      settle(lib.bookmarks ? lib.bookmarks() : null, [])
    ]);
    var prog = results[0] || progDefault;
    var cats = results[1] || [];
    var bmarks = results[2] || [];
    var bset = {};
    for (var bi = 0; bi < bmarks.length; bi++) bset[bmarks[bi]] = true;
  
    var groups = await Promise.all(cats.map(function (c) {
      return settle(lib.ecgs ? lib.ecgs(c) : null, []).then(function (list) {
        return { cat: c, name: catName(c), ecgs: list || [] };
      });
    }));
  
    var total = prog.total || 100;
    var mastered = prog.mastered || 0;
    var streak = prog.streakDays || 0;
    var C = 2 * Math.PI * 33;
    var frac = total ? Math.max(0, Math.min(1, mastered / total)) : 0;
    var off = C * (1 - frac);
  
    host.innerHTML =
      '<div class="kx-lib-head">' +
        '<button type="button" class="kx-lib-back" data-act="kxnav:back" aria-label="Back"><span class="msr">arrow_back</span></button>' +
        '<div class="kx-lib-title">Learn ECG</div>' +
        '<button type="button" class="kx-lib-bm" aria-label="Bookmarks" aria-pressed="false"><span class="msr">bookmark</span></button>' +
      '</div>' +
      '<div class="kx-lib-body">' +
        '<div class="kx-lib-hero">' +
          '<div class="kx-lib-ring">' +
            '<svg viewBox="0 0 80 80" width="72" height="72" aria-hidden="true">' +
              '<circle class="kx-lib-ring-track" cx="40" cy="40" r="33" fill="none" stroke-width="7"></circle>' +
              '<circle class="kx-lib-ring-fill" cx="40" cy="40" r="33" fill="none" stroke-width="7" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
            '</svg>' +
            '<div class="kx-lib-ring-lbl"><span class="kx-lib-ring-num kx-data">' + mastered + '</span><span class="kx-lib-ring-of">of ' + total + '</span></div>' +
          '</div>' +
          '<div class="kx-lib-hero-main">' +
            '<div class="kx-lib-hero-t">You’re on a roll</div>' +
            '<div class="kx-lib-hero-s">' + mastered + ' ECGs mastered · ' + (total - mastered) + ' to go</div>' +
            '<div class="kx-lib-streak"><span class="msr fill kx-lib-flame">local_fire_department</span>' + streak + '-day streak</div>' +
          '</div>' +
        '</div>' +
        '<label class="kx-lib-search"><span class="msr">search</span>' +
          '<input type="search" id="kxLibSearch" autocomplete="off" placeholder="Search ' + total + ' ECGs…" aria-label="Search ' + total + ' ECGs"></label>' +
        '<div class="kx-lib-chips" id="kxLibChips" role="group" aria-label="Filter by tier">' +
          '<button type="button" class="kx-lib-chip is-on" data-tier="all" aria-pressed="true">All</button>' +
          '<button type="button" class="kx-lib-chip" data-tier="core" aria-pressed="false">Core</button>' +
          '<button type="button" class="kx-lib-chip" data-tier="emergency" aria-pressed="false">Emergency</button>' +
          '<button type="button" class="kx-lib-chip" data-tier="rare" aria-pressed="false">Rare</button>' +
        '</div>' +
        '<div id="kxLibSections"></div>' +
      '</div>';
  
    var tierLabel = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
    var subLabel = function (e) {
      var st = e.status === 'mastered' ? 'mastered' : (e.status === 'new' ? 'new' : (Math.round(e.masteryPct || 0) + '%'));
      return tierLabel(e.tier) + ' · ' + st;
    };
    var affordance = function (e) {
      if (e.status === 'mastered') return '<span class="msr fill kx-lib-check">check_circle</span>';
      if (e.status === 'inProgress') return '<span class="kx-lib-pct kx-data">' + Math.round(e.masteryPct || 0) + '%</span>';
      if (e.status === 'new' && e.tier === 'emergency') return '<span class="kx-lib-pill">EMERGENCY</span>';
      return '<span class="msr kx-lib-chev">chevron_right</span>';
    };
    var thumb = function (e) {
      var pts = TRACES[hash(e.id) % TRACES.length];
      var tier = (e.tier === 'emergency' || e.tier === 'rare') ? e.tier : 'core';
      return '<span class="kx-lib-thumb t-' + tier + '"><svg viewBox="0 0 56 32" width="44" height="32" aria-hidden="true"><polyline points="' + pts + '"></polyline></svg></span>';
    };
    var rowHtml = function (e) {
      return '<button type="button" class="kx-lib-row" data-act="kxnav:lesson" data-id="' + esc(e.id) + '">' +
          thumb(e) +
          '<span class="kx-lib-row-main"><b class="kx-lib-row-t">' + esc(e.title) + '</b><span class="kx-lib-row-s">' + esc(subLabel(e)) + '</span></span>' +
          affordance(e) +
        '</button>';
    };
  
    var activeTier = 'all', query = '', bmOnly = false;
    var isBm = function (e) { return !!(bset[e.id] || e.bookmarked); };
    var matches = function (e) {
      if (activeTier !== 'all' && e.tier !== activeTier) return false;
      if (bmOnly && !isBm(e)) return false;
      if (query) {
        var tags = (e.ecgFindingTags || []).join(' ');
        var hay = (String(e.title || '') + ' ' + String(e.category || '') + ' ' + tags).toLowerCase();
        if (hay.indexOf(query.toLowerCase()) === -1) return false;
      }
      return true;
    };
  
    var sectionsEl = host.querySelector('#kxLibSections');
    var applyFilters = function () {
      var html = '', anyRow = false;
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi];
        var totalN = g.ecgs.length;
        var doneN = 0;
        for (var k = 0; k < g.ecgs.length; k++) if (g.ecgs[k].status === 'mastered') doneN++;
        var shown = g.ecgs.filter(matches);
        if (!shown.length) continue;
        anyRow = true;
        html += '<div class="kx-lib-group">' + esc(g.name) + ' · ' + doneN + ' of ' + totalN + '</div><div class="kx-lib-rows">';
        for (var r = 0; r < shown.length; r++) html += rowHtml(shown[r]);
        html += '</div>';
      }
      sectionsEl.innerHTML = anyRow ? html : '<div class="kx-lib-empty">No ECGs match your filters.</div>';
    };
  
    // Local (non-navigation) listeners on this screen's own children.
    var chipsEl = host.querySelector('#kxLibChips');
    chipsEl.addEventListener('click', function (ev) {
      var b = ev.target.closest('.kx-lib-chip');
      if (!b) return;
      activeTier = b.dataset.tier;
      var chips = chipsEl.querySelectorAll('.kx-lib-chip');
      for (var i = 0; i < chips.length; i++) {
        var on = chips[i] === b;
        chips[i].classList.toggle('is-on', on);
        chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      applyFilters();
    });
  
    var searchEl = host.querySelector('#kxLibSearch');
    var deb;
    searchEl.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () { query = searchEl.value.trim(); applyFilters(); }, 200);
    });
  
    var bmBtn = host.querySelector('.kx-lib-bm');
    bmBtn.addEventListener('click', function () {
      bmOnly = !bmOnly;
      bmBtn.classList.toggle('is-on', bmOnly);
      bmBtn.setAttribute('aria-pressed', bmOnly ? 'true' : 'false');
      applyFilters();
    });
  
    applyFilters();
  }

  /* lesson */
  /* ===== Screen 09 · Lesson detail (Learn ECG) ============================
   * host = #kxScroll; ctx = { providers, analysis, nav, close, toast }.
   * Binds from ctx.providers.library.ecg(id) with the AF lesson as the default.
   * Register in the router SCREENS map:  lesson: render09,  '09': render09
   * and route the Overview/ECG/Quiz tab switch + kx-bookmark toggle LOCALLY
   * (they are screen-internal; only kxnav:* / kardiox-* bubble to the router).
   * ---------------------------------------------------------------------- */
  function render09(host, ctx) {
    ctx = ctx || {};
  
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
    function haptic(kind) {
      try { if (window.SMD_HAPTICS && SMD_HAPTICS.impact) SMD_HAPTICS.impact(kind || 'light'); } catch (e) {}
    }
  
    /* Resolve the library provider through either the flat or current()-wrapped shape. */
    var P = ctx.providers || {};
    var lib = P.library || (P.current && P.current().library) || null;
    var id = ctx.lessonId || ctx.id || (ctx.params && ctx.params.id) || 'rhythms-af';
  
    /* AF lesson - the screen-09 default (handoff copy, verbatim). */
    var AF_DEFAULT = {
      id: id,
      title: 'Atrial fibrillation',
      category: 'Rhythms',
      tier: 'core',
      bookmarked: true,
      ecgFindingTags: ['Irregular R-R', 'No P waves', 'f-waves'],
      diagnosticCriteria: [
        'Irregularly irregular ventricular rhythm',
        'Absence of distinct P waves',
        'Fibrillatory waves, best seen in V1'
      ],
      pearl: "Ashman phenomenon - a wide beat after a long-short RR - is aberrancy, not a PVC. Don't over-call ectopy in AF.",
      pitfall: 'Coarse AF can mimic flutter. Regularity & a sawtooth baseline distinguish them.',
      quizCount: 5
    };
  
    /* Map a LibraryECG into the view-model, falling back to the AF default per-field. */
    function normalize(e) {
      if (!e) return AF_DEFAULT;
      var qs = e.quiz && e.quiz.questions ? e.quiz.questions.length : AF_DEFAULT.quizCount;
      return {
        id: e.id || id,
        title: e.title || AF_DEFAULT.title,
        category: e.category || AF_DEFAULT.category,
        tier: e.tier || AF_DEFAULT.tier,
        bookmarked: e.bookmarked != null ? !!e.bookmarked : AF_DEFAULT.bookmarked,
        ecgFindingTags: (e.ecgFindingTags && e.ecgFindingTags.length) ? e.ecgFindingTags : AF_DEFAULT.ecgFindingTags,
        diagnosticCriteria: (e.diagnosticCriteria && e.diagnosticCriteria.length) ? e.diagnosticCriteria : AF_DEFAULT.diagnosticCriteria,
        pearl: e.pearl || AF_DEFAULT.pearl,
        pitfall: e.pitfall || AF_DEFAULT.pitfall,
        quizCount: qs || AF_DEFAULT.quizCount
      };
    }
  
    function tierLabel(t) { t = String(t || ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  
    /* The lesson ECG strip (rhythm-strip art from the handoff; colour via CSS). */
    function ecgStrip() {
      return '<div class="kx-ecg kx-lesson-strip">' +
        '<svg class="kx-ecg-svg kx-lesson-ecg-svg" viewBox="0 0 320 80" width="100%" height="72" preserveAspectRatio="none" aria-hidden="true">' +
          '<defs><pattern id="kxEcgPaper09" width="8" height="8" patternUnits="userSpaceOnUse">' +
            '<path class="kx-ecg-grid" d="M8 0H0V8"></path></pattern></defs>' +
          '<rect width="320" height="80" fill="url(#kxEcgPaper09)"></rect>' +
          '<polyline class="kx-ecg-trace" points="0,48 10,46 18,50 26,47 30,48 33,52 36,26 39,60 42,48 60,47 72,50 84,48 88,48 91,52 94,26 97,60 100,48 118,47 130,48 134,48 137,52 140,28 143,60 146,48 172,47 190,48 194,52 197,26 200,60 203,48 230,47 250,48 254,52 257,27 260,60 263,48 290,47 306,48 310,52 313,27 316,60 320,48"></polyline>' +
        '</svg>' +
      '</div>';
    }
  
    function tagsHtml(vm) {
      return '<div class="kx-lesson-tags">' +
        vm.ecgFindingTags.map(function (t) {
          return '<span class="kx-lesson-tag kx-data">' + esc(t) + '</span>';
        }).join('') +
      '</div>';
    }
  
    function criteriaHtml(vm) {
      return '<div class="kx-lesson-label">Diagnostic criteria</div>' +
        '<div class="kx-lesson-crit-list">' +
          vm.diagnosticCriteria.map(function (c) {
            return '<div class="kx-lesson-crit">' +
              '<span class="kx-lesson-crit-ic">' + ic('check_circle') + '</span>' +
              '<span>' + esc(c) + '</span>' +
            '</div>';
          }).join('') +
        '</div>';
    }
  
    function pearlPitfallHtml(vm) {
      var out = '';
      if (vm.pearl) {
        out += '<div class="kx-lesson-note kx-lesson-note--pearl">' +
          '<div class="kx-lesson-note-hd">' + ic('lightbulb') + '<b>Clinical pearl</b></div>' +
          '<span>' + esc(vm.pearl) + '</span>' +
        '</div>';
      }
      if (vm.pitfall) {
        out += '<div class="kx-lesson-note kx-lesson-note--pitfall">' +
          '<div class="kx-lesson-note-hd">' + ic('error') + '<b>Common pitfall</b></div>' +
          '<span>' + esc(vm.pitfall) + '</span>' +
        '</div>';
      }
      return out;
    }
  
    function tutorBtn() {
      return '<button type="button" class="kx-lesson-tutor" data-act="kxnav:tutor">' +
        '<span class="kx-lesson-tutor-ic">' + ic('forum') + '</span>' +
        '<span class="kx-lesson-tutor-body">' +
          '<b>Ask the AI Tutor</b>' +
          '<span>"Why isn\'t this flutter?"</span>' +
        '</span>' +
        ic('chevron_right') +
      '</button>';
    }
  
    function quizBtn(vm) {
      return '<button type="button" class="kx-btn kx-btn-primary kx-lesson-quiz" data-act="kxnav:quiz">' +
        ic('quiz') + 'Take the quiz · <span class="kx-data">' + vm.quizCount + '</span> Q</button>';
    }
  
    function paint(vm) {
      var bmPressed = vm.bookmarked ? 'true' : 'false';
      var header =
        '<header class="kx-lesson-head">' +
          '<button type="button" class="kx-lesson-back" data-act="kxnav:back" aria-label="Back">' + ic('arrow_back') + '</button>' +
          '<div class="kx-lesson-titles">' +
            '<div class="kx-lesson-title">' + esc(vm.title) + '</div>' +
            '<div class="kx-lesson-sub">' + esc(vm.category) + ' · ' + esc(tierLabel(vm.tier)) + '</div>' +
          '</div>' +
          '<button type="button" class="kx-lesson-bm" data-act="kx-bookmark" aria-pressed="' + bmPressed + '" ' +
            'aria-label="' + (vm.bookmarked ? 'Remove bookmark' : 'Bookmark this lesson') + '">' + ic('bookmark') + '</button>' +
        '</header>';
  
      var tabs =
        '<div class="kx-lesson-tabs" role="tablist" aria-label="Lesson sections">' +
          '<button type="button" class="kx-lesson-tab is-active" role="tab" aria-selected="true"  data-tab="overview">Overview</button>' +
          '<button type="button" class="kx-lesson-tab"           role="tab" aria-selected="false" data-tab="ecg">ECG</button>' +
          '<button type="button" class="kx-lesson-tab"           role="tab" aria-selected="false" data-tab="quiz">Quiz</button>' +
        '</div>';
  
      var overview =
        '<section class="kx-lesson-panel is-active" role="tabpanel" data-panel="overview">' +
          ecgStrip() +
          tagsHtml(vm) +
          criteriaHtml(vm) +
          pearlPitfallHtml(vm) +
          tutorBtn() +
          quizBtn(vm) +
        '</section>';
  
      var ecgPanel =
        '<section class="kx-lesson-panel" role="tabpanel" data-panel="ecg" hidden>' +
          ecgStrip() +
          tagsHtml(vm) +
          criteriaHtml(vm) +
        '</section>';
  
      var quizPanel =
        '<section class="kx-lesson-panel" role="tabpanel" data-panel="quiz" hidden>' +
          '<div class="kx-lesson-quiz-intro">' +
            '<span class="kx-data">' + vm.quizCount + '</span> questions to check your recall of ' + esc(vm.title) + '.' +
          '</div>' +
          quizBtn(vm) +
        '</section>';
  
      host.innerHTML =
        '<div class="kx-lesson">' + header + tabs +
          '<div class="kx-lesson-body">' + overview + ecgPanel + quizPanel + '</div>' +
        '</div>';
  
      wire(vm);
    }
  
    /* Local interactions only - nav (kxnav:* / kardiox-*) bubbles to the router at #kardioxRoot. */
    function wire(vm) {
      function selectTab(name) {
        var tabsEls = host.querySelectorAll('.kx-lesson-tab');
        for (var i = 0; i < tabsEls.length; i++) {
          var on = tabsEls[i].getAttribute('data-tab') === name;
          tabsEls[i].classList.toggle('is-active', on);
          tabsEls[i].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        var panels = host.querySelectorAll('.kx-lesson-panel');
        for (var j = 0; j < panels.length; j++) {
          var show = panels[j].getAttribute('data-panel') === name;
          panels[j].classList.toggle('is-active', show);
          if (show) panels[j].removeAttribute('hidden'); else panels[j].setAttribute('hidden', '');
        }
      }
  
      function toggleBookmark(btn) {
        vm.bookmarked = !vm.bookmarked;
        btn.setAttribute('aria-pressed', vm.bookmarked ? 'true' : 'false');
        btn.setAttribute('aria-label', vm.bookmarked ? 'Remove bookmark' : 'Bookmark this lesson');
        if (lib && typeof lib.toggleBookmark === 'function') {
          try { Promise.resolve(lib.toggleBookmark(vm.id)); } catch (e) {}
        }
        if (typeof ctx.toast === 'function') ctx.toast(vm.bookmarked ? 'Bookmarked' : 'Bookmark removed');
      }
  
      host.onclick = function (e) {
        var tab = e.target.closest ? e.target.closest('.kx-lesson-tab') : null;
        if (tab && host.contains(tab)) { haptic('light'); selectTab(tab.getAttribute('data-tab')); return; }
        var bm = e.target.closest ? e.target.closest('[data-act="kx-bookmark"]') : null;
        if (bm && host.contains(bm)) { haptic('light'); toggleBookmark(bm); return; }
        /* kxnav:back / kxnav:quiz / kxnav:tutor bubble to the router - not handled here. */
      };
    }
  
    /* Render the AF default immediately, then hydrate live content when available. */
    paint(AF_DEFAULT);
    if (lib && typeof lib.ecg === 'function') {
      try {
        Promise.resolve(lib.ecg(id)).then(function (e) { if (e) paint(normalize(e)); }).catch(function () {});
      } catch (_) {}
    }
  }

  /* quiz */
  function render10(host, ctx){
    ctx = ctx || {};
    var providers = ctx.providers || {};
  
    // ── verbatim design fallback (KardioX AI.dc.html · screen 10) ──────────────
    var DESIGN_Q = {
      stem: 'What is the most likely rhythm?',
      options: ['Sinus tachycardia', 'Sinus rhythm, normal', 'Atrial fibrillation', '1st-degree AV block'],
      correctIndex: 1,
      explanation: 'Regular rhythm at a normal rate with an upright P wave before every QRS and a normal PR interval. That is normal sinus rhythm. Sinus tachycardia would be faster, AF would be irregularly irregular with no P waves, and 1st-degree AV block would show a prolonged PR.'
    };
    var DESIGN_STEM = '<svg viewBox="0 0 320 90" width="100%" preserveAspectRatio="none" focusable="false"><defs><pattern id="kxqz1" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="#f6d3d3" stroke-width="1"></path></pattern></defs><rect width="320" height="90" fill="url(#kxqz1)"></rect><polyline points="0,52 20,52 26,20 32,72 38,52 60,52 80,52 86,20 92,72 98,52 120,52 140,52 146,20 152,72 158,52 180,52 200,52 206,20 212,72 218,52 240,52 260,52 266,20 272,72 278,52 300,52 320,52" fill="none" stroke="#161616" stroke-width="1.6"></polyline></svg>';
  
    var state = { questions: [DESIGN_Q], isDesign: true, stem: null, i: 0, selected: null, submitted: false };
  
    // ── helpers ────────────────────────────────────────────────────────────────
    var icon = (typeof ic === 'function') ? ic : function(n){ return '<span class="msr">' + n + '</span>'; };
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
    function letter(i){ return String.fromCharCode(65 + i); }
    function haptic(kind){ try { var H = window.SMD_HAPTICS; if (H && typeof H[kind] === 'function') H[kind](); } catch (e) {} }
    function toast(msg){ try { if (typeof ctx.toast === 'function') ctx.toast(msg); } catch (e) {} }
  
    // ── shell (header stays; #kxq-body re-paints per question) ──────────────────
    host.innerHTML =
      '<div class="kx-quiz">' +
        '<div class="kx-quiz-top">' +
          '<button type="button" class="kx-quiz-close" data-act="back" aria-label="Close quiz">' + icon('close') + '</button>' +
          '<div class="kx-quiz-progress" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="100"><div class="kx-quiz-progress-fill"></div></div>' +
          '<span class="kx-quiz-timer"><span class="kx-quiz-timer-ic">' + icon('timer') + '</span><span class="kx-data">0:18</span></span>' +
        '</div>' +
        '<div class="kx-quiz-body" id="kxq-body"></div>' +
      '</div>';
  
    var progEl = host.querySelector('.kx-quiz-progress');
    var fillEl = host.querySelector('.kx-quiz-progress-fill');
    var bodyEl = host.querySelector('#kxq-body');
  
    function meta(){
      if (state.isDesign) return { idx: 3, total: 10, pct: 30 };
      var t = state.questions.length || 1;
      return { idx: state.i + 1, total: t, pct: Math.round(((state.i + 1) / t) * 100) };
    }
    function stemMarkup(){
      if (state.stem) return '<img class="kx-quiz-stem-img" src="' + esc(state.stem) + '" alt="ECG rhythm strip">';
      return DESIGN_STEM;
    }
  
    // ── paint one question ──────────────────────────────────────────────────────
    function paint(){
      var q = state.questions[state.i] || DESIGN_Q;
      var m = meta();
      fillEl.style.width = m.pct + '%';
      progEl.setAttribute('aria-valuenow', String(m.pct));
  
      var optsHtml = (q.options || []).map(function(o, idx){
        return '<button type="button" class="kx-quiz-option" role="radio" aria-checked="false" data-idx="' + idx + '">' +
                 '<span class="kx-quiz-radio">' +
                   '<span class="kx-quiz-letter">' + letter(idx) + '</span>' +
                   '<span class="kx-quiz-ico kx-quiz-ico-ok">' + icon('check') + '</span>' +
                   '<span class="kx-quiz-ico kx-quiz-ico-no">' + icon('close') + '</span>' +
                 '</span>' +
                 '<span class="kx-quiz-opt-label">' + esc(o) + '</span>' +
               '</button>';
      }).join('');
  
      bodyEl.innerHTML =
        '<div class="kx-quiz-meta">Question ' + m.idx + ' of ' + m.total + ' · Exam mode</div>' +
        '<div class="kx-quiz-stem" role="img" aria-label="ECG rhythm strip">' + stemMarkup() + '</div>' +
        '<h2 class="kx-quiz-q" id="kxq-q">' + esc(q.stem) + '</h2>' +
        '<div class="kx-quiz-options" id="kxq-opts" role="radiogroup" aria-labelledby="kxq-q">' + optsHtml + '</div>' +
        '<div class="kx-quiz-explain" id="kxq-explain" hidden></div>' +
        '<button type="button" class="kx-btn kx-btn-primary kx-quiz-submit" id="kxq-submit" disabled>Submit answer</button>';
  
      state.selected = null;
      state.submitted = false;
      bind(q);
    }
  
    // ── local listeners (host children only) ────────────────────────────────────
    function bind(q){
      var opts = Array.prototype.slice.call(bodyEl.querySelectorAll('.kx-quiz-option'));
      var submitBtn = bodyEl.querySelector('#kxq-submit');
      var container = bodyEl.querySelector('#kxq-opts');
      var isLast = state.i >= (state.questions.length - 1);
  
      opts.forEach(function(opt){
        opt.addEventListener('click', function(){
          if (state.submitted) return;
          state.selected = parseInt(opt.getAttribute('data-idx'), 10);
          opts.forEach(function(o){
            var on = o === opt;
            o.classList.toggle('is-selected', on);
            o.setAttribute('aria-checked', on ? 'true' : 'false');
          });
          submitBtn.disabled = false;
          haptic('selection');
        });
      });
  
      submitBtn.addEventListener('click', function(){
        // post-submit: primary becomes "Next question"
        if (state.submitted){ if (!isLast) advance(); return; }
        if (state.selected == null) return;
  
        state.submitted = true;
        var correct = q.correctIndex;
        var right = state.selected === correct;
  
        opts.forEach(function(o, idx){
          o.classList.remove('is-selected');
          o.setAttribute('aria-checked', idx === state.selected ? 'true' : 'false');
          if (idx === correct) o.classList.add('is-correct');
          if (idx === state.selected && idx !== correct) o.classList.add('is-incorrect');
        });
        container.classList.add('kx-quiz-locked');
  
        var ex = bodyEl.querySelector('#kxq-explain');
        ex.className = 'kx-quiz-explain ' + (right ? 'is-correct' : 'is-wrong');
        ex.hidden = false;
        var head = right
          ? '<div class="kx-quiz-explain-head">' + icon('check_circle') + '<b>Correct</b></div>'
          : '<div class="kx-quiz-explain-head">' + icon('cancel') + '<b>Not quite</b></div>';
        var ans = right ? '' :
          '<span class="kx-quiz-explain-answer">Correct answer: ' + letter(correct) + ' · ' + esc(q.options[correct]) + '</span>';
        ex.innerHTML = head + ans + '<p class="kx-quiz-explain-body">' + esc(q.explanation || '') + '</p>';
  
        if (right){ haptic('success'); toast('Correct - nice work'); }
        else { haptic('warning'); toast('Not quite - see the explanation'); }
  
        if (isLast){
          submitBtn.textContent = 'Quiz complete';
          submitBtn.disabled = true;
          submitBtn.classList.add('kx-quiz-done');
        } else {
          submitBtn.textContent = 'Next question';
          submitBtn.disabled = false;
        }
      });
    }
  
    function advance(){ state.i += 1; paint(); }
  
    // ── initial paint (instant, design-exact) then bind live data if available ──
    paint();
    resolveQuiz().then(function(res){
      if (res && res.questions && res.questions.length){
        state.questions = res.questions;
        state.isDesign = !!res.isDesign;
        state.stem = res.stem || null;
        state.i = 0;
        paint();
      }
    }).catch(function(){});
  
    // ── live-data resolver over ctx.providers ──────────────────────────────────
    function stemOf(ecg){
      try {
        var img = ecg && ecg.image && ecg.image.data;
        if (typeof img === 'string' && img.indexOf('data:') === 0) return img;
      } catch (e) {}
      return null;
    }
    function fromQuiz(quiz, ecg){
      if (quiz && Array.isArray(quiz.questions) && quiz.questions.length)
        return { questions: quiz.questions, isDesign: false, stem: stemOf(ecg) };
      return null;
    }
    async function resolveQuiz(){
      try {
        var a = ctx.analysis;
        if (a && a.quiz && Array.isArray(a.quiz.questions) && a.quiz.questions.length)
          return { questions: a.quiz.questions, isDesign: false, stem: stemOf(a) };
        if (a && Array.isArray(a.questions) && a.questions.length)
          return { questions: a.questions, isDesign: false, stem: stemOf(a) };
  
        var lib = providers.library;
        if (lib && typeof lib.ecg === 'function'){
          if (a && a.educationalRef){
            var e1 = await lib.ecg(a.educationalRef);
            var r1 = e1 && fromQuiz(e1.quiz, e1); if (r1) return r1;
          }
          var learn = providers.learning;
          if (learn && typeof learn.dailyChallenge === 'function'){
            try {
              var dc = await learn.dailyChallenge(new Date());
              if (dc && dc.id){
                var e2 = await lib.ecg(dc.id);
                var r2 = e2 && fromQuiz(e2.quiz, e2); if (r2) return r2;
              }
            } catch (e) {}
          }
          if (typeof lib.categories === 'function' && typeof lib.ecgs === 'function'){
            var cats = await lib.categories();
            if (cats && cats.length){
              var list = await lib.ecgs(cats[0]);
              if (list && list.length){
                var e3 = await lib.ecg(list[0].id);
                var r3 = e3 && fromQuiz(e3.quiz, e3); if (r3) return r3;
              }
            }
          }
        }
      } catch (e) {}
      return { questions: [DESIGN_Q], isDesign: true, stem: null };
    }
  }

  /* flashcards */
  /* ===== KardioX · Screen 11 - Flashcards (spaced repetition, SM-2) =====
   * Scoped under #kardioxRoot, classes .kx-fc-*. host = #kxScroll. Navigation via
   * data-act (router owns it); the flip + grade interactions are LOCAL listeners on host.
   * Register in the SCREENS map as:  flashcards: renderFlashcards
   * Reach it via the router (e.g. add `if (act === "kardiox-flashcards") { mount("flashcards"); return; }`
   * to onClick, or SMD_KARDIOX_ROUTER.nav("flashcards")).
   */
  function renderFlashcards(host, ctx) {
    ctx = ctx || {};
    var learning = (ctx.providers && ctx.providers.learning) || null;
  
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + "</span>"; }
  
    // SM-2 fresh-card intervals shown on the grade buttons (verbatim from the design/README).
    var GRADES = [
      { g: "again", label: "Again", ivl: "&lt;1m" },
      { g: "hard",  label: "Hard",  ivl: "6m" },
      { g: "good",  label: "Good",  ivl: "1d" },
      { g: "easy",  label: "Easy",  ivl: "4d" }
    ];
  
    var cards = [], idx = 0, total = 0, revealed = false, done = false, loaded = false;
  
    // Decorative ECG strip (pre-excited: short PR + delta wave) - art from the handoff, colors via CSS.
    function strip() {
      return (
        '<div class="kx-fc-strip">' +
          '<svg class="kx-fc-strip-svg" viewBox="0 0 300 70" width="100%" height="70" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs><pattern id="kxFcPaper" width="8" height="8" patternUnits="userSpaceOnUse">' +
              '<path class="kx-fc-strip-grid" d="M8 0H0V8"></path></pattern></defs>' +
            '<rect width="300" height="70" fill="url(#kxFcPaper)"></rect>' +
            '<polyline class="kx-fc-strip-trace" points="0,40 18,40 24,44 30,16 36,40 44,44 50,52 58,16 64,44 70,40 130,40 136,44 142,16 148,40 210,40 216,44 222,16 228,40 290,40 300,40"></polyline>' +
          '</svg>' +
        "</div>"
      );
    }
  
    function header(pos) {
      return (
        '<header class="kx-fc-head">' +
          '<button type="button" class="kx-fc-close" data-act="kardiox-back" aria-label="Back">' + ic("close") + "</button>" +
          '<div class="kx-fc-titles">' +
            '<div class="kx-fc-title">Smart revision</div>' +
            '<div class="kx-fc-sub">' + (loaded ? total : "…") + " cards due today</div>" +
          "</div>" +
          '<span class="kx-fc-count kx-data">' + pos + " / " + (loaded ? total : "…") + "</span>" +
        "</header>"
      );
    }
  
    function flipCard(card) {
      return (
        '<div class="kx-fc-cardwrap">' +
          '<button type="button" class="kx-fc-card' + (revealed ? " is-revealed" : "") + '" data-fc-flip ' +
                  'aria-pressed="' + (revealed ? "true" : "false") + '" ' +
                  'aria-label="' + (revealed ? "Answer shown, tap to flip back" : "Flashcard front, tap to reveal answer") + '">' +
            // Front face
            '<div class="kx-fc-face kx-fc-front" aria-hidden="' + (revealed ? "true" : "false") + '">' +
              '<span class="kx-fc-label">Front</span>' +
              strip() +
              '<div class="kx-fc-prompt">' + esc(card.front || "") + "</div>" +
              '<div class="kx-fc-spacer"></div>' +
              '<div class="kx-fc-hint">' + ic("touch_app") + "Tap to reveal answer</div>" +
            "</div>" +
            // Back face
            '<div class="kx-fc-face kx-fc-back" aria-hidden="' + (revealed ? "false" : "true") + '">' +
              '<span class="kx-fc-label kx-fc-label--back">Answer</span>' +
              '<div class="kx-fc-answer">' + esc(card.back || "") + "</div>" +
              '<div class="kx-fc-spacer"></div>' +
              '<div class="kx-fc-hint">' + ic("touch_app") + "Tap to flip back</div>" +
            "</div>" +
          "</button>" +
        "</div>"
      );
    }
  
    function gradeRow() {
      var btns = GRADES.map(function (x) {
        return (
          '<button type="button" class="kx-fc-grade is-' + x.g + '" data-fc-grade="' + x.g + '" ' +
                  'aria-label="' + x.label + ', next review in ' + x.ivl.replace("&lt;", "less than ") + '">' +
            '<span class="kx-fc-grade-t">' + x.label + "</span>" +
            '<span class="kx-fc-grade-i kx-data">' + x.ivl + "</span>" +
          "</button>"
        );
      }).join("");
      return (
        '<div class="kx-fc-grades-label">How well did you know it?</div>' +
        '<div class="kx-fc-grades" role="group" aria-label="Grade this card">' + btns + "</div>"
      );
    }
  
    function doneState() {
      var nil = total === 0;
      return (
        '<div class="kx-fc-done">' +
          '<span class="kx-fc-done-ic">' + ic(nil ? "inbox" : "task_alt") + "</span>" +
          "<h3>" + (nil ? "Nothing due right now" : "All caught up") + "</h3>" +
          "<p>" + (nil
            ? "You have no flashcards scheduled for review today. Check back later."
            : "You reviewed all " + total + " cards due today. Nice work.") + "</p>" +
          '<button type="button" class="kx-btn kx-btn-primary" data-act="kardiox-back">Back to Learn</button>' +
        "</div>"
      );
    }
  
    function loadingState() {
      return (
        '<div class="kx-fc-loading" role="status" aria-live="polite">' +
          '<span class="kx-fc-spin">' + ic("progress_activity") + "</span>" +
          "<span>Loading cards…</span>" +
        "</div>"
      );
    }
  
    function paint() {
      var pos, body;
      if (!loaded) { pos = "…"; body = loadingState(); }
      else if (done || idx >= cards.length) { pos = String(Math.min(idx, total)); body = doneState(); }
      else {
        pos = String(Math.min(idx + 1, total));
        body = flipCard(cards[idx]) + gradeRow();
      }
      host.innerHTML =
        '<section class="kx-fc">' + header(pos) + '<div class="kx-fc-body">' + body + "</div></section>";
    }
  
    function applyReveal() {
      var card = host.querySelector(".kx-fc-card");
      if (!card) return;
      card.classList.toggle("is-revealed", revealed);
      card.setAttribute("aria-pressed", revealed ? "true" : "false");
      var f = card.querySelector(".kx-fc-front"), b = card.querySelector(".kx-fc-back");
      if (f) f.setAttribute("aria-hidden", revealed ? "true" : "false");
      if (b) b.setAttribute("aria-hidden", revealed ? "false" : "true");
    }
  
    function doGrade(g) {
      if (done || idx >= cards.length) return;
      var card = cards[idx];
      if (!card) return;
      try {
        if (learning && typeof learning.grade === "function") {
          var p = learning.grade(card.id, g);       // SM-2: schedules next dueDate
          if (p && typeof p.then === "function") p.then(null, function () {});
        }
      } catch (_) {}
      try {
        if (ctx.toast) {
          var meta = GRADES.filter(function (x) { return x.g === g; })[0];
          ctx.toast(meta ? (meta.label + " · next in " + meta.ivl.replace("&lt;", "<")) : "Scheduled");
        }
      } catch (_) {}
      idx += 1;
      revealed = false;
      if (idx >= cards.length) done = true;
      paint();                                        // advance to the next due card
    }
  
    // Local delegation on host (router still owns [data-act]). Native <button> handles Enter/Space flip.
    host.onclick = function (e) {
      var g = e.target.closest ? e.target.closest("[data-fc-grade]") : null;
      if (g && host.contains(g)) { doGrade(g.getAttribute("data-fc-grade")); return; }
      var flip = e.target.closest ? e.target.closest("[data-fc-flip]") : null;
      if (flip && host.contains(flip)) { revealed = !revealed; applyReveal(); return; }
      // [data-act] (back / done) bubbles to the router at #kardioxRoot.
    };
  
    // Bind live data: ctx.providers.learning.dueFlashcards()
    paint(); // loading shell
    var due;
    try { due = learning && typeof learning.dueFlashcards === "function" ? learning.dueFlashcards() : []; }
    catch (_) { due = []; }
    Promise.resolve(due).then(function (list) {
      cards = Array.isArray(list) ? list.slice() : [];
      total = cards.length;
      idx = 0; revealed = false; done = total === 0; loaded = true;
      paint();
    }, function () {
      cards = []; total = 0; idx = 0; done = true; loaded = true; paint();
    });
  }

  /* daily */
  /* screen 12 - Daily challenge + achievements (handoff screen 12).
     host = #kxScroll; ctx = { providers, analysis, nav(id), close(), toast(msg) }.
     Navigation is delegation-only via data-act (router at #kardioxRoot):
       back  -> data-act="kxnav:back"   Start challenge -> data-act="kxnav:quiz"
     Live data is bound from ctx.providers.learning.{dailyChallenge,progress,achievements};
     handoff-exact defaults render synchronously and are only overwritten when data is present. */
  function render12(host, ctx) {
    if (!host) return;
    ctx = ctx || {};
    var P = ctx.providers ||
      (typeof window !== "undefined" && window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_PROVIDERS.current()) ||
      null;
  
    function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function noop() {}
  
    /* Handoff-exact defaults (survive in mock/preview; overwritten only when the provider returns data). */
    var DEF_WEEK  = [true, true, true, false, false, false, false];       // Mon–Sun
    var DEF_ACH   = [
      { id: "first10",  title: "First 10", icon: "workspace_premium", unlocked: true },
      { id: "streak10", title: "10-day",   icon: "local_fire_department", unlocked: true },
      { id: "stemi20",  title: "STEMI 20", icon: "military_tech", unlocked: false }
    ];
    var DEF_FOCUS = { name: "AV blocks", accuracyPct: 40, recommendedCards: 6 };
  
    var WK_LBL   = ["M", "T", "W", "T", "F", "S", "S"];
    var DIFF     = { foundational: "Foundational", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };
    var ACH_TONE = { workspace_premium: "gold", local_fire_department: "cardiac" };
  
    function diffLabel(d) { return DIFF[d] || "Intermediate"; }
  
    /* "This week" 7-day streak row: done cells = weeklyDone true; today (if not yet done) = current/bolt; rest empty. */
    function weekRow(prog) {
      var done  = (prog && Array.isArray(prog.weeklyDone)) ? prog.weeklyDone : DEF_WEEK;
      var today = (new Date().getDay() + 6) % 7;                          // Mon=0 … Sun=6
      var out = "";
      for (var i = 0; i < 7; i++) {
        var st = done[i] ? "done" : (i === today ? "current" : "empty");
        var glyph = st === "done" ? ic("check") : st === "current" ? ic("bolt") : "";
        var lcls = st === "current" ? " is-now" : st === "empty" ? " is-off" : "";
        out +=
          '<div class="kx-week-day">' +
            '<div class="kx-week-box is-' + st + '">' + glyph + '</div>' +
            '<div class="kx-week-l' + lcls + '">' + WK_LBL[i] + '</div>' +
          '</div>';
      }
      return out;
    }
  
    /* Achievements grid: unlocked = badge glyph + tone; locked = lock glyph + dimmed. */
    function achCell(a) {
      var locked = !a.unlocked;
      var icon = locked ? "lock" : (a.icon || "workspace_premium");
      var tone = locked ? "" : (ACH_TONE[a.icon] || "primary");
      return '' +
        '<div class="kx-ach' + (locked ? " is-locked" : "") + '">' +
          '<span class="kx-ach-ic' + (tone ? " kx-ach-ic--" + tone : "") + '">' + ic(icon) + '</span>' +
          '<div class="kx-ach-t">' + esc(a.title) + '</div>' +
        '</div>';
    }
  
    /* Focus-next (weakest topic) insight - copy verbatim from the handoff. */
    function focusInner(wt) {
      wt = wt || DEF_FOCUS;
      return '' +
        '<div class="kx-focus-head">' + ic("insights") + '<b class="kx-focus-title">Focus next: ' + esc(wt.name) + '</b></div>' +
        '<span class="kx-focus-body">Your weakest topic - <span class="kx-data">' + esc(wt.accuracyPct) + '</span>% accuracy. ' +
          '<span class="kx-data">' + esc(wt.recommendedCards) + '</span> cards recommended.</span>';
    }
  
    var TRACE_PTS = "0,30 20,30 26,10 32,44 38,30 90,30 96,10 102,44 108,30 170,30 176,10 182,44 188,30 250,30 256,10 262,44 268,30 300,30";
  
    host.innerHTML =
      '<div class="kx-rpt-head">' +
        '<button class="kx-rpt-back" type="button" data-act="kxnav:back" aria-label="Back">' + ic("arrow_back") + '</button>' +
        '<div class="kx-rpt-titles"><div class="kx-rpt-title">Today</div></div>' +
      '</div>' +
      '<div class="kx-daily">' +
  
        /* ECG of the Day - dark challenge card */
        '<div class="kx-dc-card">' +
          '<div class="kx-dc-in">' +
            '<span class="kx-dc-pill">' + ic("bolt") + 'ECG of the Day</span>' +
            '<svg class="kx-dc-trace" viewBox="0 0 300 54" preserveAspectRatio="none" aria-hidden="true">' +
              '<defs><pattern id="kxdc1" width="8" height="8" patternUnits="userSpaceOnUse">' +
                '<path d="M8 0H0V8" fill="none" stroke="#f6d3d3" stroke-width="1"></path>' +
              '</pattern></defs>' +
              '<rect width="300" height="54" fill="url(#kxdc1)"></rect>' +
              '<polyline points="' + TRACE_PTS + '" fill="none" stroke="#161616" stroke-width="1.5"></polyline>' +
            '</svg>' +
            '<div class="kx-dc-q">Can you diagnose this in 60s?</div>' +
            '<div class="kx-dc-meta"><span data-hook="diff">Intermediate</span> · <span class="kx-data">3,204</span> residents played today</div>' +
            '<button class="kx-dc-start" type="button" data-act="kxnav:quiz" data-hook="start">Start challenge' + ic("arrow_forward") + '</button>' +
          '</div>' +
        '</div>' +
  
        /* This week */
        '<div class="kx-sec-head"><span class="kx-sec-title">This week</span></div>' +
        '<div class="kx-week" data-hook="week">' + weekRow(null) + '</div>' +
  
        /* Achievements */
        '<div class="kx-sec-head"><span class="kx-sec-title">Achievements</span></div>' +
        '<div class="kx-ach-grid" data-hook="ach">' + DEF_ACH.map(achCell).join("") + '</div>' +
  
        /* Focus-next insight */
        '<div class="kx-focus" data-hook="focus">' + focusInner(null) + '</div>' +
  
      '</div>';
  
    /* ── Async hydration (providers are async; the render above is synchronous). ── */
    if (P && P.learning) {
      try {
        if (P.learning.progress) {
          Promise.resolve(P.learning.progress()).then(function (pr) {
            if (!pr) return;
            var w = host.querySelector('[data-hook="week"]');
            if (w) w.innerHTML = weekRow(pr);
            var f = host.querySelector('[data-hook="focus"]');
            if (f) {
              if (pr.weakestTopic) { f.innerHTML = focusInner(pr.weakestTopic); f.hidden = false; }
              else { f.hidden = true; }
            }
          }).catch(noop);
        }
        if (P.learning.achievements) {
          Promise.resolve(P.learning.achievements()).then(function (list) {
            if (!Array.isArray(list) || !list.length) return;
            var g = host.querySelector('[data-hook="ach"]');
            if (g) g.innerHTML = list.map(achCell).join("");
          }).catch(noop);
        }
        if (P.learning.dailyChallenge) {
          Promise.resolve(P.learning.dailyChallenge(new Date())).then(function (ch) {
            if (!ch) return;
            var d = host.querySelector('[data-hook="diff"]');
            if (d && ch.difficulty) d.textContent = diffLabel(ch.difficulty);
            var b = host.querySelector('[data-hook="start"]');
            if (b && ch.id) b.setAttribute("data-id", ch.id);
          }).catch(noop);
        }
      } catch (e) {}
    }
  }

  /* ===== Router (SMD_KARDIOX_ROUTER) — all 18 screens + nav stack + pipeline + rule fusion ===== */
  var SCREENS = {
    landing: renderLanding,
    source: render03,
    permission: render16,
    processing: render04,
    analysis: render05,
    report: render06,
    why: render07,
    history: render13,
    comparison: render14,
    privacy: render15,
    settings: render17,
    empty: render18,
    states: render19,
    library: render08,
    lesson: render09,
    quiz: render10,
    flashcards: renderFlashcards,
    daily: render12
  };
  var state = { analysis: null, running: false, lessonId: null, stack: [] };
  function providers() { try { return window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_PROVIDERS.current(); } catch (e) { return null; } }
  function host() { return document.getElementById("kxScroll"); }
  function reduceMotion() { try { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function sample() { try { var M = window.SMD_KARDIOX_MODELS; return M ? M.makeAnalysis(M.samples.afWithRvr) : null; } catch (e) { return null; } }
  function ctx() { var id = state.lessonId; return { providers: providers(), analysis: state.analysis, nav: go, close: closeMod, toast: toast, leadCount: 12, leads: 12, reduceMotion: reduceMotion(), lessonId: id, ecgId: id, id: id }; }
  function show(key) { var h = host(), fn = SCREENS[key]; if (!h || !fn) return; try { fn(h, ctx()); } catch (e) { try { console.warn("[KardioX] screen " + key, e); } catch (_) {} } try { h.scrollTop = 0; } catch (_) {} }
  function go(key) { key = String(key || ""); if (key.indexOf("kxnav:") === 0) key = key.slice(6); if (!SCREENS[key]) { deferred(key); return; } if (state.stack[state.stack.length - 1] !== key) state.stack.push(key); show(key); }
  function back() { state.stack.pop(); var prev = state.stack[state.stack.length - 1] || "landing"; show(prev); }
  function mountLanding(h) { init(); state.stack = ["landing"]; try { SCREENS.landing(h || host(), ctx()); } catch (e) { try { console.warn("[KardioX] landing", e); } catch (_) {} } }
  function closeMod() { try { if (window.KARDIOX && KARDIOX.close) KARDIOX.close(); } catch (e) {} }
  function deferred(key) { var m = { export: "Export", tutor: "AI Tutor", storage: "Storage detail" }; toast((m[key] || "That") + " arrives in a later KardioX update."); }

  // Enrich an analysis with the deterministic RuleValidator (matched criteria + confidence cap).
  function enrich(a) {
    try { var R = window.SMD_KARDIOX_RULES; if (R && a) { var v = R.validate(R.featuresFromAnalysis(a)); if (v.confidenceCapped && typeof a.confidence === "number") a.confidence = Math.min(a.confidence, v.confidence); if (!a.whatToVerify) a.whatToVerify = v.whatToVerify; a.ruleCriteria = v.matched; } } catch (e) {}
    return a;
  }
  function runPipeline(image) {
    if (state.running) return; state.running = true;
    var P = providers(); show("processing");
    if (!P || !P.analyzer) { state.running = false; return; }
    var moved = false;
    P.analyzer.analyze(image || { id: "kx-" + Date.now(), source: "photoLibrary" }, function (stage, pct) {
      if (!moved && (stage === "rhythm" || pct >= 45)) { moved = true; show("analysis"); }
    }).then(function (a) {
      state.analysis = enrich(a); state.running = false;
      try { if (P.ecgStore && P.ecgStore.save) P.ecgStore.save(a); } catch (e) {}
      go("report"); haptic("success");
      if (a && (a.severity === "urgent" || a.severity === "critical")) haptic("warning");
    }).catch(function () { state.running = false; toast("Couldn't read this ECG. Retake with all 12 leads flat in frame."); show("source"); });
  }
  function openStored(id) {
    var P = providers();
    var p = (P && P.ecgStore && P.ecgStore.get) ? Promise.resolve(P.ecgStore.get(id)) : Promise.resolve(null);
    p.then(function (a) { state.analysis = enrich(a || sample()); go("report"); }).catch(function () { state.analysis = enrich(sample()); go("report"); });
  }
  function clearEcgs() {
    var P = providers(); if (!P || !P.ecgStore) return;
    var okc = true; try { okc = window.confirm ? window.confirm("Clear all local ECGs? This permanently deletes every stored ECG + its key and cannot be undone.") : true; } catch (e) {}
    if (!okc) return;
    Promise.resolve(P.ecgStore.deleteAll()).then(function () { toast("Local ECGs cleared."); state.analysis = null; show("settings"); }).catch(function () { toast("Couldn't clear ECGs."); });
  }
  function toggleConfidence() { try { var F = window.SMD_KARDIOX_FLAGS; if (F) { F.set("smd_kardiox_confidence", !F.bool("smd_kardiox_confidence")); toast("Confidence display " + (F.bool("smd_kardiox_confidence") ? "on" : "off") + "."); show("settings"); } } catch (e) {} }
  function toggleBookmark() { var P = providers(); if (P && P.library && state.lessonId) { Promise.resolve(P.library.toggleBookmark(state.lessonId)).then(function () { haptic("light"); }); } }

  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act") || "";
    switch (act) {
      case "kardiox-close": haptic("light"); closeMod(); return;
      case "kardiox-back": case "kxnav:back": case "kx-back": case "back": haptic("light"); back(); return;
      case "kardiox-add": haptic("light"); go("source"); return;
      case "kardiox-learn": haptic("light"); go("library"); return;
      case "kardiox-daily": go("daily"); return;
      case "kardiox-quiz": case "kxnav:quiz": go("quiz"); return;
      case "kardiox-history": go("history"); return;
      case "kardiox-settings": go("settings"); return;
      case "kxnav:compare": go("comparison"); return;
      case "kxnav:privacy": go("privacy"); return;
      case "kxnav:settings": case "kxnav:storage": go("settings"); return;
      case "kxnav:why": haptic("light"); go("why"); return;
      case "kx-source": case "kardiox-pick": case "kardiox-cam-allow": haptic("light"); runPipeline({ id: "kx-" + Date.now(), source: t.getAttribute("data-src") || "photoLibrary" }); return;
      case "kardiox-cam-deny": case "kardiox-retry": show("source"); return;
      case "kardiox-open": case "report": openStored(t.getAttribute("data-id")); return;
      case "kxnav:lesson": state.lessonId = t.getAttribute("data-id"); haptic("light"); go("lesson"); return;
      case "kx-clear-ecgs": clearEcgs(); return;
      case "kx-toggle-confidence": toggleConfidence(); return;
      case "kx-bookmark": toggleBookmark(); return;
    }
    if (act.indexOf("kxnav:") === 0) { deferred(act.slice(6)); return; }
    /* other data-act values are screen-internal (chips, quiz options, flip, tabs) — screens handle them. */
  }
  function init() { var r = document.getElementById("kardioxRoot"); if (r && !r._kxWired) { r._kxWired = true; r.addEventListener("click", onClick); } wireSignout(); }

  // Sign-out wipe hook (README privacy contract): wipe the encrypted store on StewardMD sign-out.
  function wipe() { try { var P = providers(); if (P && P.ecgStore && P.ecgStore.deleteAll) P.ecgStore.deleteAll(); } catch (e) {} }
  var _signoutWired = false;
  function wireSignout() {
    if (_signoutWired || typeof window === "undefined") return; _signoutWired = true;
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) { try { window.addEventListener(ev, wipe); } catch (e) {} });
    window.SMD_KARDIOX_WIPE = wipe;   // StewardMD sign-out can call this directly. 🔧 hook the real signout.
  }

  if (typeof window !== "undefined") window.SMD_KARDIOX_ROUTER = { mountLanding: mountLanding, nav: go, runPipeline: runPipeline, wipe: wipe };

})();
