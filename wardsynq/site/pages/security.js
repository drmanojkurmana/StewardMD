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

  var SIGNIN_LABEL = {
    "login:pin_ok": "Signed in with PIN", "login:password_ok": "Signed in with password",
    "login:pin_failed": "Wrong PIN", "login:password_failed": "Wrong password",
    "login:pin_lockout": "Locked after too many wrong PINs", "login:password_lockout": "Locked after too many wrong passwords",
    "login:pin_locked": "Sign-in tried while locked", "login:password_locked": "Sign-in tried while locked",
    "login:pin_refused": "Sign-in refused", "login:password_refused": "Sign-in refused",
    "login:signed_out_everywhere": "Signed out everywhere",
    "mfa:ok": "Phone code accepted", "mfa:failed": "Wrong phone code", "mfa:lockout": "Locked after too many wrong phone codes",
    "mfa:backup_code_used": "Backup code used", "mfa:enabled": "Two-step sign-in turned on", "mfa:disabled": "Two-step sign-in turned off",
    "mfa:enrol_started": "Two-step set-up started"
  };
  /* A failed or partial read never reads as "nobody has signed in as you". */
  function signinsHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<span class="spin"></span> Loading recent sign-ins...';
    if (r.failed) return '<div class="msg err">Could not load your recent sign-ins. This is not the same as there being none.</div>';
    var rows = (r.events || []).map(function (e) {
      var bad = /failed|lockout|locked|refused/.test(e.action);
      return "<tr" + (bad ? ' class="warn"' : "") + "><td>" + esc(c.when ? c.when(e.ts) : new Date(e.ts).toLocaleString()) + "</td><td>" + esc(SIGNIN_LABEL[e.action] || e.action) + "</td><td>" + esc(e.detail) + "</td></tr>";
    }).join("");
    return (r.partial ? '<div class="msg note">Only the most recent part of the hospital audit was checked, so older sign-ins may be missing.</div>' : "") +
      (rows ? '<div style="overflow-x:auto"><table><tr><th>When</th><th>What</th><th>Device</th></tr>' + rows + "</table></div>"
        : r.partial ? '<div class="msg note">No sign-ins found in the part that was checked.</div>' : "<p>No sign-ins recorded for this account yet.</p>") +
      "<p>Something here you do not recognise? Sign out everywhere, then ask your hospital admin to reset your PIN.</p>" +
      '<button class="btn quiet" type="button" id="secSignOutAll">Sign out everywhere</button>';
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
    function loadSignins() {
      var box = document.getElementById("secSignins"); if (!box) return;
      box.innerHTML = signinsHtml(c, null);
      c.api("/mfa/signins").then(function (r) {
        var b = document.getElementById("secSignins"); if (!b) return;
        b.innerHTML = signinsHtml(c, r && r.ok ? r : { failed: true });
        var btn = document.getElementById("secSignOutAll");
        if (btn) btn.onclick = function () {
          if (!confirm("Sign out of this account on every device, including this one?")) return;
          c.api("/mfa/signout-all", {}).then(function (x) {
            if (!x || !x.ok) { c.toast(refusal(x)); return; }
            c.toast("Signed out everywhere."); WSQ.go("logout");
          });
        };
      });
    }
    el.insertAdjacentHTML("beforeend", '<div class="card"><h2>Recent sign-ins</h2><div id="secSignins"></div></div>');
    load();
    loadSignins();
  } });

  WSQ._securityStatusHtml = statusHtml;
  WSQ._securitySigninsHtml = signinsHtml;
})();
