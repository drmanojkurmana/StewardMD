/* StewardMD - ResearchMD encrypted backup (window.RMDBackup).
 * ES5 IIFE. Dual export. PBKDF2-HMAC-SHA256, 600,000 iterations,
 * 16-byte salt, AES-GCM 256, 12-byte IV. Works with globalThis.crypto.subtle.
 * Patient rows stay inside the encrypted file. Images are data URL strings.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var CHANGE_KEY = "rmd.v1.lastChangeAt";
  var BACKUP_KEY = "rmd.v1.lastBackupAt";
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var ITERATIONS = 600000;
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function cryptoHost() {
    if (G && G.crypto && G.crypto.subtle && G.crypto.getRandomValues) return G.crypto;
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    return null;
  }

  function lsGet(name) {
    try {
      if (G && G.localStorage && G.localStorage.getItem) return G.localStorage.getItem(name);
    } catch (e) {}
    return null;
  }

  function lsSet(name, value) {
    try {
      if (G && G.localStorage && G.localStorage.setItem) G.localStorage.setItem(name, String(value));
    } catch (e2) {}
  }

  function stampMs(raw) {
    var n, parsed;
    if (raw == null || raw === "") return null;
    parsed = Date.parse(String(raw));
    if (isFinite(parsed)) return parsed;
    n = Number(raw);
    if (isFinite(n)) return n;
    return null;
  }

  function utf8Encode(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(str));
    var encoded = unescape(encodeURIComponent(String(str)));
    var out = new Uint8Array(encoded.length);
    var i;
    for (i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
    return out;
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    var s = "";
    var i;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  function bytesToB64(bytes) {
    var out = "";
    var i, b0, b1, b2, n;
    n = bytes.length;
    for (i = 0; i < n; i += 3) {
      b0 = bytes[i];
      b1 = i + 1 < n ? bytes[i + 1] : 0;
      b2 = i + 2 < n ? bytes[i + 2] : 0;
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | (b1 >> 4));
      out += i + 1 < n ? B64.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
      out += i + 2 < n ? B64.charAt(b2 & 63) : "=";
    }
    return out;
  }

  function b64ToBytes(text) {
    var clean, i, n, trip, out, len, a, b, c, d;
    if (typeof text !== "string") return null;
    clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
    if (!clean.length || clean.length % 4 !== 0) return null;
    len = clean.length / 4 * 3;
    if (clean.charAt(clean.length - 1) === "=") len -= 1;
    if (clean.charAt(clean.length - 2) === "=") len -= 1;
    out = new Uint8Array(len);
    n = 0;
    for (i = 0; i < clean.length; i += 4) {
      a = B64.indexOf(clean.charAt(i));
      b = B64.indexOf(clean.charAt(i + 1));
      c = clean.charAt(i + 2) === "=" ? 0 : B64.indexOf(clean.charAt(i + 2));
      d = clean.charAt(i + 3) === "=" ? 0 : B64.indexOf(clean.charAt(i + 3));
      if (a < 0 || b < 0 || c < 0 || d < 0) return null;
      trip = (a << 18) | (b << 12) | (c << 6) | d;
      if (n < len) out[n++] = (trip >> 16) & 255;
      if (n < len) out[n++] = (trip >> 8) & 255;
      if (n < len) out[n++] = trip & 255;
    }
    return out;
  }

  function deriveKey(crypto, passphrase, salt) {
    return crypto.subtle.importKey("raw", utf8Encode(passphrase), "PBKDF2", false, ["deriveKey"]).then(function (key) {
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
        key,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    });
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function backupName(date) {
    var d = date || new Date();
    return "ResearchMD-backup-" + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + ".rmdbackup";
  }

  function store() {
    if (G && G.RMDStore) return G.RMDStore;
    if (typeof globalThis !== "undefined" && globalThis.RMDStore) return globalThis.RMDStore;
    return null;
  }

  function countsOf(data) {
    var records, images, projects, kinds, i, rec, pid, kind;
    records = (data && data.records) || [];
    images = 0;
    projects = {};
    kinds = {};
    for (i = 0; i < records.length; i++) {
      rec = records[i] || {};
      if (rec.kind === "image") images += 1;
      pid = rec.projectId == null ? "" : String(rec.projectId);
      kind = rec.kind == null ? "" : String(rec.kind);
      projects[pid] = (projects[pid] || 0) + 1;
      kinds[kind] = (kinds[kind] || 0) + 1;
    }
    return { records: records.length, images: images, projects: projects, kinds: kinds };
  }

  function toText(file) {
    if (typeof file === "string") return Promise.resolve(file);
    if (file && typeof ArrayBuffer !== "undefined" && file instanceof ArrayBuffer) {
      return Promise.resolve(utf8Decode(new Uint8Array(file)));
    }
    if (file && typeof Uint8Array !== "undefined" && file instanceof Uint8Array) {
      return Promise.resolve(utf8Decode(file));
    }
    if (file && typeof file.text === "function") return Promise.resolve(file.text());
    if (file && typeof file.arrayBuffer === "function") {
      return file.arrayBuffer().then(function (buf) {
        return utf8Decode(new Uint8Array(buf));
      });
    }
    return Promise.reject(new Error("unreadable"));
  }

  function exportFile(passphrase, opts) {
    var crypto = cryptoHost();
    var db = store();
    var include;
    if (!crypto || !db || !db.exportAll) return Promise.resolve({ ok: false, reason: "not-a-backup" });
    if (typeof passphrase !== "string") return Promise.resolve({ ok: false, reason: "not-a-backup" });
    include = !!(opts && opts.includeImages === true);
    return db.exportAll(include ? { includeImages: true } : { includeImages: false }).then(function (data) {
      var plain = utf8Encode(JSON.stringify(data));
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return deriveKey(crypto, passphrase, salt).then(function (key) {
        return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain).then(function (buf) {
          var envelope = {
            format: "rmd-backup",
            version: 1,
            kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: bytesToB64(salt) },
            cipher: { name: "AES-GCM", iv: bytesToB64(iv) },
            data: bytesToB64(new Uint8Array(buf))
          };
          var json = JSON.stringify(envelope);
          var blob = new Blob([json], { type: "application/octet-stream" });
          lsSet(BACKUP_KEY, new Date().toISOString());
          return { ok: true, blob: blob, filename: backupName(new Date()), warnings: [] };
        });
      });
    }).catch(function () {
      return { ok: false, reason: "not-a-backup" };
    });
  }

  function readFile(file, passphrase) {
    var crypto = cryptoHost();
    if (!crypto) return Promise.resolve({ ok: false, reason: "not-a-backup" });
    if (typeof passphrase !== "string") return Promise.resolve({ ok: false, reason: "wrong-passphrase" });
    return toText(file).then(function (text) {
      var env, salt, iv, dataBytes;
      try { env = JSON.parse(text); } catch (eParse) { return { ok: false, reason: "not-a-backup" }; }
      if (!env || typeof env !== "object" || env.format !== "rmd-backup") return { ok: false, reason: "not-a-backup" };
      if (typeof env.version === "number" && env.version > 1) return { ok: false, reason: "newer-version" };
      if (env.version !== 1) return { ok: false, reason: "not-a-backup" };
      if (!env.kdf || env.kdf.name !== "PBKDF2" || env.kdf.hash !== "SHA-256" || env.kdf.iterations !== ITERATIONS) {
        return { ok: false, reason: "not-a-backup" };
      }
      if (!env.cipher || env.cipher.name !== "AES-GCM") return { ok: false, reason: "not-a-backup" };
      salt = b64ToBytes(env.kdf.salt);
      iv = b64ToBytes(env.cipher.iv);
      dataBytes = b64ToBytes(env.data);
      if (!salt || salt.length !== 16 || !iv || iv.length !== 12 || !dataBytes || !dataBytes.length) {
        return { ok: false, reason: "not-a-backup" };
      }
      return deriveKey(crypto, passphrase, salt).then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, dataBytes).then(function (buf) {
          var parsed;
          try { parsed = JSON.parse(utf8Decode(new Uint8Array(buf))); } catch (eJson) {
            return { ok: false, reason: "not-a-backup" };
          }
          return { ok: true, data: parsed, counts: countsOf(parsed) };
        }).catch(function () {
          return { ok: false, reason: "wrong-passphrase" };
        });
      });
    }).catch(function () {
      return { ok: false, reason: "not-a-backup" };
    });
  }

  function restore(data, mode) {
    var db = store();
    if (!db || !db.importAll) {
      return Promise.resolve({ ok: false, added: 0, updated: 0, skipped: 0, warnings: [] });
    }
    return db.importAll(data, mode);
  }

  function isDue(now) {
    return Promise.resolve().then(function () {
      var change, backup, clock, changeMs, backupMs;
      change = lsGet(CHANGE_KEY);
      if (!change) return false;
      changeMs = stampMs(change);
      if (changeMs == null) return false;
      clock = typeof now === "number" && isFinite(now) ? now : Date.now();
      backup = lsGet(BACKUP_KEY);
      if (!backup) return (clock - changeMs) >= WEEK_MS;
      backupMs = stampMs(backup);
      if (backupMs == null) return false;
      if (!(changeMs > backupMs)) return false;
      return (clock - backupMs) >= WEEK_MS;
    });
  }

  function weeklyBanner(now) {
    return isDue(now).then(function (due) {
      if (!due) return "";
      return '<div class="rmd-banner rmd-banner-warn" role="status">Back up your research data. A week has passed since the last copy on this phone.</div>';
    });
  }

  var API = {
    exportFile: exportFile,
    readFile: readFile,
    restore: restore,
    isDue: isDue,
    weeklyBanner: weeklyBanner
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.RMDBackup = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
