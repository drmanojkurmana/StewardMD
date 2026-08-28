/* steward-id.js — universal StewardMD ID (SMD-XXXXXX) mint + backfill (SMD_STEWARD_ID).
 * The human-facing account identifier. Format + emailHash are byte-identical to the original
 * icu-collab.js implementation so existing doctorDirectory entries resolve unchanged. Unlike the
 * old ICU path, ensure() is NOT gated on ICU membership — it mints for every signed-in user.
 * All Firebase access is injected via deps so the logic is unit-testable in node. */
(function () {
  "use strict";
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 chars, no 0/O/1/I/L
  // The cache is keyed on the UID it was resolved for. Once the ID is minted for every signed-in
  // user (not just ICU group users), sign-out → sign-in as someone else happens in one page
  // lifetime, and a uid-less cache would hand the second account the FIRST account's ID — which
  // then travels into referrals, invites and the directory. Never cache identity without its owner.
  var _cache = { uid: null, smdId: null };
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
  // my([uid]) — the resolved ID, or null. Pass the uid (or let it read the signed-in one) so a value
  // cached for a PREVIOUS account is never handed out after a sign-out/sign-in.
  function my(uid) {
    if (!_cache.smdId) return null;
    var who = uid;
    if (who == null) { try { var u = bUser(); who = u && u.uid; } catch (e) { who = null; } }
    if (who && _cache.uid && who !== _cache.uid) return null;
    return _cache.smdId;
  }

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
    var db = getDb(), uid = getUid();
    if (!db || !uid) { cb && cb(null); return; }
    if (_cache.uid !== uid) { _cache.uid = uid; _cache.smdId = null; }   // account switched — re-resolve
    if (_cache.smdId) { cb && cb(_cache.smdId); return; }
    profRef(db, uid).get().then(function (snap) {
      var data = (snap && snap.exists) ? (snap.data() || {}) : {};
      if (data.smdId) { _cache.uid = uid; _cache.smdId = data.smdId; cb && cb(data.smdId); return; }
      adoptOrMint(db, uid, getName(), getEmail(), serverTs, cb);
    }, function () {
      // A FAILED read is NOT "this user has no ID". Minting here is how a permanent ID changed:
      // one unreachable-Firestore moment (native cold start, flaky ward wifi) and the user came
      // back with a brand-new SMD-XXXXXX that overwrote the old one everywhere. Fail closed —
      // the next ensure() retries and the real ID comes back.
      cb && cb(null);
    });
  }

  // No smdId on the private profile doc. Before minting, look the user up in their own email
  // index: that pointer survives a lost/unreadable profile doc, so the SAME account gets the SAME
  // ID back instead of a new one. Only ever adopts a pointer this uid already owns.
  function adoptOrMint(db, uid, name, email, serverTs, cb) {
    if (!email) { mint(db, uid, name, email, serverTs, 0, cb); return; }
    dirRef(db, "e_" + emailHash(email)).get().then(function (d) {
      var cur = (d && d.exists && d.data) ? (d.data() || {}) : {};
      if (cur.smdId && cur.uid === uid) {
        claimProfile(db, uid, cur.smdId, name, serverTs && serverTs(), function (id) {
          _cache.uid = uid; _cache.smdId = id; cb && cb(id);
        });
        return;
      }
      mint(db, uid, name, email, serverTs, 0, cb);
    }, function () {
      // Same reasoning as above: an unreadable index may be hiding an existing ID.
      cb && cb(null);
    });
  }

  // Write smdId onto users/{uid}/profile/self, but NEVER over one that is already there — two
  // devices signing in at once both mint, and the loser must adopt the winner's ID rather than
  // renaming the account. Returns the id that actually stands.
  function claimProfile(db, uid, smdId, name, ts, cb) {
    var pr = profRef(db, uid);
    db.runTransaction(function (tx) {
      return tx.get(pr).then(function (d) {
        var cur = (d && d.exists && d.data) ? (d.data() || {}) : {};
        if (cur.smdId) return cur.smdId;
        tx.set(pr, { smdId: smdId, name: name, at: ts }, { merge: true });
        return smdId;
      });
    }).then(function (id) { cb(id || smdId); }, function () { cb(smdId); });
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
      // The profile doc decides — if another device minted first, that ID wins and this one is
      // abandoned (its directory row is an unreferenced orphan, which costs nothing).
      claimProfile(db, uid, smdId, name, ts, function (finalId) {
        _cache.uid = uid; _cache.smdId = finalId;
        // Email-index write is GUARDED: never overwrite an e_{hash} pointer that already belongs to a
        // DIFFERENT uid (one-email-one-account). Chained before cb so the write order is deterministic.
        var p = Promise.resolve();
        if (email) {
          var eRef = dirRef(db, "e_" + emailHash(email));
          try {
            p = db.runTransaction(function (tx) {
              return tx.get(eRef).then(function (d) {
                var cur = d && d.exists && d.data ? (d.data() || {}) : {};
                if (cur.uid && cur.uid !== uid) return;   // owned by another account — leave it alone
                tx.set(eRef, { uid: uid, name: name, smdId: finalId, at: ts }, { merge: true });
              });
            }).catch(function () {});
          } catch (e) { p = Promise.resolve(); }
        }
        p.then(function () { cb && cb(finalId); });
      });
    }, function () {
      if (attempt < 6) { mint(db, uid, name, email, serverTs, attempt + 1, cb); return; }
      cb && cb(null);
    });
  }

  var API = { genId: genId, emailHash: emailHash, normalizeId: normalizeId, my: my, ensure: ensure, _reset: function () { _cache.uid = null; _cache.smdId = null; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_STEWARD_ID = API;
})();
