/* steward-id.js — universal StewardMD ID (SMD-XXXXXX) mint + backfill (SMD_STEWARD_ID).
 * The human-facing account identifier. Format + emailHash are byte-identical to the original
 * icu-collab.js implementation so existing doctorDirectory entries resolve unchanged. Unlike the
 * old ICU path, ensure() is NOT gated on ICU membership — it mints for every signed-in user.
 * All Firebase access is injected via deps so the logic is unit-testable in node. */
(function () {
  "use strict";
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 chars, no 0/O/1/I/L
  var _cache = { smdId: null };
  function randChar(a) { return a.charAt(Math.floor(Math.random() * a.length)); }
  function genId() { var s = ""; for (var i = 0; i < 6; i++) s += randChar(ALPHABET); return "SMD-" + s; }
  function emailHash(email) {
    var s = String(email || "").trim().toLowerCase();
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
      h2 = (((h2 << 5) + h2) + c) >>> 0;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  function normalizeId(s) {
    s = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
    if (s && s.indexOf("SMD-") !== 0 && /^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
    return s;
  }
  function my() { return _cache.smdId || null; }

  // Browser defaults for deps (overridden in tests). Mirrors icu-collab's fs()/currentUid()/etc.
  function bDb() {
    try { return (window.firebase && window.firebase.apps && window.firebase.apps.length) ? window.firebase.firestore() : null; } catch (e) { return null; }
  }
  function bUser() { try { return window.firebase && window.firebase.auth().currentUser; } catch (e) { return null; } }
  function bServerTs() { try { return window.firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return null; } }

  function profRef(db, uid) { return db.collection("users").doc(uid).collection("profile").doc("self"); }
  function dirRef(db, key) { return db.collection("doctorDirectory").doc(key); }

  function ensure(deps, cb) {
    deps = deps || {};
    var getDb = deps.getDb || bDb;
    var getUid = deps.getUid || function () { var u = bUser(); return u && u.uid; };
    var getName = deps.getName || function () { var u = bUser(); return (u && (u.displayName || "")) || ""; };
    var getEmail = deps.getEmail || function () { var u = bUser(); return (u && (u.email || "")) || ""; };
    var serverTs = deps.serverTimestamp || bServerTs;
    if (_cache.smdId) { cb && cb(_cache.smdId); return; }
    var db = getDb(), uid = getUid();
    if (!db || !uid) { cb && cb(null); return; }
    profRef(db, uid).get().then(function (snap) {
      var data = (snap && snap.exists) ? (snap.data() || {}) : {};
      if (data.smdId) { _cache.smdId = data.smdId; cb && cb(data.smdId); return; }
      mint(db, uid, getName(), getEmail(), serverTs, 0, cb);
    }, function () { mint(db, uid, getName(), getEmail(), serverTs, 0, cb); });
  }

  function mint(db, uid, name, email, serverTs, attempt, cb) {
    if (attempt > 6) { cb && cb(null); return; }
    var smdId = genId(), ts = serverTs && serverTs();
    var ref = dirRef(db, smdId);
    db.runTransaction(function (tx) {
      return tx.get(ref).then(function (d) {
        if (d && d.exists) return Promise.reject(new Error("smdid-collision"));
        tx.set(ref, { uid: uid, name: name, at: ts });
        return smdId;
      });
    }).then(function () {
      _cache.smdId = smdId;
      try { profRef(db, uid).set({ smdId: smdId, name: name, at: ts }, { merge: true }).catch(function () {}); } catch (e) {}
      try { if (email) dirRef(db, "e_" + emailHash(email)).set({ uid: uid, name: name, smdId: smdId, at: ts }, { merge: true }).catch(function () {}); } catch (e) {}
      cb && cb(smdId);
    }, function () {
      if (attempt < 6) { mint(db, uid, name, email, serverTs, attempt + 1, cb); return; }
      cb && cb(null);
    });
  }

  var API = { genId: genId, emailHash: emailHash, normalizeId: normalizeId, my: my, ensure: ensure, _reset: function () { _cache.smdId = null; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ID = API;
})();
