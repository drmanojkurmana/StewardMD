/*!
 * thorex-entitlement.js — Free/V1/V2Beta resolver for ThoreX.
 *
 * Rule:
 *   !isPro()                              -> "free"
 *   isPro() && tierFor("thorex")=="v2beta" -> "v2beta"
 *   else                                   -> "v1"
 *
 * Default accessors (confirmed against account.js / pro-badge.js / experimental.js):
 *   isPro:   window.SMD_PRO.isProSync() (account.js) OR document.body.classList
 *            .contains("pro-verified") (set by pro-badge.js after Firebase `pro`
 *            claim verification).
 *   tierFor: window.SMD_XACCESS.tierFor("thorex") (experimental.js) — returns
 *            "v1"|"v2beta", "v1" when not granted.
 *
 * opts may inject { isPro, tierFor } to bypass the browser defaults in tests.
 */
(function () {
  "use strict";

  function defIsPro() {
    try {
      if (window.SMD_PRO && SMD_PRO.isProSync && SMD_PRO.isProSync()) return true;
      if (typeof document !== "undefined" && document.body && document.body.classList.contains("pro-verified")) return true;
    } catch (e) {}
    return false;
  }

  function defTier() {
    try {
      return (window.SMD_XACCESS && SMD_XACCESS.tierFor) ? SMD_XACCESS.tierFor("thorex") : "v1";
    } catch (e) {
      return "v1";
    }
  }

  function resolve(opts) {
    opts = opts || {};
    var isPro = opts.isPro || defIsPro;
    var tierFor = opts.tierFor || defTier;
    if (!isPro()) return "free";
    return tierFor("thorex") === "v2beta" ? "v2beta" : "v1";
  }

  var API = { resolve: resolve };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_ENTITLEMENT = API;
})();
