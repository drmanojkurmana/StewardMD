/* StewardMD — GHIS Ward Sync (drop-in module)
 * Auto-injects the 🏥 Ward button, panel, lab drawer and radiology reports.
 * Requires the local proxy running:  node ghis-proxy.js   (listens on :3456)
 *
 * Use:  <script src="ghis-ward.js"></script>   (place before </body>)
 * Optional: set  window.GHIS_BUTTON_SELECTOR = '#myHeader'  BEFORE this script
 *           to mount the button inside your own header instead of floating.
 * Generated from StewardMD v4 — do not edit by hand; regenerate from source.
 */
(function () {
  if (window.__ghisWardLoaded) return;
  window.__ghisWardLoaded = true;

  var CSS = "#ghisPanel {\n  position: fixed; inset: 0; z-index: 18000;\n  background: var(--paper, #ffffff); display: flex; flex-direction: column;\n  transform: translateX(100%);\n  transition: transform 0.3s cubic-bezier(.4,0,.2,1);\n}\n#ghisPanel.open { transform: translateX(0); }\n.ghis-header {\n  display: flex; align-items: center; gap: 10px;\n  padding: 14px 16px; border-bottom: 1px solid var(--line, #e2e8f0);\n  background: var(--panel, #f8fafc); flex-shrink: 0;\n}\n.ghis-back { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--teal, #14b8a6); padding: 4px 8px; }\n.ghis-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--ink, #0f172a); display: flex; align-items: center; gap: 8px; }\n.ghis-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }\n.ghis-dot-off { background: #aaa; }\n.ghis-dot-on { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }\n.ghis-refresh-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 16px; color: var(--teal, #14b8a6); padding: 4px 10px; }\n.ghis-body { flex: 1; overflow-y: auto; padding: 16px; }\n.ghis-setup-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 14px; padding: 20px; max-width: 480px; margin: 20px auto; }\n.ghis-setup-title { font-size: 15px; font-weight: 700; color: var(--ink, #0f172a); margin-bottom: 14px; }\n.ghis-setup-steps { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }\n.ghis-step { font-size: 13px; color: var(--slate, #64748b); display: flex; gap: 10px; align-items: flex-start; }\n.ghis-step-num { background: var(--teal, #14b8a6); color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }\n.ghis-step code { background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 5px; padding: 1px 5px; font-size: 12px; color: var(--teal, #14b8a6); }\n.ghis-cookie-input { width: 100%; min-height: 80px; background: var(--paper, #ffffff); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); font-size: 11px; padding: 8px; box-sizing: border-box; resize: vertical; font-family: monospace; }\n.ghis-connect-btn { margin-top: 10px; width: 100%; background: var(--teal, #14b8a6); color: #fff; border: none; border-radius: 10px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }\n.ghis-connect-btn:hover { opacity: 0.88; }\n.ghis-setup-error { color: #ef4444; font-size: 12px; margin-top: 8px; min-height: 16px; }\n.ghis-logout-btn { background: none; border: 1px solid var(--line, #e2e8f0); border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--slate, #64748b); padding: 6px 10px; }\n.ghis-filter-row { display: flex; gap: 8px; margin-bottom: 12px; }\n.ghis-filter-input { flex: 1; background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 8px; color: var(--ink, #0f172a); padding: 8px 12px; font-size: 13px; }\n.ghis-pt-list { display: flex; flex-direction: column; gap: 8px; }\n.ghis-pt-card { background: var(--panel, #f8fafc); border: 1px solid var(--line, #e2e8f0); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: border-color 0.15s; }\n.ghis-pt-card:hover { border-color: var(--teal, #14b8a6); }\n.ghis-pt-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }\n.ghis-pt-name { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-pt-status { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; white-space: nowrap; }\n.ghis-status-occupied { background: #dcfce7; color: #16a34a; }\n.ghis-status-bed { background: #fef9c3; color: #b45309; }\n.ghis-status-discharge { background: #fee2e2; color: #dc2626; }\n.ghis-status-other { background: var(--paper, #ffffff); color: var(--slate, #64748b); }\n.ghis-pt-meta { font-size: 12px; color: var(--slate, #64748b); margin-top: 4px; }\n.ghis-pt-dept { font-size: 12px; color: var(--teal, #14b8a6); font-weight: 600; margin-top: 2px; }\n.ghis-loading { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n.ghis-empty { text-align: center; color: var(--slate, #64748b); font-size: 13px; padding: 30px; }\n/* Lab drawer */\n.ghis-lab-drawer { position: absolute; inset: 56px 0 0; background: var(--paper, #ffffff); overflow-y: auto; z-index: 2; }\n.ghis-lab-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e2e8f0); background: var(--panel, #f8fafc); position: sticky; top: 0; }\n.ghis-back-sm { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--teal, #14b8a6); font-weight: 700; padding: 4px 8px; }\n.ghis-lab-title { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }\n.ghis-lab-body { padding: 14px 16px; }\n.ghis-lab-group { margin-bottom: 14px; }\n.ghis-lab-group-name { font-size: 12px; font-weight: 700; color: var(--teal, #14b8a6); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }\n.ghis-lab-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line, #e2e8f0); font-size: 13px; }\n.ghis-lab-test { color: var(--ink, #0f172a); }\n.ghis-lab-val { font-weight: 700; }\n.ghis-lab-val.abnormal { color: #ef4444; }\n.ghis-lab-date { font-size: 11px; color: var(--slate, #64748b); }\n.ghis-lab-empty { color: var(--slate, #64748b); font-size: 13px; text-align: center; padding: 20px; }\n.ghis-lab-count { font-size: 12px; color: var(--slate, #64748b); margin-bottom: 10px; }\n.ghis-lab-order { border: 1px solid var(--line, #e2e8f0); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; cursor: pointer; transition: background .12s; }\n.ghis-lab-order:hover { background: rgba(20,184,166,0.05); }\n.ghis-lab-order.open { border-color: var(--teal, #14b8a6); background: rgba(20,184,166,0.04); }\n.ghis-lab-order-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.ghis-lab-order-name { font-weight: 600; font-size: 13px; color: var(--ink, #0f172a); }\n.ghis-lab-order-dept { font-size: 11px; color: var(--slate, #64748b); white-space: nowrap; }\n.ghis-lab-detail { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--line, #e2e8f0); }\n.ghis-lab-detail-empty { color: var(--slate, #64748b); font-size: 12px; padding: 6px 0; }\n.ghis-lab-abx { font-size: 12px; color: var(--ink, #0f172a); background: rgba(20,184,166,0.06); border-radius: 6px; padding: 6px 8px; margin: 4px 0 8px; white-space: pre-wrap; }\n.ghis-lab-section-title { font-size: 13px; font-weight: 700; color: var(--ink, #0f172a); margin: 4px 0 10px; }\n.ghis-rad-order { border-color: rgba(99,102,241,0.35); }\n.ghis-rad-order:hover { background: rgba(99,102,241,0.05); }\n.ghis-rad-order.open { border-color: #6366f1; background: rgba(99,102,241,0.05); }\n.ghis-rad-meta { font-size: 11px; color: var(--slate, #64748b); margin-bottom: 6px; }\n.ghis-rad-report { font-size: 13px; line-height: 1.5; color: var(--ink, #0f172a); white-space: pre-wrap; }\n.ghis-rad-divider { height: 1px; background: var(--line, #e2e8f0); margin: 14px 0; }\n/* dark mode overrides */\nbody.dark .ghis-status-occupied { background: #14532d; color: #86efac; }\nbody.dark .ghis-status-bed { background: #451a03; color: #fcd34d; }\nbody.dark .ghis-status-discharge { background: #450a0a; color: #fca5a5; }\n\n.ghis-ward-fab {\n  position: fixed; bottom: 20px; right: 20px; z-index: 17000;\n  display: inline-flex; align-items: center; gap: 6px;\n  padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;\n  background: var(--teal, #14b8a6); color: #fff; font-size: 14px; font-weight: 600;\n  box-shadow: 0 4px 14px rgba(0,0,0,0.18); font-family: inherit;\n}\n.ghis-ward-fab:hover { filter: brightness(1.05); }\n";
  var PANEL_HTML = "<div id=\"ghisPanel\">\n  <div class=\"ghis-header\">\n    <button class=\"ghis-back\" onclick=\"closeGHIS()\">←</button>\n    <div class=\"ghis-title\">🏥 Ward Sync <span id=\"ghisConnDot\" class=\"ghis-dot ghis-dot-off\"></span></div>\n    <button class=\"ghis-refresh-btn\" id=\"ghisRefreshBtn\" onclick=\"ghisRefresh()\" title=\"Refresh\">↻</button>\n  </div>\n\n  <!-- Setup screen -->\n  <div id=\"ghisSetup\" class=\"ghis-body\">\n    <div class=\"ghis-setup-card\">\n      <div class=\"ghis-setup-title\">Connect to GHIS</div>\n      <div class=\"ghis-setup-steps\">\n        <div class=\"ghis-step\"><span class=\"ghis-step-num\">1</span> Make sure the proxy is running:<br><code>node ghis-proxy.js</code></div>\n        <div class=\"ghis-step\"><span class=\"ghis-step-num\">2</span> Log in to GHIS in Chrome</div>\n        <div class=\"ghis-step\"><span class=\"ghis-step-num\">3</span> DevTools → Network tab → click any request → Headers → copy the <strong>Cookie:</strong> value</div>\n        <div class=\"ghis-step\"><span class=\"ghis-step-num\">4</span> Paste below and tap Connect</div>\n      </div>\n      <textarea id=\"ghisCookieInput\" class=\"ghis-cookie-input\" placeholder=\"Paste Cookie header value here...\"></textarea>\n      <button class=\"ghis-connect-btn\" onclick=\"ghisConnect()\">Connect</button>\n      <div id=\"ghisSetupError\" class=\"ghis-setup-error\"></div>\n    </div>\n  </div>\n\n  <!-- Ward screen -->\n  <div id=\"ghisWard\" class=\"ghis-body\" style=\"display:none;\">\n    <div class=\"ghis-filter-row\">\n      <input id=\"ghisSearchPt\" class=\"ghis-filter-input\" placeholder=\"Search patient ID or name…\" oninput=\"ghisFilterLocal()\" />\n      <button class=\"ghis-logout-btn\" onclick=\"ghisDisconnect()\" title=\"Disconnect\">⏻</button>\n    </div>\n\n    <div id=\"ghisPatientList\" class=\"ghis-pt-list\"></div>\n\n    <!-- Lab drawer -->\n    <div id=\"ghisLabDrawer\" class=\"ghis-lab-drawer\" style=\"display:none;\">\n      <div class=\"ghis-lab-header\">\n        <button class=\"ghis-back-sm\" onclick=\"closeLabDrawer()\">← Back</button>\n        <div class=\"ghis-lab-title\" id=\"ghisLabTitle\"></div>\n      </div>\n      <div id=\"ghisLabBody\" class=\"ghis-lab-body\"></div>\n    </div>\n  </div>\n</div>";

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
      var PROXY = 'http://localhost:3456';
      var _patients = [];
      var _connected = false;
    
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
    
      function renderPatients(list) {
        var el = document.getElementById('ghisPatientList');
        if (!el) return;
        if (!list || list.length === 0) {
          el.innerHTML = '<div class="ghis-empty">No patients found. Try searching with no filters.</div>';
          return;
        }
        el.innerHTML = list.map(function(p, i) {
          var age = p.dob ? p.dob : '';
          return '<div class="ghis-pt-card" onclick="GHIS.openLab(\'' + esc(p.episodeId) + '\',\'' + esc(p.patientId) + '\',\'' + esc(p.patientFirstName) + '\')">' +
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
        openLab: function(episodeId, patientId, name) {
          var drawer = document.getElementById('ghisLabDrawer');
          var title  = document.getElementById('ghisLabTitle');
          var body   = document.getElementById('ghisLabBody');
          if (!drawer) return;
          GHIS._patientId = patientId;
          title.textContent = name + ' (' + patientId + ')';
          body.innerHTML = '<div id="ghisRadSection"></div><div id="ghisLabSection"><div class="ghis-loading">Loading lab orders…</div></div>';
          drawer.style.display = '';
          GHIS.loadRadiology(patientId);
          GHIS.loadLabs(patientId);
        },
        loadLabs: function(patientId) {
          var body = document.getElementById('ghisLabSection');
          if (!body) return;
          fetch(PROXY + '/lab?patientId=' + encodeURIComponent(patientId))
            .then(function(r) { return r.json(); })
            .then(function(j) {
              if (j && j.error === 'session_expired') {
                body.innerHTML = '<div class="ghis-lab-empty">Session expired — reconnect in the Ward panel (paste a fresh cookie).</div>';
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
                  html += '<div class="ghis-lab-order" onclick="GHIS.toggleOrder(this,\'' + esc(o.renderId) + '\',\'' + esc(o.episodeId) + '\')">' +
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
              body.innerHTML = '<div class="ghis-lab-empty">Error loading labs: ' + esc(e.message) + ' — is the proxy running?</div>';
            });
        },
        loadRadiology: function(patientId) {
          var sec = document.getElementById('ghisRadSection');
          if (!sec) return;
          fetch(PROXY + '/radiology?patientId=' + encodeURIComponent(patientId))
            .then(function(r) { return r.json(); })
            .then(function(j) {
              var orders = (j && j.orders) || [];
              if (orders.length === 0) { sec.innerHTML = ''; return; }
              var html = '<div class="ghis-lab-section-title">🩻 Imaging · ' + orders.length + ' stud' + (orders.length === 1 ? 'y' : 'ies') + '</div>';
              orders.forEach(function(o) {
                html += '<div class="ghis-lab-order ghis-rad-order" onclick="GHIS.toggleRad(this,\'' + esc(o.resultid) + '\',\'' + esc(o.printType) + '\')">' +
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
          fetch(PROXY + '/radiology-report?resultid=' + encodeURIComponent(resultid) + '&type=' + encodeURIComponent(type))
            .then(function(r) { return r.json(); })
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
          fetch(PROXY + '/lab-detail?renderId=' + encodeURIComponent(renderId) +
                '&episodeId=' + encodeURIComponent(episodeId) +
                '&patientId=' + encodeURIComponent(GHIS._patientId || ''))
            .then(function(r) { return r.json(); })
            .then(function(d) {
              det.innerHTML = renderLabDetail(d);
              det.setAttribute('data-loaded', '1');
            })
            .catch(function(e) {
              det.innerHTML = '<div class="ghis-lab-detail-empty">Error: ' + esc(e.message) + '</div>';
            });
        }
      };
    
      window.openGHIS = function() {
        document.getElementById('ghisPanel').classList.add('open');
        // Check if proxy is up and we have a session
        fetch(PROXY + '/status')
          .then(function(r) { return r.json(); })
          .then(function(s) {
            if (s.connected) {
              _connected = true;
              dot(true);
              showScreen('ward');
              ghisLoadPatients();
            } else {
              showScreen('setup');
            }
          })
          .catch(function() { showScreen('setup'); });
      };
    
      window.closeGHIS = function() {
        document.getElementById('ghisPanel').classList.remove('open');
      };
    
      window.closeLabDrawer = function() {
        document.getElementById('ghisLabDrawer').style.display = 'none';
      };
    
      window.ghisConnect = function() {
        var cookies = (document.getElementById('ghisCookieInput').value || '').trim();
        var errEl = document.getElementById('ghisSetupError');
        if (!cookies) { errEl.textContent = 'Paste your Cookie value first.'; return; }
        errEl.textContent = '';
        fetch(PROXY + '/set-cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: cookies })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) {
            _connected = true;
            dot(true);
            showScreen('ward');
            ghisLoadPatients();
          } else {
            errEl.textContent = 'Connection failed: ' + (d.error || 'unknown error');
          }
        })
        .catch(function(e) {
          errEl.textContent = 'Proxy not reachable. Run: node ghis-proxy.js';
        });
      };
    
      window.ghisDisconnect = function() {
        _connected = false;
        dot(false);
        _patients = [];
        showScreen('setup');
      };
    
      window.ghisRefresh = function() {
        if (_connected) ghisLoadPatients();
      };
    
      function ghisLoadPatients() {
        var el = document.getElementById('ghisPatientList');
        if (el) el.innerHTML = '<div class="ghis-loading">Loading ward patients…</div>';
        fetch(PROXY + '/patients')
          .then(function(r) { return r.json(); })
          .then(function(raw) {
            var data;
            try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { data = []; }
            _patients = Array.isArray(data) ? data : [];
            renderPatients(_patients);
          })
          .catch(function(e) {
            if (el) el.innerHTML = '<div class="ghis-empty">Error: ' + esc(e.message) + '</div>';
          });
      }
    
      window.ghisFilterLocal = function() {
        var q = (document.getElementById('ghisSearchPt').value || '').toLowerCase().trim();
        if (!q) { renderPatients(_patients); return; }
        var filtered = _patients.filter(function(p) {
          return (p.patientFirstName || '').toLowerCase().indexOf(q) !== -1 ||
                 (p.patientId || '').toLowerCase().indexOf(q) !== -1;
        });
        renderPatients(filtered);
      };
    
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
