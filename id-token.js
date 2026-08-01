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
  function refreshToken() {
    var u = fbUser();
    if (!u || !u.getIdToken) { _tok = null; return; }
    try { u.getIdToken().then(function (t) { if (t) { _tok = t; _tokExp = Date.now() + 50 * 60 * 1000; } }, function () {}); } catch (e) {}
  }
  function refreshDevice() {
    try { if (window.SMD_DEVICE && SMD_DEVICE.getId) SMD_DEVICE.getId().then(function (id) { if (id) _dev = id; }, function () {}); } catch (e) {}
  }
  window.SMD_IDTOKEN = function () { return (_tok && Date.now() < _tokExp) ? _tok : null; };
  window.SMD_DEVICEID = function () { return _dev; };
  // Prime on sign-in changes + once at boot; refresh the token before it expires.
  try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function () { idle(refreshToken); }); } catch (e) {}
  idle(function () { refreshToken(); refreshDevice(); });
  setInterval(function () { idle(refreshToken); }, 45 * 60 * 1000);
})();
