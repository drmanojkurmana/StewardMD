/* pglog-photos.js — NMC eLOGBook · clinical photographs on a logbook entry.
 * ==========================================================================================
 * A clinical photograph is the single most identifying thing a resident can put in a training
 * record, so this module is built around what must NOT happen, and the rest follows from that.
 *
 * WHERE THE IMAGE LIVES: on this device, encrypted, and nowhere else.
 *   There is no upload. `/api/pglog` has no attachment endpoint and this module does not add one.
 *   Putting patient photographs on a server is a decision for the institution and the owner, not a
 *   side effect of a logbook feature, so a photo taken here is AES-GCM encrypted with the same
 *   per-device, per-account secret SURGX notes use and stored in IndexedDB on this phone.
 *   The ENTRY records only a reference: id, mime, byte size, sha256 and the consent record. That
 *   reference is what syncs. The pixels never leave.
 *   The consequence is stated plainly in the UI and repeated here: REINSTALLING THE APP DESTROYS
 *   THESE PHOTOS, exactly as it destroys SURGX notes. Drive backup (pglog-backup.js) is the answer
 *   to that, and it encrypts them under the resident's own password before they leave.
 *
 * CONSENT IS A GATE, NOT A CHECKBOX ON A FORM.
 *   attach() REFUSES without { consent: true, deidentified: true }. There is no override, no
 *   "remember my answer", and consent is recorded per photograph with the timestamp — a blanket
 *   consent ticked once in settings is not consent for the photograph taken next Tuesday.
 *   The consent record is stored WITH the reference so an examiner or an audit can see that it was
 *   taken, and so a resident can prove it.
 *
 * DE-IDENTIFICATION IS ASSERTED BY THE RESIDENT, AND THE APP SAYS WHAT THAT MEANS.
 *   No software here can look at a photograph and tell you whether a face, a tattoo, a wristband or
 *   a ward whiteboard is in frame. Pretending otherwise would be worse than not checking. So the
 *   app states the rule (GUIDANCE below), requires the resident to assert it per photo, and strips
 *   what it CAN strip without a judgement call: all EXIF, including GPS, by re-encoding the image
 *   through a canvas. A photograph of a patient's face is never de-identified by cropping metadata,
 *   and the wording says so.
 *
 * SIZE: images are downscaled to MAX_EDGE and re-encoded as JPEG at QUALITY before encryption, both
 * because a 12 MP photograph in IndexedDB is hostile to a shared phone and because re-encoding is
 * what discards the metadata.
 *
 * window.SMD_PGLOG_PHOTOS. The pure helpers (limits, consent validation, reference shape) are
 * exported for tests; the crypto and IndexedDB paths are exercised in the browser harness.
 * ========================================================================================== */
(function () {
  "use strict";
  var G = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);

  var DB_NAME = "smd_pglog_photos", STORE = "photos", DB_VERSION = 1;
  var MAX_PER_ENTRY = 6;                 // matches pglog-model.attachment()'s own cap
  var MAX_EDGE = 1600;                   // px on the long edge after downscale
  var QUALITY = 0.72;
  var MAX_BYTES = 3 * 1024 * 1024;       // per photo, after re-encoding

  /* The wording the UI must show before the first capture. Kept here so the rule and the code that
   * enforces it cannot drift apart. */
  var GUIDANCE = [
    "Photograph the clinical finding, not the patient. Frame the lesion, the specimen, the film or the monitor.",
    "Keep faces, eyes, tattoos, name bands, case sheets, ward boards and screens with names out of the frame.",
    "Ask the patient first, in a language they understand, and tell them it is for your training record.",
    "The patient can refuse, and can ask you to delete it later. Both are their right and neither affects their care.",
    "Do not photograph a patient who cannot consent for themselves unless the person legally responsible for them agrees."
  ];
  var CONSENT_TEXT = "The patient (or the person legally responsible for them) has given consent for " +
    "this photograph to be kept in my training record, and no face or identifying detail is in the frame.";
  var STORAGE_WARNING = "Photographs stay encrypted on this phone and are never uploaded. " +
    "Reinstalling the app deletes them. Back up to your Google Drive to keep them.";

  function ls() { try { return G.localStorage || null; } catch (e) { return null; } }
  function uid() {
    try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; return (u && u.uid) || "anon"; } catch (e) { return "anon"; }
  }
  function crypto_() { try { return G.SMD_CLINIC_CRYPTO || null; } catch (e) { return null; } }
  function webcryptoOK() {
    try { return !!(G.crypto && G.crypto.subtle && G.crypto.getRandomValues && crypto_()); } catch (e) { return false; }
  }
  function secretKey() { return "smd_pglog_photo_k_" + uid(); }

  var _box = null, _boxFor = "";
  function deviceSecret() {
    var s = ls(); if (!s) return null;
    var k = secretKey(), v = null;
    try { v = s.getItem(k); } catch (e) { return null; }
    if (v) return v;
    try {
      var a = new Uint8Array(32); G.crypto.getRandomValues(a);
      var hex = ""; for (var i = 0; i < a.length; i++) hex += ("0" + a[i].toString(16)).slice(-2);
      s.setItem(k, hex); return hex;
    } catch (e) { return null; }
  }
  function box() {
    if (_box && _boxFor === uid()) return _box;
    if (!webcryptoOK()) return null;
    var secret = deviceSecret(); if (!secret) return null;
    var s = ls(), saltK = secretKey() + "_s", salt = null;
    try { salt = s.getItem(saltK); } catch (e) {}
    if (!salt) { try { salt = crypto_().newSalt(); s.setItem(saltK, salt); } catch (e) { return null; } }
    try { _box = crypto_().create(secret, salt); _boxFor = uid(); } catch (e) { return null; }
    return _box;
  }

  function available() {
    return !!(webcryptoOK() && G.indexedDB);
  }

  /* ── pure helpers (node-tested) ─────────────────────────────────────────────────────────── */

  // The only shape that reaches an entry. No filename: a camera filename can carry a patient name.
  function reference(o) {
    o = o || {};
    return {
      id: String(o.id || ""),
      mime: String(o.mime || "image/jpeg"),
      size: Number(o.size) || 0,
      sha256: String(o.sha256 || ""),
      addedAt: Number(o.addedAt) || 0,
      local: true,                                  // the pixels are on this device only
      caption: String(o.caption || "").slice(0, 160),
      consent: {
        given: o.consent && o.consent.given === true,
        deidentified: o.consent && o.consent.deidentified === true,
        at: Number(o.consent && o.consent.at) || 0,
        text: CONSENT_TEXT
      }
    };
  }

  /* Why a capture is refused, as a reason code the UI turns into a sentence. Returns "" when it may
   * proceed. Called before the camera opens AND again before the bytes are written. */
  function refuseReason(opts, existingCount) {
    opts = opts || {};
    if (!available()) return "unavailable";
    if (opts.consent !== true) return "no_consent";
    if (opts.deidentified !== true) return "not_deidentified";
    if ((existingCount || 0) >= MAX_PER_ENTRY) return "too_many";
    return "";
  }
  var REFUSAL_TEXT = {
    unavailable: "Photographs need the StewardMD app on a phone with secure storage.",
    no_consent: "Tick the consent line first. Consent is per photograph.",
    not_deidentified: "Confirm that no face or identifying detail is in the frame.",
    too_many: "Up to " + MAX_PER_ENTRY + " photographs on one entry.",
    too_large: "That image is still too large after compression. Take a closer photograph.",
    encrypt_failed: "This phone could not encrypt the photograph, so it was not saved.",
    store_failed: "The photograph could not be saved to this device."
  };
  function refusalText(code) { return REFUSAL_TEXT[code] || "The photograph was not saved."; }

  function newId() {
    var t = "0", r = "";
    try { t = String(Date.now()); } catch (e) {}
    try {
      var a = new Uint8Array(4); G.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) r += ("0" + a[i].toString(16)).slice(-2);
    } catch (e) { r = "0000"; }
    return "p" + t + r;
  }

  /* ── image pipeline ────────────────────────────────────────────────────────────────────────
   * Downscale + re-encode. The re-encode is what discards EXIF (including GPS); a canvas draw keeps
   * pixels and nothing else. Returns a data URL. */
  function normaliseImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) return reject(new Error("bad_image"));
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement("canvas"); c.width = cw; c.height = ch;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(c.toDataURL("image/jpeg", QUALITY));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error("bad_image")); };
      img.src = src;
    });
  }
  function readAsDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || "")); };
      r.onerror = function () { rej(new Error("read_failed")); };
      r.readAsDataURL(file);
    });
  }
  function sha256Hex(str) {
    try {
      var enc = new TextEncoder().encode(str);
      return G.crypto.subtle.digest("SHA-256", enc).then(function (buf) {
        var b = new Uint8Array(buf), s = "";
        for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2);
        return s;
      });
    } catch (e) { return Promise.resolve(""); }
  }

  /* ── IndexedDB ─────────────────────────────────────────────────────────────────────────── */
  function db() {
    return new Promise(function (res, rej) {
      var r;
      try { r = G.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return rej(e); }
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error("idb_open_failed")); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode), s = t.objectStore(STORE), out;
        try { out = fn(s); } catch (e) { return rej(e); }
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error || new Error("idb_tx_failed")); };
      });
    });
  }

  /* ── public ────────────────────────────────────────────────────────────────────────────── */

  /* attach(fileOrDataUrl, opts) -> Promise<{ ok, ref?, error? }>
   * opts: { entryId, consent:true, deidentified:true, caption?, existingCount? } */
  function attach(input, opts) {
    opts = opts || {};
    var why = refuseReason(opts, opts.existingCount);
    if (why) return Promise.resolve({ ok: false, error: why, message: refusalText(why) });
    var b = box();
    if (!b) return Promise.resolve({ ok: false, error: "encrypt_failed", message: refusalText("encrypt_failed") });

    var srcP = (typeof input === "string") ? Promise.resolve(input) : readAsDataUrl(input);
    return srcP.then(normaliseImage).then(function (dataUrl) {
      var bytes = Math.round((String(dataUrl).length - (String(dataUrl).indexOf(",") + 1)) * 3 / 4);
      if (bytes > MAX_BYTES) throw new Error("too_large");
      return sha256Hex(dataUrl).then(function (hash) {
        var blob = b.encrypt(dataUrl);
        return Promise.resolve(blob).then(function (cipher) {
          var id = newId(), at = Date.now();
          var rec = { id: id, entryId: String(opts.entryId || ""), owner: uid(), at: at, mime: "image/jpeg", size: bytes, sha256: hash, cipher: cipher };
          return tx("readwrite", function (s) { s.put(rec); }).then(function () {
            return { ok: true, ref: reference({
              id: id, mime: "image/jpeg", size: bytes, sha256: hash, addedAt: at, caption: opts.caption,
              consent: { given: true, deidentified: true, at: at }
            }) };
          });
        });
      });
    }).catch(function (e) {
      var code = String((e && e.message) || e) === "too_large" ? "too_large" : "store_failed";
      return { ok: false, error: code, message: refusalText(code) };
    });
  }

  // load(id) -> Promise<dataUrl|""> — decrypts on this device only.
  function load(id) {
    var b = box(); if (!b || !id) return Promise.resolve("");
    return tx("readonly", function (s) { return s.get(String(id)); }).then(function (rec) {
      if (!rec || !rec.cipher) return "";
      if (rec.owner && rec.owner !== uid()) return "";        // another account's photo on a shared phone
      return Promise.resolve(b.decrypt(rec.cipher)).then(function (d) { return String(d || ""); });
    }).catch(function () { return ""; });
  }

  function remove(id) {
    if (!id) return Promise.resolve(false);
    return tx("readwrite", function (s) { s.delete(String(id)); }).then(function () { return true; })
      .catch(function () { return false; });
  }

  // listFor(entryId) -> Promise<[{id,size,at,sha256}]> — metadata only, no decryption.
  function listFor(entryId) {
    return tx("readonly", function (s) { return s.getAll ? s.getAll() : null; }).then(function (rows) {
      var me = uid();
      return (rows || []).filter(function (r) {
        return r && r.owner === me && (!entryId || r.entryId === String(entryId));
      }).map(function (r) { return { id: r.id, size: r.size, at: r.at, sha256: r.sha256, entryId: r.entryId }; })
        .sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    }).catch(function () { return []; });
  }

  // Everything this account holds, for the Drive backup. Decrypted in memory, re-encrypted by the
  // backup under the resident's password before it leaves the device.
  function exportAll() {
    var b = box(); if (!b) return Promise.resolve([]);
    return tx("readonly", function (s) { return s.getAll ? s.getAll() : null; }).then(function (rows) {
      var me = uid();
      var mine = (rows || []).filter(function (r) { return r && r.owner === me; });
      return Promise.all(mine.map(function (r) {
        return Promise.resolve(b.decrypt(r.cipher)).then(function (d) {
          return { id: r.id, entryId: r.entryId, at: r.at, mime: r.mime, size: r.size, sha256: r.sha256, dataUrl: String(d || "") };
        }).catch(function () { return null; });
      })).then(function (list) { return list.filter(Boolean); });
    }).catch(function () { return []; });
  }
  // The other half of the round trip: put a backed-up photo back on a fresh device.
  function importOne(rec) {
    var b = box(); if (!b || !rec || !rec.dataUrl) return Promise.resolve(false);
    return Promise.resolve(b.encrypt(rec.dataUrl)).then(function (cipher) {
      return tx("readwrite", function (s) {
        s.put({ id: rec.id, entryId: rec.entryId || "", owner: uid(), at: rec.at || Date.now(),
          mime: rec.mime || "image/jpeg", size: rec.size || 0, sha256: rec.sha256 || "", cipher: cipher });
      }).then(function () { return true; });
    }).catch(function () { return false; });
  }

  var API = {
    available: available, attach: attach, load: load, remove: remove, listFor: listFor,
    exportAll: exportAll, importOne: importOne,
    // pure, for tests + the UI's own wording
    reference: reference, refuseReason: refuseReason, refusalText: refusalText,
    GUIDANCE: GUIDANCE, CONSENT_TEXT: CONSENT_TEXT, STORAGE_WARNING: STORAGE_WARNING,
    MAX_PER_ENTRY: MAX_PER_ENTRY, MAX_EDGE: MAX_EDGE, MAX_BYTES: MAX_BYTES
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_PHOTOS = API;
})();
