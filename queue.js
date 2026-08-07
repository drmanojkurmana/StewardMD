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
  var st = { session: null, tickets: [], me: {}, pollId: 0 };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '">' + name + "</span>"; }
  function initials(n) { n = String(n || "").trim(); if (!n) return "DR"; var p = n.split(/\s+/); return ((p[0][0] || "") + (p[1] ? p[1][0] : (p[0][1] || ""))).toUpperCase(); }
  function mins(msDiff) { return Math.max(0, Math.round(msDiff / 60000)); }
  function isQueued(s) { return s === "registered" || s === "waiting" || s === "called"; }
  function now() { return Date.now(); }

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
        '<button class="q-emerg" data-q-act="emergency">' + ms("emergency") + " Emergency</button>" +
      "</div></div></div>";
  }

  function _render(state) {
    var s = state.session || {}, tickets = (state.tickets || []).slice();
    var ordered = tickets.filter(function (t) { return isQueued(t.status); }).sort(function (a, b) { return (a.position || 99) - (b.position || 99) || (a.registeredAt || 0) - (b.registeredAt || 0); });
    var cur = tickets.filter(function (t) { return t.status === "in_consultation"; })[0] || null;
    var k = computeKpis(tickets), ins = insightFor(tickets);
    var paused = s.status === "paused";
    var doctorName = s.doctorName || state.me.name || "Doctor";
    var dept = s.department || state.me.dept || "OPD";

    var side = '<aside class="q-side">' +
      '<div class="q-side-hd"><div class="q-avatar">' + esc(initials(doctorName)) + "</div><div class=\"who\"><b>" + esc(doctorName) + "</b><span>" + esc(dept) + "</span></div></div>" +
      navItem("dashboard", "Dashboard", true) + navItem("analytics", "Analytics", false) + navItem("settings", "Settings", false) + navItem("notifications", "Notifications", false) +
      "</aside>";

    var header = '<header class="q-top"><div class="q-top-in">' +
      '<div class="q-brand">' + ms("monitor_heart", true) + "StewardMD</div>" +
      '<div class="q-top-r">' +
        '<button class="q-online" data-q-act="docstatus"><span class="dot"></span>' + esc(paused ? "Paused" : (s.doctorStatus ? cap(s.doctorStatus) : "System Online")) + "</button>" +
        '<button class="q-iconbtn" data-q-act="add" title="Add patient">' + ms("person_add") + "</button>" +
        '<div class="q-avatar">' + esc(initials(doctorName)) + "</div>" +
      "</div></div></header>";

    var kpis = '<section class="q-kpis">' +
      kpi("Patients Waiting", "groups", String(k.waiting), (k.waiting ? ' <span class="q-kpi-trend">' + ms("groups") + " in queue</span>" : "")) +
      kpi("Avg. Wait", "schedule", k.avgWait + "<u>m</u>", "") +
      kpi("Avg. Consultation", "timer", k.avgConsult + "<u>m</u>", "") +
      '<div class="q-kpi"><div class="q-kpi-l"><span>Queue Health</span>' + ms("health_and_safety") + '</div><div class="q-health' + (k.health === "late" ? " late" : "") + '">' + ms(k.health === "late" ? "warning" : "check_circle", true) + (k.health === "late" ? "Running late" : "On Track") + "</div></div>" +
      "</section>";

    var rows = ordered.length ? ordered.map(function (t, i) { return ticketRow(t, i, ordered); }).join("") : '<div class="q-empty">Queue is empty. Import from Ward Sync or add a patient.</div>';
    var timeline = '<div class="q-tl">' +
      '<div class="q-tl-head"><div class="c">Pos</div><div>Patient</div><div class="r">Actions</div></div>' + rows +
      '<div class="q-tl-foot"><a data-q-act="viewall">View full queue (' + tickets.filter(function (t) { return isQueued(t.status); }).length + ")</a></div></div>";

    var ai = ins ? '<div class="q-ai"><div class="q-ai-icon">' + ms("auto_awesome") + "</div><div style=\"flex:1\"><h4>AI Insights</h4><p>" + esc(ins.msg) + '</p><button class="q-ai-send" data-q-act="notify:' + esc(ins.t.id) + '">Send notification</button></div><button class="q-ai-x" data-q-act="dismiss">' + ms("close") + "</button></div>" : "";

    var main = '<div class="q-main"><header></header>' + header +
      '<div class="q-canvas">' + kpis +
        '<section class="q-grid">' +
          '<div><h2 class="q-h2">' + ms("play_circle") + "Currently Consulting</h2>" + renderConsult(cur) +
            '<button class="q-pause" data-q-act="pause">' + ms("pause_circle") + (paused ? " Resume Queue" : " Pause Queue") + "</button></div>" +
          '<div class="q-side-col"><h2 class="q-h2">' + ms("view_list", false) + 'Queue Timeline<span class="r">Next ' + Math.min(3, ordered.length) + "</span></h2>" + timeline + ai + "</div>" +
        "</section>" +
      "</div>" +
      '<nav class="q-bottomnav">' + navItem("dashboard", "Queue", true) + navItem("analytics", "Analytics", false) + navItem("settings", "Settings", false) + "</nav>" +
      "</div>";

    return '<div class="q-app">' + side + main + "</div>";
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- API (server-authoritative) ---------------------------------------------------------
  function authHeaders() { var h = { "Content-Type": "application/json" }; try { var t = G.SMD_QUEUE_AUTH && G.SMD_QUEUE_AUTH(); if (t) h.Authorization = "Bearer " + t; } catch (e) {} return h; }
  function apiGet(path) { return fetch(API + path, { headers: authHeaders(), credentials: "include" }).then(function (r) { return r.json(); }); }
  function apiPost(path, body) { return fetch(API + path, { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }

  // ---- controller -------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdQueue"); if (!el) { el = document.createElement("div"); el.id = "smdQueue"; document.body.appendChild(el); } return el; }
  function paint() { root().innerHTML = _render(st); }

  function refresh() {
    if (!st.session) return;
    apiGet("/list?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) { if (r && r.ok) { st.tickets = r.tickets || []; paint(); } }).catch(function () {});
  }
  function act(sessId, path, body) { body = body || {}; body.sessionId = sessId; return apiPost(path, body).then(function (r) { if (r && r.ok && r.tickets) { st.tickets = r.tickets; paint(); } else if (r && r.ok && r.session) { st.session = r.session; paint(); } return r; }); }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-q-act]"); if (!b) return;
    var a = b.getAttribute("data-q-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    var sid = st.session && st.session.id; if (!sid && cmd !== "nav" && cmd !== "dismiss") return;
    if (cmd === "finish") act(sid, "/advance");
    else if (cmd === "start") act(sid, "/status", { ticketId: arg, status: "in_consultation" });
    else if (cmd === "call") act(sid, "/status", { ticketId: arg, status: "called" });
    else if (cmd === "prio") act(sid, "/priority", { ticketId: arg, priority: 2 });
    else if (cmd === "pause") act(sid, "/session/status", { status: st.session.status === "paused" ? "active" : "paused" });
    else if (cmd === "emergency") act(sid, "/session/status", { doctorStatus: st.session.doctorStatus === "emergency" ? "consulting" : "emergency" });
    else if (cmd === "add") openAdd();
    else if (cmd === "dismiss") { var ai = root().querySelector(".q-ai"); if (ai) ai.style.display = "none"; }
    // notify/nav/viewall/docstatus/skip: Phase 2/3
  }

  function openAdd() {
    var name = prompt("Patient name?"); if (name == null) return;
    var mobile = prompt("Mobile (optional)?") || "";
    var vt = (prompt("Visit type: new / followup", "new") || "new").toLowerCase();
    act(st.session.id, "/ticket", { name: name, mobile: mobile, visitType: vt === "followup" ? "followup" : "new", priority: 0 });
  }

  function open(opts) {
    opts = opts || {};
    if (G.SMD_QUEUE_FLAGS && !G.SMD_QUEUE_FLAGS.on()) { try { G.toast && G.toast("Smart OPD Queue is off"); } catch (e) {} return; }
    var el = root(); el.classList.add("on"); el.innerHTML = '<div class="q-empty" style="padding:80px">Loading queue…</div>';
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    var q = "?hospitalId=" + encodeURIComponent(opts.hospitalId || "manual") + "&department=" + encodeURIComponent(opts.department || "") + "&source=" + encodeURIComponent(opts.source || "manual");
    apiGet("/session" + q).then(function (r) {
      if (!r || !r.ok) { el.innerHTML = '<div class="q-empty" style="padding:80px">Queue is being set up.<br><button class="q-pause" style="max-width:200px;margin:16px auto 0" data-q-act="close">Close</button></div>'; return; }
      st.session = r.session; st.tickets = r.tickets || []; st.me = { name: r.session.doctorName, dept: r.session.department }; paint();
      clearInterval(st.pollId); st.pollId = setInterval(refresh, POLL_MS);
    }).catch(function () { el.innerHTML = '<div class="q-empty" style="padding:80px">Could not load the queue.</div>'; });
  }
  function close() { var el = document.getElementById("smdQueue"); if (el) el.classList.remove("on"); clearInterval(st.pollId); }

  G.QUEUE = { open: open, close: close, refresh: refresh, _render: _render, _st: st };

  // Testing launch hook (no nav coupling yet): with the flag on, ?queue=1 auto-opens. The proper
  // sidebar/home tile is a small follow-up. e.g. stewardmd.in/?q=1&queue=1 (preview) or in-app.
  try {
    if (G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.on() && /[?&]queue=1/.test((G.location && G.location.search) || "")) {
      G.addEventListener("DOMContentLoaded", function () { open(); });
    }
  } catch (e) {}
})();
