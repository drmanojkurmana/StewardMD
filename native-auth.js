/* StewardMD — native Google + Sign in with Apple (Capacitor).
 * ---------------------------------------------------------------------------
 * Google blocks OAuth (popup AND redirect) inside embedded WebViews
 * ("disallowed_useragent"), so the web sign-in flow cannot work on native. This
 * module runs the NATIVE Google / Apple sign-in UI via @capacitor-firebase/
 * authentication (configured with skipNativeAuth), then exchanges the returned
 * credential into the app's EXISTING Firebase WEB SDK via signInWithCredential.
 * The web SDK's onAuthStateChanged → SMD_applyGoogleUser then applies the account
 * exactly like the web popup flow (gate dismissed, guest cases migrated, consent,
 * GHIS scoping) — a SINGLE auth state, no native/web split.
 *
 * Apple Guideline 4.8: because Google sign-in is offered, Sign in with Apple is
 * offered too. Requires the plist (GoogleService-Info.plist), the Google URL
 * scheme (Info.plist CFBundleURLTypes) and, for Apple, the Sign in with Apple
 * capability + entitlement + the Apple provider enabled in Firebase Auth.
 *
 * NO-OP on the web build and until the plugin + Firebase are present, so it can
 * never break the web experience.
 */
(function () {
  "use strict";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));
  if (!native) return;

  function plugin() { return (C.Plugins && C.Plugins.FirebaseAuthentication) || null; }
  function fb() { return (window.firebase && window.firebase.auth) ? window.firebase : null; }
  function ensureFb() {
    var F = fb();
    if (!F) { try { if (window.SMD_bootFirebase) window.SMD_bootFirebase(); } catch (e) {} F = fb(); }
    return F;
  }
  function toast(m) { try { (window.toast || function (x) { alert(x); })(m); } catch (e) {} }

  // ---- Native Google → app's Firebase web session -------------------------
  async function signInWithGoogle() {
    var P = plugin(); if (!P) throw new Error("Google sign-in is unavailable on this device.");
    var F = ensureFb(); if (!F) throw new Error("Authentication is not ready yet — please try again.");
    var res = await P.signInWithGoogle();
    var cred = (res && res.credential) || {};
    if (!cred.idToken && !cred.accessToken) throw new Error("Google did not return a token.");
    var gcred = F.auth.GoogleAuthProvider.credential(cred.idToken || null, cred.accessToken || null);
    return await F.auth().signInWithCredential(gcred);   // onAuthStateChanged applies the account
  }

  // ---- Native Apple → app's Firebase web session --------------------------
  // The plugin generates + SHA-256-hashes the nonce for Apple and returns the RAW
  // nonce in credential.nonce, which Firebase needs to verify the identity token.
  async function signInWithApple() {
    var P = plugin(); if (!P) throw new Error("Sign in with Apple is unavailable on this device.");
    var F = ensureFb(); if (!F) throw new Error("Authentication is not ready yet — please try again.");
    var res = await P.signInWithApple();
    var cred = (res && res.credential) || {};
    if (!cred.idToken) throw new Error("Apple did not return an identity token.");
    var provider = new F.auth.OAuthProvider("apple.com");
    var ocred = provider.credential({ idToken: cred.idToken, rawNonce: cred.nonce });
    var out = await F.auth().signInWithCredential(ocred);
    // Apple sends the name only on the FIRST authorization — capture it if given.
    try {
      var dn = res.user && res.user.displayName;
      if (dn && out && out.user && out.user.updateProfile && !out.user.displayName) await out.user.updateProfile({ displayName: dn });
    } catch (e) {}
    return out;
  }

  window.SMD_signInWithApple = signInWithApple;
  window.SMD_NATIVE_APPLE = true;

  // Replace the web popup Google path (blocked in WKWebViews). Re-assert after
  // 'load' in case app.js (re)assigns SMD_signInWithGoogle during its own init.
  function installGoogleOverride() {
    window.SMD_signInWithGoogle = function () {
      return signInWithGoogle().catch(function (e) { toast(String(e && e.message || e)); });
    };
  }
  installGoogleOverride();
  window.addEventListener("load", installGoogleOverride);

  // ---- UI: force the native Google button + inject an Apple button --------
  // The GIS iframe button (#googleBtnContainer) can't complete OAuth in a WKWebView,
  // so hide it and surface the plain fallback button (#googleFallbackBtn), whose click
  // we intercept below and route through the native flow.
  function forceNativeGoogleButton() {
    try {
      var c = document.getElementById("googleBtnContainer"); if (c) c.style.display = "none";
      var fbn = document.getElementById("googleFallbackBtn"); if (fbn && getComputedStyle(fbn).display === "none") fbn.style.display = "";
    } catch (e) {}
  }
  // Capture phase → runs before app.js's popup click handler on the button.
  document.addEventListener("click", function (e) {
    try {
      var t = e.target && e.target.closest && e.target.closest("#googleFallbackBtn");
      if (!t) return;
      e.preventDefault(); e.stopImmediatePropagation();
      signInWithGoogle().catch(function (err) { toast(String(err && err.message || err)); });
    } catch (x) {}
  }, true);

  function injectAppleButton() {
    try {
      var googleBtns = [].slice.call(document.querySelectorAll("button, a, [role=button]")).filter(function (el) {
        return /sign in with google|continue with google/i.test((el.textContent || "")) && !el.getAttribute("data-smd-apple-sib");
      });
      googleBtns.forEach(function (g) {
        g.setAttribute("data-smd-apple-sib", "1");
        if (document.getElementById("smdAppleBtn")) return;
        var b = document.createElement("button");
        b.id = "smdAppleBtn";
        b.type = "button";
        b.textContent = "  Sign in with Apple";
        b.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:10px;padding:12px 16px;border:0;border-radius:10px;background:#000;color:#fff;font-size:15px;font-weight:600;cursor:pointer;font-family:var(--sans,-apple-system,'Segoe UI',Roboto,sans-serif)";
        b.addEventListener("click", function () {
          b.disabled = true;
          Promise.resolve(signInWithApple()).catch(function (e) {
            toast(String(e && e.message || e));
          }).then(function () { b.disabled = false; });
        });
        if (g.parentNode) g.parentNode.insertBefore(b, g.nextSibling);
      });
    } catch (e) {}
  }

  function tickUI() { forceNativeGoogleButton(); injectAppleButton(); }
  function init() {
    tickUI();
    var n = 0, t = setInterval(function () { tickUI(); if (++n > 40) clearInterval(t); }, 300);
    try { new MutationObserver(tickUI).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
