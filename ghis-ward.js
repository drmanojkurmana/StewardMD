/* StewardMD — GHIS Ward Sync (drop-in module)
 * Auto-injects the 🏥 Ward button, per-doctor GHIS login, lab drawer + radiology.
 * Backend: same-origin /api/ghis (Cloudflare Pages Function) in production;
 *          http://localhost:3456 on localhost for dev. Override via window.GHIS_PROXY.
 * Each doctor signs in with their own GHIS id/password (never stored); the
 * session is short-lived and the ⏻ button logs out.
 *
 * Use:  <script src="ghis-ward.js"></script>   (place before </body>)
 * Optional: set  window.GHIS_BUTTON_SELECTOR = '#myHeader'  BEFORE this script
 *           to mount the button inside your own header instead of floating.
 * Generated from StewardMD v4 — do not edit by hand; regenerate from source.
 */
(function () {
  if (window.__ghisWardLoaded) return;
  window.__ghisWardLoaded = true;
  function wIco(n){ return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  var CSS = "#ghisPanel {\n  position: fixed; inset: 0; z-index: 18000;\n  background: var(--paper, #ffffff); display: flex; flex-direction: column;\n  transform: translateX(100%);\n  transition: transform 0.3s cubic-bezier(.4,0,.2,1);\n}\n#ghisPanel.open { transform: translateX(0); }\n.ghis-header {\n  display: flex; align-items: center; gap: 10px;\n  padding: calc(14px + env(safe-area-inset-top)) 16px 14px; border-bottom: 1px solid var(--line, #e2e8f0);\n  background: var(--panel, #f8fafc); flex-shrink: 0;\n}\n.ghis-back { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--teal, #14b8a6); padding: 4px 8px; }\n.ghis-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--ink, #0f172a); display: flex; align-items: center; gap: 8px; }\n.ghis-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }\n.ghis-dot-off { background: #aaa; }\n.ghis-dot-on { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }\n.ghis-refresh-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 16px; color: var(--teal, #14b8a6); padding: 4px 10px; }\n.ghis-body { flex: 1; overflow-y: auto; padding: 16px; }\n.ghis-setup-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 14px; padding: 20px; max-width: 480px; margin: 20px auto; }\n.ghis-setup-title { font-size: 15px; font-weight: 700; color: var(--ink, #0f172a); margin-bottom: 14px; }\n.ghis-setup-sub { font-size: 12px; color: var(--slate, #64748b); margin: -8px 0 14px; }\n.ghis-login-input { width: 100%; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 14px; padding: 11px; box-sizing: border-box; margin-bottom: 10px; }\n.ghis-login-input:focus { outline: none; border-color: var(--teal, #14b8a6); }\n.ghis-remember { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--slate, #64748b); margin-bottom: 4px; cursor: pointer; }\n.ghis-remember input { width: 15px; height: 15px; }\n.ghis-setup-steps { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }\n.ghis-step { font-size: 13px; color: var(--slate, #64748b); display: flex; gap: 10px; align-items: flex-start; }\n.ghis-step-num { background: var(--teal, #14b8a6); color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }\n.ghis-step code { background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 5px; padding: 1px 5px; font-size: 12px; color: var(--teal, #14b8a6); }\n.ghis-cookie-input { width: 100%; min-height: 80px; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 11px; padding: 8px; box-sizing: border-box; resize: vertical; font-family: monospace; }\n.ghis-connect-btn { margin-top: 10px; width: 100%; background: var(--teal, #14b8a6); color: #fff; border: none; border-radius: 10px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }\n.ghis-connect-btn:hover { opacity: 0.88; }\n.ghis-setup-error { color: #ef4444; font-size: 12px; margin-top: 8px; min-height: 16px; }\n.ghis-logout-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--slate, #64748b); padding: 6px 10px; }\n.ghis-filter-row { display: flex; gap: 8px; margin-bottom: 8px; }\n.ghis-filter-input { flex: 1; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 12px; font-size: 13px; }\n.ghis-filter-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }\n@media (min-width: 560px) { .ghis-filter-row2 { grid-template-columns: 1fr 1fr 1fr 1fr; } }\n.ghis-filter-sel { min-width: 0; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 10px; font-size: 12.5px; cursor: pointer; }\n.ghis-filter-sel:focus { outline: none; border-color: var(--teal, #14b8a6); }\n.ghis-count { font-size: 12px; color: var(--slate, #64748b); margin: 0 2px 10px; font-weight: 600; }\n.ghis-pt-list { display: flex; flex-direction: column; gap: 8px; }\n.ghis-pt-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: border-color 0.15s; }\n.ghis-pt-card:hover { border-color: var(--teal, #14b8a6); }\n.ghis-pt-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }\n.ghis-pt-name { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-pt-status { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; white-space: nowrap; }\n.ghis-status-occupied { background: #dcfce7; color: #16a34a; }\n.ghis-status-bed { background: #fef9c3; color: #b45309; }\n.ghis-status-discharge { background: #fee2e2; color: #dc2626; }\n.ghis-status-other { background: var(--paper, #ffffff); color: var(--slate, #64748b); }\n.ghis-pt-meta { font-size: 12px; color: var(--slate, #64748b); margin-top: 4px; }\n.ghis-pt-dept { font-size: 12px; color: var(--teal, #14b8a6); font-weight: 600; margin-top: 2px; }\n.ghis-pt-actions { margin-top: 10px; }\n.ghis-pt-call { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--teal, #14b8a6); background: transparent; color: var(--teal, #14b8a6); font: 700 12px var(--sans, system-ui); padding: 7px 14px; border-radius: 8px; cursor: pointer; }\n.ghis-pt-call:active { transform: scale(0.96); }\n.ghis-pt-call:disabled { opacity: 0.5; }\n.ghis-pt-call svg { width: 15px; height: 15px; }\n.ghis-loading { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n.ghis-empty { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n/* Lab drawer */\n#ghisWard { position: relative; }\n.ghis-lab-drawer { position: fixed; inset: 0; background: var(--paper, #ffffff); z-index: 18001; display: flex; flex-direction: column; }\n.ghis-lab-header { display: flex; align-items: center; gap: 10px; padding: calc(12px + env(safe-area-inset-top)) 16px 12px; border-bottom: 1px solid var(--line, #e2e8f0); background: var(--panel, #f8fafc); flex-shrink: 0; }\n.ghis-back-sm { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--teal, #14b8a6); font-weight: 700; padding: 4px 8px; }\n.ghis-lab-title { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-lab-body { padding: 14px 16px; flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }\n.ghis-lab-group { margin-bottom: 14px; }\n.ghis-lab-group-name { font-size: 12px; font-weight: 700; color: var(--teal, #14b8a6); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }\n.ghis-lab-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line, #e2e8f0); font-size: 13px; }\n.ghis-lab-test { color: var(--ink, #0f172a); }\n.ghis-lab-val { font-weight: 700; }\n.ghis-lab-val.abnormal { color: #ef4444; }\n.ghis-lab-date { font-size: 11px; color: var(--slate, #64748b); }\n.ghis-lab-empty { color: var(--slate, #64748b); font-size: 13px; text-align: center; padding: 20px; }\n.ghis-lab-count { font-size: 12px; color: var(--slate, #64748b); margin-bottom: 10px; }\n.ghis-lab-order { border: 1px solid var(--line, #e2e8f0); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; transition: background .12s; }\n.ghis-lab-order:hover { background: rgba(20,184,166,0.05); }\n.ghis-lab-order.open { border-color: var(--teal, #14b8a6); background: rgba(20,184,166,0.04); }\n.ghis-lab-order-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.ghis-lab-order-name { font-weight: 600; font-size: 13px; color: var(--ink, #0f172a); }\n.ghis-lab-order-dept { font-size: 11px; color: var(--slate, #64748b); white-space: nowrap; }\n.ghis-lab-detail { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--line, #e2e8f0); }\n.ghis-lab-detail-empty { color: var(--slate, #64748b); font-size: 12px; padding: 6px 0; }\n.ghis-lab-abx { font-size: 12px; color: var(--ink, #0f172a); background: rgba(20,184,166,0.06); border-radius: 6px; padding: 6px 8px; margin: 4px 0 8px; white-space: pre-wrap; }\n.ghis-lab-section-title { font-size: 13px; font-weight: 700; color: var(--ink, #0f172a); margin: 4px 0 10px; }\n.ghis-rad-order { border-color: rgba(99,102,241,0.35); }\n.ghis-rad-order:hover { background: rgba(99,102,241,0.05); }\n.ghis-rad-order.open { border-color: #6366f1; background: rgba(99,102,241,0.05); }\n.ghis-rad-meta { font-size: 11px; color: var(--slate, #64748b); margin-bottom: 6px; }\n.ghis-rad-report { font-size: 13px; line-height: 1.5; color: var(--ink, #0f172a); white-space: pre-wrap; }\n.ghis-rad-divider { height: 1px; background: var(--line, #e2e8f0); margin: 14px 0; }\n/* dark mode overrides */\nbody.dark .ghis-status-occupied { background: #14532d; color: #86efac; }\nbody.dark .ghis-status-bed { background: #451a03; color: #fcd34d; }\nbody.dark .ghis-status-discharge { background: #450a0a; color: #fca5a5; }\n\n.ghis-ward-fab {\n  position: fixed; bottom: calc(20px + env(safe-area-inset-bottom)); right: 20px; z-index: 17000;\n  display: inline-flex; align-items: center; gap: 6px;\n  padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;\n  background: var(--teal, #14b8a6); color: #fff; font-size: 14px; font-weight: 600;\n  box-shadow: 0 4px 14px rgba(0,0,0,0.18); font-family: inherit;\n}\n.ghis-ward-fab:hover { filter: brightness(1.05); }\n/* App-consistent header + control icons (SVG, no emoji) */\n#ghisPanel .ghis-header svg { width: 20px; height: 20px; }\n.ghis-back, .ghis-refresh-btn { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 50%; padding: 0; transition: transform .1s ease; }\n.ghis-back { border: 1px solid var(--line, #e2e8f0); background: var(--paper, #fff); color: var(--teal, #14b8a6); }\n.ghis-back:active, .ghis-refresh-btn:active, .ghis-logout-btn:active { transform: scale(0.93); }\n.ghis-title svg { width: 20px; height: 20px; color: var(--teal, #14b8a6); flex: 0 0 auto; }\n.ghis-flip { display: inline-flex; }\n.ghis-flip svg { transform: scaleX(-1); }\n.ghis-logout-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; }\n.ghis-logout-btn svg { width: 18px; height: 18px; }\n.ghis-back-sm { display: inline-flex; align-items: center; gap: 5px; }\n.ghis-back-sm svg { width: 15px; height: 15px; }\n";
  var PANEL_HTML = "<div id=\"ghisPanel\">\n  <div class=\"ghis-header\">\n    <button class=\"ghis-back\" onclick=\"closeGHIS();try{window.SMD_showHome&&window.SMD_showHome()}catch(e){}\" aria-label=\"Back to home\">{{ic:back}}</button>\n    <div class=\"ghis-title\">{{ic:ward}} Ward Sync <span id=\"ghisConnDot\" class=\"ghis-dot ghis-dot-off\"></span></div>\n    <button class=\"ghis-refresh-btn\" id=\"ghisWatchedBtn\" onclick=\"if(window.SMD_WATCH&&window.SMD_WATCH.openManager)window.SMD_WATCH.openManager();else alert('Sign in with your Google/Apple account to see watched patients.')\" title=\"Lab Watch 24/7, background lab alerts\" aria-label=\"Lab Watch\">{{ic:bell}}</button>\n    <button class=\"ghis-refresh-btn\" id=\"ghisRefreshBtn\" onclick=\"ghisRefresh()\" title=\"Refresh\" aria-label=\"Refresh\">{{ic:refresh}}</button>\n  </div>\n\n  <div id=\"ghisSetup\" class=\"ghis-body\">\n    <div class=\"ghis-setup-card\">\n      <div class=\"ghis-setup-title\">Sign in to GHIS</div>\n      <div class=\"ghis-setup-sub\">Use your own GITAM HIS login.</div>\n      <input id=\"ghisUserId\" class=\"ghis-login-input\" type=\"text\" autocomplete=\"username\" placeholder=\"GHIS User ID\">\n      <input id=\"ghisPassword\" class=\"ghis-login-input\" type=\"password\" autocomplete=\"current-password\" placeholder=\"Password\"\n             onkeydown=\"if(event.key==='Enter') ghisConnect()\">\n      <div class=\"ghis-setup-sub\" style=\"margin:2px 0 12px\">Your password is used only to sign in and is never stored on our servers. If your session times out, just sign in again.</div>\n      <button class=\"ghis-connect-btn\" onclick=\"ghisConnect()\">Sign in</button>\n      <div id=\"ghisSetupError\" class=\"ghis-setup-error\"></div>\n    </div>\n  </div>\n\n  <div id=\"ghisWard\" class=\"ghis-body\" style=\"display:none;\">\n    <div id=\"ghisAddTarget\" style=\"display:none;align-items:center;box-sizing:border-box;margin:0 0 10px;padding:8px 10px;border:1px solid var(--line,#e4eae8);border-radius:10px;background:var(--paper,#f6f8f6)\"></div>\n    <div class=\"ghis-filter-row\">\n      <input id=\"ghisSearchPt\" class=\"ghis-filter-input\" placeholder=\"Search patient ID or name…\" oninput=\"ghisApplyFilters()\" />\n      <button class=\"ghis-logout-btn\" onclick=\"ghisDisconnect()\" title=\"Sign out\" aria-label=\"Sign out\">{{ic:logout}}</button>\n    </div>\n    <div class=\"ghis-filter-row2\">\n      <select id=\"ghisFBranch\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by branch/department\"><option value=\"\">All branches</option></select>\n      <select id=\"ghisFDoctor\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by treating doctor\"><option value=\"\">All doctors</option></select>\n      <select id=\"ghisFGender\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by gender\"><option value=\"\">All genders</option><option value=\"m\">Male</option><option value=\"f\">Female</option></select>\n      <select id=\"ghisFSort\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Sort patients\"><option value=\"\">Default order</option><option value=\"name\">Name A–Z</option><option value=\"branch\">Branch</option><option value=\"doctor\">Doctor</option><option value=\"bed\">Bed</option></select>\n    </div>\n    <div id=\"ghisCount\" class=\"ghis-count\"></div>\n\n    <div id=\"ghisPatientList\" class=\"ghis-pt-list\"></div>\n\n    <div id=\"ghisLabDrawer\" class=\"ghis-lab-drawer\" style=\"display:none;\">\n      <div class=\"ghis-lab-header\">\n        <button class=\"ghis-back-sm\" onclick=\"closeLabDrawer()\">{{ic:back}} Back</button>\n        <div class=\"ghis-lab-title\" id=\"ghisLabTitle\"></div>\n      </div>\n      <div id=\"ghisLabBody\" class=\"ghis-lab-body\"></div>\n    </div>\n  </div>\n</div>";

  function inject() {
    if (document.getElementById('ghisPanel')) return;
    var style = document.createElement('style');
    style.setAttribute('data-ghis', '1');
    style.textContent = CSS;
    document.head.appendChild(style);

    var holder = document.createElement('div');
    // Swap {{ic:name}} tokens for the app's shared SVG icon set (no emoji, per house style).
    // "back" reuses the arrow icon flipped horizontally (no dedicated left-arrow in the set).
    holder.innerHTML = PANEL_HTML.replace(/\{\{ic:([a-z]+)\}\}/g, function (_, n) {
      if (n === 'back') return '<span class="ghis-flip">' + wIco('arrow') + '</span>';
      return wIco(n);
    });
    while (holder.firstChild) document.body.appendChild(holder.firstChild);

    // Hospital picker + "Add your hospital" request form, inserted BEFORE the GHIS login
    // so Ward Sync first asks which hospital (GIMSR → GHIS login; others → request form).
    (function () {
      var setup = document.getElementById('ghisSetup');
      if (!setup || document.getElementById('ghisHospital')) return;
      var wrap = document.createElement('div');
      wrap.innerHTML =
        '<div id="ghisHospital" class="ghis-body">' +
          '<div style="display:flex;background:var(--panel,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:4px;margin-bottom:16px;gap:4px">' +
            '<div style="flex:1;text-align:center;padding:9px;border-radius:9px;background:var(--teal,#0e6e63);color:#fff;font-weight:700;font-size:13.5px">' + wIco("hospital") + ' Select hospital</div>' +
            '<button onclick="ghisOpenMyWard()" style="flex:1;text-align:center;padding:9px;border-radius:9px;background:transparent;border:none;color:var(--slate,#64748b);font-weight:700;font-size:13.5px;font-family:inherit;cursor:pointer">' + wIco("pulse") + ' My Units</button>' +
          '</div>' +
          '<div class="ghis-setup-card">' +
            '<div class="ghis-setup-title">Select your hospital</div>' +
            '<div class="ghis-setup-sub">Choose your hospital to connect its ward + labs.</div>' +
            '<button class="ghis-connect-btn" onclick="ghisSelectHospital(\'gimsr\')">' + wIco("hospital") + ' GIMSR</button>' +
            '<div class="ghis-setup-sub" style="margin:10px 0 4px">GITAM Institute of Medical Sciences · sign in with GHIS</div>' +
            '<div id="ghisAdapterHosp"></div>' +
            '<button class="ghis-connect-btn" style="background:var(--paper,#f6f8f6);color:var(--ink,#0f172a);border:1px solid var(--line,#e4eae8)" onclick="ghisSelectHospital(\'stewardmd\')">' + wIco("hospital") + ' StewardMD Hospital</button>' +
            '<div class="ghis-setup-sub" style="margin:10px 0 4px">25 demo patients, 5 wards, no login needed — for live demos</div>' +
            '<div id="ghisConnectHosp"></div>' +
            '<button class="ghis-connect-btn" style="background:transparent;color:var(--teal,#0e6e63);border:1.5px solid var(--teal,#0e6e63)" onclick="showGhisScreen(\'addhospital\')">' + wIco("plus") + ' Add your hospital</button>' +
          '</div>' +
        '</div>' +
        '<div id="ghisAddHospital" class="ghis-body" style="display:none;">' +
          '<div class="ghis-setup-card">' +
            '<button class="ghis-back-sm" onclick="showGhisScreen(\'hospital\')">← Back</button>' +
            '<div class="ghis-setup-title" style="margin-top:8px">Add your hospital</div>' +
            '<button class="ghis-connect-btn" onclick="ghisOpenConnectConsole()">' + wIco("hospital") + ' Connect an EMR now (self-service)</button>' +
            '<div class="ghis-setup-sub">Tell us your hospital + EMR and we\'ll set up Ward Sync for you.</div>' +
            '<input id="ghReqHosp" class="ghis-login-input" placeholder="Hospital name">' +
            '<input id="ghReqEmr" class="ghis-login-input" placeholder="EMR / HIS system (if known)">' +
            '<input id="ghReqName" class="ghis-login-input" placeholder="Your name">' +
            '<input id="ghReqEmail" class="ghis-login-input" type="email" placeholder="Your email">' +
            '<textarea id="ghReqMsg" class="ghis-login-input" rows="3" placeholder="Contact person, API docs link, anything else…"></textarea>' +
            '<button class="ghis-connect-btn" onclick="ghisSubmitHospitalRequest()">Send request</button>' +
            '<div id="ghReqStatus" class="ghis-setup-sub" style="margin-top:8px"></div>' +
          '</div>' +
        '</div>';
      while (wrap.firstChild) setup.parentNode.insertBefore(wrap.firstChild, setup);
    })();

    // Ward Sync now lives inside the Home "Hospital" hub tile, so the floating Ward FAB is retired to avoid
    // a duplicate entry point. Only mounted if a host explicitly opts in via window.GHIS_BUTTON_SELECTOR.
    var sel = window.GHIS_BUTTON_SELECTOR, host = sel ? document.querySelector(sel) : null;
    if (host) {
      var btn = document.createElement('button');
      btn.id = 'ghisBtn'; btn.className = 'ghis-ward-fab'; btn.title = 'GHIS Ward Sync';
      btn.innerHTML = wIco("hospital") + ' Ward';
      btn.addEventListener('click', function () { window.openGHIS(); });
      host.appendChild(btn);
    }

    initGHIS();
  }

  function initGHIS() {
    /* ===== GHIS module (verbatim from StewardMD v4) ===== */
    (function() {
      // Backend: local Node proxy during dev (localhost), same-origin Cloudflare
      // Function in production. Override with window.GHIS_PROXY if needed.
      var _host = location.hostname;
      // NOTE: in the native app the WebView origin is https://localhost, so _host is
      // "localhost" — that must NOT trigger the dev proxy (localhost:3456 isn't running
      // on the phone → "Server not reachable"). Native uses /api/ghis (native-bridge
      // rewrites it to stewardmd.in via CapacitorHttp).
      var PROXY = window.GHIS_PROXY || ((!window.SMD_IS_NATIVE && (_host === 'localhost' || _host === '127.0.0.1'))
        ? 'http://localhost:3456'
        : '/api/ghis');
      var _patients = [];
      var _connectCtx = null;   // {tid,cid,name} when the roster is from a Connect (FHIR) hospital; null for GHIS
      var _adapterCtx = null;   // {tid, conn, label, origin, replay, sessionId} when the roster came from an approved Connect Agent adapter
      var _addedPids = {};   // ward patientIds ticked "add to dashboard" this session (checkbox state)
      var _connected = false;
      // Set by GHIS.loadDemoHospital() (demo-hospital.js) to { patients:[raw shape], labsByPatientId }.
      // authFetch() short-circuits to demoFetch() while this is non-null — no network call, no
      // credential, entirely local. Cleared on sign-out (ghisDisconnect).
      var DEMO = null;
      function demoFetch(path) {
        var pm = path.match(/patientId=([^&]+)/);
        var pid = pm ? decodeURIComponent(pm[1]) : null;
        if (/^\/patients/.test(path)) return Promise.resolve(DEMO.patients);
        var CBC = { "Haemoglobin": 1, "Total WBC Count": 1, "Platelet Count": 1 };
        if (/^\/lab\?/.test(path)) {
          // ONE order per day, correctly dated — NOT one giant order per category spanning
          // every day. Rows sharing a date came from the same draw (mkTrend stamps a whole
          // day's panel with one date string), so grouping by that date is exactly right.
          var labs = (pid && DEMO.labsByPatientId[pid]) || [];
          var byDate = {}, dateOrder = [];
          labs.forEach(function (t) { if (!byDate[t.date]) { byDate[t.date] = []; dateOrder.push(t.date); } byDate[t.date].push(t); });
          var orders = [];
          dateOrder.forEach(function (dt) {
            var rows = byDate[dt];
            if (rows.some(function (t) { return CBC[t.test]; })) orders.push({ renderId: "demo-cbc|" + pid + "|" + dt, episodeId: "DEMOEP" + pid, orderDate: dt });
            if (rows.some(function (t) { return !CBC[t.test]; })) orders.push({ renderId: "demo-chem|" + pid + "|" + dt, episodeId: "DEMOEP" + pid, orderDate: dt });
          });
          return Promise.resolve({ orders: orders });
        }
        if (/^\/lab-detail\?/.test(path)) {
          var rm = path.match(/renderId=([^&]+)/);
          var rid = rm ? decodeURIComponent(rm[1]) : "";
          var ridParts = rid.split("|");   // ["demo-cbc"|"demo-chem", pid, date]
          var wantCbc = ridParts[0] === "demo-cbc";
          var wantDate = ridParts[2];
          var all = (pid && DEMO.labsByPatientId[pid]) || [];
          return Promise.resolve({ tests: all.filter(function (t) {
            var inCbc = !!CBC[t.test];
            return (wantCbc ? inCbc : !inCbc) && t.date === wantDate;
          }) });
        }
        if (/^\/radiology\?/.test(path)) {
          var img = (pid && DEMO.imagingByPatientId[pid]) || [];
          return Promise.resolve({ orders: img.map(function (im) { return { resultid: im.resultid, description: im.studyName, date: im.date, printType: "manual" }; }) });
        }
        if (/^\/radiology-report\?/.test(path)) {
          var rrm = path.match(/resultid=([^&]+)/);
          var rrid = rrm ? decodeURIComponent(rrm[1]) : "";
          var found = DEMO.imagingByResultId[rrid];
          return Promise.resolve(found ? { report: found.report, testName: found.studyName, doctor: found.doctor, reported: true } : { error: "not_found" });
        }
        return Promise.resolve({});
      }
    
      // ── auth token (per-doctor GHIS login), persisted so they stay logged in ──
      // Scoped PER signed-in Google account (Firebase uid) so a GHIS login never
      // leaks across accounts on a shared device: account B must NOT inherit
      // account A's GITAM session, and signing back in as A restores A's own
      // session. Mirrors the per-user roster scoping in icu.js.
      var TOKEN_BASE = 'ghis_token';
      function ghisOwner() {
        try { var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
          if (a && a.currentUser && a.currentUser.uid) return a.currentUser.uid; } catch (e) {}
        return 'anon';
      }
      function tokenKey() { return TOKEN_BASE + ':' + ghisOwner(); }
      // One-time migration: fold the legacy unscoped `ghis_token` into whoever the
      // current owner is (preserve an existing signed-in session, don't destroy it).
      (function migrateLegacyToken() {
        try {
          var legacy = localStorage.getItem(TOKEN_BASE);
          if (legacy) {
            if (!localStorage.getItem(tokenKey())) localStorage.setItem(tokenKey(), legacy);
            localStorage.removeItem(TOKEN_BASE);
          }
        } catch (e) {}
      })();
      function getToken() { try { return localStorage.getItem(tokenKey()) || ''; } catch (e) { return ''; } }
      function setToken(t) {
        try { t ? localStorage.setItem(tokenKey(), t) : localStorage.removeItem(tokenKey()); } catch (e) {}
        // Relay the ward session to a paired Wear OS watch (Labs screen). No-op off-native / unpaired.
        try { window.SMD_WEAR && window.SMD_WEAR.setGhisToken(t || ''); } catch (e) {}
      }
      // Firebase ID token (for the Pro gate on /login) — resolves '' when signed-out or unavailable.
      function fbToken() { try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; if (u && u.getIdToken) return u.getIdToken().catch(function(){ return ''; }); } catch (e) {} return Promise.resolve(''); }
      // Silent GHIS session refresh: when the short-lived GHIS session times out, re-mint one from
      // the doctor's SERVER-STORED (consented, Lab Watch 24/7) creds via their Firebase identity —
      // NO password prompt. Resolves to a fresh token, or null if it can't (not Firebase-signed-in,
      // or no stored creds → the doctor just logs in again as before).
      function ghisSilentRefresh() {
        return new Promise(function (resolve) {
          try {
            var u = window.SMD_AUTH && window.SMD_AUTH.currentUser;
            if (!u || !u.getIdToken) return resolve(null);
            u.getIdToken().then(function (jwt) {
              fetch(PROXY + '/refresh', { method: 'POST', headers: { 'Authorization': 'Bearer ' + jwt } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (j) { if (j && j.token) { setToken(j.token); _connected = true; dot(true); resolve(j.token); } else resolve(null); })
                .catch(function () { resolve(null); });
            }).catch(function () { resolve(null); });
          } catch (e) { resolve(null); }
        });
      }
      // Device-stored GHIS credential from the queue's "Remember me" (Keychain/Keystore, NEVER our
      // server). SCOPED PER APP-ACCOUNT (same key the queue writes: 'smd_ghis_rememcred:' + uid) so a
      // remembered login can't leak to a different doctor on a shared device.
      function storedCredLogin() {
        try {
          if (!(window.SMD_SECURE && window.SMD_SECURE.get)) return Promise.resolve(false);
          return window.SMD_SECURE.get('smd_ghis_rememcred:' + ghisOwner()).then(function (raw) {
            var c = null; try { c = raw ? JSON.parse(raw) : null; } catch (e) {}
            if (!c || !c.u || !c.p || !window.GHIS || !window.GHIS.loginWith) return false;
            return window.GHIS.loginWith(c.u, c.p);   // resolves true on success (sets the token)
          }).catch(function () { return false; });
        } catch (e) { return Promise.resolve(false); }
      }
      // NON-UI: resolve true if a live session is ready (silently refreshed, or re-logged-in from a
      // remembered device credential), false otherwise. Opens no panel — the caller owns the UI.
      function checkSession() {
        if (!getToken()) return storedCredLogin();
        return fetch(PROXY + '/status', { headers: { 'Authorization': 'Bearer ' + getToken() } })
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (s && s.connected) { _connected = true; try { dot(true); } catch (e) {} return true; }
            return ghisSilentRefresh().then(function (nt) { return nt ? true : storedCredLogin(); });
          })
          .catch(function () { return true; });   // network hiccup: don't force a prompt
      }
      // fetch wrapper that attaches the bearer token; on 401 it tries a SILENT refresh ONCE and
      // retries, only falling back to the login screen if that fails.
      function authFetch(path, opts, _retried) {
        if (DEMO) return demoFetch(path);
        opts = opts || {};
        opts.headers = opts.headers || {};
        var t = getToken();
        if (t) opts.headers['Authorization'] = 'Bearer ' + t; else delete opts.headers['Authorization'];
        return fetch(PROXY + path, opts).then(function (r) {
          if (r.status === 401) {
            if (_retried) { setToken(''); _connected = false; dot(false); showScreen('setup'); throw new Error('login_required'); }
            return ghisSilentRefresh().then(function (nt) {
              if (nt) return authFetch(path, opts, true);   // fresh session → retry once (Authorization re-set from the new token)
              setToken(''); _connected = false; dot(false); showScreen('setup'); throw new Error('login_required');
            });
          }
          return r.json();
        });
      }
    
      function dot(on) {
        var d = document.getElementById('ghisConnDot');
        if (!d) return;
        d.className = 'ghis-dot ' + (on ? 'ghis-dot-on' : 'ghis-dot-off');
      }
    
      function showScreen(name) {
        var el;
        if ((el = document.getElementById('ghisHospital')))    el.style.display = name === 'hospital'    ? '' : 'none';
        if ((el = document.getElementById('ghisAddHospital'))) el.style.display = name === 'addhospital' ? '' : 'none';
        document.getElementById('ghisSetup').style.display = name === 'setup' ? '' : 'none';
        document.getElementById('ghisWard').style.display  = name === 'ward'  ? '' : 'none';
        if (name === 'hospital') { try { ghisRenderConnectHospitals(); } catch (e) {} try { ghisRenderAdapterHospitals(); } catch (e) {} }
      }
      window.showGhisScreen = showScreen;
      // Setup-screen "Load Demo: Test Hospital" button (demo-hospital.js). No GHIS login,
      // no network call — 25 fictional patients across 5 branches, real-shaped labs.
      window.ghisLoadDemoHospital = function () {
        if (window.SMD_TEST_HOSPITAL && window.GHIS && window.GHIS.loadDemoHospital) GHIS.loadDemoHospital(window.SMD_TEST_HOSPITAL);
        else alert('Demo dataset not loaded yet — try again in a moment.');
      };
      // Hospital picker actions.
      window.ghisSelectHospital = function (id) {
        if (id === 'gimsr') showScreen('setup');
        else if (id === 'stewardmd') window.ghisLoadDemoHospital();
      };
      // Connect platform: open the self-service EMR console (falls back to the request form if not loaded).
      window.ghisOpenConnectConsole = function () { try { if (window.SMD_openConnectEmr) window.SMD_openConnectEmr(); else showScreen('addhospital'); } catch (e) {} };
      // List the doctor's CONNECTED hospitals (Connect platform) in the picker, next to GIMSR. Tapping one
      // closes Ward Sync and opens the Connect patient pull (search -> pull -> ICU) for that hospital. Only
      // appears when the doctor actually has connected hospitals, so GIMSR-only users see no change.
      function ghisRenderConnectHospitals() {
        var box = document.getElementById('ghisConnectHosp'); if (!box) return;
        box.innerHTML = '';
        if (!window.SMD_CONNECT || !SMD_CONNECT.tenants) return;
        SMD_CONNECT.tenants().then(function (ts) {
          box = document.getElementById('ghisConnectHosp');
          ts = (ts || []).filter(function (t) { return !(window.__smdAdapterTenants || {})[t.tenantId]; });
          if (!box || !ts.length) { if (box) box.innerHTML = ''; return; }
          var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
          box.innerHTML = '<div class="ghis-setup-sub" style="margin:12px 0 4px">Your connected hospitals · tap to load today\'s ward list</div>' +
            ts.map(function (t) { return '<button class="ghis-connect-btn" style="margin-top:6px" data-conn-tid="' + esc(t.tenantId) + '" data-conn-name="' + esc(t.name || t.tenantId) + '">' + wIco('hospital') + ' ' + esc(t.name || t.tenantId) + '</button>'; }).join('');
          [].slice.call(box.querySelectorAll('[data-conn-tid]')).forEach(function (b) {
            b.onclick = function () {
              var tid = b.getAttribute('data-conn-tid'), nm = b.getAttribute('data-conn-name');
              if (window.ghisLoadConnectRoster) window.ghisLoadConnectRoster(tid, nm);   // load the connected hospital's ward roster
            };
          });
        }).catch(function () {});
      }
      // ── Connect Agent adapters as hospitals. An APPROVED adapter (Connect Hospital, deployment with an
      // activeVersionId) is listed as a real hospital button next to GIMSR. Tapping it: create a phone
      // session (the server reuses the active adapter), sign in inside the native ConnectBrowser, hand off,
      // then the phone runtime (connect-agent/phone/runtime.mjs) reads the ward list from the hospital's
      // own pages in the doctor's session. Cell text never leaves the phone.
      var AGENT_BASE = '/api/connect/agent';
      var _agentApi = function (path, tid, opts) {
        var q = tid ? (path.indexOf('?') >= 0 ? '&' : '?') + 'tenant=' + encodeURIComponent(tid) : '';
        var tok;
        try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; tok = (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); } catch (e) { tok = Promise.resolve(null); }
        return tok.then(function (t) {
          var h = { 'content-type': 'application/json' };
          if (t) h.Authorization = 'Bearer ' + t;
          return fetch(AGENT_BASE + path + q, { method: (opts && opts.method) || 'GET', headers: h, body: (opts && opts.body) || null, cache: 'no-store' });
        }).then(function (r) {
          return r.text().then(function (t) { var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = { ok: false, error: 'bad-response' }; } return { s: r.status, d: d }; });
        }).catch(function () { return { s: 0, d: { ok: false, error: 'network' } }; });
      };
      function agentApi(path, tid, opts) { return _agentApi(path, tid, opts || {}); }
      function agentReason(r, what) {
        var d = r && r.d;
        if (r && r.s === 0) return 'Network error while trying to ' + what + '.';
        if (d && (d.detail || d.message || d.error)) return 'Could not ' + what + ': ' + (d.detail || d.message || d.error) + (r.s ? ' (HTTP ' + r.s + ')' : '') + '.';
        return 'Could not ' + what + ' (HTTP ' + (r && r.s) + ').';
      }
      function loadWardRuntime() {
        if (window.__SMD_WARD_RUNTIME_TEST__) return Promise.resolve(window.__SMD_WARD_RUNTIME_TEST__);
        try { return (new Function('p', 'return import(p)'))('/connect-agent/phone/runtime.mjs'); } catch (e) { return Promise.reject(e); }
      }
      function connectPlugin() { try { return window.Capacitor.Plugins.ConnectBrowser || null; } catch (e) { return null; } }
      var _adapterConns = {};
      // The registry feed: every deployment with an active version across the doctor's tenants.
      function ghisRenderAdapterHospitals() {
        var box = document.getElementById('ghisAdapterHosp'); if (!box) return;
        box.innerHTML = '';
        Promise.all([loadWardRuntime(), agentApi('/tenants', '')]).then(function (res) {
          var rt = res[0], r = res[1];
          var tenants = (r.s === 200 && r.d && r.d.tenants) || [];
          return Promise.all(tenants.map(function (t) {
            return agentApi('/connections', t.tenantId).then(function (c) {
              return ((c.s === 200 && c.d && c.d.connections) || []).filter(function (cn) {
                var o = (cn.origins || [])[0];
                return cn.activeVersionId && o;
              }).map(function (cn) {
                var lb = rt.hospitalLabel(t.name, cn.origins[0]);
                /* GIMSR has its own built-in button above. Its approved adapter is still listed, labelled
                 * so the two never read as one: the doctor can see which path they are taking. */
                var gim = rt.isGimsrOrigin(cn.origins[0]);
                return { tid: t.tenantId, tenantName: t.name || '', conn: cn, name: gim ? lb.name + ' (adapter)' : lb.name, subtitle: gim ? lb.subtitle + ' · read through the approved adapter' : lb.subtitle };
              });
            });
          })).then(function (lists) { return [].concat.apply([], lists); });
        }).then(function (items) {
          box = document.getElementById('ghisAdapterHosp'); if (!box) return;
          _adapterConns = {};
          /* A tenant with an approved adapter is served by it. The older "Your connected hospitals"
           * list (FHIR feeds) offered the SAME hospital a second time under a near-identical name, and
           * the owner tapped that one and read "No FHIR connection on this hospital yet" as the adapter
           * failing (2026-09-12). One hospital, one button. */
          window.__smdAdapterTenants = {};
          items.forEach(function (it) { window.__smdAdapterTenants[it.tid] = true; });
          box.innerHTML = items.map(function (it) {
            _adapterConns[it.conn.deploymentId] = it;
            return '<button class="ghis-connect-btn" data-adapter-dep="' + esc(it.conn.deploymentId) + '">' + wIco('hospital') + ' ' + esc(it.name) + '</button>' +
              '<div class="ghis-setup-sub" style="margin:10px 0 4px">' + esc(it.subtitle) + '</div>';
          }).join('');
          [].slice.call(box.querySelectorAll('[data-adapter-dep]')).forEach(function (b) {
            b.onclick = function () { window.ghisOpenAdapterHospital(b.getAttribute('data-adapter-dep')); };
          });
          ghisRenderConnectHospitals();   // redraw the older list without the hospitals now served by an adapter
        }).catch(function () {});
      }
      function adapterFail(msg) {
        var el = document.getElementById('ghisPatientList');
        if (el) el.innerHTML = '<div class="ghis-empty">' + esc(msg) + '</div>';
        try { var p = connectPlugin(); if (p && _adapterCtx && _adapterCtx.browserOpen) { _adapterCtx.browserOpen = false; p.close(); } } catch (e) {}
      }
      /* READ-TIME SELF-REPAIR. An approved adapter that reads zero rows is not the end: the browser
       * goes back to the doctor with one ask in its header, the screen they show is captured (labels
       * and selectors, never cells), read at once so THEY see their patients now, and posted as a
       * corrected candidate for the owner to approve so the next doctor is never asked. */
      function ghisSelfRepair(ctx, plugin, rt, err) {
        var el = document.getElementById('ghisPatientList');
        if (el) el.innerHTML = '<div class="ghis-loading">The adapter could not find your patients on ' + esc(ctx.host) + '. In the hospital screen, show me the list of all your patients, then tap Done.</div>';
        return new Promise(function (resolve, reject) {
          function off() { ctx.listeners.forEach(function (l) { try { l.remove(); } catch (e) {} }); ctx.listeners = []; }
          try {
            ctx.listeners.push(plugin.addListener('loggedIn', function () { off(); resolve(); }));
            ctx.listeners.push(plugin.addListener('guideSkip', function () { off(); reject(new Error('You said ' + ctx.host + ' has no patient list screen. ' + err.message)); }));
            ctx.listeners.push(plugin.addListener('stopped', function () { off(); reject(err); }));
          } catch (e) {}
          try { plugin.setMode({ mode: 'guide', banner: rt.REPAIR_ASK, origins: ctx.origins }); } catch (e) { reject(err); }
        }).then(function () {
          if (el) el.innerHTML = '<div class="ghis-loading">Reading the screen you showed me...</div>';
          try { plugin.setMode({ mode: 'agent', banner: 'Reading ' + ctx.host + ' for your ward list', origins: ctx.origins }); } catch (e) {}
          return rt.captureWorklist({ plugin: plugin });
        }).then(function (view) {
          return rt.readView({ plugin: plugin, origin: ctx.origin, view: view, navigate: false }).then(function (rows) {
            var patients = rt.mapRows(rows);
            if (!patients.length) throw new Error('Still no patient rows on the screen you showed me (' + rows.length + ' rows read, none with a name or id). ' + err.message);
            agentApi('/versions/' + encodeURIComponent(ctx.versionId) + '/repair', ctx.tid, { method: 'POST', body: JSON.stringify({ sessionId: ctx.sessionId, view: view }) }).then(function (r) {
              if (r.s === 200 && r.d && r.d.ok !== false) { try { if (window.toast) window.toast('Thanks. A corrected adapter was sent for approval.'); } catch (e) {} }
            });
            return patients;
          });
        });
      }
      // Login gate + reuse + read. Each failure names its reason.
      window.ghisOpenAdapterHospital = function (depId) {
        var it = _adapterConns[depId]; if (!it) return;
        var conn = it.conn, origin = conn.origins[0], host = origin.replace(/^https?:\/\//, '');
        var el = document.getElementById('ghisPatientList');
        _connectCtx = null; _patients = [];
        try { showScreen('ward'); } catch (e) {}
        if (el) el.innerHTML = '<div class="ghis-loading">Signing in to ' + esc(host) + '...</div>';
        var plugin = connectPlugin();
        if (!plugin) { adapterFail('The in-app hospital browser is not available on this device (ConnectBrowser plugin missing).'); return; }
        var ctx = { tid: it.tid, conn: conn, label: it.name, origin: origin, host: host, listeners: [], browserOpen: false };
        _adapterCtx = ctx;
        var rt;
        function selfRepair(err) { return ghisSelfRepair(ctx, plugin, rt, err); }
        loadWardRuntime().then(function (m) {
          rt = m;
          return agentApi('/sessions', it.tid, { method: 'POST', body: JSON.stringify({ emrUrl: origin, consent: { agreed: true }, runner: 'phone' }) });
        }).then(function (r) {
          if (r.s !== 200 || !r.d || r.d.ok === false) throw new Error(agentReason(r, 'start a session with ' + host));
          if (!r.d.reuse || !r.d.deployment || !r.d.deployment.activeVersionId) throw new Error('The server did not reuse the approved adapter for ' + host + ' (reuse=' + String(!!r.d.reuse) + ', activeVersionId=' + String(r.d.deployment && r.d.deployment.activeVersionId) + ').');
          ctx.sessionId = r.d.sessionId; ctx.versionId = r.d.deployment.activeVersionId; ctx.origins = r.d.deployment.origins || conn.origins;
          return new Promise(function (resolve, reject) {
            function off() { ctx.listeners.forEach(function (l) { try { l.remove(); } catch (e) {} }); ctx.listeners = []; }
            try {
              ctx.listeners.push(plugin.addListener('loggedIn', function () { off(); resolve(); }));
              ctx.listeners.push(plugin.addListener('stopped', function () { off(); reject(new Error('Sign in to ' + host + ' was cancelled.')); }));
            } catch (e) {}
            ctx.browserOpen = true;
            plugin.open({ url: origin, origins: ctx.origins, storeId: conn.deploymentId, title: host, initScript: '' })
              .catch(function (e) { off(); reject(new Error('Could not open ' + host + ' in the in-app browser: ' + (e && e.message || e))); });
          });
        }).then(function () {
          /* LET THE SIGN-IN LAND BEFORE READING. The plugin reports loggedIn the moment the password
           * field disappears, which on GHIS is mid-redirect: the login host has accepted the password
           * but the EMR host has not yet been handed the session. Reading then gets an empty, signed-out
           * worklist that looks like a hospital with no patients (owner, 2026-09-12). Wait until the
           * browser sits on a page without a password field, for up to fifteen seconds. */
          var until = Date.now() + 15000;
          function settled() {
            return plugin.evaluate({ expression: "(function(){return document.querySelector('input[type=\"password\"]')?'login':'ok'})()" })
              .then(function (r) { return !(r && String(r.result).indexOf('login') >= 0); }, function () { return false; });
          }
          function waitSignedIn() {
            return settled().then(function (ok) {
              if (ok) return new Promise(function (res) { setTimeout(res, 1500); });   // one more beat for the landing page
              if (Date.now() > until) return;
              return new Promise(function (res) { setTimeout(res, 800); }).then(waitSignedIn);
            });
          }
          return waitSignedIn();
        }).then(function () {
          if (el) el.innerHTML = '<div class="ghis-loading">Reading ' + esc(host) + ' for your ward list...</div>';
          try { plugin.setMode({ mode: 'agent', banner: 'Reading ' + host + ' for your ward list', origins: ctx.origins }); } catch (e) {}
          return agentApi('/sessions/' + encodeURIComponent(ctx.sessionId) + '/handoff', it.tid, { method: 'POST', body: JSON.stringify({ visitedOrigins: [origin] }) });
        }).then(function (r) {
          if (r.s !== 200 || !r.d || r.d.ok === false) throw new Error(agentReason(r, 'confirm the sign in with ' + host));
          return agentApi('/versions/' + encodeURIComponent(ctx.versionId), it.tid);
        }).then(function (r) {
          if (r.s !== 200 || !r.d) throw new Error(agentReason(r, 'load the approved adapter'));
          ctx.replay = r.d.replay || [];
          if (!ctx.replay.length) throw new Error('The approved adapter for ' + host + ' has no replay views (version ' + ctx.versionId + ').');
          return rt.readWorklist({ plugin: plugin, origin: origin, replay: ctx.replay }).catch(function (e) {
            if (!/no patient rows found/.test(String(e && e.message))) throw e;
            return selfRepair(e);
          });
        }).then(function (patients) {
          ctx.browserOpen = false;
          try { plugin.close(); } catch (e) {}
          if (_adapterCtx !== ctx) return;
          _patients = patients;
          populateFilterOptions();
          ghisApplyFilters();
        }).catch(function (e) {
          if (_adapterCtx !== ctx) return;
          adapterFail(e && e.message ? e.message : 'Could not read the ward list from ' + host + '.');
        });
      };
      // Patient details from the adapter's other views (medications, labs, radiology, history, discharge),
      // shown in the existing lab drawer. The browser is reopened in agent mode for the read, then closed.
      function ghisOpenAdapterPatient(patientId, name) {
        var ctx = _adapterCtx, plugin = connectPlugin();
        var drawer = document.getElementById('ghisLabDrawer'), title = document.getElementById('ghisLabTitle'), body = document.getElementById('ghisLabBody');
        if (!drawer || !ctx) return;
        var p = null; for (var i = 0; i < _patients.length; i++) if (String(_patients[i].patientId) === String(patientId)) p = _patients[i];
        GHIS._selectedPatient = { patientId: patientId, name: name, episodeId: (p && p.episodeId) || '' };
        title.textContent = name + ' (' + patientId + ')';
        body.innerHTML = '<div class="ghis-loading">Reading ' + esc(ctx.host) + ' for ' + esc(name) + '...</div>';
        drawer.style.display = '';
        if (!plugin) { body.innerHTML = '<div class="ghis-lab-empty">The in-app hospital browser is not available on this device.</div>'; return; }
        loadWardRuntime().then(function (rt) {
          ctx.browserOpen = true;
          return plugin.open({ url: ctx.origin, origins: ctx.origins, storeId: ctx.conn.deploymentId, title: ctx.host, initScript: '' }).then(function () {
            try { plugin.setMode({ mode: 'agent', banner: 'Reading ' + ctx.host + ' for ' + name, origins: ctx.origins }); } catch (e) {}
            return rt.readPatientDetails({ plugin: plugin, origin: ctx.origin, replay: ctx.replay, patient: p || { patientId: patientId } });
          });
        }).then(function (sections) {
          ctx.browserOpen = false; try { plugin.close(); } catch (e) {}
          if (!sections.length) { body.innerHTML = '<div class="ghis-lab-empty">The approved adapter for ' + esc(ctx.host) + ' has no patient views (medications, labs, radiology, history, discharge).</div>'; return; }
          body.innerHTML = sections.map(function (sec) {
            var h = '<div class="ghis-lab-group"><div class="ghis-lab-group-name">' + esc(sec.resource) + '</div>';
            if (sec.error) return h + '<div class="ghis-lab-detail-empty">' + esc(sec.error) + '</div></div>';
            if (!sec.rows.length) return h + '<div class="ghis-lab-detail-empty">Nothing recorded.</div></div>';
            return h + sec.rows.map(function (row) {
              return '<div class="ghis-lab-row" style="display:block">' + Object.keys(row).map(function (k) {
                return '<div><span class="ghis-lab-date">' + esc(k) + '</span> <span class="ghis-lab-test">' + esc(row[k]) + '</span></div>';
              }).join('') + '</div>';
            }).join('') + '</div>';
          }).join('');
        }).catch(function (e) {
          ctx.browserOpen = false; try { plugin.close(); } catch (x) {}
          body.innerHTML = '<div class="ghis-lab-empty">' + esc(e && e.message ? e.message : 'Could not read ' + ctx.host + ' for this patient.') + '</div>';
        });
      }
      // "My Ward" tab — open the StewardMD ward dashboard (the ICU dashboard tuned for ward patients:
      // ventilator hidden, "Ward" labels, own patient list; Treatment / instructions / deep review /
      // imaging / discharge reused). The Ward Sync panel (z 18000) sits ABOVE the dashboard (z 10000),
      // so close it first, then open the dashboard full-screen.
      window.ghisOpenMyWard = function () {
        try {
          // Open the unit picker (hospital -> ICU/Ward -> unit type). The Ward Sync panel (z 18000)
          // sits ABOVE the dashboard (z 10000), so close it first, then open full-screen.
          if (window.ICU && ICU.openUnits) { if (window.closeGHIS) window.closeGHIS(); ICU.openUnits(); }
          else if (window.ICU && ICU.openWard) { if (window.closeGHIS) window.closeGHIS(); ICU.openWard(); }
          else if (window.INF && INF.openDashboard) { if (window.closeGHIS) window.closeGHIS(); INF.openDashboard(); }
          else if (window.toast) window.toast('Ward dashboard loading…');
        } catch (e) {}
      };
      window.ghisSubmitHospitalRequest = function () {
        var g = function (i) { var e = document.getElementById(i); return e ? String(e.value || '').trim() : ''; };
        var st = document.getElementById('ghReqStatus');
        var hosp = g('ghReqHosp');
        if (!hosp) { if (st) { st.style.color = '#ef4444'; st.textContent = 'Please enter your hospital name.'; } return; }
        var payload = { hospital: hosp, emr: g('ghReqEmr'), name: g('ghReqName'), email: g('ghReqEmail'), msg: g('ghReqMsg') };
        if (st) { st.style.color = ''; st.textContent = 'Sending…'; }
        fetch('/api/hospital-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || 'failed'); }); })
          .then(function () { if (st) { st.style.color = 'var(--teal,#0e6e63)'; st.innerHTML = wIco("check") + ' Sent — we’ll be in touch. Thank you!'; } })
          .catch(function () {
            // Fallback: open the mail composer with the request pre-filled.
            var body = 'Hospital: ' + payload.hospital + '\nEMR/HIS: ' + payload.emr + '\nName: ' + payload.name + '\nEmail: ' + payload.email + '\nNotes: ' + payload.msg;
            var href = 'mailto:drmanojkurmana@gmail.com?subject=' + encodeURIComponent('StewardMD Ward Sync request: ' + payload.hospital) + '&body=' + encodeURIComponent(body);
            if (st) { st.style.color = ''; st.innerHTML = 'Could not send automatically. <a href="' + href + '" style="color:var(--teal,#0e6e63);font-weight:700">Tap to email us instead</a>.'; }
          });
      };
    
      function statusBadge(status) {
        var cls = 'ghis-status-other', label = status || 'Unknown';
        if (!status) return '<span class="ghis-pt-status ghis-status-other">—</span>';
        var s = status.toLowerCase();
        if (s.indexOf('occupied') !== -1) cls = 'ghis-status-occupied';
        else if (s.indexOf('bed') !== -1)  cls = 'ghis-status-bed';
        else if (s.indexOf('discharge') !== -1) cls = 'ghis-status-discharge';
        return '<span class="ghis-pt-status ' + cls + '">' + esc(label) + '</span>';
      }
    
      function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      }
      // Ward-Sync lab/culture reports arrive from GHIS as raw HTML (styled <div>/<span>,
      // &nbsp; runs, &quot;/&ldquo; entities). We NEVER render that HTML — we flatten it to
      // clean, readable text: block tags → line breaks, then DOMParser strips tags + decodes
      // entities inertly (no resource loads, never inserted into the live DOM), then collapse
      // &nbsp;/whitespace runs and blank lines. Plain values pass through untouched.
      function htmlToText(s) {
        s = String(s == null ? '' : s);
        if (!/[<&]/.test(s)) return s.trim();
        s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(div|p|li|tr|h[1-6])\s*>/gi, '\n');
        var txt;
        try { var doc = new DOMParser().parseFromString(s, 'text/html'); txt = (doc && doc.body && doc.body.textContent) || ''; }
        catch (e) { txt = s.replace(/<[^>]*>/g, ''); }
        txt = txt.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
        var lines = txt.split('\n').map(function (l) { return l.trim(); }), out = [];
        for (var i = 0; i < lines.length; i++) { if (lines[i] || (out.length && out[out.length - 1])) out.push(lines[i]); }
        return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      }
      // A result is a NARRATIVE report (culture/Truenat/histopath) rather than a discrete value
      // when it carries HTML markup or is long — those render full-width, not in the value chip.
      function isNarrativeResult(v) { v = String(v == null ? '' : v); return /<[a-z!/]/i.test(v) || v.length > 140; }
      // Safe for a value embedded in a single-quoted JS string inside an HTML
      // attribute (e.g. onclick="fn('<here>')"). Backslash-escape \ and ' so they
      // survive HTML-decoding of the attribute, then HTML-escape & < > " for the
      // attribute context. Prevents names like O'Brien / D'Souza from breaking the
      // inline handler.
      function jsq(s) {
        return String(s == null ? '' : s)
          .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
    
      // Map a raw GHIS IPWorkList patient → the ICU/Ward patient record. Imports ALL available
      // fields — MR# (patientId), treating doctor, department — as their OWN fields; does NOT
      // overload Diagnosis (left blank for the clinician). Shared by loadIntoICU + addToDashboard.
      function demoFromPatient(p) {
        var dem = { hospital: 'GHIS Ward', status: 'ward' };
        if (!p) return dem;
        if (p.patientFirstName) dem.name = p.patientFirstName;
        if (p.gender) dem.sex = p.gender;
        if (p.bedName) dem.bed = p.bedName;
        if (p.patientId != null && p.patientId !== '') dem.mrn = String(p.patientId);
        var doc = (p.employeeFirstName || '').trim();
        if (doc && doc.toLowerCase() !== 'dr' && doc.toLowerCase() !== 'dr.') dem.doctor = doc;
        if (p.deptDescription) dem.dept = p.deptDescription;
        var a = parseInt(p.dob, 10); if (!isNaN(a) && a > 0 && a < 130) dem.age = a;
        return dem;
      }
      // "Adding to: <unit> ▾" bar — reflects/switches the dashboard's active unit so ticks file into
      // the right ICU/Ward unit (resolves "can't select units after sign-in"). Fed by ICU.unitList().
      function renderAddTarget() {
        var el = document.getElementById('ghisAddTarget'); if (!el) return;
        if (!(window.ICU && ICU.unitList)) { el.style.display = 'none'; return; }
        // ensureUnits() starts the live group subscription (units load async, even when the ICU
        // dashboard was never opened) AND registers this fn to re-render as units arrive — so a
        // just-created ward shows up here instead of only the first-loaded unit.
        var units = [];
        try { units = (ICU.ensureUnits ? ICU.ensureUnits(renderAddTarget) : ICU.unitList()) || []; } catch (e) {}
        el.style.display = 'flex';
        if (!units.length) {
          el.innerHTML = '<span style="font:700 12px var(--sans,system-ui);color:var(--slate,#5a7184)">Adding to dashboard</span>' +
            '<button onclick="if(window.ICU&&ICU.openUnits)ICU.openUnits()" style="margin-left:auto;background:none;border:none;color:var(--teal,#0e6e63);font:700 12px var(--sans,system-ui);cursor:pointer">Set up a unit ›</button>';
          return;
        }
        var opts = units.map(function (u) { return '<option value="' + esc(u.key) + '"' + (u.active ? ' selected' : '') + '>' + esc(u.label) + '</option>'; }).join('');
        el.innerHTML = '<span style="font:700 12px var(--sans,system-ui);color:var(--slate,#5a7184);flex:0 0 auto">Adding to</span>' +
          '<select onchange="GHIS.setAddTarget(this.value)" style="flex:1;min-width:0;margin-left:8px;padding:7px 8px;border:1px solid var(--line,#e4eae8);border-radius:8px;font:600 13px var(--sans,system-ui);background:var(--panel,#fff);color:var(--ink,#0f172a)">' + opts + '</select>';
      }
      function renderPatients(list) {
        var el = document.getElementById('ghisPatientList');
        if (!el) return;
        if (!list || list.length === 0) {
          el.innerHTML = '<div class="ghis-empty">No patients found. Try searching with no filters.</div>';
          return;
        }
        renderAddTarget();
        el.innerHTML = list.map(function(p, i) {
          var age = p.dob ? p.dob : '';
          var nm = (p.patientFirstName && String(p.patientFirstName).trim()) ? p.patientFirstName : '(no name)';
          var doc = (p.employeeFirstName || '').trim();
          var showDoc = doc && doc.toLowerCase() !== 'dr' && doc.toLowerCase() !== 'dr.';
          var dept = (p.deptDescription || '').trim();
          var added = !!_addedPids[p.patientId];
          return '<div class="ghis-pt-card" onclick="GHIS.onPatient(\'' + jsq(p.episodeId) + '\',\'' + jsq(p.patientId) + '\',\'' + jsq(p.patientFirstName) + '\')">' +
            '<div class="ghis-pt-top">' +
              '<label style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:0 0 auto;margin-right:10px;cursor:pointer;font:700 10px var(--sans,system-ui);color:' + (added ? 'var(--teal,#0e6e63)' : 'var(--slate,#5a7184)') + '" onclick="event.stopPropagation()" title="Add to the current dashboard unit">' +
                '<input type="checkbox"' + (added ? ' checked' : '') + ' style="width:20px;height:20px" onchange="GHIS.toggleAdd(\'' + jsq(p.episodeId) + '\',\'' + jsq(p.patientId) + '\',\'' + jsq(p.patientFirstName) + '\',this)"><span>' + (added ? 'Added' : 'Add') + '</span>' +
              '</label>' +
              '<div style="flex:1;min-width:0">' +
                '<div class="ghis-pt-name">' + esc(nm) + ' <span style="font-weight:400;font-size:12px;color:var(--slate)">· ' + esc(p.patientId) + '</span></div>' +
                '<div class="ghis-pt-meta">' + [esc(age), (p.gender ? esc(p.gender) : ''), (p.bedName ? 'Bed ' + esc(p.bedName) : '')].filter(Boolean).join(' · ') + '</div>' +
              '</div>' +
              statusBadge(p.queueStatus) +
            '</div>' +
            ((dept || showDoc) ? '<div class="ghis-pt-dept">' + [esc(dept), (showDoc ? 'Dr. ' + esc(doc) : '')].filter(Boolean).join(' · ') + '</div>' : '') +
            '<div class="ghis-pt-actions">' +
              '<button class="ghis-pt-call ghis-pt-assess" type="button" title="Initial assessment" onclick="event.stopPropagation();GHIS.openAssessment(\'' + jsq(p.episodeId) + '\',\'' + jsq(p.patientId) + '\',\'' + jsq(p.patientFirstName) + '\')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M12 12v6"/></svg> Assess</button>' +
              '<button class="ghis-pt-call" type="button" title="Call patient" onclick="event.stopPropagation();GHIS.callPatient(\'' + jsq(p.patientId) + '\',this)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.24a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg> Call</button></div>' +
          '</div>';
        }).join('');
      }
    
      function abnormalClass(t) {
        // numeric result outside [low, high] → abnormal
        if (t.critical && String(t.critical).trim() && String(t.critical) !== '0') return ' abnormal';
        var v = parseFloat(t.result), lo = parseFloat(t.low), hi = parseFloat(t.high);
        if (!isNaN(v)) {
          if (!isNaN(lo) && v < lo) return ' abnormal';
          if (!isNaN(hi) && v > hi) return ' abnormal';
        }
        return '';
      }
    
      function renderLabDetail(d) {
        if (d.error === 'session_expired') return '<div class="ghis-lab-empty">Session expired — reconnect in the Ward panel.</div>';
        var tests = d.tests || [];
        if (tests.length === 0) return '<div class="ghis-lab-detail-empty">No values recorded for this order.</div>';
        var html = '';
        tests.forEach(function(t) {
          var cls = abnormalClass(t);
          var antibiogram = t.antibiogram && String(t.antibiogram).trim();
          var testLbl = '<div class="ghis-lab-test">' + esc(t.test || '') + (t.method ? ' <span style="color:var(--slate);font-weight:400;font-size:11px">(' + esc(t.method) + ')</span>' : '') + '</div>';
          if (isNarrativeResult(t.result)) {
            // Culture / Truenat / histopath narrative — flatten HTML to clean text and show it
            // FULL-WIDTH (never squeezed into the value chip, never as raw markup).
            html += '<div class="ghis-lab-row" style="display:block">' + testLbl +
              '<div class="ghis-rad-report" style="margin-top:4px">' + esc(htmlToText(t.result)).replace(/\n/g, '<br>') + '</div>' +
            '</div>';
          } else {
            html += '<div class="ghis-lab-row">' + testLbl +
              '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' +
                '<div class="ghis-lab-val' + cls + '">' + esc(htmlToText(t.result) || '—') + (t.units ? ' <span style="font-weight:400;color:var(--slate)">' + esc(t.units) + '</span>' : '') + '</div>' +
                (t.range ? '<div class="ghis-lab-date">ref ' + esc(t.range) + '</div>' : '') +
              '</div>' +
            '</div>';
          }
          if (antibiogram) {
            html += '<div class="ghis-lab-abx">' + esc(antibiogram).replace(/\n/g, '<br>') + '</div>';
          }
        });
        return html;
      }
    
      window.GHIS = {
        __setAgentApi: function (fn) { _agentApi = fn; },
        _patientId: null,
        // The patient currently opened in the ward drawer, used by the Drug-Interactions
        // "Fetch from Ward Sync" import to know whose medication history to pull. Kept
        // deliberately minimal (id + first name only) — never MRN/UHID/bed/clinician.
        _selectedPatient: null,
        // Public getter for the currently-selected Ward-Sync patient. Returns null when
        // none is selected (import stays disabled). name is display-only, id is required.
        getSelectedPatient: function() { return GHIS._selectedPatient ? { patientId: GHIS._selectedPatient.patientId, name: GHIS._selectedPatient.name, episodeId: GHIS._selectedPatient.episodeId || '' } : null; },
        // Bearer token for authorized GHIS proxy calls (used by GHISMEDS medication fetch).
        getToken: function() { return getToken(); },
        // Offline demo dataset (demo-hospital.js), for a live meeting with no GHIS login
        // needed. Flattens branches -> _patients (same raw shape ghisLoadPatients expects)
        // and reuses it unmodified: authFetch()'s demoFetch() branch answers every /patients,
        // /lab, /lab-detail call from this data, so ICU bridging, filters, search, and
        // calculator auto-fill all run through the exact real-GHIS code path. ghisDisconnect
        // clears DEMO, so signing out cleanly returns to the real GHIS sign-in screen.
        loadDemoHospital: function (dataset) {
          _connectCtx = null;
          var flat = [], labsById = {}, imgById = {}, imgByResult = {}, vitalsById = {};
          (dataset && dataset.branches || []).forEach(function (b) {
            (b.patients || []).forEach(function (p) {
              flat.push({ patientId: p.patientId, episodeId: p.episodeId, patientFirstName: p.name,
                gender: p.gender, bedName: p.bed, employeeFirstName: p.doctor, deptDescription: b.dept,
                dob: String(p.age) });
              labsById[p.patientId] = p.labs || [];
              imgById[p.patientId] = p.imaging || [];
              (p.imaging || []).forEach(function (im) { imgByResult[im.resultid] = im; });
              if (p.vitals) vitalsById[p.patientId] = p.vitals;
            });
          });
          DEMO = { patients: flat, labsByPatientId: labsById, imagingByPatientId: imgById,
            imagingByResultId: imgByResult, vitalsByPatientId: vitalsById };
          _connected = true; try { dot(true); } catch (e) {}
          showScreen('ward');
          ghisLoadPatients();

          // Pre-populate a real, named ICU unit board with its 5 patients, fully filled (labs
          // trends + vitals baked into each saved snapshot) — so opening ICU shows an active,
          // populated unit immediately, not one-at-a-time bridging from Ward Sync.
          try {
            if (window.ICU && ICU.selectUnitByKey && ICU.addWardPatientToRoster) {
              var micuPatients = flat.filter(function (p) { return p.deptDescription === 'StewardMD MICU'; });
              if (micuPatients.length) {
                ICU.selectUnitByKey('s:icu:' + encodeURIComponent('StewardMD MICU'));
                micuPatients.forEach(function (p) {
                  ICU.addWardPatientToRoster({
                    patient: demoFromPatient(p), patientId: p.patientId, episodeId: p.episodeId, source: 'Ward Sync',
                    labs: labsById[p.patientId] || [], vitals: vitalsById[p.patientId] || []
                  });
                });
              }
            }
          } catch (e) {}
        },
        // Persist a token another module obtained via the SAME /login proxy (e.g. the OPD
        // queue's sign-in) so the whole app shares ONE GHIS session — sign in once, everywhere.
        // Empty string signs out everywhere. Scoped per Firebase uid like every GHIS token here.
        setToken: function(t) { setToken(t || ''); _connected = !!t; try { dot(!!t); } catch (e) {} },
        // Programmatic login for device-local Auto-fetch (autofetch.js): silently sign in with a
        // credential the doctor stored in the OS Keychain/Keystore ON THIS DEVICE. Same /login as
        // the manual form; resolves true on success. Never persists the password anywhere here.
        loginWith: function(userId, password) {
          if (!userId || !password) return Promise.resolve(false);
          return fbToken().then(function(jwt){
            var h = { 'Content-Type': 'application/json' }; if (jwt) h['Authorization'] = 'Bearer ' + jwt;
            return fetch(PROXY + '/login', { method: 'POST', headers: h, body: JSON.stringify({ userId: userId, password: password }) });
          })
            .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
            .then(function(res) { if (res.ok && res.d && res.d.token) { setToken(res.d.token); _connected = true; try { dot(true); } catch (e) {} return true; } return false; })
            .catch(function() { return false; });
        },
        // NON-UI session check: resolves true if a live session is ready (silently refreshed, or
        // re-logged-in from a remembered device credential), false otherwise. Opens NO panel — the
        // caller decides the UI (the OPD queue shows its own gate; ensureSession opens Ward Sync).
        checkSession: checkSession,
        // Proactively verify the persisted GHIS session BEFORE a workflow needs it (e.g. the app was
        // reopened straight into OPD). Same as checkSession but opens the Ward Sync login on failure so
        // the doctor re-signs in UP FRONT instead of hitting a wall mid-load.
        ensureSession: function() {
          return checkSession().then(function(ok) { if (!ok) { try { window.openGHIS && window.openGHIS(); } catch (e) {} } return ok; });
        },
        // Proxy base so GHISMEDS uses the SAME endpoint origin as the ward panel.
        getProxyBase: function() { return PROXY; },
        // Clear the selection + any GHIS import draft (called on disconnect / patient-switch).
        clearSelectedPatient: function() {
          GHIS._selectedPatient = null; GHIS._patientId = null;
          try { if (window.GHISMEDS && window.GHISMEDS.clearDraft) window.GHISMEDS.clearDraft(); } catch (e) {}
        },
        // Deep-link target from a background lab-watch push (/?ghisRef=<ref>, resolved to a real
        // patientId first — see SMD_WATCH.resolveRef): open Ward Sync, wait for the ward list to
        // load, then open that patient's lab drawer. If the patient isn't in the current ward list
        // (e.g. discharged), prefill the search with the id.
        openPatientById: function(patientId) {
          if (!patientId) return;
          var pid = String(patientId);
          try { window.openGHIS && window.openGHIS(); } catch (e) {}
          var tries = 0;
          (function waitAndOpen() {
            if (_connected && _patients && _patients.length) {
              var p = null;
              for (var i = 0; i < _patients.length; i++) { if (String(_patients[i].patientId) === pid) { p = _patients[i]; break; } }
              if (p) { try { GHIS.openLab(p.episodeId, p.patientId, p.patientFirstName); } catch (e) {} return; }
              var s = document.getElementById('ghisSearchPt'); if (s) { s.value = pid; try { window.ghisApplyFilters(); } catch (e) {} }
              return;
            }
            if (++tries > 40) return;   // ~20s for auto-connect + patient fetch
            setTimeout(waitAndOpen, 500);
          })();
        },
        openLab: function(episodeId, patientId, name) {
          var drawer = document.getElementById('ghisLabDrawer');
          var title  = document.getElementById('ghisLabTitle');
          var body   = document.getElementById('ghisLabBody');
          if (!drawer) return;
          // Patient switch: if a different patient was selected before, clear the old import draft.
          if (GHIS._selectedPatient && String(GHIS._selectedPatient.patientId) !== String(patientId)) {
            try { if (window.GHISMEDS && window.GHISMEDS.clearDraft) window.GHISMEDS.clearDraft(); } catch (e) {}
          }
          // episodeId is the GHIS VISIT this selection belongs to. Store it: an Initial-Assessment
          // write attaches to a visit, and without it the assessment GET returns a blank doc_id 0
          // form and the write is (correctly) refused. SMD_WATCH below already read
          // _selectedPatient.episodeId, which was always undefined until now.
          GHIS._selectedPatient = { patientId: patientId, name: name, episodeId: episodeId || '' };
          GHIS._patientId = patientId;
          title.textContent = name + ' (' + patientId + ')';
          var lwOk = !!(window.ICU && ICU.openLabWatch && (!ICU.labWatchOn || ICU.labWatchOn()));
          // Background (closed-app) alerts via native push — only for signed-in doctors, and only
          // when the watch-lab client + a verifiable account are present (SMD_WATCH is consent-gated).
          var bgOk = !!(window.SMD_WATCH && window.SMD_AUTH && window.SMD_AUTH.currentUser);
          // Compact single header: one Lab Watch control (opens the unified sheet — in-app now, with
          // "turn on 24/7" inside). Adding to the dashboard is done via the list checkbox; auto-fetch
          // lives in the dashboard (removed here).
          body.innerHTML =
            (lwOk ? '<button class="ghis-connect-btn" style="margin:0 0 12px;background:#0d5c54" onclick="GHIS.watchLabs(\'' + jsq(patientId) + '\')">' + wIco("bell") + ' Lab Watch — alerts on new labs</button>' : '') +
            '<div id="ghisRadSection"></div><div id="ghisLabSection"><div class="ghis-loading">Loading lab orders…</div></div>';
          drawer.style.display = '';
          // Open at the TOP. The drawer is position:absolute; inset:0 inside #ghisWard, which is a
          // scrolled container (the patient list). If the list is scrolled down when a patient is
          // tapped, the drawer's inset:0 top sits above the visible area, so the detail appears
          // mid-way and the user has to scroll up. Remember the list position, then reset the list
          // + the drawer's own scroll so the detail opens like a fresh screen from its header.
          try {
            var ward = document.getElementById('ghisWard');
            GHIS._listScroll = ward ? ward.scrollTop : 0;
            if (ward) ward.scrollTop = 0;
            drawer.scrollTop = 0;
          } catch (e) {}
          GHIS.loadRadiology(patientId);
          GHIS.loadLabs(patientId);
        },
        // Bridge a ward patient into the ICU dashboard. Transfers DEMOGRAPHICS only
        // (name/age/sex/bed/dept) — structured lab auto-import is deliberately NOT done
        // here: mapping GHIS test names to typed analytes must be clinician-verified
        // against the hospital's live schema before any value enters a clinical view.
        // Open Lab Watch (ICU dashboard, Phase 1 in-app) for this ward patient — loads the
        // patient into ICU first, then opens the Lab Watch setup once the sync has landed.
        watchLabs: function(patientId) {
          if (!window.ICU || !ICU.openLabWatch) { alert('ICU dashboard not loaded.'); return; }
          if (ICU.labWatchOn && !ICU.labWatchOn()) { alert('Lab Watch is turned off.'); return; }
          GHIS.loadIntoICU(patientId, function () { try { ICU.openLabWatch(); } catch (e) {} });
        },
        // Background (closed-app) lab alerts via native push (consent-gated). SMD_WATCH opens the
        // consent sheet (stores the doctor's GHIS login server-side, AES-GCM, 30-day auto-delete,
        // revocable) then registers a per-account server-side watch. Also registers this device
        // for native push if not already. Signed-in doctors only; account derived server-side
        // from the verified Firebase token, never a client-supplied uid.
        watchBackground: function(patientId, name) {
          if (!(window.SMD_WATCH && window.SMD_AUTH && window.SMD_AUTH.currentUser)) { alert('Sign in with your Google/Apple account to use background lab alerts.'); return; }
          try { if (window.SMD_enableNativePush) window.SMD_enableNativePush(); } catch (e) {}
          try {
            window.SMD_WATCH.enableWithConsent({ patientId: patientId, episodeId: (GHIS._selectedPatient && GHIS._selectedPatient.episodeId) || undefined, name: name })
              .catch(function () {});
          } catch (e) {}
        },
        loadIntoICU: function(patientId, after, opts) {
          opts = opts || {};   // opts.silent → background ingest only: no panel change, no navigation, no toast (auto-sync)
          if (!window.ICU || !ICU.ingestFromWard) { if (!opts.silent) alert('ICU dashboard not loaded.'); return; }
          var p = null, list = (typeof _patients !== 'undefined' && _patients) || [];
          for (var i = 0; i < list.length; i++) { if (String(list[i].patientId) === String(patientId)) { p = list[i]; break; } }
          var dem = demoFromPatient(p);
          var pnl = document.getElementById('ghisPanel');
          var body = pnl ? pnl.querySelector('.ghis-body') : null;
          if (!opts.silent && body) body.innerHTML = '<div class="ghis-loading">Syncing labs into ICU dashboard…</div>';
          GHIS._patientId = patientId;
          // Fetch recent lab panels and flatten to test/result/ref rows for ICU's safe mapper.
          var labs = [];
          authFetch('/lab?patientId=' + encodeURIComponent(patientId)).then(function (j) {
            var orders = ((j && j.orders) || []).slice(0, 25);
            return Promise.all(orders.map(function (o) {
              return authFetch('/lab-detail?renderId=' + encodeURIComponent(o.renderId) + '&episodeId=' + encodeURIComponent(o.episodeId) + '&patientId=' + encodeURIComponent(patientId))
                .then(function (d) { (d && d.tests || []).forEach(function (t) { labs.push({ test: t.test, result: t.result, units: t.units, low: t.low, high: t.high, date: o.orderDate || o.date }); }); }).catch(function () {});
            }));
          }).catch(function () {}).then(function () {
            // Preserve the per-report time series (ICU Trends) when available; fall back to the
            // latest-only path on older builds.
            var res = (ICU.ingestWardHistory
              ? ICU.ingestWardHistory({ patient: dem, patientId: patientId, source: 'Ward Sync', labs: labs })
              : ICU.ingestFromWard({ patient: dem, patientId: patientId, source: 'Ward Sync', labs: labs }));
            // Demo Test Hospital only: real GHIS never supplies a vitals monitor feed (there is no
            // such source), so this never fires for a real patient. Replays a multi-day vitals
            // timeline (HR/BP/RR/temp/GCS/SpO2/urine/lactate) through the SAME ingestMonitor() a
            // clinician's manual entry uses, one ICU.ingestMonitor() call per recorded reading.
            if (DEMO && DEMO.vitalsByPatientId && DEMO.vitalsByPatientId[patientId] && ICU.ingestMonitor) {
              DEMO.vitalsByPatientId[patientId].forEach(function (v) { ICU.ingestMonitor(v); });
            }
            // Open the dashboard IMMEDIATELY after the lab sync — imaging must never block it.
            // AUTO-SYNC (opts.silent): ingest in the BACKGROUND only — never close the Ward Sync panel,
            // navigate to the dashboard, or toast. This is what stops auto-sync from yanking the user into
            // the ICU dashboard while they're on a calculator / home. A user-initiated load (Lab Watch)
            // still opens the workspace + toasts. Either way the reactive ICU state repaints if it's open.
            if (!opts.silent) { try { if (pnl) pnl.classList.remove('open'); } catch (e) {} ICU.open('overview'); }
            try { if (typeof after === 'function') after(); } catch (e) {}
            try { if (!opts.silent && window.toast) { var np = (res && (res.points != null ? res.points : res.mappedLabs)) || 0, nr = (res && res.reports) || 0; toast('ICU synced — ' + np + ' value' + (np === 1 ? '' : 's') + (nr > 1 ? ' across ' + nr + ' reports' : '') + ' from Ward Sync' + (res && res.conflicts ? ' · ' + res.conflicts + ' to review' : '')); } } catch (e) {}
            // Radiology (TEXT only) streams in ASYNCHRONOUSLY when the feature is on. The ICU state
            // subscription repaints the Imaging tab when records arrive; a slow/failed/hung fetch
            // can never stall the dashboard (which already opened above).
            if (ICU.ingestWardImaging && (!ICU.imagingOn || ICU.imagingOn())) {
              GHIS.fetchImaging(patientId).then(function (records) {
                var ir = ICU.ingestWardImaging({ patientId: patientId, source: 'Ward Sync', imaging: records });
                try { if (!opts.silent && window.toast && ir && ir.added) toast(ir.added + ' imaging report' + (ir.added === 1 ? '' : 's') + ' imported'); } catch (e) {}
              }).catch(function () {});
            }
          }).catch(function (e) { if (!opts.silent && body) body.innerHTML = '<div class="ghis-lab-empty">Couldn’t load labs right now. Please try again.</div>'; });
        },
        // Tick-to-add: build FULL demographics + fetch labs, then file the patient into the CURRENTLY
        // selected unit's board WITHOUT navigating (ICU.addWardPatientToRoster). Supports multi-add.
        addToDashboard: function(episodeId, patientId, name) {
          if (!window.ICU || !ICU.addWardPatientToRoster) { alert('Dashboard not loaded.'); return; }
          var p = null, list = (typeof _patients !== 'undefined' && _patients) || [];
          for (var i = 0; i < list.length; i++) { if (String(list[i].patientId) === String(patientId)) { p = list[i]; break; } }
          var dem = demoFromPatient(p), labs = [];
          authFetch('/lab?patientId=' + encodeURIComponent(patientId)).then(function (j) {
            var orders = ((j && j.orders) || []).slice(0, 25);
            return Promise.all(orders.map(function (o) {
              return authFetch('/lab-detail?renderId=' + encodeURIComponent(o.renderId) + '&episodeId=' + encodeURIComponent(o.episodeId) + '&patientId=' + encodeURIComponent(patientId))
                .then(function (d) { (d && d.tests || []).forEach(function (t) { labs.push({ test: t.test, result: t.result, units: t.units, low: t.low, high: t.high, date: o.orderDate || o.date }); }); }).catch(function () {});
            }));
          }).catch(function () {}).then(function () {
            Promise.resolve(ICU.addWardPatientToRoster({ patient: dem, patientId: patientId, episodeId: episodeId, source: 'Ward Sync', labs: labs })).then(function () {
              _addedPids[patientId] = true;
              try { if (window.toast) toast('Added ' + (dem.name || 'patient') + ' to ' + (ICU.currentUnitLabel ? ICU.currentUnitLabel() : 'dashboard')); } catch (e) {}
            }, function () { delete _addedPids[patientId]; try { if (window.toast) toast('Couldn’t add — open the dashboard and choose a unit first.'); } catch (e) {} if (typeof ghisApplyFilters === 'function') ghisApplyFilters(); });
          });
        },
        // Checkbox handler (list). Tick = add to the dashboard, untick = remove it (a real toggle).
        // `el` is the checkbox, or null when called from a header button.
        toggleAdd: function(episodeId, patientId, name, el) {
          if (el && el.type === 'checkbox' && !el.checked) {
            // Untick -> remove from the dashboard/unit. Optimistic; re-tick + revert label on failure.
            delete _addedPids[patientId];
            var sp0 = (el.parentNode) ? el.parentNode.querySelector('span') : null; if (sp0) sp0.textContent = 'Add';
            if (window.ICU && ICU.removeWardPatientFromRoster) {
              Promise.resolve(ICU.removeWardPatientFromRoster(patientId)).then(function () {
                try { if (window.toast) toast('Removed from dashboard'); } catch (e) {}
              }, function () {
                _addedPids[patientId] = true; el.checked = true; if (sp0) sp0.textContent = 'Added';
                try { if (window.toast) toast('Could not remove. Open the dashboard to manage it.'); } catch (e) {}
              });
            }
            return;
          }
          _addedPids[patientId] = true;
          if (el && el.parentNode) { var sp = el.parentNode.querySelector('span'); if (sp) sp.textContent = 'Added'; }
          GHIS.addToDashboard(episodeId, patientId, name);
        },
        // "Adding to: <unit>" dropdown → switch the dashboard's active unit (no navigation).
        setAddTarget: function(key) {
          try { if (window.ICU && ICU.selectUnitByKey) ICU.selectUnitByKey(key); } catch (e) {}
          try { renderAddTarget(); } catch (e) {}
        },
        // Fetch this patient's radiology reports (TEXT only) with the FULL field set — pulled
        // straight from /radiology + /radiology-report (not the lossy importPatientReports shape,
        // which drops resultid/date). Returns a Promise of raw records for ICU.ingestWardImaging.
        // Scoped by the current GHIS session; never fetches another patient's studies.
        fetchImaging: function(patientId) {
          return authFetch('/radiology?patientId=' + encodeURIComponent(patientId)).then(function(j) {
            var orders = ((j && j.orders) || []).slice(0, 20);
            return Promise.all(orders.map(function(o) {
              return authFetch('/radiology-report?resultid=' + encodeURIComponent(o.resultid) + '&type=' + encodeURIComponent(o.printType || 'manual'))
                .then(function(d) {
                  if (d && d.error) return null;   // session_expired / parse — skip this one
                  return { reportId: o.resultid, studyName: o.description || (d && d.testName) || 'Imaging', date: o.date, printType: o.printType,
                    report: (d && d.report) || '', reported: d && d.reported, enteredBy: d && d.enteredBy, testName: d && d.testName, doctor: d && d.doctor };
                }).catch(function(){ return null; });
            })).then(function(arr){ return arr.filter(Boolean); });
          }).catch(function(){ return []; });
        },
        // ICU "Fetch Imaging" button entry — re-pull imaging for the linked ward patient.
        fetchImagingIntoICU: function(patientId) {
          if (!window.ICU || !ICU.ingestWardImaging) { if (window.toast) toast('ICU dashboard not loaded.'); return; }
          patientId = patientId || GHIS._patientId;
          if (!patientId) { try { window.openGHIS && window.openGHIS(); } catch (e) {} return; }
          GHIS._patientId = patientId;
          GHIS.fetchImaging(patientId).then(function(records) {
            var res = ICU.ingestWardImaging({ patientId: patientId, source: 'Ward Sync', imaging: records });
            try { if (window.toast) toast(res && res.added ? ('Imported ' + res.added + ' imaging report' + (res.added === 1 ? '' : 's') + (res.duplicates ? ' · ' + res.duplicates + ' already present' : '')) : 'No new imaging reports for this patient.'); } catch (e) {}
          }).catch(function(){ if (window.toast) toast('Couldn’t load imaging right now. Please try again.'); });
        },
        // Patient-card click dispatcher: normal browse -> lab drawer; import mode
        // (launched from Dx My Patient -> Import Patient) -> pull reports into the engine.
        /* Initial assessment for an ADMITTED patient.
         *
         * Ward Sync already lists exactly the patients who have one - GetIPWL is the admitted
         * roster - and each row already carries its IPMR visit as episodeId. So there is nothing
         * to look up: hand the ids straight to the assessment workspace the OPD queue already uses.
         * Verified against the live server (docs/ghis/captured-initial-assessment-write.md): an
         * admitted patient activates with the same <MR>-<visit> recordNo as an out-patient, and
         * the Initial assessment tab is the same form.
         *
         * visitId mirrors episodeId because for an in-patient the admission IS the visit. */
        openAssessment: function(episodeId, patientId, name) {
          if (!patientId) { try { window.toast && window.toast('This patient has no hospital record number.'); } catch (e) {} return; }
          if (!episodeId) { try { window.toast && window.toast('No admission visit on this row, so an assessment cannot be filed against it.'); } catch (e) {} return; }
          if (!(window.OPDEMR && window.OPDEMR.openProfile)) { try { window.toast && window.toast('The patient workspace is still loading.'); } catch (e) {} return; }
          try { var pnl = document.getElementById('ghisPanel'); if (pnl) pnl.classList.remove('open'); } catch (e) {}
          window.OPDEMR.openProfile({
            name: name || '', patientId: patientId,
            episodeId: episodeId, visitId: episodeId,
            source: 'ghis', tab: 'assess'
          });
        },

        onPatient: function(episodeId, patientId, name) {
          if (_adapterCtx) { ghisOpenAdapterPatient(patientId, name); return; }
          if (_connectCtx) {   // Connect-hospital roster: tap -> pull this patient from the FHIR EMR into ICU
            try { var pnl = document.getElementById('ghisPanel'); if (pnl) pnl.classList.remove('open'); } catch (e) {}
            if (window.SMD_openConnectPatient) window.SMD_openConnectPatient(_connectCtx.tid, patientId, _connectCtx.cid, name);
            return;
          }
          // One-shot "pick a patient for another module" handoff (see pickPatient below). Checked
          // before the import and lab paths so the caller gets the tap instead of the ward drawer.
          if (GHIS._pickCb) {
            var cb = GHIS._pickCb; GHIS._pickCb = null;
            try { var pk = document.getElementById('ghisPanel'); if (pk) pk.classList.remove('open'); } catch (e) {}
            try { cb({ episodeId: episodeId, patientId: patientId, name: name }); } catch (e) {}
            return;
          }
          if (GHIS._importMode) { GHIS._importMode = false; GHIS.importPatientReports(patientId, name); }
          else { GHIS.openLab(episodeId, patientId, name); }
        },
        // Entry point for Dx My Patient -> Import Patient. Opens the ward picker in
        // import mode; selecting a patient assembles their reports and hands them to DX.
        startImport: function() { GHIS._importMode = true; try { window.openGHIS(); } catch (e) {} },
        /* Generic one-shot patient picker for another module (SURGX notes uses it).
         * Opens THIS roster - which already has the search, filters and sign-in handling - and
         * calls cb({episodeId, patientId, name}) once, on the next patient tap. Rebuilding a
         * second ward list inside another module would duplicate all of that and drift from it.
         * The callback is cleared before firing, so a stale handoff can never hijack a later tap;
         * cancel() drops it if the doctor backs out instead. */
        pickPatient: function(cb) {
          GHIS._pickCb = (typeof cb === 'function') ? cb : null;
          GHIS._importMode = false;
          try { window.openGHIS(); } catch (e) {}
        },
        cancelPick: function() { GHIS._pickCb = null; },
        // Assemble a ward patient's labs + imaging + culture and load into the reasoning
        // workspace (display + suggest-with-confirm — DX never auto-ticks findings).
        importPatientReports: function(patientId, name) {
          if (!window.DX || !DX.importPatient) { alert('Dx workspace not loaded.'); return; }
          var list = (typeof _patients !== 'undefined' && _patients) || [], pObj = null;
          for (var i = 0; i < list.length; i++) { if (String(list[i].patientId) === String(patientId)) { pObj = list[i]; break; } }
          var pnl = document.getElementById('ghisPanel');
          var prevBody = pnl ? pnl.querySelector('.ghis-body') : null;
          if (prevBody) prevBody.innerHTML = '<div class="ghis-loading">Importing reports for ' + esc(name || patientId) + '…</div>';
          GHIS._patientId = patientId;
          var labs = [], culture = [], radiology = [];
          // 1) lab orders -> lab-detail for each recent order
          authFetch('/lab?patientId=' + encodeURIComponent(patientId)).then(function(j) {
            var orders = ((j && j.orders) || []).slice(0, 25);
            return Promise.all(orders.map(function(o) {
              return authFetch('/lab-detail?renderId=' + encodeURIComponent(o.renderId) + '&episodeId=' + encodeURIComponent(o.episodeId) + '&patientId=' + encodeURIComponent(patientId))
                .then(function(d) {
                  (d && d.tests || []).forEach(function(t) {
                    labs.push({ test: t.test, result: t.result, units: t.units, low: t.low, high: t.high, critical: t.critical });
                    if (t.antibiogram && String(t.antibiogram).trim()) culture.push({ name: (o.serviceName || 'Culture') + ' — ' + (t.test || ''), detail: String(t.antibiogram) });
                    // ENH-01: capture a blood-culture organism/result even without an antibiogram block,
                    // so it auto-populates the workup from Ward Sync instead of manual entry.
                    else if (/blood\s*culture|bactec|blood\s*c\/s/i.test((o.serviceName || '') + ' ' + (t.test || '')) && t.result && String(t.result).trim()) culture.push({ name: (o.serviceName || 'Blood culture') + (t.test ? ' — ' + t.test : ''), detail: String(t.result), bloodCulture: true });
                  });
                  if (/culture|sensitivit/i.test(o.serviceName || '') && (!d || !(d.tests || []).length)) culture.push({ name: o.serviceName, detail: '(open in Ward Sync for full report)' });
                }).catch(function(){});
            }));
          }).catch(function(){}).then(function() {
            // 2) radiology orders -> reports
            return authFetch('/radiology?patientId=' + encodeURIComponent(patientId)).then(function(j) {
              var orders = ((j && j.orders) || []).slice(0, 12);
              return Promise.all(orders.map(function(o) {
                return authFetch('/radiology-report?resultid=' + encodeURIComponent(o.resultid) + '&type=' + encodeURIComponent(o.printType || 'manual'))
                  .then(function(d) { radiology.push({ name: o.description || 'Imaging', report: (d && d.report) || 'No report text.' }); }).catch(function(){});
              }));
            }).catch(function(){});
          }).then(function() {
            var age = pObj ? parseInt(pObj.dob, 10) : NaN;
            DX.importPatient({ patientName: name || (pObj && pObj.patientFirstName) || '', age: (!isNaN(age) && age > 0 && age < 130) ? age : null, sex: pObj && pObj.gender, labs: labs, radiology: radiology, culture: culture, mrn: (pObj && pObj.patientId) || '' });
            try { if (pnl) pnl.classList.remove('open'); } catch (e) {}
          });
        },
        loadLabs: function(patientId) {
          var body = document.getElementById('ghisLabSection');
          if (!body) return;
          authFetch('/lab?patientId=' + encodeURIComponent(patientId))
            .then(function(j) {
              if (j && j.error === 'session_expired') {
                body.innerHTML = '<div class="ghis-lab-empty">Your session expired — sign in again in the Ward panel.</div>';
                return;
              }
              var orders = (j && j.orders) || [];
              if (orders.length === 0) {
                body.innerHTML = '<div class="ghis-lab-empty">No lab orders found for this patient.</div>';
                return;
              }
              // Group orders by date (most recent first)
              var byDate = {};
              var dateOrder = [];
              orders.forEach(function(o) {
                var day = (o.orderDate || '').split(':')[0].trim() || 'Undated';
                if (!byDate[day]) { byDate[day] = []; dateOrder.push(day); }
                byDate[day].push(o);
              });
              var html = '<div class="ghis-lab-section-title">' + wIco("flask") + ' Labs · ' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + '</div>';
              dateOrder.forEach(function(day) {
                html += '<div class="ghis-lab-group"><div class="ghis-lab-group-name">' + esc(day) + '</div>';
                byDate[day].forEach(function(o) {
                  html += '<div class="ghis-lab-order" onclick="GHIS.toggleOrder(this,\'' + jsq(o.renderId) + '\',\'' + jsq(o.episodeId) + '\')">' +
                    '<div class="ghis-lab-order-head">' +
                      '<div class="ghis-lab-order-name">' + esc(o.serviceName || '—') + '</div>' +
                      '<div class="ghis-lab-order-dept">' + esc(o.department || '') + '</div>' +
                    '</div>' +
                    '<div class="ghis-lab-detail" style="display:none"></div>' +
                  '</div>';
                });
                html += '</div>';
              });
              body.innerHTML = html;
            })
            .catch(function(e) {
              body.innerHTML = '<div class="ghis-lab-empty">Couldn’t load labs right now — please try again.</div>';
            });
        },
        loadRadiology: function(patientId) {
          var sec = document.getElementById('ghisRadSection');
          if (!sec) return;
          authFetch('/radiology?patientId=' + encodeURIComponent(patientId))
            .then(function(j) {
              var orders = (j && j.orders) || [];
              if (orders.length === 0) { sec.innerHTML = ''; return; }
              var html = '<div class="ghis-lab-section-title">' + wIco("xray") + ' Imaging · ' + orders.length + ' stud' + (orders.length === 1 ? 'y' : 'ies') + '</div>';
              orders.forEach(function(o) {
                html += '<div class="ghis-lab-order ghis-rad-order" onclick="GHIS.toggleRad(this,\'' + jsq(o.resultid) + '\',\'' + jsq(o.printType) + '\')">' +
                  '<div class="ghis-lab-order-head">' +
                    '<div class="ghis-lab-order-name">' + esc(o.description || 'Study') + '</div>' +
                    '<div class="ghis-lab-order-dept">' + esc(o.date || '') + '</div>' +
                  '</div>' +
                  '<div class="ghis-lab-detail" style="display:none"></div>' +
                '</div>';
              });
              html += '<div class="ghis-rad-divider"></div>';
              sec.innerHTML = html;
            })
            .catch(function() { sec.innerHTML = ''; });
        },
        toggleRad: function(el, resultid, type) {
          var det = el.querySelector('.ghis-lab-detail');
          if (!det) return;
          if (det.getAttribute('data-loaded') === '1') {
            det.style.display = det.style.display === 'none' ? '' : 'none';
            el.classList.toggle('open');
            return;
          }
          det.style.display = '';
          el.classList.add('open');
          det.innerHTML = '<div class="ghis-loading" style="padding:8px 0">Loading report…</div>';
          authFetch('/radiology-report?resultid=' + encodeURIComponent(resultid) + '&type=' + encodeURIComponent(type))
            .then(function(d) {
              if (d && d.error === 'session_expired') { det.innerHTML = '<div class="ghis-lab-detail-empty">Session expired — reconnect.</div>'; return; }
              var meta = [];
              if (d.reported) meta.push('Reported ' + esc(d.reported));
              if (d.enteredBy) meta.push(esc(d.enteredBy));
              det.innerHTML = (meta.length ? '<div class="ghis-rad-meta">' + meta.join(' · ') + '</div>' : '') +
                '<div class="ghis-rad-report">' + esc(d.report || 'No report text.') + '</div>';
              det.setAttribute('data-loaded', '1');
            })
            .catch(function(e) { det.innerHTML = '<div class="ghis-lab-detail-empty">Error: ' + esc(e.message) + '</div>'; });
        },
        toggleOrder: function(el, renderId, episodeId) {
          var det = el.querySelector('.ghis-lab-detail');
          if (!det) return;
          // collapse if already open
          if (det.style.display !== 'none' && det.getAttribute('data-loaded') === '1') {
            det.style.display = det.style.display === 'none' ? '' : 'none';
            el.classList.toggle('open');
            return;
          }
          det.style.display = '';
          el.classList.add('open');
          if (det.getAttribute('data-loaded') === '1') return;
          det.innerHTML = '<div class="ghis-loading" style="padding:8px 0">Loading values…</div>';
          authFetch('/lab-detail?renderId=' + encodeURIComponent(renderId) +
                '&episodeId=' + encodeURIComponent(episodeId) +
                '&patientId=' + encodeURIComponent(GHIS._patientId || ''))
            .then(function(d) {
              det.innerHTML = renderLabDetail(d);
              det.setAttribute('data-loaded', '1');
            })
            .catch(function(e) {
              det.innerHTML = '<div class="ghis-lab-detail-empty">Error: ' + esc(e.message) + '</div>';
            });
        },
        // ── exposed for Clinical Calculators auto-fill (gold136) ──────────────
        // Read-only accessors + a lab fetch that flattens a patient's recent
        // panels to raw test rows {test,result,units,low,high,range,order,date}
        // for the calculators' analyte extractor. No auto-mapping happens here —
        // the extractor + the clinician's verification stay the source of truth.
        isConnected: function() { return !!_connected; },
        getPatients: function() { return (_patients || []).slice(); },
        // Best-effort: the patient's registered mobile from GHIS demographics (Searchnew page), by MR number.
        // Resolves to '' (never rejects) if not connected / not found / GHIS denies — callers pre-fill only if set.
        // Best-effort demographics for enrolment prefill: the patient's mobile + a short address/locality
        // snippet (`region`) used ONLY for deterministic language detection. Never rejects.
        fetchDemographics: function(patientId) {
          try {
            if (!_connected || !patientId) return Promise.resolve({ phone: '', region: '' });
            var list = _patients || [], p = null;
            for (var i = 0; i < list.length; i++) { if (String(list[i].patientId) === String(patientId)) { p = list[i]; break; } }
            if (!p || !p.episodeId) return Promise.resolve({ phone: '', region: '' });
            var recordNo = p.patientId + '-' + p.episodeId;
            return authFetch('/demographics?recordNo=' + encodeURIComponent(recordNo))
              .then(function(d) { return { phone: (d && d.phone) || '', region: (d && d.region) || '' }; }, function() { return { phone: '', region: '' }; });
          } catch (e) { return Promise.resolve({ phone: '', region: '' }); }
        },
        fetchPhone: function(patientId) {
          return this.fetchDemographics(patientId).then(function(d) { return (d && d.phone) || ''; });
        },
        // Call the patient: pull their number from GHIS (never shown/stored), then dial via tel:.
        callPatient: function(patientId, btn) {
          if (btn) { try { btn.disabled = true; } catch (e) {} }
          function done() { if (btn) { try { btn.disabled = false; } catch (e) {} } }
          return GHIS.fetchPhone(patientId).then(function(ph) {
            done();
            ph = String(ph || '').replace(/[^0-9+]/g, '');
            if (!ph) { try { if (window.toast) toast('No phone number on record for this patient.'); } catch (e) {} return; }
            try { window.location.href = 'tel:' + ph; } catch (e) {}
          }, function() { done(); try { if (window.toast) toast('Could not fetch the number.'); } catch (e) {} });
        },
        fetchLabTests: function(patientId) {
          return authFetch('/lab?patientId=' + encodeURIComponent(patientId)).then(function(j) {
            var orders = ((j && j.orders) || []).slice(0, 25);
            var rows = [];
            return Promise.all(orders.map(function(o) {
              return authFetch('/lab-detail?renderId=' + encodeURIComponent(o.renderId) + '&episodeId=' + encodeURIComponent(o.episodeId) + '&patientId=' + encodeURIComponent(patientId))
                .then(function(d) { (d && d.tests || []).forEach(function(t) { rows.push({ test: t.test, result: t.result, units: t.units, low: t.low, high: t.high, range: t.range, critical: t.critical, order: o.serviceName, date: o.orderDate }); }); })
                .catch(function() {});
            })).then(function() { return rows; });
          });
        }
      };
    
      window.openGHIS = function() {
        document.getElementById('ghisPanel').classList.add('open');
        // No saved login? Ask which hospital first (GIMSR → GHIS login; others → request form).
        if (!getToken()) { showScreen('hospital'); return; }
        // Have a saved login? Verify the token and go straight to the ward.
        fetch(PROXY + '/status', { headers: { 'Authorization': 'Bearer ' + getToken() } })
          .then(function(r) { return r.json(); })
          .then(function(s) {
            if (s.connected) { _connected = true; dot(true); showScreen('ward'); ghisLoadPatients(); }
            else { setToken(''); showScreen('hospital'); }
          })
          .catch(function() { showScreen('hospital'); });
      };
    
      window.closeGHIS = function() {
        document.getElementById('ghisPanel').classList.remove('open');
        // If the Drug Interactions overlay is open behind us, refresh it so the
        // Ward Sync card + patient pill reflect the patient just selected here.
        try {
          var mi = document.getElementById('miOverlay');
          if (mi && mi.classList.contains('on')) {
            if (window.MEDDRUGS && window.MEDDRUGS.updatePatientPill) window.MEDDRUGS.updatePatientPill();
            if (window.MEDLIST && window.MEDLIST._rerender) window.MEDLIST._rerender();
          }
        } catch (e) {}
      };
    
      window.closeLabDrawer = function() {
        document.getElementById('ghisLabDrawer').style.display = 'none';
        // Restore the patient-list scroll position saved when the drawer opened (openLab reset it
        // to 0 so the detail opened from its top) — back returns you where you were in the list.
        try { var ward = document.getElementById('ghisWard'); if (ward && window.GHIS && GHIS._listScroll != null) ward.scrollTop = GHIS._listScroll; } catch (e) {}
      };

      // Escape closes the lab drawer first (back to list), then the whole panel —
      // a keyboard/hardware-back escape hatch in addition to the header buttons.
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var panel = document.getElementById('ghisPanel');
        if (!panel || !panel.classList.contains('open')) return;
        var drawer = document.getElementById('ghisLabDrawer');
        if (drawer && drawer.style.display !== 'none') window.closeLabDrawer();
        else window.closeGHIS();
      });
    
      window.ghisConnect = function() {
        var userId = (document.getElementById('ghisUserId').value || '').trim();
        var password = document.getElementById('ghisPassword').value || '';
        var errEl = document.getElementById('ghisSetupError');
        if (!userId || !password) { errEl.textContent = 'Enter your GHIS ID and password.'; return; }
        errEl.textContent = 'Signing in…';
        fbToken().then(function(jwt){
          var h = { 'Content-Type': 'application/json' }; if (jwt) h['Authorization'] = 'Bearer ' + jwt;
          return fetch(PROXY + '/login', { method: 'POST', headers: h, body: JSON.stringify({ userId: userId, password: password }) });
        })
        .then(function(r) { return r.json().then(function(d){ return { ok: r.ok, s: r.status, d: d }; }); })
        .then(function(res) {
          if (res.s === 402 || (res.d && res.d.needsPro)) {
            errEl.textContent = '';
            // The server now says WHY (unverified / free week over). Let the shared explainer pick
            // the wording and the button; going straight to the paywall told an unverified doctor
            // to pay for something verification would have unlocked for free.
            try { if (window.SMD_PRO_NOTICE && SMD_PRO_NOTICE.handle(res.d || {}, 'ward-sync')) return; } catch (e) {}
            try { if (window.SMD_PRO && SMD_PRO.openPaywall) { SMD_PRO.openPaywall('wardsync'); return; } } catch (e) {}
            errEl.textContent = 'Ward Sync is a StewardMD Pro feature.';
            return;
          }
          if (res.ok && res.d.token) {
            setToken(res.d.token);
            document.getElementById('ghisPassword').value = '';
            _connected = true; dot(true);
            errEl.textContent = '';
            showScreen('ward');
            ghisLoadPatients();
          } else {
            errEl.textContent = res.d.error === 'bad_credentials' ? 'Wrong GHIS ID or password.' : ('Sign-in failed: ' + (res.d.error || 'unknown error'));
          }
        })
        .catch(function() { errEl.textContent = 'Server not reachable. Try again.'; });
      };
    
      window.ghisDisconnect = function() {
        if (_adapterCtx) { _adapterCtx = null; _patients = []; try { GHIS.clearSelectedPatient(); } catch (e) {} showScreen('hospital'); return; }
        DEMO = null;
        var t = getToken();
        if (t) { fetch(PROXY + '/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t } }).catch(function(){}); }
        setToken('');
        _connected = false;
        dot(false);
        _patients = [];
        // Patient-scoped privacy: drop the selected patient + any GHIS medication-import draft.
        try { GHIS.clearSelectedPatient(); } catch (e) {}
        showScreen('setup');
      };
    
      window.ghisRefresh = function() {
        if (_adapterCtx) { window.ghisOpenAdapterHospital(_adapterCtx.conn.deploymentId); return; }
        if (_connectCtx) { window.ghisLoadConnectRoster(_connectCtx.tid, _connectCtx.name); return; }
        if (_connected) ghisLoadPatients();
      };
    
      // ── Connected (Connect EMR / FHIR) hospital roster — the source-neutral equivalent of GHIS /patients.
      // Loads today's inpatients from a connected hospital into the SAME ward list; tapping a card pulls that
      // patient into ICU via the Connect patient pull (labs/vitals/imaging/meds), mirroring the GHIS path.
      window.ghisLoadConnectRoster = function (tid, hospName) {
        var el = document.getElementById('ghisPatientList');
        try { showGhisScreen('ward'); } catch (e) {}
        if (el) el.innerHTML = '<div class="ghis-loading">Loading ' + esc(hospName || 'hospital') + ' ward list…</div>';
        if (!window.SMD_CONNECT || !SMD_CONNECT.connections) { if (el) el.innerHTML = '<div class="ghis-empty">Connect is unavailable.</div>'; return; }
        SMD_CONNECT.connections(tid).then(function (conns) {
          var fhir = (conns || []).filter(function (c) { return c && c.connectionId; })[0];
          if (!fhir) { if (el) el.innerHTML = '<div class="ghis-empty">No FHIR connection on this hospital yet. Add one in Connect EMR.</div>'; return; }
          return SMD_CONNECT.worklist({ tenantId: tid, connectionId: fhir.connectionId }).then(function (r) {
            if (!r || r.error) { if (el) el.innerHTML = '<div class="ghis-empty">Could not load the ward list: ' + esc((r && r.error) || 'error') + '</div>'; return; }
            _connectCtx = { tid: tid, cid: fhir.connectionId, name: hospName || '' };
            _patients = (r.rows || []);
            populateFilterOptions();
            ghisApplyFilters();
          });
        }).catch(function () { if (el) el.innerHTML = '<div class="ghis-empty">Network error loading the ward list.</div>'; });
      };
      function ghisLoadPatients() {
        _connectCtx = null; _adapterCtx = null;   // a GHIS roster load clears any Connect-hospital context
        var el = document.getElementById('ghisPatientList');
        if (el) el.innerHTML = '<div class="ghis-loading">Loading ward patients…</div>';
        authFetch('/patients')
          .then(function(raw) {
            var data;
            try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { data = []; }
            _patients = Array.isArray(data) ? data : [];
            populateFilterOptions();
            ghisApplyFilters();
          })
          .catch(function(e) {
            if (el) el.innerHTML = '<div class="ghis-empty">Error: ' + esc(e.message) + '</div>';
          });
      }
    
      // ── patient list: combined search + branch/doctor/gender filters + sort ──
      function _val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
      // natural compare so "Bed 2" sorts before "Bed 10"
      function _cmp(a, b) { return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, { numeric: true, sensitivity: 'base' }); }
      function _distinct(vals) {
        var seen = {}, out = [];
        vals.forEach(function(v) { v = String(v || '').trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
        out.sort(function(a, b) { return _cmp(a, b); });
        return out;
      }
      function _fillSelect(id, values) {
        var sel = document.getElementById(id); if (!sel) return;
        var cur = sel.value;
        var head = sel.querySelector('option'); head = head ? head.outerHTML : '';  // keep the "All …" option
        sel.innerHTML = head + values.map(function(v) {
          return '<option value="' + esc(v).replace(/"/g, '&quot;') + '">' + esc(v) + '</option>';
        }).join('');
        if (cur && values.indexOf(cur) !== -1) sel.value = cur;   // preserve selection across refresh
      }
      function populateFilterOptions() {
        _fillSelect('ghisFBranch', _distinct(_patients.map(function(p) { return p.deptDescription; })));
        _fillSelect('ghisFDoctor', _distinct(_patients.map(function(p) { return p.employeeFirstName; })));
      }
      function _genderMatch(g, sel) {
        if (!sel) return true;
        return String(g || '').trim().toLowerCase().charAt(0) === sel;   // 'm' / 'f'
      }
      window.ghisApplyFilters = function() {
        var q = (_val('ghisSearchPt') || '').toLowerCase().trim();
        var br = _val('ghisFBranch'), dr = _val('ghisFDoctor'), gn = _val('ghisFGender'), sort = _val('ghisFSort');
        var list = _patients.filter(function(p) {
          if (q && String(p.patientFirstName || '').toLowerCase().indexOf(q) === -1 &&
                   String(p.patientId || '').toLowerCase().indexOf(q) === -1) return false;
          if (br && String(p.deptDescription || '') !== br) return false;
          if (dr && String(p.employeeFirstName || '') !== dr) return false;
          if (!_genderMatch(p.gender, gn)) return false;
          return true;
        });
        var key = sort === 'name' ? 'patientFirstName' : sort === 'branch' ? 'deptDescription'
                : sort === 'doctor' ? 'employeeFirstName' : sort === 'bed' ? 'bedName' : null;
        if (key) list = list.slice().sort(function(a, b) { return _cmp(a[key], b[key]); });
        renderPatients(list);
        try { renderFavs(); } catch (e) {}
        var cnt = document.getElementById('ghisCount');
        if (cnt) cnt.textContent = _patients.length
          ? (list.length + (list.length === 1 ? ' patient' : ' patients') + (list.length !== _patients.length ? ' · of ' + _patients.length : ''))
          : '';
      };
      // legacy alias — older inline handlers / callers still reference this name
      window.ghisFilterLocal = window.ghisApplyFilters;

      // ── Favourites: star a doctor or ward/branch to pin it as a one-tap quick-filter chip at the top.
      // Personal + device-local (localStorage). Self-contained: injects its own host div + CSS so it does
      // not touch the static panel markup. (Requested by Sri Harsha, 18/8.)
      var FAV_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.6l-5.7 3.0 1.09-6.35-4.62-4.5 6.38-.93z"/></svg>';
      function _favKey() { return 'smd_ward_favs'; }
      function favLoad() { try { return JSON.parse(localStorage.getItem(_favKey()) || '{}') || {}; } catch (e) { return {}; } }
      function favSave(o) { try { localStorage.setItem(_favKey(), JSON.stringify(o)); } catch (e) {} }
      function _favList(o, type) { return (o && o[type]) || []; }
      function _attr(v) { return esc(String(v == null ? '' : v)).replace(/"/g, '&quot;'); }
      function _ensureFavCss() {
        if (document.getElementById('ghisFavsCss')) return;
        var s = document.createElement('style'); s.id = 'ghisFavsCss';
        s.textContent = '.ghis-favs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 8px}'
          + '.ghis-fav-chip{display:inline-flex;align-items:center;gap:5px;background:var(--panel,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:999px;padding:5px 6px 5px 11px;font-size:12.5px;font-weight:600;color:var(--ink,#0f172a);cursor:pointer}'
          + '.ghis-fav-chip svg{width:12px;height:12px;color:var(--teal,#14b8a6);fill:currentColor;flex:0 0 auto}'
          + '.ghis-fav-chip.active{border-color:var(--teal,#14b8a6);background:rgba(20,184,166,.12);color:var(--teal,#14b8a6)}'
          + '.ghis-fav-chip .x{border:none;background:none;color:var(--slate,#94a3b8);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}'
          + '.ghis-fav-add{display:inline-flex;align-items:center;gap:5px;background:none;border:1px dashed var(--teal,#14b8a6);color:var(--teal,#14b8a6);border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700;cursor:pointer}'
          + '.ghis-fav-add svg{width:12px;height:12px;fill:currentColor}'
          + '.ghis-fav-hint{font-size:12px;color:var(--slate,#94a3b8)}';
        document.head.appendChild(s);
      }
      function _ensureFavHost() {
        var h = document.getElementById('ghisFavs'); if (h) return h;
        var row2 = document.querySelector('#ghisWard .ghis-filter-row2'); if (!row2 || !row2.parentNode) return null;
        h = document.createElement('div'); h.id = 'ghisFavs'; h.className = 'ghis-favs';
        row2.parentNode.insertBefore(h, row2);
        h.addEventListener('click', function (e) {
          var rm = e.target.closest && e.target.closest('[data-fav-remove]');
          if (rm) { e.stopPropagation(); window.ghisFavRemove(rm.getAttribute('data-fav-remove'), rm.getAttribute('data-fav-val')); return; }
          var ap = e.target.closest && e.target.closest('[data-fav-apply]');
          if (ap) { window.ghisFavApply(ap.getAttribute('data-fav-apply'), ap.getAttribute('data-fav-val')); return; }
          if (e.target.closest && e.target.closest('[data-fav-star]')) window.ghisFavStar();
        });
        return h;
      }
      function _favChip(type, val, active, label) {
        var a = _attr(val);
        return '<span class="ghis-fav-chip' + (active ? ' active' : '') + '" data-fav-apply="' + type + '" data-fav-val="' + a + '">'
          + FAV_STAR + '<span>' + esc(label) + '</span>'
          + '<button class="x" data-fav-remove="' + type + '" data-fav-val="' + a + '" aria-label="Remove favourite">×</button></span>';
      }
      function renderFavs() {
        _ensureFavCss();
        var host = _ensureFavHost(); if (!host) return;
        var favs = favLoad(), dr = _val('ghisFDoctor'), br = _val('ghisFBranch'), out = [];
        _favList(favs, 'branch').forEach(function (v) { out.push(_favChip('branch', v, br === v, v)); });
        _favList(favs, 'doctor').forEach(function (v) { out.push(_favChip('doctor', v, dr === v, 'Dr ' + v)); });
        var canStar = (dr && _favList(favs, 'doctor').indexOf(dr) === -1) || (br && _favList(favs, 'branch').indexOf(br) === -1);
        if (canStar) out.push('<button class="ghis-fav-add" data-fav-star="1">' + FAV_STAR + 'Star current</button>');
        else if (!out.length) out.push('<span class="ghis-fav-hint">Pick a doctor or ward, then tap Star to pin it here.</span>');
        host.innerHTML = out.join('');
      }
      window.ghisFavApply = function (type, val) {
        var sel = document.getElementById(type === 'doctor' ? 'ghisFDoctor' : 'ghisFBranch'); if (!sel) return;
        sel.value = val;
        if (sel.value !== val) { var o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o); sel.value = val; }
        if (window.ghisApplyFilters) window.ghisApplyFilters();
      };
      window.ghisFavRemove = function (type, val) {
        var o = favLoad(); o[type] = _favList(o, type).filter(function (x) { return x !== val; }); favSave(o); renderFavs();
      };
      window.ghisFavStar = function () {
        var dr = _val('ghisFDoctor'), br = _val('ghisFBranch'), o = favLoad(), n = 0;
        if (dr) { o.doctor = _favList(o, 'doctor'); if (o.doctor.indexOf(dr) === -1) { o.doctor.push(dr); n++; } }
        if (br) { o.branch = _favList(o, 'branch'); if (o.branch.indexOf(br) === -1) { o.branch.push(br); n++; } }
        if (!n) { try { if (window.toast) toast('Pick a doctor or ward first, then tap Star.'); } catch (e) {} return; }
        favSave(o); renderFavs();
        try { if (window.toast) toast('Pinned to favourites'); } catch (e) {}
      };

      // ── react to Google account switch / sign-out ────────────────────────────
      // The GHIS token is scoped per Firebase uid; when the signed-in account
      // changes we must drop the previous account's in-memory ward view and
      // re-resolve against THIS account's own stored token (if any). Firebase is
      // lazy-loaded, so keep trying to attach until it's ready. Guard on the
      // owner actually changing so a same-user token refresh never wipes the view.
      (function watchGhisAuth() {
        var lastOwner = ghisOwner(), tries = 0;
        function onAuth() {
          var now = ghisOwner();
          if (now === lastOwner) return;      // same account (e.g. token refresh) — leave as-is
          lastOwner = now;
          _connected = false; _patients = []; _connectCtx = null; dot(false);
          var panel = document.getElementById('ghisPanel');
          if (panel && panel.classList.contains('open')) {
            // Panel is open during the switch → re-run the normal entry logic so it
            // auto-connects with the new account's saved token or shows the login.
            try { window.openGHIS(); } catch (e) { showScreen('setup'); }
          } else {
            showScreen('setup');
          }
        }
        function attach() {
          try {
            var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
            if (a && a.onAuthStateChanged) { a.onAuthStateChanged(onAuth); return true; }
          } catch (e) {}
          return false;
        }
        if (attach()) return;
        var iv = setInterval(function () { if (attach() || ++tries > 60) clearInterval(iv); }, 500);
      })();

      // Background lab-watch notification deep link: /?ghisRef=<ref> → open that patient.
      // `ref` is opaque (see functions/api/watch/[[path]].js) — never the real patientId — so it
      // must be resolved through SMD_WATCH.resolveRef() (the doctor's own authenticated session)
      // before GHIS.openPatientById can be called with a real id.
      (function () {
        try {
          var m = (location.search || "").match(/[?&]ghisRef=([^&]+)/);
          if (!m || !m[1]) return;
          var ref = decodeURIComponent(m[1]);
          (function waitForWatch(tries) {
            if (window.SMD_WATCH && window.SMD_WATCH.resolveRef) {
              window.SMD_WATCH.resolveRef(ref).then(function (pid) {
                if (pid) { try { window.GHIS && GHIS.openPatientById(pid); } catch (e) {} }
              });
            } else if (tries < 40) {
              setTimeout(function () { waitForWatch(tries + 1); }, 250);   // watch-lab.js not loaded yet
            }
          })(0);
        } catch (e) {}
      })();

    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
