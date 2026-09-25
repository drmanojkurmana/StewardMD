/* pglog-backup.js — NMC eLOGBook · end-to-end encrypted backup to the resident's own Google Drive.
 * ==========================================================================================
 * WHAT IS BEING PROTECTED AND FROM WHAT
 *
 * A PG logbook is three years of work that an examiner relies on, and part of it exists in exactly
 * one place: device-local drafts, and clinical photographs, which pglog-photos.js deliberately never
 * uploads. A reinstall destroys both. That is the loss this module prevents.
 *
 * It is NOT a sync channel and not a second server. The verified record already lives in the
 * StewardMD logbook service; this is a copy the resident holds, in their own Drive, that StewardMD
 * cannot read.
 *
 * THE FILE IN DRIVE IS CIPHERTEXT AND NOTHING ELSE.
 *   password --PBKDF2-SHA256, 200k, per-backup 16-byte salt--> AES-256-GCM key
 * The same primitives surgx-backup.js uses, for the same reason: it is the scheme already proven on
 * device here. StewardMD never sees the password, stores it nowhere, and there is no escrow and no
 * recovery. LOSE THE PASSWORD AND THE BACKUP IS GONE. The UI says that before the first backup and
 * confirms the password twice.
 *
 * Outside the ciphertext there is only what a restore cannot begin without: envelope version, KDF
 * parameters, the salt and a timestamp (so the UI can say "last backed up on ..." without asking
 * for the password). No name, no institution, no counts, no patient reference, and the FILENAME
 * carries no identifier either — Drive filenames show up in search results and in "shared with me".
 *
 * WHAT "AUTOMATIC" HONESTLY MEANS HERE.
 * A background upload that needs no password would mean the key was stored somewhere, which is the
 * one thing this design refuses. So: the resident enters the password once per app session to
 * unlock backup; while it is unlocked, `maybeAuto()` backs up in the background whenever the
 * logbook has changed and MIN_AUTO_GAP_MS has passed. Close the app and it locks again. The UI must
 * say this rather than implying a silent always-on sync, and `status()` returns `unlocked` so it
 * can.
 *
 * RESTORE IS ADDITIVE AND NEVER ROLLS BACK NEWER WORK: a draft already on the device is replaced
 * only when the backup copy is strictly newer, so restoring twice is a no-op.
 *
 * Decision helpers are pure and exported for tests; Drive I/O is a thin shell over the existing
 * SMD_SURGX_DEST token/folder/multipart helpers, so the app has ONE Drive integration, not two.
 * window.SMD_PGLOG_BACKUP + module.exports.
 * ========================================================================================== */
(function () {
  "use strict";
  var G = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);

  var ENVELOPE = 1;                  // the FILE in Drive
  var FORMAT = 1;                    // the document INSIDE the ciphertext
  var KDF = { name: "PBKDF2", hash: "SHA-256", iterations: 200000 };
  var MIN_PASSWORD = 8;
  var BACKUP_NAME = "stewardmd-logbook.smdlogbk";     // no name, no institution, no date
  var MIN_AUTO_GAP_MS = 10 * 60 * 1000;               // do not re-upload more than once per 10 min
  var LOCK_KEY_PREFIX = "smd_pglog_backup_";

  function uid() {
    try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; return (u && u.uid) || "anon"; } catch (e) { return "anon"; }
  }
  function ls() { try { return G.localStorage || null; } catch (e) { return null; } }
  function metaKey() { return LOCK_KEY_PREFIX + "meta_" + uid(); }
  function autoKey() { return LOCK_KEY_PREFIX + "auto_" + uid(); }
  function dest() { try { return G.SMD_SURGX_DEST || null; } catch (e) { return null; } }
  function photos() { try { return G.SMD_PGLOG_PHOTOS || null; } catch (e) { return null; } }
  function store() { try { return G.SMD_PGLOG_STORE || null; } catch (e) { return null; } }

  /* ── pure helpers ─────────────────────────────────────────────────────────────────────── */

  function checkPassword(a, b) {
    a = String(a == null ? "" : a); b = String(b == null ? "" : b);
    if (a.length < MIN_PASSWORD) return { ok: false, error: "too_short", message: "Use at least " + MIN_PASSWORD + " characters." };
    if (b !== undefined && b !== null && b !== "" && a !== b) return { ok: false, error: "mismatch", message: "The two passwords are not the same." };
    return { ok: true };
  }

  /* The document inside the ciphertext. Drafts + the queue + photographs: exactly the things that
   * exist only on this device. Verified entries are NOT copied — they are on the server, and
   * duplicating a verified record into a file the resident can edit is how a logbook stops being
   * evidence. `serverEntryIds` records what was already safe, so a restore can say so. */
  function buildBackup(input) {
    input = input || {};
    var at = Number(input.at) || 0;
    return {
      format: FORMAT,
      at: at,
      account: String(input.account || ""),
      residentId: String(input.residentId || ""),
      programmeId: String(input.programmeId || ""),
      drafts: (input.drafts || []).slice(),
      queue: (input.queue || []).slice(),
      prefs: input.prefs || {},
      photos: (input.photos || []).slice(),
      serverEntryIds: (input.serverEntryIds || []).slice(),
      counts: {
        drafts: (input.drafts || []).length,
        photos: (input.photos || []).length,
        onServer: (input.serverEntryIds || []).length
      }
    };
  }

  function parseBackup(doc) {
    if (!doc || typeof doc !== "object") return { ok: false, error: "unreadable" };
    if (Number(doc.format) !== FORMAT) return { ok: false, error: "wrong_format" };
    return { ok: true, doc: doc };
  }

  /* Additive merge. A local draft is replaced only by a strictly newer backup copy. Returns the
   * plan rather than performing it, so it is testable without a store. */
  function mergePlan(localDrafts, backupDrafts) {
    var byId = {}, plan = { add: [], replace: [], keep: [] };
    (localDrafts || []).forEach(function (d) { if (d && d.localId) byId[d.localId] = d; });
    (backupDrafts || []).forEach(function (b) {
      if (!b || !b.localId) return;
      var cur = byId[b.localId];
      if (!cur) { plan.add.push(b); return; }
      var a = Number(b.updatedAt || b.at || 0), c = Number(cur.updatedAt || cur.at || 0);
      if (a > c) plan.replace.push(b); else plan.keep.push(cur);
    });
    return plan;
  }

  function wrapEnvelope(saltB64, cipherB64, at) {
    return JSON.stringify({
      envelope: ENVELOPE, app: "stewardmd-logbook",
      kdf: { name: KDF.name, hash: KDF.hash, iterations: KDF.iterations, salt: String(saltB64 || "") },
      at: Number(at) || 0, cipher: String(cipherB64 || "")
    });
  }
  function parseEnvelope(text) {
    var j = null;
    try { j = JSON.parse(String(text || "")); } catch (e) { return { ok: false, error: "unreadable" }; }
    if (!j || typeof j !== "object") return { ok: false, error: "unreadable" };
    if (Number(j.envelope) !== ENVELOPE) return { ok: false, error: "wrong_envelope" };
    // A plaintext file is refused on read: there is no unencrypted format to fall back to.
    if (!j.cipher || !j.kdf || !j.kdf.salt) return { ok: false, error: "not_encrypted" };
    return { ok: true, salt: String(j.kdf.salt), cipher: String(j.cipher), at: Number(j.at) || 0 };
  }

  /* ── local meta (no password, no content) ─────────────────────────────────────────────── */
  function readMeta() {
    try { return JSON.parse((ls() && ls().getItem(metaKey())) || "null") || null; } catch (e) { return null; }
  }
  function writeMeta(m) { try { ls() && ls().setItem(metaKey(), JSON.stringify(m || {})); } catch (e) {} }
  function autoOn() { try { return (ls() && ls().getItem(autoKey())) === "1"; } catch (e) { return false; } }
  function setAuto(on) { try { ls() && ls().setItem(autoKey(), on ? "1" : "0"); } catch (e) {} }

  /* ── the session key ──────────────────────────────────────────────────────────────────────
   * In memory only. Never written anywhere, dropped on lock() and gone when the app closes. */
  var _key = null, _keyFor = "", _lastAuto = 0, _busy = false;
  function crypto_() { try { return G.SMD_CLINIC_CRYPTO || null; } catch (e) { return null; } }
  function unlocked() { return !!(_key && _keyFor === uid()); }
  function lock() { _key = null; _keyFor = ""; }

  function unlock(password) {
    var c = crypto_();
    if (!c) return Promise.resolve({ ok: false, error: "no_crypto", message: "This device cannot encrypt a backup." });
    var chk = checkPassword(password);
    if (!chk.ok) return Promise.resolve({ ok: false, error: chk.error, message: chk.message });
    var m = readMeta();
    var salt = (m && m.salt) || c.newSalt();
    try {
      _key = c.create(String(password), salt); _keyFor = uid();
      if (!m || !m.salt) writeMeta({ salt: salt, at: (m && m.at) || 0 });
      return Promise.resolve({ ok: true, firstTime: !(m && m.at) });
    } catch (e) {
      return Promise.resolve({ ok: false, error: "no_crypto", message: "This device cannot encrypt a backup." });
    }
  }

  function available() {
    var d = dest();
    return !!(d && d.driveToken && crypto_() && G.fetch);
  }
  function status() {
    var m = readMeta();
    return {
      available: available(),
      configured: !!(m && m.salt),
      unlocked: unlocked(),
      auto: autoOn(),
      lastAt: (m && m.at) || 0,
      lastCounts: (m && m.counts) || null,
      minGapMs: MIN_AUTO_GAP_MS
    };
  }
  function describe() {
    if (!available()) return "Backup to Google Drive needs the StewardMD app, signed in to Google.";
    var s = status();
    if (!s.configured) return "Not set up. Choose a password and StewardMD will keep an encrypted copy in your Drive.";
    if (!s.lastAt) return "Set up, but nothing has been backed up yet.";
    var when = ""; try { when = new Date(s.lastAt).toLocaleString(); } catch (e) {}
    return "Last backed up " + (when || "earlier") + (s.unlocked ? "" : " · locked until you enter your password");
  }

  /* ── gather what is at risk ───────────────────────────────────────────────────────────── */
  function gather() {
    var st = store(), ph = photos();
    var drafts = [], queue = [], prefs = {}, ctx = {}, serverIds = [];
    try { if (st) { drafts = st.drafts() || []; queue = st.queued() || []; prefs = st.prefs() || {}; ctx = st.context() || {}; } } catch (e) {}
    try {
      var cached = st && st.cachedDashboard && st.cachedDashboard();
      var ents = (cached && cached.entries) || [];
      serverIds = ents.map(function (e) { return e && e.id; }).filter(Boolean);
    } catch (e) {}
    var pP = (ph && ph.exportAll) ? ph.exportAll() : Promise.resolve([]);
    return pP.then(function (pics) {
      return buildBackup({
        at: Date.now(), account: uid(), residentId: ctx.residentId || "", programmeId: ctx.programmeId || "",
        drafts: drafts, queue: queue, prefs: prefs, photos: pics, serverEntryIds: serverIds
      });
    });
  }

  /* ── Drive I/O ────────────────────────────────────────────────────────────────────────── */
  function findFile(token) {
    var q = encodeURIComponent("name='" + BACKUP_NAME + "' and trashed=false");
    return fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&fields=files(id,modifiedTime)", {
      headers: { "Authorization": "Bearer " + token }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.files && j.files[0]) || null; })
      .catch(function () { return null; });
  }
  function upload(token, body, existingId, folderId) {
    var meta = { name: BACKUP_NAME, mimeType: "application/octet-stream",
      description: "StewardMD logbook backup. Encrypted; unreadable without the owner's password." };
    if (!existingId && folderId) meta.parents = [folderId];
    var boundary = "smdpglog" + String(Date.now());
    var d = dest();
    var payload = (d && d.driveMultipartBody) ? d.driveMultipartBody(boundary, meta, body) : null;
    if (!payload) return Promise.resolve({ ok: false, error: "no_transport" });
    var url = existingId
      ? "https://www.googleapis.com/upload/drive/v3/files/" + existingId + "?uploadType=multipart"
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    return fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary },
      body: payload
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: "http_" + r.status };
      return { ok: true };
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }
  function download(token, fileId) {
    return fetch("https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media", {
      headers: { "Authorization": "Bearer " + token }
    }).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
  }

  /* backupNow(opts) -> Promise<{ok, error?, counts?}>
   * Requires unlock() first. opts.silent suppresses nothing here (there is no UI in this file); it
   * marks the call as automatic so status/telemetry can tell the two apart. */
  function backupNow(opts) {
    opts = opts || {};
    if (!available()) return Promise.resolve({ ok: false, error: "unavailable" });
    if (!unlocked()) return Promise.resolve({ ok: false, error: "locked" });
    if (_busy) return Promise.resolve({ ok: false, error: "busy" });
    _busy = true;
    var d = dest(), m = readMeta() || {};
    return d.driveToken().then(function (token) {
      if (!token) return { ok: false, error: "no_drive_account" };
      return gather().then(function (doc) {
        return Promise.resolve(_key.encrypt(JSON.stringify(doc))).then(function (cipher) {
          var at = Date.now();
          var body = wrapEnvelope(m.salt || "", cipher, at);
          return d.driveFolderId(token).then(function (folder) {
            return findFile(token).then(function (f) {
              return upload(token, body, f && f.id, folder).then(function (r) {
                if (!r.ok) return r;
                writeMeta({ salt: m.salt, at: at, counts: doc.counts });
                _lastAuto = at;
                return { ok: true, at: at, counts: doc.counts, automatic: !!opts.silent };
              });
            });
          });
        });
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; })
      .then(function (r) { _busy = false; return r; });
  }

  /* Called by the UI after anything that changes the logbook. Backs up only when the resident has
   * turned automatic backup on, has unlocked this session, and the gap has passed. Never prompts. */
  function maybeAuto(reason) {
    if (!autoOn() || !unlocked() || _busy) return Promise.resolve({ ok: false, error: "skipped" });
    var now = Date.now();
    if (now - _lastAuto < MIN_AUTO_GAP_MS) return Promise.resolve({ ok: false, error: "too_soon" });
    return backupNow({ silent: true, reason: reason || "" });
  }

  /* restoreNow() -> Promise<{ok, added, replaced, photos, error?}> — additive, see the header. */
  function restoreNow() {
    if (!available()) return Promise.resolve({ ok: false, error: "unavailable" });
    if (!unlocked()) return Promise.resolve({ ok: false, error: "locked" });
    var d = dest(), st = store(), ph = photos();
    return d.driveToken().then(function (token) {
      if (!token) return { ok: false, error: "no_drive_account" };
      return findFile(token).then(function (f) {
        if (!f) return { ok: false, error: "no_backup" };
        return download(token, f.id).then(function (text) {
          var env = parseEnvelope(text);
          if (!env.ok) return { ok: false, error: env.error };
          return Promise.resolve(_key.decrypt(env.cipher)).then(function (json) {
            var parsed = parseBackup(JSON.parse(String(json || "null")));
            if (!parsed.ok) return { ok: false, error: parsed.error };
            var doc = parsed.doc;
            var local = [];
            try { local = (st && st.drafts()) || []; } catch (e) {}
            var plan = mergePlan(local, doc.drafts);
            var wrote = 0;
            plan.add.concat(plan.replace).forEach(function (dft) {
              try { if (st && st.saveDraft) { st.saveDraft(dft); wrote++; } } catch (e) {}
            });
            var pics = (doc.photos || []);
            var pP = (ph && ph.importOne) ? Promise.all(pics.map(function (p) { return ph.importOne(p); })) : Promise.resolve([]);
            return pP.then(function (res) {
              return { ok: true, added: plan.add.length, replaced: plan.replace.length, wrote: wrote,
                photos: (res || []).filter(Boolean).length, at: doc.at || env.at };
            });
          }).catch(function () { return { ok: false, error: "wrong_password" }; });
        });
      });
    }).catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
  }

  var API = {
    available: available, status: status, describe: describe,
    unlock: unlock, lock: lock, unlocked: unlocked,
    backupNow: backupNow, restoreNow: restoreNow, maybeAuto: maybeAuto,
    autoOn: autoOn, setAuto: setAuto,
    // pure, for tests
    buildBackup: buildBackup, parseBackup: parseBackup, mergePlan: mergePlan,
    checkPassword: checkPassword, wrapEnvelope: wrapEnvelope, parseEnvelope: parseEnvelope,
    BACKUP_NAME: BACKUP_NAME, ENVELOPE: ENVELOPE, FORMAT: FORMAT, MIN_PASSWORD: MIN_PASSWORD,
    MIN_AUTO_GAP_MS: MIN_AUTO_GAP_MS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_BACKUP = API;
})();
