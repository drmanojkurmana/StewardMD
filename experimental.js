/* StewardMD — Experimental Access client framework (window.SMD_XACCESS).
 *
 * The client half of the one-code / one-device beta unlock system. It NEVER validates anything
 * itself — every decision is made by /api/experimental/* on the server. Locally it keeps ONLY a
 * signed activation token (never the code); on startup / on each open it re-verifies with the
 * server so a remote revocation disables the feature immediately (offline → trust the cached
 * token and re-check when back online).
 *
 * Feature-agnostic + reusable: FundX AI is the first consumer; ECG AI / Ultrasound AI / Clinical
 * Copilot work the same way once a FEATURES entry exists on the server. A consumer wires it in one
 * call:  SMD_XACCESS.gate("fundx", openFundx)  — open if authorised, else show the access gate.
 *
 * Public API:
 *   gate(feature, onUnlock)      open the feature if authorised (or dev bypass), else the gate UI
 *   openGate(feature, onUnlock)  force the gate UI (Settings entry point)
 *   ensure(feature) -> Promise   {active} — startup/authoritative check (verify or restore)
 *   activate(feature, code)      -> Promise {ok,message}
 *   isActiveCached(feature)      sync best-effort from the local cache (fast tile gate)
 *   clear(feature)               drop the local token (sign-out)
 *   devBypass()                  true on a debug build / dev opt-in
 */
(function () {
  "use strict";
  var BASE = "/api/experimental";
  var TITLES = { fundx: "FundX AI", kardiox: "KardioX AI", thorex: "ThoreX AI", sknx: "SknX AI" };
  var listeners = [];

  function C() { try { return window.Capacitor; } catch (e) { return null; } }
  function toast(m) { try { if (window.toast) return window.toast(m); if (window.SMD_toast) return window.SMD_toast(m); } catch (e) {} }
  function signedIn() { try { var p = window.SMD_ACCOUNT && SMD_ACCOUNT.profile && SMD_ACCOUNT.profile(); return !!(p && p.signedIn); } catch (e) { return false; } }
  function idToken() { try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; }); } catch (e) {} return Promise.resolve(null); }
  function device() { var D = window.SMD_DEVICE; return D ? Promise.all([D.getId(), D.getModel(), D.getPlatform()]) : Promise.resolve(["dev-unknown", "device", "web"]); }

  // Debug-build / developer bypass (decision: Xcode/adb debug installs open FundX without a code;
  // PRODUCTION ALWAYS REQUIRES ONE). The only automatic path is a native DEBUG build setting
  // window.SMD_NATIVE.debug. The ?xadev / localStorage opt-in is honoured ONLY on a non-production,
  // non-native origin (a localhost dev server) — never on the production web app or a release native
  // build — so a curious end user can't self-unlock by visiting stewardmd.in/?xadev=1.
  function devBypass() {
    try { if (window.SMD_NATIVE && window.SMD_NATIVE.debug === true) return true; } catch (e) {}
    try {
      var Cap = C(), native = !!(Cap && (Cap.isNativePlatform ? Cap.isNativePlatform() : Cap.platform));
      var host = (typeof location !== "undefined" && location.hostname) || "";
      var prod = /stewardmd\.(in|pages\.dev)$/i.test(host);
      if (!native && !prod) {
        if (/[?&]xadev=1/.test(location.search)) { try { localStorage.setItem("smd_xa_dev", "1"); } catch (e) {} return true; }
        if (localStorage.getItem("smd_xa_dev") === "1") return true;
      }
    } catch (e) {}
    return false;
  }

  // ---- local token + cached state (localStorage; never the plaintext code) ---------------
  function tKey(f) { return "smd_xa_tok_" + f; }
  function sKey(f) { return "smd_xa_st_" + f; }
  function loadToken(f) { try { return localStorage.getItem(tKey(f)) || null; } catch (e) { return null; } }
  function saveState(f, st) { try { localStorage.setItem(sKey(f), JSON.stringify(st || {})); } catch (e) {} }
  function loadState(f) { try { return JSON.parse(localStorage.getItem(sKey(f)) || "null") || null; } catch (e) { return null; } }
  function store(f, token, st) { try { if (token) localStorage.setItem(tKey(f), token); } catch (e) {} saveState(f, st); notify(f); }
  function clear(f) { try { localStorage.removeItem(tKey(f)); localStorage.removeItem(sKey(f)); } catch (e) {} notify(f); }
  // Authorisation requires an actual signed token — a raw {active:true} cache with no token (a
  // hand-set localStorage spoof) is NOT treated as active, and the real gate is the server anyway.
  function cachedActive(f) { var s = loadState(f); return !!(loadToken(f) && s && s.active); }
  function isActiveCached(f) { return devBypass() || cachedActive(f); }
  // Sync best-effort tier reader from the cached state — no network round-trip. Defaults to
  // "v1" whenever the feature isn't active or the cached state predates tiering.
  function tierFor(f) {
    var st = loadState(f);
    return (st && st.active && st.tier) ? st.tier : "v1";
  }
  function token(f) { return loadToken(f); }
  function onChange(cb) { if (typeof cb === "function") listeners.push(cb); }
  function notify(f) { listeners.forEach(function (cb) { try { cb(f, cachedActive(f)); } catch (e) {} }); }

  function hdr(tok) { var h = { "Content-Type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok; return h; }
  function post(path, tok, body) {
    return fetch(BASE + path, { method: "POST", headers: hdr(tok), body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }, function () { return { s: r.status, d: {} }; }); });
  }

  // ---- server operations -----------------------------------------------------------------
  function activate(feature, code) {
    return Promise.all([device(), idToken()]).then(function (a) {
      var dev = a[0], tok = a[1];
      if (!tok) return { ok: false, error: "signin_required", message: "Sign in to StewardMD to activate this feature." };
      return post("/activate", tok, { feature: feature, code: String(code || "").trim(), deviceId: dev[0], deviceModel: dev[1], platform: dev[2] })
        .then(function (x) {
          var d = x.d || {};
          if (x.s === 200 && d.ok) { store(feature, d.token, { active: true, deviceModel: d.deviceModel || dev[1], activatedAt: d.activatedAt || Date.now(), tier: (d && d.tier) || "v1" }); return { ok: true, deviceModel: d.deviceModel || dev[1] }; }
          return { ok: false, error: d.error || "invalid", message: d.message || "Invalid or expired code." };
        });
    }).catch(function () { return { ok: false, error: "network", message: "Network error — please try again." }; });
  }

  // Verify the stored token against the live record. 200+active → keep; 200+inactive → CLEAR
  // (revoked/expired → lock immediately); network/5xx → trust the cache (offline grace).
  function verify(feature) {
    var tok = loadToken(feature);
    if (!tok) { if (loadState(feature)) clear(feature); return Promise.resolve({ active: false, reason: "no_token" }); }   // drop any token-less (spoofed) cached state
    return Promise.all([device(), idToken()]).then(function (a) {
      return post("/verify", a[1], { feature: feature, deviceId: a[0][0], token: tok }).then(function (x) {
        var d = x.d || {};
        if (x.s === 200) {
          if (d.active) { saveState(feature, { active: true, deviceModel: d.deviceModel, activatedAt: d.activatedAt, tier: (d && d.tier) || "v1" }); notify(feature); return { active: true }; }
          clear(feature); return { active: false, reason: d.reason || "inactive" };
        }
        return { active: cachedActive(feature), reason: "unreachable", cached: true };
      });
    }).catch(function () { return { active: cachedActive(feature), reason: "offline", cached: true }; });
  }

  // Authoritative restore for a signed-in user on THIS device (recovers the token after a reinstall
  // so the consumed code never has to be re-entered).
  function status(feature) {
    return Promise.all([device(), idToken()]).then(function (a) {
      if (!a[1]) return { active: false };
      return post("/status", a[1], { feature: feature, deviceId: a[0][0] }).then(function (x) {
        var d = x.d || {};
        if (x.s === 200 && d.active && d.token) { store(feature, d.token, { active: true, deviceModel: d.deviceModel, activatedAt: d.activatedAt, tier: (d && d.tier) || "v1" }); return { active: true }; }
        return { active: false };
      });
    }).catch(function () { return { active: false }; });
  }

  function ensure(feature) {
    if (devBypass()) return Promise.resolve({ active: true, bypass: true });
    if (loadToken(feature)) return verify(feature);
    if (signedIn()) return status(feature);
    return Promise.resolve({ active: false, reason: "locked" });
  }

  // ---- the gate UI (self-contained overlay) ----------------------------------------------
  var el = null, current = { feature: null, onUnlock: null };
  function injectCSS() {
    if (document.getElementById("xa-css")) return;
    var s = document.createElement("style"); s.id = "xa-css";
    s.textContent = [
      "#xaGate{position:fixed;inset:0;z-index:100300;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(6,12,18,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}",
      "#xaGate.on{display:flex}",
      "#xaGate .xa-card{width:100%;max-width:420px;background:var(--panel,#fff);color:var(--ink,#14202b);border:1px solid var(--line,#d7dee3);border-radius:18px;padding:22px 20px 18px;box-shadow:0 24px 60px -24px rgba(0,0,0,.5);font-family:var(--sans,system-ui)}",
      "#xaGate .xa-ic{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;background:var(--teal-soft,#e4f4f1)}",
      "#xaGate h3{margin:0 0 4px;text-align:center;font-size:19px;font-weight:800;letter-spacing:-.01em}",
      "#xaGate .xa-sub{text-align:center;font-size:13px;color:var(--slate-soft,#5a7184);line-height:1.5;margin:0 auto 16px;max-width:34ch}",
      "#xaGate input{width:100%;border:1.5px solid var(--line,#d7dee3);border-radius:12px;padding:14px;font:700 18px/1 var(--mono,ui-monospace,monospace);letter-spacing:.14em;text-align:center;text-transform:uppercase;background:var(--paper,#f6f7f5);color:var(--ink,#14202b)}",
      "#xaGate input:focus{outline:none;border-color:var(--teal,#0e6e63)}",
      "#xaGate .xa-err{color:var(--sev-critical-fg,#c0392b);font-size:12.5px;font-weight:600;text-align:center;min-height:16px;margin:8px 0 2px}",
      "#xaGate .xa-btns{display:flex;flex-direction:column;gap:9px;margin-top:14px}",
      "#xaGate button{border:none;border-radius:12px;padding:13px;font:800 15px var(--sans,system-ui);cursor:pointer}",
      "#xaGate .xa-primary{background:var(--teal,#0e6e63);color:#fff}",
      "#xaGate .xa-ghost{background:transparent;color:var(--slate-soft,#5a7184)}",
      "#xaGate .xa-badge{display:flex;align-items:center;gap:6px;justify-content:center;font-size:12px;font-weight:700;color:var(--teal,#0e6e63);margin-bottom:10px}",
      "#xaGate .xa-dev{background:var(--paper,#f6f7f5);border-radius:12px;padding:11px 13px;font-size:13px;color:var(--ink,#14202b);text-align:center;margin-bottom:4px}"
    ].join("");
    document.head.appendChild(s);
  }
  function mount() {
    if (el) return;
    injectCSS();
    el = document.createElement("div"); el.id = "xaGate"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      if (e.target === el) return close();
      var b = e.target.closest("[data-xa]"); if (!b) return;
      var a = b.getAttribute("data-xa");
      if (a === "close") return close();
      if (a === "signin") { close(); try { if (window.SB && SB.open) SB.open(); } catch (e2) {} toast("Sign in from the account menu, then reopen this feature."); return; }
      if (a === "open") { var cb = current.onUnlock; close(); if (cb) cb(); return; }
      if (a === "activate") return doActivate();
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function close() { if (el) el.classList.remove("on"); }
  function renderLocked(feature) {
    var t = TITLES[feature] || feature;
    el.innerHTML =
      '<div class="xa-card">' +
        '<div class="xa-ic">🔒</div>' +
        '<h3>' + esc(t) + '</h3>' +
        '<p class="xa-sub">This feature is available only to approved beta testers. Enter your access code to unlock it on this device.</p>' +
        '<input id="xaCodeInput" inputmode="latin" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="' + esc((feature === "fundx" ? "FUNDX" : feature === "sknx" ? "SKNX" : t.toUpperCase().slice(0, 5)) + "-XXXX-XXXX") + '">' +
        '<div class="xa-err" id="xaErr"></div>' +
        '<div class="xa-btns"><button class="xa-primary" data-xa="activate" id="xaGo">Activate</button><button class="xa-ghost xa-close" data-xa="close">Not now</button></div>' +
      '</div>';
    el.classList.add("on");
    try { setTimeout(function () { var i = document.getElementById("xaCodeInput"); if (i) i.focus(); }, 60); } catch (e) {}
  }
  function renderSignin(feature) {
    var t = TITLES[feature] || feature;
    el.innerHTML =
      '<div class="xa-card">' +
        '<div class="xa-ic">🔐</div>' +
        '<h3>Sign in required</h3>' +
        '<p class="xa-sub">Beta access for ' + esc(t) + ' is tied to your StewardMD account and this device. Sign in, then enter your access code.</p>' +
        '<div class="xa-btns"><button class="xa-primary" data-xa="signin">Sign in</button><button class="xa-ghost xa-close" data-xa="close">Not now</button></div>' +
      '</div>';
    el.classList.add("on");
  }
  function renderEnabled(feature, deviceModel) {
    var t = TITLES[feature] || feature;
    el.innerHTML =
      '<div class="xa-card">' +
        '<div class="xa-badge">🟢 ' + esc(t) + ' Beta enabled</div>' +
        '<div class="xa-ic">✅</div>' +
        '<h3>You\'re in</h3>' +
        '<p class="xa-sub">' + esc(t) + ' is unlocked on this device' + (deviceModel ? ' (' + esc(deviceModel) + ')' : '') + '.</p>' +
        '<div class="xa-btns"><button class="xa-primary" data-xa="open">Open ' + esc(t) + '</button><button class="xa-ghost xa-close" data-xa="close">Close</button></div>' +
      '</div>';
    el.classList.add("on");
  }
  function doActivate() {
    var input = document.getElementById("xaCodeInput"), err = document.getElementById("xaErr"), go = document.getElementById("xaGo");
    if (!input) return;
    var code = input.value.trim();
    if (!code) { if (err) err.textContent = "Enter your access code."; return; }
    if (go) { go.disabled = true; go.textContent = "Activating…"; } if (err) err.textContent = "";
    activate(current.feature, code).then(function (r) {
      if (r.ok) { try { if (window.SMD_HAPTICS && SMD_HAPTICS.success) SMD_HAPTICS.success(); } catch (e) {} renderEnabled(current.feature, r.deviceModel); return; }
      if (go) { go.disabled = false; go.textContent = "Activate"; }
      if (err) err.textContent = r.message || "Invalid or expired code.";
    });
  }

  function openGate(feature, onUnlock) {
    mount();
    current.feature = feature; current.onUnlock = onUnlock || null;
    if (!signedIn()) return renderSignin(feature);
    // If already active (e.g. opened from Settings), show the enabled state; else the locked entry.
    if (cachedActive(feature)) { renderEnabled(feature, (loadState(feature) || {}).deviceModel); ensure(feature).then(function (r) { if (!r.active && el && el.classList.contains("on")) renderLocked(feature); }); return; }
    renderLocked(feature);
    ensure(feature).then(function (r) { if (r.active && el && el.classList.contains("on") && current.feature === feature) renderEnabled(feature, (loadState(feature) || {}).deviceModel); });
  }

  // The one-call entry a feature uses. Opens immediately when authorised (dev bypass or a valid
  // cached token), otherwise shows the gate. Cached opens still re-verify in the background so a
  // revocation locks the feature by the next open.
  function gate(feature, onUnlock) {
    if (devBypass()) { if (onUnlock) onUnlock(); return; }
    if (cachedActive(feature)) { if (onUnlock) onUnlock(); verify(feature); return; }
    ensure(feature).then(function (r) { if (r.active) { if (onUnlock) onUnlock(); } else openGate(feature, onUnlock); });
  }

  window.SMD_XACCESS = { gate: gate, openGate: openGate, ensure: ensure, activate: activate, verify: verify, status: status, isActiveCached: isActiveCached, tierFor: tierFor, token: token, clear: clear, devBypass: devBypass, onChange: onChange };

  // Startup: if we hold a token, re-verify it (a remote revocation locks on launch); if we don't but
  // the user is signed in, try to restore it from the server (same account + same device after a
  // reinstall) so the tile reflects real access without re-entering the consumed code.
  try { if (loadToken("fundx")) verify("fundx"); else if (signedIn()) status("fundx"); } catch (e) {}
  // Sign-out clears local tokens (device+account bound); signing back in restores via status().
  try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function (p) { if (!(p && p.signedIn)) { clear("fundx"); } }); } catch (e) {}
})();
