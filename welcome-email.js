/* Welcome email on first sign-up. Attaches an extra Firebase auth listener (additive —
   does not touch app.js) and, when a genuinely NEW account signs in (creation ≈ last
   sign-in), POSTs /api/welcome once. Per-device localStorage guard prevents repeats. */
(function () {
  function attach() {
    if (!window.SMD_AUTH || typeof window.SMD_AUTH.onAuthStateChanged !== "function") return false;
    window.SMD_AUTH.onAuthStateChanged(function (u) {
      if (!u || !u.email) return;
      var flag = "smd_welcomed_" + u.uid;
      try { if (localStorage.getItem(flag)) return; } catch (e) {}
      var c = (u.metadata && u.metadata.creationTime) ? Date.parse(u.metadata.creationTime) : 0;
      var l = (u.metadata && u.metadata.lastSignInTime) ? Date.parse(u.metadata.lastSignInTime) : 0;
      var isNew = c && (!l || Math.abs(l - c) < 120000);   // fresh account: created ≈ this sign-in
      try { localStorage.setItem(flag, "1"); } catch (e) {}  // mark once so we never re-check this device
      if (!isNew) return;
      try {
        u.getIdToken().then(function (tok) {
          fetch("/api/welcome", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
            body: JSON.stringify({ name: u.displayName || "" }),
          }).catch(function () {});
        }).catch(function () {});
      } catch (e) {}
    });
    return true;
  }
  if (!attach()) { var n = 0, iv = setInterval(function () { if (attach() || ++n > 60) clearInterval(iv); }, 300); }
})();
