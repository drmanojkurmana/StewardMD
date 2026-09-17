/* wardsynq/site/pages/rota.js - "Staff rota": my shifts, leave and swaps for everyone; shifts, assigning,
 * coverage gaps and approvals for the hospital admin. Buildless ES5, registers onto WSQ.
 *
 * Every section loads on its own and says when it failed: a rota that failed to load must never read as
 * "no shifts", and a coverage table that failed must never read as "no gaps". The server decides who may
 * do what; this page only hides buttons a person could not use.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function refusal(c, r) { return !r ? T(c, "site.rota.noResponse", "No response from the server.") : (r.message || r.error || T(c, "site.rota.refusalFailed", "failed")); }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  /* LT-36: a staff member as shown on the rota. Members carry no display name, and a sign-in ID can be a mobile
   * number or an internal account id: personal data, and no name. Those read "Name not set" (the role is shown
   * beside it where the answer has one), never the number. An email or staff ID the hospital chose is shown. */
  function person(c, identity) {
    var id = String(identity == null ? "" : identity).trim();
    if (!id || /^\+?[\d\s().-]{7,}$/.test(id) || /^(fb|cfa|ghis|uid):/i.test(id)) return c.esc(T(c, "site.rota.nameNotSet", "Name not set"));
    return EN(c, c.esc(id));
  }

  /* "what" is a noun phrase already translated by the caller (a literal T() call at each call site),
   * so it composes into these two sentences like any other placeholder. */
  function loading(c, what) { return '<span class="spin"></span> ' + c.esc(T(c, "site.rota.loadingWhat", "Loading {what}...", { what: what })); }
  function failed(c, what) { return '<div class="msg err">' + TS(c, "site.rota.failedWhat", "Could not load {what}. Do not read this as none.", { what: what }) + "</div>"; }

  function mineHtml(c, r) {
    if (r == null) return loading(c, T(c, "site.rota.yourShifts", "your shifts"));
    if (!r.ok) return failed(c, T(c, "site.rota.yourShifts", "your shifts"));
    var esc = c.esc;
    var shifts = r.assignments.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.rota.colDate", "Date")) + '</th><th>' + esc(T(c, "site.rota.colShift", "Shift")) + '</th><th>' + esc(T(c, "site.rota.colUnit", "Unit")) + '</th><th></th></tr>' + r.assignments.map(function (a) {
      return "<tr><td>" + EN(c, esc(a.date)) + "</td><td>" + EN(c, esc(a.shift ? a.shift.name + " " + a.shift.start + "-" + a.shift.end : a.shiftId)) + "</td><td>" + EN(c, esc(a.shift ? a.shift.unit : "")) +
        '</td><td><button class="btn quiet" type="button" data-rota="swap" data-id="' + esc(a.id) + '">' + esc(T(c, "site.rota.offerToColleague", "Offer to a colleague")) + "</button></td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.rota.noShiftsTwoMonths", "No shifts in the next two months.")) + "</p>";
    // whoami names a staff session's identity in `name`. The server still refuses anyone else's answer.
    var myId = (c.state.who && c.state.who.name) || "";
    var swaps = r.swaps.length ? "<h3>" + esc(T(c, "site.rota.swapsHeading", "Swaps")) + "</h3><ul>" + r.swaps.map(function (s) {
      var ask = !!myId && s.to === myId;
      return "<li>" + EN(c, esc(s.date)) + " " + EN(c, esc(s.shiftId)) + ": " + person(c, s.from) + " " + esc(T(c, "site.rota.toLead", "to")) + " " + person(c, s.to) + " (" + EN(c, esc(s.status)) + ")" +
        (ask && s.status === "proposed" ? ' <button class="btn quiet" type="button" data-rota="swapyes" data-id="' + esc(s.id) + '">' + esc(T(c, "site.rota.accept", "Accept")) + '</button> <button class="btn quiet" type="button" data-rota="swapno" data-id="' + esc(s.id) + '">' + esc(T(c, "site.rota.decline", "Decline")) + "</button>" : "") + "</li>";
    }).join("") + "</ul>" : "";
    var leave = "<h3>" + esc(T(c, "site.rota.myLeaveHeading", "My leave")) + "</h3>" + (r.leave.length ? "<ul>" + r.leave.map(function (l) { return "<li>" + EN(c, esc(l.from)) + " " + esc(T(c, "site.rota.toLead", "to")) + " " + EN(c, esc(l.to)) + ": " + EN(c, esc(l.reason)) + " (" + EN(c, esc(l.status)) + ")</li>"; }).join("") + "</ul>" : "<p>" + esc(T(c, "site.rota.noLeaveRequested", "No leave requested.")) + "</p>") +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.rota.fromLabel", "From")) + '</span><input id="rotaLvFrom" type="date"></label><label class="f"><span>' + esc(T(c, "site.rota.toLabel", "To")) + '</span><input id="rotaLvTo" type="date"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.rota.reasonLabel", "Reason")) + '</span><input id="rotaLvReason"></label><button class="btn" type="button" data-rota="leave">' + esc(T(c, "site.rota.requestLeave", "Request leave")) + "</button></div>";
    return shifts + swaps + leave;
  }

  function coverageHtml(c, r) {
    if (r == null) return "<p>" + c.esc(T(c, "site.rota.chooseDatesPressShow", "Choose dates and press Show.")) + "</p>";
    if (!r.ok) return '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + " " + TS(c, "site.rota.coverageFailedTrail", "Do not read this as fully staffed.") + "</div>";
    var esc = c.esc;
    return (r.partial ? '<div class="msg note">' + esc(T(c, "site.rota.coveragePartialNote", "Some of these months have too many rota entries to show in full; gaps may be understated.")) + "</div>" : "") +
      '<div class="tbl"><table><tr><th>' + esc(T(c, "site.rota.colDate", "Date")) + '</th><th>' + esc(T(c, "site.rota.colShift", "Shift")) + '</th><th>' + esc(T(c, "site.rota.colUnit", "Unit")) + '</th><th>' + esc(T(c, "site.rota.colOn", "On")) + '</th><th>' + esc(T(c, "site.rota.colShort", "Short")) + '</th></tr>' + r.coverage.map(function (x) {
        var on = (x.assignments || []).map(function (a) { return person(c, a.identity) + ' <button class="btn quiet" type="button" data-rota="unassign" data-id="' + esc(a.id) + '" title="' + esc(T(c, "site.rota.removeFromShiftTitle", "Remove from this shift")) + '">x</button>'; }).join(", ");
        return "<tr" + (x.gaps.length ? ' class="warn"' : "") + "><td>" + EN(c, esc(x.date)) + "</td><td>" + EN(c, esc(x.shift)) + "</td><td>" + EN(c, esc(x.unit)) + "</td><td>" + (on || esc(T(c, "site.rota.nobody", "nobody"))) + "</td><td>" +
          (x.gaps.length ? esc(x.gaps.map(function (g) { return g.short + " " + g.role; }).join(", ")) : "") + "</td></tr>";
      }).join("") + "</table></div>";
  }

  function dutyHtml(c, r) {
    if (!r.ok) return failed(c, T(c, "site.rota.whoOnDuty", "who is on duty"));
    if (!r.onDuty.length) return "<p>" + c.esc(r.partial ? T(c, "site.rota.dutyPartialEmpty", "Nobody found on the rota for now, but the rota could not be read in full.") : T(c, "site.rota.dutyEmpty", "Nobody is on the rota for right now.")) + "</p>";
    return "<ul>" + r.onDuty.map(function (d) { return "<li>" + person(c, d.identity) + ": " + EN(c, c.esc(d.shift)) + " (" + EN(c, c.esc(d.unit)) + ")</li>"; }).join("") + "</ul>";
  }
  /* Owner 2026-09-15: who is on duty now in each ward (the rota, or marked on duty by themselves) and who marked
   * themselves off duty, from GET /roster/duty. Off duty overrides the rota: those people get no critical-result alert. */
  function viaText(c, via) { return via === "rota" ? T(c, "site.rota.viaRota", "rota") : via === "self" ? T(c, "site.rota.viaSelf", "marked on duty") : null; }
  function dutyWardsHtml(c, r) {
    if (r == null) return loading(c, T(c, "site.rota.dutyByWard", "duty by ward"));
    if (!r.ok) return failed(c, T(c, "site.rota.dutyByWard", "duty by ward"));
    var esc = c.esc;
    var when = function (iso) { return esc(String(iso || "").slice(0, 16).replace("T", " ")); };
    var wards = r.wards.length ? r.wards.map(function (w) {
      return "<h3>" + (w.ward ? EN(c, esc(w.ward)) : esc(T(c, "site.rota.noWard", "No ward"))) + " (" + w.people.length + ")</h3><ul>" + w.people.map(function (p) {
        var v = viaText(c, p.via);
        return "<li>" + person(c, p.identity) + (p.role ? ", " + esc(p.role) : "") + ": " + (v != null ? esc(v) : EN(c, esc(p.via))) + (p.until ? " " + esc(T(c, "site.rota.untilLead", "until")) + " " + EN(c, when(p.until)) : "") + "</li>";
      }).join("") + "</ul>";
    }).join("") : "<p>" + esc(T(c, "site.rota.noOneOnDutyAnyWard", "Nobody is on duty in any ward right now.")) + "</p>";
    var off = "<h3>" + esc(T(c, "site.rota.markedOffDutyHeading", "Marked off duty ({n})", { n: r.off.length })) + "</h3>" + (r.off.length ? "<ul>" + r.off.map(function (p) {
      return "<li>" + person(c, p.identity) + (p.role ? ", " + esc(p.role) : "") + ": " + esc(T(c, "site.rota.offDutyUntilLead", "off duty until")) + " " + EN(c, when(p.until)) + ". " + esc(T(c, "site.rota.notAlerted", "Not alerted.")) + "</li>";
    }).join("") + "</ul>" : "<p>" + esc(T(c, "site.rota.noOneMarkedOff", "Nobody has marked themselves off duty.")) + "</p>");
    return (r.partial ? '<div class="msg note">' + esc(T(c, "site.rota.dutyWardsPartialNote", "The rota or duty list could not be read in full; some people may be missing.")) + "</div>" : "") + wards + off;
  }
  function pendingHtml(c, leave, swaps) {
    var esc = c.esc;
    var l = leave == null ? loading(c, T(c, "site.rota.leaveRequestsPhrase", "leave requests")) : !leave.ok ? failed(c, T(c, "site.rota.leaveRequestsPhrase", "leave requests"))
      : leave.leave.length ? "<ul>" + leave.leave.map(function (x) {
        return "<li>" + person(c, x.identity) + ": " + EN(c, esc(x.from)) + " " + esc(T(c, "site.rota.toLead", "to")) + " " + EN(c, esc(x.to)) + " (" + EN(c, esc(x.reason)) + ') <button class="btn quiet" type="button" data-rota="lvyes" data-id="' + esc(x.id) + '">' + esc(T(c, "site.rota.approve", "Approve")) + '</button> <button class="btn quiet" type="button" data-rota="lvno" data-id="' + esc(x.id) + '">' + esc(T(c, "site.rota.decline", "Decline")) + "</button></li>";
      }).join("") + "</ul>" : "<p>" + esc(T(c, "site.rota.noLeaveWaiting", "No leave waiting.")) + "</p>";
    var s = swaps == null ? loading(c, T(c, "site.rota.swapsPhrase", "swaps")) : !swaps.ok ? failed(c, T(c, "site.rota.swapsPhrase", "swaps"))
      : swaps.swaps.length ? "<ul>" + swaps.swaps.map(function (x) {
        return "<li>" + EN(c, esc(x.date)) + ": " + person(c, x.from) + " " + esc(T(c, "site.rota.toLead", "to")) + " " + person(c, x.to) + " (" + EN(c, esc(x.status)) + ")" +
          (x.status === "accepted" ? ' <button class="btn quiet" type="button" data-rota="swapok" data-id="' + esc(x.id) + '">' + esc(T(c, "site.rota.approve", "Approve")) + '</button> <button class="btn quiet" type="button" data-rota="swapreject" data-id="' + esc(x.id) + '">' + esc(T(c, "site.rota.decline", "Decline")) + "</button>" : " " + esc(T(c, "site.rota.waitingForColleague", "waiting for the colleague"))) + "</li>";
      }).join("") + "</ul>" : "<p>" + esc(T(c, "site.rota.noSwapsWaiting", "No swaps waiting.")) + "</p>";
    return "<h3>" + esc(T(c, "site.rota.leaveRequestsHeading", "Leave requests")) + "</h3>" + l + "<h3>" + esc(T(c, "site.rota.swapsHeading", "Swaps")) + "</h3>" + s;
  }

  WSQ.page("rota", { render: function (c) {
    var el = c.el, org = c.state.orgId, admin = c.can("staff.admin");
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.rota.heading", "Staff rota")) + '</h1></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.rota.myShiftsCard", "My shifts")) + '</h2><div id="rotaMine"></div><div id="rotaMsg"></div></div>' +
      /* Gap wave 2026-09-16: clock in and out, and the member's own attendance, credentials and training (pages/hr.js). */
      (c.isWardsynq() && WSQ._hr ? '<div class="card"><h2>' + c.esc(T(c, "site.rota.myHrCard", "My attendance, credentials and training")) + '</h2><div id="rotaHr"></div></div>' : "") +
      '<div class="card"><h2>' + c.esc(T(c, "site.rota.onDutyNowCard", "On duty now")) + '</h2><div id="rotaDuty"></div></div>' +
      /* P4 nursing-staffing: required against rostered and on duty, norms, draft roster, staff injuries (pages/staffing.js). */
      (WSQ._staffing ? '<div id="rotaStaffing"></div>' : "") +
      (admin ? '<div class="card"><h2>' + c.esc(T(c, "site.rota.dutyByWardCard", "On and off duty by ward")) + '</h2><div id="rotaDutyWards"></div></div>' +
        '<div class="card"><h2>' + c.esc(T(c, "site.rota.shiftsCard", "Shifts")) + '</h2><div id="rotaShifts"></div>' +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.rota.nameLabel", "Name")) + '</span><input id="rotaShName" placeholder="' + c.esc(T(c, "site.rota.dayPlaceholder", "Day")) + '"></label><label class="f"><span>' + c.esc(T(c, "site.rota.unitLabel", "Unit")) + '</span><input id="rotaShUnit" placeholder="' + c.esc(T(c, "site.rota.wardAPlaceholder", "Ward A")) + '"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.rota.startLabel", "Start")) + '</span><input id="rotaShStart" type="time"></label><label class="f"><span>' + c.esc(T(c, "site.rota.endLabel", "End")) + '</span><input id="rotaShEnd" type="time"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.rota.minNursesLabel", "Minimum nurses")) + '</span><input id="rotaShNurse" type="number" min="0"></label><label class="f"><span>' + c.esc(T(c, "site.rota.minDoctorsLabel", "Minimum doctors")) + '</span><input id="rotaShDoctor" type="number" min="0"></label>' +
        '<button class="btn" type="button" data-rota="shift">' + c.esc(T(c, "site.rota.saveShift", "Save shift")) + "</button></div></div>" +
        '<div class="card"><h2>' + c.esc(T(c, "site.rota.assignCard", "Assign")) + '</h2><div class="row"><label class="f"><span>' + c.esc(T(c, "site.rota.staffIdLabel", "Staff ID")) + '</span><input id="rotaAsId"></label><label class="f"><span>' + c.esc(T(c, "site.rota.shiftLabel", "Shift")) + '</span><select id="rotaAsShift"></select></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.rota.firstDateLabel", "First date")) + '</span><input id="rotaAsDate" type="date"></label><label class="f"><span>' + c.esc(T(c, "site.rota.repeatWeeklyLabel", "Repeat weekly for (weeks)")) + '</span><input id="rotaAsWeeks" type="number" min="1" max="26" value="1"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.rota.inChargeLabel", "In charge of the shift (not counted in the nurse ratio)")) + '</span><input id="rotaAsLead" type="checkbox"></label>' +
        '<button class="btn" type="button" data-rota="assign">' + c.esc(T(c, "site.rota.assignButton", "Assign")) + "</button></div></div>" +
        '<div class="card"><h2>' + c.esc(T(c, "site.rota.coverageCard", "Coverage and gaps")) + '</h2><div class="row"><label class="f"><span>' + c.esc(T(c, "site.rota.fromLabel", "From")) + '</span><input id="rotaCvFrom" type="date"></label><label class="f"><span>' + c.esc(T(c, "site.rota.toLabel", "To")) + '</span><input id="rotaCvTo" type="date"></label>' +
        '<button class="btn quiet" type="button" data-rota="coverage">' + c.esc(T(c, "site.rota.showButton", "Show")) + '</button></div><div id="rotaCoverage">' + coverageHtml(c, null) + "</div></div>" +
        '<div class="card"><h2>' + c.esc(T(c, "site.rota.pendingCard", "Waiting for approval")) + '</h2><div id="rotaPending"></div></div>' : "");

    var msg = function (t, ok) { var m = document.getElementById("rotaMsg"); if (m) m.innerHTML = '<div class="msg ' + (ok ? "ok" : "err") + '">' + EN(c, c.esc(t)) + "</div>"; else c.toast(t); };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(refusal(c, r)); return; } c.toast(okText); WSQ.render("rota"); }; };
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };

    set("rotaMine", mineHtml(c, null));
    c.api("/roster/mine" + q).then(function (r) { set("rotaMine", mineHtml(c, r && r.ok ? r : { ok: false })); });
    var hrEl = document.getElementById("rotaHr");
    if (hrEl && WSQ._hr) WSQ._hr.selfCard(c, hrEl);
    var staffEl = document.getElementById("rotaStaffing");
    if (staffEl && WSQ._staffing) WSQ._staffing.mount(c, staffEl);
    set("rotaDuty", loading(c, T(c, "site.rota.whoOnDuty", "who is on duty")));
    c.api("/roster/on-duty" + q).then(function (r) { set("rotaDuty", dutyHtml(c, r || { ok: false })); });
    if (admin) {
      set("rotaDutyWards", dutyWardsHtml(c, null));
      c.api("/roster/duty" + q).then(function (r) { set("rotaDutyWards", dutyWardsHtml(c, r || { ok: false })); }, function () { set("rotaDutyWards", dutyWardsHtml(c, { ok: false })); });
      c.api("/roster/shifts" + q).then(function (r) {
        if (!r || !r.ok) { set("rotaShifts", failed(c, T(c, "site.rota.shiftsPhrase", "shifts"))); return; }
        set("rotaShifts", r.shifts.length ? "<ul>" + r.shifts.map(function (s) { return "<li>" + EN(c, c.esc(s.name + " (" + s.unit + ") " + s.start + "-" + s.end)) + "</li>"; }).join("") + "</ul>" : "<p>" + c.esc(T(c, "site.rota.noShiftsDefined", "No shifts defined yet.")) + "</p>");
        var sel = document.getElementById("rotaAsShift");
        if (sel) sel.innerHTML = r.shifts.map(function (s) { return '<option value="' + c.esc(s.id) + '">' + EN(c, c.esc(s.name + " (" + s.unit + ")")) + "</option>"; }).join("");
      });
      set("rotaPending", pendingHtml(c, null, null));
      Promise.all([c.api("/roster/leave-pending" + q), c.api("/roster/swap-pending" + q)]).then(function (rs) { set("rotaPending", pendingHtml(c, rs[0] || { ok: false }, rs[1] || { ok: false })); });
    }

    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-rota]"); if (!b || (b.closest && b.closest("#rotaStaffing"))) return;
      var act = b.getAttribute("data-rota"), id = b.getAttribute("data-id");
      if (act === "leave") return c.api("/roster/leave-request", { orgId: org, from: val("rotaLvFrom"), to: val("rotaLvTo"), reason: val("rotaLvReason") }).then(after(T(c, "site.rota.leaveRequested", "Leave requested.")));
      if (act === "swap") { var to = ""; try { to = prompt(T(c, "site.rota.swapPrompt", "Staff ID of the colleague to offer this shift to:")) || ""; } catch (e) {} if (!to.trim()) return; return c.api("/roster/swap-propose", { orgId: org, assignmentId: id, to: to.trim() }).then(after(T(c, "site.rota.swapOffered", "Swap offered. Your colleague and the admin both need to agree."))); }
      if (act === "swapyes" || act === "swapno") return c.api("/roster/swap-respond", { orgId: org, swapId: id, accept: act === "swapyes" }).then(after(T(c, "site.rota.answered", "Answered.")));
      if (act === "shift") return c.api("/roster/shift", { orgId: org, name: val("rotaShName"), unit: val("rotaShUnit"), start: val("rotaShStart"), end: val("rotaShEnd"), minimum: { nurse: Number(val("rotaShNurse")) || 0, doctor: Number(val("rotaShDoctor")) || 0 } }).then(after(T(c, "site.rota.shiftSaved", "Shift saved.")));
      if (act === "assign") return c.api("/roster/assign", { orgId: org, identity: val("rotaAsId"), shiftId: val("rotaAsShift"), date: val("rotaAsDate"), weeks: Number(val("rotaAsWeeks")) || 1, inCharge: !!(document.getElementById("rotaAsLead") || {}).checked }).then(after(T(c, "site.rota.assigned", "Assigned.")));
      if (act === "coverage") { set("rotaCoverage", loading(c, T(c, "site.rota.coveragePhrase", "coverage"))); return c.api("/roster/coverage" + q + "&from=" + encodeURIComponent(val("rotaCvFrom")) + "&to=" + encodeURIComponent(val("rotaCvTo"))).then(function (r) { set("rotaCoverage", coverageHtml(c, r || { ok: false })); }); }
      if (act === "unassign") { var why = ""; try { why = prompt(T(c, "site.rota.unassignPrompt", "Why is this person being removed from the shift?")) || ""; } catch (e) {} if (!why.trim()) return; return c.api("/roster/unassign", { orgId: org, assignmentId: id, reason: why.trim() }).then(after(T(c, "site.rota.removedFromShift", "Removed from the shift."))); }
      if (act === "lvyes" || act === "lvno") return c.api("/roster/leave-decide", { orgId: org, leaveId: id, approve: act === "lvyes" }).then(after(T(c, "site.rota.leaveDecided", "Leave decided.")));
      if (act === "swapok" || act === "swapreject") return c.api("/roster/swap-approve", { orgId: org, swapId: id, approve: act === "swapok" }).then(after(T(c, "site.rota.swapDecided", "Swap decided.")));
    };
  } });

  WSQ._rota = { mineHtml: mineHtml, coverageHtml: coverageHtml, pendingHtml: pendingHtml, dutyHtml: dutyHtml, dutyWardsHtml: dutyWardsHtml };
})();
