/* abdm.js — ABHA (ABDM Milestone 1) at the registration desk. Exposes window.SMD_ABDM.
 *
 * WHAT THIS IS FOR. A patient arrives with no ABHA, or with one they cannot recite. Today the desk types
 * their name, age and mobile by hand and gets it wrong often enough to matter. With ABHA the demographics
 * come from Aadhaar, verified, and the patient's records from every other facility become reachable.
 *
 * THE CONSENT SCREEN IS NOT DECORATION. Certification CRT_ABHA_102 requires ABDM's OWN published consent
 * language to be shown and the patient's agreement recorded, and the Aadhaar-OTP page requires it collected
 * BEFORE the OTP is requested. So this module cannot ask for an Aadhaar number until the server has issued
 * a consent id. The text is fetched from the server rather than written here, so there is exactly one copy
 * of it and a UI edit cannot drift from the published wording.
 *
 * PHI: the Aadhaar number and OTP live in a form field and go straight to our server, which RSA-encrypts
 * them before they reach ABDM. Nothing is written to localStorage, and the Aadhaar number is never echoed
 * back into the DOM after the step that collects it. ABDM's own rule: the Aadhaar number must not be
 * stored by the HMIS.
 *
 * Flag: smd_abdm (default OFF; ?abdm=1 or localStorage "1" enables). Server-side ABDM_M1_FLAG gates the
 * API independently, so a client flag alone cannot reach ABDM.
 */
(function () {
  "use strict";

  function flagOn() {
    try {
      var q = (location.search.match(/[?&]abdm=([^&]+)/) || [])[1];
      if (q != null) return q !== "0";
      return localStorage.getItem("smd_abdm") === "1";
    } catch (e) { return false; }
  }
  function apiBase() {
    try { var h = location.hostname || ""; return /(^|\.)stewardmd\.in$/i.test(h) ? "" : "https://stewardmd.in"; }
    catch (e) { return "https://stewardmd.in"; }
  }
  function token() {
    try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function tt(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function el(id) { return document.getElementById(id); }

  /* ---- API ------------------------------------------------------------------------------------- */
  function call(path, body, method) {
    return token().then(function (t) {
      if (!t) return { error: "unauthorized" };
      var opt = { method: method || (body ? "POST" : "GET"), headers: { Authorization: "Bearer " + t } };
      if (body) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
      return fetch(apiBase() + "/api/abdm" + path, opt)
        .then(function (r) { return r.json().catch(function () { return { error: "bad_response" }; }); })
        .catch(function () { return { error: "network" }; });
    });
  }
  // ABDM's own message is what the certification cases check for, so it is shown verbatim when present.
  function errText(r) {
    if (!r) return "Something went wrong.";
    if (r.message) return r.message;
    if (r.error === "unauthorized") return "Sign in first.";
    if (r.error === "forbidden") return "You are not a member of that hospital.";
    if (r.error === "network") return "No connection.";
    if (r.error === "abdm_unavailable") return "ABDM is not responding. Try again shortly.";
    return String(r.error || "Something went wrong.");
  }

  /* ---- Verhoeff: ABDM requires the Aadhaar checksum to be validated BEFORE the OTP call --------- */
  // "The system must check if this is a valid Aadhaar number using the verhoeff algorithm" (CRT_ABHA_104).
  // Checking it here saves the patient a pointless failed OTP and a wasted UIDAI call.
  var V_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
  var V_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
  function validAadhaar(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    if (d.length !== 12 || d.charAt(0) === "0" || d.charAt(0) === "1") return false;
    var c = 0;
    for (var i = 0; i < d.length; i++) c = V_D[c][V_P[i % 8][+d.charAt(d.length - 1 - i)]];
    return c === 0;
  }
  var validMobile = function (v) { return /^[6-9][0-9]{9}$/.test(String(v == null ? "" : v).replace(/\D/g, "")); };
  var validOtp = function (v) { return /^[0-9]{6}$/.test(String(v == null ? "" : v).trim()); };

  /* ---- shell ----------------------------------------------------------------------------------- */
  var S = {};   // the in-flight enrolment: consentId, txnId, tokens, profile. Never persisted.

  function close() { var o = el("smdAbdmOverlay"); if (o) o.remove(); S = {}; }

  function shell(title, sub) {
    close();
    var ov = document.createElement("div");
    ov.id = "smdAbdmOverlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:var(--paper,#0b1016);color:var(--ink,#e8eef4);" +
      "display:flex;flex-direction:column;font-family:var(--hfont,-apple-system,sans-serif)";
    ov.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;border-bottom:1px solid var(--line,#22303c)">' +
        '<b style="flex:1;font-size:15px" id="abTitle">' + esc(title) + '</b>' +
        '<button id="abClose" style="background:transparent;color:var(--ink,#e8eef4);border:1px solid var(--line,#3a4a5a);border-radius:8px;padding:7px 12px;font-weight:700">Close</button></div>' +
      '<div id="abSub" style="padding:10px 14px 0;font-size:12.5px;color:var(--slate,#9bb0c2)">' + esc(sub || "") + '</div>' +
      '<div id="abBody" style="padding:14px;overflow:auto;flex:1"></div>' +
      '<div id="abMsg" style="padding:0 14px calc(env(safe-area-inset-bottom,0px) + 12px);font-size:12.5px"></div>';
    document.body.appendChild(ov);
    el("abClose").onclick = close;
    return el("abBody");
  }
  function msg(kind, text) {
    var m = el("abMsg"); if (!m) return;
    var c = kind === "err" ? "#e5484d" : kind === "ok" ? "var(--teal,#0e6e63)" : "var(--slate,#9bb0c2)";
    m.innerHTML = '<span style="color:' + c + '">' + esc(text) + "</span>";
  }
  var IN = "width:100%;margin:5px 0 12px;padding:10px;border-radius:9px;background:var(--panel,#111820);" +
    "color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c);font-size:15px";
  var BTN = "background:var(--teal,#0e6e63);color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;font-size:14px";
  var GHOST = "background:transparent;color:var(--ink,#e8eef4);border:1px solid var(--line,#3a4a5a);border-radius:9px;padding:10px 18px;font-weight:700;font-size:14px";
  var LBL = "font-size:12px;font-weight:700;display:block";

  /* ---- step 1: consent ------------------------------------------------------------------------- */
  // The published language, fetched from the server so there is one copy of it. Nothing about this screen
  // is skippable: no consent id, no Aadhaar field.
  function openCreate(opts) {
    if (!flagOn()) { tt("ABHA is off."); return; }
    opts = opts || {};
    S = { tenantId: opts.tenantId || "", patientRef: opts.patientRef || "", patientName: opts.patientName || "" };
    var body = shell("Create ABHA", "Step 1 of 4: consent");
    body.innerHTML = '<div style="font-size:13px;color:var(--slate,#9bb0c2)">Loading the consent language...</div>';

    var qs = "?flow=aadhaar&patientName=" + encodeURIComponent(S.patientName);
    call("/meta" + qs).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = ""; msg("err", errText(r)); return; }
      renderConsent(body, r.data.consentLanguage);
    });
  }

  function renderConsent(body, c) {
    if (!c) { msg("err", "The consent language is unavailable, so an ABHA cannot be created."); return; }
    var rowsHtml = c.clauses.map(function (cl, i) {
      return '<label style="display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;line-height:1.45">' +
        '<input type="checkbox" class="abClause" data-id="' + esc(cl.id) + '" ' + (cl.defaultChecked ? "checked" : "") +
          ' style="margin-top:3px;width:18px;height:18px;flex:0 0 auto">' +
        '<span style="font-size:13px">' + esc(cl.text) + "</span></label>";
    }).join("");
    var attHtml = c.attestations.map(function (a) {
      return '<label style="display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;line-height:1.45">' +
        '<input type="checkbox" class="abClause" data-id="' + esc(a.id) + '" style="margin-top:3px;width:18px;height:18px;flex:0 0 auto">' +
        '<span style="font-size:13px">' + esc(a.text) + "</span></label>";
    }).join("");

    body.innerHTML =
      '<div style="background:var(--panel,#111820);border:1px solid var(--line,#22303c);border-radius:12px;padding:12px;margin-bottom:12px">' +
        '<div style="font-size:12.5px;color:var(--slate,#9bb0c2)">' + esc(c.advice.doubleScreen) + " " + esc(c.advice.localLanguage) + "</div></div>" +
      '<div style="font-weight:700;font-size:14px;margin:0 0 12px">' + esc(c.heading) + "</div>" +
      rowsHtml +
      '<div style="height:1px;background:var(--line,#22303c);margin:6px 0 16px"></div>' +
      attHtml +
      '<button id="abConsent" style="' + BTN + ';width:100%">Agree and continue</button>' +
      '<div style="font-size:11.5px;color:var(--slate,#9bb0c2);margin-top:10px">Consent language version ' + esc(c.version) + "</div>";

    el("abConsent").onclick = function () {
      var agreed = [].slice.call(document.querySelectorAll(".abClause"))
        .filter(function (n) { return n.checked; })
        .map(function (n) { return n.getAttribute("data-id"); });
      msg("", "Recording consent...");
      call("/consent", { tenantId: S.tenantId, patientRef: S.patientRef, agreed: agreed, flow: "aadhaar" })
        .then(function (r) {
          if (!r || !r.ok) { msg("err", errText(r)); return; }
          S.consentId = r.data.id;
          stepAadhaar();
        });
    };
  }

  /* ---- step 2: Aadhaar + OTP ------------------------------------------------------------------- */
  function stepAadhaar() {
    var body = shell("Create ABHA", "Step 2 of 4: Aadhaar");
    body.innerHTML =
      '<label style="' + LBL + '">Aadhaar number</label>' +
      '<input id="abAadhaar" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="12 digits" style="' + IN + '">' +
      '<button id="abSendOtp" style="' + BTN + ';width:100%">Send OTP</button>' +
      '<div style="font-size:11.5px;color:var(--slate,#9bb0c2);margin-top:10px">The OTP goes to the mobile registered with Aadhaar. We never store the Aadhaar number.</div>';
    el("abSendOtp").onclick = function () {
      var a = el("abAadhaar").value;
      // ABDM requires this check before the call, and it spares the patient a pointless failed OTP.
      if (!validAadhaar(a)) { msg("err", "That is not a valid Aadhaar number. Check the digits."); return; }
      msg("", "Sending OTP...");
      call("/enrol/otp", { aadhaar: a, consentId: S.consentId, tenantId: S.tenantId }).then(function (r) {
        if (!r || !r.ok) { msg("err", errText(r)); return; }
        S.txnId = r.data.txnId || (r.data.data && r.data.data.txnId) || r.data.transactionId;
        stepOtp();
      });
    };
  }

  function stepOtp() {
    var body = shell("Create ABHA", "Step 2 of 4: verify OTP");
    body.innerHTML =
      '<label style="' + LBL + '">Aadhaar OTP</label>' +
      '<input id="abOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 digits" style="' + IN + '">' +
      '<label style="' + LBL + '">Mobile number for communication</label>' +
      '<input id="abMobile" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="10 digits" style="' + IN + '">' +
      '<button id="abVerify" style="' + BTN + ';width:100%">Verify</button>' +
      '<button id="abResend" style="' + GHOST + ';width:100%;margin-top:10px" disabled>Resend OTP (60s)</button>';
    // "System may activate the Resend OTP button atleast 2 times after 60 seconds" (CRT_ABHA_106).
    startResend(2);
    el("abVerify").onclick = function () {
      var otp = el("abOtp").value, mob = el("abMobile").value;
      if (!validOtp(otp)) { msg("err", "Enter the 6-digit OTP."); return; }
      if (!validMobile(mob)) { msg("err", "Enter a valid 10-digit mobile number."); return; }
      msg("", "Verifying...");
      call("/enrol/verify", { txnId: S.txnId, otp: otp, mobile: mob }).then(function (r) {
        if (!r || !r.ok) { msg("err", errText(r)); return; }
        var d = r.data || {};
        S.txnId = d.txnId || S.txnId;
        S.xToken = d.token || d.tokens && d.tokens.token;
        S.profile = d.ABHAProfile || d.profile || d;
        // Aadhaar-linked mobile matched => straight on. Otherwise ABDM wants the new mobile verified
        // by its own OTP (CRT_ABHA_109) before the ABHA address is chosen.
        if (d.isNew === false || d.mobileVerified || (S.profile && S.profile.mobile === mob)) stepAddress();
        else stepMobileOtp(mob);
      });
    };
  }

  var resendTimer = null;
  function startResend(left) {
    var btn = el("abResend"); if (!btn) return;
    if (resendTimer) clearInterval(resendTimer);
    var n = 60;
    btn.disabled = true; btn.textContent = "Resend OTP (" + n + "s)";
    resendTimer = setInterval(function () {
      n--;
      if (!el("abResend")) { clearInterval(resendTimer); return; }
      if (n > 0) { btn.textContent = "Resend OTP (" + n + "s)"; return; }
      clearInterval(resendTimer);
      if (left <= 0) { btn.textContent = "No resends left"; return; }
      btn.disabled = false; btn.textContent = "Resend OTP";
      btn.onclick = function () {
        msg("", "Sending a new OTP...");
        call("/enrol/otp", { aadhaar: S.aadhaar, consentId: S.consentId, tenantId: S.tenantId }).then(function (r) {
          if (!r || !r.ok) { msg("err", errText(r)); return; }
          msg("ok", "New OTP sent."); startResend(left - 1);
        });
      };
    }, 1000);
  }

  function stepMobileOtp(mobile) {
    var body = shell("Create ABHA", "Step 3 of 4: verify mobile");
    body.innerHTML =
      '<div style="font-size:13px;margin-bottom:12px">That mobile number is different from the one registered with Aadhaar, so it needs its own OTP.</div>' +
      '<label style="' + LBL + '">OTP sent to ' + esc(mobile) + "</label>" +
      '<input id="abMOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 digits" style="' + IN + '">' +
      '<button id="abMVerify" style="' + BTN + ';width:100%">Verify mobile</button>';
    call("/enrol/mobile/otp", { txnId: S.txnId, mobile: mobile }).then(function (r) {
      if (!r || !r.ok) msg("err", errText(r)); else msg("ok", "OTP sent.");
    });
    el("abMVerify").onclick = function () {
      var otp = el("abMOtp").value;
      if (!validOtp(otp)) { msg("err", "Enter the 6-digit OTP."); return; }
      msg("", "Verifying...");
      call("/enrol/mobile/verify", { txnId: S.txnId, otp: otp }).then(function (r) {
        if (!r || !r.ok) { msg("err", errText(r)); return; }
        stepAddress();
      });
    };
  }

  /* ---- step 3: ABHA address -------------------------------------------------------------------- */
  // "The system should allow the user to select the ABHA address giving atleast 3 available suggestions"
  // (CRT_ABHA_112). The patient chooses; we never pick one for them.
  function stepAddress() {
    var body = shell("Create ABHA", "Step 3 of 4: choose an ABHA address");
    body.innerHTML = '<div style="font-size:13px;color:var(--slate,#9bb0c2)">Loading suggestions...</div>';
    call("/enrol/suggestions", { txnId: S.txnId }).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = ""; msg("err", errText(r)); return; }
      var list = (r.data && (r.data.abhaAddressList || r.data.suggestions || r.data)) || [];
      if (!list.length) { body.innerHTML = ""; msg("err", "ABDM returned no address suggestions."); return; }
      body.innerHTML =
        '<div style="font-size:13px;margin-bottom:12px">Let the patient pick the address they want.</div>' +
        list.map(function (a, i) {
          return '<label style="display:flex;gap:10px;align-items:center;margin:0 0 10px">' +
            '<input type="radio" name="abAddr" value="' + esc(a) + '"' + (i === 0 ? " checked" : "") +
            ' style="width:18px;height:18px"><span style="font-size:14px">' + esc(a) + "</span></label>";
        }).join("") +
        '<button id="abPick" style="' + BTN + ';width:100%;margin-top:8px">Create ABHA</button>';
      el("abPick").onclick = function () {
        var sel = document.querySelector('input[name="abAddr"]:checked');
        if (!sel) { msg("err", "Pick an address first."); return; }
        msg("", "Creating...");
        call("/enrol/address", { txnId: S.txnId, abhaAddress: sel.value }).then(function (r2) {
          if (!r2 || !r2.ok) { msg("err", errText(r2)); return; }
          S.profile = r2.data || S.profile;
          stepDone();
        });
      };
    });
  }

  /* ---- step 4: show it, and bind it to the patient --------------------------------------------- */
  // CRT_ABHA_113 (show the 14-digit number and address) + TAGGING_UNIQUEPATIENTID_UNIQUEABHANUMBER
  // (one ABHA number maps to exactly one local patient). The binding is what makes the records findable
  // next visit, so it is offered here rather than left for someone to remember later.
  function stepDone() {
    var p = S.profile || {};
    var num = p.ABHANumber || p.abhaNumber || p.healthIdNumber || "";
    var addr = p.preferredAbhaAddress || p.abhaAddress || p.phrAddress || "";
    var body = shell("ABHA created", "Step 4 of 4");
    body.innerHTML =
      '<div style="background:var(--panel,#111820);border:1px solid var(--line,#22303c);border-radius:12px;padding:14px;margin-bottom:14px">' +
        '<div style="font-size:11.5px;color:var(--slate,#9bb0c2)">ABHA number</div>' +
        '<div style="font-size:20px;font-weight:800;letter-spacing:1px">' + esc(fmtAbha(num)) + "</div>" +
        '<div style="font-size:11.5px;color:var(--slate,#9bb0c2);margin-top:10px">ABHA address</div>' +
        '<div style="font-size:15px;font-weight:700">' + esc(addr) + "</div>" +
        (p.name ? '<div style="font-size:12.5px;color:var(--slate,#9bb0c2);margin-top:10px">' + esc(p.name) + "</div>" : "") +
      "</div>" +
      '<button id="abCard" style="' + GHOST + ';width:100%;margin-bottom:10px">View ABHA card</button>' +
      (S.tenantId && S.patientRef
        ? '<button id="abLink" style="' + BTN + ';width:100%">Link to this patient</button>'
        : '<div style="font-size:12.5px;color:var(--slate,#9bb0c2)">Open this from a patient record to link it.</div>');

    el("abCard").onclick = function () {
      msg("", "Fetching card...");
      call("/card?xToken=" + encodeURIComponent(S.xToken || "")).then(function (r) {
        if (!r || !r.ok) { msg("err", errText(r)); return; }
        showCard(r.data);
      });
    };
    var lk = el("abLink");
    if (lk) lk.onclick = function () {
      msg("", "Linking...");
      call("/link", { tenantId: S.tenantId, abhaNumber: num, abhaAddress: addr, patientRef: S.patientRef })
        .then(function (r) {
          if (!r || !r.ok) { msg("err", errText(r)); return; }
          msg("ok", "Linked to this patient.");
          try { if (typeof S.onLinked === "function") S.onLinked({ abhaNumber: num, abhaAddress: addr }); } catch (e) {}
        });
    };
  }

  function fmtAbha(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    return d.length === 14 ? d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6, 10) + "-" + d.slice(10) : String(v || "");
  }
  function showCard(d) {
    var img = d && (d.card || d.png || d.image);
    if (!img) { msg("err", "No card returned."); return; }
    var src = /^data:|^https?:/.test(img) ? img : "data:image/png;base64," + img;
    var body = shell("ABHA card", "");
    body.innerHTML = '<img alt="ABHA card" src="' + esc(src) + '" style="width:100%;border-radius:12px;border:1px solid var(--line,#22303c)">' +
      '<button id="abBack" style="' + GHOST + ';width:100%;margin-top:12px">Back</button>';
    el("abBack").onclick = stepDone;
  }

  /* ---- verify an EXISTING ABHA by mobile OTP (VRFY_ABHA_201/202) -------------------------------- */
  function openVerify(opts) {
    if (!flagOn()) { tt("ABHA is off."); return; }
    opts = opts || {};
    S = { tenantId: opts.tenantId || "", patientRef: opts.patientRef || "" };
    var body = shell("Verify ABHA", "The patient already has an ABHA");
    body.innerHTML =
      '<label style="' + LBL + '">ABHA number or ABHA address</label>' +
      '<input id="abId" autocapitalize="off" spellcheck="false" placeholder="14 digits, or name@sbx" style="' + IN + '">' +
      '<button id="abVSend" style="' + BTN + ';width:100%">Send OTP</button>';
    el("abVSend").onclick = function () {
      var v = String(el("abId").value || "").trim();
      if (!v) { msg("err", "Enter the ABHA number or address."); return; }
      var isAddr = v.indexOf("@") > -1;
      msg("", "Sending OTP...");
      call("/verify/otp", { loginId: v, loginHint: isAddr ? "abha-address" : "abha-number", otpSystem: "abdm" })
        .then(function (r) {
          if (!r || !r.ok) { msg("err", errText(r)); return; }
          S.txnId = (r.data && (r.data.txnId || r.data.transactionId)) || "";
          S.addressFlow = isAddr;
          var b2 = shell("Verify ABHA", "Enter the OTP");
          b2.innerHTML =
            '<label style="' + LBL + '">OTP</label>' +
            '<input id="abVOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 digits" style="' + IN + '">' +
            '<button id="abVOk" style="' + BTN + ';width:100%">Verify</button>';
          el("abVOk").onclick = function () {
            var otp = el("abVOtp").value;
            if (!validOtp(otp)) { msg("err", "Enter the 6-digit OTP."); return; }
            msg("", "Verifying...");
            call("/verify/confirm", { txnId: S.txnId, otp: otp, addressFlow: S.addressFlow }).then(function (r2) {
              if (!r2 || !r2.ok) { msg("err", errText(r2)); return; }
              S.xToken = r2.data && (r2.data.token || r2.data.xToken);
              S.profile = (r2.data && (r2.data.ABHAProfile || r2.data.profile)) || r2.data;
              stepDone();
            });
          };
        });
    };
  }

  window.SMD_ABDM = {
    on: flagOn,
    openCreate: openCreate,
    openVerify: openVerify,
    close: close,
    // Pure helpers, exported so they are unit-testable without a DOM.
    _validAadhaar: validAadhaar, _validMobile: validMobile, _validOtp: validOtp, _fmtAbha: fmtAbha,
  };
})();
