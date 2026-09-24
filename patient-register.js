/* patient-register.js — window.SMD_PATIENTREG. ONE patient check-in sheet, used by BOTH the phone app
 * (queue.js) and the staff web console (opd.html), so the two can never drift apart again.
 *
 * Replaces: four sequential prompt() boxes in the app, and a three-field sheet in the console.
 *
 * DESIGN
 *  • Essentials first — name, mobile, gender, age, visit type — so the desk stays fast. ABHA, address
 *    and referral live behind a disclosure, so a complete record is possible without slowing a queue.
 *  • The client does NOT re-implement the validation rules. The server (_opd_patient.js) is the
 *    authority and returns errors keyed by field; this renders them inline under the right input.
 *    Local checks here are UX hints only (required, digit counts) so typing feels responsive.
 *  • The assigned MR number is shown LARGE on success — the desk writes it on the patient's slip.
 *  • Touch-first: 48px targets, numeric keypads (inputmode), one-tap gender and visit type.
 *
 * The caller supplies submit(): the app and the console authenticate differently, so the transport
 * stays with them and this component stays pure UI.
 */
(function (root) {
  "use strict";
  if (!root || !root.document) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  /* THE STAFF LANGUAGE, as ward.js and discharge.js (owner decision 2026-09-15). This sheet is also the phone app's
   * check-in, where there is no staff shell and no i18n.js: then wT returns the English it always did. Keys are
   * "ward.reg-*" in the ward.js block of wardsynq/site/i18n.js. What is typed is recorded as typed and never
   * translated; a message the server sent is shown as the server wrote it. */
  var G = root;
  var HAS = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function wLang() { var I = G.WSQI18n, s = G.WSQ && G.WSQ.state; return I && s && s.navLang ? I.normalize(s.navLang) : "en"; }
  function wTr(key) { var I = G.WSQI18n, L = wLang(), c = L !== "en" && I && I._catalogs[L]; return c && HAS(c, key) ? String(c[key]) : null; }
  function wFill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return HAS(vars, k) ? "" + vars[k] : m; }) : s; }
  function wT(key, en, vars) { var tr = wTr(key); return wFill(tr == null ? en : tr, vars); }
  function wTH(key, en, vars) { var tr = wTr(key); return tr == null ? wFill(en, vars) : wFill(esc(tr), vars); }
  function genders() { return [["female", wT("ward.reg-female", "Female")], ["male", wT("ward.reg-male", "Male")], ["other", wT("ward.reg-other", "Other")]]; }
  function visits() { return [["new", wT("ward.reg-visit-new", "New")], ["followup", wT("ward.reg-visit-followup", "Follow-up")]]; }

  function el() {
    var d = root.document.getElementById("smdPatReg");
    if (!d) { d = root.document.createElement("div"); d.id = "smdPatReg"; root.document.body.appendChild(d); }
    return d;
  }

  // ---- markup ---------------------------------------------------------------------------------
  function field(id, label, opts) {
    opts = opts || {};
    return '<div class="pr-f" data-f="' + id + '">' +
      '<label for="pr_' + id + '">' + esc(label) + (opts.req ? '<i aria-hidden="true">*</i>' : "") + "</label>" +
      '<input id="pr_' + id + '" type="' + (opts.type || "text") + '"' +
      (opts.mode ? ' inputmode="' + opts.mode + '"' : "") +
      (opts.max ? ' maxlength="' + opts.max + '"' : "") +
      (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") +
      (opts.auto ? ' autocomplete="' + opts.auto + '"' : ' autocomplete="off"') +
      ' spellcheck="false">' +
      (opts.hint ? '<small class="pr-hint">' + esc(opts.hint) + "</small>" : "") +
      '<small class="pr-err" role="alert"></small></div>';
  }
  function seg(name, items, sel) {
    return '<div class="pr-seg" role="radiogroup" aria-label="' + esc(name) + '" data-seg="' + name + '">' +
      items.map(function (i) {
        return '<button type="button" role="radio" aria-checked="' + (i[0] === sel) + '"' +
          ' class="pr-segb' + (i[0] === sel ? " on" : "") + '" data-v="' + i[0] + '">' + esc(i[1]) + "</button>";
      }).join("") + "</div>";
  }

  /* region-aware copy. functions/_region.js is the one place country rules LIVE (validation stays
   * server-side there), but this plain <script> tag is not a module and cannot import it - so this
   * is label/placeholder/maxlength text only, never a rule the server could disagree with. Region
   * joined 2026-09-11: was hardcoded to India (a 6-digit PIN, a "98765 43210" mobile), so a US
   * hospital could not even TYPE the field it needed. Unset means IN - no existing caller changes. */
  function isUS(o) { return String(o && o.region).toUpperCase() === "US"; }

  /* D7: WHICH DEPARTMENT the patient is queued in, when the hospital has departments. The department
   * decides the token sequence (and its prefix) when each department numbers separately, so the server
   * resolves and checks it; this only offers the hospital's own active departments. opts.departments:
   * undefined = not a queue registration (no picker), null = the list could not be loaded (said so, never
   * drawn as "no departments"), [] = the hospital has none. opts.departmentRequired: each department
   * numbers separately, so a choice is needed. */
  function deptHtml(o) {
    if (o.departments === undefined) return "";
    if (o.departments === null) {
      return '<p class="pr-warn" data-f="departmentId">' + wTH("ward.reg-departments-not-loaded", "The hospital's departments could not be loaded.") + " " +
        (o.departmentRequired ? wTH("ward.reg-departments-token-blocked", "A token cannot be given without one: close this and try again.") : wTH("ward.reg-departments-queued-without", "The patient is queued without a department.")) + "</p>";
    }
    var act = o.departments.filter(function (d) { return d && d.id && d.active !== false; });
    if (!act.length) return o.departmentRequired ? '<p class="pr-warn" data-f="departmentId">' + wTH("ward.reg-no-active-department", "This hospital numbers tokens per department but has no active department. An administrator adds one under Admin Center, Departments.") + "</p>" : "";
    return '<div class="pr-f" data-f="departmentId"><label for="pr_departmentId">' + wTH("ward.reg-department", "Department") + (o.departmentRequired ? '<i aria-hidden="true">*</i>' : "") + "</label>" +
      '<select id="pr_departmentId"><option value="">' + (o.departmentRequired ? wTH("ward.reg-choose-a-department", "Choose a department") : wTH("ward.reg-no-department", "No department")) + "</option>" +
      act.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === o.departmentId ? " selected" : "") + ">" + (d.name || d.code ? esc(d.name || d.code) : wTH("ward.reg-department", "Department")) + "</option>"; }).join("") +
      "</select>" + (o.departmentRequired ? '<small class="pr-hint">' + wTH("ward.reg-each-department-calls-its-own", "Each department calls its own token numbers.") + "</small>" : "") +
      '<small class="pr-err" role="alert"></small></div>';
  }

  /* ---- ABHA WITH ABDM (owner S6, phase A5) ------------------------------------------------------------
   * opts.abdm = { status: fn() -> Promise, step: fn(body) -> Promise } where the hospital runs WardSynQ. Without it
   * (the phone app, the OPD console) the ABHA fields are typed exactly as before and none of this is drawn.
   * The server (functions/_wardsynq/abdm-desk.js) is the authority: it refuses a hospital that is not connected,
   * a role owner A5 does not allow, and anything ABDM itself refuses, and ABDM's own words are shown as sent.
   * a: { st: null (checking) | false (could not check) | { connection, canVerify, canCreate }, mode, busy, err,
   *      consent, suggestions, pending, done, proof, linkedTo }. The Aadhaar number and OTPs are never kept here. */
  // Verhoeff, because ABDM requires the Aadhaar checksum checked BEFORE the OTP call (CRT_ABHA_104).
  var V_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
  var V_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
  function validAadhaar(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    if (d.length !== 12 || d.charAt(0) === "0" || d.charAt(0) === "1") return false;
    var c = 0;
    for (var i = 0; i < d.length; i++) c = V_D[c][V_P[i % 8][+d.charAt(d.length - 1 - i)]];
    return c === 0;
  }
  function fmtAbha(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    return d.length === 14 ? d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6, 10) + "-" + d.slice(10) : String(v || "");
  }
  /* Why a hospital is not connected, by the server's code. The English is abdm-connect.js's, byte for byte. */
  function abdmReason(code) {
    switch (code) {
      case "not_set_up": return wT("ward.reg-abdm-not-set-up", "ABDM is not set up for this hospital. An administrator sets it up on Admin Center, Integrations, ABDM.");
      case "inactive": return wT("ward.reg-abdm-inactive", "This hospital's ABDM profile is switched off.");
      case "not_linked": return wT("ward.reg-abdm-not-linked", "This hospital is not linked to ABDM yet. ABDM has to link the facility to the StewardMD bridge and issue a HIP ID first.");
      case "suspended": return wT("ward.reg-abdm-suspended", "This hospital's ABDM connection is suspended.");
      case "production_held": return wT("ward.reg-abdm-production-held", "Production ABDM traffic is held until India-region hosting exists.");
      case "bridge_not_configured": return wT("ward.reg-abdm-bridge-missing", "The StewardMD ABDM bridge credential is not configured on this server.");
      default: return wT("ward.reg-abdm-not-connected-other", "This hospital is not connected to ABDM.");
    }
  }
  function abdmBtn(act, label, primary, busy) {
    return '<button type="button" class="pr-btn ' + (primary ? "primary" : "ghost") + '" data-a="' + act + '"' + (busy ? " disabled" : "") + ">" + label + "</button>";
  }
  function abdmInput(id, label, opts) {
    opts = opts || {};
    return '<div class="pr-f"><label for="pr_' + id + '">' + label + "</label><input id=\"pr_" + id + '" type="text" autocomplete="' + (opts.auto || "off") + '"' +
      (opts.mode ? ' inputmode="' + opts.mode + '"' : "") + (opts.max ? ' maxlength="' + opts.max + '"' : "") + ' spellcheck="false">' +
      (opts.hint ? '<small class="pr-hint">' + opts.hint + "</small>" : "") + "</div>";
  }
  function abdmPanelHtml(a) {
    if (!a) return "";
    var open = '<div class="pr-abdm" id="prAbdm" aria-live="polite">';
    if (a.st === null) return open + '<p class="pr-note">' + wTH("ward.reg-abdm-checking", "Checking whether this hospital is connected to ABDM...") + "</p></div>";
    if (a.st === false) return open + '<p class="pr-warn">' + wTH("ward.reg-abdm-check-failed", "Whether this hospital is connected to ABDM could not be checked. An ABHA typed below is recorded as typed, not verified.") + "</p></div>";
    var c = a.st.connection || {};
    if (!c.connected) {
      return open + '<p class="pr-warn"><b>' + wTH("ward.reg-abdm-not-connected", "Not connected to ABDM.") + "</b> " + esc(abdmReason(c.code)) + " " +
        wTH("ward.reg-abdm-typed-not-verified", "An ABHA typed below is recorded as typed, not verified.") + "</p></div>";
    }
    var b = a.busy, h = open;
    if (a.err) h += '<p class="pr-warn" role="alert">' + esc(a.err) + "</p>";
    if (a.linkedTo) {
      return h + '<p class="pr-warn">' + wTH("ward.reg-abdm-already-linked", "This ABHA already belongs to patient {mrn} at this hospital. Open that record instead of registering a new one.", { mrn: '<b lang="en">' + esc(a.linkedTo) + "</b>" }) + "</p>" +
        '<div class="pr-abdm-actions">' + abdmBtn("abdm-reset", wTH("ward.reg-abdm-start-again", "Start again"), false, b) + "</div></div>";
    }
    if (a.done) {
      return h + '<div class="pr-abdm-ok"><b>' + (a.done === "created" ? wTH("ward.reg-abdm-created", "ABHA created with ABDM") : a.done === "shared" ? wTH("ward.reg-abdm-shared", "ABHA shared by the patient through ABDM") : wTH("ward.reg-abdm-verified", "ABHA verified with ABDM")) + "</b>" +
        '<span lang="en">' + esc(fmtAbha(a.profile.abhaNumber)) + (a.profile.abhaAddress ? " &middot; " + esc(a.profile.abhaAddress) : "") + "</span>" +
        "<small>" + wTH("ward.reg-abdm-locked", "Name and ABHA come from ABDM and cannot be edited here. The ABHA is linked to the MR number when the patient is registered.") + "</small></div>" +
        '<div class="pr-abdm-actions">' + abdmBtn("abdm-reset", wTH("ward.reg-abdm-use-another", "Use a different ABHA"), false, b) + "</div></div>";
    }
    var cancel = abdmBtn("abdm-reset", wTH("ward.reg-cancel", "Cancel"), false, b);
    switch (a.mode) {
      case "verify-id":
        return h + abdmInput("abdmId", wTH("ward.reg-abdm-id", "ABHA number or ABHA address"), { hint: wTH("ward.reg-abdm-id-hint", "14 digits, or name@abdm") }) +
          '<div class="pr-f"><label for="pr_abdmOtpSys">' + wTH("ward.reg-abdm-otp-to", "Send the OTP to") + '</label><select id="pr_abdmOtpSys">' +
          '<option value="abdm">' + wTH("ward.reg-abdm-otp-abha-mobile", "The mobile linked to the ABHA") + '</option><option value="aadhaar">' + wTH("ward.reg-abdm-otp-aadhaar-mobile", "The mobile linked to Aadhaar") + "</option></select></div>" +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-verify-send", wTH("ward.reg-abdm-send-otp", "Send OTP"), true, b) + cancel + "</div></div>";
      case "verify-otp":
        return h + abdmInput("abdmOtp", wTH("ward.reg-abdm-otp", "OTP"), { mode: "numeric", max: 6, auto: "one-time-code" }) +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-verify-confirm", wTH("ward.reg-abdm-verify", "Verify"), true, b) + abdmBtn("abdm-verify-resend", wTH("ward.reg-abdm-send-again", "Send another OTP"), false, b) + cancel + "</div></div>";
      case "create-consent":
        if (!a.consent) return h + '<p class="pr-note">' + wTH("ward.reg-abdm-consent-loading", "Loading ABDM's consent text...") + "</p><div class=\"pr-abdm-actions\">" + cancel + "</div></div>";
        /* ABDM's published consent language, shown as ABDM wrote it (CRT_ABHA_102): never translated here. */
        return h + '<p class="pr-note">' + wTH("ward.reg-abdm-consent-lead", "Read this to the patient, or turn the screen to them. ABDM requires their agreement before an Aadhaar OTP is asked for.") + "</p>" +
          '<div class="pr-abdm-consent" lang="en"><p><b>' + esc(a.consent.heading) + "</b></p>" +
          a.consent.clauses.concat(a.consent.attestations).map(function (cl) {
            var on = cl.defaultChecked === true && !cl.aadhaarUnchecked;
            return '<label class="pr-check"><input type="checkbox" class="pr-abdmc" data-id="' + esc(cl.id) + '"' + (on ? " checked" : "") + "><span>" + esc(cl.text) + "</span></label>";
          }).join("") + "</div>" +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-consent", wTH("ward.reg-abdm-agree", "The patient agrees"), true, b) + cancel + "</div></div>";
      case "create-aadhaar":
        return h + abdmInput("abdmAadhaar", wTH("ward.reg-abdm-aadhaar", "Aadhaar number"), { mode: "numeric", max: 14, hint: wTH("ward.reg-abdm-aadhaar-hint", "The OTP goes to the mobile registered with Aadhaar. The Aadhaar number is not stored.") }) +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-aadhaar-send", wTH("ward.reg-abdm-send-otp", "Send OTP"), true, b) + cancel + "</div></div>";
      case "create-otp":
        return h + abdmInput("abdmOtp", wTH("ward.reg-abdm-aadhaar-otp", "OTP sent to the Aadhaar mobile"), { mode: "numeric", max: 6, auto: "one-time-code" }) +
          abdmInput("abdmMobile", wTH("ward.reg-abdm-comm-mobile", "Mobile number for ABHA messages"), { mode: "tel", max: 10 }) +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-enrol-verify", wTH("ward.reg-abdm-verify", "Verify"), true, b) + cancel + "</div></div>";
      case "create-mobile":
        return h + '<p class="pr-note">' + wTH("ward.reg-abdm-mobile-differs", "That mobile is not the one registered with Aadhaar, so ABDM sent it its own OTP.") + "</p>" +
          abdmInput("abdmOtp", wTH("ward.reg-abdm-otp", "OTP"), { mode: "numeric", max: 6, auto: "one-time-code" }) +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-mobile-verify", wTH("ward.reg-abdm-verify", "Verify"), true, b) + cancel + "</div></div>";
      case "create-address":
        return h + '<p class="pr-note">' + wTH("ward.reg-abdm-pick-address", "Let the patient choose their ABHA address.") + "</p>" +
          (a.suggestions || []).map(function (s, i) {
            return '<label class="pr-check"><input type="radio" name="prAbdmAddr" value="' + esc(s) + '"' + (i === 0 ? " checked" : "") + '><span lang="en">' + esc(s) + "</span></label>";
          }).join("") +
          '<div class="pr-abdm-actions">' + abdmBtn("abdm-address", wTH("ward.reg-abdm-create", "Create ABHA"), true, b) + cancel + "</div></div>";
      default:
        if (!a.st.canVerify && !a.st.canCreate) return h + '<p class="pr-note">' + wTH("ward.reg-abdm-role-none", "Your role cannot verify or create an ABHA here. An ABHA typed below is recorded as typed, not verified.") + "</p></div>";
        return h + '<p class="pr-note">' + wTH("ward.reg-abdm-connected", "Connected to ABDM ({env}) as facility {hipId}.", { env: '<span lang="en">' + esc(c.env) + "</span>", hipId: '<span lang="en">' + esc(c.hipId) + "</span>" }) + "</p>" +
          '<div class="pr-abdm-actions">' + (a.st.canVerify ? abdmBtn("abdm-verify", wTH("ward.reg-abdm-verify-abha", "Verify an ABHA"), false, b) : "") +
          (a.st.canCreate ? abdmBtn("abdm-create", wTH("ward.reg-abdm-create-abha", "Create an ABHA with Aadhaar"), false, b) : "") + "</div></div>";
    }
  }

  function sheetHtml(o) {
    var us = isUS(o);
    var mrLine = o.mode === "native"
      ? wT("ward.reg-mr-assigned-automatically", "A StewardMD MR number is assigned automatically.")
      : wT("ward.reg-mr-issued-by-emr", "The hospital EMR issues the MR number. Leave it blank if it has not been issued yet.");
    return '<div class="pr-wrap" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<div class="pr-card">' +
        '<header class="pr-head">' +
          '<div><h2 id="prTitle">' + wTH("ward.reg-new-patient", "New patient") + "</h2><p>" + (o.clinicName ? esc(o.clinicName) : wTH("ward.reg-check-in", "Check-in")) + "</p></div>" +
          '<button type="button" class="pr-x" data-a="cancel" aria-label="' + wTH("ward.reg-close", "Close") + '">&times;</button>' +
        "</header>" +

        '<div class="pr-body">' +
          '<div class="pr-dup" id="prDup" hidden></div>' +
          '<div style="display:flex;gap:8px;margin-bottom:14px">' +
            '<button type="button" class="pr-btn ghost" data-a="read-nfc" style="flex:1;padding:9px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">&#128241; ' + wTH("ward.reg-read-nfc", "Ni-Key: Read NFC Tag") + '</button>' +
            '<button type="button" class="pr-btn ghost" data-a="scan-qr" style="flex:1;padding:9px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">&#128247; ' + wTH("ward.reg-scan-qr", "Scan QR / Barcode") + '</button>' +
          '</div>' +

          '<h3 class="pr-sec">' + wTH("ward.reg-patient", "Patient") + "</h3>" +
          field("name", wT("ward.reg-full-name", "Full name"), { req: true, ph: wT("ward.reg-name-example", "e.g. Asha Kumar"), max: 80, auto: "name" }) +
          '<div class="pr-f" data-f="gender"><label>' + wTH("ward.reg-gender", "Gender") + '<i aria-hidden="true">*</i></label>' +
            seg("gender", genders(), "") + '<small class="pr-err" role="alert"></small></div>' +
          '<div class="pr-row">' +
            field("ageYears", wT("ward.reg-age-years", "Age (years)"), { req: true, mode: "numeric", max: 3, ph: "34" }) +
            field("ageMonths", wT("ward.reg-months", "Months"), { mode: "numeric", max: 2, ph: "0", hint: wT("ward.reg-for-infants", "For infants") }) +
          "</div>" +

          '<h3 class="pr-sec">' + wTH("ward.reg-contact", "Contact") + "</h3>" +
          field("mobile", us ? wT("ward.reg-mobile-us", "Mobile number (US)") : wT("ward.reg-mobile", "Mobile number"), { req: true, mode: "tel", max: 15, ph: us ? "(415) 555-0142" : "98765 43210", auto: "tel", hint: wT("ward.reg-queue-updates-sent-here", "Queue updates are sent here") }) +

          '<h3 class="pr-sec">' + wTH("ward.reg-visit", "Visit") + "</h3>" +
          '<div class="pr-f" data-f="visitType"><label>' + wTH("ward.reg-visit-type", "Visit type") + "</label>" + seg("visitType", visits(), "new") + "</div>" +
          deptHtml(o) +
          (o.mode === "native" ? "" : field("mrn", wT("ward.reg-hospital-mr-number", "Hospital MR number"), { ph: wT("ward.reg-leave-blank-if-not-issued", "Leave blank if not issued"), max: 40 })) +
          '<p class="pr-note">' + esc(mrLine) + "</p>" +

          '<button type="button" class="pr-more" data-a="more" aria-expanded="false">' +
            "<span>" + wTH("ward.reg-abha-address-referral", "ABHA, address &amp; referral") + "</span><span class=\"pr-chev\" aria-hidden=\"true\">&#9662;</span></button>" +
          '<div class="pr-opt" id="prOpt" hidden>' +
            '<h3 class="pr-sec">ABHA <small>' + wTH("ward.reg-ayushman-bharat-health-account", "Ayushman Bharat Health Account") + "</small></h3>" +
            (o.abdm ? abdmPanelHtml({ st: null }) : "") +
            field("abhaNumber", wT("ward.reg-abha-number", "ABHA number"), { mode: "numeric", max: 17, ph: "12-3456-7890-1234", hint: wT("ward.reg-14-digits", "14 digits") }) +
            field("abhaAddress", wT("ward.reg-abha-address", "ABHA address"), { ph: "name@abdm" }) +
            '<label class="pr-check" data-f="abhaConsent"><input type="checkbox" id="pr_abhaConsent">' +
              "<span>" + wTH("ward.reg-abha-consent", "The patient consents to linking these records to their ABHA.") + "</span></label>" +
            '<h3 class="pr-sec">' + wTH("ward.reg-address", "Address") + "</h3>" +
            field("address", wT("ward.reg-address", "Address"), { max: 200, ph: wT("ward.reg-address-example", "House, street, area") }) +
            '<div class="pr-row">' +
              field("district", wT("ward.reg-district", "District"), { max: 60 }) +
              // "tel" (not "numeric") for a US ZIP so the keypad offers "-" for the optional +4.
              field("pincode", us ? wT("ward.reg-zip-code", "ZIP code") : wT("ward.reg-pin-code", "PIN code"), { mode: us ? "tel" : "numeric", max: us ? 10 : 6, ph: us ? "90210 or 90210-1234" : "530045" }) +
            "</div>" +
            field("state", wT("ward.reg-state", "State"), { max: 60 }) +
            '<h3 class="pr-sec">' + wTH("ward.reg-referral", "Referral") + "</h3>" +
            field("referredBy", wT("ward.reg-referred-by", "Referred by"), { max: 80, ph: wT("ward.reg-referred-by-example", "Doctor or clinic") }) +
          "</div>" +
        "</div>" +

        '<footer class="pr-foot">' +
          '<div class="pr-ferr" id="prFerr" role="alert"></div>' +
          '<div class="pr-actions">' +
            '<button type="button" class="pr-btn ghost" data-a="cancel">' + wTH("ward.reg-cancel", "Cancel") + "</button>" +
            '<button type="button" class="pr-btn primary" data-a="save" id="prSave">' + esc(SUBMIT_LABEL) + "</button>" +
          "</div>" +
        "</footer>" +
      "</div></div>";
  }

  /* What became of a verified ABHA's binding to the new MR number. Said either way; a failure is never silent. */
  function abhaLinkHtml(l) {
    if (!l) return "";
    return l.ok ? '<p class="pr-note">' + wTH("ward.reg-abdm-linked", "The ABHA verified with ABDM is linked to this MR number.") + "</p>"
      : '<p class="pr-warn">' + wTH("ward.reg-abdm-link-failed", "The patient was registered, but the ABHA could not be linked to this MR number.") + (l.message ? " " + esc(l.message) : "") + "</p>";
  }
  function doneHtml(res) {
    var pending = !!res.pending;
    var sid = res.stewardId || "";
    var canonicalId = (res.stewardId || res.mrn || "").trim();
    /* 1-touch full identity package for a walk-in: the canonical single StewardID is shown,
     * programmed onto the physical folder's Ni-Key NFC tag (with read-back
     * verification), and printed on the matching file label (staff console only). A pending
     * temporary ID is queue-only - it must never be written to a tag or a label - so both stay hidden. */
    var tagRow = "";
    if (!pending && res.mrn) {
      tagRow = '<div class="pr-actions">' +
        '<button type="button" class="pr-btn" id="prWriteNfc" data-a="write-nfc" data-mrn="' + esc(canonicalId) + '"' + (sid ? ' data-sid="' + esc(sid) + '"' : "") + '>&#128241; ' + wTH("ward.reg-write-nfc", "Write Ni-Key NFC Tag") + "</button>" +
        ((root && typeof root.openFileLabel === "function")
          ? '<button type="button" class="pr-btn ghost" data-a="print-label">&#127991; ' + wTH("ward.reg-file-label", "File Label") + "</button>"
          : "") +
        "</div>";
    }
    return '<div class="pr-wrap" role="dialog" aria-modal="true" aria-labelledby="prTitle">' +
      '<div class="pr-card pr-done">' +
        '<div class="pr-tick" aria-hidden="true">&#10003;</div>' +
        '<h2 id="prTitle">' + wTH("ward.reg-name-added", "{name} added", { name: res.name ? esc(res.name) : wTH("ward.reg-patient", "Patient") }) + "</h2>" +
        '<p class="pr-mrlabel">' + (pending ? wTH("ward.reg-temporary-id", "Temporary ID") : (sid ? wTH("ward.reg-stewardid", "StewardID") : wTH("ward.reg-mr-number", "MR number"))) + "</p>" +
        '<p class="pr-mr">' + esc(canonicalId) + "</p>" +
        (pending
          ? '<p class="pr-warn">' + wTH("ward.reg-temporary-id-warning", "The hospital has not issued an MR number yet. This temporary ID is for the queue only - do not write it on hospital records. It is replaced automatically when the EMR issues the real number.") + "</p>"
          : '<p class="pr-note">' + wTH("ward.reg-write-on-slip", "Write this on the patient's slip.") + "</p>") +
        abhaLinkHtml(res.abhaLink) +
        tagRow +
        '<div class="pr-actions">' +
          '<button type="button" class="pr-btn ghost" data-a="another">' + wTH("ward.reg-add-another", "Add another") + "</button>" +
          '<button type="button" class="pr-btn primary" data-a="close">' + wTH("ward.reg-done", "Done") + "</button>" +
        "</div>" +
      "</div></div>";
  }

  // ---- controller -----------------------------------------------------------------------------
  // opts: { mode:"native"|"ghis"|"connect", clinicName, submit(payload)->Promise, onAdded(res) }
  /* What the submit button says. The OPD front desk queues a patient; a ward admits one to a bed.
   * Same sheet, same fields, two different acts - and until 2026-09-12 both read "Add to queue",
   * which told a doctor admitting to bed CAR-08 that they were queueing an outpatient. */
  var SUBMIT_LABEL = "Add to queue";
  function open(opts) {
    SUBMIT_LABEL = (opts && opts.submitLabel) || wT("ward.reg-add-to-queue", "Add to queue");
    opts = opts || {};
    var host = el(), state = { gender: "", visitType: "new", confirmDuplicate: false };
    host.className = "on";
    host.innerHTML = sheetHtml(opts);

    var q = function (id) { return host.querySelector("#pr_" + id); };
    function setErr(f, msg) {
      var w = host.querySelector('[data-f="' + f + '"]');
      if (!w) return;
      var e = w.querySelector(".pr-err");
      w.classList.toggle("bad", !!msg);
      if (e) e.textContent = msg || "";
    }
    function clearErrs() {
      Array.prototype.forEach.call(host.querySelectorAll(".pr-f, .pr-check"), function (w) {
        w.classList.remove("bad"); var e = w.querySelector(".pr-err"); if (e) e.textContent = "";
      });
      host.querySelector("#prFerr").textContent = "";
      var d = host.querySelector("#prDup"); d.hidden = true; d.innerHTML = "";
    }
    function val(id) { var n = q(id); return n ? n.value.trim() : ""; }

    function payload() {
      /* The StewardID is minted and reserved by the SERVER at registration (functions/_steward_id.js) and
       * shown from its answer. It used to be minted here, unique only within this browser tab, and the
       * server dropped it - so the number on the card resolved nowhere. Nothing is minted on the device. */
      return {
        name: val("name"), mobile: val("mobile"), gender: state.gender,
        ageYears: val("ageYears"), ageMonths: val("ageMonths"),
        visitType: state.visitType, mrn: val("mrn"),
        abhaNumber: val("abhaNumber"), abhaAddress: val("abhaAddress"),
        abhaConsent: !!(q("abhaConsent") && q("abhaConsent").checked),
        address: val("address"), district: val("district"), state: val("state"), pincode: val("pincode"),
        referredBy: val("referredBy"),
        departmentId: q("departmentId") ? q("departmentId").value : "",
        confirmDuplicate: state.confirmDuplicate,
        // Present only when ABDM verified or created this ABHA here; the server checks it before the MR is issued.
        abhaProof: abhaProof
      };
    }
    var abhaProof = "";

    /* ---- ABHA with ABDM: the controller for abdmPanelHtml ---- */
    var abdm = opts.abdm && typeof opts.abdm.step === "function" && typeof opts.abdm.status === "function" ? { st: null, mode: "" } : null;
    function paintAbdm() { var n = host.querySelector("#prAbdm"); if (n) n.outerHTML = abdmPanelHtml(abdm); }
    function abdmVal(id) { var n = q(id); return n ? n.value.trim() : ""; }
    function abdmRefusal(r) {
      if (!r) return wT("ward.reg-abdm-no-response", "No response from the server. The step may not have reached ABDM; try it again.");
      if (r.error === "abdm_not_connected") return abdmReason(r.code);
      if (r.error === "abha_role_refused") return wT("ward.reg-abdm-role-refused", "Your role cannot do that here.");
      if (r.error === "abdm") return wT("ward.reg-abdm-said", "ABDM refused: {message}", { message: r.message || "" });
      return r.message ? String(r.message) : wT("ward.reg-abdm-step-failed", "That step did not complete. Nothing was recorded.");
    }
    function abdmStep(body, onOk) {
      abdm.busy = true; abdm.err = ""; paintAbdm();
      Promise.resolve(opts.abdm.step(body)).then(function (r) {
        abdm.busy = false;
        if (r && r.ok) onOk(r); else abdm.err = abdmRefusal(r);
        paintAbdm();
      }, function () { abdm.busy = false; abdm.err = abdmRefusal(null); paintAbdm(); });
    }
    function setField(id, v, lock) {
      var n = q(id); if (!n) return;
      if (v != null && v !== "") n.value = v;
      n.readOnly = !!lock;
    }
    /* how: "verified" | "created" here, or "shared" when the patient shared their ABDM profile (opts.prefill). */
    function abdmApply(profile, proof, how) {
      if (!proof) { if (abdm) abdm.err = wT("ward.reg-abdm-no-proof", "ABDM answered, but this server could not sign the verification, so the ABHA is not marked verified."); return; }
      var p = profile || {};
      abhaProof = proof;
      if (abdm) { abdm.proof = proof; abdm.profile = p; abdm.done = how; abdm.mode = ""; }
      setField("name", p.name, true);
      setField("abhaNumber", fmtAbha(p.abhaNumber), true);
      setField("abhaAddress", p.abhaAddress, true);
      if (!val("mobile") && p.mobile) setField("mobile", p.mobile);
      if (!val("address") && p.address) setField("address", p.address);
      var g = { M: "male", F: "female", O: "other", T: "other" }[String(p.gender || "").toUpperCase()];
      if (g) {
        state.gender = g;
        Array.prototype.forEach.call(host.querySelectorAll('[data-seg="gender"] .pr-segb'), function (x) {
          var on = x.getAttribute("data-v") === g; x.classList.toggle("on", on); x.setAttribute("aria-checked", on);
        });
      }
      /* Age from ABDM's date of birth (D-M-YYYY) when whole, else its year of birth. */
      var dm = String(p.dob || "").match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/), now = new Date(), years = null;
      if (dm) { years = now.getFullYear() - (+dm[3]); if (now.getMonth() + 1 < +dm[2] || (now.getMonth() + 1 === +dm[2] && now.getDate() < +dm[1])) years--; }
      else if (/^\d{4}$/.test(String(p.yearOfBirth || ""))) years = now.getFullYear() - (+p.yearOfBirth);
      if (years != null && years >= 0 && years < 130) setField("ageYears", String(years));
      if (how === "created") { var cb = q("abhaConsent"); if (cb) cb.checked = true; }   // the patient agreed to linking in ABDM's consent
    }
    function abdmReset() {
      if (abhaProof) { abhaProof = ""; setField("name", null, false); setField("abhaNumber", "", false); setField("abhaAddress", "", false); q("abhaNumber").value = ""; q("abhaAddress").value = ""; }
      var st = abdm.st; abdm = { st: st, mode: "" }; paintAbdm();
    }
    function abdmAddresses(txnId) {
      abdmStep({ step: "suggestions", txnId: txnId }, function (s) {
        abdm.txnId = s.txnId;
        if (s.suggestions.length) { abdm.suggestions = s.suggestions; abdm.mode = "create-address"; }
        else abdmApply(abdm.pending.profile, abdm.pending.proof, "created");
      });
    }
    /* SCAN AND SHARE: the profile a patient shared through ABDM, pre-filled (functions/_wardsynq/abdm-share.js). With the
     * desk's proof the ABHA is bound to the MR number as verified; everything else stays editable. */
    var pf = opts.prefill;
    if (pf) {
      ["mobile", "address", "district", "state", "pincode"].forEach(function (k) { if (pf[k]) setField(k, String(pf[k])); });
      var twoDigits = /^\d{1,2}$/, pdob = twoDigits.test(String(pf.dayOfBirth || "")) && twoDigits.test(String(pf.monthOfBirth || "")) && /^\d{4}$/.test(String(pf.yearOfBirth || "")) ? pf.dayOfBirth + "-" + pf.monthOfBirth + "-" + pf.yearOfBirth : "";
      var shared = { name: pf.name, abhaNumber: pf.abhaNumber, abhaAddress: pf.abhaAddress, gender: pf.gender, yearOfBirth: pf.yearOfBirth, dob: pdob };
      if (pf.abhaProof) abdmApply(shared, pf.abhaProof, "shared");
      else { if (pf.name) setField("name", pf.name); if (pf.abhaNumber) setField("abhaNumber", fmtAbha(pf.abhaNumber)); if (pf.abhaAddress) setField("abhaAddress", pf.abhaAddress); }
      var popt = host.querySelector("#prOpt"), pmore = host.querySelector('[data-a="more"]');
      if (popt && (pf.abhaNumber || pf.abhaAddress)) { popt.hidden = false; if (pmore) { pmore.setAttribute("aria-expanded", "true"); pmore.classList.add("open"); } }
    }
    if (abdm) {
      Promise.resolve(opts.abdm.status()).then(function (r) {
        abdm.st = r && r.ok && r.connection ? r : false; paintAbdm();
      }, function () { abdm.st = false; paintAbdm(); });
    }
    function abdmAct(a) {
      if (a === "abdm-reset") return abdmReset();
      if (a === "abdm-verify") { abdm.mode = "verify-id"; abdm.err = ""; return paintAbdm(); }
      if (a === "abdm-verify-send" || a === "abdm-verify-resend") {
        var id = a === "abdm-verify-send" ? abdmVal("abdmId") : abdm.abhaId, sys = a === "abdm-verify-send" ? abdmVal("abdmOtpSys") : abdm.otpSystem;
        if (!id) { abdm.err = wT("ward.reg-abdm-enter-id", "Enter the ABHA number or ABHA address."); return paintAbdm(); }
        /* ABDM allows another OTP after 60 seconds, at least twice (CRT_ABHA_106); this sheet offers exactly that. */
        if (a === "abdm-verify-resend") {
          var wait = 60 - Math.floor((Date.now() - (abdm.sentAt || 0)) / 1000);
          if (wait > 0) { abdm.err = wT("ward.reg-abdm-wait", "Wait {seconds} seconds before asking for another OTP.", { seconds: wait }); return paintAbdm(); }
          if ((abdm.resends || 0) >= 2) { abdm.err = wT("ward.reg-abdm-no-more-otps", "No more OTPs can be sent for this attempt. Start again."); return paintAbdm(); }
          abdm.resends = (abdm.resends || 0) + 1;
        }
        return abdmStep({ step: "verify-otp", abhaId: id, otpSystem: sys }, function (r) {
          abdm.abhaId = id; abdm.otpSystem = r.otpSystem; abdm.txnId = r.txnId; abdm.addressFlow = r.addressFlow === true; abdm.sentAt = Date.now(); abdm.mode = "verify-otp";
        });
      }
      if (a === "abdm-verify-confirm") {
        var otp = abdmVal("abdmOtp");
        if (!/^\d{6}$/.test(otp)) { abdm.err = wT("ward.reg-abdm-otp-6", "Enter the 6-digit OTP."); return paintAbdm(); }
        return abdmStep({ step: "verify-confirm", txnId: abdm.txnId, otp: otp, addressFlow: abdm.addressFlow, otpSystem: abdm.otpSystem }, function (r) {
          if (r.linkedTo) { abdm.linkedTo = r.linkedTo; return; }
          abdmApply(r.profile, r.proof, "verified");
        });
      }
      if (a === "abdm-create") {
        abdm.mode = "create-consent"; abdm.consent = null; abdm.err = ""; paintAbdm();
        return abdmStep({ step: "consent-text", patientName: val("name") }, function (r) { abdm.consent = r.consent; });
      }
      if (a === "abdm-consent") {
        var agreed = Array.prototype.map.call(host.querySelectorAll(".pr-abdmc:checked"), function (n) { return n.getAttribute("data-id"); });
        return abdmStep({ step: "consent", agreed: agreed }, function (r) { abdm.consentId = r.consentId; abdm.mode = "create-aadhaar"; });
      }
      if (a === "abdm-aadhaar-send") {
        var aad = abdmVal("abdmAadhaar");
        if (!validAadhaar(aad)) { abdm.err = wT("ward.reg-abdm-aadhaar-invalid", "That is not a valid Aadhaar number. Check the digits."); return paintAbdm(); }
        return abdmStep({ step: "enrol-otp", consentId: abdm.consentId, aadhaar: aad }, function (r) { abdm.txnId = r.txnId; abdm.mode = "create-otp"; });
      }
      if (a === "abdm-enrol-verify") {
        var eotp = abdmVal("abdmOtp"), mob = abdmVal("abdmMobile").replace(/\D/g, "");
        if (!/^\d{6}$/.test(eotp)) { abdm.err = wT("ward.reg-abdm-otp-6", "Enter the 6-digit OTP."); return paintAbdm(); }
        if (!/^[6-9]\d{9}$/.test(mob)) { abdm.err = wT("ward.reg-abdm-mobile-10", "Enter a 10-digit mobile number."); return paintAbdm(); }
        return abdmStep({ step: "enrol-verify", txnId: abdm.txnId, otp: eotp, mobile: mob }, function (r) {
          abdm.txnId = r.txnId;
          if (r.linkedTo) { abdm.linkedTo = r.linkedTo; return; }
          abdm.pending = { profile: r.profile, proof: r.proof };
          if (r.mobileVerified) { setTimeout(function () { abdmAddresses(r.txnId); }, 0); return; }
          setTimeout(function () {
            abdmStep({ step: "mobile-otp", txnId: r.txnId, mobile: mob }, function (m) { abdm.txnId = m.txnId; abdm.mode = "create-mobile"; });
          }, 0);
        });
      }
      if (a === "abdm-mobile-verify") {
        var motp = abdmVal("abdmOtp");
        if (!/^\d{6}$/.test(motp)) { abdm.err = wT("ward.reg-abdm-otp-6", "Enter the 6-digit OTP."); return paintAbdm(); }
        return abdmStep({ step: "mobile-verify", txnId: abdm.txnId, otp: motp }, function (r) { abdm.txnId = r.txnId; setTimeout(function () { abdmAddresses(r.txnId); }, 0); });
      }
      if (a === "abdm-address") {
        var pick = host.querySelector('input[name="prAbdmAddr"]:checked');
        if (!pick) { abdm.err = wT("ward.reg-abdm-pick-one", "Choose an ABHA address."); return paintAbdm(); }
        return abdmStep({ step: "address", txnId: abdm.txnId, abhaAddress: pick.value, proof: abdm.pending.proof }, function (r) {
          var prof = Object.assign({}, abdm.pending.profile, { abhaNumber: r.abhaNumber, abhaAddress: r.abhaAddress });
          abdmApply(prof, r.proof, "created");
        });
      }
    }

    // Local hints only — the server is the authority. This just avoids a round trip for the obvious.
    function localCheck() {
      var ok = true;
      if (val("name").length < 2) { setErr("name", wT("ward.reg-enter-full-name", "Enter the patient's full name.")); ok = false; }
      if (!state.gender) { setErr("gender", wT("ward.reg-select-gender", "Select the patient's gender.")); ok = false; }
      /* Digit-count check DROPPED (not region-swapped): it hardcoded India's "strip a leading 91/0,
       * want 10 digits" shape, so a correct "+14155550132" (US, 11 digits, no 91/0 to strip) failed
       * here even though the server now accepts it. functions/_region.js is the one place country
       * phone rules live, and this plain script can't import it - duplicating the US rule here in a
       * second, ES5 copy is exactly the drift this file's own header warns about. Required-ness is
       * still worth catching locally; the shape is the server's answer, per the comment up top. */
      if (!val("mobile")) { setErr("mobile", wT("ward.reg-mobile-required", "Mobile number is required.")); ok = false; }
      if (!val("ageYears") && !val("ageMonths")) { setErr("ageYears", wT("ward.reg-enter-age", "Enter the patient's age.")); ok = false; }
      if (opts.departmentRequired && q("departmentId") && !q("departmentId").value) { setErr("departmentId", wT("ward.reg-choose-department-for-token", "Choose a department to give a token.")); ok = false; }
      return ok;
    }

    function showDuplicate(dup) {
      var d = host.querySelector("#prDup");
      dup = dup || {};
      d.hidden = false;
      /* The duplicate may have matched on StewardID, MRN or phone: name every identifier the
       * server sent back so the desk can find the existing record instead of guessing. */
      var ids = [(dup.stewardId ? "StewardID " + dup.stewardId : ""), (dup.mrn || ""), (dup.mobile || "")].filter(Boolean).join("  ·  ");
      var who = dup.mrn || dup.stewardId || dup.mobile || "";
      d.innerHTML = "<b>" + wTH("ward.reg-mobile-already-registered", "This mobile is already registered") + "</b>" +
        "<span>" + wTH("ward.reg-duplicate-explain", "{mrn} is using this number. If this is the same person, open their record instead. If it is a different patient sharing the phone, continue.", { mrn: esc(who) }) + "</span>" +
        (ids ? '<span class="pr-dupids" lang="en">' + esc(ids) + "</span>" : "") +
        '<button type="button" class="pr-btn ghost" data-a="dup-continue">' + wTH("ward.reg-different-patient", "This is a different patient") + "</button>";
      d.scrollIntoView({ block: "nearest" });
    }

    function save() {
      clearErrs();
      if (!localCheck()) return;
      var btn = host.querySelector("#prSave");
      btn.disabled = true; btn.textContent = wT("ward.reg-adding", "Adding…");
      var reset = function () { btn.disabled = false; btn.textContent = SUBMIT_LABEL; };
      var sent = payload();
      Promise.resolve(opts.submit(sent)).then(function (r) {
        if (r && r.ok) {
          state.doneMrn = r.mrn || "";
          state.doneStewardId = r.stewardId || sent.stewardId || r.mrn || "";
          if (r.mrn && !r.stewardId) state.doneStewardId = r.mrn;
          host.innerHTML = doneHtml({ mrn: r.mrn, stewardId: state.doneStewardId, pending: r.pending, name: val("name"), abhaLink: r.abhaLink });
          // The answers travel with the result so the caller queues the patient in the department chosen.
          try { if (opts.onAdded) opts.onAdded(r, sent); } catch (e) {}
          return;
        }
        reset();
        if (r && r.error === "duplicate" && r.duplicateOf) { showDuplicate(r.duplicateOf); return; }
        if (r && r.errors) {
          Object.keys(r.errors).forEach(function (k) { setErr(k === "age" ? "ageYears" : k, r.errors[k]); });
          // A refusal about the queue (D14) may name a field the sheet is not showing: say it at the foot too.
          if (r.errors.departmentId && r.message) host.querySelector("#prFerr").textContent = r.message;
          // An ABHA refusal (already another patient's, or no longer verified) names a field inside the folded section.
          if (r.errors.abhaNumber) {
            var opt = host.querySelector("#prOpt"), more = host.querySelector('[data-a="more"]');
            if (opt && opt.hidden) { opt.hidden = false; if (more) { more.setAttribute("aria-expanded", "true"); more.classList.add("open"); } }
            if (r.message) host.querySelector("#prFerr").textContent = r.message;
          }
          var first = host.querySelector(".pr-f.bad input");
          if (first) first.focus();
          return;
        }
        /* Prefer the server's own sentence. It knows WHICH refusal this is - no role granted, not
         * on this clinic's staff list, wrong clinic, outside your departments - and each has a
         * different fix. This flattened all of them to "You do not have permission", which tells
         * the person at the desk nothing they can act on and sends them to the owner with no idea
         * what to ask for. The message carries a clinic id and a role name, never patient data. */
        host.querySelector("#prFerr").textContent =
          (r && r.message) ? r.message
            : (r && r.error === "forbidden") ? wT("ward.reg-no-permission", "You do not have permission to add patients.")
              : wT("ward.reg-could-not-add", "Could not add the patient. Check your connection and try again.");
      }).catch(function () {
        reset();
        host.querySelector("#prFerr").textContent = wT("ward.reg-could-not-reach-server", "Could not reach the server. Try again.");
      });
    }

    /* LT-29 (retest 2026-09-16): the sheet belongs to the screen that opened it. The "added" card stayed over the ED
     * board after the Patients page navigated there, covering Find. Moving to another screen closes it; nothing on
     * the card is unsaved (the patient was already added, and the number is on their record). */
    function onHash() { close(); }
    function close() { host.className = ""; host.innerHTML = ""; try { root.removeEventListener("hashchange", onHash); } catch (e) {} }

    /* Programs the canonical StewardID (falling back to the MR number when the record has no
     * StewardID yet) onto the physical folder's Ni-Key NFC tag: plain text (every phone camera and
     * wedge reader takes it) plus the /opd deep link, with read-back verification so a half-written
     * tag is reported instead of handed over. The button narrates each step; a failure leaves
     * it tappable so the desk can retry with another tag. Never fires without an MR number. */
    function writeNfc(btn) {
      var mrn = "";
      try { mrn = btn.getAttribute("data-mrn") || ""; } catch (e) {}
      mrn = mrn || state.doneMrn || "";
      var sid = "";
      try { sid = (btn && btn.getAttribute("data-sid")) || ""; } catch (e) {}
      sid = sid || state.doneStewardId || "";
      if (!mrn || !btn) return;
      var NFC = root.SMD_NFC;
      if (!NFC || typeof NFC.writeTag !== "function") {
        btn.textContent = wT("ward.reg-nfc-unavailable", "NFC is not available on this device");
        return;
      }
      btn.disabled = true;
      btn.textContent = wT("ward.reg-nfc-hold-tag", "Hold tag against phone...");
      NFC.writeTag({ text: sid || mrn, url: "https://stewardmd.in/opd?uid=" + encodeURIComponent(sid || mrn) }, { verifyReadBack: true }).then(function () {
        /* The desk just issued this carrier: register it so a later tap in this session resolves
         * to this patient (and a later lost-tag report can revoke it). Best-effort only. */
        try {
          if (root.StewardIdentityResolver && root.StewardIdentityResolver.registerCarrier) {
            root.StewardIdentityResolver.registerCarrier({ patientId: sid || mrn, stewardId: sid || mrn, type: "nfc", value: sid || mrn, issuedBy: "frontdesk" });
          }
        } catch (e) {}
        btn.disabled = false;
        btn.textContent = "\u2713 " + wT("ward.reg-nfc-written", "NFC Tag Written!");
      }, function () {
        btn.disabled = false;
        btn.textContent = wT("ward.reg-nfc-failed", "Could not write the tag. Try again.");
      });
    }
    try { root.removeEventListener("hashchange", open._onHash); root.addEventListener("hashchange", onHash); open._onHash = onHash; } catch (e) {}

    host.onclick = function (ev) {
      var t = ev.target;
      var segb = t.closest && t.closest(".pr-segb");
      if (segb) {
        var g = segb.parentNode.getAttribute("data-seg");
        state[g] = segb.getAttribute("data-v");
        Array.prototype.forEach.call(segb.parentNode.querySelectorAll(".pr-segb"), function (b) {
          var on = b === segb; b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
        });
        setErr(g, "");
        return;
      }
      var b = t.closest && t.closest("[data-a]");
      if (!b) return;
      var a = b.getAttribute("data-a");
      if (abdm && a.indexOf("abdm-") === 0) return abdmAct(a);
      if (a === "cancel" || a === "close") return close();
      if (a === "save") return save();
      if (a === "another") { open(opts); return; }
      function applyResolvedIdentity(uhid, carrierType) {
        var code = "";
        try {
          if (root.StewardIdentityResolver && root.StewardIdentityResolver.normalizeCarrierValue) {
            code = root.StewardIdentityResolver.normalizeCarrierValue(uhid);
          }
        } catch (e) {}
        if (!code) code = String(uhid == null ? "" : uhid).trim().toUpperCase();
        if (!code) return;
        /* Universal Patient Identity: resolve the carrier to a canonical record first. A revoked
         * tag stops here; an existing patient prefills the sheet (and is a follow-up, reusing
         * their StewardID so this registration never mints a duplicate identity). An unknown
         * tag keeps the fast path: stamp the id and queue as follow-up. */
        var hit = null;
        try {
          if (root.StewardIdentityResolver && root.StewardIdentityResolver.resolvePatientIdentity) {
            var res = root.StewardIdentityResolver.resolvePatientIdentity({ type: carrierType || "qr", value: code });
            if (res && !res.then && res.ok === false && res.error === "CARRIER_REVOKED") {
              if (root.toast) root.toast(wT("ward.reg-carrier-revoked", "CARRIER REVOKED: This tag was marked lost or deactivated. Please issue a replacement card."));
              return;
            }
            if (res && !res.then && res.ok && res.patient) hit = res;
          }
        } catch (e) { hit = null; }
        if (hit && hit.patient) {
          var p = hit.patient;
          state.stewardId = hit.stewardId || uhid;
          if (p.name && q("name") && !q("name").value) q("name").value = p.name;
          if ((p.mobile || p.phone) && q("mobile") && !q("mobile").value) q("mobile").value = p.mobile || p.phone;
          if ((p.ageYears || p.age) && q("ageYears") && !q("ageYears").value) q("ageYears").value = p.ageYears || p.age;
          var g = String(p.gender || p.sex || "").toLowerCase();
          if (g === "female" || g === "male" || g === "other") {
            var gb = host.querySelector('[data-seg="gender"] [data-v="' + g + '"]');
            if (gb) gb.click();
          }
        }
        var mrnInput = host.querySelector('[data-f="mrn"] input');
        if (mrnInput) mrnInput.value = code;
        var nameInput = host.querySelector('[data-f="name"] input');
        if (nameInput && !nameInput.value) nameInput.value = code;
        var followBtn = host.querySelector('[data-f="visitType"] [data-v="followup"]');
        if (followBtn) followBtn.click();
        if (root.toast) root.toast(carrierType === "nfc" ? wT("ward.reg-tag-read", "Ni-Key Tag read: {code}", { code: code }) : wT("ward.reg-scanned-code", "Scanned code: {code}", { code: code }));
      }
      if (a === "scan-qr") {
        if (root.WARD_LABELS && root.WARD_LABELS.cameraSupported && root.WARD_LABELS.cameraSupported()) {
          root.WARD_LABELS.scan().then(function (res) {
            if (res && res.code) applyResolvedIdentity(res.code, res.format || "qr");
            else if (res && res.error === "denied") {
              if (root.toast) root.toast(wT("ward.reg-camera-denied", "Camera permission denied. Tap the lock icon in the address bar, open Site Settings and set Camera to Allow."));
            } else if (res && !res.cancelled) {
              if (root.toast) root.toast(wT("ward.reg-camera-scan-failed", "Camera scan failed."));
            }
          });
          return;
        }
        var pVal = prompt(wT("ward.reg-scan-or-type", "Scan or type QR / Barcode / StewardID:"));
        if (pVal && pVal.trim()) applyResolvedIdentity(pVal.trim(), "qr");
        return;
      }
      if (a === "read-nfc") {
        var sBtn = b;
        sBtn.disabled = true;
        sBtn.textContent = wT("ward.reg-hold-tag", "Hold Ni-Key tag to phone…");
        var resetScan = function () { sBtn.disabled = false; sBtn.textContent = "\uD83D\uDCF1 " + wT("ward.reg-read-nfc", "Ni-Key: Read NFC Tag"); };
        var NFC = root.SMD_NFC || root.NiKey;
        if (!NFC || typeof NFC.startScan !== "function") {
          resetScan();
          if (root.toast) root.toast(wT("ward.reg-nfc-unavailable", "NFC is not available on this device"));
          return;
        }
        NFC.startScan(function (tag) {
          var uhid = (NFC.parseTagUhid && NFC.parseTagUhid(tag)) || "";
          if (!uhid) {
            resetScan();
            if (root.toast) root.toast(wT("ward.reg-tag-empty", "Ni-Key tag is empty / unassigned."));
            return;
          }
          /* Universal Patient Identity: resolve the tag to a canonical record first. A revoked
           * tag stops here; an existing patient prefills the sheet (and is a follow-up, reusing
           * their StewardID so this registration never mints a duplicate identity). An unknown
           * tag keeps the fast path: stamp the id and queue as follow-up. */
          var hit = null;
          try {
            if (root.StewardIdentityResolver && root.StewardIdentityResolver.resolvePatientIdentity) {
              var res = root.StewardIdentityResolver.resolvePatientIdentity({ type: "nfc", value: uhid });
              if (res && !res.then && res.ok === false && res.error === "CARRIER_REVOKED") {
                resetScan();
                if (root.toast) root.toast(wT("ward.reg-carrier-revoked", "CARRIER REVOKED: This tag was marked lost or deactivated. Please issue a replacement card."));
                return;
              }
              if (res && !res.then && res.ok && res.patient) hit = res;
            }
          } catch (e) { hit = null; }
          sBtn.textContent = "\u2713 " + uhid;
          sBtn.disabled = false;
          state.stewardId = (hit && hit.stewardId) || uhid;
          applyResolvedIdentity(uhid, "nfc", hit);
        }).catch(function (err) {
          resetScan();
          var msg = (err && err.message) ? err.message : String(err || "");
          if (/permission.*denied/i.test(msg) || (err && (err.name === "NotAllowedError" || err.code === "PERMISSION_DENIED"))) {
            if (root.toast) root.toast(wT("ward.reg-nfc-denied", "NFC permission denied. Tap the lock icon in the address bar, open Site Settings and set NFC to Allow."));
            return;
          }
          if (root.toast) root.toast(wT("ward.reg-nfc-read-error", "Ni-Key NFC read error: {msg}", { msg: msg }));
        });
        return;
      }
      if (a === "write-nfc") return writeNfc(b);
      if (a === "print-label") { try { if (root.openFileLabel) root.openFileLabel(state.doneMrn, state.doneStewardId); } catch (e) {} return; }
      if (a === "dup-continue") { state.confirmDuplicate = true; host.querySelector("#prDup").hidden = true; return save(); }
      if (a === "more") {
        var panel = host.querySelector("#prOpt"), on = panel.hidden;
        panel.hidden = !on; b.setAttribute("aria-expanded", on);
        b.classList.toggle("open", on);
        return;
      }
    };
    host.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
      if (ev.key === "Enter" && ev.target && ev.target.tagName === "INPUT") { ev.preventDefault(); save(); }
    });
    var n = q("name"); if (n) n.focus();
    return { close: close };
  }

  root.SMD_PATIENTREG = { open: open, _sheetHtml: sheetHtml, _doneHtml: doneHtml, _abdmPanelHtml: abdmPanelHtml, _validAadhaar: validAadhaar };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SMD_PATIENTREG;
})(typeof window !== "undefined" ? window : null);
