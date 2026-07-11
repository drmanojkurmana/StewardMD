/* StewardMD — doctor verification gate + account panel (additive; NEVER edits app.js).
 * ---------------------------------------------------------------------------
 * StewardMD is for registered doctors only. After a real (Google/Apple/phone) sign-in we
 * require a one-time certificate check: the user uploads their medical registration
 * certificate, /api/verify-doctor reads it (Gemini) and cross-checks the LIVE NMC register,
 * then sets the Firebase custom claim verified:true (mirrors the `pro` claim in account.js).
 *
 * Two surfaces, one overlay (#verifyGate):
 *   • FORCED gate — unverified signed-in users are blocked until they verify (no close).
 *   • ACCOUNT PANEL — opened from the sidebar menu ("Account & Verification"); shows the
 *     linked account (provider + email) ↔ registration number ↔ status, with an upload
 *     option when not yet verified. Closable.
 *
 * Pattern mirrors account.js / home.js: read-only over app.js, wrap public window.* seams,
 * steer DOM via listeners/observers. Loaded AFTER account.js in index.html.
 */
(function () {
  "use strict";

  /* Team bypass during rollout (mirrors account.js TEST_PRO_EMAILS). Leave BETA_VERIFY_ALL
   * false; trim the allowlist before public launch and rely on the claim. */
  var BETA_VERIFY_ALL = false;
  var VERIFY_ALLOWLIST = ["drmanojkurmana@gmail.com", "northstar201b@gmail.com", "mkkmanojkumar0@gmail.com"];

  function auth() { try { return window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()); } catch (e) { return null; } }
  function fbUser() { try { var a = auth(); return a && a.currentUser; } catch (e) { return null; } }
  function curEmail() { var u = fbUser(); return String((u && u.email) || "").toLowerCase(); }
  function allowlisted() { return BETA_VERIFY_ALL || VERIFY_ALLOWLIST.indexOf(curEmail()) > -1; }
  function providerLabel() {
    try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.provider) {
      var p = window.SMD_ACCOUNT.provider();
      return ({ google: "Google", apple: "Apple", email: "Email", phone: "Mobile", tester: "Tester" })[p] || (p || "—");
    } } catch (e) {}
    return "—";
  }

  // Resolve the verified custom claim → Promise<boolean>.
  function isVerifiedClaim() {
    if (allowlisted()) return Promise.resolve(true);
    var u = fbUser(); if (!u) return Promise.resolve(false);
    return u.getIdTokenResult().then(function (r) { return !!(r && r.claims && r.claims.verified === true); }).catch(function () { return false; });
  }
  // Full status (incl. pending) from the server; falls back to the claim.
  function fetchStatus() {
    var u = fbUser();
    if (allowlisted()) return Promise.resolve({ status: "verified", regNo: "(team access)" });
    if (!u) return Promise.resolve({ status: "unverified" });
    return u.getIdToken().then(function (tok) {
      return fetch("/api/verify-doctor", { headers: { "Authorization": "Bearer " + tok } })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d && d.status ? d : { status: "unverified" }; });
    }).catch(function () {
      return isVerifiedClaim().then(function (ok) { return { status: ok ? "verified" : "unverified" }; });
    });
  }
  window.SMD_VERIFY = { isVerified: isVerifiedClaim, openPanel: openPanel, VERIFY_ALLOWLIST: VERIFY_ALLOWLIST };

  // ---- Overlay refs ----
  function $(id) { return document.getElementById(id); }
  function gate() { return $("verifyGate"); }

  function setStatusMsg(kind, html) { var s = $("verifyStatus"); if (!s) return; s.className = "verify-status show " + kind; s.innerHTML = html; }
  function clearStatusMsg() { var s = $("verifyStatus"); if (s) { s.className = "verify-status"; s.innerHTML = ""; } }

  // Render the overlay for a given mode. forced=true → hard block (no close).
  function render(mode, data) {
    var g = gate(); if (!g) return;
    g.dataset.mode = mode;
    var verified = data && data.status === "verified";
    var pending  = data && data.status === "pending";
    var st = (data && data.status) || "unverified";

    var acc = $("verifyAccount");
    if (acc && st !== "loading") {
      acc.style.display = "";
      var u = fbUser();
      $("verifyAccEmail").textContent = (u && (u.email || u.displayName)) || "—";
      $("verifyAccProvider").textContent = providerLabel();
      $("verifyAccReg").textContent = (data && data.regNo) || (verified ? "—" : "not linked yet");
      var badge = $("verifyBadge");
      badge.className = "verify-badge " + st;
      badge.textContent = ({ verified: "✓ Verified", pending: "Under review", rejected: "Rejected", unverified: "Not verified" })[st] || st;
    }

    $("verifyTitle").textContent = verified ? "Your account is verified" : (pending ? "Verification under review" : "Verify you're a registered doctor");
    var sub = $("verifySubtitle");
    if (sub) sub.textContent = verified
      ? "Your medical registration is linked to this account."
      : (pending
        ? "We've received your certificate and are reviewing it. We'll email you once it's approved."
        : "StewardMD is for registered medical practitioners only. Upload your medical registration certificate — we verify it instantly against the National Medical Register.");

    var up = $("verifyUploadBlock");
    if (up) up.style.display = (verified || pending) ? "none" : "";
    if (!verified && !pending) {
      clearStatusMsg();
      // Reset the upload control to reflect whether a file is currently chosen.
      var inp = $("verifyFile"), sub = $("verifySubmit"), lbl = $("verifyFileLabel"), drp = $("verifyDrop");
      var hasFile = !!(inp && inp.files && inp.files[0]);
      if (sub) { sub.disabled = false; sub.textContent = hasFile ? "Verify & continue" : "Choose certificate"; }
      if (!hasFile) { if (lbl) lbl.textContent = "📄 Choose your registration certificate"; if (drp) drp.classList.remove("has-file"); }
    }

    var closable = mode !== "forced";
    var x = $("verifyClose"); if (x) x.style.display = closable ? "" : "none";
    var done = $("verifyDoneBtn"); if (done) done.style.display = (closable && (verified || pending)) ? "" : "none";

    g.classList.remove("hidden"); g.style.display = "flex";
  }

  function showForced() { render("forced", { status: "unverified" }); }
  function hideGate() { var g = gate(); if (g) { g.classList.add("hidden"); g.style.display = "none"; g.dataset.mode = ""; } }

  // Open the account/verification panel from the menu (always closable).
  function openPanel() {
    render("panel", { status: "loading" });
    $("verifyTitle").textContent = "Account & Verification";
    setStatusMsg("info", '<span class="verify-spinner"></span>Checking your verification status…');
    fetchStatus().then(function (d) { clearStatusMsg(); render("panel", d); });
  }

  // ---- Upload flow ----
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
    // No file yet → the button acts as "Choose certificate": open the picker.
    if (!file) { if (input) input.click(); return; }
    var u = fbUser(); if (!u) { setStatusMsg("error", "Session expired — please sign in again."); return; }
    submitting = true;
    var btn = $("verifySubmit"); if (btn) btn.disabled = true;
    setStatusMsg("info", '<span class="verify-spinner"></span>Reading your certificate and checking the National Medical Register…');
    try {
      var parts = await Promise.all([fileToB64(file), u.getIdToken()]);
      var res = await fetch("/api/verify-doctor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: parts[1], image: parts[0].b64, mime: parts[0].mime })
      });
      var data = await res.json().catch(function () { return {}; });

      if (data.status === "verified") {
        setStatusMsg("success", "✓ Verified — Dr. " + (data.name || "") + " (" + (data.regNo || "") + "). Opening StewardMD…");
        try { await u.getIdToken(true); } catch (e) {}
        setTimeout(hideGate, 900);
        return;
      }
      if (data.status === "pending_review") { render(gate().dataset.mode || "panel", { status: "pending" }); submitting = false; return; }
      if (data.status === "rejected" && data.reason === "registration_already_claimed") {
        setStatusMsg("error", "This registration number is already linked to a different account. Contact support@stewardmd.in.");
        submitting = false; if (btn) btn.disabled = false; return;
      }
      setStatusMsg("error", (data.detail || data.error || "Verification failed") + " — try another image or contact support@stewardmd.in.");
      submitting = false; if (btn) btn.disabled = false;
    } catch (e) {
      setStatusMsg("error", "Network error — please try again.");
      submitting = false; if (btn) btn.disabled = false;
    }
  }

  function wire() {
    var input = $("verifyFile"), drop = $("verifyDrop"), btn = $("verifySubmit"),
        signout = $("verifySignOut"), label = $("verifyFileLabel"), x = $("verifyClose"), done = $("verifyDoneBtn");
    if (input && !input._smdWired) {
      input._smdWired = true;
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        if (f) { if (label) label.textContent = "📄 " + f.name; if (drop) drop.classList.add("has-file"); if (btn) { btn.disabled = false; btn.textContent = "Verify & continue"; } }
        else { if (label) label.textContent = "📄 Choose your registration certificate"; if (drop) drop.classList.remove("has-file"); if (btn) { btn.disabled = false; btn.textContent = "Choose certificate"; } }
      });
    }
    if (btn && !btn._smdWired) { btn._smdWired = true; btn.addEventListener("click", submit); }
    if (x && !x._smdWired) { x._smdWired = true; x.addEventListener("click", hideGate); }
    if (done && !done._smdWired) { done._smdWired = true; done.addEventListener("click", hideGate); }
    if (signout && !signout._smdWired) {
      signout._smdWired = true;
      signout.addEventListener("click", function () {
        hideGate();
        try { var a = auth(); if (a && a.signOut) a.signOut(); } catch (e) {}
        try { location.reload(); } catch (e) {}
      });
    }
  }

  // ---- Forced gate: signed-in real accounts must be verified ----
  function evaluate() {
    var u = fbUser();
    if (!u) { hideGate(); return; }            // not signed in → app.js's account gate handles it
    wire();
    isVerifiedClaim().then(function (ok) {
      var g = gate();
      if (ok) { if (g && g.dataset.mode !== "panel") hideGate(); }
      else showForced();
    });
  }

  // ---- Inject "Account & Verification" into the sidebar (mirrors home.js SB.open wrap) ----
  function injectMenu() {
    var menu = $("sbMenu"); if (!menu || menu.querySelector("[data-smd-verify]")) return;
    var b = document.createElement("button");
    b.className = "sb-main sb-main-link"; b.setAttribute("data-smd-verify", "1");
    b.innerHTML = '<span class="ic">🩺</span><span>Account &amp; Verification</span>';
    b.addEventListener("click", function () { try { if (window.SB && SB.close) SB.close(); } catch (e) {} setTimeout(openPanel, 80); });
    menu.insertBefore(b, menu.firstChild);
  }
  function wrapSBOpen() {
    try {
      if (window.SB && typeof SB.open === "function" && !SB.open._smdVerifyWrapped) {
        var orig = SB.open;
        SB.open = function () { var r = orig.apply(this, arguments); setTimeout(injectMenu, 90); return r; };
        SB.open._smdVerifyWrapped = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ---- Boot ----
  (function boot(n) {
    var a = auth();
    if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { evaluate(); }); }
    else if (n < 80) { setTimeout(function () { boot(n + 1); }, 250); return; }
    try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.onChange) window.SMD_ACCOUNT.onChange(function () { evaluate(); }); } catch (e) {}
    try { new MutationObserver(function () { if (fbUser()) wire(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    evaluate();
  })(0);
  (function hookMenu(n) { if (wrapSBOpen()) { injectMenu(); return; } if (n < 120) setTimeout(function () { hookMenu(n + 1); }, 250); })(0);
})();
