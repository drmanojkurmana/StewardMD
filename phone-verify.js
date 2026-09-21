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
 * Look (2026-09-19 redesign): six code slots with a marching-dot ring, digits pop in, shake on a wrong
 * code, green sweep on success, resend countdown ring, WebOTP / one-time-code autofill. Inline SVG only.
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

  /* ── look ──────────────────────────────────────────────────────────────────────────────────
   * One card, two steps. The code step is six slots with a marching-dot ring on the slot that is
   * waiting for a digit; digits pop in; a wrong code shakes the row; the right one sweeps green and
   * the sheet closes. The only real input is a hidden #phvCode over the slots (so a tap on a slot
   * focuses the keyboard and iOS offers the code from the message); Android fills it through WebOTP.
   * Inline SVG only, no emoji. Light and dark. Reduced motion honoured. */
  function styleOnce() {
    if (document.getElementById("phvCss")) return;
    var st = document.createElement("style"); st.id = "phvCss";
    st.textContent = [
      "#" + ROOT_ID + "{--pv-bg:#ffffff;--pv-ink:#0f172a;--pv-mut:#5b6b7b;--pv-line:rgba(15,23,42,.10);--pv-slot:rgba(15,23,42,.045);--pv-teal:#0e6e63;--pv-teal2:#139a8a;--pv-glow:rgba(14,110,99,.22);--pv-ok:#1f9d63;--pv-bad:#d64545;--pv-font:var(--hfont,-apple-system,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif);--pv-mono:'SF Mono',Menlo,'IBM Plex Mono',Consolas,monospace;position:fixed;inset:0;z-index:17000;display:none;align-items:flex-end;justify-content:center;box-sizing:border-box;padding-bottom:var(--pv-kb,0px);background:rgba(6,12,20,.55);-webkit-backdrop-filter:blur(10px) saturate(1.1);backdrop-filter:blur(10px) saturate(1.1);-webkit-tap-highlight-color:transparent;transition:padding-bottom .2s cubic-bezier(.2,.8,.2,1)}",
      "#" + ROOT_ID + ".on{display:flex}",
      "body.dark #" + ROOT_ID + ",body.v3-dark #" + ROOT_ID + "{--pv-bg:#0e141c;--pv-ink:#eef3f8;--pv-mut:#93a3b4;--pv-line:rgba(255,255,255,.09);--pv-slot:rgba(255,255,255,.055);--pv-teal:#2fc4b0;--pv-teal2:#5ad8c8;--pv-glow:rgba(47,196,176,.25)}",
      /* A real bottom sheet: the card never covers the whole screen (a strip of dimmed app always
         shows above it, which is what makes it read as a sheet and not as a web page), it carries the
         top safe area itself, and its actions are pinned to the bottom so the keyboard never hides
         the primary button. Body scrolls inside the card; the card itself does not move. */
      "#" + ROOT_ID + " .phv-card{position:relative;width:100%;max-width:520px;max-height:calc(100% - 44px);display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--pv-bg);color:var(--pv-ink);border-radius:28px 28px 0 0;box-shadow:0 -1px 0 var(--pv-line),0 -26px 64px -22px rgba(0,0,0,.6);font-family:var(--pv-font);transform:translateY(26px);opacity:0;animation:phvUp .42s cubic-bezier(.2,.8,.2,1) forwards}",
      "@keyframes phvUp{to{transform:none;opacity:1}}",
      "#" + ROOT_ID + " .phv-head{flex:0 0 auto;padding:10px 22px 0}",
      "#" + ROOT_ID + " .phv-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 22px 4px}",
      "#" + ROOT_ID + " .phv-foot{flex:0 0 auto;padding:12px 22px calc(env(safe-area-inset-bottom,0px) + 14px);background:var(--pv-bg);border-top:1px solid var(--pv-line)}",
      "#" + ROOT_ID + ".kb .phv-foot{padding-bottom:12px}",
      "#" + ROOT_ID + ".kb .phv-card{max-height:100%;border-radius:22px 22px 0 0;animation:none;transform:none;opacity:1}",
      "#" + ROOT_ID + ".kb .phv-mark{width:34px;height:34px;border-radius:11px;margin-bottom:8px}#" + ROOT_ID + ".kb .phv-mark svg{width:17px;height:17px}",
      "#" + ROOT_ID + ".kb .phv-t{font-size:19px;margin-bottom:3px}#" + ROOT_ID + ".kb .phv-s{margin-bottom:12px;font-size:13px}",
      "#" + ROOT_ID + ".kb .phv-grab{margin-bottom:10px}",
      "#" + ROOT_ID + " .phv-grab{width:38px;height:5px;border-radius:3px;background:var(--pv-line);margin:0 auto 14px}",
      "#" + ROOT_ID + " .phv-mark{width:48px;height:48px;border-radius:16px;background:linear-gradient(140deg,var(--pv-teal),var(--pv-teal2));color:#fff;display:flex;align-items:center;justify-content:center;margin:0 0 14px;box-shadow:0 10px 24px -10px var(--pv-glow)}",
      "#" + ROOT_ID + " .phv-mark svg{width:24px;height:24px}",
      "#" + ROOT_ID + " .phv-t{font:800 24px/1.15 var(--pv-font);letter-spacing:-.02em;margin:0 0 8px}",
      "#" + ROOT_ID + " .phv-s{font:500 14.5px/1.5 var(--pv-font);color:var(--pv-mut);margin:0 0 18px}",
      "#" + ROOT_ID + " .phv-s b{color:var(--pv-ink);font-weight:700}",
      "#" + ROOT_ID + " .phv-l{display:block;font:700 11px/1 var(--pv-font);letter-spacing:.1em;text-transform:uppercase;color:var(--pv-mut);margin:0 0 8px}",
      "#" + ROOT_ID + " .phv-field{display:flex;align-items:center;gap:10px;border:1px solid var(--pv-line);background:var(--pv-slot);border-radius:16px;padding:0 14px;min-height:56px;transition:box-shadow .2s,border-color .2s}",
      "#" + ROOT_ID + " .phv-field:focus-within{border-color:var(--pv-teal);box-shadow:0 0 0 4px var(--pv-glow)}",
      "#" + ROOT_ID + " .phv-field svg{width:20px;height:20px;color:var(--pv-mut);flex:0 0 auto}",
      "#" + ROOT_ID + " .phv-in{flex:1;min-width:0;border:0;background:transparent;font:600 18px var(--pv-font);letter-spacing:.02em;color:var(--pv-ink);padding:14px 0;outline:none}",
      "#" + ROOT_ID + " .phv-in::placeholder{color:var(--pv-mut);opacity:.7;font-weight:500}",
      /* slots */
      "#" + ROOT_ID + " .phv-slotwrap{position:relative;margin:4px 0 6px}",
      "#" + ROOT_ID + " .phv-slots{display:flex;gap:9px;justify-content:space-between}",
      "#" + ROOT_ID + " .phv-slot{position:relative;flex:1;height:64px;max-width:64px;border-radius:16px;background:var(--pv-slot);border:1px solid var(--pv-line);display:flex;align-items:center;justify-content:center;font:700 28px/1 var(--pv-mono);color:var(--pv-ink);transition:border-color .18s,background .18s,box-shadow .18s,transform .18s}",
      "#" + ROOT_ID + " .phv-slot.on{border-color:var(--pv-teal);box-shadow:0 0 0 4px var(--pv-glow)}",
      "#" + ROOT_ID + " .phv-slot .phv-ring{position:absolute;inset:-1px;width:calc(100% + 2px);height:calc(100% + 2px);pointer-events:none;opacity:0;transition:opacity .2s}",
      "#" + ROOT_ID + " .phv-slot.on .phv-ring{opacity:1}",
      "#" + ROOT_ID + " .phv-slot .phv-ring rect{fill:none;stroke:var(--pv-teal);stroke-width:1.5;stroke-dasharray:2 7;stroke-linecap:round;animation:phvMarch 1.6s linear infinite}",
      "@keyframes phvMarch{to{stroke-dashoffset:-18}}",
      "#" + ROOT_ID + " .phv-slot .phv-caret{width:2px;height:26px;border-radius:1px;background:var(--pv-teal);opacity:0}",
      "#" + ROOT_ID + " .phv-slot.on .phv-caret{animation:phvBlink 1s steps(2,start) infinite}",
      "@keyframes phvBlink{to{opacity:1}}",
      "#" + ROOT_ID + " .phv-slot .phv-d{display:none}",
      "#" + ROOT_ID + " .phv-slot.filled .phv-d{display:block;animation:phvPop .22s cubic-bezier(.2,.9,.3,1.4)}",
      "#" + ROOT_ID + " .phv-slot.filled .phv-caret{display:none}",
      "@keyframes phvPop{from{transform:scale(.5);opacity:0}to{transform:none;opacity:1}}",
      "#" + ROOT_ID + " .phv-slots.bad{animation:phvShake .38s cubic-bezier(.36,.07,.19,.97)}",
      "#" + ROOT_ID + " .phv-slots.bad .phv-slot{border-color:var(--pv-bad);box-shadow:0 0 0 4px rgba(214,69,69,.16)}",
      "@keyframes phvShake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}",
      "#" + ROOT_ID + " .phv-slots.ok .phv-slot{border-color:var(--pv-ok);background:rgba(31,157,99,.10);box-shadow:none;transform:translateY(-3px)}",
      "#" + ROOT_ID + " .phv-slots.ok .phv-slot:nth-child(2){transition-delay:.05s}#" + ROOT_ID + " .phv-slots.ok .phv-slot:nth-child(3){transition-delay:.1s}#" + ROOT_ID + " .phv-slots.ok .phv-slot:nth-child(4){transition-delay:.15s}#" + ROOT_ID + " .phv-slots.ok .phv-slot:nth-child(5){transition-delay:.2s}#" + ROOT_ID + " .phv-slots.ok .phv-slot:nth-child(6){transition-delay:.25s}",
      "#" + ROOT_ID + " .phv-code{position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px;border:0;padding:0;margin:0;color:transparent;caret-color:transparent;background:transparent}",
      /* message row: what the app is doing about the code */
      "#" + ROOT_ID + " .phv-msg{display:flex;align-items:center;gap:10px;margin:14px 0 0;padding:12px 14px;border-radius:14px;background:var(--pv-slot);border:1px solid var(--pv-line);font:500 13px/1.4 var(--pv-font);color:var(--pv-mut)}",
      "#" + ROOT_ID + " .phv-msg .phv-dot{width:8px;height:8px;border-radius:4px;background:var(--pv-teal);flex:0 0 auto;box-shadow:0 0 0 0 var(--pv-glow);animation:phvPulse 1.6s ease-out infinite}",
      "@keyframes phvPulse{0%{box-shadow:0 0 0 0 var(--pv-glow)}70%{box-shadow:0 0 0 9px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}",
      "#" + ROOT_ID + " .phv-msg.done .phv-dot{animation:none;background:var(--pv-ok)}",
      "#" + ROOT_ID + " .phv-msg b{color:var(--pv-ink)}",
      "#" + ROOT_ID + " .phv-err{font:600 12.5px/1.4 var(--pv-font);color:var(--pv-bad);margin:0;max-height:0;overflow:hidden;transition:max-height .18s,margin .18s}",
      "#" + ROOT_ID + " .phv-err.on{margin-top:10px;max-height:44px}",
      /* buttons */
      "#" + ROOT_ID + " .phv-acts{display:block}",
      /* Secondary actions stack full-width under the primary: a half-width text button cannot hold
         "Resend code in 27s" without collapsing, and a stacked list is the native pattern anyway. */
      "#" + ROOT_ID + " .phv-subacts{display:block;margin-top:2px}",
      "#" + ROOT_ID + " .phv-subacts .phv-alt{padding-top:4px;white-space:nowrap}",
      "#" + ROOT_ID + " .phv-subacts .phv-later{color:var(--pv-mut)}",
      "#" + ROOT_ID + " .phv-btn{width:100%;border:0;border-radius:999px;padding:0 18px;font:700 15px var(--pv-font);cursor:pointer;min-height:54px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .12s,opacity .2s,box-shadow .2s}",
      "#" + ROOT_ID + " .phv-btn:active{transform:scale(.98)}",
      "#" + ROOT_ID + " .phv-btn svg{width:18px;height:18px}",
      "#" + ROOT_ID + " .phv-go{background:linear-gradient(140deg,var(--pv-teal),var(--pv-teal2));color:#fff;box-shadow:0 12px 26px -12px var(--pv-glow)}",
      "#" + ROOT_ID + " .phv-go[disabled]{opacity:.55;box-shadow:none}",
      "#" + ROOT_ID + " .phv-alt{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:44px;background:none;border:0;color:var(--pv-teal);font:600 14px var(--pv-font);padding:10px 0 0;cursor:pointer}",
      "#" + ROOT_ID + " .phv-alt[disabled]{color:var(--pv-mut);cursor:default}",
      "#" + ROOT_ID + " .phv-alt svg{width:18px;height:18px}",
      "#" + ROOT_ID + " .phv-alt .phv-cd{--p:0;width:18px;height:18px;border-radius:50%;background:conic-gradient(var(--pv-teal) calc(var(--p)*1%),var(--pv-line) 0);-webkit-mask:radial-gradient(circle 6px,transparent 5.2px,#000 5.6px);mask:radial-gradient(circle 6px,transparent 5.2px,#000 5.6px)}",
      "@media (prefers-reduced-motion:reduce){#" + ROOT_ID + " .phv-card,#" + ROOT_ID + " .phv-slot .phv-ring rect,#" + ROOT_ID + " .phv-slot.filled .phv-d,#" + ROOT_ID + " .phv-slots.bad,#" + ROOT_ID + " .phv-msg .phv-dot,#" + ROOT_ID + " .phv-slot.on .phv-caret{animation:none}#" + ROOT_ID + " .phv-card{transform:none;opacity:1}}"
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
  /* ── keyboard ─────────────────────────────────────────────────────────────────────────────────
   * Owner, 2026-09-21: "when keyboard is opened the dialog box doesnt go up". The sheet is
   * position:fixed and bottom-anchored, and on iOS a fixed element is laid out against the LAYOUT
   * viewport, which does not shrink when the keyboard rises: the bottom half of the card (the code
   * slots, the Verify button) sat behind the keys. window.visualViewport is the viewport the user
   * can actually see, so the root is resized to it on every change and the card, which is
   * max-height:100% of the root, scrolls inside that. Android's WebView resizes the layout viewport
   * itself, in which case this is a no-op. Nothing here fires unless the sheet is open. */
  var _vvOn = false, _vvTest = null;
  function fitViewport(vv) {
    // A viewport passed in explicitly sticks (null clears it): the browser harness has no soft
    // keyboard, so it feeds the shrunken viewport this way, and the focus/resize refits that
    // follow must not undo it.
    if (vv !== undefined) _vvTest = vv;
    var el = document.getElementById(ROOT_ID);
    if (!el || !el.classList.contains("on")) return;
    vv = _vvTest || window.visualViewport;
    if (!vv || !vv.height) return;
    var ih = window.innerHeight || vv.height;
    var kb = Math.max(0, ih - vv.height - (vv.offsetTop || 0));
    /* The root stays FULL SCREEN and the keyboard height becomes bottom padding, rather than the
     * root being resized down to the visual viewport. Resizing left the app's own tab bar visible
     * in the gap between the card and the keyboard, which is what made this look like a web page
     * sitting on top of the app instead of a sheet. Full-screen scrim + padded card = the card sits
     * directly on the keyboard and nothing of the app shows through anywhere. */
    el.style.top = ""; el.style.height = ""; el.style.bottom = "";
    el.style.setProperty("--pv-kb", Math.round(kb) + "px");
    el.classList.toggle("kb", kb > 80);
    // Keep whatever the doctor is typing in on screen inside the (now shorter) card.
    try {
      var a = document.activeElement;
      if (kb > 80 && a && el.contains(a)) setTimeout(function () { try { a.scrollIntoView({ block: "center" }); } catch (e) {} }, 60);
    } catch (e) {}
  }
  function bindViewport() {
    if (_vvOn || !window.visualViewport) return;
    _vvOn = true;
    try { window.visualViewport.addEventListener("resize", onVv); window.visualViewport.addEventListener("scroll", onVv); } catch (e) {}
    fitViewport();
  }
  function onVv() { fitViewport(undefined); }
  function unbindViewport() {
    if (_vvOn) { try { window.visualViewport.removeEventListener("resize", onVv); window.visualViewport.removeEventListener("scroll", onVv); } catch (e) {} _vvOn = false; }
    _vvTest = null;
    var el = document.getElementById(ROOT_ID);
    if (el) { el.style.top = ""; el.style.height = ""; el.style.bottom = ""; el.style.removeProperty("--pv-kb"); el.classList.remove("kb"); }
  }
  function close() { var el = document.getElementById(ROOT_ID); if (el) { el.classList.remove("on"); el.innerHTML = ""; } clearInterval(tick); abortWebOtp(); unbindViewport(); }
  function snooze() { try { sessionStorage.setItem(SNOOZE, "1"); } catch (e) {} close(); }

  var state = { phone: "", step: "phone", channel: "", to: "", sentAt: 0, busy: false };
  var tick = null;

  // Inline line icons (stroke, currentColor). No emoji anywhere in this sheet.
  var ICO = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 1 3.6 6.7L4 20l1.3-3.6A8 8 0 0 1 4 12Z"/><path d="M9 11.5h6M9 14h3"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };
  var RING = '<svg class="phv-ring" viewBox="0 0 64 64" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="1" width="62" height="62" rx="15"/></svg>';

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

  /* ── WebOTP (Android Chrome): fill the code from the SMS without a tap. iOS has no WebOTP; its
   * keyboard offers the code above the keys because the input carries autocomplete="one-time-code". */
  var _otpAbort = null;
  function abortWebOtp() { try { if (_otpAbort) _otpAbort.abort(); } catch (e) {} _otpAbort = null; }
  function listenWebOtp() {
    abortWebOtp();
    try {
      if (!("OTPCredential" in window) || !navigator.credentials || !navigator.credentials.get) return false;
      _otpAbort = new AbortController();
      navigator.credentials.get({ otp: { transport: ["sms"] }, signal: _otpAbort.signal }).then(function (c) {
        if (!c || !c.code) return;
        var inp = document.getElementById("phvCode"); if (!inp) return;
        inp.value = String(c.code).replace(/\D/g, "").slice(0, 6);
        setMsg("done", "Filled from your message.");
        paintSlots(inp.value); if (inp.value.length === 6) verify();
      }).catch(function () {});
      return true;
    } catch (e) { return false; }
  }
  function setMsg(kind, html) { var m = document.getElementById("phvMsg"); if (!m) return; m.className = "phv-msg" + (kind === "done" ? " done" : ""); m.innerHTML = '<span class="phv-dot"></span><span>' + html + '</span>'; }

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */
  function render() {
    var el = root(); el.classList.add("on"); bindViewport();
    if (state.step === "phone") {
      el.innerHTML = '<div class="phv-card">' +
        '<div class="phv-head"><div class="phv-grab"></div>' +
          '<div class="phv-mark">' + ICO.shield + '</div>' +
          '<div class="phv-t">Verify your mobile number</div></div>' +
        '<div class="phv-body">' +
          '<p class="phv-s">We send a 6-digit code on <b>WhatsApp</b>. No WhatsApp on this number? It arrives by SMS instead. Colleagues and FollowCare reach you here.</p>' +
          '<label class="phv-l" for="phvPhone">Mobile number</label>' +
          '<div class="phv-field">' + ICO.phone + '<input class="phv-in" id="phvPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91 98765 43210" value="' + esc(state.phone) + '"></div>' +
          '<div class="phv-err" id="phvErr"></div>' +
        '</div>' +
        '<div class="phv-foot">' +
          '<div class="phv-acts"><button type="button" class="phv-btn phv-go" id="phvSend">' + ICO.chat + '<span>Send code on WhatsApp</span></button></div>' +
          '<div class="phv-subacts">' +
            '<button type="button" class="phv-alt" id="phvSms">' + ICO.sms + '<span>Use SMS instead</span></button>' +
            '<button type="button" class="phv-alt phv-later" id="phvLater"><span>Later</span></button>' +
          '</div>' +
        '</div></div>';
      el.querySelector("#phvLater").addEventListener("click", snooze);
      el.querySelector("#phvSend").addEventListener("click", function () { send("auto"); });
      el.querySelector("#phvSms").addEventListener("click", function () { send("sms"); });
      el.querySelector("#phvPhone").addEventListener("input", function (e) { state.phone = e.target.value; });
      return;
    }
    var via = state.channel === "sms" ? "SMS" : "WhatsApp";
    var slots = ""; for (var i = 0; i < 6; i++) slots += '<div class="phv-slot' + (i === 0 ? " on" : "") + '" data-i="' + i + '">' + RING + '<span class="phv-d"></span><span class="phv-caret"></span></div>';
    el.innerHTML = '<div class="phv-card">' +
      '<div class="phv-head"><div class="phv-grab"></div>' +
        '<div class="phv-mark">' + (state.channel === "sms" ? ICO.sms : ICO.chat) + '</div>' +
        '<div class="phv-t">Enter the code</div></div>' +
      '<div class="phv-body">' +
        '<p class="phv-s">Sent by <b>' + via + '</b> to <b>' + esc(state.to) + '</b>.' + (state.fellBack ? " WhatsApp did not go through, so it went by SMS." : "") + '</p>' +
        '<div class="phv-slotwrap"><div class="phv-slots" id="phvSlots">' + slots + '</div>' +
        '<input class="phv-code" id="phvCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-label="6-digit code"></div>' +
        '<div class="phv-msg" id="phvMsg"></div>' +
        '<div class="phv-err" id="phvErr"></div>' +
      '</div>' +
      '<div class="phv-foot">' +
        '<div class="phv-acts"><button type="button" class="phv-btn phv-go" id="phvVerify">' + ICO.check + '<span>Verify</span></button></div>' +
        '<div class="phv-subacts">' +
          '<button type="button" class="phv-alt" id="phvResend" disabled><span class="phv-cd"></span><span>Resend code</span></button>' +
          '<button type="button" class="phv-alt phv-later" id="phvBack">' + ICO.back + '<span>Number</span></button>' +
        '</div>' +
        (state.channel !== "sms" ? '<button type="button" class="phv-alt" id="phvSms2">' + ICO.sms + '<span>Send by SMS instead</span></button>' : "") +
      '</div></div>';
    el.querySelector("#phvBack").addEventListener("click", function () { abortWebOtp(); state.step = "phone"; render(); });
    el.querySelector("#phvVerify").addEventListener("click", verify);
    el.querySelector("#phvResend").addEventListener("click", function () { send(state.channel === "sms" ? "sms" : "auto"); });
    var s2 = el.querySelector("#phvSms2"); if (s2) s2.addEventListener("click", function () { send("sms"); });
    var code = el.querySelector("#phvCode");
    code.addEventListener("input", function () {
      code.value = code.value.replace(/\D/g, "").slice(0, 6);
      var sl = document.getElementById("phvSlots"); if (sl) sl.classList.remove("bad");
      showErr(""); paintSlots(code.value);
      if (code.value.length === 6) verify();
    });
    code.addEventListener("paste", function (e) {
      try { var t = (e.clipboardData || window.clipboardData).getData("text"); var d = String(t || "").replace(/\D/g, "").slice(0, 6); if (d.length === 6) { e.preventDefault(); code.value = d; paintSlots(d); verify(); } } catch (x) {}
    });
    code.addEventListener("focus", function () { paintSlots(code.value); });
    code.addEventListener("blur", function () { paintSlots(code.value, true); });
    paintSlots("");
    setMsg("", listenWebOtp()
      ? "Waiting for the message. The code fills in by itself when it arrives."
      : "When the message arrives, tap the code above your keyboard and it fills in.");
    setTimeout(function () { try { code.focus(); } catch (e) {} }, 420);
    countdown();
  }
  // Mirror the hidden input into the six slots; the slot waiting for a digit carries the ring.
  function paintSlots(v, blurred) {
    var sl = document.getElementById("phvSlots"); if (!sl) return;
    v = String(v || "");
    var kids = sl.children;
    for (var i = 0; i < kids.length; i++) {
      var d = kids[i].querySelector(".phv-d");
      var has = i < v.length;
      if (has && d.textContent !== v[i]) { d.textContent = v[i]; }
      if (!has) d.textContent = "";
      kids[i].classList.toggle("filled", has);
      kids[i].classList.toggle("on", !blurred && i === Math.min(v.length, 5) && v.length < 6);
    }
  }
  function countdown() {
    clearInterval(tick);
    var el = document.getElementById(ROOT_ID);
    function paint() {
      var b = el && el.querySelector("#phvResend"); if (!b) { clearInterval(tick); return; }
      var left = RESEND_S - Math.floor((Date.now() - state.sentAt) / 1000);
      var cd = b.querySelector(".phv-cd"), lab = b.querySelector("span:last-child");
      if (left > 0) { b.disabled = true; if (lab) lab.textContent = "Resend code in " + left + "s"; if (cd) cd.style.setProperty("--p", String(Math.round((RESEND_S - left) / RESEND_S * 100))); }
      else { b.disabled = false; if (lab) lab.textContent = "Resend code"; if (cd) cd.style.setProperty("--p", "100"); clearInterval(tick); }
    }
    paint(); tick = setInterval(paint, 1000);
  }
  function showErr(msg) {
    var e = document.getElementById("phvErr");
    if (!e) return;
    e.textContent = msg || "";
    // The error line collapses when empty, so there is no dead gap above the buttons when nothing
    // is wrong, and the message is scrolled into view inside the card body when there is.
    e.classList.toggle("on", !!msg);
    if (msg) { try { e.scrollIntoView({ block: "nearest" }); } catch (x) {} }
  }
  function busy(on, id, label) {
    state.busy = on;
    var b = document.getElementById(id); if (b) { b.disabled = on; if (label) { var sp = b.querySelector("span:last-child"); if (sp) sp.textContent = label; else b.textContent = label; } }
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
    var inp = document.getElementById("phvCode");
    var code = (inp || {}).value || "";
    if (code.replace(/\D/g, "").length !== 6) { showErr(ERR["bad-code"]); return; }
    showErr(""); busy(true, "phvVerify", "Verifying...");
    api("phone-verify", { code: code }).then(function (r) {
      busy(false, "phvVerify", "Verify");
      var sl = document.getElementById("phvSlots");
      if (!r || !r.ok) {
        showErr(errText(r));
        if (sl) { sl.classList.remove("bad"); void sl.offsetWidth; sl.classList.add("bad"); }
        if (inp) { inp.value = ""; paintSlots(""); try { inp.focus(); } catch (e) {} }
        if (r && (r.error === "expired" || r.error === "locked")) { var b = document.getElementById("phvResend"); if (b) { b.disabled = false; var lab = b.querySelector("span:last-child"); if (lab) lab.textContent = "Resend code"; } }
        return;
      }
      abortWebOtp();
      var u = user();
      try { if (u) localStorage.setItem(doneKey(u.uid), "1"); } catch (e) {}
      try { var ref = docRef(); if (ref) ref.set({ phone: state.phone, phoneVerifiedAt: Date.now() }, { merge: true }).catch(function () {}); } catch (e) {}
      try { if (u && u.getIdToken) u.getIdToken(true).catch(function () {}); } catch (e) {}
      if (sl) { sl.classList.remove("bad"); sl.classList.add("ok"); }
      setMsg("done", "Verified.");
      var t = document.querySelector("#" + ROOT_ID + " .phv-t"); if (t) t.textContent = "Number verified";
      setTimeout(function () { close(); toast("Mobile number verified"); }, 650);
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

  try {
    document.addEventListener("focusin", function (e) {
      var el = document.getElementById(ROOT_ID);
      if (!el || !el.classList.contains("on") || !el.contains(e.target)) return;
      setTimeout(function () { fitViewport(undefined); }, 120); setTimeout(function () { fitViewport(undefined); }, 420);
    }, true);
  } catch (e) {}
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
    try {
      var g = document.getElementById("verifyGate");
      if (g && !g.classList.contains("hidden") && getComputedStyle(g).display !== "none") return true;
      // The guided tour (onboarding.js) sits above everything on a first launch; ask after it.
      var w = document.querySelector(".smdt-wel"), c = document.querySelector(".smdt-card");
      if ((w && w.style.display === "flex") || (c && c.style.display === "block")) return true;
    } catch (e) {}
    return false;
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

  window.SMD_PHONE_VERIFY = { open: open, close: close, needed: needed, check: check, FLAG: FLAG, _state: function () { return state; }, _reset: function () { _asked = false; }, _start: start, _fit: fitViewport };
})();
