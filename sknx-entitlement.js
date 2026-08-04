// sknx-entitlement.js — Free/V1/V2Beta resolver for SknX (clone of thorex-entitlement.js).
(function () {
  "use strict";
  function defIsPro() { try { if (window.SMD_PRO && SMD_PRO.isProSync && SMD_PRO.isProSync()) return true; if (typeof document !== "undefined" && document.body && document.body.classList.contains("pro-verified")) return true; } catch (e) {} return false; }
  function defTier() { try { return (window.SMD_XACCESS && SMD_XACCESS.tierFor) ? SMD_XACCESS.tierFor("sknx") : "v1"; } catch (e) { return "v1"; } }
  function resolve(opts) {
    opts = opts || {};
    var isPro = opts.isPro || defIsPro, tierFor = opts.tierFor || defTier;
    if (!isPro()) return "free";
    return tierFor("sknx") === "v2beta" ? "v2beta" : "v1";
  }
  var API = { resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_ENTITLEMENT = API;
})();
