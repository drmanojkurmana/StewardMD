/* phone-verify.js - verify the signed-in doctor's mobile number: a 6-digit code on WhatsApp, SMS as
 * backup. (Owner request 2026-09-19: "after sign in ask every signup phone number verified by
 * WhatsApp with backup SMS".)
 * ============================================================================================
 * WHEN it asks: once auth resolves, if the account does not carry the `phoneVerified` claim. If the
 * first-run profile form (profile-setup.js) is open it waits for `smd:profile-saved`, so the two
 * sheets never stack; the saved phone is pre-filled. "Later" postpones for this app-open only, so
 * it comes back next start, like the profile form. It never blocks a guest or the app.
 *
 * Server: POST /api/auth/phone-start { phone, channel? } and /api/auth/phone-verify { code }
 * (functions/api/auth/[[path]].js -> functions/_phone_otp.js). The server picks WhatsApp when a
 * provider is configured and falls back to SMS; the sheet says which one carried the code and
 * offers "Send by SMS instead".
 *
 * Kill switch: localStorage smd_phone_verify = "0" (client) or PHONE_VERIFY_ON=0 (server, the
 * routes answer { error:"off" } and the sheet closes quietly).
 *
 * Self-contained overlay (its own DOM + CSS), same reasons as profile-setup.js.
 * Exposes window.SMD_PHONE_VERIFY = { open, close, needed, check, FLAG }.
 * ============================================================================================ */
(function () {
  "use strict";

  var ROOT_ID = "phvRoot", FLAG = "smd_phone_verify", SNOOZE = "smd_phone_verify_snoozed";
  var RESEND_S = 30;

  function flagOn() { try { return localStorage.getItem(FLAG) !== "0"; } catch (e) { return true; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function user() { try { return (window.SMD_AUTH && SMD_AUTH.currentUser) || null; } catch (e) { return null; } }
  function docRef() {
    try { var u = user(), d = window.SMD_DB; return (u && d) ? d.collection("users").doc(u.uid).collection("profile").doc("self") : null; } catch (e) { return null; }
  }
  function doneKey(uid) { return "smd_phone_verified_" + uid; }

  function styleOnce() {
    if (document.getElementById("phvCss")) return;
    var st = document.createElement("style"); st.id = "phvCss";
    st.textContent = [
      "#" + ROOT_ID + "{position:fixed;inset:0;z-index:17000;display:none;align-items:flex-end;justify-content:center;background:rgba(15,23,42,.46);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}",
      "#" + ROOT_ID + ".on{display:flex}",
      "#" + ROOT_ID + " .phv-card{width:100%;max-width:560px;max-height:92vh;overflow:auto;background:var(--hpanel,#fff);color:var(--hink,#0f172a);border-radius:20px 20px 0 0;padding:20px 18px calc(env(safe-area-inset-bottom,0px) + 18px);box-shadow:0 -8px 40px -8px rgba(15,23,42,.4);font-family:var(--hfont,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif)}",
      "#" + ROOT_ID + " .phv-ico{width:44px;height:44px;border-radius:14px;background:#e9f4f2;color:#0e6e63;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 0 12px}",
      "#" + ROOT_ID + " .phv-t{font:800 20px/1.2 var(--hfont,system-ui);letter-spacing:-.01em;margin:0 0 6px}",
      "#" + ROOT_ID + " .phv-s{font:500 13.5px/1.5 var(--hfont,system-ui);color:var(--hmut,#64748b);margin:0 0 16px}",
      "#" + ROOT_ID + " .phv-l{display:block;font:700 11.5px/1 var(--hfont,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--hmut,#64748b);margin:0 0 6px}",
      "#" + ROOT_ID + " .phv-in{width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;font:600 16px var(--hfont,system-ui);background:var(--hpanel,#fff);color:var(--hink,#0f172a);min-height:48px}",
      "#" + ROOT_ID + " .phv-code{font:700 28px/1 'SF Mono',Menlo,Consolas,monospace;letter-spacing:10px;text-align:center;padding:16px 8px 16px 18px}",
      "#" + ROOT_ID + " .phv-err{font:600 12px var(--hfont,system-ui);color:#b91c1c;margin-top:6px;min-height:14px}",
      "#" + ROOT_ID + " .phv-ok{font:600 12.5px var(--hfont,system-ui);color:#0e6e63;margin-top:8px}",
      "#" + ROOT_ID + " .phv-acts{display:flex;gap:10px;margin-top:16px}",
      "#" + ROOT_ID + " .phv-btn{flex:1;border:0;border-radius:12px;padding:13px;font:700 14px var(--hfont,system-ui);cursor:pointer;min-height:48px}",
      "#" + ROOT_ID + " .phv-go{background:var(--hp,#0e6e63);color:#fff}",
      "#" + ROOT_ID + " .phv-go[disabled]{opacity:.6}",
      "#" + ROOT_ID + " .phv-later{background:none;border:1px solid var(--hbd,#e2e8f0);color:var(--hmut,#64748b);flex:0 0 32%}",
      "#" + ROOT_ID + " .phv-alt{display:block;width:100%;background:none;border:0;color:#0e6e63;font:600 13px var(--hfont,system-ui);padding:12px 0 0;cursor:pointer;text-align:center}",
      "#" + ROOT_ID + " .phv-alt[disabled]{color:var(--hmut,#94a3b8);cursor:default}",
      "body.dark #" + ROOT_ID + " .phv-card{background:#111b2e;color:#e7edf5}",
      "body.dark #" + ROOT_ID + " .phv-in{background:#0b1220;color:#e7edf5;border-color:#1e2b43}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    styleOnce();
    el = document.createElement("div"); el.id = ROOT_ID;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Verify your mobile number");
    document.body.appendChild(el);
    return el;
  }
  function close() { var el = document.getElementById(ROOT_ID); if (el) { el.classList.remove("on"); el.innerHTML = ""; } clearInterval(tick); }
  function snooze() { try { sessionStorage.setItem(SNOOZE, "1"); } catch (e) {} close(); }

  var state = { phone: "", step: "phone", channel: "", to: "", sentAt: 0, busy: false };
  var tick = null;

  function api(path, body) {
    var u = user();
    if (!u || typeof u.getIdToken !== "function") return Promise.reject(new Error("signin-required"));
    return u.getIdToken().then(function (tok) {
      return fetch("/api/auth/" + path, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: "bad-response" }; }); });
  }

  var ERR = {
    "bad-phone": "Enter a valid mobile number with the country code.",
    "too-soon": "A code was just sent. Wait a moment before asking again.",
    "daily-cap": "Too many codes for this number today. Try again tomorrow.",
    "no-channel": "We cannot send codes right now. Please try again later.",
    "send-failed": "The code could not be delivered. Try SMS instead.",
    "mismatch": "That code is not right.",
    "expired": "That code has expired. Send a new one.",
    "locked": "Too many wrong attempts. Send a new code.",
    "bad-code": "Enter the 6-digit code.",
    "signin-required": "Sign in again to continue.",
    "off": ""
  };
  function errText(r) {
    if (!r) return "Something went wrong. Try again.";
    var t = ERR[r.error];
    if (r.error === "mismatch" && typeof r.triesLeft === "number") t += " " + r.triesLeft + " " + (r.triesLeft === 1 ? "try" : "tries") + " left.";
    return t == null ? "Something went wrong. Try again." : t;
  }

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */
  function render() {
    var el = root(); el.classList.add("on");
    if (state.step === "phone") {
      el.innerHTML = '<div class="phv-card">' +
        '<div class="phv-ico">&#128241;</div>' +
        '<div class="phv-t">Verify your mobile number</div>' +
        '<p class="phv-s">We send a 6-digit code on <b>WhatsApp</b>. No WhatsApp on this number? It arrives by SMS instead. Colleagues and FollowCare reach you on this number.</p>' +
        '<label class="phv-l" for="phvPhone">Mobile number</label>' +
        '<input class="phv-in" id="phvPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91 98765 43210" value="' + esc(state.phone) + '">' +
        '<div class="phv-err" id="phvErr"></div>' +
        '<div class="phv-acts"><button type="button" class="phv-btn phv-later" id="phvLater">Later</button>' +
        '<button type="button" class="phv-btn phv-go" id="phvSend">Send code on WhatsApp</button></div>' +
        '<button type="button" class="phv-alt" id="phvSms">Send by SMS instead</button></div>';
      el.querySelector("#phvLater").addEventListener("click", snooze);
      el.querySelector("#phvSend").addEventListener("click", function () { send("auto"); });
      el.querySelector("#phvSms").addEventListener("click", function () { send("sms"); });
      el.querySelector("#phvPhone").addEventListener("input", function (e) { state.phone = e.target.value; });
      return;
    }
    var via = state.channel === "sms" ? "SMS" : "WhatsApp";
    el.innerHTML = '<div class="phv-card">' +
      '<div class="phv-ico">' + (state.channel === "sms" ? "&#128172;" : "&#9989;") + '</div>' +
      '<div class="phv-t">Enter the code</div>' +
      '<p class="phv-s">Sent by <b>' + via + '</b> to <b>' + esc(state.to) + '</b>.' + (state.fellBack ? " WhatsApp did not go through, so it went by SMS." : "") + '</p>' +
      '<label class="phv-l" for="phvCode">6-digit code</label>' +
      '<input class="phv-in phv-code" id="phvCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;">' +
      '<div class="phv-err" id="phvErr"></div>' +
      '<div class="phv-acts"><button type="button" class="phv-btn phv-later" id="phvBack">Change number</button>' +
      '<button type="button" class="phv-btn phv-go" id="phvVerify">Verify</button></div>' +
      '<button type="button" class="phv-alt" id="phvResend" disabled>Resend code</button>' +
      (state.channel !== "sms" ? '<button type="button" class="phv-alt" id="phvSms2">Send by SMS instead</button>' : "") +
      '</div>';
    el.querySelector("#phvBack").addEventListener("click", function () { state.step = "phone"; render(); });
    el.querySelector("#phvVerify").addEventListener("click", verify);
    el.querySelector("#phvResend").addEventListener("click", function () { send(state.channel === "sms" ? "sms" : "auto"); });
    var s2 = el.querySelector("#phvSms2"); if (s2) s2.addEventListener("click", function () { send("sms"); });
    var code = el.querySelector("#phvCode");
    code.addEventListener("input", function () { code.value = code.value.replace(/\D/g, "").slice(0, 6); if (code.value.length === 6) verify(); });
    setTimeout(function () { try { code.focus(); } catch (e) {} }, 50);
    countdown();
  }
  function countdown() {
    clearInterval(tick);
    var el = document.getElementById(ROOT_ID);
    function paint() {
      var b = el && el.querySelector("#phvResend"); if (!b) { clearInterval(tick); return; }
      var left = RESEND_S - Math.floor((Date.now() - state.sentAt) / 1000);
      if (left > 0) { b.disabled = true; b.textContent = "Resend code in " + left + "s"; }
      else { b.disabled = false; b.textContent = "Resend code"; clearInterval(tick); }
    }
    paint(); tick = setInterval(paint, 1000);
  }
  function showErr(msg) { var e = document.getElementById("phvErr"); if (e) e.textContent = msg || ""; }
  function busy(on, id, label) {
    state.busy = on;
    var b = document.getElementById(id); if (b) { b.disabled = on; if (label) b.textContent = label; }
  }

  function send(channel) {
    if (state.busy) return;
    var digits = String(state.phone || "").replace(/\D/g, "");
    if (digits.length < 10) { showErr(ERR["bad-phone"]); return; }
    showErr("");
    busy(true, channel === "sms" ? "phvSms" : "phvSend", channel === "sms" ? "Sending SMS..." : "Sending...");
    api("phone-start", { phone: state.phone, channel: channel }).then(function (r) {
      busy(false);
      if (r && r.error === "off") { close(); return; }
      if (!r || !r.ok) { if (state.step === "phone") render(); showErr(errText(r)); return; }
      state.step = "code"; state.channel = r.channel || "whatsapp"; state.to = r.to || ""; state.fellBack = !!r.fellBack; state.sentAt = Date.now();
      render();
    }).catch(function () { busy(false); render(); showErr("You are offline. Try again once you are connected."); });
  }

  function verify() {
    if (state.busy) return;
    var code = (document.getElementById("phvCode") || {}).value || "";
    if (code.replace(/\D/g, "").length !== 6) { showErr(ERR["bad-code"]); return; }
    showErr(""); busy(true, "phvVerify", "Verifying...");
    api("phone-verify", { code: code }).then(function (r) {
      busy(false, "phvVerify", "Verify");
      if (!r || !r.ok) { showErr(errText(r)); if (r && (r.error === "expired" || r.error === "locked")) { var b = document.getElementById("phvResend"); if (b) { b.disabled = false; b.textContent = "Resend code"; } } return; }
      var u = user();
      try { if (u) localStorage.setItem(doneKey(u.uid), "1"); } catch (e) {}
      try { var ref = docRef(); if (ref) ref.set({ phone: state.phone, phoneVerifiedAt: Date.now() }, { merge: true }).catch(function () {}); } catch (e) {}
      try { if (u && u.getIdToken) u.getIdToken(true).catch(function () {}); } catch (e) {}   // pick up the new claim
      close(); toast("Mobile number verified");
      try { document.dispatchEvent(new CustomEvent("smd:phone-verified")); } catch (e) {}
    }).catch(function () { busy(false, "phvVerify", "Verify"); showErr("You are offline. Try again once you are connected."); });
  }

  /* ── should we ask? ───────────────────────────────────────────────────────────────────────── */
  // cb(needed:boolean, phone:string). Signed in, flag on, not snoozed, no phoneVerified claim.
  function needed(cb) {
    var u = user();
    if (!u || !flagOn()) { cb(false, ""); return; }
    try { if (sessionStorage.getItem(SNOOZE)) { cb(false, ""); return; } } catch (e) {}
    try { if (localStorage.getItem(doneKey(u.uid))) { cb(false, ""); return; } } catch (e) {}
    var claims = (typeof u.getIdTokenResult === "function") ? u.getIdTokenResult().then(function (r) { return (r && r.claims) || {}; }).catch(function () { return {}; }) : Promise.resolve({});
    claims.then(function (c) {
      if (c && c.phoneVerified === true) { try { localStorage.setItem(doneKey(u.uid), "1"); } catch (e) {} cb(false, ""); return; }
      var ref = docRef();
      if (!ref) { cb(true, ""); return; }
      ref.get().then(function (snap) {
        var d = (snap && snap.exists && snap.data()) || {};
        if (d.phoneVerifiedAt) { cb(false, ""); return; }   // verified from another device before claims refreshed
        cb(true, d.phone || "");
      }).catch(function () { cb(true, ""); });
    });
  }

  function open(phone) { state = { phone: phone || state.phone || "", step: "phone", channel: "", to: "", sentAt: 0, busy: false }; render(); }

  var _asked = false;
  function check() {
    if (_asked || !user()) return;
    needed(function (yes, phone) {
      if (!yes) return;
      _asked = true;
      // The first-run profile form owns the screen first; take over when it saves (or if it is not there).
      var pf = document.getElementById("pfSetupRoot");
      if (pf && pf.classList.contains("on")) {
        var once = function (e) { document.removeEventListener("smd:profile-saved", once); whenClear(function () { open((e && e.detail && e.detail.phone) || phone); }); };
        document.addEventListener("smd:profile-saved", once);
        return;
      }
      whenClear(function () { open(phone); });
    });
  }
  // The registration-verification gate (#verifyGate) is a full-screen sheet above us; never stack on
  // it. Poll until it is hidden (or give up quietly after ~2 minutes; next app-open asks again).
  function gateOpen() {
    try { var g = document.getElementById("verifyGate"); return !!(g && !g.classList.contains("hidden") && getComputedStyle(g).display !== "none"); } catch (e) { return false; }
  }
  function whenClear(fn) {
    var n = 0;
    (function tickGate() {
      if (!gateOpen()) { setTimeout(fn, 400); return; }
      if (++n > 80) return;
      setTimeout(tickGate, 1500);
    })();
  }
  function start() {
    try {
      if (window.SMD_AUTH && SMD_AUTH.onAuthStateChanged) {
        SMD_AUTH.onAuthStateChanged(function (u) { if (u) setTimeout(check, 2000); });   // after profile-setup's 1200ms
        return;
      }
    } catch (e) {}
    var n = 0, t = setInterval(function () {
      n++;
      try { if (window.SMD_AUTH && SMD_AUTH.onAuthStateChanged) { clearInterval(t); start(); return; } } catch (e) {}
      if (n > 40) clearInterval(t);
    }, 500);
  }
  if (document.readyState !== "loading") setTimeout(start, 900);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(start, 900); });

  window.SMD_PHONE_VERIFY = { open: open, close: close, needed: needed, check: check, FLAG: FLAG, _state: function () { return state; }, _reset: function () { _asked = false; }, _start: start };
})();
