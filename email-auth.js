/* StewardMD — email sign-up/sign-in + email OTP verification + doctor profile (hospital/state/city).
 * Additive, self-contained; exposes window.SMD_EMAIL_AUTH + window.SMD_openProfile. Reads the
 * existing Firebase seams (window.SMD_AUTH = firebase.auth(), window.SMD_DB = firestore) — no edits
 * to app.js. Runs entirely in the WebView, so it works identically on web + iOS + Android (OTP is an
 * in-app code, no deep links). Requires Email/Password enabled in the Firebase console.
 *
 * Flow: "Continue with email" → email + password (create or sign in) → for new accounts a 6-digit
 * Resend OTP (/api/auth) → a one-time profile step (name · hospital · state · city) for EVERY new
 * user (Google/Apple too), saved to Firestore users/{uid}/profile/self. Skippable; re-openable from
 * Account via window.SMD_openProfile(). */
(function () {
  "use strict";

  function auth() { try { return window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth()); } catch (e) { return null; } }
  function db() { try { return window.SMD_DB || (window.firebase && firebase.firestore && firebase.firestore()); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(m) { try { if (window.toast) window.toast(m); else if (window.SMD_toast) window.SMD_toast(m); } catch (e) {} }
  function geo() { return window.SMD_GEO || null; }

  function profileRef(uid) { var d = db(); if (!d || !uid) return null; return d.collection("users").doc(uid).collection("profile").doc("self"); }
  function loadProfile(uid) { var r = profileRef(uid); if (!r) return Promise.resolve(null); return r.get().then(function (s) { return s.exists ? s.data() : {}; }).catch(function () { return null; }); }
  function saveProfile(uid, data) { var r = profileRef(uid); if (!r) return Promise.reject(); return r.set(data, { merge: true }); }
  function idToken() { var a = auth(); var u = a && a.currentUser; return u ? u.getIdToken() : Promise.reject("no-user"); }

  // ---- CSS ---------------------------------------------------------------------------------
  function injectCSS() {
    if (document.getElementById("smdEmailAuthCss")) return;
    var st = document.createElement("style"); st.id = "smdEmailAuthCss";
    st.textContent = [
      ".smdea{position:fixed;inset:0;z-index:100120;background:rgba(9,17,25,.55);display:flex;align-items:center;justify-content:center;padding:calc(20px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui,-apple-system,'IBM Plex Sans',sans-serif);overflow-y:auto}",
      ".smdea-card{width:min(420px,100%);max-height:100%;overflow-y:auto;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:20px;box-shadow:0 24px 60px -18px rgba(9,17,25,.5);padding:22px 20px}",
      ".smdea-h{font:800 20px/1.2 var(--sans,system-ui);margin:2px 0 4px}",
      ".smdea-sub{font:500 13.5px/1.5 var(--sans,system-ui);color:var(--mut,#5a7184);margin:0 0 16px}",
      ".smdea-lbl{display:block;font:700 11px/1 var(--sans,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--mut,#5a7184);margin:12px 2px 6px}",
      ".smdea-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#d7dee3);border-radius:11px;padding:12px 13px;font:500 15px/1.3 var(--sans,system-ui);background:var(--paper,#f6f7f5);color:var(--ink,#14202b)}",
      ".smdea-in:focus{outline:none;border-color:var(--teal,#0e6e63)}",
      ".smdea-btn{width:100%;border:none;border-radius:12px;padding:14px;font:800 15px/1 var(--sans,system-ui);cursor:pointer;background:var(--teal,#0e6e63);color:#fff;margin-top:16px}",
      ".smdea-btn[disabled]{opacity:.55;cursor:default}",
      ".smdea-ghost{width:100%;border:none;background:none;color:var(--mut,#5a7184);font:600 13px var(--sans,system-ui);cursor:pointer;padding:12px;margin-top:6px}",
      ".smdea-link{background:none;border:none;color:var(--teal,#0e6e63);font:700 13px var(--sans,system-ui);cursor:pointer;padding:0}",
      ".smdea-err{font:600 12.5px/1.4 var(--sans,system-ui);color:#b91c1c;background:#fee2e2;border-radius:9px;padding:9px 11px;margin-top:12px;display:none}",
      ".smdea-err.on{display:block}",
      ".smdea-otp{width:100%;box-sizing:border-box;text-align:center;letter-spacing:12px;font:800 26px/1 'IBM Plex Mono',monospace;border:1.5px solid var(--line,#d7dee3);border-radius:12px;padding:16px;background:var(--paper,#f6f7f5);color:var(--ink,#14202b)}",
      ".smdea-ac{position:relative}",
      ".smdea-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:11px;box-shadow:0 12px 30px -12px rgba(9,17,25,.35);max-height:220px;overflow-y:auto;display:none}",
      ".smdea-list.on{display:block}",
      ".smdea-opt{display:block;width:100%;text-align:left;border:none;background:none;padding:10px 13px;cursor:pointer;font:500 14px/1.3 var(--sans,system-ui);color:var(--ink,#14202b);border-bottom:1px solid var(--line,#eef2f0)}",
      ".smdea-opt:hover,.smdea-opt.hl{background:var(--teal-soft,#e3f1ee)}",
      ".smdea-opt .c{display:block;font:500 11.5px var(--sans,system-ui);color:var(--mut,#5a7184);margin-top:1px}",
      ".smdea-opt.add{color:var(--teal,#0e6e63);font-weight:700}",
      ".smdea-fine{font:500 11px/1.5 var(--sans,system-ui);color:var(--mut,#5a7184);margin-top:14px}",
      "body.dark .smdea-card,body.v3-dark .smdea-card{background:#132030;color:#e8edf2;--line:#233242;--paper:#0d1b26;--mut:#7690a6}",
      "body.dark .smdea-list,body.v3-dark .smdea-list{background:#132030}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- overlay shell -----------------------------------------------------------------------
  var _el = null, _state = {};
  function shell() {
    injectCSS();
    if (!_el) { _el = document.createElement("div"); _el.className = "smdea"; _el.setAttribute("role", "dialog"); _el.setAttribute("aria-modal", "true"); document.body.appendChild(_el); }
    _el.style.display = "flex";
    return _el;
  }
  function close() { if (_el) { _el.style.display = "none"; _el.innerHTML = ""; } _state = {}; }
  function err(msg) { var e = _el && _el.querySelector(".smdea-err"); if (e) { e.textContent = msg; e.classList.toggle("on", !!msg); } }
  function busy(on) { var b = _el && _el.querySelector(".smdea-btn"); if (b) { b.disabled = !!on; if (on) { b.dataset.lbl = b.dataset.lbl || b.textContent; b.textContent = "Please wait…"; } else if (b.dataset.lbl) b.textContent = b.dataset.lbl; } }

  // ---- 1. email + password -----------------------------------------------------------------
  function openEmail(mode) {
    _state.mode = mode || "signup";
    var isSignup = _state.mode === "signup";
    shell().innerHTML =
      '<div class="smdea-card">' +
        '<div class="smdea-h">' + (isSignup ? "Create your account" : "Sign in") + "</div>" +
        '<div class="smdea-sub">' + (isSignup ? "Use your work email to get started." : "Welcome back.") + "</div>" +
        (isSignup ? '<label class="smdea-lbl">Full name</label><input class="smdea-in" id="eaName" type="text" autocomplete="name" placeholder="Dr Jane Doe">' : "") +
        '<label class="smdea-lbl">Email</label><input class="smdea-in" id="eaEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@hospital.org">' +
        '<label class="smdea-lbl">Password</label><input class="smdea-in" id="eaPw" type="password" autocomplete="' + (isSignup ? "new-password" : "current-password") + '" placeholder="At least 8 characters">' +
        (isSignup ? "" : '<div style="text-align:right;margin-top:8px"><button class="smdea-link" data-ea="forgot">Forgot password?</button></div>') +
        '<div class="smdea-err"></div>' +
        '<button class="smdea-btn" data-ea="submit">' + (isSignup ? "Create account" : "Sign in") + "</button>" +
        '<div style="text-align:center;margin-top:14px;font:500 13px var(--sans,system-ui);color:var(--mut,#5a7184)">' +
          (isSignup ? "Already have an account? " : "New to StewardMD? ") +
          '<button class="smdea-link" data-ea="toggle">' + (isSignup ? "Sign in" : "Create one") + "</button></div>" +
        '<button class="smdea-ghost" data-ea="cancel">Back</button>' +
        (isSignup ? '<div class="smdea-fine">By continuing you agree to our Terms & Privacy. Clinical features additionally require doctor verification.</div>' : "") +
      "</div>";
    _el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-ea]"); if (!b) return;
      var a = b.getAttribute("data-ea");
      if (a === "cancel") return close();
      if (a === "toggle") return openEmail(isSignup ? "signin" : "signup");
      if (a === "forgot") return openForgot((_el.querySelector("#eaEmail") || {}).value || "");
      if (a === "submit") return submitEmail(isSignup);
    };
    setTimeout(function () { var f = _el.querySelector(isSignup ? "#eaName" : "#eaEmail"); if (f) f.focus(); }, 60);
  }

  // ---- forgot password: OTP reset (primary) + temp-password fallback -----------------------
  function openForgot(prefillEmail) {
    _state.reset = { email: (prefillEmail || _state.email || "").trim() };
    shell().innerHTML =
      '<div class="smdea-card">' +
        '<div class="smdea-h">Reset your password</div>' +
        '<div class="smdea-sub">Enter your account email — we’ll send a 6-digit code to reset it.</div>' +
        '<label class="smdea-lbl">Email</label><input class="smdea-in" id="rqEmail" type="email" inputmode="email" autocomplete="email" value="' + esc(_state.reset.email) + '" placeholder="you@hospital.org">' +
        '<div class="smdea-err"></div>' +
        '<button class="smdea-btn" data-ea="reqCode">Send reset code</button>' +
        '<div style="text-align:center;margin-top:14px;font:500 12.5px var(--sans,system-ui);color:var(--mut,#5a7184)">Prefer a password by email? <button class="smdea-link" data-ea="reqTemp">Email me a temporary password</button></div>' +
        '<button class="smdea-ghost" data-ea="backSignin">Back to sign in</button>' +
      "</div>";
    _el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-ea]"); if (!b) return;
      var a = b.getAttribute("data-ea");
      if (a === "backSignin") return openEmail("signin");
      if (a === "reqCode") return requestReset("otp");
      if (a === "reqTemp") return requestReset("temp");
    };
    setTimeout(function () { var f = _el.querySelector("#rqEmail"); if (f) f.focus(); }, 60);
  }

  function requestReset(mode) {
    var email = ((_el.querySelector("#rqEmail") || {}).value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err("Please enter a valid email address."); return; }
    err(""); busy(true); _state.reset.email = email;
    fetch("/api/auth/reset-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, mode: mode }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        busy(false);
        if (j && j.error === "bad-email") { err("Please enter a valid email address."); return; }
        // enumeration-safe: server always returns ok. Route by the chosen mode.
        if (mode === "temp") openResetDone("temp", email);
        else openResetCode(email);
      }).catch(function () { busy(false); err("Network error. Please try again."); });
  }

  function openResetCode(email) {
    shell().innerHTML =
      '<div class="smdea-card">' +
        '<div class="smdea-h">Enter the code</div>' +
        '<div class="smdea-sub">If an account exists for <b>' + esc(email) + '</b>, we’ve sent a 6-digit code. Enter it and choose a new password.</div>' +
        '<label class="smdea-lbl">Reset code</label><input class="smdea-otp" id="rvCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">' +
        '<label class="smdea-lbl">New password</label><input class="smdea-in" id="rvPw" type="password" autocomplete="new-password" placeholder="At least 8 characters">' +
        '<div class="smdea-err"></div>' +
        '<button class="smdea-btn" data-ea="doReset">Reset &amp; sign in</button>' +
        '<div style="text-align:center;margin-top:12px;font:500 12.5px var(--sans,system-ui);color:var(--mut,#5a7184)">Didn’t get it? <button class="smdea-link" data-ea="resendReset">Resend code</button></div>' +
        '<button class="smdea-ghost" data-ea="backSignin">Back to sign in</button>' +
      "</div>";
    _el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-ea]"); if (!b) return;
      var a = b.getAttribute("data-ea");
      if (a === "backSignin") return openEmail("signin");
      if (a === "resendReset") { requestReset("otp"); toast("If the account exists, a new code is on its way"); return; }
      if (a === "doReset") return doReset(email);
    };
    setTimeout(function () { var f = _el.querySelector("#rvCode"); if (f) f.focus(); }, 60);
  }

  function doReset(email) {
    var code = ((_el.querySelector("#rvCode") || {}).value || "").replace(/\D/g, "");
    var pw = (_el.querySelector("#rvPw") || {}).value || "";
    if (code.length !== 6) { err("Enter the 6-digit code."); return; }
    if (pw.length < 8) { err("New password must be at least 8 characters."); return; }
    err(""); busy(true);
    fetch("/api/auth/reset-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, code: code, newPassword: pw }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j && j.ok) {
          // password changed → sign in with it
          var a = auth();
          if (a) return a.signInWithEmailAndPassword(email, pw).then(function () { busy(false); close(); toast("Password reset — signed in"); }).catch(function () { busy(false); openEmail("signin"); toast("Password reset — please sign in"); });
          busy(false); openEmail("signin"); toast("Password reset — please sign in");
        } else {
          busy(false);
          if (j && j.error === "mismatch") err("Incorrect code. " + (j.triesLeft != null ? j.triesLeft + " tries left." : ""));
          else if (j && j.error === "expired") err("That code expired. Tap Resend for a new one.");
          else if (j && j.error === "locked") err("Too many attempts. Tap Resend for a new code.");
          else if (j && j.error === "weak-password") err("New password must be at least 8 characters.");
          else err("Couldn’t reset. Please try again.");
        }
      }).catch(function () { busy(false); err("Network error. Please try again."); });
  }

  function openResetDone(kind, email) {
    shell().innerHTML =
      '<div class="smdea-card">' +
        '<div class="smdea-h">Check your email</div>' +
        '<div class="smdea-sub">If an account exists for <b>' + esc(email) + '</b>, we’ve emailed a temporary password. Sign in with it, then change it from Account.</div>' +
        '<button class="smdea-btn" data-ea="backSignin">Back to sign in</button>' +
      "</div>";
    _el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-ea]"); if (b && b.getAttribute("data-ea") === "backSignin") openEmail("signin"); };
  }

  function submitEmail(isSignup) {
    var a = auth(); if (!a) { err("Sign-in is still loading — try again in a moment."); return; }
    var name = (_el.querySelector("#eaName") || {}).value || "";
    var email = ((_el.querySelector("#eaEmail") || {}).value || "").trim();
    var pw = (_el.querySelector("#eaPw") || {}).value || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err("Please enter a valid email address."); return; }
    if (pw.length < 8) { err("Password must be at least 8 characters."); return; }
    if (isSignup && !name.trim()) { err("Please enter your name."); return; }
    err(""); busy(true);
    _state.name = name.trim(); _state.email = email;
    var p = isSignup ? a.createUserWithEmailAndPassword(email, pw) : a.signInWithEmailAndPassword(email, pw);
    p.then(function (cred) {
      var user = cred && cred.user;
      if (isSignup) {
        try { if (user && user.updateProfile && name.trim()) user.updateProfile({ displayName: name.trim() }); } catch (e) {}
        // new account → send OTP to verify the email
        openOtp();
        sendOtp();
      } else {
        // existing account → straight in; the profile prompt (if needed) fires on auth change
        close();
        toast("Signed in");
      }
    }).catch(function (e) {
      busy(false);
      err(authErr(e, isSignup));
    });
  }

  function authErr(e, isSignup) {
    var c = (e && e.code) || "";
    if (c === "auth/email-already-in-use") return "That email already has an account — try signing in instead.";
    if (c === "auth/invalid-email") return "That email doesn’t look right.";
    if (c === "auth/weak-password") return "Please choose a stronger password (8+ characters).";
    if (c === "auth/wrong-password" || c === "auth/invalid-credential") return "Incorrect email or password.";
    if (c === "auth/user-not-found") return "No account found — create one instead.";
    if (c === "auth/too-many-requests") return "Too many attempts. Please wait a minute and try again.";
    if (c === "auth/operation-not-allowed") return "Email sign-in isn’t enabled yet. Please contact support.";
    if (c === "auth/network-request-failed") return "Network error — check your connection.";
    return (e && e.message) || "Something went wrong. Please try again.";
  }

  // ---- 2. OTP verify -----------------------------------------------------------------------
  function openOtp() {
    shell().innerHTML =
      '<div class="smdea-card">' +
        '<div class="smdea-h">Verify your email</div>' +
        '<div class="smdea-sub">We’ve sent a 6-digit code to <b>' + esc(_state.email || "your email") + '</b>. Enter it below.</div>' +
        '<input class="smdea-otp" id="eaOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">' +
        '<div class="smdea-err"></div>' +
        '<button class="smdea-btn" data-ea="verify">Verify</button>' +
        '<div style="text-align:center;margin-top:14px;font:500 13px var(--sans,system-ui);color:var(--mut,#5a7184)">Didn’t get it? <button class="smdea-link" data-ea="resend">Resend code</button></div>' +
        '<button class="smdea-ghost smdea-close" data-ea="later">I’ll verify later</button>' +
      "</div>";
    _el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-ea]"); if (!b) return;
      var a = b.getAttribute("data-ea");
      if (a === "verify") return verifyOtp();
      if (a === "resend") return sendOtp(true);
      if (a === "later") { toast("You can verify your email later from Account"); return afterVerified(false); }
    };
    setTimeout(function () { var f = _el.querySelector("#eaOtp"); if (f) f.focus(); }, 60);
  }

  function sendOtp(isResend) {
    err(isResend ? "" : "");
    idToken().then(function (t) {
      return fetch("/api/auth/send-otp", { method: "POST", headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" }, body: "{}" });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (o.r.ok && o.j.ok) { if (isResend) toast("New code sent"); }
        else if (o.j.error === "too-soon") { toast("Please wait a few seconds before resending"); }
        else if (o.j.error === "email-failed") { err("Couldn’t send the email just now. Tap Resend to retry."); }
        else { err("Couldn’t send a code. Tap Resend to retry."); }
      }).catch(function () { err("Network error sending the code. Tap Resend to retry."); });
  }

  function verifyOtp() {
    var code = ((_el.querySelector("#eaOtp") || {}).value || "").replace(/\D/g, "");
    if (code.length !== 6) { err("Enter the 6-digit code."); return; }
    err(""); busy(true);
    idToken().then(function (t) {
      return fetch("/api/auth/verify-otp", { method: "POST", headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ code: code }) });
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        busy(false);
        if (j && j.ok) { afterVerified(true); }
        else if (j && j.error === "mismatch") { err("Incorrect code. " + (j.triesLeft != null ? j.triesLeft + " tries left." : "")); }
        else if (j && j.error === "expired") { err("That code expired. Tap Resend for a new one."); }
        else if (j && j.error === "locked") { err("Too many attempts. Tap Resend for a new code."); }
        else { err("Couldn’t verify. Please try again."); }
      }).catch(function () { busy(false); err("Network error. Please try again."); });
  }

  function afterVerified(verified) {
    var uid = curUid();
    if (uid && verified) { try { saveProfile(uid, { emailVerified: true }); } catch (e) {} }
    // every new user gets the profile step next
    openProfile({ firstRun: true, name: _state.name });
  }

  // ---- 3. profile (name · hospital · state · city) -----------------------------------------
  function curUid() { try { var u = auth() && auth().currentUser; return u ? u.uid : null; } catch (e) { return null; } }

  function openProfile(opts) {
    opts = opts || {};
    _state.profile = _state.profile || {};
    var g = geo();
    var uid = curUid();
    var prefName = opts.name || _state.name || "";
    // pre-fill from any existing profile + Firebase displayName
    (uid ? loadProfile(uid) : Promise.resolve({})).then(function (p) {
      p = p || {};
      var name = p.name || prefName || (auth() && auth().currentUser && auth().currentUser.displayName) || "";
      var stateOpts = ['<option value="">Select state…</option>'].concat((g ? g.states() : []).map(function (s) { return '<option value="' + esc(s) + '"' + (p.state === s ? " selected" : "") + ">" + esc(s) + "</option>"; })).join("");
      shell().innerHTML =
        '<div class="smdea-card">' +
          '<div class="smdea-h">Complete your profile</div>' +
          '<div class="smdea-sub">Tell us where you practise — it tailors StewardMD to your setting. You can change this anytime.</div>' +
          '<label class="smdea-lbl">Full name</label><input class="smdea-in" id="pfName" type="text" value="' + esc(name) + '" placeholder="Dr Jane Doe">' +
          '<label class="smdea-lbl">State / UT</label><select class="smdea-in" id="pfState">' + stateOpts + "</select>" +
          '<label class="smdea-lbl">City</label><div class="smdea-ac"><input class="smdea-in" id="pfCity" type="text" value="' + esc(p.city || "") + '" placeholder="City" autocomplete="off"><div class="smdea-list" id="pfCityList"></div></div>' +
          '<label class="smdea-lbl">Hospital / Institution</label><div class="smdea-ac"><input class="smdea-in" id="pfHosp" type="text" value="' + esc(p.hospital || "") + '" placeholder="Search your hospital…" autocomplete="off"><div class="smdea-list" id="pfHospList"></div></div>' +
          '<div class="smdea-err"></div>' +
          '<button class="smdea-btn" data-ea="saveProfile">Save &amp; continue</button>' +
          (opts.firstRun ? '<button class="smdea-ghost" data-ea="skipProfile">Skip for now</button>' : '<button class="smdea-ghost" data-ea="cancel">Close</button>') +
        "</div>";
      wireProfile(g);
      _el.onclick = function (e) {
        var b = e.target.closest && e.target.closest("[data-ea]"); if (!b) return;
        var a = b.getAttribute("data-ea");
        if (a === "cancel") return close();
        if (a === "skipProfile") { markProfileSeen(); close(); toast("You can complete your profile later from Account"); return; }
        if (a === "saveProfile") return submitProfile();
      };
    });
  }

  // typeahead wiring for city + hospital
  function wireProfile(g) {
    var stateSel = _el.querySelector("#pfState");
    var cityIn = _el.querySelector("#pfCity"), cityList = _el.querySelector("#pfCityList");
    var hospIn = _el.querySelector("#pfHosp"), hospList = _el.querySelector("#pfHospList");
    function renderList(listEl, items, onPick) {
      if (!items.length) { listEl.classList.remove("on"); listEl.innerHTML = ""; return; }
      listEl.innerHTML = items.map(function (it, i) {
        return '<button type="button" class="smdea-opt' + (it.add ? " add" : "") + '" data-i="' + i + '">' + esc(it.label) + (it.sub ? '<span class="c">' + esc(it.sub) + "</span>" : "") + "</button>";
      }).join("");
      listEl.classList.add("on");
      listEl.querySelectorAll("[data-i]").forEach(function (b) { b.addEventListener("mousedown", function (ev) { ev.preventDefault(); onPick(items[+b.getAttribute("data-i")]); listEl.classList.remove("on"); }); });
    }
    function cities() { return g ? g.cities(stateSel.value) : []; }
    function refreshCities() {
      var q = cityIn.value.trim().toLowerCase();
      var base = cities();
      var items = base.filter(function (c) { return !q || c.toLowerCase().indexOf(q) >= 0; }).slice(0, 8).map(function (c) { return { label: c, value: c }; });
      renderList(cityList, items, function (it) { cityIn.value = it.value; });
    }
    function refreshHosp() {
      if (!g) return;
      var q = hospIn.value.trim();
      var res = g.searchHospitals(q, { state: stateSel.value || null, limit: 8 });
      var items = res.map(function (h) { return { label: h.name, sub: h.city + " · " + h.state, value: h.name, city: h.city, state: h.state }; });
      if (q.length >= 3) items.push({ add: true, label: 'Use "' + q + '"', value: q });
      renderList(hospList, items, function (it) {
        hospIn.value = it.value;
        if (!it.add) { if (it.city && !cityIn.value) cityIn.value = it.city; if (it.state) { stateSel.value = it.state; } }
      });
    }
    cityIn.addEventListener("focus", refreshCities); cityIn.addEventListener("input", refreshCities);
    cityIn.addEventListener("blur", function () { setTimeout(function () { cityList.classList.remove("on"); }, 150); });
    hospIn.addEventListener("focus", refreshHosp); hospIn.addEventListener("input", refreshHosp);
    hospIn.addEventListener("blur", function () { setTimeout(function () { hospList.classList.remove("on"); }, 150); });
    stateSel.addEventListener("change", function () { cityIn.value = ""; });
  }

  function submitProfile() {
    var uid = curUid(); if (!uid) { err("Please sign in first."); return; }
    var name = (_el.querySelector("#pfName") || {}).value.trim();
    var state = (_el.querySelector("#pfState") || {}).value;
    var city = (_el.querySelector("#pfCity") || {}).value.trim();
    var hospital = (_el.querySelector("#pfHosp") || {}).value.trim();
    if (!name) { err("Please enter your name."); return; }
    err(""); busy(true);
    var data = { name: name, state: state || "", city: city, hospital: hospital, profileComplete: true, updatedAt: Date.now() };
    saveProfile(uid, data).then(function () {
      try { var u = auth().currentUser; if (u && u.updateProfile && name) u.updateProfile({ displayName: name }); } catch (e) {}
      markProfileSeen();
      busy(false); close();
      toast("Profile saved");
      try { window.dispatchEvent(new CustomEvent("smd:profile", { detail: data })); } catch (e) {}
    }).catch(function () { busy(false); err("Couldn’t save your profile. Please try again."); });
  }

  // ---- profile prompt for ALL new users (incl. Google/Apple) -------------------------------
  function seenKey(uid) { return "smd_profile_prompted:" + (uid || "anon"); }
  function markProfileSeen() { try { localStorage.setItem(seenKey(curUid()), "1"); } catch (e) {} }
  function promptedThisAccount() { try { return localStorage.getItem(seenKey(curUid())) === "1"; } catch (e) { return false; } }
  // A pre-home gate is up (mirrors onboarding.js) — don't stack the profile form over it.
  function gateUp() {
    var ids = ["accountGate", "introPoster", "verifyGate", "splash", "smdBootSplash"];
    for (var i = 0; i < ids.length; i++) {
      var e = document.getElementById(ids[i]); if (!e) continue;
      if (e.classList.contains("hidden")) continue;
      var cs; try { cs = getComputedStyle(e); } catch (x) { continue; }
      if (cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0" && e.getBoundingClientRect().height > 2) return true;
    }
    return false;
  }
  var _promptChecking = false;
  function maybePromptProfile() {
    if (_el && _el.style.display === "flex") return;         // a flow is already open
    if (_promptChecking) return;
    var uid = curUid(); if (!uid) return;
    if (promptedThisAccount()) return;
    _promptChecking = true;
    loadProfile(uid).then(function (p) {
      _promptChecking = false;
      if (p && p.profileComplete) { markProfileSeen(); return; }   // already has a profile
      // wait until the app is actually in the foreground (no sign-in/intro/verify gate) so the
      // profile form never stacks over a gate; poll for up to ~40s, then give up until next launch.
      var tries = 0;
      (function waitForeground() {
        if (promptedThisAccount() || (_el && _el.style.display === "flex")) return;
        if (!gateUp()) { openProfile({ firstRun: true }); return; }
        if (++tries < 80) setTimeout(waitForeground, 500);
      })();
    }).catch(function () { _promptChecking = false; });
  }

  // ---- inject "Continue with email" into the account gate ----------------------------------
  function injectGateButton() {
    var card = document.querySelector("#accountGate .account-card"); if (!card) return;
    if (card.querySelector("#smdEmailBtn")) return;
    var b = document.createElement("button");
    b.id = "smdEmailBtn"; b.type = "button";
    b.className = "account-btn account-email-btn";
    b.style.cssText = "display:flex;align-items:center;justify-content:center;gap:9px;width:100%;box-sizing:border-box;margin-top:10px;padding:12px 14px;border:1.5px solid var(--line,#d7dee3);border-radius:12px;background:var(--panel,#fff);color:var(--ink,#14202b);font:700 14px/1 var(--sans,system-ui);cursor:pointer";
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span>Continue with email</span>';
    b.addEventListener("click", function () { openEmail("signup"); });
    // place it just after the Google fallback button (before the guest block if present)
    var anchor = card.querySelector("#googleFallbackBtn") || card.querySelector("#googleBtnContainer");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor.nextSibling);
    else card.appendChild(b);
  }
  function watchGate() {
    injectGateButton();
    try { var mo = new MutationObserver(function () { injectGateButton(); }); mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }

  // ---- public API + boot -------------------------------------------------------------------
  window.SMD_EMAIL_AUTH = { openEmail: openEmail, openOtp: openOtp, sendOtp: sendOtp };
  window.SMD_openProfile = function () { try { openProfile({ firstRun: false }); } catch (e) {} };

  function boot() {
    watchGate();
    // prompt the one-time profile step for any new signed-in user (Google/Apple/email)
    try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function () { var p = SMD_ACCOUNT.profile && SMD_ACCOUNT.profile(); if (p && p.signedIn && !p.isGuest) setTimeout(maybePromptProfile, 1200); }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
