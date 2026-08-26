/* surgx-backup.js — SURGX notes: backup to, and restore from, the doctor's own Google Drive.
 * =============================================================================================
 * WHY THIS EXISTS: SURGX notes are encrypted device-local and there is deliberately no note server.
 * The consequence nobody chose is that they do not survive a reinstall - and every native install
 * creates a NEW container, so `devicectl install` destroys them. Notes have already been lost that
 * way. The existing Drive destination (surgx-destinations.js) writes a READABLE .txt per note, which
 * is an export for a human, not a backup: it cannot be read back into the app.
 *
 * WHY THE BACKUP HOLDS NOTE BODIES, NOT CIPHERTEXT: surgx-store.js encrypts with a per-device,
 * per-account random secret held in localStorage. A reinstall wipes that secret, so backed-up
 * ciphertext would be permanently unreadable - a backup that cannot restore is not a backup. The
 * backup therefore carries the note JSON, into the doctor's OWN Drive, which is exactly the data
 * class and exactly the destination the shipped .txt export already writes after confirmation.
 *
 * PHI POSTURE IS UNCHANGED. Both directions are explicit, foreground and confirmed:
 *   - `confirmed:true` is required, the same contract surgx-destinations.js enforces;
 *   - nothing runs on a timer, on save, or in the background. There is still no silent upload path.
 * The patient reference never appears in the Drive FILENAME (filenames leak into search results and
 * "shared with me" lists) - same rule as driveFilename() next door.
 *
 * Restore is ADDITIVE and never destroys newer local work: a note already on the device is only
 * replaced when the backup copy is strictly newer (`updatedAt`), so restoring twice is a no-op and
 * restoring onto a working device cannot roll back this morning's edits.
 *
 * The decision helpers are pure and exported for tests; the Drive I/O is a thin shell over
 * SMD_SURGX_DEST's existing token + folder helpers, so there is only ever one Drive integration.
 * window.SMD_SURGX_BACKUP + module.exports.
 * =============================================================================================== */
(function () {
  "use strict";

  /* Resolved LAZILY, not captured at load: this file is required by node tests that install a
   * window stub afterwards, and a captured reference would be null forever. */
  function W() { try { return (typeof window !== "undefined") ? window : null; } catch (e) { return null; } }
  var BACKUP_NAME = "StewardMD-SURGX-notes-backup.json";   // ONE stable name, so a backup UPDATES
  var FORMAT = 1;
  var DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
  var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

  function DEST() { try { var w = W(); return (w && w.SMD_SURGX_DEST) || null; } catch (e) { return null; } }
  function STORE() { try { var w = W(); return (w && w.SMD_SURGX_STORE) || null; } catch (e) { return null; } }

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
      var text = JSON.stringify(doc);
      return ctx().then(function (c) {
        if (!c || !c.token) return { ok: false, error: "no_drive_account" };
        return findBackup(c.token, c.folder).then(function (existing) {
          var boundary = "smdsurgxbk" + String(now);
          var meta = existing
            ? { name: BACKUP_NAME }                                   // update in place: no new parent
            : { name: BACKUP_NAME, mimeType: "application/json", parents: c.folder ? [c.folder] : undefined };
          var url = DRIVE_UPLOAD + (existing ? "/" + existing.id : "") + "?uploadType=multipart";
          return fetch(url, {
            method: existing ? "PATCH" : "POST",
            headers: { Authorization: "Bearer " + c.token, "Content-Type": "multipart/related; boundary=" + boundary },
            body: multipart(boundary, meta, text)
          }).then(function (r) {
            if (!r.ok) return { ok: false, error: "drive_http_" + r.status };
            return { ok: true, count: notes.length, locked: locked };
          });
        });
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  /* restoreNow(opts) -> Promise<{ ok, added, replaced, skipped, error? }>  opts.confirmed MUST be true. */
  function restoreNow(opts) {
    opts = opts || {};
    if (opts.confirmed !== true) return Promise.resolve({ ok: false, error: "not_confirmed" });
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
          var parsed = parseBackup(text);
          if (!parsed.ok) return { ok: false, error: parsed.error };
          var plan = mergePlan(st.listNotes() || [], parsed.notes);
          var write = {};
          plan.add.concat(plan.replace).forEach(function (id) { write[id] = 1; });
          var todo = parsed.notes.filter(function (n) { return write[n.id]; });
          // saveNote() re-encrypts with THIS device's secret, which is the whole point: the restored
          // note becomes readable again on the new install.
          return todo.reduce(function (p, n) {
            return p.then(function () { return st.saveNote(n); });
          }, Promise.resolve()).then(function () {
            return { ok: true, added: plan.add.length, replaced: plan.replace.length, skipped: plan.skip.length };
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
    if (res.ok) return "Backed up " + res.count + " note" + (res.count === 1 ? "" : "s") + " to your Drive." +
      (res.locked ? " " + res.locked + " could not be read and were left out." : "");
    var map = {
      not_confirmed: "Confirm before sending notes to Drive.",
      store_unavailable: "SURGX did not finish loading.",
      no_crypto: "Secure storage is unavailable in this browser.",
      nothing_to_back_up: "There are no notes on this device to back up.",
      all_notes_locked: "None of the notes on this device could be read.",
      no_drive_account: "No Google Drive account is connected on this device.",
      no_backup_found: "No SURGX backup was found in your Drive.",
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
    BACKUP_NAME: BACKUP_NAME, FORMAT: FORMAT
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  /* Plain, greppable assignment: test/surgx-deeplinks.test.mjs scans the repo for `window.X =` to
   * prove no module reaches for a global nothing defines. Keep it literal. */
  if (typeof window !== "undefined") window.SMD_SURGX_BACKUP = API;
})();
