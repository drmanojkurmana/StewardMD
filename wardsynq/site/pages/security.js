/* wardsynq/site/pages/security.js - "Sign-in security": two-step sign-in for the signed-in staff member's
 * OWN account (POST /mfa/enrol, /mfa/confirm, /mfa/disable; GET /mfa/status). Buildless ES5.
 *
 * The server decides whose account this is from the session, never from anything on this page.
 * Loading, failed and "off" are three different sentences: a page that could not check must never
 * tell someone their account is unprotected when it is not, or protected when it is not.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function refusal(c, r) {
    if (!r) return T(c, "site.security.noResponse", "No response from the server.");
    return r.message || (r.error === "wrong_code" ? T(c, "site.security.wrongCode", "That code did not match. Use the newest code in the app.") : r.error === "locked" ? T(c, "site.security.locked", "Too many wrong codes. Try again in 15 minutes.") : r.error || T(c, "site.security.refusalFailed", "failed"));
  }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }

  /* Every state of two-step sign-in is a security message: TS carries the English original
   * underneath so a clinician reading a translation never mistakes one state for another. */
  function statusHtml(c, s) {
    var esc = c.esc;
    if (s == null) return '<span class="spin"></span> ' + esc(T(c, "site.security.checking", "Checking your sign-in settings..."));
    if (s.failed) return '<div class="msg err">' + TS(c, "site.security.checkFailed", "Could not check whether two-step sign-in is on. Nothing has changed; reload to try again.") + "</div>";
    if (s.recovery) return '<div class="msg ok">' + TS(c, "site.security.on", "Two-step sign-in is on.") + "</div>" +
      "<p><b>" + TS(c, "site.security.saveCodesNow", "Save these backup codes now.") + "</b> " + TS(c, "site.security.backupCodesNote", "Each one signs you in once if you lose your phone. They will not be shown again.") + "</p>" +
      '<pre class="mono" id="secCodes">' + s.recovery.map(esc).join("\n") + "</pre>" +
      '<button class="btn" type="button" id="secDone">' + esc(T(c, "site.security.savedThem", "I have saved them")) + "</button>";
    if (s.enrolling) return "<p>" + esc(T(c, "site.security.step1", "1. Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar) and add an account.")) + "</p>" +
      '<p>' + esc(T(c, "site.security.step2Lead", "2. On this phone,")) + ' <a href="' + esc(s.enrolling.uri) + '">' + esc(T(c, "site.security.tapToAdd", "tap here to add it")) + "</a>" + esc(T(c, "site.security.step2Trail", ", or type this key into the app:")) + "</p>" +
      '<p class="mono" style="font-size:16px;letter-spacing:2px;word-break:break-all">' + EN(c, esc(s.enrolling.secret.replace(/(.{4})/g, "$1 ").trim())) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.security.step3", "3. Enter the 6-digit code the app shows")) + '</span><input id="secCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>' +
      '<button class="btn" type="button" id="secConfirm">' + esc(T(c, "site.security.turnOn", "Turn on")) + "</button></div><div id=\"secMsg\"></div>";
    if (s.enabled) return '<div class="msg ok">' + TS(c, "site.security.onDetailed", "Two-step sign-in is on. Signing in asks for a code from your phone after your PIN or password.") + "</div>" +
      "<p>" + esc(s.recoveryLeft === 1 ? T(c, "site.security.codesLeftOne", "{n} backup code left.", { n: s.recoveryLeft }) : T(c, "site.security.codesLeftMany", "{n} backup codes left.", { n: s.recoveryLeft })) + (s.recoveryLeft < 3 ? " " + esc(T(c, "site.security.freshSet", "Turn it off and on again to get a fresh set.")) : "") + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.security.offCodeLabel", "To turn it off, enter a current code or a backup code")) + '</span><input id="secOffCode" autocomplete="one-time-code"></label>' +
      '<button class="btn quiet" type="button" id="secOff">' + esc(T(c, "site.security.turnOff", "Turn off")) + "</button></div><div id=\"secMsg\"></div>";
    return '<div class="msg note">' + TS(c, "site.security.off", "Two-step sign-in is off. Anyone with your PIN or password can sign in as you.") + "</div>" +
      '<button class="btn" type="button" id="secStart">' + esc(T(c, "site.security.setUp", "Set up two-step sign-in")) + '</button><div id="secMsg"></div>';
  }

  function signinLabel(c, action) {
    switch (action) {
      case "login:pin_ok": return T(c, "site.security.evt.pinOk", "Signed in with PIN");
      case "login:password_ok": return T(c, "site.security.evt.passwordOk", "Signed in with password");
      case "login:pin_failed": return T(c, "site.security.evt.pinFailed", "Wrong PIN");
      case "login:password_failed": return T(c, "site.security.evt.passwordFailed", "Wrong password");
      case "login:pin_lockout": return T(c, "site.security.evt.pinLockout", "Locked after too many wrong PINs");
      case "login:password_lockout": return T(c, "site.security.evt.passwordLockout", "Locked after too many wrong passwords");
      case "login:pin_locked": return T(c, "site.security.evt.pinLocked", "Sign-in tried while locked");
      case "login:password_locked": return T(c, "site.security.evt.passwordLocked", "Sign-in tried while locked");
      case "login:pin_refused": return T(c, "site.security.evt.pinRefused", "Sign-in refused");
      case "login:password_refused": return T(c, "site.security.evt.passwordRefused", "Sign-in refused");
      case "login:signed_out_everywhere": return T(c, "site.security.evt.signedOutEverywhere", "Signed out everywhere");
      case "mfa:ok": return T(c, "site.security.evt.mfaOk", "Phone code accepted");
      case "mfa:failed": return T(c, "site.security.evt.mfaFailed", "Wrong phone code");
      case "mfa:lockout": return T(c, "site.security.evt.mfaLockout", "Locked after too many wrong phone codes");
      case "mfa:backup_code_used": return T(c, "site.security.evt.backupCodeUsed", "Backup code used");
      case "mfa:enabled": return T(c, "site.security.evt.mfaEnabled", "Two-step sign-in turned on");
      case "mfa:disabled": return T(c, "site.security.evt.mfaDisabled", "Two-step sign-in turned off");
      case "mfa:enrol_started": return T(c, "site.security.evt.enrolStarted", "Two-step set-up started");
      default: return null;
    }
  }
  /* A failed or partial read never reads as "nobody has signed in as you". */
  function signinsHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<span class="spin"></span> ' + esc(T(c, "site.security.loadingSignins", "Loading recent sign-ins..."));
    if (r.failed) return '<div class="msg err">' + TS(c, "site.security.signinsLoadFailed", "Could not load your recent sign-ins. This is not the same as there being none.") + "</div>";
    var rows = (r.events || []).map(function (e) {
      var bad = /failed|lockout|locked|refused/.test(e.action);
      var label = signinLabel(c, e.action);
      return "<tr" + (bad ? ' class="warn"' : "") + "><td>" + EN(c, esc(c.when ? c.when(e.ts) : new Date(e.ts).toLocaleString())) + "</td><td>" + (label != null ? esc(label) : EN(c, esc(e.action))) + "</td><td>" + EN(c, esc(e.detail)) + "</td></tr>";
    }).join("");
    return (r.partial ? '<div class="msg note">' + esc(T(c, "site.security.signinsPartial", "Only the most recent part of the hospital audit was checked, so older sign-ins may be missing.")) + "</div>" : "") +
      (rows ? '<div style="overflow-x:auto"><table><tr><th>' + esc(T(c, "site.security.colWhen", "When")) + '</th><th>' + esc(T(c, "site.security.colWhat", "What")) + '</th><th>' + esc(T(c, "site.security.colDevice", "Device")) + "</th></tr>" + rows + "</table></div>"
        : r.partial ? '<div class="msg note">' + esc(T(c, "site.security.signinsPartialEmpty", "No sign-ins found in the part that was checked.")) + "</div>" : "<p>" + esc(T(c, "site.security.signinsEmpty", "No sign-ins recorded for this account yet.")) + "</p>") +
      "<p>" + esc(T(c, "site.security.dontRecogniseLead", "Something here you do not recognise? Sign out everywhere, then ask your hospital admin to reset your PIN.")) + "</p>" +
      '<button class="btn quiet" type="button" id="secSignOutAll">' + esc(T(c, "site.security.signOutEverywhere", "Sign out everywhere")) + "</button>";
  }

  WSQ.page("security", { render: function (c) {
    var el = c.el, s = null;
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.security.heading", "Sign-in security")) + '</h1><span class="sub">' + c.esc(T(c, "site.security.ownAccount", "Your own account")) + "</span></div>" +
      (c.state.who && c.state.who.twoStepRequired ? '<div class="msg warn">' + TS(c, "site.security.twoStepRequired", "Your hospital requires two-step sign-in for your role. Set it up below; the rest of WardSynQ opens once it is on.") + "</div>" : "") +
      '<div class="card" id="secCard"></div>';
    if (c.state.tokType !== "staff") {
      document.getElementById("secCard").innerHTML = '<div class="msg note">' + c.esc(T(c, "site.security.accountProviderNote", "This page is for hospital staff sign-ins (hospital code, staff ID and PIN, or staff email). A StewardMD account sets up two-step sign-in with its own account provider.")) + "</div>";
      return;
    }
    function paint() {
      var card = document.getElementById("secCard"); if (!card) return;
      card.innerHTML = statusHtml(c, s);
      var msg = function (t) { var m = document.getElementById("secMsg"); if (m) m.innerHTML = '<div class="msg err">' + EN(c, c.esc(t)) + "</div>"; };
      var on = function (id, fn) { var b = document.getElementById(id); if (b) b.onclick = fn; };
      on("secStart", function () {
        c.api("/mfa/enrol", {}).then(function (r) { if (!r || !r.ok) return msg(refusal(c, r)); s = { enrolling: r }; paint(); });
      });
      on("secConfirm", function () {
        var code = val("secCode"); if (!/^\d{6}$/.test(code)) return msg(T(c, "site.security.enterSixDigits", "Enter the 6 digits the app shows."));
        c.api("/mfa/confirm", { code: code }).then(function (r) { if (!r || !r.ok) return msg(refusal(c, r)); s = { recovery: r.recoveryCodes }; paint(); });
      });
      // Turning it on ended every session signed in without it, this one included.
      on("secDone", function () { c.toast(T(c, "site.security.onPleaseSignInAgain", "Two-step sign-in is on. Please sign in again.")); WSQ.go("logout"); });
      on("secOff", function () {
        var code = val("secOffCode"); if (!code) return msg(T(c, "site.security.enterCodeFirst", "Enter a code first."));
        c.api("/mfa/disable", { code: code }).then(function (r) { if (!r || !r.ok) return msg(refusal(c, r)); c.toast(T(c, "site.security.turnedOff", "Two-step sign-in is off.")); load(); });
      });
    }
    function load() {
      s = null; paint();
      c.api("/mfa/status").then(function (r) { s = r && r.ok ? r : { failed: true }; paint(); });
    }
    function loadSignins() {
      var box = document.getElementById("secSignins"); if (!box) return;
      box.innerHTML = signinsHtml(c, null);
      c.api("/mfa/signins").then(function (r) {
        var b = document.getElementById("secSignins"); if (!b) return;
        b.innerHTML = signinsHtml(c, r && r.ok ? r : { failed: true });
        var btn = document.getElementById("secSignOutAll");
        if (btn) btn.onclick = function () {
          if (!confirm(T(c, "site.security.signOutConfirm", "Sign out of this account on every device, including this one?"))) return;
          c.api("/mfa/signout-all", {}).then(function (x) {
            if (!x || !x.ok) { c.toast(refusal(c, x)); return; }
            c.toast(T(c, "site.security.signedOutEverywhere", "Signed out everywhere.")); WSQ.go("logout");
          });
        };
      });
    }
    el.insertAdjacentHTML("beforeend", '<div class="card"><h2>' + c.esc(T(c, "site.security.recentSigninsCard", "Recent sign-ins")) + '</h2><div id="secSignins"></div></div>');
    load();
    loadSignins();
  } });

  WSQ._securityStatusHtml = statusHtml;
  WSQ._securitySigninsHtml = signinsHtml;
})();
