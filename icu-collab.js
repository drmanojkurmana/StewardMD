/* StewardMD — ICU collaboration backend (additive; NEVER edits the minified app.js).
 * ---------------------------------------------------------------------------
 * PHASE 2 of the ICU v2 redesign. A pure DATA + subscription layer over the app's
 * existing Firebase stack (the same one SMD_CASES / caseshare use). NO DOM: icu.js
 * owns all rendering; this module only reads/writes Firestore and streams snapshots.
 *
 *   window.SMD_ICU_GROUPS — { enabled, subscribeGroups, createGroup, inviteMember,
 *     setRole, subscribePatients, subscribePatient, upsertPatient, setReviewed,
 *     addTimelineEvent, subscribeTasks, addTask, setTaskStatus, enterPatient,
 *     leavePatient, subscribePresence, syncState, unsubscribeAll, … }
 *
 * Firestore data model (per-hospital unit; security by membership + role — see
 * firestore.rules):
 *   icuGroups/{gid}                      { name, unit, hospital, createdBy,
 *                                          roles:{uid:role}, members:[uid], createdAt }
 *   icuGroups/{gid}/patients/{pid}       mirror of ICU_STATE + { severity, reviewedAt,
 *                                          reviewedBy, lastUpdate:{by,byName,text,at},
 *                                          assignedTo }
 *   .../patients/{pid}/timeline/{eid}    { ts, type, title, detail, by, byName, byRole }  (append-only audit)
 *   .../patients/{pid}/tasks/{tid}       { text, status, assignedBy, assignedByName,
 *                                          completedBy, completedByName, completedAt, due, ts }
 *   .../patients/{pid}/presence/{uid}    { name, at }
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
  var ROLE_LABEL = {
    head: "Unit Head", professor: "Professor", assistant: "Assistant Professor",
    senior_resident: "Senior Resident", junior_resident: "Junior Resident", intern: "Intern"
  };
  function canInstruct(role) { return INSTRUCT.indexOf(role) >= 0; }
  function roleLabel(r) { return ROLE_LABEL[r] || (r ? String(r) : "Member"); }
  function normRole(r) { return ROLES.indexOf(r) >= 0 ? r : "junior_resident"; }

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
  // Map a group doc → the shape icu.js consumes ({id,name,unit,hospital,roles,members,myRole}).
  function mapGroupDoc(id, data, uid) {
    data = data || {};
    var roles = data.roles || {};
    return {
      id: id, name: data.name || "", unit: data.unit || "", hospital: data.hospital || "",
      roles: roles, members: data.members || [], createdBy: data.createdBy || null,
      myRole: (uid && roles[uid]) || null
    };
  }
  function myRole(group) {
    if (!group) return null;
    if (group.myRole) return group.myRole;
    var uid = currentUid();
    return (uid && group.roles && group.roles[uid]) || null;
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

  /* ------------------------------------------------------------------ groups */
  // onErr (optional) — called with the snapshot error (e.g. permission-denied) so the UI can show
  // a non-technical error state + Retry. When omitted, falls back to the old cb([]) behaviour.
  function subscribeGroups(cb, onErr) {
    if (!icuGroupsOn() || !currentUid()) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      var uid = currentUid();
      if (!uid) { cb && cb([]); return null; }
      return db.collection("icuGroups").where("members", "array-contains", uid)
        .onSnapshot({ includeMetadataChanges: true }, function (snap) {
          try { _meta.fromCache = !!(snap.metadata && snap.metadata.fromCache); _meta.pendingWrites = !!(snap.metadata && snap.metadata.hasPendingWrites); } catch (e) {}
          var out = [];
          snap.forEach(function (d) { out.push(mapGroupDoc(d.id, d.data(), uid)); });
          cb && cb(out);
        }, function (e) { if (onErr) onErr(e); else cb && cb([]); });
    });
  }
  function createGroup(info) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var roles = {}; roles[uid] = "head";
        var doc = {
          name: (info && info.name) || "ICU unit",
          unit: (info && info.unit) || "",
          hospital: (info && info.hospital) || "",
          createdBy: uid, roles: roles, members: [uid],
          createdAt: fieldValue().serverTimestamp()
        };
        track(db.collection("icuGroups").add(doc)).then(function (ref) { resolve(ref.id); }, reject);
      });
    });
  }
  // Membership / role management — head|professor only (enforced in rules too; a member can
  // never escalate their own role — see the rules' self-role-immutability check).
  function updateGroup(gid, build) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        var patch; try { patch = build(fieldValue()); } catch (e) { return reject(e); }
        track(grpRef(db, gid).update(patch)).then(function () { resolve(gid); }, reject);
      });
    });
  }
  function inviteMember(gid, uid, role) {
    return updateGroup(gid, function (fv) {
      var patch = { members: fv.arrayUnion(uid) };
      patch["roles." + uid] = normRole(role);
      return patch;
    });
  }
  function setRole(gid, uid, role) {
    return updateGroup(gid, function () {
      var patch = {}; patch["roles." + uid] = normRole(role); return patch;
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
    canInstruct: canInstruct,
    roleLabel: roleLabel,
    myRole: myRole,
    setActiveGroup: setActiveGroup,
    setSeverityFn: setSeverityFn,
    syncState: syncState,
    unsubscribeAll: unsubscribeAll,
    // groups
    subscribeGroups: subscribeGroups,
    createGroup: createGroup,
    inviteMember: inviteMember,
    setRole: setRole,
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
    _mapGroupDoc: mapGroupDoc, _mapPatientDoc: mapPatientDoc, _mapTimeline: mapTimeline, _mapTask: mapTask,
    _buildTimelineEvent: buildTimelineEvent, _buildTask: buildTask, _taskStatusPatch: taskStatusPatch,
    _sanitizeState: sanitizeState, _normStatus: normStatus, _normRole: normRole
  };
})();
