/* wardsynq/site/pages/assets.js - "Assets and maintenance": report broken equipment from the ward, and for the
 * biomedical engineer the asset register, movement and status, warranty and AMC/CMC alerts, preventive maintenance
 * and calibration schedules, overdue PM, job cards (assign, part from stores, close) and uptime of critical equipment.
 * Buildless ES5.
 *
 * One read (GET /ward/assets). null is loading, a failed read says so, and a schedule list the role may not read
 * (the server sends null) says that rather than "nothing due". The asset tag prints as plain text: there is no
 * barcode generator in this build.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function when(iso) { return String(iso || "").slice(0, 16).replace("T", " "); }
  var HAS = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  function statusWord(c, s) {
    var w = { "in-service": T(c, "site.assets.status.inService", "In service"), "under-repair": T(c, "site.assets.status.underRepair", "Under repair"), condemned: T(c, "site.assets.status.condemned", "Condemned") };
    return s == null ? c.esc(T(c, "site.assets.status.unknown", "Status not recorded")) : HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function jobWord(c, s) {
    var w = { breakdown: T(c, "site.assets.job.breakdown", "Breakdown"), pm: T(c, "site.assets.job.pm", "Preventive maintenance"), calibration: T(c, "site.assets.job.calibration", "Calibration"),
      open: T(c, "site.assets.job.open", "Open"), assigned: T(c, "site.assets.job.assigned", "Assigned"), closed: T(c, "site.assets.job.closed", "Closed"),
      warranty: T(c, "site.assets.contract.warranty", "Warranty"), AMC: T(c, "site.assets.contract.amc", "AMC"), CMC: T(c, "site.assets.contract.cmc", "CMC") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function categoryWord(c, s) {
    var w = { "life-support": T(c, "site.assets.cat.lifeSupport", "Life support"), monitoring: T(c, "site.assets.cat.monitoring", "Monitoring"), diagnostic: T(c, "site.assets.cat.diagnostic", "Diagnostic"),
      therapeutic: T(c, "site.assets.cat.therapeutic", "Therapeutic"), imaging: T(c, "site.assets.cat.imaging", "Imaging"), laboratory: T(c, "site.assets.cat.laboratory", "Laboratory"),
      surgical: T(c, "site.assets.cat.surgical", "Surgical"), other: T(c, "site.assets.cat.other", "Other") };
    return HAS(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function failed(c, what) { return '<div class="msg err">' + TS(c, "site.assets.failedWhat", "Could not load {what}. Do not read this as none.", { what: what }) + "</div>"; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.assets.loading", "Loading...")) + "</p>"; }
  function assetOptions(c, d, live) {
    return d.assets.filter(function (a) { return !live || a.status !== "condemned"; }).map(function (a) { return '<option value="' + c.esc(a.assetId) + '">' + EN(c, c.esc(a.tag + " · " + a.name + (a.location ? " · " + a.location : ""))) + "</option>"; }).join("");
  }

  function complaintHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.assets.registerPhrase", "the equipment list"));
    var esc = c.esc;
    if (!d.assets.length) return "<p>" + esc(T(c, "site.assets.noAssets", "No equipment is registered yet.")) + "</p>";
    return '<div class="row"><label class="f"><span>' + esc(T(c, "site.assets.equipment", "Equipment")) + '</span><select id="asCpAsset">' + assetOptions(c, d, true) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.assets.whatIsWrong", "What is wrong")) + '</span><input id="asCpText"></label>' +
      '<button class="btn" type="button" data-as="complaint">' + esc(T(c, "site.assets.report", "Report fault")) + "</button></div>" +
      jobsHtml(c, d, false);
  }

  function jobsHtml(c, d, engineer) {
    var esc = c.esc;
    var jobs = d.jobCards.filter(function (j) { return engineer || j.state !== "closed"; });
    if (!jobs.length) return "<p>" + esc(T(c, "site.assets.noJobs", "No open job cards.")) + "</p>";
    var byId = {}; d.assets.forEach(function (a) { byId[a.assetId] = a; });
    var sched = {}; (d.schedules || []).forEach(function (s) { sched[s.scheduleId] = s; });
    return jobs.map(function (j) {
      var a = byId[j.assetId] || {}, id = esc(j.jobCardId);
      var head = "<b>" + EN(c, esc((a.tag || "") + " · " + (a.name || ""))) + "</b> · " + jobWord(c, j.kind) + " · " + jobWord(c, j.state) + " · " + esc(when(j.reportedAt)) +
        (j.description ? "<br>" + EN(c, esc(j.description)) : "") + (j.engineer ? "<br>" + esc(T(c, "site.assets.engineer", "Engineer")) + ": " + EN(c, esc(j.engineer)) : "") +
        (j.parts.length ? "<br>" + esc(T(c, "site.assets.parts", "Parts")) + ": " + EN(c, esc(j.parts.map(function (p) { return p.quantity + " " + p.unit + " " + p.display; }).join(", "))) : "") +
        (j.resolution ? "<br>" + EN(c, esc(j.resolution)) : "") + (j.kind === "breakdown" && j.downtimeMinutes != null ? "<br>" + esc(T(c, "site.assets.downtime", "Downtime {n} minutes", { n: j.downtimeMinutes })) : "");
      if (!engineer || j.state === "closed") return '<div class="card">' + head + "</div>";
      var checklist = j.scheduleId && sched[j.scheduleId] ? sched[j.scheduleId].checklist.map(function (item, n) {
        return '<label class="f"><span>' + EN(c, esc(item)) + '</span><select id="asCk-' + id + "-" + n + '" data-item="' + esc(item) + '"><option value="true">' + esc(T(c, "site.assets.done", "Done")) + '</option><option value="false">' + esc(T(c, "site.assets.notDone", "Not done")) + "</option></select></label>";
      }).join("") : "";
      return '<div class="card">' + head +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.assets.engineer", "Engineer")) + '</span><input id="asEng-' + id + '"></label><button class="btn quiet" type="button" data-as="assign" data-id="' + id + '">' + esc(T(c, "site.assets.assign", "Assign")) + "</button></div>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.assets.partItem", "Part (stores item code)")) + '</span><input id="asPtCode-' + id + '"></label><label class="f"><span>' + esc(T(c, "site.assets.quantity", "Quantity")) + '</span><input id="asPtQty-' + id + '" type="number" min="1"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.assets.fromStore", "From store (location code)")) + '</span><input id="asPtLoc-' + id + '"></label><button class="btn quiet" type="button" data-as="part" data-id="' + id + '">' + esc(T(c, "site.assets.addPart", "Fit part")) + "</button></div>" +
        '<div class="row">' + checklist + '<label class="f"><span>' + esc(T(c, "site.assets.resolution", "What was done")) + '</span><input id="asRes-' + id + '"></label>' +
        (j.kind === "calibration" ? '<label class="f"><span>' + esc(T(c, "site.assets.calResult", "Calibration result")) + '</span><select id="asCal-' + id + '"><option value="pass">' + esc(T(c, "site.assets.pass", "Pass")) + '</option><option value="fail">' + esc(T(c, "site.assets.fail", "Fail")) + "</option></select></label>" : "") +
        (j.kind === "breakdown" ? '<label class="f"><span>' + esc(T(c, "site.assets.downtimeMinutes", "Downtime in minutes (blank: from report to now)")) + '</span><input id="asDown-' + id + '" type="number" min="0"></label>' : "") +
        '<label class="f"><span>' + esc(T(c, "site.assets.statusAfter", "Asset status after")) + '</span><select id="asAfter-' + id + '"><option value="">' + esc(T(c, "site.assets.noChange", "No change")) + '</option><option value="in-service">' + statusWord(c, "in-service") + '</option><option value="under-repair">' + statusWord(c, "under-repair") + '</option><option value="condemned">' + statusWord(c, "condemned") + "</option></select></label>" +
        '<button class="btn" type="button" data-as="close" data-id="' + id + '" data-checks="' + (j.scheduleId && sched[j.scheduleId] ? sched[j.scheduleId].checklist.length : 0) + '">' + esc(T(c, "site.assets.closeJob", "Close job card")) + "</button></div></div>";
    }).join("");
  }

  function dueHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.assets.duePhrase", "maintenance due"));
    var esc = c.esc;
    if (d.overduePm == null) return '<div class="msg note">' + esc(T(c, "site.assets.schedulesNotReadable", "Your role cannot read maintenance schedules, so nothing due is shown here.")) + "</div>";
    var row = function (s) { return "<li>" + EN(c, esc(s.tag + " · " + s.name)) + " · " + jobWord(c, s.kind) + " · " + (s.overdue ? "<b>" + esc(T(c, "site.assets.overdueSince", "overdue since {d}", { d: s.dueOn })) + "</b>" : esc(T(c, "site.assets.dueOn", "due {d}", { d: s.dueOn }))) +
      ' <button class="btn quiet" type="button" data-as="openjob" data-asset="' + esc(s.assetId) + '" data-schedule="' + esc(s.scheduleId) + '" data-kind="' + esc(s.kind) + '">' + esc(T(c, "site.assets.openJob", "Open job card")) + "</button></li>"; };
    var alerts = d.contractAlerts.map(function (x) { return "<li>" + EN(c, esc(x.tag + " · " + x.name)) + " · " + jobWord(c, x.kind) + " · " + (x.expired ? "<b>" + esc(T(c, "site.assets.expiredOn", "ended {d}", { d: x.until })) + "</b>" : esc(T(c, "site.assets.endsIn", "ends {d}, in {n} days", { d: x.until, n: x.daysLeft }))) + "</li>"; }).join("");
    var up = d.uptime.map(function (u) { return "<li>" + EN(c, esc(u.tag + " · " + u.name)) + " · " + esc(T(c, "site.assets.uptimeLine", "{pct}% up over {days} days, {m} minutes down", { pct: Math.round(u.uptime * 1000) / 10, days: u.windowDays, m: u.downMinutes })) + "</li>"; }).join("");
    return "<h3>" + esc(T(c, "site.assets.overduePm", "Overdue preventive maintenance")) + "</h3>" + (d.overduePm.length ? "<ul>" + d.overduePm.map(row).join("") + "</ul>" : "<p>" + esc(T(c, "site.assets.noOverdue", "No preventive maintenance is overdue.")) + "</p>") +
      "<h3>" + esc(T(c, "site.assets.calibrationDue", "Calibration due in 7 days or overdue")) + "</h3>" + (d.calibrationDue.length ? "<ul>" + d.calibrationDue.map(row).join("") + "</ul>" : "<p>" + esc(T(c, "site.assets.noCalibration", "No calibration is due.")) + "</p>") +
      "<h3>" + esc(T(c, "site.assets.contracts", "Warranty and AMC/CMC ending in 60 days or ended")) + "</h3>" + (alerts ? "<ul>" + alerts + "</ul>" : "<p>" + esc(T(c, "site.assets.noContracts", "No warranty or contract is ending.")) + "</p>") +
      "<h3>" + esc(T(c, "site.assets.uptime", "Uptime of critical equipment")) + "</h3>" + (up ? "<ul>" + up + "</ul>" : "<p>" + esc(T(c, "site.assets.noCritical", "No equipment is marked critical.")) + "</p>");
  }

  function registerHtml(c, d, depts) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.assets.registerPhrase", "the equipment list"));
    var esc = c.esc;
    var deptOpts = (depts || []).filter(function (x) { return x.active !== false; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + EN(c, esc(x.name)) + "</option>"; }).join("");
    var list = d.assets.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.assets.tag", "Tag")) + "</th><th>" + esc(T(c, "site.assets.equipment", "Equipment")) + "</th><th>" + esc(T(c, "site.assets.category", "Category")) + "</th><th>" + esc(T(c, "site.assets.where", "Where")) + "</th><th>" + esc(T(c, "site.assets.statusCol", "Status")) + "</th><th></th></tr>" + d.assets.map(function (a) {
      return "<tr><td>" + EN(c, esc(a.tag)) + "</td><td>" + EN(c, esc(a.name + [a.make, a.model, a.serial].filter(Boolean).map(function (x) { return " · " + x; }).join(""))) + (a.critical ? " · " + esc(T(c, "site.assets.critical", "critical")) : "") + "</td><td>" + categoryWord(c, a.category) + "</td><td>" + EN(c, esc((a.departmentName || "") + " · " + (a.location || ""))) + "</td><td>" + statusWord(c, a.status) + "</td>" +
        '<td><button class="btn quiet" type="button" data-as="tag" data-id="' + esc(a.assetId) + '">' + esc(T(c, "site.assets.printTag", "Print tag")) + '</button> <button class="btn quiet" type="button" data-as="history" data-id="' + esc(a.assetId) + '">' + esc(T(c, "site.assets.history", "History")) + "</button></td></tr>" +
        '<tr id="asHist-' + esc(a.assetId) + '" hidden><td colspan="6"><ul>' + a.movements.map(function (m) { return "<li>" + esc(when(m.at)) + " · " + EN(c, esc((m.departmentName || "") + " · " + (m.location || "") + (m.reason ? " · " + m.reason : ""))) + "</li>"; }).join("") +
        a.statusHistory.map(function (s) { return "<li>" + esc(when(s.at)) + " · " + statusWord(c, s.status) + (s.reason ? " · " + EN(c, esc(s.reason)) : "") + "</li>"; }).join("") + "</ul></td></tr>";
    }).join("") + "</table></div>" : "<p>" + esc(T(c, "site.assets.noAssets", "No equipment is registered yet.")) + "</p>";
    var f = function (id, label, type) { return '<label class="f"><span>' + esc(label) + '</span><input id="' + id + '"' + (type ? ' type="' + type + '"' : "") + "></label>"; };
    return list + "<h3>" + esc(T(c, "site.assets.registerHeading", "Register equipment")) + '</h3><div class="row">' +
      f("asTag", T(c, "site.assets.tag", "Tag")) + f("asName", T(c, "site.assets.equipment", "Equipment")) +
      '<label class="f"><span>' + esc(T(c, "site.assets.category", "Category")) + '</span><select id="asCat">' + d.categories.map(function (k) { return '<option value="' + esc(k) + '">' + categoryWord(c, k) + "</option>"; }).join("") + "</select></label>" +
      f("asMake", T(c, "site.assets.make", "Make")) + f("asModel", T(c, "site.assets.model", "Model")) + f("asSerial", T(c, "site.assets.serial", "Serial number")) +
      '<label class="f"><span>' + esc(T(c, "site.assets.department", "Department")) + '</span><select id="asDept">' + deptOpts + "</select></label>" + f("asLoc", T(c, "site.assets.location", "Location")) +
      f("asBought", T(c, "site.assets.purchaseDate", "Purchase date"), "date") + f("asCost", T(c, "site.assets.costRupees", "Cost (rupees)"), "number") + f("asVendor", T(c, "site.assets.vendor", "Vendor")) +
      f("asWarranty", T(c, "site.assets.warrantyUntil", "Warranty until"), "date") +
      '<label class="f"><span>' + esc(T(c, "site.assets.contractKind", "Contract")) + '</span><select id="asCtKind"><option value=""></option><option value="AMC">' + jobWord(c, "AMC") + '</option><option value="CMC">' + jobWord(c, "CMC") + "</option></select></label>" +
      f("asCtUntil", T(c, "site.assets.contractUntil", "Contract until"), "date") + f("asCtVendor", T(c, "site.assets.contractVendor", "Contract vendor")) +
      '<label class="f"><span>' + esc(T(c, "site.assets.criticalLabel", "Critical equipment")) + '</span><select id="asCrit"><option value="no">' + esc(T(c, "site.assets.no", "No")) + '</option><option value="yes">' + esc(T(c, "site.assets.yes", "Yes")) + "</option></select></label>" +
      '<button class="btn" type="button" data-as="register">' + esc(T(c, "site.assets.registerButton", "Register")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.assets.moveHeading", "Move or change status")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.assets.equipment", "Equipment")) + '</span><select id="asEvAsset">' + assetOptions(c, d, true) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.assets.department", "Department")) + '</span><select id="asEvDept"><option value=""></option>' + deptOpts + "</select></label>" + f("asEvLoc", T(c, "site.assets.location", "Location")) +
      '<button class="btn quiet" type="button" data-as="move">' + esc(T(c, "site.assets.move", "Move")) + "</button>" +
      '<label class="f"><span>' + esc(T(c, "site.assets.statusCol", "Status")) + '</span><select id="asEvStatus"><option value="in-service">' + statusWord(c, "in-service") + '</option><option value="under-repair">' + statusWord(c, "under-repair") + '</option><option value="condemned">' + statusWord(c, "condemned") + "</option></select></label>" +
      f("asEvReason", T(c, "site.assets.reason", "Reason")) + '<button class="btn quiet" type="button" data-as="status">' + esc(T(c, "site.assets.setStatus", "Set status")) + "</button></div>" +
      "<h3>" + esc(T(c, "site.assets.scheduleHeading", "Maintenance schedule")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.assets.equipment", "Equipment")) + '</span><select id="asScAsset">' + assetOptions(c, d, true) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.assets.scheduleKind", "Kind")) + '</span><select id="asScKind"><option value="pm">' + jobWord(c, "pm") + '</option><option value="calibration">' + jobWord(c, "calibration") + "</option></select></label>" +
      f("asScDays", T(c, "site.assets.intervalDays", "Every (days)"), "number") + f("asScFrom", T(c, "site.assets.startFrom", "Counting from"), "date") + f("asScList", T(c, "site.assets.checklist", "Checklist items, separated by semicolons")) +
      '<button class="btn quiet" type="button" data-as="schedule">' + esc(T(c, "site.assets.saveSchedule", "Save schedule")) + "</button></div>";
  }

  WSQ.page("assets", { render: function (c) {
    var el = c.el, org = c.state.orgId, esc = c.esc, engineer = c.can("asset.manage");
    var q = "?orgId=" + encodeURIComponent(org);
    el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.assets.heading", "Assets and maintenance")) + '</h1></div><div id="asMsg"></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.assets.reportCard", "Report broken equipment")) + '</h2><div id="asComplaint"></div></div>' +
      (engineer ? '<div class="card"><h2>' + esc(T(c, "site.assets.dueCard", "Due, overdue and alerts")) + '</h2><div id="asDue"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.assets.jobsCard", "Job cards")) + '</h2><div id="asJobs"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.assets.registerCard", "Asset register")) + '</h2><div id="asRegister"></div></div>' : "");
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var data = null, depts = [];
    var paint = function () {
      set("asComplaint", complaintHtml(c, data)); set("asDue", dueHtml(c, data));
      set("asJobs", data == null ? loading(c) : !data.ok ? failed(c, T(c, "site.assets.jobsPhrase", "job cards")) : jobsHtml(c, data, true));
      set("asRegister", registerHtml(c, data, depts));
    };
    var load = function () { data = null; paint(); c.api("/ward/assets" + q).then(function (r) { data = r && r.ok ? r : { ok: false }; paint(); }, function () { data = { ok: false }; paint(); }); };
    if (engineer) c.api("/org" + q).then(function (r) { depts = (r && r.ok && r.departments) || []; paint(); });
    load();
    var msg = function (r) { set("asMsg", '<div class="msg err">' + TS(c, "site.assets.notSaved", "Not saved.") + " " + EN(c, esc((r && (r.detail || r.message || r.error)) || T(c, "site.assets.noResponse", "No response from the server."))) + "</div>"); };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(r); return; } set("asMsg", ""); c.toast(okText); load(); }; };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-as]"); if (!b) return;
      var act = b.getAttribute("data-as"), id = b.getAttribute("data-id");
      if (act === "complaint") return c.api("/ward/equipment-complaint", { orgId: org, assetId: val("asCpAsset"), description: val("asCpText") }).then(after(T(c, "site.assets.reported", "Reported. The biomedical engineering team sees it on their job cards.")));
      if (act === "assign") return c.api("/ward/job-card-update", { orgId: org, jobCardId: id, action: "assign", engineer: val("asEng-" + id) }).then(after(T(c, "site.assets.assigned", "Assigned.")));
      if (act === "part") return c.api("/ward/job-card-update", { orgId: org, jobCardId: id, action: "part", code: val("asPtCode-" + id), quantity: val("asPtQty-" + id), location: val("asPtLoc-" + id) }).then(after(T(c, "site.assets.partFitted", "Part recorded and booked out of the store.")));
      if (act === "close") {
        var checks = [], n = Number(b.getAttribute("data-checks")) || 0;
        for (var i = 0; i < n; i++) { var s = document.getElementById("asCk-" + id + "-" + i); if (s) checks.push({ item: s.getAttribute("data-item"), done: s.value === "true" }); }
        return c.api("/ward/job-card-update", { orgId: org, jobCardId: id, action: "close", resolution: val("asRes-" + id), checklist: checks, calibrationResult: val("asCal-" + id), downtimeMinutes: val("asDown-" + id), statusAfter: val("asAfter-" + id) }).then(after(T(c, "site.assets.jobClosed", "Job card closed.")));
      }
      if (act === "openjob") return c.api("/ward/job-card", { orgId: org, assetId: b.getAttribute("data-asset"), scheduleId: b.getAttribute("data-schedule"), kind: b.getAttribute("data-kind") }).then(after(T(c, "site.assets.jobOpened", "Job card opened.")));
      if (act === "history") { var h = document.getElementById("asHist-" + id); if (h) h.hidden = !h.hidden; return; }
      if (act === "tag") {
        var a = (data && data.assets || []).filter(function (x) { return x.assetId === id; })[0]; if (!a) return;
        var w = window.open("", "_blank"); if (!w) return;
        w.document.write("<html><body style=\"font-family:sans-serif;padding:16px\"><div style=\"border:2px solid #000;padding:12px;display:inline-block\"><div style=\"font-size:28px;font-weight:700\">" + esc(a.tag) + "</div><div>" + esc(a.name) + "</div><div>" + esc([a.make, a.model, a.serial].filter(Boolean).join(" · ")) + "</div></div></body></html>");
        w.document.close(); w.print(); return;
      }
      if (act === "register") {
        var contracts = val("asCtKind") ? [{ kind: val("asCtKind"), until: val("asCtUntil"), vendor: val("asCtVendor") }] : [];
        var cost = val("asCost");
        return c.api("/ward/asset", { orgId: org, tag: val("asTag"), name: val("asName"), category: val("asCat"), make: val("asMake"), model: val("asModel"), serial: val("asSerial"), departmentId: val("asDept"), location: val("asLoc"),
          purchaseDate: val("asBought"), costPaise: cost === "" ? "" : Math.round(Number(cost) * 100), vendor: val("asVendor"), warrantyUntil: val("asWarranty"), contracts: contracts, critical: val("asCrit") === "yes" }).then(after(T(c, "site.assets.registered", "Registered.")));
      }
      if (act === "move") return c.api("/ward/asset-event", { orgId: org, assetId: val("asEvAsset"), kind: "moved", departmentId: val("asEvDept"), location: val("asEvLoc"), reason: val("asEvReason") }).then(after(T(c, "site.assets.moved", "Moved.")));
      if (act === "status") return c.api("/ward/asset-event", { orgId: org, assetId: val("asEvAsset"), kind: "status", status: val("asEvStatus"), reason: val("asEvReason") }).then(after(T(c, "site.assets.statusSet", "Status recorded.")));
      if (act === "schedule") return c.api("/ward/maintenance-schedule", { orgId: org, assetId: val("asScAsset"), kind: val("asScKind"), intervalDays: Number(val("asScDays")), startFrom: val("asScFrom"), checklist: val("asScList").split(";") }).then(after(T(c, "site.assets.scheduleSaved", "Schedule saved.")));
    };
  } });

  WSQ._assets = { complaintHtml: complaintHtml, jobsHtml: jobsHtml, dueHtml: dueHtml, registerHtml: registerHtml };
})();
