/* surgx-store.js — SURGX · account-scoped local state + encrypted device-local note store.
 * ===========================================================================
 * TWO stores with deliberately different guarantees:
 *
 *   1. PREFERENCES / PROGRESS  (plaintext localStorage, account-scoped)
 *      Recents, pinned protocols, procedure completion, case scores. No PHI, ever. Keyed
 *      `smd_surgx_<uid|guest>` exactly like workspaces.js pkey(), so it never leaks between
 *      accounts on a shared device.
 *
 *   2. NOTES  (AES-256-GCM at rest, device-local, never transmitted)
 *      Operative notes are PHI and a legal record. They are encrypted with
 *      SMD_CLINIC_CRYPTO (PBKDF2-SHA256 200k -> AES-GCM, the scheme personal-clinic and the
 *      shared-clinic sync already use) and stored under `smd_surgx_note_<uid>_<id>`.
 *      Nothing is uploaded: there is no SURGX note endpoint, by design (see the module note).
 *
 * THE HONEST LIMITATION, stated rather than glossed: the per-device secret lives in localStorage
 * beside the ciphertext. That defends against a device backup, a Firestore dump, or someone
 * reading the web-inspector storage panel - it does NOT defend against an attacker who already
 * has code execution on the unlocked device. It is a real improvement over plaintext and it is
 * not a hardware-backed keystore.
 * ponytail: localStorage-held key; move the secret to iOS Keychain / Android Keystore via a
 * Capacitor secure-storage plugin when notes leave the tester build.
 *
 * Encryption FAILS CLOSED: if WebCrypto is unavailable the store refuses to save rather than
 * silently writing cleartext PHI (the icu-crypto.js rule).
 *
 * window.SMD_SURGX_STORE + module.exports (the pure helpers are node-testable).
 */
(function () {
  "use strict";

  var G = (typeof window !== "undefined") ? window : null;

  function ls() { try { return G && G.localStorage ? G.localStorage : null; } catch (e) { return null; } }

  /* Account scope. Mirrors workspaces.js pkey() so SURGX shares the app's notion of "who". */
  function uid() {
    try {
      var a = JSON.parse((ls() && ls().getItem("stewardmd_account")) || "null");
      return (a && (a.uid || a.email)) || "guest";
    } catch (e) { return "guest"; }
  }
  function pkey() { return "smd_surgx_" + uid(); }
  function notePrefix() { return "smd_surgx_note_" + uid() + "_"; }
  function secretKey() { return "smd_surgx_k_" + uid(); }

  /* ── preferences / progress ──────────────────────────────────────────────── */

  var DEF = { recents: [], pinned: [], procedures: {}, cases: {}, lastSection: "", noteLevelPref: "" };

  function load() {
    try {
      var raw = ls() && ls().getItem(pkey());
      var p = raw ? JSON.parse(raw) : null;
      if (!p || typeof p !== "object") return clone(DEF);
      var out = clone(DEF);
      for (var k in DEF) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
      return out;
    } catch (e) { return clone(DEF); }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function save(p) { try { ls() && ls().setItem(pkey(), JSON.stringify(p)); return true; } catch (e) { return false; } }

  /* Recents: a ring of {kind,id,title}, most recent first, capped. No PHI - protocol and procedure
   * titles only. A note is NEVER added to recents; its title can carry a patient reference. */
  function touch(kind, id, title) {
    if (kind === "note") return;
    var p = load();
    p.recents = (p.recents || []).filter(function (r) { return !(r.kind === kind && r.id === id); });
    p.recents.unshift({ kind: kind, id: id, title: String(title || "") });
    p.recents = p.recents.slice(0, 8);
    save(p);
  }
  function recents() { return load().recents || []; }

  function isPinned(kind, id) {
    return (load().pinned || []).some(function (r) { return r.kind === kind && r.id === id; });
  }
  function togglePin(kind, id, title) {
    var p = load(), was = isPinned(kind, id);
    p.pinned = (p.pinned || []).filter(function (r) { return !(r.kind === kind && r.id === id); });
    if (!was) p.pinned.unshift({ kind: kind, id: id, title: String(title || "") });
    p.pinned = p.pinned.slice(0, 12);
    save(p);
    return !was;
  }
  function pinned() { return load().pinned || []; }

  /* Procedure and case progress. Deliberately NOT a streak and NOT a score badge: the owner's
   * brief says no gamification, so this exists to let a trainee resume, not to reward them. */
  function markProcedure(id, chapterId) {
    var p = load();
    var rec = p.procedures[id] || { seen: [], last: "" };
    if (chapterId && rec.seen.indexOf(chapterId) < 0) rec.seen.push(chapterId);
    rec.last = chapterId || rec.last;
    p.procedures[id] = rec;
    save(p);
  }
  function procedureProgress(id) { return load().procedures[id] || { seen: [], last: "" }; }

  function saveCaseResult(id, result) {
    var p = load();
    p.cases[id] = { verdict: result && result.verdict, correct: result && result.correct, total: result && result.total };
    save(p);
  }
  function caseResult(id) { return load().cases[id] || null; }

  function setLastSection(s) { var p = load(); p.lastSection = String(s || ""); save(p); }
  function lastSection() { return load().lastSection || ""; }

  /* ── note store (encrypted) ──────────────────────────────────────────────── */

  function crypto_() { try { return G && G.SMD_CLINIC_CRYPTO ? G.SMD_CLINIC_CRYPTO : null; } catch (e) { return null; } }
  function webcryptoOK() {
    try { return !!(G && G.crypto && G.crypto.subtle && G.crypto.getRandomValues && crypto_()); } catch (e) { return false; }
  }

  var _box = null;   // cached { salt, encrypt, decrypt } for this account

  // Per-device, per-account secret. Generated once; 32 random bytes hex-encoded.
  function deviceSecret() {
    var s = ls();
    if (!s) return null;
    var k = secretKey(), v = null;
    try { v = s.getItem(k); } catch (e) { return null; }
    if (v) return v;
    try {
      var a = new Uint8Array(32);
      G.crypto.getRandomValues(a);
      var hex = "";
      for (var i = 0; i < a.length; i++) hex += ("0" + a[i].toString(16)).slice(-2);
      s.setItem(k, hex);
      return hex;
    } catch (e) { return null; }
  }

  function box() {
    if (_box) return _box;
    if (!webcryptoOK()) return null;
    var secret = deviceSecret();
    if (!secret) return null;
    var s = ls();
    var saltK = secretKey() + "_s";
    var salt = null;
    try { salt = s.getItem(saltK); } catch (e) {}
    if (!salt) {
      try { salt = crypto_().newSalt(); s.setItem(saltK, salt); } catch (e) { return null; }
    }
    try { _box = crypto_().create(secret, salt); } catch (e) { return null; }
    return _box;
  }

  function noteKey(id) { return notePrefix() + id; }

  /* An index of note METADATA is kept in cleartext so the list can render without decrypting five
   * notes, and so a decrypt failure shows a locked row rather than losing the note. The index
   * carries no PHI: type, template, timestamps, status and a short non-identifying label the
   * clinician chooses. The patient reference lives ONLY inside the encrypted body. */
  function indexKey() { return "smd_surgx_notes_" + uid(); }
  function readIndex() {
    try { return JSON.parse((ls() && ls().getItem(indexKey())) || "[]") || []; } catch (e) { return []; }
  }
  function writeIndex(list) { try { ls() && ls().setItem(indexKey(), JSON.stringify(list)); return true; } catch (e) { return false; } }

  function newId() {
    var t = "0", r = "";
    try { t = String(Date.now()); } catch (e) {}
    try {
      var a = new Uint8Array(4); G.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) r += ("0" + a[i].toString(16)).slice(-2);
    } catch (e) { r = "0000"; }
    return "n" + t + r;
  }

  /* saveNote(note) -> Promise<{ok, id, reason?}>
   * `note` = { id?, type, templateId, label, values, provenance, finalized, finalizedBy,
   *            finalizedAt, createdAt, updatedAt, transcript? }
   * FAILS CLOSED: no crypto -> no write, and the caller is told why. */
  function saveNote(note) {
    var b = box();
    if (!b) return Promise.resolve({ ok: false, reason: "no-crypto" });
    var id = note.id || newId();
    var now = 0; try { now = Date.now(); } catch (e) {}
    var body = {
      id: id, type: note.type, templateId: note.templateId || "",
      label: String(note.label || ""),
      // The linked patient (surgx-patient.js): source + ids + display name. Persisted INSIDE the
      // encrypted body, never in the plaintext index below - it is patient-identifying.
      patient: note.patient || null,
      values: note.values || {}, provenance: note.provenance || {},
      finalized: note.finalized === true,
      finalizedBy: note.finalizedBy || "", finalizedAt: note.finalizedAt || "",
      audit: (note.audit || []).slice(-100),
      createdAt: note.createdAt || now, updatedAt: now
    };
    return b.encrypt(JSON.stringify(body)).then(function (blob) {
      try { ls().setItem(noteKey(id), blob); } catch (e) { return { ok: false, reason: "storage-full" }; }
      var idx = readIndex().filter(function (r) { return r.id !== id; });
      idx.unshift({
        id: id, type: body.type, templateId: body.templateId, label: body.label,
        finalized: body.finalized, createdAt: body.createdAt, updatedAt: body.updatedAt
      });
      writeIndex(idx);
      return { ok: true, id: id };
    }).catch(function () { return { ok: false, reason: "encrypt-failed" }; });
  }

  function loadNote(id) {
    var b = box();
    if (!b) return Promise.resolve(null);
    var blob = null;
    try { blob = ls().getItem(noteKey(id)); } catch (e) {}
    if (!blob) return Promise.resolve(null);
    return b.decrypt(blob).then(function (s) {
      try { return JSON.parse(s); } catch (e) { return null; }
    }).catch(function () { return null; });   // locked row, not a crash
  }

  function listNotes() { return readIndex(); }

  function deleteNote(id) {
    try { ls().removeItem(noteKey(id)); } catch (e) {}
    writeIndex(readIndex().filter(function (r) { return r.id !== id; }));
    return true;
  }

  /* Sign-out wipe. Notes are PHI and must not survive into the next account on this device.
   * Mirrors clinix-screens.js wireSignout(). */
  function wipe() {
    var s = ls(); if (!s) return;
    var pre = notePrefix(), kill = [];
    try {
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && (k.indexOf(pre) === 0 || k === indexKey() || k === pkey() || k === secretKey() || k === secretKey() + "_s")) kill.push(k);
      }
      kill.forEach(function (k) { try { s.removeItem(k); } catch (e) {} });
    } catch (e) {}
    _box = null;
  }

  var _wired = false;
  function wireSignout() {
    if (_wired || !G) return;
    _wired = true;
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) {
      try { G.addEventListener(ev, wipe); } catch (e) {}
    });
  }
  wireSignout();

  var API = {
    uid: uid, pkey: pkey,
    touch: touch, recents: recents,
    isPinned: isPinned, togglePin: togglePin, pinned: pinned,
    markProcedure: markProcedure, procedureProgress: procedureProgress,
    saveCaseResult: saveCaseResult, caseResult: caseResult,
    setLastSection: setLastSection, lastSection: lastSection,
    // notes
    cryptoAvailable: webcryptoOK,
    saveNote: saveNote, loadNote: loadNote, listNotes: listNotes, deleteNote: deleteNote,
    newId: newId,
    wipe: wipe,
    _reset: function () { _box = null; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) { G.SMD_SURGX_STORE = API; G.SMD_SURGX_WIPE = wipe; }
})();
