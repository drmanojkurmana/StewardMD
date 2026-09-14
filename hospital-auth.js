/* hospital-auth.js - which credential a hospital request carries (window.SMD_HOSPITAL_AUTH).
 *
 * S3 design 2.3: THE WORKPLACE DECIDES THE CREDENTIAL, never whichever token happens to be stored.
 * A phone can hold a StewardMD account and a staff session at once. ward.js used to send the staff
 * token whenever one existed, so a doctor working in hospital B with a stale nurse session from
 * hospital A still stored would act in B as that nurse from A (parity ID-01, EMR-05).
 *
 * A staff token names its hospital: its first segment is base64url("<orgId>~<identity>.<expiry>")
 * (functions/_opd_auth.js mintStaffSession). That is read here only to choose what to send, never
 * to grant anything; the server verifies the signature and the membership on every request.
 *
 *   staff token for this hospital      -> X-Staff-Token only (the server prefers an account bearer,
 *                                         so sending both would act as the account)
 *   staff token for another hospital   -> never sent; the account bearer instead
 *   token that names no hospital       -> sent as before (local and harness sessions)
 *
 * Buildless ES5, no DOM, no network. Loaded before ward.js, wardsynq-alert-ui.js and native-push.js.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var LS_STAFF = "smd_opd_staff_tok", LS_WP = "smd_opd_workplace";

  function lsGet(k) { try { return G.localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function b64u(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    try { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"); } catch (e) { return ""; }
  }

  /** PURE. The hospital a staff token was minted for, or "" when it names none. */
  function staffTokenOrg(tok) {
    if (!tok) return "";
    var body = b64u(String(tok).split(".")[0]);
    var m = /^([^~]+)~[^\n]+\.\d+$/.exec(body);
    return m ? m[1] : "";
  }
  /** PURE. "wardsynq:<orgId>" -> orgId, anything else -> "". */
  function workplaceOrg(wp) { wp = String(wp || ""); return wp.indexOf("wardsynq:") === 0 ? wp.slice(9) : ""; }

  /** The stored staff token, if it may be used for this hospital; otherwise "". */
  function staffTokenFor(orgId) {
    var tok = lsGet(LS_STAFF);
    if (!tok) return "";
    var bound = staffTokenOrg(tok);
    if (!bound) return tok;
    return bound === String(orgId || "") ? tok : "";
  }

  /** The hospital this phone is working in for alerts: the WardSynQ workplace, else the hospital a
   * staff session is signed in to (a front-desk sign-in clears the workplace), else "". */
  function currentOrg() { return workplaceOrg(lsGet(LS_WP)) || staffTokenOrg(lsGet(LS_STAFF)); }

  /** The StewardMD account's ID token, or null. */
  function accountToken() {
    try { if (G.SMD_AUTH && typeof G.SMD_AUTH.token === "function") return Promise.resolve(G.SMD_AUTH.token()); } catch (e) {}
    try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; if (u && u.getIdToken) return u.getIdToken(); } catch (e) {}
    try { if (G.firebase && G.firebase.auth && G.firebase.auth().currentUser) return G.firebase.auth().currentUser.getIdToken(); } catch (e) {}
    return Promise.resolve(null);
  }

  /** Headers for a request in `orgId`. The staff token is read NOW, so a caller about to sign out
   * can authenticate its last request before clearing it. getAccountToken defaults to accountToken. */
  function headersFor(orgId, getAccountToken) {
    var tok = staffTokenFor(orgId);
    if (tok) return Promise.resolve({ "Content-Type": "application/json", "X-Staff-Token": tok });
    return Promise.resolve((getAccountToken || accountToken)()).then(function (t) {
      var h = { "Content-Type": "application/json" };
      if (t) h.Authorization = "Bearer " + t;
      return h;
    }, function () { return { "Content-Type": "application/json" }; });
  }

  /** Resolves once the account's first sign-in state is known (or after maxMs), so a request made at
   * a cold start is not refused only because the account had not been restored yet. */
  function authReady(maxMs) {
    return new Promise(function (resolve) {
      var done = false, timer = null, finish = function () { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      timer = setTimeout(finish, maxMs || 8000);
      try {
        if (G.SMD_AUTH && typeof G.SMD_AUTH.onAuthStateChanged === "function") {
          var off = G.SMD_AUTH.onAuthStateChanged(function () { finish(); try { if (typeof off === "function") off(); } catch (e) {} });
          return;
        }
      } catch (e) {}
      finish();
    });
  }

  var API = { staffTokenOrg: staffTokenOrg, workplaceOrg: workplaceOrg, staffTokenFor: staffTokenFor, currentOrg: currentOrg, accountToken: accountToken, headersFor: headersFor, authReady: authReady };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_HOSPITAL_AUTH = API;
})();
