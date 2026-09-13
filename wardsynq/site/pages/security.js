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

  function refusal(r) {
    if (!r) return "No response from the server.";
    return r.message || (r.error === "wrong_code" ? "That code did not match. Use the newest code in the app." : r.error === "locked" ? "Too many wrong codes. Try again in 15 minutes." : r.error || "failed");
  }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }

  function statusHtml(c, s) {
    var esc = c.esc;
    if (s == null) return '<span class="spin"></span> Checking your sign-in settings...';
    if (s.failed) return '<div class="msg err">Could not check whether two-step sign-in is on. Nothing has changed; reload to try again.</div>';
    if (s.recovery) return '<div class="msg ok">Two-step sign-in is on.</div>' +
      "<p><b>Save these backup codes now.</b> Each one signs you in once if you lose your phone. They will not be shown again.</p>" +
      '<pre class="mono" id="secCodes">' + s.recovery.map(esc).join("\n") + "</pre>" +
      '<button class="btn" type="button" id="secDone">I have saved them</button>';
    if (s.enrolling) return "<p>1. Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar) and add an account.</p>" +
      '<p>2. On this phone, <a href="' + esc(s.enrolling.uri) + '">tap here to add it</a>, or type this key into the app:</p>' +
      '<p class="mono" style="font-size:16px;letter-spacing:2px;word-break:break-all">' + esc(s.enrolling.secret.replace(/(.{4})/g, "$1 ").trim()) + "</p>" +
      '<div class="row"><label class="f"><span>3. Enter the 6-digit code the app shows</span><input id="secCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>' +
      '<button class="btn" type="button" id="secConfirm">Turn on</button></div><div id="secMsg"></div>';
    if (s.enabled) return '<div class="msg ok">Two-step sign-in is on. Signing in asks for a code from your phone after your PIN or password.</div>' +
      "<p>" + esc(s.recoveryLeft) + " backup code" + (s.recoveryLeft === 1 ? "" : "s") + " left." + (s.recoveryLeft < 3 ? " Turn it off and on again to get a fresh set." : "") + "</p>" +
      '<div class="row"><label class="f"><span>To turn it off, enter a current code or a backup code</span><input id="secOffCode" autocomplete="one-time-code"></label>' +
      '<button class="btn quiet" type="button" id="secOff">Turn off</button></div><div id="secMsg"></div>';
    return '<div class="msg note">Two-step sign-in is off. Anyone with your PIN or password can sign in as you.</div>' +
      '<button class="btn" type="button" id="secStart">Set up two-step sign-in</button><div id="secMsg"></div>';
  }

  WSQ.page("security", { render: function (c) {
    var el = c.el, s = null;
    el.innerHTML = '<div class="title"><h1>Sign-in security</h1><span class="sub">Your own account</span></div><div class="card" id="secCard"></div>';
    if (c.state.tokType !== "staff") {
      document.getElementById("secCard").innerHTML = '<div class="msg note">This page is for hospital staff sign-ins (hospital code, staff ID and PIN, or staff email). A StewardMD account sets up two-step sign-in with its own account provider.</div>';
      return;
    }
    function paint() {
      var card = document.getElementById("secCard"); if (!card) return;
      card.innerHTML = statusHtml(c, s);
      var msg = function (t) { var m = document.getElementById("secMsg"); if (m) m.innerHTML = '<div class="msg err">' + c.esc(t) + "</div>"; };
      var on = function (id, fn) { var b = document.getElementById(id); if (b) b.onclick = fn; };
      on("secStart", function () {
        c.api("/mfa/enrol", {}).then(function (r) { if (!r || !r.ok) return msg(refusal(r)); s = { enrolling: r }; paint(); });
      });
      on("secConfirm", function () {
        var code = val("secCode"); if (!/^\d{6}$/.test(code)) return msg("Enter the 6 digits the app shows.");
        c.api("/mfa/confirm", { code: code }).then(function (r) { if (!r || !r.ok) return msg(refusal(r)); s = { recovery: r.recoveryCodes }; paint(); });
      });
      // Turning it on ended every session signed in without it, this one included.
      on("secDone", function () { c.toast("Two-step sign-in is on. Please sign in again."); WSQ.go("logout"); });
      on("secOff", function () {
        var code = val("secOffCode"); if (!code) return msg("Enter a code first.");
        c.api("/mfa/disable", { code: code }).then(function (r) { if (!r || !r.ok) return msg(refusal(r)); c.toast("Two-step sign-in is off."); load(); });
      });
    }
    function load() {
      s = null; paint();
      c.api("/mfa/status").then(function (r) { s = r && r.ok ? r : { failed: true }; paint(); });
    }
    load();
  } });

  WSQ._securityStatusHtml = statusHtml;
})();
