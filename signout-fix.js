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

  /* Tell the feature modules to wipe their per-person data.
   *
   * CliniX, SknX, ThoreX, KardioX and SURGX each register a wipe() on these event names and have
   * done since they were written - but nothing in the app had ever DISPATCHED one, so every wipe
   * was dead code (kardiox-screens.js even carries the note "hook the real signout"). The reload
   * below hid it: fresh JS and a closed overlay look like a clean slate while the localStorage
   * keys survive, so the next person to sign in on this device inherited the previous user's
   * CliniX competency and misses, SURGX notes and KardioX/ThoreX study history.
   *
   * Dispatch BEFORE the reload - a wipe after it never runs. All four names are sent because the
   * modules listen on all four, and each module guards its own handler.
   */
  function wipeModules() {
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) {
      try { window.dispatchEvent(new Event(ev)); } catch (x) {
        // Older WebViews: Event may not be constructible.
        try { var e2 = document.createEvent("Event"); e2.initEvent(ev, false, false); window.dispatchEvent(e2); } catch (y) {}
      }
    });
  }

  /* SURGX notes are encrypted, device-local and have NO server copy, and wipe() destroys the
   * encryption key along with them - so once the sign-out wipe above actually started running,
   * signing out became an irreversible way to lose a surgeon's only copy of their notes. Nothing
   * in the app asks before signing out. Ask only when there is something irreplaceable to lose;
   * a sign-out with no notes stays a single tap. */
  function confirmNoteLoss() {
    var n = 0;
    try {
      var st = window.SMD_SURGX_STORE;
      if (st && st.listNotes) n = (st.listNotes() || []).length;
    } catch (x) { return true; }
    if (!n) return true;
    /* If the surgeon turned on the encrypted Drive backup, the notes are recoverable and the
     * warning must say so - an alarming message about permanent loss, shown to someone who set up
     * a backup precisely so this would not be permanent, just teaches them to ignore the dialog. */
    /* Does a recoverable backup exist? Asked of surgx-backup.js (SMD_SURGX_BACKUP), which owns the
     * encrypted Drive backup. Tolerant of the module being absent or of its shape changing, and it
     * FAILS TOWARDS THE HARDER WARNING: if we cannot prove a backup exists, say the notes are about
     * to be destroyed permanently. Being wrongly alarmed costs a surgeon one dialog; being wrongly
     * reassured costs them the notes. */
    var backed = false;
    try {
      // Optional by design: absent until surgx-backup.js lands (PR #760), and absence means
      // `backed` stays false, i.e. the stronger warning. Never a hard dependency.
      var B = window.SMD_SURGX_BACKUP;
      if (B && B.describe) { var d = B.describe(); backed = !!(d && (d.hasBackup || d.lastBackupAt)); }
    } catch (x) { backed = false; }
    var label = n + " SURG" + String.fromCharCode(0x02E3) + " note" + (n === 1 ? "" : "s");
    try {
      return window.confirm(backed
        ? ("Signing out removes " + label + " from this device.\n\nYou have an encrypted Drive " +
           "backup, so you can restore them after signing in again with the same My Clinic " +
           "password.\n\nSign out?")
        : ("Signing out will permanently delete " + label + " from this device.\n\nThey are " +
           "encrypted on this device only and there is no server copy, so they cannot be " +
           "recovered. You can turn on encrypted Drive backup in Notes.\n\nSign out anyway?"));
    } catch (x) { return true; }
  }

  var signingOut = false;
  // Delegated + capture so it runs BEFORE app.js's own bubble/target handler. Covers the
  // session-badge button, the drawer button (#smdSbSignOut) and the account-sheet button —
  // the latter two forward to #sessionSignOut, but we intercept the click before that.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("#sessionSignOut, #smdSbSignOut");
    if (!t || signingOut) return;
    if (!confirmNoteLoss()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    signingOut = true;
    // Suppress app.js's synchronous location.reload() so our async teardown can complete.
    e.preventDefault();
    e.stopImmediatePropagation();
    // Clear the local account now (mirrors app.js's q()), then real teardown + reload.
    try { localStorage.removeItem(ACCOUNT_KEY); } catch (x) {}
    fullSignOut().then(function () {
      try { localStorage.removeItem(ACCOUNT_KEY); } catch (x) {}
      wipeModules();
      try { location.reload(); } catch (x) { signingOut = false; }
    });
  }, true);
})();
