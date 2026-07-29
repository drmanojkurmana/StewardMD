/* steward-id-onboard.js — on sign-in, ensure a universal StewardMD ID + a verified anchor email.
 * Gated by smd_steward_id (default OFF). Primary remedy for Apple Hide-My-Email is linking Google;
 * fallback is a typed email verified by the /api/auth/anchor-* OTP. */
(function () {
  "use strict";
  function flagOn() { try { return !!(window.SMD_STEWARD_ID_FLAGS && window.SMD_STEWARD_ID_FLAGS.bool("smd_steward_id")); } catch (e) { return false; } }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // Testable core: decide prompt vs straight-through. deps: { ensure(cb), promptRealEmail(user), writeAnchor(email, source) }
  function run(user, deps) {
    return new Promise(function (resolve) {
      deps.ensure(function () {
        var cls = window.SMD_ANCHOR.resolve(user);
        if (window.SMD_ANCHOR.needsRealEmail(cls)) { deps.promptRealEmail(user); resolve(); return; }
        deps.writeAnchor(String(user.email || "").toLowerCase(), cls.source);
        resolve();
      });
    });
  }

  // --- browser wiring -------------------------------------------------------------------------
  function auth() { try { return window.firebase && window.firebase.auth && window.firebase.auth(); } catch (e) { return null; } }
  function db() { try { return window.firebase && window.firebase.firestore && window.firebase.firestore(); } catch (e) { return null; } }
  function serverTs() { try { return window.firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return null; } }
  function idToken() { var a = auth(); var u = a && a.currentUser; return u && u.getIdToken ? u.getIdToken() : Promise.reject(new Error("no-user")); }

  // writeAnchorBrowser: set profile/self fields + the e_<hash> uniqueness index. Aborts the
  // directory write (but NOT the profile write... actually: only commits if the index is free or
  // already ours) via a transaction, mirroring the reg-no one-account-per-identity guard.
  function writeAnchorBrowser(email, source, verified) {
    email = String(email || "").trim().toLowerCase();
    var d = db(); var u = auth() && auth().currentUser;
    if (!d || !u || !email) return Promise.resolve();
    var uid = u.uid;
    var profRef = d.collection("users").doc(uid).collection("profile").doc("self");
    var hash = window.SMD_STEWARD_ID.emailHash(email);
    var dirRef = d.collection("doctorDirectory").doc("e_" + hash);
    return d.runTransaction(function (tx) {
      return tx.get(dirRef).then(function (snap) {
        if (snap && snap.exists) {
          var data = snap.data() || {};
          if (data.uid && data.uid !== uid) return Promise.reject(new Error("email-taken"));
        }
        tx.set(dirRef, { uid: uid, at: serverTs() }, { merge: true });
        tx.set(profRef, {
          anchorEmail: email,
          anchorEmailVerified: !!verified,
          anchorEmailSource: source,
          anchorEmailAt: serverTs()
        }, { merge: true });
      });
    }).catch(function (e) {
      if (e && e.message === "email-taken") {
        toast("This email is already linked to another StewardMD account");
      }
      throw e;
    });
  }

  // --- capture modal ---------------------------------------------------------------------------
  function injectCSS() {
    if (document.getElementById("smdOnbCss")) return;
    var st = document.createElement("style"); st.id = "smdOnbCss";
    st.textContent = [
      ".smdonb{position:fixed;inset:0;z-index:100130;background:rgba(9,17,25,.55);display:flex;align-items:center;justify-content:center;padding:calc(20px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui,-apple-system,'IBM Plex Sans',sans-serif);overflow-y:auto}",
      ".smdonb-card{width:min(420px,100%);max-height:100%;overflow-y:auto;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:20px;box-shadow:0 24px 60px -18px rgba(9,17,25,.5);padding:22px 20px}",
      ".smdonb-h{font:800 20px/1.2 var(--sans,system-ui);margin:2px 0 4px}",
      ".smdonb-sub{font:500 13.5px/1.5 var(--sans,system-ui);color:var(--mut,#5a7184);margin:0 0 16px}",
      ".smdonb-lbl{display:block;font:700 11px/1 var(--sans,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--mut,#5a7184);margin:12px 2px 6px}",
      ".smdonb-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#d7dee3);border-radius:11px;padding:12px 13px;font:500 15px/1.3 var(--sans,system-ui);background:var(--paper,#f6f7f5);color:var(--ink,#14202b)}",
      ".smdonb-in:focus{outline:none;border-color:var(--teal,#0e6e63)}",
      ".smdonb-otp{width:100%;box-sizing:border-box;text-align:center;letter-spacing:12px;font:800 26px/1 'IBM Plex Mono',monospace;border:1.5px solid var(--line,#d7dee3);border-radius:12px;padding:16px;background:var(--paper,#f6f7f5);color:var(--ink,#14202b)}",
      ".smdonb-btn{width:100%;border:none;border-radius:12px;padding:14px;font:800 15px/1 var(--sans,system-ui);cursor:pointer;background:var(--teal,#0e6e63);color:#fff;margin-top:16px}",
      ".smdonb-btn[disabled]{opacity:.55;cursor:default}",
      ".smdonb-ghost{width:100%;border:none;background:none;color:var(--mut,#5a7184);font:600 13px var(--sans,system-ui);cursor:pointer;padding:12px;margin-top:6px}",
      ".smdonb-or{text-align:center;font:600 12px var(--sans,system-ui);color:var(--mut,#5a7184);margin:16px 0 4px}",
      ".smdonb-err{font:600 12.5px/1.4 var(--sans,system-ui);color:#b91c1c;background:#fee2e2;border-radius:9px;padding:9px 11px;margin-top:12px;display:none}",
      ".smdonb-err.on{display:block}",
      "body.dark .smdonb-card,body.v3-dark .smdonb-card{background:#132030;color:#e8edf2;--line:#233242;--paper:#0d1b26;--mut:#7690a6}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  var _el = null, _state = {};
  function shell() {
    injectCSS();
    if (!_el) { _el = document.createElement("div"); _el.className = "smdonb"; _el.setAttribute("role", "dialog"); _el.setAttribute("aria-modal", "true"); document.body.appendChild(_el); }
    _el.style.display = "flex";
    return _el;
  }
  function close() { if (_el) { _el.style.display = "none"; _el.innerHTML = ""; } _state = {}; }
  function err(msg) { var e = _el && _el.querySelector(".smdonb-err"); if (e) { e.textContent = msg; e.classList.toggle("on", !!msg); } }
  function busy(on) {
    var btns = _el ? _el.querySelectorAll(".smdonb-btn") : [];
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i]; b.disabled = !!on;
      if (on) { b.dataset.lbl = b.dataset.lbl || b.textContent; b.textContent = "Please wait…"; }
      else if (b.dataset.lbl) { b.textContent = b.dataset.lbl; delete b.dataset.lbl; }
    }
  }

  function promptRealEmailBrowser(user) {
    _state = { user: user };
    shell().innerHTML =
      '<div class="smdonb-card">' +
        '<div class="smdonb-h">Add a real email</div>' +
        '<div class="smdonb-sub">Apple’s private relay address can’t receive messages from StewardMD (verification codes, results, account alerts). Please link a real email to keep your account fully working.</div>' +
        '<button class="smdonb-btn" data-onb="google">Continue with Google</button>' +
        '<div class="smdonb-or">or enter an email</div>' +
        '<label class="smdonb-lbl">Email</label><input class="smdonb-in" id="onbEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@hospital.org">' +
        '<div class="smdonb-err"></div>' +
        '<button class="smdonb-btn" data-onb="sendCode" style="background:var(--panel,#fff);color:var(--teal,#0e6e63);border:1.5px solid var(--teal,#0e6e63)">Send code</button>' +
        '<button class="smdonb-ghost smdonb-close" data-onb="later">I’ll do this later</button>' +
      "</div>";
    _el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-onb]"); if (!b) return;
      var a = b.getAttribute("data-onb");
      if (a === "google") return linkGoogle();
      if (a === "sendCode") return sendAnchorCode();
      if (a === "later") { close(); return; }
    };
    setTimeout(function () { var f = _el.querySelector("#onbEmail"); if (f) f.focus(); }, 60);
  }

  function sendAnchorCode() {
    var email = ((_el.querySelector("#onbEmail") || {}).value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err("Please enter a valid email address."); return; }
    err(""); busy(true);
    idToken().then(function (t) {
      return fetch("/api/auth/anchor-start", { method: "POST", headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ email: email }) });
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        busy(false);
        if (j && j.ok) { _state.email = email; openAnchorCodeEntry(email); return; }
        var e = j && j.error;
        if (e === "bad-email") err("Please enter a valid email address.");
        else if (e === "too-soon") toast("Please wait a few seconds before resending");
        else if (e === "email-failed") err("Couldn’t send the email just now. Please try again.");
        else err("Couldn’t send a code. Please try again.");
      }).catch(function () { busy(false); err("Network error. Please try again."); });
  }

  function openAnchorCodeEntry(email) {
    shell().innerHTML =
      '<div class="smdonb-card">' +
        '<div class="smdonb-h">Enter the code</div>' +
        '<div class="smdonb-sub">We’ve sent a 6-digit code to <b>' + esc(email) + '</b>.</div>' +
        '<input class="smdonb-otp" id="onbCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">' +
        '<div class="smdonb-err"></div>' +
        '<button class="smdonb-btn" data-onb="verify">Verify</button>' +
        '<div style="text-align:center;margin-top:14px;font:500 13px var(--sans,system-ui);color:var(--mut,#5a7184)">Didn’t get it? <button class="smdonb-ghost" style="display:inline;width:auto;padding:0;margin:0;color:var(--teal,#0e6e63);font-weight:700" data-onb="resend">Resend code</button></div>' +
        '<button class="smdonb-ghost smdonb-close" data-onb="later">I’ll do this later</button>' +
      "</div>";
    _el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-onb]"); if (!b) return;
      var a = b.getAttribute("data-onb");
      if (a === "verify") return verifyAnchorCode(email);
      if (a === "resend") return sendAnchorCode();
      if (a === "later") { close(); return; }
    };
    setTimeout(function () { var f = _el.querySelector("#onbCode"); if (f) f.focus(); }, 60);
  }

  function verifyAnchorCode(email) {
    var code = ((_el.querySelector("#onbCode") || {}).value || "").replace(/\D/g, "");
    if (code.length !== 6) { err("Enter the 6-digit code."); return; }
    err(""); busy(true);
    idToken().then(function (t) {
      return fetch("/api/auth/anchor-verify", { method: "POST", headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ email: email, code: code }) });
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j && j.ok && j.verified) {
          return writeAnchorBrowser(email, "manual", true).then(function () {
            busy(false); close(); toast("Email verified");
          }, function () { busy(false); });
        }
        busy(false);
        var e = j && j.error;
        if (e === "bad-code") err("Enter the 6-digit code.");
        else if (e === "mismatch") err("Incorrect code. " + (j.triesLeft != null ? j.triesLeft + " tries left." : ""));
        else if (e === "expired") err("That code expired. Tap Resend for a new one.");
        else if (e === "locked") err("Too many attempts. Tap Resend for a new code.");
        else err("Couldn’t verify. Please try again.");
      }).catch(function () { busy(false); err("Network error. Please try again."); });
  }

  function linkGoogle() {
    var a = auth(); var u = a && a.currentUser;
    if (!u || !u.linkWithPopup) { err("Sign-in is still loading — try again in a moment."); return; }
    err(""); busy(true);
    var provider = new window.firebase.auth.GoogleAuthProvider();
    u.linkWithPopup(provider).then(function (result) {
      var googleEmail = (result && result.user && result.user.email) ||
        (result && result.additionalUserInfo && result.additionalUserInfo.profile && result.additionalUserInfo.profile.email) ||
        (u && u.email) || "";
      googleEmail = String(googleEmail || "").trim().toLowerCase();
      if (!googleEmail) { busy(false); err("Couldn’t read the linked Google email. Please try again."); return; }
      return writeAnchorBrowser(googleEmail, "google", true).then(function () {
        busy(false); close(); toast("Google account linked");
      }, function () { busy(false); });
    }).catch(function (e) {
      busy(false);
      var c = (e && e.code) || "";
      if (c === "auth/credential-already-in-use") toast("That Google account is already linked to another StewardMD account");
      else if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") { /* silent — user backed out */ }
      else err("Couldn’t link Google. Please try again.");
    });
  }

  var _started = false;
  function init() {
    if (_started || !flagOn()) return; _started = true;
    try {
      window.firebase.auth().onAuthStateChanged(function (user) {
        if (!user) return;
        run(user, {
          ensure: function (cb) { window.SMD_STEWARD_ID.ensure({}, cb); },
          promptRealEmail: promptRealEmailBrowser,
          writeAnchor: function (email, source) { writeAnchorBrowser(email, source, true); }
        });
      });
    } catch (e) {}
  }
  try { if (typeof window !== "undefined" && window.firebase) init(); } catch (e) {}
  var API = { init: init, run: run, writeAnchor: writeAnchorBrowser, _flagOn: flagOn };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ONBOARD = API;
})();
