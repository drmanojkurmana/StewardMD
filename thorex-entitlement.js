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

  // Local opt-in for the V2 Beta educational engine (X-Raydar). Pro-gated + DEFAULT OFF (educational /
  // non-commercial license). When a Pro user turns it on in ThoreX settings, entitlement resolves to
  // "v2beta" so the on-device analyzer runs both engines — without needing a v2beta access-code grant.
  function defV2betaFlag() {
    try { return !!(window.SMD_THOREX_FLAGS && window.SMD_THOREX_FLAGS.bool && window.SMD_THOREX_FLAGS.bool("smd_thorex_v2beta")); } catch (e) { return false; }
  }

  function resolve(opts) {
    opts = opts || {};
    var isPro = opts.isPro || defIsPro;
    var tierFor = opts.tierFor || defTier;
    var v2betaFlag = opts.v2betaFlag || defV2betaFlag;
    if (!isPro()) return "free";
    if (v2betaFlag()) return "v2beta";
    return tierFor("thorex") === "v2beta" ? "v2beta" : "v1";
  }

  var API = { resolve: resolve };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_ENTITLEMENT = API;
})();
