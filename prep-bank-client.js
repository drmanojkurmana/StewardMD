/* StewardMD — PrepNucleus bank client with authentication, app proof & image signing.
 * ES5 compatible IIFE.
 *
 * Implements:
 * 1. Per-session HMAC keys (10 min TTL) minted via POST /api/prep/session.
 * 2. Request signing: timestamp + path + nonce signed with HMAC-SHA256.
 * 3. Transparent session renewal: auto-refreshes before expiry; on 401 invalid-session retries once.
 * 4. Image URL signing: synchronous HMAC signature generation (?s=...&exp=...&sig=...).
 * 5. Platform attestation hook: forwards Apple App Attest / Play Integrity token when available.
 */
(function (G) {
  "use strict";

  // SHA-256 constants & pure JS implementation
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(s) {
    if (Array.isArray(s) || (s && s.buffer)) return Array.from(s);
    var out = [], i, c, d;
    s = String(s);
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
        d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d < 0xe000) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function sha256Bytes(inp) {
    var b = utf8(inp), n = b.length, i, j, t;
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    var hi = Math.floor(n / 0x20000000), lo = (n * 8) >>> 0;
    b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var w = new Array(64);
    for (i = 0; i < b.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (b[i + 4 * j] << 24) | (b[i + 4 * j + 1] << 16) | (b[i + 4 * j + 2] << 8) | b[i + 4 * j + 3];
      for (j = 16; j < 64; j++) {
        var x = w[j - 15], y = w[j - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (j = 0; j < 64; j++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[j] + w[j]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & bb) ^ (a & c) ^ (bb & c);
        t = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
    return out;
  }

  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }

  function hmacSha256Hex(keyHexOrStr, msg) {
    var k = typeof keyHexOrStr === "string" && /^[0-9a-f]{64}$/i.test(keyHexOrStr)
      ? (function () { var b = []; for (var i = 0; i < 64; i += 2) b.push(parseInt(keyHexOrStr.substr(i, 2), 16)); return b; })()
      : utf8(keyHexOrStr);
    if (k.length > 64) k = sha256Bytes(k);
    while (k.length < 64) k.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) {
      ipad.push(k[i] ^ 0x36);
      opad.push(k[i] ^ 0x5c);
    }
    var inner = sha256Bytes(ipad.concat(utf8(msg)));
    var outer = sha256Bytes(opad.concat(inner));
    return hex(outer);
  }

  // Path classification
  var STUDY_RE = /^v\d{1,3}\/(?:(?:lessons|cards)\/(?:index|[a-z0-9-]{2,80})\.json|lessons\/media\/[a-z0-9-]{2,80}\.(?:svg|webp))$/;
  var CREDITS_RE = /^image-credits\.json$/;

  function classifyBankPath(p) {
    if (!p || typeof p !== "string") return null;
    p = p.replace(/^\/+/, "").replace(/^api\/prep\/bank\//, "");
    if (p === "health" || p === "status") return "public";
    if (CREDITS_RE.test(p)) return "public";
    if (STUDY_RE.test(p)) return "public";
    return "gated";
  }

  function isGatedPath(p) {
    return classifyBankPath(p) === "gated";
  }

  function isImagePath(p) {
    return /\.(?:webp|svg|png|jpg)$/i.test(String(p || ""));
  }

  function extractBankPath(urlOrPath) {
    var s = String(urlOrPath || "");
    var m = s.match(/(?:\/api\/prep\/bank\/|^api\/prep\/bank\/)([^?#]+)/);
    if (m) return m[1];
    var m2 = s.match(/^https?:\/\/[^\/]+\/api\/prep\/bank\/([^?#]+)/);
    if (m2) return m2[1];
    return s.replace(/^\/+/, "");
  }

  // Session state (held in memory only, never written to disk or localStorage)
  var _session = null;
  var _sessionP = null;

  function clearSession() {
    _session = null;
    _sessionP = null;
  }

  function getPlatformAttestation() {
    // Native hook: Apple App Attest / Play Integrity
    try {
      if (G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.AppAttest) {
        return G.Capacitor.Plugins.AppAttest.getAttestation().catch(function () { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  function getIdToken() {
    var tok = G.SMD_IDTOKEN ? G.SMD_IDTOKEN() : null;
    if (tok) return Promise.resolve(tok);
    if (G.SMD_IDTOKEN_REFRESH) {
      return G.SMD_IDTOKEN_REFRESH(4000).then(function (tk) {
        if (tk) return tk;
        try {
          var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth());
          var u = a && a.currentUser;
          if (u && u.getIdToken) return u.getIdToken();
        } catch (e) {}
        return null;
      });
    }
    try {
      var a2 = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth());
      var u2 = a2 && a2.currentUser;
      if (u2 && u2.getIdToken) return u2.getIdToken();
    } catch (e2) {}
    return Promise.resolve(null);
  }

  function getSession() {
    var now = Math.floor(Date.now() / 1000);
    if (_session && _session.expiresAt && _session.expiresAt > now + 30) {
      return Promise.resolve(_session);
    }
    if (_sessionP) return _sessionP;

    _sessionP = getIdToken().then(function (tok) {
      if (!tok) {
        throw { error: "unauthorized", code: "login-required", message: "Sign in to access question bank" };
      }
      var devId = (G.SMD_DEVICEID && G.SMD_DEVICEID()) || "unknown";
      return getPlatformAttestation().then(function (attestation) {
        var base = G.SMD_API_BASE || "";
        return G.fetch(base + "/api/prep/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + tok,
            "X-SMD-Device": devId
          },
          body: JSON.stringify({
            deviceId: devId,
            appVersion: "1.0.0",
            attestation: attestation
          })
        }).then(function (r) {
          if (!r.ok) {
            return r.json().catch(function () { return {}; }).then(function (j) {
              var err = new Error((j && j.message) || "Failed to obtain bank session (HTTP " + r.status + ")");
              err.status = r.status;
              err.code = (j && j.code) || "session-failed";
              throw err;
            });
          }
          return r.json();
        }).then(function (data) {
          if (!data || !data.sessionId || !data.sessionKey) {
            throw new Error("Invalid session response from bank server");
          }
          _session = {
            sessionId: data.sessionId,
            sessionKey: data.sessionKey,
            expiresAt: data.expiresAt || (Math.floor(Date.now() / 1000) + 600),
            uid: data.uid || ""
          };
          _sessionP = null;
          return _session;
        });
      });
    }).catch(function (err) {
      _sessionP = null;
      throw err;
    });

    return _sessionP;
  }

  function signRequestHeaders(path) {
    return getSession().then(function (sess) {
      return getIdToken().then(function (tok) {
        var ts = Math.floor(Date.now() / 1000);
        var nonce = "n_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        var toSign = ts + ":" + path + ":" + nonce;
        var sig = hmacSha256Hex(sess.sessionKey, toSign);

        var headers = {
          "Authorization": "Bearer " + (tok || ""),
          "X-SMD-Session": sess.sessionId,
          "X-SMD-Timestamp": String(ts),
          "X-SMD-Nonce": nonce,
          "X-SMD-Signature": sig
        };
        var dev = G.SMD_DEVICEID && G.SMD_DEVICEID();
        if (dev) headers["X-SMD-Device"] = dev;
        return headers;
      });
    });
  }

  function signImageUrl(urlOrPath) {
    var p = extractBankPath(urlOrPath);
    if (!isImagePath(p) || !isGatedPath(p)) return urlOrPath;

    var now = Math.floor(Date.now() / 1000);
    if (!_session || !_session.sessionKey || !_session.sessionId || _session.expiresAt <= now) {
      return urlOrPath;
    }

    var exp = now + 300;
    var sig = hmacSha256Hex(_session.sessionKey, p + ":" + exp);
    var query = "s=" + encodeURIComponent(_session.sessionId) + "&exp=" + exp + "&sig=" + sig;
    var sep = urlOrPath.indexOf("?") >= 0 ? "&" : "?";
    return urlOrPath + sep + query;
  }

  function fetchBankJSON(url, retryCount) {
    var p = extractBankPath(url);
    if (!isGatedPath(p)) {
      return G.fetch(url, { cache: "no-store" }).then(function (r) {
        if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
        return r.json();
      });
    }

    return signRequestHeaders(p).then(function (headers) {
      return G.fetch(url, {
        method: "GET",
        headers: headers,
        cache: "no-store"
      });
    }).then(function (r) {
      if (r.status === 401 && (!retryCount || retryCount < 1)) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (j && (j.code === "invalid-session" || j.code === "session-user-mismatch" || j.code === "missing-proof" || j.code === "stale-timestamp")) {
            clearSession();
            return fetchBankJSON(url, (retryCount || 0) + 1);
          }
          var err = new Error(j.message || "Sign in required to access question bank");
          err.status = 401;
          err.code = j.code || "unauthorized";
          throw err;
        });
      }
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var err = new Error((j && j.message) || "HTTP " + r.status);
          err.status = r.status;
          err.code = (j && j.code) || "error";
          throw err;
        });
      }
      return r.json();
    });
  }

  var CLIENT = {
    classifyBankPath: classifyBankPath,
    isGatedPath: isGatedPath,
    isImagePath: isImagePath,
    extractBankPath: extractBankPath,
    hmacSha256Hex: hmacSha256Hex,
    getSession: getSession,
    clearSession: clearSession,
    signRequestHeaders: signRequestHeaders,
    signImageUrl: signImageUrl,
    fetchBankJSON: fetchBankJSON
  };

  G.PREP_BANK_CLIENT = CLIENT;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = CLIENT;
  }
})(typeof window !== "undefined" ? window : globalThis);
