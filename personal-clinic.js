/* personal-clinic.js — StewardMD "My Clinic": on-device EMR for solo/personal clinics.
 * ---------------------------------------------------------------------------------------
 * A doctor WITHOUT a hospital EMR (GHIS) gets the SAME assessment template + Voice Consult +
 * MaiK, but every patient + consult is stored ON THIS PHONE (localStorage) — no server, fully
 * offline. Reuses opd-emr's whole overlay via openProfile({ source:"local", localStore }).
 *
 * Backup / Google Drive: exportJSON() serialises every patient+consult; backup() writes it to a
 * file and opens the native Share sheet so the doctor can "Save to Drive" (no OAuth needed).
 * uploadToDrive(accessToken) is the direct Drive REST path for when an OAuth client is wired.
 *
 * Store is headless-testable (localStorage injected via configure). window.SMD_CLINIC + module.exports.
 * Flag: smd_personal_clinic (default OFF). No PHI leaves the device unless the doctor shares a backup.
 */
(function () {
  "use strict";

  var KEY_PTS = "stewardmd.clinic.patients";              // index: [{id,name,age,sex,phone,at,updatedAt}]
  var KEY_P = function (id) { return "stewardmd.clinic.p." + id; };   // per-patient: {patient, latest, consults:[{at,fields}]}

  var LS = (function () { try { return (typeof localStorage !== "undefined") ? localStorage : (typeof window !== "undefined" ? window.localStorage : null); } catch (e) { return null; } })();
  function configure(deps) { if (deps && deps.localStorage) LS = deps.localStorage; }
  function readJSON(k, dflt) { try { var s = LS && LS.getItem(k); return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
  function writeJSON(k, v) { try { LS && LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function nowISO() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  var _seq = 0;
  function uid() { _seq++; try { return "pc" + Date.now().toString(36) + _seq.toString(36); } catch (e) { return "pc" + _seq; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ------------------------------ store ------------------------------ */
  function listPatients() { var a = readJSON(KEY_PTS, []); return Array.isArray(a) ? a : []; }
  function getPatient(id) { var r = readJSON(KEY_P(id), null); return (r && r.patient) || null; }
  function addPatient(p) {
    p = p || {}; var id = uid();
    var rec = { id: id, name: String(p.name || "").trim() || "Unnamed", age: String(p.age || "").trim(), sex: p.sex || "", phone: String(p.phone || "").trim(), mrn: String(p.mrn || "").trim(), at: nowISO(), updatedAt: nowISO() };
    var idx = listPatients(); idx.unshift(rec); writeJSON(KEY_PTS, idx);
    writeJSON(KEY_P(id), { patient: rec, latest: {}, consults: [] });
    return id;
  }
  function deletePatient(id) {
    writeJSON(KEY_PTS, listPatients().filter(function (x) { return x.id !== id; }));
    try { LS && LS.removeItem(KEY_P(id)); } catch (e) {}
  }
  // opd-emr backend: current assessment values for prefill (carry forward the latest visit).
  function getConsult(id) { var r = readJSON(KEY_P(id), null); return (r && r.latest) || {}; }
  // Per-consult-open history: opening a patient starts a fresh visit; the first save appends a NEW dated
  // consult, later saves in the same open update it. Reopening = a new timeline entry.
  var _active = {};
  function startConsult(id) { _active[id] = false; }
  // opd-emr backend: persist a saved consult (fields = GHIS payload, vals = form state, meta.author = who).
  function saveConsult(id, fields, vals, meta) {
    meta = meta || {};
    var r = readJSON(KEY_P(id), null) || { patient: getPatient(id), latest: {}, consults: [] };
    r.latest = vals || {}; r.consults = r.consults || [];
    var entry = { at: nowISO(), fields: fields || {}, vals: vals || {}, author: meta.author || "" };
    if (_active[id] && r.consults.length) r.consults[0] = entry;   // same open -> update the current entry
    else { r.consults.unshift(entry); _active[id] = true; }        // first save of this open -> new dated entry
    writeJSON(KEY_P(id), r);
    var idx = listPatients(); for (var i = 0; i < idx.length; i++) if (idx[i].id === id) { idx[i].updatedAt = nowISO(); break; }
    writeJSON(KEY_PTS, idx);
    try { scheduleSync(); } catch (e) {}   // auto-encrypt + upload to Drive (debounced)
  }
  // chronological footprint (newest first) for the EMR timeline.
  function timeline(id) {
    var r = readJSON(KEY_P(id), null), c = (r && r.consults) || [];
    return c.map(function (e) { var ts = 0; try { ts = e.at ? new Date(e.at).getTime() : 0; } catch (x) {} return { ts: ts, kind: "note", author: e.author || "", vals: e.vals || {}, fields: e.fields || {} }; });
  }
  var localStore = { getConsult: getConsult, saveConsult: saveConsult, startConsult: startConsult, timeline: timeline };

  /* ------------------------------ backup / Drive ------------------------------ */
  function exportJSON() {
    var out = { app: "StewardMD My Clinic", version: 1, exportedAt: nowISO(), patients: [] };
    listPatients().forEach(function (p) { out.patients.push(readJSON(KEY_P(p.id), null) || { patient: p, latest: {}, consults: [] }); });
    return JSON.stringify(out, null, 2);
  }
  function importJSON(json) {
    var data; try { data = (typeof json === "string") ? JSON.parse(json) : json; } catch (e) { return { ok: false, error: "bad_json" }; }
    if (!data || !Array.isArray(data.patients)) return { ok: false, error: "bad_shape" };
    var idx = listPatients(), byId = {}; idx.forEach(function (p) { byId[p.id] = 1; }); var added = 0;
    data.patients.forEach(function (rec) {
      var p = rec && rec.patient; if (!p || !p.id) return;
      writeJSON(KEY_P(p.id), { patient: p, latest: rec.latest || {}, consults: rec.consults || [] });
      if (!byId[p.id]) { idx.unshift(p); byId[p.id] = 1; added++; }
    });
    writeJSON(KEY_PTS, idx); return { ok: true, added: added };
  }
  // Save a backup file and open the native Share sheet (the doctor picks Google Drive / Files / etc).
  function backup() {
    var data = exportJSON(), name = "stewardmd-clinic-backup.json";
    try {
      var C = window.Capacitor, P = C && C.Plugins;
      if (P && P.Filesystem && P.Share) {
        return P.Filesystem.writeFile({ path: name, data: data, directory: "CACHE", encoding: "utf8" })
          .then(function (w) { return P.Share.share({ title: "StewardMD clinic backup", text: "My Clinic patients + consults", url: w.uri }); })
          .then(function () { return { ok: true, shared: true }; })
          .catch(function (e) { return webDownload(name, data); });
      }
    } catch (e) {}
    return Promise.resolve(webDownload(name, data));
  }
  function webDownload(name, data) {
    try {
      var b = new Blob([data], { type: "application/json" }), u = URL.createObjectURL(b);
      var a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 500);
      return { ok: true, downloaded: true };
    } catch (e) { return { ok: false, error: "share_unavailable" }; }
  }
  /* ---- encryption (AES-GCM + PBKDF2). The Drive file is a readable envelope whose PHI payload is
     encrypted — only the clinic password (held by StewardMD, in the device Keychain) can open it. ---- */
  var DRIVE_FILE = "stewardmd-clinic.smdbak";
  function b64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(str) { var s = atob(str), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  function subtle() { var c = (typeof crypto !== "undefined" && crypto) || (typeof window !== "undefined" && window.crypto) || null; return c && c.subtle ? c : null; }
  function deriveKey(password, salt) {
    var c = subtle(); var enc = new TextEncoder();
    return c.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]).then(function (mat) {
      return c.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 200000, hash: "SHA-256" }, mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function encryptBackup(plaintext, password) {
    var c = subtle(); if (!c) return Promise.reject(new Error("no_webcrypto"));
    var salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt).then(function (key) {
      return c.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(plaintext));
    }).then(function (ct) {
      return JSON.stringify({ smd_enc: 1, app: "StewardMD My Clinic", alg: "AES-GCM", kdf: "PBKDF2-SHA256", iter: 200000, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
    });
  }
  function decryptBackup(envelope, password) {
    var c = subtle(); if (!c) return Promise.reject(new Error("no_webcrypto"));
    var e; try { e = (typeof envelope === "string") ? JSON.parse(envelope) : envelope; } catch (x) { return Promise.reject(new Error("bad_envelope")); }
    if (!e || e.smd_enc !== 1) return Promise.reject(new Error("not_encrypted_backup"));
    return deriveKey(password, unb64(e.salt)).then(function (key) {
      return c.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, key, unb64(e.ct));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }

  /* ---- clinic password (Keychain via SecureStoragePlugin; localStorage fallback on web) ---- */
  function SS() { try { var P = window.Capacitor && window.Capacitor.Plugins; return (P && P.SecureStoragePlugin) || null; } catch (e) { return null; } }
  function setPassword(pw) { var s = SS(); if (s && s.set) return Promise.resolve(s.set({ key: "smd_clinic_pw", value: pw })).then(function () { return true; }).catch(function () { return false; }); try { localStorage.setItem("stewardmd.clinic.pw", pw); } catch (e) {} return Promise.resolve(true); }
  function getPassword() { var s = SS(); if (s && s.get) return Promise.resolve(s.get({ key: "smd_clinic_pw" })).then(function (r) { return r && r.value || null; }).catch(function () { return null; }); try { return Promise.resolve(localStorage.getItem("stewardmd.clinic.pw")); } catch (e) { return Promise.resolve(null); } }
  function hasPassword() { return getPassword().then(function (p) { return !!p; }); }

  /* ---- Drive auth token (drive.file scope) — from native-auth's SMD_getDriveToken(), cached ~50 min
     so debounced auto-sync doesn't re-trigger the scoped Google sign-in on every save. ---- */
  var _tok = null, _tokAt = 0;
  function getDriveToken() {
    try { if (_tok && (Date.now() - _tokAt) < 50 * 60 * 1000) return Promise.resolve(_tok); } catch (e) {}
    try { if (window.SMD_getDriveToken) return Promise.resolve(window.SMD_getDriveToken()).then(function (t) { if (t) { _tok = t; try { _tokAt = Date.now(); } catch (e) {} } return t; }); } catch (e) {}
    return Promise.resolve(null);
  }

  /* ---- sync: encrypt the whole clinic + upload to Drive (create or update ONE file) ---- */
  function uploadEncrypted(token, envelope) {
    var q = encodeURIComponent("name='" + DRIVE_FILE + "' and trashed=false");
    return fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&fields=files(id)", { headers: { "Authorization": "Bearer " + token } })
      .then(function (r) { return r.json(); })
      .then(function (fj) {
        var id = fj && fj.files && fj.files[0] && fj.files[0].id;
        var boundary = "smdc" + Date.now();
        var meta = id ? {} : { name: DRIVE_FILE, description: "StewardMD My Clinic encrypted backup" };
        var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
          "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + envelope + "\r\n--" + boundary + "--";
        var url = id ? ("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=multipart")
          : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
        return fetch(url, { method: id ? "PATCH" : "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body: body });
      })
      .then(function (r) { return r.ok ? { ok: true } : { ok: false, error: "http_" + r.status }; })
      .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }
  var LAST_KEY = "stewardmd.clinic.lastbackup";
  function lastBackupAt() { try { return +(localStorage.getItem(LAST_KEY) || 0); } catch (e) { return 0; } }
  function markBackup() { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e) {} }
  function syncNow() {
    return getPassword().then(function (pw) {
      if (!pw) return { ok: false, error: "no_password" };
      return getDriveToken().then(function (token) {
        if (!token) return { ok: false, error: "no_token" };
        return encryptBackup(exportJSON(), pw).then(function (env) { return uploadEncrypted(token, env); })
          .then(function (r) { if (r && r.ok) markBackup(); return r; });
      });
    }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }
  // Local is the source of truth (instant reads, Drive never read during use). Drive is an encrypted
  // backup after EVERY save — debounced ~15s so a burst of edits in one consult coalesces into a single
  // upload. Clinic data is small text, so per-save backup is cheap AND safe (no on-phone-only window).
  var _syncTmr = null;
  function autoSyncOn() { try { return localStorage.getItem("smd_clinic_autosync") !== "0"; } catch (e) { return true; } }
  function scheduleSync() {
    if (!autoSyncOn()) return;
    if (_syncTmr) clearTimeout(_syncTmr);
    _syncTmr = setTimeout(function () { _syncTmr = null; syncNow(); }, 15000);   // silent, ~15s after the last edit
  }
  // Restore from an encrypted envelope (reinstall / new device) with the clinic password. Local only after.
  function restoreFromEnvelope(envelope, password) {
    return decryptBackup(envelope, password).then(function (plain) { return importJSON(plain); });
  }
  // Download the encrypted backup FROM Drive (one-time, on reinstall) and restore it into local storage.
  function downloadFromDrive(token) {
    var q = encodeURIComponent("name='" + DRIVE_FILE + "' and trashed=false");
    return fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&spaces=drive&fields=files(id)", { headers: { "Authorization": "Bearer " + token } })
      .then(function (r) { return r.json(); })
      .then(function (fj) {
        var id = fj && fj.files && fj.files[0] && fj.files[0].id; if (!id) return null;
        return fetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", { headers: { "Authorization": "Bearer " + token } }).then(function (r) { return r.ok ? r.text() : null; });
      });
  }
  function restoreFromDrive(password) {
    if (!password) return Promise.resolve({ ok: false, error: "no_password" });
    return getDriveToken().then(function (token) {
      if (!token) return { ok: false, error: "no_token" };
      return downloadFromDrive(token).then(function (env) {
        if (!env) return { ok: false, error: "no_backup" };
        return restoreFromEnvelope(env, password).then(function (r) { if (r && r.ok) { markBackup(); if (window.SMD_CLINIC) try { renderList(); } catch (e) {} } return r; })
          .catch(function () { return { ok: false, error: "wrong_password" }; });
      });
    }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }

  /* ------------------------------ UI ------------------------------ */
  function flagOn() { try { return localStorage.getItem("smd_personal_clinic") === "1"; } catch (e) { return false; } }
  function toast(m) { try { (window.toast || function () {})(m); } catch (e) {} }
  function root() { var el = document.getElementById("smdClinic"); if (!el) { el = document.createElement("div"); el.id = "smdClinic"; document.body.appendChild(el); injectCSS(); } return el; }

  function open() {
    if (!flagOn()) { toast("Enable My Clinic in Settings first."); return; }
    var el = root(); el.classList.add("on");
    el.onclick = onClick; renderList();
  }
  function close() { var el = document.getElementById("smdClinic"); if (el) el.classList.remove("on"); }

  function renderList() {
    var el = document.getElementById("smdClinic"); if (!el) return;
    var pts = listPatients();
    el.innerHTML =
      '<div class="pc-top"><button class="pc-ic" data-pc="close" aria-label="Close">&#10005;</button>' +
        '<div class="pc-ttl">My Clinic</div>' +
        '<button class="pc-ic" data-pc="backupmenu" aria-label="Backup & sync" title="Backup &amp; Google Drive sync">&#8681;</button></div>' +
      '<div class="pc-body">' +
        '<button class="pc-add" data-pc="new">+ New patient</button>' +
        (pts.length ? '<div class="pc-list">' + pts.map(function (p) {
          var sub = [p.age && (p.age + "y"), p.sex, p.phone].filter(Boolean).join(" · ");
          return '<button class="pc-row" data-pc="open:' + esc(p.id) + '"><div class="pc-row-b"><span class="pc-row-n">' + esc(p.name) + '</span>' +
            (sub ? '<span class="pc-row-s">' + esc(sub) + '</span>' : "") + '</div><span class="pc-row-c">&#8250;</span></button>';
        }).join("") + '</div>'
          : '<div class="pc-empty">No patients yet. Tap <b>+ New patient</b> to start a consult. Everything stays on this phone.</div>') +
        '<div class="pc-foot">On-device EMR · back up to Google Drive from the button above</div>' +
      '</div>';
  }

  function renderNew() {
    var el = document.getElementById("smdClinic"); if (!el) return;
    el.innerHTML =
      '<div class="pc-top"><button class="pc-ic" data-pc="list" aria-label="Back">&#8249;</button><div class="pc-ttl">New patient</div><span class="pc-ic"></span></div>' +
      '<div class="pc-body"><form id="pcForm" class="pc-form">' +
        '<label class="pc-f"><span>Name</span><input name="name" autocomplete="off" required></label>' +
        '<div class="pc-frow"><label class="pc-f"><span>Age</span><input name="age" inputmode="numeric"></label>' +
          '<label class="pc-f"><span>Sex</span><select name="sex"><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select></label></div>' +
        '<label class="pc-f"><span>Phone</span><input name="phone" inputmode="tel" autocomplete="off"></label>' +
        '<button class="pc-add" type="submit">Create + start consult</button>' +
      '</form></div>';
    var f = document.getElementById("pcForm");
    if (f) f.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = {}; ["name", "age", "sex", "phone"].forEach(function (k) { var i = f.elements[k]; if (i) d[k] = i.value; });
      if (!String(d.name || "").trim()) return;
      var id = addPatient(d); openConsult(id);
    });
  }

  function renderBackup() {
    var el = document.getElementById("smdClinic"); if (!el) return;
    el.innerHTML =
      '<div class="pc-top"><button class="pc-ic" data-pc="list" aria-label="Back">&#8249;</button><div class="pc-ttl">Backup &amp; Sync</div><span class="pc-ic"></span></div>' +
      '<div class="pc-body">' +
        '<div class="pc-card"><div class="pc-card-t">Encrypted Google Drive sync</div>' +
          '<div class="pc-card-s" data-pc-status>Checking…</div>' +
          '<form id="pcPw" class="pc-form" style="margin-top:10px">' +
            '<label class="pc-f"><span>Clinic backup password</span><input name="pw" type="password" autocomplete="new-password" placeholder="Set / change password"></label>' +
            '<button class="pc-add" type="submit" style="margin:0">Save password</button></form>' +
          '<button class="pc-btn2" data-pc="syncnow" style="margin-top:10px">Sync to Google Drive now</button>' +
        '</div>' +
        '<div class="pc-card"><div class="pc-card-t">Local backup file</div>' +
          '<div class="pc-card-s">Save an encrypted-or-plain copy to Files / share to Drive manually.</div>' +
          '<button class="pc-btn2" data-pc="backupfile" style="margin-top:10px">Save backup file</button></div>' +
        '<div class="pc-card"><div class="pc-card-t">Restore from Google Drive</div>' +
          '<div class="pc-card-s">New phone or reinstall? Set the SAME clinic password above, then restore all your patients from the encrypted Drive backup.</div>' +
          '<button class="pc-btn2" data-pc="restore" style="margin-top:10px">Restore from Drive</button></div>' +
        '<div class="pc-foot">Backups are encrypted with your clinic password (AES-256). Data lives on THIS phone for instant access; Drive is only a daily encrypted backup. Only StewardMD with that password can open a backup — keep the password safe, it cannot be recovered without it.</div>' +
      '</div>';
    var f = document.getElementById("pcPw");
    if (f) f.addEventListener("submit", function (e) { e.preventDefault(); var v = f.elements.pw && f.elements.pw.value; if (!v || v.length < 4) { toast("Use at least 4 characters."); return; } setPassword(v).then(function () { toast("Backup password saved."); f.elements.pw.value = ""; refreshBackupStatus(); }); });
    refreshBackupStatus();
  }
  function refreshBackupStatus() {
    var s = document.querySelector("#smdClinic [data-pc-status]"); if (!s) return;
    hasPassword().then(function (has) {
      var drive = !!(window.SMD_getDriveToken);
      s.innerHTML = (has ? "Password set. " : "<b>Set a password to enable sync.</b> ") +
        (drive ? "Auto-syncs an encrypted backup to Google Drive after every save." : "Google sign-in required for Drive sync.");
    });
  }
  function openConsult(id) {
    var p = getPatient(id); if (!p) return;
    close();
    var author = (function () { try { var u = window.SMD_AUTH && SMD_AUTH.currentUser; return (u && (u.displayName || u.email)) || ""; } catch (e) { return ""; } })();
    if (window.OPDEMR && OPDEMR.openProfile) OPDEMR.openProfile({ source: "local", localStore: localStore, name: p.name, patientId: id, displayId: p.mrn || "", author: author, tab: "assess" });
    else toast("EMR module not available.");
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-pc]"); if (!b) return;
    var act = b.getAttribute("data-pc");
    if (act === "close") return close();
    if (act === "list") return renderList();
    if (act === "new") return renderNew();
    if (act === "backupmenu") return renderBackup();
    if (act === "syncnow") { Promise.resolve(syncNow()).then(function (r) { toast(r && r.ok ? "Synced to Google Drive." : (r && r.error === "no_password" ? "Set a backup password first." : r && r.error === "no_token" ? "Sign in with Google (Drive) to sync." : "Sync failed — check the Drive setup.")); }); return; }
    if (act === "backupfile") { Promise.resolve(backup()).then(function (r) { toast(r && r.ok ? (r.downloaded ? "Backup downloaded." : "Choose where to save your backup.") : "Backup failed."); }); return; }
    if (act === "restore") {
      getPassword().then(function (pw) {
        if (!pw) { toast("Set your clinic password first (the one you backed up with)."); return; }
        toast("Restoring from Drive…");
        Promise.resolve(restoreFromDrive(pw)).then(function (r) {
          toast(r && r.ok ? ("Restored " + (r.added || 0) + " patient(s) from Drive.") :
            r && r.error === "no_backup" ? "No backup found in your Drive." :
            r && r.error === "wrong_password" ? "Wrong password for this backup." :
            r && r.error === "no_token" ? "Sign in with Google to restore." : "Restore failed.");
        });
      });
      return;
    }
    if (act.indexOf("open:") === 0) return openConsult(act.slice(5));
  }

  function injectCSS() {
    if (document.getElementById("smd-clinic-css")) return;
    var s = document.createElement("style"); s.id = "smd-clinic-css";
    s.textContent = [
      "#smdClinic{position:fixed;inset:0;z-index:12020;display:none;background:var(--bg,#f7f9fb);color:var(--ink,#191c1e);font-family:var(--sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif)}",
      "#smdClinic.on{display:block}",
      "#smdClinic .pc-top{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e2e8f0)}",
      "#smdClinic .pc-ttl{font:800 20px var(--sans);color:var(--ink,#0f172a)}",
      "#smdClinic .pc-ic{min-width:40px;height:40px;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--slate,#475569);border-radius:999px;font-size:18px;cursor:pointer;display:grid;place-items:center}",
      "#smdClinic .pc-body{padding:16px;max-width:640px;margin:0 auto;padding-bottom:calc(24px + env(safe-area-inset-bottom))}",
      "#smdClinic .pc-add{width:100%;border:none;border-radius:14px;background:var(--teal,#0f766e);color:#fff;font:800 15px var(--sans);padding:14px;cursor:pointer;margin-bottom:16px}",
      "#smdClinic .pc-list{display:flex;flex-direction:column;gap:8px}",
      "#smdClinic .pc-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);border-radius:14px;padding:14px;cursor:pointer}",
      "#smdClinic .pc-row-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
      "#smdClinic .pc-row-n{font:700 15px var(--sans);color:var(--ink,#0f172a)}",
      "#smdClinic .pc-row-s{font:500 12.5px var(--sans);color:var(--slate-soft,#64748b)}",
      "#smdClinic .pc-row-c{color:var(--slate-soft,#94a3b8);font-size:20px}",
      "#smdClinic .pc-empty{text-align:center;color:var(--slate-soft,#64748b);font:500 13.5px/1.6 var(--sans);padding:24px 12px;border:1px dashed var(--line,#cbd5e1);border-radius:14px}",
      "#smdClinic .pc-foot{text-align:center;color:var(--slate-soft,#94a3b8);font:600 11px var(--sans);margin-top:16px}",
      "#smdClinic .pc-form{display:flex;flex-direction:column;gap:12px}",
      "#smdClinic .pc-frow{display:flex;gap:12px}#smdClinic .pc-frow .pc-f{flex:1}",
      "#smdClinic .pc-f{display:flex;flex-direction:column;gap:5px}",
      "#smdClinic .pc-f>span{font:700 12px var(--sans);color:var(--slate,#475569)}",
      "#smdClinic .pc-f input,#smdClinic .pc-f select{border:1.5px solid var(--line,#e2e8f0);border-radius:11px;padding:12px;font:500 15px var(--sans);background:var(--panel,#fff);color:var(--ink,#0f172a)}",
      "#smdClinic .pc-card{border:1px solid var(--line,#e2e8f0);border-radius:14px;background:var(--panel,#fff);padding:14px;margin-bottom:14px}",
      "#smdClinic .pc-card-t{font:800 15px var(--sans);color:var(--ink,#0f172a);margin-bottom:4px}",
      "#smdClinic .pc-card-s{font:500 12.5px/1.5 var(--sans);color:var(--slate-soft,#64748b)}",
      "#smdClinic .pc-btn2{width:100%;border:1px solid var(--teal,#0f766e);background:var(--teal-soft,#e3f1ee);color:var(--teal,#0f766e);font:800 14px var(--sans);padding:12px;border-radius:11px;cursor:pointer}",
      "body.dark #smdClinic{--bg:#191c1e;--panel:#1f2325;--ink:#eff1f3;--line:#3d4947}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  var API = { open: open, close: close, flagOn: flagOn, localStore: localStore,
    listPatients: listPatients, getPatient: getPatient, addPatient: addPatient, deletePatient: deletePatient,
    getConsult: getConsult, saveConsult: saveConsult, startConsult: startConsult, timeline: timeline, exportJSON: exportJSON, importJSON: importJSON,
    backup: backup, configure: configure,
    encryptBackup: encryptBackup, decryptBackup: decryptBackup, setPassword: setPassword, getPassword: getPassword, hasPassword: hasPassword,
    syncNow: syncNow, restoreFromEnvelope: restoreFromEnvelope, restoreFromDrive: restoreFromDrive, lastBackupAt: lastBackupAt };
  if (typeof window !== "undefined") window.SMD_CLINIC = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
