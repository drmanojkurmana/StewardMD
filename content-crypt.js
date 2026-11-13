/* StewardMD — bundled content decryptor. window.SMD_CONTENT
 *
 * Build-time tools/encrypt-bundle.mjs writes AES-256-GCM ciphertext in place for JSON under
 * kb/, data/, prep/lessons, prep/bank, prep/nucleus360 with header:
 *   SMDE1 | keyIdLen u8 | keyId | iv(12) | ciphertext||tag(16)
 *
 * Runtime: fetch bytes → if SMDE1, decrypt with the key for that key id → JSON.parse.
 * Plain JSON (local dev, old caches) still works. Keys live in SecureStoragePlugin
 * (iOS Keychain / Android Keystore) via window.SMD_SECURE when available; memory + Preferences
 * as fallback. After first online unlock the library works fully offline.
 *
 * Offline with no key: showUnlock() — never blank, never crash.
 */
(function (G) {
  "use strict";

  var MAGIC = [0x53, 0x4d, 0x44, 0x45, 0x31]; // SMDE1
  var IV_LEN = 12;
  var TAG_LEN = 16;
  var STORE_PREFIX = "smd_content_key:";
  var IDS_KEY = "smd_content_key_ids";
  var memKeys = Object.create(null);   // keyId -> base64
  var memCrypto = Object.create(null); // keyId -> CryptoKey
  var memJson = Object.create(null);   // url (no query) -> parsed object
  var pendingFetch = Object.create(null);
  var unlockShown = false;
  var KEY_API = "/api/content-key";

  function apiBase() {
    try {
      var h = (G.location && G.location.hostname) || "";
      return /(^|\.)stewardmd\.in$/i.test(h) ? "" : (G.SMD_API_BASE || "https://stewardmd.in");
    } catch (e) { return G.SMD_API_BASE || "https://stewardmd.in"; }
  }

  function covers(url) {
    try {
      var u = String(url || "");
      var path = u;
      if (/^https?:\/\//i.test(u)) {
        var a = document.createElement("a"); a.href = u; path = a.pathname || "";
      } else if (u.charAt(0) !== "/") {
        // relative — treat as path from root when it starts with known dirs
        path = "/" + u.replace(/^\.\//, "");
      }
      path = path.split("?")[0].split("#")[0];
      return /^\/kb\//.test(path) || /^\/data\//.test(path) ||
        /^\/prep\/lessons(\/|$)/.test(path) || /^\/prep\/bank(\/|$)/.test(path) ||
        /^\/prep\/nucleus360(\/|$)/.test(path);
    } catch (e) { return false; }
  }

  function cacheKey(url) {
    return String(url || "").split("?")[0].split("#")[0];
  }

  function isSmde1(u8) {
    if (!u8 || u8.length < 6) return false;
    for (var i = 0; i < 5; i++) if (u8[i] !== MAGIC[i]) return false;
    return true;
  }

  function b64ToBytes(b64) {
    var bin = atob(String(b64 || ""));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(u8) {
    var s = "", i;
    for (i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  function ensureSecure() {
    if (G.SMD_SECURE) return G.SMD_SECURE;
    // Same Keychain/Keystore shim autofetch.js / applock.js install when missing.
    G.SMD_SECURE = (function () {
      function ss() {
        try {
          var P = G.Capacitor && G.Capacitor.Plugins;
          return P && P.SecureStoragePlugin;
        } catch (e) { return null; }
      }
      return {
        available: function () { return !!ss(); },
        set: function (key, val) {
          var s = ss();
          if (!s) return Promise.reject(new Error("secure-unavailable"));
          return s.set({ key: key, value: (typeof val === "string") ? val : JSON.stringify(val) });
        },
        get: function (key) {
          var s = ss();
          if (!s) return Promise.resolve(null);
          return s.get({ key: key }).then(function (r) {
            return (r && r.value != null) ? r.value : null;
          }).catch(function () { return null; });
        },
        remove: function (key) {
          var s = ss();
          if (!s) return Promise.resolve();
          return s.remove({ key: key }).catch(function () {});
        }
      };
    })();
    return G.SMD_SECURE;
  }

  function prefsSet(key, val) {
    try {
      var Prefs = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Preferences;
      if (Prefs && Prefs.set) return Prefs.set({ key: key, value: String(val) });
    } catch (e) {}
    try { localStorage.setItem(key, String(val)); } catch (e2) {}
    return Promise.resolve();
  }
  function prefsGet(key) {
    try {
      var Prefs = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Preferences;
      if (Prefs && Prefs.get) {
        return Prefs.get({ key: key }).then(function (r) {
          return (r && r.value != null) ? r.value : null;
        }).catch(function () {
          try { return localStorage.getItem(key); } catch (e) { return null; }
        });
      }
    } catch (e) {}
    try { return Promise.resolve(localStorage.getItem(key)); } catch (e2) { return Promise.resolve(null); }
  }

  function rememberId(keyId) {
    return listKeyIds().then(function (ids) {
      if (ids.indexOf(keyId) >= 0) return ids;
      ids.push(keyId);
      var raw = JSON.stringify(ids);
      memKeys.__ids = ids;
      return prefsSet(IDS_KEY, raw).then(function () { return ids; });
    });
  }

  function listKeyIds() {
    if (memKeys.__ids) return Promise.resolve(memKeys.__ids.slice());
    return prefsGet(IDS_KEY).then(function (raw) {
      var ids = [];
      try { ids = JSON.parse(raw || "[]"); } catch (e) { ids = []; }
      if (!Array.isArray(ids)) ids = [];
      memKeys.__ids = ids;
      return ids.slice();
    });
  }

  function storeKey(keyId, keyB64) {
    memKeys[keyId] = keyB64;
    delete memCrypto[keyId];
    var sec = ensureSecure();
    var p = Promise.resolve();
    if (sec && sec.available && sec.available()) {
      p = sec.set(STORE_PREFIX + keyId, keyB64).catch(function () {
        // Fall back to Preferences if Keychain write fails (rare).
        return prefsSet(STORE_PREFIX + keyId, keyB64);
      });
    } else {
      p = prefsSet(STORE_PREFIX + keyId, keyB64);
    }
    return p.then(function () { return rememberId(keyId); }).then(function () { return keyB64; });
  }

  function loadStoredKey(keyId) {
    if (memKeys[keyId]) return Promise.resolve(memKeys[keyId]);
    var sec = ensureSecure();
    var read = (sec && sec.available && sec.available())
      ? sec.get(STORE_PREFIX + keyId)
      : Promise.resolve(null);
    return read.then(function (v) {
      if (v) { memKeys[keyId] = v; return v; }
      return prefsGet(STORE_PREFIX + keyId).then(function (v2) {
        if (v2) memKeys[keyId] = v2;
        return v2 || null;
      });
    });
  }

  function importKey(keyB64) {
    var raw = b64ToBytes(keyB64);
    if (raw.length !== 32) return Promise.reject(new Error("bad key length"));
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  }

  function cryptoKeyFor(keyId) {
    if (memCrypto[keyId]) return Promise.resolve(memCrypto[keyId]);
    return loadStoredKey(keyId).then(function (b64) {
      if (!b64) return null;
      return importKey(b64).then(function (ck) {
        memCrypto[keyId] = ck;
        return ck;
      });
    });
  }

  function idToken() {
    try {
      if (typeof G.SMD_IDTOKEN === "function") {
        var t = G.SMD_IDTOKEN();
        if (t) return Promise.resolve(t);
      }
      if (G.SMD_AUTH && G.SMD_AUTH.currentUser && G.SMD_AUTH.currentUser.getIdToken) {
        return G.SMD_AUTH.currentUser.getIdToken();
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  function appCheckToken() {
    try {
      var P = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.FirebaseAppCheck;
      if (P && P.getToken) {
        return P.getToken({ forceRefresh: false }).then(function (r) {
          return (r && r.token) || null;
        }).catch(function () { return null; });
      }
      if (G.firebase && G.firebase.appCheck) {
        return G.firebase.appCheck().getToken(false).then(function (r) {
          return (r && r.token) || null;
        }).catch(function () { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  /** Fetch { keyId, key } from /api/content-key and persist. Optional wantId prefers that id. */
  function fetchKey(wantId) {
    return Promise.all([idToken(), appCheckToken()]).then(function (pair) {
      var tok = pair[0], ac = pair[1];
      if (!tok && !ac) return null;
      var headers = { "Accept": "application/json" };
      if (tok) headers["Authorization"] = "Bearer " + tok;
      if (ac) headers["X-Firebase-AppCheck"] = ac;
      var q = wantId ? ("?keyId=" + encodeURIComponent(wantId)) : "";
      return fetch(apiBase() + KEY_API + q, { method: "GET", headers: headers, cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.key || !d.keyId) return null;
          return storeKey(d.keyId, d.key).then(function () { return d; });
        })
        .catch(function () { return null; });
    });
  }

  /** Ensure we have a usable key for keyId (stored or freshly fetched). */
  function ensureKey(keyId) {
    return cryptoKeyFor(keyId).then(function (ck) {
      if (ck) return ck;
      return fetchKey(keyId).then(function (d) {
        if (!d) return null;
        return cryptoKeyFor(d.keyId);
      });
    });
  }

  /** Warm any stored keys into memory (call on boot / before OTA activate). */
  function warmKeys() {
    return listKeyIds().then(function (ids) {
      return Promise.all(ids.map(function (id) { return loadStoredKey(id); }));
    });
  }

  /**
   * Ensure the key for an upcoming OTA bundle is on device BEFORE activation.
   * pending may carry .contentKeyId / .keyId from /api/ota/check.
   */
  function ensureKeyForOta(pending) {
    var id = (pending && (pending.contentKeyId || pending.keyId)) || null;
    if (!id) {
      // No key id on the check payload yet — still refresh the current/default key while online.
      return fetchKey(null).then(function () { return true; }, function () { return false; });
    }
    return ensureKey(id).then(function (ck) { return !!ck; });
  }

  function decryptSmde1(u8) {
    var idLen = u8[5];
    if (!(idLen >= 1 && idLen <= 64)) return Promise.reject(new Error("bad keyIdLen"));
    var keyId = new TextDecoder().decode(u8.subarray(6, 6 + idLen));
    var ivOff = 6 + idLen;
    var iv = u8.subarray(ivOff, ivOff + IV_LEN);
    var body = u8.subarray(ivOff + IV_LEN);
    if (body.length < TAG_LEN) return Promise.reject(new Error("truncated"));
    return ensureKey(keyId).then(function (ck) {
      if (!ck) {
        var err = new Error("content-key-missing");
        err.code = "content-key-missing";
        err.keyId = keyId;
        throw err;
      }
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, ck, body)
        .then(function (pt) {
          return { keyId: keyId, text: new TextDecoder().decode(pt) };
        }, function () {
          var e = new Error("content-decrypt-failed");
          e.code = "content-decrypt-failed";
          e.keyId = keyId;
          throw e;
        });
    });
  }

  /** Parse ArrayBuffer / Uint8Array: SMDE1 → decrypt → JSON; else UTF-8 JSON. */
  function parseBody(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (!isSmde1(u8)) {
      var txt = new TextDecoder().decode(u8);
      return Promise.resolve(JSON.parse(txt));
    }
    return decryptSmde1(u8).then(function (r) {
      return JSON.parse(r.text);
    });
  }

  function showUnlock(msg) {
    if (unlockShown) return;
    unlockShown = true;
    try {
      if (document.getElementById("smdContentUnlock")) return;
      var d = document.createElement("div");
      d.id = "smdContentUnlock";
      d.setAttribute("role", "alertdialog");
      d.setAttribute("aria-labelledby", "smdContentUnlockTitle");
      d.setAttribute("style",
        "position:fixed;inset:0;z-index:2147482900;background:rgba(11,16,22,.92);color:#e8eef4;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;" +
        "padding:24px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif");
      d.innerHTML =
        '<div id="smdContentUnlockTitle" style="font-size:20px;font-weight:800;margin-bottom:8px">Unlock the library</div>' +
        '<div style="font-size:14px;color:#9bb0c2;max-width:360px;line-height:1.5">' +
        (msg || "Connect to the internet once to unlock the library. After that it works fully offline on this device.") +
        "</div>" +
        '<button id="smdContentUnlockBtn" style="margin-top:18px;background:#0e6e63;color:#fff;border:0;' +
        'border-radius:10px;padding:11px 20px;font-weight:700;font-size:14px;font-family:inherit">Try again</button>';
      (document.body || document.documentElement).appendChild(d);
      var b = document.getElementById("smdContentUnlockBtn");
      if (b) {
        b.onclick = function () {
          fetchKey(null).then(function (got) {
            if (got) {
              hideUnlock();
              try { G.dispatchEvent(new Event("smd-content-unlocked")); } catch (e3) {}
            }
          });
        };
      }
      try { G.dispatchEvent(new Event("smd-content-locked")); } catch (e) {}
    } catch (e) {}
  }

  function hideUnlock() {
    unlockShown = false;
    try {
      var el = document.getElementById("smdContentUnlock");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) {}
  }

  /**
   * Fetch URL as JSON, decrypting SMDE1 when present.
   * opts: { cache: "no-cache"|..., optional: bool (resolve null on HTTP error), signal }
   */
  function fetchJSON(url, opts) {
    opts = opts || {};
    var ck = cacheKey(url);
    if (memJson[ck] !== undefined && opts.cache !== "reload" && opts.bust !== true) {
      return Promise.resolve(memJson[ck]);
    }
    if (pendingFetch[ck] && opts.bust !== true) return pendingFetch[ck];

    var fetchOpts = {};
    if (opts.cache) fetchOpts.cache = opts.cache;
    if (opts.signal) fetchOpts.signal = opts.signal;
    var doFetch = (G.fetch || fetch).bind(G);

    var p = doFetch(url, fetchOpts).then(function (r) {
      if (!r || !r.ok) {
        if (opts.optional) return null;
        var e = new Error("HTTP " + (r && r.status));
        e.status = r && r.status;
        throw e;
      }
      return r.arrayBuffer().then(function (buf) {
        return parseBody(buf).then(function (j) {
          memJson[ck] = j;
          return j;
        }, function (err) {
          if (err && err.code === "content-key-missing") {
            showUnlock();
          }
          throw err;
        });
      });
    });

    pendingFetch[ck] = p;
    p.then(function () { delete pendingFetch[ck]; }, function () { delete pendingFetch[ck]; });
    return p;
  }

  /** Drop-in for `r.json()` after a fetch of a covered URL: reads bytes, decrypts if needed. */
  function responseJSON(r) {
    if (!r) return Promise.reject(new Error("no response"));
    if (!r.ok) {
      var e = new Error("HTTP " + r.status);
      e.status = r.status;
      return Promise.reject(e);
    }
    return r.arrayBuffer().then(function (buf) {
      return parseBody(buf).then(function (j) { return j; }, function (err) {
        if (err && err.code === "content-key-missing") showUnlock();
        throw err;
      });
    });
  }

  /** Like responseJSON but returns null on !ok (common optional-load pattern). */
  function responseJSONOrNull(r) {
    if (!r || !r.ok) return Promise.resolve(null);
    return responseJSON(r).catch(function () { return null; });
  }

  function clearMemCache() { memJson = Object.create(null); }

  // Eager warm of stored keys (non-blocking).
  try { warmKeys(); } catch (e) {}

  G.SMD_CONTENT = {
    MAGIC: "SMDE1",
    covers: covers,
    isSmde1: function (buf) { return isSmde1(buf instanceof Uint8Array ? buf : new Uint8Array(buf)); },
    parseBody: parseBody,
    fetchJSON: fetchJSON,
    responseJSON: responseJSON,
    responseJSONOrNull: responseJSONOrNull,
    ensureKey: ensureKey,
    fetchKey: fetchKey,
    storeKey: storeKey,
    loadStoredKey: loadStoredKey,
    listKeyIds: listKeyIds,
    warmKeys: warmKeys,
    ensureKeyForOta: ensureKeyForOta,
    showUnlock: showUnlock,
    hideUnlock: hideUnlock,
    clearMemCache: clearMemCache,
    // test hooks
    _memKeys: memKeys,
    _b64ToBytes: b64ToBytes,
    _bytesToB64: bytesToB64
  };
})(typeof window !== "undefined" ? window : globalThis);
