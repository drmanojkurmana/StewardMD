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
  // DISPLAY designations the head/admin can assign to a member. Purely a display title stored on
  // the member doc; each maps to one of the enforced ROLES above, which stays the permission
  // primitive (canInstruct/admin/firestore.rules). Consultant/Associate-Professor → 'professor'
  // (admin), so — since granting 'professor' is head-only in the rules — they are head-only to
  // assign. Custom (free-text) titles map via the head's instruct/execute pick (see icu.js).
  var DESIGNATIONS = [
    { label: "Consultant 1", role: "professor" }, { label: "Consultant 2", role: "professor" },
    { label: "Consultant 3", role: "professor" }, { label: "Consultant 4", role: "professor" },
    { label: "Consultant 5", role: "professor" }, { label: "Consultant 6", role: "professor" },
    { label: "Associate Professor", role: "professor" },
    { label: "Assistant Professor", role: "assistant" },
    { label: "Senior Resident", role: "senior_resident" },
    { label: "Junior Resident", role: "junior_resident" },
    { label: "Intern", role: "intern" },
    { label: "Head Nurse", role: "junior_resident" }
  ];
  function roleForDesignation(label) {
    for (var i = 0; i < DESIGNATIONS.length; i++) if (DESIGNATIONS[i].label === label) return DESIGNATIONS[i].role;
    return null;   // custom / unknown → caller derives role (instruct → assistant, execute → junior_resident)
  }
  function normDesignation(d) { return d == null ? "" : String(d).trim().slice(0, 60); }
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
  // At-rest encryption of the shared patient doc (name/dx/bed/state). ?icuenc=1/0 →
  // localStorage['smd_icu_encrypt'] → default OFF. Requires window.SMD_ICU_CRYPTO + the server
  // secret; when OFF the read/write paths are byte-for-byte the original cleartext behaviour.
  function icuEncOn() {
    try {
      if (!window.SMD_ICU_CRYPTO) return false;
      var q = (location.search.match(/[?&]icuenc=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return localStorage.getItem("smd_icu_encrypt") === "1";
    } catch (e) { return false; }
  }

  /* --------------------------------------------------- firebase / firestore */
  var _db = null, _persistTried = false, _lpTried = false;
  function fbReady() { try { return !!(window.firebase && window.firebase.firestore); } catch (e) { return false; } }
  function getDb() {
    try {
      if (_db) return _db;
      var db = window.SMD_DB || ((window.firebase && firebase.firestore) ? firebase.firestore() : null);
      if (!db) return null;
      forceLongPollingOnce(db);   // native fresh-signin WRITE-HANG fix (see below) - before ICU's first read/write
      _db = db; return _db;
    } catch (e) {}
    return null;
  }
  // NATIVE Firestore WRITE-HANG fix. In the Capacitor WebView the default WebChannel Write stream can
  // stall forever (Listens survive, writes never ack) - the "fresh sign-in" ICU/handover hang: a
  // clinician posts a handover, gets a success toast, but nothing lands in the shared timeline. The
  // reliable transport is long-polling, routed through native-bridge's pristine (un-CapacitorHttp) XHR.
  // app.js applies experimentalForceLongPolling at boot, but a duplicate initializeApp or an early
  // instance start can make that throw BEFORE it lands. Re-assert it here, before ICU's first read/write,
  // best-effort: if the instance was already started the call throws and we are no worse off than today.
  // Web/PWA are untouched (native only); idempotent via _lpTried.
  function forceLongPollingOnce(db) {
    if (_lpTried || !db || !db.settings) return;
    _lpTried = true;
    try {
      var isNative = window.SMD_IS_NATIVE || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      if (isNative) db.settings({ experimentalForceLongPolling: true });
    } catch (e) {}
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
  // DPDP 7-day auto-clear: shared ICU data carries an `expiresAt` and is deleted by a Firestore TTL
  // policy (configured on the patients / timeline / tasks collection groups). Refreshed on each write,
  // so it's a sliding 7-day-since-last-activity window; explicit discharge deletes immediately.
  // DPDP retention window (days) for shared ICU data. User-configurable via localStorage
  // (smd_icu_retention_days): default 7, HARD-CAPPED at 90 so the "cleared automatically" promise -
  // and the firestore.rules retentionCapped() bound (91d = 90 + ~1d slack) - always holds. Only NEW
  // writes take the new window; existing docs keep the expiresAt stamped when they were written.
  var RETENTION_DEFAULT_DAYS = 7, RETENTION_MAX_DAYS = 90;
  var RETENTION_MS = RETENTION_DEFAULT_DAYS * 24 * 3600 * 1000;   // legacy default window (ms)
  function retentionDays() {
    try {
      var v = parseInt((typeof localStorage !== "undefined") ? localStorage.getItem("smd_icu_retention_days") : null, 10);
      if (!v || isNaN(v) || v < 1) return RETENTION_DEFAULT_DAYS;
      return Math.min(v, RETENTION_MAX_DAYS);
    } catch (e) { return RETENTION_DEFAULT_DAYS; }
  }
  function retentionExpiry() { return new Date(nowMs() + retentionDays() * 24 * 3600 * 1000); }
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
      // Category (icu|ward) + unit type (ICU/MICU/… or Male Ward/…). Older units have no kind →
      // treated as "icu" so ICU and Ward stay separate without a migration.
      kind: data.kind || "icu", unitType: data.unitType || "",
      roles: {}, members: [], createdBy: data.createdBy || null,
      myRole: role || null
    };
  }
  function mapMemberDoc(id, data) {
    data = data || {};
    return {
      uid: id, role: data.role || null, name: data.name || "", designation: data.designation || "",
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
  // Async read for encrypted docs: decrypt the PHI envelope (name/dx/bed/state), then reuse
  // mapPatientDoc so the view-model shape is identical. A cleartext doc (no .enc) passes straight
  // through (back-compat). A decrypt failure (no key / not a member / tamper) renders a locked
  // placeholder — operational fields (severity/timestamps) stay visible, PHI never leaks.
  function mapPatientDocDec(id, data, gid) {
    data = data || {};
    if (!data.enc) return Promise.resolve(mapPatientDoc(id, data));
    return window.SMD_ICU_CRYPTO.decObj(gid, data.enc).then(function (pii) {
      pii = pii || {};
      var merged = {}; for (var k in data) merged[k] = data[k];
      merged.name = pii.name; merged.dx = pii.dx; merged.bed = pii.bed; merged.state = pii.state;
      delete merged.enc;
      return mapPatientDoc(id, merged);
    }, function () {
      return mapPatientDoc(id, {
        name: "🔒 Locked", dx: "", bed: "",
        severity: data.severity || null, savedAt: data.savedAt, updatedAt: data.updatedAt,
        reviewedAt: data.reviewedAt, reviewedBy: data.reviewedBy, reviewedByName: data.reviewedByName,
        lastUpdate: data.lastUpdate, assignedTo: data.assignedTo || null
      });
    });
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
      priority: normPriority(data.priority), dueAt: (typeof data.dueAt === "number" ? data.dueAt : null),
      assignedBy: data.assignedBy || null, assignedByName: data.assignedByName || "",
      completedBy: data.completedBy || null, completedByName: data.completedByName || "",
      completedAt: tsToMs(data.completedAt), due: data.due || "", assignedTo: data.assignedTo || null,
      onBehalfOfUid: data.onBehalfOfUid || null, onBehalfOfName: data.onBehalfOfName || "",
      explanation: data.explanation || "", explainedByName: data.explainedByName || "", explainedAt: tsToMs(data.explainedAt),
      escalatedAt: (typeof data.escalatedAt === "number" ? data.escalatedAt : tsToMs(data.escalatedAt)),
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
  function normPriority(p) { return (p === "immediate" || p === "high" || p === "moderate" || p === "low") ? p : "moderate"; }
  function buildTask(info, who) {
    info = info || {}; who = who || {};
    return {
      text: info.text || "", status: "pending",
      priority: normPriority(info.priority), dueAt: (info.dueAt != null ? info.dueAt : null),
      assignedBy: who.uid || null, assignedByName: who.name || "",
      onBehalfOfUid: info.onBehalfOfUid || null, onBehalfOfName: info.onBehalfOfName || "",
      completedBy: null, completedByName: null, completedAt: null,
      explanation: "", explainedBy: null, explainedByName: null, explainedAt: null,
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
      // NOTE: no includeMetadataChanges — it made this collectionGroup listener fire on every
      // pending-write / cache↔server metadata flip (twice per write), churning callbacks →
      // re-render → native-bridge traffic every couple seconds and hitching scroll. We fire only
      // on real membership changes now. The "Syncing…" pill is unaffected: syncState() derives it
      // from _inflight (writes in flight, via track()) + navigator online/offline — not this
      // listener's metadata. _meta is still refreshed opportunistically on each real fire.
      var memOff = db.collectionGroup("members").where("uid", "==", uid)
        .onSnapshot(function (snap) {
          try { _meta.fromCache = !!(snap.metadata && snap.metadata.fromCache); _meta.pendingWrites = !!(snap.metadata && snap.metadata.hasPendingWrites); } catch (e) {}
          var seen = {};
          snap.forEach(function (mdoc) {
            var gref = mdoc.ref && mdoc.ref.parent && mdoc.ref.parent.parent;   // icuGroups/{gid}
            if (!gref) return;
            var gid = gref.id; seen[gid] = true;
            myRoles[gid] = (mdoc.data() || {}).role || null;
            if (!groupOffs[gid]) {
              groupData[gid] = undefined;
              // A group-doc read can be TRANSIENTLY permission-denied right after a unit is created:
              // the read rule checks members/{uid}, which may not have propagated to the rules engine
              // yet. onSnapshot detaches on that error, so WITHOUT a retry the just-created unit is
              // dropped from the list (groupData=null → skipped by emit) and only reappears on an app
              // relaunch → looks like "the new unit didn't save". Retry a few times with a short
              // backoff so it self-heals within seconds; give up (null) only after that. A genuinely
              // missing group doc (deleted unit / orphan member) returns exists:false via the SUCCESS
              // path — not an error — so orphans never trigger the retry loop.
              (function attach(tries) {
                groupOffs[gid] = gref.onSnapshot(
                  function (gd) { groupData[gid] = (gd && gd.exists) ? gd.data() : null; emit(); },
                  function () {
                    if (myRoles[gid] !== undefined && tries < 6) {
                      setTimeout(function () { if (myRoles[gid] !== undefined) attach(tries + 1); }, 1500);
                    } else { groupData[gid] = null; emit(); }
                  }
                );
              })(0);
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
            kind: (info && info.kind) || "icu",            // icu | ward — keeps the two categories separate
            unitType: (info && info.unitType) || "",       // ICU/MICU/SICU/PICU/CCU | Male Ward/Female Ward
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
  // Set a member's DISPLAY designation (Consultant 1 / Head Nurse / custom …) AND its derived
  // permission role in one admin write. Title is display-only; `role` stays the enforced primitive.
  function setDesignation(gid, uid, designation, role) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !uid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        track(memRef(db, gid, uid).update({ role: normRole(role), designation: normDesignation(designation) })).then(function () { resolve(uid); }, reject);
      });
    });
  }
  // Save the CURRENT user's per-unit notification preferences onto their own members/{uid} doc. The
  // push server (functions/_taskpush.js) reads members/{uid}.notif during fan-out to decide whether
  // to send each Tier-2/3 category. Only the three category booleans are written; a member can only
  // ever write their OWN member doc (rules enforce), so no gid/uid target other than self.
  function setNotifPrefs(gid, prefs) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var clean = { orderRoutine: !!(prefs && prefs.orderRoutine), handover: !!(prefs && prefs.handover), activity: !!(prefs && prefs.activity) };
        track(memRef(db, gid, uid).update({ notif: clean })).then(function () { resolve(uid); }, reject);
      });
    });
  }
  // Add a colleague by their StewardMD Doctor ID or email (admin only; rules enforce). Resolves
  // via the directory (get-by-exact-key only) then creates their members/{uid} doc.
  function addByIdOrEmail(gid, idOrEmail, role, designation) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      resolveDoctor(idOrEmail).then(function (doc) {
        if (!doc || !doc.uid) return reject(new Error("not-found"));
        fs(function (db) {
          if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
          var r = normRole(role); if (r === "head") r = "professor";   // never admin-add a head
          var mdoc = { uid: doc.uid, role: r, name: doc.name || "", designation: normDesignation(designation), addedBy: currentUid(), joinedAt: fieldValue().serverTimestamp() };
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
  //
  // SINGLE SOURCE OF TRUTH: generation/hashing/minting now DELEGATE to the shared
  // window.SMD_STEWARD_ID module (steward-id.js), which is byte-identical to icu-collab's
  // original implementation (so existing doctorDirectory/e_<hash> entries keep resolving). Each
  // function below keeps its ORIGINAL inline body as a fallback for the (should-never-happen)
  // case where steward-id.js hasn't loaded yet — this rewire is strictly non-breaking for ICU.
  var SMD_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 chars, no 0/O/1/I/L (fallback only)
  var _identity = { smdId: null };
  function _sid() { return (typeof window !== "undefined" && window.SMD_STEWARD_ID) || null; }
  function randChar(alphabet) { return alphabet.charAt(Math.floor(Math.random() * alphabet.length)); }
  function genSmdId() {
    var s = _sid();
    if (s) return s.genId();
    var out = ""; for (var i = 0; i < 6; i++) out += randChar(SMD_ID_ALPHABET); return "SMD-" + out;
  }
  // Deterministic, dependency-free hash of the lowercased email → a directory key (NEVER the raw
  // email). Two independent 32-bit accumulators (FNV-1a + djb2) concatenated in base36 to keep
  // collisions low across a clinic-sized user base without a crypto dependency.
  function emailHash(email) {
    var s = _sid();
    if (s) return s.emailHash(email);
    var str = String(email || "").trim().toLowerCase();
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 ^= c; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;   // ×16777619
      h2 = (((h2 << 5) + h2) + c) >>> 0;   // ×33 + c
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  function looksLikeEmail(s) { return /@/.test(String(s || "")); }
  // Normalise a typed Doctor ID: uppercase, strip spaces, allow a bare 6-char code (add SMD-).
  function normalizeId(s) {
    var sid = _sid();
    if (sid) return sid.normalizeId(s);
    s = String(s || "").trim().toUpperCase().replace(/\s+/g, "");
    if (s && s.indexOf("SMD-") !== 0 && /^[A-Z0-9]{6}$/.test(s)) s = "SMD-" + s;
    return s;
  }
  function myDoctorId() { return _identity.smdId || null; }
  // Ensure this account has a Doctor ID (idempotent). cb (optional) is invoked with the id (or
  // null) regardless of outcome — never throws to the caller. The icuGroupsOn() guard STAYS here
  // (at the ICU entry point) — universal minting for non-ICU users is a later phase, not this one.
  //
  // When the shared module is present, we still resolve the db via icu-collab's own fs() callback
  // FIRST: SMD_STEWARD_ID.ensure() requires a SYNCHRONOUS getDb, but icu-collab's _db can be null
  // until fs() resolves persistence — so we hand the shared ensure() a getDb closure over the
  // already-resolved db, not a live read of _db.
  function ensureIdentity(cb) {
    if (!icuGroupsOn()) { cb && cb(null); return; }
    if (_identity.smdId) { cb && cb(_identity.smdId); return; }
    var sid = _sid();
    if (sid) {
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) { cb && cb(null); return; }
        sid.ensure({
          getDb: function () { return db; },
          getUid: currentUid, getName: currentName, getEmail: currentEmail,
          serverTimestamp: function () { return fieldValue().serverTimestamp(); }
        }, function (id) { _identity.smdId = id; cb && cb(id); });
      });
      return;
    }
    // Fallback: shared module absent — original inline mint path, unchanged.
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
  // Inline fallback mint path — used ONLY when window.SMD_STEWARD_ID hasn't loaded. Unchanged from
  // the original implementation.
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
        if (email) {
          // GUARDED: never overwrite an e_{hash} pointer owned by a DIFFERENT uid (one-email-one-account).
          var eRef = dirRef(db, "e_" + emailHash(email));
          db.runTransaction(function (tx) {
            return tx.get(eRef).then(function (d) {
              var cur = d && d.exists && d.data ? (d.data() || {}) : {};
              if (cur.uid && cur.uid !== uid) return;
              tx.set(eRef, { uid: uid, name: name, smdId: smdId, at: fv.serverTimestamp() }, { merge: true });
            });
          }).catch(function () {});
        }
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
          function joinFresh() {
            invRef(db, gid, code).get().then(function (d) {
              if (!d || !d.exists) return reject(new Error("invite-not-found"));
              var inv = d.data() || {}, exp = tsToMs(inv.expiresAt);
              if (exp != null && exp < nowMs()) return reject(new Error("invite-expired"));
              var role = normInviteRole(inv.role);   // clamp — a link can never confer head/professor
              var mdoc = { uid: uid, role: role, name: currentName(), addedBy: "link", joinedAt: fieldValue().serverTimestamp(), via: code };
              track(memRef(db, gid, uid).set(mdoc)).then(function () { resolve(gid); }, reject);
            }, reject);
          }
          // NEVER let clicking an invite DEMOTE an existing member (e.g. the unit head opening their
          // own link, which previously overwrote their head member doc → junior_resident). If already
          // a member, joining is a no-op — keep the current role.
          memRef(db, gid, uid).get().then(function (mine) {
            if (mine && mine.exists) { resolve(gid); return; }
            joinFresh();
          }, function () { joinFresh(); });
        });
      });
    });
  }
  // Creator self-heal: restore the unit CREATOR to head if they somehow lost it (e.g. an older
  // self-join demotion). Rules-safe: a member may delete their own non-head doc, and the creator may
  // bootstrap-create a head doc (createdBy == self). No-op if already head or not the creator.
  function reclaimHead(gid) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        grpRef(db, gid).get().then(function (g) {
          if (!g || !g.exists || (g.data() || {}).createdBy !== uid) return reject(new Error("not-the-creator"));
          var mref = memRef(db, gid, uid);
          var head = { uid: uid, role: "head", name: currentName(), addedBy: uid, joinedAt: fieldValue().serverTimestamp() };
          function makeHead() { track(mref.set(head)).then(function () { resolve("head"); }, reject); }
          mref.get().then(function (m) {
            if (m && m.exists && (m.data() || {}).role === "head") { resolve("head"); return; }   // already head
            if (m && m.exists) { track(mref.delete()).then(makeHead, reject); }                    // demoted → delete stale, re-create as head
            else { makeHead(); }                                                                   // no member doc → bootstrap head
          }, reject);
        }, reject);
      });
    });
  }

  /* ---------------------------------------------------------------- patients */
  function subscribePatients(gid, cb, onErr) {
    if (!icuGroupsOn() || !gid) { cb && cb([]); return function () {}; }
    return makeSub(function (db) {
      return grpRef(db, gid).collection("patients")
        .onSnapshot(function (snap) {
          var docs = []; snap.forEach(function (d) { docs.push({ id: d.id, data: d.data() }); });
          if (!icuEncOn()) { cb && cb(docs.map(function (x) { return mapPatientDoc(x.id, x.data); })); return; }
          Promise.all(docs.map(function (x) { return mapPatientDocDec(x.id, x.data, gid); }))
            .then(function (out) { cb && cb(out); }, function () { cb && cb(docs.map(function (x) { return mapPatientDoc(x.id, x.data); })); });
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
        if (!(d && d.exists)) { vm.patient = null; emit(); return; }
        if (!icuEncOn()) { vm.patient = mapPatientDoc(d.id, d.data()); emit(); return; }
        mapPatientDocDec(d.id, d.data(), gid).then(function (p) { vm.patient = p; emit(); }, function () { vm.patient = mapPatientDoc(d.id, d.data()); emit(); });
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
          expiresAt: retentionExpiry(),   // DPDP 7-day auto-clear: the PHI-bearing patient doc is now TTL-eligible too (was only timeline/tasks); refreshed on every update
          updatedAt: fieldValue().serverTimestamp(),
          lastUpdate: { by: uid, byName: currentName(), text: String(lastUpdateText || "Updated patient"), at: fieldValue().serverTimestamp() }
        };
        var sev = severityOf(clean); if (sev) doc.severity = sev;
        function writeDoc() { track(ptRef(db, gid, pid).set(doc, { merge: true })).then(function () { resolve(pid); }, reject); }
        if (!icuEncOn()) { writeDoc(); return; }
        // Encrypt the PHI fields on-device (name/dx/bed/state); keep operational fields cleartext
        // (severity/timestamps/lastUpdate) so the board still sorts. Fail-CLOSED: if the key can't
        // be obtained, do NOT fall back to writing cleartext PHI.
        window.SMD_ICU_CRYPTO.encObj(gid, { name: doc.name, dx: doc.dx, bed: doc.bed, state: doc.state }).then(function (blob) {
          doc.enc = blob;
          var FV = fieldValue();
          if (FV && FV.delete) { doc.name = FV.delete(); doc.dx = FV.delete(); doc.bed = FV.delete(); doc.state = FV.delete(); }
          else { delete doc.name; delete doc.dx; delete doc.bed; delete doc.state; }
          writeDoc();
        }, function (e) { reject(e || new Error("icu-encrypt-failed")); });
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
  // Remove (discharge) a shared patient from the unit. Deletes icuGroups/{gid}/patients/{pid}; the
  // rules allow this only for INSTRUCTING roles (canInstruct) — the client also guards before calling.
  function removePatient(gid, pid) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn() || !gid || !pid) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        if (!db || !currentUid()) return reject(new Error("firestore-unavailable"));
        if (!canInstruct(_ctx.role)) return reject(new Error("forbidden-role"));
        track(ptRef(db, gid, pid).delete()).then(function () { resolve(pid); }, reject);
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
        e.expiresAt = retentionExpiry();   // 7-day retention — Firestore TTL policy on timeline.expiresAt
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
  // Create a task — ANY unit member (a resident routinely logs the consultant's verbal round order;
  // attribution is preserved via assignedBy + onBehalfOf). Rules allow member create too.
  function addTask(gid, pid, info) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var t = buildTask(info, { uid: uid, name: currentName() });
        t.ts = fieldValue().serverTimestamp();
        t.expiresAt = retentionExpiry();   // 7-day retention — Firestore TTL policy on tasks.expiresAt
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
  // A resident records why a task wasn't done on time (or the current status). Any member may write it
  // (rules: task update = isMember). Stamped with author + time; capped.
  function explainTask(gid, pid, taskId, text) {
    return new Promise(function (resolve, reject) {
      if (!icuGroupsOn()) return reject(new Error("icu-groups-disabled"));
      fs(function (db) {
        var uid = currentUid();
        if (!db || !uid) return reject(new Error("firestore-unavailable"));
        var patch = { explanation: String(text || "").slice(0, 500), explainedBy: uid, explainedByName: currentName(), explainedAt: fieldValue().serverTimestamp() };
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
          .set({ name: currentName(), at: fieldValue().serverTimestamp(), expiresAt: retentionExpiry() }, { merge: true })
          .catch(function () {});   // expiresAt: presence orphaned after discharge (Firestore doesn't cascade-delete subcollections) is TTL-cleared within the window
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
  // The currently-open shared patient ({gid,pid}) or null — used to route a
  // watch Code Blue summary export to the right ICU timeline.
  function currentOpenPatient() {
    return (_presence.gid && _presence.pid) ? { gid: _presence.gid, pid: _presence.pid } : null;
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
    DESIGNATIONS: DESIGNATIONS,
    roleForDesignation: roleForDesignation,
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
    setDesignation: setDesignation,
    setNotifPrefs: setNotifPrefs,
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
    reclaimHead: reclaimHead,
    inviteUrl: inviteUrl,
    // patients
    subscribePatients: subscribePatients,
    subscribePatient: subscribePatient,
    upsertPatient: upsertPatient,
    setReviewed: setReviewed,
    removePatient: removePatient,
    // timeline / tasks
    addTimelineEvent: addTimelineEvent,
    subscribeTasks: subscribeTasks,
    addTask: addTask,
    setTaskStatus: setTaskStatus,
    explainTask: explainTask,
    // presence
    enterPatient: enterPatient,
    leavePatient: leavePatient,
    currentOpenPatient: currentOpenPatient,
    subscribePresence: subscribePresence,
    // pure test seams (deterministic transforms — used by the rules/logic harness)
    _mapGroupDoc: mapGroupDoc, _mapMemberDoc: mapMemberDoc, _mapPatientDoc: mapPatientDoc, _mapTimeline: mapTimeline, _mapTask: mapTask,
    _buildTimelineEvent: buildTimelineEvent, _buildTask: buildTask, _taskStatusPatch: taskStatusPatch,
    _retentionExpiry: retentionExpiry, _RETENTION_MS: RETENTION_MS,
    _retentionDays: retentionDays, _RETENTION_MAX_DAYS: RETENTION_MAX_DAYS, _RETENTION_DEFAULT_DAYS: RETENTION_DEFAULT_DAYS,
    _sanitizeState: sanitizeState, _normStatus: normStatus, _normRole: normRole, _normInviteRole: normInviteRole,
    _genSmdId: genSmdId, _emailHash: emailHash, _looksLikeEmail: looksLikeEmail, _normalizeId: normalizeId,
    _parseJoinParam: parseJoinParam, _inviteUrl: inviteUrl, _isAdminRole: isAdminRole,
    _SMD_ID_ALPHABET: SMD_ID_ALPHABET
  };
})();
