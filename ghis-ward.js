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

  var CSS = "#ghisPanel {\n  position: fixed; inset: 0; z-index: 18000;\n  background: var(--paper, #ffffff); display: flex; flex-direction: column;\n  transform: translateX(100%);\n  transition: transform 0.3s cubic-bezier(.4,0,.2,1);\n}\n#ghisPanel.open { transform: translateX(0); }\n.ghis-header {\n  display: flex; align-items: center; gap: 10px;\n  padding: calc(14px + env(safe-area-inset-top)) 16px 14px; border-bottom: 1px solid var(--line, #e2e8f0);\n  background: var(--panel, #f8fafc); flex-shrink: 0;\n}\n.ghis-back { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--teal, #14b8a6); padding: 4px 8px; }\n.ghis-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--ink, #0f172a); display: flex; align-items: center; gap: 8px; }\n.ghis-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }\n.ghis-dot-off { background: #aaa; }\n.ghis-dot-on { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }\n.ghis-refresh-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 16px; color: var(--teal, #14b8a6); padding: 4px 10px; }\n.ghis-body { flex: 1; overflow-y: auto; padding: 16px; }\n.ghis-setup-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 14px; padding: 20px; max-width: 480px; margin: 20px auto; }\n.ghis-setup-title { font-size: 15px; font-weight: 700; color: var(--ink, #0f172a); margin-bottom: 14px; }\n.ghis-setup-sub { font-size: 12px; color: var(--slate, #64748b); margin: -8px 0 14px; }\n.ghis-login-input { width: 100%; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 14px; padding: 11px; box-sizing: border-box; margin-bottom: 10px; }\n.ghis-login-input:focus { outline: none; border-color: var(--teal, #14b8a6); }\n.ghis-remember { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--slate, #64748b); margin-bottom: 4px; cursor: pointer; }\n.ghis-remember input { width: 15px; height: 15px; }\n.ghis-setup-steps { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }\n.ghis-step { font-size: 13px; color: var(--slate, #64748b); display: flex; gap: 10px; align-items: flex-start; }\n.ghis-step-num { background: var(--teal, #14b8a6); color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }\n.ghis-step code { background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 5px; padding: 1px 5px; font-size: 12px; color: var(--teal, #14b8a6); }\n.ghis-cookie-input { width: 100%; min-height: 80px; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 11px; padding: 8px; box-sizing: border-box; resize: vertical; font-family: monospace; }\n.ghis-connect-btn { margin-top: 10px; width: 100%; background: var(--teal, #14b8a6); color: #fff; border: none; border-radius: 10px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }\n.ghis-connect-btn:hover { opacity: 0.88; }\n.ghis-setup-error { color: #ef4444; font-size: 12px; margin-top: 8px; min-height: 16px; }\n.ghis-logout-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--slate, #64748b); padding: 6px 10px; }\n.ghis-filter-row { display: flex; gap: 8px; margin-bottom: 8px; }\n.ghis-filter-input { flex: 1; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 12px; font-size: 13px; }\n.ghis-filter-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }\n@media (min-width: 560px) { .ghis-filter-row2 { grid-template-columns: 1fr 1fr 1fr 1fr; } }\n.ghis-filter-sel { min-width: 0; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 10px; font-size: 12.5px; cursor: pointer; }\n.ghis-filter-sel:focus { outline: none; border-color: var(--teal, #14b8a6); }\n.ghis-count { font-size: 12px; color: var(--slate, #64748b); margin: 0 2px 10px; font-weight: 600; }\n.ghis-pt-list { display: flex; flex-direction: column; gap: 8px; }\n.ghis-pt-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: border-color 0.15s; }\n.ghis-pt-card:hover { border-color: var(--teal, #14b8a6); }\n.ghis-pt-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }\n.ghis-pt-name { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-pt-status { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; white-space: nowrap; }\n.ghis-status-occupied { background: #dcfce7; color: #16a34a; }\n.ghis-status-bed { background: #fef9c3; color: #b45309; }\n.ghis-status-discharge { background: #fee2e2; color: #dc2626; }\n.ghis-status-other { background: var(--paper, #ffffff); color: var(--slate, #64748b); }\n.ghis-pt-meta { font-size: 12px; color: var(--slate, #64748b); margin-top: 4px; }\n.ghis-pt-dept { font-size: 12px; color: var(--teal, #14b8a6); font-weight: 600; margin-top: 2px; }\n.ghis-loading { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n.ghis-empty { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n/* Lab drawer */\n#ghisWard { position: relative; }\n.ghis-lab-drawer { position: absolute; inset: 0; background: var(--paper, #ffffff); overflow-y: auto; z-index: 2; }\n.ghis-lab-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e2e8f0); background: var(--panel, #f8fafc); position: sticky; top: 0; }\n.ghis-back-sm { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--teal, #14b8a6); font-weight: 700; padding: 4px 8px; }\n.ghis-lab-title { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-lab-body { padding: 14px 16px; }\n.ghis-lab-group { margin-bottom: 14px; }\n.ghis-lab-group-name { font-size: 12px; font-weight: 700; color: var(--teal, #14b8a6); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }\n.ghis-lab-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line, #e2e8f0); font-size: 13px; }\n.ghis-lab-test { color: var(--ink, #0f172a); }\n.ghis-lab-val { font-weight: 700; }\n.ghis-lab-val.abnormal { color: #ef4444; }\n.ghis-lab-date { font-size: 11px; color: var(--slate, #64748b); }\n.ghis-lab-empty { color: var(--slate, #64748b); font-size: 13px; text-align: center; padding: 20px; }\n.ghis-lab-count { font-size: 12px; color: var(--slate, #64748b); margin-bottom: 10px; }\n.ghis-lab-order { border: 1px solid var(--line, #e2e8f0); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; transition: background .12s; }\n.ghis-lab-order:hover { background: rgba(20,184,166,0.05); }\n.ghis-lab-order.open { border-color: var(--teal, #14b8a6); background: rgba(20,184,166,0.04); }\n.ghis-lab-order-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.ghis-lab-order-name { font-weight: 600; font-size: 13px; color: var(--ink, #0f172a); }\n.ghis-lab-order-dept { font-size: 11px; color: var(--slate, #64748b); white-space: nowrap; }\n.ghis-lab-detail { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--line, #e2e8f0); }\n.ghis-lab-detail-empty { color: var(--slate, #64748b); font-size: 12px; padding: 6px 0; }\n.ghis-lab-abx { font-size: 12px; color: var(--ink, #0f172a); background: rgba(20,184,166,0.06); border-radius: 6px; padding: 6px 8px; margin: 4px 0 8px; white-space: pre-wrap; }\n.ghis-lab-section-title { font-size: 13px; font-weight: 700; color: var(--ink, #0f172a); margin: 4px 0 10px; }\n.ghis-rad-order { border-color: rgba(99,102,241,0.35); }\n.ghis-rad-order:hover { background: rgba(99,102,241,0.05); }\n.ghis-rad-order.open { border-color: #6366f1; background: rgba(99,102,241,0.05); }\n.ghis-rad-meta { font-size: 11px; color: var(--slate, #64748b); margin-bottom: 6px; }\n.ghis-rad-report { font-size: 13px; line-height: 1.5; color: var(--ink, #0f172a); white-space: pre-wrap; }\n.ghis-rad-divider { height: 1px; background: var(--line, #e2e8f0); margin: 14px 0; }\n/* dark mode overrides */\nbody.dark .ghis-status-occupied { background: #14532d; color: #86efac; }\nbody.dark .ghis-status-bed { background: #451a03; color: #fcd34d; }\nbody.dark .ghis-status-discharge { background: #450a0a; color: #fca5a5; }\n\n.ghis-ward-fab {\n  position: fixed; bottom: calc(20px + env(safe-area-inset-bottom)); right: 20px; z-index: 17000;\n  display: inline-flex; align-items: center; gap: 6px;\n  padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;\n  background: var(--teal, #14b8a6); color: #fff; font-size: 14px; font-weight: 600;\n  box-shadow: 0 4px 14px rgba(0,0,0,0.18); font-family: inherit;\n}\n.ghis-ward-fab:hover { filter: brightness(1.05); }\n";
  var PANEL_HTML = "<div id=\"ghisPanel\">\n  <div class=\"ghis-header\">\n    <button class=\"ghis-back\" onclick=\"closeGHIS();try{window.SMD_showHome&&window.SMD_showHome()}catch(e){}\" aria-label=\"Back to home\">←</button>\n    <div class=\"ghis-title\">🏥 Ward Sync <span id=\"ghisConnDot\" class=\"ghis-dot ghis-dot-off\"></span></div>\n    <button class=\"ghis-refresh-btn\" id=\"ghisWatchedBtn\" onclick=\"if(window.SMD_WATCH&&window.SMD_WATCH.openManager)window.SMD_WATCH.openManager();else alert('Sign in with your Google/Apple account to see watched patients.')\" title=\"Lab Watch 24/7 — background lab alerts\">🔔</button>\n    <button class=\"ghis-refresh-btn\" id=\"ghisRefreshBtn\" onclick=\"ghisRefresh()\" title=\"Refresh\">↻</button>\n  </div>\n\n  <div id=\"ghisSetup\" class=\"ghis-body\">\n    <div class=\"ghis-setup-card\">\n      <div class=\"ghis-setup-title\">Sign in to GHIS</div>\n      <div class=\"ghis-setup-sub\">Use your own GITAM HIS login.</div>\n      <input id=\"ghisUserId\" class=\"ghis-login-input\" type=\"text\" autocomplete=\"username\" placeholder=\"GHIS User ID\">\n      <input id=\"ghisPassword\" class=\"ghis-login-input\" type=\"password\" autocomplete=\"current-password\" placeholder=\"Password\"\n             onkeydown=\"if(event.key==='Enter') ghisConnect()\">\n      <div class=\"ghis-setup-sub\" style=\"margin:2px 0 12px\">Your password is used only to sign in and is never stored on our servers. If your session times out, just sign in again.</div>\n      <button class=\"ghis-connect-btn\" onclick=\"ghisConnect()\">Sign in</button>\n      <div id=\"ghisSetupError\" class=\"ghis-setup-error\"></div>\n    </div>\n  </div>\n\n  <div id=\"ghisWard\" class=\"ghis-body\" style=\"display:none;\">\n    <div id=\"ghisAddTarget\" style=\"display:none;align-items:center;box-sizing:border-box;margin:0 0 10px;padding:8px 10px;border:1px solid var(--line,#e4eae8);border-radius:10px;background:var(--paper,#f6f8f6)\"></div>\n    <div class=\"ghis-filter-row\">\n      <input id=\"ghisSearchPt\" class=\"ghis-filter-input\" placeholder=\"Search patient ID or name…\" oninput=\"ghisApplyFilters()\" />\n      <button class=\"ghis-logout-btn\" onclick=\"ghisDisconnect()\" title=\"Disconnect\">⏻</button>\n    </div>\n    <div class=\"ghis-filter-row2\">\n      <select id=\"ghisFBranch\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by branch/department\"><option value=\"\">All branches</option></select>\n      <select id=\"ghisFDoctor\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by treating doctor\"><option value=\"\">All doctors</option></select>\n      <select id=\"ghisFGender\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by gender\"><option value=\"\">All genders</option><option value=\"m\">Male</option><option value=\"f\">Female</option></select>\n      <select id=\"ghisFSort\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Sort patients\"><option value=\"\">Default order</option><option value=\"name\">Name A–Z</option><option value=\"branch\">Branch</option><option value=\"doctor\">Doctor</option><option value=\"bed\">Bed</option></select>\n    </div>\n    <div id=\"ghisCount\" class=\"ghis-count\"></div>\n\n    <div id=\"ghisPatientList\" class=\"ghis-pt-list\"></div>\n\n    <div id=\"ghisLabDrawer\" class=\"ghis-lab-drawer\" style=\"display:none;\">\n      <div class=\"ghis-lab-header\">\n        <button class=\"ghis-back-sm\" onclick=\"closeLabDrawer()\">← Back</button>\n        <div class=\"ghis-lab-title\" id=\"ghisLabTitle\"></div>\n      </div>\n      <div id=\"ghisLabBody\" class=\"ghis-lab-body\"></div>\n    </div>\n  </div>\n</div>";

  function inject() {
    if (document.getElementById('ghisPanel')) return;
    var style = document.createElement('style');
    style.setAttribute('data-ghis', '1');
    style.textContent = CSS;
    document.head.appendChild(style);

    var holder = document.createElement('div');
    holder.innerHTML = PANEL_HTML;
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

    var btn = document.createElement('button');
    btn.id = 'ghisBtn';
    btn.className = 'ghis-ward-fab';
    btn.title = 'GHIS Ward Sync';
    btn.innerHTML = wIco("hospital") + ' Ward';
    btn.addEventListener('click', function () { window.openGHIS(); });
    var sel = window.GHIS_BUTTON_SELECTOR;
    var host = sel ? document.querySelector(sel) : null;
    (host || document.body).appendChild(btn);

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
      var _addedPids = {};   // ward patientIds ticked "add to dashboard" this session (checkbox state)
      var _connected = false;
    
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
      function setToken(t) { try { t ? localStorage.setItem(tokenKey(), t) : localStorage.removeItem(tokenKey()); } catch (e) {} }
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
      // fetch wrapper that attaches the bearer token; on 401 it tries a SILENT refresh ONCE and
      // retries, only falling back to the login screen if that fails.
      function authFetch(path, opts, _retried) {
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
        if (name === 'hospital') { try { ghisRenderConnectHospitals(); } catch (e) {} }
      }
      window.showGhisScreen = showScreen;
      // Hospital picker actions.
      window.ghisSelectHospital = function (id) { if (id === 'gimsr') showScreen('setup'); };
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
          if (!box || !ts || !ts.length) return;
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
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
        _patientId: null,
        // The patient currently opened in the ward drawer, used by the Drug-Interactions
        // "Fetch from Ward Sync" import to know whose medication history to pull. Kept
        // deliberately minimal (id + first name only) — never MRN/UHID/bed/clinician.
        _selectedPatient: null,
        // Public getter for the currently-selected Ward-Sync patient. Returns null when
        // none is selected (import stays disabled). name is display-only, id is required.
        getSelectedPatient: function() { return GHIS._selectedPatient ? { patientId: GHIS._selectedPatient.patientId, name: GHIS._selectedPatient.name } : null; },
        // Bearer token for authorized GHIS proxy calls (used by GHISMEDS medication fetch).
        getToken: function() { return getToken(); },
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
        // Proxy base so GHISMEDS uses the SAME endpoint origin as the ward panel.
        getProxyBase: function() { return PROXY; },
        // Clear the selection + any GHIS import draft (called on disconnect / patient-switch).
        clearSelectedPatient: function() {
          GHIS._selectedPatient = null; GHIS._patientId = null;
          try { if (window.GHISMEDS && window.GHISMEDS.clearDraft) window.GHISMEDS.clearDraft(); } catch (e) {}
        },
        // Deep-link target from a background lab-watch push (/?ghisPatient=<id>): open Ward Sync,
        // wait for the ward list to load, then open that patient's lab drawer. If the patient
        // isn't in the current ward list (e.g. discharged), prefill the search with the id.
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
          GHIS._selectedPatient = { patientId: patientId, name: name };
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
            Promise.resolve(ICU.addWardPatientToRoster({ patient: dem, patientId: patientId, source: 'Ward Sync', labs: labs })).then(function () {
              _addedPids[patientId] = true;
              try { if (window.toast) toast('Added ' + (dem.name || 'patient') + ' to ' + (ICU.currentUnitLabel ? ICU.currentUnitLabel() : 'dashboard')); } catch (e) {}
            }, function () { delete _addedPids[patientId]; try { if (window.toast) toast('Couldn’t add — open the dashboard and choose a unit first.'); } catch (e) {} if (typeof ghisApplyFilters === 'function') ghisApplyFilters(); });
          });
        },
        // Checkbox handler (list). Add-only: unticking reverts (re-tick to re-add) — removal is a
        // dashboard action. `el` is the checkbox, or null when called from a header button.
        toggleAdd: function(episodeId, patientId, name, el) {
          if (el && el.type === 'checkbox' && !el.checked) { el.checked = true; return; }
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
        onPatient: function(episodeId, patientId, name) {
          if (_connectCtx) {   // Connect-hospital roster: tap -> pull this patient from the FHIR EMR into ICU
            try { var pnl = document.getElementById('ghisPanel'); if (pnl) pnl.classList.remove('open'); } catch (e) {}
            if (window.SMD_openConnectPatient) window.SMD_openConnectPatient(_connectCtx.tid, patientId, _connectCtx.cid, name);
            return;
          }
          if (GHIS._importMode) { GHIS._importMode = false; GHIS.importPatientReports(patientId, name); }
          else { GHIS.openLab(episodeId, patientId, name); }
        },
        // Entry point for Dx My Patient -> Import Patient. Opens the ward picker in
        // import mode; selecting a patient assembles their reports and hands them to DX.
        startImport: function() { GHIS._importMode = true; try { window.openGHIS(); } catch (e) {} },
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
        _connectCtx = null;   // a GHIS roster load clears any Connect-hospital context
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
        var cnt = document.getElementById('ghisCount');
        if (cnt) cnt.textContent = _patients.length
          ? (list.length + (list.length === 1 ? ' patient' : ' patients') + (list.length !== _patients.length ? ' · of ' + _patients.length : ''))
          : '';
      };
      // legacy alias — older inline handlers / callers still reference this name
      window.ghisFilterLocal = window.ghisApplyFilters;

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

      // Background lab-watch notification deep link: /?ghisPatient=<id> → open that patient.
      (function () {
        try {
          var m = (location.search || "").match(/[?&]ghisPatient=([^&]+)/);
          if (m && m[1]) { var pid = decodeURIComponent(m[1]); setTimeout(function () { try { window.GHIS && GHIS.openPatientById(pid); } catch (e) {} }, 500); }
        } catch (e) {}
      })();

    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
