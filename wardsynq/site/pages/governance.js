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
      notices: T(c, "site.gov.tab.notices", "Privacy notices"), retention: T(c, "site.gov.tab.retention", "Retention and legal holds"), nabh: T(c, "site.gov.tab.nabh", "NABH indicators"),
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
    if (c.can("dpdp.manage") || c.can("register.records")) tabs.push("retention");
    if (c.can("analytics.view")) tabs.push("nabh", "hmis");
    if (c.can("staff.admin")) tabs.push("dhs", "reports");
    if (!tabs.length) { el.innerHTML = head + '<div class="msg note">' + esc(T(c, "site.gov.noAccess", "Your role ({role}) includes none of dpdp.manage, analytics.view or staff.admin, which these pages need.", { role: st.who && st.who.role })) + "</div>"; return; }
    if (tabs.indexOf(g.tab) < 0) g.tab = tabs[0];
    el.innerHTML = head + '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-gtab="' + t + '" aria-selected="' + (t === g.tab) + '">' + esc(tabLabel(c, t)) + "</button>";
    }).join("") + '</div><div id="govBody"></div>';
    onAll(el, "data-gtab", function (b) { g.tab = b.getAttribute("data-gtab"); WSQ.render("governance"); });
    var body = document.getElementById("govBody");
    ({ requests: requestsTab, breaches: breachesTab, notices: noticesTab, retention: retentionTab, nabh: nabhTab, hmis: hmisTab, dhs: dhsTab, reports: reportsTab })[g.tab](c, body, g);
  } });

  /* ---------------------------------------------------------------- the law in force (privacy-law.js) */
  /* Which regime applies today and when the DPDP duties start, from the server (legal opinion of 17 Sep 2026, section
   * A). Dates are server values; the sentences around them are translated. */
  function lawHtml(c, law) {
    var esc = c.esc;
    if (!law) return "";
    var day = function (d) { var t = Date.parse(d + "T00:00:00+05:30"); return isFinite(t) ? new Date(t).toLocaleDateString() : d; };
    return '<div class="card"><h2>' + esc(T(c, "site.gov.law.title", "Which privacy law applies")) + "</h2>" +
      '<div class="msg ' + (law.dpdpInForce ? "ok" : "warn") + '">' + esc(law.dpdpInForce
        ? T(c, "site.gov.law.dpdpNow", "The DPDP Act 2023 and DPDP Rules 2025 apply to this hospital from {date}. The SPDI Rules 2011 and CERT-In duties are kept alongside.", { date: day(law.dpdpStart) })
        : T(c, "site.gov.law.spdiNow", "Today the IT Act s.43A with the SPDI Rules 2011 and the CERT-In Directions 2022 apply. The DPDP Act duties of a hospital (notice, consent, security, breach, rights, children) start on {date}.", { date: day(law.dpdpStart) })) + "</div>" +
      '<div class="kv"><dt>' + esc(T(c, "site.gov.law.published", "DPDP Rules published")) + "</dt><dd>" + esc(day(law.published)) + " " + EN(c, esc("(G.S.R. 843(E), G.S.R. 846(E))")) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.law.cm", "Consent Manager rules (r.4)")) + "</dt><dd>" + esc(day(law.consentManagerStart)) + " &middot; " + esc(law.consentManagersInForce ? T(c, "site.gov.law.inForce", "in force") : T(c, "site.gov.law.notYet", "not yet in force")) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.law.hospital", "Hospital duties (ss.3-17, rules 3, 5-16)")) + "</dt><dd>" + esc(day(law.dpdpStart)) + " &middot; " + esc(law.dpdpInForce ? T(c, "site.gov.law.inForce", "in force") : T(c, "site.gov.law.notYet", "not yet in force")) +
      (law.dpdpStartSource === "hospital" ? " " + esc(T(c, "site.gov.law.earlier", "(brought forward by this hospital)")) : "") + "</dd></div>" +
      '<p class="quiet">' + esc(T(c, "site.gov.law.dayNote", "The gazette is dated 13 November 2025 and was published on the 14th; the earlier day is counted. This is legal research awaiting a practising lawyer's review, not legal advice.")) + "</p></div>";
  }

  /* Act s.5(2): patients given the notice before DPDP commencement are given a fresh one. Before commencement the list is
   * not open; a failed read says so and never looks like nobody. */
  function renoticeHtml(c, rn) {
    var esc = c.esc;
    if (rn === false) return '<div class="msg err">' + esc(T(c, "site.gov.rn.failed", "The list of patients due a fresh notice could not be read. This is not the same as there being none.")) + "</div>";
    if (!rn || !rn.open) return "";
    return '<div class="card"><h2>' + esc(T(c, "site.gov.rn.title", "Fresh notice due (DPDP Act s.5(2))")) + "</h2>" +
      (rn.patients.length ? "<p>" + esc(T(c, "site.gov.rn.count", "{n} patients were last given the notice before {date}. Give each the current notice when they are next seen.", { n: rn.patients.length, date: rn.from })) + '</p><ul class="quiet">' +
        rn.patients.slice(0, 50).map(function (p) { return "<li>" + EN(c, esc(p.patientId)) + " &middot; " + esc(dt(p.lastAcknowledgedAt)) + "</li>"; }).join("") + "</ul>"
        : '<p class="quiet">' + esc(T(c, "site.gov.rn.none", "No patient's last notice predates DPDP commencement.")) + "</p>") + "</div>";
  }

  /* ---------------------------------------------------------------- data principal requests */
  function clocksHtml(c, k) {
    var esc = c.esc, d = (k && k.responseDays) || {}, src = (k && k.responseSource) || {}, law = (k && k.law) || {};
    var srcWord = function (s) { return s === "hospital" ? T(c, "site.gov.clocks.hospitalSet", "set by this hospital") : T(c, "site.gov.clocks.default", "default"); };
    var out = '<div class="card"><h2>' + esc(T(c, "site.gov.clocks.title", "Answer times")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.gov.clocks.rule", "Before {date} every request is answered within the SPDI grievance time (one month, at most 30 days). From {date} each kind of request has its DPDP time (at most 90 days). A hospital may set a shorter time, never a longer one.", { date: law.dpdpStart || "" })) + "</p>" +
      '<div class="kv"><dt>' + esc(T(c, "site.gov.clocks.spdi", "Today, every request (SPDI Rules 2011 r.5(9))")) + "</dt><dd>" + esc(T(c, "site.gov.clocks.days", "{n} days", { n: k && k.spdiDays })) + "</dd>" +
      KINDS.map(function (x) { return "<dt>" + esc(kindLabel(c, x)) + " " + esc(T(c, "site.gov.clocks.fromDpdp", "(from DPDP commencement)")) + "</dt><dd>" + esc(T(c, "site.gov.clocks.days", "{n} days", { n: d[x] })) + " &middot; " + esc(srcWord(src[x])) + "</dd>"; }).join("") +
      "<dt>" + esc(T(c, "site.gov.clocks.certIn", "Breach: report to CERT-In within (in force now)")) + "</dt><dd>" + esc(T(c, "site.gov.clocks.hours", "{n} hours", { n: k && k.certInHours })) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.clocks.boardDetailed", "Breach: detailed report to the Data Protection Board within (from DPDP commencement)")) + "</dt><dd>" + esc(T(c, "site.gov.clocks.hours", "{n} hours", { n: k && k.boardDetailedHours })) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.clocks.principalsTarget", "Breach: tell each affected patient within (hospital policy; the law says without delay)")) + "</dt><dd>" + esc(T(c, "site.gov.clocks.hours", "{n} hours", { n: k && k.breachPrincipalHours })) + " &middot; " + esc(srcWord(k && k.breachPrincipalSource)) + "</dd></div>" +
      '<p class="quiet">' + EN(c, esc(k && k.citations ? [k.citations.spdi, k.citations.dpdp, k.citations.certIn, k.citations.board].join(" ") : "")) + "</p>";
    if (c.can("staff.admin")) {
      out += '<div class="row">' + KINDS.map(function (x) {
        return '<label class="f"><span>' + esc(kindLabel(c, x)) + '</span><input id="gClk_' + x + '" type="number" min="1" max="90" value="' + esc(src[x] === "hospital" ? d[x] : "") + '"></label>';
      }).join("") +
        '<label class="f"><span>' + esc(T(c, "site.gov.clocks.principalHours", "Patients, hours")) + '</span><input id="gClkPrin" type="number" min="1" max="720" value="' + esc(k && k.breachPrincipalSource === "hospital" ? k.breachPrincipalHours : "") + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.clocks.principalReason", "Reason, if more than 72 hours")) + '</span><input id="gClkPrinWhy" value="' + esc((k && k.breachPrincipalHoursReason) || "") + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.clocks.startDate", "Apply DPDP from (only earlier than 13 May 2027)")) + '</span><input id="gClkStart" type="date" min="2025-11-13" max="2027-05-13" value="' + esc(law.dpdpStartSource === "hospital" ? law.dpdpStart : "") + '"></label>' +
        '<button class="btn" type="button" id="gClkSave">' + esc(T(c, "site.gov.clocks.save", "Save answer times")) + "</button></div>";
    }
    return out + '<div id="gClkMsg"></div></div>';
  }

  /* The basis of a retention layer (owner's guidance 17 Sep 2026): only an identified statutory provision is "required
   * by law"; an office memorandum, a guideline or the hospital's own period is policy. */
  function basisPill(c, type) {
    if (type === "LEGAL_OBLIGATION") return '<span class="pill stop">' + c.esc(T(c, "site.gov.ret.basis.legal", "Required by law")) + "</span>";
    if (type === "RETENTION_POLICY") return '<span class="pill warn">' + c.esc(T(c, "site.gov.ret.basis.policy", "Hospital retention policy, not a legal requirement")) + "</span>";
    return '<span class="pill">' + c.esc(T(c, "site.gov.ret.basis.none", "No retention period running")) + "</span>";
  }
  /* Why a layer keeps nothing today, from the registry (legal-requirements.js enforcement): a stayed or struck-down law
   * is not "not yet in force". An answer recorded before the reason was stored says only that it is not in force. */
  function notInForceWord(c, reason) {
    return reason === "not-yet-effective" ? T(c, "site.gov.ret.notInForce", "(not yet in force)")
      : reason === "stayed" ? T(c, "site.gov.ret.stayed", "(stayed by a court)")
      : reason === "struck-down" ? T(c, "site.gov.ret.struckDown", "(struck down by a court)")
      : reason === "expired" ? T(c, "site.gov.ret.expired", "(expired)")
      : T(c, "site.gov.ret.notInForceNow", "(not in force)");
  }
  function dday(iso) { var t = Date.parse(iso || ""); return isFinite(t) ? new Date(t).toLocaleDateString() : ""; }
  /* Each retention class the patient has records in, what keeps it today and until when, each layer's instrument and
   * provision, and the DPO's decision where the policy alone kept it (legal opinion H.4.5). Instruments, provisions
   * and dates are server values. An answer recorded before the basis was stored shows its rule only. */
  function retainedHtml(c, classes) {
    var esc = c.esc;
    if (!classes || !classes.length) return "";
    return '<ul class="quiet">' + classes.map(function (x) {
      var until = x.keepUntil ? dday(x.keepUntil) : T(c, "site.gov.ret.lifeOfRecord", "for the life of the record it belongs to");
      var head = "<li><b>" + EN(c, esc(x["class"])) + "</b>: " + esc(T(c, "site.gov.ret.until", "kept until {date}", { date: until })) +
        (x.untilProceedingsEnd ? " " + esc(T(c, "site.gov.ret.orProceedings", "or until any court proceedings end, whichever is later")) : "") +
        (x.minorRule ? " " + esc(T(c, "site.gov.ret.minor", "(a child's record: at least {n} years after turning 18)", { n: x.minorRule })) : "");
      if (!x.bases) return head + '<br><span class="quiet">' + EN(c, esc(x.rule)) + "</span></li>";
      return head + " " + basisPill(c, x.basisType) +
        (x.legalUntil ? "<br>" + esc(T(c, "site.gov.ret.legalUntil", "Required by law until {date}", { date: dday(x.legalUntil) })) : "") +
        '<ul class="quiet">' + x.bases.map(function (b) {
          return "<li>" + basisPill(c, b.type) + " " + EN(c, esc(b.instrument + ", " + b.provision)) + (b.until ? " &middot; " + esc(T(c, "site.gov.ret.layerUntil", "until {date}", { date: dday(b.until) })) : "") +
            (b.inForce === false ? " " + esc(notInForceWord(c, b.notInForce)) : "") + "</li>";
        }).join("") + "</ul>" +
        (x.decision ? "<p>" + esc(x.decision.decision === "retain" ? T(c, "site.gov.ret.decRetain", "The DPO decided to retain it:") : T(c, "site.gov.ret.decErase", "The DPO decided to erase it:")) + " " + EN(c, esc(x.decision.reason)) +
          (x.decision.destructionReference ? " &middot; " + esc(T(c, "site.gov.ret.decDestroyed", "destruction record {ref}", { ref: x.decision.destructionReference })) : "") + "</p>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  /* From DPDP commencement: the DPO's decision for each class kept only by policy (dpdp.js retentionDecisionsOf). */
  function decisionsFormHtml(c, id, needed) {
    var esc = c.esc;
    return '<div class="msg warn"><b>' + esc(T(c, "site.gov.ret.decTitle", "Kept only under the hospital's retention policy: the DPO decides")) + "</b><p>" +
      esc(T(c, "site.gov.ret.decIntro", "These records are not kept by any law. For each, retain it and write the purpose or necessity, or erase it. WardSynQ does not erase a clinical record itself: the medical records officer destroys or de-identifies it, and the request is completed with the destruction record reference.")) + "</p>" +
      needed.map(function (x, i) {
        var k = id + "_" + i;
        return '<div class="card"><h3>' + EN(c, esc(x["class"])) + " " + basisPill(c, x.basisType) + "</h3>" + retainedHtml(c, [x]) + '<div class="row">' +
          '<label class="f"><span>' + esc(T(c, "site.gov.ret.decision", "Decision")) + '</span><select id="gDec_' + esc(k) + '" data-gdec-class="' + esc(x["class"]) + '"><option value="retain">' + esc(T(c, "site.gov.ret.decRetainOpt", "Retain")) + '</option><option value="erase">' + esc(T(c, "site.gov.ret.decEraseOpt", "Erase")) + "</option></select></label>" +
          '<label class="f"><span>' + esc(T(c, "site.gov.ret.decReason", "Purpose or necessity, or why it is erased (at least 10 characters)")) + '</span><input id="gDecWhy_' + esc(k) + '"></label>' +
          '<label class="f"><span>' + esc(T(c, "site.gov.ret.decRef", "Destruction record reference (erase only, once done)")) + '</span><input id="gDecRef_' + esc(k) + '"></label></div></div>';
      }).join("") +
      '<button class="btn" type="button" data-gdecide="' + esc(id) + '" data-n="' + needed.length + '">' + esc(T(c, "site.gov.ret.decSubmit", "Record decisions and complete")) + "</button></div>";
  }
  function holdsHtml(c, holds, patientId) {
    var esc = c.esc;
    if (!holds || !holds.length) return "";
    return '<div class="msg err"><b>' + esc(T(c, "site.gov.lh.title", "Legal hold: nothing can be erased or destroyed")) + "</b><ul>" + holds.map(function (x) {
      return "<li>" + EN(c, esc(x.reason + ": " + (x.reference || ""))) + " &middot; " + (x.auto ? esc(T(c, "site.gov.lh.auto", "set by the medico-legal case register")) : esc(T(c, "site.gov.lh.placed", "placed {when}", { when: dt(x.placedAt) }))) +
        (patientId ? ' <button class="btn quiet" type="button" data-glift="' + esc(x.id) + '" data-pid="' + esc(patientId) + '">' + esc(T(c, "site.gov.lh.lift", "Lift (medical records officer)")) + "</button>" : "") + "</li>";
    }).join("") + "</ul></div>";
  }

  function erasureHtml(c, e) {
    if (!e) return "";
    var esc = c.esc, list = function (xs) { return xs && xs.length ? EN(c, esc(xs.join(", "))) : esc(T(c, "site.gov.erasure.none", "none")); };
    return '<div class="kv">' +
      "<dt>" + esc(T(c, "site.gov.erasure.consents", "Consents withdrawn")) + "</dt><dd>" + list(e.consentsWithdrawn) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.removed", "Removed from the current record")) + "</dt><dd>" + list(e.removedFromCurrentRecord) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.registration", "Removed from the registration details")) + "</dt><dd>" + list(e.registrationDetailsRemoved) + "</dd>" +
      "<dt>" + esc(T(c, "site.gov.erasure.kept", "Kept")) + "</dt><dd>" + esc(T(c, "site.gov.erasure.keptWhy2", "The clinical record. Each class says whether a law keeps it, naming the law and provision (the Act allows this: s8(7), s12(3)), or only the hospital's retention policy, which is not a legal requirement.")) +
      retainedHtml(c, e.retained && e.retained.classes) + "</dd>" +
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
      (r.clock && r.clock.citation ? '<p class="quiet">' + esc(r.clock.regime === "dpdp-2025" ? T(c, "site.gov.req.clockDpdp", "Answer time under the DPDP Rules 2025:") : T(c, "site.gov.req.clockSpdi", "Answer time under the SPDI Rules 2011 (DPDP times apply to requests received from their commencement):")) + " " + EN(c, esc(r.clock.citation)) + "</p>" : "") +
      (r.response ? "<p><b>" + esc(T(c, "site.gov.req.answer", "Answer given")) + ":</b> " + EN(c, esc(r.response)) + "</p>" : "") +
      (r.responseContact ? '<p class="quiet">' + esc(T(c, "site.gov.req.contact", "The answer named the contact:")) + " " + EN(c, esc([r.responseContact.dpoContact, r.responseContact.grievanceContact].filter(Boolean).join("; "))) + "</p>" : "") +
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
        h = lawHtml(c, s.data.law) + renoticeHtml(c, s.data.renotice) + clocksHtml(c, s.data.clocks) +
          '<div class="card"><h2>' + esc(T(c, "site.gov.req.fileTitle", "Record a request")) + '</h2>' +
          '<p class="quiet">' + esc(T(c, "site.gov.req.copiesNote", "A request for copies of medical records by the patient, an authorised attendant or a legal authority is recorded as a release of information on the patient's chart, where its 72-hour clock runs (IMC Regulations 2002 reg 1.3.2).")) + '</p><div class="row">' +
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
        var dp = { responseDays: days, breachPrincipalHours: num("gClkPrin"), breachPrincipalHoursReason: val("gClkPrinWhy") || null, dpdpStartDate: val("gClkStart") || null };
        if (dp.breachPrincipalHours > 72 && dp.breachPrincipalHoursReason && dp.breachPrincipalHoursReason.length < 10 || dp.breachPrincipalHours > 72 && !dp.breachPrincipalHoursReason) {
          document.getElementById("gClkMsg").innerHTML = '<div class="msg err">' + esc(T(c, "site.gov.clocks.reasonNeeded", "More than 72 hours needs a reason of at least 10 characters; without one the 72-hour target is used.")) + "</div>"; return;
        }
        c.api("/org/update", { orgId: c.state.orgId, wardsynq: { dpdp: dp } }).then(function (r) {
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
      function act(b, id, action, decisions) {
        b.disabled = true;
        c.api("/ward/data-request-act", { orgId: c.state.orgId, requestId: id, action: action, response: val("gResp_" + id), retentionDecisions: decisions || undefined }).then(function (r) {
          b.disabled = false;
          /* From DPDP commencement a class kept only by policy needs the DPO's decision before anything is erased. */
          if (r && r.error === "retention_decision_required") {
            var db = document.getElementById("gHold_" + id);
            if (db) {
              db.innerHTML = decisionsFormHtml(c, id, r.decisionsNeeded || []);
              onAll(db, "data-gdecide", function (btn) {
                var out = [];
                for (var i = 0; i < Number(btn.getAttribute("data-n")); i++) {
                  var k = id + "_" + i, sel = document.getElementById("gDec_" + k);
                  out.push({ "class": sel.getAttribute("data-gdec-class"), decision: sel.value, reason: val("gDecWhy_" + k), destructionReference: val("gDecRef_" + k) });
                }
                act(btn, id, "complete", out);
              });
            }
            c.toast(T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, r) }));
            return;
          }
          if (!r || !r.ok) {
            // A partial erasure is written on the request and is shown by reloading it; the toast says it did not finish.
            c.toast(r && r.error === "erasure_partial" ? T(c, "site.gov.req.partial", "The erasure did not finish. The request stays open and shows what was and was not done.") : T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, r) }));
            if (r && r.error === "erasure_partial") load();
            /* A legal hold refuses the erasure outright; the holds and what is kept are shown on the request. */
            if (r && r.error === "legal_hold") { var hb = document.getElementById("gHold_" + id); if (hb) hb.innerHTML = holdsHtml(c, r.holds) + retainedHtml(c, r.retained); }
            return;
          }
          c.toast(T(c, "site.gov.req.saved", "Saved.")); load();
        });
      }
      onAll(body, "data-gact", function (b) {
        var id = b.getAttribute("data-id"), action = b.getAttribute("data-gact");
        if (action === "complete" && b.getAttribute("data-kind") === "erasure" && !confirm(T(c, "site.gov.req.eraseConfirm", "This withdraws the patient's consents other than for treatment, removes their ABHA link and optional registration details, and keeps the clinical record. Continue?"))) return;
        act(b, id, action, null);
      });
      onAll(body, "data-ghold", function (b) {
        var id = b.getAttribute("data-ghold"), pid = b.getAttribute("data-pid"), box = document.getElementById("gHold_" + id);
        box.innerHTML = loading(c, T(c, "site.gov.hold.loading", "Reading what the hospital holds..."));
        var pq = q(c) + "&patientId=" + encodeURIComponent(pid);
        Promise.all([c.api("/ward/data-holdings" + pq), c.api("/ward/privacy-acknowledgements" + pq)]).then(function (res) {
          var h = res[0], a = res[1], out = "";
          out += h && h.ok ? '<div class="kv">' + (h.holdings.length ? h.holdings.map(function (x) { return "<dt>" + EN(c, esc(x.type)) + "</dt><dd>" + esc(x.count) + "</dd>"; }).join("") : "<dt></dt><dd>" + esc(T(c, "site.gov.hold.none", "No records for this patient.")) + "</dd>") + "</div>"
            : failHtml(c, T(c, "site.gov.hold.failed", "What the hospital holds could not be read:"), h);
          if (h && h.ok) out += h.retention === false ? '<div class="msg err">' + esc(T(c, "site.gov.ret.unreadable", "What the law requires the hospital to keep could not be worked out. This is not the same as nothing being kept.")) + "</div>"
            : h.retention ? holdsHtml(c, h.retention.holds) + retainedHtml(c, h.retention.retained) : "";
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
  /* The five headings of what each affected patient is told (DPDP Rules 2025 r.7(1)(a) to (e)) and the five the hospital
   * writes in the detailed report to the Board (r.7(2)(b); the sixth, the intimations given, is filled by the server). */
  function principalHeadings(c) {
    return [["nature", T(c, "site.gov.br.pi.nature", "(a) The nature, extent and timing of the breach")], ["consequences", T(c, "site.gov.br.pi.consequences", "(b) The likely consequences for the patient")],
      ["mitigation", T(c, "site.gov.br.pi.mitigation", "(c) What the hospital has done to reduce the harm")], ["safetyMeasures", T(c, "site.gov.br.pi.safety", "(d) What the patient can do to protect themselves")],
      ["contact", T(c, "site.gov.br.pi.contact", "(e) Who to contact with questions")]];
  }
  function boardHeadings(c) {
    return [["facts", T(c, "site.gov.br.bh.facts", "Updated facts: nature, extent, timing, location and impact")], ["circumstances", T(c, "site.gov.br.bh.circumstances", "The circumstances and reasons")],
      ["mitigation", T(c, "site.gov.br.bh.mitigation", "Measures taken to mitigate the risk")], ["findings", T(c, "site.gov.br.bh.findings", "Findings about the person who caused the breach")],
      ["remedial", T(c, "site.gov.br.bh.remedial", "Remedial measures to prevent a repeat")]];
  }
  function breachHtml(c, b) {
    var esc = c.esc, open = b.state !== "closed" && b.state !== "withdrawn";
    var clock = function (label, due, doneAt, late, notInForce) {
      return "<dt>" + esc(label) + "</dt><dd>" + (doneAt ? esc(T(c, "site.gov.br.toldAt", "Told {when}", { when: dt(doneAt) })) : esc(T(c, "site.gov.br.notYet", "Not yet"))) +
        (due ? " &middot; " + esc(T(c, "site.gov.br.dueBy", "due by {when}", { when: dt(due) })) : notInForce ? " &middot; " + esc(T(c, "site.gov.br.boardNotInForce", "no Board duty: the hospital became aware before DPDP commencement")) : "") +
        (late ? ' <span class="pill stop">' + esc(T(c, "site.gov.br.late", "Late")) + "</span>" : "") + "</dd>";
    };
    var list = function (o, heads) { return o ? heads.map(function (x) { return o[x[0]] ? "<b>" + esc(x[1]) + ":</b> " + EN(c, esc(o[x[0]])) : ""; }).filter(Boolean).join("<br>") : ""; };
    var h = '<div class="card"><h3>' + esc(T(c, "site.gov.br.detected", "Found {when}", { when: dt(b.detectedAt) })) + ' <span class="pill' + (open ? " warn" : " ok") + '">' + esc(b.state === "withdrawn" ? T(c, "site.gov.br.withdrawn", "Not a personal data breach (confirmed by a second person)") : stateLabel(c, b.state)) + "</span></h3>" +
      "<p>" + EN(c, esc(b.description)) + "</p>" +
      '<div class="kv">' +
      (b.awareAt && b.awareAt !== b.detectedAt ? "<dt>" + esc(T(c, "site.gov.br.aware", "Hospital became aware")) + "</dt><dd>" + esc(dt(b.awareAt)) + "</dd>" : "") +
      (b.affectedCount != null ? "<dt>" + esc(T(c, "site.gov.br.affected", "People affected")) + "</dt><dd>" + esc(b.affectedCount) + "</dd>" : "") +
      (b.dataCategories && b.dataCategories.length ? "<dt>" + esc(T(c, "site.gov.br.categories", "Data involved")) + "</dt><dd>" + EN(c, esc(b.dataCategories.join(", "))) + "</dd>" : "") +
      clock(T(c, "site.gov.br.certIn", "CERT-In (6 hours, in force now)"), b.certInDueBy, b.certInReportedAt, b.certInLate) +
      (b.boardInitialAt ? "<dt>" + esc(T(c, "site.gov.br.boardInitial", "Board first told (without delay)")) + "</dt><dd>" + esc(dt(b.boardInitialAt)) + "</dd>" : "") +
      clock(T(c, "site.gov.br.boardDetailed", "Data Protection Board, detailed report (72 hours)"), b.boardExtendedTo || b.boardDetailedDueBy || b.boardDueBy, b.boardNotifiedAt, b.boardLate, b.boardDuty === false) +
      (b.boardExtendedTo ? "<dt>" + esc(T(c, "site.gov.br.extension", "Board extension")) + "</dt><dd>" + EN(c, esc(b.boardExtensionRef || "")) + "</dd>" : "") +
      clock(T(c, "site.gov.br.principals2", "Affected patients (hospital target)"), b.principalsDueBy, b.principalsNotifiedAt, b.principalsLate) +
      "<dt>" + esc(T(c, "site.gov.br.assessment", "Assessment")) + "</dt><dd>" + (b.assessment ? EN(c, esc(b.assessment.text)) : esc(T(c, "site.gov.br.notAssessed", "Not assessed yet"))) + "</dd>" +
      (b.principalIntimation ? "<dt>" + esc(T(c, "site.gov.br.toldPatients", "What the patients were told")) + "</dt><dd>" + list(b.principalIntimation, principalHeadings(c)) + "</dd>" : "") +
      (b.boardReport ? "<dt>" + esc(T(c, "site.gov.br.boardReport", "Report to the Board")) + "</dt><dd>" + list(b.boardReport, boardHeadings(c)) + "<br><b>" + esc(T(c, "site.gov.br.bh.intimations", "Report on the intimations given")) + ":</b> " + EN(c, esc(b.boardReport.intimations)) + "</dd>" : "") +
      (b.notBreachProposal ? "<dt>" + esc(T(c, "site.gov.br.notBreach", "Proposed as not a personal data breach")) + "</dt><dd>" + EN(c, esc(b.notBreachProposal.reasons)) + "</dd>" : "") +
      ((b.actions || []).length ? "<dt>" + esc(T(c, "site.gov.br.actions", "Actions")) + "</dt><dd>" + b.actions.map(function (a) { return EN(c, esc(dt(a.at) + ": " + a.text)); }).join("<br>") + "</dd>" : "") +
      "</div>";
    if (open) {
      var id = esc(b.id);
      var area = function (key, label) { return '<label class="f"><span>' + esc(label) + '</span><textarea rows="2" id="gBr' + key + "_" + id + '"></textarea></label>'; };
      h += '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.br.event", "Record")) + '</span><select id="gBrEv_' + id + '">' +
        '<option value="assess">' + esc(T(c, "site.gov.br.ev.assess", "Assessment")) + "</option>" +
        '<option value="cert-in-reported">' + esc(T(c, "site.gov.br.ev.certIn", "CERT-In was told")) + "</option>" +
        '<option value="board-initial">' + esc(T(c, "site.gov.br.ev.boardInitial", "The Board was first told")) + "</option>" +
        '<option value="board-notified">' + esc(T(c, "site.gov.br.ev.boardDetailed", "The detailed report went to the Board")) + "</option>" +
        '<option value="board-extension">' + esc(T(c, "site.gov.br.ev.extension", "The Board allowed more time")) + "</option>" +
        '<option value="principals-notified">' + esc(T(c, "site.gov.br.ev.principals", "Affected patients were told")) + "</option>" +
        '<option value="action">' + esc(T(c, "site.gov.br.ev.action", "An action taken")) + "</option>" +
        '<option value="not-a-breach">' + esc(T(c, "site.gov.br.ev.notBreach", "Propose: not a personal data breach")) + "</option>" +
        (b.notBreachProposal ? '<option value="confirm-not-a-breach">' + esc(T(c, "site.gov.br.ev.confirmNotBreach", "Confirm: not a personal data breach (a second person)")) + "</option>" : "") +
        '<option value="close">' + esc(T(c, "site.gov.br.ev.close", "Close the breach")) + "</option></select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.when", "When it happened (for a notification)")) + '</span><input type="datetime-local" id="gBrAt_' + id + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.count", "Patients told")) + '</span><input type="number" min="0" id="gBrN_' + id + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.extendedTo", "Board's new date (extension only)")) + '</span><input type="datetime-local" id="gBrExt_' + id + '"></label></div>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.text2", "Details: the assessment, the CERT-In or Board reference, what the Board was first told, how patients were told, the action, why it is not a breach, or the closing summary")) + '</span><textarea rows="3" id="gBrT_' + id + '"></textarea></label>' +
        "<details><summary>" + esc(T(c, "site.gov.br.piTitle", "What the patients were told (DPDP Rules 2025 r.7(1), all five)")) + "</summary>" +
        principalHeadings(c).map(function (x) { return area("Pi" + x[0], x[1]); }).join("") + "</details>" +
        "<details><summary>" + esc(T(c, "site.gov.br.bhTitle", "Detailed report to the Board (DPDP Rules 2025 r.7(2)(b))")) + "</summary>" +
        boardHeadings(c).map(function (x) { return area("Bh" + x[0], x[1]); }).join("") + "</details>" +
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
      body.innerHTML = lawHtml(c, s.data.law) + '<div class="card"><h2>' + esc(T(c, "site.gov.br.recordTitle", "Record a personal data breach")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.br.law2", "Report a cyber security incident, including a data breach, to CERT-In within 6 hours of noticing it (in force now). From DPDP commencement the Data Protection Board is told without delay and sent a detailed report within 72 hours of becoming aware, and each affected patient is told without delay. There is no 'not notifiable' state: a record is withdrawn only as not a personal data breach, confirmed by a second person. Do not write the breached personal data itself here.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.br.foundAt", "Found at")) + '</span><input type="datetime-local" id="gBrFound"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.awareAt", "Hospital became aware at (if later)")) + '</span><input type="datetime-local" id="gBrAware"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.affected", "People affected")) + '</span><input type="number" min="0" id="gBrCount"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.categoriesInput", "Data involved, separated by commas")) + '</span><input id="gBrCats"></label></div>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.br.what", "What happened")) + '</span><textarea rows="3" id="gBrDesc"></textarea></label>' +
        '<button class="btn" type="button" id="gBrRecord">' + esc(T(c, "site.gov.br.record", "Record breach")) + '</button><div id="gBrMsg"></div></div>' +
        (s.data.breaches.length ? s.data.breaches.map(function (b) { return breachHtml(c, b); }).join("") : '<p class="quiet">' + esc(T(c, "site.gov.br.none", "No breaches have been recorded.")) + "</p>");
      on("gBrRecord", function () {
        var cats = val("gBrCats").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
        c.api("/ward/data-breach", { orgId: c.state.orgId, detectedAt: isoFromLocal(val("gBrFound")), awareAt: isoFromLocal(val("gBrAware")) || undefined, affectedCount: val("gBrCount"), dataCategories: cats, description: val("gBrDesc") }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gBrMsg").innerHTML = failHtml(c, T(c, "site.gov.br.notRecorded", "Breach not recorded:"), r); return; }
          c.toast(T(c, "site.gov.br.recorded", "Breach recorded.")); load();
        });
      });
      onAll(body, "data-gbr", function (b) {
        var id = b.getAttribute("data-gbr"), ev = val("gBrEv_" + id), text = val("gBrT_" + id);
        var p = { orgId: c.state.orgId, breachId: id, event: ev, at: isoFromLocal(val("gBrAt_" + id)), count: val("gBrN_" + id) === "" ? null : Number(val("gBrN_" + id)) };
        var group = function (prefix, heads) { var o = {}; heads.forEach(function (x) { o[x[0]] = val("gBr" + prefix + x[0] + "_" + id); }); return o; };
        if (ev === "assess") p.assessment = text;
        else if (ev === "cert-in-reported") p.reference = text;
        else if (ev === "board-initial" || ev === "action") p.text = text;
        else if (ev === "board-notified") { p.reference = text; p.report = group("Bh", boardHeadings(c)); }
        else if (ev === "board-extension") { p.reference = text; p.extendedTo = isoFromLocal(val("gBrExt_" + id)); }
        else if (ev === "principals-notified") { p.method = text; p.intimation = group("Pi", principalHeadings(c)); }
        else if (ev === "not-a-breach") p.reasons = text;
        else p.summary = text;
        b.disabled = true;
        c.api("/ward/data-breach-update", p).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) {
            /* Which notification or heading is missing is said in words, never left as a code. */
            var extra = r && r.missing ? " " + T(c, "site.gov.br.missing", "Still to record: {list}.", { list: r.missing.join(", ") }) : r && r.part ? " " + T(c, "site.gov.br.part", "Missing: {part}.", { part: r.part }) : "";
            c.toast(T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, r) }) + extra); return;
          }
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
  /* The parts a notice must itemise before the server publishes it (dpdp.js NOTICE_PARTS: DPDP Rules 2025 r.3, SPDI Rules
   * 2011 r.5(3)). The Board complaint line is required from DPDP commencement. */
  function noticeParts(c) {
    return [["dataItems", T(c, "site.gov.nt.p.data", "The personal data collected, item by item")], ["purposes", T(c, "site.gov.nt.p.purposes", "Why: the specific services or uses")],
      ["withdrawConsent", T(c, "site.gov.nt.p.withdraw", "How to withdraw consent, as easily as it was given")], ["rights", T(c, "site.gov.nt.p.rights", "How to ask for access, correction, erasure or a nominee")],
      ["recipients", T(c, "site.gov.nt.p.recipients", "Who the data is shared with")], ["collectingAgency", T(c, "site.gov.nt.p.agency", "The hospital's name and address")],
      ["boardComplaint", T(c, "site.gov.nt.p.board", "How to complain to the Data Protection Board (required from DPDP commencement)")]];
  }
  function noticesTab(c, body, g) {
    var s = g.nt || (g.nt = { list: null });
    var esc = c.esc;
    function paint() {
      if (s.list === null) { body.innerHTML = loading(c, T(c, "site.gov.nt.loading", "Loading privacy notices...")); return; }
      if (s.list === false) { body.innerHTML = failHtml(c, T(c, "site.gov.nt.loadFailed", "Privacy notices could not be loaded:"), s.fail); return; }
      body.innerHTML = lawHtml(c, s.law) + '<div class="card"><h2>' + esc(T(c, "site.gov.nt.publishTitle", "Write or update a notice")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.nt.s5b", "Each part below is required before the notice is published: the data item by item, the purposes, withdrawal, the rights, the recipients and the hospital's name and address (DPDP Rules 2025 r.3; SPDI Rules 2011 r.5(3)), and the Data Protection Officer or Grievance Officer contact. Write it in English or a language of the Eighth Schedule. Publishing again makes a new version; patients acknowledge a version. From DPDP commencement, patients given a notice before then need a fresh one (s.5(2)).")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.nt.language", "Language")) + '</span><select id="gNtLang">' + opts(LANGS, function (x) { return EN(c, esc(x)); }, s.lang) + "</select></label>" +
        '<label class="f"><span>' + esc(T(c, "site.gov.nt.titleLabel", "Title")) + '</span><input id="gNtTitle"></label></div>' +
        noticeParts(c).map(function (x) { return '<label class="f"><span>' + esc(x[1]) + '</span><textarea rows="3" id="gNtP_' + x[0] + '"></textarea></label>'; }).join("") +
        '<label class="f"><span>' + esc(T(c, "site.gov.nt.textOptional", "Anything else the notice says (optional)")) + '</span><textarea rows="4" id="gNtText"></textarea></label>' +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.nt.dpo2", "Data Protection Officer or Grievance Officer contact (published)")) + '</span><input id="gNtDpo"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.gov.nt.grievance", "Grievance contact")) + '</span><input id="gNtGriev"></label>' +
        '<button class="btn" type="button" id="gNtPublish">' + esc(T(c, "site.gov.nt.publish", "Publish")) + '</button></div><div id="gNtMsg"></div></div>' +
        (s.list.length ? s.list.map(function (n) {
          return '<div class="card"><h3>' + EN(c, esc(n.language + " v" + n.version + (n.title ? ": " + n.title : ""))) + "</h3>" +
            '<p class="quiet">' + esc(T(c, "site.gov.nt.published", "Published {when}", { when: dt(n.publishedAt) })) + " &middot; " + EN(c, esc(n.dpoContact)) + "</p>" +
            (n.dataItems ? '<div class="kv">' + noticeParts(c).map(function (x) { return n[x[0]] ? "<dt>" + esc(x[1]) + '</dt><dd style="white-space:pre-wrap">' + EN(c, esc(n[x[0]])) + "</dd>" : ""; }).join("") + "</div>"
              : '<div class="msg warn">' + esc(T(c, "site.gov.nt.oldVersion", "This version was published before the itemised parts were required. Publish it again with each part.")) + "</div>") +
            (n.text ? '<p style="white-space:pre-wrap">' + EN(c, esc(n.text)) + "</p>" : "") +
            '<button class="btn quiet" type="button" data-gedit="' + esc(n.language) + '">' + esc(T(c, "site.gov.nt.edit", "Edit this notice")) + "</button></div>";
        }).join("") : '<p class="quiet">' + esc(T(c, "site.gov.nt.none", "No privacy notice is published. Patients cannot be given one until it is.")) + "</p>");
      onAll(body, "data-gedit", function (b) {
        var n = s.list.filter(function (x) { return x.language === b.getAttribute("data-gedit"); })[0]; if (!n) return;
        document.getElementById("gNtLang").value = n.language; document.getElementById("gNtTitle").value = n.title || "";
        document.getElementById("gNtText").value = n.text || ""; document.getElementById("gNtDpo").value = n.dpoContact; document.getElementById("gNtGriev").value = n.grievanceContact || "";
        noticeParts(c).forEach(function (x) { document.getElementById("gNtP_" + x[0]).value = n[x[0]] || ""; });
      });
      on("gNtPublish", function () {
        var p = { orgId: c.state.orgId, language: val("gNtLang"), title: val("gNtTitle"), text: val("gNtText"), dpoContact: val("gNtDpo"), grievanceContact: val("gNtGriev") };
        noticeParts(c).forEach(function (x) { p[x[0]] = val("gNtP_" + x[0]); });
        c.api("/ward/privacy-notice", p).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gNtMsg").innerHTML = failHtml(c, T(c, "site.gov.nt.notPublished", "Notice not published:"), r); return; }
          c.toast(T(c, "site.gov.nt.done", "Notice published as version {v}.", { v: r.notice.version })); load();
        });
      });
    }
    function load() {
      s.list = null; paint();
      c.api("/ward/privacy-notices" + q(c)).then(function (r) { if (r && r.ok) { s.list = r.notices; s.law = r.law || null; } else { s.list = false; s.fail = r; } paint(); });
    }
    load();
  }

  /* ---------------------------------------------------------------- retention and legal holds (retention.js) */
  /* One patient at a time, by MR number: what the law keeps and until when, the holds in force, placing a hold, and
   * lifting one (the medical records officer, with the reference to the disposal of the matter; the server decides). */
  var HOLD_REASONS = ["mlc", "court-case", "consumer-complaint", "pocso", "pcpndt-proceedings", "mtp-proceedings", "police-request"];
  function holdReasonLabel(c, x) {
    return { mlc: T(c, "site.gov.lh.r.mlc", "Medico-legal case"), "court-case": T(c, "site.gov.lh.r.court", "Court case"), "consumer-complaint": T(c, "site.gov.lh.r.consumer", "Consumer complaint"),
      pocso: T(c, "site.gov.lh.r.pocso", "POCSO report"), "pcpndt-proceedings": T(c, "site.gov.lh.r.pcpndt", "PCPNDT proceedings"), "mtp-proceedings": T(c, "site.gov.lh.r.mtp", "MTP proceedings"),
      "police-request": T(c, "site.gov.lh.r.police", "Police request") }[x] || x;
  }
  /* Every class with its layers (retention.js, read from the legal requirement registry): basis type, instrument, provision, jurisdiction, period and
   * evidence, and a flag on a class no law keeps. null while loading, false when it failed. */
  function periodText(c, b) {
    return b.days != null ? T(c, "site.gov.ret.days", "{n} days", { n: b.days }) : b.years != null ? T(c, "site.gov.ret.yearsN", "{n} years", { n: b.years }) : T(c, "site.gov.ret.lifeOfRecord", "for the life of the record it belongs to");
  }
  function classesHtml(c, list, law) {
    var esc = c.esc;
    if (list === null) return loading(c, T(c, "site.gov.ret.classesLoading", "Loading the retention classes..."));
    if (list === false) return '<div class="msg err">' + esc(T(c, "site.gov.ret.classesFailed", "The retention classes could not be loaded. This is not the same as there being none.")) + "</div>";
    return '<div class="card"><h2>' + esc(T(c, "site.gov.ret.classes", "Retention classes")) + "</h2>" +
      '<p class="quiet">' + esc(law && law.dpdpInForce ? T(c, "site.gov.ret.dpdpNow", "DPDP applies: a period the law sets refuses erasure; a period only the hospital's policy sets goes to the DPO for a documented decision.")
        : T(c, "site.gov.ret.dpdpLater", "Until DPDP commencement erasure keeps every class below. From then, only a period the law sets refuses erasure; a period only the hospital's policy sets goes to the DPO for a documented decision.")) + "</p>" +
      '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.gov.ret.class", "Class")) + "</th><th>" + esc(T(c, "site.gov.ret.years", "Years")) + "</th><th>" + esc(T(c, "site.gov.ret.layers", "Basis: instrument, provision, jurisdiction, period, evidence")) + "</th></tr></thead><tbody>" +
      list.map(function (x) {
        return "<tr><td>" + EN(c, esc(x.key)) + (x.policyOnly ? '<br><span class="pill warn">' + esc(T(c, "site.gov.ret.policyOnly", "Policy only: no law identified")) + "</span>" : "") + "</td><td>" +
          esc(x.years == null ? T(c, "site.gov.ret.lifeOfRecord", "for the life of the record it belongs to") : x.years) + (x.untilProceedingsEnd ? " " + esc(T(c, "site.gov.ret.orProceedings", "or until any court proceedings end, whichever is later")) : "") +
          (x.source === "hospital" ? "<br>" + esc(T(c, "site.gov.ret.hospitalSet", "set by this hospital")) : "") +
          (x.legalFloorYears != null ? "<br>" + esc(T(c, "site.gov.ret.floor", "never below the legal floor of {n} years", { n: x.legalFloorYears })) : "") + "</td><td><ul>" +
          (x.layers || []).map(function (b) {
            return "<li>" + basisPill(c, b.type) + " " + EN(c, esc(b.instrument + ", " + b.provision + " (" + b.sourceType + ", " + b.jurisdiction + ")")) + " &middot; " + esc(periodText(c, b)) +
              (b.effectiveFrom ? " " + esc(T(c, "site.gov.ret.from", "from {date}", { date: b.effectiveFrom })) : "") +
              (b.evidence && b.evidence.length ? " &middot; " + b.evidence.map(function (u) { return /^https:\/\//.test(u) ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(T(c, "site.gov.ret.evidence", "evidence")) + "</a>" : ""; }).join(" ") : "") +
              (b.note ? '<br><span class="quiet">' + EN(c, esc(b.note)) + "</span>" : "") + "</li>";
          }).join("") + "</ul></td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }
  function retentionTab(c, body, g) {
    var s = g.ret || (g.ret = { mrn: "", data: undefined, classes: null });
    var esc = c.esc;
    function paint() {
      var h = '<div class="card"><h2>' + esc(T(c, "site.gov.ret.title", "How long records are kept")) + "</h2>" +
        '<p class="quiet">' + esc(T(c, "site.gov.ret.intro2", "Nothing is deleted automatically. Each class shows what keeps it: a law, named with its provision, or the hospital's retention policy, which is not a legal requirement. A legal hold keeps everything until the matter is disposed of. Deleting a document inside a period the law sets is refused; inside a period only the policy sets it needs the DPO's or medical records officer's confirmation.")) + "</p>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.gov.req.mrn", "MR number")) + '</span><input id="gRetMrn" autocapitalize="characters" spellcheck="false" value="' + esc(s.mrn) + '"></label>' +
        '<button class="btn" type="button" id="gRetFind">' + esc(T(c, "site.gov.ret.find", "Show retention")) + "</button></div></div>";
      if (s.data === null) h += loading(c, T(c, "site.gov.ret.loading", "Working out what must be kept..."));
      else if (s.data === false) h += failHtml(c, T(c, "site.gov.ret.failed", "Retention could not be worked out. This is not the same as nothing being kept:"), s.fail);
      else if (s.data) {
        var d = s.data;
        h += '<div class="card"><h2>' + esc(T(c, "site.gov.ret.patient", "This patient's records")) + "</h2>" +
          (d.holds.length ? holdsHtml(c, d.holds, d.patientId) : '<p class="quiet">' + esc(T(c, "site.gov.lh.none", "No legal hold is in force.")) + "</p>") +
          (d.retained.length ? retainedHtml(c, d.retained) : '<p class="quiet">' + esc(T(c, "site.gov.ret.noneYet", "No records in a retention class yet.")) + "</p>") +
          (d.deceased ? '<p class="quiet">' + esc(d.deceased.inactive ? T(c, "site.gov.ret.inactive", "Inactive since {date}: three years after death. The record is kept, never destroyed for that reason.", { date: dt(d.deceased.inactiveFrom) })
            : T(c, "site.gov.ret.inactiveFrom", "Becomes inactive on {date}, three years after death. The record is kept.", { date: dt(d.deceased.inactiveFrom) })) + "</p>" : "") +
          '<h3>' + esc(T(c, "site.gov.lh.placeTitle", "Place a legal hold")) + '</h3><div class="row">' +
          '<label class="f"><span>' + esc(T(c, "site.gov.lh.reason", "Reason")) + '</span><select id="gLhReason">' + opts(HOLD_REASONS, function (x) { return esc(holdReasonLabel(c, x)); }) + "</select></label>" +
          '<label class="f"><span>' + esc(T(c, "site.gov.lh.reference", "Case, complaint or request reference")) + '</span><input id="gLhRef"></label>' +
          '<button class="btn" type="button" id="gLhPlace">' + esc(T(c, "site.gov.lh.place", "Place hold")) + '</button></div><div id="gLhMsg"></div></div>';
      }
      h += classesHtml(c, s.classes, s.law);
      body.innerHTML = h;
      on("gRetFind", function () { s.mrn = val("gRetMrn"); if (s.mrn) load(); });
      on("gLhPlace", function () {
        c.api("/ward/legal-hold", { orgId: c.state.orgId, patientId: s.data.patientId, reason: val("gLhReason"), reference: val("gLhRef") }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("gLhMsg").innerHTML = failHtml(c, T(c, "site.gov.lh.notPlaced", "Hold not placed:"), r); return; }
          c.toast(T(c, "site.gov.lh.placed2", "Legal hold placed.")); load();
        });
      });
      onAll(body, "data-glift", function (b) {
        var ref = prompt(T(c, "site.gov.lh.liftPrompt", "The reference to the disposal of the matter (judgment, closure order, withdrawal letter):"));
        if (ref == null) return;
        b.disabled = true;
        c.api("/ward/legal-hold-lift", { orgId: c.state.orgId, holdId: b.getAttribute("data-glift"), patientId: b.getAttribute("data-pid"), liftReference: ref }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { c.toast(T(c, "site.gov.req.notSaved", "Not saved: {why}", { why: why(c, r) })); return; }
          c.toast(T(c, "site.gov.lh.lifted", "Legal hold lifted.")); load();
        });
      });
    }
    function load() {
      s.data = null; paint();
      c.api("/ward/retention" + q(c) + "&mrn=" + encodeURIComponent(s.mrn)).then(function (r) { if (r && r.ok) s.data = r; else { s.data = false; s.fail = r; } paint(); });
    }
    s.classes = null; paint();
    c.api("/ward/retention-classes" + q(c)).then(function (r) { if (r && r.ok) { s.classes = r.classes; s.law = r.law || null; } else s.classes = false; paint(); });
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
  WSQ._govLawHtml = lawHtml;
  WSQ._govBreachHtml = breachHtml;
  WSQ._govHoldsHtml = holdsHtml;
  WSQ._govRetainedHtml = retainedHtml;
  WSQ._govClassesHtml = classesHtml;
  WSQ._govDecisionsFormHtml = decisionsFormHtml;
})();
