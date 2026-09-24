/* StewardMD — OTA update client (native-ota.js / window.SMD_OTA). Phase 2.
 *
 * Implements the window.SMD_OTA contract home.js's Settings page has been carrying dormant since
 * before the 1 Aug teardown ({available,isAuto,setAuto,currentVersion,check,install}), PLUS a
 * proactive banner (the PUBG/Duolingo pattern the owner asked for) on top of it. Talks to the
 * Phase 1 server (functions/api/ota/[[path]].js) and the @capgo/capacitor-updater plugin.
 *
 * SAFE BY CONSTRUCTION WHILE THE PLUGIN ISN'T THERE YET: `plugin()` returns null until the owner
 * runs `npm install && npx cap sync` and rebuilds natively (the one release Phase 3 needs). Until
 * then every method here degrades to "no update" / a no-op — this file ships inert.
 *
 * Two safety rules carried straight from the 1 Aug incident (see vault/modules/OTA Updates.md):
 *   1. notifyAppReady() fires on EVERY launch, before anything else here runs. Skipping it makes
 *      the plugin auto-rollback — its own footgun, unrelated to the server design but just as real.
 *   2. When the server says the kill switch is on, THIS DEVICE reverts to the builtin bundle via
 *      reset() — the kill switch is enforced here, not just displayed. A device that already
 *      applied a bad release must not sit on it because nobody happened to reopen the admin console.
 *
 * Nothing here ever calls set()/next() without either an explicit user tap (install()) or the
 * user's own opt-in "Automatic updates" toggle (isAuto()) — never silently, matching "full user
 * and my control".
 */
(function () {
  "use strict";
  function isNative() { try { return !!window.SMD_IS_NATIVE; } catch (e) { return false; } }
  function plugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater) || null; } catch (e) { return null; } }
  function appPlugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null; } catch (e) { return null; } }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  var API_BASE = ""; try { API_BASE = window.SMD_API_BASE || ""; } catch (e) {}

  var VKEY = "smd_ota_version", AUTOKEY = "smd_ota_auto", LASTCHECK = "smd_ota_lastcheck";
  function myVersion() { try { return parseInt(localStorage.getItem(VKEY) || "0", 10) || 0; } catch (e) { return 0; } }
  function setMyVersion(v) { try { localStorage.setItem(VKEY, String(v)); } catch (e) {} }
  function isAuto() { try { return localStorage.getItem(AUTOKEY) === "1"; } catch (e) { return false; } }
  function setAuto(on) { try { localStorage.setItem(AUTOKEY, on ? "1" : "0"); } catch (e) {} }

  // Native build number (the store-release version), NOT the OTA bundle version — used only for
  // the server's minNativeBuild gate. @capacitor/app is already a dependency; matches the exact
  // pattern remote-config.js already uses for this.
  function nativeBuild() {
    return new Promise(function (resolve) {
      var A = appPlugin();
      if (!A || !A.getInfo) { resolve(0); return; }
      A.getInfo().then(function (i) { resolve(Number(i && i.build) || 0); }, function () { resolve(0); });
    });
  }

  // notifyAppReady EVERY launch, before anything else. Fire-and-forget — a missing/broken plugin
  // must never block app boot.
  /* THE UPDATER IS THE TRUTH, NOT LOCALSTORAGE. install() saved the new version number in the .then()
   * AFTER set() - but set() reloads the WebView into the new bundle at once, so that line usually
   * never ran. The phone then booted bundle 132, still remembered 131, showed "4.9", told the server
   * it was on 131, was offered 132 again, and the doctor installed it again, for ever (owner's Pixel 9,
   * 2026-09-25: running 132, saved 131). Every launch now reads the running bundle from the plugin and
   * rewrites the saved number; check() waits for that so it never asks with a stale version. */
  var _truth = Promise.resolve();
  function reconcileVersion() {
    var p = plugin();
    if (!p || !p.current) return Promise.resolve();
    return Promise.resolve(p.current()).then(function (c) {
      var b = (c && c.bundle) || {};
      if (!b.id || b.id === "builtin") { setMyVersion(0); return; }
      var n = parseInt(b.version, 10);
      if (n > 0) setMyVersion(n);
    }, function () {});
  }
  (function callAppReady() {
    if (!isNative()) return;
    var p = plugin();
    if (p && p.notifyAppReady) { try { p.notifyAppReady().catch(function () {}); } catch (e) {} }
    _truth = reconcileVersion();
    // Reclaim space from bundles nothing will load again — well after launch, never blocking it.
    setTimeout(function () { try { purgeOld(); } catch (e) {} }, 8000);
  })();

  function check() {
    if (!isNative() || !plugin()) return Promise.resolve({ status: "unavailable" });
    try { localStorage.setItem(LASTCHECK, String(Date.now())); } catch (e) {}
    return _truth.then(nativeBuild).then(function (build) {
      var v = myVersion();
      var url = API_BASE + "/api/ota/check?version=" + v + "&nativeBuild=" + build;
      return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ota) {
          // Server says no update. If it's specifically because the kill switch is on AND we are
          // currently running an OTA bundle (not the builtin), enforce it right here — a device
          // that already took a bad release must not wait for someone to reopen it to find out.
          if (j && j.reason === "disabled" && v > 0) {
            var p = plugin();
            try { if (p && p.reset) p.reset().catch(function () {}); } catch (e) {}
            setMyVersion(0);
            return { status: "uptodate", current: 0, reverted: true };
          }
          return { status: "uptodate", current: v };
        }
        return { status: "available", version: j.version, current: v, zipUrl: j.zipUrl, zipHash: j.zipHash };
      }, function () { return { status: "error", error: "network" }; });
    });
  }

  // install(pending, onProgress): downloads + applies. `immediate` (default true) reloads right
  // away via set() — the right choice for an explicit tap ("Update now" / "Download & install").
  // The silent auto-update path (see maybeAutoApply below) passes immediate:false (next()), so an
  // update queued in the background never yanks the screen out from under an open session.
  function install(pending, onProgress, immediate) {
    var p = plugin();
    if (!p || !p.download || !pending || !pending.zipUrl) return Promise.resolve({ ok: false, error: "unavailable" });
    var offDl = null, offFail = null;
    function cleanup() { try { if (offDl && offDl.remove) offDl.remove(); } catch (e) {} try { if (offFail && offFail.remove) offFail.remove(); } catch (e) {} }
    try {
      if (onProgress && p.addListener) {
        p.addListener("download", function (ev) { try { onProgress(Math.round((ev && ev.percent) || 0)); } catch (e) {} }).then(function (h) { offDl = h; });
      }
    } catch (e) {}
    // One automatic retry on a transport-class download failure. The plugin verifies the
    // sha256 NATIVELY after fetching, so a connection that drops mid-file surfaces as
    // "Checksum failed", not as a network error — retrying network-only would miss the most
    // common ward-connection failure. The GET is idempotent with the checksum verified on
    // every attempt, so one retry is safe; storage and auth failures still fail fast.
    function tryDownload(retriesLeft) {
      return p.download({ url: pending.zipUrl, version: String(pending.version), checksum: pending.zipHash || undefined })
        .then(null, function (e) {
          var code = otaCode(e, "download-failed");
          if (retriesLeft > 0 && (code === "network" || code === "checksum")) return tryDownload(retriesLeft - 1);
          throw e;
        });
    }
    return tryDownload(1)
      .then(function (bundle) {
        cleanup();
        var applied = (immediate === false) ? p.next({ id: bundle.id }) : p.set({ id: bundle.id });
        return applied.then(function () {
          setMyVersion(pending.version);
          return { ok: true, immediate: immediate !== false };
        }, function (e) { return { ok: false, error: otaCode(e, "apply-failed") }; });
      }, function (e) {
        cleanup();
        return { ok: false, error: otaCode(e, "download-failed") };
      });
  }

  /* NEVER hand a native error message to the UI. @capgo/capacitor-updater is given the bundle's
   * zipUrl, and its failures routinely quote that URL back - so "Install failed - <message>" printed
   * our OTA endpoint on a screen any user, or anyone over their shoulder, can read. Map to a short
   * stable CODE the UI phrases itself, and keep the detail in the console for debugging. */
  function otaCode(e, fallback) {
    var raw = String((e && (e.message || e.code)) || "");
    try { if (raw) console.warn("[ota] " + fallback + ":", raw); } catch (x) {}
    if (/checksum|hash|integrity/i.test(raw)) return "checksum";
    /* "timed out" (two words) is how the plugin phrases its OWN download cap — matching only the
     * one-word "timeout" sent every cancelled bundle down to the generic fallback, so the screen
     * read "download-failed" for what was plainly a slow connection (owner's iPhone, 2026-09-18). */
    if (/network|timed?[ -]?out|offline|connection|unreachable|dns/i.test(raw)) return "network";
    if (/space|storage|disk|quota/i.test(raw)) return "storage";
    if (/403|401|unauthor|forbidden/i.test(raw)) return "unauthorized";
    if (/404|not ?found/i.test(raw)) return "missing";
    return fallback;
  }

  /* THE VERSION THE DOCTOR READS. The server counts releases as a monotonic integer (…93, 94, 95)
   * because rollback has to republish an old bundle under a NEW number. Nobody says "I'm on 94" out
   * loud, so the app shows a plain decimal ladder instead: one tenth per release, rolling over at
   * .9 — 1.2, 1.3 … 1.9, 2.0, 2.1. LADDER_BASE is the server version labelled LADDER_BASE_TENTHS;
   * moving the base re-labels every release at once, so don't, unless renumbering is the intent.
   * The built-in bundle that ships inside the native build is the rung below the first OTA: the
   * 2026-09-18 native release is 1.2, and the first OTA that lands on top of it is 1.3. */
  var LADDER_BASE = 95, LADDER_BASE_TENTHS = 13, BUILTIN_TENTHS = LADDER_BASE_TENTHS - 1;
  function tenthsToLabel(t) { if (t < 0) t = 0; return Math.floor(t / 10) + "." + (t % 10); }
  function versionLabel(v) {
    v = Number(v) || 0;
    return v > 0 ? tenthsToLabel(LADDER_BASE_TENTHS + (v - LADDER_BASE)) : tenthsToLabel(BUILTIN_TENTHS);
  }

  /* Reclaim the space a FAILED download leaves behind — a 48MB bundle unpacks to ~123MB of loose
   * files, and autoDeletePrevious only drops the one bundle just replaced, so repeated failures
   * piled up copies nothing will ever load.
   *
   * Deletes strictly by STATUS, never by "isn't the current one". current() returns {bundle,native}
   * with NO handle on what next() has queued, so a keep-list built from it would eventually eat a
   * bundle the silent auto-update path had lined up for the next restart. 'pending' (queued by
   * next()), 'downloading' (in flight) and 'success' (usable) are all left alone.
   * Fire-and-forget: reclaiming space must never be able to fail a launch. */
  var DOOMED_STATUS = { error: 1, deleted: 1 };
  function purgeOld() {
    var p = plugin();
    if (!p || !p.list || !p.delete) return Promise.resolve({ removed: 0 });
    return p.list().then(function (r) {
      var doomed = ((r && r.bundles) || []).filter(function (b) {
        if (!b || !b.id || b.id === "builtin") return false;
        if (DOOMED_STATUS[String(b.status || "").toLowerCase()]) return true;
        /* A 'pending' bundle OLDER than the one running is a leftover from an earlier auto-update: the
         * Pixel 9 carried bundle 127 as pending while running 132. Nothing should ever switch back to it.
         * A NEWER pending bundle is what next() queued for the next restart, and is kept. */
        var n = parseInt(b.version, 10), cur = myVersion();
        return String(b.status || "").toLowerCase() === "pending" && n > 0 && cur > 0 && n < cur;
      });
      return Promise.all(doomed.map(function (b) {
        return p.delete({ id: b.id }).then(function () { return 1; }, function () { return 0; });
      })).then(function (oks) {
        var n = oks.reduce(function (a, b) { return a + b; }, 0);
        try { if (n) console.info("[ota] purged " + n + " failed bundle(s)"); } catch (e) {}
        return { removed: n };
      });
    }, function () { return { removed: 0 }; });
  }

  window.SMD_OTA = {
    available: function () { return isNative() && !!plugin(); },
    isAuto: isAuto, setAuto: setAuto,
    currentVersion: function () { var v = myVersion(); return v > 0 ? v : null; },
    versionLabel: function (v) { return versionLabel(arguments.length ? v : myVersion()); },
    purgeOld: purgeOld,
    reconcile: function () { _truth = reconcileVersion(); return _truth; },
    check: check, install: install,
  };

  // ---- The banner (the part home.js's dormant Settings row never had) -----------------------
  // A single persistent, dismissible bar — not a toast (which auto-hides). Shown only when an
  // update is genuinely ready to apply; never for "checking" or "up to date" states.
  var _bannerPending = null, _bannerEl = null, _bannerWait = null;   // _bannerWait: retry timer while home is not up yet
  function injectCSS() {
    if (document.getElementById("smdOtaCss")) return;
    var s = document.createElement("style"); s.id = "smdOtaCss";
    s.textContent =
      "#smdOtaBanner{position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:100060;" +
      "background:#0A554D;color:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;" +
      "box-shadow:0 8px 24px rgba(10,85,77,.35);font-family:var(--sans,-apple-system,system-ui,sans-serif);" +
      "opacity:0;transform:translateY(12px);transition:opacity .2s,transform .2s;pointer-events:none}" +
      "#smdOtaBanner.on{opacity:1;transform:translateY(0);pointer-events:auto}" +
      "#smdOtaBanner .ic{font-size:18px;flex:0 0 auto}" +
      "#smdOtaBanner .tx{flex:1;min-width:0}" +
      "#smdOtaBanner b{display:block;font:700 14px/1.2 inherit}" +
      "#smdOtaBanner .sub{display:block;font:500 12px/1.3 inherit;opacity:.85;margin-top:1px}" +
      "#smdOtaBanner button{border:none;border-radius:8px;font:700 12.5px inherit;padding:9px 13px;cursor:pointer;flex:0 0 auto}" +
      "#smdOtaBanner .go{background:#fff;color:#0A554D}" +
      "#smdOtaBanner .later{background:none;color:#fff;opacity:.8;padding:9px 8px}" +
      "@media(prefers-reduced-motion:reduce){#smdOtaBanner{transition:none}}";
    document.head.appendChild(s);
  }
  function showBanner(pending) {
    _bannerPending = pending;
    /* Not over the splash, the intro or the sign-in gate. Reported from internal testing with this
     * banner and the notification ask stacked on the PRE-LOGIN screen, clipping each other's text.
     * window.SMD_PROMPT_OK (home.js) is the single definition of "signed in and actually on home".
     * If it is not available, fall through and behave exactly as before rather than suppressing an
     * update notice forever. Re-checked on a timer, so the banner appears as soon as home is up. */
    try {
      if (typeof window.SMD_PROMPT_OK === "function" && !window.SMD_PROMPT_OK()) {
        if (!_bannerWait) {
          _bannerWait = setInterval(function () {
            if (typeof window.SMD_PROMPT_OK === "function" && !window.SMD_PROMPT_OK()) return;
            try { clearInterval(_bannerWait); } catch (e2) {}
            _bannerWait = null;
            showBanner(_bannerPending);
          }, 1500);
        }
        return;
      }
    } catch (e) {}
    injectCSS();
    if (!_bannerEl) {
      _bannerEl = document.createElement("div"); _bannerEl.id = "smdOtaBanner";
      _bannerEl.innerHTML = '<span class="ic">↻</span><span class="tx"><b>Update ready</b><span class="sub">Takes effect on next reopen</span></span>' +
        '<button class="later" type="button">Later</button><button class="go" type="button">Update now</button>';
      document.body.appendChild(_bannerEl);
      _bannerEl.querySelector(".later").addEventListener("click", hideBanner);
      _bannerEl.querySelector(".go").addEventListener("click", function () {
        var btn = _bannerEl.querySelector(".go"); btn.textContent = "Updating…"; btn.disabled = true;
        // set() itself reloads the WebView on success — nothing left to do here but handle failure.
        // Phrase it from the failure CODE (same vocabulary as the Settings screen): a connection
        // drop and a full disk need different actions, and a bare "try again" never says which.
        install(_bannerPending, null, true).then(function (res) {
          if (!res.ok) {
            btn.textContent = "Update now"; btn.disabled = false;
            var code = res && res.error;
            toast(code === "network" ? "Download failed — check connection and try again" :
              code === "storage" ? "Not enough space to download the update" :
              code === "checksum" ? "Update didn't verify — try again later" :
              code === "missing" ? "That update is no longer available" :
              "Couldn't apply the update — try again later");
          }
        });
      });
    }
    requestAnimationFrame(function () { _bannerEl.classList.add("on"); });
  }
  function hideBanner() { if (_bannerEl) _bannerEl.classList.remove("on"); _bannerPending = null; }

  // Silent auto-update: only when the user opted in via SMD_OTA.setAuto(true). Downloads in the
  // background and queues with next() (never set()) — the update lands on a FUTURE natural
  // restart, so it is never felt mid-session even with auto-updates on.
  function maybeAutoApply(pending) {
    if (!isAuto()) { showBanner(pending); return; }
    install(pending, null, false).then(function (res) { if (!res.ok) showBanner(pending); });
  }

  var CHECK_COOLDOWN_MS = 4 * 60 * 60 * 1000;   // background checks: at most once per 4h
  function dueForBackgroundCheck() {
    try { var t = parseInt(localStorage.getItem(LASTCHECK) || "0", 10); return !t || (Date.now() - t) > CHECK_COOLDOWN_MS; } catch (e) { return true; }
  }
  function backgroundCheck() {
    if (!isNative() || !plugin() || !dueForBackgroundCheck()) return;
    check().then(function (r) { if (r && r.status === "available") maybeAutoApply({ version: r.version, zipUrl: r.zipUrl, zipHash: r.zipHash }); });
  }

  try {
    if (isNative()) {
      setTimeout(backgroundCheck, 4000);   // clear of the initial boot burst, not competing for the JS thread
      var A = appPlugin();
      if (A && A.addListener) A.addListener("appStateChange", function (st) { if (st && st.isActive) backgroundCheck(); });
    }
  } catch (e) {}
})();
