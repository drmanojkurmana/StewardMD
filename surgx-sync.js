/* surgx-sync.js — encrypted Google Drive backup and restore for SURGX notes.
 *
 * THE PROBLEM THIS SOLVES. SURGX notes were the only clinical data in the app with no copy
 * anywhere. surgx-store.js encrypts them with a PER-DEVICE RANDOM SECRET (deviceSecret(), 32 bytes
 * in localStorage) and there is no server record, so:
 *   - reinstalling the app makes a new container and destroys them (CLAUDE.md records this costing
 *     a linked note twice in one session);
 *   - the sign-out wipe, once it actually started running (2026-08-26), destroys them too.
 *
 * WHY THE LOCAL CIPHERTEXT CANNOT JUST BE UPLOADED. The device secret exists nowhere but that
 * phone. Uploading blobs encrypted under it would produce a backup no other device could ever
 * read - a backup that looks like insurance and is worthless when claimed. So the backup is
 * re-encrypted under a PASSWORD-derived key the surgeon can reproduce on a new phone.
 *
 * REUSED, NOT REINVENTED. The password scheme is personal-clinic.js's encryptBackup/decryptBackup
 * (PBKDF2-SHA256 200k -> AES-GCM 256), already shipping for My Clinic, and the same clinic backup
 * password from the Keychain. One password for the doctor, one crypto scheme to review, and no
 * second implementation to drift. The Drive token is native-auth's SMD_getDriveToken (drive.file
 * scope). This file adds no new auth and no new cryptography.
 *
 * PHI POSTURE. Notes carry patient identifiers, so:
 *   - the whole feature is OFF until the surgeon turns it on (smd_surgx_drive_backup, def false).
 *     An app upgrade must never silently start uploading operative notes;
 *   - what leaves the device is ciphertext only. Google stores an opaque blob; the key is derived
 *     from a password that never leaves the phone;
 *   - ONE file, overwritten in place, so Drive never accumulates a history of operative notes;
 *   - nothing here logs a note body, a label, or a patient reference.
 *
 * LOCAL REMAINS THE SYSTEM OF RECORD. Drive is never read during normal use; it is read only by an
 * explicit restore. A restore MERGES and is newest-wins per note, so it can never overwrite work
 * done on the phone since the backup was taken.
 *
 * Dual export: module.exports for node tests, window.SMD_SURGX_SYNC for the browser. Every
 * transport is injectable so the rules above are tested without a network or a Google account.
 */
(function () {
  "use strict";
  var G = (typeof globalThis !== "undefined") ? globalThis
    : (typeof window !== "undefined") ? window : this;

  var DRIVE_FILE = "stewardmd-surgx-notes.smdbak";
  var SYNC_DEBOUNCE_MS = 15000;

  function ls() { try { return G && G.localStorage ? G.localStorage : null; } catch (e) { return null; } }

  /* PER-ACCOUNT, mirroring surgx-store.js's uid(). Both of these MUST be account-scoped:
   *   - the opt-in: a global flag would mean the next person to sign in on this device inherits
   *     "backup on" and their operative notes start uploading to THEIR Drive without them ever
   *     agreeing to it;
   *   - the last-backup stamp: a global one would tell the next person "you have a backup you can
   *     restore from" when they have nothing of the sort.
   * This is the same shared-device trap the sign-out wipe was written for. */
  function uid() {
    try {
      var a = JSON.parse((ls() && ls().getItem("stewardmd_account")) || "null");
      return (a && (a.uid || a.email)) || "guest";
    } catch (e) { return "guest"; }
  }
  function lastKey() { return "smd_surgx_lastbackup_" + uid(); }
  function autoKey() { return "smd_surgx_autosync_" + uid(); }
  function clinic() { try { return G.SMD_CLINIC || null; } catch (e) { return null; } }
  function store() { try { return G.SMD_SURGX_STORE || null; } catch (e) { return null; } }
  function flagOn() {
    try { return !!(G.SMD_SURGX_FLAGS && G.SMD_SURGX_FLAGS.bool("smd_surgx_drive_backup")); }
    catch (e) { return false; }
  }

  /* ---- pure payload rules (node-tested) ---------------------------------- */

  /* Self-identifying, because My Clinic backups use the SAME {smd_enc:1} envelope and the same
   * decryptBackup will happily open one. Only the payload can tell a clinic export from a note
   * export, and restoring the wrong one would silently mix a surgeon's data. */
  function buildPayload(notes) {
    var at = 0; try { at = Date.now(); } catch (e) {}
    return JSON.stringify({ surgx: 1, v: 1, at: at, notes: notes || [] });
  }

  function parsePayload(text) {
    var o;
    try { o = JSON.parse(String(text || "")); }
    catch (e) { throw new Error("unreadable_backup"); }
    if (!o || o.surgx !== 1 || !Array.isArray(o.notes)) {
      throw new Error("not_surgx_backup");
    }
    return o.notes;
  }

  /* Newest-wins per note id, and a UNION - never a replacement. A restore that dropped a note the
   * phone had but the backup did not would turn "recover my notes" into "lose my notes".
   * A missing updatedAt counts as 0, so undated data can never displace a dated local note. */
  function stamp(n) { var v = n && n.updatedAt; return typeof v === "number" ? v : 0; }
  function mergeNotes(local, incoming) {
    var by = {}, order = [], i, n;
    for (i = 0; i < (local || []).length; i++) {
      n = local[i]; if (!n || !n.id) continue;
      if (!(n.id in by)) order.push(n.id);
      by[n.id] = n;
    }
    for (i = 0; i < (incoming || []).length; i++) {
      n = incoming[i]; if (!n || !n.id) continue;
      if (!(n.id in by)) { order.push(n.id); by[n.id] = n; continue; }
      if (stamp(n) > stamp(by[n.id])) by[n.id] = n;
    }
    var out = [];
    for (i = 0; i < order.length; i++) out.push(by[order[i]]);
    return out;
  }

  /* ---- device pieces the transports need --------------------------------- */

  function password() {
    var c = clinic();
    if (c && c.getPassword) { try { return Promise.resolve(c.getPassword()); } catch (e) {} }
    return Promise.resolve(null);
  }

  var _tok = null, _tokAt = 0;
  function driveToken() {
    try { if (_tok && (Date.now() - _tokAt) < 50 * 60 * 1000) return Promise.resolve(_tok); } catch (e) {}
    try {
      if (G.SMD_getDriveToken) {
        return Promise.resolve(G.SMD_getDriveToken()).then(function (t) {
          if (t) { _tok = t; try { _tokAt = Date.now(); } catch (e) {} }
          return t;
        });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  /* Every note, decrypted from the device store, ready to be re-encrypted under the password.
   * A note that will not decrypt (a locked row) is SKIPPED, never written as an empty note - a
   * blank note in a backup is worse than an absent one. */
  function localNotes() {
    var s = store();
    if (!s || !s.listNotes || !s.loadNote) return Promise.resolve([]);
    var index = s.listNotes() || [];
    var out = [];
    return index.reduce(function (chain, row) {
      return chain.then(function () {
        return Promise.resolve(s.loadNote(row.id)).then(function (n) { if (n) out.push(n); })
          .catch(function () {});
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  function encryptWith(pw, text) {
    var c = clinic();
    if (!c || !c.encryptBackup) return Promise.reject(new Error("no_crypto"));
    return c.encryptBackup(text, pw);
  }
  function decryptWith(pw, env) {
    var c = clinic();
    if (!c || !c.decryptBackup) return Promise.reject(new Error("no_crypto"));
    return c.decryptBackup(env, pw);
  }

  /* ONE file, created once then PATCHed in place. Drive must not accumulate a series of operative
   * note backups; the current state is the only thing worth keeping. */
  function findFileId(token) {
    var q = encodeURIComponent("name='" + DRIVE_FILE + "' and trashed=false");
    return fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&fields=files(id)", {
      headers: { "Authorization": "Bearer " + token }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.files && j.files[0] && j.files[0].id) || null; })
      .catch(function () { return null; });
  }

  function uploadEnvelope(token, envelope) {
    return findFileId(token).then(function (id) {
      var boundary = "smdsgx" + (function () { try { return Date.now(); } catch (e) { return 0; } })();
      var meta = id ? {} : { name: DRIVE_FILE, description: "StewardMD SURGX encrypted note backup" };
      var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
        JSON.stringify(meta) + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" +
        envelope + "\r\n--" + boundary + "--";
      var url = id
        ? "https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=multipart"
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
      return fetch(url, {
        method: id ? "PATCH" : "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary },
        body: body
      }).then(function (r) { return r.ok ? { ok: true } : { ok: false, error: "http_" + r.status }; });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  function downloadEnvelope(token) {
    return findFileId(token).then(function (id) {
      if (!id) return null;
      return fetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", {
        headers: { "Authorization": "Bearer " + token }
      }).then(function (r) { return r.ok ? r.text() : null; });
    }).catch(function () { return null; });
  }

  /* ---- sync ---------------------------------------------------------------
   * Every dependency is injectable. The defaults are the real device ones; the tests pass their
   * own so the rules above are verified without a network or a Google account. */

  function syncNow(deps) {
    deps = deps || {};
    var getPw = ("password" in deps) ? Promise.resolve(deps.password) : password();
    var getTok = ("token" in deps) ? Promise.resolve(deps.token) : driveToken();
    var notesFn = deps.notes || localNotes;
    var enc = deps.encrypt || null;
    var up = deps.upload || null;

    return Promise.all([getPw, getTok]).then(function (a) {
      var pw = a[0], token = a[1];
      if (!pw) return { ok: false, error: "no_password" };
      if (!token) return { ok: false, error: "no_token" };
      return Promise.resolve(notesFn()).then(function (notes) {
        notes = notes || [];
        // Nothing to protect: do not create a Drive file for an empty note list, and above all do
        // not overwrite an existing backup with an empty one.
        if (!notes.length) return { ok: true, skipped: "empty" };
        var payload = buildPayload(notes);
        return (enc ? enc(payload, pw) : encryptWith(pw, payload)).then(function (envelope) {
          return (up ? up(envelope, token) : uploadEnvelope(token, envelope));
        }).then(function (r) {
          if (r && r.ok) markBackup();
          return r && r.ok ? { ok: true, count: notes.length } : { ok: false, error: (r && r.error) || "upload_failed" };
        });
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  function restore(deps) {
    deps = deps || {};
    var getPw = ("password" in deps) ? Promise.resolve(deps.password) : password();
    var getTok = ("token" in deps) ? Promise.resolve(deps.token) : driveToken();
    var down = deps.download || null;
    var dec = deps.decrypt || null;
    var notesFn = deps.notes || localNotes;
    var saveFn = deps.saveNote || function (n) {
      var s = store();
      return s && s.saveNote ? s.saveNote(n) : Promise.resolve({ ok: false });
    };

    return Promise.all([getPw, getTok]).then(function (a) {
      var pw = a[0], token = a[1];
      if (!pw) return { ok: false, error: "no_password" };
      if (!token) return { ok: false, error: "no_token" };
      return Promise.resolve(down ? down(token) : downloadEnvelope(token)).then(function (env) {
        if (!env) return { ok: false, error: "no_backup" };
        return Promise.resolve(dec ? dec(env, pw) : decryptWith(pw, env))
          .catch(function () { throw new Error("wrong_password"); })
          .then(function (plain) {
            // parsePayload throws BEFORE anything is written, so a clinic backup or a corrupt file
            // can never half-import.
            var incoming = parsePayload(plain);
            return Promise.resolve(notesFn()).then(function (local) {
              local = local || [];
              var have = {};
              for (var i = 0; i < local.length; i++) if (local[i] && local[i].id) have[local[i].id] = local[i];
              var merged = mergeNotes(local, incoming);
              // Write ONLY what actually changed: a restore should not rewrite (and re-timestamp)
              // every note the device already had.
              var toWrite = merged.filter(function (n) {
                var cur = have[n.id];
                return !cur || stamp(n) > stamp(cur);
              });
              return toWrite.reduce(function (chain, n) {
                return chain.then(function () { return Promise.resolve(saveFn(n)); });
              }, Promise.resolve()).then(function () {
                markBackup();
                return { ok: true, restored: toWrite.length, total: merged.length };
              });
            });
          });
      });
    }).catch(function (e) {
      var m = String((e && e.message) || e);
      return { ok: false, error: m };
    });
  }

  /* ---- auto-sync ----------------------------------------------------------
   * Debounced so a burst of edits in one operation coalesces into a single upload, and silent -
   * a backup that toasts on every save trains the surgeon to ignore it. Only ever runs when the
   * feature flag AND the per-device toggle are both on. */
  var _tmr = null;
  function autoSyncOn() {
    if (!flagOn()) return false;
    try { var s = ls(); return !s || s.getItem(autoKey()) === "1"; } catch (e) { return false; }
  }
  function setAutoSync(on) {
    try { var s = ls(); if (s) s.setItem(autoKey(), on ? "1" : "0"); } catch (e) {}
  }
  function scheduleSync() {
    if (!autoSyncOn()) return;
    if (_tmr) { try { clearTimeout(_tmr); } catch (e) {} }
    _tmr = setTimeout(function () { _tmr = null; syncNow(); }, SYNC_DEBOUNCE_MS);
  }

  function lastBackupAt() { try { return +((ls() && ls().getItem(lastKey())) || 0); } catch (e) { return 0; } }
  function markBackup() { try { var s = ls(); if (s) s.setItem(lastKey(), String(Date.now())); } catch (e) {} }
  function hasBackup() { return lastBackupAt() > 0; }

  var API = {
    buildPayload: buildPayload, parsePayload: parsePayload, mergeNotes: mergeNotes,
    syncNow: syncNow, restore: restore,
    scheduleSync: scheduleSync, autoSyncOn: autoSyncOn, setAutoSync: setAutoSync,
    lastBackupAt: lastBackupAt, hasBackup: hasBackup, flagOn: flagOn,
    DRIVE_FILE: DRIVE_FILE
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SURGX_SYNC = API;
})();
