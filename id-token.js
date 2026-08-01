/* StewardMD — cached identity for AI usage attribution + per-user limits.
 * Caches the Firebase ID token (verified server-side → email) and the device id, ONCE, off the
 * load-critical path (requestIdleCallback). aiHeaders() reads the cached strings SYNCHRONOUSLY, so
 * there is NO per-call getIdToken — it cannot revive the native "signed-in hang". In memory only
 * (never localStorage); cleared on sign-out. */
(function () {
  "use strict";
  var _tok = null, _tokExp = 0, _dev = null;
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); };
  function fbUser() { try { var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function applyToken(t, expMs) {
    if (!t) return;
    _tok = t;
    // Track the token's REAL expiry (Firebase ID tokens last ~1h) minus a 5-min safety margin, so we
    // never hand aiHeaders a token the server would reject as expired — that would silently drop the
    // caller to guest, losing their usage attribution and letting a capped user slip their cap.
    _tokExp = (expMs && isFinite(expMs) ? expMs : (Date.now() + 55 * 60 * 1000)) - 5 * 60 * 1000;
  }
  function refreshToken() {
    var u = fbUser();
    if (!u || !u.getIdToken) { _tok = null; _tokExp = 0; return; }   // signed out → clear the cache
    try {
      if (u.getIdTokenResult) {
        u.getIdTokenResult().then(function (r) {
          if (!r || !r.token) return;
          var exp = r.expirationTime ? Date.parse(r.expirationTime) : 0;
          // Within ~10 min of expiry: force a network refresh so the cache holds a fresh token.
          if (exp && Date.now() > exp - 10 * 60 * 1000) { u.getIdToken(true).then(function (t) { applyToken(t, Date.now() + 55 * 60 * 1000); }, function () {}); }
          else applyToken(r.token, exp);
        }, function () {});
      } else {
        u.getIdToken().then(function (t) { applyToken(t, 0); }, function () {});
      }
    } catch (e) {}
  }
  function refreshDevice() {
    try { if (window.SMD_DEVICE && SMD_DEVICE.getId) SMD_DEVICE.getId().then(function (id) { if (id) _dev = id; }, function () {}); } catch (e) {}
  }
  window.SMD_IDTOKEN = function () { return (_tok && Date.now() < _tokExp) ? _tok : null; };
  window.SMD_DEVICEID = function () { return _dev; };
  // Prime on sign-in changes + once at boot; refresh the token before it expires.
  try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function () { idle(refreshToken); }); } catch (e) {}
  idle(function () { refreshToken(); refreshDevice(); });
  setInterval(function () { idle(refreshToken); }, 25 * 60 * 1000);   // < token life, so a near-expiry token is caught + refreshed before the cache goes stale
})();
