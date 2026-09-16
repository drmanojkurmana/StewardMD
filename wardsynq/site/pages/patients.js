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

  /* ---- ABDM SCAN AND SHARE (functions/_wardsynq/abdm-share.js) ------------------------------------------------
   * The counter QRs, one per counter and printable, and today's profiles patients shared by scanning them, each with
   * the token it was given. Register opens the check-in sheet pre-filled with the ABDM-verified profile. r: null =
   * loading, {failed} = could not be read (never shown as "no shares"), else GET /ward/abdm-share. */
  function qrSvg(url) {
    if (!window.qrcode || !url) return "";
    try { var q = window.qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true }); } catch (e) { return ""; }
  }
  function shareReason(c, code) {
    switch (code) {
      case "not_set_up": return T(c, "site.patients.share.notSetUp", "ABDM is not set up for this hospital. An administrator sets it up on Admin Center, Integrations, ABDM.");
      case "inactive": return T(c, "site.patients.share.inactive", "This hospital's ABDM profile is switched off.");
      case "not_linked": return T(c, "site.patients.share.notLinked", "This hospital is not linked to ABDM yet. ABDM has to link the facility to the StewardMD bridge and issue a HIP ID first.");
      case "suspended": return T(c, "site.patients.share.suspended", "This hospital's ABDM connection is suspended.");
      case "production_held": return T(c, "site.patients.share.productionHeld", "Production ABDM traffic is held until India-region hosting exists.");
      case "bridge_not_configured": return T(c, "site.patients.share.bridgeMissing", "The StewardMD ABDM bridge credential is not configured on this server.");
      default: return T(c, "site.patients.share.notConnectedOther", "This hospital is not connected to ABDM.");
    }
  }
  function shareHtml(c, r) {
    var esc = c.esc;
    var h = "<h2>" + esc(T(c, "site.patients.share.title", "Scan and Share (ABDM)")) + "</h2>";
    if (r == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.patients.share.loading", "Loading the counter QR codes and today's shared profiles..."));
    if (r.failed) return h + '<div class="msg err">' + TS(c, "site.patients.share.failed", "The Scan and Share counter could not be loaded:") + " " + EN(c, esc(r.message || "")) + ". " + TS(c, "site.patients.share.notNone", "This is not the same as there being no shared profiles.") + "</div>";
    var conn = r.connection || {};
    if (!conn.connected) {
      h += '<div class="msg note"><b>' + esc(T(c, "site.patients.share.notConnected", "No QR code is shown: this hospital is not connected to ABDM.")) + "</b> " + esc(shareReason(c, conn.code)) + "</div>";
    } else {
      h += '<p class="quiet">' + esc(T(c, "site.patients.share.intro", "A patient scans the counter's QR code with the ABHA app. Their ABDM-verified profile arrives here with a token in that counter's queue. Print one QR code for each counter.")) + "</p>";
      h += '<div class="row" style="flex-wrap:wrap;gap:16px">' + (r.counters || []).map(function (ct, i) {
        var label = ct.name ? EN(c, esc(ct.name)) : esc(T(c, "site.patients.share.generalDesk", "Registration desk"));
        return '<div class="abdm-qr" style="text-align:center;max-width:220px"><div id="pShareQr' + i + '" style="width:180px;margin:0 auto">' + qrSvg(ct.url) + "</div>" +
          "<div><b>" + label + "</b></div><div class=\"mono quiet\">" + esc(T(c, "site.patients.share.counterCode", "Counter code {code}", { code: ct.counterId })) + "</div>" +
          '<button type="button" class="btn ghost" data-share-print="' + i + '">' + esc(T(c, "site.patients.share.print", "Print this QR code")) + "</button></div>";
      }).join("") + "</div>";
      if (!(r.counters || []).length) h += '<div class="msg note">' + esc(T(c, "site.patients.share.noCounters", "No counter can take a token: this hospital numbers tokens per department and has no active department.")) + "</div>";
    }
    h += "<h3>" + esc(T(c, "site.patients.share.today", "Shared today")) + "</h3>";
    var rows = r.shares || [];
    if (!rows.length) return h + '<p class="quiet">' + esc(T(c, "site.patients.share.none", "No patient has shared a profile today.")) + "</p>";
    return h + '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.patients.share.colToken", "Token")) + "</th><th>" + esc(T(c, "site.patients.share.colPatient", "Patient")) + "</th><th>" +
      esc(T(c, "site.patients.share.colCounter", "Counter")) + "</th><th>" + esc(T(c, "site.patients.share.colState", "Registration")) + "</th></tr></thead><tbody>" +
      rows.map(function (s) {
        var p = s.profile || {};
        var who = EN(c, esc(s.name || "")) + (p.gender || p.yearOfBirth ? ' <span class="quiet">' + EN(c, esc([p.gender, p.yearOfBirth].filter(Boolean).join(", "))) + "</span>" : "");
        var state = s.registered ? esc(T(c, "site.patients.share.registeredAs", "Registered as {mrn}", { mrn: s.mrn }))
          : s.profileUnreadable ? '<span class="msg err">' + esc(T(c, "site.patients.share.unreadable", "The shared profile could not be read. Register the patient by hand.")) + "</span>"
          : '<button type="button" class="btn" data-share-register="' + esc(s.ticketId) + '">' + esc(T(c, "site.patients.share.register", "Register")) + "</button>";
        return "<tr><td class=\"mono\"><b>" + EN(c, esc(s.token)) + "</b></td><td>" + who + "</td><td>" + (s.department ? EN(c, esc(s.department)) : esc(T(c, "site.patients.share.generalDesk", "Registration desk"))) + "</td><td>" + state + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  WSQ._abdmShareHtml = shareHtml;

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
      (c.isWardsynq() ? '<div class="card" id="pShare">' + shareHtml(c, null) + "</div>" : "") +
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
    if (nb) nb.onclick = function () { openRegister(null, null); };

    /* Scan and Share: load, print a counter's QR, and register a shared profile (then put the MR number on its token). */
    var shareCard = document.getElementById("pShare");
    function loadShares() {
      if (!shareCard) return;
      shareCard.innerHTML = shareHtml(c, null);
      c.api("/ward/abdm-share?orgId=" + encodeURIComponent(st.orgId)).then(function (r) {
        var ok = r && r.ok && r.connection && Array.isArray(r.shares);
        shareCard.innerHTML = shareHtml(c, ok ? r : { failed: true, message: (r && (r.message || r.error)) || T(c, "site.patients.noServerReach", "the server could not be reached") });
        if (ok) bindShares(r);
      });
    }
    function bindShares(r) {
      Array.prototype.forEach.call(shareCard.querySelectorAll("[data-share-print]"), function (b) {
        b.onclick = function () {
          var i = +b.getAttribute("data-share-print"), ct = r.counters[i], qr = document.getElementById("pShareQr" + i);
          if (!ct || !qr) return;
          /* The printed sheet is the QR, the hospital and the counter, nothing else on the page. */
          var sheet = document.createElement("div"), style = document.createElement("style");
          sheet.id = "pSharePrint";
          sheet.innerHTML = '<div style="text-align:center;font-family:sans-serif;padding:24px"><h1 style="margin:0 0 8px">' + EN(c, c.esc(st.org.name || "")) + "</h1><h2 style=\"margin:0 0 16px\">" +
            (ct.name ? EN(c, c.esc(ct.name)) : c.esc(T(c, "site.patients.share.generalDesk", "Registration desk"))) + '</h2><div style="width:320px;margin:0 auto">' + qr.innerHTML + "</div><p>" +
            c.esc(T(c, "site.patients.share.printHint", "Scan with the ABHA app to share your profile and get a token.")) + "</p></div>";
          style.textContent = "@media print { body > *:not(#pSharePrint) { display: none !important; } #pSharePrint { display: block !important; } } #pSharePrint { display: none; }";
          document.body.appendChild(style); document.body.appendChild(sheet);
          window.print();
          setTimeout(function () { sheet.remove(); style.remove(); }, 1000);
        };
      });
      Array.prototype.forEach.call(shareCard.querySelectorAll("[data-share-register]"), function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-share-register"), s = (r.shares || []).filter(function (x) { return x.ticketId === id; })[0];
          if (!s || !s.profile) return;
          var p = s.profile, a = p.address || {};
          openRegister({ name: p.name, mobile: p.mobile, gender: p.gender, yearOfBirth: p.yearOfBirth, monthOfBirth: p.monthOfBirth, dayOfBirth: p.dayOfBirth,
            abhaNumber: p.abhaNumber, abhaAddress: p.abhaAddress, abhaProof: s.abhaProof || "", address: a.line, district: a.district, state: a.state, pincode: a.pinCode }, function (mrn) {
            c.api("/ward/abdm-share-register", { orgId: st.orgId, ticketId: id, mrn: mrn }).then(function (x) {
              if (!x || !x.ok) c.toast(T(c, "site.patients.share.tokenNotUpdated", "Registered as {mrn}, but the MR number could not be put on token {token}: {why}", { mrn: mrn, token: s.token, why: (x && (x.message || x.error)) || T(c, "site.patients.noServerReach", "the server could not be reached") }));
              loadShares();
            });
          });
        };
      });
    }
    loadShares();

    function openRegister(prefill, onMrn) {
      if (!(window.SMD_PATIENTREG && SMD_PATIENTREG.open)) { c.toast(T(c, "site.patients.regSheetLoading", "The registration sheet is still loading.")); return; }
      var mode = st.org.mode === "wardsynq" ? "native" : (st.org.mode || "native");
      SMD_PATIENTREG.open({
        prefill: prefill,
        mode: mode, clinicName: st.org.code || st.org.name || "Check-in", region: st.org.region,
        /* LT-29: this page registers a patient and queues nobody (onAdded only finds them), so the sheet's OPD verb
         * "Add to queue" was wrong here, for an ED or inpatient as much as for anyone. */
        submitLabel: T(c, "site.patients.registerSubmit", "Register patient"),
        submit: function (b) { b.orgId = st.orgId; b.workplaceMode = mode; return c.api("/patient/register", b); },
        /* S6 A5: ABHA verified or created with ABDM at this sheet, where the hospital runs WardSynQ. The server says
         * whether this hospital is connected and which of verify and create this role may do. */
        abdm: c.isWardsynq() ? {
          status: function () { return c.api("/ward/abdm-desk?orgId=" + encodeURIComponent(st.orgId)); },
          step: function (b) { b.orgId = st.orgId; return c.api("/ward/abha", b); }
        } : null,
        onAdded: function (r) {
          var mrn = r && (r.mrn || (r.patient && r.patient.mrn));
          c.toast(mrn ? T(c, "site.patients.registeredMrn", "Registered {mrn}", { mrn: mrn }) : T(c, "site.patients.registeredPlain", "Registered."));
          if (mrn) { document.getElementById("pMrn").value = mrn; find(); }
          if (mrn && onMrn) onMrn(mrn);
        }
      });
    }
  } });
})();
