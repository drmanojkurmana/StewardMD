/* pglog-store.js — NMC Logbook · client store: account-scoped local state, offline drafts, API sync.
 * ===========================================================================
 * A resident logs at 3am on a ward with no signal. If the logbook only works online it will not be
 * used, and an unused logbook is a worse regulatory outcome than a slightly-delayed one. So:
 *
 *   DRAFTS ARE LOCAL AND ALWAYS WORK.  Every entry is written to localStorage first, immediately,
 *   with a local id. Nothing is lost to a dead network.
 *
 *   SUBMISSION IS ONLINE-ONLY, AND SAYS SO.  A draft can be queued for submission offline, but it
 *   is not "submitted" until the server has it and has stamped it — because submitted means "a
 *   named faculty member now owes this a verification" (PGMER-2023 5.2(vi)), which is a fact about
 *   the server's state, not the phone's. The UI shows queued and submitted as different things.
 *
 *   VERIFIED RECORDS ARE READ-ONLY MIRRORS.  Anything verified is cached for offline reading and is
 *   NEVER writable locally. The device is not a place where a verified entry can be changed.
 *
 * Storage key is account-scoped exactly like workspaces.js pkey() / surgx-store.js, so two doctors
 * sharing a phone never see each other's logbook.
 *
 * NO PHI BEYOND THE ENTRY SCHEMA. The local cache holds what the entry schema holds and nothing
 * more; pglog-model.sanitizeCaseRef() has already run before anything is stored.
 *
 * window.SMD_PGLOG_STORE + module.exports (the pure helpers are node-testable).
 */
(function () {
  "use strict";

  var G = (typeof window !== "undefined") ? window : null;
  var API = "/api/pglog";

  function ls() { try { return G && G.localStorage ? G.localStorage : null; } catch (e) { return null; } }
  function M() { try { return (G && G.SMD_PGLOG_MODEL) || (typeof require === "function" ? require("./pglog-model.js") : null); } catch (e) { return null; } }
  function flag(k) { try { return !!(G && G.SMD_PGLOG_FLAGS && G.SMD_PGLOG_FLAGS.bool(k)); } catch (e) { return false; } }

  /* ── account scope (mirrors workspaces.js pkey()) ─────────────────────────── */
  function uid() {
    try {
      var a = JSON.parse((ls() && ls().getItem("stewardmd_account")) || "null");
      return (a && (a.uid || a.email)) || "guest";
    } catch (e) { return "guest"; }
  }
  function pkey() { return "smd_pglog_" + uid(); }

  var DEF = {
    orgId: "", residentId: "", programmeId: "", curriculumId: "",
    drafts: {},          // localId -> entry (kind draft/returned; the ONLY locally-writable records)
    queue: [],           // localIds waiting to reach the server
    cache: null,         // last server dashboard payload (read-only mirror)
    cacheAt: 0,
    prefs: { lastKind: "procedure", lastSetting: "opd", lastSupervisor: "", lastDepartmentId: "", lastRotationId: "" }
  };

  function load() {
    try {
      var raw = ls() && ls().getItem(pkey());
      var p = raw ? JSON.parse(raw) : null;
      if (!p || typeof p !== "object") return clone(DEF);
      var out = clone(DEF);
      for (var k in DEF) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
      out.prefs = Object.assign(clone(DEF.prefs), out.prefs || {});
      return out;
    } catch (e) { return clone(DEF); }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function save(p) { try { ls() && ls().setItem(pkey(), JSON.stringify(p)); return true; } catch (e) { return false; } }
  function patch(fn) { var p = load(); fn(p); save(p); return p; }

  function localId() {
    // "loc_" prefixed so a local id can never be mistaken for a server id anywhere in the UI or in
    // a report — the two have very different guarantees.
    try { return "loc_" + (G.crypto && G.crypto.randomUUID ? G.crypto.randomUUID().replace(/-/g, "") : String(Date.now()) + Math.random().toString(36).slice(2)); }
    catch (e) { return "loc_" + String(Date.now()); }
  }

  /* ── transport ────────────────────────────────────────────────────────────── */
  function token() { try { return (G.SMD_IDTOKEN && G.SMD_IDTOKEN()) || ""; } catch (e) { return ""; } }
  function online() { try { return G.navigator ? G.navigator.onLine !== false : true; } catch (e) { return true; } }
  function serverOn() { return flag("smd_pglog_server"); }

  function req(path, opts) {
    opts = opts || {};
    if (!serverOn()) return Promise.reject(mkErr("server_disabled", "Server sync is turned off for this device."));
    if (!online()) return Promise.reject(mkErr("offline", "You are offline."));
    var t = token();
    if (!t) return Promise.reject(mkErr("signin_required", "Sign in to sync your logbook."));
    var h = { "Authorization": "Bearer " + t };
    if (opts.body) h["Content-Type"] = "application/json";
    return G.fetch(API + path, {
      method: opts.method || "GET", headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw mkErr(j.error || ("http_" + r.status), j.message || j.detail || "", j.errors);
        return j;
      });
    });
  }
  function mkErr(code, message, errors) {
    var e = new Error(code); e.code = code; e.userMessage = message || ""; e.errors = errors || null; return e;
  }

  /* ── reads ────────────────────────────────────────────────────────────────── */
  function me(orgId) { return req("/me?orgId=" + encodeURIComponent(orgId || load().orgId || "")); }
  function ready() {
    // Deliberately unauthenticated and never rejects: it is how the UI decides whether to offer the
    // "connect to your institution" path at all.
    if (!serverOn() || !online()) return Promise.resolve({ ok: false, enabled: false, reason: "offline" });
    return G.fetch(API + "/ready").then(function (r) { return r.json(); }).catch(function () { return { ok: false, enabled: false }; });
  }
  function dashboard(residentId) {
    return req("/dashboard/resident?residentId=" + encodeURIComponent(residentId)).then(function (d) {
      patch(function (p) { p.cache = d; p.cacheAt = Date.now(); });
      return d;
    });
  }
  function cachedDashboard() { var p = load(); return p.cache; }
  function facultyDashboard(orgId) { return req("/dashboard/faculty?orgId=" + encodeURIComponent(orgId)); }
  function deptDashboard(orgId, opts) {
    opts = opts || {};
    var qs = "?orgId=" + encodeURIComponent(orgId);
    ["departmentId", "programmeId", "trainingYear"].forEach(function (k) { if (opts[k]) qs += "&" + k + "=" + encodeURIComponent(opts[k]); });
    return req("/dashboard/dept" + qs);
  }
  function entries(residentId, opts) {
    opts = opts || {};
    var qs = "?residentId=" + encodeURIComponent(residentId);
    ["kind", "status", "from", "to"].forEach(function (k) { if (opts[k]) qs += "&" + k + "=" + encodeURIComponent(opts[k]); });
    return req("/entries" + qs);
  }
  function entry(id) { return req("/entries/" + encodeURIComponent(id)); }
  function rotations(residentId) { return req("/rotations?residentId=" + encodeURIComponent(residentId)); }
  function assessments(residentId) { return req("/assessments?residentId=" + encodeURIComponent(residentId)); }
  function attestations(residentId) { return req("/attestations?residentId=" + encodeURIComponent(residentId)); }
  // PUBLIC verification lookup. Deliberately NOT via req(): it needs no token, must work for an
  // examiner who has never signed in, and must not be blocked by the server-sync flag.
  function verifyCode(code) {
    if (!G || !G.fetch) return Promise.reject(mkErr("no_fetch", ""));
    return G.fetch(API + "/v/" + encodeURIComponent(String(code || "").trim()), { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return { ok: false, status: "unavailable" }; }); });
  }
  function facultyRoster(orgId) { return req("/faculty-roster?orgId=" + encodeURIComponent(orgId)).then(function (r) { return r.faculty || []; }); }
  function pending(orgId) { return req("/pending?orgId=" + encodeURIComponent(orgId)); }
  function notifications() { return req("/notifications"); }
  function markRead(id) { return req("/notifications/" + encodeURIComponent(id) + "/read", { method: "POST", body: {} }); }
  function residents(orgId, opts) {
    opts = opts || {};
    var qs = "?orgId=" + encodeURIComponent(orgId);
    ["departmentId", "programmeId", "trainingYear"].forEach(function (k) { if (opts[k]) qs += "&" + k + "=" + encodeURIComponent(opts[k]); });
    return req("/residents" + qs);
  }
  function programmes(orgId) { return req("/programmes?orgId=" + encodeURIComponent(orgId)); }
  function config(programmeId) { return req("/config/" + encodeURIComponent(programmeId)); }
  function setConfig(programmeId, overrides) { return req("/config/" + encodeURIComponent(programmeId), { method: "PUT", body: { overrides: overrides } }); }

  /* ── local drafts ─────────────────────────────────────────────────────────── */

  // A draft never leaves the device until the resident submits. It is validated with the SAME pure
  // validator the server uses, so "the form said it was fine" and "the server accepted it" can never
  // disagree.
  function saveDraft(body) {
    var m = M(); if (!m) return null;
    var p = load();
    var id = body.localId || localId();
    var e = m.entry(Object.assign({}, body, {
      id: id, residentId: body.residentId || p.residentId, programmeId: p.programmeId,
      status: "draft", createdAt: body.createdAt || Date.now(), updatedAt: Date.now()
    }));
    patch(function (st) {
      st.drafts[id] = e;
      st.prefs.lastKind = e.kind;
      if (e.setting) st.prefs.lastSetting = e.setting;
      if (e.supervisor) st.prefs.lastSupervisor = e.supervisor;
      if (e.departmentId) st.prefs.lastDepartmentId = e.departmentId;
      if (e.rotationId) st.prefs.lastRotationId = e.rotationId;
    });
    return e;
  }
  function drafts() {
    var d = load().drafts || {};
    return Object.keys(d).map(function (k) { return d[k]; })
      .sort(function (a, b) { return String(b.occurredAt).localeCompare(String(a.occurredAt)); });
  }
  function getDraft(id) { return (load().drafts || {})[id] || null; }
  function dropDraft(id) { patch(function (p) { delete p.drafts[id]; p.queue = (p.queue || []).filter(function (q) { return q !== id; }); }); }
  function validateDraft(e, ctx) { var m = M(); return m ? m.validateEntry(e, ctx) : { ok: false, errors: [] }; }

  /* ── submission ───────────────────────────────────────────────────────────────
   * push() is a two-step because the server owns both halves: create (which stamps the author and
   * the time) then submit (which sets pendingFor and notifies the supervisor). A failure between
   * them leaves a server-side DRAFT, which is recoverable and visible — never a lost entry. */
  function submitDraft(id) {
    var d = getDraft(id);
    if (!d) return Promise.reject(mkErr("no_draft", "That draft is gone."));
    return req("/entries", { method: "POST", body: stripLocal(d) })
      .then(function (r) {
        var serverId = r.entry && r.entry.id;
        if (!serverId) throw mkErr("no_id", "The server did not return an entry id.");
        return req("/entries/" + encodeURIComponent(serverId) + "/submit", { method: "POST", body: {} });
      })
      .then(function (r) { dropDraft(id); return r.entry; });
  }
  // Queue for later when there is no network. The UI must show these as "waiting to submit", not as
  // "submitted" — nobody owes them a verification yet.
  function queueDraft(id) {
    patch(function (p) { if (p.queue.indexOf(id) < 0) p.queue.push(id); });
    return load().queue.length;
  }
  function queued() { var p = load(); return (p.queue || []).map(function (id) { return p.drafts[id]; }).filter(Boolean); }
  // Drain the queue. Resolves with a per-item result rather than rejecting, so one bad entry does
  // not strand the rest.
  function flush() {
    var q = (load().queue || []).slice();
    if (!q.length) return Promise.resolve({ sent: 0, failed: [] });
    var sent = 0, failed = [];
    return q.reduce(function (chain, id) {
      return chain.then(function () {
        return submitDraft(id).then(function () { sent++; }, function (e) { failed.push({ id: id, error: e.code, message: e.userMessage }); });
      });
    }, Promise.resolve()).then(function () {
      patch(function (p) { p.queue = (p.queue || []).filter(function (id) { return failed.some(function (f) { return f.id === id; }); }); });
      return { sent: sent, failed: failed };
    });
  }
  function stripLocal(e) {
    var o = JSON.parse(JSON.stringify(e));
    // The server owns all of these; sending them would be ignored, but not sending them makes the
    // intent obvious to anyone reading a request in the network panel.
    ["id", "localId", "status", "createdBy", "createdAt", "updatedAt", "submittedAt", "verifiedBy",
     "verifiedAt", "returnedBy", "returnedAt", "returnReason", "history", "revisions", "deleted",
     "deletedBy", "deletedAt", "deleteReason", "attestedIn"].forEach(function (k) { delete o[k]; });
    return o;
  }

  /* ── server-side mutations ────────────────────────────────────────────────── */
  function editEntry(id, body) { return req("/entries/" + encodeURIComponent(id), { method: "PATCH", body: body }).then(function (r) { return r.entry; }); }
  function withdraw(id, reason) { return req("/entries/" + encodeURIComponent(id) + "/withdraw", { method: "POST", body: { reason: reason || "" } }).then(function (r) { return r.entry; }); }
  function resubmit(id) { return req("/entries/" + encodeURIComponent(id) + "/submit", { method: "POST", body: {} }).then(function (r) { return r.entry; }); }
  function verify(id, note) { return req("/entries/" + encodeURIComponent(id) + "/verify", { method: "POST", body: { note: note || "" } }).then(function (r) { return r.entry; }); }
  function returnEntry(id, reason) { return req("/entries/" + encodeURIComponent(id) + "/return", { method: "POST", body: { reason: reason } }).then(function (r) { return r.entry; }); }
  function amend(id, patchBody, reason) { return req("/entries/" + encodeURIComponent(id) + "/amend", { method: "POST", body: { patch: patchBody, reason: reason } }).then(function (r) { return r.entry; }); }
  function removeEntry(id, reason) { return req("/entries/" + encodeURIComponent(id) + "?reason=" + encodeURIComponent(reason || ""), { method: "DELETE" }).then(function (r) { return r.entry; }); }
  function createAssessment(body) { return req("/assessments", { method: "POST", body: body }).then(function (r) { return r.assessment; }); }
  function completeAssessment(id, body) { return req("/assessments/" + encodeURIComponent(id), { method: "PATCH", body: body }).then(function (r) { return r.assessment; }); }
  function signAssessment(id) { return req("/assessments/" + encodeURIComponent(id) + "/sign", { method: "POST", body: {} }).then(function (r) { return r.assessment; }); }
  function attest(body) { return req("/attest", { method: "POST", body: body }).then(function (r) { return r.attestation; }); }
  function createRotation(body) { return req("/rotations", { method: "POST", body: body }).then(function (r) { return r.rotation; }); }
  function updateRotation(id, body) { return req("/rotations/" + encodeURIComponent(id), { method: "PATCH", body: body }).then(function (r) { return r.rotation; }); }

  /* ── identity / setup ─────────────────────────────────────────────────────── */
  function setContext(c) {
    patch(function (p) {
      if (c.orgId != null) p.orgId = String(c.orgId);
      if (c.residentId != null) p.residentId = String(c.residentId);
      if (c.programmeId != null) p.programmeId = String(c.programmeId);
      if (c.curriculumId != null) p.curriculumId = String(c.curriculumId);
    });
  }
  function context() { var p = load(); return { orgId: p.orgId, residentId: p.residentId, programmeId: p.programmeId, curriculumId: p.curriculumId }; }
  function prefs() { return load().prefs; }
  function clearAccount() { try { ls() && ls().removeItem(pkey()); } catch (e) {} }

  /* ── demo seed — flag-gated, LOCAL ONLY ──────────────────────────────────────
   * smd_pglog_demo seeds fabricated data so the dashboards can be shown with no institution behind
   * them. It writes ONLY to the local cache and never calls the API; the server has no demo path.
   * Every seeded record is marked demo:true so a screen can (and does) label it. */
  function seedDemo(today) {
    if (!flag("smd_pglog_demo")) return null;
    var m = M(); if (!m) return null;
    var start = m.addMonths(today, -14);
    var mk = function (i, over) {
      return m.entry(Object.assign({
        id: "demo_" + i, residentId: "demo-res", programmeId: "demo-prog", orgId: "demo-org",
        occurredAt: m.addDays(today, -(i * 3 + 1)), status: i % 4 === 0 ? "submitted" : "verified",
        createdBy: "fb:demo", createdAt: Date.now(), supervisor: "fb:demo-guide", departmentId: "demo-dept"
      }, over));
    };
    var demo = [];
    for (var i = 0; i < 40; i++) {
      demo.push(i % 3 === 0
        ? mk(i, { kind: "procedure", procedureText: "Central venous access", role: i % 2 ? "assisted" : "performed_supervised" })
        : i % 3 === 1
          ? mk(i, { kind: "clinical", setting: i % 2 ? "ipd" : "opd", title: "Acute febrile illness", role: "performed_supervised" })
          : mk(i, { kind: "academic", academicType: i % 2 ? "journal_club" : "seminar", topic: "Sepsis bundles", role: "presented" }));
    }
    demo.forEach(function (e) { e.demo = true; });
    return {
      demo: true,
      resident: m.resident({ id: "demo-res", uid: "fb:demo", name: "Demo Resident", startDate: start, trainingYear: 2, guide: "fb:demo-guide" }),
      programme: m.programme({ id: "demo-prog", degree: "MD", specialtyId: "general-medicine", curriculumId: "general-medicine", durationMonths: 36 }),
      entries: demo, rotations: [], assessments: [], months: [],
      summary: m.summarise(demo),
      weekly: m.weeklyCadence(demo, start, today),
      attendance: m.attendanceSummary([], { programmeStart: start, today: today })
    };
  }

  var STORE = {
    // scope
    uid: uid, pkey: pkey, context: context, setContext: setContext, prefs: prefs, clearAccount: clearAccount,
    // reads
    ready: ready, me: me, dashboard: dashboard, cachedDashboard: cachedDashboard,
    facultyDashboard: facultyDashboard, deptDashboard: deptDashboard,
    entries: entries, entry: entry, rotations: rotations, assessments: assessments,
    attestations: attestations, pending: pending, residents: residents, programmes: programmes,
    notifications: notifications, markRead: markRead, config: config, setConfig: setConfig,
    facultyRoster: facultyRoster, verifyCode: verifyCode,
    // drafts
    saveDraft: saveDraft, drafts: drafts, getDraft: getDraft, dropDraft: dropDraft,
    validateDraft: validateDraft, submitDraft: submitDraft, queueDraft: queueDraft,
    queued: queued, flush: flush, stripLocal: stripLocal, localId: localId,
    // mutations
    editEntry: editEntry, resubmit: resubmit, withdraw: withdraw, verify: verify, returnEntry: returnEntry,
    amend: amend, removeEntry: removeEntry,
    createAssessment: createAssessment, completeAssessment: completeAssessment,
    signAssessment: signAssessment, attest: attest,
    createRotation: createRotation, updateRotation: updateRotation,
    // demo
    seedDemo: seedDemo,
    // internals a test wants
    _load: load, _save: save, _online: online
  };

  if (typeof module !== "undefined" && module.exports) module.exports = STORE;
  if (typeof window !== "undefined") window.SMD_PGLOG_STORE = STORE;
})();
