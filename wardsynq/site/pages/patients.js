/* wardsynq/site/pages/patients.js - find a patient by MRN, register a new one, and go to where
 * their care happens. Registration is the SAME check-in sheet the OPD desk and the phone app use
 * (patient-register.js), submitting to the same route; nothing about identity is re-implemented. */
(function () {
  "use strict";
  WSQ.page("patients", { render: function (c) {
    var el = c.el, st = c.state, esc = c.esc, ms = c.ms;
    if (!c.can("queue.view")) { el.innerHTML = '<div class="msg note">Your role (' + esc(st.who.role) + ") does not include queue.view, which finding a patient needs.</div>"; return; }
    el.innerHTML =
      '<div class="title"><h1>Patients</h1><span class="sub">' + esc(st.org.name || st.org.id) + "</span></div>" +
      '<div class="card"><h2>Find a patient</h2><div class="row">' +
        '<label class="f"><span>MR number</span><input id="pMrn" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="e.g. ' + esc(st.org.code || "GH") + '-000123"></label>' +
        '<button class="btn" id="pFind" type="button">' + ms("search") + "Find</button>" +
        (c.can("queue.add") ? '<button class="btn ghost" id="pNew" type="button">' + ms("person_add") + "Register new patient</button>" : "") +
      '</div><div id="pOut"></div></div>' +
      '<div class="card"><h2>Where a patient goes</h2><div class="kv">' +
        "<dt>Outpatient</dt><dd>Check in at the <a href=\"#/opd\">OPD desk</a>: queue, consult, vitals, prescriptions, investigations, results.</dd>" +
        (c.isWardsynq() ? "<dt>Admission</dt><dd>Use the <a href=\"#/ward/board\">bed board</a>: confirm the MRN, pick the ward and bed. The inpatient chart, vitals, orders, eMAR, transfer and discharge live in the ward.</dd>" +
        "<dt>Emergency</dt><dd>Arrive them in the <a href=\"#/ward/edboard\">emergency department</a>, known MRN or unknown identity.</dd>" : "") +
      "</div></div>";
    var out = document.getElementById("pOut");
    function find() {
      var mrn = (document.getElementById("pMrn").value || "").trim();
      if (!mrn) { out.innerHTML = '<div class="msg err">Enter an MR number.</div>'; return; }
      out.innerHTML = '<span class="spin"></span>';
      c.api("/patient/get?orgId=" + encodeURIComponent(st.orgId) + "&mrn=" + encodeURIComponent(mrn)).then(function (r) {
        if (!r || !r.ok || !r.patient) { out.innerHTML = '<div class="msg note">' + (r && r.error === "not_found" ? "No patient with MR number " + esc(mrn) + " in this hospital." : esc(r && (r.message || r.error) || "The lookup could not be made.")) + "</div>"; return; }
        var p = r.patient;
        out.innerHTML = '<div class="msg ok">Found.</div><div class="kv">' +
          "<dt>Name</dt><dd><b>" + esc(p.name || "") + "</b></dd>" +
          "<dt>MRN</dt><dd class=\"mono\">" + esc(p.mrn || mrn) + "</dd>" +
          (p.dob ? "<dt>Born</dt><dd>" + esc(p.dob) + "</dd>" : p.age != null ? "<dt>Age</dt><dd>" + esc(p.age) + "</dd>" : "") +
          (p.gender || p.sex ? "<dt>Sex</dt><dd>" + esc(p.gender || p.sex) + "</dd>" : "") +
          (p.mobile ? "<dt>Mobile</dt><dd>" + esc(p.mobile) + "</dd>" : "") +
          (p.abha ? "<dt>ABHA</dt><dd class=\"mono\">" + esc(p.abha) + "</dd>" : "") +
          "</div><div class=\"row\" style=\"margin-top:12px\">" +
          '<button class="btn quiet" type="button" data-go="opd">' + ms("medical_services") + "OPD desk</button>" +
          (c.isWardsynq() && c.can("queue.add") ? '<button class="btn quiet" type="button" data-go="ward:board">' + ms("hotel") + "Admit (bed board)</button>" : "") +
          (c.isWardsynq() ? '<button class="btn quiet" type="button" data-go="ward:">' + ms("bed") + "Inpatient ward</button>" : "") +
          "</div>";
      });
    }
    document.getElementById("pFind").onclick = find;
    document.getElementById("pMrn").addEventListener("keydown", function (e) { if (e.key === "Enter") find(); });
    var nb = document.getElementById("pNew");
    if (nb) nb.onclick = function () {
      if (!(window.SMD_PATIENTREG && SMD_PATIENTREG.open)) { c.toast("The registration sheet is still loading."); return; }
      var mode = st.org.mode === "wardsynq" ? "native" : (st.org.mode || "native");
      SMD_PATIENTREG.open({
        mode: mode, clinicName: st.org.code || st.org.name || "Check-in",
        submit: function (b) { b.orgId = st.orgId; b.workplaceMode = mode; return c.api("/patient/register", b); },
        onAdded: function (r) {
          var mrn = r && (r.mrn || (r.patient && r.patient.mrn));
          c.toast(mrn ? "Registered " + mrn : "Registered.");
          if (mrn) { document.getElementById("pMrn").value = mrn; find(); }
        }
      });
    };
  } });
})();
