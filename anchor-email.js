/* anchor-email.js — classify an account's email as a deliverable anchor (SMD_ANCHOR).
 * Apple "Hide My Email" gives an @privaterelay.appleid.com proxy (or an empty email) that BOUNCES,
 * so those accounts must add a real, verified email. Pure + testable. */
(function () {
  "use strict";
  var PROXY_RE = /@[^@]*\.?appleid\.com$/i;   // *.appleid.com incl. privaterelay
  function sourceOf(providerId) {
    var p = String(providerId || "").toLowerCase();
    if (p.indexOf("google") >= 0) return "google";
    if (p.indexOf("apple") >= 0) return "apple";
    if (p.indexOf("password") >= 0) return "password";
    return "unknown";
  }
  function classifyEmail(email, providerId) {
    var e = String(email || "").trim().toLowerCase();
    var source = sourceOf(providerId);
    if (!e) return { status: "empty", source: source };
    if (PROXY_RE.test(e)) return { status: "proxy", source: source };
    return { status: "real", source: source };
  }
  function needsRealEmail(cls) { return !!cls && (cls.status === "proxy" || cls.status === "empty"); }
  function resolve(user) {
    user = user || (function () { try { return window.firebase && window.firebase.auth().currentUser; } catch (e) { return null; } })();
    if (!user) return { status: "empty", source: "unknown" };
    var pid = (user.providerData && user.providerData[0] && user.providerData[0].providerId) || "";
    return classifyEmail(user.email, pid);
  }
  var API = { classifyEmail: classifyEmail, needsRealEmail: needsRealEmail, resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_ANCHOR = API;
})();
