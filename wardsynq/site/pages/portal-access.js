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
  var SECTIONS = [["appointments", "Appointments"], ["medicines", "Medicines"], ["results", "Results"], ["diagnoses", "Diagnoses and allergies"],
    ["discharge", "Discharge summaries"], ["bills", "Bills"], ["consents", "Consents (view only)"], ["messages", "Messages"]];
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  /* The record id every OPD-registered patient files under (functions/_wardsynq/opd-identity.js patientIdForMrn). */
  function patientIdForMrn(mrn) { var m = String(mrn || "").trim(); return m ? "opd-pat-" + m.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""; }

  /** PURE. The message worklist, with loading, failed and empty distinct. */
  function worklistHtml(c, r) {
    if (r == null) return '<span class="spin"></span> Loading messages...';
    if (!r.ok) return '<div class="msg err">Could not load patient messages (' + c.esc(r.error || "no answer") + "). Do not read this as no messages waiting.</div>";
    if (!r.messages.length) return '<p data-empty="messages">No unanswered patient messages.</p>';
    return (r.warning ? '<div class="msg err">' + c.esc(r.warning) + "</div>" : "") + "<ul>" + r.messages.map(function (m) {
      return "<li><b>" + c.esc(m.patientId) + "</b>, waiting " + c.esc(m.waitingHours == null ? "?" : m.waitingHours) + " h" + (m.subject ? ": " + c.esc(m.subject) : "") +
        '<div class="row"><label class="f"><span>Reply</span><textarea rows="2" id="pr-' + c.esc(m.messageId) + '"></textarea></label>' +
        '<button class="btn" type="button" data-pa="reply" data-id="' + c.esc(m.messageId) + '">Send reply</button></div></li>';
    }).join("") + "</ul>";
  }

  /** PURE. A patient's grants, with loading, failed and empty distinct. */
  function grantsHtml(c, r) {
    if (r == null) return '<span class="spin"></span>';
    if (!r.ok) return '<div class="msg err">Could not load access for this patient (' + c.esc(r.error || "no answer") + "). Do not read this as nobody having access.</div>";
    if (!r.grants.length) return '<p data-empty="grants">Nobody has portal access to this patient\'s record.</p>';
    return "<ul>" + r.grants.map(function (g) {
      return "<li><b>" + c.esc(g.proxy ? (g.proxy.name || "Family member") + " (" + (g.proxy.relationship || "proxy") + ")" : "Patient") + "</b>: " + c.esc(g.state) +
        (g.proxy ? "<br>May see: " + c.esc(g.proxy.sections.join(", ")) + ". Agreed by " + c.esc(g.proxy.consentFrom) + ", " + c.esc(g.proxy.consentMethod) : "") +
        '<br><span class="mono">' + c.esc(g.grantId) + "</span>" +
        (g.state !== "revoked" ? ' <button class="btn danger" type="button" data-pa="revoke" data-id="' + c.esc(g.grantId) + '">Revoke</button>' : " (" + c.esc(g.revokedReason || "") + ")") + "</li>";
    }).join("") + "</ul>";
  }

  WSQ.page("portal-access", { render: function (c) {
    var el = c.el, org = c.state.orgId, q = "?orgId=" + encodeURIComponent(org), treat = c.can("emr.treat");
    if (!c.can("emr.view")) { el.innerHTML = '<div class="title"><h1>Patient portal</h1></div><div class="msg note">Your role cannot see patient messages.</div>'; return; }
    var set = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    var cur = { patientId: "" };
    el.innerHTML = '<div class="title"><h1>Patient portal</h1></div>' +
      '<div class="card"><h2>Patient messages</h2><div id="paWork">' + worklistHtml(c, null) + "</div></div>" +
      (treat ? '<div class="card"><h2>Give a patient or family member access</h2>' +
        '<p class="quiet">Only with the person in front of you. The code is shown once; read it to them. Patients sign in at <b>/portal.html#org=' + c.esc(org) + "</b>.</p>" +
        '<div class="row"><label class="f"><span>MR number</span><input id="paMrn" autocapitalize="characters"></label><button class="btn quiet" type="button" data-pa="find">Find</button></div>' +
        '<div id="paPatient"></div></div>' : "");
    function loadWork() { set("paWork", worklistHtml(c, null)); c.api("/ward/patient-messages" + q).then(function (r) { set("paWork", worklistHtml(c, r || { ok: false })); }); }
    function loadGrants() { set("paGrants", grantsHtml(c, null)); c.api("/ward/patient-grants" + q + "&patientId=" + encodeURIComponent(cur.patientId)).then(function (r) { set("paGrants", grantsHtml(c, r || { ok: false })); }); }
    function showPatient(p) {
      set("paPatient", '<div class="msg ok">' + c.esc(p.name || "") + " (" + c.esc(p.mrn) + ")</div>" +
        '<h3>Current access</h3><div id="paGrants"></div>' +
        '<h3>New access</h3><div class="row"><label class="f"><span>Who is this for?</span><select id="paWho"><option value="patient">The patient</option></select></label>' +
        '<label class="f"><span>How did you identify them?</span><input id="paIdent" placeholder="e.g. Aadhaar card seen"></label></div>' +
        '<div id="paProxy" class="hide"><fieldset><legend>What may this family member see?</legend>' + SECTIONS.map(function (s) {
          return '<label><input type="checkbox" name="paSec" value="' + s[0] + '"> ' + c.esc(s[1]) + "</label> ";
        }).join("") + "</fieldset>" +
        '<div class="row"><label class="f"><span>Who agreed</span><select id="paFrom"><option value="patient">The patient</option><option value="legal-guardian">Legal guardian</option><option value="power-of-attorney">Power of attorney</option></select></label>' +
        '<label class="f"><span>How</span><select id="paMethod"><option value="in-person-verbal">In person, spoken</option><option value="in-person-written">In person, written</option></select></label>' +
        '<label class="f"><span>Note (optional)</span><input id="paNote"></label></div></div>' +
        '<button class="btn primary" type="button" data-pa="enrol">Create access code</button><div id="paCode" aria-live="polite"></div>');
      loadGrants();
      c.api("/ward/related-people" + q + "&patientId=" + encodeURIComponent(cur.patientId)).then(function (r) {
        var sel = document.getElementById("paWho"); if (!sel) return;
        if (!r || !r.ok) { set("paCode", '<div class="msg err">Could not load family contacts; only the patient can be enrolled now.</div>'); return; }
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
        var text = val("pr-" + b.getAttribute("data-id")); if (!text) return c.toast("Write a reply first.");
        b.disabled = true;
        return c.api("/ward/patient-reply", { orgId: org, messageId: b.getAttribute("data-id"), reply: text }).then(function (r) { b.disabled = false; c.toast(r && r.ok ? "Reply saved to the patient's record." : "Not sent: " + ((r && (r.detail || r.error)) || "no answer")); if (r && r.ok) loadWork(); });
      }
      if (a === "find") {
        var mrn = val("paMrn"); if (!mrn) return c.toast("Enter an MR number.");
        set("paPatient", '<span class="spin"></span>');
        return c.api("/patient/get" + q + "&mrn=" + encodeURIComponent(mrn)).then(function (r) {
          if (!r || !r.ok || !r.patient) { set("paPatient", '<div class="msg note">No patient with that MR number.</div>'); return; }
          cur.patientId = patientIdForMrn(r.patient.mrn || mrn); showPatient(r.patient);
        });
      }
      if (a === "enrol") {
        var who = val("paWho"), body = { orgId: org, patientId: cur.patientId, identifiedBy: val("paIdent") };
        if (!body.identifiedBy) return c.toast("Record how you identified them.");
        if (who !== "patient") {
          var secs = [].slice.call(document.querySelectorAll('input[name="paSec"]:checked')).map(function (x) { return x.value; });
          if (!secs.length) return c.toast("Choose what this family member may see.");
          body.proxy = { relatedPersonId: who, sections: secs, consentFrom: val("paFrom"), consentMethod: val("paMethod"), consentNote: val("paNote") };
        }
        b.disabled = true;
        return c.api("/ward/patient-enrol", body).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { set("paCode", '<div class="msg err">Not created: ' + c.esc((r && (r.detail || r.error)) || "no answer") + "</div>"); return; }
          set("paCode", '<div class="msg ok">Read these to them now. The code is not stored and cannot be shown again.<br>Hospital ID: <b class="mono">' + c.esc(org) +
            '</b><br>Access ID: <b class="mono">' + c.esc(r.grantId) + '</b><br>Code: <b class="mono">' + c.esc(r.code) + "</b> (valid " + c.esc(r.expiresInMinutes) + " minutes)</div>");
          loadGrants();
        });
      }
      if (a === "revoke") {
        var why = ""; try { why = prompt("Why is this access being revoked?") || ""; } catch (e) {}
        if (!why.trim()) return;
        return c.api("/ward/patient-revoke", { orgId: org, grantId: b.getAttribute("data-id"), reason: why.trim() }).then(function (r) { c.toast(r && r.ok ? "Access revoked." : "Not revoked: " + ((r && (r.detail || r.error)) || "no answer")); loadGrants(); });
      }
    };
  } });
  WSQ._portalAccess = { worklistHtml: worklistHtml, grantsHtml: grantsHtml, patientIdForMrn: patientIdForMrn };
})();
