/* StewardMD — doctor verification gate (additive; NEVER edits the minified app.js).
 * ---------------------------------------------------------------------------
 * StewardMD is for registered doctors only. After a real (Google/Apple) sign-in we
 * require a one-time certificate check: the user uploads their medical registration
 * certificate, /api/verify-doctor reads it (Gemini) and cross-checks the LIVE NMC
 * register, then sets the Firebase custom claim verified:true (mirrors the `pro`
 * claim in account.js). Until that claim is present a full-screen overlay blocks the
 * app. Enforcement of the claim is server-side in /api/verify-doctor; this module is
 * the client gate + upload UI.
 *
 * Pattern mirrors account.js: read-only over app.js, hook public window.* seams,
 * steer DOM via listeners/observers. Loaded AFTER account.js in index.html.
 */
(function () {
  "use strict";

  /* -------- Verification entitlement (single source of truth) --------
   * Real entitlement = Firebase custom claim verified===true (set by /api/verify-doctor).
   * During rollout the team stays in via VERIFY_ALLOWLIST so onboarding can be tested
   * without every tester owning a scanned certificate.
   * ⚠️ Leave BETA_VERIFY_ALL = false; it exists only as an emergency master bypass. */
  var BETA_VERIFY_ALL = false;
  var VERIFY_ALLOWLIST = ["drmanojkurmana@gmail.com", "northstar201b@gmail.com", "mkkmanojkumar0@gmail.com"];

  function auth() { try { return window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()); } catch (e) { return null; } }
  function fbUser() { try { var a = auth(); return a && a.currentUser; } catch (e) { return null; } }
  function curEmail() { var u = fbUser(); return String((u && u.email) || "").toLowerCase(); }
  function allowlisted() { return BETA_VERIFY_ALL || VERIFY_ALLOWLIST.indexOf(curEmail()) > -1; }

  // Resolve verified state → Promise<boolean>. Allowlist first, then the live claim.
  function isVerified() {
    if (allowlisted()) return Promise.resolve(true);
    var u = fbUser(); if (!u) return Promise.resolve(false);
    return u.getIdTokenResult().then(function (r) { return !!(r && r.claims && r.claims.verified === true); }).catch(function () { return false; });
  }
  window.SMD_VERIFY = { isVerified: isVerified, VERIFY_ALLOWLIST: VERIFY_ALLOWLIST };

  // ---- Overlay refs (markup lives in index.html: #verifyGate) ----
  function $(id) { return document.getElementById(id); }
  function gate() { return $("verifyGate"); }
  function showGate() { var g = gate(); if (g) { g.classList.remove("hidden"); g.style.display = "flex"; } }
  function hideGate() { var g = gate(); if (g) { g.classList.add("hidden"); g.style.display = "none"; } }

  function status(kind, html) {
    var s = $("verifyStatus"); if (!s) return;
    s.className = "verify-status show " + kind; s.innerHTML = html;
  }

  function fileToB64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ""); var c = s.indexOf(","); resolve({ b64: c >= 0 ? s.slice(c + 1) : s, mime: file.type || "image/jpeg" }); };
      r.onerror = reject; r.readAsDataURL(file);
    });
  }

  var submitting = false;
  async function submit() {
    if (submitting) return;
    var input = $("verifyFile"); var file = input && input.files && input.files[0];
    if (!file) return;
    var u = fbUser();
    if (!u) { status("error", "Session expired — please sign in again."); return; }
    submitting = true;
    var btn = $("verifySubmit"); if (btn) btn.disabled = true;
    status("info", '<span class="verify-spinner"></span>Reading your certificate and checking the National Medical Register…');
    try {
      var parts = await Promise.all([fileToB64(file), u.getIdToken()]);
      var payload = parts[0], idToken = parts[1];
      var res = await fetch("/api/verify-doctor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: idToken, image: payload.b64, mime: payload.mime })
      });
      var data = await res.json().catch(function () { return {}; });

      if (data.status === "verified") {
        status("success", "✓ Verified — Dr. " + (data.name || "") + " (" + (data.regNo || "") + "). Opening StewardMD…");
        try { await u.getIdToken(true); } catch (e) {}   // refresh so the new claim is live
        setTimeout(hideGate, 900);
        return;
      }
      if (data.status === "pending_review") {
        status("pending",
          "Thanks — we couldn't auto-verify this instantly, so it's been sent for a quick manual review. " +
          "We'll email your Google address once approved (usually within a day). " +
          'Questions? <a href="mailto:support@stewardmd.in" style="color:inherit;text-decoration:underline;">support@stewardmd.in</a>.');
        submitting = false; if (btn) btn.disabled = false; return;
      }
      if (data.status === "rejected" && data.reason === "registration_already_claimed") {
        status("error", "This registration number is already linked to a different account. Contact support@stewardmd.in if this is an error.");
        submitting = false; if (btn) btn.disabled = false; return;
      }
      status("error", (data.detail || data.error || "Verification failed") + " — try another image or contact support@stewardmd.in.");
      submitting = false; if (btn) btn.disabled = false;
    } catch (e) {
      status("error", "Network error — please try again.");
      submitting = false; if (btn) btn.disabled = false;
    }
  }

  // ---- Wire the overlay controls once the DOM exists ----
  function wire() {
    var input = $("verifyFile"), drop = $("verifyDrop"), btn = $("verifySubmit"),
        signout = $("verifySignOut"), label = $("verifyFileLabel");
    if (input && !input._smdWired) {
      input._smdWired = true;
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        if (f) { if (label) label.textContent = "📄 " + f.name; if (drop) drop.classList.add("has-file"); if (btn) btn.disabled = false; }
        else { if (drop) drop.classList.remove("has-file"); if (btn) btn.disabled = true; }
      });
    }
    if (btn && !btn._smdWired) { btn._smdWired = true; btn.addEventListener("click", submit); }
    if (signout && !signout._smdWired) {
      signout._smdWired = true;
      signout.addEventListener("click", function () {
        hideGate();
        try { var a = auth(); if (a && a.signOut) a.signOut(); } catch (e) {}
        try { location.reload(); } catch (e) {}
      });
    }
  }

  // ---- Decide whether to block: signed-in real accounts must be verified ----
  function evaluate() {
    var u = fbUser();
    if (!u) { hideGate(); return; }                 // not signed in → app.js's account gate handles it
    wire();
    isVerified().then(function (ok) { if (ok) hideGate(); else showGate(); });
  }

  // React to auth changes (sign-in / restore / sign-out) and to profile changes.
  (function boot(n) {
    var a = auth();
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { evaluate(); }); }
    else if (n < 80) { setTimeout(function () { boot(n + 1); }, 250); return; }
    try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.onChange) window.SMD_ACCOUNT.onChange(function () { evaluate(); }); } catch (e) {}
    // A late-mounting overlay (native WebView) — re-evaluate on DOM growth, cheaply.
    try { new MutationObserver(function () { if (fbUser()) wire(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    evaluate();
  })(0);
})();
