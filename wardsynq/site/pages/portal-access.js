/* wardsynq/site/pages/portal-access.js - "Patient portal": the staff side of P2.9.
 *
 * Three jobs, each on a route the server already guards: enrol a patient (or a family member the
 * patient has agreed to) for their own access, see and revoke those grants, and answer the messages
 * patients send. Enrolment and replies are emr.treat; the worklist is emr.view. The access code is
 * shown ONCE, here, to be read to the person in front of you: it is not stored and nothing sends it.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  /* The server's own list (portal-view.js SECTIONS). "Full discharge summary" and "Released documents" are
   * separate choices on purpose: a relative trusted with care instructions is not automatically trusted
   * with the whole signed summary or every document a clinician releases. The section CODE is a
   * configuration value (stays as is); its label is staff-facing UI text and is translated below. */
  var SECTIONS = [["status", "OPD queue status"], ["appointments", "Appointments"], ["medicines", "Medicines"], ["results", "Results"], ["diagnoses", "Diagnoses and allergies"],
    ["discharge", "Discharge summaries (patient copy)"], ["discharge-full", "Full discharge summary"], ["documents", "Released documents"],
    ["bills", "Bills"], ["consents", "Consents (view only)"], ["messages", "Messages"]];
  function sectionLabel(c, code) {
    switch (code) {
      case "status": return T(c, "site.portal.section.status", "OPD queue status");
      case "appointments": return T(c, "site.portal.section.appointments", "Appointments");
      case "medicines": return T(c, "site.portal.section.medicines", "Medicines");
      case "results": return T(c, "site.portal.section.results", "Results");
      case "diagnoses": return T(c, "site.portal.section.diagnoses", "Diagnoses and allergies");
      case "discharge": return T(c, "site.portal.section.discharge", "Discharge summaries (patient copy)");
      case "discharge-full": return T(c, "site.portal.section.dischargeFull", "Full discharge summary");
      case "documents": return T(c, "site.portal.section.documents", "Released documents");
      case "bills": return T(c, "site.portal.section.bills", "Bills");
      case "consents": return T(c, "site.portal.section.consents", "Consents (view only)");
      case "messages": return T(c, "site.portal.section.messages", "Messages");
      default: return code;
    }
  }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  /* The record id every OPD-registered patient files under (functions/_wardsynq/opd-identity.js patientIdForMrn). */
  function patientIdForMrn(mrn) { var m = String(mrn || "").trim(); return m ? "opd-pat-" + m.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""; }

  /** PURE. The message worklist, with loading, failed and empty distinct. */
  function worklistHtml(c, r) {
    if (r == null) return '<span class="spin"></span> ' + c.esc(T(c, "site.portal.loadingMessages", "Loading messages..."));
    if (!r.ok) return '<div class="msg err">' + TS(c, "site.portal.messagesLoadFailed", "Could not load patient messages ({err}). Do not read this as no messages waiting.", { err: r.error || T(c, "site.portal.noAnswer", "no answer") }) + "</div>";
    if (!r.messages.length) return '<p data-empty="messages">' + c.esc(T(c, "site.portal.noMessages", "No unanswered patient messages.")) + "</p>";
    return (r.warning ? '<div class="msg err">' + EN(c, c.esc(r.warning)) + "</div>" : "") + "<ul>" + r.messages.map(function (m) {
      return "<li><b>" + EN(c, c.esc(m.patientId)) + "</b>, " + c.esc(T(c, "site.portal.waiting", "waiting {hours} h", { hours: m.waitingHours == null ? "?" : m.waitingHours })) + (m.subject ? ": " + EN(c, c.esc(m.subject)) : "") +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.portal.replyLabel", "Reply")) + '</span><textarea rows="2" id="pr-' + c.esc(m.messageId) + '"></textarea></label>' +
        '<button class="btn" type="button" data-pa="reply" data-id="' + c.esc(m.messageId) + '">' + c.esc(T(c, "site.portal.sendReply", "Send reply")) + "</button></div></li>";
    }).join("") + "</ul>";
  }

  /** PURE. A patient's grants, with loading, failed and empty distinct. */
  function grantsHtml(c, r) {
    if (r == null) return '<span class="spin"></span>';
    if (!r.ok) return '<div class="msg err">' + TS(c, "site.portal.grantsLoadFailed", "Could not load access for this patient ({err}). Do not read this as nobody having access.", { err: r.error || T(c, "site.portal.noAnswer", "no answer") }) + "</div>";
    if (!r.grants.length) return '<p data-empty="grants">' + c.esc(T(c, "site.portal.noGrants", "Nobody has portal access to this patient's record.")) + "</p>";
    return "<ul>" + r.grants.map(function (g) {
      var who = g.proxy
        ? (g.proxy.name ? EN(c, c.esc(g.proxy.name)) : c.esc(T(c, "site.portal.familyMember", "Family member"))) + " (" + (g.proxy.relationship ? EN(c, c.esc(g.proxy.relationship)) : c.esc(T(c, "site.portal.proxyFallback", "proxy"))) + ")"
        : c.esc(T(c, "site.portal.patient", "Patient"));
      return "<li><b>" + who + "</b>: " + EN(c, c.esc(g.state)) +
        (g.proxy ? "<br>" + c.esc(T(c, "site.portal.maySeeLead", "May see:")) + " " + EN(c, c.esc(g.proxy.sections.join(", "))) + ". " + c.esc(T(c, "site.portal.agreedLead", "Agreed by")) + " " + EN(c, c.esc(g.proxy.consentFrom)) + ", " + EN(c, c.esc(g.proxy.consentMethod)) : "") +
        '<br><span class="mono">' + c.esc(g.grantId) + "</span>" +
        (g.state !== "revoked" ? ' <button class="btn danger" type="button" data-pa="revoke" data-id="' + c.esc(g.grantId) + '">' + c.esc(T(c, "site.portal.revoke", "Revoke")) + "</button>" : " (" + EN(c, c.esc(g.revokedReason || "")) + ")") + "</li>";
    }).join("") + "</ul>";
  }

  WSQ.page("portal-access", { render: function (c) {
    var el = c.el, org = c.state.orgId, q = "?orgId=" + encodeURIComponent(org), treat = c.can("emr.treat");
    if (!c.can("emr.view")) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.portal.title", "Patient portal")) + '</h1></div><div class="msg note">' + TS(c, "site.portal.noAccess", "Your role cannot see patient messages.") + "</div>"; return; }
    var set = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    var cur = { patientId: "" };
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.portal.title", "Patient portal")) + '</h1></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.portal.messagesCard", "Patient messages")) + '</h2><div id="paWork">' + worklistHtml(c, null) + "</div></div>" +
      (treat ? '<div class="card"><h2>' + c.esc(T(c, "site.portal.giveAccessCard", "Give a patient or family member access")) + '</h2>' +
        '<p class="quiet">' + c.esc(T(c, "site.portal.giveAccessNote1", "Only with the person in front of you. The code is shown once; read it to them. Patients sign in at")) + ' <b>/portal.html#org=' + EN(c, c.esc(org)) + "</b>.</p>" +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.portal.mrnLabel", "MR number")) + '</span><input id="paMrn" autocapitalize="characters"></label><button class="btn quiet" type="button" data-pa="find">' + c.esc(T(c, "site.portal.find", "Find")) + "</button></div>" +
        '<div id="paPatient"></div></div>' : "");
    function loadWork() { set("paWork", worklistHtml(c, null)); c.api("/ward/patient-messages" + q).then(function (r) { set("paWork", worklistHtml(c, r || { ok: false })); }); }
    function loadGrants() { set("paGrants", grantsHtml(c, null)); c.api("/ward/patient-grants" + q + "&patientId=" + encodeURIComponent(cur.patientId)).then(function (r) { set("paGrants", grantsHtml(c, r || { ok: false })); }); }
    function showPatient(p) {
      set("paPatient", '<div class="msg ok">' + EN(c, c.esc(p.name || "")) + " (" + EN(c, c.esc(p.mrn)) + ")</div>" +
        '<h3>' + c.esc(T(c, "site.portal.currentAccess", "Current access")) + '</h3><div id="paGrants"></div>' +
        '<h3>' + c.esc(T(c, "site.portal.newAccess", "New access")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.portal.whoFor", "Who is this for?")) + '</span><select id="paWho"><option value="patient">' + c.esc(T(c, "site.portal.thePatient", "The patient")) + '</option></select></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.portal.howIdentified", "How did you identify them?")) + '</span><input id="paIdent" placeholder="' + c.esc(T(c, "site.portal.identPlaceholder", "e.g. Aadhaar card seen")) + '"></label></div>' +
        /* DPDP Rules 2025 r.10, from 13 May 2027: a child's portal account needs the parent verified. The server decides when. */
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.portal.pvMethod", "For a child: how the parent's identity was checked")) + '</span><select id="paPvMethod"><option value="">' + c.esc(T(c, "site.portal.pvNone", "Not a child, or not checked")) + '</option><option value="id-held">' + c.esc(T(c, "site.portal.pvId", "Against an ID the hospital holds")) + '</option><option value="digilocker-token">' + c.esc(T(c, "site.portal.pvDigilocker", "With a DigiLocker token")) + "</option></select></label>" +
        '<label class="f"><span>' + c.esc(T(c, "site.portal.pvRef", "ID or token reference")) + '</span><input id="paPvRef"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.portal.pvName", "Parent or guardian name")) + '</span><input id="paPvName"></label></div>' +
        '<div id="paProxy" class="hide"><fieldset><legend>' + c.esc(T(c, "site.portal.proxyLegend", "What may this family member see?")) + '</legend>' + SECTIONS.map(function (s) {
          return '<label><input type="checkbox" name="paSec" value="' + s[0] + '"> ' + c.esc(sectionLabel(c, s[0])) + "</label> ";
        }).join("") + "</fieldset>" +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.portal.whoAgreedLabel", "Who agreed")) + '</span><select id="paFrom"><option value="patient">' + c.esc(T(c, "site.portal.thePatient", "The patient")) + '</option><option value="legal-guardian">' + c.esc(T(c, "site.portal.legalGuardian", "Legal guardian")) + '</option><option value="power-of-attorney">' + c.esc(T(c, "site.portal.powerOfAttorney", "Power of attorney")) + '</option></select></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.portal.howLabel", "How")) + '</span><select id="paMethod"><option value="in-person-verbal">' + c.esc(T(c, "site.portal.inPersonVerbal", "In person, spoken")) + '</option><option value="in-person-written">' + c.esc(T(c, "site.portal.inPersonWritten", "In person, written")) + '</option></select></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.portal.noteOptional", "Note (optional)")) + '</span><input id="paNote"></label></div></div>' +
        '<button class="btn primary" type="button" data-pa="enrol">' + c.esc(T(c, "site.portal.createCode", "Create access code")) + '</button><div id="paCode" aria-live="polite"></div>');
      loadGrants();
      c.api("/ward/related-people" + q + "&patientId=" + encodeURIComponent(cur.patientId)).then(function (r) {
        var sel = document.getElementById("paWho"); if (!sel) return;
        if (!r || !r.ok) { set("paCode", '<div class="msg err">' + TS(c, "site.portal.contactsLoadFailed", "Could not load family contacts; only the patient can be enrolled now.") + "</div>"); return; }
        r.people.filter(function (x) { return x.active; }).forEach(function (x) {
          var o = document.createElement("option"); o.value = x.relatedPersonId; o.textContent = x.name + " (" + x.relationship + ")"; sel.appendChild(o);
        });
        sel.onchange = function () { document.getElementById("paProxy").className = sel.value === "patient" ? "hide" : ""; };
      });
    }
    loadWork();
    el.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-pa]"); if (!b) return;
      var a = b.getAttribute("data-pa");
      if (a === "reply") {
        var text = val("pr-" + b.getAttribute("data-id")); if (!text) return c.toast(T(c, "site.portal.writeReplyFirst", "Write a reply first."));
        b.disabled = true;
        return c.api("/ward/patient-reply", { orgId: org, messageId: b.getAttribute("data-id"), reply: text }).then(function (r) { b.disabled = false; c.toast(r && r.ok ? T(c, "site.portal.replySaved", "Reply saved to the patient's record.") : T(c, "site.portal.notSent", "Not sent: {why}", { why: (r && (r.detail || r.error)) || T(c, "site.portal.noAnswer", "no answer") })); if (r && r.ok) loadWork(); });
      }
      if (a === "find") {
        var mrn = val("paMrn"); if (!mrn) return c.toast(T(c, "site.portal.enterMrn", "Enter an MR number."));
        set("paPatient", '<span class="spin"></span>');
        return c.api("/patient/get" + q + "&mrn=" + encodeURIComponent(mrn)).then(function (r) {
          if (!r || !r.ok || !r.patient) { set("paPatient", '<div class="msg note">' + c.esc(T(c, "site.portal.noPatientForMrn", "No patient with that MR number.")) + "</div>"); return; }
          cur.patientId = patientIdForMrn(r.patient.mrn || mrn); showPatient(r.patient);
        });
      }
      if (a === "enrol") {
        var who = val("paWho"), body = { orgId: org, patientId: cur.patientId, identifiedBy: val("paIdent") };
        if (!body.identifiedBy) return c.toast(T(c, "site.portal.recordIdentified", "Record how you identified them."));
        if (val("paPvMethod")) body.parentVerification = { method: val("paPvMethod"), reference: val("paPvRef"), parentName: val("paPvName") };
        if (who !== "patient") {
          var secs = [].slice.call(document.querySelectorAll('input[name="paSec"]:checked')).map(function (x) { return x.value; });
          if (!secs.length) return c.toast(T(c, "site.portal.chooseSections", "Choose what this family member may see."));
          body.proxy = { relatedPersonId: who, sections: secs, consentFrom: val("paFrom"), consentMethod: val("paMethod"), consentNote: val("paNote") };
        }
        b.disabled = true;
        return c.api("/ward/patient-enrol", body).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { set("paCode", '<div class="msg err">' + TS(c, "site.portal.enrolFailed", "Not created: {why}", { why: (r && (r.detail || r.error)) || T(c, "site.portal.noAnswer", "no answer") }) + "</div>"); return; }
          set("paCode", '<div class="msg ok">' + TS(c, "site.portal.codeWarning", "Read these to them now. The code is not stored and cannot be shown again.") + "<br>" + c.esc(T(c, "site.portal.hospitalIdLabel", "Hospital ID:")) + " <b class=\"mono\">" + EN(c, c.esc(org)) +
            "</b><br>" + c.esc(T(c, "site.portal.accessIdLabel", "Access ID:")) + " <b class=\"mono\">" + EN(c, c.esc(r.grantId)) + "</b><br>" + c.esc(T(c, "site.portal.codeLabel", "Code:")) + " <b class=\"mono\">" + EN(c, c.esc(r.code)) + "</b> " + c.esc(T(c, "site.portal.validMinutes", "(valid {n} minutes)", { n: r.expiresInMinutes })) + "</div>");
          loadGrants();
        });
      }
      if (a === "revoke") {
        var why = ""; try { why = prompt(T(c, "site.portal.revokeReasonPrompt", "Why is this access being revoked?")) || ""; } catch (e) {}
        if (!why.trim()) return;
        /* Portal access revocation is a security-sensitive, irreversible action: the outcome toast is
         * plain text (shell.js toast() sets textContent), so it uses T rather than TS, per spec. */
        return c.api("/ward/patient-revoke", { orgId: org, grantId: b.getAttribute("data-id"), reason: why.trim() }).then(function (r) { c.toast(r && r.ok ? T(c, "site.portal.revoked", "Access revoked.") : T(c, "site.portal.revokeFailed", "Not revoked: {why}", { why: (r && (r.detail || r.error)) || T(c, "site.portal.noAnswer", "no answer") })); loadGrants(); });
      }
    };
  } });
  WSQ._portalAccess = { worklistHtml: worklistHtml, grantsHtml: grantsHtml, patientIdForMrn: patientIdForMrn };
})();
