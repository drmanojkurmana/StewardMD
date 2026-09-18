/* wardsynq/site/pages/dialysis.js - "Dialysis unit": the day's schedule by station, sessions still missing their post-dialysis
 * values, and for one patient (by hospital number) the serology group, booking a station, the dialyzer reuse log and the
 * haemodialysis session record with URR. The unit's settings (stations, serology groups, reuse maximum) are for staff.admin.
 * Buildless ES5.
 *
 * Reads: GET /ward/dialysis-unit, GET /ward/dialysis-patient, GET /org/dialysis-settings. null is loading and a failed read
 * says so, never "none". A setting that is not configured says exactly that. URR is shown with its inputs, or as not
 * computable with the reason; Kt/V is not offered.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function when(iso) { return String(iso || "").slice(0, 16).replace("T", " "); }
  function localInput(iso) { if (!iso) return ""; var d = new Date(iso); if (isNaN(d.getTime())) return ""; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function isoOf(local) { if (!local) return ""; var d = new Date(local); return isNaN(d.getTime()) ? "" : d.toISOString(); }
  var HAS = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  function failed(c, what) { return '<div class="msg err">' + TS(c, "site.dialysis.failedWhat", "Could not load {what}. Do not read this as none.", { what: what }) + "</div>"; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.dialysis.loading", "Loading...")) + "</p>"; }
  function data(c, v) { return "<span>" + EN(c, c.esc(v == null ? "" : String(v))) + "</span>"; }
  function accessWord(c, a) {
    var w = { "av-fistula": T(c, "site.dialysis.access.avFistula", "AV fistula"), "av-graft": T(c, "site.dialysis.access.avGraft", "AV graft"),
      "tunnelled-catheter": T(c, "site.dialysis.access.tunnelled", "Tunnelled catheter"), "non-tunnelled-catheter": T(c, "site.dialysis.access.nonTunnelled", "Non-tunnelled catheter") };
    return HAS(w, a) ? c.esc(w[a]) : data(c, a);
  }
  function missingWord(c, k) {
    var w = { postWeightKg: T(c, "site.dialysis.missing.weight", "post weight"), postBp: T(c, "site.dialysis.missing.bp", "post blood pressure"),
      achievedUfMl: T(c, "site.dialysis.missing.uf", "achieved ultrafiltration"), endAt: T(c, "site.dialysis.missing.end", "end time") };
    return HAS(w, k) ? c.esc(w[k]) : data(c, k);
  }
  function ureaText(c, u) {
    if (!u) return "";
    return data(c, u.value + " " + (u.unit || "")) + (u.observationId ? " " + c.esc(T(c, "site.dialysis.urea.linked", "(linked laboratory result)")) : u.source ? " " + c.esc(T(c, "site.dialysis.urea.source", "source:")) + " " + data(c, u.source) : "");
  }
  function urrHtml(c, r) {
    if (!r) return "";
    if (r.computable) return "<b>" + c.esc(T(c, "site.dialysis.urrValue", "URR {v}%", { v: r.value })) + "</b> (" + c.esc(T(c, "site.dialysis.urrPre", "pre urea")) + " " + ureaText(c, r.inputs.pre) + "; " + c.esc(T(c, "site.dialysis.urrPost", "post urea")) + " " + ureaText(c, r.inputs.post) + ")";
    var why = { pre_urea_missing: T(c, "site.dialysis.urrWhy.pre", "no pre-dialysis urea"), post_urea_missing: T(c, "site.dialysis.urrWhy.post", "no post-dialysis urea"),
      units_differ: T(c, "site.dialysis.urrWhy.units", "the two ureas are in different units"), pre_urea_not_positive: T(c, "site.dialysis.urrWhy.zero", "the pre-dialysis urea is not above zero") };
    return c.esc(T(c, "site.dialysis.urrNot", "URR not computable:")) + " " + (HAS(why, r.reason) ? c.esc(why[r.reason]) : data(c, r.reason));
  }
  function bpText(bp) { return bp ? bp.systolic + "/" + bp.diastolic : ""; }

  function settingsSummary(c, s) {
    var esc = c.esc, out = [];
    out.push(s.stations.length ? esc(T(c, "site.dialysis.stationsCount", "{n} stations", { n: s.stations.length })) : esc(T(c, "site.dialysis.noStations", "No stations are set, so nobody can be booked.")));
    out.push(s.segregation ? esc(T(c, "site.dialysis.segregationOn", "Serology groups:")) + " " + data(c, s.serologyGroups.join(", ")) : esc(T(c, "site.dialysis.segregationOff", "Serology segregation: not configured. Stations are booked with no serology check.")));
    out.push(s.maxReuses != null ? esc(T(c, "site.dialysis.reuseMax", "A dialyzer may be reused {n} times.", { n: s.maxReuses })) : esc(T(c, "site.dialysis.reuseOff", "Dialyzer reuse: not configured. A reuse cannot be recorded.")));
    if (s.problems && s.problems.length) out.push('<span class="msg err">' + esc(T(c, "site.dialysis.settingsProblems", "The saved settings have problems and are treated as unset:")) + " " + data(c, s.problems.join(" ")) + "</span>");
    return "<ul><li>" + out.join("</li><li>") + "</li></ul>";
  }

  function scheduleHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.dialysis.schedulePhrase", "the dialysis schedule"));
    var esc = c.esc;
    var head = settingsSummary(c, d.settings) + (d.truncated ? '<div class="msg note">' + data(c, d.truncatedWarning) + "</div>" : "");
    if (!d.stations.length) return head;
    return head + d.stations.map(function (s) {
      return "<h3>" + data(c, s.name) + (s.serologyGroup ? " · " + data(c, s.serologyGroup) : "") + "</h3>" +
        (s.bookings.length ? "<ul>" + s.bookings.map(function (b) {
          return "<li>" + data(c, when(b.startAt)) + " · " + esc(T(c, "site.dialysis.minutes", "{n} minutes", { n: b.minutes })) + " · " + data(c, b.name || b.patientId) + (b.mrn ? " · " + data(c, b.mrn) : "") +
            (b.mrn ? ' <button class="btn quiet" type="button" data-dy="open" data-mrn="' + esc(b.mrn) + '">' + esc(T(c, "site.dialysis.openPatient", "Open")) + "</button>" : "") + "</li>";
        }).join("") + "</ul>" : "<p>" + esc(T(c, "site.dialysis.noBookings", "No patient is booked on this station that day.")) + "</p>");
    }).join("");
  }

  function missingHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, T(c, "site.dialysis.missingPhrase", "sessions missing post-dialysis values"));
    var esc = c.esc;
    if (!d.missingPost.length) return "<p>" + esc(T(c, "site.dialysis.noMissing", "Every recorded session has its post-dialysis values.")) + "</p>";
    return "<ul>" + d.missingPost.map(function (s) {
      return "<li>" + data(c, when(s.startAt)) + " · " + data(c, s.name || s.patientId) + (s.mrn ? " · " + data(c, s.mrn) : "") + " · " + data(c, s.stationName || s.stationId) + " · " +
        esc(T(c, "site.dialysis.missingList", "missing:")) + " " + s.missingPost.map(function (k) { return missingWord(c, k); }).join(", ") +
        (s.mrn ? ' <button class="btn quiet" type="button" data-dy="open" data-mrn="' + esc(s.mrn) + '">' + esc(T(c, "site.dialysis.openPatient", "Open")) + "</button>" : "") + "</li>";
    }).join("") + "</ul>";
  }

  function field(c, id, label, type, value, extra) {
    return '<label class="f"><span>' + c.esc(label) + '</span><input id="' + id + '"' + (type ? ' type="' + type + '"' : "") + (value != null && value !== "" ? ' value="' + c.esc(String(value)) + '"' : "") + (extra || "") + "></label>";
  }
  function select(c, id, label, options, chosen) {
    return '<label class="f"><span>' + c.esc(label) + '</span><select id="' + id + '">' + options.map(function (o) {
      return '<option value="' + c.esc(o[0]) + '"' + (String(o[0]) === String(chosen == null ? "" : chosen) ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("") + "</select></label>";
  }

  function ureaInputs(c, p, k, label, editing) {
    var esc = c.esc;
    var opts = [["", esc(editing ? T(c, "site.dialysis.urea.keep", "Keep as recorded") : T(c, "site.dialysis.urea.none", "Not yet"))], ["enter", esc(T(c, "site.dialysis.urea.enter", "Enter a value with its source"))]].concat(
      p.labResults.map(function (o) { return [o.observationId, EN(c, esc(o.code + " · " + o.value + " " + (o.unit || "") + (o.at ? " · " + when(o.at) : "")))]; }));
    return "<h4>" + esc(label) + '</h4><div class="row">' + select(c, "dy" + k + "-pick", T(c, "site.dialysis.urea.result", "Laboratory result"), opts, "") +
      field(c, "dy" + k + "-val", T(c, "site.dialysis.urea.value", "Value"), "number") + field(c, "dy" + k + "-unit", T(c, "site.dialysis.urea.unit", "Unit")) +
      field(c, "dy" + k + "-src", T(c, "site.dialysis.urea.sourceLabel", "Source (laboratory, report number)")) + "</div>";
  }

  function sessionForm(c, p, edit) {
    var esc = c.esc, s = edit || {};
    var st = p.settings.stations.map(function (x) { return [x.id, EN(c, esc(x.name + (x.serologyGroup ? " · " + x.serologyGroup : "")))]; });
    var enc = p.encounters.map(function (e) { return [e.encounterId, EN(c, esc(e.class + " · " + when(e.periodStart)))]; });
    if (edit && !p.encounters.some(function (e) { return e.encounterId === edit.encounterId; })) enc.unshift([edit.encounterId, EN(c, esc(edit.encounterId))]);
    var dz = [["", esc(T(c, "site.dialysis.noDialyzer", "No dialyzer named"))]].concat(p.dialyzers.filter(function (d) { return !d.discarded || (edit && edit.dialyzerId === d.dialyzerId); }).map(function (d) { return [d.dialyzerId, EN(c, esc(d.dialyzerId))]; }));
    var acc = p.accessTypes.map(function (a) { return [a, accessWord(c, a)]; });
    var sb = s.preBp || {}, pb = s.postBp || {};
    return "<h3>" + esc(edit ? T(c, "site.dialysis.editSession", "Add to or correct this session") : T(c, "site.dialysis.newSession", "Record a session")) + "</h3>" +
      (!enc.length ? '<div class="msg note">' + esc(T(c, "site.dialysis.noVisit", "This patient has no open stay or OPD visit. Check the patient in first.")) + "</div>" : "") +
      '<div class="row">' + select(c, "dyEnc", T(c, "site.dialysis.visit", "Stay or OPD visit"), enc, s.encounterId) + select(c, "dyStation", T(c, "site.dialysis.station", "Station"), st, s.stationId) +
      select(c, "dyAccess", T(c, "site.dialysis.access", "Vascular access"), acc, s.accessType) + "</div>" +
      '<div class="row">' + field(c, "dyStart", T(c, "site.dialysis.start", "Started"), "datetime-local", localInput(s.startAt)) + field(c, "dyEnd", T(c, "site.dialysis.end", "Ended"), "datetime-local", localInput(s.endAt)) + "</div>" +
      '<div class="row">' + field(c, "dyPreW", T(c, "site.dialysis.preWeight", "Pre weight (kg)"), "number", s.preWeightKg, ' step="0.1"') + field(c, "dyPostW", T(c, "site.dialysis.postWeight", "Post weight (kg)"), "number", s.postWeightKg, ' step="0.1"') +
      field(c, "dyPreSys", T(c, "site.dialysis.preSys", "Pre BP systolic"), "number", sb.systolic) + field(c, "dyPreDia", T(c, "site.dialysis.preDia", "Pre BP diastolic"), "number", sb.diastolic) +
      field(c, "dyPostSys", T(c, "site.dialysis.postSys", "Post BP systolic"), "number", pb.systolic) + field(c, "dyPostDia", T(c, "site.dialysis.postDia", "Post BP diastolic"), "number", pb.diastolic) + "</div>" +
      '<div class="row">' + field(c, "dyTargetUf", T(c, "site.dialysis.targetUf", "Target ultrafiltration (mL)"), "number", s.targetUfMl) + field(c, "dyAchUf", T(c, "site.dialysis.achievedUf", "Achieved ultrafiltration (mL)"), "number", s.achievedUfMl) +
      field(c, "dyWeightReason", T(c, "site.dialysis.weightReason", "Why the post weight is above the pre weight, if it is"), "", s.weightReason) + "</div>" +
      '<div class="row">' + select(c, "dyDialyzer", T(c, "site.dialysis.dialyzer", "Dialyzer"), dz, s.dialyzerId) + field(c, "dyNurse", T(c, "site.dialysis.nurse", "Nurse"), "", s.nurse) + field(c, "dyDoctor", T(c, "site.dialysis.doctor", "Doctor"), "", s.doctor) +
      field(c, "dyComplications", T(c, "site.dialysis.complications", "Complications"), "", s.complications) + "</div>" +
      '<p class="quiet">' + esc(T(c, "site.dialysis.anticoagNote", "Anticoagulation is ordered and given through the medication orders and eMAR, not recorded here.")) + "</p>" +
      ureaInputs(c, p, "pre", T(c, "site.dialysis.preUrea", "Pre-dialysis urea"), !!edit) + ureaInputs(c, p, "post", T(c, "site.dialysis.postUrea", "Post-dialysis urea"), !!edit) +
      '<p class="quiet">' + esc(T(c, "site.dialysis.urrFormula", "URR = (pre-dialysis urea minus post-dialysis urea) / pre-dialysis urea x 100 (Lowrie and Lew 1990; NKF KDOQI haemodialysis adequacy guideline, 2015 update). Kt/V is not calculated.")) + "</p>" +
      '<button class="btn" type="button" data-dy="session">' + esc(T(c, "site.dialysis.saveSession", "Save session")) + "</button>" +
      (edit ? ' <button class="btn quiet" type="button" data-dy="cancel-edit">' + esc(T(c, "site.dialysis.cancelEdit", "Stop editing")) + "</button>" : "");
  }

  function patientHtml(c, p, edit, canWrite) {
    if (p === undefined) return "";
    if (p == null) return loading(c);
    var esc = c.esc;
    if (!p.ok) return '<div class="msg err">' + TS(c, "site.dialysis.patientFailed", "The patient could not be opened.") + " " + data(c, p.detail || p.message || p.error || T(c, "site.dialysis.noResponse", "No response from the server.")) + "</div>";
    var s = p.settings, h = "<h3>" + data(c, p.patient.name) + " · " + data(c, p.patient.mrn) + "</h3>";
    h += "<h4>" + esc(T(c, "site.dialysis.serology", "Serology group")) + "</h4>";
    if (!s.segregation) h += "<p>" + esc(T(c, "site.dialysis.segregationOff", "Serology segregation: not configured. Stations are booked with no serology check.")) + "</p>";
    else {
      h += "<p>" + (p.serology ? data(c, p.serology.group) + " · " + esc(T(c, "site.dialysis.testedOn", "tested {d}", { d: p.serology.testedOn })) + (p.serology.note ? " · " + data(c, p.serology.note) : "") : esc(T(c, "site.dialysis.serologyNone", "No serology group is recorded. This patient cannot be booked until one is."))) + "</p>";
      if (canWrite) h += '<div class="row">' + select(c, "dySeroGroup", T(c, "site.dialysis.group", "Group"), s.serologyGroups.map(function (g) { return [g, data(c, g)]; }), p.serology && p.serology.group) +
        field(c, "dySeroDate", T(c, "site.dialysis.testDate", "Test date"), "date") + field(c, "dySeroNote", T(c, "site.dialysis.note", "Note")) +
        '<button class="btn quiet" type="button" data-dy="serology">' + esc(T(c, "site.dialysis.recordGroup", "Record group")) + "</button></div>";
    }
    if (canWrite) {
      h += "<h4>" + esc(T(c, "site.dialysis.bookHeading", "Book a station")) + "</h4>";
      h += s.stations.length ? '<div class="row">' + select(c, "dyBookStation", T(c, "site.dialysis.station", "Station"), s.stations.map(function (x) { return [x.id, EN(c, esc(x.name + (x.serologyGroup ? " · " + x.serologyGroup : "")))]; }), "") +
        select(c, "dyBookEnc", T(c, "site.dialysis.visit", "Stay or OPD visit"), [["", esc(T(c, "site.dialysis.noVisitChosen", "Not named"))]].concat(p.encounters.map(function (e) { return [e.encounterId, EN(c, esc(e.class + " · " + when(e.periodStart)))]; })), "") +
        field(c, "dyBookStart", T(c, "site.dialysis.bookStart", "Starts at"), "datetime-local") + field(c, "dyBookMin", T(c, "site.dialysis.bookMinutes", "Minutes"), "number") +
        '<button class="btn quiet" type="button" data-dy="book">' + esc(T(c, "site.dialysis.book", "Book")) + "</button></div>"
        : "<p>" + esc(T(c, "site.dialysis.noStations", "No stations are set, so nobody can be booked.")) + "</p>";
    }
    h += "<h4>" + esc(T(c, "site.dialysis.dialyzers", "Dialyzer reuse log")) + "</h4>" +
      "<p>" + (s.maxReuses != null ? esc(T(c, "site.dialysis.reuseMax", "A dialyzer may be reused {n} times.", { n: s.maxReuses })) : esc(T(c, "site.dialysis.reuseOff", "Dialyzer reuse: not configured. A reuse cannot be recorded."))) + "</p>" +
      (p.dialyzers.length ? "<ul>" + p.dialyzers.map(function (d) {
        return "<li>" + data(c, d.dialyzerId) + " · " + esc(T(c, "site.dialysis.uses", "first used {d}, {n} uses, {r} reuses", { d: when(d.firstUseAt), n: d.uses, r: d.reuses })) +
          (d.discarded ? " · <b>" + esc(T(c, "site.dialysis.discarded", "discarded {d}:", { d: when(d.discardedAt) })) + "</b> " + data(c, d.discardReason) : "") + "</li>";
      }).join("") + "</ul>" : "<p>" + esc(T(c, "site.dialysis.noDialyzers", "No dialyzer is logged for this patient.")) + "</p>");
    if (canWrite) h += '<div class="row">' + field(c, "dyDzId", T(c, "site.dialysis.dialyzerLabel", "Dialyzer label")) +
      select(c, "dyDzKind", T(c, "site.dialysis.dzKind", "Event"), [["first-use", esc(T(c, "site.dialysis.dz.first", "First use"))], ["reuse", esc(T(c, "site.dialysis.dz.reuse", "Reuse"))], ["discard", esc(T(c, "site.dialysis.dz.discard", "Discard"))]], "first-use") +
      field(c, "dyDzReason", T(c, "site.dialysis.dzReason", "Reason (for a discard)")) + '<button class="btn quiet" type="button" data-dy="dialyzer">' + esc(T(c, "site.dialysis.recordEvent", "Record")) + "</button></div>";
    if (canWrite) h += sessionForm(c, p, edit);
    h += "<h4>" + esc(T(c, "site.dialysis.sessions", "Sessions")) + "</h4>" + (p.sessions.length ? p.sessions.map(function (x) {
      return '<div class="card">' + data(c, when(x.startAt)) + (x.endAt ? " · " + data(c, when(x.endAt)) : "") + " · " + data(c, x.stationName || x.stationId) + " · " + accessWord(c, x.accessType) +
        "<br>" + esc(T(c, "site.dialysis.weights", "Weight")) + " " + data(c, x.preWeightKg + " / " + (x.postWeightKg == null ? "-" : x.postWeightKg) + " kg") +
        " · " + esc(T(c, "site.dialysis.bp", "BP")) + " " + data(c, bpText(x.preBp) + " / " + (bpText(x.postBp) || "-")) +
        " · " + esc(T(c, "site.dialysis.uf", "UF target / achieved")) + " " + data(c, (x.targetUfMl == null ? "-" : x.targetUfMl) + " / " + (x.achievedUfMl == null ? "-" : x.achievedUfMl) + " mL") +
        (x.weightReason ? "<br>" + esc(T(c, "site.dialysis.weightReasonShort", "Weight note:")) + " " + data(c, x.weightReason) : "") +
        (x.dialyzerId ? "<br>" + esc(T(c, "site.dialysis.dialyzerReuse", "Dialyzer {id}, reuse number {n}", { id: x.dialyzerId, n: x.reuseNumber })) : "") +
        (x.complications ? "<br>" + esc(T(c, "site.dialysis.complications", "Complications")) + ": " + data(c, x.complications) : "") +
        (x.nurse || x.doctor ? "<br>" + data(c, [x.nurse, x.doctor].filter(Boolean).join(" · ")) : "") +
        "<br>" + urrHtml(c, x.urr) +
        (x.missingPost.length ? '<br><span class="msg note">' + esc(T(c, "site.dialysis.missingList", "missing:")) + " " + x.missingPost.map(function (k) { return missingWord(c, k); }).join(", ") + "</span>" : "") +
        (canWrite ? ' <button class="btn quiet" type="button" data-dy="edit" data-id="' + esc(x.sessionId) + '">' + esc(T(c, "site.dialysis.edit", "Add or correct")) + "</button>" : "") + "</div>";
    }).join("") : "<p>" + esc(T(c, "site.dialysis.noSessions", "No session is recorded for this patient.")) + "</p>");
    return h;
  }

  function settingsHtml(c, r) {
    var esc = c.esc;
    if (r == null) return loading(c);
    if (!r.ok) return failed(c, T(c, "site.dialysis.settingsPhrase", "the dialysis settings"));
    var s = r.settings;
    var lines = s.stations.map(function (x) { return x.id + " | " + x.name + (x.serologyGroup ? " | " + x.serologyGroup : ""); }).join("\n");
    return settingsSummary(c, s) +
      '<p class="quiet">' + esc(T(c, "site.dialysis.settingsIntro", "None of these has a default: they are this unit's own policy. Leave serology groups empty for no segregation, and the maximum empty to record no reuse.")) + "</p>" +
      '<label class="f"><span>' + esc(T(c, "site.dialysis.stationsLabel", "Stations, one per line: id | name | serology group")) + '</span><textarea id="dySetStations" rows="5">' + esc(lines) + "</textarea></label>" +
      '<div class="row">' + field(c, "dySetGroups", T(c, "site.dialysis.groupsLabel", "Serology groups, separated by semicolons"), "", s.serologyGroups.join("; ")) +
      field(c, "dySetMax", T(c, "site.dialysis.maxLabel", "Maximum reuses of one dialyzer"), "number", s.maxReuses) + field(c, "dySetReason", T(c, "site.dialysis.reason", "Reason for the change")) +
      '<button class="btn" type="button" data-dy="settings">' + esc(T(c, "site.dialysis.saveSettings", "Save settings")) + "</button></div>";
  }

  WSQ.page("dialysis", { render: function (c) {
    var el = c.el, org = c.state.orgId, esc = c.esc, admin = c.can("staff.admin"), canWrite = c.can("emr.vitals");
    var q = "?orgId=" + encodeURIComponent(org);
    var S = { unit: null, patient: undefined, mrn: "", edit: null, settings: null, date: "" };
    el.innerHTML = '<div class="title"><h1>' + esc(T(c, "site.dialysis.heading", "Dialysis unit")) + '</h1></div><div id="dyMsg"></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.dialysis.scheduleCard", "Schedule by station")) + '</h2><div class="row">' + field(c, "dyDate", T(c, "site.dialysis.date", "Day"), "date") +
      '<button class="btn quiet" type="button" data-dy="day">' + esc(T(c, "site.dialysis.show", "Show")) + '</button></div><div id="dySchedule"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.dialysis.missingCard", "Sessions missing post-dialysis values")) + '</h2><div id="dyMissing"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.dialysis.patientCard", "Patient")) + '</h2><div class="row">' + field(c, "dyMrn", T(c, "site.dialysis.mrn", "Hospital number (MRN)")) +
      '<button class="btn" type="button" data-dy="find">' + esc(T(c, "site.dialysis.openPatient", "Open")) + '</button></div><div id="dyPatient"></div></div>' +
      (admin ? '<div class="card"><h2>' + esc(T(c, "site.dialysis.settingsCard", "Unit settings")) + '</h2><div id="dySettings"></div></div>' : "");
    var set = function (id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var paint = function () {
      set("dySchedule", scheduleHtml(c, S.unit)); set("dyMissing", missingHtml(c, S.unit));
      set("dyPatient", patientHtml(c, S.patient, S.edit, canWrite));
      if (admin) set("dySettings", settingsHtml(c, S.settings));
    };
    var loadUnit = function () { S.unit = null; paint(); c.api("/ward/dialysis-unit" + q + (S.date ? "&date=" + encodeURIComponent(S.date) : "")).then(function (r) { S.unit = r && r.ok ? r : { ok: false }; paint(); }, function () { S.unit = { ok: false }; paint(); }); };
    var loadPatient = function () { if (!S.mrn) return; S.patient = null; paint(); c.api("/ward/dialysis-patient" + q + "&mrn=" + encodeURIComponent(S.mrn)).then(function (r) { S.patient = r || { ok: false }; paint(); }, function () { S.patient = { ok: false }; paint(); }); };
    var loadSettings = function () { if (!admin) return; S.settings = null; paint(); c.api("/org/dialysis-settings" + q).then(function (r) { S.settings = r && r.ok ? r : { ok: false }; paint(); }, function () { S.settings = { ok: false }; paint(); }); };
    loadUnit(); loadSettings();
    var msg = function (r) { set("dyMsg", '<div class="msg err">' + TS(c, "site.dialysis.notSaved", "Not saved.") + " " + data(c, (r && (r.detail || r.message || r.error)) || T(c, "site.dialysis.noResponse", "No response from the server.")) + "</div>"); };
    var after = function (okText, reload) { return function (r) { if (!r || !r.ok) { msg(r); return; } set("dyMsg", ""); c.toast(okText); S.edit = null; if (reload) reload(); loadUnit(); loadPatient(); }; };
    var num = function (id) { var v = val(id); return v === "" ? "" : Number(v); };
    var bp = function (a, b) { return val(a) === "" && val(b) === "" ? null : { systolic: Number(val(a)), diastolic: Number(val(b)) }; };
    var urea = function (k) {
      var pick = val("dy" + k + "-pick");
      if (pick === "") return undefined;
      if (pick === "enter") return { value: val("dy" + k + "-val"), unit: val("dy" + k + "-unit"), source: val("dy" + k + "-src") };
      return { observationId: pick };
    };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-dy]"); if (!b) return;
      var act = b.getAttribute("data-dy"), pid = S.patient && S.patient.ok ? S.patient.patient.patientId : "";
      if (act === "day") { S.date = val("dyDate"); return loadUnit(); }
      if (act === "find" || act === "open") { S.mrn = act === "open" ? b.getAttribute("data-mrn") : val("dyMrn"); S.edit = null; return loadPatient(); }
      if (act === "serology") return c.api("/ward/dialysis-serology", { orgId: org, patientId: pid, group: val("dySeroGroup"), testedOn: val("dySeroDate"), note: val("dySeroNote") }).then(after(T(c, "site.dialysis.groupRecorded", "Serology group recorded.")));
      if (act === "book") return c.api("/ward/dialysis-book", { orgId: org, patientId: pid, stationId: val("dyBookStation"), encounterId: val("dyBookEnc"), startAt: isoOf(val("dyBookStart")), minutes: num("dyBookMin") }).then(after(T(c, "site.dialysis.booked", "Booked.")));
      if (act === "dialyzer") return c.api("/ward/dialyzer-event", { orgId: org, patientId: pid, dialyzerId: val("dyDzId"), kind: val("dyDzKind"), reason: val("dyDzReason") }).then(after(T(c, "site.dialysis.dzRecorded", "Dialyzer event recorded.")));
      if (act === "edit") { var id = b.getAttribute("data-id"); S.edit = (S.patient.sessions || []).filter(function (x) { return x.sessionId === id; })[0] || null; return paint(); }
      if (act === "cancel-edit") { S.edit = null; return paint(); }
      if (act === "session") {
        var body = { orgId: org, encounterId: val("dyEnc"), stationId: val("dyStation"), accessType: val("dyAccess"), startAt: isoOf(val("dyStart")), endAt: isoOf(val("dyEnd")),
          preWeightKg: num("dyPreW"), postWeightKg: num("dyPostW"), preBp: bp("dyPreSys", "dyPreDia"), postBp: bp("dyPostSys", "dyPostDia"),
          targetUfMl: num("dyTargetUf"), achievedUfMl: num("dyAchUf"), weightReason: val("dyWeightReason"), dialyzerId: val("dyDialyzer"),
          nurse: val("dyNurse"), doctor: val("dyDoctor"), complications: val("dyComplications"), preUrea: urea("pre"), postUrea: urea("post") };
        if (S.edit) { body.sessionId = S.edit.sessionId; body.expectedVersion = S.edit.version; } else body.patientId = pid;
        return c.api("/ward/dialysis-session", body).then(after(T(c, "site.dialysis.sessionSaved", "Session saved.")));
      }
      if (act === "settings") {
        var stations = val("dySetStations").split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { var p = l.split("|").map(function (x) { return x.trim(); }); return { id: p[0], name: p[1] || "", serologyGroup: p[2] || null }; });
        var groups = val("dySetGroups").split(";").map(function (x) { return x.trim(); }).filter(Boolean);
        return c.api("/org/dialysis-settings", { orgId: org, settings: { stations: stations, serologyGroups: groups, maxReuses: val("dySetMax") }, reason: val("dySetReason") }).then(after(T(c, "site.dialysis.settingsSaved", "Dialysis settings saved."), loadSettings));
      }
    };
  } });

  WSQ._dialysis = { scheduleHtml: scheduleHtml, missingHtml: missingHtml, patientHtml: patientHtml, settingsHtml: settingsHtml, urrHtml: urrHtml };
})();
