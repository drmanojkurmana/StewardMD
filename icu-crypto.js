/* StewardMD — ICU collaboration at-rest encryption (client side).  window.SMD_ICU_CRYPTO
 *
 * Encrypts the PHI fields of the shared ICU patient doc (name, dx, bed, full clinical state) ON
 * THIS DEVICE before they are written to Firestore, and decrypts them on read. The per-group
 * AES-256 key is fetched ONCE from the membership-gated endpoint /api/icu/group-key (the server
 * derives it from ICU_GROUP_KEY_SECRET + gid) and cached in memory only — never persisted. So a
 * Firestore dump shows only ciphertext, and only a signed-in MEMBER of the group can obtain the key.
 *
 * Envelope format:  "eg1:" + base64( iv(12 bytes) || AES-GCM-ciphertext )
 * All functions are async (WebCrypto). Fail-CLOSED on encrypt (never write cleartext PHI); on
 * decrypt failure the caller shows a locked placeholder rather than leaking anything.
 */
(function () {
  "use strict";
  var TAG = "eg1:";
  var keys = {};       // gid -> CryptoKey (in-memory only)
  var pending = {};    // gid -> Promise<CryptoKey> (de-dupe concurrent fetches)

  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var bin = atob(String(s)); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  function idToken() {
    try {
      var auth = (window.firebase && window.firebase.auth && window.firebase.auth());
      var u = auth && auth.currentUser;
      if (!u) return Promise.reject(new Error("not_signed_in"));
      return u.getIdToken();
    } catch (e) { return Promise.reject(e); }
  }

  // Fetch + import the group key (cached). Rejects if not a member / not signed in / not configured.
  function fetchKey(gid) {
    if (!gid) return Promise.reject(new Error("no_gid"));
    if (keys[gid]) return Promise.resolve(keys[gid]);
    if (pending[gid]) return pending[gid];
    var p = idToken().then(function (tok) {
      return fetch("/api/icu/group-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({ gid: gid }),
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("key_http_" + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !d.key) throw new Error("no_key");
      return crypto.subtle.importKey("raw", unb64(d.key), "AES-GCM", false, ["encrypt", "decrypt"]);
    }).then(function (k) {
      keys[gid] = k; delete pending[gid]; return k;
    });
    p.catch(function () { delete pending[gid]; });   // let a failed fetch be retried
    pending[gid] = p;
    return p;
  }

  function isCipher(s) { return typeof s === "string" && s.indexOf(TAG) === 0; }

  // Encrypt a JS object → envelope string. Fail-closed (rejects) if the key can't be obtained.
  function encObj(gid, obj) {
    return fetchKey(gid).then(function (k) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify(obj == null ? null : obj));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, data).then(function (ct) {
        var body = new Uint8Array(ct);
        var out = new Uint8Array(12 + body.length);
        out.set(iv, 0); out.set(body, 12);
        return TAG + b64(out);
      });
    });
  }

  // Decrypt an envelope string → JS object. Rejects on any tamper / wrong key / bad format.
  function decObj(gid, blob) {
    if (!isCipher(blob)) return Promise.reject(new Error("bad_blob"));
    return fetchKey(gid).then(function (k) {
      var raw = unb64(blob.slice(TAG.length));
      var iv = raw.slice(0, 12), ct = raw.slice(12);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, k, ct).then(function (pt) {
        return JSON.parse(new TextDecoder().decode(pt));
      });
    });
  }

  window.SMD_ICU_CRYPTO = { fetchKey: fetchKey, encObj: encObj, decObj: decObj, isCipher: isCipher };
})();
