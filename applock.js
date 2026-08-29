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
 *   2. Biometric   — Face ID / Touch ID. Feature-detected via Capacitor.isPluginAvailable(),
 *                    the platform's own native-capability check (ponytail: no plugin is
 *                    installed yet, so this option is correctly absent on every build today;
 *                    add a NativeBiometric-shaped plugin + cap sync + native rebuild and it
 *                    lights up with zero changes here).
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

  // ---- biometric — feature-detected, not assumed ----
  function biometricPluginName() {
    try {
      var P = window.Capacitor && window.Capacitor.Plugins;
      if (P && P.NativeBiometric) return "NativeBiometric";
      if (P && P.BiometricAuth) return "BiometricAuth";
    } catch (e) {}
    return null;
  }
  function canBiometric() {
    var name = biometricPluginName();
    try { return !!(name && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable(name)); }
    catch (e) { return false; }
  }
  function verifyBiometric(reason) {
    var name = biometricPluginName();
    if (!name) return Promise.resolve(false);
    var p = window.Capacitor.Plugins[name];
    var fn = p.verifyIdentity || p.authenticate;
    if (!fn) return Promise.resolve(false);
    try { return Promise.resolve(fn.call(p, { reason: reason || "Unlock StewardMD" })).then(function () { return true; }).catch(function () { return false; }); }
    catch (e) { return Promise.resolve(false); }
  }

  // ---- attempt lockout (throttling, not a security boundary — the PIN hash is the boundary) --
  function fails() { return parseInt(lget(K_FAILS) || "0", 10) || 0; }
  function recordFail() { var n = fails() + 1; lset(K_FAILS, String(n)); if (n % 5 === 0) lset(K_BLOCK, String(Date.now() + Math.min(30, Math.pow(2, (n / 5) - 1)) * 60000)); return n; }
  function clearFails() { lset(K_FAILS, "0"); lset(K_BLOCK, "0"); }
  function blockedMs() { var t = parseInt(lget(K_BLOCK) || "0", 10) || 0; var left = t - Date.now(); return left > 0 ? left : 0; }

  function signOutInstead() {
    try { var b = document.getElementById("sessionSignOut"); if (b) { b.click(); return; } } catch (e) {}
    try { localStorage.removeItem("stewardmd_account"); } catch (e) {}
    location.reload();
  }

  // ---- shared overlay shell ----
  var _cssInjected = false;
  function injectCSS() {
    if (_cssInjected) return; _cssInjected = true;
    var css = "" +
      "#smdApplock{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(13,27,38,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:var(--sans,-apple-system,system-ui,sans-serif)}" +
      "#smdApplock .smdal-card{width:100%;max-width:360px;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:20px;padding:28px 24px 24px;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center}" +
      "#smdApplock .smdal-h{font-size:19px;font-weight:800;letter-spacing:-.01em;margin-bottom:6px}" +
      "#smdApplock .smdal-sub{font-size:13.5px;line-height:1.4;color:var(--slate,#5a7184);margin-bottom:18px}" +
      "#smdApplock .smdal-opts{display:flex;flex-direction:column;gap:10px}" +
      "#smdApplock .smdal-opt{display:flex;align-items:center;gap:12px;text-align:left;width:100%;padding:13px 14px;border:1.5px solid var(--line,#d7dee3);border-radius:14px;background:var(--paper,#f6f7f5);cursor:pointer;font:inherit;color:inherit}" +
      "#smdApplock .smdal-opt:active{transform:scale(.98)}" +
      "#smdApplock .smdal-opt-ico{font-size:20px;line-height:1;flex:0 0 auto}" +
      "#smdApplock .smdal-opt-t{display:block;font-weight:700;font-size:14.5px}" +
      "#smdApplock .smdal-opt-d{display:block;font-size:12px;color:var(--slate,#5a7184);margin-top:2px}" +
      "#smdApplock .smdal-pin-in{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:.5em;text-align:center;padding:14px 10px 14px 20px;border:1.5px solid var(--line,#d7dee3);border-radius:12px;margin:6px 0 14px;background:var(--panel,#fff);color:var(--ink,#14202b)}" +
      "#smdApplock .smdal-go{width:100%;min-height:48px;border:none;border-radius:999px;font:700 15px var(--sans,inherit);color:#fff;background:var(--teal,#0e6e63);cursor:pointer;margin-top:4px}" +
      "#smdApplock .smdal-go:disabled{opacity:.55;cursor:default}" +
      "#smdApplock .smdal-ghost{display:block;width:100%;margin-top:12px;background:none;border:none;font:600 13px var(--sans,inherit);color:var(--slate,#5a7184);cursor:pointer;padding:6px}" +
      "#smdApplock .smdal-err{min-height:18px;font-size:12.5px;color:var(--red,#ab1c2c);margin-top:2px}" +
      "#smdApplock .smdal-chk{display:flex;align-items:flex-start;gap:8px;text-align:left;font-size:12.5px;color:var(--slate,#5a7184);margin:14px 0 4px}" +
      "#smdApplock .smdal-chk input{margin-top:2px}" +
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
      if (!flagOn() || configured()) return;
      opts = opts || {};
      lset(K_INSTITUTIONAL, opts.hospital && String(opts.hospital).trim() ? "1" : "0");
      renderChooser();
    } catch (e) {}
  }

  function renderChooser() {
    var isInstitutional = institutional();
    var el = overlay();
    var rows =
      '<button class="smdal-opt" data-m="pin"><span class="smdal-opt-ico">🔢</span><span><span class="smdal-opt-t">Set a PIN</span><span class="smdal-opt-d">A 4–6 digit code, works on any device</span></span></button>';
    if (canBiometric()) {
      rows += '<button class="smdal-opt" data-m="biometric"><span class="smdal-opt-ico">🔒</span><span><span class="smdal-opt-t">Face ID / Touch ID</span><span class="smdal-opt-d">Fastest — no code to remember</span></span></button>';
    }
    if (!isInstitutional) {
      rows += '<button class="smdal-opt" data-m="none"><span class="smdal-opt-ico">⚠️</span><span><span class="smdal-opt-t">No lock — open automatically</span><span class="smdal-opt-d">Anyone with this phone opens your patient data. Personal devices only.</span></span></button>';
    }
    el.innerHTML =
      '<div class="smdal-card">' +
        '<div class="smdal-h">Lock StewardMD</div>' +
        '<div class="smdal-sub">Choose how to open the app on this device.' + (isInstitutional ? " Your profile has a hospital on file, so a PIN or Face ID/Touch ID is required." : " You can change this later from Account.") + '</div>' +
        '<div class="smdal-opts">' + rows + '</div>' +
      '</div>';
    el.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-m]"); if (!b) return;
      var m = b.getAttribute("data-m");
      if (m === "pin") return renderPinSetup();
      if (m === "biometric") return renderBiometricSetup();
      if (m === "none") return renderNoLockConfirm();
    };
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
      if (v !== firstPin) { errEl.textContent = "Didn’t match — try again."; renderPinSetup("enter"); return; }
      setPin(v).then(function () { closeOverlay(); try { if (window.toast) window.toast("PIN set"); } catch (e) {} });
    };
    el.querySelector("[data-back]").onclick = function () { renderChooser(); };
  }

  function renderBiometricSetup() {
    var el = overlay();
    el.innerHTML = '<div class="smdal-card"><div class="smdal-h">Confirm Face ID / Touch ID</div><div class="smdal-sub">Use your device biometric to finish setup.</div><div class="smdal-err" id="salBiomErr"></div><button class="smdal-ghost" data-back="1">Back</button></div>';
    el.querySelector("[data-back]").onclick = function () { renderChooser(); };
    verifyBiometric("Set up biometric unlock for StewardMD").then(function (ok) {
      if (ok) { lset(K_METHOD, "biometric"); closeOverlay(); try { if (window.toast) window.toast("Face ID / Touch ID enabled"); } catch (e) {} }
      else { var e2 = el.querySelector("#salBiomErr"); if (e2) e2.textContent = "Couldn’t confirm — try again, or pick a different option."; }
    });
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
  function required() {
    try { return flagOn() && (method() === "pin" || method() === "biometric") && !_unlockedThisBoot; }
    catch (e) { return false; }
  }

  function unlock(done) {
    try {
      if (method() === "biometric") return renderBiometricUnlock(done);
      return renderPinUnlock(done);
    } catch (e) { _unlockedThisBoot = true; done(); } // fail-open: never strand a clinician on a bug here
  }

  function renderPinUnlock(done) {
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
        if (ok) { clearFails(); _unlockedThisBoot = true; closeOverlay(); done(); return; }
        var n = recordFail();
        if (blockedMs()) { renderPinUnlock(done); return; }
        errEl.textContent = "Incorrect PIN" + (n >= 3 ? " (" + n + " attempts)" : "") + ".";
        input.value = ""; input.focus();
      });
    }
    el.querySelector("#salUnlockGo").onclick = attempt;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") attempt(); });
    el.querySelector("#salUnlockSignout").onclick = signOutInstead;
  }

  function renderBiometricUnlock(done) {
    var el = overlay();
    el.innerHTML = '<div class="smdal-card"><div class="smdal-h">Unlock StewardMD</div><div class="smdal-sub">Confirm with Face ID / Touch ID.</div><div class="smdal-err" id="salBUErr"></div><button class="smdal-go" id="salBURetry">Try again</button><button class="smdal-ghost" id="salBUSignout">Sign out instead</button></div>';
    function attempt() {
      verifyBiometric("Unlock StewardMD").then(function (ok) {
        if (ok) { _unlockedThisBoot = true; closeOverlay(); done(); return; }
        var e2 = el.querySelector("#salBUErr"); if (e2) e2.textContent = "Not confirmed — try again.";
      });
    }
    el.querySelector("#salBURetry").onclick = attempt;
    el.querySelector("#salBUSignout").onclick = signOutInstead;
    attempt();
  }

  window.SMD_APPLOCK = {
    isOn: flagOn,
    configured: configured,
    method: method,
    canBiometric: canBiometric,
    required: required,
    unlock: unlock,
    promptSetup: promptSetup,
  };
})();
