/* StewardMD — unified account layer (additive; NEVER edits the minified app.js).
 * ---------------------------------------------------------------------------
 * Fixes two structural account problems:
 *   1) Provider mislabel — app.js stores type:"google" for EVERY provider, so Apple
 *      sign-ins showed as "Google". We enrich the stored account with the real provider
 *      (from Firebase providerData) and expose window.SMD_ACCOUNT as the source of truth.
 *   2) Orphaned cases — saved cases are keyed by u_<email>, which is empty for Apple
 *      Hide-My-Email and changes across guest/provider, so cases vanished. We re-anchor
 *      ownership to the STABLE Firebase UID (mirroring ghis-ward.js) by normalizing the
 *      key SMD_CASES stores under, and migrate existing buckets so nothing is lost.
 *
 * Read-only over the legacy stewardmd_account: app.js's O()/B() remain the sole WRITERS;
 * we wrap the public window.* seams (SMD_applyGoogleUser, SMD_CASES) after they exist.
 */
(function () {
  "use strict";
  function auth() { try { return window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()); } catch (e) { return null; } }
  function fbUser() { try { var a = auth(); return a && a.currentUser; } catch (e) { return null; } }
  function uid() { var u = fbUser(); return (u && u.uid) || "anon"; }
  function legacy() { try { return JSON.parse(localStorage.getItem("stewardmd_account") || "null"); } catch (e) { return null; } }

  // Provider is the SOURCE OF TRUTH from Firebase, not the hardcoded stored type.
  function provider() {
    var u = fbUser();
    if (u && u.providerData && u.providerData[0]) {
      var pid = u.providerData[0].providerId || "";
      if (pid.indexOf("apple") > -1) return "apple";
      if (pid.indexOf("google") > -1) return "google";
      if (pid === "password" || pid.indexOf("email") > -1) return "email";
    }
    var a = legacy();
    if (a && a.type === "tester") return "tester";
    if (a && a.type === "guest") return "guest";
    return (a && a.providerType) || (a && a.type) || "unknown";
  }
  function profile() {
    var u = fbUser(), a = legacy();
    return {
      uid: uid(), provider: provider(),
      name: (u && u.displayName) || (a && a.name) || "",
      email: (u && u.email) || (a && a.email) || "",
      picture: (u && u.photoURL) || (a && a.picture) || "",
      type: a && a.type, isGuest: !!(a && a.type === "guest"),
      signedIn: !!fbUser() || !!(a && (a.email || a.type === "google" || a.type === "apple"))
    };
  }
  var subs = [];
  function emit() { var p = profile(); subs.forEach(function (f) { try { f(p); } catch (e) {} }); }
  function onChange(fn) { if (typeof fn === "function") { subs.push(fn); try { fn(profile()); } catch (e) {} } }
  window.SMD_ACCOUNT = { uid: uid, provider: provider, profile: profile, onChange: onChange, _emit: emit };
  window.SMD_OWNER_KEY = function () { return uid(); };

  /* -------- Pro entitlement (single source of truth) --------
   * The SERVER decides (verification → Firebase pro claim → the verified free week); the client
   * only caches the last /api/billing/status verdict.
   *
   * FAIL-OPEN, BUT ONLY FOR SOMEONE WE HAVE ALREADY SEEN AS PRO (changed 2026-08-27). Seeding
   * `_pro = true` for everyone was harmless while the launch promo granted Pro to all callers. Now
   * that Pro requires a verified registration, that seed would flash Pro UI at an unverified
   * account for as long as /api/billing/status takes to answer — and offline it would never be
   * corrected. So the seed is the LAST KNOWN verdict FOR THIS UID, and false when there has never
   * been one: a verified doctor on a ward with no signal still gets in, a brand-new unverified
   * account does not. The server gates the actual features either way; this only stops the UI
   * from promising something the server will refuse. */
  function proCacheKey(u) { return "smd_pro_last:" + (u || "anon"); }
  function loadProCache() { try { return localStorage.getItem(proCacheKey(uid())) === "1"; } catch (e) { return false; } }
  function saveProCache(v) { try { localStorage.setItem(proCacheKey(uid()), v ? "1" : "0"); } catch (e) {} }
  var _pro = loadProCache(), _proState = null, _claimRefreshed = false;
  function apiUrl(p) { return (window.SMD_API_BASE || "") + p; }
  function idToken() { var u = fbUser(); try { return u && u.getIdToken ? u.getIdToken(false) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function syncStatus() {
    return Promise.resolve(idToken()).then(function (t) {
      var h = t ? { "Authorization": "Bearer " + t } : {};
      return fetch(apiUrl("/api/billing/status"), { headers: h }).then(function (r) { return r.json(); });
    }).then(function (d) {
      _proState = d || null;
      if (d && typeof d.pro === "boolean") { _pro = d.pro; saveProCache(_pro); }   // only an explicit boolean flips the cache
      /* The gates on the SERVER read claims out of the ID token this client sends, and Firebase
       * caches that token for up to an hour. So a `verified` claim that was just written - by a
       * fresh verification, an owner approval, or the reconciler that heals a record/claim
       * disagreement - does not reach those gates until the token happens to refresh. That is the
       * window where the app says "verified" and every feature still refuses. One forced refresh
       * per session closes it; it is a no-op when the token already carries the claim. */
      if (d && d.verified === true && !_claimRefreshed) {
        _claimRefreshed = true;
        try { var fu = fbUser(); if (fu && fu.getIdToken) fu.getIdToken(true).catch(function () {}); } catch (e) {}
      }
      return _proState;
    }, function () { return _proState; });                 // error → keep last known (fail-open)
  }
  function isProSync() { return _pro; }
  function isPro() { return syncStatus().then(function () { return _pro; }); }
  function proState() { return _proState; }
  window.SMD_PRO = { isPro: isPro, isProSync: isProSync, proState: proState, sync: syncStatus, TEST_PRO_EMAILS: [] };
  onChange(function () { try { _pro = loadProCache(); } catch (e) {} try { syncStatus(); } catch (e) {} });   // reseed for this uid, then refresh

  /* -------- Anti-sharing device lock --------
   * Register this device on sign-in + resume. When the server (DEVICE_LOCK_ON) reports we are no longer
   * an authorized device (evicted by a newer login beyond the tier's device limit), sign out. INERT
   * while the flag is off (enforced=false), so this is a no-op today. */
  function deviceId() {
    try { var k = "smd_device_id", v = localStorage.getItem(k); if (!v) { v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Date.now()) + Math.random().toString(36).slice(2)); localStorage.setItem(k, v); } return v; } catch (e) { return "dev0"; }
  }
  function checkDevice() {
    if (!fbUser()) return;
    Promise.resolve(idToken()).then(function (t) {
      if (!t) return null;
      return fetch(apiUrl("/api/account/device"), { method: "POST", headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: deviceId() }) }).then(function (r) { return r.json(); });
    }).then(function (d) {
      if (!d || !d.enforced) return;                       // lock off → never sign out
      var mine = deviceId(), ok = (d.devices || []).some(function (x) { return x.id === mine; });
      if (!ok) { try { (window.toast || function () {})("Signed out: this account is active on another device."); } catch (e) {} try { var a = auth(); if (a && a.signOut) a.signOut(); } catch (e) {} }
    }, function () {});
  }
  onChange(function () { try { checkDevice(); } catch (e) {} });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { try { checkDevice(); } catch (e) {} } });

  // Enrich the legacy account object with the real provider + uid (keeps app.js as writer).
  function wrapApply() {
    if (window.SMD_applyGoogleUser && window.SMD_applyGoogleUser._smdWrapped) return true;
    if (typeof window.SMD_applyGoogleUser !== "function") return false;
    var orig = window.SMD_applyGoogleUser;
    window.SMD_applyGoogleUser = function (u) {
      var r = orig.apply(this, arguments);
      try {
        var a = legacy();
        if (a) { a.providerType = provider(); if (u && u.uid) a.uid = u.uid; localStorage.setItem("stewardmd_account", JSON.stringify(a)); }
      } catch (e) {}
      try { emit(); } catch (e) {}
      return r;
    };
    window.SMD_applyGoogleUser._smdWrapped = true;
    window.SMD_applyAppleUser = window.SMD_applyGoogleUser;   // explicit intent for native-auth.js
    return true;
  }

  // Re-key: arg[0] of SMD_CASES.save/getAll/delete/clear is the ownership key. When signed
  // in, force it to the stable uid so every consumer (incl. code we can't edit) agrees on
  // one bucket: local stewardmd_cases_<uid> + Firestore users/<uid>/cases.
  function normKey(key) { var u = uid(); return (u && u !== "anon") ? u : (key || "guest"); }
  function localBucket(u) { try { var a = JSON.parse(localStorage.getItem("stewardmd_cases_" + u) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function mergeCases(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (c) { var id = c && (c.id || c.caseId); if (id != null && !seen[id]) { seen[id] = 1; out.push(c); } });
    out.sort(function (x, y) { return (y.savedAt || y.ts || y.updatedAt || 0) - (x.savedAt || x.ts || x.updatedAt || 0); });
    return out.slice(0, 10);
  }
  var _realSave = null;
  // Local-FIRST with cloud mirror. Firestore is unreliable inside the WKWebView (and the
  // app's getAll doesn't fall back to local on an empty/no-db cloud read), so saved cases
  // could vanish. We (a) always mirror saves to local, (b) merge local into every getAll,
  // and (c) apply delete/clear to both — so cases reliably save + show, while cloud still
  // syncs opportunistically when it works. arg[0] is always the ownership key → normalize to uid.
  function wrapCases() {
    var real = window.SMD_CASES;
    if (!real || real._smdWrapped) return !!(real && real._smdWrapped);
    var origSave = real.save, origGetAll = real.getAll, origDelete = real.delete, origClear = real.clear;
    _realSave = origSave;
    real.save = function (key, useFs, caseObj, cb) {
      var u = normKey(key); ensureCasesMigrated();
      try { origSave.call(real, u, false, caseObj, function () {}); } catch (e) {}   // reliable local copy
      try { return origSave.call(real, u, useFs, caseObj, cb); } catch (e) { if (cb) cb(null); }
    };
    real.getAll = function (key, useFs, cb) {
      var u = normKey(key); ensureCasesMigrated();
      var done = function (list) { try { cb && cb(mergeCases(Array.isArray(list) ? list : [], localBucket(u))); } catch (e) { cb && cb(localBucket(u)); } };
      try { return origGetAll.call(real, u, useFs, done); } catch (e) { done([]); }
    };
    real.delete = function () { var a = [].slice.call(arguments); a[0] = normKey(a[0]); try { var la = a.slice(); la[1] = false; origDelete.apply(real, la); } catch (e) {} return origDelete.apply(real, a); };
    real.clear = function () { var a = [].slice.call(arguments); a[0] = normKey(a[0]); try { var la = a.slice(); la[1] = false; origClear.apply(real, la); } catch (e) {} return origClear.apply(real, a); };
    real._smdWrapped = true;                                   // mutate IN PLACE so held refs see it
    return true;
  }

  // One-time (per-uid) merge of every legacy saved-case bucket into the uid bucket. Dedup by
  // case id, newest first, cap 10. Does NOT delete legacy buckets on this pass (safety).
  var _migrated = {};
  function ensureCasesMigrated() {
    try {
      var u = uid(); if (!u || u === "anon") return;
      if (_migrated[u]) return;
      var flag = "stewardmd_cases_uidmigrated:" + u;
      if (localStorage.getItem(flag)) { _migrated[u] = 1; return; }
      var target = "stewardmd_cases_" + u, merged = [], seen = {}, _movedIn = 0;
      function take(k, isLegacy) {
        if (!k) return;
        var arr; try { arr = JSON.parse(localStorage.getItem(k) || "[]") || []; } catch (e) { return; }
        if (!Array.isArray(arr)) return;
        arr.forEach(function (c) { var id = c && (c.id || c.caseId); if (id != null && !seen[id]) { seen[id] = 1; merged.push(c); if (isLegacy) _movedIn++; } });
      }
      take(target, false);
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("stewardmd_cases_") === 0 && k !== target && k.indexOf("migrated") < 0) take(k, true);
      }
      merged.sort(function (a, b) { return (b.savedAt || b.ts || b.updatedAt || 0) - (a.savedAt || a.ts || a.updatedAt || 0); });
      var keep = merged.slice(0, 10);
      if (keep.length) localStorage.setItem(target, JSON.stringify(keep));
      // Guest→account upgrade feedback: how many were carried in from other buckets.
      if (_movedIn > 0) { try { (window.toast || function () {})(_movedIn + (_movedIn === 1 ? " case" : " cases") + " moved to your account"); } catch (e) {} }
      // Signed-in users read from Firestore (users/<uid>/cases), so also PUSH the merged
      // cases to the cloud bucket (best-effort) — else the cloud read returns empty and the
      // migrated local cases wouldn't surface. Idempotent: runs once per uid (flag below).
      if (keep.length && _realSave && fbUser()) {
        keep.forEach(function (c) { try { _realSave(u, true, c, function () {}); } catch (e) {} });
      }
      localStorage.setItem(flag, String(Date.now()));
      _migrated[u] = 1;
    } catch (e) {}
  }

  window.SMD_migrateCasesToUid = ensureCasesMigrated;          // callable on guest→account upgrade

  // Stay signed in across launches. Firebase web compat defaults to LOCAL persistence, but we
  // set it explicitly (before any signInWithCredential) so it's guaranteed in the native WebView.
  var _persisted = false;
  function ensurePersistence() {
    if (_persisted) return;
    try {
      var a = auth(), F = window.firebase;
      if (a && a.setPersistence && F && F.auth && F.auth.Auth && F.auth.Auth.Persistence) {
        a.setPersistence(F.auth.Auth.Persistence.LOCAL).catch(function () {});
        _persisted = true;
      }
    } catch (e) {}
  }

  /* -------- Guest trial policy: 2 × 5-minute sessions per day, then force sign-in --------
   * app.js's gate gives each guest a 5-min trial (expiresAt) and permanently blocks once
   * stewardmd_guest_used is set. We steer it: clear that flag to grant a session while under
   * the daily cap; leave it set (→ app.js shows "trial used") and hide the guest button once
   * the cap is reached, so the clinician must sign in with Google/Apple. */
  var GUEST_MAX_PER_DAY = 2;
  function guestDay() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return "0"; } }
  function guestUsesToday() {
    try { if (localStorage.getItem("smd_guest_day") !== guestDay()) return 0; return parseInt(localStorage.getItem("smd_guest_uses") || "0", 10) || 0; } catch (e) { return 0; }
  }
  function bumpGuestUse() { try { localStorage.setItem("smd_guest_day", guestDay()); localStorage.setItem("smd_guest_uses", String(guestUsesToday() + 1)); } catch (e) {} }
  function guestCapped() { return guestUsesToday() >= GUEST_MAX_PER_DAY; }
  // Capture-phase → runs before app.js's guest handler, so we set the gate state it reads.
  document.addEventListener("click", function (e) {
    try {
      var b = e.target && e.target.closest && e.target.closest("#guestBtn");
      if (!b) return;
      if (guestCapped()) {
        // over cap → keep the block so app.js shows the trial-used / sign-in state
        if (!localStorage.getItem("stewardmd_guest_used")) localStorage.setItem("stewardmd_guest_used", String(Date.now()));
        enforceGuestGate();
      } else {
        localStorage.removeItem("stewardmd_guest_used");   // grant a fresh 5-min trial
        bumpGuestUse();
      }
    } catch (x) {}
  }, true);
  // Hide the guest option entirely once the daily cap is reached (force sign-in).
  function enforceGuestGate() {
    if (!guestCapped()) return;
    var el = document.getElementById("guestBlock") || document.getElementById("guestBtn");
    if (el) el.style.display = "none";
    var gate = document.getElementById("accountGate");
    if (gate) { var note = gate.querySelector(".ag-guest-note, #guestNote"); if (note) note.style.display = "none"; }
  }
  try { new MutationObserver(enforceGuestGate).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enforceGuestGate); else enforceGuestGate();

  // Boot: wrap the seams as soon as app.js has defined them; set persistence + migrate on sign-in.
  (function boot(n) {
    var ok = wrapApply() & wrapCases();
    ensurePersistence();
    if (!ok && n < 80) { setTimeout(function () { boot(n + 1); }, 250); return; }
    try { ensureCasesMigrated(); } catch (e) {}
  })(0);
  // ensurePersistence stays immediate (one-time offline-persistence enable); DEFER the saved-cases
  // migration read to idle so its Firestore .get()/deserialize doesn't starve the JS thread AI needs
  // right after sign-in (see ku.js). Migration is not time-critical.
  onChange(function () { ensurePersistence(); (window.requestIdleCallback || function (f) { return setTimeout(f, 2500); })(function () { try { ensureCasesMigrated(); } catch (e) {} }, { timeout: 8000 }); });
})();
