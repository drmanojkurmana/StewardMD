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
  var _realSave = null;
  function wrapCases() {
    var real = window.SMD_CASES;
    if (!real || real._smdWrapped) return !!(real && real._smdWrapped);
    _realSave = real.save;                                     // unwrapped save (signature: key, useFirestore, caseObj, cb)
    ["save", "getAll", "delete", "clear"].forEach(function (name) {
      var orig = real[name]; if (typeof orig !== "function") return;
      real[name] = function () { var args = [].slice.call(arguments); if (args.length) args[0] = normKey(args[0]); ensureCasesMigrated(); return orig.apply(real, args); };
    });
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

  // Boot: wrap the seams as soon as app.js has defined them; set persistence + migrate on sign-in.
  (function boot(n) {
    var ok = wrapApply() & wrapCases();
    ensurePersistence();
    if (!ok && n < 80) { setTimeout(function () { boot(n + 1); }, 250); return; }
    try { ensureCasesMigrated(); } catch (e) {}
  })(0);
  onChange(function () { ensurePersistence(); try { ensureCasesMigrated(); } catch (e) {} });
})();
