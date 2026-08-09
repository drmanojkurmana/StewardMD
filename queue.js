/* queue.js — Smart OPD Queue doctor dashboard controller (window.QUEUE).
 * Buildless ES5 IIFE, flag-gated (smd_opd_queue). FAITHFUL to the Google Stitch "Clinical Precision"
 * dashboard: _render(state) emits Stitch's exact markup (classes in queue.css) using the app's bundled
 * Material Symbols icon font — no emoji. _render is PURE (state -> HTML) so the demo renders identically.
 * Talks to /api/queue/* (server-authoritative). Realtime = poll (onSnapshot is a later upgrade). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var API = "/api/queue";
  var POLL_MS = 8000;
  var st = { session: null, tickets: [], me: {}, view: "dashboard", analytics: null, config: null, pollId: 0, ghisToken: null, ghisUser: "", ghisDoctorName: "", demo: false, openOpts: {}, pollN: 0 };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '">' + name + "</span>"; }
  function initials(n) { n = String(n || "").trim(); if (!n) return "DR"; var p = n.split(/\s+/); return ((p[0][0] || "") + (p[1] ? p[1][0] : (p[0][1] || ""))).toUpperCase(); }
  function mins(msDiff) { return Math.max(0, Math.round(msDiff / 60000)); }
  function isQueued(s) { return s === "registered" || s === "waiting" || s === "called"; }
  function now() { return Date.now(); }
  function emrOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_opd_emr")); } catch (e) { return false; } }

  // ---- derived display data (pure) --------------------------------------------------------
  function computeKpis(tickets) {
    var waiting = 0, waitSum = 0, waitN = 0, consultSum = 0, consultN = 0, lateAny = false;
    tickets.forEach(function (t) {
      if (isQueued(t.status)) { waiting++; if ((now() - (t.registeredAt || now())) > 30 * 60000) lateAny = true; }
      if (t.consultStartAt && t.registeredAt) { waitSum += (t.consultStartAt - t.registeredAt); waitN++; }
      if (t.consultEndAt && t.consultStartAt) { consultSum += (t.consultEndAt - t.consultStartAt); consultN++; }
    });
    return {
      waiting: waiting,
      avgWait: waitN ? mins(waitSum / waitN) : 0,
      avgConsult: consultN ? mins(consultSum / consultN) : 0,
      health: (lateAny || waiting > 10) ? "late" : "ok"
    };
  }
  function insightFor(tickets) {
    var worst = null, worstWait = 0;
    tickets.forEach(function (t) { if (isQueued(t.status)) { var w = now() - (t.registeredAt || now()); if (w > worstWait) { worstWait = w; worst = t; } } });
    if (worst && worstWait > 30 * 60000) return { t: worst, msg: (worst.name || "A patient") + " (#" + (worst.mrnLast4 || "—") + ") has waited " + mins(worstWait) + " minutes. Consider notifying the next few patients of the delay." };
    return null;
  }

  // ---- PURE render: state -> HTML (demo uses this verbatim) --------------------------------
  function navItem(icon, label, on) { return '<button class="q-nav' + (on ? " on" : "") + '" data-q-act="nav:' + label.toLowerCase() + '">' + ms(icon, on) + "<span>" + label + "</span></button>"; }
  function kpi(label, icon, valHtml, extra) {
    return '<div class="q-kpi">' +
      '<div class="q-kpi-l"><span>' + label + "</span>" + ms(icon) + "</div>" +
      '<div class="q-kpi-v">' + valHtml + (extra || "") + "</div></div>";
  }
  function ticketRow(t, idx, ord) {
    var waitMs = now() - (t.registeredAt || now());
    var late = isQueued(t.status) && waitMs > 30 * 60000;
    var isNext = idx === 0;
    var pri = t.priority >= 2 ? '<span class="q-pri emerg">Emergency</span>' : t.priority === 1 ? '<span class="q-pri prio">Priority</span>' : "";
    var etaMin = t.etaStart ? mins(t.etaStart - now()) : null;
    var line = late
      ? '<span class="q-tl-eta late">' + ms("error") + " Waiting: " + mins(waitMs) + "m</span>"
      : '<span class="q-tl-eta">' + ms(isNext ? "check_circle" : "pending", false) + (isNext ? '' : '') + " ETA: " + (etaMin == null ? "—" : etaMin + "m") + "</span>";
    return '<div class="q-tl-row' + (isNext ? " next" : "") + (late ? " late" : "") + '" data-q-tid="' + esc(t.id) + '">' +
        '<div class="q-pos">' + (idx + 1) + "</div>" +
        '<div><div class="q-tl-nm">' + esc(t.name || "Patient") + '<span class="id">#' + esc(t.mrnLast4 || "") + "</span>" + pri + "</div>" + line + "</div>" +
        '<div class="q-tl-acts">' +
          '<button class="q-ic" title="Call" data-q-act="call:' + esc(t.id) + '">' + ms("campaign") + "</button>" +
          '<button class="q-ic" title="Start" data-q-act="start:' + esc(t.id) + '">' + ms("play_arrow") + "</button>" +
          '<button class="q-ic" title="Priority" data-q-act="prio:' + esc(t.id) + '">' + ms("priority_high") + "</button>" +
          (emrOn() && t.ghisPatientId ? '<button class="q-ic" title="View EMR profile" data-q-act="profile:' + esc(t.id) + '">' + ms("clinical_notes") + "</button>" : "") +
          (emrOn() && t.ghisPatientId ? '<button class="q-ic" title="Assessment (GHIS Initial Assessment)" data-q-act="assess:' + esc(t.id) + '">' + ms("assignment") + "</button>" : "") +
        "</div></div>";
  }
  function renderConsult(cur) {
    if (!cur) return '<div class="q-consult"><div class="q-empty">' + ms("play_circle") + "<div style=\"margin-top:8px\">No one in consultation. Tap a patient's <b>Start</b> or <b>Finish</b> to advance the queue.</div></div></div>";
    var vt = cur.visitType === "followup" ? "Follow-up" : "New";
    return '<div class="q-consult"><div class="q-consult-b">' +
      '<div class="q-cn"><div><h3>' + esc(cur.name || "Patient") + "</h3>" +
        '<div class="q-cn-meta"><span>' + ms("badge") + " MRN: <span class=\"mono\">" + esc(cur.mrnLast4 || "—") + "</span></span></div></div>" +
        '<div class="q-vt">' + vt + "</div></div>" +
      '<div class="q-notes"><div class="q-notes-l">Quick Notes</div><textarea class="q-notes-in" placeholder="Add consultation notes…"></textarea></div>' +
      '<div class="q-cta">' +
        '<button class="q-finish" data-q-act="finish">' + ms("task_alt", true) + " Finish Consultation</button>" +
        (emrOn() && cur.ghisPatientId ? '<button class="q-emerg" data-q-act="assess:' + esc(cur.id) + '">' + ms("assignment") + " Assessment</button>" : "") +
        '<button class="q-emerg" data-q-act="emergency">' + ms("emergency") + " Emergency</button>" +
      "</div></div></div>";
  }

  function sidebar(view, doctorName, dept) {
    return '<aside class="q-side">' +
      '<div class="q-side-hd"><div class="q-avatar">' + esc(initials(doctorName)) + "</div><div class=\"who\"><b>" + esc(doctorName) + "</b><span>" + esc(dept) + "</span></div></div>" +
      navItem("dashboard", "Dashboard", view === "dashboard") + navItem("analytics", "Analytics", view === "analytics") +
      navItem("settings", "Settings", view === "settings") + navItem("notifications", "Notifications", false) + "</aside>";
  }
  function dashboardCanvas(state) {
    var s = state.session || {}, tickets = (state.tickets || []).slice();
    var ordered = tickets.filter(function (t) { return isQueued(t.status); }).sort(function (a, b) { return (a.position || 99) - (b.position || 99) || (a.registeredAt || 0) - (b.registeredAt || 0); });
    var cur = tickets.filter(function (t) { return t.status === "in_consultation"; })[0] || null;
    var k = computeKpis(tickets), ins = insightFor(tickets), paused = s.status === "paused";
    var kpis = '<section class="q-kpis">' +
      kpi("Patients Waiting", "groups", String(k.waiting), (k.waiting ? ' <span class="q-kpi-trend">' + ms("groups") + " in queue</span>" : "")) +
      kpi("Avg. Wait", "schedule", k.avgWait + "<u>m</u>", "") +
      kpi("Avg. Consultation", "timer", k.avgConsult + "<u>m</u>", "") +
      '<div class="q-kpi"><div class="q-kpi-l"><span>Queue Health</span>' + ms("health_and_safety") + '</div><div class="q-health' + (k.health === "late" ? " late" : "") + '">' + ms(k.health === "late" ? "warning" : "check_circle", true) + (k.health === "late" ? "Running late" : "On Track") + "</div></div>" +
      "</section>";
    var rows = ordered.length ? ordered.map(function (t, i) { return ticketRow(t, i, ordered); }).join("") : '<div class="q-empty">Queue is empty. Import from Ward Sync or add a patient.</div>';
    var timeline = '<div class="q-tl"><div class="q-tl-head"><div class="c">Pos</div><div>Patient</div><div class="r">Actions</div></div>' + rows +
      '<div class="q-tl-foot"><a data-q-act="viewall">View full queue (' + ordered.length + ")</a></div></div>";
    var ai = ins ? '<div class="q-ai"><div class="q-ai-icon">' + ms("auto_awesome") + "</div><div style=\"flex:1\"><h4>AI Insights</h4><p>" + esc(ins.msg) + '</p><button class="q-ai-send" data-q-act="notify:' + esc(ins.t.id) + '">Send notification</button></div><button class="q-ai-x" data-q-act="dismiss">' + ms("close") + "</button></div>" : "";
    return kpis + '<section class="q-grid"><div><h2 class="q-h2">' + ms("play_circle") + "Currently Consulting</h2>" + renderConsult(cur) +
      '<button class="q-pause" data-q-act="pause">' + ms("pause_circle") + (paused ? " Resume Queue" : " Pause Queue") + "</button></div>" +
      '<div class="q-side-col"><h2 class="q-h2">' + ms("view_list", false) + 'Queue Timeline<span class="r">Next ' + Math.min(3, ordered.length) + "</span></h2>" + timeline + ai + "</div></section>";
  }
  function _render(state) {
    var s = state.session || {}, view = state.view || "dashboard";
    var doctorName = state.ghisDoctorName || (state.ghisToken && state.ghisUser ? ("Dr " + state.ghisUser) : "") || s.doctorName || state.me.name || "Doctor", dept = s.department || state.me.dept || "OPD", paused = s.status === "paused";
    var header = '<header class="q-top"><div class="q-top-in"><button class="q-iconbtn" data-q-act="switch" title="Switch clinic or hospital">' + ms("arrow_back") + '</button><div class="q-brand"><span class="q-logo-mark" aria-hidden="true"></span><span class="q-wordmark">Steward<span>MD</span></span></div><div class="q-top-r">' +
      '<button class="q-online" data-q-act="docstatus"><span class="dot"></span>' + esc(paused ? "Paused" : (s.doctorStatus ? cap(s.doctorStatus) : "System Online")) + "</button>" +
      (view === "dashboard" ? '<button class="q-iconbtn" data-q-act="importopd" title="Import today\'s OPD list from Ward Sync">' + ms("download") + '</button><button class="q-iconbtn" data-q-act="add" title="Add patient">' + ms("person_add") + "</button>" : "") +
      (state.ghisToken ? '<button class="q-iconbtn" data-q-act="logout" title="Sign out of GHIS">' + ms("logout") + "</button>" : "") +
      '<div class="q-avatar" title="' + esc(doctorName) + '">' + esc(initials(doctorName)) + "</div></div></div></header>";
    var canvas = view === "analytics" ? analyticsCanvas(state) : view === "settings" ? settingsCanvas(state) : dashboardCanvas(state);
    var bottom = '<nav class="q-bottomnav">' + navItem("dashboard", "Queue", view === "dashboard") + navItem("analytics", "Analytics", view === "analytics") + navItem("settings", "Settings", view === "settings") + "</nav>";
    var main = '<div class="q-main">' + header + '<div class="q-canvas">' + canvas + "</div>" + bottom + "</div>";
    return '<div class="q-app">' + sidebar(view, doctorName, dept) + main + "</div>";
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- Analytics view (Stitch queue_analytics port) ---------------------------------------
  function peakChart(peak) {
    if (!peak || !peak.length) return '<div class="q-empty" style="padding:20px">No registrations yet today.</div>';
    var max = Math.max.apply(null, peak.map(function (p) { return p.count; })) || 1;
    var W = 300, H = 96, n = peak.length, bw = Math.max(6, Math.floor((W - (n - 1) * 4) / n));
    var bars = peak.map(function (p, i) {
      var h = Math.max(2, Math.round(p.count / max * (H - 20))), x = i * (bw + 4);
      return '<rect x="' + x + '" y="' + (H - 18 - h) + '" width="' + bw + '" height="' + h + '" rx="2" fill="var(--primary)"></rect>' +
        '<text x="' + (x + bw / 2) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="8" fill="var(--secondary)">' + p.h + '</text>';
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" preserveAspectRatio="xMidYMax meet" style="max-height:120px">' + bars + "</svg>";
  }
  function analyticsCanvas(state) {
    var a = state.analytics;
    if (!a) return '<h2 class="q-h2">' + ms("analytics") + 'Performance analytics</h2><div class="q-empty" style="padding:60px">Loading analytics…</div>';
    var acc = a.etaAccuracyPct == null ? "—" : a.etaAccuracyPct + "%";
    var kpis = '<section class="q-kpis">' +
      kpi("Completed", "task_alt", String(a.completed), "") + kpi("Avg. Wait", "schedule", a.avgWaitMin + "<u>m</u>", "") +
      kpi("Avg. Consult", "timer", a.avgConsultMin + "<u>m</u>", "") + kpi("No-shows", "person_off", String(a.noShow), "") + "</section>";
    var eta = '<div class="q-card"><div class="q-card-h">' + ms("trending_up") + 'ETA accuracy</div><div class="q-bignum">' + acc + '</div><div class="q-sub">predictions within 10 minutes</div></div>';
    var peak = '<div class="q-card"><div class="q-card-h">' + ms("calendar_month") + "Peak hours (by registration)</div>" + peakChart(a.peakHours) + "</div>";
    var out = '<div class="q-card"><div class="q-card-h">' + ms("insights") + "Outcomes</div>" +
      '<div class="q-out"><span>Completed</span><b>' + a.completed + "</b></div><div class=\"q-out\"><span>No-show</span><b>" + a.noShow + "</b></div>" +
      '<div class="q-out"><span>Cancelled</span><b>' + a.cancelled + "</b></div><div class=\"q-out\"><span>In queue</span><b>" + a.waiting + "</b></div></div>";
    return '<h2 class="q-h2">' + ms("analytics") + "Performance analytics</h2>" + kpis + '<section class="q-grid2">' + eta + peak + out + "</section>";
  }

  // ---- Settings view (Stitch queue_configuration_settings port) ---------------------------
  function num(k, label, val, hint) { return '<div class="q-fld"><label>' + label + '</label><input type="number" min="1" data-cfg="' + k + '" value="' + esc(val) + '"><span class="q-hint">' + (hint || "") + "</span></div>"; }
  function tog(k, label, val, hint) { return '<div class="q-togrow"><div><div class="q-togl">' + label + "</div>" + (hint ? '<div class="q-hint">' + hint + "</div>" : "") + '</div><label class="q-tog"><input type="checkbox" data-cfg="' + k + '"' + (val ? " checked" : "") + "><span></span></label></div>"; }
  function settingsCanvas(state) {
    var c = state.config;
    if (!c) return '<h2 class="q-h2">' + ms("settings") + 'Queue configuration</h2><div class="q-empty" style="padding:60px">Loading settings…</div>';
    return '<div class="q-set-hd"><h2 class="q-h2" style="margin:0">' + ms("settings") + 'Queue configuration</h2>' +
        '<button class="q-finish" style="font-size:14px;padding:10px 18px" data-q-act="savecfg">' + ms("save") + " Save changes</button></div>" +
      '<section class="q-grid2">' +
        '<div class="q-card"><div class="q-card-h">' + ms("notifications_active") + "Notification triggers</div>" +
          num("early", "Early warning (patients ahead)", c.early, "SMS/WhatsApp when this many are ahead") +
          num("prep", "Preparation alert (patients ahead)", c.prep, "'Please head over' — kept ≤ early") +
          '<div class="q-out"><span>Next-in-line</span><b>Always at position 1</b></div>' +
          tog("smsEnabled", "SMS channel", c.smsEnabled) + tog("waEnabled", "WhatsApp channel", c.waEnabled, "needs a configured provider") +
        "</div>" +
        '<div class="q-card"><div class="q-card-h">' + ms("rule") + "Rule engine</div>" +
          num("noShowTimeoutMin", "Auto no-show timeout (min)", c.noShowTimeoutMin, "after 'called', offer no-show") +
          num("defaultConsultMin", "Default consult (min)", c.defaultConsultMin, "used before ETA learning kicks in") +
          tog("etaLearning", "ETA learning", c.etaLearning, "learn this doctor's consult durations") +
        "</div>" +
      "</section>";
  }

  // ---- API (server-authoritative) ---------------------------------------------------------
  // Authenticate like every other module: the doctor's Firebase ID token (window.SMD_AUTH) as Bearer, so the
  // server identify() resolves the owner. getIdToken() is async, so authHeaders() returns a Promise. A
  // window.SMD_QUEUE_AUTH() override is still honored if some caller sets one. (Without this the queue sent NO
  // token -> server saw a guest -> /session 'unauthorized' -> the app stuck on "Queue is being set up".)
  function fbToken() {
    try {
      var ov = G.SMD_QUEUE_AUTH && G.SMD_QUEUE_AUTH(); if (ov) return Promise.resolve(ov);
      var u = (G.SMD_AUTH && G.SMD_AUTH.currentUser) || (G.firebase && G.firebase.auth && G.firebase.auth().currentUser);
      if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; });
    } catch (e) {}
    return Promise.resolve(null);
  }
  function authHeaders() { return fbToken().then(function (t) { var h = { "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t; return h; }); }
  // Retry transient network/DNS failures (e.g. a momentary "Unable to resolve host" right after app launch or a
  // WiFi/data switch) so the app self-heals and users NEVER touch WiFi/DNS settings. Only retries a REJECTED
  // fetch (network error) — never an HTTP error status. 3 tries with ~0.7s backoff.
  function fetchRetry(url, opts, tries) {
    tries = tries || 3;
    return fetch(url, opts).catch(function (e) {
      if (tries <= 1) throw e;
      return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return fetchRetry(url, opts, tries - 1); });
    });
  }
  function apiGet(path) { return authHeaders().then(function (h) { return fetchRetry(API + path, { headers: h, credentials: "include" }); }).then(function (r) { return r.json(); }); }
  function apiPost(path, body) { return authHeaders().then(function (h) { return fetchRetry(API + path, { method: "POST", headers: h, credentials: "include", body: JSON.stringify(body || {}) }); }).then(function (r) { return r.json(); }); }

  // ---- controller -------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdQueue"); if (!el) { el = document.createElement("div"); el.id = "smdQueue"; document.body.appendChild(el); } return el; }
  function paint() { root().innerHTML = _render(st); }

  function refresh() {
    if (st.demo || !st.session || st.view === "settings") return;   // demo has no server session; don't clobber unsaved settings mid-poll
    st.pollN = (st.pollN || 0) + 1;
    // real-time-ish sync: silently re-pull today's GHIS Out-patients list every ~5 polls (~40s) so newly
    // registered patients appear without a manual import (dedupes server-side by visit id).
    if (st.ghisToken && st.pollN % 5 === 0 && (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool || G.SMD_QUEUE_FLAGS.bool("smd_opd_queue_import"))) { try { importOpd(true); } catch (e) {} }
    apiGet("/list?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) { if (r && r.ok) { st.tickets = r.tickets || []; paint(); } }).catch(function () {});
  }
  function act(sessId, path, body) { body = body || {}; body.sessionId = sessId; return apiPost(path, body).then(function (r) { if (r && r.ok && r.tickets) { st.tickets = r.tickets; paint(); } else if (r && r.ok && r.session) { st.session = r.session; paint(); } return r; }); }
  function switchView(view) {
    if (view === "queue") view = "dashboard";
    if (view !== "dashboard" && view !== "analytics" && view !== "settings") return;
    st.view = view; paint();
    if (st.demo) return;   // demo has no server session to fetch analytics/config from
    if (view === "analytics" && st.session) apiGet("/analytics?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) { if (r && r.ok && st.view === "analytics") { st.analytics = r.analytics; paint(); } }).catch(function () {});
    if (view === "settings") apiGet("/config").then(function (r) { if (r && r.ok && st.view === "settings") { st.config = r.config; paint(); } }).catch(function () {});
  }
  function saveCfg() {
    var cfg = {};
    root().querySelectorAll("[data-cfg]").forEach(function (inp) { cfg[inp.getAttribute("data-cfg")] = inp.type === "checkbox" ? inp.checked : Number(inp.value); });
    apiPost("/config", { config: cfg }).then(function (r) { if (r && r.ok) { st.config = r.config; paint(); try { G.toast && G.toast("Settings saved"); } catch (e) {} } }).catch(function () {});
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-q-act]"); if (!b) return;
    var a = b.getAttribute("data-q-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "chooser") { root().innerHTML = _chooseType(); return; }                // back to Hospital / Personal clinic
    if (cmd === "switch") { clearInterval(st.pollId); st.session = null; st.tickets = []; st.demo = false; st.ghisToken = null; root().innerHTML = _chooseType(); return; }  // dashboard back -> switch workplace
    if (cmd === "typehosp") { _listHospitals(); return; }                               // Hospital -> pick a connected hospital
    if (cmd === "typeclinic") { _listClinics(); return; }                               // Personal clinic -> pick one
    if (cmd === "rolestaff") { root().innerHTML = _staffNote(); return; }               // front-desk staff -> web console
    if (cmd === "pickghis") { root().innerHTML = _gate(); setTimeout(function () { try { var u = document.getElementById("qGhisUser"); if (u) u.focus(); } catch (e) {} }, 80); return; }  // GITAM / GHIS
    if (cmd === "pickhosp") { loadRoom(arg, ""); return; }                              // EMR-Connect hospital (future, auto-listed): room-based like a clinic
    if (cmd === "pickclinic") { startClinic(arg); return; }                             // a personal clinic
    if (cmd === "pickroom") { var pr = arg.split("~"); loadRoom(pr[0], pr[1] || ""); return; }   // doctor picked their room
    if (cmd === "newclinic") { try { window.open("https://stewardmd.in/opd", "_blank"); } catch (e) { try { location.href = "https://stewardmd.in/opd"; } catch (x) {} } return; }
    if (cmd === "openconsole") { try { window.open("https://stewardmd.in/opd", "_blank"); } catch (e) { try { location.href = "https://stewardmd.in/opd"; } catch (x) {} } return; }
    if (cmd === "ghislogin") { ghisLogin(); return; }
    if (cmd === "demo") { demo(); return; }
    if (cmd === "logout") { doLogout(); return; }
    if (cmd === "retry") { loadSession(); return; }
    var sid = st.session && st.session.id; if (!sid && cmd !== "nav" && cmd !== "dismiss" && cmd !== "savecfg") return;
    if (st.demo && cmd !== "nav" && cmd !== "dismiss") { try { G.toast && G.toast("Demo mode — sign in to GHIS to manage a real queue."); } catch (e) {} return; }
    if (cmd === "nav") { switchView(arg); return; }
    if (cmd === "savecfg") { saveCfg(); return; }
    if (cmd === "finish") act(sid, "/advance");
    else if (cmd === "start") act(sid, "/status", { ticketId: arg, status: "in_consultation" });
    else if (cmd === "call") act(sid, "/status", { ticketId: arg, status: "called" });
    else if (cmd === "prio") act(sid, "/priority", { ticketId: arg, priority: 2 });
    else if (cmd === "pause") act(sid, "/session/status", { status: st.session.status === "paused" ? "active" : "paused" });
    else if (cmd === "emergency") act(sid, "/session/status", { doctorStatus: st.session.doctorStatus === "emergency" ? "consulting" : "emergency" });
    else if (cmd === "importopd") importOpd();
    else if (cmd === "profile") openEmrProfile(arg);
    else if (cmd === "assess") openAssessment(arg);
    else if (cmd === "add") openAdd();
    else if (cmd === "dismiss") { var ai = root().querySelector(".q-ai"); if (ai) ai.style.display = "none"; }
    // notify/nav/viewall/docstatus/skip: Phase 2/3
  }

  function importOpd(silent) {
    if (!st.session) return;
    var say = function (m) { if (silent) return; try { G.toast && G.toast(m); } catch (e) {} };
    say("Importing today's OPD list…");
    var gh = { "Content-Type": "application/json" }; if (st.ghisToken) gh.Authorization = "Bearer " + st.ghisToken;
    fetchRetry("/api/ghis/opd-patients", { headers: gh, credentials: "include" }).then(function (r) { return r.json(); }).then(function (r) {
      if (r && r.error === "login_required") { say("Connect Ward Sync (GHIS) first, then import"); return; }
      var rows = (r && r.rows) || [];
      if (!rows.length) { say("No OPD patients found for today"); return; }
      act(st.session.id, "/import", { rows: rows }).then(function (res) { if (res && res.ok && res.imported) { say("Imported " + res.imported + " patient(s)"); } });
    }).catch(function () { say("Could not reach Ward Sync"); });
  }
  // View EMR profile (flag smd_opd_emr): look up the ticket locally for its full MR# + name, hand to OPDEMR.
  function openEmrProfile(ticketId) {
    var t = null; for (var i = 0; i < st.tickets.length; i++) { if (st.tickets[i].id === ticketId) { t = st.tickets[i]; break; } }
    if (!t || !G.OPDEMR || !G.OPDEMR.openProfile) return;
    G.OPDEMR.openProfile({ patientId: t.ghisPatientId || "", name: t.name || "" });
  }
  // Open the GHIS Initial Assessment form straight away for this patient (EMR overlay, "assess" tab).
  function openAssessment(ticketId) {
    var t = null; for (var i = 0; i < st.tickets.length; i++) { if (st.tickets[i].id === ticketId) { t = st.tickets[i]; break; } }
    if (!t || !G.OPDEMR || !G.OPDEMR.openProfile) return;
    G.OPDEMR.openProfile({ patientId: t.ghisPatientId || t.mrn || "", name: t.name || "", tab: "assess" });
  }
  function openAdd() {
    var name = prompt("Patient name?"); if (name == null) return;
    var mrn = prompt("GHIS MR number (enables EMR profile + assessment for this patient)?") || "";
    var mobile = prompt("Mobile (optional)?") || "";
    var vt = (prompt("Visit type: new / followup", "new") || "new").toLowerCase();
    act(st.session.id, "/ticket", { name: name, mrn: mrn, mobile: mobile, visitType: vt === "followup" ? "followup" : "new", priority: 0 });
  }

  // ---- OPD entry chooser: Doctor vs Staff; Doctor -> My clinic (StewardMD) vs Hospital (GITAM/GHIS) ----
  function _wrap(inner) {
    return '<div class="q-gate"><div class="q-gate-card">' +
      '<div class="q-brand q-gate-brand"><span class="q-logo-mark" aria-hidden="true"></span><span class="q-wordmark">Steward<span>MD</span></span></div>' +
      '<h2 class="q-gate-h">OPD Queue</h2>' + inner + "</div></div>";
  }
  // One doctor, one login, many workplaces: choose Hospital (EMR-connected) or Personal clinic (native).
  function _chooseType() {
    return _wrap('<p class="q-gate-sub">Where are you working now?</p>' +
      '<button class="q-gate-btn" data-q-act="typehosp">' + ms("local_hospital") + " Hospital</button>" +
      '<button class="q-gate-btn" data-q-act="typeclinic" style="margin-top:10px;background:#0b5c56">' + ms("home_health") + " Personal clinic</button>" +
      '<div class="q-gate-or"><span>or</span></div>' +
      '<button class="q-gate-demo" data-q-act="rolestaff">' + ms("badge") + " I'm front-desk staff</button>" +
      '<button class="q-gate-close" data-q-act="close">Close</button>');
  }
  // Hospitals connected through EMR Connect: GITAM/GHIS today + ANY mode:connect org (auto-appears, no hardcode).
  function _listHospitals() {
    var el = root(); el.innerHTML = _wrap('<div class="q-empty" style="padding:40px 8px">Loading hospitals…</div>');
    apiGet("/orgs").then(function (r) {
      var rows = '<button class="q-gate-btn" style="text-align:left" data-q-act="pickghis">' + ms("local_hospital") + " GITAM — GHIS<br><small style=\"opacity:.85;font-weight:400\">Hospital EMR · Ward Sync</small></button>";
      ((r && r.orgs) || []).filter(function (o) { return o.mode === "connect" && o.connectorId; }).forEach(function (o) {   // only real EMR-connected hospitals (a connect org with no connector is malformed, never shown)
        rows += '<button class="q-gate-btn" style="text-align:left;margin-top:10px" data-q-act="pickhosp:' + esc(o.id) + '">' + ms("local_hospital") + " " + esc(o.name || "Hospital") + "<br><small style=\"opacity:.85;font-weight:400\">" + esc(o.code || "") + " · EMR-connected</small></button>";
      });
      el.innerHTML = _wrap('<p class="q-gate-sub">Choose your hospital.</p>' + rows + '<button class="q-gate-close" data-q-act="chooser">Back</button>');
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  // The doctor's personal (native, no-EMR) clinics. Here the WhatsApp visit link is the record.
  function _listClinics() {
    var el = root(); el.innerHTML = _wrap('<div class="q-empty" style="padding:40px 8px">Loading your clinics…</div>');
    apiGet("/orgs").then(function (r) {
      var mine = ((r && r.orgs) || []).filter(function (o) { return o.mode !== "connect"; });
      var rows = mine.length ? mine.map(function (o) {
        return '<button class="q-gate-btn" style="text-align:left;margin-top:10px" data-q-act="pickclinic:' + esc(o.id) + '">' + ms("home_health") + " " + esc(o.name || "Clinic") + "<br><small style=\"opacity:.85;font-weight:400\">" + esc(o.code || "") + "</small></button>";
      }).join("") : '<p class="q-gate-sub">No personal clinic yet — set one up in the console.</p>';
      el.innerHTML = _wrap('<p class="q-gate-sub">Choose your clinic.</p>' + rows + '<button class="q-gate-btn" style="margin-top:12px;background:#f1f5f9;color:#0f172a" data-q-act="newclinic">' + ms("add") + " New clinic (in console)</button><button class=\"q-gate-close\" data-q-act=\"chooser\">Back</button>");
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  function _staffNote() {
    return _wrap('<p class="q-gate-sub">Front-desk staff use the OPD web console — no app install needed.</p>' +
      '<button class="q-gate-btn" data-q-act="openconsole">' + ms("open_in_new") + " Open OPD console</button>" +
      '<button class="q-gate-close" data-q-act="chooser">Back</button>');
  }
  // Doctor at a CHOSEN StewardMD org (clinic or Connect hospital). Loads the doctor's ROOM session — the
  // SAME queue the sister routes into on the console (server resolves the room by identity). No GHIS.
  function startClinic(orgId) { if (!orgId) { _listClinics(); return; } loadRoom(orgId, ""); }
  function loadRoom(orgId, roomId) {
    st.orgId = orgId;
    var el = root(); el.innerHTML = '<div class="q-empty" style="padding:80px">Loading your room…</div>';
    var q = "?orgId=" + encodeURIComponent(orgId) + (roomId ? "&roomId=" + encodeURIComponent(roomId) : "");
    apiGet("/my-room" + q).then(function (r) {
      if (r && r.ok && r.resolved && r.session) {
        st.session = r.session; st.tickets = r.tickets || [];
        st.me = { name: (r.room && r.room.name) || r.session.doctorName || "Room", dept: (r.room && r.room.department) || "" };
        st.view = "dashboard"; paint();
        clearInterval(st.pollId); st.pollId = setInterval(refresh, POLL_MS);   // refresh() polls /list by session id
        return;
      }
      if (r && r.ok && !r.resolved) { _pickRoom(orgId, r.rooms || []); return; }
      el.innerHTML = _wrap('<p class="q-gate-sub">Could not open this clinic (' + esc((r && r.error) || "error") + ').</p><button class="q-gate-close" data-q-act="chooser">Back</button>');
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  // No room auto-assigned to this doctor here -> let them pick which room they are manning today.
  function _pickRoom(orgId, rooms) {
    if (!rooms.length) { root().innerHTML = _wrap('<p class="q-gate-sub">No consulting room is set up for you here yet. Ask the clinic admin, or add rooms in the console.</p><button class="q-gate-btn" style="background:#f1f5f9;color:#0f172a" data-q-act="newclinic">' + ms("open_in_new") + " Open console</button><button class=\"q-gate-close\" data-q-act=\"chooser\">Back</button>"); return; }
    var rows = rooms.map(function (rm) {
      return '<button class="q-gate-btn" style="text-align:left;margin-top:10px" data-q-act="pickroom:' + esc(orgId) + '~' + esc(rm.id) + '">' + ms("meeting_room") + " " + esc(rm.name || "Room") + (rm.number ? " · " + esc(rm.number) : "") + (rm.department ? "<br><small style=\"opacity:.85;font-weight:400\">" + esc(rm.department) + "</small>" : "") + "</button>";
    }).join("");
    root().innerHTML = _wrap('<p class="q-gate-sub">Which room are you in?</p>' + rows + '<button class="q-gate-close" data-q-act="chooser">Back</button>');
  }

  // ---- GHIS login gate + demo mode --------------------------------------------------------
  function _gate(err) {
    var who = ""; try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; if (u && u.email) who = u.email; } catch (e) {}
    return '<div class="q-gate"><div class="q-gate-card">' +
      '<div class="q-brand q-gate-brand"><span class="q-logo-mark" aria-hidden="true"></span><span class="q-wordmark">Steward<span>MD</span></span></div>' +
      '<h2 class="q-gate-h">OPD Queue</h2>' +
      '<p class="q-gate-sub">Sign in to GHIS to load today\'s OPD queue.</p>' +
      '<input id="qGhisUser" class="q-gate-in" type="text" autocomplete="username" autocapitalize="off" autocorrect="off" placeholder="GHIS User ID">' +
      '<input id="qGhisPwd" class="q-gate-in" type="password" autocomplete="current-password" placeholder="Password">' +
      '<div class="q-gate-err">' + (err ? esc(err) : "") + "</div>" +
      '<button class="q-gate-btn" data-q-act="ghislogin">Sign in</button>' +
      '<div class="q-gate-or"><span>or</span></div>' +
      '<button class="q-gate-demo" data-q-act="demo">' + ms("science") + " Try with demo data</button>" +
      '<button class="q-gate-close" data-q-act="chooser">‹ Back</button>' +
      (who ? '<div class="q-gate-foot">App account: ' + esc(who) + "</div>" : "") +
      "</div></div>";
  }
  function ghisLogin() {
    var uEl = document.getElementById("qGhisUser"), pEl = document.getElementById("qGhisPwd");
    var userId = uEl ? uEl.value.trim() : "", password = pEl ? pEl.value : "";
    var errEl = root().querySelector(".q-gate-err"), btn = root().querySelector(".q-gate-btn");
    if (!userId || !password) { if (errEl) errEl.textContent = "Enter your GHIS User ID and password."; return; }
    if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
    authHeaders().then(function (h) { return fetchRetry("/api/ghis/login", { method: "POST", headers: h, credentials: "include", body: JSON.stringify({ userId: userId, password: password }) }); })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r && r.token) { st.ghisToken = r.token; st.ghisUser = r.userId || userId; st.ghisDoctorName = r.doctorName || ""; loadSession(); return; }
        var msg = (r && r.error === "needs-pro") ? "Ward Sync needs a Pro account." : (r && r.error === "bad_credentials") ? "Wrong GHIS User ID or password." : "Sign-in failed. Please try again.";
        if (errEl) errEl.textContent = msg; if (btn) { btn.disabled = false; btn.textContent = "Sign in"; }
      })
      .catch(function () { if (errEl) errEl.textContent = "Could not reach the server. Check your connection."; if (btn) { btn.disabled = false; btn.textContent = "Sign in"; } });
  }
  function demo() {
    st.demo = true; var nm = now();
    st.session = { id: "demo", doctorName: st.ghisUser || "Demo Doctor", department: "General Medicine OPD", status: "active", doctorStatus: "consulting" };
    st.me = { name: st.session.doctorName, dept: st.session.department };
    st.tickets = [
      { id: "d1", name: "Ramesh Kumar", mrnLast4: "4821", ghisPatientId: "MR26100001", status: "in_consultation", visitType: "new", registeredAt: nm - 26 * 60000 },
      { id: "d2", name: "Lakshmi Devi", mrnLast4: "7734", ghisPatientId: "MR26100002", status: "called", visitType: "followup", priority: 0, position: 1, registeredAt: nm - 19 * 60000, etaStart: nm + 2 * 60000 },
      { id: "d3", name: "Abdul Rahman", mrnLast4: "1902", ghisPatientId: "MR26100003", status: "waiting", visitType: "new", priority: 2, position: 2, registeredAt: nm - 44 * 60000, etaStart: nm - 4 * 60000 },
      { id: "d4", name: "Sita Mahalakshmi", mrnLast4: "5560", ghisPatientId: "MR26100004", status: "waiting", visitType: "new", priority: 0, position: 3, registeredAt: nm - 9 * 60000, etaStart: nm + 14 * 60000 },
      { id: "d5", name: "John Peter", mrnLast4: "3341", ghisPatientId: "MR26100005", status: "registered", visitType: "followup", priority: 0, position: 4, registeredAt: nm - 4 * 60000, etaStart: nm + 22 * 60000 }
    ];
    st.view = "dashboard"; paint();
  }
  function loadSession() {
    var opts = st.openOpts || {}, el = root();
    el.innerHTML = '<div class="q-empty" style="padding:80px">Loading your queue…</div>';
    var q = "?hospitalId=" + encodeURIComponent(opts.hospitalId || "manual") + "&department=" + encodeURIComponent(opts.department || "") + "&source=" + encodeURIComponent(opts.source || "manual");
    apiGet("/session" + q).then(function (r) {
      if (!r || !r.ok) { el.innerHTML = '<div class="q-empty" style="padding:80px">Could not start the queue (' + esc((r && r.error) || "error") + ').<br><button class="q-pause" style="max-width:220px;margin:16px auto 0" data-q-act="close">Close</button></div>'; return; }
      st.session = r.session; st.tickets = r.tickets || []; st.me = { name: r.session.doctorName, dept: r.session.department }; paint();
      clearInterval(st.pollId); st.pollId = setInterval(refresh, POLL_MS);
      // Primary data source: auto-pull today's GHIS Out-patients list into the queue right after a GHIS sign-in
      // (dedupes server-side by episode id, so it is safe to run on every entry). Manual "Import" button remains.
      if (st.ghisToken && (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool || G.SMD_QUEUE_FLAGS.bool("smd_opd_queue_import"))) { try { importOpd(); } catch (e) {} }
    }).catch(function () { el.innerHTML = '<div class="q-empty" style="padding:80px">Could not reach the server. Check your connection.<br><button class="q-pause" style="max-width:200px;margin:16px auto 0" data-q-act="retry">Retry</button></div>'; });
  }
  function open(opts) {
    if (G.SMD_QUEUE_FLAGS && !G.SMD_QUEUE_FLAGS.on()) { try { G.toast && G.toast("Smart OPD Queue is off"); } catch (e) {} return; }
    st.openOpts = opts || {};
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    if (st.ghisToken || st.demo) { loadSession(); return; }          // already signed in this session -> straight to the queue
    el.innerHTML = _chooseType();                                    // otherwise: Hospital vs Personal clinic, then choose the place
  }
  function close() { var el = document.getElementById("smdQueue"); if (el) el.classList.remove("on"); clearInterval(st.pollId); st.demo = false; }
  // Sign out of GHIS: drop the GHIS session token + doctor identity, tell the server to forget the session,
  // and re-open the login gate so a different doctor can sign in.
  function doLogout() {
    clearInterval(st.pollId);
    var tok = st.ghisToken;
    st.ghisToken = null; st.ghisDoctorName = ""; st.ghisUser = ""; st.demo = false; st.session = null; st.tickets = []; st.pollN = 0;
    if (tok) { try { fetch("/api/ghis/logout", { method: "POST", headers: { "Authorization": "Bearer " + tok }, credentials: "include" }).catch(function () {}); } catch (e) {} }
    open(st.openOpts);   // ghisToken now null -> the GHIS login gate shows again
  }

  G.QUEUE = { open: open, close: close, refresh: refresh, _render: _render, _st: st };

  // Testing launch hook (no nav coupling yet): with the flag on, ?queue=1 auto-opens. The proper
  // sidebar/home tile is a small follow-up. e.g. stewardmd.in/?q=1&queue=1 (preview) or in-app.
  try {
    if (G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.on() && /[?&]queue=1/.test((G.location && G.location.search) || "")) {
      G.addEventListener("DOMContentLoaded", function () { open(); });
    }
  } catch (e) {}
})();
