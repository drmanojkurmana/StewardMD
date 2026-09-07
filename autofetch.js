/* StewardMD — Auto-fetch reports (device-local, opt-in). window.SMD_AUTOFETCH
 * ---------------------------------------------------------------------------
 * Per-patient toggle: when ON, the app keeps the linked GHIS patient's labs/imaging
 * fresh automatically — on app launch and on every foreground resume — and re-ingests
 * them (conflict-safe) so trends update without the doctor re-opening Ward Sync.
 *
 * PRIVACY / STORE COMPLIANCE:
 *   - The GHIS credential is stored ONLY on this device, in the OS secure store
 *     (iOS Keychain / Android Keystore via capacitor-secure-storage-plugin) — never on
 *     our servers, never in plaintext. Stored ONLY after explicit consent, deletable anytime.
 *   - This is separate from Lab Watch 24/7 (which stores server-side for background push).
 *
 * Gated behind localStorage flag `smd_autofetch`, which defaults OFF: the doctor opts in from
 * Settings, and then consents again per patient before a credential is stored.
 * Depends on: window.SMD_SECURE (native-bridge), window.GHIS (ghis-ward), window.ICU_STATE.
 */
(function () {
  "use strict";

  // Device secure storage (iOS Keychain / Android Keystore via capacitor-secure-storage-plugin,
  // registered as `SecureStoragePlugin`). Defined here to avoid touching the shared native-bridge.
  // Web fallback (localStorage, base64) is NOT secure — native only for real credential storage.
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

  var CRED_KEY = "smd_ghis_autofetch_cred";     // secure-store key for { u, p }
  var COOLDOWN_MS = 6 * 60 * 60 * 1000;           // background auto-sync: at most once per 6h per patient
  var OPEN_COOLDOWN_MS = 5 * 60 * 1000;           // opening the ICU dashboard freshens on demand, but not more than once/5min
  var _last = {};                                 // pid -> last fetch ts (in-memory)
  var _busy = false;

  // Feature AVAILABILITY (not per-patient). NATIVE-ONLY: the credential lives in the OS secure
  // store (Keychain/Keystore), which doesn't exist on the web/PWA — so the whole feature (on-bar
  // pill, lab-drawer button, auto-run) is hidden off-device by gating on window.SMD_IS_NATIVE.
  // OPT-IN, defaults OFF: the doctor turns it on in Settings, THEN consents per patient before any
  // credential is stored. Two independent gates. The consent tick is what actually authorises
  // storage, so no credential/PHI is ever stored without it regardless of this switch.
  // Fails CLOSED: if the flag cannot be read, the feature stays off rather than becoming reachable.
  function on() { try { return !!window.SMD_IS_NATIVE && localStorage.getItem("smd_autofetch") === "1"; } catch (e) { return false; } }
  function toast(m) { try { (window.SMD_toast || window.toast || function () {})(m); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ── per-patient enable state (which linked GHIS patients auto-fetch) ─────────
  function pKey(pid) { return "smd_af:" + pid; }
  function isEnabled(pid) { try { return !!pid && localStorage.getItem(pKey(pid)) === "1"; } catch (e) { return false; } }
  function setEnabled(pid, v) { try { if (v) localStorage.setItem(pKey(pid), "1"); else localStorage.removeItem(pKey(pid)); } catch (e) {} }

  function curWardPid() { try { return (window.ICU_STATE && ICU_STATE.wardSync && ICU_STATE.wardSync.patientId) || ""; } catch (e) { return ""; } }
  function haveCred() { return !!(window.SMD_SECURE && SMD_SECURE.available()); }

  // ── secure credential (device-only) ─────────────────────────────────────────
  function storeCred(u, p) { return window.SMD_SECURE.set(CRED_KEY, { u: u, p: p }); }
  function readCred() {
    if (!haveCred()) return Promise.resolve(null);
    return SMD_SECURE.get(CRED_KEY).then(function (raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } });
  }
  function forgetCred() { try { if (window.SMD_SECURE) return SMD_SECURE.remove(CRED_KEY); } catch (e) {} return Promise.resolve(); }

  // ── ensure a live GHIS session, silently re-logging in from the device cred ──
  function ensureConnected() {
    var G = window.GHIS;
    if (!G) return Promise.reject(new Error("ward-sync-unavailable"));
    if (G.isConnected && G.isConnected()) return Promise.resolve(true);
    return readCred().then(function (c) {
      if (!c || !c.u || !c.p || !G.loginWith) return false;   // no stored cred → can't auto-connect (user opens Ward Sync manually)
      return G.loginWith(c.u, c.p);
    });
  }

  // ── the actual refresh: re-fetch this patient's reports + conflict-safe ingest ─
  function refreshNow(pid, opts) {
    opts = opts || {};
    pid = pid || curWardPid();
    if (!pid || _busy) return Promise.resolve(false);
    var _cd = opts.force ? 0 : (opts.cooldown != null ? opts.cooldown : COOLDOWN_MS);
    if (_last[pid] && (Date.now() - _last[pid]) < _cd) return Promise.resolve(false);
    if (!(window.GHIS && GHIS.loadIntoICU)) return Promise.resolve(false);
    _busy = true;
    return ensureConnected().then(function (okConn) {
      if (!okConn) { _busy = false; if (opts.manual) toast("Open Ward Sync and sign in to refresh."); return false; }
      _last[pid] = Date.now();
      try { GHIS.loadIntoICU(pid, function () { _busy = false; if (opts.manual) toast("Refreshed from Ward Sync ✓"); }, { silent: true }); }
      catch (e) { _busy = false; }
      // loadIntoICU is fire-and-forget (its own async); release busy shortly in case the callback never fires
      setTimeout(function () { _busy = false; }, 8000);
      return true;
    }).catch(function () { _busy = false; return false; });
  }

  // ── auto trigger: keep the enabled patient's labs fresh, but SPARINGLY. Background refreshes
  // (launch + foreground resume) are throttled to once per 6h (COOLDOWN_MS); opening the ICU
  // dashboard freshens on demand (once per 5min). No per-resume spamming of GHIS.
  function tick() {
    if (!on()) return;
    var pid = curWardPid();
    if (pid && isEnabled(pid)) refreshNow(pid, {});   // 6h cooldown
  }
  // Fired when the ICU dashboard opens (e.g. tapping the Home ICU tile) — a natural moment for fresh labs.
  function onDashboardOpen() {
    if (!on()) return;
    var pid = curWardPid();
    if (pid && isEnabled(pid)) refreshNow(pid, { cooldown: OPEN_COOLDOWN_MS });
  }
  // Wrap ICU.open ONCE so opening the dashboard triggers onDashboardOpen (idempotent; polled since
  // icu.js may define window.ICU just after us). Mirrors home.js's SB.open wrap.
  function wrapIcuOpen() {
    try {
      if (window.ICU && typeof ICU.open === "function" && !ICU.open._afWrapped) {
        var orig = ICU.open;
        ICU.open = function () { var r = orig.apply(this, arguments); try { onDashboardOpen(); } catch (e) {} return r; };
        ICU.open._afWrapped = true;
        return true;
      }
    } catch (e) {}
    return false;
  }
  function wireResume() {
    if (!window.SMD_IS_NATIVE) return;   // native-only: never attach resume/tick listeners on web
    try {
      var C = window.Capacitor;
      if (C && C.Plugins && C.Plugins.App && C.Plugins.App.addListener) {
        C.Plugins.App.addListener("appStateChange", function (st) { if (st && st.isActive) tick(); });
      }
    } catch (e) {}
    try { document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); }); } catch (e) {}
    // Hook ICU dashboard opens (retry until icu.js has defined window.ICU).
    if (!wrapIcuOpen()) { var _n = 0, _iv = setInterval(function () { if (wrapIcuOpen() || ++_n > 40) clearInterval(_iv); }, 300); }
    // initial background pass shortly after load (6h-throttled, so usually a no-op)
    setTimeout(tick, 2500);
  }

  // ── consent + toggle sheet (self-contained DOM) ─────────────────────────────
  function openManager(pid, name) {
    pid = pid || curWardPid();
    if (!on()) { toast("Auto-fetch is turned off."); return; }
    if (!pid) { toast("Open this patient from Ward Sync first."); return; }
    if (!haveCred()) { toast("Secure storage unavailable on this device."); return; }
    if (document.getElementById("smdAfSheet")) return;
    var enabled = isEnabled(pid);
    var wrap = document.createElement("div");
    wrap.id = "smdAfSheet";
    wrap.setAttribute("style", "position:fixed;inset:0;z-index:20000;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center");
    var prefill = "";
    try { prefill = (window.GHIS && GHIS.getUserId && GHIS.getUserId()) || ""; } catch (e) {}
    wrap.innerHTML =
      '<div role="dialog" aria-label="Auto-fetch reports" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25)">'
      + '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:6px">Auto-fetch reports</div>'
      + '<div style="font:500 12.5px/1.55 var(--sans,system-ui);color:var(--slate,#5a7184)">Keep <b>' + esc(name || "this patient") + '</b>’s labs &amp; imaging up to date automatically — fetched from Ward Sync each time you open the app, with trends refreshed. No need to re-import manually.</div>'
      + '<div style="margin:12px 0;padding:11px 12px;border:1px solid var(--line,#e4eae8);border-radius:10px;background:var(--paper,#f6f8f6);font:500 11.5px/1.5 var(--sans,system-ui);color:var(--slate,#5a7184)">'
      + '🔒 To fetch in the background, your <b>GHIS login is stored on <u>this device only</u></b>, in the secure Keychain/Keystore — <b>never on our servers</b>, never in plain text. Used only to fetch this patient’s reports. Remove it anytime below.</div>'
      + (enabled ? ''
        : '<input id="smdAfUser" autocomplete="username" placeholder="GHIS User ID" value="' + esc(prefill) + '" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:11px;border:1px solid var(--line,#e4eae8);border-radius:9px;font:600 14px var(--sans,system-ui);background:var(--paper,#f6f8f6);color:var(--ink,#0f172a)">'
        + '<input id="smdAfPass" type="password" autocomplete="current-password" placeholder="GHIS Password" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:11px;border:1px solid var(--line,#e4eae8);border-radius:9px;font:600 14px var(--sans,system-ui);background:var(--paper,#f6f8f6);color:var(--ink,#0f172a)">'
        + '<label style="display:flex;gap:9px;align-items:flex-start;font:500 12.5px/1.45 var(--sans,system-ui);color:var(--ink,#16232e);cursor:pointer;margin-bottom:14px"><input id="smdAfConsent" type="checkbox" style="width:17px;height:17px;margin-top:1px;flex:0 0 auto"><span>I consent to storing my GHIS login securely on this device to auto-fetch this patient’s reports.</span></label>')
      + '<div style="display:flex;gap:10px">'
      + '<button id="smdAfCancel" style="flex:1;padding:12px;border:1px solid var(--line,#e4eae8);border-radius:11px;background:var(--panel,#fff);color:var(--ink,#16232e);font:700 14px var(--sans,system-ui);cursor:pointer">' + (enabled ? "Close" : "Cancel") + '</button>'
      + (enabled
        ? '<button id="smdAfRefresh" style="flex:1;padding:12px;border:1px solid var(--teal,#0e6e63);border-radius:11px;background:var(--panel,#fff);color:var(--teal,#0e6e63);font:800 14px var(--sans,system-ui);cursor:pointer">Refresh now</button>'
          + '<button id="smdAfOff" style="flex:1;padding:12px;border:none;border-radius:11px;background:#b91c1c;color:#fff;font:800 14px var(--sans,system-ui);cursor:pointer">Turn off</button>'
        : '<button id="smdAfOn" style="flex:1;padding:12px;border:none;border-radius:11px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans,system-ui);cursor:pointer">Turn on</button>')
      + '</div></div>';
    document.body.appendChild(wrap);
    var close = function () { try { wrap.remove(); } catch (e) {} };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.querySelector("#smdAfCancel").addEventListener("click", close);
    var refBtn = wrap.querySelector("#smdAfRefresh");
    if (refBtn) refBtn.addEventListener("click", function () { toast("Refreshing from Ward Sync…"); refreshNow(pid, { force: true, manual: true }); close(); });
    var offBtn = wrap.querySelector("#smdAfOff");
    if (offBtn) offBtn.addEventListener("click", function () { setEnabled(pid, false); forgetCred(); toast("Auto-fetch off; saved login removed."); close(); });
    var onBtn = wrap.querySelector("#smdAfOn");
    if (onBtn) onBtn.addEventListener("click", function () {
      var u = (wrap.querySelector("#smdAfUser").value || "").trim();
      var p = wrap.querySelector("#smdAfPass").value || "";
      var consent = wrap.querySelector("#smdAfConsent").checked;
      if (!consent) { toast("Please tick consent to continue."); return; }
      if (!u || !p) { toast("Enter your GHIS User ID and password."); return; }
      onBtn.disabled = true; onBtn.textContent = "Saving…";
      storeCred(u, p).then(function () {
        setEnabled(pid, true); close(); toast("Auto-fetch on ✅ — fetching now…");
        refreshNow(pid, { force: true, manual: true });
      }).catch(function () { onBtn.disabled = false; onBtn.textContent = "Turn on"; toast("Couldn’t save securely on this device."); });
    });
  }

  window.SMD_AUTOFETCH = {
    on: on,
    isEnabled: isEnabled,
    curWardPid: curWardPid,
    openManager: openManager,
    refreshNow: function (pid) { return refreshNow(pid, { manual: true, force: true }); },   // manual "Refresh from Ward Sync"
    forget: forgetCred,
    _tick: tick,
  };
  wireResume();
})();
