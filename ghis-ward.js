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

  var CSS = "#ghisPanel {\n  position: fixed; inset: 0; z-index: 18000;\n  background: var(--paper, #ffffff); display: flex; flex-direction: column;\n  transform: translateX(100%);\n  transition: transform 0.3s cubic-bezier(.4,0,.2,1);\n}\n#ghisPanel.open { transform: translateX(0); }\n.ghis-header {\n  display: flex; align-items: center; gap: 10px;\n  padding: calc(14px + env(safe-area-inset-top)) 16px 14px; border-bottom: 1px solid var(--line, #e2e8f0);\n  background: var(--panel, #f8fafc); flex-shrink: 0;\n}\n.ghis-back { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--teal, #14b8a6); padding: 4px 8px; }\n.ghis-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--ink, #0f172a); display: flex; align-items: center; gap: 8px; }\n.ghis-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }\n.ghis-dot-off { background: #aaa; }\n.ghis-dot-on { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }\n.ghis-refresh-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 16px; color: var(--teal, #14b8a6); padding: 4px 10px; }\n.ghis-body { flex: 1; overflow-y: auto; padding: 16px; }\n.ghis-setup-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 14px; padding: 20px; max-width: 480px; margin: 20px auto; }\n.ghis-setup-title { font-size: 15px; font-weight: 700; color: var(--ink, #0f172a); margin-bottom: 14px; }\n.ghis-setup-sub { font-size: 12px; color: var(--slate, #64748b); margin: -8px 0 14px; }\n.ghis-login-input { width: 100%; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 14px; padding: 11px; box-sizing: border-box; margin-bottom: 10px; }\n.ghis-login-input:focus { outline: none; border-color: var(--teal, #14b8a6); }\n.ghis-remember { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--slate, #64748b); margin-bottom: 4px; cursor: pointer; }\n.ghis-remember input { width: 15px; height: 15px; }\n.ghis-setup-steps { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }\n.ghis-step { font-size: 13px; color: var(--slate, #64748b); display: flex; gap: 10px; align-items: flex-start; }\n.ghis-step-num { background: var(--teal, #14b8a6); color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }\n.ghis-step code { background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 5px; padding: 1px 5px; font-size: 12px; color: var(--teal, #14b8a6); }\n.ghis-cookie-input { width: 100%; min-height: 80px; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 11px; padding: 8px; box-sizing: border-box; resize: vertical; font-family: monospace; }\n.ghis-connect-btn { margin-top: 10px; width: 100%; background: var(--teal, #14b8a6); color: #fff; border: none; border-radius: 10px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }\n.ghis-connect-btn:hover { opacity: 0.88; }\n.ghis-setup-error { color: #ef4444; font-size: 12px; margin-top: 8px; min-height: 16px; }\n.ghis-logout-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--slate, #64748b); padding: 6px 10px; }\n.ghis-filter-row { display: flex; gap: 8px; margin-bottom: 8px; }\n.ghis-filter-input { flex: 1; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 12px; font-size: 13px; }\n.ghis-filter-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }\n@media (min-width: 560px) { .ghis-filter-row2 { grid-template-columns: 1fr 1fr 1fr 1fr; } }\n.ghis-filter-sel { min-width: 0; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 10px; font-size: 12.5px; cursor: pointer; }\n.ghis-filter-sel:focus { outline: none; border-color: var(--teal, #14b8a6); }\n.ghis-count { font-size: 12px; color: var(--slate, #64748b); margin: 0 2px 10px; font-weight: 600; }\n.ghis-pt-list { display: flex; flex-direction: column; gap: 8px; }\n.ghis-pt-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: border-color 0.15s; }\n.ghis-pt-card:hover { border-color: var(--teal, #14b8a6); }\n.ghis-pt-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }\n.ghis-pt-name { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-pt-status { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; white-space: nowrap; }\n.ghis-status-occupied { background: #dcfce7; color: #16a34a; }\n.ghis-status-bed { background: #fef9c3; color: #b45309; }\n.ghis-status-discharge { background: #fee2e2; color: #dc2626; }\n.ghis-status-other { background: var(--paper, #ffffff); color: var(--slate, #64748b); }\n.ghis-pt-meta { font-size: 12px; color: var(--slate, #64748b); margin-top: 4px; }\n.ghis-pt-dept { font-size: 12px; color: var(--teal, #14b8a6); font-weight: 600; margin-top: 2px; }\n.ghis-loading { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n.ghis-empty { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n/* Lab drawer */\n#ghisWard { position: relative; }\n.ghis-lab-drawer { position: absolute; inset: 0; background: var(--paper, #ffffff); overflow-y: auto; z-index: 2; }\n.ghis-lab-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e2e8f0); background: var(--panel, #f8fafc); position: sticky; top: 0; }\n.ghis-back-sm { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--teal, #14b8a6); font-weight: 700; padding: 4px 8px; }\n.ghis-lab-title { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-lab-body { padding: 14px 16px; }\n.ghis-lab-group { margin-bottom: 14px; }\n.ghis-lab-group-name { font-size: 12px; font-weight: 700; color: var(--teal, #14b8a6); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }\n.ghis-lab-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line, #e2e8f0); font-size: 13px; }\n.ghis-lab-test { color: var(--ink, #0f172a); }\n.ghis-lab-val { font-weight: 700; }\n.ghis-lab-val.abnormal { color: #ef4444; }\n.ghis-lab-date { font-size: 11px; color: var(--slate, #64748b); }\n.ghis-lab-empty { color: var(--slate, #64748b); font-size: 13px; text-align: center; padding: 20px; }\n.ghis-lab-count { font-size: 12px; color: var(--slate, #64748b); margin-bottom: 10px; }\n.ghis-lab-order { border: 1px solid var(--line, #e2e8f0); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; transition: background .12s; }\n.ghis-lab-order:hover { background: rgba(20,184,166,0.05); }\n.ghis-lab-order.open { border-color: var(--teal, #14b8a6); background: rgba(20,184,166,0.04); }\n.ghis-lab-order-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.ghis-lab-order-name { font-weight: 600; font-size: 13px; color: var(--ink, #0f172a); }\n.ghis-lab-order-dept { font-size: 11px; color: var(--slate, #64748b); white-space: nowrap; }\n.ghis-lab-detail { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--line, #e2e8f0); }\n.ghis-lab-detail-empty { color: var(--slate, #64748b); font-size: 12px; padding: 6px 0; }\n.ghis-lab-abx { font-size: 12px; color: var(--ink, #0f172a); background: rgba(20,184,166,0.06); border-radius: 6px; padding: 6px 8px; margin: 4px 0 8px; white-space: pre-wrap; }\n.ghis-lab-section-title { font-size: 13px; font-weight: 700; color: var(--ink, #0f172a); margin: 4px 0 10px; }\n.ghis-rad-order { border-color: rgba(99,102,241,0.35); }\n.ghis-rad-order:hover { background: rgba(99,102,241,0.05); }\n.ghis-rad-order.open { border-color: #6366f1; background: rgba(99,102,241,0.05); }\n.ghis-rad-meta { font-size: 11px; color: var(--slate, #64748b); margin-bottom: 6px; }\n.ghis-rad-report { font-size: 13px; line-height: 1.5; color: var(--ink, #0f172a); white-space: pre-wrap; }\n.ghis-rad-divider { height: 1px; background: var(--line, #e2e8f0); margin: 14px 0; }\n/* dark mode overrides */\nbody.dark .ghis-status-occupied { background: #14532d; color: #86efac; }\nbody.dark .ghis-status-bed { background: #451a03; color: #fcd34d; }\nbody.dark .ghis-status-discharge { background: #450a0a; color: #fca5a5; }\n\n.ghis-ward-fab {\n  position: fixed; bottom: calc(20px + env(safe-area-inset-bottom)); right: 20px; z-index: 17000;\n  display: inline-flex; align-items: center; gap: 6px;\n  padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;\n  background: var(--teal, #14b8a6); color: #fff; font-size: 14px; font-weight: 600;\n  box-shadow: 0 4px 14px rgba(0,0,0,0.18); font-family: inherit;\n}\n.ghis-ward-fab:hover { filter: brightness(1.05); }\n";
  var PANEL_HTML = "<div id=\"ghisPanel\">\n  <div class=\"ghis-header\">\n    <button class=\"ghis-back\" onclick=\"closeGHIS()\">←</button>\n    <div class=\"ghis-title\">🏥 Ward Sync <span id=\"ghisConnDot\" class=\"ghis-dot ghis-dot-off\"></span></div>\n    <button class=\"ghis-refresh-btn\" id=\"ghisRefreshBtn\" onclick=\"ghisRefresh()\" title=\"Refresh\">↻</button>\n  </div>\n\n  <div id=\"ghisSetup\" class=\"ghis-body\">\n    <div class=\"ghis-setup-card\">\n      <div class=\"ghis-setup-title\">Sign in to GHIS</div>\n      <div class=\"ghis-setup-sub\">Use your own GITAM HIS login.</div>\n      <input id=\"ghisUserId\" class=\"ghis-login-input\" type=\"text\" autocomplete=\"username\" placeholder=\"GHIS User ID\">\n      <input id=\"ghisPassword\" class=\"ghis-login-input\" type=\"password\" autocomplete=\"current-password\" placeholder=\"Password\"\n             onkeydown=\"if(event.key==='Enter') ghisConnect()\">\n      <div class=\"ghis-setup-sub\" style=\"margin:2px 0 12px\">Your password is used only to sign in and is never stored on our servers. If your session times out, just sign in again.</div>\n      <button class=\"ghis-connect-btn\" onclick=\"ghisConnect()\">Sign in</button>\n      <div id=\"ghisSetupError\" class=\"ghis-setup-error\"></div>\n    </div>\n  </div>\n\n  <div id=\"ghisWard\" class=\"ghis-body\" style=\"display:none;\">\n    <div class=\"ghis-filter-row\">\n      <input id=\"ghisSearchPt\" class=\"ghis-filter-input\" placeholder=\"Search patient ID or name…\" oninput=\"ghisApplyFilters()\" />\n      <button class=\"ghis-logout-btn\" onclick=\"ghisDisconnect()\" title=\"Disconnect\">⏻</button>\n    </div>\n    <div class=\"ghis-filter-row2\">\n      <select id=\"ghisFBranch\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by branch/department\"><option value=\"\">All branches</option></select>\n      <select id=\"ghisFDoctor\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by treating doctor\"><option value=\"\">All doctors</option></select>\n      <select id=\"ghisFGender\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Filter by gender\"><option value=\"\">All genders</option><option value=\"m\">Male</option><option value=\"f\">Female</option></select>\n      <select id=\"ghisFSort\" class=\"ghis-filter-sel\" onchange=\"ghisApplyFilters()\" title=\"Sort patients\"><option value=\"\">Default order</option><option value=\"name\">Name A–Z</option><option value=\"branch\">Branch</option><option value=\"doctor\">Doctor</option><option value=\"bed\">Bed</option></select>\n    </div>\n    <div id=\"ghisCount\" class=\"ghis-count\"></div>\n\n    <div id=\"ghisPatientList\" class=\"ghis-pt-list\"></div>\n\n    <div id=\"ghisLabDrawer\" class=\"ghis-lab-drawer\" style=\"display:none;\">\n      <div class=\"ghis-lab-header\">\n        <button class=\"ghis-back-sm\" onclick=\"closeLabDrawer()\">← Back</button>\n        <div class=\"ghis-lab-title\" id=\"ghisLabTitle\"></div>\n      </div>\n      <div id=\"ghisLabBody\" class=\"ghis-lab-body\"></div>\n    </div>\n  </div>\n</div>";

  function inject() {
    if (document.getElementById('ghisPanel')) return;
    var style = document.createElement('style');
    style.setAttribute('data-ghis', '1');
    style.textContent = CSS;
    document.head.appendChild(style);

    var holder = document.createElement('div');
    holder.innerHTML = PANEL_HTML;
    while (holder.firstChild) document.body.appendChild(holder.firstChild);

    var btn = document.createElement('button');
    btn.id = 'ghisBtn';
    btn.className = 'ghis-ward-fab';
    btn.title = 'GHIS Ward Sync';
    btn.textContent = '🏥 Ward';
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
      // fetch wrapper that attaches the bearer token; surfaces 401 as login_required
      function authFetch(path, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        var t = getToken();
        if (t) opts.headers['Authorization'] = 'Bearer ' + t;
        return fetch(PROXY + path, opts).then(function (r) {
          if (r.status === 401) { setToken(''); _connected = false; dot(false); showScreen('setup'); throw new Error('login_required'); }
          return r.json();
        });
      }
    
      function dot(on) {
        var d = document.getElementById('ghisConnDot');
        if (!d) return;
        d.className = 'ghis-dot ' + (on ? 'ghis-dot-on' : 'ghis-dot-off');
      }
    
      function showScreen(name) {
        document.getElementById('ghisSetup').style.display = name === 'setup' ? '' : 'none';
        document.getElementById('ghisWard').style.display  = name === 'ward'  ? '' : 'none';
      }
    
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
    
      function renderPatients(list) {
        var el = document.getElementById('ghisPatientList');
        if (!el) return;
        if (!list || list.length === 0) {
          el.innerHTML = '<div class="ghis-empty">No patients found. Try searching with no filters.</div>';
          return;
        }
        el.innerHTML = list.map(function(p, i) {
          var age = p.dob ? p.dob : '';
          return '<div class="ghis-pt-card" onclick="GHIS.onPatient(\'' + jsq(p.episodeId) + '\',\'' + jsq(p.patientId) + '\',\'' + jsq(p.patientFirstName) + '\')">' +
            '<div class="ghis-pt-top">' +
              '<div>' +
                '<div class="ghis-pt-name">' + esc(p.patientFirstName) + ' <span style="font-weight:400;font-size:12px;color:var(--slate)">· ' + esc(p.patientId) + '</span></div>' +
                '<div class="ghis-pt-meta">' + esc(age) + (p.gender ? ' · ' + esc(p.gender) : '') + (p.bedName ? ' · Bed ' + esc(p.bedName) : '') + '</div>' +
              '</div>' +
              statusBadge(p.queueStatus) +
            '</div>' +
            '<div class="ghis-pt-dept">' + esc(p.deptDescription || '') + (p.employeeFirstName ? ' · Dr. ' + esc(p.employeeFirstName) : '') + '</div>' +
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
          html += '<div class="ghis-lab-row">' +
            '<div class="ghis-lab-test">' + esc(t.test || '') + (t.method ? ' <span style="color:var(--slate);font-weight:400;font-size:11px">(' + esc(t.method) + ')</span>' : '') + '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">' +
              '<div class="ghis-lab-val' + cls + '">' + esc(t.result || '—') + (t.units ? ' <span style="font-weight:400;color:var(--slate)">' + esc(t.units) + '</span>' : '') + '</div>' +
              (t.range ? '<div class="ghis-lab-date">ref ' + esc(t.range) + '</div>' : '') +
            '</div>' +
          '</div>';
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
        // Proxy base so GHISMEDS uses the SAME endpoint origin as the ward panel.
        getProxyBase: function() { return PROXY; },
        // Clear the selection + any GHIS import draft (called on disconnect / patient-switch).
        clearSelectedPatient: function() {
          GHIS._selectedPatient = null; GHIS._patientId = null;
          try { if (window.GHISMEDS && window.GHISMEDS.clearDraft) window.GHISMEDS.clearDraft(); } catch (e) {}
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
          body.innerHTML =
            (window.ICU ? '<button class="ghis-connect-btn" style="margin:0 0 12px;background:#0F766E" onclick="GHIS.loadIntoICU(\'' + jsq(patientId) + '\')">🏥 Load patient into ICU dashboard</button>' : '') +
            (lwOk ? '<button class="ghis-connect-btn" style="margin:0 0 12px;background:#0d5c54" onclick="GHIS.watchLabs(\'' + jsq(patientId) + '\')">🔔 Lab Watch — alert me on new labs</button>' : '') +
            '<div id="ghisRadSection"></div><div id="ghisLabSection"><div class="ghis-loading">Loading lab orders…</div></div>';
          drawer.style.display = '';
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
        loadIntoICU: function(patientId, after) {
          if (!window.ICU || !ICU.ingestFromWard) { alert('ICU dashboard not loaded.'); return; }
          var p = null, list = (typeof _patients !== 'undefined' && _patients) || [];
          for (var i = 0; i < list.length; i++) { if (String(list[i].patientId) === String(patientId)) { p = list[i]; break; } }
          var dem = { hospital: 'GHIS Ward', status: 'ward' };
          if (p) {
            if (p.patientFirstName) dem.name = p.patientFirstName;
            if (p.gender) dem.sex = p.gender;
            if (p.bedName) dem.bed = p.bedName;
            if (p.deptDescription) dem.diagnosis = p.deptDescription;
            var a = parseInt(p.dob, 10); if (!isNaN(a) && a > 0 && a < 130) dem.age = a;
          }
          var pnl = document.getElementById('ghisPanel');
          var body = pnl ? pnl.querySelector('.ghis-body') : null;
          if (body) body.innerHTML = '<div class="ghis-loading">Syncing labs into ICU dashboard…</div>';
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
            try { if (pnl) pnl.classList.remove('open'); } catch (e) {}
            ICU.open();
            try { if (typeof after === 'function') after(); } catch (e) {}
            try { if (window.toast) { var np = (res && (res.points != null ? res.points : res.mappedLabs)) || 0, nr = (res && res.reports) || 0; toast('ICU synced — ' + np + ' value' + (np === 1 ? '' : 's') + (nr > 1 ? ' across ' + nr + ' reports' : '') + ' from Ward Sync' + (res && res.conflicts ? ' · ' + res.conflicts + ' to review' : '')); } } catch (e) {}
            // Radiology (TEXT only) streams in ASYNCHRONOUSLY when the feature is on. The ICU state
            // subscription repaints the Imaging tab when records arrive; a slow/failed/hung fetch
            // can never stall the dashboard (which already opened above).
            if (ICU.ingestWardImaging && (!ICU.imagingOn || ICU.imagingOn())) {
              GHIS.fetchImaging(patientId).then(function (records) {
                var ir = ICU.ingestWardImaging({ patientId: patientId, source: 'Ward Sync', imaging: records });
                try { if (window.toast && ir && ir.added) toast(ir.added + ' imaging report' + (ir.added === 1 ? '' : 's') + ' imported'); } catch (e) {}
              }).catch(function () {});
            }
          }).catch(function (e) { if (body) body.innerHTML = '<div class="ghis-lab-empty">Couldn’t load labs right now. Please try again.</div>'; });
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
            DX.importPatient({ patientName: name || (pObj && pObj.patientFirstName) || '', age: (!isNaN(age) && age > 0 && age < 130) ? age : null, sex: pObj && pObj.gender, labs: labs, radiology: radiology, culture: culture });
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
              var html = '<div class="ghis-lab-section-title">🧪 Labs · ' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + '</div>';
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
              var html = '<div class="ghis-lab-section-title">🩻 Imaging · ' + orders.length + ' stud' + (orders.length === 1 ? 'y' : 'ies') + '</div>';
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
        // Already have a saved login? Verify the token and go straight to the ward.
        if (!getToken()) { showScreen('setup'); return; }
        fetch(PROXY + '/status', { headers: { 'Authorization': 'Bearer ' + getToken() } })
          .then(function(r) { return r.json(); })
          .then(function(s) {
            if (s.connected) { _connected = true; dot(true); showScreen('ward'); ghisLoadPatients(); }
            else { setToken(''); showScreen('setup'); }
          })
          .catch(function() { showScreen('setup'); });
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
        fetch(PROXY + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userId, password: password })
        })
        .then(function(r) { return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
        .then(function(res) {
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
        if (_connected) ghisLoadPatients();
      };
    
      function ghisLoadPatients() {
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
          _connected = false; _patients = []; dot(false);
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

    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
