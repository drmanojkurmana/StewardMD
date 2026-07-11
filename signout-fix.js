/* StewardMD — complete sign-out (additive; NEVER edits the minified app.js).
 * ---------------------------------------------------------------------------
 * Bug: the app's "Sign out" (#sessionSignOut, the drawer's #smdSbSignOut and the
 * account sheet's button — the latter two forward to #sessionSignOut) clears the
 * LOCAL account object but never terminates the Firebase session. So on the reload
 * that follows, onAuthStateChanged still holds the user and SMD_applyGoogleUser
 * immediately re-hydrates the account — the user appears to "sign back in" instantly.
 *
 * Fix: intercept the sign-out click, actually end the Firebase session, then reload.
 *
 * CRITICAL: app.js's own #sessionSignOut handler calls location.reload() SYNCHRONOUSLY
 * during the same click. If we merely defer our teardown (e.g. setTimeout), that reload
 * fires first and cancels our pending work — Firebase is never signed out, so after the
 * reload onAuthStateChanged re-hydrates the account and the user has to click again.
 * So we run in the CAPTURE phase and stopImmediatePropagation() to SUPPRESS app.js's
 * premature reload, do the real teardown ourselves, and reload only once signOut resolves
 * (firebase.auth().signOut() resolves only after auth persistence is cleared, so on the
 * next load onAuthStateChanged fires with no user). Same technique native-auth.js uses to
 * override the Google button.
 *
 * NB: intentionally does NOT touch the native @capacitor-firebase/authentication plugin
 * or install any post-reload onAuthStateChanged guard — both destabilised the sign-in
 * path (native-auth.js's ensureFbAsync would report "Authentication is not ready yet",
 * and a lingering guard listener would sign fresh sign-ins straight back out).
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
    // Actually end the Firebase session (this is what app.js omits). The returned promise
    // resolves only after auth persistence is cleared — so awaiting it before reload is
    // what guarantees the account isn't re-hydrated on the next load.
    var a = auth();
    if (a && a.signOut) return Promise.resolve(a.signOut()).catch(function () {});
    return Promise.resolve();
  }

  var signingOut = false;
  // Delegated + capture so it runs BEFORE app.js's own bubble/target handler. Covers the
  // session-badge button, the drawer button (#smdSbSignOut) and the account-sheet button —
  // the latter two forward to #sessionSignOut, but we intercept the click before that.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("#sessionSignOut, #smdSbSignOut");
    if (!t || signingOut) return;
    signingOut = true;
    // Suppress app.js's synchronous location.reload() so our async teardown can complete.
    e.preventDefault();
    e.stopImmediatePropagation();
    // Clear the local account now (mirrors app.js's q()), then real teardown + reload.
    try { localStorage.removeItem(ACCOUNT_KEY); } catch (x) {}
    fullSignOut().then(function () {
      try { localStorage.removeItem(ACCOUNT_KEY); } catch (x) {}
      try { location.reload(); } catch (x) { signingOut = false; }
    });
  }, true);
})();
