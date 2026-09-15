/* wardsynq/site/pages/patients.js - find a patient by MRN, register a new one, and go to where
 * their care happens. Registration is the SAME check-in sheet the OPD desk and the phone app use
 * (patient-register.js), submitting to the same route; nothing about identity is re-implemented. */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  WSQ.page("patients", { render: function (c) {
    var el = c.el, st = c.state, esc = c.esc, ms = c.ms;
    if (!c.can("queue.view")) { el.innerHTML = '<div class="msg note">' + TS(c, "site.patients.noAccess", "Your role ({role}) does not include queue.view, which finding a patient needs.", { role: st.who.role }) + "</div>"; return; }
    el.innerHTML =
      '<div class="title"><h1>' + esc(T(c, "site.patients.heading", "Patients")) + '</h1><span class="sub">' + EN(c, esc(st.org.name || st.org.id)) + "</span></div>" +
      '<div class="card"><h2>' + esc(T(c, "site.patients.findCard", "Find a patient")) + '</h2><div class="row">' +
        '<label class="f"><span>' + esc(T(c, "site.patients.mrnLabel", "MR number")) + '</span><input id="pMrn" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="' + esc(T(c, "site.patients.mrnPlaceholder", "e.g. {code}-000123", { code: st.org.code || "GH" })) + '"></label>' +
        '<button class="btn" id="pFind" type="button">' + ms("search") + esc(T(c, "site.patients.find", "Find")) + "</button>" +
        (c.can("queue.add") ? '<button class="btn ghost" id="pNew" type="button">' + ms("person_add") + esc(T(c, "site.patients.registerNew", "Register new patient")) + "</button>" : "") +
      '</div><div id="pOut"></div></div>' +
      '<div class="card"><h2>' + esc(T(c, "site.patients.whereHeading", "Where a patient goes")) + '</h2><div class="kv">' +
        "<dt>" + esc(T(c, "site.patients.outpatient", "Outpatient")) + "</dt><dd>" + esc(T(c, "site.patients.outpatientLead", "Check in at the")) + ' <a href="#/opd">' + esc(T(c, "site.patients.opdDesk", "OPD desk")) + "</a>: " + esc(T(c, "site.patients.outpatientDesc", "queue, consult, vitals, prescriptions, investigations, results.")) + "</dd>" +
        (c.isWardsynq() ? "<dt>" + esc(T(c, "site.patients.admission", "Admission")) + "</dt><dd>" + esc(T(c, "site.patients.admissionLead", "Use the")) + ' <a href="#/ward/board">' + esc(T(c, "site.patients.bedBoard", "bed board")) + "</a>: " + esc(T(c, "site.patients.admissionDesc", "confirm the MRN, pick the ward and bed. The inpatient chart, vitals, orders, eMAR, transfer and discharge live in the ward.")) + "</dd>" +
        "<dt>" + esc(T(c, "site.patients.emergency", "Emergency")) + "</dt><dd>" + esc(T(c, "site.patients.emergencyLead", "Arrive them in the")) + ' <a href="#/ward/edboard">' + esc(T(c, "site.patients.emergencyDept", "emergency department")) + "</a>, " + esc(T(c, "site.patients.emergencyDesc", "known MRN or unknown identity.")) + "</dd>" : "") +
      "</div></div>";
    var out = document.getElementById("pOut");
    function find() {
      var mrn = (document.getElementById("pMrn").value || "").trim();
      if (!mrn) { out.innerHTML = '<div class="msg err">' + esc(T(c, "site.patients.enterMrn", "Enter an MR number.")) + "</div>"; return; }
      out.innerHTML = '<span class="spin"></span>';
      c.api("/patient/get?orgId=" + encodeURIComponent(st.orgId) + "&mrn=" + encodeURIComponent(mrn)).then(function (r) {
        if (!r || !r.ok || !r.patient) {
          out.innerHTML = '<div class="msg note">' + (r && r.error === "not_found" ? esc(T(c, "site.patients.mrnNotFoundLead", "No patient with MR number")) + " " + EN(c, esc(mrn)) + " " + esc(T(c, "site.patients.mrnNotFoundTrail", "in this hospital.")) : r && (r.message || r.error) ? EN(c, esc(r.message || r.error)) : TS(c, "site.patients.lookupFailed", "The lookup could not be made.")) + "</div>";
          return;
        }
        var p = r.patient;
        out.innerHTML = '<div class="msg ok">' + esc(T(c, "site.patients.found", "Found.")) + '</div><div class="kv">' +
          "<dt>" + esc(T(c, "site.patients.name", "Name")) + "</dt><dd><b>" + EN(c, esc(p.name || "")) + "</b></dd>" +
          "<dt>" + esc(T(c, "site.patients.mrn", "MRN")) + "</dt><dd class=\"mono\">" + EN(c, esc(p.mrn || mrn)) + "</dd>" +
          (p.dob ? "<dt>" + esc(T(c, "site.patients.born", "Born")) + "</dt><dd>" + EN(c, esc(p.dob)) + "</dd>" : p.age != null ? "<dt>" + esc(T(c, "site.patients.age", "Age")) + "</dt><dd>" + EN(c, esc(p.age)) + "</dd>" : "") +
          (p.gender || p.sex ? "<dt>" + esc(T(c, "site.patients.sex", "Sex")) + "</dt><dd>" + EN(c, esc(p.gender || p.sex)) + "</dd>" : "") +
          (p.mobile ? "<dt>" + esc(T(c, "site.patients.mobile", "Mobile")) + "</dt><dd>" + EN(c, esc(p.mobile)) + "</dd>" : "") +
          (p.abha ? "<dt>" + esc(T(c, "site.patients.abha", "ABHA")) + "</dt><dd class=\"mono\">" + EN(c, esc(p.abha)) + "</dd>" : "") +
          (p.previousMrn ? "<dt>" + esc(T(c, "site.patients.was", "Was")) + "</dt><dd class=\"mono\">" + EN(c, esc(p.previousMrn)) + "</dd>" : "") +
          "</div>" +
          (p.supersededBy ? '<div class="msg note">' + esc(T(c, "site.patients.supersededLead", "This temporary number has been replaced by hospital MR number")) + ' <b class="mono">' + EN(c, esc(p.supersededBy)) + "</b>. " + esc(T(c, "site.patients.supersededTrail", "Use that number.")) + "</div>"
            : (p.pending || /^TMP-/i.test(p.mrn || mrn)) && c.can("queue.add") ?
              '<div class="row" style="margin-top:12px"><label class="f"><span>' + esc(T(c, "site.patients.issuedMrnLabel", "Hospital MR number issued for this patient")) + '</span><input id="pLinkMrn" autocapitalize="characters" autocorrect="off" spellcheck="false"></label>' +
              '<button class="btn" id="pLink" type="button">' + ms("link") + esc(T(c, "site.patients.link", "Link")) + "</button></div>" : "") +
          "<div class=\"row\" style=\"margin-top:12px\">" +
          '<button class="btn quiet" type="button" data-go="opd">' + ms("medical_services") + esc(T(c, "site.patients.opdDesk", "OPD desk")) + "</button>" +
          (c.isWardsynq() && c.can("queue.add") ? '<button class="btn quiet" type="button" data-go="ward:board">' + ms("hotel") + esc(T(c, "site.patients.admitBedBoard", "Admit (bed board)")) + "</button>" : "") +
          (c.isWardsynq() ? '<button class="btn quiet" type="button" data-go="ward:">' + ms("bed") + esc(T(c, "site.patients.inpatientWard", "Inpatient ward")) + "</button>" : "") +
          "</div>";
        var lb = document.getElementById("pLink");
        if (lb) lb.onclick = function () {
          var real = (document.getElementById("pLinkMrn").value || "").trim();
          if (!real) { c.toast(T(c, "site.patients.enterHospitalMrn", "Enter the hospital MR number.")); return; }
          lb.disabled = true;
          c.api("/patient/link-mrn", { orgId: st.orgId, provisionalMrn: p.mrn || mrn, mrn: real }).then(function (x) {
            lb.disabled = false;
            if (x && x.ok) { c.toast(T(c, "site.patients.linked", "Linked. The patient is now {mrn}.", { mrn: x.mrn })); document.getElementById("pMrn").value = x.mrn; find(); return; }
            /* Toast messages are plain text (shell.js sets textContent), so security warnings here use T, not TS. */
            var why = {
              mrn_in_use: T(c, "site.patients.mrnInUse", "That MR number already belongs to another patient in this hospital. Nothing was changed."),
              already_linked: T(c, "site.patients.alreadyLinked", "This temporary number was already linked to {mrn}.", { mrn: x && x.mrn }),
              same_mrn: T(c, "site.patients.sameMrn", "That is the same number."),
              forbidden: T(c, "site.patients.forbidden", "Your role cannot link record numbers.")
            }[x && x.error];
            c.toast(why || T(c, "site.patients.notLinked", "Not linked: {why}.", { why: (x && (x.message || x.error)) || T(c, "site.patients.noServerReach", "the server could not be reached") }));
          });
        };
      });
    }
    document.getElementById("pFind").onclick = find;
    document.getElementById("pMrn").addEventListener("keydown", function (e) { if (e.key === "Enter") find(); });
    var nb = document.getElementById("pNew");
    if (nb) nb.onclick = function () {
      if (!(window.SMD_PATIENTREG && SMD_PATIENTREG.open)) { c.toast(T(c, "site.patients.regSheetLoading", "The registration sheet is still loading.")); return; }
      var mode = st.org.mode === "wardsynq" ? "native" : (st.org.mode || "native");
      SMD_PATIENTREG.open({
        mode: mode, clinicName: st.org.code || st.org.name || "Check-in", region: st.org.region,
        submit: function (b) { b.orgId = st.orgId; b.workplaceMode = mode; return c.api("/patient/register", b); },
        onAdded: function (r) {
          var mrn = r && (r.mrn || (r.patient && r.patient.mrn));
          c.toast(mrn ? T(c, "site.patients.registeredMrn", "Registered {mrn}", { mrn: mrn }) : T(c, "site.patients.registeredPlain", "Registered."));
          if (mrn) { document.getElementById("pMrn").value = mrn; find(); }
        }
      });
    };
  } });
})();
