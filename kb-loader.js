/* kb-loader.js — StewardMD KB loader + native-only license gate (Phase 2b).
 *
 * Owns window.SMD_KB_READY (the Promise StewardRAG / the clinical engine await) and the "smd-kb-ready" event.
 * Two modes, selected by window.SMD_KB_ENC (baked by the build; default 0):
 *   0  PLAINTEXT  — script-inject the kb/dist/*.js exactly as before. ZERO behaviour change (this is a
 *                   byte-for-byte port of the old inline loader, so a normal build is unaffected).
 *   1  ENCRYPTED  — fetch the AES key from /api/license (Pro only, 2h grace), fetch the .enc KB blobs, decrypt
 *                   in memory (WebCrypto AES-GCM, matching scripts/encrypt-kb.mjs), and inject the plaintext.
 *                   No key (not signed in / not Pro / offline past the grace) -> the KB never loads, so
 *                   window.KB stays empty and the app is clinically inert, and a full-screen "Activate" lock
 *                   is shown. This is what makes "works only if the server allows it" real.
 * CSP note: index.html leaves script-src open (inline handlers), so injecting decrypted JS via <script>.text
 * is allowed.
 */
(function () {
  "use strict";
  var KB = ["/kb/dist/kb.core.js?v=gold363", "/kb/dist/kb.clinical.js?v=gold363", "/kb/dist/kb.enrichment.js?v=gold410", "/kb/dist/kb.enrichment.2.js?v=gold410", "/kb/dist/kb.expanded.js?v=gold363"];
  var ENC = (typeof window !== "undefined" && window.SMD_KB_ENC === 1);
  var CACHE = "smd_kb_lic";

  function apiBase() { try { var h = location.hostname || ""; return /(^|\.)stewardmd\.in$/i.test(h) ? "" : "https://stewardmd.in"; } catch (e) { return "https://stewardmd.in"; } }
  function encUrl(u) { return u.replace(/(\?|$)/, ".enc$1"); }               // /x.js?v=1 -> /x.js.enc?v=1
  function b64ToBytes(b) { return Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }); }
  function decrypt(buf, keyBytes) {                                          // WebCrypto AES-GCM, iv(12)||ct||tag
    var data = new Uint8Array(buf), iv = data.slice(0, 12), body = data.slice(12);
    return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
      .then(function (key) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, body); })
      .then(function (pt) { return new TextDecoder().decode(pt); });
  }
  function done(res) { try { window.dispatchEvent(new Event("smd-kb-ready")); } catch (e) {} res(true); }
  function injectJs(js) { var s = document.createElement("script"); s.text = js; document.head.appendChild(s); }

  // key: cached within the 2h grace, else fetched from /api/license (Pro-only). Resolves null => locked.
  function cachedKey() { try { var j = JSON.parse(localStorage.getItem(CACHE) || "null"); if (j && j.key && j.expiresAt > Date.now()) return j.key; } catch (e) {} return null; }
  function token() { try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function getKey() {
    var c = cachedKey(); if (c) return Promise.resolve(c);
    return token().then(function (t) {
      if (!t) return null;                                                   // not signed in -> locked
      return fetch(apiBase() + "/api/license", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + t }, body: "{}" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok || !d.key) return null;                            // not Pro / no key
          try { localStorage.setItem(CACHE, JSON.stringify({ key: d.key, expiresAt: d.expiresAt || (Date.now() + (d.graceSeconds || 7200) * 1000) })); } catch (e) {}
          return d.key;
        }).catch(function () { return null; });
    });
  }

  function showLocked() {
    try {
      if (document.getElementById("smdKbLock")) return;
      var d = document.createElement("div"); d.id = "smdKbLock";
      d.setAttribute("style", "position:fixed;inset:0;z-index:2147483000;background:#0b1016;color:#e8eef4;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif");
      d.innerHTML = '<div style="font-size:20px;font-weight:800;margin-bottom:8px">Activate StewardMD</div>' +
        '<div style="font-size:14px;color:#9bb0c2;max-width:340px;line-height:1.5">Sign in with your subscribed account and connect to the internet once to activate. Your access then works offline for a short while.</div>' +
        '<button id="smdKbLockReload" style="margin-top:18px;background:#0e6e63;color:#fff;border:0;border-radius:10px;padding:11px 20px;font-weight:700;font-size:14px;font-family:inherit">Reload</button>';
      document.body.appendChild(d);
      var b = document.getElementById("smdKbLockReload"); if (b) b.onclick = function () { try { location.reload(); } catch (e) {} };
      try { window.dispatchEvent(new Event("smd-kb-locked")); } catch (e) {}
    } catch (e) {}
  }

  window.SMD_KB_READY = new Promise(function (res) {
    if (!ENC) {
      // PLAINTEXT (unchanged): sequential script-injection of the plaintext KB.
      var load = function (i) {
        if (i >= KB.length) return done(res);
        var s = document.createElement("script"); s.src = KB[i];
        s.onload = function () { load(i + 1); }; s.onerror = function () { load(i + 1); };
        document.head.appendChild(s);
      };
      var start = function () { requestAnimationFrame(function () { requestAnimationFrame(function () { load(0); }); }); };
      if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start); else start();
      return;
    }
    // ENCRYPTED + LICENSED: key -> fetch .enc -> decrypt -> inject; any failure fails CLOSED (locked).
    getKey().then(function (k) {
      if (!k) { showLocked(); res(false); return; }
      var kb = b64ToBytes(k);
      var step = function (i) {
        if (i >= KB.length) return done(res);
        fetch(apiBase() + encUrl(KB[i])).then(function (r) { if (!r.ok) throw new Error("enc " + r.status); return r.arrayBuffer(); })
          .then(function (buf) { return decrypt(buf, kb); })
          .then(function (js) { injectJs(js); step(i + 1); })
          .catch(function () { showLocked(); res(false); });
      };
      step(0);
    }).catch(function () { showLocked(); res(false); });
  });

  // Test hooks (pure helpers; do not use in app code).
  try { window.SMD_KBL = { _encUrl: encUrl, _decrypt: decrypt, _b64: b64ToBytes, _apiBase: apiBase, _files: KB }; } catch (e) {}
})();
