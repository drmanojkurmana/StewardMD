/* wardsynq/site/pages/governance.js - "Privacy and compliance". Buildless ES5.
 *
 *   Data requests, Breaches, Privacy notices   the Data Protection Officer's work under the DPDP Act 2023
 *                                              (dpdp.manage; functions/_wardsynq/dpdp.js)
 *   NABH indicators, HMIS monthly              returns computed from the record (analytics.view; compliance.js)
 *   Digital health self-assessment             the hospital's own NABH DHS checklist (staff.admin; compliance.js)
 *   Report builder                             saved reports over named datasets (staff.admin; report-builder.js)
 *
 * The server decides every permission; a tab is only offered to a role that could use it. Every list is null while
 * loading and false when it failed, so a list that could not be read never looks empty. Text a person wrote (a
 * request, a notice, a breach description) and every server value is shown as written, never translated.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function q(c) { return "?orgId=" + encodeURIComponent(c.state.orgId); }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function dt(iso) { var t = Date.parse(iso || ""); return isFinite(t) ? new Date(t).toLocaleString() : ""; }
  function why(c, r) { return (r && (r.detail || r.message || r.error)) || T(c, "site.gov.noAnswer", "no answer from the server"); }
  function failHtml(c, lead, r) { return '<div class="msg err">' + c.esc(lead) + " " + EN(c, c.esc(why(c, r))) + "</div>"; }
  function loading(c, text) { return '<p><span class="spin"></span> ' + c.esc(text) + "</p>"; }
  function on(id, fn) { var b = document.getElementById(id); if (b) b.onclick = fn; }
  function onAll(root, attr, fn) { root.querySelectorAll("[" + attr + "]").forEach(function (b) { b.onclick = function () { fn(b); }; }); }
  function isoFromLocal(v) { var t = Date.parse(v || ""); return isFinite(t) ? new Date(t).toISOString() : ""; }

  function tabLabel(c, t) {
    return {
      requests: T(c, "site.gov.tab.requests", "Data requests"), breaches: T(c, "site.gov.tab.breaches", "Breaches"),
      notices: T(c, "site.gov.tab.notices", "Privacy notices"), nabh: T(c, "site.gov.tab.nabh", "NABH indicators"),
      hmis: T(c, "site.gov.tab.hmis", "HMIS monthly"), dhs: T(c, "site.gov.tab.dhs", "Digital health self-assessment"),
      reports: T(c, "site.gov.tab.reports", "Report builder")
    }[t];
  }
  function kindLabel(c, k) {
    return {
      access: T(c, "site.gov.kind.access", "Access to their data (s11)"), correction: T(c, "site.gov.kind.correction", "Correction (s12)"),
      erasure: T(c, "site.gov.kind.erasure", "Erasure (s12)"), grievance: T(c, "site.gov.kind.grievance", "Grievance (s13)"),
      nomination: T(c, "site.gov.kind.nomination", "Nomination (s14)")
    }[k] || k;
  }
  function stateLabel(c, s) {
    return {
      received: T(c, "site.gov.state.received", "Received"), "in-progress": T(c, "site.gov.state.inProgress", "In progress"),
      completed: T(c, "site.gov.state.completed", "Completed"), rejected: T(c, "site.gov.state.rejected", "Rejected"),
      open: T(c, "site.gov.state.open", "Open"), closed: T(c, "site.gov.state.closed", "Closed")
    }[s] || s;
  }
  function viaLabel(c, v) {
    return {
      "in-person": T(c, "site.gov.via.inPerson", "In person"), email: T(c, "site.gov.via.email", "Email"), letter: T(c, "site.gov.via.letter", "Letter"),
      phone: T(c, "site.gov.via.phone", "Phone"), portal: T(c, "site.gov.via.portal", "Patient portal")
    }[v] || v;
  }
  var KINDS = ["access", "correction", "erasure", "grievance", "nomination"];
  var VIAS = ["in-person", "email", "letter", "phone"];
  var LANGS = ["en", "hi", "te", "ta", "kn", "ml", "mr", "bn"];
  function opts(list, label, cur) { return list.map(function (x) { return '<option value="' + x + '"' + (x === cur ? " selected" : "") + ">" + label(x) + "</option>"; }).join(""); }

  WSQ.page("governance", { render: function (c) {
    var el = c.el, st = c.state, esc = c.esc;
    var g = st._gov || (st._gov = {});
    var head = '<div class="title"><h1>' + esc(T(c, "site.gov.title", "Privacy and compliance")) + '</h1><span class="sub">' + EN(c, esc((st.org && st.org.name) || "")) + "</span></div>";
    if (!c.isWardsynq()) { el.innerHTML = head + '<div class="msg note">' + esc(T(c, "site.gov.notWardsynq", "These records are kept for a WardSynQ hospital only.")) + "</div>"; return; }
    var tabs = [];
    if (c.can("dpdp.manage")) tabs.push("requests", "breaches", "notices");
    if (c.can("analytics.view")) tabs.push("nabh", "hmis");
    if (c.can("staff.admin")) tabs.push("dhs", "reports");
    if (!tabs.length) { el.innerHTML = head + '<div class="msg note">' + esc(T(c, "site.gov.noAccess", "Your role ({role}) includes none of dpdp.manage, analytics.view or staff.admin, which these pages need.", { role: st.who && st.who.role })) + "</div>"; return; }
    if (tabs.indexOf(g.tab) < 0) g.tab = tabs[0];
    el.innerHTML = head + '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-gtab="' + t + '" aria-selected="' + (t === g.tab) + '">' + esc(tabLabel(c, t)) + "</button>";
    }).join("") + '</div><div id="govBody"></div>';
    onAll(el, "data-gtab", function (b) { g.tab = b.getAttribute("data-gtab"); WSQ.render("governance"); });
    var body = document.getElementById("govBody");
    ({ requests: requestsTab, breaches: breachesTab, notices: noticesTab, nabh: nabhTab, hmis: hmisTab, dhs: dhsTab, reports: reportsTab })[g.tab](c, body, g);
  } });

  /* ---------------------------------------------------------------- data principal requests */
  function clocksHtml(c, k) {
    var esc = c.esc, d = (k && k.responseDays) || {};
    var n = function (v) { return v == null ? esc(T(c, "site.gov.clocks.notSet", "not set")) : esc(T(c, "site.gov.clocks.days", "{n} days", { n: v })); };
    var h = function (v) { return v == null ? esc(T(c, "site.gov.clocks.notSet", "not set")) : esc(T(c, "site.gov.clocks.hours", "{n} hours", { n: v })); };
    var out = '<div class="card"><h2>' + esc(T(c, "site.gov.clocks.title", "Answer times")) + "</h2>" +
      '<div class="msg warn">' + TS(c, "site.gov.clocks.notConfirmed", "These are the hospital's own times. The DPDP Rules 2025 times were not confirmed when this was built: check them before relying on these. With no time set, no due date is shown.") + "</div>" +
      '<div class="kv">' + KINDS.map(function (x) { return "<dt>" + esc(kindLabel(c, x)) + "</dt><dd>" + n(d[x]) + "</dd>"; }).join("") +
      "<dt>" + esc(T(c, "site.gov.clocks.board", "Breach: tell the Data Protection Board within")) + "</dt><dd>" + h(k && k.breachBoardHours) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.clocks.principals", "Breach: tell each affected patient within")) + "</dt><dd>" + h(k && k.breachPrincipalHours) + "</dd></div>";
    if (c.can("staff.admin")) {
      out += '<div class="row">' + KINDS.map(function (x) {
        return '<label class="f"><span>' + esc(kindLabel(c, x)) + '</span><input id="gClk_' + x + '" type="number" min="1" max="365" value="' + esc(d[x] == null ? "" : d[x]) + '"></label>';
      }).join("") +
        '<label class="f"><span>' + esc(T(c, "site.gov.clocks.boardHours", "Board, hours")) + '</span><input id="gClkBoard" type="number" min="1" max="720" value="' + esc(k && k.breachBoardHours != null ? k.breachBoardHours : "") + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.clocks.principalHours", "Patients, hours")) + '</span><input id="gClkPrin" type="number" min="1" max="720" value="' + esc(k && k.breachPrincipalHours != null ? k.breachPrincipalHours : "") + '"></label>' +
        '<button class="btn" type="button" id="gClkSave">' + esc(T(c, "site.gov.clocks.save", "Save answer times")) + "</button></div>";
    }
    return out + '<div id="gClkMsg"></div></div>';
  }

  function erasureHtml(c, e) {
    if (!e) return "";
    var esc = c.esc, list = function (xs) { return xs && xs.length ? EN(c, esc(xs.join(", "))) : esc(T(c, "site.gov.erasure.none", "none")); };
    return '<div class="kv">' +
      "<dt>" + esc(T(c, "site.gov.erasure.consents", "Consents withdrawn")) + "</dt><dd>" + list(e.consentsWithdrawn) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.removed", "Removed from the current record")) + "</dt><dd>" + list(e.removedFromCurrentRecord) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.registration", "Removed from the registration details")) + "</dt><dd>" + list(e.registrationDetailsRemoved) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.kept", "Kept")) + "</dt><dd>" + esc(T(c, "site.gov.erasure.keptWhy", "The clinical record. Medical records must be kept for as long as the law requires; the Act allows this (s8(7), s12(3)).")) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.history", "Record history")) + "</dt><dd>" + esc(T(c, "site.gov.erasure.historyWhy", "Values removed from the current record stay in its version history, which cannot be edited. They are not erased.")) + "</dd>" +
      (e.failures && e.failures.length ? "<dt>" + esc(T(c, "site.gov.erasure.notDone", "Not done")) + '</dt><dd class="err">' + EN(c, esc(e.failures.map(function (f) { return f.step + (f.detail ? ": " + f.detail : ""); }).join("; "))) + "</dd>" : "") +
      "</div>";
  }

  function requestHtml(c, r, s) {
    var esc = c.esc, open = r.state === "received" || r.state === "in-progress";
    var due = r.dueBy ? esc(T(c, "site.gov.req.due", "Answer due {when}", { when: dt(r.dueBy) })) : esc(T(c, "site.gov.req.noClock", "No answer time set"));
    var h = '<div class="card"><h3>' + esc(kindLabel(c, r.kind)) + ' <span class="pill' + (r.overdue ? " stop" : open ? " warn" : " ok") + '">' + esc(stateLabel(c, r.state)) + "</span>" +
      (r.overdue ? ' <span class="pill stop">' + esc(T(c, "site.gov.req.overdue", "Overdue")) + "</span>" : "") + "</h3>" +
      '<p class="quiet">' + esc(T(c, "site.gov.req.received", "Received {when} by {via}", { when: dt(r.receivedAt), via: viaLabel(c, r.receivedVia) })) + " &middot; " + due + "</p>" +
      "<p>" + EN(c, esc(r.detail)) + "</p>" +
      (r.nominee ? "<p>" + esc(T(c, "site.gov.req.nominee", "Nominee")) + ": " + EN(c, esc(r.nominee.name + ", " + r.nominee.relationship + (r.nominee.contact ? ", " + r.nominee.contact : ""))) + "</p>" : "") +
      (r.response ? "<p><b>" + esc(T(c, "site.gov.req.answer", "Answer given")) + ":</b> " + EN(c, esc(r.response)) + "</p>" : "") +
      erasureHtml(c, r.erasure || r.erasureAttempt) +
      '<div id="gHold_' + esc(r.id) + '"></div><div class="row">' +
      '<button class="btn quiet" type="button" data-ghold="' + esc(r.id) + '" data-pid="' + esc(r.patientId) + '">' + esc(T(c, "site.gov.req.holdings", "What we hold")) + "</button>";
    if (open) {
      if (r.state === "received") h += '<button class="btn quiet" type="button" data-gact="start" data-id="' + esc(r.id) + '">' + esc(T(c, "site.gov.req.start", "Start work")) + "</button>";
      h += '</div><label class="f"><span>' + esc(T(c, "site.gov.req.answerLabel", "The answer given to the patient")) + '</span><textarea rows="3" id="gResp_' + esc(r.id) + '"></textarea></label><div class="row">' +
        '<button class="btn" type="button" data-gact="complete" data-kind="' + esc(r.kind) + '" data-id="' + esc(r.id) + '">' + esc(r.kind === "erasure" ? T(c, "site.gov.req.erase", "Erase and complete") : T(c, "site.gov.req.complete", "Complete")) + "</button>" +
        '<button class="btn quiet" type="button" data-gact="reject" data-id="' + esc(r.id) + '">' + esc(T(c, "site.gov.req.reject", "Reject")) + "</button>";
    }
    return h + "</div></div>";
  }

  function requestsTab(c, body, g) {
    var s = g.req || (g.req = { data: null });
    var esc = c.esc;
    function paint() {
      var h = "";
      if (s.data === null) h = loading(c, T(c, "site.gov.req.loading", "Loading data requests..."));
      else if (s.data === false) h = failHtml(c, T(c, "site.gov.req.loadFailed", "Data requests could not be loaded. This is not the same as there being none:"), s.fail);
      else {
        h = clocksHtml(c, s.data.clocks) +
          '<div class="card"><h2>' + esc(T(c, "site.gov.req.fileTitle", "Record a request")) + '</h2><div class="row">' +
          '<label class="f"><span>' + esc(T(c, "site.gov.req.mrn", "MR number")) + '</span><input id="gReqMrn" autocapitalize="characters" spellcheck="false"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.gov.req.kind", "Request")) + '</span><select id="gReqKind">' + opts(KINDS, function (x) { return esc(kindLabel(c, x)); }) + "</select></label>" +
          '<label class="f"><span>' + esc(T(c, "site.gov.req.via", "Received by")) + '</span><select id="gReqVia">' + opts(VIAS, function (x) { return esc(viaLabel(c, x)); }) + "</select></label></div>" +
          '<label class="f"><span>' + esc(T(c, "site.gov.req.detail", "What the patient asked for")) + '</span><textarea id="gReqDetail" rows="3"></textarea></label>' +
          '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.req.nomName", "Nominee name (nomination only)")) + '</span><input id="gReqNomName"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.gov.req.nomRel", "Relationship")) + '</span><input id="gReqNomRel"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.gov.req.nomContact", "Nominee contact")) + '</span><input id="gReqNomContact"></label>' +
          '<button class="btn" type="button" id="gReqFile">' + esc(T(c, "site.gov.req.file", "Record request")) + '</button></div><div id="gReqMsg"></div></div>' +
          (s.data.truncated ? '<div class="msg note">' + esc(T(c, "site.gov.truncated", "Only the most recent records were read; older ones may be missing.")) + "</div>" : "") +
          (s.data.requests.length ? s.data.requests.map(function (r) { return requestHtml(c, r, s); }).join("") : '<p class="quiet">' + esc(T(c, "site.gov.req.none", "No data requests have been recorded.")) + "</p>");
      }
      body.innerHTML = h;
      if (!s.data) return;
      on("gClkSave", function () {
        var num = function (id) { var v = val(id); return v === "" ? null : Number(v); };
        var days = {}; KINDS.forEach(function (x) { days[x] = num("gClk_" + x); });
        c.api("/org/update", { orgId: c.state.orgId, wardsynq: { dpdp: { responseDays: days, breachBoardHours: num("gClkBoard"), breachPrincipalHours: num("gClkPrin") } } }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gClkMsg").innerHTML = failHtml(c, T(c, "site.gov.clocks.notSaved", "Answer times not saved:"), r); return; }
          c.toast(T(c, "site.gov.clocks.saved", "Answer times saved.")); load();
        });
      });
      on("gReqFile", function () {
        var kind = val("gReqKind");
        var b = { orgId: c.state.orgId, mrn: val("gReqMrn"), kind: kind, receivedVia: val("gReqVia"), detail: val("gReqDetail") };
        if (kind === "nomination") b.nominee = { name: val("gReqNomName"), relationship: val("gReqNomRel"), contact: val("gReqNomContact") };
        if (!b.mrn) { document.getElementById("gReqMsg").innerHTML = '<div class="msg err">' + esc(T(c, "site.gov.req.mrnFirst", "Enter the patient's MR number.")) + "</div>"; return; }
        c.api("/ward/data-request", b).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gReqMsg").innerHTML = failHtml(c, T(c, "site.gov.req.notFiled", "Request not recorded:"), r); return; }
          c.toast(T(c, "site.gov.req.filed", "Request recorded.")); load();
        });
      });
      onAll(body, "data-gact", function (b) {
        var id = b.getAttribute("data-id"), action = b.getAttribute("data-gact");
        if (action === "complete" && b.getAttribute("data-kind") === "erasure" && !confirm(T(c, "site.gov.req.eraseConfirm", "This withdraws the patient's consents other than for treatment, removes their ABHA link and optional registration details, and keeps the clinical record. Continue?"))) return;
        b.disabled = true;
        c.api("/ward/data-request-act", { orgId: c.state.orgId, requestId: id, action: action, response: val("gResp_" + id) }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) {
            // A partial erasure is written on the request and is shown by reloading it; the toast says it did not finish.
            c.toast(r && r.error === "erasure_partial" ? T(c, "site.gov.req.partial", "The erasure did not finish. The request stays open and shows what was and was not done.") : T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, r) }));
            if (r && r.error === "erasure_partial") load();
            return;
          }
          c.toast(T(c, "site.gov.req.saved", "Saved.")); load();
        });
      });
      onAll(body, "data-ghold", function (b) {
        var id = b.getAttribute("data-ghold"), pid = b.getAttribute("data-pid"), box = document.getElementById("gHold_" + id);
        box.innerHTML = loading(c, T(c, "site.gov.hold.loading", "Reading what the hospital holds..."));
        var pq = q(c) + "&patientId=" + encodeURIComponent(pid);
        Promise.all([c.api("/ward/data-holdings" + pq), c.api("/ward/privacy-acknowledgements" + pq)]).then(function (res) {
          var h = res[0], a = res[1], out = "";
          out += h && h.ok ? '<div class="kv">' + (h.holdings.length ? h.holdings.map(function (x) { return "<dt>" + EN(c, esc(x.type)) + "</dt><dd>" + esc(x.count) + "</dd>"; }).join("") : "<dt></dt><dd>" + esc(T(c, "site.gov.hold.none", "No records for this patient.")) + "</dd>") + "</div>"
            : failHtml(c, T(c, "site.gov.hold.failed", "What the hospital holds could not be read:"), h);
          out += a && a.ok ? "<p>" + (a.acknowledgements.length ? esc(T(c, "site.gov.hold.acked", "Privacy notice acknowledged: {list}", { list: a.acknowledgements.map(function (x) { return x.language + " v" + x.noticeVersion + " " + dt(x.acknowledgedAt); }).join("; ") })) : esc(T(c, "site.gov.hold.notAcked", "No privacy notice acknowledgement is recorded."))) + "</p>"
            : failHtml(c, T(c, "site.gov.hold.ackFailed", "Acknowledgements could not be read:"), a);
          box.innerHTML = out;
        });
      });
    }
    function load() {
      s.data = null; paint();
      c.api("/ward/data-requests" + q(c)).then(function (r) { if (r && r.ok) s.data = r; else { s.data = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- breaches */
  function breachHtml(c, b) {
    var esc = c.esc, open = b.state !== "closed";
    var clock = function (label, due, doneAt, late) {
      return "<dt>" + esc(label) + "</dt><dd>" + (doneAt ? esc(T(c, "site.gov.br.toldAt", "Told {when}", { when: dt(doneAt) })) : esc(T(c, "site.gov.br.notYet", "Not yet"))) +
        (due ? " &middot; " + esc(T(c, "site.gov.br.dueBy", "due by {when}", { when: dt(due) })) : " &middot; " + esc(T(c, "site.gov.br.noClock", "no time set"))) +
        (late ? ' <span class="pill stop">' + esc(T(c, "site.gov.br.late", "Late")) + "</span>" : "") + "</dd>";
    };
    var h = '<div class="card"><h3>' + esc(T(c, "site.gov.br.detected", "Found {when}", { when: dt(b.detectedAt) })) + ' <span class="pill' + (open ? " warn" : " ok") + '">' + esc(stateLabel(c, b.state)) + "</span></h3>" +
      "<p>" + EN(c, esc(b.description)) + "</p>" +
      '<div class="kv">' +
      (b.affectedCount != null ? "<dt>" + esc(T(c, "site.gov.br.affected", "People affected")) + "</dt><dd>" + esc(b.affectedCount) + "</dd>" : "") +
      (b.dataCategories && b.dataCategories.length ? "<dt>" + esc(T(c, "site.gov.br.categories", "Data involved")) + "</dt><dd>" + EN(c, esc(b.dataCategories.join(", "))) + "</dd>" : "") +
      clock(T(c, "site.gov.br.board", "Data Protection Board"), b.boardDueBy, b.boardNotifiedAt, b.boardLate) +
      clock(T(c, "site.gov.br.principals", "Affected patients"), b.principalsDueBy, b.principalsNotifiedAt, b.principalsLate) +
      "<dt>" + esc(T(c, "site.gov.br.assessment", "Assessment")) + "</dt><dd>" + (b.assessment ? EN(c, esc(b.assessment.text)) : esc(T(c, "site.gov.br.notAssessed", "Not assessed yet"))) + "</dd>" +
      ((b.actions || []).length ? "<dt>" + esc(T(c, "site.gov.br.actions", "Actions")) + "</dt><dd>" + b.actions.map(function (a) { return EN(c, esc(dt(a.at) + ": " + a.text)); }).join("<br>") + "</dd>" : "") +
      "</div>";
    if (open) {
      var id = esc(b.id);
      h += '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.br.event", "Record")) + '</span><select id="gBrEv_' + id + '">' +
        '<option value="assess">' + esc(T(c, "site.gov.br.ev.assess", "Assessment")) + "</option>" +
        '<option value="board-notified">' + esc(T(c, "site.gov.br.ev.board", "The Board was told")) + "</option>" +
        '<option value="principals-notified">' + esc(T(c, "site.gov.br.ev.principals", "Affected patients were told")) + "</option>" +
        '<option value="action">' + esc(T(c, "site.gov.br.ev.action", "An action taken")) + "</option>" +
        '<option value="close">' + esc(T(c, "site.gov.br.ev.close", "Close the breach")) + "</option></select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.when", "When it happened (for a notification)")) + '</span><input type="datetime-local" id="gBrAt_' + id + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.count", "Patients told")) + '</span><input type="number" min="0" id="gBrN_' + id + '"></label></div>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.text", "Details: the assessment, the Board reference, how patients were told, the action, or why it is closed")) + '</span><textarea rows="3" id="gBrT_' + id + '"></textarea></label>' +
        '<button class="btn" type="button" data-gbr="' + id + '">' + esc(T(c, "site.gov.br.save", "Save")) + "</button>";
    }
    return h + "</div>";
  }

  function breachesTab(c, body, g) {
    var s = g.br || (g.br = { data: null });
    var esc = c.esc;
    function paint() {
      if (s.data === null) { body.innerHTML = loading(c, T(c, "site.gov.br.loading", "Loading the breach register...")); return; }
      if (s.data === false) { body.innerHTML = failHtml(c, T(c, "site.gov.br.loadFailed", "The breach register could not be loaded. This is not the same as there being no breaches:"), s.fail); return; }
      body.innerHTML = '<div class="card"><h2>' + esc(T(c, "site.gov.br.recordTitle", "Record a personal data breach")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.br.law", "The Act requires the Data Protection Board and each affected person to be told (s8(6)). The times below are the hospital's own; the Rules were not confirmed when this was built.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.br.foundAt", "Found at")) + '</span><input type="datetime-local" id="gBrFound"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.affected", "People affected")) + '</span><input type="number" min="0" id="gBrCount"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.categoriesInput", "Data involved, separated by commas")) + '</span><input id="gBrCats"></label></div>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.what", "What happened")) + '</span><textarea rows="3" id="gBrDesc"></textarea></label>' +
        '<button class="btn" type="button" id="gBrRecord">' + esc(T(c, "site.gov.br.record", "Record breach")) + '</button><div id="gBrMsg"></div></div>' +
        (s.data.breaches.length ? s.data.breaches.map(function (b) { return breachHtml(c, b); }).join("") : '<p class="quiet">' + esc(T(c, "site.gov.br.none", "No breaches have been recorded.")) + "</p>");
      on("gBrRecord", function () {
        var cats = val("gBrCats").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
        c.api("/ward/data-breach", { orgId: c.state.orgId, detectedAt: isoFromLocal(val("gBrFound")), affectedCount: val("gBrCount"), dataCategories: cats, description: val("gBrDesc") }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gBrMsg").innerHTML = failHtml(c, T(c, "site.gov.br.notRecorded", "Breach not recorded:"), r); return; }
          c.toast(T(c, "site.gov.br.recorded", "Breach recorded.")); load();
        });
      });
      onAll(body, "data-gbr", function (b) {
        var id = b.getAttribute("data-gbr"), ev = val("gBrEv_" + id), text = val("gBrT_" + id);
        var p = { orgId: c.state.orgId, breachId: id, event: ev, at: isoFromLocal(val("gBrAt_" + id)), count: val("gBrN_" + id) === "" ? null : Number(val("gBrN_" + id)) };
        if (ev === "assess") p.assessment = text; else if (ev === "board-notified") p.reference = text; else if (ev === "principals-notified") p.method = text; else if (ev === "action") p.text = text; else p.summary = text;
        b.disabled = true;
        c.api("/ward/data-breach-update", p).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { c.toast(T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, r) })); return; }
          c.toast(T(c, "site.gov.req.saved", "Saved.")); load();
        });
      });
    }
    function load() {
      s.data = null; paint();
      c.api("/ward/data-requests" + q(c)).then(function (r) { if (r && r.ok) s.data = r; else { s.data = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- privacy notices */
  function noticesTab(c, body, g) {
    var s = g.nt || (g.nt = { list: null });
    var esc = c.esc;
    function paint() {
      if (s.list === null) { body.innerHTML = loading(c, T(c, "site.gov.nt.loading", "Loading privacy notices...")); return; }
      if (s.list === false) { body.innerHTML = failHtml(c, T(c, "site.gov.nt.loadFailed", "Privacy notices could not be loaded:"), s.fail); return; }
      body.innerHTML = '<div class="card"><h2>' + esc(T(c, "site.gov.nt.publishTitle", "Write or update a notice")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.nt.s5", "A notice must say what personal data is collected and why, how consent can be withdrawn (as easily as it was given), how to raise a grievance with the hospital, and how to complain to the Data Protection Board (s5). Write it in English or a language of the Eighth Schedule. Publishing again makes a new version; patients acknowledge a version.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.nt.language", "Language")) + '</span><select id="gNtLang">' + opts(LANGS, function (x) { return EN(c, esc(x)); }, s.lang) + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.gov.nt.titleLabel", "Title")) + '</span><input id="gNtTitle"></label></div>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.nt.text", "Notice text")) + '</span><textarea rows="10" id="gNtText"></textarea></label>' +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.nt.dpo", "Data Protection Officer contact (published, s8(9))")) + '</span><input id="gNtDpo"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.nt.grievance", "Grievance contact")) + '</span><input id="gNtGriev"></label>' +
        '<button class="btn" type="button" id="gNtPublish">' + esc(T(c, "site.gov.nt.publish", "Publish")) + '</button></div><div id="gNtMsg"></div></div>' +
        (s.list.length ? s.list.map(function (n) {
          return '<div class="card"><h3>' + EN(c, esc(n.language + " v" + n.version + (n.title ? ": " + n.title : ""))) + "</h3>" +
            '<p class="quiet">' + esc(T(c, "site.gov.nt.published", "Published {when}", { when: dt(n.publishedAt) })) + " &middot; " + EN(c, esc(n.dpoContact)) + "</p>" +
            '<p style="white-space:pre-wrap">' + EN(c, esc(n.text)) + "</p>" +
            '<button class="btn quiet" type="button" data-gedit="' + esc(n.language) + '">' + esc(T(c, "site.gov.nt.edit", "Edit this notice")) + "</button></div>";
        }).join("") : '<p class="quiet">' + esc(T(c, "site.gov.nt.none", "No privacy notice is published. Patients cannot be given one until it is.")) + "</p>");
      onAll(body, "data-gedit", function (b) {
        var n = s.list.filter(function (x) { return x.language === b.getAttribute("data-gedit"); })[0]; if (!n) return;
        document.getElementById("gNtLang").value = n.language; document.getElementById("gNtTitle").value = n.title || "";
        document.getElementById("gNtText").value = n.text; document.getElementById("gNtDpo").value = n.dpoContact; document.getElementById("gNtGriev").value = n.grievanceContact || "";
      });
      on("gNtPublish", function () {
        c.api("/ward/privacy-notice", { orgId: c.state.orgId, language: val("gNtLang"), title: val("gNtTitle"), text: val("gNtText"), dpoContact: val("gNtDpo"), grievanceContact: val("gNtGriev") }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gNtMsg").innerHTML = failHtml(c, T(c, "site.gov.nt.notPublished", "Notice not published:"), r); return; }
          c.toast(T(c, "site.gov.nt.done", "Notice published as version {v}.", { v: r.notice.version })); load();
        });
      });
    }
    function load() {
      s.list = null; paint();
      c.api("/ward/privacy-notices" + q(c)).then(function (r) { if (r && r.ok) s.list = r.notices; else { s.list = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- NABH indicators */
  function nabhTab(c, body, g) {
    var s = g.nabh || (g.nabh = { months: "6", data: null });
    var esc = c.esc;
    function paint() {
      var h = '<div class="card"><h2>' + esc(T(c, "site.gov.nabh.title", "NABH key performance indicators")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.nabh.format", "NABH publishes no monthly submission format for these indicators. This is a monthly table of the 32 indicators of the 6th edition (PSQ 3a to 3d), with each value's numerator and denominator where WardSynQ can compute it.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.nabh.months", "Months")) + '</span><select id="gNabhMonths">' + opts(["3", "6", "12"], function (x) { return esc(x); }, s.months) + "</select></label>" +
        '<button class="btn quiet" type="button" id="gNabhCsv">' + esc(T(c, "site.gov.csv", "Download CSV")) + "</button></div></div>";
      if (s.data === null) h += loading(c, T(c, "site.gov.nabh.loading", "Computing the indicators..."));
      else if (s.data === false) h += failHtml(c, T(c, "site.gov.nabh.failed", "The indicators could not be computed:"), s.fail);
      else {
        var d = s.data;
        h += '<p>' + esc(T(c, "site.gov.nabh.counts", "{a} of 32 computable from WardSynQ data; {b} need data WardSynQ does not hold.", { a: d.computable, b: d.notComputable })) + "</p>" +
          (d.truncated ? '<div class="msg note">' + esc(T(c, "site.gov.truncated", "Only the most recent records were read; older ones may be missing.")) + "</div>" : "") +
          '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.gov.nabh.no", "No.")) + "</th><th>" + esc(T(c, "site.gov.nabh.indicator", "Indicator")) + "</th>" +
          d.months.map(function (m) { return "<th>" + EN(c, esc(m)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          d.indicators.map(function (i) {
            var title = "<td><b>" + EN(c, esc(i.title)) + "</b><br><span class=\"quiet\">" + EN(c, esc(i.standard + " · " + i.unit + " · " + i.numerator + " / " + i.denominator)) + "</span>" +
              (i.computable ? '<br><span class="quiet">' + EN(c, esc([i.dataSource, i.note].filter(Boolean).join(" "))) + "</span>" : "") + "</td>";
            if (!i.computable) return "<tr><td>" + esc(i.no) + "</td>" + title + '<td colspan="' + d.months.length + '"><span class="pill">' + esc(T(c, "site.gov.nabh.notComputable", "Not computable from WardSynQ data")) + "</span> " + EN(c, esc(i.reason)) + "</td></tr>";
            return "<tr><td>" + esc(i.no) + "</td>" + title + i.months.map(function (m) {
              return "<td>" + (m.value == null ? '<span class="quiet">' + esc(T(c, "site.gov.nabh.noCases", "no cases")) + "</span>" : "<b>" + esc(m.value) + "</b>") + '<br><span class="quiet">' + esc(m.numerator == null ? "" : m.numerator) + " / " + esc(m.denominator == null ? "" : m.denominator) + "</span></td>";
            }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>";
      }
      body.innerHTML = h;
      document.getElementById("gNabhMonths").onchange = function () { s.months = val("gNabhMonths"); load(); };
      on("gNabhCsv", function () {
        c.download("/ward/nabh-indicators" + q(c) + "&months=" + encodeURIComponent(s.months) + "&format=csv", "nabh-indicators.csv").then(function (x) {
          if (!x || !x.ok) c.toast(T(c, "site.gov.csvFailed", "Download refused: {why}", { why: (x && x.message) || T(c, "site.gov.noAnswer", "no answer from the server") }));
        });
      });
    }
    function load() {
      s.data = null; paint();
      c.api("/ward/nabh-indicators" + q(c) + "&months=" + encodeURIComponent(s.months)).then(function (r) { if (r && r.ok) s.data = r; else { s.data = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- HMIS monthly */
  function hmisTab(c, body, g) {
    var now = new Date();
    var s = g.hmis || (g.hmis = { month: now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2), data: null });
    var esc = c.esc;
    function paint() {
      var h = '<div class="card"><h2>' + esc(T(c, "site.gov.hmis.title", "HMIS monthly return")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.hmis.intro", "The Government of India HMIS monthly format for a private secondary care facility. Items WardSynQ's record supports are filled from it; every other item is marked and must be filled from the hospital's own registers before the return is submitted.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.hmis.month", "Month")) + '</span><input type="month" id="gHmisMonth" value="' + esc(s.month) + '"></label>' +
        '<button class="btn quiet" type="button" id="gHmisCsv">' + esc(T(c, "site.gov.csv", "Download CSV")) + "</button></div></div>";
      if (s.data === null) h += loading(c, T(c, "site.gov.hmis.loading", "Filling the return..."));
      else if (s.data === false) h += failHtml(c, T(c, "site.gov.hmis.failed", "The return could not be filled:"), s.fail);
      else {
        var d = s.data, sec = {};
        (d.sections || []).forEach(function (x) { sec[x.code] = x.title; });
        var last = "";
        h += "<p>" + esc(T(c, "site.gov.hmis.counts", "{a} items filled from WardSynQ; {b} not available from WardSynQ data.", { a: d.filled, b: d.notAvailable })) + "</p>" +
          (d.truncated ? '<div class="msg note">' + esc(T(c, "site.gov.truncated", "Only the most recent records were read; older ones may be missing.")) + "</div>" : "") +
          '<div class="tbl"><table><tbody>' + d.items.map(function (i) {
            var row = "";
            if (i.section !== last) { last = i.section; row += '<tr><th colspan="3">' + EN(c, esc(i.section + " " + (sec[i.section] || ""))) + "</th></tr>"; }
            return row + "<tr><td>" + EN(c, esc(i.code)) + "</td><td>" + EN(c, esc(i.label)) + "</td><td>" +
              (i.available === true ? "<b>" + esc(i.value) + '</b><br><span class="quiet">' + EN(c, esc([i.source, i.note].filter(Boolean).join(" "))) + "</span>"
                : i.available === false ? '<span class="pill">' + esc(T(c, "site.gov.hmis.notAvailable", "Not available from WardSynQ data")) + "</span>" : "") + "</td></tr>";
          }).join("") + "</tbody></table></div>";
      }
      body.innerHTML = h;
      document.getElementById("gHmisMonth").onchange = function () { s.month = val("gHmisMonth"); load(); };
      on("gHmisCsv", function () {
        c.download("/ward/hmis-monthly" + q(c) + "&month=" + encodeURIComponent(s.month) + "&format=csv", "hmis-" + s.month + ".csv").then(function (x) {
          if (!x || !x.ok) c.toast(T(c, "site.gov.csvFailed", "Download refused: {why}", { why: (x && x.message) || T(c, "site.gov.noAnswer", "no answer from the server") }));
        });
      });
    }
    function load() {
      s.data = null; paint();
      c.api("/ward/hmis-monthly" + q(c) + "&month=" + encodeURIComponent(s.month)).then(function (r) { if (r && r.ok) s.data = r; else { s.data = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- DHS self-assessment */
  function dhsStatusLabel(c, x) {
    return { "": T(c, "site.gov.dhs.notAssessed", "Not assessed"), met: T(c, "site.gov.dhs.met", "Met"), "partly-met": T(c, "site.gov.dhs.partly", "Partly met"), "not-met": T(c, "site.gov.dhs.notMet", "Not met"), "not-applicable": T(c, "site.gov.dhs.na", "Not applicable") }[x];
  }
  function dhsTab(c, body, g) {
    var s = g.dhs || (g.dhs = { data: null, chapter: "" });
    var esc = c.esc;
    function paint() {
      if (s.data === null) { body.innerHTML = loading(c, T(c, "site.gov.dhs.loading", "Loading the checklist...")); return; }
      if (s.data === false) { body.innerHTML = failHtml(c, T(c, "site.gov.dhs.failed", "The checklist could not be loaded:"), s.fail); return; }
      var d = s.data;
      var rows = d.elements.filter(function (e) { return !s.chapter || e.chapter === s.chapter; });
      body.innerHTML = '<div class="card"><h2>' + esc(T(c, "site.gov.dhs.title", "NABH Digital Health Standards: self-assessment")) + "</h2>" +
        '<div class="msg warn">' + TS(c, "site.gov.dhs.notCert", "This is the hospital's own self-assessment against the NABH Digital Health Standards, 2nd edition (September 2025). It is not an assessment by NABH and does not certify or accredit anything.") + "</div>" +
        "<p>" + esc(T(c, "site.gov.dhs.counts", "{met} met, {partly} partly met, {notMet} not met, {na} not applicable, {none} not assessed, of {total}.", { met: d.counts.met, partly: d.counts["partly-met"], notMet: d.counts["not-met"], na: d.counts["not-applicable"], none: d.counts["not-assessed"], total: d.total })) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.dhs.chapter", "Chapter")) + '</span><select id="gDhsCh"><option value="">' + esc(T(c, "site.gov.dhs.all", "All chapters")) + "</option>" +
        d.chapters.map(function (ch) { return '<option value="' + esc(ch.code) + '"' + (ch.code === s.chapter ? " selected" : "") + ">" + EN(c, esc(ch.code + " " + ch.title)) + "</option>"; }).join("") + "</select></label>" +
        '<button class="btn" type="button" id="gDhsSave">' + esc(T(c, "site.gov.dhs.save", "Save changes")) + '</button></div><div id="gDhsMsg"></div></div>' +
        '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.gov.dhs.element", "Element")) + "</th><th>" + esc(T(c, "site.gov.dhs.status", "Status")) + "</th><th>" + esc(T(c, "site.gov.dhs.evidence", "Evidence in WardSynQ or elsewhere")) + "</th></tr></thead><tbody>" +
        rows.map(function (e) {
          return "<tr><td><b>" + EN(c, esc(e.printedCode || e.code)) + "</b> " + EN(c, esc(e.level || "")) + "<br>" + EN(c, esc(e.text)) + "</td>" +
            '<td><select data-dhs-status="' + esc(e.code) + '">' + ["", "met", "partly-met", "not-met", "not-applicable"].map(function (x) { return '<option value="' + x + '"' + ((e.status || "") === x ? " selected" : "") + ">" + esc(dhsStatusLabel(c, x)) + "</option>"; }).join("") + "</select></td>" +
            '<td><textarea rows="2" data-dhs-evidence="' + esc(e.code) + '">' + esc(e.evidence || "") + "</textarea></td></tr>";
        }).join("") + "</tbody></table></div>";
      document.getElementById("gDhsCh").onchange = function () { s.chapter = val("gDhsCh"); paint(); };
      on("gDhsSave", function () {
        var changed = [];
        rows.forEach(function (e) {
          var st_ = body.querySelector('[data-dhs-status="' + e.code + '"]'), ev = body.querySelector('[data-dhs-evidence="' + e.code + '"]');
          var ns = st_ ? st_.value : "", ne = ev ? String(ev.value || "").trim() : "";
          if (ns !== (e.status || "") || ne !== (e.evidence || "")) changed.push({ code: e.code, status: ns || null, evidence: ne });
        });
        var m = document.getElementById("gDhsMsg");
        if (!changed.length) { m.innerHTML = '<div class="msg note">' + esc(T(c, "site.gov.dhs.nothing", "Nothing has changed.")) + "</div>"; return; }
        c.api("/ward/dhs-checklist-save", { orgId: c.state.orgId, entries: changed, expectedVersion: d.version }).then(function (r) {
          if (!r || !r.ok) { m.innerHTML = failHtml(c, T(c, "site.gov.dhs.notSaved", "Not saved, nothing was changed:"), r); return; }
          s.data = r; c.toast(T(c, "site.gov.dhs.saved", "Saved {n} changes.", { n: changed.length })); paint();
        });
      });
    }
    function load() {
      s.data = null; paint();
      c.api("/ward/dhs-checklist" + q(c)).then(function (r) { if (r && r.ok) s.data = r; else { s.data = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- report builder */
  function opLabel(c, o) {
    return { eq: T(c, "site.gov.rb.op.eq", "is"), ne: T(c, "site.gov.rb.op.ne", "is not"), contains: T(c, "site.gov.rb.op.contains", "contains"), gte: T(c, "site.gov.rb.op.gte", "is at least"), lte: T(c, "site.gov.rb.op.lte", "is at most"), empty: T(c, "site.gov.rb.op.empty", "is blank"), "not-empty": T(c, "site.gov.rb.op.notEmpty", "is not blank") }[o];
  }
  function reportsTab(c, body, g) {
    var s = g.rb || (g.rb = { saved: null, spec: { dataset: "", columns: [], filters: [], groupBy: "", aggregate: { fn: "count", column: "" } }, result: null });
    var esc = c.esc;
    function ds() { return (s.datasets || []).filter(function (d) { return d.id === s.spec.dataset; })[0] || null; }
    function readForm() {
      var d = ds(); if (!d) return;
      s.spec.columns = d.columns.filter(function (col) { var b = body.querySelector('[data-rb-col="' + col.id + '"]'); return b && b.checked; }).map(function (col) { return col.id; });
      s.spec.filters = s.spec.filters.map(function (f, i) { return { column: val("gRbFc" + i), op: val("gRbFo" + i), value: val("gRbFv" + i) }; });
      s.spec.groupBy = val("gRbGroup"); s.spec.aggregate = { fn: val("gRbAgg") || "count", column: val("gRbSum") };
    }
    function paint() {
      var h = '<div class="card"><h2>' + esc(T(c, "site.gov.rb.saved", "Saved reports")) + "</h2>";
      if (s.saved === null) h += loading(c, T(c, "site.gov.rb.loading", "Loading saved reports..."));
      else if (s.saved === false) h += failHtml(c, T(c, "site.gov.rb.loadFailed", "Saved reports could not be loaded:"), s.fail);
      else if (!s.saved.length) h += '<p class="quiet">' + esc(T(c, "site.gov.rb.noneSaved", "No reports have been saved.")) + "</p>";
      else h += '<div class="tbl"><table><tbody>' + s.saved.map(function (r) {
        return "<tr><td><b>" + EN(c, esc(r.name)) + "</b> " + (r.shared ? '<span class="pill">' + esc(T(c, "site.gov.rb.shared", "Shared")) + "</span>" : "") + "</td><td>" +
          '<button class="btn quiet" type="button" data-rb-open="' + esc(r.id) + '">' + esc(T(c, "site.gov.rb.open", "Open")) + "</button>" +
          '<button class="btn quiet" type="button" data-rb-csv="' + esc(r.id) + '" data-name="' + esc(r.name) + '">' + esc(T(c, "site.gov.csv", "Download CSV")) + "</button>" +
          (r.mine ? '<button class="btn quiet" type="button" data-rb-del="' + esc(r.id) + '">' + esc(T(c, "site.gov.rb.delete", "Delete")) + "</button>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
      h += "</div>";
      if (s.datasets) {
        var d = ds();
        h += '<div class="card"><h2>' + esc(T(c, "site.gov.rb.build", "Build a report")) + "</h2>" +
          '<p class="quiet">' + esc(T(c, "site.gov.rb.rules", "Each dataset needs its own permission, and a column that identifies a patient needs emr.view as well. Only this hospital's records are read.")) + "</p>" +
          '<label class="f"><span>' + esc(T(c, "site.gov.rb.dataset", "Dataset")) + '</span><select id="gRbDs"><option value="">' + esc(T(c, "site.gov.rb.pick", "Choose a dataset")) + "</option>" +
          s.datasets.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === s.spec.dataset ? " selected" : "") + ">" + EN(c, esc(x.label + " (" + x.cap + ")")) + "</option>"; }).join("") + "</select></label>";
        if (d) {
          var colOpts = function (cur, onlyNumber) { return d.columns.filter(function (x) { return !onlyNumber || x.kind === "number"; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? " selected" : "") + ">" + EN(c, esc(x.label)) + "</option>"; }).join(""); };
          h += '<fieldset><legend>' + esc(T(c, "site.gov.rb.columns", "Columns")) + "</legend>" + d.columns.map(function (x) {
            return '<label><input type="checkbox" data-rb-col="' + esc(x.id) + '"' + (s.spec.columns.indexOf(x.id) >= 0 ? " checked" : "") + "> " + EN(c, esc(x.label)) + (x.pii ? ' <span class="pill warn">' + esc(T(c, "site.gov.rb.pii", "identifies a patient")) + "</span>" : "") + "</label> ";
          }).join("") + "</fieldset>" +
            s.spec.filters.map(function (f, i) {
              return '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.rb.where", "Where")) + '</span><select id="gRbFc' + i + '">' + colOpts(f.column) + "</select></label>" +
                '<label class="f"><span>' + esc(T(c, "site.gov.rb.test", "Test")) + '</span><select id="gRbFo' + i + '">' + opts(["eq", "ne", "contains", "gte", "lte", "empty", "not-empty"], function (o) { return esc(opLabel(c, o)); }, f.op) + "</select></label>" +
                '<label class="f"><span>' + esc(T(c, "site.gov.rb.value", "Value")) + '</span><input id="gRbFv' + i + '" value="' + esc(f.value || "") + '"></label>' +
                '<button class="btn quiet" type="button" data-rb-unfilter="' + i + '">' + esc(T(c, "site.gov.rb.removeFilter", "Remove")) + "</button></div>";
            }).join("") +
            '<div class="row"><button class="btn quiet" type="button" id="gRbAddFilter">' + esc(T(c, "site.gov.rb.addFilter", "Add a filter")) + "</button>" +
            '<label class="f"><span>' + esc(T(c, "site.gov.rb.group", "Group by")) + '</span><select id="gRbGroup"><option value="">' + esc(T(c, "site.gov.rb.noGroup", "No grouping: list rows")) + "</option>" + colOpts(s.spec.groupBy) + "</select></label>" +
            '<label class="f"><span>' + esc(T(c, "site.gov.rb.agg", "Measure")) + '</span><select id="gRbAgg"><option value="count">' + esc(T(c, "site.gov.rb.count", "Count")) + '</option><option value="sum"' + (s.spec.aggregate.fn === "sum" ? " selected" : "") + ">" + esc(T(c, "site.gov.rb.sum", "Sum")) + "</option></select></label>" +
            '<label class="f"><span>' + esc(T(c, "site.gov.rb.sumOf", "Sum of")) + '</span><select id="gRbSum"><option value=""></option>' + colOpts(s.spec.aggregate.column, true) + "</select></label>" +
            '<button class="btn" type="button" id="gRbRun">' + esc(T(c, "site.gov.rb.run", "Run")) + "</button></div>" +
            '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.rb.name", "Report name")) + '</span><input id="gRbName" value="' + esc(s.name || "") + '"></label>' +
            '<label><input type="checkbox" id="gRbShare"' + (s.shared ? " checked" : "") + "> " + esc(T(c, "site.gov.rb.share", "Share with this hospital's administrators")) + "</label>" +
            '<button class="btn quiet" type="button" id="gRbSave">' + esc(T(c, "site.gov.rb.saveBtn", "Save report")) + "</button></div>";
        }
        h += '<div id="gRbMsg"></div>';
        var res = s.result;
        if (res === null && s.running) h += loading(c, T(c, "site.gov.rb.running", "Running the report..."));
        else if (res === false) h += failHtml(c, T(c, "site.gov.rb.failed", "The report could not be run:"), s.fail);
        else if (res) {
          h += "<p>" + esc(T(c, "site.gov.rb.matched", "{n} records matched; showing {shown} of {total} rows.", { n: res.matched, shown: res.shown, total: res.total })) + "</p>" +
            (res.truncated ? '<div class="msg note">' + esc(T(c, "site.gov.truncated", "Only the most recent records were read; older ones may be missing.")) + "</div>" : "") +
            '<div class="tbl"><table><thead><tr>' + res.header.map(function (x) { return "<th>" + EN(c, esc(x)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
            res.rows.map(function (r) { return "<tr>" + r.map(function (v) { return "<td>" + EN(c, esc(v == null ? "" : v)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
        }
        h += "</div>";
      }
      body.innerHTML = h;
      var dsSel = document.getElementById("gRbDs");
      if (dsSel) dsSel.onchange = function () { s.spec = { dataset: val("gRbDs"), columns: [], filters: [], groupBy: "", aggregate: { fn: "count", column: "" } }; s.result = null; s.reportId = null; s.name = ""; paint(); };
      on("gRbAddFilter", function () { readForm(); var d = ds(); s.spec.filters.push({ column: d.columns[0].id, op: "eq", value: "" }); paint(); });
      onAll(body, "data-rb-unfilter", function (b) { readForm(); s.spec.filters.splice(Number(b.getAttribute("data-rb-unfilter")), 1); paint(); });
      on("gRbRun", function () {
        readForm(); s.result = null; s.running = true; paint();
        c.api("/ward/report-run", { orgId: c.state.orgId, spec: s.spec }).then(function (r) { s.running = false; if (r && r.ok) s.result = r; else { s.result = false; s.fail = r; } paint(); });
      });
      on("gRbSave", function () {
        readForm(); s.name = val("gRbName"); s.shared = !!(document.getElementById("gRbShare") || {}).checked;
        c.api("/ward/report-save", { orgId: c.state.orgId, reportId: s.reportId || undefined, name: s.name, spec: s.spec, shared: s.shared }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gRbMsg").innerHTML = failHtml(c, T(c, "site.gov.rb.notSaved", "Report not saved:"), r); return; }
          s.reportId = r.report.id; c.toast(T(c, "site.gov.rb.savedToast", "Report saved.")); loadSaved();
        });
      });
      onAll(body, "data-rb-open", function (b) {
        var r = s.saved.filter(function (x) { return x.id === b.getAttribute("data-rb-open"); })[0]; if (!r) return;
        s.spec = JSON.parse(JSON.stringify(r.spec)); s.spec.groupBy = s.spec.groupBy || ""; s.spec.aggregate = s.spec.aggregate || { fn: "count", column: "" };
        s.reportId = r.mine ? r.id : null; s.name = r.name; s.shared = r.shared; s.result = null; paint();
      });
      onAll(body, "data-rb-csv", function (b) {
        c.download("/ward/report-csv" + q(c) + "&reportId=" + encodeURIComponent(b.getAttribute("data-rb-csv")), "report.csv").then(function (x) {
          if (!x || !x.ok) c.toast(T(c, "site.gov.csvFailed", "Download refused: {why}", { why: (x && x.message) || T(c, "site.gov.noAnswer", "no answer from the server") }));
        });
      });
      onAll(body, "data-rb-del", function (b) {
        var r = s.saved.filter(function (x) { return x.id === b.getAttribute("data-rb-del"); })[0]; if (!r) return;
        if (!confirm(T(c, "site.gov.rb.deleteConfirm", "Delete this saved report? Its history is kept."))) return;
        c.api("/ward/report-save", { orgId: c.state.orgId, reportId: r.id, name: r.name, spec: r.spec, shared: r.shared, deleted: true }).then(function (x) {
          if (!x || !x.ok) { c.toast(T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, x) })); return; }
          loadSaved();
        });
      });
    }
    function loadSaved() {
      s.saved = null; paint();
      c.api("/ward/reports-saved" + q(c)).then(function (r) {
        if (r && r.datasets) s.datasets = r.datasets;
        if (r && r.ok) s.saved = r.reports; else { s.saved = false; s.fail = r; }
        paint();
      });
    }
    loadSaved();
  }

  WSQ._govErasureHtml = erasureHtml;
  WSQ._govRequestHtml = requestHtml;
})();
