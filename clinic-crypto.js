/* clinic-crypto.js — Shared Clinic EMR delta crypto (Phase 6 adapter). AES-256-GCM keyed by a clinic
 * secret derived via PBKDF2-SHA256 (200k iterations) — the SAME scheme as personal-clinic's backup
 * envelope, so a shared clinic and a personal backup speak the same cryptography. The difference:
 * the derived key is computed ONCE and cached, so encrypting each ~15s delta batch is a fast AES-GCM
 * op (a per-batch 200k-iteration PBKDF2 would make near-real-time sync unusable).
 *
 * The clinic secret + salt come from clinic enrollment (Phase 4/5). The derived key is never persisted;
 * every delta carries its own random IV. WebCrypto (browser WKWebView + Node). This is the `crypto`
 * adapter the sync engine (clinic-sync.js) injects. window.SMD_CLINIC_CRYPTO + module.exports.
 * Generic — no ONCQIS.
 */
(function () {
  "use strict";
  var g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);
  function subtle() { var c = g.crypto; if (!c || !c.subtle) throw new Error("no_webcrypto"); return c.subtle; }
  function rand(n) { var a = new Uint8Array(n); g.crypto.getRandomValues(a); return a; }
  function toB64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return B64.enc(s); }
  function fromB64(str) { var s = B64.dec(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  var B64 = {
    enc: function (s) { return (typeof btoa !== "undefined") ? btoa(s) : Buffer.from(s, "binary").toString("base64"); },
    dec: function (s) { return (typeof atob !== "undefined") ? atob(s) : Buffer.from(s, "base64").toString("binary"); }
  };
  var TE = (typeof TextEncoder !== "undefined") ? new TextEncoder() : null;
  var TD = (typeof TextDecoder !== "undefined") ? new TextDecoder() : null;
  function bytes(str) { return TE ? TE.encode(str) : new Uint8Array(Buffer.from(str, "utf8")); }
  function text(buf) { return TD ? TD.decode(buf) : Buffer.from(new Uint8Array(buf)).toString("utf8"); }

  // Derive the AES-256-GCM key from the clinic secret + salt (PBKDF2-SHA256, 200k — matches
  // personal-clinic). Returns a Promise<CryptoKey>; callers cache it.
  function deriveKey(secret, saltB64) {
    var salt = fromB64(saltB64);
    return subtle().importKey("raw", bytes(secret), { name: "PBKDF2" }, false, ["deriveKey"]).then(function (base) {
      return subtle().deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 200000, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }

  // create(secret, saltB64?) -> { salt, encrypt(str)->Promise<blob>, decrypt(blob)->Promise<str> }.
  // The key is derived once (the shared keyP promise) and reused for every op.
  function create(secret, saltB64) {
    saltB64 = saltB64 || toB64(rand(16));
    var keyP = deriveKey(secret, saltB64);
    return {
      salt: saltB64,
      encrypt: function (str) {
        return keyP.then(function (key) {
          var iv = rand(12);
          return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, bytes(str)).then(function (ct) {
            return JSON.stringify({ v: 1, alg: "AES-GCM", iv: toB64(iv), ct: toB64(ct) });
          });
        });
      },
      decrypt: function (blob) {
        return keyP.then(function (key) {
          var o = (typeof blob === "string") ? JSON.parse(blob) : blob;
          return subtle().decrypt({ name: "AES-GCM", iv: fromB64(o.iv) }, key, fromB64(o.ct)).then(function (pt) {
            return text(pt);
          });
        });
      }
    };
  }

  var API = { create: create, deriveKey: deriveKey, newSalt: function () { return toB64(rand(16)); } };
  if (typeof window !== "undefined") window.SMD_CLINIC_CRYPTO = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
