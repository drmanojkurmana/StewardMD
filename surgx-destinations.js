/* surgx-destinations.js — where a finalised surgical note can go.
 *
 * Three destinations, offered as one picker in the Notes screen:
 *   local  — the device, AES-256-GCM via surgx-store.js. Always the SYSTEM OF RECORD.
 *   drive  — the doctor's own Google Drive, as a readable document.
 *   emr    — the hospital EMR (GITAM GHIS).
 *
 * LOCAL ALWAYS HAPPENS FIRST AND ALWAYS HAPPENS. Drive and EMR are exports layered on top of a
 * successful local save, never alternatives to it: if an upload fails, times out, or the token is
 * refused, the note is already safely on the device. A destination picker that could lose an
 * operative note because the network blinked would be a worse product than no picker at all.
 *
 * PHI: a surgical note carries patient identifiers (patientRef is required and phi:true in
 * surgx-note-schema.js). Sending one anywhere off-device is a real disclosure, so:
 *   - every non-local destination requires an explicit per-save confirmation from the caller
 *     (confirmed:true) - there is no silent/auto/background upload path in this file;
 *   - nothing here writes to telemetry or logs the note body, the patient reference, or the
 *     rendered text. Error strings are transport-level only.
 *
 * Reuses, never reimplements: window.SMD_getDriveToken (native drive.file token, the same source
 * personal-clinic.js and clinic-drive.js use) and window.GHIS.getToken() (the ONE shared GHIS
 * session). This file adds no new auth.
 *
 * Dual export: module.exports for node tests, window.SMD_SURGX_DEST for the browser. The pure
 * parts (availability reasoning, filename, Drive multipart body) are exported for tests; the live
 * round-trips are verified on a real device.
 */
(function () {
  "use strict";
  var G = (typeof globalThis !== "undefined") ? globalThis
    : (typeof window !== "undefined") ? window : this;

  var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  var DRIVE_FOLDER = "StewardMD Surgical Notes";

  function flag(k) {
    try { return !!(G.SMD_SURGX_FLAGS && G.SMD_SURGX_FLAGS.bool(k)); } catch (e) { return false; }
  }

  /* ---- pure helpers (node-tested) ---------------------------------------- */

  /* A Drive filename that is stable, sortable and NOT a patient identifier. The patient reference
   * lives inside the document, never in the filename: Drive filenames show up in search results,
   * shared-with-me lists and notification emails, which is a wider audience than the file itself. */
  function driveFilename(note, stamp) {
    var label = String((note && note.label) || "Surgical note").replace(/[\\/:*?"<>|]+/g, " ").trim();
    if (label.length > 60) label = label.slice(0, 60).trim();
    var d = String(stamp || "").slice(0, 10) || "undated";
    return "StewardMD " + d + " " + (label || "Surgical note") + ".txt";
  }

  /* Google's multipart/related envelope: one JSON metadata part, one media part. Same shape as
   * personal-clinic.js uploadEncrypted(), kept separate because that one uploads ciphertext to a
   * fixed filename and this uploads a readable document to a new file each time. */
  function driveMultipartBody(boundary, meta, text) {
    return "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + String(text) + "\r\n" +
      "--" + boundary + "--";
  }

  /* Availability is deliberately a REASONED result, not a boolean: the picker shows why a
   * destination is unavailable instead of hiding it, because "the option vanished" is the single
   * most confusing failure mode for a clinician mid-list. deps is injectable for tests. */
  function availability(deps) {
    deps = deps || {};
    var hasCrypto = deps.hasCrypto !== undefined ? deps.hasCrypto : !!(G.SMD_CLINIC_CRYPTO);
    var hasDriveTok = deps.hasDriveToken !== undefined ? deps.hasDriveToken : !!(G.SMD_getDriveToken);
    var ghisTok = deps.ghisToken !== undefined ? deps.ghisToken
      : (function () { try { return (G.GHIS && G.GHIS.getToken && G.GHIS.getToken()) || ""; } catch (e) { return ""; } })();
    var driveFlag = deps.driveFlag !== undefined ? deps.driveFlag : flag("smd_surgx_dest_drive");
    var emrFlag = deps.emrFlag !== undefined ? deps.emrFlag : flag("smd_surgx_dest_emr");

    var out = [];
    out.push({
      id: "local", label: "This device only", sub: "Encrypted on this phone",
      available: hasCrypto,
      reason: hasCrypto ? "" : "Secure storage is unavailable, so the note cannot be saved."
    });
    out.push({
      id: "drive", label: "Google Drive", sub: "A readable copy in your own Drive",
      available: !!(driveFlag && hasDriveTok),
      reason: !driveFlag ? "Turned off for this build."
        : (!hasDriveTok ? "Only available in the installed app, not the web preview." : "")
    });
    out.push({
      id: "emr", label: "Hospital EMR (GHIS)", sub: "Write into the patient's hospital record",
      available: !!(emrFlag && ghisTok),
      reason: !emrFlag ? "EMR write-back is not enabled yet."
        : (!ghisTok ? "Sign in to GHIS first (Ward Sync)." : "")
    });
    return out;
  }

  /* ---- transports -------------------------------------------------------- */

  function driveToken() {
    try {
      if (G.SMD_getDriveToken) return Promise.resolve(G.SMD_getDriveToken());
    } catch (e) {}
    return Promise.resolve(null);
  }

  /* Find-or-create one folder so a surgeon's notes do not scatter across Drive root. A failure to
   * make the folder is NOT fatal - we fall back to root rather than lose the upload. */
  function driveFolderId(token) {
    var q = encodeURIComponent("name='" + DRIVE_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&fields=files(id)", {
      headers: { "Authorization": "Bearer " + token }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var id = j && j.files && j.files[0] && j.files[0].id;
      if (id) return id;
      return fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j2) { return (j2 && j2.id) || null; });
    }).catch(function () { return null; });
  }

  /* saveToDrive(note, text, opts) -> Promise<{ok, error?, fileId?}>
   * opts.confirmed MUST be true: this puts patient-identifying text into Google Drive. */
  function saveToDrive(note, text, opts) {
    opts = opts || {};
    if (opts.confirmed !== true) return Promise.resolve({ ok: false, error: "not_confirmed" });
    if (!text) return Promise.resolve({ ok: false, error: "empty_note" });
    return driveToken().then(function (token) {
      if (!token) return { ok: false, error: "no_drive_account" };
      return driveFolderId(token).then(function (folder) {
        var stamp = ""; try { stamp = new Date().toISOString(); } catch (e) {}
        var meta = {
          name: driveFilename(note, stamp),
          mimeType: "text/plain",
          description: "StewardMD surgical note. Contains patient-identifying information."
        };
        if (folder) meta.parents = [folder];
        var boundary = "smdsgx" + (stamp || "0").replace(/\D/g, "");
        return fetch(DRIVE_UPLOAD, {
          method: "POST",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary },
          body: driveMultipartBody(boundary, meta, text)
        }).then(function (r) {
          if (!r.ok) return { ok: false, error: "http_" + r.status };
          return r.json().then(function (j) { return { ok: true, fileId: (j && j.id) || "" }; })
            .catch(function () { return { ok: true, fileId: "" }; });
        });
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  /* saveToEmr(note, text, opts) -> Promise<{ok, error?, detail?}>
   *
   * Posts to /api/ghis/surgx-note, which writes over the SAME verified transport as the OPD EMR
   * connect: it APPENDS the note to the Initial Assessment's "Management plan" on the patient's
   * own visit, reusing saveAssessment's visit activation, authoritative form re-serialisation,
   * patient_id mismatch abort and doc_id 0 refusal.
   *
   * Requires BOTH ids. patientId alone is not enough: an Initial Assessment attaches to a VISIT,
   * and without episodeId the form GET comes back blank (doc_id 0) and the server refuses the
   * write rather than creating an orphan record. Failing here with a clear message beats letting
   * the server reject it after the doctor thinks it sent.
   *
   * Still gated server-side by QUEUE_EMR_WRITE - writing into a live chart is never client-only. */
  function saveToEmr(note, text, opts) {
    opts = opts || {};
    if (opts.confirmed !== true) return Promise.resolve({ ok: false, error: "not_confirmed" });
    var tok = "";
    try { tok = (G.GHIS && G.GHIS.getToken && G.GHIS.getToken()) || ""; } catch (e) {}
    if (!tok) return Promise.resolve({ ok: false, error: "ghis_signed_out" });

    /* The note's OWN linked patient decides where this goes - not whoever happens to be open in
     * Ward Sync right now. A note written this morning must not be filed against the patient the
     * surgeon opened this afternoon. Falls back to the ward selection only for a note that predates
     * patient linking. */
    var patient = (note && note.patient) || null;
    if (!patient) {
      try { patient = (G.GHIS && G.GHIS.getSelectedPatient && G.GHIS.getSelectedPatient()) || null; } catch (e) {}
      if (patient) patient = { source: "ghis", patientId: patient.patientId, episodeId: patient.episodeId, name: patient.name };
    }
    if (!patient) return Promise.resolve({ ok: false, error: "no_patient_selected" });
    /* Source is checked BEFORE the id: a manually-entered patient has no patientId by definition,
     * and telling that surgeon "no patient selected" would be simply wrong - they selected one, it
     * just has no hospital record behind it. Only a GHIS patient is writable (Connect is
     * pull-only, manual has no record at all). */
    if (patient.source && patient.source !== "ghis") return Promise.resolve({ ok: false, error: "source_not_writable" });
    if (!patient.patientId) return Promise.resolve({ ok: false, error: "no_patient_selected" });
    if (!patient.episodeId) return Promise.resolve({ ok: false, error: "no_episode" });

    return fetch("/api/ghis/surgx-note", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify({
        patientId: patient.patientId,
        episodeId: patient.episodeId,
        noteType: (note && note.type) || "",
        templateId: (note && note.templateId) || "",
        finalizedAt: (note && note.finalizedAt) || "",
        text: String(text || "")
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok && j && j.ok) return { ok: true, resp: (j && j.resp) || "" };
        // saveAssessment reports a REFUSAL as {ok:false, resp:"patient_mismatch: ..."} at HTTP 200,
        // so resp must reach the caller - it is the difference between "refused for a good reason"
        // and "the network failed", and the clinician needs to be told which.
        return {
          ok: false,
          error: (j && j.error) || ("http_" + r.status),
          detail: (j && j.detail) || "",
          resp: (j && j.resp) || ""
        };
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  /* send(dest, note, text, opts) — single entry point the UI calls. Local is handled by the caller
   * (it owns the store and the note state); this resolves the export destinations. */
  function send(dest, note, text, opts) {
    if (dest === "drive") return saveToDrive(note, text, opts);
    if (dest === "emr") return saveToEmr(note, text, opts);
    return Promise.resolve({ ok: false, error: "unknown_destination" });
  }

  var API = {
    availability: availability,
    send: send,
    saveToDrive: saveToDrive,
    saveToEmr: saveToEmr,
    // pure, for tests
    driveFilename: driveFilename,
    driveMultipartBody: driveMultipartBody,
    DRIVE_FOLDER: DRIVE_FOLDER
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_SURGX_DEST = API;
})();
