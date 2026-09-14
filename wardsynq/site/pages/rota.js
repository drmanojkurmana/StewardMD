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
  function refusal(r) { return !r ? "No response from the server." : (r.message || r.error || "failed"); }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }

  function loading(c, what) { return '<span class="spin"></span> Loading ' + c.esc(what) + "..."; }
  function failed(c, what) { return '<div class="msg err">Could not load ' + c.esc(what) + ". Do not read this as none.</div>"; }

  function mineHtml(c, r) {
    if (r == null) return loading(c, "your shifts");
    if (!r.ok) return failed(c, "your shifts");
    var esc = c.esc;
    var shifts = r.assignments.length ? '<div class="tbl"><table><tr><th>Date</th><th>Shift</th><th>Unit</th><th></th></tr>' + r.assignments.map(function (a) {
      return "<tr><td>" + esc(a.date) + "</td><td>" + esc(a.shift ? a.shift.name + " " + a.shift.start + "-" + a.shift.end : a.shiftId) + "</td><td>" + esc(a.shift ? a.shift.unit : "") +
        '</td><td><button class="btn quiet" type="button" data-rota="swap" data-id="' + esc(a.id) + '">Offer to a colleague</button></td></tr>';
    }).join("") + "</table></div>" : "<p>No shifts in the next two months.</p>";
    // whoami names a staff session's identity in `name`. The server still refuses anyone else's answer.
    var myId = (c.state.who && c.state.who.name) || "";
    var swaps = r.swaps.length ? "<h3>Swaps</h3><ul>" + r.swaps.map(function (s) {
      var ask = !!myId && s.to === myId;
      return "<li>" + esc(s.date) + " " + esc(s.shiftId) + ": " + esc(s.from) + " to " + esc(s.to) + " (" + esc(s.status) + ")" +
        (ask && s.status === "proposed" ? ' <button class="btn quiet" type="button" data-rota="swapyes" data-id="' + esc(s.id) + '">Accept</button> <button class="btn quiet" type="button" data-rota="swapno" data-id="' + esc(s.id) + '">Decline</button>' : "") + "</li>";
    }).join("") + "</ul>" : "";
    var leave = "<h3>My leave</h3>" + (r.leave.length ? "<ul>" + r.leave.map(function (l) { return "<li>" + esc(l.from) + " to " + esc(l.to) + ": " + esc(l.reason) + " (" + esc(l.status) + ")</li>"; }).join("") + "</ul>" : "<p>No leave requested.</p>") +
      '<div class="row"><label class="f"><span>From</span><input id="rotaLvFrom" type="date"></label><label class="f"><span>To</span><input id="rotaLvTo" type="date"></label>' +
      '<label class="f"><span>Reason</span><input id="rotaLvReason"></label><button class="btn" type="button" data-rota="leave">Request leave</button></div>';
    return shifts + swaps + leave;
  }

  function coverageHtml(c, r) {
    if (r == null) return "<p>Choose dates and press Show.</p>";
    if (!r.ok) return '<div class="msg err">' + c.esc(refusal(r)) + " Do not read this as fully staffed.</div>";
    var esc = c.esc;
    return (r.partial ? '<div class="msg note">Some of these months have too many rota entries to show in full; gaps may be understated.</div>' : "") +
      '<div class="tbl"><table><tr><th>Date</th><th>Shift</th><th>Unit</th><th>On</th><th>Short</th></tr>' + r.coverage.map(function (x) {
        var on = (x.assignments || []).map(function (a) { return esc(a.identity) + ' <button class="btn quiet" type="button" data-rota="unassign" data-id="' + esc(a.id) + '" title="Remove from this shift">x</button>'; }).join(", ");
        return "<tr" + (x.gaps.length ? ' class="warn"' : "") + "><td>" + esc(x.date) + "</td><td>" + esc(x.shift) + "</td><td>" + esc(x.unit) + "</td><td>" + (on || "nobody") + "</td><td>" +
          (x.gaps.length ? esc(x.gaps.map(function (g) { return g.short + " " + g.role; }).join(", ")) : "") + "</td></tr>";
      }).join("") + "</table></div>";
  }

  function dutyHtml(c, r) {
    if (!r.ok) return failed(c, "who is on duty");
    if (!r.onDuty.length) return "<p>" + (r.partial ? "Nobody found on the rota for now, but the rota could not be read in full." : "Nobody is on the rota for right now.") + "</p>";
    return "<ul>" + r.onDuty.map(function (d) { return "<li>" + c.esc(d.identity) + ": " + c.esc(d.shift) + " (" + c.esc(d.unit) + ")</li>"; }).join("") + "</ul>";
  }
  function pendingHtml(c, leave, swaps) {
    var esc = c.esc;
    var l = leave == null ? loading(c, "leave requests") : !leave.ok ? failed(c, "leave requests")
      : leave.leave.length ? "<ul>" + leave.leave.map(function (x) {
        return "<li>" + esc(x.identity) + ": " + esc(x.from) + " to " + esc(x.to) + " (" + esc(x.reason) + ') <button class="btn quiet" type="button" data-rota="lvyes" data-id="' + esc(x.id) + '">Approve</button> <button class="btn quiet" type="button" data-rota="lvno" data-id="' + esc(x.id) + '">Decline</button></li>';
      }).join("") + "</ul>" : "<p>No leave waiting.</p>";
    var s = swaps == null ? loading(c, "swaps") : !swaps.ok ? failed(c, "swaps")
      : swaps.swaps.length ? "<ul>" + swaps.swaps.map(function (x) {
        return "<li>" + esc(x.date) + ": " + esc(x.from) + " to " + esc(x.to) + " (" + esc(x.status) + ")" +
          (x.status === "accepted" ? ' <button class="btn quiet" type="button" data-rota="swapok" data-id="' + esc(x.id) + '">Approve</button> <button class="btn quiet" type="button" data-rota="swapreject" data-id="' + esc(x.id) + '">Decline</button>' : " waiting for the colleague") + "</li>";
      }).join("") + "</ul>" : "<p>No swaps waiting.</p>";
    return "<h3>Leave requests</h3>" + l + "<h3>Swaps</h3>" + s;
  }

  WSQ.page("rota", { render: function (c) {
    var el = c.el, org = c.state.orgId, admin = c.can("staff.admin");
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>Staff rota</h1></div>' +
      '<div class="card"><h2>My shifts</h2><div id="rotaMine"></div><div id="rotaMsg"></div></div>' +
      '<div class="card"><h2>On duty now</h2><div id="rotaDuty"></div></div>' +
      (admin ? '<div class="card"><h2>Shifts</h2><div id="rotaShifts"></div>' +
        '<div class="row"><label class="f"><span>Name</span><input id="rotaShName" placeholder="Day"></label><label class="f"><span>Unit</span><input id="rotaShUnit" placeholder="Ward A"></label>' +
        '<label class="f"><span>Start</span><input id="rotaShStart" type="time"></label><label class="f"><span>End</span><input id="rotaShEnd" type="time"></label>' +
        '<label class="f"><span>Minimum nurses</span><input id="rotaShNurse" type="number" min="0"></label><label class="f"><span>Minimum doctors</span><input id="rotaShDoctor" type="number" min="0"></label>' +
        '<button class="btn" type="button" data-rota="shift">Save shift</button></div></div>' +
        '<div class="card"><h2>Assign</h2><div class="row"><label class="f"><span>Staff ID</span><input id="rotaAsId"></label><label class="f"><span>Shift</span><select id="rotaAsShift"></select></label>' +
        '<label class="f"><span>First date</span><input id="rotaAsDate" type="date"></label><label class="f"><span>Repeat weekly for (weeks)</span><input id="rotaAsWeeks" type="number" min="1" max="26" value="1"></label>' +
        '<button class="btn" type="button" data-rota="assign">Assign</button></div></div>' +
        '<div class="card"><h2>Coverage and gaps</h2><div class="row"><label class="f"><span>From</span><input id="rotaCvFrom" type="date"></label><label class="f"><span>To</span><input id="rotaCvTo" type="date"></label>' +
        '<button class="btn quiet" type="button" data-rota="coverage">Show</button></div><div id="rotaCoverage">' + coverageHtml(c, null) + "</div></div>" +
        '<div class="card"><h2>Waiting for approval</h2><div id="rotaPending"></div></div>' : "");

    var msg = function (t, ok) { var m = document.getElementById("rotaMsg"); if (m) m.innerHTML = '<div class="msg ' + (ok ? "ok" : "err") + '">' + c.esc(t) + "</div>"; else c.toast(t); };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(refusal(r)); return; } c.toast(okText); WSQ.render("rota"); }; };
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };

    set("rotaMine", mineHtml(c, null));
    c.api("/roster/mine" + q).then(function (r) { set("rotaMine", mineHtml(c, r && r.ok ? r : { ok: false })); });
    set("rotaDuty", loading(c, "who is on duty"));
    c.api("/roster/on-duty" + q).then(function (r) { set("rotaDuty", dutyHtml(c, r || { ok: false })); });
    if (admin) {
      c.api("/roster/shifts" + q).then(function (r) {
        if (!r || !r.ok) { set("rotaShifts", failed(c, "shifts")); return; }
        set("rotaShifts", r.shifts.length ? "<ul>" + r.shifts.map(function (s) { return "<li>" + c.esc(s.name + " (" + s.unit + ") " + s.start + "-" + s.end) + "</li>"; }).join("") + "</ul>" : "<p>No shifts defined yet.</p>");
        var sel = document.getElementById("rotaAsShift");
        if (sel) sel.innerHTML = r.shifts.map(function (s) { return '<option value="' + c.esc(s.id) + '">' + c.esc(s.name + " (" + s.unit + ")") + "</option>"; }).join("");
      });
      set("rotaPending", pendingHtml(c, null, null));
      Promise.all([c.api("/roster/leave-pending" + q), c.api("/roster/swap-pending" + q)]).then(function (rs) { set("rotaPending", pendingHtml(c, rs[0] || { ok: false }, rs[1] || { ok: false })); });
    }

    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-rota]"); if (!b) return;
      var act = b.getAttribute("data-rota"), id = b.getAttribute("data-id");
      if (act === "leave") return c.api("/roster/leave-request", { orgId: org, from: val("rotaLvFrom"), to: val("rotaLvTo"), reason: val("rotaLvReason") }).then(after("Leave requested."));
      if (act === "swap") { var to = ""; try { to = prompt("Staff ID of the colleague to offer this shift to:") || ""; } catch (e) {} if (!to.trim()) return; return c.api("/roster/swap-propose", { orgId: org, assignmentId: id, to: to.trim() }).then(after("Swap offered. Your colleague and the admin both need to agree.")); }
      if (act === "swapyes" || act === "swapno") return c.api("/roster/swap-respond", { orgId: org, swapId: id, accept: act === "swapyes" }).then(after("Answered."));
      if (act === "shift") return c.api("/roster/shift", { orgId: org, name: val("rotaShName"), unit: val("rotaShUnit"), start: val("rotaShStart"), end: val("rotaShEnd"), minimum: { nurse: Number(val("rotaShNurse")) || 0, doctor: Number(val("rotaShDoctor")) || 0 } }).then(after("Shift saved."));
      if (act === "assign") return c.api("/roster/assign", { orgId: org, identity: val("rotaAsId"), shiftId: val("rotaAsShift"), date: val("rotaAsDate"), weeks: Number(val("rotaAsWeeks")) || 1 }).then(after("Assigned."));
      if (act === "coverage") { set("rotaCoverage", loading(c, "coverage")); return c.api("/roster/coverage" + q + "&from=" + encodeURIComponent(val("rotaCvFrom")) + "&to=" + encodeURIComponent(val("rotaCvTo"))).then(function (r) { set("rotaCoverage", coverageHtml(c, r || { ok: false })); }); }
      if (act === "unassign") { var why = ""; try { why = prompt("Why is this person being removed from the shift?") || ""; } catch (e) {} if (!why.trim()) return; return c.api("/roster/unassign", { orgId: org, assignmentId: id, reason: why.trim() }).then(after("Removed from the shift.")); }
      if (act === "lvyes" || act === "lvno") return c.api("/roster/leave-decide", { orgId: org, leaveId: id, approve: act === "lvyes" }).then(after("Leave decided."));
      if (act === "swapok" || act === "swapreject") return c.api("/roster/swap-approve", { orgId: org, swapId: id, approve: act === "swapok" }).then(after("Swap decided."));
    };
  } });

  WSQ._rota = { mineHtml: mineHtml, coverageHtml: coverageHtml, pendingHtml: pendingHtml, dutyHtml: dutyHtml };
})();
