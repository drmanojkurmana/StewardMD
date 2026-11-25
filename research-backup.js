/* StewardMD - ResearchMD encrypted backup and restore (window.RMDBackup).
 * ES5 only, .then() chains, no arrow functions. Uses WebCrypto:
 * PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt; AES-GCM 256,
 * 12-byte random IV. The file holds { format: "rmd-backup", version: 1,
 * kdf: { name, hash, iterations, salt }, cipher: { name, iv }, data } with
 * salt, iv and data in base64. Nothing is uploaded: the file goes to the
 * phone's share sheet or a download. If the passphrase is lost, nobody can
 * open the backup.
 */
(function (G) {
  "use strict";

  var ITERATIONS = 600000;
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var MIN_PASS = 8;

  function P() { return G && G.Promise ? G.Promise : Promise; }
  function subtle() { return G && G.crypto && G.crypto.subtle ? G.crypto.subtle : null; }
  function store() { return G ? G.RMDStore : null; }

  function fail(msg) { return P().reject(new Error("research: " + msg)); }

  function utf8(s) {
    if (G && G.TextEncoder) return new G.TextEncoder().encode(s);
    var bin = unescape(encodeURIComponent(s)), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fromUtf8(bytes) {
    if (G && G.TextDecoder) return new G.TextDecoder().decode(bytes);
    var s = "", i;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function toB64(bytes) {
    var s = "", i, chunk = 0x8000;
    for (i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return G.btoa(s);
  }

  function fromB64(b64) {
    var s = G.atob(String(b64 || "")), out = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    G.crypto.getRandomValues(b);
    return b;
  }

  function deriveKey(passphrase, salt, iterations, usage) {
    var sc = subtle();
    return sc.importKey("raw", utf8(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]).then(function (base) {
      return sc.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations }, base,
        { name: "AES-GCM", length: 256 }, false, [usage]);
    });
  }

  function checkPassphrase(p) {
    if (typeof p !== "string" || p.length < MIN_PASS) return "The passphrase needs at least " + MIN_PASS + " characters.";
    return "";
  }

  /* encrypt(object, passphrase, opts) -> Promise of the backup file object. opts.iterations is for tests only. */
  function encrypt(obj, passphrase, opts) {
    var msg = checkPassphrase(passphrase), iterations, salt, iv;
    if (msg) return fail(msg);
    if (!subtle()) return fail("This phone cannot encrypt a backup.");
    iterations = opts && opts.iterations ? opts.iterations : ITERATIONS;
    salt = randomBytes(16);
    iv = randomBytes(12);
    return deriveKey(passphrase, salt, iterations, "encrypt").then(function (key) {
      return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, utf8(JSON.stringify(obj)));
    }).then(function (buf) {
      return {
        format: "rmd-backup", version: 1,
        kdf: { name: "PBKDF2", hash: "SHA-256", iterations: iterations, salt: toB64(salt) },
        cipher: { name: "AES-GCM", iv: toB64(iv) },
        data: toB64(new Uint8Array(buf))
      };
    });
  }

  function decrypt(file, passphrase) {
    var f = file;
    if (typeof f === "string") { try { f = JSON.parse(f); } catch (e) { return fail("This file is not a ResearchMD backup."); } }
    if (!f || f.format !== "rmd-backup" || f.version !== 1 || !f.kdf || !f.cipher || !f.data ||
      f.kdf.name !== "PBKDF2" || f.kdf.hash !== "SHA-256" || f.cipher.name !== "AES-GCM") {
      return fail("This file is not a ResearchMD backup.");
    }
    if (!subtle()) return fail("This phone cannot open an encrypted backup.");
    if (typeof passphrase !== "string" || !passphrase) return fail("Type the backup passphrase.");
    return deriveKey(passphrase, fromB64(f.kdf.salt), f.kdf.iterations, "decrypt").then(function (key) {
      return subtle().decrypt({ name: "AES-GCM", iv: fromB64(f.cipher.iv) }, key, fromB64(f.data));
    }).then(function (buf) {
      return JSON.parse(fromUtf8(new Uint8Array(buf)));
    }, function () {
      throw new Error("research: The passphrase is wrong, or the file was changed.");
    });
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function fileName(date) {
    var d = date || new Date();
    return "ResearchMD-backup-" + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + ".rmdbackup";
  }

  /* Export everything, encrypt, record the backup time and drop the old localStorage copy. */
  function makeBackup(passphrase, opts) {
    var S = store(), o = opts || {};
    if (!S) return fail("The research store is not loaded.");
    var msg = checkPassphrase(passphrase);
    if (msg) return fail(msg);
    return S.exportAll({ includeImages: !!o.includeImages }).then(function (data) {
      return encrypt(data, passphrase, o).then(function (file) {
        var counts = summarise(data);
        return { fileName: fileName(o.now), text: JSON.stringify(file), counts: counts };
      });
    });
  }

  /* Call after the file has been handed to the share sheet or saved. */
  function markBackedUp(nowIso) {
    var S = store();
    if (!S) return;
    S.lsSet("lastBackupAt", nowIso || new Date().toISOString());
    try {
      var keys = S.legacyKeys ? S.legacyKeys() : [];
      for (var i = 0; i < keys.length; i++) G.localStorage.removeItem(keys[i]);
    } catch (e) {}
  }

  function summarise(data) {
    var by = {}, out = [], i, r, k;
    var recs = data && data.records ? data.records : [];
    for (i = 0; i < recs.length; i++) {
      r = recs[i];
      if (!by[r.projectId]) by[r.projectId] = {};
      by[r.projectId][r.kind] = (by[r.projectId][r.kind] || 0) + 1;
    }
    for (k in by) { if (by.hasOwnProperty(k)) out.push({ projectId: k, kinds: by[k] }); }
    out.sort(function (a, b) { return a.projectId < b.projectId ? -1 : (a.projectId > b.projectId ? 1 : 0); });
    return { records: recs.length, projects: out };
  }

  function preview(file, passphrase) {
    return decrypt(file, passphrase).then(function (data) {
      if (!data || data.format !== "rmd-data") throw new Error("research: This backup holds no ResearchMD data.");
      return { data: data, counts: summarise(data) };
    });
  }

  function restore(file, passphrase, mode) {
    var S = store();
    if (!S) return fail("The research store is not loaded.");
    return preview(file, passphrase).then(function (p) { return S.importAll(p.data, mode === "replace" ? "replace" : "merge"); });
  }

  /* Weekly prompt: something changed since the last backup and a week has passed (or never backed up). */
  function needsPrompt(nowMs) {
    var S = store();
    if (!S) return false;
    var change = Date.parse(S.lsGet("lastChangeAt") || "");
    if (!isFinite(change)) return false;
    var last = Date.parse(S.lsGet("lastBackupAt") || "");
    if (!isFinite(last)) return true;
    var now = typeof nowMs === "number" ? nowMs : new Date().getTime();
    return change > last && now - last >= WEEK_MS;
  }

  /* Hand the file to the share sheet where it takes files, else download it. */
  function deliver(name, text) {
    var blob, file, a, url;
    try { blob = new G.Blob([text], { type: "application/octet-stream" }); } catch (e) { return fail("This phone cannot save the file."); }
    try {
      file = new G.File([blob], name, { type: "application/octet-stream" });
      if (G.navigator && G.navigator.canShare && G.navigator.canShare({ files: [file] })) {
        return G.navigator.share({ files: [file], title: name }).then(function () { return "shared"; });
      }
    } catch (e) {}
    try {
      url = G.URL.createObjectURL(blob);
      a = G.document.createElement("a");
      a.href = url; a.download = name;
      G.document.body.appendChild(a); a.click(); G.document.body.removeChild(a);
      G.setTimeout(function () { G.URL.revokeObjectURL(url); }, 4000);
      return P().resolve("downloaded");
    } catch (e2) { return fail("This phone cannot save the file."); }
  }

  var RMDBackup = {
    ITERATIONS: ITERATIONS,
    encrypt: encrypt,
    decrypt: decrypt,
    makeBackup: makeBackup,
    markBackedUp: markBackedUp,
    preview: preview,
    restore: restore,
    needsPrompt: needsPrompt,
    fileName: fileName,
    deliver: deliver,
    checkPassphrase: checkPassphrase
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = RMDBackup; }
  if (G) { G.RMDBackup = RMDBackup; }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : undefined));
