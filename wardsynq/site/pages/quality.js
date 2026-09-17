/* wardsynq/site/pages/quality.js - "Infection control and quality". Buildless ES5.
 *
 *   Infections          HAI cases confirmed or ruled out by infection control against CDC/NHSN, device-day rates
 *                       (infection.control; functions/_wardsynq/infection-control.js)
 *   Prophylaxis         each operation's antibiotic doses around incision and the review (infection.control)
 *   Antibiogram         CLSI M39 cumulative antibiogram and days of therapy (infection.control or lab.result)
 *   Audits, Mock drills hospital-authored checklists and each audit, drills and their variations (quality.audit;
 *                       functions/_wardsynq/quality-registers.js)
 *   ADR report          the PvPI suspected adverse drug reaction form (incident.report); the list for quality.audit
 *   Emergency medicines stock-outs of the hospital's emergency medicines (dept.request)
 *   Emergency returns   visits within 72 hours of another; a prescriber says whether the complaint was similar (emr.view,
 *                       emr.treat to decide)
 *
 * The server decides every permission; a tab is only offered to a role that could use it. null is loading and a failed
 * read says so, never an empty list. Recorded values (a patient, a drug, a checklist item, an NHSN criterion name) are
 * shown as recorded, never translated. Nothing here suggests or confirms an infection: the nurse does.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function checked(id) { var e = document.getElementById(id); return !!(e && e.checked); }
  function when(iso) { return String(iso || "").slice(0, 16).replace("T", " "); }
  function isoFromLocal(v) { var t = Date.parse(v || ""); return isFinite(t) ? new Date(t).toISOString() : ""; }
  function loading(c) { return '<p><span class="spin"></span> ' + c.esc(T(c, "site.qual.loading", "Loading...")) + "</p>"; }
  function failed(c, r) { return '<div class="msg err">' + TS(c, "site.qual.failed", "Could not load this. Do not read it as none.") + (r && (r.detail || r.error) ? " " + EN(c, c.esc(r.detail || r.error)) : "") + "</div>"; }
  function who(c, patients, id) { var p = (patients || {})[id]; return p ? EN(c, c.esc((p.name || "") + (p.mrn ? " · " + p.mrn : ""))) : EN(c, c.esc(id)); }
  function opt(value, label, cur) { return '<option value="' + value + '"' + (value === cur ? " selected" : "") + ">" + label + "</option>"; }
  function monthRow(c, id, month) {
    return '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.qual.month", "Month")) + '</span><input id="' + id + '" type="month" value="' + c.esc(month || "") + '"></label>' +
      '<button class="btn quiet" type="button" data-q="month" data-for="' + id + '">' + c.esc(T(c, "site.qual.show", "Show")) + "</button></div>";
  }

  function tabLabel(c, t) {
    return { ic: T(c, "site.qual.tab.ic", "Infections"), sap: T(c, "site.qual.tab.sap", "Surgical prophylaxis"), abg: T(c, "site.qual.tab.abg", "Antibiogram"),
      audits: T(c, "site.qual.tab.audits", "Audits"), drills: T(c, "site.qual.tab.drills", "Mock drills"), adr: T(c, "site.qual.tab.adr", "Adverse drug reactions"),
      stock: T(c, "site.qual.tab.stock", "Emergency medicines"), edret: T(c, "site.qual.tab.edret", "Emergency returns") }[t];
  }
  function statusWord(c, s) {
    var w = { "under-review": T(c, "site.qual.hai.underReview", "Under review"), confirmed: T(c, "site.qual.hai.confirmed", "Confirmed"),
      "ruled-out": T(c, "site.qual.hai.ruledOut", "Ruled out"), withdrawn: T(c, "site.qual.hai.withdrawn", "Confirmation withdrawn") };
    return Object.prototype.hasOwnProperty.call(w, s) ? c.esc(w[s]) : EN(c, c.esc(s));
  }
  function kindWord(c, k) {
    var w = { "hand-hygiene": T(c, "site.qual.kind.handHygiene", "Hand hygiene (NABH 17)"), consent: T(c, "site.qual.kind.consent", "Consent in medical records (NABH 25)"),
      handover: T(c, "site.qual.kind.handover", "Handover (NABH 31)"), prescription: T(c, "site.qual.kind.prescription", "Prescription (NABH 32)"),
      "diagnostic-safety": T(c, "site.qual.kind.diagnosticSafety", "Safety precautions in diagnostics (NABH 3)"), other: T(c, "site.qual.kind.other", "Other") };
    return Object.prototype.hasOwnProperty.call(w, k) ? c.esc(w[k]) : EN(c, c.esc(k));
  }
  function deviceWord(c, d) {
    var w = { "central-line": T(c, "site.qual.device.central", "Central line"), "urinary-catheter": T(c, "site.qual.device.urinary", "Urinary catheter"), ventilator: T(c, "site.qual.device.ventilator", "Ventilator") };
    return Object.prototype.hasOwnProperty.call(w, d) ? c.esc(w[d]) : EN(c, c.esc(d));
  }
  function depthWord(c, d) {
    var w = { "superficial-incisional": T(c, "site.qual.ssi.superficial", "Superficial incisional"), "deep-incisional": T(c, "site.qual.ssi.deep", "Deep incisional"), "organ-space": T(c, "site.qual.ssi.organ", "Organ or space") };
    return Object.prototype.hasOwnProperty.call(w, d) ? c.esc(w[d]) : EN(c, c.esc(d));
  }

  /* ---------------------------------------------------------------- infections */
  function eligibilityHtml(c, e) {
    if (!e) return "";
    var where = e.deviceDay != null ? T(c, "site.qual.hai.deviceDay", "device day {n} on the date of event", { n: e.deviceDay })
      : e.postOpDay != null ? T(c, "site.qual.hai.postOpDay", "day {n} after the operation, of a {days} day surveillance period", { n: e.postOpDay, days: e.surveillanceDays }) : "";
    return '<span class="pill ' + (e.eligible ? "ok" : "warn") + '">' + c.esc(e.eligible ? T(c, "site.qual.hai.eligible", "Meets the NHSN timing") : T(c, "site.qual.hai.notEligible", "Does not meet the NHSN timing")) + "</span> " + c.esc(where);
  }
  function icHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc, events = d.events || [];
    var ev = function (id) { for (var i = 0; i < events.length; i++) if (events[i].id === id) return events[i]; return null; };
    var rates = '<div class="tbl"><table><tr><th>' + esc(T(c, "site.qual.hai.event", "Infection")) + "</th><th>" + esc(T(c, "site.qual.hai.confirmedCol", "Confirmed")) + "</th><th>" + esc(T(c, "site.qual.hai.denominator", "Device-days or operations")) + "</th><th>" + esc(T(c, "site.qual.hai.rate", "Rate")) + "</th></tr>" +
      d.rates.map(function (r) {
        var e = ev(r.event);
        if (!r.computable) return "<tr><td>" + EN(c, esc(r.event)) + '</td><td colspan="3">' + TS(c, "site.qual.hai.notComputable", "Not computable:") + " " + EN(c, esc(r.reason)) + "</td></tr>";
        return "<tr><td><b>" + EN(c, esc(r.event)) + "</b> " + EN(c, esc(e ? e.label : "")) + "</td><td>" + esc(r.numerator) + "</td><td>" + esc(r.denominator) + "</td><td>" +
          (r.value == null ? esc(T(c, "site.qual.noRate", "no rate: nothing to divide by")) : esc(r.per === 1000 ? T(c, "site.qual.hai.per1000", "{v} per 1000 device-days", { v: r.value }) : T(c, "site.qual.hai.per100", "{v} per 100 operations", { v: r.value }))) + "</td></tr>";
      }).join("") + "</table></div>" + '<p class="quiet">' + EN(c, esc(d.denominatorNote || "")) + "</p>";
    var cases = d.cases == null ? failed(c, { detail: d.casesError }) : !d.cases.length ? "<p>" + esc(T(c, "site.qual.hai.none", "No cases recorded.")) + "</p>" : d.cases.map(function (k) {
      var e = ev(k.event) || { criteria: [] }, id = esc(k.id), acts = "";
      if (k.status === "under-review") {
        acts = '<div class="row">' + e.criteria.map(function (cr, i) { return '<label class="f"><span><input type="checkbox" id="qCr-' + id + "-" + i + '" data-crit="' + esc(cr) + '"> ' + EN(c, esc(cr)) + "</span></label>"; }).join("") + "</div>" +
          '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.hai.organisms", "Organisms, one per line")) + '</span><textarea id="qOrg-' + id + '" rows="2"></textarea></label>' +
          (k.eligibility && !k.eligibility.eligible ? '<label class="f"><span>' + esc(T(c, "site.qual.hai.eligibilityNote", "Why this is confirmed although the timing does not meet NHSN")) + '</span><input id="qElig-' + id + '"></label>' : "") +
          '<button class="btn" type="button" data-q="confirm" data-id="' + id + '" data-event="' + esc(k.event) + '">' + esc(T(c, "site.qual.hai.confirm", "Confirm against the ticked criteria")) + "</button></div>" +
          '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.reason", "Reason")) + '</span><input id="qWhy-' + id + '"></label><button class="btn quiet" type="button" data-q="ruleout" data-id="' + id + '">' + esc(T(c, "site.qual.hai.ruleOut", "Rule out")) + "</button></div>";
      } else if (k.status === "confirmed") {
        acts = '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.reason", "Reason")) + '</span><input id="qWhy-' + id + '"></label><button class="btn quiet" type="button" data-q="withdraw" data-id="' + id + '">' + esc(T(c, "site.qual.hai.withdraw", "Withdraw the confirmation")) + "</button></div>";
      }
      return '<div class="card"><h3>' + EN(c, esc(k.event)) + " · " + who(c, d.patients, k.patientId) + " · " + statusWord(c, k.status) + "</h3><p>" +
        esc(T(c, "site.qual.hai.doe", "Date of event {d}", { d: k.dateOfEvent })) + (k.ssiDepth ? " · " + depthWord(c, k.ssiDepth) : "") + " · " + eligibilityHtml(c, k.eligibility) +
        (k.criteriaMet && k.criteriaMet.length ? " · " + EN(c, esc(k.criteriaMet.join(", "))) : "") + (k.organisms && k.organisms.length ? " · " + EN(c, esc(k.organisms.join(", "))) : "") +
        (k.reason ? " · " + EN(c, esc(k.reason)) : "") + (k.eligibilityNote ? " · " + EN(c, esc(k.eligibilityNote)) : "") + '</p><p class="quiet">' + EN(c, esc(k.definitionSource || "")) + "</p>" + acts + "</div>";
    }).join("");
    var lineOpts = (d.lines || []).map(function (l) { return '<option value="' + esc(l.lineId) + '">' + deviceWord(c, l.deviceClass) + " · " + who(c, d.patients, l.patientId) + " · " + EN(c, esc(l.type + (l.site ? " " + l.site : "") + " " + when(l.insertedAt))) + "</option>"; }).join("");
    var opOpts = (d.operations || []).map(function (o) { return '<option value="' + esc(o.caseId) + '">' + who(c, d.patients, o.patientId) + " · " + EN(c, esc((o.procedure || "") + " " + when(o.incisionAt))) + "</option>"; }).join("");
    var form = '<div class="card"><h2>' + esc(T(c, "site.qual.hai.openTitle", "Open a case for review")) + '</h2><p class="quiet">' + esc(T(c, "site.qual.hai.openHelp", "A device-associated infection is linked to a line logged with its device class on the chart; a surgical site infection to the operation. The criteria are applied by you; nothing here decides.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.hai.event", "Infection")) + '</span><select id="qEvent">' + events.map(function (e) { return '<option value="' + esc(e.id) + '">' + EN(c, esc(e.id + " " + e.label)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.hai.doeLabel", "Date of event")) + '</span><input id="qDoe" type="date"></label></div>' +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.hai.line", "Line (CLABSI, CAUTI, VAP)")) + '</span><select id="qLine"><option value=""></option>' + lineOpts + "</select></label>" +
      (d.lines == null ? failed(c, { detail: d.linesError }) : "") +
      '<label class="f"><span>' + esc(T(c, "site.qual.hai.operation", "Operation (SSI)")) + '</span><select id="qOp"><option value=""></option>' + opOpts + "</select></label>" +
      (d.operations == null ? failed(c, { detail: d.operationsError }) : "") + "</div>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.hai.depth", "SSI depth")) + '</span><select id="qDepth"><option value=""></option>' + (d.ssiDepths || []).map(function (x) { return '<option value="' + esc(x) + '">' + depthWord(c, x) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.hai.period", "SSI surveillance period (days)")) + '</span><select id="qPeriod"><option value=""></option><option value="30">30</option><option value="90">90</option></select></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.note", "Note")) + '</span><input id="qNote"></label>' +
      '<button class="btn" type="button" data-q="open">' + esc(T(c, "site.qual.hai.open", "Open case")) + "</button></div>" + '<p class="quiet">' + EN(c, esc(d.unapproved || "")) + "</p></div>";
    return '<div class="card"><h2>' + esc(T(c, "site.qual.hai.ratesTitle", "Rates this month")) + "</h2>" + rates + "</div>" + form + "<h2>" + esc(T(c, "site.qual.hai.casesTitle", "Cases")) + "</h2>" + cases;
  }

  /* ---------------------------------------------------------------- prophylaxis */
  function sapHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc;
    if (d.prophylaxisReason === "window-not-configured") return '<div class="msg note">' + esc(T(c, "site.qual.sap.noWindow", "The prophylaxis window is not configured. An administrator sets it in Admin, clinical settings.")) + "</div>";
    if (d.prophylaxisReason === "antibiotics-not-configured") return '<div class="msg note">' + esc(T(c, "site.qual.sap.noAbx", "The antibiotic list is not configured, so no dose can be found. An administrator sets it in Admin, clinical settings.")) + "</div>";
    if (d.prophylaxis == null) return failed(c, { detail: d.prophylaxisReason });
    if (!d.prophylaxis.length) return "<p>" + esc(T(c, "site.qual.sap.none", "No operations with an incision this month.")) + "</p>";
    return '<p class="quiet">' + esc(T(c, "site.qual.sap.help", "Listed antibiotics given within 24 hours of incision, from the drug chart and the anaesthesia record. A dose counts as on time within {n} minutes before incision.", { n: d.windowMinutes })) + "</p>" +
      d.prophylaxis.map(function (p) {
        var id = esc(p.caseId), r = p.review;
        return '<div class="card"><h3>' + who(c, d.patients, p.patientId) + " · " + EN(c, esc((p.procedure || "") + " " + when(p.incisionAt))) + "</h3>" +
          (p.doses.length ? "<ul>" + p.doses.map(function (x) { return "<li>" + EN(c, esc(x.drug + " " + when(x.at))) + " · " + esc(x.source === "eMAR" ? T(c, "site.qual.sap.fromMar", "drug chart") : T(c, "site.qual.sap.fromAnaes", "anaesthesia record")) + " · " + esc(T(c, "site.qual.sap.minutesBefore", "{n} minutes before incision", { n: x.minutesBeforeIncision })) + "</li>"; }).join("") + "</ul>"
            : "<p>" + esc(T(c, "site.qual.sap.noDoses", "No listed antibiotic recorded within 24 hours of incision.")) + "</p>") +
          "<p>" + esc(T(c, "site.qual.sap.inWindow", "On time: {n}", { n: p.dosesInWindow })) + " · " + (r ? esc(r.appropriate ? T(c, "site.qual.sap.appropriate", "Reviewed: appropriate") : T(c, "site.qual.sap.notAppropriate", "Reviewed: not appropriate")) : esc(T(c, "site.qual.sap.unreviewed", "Not reviewed"))) + "</p>" +
          '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.sap.indicated", "Prophylaxis indicated")) + '</span><select id="qInd-' + id + '">' + opt("yes", esc(T(c, "site.qual.yes", "Yes")), r && r.indicated ? "yes" : "") + opt("no", esc(T(c, "site.qual.no", "No")), r && !r.indicated ? "no" : "") + "</select></label>" +
          '<label class="f"><span>' + esc(T(c, "site.qual.sap.agent", "Agent matches the hospital policy")) + '</span><select id="qAgent-' + id + '">' + opt("yes", esc(T(c, "site.qual.yes", "Yes")), r && r.agentPerPolicy) + opt("no", esc(T(c, "site.qual.no", "No")), r && r.agentPerPolicy) + opt("not-applicable", esc(T(c, "site.qual.na", "Not applicable")), r && r.agentPerPolicy) + "</select></label>" +
          '<button class="btn" type="button" data-q="sap" data-id="' + id + '">' + esc(T(c, "site.qual.sap.save", "Save review")) + "</button></div></div>";
      }).join("");
  }

  /* ---------------------------------------------------------------- antibiogram */
  function abgHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc;
    var dot = d.dot ? (d.dot.computable ? "<p>" + esc(T(c, "site.qual.abg.dot", "Antibiotic days of therapy: {n} over {bd} bed-days", { n: d.dot.numerator, bd: d.dot.denominator })) + (d.dot.rate != null ? " · " + esc(T(c, "site.qual.abg.dotRate", "{r} per 1000", { r: d.dot.rate })) : "") + "</p>"
      : '<div class="msg note">' + TS(c, "site.qual.abg.dotNot", "Days of therapy not computable:") + " " + EN(c, esc(d.dot.reason || "")) + "</div>") : "";
    if (!d.computable) return '<div class="msg note">' + esc(T(c, "site.qual.abg.notConfigured", "The minimum number of isolates is not configured. An administrator sets it in Admin, clinical settings (CLSI M39 recommends 30).")) + "</div>" + dot;
    var head = "<p>" + esc(T(c, "site.qual.abg.summary", "{from} to {to}: {n} first isolates from {r} final reports, {dup} repeat isolates left out. Minimum {min} isolates.", { from: d.period.from, to: d.period.to, n: d.firstIsolates, r: d.reportsUsed, dup: d.duplicatesExcluded, min: d.minIsolates })) + "</p>" +
      (d.truncated ? '<div class="msg warn">' + esc(T(c, "site.qual.abg.truncated", "More reports exist than were read; the oldest may be missing.")) + "</div>" : "");
    var body = !d.organisms.length ? "<p>" + esc(T(c, "site.qual.abg.none", "No final cultures with organisms in this period.")) + "</p>" : d.organisms.map(function (o) {
      return '<div class="card"><h3>' + EN(c, esc(o.organism)) + " · " + esc(T(c, "site.qual.abg.isolates", "{n} isolates", { n: o.isolates })) + "</h3>" +
        (o.insufficient ? "<p>" + esc(T(c, "site.qual.abg.insufficient", "Too few isolates for a percentage.")) + "</p>"
          : '<div class="tbl"><table><tr><th>' + esc(T(c, "site.qual.abg.antibiotic", "Antibiotic")) + "</th><th>" + esc(T(c, "site.qual.abg.pctS", "% susceptible")) + "</th><th>" + esc(T(c, "site.qual.abg.tested", "Tested")) + "</th></tr>" +
            o.antibiotics.map(function (a) { return "<tr><td>" + EN(c, esc(a.antibiotic)) + "</td><td>" + (a.insufficient ? esc(T(c, "site.qual.abg.tooFew", "too few tested")) : esc(a.percentSusceptible)) + "</td><td>" + esc(a.tested) + "</td></tr>"; }).join("") + "</table></div>") + "</div>";
    }).join("");
    return head + body + dot + '<p class="quiet">' + EN(c, esc(d.method || "")) + "</p>";
  }

  /* ---------------------------------------------------------------- audits and drills */
  function deptWord(c, k) { return k === "laboratory" ? T(c, "site.qual.dept.laboratory", "Laboratory") : k === "radiology" ? T(c, "site.qual.dept.radiology", "Radiology") : k; }
  function auditFormHtml(c, d, templateId) {
    var esc = c.esc, active = (d.templates || []).filter(function (t) { return t.active !== false; });
    if (!active.length) return "<p>" + esc(T(c, "site.qual.audit.noTemplates", "No checklist yet. Write one below first.")) + "</p>";
    var cur = null;
    for (var i = 0; i < active.length; i++) if (active[i].id === templateId) cur = active[i];
    cur = cur || active[0];
    return '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.audit.checklist", "Checklist")) + '</span><select id="qTpl">' + active.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === cur.id ? " selected" : "") + ">" + EN(c, esc(t.name)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.when", "When")) + '</span><input id="qAuAt" type="datetime-local"></label><label class="f"><span>' + esc(T(c, "site.qual.audit.unit", "Ward or unit")) + '</span><input id="qAuUnit"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.mrnOptional", "MRN, if a record was audited")) + '</span><input id="qAuMrn"></label></div>' +
      (cur.kind === "diagnostic-safety" ? '<p class="quiet">' + esc(T(c, "site.qual.audit.diagHelp", "One audit is one member of staff in the laboratory or radiology. NABH asks that the auditor is from outside the department audited.")) + '</p><div class="row"><label class="f"><span>' + esc(T(c, "site.qual.audit.department", "Department audited")) + '</span><select id="qAuDept"><option value=""></option>' +
        ["laboratory", "radiology"].map(function (k) { return '<option value="' + k + '">' + esc(deptWord(c, k)) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.qual.audit.outside", "I work outside the department audited")) + '</span><select id="qAuOutside"><option value=""></option><option value="yes">' + esc(T(c, "site.qual.yes", "Yes")) + '</option><option value="no">' + esc(T(c, "site.qual.no", "No")) + "</option></select></label></div>" : "") +
      '<div class="tbl"><table>' + cur.items.map(function (it) {
        var n = "qAns-" + esc(it.id);
        return "<tr><td>" + EN(c, esc(it.text)) + "</td><td>" + ["yes", "no", "na"].map(function (a) {
          return '<label><input type="radio" name="' + n + '" id="' + n + "-" + a + '" value="' + a + '"> ' + esc(a === "yes" ? T(c, "site.qual.yes", "Yes") : a === "no" ? T(c, "site.qual.no", "No") : T(c, "site.qual.na", "Not applicable")) + "</label> ";
        }).join("") + "</td></tr>";
      }).join("") + '</table></div><button class="btn" type="button" data-q="audit" data-id="' + esc(cur.id) + '">' + esc(T(c, "site.qual.audit.save", "Save audit")) + "</button>";
  }
  function auditsHtml(c, d, templateId) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc;
    var sum = d.summary ? '<div class="tbl"><table><tr><th>' + esc(T(c, "site.qual.audit.kind", "Kind")) + "</th><th>" + esc(T(c, "site.qual.audit.audited", "Audited")) + "</th><th>" + esc(T(c, "site.qual.audit.compliant", "Compliant")) + "</th></tr>" +
      d.kinds.map(function (k) { var s = d.summary[k]; return "<tr><td>" + kindWord(c, k) + "</td><td>" + esc(s.audited) + "</td><td>" + esc(s.compliant) + "</td></tr>"; }).join("") + "</table></div>" : failed(c, { detail: d.auditsError });
    var list = d.audits == null ? "" : d.audits.map(function (a) { return "<li>" + esc(when(a.at)) + " · " + EN(c, esc(a.templateName + (a.unit ? " · " + a.unit : ""))) + (a.department ? " · " + esc(deptWord(c, a.department)) : "") + " · " + esc(a.compliant ? T(c, "site.qual.audit.isCompliant", "compliant") : T(c, "site.qual.audit.notCompliant", "not compliant")) + "</li>"; }).join("");
    var tpl = d.templates == null ? failed(c, { detail: d.templatesError }) : auditFormHtml(c, d, templateId);
    return '<div class="card"><h2>' + esc(T(c, "site.qual.audit.summaryTitle", "This month")) + "</h2>" + sum + (list ? "<ul>" + list + "</ul>" : "") + "</div>" +
      '<div class="card"><h2>' + esc(T(c, "site.qual.audit.recordTitle", "Record an audit")) + '</h2><p class="quiet">' + esc(T(c, "site.qual.audit.help", "One audit is one observation: one hand hygiene opportunity, one record, one handover or one prescription. It is compliant when no item is answered no.")) + "</p>" + tpl + "</div>" +
      '<div class="card"><h2>' + esc(T(c, "site.qual.audit.newTitle", "Write a checklist")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.qual.audit.name", "Name")) + '</span><input id="qTplName"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.audit.kind", "Kind")) + '</span><select id="qTplKind">' + (d.kinds || []).map(function (k) { return '<option value="' + esc(k) + '">' + kindWord(c, k) + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.audit.items", "Items, one per line")) + '</span><textarea id="qTplItems" rows="5"></textarea></label>' +
      '<button class="btn" type="button" data-q="template">' + esc(T(c, "site.qual.audit.saveTemplate", "Save checklist")) + "</button></div>";
  }
  function drillsHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc;
    var list = d.drills == null ? failed(c, { detail: d.drillsError }) : !d.drills.length ? "<p>" + esc(T(c, "site.qual.drill.none", "No drills recorded this month.")) + "</p>" : d.drills.map(function (x) {
      return '<div class="card"><h3>' + EN(c, esc(x.drillType + " · " + x.location)) + " · " + esc(when(x.at)) + "</h3><p>" + esc(T(c, "site.qual.drill.variations", "{n} variations", { n: x.variations.length })) + "</p>" +
        (x.variations.length ? "<ul>" + x.variations.map(function (v) { return "<li>" + EN(c, esc(v)) + "</li>"; }).join("") + "</ul>" : "") + (x.correctiveActions ? "<p>" + EN(c, esc(x.correctiveActions)) + "</p>" : "") + "</div>";
    }).join("");
    return '<div class="card"><h2>' + esc(T(c, "site.qual.drill.recordTitle", "Record a mock drill")) + '</h2><div class="row">' +
      '<label class="f"><span>' + esc(T(c, "site.qual.drill.type", "Drill (fire, code blue, disaster, tabletop)")) + '</span><input id="qDrType"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.when", "When")) + '</span><input id="qDrAt" type="datetime-local"></label><label class="f"><span>' + esc(T(c, "site.qual.drill.location", "Location")) + '</span><input id="qDrLoc"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.drill.participants", "Participants")) + '</span><input id="qDrPeople" type="number" min="0"></label></div>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.drill.scenario", "Scenario")) + '</span><input id="qDrScen"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.drill.variationsLabel", "Variations observed, one per line (leave empty if none)")) + '</span><textarea id="qDrVar" rows="4"></textarea></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.drill.actions", "Corrective actions")) + '</span><input id="qDrAct"></label>' +
      '<button class="btn" type="button" data-q="drill">' + esc(T(c, "site.qual.drill.save", "Save drill")) + "</button></div>" + list;
  }

  /* ---------------------------------------------------------------- ADR */
  var SERIOUS = ["death", "life-threatening", "hospitalisation", "disability", "congenital-anomaly", "other-medically-important"];
  var OUTCOMES = ["recovered", "recovering", "not-recovered", "fatal", "recovered-with-sequelae", "unknown"];
  var ACTIONS = ["withdrawn", "dose-increased", "dose-reduced", "dose-not-changed", "not-applicable", "unknown"];
  var REAPPEARED = ["not-reintroduced", "yes", "no", "effect-unknown"];
  function adrWord(c, x) {
    var w = { death: T(c, "site.qual.adr.death", "Death"), "life-threatening": T(c, "site.qual.adr.lifeThreatening", "Life threatening"), hospitalisation: T(c, "site.qual.adr.hosp", "Hospitalisation, initial or prolonged"),
      disability: T(c, "site.qual.adr.disability", "Disability"), "congenital-anomaly": T(c, "site.qual.adr.congenital", "Congenital anomaly"), "other-medically-important": T(c, "site.qual.adr.otherImportant", "Other medically important"),
      recovered: T(c, "site.qual.adr.recovered", "Recovered"), recovering: T(c, "site.qual.adr.recovering", "Recovering"), "not-recovered": T(c, "site.qual.adr.notRecovered", "Not recovered"), fatal: T(c, "site.qual.adr.fatal", "Fatal"),
      "recovered-with-sequelae": T(c, "site.qual.adr.sequelae", "Recovered with sequelae"), unknown: T(c, "site.qual.adr.unknown", "Unknown"),
      withdrawn: T(c, "site.qual.adr.drugWithdrawn", "Drug withdrawn"), "dose-increased": T(c, "site.qual.adr.doseUp", "Dose increased"), "dose-reduced": T(c, "site.qual.adr.doseDown", "Dose reduced"),
      "dose-not-changed": T(c, "site.qual.adr.doseSame", "Dose not changed"), "not-applicable": T(c, "site.qual.na", "Not applicable"),
      "not-reintroduced": T(c, "site.qual.adr.notReintroduced", "Not reintroduced"), yes: T(c, "site.qual.yes", "Yes"), no: T(c, "site.qual.no", "No"), "effect-unknown": T(c, "site.qual.adr.effectUnknown", "Effect unknown") };
    return Object.prototype.hasOwnProperty.call(w, x) ? c.esc(w[x]) : EN(c, c.esc(x));
  }
  function adrHtml(c, canReport, reg) {
    var esc = c.esc, sel = function (id, list, blank) { return '<select id="' + id + '">' + (blank ? '<option value=""></option>' : "") + list.map(function (x) { return '<option value="' + x + '">' + adrWord(c, x) + "</option>"; }).join("") + "</select>"; };
    var form = !canReport ? "" : '<div class="card"><h2>' + esc(T(c, "site.qual.adr.formTitle", "Report a suspected adverse drug reaction (PvPI form)")) + '</h2><div class="row">' +
      '<label class="f"><span>' + esc(T(c, "site.qual.mrn", "MRN")) + '</span><input id="qAdrMrn"></label><label class="f"><span>' + esc(T(c, "site.qual.adr.start", "Reaction started")) + '</span><input id="qAdrStart" type="date"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.adr.stop", "Reaction stopped")) + '</span><input id="qAdrStop" type="date"></label></div>' +
      '<label class="f"><span>' + esc(T(c, "site.qual.adr.describe", "Describe the reaction and its treatment")) + '</span><textarea id="qAdrDesc" rows="3"></textarea></label>' +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.adr.serious", "Serious")) + '</span><select id="qAdrSerious"><option value="no">' + esc(T(c, "site.qual.no", "No")) + '</option><option value="yes">' + esc(T(c, "site.qual.yes", "Yes")) + "</option></select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.adr.seriousness", "If serious, which")) + "</span>" + sel("qAdrCrit", SERIOUS, true) + "</label>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.adr.outcome", "Outcome")) + "</span>" + sel("qAdrOutcome", OUTCOMES) + "</label></div>" +
      [0, 1, 2].map(function (n) {
        return '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.adr.medicine", "Suspected medicine {n}", { n: n + 1 })) + '</span><input id="qAdrMed' + n + '"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.qual.adr.dose", "Dose, route, frequency")) + '</span><input id="qAdrDose' + n + '"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.qual.adr.action", "Action taken")) + "</span>" + sel("qAdrAct" + n, ACTIONS, true) + "</label>" +
          '<label class="f"><span>' + esc(T(c, "site.qual.adr.reappeared", "Reaction reappeared after reintroduction")) + "</span>" + sel("qAdrRe" + n, REAPPEARED, true) + "</label></div>";
      }).join("") +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.adr.concomitant", "Other medicines, with dates")) + '</span><input id="qAdrCon"></label><label class="f"><span>' + esc(T(c, "site.qual.adr.tests", "Relevant tests with dates")) + '</span><input id="qAdrTests"></label></div>' +
      '<button class="btn" type="button" data-q="adr">' + esc(T(c, "site.qual.adr.submit", "File report")) + "</button></div>";
    var list = "";
    if (reg !== undefined) {
      list = reg == null ? loading(c) : !reg.ok ? failed(c, reg) : reg.adrs == null ? failed(c, { detail: reg.adrsError }) : '<div class="card"><h2>' + esc(T(c, "site.qual.adr.listTitle", "Reports this month")) + "</h2>" +
        (reg.adrs.length ? "<ul>" + reg.adrs.map(function (a) { return "<li>" + esc(a.reaction.startDate) + " · " + EN(c, esc(a.reaction.description + " · " + a.medicines.map(function (m) { return m.name; }).join(", "))) + " · " + (a.reaction.serious ? esc(T(c, "site.qual.adr.isSerious", "serious")) + " " : "") + adrWord(c, a.reaction.outcome) + "</li>"; }).join("") + "</ul>"
          : "<p>" + esc(T(c, "site.qual.adr.none", "No reports this month.")) + "</p>") + "</div>";
    }
    return form + list;
  }

  /* ---------------------------------------------------------------- emergency medicines */
  function stockHtml(c, d) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc;
    if (!d.configured) return '<div class="msg note">' + esc(T(c, "site.qual.stock.notConfigured", "The emergency medicine list is not configured. An administrator sets it in Admin, clinical settings.")) + "</div>";
    var row = function (s, restore) {
      return "<li>" + EN(c, esc(s.medicine + " · " + s.location)) + " · " + esc(when(s.occurredAt)) + (s.restoredAt ? " · " + esc(T(c, "site.qual.stock.back", "back {at}", { at: when(s.restoredAt) })) : "") +
        (restore ? ' <button class="btn quiet" type="button" data-q="restore" data-id="' + esc(s.id) + '">' + esc(T(c, "site.qual.stock.restore", "Back in stock")) + "</button>" : "") + "</li>";
    };
    return '<div class="card"><h2>' + esc(T(c, "site.qual.stock.recordTitle", "Record a stock-out")) + '</h2><div class="row"><label class="f"><span>' + esc(T(c, "site.qual.stock.medicine", "Medicine")) + '</span><select id="qSoMed">' +
      d.medicines.map(function (m) { return '<option value="' + esc(m) + '">' + EN(c, esc(m)) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.qual.stock.location", "Where (pharmacy, store or ward)")) + '</span><input id="qSoLoc"></label><label class="f"><span>' + esc(T(c, "site.qual.when", "When")) + '</span><input id="qSoAt" type="datetime-local"></label>' +
      '<button class="btn" type="button" data-q="stockout">' + esc(T(c, "site.qual.stock.record", "Record")) + "</button></div></div>" +
      '<div class="card"><h2>' + esc(T(c, "site.qual.stock.openTitle", "Still out of stock")) + "</h2>" + (d.open.length ? "<ul>" + d.open.map(function (s) { return row(s, true); }).join("") + "</ul>" : "<p>" + esc(T(c, "site.qual.stock.noneOpen", "None recorded as still out of stock.")) + "</p>") + "</div>" +
      '<div class="card"><h2>' + esc(T(c, "site.qual.stock.monthTitle", "Stock-outs this month: {n}", { n: d.stockOuts.length })) + "</h2>" + (d.stockOuts.length ? "<ul>" + d.stockOuts.map(function (s) { return row(s, false); }).join("") + "</ul>" : "") + "</div>";
  }

  /* ---------------------------------------------------------------- emergency returns */
  function edHtml(c, d, canDecide) {
    if (d == null) return loading(c);
    if (!d.ok) return failed(c, d);
    var esc = c.esc;
    return "<p>" + esc(T(c, "site.qual.ed.summary", "{v} emergency visits this month; {n} came within 72 hours of an earlier visit.", { v: d.edVisits, n: d.returns.length })) + "</p>" +
      d.returns.map(function (x) {
        var id = esc(x.encounterId), r = x.review;
        return '<div class="card"><h3>' + who(c, d.patients, x.patientId) + " · " + esc(when(x.arrivedAt)) + "</h3><p>" + esc(T(c, "site.qual.ed.now", "This visit:")) + " " + EN(c, esc(x.complaint || "")) + "</p><p>" +
          esc(T(c, "site.qual.ed.before", "Earlier visit {at}:", { at: when(x.prior.arrivedAt) })) + " " + EN(c, esc(x.prior.complaint || "")) + "</p><p>" +
          (r ? esc(r.similar ? T(c, "site.qual.ed.similar", "Reviewed: similar complaint") : T(c, "site.qual.ed.notSimilar", "Reviewed: not a similar complaint")) : esc(T(c, "site.qual.ed.unreviewed", "Not reviewed"))) + "</p>" +
          (canDecide ? '<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.note", "Note")) + '</span><input id="qEdNote-' + id + '"></label><button class="btn" type="button" data-q="edsimilar" data-id="' + id + '">' + esc(T(c, "site.qual.ed.markSimilar", "Similar complaint")) + "</button>" +
            '<button class="btn quiet" type="button" data-q="ednot" data-id="' + id + '">' + esc(T(c, "site.qual.ed.markNot", "Not similar")) + "</button></div>" : "") + "</div>";
      }).join("");
  }

  /* The read behind each tab. */
  var TAB_ROUTE = { ic: "infection-control", sap: "infection-control", abg: "antibiogram", audits: "quality-registers", drills: "quality-registers", adr: "quality-registers", stock: "emergency-stock", edret: "ed-returns" };

  WSQ.page("quality", { render: function (c) {
    var el = c.el, st = c.state, esc = c.esc;
    var g = st._qual || (st._qual = {});
    var head = '<div class="title"><h1>' + esc(T(c, "site.qual.title", "Infection control and quality")) + '</h1></div><div id="qMsg"></div>';
    if (!c.isWardsynq()) { el.innerHTML = head + '<div class="msg note">' + esc(T(c, "site.qual.notWardsynq", "These records are kept for a WardSynQ hospital only.")) + "</div>"; return; }
    var can = { ic: c.can("infection.control"), lab: c.can("lab.result"), qa: c.can("quality.audit"), report: c.can("incident.report"), floor: c.can("dept.request"), view: c.can("emr.view"), treat: c.can("emr.treat") };
    var tabs = [];
    if (can.ic) tabs.push("ic", "sap");
    if (can.ic || can.lab) tabs.push("abg");
    if (can.qa) tabs.push("audits", "drills");
    if (can.report || can.qa) tabs.push("adr");
    if (can.floor) tabs.push("stock");
    if (can.view) tabs.push("edret");
    if (!tabs.length) { el.innerHTML = head + '<div class="msg note">' + esc(T(c, "site.qual.noAccess", "Your role ({role}) holds none of the capabilities these pages need.", { role: st.who && st.who.role })) + "</div>"; return; }
    if (tabs.indexOf(g.tab) < 0) g.tab = tabs[0];
    var q = "?orgId=" + encodeURIComponent(st.orgId), month = g.month || "";
    el.innerHTML = head + '<div class="tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-qtab="' + t + '" aria-selected="' + (t === g.tab) + '">' + esc(tabLabel(c, t)) + "</button>"; }).join("") + '</div><div id="qBody"></div>';
    el.querySelectorAll("[data-qtab]").forEach(function (b) { b.onclick = function () { g.tab = b.getAttribute("data-qtab"); WSQ.render("quality"); }; });
    var body = document.getElementById("qBody");
    var set = function (html) { body.innerHTML = html; };
    var data = null;
    var paint = function () {
      var m = g.tab === "abg" ? "" : monthRow(c, "qMonth", month);
      if (g.tab === "ic") set(m + icHtml(c, data));
      else if (g.tab === "sap") set(m + sapHtml(c, data));
      else if (g.tab === "abg") set('<div class="row"><label class="f"><span>' + esc(T(c, "site.qual.from", "From")) + '</span><input id="qAbFrom" type="date" value="' + esc(g.from || "") + '"></label><label class="f"><span>' + esc(T(c, "site.qual.to", "To")) + '</span><input id="qAbTo" type="date" value="' + esc(g.to || "") + '"></label><button class="btn quiet" type="button" data-q="abg">' + esc(T(c, "site.qual.show", "Show")) + "</button></div>" + abgHtml(c, data));
      else if (g.tab === "audits") set(m + auditsHtml(c, data, g.templateId));
      else if (g.tab === "drills") set(m + drillsHtml(c, data));
      else if (g.tab === "adr") set((can.qa ? m : "") + adrHtml(c, can.report, can.qa ? data : undefined));
      else if (g.tab === "stock") set(m + stockHtml(c, data));
      else set(m + edHtml(c, data, can.treat));
    };
    var load = function () {
      data = null; paint();
      if (g.tab === "adr" && !can.qa) return;
      var extra = g.tab === "abg" ? "&from=" + encodeURIComponent(g.from || "") + "&to=" + encodeURIComponent(g.to || "") : "&month=" + encodeURIComponent(month);
      c.api("/ward/" + TAB_ROUTE[g.tab] + q + extra).then(function (r) { data = r && r.ok ? r : (r || { ok: false }); paint(); }, function () { data = { ok: false }; paint(); });
    };
    load();
    var msg = function (r) { var box = document.getElementById("qMsg"); if (box) box.innerHTML = '<div class="msg err">' + TS(c, "site.qual.notSaved", "Not saved.") + " " + EN(c, esc((r && (r.detail || r.message || r.error)) || T(c, "site.qual.noResponse", "No response from the server."))) + "</div>"; };
    var after = function (okText) { return function (r) { if (!r || !r.ok) { msg(r); return; } var box = document.getElementById("qMsg"); if (box) box.innerHTML = ""; c.toast(okText); load(); }; };
    var post = function (path, b, okText) { return c.api(path, Object.assign({ orgId: st.orgId }, b)).then(after(okText), function () { msg(null); }); };
    var lines = function (id) { return val(id).split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
    var find = function (list, key, id) { for (var i = 0; i < (list || []).length; i++) if (list[i][key] === id) return list[i]; return null; };
    body.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-q]"); if (!b) return;
      var act = b.getAttribute("data-q"), id = b.getAttribute("data-id");
      if (act === "month") { month = g.month = val(b.getAttribute("data-for")); return load(); }
      if (act === "abg") { g.from = val("qAbFrom"); g.to = val("qAbTo"); return load(); }
      if (act === "open") {
        var event = val("qEvent"), isSsi = event === "SSI", link = isSsi ? find(data && data.operations, "caseId", val("qOp")) : find(data && data.lines, "lineId", val("qLine"));
        return post("/ward/hai-case", { action: "open", event: event, dateOfEvent: val("qDoe"), patientId: link ? link.patientId : "", lineId: isSsi ? "" : val("qLine"), surgicalCaseId: isSsi ? val("qOp") : "",
          ssiDepth: val("qDepth"), surveillanceDays: val("qPeriod") ? Number(val("qPeriod")) : null, note: val("qNote") }, T(c, "site.qual.hai.opened", "Case opened for review."));
      }
      if (act === "confirm") {
        var crit = [], boxes = body.querySelectorAll('[id^="qCr-' + id + '-"]');
        for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) crit.push(boxes[i].getAttribute("data-crit"));
        return post("/ward/hai-case", { action: "confirm", caseId: id, criteriaMet: crit, organisms: lines("qOrg-" + id), eligibilityNote: val("qElig-" + id) }, T(c, "site.qual.hai.confirmedToast", "Case confirmed."));
      }
      if (act === "ruleout" || act === "withdraw") return post("/ward/hai-case", { action: act === "ruleout" ? "rule-out" : "withdraw", caseId: id, reason: val("qWhy-" + id) }, T(c, "site.qual.saved", "Saved."));
      if (act === "sap") return post("/ward/surgical-prophylaxis", { caseId: id, indicated: val("qInd-" + id) === "yes", agentPerPolicy: val("qAgent-" + id) }, T(c, "site.qual.saved", "Saved."));
      if (act === "template") return post("/ward/audit-template", { name: val("qTplName"), kind: val("qTplKind"), items: lines("qTplItems") }, T(c, "site.qual.saved", "Saved."));
      if (act === "audit") {
        var tpl = find(data && data.templates, "id", id), answers = {};
        (tpl ? tpl.items : []).forEach(function (it) { ["yes", "no", "na"].forEach(function (a) { if (checked("qAns-" + it.id + "-" + a)) answers[it.id] = a; }); });
        return post("/ward/quality-audit", { templateId: id, at: isoFromLocal(val("qAuAt")) || undefined, unit: val("qAuUnit"), mrn: val("qAuMrn"), answers: answers,
          department: tpl && tpl.kind === "diagnostic-safety" ? val("qAuDept") : undefined, auditorOutside: tpl && tpl.kind === "diagnostic-safety" && val("qAuOutside") ? val("qAuOutside") === "yes" : undefined }, T(c, "site.qual.saved", "Saved."));
      }
      if (act === "drill") return post("/ward/mock-drill", { drillType: val("qDrType"), at: isoFromLocal(val("qDrAt")), location: val("qDrLoc"), participants: val("qDrPeople"), scenario: val("qDrScen"), variations: lines("qDrVar"), correctiveActions: val("qDrAct") }, T(c, "site.qual.saved", "Saved."));
      if (act === "adr") {
        var meds = [0, 1, 2].filter(function (n) { return val("qAdrMed" + n); }).map(function (n) { return { name: val("qAdrMed" + n), dose: val("qAdrDose" + n), actionTaken: val("qAdrAct" + n), reappeared: val("qAdrRe" + n) }; });
        return post("/ward/adr-report", { mrn: val("qAdrMrn"), reaction: { description: val("qAdrDesc"), startDate: val("qAdrStart"), stopDate: val("qAdrStop"), serious: val("qAdrSerious") === "yes", seriousCriteria: val("qAdrCrit") ? [val("qAdrCrit")] : [], outcome: val("qAdrOutcome") },
          medicines: meds, concomitant: val("qAdrCon"), relevantTests: val("qAdrTests") }, T(c, "site.qual.adr.filed", "Report filed."));
      }
      if (act === "stockout") return post("/ward/stock-out", { medicine: val("qSoMed"), location: val("qSoLoc"), occurredAt: isoFromLocal(val("qSoAt")) || undefined }, T(c, "site.qual.saved", "Saved."));
      if (act === "restore") return post("/ward/stock-out-restore", { stockOutId: id }, T(c, "site.qual.saved", "Saved."));
      if (act === "edsimilar" || act === "ednot") return post("/ward/ed-return-review", { encounterId: id, similar: act === "edsimilar", note: val("qEdNote-" + id) }, T(c, "site.qual.saved", "Saved."));
    };
    body.onchange = function (ev) { if (ev.target && ev.target.id === "qTpl") { g.templateId = ev.target.value; paint(); } };
  } });

  WSQ._quality = { icHtml: icHtml, sapHtml: sapHtml, abgHtml: abgHtml, auditsHtml: auditsHtml, drillsHtml: drillsHtml, adrHtml: adrHtml, stockHtml: stockHtml, edHtml: edHtml };
})();
