/* StewardMD — complete sign-out (additive; NEVER edits the minified app.js).
 * ---------------------------------------------------------------------------
 * Bug: the app's "Sign out" (#sessionSignOut, and the account sheet's #smdSbSignOut
 * which forwards to it) clears the LOCAL account object but never terminates the
 * Firebase/Google session. So onAuthStateChanged still holds the user and
 * SMD_applyGoogleUser immediately re-hydrates the account — the user appears to
 * "sign back in" instantly. Only "Delete account & data" (which tears down the
 * Firebase user) truly logs out.
 *
 * Fix: when sign-out is clicked, also do a real teardown — Firebase signOut,
 * Google Identity auto-select disabled, local account key cleared — then reload to
 * a clean state (the same reload approach account.js already uses for guest expiry).
 */
(function () {
  "use strict";
  var ACCOUNT_KEY = "stewardmd_account";

  function auth() {
    try { return window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()); }
    catch (e) { return null; }
  }

  function fullSignOut() {
    // Stop Google One Tap / GIS from auto-selecting the same account again.
    try {
      var g = window.google;
      if (g && g.accounts && g.accounts.id && g.accounts.id.disableAutoSelect) g.accounts.id.disableAutoSelect();
    } catch (e) {}
    // Actually end the Firebase session (this is what app.js omits).
    var a = auth();
    var p = (a && a.signOut) ? a.signOut() : Promise.resolve();
    return Promise.resolve(p).catch(function () {});
  }

  var signingOut = false;
  // Delegated + capture so it fires regardless of app.js's own handler. Covers the
  // session-badge button and the account-sheet button (which forwards to it).
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("#sessionSignOut, #smdSbSignOut");
    if (!t || signingOut) return;
    signingOut = true;
    // Let app.js run its own (local) cleanup first, then hard-teardown + reload.
    setTimeout(function () {
      fullSignOut().then(function () {
        try { localStorage.removeItem(ACCOUNT_KEY); } catch (e) {}
        try { location.reload(); } catch (e) { signingOut = false; }
      });
    }, 40);
  }, true);
})();
