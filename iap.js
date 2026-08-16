/* StewardMD — iOS StoreKit bridge (window.SMD_IAP).
 * ---------------------------------------------------------------------------
 * Thin wrapper over the native capacitor-iap plugin (Capacitor.Plugins.Iap, StoreKit 2). The paywall
 * (pro-paywall.js) uses this to fetch products, run a purchase and restore. The purchase returns a
 * transaction id ONLY; the SERVER (functions/_iap.js) re-validates it with the App Store Server API and
 * grants the Pro entitlement — a purchase is never trusted from the client. iOS-only; on web/Android
 * SMD_IAP.available() is false and the paywall keeps its existing behaviour (PhonePe / coming-soon).
 *
 * Product IDs must match the auto-renewable subscriptions created in App Store Connect.
 * Buildless ES5 IIFE. No DOM, no side effects on load. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : this;

  function plat() { try { var C = G.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; } }
  function plugin() { try { var C = G.Capacitor; return (C && C.Plugins && C.Plugins.Iap) || null; } catch (e) { return null; } }
  function isIOS() { return plat() === "ios"; }
  function available() { return isIOS() && !!plugin(); }

  function getProducts(ids) {
    var p = plugin(); if (!p) return Promise.reject(new Error("iap-unavailable"));
    return p.getProducts({ productIds: ids || [] }).then(function (r) { return (r && r.products) || []; });
  }
  function purchase(productId) {
    var p = plugin(); if (!p) return Promise.reject(new Error("iap-unavailable"));
    return p.purchase({ productId: productId });   // -> { transactionId, originalTransactionId, productId } | { cancelled } | { pending }
  }
  function restore() {
    var p = plugin(); if (!p) return Promise.reject(new Error("iap-unavailable"));
    return p.restore().then(function (r) { return (r && r.entitlements) || []; });
  }

  G.SMD_IAP = {
    available: available,
    isIOS: isIOS,
    getProducts: getProducts,
    purchase: purchase,
    restore: restore,
    // Auto-renewable subscription product IDs (must match App Store Connect exactly).
    PRODUCTS: { monthly: "in.stewardmd.pro.monthly", annual: "in.stewardmd.pro.annual" }
  };
})();
