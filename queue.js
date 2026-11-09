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

  // The OPD token called out in the waiting hall. A ticket registered before tokens existed has none.
  function tok(t) { return t && t.token ? '<span class="q-tok" title="Token">' + esc(t.token) + "</span>" : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  // Privacy mode (privacy-mode.js): wrap a patient identifier so it can be masked on screen. Without
  // SMD_PRIVACY_MODE (node tests, the staff console) this is plain esc(), so the markup is unchanged.
  function phi(kind, v, html) { var P = G.SMD_PRIVACY_MODE; return P ? P.wrap(kind, v, html) : (html == null ? esc(v) : html); }
  function pv(kind, v) { var P = G.SMD_PRIVACY_MODE; return P ? P.screenText(kind, v) : String(v == null ? "" : v); }
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '">' + name + "</span>"; }
  function initials(n) { n = String(n || "").trim(); if (!n) return "DR"; var p = n.split(/\s+/); return ((p[0][0] || "") + (p[1] ? p[1][0] : (p[0][1] || ""))).toUpperCase(); }
  function mins(msDiff) { return Math.max(0, Math.round(msDiff / 60000)); }
  function isQueued(s) { return s === "registered" || s === "waiting" || s === "called"; }
  function now() { return Date.now(); }
  /* A flag in queue-flags.js DEFS resolves there (query, then localStorage, then default). On a page that
   * loads no DEFS for the key (test harnesses), localStorage alone decides. */
  function flagOn(key, def) {
    var F = G.SMD_QUEUE_FLAGS;
    try { if (F && F.defs && F.defs()[key]) return F.bool(key); } catch (e) {}
    var v = null; try { v = G.localStorage.getItem(key); } catch (e) {}
    return v === "1" ? true : v === "0" ? false : def;
  }
  function q2On() { return flagOn("smd_opd_q2", false); }                    // the 2026-11 queue screen
  function patientKeyOn() { return flagOn("smd_opd_patient_key", true); }    // one device record per patient
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
    if (!worst || worstWait <= 30 * 60000) return null;
    var tail = " (#" + (worst.mrnLast4 || "-") + ") has waited " + mins(worstWait) + " minutes. Consider notifying the next few patients of the delay.";
    return { t: worst, msg: (worst.name || "A patient") + tail, html: phi("name", worst.name, esc(worst.name || "A patient")) + esc(tail) };
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
    var pri = t.priority >= 2 ? '<span class="q-pri emerg">Emergency</span>' : t.priority === 1 ? '<span class="q-pri prio">' + esc(prioLabel(t)) + "</span>" : "";
    var etaMin = t.etaStart ? mins(t.etaStart - now()) : null;
    var line = late
      ? '<span class="q-tl-eta late">' + ms("error") + " Waiting: " + mins(waitMs) + "m</span>"
      : '<span class="q-tl-eta">' + ms(isNext ? "check_circle" : "pending", false) + (isNext ? '' : '') + " ETA: " + (etaMin == null ? "-" : etaMin + "m") + "</span>";
    return '<div class="q-tl-row' + (isNext ? " next" : "") + (late ? " late" : "") + '" data-q-tid="' + esc(t.id) + '">' +
        '<div class="q-pos">' + (idx + 1) + "</div>" +
        '<div class="q-tl-info"><div class="q-tl-nm">' + tok(t) + phi("name", t.name, esc(t.name || "Patient")) + '<span class="id">#' + esc(t.mrnLast4 || "") + "</span>" + pri + "</div>" + line + "</div>" +
        '<div class="q-tl-acts">' +
          (t.status !== "called" ? '<button class="q-ic" title="Call" aria-label="Call" data-q-act="call:' + esc(t.id) + '">' + ms("campaign") + "</button>" : "") +   // an already-called patient can't be re-called (server rejects called->called); show Send-back instead
          (t.status === "called" ? '<button class="q-ic" title="Send back to waiting" aria-label="Send back to waiting" data-q-act="sendback:' + esc(t.id) + '">' + ms("undo") + "</button>" : "") +
          (t.status === "called" ? '<button class="q-ic" title="No-show (did not come when called)" aria-label="No-show (did not come when called)" data-q-act="noshow:' + esc(t.id) + '">' + ms("person_off") + "</button>" : "") +
          '<button class="q-ic" title="Start" aria-label="Start" data-q-act="start:' + esc(t.id) + '">' + ms("play_arrow") + "</button>" +
          '<button class="q-ic" title="Priority" aria-label="Priority" data-q-act="prio:' + esc(t.id) + '">' + ms("priority_high") + "</button>" +
          '<button class="q-ic q-rm" title="Remove (mistaken / duplicate / wrongly-routed)" aria-label="Remove (mistaken / duplicate / wrongly-routed)" data-q-act="remove:' + esc(t.id) + '">' + ms("person_remove") + "</button>" +
          (emrOn() && t.ghisPatientId ? '<button class="q-ic" title="View EMR profile" aria-label="View EMR profile" data-q-act="profile:' + esc(t.id) + '">' + ms("clinical_notes") + "</button>" : "") +
          '<button class="q-ic" title="Assessment + Ask MaiK" aria-label="Assessment + Ask MaiK" data-q-act="assess:' + esc(t.id) + '">' + ms("assignment") + "</button>" +   // every patient gets an Assessment button (clinic + hospital); opens the consult record
        "</div></div>";
  }
  /* D13: RECALL NO-SHOWS. state.noShows: undefined = closed, null = loading, false = failed (said so, never
   * drawn as "nobody"), [] = none recallable, else the list. Recall keeps the patient's token and asks why. */
  function noShowPanel(state) {
    var n = state.noShows;
    if (n === undefined) return "";
    var h = '<div class="q-card" style="margin:8px 0"><div class="q-card-h">' + ms("person_search") + " No-shows you can recall" +
      ' <button class="q-ic" title="Close" aria-label="Close" data-q-act="noshowsclose">' + ms("close") + "</button></div>";
    if (n === null) return h + '<div class="q-empty">Loading no-shows...</div></div>';
    if (n === false) return h + '<div class="q-empty">The no-shows could not be loaded. Do not read this as none. <button class="q-pause" style="width:auto;padding:6px 10px" data-q-act="noshows">Try again</button></div></div>';
    if (!n.length) return h + '<div class="q-empty">No one marked no-show in the last 4 hours.</div></div>';
    return h + n.map(function (t) {
      return '<div class="q-fd-row"><div>' + tok(t) + "<b>" + phi("name", t.name, esc(t.name || "Patient")) + '</b><div class="q-hint">Marked no-show ' + esc(new Date(t.noShowAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) +
        " &middot; recall until " + esc(new Date(t.recallableUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "</div></div>" +
        '<button class="q-pause" style="width:auto;padding:8px 12px" data-q-act="recall:' + esc(t.id) + '">Recall</button></div>';
    }).join("") + "</div>";
  }
  function loadNoShows() {
    if (!st.session) return;
    st.noShows = null; paint();
    apiGet("/no-show/list?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) { st.noShows = (r && r.ok) ? (r.noShows || []) : false; paint(); }, function () { st.noShows = false; paint(); });
  }
  function recallNoShow(sid, ticketId) {
    var why = "";
    try { why = window.prompt("Why is this patient recalled? (recorded in the audit trail)", "Patient arrived late") || ""; } catch (e) {}
    if (why.trim().length < 3) { try { G.toast && G.toast("Not recalled: a reason is required."); } catch (e) {} return; }
    doRecall(sid, ticketId, why.trim());
  }
  function doRecall(sid, ticketId, why) {
    act(sid, "/no-show/recall", { ticketId: ticketId, reason: why, to: "waiting" }).then(function (r) {
      try { G.toast && G.toast(r && r.ok ? "Recalled with the same token." : "Not recalled: " + ((r && (r.message || r.error)) || "no response")); } catch (e) {}
      if (r && r.ok && st.noShows !== undefined) loadNoShows();
    }, function () { try { G.toast && G.toast("Not recalled: the server could not be reached."); } catch (e) {} });
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
    if (q2On()) return rowsV2(state);
    var ordered = orderedTickets(state);
    var q = (state.search || "").trim().toLowerCase();
    var vis = q ? ordered.filter(function (t) { return matchTicket(t, q); }) : ordered;
    if (!vis.length) return '<div class="q-empty">' + (q ? "No patients match “" + phi("other", state.search) + "”." : "Queue is empty. Import from Ward Sync or add a patient.") + "</div>";
    return vis.map(function (t) { return ticketRow(t, ordered.indexOf(t), ordered); }).join("");
  }
  function renderConsult(cur) {
    if (!cur) return '<div class="q-consult"><div class="q-empty">' + ms("play_circle") + "<div style=\"margin-top:8px\">No one in consultation. Tap a patient's <b>Start</b> to begin.</div></div></div>";
    var vt = cur.visitType === "followup" ? "Follow-up" : "New";
    return '<div class="q-consult"><div class="q-consult-b">' +
      '<div class="q-cn"><div><h3>' + tok(cur) + phi("name", cur.name, esc(cur.name || "Patient")) + "</h3>" +
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
    var searchBox = ordered.length >= 6 ? '<div class="q-tl-search-wrap">' + ms("search") + '<input class="q-tl-search" data-phi-input type="search" autocomplete="off" autocapitalize="off" placeholder="Search name or ID…" value="' + esc(state.search || "") + '" oninput="try{window.QUEUE&&QUEUE._search&&QUEUE._search(this.value)}catch(e){}"><button class="q-tl-search-x" data-q-act="clearsearch" title="Clear" style="' + (state.search ? "" : "display:none") + '">' + ms("close") + "</button></div>" : "";
    var timeline = '<div class="q-tl"><div class="q-tl-head"><span>Patient</span><span class="r">' + ordered.length + ' in queue <button class="q-ic" title="Recall no-shows" aria-label="Recall no-shows" data-q-act="noshows">' + ms("person_search") + "</button></span></div>" + noShowPanel(state) + searchBox +
      '<div id="qTlRows">' + timelineRows(state) + "</div></div>";   // the timeline already lists the full ordered queue; the old "View full queue" foot link was a dead no-op
    var ai = ins ? '<div class="q-ai"><div class="q-ai-icon">' + ms("schedule") + "</div><div style=\"flex:1\"><h4>Running late</h4><p>" + (ins.html || esc(ins.msg)) + '</p></div><button class="q-ai-x" data-q-act="dismiss" aria-label="Dismiss">' + ms("close") + "</button></div>" : '<div class="q-ai calm"><div class="q-ai-icon">' + ms("check_circle") + '</div><div style="flex:1"><h4>On time</h4><p style="margin:0">No one has waited over 30 minutes.</p></div></div>';   // removed the dead "Send notification" CTA (no handler / no /notify route yet)
    // The doctor's own session above, the hospital's whole OPD day beneath it.
    return kpis + pulseCard(state) + '<section class="q-grid"><div><h2 class="q-h2">' + ms("play_circle") + "Currently Consulting</h2>" + renderConsult(cur) +
      '<button class="q-pause" data-q-act="pause">' + ms("pause_circle") + (paused ? " Resume Queue" : " Pause Queue") + "</button></div>" +
      '<div class="q-side-col"><h2 class="q-h2">' + ms("view_list", false) + "Queue Timeline</h2>" + timeline + ai + "</div></section>";
  }

  /* ==== The 2026-11 queue screen (flag smd_opd_q2; design-plans/opd-queue-10-of-10.md) ====================
   * Built around the one decision the doctor makes here: who do I see next, and am I running behind.
   * A status sentence, the patient in the room, the next patient with one labelled button, then the rest
   * as plain rows that open a sheet of worded actions. Every action is the SAME data-q-act command the
   * earlier screen sends, so the server calls, permissions and audit are unchanged. */
  function findTicket(id, list) { var ts = list || st.tickets || []; for (var i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i]; return null; }
  function whenV2(t) {
    var waitMs = now() - (t.registeredAt || now());
    if (isQueued(t.status) && waitMs > 30 * 60000) return { late: true, text: "Waiting " + mins(waitMs) + " min" };
    if (t.status === "called") return { text: "Called" + (t.calledAt ? ", " + mins(now() - t.calledAt) + " min ago" : "") };
    if (t.etaStart) {
      var m = mins(t.etaStart - now()), c = t.confidence || t.etaConfidence || 0;
      // The estimate's own confidence (functions/_queue_eta.js): under 60 it is said to be rough.
      return { text: m <= 0 ? "Due now" : "About " + m + " min" + (c && c < 60 ? ", rough estimate" : "") };
    }
    return { text: "Waiting " + mins(waitMs) + " min" };
  }
  function priV2(t) { return t.priority >= 2 ? '<span class="q2-tag danger">Emergency</span>' : t.priority === 1 ? '<span class="q2-tag warn">' + esc(prioLabel(t)) + "</span>" : ""; }
  function nameV2(t) { return tok(t) + phi("name", t.name, esc(t.name || "Patient")); }
  function statusV2(state, k, ordered) {
    var s = state.session || {}, paused = s.status === "paused", longest = 0;
    ordered.forEach(function (t) { var w = now() - (t.registeredAt || now()); if (w > longest) longest = w; });
    var late = longest > 30 * 60000, parts = [k.waiting ? k.waiting + " waiting" : "No one waiting"];
    if (k.waiting && mins(longest) >= 1) parts.push("Longest " + mins(longest) + " min");
    if (k.avgConsult) parts.push("You average " + k.avgConsult + " min a patient");
    return '<section class="q2-status' + (late ? " late" : "") + '" role="status">' +
      (late ? '<span class="q2-tag warn">Running late</span>' : "") + "<p>" + esc(parts.join(". ") + ".") + "</p>" +
      (s.doctorStatus === "emergency" ? '<div class="q2-hold">' + ms("warning") + '<span>You marked an emergency. Patients see that you are held up.</span><button class="q2-btn" data-q-act="emergency">Emergency over</button></div>' : "") +
      (paused ? '<div class="q2-hold">' + ms("pause_circle") + '<span>Queue paused. No one is being called.</span><button class="q2-btn" data-q-act="pause">Resume</button></div>' : "") +
      "</section>";
  }
  function nowV2(cur) {
    if (!cur) return "";
    var since = cur.consultStartAt || 0;
    return '<section class="q2-now" aria-label="With you now"><h2 class="q2-h">With you now</h2>' +
      '<div class="q2-idline"><div class="q2-name">' + nameV2(cur) + '</div><span class="q2-tag">' + (cur.visitType === "followup" ? "Follow-up" : "New") + "</span></div>" +
      '<p class="q2-muted">' + (since ? '<span data-q2-since="' + esc(since) + '">In consult ' + mins(now() - since) + " min</span>" : "In consult") + "</p>" +
      '<button class="q2-btn primary" data-q-act="assess:' + esc(cur.id) + '">' + ms("assignment") + "<span>Open assessment</span></button>" +
      // A real <button>: a tap, Enter or a screen reader asks "End this consult?". The swipe still ends it in one move.
      '<button type="button" class="q-swipe q2-swipe" id="qSwipe" data-q-act="endask" aria-label="End consultation">' +
        '<span class="q-swipe-fill"></span><span class="q-swipe-txt">Swipe to end consultation</span>' +
        '<span class="q-swipe-knob" id="qSwipeKnob">' + ms("chevron_right") + "</span></button>" +
      '<button class="q2-link" data-q-act="row:' + esc(cur.id) + '">More for this patient</button>' +
      "</section>";
  }
  function nextV2(t) {
    var w = whenV2(t), called = t.status === "called", id = esc(t.id);
    return '<section class="q2-next" aria-label="Next patient"><h2 class="q2-h">Next</h2>' +
      '<div class="q2-idline"><div class="q2-name">' + nameV2(t) + "</div>" + priV2(t) + "</div>" +
      '<p class="q2-muted' + (w.late ? " late" : "") + '">' + esc(w.text) + "</p>" +
      '<div class="q2-acts">' +
        (called
          ? '<button class="q2-btn primary" data-q-act="start:' + id + '">' + ms("play_arrow") + "<span>Start consult</span></button>" +
            '<button class="q2-btn" data-q-act="noshow:' + id + '">Did not come</button>'
          : '<button class="q2-btn primary" data-q-act="call:' + id + '">' + ms("campaign") + "<span>Call in</span></button>" +
            '<button class="q2-btn" data-q-act="start:' + id + '">Start consult</button>') +
        '<button class="q2-btn icon" data-q-act="row:' + id + '" aria-label="More actions for this patient">' + ms("more_horiz") + "</button>" +
      "</div></section>";
  }
  function rowV2(t, pos) {
    var w = whenV2(t);
    return '<button type="button" class="q2-row" data-q-act="row:' + esc(t.id) + '" data-q-tid="' + esc(t.id) + '">' +
      '<span class="q2-pos">' + pos + "</span>" +
      '<span class="q2-rinfo"><span class="q2-rname">' + nameV2(t) + '</span><span class="q2-rmeta">' + priV2(t) + '<span class="q2-rwhen' + (w.late ? " late" : "") + '">' + esc(w.text) + "</span></span></span>" +
      ms("chevron_right") + "</button>";
  }
  // The rows under "Next". While searching, every match is listed (the next patient too) with its true place.
  function rowsV2(state) {
    var ordered = orderedTickets(state), q = (state.search || "").trim().toLowerCase();
    var vis = q ? ordered.filter(function (t) { return matchTicket(t, q); }) : ordered.slice(1);
    if (!vis.length) return '<p class="q2-muted q2-none">' + (q ? "No patient matches “" + phi("other", state.search) + "”." : "No one else is waiting.") + "</p>";
    return vis.map(function (t) { return rowV2(t, ordered.indexOf(t) + 1); }).join("");
  }
  function canvasV2(state) {
    var tickets = (state.tickets || []).slice(), ordered = orderedTickets(state);
    var cur = tickets.filter(function (t) { return t.status === "in_consultation"; })[0] || null;
    var k = computeKpis(tickets);
    var head = statusV2(state, k, ordered) + pulseCard(state);
    if (!cur && !ordered.length) {
      return head + noShowPanel(state) + '<section class="q2-empty"><h2 class="q2-h">No patients yet</h2>' +
        "<p>" + (state.ghisToken ? "Today's hospital list has not come in. Refresh to pull it, or add a patient yourself." : "Add your first patient, or ask reception to check one in. They appear here as soon as they are added.") + "</p>" +
        '<button class="q2-btn primary" data-q-act="add">' + ms("person_add") + "<span>Add patient</span></button>" +
        '<button class="q2-link" data-q-act="noshows">Recall a no-show</button></section>';
    }
    var search = ordered.length >= 6 ? '<div class="q-tl-search-wrap">' + ms("search") + '<input class="q-tl-search" data-phi-input type="search" autocomplete="off" autocapitalize="off" aria-label="Search the queue" placeholder="Search name or ID" value="' + esc(state.search || "") + '" oninput="try{window.QUEUE&&QUEUE._search&&QUEUE._search(this.value)}catch(e){}"><button class="q-tl-search-x" data-q-act="clearsearch" aria-label="Clear search" style="' + (state.search ? "" : "display:none") + '">' + ms("close") + "</button></div>" : "";
    return head + nowV2(cur) + (ordered.length ? nextV2(ordered[0]) : '<section class="q2-next"><h2 class="q2-h">Next</h2><p class="q2-muted">No one is waiting.</p></section>') +
      '<section class="q2-list" aria-label="Waiting"><div class="q2-listh"><h2 class="q2-h">Waiting' + (ordered.length > 1 ? " · " + (ordered.length - 1) + " more" : "") + '</h2><button class="q2-link" data-q-act="noshows">No-shows</button></div>' +
      noShowPanel(state) + search + '<div id="qTlRows">' + rowsV2(state) + "</div></section>";
  }
  function headerV2(state, view, doctorName, dept) {
    var ca = state.clinicAdmin || {}, clinic = inClinicWorkplace();
    var title = (clinic && ca.name) || doctorName, sub = clinic ? (state.me && state.me.name && state.me.name !== title ? state.me.name : dept) : dept;
    return '<header class="q-top q2-top"><div class="q-top-in">' +
      '<button class="q-iconbtn" data-q-act="close" aria-label="Close OPD Queue">' + ms("close") + "</button>" +
      '<div class="q2-title"><b>' + esc(title) + "</b><span>" + esc(sub || "") + "</span></div>" +
      '<div class="q-top-r">' +
      (view === "dashboard" && !clinic ? '<button class="q-iconbtn" data-q-act="importopd" aria-label="Refresh from the hospital list">' + ms("refresh") + "</button>" : "") +
      (view === "dashboard" ? '<button class="q2-add" data-q-act="add" aria-label="Add patient">' + ms("person_add") + "<span>Add</span></button>" : "") +
      (state.session || state.ghisToken
        ? '<button class="q-avatar q-avatar-btn" data-q-act="docprofile" aria-label="Your profile, clinic and staff">' + esc(initials(doctorName)) + "</button>"
        : '<div class="q-avatar">' + esc(initials(doctorName)) + "</div>") +
      "</div></div></header>";
  }
  function sheetItem(act, icon, label, cls) { return '<button class="q2-item' + (cls ? " " + cls : "") + '" data-q-act="' + act + '">' + ms(icon) + "<span>" + label + "</span></button>"; }
  function renderRowSheet(state) {
    var t = findTicket(state.rowSheet && state.rowSheet.ticketId, state.tickets); if (!t) return "";
    var id = esc(t.id), items = "", s = state.session || {};
    if (t.status === "in_consultation") {
      items = sheetItem("assess:" + id, "assignment", "Open assessment") +
        sheetItem("sendback:" + id, "undo", "Send back to waiting") +
        sheetItem("emergency", "warning", s.doctorStatus === "emergency" ? "Emergency over" : "I have an emergency, hold the queue") +
        sheetItem("pause", "pause_circle", s.status === "paused" ? "Resume the queue" : "Pause the queue");
    } else {
      items = sheetItem("start:" + id, "play_arrow", "Start consult") +
        (t.status !== "called" ? sheetItem("call:" + id, "campaign", "Call in")
          : sheetItem("sendback:" + id, "undo", "Send back to waiting") + sheetItem("noshow:" + id, "person_off", "Did not come")) +
        sheetItem("prio:" + id, "priority_high", t.priority ? "Change priority" : "Set priority") +
        sheetItem("assess:" + id, "assignment", "Open assessment") +
        (emrOn() && t.ghisPatientId ? sheetItem("profile:" + id, "clinical_notes", "Open record") : "") +
        '<div class="q2-sep"></div>' + sheetItem("remove:" + id, "person_remove", "Remove from queue", "danger");
    }
    return '<div class="q-sheet" data-q-act="row-close"><div class="q-profile q2-sheet" data-q-act="row-stop" role="dialog" aria-label="Actions for this patient">' +
      '<div class="q-profile-head"><button class="q-ic q-profile-x" data-q-act="row-close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="q2-name">' + nameV2(t) + priV2(t) + '</div><p class="q2-muted">' + esc(t.status === "in_consultation" ? "With you now" : whenV2(t).text) + "</p>" +
      items + "</div></div>";
  }
  function renderConfirm(c) {
    return '<div class="q-sheet" data-q-act="confirm-close"><div class="q-profile q2-sheet" data-q-act="row-stop" role="alertdialog" aria-label="' + esc(c.title) + '">' +
      '<div class="q2-name">' + esc(c.title) + "</div>" + (c.bodyHtml ? '<p class="q2-muted">' + c.bodyHtml + "</p>" : "") +
      '<button class="q2-btn ' + (c.danger ? "danger" : "primary") + '" data-q-act="confirm-ok">' + esc(c.ok) + "</button>" +
      '<button class="q2-btn" data-q-act="confirm-close">Cancel</button></div></div>';
  }
  function renderRecallSheet(r) {
    return '<div class="q-sheet" data-q-act="recall-close"><div class="q-profile q2-sheet" data-q-act="row-stop" role="dialog" aria-label="Recall this patient">' +
      '<div class="q-profile-head"><button class="q-ic q-profile-x" data-q-act="recall-close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="q2-name">Recall this patient</div><p class="q2-muted">They keep the same token and go back to waiting. The reason is recorded in the audit trail.</p>' +
      '<label class="q-gate-lbl" for="qRecallWhy">Reason</label><input id="qRecallWhy" class="q-gate-in" type="text" maxlength="120" value="' + esc(r.reason || "Patient arrived late") + '">' +
      '<button class="q2-btn primary" data-q-act="recall-ok">Recall</button></div></div>';
  }
  function snackV2(sn) {
    return '<div class="q2-snack" role="status"><span>' + esc(sn.msg) + "</span>" + (sn.undo ? '<button data-q-act="snack-undo">Undo</button>' : "") + "</div>";
  }
  var snackTimer = 0;
  function snack(msg, undo) {
    st.snack = { msg: msg, undo: undo || null }; paint();
    clearTimeout(snackTimer); snackTimer = setTimeout(function () { st.snack = null; paint(); }, 7000);
    try { if (snackTimer && snackTimer.unref) snackTimer.unref(); } catch (e) {}
  }
  function ask(c) { st.rowSheet = null; st.confirm = c; paint(); }
  // The consult timer between repaints (a live board can go a minute without one).
  function tickNow() {
    try { var el = document.querySelector("#smdQueue [data-q2-since]"); if (el) el.textContent = "In consult " + mins(now() - (+el.getAttribute("data-q2-since") || now())) + " min"; } catch (e) {}
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
    var v2 = q2On();
    if (v2) header = headerV2(state, view, doctorName, dept);
    var canvas = view === "analytics" ? analyticsCanvas(state) : view === "settings" ? settingsCanvas(state) : (v2 ? canvasV2(state) : dashboardCanvas(state));
    // "Patients" opens the saved-patients list of the active clinic store (My Clinic device / Shared Clinic
    // Drive) - every patient consulted till now, tap to reopen their consult. It's a launcher, not a view.
    var savedTab = '<button class="q-nav" data-q-act="savedpatients" title="Patients seen (saved on this device / Drive)">' + ms("recent_actors") + "<span>Patients</span></button>";
    var bottom = '<nav class="q-bottomnav">' + navItem("dashboard", "Queue", view === "dashboard") + savedTab + navItem("analytics", "Analytics", view === "analytics") + navItem("settings", "Settings", view === "settings") + "</nav>";
    var main = '<div class="q-main' + (v2 ? " q2" : "") + '">' + header + '<div class="q-canvas">' + canvas + "</div>" + (v2 && state.snack ? snackV2(state.snack) : "") + bottom + "</div>";
    return '<div class="q-app">' + sidebar(view, doctorName, dept) + main + (state.profileOpen ? renderProfile(state, doctorName, dept) : "") + (state.prioSheet ? renderPrioSheet(state.prioSheet) : "") +
      (state.rowSheet ? renderRowSheet(state) : "") + (state.recallSheet ? renderRecallSheet(state.recallSheet) : "") + (state.confirm ? renderConfirm(state.confirm) : "") + "</div>";
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  // ---- Clinic & staff admin (owner, native clinic): Clinic ID + add nursing/reception/billing with a
  // PIN so they sign in as front-desk staff. Reuses the live server endpoints (GET /org, GET /members,
  // POST /member [+ /member/pin]); owner authority via STAFF_ADMIN. GHIS/hospital sessions are skipped
  // (staff there are managed in the hospital's own system). ----
  /* The add-staff fields live inside the profile sheet, and loadClinicAdmin repaints that whole
   * sheet when /org and /members land - which wiped the login name and PIN the owner was part-way
   * through typing, so staff could never be added unless both responses beat the typing. Repaint
   * the sheet, then put the half-typed entry (and the caret) back. */
  var STAFF_FIELDS = ["qStaffName", "qStaffRole", "qStaffPin"];
  function paintKeepingStaffEntry() {
    var vals = {}, active = document.activeElement, activeId = active && active.id, selStart = null, selEnd = null;
    STAFF_FIELDS.forEach(function (id) { var el = document.getElementById(id); if (el) vals[id] = el.value; });
    if (activeId && STAFF_FIELDS.indexOf(activeId) >= 0) { try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) {} }
    paint();
    STAFF_FIELDS.forEach(function (id) { var el = document.getElementById(id); if (el && vals[id]) el.value = vals[id]; });
    if (activeId && STAFF_FIELDS.indexOf(activeId) >= 0) {
      var again = document.getElementById(activeId);
      if (again) { try { again.focus(); if (selStart != null && again.setSelectionRange) again.setSelectionRange(selStart, selEnd); } catch (e) {} }
    }
  }
  function loadClinicName(orgId) {
    if (st.clinicAdmin && st.clinicAdmin.name) return;
    apiGet("/org?orgId=" + encodeURIComponent(orgId)).then(function (r) {
      if (!(r && r.ok && r.org) || st.orgId !== orgId) return;
      var ca = st.clinicAdmin = st.clinicAdmin || {};
      ca.code = r.org.code || ""; ca.name = r.org.name || "";
      if (st.view === "dashboard" && !st.profileOpen) paint();
    }).catch(function () {});
  }
  function loadClinicAdmin() {
    if (!st.orgId || st.ghisToken) { st.clinicAdmin = null; return; }
    st.clinicAdmin = st.clinicAdmin || {};
    apiGet("/org?orgId=" + encodeURIComponent(st.orgId)).then(function (r) { if (r && r.ok && r.org) { st.clinicAdmin.code = r.org.code || ""; st.clinicAdmin.name = r.org.name || ""; if (st.profileOpen) paintKeepingStaffEntry(); } }).catch(function () {});
    apiGet("/members?orgId=" + encodeURIComponent(st.orgId)).then(function (r) { if (r && r.ok) { st.clinicAdmin.members = r.members || []; if (st.profileOpen) paintKeepingStaffEntry(); } }).catch(function () {});
  }
  function roleLabel(r) { return r === "nurse" ? "Nursing" : r === "cashier" ? "Billing" : r === "reception" ? "Reception" : r === "admin" ? "Admin" : r === "doctor" ? "Doctor" : r === "supervisor" ? "Supervisor" : (r || "Staff"); }

  /* ---- THE OPD PULSE (server: /opd-pulse, figures: _queue_eta.js opdPulse) ------------------------
   *
   * The KPI strip above it is THIS doctor's session. This is the hospital's whole outpatient day, and
   * it exists because the numbers a clinic actually acts on are not averages: the longest wait in the
   * hall right now, how many people are past an hour, and whether the delay is the desk's or the
   * doctor's. Everything here is counts and durations - it names nobody, so it is safe on a screen the
   * whole front desk can see.
   *
   * Fetched on the existing poll, not a timer of its own, and only every fourth pass: it walks every
   * room's session, which is not something to do to a hospital every eight seconds. The refresh
   * control is there for the moment somebody wants it now. */
  function loadPulse(force) {
    if (!st.orgId || st.pulseBusy) return;
    if (!force && st.pulseN && (st.pulseN % 4) !== 0) { st.pulseN++; return; }
    st.pulseN = (st.pulseN || 0) + 1; st.pulseBusy = true;
    apiGet("/opd-pulse?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.pulseBusy = false; st.pulse = r && r.ok ? r : { failed: true }; pulsePaint();
        // Plan item 11: follow-ups promised and never booked. Silent when the hospital has no record (nothing to show).
        var now = new Date().toISOString();
        if (st.pulse.ok) apiGet("/ward/schedule?orgId=" + encodeURIComponent(st.orgId) + "&from=" + encodeURIComponent(now) + "&to=" + encodeURIComponent(now))
          .then(function (s) { if (s && s.ok && st.pulse && st.pulse.ok) { st.pulse.followups = { unbooked: s.unbookedRecalls || 0, overdue: s.overdueRecalls || 0 }; pulsePaint(); } }).catch(function () {});
      })
      .catch(function () { st.pulseBusy = false; st.pulse = { failed: true }; pulsePaint(); });
  }
  /* The front desk is NOT painted by paint() - it is rendered straight into the root by
   * renderFrontDesk - so a plain paint() here would replace a signed-in desk with the doctor's app.
   * And neither surface is rebuilt while somebody is typing in it: the staff form taught us that. */
  function pulsePaint() {
    var el = root(), ae = document.activeElement;
    if (ae && ae.closest && ae.closest("input, textarea, select")) return;
    if (el && el.querySelector(".q-fd")) { if (st.board) el.innerHTML = renderFrontDesk(st.board); return; }
    paint();
  }
  function pulseNum(v, unit) { return v == null ? '<u style="opacity:.5">not yet</u>' : esc(v) + (unit ? "<u>" + unit + "</u>" : ""); }
  function pulseCard(state) {
    if (!state.orgId) return "";                      // a personal clinic with no hospital has no OPD-wide day
    var M = G.SMD_OPD_PULSE, m = state.pulse && M ? M.model(state.pulse) : null;
    if (!m) return "";
    var head = '<div class="q-pulse-h"><b>OPD today</b>';
    if (m.failed) return '<section class="q-pulse">' + head + '<button class="q-ic" data-q-act="pulse" title="Retry">' + ms("refresh") + '</button></div><div class="q-pulse-warn">' + ms("error") + esc(m.message) + "</div></section>";
    var tiles = m.tiles.map(function (t) {
      var v = t.value == null ? '<u style="opacity:.5">not yet</u>' : esc(t.value) + (t.unit ? "<u>" + esc(t.unit) + "</u>" : "");
      var sub = t.action === "reconcile" ? '<button class="q-ic" data-q-act="reconcile" title="Send these visits to the record again">' + ms("sync") + "</button> " + esc(t.sub) : esc(t.sub || "");
      return '<div class="q-pulse-t' + (t.warn ? " warn" : "") + '"><div class="q-pulse-l">' + ms(t.icon) + esc(t.label) + '</div><div class="q-pulse-v">' + v + '</div><div class="q-pulse-s">' + sub + "</div></div>";
    }).join("");
    var note = m.note ? '<div class="q-pulse-note">' + ms("insights") + "Desk " + pulseNum(m.note.deskMin, "m") + ", doctor " + pulseNum(m.note.doctorMin, "m") + " &middot; " + esc(m.note.text) + "</div>" : "";
    return '<section class="q-pulse">' + head +
      (m.unread.length ? '<span class="q-pulse-warn-i" title="Some rooms could not be read: ' + esc(m.unread.join(", ")) + '">' + ms("error") + "</span>" : "") +
      '<button class="q-ic" data-q-act="pulse" title="Refresh the OPD figures">' + ms("refresh") + "</button></div>" +
      '<div class="q-pulse-row">' + tiles + "</div>" + note + "</section>";
  }

  function addStaff() {
    var nameEl = document.getElementById("qStaffName"), roleEl = document.getElementById("qStaffRole"), pinEl = document.getElementById("qStaffPin");
    var identity = ((nameEl && nameEl.value) || "").trim().toLowerCase(), role = (roleEl && roleEl.value) || "nurse", pin = ((pinEl && pinEl.value) || "").trim();   // lowercase so it always matches the staff login (mobile keyboards auto-capitalize; server match is case-sensitive)
    if (!identity) { try { G.toast && G.toast("Enter a login name"); } catch (e) {} return; }
    if (!/^\d{4,8}$/.test(pin)) { try { G.toast && G.toast("PIN must be 4 to 8 digits"); } catch (e) {} return; }
    apiPost("/member", { orgId: st.orgId, identity: identity, role: role }).then(function (r) {
      if (!r || !r.ok) { try { G.toast && G.toast("Could not add staff"); } catch (e) {} return null; }
      return apiPost("/member/pin", { orgId: st.orgId, identity: identity, pin: pin });
    }).then(function (r) {
      if (r && r.ok) { try { G.toast && G.toast("Staff added: " + identity); } catch (e) {} if (nameEl) nameEl.value = ""; if (pinEl) pinEl.value = ""; loadClinicAdmin(); }
      // The member exists but has no PIN yet: say why, rather than doing nothing at all.
      else if (r) { try { G.toast && G.toast("Staff added, but the PIN was not set: " + (r.message || r.error || "refused")); } catch (e) {} loadClinicAdmin(); }
    }).catch(function () { try { G.toast && G.toast("Could not add staff"); } catch (e) {} });
  }
  function clinicAdminHtml(state) {
    if (!state.orgId || state.ghisToken) return "";   // only a StewardMD-native clinic the doctor owns
    var ca = state.clinicAdmin || {};
    var code = ca.code ? esc(ca.code) : "loading…";
    var members = ca.members || [];
    var rows = members.length
      ? members.map(function (m) {
          /* Why this person cannot sign in, in the one place the owner can fix it. Five wrong PINs lock
           * the account for fifteen minutes and the sign-in screen will not say so (it must not confirm
           * which login names exist), so without this the owner is told "wrong PIN" for a PIN that is right. */
          var lockedMin = m.lockedUntil && m.lockedUntil > Date.now() ? Math.ceil((m.lockedUntil - Date.now()) / 60000) : 0;
          var why = lockedMin ? " · locked " + lockedMin + "m (too many tries)" : m.hasPin ? " · PIN set" : " · no PIN yet";
          return '<div class="q-staff-row"><div class="q-staff-id"><b>' + esc(m.identity || m.email || "staff") + "</b><span>" + esc(roleLabel(m.role)) + esc(why) + (m.active === false ? " · disabled" : "") + "</span></div>" +
            '<button class="q-ic q-rm" title="Remove access" aria-label="Remove access" data-q-act="staffremove:' + esc(m.identity) + '">' + ms("person_remove") + "</button></div>";
        }).join("")
      : '<div class="q-staff-empty">No team members yet. Add doctors, nursing, reception or billing below.</div>';
    return '<div class="q-profile-sec"><div class="q-sec-h">Clinic &amp; staff</div>' +
      '<div class="q-profile-row q-clinic-id"><span>' + ms("badge") + " Clinic ID</span><b class=\"mono\">" + code + '</b><button class="q-ic" title="Copy Clinic ID" aria-label="Copy Clinic ID" data-q-act="copyclinic:' + code + '">' + ms("content_copy") + "</button></div>" +
      '<div class="q-hint" style="margin:2px 0 10px">Staff open StewardMD on their phone, choose OPD Queue, then <b>I\'m front-desk staff</b>, and sign in with this Clinic ID, their login and PIN.</div>' +
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

  /* Plan item 12: priority with a reason. The reason sets the level on the server (_queue_eta.js
   * priorityRule): an emergency goes first, the rest ahead of the ordinary queue; "clear" is a reason too. */
  var PRIO = [["emergency", "Emergency"], ["senior", "Senior citizen"], ["pregnant", "Pregnant"], ["disability", "Disability"], ["child", "Child"], ["results", "Results ready"], ["other", "Other"]];
  function prioLabel(t) { if (!t || !t.priority) return ""; if (t.priority >= 2) return "Emergency"; var m = PRIO.filter(function (p) { return p[0] === t.priorityReason; })[0]; return m ? m[1] : "Priority"; }
  function renderPrioSheet(p) {
    var list = PRIO.slice(); if (p.cur) list.push(["clear", "Clear priority"]);
    return '<div class="q-sheet" data-q-act="prio-close"><div class="q-profile" data-q-act="prio-stop" role="dialog" aria-label="Set priority">' +
      '<div class="q-profile-head"><button class="q-ic q-profile-x" data-q-act="prio-close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="q-prio-h"><b>Priority</b> <span>(reason required)</span></div>' +
      '<p class="q-prio-p">The reason sets the place: an emergency goes first, the others ahead of the ordinary queue. Recorded in the audit trail.</p>' +
      '<div class="q-prio-chips" role="group" aria-label="Priority reason">' + list.map(function (c) {
        return '<button type="button" class="q-prio-chip' + (p.reason === c[0] ? " on" : "") + '" aria-pressed="' + (p.reason === c[0]) + '" data-q-act="prio-pick:' + c[0] + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<input id="qPrioNote" class="q-prio-note" aria-label="Priority note" placeholder="Note (required for Other)" value="' + esc(p.note || "") + '">' +
      '<button class="q-pbtn q-prio-ok" data-q-act="prio-set">Set priority</button>' +
      "</div></div>";
  }
  function prioNote() { var n = document.getElementById("qPrioNote"); return n ? String(n.value || "").trim() : ""; }

  // Doctor profile sheet - opened from the header avatar. Identity + status + switch clinic + sign out.
  function renderProfile(state, doctorName, dept) {
    var s = state.session || {};
    var status = s.doctorStatus ? cap(s.doctorStatus) : (s.status === "paused" ? "Paused" : "Online");
    return '<div class="q-sheet" data-q-act="profile-close"><div class="q-profile" data-q-act="profile-stop" role="dialog" aria-label="Doctor profile">' +
      // Sticky X: aria-label="Close" is also what swipe-back.js BACK_SEL matches, so the Android
      // back gesture and hardware button close the sheet too.
      '<div class="q-profile-head"><button class="q-ic q-profile-x" data-q-act="profile-close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="q-profile-top"><div class="q-avatar q-avatar-lg">' + esc(initials(doctorName)) + "</div>" +
      '<div class="q-profile-id"><b>' + esc(doctorName) + "</b><span>" + esc(dept) + "</span></div></div>" +
      (state.ghisUser ? '<div class="q-profile-row">' + ms("badge") + "<span>GHIS ID</span><b>" + esc(state.ghisUser) + "</b></div>" : "") +
      '<div class="q-profile-row">' + ms("stethoscope") + "<span>Status</span><b>" + esc(status) + "</b></div>" +
      clinicAdminHtml(state) +
      '<div class="q-profile-acts">' +
        (q2On() && s.id && !state.demo ? '<button class="q-pbtn" data-q-act="pause">' + ms(s.status === "paused" ? "play_circle" : "pause_circle") + (s.status === "paused" ? "Resume the queue" : "Pause the queue") + "</button>" : "") +
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
      (a.revenueToday != null ? '<div class="q-out"><span>Revenue today</span><b>&#8377;' + a.revenueToday + "</b></div>" : a.revenueUnread ? '<div class="q-out"><span>Revenue today</span><b>Could not be read</b></div>' : "") +
      (a.followupCompliancePct != null ? '<div class="q-out"><span>Follow-up compliance</span><b>' + a.followupCompliancePct + "%</b></div>" : "") +
      "</div>";
    return '<h2 class="q-h2">' + ms("analytics") + "Performance analytics</h2>" + kpis + '<section class="q-grid2">' + eta + peak + out + "</section>";
  }

  // ---- Settings view (Stitch queue_configuration_settings port) ---------------------------
  function num(k, label, val, hint) { return '<div class="q-fld"><label for="qCfg_' + k + '">' + label + '</label><input type="number" inputmode="numeric" min="1" id="qCfg_' + k + '" data-cfg="' + k + '" value="' + esc(val) + '"><span class="q-hint">' + (hint || "") + "</span></div>"; }
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
  /* Whether this phone's cases are really backed up. hasPassword() is a PROMISE: the card used to test
   * it with !!, which is always true, so "Back up to Drive now" and an "On" switch showed on a phone
   * where no backup had ever been set up. st.backup.hasPw: null = not known yet, false = not set up. */
  function loadBackupState() {
    var C = G.SMD_CLINIC, last = 0;
    try { last = (C && C.lastBackupAt && C.lastBackupAt()) || 0; } catch (e) {}
    if (!C || !C.hasPassword) { st.backup = { hasPw: false, last: last }; return; }
    st.backup = { hasPw: st.backup ? st.backup.hasPw : null, last: last };
    var done = function (has) { st.backup = { hasPw: !!has, last: last }; paintStorageCard(); };
    try { Promise.resolve(C.hasPassword()).then(done, function () { done(false); }); } catch (e) { done(false); }
  }
  // Only the card: a full repaint of Settings would wipe numbers the doctor has typed but not saved.
  function paintStorageCard() {
    if (st.view !== "settings") return;
    var el = document.getElementById("qStorageCard"); if (!el) return;
    try { el.outerHTML = storageCard(); } catch (e) {}
  }
  function backupWhen(ms) {
    try { return new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
  }
  function storageCard() {
    if (!emrOn()) return "";   // storage is only meaningful when the EMR/assessment is on
    var shared = opdStorageMode() === "shared";
    var where = "get a clinic ID (<b>SMD-" + esc(clinicCode()) + "-nnn</b>) and save to your clinic " + (shared ? "(synced across your devices)." : "on this device.");
    // A personal clinic has no GHIS: only a hospital workplace is told about it.
    var intro = inClinicWorkplace()
      ? "Each patient's notes are saved to your clinic " + (shared ? "and synced across your devices." : "on this phone.") + " A patient added without an MR number gets a clinic ID (<b>SMD-" + esc(clinicCode()) + "-nnn</b>)."
      : "Patients with a hospital MRN save to GHIS. Patients with no MRN " + where;
    var head = '<div class="q-card" id="qStorageCard"><div class="q-card-h">' + ms("cloud_done") + "Case storage</div>" +
      '<div class="q-hint q-hint-lead">' + intro + "</div>";
    // ONE clinic, two modes - My Clinic (this device) or Shared Clinic (multi-device sync).
    var sel = '<div class="q-hint q-hint-h">Where cases are saved</div>' +
      localTog("This device only", !shared, "My Clinic - stays on this phone", "storagemode:device") +
      localTog("Shared across my devices", shared, "Encrypted, synced to your clinic Google Drive - open on any of your devices", "storagemode:shared");
    var ctrls;
    if (shared) {
      var app = (G.SMD_SHARED && G.SMD_SHARED.app && G.SMD_SHARED.app());
      var status = !app ? "Not unlocked on this device"
        : (app.conflictCount && app.conflictCount() ? (app.conflictCount() + " to review")
          : (app.pendingCount && app.pendingCount() ? (app.pendingCount() + " to sync") : "All synced"));
      ctrls = '<div class="q-hint q-hint-status">Shared clinic · ' + esc(status) + "</div>" +
        '<button class="q-set-btn" data-q-act="sharedsetup">' + ms("group") + (app ? " Manage shared clinic" : " Set up / unlock shared clinic") + "</button>" +
        (app ? '<button class="q-set-btn" data-q-act="sharedsync">' + ms("cloud_sync") + " Sync now</button>" : "");
    } else {
      var bk = st.backup || { hasPw: null, last: 0 };
      var autoOn = storeAutoSyncOn();
      if (bk.hasPw === true) {
        ctrls = localTog("Back up all cases to Google Drive", autoOn, autoOn ? "On · every case backs up ~15s after you save" : "Off · back up each case manually", "storagetoggle") +
          '<div class="q-hint q-hint-status" role="status">' + (bk.last ? "Last backup: " + esc(backupWhen(bk.last)) : "No backup has completed yet.") + "</div>" +
          '<button class="q-set-btn" data-q-act="storagesync">' + ms("cloud_upload") + " Back up to Drive now</button>";
      } else if (bk.hasPw === false) {
        ctrls = '<div class="q-warn" role="status">' + ms("cloud_off") + "<span><b>Not backed up.</b> Notes are only on this phone. If the app is removed or the phone is lost, they are gone.</span></div>" +
          '<button class="q-set-btn" data-q-act="storagesetup">' + ms("lock") + " Set up Google Drive backup</button>";
      } else {
        ctrls = '<div class="q-hint q-hint-status" role="status">Checking the backup on this phone…</div>';
      }
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
      loadBackupState();
    });
  }
  function settingsCanvas(state) {
    var c = state.config;
    var head = '<div class="q-set-hd"><h2 class="q-h2" style="margin:0">' + ms("settings") + "Queue configuration</h2>" +
      (c && !q2On() ? '<button class="q-finish" style="font-size:14px;padding:10px 18px" data-q-act="savecfg">' + ms("save") + " Save changes</button>" : "") +
      (c && q2On() ? '<span class="q-hint" id="qCfgSaved" role="status">Changes save as you make them.</span>' : "") + "</div>";
    var layoutCard = '<div class="q-card"><div class="q-card-h">' + ms("view_agenda") + "Queue screen</div>" +
      localTog("New queue layout", q2On(), "The next patient gets one labelled button; other actions open from the patient's row. Turn off to go back.", "q2toggle") + "</div>";
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
    return head + '<section class="q-grid2">' + storageCard() + cfgCards + layoutCard + "</section>";
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
  /* S3 P1: critical-result alerts follow the hospital this phone works in. native-push.js binds the phone
   * to that hospital identity (and unbinds on staff sign-out, called BEFORE the token is cleared so the
   * request can still authenticate). Inert unless smd_wsq_push is on, and on the web. */
  function wsqAlerts(fn, orgId, quiet) { try { if (orgId && G.SMD_WSQ_PUSH) G.SMD_WSQ_PUSH[fn](orgId, !quiet); } catch (e) {} }
  function staffCan(cap) { return !!(st.staffWho && st.staffWho.caps && st.staffWho.caps.indexOf(cap) > -1); }
  /* The hospital a request is for: the clinic or front desk in st.orgId, else the Connect/WardSynQ hospital
   * whose session is open. A GHIS session is no StewardMD hospital, so "". */
  function requestOrg() {
    var o = st.openOpts || {};
    return st.orgId || ((o.source === "wardsynq" || o.source === "connect") ? String(o.hospitalId || "") : "");
  }
  // A staff token wins when present: it is how the server knows this is reception, not the doctor.
  // S3 ID-01 (hospital-auth.js): but only for the hospital it was minted for. A stale session from another
  // hospital is never sent; the account bearer is. Tokens that name no hospital, and pages without
  // hospital-auth.js (test/opd-doctor-harness.html), keep the old rule.
  function authHeaders() {
    var t = staffTok(), HA = G.SMD_HOSPITAL_AUTH, bound = HA && t ? HA.staffTokenOrg(t) : "";
    if (bound && bound !== requestOrg()) t = "";
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
  var swipeAt = 0;
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
      if (!dragging) return; dragging = false; swipeAt = now();
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
    try { liveActivity(); } catch (e) {}
    var r = root();
    // While the user is typing in search, DON'T rebuild the DOM - a full innerHTML swap blurs
    // the input and closes the Android soft keyboard. Refresh only the filtered rows in place.
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("q-tl-search")) {
      var box = document.getElementById("qTlRows"); if (box) box.innerHTML = timelineRows(st);
      return;
    }
    /* SAME RULE FOR ANY FIELD IN THE PROFILE SHEET, which is where staff are added. A repaint here
     * is not a cosmetic flicker: the login name and PIN being typed are wiped, the keyboard closes,
     * and a half-typed PIN submitted afterwards creates a member the nurse then cannot sign in as.
     * The sheet is a modal - nothing behind it is being read - so skipping the rebuild costs
     * nothing and the next click paints it. */
    if (ae && ae.closest && ae.closest(".q-profile")) return;
    // Preserve scroll across the 8s poll repaint (rebuild otherwise yanks the list to the top).
    var prev = r.querySelector(".q-canvas"), top = prev ? prev.scrollTop : 0;
    r.innerHTML = _render(st);
    var next = r.querySelector(".q-canvas"); if (next && top) next.scrollTop = top;
    try { initConsultSwipe(); } catch (e) {}
  }

  /* Plan item 16: the board is told when the hospital's queue changes (opd-live.js over GET /live) instead of only
   * finding out at the next 8-second poll. While the stream is live a poll fetches only when told, or once a minute
   * as a safety net; when it is not live the polls run as before. Hospital modes only (a personal clinic has no org). */
  var LIVEQ = null, liveOrg = "", lastFull = 0, liveFn = null;   // liveFn: the poll of the screen now showing
  function liveStart(onChange) {
    liveFn = onChange;
    if (!G.SMD_OPD_LIVE || !st.orgId || st.demo) return;
    if (LIVEQ && liveOrg === st.orgId) return;
    if (LIVEQ) LIVEQ.stop();
    liveOrg = st.orgId;
    LIVEQ = G.SMD_OPD_LIVE.connect({ url: G.SMD_OPD_LIVE.apiUrl(API + "/live?orgId=" + encodeURIComponent(st.orgId)), headers: authHeaders,
      onChange: function () { lastFull = 0; try { if (liveFn) liveFn(); } catch (e) {} } });
  }
  function liveStop() { if (LIVEQ) LIVEQ.stop(); LIVEQ = null; liveOrg = ""; }
  function liveQuiet() {
    if (LIVEQ && LIVEQ.isLive() && Date.now() - lastFull < 60000) return true;
    lastFull = Date.now(); return false;
  }

  function refresh() {
    /* demo has no server session; don't clobber unsaved settings mid-poll; and the profile sheet
     * (Clinic and staff) is a form the owner is filling in, for the same reason settings is. */
    if (st.demo || !st.session || st.view === "settings" || st.profileOpen || st.prioSheet || st.rowSheet || st.confirm || st.recallSheet) return;
    st.pollN = (st.pollN || 0) + 1;
    // real-time-ish sync: silently re-pull today's GHIS Out-patients list every ~5 polls (~40s) so newly
    // registered patients appear without a manual import (dedupes server-side by visit id).
    if (st.ghisToken && st.pollN % 5 === 0 && (!G.SMD_QUEUE_FLAGS || !G.SMD_QUEUE_FLAGS.bool || G.SMD_QUEUE_FLAGS.bool("smd_opd_queue_import"))) { try { importOpd(true); } catch (e) {} }
    if (st.openOpts && st.openOpts.source === "connect" && st.pollN % 5 === 0) { try { importFromSource(true); } catch (e) {} }   // re-pull the connected EMR worklist periodically
    if (liveQuiet()) return;   // plan item 16: live and nothing changed
    apiGet("/list?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) { if (r && r.ok) { st.tickets = r.tickets || []; paint(); } }).catch(function () {});
    loadPulse();   // every fourth pass, hospital-wide (see loadPulse)
  }
  function act(sessId, path, body) { body = body || {}; body.sessionId = sessId; return apiPost(path, body).then(function (r) { if (r && r.ok && r.tickets) { st.tickets = r.tickets; paint(); } else if (r && r.ok && r.session) { st.session = r.session; paint(); } return r; }); }
  function switchView(view) {
    if (view === "queue") view = "dashboard";
    if (view !== "dashboard" && view !== "analytics" && view !== "settings") return;
    st.view = view; paint();
    if (st.demo) return;   // demo has no server session to fetch analytics/config from
    if (view === "analytics" && st.session) apiGet("/analytics?sessionId=" + encodeURIComponent(st.session.id)).then(function (r) { if (r && r.ok && st.view === "analytics") { st.analytics = r.analytics; paint(); } }).catch(function () {});
    if (view === "settings") loadBackupState();
    if (view === "settings") apiGet("/config").then(function (r) { if (r && r.ok && st.view === "settings") { st.config = r.config; paint(); } }).catch(function () {});
  }
  function saveCfg(quiet) {
    var cfg = {};
    root().querySelectorAll("[data-cfg]").forEach(function (inp) { cfg[inp.getAttribute("data-cfg")] = inp.type === "checkbox" ? inp.checked : Number(inp.value); });
    // quiet = autosave: no repaint (it would take the field the doctor is still typing in), one line of status.
    var say = function (m) { var el = document.getElementById("qCfgSaved"); if (quiet && el) el.textContent = m; else { try { G.toast && G.toast(m); } catch (e) {} } };
    apiPost("/config", { config: cfg }).then(function (r) {
      if (r && r.ok) { st.config = r.config; if (!quiet) paint(); say(quiet ? "Saved." : "Settings saved"); }
      else say("Not saved: " + ((r && (r.message || r.error)) || "no response") + ".");
    }).catch(function () { say("Not saved: the server could not be reached."); });
  }
  var cfgTimer = 0;
  function onChange(e) {
    var t = e && e.target; if (!t || !t.getAttribute || !t.getAttribute("data-cfg") || !q2On() || st.demo) return;
    clearTimeout(cfgTimer); cfgTimer = setTimeout(function () { saveCfg(true); }, 600);
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
    if (cmd === "row-stop") return;                                    // a tap inside a sheet's card
    if (cmd === "row-close") { st.rowSheet = null; paint(); return; }
    if (cmd === "confirm-close") { st.confirm = null; paint(); return; }
    if (cmd === "recall-close") { st.recallSheet = null; paint(); return; }
    if (cmd === "row") { st.rowSheet = { ticketId: arg }; paint(); return; }
    if (cmd === "q2toggle") { try { localStorage.setItem("smd_opd_q2", q2On() ? "0" : "1"); } catch (e) {} st.rowSheet = st.confirm = st.recallSheet = st.snack = null; if (q2On() && st.orgId) loadClinicName(st.orgId); paint(); return; }
    if (cmd === "snack-undo") { var su = st.snack && st.snack.undo; st.snack = null; clearTimeout(snackTimer); paint(); if (su) su(); return; }
    if (st.rowSheet && cmd !== "prio-pick") st.rowSheet = null;        // an action picked from the row sheet closes it
    if (cmd === "clearsearch") { st.search = ""; paint(); return; }
    if (cmd === "chooser") { _setWp(""); root().innerHTML = _chooseType(); return; }     // back to Hospital / Personal clinic (forgets remembered workplace)
    if (cmd === "docprofile") { st.profileOpen = true; paint(); loadClinicAdmin(); return; }
    if (cmd === "copyclinic") { copyText(arg); return; }
    if (cmd === "addstaff") { addStaff(); return; }
    if (cmd === "staffremove") { var okrm = true; try { okrm = window.confirm("Remove this staff member's access?"); } catch (e) {} if (okrm) apiPost("/member", { orgId: st.orgId, identity: arg, remove: true }).then(function () { loadClinicAdmin(); }); return; }
    if (cmd === "profile-close") { st.profileOpen = false; paint(); return; }
    if (cmd === "profile-stop") return;   // click inside the profile card: do nothing (don't close)
    if (cmd === "prio-close") { st.prioSheet = null; paint(); return; }
    if (cmd === "prio-stop") return;
    if (cmd === "prio-pick") { if (st.prioSheet) { st.prioSheet.note = prioNote(); st.prioSheet.reason = arg; paint(); } return; }
    if (cmd === "prio-set") {
      var ps = st.prioSheet; if (!ps || !st.session) return;
      var pnote = prioNote();
      if (!ps.reason) { try { G.toast && G.toast("Pick a reason"); } catch (e) {} return; }
      if (ps.reason === "other" && pnote.length < 3) { try { G.toast && G.toast("Say why in the note"); } catch (e) {} return; }
      st.prioSheet = null; paint();
      act(st.session.id, "/priority", { ticketId: ps.ticketId, reason: ps.reason, note: pnote }).then(function (r) { if (!(r && r.ok)) { try { G.toast && G.toast("Priority not changed: " + ((r && (r.message || r.error)) || "no response")); } catch (e) {} } });
      return;
    }
    if (cmd === "switch") { liveStop(); _setWp(""); clearInterval(st.pollId); st.session = null; st.tickets = []; st.demo = false; st.ghisToken = null; st.profileOpen = false; st.orgId = null; st.clinicAdmin = null; root().innerHTML = _chooseType(); return; }  // dashboard back -> switch workplace (forget remembered); drop clinic identity so the next workplace never shows a stale clinic's staff-admin
    if (cmd === "typehosp") { _listHospitals(); return; }                               // Hospital -> pick a connected hospital
    if (cmd === "typeclinic") { _listClinics(); return; }                               // Personal clinic -> pick one
    if (cmd === "rolestaff") { root().innerHTML = _staffGate(); prefillStaff(); return; }   // front-desk staff -> sign in HERE
    if (cmd === "pickghis") { _setWp("ghis"); _enterGhis(); return; }  // GITAM / GHIS: reuse a live token if present (no needless re-login), else the prefilled gate
    if (cmd === "pickhosp") { _setWp("connect:" + arg); st.ghisToken = null; st.openOpts = { hospitalId: arg, source: "connect" }; loadSession(); return; }   // EMR-Connect hospital: worklist model (auto-import from the connected EMR, like GHIS). Drop any GHIS token: not a GHIS session.
    if (cmd === "pickwsq") { _setWp("wardsynq:" + arg); wsqAlerts("bind", arg); st.ghisToken = null; st.openOpts = { hospitalId: arg, source: "wardsynq" }; loadSession(); return; }   // WardSynQ-native hospital: no external EMR at all, no GHIS token, no auto-import.
    if (cmd === "pickclinic") { _setWp("clinic:" + arg); st.ghisToken = null; startClinic(arg); return; }     // a personal clinic (remembered so re-opening returns here, not GHIS). Drop any GHIS token: not a GHIS session.
    if (cmd === "pickroom") { var pr = arg.split("~"); loadRoom(pr[0], pr[1] || ""); return; }   // doctor picked their room
    if (cmd === "newclinic") { root().innerHTML = _newClinicForm(); try { var nc = document.getElementById("qNcName"); if (nc) nc.focus(); } catch (e) {} return; }
    if (cmd === "newclinicgo") { createClinic(); return; }
    if (cmd === "addhosp") { try { window.open("https://stewardmd.in/admin/connect-emr", "_blank"); } catch (e) { try { location.href = "https://stewardmd.in/admin/connect-emr"; } catch (x) {} } return; }  // reuse the Connect EMR onboarding wizard
    if (cmd === "stafflogin") { staffLogin(); return; }
    if (cmd === "staffout") { if (!signOutDesk()) return; wsqAlerts("unbind", (G.SMD_HOSPITAL_AUTH && G.SMD_HOSPITAL_AUTH.staffTokenOrg(staffTok())) || st.orgId); setStaffTok(""); try { if (G.StewardIdentityResolver && G.StewardIdentityResolver.clearCache) G.StewardIdentityResolver.clearCache(); } catch (e) {} st.staffWho = null; st.board = null; clearInterval(st.pollId); root().innerHTML = _chooseType(); return; }
    if (cmd === "fdrefresh") { loadFrontDesk(); return; }
    if (cmd === "pulse") { loadPulse(true); return; }
    if (cmd === "reconcile") {
      apiPost("/opd-reconcile", { orgId: st.orgId }).then(function (r) {
        try { G.toast && G.toast(r && r.ok ? (r.landed + " of " + r.retried + " visits now in the record" + (r.stillFailed ? "; " + r.stillFailed + " still failing" : "")) : "Could not retry now"); } catch (e) {}
        loadPulse(true);
      }).catch(function () { try { G.toast && G.toast("Could not retry now"); } catch (e) {} });
      return;
    }   // the OPD figures, now rather than on the next pass
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
    if (cmd === "confirm-ok") { var cf = st.confirm; st.confirm = null; paint(); if (cf && cf.run) cf.run(); return; }
    if (cmd === "endask") {
      if (now() - swipeAt < 500) return;   // the click a mouse drag leaves behind
      var ct = findTicket(st.session && st.session.currentTicketId) || (st.tickets || []).filter(function (x) { return x.status === "in_consultation"; })[0];
      ask({ title: "End this consult?", bodyHtml: ct ? nameV2(ct) + " leaves the room and the queue moves on." : "", ok: "End consult", run: function () { act(sid, "/advance"); } });
      return;
    }
    if (cmd === "recall-ok") {
      var rw = document.getElementById("qRecallWhy"), why2 = rw ? String(rw.value || "").trim() : "", rs = st.recallSheet;
      if (why2.length < 3) { try { G.toast && G.toast("Give a reason for the recall."); } catch (e) {} return; }
      st.recallSheet = null; paint();
      if (rs) doRecall(sid, rs.ticketId, why2);
      return;
    }
    if (q2On() && cmd === "remove") {
      var rt = findTicket(arg);
      ask({ title: "Remove from the queue?", bodyHtml: (rt ? nameV2(rt) + ". " : "") + "For a mistaken, duplicate or wrongly routed entry. This cannot be undone and is recorded in the audit trail.", ok: "Remove from queue", danger: true,
        run: function () { act(sid, "/status", { ticketId: arg, status: "cancelled" }).then(function (r) { if (!(r && r.ok)) { try { G.toast && G.toast("Not removed: " + ((r && (r.message || r.error)) || "no response")); } catch (e) {} } }); } });
      return;
    }
    if (q2On() && cmd === "noshow") {
      paint();
      act(sid, "/status", { ticketId: arg, status: "no_show" }).then(function (r) {
        if (!(r && r.ok)) { try { G.toast && G.toast("Not marked: " + ((r && (r.message || r.error)) || "no response")); } catch (e) {} return; }
        snack("Marked as did not come. They can be recalled for 4 hours.", function () { doRecall(sid, arg, "Marked no-show by mistake"); });
      });
      return;
    }
    if (q2On() && cmd === "recall") { st.recallSheet = { ticketId: arg }; paint(); return; }
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
    else if (cmd === "noshow") { var okn = true; try { okn = window.confirm("Mark as no-show?\n\nThe patient did not come when called. They can be recalled with the same token for 4 hours."); } catch (e) {} if (okn) act(sid, "/status", { ticketId: arg, status: "no_show" }).then(function (r) { if (!(r && r.ok)) { try { G.toast && G.toast("Not marked no-show: " + ((r && (r.message || r.error)) || "no response")); } catch (e) {} } }); }
    else if (cmd === "noshows") loadNoShows();
    else if (cmd === "noshowsclose") { st.noShows = undefined; paint(); }
    else if (cmd === "recall") recallNoShow(sid, arg);
    else if (cmd === "sendback") act(sid, "/status", { ticketId: arg, status: "waiting" });   // reroute from the consulting room back to the waiting hall (personal + hospital)
    else if (cmd === "prio") { var pt = (st.tickets || []).filter(function (x) { return x.id === arg; })[0]; st.prioSheet = { ticketId: arg, cur: (pt && pt.priority) || 0, reason: "", note: "" }; paint(); }   // plan item 12: pick a reason; the reason sets the level
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
      act(st.session.id, "/import", { rows: rows }).then(function (res) {
        if (res && res.ok && res.imported) { say("Imported " + res.imported + " patient(s)"); }
        importIssuesSay(res);   // shown even on a silent import: a patient left out of the queue is never quiet
      });
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
    var o = { name: t.name || "", ticketId: t.id, sessionId: st.session && st.session.id, vitals: t.vitals || null,
      orgId: st.orgId || (st.session && (st.session.orgId || st.session.hospitalId)) || "" };   // MaikOS: triage vitals prefill + unified catalog scope ride into the EMR
    if (tab) o.tab = tab;
    // Hospital workplace (GHIS / Connect / WardSynQ) with a real hospital id -> the hospital record.
    if (t.ghisPatientId && !inClinicWorkplace()) {
      o.patientId = t.ghisPatientId || t.mrn || "";
      o.episodeId = t.ghisEpisodeId || t.visitId || "";
      o.visitId = t.visitId || t.ghisEpisodeId || "";
      // WardSynQ-native hospital: the ONLY case where opd-emr.js must not default to "ghis". Every
      // other hospital workplace (GHIS, Connect) is unaffected - o.source stays unset for them, exactly
      // as before.
      if (st.openOpts && st.openOpts.source === "wardsynq") o.source = "wardsynq";
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
  /* Find-or-create the on-device clinic record for an OPD ticket.
   *
   * BUGFIX (2026-11-09): the record was keyed by TICKET id alone. A returning patient gets a new ticket
   * every visit, so every visit made a new record with a new SMD-<code>-<seq> number and the earlier
   * notes were not in front of the doctor. The PATIENT is the key now: the MR number the server issued
   * (it rides on the ticket as ghisPatientId, and carries the clinic's code, so two clinics cannot
   * collide). A ticket with no MR number still gets its own record. Reversible: smd_opd_patient_key=0. */
  function localClinicId(t, store, mapKey) {
    var MAP = mapKey || "stewardmd.opd.localmap", map = {};
    try { map = JSON.parse(localStorage.getItem(MAP) || "{}") || {}; } catch (e) {}
    function keep() { try { localStorage.setItem(MAP, JSON.stringify(map)); } catch (e) {} }
    var id = map[t.id];
    if (id && store.getPatient && store.getPatient(id)) return id;
    var all = (store.listPatients && store.listPatients()) || [];
    var mrn = String(t.ghisPatientId || t.mrn || "").trim();
    if (mrn && patientKeyOn()) {
      var pk = "mrn:" + mrn.toUpperCase();
      id = map[pk];
      if (!(id && store.getPatient && store.getPatient(id))) {
        id = "";
        // A record restored from backup, or made on another device, is not in this phone's map: find it by number.
        for (var a = 0; a < all.length; a++) { if (String(all[a].mrn || "").trim().toUpperCase() === mrn.toUpperCase()) { id = all[a].id; break; } }
      }
      if (!id) id = store.addPatient({ name: t.name || "Patient", mrn: mrn });
      map[t.id] = id; map[pk] = id; keep();
      return id;
    }
    // No MR number on the ticket: SMD-<clinic code>-<seq>. The next number is one past the highest in
    // use, never "how many records there are", which repeats a number after a record is deleted.
    var code = clinicCode(), pre = "SMD-" + code + "-", hi = all.length;
    for (var b = 0; b < all.length; b++) {
      var m = String(all[b].mrn || "");
      if (m.indexOf(pre) === 0) { var nn = parseInt(m.slice(pre.length), 10); if (nn > hi) hi = nn; }
    }
    id = store.addPatient({ name: t.name || "Patient", mrn: pre + padSeq(hi + 1) });
    map[t.id] = id; keep();
    return id;
  }
  // Open the Initial Assessment (+ Ask MaiK) for this patient (EMR overlay, "assess" tab).
  function openAssessment(ticketId) { openTicketEmr(ticketId, "assess"); }
  /* D7: the hospital's departments and token numbering, for the check-in sheet's department picker.
   * cb({departments, required}): departments undefined = no hospital to ask (no picker), null = the list
   * could not be loaded (the sheet says so, never "no departments"). */
  function withDepartments(orgId, cb) {
    // A GHIS workplace has no StewardMD hospital record (its hospital id is not an org): no picker there.
    if (!orgId || st.ghisToken) { cb({ departments: undefined, required: false }); return; }
    apiGet("/org?orgId=" + encodeURIComponent(orgId)).then(function (o) {
      if (o && o.error === "org_not_found") { cb({ departments: undefined, required: false }); return; }
      if (!o || !o.ok) { cb({ departments: null, required: false }); return; }
      cb({ departments: o.departments || [], required: !!(o.org && o.org.tokens && o.org.tokens.scope === "department") });
    }, function () { cb({ departments: null, required: false }); });
  }
  /* D7/D14: EMR rows the token rules refused (a department this hospital has not mapped, or one with no
   * prefix) are named by department so the admin knows which alias or prefix to add. Once per distinct
   * message, so a 40-second poll does not repeat the same toast. */
  function importIssuesSay(r) {
    var iss = (r && r.issues) || [];
    if (!iss.length) return;
    var names = {}; iss.forEach(function (x) { names[x.department || "no department"] = 1; });
    var m = iss.length + " patient(s) not queued from the EMR: department " + Object.keys(names).join(", ") +
      " has no token department or prefix here. An administrator adds it under Admin Center, Hospital, OPD token numbers.";
    if (st.lastImportIssue === m) return;
    st.lastImportIssue = m;
    try { G.toast && G.toast(m); } catch (e) {}
  }
  // After registration, the queue add's own answer: a refused add is never reported as queued.
  function queuedSay(r, q) {
    var m = (q && q.ok) ? ("Added - " + pv("id", r.mrn) + (q.ticket && q.ticket.token ? " - token " + q.ticket.token : ""))
      : ("Registered " + pv("id", r.mrn) + " but NOT queued: " + ((q && (q.message || q.error)) || "the server could not be reached."));
    try { G.toast && G.toast(m); } catch (e) {}
  }
  function openAdd() {
    // The check-in sheet (patient-register.js) is shared with the staff web console, so the two can
    // never drift apart again. It replaced four sequential prompt() boxes. The SERVER validates and
    // issues the MR number - this only carries the answers and renders the field errors it returns.
    if (!(G.SMD_PATIENTREG && G.SMD_PATIENTREG.open)) { toast("Patient check-in is unavailable on this build."); return; }
    var mode = inClinicWorkplace() ? "native" : (st.ghisToken ? "ghis" : ((st.openOpts && st.openOpts.source === "connect") ? "connect" : ((st.openOpts && st.openOpts.source === "wardsynq") ? "wardsynq" : "native")));
    withDepartments(st.orgId || (st.openOpts && st.openOpts.hospitalId) || "", function (dp) {
    G.SMD_PATIENTREG.open({
      mode: mode,
      clinicName: (st.me && st.me.name) || (st.session && st.session.doctorName) || "Check-in",
      departments: dp.departments, departmentRequired: dp.required,
      /* One patient lookup for every carrier (QR, Ni-Key, barcode, typed): the server's, so a patient registered on another device is found. */
      resolve: function (id) { return apiGet("/patient/resolve?orgId=" + encodeURIComponent(st.orgId || st.hospital || "") + "&id=" + encodeURIComponent(id)); },
      /* Find an existing patient by name, phone, MRN or StewardID (server: GET /patient/search). */
      search: function (term) { return apiGet("/patient/search?orgId=" + encodeURIComponent(st.orgId || st.hospital || "") + "&q=" + encodeURIComponent(term)); },
      /* A found patient goes straight into today's queue as a follow-up with their own MR number: nothing is registered twice. */
      useExisting: function (p, extra) {
        var sid2 = st.session && st.session.id;
        if (!sid2) return Promise.resolve({ ok: false, message: "Reopen OPD Queue to add them to today's list." });
        return act(sid2, "/ticket", {
          name: p.name, mrn: p.mrn, mobile: p.mobile, visitType: "followup", priority: 0,
          departmentId: (extra && extra.departmentId) || ""
        }).then(function (q) {
          if (q && q.ok) { queuedSay({ mrn: p.mrn, patient: p }, q); return { ok: true }; }
          return { ok: false, message: (q && (q.message || q.error)) || "Could not add the patient to the queue." };
        }, function () { return { ok: false, message: "Could not add the patient to the queue. Check your connection and try again." }; });
      },
      submit: function (body) {
        body.orgId = st.orgId || st.hospital || "";
        body.workplaceMode = mode;
        body.forQueue = "session";
        return apiPost("/patient/register", body);
      },
      onAdded: function (r, sent) {
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
          visitType: (r.patient && r.patient.visitType) === "followup" ? "followup" : "new", priority: 0,
          departmentId: (sent && sent.departmentId) || ""
        }).then(function (q) { queuedSay(r, q); }, function () { queuedSay(r, null); });
      }
    });
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
      // WardSynQ-native hospitals: WardSynQ itself is the EMR/HIS - no external EMR, no GHIS. Its own
      // action (pickwsq) so the workplace routes into the WardSynQ record, never the on-device store.
      ((r && r.orgs) || []).filter(function (o) { return o.mode === "wardsynq"; }).forEach(function (o) {
        rows += '<button class="q-gate-btn" style="text-align:left;margin-top:10px" data-q-act="pickwsq:' + esc(o.id) + '">' + ms("local_hospital") + " " + esc(o.name || "Hospital") + "<br><small style=\"opacity:.85;font-weight:400\">" + esc(o.code || "") + " · WardSynQ EMR</small></button>";
      });
      rows += '<button class="q-gate-btn" style="margin-top:12px;background:#f1f5f9;color:#0f172a" data-q-act="addhosp">' + ms("add_business") + " Add hospital (Connect EMR)</button>";
      el.innerHTML = _wrap('<p class="q-gate-sub">Choose your hospital.</p>' + rows + '<button class="q-gate-close" data-q-act="chooser">Back</button>');
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  // The doctor's personal (native, no-EMR) clinics. Here the WhatsApp visit link is the record.
  // Excludes "connect" (Connect EMR hospital) AND "wardsynq" (WardSynQ-EMR hospital, listed in
  // _listHospitals instead) - only a genuine on-device personal/shared clinic belongs here.
  function _listClinics() {
    var el = root(); el.innerHTML = _wrap('<div class="q-empty" style="padding:40px 8px">Loading your clinics…</div>');
    apiGet("/orgs").then(function (r) {
      var mine = ((r && r.orgs) || []).filter(function (o) { return o.mode !== "connect" && o.mode !== "wardsynq"; });
      var rows = mine.length ? mine.map(function (o) {
        return '<button class="q-gate-btn" style="text-align:left;margin-top:10px" data-q-act="pickclinic:' + esc(o.id) + '">' + ms("home_health") + " " + esc(o.name || "Clinic") + "<br><small style=\"opacity:.85;font-weight:400\">" + esc(o.code || "") + "</small></button>";
      }).join("") : '<p class="q-gate-sub">You have no clinic here yet. Create one to start your queue.</p>';
      el.innerHTML = _wrap('<p class="q-gate-sub">Choose your clinic.</p>' + rows + '<button class="q-gate-btn" style="margin-top:12px;background:#f1f5f9;color:#0f172a" data-q-act="newclinic">' + ms("add") + " New clinic</button><button class=\"q-gate-close\" data-q-act=\"chooser\">Back</button>");
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  /* A new clinic is made HERE. This used to open the staff console in a browser, which is not where a
   * doctor on a phone sets up a clinic. Same route the staff console's wizard uses: POST /onboard/clinic
   * makes the clinic and one consulting room with this doctor in it. */
  function _newClinicForm(err, name, room) {
    return _wrap('<p class="q-gate-sub">Set up your clinic. You can add staff after this.</p>' +
      '<label class="q-gate-lbl" for="qNcName">Clinic name</label>' +
      '<input id="qNcName" class="q-gate-in" type="text" autocomplete="organization" autocapitalize="words" maxlength="80" value="' + esc(name || "") + '">' +
      '<label class="q-gate-lbl" for="qNcRoom">Your consulting room</label>' +
      '<input id="qNcRoom" class="q-gate-in" type="text" autocapitalize="words" maxlength="40" value="' + esc(room == null ? "Consulting Room" : room) + '">' +
      '<div class="q-gate-err" role="alert">' + (err ? esc(err) : "") + "</div>" +
      '<button class="q-gate-btn" data-q-act="newclinicgo">Create clinic</button>' +
      '<button class="q-gate-close" data-q-act="typeclinic">Back</button>');
  }
  function createClinic() {
    var nEl = document.getElementById("qNcName"), rEl = document.getElementById("qNcRoom");
    var name = nEl ? String(nEl.value || "").trim() : "", room = rEl ? String(rEl.value || "").trim() : "";
    if (name.length < 2) { root().innerHTML = _newClinicForm("Enter your clinic's name.", name, room); return; }
    var btn = root().querySelector(".q-gate-btn"); if (btn) { btn.disabled = true; btn.textContent = "Creating your clinic…"; }
    apiPost("/onboard/clinic", { name: name, roomName: room || "Consulting Room" }).then(function (r) {
      if (r && r.ok && r.org && r.org.id) { _setWp("clinic:" + r.org.id); st.ghisToken = null; startClinic(r.org.id); return; }
      var why = (r && r.error === "account_required") ? "Sign in to your StewardMD account first, then create the clinic."
        : "The clinic was not created" + ((r && (r.message || r.error)) ? " (" + (r.message || r.error) + ")" : "") + ". Try again.";
      root().innerHTML = _newClinicForm(why, name, room);
    }, function () { root().innerHTML = _newClinicForm("Could not reach the server. Check your connection and try again.", name, room); });
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
        var o = document.getElementById("qFdOrg"), last = localStorage.getItem("smd_opd_staff_org") || localStorage.getItem("smd_opd_clinic_code") || "";
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
    org = org.trim(); user = user.trim().toLowerCase(); pin = pin.trim();
    if (!org || !user || !pin) { root().innerHTML = _staffGate("Enter the Clinic ID, your login and your PIN."); prefillStaff(); return; }
    root().innerHTML = '<div class="q-empty" style="padding:80px">Signing in…</div>';
    fetchRetry(API + "/auth/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clinicCode: org, identity: user, pin: pin }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        // Two-step sign-in: the PIN was right; ask for the phone's code and pass the server's answer through.
        if (!r || r.error !== "mfa_required") return r;
        var code = ""; try { code = window.prompt((r.message || "Enter the 6-digit code from your authenticator app.") + "\n\nLost your phone? Enter a backup code instead.") || ""; } catch (e) {}
        if (!code.trim()) return { cancelled: true };
        return fetchRetry(API + "/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge: r.challenge, code: code.trim() }) }).then(function (x) { return x.json(); });
      })
      .then(function (r) {
        if (!r || !r.ok || !r.token) {
          var msg = (r && r.cancelled) ? "Sign-in cancelled."
            : (r && r.error === "wrong_code") ? "That code did not match. Sign in again and use the newest code."
            : (r && r.error === "challenge_expired") ? "That took too long. Sign in again."
            : (r && r.error === "locked") ? "Too many attempts. Try again shortly."
            : (r && r.error === "staff_disabled") ? "Staff sign-in is not enabled for this clinic."
            : "Wrong Clinic ID, login or PIN.";
          root().innerHTML = _staffGate(msg); prefillStaff(); return;
        }
        setStaffTok(r.token);
        try { localStorage.setItem("smd_opd_staff_org", org); if (r.orgCode) localStorage.setItem("smd_opd_clinic_code", r.orgCode); } catch (e) {}
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
    // The desk is the staff session's own hospital; at a cold start that is known only from the token.
    var own = G.SMD_HOSPITAL_AUTH ? G.SMD_HOSPITAL_AUTH.staffTokenOrg(staffTok()) : "";
    if (own) st.orgId = own;
    apiGet("/whoami").then(function (w) {
      if (!w || !w.ok) { setStaffTok(""); root().innerHTML = _staffGate("Your session ended. Sign in again."); prefillStaff(); return; }
      if (w.twoStepRequired) { el.innerHTML = _wrap('<p class="q-gate-sub">Your clinic requires two-step sign-in for your role. Set it up at wardsynq.com under Sign-in security, then sign in here again.</p><button class="q-gate-close" data-q-act="staffout">Sign out</button>'); return; }
      st.staffWho = w; st.orgId = w.orgId || st.orgId || "";
      if (!w.twoStepRequired) wsqAlerts("bind", st.orgId, true);
      if (!st.orgId) { el.innerHTML = _wrap('<p class="q-gate-sub">You are not assigned to a clinic yet. Ask the clinic owner to add you.</p><button class="q-gate-close" data-q-act="staffout">Back</button>'); return; }
      return apiGet("/opd-board?orgId=" + encodeURIComponent(st.orgId)).then(function (b) {
        if (!b || !b.ok) { el.innerHTML = _wrap('<p class="q-gate-sub">Could not load the clinic board.</p><button class="q-gate-btn" data-q-act="fdrefresh">Retry</button><button class="q-gate-close" data-q-act="staffout">Sign out</button>'); return; }
        st.board = b;
        el.innerHTML = renderFrontDesk(b);
        clearInterval(st.pollId);
        loadPulse(true);
        var fdPoll = function () {
          if (liveQuiet()) { offTick(); return; }   // plan item 16: live and nothing changed
          apiGet("/opd-board?orgId=" + encodeURIComponent(st.orgId)).then(function (n) {
            /* The board is kept fresh, but never rebuilt over a field somebody is typing in: the same rule that
             * fixed the staff form (paint) and the pulse (pulsePaint). The next pass paints it. */
            var ae = document.activeElement, typing = !!(ae && ae.closest && ae.closest("input, textarea, select"));
            if (n && n.ok) { st.board = n; var e2 = root(); if (e2 && e2.querySelector(".q-fd") && !typing) e2.innerHTML = renderFrontDesk(n); }
          }).catch(function () {});
          loadPulse();
          offTick();
        };
        st.pollId = setInterval(fdPoll, POLL_MS);
        liveStart(fdPoll);
        offTick();
      });
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-btn" data-q-act="fdrefresh">Retry</button>'); });
  }

  function renderFrontDesk(b) {
    var who = st.staffWho || {}, rooms = (b && b.rooms) || [], pool = (b && b.pool) || [];
    var canAdd = staffCan("queue.add"), canAssign = staffCan("queue.assign");
    var activeRooms = rooms.filter(function (r) { return r.status !== "unavailable"; }).length;
    var waitingTotal = rooms.reduce(function (n, r) { return n + (r.waiting || 0); }, 0);
    var inConsultTotal = rooms.reduce(function (n, r) {
      return n + ((r.tickets || []).filter(function (t) { return t.status === "in_consultation"; }).length);
    }, 0);

    var head = '<header class="q-fd-top">' +
      '<div class="q-fd-brand">' +
        '<div class="q-fd-avatar">' + ms("support_agent") + '</div>' +
        '<div class="q-fd-title-col">' +
          '<div class="q-fd-h-row">' +
            '<h1 class="q-fd-title">Front desk</h1>' +
            '<span class="q-fd-pill"><span class="q-fd-dot"></span>Live</span>' +
          '</div>' +
          '<div class="q-hint q-fd-meta">' +
            '<span class="q-fd-who">' + esc(who.name || "Staff") + '</span>' +
            '<span class="q-fd-sep">&middot;</span>' +
            '<span class="q-fd-role">' + esc(who.role || "viewer") + '</span>' +
            (who.orgCode ? '<span class="q-fd-sep">&middot;</span><span class="q-fd-code">' + esc(who.orgCode) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="q-fd-top-acts">' +
        '<button class="q-fd-btn-icon" data-q-act="fdrefresh" title="Refresh board" aria-label="Refresh">' + ms("refresh") + '</button>' +
        '<button class="q-pause q-fd-signout" data-q-act="staffout" title="Sign out">' + ms("logout") + '<span>Sign out</span></button>' +
      '</div>' +
    '</header>';

    var banner = canAdd ? (
      '<div class="q-fd-banner">' +
        '<div class="q-fd-banner-text">' +
          '<div class="q-fd-banner-title">Patient Reception &amp; Check-In</div>' +
          '<div class="q-fd-banner-sub">Register walk-ins or arrivals into the OPD queue</div>' +
        '</div>' +
        '<button class="q-gate-btn q-fd-add-btn" data-q-act="fdadd">' + ms("person_add") + '<span>Add patient</span></button>' +
      '</div>'
    ) : '';

    var kpis = '<section class="q-kpis q-fd-kpis">' +
      kpi("Waiting", "groups", String(waitingTotal), '<div class="q-kpi-sub">in rooms</div>') +
      kpi("Unassigned", "help", String(pool.length), '<div class="q-kpi-sub' + (pool.length ? ' alert' : '') + '">' + (pool.length ? pool.length + ' in hall' : 'hall clear') + '</div>') +
      kpi("In Consult", "stethoscope", String(inConsultTotal), '<div class="q-kpi-sub">with doctor</div>') +
      kpi("Rooms", "door_front", String(activeRooms) + '<span class="q-kpi-denom">/' + String(rooms.length) + '</span>', '<div class="q-kpi-sub">' + (activeRooms === rooms.length ? 'all online' : activeRooms + ' active') + '</div>') +
    '</section>';

    var roomCards = rooms.length ? rooms.map(function (r) {
      var rm = r.room || {}, unavailable = r.status === "unavailable";
      var inConsult = (r.tickets || []).filter(function (t) { return t.status === "in_consultation"; })[0];
      var waitingCount = unavailable ? 0 : (r.waiting || 0);
      return '<div class="q-card q-room-card' + (unavailable ? ' unstaffed' : '') + '">' +
        '<div class="q-room-top">' +
          '<div class="q-room-name-wrap">' +
            '<div class="q-room-icon' + (unavailable ? ' muted' : '') + '">' + ms("door_front") + '</div>' +
            '<div>' +
              '<div class="q-room-title">' + esc(rm.name || "Room") + (rm.number ? ' <span class="q-room-num">#' + esc(rm.number) + '</span>' : '') + '</div>' +
              (rm.department ? '<div class="q-hint q-room-dept">' + esc(rm.department) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<span class="q-room-pill ' + (unavailable ? 'offline' : inConsult ? 'busy' : 'available') + '">' +
            '<span class="q-dot"></span>' + (unavailable ? 'No doctor' : inConsult ? 'In consult' : 'Available') +
          '</span>' +
        '</div>' +
        '<div class="q-room-body">' +
          '<div class="q-room-stat">' +
            '<span class="q-room-stat-lbl">In room</span>' +
            '<div class="q-room-stat-val">' +
              (unavailable ? '<span class="q-hint">&mdash;</span>' : inConsult ? tok(inConsult) + '<span class="q-room-cur-name">' + phi("name", inConsult.name, esc(inConsult.name || "Patient")) + '</span>' : '<span class="q-hint">None</span>') +
            '</div>' +
          '</div>' +
          '<div class="q-room-stat waiting">' +
            '<span class="q-room-stat-lbl">Waiting</span>' +
            '<div class="q-room-stat-val bold' + (waitingCount > 3 ? ' warn' : '') + '">' +
              (unavailable ? '&mdash;' : waitingCount) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join("") : '<div class="q-empty">No rooms set up yet. The clinic owner adds rooms in the console.</div>';

    var poolRows = pool.length ? '<div class="q-fd-pool-list">' + pool.map(function (t) {
      return '<div class="q-fd-row"><div>' + tok(t) + '<b class="q-fd-pname">' + phi("name", t.name, esc(t.name || "Patient")) + '</b>' +
        '<div class="q-hint">' + esc(t.mrnLast4 ? "MRN ..." + t.mrnLast4 : "No MRN") + " &middot; " + esc(t.visitType === "followup" ? "Follow-up" : "New") + (t.department ? " &middot; " + esc(t.department) : "") + '</div></div>' +
        (canAssign ? '<button class="q-fd-route-btn" data-q-act="fdroute:' + esc(t.id) + '">' + ms("arrow_forward") + '<span>Route</span></button>' : '') +
        '</div>';
    }).join("") + '</div>' : '<div class="q-fd-empty"><div class="q-fd-empty-icon">' + ms("check_circle") + '</div><div class="q-fd-empty-text">Nobody waiting to be routed.</div><div class="q-hint">All registered patients have been routed to consultation rooms.</div></div>';

    return '<div class="q-fd">' + head +
      '<div class="q-fd-scroll"><div class="q-fd-body">' +
        banner +
        kpis +
        pulseCard(st) +
        '<section class="q-fd-sec">' +
          '<div class="q-fd-sec-hd">' +
            '<div class="q-fd-sec-left">' +
              '<h2 class="q-h2" style="margin:0">' + ms("meeting_room") + '<span>Rooms</span></h2>' +
              '<span class="q-fd-badge">' + rooms.length + '</span>' +
            '</div>' +
            '<div class="q-fd-sec-meta">' + activeRooms + ' active &middot; ' + (rooms.length - activeRooms) + ' unstaffed</div>' +
          '</div>' +
          '<div class="q-grid2 q-fd-rooms-grid">' + roomCards + '</div>' +
        '</section>' +
        '<section class="q-fd-sec">' +
          '<div class="q-fd-sec-hd">' +
            '<div class="q-fd-sec-left">' +
              '<h2 class="q-h2" style="margin:0">' + ms("groups") + '<span>Waiting to be routed</span></h2>' +
              '<span class="q-fd-badge' + (pool.length ? ' alert' : '') + '">' + pool.length + '</span>' +
            '</div>' +
            (pool.length ? '<div class="q-fd-sec-meta">Waiting in reception hall</div>' : '') +
          '</div>' +
          poolRows +
        '</section>' +
      '</div></div>' +
    '</div>';
  }

  /* Plan item 13: the front desk keeps checking patients in when the server cannot be reached, with the same
   * offline desk as the web console (opd-offline-desk.js): a series reserved while online, a numbered slip
   * offline, and each poll sends what is waiting. */
  var OFFD = null;
  function offDesk() {
    if (!G.SMD_OPD_OFFLINE || !st.orgId) return null;
    var day = new Date(Date.now() + 19800000).toISOString().slice(0, 10);   // the IST day the server numbers by
    if (!OFFD || OFFD._org !== st.orgId || OFFD._date !== day) {
      var ss = null, idb = null; try { ss = G.sessionStorage; } catch (e) {} try { idb = G.indexedDB || null; } catch (e) {}
      if (!ss && !idb) return null;
      // IndexedDB first, so a check-in taken offline survives the app being closed; the tab's storage when it cannot open.
      OFFD = G.SMD_OPD_OFFLINE.desk({ indexedDB: idb, storage: ss, orgId: st.orgId, date: day, call: function (p, b) { return apiPost("/" + p, b); } });
      OFFD._org = st.orgId; OFFD._date = day;
    }
    return OFFD;
  }
  function offTick() {
    var d = offDesk(); if (!d) return;
    d.prepare();
    if (d.pending()) d.sync().then(function (r) { if (r.synced) { toast(r.synced + (r.synced === 1 ? " offline check-in" : " offline check-ins") + " sent to the queue" + (r.review ? ": " + r.review + " to check" : "")); } });
  }
  // Sign-out with offline check-ins not yet sent asks first: each one is a patient's place in the queue.
  function offSignOut() {
    var d = offDesk(); if (!d) return true;
    if (d.pending()) { var sure = true; try { sure = window.confirm(d.pending() + " offline check-in(s) have not reached the queue yet and will be lost. Sign out anyway?"); } catch (e) {} if (!sure) return false; }
    d.clear(); OFFD = null; return true;
  }
  // Signing out: the unsent check-ins are settled first (offSignOut), then the live stream ends with the session.
  function signOutDesk() { if (!offSignOut()) return false; liveStop(); return true; }
  function printTokenSlip(o) {
    var okp = false;
    try { okp = !!(G.WARD_LABELS && G.WARD_LABELS.print("token", { hospital: (st.staffWho && (st.staffWho.orgName || st.staffWho.orgCode)) || "", token: o.token, name: o.name || "", issuedAt: new Date(o.at || Date.now()).toLocaleString() })); } catch (e) {}
    if (!okp) toast("Printing is not available here. Write " + o.token + " on the patient's slip.");
  }

  // Add a patient from the front desk: the SAME ABDM-ready check-in sheet the doctor uses, then into
  // the central pool (a one-room clinic auto-routes server-side).
  function frontDeskAdd() {
    if (!(G.SMD_PATIENTREG && G.SMD_PATIENTREG.open)) { toast("Patient check-in is unavailable on this build."); return; }
    withDepartments(st.orgId, function (dp) {
      G.SMD_PATIENTREG.open({
        mode: "native",
        clinicName: (st.staffWho && st.staffWho.orgCode) || "Check-in",
        departments: dp.departments, departmentRequired: dp.required,
        resolve: function (id) { return apiGet("/patient/resolve?orgId=" + encodeURIComponent(st.orgId) + "&id=" + encodeURIComponent(id)); },
        submit: function (body) { body.orgId = st.orgId; body.workplaceMode = "native"; body.forQueue = "pool"; return apiPost("/patient/register", body); },
        offline: function (sent) { var d = offDesk(); return d ? d.issue(sent) : null; },
        printToken: printTokenSlip,
        onAdded: function (r, sent) {
          apiPost("/pool", { orgId: st.orgId, name: r.patient && r.patient.name, mobile: r.patient && r.patient.mobile,
            mrn: r.mrn, visitType: (r.patient && r.patient.visitType) === "followup" ? "followup" : "new", departmentId: (sent && sent.departmentId) || "" })
            .then(function (q) { queuedSay(r, q); loadFrontDesk(); }, function () { queuedSay(r, null); });
        }
      });
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
        if (q2On()) loadClinicName(orgId);   // the new header is titled with the clinic, not the app
        clearInterval(st.pollId); st.pollId = setInterval(refresh, POLL_MS);   // refresh() polls /list by session id
        liveStart(refresh);
        return;
      }
      if (r && r.ok && !r.resolved) { _pickRoom(orgId, r.rooms || []); return; }
      el.innerHTML = _wrap('<p class="q-gate-sub">Could not open this clinic (' + esc((r && r.error) || "error") + ').</p><button class="q-gate-close" data-q-act="chooser">Back</button>');
    }).catch(function () { el.innerHTML = _wrap('<p class="q-gate-sub">Could not reach the server.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); });
  }
  // No room auto-assigned to this doctor here -> let them pick which room they are manning today.
  function _pickRoom(orgId, rooms) {
    if (!rooms.length) { root().innerHTML = _wrap('<p class="q-gate-sub">No consulting room is set up for you at this clinic yet. Ask the clinic\'s admin to add you to a room.</p><button class="q-gate-close" data-q-act="chooser">Back</button>'); return; }
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
      if (r && r.ok) { st.tickets = r.tickets || st.tickets; paint(); if (!silent && r.imported != null) { try { G.toast && G.toast("Imported " + r.imported + " patient(s) from the EMR"); } catch (e) {} } importIssuesSay(r); }
    }).catch(function () {});
  }
  // Which workplace the doctor last chose, remembered on-device so a personal-clinic doctor is not forced
  // onto GHIS just because a stale Ward Sync token is cached. Values: "ghis" | "clinic:<orgId>" | "connect:<orgId>" | "wardsynq:<orgId>" | "".
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
    el.removeEventListener("change", onChange); el.addEventListener("change", onChange);
    clearInterval(st.tickId); st.tickId = setInterval(tickNow, 20000); try { if (st.tickId && st.tickId.unref) st.tickId.unref(); } catch (e) {}
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
    if (wp.indexOf("wardsynq:") === 0) { st.ghisToken = null; st.openOpts = { hospitalId: wp.slice(9), source: "wardsynq" }; loadSession(); return; }
    el.innerHTML = _chooseType();   // no remembered workplace -> Hospital vs Personal clinic
  }
  function close() { var el = document.getElementById("smdQueue"); if (el) el.classList.remove("on"); clearInterval(st.pollId); clearInterval(st.tickId); st.rowSheet = st.confirm = st.recallSheet = st.snack = null; st.demo = false; liveActivity(); }
  // Lock Screen / Dynamic Island (live-activities.js): the consult in progress (counting up) and how
  // many are waiting. Token number and counts ONLY, never a patient name (the Lock Screen is public).
  // Ends when the queue screen closes or nobody is in consult or waiting.
  function liveActivity() {
    var LA = G.SMD_liveActivity; if (!LA) return;
    var el = document.getElementById("smdQueue"), open = !!(el && el.classList.contains("on"));
    if (!open || st.demo || !st.session) { LA.end("opd-queue"); return; }
    var curId = st.session.currentTicketId, cur = null, waiting = computeKpis(st.tickets || []).waiting;
    (st.tickets || []).forEach(function (t) { if (t.id === curId && t.consultStartAt && !t.consultEndAt) cur = t; });
    if (!cur && !waiting) { LA.end("opd-queue"); return; }
    LA.upsert({
      key: "opd-queue", symbol: "person.2", tint: "#0F766E", urgent: computeKpis(st.tickets || []).health === "late",
      title: cur ? (cur.token ? "In consult \u00b7 token " + cur.token : "In consult") : "OPD queue",
      detail: waiting + " waiting",
      startedAt: cur ? cur.consultStartAt : (st.session.startedAt || st.session.createdAt || (st.laSince = st.laSince || Date.now())), endsAt: 0
    });
  }
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
      try { if (!st.session) return; var tid = e && e.detail && e.detail.ticketId; if (tid) act(st.session.id, "/priority", { ticketId: tid, reason: "emergency", note: "raised from the consult" }); act(st.session.id, "/advance"); } catch (x) {}
    });
  } catch (e) {}

  G.QUEUE = { open: open, close: close, refresh: refresh, _render: _render, _st: st,
    _openTicketEmr: openTicketEmr,   // test seam: workplace-based EMR routing (see test/queue-clinic-emr-route.test.mjs)
    // Live filter of the queue timeline - updates ONLY the rows container so the search input
    // keeps focus while typing (no full repaint).
    _q2: q2On, _localClinicId: localClinicId,
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
