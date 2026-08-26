/* surgx-backup.js — SURGX notes: END-TO-END ENCRYPTED backup to the surgeon's own Google Drive.
 * =============================================================================================
 * WHY THIS EXISTS: SURGX notes are encrypted device-local and there is deliberately no note server.
 * The consequence nobody chose is that they do not survive a reinstall - every native install
 * creates a NEW container, so `devicectl install` destroys them. Notes have already been lost that
 * way. The shipped Drive destination writes a READABLE .txt per note: an export for a human, which
 * the app cannot read back.
 *
 * THE BACKUP FILE IS USELESS TO EVERYONE BUT THIS APP, WITH THIS PASSWORD.
 * The WhatsApp model, and the same primitives the rest of StewardMD already uses:
 *   password --PBKDF2-SHA256, 200k, per-backup random 16-byte salt--> AES-256-GCM key
 * The notes are encrypted BEFORE they leave the device. Google stores ciphertext. StewardMD never
 * sees the password and stores it nowhere - there is no escrow, no recovery, no server copy.
 * **If the password is lost the backup is unrecoverable, by design.** The UI says so before the
 * first backup, and the password is confirmed twice, because a typo would otherwise be silent and
 * permanent.
 *
 * Only these fields are OUTSIDE the ciphertext, and only because a restore cannot begin without
 * them: the envelope version, the KDF parameters, the salt, and a timestamp so the UI can say when
 * the last backup ran without asking for the password. No note text, no label, no count, no patient
 * reference, no account id. The filename carries no identifier either - Drive filenames surface in
 * search results and "shared with me" lists.
 *
 * A PLAINTEXT BACKUP IS REFUSED ON READ. There is no unencrypted format to fall back to, so the app
 * cannot be handed a hand-written file and asked to import it.
 *
 * WHY IT HOLDS NOTE BODIES AND NOT THE DEVICE CIPHERTEXT: surgx-store.js encrypts with a per-device,
 * per-account random secret in localStorage. A reinstall wipes that secret - the very event this
 * backup exists to survive - so device ciphertext would be permanently unreadable. The bodies are
 * re-encrypted here under the password, and restoring re-encrypts them under the NEW device secret.
 *
 * PHI POSTURE UNCHANGED. Both directions need `confirmed:true` plus a password, nothing runs on a
 * timer or in the background, and there is still no silent upload path.
 *
 * Restore is ADDITIVE: a note already on the device is replaced only when the backup copy is
 * strictly newer (`updatedAt`), so restoring twice is a no-op and a restore cannot roll back newer
 * local work.
 *
 * Decision helpers are pure and exported for tests; Drive I/O is a thin shell over
 * SMD_SURGX_DEST's existing token + folder helpers, so there is only ever one Drive integration.
 * window.SMD_SURGX_BACKUP + module.exports.
 * =============================================================================================== */
(function () {
  "use strict";

  /* Resolved LAZILY, not captured at load: this file is required by node tests that install a
   * window stub afterwards, and a captured reference would be null forever. */
  function W() { try { return (typeof window !== "undefined") ? window : null; } catch (e) { return null; } }
  var BACKUP_NAME = "StewardMD-SURGX-notes-backup.smdbk";  // ONE stable name, so a backup UPDATES
  var FORMAT = 1;            // the INNER note-set document (inside the ciphertext)
  var ENVELOPE = 2;          // the FILE that lands in Drive: encrypted, never plaintext
  var KDF = { name: "PBKDF2", hash: "SHA-256", iterations: 200000 };
  var MIN_PASSWORD = 8;
  var DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
  var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

  function DEST() { try { var w = W(); return (w && w.SMD_SURGX_DEST) || null; } catch (e) { return null; } }
  function STORE() { try { var w = W(); return (w && w.SMD_SURGX_STORE) || null; } catch (e) { return null; } }
  /* The app's existing PBKDF2-SHA256 200k -> AES-256-GCM adapter. Reused rather than re-implemented:
   * there is exactly one place in this codebase that decides how StewardMD derives a key. */
  function CRYPTO() { try { var w = W(); return (w && w.SMD_CLINIC_CRYPTO) || null; } catch (e) { return null; } }
  function cryptoBox() { var c = CRYPTO(); return (c && c.create && c.newSalt) ? c : null; }

  /* ── pure ──────────────────────────────────────────────────────────────────────────────────── */

  /* The backup document. `notes` are full note bodies as surgx-store.loadNote() returns them. */
  function buildBackup(notes, meta) {
    meta = meta || {};
    var kept = (notes || []).filter(Boolean);
    return {
      format: FORMAT,
      app: "StewardMD SURGX",
      uid: meta.uid || "",
      exportedAt: meta.now || 0,
      count: kept.length,      // what is actually in the file, not what was offered
      notes: kept
    };
  }

  /* Parse + validate. Returns { ok, notes, error } - never throws, because a corrupt or unrelated
   * file in the folder must produce a clear message, not a crash mid-restore. */
  function parseBackup(text) {
    var d = null;
    try { d = JSON.parse(String(text || "")); } catch (e) { return { ok: false, notes: [], error: "not_json" }; }
    if (!d || typeof d !== "object") return { ok: false, notes: [], error: "not_json" };
    if (Number(d.format) !== FORMAT) return { ok: false, notes: [], error: "unsupported_format" };
    if (!d.notes || Object.prototype.toString.call(d.notes) !== "[object Array]") return { ok: false, notes: [], error: "no_notes" };
    var notes = d.notes.filter(function (n) { return n && n.id && n.type; });
    return { ok: true, notes: notes, error: "" };
  }

  /* A typo here is permanent: nobody can recover the backup, so refuse a password too short to be
   * worth protecting and refuse whitespace padding that the surgeon will not reproduce later. */
  function checkPassword(pw) {
    var p = String(pw == null ? "" : pw);
    if (!p) return { ok: false, error: "password_required" };
    if (p !== p.trim()) return { ok: false, error: "password_padded" };
    if (p.length < MIN_PASSWORD) return { ok: false, error: "weak_password" };
    return { ok: true, error: "" };
  }

  /* The FILE that lands in Drive. Everything identifying is inside `payload`; what is left outside
   * is only what a restore needs before it can derive a key, plus a timestamp for the UI. */
  function wrapEnvelope(saltB64, payloadBlob, meta) {
    meta = meta || {};
    return {
      format: ENVELOPE,
      app: "StewardMD SURGX",
      enc: "password",
      kdf: { name: KDF.name, hash: KDF.hash, iterations: KDF.iterations },
      salt: saltB64,
      exportedAt: meta.now || 0,
      payload: payloadBlob
    };
  }

  /* Read the envelope WITHOUT the password. Refuses anything that is not our encrypted format -
   * notably a plaintext note dump, which must never be importable. */
  function parseEnvelope(text) {
    var d = null;
    try { d = JSON.parse(String(text || "")); } catch (e) { return { ok: false, error: "not_json" }; }
    if (!d || typeof d !== "object") return { ok: false, error: "not_json" };
    var fmt = Number(d.format);
    if (fmt !== ENVELOPE) {
      // Three distinct situations, and the surgeon deserves to be told which:
      //   no version at all -> not a StewardMD backup;
      //   an OLDER version  -> the pre-encryption plaintext shape, refused rather than imported
      //                        (nothing may read PHI the owner believes is protected, and a
      //                         hand-written file must never be importable);
      //   a NEWER version   -> written by a build this one cannot read.
      if (!fmt) return { ok: false, error: "malformed_backup" };
      return { ok: false, error: fmt < ENVELOPE ? "plaintext_refused" : "unsupported_format" };
    }
    if (d.enc !== "password" || !d.salt || !d.payload) return { ok: false, error: "malformed_backup" };
    var it = d.kdf && Number(d.kdf.iterations);
    // Never derive with weaker parameters than we write, however the file asks.
    if (!it || it < KDF.iterations) return { ok: false, error: "weak_kdf_refused" };
    return { ok: true, salt: d.salt, payload: d.payload, exportedAt: Number(d.exportedAt) || 0, error: "" };
  }

  /* Decide what a restore should do, WITHOUT touching storage.
   * `localIndex` is surgx-store.listNotes() (id + updatedAt). Returns { add, replace, skip } of ids.
   * Newer-wins, and equal timestamps SKIP so a repeat restore rewrites nothing. */
  function mergePlan(localIndex, backupNotes) {
    var have = {};
    (localIndex || []).forEach(function (r) { if (r && r.id) have[r.id] = Number(r.updatedAt) || 0; });
    var plan = { add: [], replace: [], skip: [] };
    (backupNotes || []).forEach(function (n) {
      if (!n || !n.id) return;
      if (!Object.prototype.hasOwnProperty.call(have, n.id)) { plan.add.push(n.id); return; }
      if ((Number(n.updatedAt) || 0) > have[n.id]) plan.replace.push(n.id);
      else plan.skip.push(n.id);
    });
    return plan;
  }

  /* ── Drive I/O ─────────────────────────────────────────────────────────────────────────────── */

  function multipart(boundary, meta, text) {
    return "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(meta) + "\r\n--" + boundary +
      "\r\nContent-Type: application/json\r\n\r\n" + text + "\r\n--" + boundary + "--";
  }
  function ctx() {
    var d = DEST();
    if (!d || !d.driveToken || !d.driveFolderId) return Promise.resolve(null);
    return Promise.resolve(d.driveToken()).then(function (token) {
      if (!token) return null;
      return Promise.resolve(d.driveFolderId(token)).then(function (folder) { return { token: token, folder: folder }; });
    });
  }
  /* The existing backup file's id, or "" - so a second backup REPLACES rather than piling copies. */
  function findBackup(token, folder) {
    var q = encodeURIComponent("name='" + BACKUP_NAME + "' and trashed=false" + (folder ? " and '" + folder + "' in parents" : ""));
    return fetch(DRIVE_FILES + "?q=" + q + "&spaces=drive&fields=files(id,modifiedTime)", {
      headers: { Authorization: "Bearer " + token }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { var f = j && j.files && j.files[0]; return f ? { id: f.id, modifiedTime: f.modifiedTime || "" } : null; })
      .catch(function () { return null; });
  }

  /* backupNow(opts) -> Promise<{ ok, count?, error? }>   opts.confirmed MUST be true. */
  function backupNow(opts) {
    opts = opts || {};
    if (opts.confirmed !== true) return Promise.resolve({ ok: false, error: "not_confirmed" });
    var pw = checkPassword(opts.password);
    if (!pw.ok) return Promise.resolve({ ok: false, error: pw.error });
    if (!cryptoBox()) return Promise.resolve({ ok: false, error: "no_crypto" });
    var st = STORE();
    if (!st) return Promise.resolve({ ok: false, error: "store_unavailable" });
    if (!st.cryptoAvailable()) return Promise.resolve({ ok: false, error: "no_crypto" });

    var index = st.listNotes() || [];
    if (!index.length) return Promise.resolve({ ok: false, error: "nothing_to_back_up" });

    return Promise.all(index.map(function (r) { return st.loadNote(r.id); })).then(function (bodies) {
      var notes = bodies.filter(Boolean);
      // A note whose row will not decrypt is reported, never silently dropped from a "complete" backup.
      var locked = index.length - notes.length;
      if (!notes.length) return { ok: false, error: "all_notes_locked" };
      var now = 0; try { now = Date.now(); } catch (e) {}
      var doc = buildBackup(notes, { uid: st.uid ? st.uid() : "", now: now });

      /* ENCRYPT BEFORE IT LEAVES THE DEVICE. A fresh salt per backup, so two backups of the same
       * notes under the same password are not byte-identical and nothing is reusable across them. */
      var box = cryptoBox().create(opts.password, cryptoBox().newSalt());
      return box.encrypt(JSON.stringify(doc)).then(function (payload) {
        var envelope = JSON.stringify(wrapEnvelope(box.salt, payload, { now: now }));
        return ctx().then(function (c) {
          if (!c || !c.token) return { ok: false, error: "no_drive_account" };
          return findBackup(c.token, c.folder).then(function (existing) {
            var boundary = "smdsurgxbk" + String(now);
            var meta = existing
              ? { name: BACKUP_NAME }                                   // update in place: no new parent
              : { name: BACKUP_NAME, mimeType: "application/octet-stream", parents: c.folder ? [c.folder] : undefined };
            var url = DRIVE_UPLOAD + (existing ? "/" + existing.id : "") + "?uploadType=multipart";
            return fetch(url, {
              method: existing ? "PATCH" : "POST",
              headers: { Authorization: "Bearer " + c.token, "Content-Type": "multipart/related; boundary=" + boundary },
              body: multipart(boundary, meta, envelope)
            }).then(function (r) {
              if (!r.ok) return { ok: false, error: "drive_http_" + r.status };
              return { ok: true, count: notes.length, locked: locked, encrypted: true };
            });
          });
        });
      }, function () { return { ok: false, error: "encrypt_failed" }; });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  /* restoreNow(opts) -> Promise<{ ok, added, replaced, skipped, error? }>  opts.confirmed MUST be true. */
  function restoreNow(opts) {
    opts = opts || {};
    if (opts.confirmed !== true) return Promise.resolve({ ok: false, error: "not_confirmed" });
    if (!String(opts.password || "")) return Promise.resolve({ ok: false, error: "password_required" });
    if (!cryptoBox()) return Promise.resolve({ ok: false, error: "no_crypto" });
    var st = STORE();
    if (!st) return Promise.resolve({ ok: false, error: "store_unavailable" });
    if (!st.cryptoAvailable()) return Promise.resolve({ ok: false, error: "no_crypto" });

    return ctx().then(function (c) {
      if (!c || !c.token) return { ok: false, error: "no_drive_account" };
      return findBackup(c.token, c.folder).then(function (existing) {
        if (!existing) return { ok: false, error: "no_backup_found" };
        return fetch(DRIVE_FILES + "/" + existing.id + "?alt=media", {
          headers: { Authorization: "Bearer " + c.token }
        }).then(function (r) { return r.ok ? r.text() : null; }).then(function (text) {
          if (text == null) return { ok: false, error: "download_failed" };
          var env = parseEnvelope(text);
          if (!env.ok) return { ok: false, error: env.error };
          /* Derive with the SALT AND ITERATIONS THE FILE CARRIES (already floored at our own
           * strength by parseEnvelope). AES-GCM authenticates, so a wrong password cannot yield
           * plausible-looking notes: it fails the tag and we say so. */
          return cryptoBox().create(opts.password, env.salt).decrypt(env.payload).then(function (plain) {
            var parsed = parseBackup(plain);
            if (!parsed.ok) return { ok: false, error: parsed.error };
            var plan = mergePlan(st.listNotes() || [], parsed.notes);
            var write = {};
            plan.add.concat(plan.replace).forEach(function (id) { write[id] = 1; });
            var todo = parsed.notes.filter(function (n) { return write[n.id]; });
            // saveNote() re-encrypts with THIS device's secret, which is the whole point: the
            // restored note becomes readable again on the new install.
            return todo.reduce(function (p, n) {
              return p.then(function () { return st.saveNote(n); });
            }, Promise.resolve()).then(function () {
              return { ok: true, added: plan.add.length, replaced: plan.replace.length, skipped: plan.skip.length };
            });
          }, function () {
            // The only realistic causes are a wrong password or a damaged file, and we cannot tell
            // them apart without weakening the format. Say the likely one, mention the other.
            return { ok: false, error: "wrong_password" };
          });
        });
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  /* Is the backup offered at all? Native-only, because SMD_getDriveToken is null on the web build. */
  function available() {
    try {
      var st = STORE();
      if (!st || !st.cryptoAvailable()) return { ok: false, reason: "Secure storage is unavailable in this browser." };
      if (!cryptoBox()) return { ok: false, reason: "Encryption is unavailable in this browser, so a backup cannot be protected." };
      var w = W();
      if (!(w && w.SMD_getDriveToken)) return { ok: false, reason: "Only available in the installed app, not the web preview." };
      return { ok: true, reason: "" };
    } catch (e) { return { ok: false, reason: "Unavailable." }; }
  }

  /* Human-readable outcome, so the UI never has to know the error vocabulary. */
  function describe(res) {
    if (!res) return "Something went wrong.";
    if (res.ok && typeof res.added === "number") {
      if (!res.added && !res.replaced) return "Already up to date. Nothing to restore.";
      return "Restored " + res.added + " note" + (res.added === 1 ? "" : "s") +
        (res.replaced ? " and updated " + res.replaced : "") + ".";
    }
    if (res.ok) return "Backed up " + res.count + " note" + (res.count === 1 ? "" : "s") +
      ", encrypted with your password, to your Drive." +
      (res.locked ? " " + res.locked + " could not be read and were left out." : "");
    var map = {
      not_confirmed: "Confirm before sending notes to Drive.",
      store_unavailable: "SURGX did not finish loading.",
      no_crypto: "Secure storage is unavailable in this browser.",
      nothing_to_back_up: "There are no notes on this device to back up.",
      all_notes_locked: "None of the notes on this device could be read.",
      no_drive_account: "No Google Drive account is connected on this device.",
      no_backup_found: "No SURGX backup was found in your Drive.",
      password_required: "Enter your backup password.",
      weak_password: "Use at least 8 characters, so the backup is worth protecting.",
      password_padded: "Remove the spaces at the start or end - they are easy to lose later.",
      wrong_password: "That password did not unlock the backup. Check it and try again; if it is definitely right, the file may be damaged.",
      encrypt_failed: "The notes could not be encrypted, so nothing was sent.",
      plaintext_refused: "That file is not an encrypted StewardMD backup, so it will not be imported.",
      malformed_backup: "That backup file is not a StewardMD backup.",
      weak_kdf_refused: "That backup was protected more weakly than StewardMD allows, so it was refused.",
      download_failed: "The backup could not be downloaded.",
      not_json: "That backup file is not readable.",
      unsupported_format: "That backup was written by a newer version of StewardMD.",
      no_notes: "That backup contains no notes."
    };
    return map[res.error] || ("Could not finish: " + String(res.error || "unknown error") + ".");
  }

  var API = {
    backupNow: backupNow, restoreNow: restoreNow, available: available, describe: describe,
    // pure, for tests
    buildBackup: buildBackup, parseBackup: parseBackup, mergePlan: mergePlan,
    checkPassword: checkPassword, wrapEnvelope: wrapEnvelope, parseEnvelope: parseEnvelope,
    BACKUP_NAME: BACKUP_NAME, FORMAT: FORMAT, ENVELOPE: ENVELOPE, MIN_PASSWORD: MIN_PASSWORD
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  /* Plain, greppable assignment: test/surgx-deeplinks.test.mjs scans the repo for `window.X =` to
   * prove no module reaches for a global nothing defines. Keep it literal. */
  if (typeof window !== "undefined") window.SMD_SURGX_BACKUP = API;
})();
