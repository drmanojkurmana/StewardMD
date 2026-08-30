/* applock.js — StewardMD App Lock: PIN / Face ID·Touch ID / no lock, chosen once at first
 * login and enforced on every cold boot before the boot splash reveals the app.
 *
 * Three options, offered once (email-auth.js calls promptSetup() right after the first-run
 * profile step, for every sign-in method — Google/Apple/email all funnel through the same
 * openProfile()):
 *   1. PIN         — 4-6 digits, works on any device. Hash+salt only, never the raw PIN,
 *                    stored in the OS Keychain/Keystore via capacitor-secure-storage-plugin
 *                    (same window.SMD_SECURE shim autofetch.js defines); localStorage is a
 *                    dev/web fallback only.
 *   2. Biometric   — real Face ID / Touch ID (iOS) and fingerprint/face/iris (Android) via
 *                    @aparajita/capacitor-biometric-auth (registered plugin name
 *                    "BiometricAuthNative", capacitor.Plugins access — no bundler needed, same
 *                    pattern as the SecureStoragePlugin calls elsewhere in this codebase).
 *                    Offered only once checkBiometry() reports isAvailable — i.e. the device
 *                    actually HAS enrolled biometry, not merely that the plugin is compiled in.
 *                    iOS needs NSFaceIDUsageDescription in Info.plist (added); Android needs no
 *                    manifest change (AndroidX BiometricPrompt handles the permission itself).
 *   3. No lock     — auto sign-in, own-risk. PERSONAL accounts only: hidden entirely when the
 *                    profile has a hospital/institution on file, so a shared or institutional
 *                    device can never end up unlocked-by-default.
 *
 * FAIL-OPEN, matching this file's own boot-splash conventions: any error here leaves the app
 * exactly as it was before this file existed (method stays "none"/unconfigured, nothing is
 * required). A signed-in clinician locked out of their own app is a clinical problem, not a
 * cosmetic one — every unlock screen also offers "Sign out" as a way out.
 *
 * Flag: smd_applock (default OFF until the owner approves it on a device). ?applock=1 /
 * localStorage.smd_applock="1" forces on for testing; ?applock=0 forces off.
 */
(function () {
  "use strict";
  if (window.SMD_APPLOCK) return;

  function flagOn() {
    try {
      var q = location.search || "";
      if (/[?&]applock=1\b/.test(q)) return true;
      if (/[?&]applock=0\b/.test(q)) return false;
      return localStorage.getItem("smd_applock") === "1";
    } catch (e) { return false; }
  }

  // ---- device secure storage (Keychain/Keystore); the same shim autofetch.js defines ----
  if (!window.SMD_SECURE) {
    window.SMD_SECURE = (function () {
      function ss() { try { var P = window.Capacitor && window.Capacitor.Plugins; return P && P.SecureStoragePlugin; } catch (e) { return null; } }
      return {
        available: function () { return !!ss(); },
        set: function (key, val) { var s = ss(); if (!s) return Promise.reject(new Error("secure-unavailable")); return s.set({ key: key, value: (typeof val === "string") ? val : JSON.stringify(val) }); },
        get: function (key) { var s = ss(); if (!s) return Promise.resolve(null); return s.get({ key: key }).then(function (r) { return (r && r.value != null) ? r.value : null; }).catch(function () { return null; }); },
        remove: function (key) { var s = ss(); if (!s) return Promise.resolve(); return s.remove({ key: key }).catch(function () {}); },
      };
    })();
  }
  var SEC = window.SMD_SECURE;
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // Device-local keys — the lock guards THIS device's boot splash, not a synced account setting.
  var K_METHOD = "smd_applock_method";           // "pin" | "biometric" | "none" | absent
  var K_PIN = "smd_applock_pin";                 // "<salt>:<sha256 hex>"
  var K_INSTITUTIONAL = "smd_applock_institutional"; // "1" if a hospital was on file at setup
  var K_FAILS = "smd_applock_fails";
  var K_BLOCK = "smd_applock_blockuntil";
  var K_GRACE = "smd_applock_grace";             // "2h" = don't ask again within 2h of the last open
  var K_LASTUNLOCK = "smd_applock_lastunlock";   // ms epoch of the last unlock / grace-skipped open
  var GRACE_MS = 2 * 60 * 60 * 1000;
  var _fromManage = false; // chooser opened from Account > Security (closable) vs first-run (forced)
  function graceOn() { return lget(K_GRACE) === "2h"; }
  function withinGrace() {
    if (!graceOn()) return false;
    var t = Number(lget(K_LASTUNLOCK) || 0);
    return t > 0 && (Date.now() - t) < GRACE_MS;
  }

  function method() { return lget(K_METHOD) || "none"; }
  function configured() { return !!lget(K_METHOD); }
  function institutional() { return lget(K_INSTITUTIONAL) === "1"; }

  // ---- PIN hashing — Web Crypto (native platform primitive, no library) ----
  function hex(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
  function sha256Hex(str) { try { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(hex); } catch (e) { return Promise.reject(e); } }
  function randomSalt() { try { var a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); } catch (e) { return String(Date.now()) + Math.random(); } }

  function setPin(pin) {
    var salt = randomSalt();
    return sha256Hex(salt + ":" + pin).then(function (hash) {
      var rec = salt + ":" + hash;
      lset(K_PIN, rec); // readable fallback; native also mirrors to Keychain when present
      lset(K_METHOD, "pin");
      return (SEC && SEC.available()) ? SEC.set(K_PIN, rec).catch(function () {}) : null;
    });
  }
  function readPinRecord() {
    if (SEC && SEC.available()) return SEC.get(K_PIN).then(function (v) { return v || lget(K_PIN); });
    return Promise.resolve(lget(K_PIN));
  }
  function verifyPin(pin) {
    return readPinRecord().then(function (rec) {
      if (!rec) return false;
      var i = rec.indexOf(":"); if (i < 0) return false;
      var salt = rec.slice(0, i), hash = rec.slice(i + 1);
      return sha256Hex(salt + ":" + pin).then(function (h) { return h === hash; });
    }).catch(function () { return false; });
  }

  // ---- biometric — @aparajita/capacitor-biometric-auth, registered as "BiometricAuthNative"
  // (its JS export name "BiometricAuth" is just a local alias for that proxy — the string
  // Capacitor.Plugins is keyed on is the one passed to registerPlugin(), not the export name). ----
  function bioPlugin() {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      return (P && P.BiometricAuthNative) || null;
    } catch (e) { return null; }
  }
  // isPluginAvailable() only proves the plugin is compiled into THIS build; it says nothing
  // about whether the device actually has biometry enrolled, so it's a cheap pre-check only —
  // canBiometric() below (checkBiometry().isAvailable) is the real, async, per-device answer.
  function bioCompiled() {
    try { return !!(window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable("BiometricAuthNative")); }
    catch (e) { return false; }
  }
  var _bioType = 0; // checkBiometry().biometryType: 1 = Touch ID, 2 = Face ID (plugin enum)
  function bioName() { return _bioType === 2 ? "Face ID" : _bioType === 1 ? "Touch ID" : "Face ID / Touch ID"; }
  function canBiometric() {
    var p = bioPlugin();
    if (!bioCompiled() || !p || !p.checkBiometry) return Promise.resolve(false);
    return Promise.resolve(p.checkBiometry()).then(function (r) { _bioType = (r && r.biometryType) || 0; return !!(r && r.isAvailable); }).catch(function () { return false; });
  }
  // The raw native proxy exposes exactly the plugin's pluginMethods: checkBiometry and
  // internalAuthenticate. The public authenticate() lives only in the plugin's ESM JS layer,
  // which this buildless app never loads - calling it on the proxy rejects "not implemented"
  // before LAContext is ever touched (no Face ID prompt, no permission dialog).
  // Resolves {ok:true} or {ok:false, code, text}; native rejects with a CapacitorException
  // whose .code is an LAError name (userCancel, biometryLockout, authenticationFailed, ...).
  var BIO_FAIL = {
    userCancel: "Cancelled.",
    appCancel: "Cancelled.",
    systemCancel: "Interrupted. Try again.",
    authenticationFailed: "Face ID / Touch ID did not match. Try again.",
    biometryLockout: "Face ID / Touch ID is locked. Unlock your phone with its passcode, then try again.",
    biometryNotEnrolled: "Face ID / Touch ID is not set up on this device.",
    biometryNotAvailable: "Face ID / Touch ID is not available on this device.",
    passcodeNotSet: "Set a device passcode first.",
    UNIMPLEMENTED: "Biometric support is missing from this build."
  };
  function verifyBiometric(reason) {
    var p = bioPlugin();
    var fail = function (e) {
      var code = (e && e.code) || "";
      return { ok: false, code: code, text: BIO_FAIL[code] || (e && e.message) || "Could not confirm. Try again." };
    };
    if (!p) return Promise.resolve(fail({ code: "UNIMPLEMENTED" }));
    try {
      return Promise.resolve(p.internalAuthenticate({ reason: reason || "Unlock StewardMD", cancelTitle: "Cancel" }))
        .then(function () { return { ok: true }; }, fail);
    } catch (e) { return Promise.resolve(fail(e)); }
  }

  // ---- attempt lockout (throttling, not a security boundary — the PIN hash is the boundary) --
  function fails() { return parseInt(lget(K_FAILS) || "0", 10) || 0; }
  function recordFail() { var n = fails() + 1; lset(K_FAILS, String(n)); if (n % 5 === 0) lset(K_BLOCK, String(Date.now() + Math.min(30, Math.pow(2, (n / 5) - 1)) * 60000)); return n; }
  function clearFails() { lset(K_FAILS, "0"); lset(K_BLOCK, "0"); }
  function blockedMs() { var t = parseInt(lget(K_BLOCK) || "0", 10) || 0; var left = t - Date.now(); return left > 0 ? left : 0; }

  function signOutInstead() {
    try { localStorage.removeItem(K_LASTUNLOCK); } catch (e) {}
    try { var b = document.getElementById("sessionSignOut"); if (b) { b.click(); return; } } catch (e) {}
    try { localStorage.removeItem("stewardmd_account"); } catch (e) {}
    location.reload();
  }

  // ---- shared overlay shell ----
  var _cssInjected = false;
  function injectCSS() {
    if (_cssInjected) return; _cssInjected = true;
    var css = "" +
      "#smdApplock{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(13,27,38,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:var(--sans,-apple-system,system-ui,sans-serif);animation:smdalScrim .25s ease both}" +
      "#smdApplock .smdal-card{width:100%;max-width:360px;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:20px;padding:28px 24px 24px;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center;animation:smdalPop .32s cubic-bezier(.2,.8,.2,1) both}" +
      "#smdApplock .smdal-h{font-size:19px;font-weight:800;letter-spacing:-.01em;margin-bottom:6px}" +
      "#smdApplock .smdal-sub{font-size:13.5px;line-height:1.4;color:var(--slate,#5a7184);margin-bottom:18px}" +
      "#smdApplock .smdal-opts{display:flex;flex-direction:column;gap:10px}" +
      "#smdApplock .smdal-opt{display:flex;align-items:center;gap:12px;text-align:left;width:100%;padding:13px 14px;border:1.5px solid var(--line,#d7dee3);border-radius:14px;background:var(--paper,#f6f7f5);cursor:pointer;font:inherit;color:inherit;animation:smdalRise .3s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 60ms);transition:transform .15s ease,border-color .15s ease}" +
      "#smdApplock .smdal-opt:active{transform:scale(.98)}" +
      "#smdApplock .smdal-opt:hover{border-color:var(--teal,#0e6e63)}" +
      "#smdApplock .smdal-opt-ico{width:22px;height:22px;flex:0 0 auto;stroke:var(--teal,#0e6e63);stroke-width:1.75;fill:none;stroke-linecap:round;stroke-linejoin:round}" +
      "#smdApplock .smdal-opt[data-m=\"none\"] .smdal-opt-ico{stroke:var(--amber,#92620a)}" +
      "#smdApplock .smdal-opt.smdal-cur{border-color:var(--teal,#0e6e63);background:var(--panel,#fff)}" +
      "#smdApplock .smdal-tag{margin-left:auto;flex:0 0 auto;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--teal,#0e6e63)}" +
      "#smdApplock .smdal-opt-t{display:block;font-weight:700;font-size:14.5px}" +
      "#smdApplock .smdal-opt-d{display:block;font-size:12px;color:var(--slate,#5a7184);margin-top:2px}" +
      "#smdApplock .smdal-pin-in{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:.5em;text-align:center;padding:14px 10px 14px 20px;border:1.5px solid var(--line,#d7dee3);border-radius:12px;margin:6px 0 14px;background:var(--panel,#fff);color:var(--ink,#14202b)}" +
      "#smdApplock .smdal-go{width:100%;min-height:48px;border:none;border-radius:999px;font:700 15px var(--sans,inherit);color:#fff;background:var(--teal,#0e6e63);cursor:pointer;margin-top:4px;transition:transform .12s ease}" +
      "#smdApplock .smdal-go:active{transform:scale(.97)}" +
      "#smdApplock .smdal-go:disabled{opacity:.55;cursor:default}" +
      "#smdApplock .smdal-ghost{display:block;width:100%;margin-top:12px;background:none;border:none;font:600 13px var(--sans,inherit);color:var(--slate,#5a7184);cursor:pointer;padding:6px}" +
      "#smdApplock .smdal-err{min-height:18px;font-size:12.5px;color:var(--red,#ab1c2c);margin-top:2px}" +
      "#smdApplock .smdal-err:not(:empty){animation:smdalShake .32s ease}" +
      "#smdApplock .smdal-chk{display:flex;align-items:flex-start;gap:8px;text-align:left;font-size:12.5px;color:var(--slate,#5a7184);margin:14px 0 4px}" +
      "#smdApplock .smdal-chk input{margin-top:2px}" +
      "@keyframes smdalScrim{from{opacity:0}to{opacity:1}}" +
      "@keyframes smdalPop{from{opacity:0;transform:scale(.94) translateY(6px)}to{opacity:1;transform:none}}" +
      "@keyframes smdalRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}" +
      "@keyframes smdalShake{15%,45%{transform:translateX(-4px)}30%,60%{transform:translateX(4px)}100%{transform:none}}" +
      "@media (prefers-reduced-motion:reduce){#smdApplock,#smdApplock .smdal-card,#smdApplock .smdal-opt,#smdApplock .smdal-err:not(:empty){animation:none}}" +
      "body.dark #smdApplock .smdal-card{background:var(--panel,#132030)}";
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  }
  function overlay() {
    injectCSS();
    var el = document.getElementById("smdApplock");
    if (!el) { el = document.createElement("div"); el.id = "smdApplock"; document.body.appendChild(el); }
    return el;
  }
  function closeOverlay() { var el = document.getElementById("smdApplock"); if (el && el.parentNode) el.parentNode.removeChild(el); }

  // ============================================================================================
  // SETUP — offered once, right after the first-run profile step.
  // ============================================================================================
  function promptSetup(opts) {
    try {
      if (configured()) return;
      opts = opts || {};
      lset(K_INSTITUTIONAL, opts.hospital && String(opts.hospital).trim() ? "1" : "0");
      _fromManage = false; renderChooser();
    } catch (e) {}
  }

  // Same shared line-icon catalog every other sheet in the app draws from (window.ICONS,
  // home.js) — no emoji in security UI. Falls back to nothing if home.js hasn't loaded yet
  // (load-order safety, same guard the catalog's own doc comment asks callers to use); the
  // option still reads fine from its label/description alone.
  function ico(name) { try { return (window.ICONS && window.ICONS.get) ? window.ICONS.get(name, "smdal-opt-ico") : ""; } catch (e) { return ""; } }

  function renderChooser() {
    var isInstitutional = institutional();
    var el = overlay();
    el.innerHTML = '<div class="smdal-card"><div class="smdal-h">Lock StewardMD</div><div class="smdal-sub">Checking this device…</div></div>'; // brief — canBiometric() is one native round-trip
    canBiometric().then(function (bioAvailable) {
      var i = 0, cur = method();
      function opt(m, icon, t, d) {
        return '<button class="smdal-opt' + (cur === m ? " smdal-cur" : "") + '" data-m="' + m + '" style="--i:' + (i++) + '">' + ico(icon) +
          '<span><span class="smdal-opt-t">' + t + '</span><span class="smdal-opt-d">' + d + '</span></span>' +
          (cur === m ? '<span class="smdal-tag">Current</span>' : "") + '</button>';
      }
      var rows = opt("pin", "keypad", "Set a PIN", "A 4–6 digit code, works on any device");
      if (bioAvailable) rows += opt("biometric", "fingerprint", "Face ID / Touch ID", "Fastest, no code to remember");
      if (!isInstitutional) rows += opt("none", "warn", "No lock, open automatically", "Anyone with this phone opens your patient data. Personal devices only.");
      el.innerHTML =
        '<div class="smdal-card">' +
          '<div class="smdal-h">Lock StewardMD</div>' +
          '<div class="smdal-sub">Choose how to open the app on this device.' + (isInstitutional ? " Your profile has a hospital on file, so a PIN or Face ID/Touch ID is required." : " You can change this later from Account.") + '</div>' +
          '<div class="smdal-opts">' + rows + '</div>' +
          // grace is the same own-risk class as "no lock": personal devices only, off by default
          (isInstitutional ? "" : '<label class="smdal-chk"><input type="checkbox" id="salGrace"' + (graceOn() ? " checked" : "") + '><span>Don\'t ask again if I reopen the app within 2 hours</span></label>') +
          (_fromManage ? '<button class="smdal-ghost" id="salKeep">' + (configured() ? "Keep current setting" : "Not now") + '</button>' : "") +
        '</div>';
      var g = el.querySelector("#salGrace");
      if (g) g.onchange = function () { lset(K_GRACE, g.checked ? "2h" : "0"); };
      var keep = el.querySelector("#salKeep");
      if (keep) keep.onclick = closeOverlay;
      el.onclick = function (e) {
        var b = e.target.closest && e.target.closest("[data-m]"); if (!b) return;
        var m = b.getAttribute("data-m");
        if (m === "pin") return renderPinSetup();
        if (m === "biometric") return renderBiometricSetup();
        if (m === "none") return renderNoLockConfirm();
      };
    });
  }

  function renderPinSetup(stage, firstPin) {
    stage = stage || "enter";
    var el = overlay();
    el.innerHTML =
      '<div class="smdal-card">' +
        '<div class="smdal-h">' + (stage === "confirm" ? "Confirm your PIN" : "Choose a PIN") + '</div>' +
        '<div class="smdal-sub">' + (stage === "confirm" ? "Enter it once more." : "4–6 digits. You’ll use this to open StewardMD.") + '</div>' +
        '<input class="smdal-pin-in" id="salSetupPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" placeholder="••••">' +
        '<div class="smdal-err" id="salSetupErr"></div>' +
        '<button class="smdal-go" id="salSetupGo">' + (stage === "confirm" ? "Confirm" : "Continue") + '</button>' +
        '<button class="smdal-ghost" data-back="1">Back</button>' +
      '</div>';
    var input = el.querySelector("#salSetupPin"); setTimeout(function () { input.focus(); }, 30);
    var errEl = el.querySelector("#salSetupErr");
    el.querySelector("#salSetupGo").onclick = function () {
      var v = input.value.trim();
      if (!/^\d{4,6}$/.test(v)) { errEl.textContent = "Enter 4–6 digits."; return; }
      if (stage === "enter") { renderPinSetup("confirm", v); return; }
      if (v !== firstPin) { errEl.textContent = "Didn't match. Try again."; renderPinSetup("enter"); return; }
      setPin(v).then(function () { markUnlocked(); closeOverlay(); try { if (window.toast) window.toast("PIN set"); } catch (e) {} });
    };
    el.querySelector("[data-back]").onclick = function () { renderChooser(); };
  }

  function renderBiometricSetup() {
    var el = overlay();
    el.innerHTML = '<div class="smdal-card"><div class="smdal-h">Confirm Face ID / Touch ID</div><div class="smdal-sub">Use your device biometric to finish setup.</div><div class="smdal-err" id="salBiomErr"></div><button class="smdal-go" id="salBiomRetry" hidden>Try again</button><button class="smdal-ghost" data-back="1">Back</button></div>';
    el.querySelector("[data-back]").onclick = function () { renderChooser(); };
    function attempt() {
      var retryBtn = el.querySelector("#salBiomRetry"); if (retryBtn) retryBtn.hidden = true;
      var e2 = el.querySelector("#salBiomErr"); if (e2) e2.textContent = "";
      verifyBiometric("Set up biometric unlock for StewardMD").then(function (r) {
        if (r.ok) { lset(K_METHOD, "biometric"); markUnlocked(); closeOverlay(); try { if (window.toast) window.toast("Face ID / Touch ID enabled"); } catch (e) {} return; }
        // a single failed scan (blink, angle, cancel) is normal — a dead end here reads as
        // "broken" rather than "try again", so a single failure gets a real retry button.
        if (e2) e2.textContent = r.text + " Try again, or pick a different option.";
        if (retryBtn) retryBtn.hidden = false;
      });
    }
    el.querySelector("#salBiomRetry").onclick = attempt;
    attempt();
  }

  function renderNoLockConfirm() {
    var el = overlay();
    el.innerHTML =
      '<div class="smdal-card">' +
        '<div class="smdal-h">No lock, own risk</div>' +
        '<div class="smdal-sub">StewardMD will open automatically with no PIN or biometric on this device, including your patients’ data.</div>' +
        '<label class="smdal-chk"><input type="checkbox" id="salRiskChk"><span>I understand this device will open my account without a PIN or Face ID / Touch ID.</span></label>' +
        '<button class="smdal-go" id="salRiskGo" disabled>Confirm</button>' +
        '<button class="smdal-ghost" data-back="1">Back</button>' +
      '</div>';
    var chk = el.querySelector("#salRiskChk"), go = el.querySelector("#salRiskGo");
    chk.onchange = function () { go.disabled = !chk.checked; };
    go.onclick = function () { lset(K_METHOD, "none"); closeOverlay(); };
    el.querySelector("[data-back]").onclick = function () { renderChooser(); };
  }

  // ============================================================================================
  // UNLOCK — called by the boot splash before it reveals the app. done() must be called to let
  // boot proceed; never call it without a real pass, and never withhold it forever (every screen
  // offers "Sign out" as a way out, matching this codebase's own fail-open boot-splash rule).
  // ============================================================================================
  var _unlockedThisBoot = false;
  // flagOn() gates the AUTOMATIC first-run prompt (promptSetup()) and the Settings row's default
  // visibility — not enforcement. Once a method is actually configured (first-run or Manage),
  // it is enforced regardless of the flag: a clinician who explicitly set a PIN would rightly
  // consider it a bug if disabling the rollout flag silently stopped locking their own app.
  function required() {
    try { return (method() === "pin" || method() === "biometric") && !_unlockedThisBoot && !withinGrace(); }
    catch (e) { return false; }
  }
  function markUnlocked() { _unlockedThisBoot = true; lset(K_LASTUNLOCK, String(Date.now())); }

  // unlock() is shown the moment this script loads (see the boot block at the bottom) so the
  // Face ID sheet / PIN pad is up while the app is still loading; the splash's finish() then
  // calls unlock(reallyFinish) and simply joins the screen already on show. Every done() queued
  // by any caller fires once, on the one real pass.
  var _dones = [], _unlockShowing = false;
  function finishUnlock() {
    markUnlocked(); closeOverlay(); _unlockShowing = false;
    var d = _dones.splice(0); for (var i = 0; i < d.length; i++) { try { d[i](); } catch (e) {} }
  }
  function unlock(done) {
    if (typeof done === "function") _dones.push(done);
    if (_unlockShowing) return;
    _unlockShowing = true;
    try {
      if (method() === "biometric") return renderBiometricUnlock();
      return renderPinUnlock();
    } catch (e) { finishUnlock(); } // fail-open: never strand a clinician on a bug here
  }

  function renderPinUnlock() {
    var left = blockedMs();
    var el = overlay();
    el.innerHTML =
      '<div class="smdal-card">' +
        '<div class="smdal-h">Enter your PIN</div>' +
        '<input class="smdal-pin-in" id="salUnlockPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" placeholder="••••"' + (left ? " disabled" : "") + '>' +
        '<div class="smdal-err" id="salUnlockErr">' + (left ? ("Too many attempts. Try again in " + Math.ceil(left / 60000) + " min.") : "") + '</div>' +
        '<button class="smdal-go" id="salUnlockGo"' + (left ? " disabled" : "") + '>Unlock</button>' +
        '<button class="smdal-ghost" id="salUnlockSignout">Not you? Sign out</button>' +
      '</div>';
    var input = el.querySelector("#salUnlockPin"); if (!left) setTimeout(function () { input.focus(); }, 30);
    var errEl = el.querySelector("#salUnlockErr");
    function attempt() {
      var v = input.value.trim();
      if (!v) return;
      verifyPin(v).then(function (ok) {
        if (ok) { clearFails(); finishUnlock(); return; }
        var n = recordFail();
        if (blockedMs()) { renderPinUnlock(); return; }
        errEl.textContent = "Incorrect PIN" + (n >= 3 ? " (" + n + " attempts)" : "") + ".";
        input.value = ""; input.focus();
      });
    }
    el.querySelector("#salUnlockGo").onclick = attempt;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") attempt(); });
    el.querySelector("#salUnlockSignout").onclick = signOutInstead;
  }

  // Biometric shows NO card of its own: the system Face ID / Touch ID sheet, over the boot
  // splash, is the whole UI. A card appears only after a failed or cancelled scan.
  function renderBiometricUnlock() {
    closeOverlay();
    verifyBiometric("Unlock StewardMD").then(function (r) {
      if (r.ok) { finishUnlock(); return; }
      canBiometric().then(function () { renderBiometricRetry(r.text); });
    });
  }
  function renderBiometricRetry(text) {
    var el = overlay();
    el.innerHTML = '<div class="smdal-card"><div class="smdal-h">Unlock StewardMD</div><div class="smdal-err" id="salBUErr">' + text + '</div><button class="smdal-go" id="salBURetry">Try ' + bioName() + ' again</button><button class="smdal-ghost" id="salBUSignout">Sign out instead</button></div>';
    el.querySelector("#salBURetry").onclick = renderBiometricUnlock;
    el.querySelector("#salBUSignout").onclick = signOutInstead;
  }

  // manage(hospital) — reachable from Account/More at any time (unlike promptSetup(), which only
  // fires once from first-run and no-ops if a method is already configured). Same chooser, same 3
  // options; re-openable to change or turn off an existing method. Pass the CURRENT profile
  // hospital so the institutional gate reflects reality even if the account predates App Lock
  // (K_INSTITUTIONAL was never set at signup) or the hospital changed since.
  function manage(hospital) {
    try {
      if (hospital !== undefined) lset(K_INSTITUTIONAL, hospital && String(hospital).trim() ? "1" : "0");
      _fromManage = true;
      renderChooser();
    } catch (e) {}
  }

  // ---- boot: opened within the grace window -> refresh it and stay quiet. Otherwise nothing
  // happens here: the splash holds its constant 3s frame, then its finish() -> unlock() fires
  // Face ID / Touch ID by itself (no card) or puts up the PIN pad. Splash, verify, app.
  try { if (withinGrace()) markUnlocked(); } catch (e) {}

  // ---- FORCE: anyone signed in with no method chosen is put in front of the chooser, whatever
  // provider signed them in, at boot and on every later sign-in (SMD_ACCOUNT.onChange). Waits
  // until the app actually owns the screen (no sign-in / intro / verify gate, no boot splash, no
  // first-run profile form, which hands over via promptSetup() itself), then insists: the
  // first-run chooser has no close. Institutional rule uses the profile's hospital.
  var _ensuring = false;
  function screenBusy() {
    try {
      var EA = window.SMD_EMAIL_AUTH || {};
      if (EA.gateUp && EA.gateUp()) return true;
      if (EA.flowOpen && EA.flowOpen()) return true;
      return !!document.getElementById("smdBootSplash");
    } catch (e) { return false; }
  }
  function ensureSetup() {
    if (_ensuring) return;
    _ensuring = true;
    var tries = 0;
    (function tick() {
      try {
        if (configured() || document.getElementById("smdApplock")) { _ensuring = false; return; }
        var p = window.SMD_ACCOUNT && window.SMD_ACCOUNT.profile && window.SMD_ACCOUNT.profile();
        if (!p || !p.signedIn || p.isGuest) { _ensuring = false; return; }
        if (screenBusy()) { if (++tries < 240) setTimeout(tick, 500); else _ensuring = false; return; }
      } catch (e) { _ensuring = false; return; }
      _ensuring = false;
      var EA = window.SMD_EMAIL_AUTH, uid = null;
      try { uid = window.SMD_ACCOUNT.uid && window.SMD_ACCOUNT.uid(); } catch (e) {}
      var hosp = (EA && EA.loadProfile && uid)
        ? EA.loadProfile(uid).then(function (d) { return (d && d.hospital) || ""; }).catch(function () { return ""; })
        : Promise.resolve("");
      hosp.then(function (h) { if (!configured() && !document.getElementById("smdApplock")) promptSetup({ hospital: h }); });
    })();
  }
  try { if (window.SMD_ACCOUNT && window.SMD_ACCOUNT.onChange) window.SMD_ACCOUNT.onChange(function () { ensureSetup(); }); } catch (e) {}

  window.SMD_APPLOCK = {
    isOn: flagOn,
    configured: configured,
    method: method,
    canBiometric: canBiometric,
    required: required,
    unlock: unlock,
    promptSetup: promptSetup,
    manage: manage,
    grace: graceOn,
  };
})();
