/* queue.js - Smart OPD Queue doctor dashboard controller (window.QUEUE).
 * Buildless ES5 IIFE, flag-gated (smd_opd_queue). FAITHFUL to the Google Stitch "Clinical Precision"
 * dashboard: _render(state) emits Stitch's exact markup (classes in queue.css) using the app's bundled
 * Material Symbols icon font - no emoji. _render is PURE (state -> HTML) so the demo renders identically.
 * Talks to /api/queue/* (server-authoritative). Realtime = poll (onSnapshot is a later upgrade). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var API = "/api/queue";
  var POLL_MS = 8000;
  var st = { session: null, tickets: [], me: {}, view: "dashboard", analytics: null, config: null, pollId: 0, ghisToken: null, ghisUser: "", ghisDoctorName: "", demo: false, openOpts: {}, pollN: 0, search: "",
    staffTok: "", staffWho: null, board: null };   // front-desk staff session (clinic ID + login + PIN)

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
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
    if (worst && worstWait > 30 * 60000) return { t: worst, msg: (worst.name || "A patient") + " (#" + (worst.mrnLast4 || "-") + ") has waited " + mins(worstWait) + " minutes. Consider notifying the next few patients of the delay." };
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
      : '<span class="q-tl-eta">' + ms(isNext ? "check_circle" : "pending", false) + (isNext ? '' : '') + " ETA: " + (etaMin == null ? "-" : etaMin + "m") + "</span>";
    return '<div class="q-tl-row' + (isNext ? " next" : "") + (late ? " late" : "") + '" data-q-tid="' + esc(t.id) + '">' +
        '<div class="q-pos">' + (idx + 1) + "</div>" +
        '<div class="q-tl-info"><div class="q-tl-nm">' + esc(t.name || "Patient") + '<span class="id">#' + esc(t.mrnLast4 || "") + "</span>" + pri + "</div>" + line + "</div>" +
        '<div class="q-tl-acts">' +
          (t.status !== "called" ? '<button class="q-ic" title="Call" data-q-act="call:' + esc(t.id) + '">' + ms("campaign") + "</button>" : "") +   // an already-called patient can't be re-called (server rejects called->called); show Send-back instead
          (t.status === "called" ? '<button class="q-ic" title="Send back to waiting" data-q-act="sendback:' + esc(t.id) + '">' + ms("undo") + "</button>" : "") +
          '<button class="q-ic" title="Start" data-q-act="start:' + esc(t.id) + '">' + ms("play_arrow") + "</button>" +
          '<button class="q-ic" title="Priority" data-q-act="prio:' + esc(t.id) + '">' + ms("priority_high") + "</button>" +
          '<button class="q-ic q-rm" title="Remove (mistaken / duplicate / wrongly-routed)" data-q-act="remove:' + esc(t.id) + '">' + ms("person_remove") + "</button>" +
          (emrOn() && t.ghisPatientId ? '<button class="q-ic" title="View EMR profile" data-q-act="profile:' + esc(t.id) + '">' + ms("clinical_notes") + "</button>" : "") +
          '<button class="q-ic" title="Assessment + Ask MaiK" data-q-act="assess:' + esc(t.id) + '">' + ms("assignment") + "</button>" +   // every patient gets an Assessment button (clinic + hospital); opens the consult record
        "</div></div>";
  }
  function orderedTickets(state) {
    return (state.tickets || []).slice()
      .filter(function (t) { return isQueued(t.status); })
      .sort(function (a, b) { return (a.position || 99) - (b.position || 99) || (a.registeredAt || 0) - (b.registeredAt || 0); });
  }
  function matchTicket(t, q) {
    return String(t.name || "").toLowerCase().indexOf(q) >= 0 ||
           String(t.mrnLast4 || "").toLowerCase().indexOf(q) >= 0 ||
           String(t.ghisPatientId || "").toLowerCase().indexOf(q) >= 0;
  }
  // Rows for the queue timeline, filtered by the live search box. Position numbers keep the
  // TRUE queue index (a searched patient still shows #12, not #1).
  function timelineRows(state) {
    var ordered = orderedTickets(state);
    var q = (state.search || "").trim().toLowerCase();
    var vis = q ? ordered.filter(function (t) { return matchTicket(t, q); }) : ordered;
    if (!vis.length) return '<div class="q-empty">' + (q ? "No patients match “" + esc(state.search) + "”." : "Queue is empty. Import from Ward Sync or add a patient.") + "</div>";
    return vis.map(function (t) { return ticketRow(t, ordered.indexOf(t), ordered); }).join("");
  }
  function renderConsult(cur) {
    if (!cur) return '<div class="q-consult"><div class="q-empty">' + ms("play_circle") + "<div style=\"margin-top:8px\">No one in consultation. Tap a patient's <b>Start</b> or <b>Finish</b> to advance the queue.</div></div></div>";
    var vt = cur.visitType === "followup" ? "Follow-up" : "New";
    return '<div class="q-consult"><div class="q-consult-b">' +
      '<div class="q-cn"><div><h3>' + esc(cur.name || "Patient") + "</h3>" +
        '<div class="q-cn-meta"><span>' + ms("badge") + " MRN: <span class=\"mono\">" + esc(cur.mrnLast4 || "-") + "</span></span></div></div>" +
        '<div class="q-vt">' + vt + "</div></div>" +
      '<div class="q-cta">' +
        '<div class="q-swipe" id="qSwipe" role="button" aria-label="Swipe to end consultation">' +
          '<div class="q-swipe-fill"></div>' +
          '<span class="q-swipe-txt">Swipe to end consultation</span>' +
          '<div class="q-swipe-knob" id="qSwipeKnob">' + ms("chevron_right") + "</div>" +
        "</div>" +
        '<div class="q-cta-row' + (emrOn() ? "" : " one") + '">' +
          '<button class="q-cta-btn assess" data-q-act="assess:' + esc(cur.id) + '">' + ms("assignment") + "<span>Assessment</span></button>" +   // the in-consult patient always has an Assessment button (shown right after Start/Play)
          '<button class="q-cta-btn" data-q-act="sendback:' + esc(cur.id) + '">' + ms("undo") + "<span>Send back</span></button>" +
          '<button class="q-cta-btn emerg" data-q-act="emergency">' + ms("warning") + "<span>Emergency</span></button>" +
        "</div>" +
      "</div></div></div>";
  }

  function sidebar(view, doctorName, dept) {
    return '<aside class="q-side">' +
      '<div class="q-side-hd"><div class="q-avatar">' + esc(initials(doctorName)) + "</div><div class=\"who\"><b>" + esc(doctorName) + "</b><span>" + esc(dept) + "</span></div></div>" +
      navItem("dashboard", "Dashboard", view === "dashboard") +
      '<button class="q-nav" data-q-act="savedpatients" title="Patients seen (saved)">' + ms("recent_actors") + "<span>Patients</span></button>" +
      navItem("analytics", "Analytics", view === "analytics") +
      navItem("settings", "Settings", view === "settings") + navItem("notifications", "Notifications", false) + "</aside>";
  }
  function dashboardCanvas(state) {
    var s = state.session || {}, tickets = (state.tickets || []).slice();
    var ordered = orderedTickets(state);
    var cur = tickets.filter(function (t) { return t.status === "in_consultation"; })[0] || null;
    var k = computeKpis(tickets), ins = insightFor(tickets), paused = s.status === "paused";
    var kpis = '<section class="q-kpis">' +
      kpi("Patients Waiting", "groups", String(k.waiting), (k.waiting ? ' <span class="q-kpi-trend">' + ms("groups") + " in queue</span>" : "")) +
      kpi("Avg. Wait", "schedule", k.avgWait + "<u>m</u>", "") +
      kpi("Avg. Consultation", "timer", k.avgConsult + "<u>m</u>", "") +
      '<div class="q-kpi"><div class="q-kpi-l"><span>Queue Health</span>' + ms("health_and_safety") + '</div><div class="q-health' + (k.health === "late" ? " late" : "") + '">' + ms(k.health === "late" ? "warning" : "check_circle", true) + (k.health === "late" ? "Running late" : "On Track") + "</div></div>" +
      "</section>";
    var searchBox = ordered.length >= 6 ? '<div class="q-tl-search-wrap">' + ms("search") + '<input class="q-tl-search" type="search" autocomplete="off" autocapitalize="off" placeholder="Search name or ID…" value="' + esc(state.search || "") + '" oninput="try{window.QUEUE&&QUEUE._search&&QUEUE._search(this.value)}catch(e){}"><button class="q-tl-search-x" data-q-act="clearsearch" title="Clear" style="' + (state.search ? "" : "display:none") + '">' + ms("close") + "</button></div>" : "";
    var timeline = '<div class="q-tl"><div class="q-tl-head"><span>Patient</span><span class="r">' + ordered.length + ' in queue</span></div>' + searchBox +
      '<div id="qTlRows">' + timelineRows(state) + "</div></div>";   // the timeline already lists the full ordered queue; the old "View full queue" foot link was a dead no-op
    var ai = ins ? '<div class="q-ai"><div class="q-ai-icon">' + ms("auto_awesome") + "</div><div style=\"flex:1\"><h4>AI Insights</h4><p>" + esc(ins.msg) + '</p></div><button class="q-ai-x" data-q-act="dismiss">' + ms("close") + "</button></div>" : '<div class="q-ai calm"><div class="q-ai-icon">' + ms("check_circle") + '</div><div style="flex:1"><h4>AI Insights</h4><p style="margin:0">Queue is flowing smoothly. No one has waited over 30 minutes.</p></div></div>';   // removed the dead "Send notification" CTA (no handler / no /notify route yet)
    return kpis + '<section class="q-grid"><div><h2 class="q-h2">' + ms("play_circle") + "Currently Consulting</h2>" + renderConsult(cur) +
      '<button class="q-pause" data-q-act="pause">' + ms("pause_circle") + (paused ? " Resume Queue" : " Pause Queue") + "</button></div>" +
      '<div class="q-side-col"><h2 class="q-h2">' + ms("view_list", false) + 'Queue Timeline<span class="r">Next ' + Math.min(3, ordered.length) + "</span></h2>" + timeline + ai + "</div></section>";
  }
  function _render(state) {
    var s = state.session || {}, view = state.view || "dashboard";
    var doctorName = state.ghisDoctorName || (state.ghisToken && state.ghisUser ? ("Dr " + state.ghisUser) : "") || s.doctorName || state.me.name || "Doctor", dept = s.department || state.me.dept || "OPD", paused = s.status === "paused";
    var header = '<header class="q-top"><div class="q-top-in"><button class="q-iconbtn" data-q-act="switch" title="Switch clinic or hospital">' + ms("arrow_back") + '</button><div class="q-brand"><span class="q-logo-mark" aria-hidden="true"></span><span class="q-wordmark">Steward<span>MD</span></span></div><div class="q-top-r">' +
      '<button class="q-online" data-q-act="docstatus"><span class="dot"></span>' + esc(paused ? "Paused" : (s.doctorStatus ? cap(s.doctorStatus) : "System Online")) + "</button>" +
      (view === "dashboard" ? '<button class="q-iconbtn" data-q-act="importopd" title="Refresh queue (imports from the hospital/EMR when one is connected)">' + ms("refresh") + '</button><button class="q-iconbtn" data-q-act="add" title="Add patient">' + ms("person_add") + "</button>" : "") +
      // Avatar is the doctor-profile entry (sign-out + Clinic ID/staff admin live inside it). Tappable for ANY
      // real workplace - GHIS, Connect hospital, or personal clinic - not just GHIS (else clinic doctors could
      // never reach the profile sheet or their staff-admin panel, which renders only for a personal clinic).
      (state.session || state.ghisToken
        ? '<button class="q-avatar q-avatar-btn" data-q-act="docprofile" title="Doctor profile" aria-label="Doctor profile">' + esc(initials(doctorName)) + "</button>"
        : '<div class="q-avatar" title="' + esc(doctorName) + '">' + esc(initials(doctorName)) + "</div>") +
      "</div></div></header>";
    var canvas = view === "analytics" ? analyticsCanvas(state) : view === "settings" ? settingsCanvas(state) : dashboardCanvas(state);
    // "Patients" opens the saved-patients list of the active clinic store (My Clinic device / Shared Clinic
    // Drive) - every patient consulted till now, tap to reopen their consult. It's a launcher, not a view.
    var savedTab = '<button class="q-nav" data-q-act="savedpatients" title="Patients seen (saved on this device / Drive)">' + ms("recent_actors") + "<span>Patients</span></button>";
    var bottom = '<nav class="q-bottomnav">' + navItem("dashboard", "Queue", view === "dashboard") + savedTab + navItem("analytics", "Analytics", view === "analytics") + navItem("settings", "Settings", view === "settings") + "</nav>";
    var main = '<div class="q-main">' + header + '<div class="q-canvas">' + canvas + "</div>" + bottom + "</div>";
    return '<div class="q-app">' + sidebar(view, doctorName, dept) + main + (state.profileOpen ? renderProfile(state, doctorName, dept) : "") + "</div>";
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  // ---- Clinic & staff admin (owner, native clinic): Clinic ID + add nursing/reception/billing with a
  // PIN so they sign in at stewardmd.in/opd. Reuses the live server endpoints (GET /org, GET /members,
  // POST /member [+ /member/pin]); owner authority via STAFF_ADMIN. GHIS/hospital sessions are skipped
  // (staff there are managed in the hospital's own system). ----
  function loadClinicAdmin() {
    if (!st.orgId || st.ghisToken) { st.clinicAdmin = null; return; }
    st.clinicAdmin = st.clinicAdmin || {};
    apiGet("/org?orgId=" + encodeURIComponent(st.orgId)).then(function (r) { if (r && r.ok && r.org) { st.clinicAdmin.code = r.org.code || ""; st.clinicAdmin.name = r.org.name || ""; if (st.profileOpen) paint(); } }).catch(function () {});
    apiGet("/members?orgId=" + encodeURIComponent(st.orgId)).then(function (r) { if (r && r.ok) { st.clinicAdmin.members = r.members || []; if (st.profileOpen) paint(); } }).catch(function () {});
  }
  function roleLabel(r) { return r === "nurse" ? "Nursing" : r === "cashier" ? "Billing" : r === "reception" ? "Reception" : r === "admin" ? "Admin" : r === "doctor" ? "Doctor" : r === "supervisor" ? "Supervisor" : (r || "Staff"); }
  function addStaff() {
    var nameEl = document.getElementById("qStaffName"), roleEl = document.getElementById("qStaffRole"), pinEl = document.getElementById("qStaffPin");
    var identity = ((nameEl && nameEl.value) || "").trim().toLowerCase(), role = (roleEl && roleEl.value) || "nurse", pin = ((pinEl && pinEl.value) || "").trim();   // lowercase so it always matches the staff login (mobile keyboards auto-capitalize; server match is case-sensitive)
    if (!identity) { try { G.toast && G.toast("Enter a login name"); } catch (e) {} return; }
    if (!/^\d{4,6}$/.test(pin)) { try { G.toast && G.toast("PIN must be 4 to 6 digits"); } catch (e) {} return; }
    apiPost("/member", { orgId: st.orgId, identity: identity, role: role }).then(function (r) {
      if (!r || !r.ok) { try { G.toast && G.toast("Could not add staff"); } catch (e) {} return null; }
      return apiPost("/member/pin", { orgId: st.orgId, identity: identity, pin: pin });
    }).then(function (r) {
      if (r && r.ok) { try { G.toast && G.toast("Staff added: " + identity); } catch (e) {} if (nameEl) nameEl.value = ""; if (pinEl) pinEl.value = ""; loadClinicAdmin(); }
    }).catch(function () { try { G.toast && G.toast("Could not add staff"); } catch (e) {} });
  }
  function clinicAdminHtml(state) {
    if (!state.orgId || state.ghisToken) return "";   // only a StewardMD-native clinic the doctor owns
    var ca = state.clinicAdmin || {};
    var code = ca.code ? esc(ca.code) : "loading…";
    var members = ca.members || [];
    var rows = members.length
      ? members.map(function (m) {
          return '<div class="q-staff-row"><div class="q-staff-id"><b>' + esc(m.identity || m.email || "staff") + "</b><span>" + esc(roleLabel(m.role)) + (m.hasPin ? " · PIN set" : " · no PIN") + (m.active === false ? " · disabled" : "") + "</span></div>" +
            '<button class="q-ic q-rm" title="Remove access" data-q-act="staffremove:' + esc(m.identity) + '">' + ms("person_remove") + "</button></div>";
        }).join("")
      : '<div class="q-staff-empty">No team members yet. Add doctors, nursing, reception or billing below.</div>';
    return '<div class="q-profile-sec"><div class="q-sec-h">Clinic &amp; staff</div>' +
      '<div class="q-profile-row q-clinic-id"><span>' + ms("badge") + " Clinic ID</span><b class=\"mono\">" + code + '</b><button class="q-ic" title="Copy Clinic ID" data-q-act="copyclinic:' + code + '">' + ms("content_copy") + "</button></div>" +
      '<div class="q-hint" style="margin:2px 0 10px">Staff sign in at <b>stewardmd.in/opd</b> with this Clinic ID + their login and PIN.</div>' +
      '<div class="q-staff-list">' + rows + "</div>" +
      '<div class="q-staff-add">' +
        '<input id="qStaffName" placeholder="Login name (e.g. nurse1)" autocomplete="off" autocapitalize="none">' +
        '<div class="q-staff-add-r">' +
          '<select id="qStaffRole"><option value="nurse">Nursing</option><option value="reception">Reception</option><option value="cashier">Billing</option><option value="doctor">Doctor</option><option value="supervisor">Supervisor</option></select>' +
          '<input id="qStaffPin" placeholder="PIN (4-6 digits)" inputmode="numeric" maxlength="6">' +
        "</div>" +
        '<button class="q-pbtn" data-q-act="addstaff">' + ms("person_add") + "Add staff</button>" +
      "</div></div>";
  }

  // Doctor profile sheet - opened from the header avatar. Identity + status + switch clinic + sign out.
  function renderProfile(state, doctorName, dept) {
    var s = state.session || {};
    var status = s.doctorStatus ? cap(s.doctorStatus) : (s.status === "paused" ? "Paused" : "Online");
    return '<div class="q-sheet" data-q-act="profile-close"><div class="q-profile" data-q-act="profile-stop">' +
      '<div class="q-profile-top"><div class="q-avatar q-avatar-lg">' + esc(initials(doctorName)) + "</div>" +
      '<div class="q-profile-id"><b>' + esc(doctorName) + "</b><span>" + esc(dept) + "</span></div></div>" +
      (state.ghisUser ? '<div class="q-profile-row">' + ms("badge") + "<span>GHIS ID</span><b>" + esc(state.ghisUser) + "</b></div>" : "") +
      '<div class="q-profile-row">' + ms("stethoscope") + "<span>Status</span><b>" + esc(status) + "</b></div>" +
      clinicAdminHtml(state) +
      '<div class="q-profile-acts">' +
        '<button class="q-pbtn" data-q-act="switch">' + ms("swap_horiz") + "Switch clinic / hospital</button>" +
        (state.ghisToken ? '<button class="q-pbtn danger" data-q-act="logout">' + ms("logout") + "Sign out of GHIS</button>" : "") +
      "</div>" +
      '<button class="q-pbtn ghost" data-q-act="profile-close">Close</button>' +
      "</div></div>";
  }

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
    if (!a) return '<h2 class="q-h2">' + ms("analytics") + 'Performance analytics</h2><div class="q-grid2"><div class="q-card"><div class="q-skel" style="height:44px;width:55%;margin-bottom:12px"></div><div class="q-skel" style="height:13px;width:38%"></div></div><div class="q-card"><div class="q-skel" style="height:120px"></div></div></div>';
    var acc = a.etaAccuracyPct == null ? "-" : a.etaAccuracyPct + "%";
    var tot = a.total || 0;
    var noShowRate = tot ? Math.round((a.noShow / tot) * 100) : 0;      // no-show RATE, not just the count
    var compRate = tot ? Math.round((a.completed / tot) * 100) : 0;     // completion rate
    var kpis = '<section class="q-kpis">' +
      kpi("Seen today", "task_alt", String(a.completed), "") + kpi("Avg. Wait", "schedule", a.avgWaitMin + "<u>m</u>", "") +
      kpi("Avg. Consult", "timer", a.avgConsultMin + "<u>m</u>", "") + kpi("No-show rate", "person_off", noShowRate + "<u>%</u>", "") + "</section>";
    var eta = '<div class="q-card"><div class="q-card-h">' + ms("trending_up") + 'ETA accuracy</div><div class="q-bignum">' + acc + '</div><div class="q-sub">predictions within 10 minutes</div></div>';
    var peak = '<div class="q-card"><div class="q-card-h">' + ms("calendar_month") + "Peak hours (by registration)</div>" + peakChart(a.peakHours) + "</div>";
    var out = '<div class="q-card"><div class="q-card-h">' + ms("insights") + "Outcomes</div>" +
      '<div class="q-out"><span>Patients today</span><b>' + tot + "</b></div>" +
      '<div class="q-out"><span>Completed</span><b>' + a.completed + " (" + compRate + "%)</b></div>" +
      '<div class="q-out"><span>No-show</span><b>' + a.noShow + " (" + noShowRate + "%)</b></div>" +
      '<div class="q-out"><span>Cancelled</span><b>' + a.cancelled + "</b></div>" +
      '<div class="q-out"><span>In queue</span><b>' + a.waiting + "</b></div>" +
      (a.revenueToday != null ? '<div class="q-out"><span>Revenue today</span><b>&#8377;' + a.revenueToday + "</b></div>" : "") +
      (a.followupCompliancePct != null ? '<div class="q-out"><span>Follow-up compliance</span><b>' + a.followupCompliancePct + "%</b></div>" : "") +
      "</div>";
    return '<h2 class="q-h2">' + ms("analytics") + "Performance analytics</h2>" + kpis + '<section class="q-grid2">' + eta + peak + out + "</section>";
  }

  // ---- Settings view (Stitch queue_configuration_settings port) ---------------------------
  function num(k, label, val, hint) { return '<div class="q-fld"><label>' + label + '</label><input type="number" min="1" data-cfg="' + k + '" value="' + esc(val) + '"><span class="q-hint">' + (hint || "") + "</span></div>"; }
  function tog(k, label, val, hint) { return '<div class="q-togrow"><div><div class="q-togl">' + label + "</div>" + (hint ? '<div class="q-hint">' + hint + "</div>" : "") + '</div><label class="q-tog"><input type="checkbox" data-cfg="' + k + '"' + (val ? " checked" : "") + "><span></span></label></div>"; }
  // ---- Case storage (LOCAL device prefs, not server config) ----------------------------------
  // No-MRN OPD patients save to My Clinic on this device (SMD_CLINIC) with encrypted Google Drive
  // backup. These controls flip localStorage immediately (independent of "Save changes").
  function storeAutoSyncOn() { try { return localStorage.getItem("smd_clinic_autosync") !== "0"; } catch (e) { return true; } }
  // Storage MODE for no-MRN cases: ONE clinic, either "device" (My Clinic, this phone) or "shared"
  // (multi-device, encrypted Google Drive sync). My Clinic + Shared Clinic unified behind this switch.
  function opdStorageMode() { try { return localStorage.getItem("smd_opd_storage_mode") === "shared" ? "shared" : "device"; } catch (e) { return "device"; } }
  // Clinic/doctor code - the XXX in a no-MRN patient's SMD-XXX-nnn hospital id. Shared: derived from the
  // clinic id so every device agrees; device: a stable per-phone code.
  function clinicCode() {
    try { if (opdStorageMode() === "shared") { var cfg = JSON.parse(localStorage.getItem("smd_shared_config") || "{}"); if (cfg && cfg.clinicId) { var s = String(cfg.clinicId).replace(/[^a-z0-9]/gi, "").toUpperCase(); return s.slice(-3) || "CLN"; } } } catch (e) {}
    try { var k = "smd_opd_clinic_code", v = localStorage.getItem(k); if (!v) { v = String(Math.random().toString(36).slice(2, 5)).toUpperCase(); localStorage.setItem(k, v); } return v; } catch (e) { return "CLN"; }
  }
  function padSeq(n) { n = String(n); while (n.length < 3) n = "0" + n; return n; }
  // Resolve the active clinic store for no-MRN cases: { store, source, map, needUnlock }.
  function opdClinic() {
    if (opdStorageMode() === "shared") {
      var app = (G.SMD_SHARED && G.SMD_SHARED.app && G.SMD_SHARED.app()) || null;
      if (app) return { store: app, source: "shared", map: "stewardmd.opd.sharedmap" };
      return { store: null, source: "shared", needUnlock: true, map: "stewardmd.opd.sharedmap" };
    }
    return { store: G.SMD_CLINIC, source: "local", map: "stewardmd.opd.localmap" };
  }
  // A toggle row wired to a local action (data-q-act) instead of a server config key. onclick:return false
  // stops the native checkbox flip so the visual is driven purely by `on` on the next paint().
  function localTog(label, on, hint, act) {
    return '<div class="q-togrow" data-q-act="' + act + '"><div><div class="q-togl">' + label + "</div>" +
      (hint ? '<div class="q-hint">' + hint + "</div>" : "") +
      '</div><label class="q-tog"><input type="checkbox"' + (on ? " checked" : "") + ' onclick="return false"><span></span></label></div>';
  }
  function storageCard() {
    if (!emrOn()) return "";   // storage is only meaningful when the EMR/assessment is on
    var shared = opdStorageMode() === "shared";
    var head = '<div class="q-card"><div class="q-card-h">' + ms("cloud_done") + "Case storage</div>" +
      '<div class="q-hint" style="margin:-4px 0 12px">Patients with a hospital MRN save to GHIS. Patients with no MRN get a clinic ID (<b>SMD-' + esc(clinicCode()) + '-nnn</b>) and save to your clinic ' + (shared ? "(synced across your devices)." : "on this device.") + "</div>";
    // ONE clinic, two modes - My Clinic (this device) or Shared Clinic (multi-device sync).
    var sel = '<div class="q-hint" style="margin:2px 0 6px;font-weight:700;color:var(--ink,#0f172a)">Where no-MRN cases are saved</div>' +
      localTog("This device only", !shared, "My Clinic - stays on this phone, encrypted Drive backup", "storagemode:device") +
      localTog("Shared across my devices", shared, "Encrypted, synced to your clinic Google Drive - open on any of your devices", "storagemode:shared");
    var ctrls;
    if (shared) {
      var app = (G.SMD_SHARED && G.SMD_SHARED.app && G.SMD_SHARED.app());
      var status = !app ? "Not unlocked on this device"
        : (app.conflictCount && app.conflictCount() ? (app.conflictCount() + " to review")
          : (app.pendingCount && app.pendingCount() ? (app.pendingCount() + " to sync") : "All synced"));
      ctrls = '<div class="q-hint" style="margin:10px 0 4px">Shared clinic · ' + esc(status) + "</div>" +
        '<button class="q-set-btn" data-q-act="sharedsetup">' + ms("group") + (app ? " Manage shared clinic" : " Set up / unlock shared clinic") + "</button>" +
        (app ? '<button class="q-set-btn" data-q-act="sharedsync" style="margin-top:8px">' + ms("cloud_sync") + " Sync now</button>" : "");
    } else {
      var C = G.SMD_CLINIC;
      var hasPw = !!(C && C.hasPassword && C.hasPassword());
      var autoOn = storeAutoSyncOn();
      ctrls = localTog("Back up all cases to Google Drive", autoOn, autoOn ? "On · every case backs up ~15s after you save" : "Off · back up each case manually", "storagetoggle") +
        (hasPw
          ? '<button class="q-set-btn" data-q-act="storagesync">' + ms("cloud_upload") + " Back up to Drive now</button>"
          : '<button class="q-set-btn" data-q-act="storagesetup">' + ms("lock") + " Set up Google Drive backup</button>");
    }
    return head + sel + ctrls + "</div>";
  }
  // Push My Clinic data (encrypted) to Drive now. Reuses personal-clinic's syncNow (all-patients envelope).
  function storageSyncNow() {
    var C = G.SMD_CLINIC;
    if (!C || !C.syncNow) { try { G.toast && G.toast("Backup unavailable"); } catch (e) {} return; }
    try { G.toast && G.toast("Backing up to Google Drive…"); } catch (e) {}
    C.syncNow().then(function (r) {
      var m = (r && r.ok) ? "Backed up to Google Drive."
        : (r && r.error === "no_password") ? "Set a backup password first."
        : (r && r.error === "no_token") ? "Sign in to Google Drive first." : "Backup failed. Try again.";
      try { G.toast && G.toast(m); } catch (e) {}
      if (r && (r.error === "no_password")) { try { localStorage.setItem("smd_personal_clinic", "1"); } catch (e) {} if (C.open) C.open(); }
      paint();
    });
  }
  function settingsCanvas(state) {
    var c = state.config;
    var head = '<div class="q-set-hd"><h2 class="q-h2" style="margin:0">' + ms("settings") + "Queue configuration</h2>" +
      (c ? '<button class="q-finish" style="font-size:14px;padding:10px 18px" data-q-act="savecfg">' + ms("save") + " Save changes</button>" : "") + "</div>";
    var cfgCards = c
      ? '<div class="q-card"><div class="q-card-h">' + ms("notifications_active") + "Notification triggers</div>" +
          num("early", "Early warning (patients ahead)", c.early, "SMS/WhatsApp when this many are ahead") +
          num("prep", "Preparation alert (patients ahead)", c.prep, "'Please head over' - kept ≤ early") +
          '<div class="q-out"><span>Next-in-line</span><b>Always at position 1</b></div>' +
          tog("smsEnabled", "SMS channel", c.smsEnabled) + tog("waEnabled", "WhatsApp channel", c.waEnabled, "needs a configured provider") +
        "</div>" +
        '<div class="q-card"><div class="q-card-h">' + ms("rule") + "Rule engine</div>" +
          num("noShowTimeoutMin", "Auto no-show timeout (min)", c.noShowTimeoutMin, "after 'called', offer no-show") +
          num("defaultConsultMin", "Default consult (min)", c.defaultConsultMin, "used before ETA learning kicks in") +
          tog("etaLearning", "ETA learning", c.etaLearning, "learn this doctor's consult durations") +
        "</div>"
      : '<div class="q-card"><div class="q-skel" style="height:16px;width:50%;margin-bottom:16px"></div><div class="q-skel" style="height:44px;margin-bottom:10px"></div><div class="q-skel" style="height:44px;margin-bottom:10px"></div><div class="q-skel" style="height:44px"></div></div>';
    return head + '<section class="q-grid2">' + storageCard() + cfgCards + "</section>";
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
  // ---- front-desk staff session -----------------------------------------------------------------
  // A receptionist/nurse has no Firebase account: they sign in with the clinic ID + their login + PIN
  // and the server mints an ORG-BOUND staff token. Until now the app only ever sent a Firebase token,
  // which is why "I'm front-desk staff" could only point at the web console.
  var LS_STAFF = "smd_opd_staff_tok";
  function staffTok() { if (st.staffTok) return st.staffTok; try { st.staffTok = localStorage.getItem(LS_STAFF) || ""; } catch (e) {} return st.staffTok; }
  function setStaffTok(t) { st.staffTok = t || ""; try { if (t) localStorage.setItem(LS_STAFF, t); else localStorage.removeItem(LS_STAFF); } catch (e) {} }
  function staffCan(cap) { return !!(st.staffWho && st.staffWho.caps && st.staffWho.caps.indexOf(cap) > -1); }
  // A staff token wins when present: it is how the server knows this is reception, not the doctor.
  function authHeaders() {
    var t = staffTok();
    if (t) return Promise.resolve({ "Content-Type": "application/json", "X-Staff-Token": t });
    return fbToken().then(function (t2) { var h = { "Content-Type": "application/json" }; if (t2) h.Authorization = "Bearer " + t2; return h; });
  }
  // Retry transient network/DNS failures (e.g. a momentary "Unable to resolve host" right after app launch or a
  // WiFi/data switch) so the app self-heals and users NEVER touch WiFi/DNS settings. Only retries a REJECTED
  // fetch (network error) - never an HTTP error status. 3 tries with ~0.7s backoff.
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
  // Swipe-to-end control on the Currently Consulting card. Rebound after each full paint;
  // move/up listeners live only during an active drag (added on down, removed on up) so no leak.
  function initConsultSwipe() {
    var track = document.getElementById("qSwipe"), knob = document.getElementById("qSwipeKnob");
    if (!track || !knob) return;
    var fill = track.querySelector(".q-swipe-fill");
    var startX = 0, curX = 0, maxX = 0, dragging = false;
    var DONE = 0.85;   // ponytail: fraction of the track that counts as "ended"; raise if mis-fires
    function px(e) { return e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX; }
    function move(e) {
      if (!dragging) return;
      curX = Math.max(0, Math.min(maxX, px(e) - startX));
      knob.style.transform = "translateX(" + curX + "px)";
      if (fill) fill.style.width = (curX + knob.offsetWidth + 4) + "px";
      track.classList.toggle("armed", !!maxX && curX / maxX > DONE);
      if (e.cancelable) e.preventDefault();
    }
    function up() {
      if (!dragging) return; dragging = false;
      document.removeEventListener("touchmove", move); document.removeEventListener("touchend", up);
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      knob.style.transition = ""; if (fill) fill.style.transition = "";
      if (maxX && curX / maxX > DONE) { knob.style.transform = "translateX(" + maxX + "px)"; try { if (st.session) act(st.session.id, "/advance"); } catch (e) {} }
      else { curX = 0; knob.style.transform = "translateX(0)"; if (fill) fill.style.width = ""; track.classList.remove("armed"); }
    }
    function down(e) {
      dragging = true; maxX = track.clientWidth - knob.offsetWidth - 8; startX = px(e) - curX;
      knob.style.transition = "none"; if (fill) fill.style.transition = "none";
      document.addEventListener("touchmove", move, { passive: false }); document.addEventListener("touchend", up);
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      if (e.cancelable) e.preventDefault();
    }
    knob.addEventListener("touchstart", down, { passive: false });
    knob.addEventListener("mousedown", down);
  }
  function paint() {
    var r = root();
    // While the user is typing in search, DON'T rebuild the DOM - a full innerHTML swap blurs
    // the input and closes the Android soft keyboard. Refresh only the filtered rows in place.
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("q-tl-search")) {
      var box = document.getElementById("qTlRows"); if (box) box.innerHTML = timelineRows(st);
      return;
    }
    // Preserve scroll across the 8s poll repaint (rebuild otherwise yanks the list to the top).
    var prev = r.querySelector(".q-canvas"), top = prev ? prev.scrollTop : 0;
    r.innerHTML = _render(st);
    var next = r.querySelector(".q-canvas"); if (next && top) next.scrollTop = top;
    try { initConsultSwipe(); } catch (e) {}
  }

  function refresh() {
    if (st.demo || !st.session || st.view === "settings") return;   // demo has no server session; don't clobber unsaved settings mid-poll
    st.pollN = (st.pollN || 0) + 1;
    // real-time-ish sync: silently re-pull today's GHIS Out-patients list every ~5 polls (~40s) so newly
    // registered patients appear without a manual import (dedupes server-side by visit id).
    if (st.ghisToken && st.pollN % 5 === 0 && (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool || G.SMD_QUEUE_FLAGS.bool("smd_opd_queue_import"))) { try { importOpd(true); } catch (e) {} }
    if (st.openOpts && st.openOpts.source === "connect" && st.pollN % 5 === 0) { try { importFromSource(true); } catch (e) {} }   // re-pull the connected EMR worklist periodically
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

  // Copy to clipboard that works on Android/iOS WebViews AND degrades honestly: the async clipboard API
  // rejects in insecure/older WebViews, so we .catch() (never leak an unhandled rejection) and fall back to
  // a hidden-textarea execCommand copy. The toast reflects what actually happened - no false "copied".
  function legacyCopy(s) {
    try { var ta = document.createElement("textarea"); ta.value = s; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); var okc = document.execCommand && document.execCommand("copy"); document.body.removeChild(ta); return !!okc; } catch (e) { return false; }
  }
  function copyText(s) {
    function done(okc) { try { G.toast && G.toast(okc ? "Clinic ID copied" : "Could not copy - long-press to select it"); } catch (e) {} }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(function () { done(true); }, function () { done(legacyCopy(s)); }); return; } } catch (e) {}
    done(legacyCopy(s));
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-q-act]"); if (!b) return;
    var a = b.getAttribute("data-q-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "clearsearch") { st.search = ""; paint(); return; }
    if (cmd === "chooser") { _setWp(""); root().innerHTML = _chooseType(); return; }     // back to Hospital / Personal clinic (forgets remembered workplace)
    if (cmd === "docprofile") { st.profileOpen = true; paint(); loadClinicAdmin(); return; }
    if (cmd === "copyclinic") { copyText(arg); return; }
    if (cmd === "addstaff") { addStaff(); return; }
    if (cmd === "staffremove") { var okrm = true; try { okrm = window.confirm("Remove this staff member's access?"); } catch (e) {} if (okrm) apiPost("/member", { orgId: st.orgId, identity: arg, remove: true }).then(function () { loadClinicAdmin(); }); return; }
    if (cmd === "profile-close") { st.profileOpen = false; paint(); return; }
    if (cmd === "profile-stop") return;   // click inside the profile card: do nothing (don't close)
    if (cmd === "switch") { _setWp(""); clearInterval(st.pollId); st.session = null; st.tickets = []; st.demo = false; st.ghisToken = null; st.profileOpen = false; st.orgId = null; st.clinicAdmin = null; root().innerHTML = _chooseType(); return; }  // dashboard back -> switch workplace (forget remembered); drop clinic identity so the next workplace never shows a stale clinic's staff-admin
    if (cmd === "typehosp") { _listHospitals(); return; }                               // Hospital -> pick a connected hospital
    if (cmd === "typeclinic") { _listClinics(); return; }                               // Personal clinic -> pick one
    if (cmd === "rolestaff") { root().innerHTML = _staffGate(); prefillStaff(); return; }   // front-desk staff -> sign in HERE
    if (cmd === "pickghis") { _setWp("ghis"); _enterGhis(); return; }  // GITAM / GHIS: reuse a live token if present (no needless re-login), else the prefilled gate
    if (cmd === "pickhosp") { _setWp("connect:" + arg); st.ghisToken = null; st.openOpts = { hospitalId: arg, source: "connect" }; loadSession(); return; }   // EMR-Connect hospital: worklist model (auto-import from the connected EMR, like GHIS). Drop any GHIS token: not a GHIS session.
    if (cmd === "pickclinic") { _setWp("clinic:" + arg); st.ghisToken = null; startClinic(arg); return; }     // a personal clinic (remembered so re-opening returns here, not GHIS). Drop any GHIS token: not a GHIS session.
    if (cmd === "pickroom") { var pr = arg.split("~"); loadRoom(pr[0], pr[1] || ""); return; }   // doctor picked their room
    if (cmd === "newclinic") { try { window.open("https://stewardmd.in/opd", "_blank"); } catch (e) { try { location.href = "https://stewardmd.in/opd"; } catch (x) {} } return; }
    if (cmd === "addhosp") { try { window.open("https://stewardmd.in/admin/connect-emr", "_blank"); } catch (e) { try { location.href = "https://stewardmd.in/admin/connect-emr"; } catch (x) {} } return; }  // reuse the Connect EMR onboarding wizard
    if (cmd === "openconsole") { try { window.open("https://stewardmd.in/opd", "_blank"); } catch (e) { try { location.href = "https://stewardmd.in/opd"; } catch (x) {} } return; }
    if (cmd === "stafflogin") { staffLogin(); return; }
    if (cmd === "staffout") { setStaffTok(""); st.staffWho = null; st.board = null; clearInterval(st.pollId); root().innerHTML = _chooseType(); return; }
    if (cmd === "fdrefresh") { loadFrontDesk(); return; }
    if (cmd === "fdadd") { frontDeskAdd(); return; }
    if (cmd === "fdroute") { frontDeskRoute(arg); return; }
    if (cmd === "ghislogin") { ghisLogin(); return; }
    if (cmd === "demo") { demo(); return; }
    if (cmd === "logout") { doLogout(); return; }
    if (cmd === "retry") { loadSession(); return; }
    // Case-storage prefs are LOCAL (device) - work with no session and in demo, and never touch the server.
    if (cmd === "storagetoggle") { try { localStorage.setItem("smd_clinic_autosync", storeAutoSyncOn() ? "0" : "1"); } catch (e) {} paint(); return; }
    if (cmd === "storagesync") { storageSyncNow(); return; }
    if (cmd === "storagesetup") { try { localStorage.setItem("smd_personal_clinic", "1"); } catch (e) {} if (G.SMD_CLINIC && G.SMD_CLINIC.open) G.SMD_CLINIC.open(); return; }
    if (cmd === "storagemode") { try { localStorage.setItem("smd_opd_storage_mode", arg === "shared" ? "shared" : "device"); if (arg === "shared") localStorage.setItem("smd_shared_clinic", "1"); } catch (e) {} if (arg === "shared" && !(G.SMD_SHARED && G.SMD_SHARED.app && G.SMD_SHARED.app()) && G.SMD_SHARED && G.SMD_SHARED.open) G.SMD_SHARED.open(); paint(); return; }
    if (cmd === "sharedsetup") { try { localStorage.setItem("smd_shared_clinic", "1"); } catch (e) {} if (G.SMD_SHARED && G.SMD_SHARED.open) G.SMD_SHARED.open(); return; }
    if (cmd === "sharedsync") { var _sa = (G.SMD_SHARED && G.SMD_SHARED.app && G.SMD_SHARED.app()); if (_sa && _sa.syncNow) { try { G.toast && G.toast("Syncing…"); } catch (e) {} Promise.resolve(_sa.syncNow()).then(function () { paint(); }); } return; }
    if (cmd === "savedpatients") {   // open the active clinic's saved-patients list (My Clinic device / Shared Clinic Drive)
      if (opdStorageMode() === "shared") { try { localStorage.setItem("smd_shared_clinic", "1"); } catch (e) {} if (G.SMD_SHARED && G.SMD_SHARED.open) G.SMD_SHARED.open(); else { try { G.toast && G.toast("Shared Clinic loading…"); } catch (e) {} } }
      else { try { localStorage.setItem("smd_personal_clinic", "1"); } catch (e) {} if (G.SMD_CLINIC && G.SMD_CLINIC.open) G.SMD_CLINIC.open(); else { try { G.toast && G.toast("My Clinic loading…"); } catch (e) {} } }
      return;
    }
    /* This used to `return` SILENTLY when there was no session, which is how Add patient became a
     * dead button: no sheet, no toast, no reason given. A blocked command must never fail mute.
     * "add" is now exempt from the session requirement outright - registering a patient is exactly
     * what you do before the queue has anyone in it - and openAdd()/onAdded handle a missing session
     * themselves, so the check-in sheet always opens. */
    var sid = st.session && st.session.id;
    if (!sid && cmd !== "nav" && cmd !== "dismiss" && cmd !== "savecfg" && cmd !== "add") {
      try { G.toast && G.toast("Your queue session has not started yet. Reopen OPD Queue to begin."); } catch (e) {}
      return;
    }
    if (st.demo && cmd !== "nav" && cmd !== "dismiss") { try { G.toast && G.toast("Demo mode - sign in to GHIS to manage a real queue."); } catch (e) {} return; }
    if (cmd === "nav") { switchView(arg); return; }
    if (cmd === "savecfg") { saveCfg(); return; }
    if (cmd === "finish") act(sid, "/advance");
    else if (cmd === "start") {
      // Start consult -> straight into the Initial Assessment (the consult record). If another patient is
      // still in the room (currentTicketId), send THEM back to waiting first so they are never stranded
      // (a second Start used to overwrite currentTicketId, leaving the first consult open + invisible forever).
      var curId = st.session && st.session.currentTicketId;
      var startGo = function () { act(sid, "/status", { ticketId: arg, status: "in_consultation" }); openAssessment(arg); };
      if (curId && curId !== arg) act(sid, "/status", { ticketId: curId, status: "waiting" }).then(startGo); else startGo();
    }
    else if (cmd === "call") act(sid, "/status", { ticketId: arg, status: "called" });
    else if (cmd === "sendback") act(sid, "/status", { ticketId: arg, status: "waiting" });   // reroute from the consulting room back to the waiting hall (personal + hospital)
    else if (cmd === "prio") { var pt = (st.tickets || []).filter(function (x) { return x.id === arg; })[0]; act(sid, "/priority", { ticketId: arg, priority: (pt && pt.priority) ? 0 : 1 }); }   // toggle Priority (1) on/off; matches the "Priority" label + is reversible (does NOT set Emergency/2)
    else if (cmd === "remove") { var okr = true; try { okr = window.confirm("Remove this patient from your queue?\n\nUse for a mistaken, duplicate, or wrongly-routed entry. Recorded in the audit trail."); } catch (e) {} if (okr) act(sid, "/status", { ticketId: arg, status: "cancelled" }); }
    else if (cmd === "pause") act(sid, "/session/status", { status: st.session.status === "paused" ? "active" : "paused" });
    else if (cmd === "emergency") act(sid, "/session/status", { doctorStatus: st.session.doctorStatus === "emergency" ? "consulting" : "emergency" });
    else if (cmd === "importopd") importOpd();
    else if (cmd === "profile") openEmrProfile(arg);
    else if (cmd === "assess") openAssessment(arg);
    else if (cmd === "add") openAdd();
    else if (cmd === "dismiss") { var ai = root().querySelector(".q-ai"); if (ai) ai.style.display = "none"; }
    // notify/nav/viewall/docstatus/skip: Phase 2/3
  }

  // The header button is CONTEXT-AWARE. Personal clinic (no GHIS token, not a Connect worklist): it is a
  // plain Refresh - re-pull the server queue so a reception-added patient shows at once (no GHIS login).
  // Connected EMR (Connect worklist): re-pull the connector worklist. GHIS workplace: import today's GHIS
  // OPD list. Never sends a personal-clinic doctor to a GHIS login.
  function importOpd(silent) {
    if (!st.session) return;
    var say = function (m) { if (silent) return; try { G.toast && G.toast(m); } catch (e) {} };
    if (st.openOpts && st.openOpts.source === "connect") { importFromSource(silent); return; }
    if (!st.ghisToken) {   // personal clinic -> Refresh only (the 8s poll already auto-syncs; this is the manual tap)
      say("Refreshing queue…");
      apiGet("/list?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) {
        if (r && r.ok) { st.tickets = r.tickets || []; paint(); say("Queue refreshed"); } else { say("Could not refresh"); }
      }).catch(function () { say("Could not refresh"); });
      return;
    }
    say("Importing today's OPD list…");
    var gh = { "Content-Type": "application/json" }; gh.Authorization = "Bearer " + st.ghisToken;
    fetchRetry("/api/ghis/opd-patients", { headers: gh, credentials: "include" }).then(function (r) { return r.json(); }).then(function (r) {
      if (r && r.error === "login_required") { ghisReauth(); return; }   // expired -> silent re-login from remembered cred, else the gate (no manual sign-out)
      var rows = (r && r.rows) || [];
      if (!rows.length) { say("No OPD patients found for today"); return; }
      act(st.session.id, "/import", { rows: rows }).then(function (res) { if (res && res.ok && res.imported) { say("Imported " + res.imported + " patient(s)"); } });
    }).catch(function () { say("Could not reach Ward Sync"); });
  }
  // ONE decision point for "open this ticket's record". The WORKPLACE decides which EMR - never whether
  // an MR number happens to be filled in.
  //
  // BUGFIX (2026-08-24): openAdd() asks for an "MR number" in EVERY workplace and the server stores
  // whatever is typed as ghisPatientId (functions/_queue_engine.js), so a personal-clinic patient given
  // the clinic's own file number took the GHIS branch. That branch passed NO `source`, opd-emr defaulted
  // it to "ghis", GHIS.ensureSession() found no token (a clinic session nulls it - INVARIANT) and Ward
  // Sync slid its GIMSR hospital-picker / sign-in over the queue AND returned, so Start never opened the
  // assessment at all. Leaving the MRN blank happened to work, which is why it looked intermittent.
  // Worse than the redirect: with a LIVE Ward Sync token it would have opened the hospital record for a
  // personal-clinic patient - a wrong-record risk.
  function inClinicWorkplace() { return !!st.orgId; }   // loadRoom() sets orgId; loadSession() clears it for GHIS/Connect
  function openTicketEmr(ticketId, tab) {
    var t = null; for (var i = 0; i < st.tickets.length; i++) { if (st.tickets[i].id === ticketId) { t = st.tickets[i]; break; } }
    if (!t || !G.OPDEMR || !G.OPDEMR.openProfile) return;
    var o = { name: t.name || "", ticketId: t.id, sessionId: st.session && st.session.id };
    if (tab) o.tab = tab;
    // Hospital workplace (GHIS / Connect) with a real hospital id -> the hospital record.
    if (t.ghisPatientId && !inClinicWorkplace()) {
      o.patientId = t.ghisPatientId || t.mrn || "";
      o.episodeId = t.ghisEpisodeId || t.visitId || "";
      o.visitId = t.visitId || t.ghisEpisodeId || "";
      G.OPDEMR.openProfile(o);
      return;
    }
    // Personal / shared clinic -> the on-device record. Never touches GHIS.
    var oc = opdClinic();
    if (oc.needUnlock) { try { G.toast && G.toast("Unlock your Shared Clinic to save this case."); } catch (e) {} if (G.SMD_SHARED && G.SMD_SHARED.open) G.SMD_SHARED.open(); return; }
    var store = oc.store;
    if (store && store.addPatient && store.localStore) {
      var pid = localClinicId(t, store, oc.map);
      var rec = (store.getPatient && store.getPatient(pid)) || {};
      o.source = oc.source; o.localStore = store.localStore; o.patientId = pid; o.displayId = rec.mrn || "";
      o.author = st.ghisDoctorName || (st.session && st.session.doctorName) || (st.me && st.me.name) || "Doctor";
      G.OPDEMR.openProfile(o);
      return;
    }
    o.noStore = true;                 // no local store on this device: decision-support only, nothing saved
    G.OPDEMR.openProfile(o);
  }
  // View EMR profile (flag smd_opd_emr) and Start-consult both route through openTicketEmr.
  function openEmrProfile(ticketId) { openTicketEmr(ticketId, ""); }
  // Find-or-create the on-device My Clinic record for an OPD ticket (keyed by ticket id, so re-opening
  // the same patient reuses their record instead of creating a duplicate each time).
  function localClinicId(t, store, mapKey) {
    var MAP = mapKey || "stewardmd.opd.localmap", map = {};
    try { map = JSON.parse(localStorage.getItem(MAP) || "{}") || {}; } catch (e) {}
    var id = map[t.id];
    if (id && store.getPatient && store.getPatient(id)) return id;
    // Assign a stable hospital-style id for this no-MRN patient: SMD-<clinic code>-<seq>.
    var seq = padSeq((((store.listPatients && store.listPatients()) || []).length) + 1);
    var mrn = "SMD-" + clinicCode() + "-" + seq;
    id = store.addPatient({ name: t.name || "Patient", mrn: mrn });
    map[t.id] = id; try { localStorage.setItem(MAP, JSON.stringify(map)); } catch (e) {}
    return id;
  }
  // Open the Initial Assessment (+ Ask MaiK) for this patient (EMR overlay, "assess" tab).
  function openAssessment(ticketId) { openTicketEmr(ticketId, "assess"); }
  function openAdd() {
    // The check-in sheet (patient-register.js) is shared with the staff web console, so the two can
    // never drift apart again. It replaced four sequential prompt() boxes. The SERVER validates and
    // issues the MR number - this only carries the answers and renders the field errors it returns.
    if (!(G.SMD_PATIENTREG && G.SMD_PATIENTREG.open)) { toast("Patient check-in is unavailable on this build."); return; }
    var mode = inClinicWorkplace() ? "native" : (st.ghisToken ? "ghis" : ((st.openOpts && st.openOpts.source === "connect") ? "connect" : "native"));
    G.SMD_PATIENTREG.open({
      mode: mode,
      clinicName: (st.me && st.me.name) || (st.session && st.session.doctorName) || "Check-in",
      submit: function (body) {
        body.orgId = st.orgId || st.hospital || "";
        body.workplaceMode = mode;
        return apiPost("/patient/register", body);
      },
      onAdded: function (r) {
        // Registered -> put them in THIS doctor's queue with the identity we just created.
        // The session is re-read HERE, not captured above: the sheet can be open for a while, and
        // reaching straight into st.session.id threw when there was no session, losing a patient who
        // had just been registered on the server with no word to the doctor either way.
        var sid2 = st.session && st.session.id;
        if (!sid2) {
          try { G.toast && G.toast("Patient registered. Reopen OPD Queue to add them to today's list."); } catch (e) {}
          return;
        }
        act(sid2, "/ticket", {
          name: r.patient && r.patient.name, mrn: r.mrn, mobile: r.patient && r.patient.mobile,
          visitType: (r.patient && r.patient.visitType) === "followup" ? "followup" : "new", priority: 0
        });
      }
    });
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
      var rows = '<button class="q-gate-btn" style="text-align:left" data-q-act="pickghis">' + ms("local_hospital") + " GITAM - GHIS<br><small style=\"opacity:.85;font-weight:400\">Hospital EMR · Ward Sync</small></button>";
      ((r && r.orgs) || []).filter(function (o) { return o.mode === "connect" && o.connectorId; }).forEach(function (o) {   // only real EMR-connected hospitals (a connect org with no connector is malformed, never shown)
        rows += '<button class="q-gate-btn" style="text-align:left;margin-top:10px" data-q-act="pickhosp:' + esc(o.id) + '">' + ms("local_hospital") + " " + esc(o.name || "Hospital") + "<br><small style=\"opacity:.85;font-weight:400\">" + esc(o.code || "") + " · EMR-connected</small></button>";
      });
      rows += '<button class="q-gate-btn" style="margin-top:12px;background:#f1f5f9;color:#0f172a" data-q-act="addhosp">' + ms("add_business") + " Add hospital (Connect EMR)</button>";
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
      }).join("") : '<p class="q-gate-sub">No personal clinic yet - set one up in the console.</p>';
      el.innerHTML = _wrap('<p class="q-gate-sub">Choose your clinic.</p>' + rows + '<button class="q-gate-btn" style="margin-top:12px;background:#f1f5f9;color:#0f172a" data-q-act="newclinic">' + ms("add") + " New clinic (in console)</button><button class=\"q-gate-close\" data-q-act=\"chooser\">Back</button>");
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  // The old dead end: a note telling front-desk staff to go and use the web console, behind a button
  // that called window.open(_blank) - which a Capacitor WKWebView silently ignores, so it did nothing
  // at all. Front desk now signs in and works here.
  function _staffGate(err) {
    return _wrap('<p class="q-gate-sub">Front-desk sign in. Ask your clinic for the Clinic ID.</p>' +
      '<input id="qFdOrg" class="q-gate-in" type="text" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Clinic ID (SMD-XXXXXX)">' +
      '<input id="qFdUser" class="q-gate-in" type="text" autocomplete="username" autocapitalize="off" autocorrect="off" placeholder="Your login (e.g. nurse1)">' +
      '<input id="qFdPin" class="q-gate-in" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN">' +
      '<div class="q-gate-err">' + (err ? esc(err) : "") + "</div>" +
      '<button class="q-gate-btn" data-q-act="stafflogin">Sign in</button>' +
      '<button class="q-gate-close" data-q-act="chooser">Back</button>');
  }
  function prefillStaff() {
    setTimeout(function () {
      try {
        var o = document.getElementById("qFdOrg"), last = localStorage.getItem("smd_opd_staff_org") || "";
        if (o && last) o.value = last;
        var f = document.getElementById(last ? "qFdUser" : "qFdOrg"); if (f) f.focus();
      } catch (e) {}
    }, 60);
  }
  function staffLogin() {
    var org = "", user = "", pin = "";
    try {
      org = (document.getElementById("qFdOrg") || {}).value || "";
      user = (document.getElementById("qFdUser") || {}).value || "";
      pin = (document.getElementById("qFdPin") || {}).value || "";
    } catch (e) {}
    org = org.trim(); user = user.trim(); pin = pin.trim();
    if (!org || !user || !pin) { root().innerHTML = _staffGate("Enter the Clinic ID, your login and your PIN."); prefillStaff(); return; }
    root().innerHTML = '<div class="q-empty" style="padding:80px">Signing in…</div>';
    fetchRetry(API + "/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clinicCode: org, identity: user, pin: pin }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok || !r.token) {
          var msg = (r && r.error === "locked") ? "Too many attempts. Try again shortly."
            : (r && r.error === "staff_disabled") ? "Staff sign-in is not enabled for this clinic."
            : "Wrong Clinic ID, login or PIN.";
          root().innerHTML = _staffGate(msg); prefillStaff(); return;
        }
        setStaffTok(r.token);
        try { localStorage.setItem("smd_opd_staff_org", org); } catch (e) {}
        st.orgId = r.orgId || "";
        _setWp("");                     // a staff session is not a doctor workplace
        loadFrontDesk();
      })
      .catch(function () { root().innerHTML = _staffGate("Could not reach the server. Check your connection."); prefillStaff(); });
  }

  // ---- front desk: the whole clinic at a glance ---------------------------------------------------
  // Mirrors the web console's nurse station using the SAME endpoints (whoami -> caps, opd-board ->
  // rooms + pool, pool -> register, assign-room -> route). No new server work.
  function loadFrontDesk() {
    var el = root();
    el.innerHTML = '<div class="q-empty" style="padding:80px">Loading the front desk…</div>';
    apiGet("/whoami").then(function (w) {
      if (!w || !w.ok) { setStaffTok(""); root().innerHTML = _staffGate("Your session ended. Sign in again."); prefillStaff(); return; }
      st.staffWho = w; st.orgId = w.orgId || st.orgId || "";
      if (!st.orgId) { el.innerHTML = _wrap('<p class="q-gate-sub">You are not assigned to a clinic yet. Ask the clinic owner to add you.</p><button class="q-gate-close" data-q-act="staffout">Back</button>'); return; }
      return apiGet("/opd-board?orgId=" + encodeURIComponent(st.orgId)).then(function (b) {
        if (!b || !b.ok) { el.innerHTML = _wrap('<p class="q-gate-sub">Could not load the clinic board.</p><button class="q-gate-btn" data-q-act="fdrefresh">Retry</button><button class="q-gate-close" data-q-act="staffout">Sign out</button>'); return; }
        st.board = b;
        el.innerHTML = renderFrontDesk(b);
        clearInterval(st.pollId);
        st.pollId = setInterval(function () {
          apiGet("/opd-board?orgId=" + encodeURIComponent(st.orgId)).then(function (n) {
            if (n && n.ok) { st.board = n; var e2 = root(); if (e2 && e2.querySelector(".q-fd")) e2.innerHTML = renderFrontDesk(n); }
          }).catch(function () {});
        }, POLL_MS);
      });
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-btn" data-q-act="fdrefresh">Retry</button>'); });
  }

  function renderFrontDesk(b) {
    var who = st.staffWho || {}, rooms = (b && b.rooms) || [], pool = (b && b.pool) || [];
    var canAdd = staffCan("queue.add"), canAssign = staffCan("queue.assign");
    var head = '<div class="q-fd-top"><div><h2 class="q-h2" style="margin:0">' + ms("badge") + "Front desk</h2>" +
      '<div class="q-hint">' + esc(who.name || "Staff") + " &middot; " + esc(who.role || "viewer") + (who.orgCode ? " &middot; " + esc(who.orgCode) : "") + "</div></div>" +
      '<button class="q-pause" style="width:auto;padding:8px 14px" data-q-act="staffout">Sign out</button></div>';

    var waitingTotal = rooms.reduce(function (n, r) { return n + (r.waiting || 0); }, 0);
    var kpis = '<section class="q-kpis">' +
      kpi("Waiting", "groups", String(waitingTotal), "") +
      kpi("Unassigned", "help", String(pool.length), "") +
      kpi("Rooms", "door_front", String(rooms.length), "") + "</section>";

    var roomCards = rooms.length ? rooms.map(function (r) {
      var rm = r.room || {}, unavailable = r.status === "unavailable";
      return '<div class="q-card"><div class="q-card-h">' + ms("door_front") + esc(rm.name || "Room") +
        (rm.number ? ' <span class="q-hint">#' + esc(rm.number) + "</span>" : "") + "</div>" +
        '<div class="q-out"><span>' + (unavailable ? "No doctor assigned" : "Waiting") + "</span><b>" +
        (unavailable ? "&mdash;" : r.waiting) + "</b></div>" +
        (rm.department ? '<div class="q-hint">' + esc(rm.department) + "</div>" : "") + "</div>";
    }).join("") : '<div class="q-empty">No rooms set up yet. The clinic owner adds rooms in the console.</div>';

    var poolRows = pool.length ? pool.map(function (t) {
      return '<div class="q-fd-row"><div><b>' + esc(t.name || "Patient") + "</b>" +
        '<div class="q-hint">' + esc(t.mrnLast4 ? "MRN ..." + t.mrnLast4 : "No MRN") + " &middot; " + esc(t.visitType === "followup" ? "Follow-up" : "New") + "</div></div>" +
        (canAssign ? '<button class="q-pause" style="width:auto;padding:8px 12px" data-q-act="fdroute:' + esc(t.id) + '">Route</button>' : "") +
        "</div>";
    }).join("") : '<div class="q-empty" style="padding:22px">Nobody waiting to be routed.</div>';

    return '<div class="q-fd">' + head + kpis +
      (canAdd ? '<button class="q-gate-btn" style="margin:4px 0 14px" data-q-act="fdadd">' + ms("person_add") + " Add patient</button>" : "") +
      '<h2 class="q-h2">' + ms("meeting_room") + "Rooms</h2><div class=\"q-grid2\">" + roomCards + "</div>" +
      '<h2 class="q-h2">' + ms("groups") + "Waiting to be routed</h2>" + poolRows +
      '<div style="height:24px"></div></div>';
  }

  // Add a patient from the front desk: the SAME ABDM-ready check-in sheet the doctor uses, then into
  // the central pool (a one-room clinic auto-routes server-side).
  function frontDeskAdd() {
    if (!(G.SMD_PATIENTREG && G.SMD_PATIENTREG.open)) { toast("Patient check-in is unavailable on this build."); return; }
    G.SMD_PATIENTREG.open({
      mode: "native",
      clinicName: (st.staffWho && st.staffWho.orgCode) || "Check-in",
      submit: function (body) { body.orgId = st.orgId; body.workplaceMode = "native"; return apiPost("/patient/register", body); },
      onAdded: function (r) {
        apiPost("/pool", { orgId: st.orgId, name: r.patient && r.patient.name, mobile: r.patient && r.patient.mobile,
          mrn: r.mrn, visitType: (r.patient && r.patient.visitType) === "followup" ? "followup" : "new" })
          .then(function () { toast("Added - " + r.mrn); loadFrontDesk(); });
      }
    });
  }

  // Route a pooled patient into a room. Only rooms that actually have a doctor can receive one.
  function frontDeskRoute(ticketId) {
    var rooms = ((st.board && st.board.rooms) || []).filter(function (r) { return r.status !== "unavailable"; });
    if (!rooms.length) { toast("No room has a doctor assigned yet."); return; }
    if (rooms.length === 1) { doRoute(ticketId, rooms[0].room.id); return; }
    var names = rooms.map(function (r, i) { return (i + 1) + ". " + (r.room.name || "Room") + " (" + r.waiting + " waiting)"; }).join("\n");
    var pick = "";
    try { pick = window.prompt("Route to which room?\n\n" + names + "\n\nEnter the number:", "1") || ""; } catch (e) {}
    var idx = parseInt(pick, 10);
    if (!idx || idx < 1 || idx > rooms.length) return;
    doRoute(ticketId, rooms[idx - 1].room.id);
  }
  function doRoute(ticketId, roomId) {
    apiPost("/assign-room", { orgId: st.orgId, ticketId: ticketId, roomId: roomId })
      .then(function (r) { if (r && r.ok) { toast("Routed"); loadFrontDesk(); } else { toast("Could not route that patient."); } })
      .catch(function () { toast("Could not route that patient."); });
  }

  // Doctor at a CHOSEN StewardMD org (clinic or Connect hospital). Loads the doctor's ROOM session - the
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
      '<label class="q-gate-remember"><input id="qRemember" type="checkbox"><span>Remember me on this device</span></label>' +
      '<div class="q-gate-err">' + (err ? esc(err) : "") + "</div>" +
      '<button class="q-gate-btn" data-q-act="ghislogin">Sign in</button>' +
      '<div class="q-gate-or"><span>or</span></div>' +
      '<button class="q-gate-demo" data-q-act="demo">' + ms("science") + " Try with demo data</button>" +
      '<button class="q-gate-close" data-q-act="chooser">‹ Back</button>' +
      (who ? '<div class="q-gate-foot">App account: ' + esc(who) + "</div>" : "") +
      "</div></div>";
  }
  // ── "Remember me" - GHIS credential stored ONLY on this device, never our server ────────────────
  // Reuses autofetch's device secure store (iOS Keychain / Android Keystore via SMD_SECURE) + the SAME
  // key, so one remembered login also powers silent auto-reconnect. userId (non-sensitive) is kept in
  // localStorage for prefill + as the "remembered" flag; the password lives only in the OS secure store.
  // Keys are SCOPED PER APP-ACCOUNT (Firebase uid, mirroring GHIS token scoping) so a remembered GHIS
  // login can never leak to a different doctor who signs into the app on the SAME shared device.
  function remUid() { try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; return (u && u.uid) || "anon"; } catch (e) { return "anon"; } }
  function remCredKey() { return "smd_ghis_rememcred:" + remUid(); }   // device secure store (Keychain/Keystore)
  function remUserKey() { return "smd_ghis_rememuser:" + remUid(); }   // localStorage: userId prefill + "remembered" flag (non-sensitive)
  function remStore(u, p) { try { localStorage.setItem(remUserKey(), u || ""); } catch (e) {} try { if (window.SMD_SECURE) return window.SMD_SECURE.set(remCredKey(), { u: u, p: p }); } catch (e) {} return Promise.resolve(); }
  function remForget() { try { localStorage.removeItem(remUserKey()); } catch (e) {} try { if (window.SMD_SECURE) return window.SMD_SECURE.remove(remCredKey()); } catch (e) {} return Promise.resolve(); }
  function remUser() { try { return localStorage.getItem(remUserKey()) || ""; } catch (e) { return ""; } }
  function remRead() { if (!(window.SMD_SECURE && window.SMD_SECURE.get)) return Promise.resolve(null); return window.SMD_SECURE.get(remCredKey()).then(function (raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }).catch(function () { return null; }); }
  // Session died mid-use: try a SILENT re-login from the remembered device credential; only if that
  // fails show the login gate (prefilled) - never force the doctor to sign out first.
  function ghisReauth(reason) {
    clearInterval(st.pollId);
    st.ghisToken = null; st.ghisDoctorName = ""; st.ghisUser = "";
    try { G.GHIS && G.GHIS.setToken && G.GHIS.setToken(""); } catch (e) {}
    remRead().then(function (c) {
      if (!(c && c.u && c.p)) { showGate(reason); return; }
      authHeaders().then(function (h) { return fetchRetry("/api/ghis/login", { method: "POST", headers: h, credentials: "include", body: JSON.stringify({ userId: c.u, password: c.p }) }); })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r && r.token) { st.ghisToken = r.token; st.ghisUser = r.userId || c.u; st.ghisDoctorName = r.doctorName || ""; try { G.GHIS && G.GHIS.setToken && G.GHIS.setToken(r.token); } catch (e) {} loadSession(); return; }
          showGate(reason);   // remembered creds rejected (e.g. password changed) -> gate, prefilled
        })
        .catch(function () { showGate(reason); });
    });
  }
  function showGate(reason) { root().innerHTML = _gate(reason || "Your GHIS session expired. Please sign in again."); prefillGate(); }
  function prefillGate() {
    setTimeout(function () {
      try {
        var u = document.getElementById("qGhisUser"), ru = remUser();
        if (u && ru) u.value = ru;
        var cb = document.getElementById("qRemember"); if (cb) cb.checked = !!ru;
        var f = ru ? document.getElementById("qGhisPwd") : u; if (f) f.focus();
      } catch (e) {}
    }, 80);
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
        if (r && r.token) { st.ghisToken = r.token; st.ghisUser = r.userId || userId; st.ghisDoctorName = r.doctorName || ""; try { G.GHIS && G.GHIS.setToken && G.GHIS.setToken(r.token); } catch (e) {} var rem = false; try { var cb = document.getElementById("qRemember"); rem = !!(cb && cb.checked); } catch (e) {} (rem ? remStore(userId, password) : remForget()); loadSession(); return; }
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
    st.orgId = null; st.clinicAdmin = null;   // GHIS/Connect session: never carry a personal-clinic's orgId (or its staff list) over
    var opts = st.openOpts || {}, el = root();
    el.innerHTML = '<div class="q-empty" style="padding:80px">Loading your queue…</div>';
    var q = "?hospitalId=" + encodeURIComponent(opts.hospitalId || "manual") + "&department=" + encodeURIComponent(opts.department || "") + "&source=" + encodeURIComponent(opts.source || "manual");
    apiGet("/session" + q).then(function (r) {
      if (!r || !r.ok) { el.innerHTML = '<div class="q-empty" style="padding:80px">Could not start the queue (' + esc((r && r.error) || "error") + ').<br><button class="q-pause" style="max-width:220px;margin:16px auto 0" data-q-act="chooser">Switch workplace</button><button class="q-pause" style="max-width:220px;margin:8px auto 0" data-q-act="close">Close</button></div>'; return; }
      st.session = r.session; st.tickets = r.tickets || []; st.me = { name: r.session.doctorName, dept: r.session.department }; paint();
      clearInterval(st.pollId); st.pollId = setInterval(refresh, POLL_MS);
      // Primary data source: auto-pull today's GHIS Out-patients list into the queue right after a GHIS sign-in
      // (dedupes server-side by episode id, so it is safe to run on every entry). Manual "Import" button remains.
      if (st.ghisToken && (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool || G.SMD_QUEUE_FLAGS.bool("smd_opd_queue_import"))) { try { importOpd(); } catch (e) {} }
      // Connected EMR (Connect) hospital: auto-pull today's worklist from the linked FHIR EMR - same model as GHIS.
      if (opts.source === "connect") { try { importFromSource(); } catch (e) {} }
    }).catch(function () { el.innerHTML = '<div class="q-empty" style="padding:80px">Could not reach the server. Check your connection.<br><button class="q-pause" style="max-width:200px;margin:16px auto 0" data-q-act="retry">Retry</button><button class="q-pause" style="max-width:200px;margin:8px auto 0" data-q-act="chooser">Switch workplace</button></div>'; });
  }
  // Pull today's worklist from the org's connected EMR (Connect FHIR) into this session. Auto on entry + poll.
  function importFromSource(silent) {
    if (!st.session) return;
    apiPost("/import-from-source", { sessionId: st.session.id }).then(function (r) {
      if (r && r.ok) { st.tickets = r.tickets || st.tickets; paint(); if (!silent && r.imported != null) { try { G.toast && G.toast("Imported " + r.imported + " patient(s) from the EMR"); } catch (e) {} } }
    }).catch(function () {});
  }
  // Which workplace the doctor last chose, remembered on-device so a personal-clinic doctor is not forced
  // onto GHIS just because a stale Ward Sync token is cached. Values: "ghis" | "clinic:<orgId>" | "connect:<orgId>" | "".
  function _wp() { try { return localStorage.getItem("smd_opd_workplace") || ""; } catch (e) { return ""; } }
  function _setWp(v) { try { if (v) localStorage.setItem("smd_opd_workplace", v); else localStorage.removeItem("smd_opd_workplace"); } catch (e) {} }
  function _wpRouterOn() { try { return localStorage.getItem("smd_opd_wp") !== "0"; } catch (e) { return true; } }   // reversible: set "0" to restore the old token-first routing
  function _enterGhis() {
    var el = root();
    // Re-pull the Ward Sync token (we null st.ghisToken when routing into a clinic/Connect session, so a
    // doctor switching back to GHIS still reuses the live session instead of being asked to sign in again).
    if (!st.ghisToken) { try { var t = (G.GHIS && G.GHIS.getToken && G.GHIS.getToken()) || ""; if (t) st.ghisToken = t; } catch (e) {} }
    if (st.ghisToken && G.GHIS && G.GHIS.checkSession) {
      // ASK FIRST: verify the GHIS session before the dashboard; expired -> silent re-login, else the gate.
      el.innerHTML = '<div class="q-empty" style="padding:80px">Checking your GHIS session…</div>';
      G.GHIS.checkSession().then(function (ok) {
        if (ok) { try { st.ghisToken = (G.GHIS.getToken && G.GHIS.getToken()) || st.ghisToken; } catch (e) {} loadSession(); }
        else ghisReauth();
      }).catch(function () { loadSession(); });
      return;
    }
    if (st.ghisToken) { loadSession(); return; }
    el.innerHTML = _gate(); prefillGate();   // remembered Hospital but no live token -> GHIS sign-in gate
  }
  function open(opts) {
    if (G.SMD_QUEUE_FLAGS && !G.SMD_QUEUE_FLAGS.on()) { try { G.toast && G.toast("Smart OPD Queue is off"); } catch (e) {} return; }
    st.openOpts = opts || {};
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    if (st.demo) { loadSession(); return; }
    // A front-desk staff session is not a doctor workplace: go straight to the desk, never the
    // Hospital/Personal chooser or the GHIS gate.
    if (staffTok()) { loadFrontDesk(); return; }
    // Route to the doctor's REMEMBERED workplace. A remembered choice always wins, so once a personal-clinic
    // doctor picks their clinic (via the chooser reachable from the gate "Back" or dashboard "Switch") it sticks
    // and they never land on GHIS again. With NO remembered choice we keep the old behaviour: reuse a live GHIS
    // session (hospital doctors never see a chooser or sign in twice), else show the Hospital/Personal chooser.
    var wp = _wpRouterOn() ? _wp() : "";              // remembered workplace; flag off (smd_opd_wp="0") ignores it
    if (!wp) {
      // No explicit choice yet: detect a live Ward Sync session and default hospital doctors straight to GHIS.
      if (!st.ghisToken) { try { var shared = (G.GHIS && G.GHIS.getToken && G.GHIS.getToken()) || ""; if (shared) st.ghisToken = shared; } catch (e) {} }
      wp = st.ghisToken ? "ghis" : "";
    }
    if (wp === "ghis") { _enterGhis(); return; }
    // Clinic / Connect sessions are NOT GHIS-sourced: drop any cached GHIS token from this module's state so the
    // ~40s poll never cross-imports the hospital OPD list into a clinic queue and the dashboard never shows a
    // stray "Sign out of GHIS". Ward Sync's own token (window.GHIS) is untouched; _enterGhis re-pulls it later.
    if (wp.indexOf("clinic:") === 0) { st.ghisToken = null; startClinic(wp.slice(7)); return; }
    if (wp.indexOf("connect:") === 0) { st.ghisToken = null; st.openOpts = { hospitalId: wp.slice(8), source: "connect" }; loadSession(); return; }
    el.innerHTML = _chooseType();   // no remembered workplace -> Hospital vs Personal clinic
  }
  function close() { var el = document.getElementById("smdQueue"); if (el) el.classList.remove("on"); clearInterval(st.pollId); st.demo = false; }
  // Sign out of GHIS: drop the GHIS session token + doctor identity, tell the server to forget the session,
  // and re-open the login gate so a different doctor can sign in.
  function doLogout() {
    clearInterval(st.pollId);
    var tok = st.ghisToken;
    st.ghisToken = null; st.ghisDoctorName = ""; st.ghisUser = ""; st.demo = false; st.session = null; st.tickets = []; st.pollN = 0; st.profileOpen = false;
    try { G.GHIS && G.GHIS.setToken && G.GHIS.setToken(""); } catch (e) {}   // universal session: signing out here signs out everywhere
    if (tok) { try { fetch("/api/ghis/logout", { method: "POST", headers: { "Authorization": "Bearer " + tok }, credentials: "include" }).catch(function () {}); } catch (e) {} }
    open(st.openOpts);   // ghisToken now null -> the GHIS login gate shows again
  }

  // Bridge from the EMR overlay (opd-emr.js): after a GHIS save the doctor finishes the consult
  // from inside the assessment. The EMR owns no queue session, so it fires a DOM event we act on here.
  try {
    document.addEventListener("smd:consult-end", function () { try { if (st.session) act(st.session.id, "/advance"); } catch (e) {} });
    document.addEventListener("smd:consult-emergency", function (e) {
      try { if (!st.session) return; var tid = e && e.detail && e.detail.ticketId; if (tid) act(st.session.id, "/priority", { ticketId: tid, priority: 2 }); act(st.session.id, "/advance"); } catch (x) {}
    });
  } catch (e) {}

  G.QUEUE = { open: open, close: close, refresh: refresh, _render: _render, _st: st,
    _openTicketEmr: openTicketEmr,   // test seam: workplace-based EMR routing (see test/queue-clinic-emr-route.test.mjs)
    // Live filter of the queue timeline - updates ONLY the rows container so the search input
    // keeps focus while typing (no full repaint).
    _search: function (v) {
      st.search = v;
      var b = document.getElementById("qTlRows"); if (b) b.innerHTML = timelineRows(st);
      var x = document.querySelector(".q-tl-search-x"); if (x) x.style.display = (v && String(v).trim()) ? "" : "none";
    } };

  // Testing launch hook (no nav coupling yet): with the flag on, ?queue=1 auto-opens. The proper
  // sidebar/home tile is a small follow-up. e.g. stewardmd.in/?q=1&queue=1 (preview) or in-app.
  try {
    if (G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.on() && /[?&]queue=1/.test((G.location && G.location.search) || "")) {
      G.addEventListener("DOMContentLoaded", function () { open(); });
    }
  } catch (e) {}
})();
