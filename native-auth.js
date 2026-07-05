/* StewardMD — native Sign in with Apple (Capacitor).
 * ---------------------------------------------------------------------------
 * Apple Guideline 4.8: because the app offers Google sign-in, it must also offer
 * Sign in with Apple. This wires the (already-installed) @capacitor-community/
 * apple-sign-in plugin into the EXISTING web Firebase SDK — no native Firebase
 * config (GoogleService-Info.plist / google-services.json) required, so it does
 * not affect the build. The Apple credential is exchanged for a Firebase session
 * via signInWithCredential, after which the app's normal onAuthStateChanged /
 * SMD_applyGoogleUser flow takes over (ID token, cases, consent all work).
 *
 * NO-OP on the web build and on native until the plugin + Firebase are present.
 * Exposes window.SMD_signInWithApple() and best-effort injects an "Sign in with
 * Apple" button next to the Google one. Final button placement should be
 * verified on device.
 */
(function () {
  "use strict";
  var C = window.Capacitor;
  var native = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")));
  if (!native) return;

  function applePlugin() { return (C.Plugins && C.Plugins.SignInWithApple) || null; }
  function fb() { return window.firebase && window.firebase.auth ? window.firebase : null; }

  function randNonce(len) {
    var a = new Uint8Array(len || 32); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
  }
  async function sha256hex(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  // Public: run the native Apple flow and sign into Firebase with the result.
  window.SMD_signInWithApple = async function () {
    var plugin = applePlugin(), F = fb();
    if (!plugin) throw new Error("Sign in with Apple is unavailable on this device.");
    if (!F) { try { if (window.SMD_bootFirebase) window.SMD_bootFirebase(); } catch (e) {} F = fb(); }
    if (!F) throw new Error("Authentication is not ready yet — please try again.");
    var rawNonce = randNonce(32);
    var hashed = await sha256hex(rawNonce);
    var res = await plugin.authorize({ scopes: "email name", nonce: hashed });
    var idToken = res && res.response && res.response.identityToken;
    if (!idToken) throw new Error("Apple did not return an identity token.");
    var provider = new F.auth.OAuthProvider("apple.com");
    var cred = provider.credential({ idToken: idToken, rawNonce: rawNonce });
    var out = await F.auth().signInWithCredential(cred);
    // Apple only sends the name on the FIRST authorization — capture it if given.
    try {
      var gn = res.response.givenName, fn = res.response.familyName;
      if ((gn || fn) && out && out.user && out.user.updateProfile && !out.user.displayName) {
        await out.user.updateProfile({ displayName: [gn, fn].filter(Boolean).join(" ") });
      }
    } catch (e) {}
    return out;
  };
  window.SMD_NATIVE_APPLE = true;

  // Best-effort: place an "Sign in with Apple" button next to the Google button
  // wherever it appears (login gate / account sheet). Idempotent; retries as UI mounts.
  function injectButton() {
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
        b.textContent = "  Sign in with Apple";
        b.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:10px;padding:12px 16px;border:0;border-radius:10px;background:#000;color:#fff;font-size:15px;font-weight:600;cursor:pointer;font-family:var(--sans,-apple-system,'Segoe UI',Roboto,sans-serif)";
        b.addEventListener("click", function () {
          b.disabled = true;
          Promise.resolve(window.SMD_signInWithApple()).catch(function (e) {
            try { (window.toast || function (m) { alert(m); })(String(e && e.message || e)); } catch (x) {}
          }).then(function () { b.disabled = false; });
        });
        if (g.parentNode) g.parentNode.insertBefore(b, g.nextSibling);
      });
    } catch (e) {}
  }
  function init() {
    injectButton();
    var n = 0, t = setInterval(function () { injectButton(); if (++n > 40) clearInterval(t); }, 300);
    try { new MutationObserver(injectButton).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
