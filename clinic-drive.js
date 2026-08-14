/* clinic-drive.js — Shared Clinic EMR Drive transport adapter (Phase 6, native). Implements the sync
 * engine's { list, get, put } transport over the clinic's ONE Google Drive account, reusing the EXISTING
 * native drive.file token (window.SMD_getDriveToken) and the same multipart REST as personal-clinic.js.
 *
 * Each sync delta is one small, opaque-ciphertext Drive file. drive.file scope is sufficient because —
 * per the owner's "one clinic Drive, direct sync" choice — ALL devices use the SAME clinic Google account
 * and the SAME app, so each device sees the app-created delta files in that account. The engine names
 * batches "<clinicId>/<deviceId>.<batch>.smddelta"; we store them as flat Drive names with "/" -> "~"
 * (a Drive-safe separator) so there is no path ambiguity, and map back on list() so the engine parses
 * them unchanged.
 *
 * On-device only: window.SMD_getDriveToken is native (returns null on web) — available() reports that.
 * PHI never appears here: the blobs are already AES-GCM ciphertext from clinic-crypto. Pure name/query
 * helpers are exported for tests; the live Drive round-trip is verified on a real device.
 * window.SMD_CLINIC_DRIVE.create(clinicId).
 */
(function () {
  "use strict";
  var g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);
  var BASE = "https://www.googleapis.com";

  // ---- pure helpers (node-tested) ----
  var SEP = "~";                                   // Drive-safe stand-in for the engine's "/"
  function driveName(engineName) { return String(engineName).replace(/\//g, SEP); }
  function engineName(dName) { return String(dName).replace(new RegExp(SEP, "g"), "/"); }
  function clinicPrefix(clinicId) { return clinicId ? (clinicId + SEP) : ""; }
  // Drive query: this app's non-trashed delta files for this clinic.
  function listQuery(clinicId) {
    var p = clinicPrefix(clinicId);
    return "name contains '" + p + "' and name contains '.smddelta' and trashed = false";
  }

  // ---- native Google Drive token (drive.file), cached ~50 min like personal-clinic ----
  var _tok = null, _tokAt = 0;
  function getToken() {
    var now = 0; try { now = Date.now(); } catch (e) {}
    if (_tok && (now - _tokAt) < 50 * 60 * 1000) return Promise.resolve(_tok);
    try {
      if (g.SMD_getDriveToken) {
        return Promise.resolve(g.SMD_getDriveToken()).then(function (t) {
          if (t) { _tok = t; try { _tokAt = Date.now(); } catch (e) {} }
          return t || null;
        });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  function create(clinicId, deps) {
    deps = deps || {};
    var fetchFn = deps.fetch || g.fetch;                 // injectable for tests
    var token = deps.getToken || getToken;
    var boundary = "smdclinicdelta";

    function authGet(url) {
      return token().then(function (t) {
        if (!t) throw new Error("no_token");
        return fetchFn(url, { headers: { Authorization: "Bearer " + t } });
      });
    }

    // list -> [engine names] (only files this clinic/app created, non-trashed)
    function list() {
      var url = BASE + "/drive/v3/files?q=" + encodeURIComponent(listQuery(clinicId)) +
        "&spaces=drive&fields=" + encodeURIComponent("files(id,name)") + "&pageSize=1000";
      return authGet(url).then(function (r) { return r.json(); }).then(function (j) {
        return ((j && j.files) || []).map(function (f) { return engineName(f.name); });
      });
    }

    // get(engineName) -> the ciphertext blob (string)
    function get(name) {
      var dn = driveName(name);
      var q = "name = '" + dn.replace(/'/g, "\\'") + "' and trashed = false";
      var url = BASE + "/drive/v3/files?q=" + encodeURIComponent(q) + "&spaces=drive&fields=" + encodeURIComponent("files(id)");
      return authGet(url).then(function (r) { return r.json(); }).then(function (j) {
        var id = j && j.files && j.files[0] && j.files[0].id;
        if (!id) return null;
        return authGet(BASE + "/drive/v3/files/" + id + "?alt=media").then(function (r) { return r.ok ? r.text() : null; });
      });
    }

    // put(engineName, blob) -> create one immutable delta file (deltas are append-only; never updated)
    function put(name, blob) {
      var dn = driveName(name);
      var meta = JSON.stringify({ name: dn, description: "StewardMD Shared Clinic encrypted delta" });
      var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
        "\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n" + String(blob) +
        "\r\n--" + boundary + "--";
      return token().then(function (t) {
        if (!t) throw new Error("no_token");
        return fetchFn(BASE + "/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          headers: { Authorization: "Bearer " + t, "Content-Type": "multipart/related; boundary=" + boundary },
          body: body
        });
      }).then(function (r) { if (!r.ok) throw new Error("drive_" + r.status); return { ok: true }; });
    }

    // Non-secret clinic config (clinicId, salt, name) — one plaintext file per clinic so a SECOND device
    // signing into the same clinic Google account can discover the clinic + its (public) salt and, with
    // the passphrase, derive the same key. No PHI + no secret here (the salt is public by design).
    function putConfig(obj) { return put(clinicId + "/clinic.config", JSON.stringify(obj)); }
    function getConfig() { return get(clinicId + "/clinic.config").then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }); }

    function available() {
      try { return !!g.SMD_getDriveToken; } catch (e) { return false; }
    }

    return { list: list, get: get, put: put, putConfig: putConfig, getConfig: getConfig, available: available, clinicId: clinicId };
  }

  // Discover the clinic(s) already set up in the signed-in Drive account (for device join). Returns the
  // parsed non-secret config objects. drive.file only returns THIS app's files, so this is the clinic's own.
  function discover(deps) {
    deps = deps || {};
    var fetchFn = deps.fetch || g.fetch, token = deps.getToken || getToken;
    var url = BASE + "/drive/v3/files?q=" + encodeURIComponent("name contains '~clinic.config' and trashed = false") +
      "&spaces=drive&fields=" + encodeURIComponent("files(id,name)");
    return token().then(function (t) { if (!t) throw new Error("no_token"); return fetchFn(url, { headers: { Authorization: "Bearer " + t } }); })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var files = (j && j.files) || [];
        return Promise.all(files.map(function (f) {
          return token().then(function (t) { return fetchFn(BASE + "/drive/v3/files/" + f.id + "?alt=media", { headers: { Authorization: "Bearer " + t } }); })
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (txt) { try { return txt ? JSON.parse(txt) : null; } catch (e) { return null; } });
        })).then(function (cs) { return cs.filter(Boolean); });
      });
  }

  var API = {
    create: create, discover: discover,
    // pure helpers exported for tests
    _driveName: driveName, _engineName: engineName, _listQuery: listQuery, _clinicPrefix: clinicPrefix
  };
  if (typeof window !== "undefined") window.SMD_CLINIC_DRIVE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
