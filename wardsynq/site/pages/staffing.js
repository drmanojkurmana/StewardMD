/* wardsynq/site/pages/staffing.js - the nurse staffing cards on the Staff rota page (P4 nursing-staffing,
 * functions/_wardsynq/nurse-staffing.js): nurses required per ward per shift against rostered and on duty, the
 * hospital's staffing norms, a draft roster a staff.admin publishes, and the staff needlestick and sharps injury report.
 * Buildless ES5; rota.js calls WSQ._staffing.mount.
 *
 * Not configured never reads as fully staffed, a missing dependency level never reads as met, and a section that failed
 * to load says so. The server decides who may do what; these cards only hide what a person could not use.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function set(id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; }
  function refusal(c, r) { return !r ? T(c, "site.staff.noResponse", "No response from the server.") : (r.message || r.error || T(c, "site.staff.failed", "failed")); }
  function errHtml(c, r) { return '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; }
  function loading(c) { return '<span class="spin"></span> ' + c.esc(T(c, "site.staff.loading", "Loading...")); }
  function localToday(c) {
    var off = c && c.state && c.state.org && c.state.org.wardsynq && c.state.org.wardsynq.utcOffsetMinutes != null ? Number(c.state.org.wardsynq.utcOffsetMinutes) : 330;
    return new Date(Date.now() + off * 60000).toISOString().slice(0, 10);
  }

  function verdictText(c, v) {
    if (v === "not_configured") return T(c, "site.staff.vNotConfigured", "Not configured");
    if (v === "short") return T(c, "site.staff.vShort", "Short");
    if (v === "met") return T(c, "site.staff.vMet", "Met");
    if (v === "incomplete") return T(c, "site.staff.vIncomplete", "Not complete: a dependency level or norm is missing");
    return "";
  }
  function reasonText(c, r) {
    if (r === "ward_has_no_unit_type") return T(c, "site.staff.rNoUnitType", "This ward has no unit type in the staffing norms.");
    if (r === "unit_type_has_no_norms") return T(c, "site.staff.rNoNorms", "This ward's unit type has no norm rows.");
    return r || "";
  }

  /* One ward-shift row of GET /ward/nurse-staffing. */
  function rowHtml(c, ward, s, canRecord) {
    var esc = c.esc, q = s.requirement, cells;
    var head = "<td>" + EN(c, esc(s.shift + " " + s.start + "-" + s.end)) + "</td>";
    var lead = s.inCharge ? "" : " " + esc(T(c, "site.staff.noInCharge", "(no in-charge named)"));
    if (s.timing === "ended") {
      var rec = s.recorded;
      if (!rec) return "<tr>" + head + "<td>" + esc(T(c, "site.staff.ended", "Ended")) + '</td><td colspan="5">' + esc(T(c, "site.staff.notRecorded", "Not recorded while it ran.")) + "</td></tr>";
      return "<tr" + (rec.verdict === "short" ? ' class="warn"' : "") + ">" + head + "<td>" + esc(T(c, "site.staff.ended", "Ended")) + "</td><td>" + rec.occupiedBeds + "</td><td>" + rec.required + "</td><td>" + rec.rosteredNurses + "</td><td>" + rec.onDutyNurses + "</td><td>" +
        esc(verdictText(c, rec.verdict)) + " " + esc(T(c, "site.staff.recordedAt", "(recorded {at})", { at: String(rec.recordedAt || "").slice(11, 16) })) + "</td></tr>";
    }
    var timing = s.timing === "running" ? T(c, "site.staff.running", "Running now") : T(c, "site.staff.coming", "Coming (projected from the census now)");
    if (!q.configured) {
      cells = "<td>" + q.census + "</td><td>" + esc(verdictText(c, "not_configured")) + "</td><td>" + s.rosteredNurses + lead + "</td><td>" + (s.onDutyNurses == null ? "" : s.onDutyNurses) + "</td><td>" + esc(reasonText(c, q.reason)) + "</td>";
    } else {
      var lines = (q.lines || []).map(function (l) { return EN(c, esc(l.band === "*" ? T(c, "site.staff.allPatients", "All patients") : l.band)) + ": " + esc(T(c, "site.staff.lineCalc", "{p} patients / {ppn} per nurse = {n}", { p: l.patients, ppn: l.patientsPerNurse, n: l.nurses })); }).join("<br>");
      var missing = q.missing.length ? "<br>" + esc(T(c, "site.staff.missingDependency", "No dependency level this shift, beds: {beds}", { beds: q.missing.map(function (m) { return m.bed || "?"; }).join(", ") })) : "";
      var noNorm = q.noNorm.length ? "<br>" + esc(T(c, "site.staff.noNormFor", "No norm for: {bands}", { bands: q.noNorm.map(function (n) { return n.band + " (" + n.patients + ")"; }).join(", ") })) : "";
      var v = s.timing === "running" ? s.onDutyVerdict : s.rosteredVerdict;
      cells = "<td>" + q.census + "</td><td>" + q.required + (q.complete ? "" : " " + esc(T(c, "site.staff.atLeast", "(at least)"))) + "<br><small>" + lines + missing + noNorm + "</small></td><td>" + s.rosteredNurses + lead + "</td><td>" + (s.onDutyNurses == null ? "" : s.onDutyNurses) + "</td><td>" + esc(verdictText(c, v)) + "</td>";
    }
    var act = canRecord && s.timing === "running" && q.configured ? ' <button class="btn quiet" type="button" data-staff="record" data-shift="' + esc(s.shiftId) + '" data-date="' + esc(s.date) + '">' + esc(T(c, "site.staff.recordShift", "Record this shift")) + "</button>" : "";
    return "<tr" + ((s.rosteredVerdict === "short" || s.onDutyVerdict === "short") ? ' class="warn"' : "") + ">" + head + "<td>" + esc(timing) + act + "</td>" + cells + "</tr>";
  }

  function staffingHtml(c, r, canRecord) {
    if (r == null) return loading(c);
    if (!r.ok) return errHtml(c, r) + '<div class="msg err">' + TS(c, "site.staff.staffingFailedTrail", "Do not read this as fully staffed.") + "</div>";
    var esc = c.esc;
    if (!r.rotaConfigured) return "<p>" + esc(T(c, "site.staff.noRota", "No shifts are set up on the rota, so there is nothing to staff.")) + "</p>";
    var notes = (r.partial ? '<div class="msg note">' + esc(T(c, "site.staff.partial", "The rota could not be read in full; counts may be low.")) + "</div>" : "") +
      (!r.toolFound ? '<div class="msg err">' + esc(T(c, "site.staff.toolMissing", "The dependency tool named in the staffing norms is not one of this hospital's risk tools. Every dependency level reads as missing.")) + "</div>" : "") +
      (r.assessmentsCapped ? '<div class="msg note">' + esc(T(c, "site.staff.assessCapped", "Too many dependency assessments to read in full; some levels may show as missing.")) + "</div>" : "");
    return notes + r.wards.map(function (w) {
      return "<h3>" + EN(c, esc(w.ward)) + '</h3><div class="tbl"><table><tr><th>' + esc(T(c, "site.staff.colShift", "Shift")) + "</th><th>" + esc(T(c, "site.staff.colWhen", "When")) + "</th><th>" + esc(T(c, "site.staff.colCensus", "Patients")) +
        "</th><th>" + esc(T(c, "site.staff.colRequired", "Nurses required")) + "</th><th>" + esc(T(c, "site.staff.colRostered", "Rostered (in-charge not counted)")) + "</th><th>" + esc(T(c, "site.staff.colOnDuty", "On duty now")) + "</th><th>" + esc(T(c, "site.staff.colVerdict", "Staffing")) + "</th></tr>" +
        w.shifts.map(function (s) { return rowHtml(c, w.ward, s, canRecord); }).join("") + "</table></div>";
    }).join("");
  }

  /* The norms as the admin types them: one row per line, fields split by "|". */
  function normsToText(s) {
    return {
      wardTypes: Object.keys(s.wardTypes || {}).map(function (w) { return w + " | " + s.wardTypes[w]; }).join("\n"),
      norms: (s.norms || []).map(function (n) { return n.unitType + " | " + n.shiftId + " | " + n.band + " | " + n.patientsPerNurse; }).join("\n"),
    };
  }
  function textToNorms(tool, wardText, normText) {
    var parts = function (line) { return line.split("|").map(function (x) { return x.trim(); }); };
    var lines = function (t) { return String(t || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
    var wardTypes = {};
    lines(wardText).forEach(function (l) { var p = parts(l); wardTypes[p[0]] = p[1] || ""; });
    var norms = lines(normText).map(function (l) { var p = parts(l); return { unitType: p[0], shiftId: p[1] || "*", band: p[2] || "*", patientsPerNurse: p[3] === undefined || p[3] === "" ? null : Number(p[3]) }; });
    return { dependencyToolId: tool || null, wardTypes: wardTypes, norms: norms };
  }
  function normsHtml(c, r) {
    if (r == null) return loading(c);
    if (!r.ok) return errHtml(c, r);
    var esc = c.esc, txt = normsToText(r.settings);
    return "<p>" + esc(T(c, "site.staff.normsHelp", "WardSynQ ships no staffing ratio. Enter your hospital's own: which unit type each ward is, and for each unit type how many patients one nurse cares for at each dependency level. Use * for every shift or every patient.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.staff.toolLabel", "Dependency tool (from your risk tools)")) + '</span><select id="stfTool"><option value="">' + esc(T(c, "site.staff.noTool", "None: count every patient alike")) + "</option>" +
      r.tools.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === r.settings.dependencyToolId ? " selected" : "") + ">" + EN(c, esc(t.name + " (" + t.bands.join(", ") + ")")) + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="f"><span>' + esc(T(c, "site.staff.wardTypesLabel", "Wards, one per line: ward | unit type")) + '</span><textarea id="stfWards" rows="4">' + esc(txt.wardTypes) + "</textarea></label>" +
      '<label class="f"><span>' + esc(T(c, "site.staff.normsLabel", "Norms, one per line: unit type | shift ID or * | dependency level or * | patients per nurse")) + '</span><textarea id="stfNorms" rows="6">' + esc(txt.norms) + "</textarea></label>" +
      "<p><small>" + esc(T(c, "site.staff.shiftIds", "Shift IDs: {ids}", { ids: r.shifts.map(function (s) { return s.id + " (" + s.unit + ")"; }).join(", ") })) + "</small></p>" +
      '<button class="btn" type="button" data-staff="norms">' + esc(T(c, "site.staff.saveNorms", "Save staffing norms")) + '</button><div id="stfNormsMsg"></div>';
  }

  function draftHtml(c, r) {
    if (r == null) return "";
    if (!r.ok) return errHtml(c, r);
    var esc = c.esc;
    var entries = r.entries.length ? "<ul>" + r.entries.map(function (e) { return "<li>" + EN(c, esc(e.date + " " + e.shiftId + ": " + e.identity)) + "</li>"; }).join("") + '</ul><button class="btn" type="button" data-staff="publish">' + esc(T(c, "site.staff.publish", "Publish this draft to the rota")) + "</button>"
      : "<p>" + esc(T(c, "site.staff.draftEmpty", "Nothing to add: the coming shifts are staffed to their requirement, or nobody is free.")) + "</p>";
    var unfilled = r.unfilled.length ? '<div class="msg note">' + esc(T(c, "site.staff.unfilled", "Still short after the draft: {list}", { list: r.unfilled.map(function (u) { return u.date + " " + u.shiftId + " (" + u.short + ")"; }).join(", ") })) + "</div>" : "";
    var skipped = r.notDrafted.length ? '<div class="msg note">' + esc(T(c, "site.staff.notDrafted", "Not drafted, no norm: {list}", { list: r.notDrafted.map(function (u) { return u.date + " " + u.shiftId; }).join(", ") })) + "</div>" : "";
    return '<div class="msg note">' + esc(T(c, "site.staff.draftOnly", "Draft only. Nothing is on the rota until you publish it; nurses on approved leave or on an overlapping shift are never suggested.")) + "</div>" + EN(c, "<p><small>" + esc(r.basis) + "</small></p>") + entries + unfilled + skipped;
  }

  var KINDS = ["needlestick", "sharp", "splash", "other"];
  function kindText(c, k) {
    return k === "needlestick" ? T(c, "site.staff.kNeedlestick", "Needlestick") : k === "sharp" ? T(c, "site.staff.kSharp", "Other sharp") : k === "splash" ? T(c, "site.staff.kSplash", "Blood or body fluid splash") : T(c, "site.staff.kOther", "Other");
  }
  function injuryFormHtml(c) {
    var esc = c.esc;
    return '<div class="row"><label class="f"><span>' + esc(T(c, "site.staff.injWhen", "When")) + '</span><input id="injAt" type="datetime-local"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.staff.injKind", "Kind")) + '</span><select id="injKind">' + KINDS.map(function (k) { return '<option value="' + k + '">' + esc(kindText(c, k)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.staff.injStaff", "Staff ID of the person injured")) + '</span><input id="injStaff"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.staff.injUnit", "Ward or unit")) + '</span><input id="injUnit"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.staff.injDevice", "Device")) + '</span><input id="injDevice"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.staff.injSource", "Source patient known")) + '</span><select id="injSource"><option value=""></option><option value="yes">' + esc(T(c, "site.staff.yes", "Yes")) + '</option><option value="no">' + esc(T(c, "site.staff.no", "No")) + '</option><option value="unknown">' + esc(T(c, "site.staff.unknown", "Unknown")) + "</option></select></label></div>" +
      '<label class="f"><span>' + esc(T(c, "site.staff.injWhat", "What happened")) + '</span><textarea id="injWhat" rows="3"></textarea></label>' +
      '<label class="f"><span>' + esc(T(c, "site.staff.injFirstAid", "First aid and who it was reported to")) + '</span><input id="injAid"></label>' +
      '<button class="btn" type="button" data-staff="injury">' + esc(T(c, "site.staff.injReport", "Report the injury")) + '</button><div id="injMsg"></div>';
  }
  function injuriesHtml(c, r) {
    if (r == null) return loading(c);
    if (!r.ok) return errHtml(c, r);
    var esc = c.esc;
    return (r.partial ? '<div class="msg note">' + esc(T(c, "site.staff.injPartial", "Not every report could be read; the list may be short.")) + "</div>" : "") +
      "<p>" + esc(T(c, "site.staff.injCount", "Needlestick and sharps injuries this month: {n}", { n: r.needlestickOrSharp })) + "</p>" +
      (r.reports.length ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.staff.injWhen", "When")) + "</th><th>" + esc(T(c, "site.staff.injKind", "Kind")) + "</th><th>" + esc(T(c, "site.staff.injUnit", "Ward or unit")) + "</th><th>" + esc(T(c, "site.staff.injWhat", "What happened")) + "</th></tr>" +
        r.reports.map(function (x) { return "<tr><td>" + EN(c, esc(String(x.occurredAt).slice(0, 16).replace("T", " "))) + "</td><td>" + esc(kindText(c, x.kind)) + "</td><td>" + EN(c, esc(x.unit || "")) + "</td><td>" + EN(c, esc(x.description)) + "</td></tr>"; }).join("") + "</table></div>"
        : "<p>" + esc(T(c, "site.staff.injNone", "No staff injuries reported this month.")) + "</p>");
  }

  /* Adds the cards to the rota page's `host` element and wires their buttons. */
  function mount(c, host) {
    var esc = c.esc, org = c.state.orgId, q = "?orgId=" + encodeURIComponent(org), admin = c.can("staff.admin");
    var canView = c.can("emr.view"), canRecord = c.can("emr.vitals"), canReport = c.can("incident.report"), canRead = c.can("quality.audit");
    var today = localToday(c), lastDraft = null;
    host.innerHTML =
      (canView ? '<div class="card"><h2>' + esc(T(c, "site.staff.staffingCard", "Nurse staffing against census")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.staff.dateLabel", "Date")) + '</span><input id="stfDate" type="date" value="' + esc(today) + '"></label>' +
        '<button class="btn quiet" type="button" data-staff="show">' + esc(T(c, "site.staff.show", "Show")) + '</button></div><div id="stfTable"></div><div id="stfMsg"></div></div>' : "") +
      (admin ? '<div class="card"><h2>' + esc(T(c, "site.staff.normsCard", "Staffing norms")) + '</h2><div id="stfNormsBox"></div></div>' +
        '<div class="card"><h2>' + esc(T(c, "site.staff.draftCard", "Draft roster")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.staff.wardLabel", "Ward")) + '</span><input id="stfDraftWard"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.staff.fromLabel", "From")) + '</span><input id="stfDraftFrom" type="date" value="' + esc(today) + '"></label>' +
        '<button class="btn quiet" type="button" data-staff="draft">' + esc(T(c, "site.staff.makeDraft", "Draft the next 7 days")) + '</button></div><div id="stfDraft"></div></div>' : "") +
      (canReport || canRead ? '<div class="card"><h2>' + esc(T(c, "site.staff.injuryCard", "Staff needlestick and sharps injuries")) + "</h2>" + (canReport ? injuryFormHtml(c) : "") +
        (canRead ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.staff.monthLabel", "Month")) + '</span><input id="injMonth" type="month" value="' + esc(today.slice(0, 7)) + '"></label><button class="btn quiet" type="button" data-staff="injuries">' + esc(T(c, "site.staff.show", "Show")) + '</button></div><div id="injList"></div>' : "") + "</div>" : "");

    var loadTable = function () { set("stfTable", staffingHtml(c, null)); c.api("/ward/nurse-staffing" + q + "&date=" + encodeURIComponent(val("stfDate"))).then(function (r) { set("stfTable", staffingHtml(c, r || { ok: false }, canRecord)); }, function () { set("stfTable", staffingHtml(c, { ok: false }, canRecord)); }); };
    var loadNorms = function () { set("stfNormsBox", normsHtml(c, null)); c.api("/org/staffing-norms" + q).then(function (r) { set("stfNormsBox", normsHtml(c, r || { ok: false })); }, function () { set("stfNormsBox", normsHtml(c, { ok: false })); }); };
    var loadInjuries = function () { set("injList", injuriesHtml(c, null)); c.api("/ward/staff-injuries" + q + "&month=" + encodeURIComponent(val("injMonth"))).then(function (r) { set("injList", injuriesHtml(c, r || { ok: false })); }, function () { set("injList", injuriesHtml(c, { ok: false })); }); };
    if (canView) loadTable();
    if (admin) loadNorms();
    if (canRead) loadInjuries();

    host.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-staff]"); if (!b) return;
      var act = b.getAttribute("data-staff");
      if (act === "show") return loadTable();
      if (act === "injuries") return loadInjuries();
      if (act === "record") return c.api("/ward/nurse-staffing-record", { orgId: org, shiftId: b.getAttribute("data-shift"), date: b.getAttribute("data-date") }).then(function (r) {
        if (!r || !r.ok) { set("stfMsg", errHtml(c, r)); return; }
        c.toast(T(c, "site.staff.recorded", "Shift staffing recorded.")); loadTable();
      }, function () { set("stfMsg", errHtml(c, null)); });
      if (act === "norms") return c.api("/org/staffing-norms", { orgId: org, settings: textToNorms(val("stfTool"), val("stfWards"), val("stfNorms")) }).then(function (r) {
        if (!r || !r.ok) { set("stfNormsMsg", errHtml(c, r)); return; }
        c.toast(T(c, "site.staff.normsSaved", "Staffing norms saved.")); set("stfNormsBox", normsHtml(c, r)); if (canView) loadTable();
      }, function () { set("stfNormsMsg", errHtml(c, null)); });
      if (act === "draft") { lastDraft = null; set("stfDraft", loading(c)); return c.api("/ward/staffing-draft" + q + "&ward=" + encodeURIComponent(val("stfDraftWard")) + "&from=" + encodeURIComponent(val("stfDraftFrom"))).then(function (r) { lastDraft = r && r.ok ? r : null; set("stfDraft", draftHtml(c, r || { ok: false })); }, function () { set("stfDraft", draftHtml(c, { ok: false })); }); }
      if (act === "publish" && lastDraft) return c.api("/roster/draft-publish", { orgId: org, entries: lastDraft.entries }).then(function (r) {
        if (!r || !r.ok) { set("stfDraft", errHtml(c, r) + draftHtml(c, lastDraft)); return; }
        c.toast(T(c, "site.staff.published", "Draft published to the rota.")); WSQ.render("rota");
      }, function () { set("stfDraft", errHtml(c, null) + draftHtml(c, lastDraft)); });
      if (act === "injury") {
        var when = val("injAt"), at = "";
        try { at = when ? new Date(when).toISOString() : ""; } catch (e) { at = ""; }
        return c.api("/ward/staff-injury", { orgId: org, occurredAt: at, kind: val("injKind"), injuredStaff: val("injStaff"), unit: val("injUnit"), device: val("injDevice"), sourceKnown: val("injSource"), description: val("injWhat"), firstAid: val("injAid") }).then(function (r) {
          if (!r || !r.ok) { set("injMsg", errHtml(c, r)); return; }
          set("injMsg", '<div class="msg ok">' + esc(T(c, "site.staff.injSaved", "Injury reported.")) + "</div>"); if (canRead) loadInjuries();
        }, function () { set("injMsg", errHtml(c, null)); });
      }
    };
  }

  WSQ._staffing = { mount: mount, staffingHtml: staffingHtml, normsHtml: normsHtml, draftHtml: draftHtml, injuriesHtml: injuriesHtml, textToNorms: textToNorms, normsToText: normsToText, verdictText: verdictText };
})();
