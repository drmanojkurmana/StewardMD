/* wardsynq/site/pages/hr.js - HR beyond the rota: Admin Center tabs Attendance, Credentials and Training, and the
 * "My HR records" card every staff member sees on the Staff rota page. Buildless ES5; exposes WSQ._hr for admin.js
 * and rota.js. Every button calls a real /api/queue/ward/hr-* route (functions/_wardsynq/hr-attendance.js and
 * hr-records.js); the server decides who may do what and this page only hides what a person could not use.
 *
 * null = loading, false = could not be loaded (never drawn as an empty list), else the server's answer.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function q(c) { return "?orgId=" + encodeURIComponent(c.state.orgId); }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function set(id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.hr.loading", "Loading...")) + "</p>"; }
  function failed(c, r) { return '<div class="msg err">' + TS(c, "site.hr.loadFailed", "Could not load this. Do not read it as none.") + (r && r.message ? " " + EN(c, c.esc(r.message)) : "") + "</div>"; }
  function refusal(c, r) { return !r ? T(c, "site.hr.noResponse", "No response from the server.") : (r.message || r.detail || r.error || T(c, "site.hr.failed", "failed")); }
  function say(c, id, r, okText) { set(id, '<div class="msg ' + (r && r.ok ? "ok" : "err") + '">' + (r && r.ok ? c.esc(okText) : EN(c, c.esc(refusal(c, r)))) + "</div>"); }
  function thisMonth() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7); }
  function localTime(iso) { return iso ? String(new Date(Date.parse(iso) + 330 * 60000).toISOString()).slice(0, 16).replace("T", " ") : ""; }
  function saveCsv(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv" })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  /* A staff member as shown: the name the hospital recorded, else the employee id, else "Name not set" (LT-36: a
   * sign-in id can be a phone number or an account id and is never shown as a name). */
  function person(c, staff, identity) {
    var m = (staff || []).filter(function (x) { return x.identity === identity; })[0] || {};
    if (m.displayName) return EN(c, c.esc(m.displayName)) + (m.employeeId ? ' <span class="quiet">' + EN(c, c.esc(m.employeeId)) + "</span>" : "");
    if (m.employeeId) return EN(c, c.esc(m.employeeId));
    return c.esc(T(c, "site.hr.nameNotSet", "Name not set"));
  }
  function staffOptions(c, staff, selected) {
    return (staff || []).filter(function (m) { return m.active !== false; }).map(function (m) {
      var label = m.displayName || m.employeeId || T(c, "site.hr.nameNotSet", "Name not set");
      return '<option value="' + c.esc(m.identity) + '"' + (m.identity === selected ? " selected" : "") + ">" + EN(c, c.esc(label)) + " (" + EN(c, c.esc(m.role || "")) + ")</option>";
    }).join("");
  }
  function statusLabel(c, s) {
    return {
      present: T(c, "site.hr.att.present", "Present"), late: T(c, "site.hr.att.late", "Late"), left_early: T(c, "site.hr.att.leftEarly", "Left early"),
      no_clock_out: T(c, "site.hr.att.noClockOut", "No clock-out"), absent: T(c, "site.hr.att.absent", "Absent"), upcoming: T(c, "site.hr.att.upcoming", "Upcoming"),
      not_clocked_in: T(c, "site.hr.att.notClockedIn", "Shift started, not clocked in"), in_progress: T(c, "site.hr.att.inProgress", "On shift now"),
    }[s] || s;
  }

  /* ---- Attendance (Admin) ------------------------------------------------------------------------------------ */

  var ATT = { month: null, data: null, edit: null, csv: null, headers: null, preview: null };

  function attendanceHtml(c, s) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("schedule") + " " + esc(T(c, "site.hr.att.title", "Attendance against the rota")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.hr.att.intro", "Staff clock in and out on their Staff rota page. Each rostered shift shows as present, late, left early, no clock-out or absent; absent only once the shift has ended.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.hr.monthLabel", "Month")) + '</span><input id="hrAttMonth" type="month" value="' + esc(s.month) + '"></label>' +
      '<button class="btn" type="button" data-hr="att-show">' + esc(T(c, "site.hr.show", "Show")) + '</button> <button class="btn ghost" type="button" data-hr="att-csv">' + esc(T(c, "site.hr.att.export", "Export CSV")) + "</button></div>";
    if (s.data === null) return h + loading(c) + "</div>";
    if (s.data === false || !s.data.ok) return h + failed(c, s.data) + "</div>";
    var d = s.data, staff = d.staff || [];
    if (d.partial) h += '<div class="msg note">' + esc(T(c, "site.hr.att.partial", "Attendance or the rota could not be read in full for this month; the counts may be understated.")) + "</div>";
    var ids = Object.keys(d.people || {});
    h += ids.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.colStaff", "Staff")) + "</th><th>" + esc(T(c, "site.hr.att.colRostered", "Rostered")) + "</th><th>" + esc(T(c, "site.hr.att.present", "Present")) + "</th><th>" +
      esc(T(c, "site.hr.att.late", "Late")) + "</th><th>" + esc(T(c, "site.hr.att.leftEarly", "Left early")) + "</th><th>" + esc(T(c, "site.hr.att.noClockOut", "No clock-out")) + "</th><th>" + esc(T(c, "site.hr.att.absent", "Absent")) + "</th><th>" + esc(T(c, "site.hr.att.colUnrostered", "Not rostered")) + "</th></tr></thead><tbody>" +
      ids.map(function (id) { var p = d.people[id]; return "<tr" + (p.absent ? ' class="warn"' : "") + "><td>" + person(c, staff, id) + "</td><td>" + p.rostered + "</td><td>" + p.present + "</td><td>" + p.late + "</td><td>" + p.leftEarly + "</td><td>" + p.noClockOut + "</td><td>" + p.absent + "</td><td>" + p.unrostered + "</td></tr>"; }).join("") +
      "</tbody></table></div>" : "<p>" + esc(T(c, "site.hr.att.noneRostered", "Nobody is rostered and nobody clocked in this month.")) + "</p>";
    var problems = (d.rows || []).filter(function (r) { return r.status !== "present" && r.status !== "upcoming" && r.status !== "in_progress" || r.flags.length; });
    h += "<h3>" + esc(T(c, "site.hr.att.attention", "Needs attention ({n})", { n: problems.length + (d.unrostered || []).length })) + "</h3>";
    if (problems.length || (d.unrostered || []).length) {
      h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.colStaff", "Staff")) + "</th><th>" + esc(T(c, "site.hr.colDate", "Date")) + "</th><th>" + esc(T(c, "site.hr.att.colShift", "Shift")) + "</th><th>" +
        esc(T(c, "site.hr.att.colIn", "Clock in")) + "</th><th>" + esc(T(c, "site.hr.att.colOut", "Clock out")) + "</th><th>" + esc(T(c, "site.hr.colStatus", "Status")) + "</th><th></th></tr></thead><tbody>" +
        problems.map(function (r) {
          return "<tr><td>" + person(c, staff, r.identity) + "</td><td>" + EN(c, esc(r.date)) + "</td><td>" + EN(c, esc(r.shift + " " + r.start + "-" + r.end)) + "</td><td>" + esc(localTime(r.clockIn)) + "</td><td>" + esc(localTime(r.clockOut)) + "</td><td>" +
            esc([r.status].concat(r.flags.filter(function (f) { return f !== r.status; })).map(function (x) { return statusLabel(c, x); }).join(", ")) + "</td><td>" +
            (r.attendanceId ? '<button class="btn ghost" type="button" data-hr="att-edit" data-id="' + esc(r.attendanceId) + '">' + esc(T(c, "site.hr.att.correct", "Correct")) + "</button>"
              : '<button class="btn ghost" type="button" data-hr="att-add" data-identity="' + esc(r.identity) + '" data-date="' + esc(r.date) + '" data-start="' + esc(r.start) + '">' + esc(T(c, "site.hr.att.addRecord", "Add a record")) + "</button>") + "</td></tr>";
        }).join("") + (d.unrostered || []).map(function (u) {
          return "<tr><td>" + person(c, staff, u.identity) + "</td><td>" + EN(c, esc(u.date)) + "</td><td>" + esc(T(c, "site.hr.att.colUnrostered", "Not rostered")) + "</td><td>" + esc(localTime(u.clockIn)) + "</td><td>" + esc(localTime(u.clockOut)) + "</td><td></td><td>" +
            '<button class="btn ghost" type="button" data-hr="att-edit" data-id="' + esc(u.id) + '">' + esc(T(c, "site.hr.att.correct", "Correct")) + "</button></td></tr>";
        }).join("") + "</tbody></table></div>";
    } else h += "<p>" + esc(T(c, "site.hr.att.nothingToCorrect", "Nothing needs attention this month.")) + "</p>";
    return h + "</div>" + correctionHtml(c, s, staff) + importHtml(c, s);
  }

  function correctionHtml(c, s, staff) {
    var esc = c.esc, e = s.edit || {};
    var rec = e.id ? ((s.data && s.data.records) || []).filter(function (x) { return x.id === e.id; })[0] : null;
    var toLocal = function (iso) { return iso ? new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 16) : ""; };
    return '<div class="card" id="hrAttEdit"><h2>' + esc(rec ? T(c, "site.hr.att.correctTitle", "Correct an attendance record") : T(c, "site.hr.att.addTitle", "Add a missing attendance record")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.hr.att.correctNote", "Times are the hospital's local time. A reason is required and kept with what it replaced.")) + "</p>" +
      '<div class="row">' + (rec ? "<p><b>" + person(c, staff, rec.identity) + "</b></p>" : '<label class="f"><span>' + esc(T(c, "site.hr.colStaff", "Staff")) + '</span><select id="hrAttWho">' + staffOptions(c, staff, e.identity) + "</select></label>") +
      '<label class="f"><span>' + esc(T(c, "site.hr.att.colIn", "Clock in")) + '</span><input id="hrAttIn" type="datetime-local" value="' + esc(rec ? toLocal(rec.clockIn) : (e.date && e.start ? e.date + "T" + e.start : "")) + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.att.colOut", "Clock out")) + '</span><input id="hrAttOut" type="datetime-local" value="' + esc(rec ? toLocal(rec.clockOut) : "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.reasonLabel", "Reason")) + '</span><input id="hrAttReason" maxlength="300"></label></div>' +
      '<button class="btn" type="button" data-hr="att-save" data-id="' + esc(rec ? rec.id : "") + '">' + esc(T(c, "site.hr.save", "Save")) + "</button> " +
      (rec ? '<button class="btn danger" type="button" data-hr="att-void" data-id="' + esc(rec.id) + '">' + esc(T(c, "site.hr.att.void", "Void this record")) + "</button> " : "") +
      '<div id="hrAttEditMsg" aria-live="polite"></div></div>';
  }

  function importHtml(c, s) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("upload_file") + " " + esc(T(c, "site.hr.imp.title", "Import from a biometric device")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.hr.imp.intro", "Export the device's punches as CSV. Choose the columns, preview what would be recorded and what would not (duplicates, unknown staff codes, unreadable lines), then import. Staff codes are matched to each member's employee ID.")) + "</p>" +
      '<input id="hrImpFile" type="file" accept=".csv,text/csv"> <button class="btn" type="button" data-hr="imp-read">' + esc(T(c, "site.hr.imp.read", "Read file")) + "</button>";
    if (s.headers) {
      var opts = function (id, optional) {
        return '<select id="' + id + '">' + (optional ? '<option value="">' + esc(T(c, "site.hr.imp.none", "None")) + "</option>" : "") + s.headers.map(function (hd, i) { return '<option value="' + i + '">' + EN(c, esc(hd || String(i + 1))) + "</option>"; }).join("") + "</select>";
      };
      h += '<div class="row"><label class="f"><span>' + esc(T(c, "site.hr.imp.staffCol", "Staff code column")) + "</span>" + opts("hrImpStaff") + "</label>" +
        '<label class="f"><span>' + esc(T(c, "site.hr.imp.dateCol", "Date column (if separate)")) + "</span>" + opts("hrImpDate", true) + "</label>" +
        '<label class="f"><span>' + esc(T(c, "site.hr.imp.timeCol", "Time or date and time column")) + "</span>" + opts("hrImpTime") + "</label>" +
        '<label class="f"><span>' + esc(T(c, "site.hr.imp.dirCol", "In or out column (optional)")) + "</span>" + opts("hrImpDir", true) + "</label>" +
        '<label class="f"><span>' + esc(T(c, "site.hr.imp.dateOrder", "Date order")) + '</span><select id="hrImpOrder"><option value="dmy">' + esc(T(c, "site.hr.imp.dmy", "Day, month, year")) + '</option><option value="ymd">' + esc(T(c, "site.hr.imp.ymd", "Year, month, day")) + '</option><option value="mdy">' + esc(T(c, "site.hr.imp.mdy", "Month, day, year")) + "</option></select></label></div>" +
        '<button class="btn" type="button" data-hr="imp-preview">' + esc(T(c, "site.hr.imp.preview", "Preview")) + "</button>";
    }
    var p = s.preview;
    if (p && p.ok) {
      h += '<div class="msg note">' + esc(T(c, "site.hr.imp.summary", "{n} records would be imported. Already recorded: {dup}. Duplicates in the file: {dupFile}. Unreadable lines: {bad}. Unknown staff codes: {unknown}. Without a clock-out: {open}. Clock-outs with no clock-in: {orphan}.",
        { n: p.toWrite, dup: p.duplicatesInStore, dupFile: p.duplicatesInFile, bad: p.unreadableCount, unknown: p.unknownStaffCount, open: p.withoutClockOut, orphan: p.orphanOuts })) + "</div>" +
        (p.unknownStaff && p.unknownStaff.length ? "<p>" + esc(T(c, "site.hr.imp.unknownList", "Unknown staff codes:")) + " " + EN(c, esc(p.unknownStaff.join(", "))) + "</p>" : "") +
        (p.unreadableLines && p.unreadableLines.length ? "<p>" + esc(T(c, "site.hr.imp.badLines", "Unreadable lines:")) + " " + esc(p.unreadableLines.join(", ")) + "</p>" : "") +
        (p.step === "done" ? '<div class="msg ok">' + esc(T(c, "site.hr.imp.done", "Imported {n} records.", { n: p.written })) + "</div>"
          : p.toWrite ? '<button class="btn primary" type="button" data-hr="imp-commit" data-count="' + p.toWrite + '">' + esc(T(c, "site.hr.imp.commit", "Import {n} records", { n: p.toWrite })) + "</button>" : "");
    } else if (p) h += '<div class="msg err">' + EN(c, esc(refusal(c, p))) + "</div>";
    return h + '<div id="hrImpMsg" aria-live="polite"></div></div>';
  }

  function renderAttendance(c, body) {
    var s = ATT;
    s.month = s.month || thisMonth();
    var draw = function () { body.innerHTML = attendanceHtml(c, s); };
    var load = function () {
      s.data = null; draw();
      c.api("/ward/hr-attendance" + q(c) + "&month=" + encodeURIComponent(s.month)).then(function (r) { s.data = r && r.ok ? r : (r || false); draw(); });
    };
    var mapping = function () {
      return { staffColumn: val("hrImpStaff"), dateColumn: val("hrImpDate"), timeColumn: val("hrImpTime"), directionColumn: val("hrImpDir"), dateOrder: val("hrImpOrder") };
    };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-hr]"); if (!b) return;
      var act = b.getAttribute("data-hr");
      if (act === "att-show") { s.month = val("hrAttMonth") || thisMonth(); s.edit = null; return load(); }
      if (act === "att-csv") {
        return c.api("/ward/hr-attendance" + q(c) + "&format=csv&month=" + encodeURIComponent(val("hrAttMonth") || s.month)).then(function (r) {
          if (r && r.ok && r.csv) saveCsv(r.csv, "attendance-" + r.month + ".csv"); else c.toast(refusal(c, r));
        });
      }
      if (act === "att-edit") { s.edit = { id: b.getAttribute("data-id") }; draw(); var e1 = document.getElementById("hrAttEdit"); if (e1 && e1.scrollIntoView) e1.scrollIntoView(); return; }
      if (act === "att-add") { s.edit = { identity: b.getAttribute("data-identity"), date: b.getAttribute("data-date"), start: b.getAttribute("data-start") }; draw(); return; }
      if (act === "att-save" || act === "att-void") {
        var id = b.getAttribute("data-id");
        var payload = act === "att-void" ? { orgId: c.state.orgId, id: id, void: true, reason: val("hrAttReason") }
          : { orgId: c.state.orgId, id: id || undefined, identity: id ? undefined : val("hrAttWho"), clockIn: val("hrAttIn"), clockOut: val("hrAttOut"), reason: val("hrAttReason") };
        b.disabled = true;
        return c.api("/ward/hr-attendance-correct", payload).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) return say(c, "hrAttEditMsg", r);
          c.toast(T(c, "site.hr.saved", "Saved.")); s.edit = null; load();
        });
      }
      if (act === "imp-read") {
        var f = document.getElementById("hrImpFile"), file = f && f.files && f.files[0];
        if (!file) return say(c, "hrImpMsg", { ok: false, message: T(c, "site.hr.imp.chooseFile", "Choose the CSV file first.") });
        var reader = new FileReader();
        reader.onload = function () {
          s.csv = String(reader.result || ""); s.preview = null;
          c.api("/ward/hr-attendance-import", { orgId: c.state.orgId, csv: s.csv }).then(function (r) {
            if (!r || !r.ok) return say(c, "hrImpMsg", r);
            s.headers = r.headers; draw();
          });
        };
        reader.readAsText(file);
        return;
      }
      if (act === "imp-preview" || act === "imp-commit") {
        b.disabled = true;
        var m = mapping();
        return c.api("/ward/hr-attendance-import", { orgId: c.state.orgId, csv: s.csv, mapping: m, commit: act === "imp-commit", confirmCount: act === "imp-commit" ? Number(b.getAttribute("data-count")) : undefined }).then(function (r) {
          b.disabled = false; s.preview = r || { ok: false }; s.lastMapping = m; draw();
          if (r && r.ok && r.step === "done") load();
        });
      }
    };
    load();
  }

  /* ---- Credentials (Admin) ----------------------------------------------------------------------------------- */

  var CRED = { data: null, edit: null };
  var CATEGORIES = ["State medical council", "State nursing council", "State pharmacy council", "BLS", "ACLS", "PALS", "NRP"];
  function stateLabel(c, s) {
    return { valid: T(c, "site.hr.cred.valid", "Valid"), expiring: T(c, "site.hr.cred.expiring", "Expiring"), expired: T(c, "site.hr.cred.expired", "Expired"), no_expiry: T(c, "site.hr.cred.noExpiry", "No expiry recorded") }[s] || s;
  }
  function credPill(c, x) {
    var cls = x.state === "expired" ? " stop" : x.state === "expiring" ? " warn" : " ok";
    return '<span class="pill' + cls + '">' + c.esc(stateLabel(c, x.state)) + "</span>" + (x.daysLeft != null && x.daysLeft >= 0 ? ' <span class="quiet">' + c.esc(T(c, "site.hr.cred.daysLeft", "{n} days left", { n: x.daysLeft })) + "</span>" : "");
  }
  function alertsHtml(c, alerts, staff, self) {
    var esc = c.esc;
    if (!alerts.length) return "<p>" + esc(T(c, "site.hr.cred.noAlerts", "No expiry alerts waiting.")) + "</p>";
    return "<ul>" + alerts.map(function (a) {
      return "<li>" + (self ? "" : person(c, staff, a.identity) + ": ") + EN(c, esc(a.name)) + " " + esc(T(c, "site.hr.cred.alertLine", "expires on {date} ({n} day alert)", { date: a.validTo, n: a.threshold })) +
        ' <button class="btn ghost" type="button" data-hr="' + (self ? "self-ack" : "cred-ack") + '" data-id="' + esc(a.id) + '">' + esc(T(c, "site.hr.cred.ack", "Acknowledge")) + "</button></li>";
    }).join("") + "</ul>";
  }

  function credentialsHtml(c, s) {
    var esc = c.esc;
    var hrCfg = (c.state.org && c.state.org.wardsynq && c.state.org.wardsynq.hr) || {};
    var h = '<div class="card"><h2>' + c.ms("badge") + " " + esc(T(c, "site.hr.cred.title", "Registrations and certificates")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.hr.cred.intro", "Alerts are raised 60, 30 and 7 days before a credential expires, for the staff member (on their Staff rota page) and for HR (here).")) + "</p>" +
      '<label class="f"><input id="hrSignRule" type="checkbox"' + (hrCfg.expiredRegistrationBlocksSigning === true ? " checked" : "") + "> " + esc(T(c, "site.hr.cred.signRule", "An expired registration blocks signing clinical notes and prescriptions")) + "</label>" +
      '<p class="quiet">' + esc(T(c, "site.hr.cred.signRuleNote", "Off by default. When on, a member whose recorded registrations have all expired can still write, but cannot sign. A member with no registration recorded is not blocked by this rule.")) + "</p>" +
      '<button class="btn ghost" type="button" data-hr="cred-rule">' + esc(T(c, "site.hr.cred.saveRule", "Save this rule")) + '</button> <button class="btn ghost" type="button" data-hr="cred-check">' + esc(T(c, "site.hr.cred.checkNow", "Check expiries now")) + '</button><div id="hrCredRuleMsg" aria-live="polite"></div></div>';
    if (s.data === null) return h + '<div class="card">' + loading(c) + "</div>";
    if (s.data === false || !s.data.ok) return h + '<div class="card">' + failed(c, s.data) + "</div>";
    var d = s.data, staff = d.staff || [];
    h += '<div class="card"><h2>' + esc(T(c, "site.hr.cred.alertsTitle", "Expiry alerts for HR")) + "</h2>" + alertsHtml(c, d.alerts || [], staff, false) + "</div>";
    h += '<div class="card"><h2>' + esc(T(c, "site.hr.cred.listTitle", "On record")) + "</h2>" + (d.partial ? '<div class="msg note">' + esc(T(c, "site.hr.partial", "Not every record could be read; some may be missing.")) + "</div>" : "") +
      (d.credentials.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.colStaff", "Staff")) + "</th><th>" + esc(T(c, "site.hr.cred.colWhat", "Credential")) + "</th><th>" + esc(T(c, "site.hr.cred.colNumber", "Number")) + "</th><th>" +
        esc(T(c, "site.hr.cred.colValidTo", "Valid until")) + "</th><th>" + esc(T(c, "site.hr.colStatus", "Status")) + "</th><th></th></tr></thead><tbody>" +
        d.credentials.map(function (x) {
          return "<tr" + (x.state === "expired" ? ' class="warn"' : "") + "><td>" + person(c, staff, x.identity) + "</td><td>" + EN(c, esc(x.category)) + "<br>" + EN(c, esc(x.name)) + "</td><td>" + EN(c, esc(x.number || "")) + "</td><td>" + EN(c, esc(x.validTo || "")) + "</td><td>" + credPill(c, x) + "</td><td>" +
            '<button class="btn ghost" type="button" data-hr="cred-edit" data-id="' + esc(x.id) + '">' + esc(T(c, "site.hr.change", "Change")) + '</button> <button class="btn ghost" type="button" data-hr="cred-remove" data-id="' + esc(x.id) + '">' + esc(T(c, "site.hr.remove", "Remove")) + "</button></td></tr>";
        }).join("") + "</tbody></table></div>" : "<p>" + esc(T(c, "site.hr.cred.none", "No credentials recorded yet.")) + "</p>") + "</div>";
    var e = s.edit ? d.credentials.filter(function (x) { return x.id === s.edit; })[0] || {} : {};
    h += '<div class="card" id="hrCredForm"><h2>' + esc(e.id ? T(c, "site.hr.cred.editTitle", "Change a credential") : T(c, "site.hr.cred.addTitle", "Record a credential")) + '</h2><div class="row">' +
      (e.id ? "<p><b>" + person(c, staff, e.identity) + "</b></p>" : '<label class="f"><span>' + esc(T(c, "site.hr.colStaff", "Staff")) + '</span><select id="hrCredWho">' + staffOptions(c, staff) + "</select></label>") +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.kind", "Kind")) + '</span><select id="hrCredKind"><option value="registration"' + (e.kind === "registration" ? " selected" : "") + ">" + esc(T(c, "site.hr.cred.registration", "Professional registration")) + '</option><option value="certificate"' + (e.kind === "certificate" ? " selected" : "") + ">" + esc(T(c, "site.hr.cred.certificate", "Certificate")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.category", "Council or certificate")) + '</span><input id="hrCredCat" list="hrCredCats" value="' + esc(e.category || "") + '"><datalist id="hrCredCats">' + CATEGORIES.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + "</datalist></label>" +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.name", "Name")) + '</span><input id="hrCredName" value="' + esc(e.name || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.colNumber", "Number")) + '</span><input id="hrCredNo" value="' + esc(e.number || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.issuer", "Issued by")) + '</span><input id="hrCredIssuer" value="' + esc(e.issuer || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.validFrom", "Valid from")) + '</span><input id="hrCredFrom" type="date" value="' + esc(e.validFrom || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.cred.colValidTo", "Valid until")) + '</span><input id="hrCredTo" type="date" value="' + esc(e.validTo || "") + '"></label></div>' +
      '<button class="btn" type="button" data-hr="cred-save" data-id="' + esc(e.id || "") + '">' + esc(T(c, "site.hr.save", "Save")) + '</button><div id="hrCredMsg" aria-live="polite"></div></div>';
    return h;
  }

  function renderCredentials(c, body) {
    var s = CRED;
    var draw = function () { body.innerHTML = credentialsHtml(c, s); };
    var load = function () { s.data = null; draw(); c.api("/ward/hr-credentials" + q(c)).then(function (r) { s.data = r && r.ok ? r : (r || false); draw(); }); };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-hr]"); if (!b) return;
      var act = b.getAttribute("data-hr"), id = b.getAttribute("data-id");
      if (act === "cred-rule") {
        var cur = (c.state.org && c.state.org.wardsynq && c.state.org.wardsynq.hr) || {};
        var next = { lateGraceMinutes: cur.lateGraceMinutes, expiredRegistrationBlocksSigning: !!(document.getElementById("hrSignRule") || {}).checked };
        return c.api("/org/update", { orgId: c.state.orgId, wardsynq: { hr: next } }).then(function (r) { if (r && r.ok && r.org) c.state.org = r.org; say(c, "hrCredRuleMsg", r, T(c, "site.hr.saved", "Saved.")); });
      }
      if (act === "cred-check") return c.api("/ward/hr-credential-alerts", { orgId: c.state.orgId }).then(function (r) { say(c, "hrCredRuleMsg", r, T(c, "site.hr.cred.checked", "Checked. New alerts: {n}.", { n: r && r.created })); if (r && r.ok) load(); });
      if (act === "cred-ack") return c.api("/ward/hr-alert-ack", { orgId: c.state.orgId, id: id }).then(function (r) { if (r && r.ok) load(); else c.toast(refusal(c, r)); });
      if (act === "cred-edit") { s.edit = id; draw(); return; }
      if (act === "cred-remove") {
        var why = ""; try { why = prompt(T(c, "site.hr.cred.removePrompt", "Why is this credential being removed?")) || ""; } catch (e) {}
        if (!why.trim()) return;
        return c.api("/ward/hr-credential-save", { orgId: c.state.orgId, id: id, remove: true, reason: why.trim() }).then(function (r) { if (r && r.ok) load(); else c.toast(refusal(c, r)); });
      }
      if (act === "cred-save") {
        b.disabled = true;
        return c.api("/ward/hr-credential-save", { orgId: c.state.orgId, id: id || undefined, identity: val("hrCredWho"), kind: val("hrCredKind"), category: val("hrCredCat"), name: val("hrCredName"),
          number: val("hrCredNo"), issuer: val("hrCredIssuer"), validFrom: val("hrCredFrom"), validTo: val("hrCredTo") }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) return say(c, "hrCredMsg", r);
          c.toast(T(c, "site.hr.saved", "Saved.")); s.edit = null; load();
        });
      }
    };
    load();
  }

  /* ---- Training (Admin) -------------------------------------------------------------------------------------- */

  var TRN = { data: null, attendFor: null };
  function courseName(d, id) { var x = (d.courses || []).filter(function (k) { return k.id === id; })[0]; return x ? x.name : id; }

  function trainingHtml(c, s) {
    var esc = c.esc;
    if (s.data === null) return '<div class="card">' + loading(c) + "</div>";
    if (s.data === false || !s.data.ok) return '<div class="card">' + failed(c, s.data) + "</div>";
    var d = s.data, staff = d.staff || [], cp = d.compliance;
    var pct = function (p) { return p == null ? esc(T(c, "site.hr.trn.noneRequired", "none required")) : esc(String(p)) + "%"; };
    var h = '<div class="card"><h2>' + c.ms("school") + " " + esc(T(c, "site.hr.trn.complianceTitle", "Mandatory training compliance")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.hr.trn.complianceIntro", "Of the mandatory courses that apply to each active member's role, the share whose latest completion is still valid. Evidence for NABH HRM.")) + "</p>" +
      (d.partial ? '<div class="msg note">' + esc(T(c, "site.hr.partial", "Not every record could be read; some may be missing.")) + "</div>" : "") +
      "<p><b>" + esc(T(c, "site.hr.trn.hospital", "Hospital")) + ":</b> " + pct(cp.hospital.percent) + " " + esc(T(c, "site.hr.trn.ofRequired", "({done} of {required})", { done: cp.hospital.compliant, required: cp.hospital.required })) + "</p>" +
      (cp.departments.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.trn.colDept", "Department")) + "</th><th>" + esc(T(c, "site.hr.trn.colStaff", "Staff")) + "</th><th>" + esc(T(c, "site.hr.trn.colRequired", "Required")) + "</th><th>" + esc(T(c, "site.hr.trn.colValid", "Valid")) + "</th><th>" + esc(T(c, "site.hr.trn.colPercent", "Compliance")) + "</th></tr></thead><tbody>" +
        cp.departments.map(function (x) { return "<tr" + (x.percent != null && x.percent < 80 ? ' class="warn"' : "") + "><td>" + (x.name ? EN(c, esc(x.name)) : esc(T(c, "site.hr.trn.noDept", "No department recorded"))) + "</td><td>" + x.staff + "</td><td>" + x.required + "</td><td>" + x.compliant + "</td><td>" + pct(x.percent) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : "<p>" + esc(T(c, "site.hr.trn.noMandatory", "No mandatory course is set up yet.")) + "</p>") + "</div>";

    h += '<div class="card"><h2>' + esc(T(c, "site.hr.trn.coursesTitle", "Courses")) + "</h2>" +
      '<button class="btn ghost" type="button" data-hr="trn-standard">' + esc(T(c, "site.hr.trn.addStandard", "Add the six mandatory courses (fire safety, infection control, BLS, hand hygiene, POSH, DPDP)")) + "</button>" +
      (d.courses.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.trn.colCourse", "Course")) + "</th><th>" + esc(T(c, "site.hr.trn.colMandatory", "Mandatory")) + "</th><th>" + esc(T(c, "site.hr.trn.colValidity", "Valid for (months)")) + "</th><th></th></tr></thead><tbody>" +
        d.courses.map(function (k) {
          return "<tr><td>" + EN(c, esc(k.name)) + "</td><td>" + esc(k.mandatory ? T(c, "site.hr.yes", "Yes") : T(c, "site.hr.no", "No")) + '</td><td><input type="number" min="1" max="120" style="max-width:6em" id="hrV_' + esc(k.id) + '" value="' + esc(k.validityMonths || "") + '"></td><td>' +
            '<button class="btn ghost" type="button" data-hr="trn-validity" data-id="' + esc(k.id) + '" data-name="' + esc(k.name) + '" data-mandatory="' + (k.mandatory ? "1" : "") + '">' + esc(T(c, "site.hr.save", "Save")) + "</button></td></tr>";
        }).join("") + "</tbody></table></div>" : "<p>" + esc(T(c, "site.hr.trn.noCourses", "No courses yet.")) + "</p>") +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.hr.trn.newCourse", "New course")) + '</span><input id="hrCourseName"></label><label class="f"><input id="hrCourseMand" type="checkbox"> ' + esc(T(c, "site.hr.trn.colMandatory", "Mandatory")) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.hr.trn.colValidity", "Valid for (months)")) + '</span><input id="hrCourseMonths" type="number" min="1" max="120"></label><button class="btn" type="button" data-hr="trn-course">' + esc(T(c, "site.hr.trn.addCourse", "Add course")) + '</button></div><div id="hrCourseMsg" aria-live="polite"></div></div>';

    var courseOpts = (d.courses || []).filter(function (k) { return k.active; }).map(function (k) { return '<option value="' + esc(k.id) + '">' + EN(c, esc(k.name)) + "</option>"; }).join("");
    var planned = (d.sessions || []).filter(function (x) { return x.status === "planned"; });
    h += '<div class="card"><h2>' + esc(T(c, "site.hr.trn.sessionsTitle", "Sessions")) + "</h2>" +
      (planned.length ? "<ul>" + planned.map(function (x) {
        var open = s.attendFor === x.id;
        return "<li><b>" + EN(c, esc(courseName(d, x.courseId))) + "</b> " + EN(c, esc(x.date)) + (x.trainer ? ", " + EN(c, esc(x.trainer)) : "") + " (" + esc(T(c, "site.hr.trn.invited", "{n} invited", { n: x.attendees.length })) + ") " +
          '<button class="btn ghost" type="button" data-hr="trn-attend-open" data-id="' + esc(x.id) + '">' + esc(T(c, "site.hr.trn.recordAttendance", "Record attendance")) + '</button> <button class="btn ghost" type="button" data-hr="trn-cancel" data-id="' + esc(x.id) + '">' + esc(T(c, "site.hr.trn.cancelSession", "Cancel session")) + "</button>" +
          (open ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.colStaff", "Staff")) + "</th><th>" + esc(T(c, "site.hr.trn.attended", "Attended")) + "</th><th>" + esc(T(c, "site.hr.trn.completed", "Completed")) + "</th></tr></thead><tbody>" +
            x.attendees.map(function (a, i) { return "<tr><td>" + person(c, staff, a.identity) + '</td><td><input type="checkbox" id="hrAtt_' + i + '"></td><td><input type="checkbox" id="hrCmp_' + i + '"></td></tr>'; }).join("") +
            '</tbody></table></div><button class="btn primary" type="button" data-hr="trn-attend-save" data-id="' + esc(x.id) + '">' + esc(T(c, "site.hr.trn.saveAttendance", "Save attendance")) + "</button>" : "") + "</li>";
      }).join("") + "</ul>" : "<p>" + esc(T(c, "site.hr.trn.noSessions", "No sessions planned.")) + "</p>") +
      "<h3>" + esc(T(c, "site.hr.trn.planTitle", "Plan a session")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.hr.trn.colCourse", "Course")) + '</span><select id="hrSesCourse">' + courseOpts + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.hr.colDate", "Date")) + '</span><input id="hrSesDate" type="date"></label><label class="f"><span>' + esc(T(c, "site.hr.trn.trainer", "Trainer")) + '</span><input id="hrSesTrainer"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.trn.venue", "Venue")) + '</span><input id="hrSesVenue"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.trn.invitees", "Staff to attend")) + '</span><select id="hrSesWho" multiple size="6">' + staffOptions(c, staff) + "</select></label></div>" +
      '<button class="btn" type="button" data-hr="trn-plan">' + esc(T(c, "site.hr.trn.plan", "Plan session")) + '</button><div id="hrSesMsg" aria-live="polite"></div></div>';

    h += '<div class="card"><h2>' + esc(T(c, "site.hr.trn.elsewhereTitle", "Training completed elsewhere")) + '</h2><div class="row">' +
      '<label class="f"><span>' + esc(T(c, "site.hr.colStaff", "Staff")) + '</span><select id="hrTrWho">' + staffOptions(c, staff) + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.hr.trn.colCourse", "Course")) + '</span><select id="hrTrCourse">' + courseOpts + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.hr.trn.completedOn", "Completed on")) + '</span><input id="hrTrDate" type="date"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.hr.trn.evidence", "Where, and the evidence seen")) + '</span><input id="hrTrNote" maxlength="300"></label></div>' +
      '<button class="btn" type="button" data-hr="trn-record">' + esc(T(c, "site.hr.save", "Save")) + '</button><div id="hrTrMsg" aria-live="polite"></div></div>';
    return h;
  }

  function renderTraining(c, body) {
    var s = TRN;
    var draw = function () { body.innerHTML = trainingHtml(c, s); };
    var load = function () { s.data = null; draw(); c.api("/ward/hr-training" + q(c)).then(function (r) { s.data = r && r.ok ? r : (r || false); draw(); }); };
    var after = function (msgId) { return function (r) { if (!r || !r.ok) return say(c, msgId, r); c.toast(T(c, "site.hr.saved", "Saved.")); load(); }; };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-hr]"); if (!b) return;
      var act = b.getAttribute("data-hr"), id = b.getAttribute("data-id"), org = c.state.orgId;
      if (act === "trn-standard") return c.api("/ward/hr-course-save", { orgId: org, standard: true }).then(after("hrCourseMsg"));
      if (act === "trn-course") return c.api("/ward/hr-course-save", { orgId: org, name: val("hrCourseName"), mandatory: !!(document.getElementById("hrCourseMand") || {}).checked, validityMonths: val("hrCourseMonths") }).then(after("hrCourseMsg"));
      if (act === "trn-validity") return c.api("/ward/hr-course-save", { orgId: org, id: id, name: b.getAttribute("data-name"), mandatory: b.getAttribute("data-mandatory") === "1", validityMonths: val("hrV_" + id) }).then(after("hrCourseMsg"));
      if (act === "trn-plan") {
        var sel = document.getElementById("hrSesWho"), who = [];
        if (sel && sel.options) for (var i = 0; i < sel.options.length; i++) if (sel.options[i].selected) who.push(sel.options[i].value);
        return c.api("/ward/hr-session-save", { orgId: org, courseId: val("hrSesCourse"), date: val("hrSesDate"), trainer: val("hrSesTrainer"), venue: val("hrSesVenue"), invitees: who }).then(after("hrSesMsg"));
      }
      if (act === "trn-attend-open") { s.attendFor = s.attendFor === id ? null : id; draw(); return; }
      if (act === "trn-attend-save") {
        var ses = s.data.sessions.filter(function (x) { return x.id === id; })[0];
        var list = ses.attendees.map(function (a, i2) { return { identity: a.identity, attended: !!(document.getElementById("hrAtt_" + i2) || {}).checked, completed: !!(document.getElementById("hrCmp_" + i2) || {}).checked }; });
        return c.api("/ward/hr-session-attendance", { orgId: org, id: id, attendance: list }).then(function (r) { s.attendFor = null; after("hrSesMsg")(r); });
      }
      if (act === "trn-cancel") {
        var why = ""; try { why = prompt(T(c, "site.hr.trn.cancelPrompt", "Why is this session cancelled?")) || ""; } catch (e) {}
        if (!why.trim()) return;
        return c.api("/ward/hr-session-save", { orgId: org, id: id, cancel: true, reason: why.trim() }).then(after("hrSesMsg"));
      }
      if (act === "trn-record") return c.api("/ward/hr-training-record", { orgId: org, identity: val("hrTrWho"), courseId: val("hrTrCourse"), completedOn: val("hrTrDate"), note: val("hrTrNote") }).then(after("hrTrMsg"));
    };
    load();
  }

  /* ---- My HR records (Staff rota page, everyone) ------------------------------------------------------------- */

  function selfHtml(c, r) {
    var esc = c.esc;
    if (r == null) return loading(c);
    if (!r.ok) return failed(c, r);
    if (r.notStaff) return "<p>" + esc(T(c, "site.hr.self.notStaff", "You are not a staff member of this hospital, so there is no attendance or training to show.")) + "</p>";
    var h = "";
    var a = r.attendance;
    var open = a && a.ok ? (a.records || []).filter(function (x) { return !x.clockOut && !x.voided; })[0] : null;
    h += "<h3>" + esc(T(c, "site.hr.self.attendance", "Attendance")) + "</h3>";
    if (!a || !a.ok) h += failed(c, a);
    else {
      h += (open ? "<p>" + esc(T(c, "site.hr.self.clockedInSince", "Clocked in since {time}.", { time: localTime(open.clockIn) })) + ' <button class="btn" type="button" data-hr="self-out">' + esc(T(c, "site.hr.self.clockOut", "Clock out")) + "</button></p>"
        : '<p><button class="btn primary" type="button" data-hr="self-in">' + esc(T(c, "site.hr.self.clockIn", "Clock in")) + "</button></p>") + '<div id="hrSelfMsg" aria-live="polite"></div>';
      h += a.rows.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.hr.colDate", "Date")) + "</th><th>" + esc(T(c, "site.hr.att.colShift", "Shift")) + "</th><th>" + esc(T(c, "site.hr.att.colIn", "Clock in")) + "</th><th>" + esc(T(c, "site.hr.att.colOut", "Clock out")) + "</th><th>" + esc(T(c, "site.hr.colStatus", "Status")) + "</th></tr></thead><tbody>" +
        a.rows.map(function (x) { return "<tr><td>" + EN(c, esc(x.date)) + "</td><td>" + EN(c, esc(x.shift + " " + x.start + "-" + x.end)) + "</td><td>" + esc(localTime(x.clockIn)) + "</td><td>" + esc(localTime(x.clockOut)) + "</td><td>" + esc(statusLabel(c, x.status)) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : "<p>" + esc(T(c, "site.hr.self.noShifts", "No rostered shifts this month.")) + "</p>";
    }
    var cr = r.credentials;
    h += "<h3>" + esc(T(c, "site.hr.self.credentials", "My registrations and certificates")) + "</h3>";
    if (!cr || !cr.ok) h += failed(c, cr);
    else {
      if (cr.alerts.length) h += '<div class="msg note">' + alertsHtml(c, cr.alerts, [], true) + "</div>";
      h += cr.credentials.length ? "<ul>" + cr.credentials.map(function (x) { return "<li>" + EN(c, esc(x.category + ": " + x.name)) + (x.validTo ? " " + esc(T(c, "site.hr.self.until", "until {date}", { date: x.validTo })) : "") + " " + credPill(c, x) + "</li>"; }).join("") + "</ul>"
        : "<p>" + esc(T(c, "site.hr.self.noCredentials", "HR has not recorded any registration or certificate for you.")) + "</p>";
    }
    var t = r.training;
    h += "<h3>" + esc(T(c, "site.hr.self.training", "My mandatory training")) + "</h3>";
    if (!t || !t.ok) h += failed(c, t);
    else if (!t.mine || !t.mine.courses.length) h += "<p>" + esc(T(c, "site.hr.trn.noMandatory", "No mandatory course is set up yet.")) + "</p>";
    else {
      var cn = function (id) { var k = t.courses.filter(function (x) { return x.id === id; })[0]; return k ? k.name : id; };
      var st = function (x) { return x === "valid" ? T(c, "site.hr.cred.valid", "Valid") : x === "expired" ? T(c, "site.hr.cred.expired", "Expired") : T(c, "site.hr.self.missing", "Not done"); };
      h += "<ul>" + t.mine.courses.map(function (x) { return "<li>" + EN(c, esc(cn(x.courseId))) + ": " + esc(st(x.state)) + (x.validUntil ? " " + esc(T(c, "site.hr.self.until", "until {date}", { date: x.validUntil })) : "") + "</li>"; }).join("") + "</ul>";
      if (t.sessions.length) h += "<p>" + esc(T(c, "site.hr.self.upcoming", "Sessions you are booked on:")) + " " + t.sessions.map(function (x) { return EN(c, esc(cn(x.courseId) + " " + x.date)); }).join(", ") + "</p>";
    }
    return h;
  }

  /** Draws the card into el and wires its buttons. */
  function selfCard(c, el) {
    var load = function () {
      el.innerHTML = selfHtml(c, null);
      c.api("/ward/hr-my-records" + q(c)).then(function (r) { el.innerHTML = selfHtml(c, r || { ok: false }); });
    };
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-hr]"); if (!b) return;
      var act = b.getAttribute("data-hr");
      if (act === "self-in" || act === "self-out") {
        b.disabled = true;
        return c.api("/ward/hr-clock", { orgId: c.state.orgId, action: act === "self-in" ? "in" : "out" }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; return say(c, "hrSelfMsg", r); }
          c.toast(act === "self-in" ? (r.note ? T(c, "site.hr.self.inNoShift", "Clocked in. No rota shift of yours is due now, so it is not linked to a shift.") : T(c, "site.hr.self.inOk", "Clocked in.")) : T(c, "site.hr.self.outOk", "Clocked out."));
          load();
        });
      }
      if (act === "self-ack") return c.api("/ward/hr-alert-ack", { orgId: c.state.orgId, id: b.getAttribute("data-id") }).then(function (r) { if (r && r.ok) load(); else c.toast(refusal(c, r)); });
    };
    load();
  }

  WSQ._hr = { attendance: renderAttendance, credentials: renderCredentials, training: renderTraining, selfCard: selfCard, selfHtml: selfHtml, attendanceHtml: attendanceHtml, trainingHtml: trainingHtml, credentialsHtml: credentialsHtml };
})();
