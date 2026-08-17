/* StewardMD — iOS StoreKit bridge (window.SMD_IAP).
 * ---------------------------------------------------------------------------
 * Native StoreKit 2 purchases for the Pro paywall (pro-paywall.js, owned by the pricing session). The
 * StoreKit buy returns a transaction id; the SERVER (functions/_iap.js) re-validates it via the App Store
 * Server API and grants the entitlement — a purchase is never trusted from the client. iOS-only; on
 * web/Android SMD_IAP.available() is false and the paywall uses PhonePe/Razorpay.
 *
 * CONTRACT the paywall codes against (agreed via the session sync board):
 *   SMD_IAP.purchase(productId) -> Promise that RESOLVES only on a verified successful purchase
 *                                  (StoreKit buy + /api/billing/iap/verify + grant), and REJECTS on
 *                                  cancel / pending / not-configured / verify-failure (err.code carries which).
 *   SMD_IAP.restore()           -> Promise, RESOLVES { ok:true } on a verified active entitlement,
 *                                  REJECTS (err.code "none" | reason) otherwise.
 * The paywall gates its iOS branch on: window.SMD_IAP && typeof SMD_IAP.purchase === "function".
 *
 * Product IDs per docs/PRICING_PACKAGING.md v7 / docs/IOS-IAP-PRODUCTS.md. Buildless ES5 IIFE. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : this;

  function plat() { try { var C = G.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; } }
  function plugin() { try { var C = G.Capacitor; return (C && C.Plugins && C.Plugins.Iap) || null; } catch (e) { return null; } }
  function isIOS() { return plat() === "ios"; }
  function available() { return isIOS() && !!plugin(); }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function getProducts(ids) {
    var p = plugin(); if (!p) return Promise.reject(fail("iap-unavailable"));
    return p.getProducts({ productIds: ids || [] }).then(function (r) { return (r && r.products) || []; });
  }
  function purchaseRaw(productId) {
    var p = plugin(); if (!p) return Promise.reject(fail("iap-unavailable"));
    return p.purchase({ productId: productId });   // -> { transactionId,... } | { cancelled } | { pending }
  }
  function restoreRaw() {
    var p = plugin(); if (!p) return Promise.reject(fail("iap-unavailable"));
    return p.restore().then(function (r) { return (r && r.entitlements) || []; });
  }

  function apiUrl(p) { return (G.SMD_API_BASE || "") + p; }
  function authHeader() {
    try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; if (!u) return Promise.resolve({}); return u.getIdToken().then(function (t) { return t ? { "Authorization": "Bearer " + t } : {}; }); }
    catch (e) { return Promise.resolve({}); }
  }
  // POST the transaction to the server, which re-validates it (App Store Server API) and grants Pro.
  function verify(productId, transactionId) {
    return authHeader().then(function (h) {
      return fetch(apiUrl("/api/billing/iap/verify"), { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, h), body: JSON.stringify({ platform: "apple", productId: productId, purchaseToken: transactionId }) })
        .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); });
    });
  }

  // purchase(): resolve on verified success, reject otherwise (err.code = cancelled|pending|not-configured|reason).
  function purchase(productId) {
    return purchaseRaw(productId).then(function (res) {
      if (!res || res.cancelled) throw fail("cancelled");
      if (res.pending) throw fail("pending");
      if (!res.transactionId) throw fail("no-transaction");
      return verify(productId, res.transactionId).then(function (x) {
        if (x.s === 200 && x.d && x.d.ok && x.d.valid) return { ok: true, productId: productId, expiresAt: x.d.expiresAt || null };
        if (x.s === 501 || (x.d && x.d.error === "iap-not-configured")) throw fail("not-configured");
        throw fail((x.d && (x.d.reason || x.d.error)) || "verify-failed");
      });
    });
  }
  // restore(): resolve { ok:true } on a verified active entitlement, reject ("none" | reason) otherwise.
  function restore() {
    return restoreRaw().then(function (ents) {
      var e = (ents && ents[0]) || null;
      if (!e) throw fail("none");
      return verify(e.productId, e.transactionId).then(function (x) {
        if (x.s === 200 && x.d && x.d.ok && x.d.valid) return { ok: true, productId: e.productId };
        throw fail((x.d && (x.d.reason || x.d.error)) || "verify-failed");
      });
    });
  }

  G.SMD_IAP = {
    available: available,
    isIOS: isIOS,
    getProducts: getProducts,     // [{ id, displayName, description, price, priceAmount }]
    purchase: purchase,           // verified: resolve on success, reject on cancel/failure
    restore: restore,             // verified: resolve { ok } | reject ("none" | reason)
    verify: verify,               // low-level, if ever needed
    // Product IDs (docs/IOS-IAP-PRODUCTS.md). Auto-renewable subscription tiers (monthly / annual):
    TIERS: {
      trainee:      { monthly: "in.stewardmd.trainee.monthly",      annual: "in.stewardmd.trainee.annual" },
      coresident:   { monthly: "in.stewardmd.coresident.monthly",   annual: "in.stewardmd.coresident.annual" },
      pro:          { monthly: "in.stewardmd.pro.monthly",          annual: "in.stewardmd.pro.annual" },
      physician:    { monthly: "in.stewardmd.physician.monthly",    annual: "in.stewardmd.physician.annual" },
      physicianpro: { monthly: "in.stewardmd.physicianpro.monthly", annual: "in.stewardmd.physicianpro.annual" },
      onco:         { monthly: "in.stewardmd.onco.monthly",         annual: "in.stewardmd.onco.annual" }
    },
    // Consumable MaiK Token top-up packs:
    TOKENS: { boost: "in.stewardmd.tokens.boost", plus: "in.stewardmd.tokens.plus", power: "in.stewardmd.tokens.power" }
  };
})();
