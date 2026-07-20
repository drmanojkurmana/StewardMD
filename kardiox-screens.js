/* kardiox-screens.js — KardioX AI · screens 02-07 + 16 + router (M2).
 *
 * ASSEMBLED from the M2 build workflow (7 screen render functions, each adversarially verified for
 * #kardioxRoot/.kx-* scoping, copy fidelity, and data-binding) + a hand-written router that owns click
 * delegation and the mock analysis pipeline (source -> processing -> analysis -> report -> why). All
 * markup is scoped under #kardioxRoot; navigation is via data-act (no per-screen document listeners).
 * Copy is de-dashed per StewardMD's no-em-dash policy. Exposed as window.SMD_KARDIOX_ROUTER.
 */
(function () {
  "use strict";
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function haptic(k) { try { if (window.SMD_KARDIOX_FLAGS && window.SMD_KARDIOX_FLAGS.bool("smd_kardiox_haptics") && window.SMD_HAPTICS && window.SMD_HAPTICS[k]) window.SMD_HAPTICS[k](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); else if (window.SMD_toast) SMD_toast(m); } catch (e) {} }

  /* screen 02-landing */
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

  /* screen 03 */
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

  /* screen 16 */
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

  /* screen 04 */
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

  /* screen 05 */
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

  /* screen 06 */
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
            '<span class="kx-ai-mark">' + ic("auto_awesome") + 'KardioX AI</span>' +
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
  
    var body =
      '<div class="kx-rpt-body">' +
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

  /* screen 07 */
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

  /* ===== Router (SMD_KARDIOX_ROUTER) — owns click delegation + the mock analysis pipeline ===== */
  var SCREENS = {
    landing: renderLanding,
    source: render03,
    permission: render16,
    processing: render04,
    analysis: render05,
    report: render06,
    why: render07
  };
  var state = { analysis: null, running: false };
  function providers() { try { return window.SMD_KARDIOX_PROVIDERS && window.SMD_KARDIOX_PROVIDERS.current(); } catch (e) { return null; } }
  function host() { return document.getElementById("kxScroll"); }
  function reduceMotion() { try { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function sample() { try { var M = window.SMD_KARDIOX_MODELS; return M ? M.makeAnalysis(M.samples.afWithRvr) : null; } catch (e) { return null; } }
  function ctx() { return { providers: providers(), analysis: state.analysis, nav: nav, close: closeMod, toast: toast, leadCount: 12, leads: 12, reduceMotion: reduceMotion() }; }
  function mount(key) { var h = host(), fn = SCREENS[key]; if (!h || !fn) return; try { fn(h, ctx()); } catch (e) { try { console.warn("[KardioX] screen " + key, e); } catch (_) {} } try { h.scrollTop = 0; } catch (_) {} }
  function mountLanding(h) { init(); try { SCREENS.landing(h || host(), ctx()); } catch (e) { try { console.warn("[KardioX] landing", e); } catch (_) {} } }
  function closeMod() { try { if (window.KARDIOX && KARDIOX.close) KARDIOX.close(); } catch (e) {} }
  function deferred(key) {
    var m = { learn: "Learn ECG", library: "Learn ECG", daily: "Daily Challenge", quiz: "Quiz Mode", history: "History", settings: "Settings", compare: "Comparison", export: "Export", share: "Share", note: "Physician note" };
    toast((m[key] || "That") + " arrives in a later KardioX update.");
  }
  function nav(key) { if (!key) return; key = String(key); if (key.indexOf("kxnav:") === 0) key = key.slice(6); if (SCREENS[key]) mount(key); else if (key === "back") mount("landing"); else if (key === "add") mount("source"); else deferred(key); }
  function runPipeline(image) {
    if (state.running) return; state.running = true;
    var P = providers(); mount("processing");
    if (!P || !P.analyzer) { state.running = false; return; }
    var moved = false;
    P.analyzer.analyze(image || { id: "kx-" + Date.now(), source: "photoLibrary" }, function (stage, pct) {
      if (!moved && (stage === "rhythm" || pct >= 45)) { moved = true; mount("analysis"); }
    }).then(function (a) {
      state.analysis = a; state.running = false;
      try { if (P.ecgStore && P.ecgStore.save) P.ecgStore.save(a); } catch (e) {}
      mount("report"); haptic("success");
      if (a && (a.severity === "urgent" || a.severity === "critical")) haptic("warning");
    }).catch(function () { state.running = false; toast("Couldn't read this ECG. Retake with all 12 leads flat in frame."); mount("source"); });
  }
  function openStored(id) {
    var P = providers();
    var p = (P && P.ecgStore && P.ecgStore.get) ? Promise.resolve(P.ecgStore.get(id)) : Promise.resolve(null);
    p.then(function (a) { state.analysis = a || sample(); mount("report"); }).catch(function () { state.analysis = sample(); mount("report"); });
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest("[data-act]"); if (!t) return;
    var act = t.getAttribute("data-act") || "";
    if (act === "kardiox-close") { haptic("light"); closeMod(); return; }
    if (act === "kardiox-back" || act === "kxnav:back") { haptic("light"); mount("landing"); return; }
    if (act === "kardiox-add") { haptic("light"); mount("source"); return; }
    if (act === "kardiox-learn") { deferred("learn"); return; }
    if (act === "kardiox-daily") { deferred("daily"); return; }
    if (act === "kardiox-quiz") { deferred("quiz"); return; }
    if (act === "kardiox-history") { deferred("history"); return; }
    if (act === "kardiox-settings") { deferred("settings"); return; }
    if (act === "kx-source" || act === "kardiox-pick" || act === "kardiox-cam-allow") { haptic("light"); runPipeline({ id: "kx-" + Date.now(), source: t.getAttribute("data-src") || "photoLibrary" }); return; }
    if (act === "kardiox-cam-deny" || act === "kardiox-retry") { mount("source"); return; }
    if (act === "kardiox-open" || act === "report") { openStored(t.getAttribute("data-id")); return; }
    if (act === "kxnav:why") { haptic("light"); mount("why"); return; }
    if (act.indexOf("kxnav:") === 0) { deferred(act.slice(6)); return; }
    /* other data-act values are screen-internal (chips etc.) — screens handle their own. */
  }
  function init() { var r = document.getElementById("kardioxRoot"); if (r && !r._kxWired) { r._kxWired = true; r.addEventListener("click", onClick); } }
  if (typeof window !== "undefined") window.SMD_KARDIOX_ROUTER = { mountLanding: mountLanding, nav: nav, runPipeline: runPipeline };

})();
