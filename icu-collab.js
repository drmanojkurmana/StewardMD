/* StewardMD — ICU collaboration backend (additive; NEVER edits the minified app.js).
 * ---------------------------------------------------------------------------
 * PHASE 2 of the ICU v2 redesign. A pure DATA + subscription layer over the app's
 * existing Firebase stack (the same one SMD_CASES / caseshare use). NO DOM: icu.js
 * owns all rendering; this module only reads/writes Firestore and streams snapshots.
 *
 *   window.SMD_ICU_GROUPS — { enabled, subscribeGroups, subscribeMembers, createGroup,
 *     inviteMember, setRole, addByIdOrEmail, leaveGroup, removeMember, deleteGroup,
 *     createInvite, getInvite, joinByInvite, inviteUrl, ensureIdentity, myDoctorId,
 *     resolveDoctor, subscribePatients, subscribePatient, upsertPatient, setReviewed,
 *     addTimelineEvent, subscribeTasks, addTask, setTaskStatus, enterPatient,
 *     leavePatient, subscribePresence, syncState, unsubscribeAll, … }
 *
 * PHASE 5 reworks the membership model: members move OFF the group doc (array/map) into a
 * per-unit SUBCOLLECTION, so a colleague can self-join by an invite link under tight rules
 * (deny-by-default). Every doctor also gets an account-linked StewardMD Doctor ID (SMD-XXXXXX)
 * minted lazily under the flag; the directory is get-by-exact-key only (never listable).
 *
 * Firestore data model (per-hospital unit; security by membership + role — see
 * firestore.rules):
 *   icuGroups/{gid}                      { name, unit, hospital, createdBy, createdAt }
 *   icuGroups/{gid}/members/{uid}        { uid, role, name, addedBy, joinedAt, via? }
 *                                        role ∈ head|professor|assistant|senior_resident|
 *                                               junior_resident|intern
 *   icuGroups/{gid}/invites/{code}       { role, createdBy, createdByName, expiresAt, unit, name }
 *                                        (role is a LINK role only — never head/professor)
 *   icuGroups/{gid}/patients/{pid}       mirror of ICU_STATE + { severity, reviewedAt,
 *                                          reviewedBy, lastUpdate:{by,byName,text,at},
 *                                          assignedTo }
 *   .../patients/{pid}/timeline/{eid}    { ts, type, title, detail, by, byName, byRole }  (append-only audit)
 *   .../patients/{pid}/tasks/{tid}       { text, status, assignedBy, assignedByName,
 *                                          completedBy, completedByName, completedAt, due, ts }
 *   .../patients/{pid}/presence/{uid}    { name, at }
 *   users/{uid}/profile/self             { smdId, name, at }  (private cache of my Doctor ID)
 *   doctorDirectory/{smdId}              { uid, name, at }    (source-of-truth for ID uniqueness)
 *   doctorDirectory/e_{emailHash}        { uid, name, smdId, at }  (email→doctor lookup; hashed key)
 *
 * EVERY function is a safe no-op / graceful reject when the flag is OFF, Firebase /
 * Firestore is unavailable, or the user is signed out. Nothing here ever throws to a
 * caller — the board must never crash.
 *
 * PHI posture: shared docs hold PHI; the access boundary is group membership (rules).
 * caseshare's EXTERNAL-share sanitisation is untouched — this is an internal, member-
 * only surface. Existing consent/disclaimers are unaffected.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ roles */
  var ROLES = ["head", "professor", "assistant", "senior_resident", "junior_resident", "intern"];
  // Roles allowed to INSTRUCT (create tasks, delete patients, etc.). Enforced here (UI)
  // AND in firestore.rules — this list must stay in sync with rules' canInstruct().
  var INSTRUCT = ["head", "professor", "assistant", "senior_resident"];
  // ADMIN roles may manage membership (invite/add/remove/role-change). Head is the ONLY role
  // that can grant 'professor' or delete the unit; head can never be removed.
  var ADMIN = ["head", "professor"];
  // Roles an invite LINK may confer — NEVER head/professor (a link can't mint an admin). Must
  // stay in sync with the rules' self-join-via-link allow-list.
  var LINK_ROLES = ["assistant", "senior_resident", "junior_resident", "intern"];
  var ROLE_LABEL = {
    head: "Unit Head", professor: "Professor", assistant: "Assistant Professor",
    senior_resident: "Senior Resident", junior_resident: "Junior Resident", intern: "Intern"
  };
  function canInstruct(role) { return INSTRUCT.indexOf(role) >= 0; }
  function isAdminRole(role) { return ADMIN.indexOf(role) >= 0; }
  function roleLabel(r) { return ROLE_LABEL[r] || (r ? String(r) : "Member"); }
  function normRole(r) { return ROLES.indexOf(r) >= 0 ? r : "junior_resident"; }
  // Clamp an invite-link role to a NON-admin role (default junior_resident). A link can never
  // confer head/professor — mirrored server-side in firestore.rules.
  function normInviteRole(r) { return LINK_ROLES.indexOf(r) >= 0 ? r : "junior_resident"; }

  /* ------------------------------------------------------------------- flag */
  // ?icugroups=1/0 → localStorage['smd_icu_groups'] → default OFF.
  function icuGroupsOn() {
    try {
      var q = (location.search.match(/[?&]icugroups=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return localStorage.getItem("smd_icu_groups") === "1";
    } catch (e) { return false; }
  }

  /* --------------------------------------------------- firebase / firestore */
  var _db = null, _persistTried = false;
  function fbReady() { try { return !!(window.firebase && window.firebase.firestore); } catch (e) { return false; } }
  function getDb() {
    try {
      if (_db) return _db;
      if (window.SMD_DB) { _db = window.SMD_DB; return _db; }
      if (window.firebase && firebase.firestore) { _db = firebase.firestore(); return _db; }
    } catch (e) {}
    return null;
  }
  function fieldValue() {
    try { return window.firebase.firestore.FieldValue; } catch (e) {}
    // stub so pure-logic tests / offline never throw
    return { serverTimestamp: function () { return null; }, arrayUnion: function () { return arguments[0]; } };
  }
  function currentUid() {
    try {
      var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
      return (a && a.currentUser && a.currentUser.uid) || null;
    } catch (e) { return null; }
  }
  function currentName() {
    try {
      if (window.SMD_ACCOUNT && SMD_ACCOUNT.profile) {
        var p = SMD_ACCOUNT.profile();
        if (p && (p.name || p.email)) return p.name || p.email;
      }
    } catch (e) {}
    return "Clinician";
  }
  function currentEmail() {
    try {
      if (window.SMD_ACCOUNT && SMD_ACCOUNT.profile) {
        var p = SMD_ACCOUNT.profile();
        if (p && p.email) return String(p.email).trim().toLowerCase();
      }
    } catch (e) {}
    return "";
  }
  // Enable offline persistence ONCE. Failure (multi-tab / unsupported / firestore already
  // started) is expected and ignored — the app boots firestore in app.js, so this often
  // rejects; that's fine.
  function enablePersistenceOnce(db) {
    if (_persistTried || !db) return;
    _persistTried = true;
    try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
  }
  // Lazy: ensure Firebase is loaded, then hand back firestore() (or null). Never throws.
  function fs(cb) {
    if (!icuGroupsOn()) { cb && cb(null); return; }
    function done() { var db = getDb(); if (db) enablePersistenceOnce(db); cb && cb(db || null); }
    if (fbReady()) { done(); return; }
    try {
      if (window.SMD_loadFirebase) { window.SMD_loadFirebase(done); return; }
    } catch (e) {}
    done();
  }

  /* -------------------------------------------------- in-flight sync signal */
  var _net = { online: (typeof navigator !== "undefined") ? (navigator.onLine !== false) : true };
  var _meta = { fromCache: false, pendingWrites: false };
  var _inflight = 0;
  try { window.addEventListener("online", function () { _net.online = true; }); } catch (e) {}
  try { window.addEventListener("offline", function () { _net.online = false; }); } catch (e) {}
  function track(promise) {
    _inflight++;
    function dec() { _inflight = Math.max(0, _inflight - 1); }
    return promise.then(function (v) { dec(); return v; }, function (e) { dec(); throw e; });
  }
  // 'synced' | 'syncing' | 'offline' — from navigator.onLine + Firestore metadata + writes in flight.
  function syncState() {
    if (!icuGroupsOn()) return "synced";       // inert when off
    if (!_net.online) return "offline";
    if (_inflight > 0 || _meta.pendingWrites || _meta.fromCache) return "syncing";
    return "synced";
  }

  /* ------------------------------------------------ subscription bookkeeping */
  // Every subscribe*() returns a teardown fn AND is tracked so unsubscribeAll() can
  // nuke everything (mirrors the per-patient _dxPt/_corrPt reset discipline in icu.js).
  var _active = [];
  function makeSub(setup) {
    var st = { off: null, cancelled: false };
    var teardown = function () {
      st.cancelled = true;
      if (st.off) { try { st.off(); } catch (e) {} st.off = null; }
      var i = _active.indexOf(teardown); if (i >= 0) _active.splice(i, 1);
    };
    _active.push(teardown);
    fs(function (db) {
      if (st.cancelled) return;
      if (!db) return;                          // firebase unavailable → inert (caller already got its initial cb)
      try { st.off = setup(db) || null; } catch (e) { st.off = null; }
    });
    return teardown;
  }
  function unsubscribeAll() {
    var list = _active.slice();
    for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
    _active = [];
    try { leavePatient(); } catch (e) {}
  }

  /* --------------------------------------------------------- shape helpers */
  function tsToMs(t) {
    if (t == null) return null;
    if (typeof t === "number") return t;
    try {
      if (typeof t.toMillis === "function") return t.toMillis();
      if (typeof t.seconds === "number") return t.seconds * 1000;
    } catch (e) {}
    return null;
  }
  function nowMs() { return Date.now(); }
  // Strip DERIVED alerts (recomputed on load, exactly like savePatient) but keep everything
  // else — crucially ICU_STATE.src (engine-scored source tags) is carried through unchanged.
  function sanitizeState(state) {
    var clean;
    try { clean = JSON.parse(JSON.stringify(state || {})); } catch (e) { clean = {}; }
    clean.alerts = [];
    return clean;
  }
  // Map a group doc → the shape icu.js consumes. PHASE 5: members/roles no longer live on the
  // group doc — they're a subcollection (see subscribeMembers). myRole is supplied by the
  // membership query (subscribeGroups). members/roles are kept as empty defaults for callers
  // that still reference them; the live roster comes from subscribeMembers.
  function mapGroupDoc(id, data, uid, role) {
    data = data || {};
    return {
      id: id, name: data.name || "", unit: data.unit || "", hospital: data.hospital || "",
      roles: {}, members: [], createdBy: data.createdBy || null,
      myRole: role || null
    };
  }
  function mapMemberDoc(id, data) {
    data = data || {};
    return {
      uid: id, role: data.role || null, name: data.name || "",
      addedBy: data.addedBy || null, joinedAt: tsToMs(data.joinedAt), via: data.via || null
    };
  }
  function myRole(group) {
    if (!group) return null;
    return group.myRole || null;
  }
  // Map a shared patient doc → the SAME board-card base shape v2BoardList produces in icu.js
  // ({id,name,dx,bed,savedAt,state,…}), so the existing board renderer is reused. icu.js applies
  // the deterministic v2Severity/v2Snapshot enrichment on top (single source of truth for acuity).
  function mapPatientDoc(id, data) {
    data = data || {};
    var st = data.state || {};
    var pt = st.patient || {};
    return {
      id: id,
      name: (data.name != null && data.name !== "") ? data.name : (pt.name || "Patient"),
      dx: (data.dx != null && data.dx !== "") ? data.dx : (pt.diagnosis || ""),
      bed: (data.bed != null && data.bed !== "") ? data.bed : (pt.bed || ""),
      savedAt: data.savedAt || tsToMs(data.updatedAt) || tsToMs(data.reviewedAt) || null,
      state: st,
      severity: data.severity || null,
      reviewedAt: tsToMs(data.reviewedAt),
      reviewedBy: data.reviewedBy || null,
      reviewedByName: data.reviewedByName || "",
      lastUpdate: mapLastUpdate(data.lastUpdate),
      assignedTo: data.assignedTo || null
    };
  }
  function mapLastUpdate(lu) {
    if (!lu) return null;
    return { by: lu.by || null, byName: lu.byName || "", text: lu.text || "", at: tsToMs(lu.at) };
  }
  function mapTimeline(id, data) {
    data = data || {};
    return {
      id: id, ts: tsToMs(data.ts), type: data.type || "note", title: data.title || "",
      detail: data.detail || "", by: data.by || null, byName: data.byName || "", byRole: data.byRole || null
    };
  }
  function mapTask(id, data) {
    data = data || {};
    return {
      id: id, text: data.text || "", status: normStatus(data.status),
      assignedBy: data.assignedBy || null, assignedByName: data.assignedByName || "",
      completedBy: data.completedBy || null, completedByName: data.completedByName || "",
      completedAt: tsToMs(data.completedAt), due: data.due || "", assignedTo: data.assignedTo || null,
      ts: tsToMs(data.ts)
    };
  }
  function normStatus(s) { return (s === "progress" || s === "done") ? s : "pending"; }
  // PURE builders (unit-testable without Firestore) — the writers add serverTimestamp() on top.
  function buildTimelineEvent(ev, who) {
    ev = ev || {}; who = who || {};
    return {
      ts: null, type: ev.type || "note", title: ev.title || "", detail: ev.detail || "",
      by: who.uid || null, byName: who.name || "", byRole: who.role || null
    };
  }
  function buildTask(info, who) {
    info = info || {}; who = who || {};
    return {
      text: info.text || "", status: "pending",
      assignedBy: who.uid || null, assignedByName: who.name || "",
      completedBy: null, completedByName: null, completedAt: null,
      due: info.due || "", assignedTo: info.assignedTo || null, ts: null
    };
  }
  // status ∈ pending|progress|done — writes completedBy/at when done, clears otherwise.
  function taskStatusPatch(status, who) {
    who = who || {};
    var patch = { status: normStatus(status) };
    if (patch.status === "done") {
      patch.completedBy = who.uid || null; patch.completedByName = who.name || ""; patch.completedAt = "@server";
    } else {
      patch.completedBy = null; patch.completedByName = null; patch.completedAt = null;
    }
    return patch;
  }

  /* --------------------------------------------------- active-group context */
  // icu.js calls setActiveGroup() when a unit is selected, so writes can stamp byRole and the
  // instruct-gate can be enforced client-side too (rules are the real boundary).
  var _ctx = { groupId: null, role: null };
  function setActiveGroup(groupId, role) { _ctx.groupId = groupId || null; _ctx.role = role || null; }
  // icu.js injects its deterministic acuity fn so the stored `severity` never duplicates thresholds.
  var _severityFn = null;
  function setSeverityFn(fn) { _severityFn = (typeof fn === "function") ? fn : null; }
  function severityOf(state) { if (!_severityFn) return null; try { return _severityFn(state) || null; } catch (e) { return null; } }

  function grpRef(db, gid) { return db.collection("icuGroups").doc(gid); }
  function ptRef(db, gid, pid) { return grpRef(db, gid).collection("patients").doc(pid); }
  function memRef(db, gid, uid) { return grpRef(db, gid).collection("members").doc(uid); }
  function invRef(db, gid, code) { return grpRef(db, gid).collection("invites").doc(code); }
  function dirRef(db, key) { return db.collection("doctorDirectory").doc(key); }
  function profRef(db, uid) { return db.collection("users").doc(uid).collection("profile").doc("self"); }

  /* ------------------------------------------------------------------ groups */
  // onErr (optional) — called with the snapshot error (e.g. permission-denied) so the UI can show
  // a non-technical error state + Retry. When omitted, falls back to the old cb([]) behaviour.
  //
  // PHASE 5: "units I belong to" = a collectionGroup('members') query where uid == me. For each
  // membership we hold its parent group doc + my role and re-emit the merged list on any change.
  // (Requires the members collection-group index — see firestore.indexes.json.)
  function subscribeGroups(cb, onErr) {
    if (!icuGroupsOn() || !currentUid()) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      var uid = currentUid();
      if (!uid) { cb && cb([]); return null; }
      var myRoles = {};      // gid -> my role (from the member doc)
      var groupData = {};    // gid -> group doc data (undefined=loading, null=missing/denied)
      var groupOffs = {};    // gid -> group-doc listener teardown
      function emit() {
        var out = [];
        for (var gid in myRoles) {
          if (!myRoles.hasOwnProperty(gid)) continue;
          var d = groupData[gid];
          if (d === undefined || d === null) continue;   // not loaded / gone
          out.push(mapGroupDoc(gid, d, uid, myRoles[gid]));
        }
        cb && cb(out);
      }
      var memOff = db.collectionGroup("members").where("uid", "==", uid)
        .onSnapshot({ includeMetadataChanges: true }, function (snap) {
          try { _meta.fromCache = !!(snap.metadata && snap.metadata.fromCache); _meta.pendingWrites = !!(snap.metadata && snap.metadata.hasPendingWrites); } catch (e) {}
          var seen = {};
          snap.forEach(function (mdoc) {
            var gref = mdoc.ref && mdoc.ref.parent && mdoc.ref.parent.parent;   // icuGroups/{gid}
            if (!gref) return;
            var gid = gref.id; seen[gid] = true;
            myRoles[gid] = (mdoc.data() || {}).role || null;
            if (!groupOffs[gid]) {
              groupData[gid] = undefined;
              groupOffs[gid] = gref.onSnapshot(function (gd) {
                groupData[gid] = (gd && gd.exists) ? gd.data() : null; emit();
              }, function () { groupData[gid] = null; emit(); });
            }
          });
          // Drop memberships that vanished (left / removed / unit deleted).
          for (var gid2 in myRoles) {
            if (!myRoles.hasOwnProperty(gid2) || seen[gid2]) continue;
            delete myRoles[gid2]; delete groupData[gid2];
            if (groupOffs[gid2]) { try { groupOffs[gid2](); } catch (e) {} delete groupOffs[gid2]; }
          }
          emit();
        }, function (e) { if (onErr) onErr(e); else cb && cb([]); });
      return function () {
        try { memOff(); } catch (e) {}
        for (var gid in groupOffs) { if (groupOffs.hasOwnProperty(gid)) { try { groupOffs[gid](); } catch (e) {} } }
      };
    });
  }
  // Live unit roster (members subcollection) → [{uid,role,name,addedBy,joinedAt,via}].
  function subscribeMembers(gid, cb) {
    if (!icuGroupsOn() || !gid) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      return grpRef(db, gid).collection("members")
        .onSnapshot(function (snap) {
          var out = []; snap.forEach(function (d) { out.push(mapMemberDoc(d.id, d.data())); });
          cb && cb(out);
        }, function () { cb && cb([]); });
    });
  }
  // Create a unit. PHASE 5: the group doc + the creator's members/{uid}=head doc are written
  // SEQUENTIALLY (group first, member second) — NOT batched — because the members-create rule
  // does get(/icuGroups/{gid}).createdBy, and get()/exists() in rules read the pre-commit state,
  // so a batched member-create would not yet see its sibling group doc and would be denied. We
  // also mint the doctor identity first (first team engagement).
  function createGroup(info) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      ensureIdentity(function () {
        fs(function (db) {
          var uid = currentUid();
          if (!db || !uid) return reject(new Error("firestore-unavailable"));
          var gref = db.collection("icuGroups").doc();
          var doc = {
            name: (info && info.name) || "ICU unit",
            unit: (info && info.unit) || "",
            hospital: (info && info.hospital) || "",
            createdBy: uid,
            createdAt: fieldValue().serverTimestamp()
          };
          track(gref.set(doc)).then(function () {
            var mdoc = { uid: uid, role: "head", name: currentName(), addedBy: uid, joinedAt: fieldValue().serverTimestamp() };
            track(memRef(db, gref.id, uid).set(mdoc)).then(function () { resolve(gref.id); }, reject);
          }, reject);
        });
      });
    });
  }
  // Delete the whole unit (head only — rules enforce). The members/invites/patients
  // subcollections are NOT cascade-deleted client-side (Firestore has no cascade); once the
  // group doc is gone the unit is unreadable and drops out of every member's list.
  function deleteGroup(gid) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        track(grpRef(db, gid).delete()).then(function () { resolve(gid); }, reject);
      });
    });
  }
  // Admin-add by raw uid (legacy invite path kept for back-compat). Rules enforce admin + role!=head
  // (+ only head may grant professor). A member may never change their own role.
  function inviteMember(gid, uid, role) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !uid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        var mdoc = { uid: uid, role: normRole(role), name: "", addedBy: currentUid(), joinedAt: fieldValue().serverTimestamp() };
        track(memRef(db, gid, uid).set(mdoc)).then(function () { resolve(uid); }, reject);
      });
    });
  }
  function setRole(gid, uid, role) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !uid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        track(memRef(db, gid, uid).update({ role: normRole(role) })).then(function () { resolve(uid); }, reject);
      });
    });
  }
  // Add a colleague by their StewardMD Doctor ID or email (admin only; rules enforce). Resolves
  // via the directory (get-by-exact-key only) then creates their members/{uid} doc.
  function addByIdOrEmail(gid, idOrEmail, role) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      resolveDoctor(idOrEmail).then(function (doc) {
        if (!doc || !doc.uid) return reject(new Error("not-found"));
        fs(function (db) {
          if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
          var r = normRole(role); if (r === "head") r = "professor";   // never admin-add a head
          var mdoc = { uid: doc.uid, role: r, name: doc.name || "", addedBy: currentUid(), joinedAt: fieldValue().serverTimestamp() };
          track(memRef(db, gid, doc.uid).set(mdoc)).then(function () { resolve(doc); }, reject);
        });
      }, reject);
    });
  }
  // Leave a unit on your own. A HEAD may not bare-leave (they must delete the unit instead) —
  // blocked here with a clear error and by the rules (a head's own member doc can't be deleted).
  function leaveGroup(gid) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        memRef(db, gid, uid).get().then(function (d) {
          var role = (d && d.exists) ? ((d.data() || {}).role || null) : null;
          if (role === "head") return reject(new Error("head-cannot-leave"));
          track(memRef(db, gid, uid).delete()).then(function () { resolve(gid); }, reject);
        }, function () {
          track(memRef(db, gid, uid).delete()).then(function () { resolve(gid); }, reject);
        });
      });
    });
  }
  // Remove another member (admin only; never the head — rules enforce both).
  function removeMember(gid, uid) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !uid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        track(memRef(db, gid, uid).delete()).then(function () { resolve(uid); }, reject);
      });
    });
  }

  /* --------------------------------------------------- doctor identity + dir */
  // A short, unguessable, account-linked StewardMD Doctor ID (SMD-XXXXXX). Uppercase base32 with
  // ambiguous chars removed (no 0/O/1/I/L). Uniqueness is guaranteed by the directory doc being
  // the source of truth: we create doctorDirectory/{smdId} inside a transaction that aborts on
  // collision, then regenerate. smdId is cached on users/{uid}/profile/self so we never re-mint.
  var SMD_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 chars, no 0/O/1/I/L
  var _identity = { smdId: null };
  function randChar(alphabet) { return alphabet.charAt(Math.floor(Math.random() * alphabet.length)); }
  function genSmdId() { var s = ""; for (var i = 0; i < 6; i++) s += randChar(SMD_ID_ALPHABET); return "SMD-" + s; }
  // Deterministic, dependency-free hash of the lowercased email → a directory key (NEVER the raw
  // email). Two independent 32-bit accumulators (FNV-1a + djb2) concatenated in base36 to keep
  // collisions low across a clinic-sized user base without a crypto dependency.
  function emailHash(email) {
    var s = String(email || "").trim().toLowerCase();
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;   // ×16777619
      h2 = (((h2 << 5) + h2) + c) >>> 0;   // ×33 + c
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  function looksLikeEmail(s) { return /@/.test(String(s || "")); }
  // Normalise a typed Doctor ID: uppercase, strip spaces, allow a bare 6-char code (add SMD-).
  function normalizeId(s) {
    s = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
    if (s && s.indexOf("SMD-") !== 0 && /^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
    return s;
  }
  function myDoctorId() { return _identity.smdId || null; }
  // Ensure this account has a Doctor ID (idempotent). cb (optional) is invoked with the id (or
  // null) regardless of outcome — never throws to the caller.
  function ensureIdentity(cb) {
    if (!icuGroupsOn()) { cb && cb(null); return; }
    if (_identity.smdId) { cb && cb(_identity.smdId); return; }
    fs(function (db) {
      var uid = currentUid();
      if (!db || !uid) { cb && cb(null); return; }
      profRef(db, uid).get().then(function (snap) {
        var data = (snap && snap.exists) ? (snap.data() || {}) : {};
        if (data.smdId) { _identity.smdId = data.smdId; cb && cb(data.smdId); return; }
        mintIdentity(db, uid, 0, cb);
      }, function () { mintIdentity(db, uid, 0, cb); });
    });
  }
  function mintIdentity(db, uid, attempt, cb) {
    attempt = attempt || 0;
    if (attempt > 6) { cb && cb(null); return; }
    var smdId = genSmdId(), name = currentName(), fv = fieldValue();
    var ref = dirRef(db, smdId);
    track(db.runTransaction(function (tx) {
      return tx.get(ref).then(function (d) {
        if (d && d.exists) return Promise.reject(new Error("smdid-collision"));   // regenerate
        tx.set(ref, { uid: uid, name: name, at: fv.serverTimestamp() });
        return smdId;
      });
    })).then(function () {
      _identity.smdId = smdId;
      try { profRef(db, uid).set({ smdId: smdId, name: name, at: fv.serverTimestamp() }, { merge: true }).catch(function () {}); } catch (e) {}
      try {
        var email = currentEmail();
        if (email) dirRef(db, "e_" + emailHash(email)).set({ uid: uid, name: name, smdId: smdId, at: fv.serverTimestamp() }, { merge: true }).catch(function () {});
      } catch (e) {}
      cb && cb(smdId);
    }, function () {
      if (attempt < 6) { mintIdentity(db, uid, attempt + 1, cb); return; }
      cb && cb(null);
    });
  }
  // Resolve a doctor by exact StewardMD ID OR email (get-by-exact-key only — the directory is
  // NEVER listed). Returns {uid,name,smdId} or null.
  function resolveDoctor(idOrEmail) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db) return reject(new Error("firestore-unavailable"));
        var raw = String(idOrEmail || "").trim();
        if (!raw) return resolve(null);
        var byEmail = looksLikeEmail(raw);
        var key = byEmail ? ("e_" + emailHash(raw)) : normalizeId(raw);
        if (!key) return resolve(null);
        track(dirRef(db, key).get()).then(function (d) {
          if (!d || !d.exists) return resolve(null);
          var data = d.data() || {};
          resolve({ uid: data.uid || null, name: data.name || "", smdId: data.smdId || (byEmail ? null : key) });
        }, reject);
      });
    });
  }

  /* ------------------------------------------------------- invites + join */
  var INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  function genCode(n) { n = n || 22; var s = ""; for (var i = 0; i < n; i++) s += randChar(INVITE_ALPHABET); return s; }
  var INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // ~14 days
  function inviteUrl(gid, code) {
    var origin = "";
    try { origin = location.origin || ""; } catch (e) {}
    // On the native app location.origin is capacitor://localhost (iOS) / http(s)://localhost (Android) —
    // NOT shareable (it only resolves inside this WebView). Use the canonical web origin so the invite
    // opens in a browser (or, with universal/app links configured, the app itself).
    if (!/^https:\/\//.test(origin) || /\/\/localhost\b/.test(origin)) origin = "https://stewardmd.in";
    return origin + "/?icujoin=" + gid + "." + code;
  }
  // Parse a "?icujoin=<gid>.<code>" value → {gid,code} | null. Splits on the FIRST dot (gids and
  // codes are dot-free alphanumerics).
  function parseJoinParam(raw) {
    raw = String(raw || "");
    var dot = raw.indexOf(".");
    if (dot <= 0 || dot >= raw.length - 1) return null;
    var gid = raw.slice(0, dot), code = raw.slice(dot + 1);
    if (!gid || !code) return null;
    return { gid: gid, code: code };
  }
  // Create a shareable invite (admin only — rules enforce). The role is clamped to a LINK role
  // (never head/professor). Returns { code, url, role }.
  function createInvite(gid, role) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var r = normInviteRole(role), code = genCode(22), fv = fieldValue();
        grpRef(db, gid).get().then(function (gd) {
          var g = (gd && gd.exists) ? (gd.data() || {}) : {};
          var doc = {
            role: r, createdBy: uid, createdByName: currentName(),
            expiresAt: nowMs() + INVITE_TTL_MS, unit: g.unit || "", name: g.name || ""
          };
          track(invRef(db, gid, code).set(doc)).then(function () {
            resolve({ code: code, url: inviteUrl(gid, code), role: r });
          }, reject);
        }, reject);
      });
    });
  }
  // Read an invite by code (any signed-in holder of the link — needed to preview/join).
  function getInvite(gid, code) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !code) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db) return reject(new Error("firestore-unavailable"));
        track(invRef(db, gid, code).get()).then(function (d) {
          if (!d || !d.exists) return resolve(null);
          var data = d.data() || {}, exp = tsToMs(data.expiresAt);
          resolve({
            gid: gid, code: code, role: normInviteRole(data.role), unit: data.unit || "",
            name: data.name || "", createdByName: data.createdByName || "",
            expiresAt: exp, expired: (exp != null && exp < nowMs())
          });
        }, reject);
      });
    });
  }
  // Self-join via a valid invite link: mint identity, then create members/{self} with the invite's
  // (clamped, non-admin) role, addedBy:'link', via:code. Rules re-verify the invite + role.
  function joinByInvite(gid, code) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !code) return reject(new Error("icu-groups-disabled"));
      ensureIdentity(function () {
        fs(function (db) {
          var uid = currentUid();
          if (!db || !uid) return reject(new Error("firestore-unavailable"));
          invRef(db, gid, code).get().then(function (d) {
            if (!d || !d.exists) return reject(new Error("invite-not-found"));
            var inv = d.data() || {}, exp = tsToMs(inv.expiresAt);
            if (exp != null && exp < nowMs()) return reject(new Error("invite-expired"));
            var role = normInviteRole(inv.role);   // clamp — a link can never confer head/professor
            var mdoc = { uid: uid, role: role, name: currentName(), addedBy: "link", joinedAt: fieldValue().serverTimestamp(), via: code };
            track(memRef(db, gid, uid).set(mdoc)).then(function () { resolve(gid); }, reject);
          }, reject);
        });
      });
    });
  }

  /* ---------------------------------------------------------------- patients */
  function subscribePatients(gid, cb, onErr) {
    if (!icuGroupsOn() || !gid) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      return grpRef(db, gid).collection("patients")
        .onSnapshot(function (snap) {
          var out = [];
          snap.forEach(function (d) { out.push(mapPatientDoc(d.id, d.data())); });
          cb && cb(out);
        }, function (e) { if (onErr) onErr(e); else cb && cb([]); });
    });
  }
  // Merge the patient doc + timeline + tasks listeners into ONE view-model, re-emitted on any change.
  function subscribePatient(gid, pid, cb) {
    if (!icuGroupsOn() || !gid || !pid) { cb && cb(null); return function () {}; }
    var vm = { patient: null, timeline: [], tasks: [] };
    function emit() { cb && cb({ patient: vm.patient, timeline: vm.timeline.slice(), tasks: vm.tasks.slice() }); }
    return makeSub(function (db) {
      var base = ptRef(db, gid, pid);
      var offs = [];
      offs.push(base.onSnapshot(function (d) {
        vm.patient = (d && d.exists) ? mapPatientDoc(d.id, d.data()) : null; emit();
      }, function () { emit(); }));
      offs.push(base.collection("timeline").orderBy("ts", "desc").onSnapshot(function (snap) {
        var a = []; snap.forEach(function (x) { a.push(mapTimeline(x.id, x.data())); }); vm.timeline = a; emit();
      }, function () {}));
      offs.push(base.collection("tasks").orderBy("ts", "desc").onSnapshot(function (snap) {
        var a = []; snap.forEach(function (x) { a.push(mapTask(x.id, x.data())); }); vm.tasks = a; emit();
      }, function () {}));
      return function () { for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (e) {} } };
    });
  }
  // Write the shared patient doc. Carries ICU_STATE.src source tags through unchanged (never
  // discarded); free-text status is last-writer-wins (acceptable per the spec).
  function upsertPatient(gid, pid, state, lastUpdateText) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var clean = sanitizeState(state);
        var pt = clean.patient || {};
        var doc = {
          name: pt.name || "Patient", dx: pt.diagnosis || "", bed: pt.bed || "",
          state: clean,
          savedAt: nowMs(),
          updatedAt: fieldValue().serverTimestamp(),
          lastUpdate: { by: uid, byName: currentName(), text: String(lastUpdateText || "Updated patient"), at: fieldValue().serverTimestamp() }
        };
        var sev = severityOf(clean); if (sev) doc.severity = sev;
        track(ptRef(db, gid, pid).set(doc, { merge: true })).then(function () { resolve(pid); }, reject);
      });
    });
  }
  function setReviewed(gid, pid) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var doc = { reviewedAt: fieldValue().serverTimestamp(), reviewedBy: uid, reviewedByName: currentName() };
        track(ptRef(db, gid, pid).set(doc, { merge: true })).then(function () { resolve(pid); }, reject);
      });
    });
  }

  /* ---------------------------------------------------------------- timeline */
  // Append-only audit trail. Never updates/deletes.
  function addTimelineEvent(gid, pid, ev) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var e = buildTimelineEvent(ev, { uid: uid, name: currentName(), role: _ctx.role });
        e.ts = fieldValue().serverTimestamp();
        track(ptRef(db, gid, pid).collection("timeline").add(e)).then(function (ref) { resolve(ref.id); }, reject);
      });
    });
  }

  /* ------------------------------------------------------------------- tasks */
  function subscribeTasks(gid, pid, cb) {
    if (!icuGroupsOn() || !gid || !pid) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      return ptRef(db, gid, pid).collection("tasks").orderBy("ts", "desc")
        .onSnapshot(function (snap) {
          var a = []; snap.forEach(function (x) { a.push(mapTask(x.id, x.data())); }); cb && cb(a);
        }, function () { cb && cb([]); });
    });
  }
  // Create a task — INSTRUCTING roles only (rules enforce too).
  function addTask(gid, pid, info) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      if (!canInstruct(_ctx.role)) return reject(new Error("forbidden-role"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var t = buildTask(info, { uid: uid, name: currentName() });
        t.ts = fieldValue().serverTimestamp();
        track(ptRef(db, gid, pid).collection("tasks").add(t)).then(function (ref) { resolve(ref.id); }, reject);
      });
    });
  }
  function setTaskStatus(gid, pid, taskId, status) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var patch = taskStatusPatch(status, { uid: uid, name: currentName() });
        if (patch.completedAt === "@server") patch.completedAt = fieldValue().serverTimestamp();
        track(ptRef(db, gid, pid).collection("tasks").doc(taskId).update(patch)).then(function () { resolve(taskId); }, reject);
      });
    });
  }

  /* ---------------------------------------------------------------- presence */
  var _presence = { gid: null, pid: null, timer: null };
  function writePresence() {
    if (!_presence.gid || !_presence.pid) return;
    fs(function (db) {
      var uid = currentUid();
      if (!db || !uid || !_presence.gid || !_presence.pid) return;
      try {
        ptRef(db, _presence.gid, _presence.pid).collection("presence").doc(uid)
          .set({ name: currentName(), at: fieldValue().serverTimestamp() }, { merge: true })
          .catch(function () {});
      } catch (e) {}
    });
  }
  function enterPatient(gid, pid) {
    if (!icuGroupsOn() || !gid || !pid) return;
    leavePatient();                              // clear any previous presence + heartbeat
    _presence.gid = gid; _presence.pid = pid;
    writePresence();
    try { _presence.timer = setInterval(writePresence, 20000); } catch (e) {}
  }
  function leavePatient() {
    if (_presence.timer) { try { clearInterval(_presence.timer); } catch (e) {} _presence.timer = null; }
    var g = _presence.gid, p = _presence.pid;
    _presence.gid = null; _presence.pid = null;
    if (!g || !p) return;
    fs(function (db) {
      var uid = currentUid();
      if (!db || !uid) return;
      try { ptRef(db, g, p).collection("presence").doc(uid).delete().catch(function () {}); } catch (e) {}
    });
  }
  // Re-beat on tab focus (so viewers appear/disappear promptly), and stop implicitly when hidden
  // (the 60s window in subscribePresence ages a backgrounded viewer out).
  try {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && _presence.gid && _presence.pid) writePresence();
    });
  } catch (e) {}
  // Viewers active in the last ~60s, excluding self.
  function subscribePresence(gid, pid, cb) {
    if (!icuGroupsOn() || !gid || !pid) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      return ptRef(db, gid, pid).collection("presence")
        .onSnapshot(function (snap) {
          var me = currentUid(), now = Date.now(), out = [];
          snap.forEach(function (d) {
            if (d.id === me) return;
            var data = d.data() || {}; var at = tsToMs(data.at);
            if (at && (now - at) <= 60000) out.push({ uid: d.id, name: data.name || "Clinician", at: at });
          });
          cb && cb(out);
        }, function () { cb && cb([]); });
    });
  }

  /* -------------------------------------------------------------------- API */
  window.SMD_ICU_GROUPS = {
    enabled: icuGroupsOn,
    ROLES: ROLES,
    LINK_ROLES: LINK_ROLES,
    canInstruct: canInstruct,
    isAdminRole: isAdminRole,
    roleLabel: roleLabel,
    myRole: myRole,
    setActiveGroup: setActiveGroup,
    setSeverityFn: setSeverityFn,
    syncState: syncState,
    unsubscribeAll: unsubscribeAll,
    // groups + membership
    subscribeGroups: subscribeGroups,
    subscribeMembers: subscribeMembers,
    createGroup: createGroup,
    deleteGroup: deleteGroup,
    inviteMember: inviteMember,
    setRole: setRole,
    addByIdOrEmail: addByIdOrEmail,
    leaveGroup: leaveGroup,
    removeMember: removeMember,
    // doctor identity + directory
    ensureIdentity: ensureIdentity,
    myDoctorId: myDoctorId,
    resolveDoctor: resolveDoctor,
    // invites + join-by-link
    createInvite: createInvite,
    getInvite: getInvite,
    joinByInvite: joinByInvite,
    inviteUrl: inviteUrl,
    // patients
    subscribePatients: subscribePatients,
    subscribePatient: subscribePatient,
    upsertPatient: upsertPatient,
    setReviewed: setReviewed,
    // timeline / tasks
    addTimelineEvent: addTimelineEvent,
    subscribeTasks: subscribeTasks,
    addTask: addTask,
    setTaskStatus: setTaskStatus,
    // presence
    enterPatient: enterPatient,
    leavePatient: leavePatient,
    subscribePresence: subscribePresence,
    // pure test seams (deterministic transforms — used by the rules/logic harness)
    _mapGroupDoc: mapGroupDoc, _mapMemberDoc: mapMemberDoc, _mapPatientDoc: mapPatientDoc, _mapTimeline: mapTimeline, _mapTask: mapTask,
    _buildTimelineEvent: buildTimelineEvent, _buildTask: buildTask, _taskStatusPatch: taskStatusPatch,
    _sanitizeState: sanitizeState, _normStatus: normStatus, _normRole: normRole, _normInviteRole: normInviteRole,
    _genSmdId: genSmdId, _emailHash: emailHash, _looksLikeEmail: looksLikeEmail, _normalizeId: normalizeId,
    _parseJoinParam: parseJoinParam, _inviteUrl: inviteUrl, _isAdminRole: isAdminRole,
    _SMD_ID_ALPHABET: SMD_ID_ALPHABET
  };
})();
